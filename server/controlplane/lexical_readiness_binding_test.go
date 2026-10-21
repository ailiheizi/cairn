package controlplane

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

func TestLexicalReadinessRequiresCurrentProfileAndConfigBinding(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	const configDigest = "sha256:readiness-controlplane-test"
	indexBinding := search.IndexBinding{
		ConfigDigest:         configDigest,
		LexicalProfileDigest: search.ProfileDigest(search.DimensionLexical, search.LexicalProfileV4),
	}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock",
		WithConfigDigest(configDigest), WithIndexBinding(indexBinding), WithExact(&exact.Service{Store: store, Repo: repo, ConfigDigest: configDigest}))
	if dispatcher.search == nil {
		t.Fatal("dispatcher did not wire the configured indexer")
	}
	source := t.TempDir()
	if err := os.WriteFile(filepath.Join(source, "readiness.txt"), []byte("readiness subject"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	ingested := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": source})
	indexer := dispatcher.search
	old, err := store.LatestIndexGeneration(ctx, ingested.WorkspaceID, search.DimensionLexical)
	if err != nil {
		t.Fatalf("read ingested V4 generation: %v", err)
	}
	if old.ProviderProfileDigest != search.ProfileDigest(search.DimensionLexical, search.LexicalProfileV4) {
		t.Fatalf("ingest lexical generation profile = %q, want V4", old.ProviderProfileDigest)
	}
	oldBytes, err := os.ReadFile(old.DBPath)
	if err != nil {
		t.Fatalf("read old V4 bytes: %v", err)
	}

	assertWorkspaceLexicalReadiness(t, dispatcher, ingested.WorkspaceID, "READY")
	indexer.LexicalProfileDigest = search.ProfileDigest(search.DimensionLexical, search.LexicalProfileV5)
	assertWorkspaceLexicalReadiness(t, dispatcher, ingested.WorkspaceID, "UNAVAILABLE")

	// A matching V4 profile cannot compensate for a changed host config digest.
	indexer.LexicalProfileDigest = search.ProfileDigest(search.DimensionLexical, search.LexicalProfileV4)
	indexer.ConfigDigest = "sha256:other-config"
	assertWorkspaceLexicalReadiness(t, dispatcher, ingested.WorkspaceID, "UNAVAILABLE")
	indexer.ConfigDigest = configDigest
	assertWorkspaceLexicalReadiness(t, dispatcher, ingested.WorkspaceID, "READY")

	// A newly built V5 generation becomes ready and leaves the historical V4
	// generation's database bytes untouched.
	indexer.LexicalProfileDigest = search.ProfileDigest(search.DimensionLexical, search.LexicalProfileV5)
	current, err := indexer.Rebuild(ctx, ingested.WorkspaceID, "snapshot:readiness-v5", ingested.RootID)
	if err != nil {
		t.Fatalf("build current V5 generation: %v", err)
	}
	if current.ID == old.ID || current.ProviderProfileDigest != search.ProfileDigest(search.DimensionLexical, search.LexicalProfileV5) {
		t.Fatalf("current lexical generation = %+v; want a distinct V5 generation", current)
	}
	assertWorkspaceLexicalReadiness(t, dispatcher, ingested.WorkspaceID, "READY")
	oldBytesAfter, err := os.ReadFile(old.DBPath)
	if err != nil {
		t.Fatalf("read old V4 bytes after V5 rebuild: %v", err)
	}
	if string(oldBytesAfter) != string(oldBytes) {
		t.Fatal("V5 rebuild or readiness checks modified the V4 generation")
	}

	// No lexical generation remains NOT_BUILT, while a failed attempted
	// rebuild keeps the process-local failure latch ahead of an older database.
	missingWorkspace, err := sqlite.NewStableID(sqlite.IDPrefixWorkspace)
	if err != nil {
		t.Fatalf("allocate no-generation workspace: %v", err)
	}
	if err := store.Update(ctx, func(tx *sqlite.Tx) error {
		return tx.InsertWorkspace(ctx, &sqlite.Workspace{ID: missingWorkspace, Name: "no lexical generation"})
	}); err != nil {
		t.Fatalf("insert no-generation workspace: %v", err)
	}
	assertStatusLexicalReadiness(t, dispatcher, missingWorkspace, "NOT_BUILT")

	badEngineDir := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(badEngineDir, []byte("occupied"), 0o600); err != nil {
		t.Fatalf("create occupied engine path: %v", err)
	}
	engineDir := indexer.Engine.Dir
	indexer.Engine.Dir = badEngineDir
	if _, err := indexer.Rebuild(ctx, ingested.WorkspaceID, "snapshot:readiness-failed", ingested.RootID); err == nil {
		t.Fatal("rebuild with an occupied engine path unexpectedly succeeded")
	}
	indexer.Engine.Dir = engineDir
	assertWorkspaceLexicalReadiness(t, dispatcher, ingested.WorkspaceID, "UNAVAILABLE")

	// Without an Indexer there is no binding authority to call a present
	// generation current, though the catalog can still report its existence.
	dispatcher.search = nil
	assertWorkspaceLexicalReadiness(t, dispatcher, ingested.WorkspaceID, "UNAVAILABLE")
}

func assertWorkspaceLexicalReadiness(t *testing.T, dispatcher *Dispatcher, workspaceID, want string) {
	t.Helper()
	got := assertStatusLexicalReadiness(t, dispatcher, workspaceID, want)
	listed := dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpContentList, map[string]any{
		"workspace_id": workspaceID,
	}))
	if listed.Status != command.StatusSucceeded {
		t.Fatalf("content.list = %q: %+v", listed.Status, listed.Reasons)
	}
	var content command.ContentListData
	if err := json.Unmarshal(listed.Data, &content); err != nil {
		t.Fatalf("decode content.list: %v", err)
	}
	if len(content.Items) == 0 {
		t.Fatal("content.list returned no items")
	}
	for _, item := range content.Items {
		if item.IndexStatus == nil || item.IndexStatus.Lexical != got {
			t.Fatalf("content.list item %q lexical = %+v; status.get says %q", item.Path, item.IndexStatus, got)
		}
	}
}

func assertStatusLexicalReadiness(t *testing.T, dispatcher *Dispatcher, workspaceID, want string) string {
	t.Helper()
	result := dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpStatusGet, map[string]any{}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("status.get = %q: %+v", result.Status, result.Reasons)
	}
	var status command.StatusData
	if err := json.Unmarshal(result.Data, &status); err != nil {
		t.Fatalf("decode status.get: %v", err)
	}
	for _, index := range status.Index {
		if index.WorkspaceID == workspaceID {
			if index.Lexical != want {
				t.Fatalf("status.get lexical = %q, want %q", index.Lexical, want)
			}
			return index.Lexical
		}
	}
	t.Fatalf("status.get has no index projection for workspace %q", workspaceID)
	return ""
}
