package search

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image"
	"image/color"
	"image/png"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/restoreweave/server/internal/store/sqlite"
	"github.com/ailiheizi/restoreweave/server/testutil"
)

// testImageSpaceFingerprint is the deterministic image space used by these
// tests. It is a real fingerprint shape; it is not a model and never claims to
// be one.
func testImageSpaceFingerprint() ImageSpaceFingerprint {
	return ImageSpaceFingerprint{
		Schema: ImageSpaceFingerprintSchemaV1, ModelID: "test/image-model", ModelVersion: "rev-1",
		Dimension: 4, ImageInput: "pixel_values:float32[1,3,2,2]",
		TextInput: "input_ids:int64[1,n]", QueryInstruction: "", Pooling: "projected-pooler",
		Normalization: "l2",
	}
}

func testImageManifest(configDigest string) EmbeddingGenerationManifest {
	fingerprint := testImageSpaceFingerprint()
	return EmbeddingGenerationManifest{
		RuntimeDigest: "runtime", ModelDigest: "vision+text", TokenizerDigest: "tokenizer",
		PreprocessingDigest: "sha256:" + strings.Repeat("1", 64), Pooling: fingerprint.Pooling,
		Normalization: fingerprint.Normalization, ElementType: "float32", Dimension: fingerprint.Dimension,
		VectorSchema: "float32:4", SemanticSpace: fingerprint.CanonicalDigest(), Distance: "cosine",
		IndexConfig: ZvecIndexConfigV1, QueryConfig: ZvecQueryConfigV1,
		ProviderDigest: "sha256:" + strings.Repeat("2", 64), ConfigDigest: configDigest,
	}
}

// testImageProvider is a deterministic in-package provider for the search
// contract. It produces vectors from a stable hash of the admitted input so
// tests can prove identity, fingerprint, and provenance wiring; it is test-only
// and is never wired into a production path.
type testImageProvider struct {
	fingerprint ImageSpaceFingerprint
	report      ImageProviderReport
	forceVector []float32
}

func (p *testImageProvider) ImageProviderReport() ImageProviderReport {
	report := p.report
	if report.Fingerprint.Validate() == nil {
		return report
	}
	report.Fingerprint = p.fingerprint
	return report
}

func (p *testImageProvider) EmbedImages(_ context.Context, req ImageEmbeddingRequest) ([]ImageEmbeddingVector, error) {
	if err := ValidateImageEmbeddingRequest(req); err != nil {
		return nil, err
	}
	results := make([]ImageEmbeddingVector, 0, len(req.Inputs))
	for _, input := range req.Inputs {
		vector := p.forceVector
		if vector == nil {
			seed := input.Text
			if req.Purpose == ImageEmbeddingImage {
				seed = input.ImageDigest
			}
			sum := sha256.Sum256([]byte(seed))
			vector = []float32{
				float32(sum[0]) + 1, float32(sum[1]) + 1, float32(sum[2]) + 1, float32(sum[3]) + 1,
			}
		}
		normalized, err := l2NormalizeForTest(vector)
		if err != nil {
			return nil, err
		}
		results = append(results, ImageEmbeddingVector{
			SubjectID: input.SubjectID, SegmentID: input.SegmentID,
			SpaceFingerprint: p.fingerprint.CanonicalDigest(), ProviderDigest: req.Manifest.ProviderDigest,
			Vector: normalized,
		})
	}
	if err := ValidateImageEmbeddingResults(req, results); err != nil {
		return nil, err
	}
	return results, nil
}

func l2NormalizeForTest(vector []float32) ([]float32, error) {
	var squared float64
	for _, value := range vector {
		squared += float64(value) * float64(value)
	}
	if squared == 0 {
		return nil, errors.New("zero vector")
	}
	norm := squared
	for i := 0; i < 60; i++ {
		norm = 0.5 * (norm + squared/norm)
	}
	out := make([]float32, len(vector))
	for i, value := range vector {
		out[i] = float32(float64(value) / norm)
	}
	return out, nil
}

// testImageContentSource serves deterministic PNG bytes for one admitted
// content id.
type testImageContentSource struct {
	contentID string
	bytes     []byte
	fail      bool
}

func (s *testImageContentSource) ReadImageContent(_ context.Context, contentID string) (ImageContent, error) {
	if s.fail {
		return ImageContent{}, errors.New("content unavailable")
	}
	if contentID != s.contentID {
		return ImageContent{}, errors.New("unknown content id")
	}
	return ImageContent{ContentID: s.contentID, MediaType: ImageMediaTypePNG, Bytes: append([]byte(nil), s.bytes...)}, nil
}

func testPNGBytes(t *testing.T) []byte {
	t.Helper()
	source := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			source.Set(x, y, color.NRGBA{R: uint8(16 * x), G: uint8(16 * y), B: 200, A: 255})
		}
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, source); err != nil {
		t.Fatalf("encode test png: %v", err)
	}
	return buffer.Bytes()
}

func testContentID(payload []byte) string {
	sum := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(sum[:])
}

// seedImageEntry ingests one image file through the same durable records the
// exact lane writes: an observation, its authoritative representation, the
// file version that carries the content identity, and the namespace entry that
// references that file version. The store deliberately refuses a regular file
// whose content identity is not bound to a file version, so the fixture must
// supply the complete chain instead of weakening the invariant.
func seedImageEntry(t *testing.T, store *sqlite.Store, seed *testutil.NamespaceSeed, displayName string, payload []byte) string {
	t.Helper()
	ctx := context.Background()
	contentID := testContentID(payload)
	size := int64(len(payload))
	entryID := mustSearchID(t, sqlite.IDPrefixNamespaceEntry)
	observationID := mustSearchID(t, sqlite.IDPrefixObservation)
	representationID := mustSearchID(t, sqlite.IDPrefixRepresentation)
	fileVersionID := mustSearchID(t, sqlite.IDPrefixFileVersion)
	if err := store.Update(ctx, func(tx *sqlite.Tx) error {
		if err := tx.InsertObservation(ctx, &sqlite.Observation{
			ID: observationID, WorkspaceID: seed.WorkspaceID, SourceID: seed.SourceID,
			ScanGenerationID: seed.ScanGenerationID, PathKey: []byte(displayName), RawPath: []byte(displayName),
			DisplayPath: displayName, EntryType: sqlite.EntryFile,
			ContentID: contentID, FileVersionID: fileVersionID, LogicalSize: &size, ReadState: "READ_OK",
		}); err != nil {
			return err
		}
		if err := tx.InsertRepresentation(ctx, &sqlite.Representation{
			ID: representationID, WorkspaceID: seed.WorkspaceID, ContentID: contentID,
			DecodedLength: size, OwnershipMode: sqlite.OwnershipEngineManaged,
			CodecProfileRef: "restic-stream/v1", AccessMode: sqlite.AccessSequentialStream,
			WholeReadRequiredToVerify: true, RecordDigest: "sha256:image-representation",
		}); err != nil {
			return err
		}
		if err := tx.InsertFileVersion(ctx, &sqlite.FileVersion{
			ID: fileVersionID, WorkspaceID: seed.WorkspaceID, ScanGenerationID: seed.ScanGenerationID,
			ObservationID: observationID, ContentID: contentID, LogicalSize: size,
			HashingProfile: "sha256-logical-zero-filled/v1", AuthoritativeRepresentationID: representationID,
			ExtentSetDigest: "sha256:image-extent-set", RecordDigest: "sha256:image-file-version",
		}); err != nil {
			return err
		}
		return tx.InsertNamespaceEntry(ctx, &sqlite.NamespaceEntry{
			ID: entryID, WorkspaceID: seed.WorkspaceID, RootID: seed.RootID,
			RawName: []byte(displayName), DisplayName: displayName,
			FullPathKey: []byte(displayName), EntryType: sqlite.EntryFile,
			ObservationID: observationID, ContentID: contentID, FileVersionID: fileVersionID, LogicalSize: &size,
		})
	}); err != nil {
		t.Fatalf("ingest image entry: %v", err)
	}
	return contentID
}

func TestImageSpaceFingerprintBindsEveryDeclaredFact(t *testing.T) {
	base := testImageSpaceFingerprint()
	if err := base.Validate(); err != nil {
		t.Fatalf("complete fingerprint rejected: %v", err)
	}
	digest := base.CanonicalDigest()
	if !strings.HasPrefix(digest, "sha256:") {
		t.Fatalf("fingerprint digest = %q", digest)
	}
	mutations := []struct {
		name   string
		mutate func(*ImageSpaceFingerprint)
	}{
		{"model id", func(f *ImageSpaceFingerprint) { f.ModelID = "other/model" }},
		{"model version", func(f *ImageSpaceFingerprint) { f.ModelVersion = "rev-2" }},
		{"dimension", func(f *ImageSpaceFingerprint) { f.Dimension = 8 }},
		{"image input", func(f *ImageSpaceFingerprint) { f.ImageInput = "pixel_values:float32[1,3,4,4]" }},
		{"text input", func(f *ImageSpaceFingerprint) { f.TextInput = "input_ids:int64[1,m]" }},
		{"instruction", func(f *ImageSpaceFingerprint) { f.QueryInstruction = "查询：" }},
		{"pooling", func(f *ImageSpaceFingerprint) { f.Pooling = "mean" }},
		{"normalization", func(f *ImageSpaceFingerprint) { f.Normalization = "none" }},
	}
	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			candidate := base
			mutation.mutate(&candidate)
			if candidate.CanonicalDigest() == digest {
				t.Fatalf("fingerprint digest did not change for %s", mutation.name)
			}
		})
	}
	incomplete := base
	incomplete.ModelID = ""
	if err := incomplete.Validate(); !errors.Is(err, ErrInvalidImageSpaceFingerprint) {
		t.Fatalf("incomplete fingerprint error = %v", err)
	}
	if got := incomplete.CanonicalDigest(); got != "" {
		t.Fatalf("incomplete fingerprint digest = %q, want empty", got)
	}
}

func TestImageResultUnderAnotherSpaceIsRefused(t *testing.T) {
	manifest := testImageManifest("sha256:config")
	fingerprint := testImageSpaceFingerprint()
	request := ImageEmbeddingRequest{
		Purpose: ImageEmbeddingImage, GenerationID: "gen", Manifest: manifest, Fingerprint: fingerprint,
		Inputs: []ImageEmbeddingInput{{
			SubjectID: "subj", SegmentID: "seg", MediaType: ImageMediaTypePNG,
			ImageDigest: "sha256:" + strings.Repeat("a", 64), ImageBytes: []byte("irrelevant"),
		}},
	}
	other := fingerprint
	other.ModelVersion = "rev-2"
	results := []ImageEmbeddingVector{{
		SubjectID: "subj", SegmentID: "seg", SpaceFingerprint: other.CanonicalDigest(),
		ProviderDigest: manifest.ProviderDigest, Vector: []float32{1, 0, 0, 0},
	}}
	if err := ValidateImageEmbeddingResults(request, results); !errors.Is(err, ErrImageSpaceFingerprintMismatch) {
		t.Fatalf("mismatched space error = %v, want ErrImageSpaceFingerprintMismatch", err)
	}
}

func TestImageDimensionReportsNotBuiltWithoutArtifact(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	indexer := &Indexer{Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:config"}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:image-not-built", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	state := indexer.ImageIndexState(ctx, seed.WorkspaceID)
	if state.State != ImageProviderNotBuilt || state.Reason != MultimodalIndexNotBuiltReason {
		t.Fatalf("image state = %+v, want NOT_BUILT with reason", state)
	}
	dimension, ok := LookupDimension(DimensionMultimodal, IndexerReadiness(indexer))
	if !ok || dimension.State != ImageProviderNotBuilt || dimension.Reason != MultimodalIndexNotBuiltReason {
		t.Fatalf("multimodal dimension = %+v ok=%v", dimension, ok)
	}
	if _, _, err := indexer.Query(ctx, QueryRequest{WorkspaceID: seed.WorkspaceID, Dimension: DimensionMultimodal, Text: "photo"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("multimodal query error = %v, want ErrUnavailable", err)
	}
	// The lexical lane is unchanged and still answers. The probe uses a token
	// the seeded corpus actually carries: the seeded filename is
	// "\xfftrack.flac", whose FTS5 unicode61 tokens are "xfftrack" and "flac".
	if _, hits, err := indexer.Query(ctx, QueryRequest{WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical, Text: "flac"}); err != nil || len(hits) == 0 {
		t.Fatalf("lexical query after absent image model: hits=%d err=%v", len(hits), err)
	}
}

func TestImageDimensionReportsUnavailableForBrokenArtifact(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	manifest := testImageManifest("sha256:config")
	provider := &testImageProvider{
		fingerprint: testImageSpaceFingerprint(),
		report: ImageProviderReport{
			State: ImageProviderUnavailable, Reason: "vision graph admission failed",
			Artifact: "test/image-model@rev-1", Fingerprint: testImageSpaceFingerprint(),
		},
	}
	indexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:config",
		MultimodalManifest: manifest, MultimodalProfileDigest: manifest.CanonicalDigest(),
		ImageProvider: provider, ImageZvec: &integrationSemanticGenerationDriver{},
		ImageSource:      &testImageContentSource{},
		ImageLibraryPath: "/private/explicit/libzvec_c_api.dylib", ImageLibraryDigest: "sha256:" + strings.Repeat("0", 64),
	}
	state := indexer.ImageIndexState(ctx, seed.WorkspaceID)
	if state.State != ImageProviderUnavailable || !strings.Contains(state.Reason, "vision graph admission failed") {
		t.Fatalf("image state = %+v, want UNAVAILABLE with provider reason", state)
	}
	dimension, _ := LookupDimension(DimensionMultimodal, IndexerReadiness(indexer))
	if dimension.State != ImageProviderUnavailable || dimension.Reason == "" {
		t.Fatalf("multimodal dimension = %+v, want UNAVAILABLE with reason", dimension)
	}
	// A rebuild still produces the lexical generation; the image branch failure
	// is reported, not fatal.
	generation, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:image-unavailable", seed.RootID)
	if err != nil || generation.ID == "" {
		t.Fatalf("rebuild with broken image artifact: generation=%+v err=%v", generation, err)
	}
	if indexer.ImageFailure() == "" {
		t.Fatal("broken image artifact left no recorded failure")
	}
}

func TestImageRebuildEmbedsAdmittedContentAndQueryUsesOwnTower(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	payload := testPNGBytes(t)
	contentID := seedImageEntry(t, store, seed, "photo.png", payload)
	manifest := testImageManifest("sha256:config")
	fingerprint := testImageSpaceFingerprint()
	provider := &testImageProvider{
		fingerprint: fingerprint,
		report: ImageProviderReport{
			State: ImageProviderReady, Artifact: "test/image-model@rev-1",
			ProviderDigest: manifest.ProviderDigest, Fingerprint: fingerprint,
		},
	}
	indexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:config",
		MultimodalManifest: manifest, MultimodalProfileDigest: manifest.CanonicalDigest(),
		ImageProvider: provider, ImageZvec: &integrationSemanticGenerationDriver{},
		ImageSource:      &testImageContentSource{contentID: contentID, bytes: payload},
		ImageLibraryPath: "/private/explicit/libzvec_c_api.dylib", ImageLibraryDigest: "sha256:" + strings.Repeat("0", 64),
	}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:image-ready", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	generation, err := store.LatestIndexGeneration(ctx, seed.WorkspaceID, DimensionMultimodal)
	if err != nil {
		t.Fatalf("latest image generation: %v", err)
	}
	if generation.SemanticSpace != fingerprint.CanonicalDigest() {
		t.Fatalf("generation space = %q, want the fingerprint digest %q", generation.SemanticSpace, fingerprint.CanonicalDigest())
	}
	if generation.ProviderProfileDigest != manifest.CanonicalDigest() {
		t.Fatalf("generation provider digest = %q, want the manifest digest", generation.ProviderProfileDigest)
	}
	// The generation receipt records the complete fingerprint beside the
	// semantic-space field so a later reader can prove the space.
	identities, _, _, err := readImageGenerationReceipt(generation)
	if err != nil {
		t.Fatalf("image receipt: %v", err)
	}
	if len(identities) != 1 || identities[0].SubjectID == "" {
		t.Fatalf("image receipt identities = %+v", identities)
	}
	state := indexer.ImageIndexState(ctx, seed.WorkspaceID)
	if state.State != ImageProviderReady || state.GenerationID != generation.ID {
		t.Fatalf("image state = %+v, want READY for generation %s", state, generation.ID)
	}
	_, hits, err := indexer.Query(ctx, QueryRequest{WorkspaceID: seed.WorkspaceID, Dimension: DimensionMultimodal, Text: "a photo"})
	if err != nil {
		t.Fatalf("image query: %v", err)
	}
	if len(hits) != 1 || hits[0].SubjectID != identities[0].SubjectID {
		t.Fatalf("image hits = %+v", hits)
	}
	if len(hits[0].Segments) != 1 || hits[0].Segments[0].SourceType != "IMAGE" || hits[0].Segments[0].MatchedText != "photo.png" {
		t.Fatalf("image hit provenance = %+v", hits[0].Segments)
	}
}

func TestImageQueryRefusesGenerationFromAnotherSpace(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	payload := testPNGBytes(t)
	contentID := seedImageEntry(t, store, seed, "photo.png", payload)
	manifest := testImageManifest("sha256:config")
	fingerprint := testImageSpaceFingerprint()
	provider := &testImageProvider{
		fingerprint: fingerprint,
		report: ImageProviderReport{
			State: ImageProviderReady, Artifact: "test/image-model@rev-1",
			ProviderDigest: manifest.ProviderDigest, Fingerprint: fingerprint,
		},
	}
	driver := &integrationSemanticGenerationDriver{}
	indexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:config",
		MultimodalManifest: manifest, MultimodalProfileDigest: manifest.CanonicalDigest(),
		ImageProvider: provider, ImageZvec: driver,
		ImageSource:      &testImageContentSource{contentID: contentID, bytes: payload},
		ImageLibraryPath: "/private/explicit/libzvec_c_api.dylib", ImageLibraryDigest: "sha256:" + strings.Repeat("0", 64),
	}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:image-space-mismatch", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	generation, err := store.LatestIndexGeneration(ctx, seed.WorkspaceID, DimensionMultimodal)
	if err != nil {
		t.Fatalf("latest image generation: %v", err)
	}
	if generation.SemanticSpace != fingerprint.CanonicalDigest() {
		t.Fatalf("generation space = %q, want %q", generation.SemanticSpace, fingerprint.CanonicalDigest())
	}
	// Reconfigure the process with a different space (a new model version is a
	// new space). The query vector would be produced under the new fingerprint,
	// so it must be refused before any scoring instead of being compared with
	// the old generation's vectors.
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
	_, hits, err := indexer.Query(ctx, QueryRequest{WorkspaceID: seed.WorkspaceID, Dimension: DimensionMultimodal, Text: "photo"})
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("cross-space query error = %v, want ErrUnavailable", err)
	}
	if len(hits) != 0 {
		t.Fatalf("cross-space query returned %d hits, want none", len(hits))
	}
	state := indexer.ImageIndexState(ctx, seed.WorkspaceID)
	if state.State == ImageProviderReady {
		t.Fatalf("cross-space generation still reported READY: %+v", state)
	}
	if state.Reason != MultimodalSpaceMismatchReason {
		t.Fatalf("cross-space state reason = %q, want %s", state.Reason, MultimodalSpaceMismatchReason)
	}
	if reason := QueryFailureReason(DimensionMultimodal, err); reason != MultimodalSpaceMismatchReason {
		t.Fatalf("query failure reason = %q, want %s", reason, MultimodalSpaceMismatchReason)
	}
}

func TestFixtureMultimodalProviderIsQuarantinedByRealBinding(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	manifest := testImageManifest("sha256:config")
	indexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:config",
		EnableFixtureDimensions: true,
		MultimodalManifest:      manifest, MultimodalProfileDigest: manifest.CanonicalDigest(),
	}
	if indexer.fixtureDimensionsActive() {
		t.Fatal("fixture dimensions stayed active beside a real image binding")
	}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:image-quarantine", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	if _, err := store.LatestIndexGeneration(ctx, seed.WorkspaceID, DimensionMultimodal); !errors.Is(err, sqlite.ErrNotFound) {
		t.Fatalf("fixture image generation was built beside a real binding: err=%v", err)
	}
	state := indexer.ImageIndexState(ctx, seed.WorkspaceID)
	if state.State != ImageProviderNotBuilt {
		t.Fatalf("image state = %+v, want NOT_BUILT", state)
	}
	if strings.Contains(strings.ToLower(state.Notes), "fixture") && state.State == ImageProviderReady {
		t.Fatal("fixture projection was reported as a ready image model")
	}
	// The qualification fixture remains usable when no real binding exists.
	fixtureIndexer := &Indexer{Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:fixture", EnableFixtureDimensions: true}
	if !fixtureIndexer.fixtureDimensionsActive() {
		t.Fatal("fixture dimensions were not active without a real binding")
	}
}

func TestFusionIncludesImageOnlyWhenReadyAndReportsPerComponentStatus(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	payload := testPNGBytes(t)
	contentID := seedImageEntry(t, store, seed, "photo.png", payload)
	manifest := testImageManifest("sha256:config")
	fingerprint := testImageSpaceFingerprint()
	provider := &testImageProvider{
		fingerprint: fingerprint,
		report: ImageProviderReport{
			State: ImageProviderReady, Artifact: "test/image-model@rev-1",
			ProviderDigest: manifest.ProviderDigest, Fingerprint: fingerprint,
		},
	}
	indexer := &Indexer{Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:config"}
	// Text-only behavior: the default broker never includes the image
	// dimension when no image generation is ready.
	if dims := DefaultFuseDimensions(IndexerReadiness(indexer)); len(dims) != 2 || dims[1] != DimensionSemantic {
		t.Fatalf("default fuse dimensions without image generation = %v", dims)
	}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:image-fusion", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	// Requesting the image dimension explicitly before any artifact exists must
	// report NOT_BUILT with its reason and must not disturb the other
	// components.
	fused, err := indexer.Fuse(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, Text: "photo",
		Fuse: []string{DimensionLexical, DimensionMultimodal},
	})
	if err != nil {
		t.Fatalf("fuse: %v", err)
	}
	if len(fused.Components) != 2 {
		t.Fatalf("components = %+v", fused.Components)
	}
	multimodal := fused.Components[1]
	if multimodal.Dimension != DimensionMultimodal || multimodal.Status != ImageProviderNotBuilt || multimodal.Reason != MultimodalIndexNotBuiltReason {
		t.Fatalf("multimodal component = %+v, want NOT_BUILT with reason", multimodal)
	}
	if fused.Components[0].Status != "SUCCEEDED" || fused.Components[0].Hits == 0 {
		t.Fatalf("lexical component = %+v, want SUCCEEDED with hits", fused.Components[0])
	}
	// Once the image generation is ready, the default broker includes it and
	// the component succeeds through its own provider.
	indexer.ImageProvider = provider
	indexer.ImageZvec = &integrationSemanticGenerationDriver{}
	indexer.ImageSource = &testImageContentSource{contentID: contentID, bytes: payload}
	indexer.ImageLibraryPath = "/private/explicit/libzvec_c_api.dylib"
	indexer.ImageLibraryDigest = "sha256:" + strings.Repeat("0", 64)
	indexer.MultimodalManifest = manifest
	indexer.MultimodalProfileDigest = manifest.CanonicalDigest()
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:image-fusion-ready", seed.RootID); err != nil {
		t.Fatalf("rebuild with image provider: %v", err)
	}
	dims := DefaultFuseDimensions(IndexerReadiness(indexer))
	if len(dims) != 3 || dims[2] != DimensionMultimodal {
		t.Fatalf("default fuse dimensions with ready image generation = %v", dims)
	}
	fused, err = indexer.Fuse(ctx, QueryRequest{WorkspaceID: seed.WorkspaceID, Text: "photo", Fuse: dims})
	if err != nil {
		t.Fatalf("fuse with image: %v", err)
	}
	var imageComponent *Component
	for i := range fused.Components {
		if fused.Components[i].Dimension == DimensionMultimodal {
			imageComponent = &fused.Components[i]
		}
	}
	if imageComponent == nil || imageComponent.Status != "SUCCEEDED" || imageComponent.Provider != ProviderMultimodalONNX ||
		imageComponent.ScoreSemantics != ScoreMultimodalCosine || imageComponent.GenerationID == "" {
		t.Fatalf("ready image component = %+v", imageComponent)
	}
}
