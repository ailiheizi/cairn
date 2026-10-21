//go:build cgo && (purego || cairn_zvec_dynamic) && arm64 && supervised_integration && (darwin || linux)

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/client/transport"
	cairnconfig "github.com/ailiheizi/cairn/config"
	"github.com/ailiheizi/cairn/server/internal/search"
)

// TestRealDaemonSemanticTextSegmentation proves suffix retrieval and immutable
// text-span provenance for ordinary extracted text and a long Note using the
// real local ONNX/BGE worker and zvec daemon. It is opt-in native evidence only.
func TestRealDaemonSemanticTextSegmentation(t *testing.T) {
	if strings.TrimSpace(os.Getenv("CAIRN_RUN_SUPERVISED_ONNX")) != "1" {
		t.Skip("CAIRN_RUN_SUPERVISED_ONNX=1 is required for native long-text evidence")
	}
	runtimeSource := strings.TrimSpace(os.Getenv("CAIRN_BGE_ONNX_RUNTIME"))
	modelSource := strings.TrimSpace(os.Getenv("CAIRN_BGE_ONNX_MODEL"))
	tokenizerSource := strings.TrimSpace(os.Getenv("CAIRN_BGE_TOKENIZER"))
	zvecSource := strings.TrimSpace(os.Getenv("CAIRN_ZVEC_LIBRARY"))
	if runtimeSource == "" || modelSource == "" || tokenizerSource == "" || zvecSource == "" {
		t.Skip("retained local BGE, ONNX runtime, tokenizer, and zvec paths are required")
	}
	for _, path := range []string{runtimeSource, modelSource, tokenizerSource, zvecSource,
		filepath.Join(filepath.Dir(runtimeSource), "onnx-binding.txt"), filepath.Join(filepath.Dir(runtimeSource), "onnx-c-api.h")} {
		if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() {
			t.Fatalf("native semantic input %s is unavailable or not a regular file: %v", path, err)
		}
	}

	workspaceRoot := testWorkspaceRoot(t)
	evidenceDir := strings.TrimSpace(os.Getenv("CAIRN_LONG_TEXT_EVIDENCE_DIR"))
	if evidenceDir == "" {
		nativeEvidenceRoot := filepath.Join(workspaceRoot, "dist", "long-note-segmentation-20261015", "native")
		if err := os.MkdirAll(nativeEvidenceRoot, 0o700); err != nil {
			t.Fatalf("create ignored native evidence root: %v", err)
		}
		createdDir, err := os.MkdirTemp(nativeEvidenceRoot, "attempt-")
		if err != nil {
			t.Fatalf("create unique native evidence attempt: %v", err)
		}
		evidenceDir = createdDir
	}
	if err := os.MkdirAll(evidenceDir, 0o700); err != nil {
		t.Fatalf("create native evidence attempt directory: %v", err)
	}
	nativeEvidenceRoot := filepath.Join(workspaceRoot, "dist", "long-note-segmentation-20261015", "native")
	rootAbs, err := filepath.Abs(nativeEvidenceRoot)
	if err != nil {
		t.Fatalf("resolve allowed native evidence root: %v", err)
	}
	evidenceAbs, err := filepath.Abs(evidenceDir)
	if err != nil {
		t.Fatalf("resolve native evidence attempt: %v", err)
	}
	relEvidence, err := filepath.Rel(rootAbs, evidenceAbs)
	if err != nil || relEvidence == ".." || strings.HasPrefix(relEvidence, ".."+string(filepath.Separator)) {
		t.Fatalf("native evidence directory must remain under %s: %s", rootAbs, evidenceAbs)
	}
	if entries, err := os.ReadDir(evidenceDir); err != nil {
		t.Fatalf("read native evidence attempt directory: %v", err)
	} else if len(entries) != 0 {
		t.Fatalf("native evidence attempt directory is not empty; refusing to overwrite existing evidence: %s", evidenceDir)
	}
	stageEvidence := map[string]any{}
	fixtureBodies := map[string][]byte{}
	privateRoot := ""
	binDir := t.TempDir()
	daemonBin := buildTestBinaryWithTags(t, workspaceRoot, "./server/cmd/cairnd", filepath.Join(binDir, "cairnd"), "cairn_zvec_dynamic")
	cairnBin := buildTestBinaryWithTags(t, workspaceRoot, "./client/cmd/cairn", filepath.Join(binDir, "cairn"), "cairn_zvec_dynamic")

	root := t.TempDir()
	privateRoot = root
	expectSemanticReceipt := false
	// Register after privateRoot's TempDir cleanup so LIFO cleanup stops the
	// daemon first, archives receipts next, and only then removes the private
	// profile. Evidence files use O_EXCL and each attempt has its own directory.
	t.Cleanup(func() {
		var copied, semanticV2 int
		if privateRoot != "" {
			walkErr := filepath.WalkDir(privateRoot, func(path string, entry os.DirEntry, walkErr error) error {
				if walkErr != nil {
					return walkErr
				}
				if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".receipt.json") {
					return nil
				}
				body, err := os.ReadFile(path)
				if err != nil {
					return err
				}
				var marker struct {
					Schema string `json:"schema"`
				}
				if err := json.Unmarshal(body, &marker); err != nil {
					return err
				}
				copied++
				name := "generation-receipt-" + strconv.Itoa(copied) + ".json"
				if marker.Schema == "cairn.semantic-generation-receipt.v2" {
					semanticV2++
					name = "semantic-zvec-receipt-v2-" + strconv.Itoa(semanticV2) + ".json"
				}
				return writeLongTextEvidenceFile(evidenceDir, name, body)
			})
			if walkErr != nil {
				t.Errorf("archive native generation receipts from private profile: %v", walkErr)
			}
		}
		if expectSemanticReceipt && semanticV2 == 0 {
			t.Errorf("native semantic rebuild produced no retained cairn.semantic-generation-receipt.v2 receipt")
		}
		for name, body := range fixtureBodies {
			if err := writeLongTextEvidenceFile(evidenceDir, name, body); err != nil {
				t.Errorf("retain native fixture %s: %v", name, err)
			}
		}
		writeLongTextNativeEvidence(t, evidenceDir, stageEvidence)
	})
	workerTempBase := os.TempDir()
	if runtime.GOOS == "darwin" {
		workerTempBase = "/tmp"
	}
	workerTempBase, err = filepath.EvalSymlinks(workerTempBase)
	if err != nil {
		t.Fatalf("resolve worker temp base: %v", err)
	}
	workerTemp, err := os.MkdirTemp(workerTempBase, "cairn-long-text-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(workerTemp) })
	if err := os.Chown(workerTemp, os.Getuid(), os.Getgid()); err != nil {
		t.Fatalf("set worker temp ownership: %v", err)
	}
	if err := os.Chmod(workerTemp, 0o700); err != nil {
		t.Fatalf("protect worker temp directory: %v", err)
	}
	dataHome := filepath.Join(root, "xdg-data")
	configPath := filepath.Join(root, "config", "config.yaml")
	env := semanticSegmentationTestEnv(dataHome, workerTemp, runtimeSource, modelSource, tokenizerSource, zvecSource)
	initConfig := exec.Command(cairnBin, "config", "init", "--path", configPath)
	initConfig.Env = env
	if output, err := initConfig.CombinedOutput(); err != nil {
		t.Fatalf("cairn config init: %v\n%s", err, output)
	}
	config, err := cairnconfig.LoadFile(configPath)
	if err != nil {
		t.Fatalf("load isolated config: %v", err)
	}
	if config.Semantic.EmbeddingMode != "local" || config.Semantic.LocalProfile != search.SemanticBundleBGEProfileID || config.Semantic.VectorBackend != "zvec" {
		t.Fatalf("generated semantic selection = %+v", config.Semantic)
	}
	bundleRoot := filepath.Join(config.Paths.Models, search.SemanticBundleBGEProfileID, runtime.GOOS+"-"+runtime.GOARCH)
	writeRealSemanticBundle(t, bundleRoot, runtimeSource, modelSource, tokenizerSource, zvecSource)
	admission, err := search.LoadSemanticBundle(bundleRoot)
	if err != nil {
		t.Fatalf("admit copied local semantic bundle: %v", err)
	}
	if err := search.ValidateDefaultSemanticBundleAdmission(admission); err != nil {
		t.Fatalf("copied local bundle does not match pinned profile: %v", err)
	}
	stageEvidence["test-identity.json"] = map[string]any{
		"test": t.Name(), "cwd": workspaceRoot, "argv": os.Args,
		"goos": runtime.GOOS, "goarch": runtime.GOARCH, "go_version": runtime.Version(),
		"goproxy": os.Getenv("GOPROXY"), "test_source_sha256": fileSHA256(t, filepath.Join(workspaceRoot, "server/cmd/cairnd/semantic_text_segmentation_integration_test.go")),
		"daemon_binary_sha256": fileSHA256(t, daemonBin), "cli_binary_sha256": fileSHA256(t, cairnBin),
		"test_binary_sha256": fileSHA256(t, mustCurrentExecutable(t)),
		"asset_paths":        map[string]string{"runtime": runtimeSource, "model": modelSource, "tokenizer": tokenizerSource, "zvec": zvecSource},
		"asset_sha256": map[string]string{"runtime": fileSHA256(t, runtimeSource), "model": fileSHA256(t, modelSource),
			"tokenizer": fileSHA256(t, tokenizerSource), "zvec": fileSHA256(t, zvecSource)},
		"bundle_root": bundleRoot, "bundle_profile_digest": admission.ProfileDigest,
	}

	// Keep the private Unix socket short enough for Darwin's path limit and
	// unique to this test process. The configured profile/data roots are fresh.
	socketPath := filepath.Join(os.TempDir(), "cairn-text-seg-"+strconv.Itoa(os.Getpid())+".sock")
	_ = os.Remove(socketPath)
	defer os.Remove(socketPath)
	daemon, daemonDone, daemonLog := startDaemonProcessWithEnv(t, env, daemonBin, socketPath, "--config", configPath)
	defer stopDaemonProcess(t, daemon, daemonDone, daemonLog)
	waitForRealDaemonCLI(t, cairnBin, socketPath, daemonDone, daemonLog, "status")
	assertModelBundleCapability(t, runRealRWProcess(t, cairnBin, socketPath, "capability", "list"), command.CapabilityAvailable)

	const extractSuffix = "特别档案：月蚀之后的青铜海燕沿北冰洋暗流寻找失联的萤火浮标。"
	const noteSuffix = "私人笔记：紫罗兰火山岛上的黑曜石山羊在极昼终结后辨认出古老的星图。"
	prefix := strings.Repeat("普通气象记录持续记载海面风向、巡检日期、船舶编号以及港口日常工作。\n", 180)
	extractBody := prefix + extractSuffix + "\n"
	noteBody := prefix + noteSuffix + "\n"
	fixtureBodies["fixture-extract-body.txt"] = []byte(extractBody)
	fixtureBodies["fixture-note-revision-1.txt"] = []byte(noteBody)
	if len(prefix) < 12000 {
		t.Fatalf("long-text prefix is only %d source bytes; expected a clearly bounded multi-thousand-byte prefix", len(prefix))
	}
	source := filepath.Join(root, "source")
	if err := os.MkdirAll(source, 0o700); err != nil {
		t.Fatal(err)
	}
	originalPath := filepath.Join(source, "long-evidence.txt")
	if err := os.WriteFile(originalPath, []byte(extractBody), 0o600); err != nil {
		t.Fatal(err)
	}
	planned := runRealRWProcess(t, cairnBin, socketPath, "ingest", source)
	stageEvidence["ingest-plan.json"] = planned
	var ingest command.PlanIngestData
	decodeProcessResult(t, planned, &ingest)
	applied := runRealRWProcess(t, cairnBin, socketPath, "plan", "apply", ingest.PlanID, "--workspace", ingest.WorkspaceID, "--digest", ingest.PlanDigest)
	stageEvidence["ordinary-ingest-apply.json"] = applied
	var appliedData command.PlanApplyData
	decodeProcessResult(t, applied, &appliedData)
	resolved := runRealRWProcess(t, cairnBin, socketPath, "namespace", "resolve", "long-evidence.txt", "--workspace", appliedData.WorkspaceID, "--root", appliedData.RootID)
	var resolvedData command.NamespaceResolveData
	decodeProcessResult(t, resolved, &resolvedData)
	if resolvedData.Entry.SubjectRef == "" || resolvedData.PathRef == "" {
		t.Fatalf("ordinary ingest did not resolve a stable file subject/path: %+v", resolvedData)
	}
	noted := runRealRWProcess(t, cairnBin, socketPath, "note", "set", resolvedData.PathRef,
		"--workspace", appliedData.WorkspaceID, "--body", noteBody)
	stageEvidence["note-revision-1.json"] = noted
	var noteData command.AnnotationUpsertData
	decodeProcessResult(t, noted, &noteData)
	if noteData.Annotation.Kind != "NOTE" || noteData.Annotation.Revision < 1 || noteData.Annotation.Body != noteBody {
		t.Fatalf("long Note upsert = %+v", noteData.Annotation)
	}

	expectSemanticReceipt = true
	coverageResult := runSemanticRebuildOperation(t, socketPath, appliedData.WorkspaceID)
	stageEvidence["semantic-source-coverage.json"] = coverageResult
	var coverage command.SearchRebuildData
	decodeProcessResult(t, coverageResult, &coverage)
	if coverageResult.Status != command.StatusSucceeded && coverageResult.Status != command.StatusDegraded {
		t.Fatalf("search.rebuild returned unsupported status=%s reasons=%+v data=%s", coverageResult.Status, coverageResult.Reasons, coverageResult.Data)
	}
	if coverage.SemanticState != command.CapabilityAvailable || coverage.SemanticSourceCoverage == nil ||
		!coverage.SemanticSourceCoverage.Available || !coverage.SemanticSourceCoverage.Complete ||
		coverage.SemanticSourceCoverage.GenerationID != coverage.SemanticGenerationRef {
		t.Fatalf("native semantic source coverage is not complete/available: state=%s generation=%s coverage=%+v reasons=%+v\ndaemon log:\n%s",
			coverage.SemanticState, coverage.SemanticGenerationRef, coverage.SemanticSourceCoverage, coverageResult.Reasons, daemonLog.String())
	}
	coverageByKind := map[string]command.SearchSemanticSourceCoverageRowData{}
	for _, row := range coverage.SemanticSourceCoverage.Rows {
		if row.SubjectID == resolvedData.Entry.SubjectRef && (row.SourceKind == "NOTE" || row.SourceKind == "EXTRACT") {
			coverageByKind[row.SourceKind] = row
		}
	}
	for _, kind := range []string{"NOTE", "EXTRACT"} {
		row, ok := coverageByKind[kind]
		if !ok || row.Disposition != command.SearchSemanticSourceIndexed || row.SegmentCount < 2 ||
			row.SegmentIndexed != row.SegmentCount || row.SegmentMissing != 0 || row.InputFull != row.SegmentCount ||
			row.InputTruncated != 0 || row.InputUnknown != 0 {
			t.Fatalf("native %s coverage = %+v; full non-truncated input evidence required", kind, row)
		}
	}

	extractQuery := runRealRWProcess(t, cairnBin, socketPath, "search", extractSuffix,
		"--workspace", appliedData.WorkspaceID, "--dimension", search.DimensionSemantic, "--generation", coverage.SemanticGenerationRef)
	stageEvidence["semantic-query-extract.json"] = extractQuery
	var extractSearch command.SearchQueryData
	decodeProcessResult(t, extractQuery, &extractSearch)
	extractSegment := requireNativeTextSuffixHit(t, extractSearch, resolvedData.Entry.SubjectRef, "ARTIFACT", extractSuffix, extractBody)
	noteQuery := runRealRWProcess(t, cairnBin, socketPath, "search", noteSuffix,
		"--workspace", appliedData.WorkspaceID, "--dimension", search.DimensionSemantic, "--generation", coverage.SemanticGenerationRef)
	stageEvidence["semantic-query-note.json"] = noteQuery
	var noteSearch command.SearchQueryData
	decodeProcessResult(t, noteQuery, &noteSearch)
	noteSegment := requireNativeTextSuffixHit(t, noteSearch, resolvedData.Entry.SubjectRef, "ANNOTATION", noteSuffix, noteBody)
	for label, segment := range map[string]command.SearchSegmentData{"extract": extractSegment, "note": noteSegment} {
		if segment.TextSourceProvenance.SourceStartByte < len(prefix)-700 {
			t.Fatalf("%s suffix source start %d was not clearly beyond the legacy prefix bound", label, segment.TextSourceProvenance.SourceStartByte)
		}
	}

	// Probe the complete distinctive tail text: unicode61 does not promise arbitrary CJK substring tokenization.
	lexical := runRealRWProcess(t, cairnBin, socketPath, "search", "月蚀之后的青铜海燕沿北冰洋暗流寻找失联的萤火浮标", "--workspace", appliedData.WorkspaceID,
		"--dimension", search.DimensionLexical, "--axis", "extracted")
	stageEvidence["lexical-query-extract.json"] = lexical
	var lexicalData command.SearchQueryData
	decodeProcessResult(t, lexical, &lexicalData)
	if !hasSearchHitForSubject(lexicalData.Hits, resolvedData.Entry.SubjectRef) {
		t.Fatalf("lexical extracted suffix query lost source subject: %+v", lexicalData.Hits)
	}

	// Ordinary Note mutation rebuilds the newest projection automatically. Query
	// the saved generation explicitly to prove its old immutable span still
	// resolves to the body/revision that created its vector.
	updatedNoteBody := prefix + "已编辑的新版本：雨后的沙漠邮局收到了另一份观测记录。\n"
	fixtureBodies["fixture-note-revision-2.txt"] = []byte(updatedNoteBody)
	updated := runRealRWProcess(t, cairnBin, socketPath, "note", "set", resolvedData.PathRef,
		"--workspace", appliedData.WorkspaceID, "--id", noteData.Annotation.ID,
		"--expected-revision", strconv.FormatInt(noteData.Annotation.Revision, 10), "--body", updatedNoteBody)
	stageEvidence["note-revision-2.json"] = updated
	var updatedData command.AnnotationUpsertData
	decodeProcessResult(t, updated, &updatedData)
	if updatedData.Annotation.Revision <= noteData.Annotation.Revision || updatedData.Annotation.Body != updatedNoteBody {
		t.Fatalf("Note revision did not advance as requested: before=%+v after=%+v", noteData.Annotation, updatedData.Annotation)
	}
	pinnedOldNote := runRealRWProcess(t, cairnBin, socketPath, "search", noteSuffix,
		"--workspace", appliedData.WorkspaceID, "--dimension", search.DimensionSemantic, "--generation", coverage.SemanticGenerationRef)
	stageEvidence["semantic-query-pinned-note.json"] = pinnedOldNote
	var pinnedData command.SearchQueryData
	decodeProcessResult(t, pinnedOldNote, &pinnedData)
	pinnedSegment := requireNativeTextSuffixHit(t, pinnedData, resolvedData.Entry.SubjectRef, "ANNOTATION", noteSuffix, noteBody)
	if pinnedSegment.TextSourceProvenance.SourceRevision != noteSegment.TextSourceProvenance.SourceRevision ||
		pinnedSegment.TextSourceProvenance.BodyDigest != noteSegment.TextSourceProvenance.BodyDigest ||
		pinnedSegment.TextSourceProvenance.SourceStartByte != noteSegment.TextSourceProvenance.SourceStartByte ||
		pinnedSegment.TextSourceProvenance.SourceEndByte != noteSegment.TextSourceProvenance.SourceEndByte {
		t.Fatalf("frozen Note hit changed immutable source span: before=%+v after=%+v", noteSegment.TextSourceProvenance, pinnedSegment.TextSourceProvenance)
	}

	verified := runRealRWProcess(t, cairnBin, socketPath, "snapshot", "verify", appliedData.SnapshotRef, "--mode", command.VerifyFullBytes)
	stageEvidence["snapshot-full-verify.json"] = verified
	var verifyData command.SnapshotVerifyData
	decodeProcessResult(t, verified, &verifyData)
	if !verifyData.OK {
		t.Fatalf("exact original verification failed: %+v", verifyData)
	}
	restoreDir := filepath.Join(root, "restored")
	restorePlanResult := runRealRWProcess(t, cairnBin, socketPath, "restore", appliedData.SnapshotRef, restoreDir)
	var restorePlan command.PlanRestoreData
	decodeProcessResult(t, restorePlanResult, &restorePlan)
	if restorePlan.Wrote || restorePlan.PlanID == "" || restorePlan.PlanDigest == "" {
		t.Fatalf("exact original restore plan = %+v", restorePlan)
	}
	restored := runRealRWProcess(t, cairnBin, socketPath, "plan", "apply", restorePlan.PlanID,
		"--workspace", restorePlan.WorkspaceID, "--digest", restorePlan.PlanDigest)
	stageEvidence["exact-restore-apply.json"] = restored
	var restoreData command.PlanApplyData
	decodeProcessResult(t, restored, &restoreData)
	restoredBytes, err := os.ReadFile(filepath.Join(restoreDir, "long-evidence.txt"))
	if err != nil || !bytes.Equal(restoredBytes, []byte(extractBody)) {
		t.Fatalf("restored original mismatch: bytes=%d err=%v", len(restoredBytes), err)
	}

	identity := stageEvidence["test-identity.json"].(map[string]any)
	identity["semantic_generation_id"] = coverage.SemanticGenerationRef
	identity["source_subject"] = resolvedData.Entry.SubjectRef
	identity["original_sha256"] = sha256TextForIntegration([]byte(extractBody))
	identity["note_body_sha256"] = sha256TextForIntegration([]byte(noteBody))
	identity["extract_coverage"] = coverageByKind["EXTRACT"]
	identity["note_coverage"] = coverageByKind["NOTE"]
	t.Logf("native long-text evidence: generation=%s extract segments=%d/full=%d suffix-span=[%d,%d) Note segments=%d/full=%d suffix-span=[%d,%d) exact-original-sha256=%s evidence=%s",
		coverage.SemanticGenerationRef,
		coverageByKind["EXTRACT"].SegmentCount, coverageByKind["EXTRACT"].InputFull,
		extractSegment.TextSourceProvenance.SourceStartByte, extractSegment.TextSourceProvenance.SourceEndByte,
		coverageByKind["NOTE"].SegmentCount, coverageByKind["NOTE"].InputFull,
		noteSegment.TextSourceProvenance.SourceStartByte, noteSegment.TextSourceProvenance.SourceEndByte,
		sha256TextForIntegration([]byte(extractBody)), evidenceDir)
}

func semanticSegmentationTestEnv(dataHome, workerTemp, runtimePath, modelPath, tokenizerPath, zvecPath string) []string {
	set := map[string]string{
		"XDG_DATA_HOME": dataHome, "TMPDIR": workerTemp,
		"CAIRN_RUN_SUPERVISED_ONNX": "1", "CAIRN_BGE_ONNX_RUNTIME": runtimePath,
		"CAIRN_BGE_ONNX_MODEL": modelPath, "CAIRN_BGE_TOKENIZER": tokenizerPath,
		"CAIRN_ZVEC_LIBRARY": zvecPath,
	}
	env := make([]string, 0, len(os.Environ())+len(set))
	for _, item := range os.Environ() {
		name, _, _ := strings.Cut(item, "=")
		if _, replaced := set[name]; !replaced {
			env = append(env, item)
		}
	}
	for key, value := range set {
		env = append(env, key+"="+value)
	}
	return env
}

func runSemanticRebuildOperation(t *testing.T, socketPath, workspaceID string) command.Result {
	t.Helper()
	input, err := json.Marshal(map[string]string{"workspace_id": workspaceID})
	if err != nil {
		t.Fatal(err)
	}
	conn, err := transport.Dial(socketPath)
	if err != nil {
		t.Fatalf("dial private daemon for search.rebuild: %v", err)
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	result, err := conn.Do(ctx, command.Envelope{Operation: command.OpSearchRebuild, Input: input})
	if err != nil {
		t.Fatalf("search.rebuild: %v", err)
	}
	return result
}

func requireNativeTextSuffixHit(t *testing.T, result command.SearchQueryData, subject, sourceType, suffix, sourceBody string) command.SearchSegmentData {
	t.Helper()
	if result.Dimension != search.DimensionSemantic || result.Provider != search.ProviderSemanticONNX || result.GenerationID == "" {
		t.Fatalf("query was not served by the native semantic generation: %+v", result)
	}
	for _, hit := range result.Hits {
		if hit.SubjectRef != subject {
			continue
		}
		for _, segment := range hit.Segments {
			provenance := segment.TextSourceProvenance
			if segment.SourceType != sourceType || provenance == nil || !strings.Contains(segment.MatchedText, suffix) {
				continue
			}
			if provenance.SourceStartByte < 0 || provenance.SourceEndByte > len(sourceBody) ||
				provenance.SourceEndByte <= provenance.SourceStartByte ||
				sourceBody[provenance.SourceStartByte:provenance.SourceEndByte] != segment.MatchedText ||
				provenance.SourceRevision == "" || provenance.BodyDigest != sha256TextForIntegration([]byte(sourceBody)) ||
				provenance.TextDigest != sha256TextForIntegration([]byte(segment.MatchedText)) ||
				provenance.SegmentationProfileDigest == "" {
				t.Fatalf("returned %s suffix span failed exact source binding: segment=%+v provenance=%+v", sourceType, segment, provenance)
			}
			return segment
		}
	}
	t.Fatalf("semantic-only query did not return source=%s suffix=%q for subject=%s; response=%+v", sourceType, suffix, subject, result)
	return command.SearchSegmentData{}
}

func hasSearchHitForSubject(hits []command.SearchHitData, subject string) bool {
	for _, hit := range hits {
		if hit.SubjectRef == subject {
			return true
		}
	}
	return false
}

func writeLongTextNativeEvidence(t *testing.T, dir string, files map[string]any) {
	t.Helper()
	for name, value := range files {
		payload, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			t.Errorf("encode native evidence %s: %v", name, err)
			continue
		}
		if err := writeLongTextEvidenceFile(dir, name, append(payload, '\n')); err != nil {
			t.Errorf("write native evidence %s: %v", name, err)
		}
	}
}

func writeLongTextEvidenceFile(dir, name string, payload []byte) error {
	path := filepath.Join(dir, name)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := file.Write(payload); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return nil
}

func fileSHA256(t *testing.T, path string) string {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read for SHA-256 %s: %v", path, err)
	}
	digest := sha256.Sum256(body)
	return "sha256:" + hex.EncodeToString(digest[:])
}

func mustCurrentExecutable(t *testing.T) string {
	t.Helper()
	path, err := os.Executable()
	if err != nil {
		t.Fatalf("resolve test executable: %v", err)
	}
	return path
}

func sha256TextForIntegration(value []byte) string {
	digest := sha256.Sum256(value)
	return "sha256:" + hex.EncodeToString(digest[:])
}
