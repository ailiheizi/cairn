package controlplane

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/restoreweave/client/command"
	"github.com/ailiheizi/restoreweave/server/internal/exact"
	"github.com/ailiheizi/restoreweave/server/internal/repository"
	"github.com/ailiheizi/restoreweave/server/internal/store/sqlite"
	"github.com/ailiheizi/restoreweave/server/testutil"
)

// handleViewExport routes one view/export envelope to the handler method.
// The coordinator wires these operations into Dispatcher.Handle after this
// slice; tests exercise the handlers directly so dispatcher.go stays outside
// this slice's file scope.
func handleViewExport(d *Dispatcher, env command.Envelope) command.Result {
	started := time.Now().UTC()
	switch env.Operation {
	case command.OpViewSave:
		return d.handleViewSave(context.Background(), env, started)
	case command.OpViewGet:
		return d.handleViewGet(context.Background(), env, started)
	case command.OpViewEvaluate:
		return d.handleViewEvaluate(context.Background(), env, started)
	case command.OpViewList:
		return d.handleViewList(context.Background(), env, started)
	case command.OpExportList:
		return d.handleExportList(context.Background(), env, started)
	case command.OpExportPlan:
		return d.handleExportPlan(context.Background(), env, started)
	case command.OpExportApply:
		return d.handleExportApply(context.Background(), env, started)
	case command.OpExportVerify:
		return d.handleExportVerify(context.Background(), env, started)
	default:
		return unimplementedResult(env, started)
	}
}

func TestExportListReturnsFrozenManifestData(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "payload.bin"), []byte("export list bytes"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	h := newViewExportHarness(t, root)

	planned := h.dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpExportPlan, map[string]any{
		"subjects": []string{h.subjectRef},
	}))
	if planned.Status != command.StatusSucceeded {
		t.Fatalf("export.plan = %q: %+v", planned.Status, planned.Reasons)
	}
	var manifest command.ExportManifestData
	if err := json.Unmarshal(planned.Data, &manifest); err != nil {
		t.Fatalf("decode export.plan: %v", err)
	}

	listed := h.dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpExportList, nil))
	if listed.Status != command.StatusSucceeded {
		t.Fatalf("export.list = %q: %+v", listed.Status, listed.Reasons)
	}
	var manifests []command.ExportManifestData
	if err := json.Unmarshal(listed.Data, &manifests); err != nil {
		t.Fatalf("decode export.list: %v", err)
	}
	if len(manifests) != 1 {
		t.Fatalf("export.list manifests = %+v", manifests)
	}
	got := manifests[0]
	if got.ManifestID != manifest.ManifestID || got.ManifestDigest != manifest.ManifestDigest ||
		got.SubjectCount != manifest.SubjectCount || got.Representation != manifest.Representation ||
		len(got.Items) != len(manifest.Items) || got.Items[0] != manifest.Items[0] {
		t.Fatalf("export.list manifest = %+v, planned = %+v", got, manifest)
	}
}

// viewExportHarness wires a dispatcher with the exact lane and a published
// ingest fixture so view.evaluate and export.* can operate on real subjects.
// catalogPath and repoDir are recorded so a test can close the store and reopen
// a fresh handle on the same durable files.
type viewExportHarness struct {
	dispatcher  *Dispatcher
	ingest      command.PlanIngestData
	subjectRef  string
	entryID     string
	contentID   string
	subjectName string
	catalogPath string
	repoDir     string
}

// openViewExportHarness ingests root and returns the harness plus the published
// direct children of the ingest root. The single-subject wrapper below requires
// exactly one child; multi-file tests walk the children themselves.
func openViewExportHarness(t *testing.T, root string) (viewExportHarness, []command.NamespaceEntryData) {
	t.Helper()
	catalogPath := filepath.Join(t.TempDir(), "catalog.sqlite")
	repoDir := filepath.Join(t.TempDir(), "repository")
	store := testutil.OpenStore(t, catalogPath)
	repo, err := repository.OpenDir(repoDir)
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/rw.sock", WithExact(&exact.Service{
		Store: store,
		Repo:  repo,
	}))
	ctx := context.Background()
	ingest := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})
	return viewExportHarness{
		dispatcher: dispatcher, ingest: ingest,
		catalogPath: catalogPath, repoDir: repoDir,
	}, listNamespaceEntries(t, dispatcher, ingest.WorkspaceID, ingest.RootID, "")
}

func newViewExportHarness(t *testing.T, root string) viewExportHarness {
	t.Helper()
	h, entries := openViewExportHarness(t, root)
	if len(entries) != 1 {
		t.Fatalf("ingest root children = %+v", entries)
	}
	entry := entries[0]
	h.subjectRef = entry.SubjectRef
	h.entryID = entry.ID
	h.contentID = entry.ContentID
	h.subjectName = entry.DisplayName
	return h
}

// listNamespaceEntries returns the published children of one namespace
// directory through the same typed operation the client uses.
func listNamespaceEntries(t *testing.T, dispatcher *Dispatcher, workspaceID, rootID, parentID string) []command.NamespaceEntryData {
	t.Helper()
	input := map[string]any{"workspace_id": workspaceID, "root_id": rootID}
	if parentID != "" {
		input["parent_id"] = parentID
	}
	listed := dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpNamespaceList, input))
	if listed.Status != command.StatusSucceeded {
		t.Fatalf("namespace.list = %q: %+v", listed.Status, listed.Reasons)
	}
	var data command.NamespaceListData
	if err := json.Unmarshal(listed.Data, &data); err != nil {
		t.Fatalf("decode namespace.list: %v", err)
	}
	return data.Entries
}

// collectNamespaceFiles walks the published namespace below parentID and maps
// every regular file to its root-relative slash path.
func collectNamespaceFiles(
	t *testing.T,
	dispatcher *Dispatcher,
	workspaceID, rootID, parentID, prefix string,
	into map[string]command.NamespaceEntryData,
) {
	t.Helper()
	for _, entry := range listNamespaceEntries(t, dispatcher, workspaceID, rootID, parentID) {
		relative := entry.DisplayName
		if prefix != "" {
			relative = prefix + "/" + entry.DisplayName
		}
		switch entry.EntryType {
		case string(sqlite.EntryDirectory):
			collectNamespaceFiles(t, dispatcher, workspaceID, rootID, entry.ID, relative, into)
		case string(sqlite.EntryFile):
			into[relative] = entry
		}
	}
}

// fixtureFileEntries ingests root and returns every published regular file
// keyed by root-relative path.
func fixtureFileEntries(t *testing.T, h viewExportHarness) map[string]command.NamespaceEntryData {
	t.Helper()
	files := make(map[string]command.NamespaceEntryData)
	collectNamespaceFiles(t, h.dispatcher, h.ingest.WorkspaceID, h.ingest.RootID, "", "", files)
	if len(files) == 0 {
		t.Fatal("ingest published no regular file")
	}
	return files
}

// subjectRefsByPath orders the fixture's subject references by root-relative
// path so a test can hand export.plan a deterministic explicit selection.
func subjectRefsByPath(files map[string]command.NamespaceEntryData) []string {
	paths := make([]string, 0, len(files))
	for path := range files {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	refs := make([]string, 0, len(paths))
	for _, path := range paths {
		refs = append(refs, files[path].SubjectRef)
	}
	return refs
}

// reopenViewExportStore closes the harness catalog handle and reopens a fresh
// handle on the same database file, rebuilding the dispatcher around it. The
// repository bytes and any materialized destination stay untouched.
func reopenViewExportStore(t *testing.T, h *viewExportHarness) {
	t.Helper()
	if err := h.dispatcher.store.Close(); err != nil {
		t.Fatalf("close harness store: %v", err)
	}
	store := testutil.OpenStore(t, h.catalogPath)
	repo, err := repository.OpenDir(h.repoDir)
	if err != nil {
		t.Fatalf("reopen harness repository: %v", err)
	}
	h.dispatcher = NewDispatcher(store, "catalog.sqlite", "/tmp/rw.sock", WithExact(&exact.Service{
		Store: store,
		Repo:  repo,
	}))
}

// openCatalogFile opens the durable catalog file directly so a test can
// simulate pre-migration state or tamper with a stored row the public store API
// intentionally never rewrites.
func openCatalogFile(t *testing.T, catalogPath string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", catalogPath)
	if err != nil {
		t.Fatalf("open catalog file: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestViewSaveGetListAndRevisionBump(t *testing.T) {
	dispatcher, _ := newTestDispatcher(t)

	saved := handleViewExport(dispatcher, mustEnvelope(t, command.OpViewSave, map[string]any{
		"name": "novels", "query": "tag:novel", "fields": []string{"entry_type=REGULAR_FILE"},
	}))
	if saved.Status != command.StatusSucceeded {
		t.Fatalf("view.save = %q: %+v", saved.Status, saved.Reasons)
	}
	var first command.ViewData
	if err := json.Unmarshal(saved.Data, &first); err != nil {
		t.Fatalf("decode view.save: %v", err)
	}
	if first.ViewID == "" || first.Revision != 1 || first.Name != "novels" || first.Query != "tag:novel" {
		t.Fatalf("first view = %+v", first)
	}
	if first.Fields == nil || len(first.Fields) != 1 || first.Fields[0] != "entry_type=REGULAR_FILE" {
		t.Fatalf("first fields = %+v", first.Fields)
	}

	got := handleViewExport(dispatcher, mustEnvelope(t, command.OpViewGet, map[string]any{"view_id": first.ViewID}))
	if got.Status != command.StatusSucceeded {
		t.Fatalf("view.get by id = %q: %+v", got.Status, got.Reasons)
	}
	var byID command.ViewData
	if err := json.Unmarshal(got.Data, &byID); err != nil {
		t.Fatalf("decode view.get: %v", err)
	}
	if byID.ViewID != first.ViewID || byID.Name != "novels" || byID.Revision != 1 {
		t.Fatalf("view.get = %+v", byID)
	}

	gotByName := handleViewExport(dispatcher, mustEnvelope(t, command.OpViewGet, map[string]any{"name": "novels"}))
	if gotByName.Status != command.StatusSucceeded {
		t.Fatalf("view.get by name = %q: %+v", gotByName.Status, gotByName.Reasons)
	}
	var byName command.ViewData
	if err := json.Unmarshal(gotByName.Data, &byName); err != nil {
		t.Fatalf("decode view.get by name: %v", err)
	}
	if byName.ViewID != first.ViewID || byName.Name != "novels" {
		t.Fatalf("view.get by name = %+v", byName)
	}

	// Saving the same name writes a successor revision.
	updated := handleViewExport(dispatcher, mustEnvelope(t, command.OpViewSave, map[string]any{
		"name": "novels", "query": "tag:novel AND language:zh",
	}))
	if updated.Status != command.StatusSucceeded {
		t.Fatalf("view.save update = %q: %+v", updated.Status, updated.Reasons)
	}
	var second command.ViewData
	if err := json.Unmarshal(updated.Data, &second); err != nil {
		t.Fatalf("decode view.save update: %v", err)
	}
	if second.ViewID != first.ViewID || second.Revision != 2 || second.Query != "tag:novel AND language:zh" {
		t.Fatalf("updated view = %+v", second)
	}

	listed := handleViewExport(dispatcher, mustEnvelope(t, command.OpViewList, map[string]any{}))
	if listed.Status != command.StatusSucceeded {
		t.Fatalf("view.list = %q: %+v", listed.Status, listed.Reasons)
	}
	var views []command.ViewData
	if err := json.Unmarshal(listed.Data, &views); err != nil {
		t.Fatalf("decode view.list: %v", err)
	}
	if len(views) != 1 || views[0].ViewID != first.ViewID || views[0].Revision != 2 {
		t.Fatalf("view.list = %+v", views)
	}
}

func TestViewEvaluateReturnsHitsAfterIngest(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "annual-report.txt"), []byte("annual report content"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	h := newViewExportHarness(t, root)

	saved := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpViewSave, map[string]any{
		"name": "reports", "query": "annual",
	}))
	if saved.Status != command.StatusSucceeded {
		t.Fatalf("view.save = %q: %+v", saved.Status, saved.Reasons)
	}
	var view command.ViewData
	if err := json.Unmarshal(saved.Data, &view); err != nil {
		t.Fatalf("decode view.save: %v", err)
	}

	evaluated := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpViewEvaluate, map[string]any{
		"view_id": view.ViewID,
	}))
	if evaluated.Status != command.StatusSucceeded {
		t.Fatalf("view.evaluate = %q: %+v", evaluated.Status, evaluated.Reasons)
	}
	var data command.ViewEvaluateData
	if err := json.Unmarshal(evaluated.Data, &data); err != nil {
		t.Fatalf("decode view.evaluate: %v", err)
	}
	if len(data.Hits) != 1 || data.Hits[0].SubjectRef != h.subjectRef {
		t.Fatalf("evaluate hits = %+v, want %s", data.Hits, h.subjectRef)
	}
	if data.ViewID != view.ViewID || data.Query != "annual" {
		t.Fatalf("evaluate data = %+v", data)
	}
}

func TestExportPlanApplyVerifyEndToEnd(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "payload.bin"), []byte("export exact bytes"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	h := newViewExportHarness(t, root)

	planned := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportPlan, map[string]any{
		"subjects": []string{h.subjectRef}, "output_name": h.subjectName,
	}))
	if planned.Status != command.StatusSucceeded {
		t.Fatalf("export.plan = %q: %+v", planned.Status, planned.Reasons)
	}
	var manifest command.ExportManifestData
	if err := json.Unmarshal(planned.Data, &manifest); err != nil {
		t.Fatalf("decode export.plan: %v", err)
	}
	if manifest.ManifestID == "" || manifest.ManifestDigest == "" || manifest.SubjectCount != 1 {
		t.Fatalf("manifest = %+v", manifest)
	}
	if len(manifest.Items) != 1 {
		t.Fatalf("manifest items = %+v", manifest.Items)
	}
	frozen, err := exportItemsFromStrings(manifest.Items)
	if err != nil {
		t.Fatalf("decode manifest items: %v", err)
	}
	if len(frozen) != 1 || frozen[0].SubjectRef != h.entryID || frozen[0].OutputName != h.subjectName {
		t.Fatalf("manifest items = %+v, want frozen entry_id %s", frozen, h.entryID)
	}

	destination := filepath.Join(t.TempDir(), "out")
	applied := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportApply, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	}))
	if applied.Status != command.StatusSucceeded {
		t.Fatalf("export.apply = %q: %+v", applied.Status, applied.Reasons)
	}
	var applyData command.ExportApplyVerifyData
	if err := json.Unmarshal(applied.Data, &applyData); err != nil {
		t.Fatalf("decode export.apply: %v", err)
	}
	if !applyData.Verified || applyData.Items != 1 || applyData.Destination != destination {
		t.Fatalf("apply data = %+v", applyData)
	}
	got, err := os.ReadFile(filepath.Join(destination, h.subjectName))
	if err != nil {
		t.Fatalf("read materialized: %v", err)
	}
	if string(got) != "export exact bytes" {
		t.Fatalf("materialized payload = %q", got)
	}

	verified := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportVerify, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	}))
	if verified.Status != command.StatusSucceeded {
		t.Fatalf("export.verify = %q: %+v", verified.Status, verified.Reasons)
	}
	var verifyData command.ExportApplyVerifyData
	if err := json.Unmarshal(verified.Data, &verifyData); err != nil {
		t.Fatalf("decode export.verify: %v", err)
	}
	if !verifyData.Verified || verifyData.ManifestID != manifest.ManifestID || verifyData.Bytes <= 0 {
		t.Fatalf("verify data = %+v", verifyData)
	}
}

func TestFrozenExportManifestSurvivesRescanAndCurrentSubjectChange(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	path := filepath.Join(root, "payload.bin")
	original := []byte("original export bytes")
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	h := newViewExportHarness(t, root)

	planned := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportPlan, map[string]any{
		"subjects": []string{h.subjectRef}, "output_name": h.subjectName,
	}))
	if planned.Status != command.StatusSucceeded {
		t.Fatalf("export.plan = %q: %+v", planned.Status, planned.Reasons)
	}
	var manifest command.ExportManifestData
	if err := json.Unmarshal(planned.Data, &manifest); err != nil {
		t.Fatalf("decode export.plan: %v", err)
	}
	frozen, err := exportItemsFromStrings(manifest.Items)
	if err != nil || len(frozen) != 1 || frozen[0].SubjectRef != h.entryID || frozen[0].ContentID == "" || !frozen[0].Exact {
		t.Fatalf("frozen manifest = %+v, err=%v", frozen, err)
	}

	changed := []byte("new bytes at the same path")
	if err := os.WriteFile(path, changed, 0o600); err != nil {
		t.Fatalf("rewrite fixture: %v", err)
	}
	if got := mustAppliedIngest(t, ctx, h.dispatcher, map[string]any{"root": root}); got.SnapshotRef == h.ingest.SnapshotRef {
		t.Fatal("rescan did not publish a new snapshot")
	}

	destination := filepath.Join(t.TempDir(), "out")
	applied := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportApply, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	}))
	if applied.Status != command.StatusSucceeded {
		t.Fatalf("apply frozen manifest after rescan = %q: %+v", applied.Status, applied.Reasons)
	}
	got, err := os.ReadFile(filepath.Join(destination, h.subjectName))
	if err != nil {
		t.Fatalf("read frozen export: %v", err)
	}
	if string(got) != string(original) {
		t.Fatalf("frozen export bytes = %q, want %q", got, original)
	}
}

func TestExportPlanRequiresViewOrSubjects(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "payload.bin"), []byte("plan probe"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	h := newViewExportHarness(t, root)

	// No view, no subjects: fails closed before any catalog write.
	missing := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportPlan, map[string]any{}))
	if missing.Status != command.StatusFailed || !hasReasonCode(missing, ReasonCodeInvalidInput) {
		t.Fatalf("empty export.plan = %q: %+v", missing.Status, missing.Reasons)
	}

	// An explicit subject that does not exist fails closed.
	unknown := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportPlan, map[string]any{
		"subjects": []string{"nse_00000000000000000000000000000000"},
	}))
	if unknown.Status != command.StatusFailed || !hasReasonCode(unknown, ReasonCodeNotFound) {
		t.Fatalf("unknown subject export.plan = %q: %+v", unknown.Status, unknown.Reasons)
	}

	// Both view_id and subjects together fails closed as invalid input.
	both := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportPlan, map[string]any{
		"view_id": "view_00000000000000000000000000000000", "subjects": []string{h.subjectRef},
	}))
	if both.Status != command.StatusFailed || !hasReasonCode(both, ReasonCodeInvalidInput) {
		t.Fatalf("both view and subjects export.plan = %q: %+v", both.Status, both.Reasons)
	}
}

func TestExportVerifyAgainstWrongDestinationFailsClosed(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "payload.bin"), []byte("verify target bytes"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	h := newViewExportHarness(t, root)

	planned := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportPlan, map[string]any{
		"subjects": []string{h.subjectRef}, "output_name": h.subjectName,
	}))
	var manifest command.ExportManifestData
	if err := json.Unmarshal(planned.Data, &manifest); err != nil {
		t.Fatalf("decode export.plan: %v", err)
	}

	destination := filepath.Join(t.TempDir(), "out")
	if applied := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportApply, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	})); applied.Status != command.StatusSucceeded {
		t.Fatalf("export.apply = %q: %+v", applied.Status, applied.Reasons)
	}

	// Verifying a completely different empty destination fails closed.
	wrongDest := filepath.Join(t.TempDir(), "elsewhere")
	verified := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportVerify, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": wrongDest,
	}))
	if verified.Status != command.StatusFailed {
		t.Fatalf("wrong-destination verify = %q: %+v", verified.Status, verified.Reasons)
	}

	// Verifying with a wrong digest fails closed before any destination check.
	wrongDigest := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportVerify, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": "sha256:" + "00" + "00000000000000000000000000000000000000000000000000000000000",
		"destination": destination,
	}))
	if wrongDigest.Status != command.StatusFailed {
		t.Fatalf("wrong-digest verify = %q: %+v", wrongDigest.Status, wrongDigest.Reasons)
	}
}

// exportSidecarPolicyMigrationVersion mirrors the catalog migration that added
// the frozen sidecar policy column. The legacy test simulates a catalog created
// before it by dropping the column and its migration ledger row.
const exportSidecarPolicyMigrationVersion = 24

// tamperStoredSidecarPolicy rewrites the stored sidecar policy without touching
// the frozen digest, reproducing the drift a projection that omitted the
// column would have hidden.
func tamperStoredSidecarPolicy(t *testing.T, catalogPath, manifestID, policy string) {
	t.Helper()
	db := openCatalogFile(t, catalogPath)
	result, err := db.Exec(
		`UPDATE export_manifests SET sidecars = ? WHERE manifest_id = ?`, policy, manifestID)
	if err != nil {
		t.Fatalf("tamper stored sidecar policy: %v", err)
	}
	if rows, err := result.RowsAffected(); err != nil || rows != 1 {
		t.Fatalf("tampered sidecar rows = %d, err=%v, want 1", rows, err)
	}
}

// simulatePreSidecarCatalog reproduces the catalog state before the sidecar
// policy migration: the column did not exist and the migration was not
// recorded. Existing manifest rows carry the empty policy the column default
// reintroduces.
func simulatePreSidecarCatalog(t *testing.T, catalogPath string) {
	t.Helper()
	db := openCatalogFile(t, catalogPath)
	if _, err := db.Exec(`ALTER TABLE export_manifests DROP COLUMN sidecars`); err != nil {
		t.Fatalf("drop sidecar policy column: %v", err)
	}
	if _, err := db.Exec(`DELETE FROM schema_migrations WHERE version = ?`, exportSidecarPolicyMigrationVersion); err != nil {
		t.Fatalf("remove sidecar policy migration record: %v", err)
	}
}

// TestExportSidecarPolicySurvivesApplyVerifyAndStoreReopen proves the frozen
// sidecar policy is part of the stored projection and is passed back into the
// rebuilt manifest, so apply and verify still agree with the planned digest.
// Before the persistence fix the rebuilt manifest always carried an empty
// policy and this flow failed with a conflicting digest.
func TestExportSidecarPolicySurvivesApplyVerifyAndStoreReopen(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "track.bin"), []byte("sidecar policy bytes"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	h := newViewExportHarness(t, root)

	const policy = "keep-metadata-and-subtitle-sidecars"
	planned := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportPlan, map[string]any{
		"subjects": []string{h.subjectRef}, "sidecars": policy,
	}))
	if planned.Status != command.StatusSucceeded {
		t.Fatalf("export.plan = %q: %+v", planned.Status, planned.Reasons)
	}
	var manifest command.ExportManifestData
	if err := json.Unmarshal(planned.Data, &manifest); err != nil {
		t.Fatalf("decode export.plan: %v", err)
	}
	if manifest.ManifestID == "" || manifest.ManifestDigest == "" {
		t.Fatalf("planned manifest = %+v", manifest)
	}

	// The rebuild path shared by apply and verify must reproduce the frozen
	// digest and carry the stored policy.
	rebuilt, err := h.dispatcher.loadFrozenManifest(ctx, manifest.ManifestID, manifest.ManifestDigest)
	if err != nil {
		t.Fatalf("rebuild frozen manifest: %v", err)
	}
	if rebuilt.Sidecars != policy || rebuilt.ManifestDigest != manifest.ManifestDigest {
		t.Fatalf("rebuilt manifest sidecars = %q digest = %q, want %q / %q",
			rebuilt.Sidecars, rebuilt.ManifestDigest, policy, manifest.ManifestDigest)
	}

	destination := filepath.Join(t.TempDir(), "out")
	applied := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportApply, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	}))
	if applied.Status != command.StatusSucceeded {
		t.Fatalf("export.apply with sidecar policy = %q: %+v", applied.Status, applied.Reasons)
	}
	verified := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportVerify, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	}))
	if verified.Status != command.StatusSucceeded {
		t.Fatalf("export.verify with sidecar policy = %q: %+v", verified.Status, verified.Reasons)
	}

	// A fresh store handle on the same catalog file must rebuild the identical
	// digest: the policy is durably persisted, not cached in memory.
	reopenViewExportStore(t, &h)
	afterReopen, err := h.dispatcher.loadFrozenManifest(ctx, manifest.ManifestID, manifest.ManifestDigest)
	if err != nil {
		t.Fatalf("rebuild frozen manifest after store reopen: %v", err)
	}
	if afterReopen.Sidecars != policy || afterReopen.ManifestDigest != manifest.ManifestDigest {
		t.Fatalf("rebuilt manifest after reopen sidecars = %q digest = %q", afterReopen.Sidecars, afterReopen.ManifestDigest)
	}
	reverified := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportVerify, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	}))
	if reverified.Status != command.StatusSucceeded {
		t.Fatalf("export.verify after store reopen = %q: %+v", reverified.Status, reverified.Reasons)
	}

	// export.list reads the same durable projection, so a listed manifest
	// still carries the frozen digest and can be re-verified by digest alone.
	listed := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportList, nil))
	if listed.Status != command.StatusSucceeded {
		t.Fatalf("export.list = %q: %+v", listed.Status, listed.Reasons)
	}
	var manifests []command.ExportManifestData
	if err := json.Unmarshal(listed.Data, &manifests); err != nil {
		t.Fatalf("decode export.list: %v", err)
	}
	if len(manifests) != 1 || manifests[0].ManifestID != manifest.ManifestID ||
		manifests[0].ManifestDigest != manifest.ManifestDigest {
		t.Fatalf("export.list manifests = %+v, planned = %+v", manifests, manifest)
	}
	byListedDigest, err := h.dispatcher.loadFrozenManifest(ctx, "", manifests[0].ManifestDigest)
	if err != nil {
		t.Fatalf("rebuild listed manifest by digest: %v", err)
	}
	if byListedDigest.Sidecars != policy || byListedDigest.ManifestDigest != manifest.ManifestDigest {
		t.Fatalf("listed manifest sidecars = %q digest = %q", byListedDigest.Sidecars, byListedDigest.ManifestDigest)
	}
}

// TestExportTamperedSidecarPolicyFailsClosed rewrites the stored sidecar policy
// and proves apply and verify fail closed with a conflicting digest instead of
// silently materializing against a manifest the operator never planned.
func TestExportTamperedSidecarPolicyFailsClosed(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "track.bin"), []byte("tamper probe bytes"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	h := newViewExportHarness(t, root)

	planned := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportPlan, map[string]any{
		"subjects": []string{h.subjectRef}, "sidecars": "keep-metadata-sidecars",
	}))
	if planned.Status != command.StatusSucceeded {
		t.Fatalf("export.plan = %q: %+v", planned.Status, planned.Reasons)
	}
	var manifest command.ExportManifestData
	if err := json.Unmarshal(planned.Data, &manifest); err != nil {
		t.Fatalf("decode export.plan: %v", err)
	}
	destination := filepath.Join(t.TempDir(), "out")
	if applied := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportApply, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	})); applied.Status != command.StatusSucceeded {
		t.Fatalf("export.apply = %q: %+v", applied.Status, applied.Reasons)
	}

	tamperStoredSidecarPolicy(t, h.catalogPath, manifest.ManifestID, "drop-all-sidecars")

	verified := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportVerify, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	}))
	if verified.Status != command.StatusFailed || !hasReasonCode(verified, ReasonCodeConflict) {
		t.Fatalf("tampered verify = %q: %+v", verified.Status, verified.Reasons)
	}
	applied := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportApply, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": filepath.Join(t.TempDir(), "out-tampered"),
	}))
	if applied.Status != command.StatusFailed || !hasReasonCode(applied, ReasonCodeConflict) {
		t.Fatalf("tampered apply = %q: %+v", applied.Status, applied.Reasons)
	}
}

// TestLegacyManifestWithoutSidecarColumnStillVerifies simulates the catalog as
// it existed before the sidecar policy migration. Manifests planned then carry
// an empty policy, which the column default reproduces, so their frozen digest
// still verifies after the upgrade.
func TestLegacyManifestWithoutSidecarColumnStillVerifies(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "track.bin"), []byte("legacy manifest bytes"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	h := newViewExportHarness(t, root)

	planned := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportPlan, map[string]any{
		"subjects": []string{h.subjectRef},
	}))
	if planned.Status != command.StatusSucceeded {
		t.Fatalf("export.plan = %q: %+v", planned.Status, planned.Reasons)
	}
	var manifest command.ExportManifestData
	if err := json.Unmarshal(planned.Data, &manifest); err != nil {
		t.Fatalf("decode export.plan: %v", err)
	}
	destination := filepath.Join(t.TempDir(), "out")
	if applied := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportApply, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	})); applied.Status != command.StatusSucceeded {
		t.Fatalf("export.apply = %q: %+v", applied.Status, applied.Reasons)
	}

	if err := h.dispatcher.store.Close(); err != nil {
		t.Fatalf("close harness store: %v", err)
	}
	simulatePreSidecarCatalog(t, h.catalogPath)
	reopenViewExportStore(t, &h)

	legacy, err := h.dispatcher.loadFrozenManifest(context.Background(), manifest.ManifestID, manifest.ManifestDigest)
	if err != nil {
		t.Fatalf("rebuild upgraded legacy manifest: %v", err)
	}
	if legacy.Sidecars != "" || legacy.ManifestDigest != manifest.ManifestDigest {
		t.Fatalf("upgraded legacy manifest sidecars = %q digest = %q", legacy.Sidecars, legacy.ManifestDigest)
	}
	verified := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportVerify, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	}))
	if verified.Status != command.StatusSucceeded {
		t.Fatalf("export.verify after legacy upgrade = %q: %+v", verified.Status, verified.Reasons)
	}
}

// planFixtureExport freezes an explicit subject selection through the
// export.plan operation and returns the manifest summary.
func planFixtureExport(t *testing.T, h viewExportHarness, input map[string]any) command.ExportManifestData {
	t.Helper()
	planned := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportPlan, input))
	if planned.Status != command.StatusSucceeded {
		t.Fatalf("export.plan = %q: %+v", planned.Status, planned.Reasons)
	}
	var manifest command.ExportManifestData
	if err := json.Unmarshal(planned.Data, &manifest); err != nil {
		t.Fatalf("decode export.plan: %v", err)
	}
	return manifest
}

// frozenItems decodes the manifest summary's frozen item list.
func frozenItems(t *testing.T, manifest command.ExportManifestData) []exact.ExportItem {
	t.Helper()
	items, err := exportItemsFromStrings(manifest.Items)
	if err != nil {
		t.Fatalf("decode frozen items: %v", err)
	}
	return items
}

// applyAndVerifyExport materializes a planned manifest into destination and
// verifies it through the typed operations.
func applyAndVerifyExport(t *testing.T, h viewExportHarness, manifest command.ExportManifestData, destination string) {
	t.Helper()
	applied := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportApply, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	}))
	if applied.Status != command.StatusSucceeded {
		t.Fatalf("export.apply = %q: %+v", applied.Status, applied.Reasons)
	}
	verified := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportVerify, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	}))
	if verified.Status != command.StatusSucceeded {
		t.Fatalf("export.verify = %q: %+v", verified.Status, verified.Reasons)
	}
}

// namesBySubject maps each frozen item's subject reference to its output name
// so a test can compare naming outcomes without depending on arrival order.
// ExportManifest v1 freezes the snapshot-local entry handle in that field.
func namesBySubject(items []exact.ExportItem) map[string]string {
	names := make(map[string]string, len(items))
	for _, item := range items {
		names[item.SubjectRef] = item.OutputName
	}
	return names
}

// namesSortedBySubject returns the output names ordered by the frozen subject
// reference, which is the order the disambiguation policy assigns names in.
func namesSortedBySubject(items []exact.ExportItem) []string {
	ordered := append([]exact.ExportItem(nil), items...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].SubjectRef < ordered[j].SubjectRef })
	names := make([]string, 0, len(ordered))
	for _, item := range ordered {
		names = append(names, item.OutputName)
	}
	return names
}

func writeExportFixture(t *testing.T, root, relative, payload string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir for %s: %v", relative, err)
	}
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatalf("write %s: %v", relative, err)
	}
}

// collidingExportFixture writes three directories that each hold one clip.mkv
// with identical base names and three extension-less notes files, and returns
// the root-relative path -> payload map.
func collidingExportFixture(t *testing.T, root string) map[string]string {
	t.Helper()
	payloads := map[string]string{
		"clip-a/clip.mkv": "clip payload a",
		"clip-b/clip.mkv": "clip payload b",
		"clip-c/clip.mkv": "clip payload c",
		"notes-a/notes":   "notes payload a",
		"notes-b/notes":   "notes payload b",
		"notes-c/notes":   "notes payload c",
	}
	for relative, payload := range payloads {
		writeExportFixture(t, root, relative, payload)
	}
	return payloads
}

func reversedStrings(values []string) []string {
	reversed := make([]string, 0, len(values))
	for index := len(values) - 1; index >= 0; index-- {
		reversed = append(reversed, values[index])
	}
	return reversed
}

// TestExportPlanHonorsSingleFileOutputNameAndRejectsUnsafeNames proves the
// export.plan input's output_name is honored when exactly one regular file is
// frozen and that a supplied name which is not a safe single
// destination-relative component fails as invalid_input instead of being
// silently ignored.
func TestExportPlanHonorsSingleFileOutputNameAndRejectsUnsafeNames(t *testing.T) {
	root := t.TempDir()
	payload := []byte("single output-name bytes")
	writeExportFixture(t, root, "payload.bin", string(payload))
	h := newViewExportHarness(t, root)

	// An omitted output_name keeps the pre-existing display-name behavior.
	derived := planFixtureExport(t, h, map[string]any{"subjects": []string{h.subjectRef}})
	if items := frozenItems(t, derived); len(items) != 1 || items[0].OutputName != h.subjectName {
		t.Fatalf("derived name items = %+v, want display name %q", items, h.subjectName)
	}

	// A supplied name is trimmed and used for the single frozen file.
	renamed := planFixtureExport(t, h, map[string]any{
		"subjects": []string{h.subjectRef}, "output_name": "  operator-choice.mkv  ",
	})
	items := frozenItems(t, renamed)
	if len(items) != 1 || items[0].OutputName != "operator-choice.mkv" {
		t.Fatalf("named plan items = %+v, want operator-choice.mkv", items)
	}
	destination := filepath.Join(t.TempDir(), "out")
	applyAndVerifyExport(t, h, renamed, destination)
	got, err := os.ReadFile(filepath.Join(destination, "operator-choice.mkv"))
	if err != nil {
		t.Fatalf("read renamed output: %v", err)
	}
	if string(got) != string(payload) {
		t.Fatalf("renamed output = %q, want %q", got, payload)
	}

	// An unusable name fails closed as invalid_input and freezes nothing.
	for _, unsafe := range []string{"../escape.mkv", "nested/dir.mkv", "..", ".", "   "} {
		result := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportPlan, map[string]any{
			"subjects": []string{h.subjectRef}, "output_name": unsafe,
		}))
		if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeInvalidInput) {
			t.Fatalf("output_name %q = %q: %+v, want invalid_input", unsafe, result.Status, result.Reasons)
		}
		if len(result.Reasons) == 0 || !strings.Contains(result.Reasons[0].Message, "output_name") {
			t.Fatalf("output_name %q reason does not name the problem: %+v", unsafe, result.Reasons)
		}
	}

	listed := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportList, nil))
	var manifests []command.ExportManifestData
	if err := json.Unmarshal(listed.Data, &manifests); err != nil {
		t.Fatalf("decode export.list: %v", err)
	}
	if len(manifests) != 2 {
		t.Fatalf("rejected output names still froze manifests: %+v", manifests)
	}
}

// TestExportPlanRejectsOutputNameForMultiFileSelection proves a single
// output_name cannot silently apply to a multi-file selection: the plan fails
// as invalid_input with an explicit reason and stores no manifest.
func TestExportPlanRejectsOutputNameForMultiFileSelection(t *testing.T) {
	root := t.TempDir()
	writeExportFixture(t, root, "one/one.bin", "one bytes")
	writeExportFixture(t, root, "two/two.bin", "two bytes")
	h, _ := openViewExportHarness(t, root)
	refs := subjectRefsByPath(fixtureFileEntries(t, h))
	if len(refs) != 2 {
		t.Fatalf("fixture subjects = %+v, want 2", refs)
	}

	rejected := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportPlan, map[string]any{
		"subjects": refs, "output_name": "one-name.bin",
	}))
	if rejected.Status != command.StatusFailed || !hasReasonCode(rejected, ReasonCodeInvalidInput) {
		t.Fatalf("multi-file output_name = %q: %+v, want invalid_input", rejected.Status, rejected.Reasons)
	}
	if len(rejected.Reasons) == 0 || !strings.Contains(rejected.Reasons[0].Message, "multi-file") {
		t.Fatalf("multi-file reason does not name the problem: %+v", rejected.Reasons)
	}

	// The same selection without output_name still freezes both files, so the
	// rejection is the single-name input and not the multi-file selection.
	manifest := planFixtureExport(t, h, map[string]any{"subjects": refs})
	if manifest.SubjectCount != 2 || len(frozenItems(t, manifest)) != 2 {
		t.Fatalf("manifest without output_name = %+v", manifest)
	}

	listed := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportList, nil))
	var manifests []command.ExportManifestData
	if err := json.Unmarshal(listed.Data, &manifests); err != nil {
		t.Fatalf("decode export.list: %v", err)
	}
	if len(manifests) != 1 || manifests[0].ManifestID != manifest.ManifestID {
		t.Fatalf("rejected plan stored a manifest: %+v", manifests)
	}
}

// TestExportPlanDisambiguatesRepeatedOutputNamesDeterministically proves
// subjects that derive the same output name become name / name (2) / name (3)
// in stable subject order, that the suffix lands before the extension, and that
// the disambiguated manifest still materializes and verifies the real bytes of
// every frozen subject in the destination.
func TestExportPlanDisambiguatesRepeatedOutputNamesDeterministically(t *testing.T) {
	root := t.TempDir()
	payloads := collidingExportFixture(t, root)
	h, _ := openViewExportHarness(t, root)
	files := fixtureFileEntries(t, h)
	manifest := planFixtureExport(t, h, map[string]any{"subjects": subjectRefsByPath(files)})
	items := frozenItems(t, manifest)
	if len(items) != 6 || manifest.SubjectCount != 6 {
		t.Fatalf("frozen items = %+v, subject_count = %d, want 6", items, manifest.SubjectCount)
	}

	pathBySubject := make(map[string]string, len(files))
	payloadBySubject := make(map[string]string, len(files))
	for relative, entry := range files {
		// ExportManifest v1 freezes the snapshot-local entry handle as the
		// item's subject reference, so that handle is the join key here.
		pathBySubject[entry.ID] = relative
		payloadBySubject[entry.ID] = payloads[relative]
	}
	grouped := make(map[string][]exact.ExportItem)
	for _, item := range items {
		relative, ok := pathBySubject[item.SubjectRef]
		if !ok {
			t.Fatalf("frozen item %+v has no fixture path", item)
		}
		grouped[filepath.Base(relative)] = append(grouped[filepath.Base(relative)], item)
	}
	for base, want := range map[string][]string{
		"clip.mkv": {"clip.mkv", "clip (2).mkv", "clip (3).mkv"},
		"notes":    {"notes", "notes (2)", "notes (3)"},
	} {
		if got := namesSortedBySubject(grouped[base]); !reflect.DeepEqual(got, want) {
			t.Fatalf("%s names = %+v, want %+v", base, got, want)
		}
	}

	destination := filepath.Join(t.TempDir(), "out")
	applyAndVerifyExport(t, h, manifest, destination)
	written, err := os.ReadDir(destination)
	if err != nil {
		t.Fatalf("read destination: %v", err)
	}
	if len(written) != len(items) {
		t.Fatalf("destination holds %d outputs, want %d", len(written), len(items))
	}
	for _, item := range items {
		got, readErr := os.ReadFile(filepath.Join(destination, item.OutputName))
		if readErr != nil {
			t.Fatalf("read disambiguated output %q: %v", item.OutputName, readErr)
		}
		if want := payloadBySubject[item.SubjectRef]; string(got) != want {
			t.Fatalf("output %q = %q, want %q for subject %s", item.OutputName, got, want, item.SubjectRef)
		}
	}
}

// TestExportPlanTreatsCaseOnlyDifferencesAsCollisions proves names that differ
// only by case are disambiguated: destination filesystems such as macOS, a
// Windows volume, or a NAS SMB share may not be able to hold both names, so a
// case-only difference is a collision rather than a distinct output.
func TestExportPlanTreatsCaseOnlyDifferencesAsCollisions(t *testing.T) {
	root := t.TempDir()
	writeExportFixture(t, root, "upper/Clip.mkv", "upper payload")
	writeExportFixture(t, root, "lower/clip.mkv", "lower payload")
	h, _ := openViewExportHarness(t, root)
	files := fixtureFileEntries(t, h)
	manifest := planFixtureExport(t, h, map[string]any{"subjects": subjectRefsByPath(files)})
	items := frozenItems(t, manifest)
	if len(items) != 2 {
		t.Fatalf("frozen items = %+v, want 2", items)
	}
	if strings.EqualFold(items[0].OutputName, items[1].OutputName) {
		t.Fatalf("case-only collision survived: %+v", items)
	}
	ordered := namesSortedBySubject(items)
	if ordered[0] != "Clip.mkv" && ordered[0] != "clip.mkv" {
		t.Fatalf("first name = %q, want a plain derived name", ordered[0])
	}
	if want := strings.TrimSuffix(ordered[0], ".mkv") + " (2).mkv"; ordered[1] != want {
		t.Fatalf("second name = %q, want %q", ordered[1], want)
	}
	for _, item := range items {
		if item.OutputName != filepath.Base(item.OutputName) || item.OutputName == "." || item.OutputName == ".." {
			t.Fatalf("disambiguated name %q is not a safe single component", item.OutputName)
		}
	}
}

// TestExportPlanOutputNamingIsOrderIndependent proves planning the same frozen
// set with the subjects supplied in reversed order yields identical output
// names and an identical frozen item set. The manifest id is part of the frozen
// digest field set by design, so two independent plan calls always carry
// different manifest ids; the reproducible-layout claim is therefore checked by
// swapping the reversed-order frozen item set into the first manifest identity
// and re-deriving its canonical digest.
func TestExportPlanOutputNamingIsOrderIndependent(t *testing.T) {
	root := t.TempDir()
	collidingExportFixture(t, root)
	h, _ := openViewExportHarness(t, root)
	refs := subjectRefsByPath(fixtureFileEntries(t, h))
	forward := planFixtureExport(t, h, map[string]any{"subjects": refs})
	backward := planFixtureExport(t, h, map[string]any{"subjects": reversedStrings(refs)})

	forwardItems := frozenItems(t, forward)
	backwardItems := frozenItems(t, backward)
	if !reflect.DeepEqual(namesBySubject(forwardItems), namesBySubject(backwardItems)) {
		t.Fatalf("names differ by arrival order:\nforward  = %+v\nbackward = %+v",
			namesBySubject(forwardItems), namesBySubject(backwardItems))
	}
	if !reflect.DeepEqual(forwardItems, backwardItems) {
		t.Fatalf("frozen item sets differ by arrival order:\nforward  = %+v\nbackward = %+v", forwardItems, backwardItems)
	}

	ctx := context.Background()
	first, err := h.dispatcher.loadFrozenManifest(ctx, forward.ManifestID, forward.ManifestDigest)
	if err != nil {
		t.Fatalf("rebuild forward manifest: %v", err)
	}
	second, err := h.dispatcher.loadFrozenManifest(ctx, backward.ManifestID, backward.ManifestDigest)
	if err != nil {
		t.Fatalf("rebuild backward manifest: %v", err)
	}
	probe := first
	probe.Items = second.Items
	digest, err := probe.PrepareExportManifestDigest()
	if err != nil {
		t.Fatalf("re-derive digest over the reversed-order item set: %v", err)
	}
	if digest != first.ManifestDigest {
		t.Fatalf("digest over the reversed-order item set = %s, want %s", digest, first.ManifestDigest)
	}
}
