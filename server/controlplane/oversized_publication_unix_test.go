//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd

package controlplane

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/repository"
)

// planIngestXAttrBytes is the per-file extended attribute that makes a small
// entry count reach a large portable record.
const planIngestXAttrBytes = 48 << 10

// nearBoundPlanFixture sizes the fixture so the projected publication lands
// just below the record bound, and falls back to many plain files when the
// filesystem does not permit test extended attributes.
func nearBoundPlanFixture(t *testing.T) (int, func(t *testing.T, path string)) {
	t.Helper()
	probe := filepath.Join(t.TempDir(), "xattr-probe")
	if err := os.WriteFile(probe, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	value := make([]byte, planIngestXAttrBytes)
	for index := range value {
		value[index] = byte('A' + index%26)
	}
	if err := unix.Lsetxattr(probe, "user.cairn.probe", value, 0); err != nil {
		// 700 plain files project to about 15 MB of portable records, still
		// close to the 16 MiB bound and applied successfully.
		return 700, nil
	}
	return 185, func(t *testing.T, path string) {
		t.Helper()
		if err := unix.Lsetxattr(path, "user.cairn.probe", value, 0); err != nil {
			t.Fatalf("set fixture xattr on %s: %v", path, err)
		}
	}
}

// TestPlanIngestAcceptsPublicationJustUnderTheRecordBoundAndAppliesIt proves
// the pre-flight guard does not take capability away: a publication sized close
// to the portable-record bound is still planned, applied, and placed under the
// bound.
func TestPlanIngestAcceptsPublicationJustUnderTheRecordBoundAndAppliesIt(t *testing.T) {
	ctx := context.Background()
	files, decorate := nearBoundPlanFixture(t)
	fixture := newPlanIngestFixtureWith(t, files, decorate)
	plannedResult := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpPlanIngest, map[string]any{"root": fixture.source}))
	if plannedResult.Status != command.StatusSucceeded {
		t.Fatalf("near-limit plan.ingest = %q %+v", plannedResult.Status, plannedResult.Reasons)
	}
	var planned command.PlanIngestData
	if err := json.Unmarshal(plannedResult.Data, &planned); err != nil {
		t.Fatal(err)
	}
	applied := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpPlanApply, map[string]any{
		"workspace_id": planned.WorkspaceID, "plan_id": planned.PlanID, "plan_digest": planned.PlanDigest,
	}))
	if applied.Status != command.StatusSucceeded {
		t.Fatalf("near-limit plan.apply = %q %+v", applied.Status, applied.Reasons)
	}
	factBytes := placedRecordBytes(t, ctx, fixture.repo, repository.RecordPortableFactClosure)
	if factBytes >= repository.MaxRecordBytes {
		t.Fatalf("placed portable fact closure = %d bytes, at or above the %d-byte bound", factBytes, repository.MaxRecordBytes)
	}
	if factBytes <= repository.MaxRecordBytes/2 {
		t.Fatalf("placed portable fact closure = %d bytes is too small to prove a near-limit publication", factBytes)
	}
}

func placedRecordBytes(t *testing.T, ctx context.Context, repo *repository.Dir, role repository.RecordRole) int64 {
	t.Helper()
	digests, err := repo.ListRecordDigests(ctx, role)
	if err != nil {
		t.Fatal(err)
	}
	if len(digests) != 1 {
		t.Fatalf("%s records = %d, want 1", role, len(digests))
	}
	body, err := repo.OpenRecord(ctx, role, digests[0])
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	payload, err := io.ReadAll(body)
	if err != nil {
		t.Fatal(err)
	}
	return int64(len(payload))
}
