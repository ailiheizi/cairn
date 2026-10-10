//go:build unix

package processor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"

	"github.com/ailiheizi/restoreweave/server/internal/processor/sandbox"
	"github.com/ailiheizi/restoreweave/server/internal/search"
)

func requireONNXStagingNonRoot(t *testing.T) {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Fatal("ONNX staging permission acceptance must run as an ordinary non-root user")
	}
}

func onnxStagingTestBundle(t *testing.T) (string, search.SemanticBundleAdmission) {
	t.Helper()
	sourceRoot, descriptor := testONNXBundle(t)
	descriptor.Model.Path = "models/model.onnx"
	descriptor.Tokenizer.Path = "models/tokenizer.json"
	descriptor.Profile.Path = "metadata/profile.json"
	descriptor.SBOM.Path = "metadata/sbom.json"
	sources := map[string]string{
		"runtime": filepath.Join(sourceRoot, "runtime.bin"), "onnx_binding": filepath.Join(sourceRoot, "onnx-binding"),
		"onnx_c_api": filepath.Join(sourceRoot, "onnx-c-api.h"), "model": filepath.Join(sourceRoot, "model.onnx"),
		"tokenizer": filepath.Join(sourceRoot, "tokenizer"), "profile": filepath.Join(sourceRoot, "profile.json"),
		"zvec": filepath.Join(sourceRoot, "zvec.dylib"), "zvec_go": filepath.Join(sourceRoot, "zvec-go.txt"),
		"license": filepath.Join(sourceRoot, "LICENSE"), "notice": filepath.Join(sourceRoot, "NOTICE"),
		"sbom": filepath.Join(sourceRoot, "sbom.json"),
	}
	installed := filepath.Join(t.TempDir(), "admitted-bundle")
	admission, err := search.PackageSemanticBundle(installed, descriptor, sources)
	if err != nil {
		t.Fatalf("package synthetic admitted bundle: %v", err)
	}
	return installed, admission
}

func onnxStagingWorkerRoot(t *testing.T) string {
	t.Helper()
	root, err := os.MkdirTemp("", "restoreweave-onnx-worker-test-")
	if err != nil {
		t.Fatalf("create private worker root: %v", err)
	}
	if err := os.Chown(root, os.Getuid(), os.Getgid()); err != nil {
		_ = os.RemoveAll(root)
		t.Fatalf("own private worker root: %v", err)
	}
	if err := os.Chmod(root, 0o700); err != nil {
		_ = os.RemoveAll(root)
		t.Fatalf("protect private worker root: %v", err)
	}
	t.Cleanup(func() {
		if err := removeONNXWorkerRoot(root); err != nil {
			t.Errorf("clean test-owned worker root: %v", err)
		}
	})
	return root
}

func TestONNXWorkerSessionRootNormalizesInheritedGIDBeforeSocket(t *testing.T) {
	requireONNXStagingNonRoot(t)
	if parent := os.Getenv("RESTOREWEAVE_ONNX_WORKER_TEST_TMPDIR"); parent != "" {
		if info, err := os.Stat(parent); err != nil || !info.IsDir() {
			t.Fatalf("inherited-group test temp parent is unavailable: info=%v err=%v", info, err)
		}
		t.Setenv("TMPDIR", parent)
	}
	probe, err := os.MkdirTemp("", "restoreweave-onnx-worker-gid-probe-")
	if err != nil {
		t.Fatalf("create inherited-group probe: %v", err)
	}
	probeInfo, err := os.Lstat(probe)
	if err != nil {
		_ = os.Remove(probe)
		t.Fatalf("inspect inherited-group probe: %v", err)
	}
	probeStat, ok := probeInfo.Sys().(*syscall.Stat_t)
	if !ok {
		_ = os.Remove(probe)
		t.Fatal("temporary directory has no Unix ownership data")
	}
	inheritedGID := probeStat.Gid
	if err := os.Remove(probe); err != nil {
		t.Fatalf("remove inherited-group probe: %v", err)
	}
	if inheritedGID == uint32(os.Getgid()) {
		if os.Getenv("RESTOREWEAVE_ONNX_WORKER_TEST_TMPDIR") != "" {
			t.Fatalf("configured shared-temp parent did not reproduce inherited group: got gid %d, want gid different from current %d", inheritedGID, os.Getgid())
		}
		t.Skip("temporary directory does not inherit a differing group on this platform")
	}

	session, err := startONNXWorkerSession(context.Background(), proofTestConfig(t, "inherited-gid"))
	if err != nil {
		t.Fatalf("start proof session below inherited-group temp parent: %v", err)
	}
	defer session.close()
	rootInfo, err := os.Lstat(session.root)
	if err != nil {
		t.Fatalf("inspect supervisor root: %v", err)
	}
	rootStat, ok := rootInfo.Sys().(*syscall.Stat_t)
	if !ok || rootStat.Uid != uint32(os.Getuid()) || rootStat.Gid != uint32(os.Getgid()) || rootInfo.Mode().Perm() != 0o700 {
		t.Fatalf("supervisor root ownership/mode = stat:%+v mode:%04o; want uid:%d gid:%d mode:0700", rootStat, rootInfo.Mode().Perm(), os.Getuid(), os.Getgid())
	}
	socketPath := filepath.Join(session.root, "control.sock")
	socketInfo, err := os.Lstat(socketPath)
	var listener *net.UnixListener
	if errors.Is(err, os.ErrNotExist) {
		// Darwin removes a Unix socket's pathname when the accepting listener
		// closes. Recreate it under the same verified supervisor root so the
		// strict socket ownership/mode proof is still exercised there.
		listener, err = net.ListenUnix("unix", &net.UnixAddr{Name: socketPath, Net: "unix"})
		if err == nil {
			err = os.Chmod(socketPath, 0o600)
		}
		if err == nil {
			socketInfo, err = os.Lstat(socketPath)
		}
	}
	if err != nil {
		t.Fatalf("inspect supervisor socket: %v", err)
	}
	if listener != nil {
		defer listener.Close()
	}
	socketStat, ok := socketInfo.Sys().(*syscall.Stat_t)
	if !ok || socketStat.Uid != uint32(os.Getuid()) || socketStat.Gid != uint32(os.Getgid()) || socketInfo.Mode()&os.ModeSocket == 0 || socketInfo.Mode().Perm() != 0o600 {
		t.Fatalf("supervisor socket ownership/mode = stat:%+v mode:%v; want uid:%d gid:%d socket mode:0600", socketStat, socketInfo.Mode(), os.Getuid(), os.Getgid())
	}
	if err := verifyONNXWorkerProofPermissions(session.root, socketPath); err != nil {
		t.Fatalf("strict worker root/socket proof rejected normalized ownership: %v", err)
	}
}

func TestVerifyONNXWorkerProofPermissionsRejectsModesAndSymlinks(t *testing.T) {
	requireONNXStagingNonRoot(t)
	root, err := createONNXWorkerRoot()
	if err != nil {
		t.Fatalf("create private worker root: %v", err)
	}
	t.Cleanup(func() {
		if err := removeONNXWorkerRoot(root); err != nil {
			t.Errorf("clean private worker root: %v", err)
		}
	})
	socketPath := filepath.Join(root, "control.sock")
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: socketPath, Net: "unix"})
	if err != nil {
		t.Fatalf("create proof socket: %v", err)
	}
	defer listener.Close()
	if err := os.Chmod(socketPath, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := verifyONNXWorkerProofPermissions(root, socketPath); err != nil {
		t.Fatalf("valid private root/socket rejected: %v", err)
	}

	if err := os.Chmod(root, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := verifyONNXWorkerProofPermissions(root, socketPath); !errors.Is(err, errONNXWorkerProofInvalid) {
		t.Fatalf("group-readable root error = %v, want invalid proof", err)
	}
	if err := os.Chmod(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(socketPath, 0o660); err != nil {
		t.Fatal(err)
	}
	if err := verifyONNXWorkerProofPermissions(root, socketPath); !errors.Is(err, errONNXWorkerProofInvalid) {
		t.Fatalf("group-readable socket error = %v, want invalid proof", err)
	}
	if err := os.Chmod(socketPath, 0o600); err != nil {
		t.Fatal(err)
	}

	rootLink := filepath.Join(filepath.Dir(root), "restoreweave-onnx-worker-root-link")
	if err := os.Symlink(root, rootLink); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(rootLink) })
	if err := verifyONNXWorkerProofPermissions(rootLink, socketPath); !errors.Is(err, errONNXWorkerProofInvalid) {
		t.Fatalf("symlinked root error = %v, want invalid proof", err)
	}
	socketLink := filepath.Join(root, "control-link.sock")
	if err := os.Symlink(socketPath, socketLink); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(socketLink) })
	if err := verifyONNXWorkerProofPermissions(root, socketLink); !errors.Is(err, errONNXWorkerProofInvalid) {
		t.Fatalf("symlinked socket error = %v, want invalid proof", err)
	}
}

type onnxWorkerFileInfoWithSys struct {
	os.FileInfo
	sys any
}

func (i onnxWorkerFileInfoWithSys) Sys() any { return i.sys }

func TestONNXWorkerOwnershipProofRejectsForeignUIDAndGID(t *testing.T) {
	root, err := createONNXWorkerRoot()
	if err != nil {
		t.Fatalf("create private worker root: %v", err)
	}
	defer removeONNXWorkerRoot(root)
	info, err := os.Lstat(root)
	if err != nil {
		t.Fatal(err)
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		t.Fatal("worker root has no Unix ownership data")
	}
	if !onnxWorkerOwnedByCurrentUser(info) {
		t.Fatal("current uid/gid rejected")
	}
	foreignUID := *stat
	foreignUID.Uid = uint32(0)
	if foreignUID.Uid == uint32(os.Getuid()) {
		foreignUID.Uid = 1
	}
	if onnxWorkerOwnedByCurrentUser(onnxWorkerFileInfoWithSys{FileInfo: info, sys: &foreignUID}) {
		t.Fatal("foreign uid accepted")
	}
	foreignGID := *stat
	foreignGID.Gid = uint32(0)
	if foreignGID.Gid == uint32(os.Getgid()) {
		foreignGID.Gid = 1
	}
	if onnxWorkerOwnedByCurrentUser(onnxWorkerFileInfoWithSys{FileInfo: info, sys: &foreignGID}) {
		t.Fatal("foreign gid accepted")
	}
}

func isolateONNXStagingTempDir(t *testing.T) {
	t.Helper()
	root, err := os.MkdirTemp("/tmp", "rwstage-")
	if err != nil {
		t.Fatalf("create isolated temp root: %v", err)
	}
	if err := os.Chown(root, os.Getuid(), os.Getgid()); err != nil {
		_ = os.RemoveAll(root)
		t.Fatalf("own isolated temp root: %v", err)
	}
	t.Setenv("TMPDIR", root)
	t.Cleanup(func() { _ = os.RemoveAll(root) })
}

func onnxStagingTempRoots(t *testing.T) map[string]struct{} {
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

func assertONNXStagingTempRootsUnchanged(t *testing.T, before map[string]struct{}) {
	t.Helper()
	for path := range onnxStagingTempRoots(t) {
		if _, existed := before[path]; !existed {
			t.Errorf("owned worker root leaked: %s", path)
		}
	}
}

func TestStageONNXBundleCopiesAdmittedBytesThenSealsReadOnly(t *testing.T) {
	requireONNXStagingNonRoot(t)
	source, admitted := onnxStagingTestBundle(t)
	root := onnxStagingWorkerRoot(t)
	if err := stageONNXBundle(context.Background(), root, source, admitted.ProfileDigest); err != nil {
		t.Fatalf("stage admitted bundle: %v", err)
	}
	stagedRoot := filepath.Join(root, "bundle")
	staged, err := search.LoadSemanticBundle(stagedRoot)
	if err != nil {
		t.Fatalf("reload staged bundle: %v", err)
	}
	if staged.ProfileDigest != admitted.ProfileDigest {
		t.Fatalf("staged profile digest = %s, want %s", staged.ProfileDigest, admitted.ProfileDigest)
	}

	for _, asset := range []struct{ name, path string }{
		{"runtime", "runtime.bin"}, {"onnx_binding", "onnx-binding"}, {"onnx_c_api", "onnx-c-api.h"},
		{"model", "models/model.onnx"}, {"tokenizer", "models/tokenizer.json"}, {"profile", "metadata/profile.json"},
		{"zvec", "zvec.dylib"}, {"zvec_go", "zvec-go.txt"}, {"license", "LICENSE"}, {"notice", "NOTICE"},
		{"sbom", "metadata/sbom.json"},
	} {
		want, err := search.ReadSemanticBundleAsset(context.Background(), source, admitted, asset.name)
		if err != nil {
			t.Fatalf("read admitted %s: %v", asset.name, err)
		}
		got, err := search.ReadSemanticBundleAsset(context.Background(), stagedRoot, staged, asset.name)
		if err != nil {
			t.Fatalf("read staged %s: %v", asset.name, err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("staged asset %s differs from admitted source", asset.name)
		}
		sum := sha256.Sum256(got)
		if gotDigest := fmt.Sprintf("%x", sum); gotDigest != admitted.AssetDigests[asset.name] {
			t.Errorf("staged asset %s digest = %s, want %s", asset.name, gotDigest, admitted.AssetDigests[asset.name])
		}
		info, err := os.Lstat(filepath.Join(stagedRoot, filepath.FromSlash(asset.path)))
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o400 {
			t.Errorf("staged asset %s mode/type = %v, %v; want regular mode 0400", asset.name, info, err)
		}
	}
	if err := filepath.WalkDir(stagedRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("staged bundle contains symlink %s", path)
		}
		if entry.IsDir() && info.Mode().Perm() != 0o500 {
			return fmt.Errorf("staged bundle directory %s mode %04o, want 0500", path, info.Mode().Perm())
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestFailedONNXBundleStageLeavesPrivateRootRemovable(t *testing.T) {
	requireONNXStagingNonRoot(t)
	source, admitted := onnxStagingTestBundle(t)
	root := onnxStagingWorkerRoot(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := stageONNXBundle(ctx, root, source, admitted.ProfileDigest)
	if err == nil || !strings.Contains(err.Error(), "stage bundle asset") {
		t.Fatalf("canceled stage error = %v, want asset-stage failure", err)
	}
	if _, err := os.Lstat(filepath.Join(root, "bundle")); err != nil {
		t.Fatalf("partial bundle root should exist until owner cleanup: %v", err)
	}
	if err := removeONNXWorkerRoot(root); err != nil {
		t.Fatalf("remove partial worker root: %v", err)
	}
	if _, err := os.Lstat(root); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("partial worker root remains: %v", err)
	}
}

func TestONNXWorkerFailureAndCloseRemoveSealedTreeWithoutFollowingSymlink(t *testing.T) {
	requireONNXStagingNonRoot(t)
	if os.Getenv("TMPDIR") == "" {
		t.Setenv("TMPDIR", os.TempDir())
	}
	source, admitted := onnxStagingTestBundle(t)
	isolateONNXStagingTempDir(t)
	before := onnxStagingTempRoots(t)

	// On Linux, cancel from the host-owned fence check after initial config
	// validation. Staging then fails at the first context-aware asset read,
	// exercising startONNXWorkerSession's own failure cleanup after bundle/ was
	// created with construction permissions.
	cfg := proofTestConfig(t, "staging-canceled")
	if sandbox.Supported() {
		ctx, cancel := context.WithCancel(context.Background())
		cfg.Sandbox = true
		cfg.BundleRoot = source
		cfg.ConfigDigest = "sha256:" + strings.Repeat("d", 64)
		cfg.ProfileDigest = admitted.ProfileDigest
		cfg.WorkerDigest = "sha256:" + admitted.AssetDigests["onnx_binding"]
		var digestErr error
		cfg.ExecutableDigest, digestErr = digestONNXExecutable(cfg.Command)
		if digestErr != nil {
			t.Fatalf("digest test executable: %v", digestErr)
		}
		cfg.SandboxPolicyDigest = sandbox.PolicyDigest()
		cfg.FenceValidator = func(context.Context) error { cancel(); return nil }
		_, err := startONNXWorkerSession(ctx, cfg)
		cancel()
		if err == nil || !errors.Is(err, errONNXWorkerProofUnavailable) {
			t.Fatalf("canceled staging result = %v, want unavailable", err)
		}
		if !strings.Contains(err.Error(), "stage bundle asset") {
			t.Fatalf("canceled staging error does not identify bundle staging: %v", err)
		}
	} else if runtime.GOOS == "linux" {
		t.Fatal("Linux rootless staging failure test requires the admitted bubblewrap executable")
	} else {
		t.Log("session failure-path portion requires Linux bubblewrap; direct staging and cleanup are covered separately")
	}
	assertONNXStagingTempRootsUnchanged(t, before)

	// A normal attested test child is closed after its staging tree contains
	// sealed nested directories and a symlink to an external sentinel. Cleanup
	// must remove the owned session tree while preserving that target byte-for-
	// byte and without changing its mode.
	before = onnxStagingTempRoots(t)
	session, err := startONNXWorkerSession(context.Background(), proofTestConfig(t, "valid"))
	if err != nil {
		t.Fatalf("start test proof session: %v", err)
	}
	root := session.root
	outside := filepath.Join(t.TempDir(), "external-sentinel")
	if err := os.WriteFile(outside, []byte("outside-owned-root"), 0o600); err != nil {
		t.Fatal(err)
	}
	inside := filepath.Join(root, "bundle", "nested")
	if err := os.MkdirAll(inside, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(inside, "asset"), []byte("sealed"), 0o400); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(inside, "external")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(inside, 0o500); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filepath.Join(root, "bundle"), 0o500); err != nil {
		t.Fatal(err)
	}
	if err := session.close(); err != nil {
		t.Fatalf("close session with sealed tree: %v", err)
	}
	if _, err := os.Lstat(root); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("session root remains after close: %v", err)
	}
	got, err := os.ReadFile(outside)
	if err != nil || string(got) != "outside-owned-root" {
		t.Errorf("external symlink target changed or vanished: data=%q err=%v", got, err)
	}
	info, err := os.Lstat(outside)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("external sentinel metadata changed: info=%v err=%v", info, err)
	}
	assertONNXStagingTempRootsUnchanged(t, before)
}

func TestONNXWorkerRootCleanupRefusesUnownedPath(t *testing.T) {
	requireONNXStagingNonRoot(t)
	root := t.TempDir()
	err := removeONNXWorkerRoot(root)
	if err == nil {
		t.Fatal("cleanup accepted an unowned root path")
	}
	target := filepath.Join(t.TempDir(), "external-directory")
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(target, "sentinel")
	if err := os.WriteFile(sentinel, []byte("untouched"), 0o600); err != nil {
		t.Fatal(err)
	}
	rootLink := filepath.Join(t.TempDir(), "restoreweave-onnx-worker-symlink")
	if err := os.Symlink(target, rootLink); err != nil {
		t.Fatal(err)
	}
	if err := removeONNXWorkerRoot(rootLink); err == nil {
		t.Fatal("cleanup accepted a symlinked root")
	}
	if got, err := os.ReadFile(sentinel); err != nil || string(got) != "untouched" {
		t.Fatalf("external root target changed: %q, %v", got, err)
	}
}
