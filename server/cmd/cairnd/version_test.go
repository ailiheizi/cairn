package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestVersionFlagReportsInjectedBuildVersion pins the operator-visible build
// identity used by scripts/offline-upgrade-inplace.sh. An upgraded
// installation must be distinguishable from the binary it replaced without
// trusting a filename, and --version must not open a catalog, repository, or
// config to answer.
func TestVersionFlagReportsInjectedBuildVersion(t *testing.T) {
	workspaceRoot := testWorkspaceRoot(t)
	target := filepath.Join(t.TempDir(), "cairnd")
	cmd := exec.Command("go", "build", "-tags", "purego",
		"-ldflags", "-X main.buildVersion=9.9.9-version-flag-test",
		"-o", target, "./server/cmd/cairnd")
	cmd.Dir = workspaceRoot
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build versioned daemon: %v\n%s", err, output)
	}

	// Run from an empty directory with no Cairn environment or config so a
	// missing-config failure would surface instead of a version answer.
	empty := t.TempDir()
	run := exec.Command(target, "--version")
	run.Dir = empty
	run.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + empty}
	output, err := run.CombinedOutput()
	if err != nil {
		t.Fatalf("cairnd --version: %v\n%s", err, output)
	}
	got := strings.TrimSpace(string(output))
	if got != "cairnd 9.9.9-version-flag-test" {
		t.Fatalf("cairnd --version = %q", got)
	}
	for _, path := range []string{
		filepath.Join(empty, "catalog.sqlite"),
		filepath.Join(empty, "repository"),
	} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("--version created %s: %v", path, err)
		}
	}
}

// TestVersionFlagWithoutInjectionStillReportsABuildIdentity keeps the honest
// fallback: an unreplaced build must still name itself rather than printing an
// empty version.
func TestVersionFlagWithoutInjectionStillReportsABuildIdentity(t *testing.T) {
	workspaceRoot := testWorkspaceRoot(t)
	target := filepath.Join(t.TempDir(), "cairnd")
	cmd := exec.Command("go", "build", "-tags", "purego", "-o", target, "./server/cmd/cairnd")
	cmd.Dir = workspaceRoot
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build unreplaced daemon: %v\n%s", err, output)
	}
	output, err := exec.Command(target, "--version").CombinedOutput()
	if err != nil {
		t.Fatalf("cairnd --version: %v\n%s", err, output)
	}
	got := strings.TrimSpace(string(output))
	if !strings.HasPrefix(got, "cairnd ") || strings.TrimSpace(strings.TrimPrefix(got, "cairnd ")) == "" {
		t.Fatalf("unreplaced cairnd --version = %q", got)
	}
	if strings.Contains(got, "dirty+dirty") {
		t.Fatalf("unreplaced cairnd --version doubled its dirty marker: %q", got)
	}
}
