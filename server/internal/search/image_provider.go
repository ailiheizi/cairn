package search

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// Image embedding is a separate vector space with its own query tower. Text
// embeddings (the BGE space) and image embeddings (a CLIP-class space) are
// never compared or fused as raw vectors: only the image model's own text
// tower can place a query near images. Fusion happens at the list/score level.
//
// This file defines the provider boundary only. It contains no model runtime,
// no fixture, and no implicit capability claim.

// ImageEmbeddingPurpose distinguishes image (document) vectors from text
// query vectors produced by the image model's own text tower.
type ImageEmbeddingPurpose string

const (
	// ImageEmbeddingImage embeds admitted image bytes (pixel path).
	ImageEmbeddingImage ImageEmbeddingPurpose = "IMAGE"
	// ImageEmbeddingText embeds query text through the image model's text
	// tower. It exists only to place text near this image space.
	ImageEmbeddingText ImageEmbeddingPurpose = "TEXT"
)

// Media types admitted by the standard-library-only decode boundary. An image
// whose recorded type is outside this set is an explicit unsupported outcome,
// never a silently skipped one.
const (
	ImageMediaTypeJPEG = "image/jpeg"
	ImageMediaTypePNG  = "image/png"
)

const (
	// MaxImageEmbeddingInputs bounds one provider request.
	MaxImageEmbeddingInputs = 64
	// MaxImageEmbeddingInputBytes bounds one admitted image.
	MaxImageEmbeddingInputBytes = 64 << 20
	// MaxImageEmbeddingBatchBytes bounds the complete request payload.
	MaxImageEmbeddingBatchBytes = 256 << 20
)

// ImageSpaceFingerprint is the declared identity of one image embedding space.
// Two vectors may only be compared when their fingerprints are identical.
// Every field is a fact that can change produced vectors or their retrieval
// meaning, so every field is part of the canonical digest.
type ImageSpaceFingerprint struct {
	Schema           string `json:"schema"`
	ModelID          string `json:"model_id"`
	ModelVersion     string `json:"model_version"`
	Dimension        int    `json:"dimension"`
	ImageInput       string `json:"image_input"`
	TextInput        string `json:"text_input"`
	QueryInstruction string `json:"query_instruction"`
	Pooling          string `json:"pooling"`
	Normalization    string `json:"normalization"`
}

// ImageSpaceFingerprintSchemaV1 is the only admitted fingerprint schema.
const ImageSpaceFingerprintSchemaV1 = "cairn.image-space.v1"

var ErrInvalidImageSpaceFingerprint = errors.New("invalid image space fingerprint")

// Validate rejects an incomplete fingerprint before it can identify a space.
// ModelVersion may be empty only when the descriptor records a model revision
// separately; callers that know the revision should always record it.
func (f ImageSpaceFingerprint) Validate() error {
	fields := []struct {
		name  string
		value string
	}{
		{"model_id", f.ModelID},
		{"model_version", f.ModelVersion},
		{"image_input", f.ImageInput},
		{"text_input", f.TextInput},
		{"pooling", f.Pooling},
		{"normalization", f.Normalization},
	}
	missing := make([]string, 0, len(fields)+1)
	for _, field := range fields {
		if strings.TrimSpace(field.value) == "" {
			missing = append(missing, field.name)
		}
	}
	if f.Schema != ImageSpaceFingerprintSchemaV1 {
		missing = append(missing, "schema")
	}
	if f.Dimension <= 0 {
		missing = append(missing, "dimension")
	}
	if len(missing) > 0 {
		return fmt.Errorf("%w: missing %s", ErrInvalidImageSpaceFingerprint, strings.Join(missing, ", "))
	}
	return nil
}

// CanonicalDigest is the stable identity of this space. It is what a
// generation records in its semantic-space field, and what a query vector must
// match before it can be scored.
func (f ImageSpaceFingerprint) CanonicalDigest() string {
	if err := f.Validate(); err != nil {
		return ""
	}
	payload, _ := json.Marshal(f)
	h := sha256.Sum256(append([]byte("cairn.image-space.v1\n"), payload...))
	return "sha256:" + hex.EncodeToString(h[:])
}

// Reference is a short human reference for reports and notes.
func (f ImageSpaceFingerprint) Reference() string {
	if strings.TrimSpace(f.ModelID) == "" {
		return ""
	}
	if strings.TrimSpace(f.ModelVersion) == "" {
		return f.ModelID
	}
	return f.ModelID + "@" + f.ModelVersion
}

// Provider capability states. They mirror the operator vocabulary used for
// the other dimensions: NOT_BUILT means no artifact or binding is installed,
// UNAVAILABLE means something is installed but cannot run, and READY means a
// real runtime answered a readiness probe for this exact space.
const (
	ImageProviderReady       = "READY"
	ImageProviderUnavailable = "UNAVAILABLE"
	ImageProviderNotBuilt    = "NOT_BUILT"
)

// ImageProviderReport is the honest state of one image provider binding. It is
// evidence, not a capability grant: the indexer still requires a verified
// generation before the dimension reports AVAILABLE.
type ImageProviderReport struct {
	State          string
	Reason         string
	Artifact       string
	ProviderDigest string
	Fingerprint    ImageSpaceFingerprint
}

// ImageEmbeddingHealth is an optional readiness boundary. A provider that does
// not implement it is treated as UNAVAILABLE by the indexer; a bare interface
// implementation is never proof that a model can run.
type ImageEmbeddingHealth interface {
	ImageProviderReport() ImageProviderReport
}

// ImageEmbeddingInput is one unit of image-provider work. Exactly one of
// ImageBytes and Text is set according to the request purpose. ImageDigest is
// the host-computed identity of the admitted bytes; the provider must not
// re-derive identity from a filename or a path (it never receives one).
type ImageEmbeddingInput struct {
	SubjectID   string
	SegmentID   string
	MediaType   string
	ImageDigest string
	ImageBytes  []byte
	Text        string
	Language    string
}

// ImageEmbeddingRequest is a host-owned, bounded provider request. The
// provider receives admitted bytes or durable query text only; it never
// receives repository paths, index paths, credentials, or catalog authority.
type ImageEmbeddingRequest struct {
	Purpose      ImageEmbeddingPurpose
	GenerationID string
	Manifest     EmbeddingGenerationManifest
	Fingerprint  ImageSpaceFingerprint
	Inputs       []ImageEmbeddingInput
}

// ImageEmbeddingVector is one produced vector with the space and provider
// identity it was actually produced under.
type ImageEmbeddingVector struct {
	SubjectID        string
	SegmentID        string
	SpaceFingerprint string
	ProviderDigest   string
	Vector           []float32
}

// ImageEmbeddingProvider is the narrow bridge between the processor host and
// the disposable image index. A provider must return exactly one finite vector
// for every input or fail closed.
type ImageEmbeddingProvider interface {
	EmbedImages(context.Context, ImageEmbeddingRequest) ([]ImageEmbeddingVector, error)
}

var (
	ErrImageProviderUnavailable      = errors.New("image embedding provider unavailable")
	ErrImageSpaceFingerprintMismatch = errors.New("image embedding space fingerprint mismatch")
)

// ValidateImageGenerationManifest binds one image space fingerprint to the
// immutable generation manifest. It is the single place that decides whether a
// manifest describes this image space; a mismatch fails closed.
func ValidateImageGenerationManifest(manifest EmbeddingGenerationManifest, fingerprint ImageSpaceFingerprint) error {
	if err := manifest.Validate(); err != nil {
		return fmt.Errorf("%w: manifest: %v", ErrInvalidImageSpaceFingerprint, err)
	}
	if err := fingerprint.Validate(); err != nil {
		return err
	}
	if manifest.Dimension != fingerprint.Dimension {
		return fmt.Errorf("%w: manifest dimension %d does not match fingerprint dimension %d", ErrInvalidImageSpaceFingerprint, manifest.Dimension, fingerprint.Dimension)
	}
	if manifest.SemanticSpace != fingerprint.CanonicalDigest() {
		return fmt.Errorf("%w: manifest semantic space %q is not the declared fingerprint", ErrImageSpaceFingerprintMismatch, manifest.SemanticSpace)
	}
	if manifest.Normalization != fingerprint.Normalization || manifest.Pooling != fingerprint.Pooling {
		return fmt.Errorf("%w: manifest vector profile does not match the declared fingerprint", ErrInvalidImageSpaceFingerprint)
	}
	if manifest.Distance != "cosine" {
		return fmt.Errorf("%w: image generation requires cosine distance", ErrInvalidImageSpaceFingerprint)
	}
	if manifest.VectorSchema != fmt.Sprintf("float32:%d", manifest.Dimension) {
		return fmt.Errorf("%w: image generation requires the declared float32 vector schema", ErrInvalidImageSpaceFingerprint)
	}
	return nil
}

func validateImageEmbeddingInputs(req ImageEmbeddingRequest, limitBytes int) error {
	if len(req.Inputs) == 0 || len(req.Inputs) > MaxImageEmbeddingInputs {
		return fmt.Errorf("%w: input count is outside bounds", ErrImageProviderUnavailable)
	}
	total := 0
	seen := make(map[string]struct{}, len(req.Inputs))
	for _, input := range req.Inputs {
		if strings.TrimSpace(input.SegmentID) == "" {
			return fmt.Errorf("%w: empty segment identity", ErrImageProviderUnavailable)
		}
		if req.Purpose == ImageEmbeddingImage && strings.TrimSpace(input.SubjectID) == "" {
			return fmt.Errorf("%w: empty subject identity", ErrImageProviderUnavailable)
		}
		key := input.SegmentID
		if req.Purpose == ImageEmbeddingText {
			key = input.SubjectID + "\x00" + input.SegmentID
		}
		if _, ok := seen[key]; ok {
			return fmt.Errorf("%w: duplicate input identity", ErrImageProviderUnavailable)
		}
		seen[key] = struct{}{}
		switch req.Purpose {
		case ImageEmbeddingImage:
			if len(input.ImageBytes) == 0 {
				return fmt.Errorf("%w: empty image bytes", ErrImageProviderUnavailable)
			}
			if len(input.ImageBytes) > MaxImageEmbeddingInputBytes {
				return fmt.Errorf("%w: image exceeds the per-input byte budget", ErrImageProviderUnavailable)
			}
			total += len(input.ImageBytes)
			if total > limitBytes {
				return fmt.Errorf("%w: request exceeds the batch byte budget", ErrImageProviderUnavailable)
			}
			if err := validateImageMediaType(input.MediaType); err != nil {
				return err
			}
			sum := sha256.Sum256(input.ImageBytes)
			if got := "sha256:" + hex.EncodeToString(sum[:]); input.ImageDigest == "" || input.ImageDigest != got {
				return fmt.Errorf("%w: image digest does not match the admitted bytes", ErrImageProviderUnavailable)
			}
		case ImageEmbeddingText:
			if strings.TrimSpace(input.Text) == "" {
				return fmt.Errorf("%w: empty query text", ErrImageProviderUnavailable)
			}
			if len(input.ImageBytes) != 0 {
				return fmt.Errorf("%w: query input must not carry image bytes", ErrImageProviderUnavailable)
			}
		default:
			return fmt.Errorf("%w: unknown embedding purpose %q", ErrImageProviderUnavailable, req.Purpose)
		}
	}
	return nil
}

// validateImageMediaType is the closed decode boundary. Unsupported types are
// an explicit outcome for the caller to report, not a silent skip.
func validateImageMediaType(mediaType string) error {
	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case ImageMediaTypeJPEG, ImageMediaTypePNG:
		return nil
	case "":
		return fmt.Errorf("%w: image media type is required", ErrImageProviderUnavailable)
	default:
		return fmt.Errorf("%w: unsupported image media type %q", ErrImageProviderUnavailable, mediaType)
	}
}

// ValidateImageEmbeddingRequest is exported so the processor host can perform
// the same admission before issuing native work.
func ValidateImageEmbeddingRequest(req ImageEmbeddingRequest) error {
	if err := ValidateImageGenerationManifest(req.Manifest, req.Fingerprint); err != nil {
		return err
	}
	if req.Purpose != ImageEmbeddingImage && req.Purpose != ImageEmbeddingText {
		return fmt.Errorf("%w: unknown embedding purpose %q", ErrImageProviderUnavailable, req.Purpose)
	}
	return validateImageEmbeddingInputs(req, MaxImageEmbeddingBatchBytes)
}

// ValidateImageEmbeddingResults checks the provider's answer against the
// request. A vector produced under another space fingerprint is refused here:
// it is never scored, stored, or fused against a generation it does not match.
func ValidateImageEmbeddingResults(req ImageEmbeddingRequest, results []ImageEmbeddingVector) error {
	if len(results) != len(req.Inputs) {
		return fmt.Errorf("%w: provider returned %d vectors for %d inputs", ErrImageProviderUnavailable, len(results), len(req.Inputs))
	}
	wantFingerprint := req.Fingerprint.CanonicalDigest()
	want := make(map[string]ImageEmbeddingInput, len(req.Inputs))
	for _, input := range req.Inputs {
		key := input.SegmentID
		if req.Purpose == ImageEmbeddingText {
			key = input.SubjectID + "\x00" + input.SegmentID
		}
		want[key] = input
	}
	seen := make(map[string]struct{}, len(results))
	for _, result := range results {
		key := result.SegmentID
		if req.Purpose == ImageEmbeddingText {
			key = result.SubjectID + "\x00" + result.SegmentID
		}
		input, ok := want[key]
		if !ok {
			return fmt.Errorf("%w: provider returned an unknown input identity", ErrImageProviderUnavailable)
		}
		if _, ok := seen[key]; ok {
			return fmt.Errorf("%w: provider returned duplicate input identity", ErrImageProviderUnavailable)
		}
		seen[key] = struct{}{}
		if strings.TrimSpace(result.SpaceFingerprint) != wantFingerprint {
			return fmt.Errorf("%w: provider produced a vector under space %q, generation requires %q", ErrImageSpaceFingerprintMismatch, result.SpaceFingerprint, wantFingerprint)
		}
		if wantDigest := strings.TrimSpace(req.Manifest.ProviderDigest); wantDigest != "" && result.ProviderDigest != "" && result.ProviderDigest != wantDigest {
			return fmt.Errorf("%w: provider digest %q does not match generation provider %q", ErrImageProviderUnavailable, result.ProviderDigest, wantDigest)
		}
		if len(result.Vector) != req.Fingerprint.Dimension {
			return fmt.Errorf("%w: vector dimension %d does not match %d", ErrImageProviderUnavailable, len(result.Vector), req.Fingerprint.Dimension)
		}
		if err := validateSemanticVectorValues(result.Vector, req.Fingerprint.Normalization); err != nil {
			return fmt.Errorf("%w: provider returned invalid vector: %v", ErrImageProviderUnavailable, err)
		}
		if req.Purpose == ImageEmbeddingImage && result.SubjectID != input.SubjectID {
			return fmt.Errorf("%w: provider changed subject identity", ErrImageProviderUnavailable)
		}
	}
	return nil
}

// SortImageInputs orders provider inputs deterministically so a rebuild is
// reproducible and a retry accepts the same identities.
func SortImageInputs(inputs []ImageEmbeddingInput) {
	sort.Slice(inputs, func(i, j int) bool {
		if inputs[i].SubjectID != inputs[j].SubjectID {
			return inputs[i].SubjectID < inputs[j].SubjectID
		}
		return inputs[i].SegmentID < inputs[j].SegmentID
	})
}
