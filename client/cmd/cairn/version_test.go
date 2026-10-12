package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestCLIVersionFlagReportsInjectedBuildVersion pins the operator-visible CLI
// identity used by scripts/offline-upgrade-inplace.sh. Like the daemon, the CLI
// must answer --version without a daemon, socket, catalog, or config.
func TestCLIVersionFlagReportsInjectedBuildVersion(t *testing.T) {
	workspaceRoot := clientWorkspaceRoot(t)
	target := filepath.Join(t.TempDir(), "cairn")
	cmd := exec.Command("go", "build",
		"-ldflags", "-X main.buildVersion=9.9.9-cli-version-flag-test",
		"-o", target, "./client/cmd/cairn")
	cmd.Dir = workspaceRoot
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build versioned CLI: %v\n%s", err, output)
	}

	empty := t.TempDir()
	run := exec.Command(target, "--version")
	run.Dir = empty
	run.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + empty}
	output, err := run.CombinedOutput()
	if err != nil {
		t.Fatalf("cairn --version: %v\n%s", err, output)
	}
	if got := strings.TrimSpace(string(output)); got != "cairn 9.9.9-cli-version-flag-test" {
		t.Fatalf("cairn --version = %q", got)
	}
	if _, err := os.Stat(filepath.Join(empty, "cairn")); !os.IsNotExist(err) {
		t.Fatalf("--version created local state: %v", err)
	}
}

func clientWorkspaceRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("workspace go.mod not found")
		}
		dir = parent
	}
}
