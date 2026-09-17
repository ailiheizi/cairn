package controlplane

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/restoreweave/client/command"
	"github.com/ailiheizi/restoreweave/server/internal/exact"
	"github.com/ailiheizi/restoreweave/server/internal/repository"
	"github.com/ailiheizi/restoreweave/server/internal/search"
	"github.com/ailiheizi/restoreweave/server/internal/store/sqlite"
	"github.com/ailiheizi/restoreweave/server/testutil"
)

// TestJobListReportsRecordedJobColumns proves the job.list projection carries
// only recorded columns: a real applied plan reports its durable attempt
// bounds, an explicitly failing job reports its recorded error code and
// checkpoint hint, and an absent error code stays absent.
func TestJobListReportsRecordedJobColumns(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/rw.sock", WithExact(&exact.Service{
		Store: store,
		Repo:  repo,
	}))
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("job-list"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	ingest := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})

	jobID, err := sqlite.NewStableID(sqlite.IDPrefixJob)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Update(ctx, func(tx *sqlite.Tx) error {
		return tx.InsertJob(ctx, &sqlite.Job{
			ID: jobID, WorkspaceID: ingest.WorkspaceID, Kind: "TEST_KIND",
			State: sqlite.JobFailed, ErrorCode: "TEST_FAILURE",
			Checkpoint: json.RawMessage(`{"step":"write","completed":3}`),
			Attempt:    2, MaxAttempts: 3,
		})
	}); err != nil {
		t.Fatalf("insert failing job: %v", err)
	}

	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpJobList, map[string]any{
		"workspace_id": ingest.WorkspaceID,
		"limit":        50,
	}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("job.list = %q: %+v", result.Status, result.Reasons)
	}
	var data command.JobListData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatalf("decode job.list: %v", err)
	}
	byKind := map[string]command.JobSummary{}
	for _, job := range data.Jobs {
		byKind[job.Kind] = job
	}
	apply, ok := byKind["PLAN_APPLY"]
	if !ok || apply.State != string(sqlite.JobSucceeded) || apply.Attempt != 1 || apply.MaxAttempts != 3 {
		t.Fatalf("PLAN_APPLY summary = %+v (present=%v), want recorded attempt bounds", apply, ok)
	}
	if apply.ErrorCode != "" || apply.CheckpointPresent {
		t.Fatalf("succeeded apply fabricated failure facts: %+v", apply)
	}
	inspect, ok := byKind["PLAN_INSPECT"]
	if !ok || inspect.State != string(sqlite.JobSucceeded) || inspect.MaxAttempts != 1 {
		t.Fatalf("PLAN_INSPECT summary = %+v (present=%v)", inspect, ok)
	}
	recorded, ok := byKind["TEST_KIND"]
	if !ok {
		t.Fatalf("recorded failing job missing from job.list: %+v", data.Jobs)
	}
	if recorded.State != string(sqlite.JobFailed) || recorded.ErrorCode != "TEST_FAILURE" ||
		!recorded.CheckpointPresent || recorded.Attempt != 2 || recorded.MaxAttempts != 3 {
		t.Fatalf("failing job summary = %+v, want recorded error code and checkpoint hint", recorded)
	}

	// A real apply failure records its failure on the durable job row, and the
	// projection must carry it rather than a healthy default.
	lostRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(lostRoot, "b.txt"), []byte("lost"), 0o600); err != nil {
		t.Fatal(err)
	}
	planned := dispatcher.Handle(ctx, mustEnvelope(t, command.OpPlanIngest, map[string]any{"root": lostRoot}))
	if planned.Status != command.StatusSucceeded {
		t.Fatalf("plan.ingest = %q: %+v", planned.Status, planned.Reasons)
	}
	var lostPlan command.PlanIngestData
	if err := json.Unmarshal(planned.Data, &lostPlan); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(lostRoot); err != nil {
		t.Fatal(err)
	}
	failedApply := dispatcher.Handle(ctx, mustEnvelope(t, command.OpPlanApply, map[string]any{
		"workspace_id": lostPlan.WorkspaceID,
		"plan_id":      lostPlan.PlanID,
		"plan_digest":  lostPlan.PlanDigest,
	}))
	if failedApply.Status != command.StatusFailed {
		t.Fatalf("apply against a removed source = %q: %+v", failedApply.Status, failedApply.Reasons)
	}
	afterFailure := dispatcher.Handle(ctx, mustEnvelope(t, command.OpJobList, map[string]any{
		"workspace_id": ingest.WorkspaceID,
		"limit":        50,
	}))
	var failedData command.JobListData
	if err := json.Unmarshal(afterFailure.Data, &failedData); err != nil {
		t.Fatal(err)
	}
	var failedSummary *command.JobSummary
	for i := range failedData.Jobs {
		job := failedData.Jobs[i]
		if job.PlanID == lostPlan.PlanID && job.Kind == "PLAN_APPLY" {
			failedSummary = &failedData.Jobs[i]
		}
	}
	if failedSummary == nil || failedSummary.State != string(sqlite.JobFailed) || failedSummary.ErrorCode == "" {
		t.Fatalf("real failed apply summary = %+v, want the recorded failure state and code", failedSummary)
	}
	if len(failedApply.Reasons) == 0 || failedSummary.ErrorCode != failedApply.Reasons[0].Code {
		t.Fatalf("job error code %q does not match the reported reason %+v", failedSummary.ErrorCode, failedApply.Reasons)
	}

	otherWorkspace := dispatcher.Handle(ctx, mustEnvelope(t, command.OpJobList, map[string]any{
		"workspace_id": "wsp_00000000000000000000000000000000",
	}))
	if otherWorkspace.Status != command.StatusSucceeded {
		t.Fatalf("filtered job.list = %q: %+v", otherWorkspace.Status, otherWorkspace.Reasons)
	}
	var filtered command.JobListData
	if err := json.Unmarshal(otherWorkspace.Data, &filtered); err != nil {
		t.Fatal(err)
	}
	if len(filtered.Jobs) != 0 {
		t.Fatalf("workspace filter leaked %d jobs", len(filtered.Jobs))
	}

	invalid := dispatcher.Handle(ctx, mustEnvelope(t, command.OpJobList, map[string]any{"limit": 101}))
	if invalid.Status != command.StatusFailed || !hasReasonCode(invalid, ReasonCodeInvalidInput) {
		t.Fatalf("oversized limit = %q: %+v", invalid.Status, invalid.Reasons)
	}
}

// TestJobListIsAdvertisedAsImplemented proves the new read operation is
// reported as available and is no longer listed as unimplemented.
func TestJobListIsAdvertisedAsImplemented(t *testing.T) {
	ctx := context.Background()
	dispatcher, _ := newTestDispatcher(t)
	capabilities := dispatcher.Handle(ctx, mustEnvelope(t, command.OpCapabilityList, map[string]any{}))
	var capabilityData command.CapabilityListData
	if err := json.Unmarshal(capabilities.Data, &capabilityData); err != nil {
		t.Fatal(err)
	}
	state := ""
	for _, capability := range capabilityData.Capabilities {
		if capability.Kind == "operation" && capability.ID == command.OpJobList {
			state = capability.State
		}
	}
	if state != command.CapabilityAvailable {
		t.Fatalf("job.list capability = %q, want %s", state, command.CapabilityAvailable)
	}
	status := dispatcher.Handle(ctx, mustEnvelope(t, command.OpStatusGet, map[string]any{}))
	var statusData command.StatusData
	if err := json.Unmarshal(status.Data, &statusData); err != nil {
		t.Fatal(err)
	}
	for _, operation := range statusData.Unimplemented {
		if operation == command.OpJobList {
			t.Fatalf("job.list implemented operation listed as unimplemented")
		}
	}
}

// TestJobListEmptyCatalogIsAnEmptyList proves an untouched catalog reports no
// durable jobs instead of an error or a fabricated row.
func TestJobListEmptyCatalogIsAnEmptyList(t *testing.T) {
	dispatcher, _ := newTestDispatcher(t)
	result := dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpJobList, map[string]any{}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("job.list = %q: %+v", result.Status, result.Reasons)
	}
	var data command.JobListData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Jobs == nil || len(data.Jobs) != 0 {
		t.Fatalf("empty catalog job.list = %+v, want an empty array", data.Jobs)
	}
}

// writabilityUnknownDriver keeps read access to a real repository while
// reporting a root that does not exist, so the zero-byte probe cannot run.
type writabilityUnknownDriver struct {
	repository.Driver
	root string
}

func (d writabilityUnknownDriver) Root() string { return d.root }

func TestStatusGetReportsCatalogSchemaAndRepositoryWritability(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repoDir := filepath.Join(t.TempDir(), "repository")
	repo, err := repository.OpenDir(repoDir)
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/rw.sock", WithExact(&exact.Service{
		Store: store,
		Repo:  repo,
	}))
	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpStatusGet, map[string]any{}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("status.get = %q: %+v", result.Status, result.Reasons)
	}
	var data command.StatusData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Catalog.SchemaState != command.CatalogSchemaCurrent ||
		data.Catalog.SchemaVersion == 0 || data.Catalog.SchemaMigration == "" ||
		data.Catalog.SchemaBinaryVersion != data.Catalog.SchemaVersion ||
		data.Catalog.SchemaReason != "" {
		t.Fatalf("catalog schema facts = %+v", data.Catalog)
	}
	if data.Repository == nil {
		t.Fatal("repository status missing with an attached exact lane")
	}
	if data.Repository.Writable != command.RepositoryWritableStateWritable || data.Repository.WritableReason != "" {
		t.Fatalf("repository writability = %+v, want WRITABLE without a reason", data.Repository)
	}
	if _, err := time.Parse(time.RFC3339, data.Repository.WritableCheckedAt); err != nil {
		t.Fatalf("writable_checked_at = %q: %v", data.Repository.WritableCheckedAt, err)
	}
	if !data.Repository.OK {
		t.Fatalf("writability probe changed repository OK: %+v", data.Repository)
	}
	entries, err := os.ReadDir(repoDir)
	if err != nil {
		t.Fatalf("read repository root: %v", err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), writableProbePrefix) {
			t.Fatalf("writability probe left %q behind", entry.Name())
		}
	}

	missingRoot := filepath.Join(t.TempDir(), "missing")
	unknownDispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/rw.sock", WithExact(&exact.Service{
		Store: store,
		Repo:  writabilityUnknownDriver{Driver: repo, root: missingRoot},
	}))
	unknownResult := unknownDispatcher.Handle(ctx, mustEnvelope(t, command.OpStatusGet, map[string]any{}))
	if unknownResult.Status != command.StatusSucceeded {
		t.Fatalf("status.get with an unprobeable root = %q: %+v", unknownResult.Status, unknownResult.Reasons)
	}
	var unknownData command.StatusData
	if err := json.Unmarshal(unknownResult.Data, &unknownData); err != nil {
		t.Fatal(err)
	}
	if unknownData.Repository == nil ||
		unknownData.Repository.Writable != command.RepositoryWritableStateUnknown ||
		unknownData.Repository.WritableReason == "" {
		t.Fatalf("unprobeable repository = %+v, want UNKNOWN with a reason", unknownData.Repository)
	}
	if !unknownData.Repository.OK {
		t.Fatal("an unprobeable writability fact blocked read health")
	}
}

// TestRepositoryWritabilityProbeNeverFabricatesHealth proves a probe that
// cannot run reports UNKNOWN with a reason rather than WRITABLE or READ_ONLY.
func TestRepositoryWritabilityProbeNeverFabricatesHealth(t *testing.T) {
	unconfigured := probeRepositoryWritability("   ", time.Now())
	if unconfigured.State != command.RepositoryWritableStateUnknown || unconfigured.Reason == "" {
		t.Fatalf("unconfigured root probe = %+v, want UNKNOWN with a reason", unconfigured)
	}
	missing := probeRepositoryWritability(filepath.Join(t.TempDir(), "missing"), time.Now())
	if missing.State != command.RepositoryWritableStateUnknown || missing.Reason == "" {
		t.Fatalf("missing root probe = %+v, want UNKNOWN with a reason", missing)
	}
	if missing.CheckedAt.IsZero() {
		t.Fatal("probe did not report a check time")
	}
}

// TestStatusGetIndexProjectionMatchesPerItemVocabulary proves the status.get
// index summary reuses the per-item READY / NOT_BUILT / UNAVAILABLE logic and
// never promotes an unwired provider to READY.
func TestStatusGetIndexProjectionMatchesPerItemVocabulary(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	indexer := &search.Indexer{Store: store, Engine: &search.Engine{Dir: t.TempDir()}}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:status-index", seed.RootID); err != nil {
		t.Fatalf("initial rebuild: %v", err)
	}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/rw.sock")
	dispatcher.search = indexer

	nodes, err := store.ListNamespaceSubtree(ctx, seed.WorkspaceID, seed.RootID, "")
	if err != nil {
		t.Fatal(err)
	}
	entries := make([]sqlite.NamespaceEntry, 0, len(nodes))
	for _, node := range nodes {
		entries = append(entries, node.Entry)
	}
	perItem, err := dispatcher.contentIndexStatuses(ctx, seed.WorkspaceID, entries)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) == 0 {
		t.Fatal("seed produced no namespace entries")
	}
	sample := perItem[entries[0].SubjectRef]
	if sample == nil || sample.Lexical != "READY" {
		t.Fatalf("per-item lexical status = %+v, want READY", sample)
	}

	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpStatusGet, map[string]any{}))
	var data command.StatusData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Index) != 1 || data.Index[0].WorkspaceID != seed.WorkspaceID {
		t.Fatalf("status index projection = %+v, want one entry for %s", data.Index, seed.WorkspaceID)
	}
	if data.Index[0].Lexical != sample.Lexical {
		t.Fatalf("status.get lexical = %q, per-item = %q; the projections disagree",
			data.Index[0].Lexical, sample.Lexical)
	}
	if data.Index[0].Semantic != "UNAVAILABLE" {
		t.Fatalf("semantic without a bound provider = %q, want UNAVAILABLE", data.Index[0].Semantic)
	}

	// A bound provider with no published generation stays NOT_BUILT, not READY
	// and not UNAVAILABLE.
	dispatcher.search = &search.Indexer{
		Store:            store,
		Engine:           &search.Engine{Dir: t.TempDir()},
		SemanticProvider: dispatcherSemanticProvider{},
		SemanticZvec:     dispatcherSemanticZvec{},
		SemanticManifest: search.EmbeddingGenerationManifest{SemanticSpace: "status-facts-space"},
	}
	notBuilt := dispatcher.Handle(ctx, mustEnvelope(t, command.OpStatusGet, map[string]any{}))
	var notBuiltData command.StatusData
	if err := json.Unmarshal(notBuilt.Data, &notBuiltData); err != nil {
		t.Fatal(err)
	}
	if len(notBuiltData.Index) != 1 || notBuiltData.Index[0].Semantic != "NOT_BUILT" {
		t.Fatalf("semantic with a bound provider and no generation = %+v, want NOT_BUILT", notBuiltData.Index)
	}
}

// TestStatusGetOmitsIndexWithoutWorkspace proves an empty catalog reports no
// index entry instead of a global READY claim.
func TestStatusGetOmitsIndexWithoutWorkspace(t *testing.T) {
	dispatcher, _ := newTestDispatcher(t)
	result := dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpStatusGet, map[string]any{}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("status.get = %q: %+v", result.Status, result.Reasons)
	}
	var data command.StatusData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Index) != 0 {
		t.Fatalf("empty catalog index projection = %+v, want none", data.Index)
	}
}
