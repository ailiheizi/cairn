//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package controlplane

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/restoreweave/client/command"
	"github.com/ailiheizi/restoreweave/server/internal/exact"
	"github.com/ailiheizi/restoreweave/server/internal/repository"
	"github.com/ailiheizi/restoreweave/server/testutil"
)

// TestStatusRepositoryWritabilityReportsReadOnlyRoot proves the zero-byte
// probe reports READ_ONLY with a reason, and leaves nothing behind, when the
// repository root rejects writes.
func TestStatusRepositoryWritabilityReportsReadOnlyRoot(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("permission-based probe checks do not apply to root")
	}
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
	if err := os.Chmod(repoDir, 0o500); err != nil {
		t.Fatalf("make repository root read-only: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(repoDir, 0o700) })

	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpStatusGet, map[string]any{}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("status.get = %q: %+v", result.Status, result.Reasons)
	}
	var data command.StatusData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Repository == nil ||
		data.Repository.Writable != command.RepositoryWritableStateReadOnly ||
		data.Repository.WritableReason == "" {
		t.Fatalf("read-only repository = %+v, want READ_ONLY with a reason", data.Repository)
	}
	if !data.Repository.OK {
		t.Fatalf("read-only repository marked unreadable: %+v", data.Repository)
	}
	entries, err := os.ReadDir(repoDir)
	if err != nil {
		t.Fatalf("read repository root: %v", err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), writableProbePrefix) {
			t.Fatalf("read-only probe left %q behind", entry.Name())
		}
	}
}
