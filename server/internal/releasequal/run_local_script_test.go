package releasequal

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestRunLocalScriptRejectsUnsafeStartup(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the local launcher requires POSIX tools")
	}
	root := repositoryRoot(t)
	script := filepath.Join(root, "scripts", "run-local.sh")
	if output, err := exec.Command("sh", "-n", script).CombinedOutput(); err != nil {
		t.Fatalf("sh syntax: %v\n%s", err, output)
	}
	payload, err := os.ReadFile(script)
	if err != nil {
		t.Fatal(err)
	}
	text := string(payload)
	for _, required := range []string{
		"--data-dir must be an absolute path",
		"loopback 127.0.0.1:PORT",
		"listen address is occupied",
		"no process was stopped",
		"-tags purego",
		"-u CAIRN_CATALOG",
	} {
		if !strings.Contains(text, required) {
			t.Fatalf("run-local.sh missing required gate %q", required)
		}
	}
	if strings.Contains(strings.ToLower(text), "docker") {
		t.Fatal("run-local.sh must not invoke Docker")
	}

	work := t.TempDir()
	absolute := filepath.Join(work, "data")
	run := func(args ...string) (string, error) {
		t.Helper()
		cmd := exec.Command("sh", append([]string{script}, args...)...)
		cmd.Dir = work
		output, err := cmd.CombinedOutput()
		return string(output), err
	}

	if output, err := run(); err == nil || !strings.Contains(output, "--data-dir is required") {
		t.Fatalf("missing data-dir: err=%v\n%s", err, output)
	}
	if output, err := run("--data-dir", "relative-data"); err == nil || !strings.Contains(output, "absolute path") {
		t.Fatalf("relative data-dir: err=%v\n%s", err, output)
	}
	if output, err := run("--data-dir", absolute, "--listen", "0.0.0.0:4538"); err == nil || !strings.Contains(output, "loopback") {
		t.Fatalf("non-loopback listen: err=%v\n%s", err, output)
	}
	if output, err := run("--data-dir", absolute, "--listen", "127.0.0.1:0"); err == nil || !strings.Contains(output, "1..65535") {
		t.Fatalf("port 0: err=%v\n%s", err, output)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	listen := fmt.Sprintf("127.0.0.1:%d", port)
	started := time.Now()
	output, err := run("--data-dir", absolute, "--listen", listen)
	if err == nil || !strings.Contains(output, "listen address is occupied") || !strings.Contains(output, "no process was stopped") {
		t.Fatalf("occupied TCP listen: err=%v\n%s", err, output)
	}
	if time.Since(started) > 8*time.Second {
		t.Fatalf("occupied-port rejection rebuilt or blocked too long: %s", time.Since(started))
	}
	if _, err := os.Lstat(filepath.Join(absolute, "bin", "cairnd")); !os.IsNotExist(err) {
		t.Fatalf("occupied-port rejection started a build: %v", err)
	}
	conn, err := net.DialTimeout("tcp", listen, time.Second)
	if err != nil {
		t.Fatalf("launcher stopped the occupant: %v", err)
	}
	_ = conn.Close()
}
