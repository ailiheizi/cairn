package processor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/search"
)

type semanticProviderTestRuntime struct {
	admission ONNXWorkerAdmission
	coverage  EmbedTextCoverage
	mutate    func(*EmbedTextResult)
}

func (r semanticProviderTestRuntime) Probe(context.Context, ONNXWorkerAdmission) (ONNXWorkerProbeResult, error) {
	return validONNXProbe(r.admission), nil
}

func (r semanticProviderTestRuntime) EmbedTextWithText(_ context.Context, req EmbedTextRequest, inputs []ONNXWorkerTextInput) (EmbedTextResultBatch, error) {
	digest, err := req.CanonicalDigest()
	if err != nil {
		return EmbedTextResultBatch{}, err
	}
	results := make([]EmbedTextResult, 0, len(req.Segments))
	for i, segment := range req.Segments {
		if i >= len(inputs) {
			break
		}
		vector := make([]float32, req.Profile.Dimension)
		vector[0] = 1
		coverage := r.coverage
		if coverage == "" {
			coverage = EmbedTextCoverageFull
		}
		inputTokens, embeddedTokens := int64(1), int64(1)
		if coverage == EmbedTextCoverageTruncated {
			inputTokens, embeddedTokens = 2, 1
		}
		result := EmbedTextResult{
			Binding: req.Binding, SegmentID: segment.ID, Source: segment.Source,
			DescriptionDocumentID: segment.DescriptionDocumentID, Ordinal: segment.Ordinal,
			SubjectRef: segment.SubjectRef, Language: segment.Language, TextHandleID: segment.TextHandleID,
			TextDigest: segment.TextDigest, Status: EmbedTextAccepted, Vector: vector,
			ElementType: req.Profile.ElementType, Dimension: req.Profile.Dimension,
			Normalization: req.Profile.Normalization, Pooling: req.Profile.Pooling,
			SemanticProfileDigest: req.Profile.SemanticProfileDigest, ConfigDigest: req.Profile.ConfigDigest,
			PreprocessingDigest: req.Binding.AppliedPreprocessingDigest, ModelDigest: req.Profile.ModelDigest,
			TokenizerDigest: req.Profile.TokenizerDigest, RuntimeDigest: req.Profile.RuntimeDigest,
			SemanticSpace: req.Profile.SemanticSpace, DeterminismClass: req.Profile.DeterminismClass,
			Coverage: coverage, InputTokens: inputTokens, EmbeddedTokens: embeddedTokens,
		}
		if r.mutate != nil {
			r.mutate(&result)
		}
		results = append(results, result)
	}
	return EmbedTextResultBatch{Binding: req.Binding, RequestDigest: digest, PeakResourceBytes: 1,
		ResourceScope: req.ResourceScope, Results: results}, nil
}

func TestONNXSemanticEmbeddingProviderBindsDocumentAndQueryProvenance(t *testing.T) {
	admission := testONNXAdmission(t)
	runtimeAdapter := semanticProviderTestRuntime{admission: admission}
	worker, err := admission.Negotiate(context.Background(), testONNXHost(admission, runtimeAdapter))
	if err != nil {
		t.Fatalf("negotiate worker: %v", err)
	}
	provider, err := NewONNXSemanticEmbeddingProvider(worker)
	if err != nil {
		t.Fatalf("new semantic provider: %v", err)
	}
	document, err := provider.Embed(context.Background(), search.SemanticEmbeddingRequest{
		Purpose: search.SemanticEmbeddingDocument, GenerationID: "index-generation-1", Manifest: admission.Manifest,
		Inputs: []search.SemanticTextInput{{SubjectID: "subject-1", SegmentID: "segment-1", DescriptionDocumentID: "doc-1", Ordinal: 2, Language: "zh", Text: "flooded city archive"}},
	})
	if err != nil {
		t.Fatalf("document embedding: %v", err)
	}
	if len(document) != 1 || document[0].SubjectID != "subject-1" || document[0].SegmentID != "segment-1" || len(document[0].Vector) != admission.Manifest.Dimension {
		t.Fatalf("document vectors = %+v", document)
	}
	evidence := document[0].InputEvidence
	if evidence == nil || evidence.TextDigest != digestText([]byte("flooded city archive")) || evidence.SourceRef != "doc-1" || evidence.Ordinal != 2 ||
		evidence.PreprocessingDigest != admission.Manifest.PreprocessingDigest || evidence.AppliedPreprocessingDigest != admission.DocumentPreprocessingDigest ||
		evidence.Coverage != search.SemanticInputCoverageFull || evidence.InputTokens != 1 || evidence.EmbeddedTokens != 1 {
		t.Fatalf("document input evidence = %+v", evidence)
	}
	query, err := provider.Embed(context.Background(), search.SemanticEmbeddingRequest{
		Purpose: search.SemanticEmbeddingQuery, GenerationID: "index-generation-1", Manifest: admission.Manifest,
		Inputs: []search.SemanticTextInput{{SegmentID: "query-1", Text: "flooded city"}},
	})
	if err != nil {
		t.Fatalf("query embedding: %v", err)
	}
	if len(query) != 1 || query[0].SubjectID != "" || query[0].SegmentID != "query-1" {
		t.Fatalf("query vectors = %+v", query)
	}
	if query[0].InputEvidence != nil {
		t.Fatalf("query vector unexpectedly has source evidence: %+v", query[0].InputEvidence)
	}
}

func TestONNXSemanticEmbeddingProviderRetainsTruncatedInputEvidence(t *testing.T) {
	admission := testONNXAdmission(t)
	worker, err := admission.Negotiate(context.Background(), testONNXHost(admission, semanticProviderTestRuntime{admission: admission, coverage: EmbedTextCoverageTruncated}))
	if err != nil {
		t.Fatalf("negotiate worker: %v", err)
	}
	provider, err := NewONNXSemanticEmbeddingProvider(worker)
	if err != nil {
		t.Fatalf("new semantic provider: %v", err)
	}
	results, err := provider.Embed(context.Background(), search.SemanticEmbeddingRequest{
		Purpose: search.SemanticEmbeddingDocument, GenerationID: "index-generation-1", Manifest: admission.Manifest,
		Inputs: []search.SemanticTextInput{{SubjectID: "subject-1", SegmentID: "segment-1", DescriptionDocumentID: "doc-1", Ordinal: 2, Language: "zh", Text: "long retained source"}},
	})
	if err != nil {
		t.Fatalf("document embedding: %v", err)
	}
	if len(results) != 1 || results[0].InputEvidence == nil || results[0].InputEvidence.Coverage != search.SemanticInputCoverageTruncated ||
		results[0].InputEvidence.InputTokens != 2 || results[0].InputEvidence.EmbeddedTokens != 1 {
		t.Fatalf("truncated evidence = %+v", results)
	}
}

func TestONNXSemanticEmbeddingProviderRejectsTruncatedQueryEmbedding(t *testing.T) {
	admission := testONNXAdmission(t)
	worker, err := admission.Negotiate(context.Background(), testONNXHost(admission, semanticProviderTestRuntime{admission: admission, coverage: EmbedTextCoverageTruncated}))
	if err != nil {
		t.Fatalf("negotiate worker: %v", err)
	}
	provider, err := NewONNXSemanticEmbeddingProvider(worker)
	if err != nil {
		t.Fatalf("new semantic provider: %v", err)
	}
	results, err := provider.Embed(context.Background(), search.SemanticEmbeddingRequest{
		Purpose: search.SemanticEmbeddingQuery, GenerationID: "index-generation-1", Manifest: admission.Manifest,
		Inputs: []search.SemanticTextInput{{SegmentID: "query", Text: "query beyond the tokenizer budget"}},
	})
	if !errors.Is(err, search.ErrInvalidQuery) || !errors.Is(err, search.ErrSemanticQueryInputTruncated) || len(results) != 0 {
		t.Fatalf("truncated query results=%+v err=%v, want no vector and ErrInvalidQuery", results, err)
	}
}

func TestONNXSemanticEmbeddingProviderRejectsMismatchedWorkerSourceEvidence(t *testing.T) {
	for _, tt := range []struct {
		name   string
		mutate func(*EmbedTextResult)
	}{
		{name: "digest", mutate: func(result *EmbedTextResult) { result.TextDigest = digestForProviderTest("different text") }},
		{name: "source revision", mutate: func(result *EmbedTextResult) { result.DescriptionDocumentID = "different-revision" }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			admission := testONNXAdmission(t)
			worker, err := admission.Negotiate(context.Background(), testONNXHost(admission, semanticProviderTestRuntime{admission: admission, mutate: tt.mutate}))
			if err != nil {
				t.Fatalf("negotiate worker: %v", err)
			}
			provider, err := NewONNXSemanticEmbeddingProvider(worker)
			if err != nil {
				t.Fatalf("new semantic provider: %v", err)
			}
			_, err = provider.Embed(context.Background(), search.SemanticEmbeddingRequest{
				Purpose: search.SemanticEmbeddingDocument, GenerationID: "index-generation-1", Manifest: admission.Manifest,
				Inputs: []search.SemanticTextInput{{SubjectID: "subject-1", SegmentID: "segment-1", DescriptionDocumentID: "doc-1", Ordinal: 2, Language: "zh", Text: "retained source"}},
			})
			if err == nil {
				t.Fatal("provider accepted a mismatched worker source binding")
			}
		})
	}
}

func TestONNXSemanticEmbeddingProviderRejectsManifestAndNotReadyWorker(t *testing.T) {
	admission := testONNXAdmission(t)
	worker, err := admission.Negotiate(context.Background(), testONNXHost(admission, semanticProviderTestRuntime{admission: admission}))
	if err != nil {
		t.Fatalf("negotiate worker: %v", err)
	}
	badManifest := admission.Manifest
	badManifest.ConfigDigest = digestForProviderTest("different-config")
	provider, err := NewONNXSemanticEmbeddingProvider(worker)
	if err != nil {
		t.Fatalf("new semantic provider: %v", err)
	}
	if _, err := provider.Embed(context.Background(), search.SemanticEmbeddingRequest{Purpose: search.SemanticEmbeddingQuery, GenerationID: "index-generation-1", Manifest: badManifest, Inputs: []search.SemanticTextInput{{SegmentID: "query-1", Text: "query"}}}); err == nil {
		t.Fatal("provider accepted a manifest from another generation")
	}
	worker.Admission.Capability.State = ONNXWorkerStateAdmitted
	if _, err := NewONNXSemanticEmbeddingProvider(worker); err == nil {
		t.Fatal("not-ready worker was accepted")
	}
}

func digestForProviderTest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return "sha256:" + hex.EncodeToString(sum[:])
}
