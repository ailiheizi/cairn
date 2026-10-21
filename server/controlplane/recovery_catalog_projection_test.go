package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

const recoveryProjectionNote = "paleontology lantern velvet"

func TestRecoveryImportRebuildsLexicalNotesForFreshCatalog(t *testing.T) {
	ctx := context.Background()
	source, exportData, anchorPath, workspaceID, subjectRef := recoveryArtifactWithNote(t)
	freshStore := testutil.OpenStore(t, filepath.Join(t.TempDir(), "fresh-catalog.sqlite"))
	fresh := recoveryProjectionDispatcher(t, source, freshStore, filepath.Join(t.TempDir(), "vectors"))
	result := fresh.handleRecoveryImport(ctx, mustEnvelope(t, command.OpRecoveryImport, map[string]any{
		"artifact_path": exportData.ArtifactPath, "trust_anchor_path": anchorPath,
	}), fresh.now().UTC())
	if result.Status != command.StatusSucceeded {
		t.Fatalf("fresh recovery.import = %q: %+v", result.Status, result.Reasons)
	}
	var imported command.RecoveryImportData
	if err := json.Unmarshal(result.Data, &imported); err != nil {
		t.Fatal(err)
	}
	if !imported.CatalogCreated {
		t.Fatalf("fresh catalog import did not report creation: %+v", imported)
	}
	query := fresh.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id": workspaceID, "dimension": search.DimensionLexical, "query": recoveryProjectionNote,
	}))
	if query.Status != command.StatusSucceeded {
		t.Fatalf("search after fresh import = %q: %+v", query.Status, query.Reasons)
	}
	var found command.SearchQueryData
	if err := json.Unmarshal(query.Data, &found); err != nil {
		t.Fatal(err)
	}
	if len(found.Hits) == 0 || found.Hits[0].SubjectRef != subjectRef {
		t.Fatalf("search did not find imported Note subject %q: %+v", subjectRef, found.Hits)
	}
	note, err := freshStore.ListAnnotations(ctx, workspaceID, subjectRef, false)
	if err != nil || len(note) != 1 || note[0].Body != recoveryProjectionNote {
		t.Fatalf("imported Note = %+v, err=%v", note, err)
	}
}

func TestRecoveryImportLexicalRefreshFailureKeepsCatalog(t *testing.T) {
	ctx := context.Background()
	source, exportData, anchorPath, workspaceID, subjectRef := recoveryArtifactWithNote(t)
	freshStore := testutil.OpenStore(t, filepath.Join(t.TempDir(), "fresh-catalog.sqlite"))
	blocker := filepath.Join(t.TempDir(), "vector-path-is-a-file")
	if err := os.WriteFile(blocker, []byte("blocks index directory creation"), 0o600); err != nil {
		t.Fatal(err)
	}
	fresh := recoveryProjectionDispatcher(t, source, freshStore, blocker)
	result := fresh.handleRecoveryImport(ctx, mustEnvelope(t, command.OpRecoveryImport, map[string]any{
		"artifact_path": exportData.ArtifactPath, "trust_anchor_path": anchorPath,
	}), fresh.now().UTC())
	if result.Status != command.StatusDegraded || !hasReasonCode(result, ReasonCodeUnavailable) {
		t.Fatalf("lexical refresh failure = %q: %+v", result.Status, result.Reasons)
	}
	var imported command.RecoveryImportData
	if err := json.Unmarshal(result.Data, &imported); err != nil {
		t.Fatal(err)
	}
	if !imported.CatalogCreated {
		t.Fatalf("degraded result lost catalog import state: %+v", imported)
	}
	if len(result.Reasons) != 1 || !strings.Contains(result.Reasons[0].Message, "catalog imported") ||
		!strings.Contains(result.Reasons[0].Message, "lexical refresh is unavailable") {
		t.Fatalf("degraded result does not distinguish committed catalog from index failure: %+v", result.Reasons)
	}
	got, err := freshStore.ListAnnotations(ctx, workspaceID, subjectRef, false)
	if err != nil || len(got) != 1 || got[0].Body != recoveryProjectionNote {
		t.Fatalf("Note after lexical failure = %+v, err=%v", got, err)
	}
}

func TestRecoveryImportPostCommitFenceReleaseFailureKeepsCatalogResult(t *testing.T) {
	ctx := context.Background()
	source, exportData, anchorPath, workspaceID, subjectRef := recoveryArtifactWithNote(t)
	freshStore := testutil.OpenStore(t, filepath.Join(t.TempDir(), "fresh-catalog.sqlite"))
	blocker := filepath.Join(t.TempDir(), "vector-path-is-a-file")
	if err := os.WriteFile(blocker, []byte("index must not run after import reconciliation failure"), 0o600); err != nil {
		t.Fatal(err)
	}
	fresh := recoveryProjectionDispatcher(t, source, freshStore, blocker)
	fresh.exact.PublicationFencer = &releaseFailingFencer{delegate: exact.NewPublicationFencer(freshStore, nil)}
	result := fresh.handleRecoveryImport(ctx, mustEnvelope(t, command.OpRecoveryImport, map[string]any{
		"artifact_path": exportData.ArtifactPath, "trust_anchor_path": anchorPath,
	}), fresh.now().UTC())
	if result.Status != command.StatusDegraded || !hasReasonCode(result, ReasonCodeUnavailable) {
		t.Fatalf("post-commit fence release failure = %q: %+v", result.Status, result.Reasons)
	}
	var imported command.RecoveryImportData
	if err := json.Unmarshal(result.Data, &imported); err != nil {
		t.Fatal(err)
	}
	if !imported.CatalogCreated || imported.SnapshotRef != exportData.SnapshotRef || imported.ManifestDigest == "" {
		t.Fatalf("degraded import lost committed catalog result: %+v", imported)
	}
	if len(result.Reasons) != 1 || !strings.Contains(result.Reasons[0].Message, "catalog committed") ||
		!strings.Contains(result.Reasons[0].Message, "reconciliation is unavailable") ||
		strings.Contains(result.Reasons[0].Message, "lexical refresh") {
		t.Fatalf("post-commit failure was not distinguished from index refresh: %+v", result.Reasons)
	}
	got, err := freshStore.ListAnnotations(ctx, workspaceID, subjectRef, false)
	if err != nil || len(got) != 1 || got[0].Body != recoveryProjectionNote {
		t.Fatalf("Note after post-commit failure = %+v, err=%v", got, err)
	}
}

type releaseFailingFencer struct {
	delegate exact.PublicationFencer
}

func (f *releaseFailingFencer) Acquire(ctx context.Context, domain, owner, leaseToken string, now, until time.Time) (int64, error) {
	return f.delegate.Acquire(ctx, domain, owner, leaseToken, now, until)
}

func (f *releaseFailingFencer) Validate(ctx context.Context, domain, owner, leaseToken string, token int64, now time.Time) error {
	return f.delegate.Validate(ctx, domain, owner, leaseToken, token, now)
}

func (f *releaseFailingFencer) Release(ctx context.Context, domain, owner, leaseToken string, token int64, now time.Time) error {
	if err := f.delegate.Release(ctx, domain, owner, leaseToken, token, now); err != nil {
		return err
	}
	return errors.New("injected lease release uncertainty after committed catalog")
}

func recoveryArtifactWithNote(t *testing.T) (*Dispatcher, command.RecoveryExportData, string, string, string) {
	t.Helper()
	ctx := context.Background()
	dispatcher, initialExport, anchorPath, _ := newRecoveryHandlerHarness(t)
	workspaces, err := dispatcher.store.ListWorkspaces(ctx)
	if err != nil || len(workspaces) != 1 {
		t.Fatalf("source workspaces = %+v, err=%v", workspaces, err)
	}
	workspaceID := workspaces[0].ID
	listed := dispatcher.Handle(ctx, mustEnvelope(t, command.OpContentList, map[string]any{"workspace_id": workspaceID}))
	if listed.Status != command.StatusSucceeded {
		t.Fatalf("source content.list = %q: %+v", listed.Status, listed.Reasons)
	}
	var content command.ContentListData
	if err := json.Unmarshal(listed.Data, &content); err != nil {
		t.Fatal(err)
	}
	if len(content.Items) != 1 {
		t.Fatalf("source content items = %+v", content.Items)
	}
	subjectRef := content.Items[0].SubjectRef
	created := dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": workspaceID, "subject_ref": subjectRef, "kind": "NOTE", "body": recoveryProjectionNote,
	}))
	if created.Status != command.StatusSucceeded && created.Status != command.StatusDegraded {
		t.Fatalf("source Note creation = %q: %+v", created.Status, created.Reasons)
	}
	stored, err := dispatcher.store.ListAnnotations(ctx, workspaceID, subjectRef, false)
	if err != nil || len(stored) != 1 || stored[0].Body != recoveryProjectionNote {
		t.Fatalf("source Note = %+v, err=%v", stored, err)
	}
	destination := filepath.Join(t.TempDir(), "with-note-recovery.json")
	exported := dispatcher.Handle(ctx, mustEnvelope(t, command.OpRecoveryExport, map[string]any{
		"snapshot_ref": initialExport.SnapshotRef, "destination": destination,
	}))
	if exported.Status != command.StatusSucceeded {
		t.Fatalf("re-export with Note = %q: %+v", exported.Status, exported.Reasons)
	}
	var exportData command.RecoveryExportData
	if err := json.Unmarshal(exported.Data, &exportData); err != nil {
		t.Fatal(err)
	}
	return dispatcher, exportData, anchorPath, workspaceID, subjectRef
}

func recoveryProjectionDispatcher(t *testing.T, source *Dispatcher, store *sqlite.Store, vectorPath string) *Dispatcher {
	t.Helper()
	service := &exact.Service{
		Store:                        store,
		Repo:                         source.exact.Repo,
		ConfigDigest:                 source.exact.ConfigDigest,
		DefaultProtection:            source.exact.DefaultProtection,
		AllowLinkOnly:                source.exact.AllowLinkOnly,
		LinkOnlyRequiresConfirmation: source.exact.LinkOnlyRequiresConfirmation,
		SigningIdentity:              source.exact.SigningIdentity,
		TrustAnchor:                  source.exact.TrustAnchor,
		PublicationDomain:            source.exact.PublicationDomain,
		RequireSignedPublication:     source.exact.RequireSignedPublication,
	}
	return NewDispatcher(store, "fresh-catalog.sqlite", "", WithExact(service), WithVectorPath(vectorPath))
}
