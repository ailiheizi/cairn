package search

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

type recordingSemanticInputProvider struct{ inputs []SemanticTextInput }

func (p *recordingSemanticInputProvider) Embed(ctx context.Context, request SemanticEmbeddingRequest) ([]SemanticVector, error) {
	if err := validateSemanticEmbeddingRequest(request); err != nil {
		return nil, err
	}
	if request.Purpose == SemanticEmbeddingDocument {
		p.inputs = append(p.inputs, request.Inputs...)
	}
	results := make([]SemanticVector, 0, len(request.Inputs))
	for _, input := range request.Inputs {
		results = append(results, SemanticVector{SubjectID: input.SubjectID, SegmentID: input.SegmentID, Vector: []float32{1, 0, 0, 0}})
	}
	return results, validateSemanticEmbeddingResults(request, results)
}

func TestSemanticQueryUsesGenerationPinnedAnnotationRevision(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	annotationID := mustSearchID(t, sqlite.IDPrefixAnnotation)
	oldBody := "first durable semantic note body"
	newBody := "later edited semantic note body"
	if err := store.CreateAnnotation(ctx, &sqlite.Annotation{
		ID: annotationID, WorkspaceID: seed.WorkspaceID, SubjectRef: seed.FileEntryID,
		Kind: sqlite.AnnotationNote, Body: oldBody, Revision: 1,
	}); err != nil {
		t.Fatalf("create Note revision 1: %v", err)
	}

	manifest := testZvecManifest()
	manifest.SemanticSpace = SemanticBundleBGESemanticSpace
	driver := &integrationSemanticGenerationDriver{}
	indexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()},
		ConfigDigest:         manifest.ConfigDigest,
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4),
		SemanticManifest:     manifest, SemanticProvider: integrationSemanticProvider{},
		SemanticZvec:          driver,
		SemanticLibraryPath:   "/private/explicit/libzvec_c_api.dylib",
		SemanticLibraryDigest: "sha256:" + strings.Repeat("0", 64),
	}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:note-revision-provenance", seed.RootID); err != nil {
		t.Fatalf("build generation from Note revision 1: %v", err)
	}
	oldGeneration, err := store.LatestIndexGeneration(ctx, seed.WorkspaceID, DimensionSemantic)
	if err != nil {
		t.Fatalf("read built semantic generation: %v", err)
	}
	if err := store.ReviseAnnotation(ctx, seed.WorkspaceID, annotationID, 1, newBody, false, time.Now()); err != nil {
		t.Fatalf("revise Note to revision 2: %v", err)
	}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:forced-lexical-failure", "missing-root"); err == nil {
		t.Fatal("forced lexical refresh unexpectedly succeeded")
	}
	current, err := store.GetAnnotation(ctx, seed.WorkspaceID, annotationID)
	if err != nil || current.Revision != 2 || current.Body != newBody {
		t.Fatalf("current Note = %+v, err=%v; want revision 2", current, err)
	}

	if _, _, err := indexer.Query(ctx, QueryRequest{WorkspaceID: seed.WorkspaceID, Dimension: DimensionSemantic, Text: "semantic note"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("default semantic query after durable Note revision = %v, want stale ErrUnavailable", err)
	}
	// A reconstructed indexer must consult durable source identities directly;
	// an old lexical generation after restart cannot certify the old semantic
	// generation as current merely because its generation IDs still match.
	restarted := &Indexer{Store: store, Engine: indexer.Engine, ConfigDigest: manifest.ConfigDigest,
		LexicalProfileDigest: indexer.LexicalProfileDigest, SemanticManifest: manifest,
		SemanticProvider: integrationSemanticProvider{}, SemanticZvec: &integrationSemanticGenerationDriver{},
		SemanticLibraryPath: indexer.SemanticLibraryPath, SemanticLibraryDigest: indexer.SemanticLibraryDigest}
	if _, _, err := restarted.Query(ctx, QueryRequest{WorkspaceID: seed.WorkspaceID, Dimension: DimensionSemantic, Text: "semantic note"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("reconstructed default semantic query after durable Note revision = %v, want stale ErrUnavailable", err)
	}
	queryGeneration, hits, err := indexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, Dimension: DimensionSemantic, GenerationID: oldGeneration.ID, Text: "semantic note",
	})
	if err != nil {
		t.Fatalf("query pinned semantic generation: %v", err)
	}
	if queryGeneration.ID != oldGeneration.ID {
		t.Fatalf("queried generation = %q, want pinned old generation %q", queryGeneration.ID, oldGeneration.ID)
	}
	for _, hit := range hits {
		for _, segment := range hit.Segments {
			if segment.SourceType != "ANNOTATION" || segment.SourceID != annotationID {
				continue
			}
			if segment.MatchedText != oldBody {
				t.Fatalf("old-generation Note hit projected %q; want exact revision 1 body %q", segment.MatchedText, oldBody)
			}
			if err := store.ReviseAnnotation(ctx, seed.WorkspaceID, annotationID, 2, newBody, true, time.Now()); err != nil {
				t.Fatalf("tombstone current Note revision: %v", err)
			}
			if _, _, err := indexer.Query(ctx, QueryRequest{
				WorkspaceID: seed.WorkspaceID, Dimension: DimensionSemantic, Text: "semantic note",
			}); !errors.Is(err, ErrUnavailable) {
				t.Fatalf("query with tombstoned current Note = %v, want ErrUnavailable", err)
			}
			return
		}
	}
	t.Fatal("old semantic generation returned no provenance-bearing Note hit")
}

func TestLongNoteUsesReproducibleSourceSpansAndPinnedRevision(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	annotationID := mustSearchID(t, sqlite.IDPrefixAnnotation)
	oldBody := strings.Repeat("common ", 700) + "suffix-only-needle-9f2c7a"
	newBody := strings.Repeat("replacement note body. ", 50)
	if err := store.CreateAnnotation(ctx, &sqlite.Annotation{ID: annotationID, WorkspaceID: seed.WorkspaceID,
		SubjectRef: seed.FileEntryID, Kind: sqlite.AnnotationNote, Body: oldBody, Revision: 1}); err != nil {
		t.Fatal(err)
	}
	manifest := testZvecManifest()
	indexer := &Indexer{Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: manifest.ConfigDigest,
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4), SemanticManifest: manifest,
		SemanticProvider: integrationSemanticProvider{}, SemanticZvec: &integrationSemanticGenerationDriver{},
		SemanticLibraryPath: "/private/explicit/libzvec_c_api.dylib", SemanticLibraryDigest: "sha256:" + strings.Repeat("0", 64)}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:long-note-spans", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	generation, err := store.LatestIndexGeneration(ctx, seed.WorkspaceID, DimensionSemantic)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.ReviseAnnotation(ctx, seed.WorkspaceID, annotationID, 1, newBody, false, time.Now()); err != nil {
		t.Fatal(err)
	}
	_, hits, err := indexer.Query(ctx, QueryRequest{WorkspaceID: seed.WorkspaceID, Dimension: DimensionSemantic, Text: "suffix-only-needle-9f2c7a"})
	if err != nil {
		t.Fatalf("old generation query: %v", err)
	}
	foundTail := false
	for _, hit := range hits {
		for _, segment := range hit.Segments {
			prov := segment.TextSourceProvenance
			if segment.SourceID != annotationID || prov == nil {
				continue
			}
			if segment.MatchedText == oldBody[prov.SourceStartByte:prov.SourceEndByte] && strings.Contains(segment.MatchedText, "suffix-only-needle-9f2c7a") {
				if prov.SourceRevision != "1" || prov.BodyDigest != sha256Text(oldBody) || prov.SegmentationProfileDigest != semanticTextSourceSegmentationProfileDigest || prov.TextDigest != sha256Text(segment.MatchedText) {
					t.Fatalf("provenance=%+v", prov)
				}
				if prov.SourceStartByte <= 512*len("common ") {
					t.Fatalf("tail did not begin beyond the former 512-token prefix: %+v", prov)
				}
				foundTail = true
			}
		}
	}
	if !foundTail {
		t.Fatal("old-generation semantic query did not project the suffix-only chunk")
	}
	if latest, err := store.LatestIndexGeneration(ctx, seed.WorkspaceID, DimensionSemantic); err != nil || latest.ID != generation.ID {
		t.Fatalf("generation changed unexpectedly: %+v %v", latest, err)
	}
	// The ordinary lexical projection still contains the complete durable Note.
	_, lexicalHits, err := indexer.Query(ctx, QueryRequest{WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical, Text: "suffix-only-needle-9f2c7a"})
	if err != nil {
		t.Fatalf("lexical query: %v", err)
	}
	lexicalFound := false
	for _, hit := range lexicalHits {
		for _, segment := range hit.Segments {
			if segment.SourceID == annotationID && segment.MatchedText == oldBody {
				lexicalFound = true
			}
		}
	}
	if !lexicalFound {
		t.Fatal("lexical full-body Note projection changed")
	}
	if err := store.ReviseAnnotation(ctx, seed.WorkspaceID, annotationID, 2, newBody, true, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, _, err := indexer.Query(ctx, QueryRequest{WorkspaceID: seed.WorkspaceID, Dimension: DimensionSemantic, Text: "suffix-only-needle-9f2c7a"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("tombstoned Note query error=%v, want unavailable", err)
	}
}

func TestInvalidUTF8ShortNoteIsUnavailableAndNeverReencodedForEmbedding(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	annotationID := mustSearchID(t, sqlite.IDPrefixAnnotation)
	body := "invalid-" + string([]byte{0xff})
	if err := store.CreateAnnotation(ctx, &sqlite.Annotation{ID: annotationID, WorkspaceID: seed.WorkspaceID,
		SubjectRef: seed.FileEntryID, Kind: sqlite.AnnotationNote, Body: body, Revision: 1}); err != nil {
		t.Fatal(err)
	}
	manifest := testZvecManifest()
	provider := &recordingSemanticInputProvider{}
	indexer := &Indexer{Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: manifest.ConfigDigest,
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4), SemanticManifest: manifest,
		SemanticProvider: provider, SemanticZvec: &integrationSemanticGenerationDriver{},
		SemanticLibraryPath: "/private/explicit/libzvec_c_api.dylib", SemanticLibraryDigest: "sha256:" + strings.Repeat("0", 64)}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:invalid-note", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	for _, input := range provider.inputs {
		if input.DescriptionDocumentID == annotationID {
			t.Fatalf("invalid Note reached embedding provider: %+v", input)
		}
	}
	coverage, err := indexer.SemanticCoverage(ctx, seed.WorkspaceID)
	if err != nil || coverage.SourceCoverage == nil {
		t.Fatalf("coverage=%+v err=%v", coverage, err)
	}
	found := false
	for _, row := range coverage.SourceCoverage.Rows {
		if row.SourceRef == annotationID {
			found = row.Disposition == SemanticSourceUnavailable && row.Reason == SemanticSourceReasonSegmentSetInvalid
		}
	}
	if !found {
		t.Fatalf("invalid Note was not reported unavailable: %+v", coverage.SourceCoverage.Rows)
	}
}
