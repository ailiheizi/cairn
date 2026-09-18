package main

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/restoreweave/server/controlplane"
	"github.com/ailiheizi/restoreweave/server/testutil"
)

// startEgressCLIDaemon runs the real control-plane server with an online
// provider installer stub (never invoked by the refusal paths below) and a
// seeded workspace, so the CLI porcelain can be exercised against real daemon
// outcomes. The success paths of install/grant are covered against the real
// installer in the controlplane test package, which can import the server's
// internal profile types.
func startEgressCLIDaemon(t *testing.T) (socketPath, workspaceID string) {
	t.Helper()
	ctx := context.Background()
	store := testutil.OpenStore(t, ":memory:")
	seed := testutil.SeedNamespace(t, store)
	workspaceID = seed.WorkspaceID
	socketPath = testutil.TempSocketPath(t)
	installer := func(context.Context, string, string, string) (controlplane.OnlineProviderInstallReceipt, error) {
		return controlplane.OnlineProviderInstallReceipt{}, errors.New("installer must not be invoked by a refused input")
	}
	dispatcher := controlplane.NewDispatcher(store, filepath.Join(t.TempDir(), "catalog.sqlite"), socketPath,
		controlplane.WithOnlineProviderInstaller(filepath.Join(t.TempDir(), "models"), installer))
	server, err := controlplane.NewServer(dispatcher, socketPath)
	if err != nil {
		t.Fatalf("start control plane server: %v", err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = server.Serve(ctx)
	}()
	t.Cleanup(func() {
		_ = server.Close()
		<-done
	})
	return socketPath, workspaceID
}

// TestCLISemanticProviderPorcelain proves the provider commands exist, reach
// the daemon, and print the daemon's own honest facts.
func TestCLISemanticProviderPorcelain(t *testing.T) {
	socketPath, _ := startEgressCLIDaemon(t)

	code, stdout, stderr := runCLI(t, "--socket", socketPath, "semantic", "provider", "list")
	if code != 0 {
		t.Fatalf("provider list exit = %d (stderr: %s)", code, stderr)
	}
	if !strings.Contains(stdout, "no online provider profiles are installed") {
		t.Fatalf("provider list output = %s", stdout)
	}

	// The daemon refuses a non-absolute source before any installer runs; the
	// CLI never uploads a document or fetches a URL.
	code, _, stderr = runCLI(t, "--socket", socketPath, "semantic", "provider", "install", "relative/profile.json",
		"--digest", "sha256:x")
	if code == 0 || !strings.Contains(stderr, "absolute") {
		t.Fatalf("relative install exit = %d, stderr = %s", code, stderr)
	}
	code, _, stderr = runCLI(t, "--socket", socketPath, "semantic", "provider", "install", "https://example.invalid/profile.json",
		"--digest", "sha256:x")
	if code == 0 || !strings.Contains(stderr, "absolute") {
		t.Fatalf("URL install exit = %d, stderr = %s", code, stderr)
	}
}

// TestCLISemanticEgressPorcelain proves the egress commands exist and surface
// the daemon's typed refusals without inventing success.
func TestCLISemanticEgressPorcelain(t *testing.T) {
	socketPath, workspaceID := startEgressCLIDaemon(t)

	code, stdout, stderr := runCLI(t, "--socket", socketPath, "semantic", "egress", "list", "--workspace", workspaceID)
	if code != 0 {
		t.Fatalf("egress list exit = %d (stderr: %s)", code, stderr)
	}
	if !strings.Contains(stdout, "no egress grants are recorded") {
		t.Fatalf("egress list output = %s", stdout)
	}

	// A past expiry is refused by the daemon with its typed reason.
	code, _, stderr = runCLI(t, "--socket", socketPath, "semantic", "egress", "grant",
		"--profile", "operator-online-v1",
		"--digest", "sha256:"+strings.Repeat("0", 64),
		"--endpoint-host", "api.example.invalid",
		"--model", "stub-embed-v1",
		"--purpose", "DOCUMENT",
		"--data-class", "text.segment",
		"--subject-class", "EXACT_PROTECTED",
		"--max-requests", "1", "--max-bytes", "1", "--max-seconds", "1",
		"--expires-at", time.Now().UTC().Add(-time.Hour).Format(time.RFC3339),
		"--workspace", workspaceID)
	if code == 0 || !strings.Contains(stderr, "future") {
		t.Fatalf("past expiry exit = %d, stderr = %s", code, stderr)
	}

	code, _, stderr = runCLI(t, "--socket", socketPath, "semantic", "egress", "revoke",
		"egt_0123456789abcdef0123456789abcdef", "--reason", "unknown", "--workspace", workspaceID)
	if code == 0 || !strings.Contains(stderr, "not found") {
		t.Fatalf("unknown revoke exit = %d, stderr = %s", code, stderr)
	}
}
