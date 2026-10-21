package search

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
)

// SemanticEmbeddingPurpose distinguishes document/segment vectors from query
// vectors. The preprocessing contract is part of the bound manifest; callers
// must not reuse a query vector as a document projection.
type SemanticEmbeddingPurpose string

const (
	SemanticEmbeddingDocument SemanticEmbeddingPurpose = "DOCUMENT"
	SemanticEmbeddingQuery    SemanticEmbeddingPurpose = "QUERY"
)

type SemanticTextInput struct {
	SubjectID             string
	SegmentID             string
	DescriptionDocumentID string
	Ordinal               int64
	Language              string
	Text                  string
}

type SemanticVector struct {
	SubjectID string
	SegmentID string
	Vector    []float32
	// InputEvidence is optional because legacy, fixture, and online providers
	// may not expose tokenizer-consumption evidence. Nil is UNKNOWN, never FULL.
	InputEvidence *SemanticInputEvidence
}

type SemanticInputCoverage string

const (
	SemanticInputCoverageFull      SemanticInputCoverage = "FULL"
	SemanticInputCoverageTruncated SemanticInputCoverage = "TRUNCATED"
)

// SemanticInputEvidence carries host-validated lineage for one selected
// document segment. It is a rebuildable projection, not a durable source or
// recovery record. Token counts do not imply byte-span coverage.
type SemanticInputEvidence struct {
	TextDigest                 string                `json:"text_digest"`
	SourceRef                  string                `json:"source_ref"`
	Ordinal                    int64                 `json:"ordinal"`
	PreprocessingDigest        string                `json:"preprocessing_digest"`
	AppliedPreprocessingDigest string                `json:"applied_preprocessing_digest"`
	Coverage                   SemanticInputCoverage `json:"coverage"`
	InputTokens                int64                 `json:"input_tokens"`
	EmbeddedTokens             int64                 `json:"embedded_tokens"`
}

// SemanticEmbeddingRequest is a host-owned, bounded provider request. The
// provider receives durable segment text only; it never receives repository
// paths, index paths, credentials, or catalog write authority.
type SemanticEmbeddingRequest struct {
	Purpose      SemanticEmbeddingPurpose
	GenerationID string
	Manifest     EmbeddingGenerationManifest
	Inputs       []SemanticTextInput
}

// SemanticEmbeddingProvider is the narrow bridge between the processor host
// and the disposable semantic index. A provider must return exactly one
// finite vector for every input or fail closed.
type SemanticEmbeddingProvider interface {
	Embed(context.Context, SemanticEmbeddingRequest) ([]SemanticVector, error)
}

var ErrSemanticProviderUnavailable = errors.New("semantic embedding provider unavailable")

// semanticL2Tolerance is deliberately loose enough for normal float32
// output from BGE/ONNX while still rejecting vectors whose declared L2
// normalization is materially false.
const semanticL2Tolerance = 1e-3

func validateSemanticVectorValues(vector []float32, normalization string) error {
	var squaredNorm float64
	for _, value := range vector {
		if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
			return errors.New("vector contains a non-finite value")
		}
		squaredNorm += float64(value) * float64(value)
	}
	if normalization != "l2" {
		return nil
	}
	norm := math.Sqrt(squaredNorm)
	if math.IsNaN(norm) || math.IsInf(norm, 0) || norm <= 0 {
		return errors.New("l2 vector has a zero or non-finite norm")
	}
	if math.Abs(norm-1) > semanticL2Tolerance {
		return fmt.Errorf("l2 vector norm %.8f is outside tolerance %.4f", norm, semanticL2Tolerance)
	}
	return nil
}

func validateSemanticEmbeddingRequest(req SemanticEmbeddingRequest) error {
	if err := req.Manifest.Validate(); err != nil {
		return fmt.Errorf("%w: manifest: %v", ErrSemanticProviderUnavailable, err)
	}
	if req.Purpose != SemanticEmbeddingDocument && req.Purpose != SemanticEmbeddingQuery {
		return fmt.Errorf("%w: unknown embedding purpose %q", ErrSemanticProviderUnavailable, req.Purpose)
	}
	if len(req.Inputs) == 0 || len(req.Inputs) > 256 {
		return fmt.Errorf("%w: input count is outside bounds", ErrSemanticProviderUnavailable)
	}
	seen := make(map[string]struct{}, len(req.Inputs))
	for _, input := range req.Inputs {
		if strings.TrimSpace(input.Text) == "" {
			return fmt.Errorf("%w: empty input text", ErrSemanticProviderUnavailable)
		}
		if strings.TrimSpace(input.SegmentID) == "" {
			return fmt.Errorf("%w: empty segment identity", ErrSemanticProviderUnavailable)
		}
		if req.Purpose == SemanticEmbeddingDocument && strings.TrimSpace(input.SubjectID) == "" {
			return fmt.Errorf("%w: empty subject identity", ErrSemanticProviderUnavailable)
		}
		key := input.SegmentID
		if req.Purpose == SemanticEmbeddingQuery {
			key = input.SubjectID + "\x00" + input.SegmentID
		}
		if _, ok := seen[key]; ok {
			return fmt.Errorf("%w: duplicate input identity", ErrSemanticProviderUnavailable)
		}
		seen[key] = struct{}{}
	}
	return nil
}

func validateSemanticEmbeddingResults(req SemanticEmbeddingRequest, results []SemanticVector) error {
	if len(results) != len(req.Inputs) {
		return fmt.Errorf("%w: provider returned %d vectors for %d inputs", ErrSemanticProviderUnavailable, len(results), len(req.Inputs))
	}
	want := make(map[string]SemanticTextInput, len(req.Inputs))
	for _, input := range req.Inputs {
		key := input.SegmentID
		if req.Purpose == SemanticEmbeddingQuery {
			key = input.SubjectID + "\x00" + input.SegmentID
		}
		want[key] = input
	}
	seen := make(map[string]struct{}, len(results))
	for _, result := range results {
		key := result.SegmentID
		if req.Purpose == SemanticEmbeddingQuery {
			key = result.SubjectID + "\x00" + result.SegmentID
		}
		input, ok := want[key]
		if !ok {
			return fmt.Errorf("%w: provider returned an unknown input identity", ErrSemanticProviderUnavailable)
		}
		if _, ok := seen[key]; ok {
			return fmt.Errorf("%w: provider returned duplicate input identity", ErrSemanticProviderUnavailable)
		}
		seen[key] = struct{}{}
		if len(result.Vector) != req.Manifest.Dimension {
			return fmt.Errorf("%w: vector dimension %d does not match %d", ErrSemanticProviderUnavailable, len(result.Vector), req.Manifest.Dimension)
		}
		if err := validateSemanticVectorValues(result.Vector, req.Manifest.Normalization); err != nil {
			return fmt.Errorf("%w: provider returned invalid vector: %v", ErrSemanticProviderUnavailable, err)
		}
		if req.Purpose == SemanticEmbeddingDocument && result.SubjectID != input.SubjectID {
			return fmt.Errorf("%w: provider changed subject identity", ErrSemanticProviderUnavailable)
		}
		if result.InputEvidence != nil {
			if req.Purpose != SemanticEmbeddingDocument {
				return fmt.Errorf("%w: query vector carries document input evidence", ErrSemanticProviderUnavailable)
			}
			if err := validateSemanticInputEvidence(req, input, *result.InputEvidence); err != nil {
				return fmt.Errorf("%w: provider returned invalid input evidence: %v", ErrSemanticProviderUnavailable, err)
			}
		}
	}
	return nil
}

func validateSemanticInputEvidence(req SemanticEmbeddingRequest, input SemanticTextInput, evidence SemanticInputEvidence) error {
	if evidence.TextDigest != sha256Text(input.Text) || evidence.SourceRef == "" || evidence.SourceRef != input.DescriptionDocumentID || evidence.Ordinal != input.Ordinal {
		return errors.New("source mapping or selected-text digest does not match input")
	}
	if evidence.PreprocessingDigest == "" || evidence.PreprocessingDigest != req.Manifest.PreprocessingDigest || !validSHA256Text(evidence.AppliedPreprocessingDigest) {
		return errors.New("preprocessing binding does not match generation profile")
	}
	if evidence.InputTokens <= 0 || evidence.EmbeddedTokens <= 0 || evidence.EmbeddedTokens > evidence.InputTokens {
		return errors.New("invalid tokenizer accounting")
	}
	switch evidence.Coverage {
	case SemanticInputCoverageFull:
		if evidence.InputTokens != evidence.EmbeddedTokens {
			return errors.New("FULL evidence has unequal token counts")
		}
	case SemanticInputCoverageTruncated:
		if evidence.InputTokens <= evidence.EmbeddedTokens {
			return errors.New("TRUNCATED evidence is not shorter than input")
		}
	default:
		return errors.New("unknown tokenizer coverage")
	}
	return nil
}
