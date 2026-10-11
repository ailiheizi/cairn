//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd

package exact

import (
	"context"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"

	"github.com/ailiheizi/cairn/server/internal/repository"
)

// projectionXAttrBytes is the per-file extended attribute used to make a small
// entry count reach a large portable record. The captured value appears in the
// manifest entry and again in the portable fact child, both base64-encoded.
const projectionXAttrBytes = 48 << 10

// decorateProjectionFile attaches a large extended attribute, skipping the test
// when the filesystem does not permit test xattrs (the same convention the
// filesystem-fact tests use).
func decorateProjectionFile(t *testing.T, path string) {
	t.Helper()
	value := make([]byte, projectionXAttrBytes)
	for index := range value {
		value[index] = byte('A' + index%26)
	}
	if err := unix.Lsetxattr(filepath.Clean(path), "user.cairn.projection", value, 0); err != nil {
		t.Skipf("filesystem does not permit test xattrs: %v", err)
	}
}

// TestInspectIngestAcceptsPublicationJustUnderTheRecordBoundAndAppliesIt is the
// other half of the pre-flight guard: a publication sized close to the bound is
// still planned and applied, so the refusal does not take capability away from
// work that fits. A 48 KiB extended attribute per file puts the projected
// portable fact child just below the 16 MiB bound with few entries, which keeps
// the real apply cheap.
func TestInspectIngestAcceptsPublicationJustUnderTheRecordBoundAndAppliesIt(t *testing.T) {
	ctx := context.Background()
	fixture := newProjectionFixtureWith(t, 200, decorateProjectionFile)
	if fixture.projection.ExceedsLimit() {
		t.Fatalf("near-limit fixture was refused: %+v", fixture.projection)
	}
	// The bound is only meaningful if the fixture actually approaches it.
	if largest := fixture.projection.LargestBytes(); largest <= repository.MaxRecordBytes*9/10 {
		t.Fatalf("projected largest record = %d, want more than 90%% of the %d-byte bound for a near-limit fixture",
			largest, repository.MaxRecordBytes)
	}
	plan, err := fixture.service.InspectIngest(ctx, fixture.source, IngestOptions{})
	if err != nil {
		t.Fatalf("near-limit inspect ingest: %v", err)
	}
	result, err := fixture.service.ApplyIngestPlanWithExecutionKey(ctx, plan, "sha256:near-limit-plan")
	if err != nil {
		t.Fatalf("near-limit apply: %v", err)
	}
	if result.PreparedClosureDigest == "" || result.PublicationCommitDigest == "" {
		t.Fatalf("near-limit apply did not publish a signed closure: %+v", result)
	}
	factBytes := placedFactClosureBytes(t, ctx, fixture.repo, repository.RecordPortableFactClosure)
	if factBytes >= repository.MaxRecordBytes {
		t.Fatalf("placed portable fact closure = %d bytes, at or above the %d-byte bound", factBytes, repository.MaxRecordBytes)
	}
	if factBytes <= repository.MaxRecordBytes/2 {
		t.Fatalf("placed portable fact closure = %d bytes is too small to prove a near-limit publication", factBytes)
	}
}
