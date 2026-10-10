//go:build cgo && purego && arm64 && supervised_integration && (darwin || linux)

package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/client/command"
	cairnconfig "github.com/ailiheizi/cairn/config"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// TestCandidateOfflinePackageSemanticLifecycle exercises the candidate outer
// artifact, its packaged CLI and daemon, and its packaged WebUI in a clean
// temporary XDG root. It needs an operator-retained real pinned bundle; it
// never downloads model/runtime assets and is not release qualification.
func TestCandidateOfflinePackageSemanticLifecycle(t *testing.T) {
	if strings.TrimSpace(os.Getenv("CAIRN_RUN_SUPERVISED_ONNX")) != "1" {
		t.Skip("CAIRN_RUN_SUPERVISED_ONNX=1 is required for real outer-package coverage")
	}
	runtimeSource := strings.TrimSpace(os.Getenv("CAIRN_BGE_ONNX_RUNTIME"))
	modelSource := strings.TrimSpace(os.Getenv("CAIRN_BGE_ONNX_MODEL"))
	tokenizerSource := strings.TrimSpace(os.Getenv("CAIRN_BGE_TOKENIZER"))
	zvecSource := strings.TrimSpace(os.Getenv("CAIRN_ZVEC_LIBRARY"))
	if runtimeSource == "" || modelSource == "" || tokenizerSource == "" || zvecSource == "" {
		t.Skip("real BGE, ONNX runtime, and zvec asset paths are required")
	}
	workspaceRoot := testWorkspaceRoot(t)
	root := t.TempDir()
	binDir := filepath.Join(root, "build", "bin")
	if err := os.MkdirAll(binDir, 0o700); err != nil {
		t.Fatal(err)
	}
	cairnBin := buildTestBinaryWithTags(t, workspaceRoot, "./client/cmd/cairn", filepath.Join(binDir, "cairn"), "purego")
	daemonBin := buildTestBinaryWithTags(t, workspaceRoot, "./server/cmd/cairnd", filepath.Join(binDir, "cairnd"), "purego")
	webDist := filepath.Join(root, "build", "web-dist")
	if err := os.MkdirAll(webDist, 0o700); err != nil {
		t.Fatal(err)
	}
	vite := filepath.Join(workspaceRoot, "web", "node_modules", ".bin", "vite")
	webBuild := exec.Command(vite, "build", "--outDir", webDist, "--emptyOutDir")
	webBuild.Dir = filepath.Join(workspaceRoot, "web")
	if output, err := webBuild.CombinedOutput(); err != nil {
		t.Fatalf("build current WebUI into isolated output: %v\n%s", err, output)
	}

	bundleSource := filepath.Join(root, "build", "semantic-bundle")
	writeRealSemanticBundle(t, bundleSource, runtimeSource, modelSource, tokenizerSource, zvecSource)
	bundleAdmission, err := search.LoadSemanticBundle(bundleSource)
	if err != nil {
		t.Fatalf("load retained real semantic bundle: %v", err)
	}
	semanticArchive := filepath.Join(root, "build", "semantic-bundle.tar.gz")
	if _, err := search.PackageSemanticBundleArchive(context.Background(), semanticArchive, bundleSource, bundleAdmission); err != nil {
		t.Fatalf("assemble offline semantic archive: %v", err)
	}
	artifact := filepath.Join(root, "build", "cairn-candidate.tar.gz")
	packageScript := exec.Command("bash", filepath.Join(workspaceRoot, "scripts", "package-offline.sh"),
		"--version", "candidate-test", "--os", runtime.GOOS, "--arch", runtime.GOARCH,
		"--cairn", cairnBin, "--daemon", daemonBin, "--web-dist", webDist,
		"--semantic-archive", semanticArchive, "--output", artifact)
	packageScript.Dir = workspaceRoot
	if output, err := packageScript.CombinedOutput(); err != nil {
		t.Fatalf("assemble outer candidate package: %v\n%s", err, output)
	}

	installRoot := filepath.Join(root, "clean-install")
	if err := os.MkdirAll(installRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := extractCandidateArchive(artifact, installRoot); err != nil {
		t.Fatalf("extract candidate artifact: %v", err)
	}
	packageRoot := filepath.Join(installRoot, "cairn-candidate-test-"+runtime.GOOS+"-"+runtime.GOARCH)
	manifestBytes, err := os.ReadFile(filepath.Join(packageRoot, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Schema   string `json:"schema"`
		Status   string `json:"status"`
		Platform struct {
			OS   string `json:"os"`
			Arch string `json:"arch"`
		} `json:"platform"`
	}
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Schema != "cairn.candidate-offline-artifact.v1" || manifest.Status != "CANDIDATE_ONLY_NOT_SUPPORTED" || manifest.Platform.OS != runtime.GOOS || manifest.Platform.Arch != runtime.GOARCH {
		t.Fatalf("candidate manifest must bind actual host and retain candidate status: %+v", manifest)
	}
	if err := verifyCandidateChecksums(packageRoot); err != nil {
		t.Fatalf("candidate package checksums: %v", err)
	}
	for _, relative := range []string{"LICENSE", "NOTICE", "licenses/semantic-bundle.LICENSE", "licenses/semantic-bundle.NOTICE", "licenses/semantic-bundle.sbom.json"} {
		if info, err := os.Stat(filepath.Join(packageRoot, relative)); err != nil || !info.Mode().IsRegular() {
			t.Fatalf("candidate license evidence %s unavailable: %v", relative, err)
		}
	}
	var outerSBOM struct {
		Status string `json:"status"`
	}
	outerSBOMBytes, err := os.ReadFile(filepath.Join(packageRoot, "SBOM.json"))
	if err != nil || json.Unmarshal(outerSBOMBytes, &outerSBOM) != nil || outerSBOM.Status != "INCOMPLETE_NOT_RELEASE_SBOM" {
		t.Fatalf("candidate package must retain incomplete SBOM status: %s (%v)", outerSBOMBytes, err)
	}
	cairnBin = filepath.Join(packageRoot, "bin", "cairn")
	daemonBin = filepath.Join(packageRoot, "bin", "cairnd")
	webRoot := filepath.Join(packageRoot, "web", "dist")
	archivePath := filepath.Join(packageRoot, "semantic", "semantic-bundle.tar.gz")
	for _, path := range []string{cairnBin, daemonBin, archivePath, filepath.Join(webRoot, "index.html")} {
		if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() {
			t.Fatalf("packaged input %s unavailable: %v", path, err)
		}
	}

	dataHome := filepath.Join(root, "clean-xdg-data")
	configPath := filepath.Join(root, "clean-xdg-config", "cairn", "config.yaml")
	socketPath := filepath.Join(os.TempDir(), fmt.Sprintf("cairn-package-semantic-%d.sock", os.Getpid()))
	_ = os.Remove(socketPath)
	defer os.Remove(socketPath)
	apiAddress := reserveLoopbackAddress(t)
	env := append(os.Environ(), "XDG_DATA_HOME="+dataHome)
	initConfig := exec.Command(cairnBin, "config", "init", "--path", configPath)
	initConfig.Env = env
	if output, err := initConfig.CombinedOutput(); err != nil {
		t.Fatalf("packaged cairn config init: %v\n%s", err, output)
	}
	config, err := cairnconfig.LoadFile(configPath)
	if err != nil {
		t.Fatalf("load clean generated config: %v", err)
	}
	if config.Semantic.EmbeddingMode != "local" || config.Semantic.LocalProfile != search.SemanticBundleBGEProfileID || config.Semantic.VectorBackend != "zvec" {
		t.Fatalf("clean generated semantic default = %+v", config.Semantic)
	}
	start := func() (*exec.Cmd, <-chan error, *bytes.Buffer) {
		return startDaemonProcessWithEnv(t, env, daemonBin, socketPath,
			"--config", configPath, "--web-root", webRoot, "--api-listen", apiAddress)
	}
	daemon, daemonDone, daemonLog := start()
	defer func() {
		if daemon != nil && daemon.Process != nil {
			stopDaemonProcess(t, daemon, daemonDone, daemonLog)
		}
	}()
	waitForRealDaemonCLI(t, cairnBin, socketPath, daemonDone, daemonLog, "status")
	assertPackagedWebUI(t, "http://"+apiAddress, webRoot)
	assertSemanticCapability(t, runRealRWProcess(t, cairnBin, socketPath, "capability", "list"), command.CapabilityUnavailable)
	installed := runRealRWProcess(t, cairnBin, socketPath, "semantic", "bundle", "install", "--archive", archivePath)
	var installData command.SemanticBundleInstallData
	decodeProcessResult(t, installed, &installData)
	if installData.ProfileID != search.SemanticBundleBGEProfileID || !installData.Changed || !installData.RestartRequired {
		t.Fatalf("packaged bundle install = %+v", installData)
	}
	if err := os.Remove(archivePath); err != nil {
		t.Fatalf("remove bundled archive source after install: %v", err)
	}
	stop := func() {
		if err := daemon.Process.Signal(os.Interrupt); err != nil {
			t.Fatalf("stop packaged daemon: %v", err)
		}
		if err := <-daemonDone; err != nil {
			t.Fatalf("packaged daemon exit: %v\n%s", err, daemonLog.String())
		}
	}
	restart := func() {
		daemon, daemonDone, daemonLog = start()
		waitForRealDaemonCLI(t, cairnBin, socketPath, daemonDone, daemonLog, "status")
	}
	stop()
	restart()
	assertModelBundleCapability(t, runRealRWProcess(t, cairnBin, socketPath, "capability", "list"), command.CapabilityAvailable)

	source := filepath.Join(root, "source")
	if err := os.MkdirAll(source, 0o700); err != nil {
		t.Fatal(err)
	}
	payload := []byte("洪水城市档案恢复说明 exact bytes")
	if err := os.WriteFile(filepath.Join(source, "semantic.txt"), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	planned := runRealRWProcess(t, cairnBin, socketPath, "ingest", source)
	var ingest command.PlanIngestData
	decodeProcessResult(t, planned, &ingest)
	applied := runRealRWProcess(t, cairnBin, socketPath, "plan", "apply", ingest.PlanID, "--workspace", ingest.WorkspaceID, "--digest", ingest.PlanDigest)
	var appliedData command.PlanApplyData
	decodeProcessResult(t, applied, &appliedData)
	resolved := runRealRWProcess(t, cairnBin, socketPath, "namespace", "resolve", "semantic.txt", "--workspace", appliedData.WorkspaceID, "--root", appliedData.RootID)
	var resolvedData command.NamespaceResolveData
	decodeProcessResult(t, resolved, &resolvedData)
	descriptionResult := runRealRWProcess(t, cairnBin, socketPath, "description", "create", resolvedData.PathRef, "--workspace", appliedData.WorkspaceID, "--kind", "USER", "--language", "zh", "--title", "恢复说明", "--body", "洪水城市档案恢复说明")
	var description command.DescriptionCreateData
	decodeProcessResult(t, descriptionResult, &description)
	playwrightModule := os.Getenv("CAIRN_PLAYWRIGHT_MODULE")
	if playwrightModule == "" {
		playwrightModule = filepath.Join(workspaceRoot, "web", "node_modules", "playwright", "index.mjs")
	}
	chromePath := os.Getenv("CAIRN_PLAYWRIGHT_EXECUTABLE_PATH")
	if chromePath == "" {
		chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
	}
	browserRun := exec.Command("node", filepath.Join(workspaceRoot, "scripts", "web-semantic-package-e2e.mjs"))
	browserRun.Dir = workspaceRoot
	browserRun.Env = append(os.Environ(), "CAIRN_WEB_E2E_URL=http://"+apiAddress+"/", "CAIRN_PLAYWRIGHT_MODULE="+playwrightModule, "CAIRN_PLAYWRIGHT_EXECUTABLE_PATH="+chromePath)
	browserOutput, browserErr := browserRun.CombinedOutput()
	if browserErr != nil {
		t.Fatalf("packaged WebUI settings/rebuild/search browser E2E: %v\n%s", browserErr, browserOutput)
	}
	var browserResult struct {
		Provider      string `json:"provider"`
		Dimension     string `json:"dimension"`
		GenerationID  string `json:"generation_id"`
		HitCount      int    `json:"hit_count"`
		SegmentSource string `json:"segment_source"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(browserOutput), &browserResult); err != nil {
		t.Fatalf("decode packaged browser evidence: %v\n%s", err, browserOutput)
	}
	if browserResult.Provider != search.ProviderSemanticONNX || browserResult.Dimension != search.DimensionSemantic || browserResult.GenerationID == "" || browserResult.HitCount == 0 || browserResult.SegmentSource != "DESCRIPTION" {
		t.Fatalf("packaged browser semantic evidence = %+v\n%s", browserResult, browserOutput)
	}
	query := runRealRWProcess(t, cairnBin, socketPath, "search", "洪水城市", "--workspace", appliedData.WorkspaceID, "--dimension", search.DimensionSemantic)
	var semanticData command.SearchQueryData
	decodeProcessResult(t, query, &semanticData)
	if semanticData.Provider != search.ProviderSemanticONNX || len(semanticData.Hits) != 1 || len(semanticData.Hits[0].Segments) == 0 {
		t.Fatalf("packaged real semantic query = %+v", semanticData)
	}

	stop()
	restart()
	reopened := runRealRWProcess(t, cairnBin, socketPath, "search", "洪水城市", "--workspace", appliedData.WorkspaceID, "--dimension", search.DimensionSemantic)
	var reopenedData command.SearchQueryData
	decodeProcessResult(t, reopened, &reopenedData)
	if reopenedData.GenerationID != semanticData.GenerationID || len(reopenedData.Hits) == 0 {
		t.Fatalf("packaged daemon did not reopen semantic generation: %+v", reopenedData)
	}
	stop()

	store, err := sqlite.Open(context.Background(), config.Paths.Catalog, sqlite.Options{})
	if err != nil {
		t.Fatal(err)
	}
	generation, err := store.GetIndexGeneration(context.Background(), semanticData.GenerationID)
	if err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	if err := os.RemoveAll(generation.DBPath); err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	installedBundle := filepath.Join(dataHome, "cairn", "models", "bge-small-zh-v1.5", runtime.GOOS+"-"+runtime.GOARCH)
	suspendedBundle := filepath.Join(root, "suspended-semantic-bundle")
	if err := os.Rename(installedBundle, suspendedBundle); err != nil {
		t.Fatalf("isolate installed bundle to simulate unavailable provider: %v", err)
	}
	restart()
	capabilities := runRealRWProcess(t, cairnBin, socketPath, "capability", "list")
	assertSemanticCapability(t, capabilities, command.CapabilityUnavailable)
	degraded := runRWProcessAllowStatus(t, cairnBin, socketPath, "search", "洪水城市", "--workspace", appliedData.WorkspaceID, "--dimension", search.DimensionSemantic)
	if degraded.Status != command.StatusDegraded {
		t.Fatalf("missing-provider semantic query status = %s", degraded.Status)
	}
	lexical := runRealRWProcess(t, cairnBin, socketPath, "search", "洪水城市", "--workspace", appliedData.WorkspaceID, "--dimension", search.DimensionLexical)
	var lexicalData command.SearchQueryData
	decodeProcessResult(t, lexical, &lexicalData)
	if len(lexicalData.Hits) == 0 || lexicalData.Provider == search.ProviderSemanticONNX {
		t.Fatalf("lexical query did not remain available without the semantic provider: %+v", lexicalData)
	}
	verified := runRealRWProcess(t, cairnBin, socketPath, "snapshot", "verify", appliedData.SnapshotRef, "--mode", command.VerifyFullBytes)
	var verifyData command.SnapshotVerifyData
	decodeProcessResult(t, verified, &verifyData)
	if !verifyData.OK || verifyData.Files != 1 || verifyData.Bytes != int64(len(payload)) {
		t.Fatalf("exact snapshot verification while semantic unavailable = %+v", verifyData)
	}
	if err := os.Rename(suspendedBundle, installedBundle); err != nil {
		t.Fatalf("restore isolated semantic bundle: %v", err)
	}
	stop()
	restart()
	assertSemanticCapability(t, runRealRWProcess(t, cairnBin, socketPath, "capability", "list"), search.IndexStateNotBuilt)
	createdAgain := runRealRWProcess(t, cairnBin, socketPath, "description", "create", resolvedData.PathRef, "--workspace", appliedData.WorkspaceID, "--kind", "USER", "--language", "zh", "--title", "恢复说明 2", "--body", "洪水城市档案恢复说明")
	if createdAgain.Status != command.StatusSucceeded {
		t.Fatalf("semantic rebuild trigger = %s, reasons=%+v", createdAgain.Status, createdAgain.Reasons)
	}
	rebuilt := runRealRWProcess(t, cairnBin, socketPath, "search", "洪水城市", "--workspace", appliedData.WorkspaceID, "--dimension", search.DimensionSemantic)
	var rebuiltData command.SearchQueryData
	decodeProcessResult(t, rebuilt, &rebuiltData)
	if len(rebuiltData.Hits) == 0 || rebuiltData.GenerationID == semanticData.GenerationID {
		t.Fatalf("semantic provider restore did not build a fresh generation: %+v", rebuiltData)
	}
	assertSemanticCapability(t, runRealRWProcess(t, cairnBin, socketPath, "capability", "list"), command.CapabilityAvailable)
}

func extractCandidateArchive(archivePath, destination string) error {
	archive, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer archive.Close()
	gz, err := gzip.NewReader(archive)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		clean := filepath.Clean(filepath.FromSlash(header.Name))
		if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return fmt.Errorf("unsafe generated candidate archive path %q", header.Name)
		}
		path := filepath.Join(destination, clean)
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(path, 0o700); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				return err
			}
			file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, os.FileMode(header.Mode)&0o777)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(file, tr)
			closeErr := file.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		default:
			return fmt.Errorf("unexpected generated candidate archive entry %q type %d", header.Name, header.Typeflag)
		}
	}
}

func verifyCandidateChecksums(packageRoot string) error {
	checksums, err := os.ReadFile(filepath.Join(packageRoot, "checksums.sha256"))
	if err != nil {
		return err
	}
	for _, line := range strings.Split(strings.TrimSpace(string(checksums)), "\n") {
		parts := strings.SplitN(line, "  ", 2)
		if len(parts) != 2 || len(parts[0]) != 64 {
			return fmt.Errorf("malformed checksum line %q", line)
		}
		payload, err := os.ReadFile(filepath.Join(packageRoot, filepath.FromSlash(parts[1])))
		if err != nil {
			return err
		}
		digest := sha256.Sum256(payload)
		if hex.EncodeToString(digest[:]) != parts[0] {
			return fmt.Errorf("checksum mismatch for %s", parts[1])
		}
	}
	return nil
}

func reserveLoopbackAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	return address
}

func assertPackagedWebUI(t *testing.T, baseURL, webRoot string) {
	t.Helper()
	response, err := http.Get(baseURL + "/")
	if err != nil {
		t.Fatalf("request packaged WebUI: %v", err)
	}
	body, readErr := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if readErr != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("packaged WebUI response status=%d err=%v", response.StatusCode, readErr)
	}
	index, err := os.ReadFile(filepath.Join(webRoot, "index.html"))
	if err != nil || string(index) != string(body) {
		t.Fatalf("daemon did not serve the packaged WebUI index (err=%v)", err)
	}
}
