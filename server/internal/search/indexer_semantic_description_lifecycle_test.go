package search

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

func TestSemanticFeedFiltersDescriptionHistoryButLexicalRetainsIt(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)

	oldID := mustSearchID(t, sqlite.IDPrefixDescription)
	oldSegmentID := mustSearchID(t, sqlite.IDPrefixSemanticSegment)
	unacceptedID := mustSearchID(t, sqlite.IDPrefixDescription)
	unacceptedSegmentID := mustSearchID(t, sqlite.IDPrefixSemanticSegment)
	activeID := mustSearchID(t, sqlite.IDPrefixDescription)
	activeSegmentID := mustSearchID(t, sqlite.IDPrefixSemanticSegment)
	documents := []sqlite.DescriptionDocument{
		{ID: oldID, WorkspaceID: seed.WorkspaceID, SubjectRef: seed.FileEntryID,
			Kind: sqlite.DescriptionAISummary, Body: "track superseded description", SourceRef: "model:old",
			ProducerProfile: "model:old", Accepted: true, Revision: 1},
		{ID: unacceptedID, WorkspaceID: seed.WorkspaceID, SubjectRef: seed.FileEntryID,
			Kind: sqlite.DescriptionAISummary, Body: "track unaccepted description", SourceRef: "model:unaccepted",
			ProducerProfile: "model:unaccepted", Accepted: false, Revision: 2},
		{ID: activeID, WorkspaceID: seed.WorkspaceID, SubjectRef: seed.FileEntryID,
			Kind: sqlite.DescriptionAISummary, Body: "track active description", SourceRef: "model:active",
			ProducerProfile: "model:active", Accepted: true, Revision: 3, PredecessorID: oldID},
	}
	for _, document := range documents {
		if err := store.InsertDescriptionDocument(ctx, &document); err != nil {
			t.Fatalf("insert description %q: %v", document.ID, err)
		}
	}
	segments := []sqlite.SemanticSegment{
		{ID: oldSegmentID, WorkspaceID: seed.WorkspaceID, DocumentID: oldID, SubjectRef: seed.FileEntryID, Text: documents[0].Body,
			SourceSpan: json.RawMessage(fmt.Sprintf(`{"start_byte":0,"end_byte":%d}`, len(documents[0].Body)))},
		{ID: unacceptedSegmentID, WorkspaceID: seed.WorkspaceID, DocumentID: unacceptedID, SubjectRef: seed.FileEntryID, Text: documents[1].Body,
			SourceSpan: json.RawMessage(fmt.Sprintf(`{"start_byte":0,"end_byte":%d}`, len(documents[1].Body)))},
		{ID: activeSegmentID, WorkspaceID: seed.WorkspaceID, DocumentID: activeID, SubjectRef: seed.FileEntryID, Text: documents[2].Body,
			SourceSpan: json.RawMessage(fmt.Sprintf(`{"start_byte":0,"end_byte":%d}`, len(documents[2].Body)))},
	}
	for _, segment := range segments {
		if err := store.InsertSemanticSegment(ctx, &segment); err != nil {
			t.Fatalf("insert semantic segment %q: %v", segment.ID, err)
		}
	}

	manifest := testZvecManifest()
	driver := &selectiveSourceFeedDriver{}
	indexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: manifest.ConfigDigest,
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4), SemanticManifest: manifest,
		SemanticProvider: sourceFeedProvider{}, SemanticZvec: driver,
		SemanticLibraryPath: "/private/explicit/libzvec_c_api.dylib", SemanticLibraryDigest: "sha256:" + strings.Repeat("0", 64),
	}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:description-lifecycle", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	semantic, err := store.LatestIndexGeneration(ctx, seed.WorkspaceID, DimensionSemantic)
	if err != nil {
		t.Fatalf("read semantic generation: %v", err)
	}
	driver.mu.Lock()
	indexed := append([]ZvecSegment(nil), driver.byPath[semantic.DBPath]...)
	driver.mu.Unlock()
	if len(indexed) != 4 { // three filenames plus the accepted active leaf
		t.Fatalf("semantic feed segment count = %d, want 4", len(indexed))
	}
	for _, segment := range indexed {
		if segment.SegmentID == oldSegmentID || segment.SegmentID == unacceptedSegmentID {
			t.Fatalf("inactive description entered semantic feed: %+v", segment)
		}
	}

	_, lexical, err := indexer.Query(ctx, QueryRequest{WorkspaceID: seed.WorkspaceID, Text: "superseded"})
	if err != nil || len(lexical) != 1 || lexical[0].SubjectID != seed.FileEntryID {
		t.Fatalf("lexical durable superseded revision = %+v, err=%v", lexical, err)
	}
	if len(lexical[0].Segments) != 1 || lexical[0].Segments[0].SourceType != "DESCRIPTION" ||
		lexical[0].Segments[0].SourceID != oldID || lexical[0].Segments[0].DescriptionDocumentID != oldID ||
		lexical[0].Segments[0].SegmentID != oldSegmentID || !lexical[0].Segments[0].Accepted {
		t.Fatalf("superseded lexical source provenance = %+v", lexical[0].Segments)
	}
	_, rejected, err := indexer.Query(ctx, QueryRequest{WorkspaceID: seed.WorkspaceID, Text: "unaccepted"})
	if err != nil || len(rejected) != 1 || rejected[0].SubjectID != seed.FileEntryID || len(rejected[0].Segments) != 1 {
		t.Fatalf("lexical durable rejected revision = %+v, err=%v", rejected, err)
	}
	if segment := rejected[0].Segments[0]; segment.SourceType != "DESCRIPTION" || segment.SourceID != unacceptedID ||
		segment.DescriptionDocumentID != unacceptedID || segment.SegmentID != unacceptedSegmentID || segment.Accepted {
		t.Fatalf("rejected lexical source provenance = %+v", segment)
	}
	_, semanticHits, err := indexer.Query(ctx, QueryRequest{WorkspaceID: seed.WorkspaceID, Dimension: DimensionSemantic, Text: "track"})
	if err != nil || len(semanticHits) != 1 || len(semanticHits[0].Segments) != 2 {
		t.Fatalf("semantic active-leaf provenance = %+v, err=%v", semanticHits, err)
	}
	for _, segment := range semanticHits[0].Segments {
		if segment.SegmentID == oldSegmentID || segment.SegmentID == unacceptedSegmentID {
			t.Fatalf("inactive description returned by semantic query: %+v", segment)
		}
	}
}
