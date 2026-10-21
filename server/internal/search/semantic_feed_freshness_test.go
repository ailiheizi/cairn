package search

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

func TestSemanticFeedFreshnessMatchesActualBuiltInventory(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	noteID := mustSearchID(t, sqlite.IDPrefixAnnotation)
	if err := store.CreateAnnotation(ctx, &sqlite.Annotation{ID: noteID, WorkspaceID: seed.WorkspaceID,
		SubjectRef: seed.FileEntryID, Kind: sqlite.AnnotationNote, Body: "current note source", Revision: 1}); err != nil {
		t.Fatal(err)
	}
	tagID := mustSearchID(t, sqlite.IDPrefixAnnotation)
	if err := store.CreateAnnotation(ctx, &sqlite.Annotation{ID: tagID, WorkspaceID: seed.WorkspaceID,
		SubjectRef: seed.FileEntryID, Kind: sqlite.AnnotationTag, Body: "current tag", Revision: 1}); err != nil {
		t.Fatal(err)
	}
	descriptionID := mustSearchID(t, sqlite.IDPrefixDescription)
	segmentID := mustSearchID(t, sqlite.IDPrefixSemanticSegment)
	descriptionBody := "current imported description"
	description := sqlite.DescriptionDocument{ID: descriptionID, WorkspaceID: seed.WorkspaceID, SubjectRef: seed.FileEntryID,
		Kind: sqlite.DescriptionImported, Body: descriptionBody, SourceRef: "test:import", Accepted: true, Revision: 1}
	if err := store.InsertDescriptionDocument(ctx, &description); err != nil {
		t.Fatal(err)
	}
	span, _ := json.Marshal(descriptionSourceSpan{StartByte: 0, EndByte: len(descriptionBody)})
	if err := store.InsertSemanticSegment(ctx, &sqlite.SemanticSegment{ID: segmentID, WorkspaceID: seed.WorkspaceID,
		DocumentID: descriptionID, DocumentRevision: 1, SubjectRef: seed.FileEntryID, Ordinal: 0, Text: descriptionBody,
		TextDigest: sha256Text(descriptionBody), SegmentationProfileDigest: sqlite.DescriptionSegmentationProfileDigestV1,
		SourceSpan: span}); err != nil {
		t.Fatal(err)
	}
	attemptID := mustSearchID(t, sqlite.IDPrefixAttempt)
	artifactID := mustSearchID(t, sqlite.IDPrefixArtifact)
	extractBody := "current admitted extract"
	extractDigest := sha256.Sum256([]byte(extractBody))
	if err := store.InsertProcessorAttempt(ctx, &sqlite.ProcessorAttempt{ID: attemptID, WorkspaceID: seed.WorkspaceID,
		SubjectRef: seed.FileEntryID, SnapshotRef: "snapshot:extract", RouteDigest: "sha256:extract-route",
		Route: json.RawMessage(`{"capability":"extract.text.v1"}`), Stage: "EXTRACT", CapabilityID: "extract.text.v1",
		Status: "SUCCEEDED", ReasonCode: "ADMITTED_ARTIFACT", Provenance: json.RawMessage(`{}`), FenceToken: 1,
		ProcessorDigest: "sha256:extract-producer"}); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertProcessorArtifact(ctx, &sqlite.ProcessorArtifact{ID: artifactID, WorkspaceID: seed.WorkspaceID,
		SubjectRef: seed.FileEntryID, SnapshotRef: "snapshot:extract", RouteDigest: "sha256:extract-route",
		Stage: "EXTRACT", CapabilityID: "extract.text.v1", SchemaRef: "text/plain:v1", State: sqlite.ArtifactAdmitted,
		AuthorityClass: "STAGED_ARTIFACT", LifecycleClass: "DURABLE", MediaType: "text/plain", ByteLength: int64(len(extractBody)),
		Digest: "sha256:" + hex.EncodeToString(extractDigest[:]), Body: extractBody, AttemptID: attemptID, FenceToken: 1,
		ProducerDigest: "sha256:extract-producer", Envelope: json.RawMessage(`{"source":"test"}`)}); err != nil {
		t.Fatal(err)
	}
	manifest := testZvecManifest()
	manifest.SemanticSpace = SemanticBundleBGESemanticSpace
	indexer := &Indexer{Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: manifest.ConfigDigest,
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4), SemanticManifest: manifest,
		SemanticProvider: integrationSemanticProvider{}, SemanticZvec: &integrationSemanticGenerationDriver{},
		SemanticLibraryPath: "/private/explicit/libzvec_c_api.dylib", SemanticLibraryDigest: "sha256:" + strings.Repeat("0", 64)}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:semantic-feed-freshness", seed.RootID); err != nil {
		t.Fatalf("build four-family semantic feed: %v", err)
	}
	semantic, err := store.LatestIndexGeneration(ctx, seed.WorkspaceID, DimensionSemantic)
	if err != nil {
		t.Fatal(err)
	}
	lexical, err := store.LatestIndexGeneration(ctx, seed.WorkspaceID, DimensionLexical)
	if err != nil {
		t.Fatal(err)
	}
	if err := indexer.semanticGenerationMatchesCurrentFeed(ctx, semantic, lexical); err != nil {
		t.Fatalf("fresh inventory built from Note/Description/Extract/Filename should match current durable sources: %v", err)
	}
	if err := store.CreateAnnotation(ctx, &sqlite.Annotation{ID: mustSearchID(t, sqlite.IDPrefixAnnotation), WorkspaceID: seed.WorkspaceID,
		SubjectRef: seed.FileEntryID, Kind: sqlite.AnnotationTag, Body: "another tag", Revision: 1}); err != nil {
		t.Fatal(err)
	}
	if err := indexer.semanticGenerationMatchesCurrentFeed(ctx, semantic, lexical); err != nil {
		t.Fatalf("TAG-only catalog change should not stale selected semantic feed: %v", err)
	}
	if err := store.ReviseAnnotation(ctx, seed.WorkspaceID, noteID, 1, "revised note source", false, time.Now()); err != nil {
		t.Fatal(err)
	}
	restarted := &Indexer{Store: store, ConfigDigest: manifest.ConfigDigest,
		LexicalProfileDigest: indexer.LexicalProfileDigest, SemanticManifest: manifest}
	if err := restarted.semanticGenerationMatchesCurrentFeed(ctx, semantic, lexical); err == nil {
		t.Fatal("reconstructed indexer accepted old receipt after durable Note revision")
	}
}

func TestSemanticFeedIdentityComparisonTracksCurrentSourcesAndIgnoresTags(t *testing.T) {
	rows := []semanticSourceInventoryRow{
		{SubjectID: "s", SourceKind: "NOTE", SourceRef: "note", Revision: "2", BodyDigest: "note-digest", BodyLength: 9, Disposition: SemanticSourceIndexed},
		{SubjectID: "s", SourceKind: "EXTRACT", SourceRef: "extract", Revision: "extract", BodyDigest: "extract-digest", BodyLength: 12, Disposition: SemanticSourceIndexed, SegmentationProfileDigest: semanticTextSourceSegmentationProfileDigest},
		{SubjectID: "s", SourceKind: "FILENAME", SourceRef: "entry", Revision: "entry", BodyDigest: "name-digest", BodyLength: 8, Disposition: SemanticSourceIndexed},
		{SubjectID: "s", SourceKind: "DESCRIPTION", SourceSubtype: "AI_SUMMARY", SourceRef: "accepted", Revision: "3", BodyDigest: "description-digest", BodyLength: 17, Disposition: SemanticSourceIndexed},
		{SubjectID: "s", SourceKind: "DESCRIPTION", SourceSubtype: "AI_SUMMARY", SourceRef: "rejected", Revision: "1", BodyDigest: "rejected-digest", BodyLength: 10, Disposition: SemanticSourceExcluded, Reason: SemanticSourceReasonDescriptionRejected},
		{SubjectID: "s", SourceKind: "TAG", SourceRef: "tag", Revision: "7", BodyDigest: "old-tag", BodyLength: 3, Disposition: SemanticSourceExcluded, Reason: SemanticSourceReasonTag},
	}
	current := map[string]semanticFeedIdentity{}
	for _, row := range rows {
		if row.SourceKind == "TAG" {
			continue
		}
		identity := semanticFeedIdentity{SubjectID: row.SubjectID, SourceKind: row.SourceKind, SourceSubtype: row.SourceSubtype,
			SourceRef: row.SourceRef, Revision: row.Revision, BodyDigest: row.BodyDigest, BodyLength: row.BodyLength,
			SegmentationProfileDigest: row.SegmentationProfileDigest, Selected: row.SourceKind != "DESCRIPTION" || row.SourceRef == "accepted"}
		current[identity.key()] = identity
	}
	if err := compareSemanticFeedIdentities(semanticSourceInventory{Rows: rows}, current); err != nil {
		t.Fatalf("unchanged feed with TAG excluded: %v", err)
	}

	cases := []struct {
		name   string
		mutate func(map[string]semanticFeedIdentity)
	}{
		{"note revision and digest", func(feed map[string]semanticFeedIdentity) {
			key := semanticFeedIdentity{SubjectID: "s", SourceKind: "NOTE", SourceRef: "note", Revision: "2"}.key()
			identity := feed[key]
			identity.Revision, identity.BodyDigest = "3", "changed"
			delete(feed, key)
			feed[identity.key()] = identity
		}},
		{"extract removal", func(feed map[string]semanticFeedIdentity) {
			delete(feed, semanticFeedIdentity{SubjectID: "s", SourceKind: "EXTRACT", SourceRef: "extract", Revision: "extract"}.key())
		}},
		{"filename change", func(feed map[string]semanticFeedIdentity) {
			key := semanticFeedIdentity{SubjectID: "s", SourceKind: "FILENAME", SourceRef: "entry", Revision: "entry"}.key()
			identity := feed[key]
			identity.BodyDigest = "renamed"
			feed[key] = identity
		}},
		{"description successor", func(feed map[string]semanticFeedIdentity) {
			key := semanticFeedIdentity{SubjectID: "s", SourceKind: "DESCRIPTION", SourceSubtype: "AI_SUMMARY", SourceRef: "accepted", Revision: "3"}.key()
			identity := feed[key]
			identity.Selected = false
			feed[key] = identity
			newer := semanticFeedIdentity{SubjectID: "s", SourceKind: "DESCRIPTION", SourceSubtype: "AI_SUMMARY", SourceRef: "successor", Revision: "4", BodyDigest: "next", BodyLength: 4, Selected: true}
			feed[newer.key()] = newer
		}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			feed := make(map[string]semanticFeedIdentity, len(current))
			for key, identity := range current {
				feed[key] = identity
			}
			test.mutate(feed)
			if err := compareSemanticFeedIdentities(semanticSourceInventory{Rows: rows}, feed); err == nil {
				t.Fatal("changed semantic source feed was accepted as current")
			}
		})
	}
}

func TestSemanticFilenameIdentityUsesLegacyEntryFallback(t *testing.T) {
	entry := sqlite.NamespaceEntry{ID: "legacy-entry", DisplayName: "legacy name"}
	identity := semanticFeedFilenameIdentity(entry)
	if identity.SubjectID != entry.ID || identity.SourceRef != entry.ID || identity.Revision != entry.ID ||
		identity.BodyDigest != sha256Text(entry.DisplayName) || identity.BodyLength != int64(len(entry.DisplayName)) {
		t.Fatalf("legacy filename identity = %+v, want entry-ID subject fallback", identity)
	}
	row := semanticSourceInventoryRow{SubjectID: entry.ID, SourceKind: "FILENAME", SourceRef: entry.ID,
		Revision: entry.ID, BodyDigest: sha256Text(entry.DisplayName), BodyLength: int64(len(entry.DisplayName)), Disposition: SemanticSourceIndexed}
	if err := compareSemanticFeedIdentities(semanticSourceInventory{Rows: []semanticSourceInventoryRow{row}}, map[string]semanticFeedIdentity{identity.key(): identity}); err != nil {
		t.Fatalf("legacy filename fallback should match the generation inventory: %v", err)
	}
}
