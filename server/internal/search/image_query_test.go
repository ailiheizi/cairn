package search

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

// readyImageQueryIndexer builds one indexer with the test image binding,
// seeded workspace, and one admitted png entry, ready for a rebuild.
func readyImageQueryIndexer(t *testing.T, store *sqlite.Store, seed *testutil.NamespaceSeed, contentID string, payload []byte) *Indexer {
	t.Helper()
	manifest := testImageManifest("sha256:config")
	fingerprint := testImageSpaceFingerprint()
	provider := &testImageProvider{
		fingerprint: fingerprint,
		report: ImageProviderReport{
			State: ImageProviderReady, Artifact: "test/image-model@rev-1",
			ProviderDigest: manifest.ProviderDigest, Fingerprint: fingerprint,
		},
	}
	return &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:config",
		MultimodalManifest: manifest, MultimodalProfileDigest: manifest.CanonicalDigest(),
		ImageProvider: provider, ImageZvec: &integrationSemanticGenerationDriver{},
		ImageSource:      &testImageContentSource{contentID: contentID, bytes: payload},
		ImageLibraryPath: "/private/explicit/libzvec_c_api.dylib", ImageLibraryDigest: "sha256:" + strings.Repeat("0", 64),
	}
}

// readyImageAndSemanticQueryIndexer additionally wires the real-shaped
// semantic lane over one seeded durable segment, so both vector dimensions
// report AVAILABLE after one rebuild.
func readyImageAndSemanticQueryIndexer(t *testing.T, store *sqlite.Store, seed *testutil.NamespaceSeed, contentID string, payload []byte) *Indexer {
	t.Helper()
	ctx := context.Background()
	descriptionID := mustSearchID(t, sqlite.IDPrefixDescription)
	segmentID := mustSearchID(t, sqlite.IDPrefixSemanticSegment)
	if err := store.InsertDescriptionDocument(ctx, &sqlite.DescriptionDocument{
		ID: descriptionID, WorkspaceID: seed.WorkspaceID, SubjectRef: seed.FileEntryID,
		Kind: sqlite.DescriptionUser, Title: "Recovery note", Language: "en",
		Body: "A flooded city archive is ready for recovery.", SourceRef: "user:test",
		ProducerProfile: "human", Accepted: true,
	}); err != nil {
		t.Fatalf("insert description: %v", err)
	}
	if err := store.InsertSemanticSegment(ctx, &sqlite.SemanticSegment{
		ID: segmentID, WorkspaceID: seed.WorkspaceID, DocumentID: descriptionID,
		SubjectRef: seed.FileEntryID, Ordinal: 0,
		Text: "A flooded city archive is ready for recovery.", Language: "en", Section: "body",
	}); err != nil {
		t.Fatalf("insert semantic segment: %v", err)
	}
	indexer := readyImageQueryIndexer(t, store, seed, contentID, payload)
	semanticManifest := testZvecManifest()
	// The manifest binds the same host config digest the indexer records, so
	// the lexical/semantic generation bindings match exactly as daemon wiring
	// produces them.
	semanticManifest.ConfigDigest = indexer.ConfigDigest
	indexer.LexicalProfileDigest = ProfileDigest(DimensionLexical, LexicalProfileV4)
	indexer.SemanticManifest = semanticManifest
	indexer.SemanticProvider = integrationSemanticProvider{}
	indexer.SemanticZvec = &integrationSemanticGenerationDriver{}
	indexer.SemanticLibraryPath = "/private/explicit/libzvec_c_api.dylib"
	indexer.SemanticLibraryDigest = "sha256:" + strings.Repeat("0", 64)
	return indexer
}

func TestImageOnlyFusedQueryRunsMultimodalAndSkipsTextDimensions(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, t.TempDir()+"/catalog.sqlite")
	seed := testutil.SeedNamespace(t, store)
	payload := testPNGBytes(t)
	contentID := seedImageEntry(t, store, seed, "photo.png", payload)
	indexer := readyImageAndSemanticQueryIndexer(t, store, seed, contentID, payload)
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:image-query-fused", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	readiness := IndexerReadiness(indexer)
	if !readiness.MultimodalReal || !readiness.SemanticReal {
		t.Fatalf("readiness = %+v, want both real vector dimensions ready", readiness)
	}
	dims := DefaultFuseDimensions(IndexerReadiness(indexer))
	if len(dims) != 3 || dims[2] != DimensionMultimodal {
		t.Fatalf("default fuse dimensions = %v, want the ready image dimension included", dims)
	}
	// The image-only request carries no text and no filters. The text
	// dimensions have no material for it and are skipped with the stable
	// reason; the image dimension runs through the vision tower of the same
	// admitted space.
	fused, err := indexer.Fuse(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID,
		Fuse:        dims,
		ImageQuery: &ImageQueryInput{
			MediaType: ImageMediaTypePNG, Digest: contentID, Bytes: append([]byte(nil), payload...),
		},
	})
	if err != nil {
		t.Fatalf("image-only fuse: %v", err)
	}
	if len(fused.Components) != 3 {
		t.Fatalf("components = %+v", fused.Components)
	}
	for _, component := range fused.Components[:2] {
		if component.Dimension != DimensionLexical && component.Dimension != DimensionSemantic {
			t.Fatalf("unexpected component order = %+v", fused.Components)
		}
		if component.Status != ComponentSkipped || component.Reason != QueryTextRequiredReason {
			t.Fatalf("%s component = %+v, want SKIPPED with %s", component.Dimension, component, QueryTextRequiredReason)
		}
	}
	image := fused.Components[2]
	if image.Dimension != DimensionMultimodal || image.Status != "SUCCEEDED" || image.Hits == 0 || image.GenerationID == "" {
		t.Fatalf("image component = %+v, want SUCCEEDED with hits", image)
	}
	if !FuseSucceeded(fused) || len(fused.Hits) == 0 {
		t.Fatalf("fused result = %+v, want image hits", fused)
	}
	// The hit provenance is the IMAGE segment of the matching subject, ranked
	// by the vision-tower vector of the identical bytes.
	if fused.Hits[0].Segments[0].SourceType != "IMAGE" || fused.Hits[0].Segments[0].Kind != "IMAGE" ||
		fused.Hits[0].Segments[0].MatchedText != "photo.png" {
		t.Fatalf("image hit provenance = %+v", fused.Hits[0].Segments)
	}
	if !IndexerReadiness(indexer).MultimodalReal {
		t.Fatal("an image-only query revoked the ready image generation")
	}
}

func TestImageOnlyQueryRefusesGenerationFromAnotherSpace(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, t.TempDir()+"/catalog.sqlite")
	seed := testutil.SeedNamespace(t, store)
	payload := testPNGBytes(t)
	contentID := seedImageEntry(t, store, seed, "photo.png", payload)
	indexer := readyImageQueryIndexer(t, store, seed, contentID, payload)
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:image-query-space", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	// Reconfigure the process with a different space. The vision-tower query
	// vector would be produced under the new fingerprint, so the request is
	// refused before any scoring, exactly like the text-tower path.
	fingerprint := testImageSpaceFingerprint()
	otherFingerprint := fingerprint
	otherFingerprint.ModelVersion = "rev-2"
	otherManifest := testImageManifest("sha256:config")
	otherManifest.SemanticSpace = otherFingerprint.CanonicalDigest()
	otherProvider := &testImageProvider{
		fingerprint: otherFingerprint,
		report: ImageProviderReport{
			State: ImageProviderReady, Artifact: "test/image-model@rev-2",
			ProviderDigest: otherManifest.ProviderDigest, Fingerprint: otherFingerprint,
		},
	}
	indexer.ImageProvider = otherProvider
	indexer.MultimodalManifest = otherManifest
	indexer.MultimodalProfileDigest = otherManifest.CanonicalDigest()
	_, hits, err := indexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, Dimension: DimensionMultimodal,
		ImageQuery: &ImageQueryInput{MediaType: ImageMediaTypePNG, Digest: contentID, Bytes: payload},
	})
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("cross-space image query error = %v, want ErrUnavailable", err)
	}
	if len(hits) != 0 {
		t.Fatalf("cross-space image query returned %d hits, want none", len(hits))
	}
	if reason := QueryFailureReason(DimensionMultimodal, err); reason != MultimodalSpaceMismatchReason {
		t.Fatalf("query failure reason = %q, want %s", reason, MultimodalSpaceMismatchReason)
	}
	if state := indexer.ImageIndexState(ctx, seed.WorkspaceID); state.Reason != MultimodalSpaceMismatchReason {
		t.Fatalf("cross-space state reason = %q, want %s", state.Reason, MultimodalSpaceMismatchReason)
	}
}

func TestImageQueryInputErrorsDoNotRevokeVerifiedGeneration(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, t.TempDir()+"/catalog.sqlite")
	seed := testutil.SeedNamespace(t, store)
	payload := testPNGBytes(t)
	contentID := seedImageEntry(t, store, seed, "photo.png", payload)
	indexer := readyImageQueryIndexer(t, store, seed, contentID, payload)
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:image-query-input", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	inputs := []struct {
		name  string
		query QueryRequest
	}{
		{
			name:  "digest does not match the bytes",
			query: QueryRequest{WorkspaceID: seed.WorkspaceID, Dimension: DimensionMultimodal, ImageQuery: &ImageQueryInput{MediaType: ImageMediaTypePNG, Digest: testContentID([]byte("other")), Bytes: payload}},
		},
		{
			name:  "media type is not admitted",
			query: QueryRequest{WorkspaceID: seed.WorkspaceID, Dimension: DimensionMultimodal, ImageQuery: &ImageQueryInput{MediaType: "image/gif", Digest: contentID, Bytes: payload}},
		},
		{
			name:  "bytes are empty",
			query: QueryRequest{WorkspaceID: seed.WorkspaceID, Dimension: DimensionMultimodal, ImageQuery: &ImageQueryInput{MediaType: ImageMediaTypePNG, Digest: contentID}},
		},
		{
			name:  "bytes exceed the admitted bound",
			query: QueryRequest{WorkspaceID: seed.WorkspaceID, Dimension: DimensionMultimodal, ImageQuery: &ImageQueryInput{MediaType: ImageMediaTypePNG, Digest: contentID, Bytes: make([]byte, MaxImageEmbeddingInputBytes+1)}},
		},
		{
			name:  "text and image cannot be combined",
			query: QueryRequest{WorkspaceID: seed.WorkspaceID, Dimension: DimensionMultimodal, Text: "a photo", ImageQuery: &ImageQueryInput{MediaType: ImageMediaTypePNG, Digest: contentID, Bytes: payload}},
		},
	}
	for _, input := range inputs {
		_, hits, err := indexer.Query(ctx, input.query)
		if !errors.Is(err, ErrInvalidQuery) {
			t.Fatalf("%s: error = %v, want ErrInvalidQuery", input.name, err)
		}
		if len(hits) != 0 {
			t.Fatalf("%s: returned %d hits, want none", input.name, len(hits))
		}
		if !IndexerReadiness(indexer).MultimodalReal {
			t.Fatalf("%s: the caller input error revoked the verified generation", input.name)
		}
	}
	// The verified generation still serves a valid image query afterwards.
	fused, err := indexer.Fuse(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID,
		Fuse:        []string{DimensionLexical, DimensionMultimodal},
		ImageQuery:  &ImageQueryInput{MediaType: ImageMediaTypePNG, Digest: contentID, Bytes: payload},
	})
	if err != nil {
		t.Fatalf("valid image query after input errors: %v", err)
	}
	if image := fused.Components[1]; image.Status != "SUCCEEDED" || image.Hits == 0 {
		t.Fatalf("image component after input errors = %+v", image)
	}
}

func TestImageQueryInputValidateRejectsBadMaterial(t *testing.T) {
	payload := testPNGBytes(t)
	valid := ImageQueryInput{MediaType: ImageMediaTypePNG, Digest: testContentID(payload), Bytes: payload}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid query image rejected: %v", err)
	}
	if err := (ImageQueryInput{MediaType: "image/webp", Digest: valid.Digest, Bytes: payload}).Validate(); err == nil ||
		!strings.Contains(err.Error(), "not admitted") {
		t.Fatalf("unadmitted media type error = %v", err)
	}
	if err := (ImageQueryInput{MediaType: ImageMediaTypePNG, Digest: valid.Digest, Bytes: nil}).Validate(); err == nil ||
		!strings.Contains(err.Error(), "empty") {
		t.Fatalf("empty bytes error = %v", err)
	}
	if err := (ImageQueryInput{MediaType: ImageMediaTypePNG, Digest: valid.Digest, Bytes: make([]byte, MaxImageEmbeddingInputBytes+1)}).Validate(); err == nil ||
		!strings.Contains(err.Error(), "bound") {
		t.Fatalf("oversized bytes error = %v", err)
	}
	if err := (ImageQueryInput{MediaType: ImageMediaTypePNG, Digest: "sha256:deadbeef", Bytes: payload}).Validate(); err == nil ||
		!strings.Contains(err.Error(), "digest does not match") {
		t.Fatalf("mismatched digest error = %v", err)
	}
}

func TestTextFusedQueryBehaviorIsUnchangedByImageQuerySupport(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, t.TempDir()+"/catalog.sqlite")
	seed := testutil.SeedNamespace(t, store)
	payload := testPNGBytes(t)
	contentID := seedImageEntry(t, store, seed, "photo.png", payload)
	indexer := readyImageAndSemanticQueryIndexer(t, store, seed, contentID, payload)
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:image-query-text", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	// A text query through the same fused pipeline is unchanged: every
	// dimension answers, the image dimension through its own text tower.
	fused, err := indexer.Fuse(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID,
		Text:        "photo",
		Filters:     Filters{MediaClass: "image"},
		Fuse:        []string{DimensionLexical, DimensionSemantic, DimensionMultimodal},
	})
	if err != nil {
		t.Fatalf("text query: %v", err)
	}
	if len(fused.Components) != 3 {
		t.Fatalf("components = %+v", fused.Components)
	}
	for _, component := range fused.Components {
		if component.Status != "SUCCEEDED" {
			t.Fatalf("%s component = %+v, want SUCCEEDED for a text query", component.Dimension, component)
		}
	}
	// A filter-only browse is unchanged too: the vector spaces stay skipped
	// with their reason and the lexical dimension answers the browse.
	fused, err = indexer.Fuse(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID,
		Filters:     Filters{MediaClass: "image"},
		Fuse:        []string{DimensionLexical, DimensionSemantic, DimensionMultimodal},
	})
	if err != nil {
		t.Fatalf("filter-only query: %v", err)
	}
	if fused.Components[0].Status != "SUCCEEDED" {
		t.Fatalf("lexical component = %+v, want SUCCEEDED", fused.Components[0])
	}
	for _, component := range fused.Components[1:] {
		if component.Status != ComponentSkipped || component.Reason != QueryTextRequiredReason {
			t.Fatalf("%s component = %+v, want SKIPPED with %s", component.Dimension, component, QueryTextRequiredReason)
		}
	}
	if !IndexerReadiness(indexer).MultimodalReal {
		t.Fatal("a text or filter-only query revoked the ready image generation")
	}
	_ = contentID
}
