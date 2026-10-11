package controlplane

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/ailiheizi/cairn/client/command"
)

// The entry-derived facts of a restore-point summary are optional: the default
// full projection always reads them (including a genuine zero), and the bounded
// identity projection leaves them unread. A test that asserts the full
// projection must therefore fail loudly when a count is absent rather than
// reading a nil pointer as zero, which is exactly the confusion the optional
// shape exists to prevent.
func snapshotReadInt(t *testing.T, label string, value *int) int {
	t.Helper()
	if value == nil {
		t.Fatalf("%s was not read by the projection under test", label)
	}
	return *value
}

func snapshotReadBytes(t *testing.T, value *int64) int64 {
	t.Helper()
	if value == nil {
		t.Fatal("bytes were not read by the projection under test")
	}
	return *value
}

func snapshotReadFlag(t *testing.T, label string, value *bool) bool {
	t.Helper()
	if value == nil {
		t.Fatalf("%s was not read by the projection under test", label)
	}
	return *value
}

func decodeSnapshotList(t *testing.T, data json.RawMessage) command.SnapshotListData {
	t.Helper()
	var list command.SnapshotListData
	if err := json.Unmarshal(data, &list); err != nil {
		t.Fatalf("decode snapshot.list: %v", err)
	}
	return list
}

// TestSnapshotListIdentityProjectionIsBoundedAndNamesTheSameRestorePoints is the
// executable evidence for the startup fix. On a library whose publication is
// part-bound, `snapshot.list` with the identity projection must name exactly
// the same restore points as the default full projection, keep every
// authenticated identity field equal, and leave every entry-derived field
// unread — while `status.get` reports the same count without assembling a
// manifest entry at all.
func TestSnapshotListIdentityProjectionIsBoundedAndNamesTheSameRestorePoints(t *testing.T) {
	ctx := context.Background()
	// Enough entries that the publication's manifest is placed as
	// content-addressed parts rather than inline, so the identity projection
	// really is exercised on the part-bound schema.
	const files = 1200
	fixture := newPlanIngestFixture(t, files)
	planned := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpPlanIngest, map[string]any{"root": fixture.source}))
	if planned.Status != command.StatusSucceeded {
		t.Fatalf("plan.ingest = %q %+v", planned.Status, planned.Reasons)
	}
	var plan command.PlanIngestData
	if err := json.Unmarshal(planned.Data, &plan); err != nil {
		t.Fatal(err)
	}
	applied := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpPlanApply, map[string]any{
		"workspace_id": plan.WorkspaceID, "plan_id": plan.PlanID, "plan_digest": plan.PlanDigest,
	}))
	if applied.Status != command.StatusSucceeded {
		t.Fatalf("plan.apply = %q %+v", applied.Status, applied.Reasons)
	}
	var applyData command.PlanApplyData
	if err := json.Unmarshal(applied.Data, &applyData); err != nil {
		t.Fatal(err)
	}

	// A second publication in the same workspace, so the `latest` projection can
	// be checked against a restore point that is not the newest one.
	second := t.TempDir()
	for index := 0; index < 2; index++ {
		if err := os.WriteFile(filepath.Join(second, fmt.Sprintf("later-%d.txt", index)), []byte("later payload"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	secondPlanResult := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpPlanIngest, map[string]any{"root": second}))
	if secondPlanResult.Status != command.StatusSucceeded {
		t.Fatalf("second plan.ingest = %q %+v", secondPlanResult.Status, secondPlanResult.Reasons)
	}
	var secondPlan command.PlanIngestData
	if err := json.Unmarshal(secondPlanResult.Data, &secondPlan); err != nil {
		t.Fatal(err)
	}
	secondApplied := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpPlanApply, map[string]any{
		"workspace_id": secondPlan.WorkspaceID, "plan_id": secondPlan.PlanID, "plan_digest": secondPlan.PlanDigest,
	}))
	if secondApplied.Status != command.StatusSucceeded {
		t.Fatalf("second plan.apply = %q %+v", secondApplied.Status, secondApplied.Reasons)
	}
	var secondApplyData command.PlanApplyData
	if err := json.Unmarshal(secondApplied.Data, &secondApplyData); err != nil {
		t.Fatal(err)
	}

	full := decodeSnapshotList(t, fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpSnapshotList, map[string]any{})).Data)
	if len(full.Snapshots) != 2 {
		t.Fatalf("full snapshot.list returned %d restore points, want 2", len(full.Snapshots))
	}
	for _, summary := range full.Snapshots {
		if summary.Entries == nil || summary.Files == nil || summary.Bytes == nil || summary.ProtectedFiles == nil {
			t.Fatalf("the full projection left entry-derived facts unread: %+v", summary)
		}
	}
	oldest := full.Snapshots[0]
	fullSummary := full.Snapshots[1]
	if fullSummary.SnapshotRef != secondApplyData.SnapshotRef {
		t.Fatalf("full projection newest = %q, want the second publication %q", fullSummary.SnapshotRef, secondApplyData.SnapshotRef)
	}
	if snapshotReadInt(t, "entries", fullSummary.Entries) != 2 {
		t.Fatalf("full projection newest entries = %d, want 2", snapshotReadInt(t, "entries", fullSummary.Entries))
	}

	identity := decodeSnapshotList(t, fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpSnapshotList, map[string]any{"projection": "identity"})).Data)
	if len(identity.Snapshots) != len(full.Snapshots) {
		t.Fatalf("identity projection returned %d restore points, want the full projection's %d", len(identity.Snapshots), len(full.Snapshots))
	}
	for _, summary := range identity.Snapshots {
		if summary.Entries != nil || summary.Files != nil || summary.Bytes != nil ||
			summary.BytesComplete != nil || summary.ProtectedFiles != nil || summary.UnprotectedFiles != nil {
			t.Fatalf("identity projection reported entry-derived facts it did not read: %+v", summary)
		}
	}
	identitySummary := identity.Snapshots[1]
	for _, field := range []struct {
		name           string
		full, identity string
	}{
		{"snapshot_ref", fullSummary.SnapshotRef, identitySummary.SnapshotRef},
		{"created_at", fullSummary.CreatedAt, identitySummary.CreatedAt},
		{"display_path", fullSummary.DisplayPath, identitySummary.DisplayPath},
		{"manifest_digest", fullSummary.ManifestDigest, identitySummary.ManifestDigest},
		{"workspace_id", fullSummary.WorkspaceID, identitySummary.WorkspaceID},
		{"namespace_root_id", fullSummary.NamespaceRootID, identitySummary.NamespaceRootID},
	} {
		if field.identity != field.full || field.full == "" {
			t.Fatalf("identity projection %s = %q, want the full projection's %q", field.name, field.identity, field.full)
		}
	}
	if identitySummary.SnapshotRef != secondApplyData.SnapshotRef {
		t.Fatalf("identity projection named %q, want the second publication %q", identitySummary.SnapshotRef, secondApplyData.SnapshotRef)
	}
	if identitySummary.Verification == nil || identitySummary.Verification.State != command.SnapshotVerificationStateUnrecorded {
		t.Fatalf("identity projection verification = %+v, want the recorded UNRECORDED state", identitySummary.Verification)
	}

	// `latest` names every restore point, reads the facts of the newest one, and
	// still leaves an older restore point's counts absent instead of zero.
	latest := decodeSnapshotList(t, fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpSnapshotList, map[string]any{"projection": "latest"})).Data)
	if len(latest.Snapshots) != len(full.Snapshots) {
		t.Fatalf("latest projection returned %d restore points, want %d", len(latest.Snapshots), len(full.Snapshots))
	}
	latestNewest := latest.Snapshots[len(latest.Snapshots)-1]
	if latestNewest.SnapshotRef != fullSummary.SnapshotRef {
		t.Fatalf("latest projection newest = %q, want %q", latestNewest.SnapshotRef, fullSummary.SnapshotRef)
	}
	if snapshotReadInt(t, "entries", latestNewest.Entries) != snapshotReadInt(t, "entries", fullSummary.Entries) ||
		snapshotReadInt(t, "files", latestNewest.Files) != snapshotReadInt(t, "files", fullSummary.Files) ||
		snapshotReadBytes(t, latestNewest.Bytes) != snapshotReadBytes(t, fullSummary.Bytes) ||
		snapshotReadInt(t, "protected_files", latestNewest.ProtectedFiles) != snapshotReadInt(t, "protected_files", fullSummary.ProtectedFiles) {
		t.Fatalf("latest projection newest facts = %+v, want the full projection's %+v", latestNewest, fullSummary)
	}
	latestOldest := latest.Snapshots[0]
	if latestOldest.SnapshotRef != oldest.SnapshotRef {
		t.Fatalf("latest projection oldest = %q, want %q", latestOldest.SnapshotRef, oldest.SnapshotRef)
	}
	if latestOldest.Entries != nil || latestOldest.Files != nil || latestOldest.Bytes != nil || latestOldest.ProtectedFiles != nil {
		t.Fatalf("latest projection reported entry-derived facts for a restore point it did not assemble: %+v", latestOldest)
	}
	if latestOldest.Verification == nil || latestOldest.Verification.State != command.SnapshotVerificationStateUnrecorded {
		t.Fatalf("latest projection oldest verification = %+v, want the recorded UNRECORDED state", latestOldest.Verification)
	}

	// The count `status.get` reports is the same number, from the bounded read.
	var status command.StatusData
	statusResult := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpStatusGet, map[string]any{}))
	if statusResult.Status != command.StatusSucceeded {
		t.Fatalf("status.get = %q %+v", statusResult.Status, statusResult.Reasons)
	}
	if err := json.Unmarshal(statusResult.Data, &status); err != nil {
		t.Fatal(err)
	}
	if status.Repository == nil || !status.Repository.OK {
		t.Fatalf("status.get repository = %+v", status.Repository)
	}
	if status.Repository.Snapshots != len(full.Snapshots) {
		t.Fatalf("status.get snapshots = %d, want snapshot.list's %d", status.Repository.Snapshots, len(full.Snapshots))
	}

	// An unknown projection is refused as ordinary invalid input rather than
	// silently served as the full one.
	bad := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpSnapshotList, map[string]any{"projection": "protection_mix"}))
	if bad.Status != command.StatusFailed || !hasReasonCode(bad, ReasonCodeInvalidInput) {
		t.Fatalf("unknown projection: status = %q reasons = %+v", bad.Status, bad.Reasons)
	}
}
