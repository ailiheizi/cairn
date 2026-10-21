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
		"-tags cairn_zvec_dynamic",
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

func TestRunLocalBuildsProfileOwnedWebRoot(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the local launcher requires POSIX tools")
	}
	root := t.TempDir()
	repo := filepath.Join(root, "repo")
	scripts := filepath.Join(repo, "scripts")
	web := filepath.Join(repo, "web")
	for _, dir := range []string{scripts, filepath.Join(web, "node_modules"), filepath.Join(web, "dist")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	launcher, err := os.ReadFile(filepath.Join(repositoryRoot(t), "scripts", "run-local.sh"))
	if err != nil {
		t.Fatal(err)
	}
	launcherPath := filepath.Join(scripts, "run-local.sh")
	if err := os.WriteFile(launcherPath, launcher, 0o755); err != nil {
		t.Fatal(err)
	}
	checkoutIndex := filepath.Join(web, "dist", "index.html")
	if err := os.WriteFile(checkoutIndex, []byte("checkout-preview"), 0o644); err != nil {
		t.Fatal(err)
	}
	fakeBin := filepath.Join(root, "fake-bin")
	if err := os.MkdirAll(fakeBin, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTool := func(name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(fakeBin, name), []byte(body), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	writeTool("curl", "#!/bin/sh\nexit 7\n")
	writeTool("go", "#!/bin/sh\nset -eu\nout=\nwhile [ \"$#\" -gt 0 ]; do if [ \"$1\" = -o ]; then shift; out=$1; fi; shift; done\ncat >\"$out\" <<'EOF'\n#!/bin/sh\nprintf '%s\\n' \"$@\" >\"$CAIRN_TEST_DAEMON_LOG\"\nEOF\nchmod +x \"$out\"\n")
	writeTool("npm", "#!/bin/sh\nset -eu\nout=\nwhile [ \"$#\" -gt 0 ]; do if [ \"$1\" = --outDir ]; then shift; out=$1; fi; shift; done\nmkdir -p \"$out\"\nif [ \"${CAIRN_TEST_NPM_FAIL:-0}\" = 1 ]; then printf partial >\"$out/partial.js\"; exit 19; fi\nprintf '%s\\n' \"$CAIRN_TEST_BUILD_MARKER\" >\"$out/index.html\"\n")
	path := fakeBin + string(os.PathListSeparator) + os.Getenv("PATH")
	runProfile := func(name, marker string) (string, string) {
		t.Helper()
		data := filepath.Join(root, name+" data")
		if err := os.MkdirAll(filepath.Join(data, "bin"), 0o755); err != nil {
			t.Fatal(err)
		}
		legacyWeb := filepath.Join(data, "web", "dist")
		if err := os.MkdirAll(legacyWeb, 0o755); err != nil {
			t.Fatal(err)
		}
		legacyIndex := filepath.Join(legacyWeb, "index.html")
		if err := os.WriteFile(legacyIndex, []byte("preexisting-profile-assets"), 0o644); err != nil {
			t.Fatal(err)
		}
		config := filepath.Join(data, "config.toml")
		originalConfig := []byte("persisted-" + name)
		if err := os.WriteFile(config, originalConfig, 0o600); err != nil {
			t.Fatal(err)
		}
		logPath := filepath.Join(root, name+"-argv.txt")
		cmd := exec.Command("sh", launcherPath, "--data-dir", data, "--listen", "127.0.0.1:4539")
		cmd.Env = filteredEnv(os.Environ(), "PATH", "CAIRN_TEST_DAEMON_LOG", "CAIRN_TEST_BUILD_MARKER", "CAIRN_TEST_NPM_FAIL")
		cmd.Env = append(cmd.Env, "PATH="+path, "CAIRN_TEST_DAEMON_LOG="+logPath, "CAIRN_TEST_BUILD_MARKER="+marker)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("run-local %s: %v\n%s", name, err, out)
		}
		gotConfig, err := os.ReadFile(config)
		if err != nil || string(gotConfig) != string(originalConfig) {
			t.Fatalf("config %s changed: %q (%v)", name, gotConfig, err)
		}
		argv, err := os.ReadFile(logPath)
		if err != nil {
			t.Fatalf("daemon argv %s: %v", name, err)
		}
		gotLegacy, err := os.ReadFile(legacyIndex)
		if err != nil || string(gotLegacy) != "preexisting-profile-assets" {
			t.Fatalf("profile %s changed preexisting web/dist: %q (%v)", name, gotLegacy, err)
		}
		return webRootArgument(string(argv)), string(argv)
	}
	webA, argvA := runProfile("profile-a", "web-a")
	if filepath.Dir(webA) != filepath.Join(root, "profile-a data", "web") || !strings.HasPrefix(filepath.Base(webA), "dist.") {
		t.Fatalf("profile A WebUI root is not a fresh profile-owned directory: %s", webA)
	}
	indexA := filepath.Join(webA, "index.html")
	bytesA, err := os.ReadFile(indexA)
	if err != nil || string(bytesA) != "web-a\n" {
		t.Fatalf("profile A output %q (%v)", bytesA, err)
	}
	if !strings.Contains(argvA, "--web-root\n"+webA+"\n") {
		t.Fatalf("profile A argv lacks owned web root:\n%s", argvA)
	}
	webB, argvB := runProfile("profile-b", "web-b")
	if filepath.Dir(webB) != filepath.Join(root, "profile-b data", "web") || !strings.HasPrefix(filepath.Base(webB), "dist.") {
		t.Fatalf("profile B WebUI root is not a fresh profile-owned directory: %s", webB)
	}
	bytesB, err := os.ReadFile(filepath.Join(webB, "index.html"))
	if err != nil || string(bytesB) != "web-b\n" {
		t.Fatalf("profile B output %q (%v)", bytesB, err)
	}
	if !strings.Contains(argvB, "--web-root\n"+webB+"\n") {
		t.Fatalf("profile B argv lacks owned web root:\n%s", argvB)
	}
	if got, err := os.ReadFile(indexA); err != nil || string(got) != string(bytesA) {
		t.Fatalf("profile B changed A WebUI: %q (%v)", got, err)
	}
	if got, err := os.ReadFile(checkoutIndex); err != nil || string(got) != "checkout-preview" {
		t.Fatalf("profile launch changed checkout web/dist: %q (%v)", got, err)
	}

	failureData := filepath.Join(root, "profile-failure data")
	if err := os.MkdirAll(filepath.Join(failureData, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	failureConfig := filepath.Join(failureData, "config.toml")
	if err := os.WriteFile(failureConfig, []byte("persisted-failure-profile"), 0o600); err != nil {
		t.Fatal(err)
	}
	failureLegacyWeb := filepath.Join(failureData, "web", "dist")
	if err := os.MkdirAll(failureLegacyWeb, 0o755); err != nil {
		t.Fatal(err)
	}
	failureLegacyIndex := filepath.Join(failureLegacyWeb, "index.html")
	if err := os.WriteFile(failureLegacyIndex, []byte("failure-profile-assets"), 0o644); err != nil {
		t.Fatal(err)
	}
	failureLog := filepath.Join(root, "failure-daemon-argv.txt")
	failureCmd := exec.Command("sh", launcherPath, "--data-dir", failureData, "--listen", "127.0.0.1:4540")
	failureCmd.Env = filteredEnv(os.Environ(), "PATH", "CAIRN_TEST_DAEMON_LOG", "CAIRN_TEST_BUILD_MARKER", "CAIRN_TEST_NPM_FAIL")
	failureCmd.Env = append(failureCmd.Env, "PATH="+path, "CAIRN_TEST_DAEMON_LOG="+failureLog, "CAIRN_TEST_BUILD_MARKER=should-not-be-written", "CAIRN_TEST_NPM_FAIL=1")
	failureOutput, failureErr := failureCmd.CombinedOutput()
	if failureErr == nil {
		t.Fatalf("launcher accepted simulated WebUI build failure:\n%s", failureOutput)
	}
	if _, err := os.Stat(failureLog); !os.IsNotExist(err) {
		t.Fatalf("daemon started after WebUI build failure: %v", err)
	}
	if got, err := os.ReadFile(failureLegacyIndex); err != nil || string(got) != "failure-profile-assets" {
		t.Fatalf("failed build changed preexisting profile assets: %q (%v)", got, err)
	}
	if got, err := os.ReadFile(failureConfig); err != nil || string(got) != "persisted-failure-profile" {
		t.Fatalf("failed build changed persisted config: %q (%v)", got, err)
	}
	entries, err := os.ReadDir(filepath.Join(failureData, "web"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "dist" {
		t.Fatalf("failed build left temporary output behind: %v", entries)
	}
}

func webRootArgument(argv string) string {
	lines := strings.Split(strings.TrimSpace(argv), "\n")
	for i := 0; i+1 < len(lines); i++ {
		if lines[i] == "--web-root" {
			return lines[i+1]
		}
	}
	return ""
}

func filteredEnv(env []string, names ...string) []string {
	filtered := make([]string, 0, len(env))
	for _, item := range env {
		remove := false
		for _, name := range names {
			if strings.HasPrefix(item, name+"=") {
				remove = true
				break
			}
		}
		if !remove {
			filtered = append(filtered, item)
		}
	}
	return filtered
}
