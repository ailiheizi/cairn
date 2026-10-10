//go:build unix

package processor

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const startupRegressionHolderEnv = "RESTOREWEAVE_ONNX_STARTUP_STDERR_HOLDER"
const startupRegressionHolderLifetime = 2 * time.Second

// This test binary doubles as a child that exits before dialing control.sock.
func TestONNXWorkerStartupRegressionChild(t *testing.T) {
	if os.Getenv(onnxWorkerSocketEnv) == "" {
		return
	}
	nonceFD, err := strconv.Atoi(os.Getenv(onnxWorkerNonceFDE))
	if err != nil || nonceFD < 3 {
		os.Exit(61)
	}
	nonceFile := os.NewFile(uintptr(nonceFD), "startup-regression-nonce")
	if nonceFile == nil {
		os.Exit(61)
	}
	if _, err := io.CopyN(io.Discard, nonceFile, onnxWorkerNonceBytes); err != nil {
		os.Exit(62)
	}
	_ = nonceFile.Close()
	mode := strings.TrimPrefix(os.Getenv(onnxWorkerGenerationEnv), "test-generation-")
	workingDir, err := os.Getwd()
	if err != nil {
		os.Exit(63)
	}
	switch mode {
	case "startup-exit-nonzero":
		_, _ = io.WriteString(os.Stderr, "worker bootstrap rejected the local runtime\n")
		os.Exit(43)
	case "startup-exit-zero":
		_, _ = io.WriteString(os.Stderr, "worker exited without publishing proof\n")
		os.Exit(0)
	case "startup-exit-large-stderr":
		_, _ = io.WriteString(os.Stderr, strings.Repeat("diagnostic-", onnxWorkerStderrLimit))
		os.Exit(47)
	case "startup-exit-inherited-stderr":
		holder := exec.Command(os.Args[0], "-test.run=^TestONNXWorkerStartupStderrHolder$")
		holder.Env = []string{startupRegressionHolderEnv + "=1"}
		// Keep the same stderr pipe open after this process exits so the
		// parent's os/exec copy goroutine must hit cmd.WaitDelay.
		holder.Stderr = os.Stderr
		if err := holder.Start(); err != nil {
			_, _ = fmt.Fprintf(os.Stderr, "failed to start stderr holder: %v\n", err)
			os.Exit(64)
		}
		pidPath := filepath.Join(workingDir, "stderr-holder.pid")
		if err := os.WriteFile(pidPath, []byte(strconv.Itoa(holder.Process.Pid)), 0o600); err != nil {
			_ = holder.Process.Kill()
			os.Exit(65)
		}
		_, _ = io.WriteString(os.Stderr, "worker exited while stderr holder remained open\n")
		// A successful child exit makes os/exec report ErrWaitDelay when its
		// inherited stderr pipe remains open, which directly proves the bound.
		os.Exit(0)
	case "startup-stall-before-connect":
		if err := os.WriteFile(filepath.Join(workingDir, "child.started"), []byte("started"), 0o600); err != nil {
			os.Exit(66)
		}
		select {}
	default:
		os.Exit(67)
	}
}

func TestONNXWorkerStartupStderrHolder(t *testing.T) {
	if os.Getenv(startupRegressionHolderEnv) != "1" {
		return
	}
	time.Sleep(startupRegressionHolderLifetime)
	workingDir, err := os.Getwd()
	if err != nil {
		os.Exit(68)
	}
	if err := os.WriteFile(filepath.Join(workingDir, "stderr-holder.finished"), []byte("finished"), 0o600); err != nil {
		os.Exit(69)
	}
}

func startupRegressionConfig(t *testing.T, mode string) onnxWorkerProofConfig {
	t.Helper()
	cfg := proofTestConfig(t, mode)
	cfg.Args = []string{"-test.run=^TestONNXWorkerStartupRegressionChild$"}
	cfg.GenerationID = "test-generation-" + mode
	return cfg
}

func isolateProofWorkerTempDir(t *testing.T) {
	t.Helper()
	root, err := os.MkdirTemp("/tmp", "rwstart-")
	if err != nil {
		t.Fatalf("create isolated proof temp directory: %v", err)
	}
	// macOS /tmp may be root:wheel; the proof intentionally requires the
	// worker directory's group to match the current user, so normalize only
	// this test-owned parent directory to the caller's primary group.
	if err := os.Chown(root, os.Getuid(), os.Getgid()); err != nil {
		_ = os.RemoveAll(root)
		t.Fatalf("set isolated proof temp directory ownership: %v", err)
	}
	t.Setenv("TMPDIR", root)
	t.Cleanup(func() { _ = os.RemoveAll(root) })
}

func proofWorkerTempRoots(t *testing.T) map[string]struct{} {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join(os.TempDir(), "restoreweave-onnx-worker-*"))
	if err != nil {
		t.Fatal(err)
	}
	roots := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		roots[path] = struct{}{}
	}
	return roots
}

func assertNoNewProofWorkerTempRoots(t *testing.T, before map[string]struct{}) {
	t.Helper()
	after := proofWorkerTempRoots(t)
	for path := range after {
		if _, existed := before[path]; !existed {
			t.Errorf("worker proof temporary root leaked: %s", path)
		}
	}
}

func TestONNXWorkerStartupReportsEarlyExitWithBoundedStderr(t *testing.T) {
	for _, tc := range []struct {
		mode       string
		want       []string
		wantMaxRun time.Duration
	}{
		{mode: "startup-exit-nonzero", want: []string{"child exited before control connection", "exit code 43", "worker bootstrap rejected the local runtime"}, wantMaxRun: 3 * time.Second},
		{mode: "startup-exit-zero", want: []string{"child exited before control connection", "exit code 0", "worker exited without publishing proof"}, wantMaxRun: 3 * time.Second},
		{mode: "startup-exit-large-stderr", want: []string{"exit code 47", "[stderr truncated after 8192 bytes]"}, wantMaxRun: 3 * time.Second},
	} {
		t.Run(tc.mode, func(t *testing.T) {
			isolateProofWorkerTempDir(t)
			before := proofWorkerTempRoots(t)
			cfg := startupRegressionConfig(t, tc.mode)
			cfg.HandshakeTimeout = 10 * time.Second
			started := time.Now()
			_, err := startONNXWorkerSession(context.Background(), cfg)
			elapsed := time.Since(started)
			if err == nil || !errors.Is(err, errONNXWorkerProofUnavailable) {
				t.Fatalf("startup error = %v, want unavailable child exit", err)
			}
			if elapsed > tc.wantMaxRun {
				t.Fatalf("early exit took %v, want under %v", elapsed, tc.wantMaxRun)
			}
			for _, want := range tc.want {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("startup error %q does not contain %q", err, want)
				}
			}
			if len(err.Error()) > onnxWorkerStderrLimit+512 {
				t.Errorf("startup error exceeded bounded diagnostic: %d bytes", len(err.Error()))
			}
			assertNoNewProofWorkerTempRoots(t, before)
		})
	}
}

func TestONNXWorkerStartupWaitDelayBoundsInheritedStderr(t *testing.T) {
	isolateProofWorkerTempDir(t)
	before := proofWorkerTempRoots(t)
	cfg := startupRegressionConfig(t, "startup-exit-inherited-stderr")
	cfg.HandshakeTimeout = 10 * time.Second
	started := time.Now()
	_, err := startONNXWorkerSession(context.Background(), cfg)
	elapsed := time.Since(started)
	if err == nil || !errors.Is(err, errONNXWorkerProofUnavailable) {
		t.Fatalf("startup error = %v, want unavailable child exit", err)
	}
	if !strings.Contains(err.Error(), "exit code 0") || !strings.Contains(err.Error(), "stderr holder remained open") {
		t.Fatalf("startup diagnostic did not preserve bounded child error: %v", err)
	}
	if !errors.Is(err, exec.ErrWaitDelay) {
		t.Fatalf("startup error = %v, want exec.ErrWaitDelay from inherited stderr pipe", err)
	}
	if elapsed >= startupRegressionHolderLifetime+time.Second {
		t.Fatalf("inherited stderr delayed child reap for %v, want bounded return while holder is still running", elapsed)
	}
	pidBytes, readErr := os.ReadFile(filepath.Join(cfg.WorkingDir, "stderr-holder.pid"))
	if readErr != nil {
		t.Fatalf("read stderr holder pid: %v", readErr)
	}
	pid, parseErr := strconv.Atoi(string(pidBytes))
	if parseErr != nil || pid <= 0 {
		t.Fatalf("stderr holder pid %q: %v", pidBytes, parseErr)
	}
	finishedPath := filepath.Join(cfg.WorkingDir, "stderr-holder.finished")
	if _, err := os.Stat(finishedPath); err == nil {
		t.Fatal("stderr holder finished before startup returned; inherited pipe was not held open through WaitDelay")
	}
	defer func() {
		if _, err := os.Stat(finishedPath); errors.Is(err, os.ErrNotExist) {
			if process, err := os.FindProcess(pid); err == nil {
				_ = process.Kill()
			}
		}
	}()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(finishedPath); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := os.Stat(finishedPath); err != nil {
		t.Fatalf("stderr holder did not exit within bound: %v", err)
	}
	// The marker proves the owned descendant completed its bounded work.
	// Do not use kill(pid, 0): Linux PID 1 may retain an exited orphan zombie.
	assertNoNewProofWorkerTempRoots(t, before)
}

func TestONNXWorkerStartupBoundsLiveChildWithoutConnection(t *testing.T) {
	isolateProofWorkerTempDir(t)
	before := proofWorkerTempRoots(t)
	cfg := startupRegressionConfig(t, "startup-stall-before-connect")
	cfg.HandshakeTimeout = 150 * time.Millisecond
	started := time.Now()
	_, err := startONNXWorkerSession(context.Background(), cfg)
	elapsed := time.Since(started)
	if err == nil || !errors.Is(err, errONNXWorkerProofUnavailable) {
		t.Fatalf("startup error = %v, want unavailable listener timeout", err)
	}
	if !strings.Contains(err.Error(), "accept child") || !strings.Contains(err.Error(), "i/o timeout") || strings.Contains(err.Error(), "child exited before control connection") {
		t.Fatalf("live no-connect child was not reported as a real accept timeout: %v", err)
	}
	if elapsed < cfg.HandshakeTimeout || elapsed > 2*time.Second {
		t.Fatalf("live-child accept timeout returned after %v, want bounded around %v", elapsed, cfg.HandshakeTimeout)
	}
	if _, err := os.Stat(filepath.Join(cfg.WorkingDir, "child.started")); err != nil {
		t.Fatalf("child did not reach its live/no-connect state: %v", err)
	}
	assertNoNewProofWorkerTempRoots(t, before)
}

func TestONNXWorkerStartupContextCancelWakesAcceptAndReaps(t *testing.T) {
	isolateProofWorkerTempDir(t)
	before := proofWorkerTempRoots(t)
	cfg := startupRegressionConfig(t, "startup-stall-before-connect")
	cfg.HandshakeTimeout = 10 * time.Second
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	type startupResult struct{ err error }
	result := make(chan startupResult, 1)
	go func() {
		_, err := startONNXWorkerSession(ctx, cfg)
		result <- startupResult{err: err}
	}()
	startedPath := filepath.Join(cfg.WorkingDir, "child.started")
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(startedPath); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := os.Stat(startedPath); err != nil {
		t.Fatal("child never reached its live/no-connect state")
	}
	canceledAt := time.Now()
	cancel()
	select {
	case got := <-result:
		if got.err == nil || !errors.Is(got.err, context.Canceled) || !errors.Is(got.err, errONNXWorkerProofUnavailable) {
			t.Fatalf("startup cancellation error = %v, want unavailable wrapping context.Canceled", got.err)
		}
		if elapsed := time.Since(canceledAt); elapsed > 2*time.Second {
			t.Fatalf("context cancellation took %v to wake startup", elapsed)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("context cancellation did not wake listener accept")
	}
	assertNoNewProofWorkerTempRoots(t, before)
}

func TestONNXWorkerSessionConcurrentCloseReapsOnce(t *testing.T) {
	isolateProofWorkerTempDir(t)
	before := proofWorkerTempRoots(t)
	session, err := startONNXWorkerSession(context.Background(), proofTestConfig(t, "valid"))
	if err != nil {
		t.Fatalf("start session: %v", err)
	}
	root := session.root
	const callers = 12
	var wg sync.WaitGroup
	errs := make(chan error, callers)
	for range callers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- session.close()
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("concurrent close: %v", err)
		}
	}
	select {
	case <-session.done:
	default:
		t.Fatal("session close returned before the sole cmd.Wait completed")
	}
	if session.cmd.ProcessState == nil || session.alive() {
		t.Errorf("closed session was not reaped: state=%v alive=%t", session.cmd.ProcessState, session.alive())
	}
	if _, err := os.Stat(root); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("session root cleanup error = %v", err)
	}
	assertNoNewProofWorkerTempRoots(t, before)
}

func TestONNXWorkerStderrConcurrentBound(t *testing.T) {
	var stderr onnxWorkerStderr
	var wg sync.WaitGroup
	for range 24 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = stderr.Write([]byte(strings.Repeat("x", onnxWorkerStderrLimit/2)))
		}()
	}
	wg.Wait()
	diagnostic := stderr.diagnostic()
	if !strings.Contains(diagnostic, "[stderr truncated after 8192 bytes]") || len(diagnostic) > onnxWorkerStderrLimit+64 {
		t.Fatalf("concurrent stderr diagnostic not bounded or marked truncated (%d bytes): %q", len(diagnostic), diagnostic[:min(len(diagnostic), 128)])
	}
}
