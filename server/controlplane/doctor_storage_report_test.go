package controlplane

import (
	"context"
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/testutil"
)

func TestDoctorStorageReportIsExplicitAndDoesNotChangeHealth(t *testing.T) {
	store := testutil.OpenStore(t, ":memory:")
	dispatcher := NewDispatcher(store, "", "")
	ordinary := dispatcher.Handle(context.Background(), command.Envelope{Operation: command.OpDoctorCheck})
	if ordinary.Status != command.StatusDegraded {
		t.Fatalf("ordinary doctor status = %s, want degraded without exact lane", ordinary.Status)
	}
	var without command.DoctorData
	if err := json.Unmarshal(ordinary.Data, &without); err != nil {
		t.Fatal(err)
	}
	if without.StorageReport != nil {
		t.Fatalf("ordinary doctor unexpectedly performed storage measurement: %+v", without.StorageReport)
	}

	requested := dispatcher.Handle(context.Background(), command.Envelope{
		Operation: command.OpDoctorCheck,
		Input:     json.RawMessage(`{"storage_report":true}`),
	})
	if requested.Status != ordinary.Status {
		t.Fatalf("opt-in report changed command health status: %s -> %s", ordinary.Status, requested.Status)
	}
	var with command.DoctorData
	if err := json.Unmarshal(requested.Data, &with); err != nil {
		t.Fatal(err)
	}
	if with.StorageReport == nil || with.StorageReport.Status != "UNAVAILABLE" {
		t.Fatalf("missing exact lane should yield an explicitly unavailable report: %+v", with.StorageReport)
	}
	if with.StorageReport.SnapshotCount != nil {
		t.Fatalf("unavailable snapshot enumeration reported a count: %d", *with.StorageReport.SnapshotCount)
	}
	if !reflect.DeepEqual(with.Checks, without.Checks) || with.OK != without.OK {
		t.Fatalf("optional report changed doctor health checks: before=%+v after=%+v", without, with)
	}
}

func TestMeasureCatalogFilesDoesNotReportMissingCatalogAsZero(t *testing.T) {
	measure, err := measureCatalogFiles(context.Background(), filepath.Join(t.TempDir(), "missing.sqlite"), "", "")
	if err == nil {
		t.Fatalf("missing catalog was reported as a measured %d bytes", valueOrZero(measure.Bytes))
	}
}

func TestStorageReportConfiguredPathsRequireDisjointRoots(t *testing.T) {
	root := t.TempDir()
	models := filepath.Join(root, "models")
	recovery := filepath.Join(root, "recovery")
	if reason := storagePathOverlapReason(models, recovery); reason != "" {
		t.Fatalf("disjoint model and recovery roots unexpectedly overlap: %s", reason)
	}
	if reason := storagePathOverlapReason(models, filepath.Join(models, "recovery")); reason == "" {
		t.Fatal("nested model and recovery roots were treated as independently measurable")
	}
}

func TestDoctorStorageReportRequiresAuthenticatedSnapshots(t *testing.T) {
	store := testutil.OpenStore(t, ":memory:")
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repo"))
	if err != nil {
		t.Fatal(err)
	}
	dispatcher := NewDispatcher(store, "", "", WithExact(&exact.Service{Store: store, Repo: repo}))
	report := dispatcher.buildStorageReport(context.Background())
	if report.Status != "UNAVAILABLE" || report.SnapshotCount != nil || report.Reason == "" {
		t.Fatalf("unsigned snapshot listing was presented as authenticated storage evidence: %+v", report)
	}
}

func TestDoctorStorageReportAcceptsSignedSnapshotFixture(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	applied := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	_ = applied
	report := fixture.dispatcher.buildStorageReport(ctx)
	if report.Status == "UNAVAILABLE" || report.SnapshotCount == nil || *report.SnapshotCount != 1 {
		t.Fatalf("signed retained snapshot report is unavailable: %+v", report)
	}
	if report.RetainedExactReferenceBytes.Status != "MEASURED" || report.StoredObjectFileBytes.Status != "MEASURED" {
		t.Fatalf("signed exact snapshot reference/object bytes were not measured: %+v", report)
	}
}

func valueOrZero(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}
