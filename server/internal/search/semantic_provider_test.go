package search

import (
	"errors"
	"math"
	"strings"
	"testing"
)

func TestValidateSemanticEmbeddingResultsAllowsUnknownLegacyEvidence(t *testing.T) {
	req := SemanticEmbeddingRequest{Purpose: SemanticEmbeddingDocument, GenerationID: "generation", Manifest: testZvecManifest(),
		Inputs: []SemanticTextInput{{SubjectID: "subject", SegmentID: "segment", DescriptionDocumentID: "doc-rev-1", Ordinal: 3, Text: "retained text"}}}
	if err := validateSemanticEmbeddingResults(req, []SemanticVector{{SubjectID: "subject", SegmentID: "segment", Vector: []float32{1, 0, 0, 0}}}); err != nil {
		t.Fatalf("legacy vector without optional evidence rejected: %v", err)
	}
}

func TestValidateSemanticEmbeddingResultsValidatesInputEvidence(t *testing.T) {
	manifest := testZvecManifest()
	input := SemanticTextInput{SubjectID: "subject", SegmentID: "segment", DescriptionDocumentID: "doc-rev-1", Ordinal: 3, Text: "retained text"}
	req := SemanticEmbeddingRequest{Purpose: SemanticEmbeddingDocument, GenerationID: "generation", Manifest: manifest, Inputs: []SemanticTextInput{input}}
	base := SemanticInputEvidence{
		TextDigest: sha256Text(input.Text), SourceRef: input.DescriptionDocumentID, Ordinal: input.Ordinal,
		PreprocessingDigest: manifest.PreprocessingDigest, AppliedPreprocessingDigest: "sha256:" + strings.Repeat("a", 64),
		Coverage: SemanticInputCoverageFull, InputTokens: 8, EmbeddedTokens: 8,
	}
	vector := func(evidence SemanticInputEvidence) []SemanticVector {
		return []SemanticVector{{SubjectID: input.SubjectID, SegmentID: input.SegmentID, Vector: []float32{1, 0, 0, 0}, InputEvidence: &evidence}}
	}
	if err := validateSemanticEmbeddingResults(req, vector(base)); err != nil {
		t.Fatalf("valid FULL evidence rejected: %v", err)
	}
	truncated := base
	truncated.Coverage = SemanticInputCoverageTruncated
	truncated.InputTokens, truncated.EmbeddedTokens = 12, 8
	if err := validateSemanticEmbeddingResults(req, vector(truncated)); err != nil {
		t.Fatalf("valid TRUNCATED evidence rejected: %v", err)
	}
	tests := []struct {
		name   string
		mutate func(*SemanticInputEvidence)
	}{
		{"text digest", func(e *SemanticInputEvidence) { e.TextDigest = "sha256:" + strings.Repeat("b", 64) }},
		{"source revision", func(e *SemanticInputEvidence) { e.SourceRef = "other-revision" }},
		{"ordinal", func(e *SemanticInputEvidence) { e.Ordinal++ }},
		{"base preprocessing", func(e *SemanticInputEvidence) { e.PreprocessingDigest = "different-profile" }},
		{"applied preprocessing", func(e *SemanticInputEvidence) { e.AppliedPreprocessingDigest = "not-a-digest" }},
		{"full count mismatch", func(e *SemanticInputEvidence) { e.EmbeddedTokens-- }},
		{"truncated count mismatch", func(e *SemanticInputEvidence) { e.Coverage = SemanticInputCoverageTruncated }},
		{"unknown coverage", func(e *SemanticInputEvidence) { e.Coverage = "UNKNOWN" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			evidence := base
			tt.mutate(&evidence)
			if err := validateSemanticEmbeddingResults(req, vector(evidence)); err == nil || !errors.Is(err, ErrSemanticProviderUnavailable) {
				t.Fatalf("invalid evidence error = %v, want ErrSemanticProviderUnavailable", err)
			}
		})
	}
	queryReq := SemanticEmbeddingRequest{Purpose: SemanticEmbeddingQuery, GenerationID: "generation", Manifest: manifest,
		Inputs: []SemanticTextInput{{SegmentID: "query", Text: "query"}}}
	if err := validateSemanticEmbeddingResults(queryReq, []SemanticVector{{SegmentID: "query", Vector: []float32{1, 0, 0, 0}, InputEvidence: &base}}); err == nil {
		t.Fatal("query vector accepted document source evidence")
	}
}

func TestValidateSemanticEmbeddingResultsRequiresL2Vectors(t *testing.T) {
	manifest := testZvecManifest()
	req := SemanticEmbeddingRequest{
		Purpose: SemanticEmbeddingDocument, GenerationID: "generation", Manifest: manifest,
		Inputs: []SemanticTextInput{{SubjectID: "subject", SegmentID: "segment", Text: "text"}},
	}
	tests := []struct {
		name   string
		vector []float32
		want   string
	}{
		{name: "zero", vector: []float32{0, 0, 0, 0}, want: "zero"},
		{name: "non finite", vector: []float32{1, 0, 0, float32(math.NaN())}, want: "non-finite"},
		{name: "not normalized", vector: []float32{2, 0, 0, 0}, want: "outside tolerance"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := validateSemanticEmbeddingResults(req, []SemanticVector{{SubjectID: "subject", SegmentID: "segment", Vector: tt.vector}})
			if got == nil || !strings.Contains(got.Error(), tt.want) {
				t.Fatalf("validation error = %v, want substring %q", got, tt.want)
			}
			if !errors.Is(got, ErrSemanticProviderUnavailable) {
				t.Fatalf("validation error = %v, want ErrSemanticProviderUnavailable", got)
			}
		})
	}
}

func TestValidateSemanticEmbeddingResultsAcceptsApproximatelyNormalizedL2(t *testing.T) {
	manifest := testZvecManifest()
	req := SemanticEmbeddingRequest{
		Purpose: SemanticEmbeddingQuery, GenerationID: "generation", Manifest: manifest,
		Inputs: []SemanticTextInput{{SegmentID: "query", Text: "text"}},
	}
	// This norm is within float32/BGE-sized rounding error but not exactly 1.
	vector := []float32{0.6002, 0.7997, 0, 0}
	if err := validateSemanticEmbeddingResults(req, []SemanticVector{{SegmentID: "query", Vector: vector}}); err != nil {
		t.Fatalf("approximately normalized vector rejected: %v", err)
	}
}

func TestValidateSemanticEmbeddingResultsSkipsL2RequirementForOtherNormalization(t *testing.T) {
	manifest := testZvecManifest()
	manifest.Normalization = "none"
	req := SemanticEmbeddingRequest{
		Purpose: SemanticEmbeddingDocument, GenerationID: "generation", Manifest: manifest,
		Inputs: []SemanticTextInput{{SubjectID: "subject", SegmentID: "segment", Text: "text"}},
	}
	if err := validateSemanticEmbeddingResults(req, []SemanticVector{{SubjectID: "subject", SegmentID: "segment", Vector: []float32{2, 0, 0, 0}}}); err != nil {
		t.Fatalf("non-l2 vector rejected: %v", err)
	}
}
