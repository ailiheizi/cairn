package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	cairnconfig "github.com/ailiheizi/cairn/config"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestRecoveryCatalogProjectionRealDaemonCLI(t *testing.T) {
	workspaceRoot := testWorkspaceRoot(t)
	root := t.TempDir()
	binDir := filepath.Join(root, "bin")
	if err := os.MkdirAll(binDir, 0o700); err != nil {
		t.Fatal(err)
	}
	daemonBin := buildTestBinary(t, workspaceRoot, "./server/cmd/cairnd", filepath.Join(binDir, "cairnd"))
	cairnBin := buildTestBinary(t, workspaceRoot, "./client/cmd/cairn", filepath.Join(binDir, "cairn"))
	dataHome := filepath.Join(root, "xdg-data")
	configPath := filepath.Join(root, "config", "config.toml")
	cliEnv := append(os.Environ(), "XDG_DATA_HOME="+dataHome)
	initConfig := exec.Command(cairnBin, "config", "init", "--path", configPath)
	initConfig.Env = cliEnv
	if output, err := initConfig.CombinedOutput(); err != nil {
		t.Fatalf("config init: %v\n%s", err, output)
	}
	cfg, err := cairnconfig.LoadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{cfg.Paths.Catalog, cfg.Paths.Repository, cfg.Paths.Vectors, cfg.Paths.RecoveryRecords} {
		if !strings.HasPrefix(filepath.Clean(path), filepath.Clean(dataHome)+string(filepath.Separator)) {
			t.Fatalf("configured path escaped test XDG_DATA_HOME: %q", path)
		}
	}
	runRoot := filepath.Join(root, "run")
	if err := os.MkdirAll(runRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(runRoot, "source")
	if err := os.MkdirAll(filepath.Join(source, "nested"), 0o700); err != nil {
		t.Fatal(err)
	}
	payloads := map[string][]byte{
		"nested/cedar-notes.bin": []byte("exact payload: first archive\x00\x01\n"),
		"quiet-map.txt":          []byte("second small file with exact length\n"),
	}
	wantContentIDs := make(map[string]string, len(payloads))
	for rel, payload := range payloads {
		path := filepath.Join(source, filepath.FromSlash(rel))
		if err := os.WriteFile(path, payload, 0o600); err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(payload)
		wantContentIDs[rel] = "sha256:" + hex.EncodeToString(sum[:])
	}
	socketSequence := 0
	newSocket := func(label string) string {
		socketSequence++
		socketPath := filepath.Join("/tmp", fmt.Sprintf("cairn-e2e-%d-%d-%d-%s.sock", os.Getpid(), time.Now().UnixNano(), socketSequence, label))
		t.Cleanup(func() { _ = os.Remove(socketPath) })
		return socketPath
	}

	writerSocket := newSocket("writer")
	writer, writerDone, writerLog := startDaemonProcessWithEnv(t, cliEnv, daemonBin, writerSocket, "--config", configPath)
	defer stopDaemonProcess(t, writer, writerDone, writerLog)
	waitForCLI(t, cairnBin, writerSocket, writerDone, writerLog, "status")
	planned := runRWProcess(t, cairnBin, writerSocket, "ingest", source)
	var ingest command.PlanIngestData
	decodeProcessResult(t, planned, &ingest)
	if ingest.Files != len(payloads) || !ingest.Executable || ingest.WorkspaceID == "" {
		t.Fatalf("ingest plan = %+v", ingest)
	}
	applied := runRWProcess(t, cairnBin, writerSocket, "plan", "apply", ingest.PlanID,
		"--workspace", ingest.WorkspaceID, "--digest", ingest.PlanDigest)
	var appliedData command.PlanApplyData
	decodeProcessResult(t, applied, &appliedData)
	if appliedData.SnapshotRef == "" || appliedData.ManifestDigest == "" || appliedData.Files != len(payloads) {
		t.Fatalf("plan.apply = %+v", appliedData)
	}
	resolvedResult := runRWProcess(t, cairnBin, writerSocket, "namespace", "resolve", "nested/cedar-notes.bin",
		"--workspace", appliedData.WorkspaceID, "--snapshot", appliedData.SnapshotRef)
	var resolved command.NamespaceResolveData
	decodeProcessResult(t, resolvedResult, &resolved)
	if resolved.Entry.ContentID != wantContentIDs["nested/cedar-notes.bin"] ||
		resolved.Entry.SubjectRef == "" || resolved.Entry.ID == "" {
		t.Fatalf("namespace resolve = %+v", resolved)
	}

	noteBody1 := "  备份记录\n 第一行保留空白 \n\n"
	note1Result := runRWProcess(t, cairnBin, writerSocket, "note", "set", resolved.PathRef,
		"--workspace", appliedData.WorkspaceID, "--body", noteBody1)
	var note1 command.AnnotationUpsertData
	decodeProcessResult(t, note1Result, &note1)
	if note1.Annotation.Revision != 1 || note1.Annotation.Body != noteBody1 || note1.Annotation.SubjectRef != resolved.Entry.SubjectRef {
		t.Fatalf("first Note = %+v", note1.Annotation)
	}
	noteBody2 := " 迁移后：第二行\nRecoveryMarkerMint\n保留尾部空白 \t"
	note2Result := runRWProcess(t, cairnBin, writerSocket, "note", "set", resolved.PathRef,
		"--workspace", appliedData.WorkspaceID, "--id", note1.Annotation.ID,
		"--expected-revision", "1", "--body", noteBody2)
	var note2 command.AnnotationUpsertData
	decodeProcessResult(t, note2Result, &note2)
	if note2.Annotation.ID != note1.Annotation.ID || note2.Annotation.Revision != 2 || note2.Annotation.Body != noteBody2 {
		t.Fatalf("revised Note = %+v", note2.Annotation)
	}
	descriptionBody := "  书架记录\n\n第二段：精确保留。 \t"
	descriptionResult := runRWProcess(t, cairnBin, writerSocket, "description", "create", resolved.PathRef,
		"--workspace", appliedData.WorkspaceID, "--kind", "USER", "--language", "zh",
		"--title", "恢复说明", "--body", descriptionBody, "--accepted")
	var descriptionCreated command.DescriptionCreateData
	decodeProcessResult(t, descriptionResult, &descriptionCreated)
	if descriptionCreated.Document.ID == "" || descriptionCreated.Document.Body != descriptionBody ||
		descriptionCreated.Document.SubjectRef != resolved.Entry.SubjectRef || len(descriptionCreated.Document.Segments) == 0 {
		t.Fatalf("description create = %+v", descriptionCreated.Document)
	}
	if descriptionCreated.Document.Segments[0].Text == "" {
		t.Fatalf("description segment is empty: %+v", descriptionCreated.Document.Segments)
	}

	referencePath := filepath.Join(runRoot, "portable", "recovery-reference.json")
	anchorPath := filepath.Join(runRoot, "portable", "trust-anchor.json")
	if err := os.MkdirAll(filepath.Dir(referencePath), 0o700); err != nil {
		t.Fatal(err)
	}
	exported := runRWProcess(t, cairnBin, writerSocket, "recovery", "export", appliedData.SnapshotRef, referencePath)
	var reference command.RecoveryExportData
	decodeProcessResult(t, exported, &reference)
	anchored := runRWProcess(t, cairnBin, writerSocket, "recovery", "anchor", "export", anchorPath)
	var anchor command.RecoveryAnchorExportData
	decodeProcessResult(t, anchored, &anchor)
	if !reference.IndependentlyStored || anchor.KeyID == "" || reference.SnapshotRef != appliedData.SnapshotRef {
		t.Fatalf("portable records = %+v anchor=%+v", reference, anchor)
	}
	if err := stopProjectionDaemon(t, writer, writerDone, writerLog); err != nil {
		t.Fatal(err)
	}

	oldRepository := cfg.Paths.Repository
	relocatedRepository := filepath.Join(runRoot, "relocated-repository")
	if err := os.Rename(oldRepository, relocatedRepository); err != nil {
		t.Fatalf("relocate isolated repository: %v", err)
	}
	cfg.Paths.Repository = relocatedRepository
	if err := cairnconfig.Save(configPath, cfg); err != nil {
		t.Fatalf("save relocated config: %v", err)
	}
	// This is the lost-catalog path, not a keyless installation: remove the
	// original source, catalog, search index and original repository location,
	// but retain the owner's configured signing-material store. The exported
	// public trust anchor below is a separate input to recovery.import.
	catalogPaths := []string{cfg.Paths.Catalog, cfg.Paths.Catalog + "-wal", cfg.Paths.Catalog + "-shm", cfg.Paths.Catalog + "-journal"}
	if _, err := os.Stat(cfg.Paths.Catalog); err != nil {
		t.Fatalf("original catalog was not present before the loss simulation: %v", err)
	}
	for _, path := range catalogPaths {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			t.Fatalf("remove isolated catalog %q: %v", path, err)
		}
	}
	if err := os.RemoveAll(cfg.Paths.Vectors); err != nil {
		t.Fatalf("remove isolated vectors: %v", err)
	}
	if err := os.RemoveAll(source); err != nil {
		t.Fatalf("remove isolated source: %v", err)
	}
	for _, path := range append(catalogPaths, cfg.Paths.Vectors, source, oldRepository) {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("lost input %q remains available before import: stat error=%v", path, err)
		}
	}
	if _, err := os.Stat(cfg.Paths.RecoveryRecords); err != nil {
		t.Fatalf("original owner's signing-material store was not retained for this lost-catalog scenario: %v", err)
	}

	importSocket := newSocket("import")
	importDaemon, importDone, importLog := startDaemonProcessWithEnv(t, cliEnv, daemonBin, importSocket, "--config", configPath)
	defer stopDaemonProcess(t, importDaemon, importDone, importLog)
	waitForCLI(t, cairnBin, importSocket, importDone, importLog, "status")
	imported := runRWProcess(t, cairnBin, importSocket, "recovery", "import", referencePath, anchorPath)
	var importedData command.RecoveryImportData
	decodeProcessResult(t, imported, &importedData)
	if !importedData.CatalogCreated || importedData.SnapshotRef != appliedData.SnapshotRef ||
		importedData.FactHealth != exact.RecoveryFactHealthComplete {
		t.Fatalf("fresh catalog import = %+v", importedData)
	}
	contentBeforeReplayResult := runRWProcess(t, cairnBin, importSocket, "content", "list", "--workspace", appliedData.WorkspaceID)
	var contentBeforeReplay command.ContentListData
	decodeProcessResult(t, contentBeforeReplayResult, &contentBeforeReplay)
	descriptionBeforeReplayResult := runRWProcess(t, cairnBin, importSocket, "description", "get", descriptionCreated.Document.ID,
		"--workspace", appliedData.WorkspaceID)
	var descriptionBeforeReplay command.DescriptionGetData
	decodeProcessResult(t, descriptionBeforeReplayResult, &descriptionBeforeReplay)
	historyBeforeReplay, currentBeforeReplay := readProjectedAnnotationState(t, cfg.Paths.Catalog, appliedData.WorkspaceID, note1.Annotation.ID)
	replayed := runRWProcess(t, cairnBin, importSocket, "recovery", "import", referencePath, anchorPath)
	var replayedData command.RecoveryImportData
	decodeProcessResult(t, replayed, &replayedData)
	if replayedData.CatalogCreated || replayedData.SnapshotRef != appliedData.SnapshotRef {
		t.Fatalf("exact recovery replay = %+v", replayedData)
	}
	historyAfterReplay, currentAfterReplay := readProjectedAnnotationState(t, cfg.Paths.Catalog, appliedData.WorkspaceID, note1.Annotation.ID)
	if !reflect.DeepEqual(historyAfterReplay, historyBeforeReplay) || !reflect.DeepEqual(currentAfterReplay, currentBeforeReplay) {
		t.Fatalf("exact recovery replay changed projected annotation state: history before=%+v after=%+v current before=%+v after=%+v",
			historyBeforeReplay, historyAfterReplay, currentBeforeReplay, currentAfterReplay)
	}

	resolvedAfter := runRWProcess(t, cairnBin, importSocket, "namespace", "resolve", "nested/cedar-notes.bin",
		"--workspace", appliedData.WorkspaceID, "--snapshot", appliedData.SnapshotRef)
	var resolvedAfterData command.NamespaceResolveData
	decodeProcessResult(t, resolvedAfter, &resolvedAfterData)
	if resolvedAfterData.Entry.ID != resolved.Entry.ID || resolvedAfterData.Entry.SubjectRef != resolved.Entry.SubjectRef ||
		resolvedAfterData.Entry.ContentID != resolved.Entry.ContentID {
		t.Fatalf("reconstructed subject identity changed: before=%+v after=%+v", resolved.Entry, resolvedAfterData.Entry)
	}
	noteListResult := runRWProcess(t, cairnBin, importSocket, "note", "list", resolvedAfterData.PathRef,
		"--workspace", appliedData.WorkspaceID)
	var noteList command.AnnotationListData
	decodeProcessResult(t, noteListResult, &noteList)
	if len(noteList.Annotations) != 1 || noteList.Annotations[0].ID != note2.Annotation.ID ||
		noteList.Annotations[0].Revision != 2 || noteList.Annotations[0].Body != noteBody2 ||
		noteList.Annotations[0].BodyDigest != note2.Annotation.BodyDigest {
		t.Fatalf("reconstructed Note = %+v", noteList.Annotations)
	}
	contentListResult := runRWProcess(t, cairnBin, importSocket, "content", "list", "--workspace", appliedData.WorkspaceID)
	var contentList command.ContentListData
	decodeProcessResult(t, contentListResult, &contentList)
	if contentList.WorkspaceID != appliedData.WorkspaceID || len(contentList.Items) != len(payloads) {
		t.Fatalf("reconstructed content.list = %+v", contentList)
	}
	if !reflect.DeepEqual(contentList, contentBeforeReplay) {
		t.Fatalf("exact recovery replay changed projected content: before=%+v after=%+v", contentBeforeReplay, contentList)
	}
	listedByPath := make(map[string]command.ContentItemData, len(contentList.Items))
	for _, item := range contentList.Items {
		listedByPath[item.Path] = item
	}
	for rel, wantContentID := range wantContentIDs {
		item, ok := listedByPath[rel]
		if !ok || item.Name != filepath.Base(rel) || item.ContentID != wantContentID || item.SubjectRef == "" || item.EntryID == "" ||
			item.LogicalSize == nil || *item.LogicalSize != int64(len(payloads[rel])) {
			t.Fatalf("reconstructed content.list item %q = %+v, found=%t", rel, item, ok)
		}
		if rel == "nested/cedar-notes.bin" && (item.SubjectRef != resolved.Entry.SubjectRef || item.EntryID != resolved.Entry.ID) {
			t.Fatalf("content.list first-file identity changed: %+v vs %+v", item, resolved.Entry)
		}
	}
	descriptionResultAfter := runRWProcess(t, cairnBin, importSocket, "description", "get", descriptionCreated.Document.ID,
		"--workspace", appliedData.WorkspaceID)
	var descriptionAfter command.DescriptionGetData
	decodeProcessResult(t, descriptionResultAfter, &descriptionAfter)
	if descriptionAfter.Document.ID != descriptionCreated.Document.ID || descriptionAfter.Document.SubjectRef != resolved.Entry.SubjectRef ||
		descriptionAfter.Document.Body != descriptionBody || descriptionAfter.Document.BodyDigest != descriptionCreated.Document.BodyDigest ||
		!reflect.DeepEqual(descriptionAfter.Document.Segments, descriptionCreated.Document.Segments) ||
		!reflect.DeepEqual(descriptionAfter, descriptionBeforeReplay) {
		t.Fatalf("reconstructed description = %+v", descriptionAfter.Document)
	}

	capabilityResult := runRWProcess(t, cairnBin, importSocket, "capability", "list")
	var capabilityData command.CapabilityListData
	decodeProcessResult(t, capabilityResult, &capabilityData)
	semanticUnavailable := false
	for _, capability := range capabilityData.Capabilities {
		if capability.Kind == search.CapabilityKindDimension && capability.ID == search.DimensionSemantic {
			semanticUnavailable = capability.State == command.CapabilityUnavailable &&
				strings.Contains(capability.Notes, search.SemanticIndexUnavailableReason)
		}
	}
	if !semanticUnavailable {
		t.Fatalf("semantic capability was not honestly unavailable: %+v", capabilityData.Capabilities)
	}
	searchResult := runRWProcessAllowDegraded(t, cairnBin, importSocket, "search", "RecoveryMarkerMint", "--workspace", appliedData.WorkspaceID)
	var searchData command.SearchQueryData
	decodeProcessResult(t, searchResult, &searchData)
	if searchData.Provider != search.ProviderBrokerFuse || len(searchData.Components) != 2 ||
		searchData.Components[0].Dimension != search.DimensionLexical || searchData.Components[0].Status != string(command.StatusSucceeded) ||
		searchData.Components[1].Dimension != search.DimensionSemantic || searchData.Components[1].Status != "UNAVAILABLE" ||
		len(searchData.Hits) != 1 || searchData.Hits[0].SubjectRef != resolved.Entry.SubjectRef {
		t.Fatalf("reconstructed default lexical+semantic search = %+v", searchData)
	}

	verifyResult := runRWProcess(t, cairnBin, importSocket, "snapshot", "verify", appliedData.SnapshotRef, "--mode", command.VerifyFullBytes)
	var verified command.SnapshotVerifyData
	decodeProcessResult(t, verifyResult, &verified)
	if !verified.OK || verified.CatalogUsed || verified.AcceptedLevel != command.VerifyFullBytes ||
		verified.Files != len(payloads) || verified.PassedFiles != len(payloads) || verified.Bytes != totalPayloadBytes(payloads) ||
		verified.PassedBytes != totalPayloadBytes(payloads) {
		t.Fatalf("snapshot verify after import = %+v", verified)
	}
	openResult := runRWProcess(t, cairnBin, importSocket, "content", "open", resolvedAfterData.Entry.ID,
		"--workspace", appliedData.WorkspaceID)
	var opened command.ContentOpenData
	decodeProcessResult(t, openResult, &opened)
	readResult := runRWProcess(t, cairnBin, importSocket, "content", "read", opened.Handle, "0", "1024")
	var read command.ContentReadData
	decodeProcessResult(t, readResult, &read)
	if !bytes.Equal(read.Bytes, payloads["nested/cedar-notes.bin"]) || read.Length != int64(len(read.Bytes)) {
		t.Fatalf("read exact restored-source bytes = %q/%d", read.Bytes, read.Length)
	}
	_ = runRWProcess(t, cairnBin, importSocket, "content", "close", opened.Handle)

	destination := filepath.Join(runRoot, "restored")
	restorePlanResult := runRWProcess(t, cairnBin, importSocket, "restore", appliedData.SnapshotRef, destination)
	var restorePlan command.PlanRestoreData
	decodeProcessResult(t, restorePlanResult, &restorePlan)
	if restorePlan.Wrote || !restorePlan.Executable || restorePlan.Files != len(payloads) {
		t.Fatalf("restore plan after import = %+v", restorePlan)
	}
	restored := runRWProcess(t, cairnBin, importSocket, "plan", "apply", restorePlan.PlanID,
		"--workspace", restorePlan.WorkspaceID, "--digest", restorePlan.PlanDigest)
	var restoredData command.PlanApplyData
	decodeProcessResult(t, restored, &restoredData)
	if restoredData.SnapshotRef != appliedData.SnapshotRef || restoredData.Files != len(payloads) {
		t.Fatalf("restore apply = %+v", restoredData)
	}
	for rel, want := range payloads {
		got, err := os.ReadFile(filepath.Join(destination, filepath.FromSlash(rel)))
		if err != nil || !bytes.Equal(got, want) {
			t.Fatalf("restored %q = %q, err=%v", rel, got, err)
		}
		sum := sha256.Sum256(got)
		if "sha256:"+hex.EncodeToString(sum[:]) != wantContentIDs[rel] || int64(len(got)) != int64(len(want)) {
			t.Fatalf("restored identity for %q changed: %x/%d", rel, sum, len(got))
		}
	}
	projectedStore, err := sqlite.Open(context.Background(), cfg.Paths.Catalog, sqlite.Options{})
	if err != nil {
		t.Fatalf("open reconstructed catalog for exact history count: %v", err)
	}
	projectedHistory, historyErr := projectedStore.ListAnnotationRevisions(context.Background(), appliedData.WorkspaceID, resolved.Entry.SubjectRef)
	closeErr := projectedStore.Close()
	if historyErr != nil || closeErr != nil || len(projectedHistory) != 2 ||
		projectedHistory[0].Revision != 1 || projectedHistory[0].Body != noteBody1 ||
		projectedHistory[1].Revision != 2 || projectedHistory[1].Body != noteBody2 ||
		projectedHistory[1].BodyDigest != note2.Annotation.BodyDigest {
		t.Fatalf("replayed imported Note history = %+v, query error=%v close error=%v", projectedHistory, historyErr, closeErr)
	}

	// A reconstructed catalog must remain a valid publisher. Revise the Note
	// through the ordinary CLI, publish the updated portable facts, then prove
	// the exported reference still works through the catalog-free reader.
	noteBody3 := "恢复后继续编辑\n第三版保留原始空白  \t\n"
	note3Result := runRWProcess(t, cairnBin, importSocket, "note", "set", resolvedAfterData.PathRef,
		"--workspace", appliedData.WorkspaceID, "--id", note1.Annotation.ID,
		"--expected-revision", "2", "--body", noteBody3)
	var note3 command.AnnotationUpsertData
	decodeProcessResult(t, note3Result, &note3)
	if note3.Annotation.ID != note1.Annotation.ID || note3.Annotation.Revision != 3 || note3.Annotation.Body != noteBody3 {
		t.Fatalf("post-recovery Note revision = %+v", note3.Annotation)
	}
	reference3Path := filepath.Join(runRoot, "portable", "recovered-rev3-reference.json")
	exported3 := runRWProcess(t, cairnBin, importSocket, "recovery", "export", appliedData.SnapshotRef, reference3Path)
	var reference3 command.RecoveryExportData
	decodeProcessResult(t, exported3, &reference3)
	if !reference3.IndependentlyStored || reference3.SnapshotRef != appliedData.SnapshotRef {
		t.Fatalf("post-recovery portable export = %+v", reference3)
	}
	referenceBytes, err := os.ReadFile(reference3Path)
	if err != nil {
		t.Fatalf("read post-recovery reference: %v", err)
	}
	decodedReference, err := exact.DecodeRecoveryReference(referenceBytes)
	if err != nil || decodedReference.FactHealth != exact.RecoveryFactHealthComplete || decodedReference.SnapshotRef != appliedData.SnapshotRef {
		t.Fatalf("post-recovery reference facts = %+v, decode error=%v", decodedReference, err)
	}
	readerRepo, err := repository.OpenProfileReadOnly(repository.RepositoryProfileDirectoryCASDev, relocatedRepository)
	if err != nil {
		t.Fatalf("open relocated repository for catalog-free reference reader: %v", err)
	}
	reader := &exact.Service{Repo: readerRepo, RequireSignedPublication: true}
	readerImport, err := reader.ImportRecoveryArtifact(context.Background(), reference3Path, anchorPath, anchor.PublicationDomain)
	if err != nil {
		t.Fatalf("catalog-free reader rejected post-recovery reference: %v", err)
	}
	if readerImport.CatalogCreated || readerImport.FactHealth != exact.RecoveryFactHealthComplete ||
		readerImport.SnapshotRef != appliedData.SnapshotRef || readerImport.Files != len(payloads) {
		t.Fatalf("catalog-free post-recovery import = %+v", readerImport)
	}
	projectedStore, err = sqlite.Open(context.Background(), cfg.Paths.Catalog, sqlite.Options{})
	if err != nil {
		t.Fatalf("reopen reconstructed catalog for Note revision 3: %v", err)
	}
	projectedHistory, historyErr = projectedStore.ListAnnotationRevisions(context.Background(), appliedData.WorkspaceID, resolved.Entry.SubjectRef)
	closeErr = projectedStore.Close()
	if historyErr != nil || closeErr != nil || len(projectedHistory) != 3 || projectedHistory[2].Revision != 3 ||
		projectedHistory[2].Body != noteBody3 || projectedHistory[2].BodyDigest != note3.Annotation.BodyDigest {
		t.Fatalf("post-recovery Note history = %+v, query error=%v close error=%v", projectedHistory, historyErr, closeErr)
	}
	if _, err := os.Stat(cfg.Paths.RecoveryRecords); err != nil {
		t.Fatalf("ordinary daemon lost the original owner's signing-material store: %v", err)
	}
}

func totalPayloadBytes(payloads map[string][]byte) int64 {
	var total int64
	for _, payload := range payloads {
		total += int64(len(payload))
	}
	return total
}

func readProjectedAnnotationState(t *testing.T, catalogPath, workspaceID, annotationID string) ([]sqlite.AnnotationRevision, sqlite.Annotation) {
	t.Helper()
	store, err := sqlite.Open(context.Background(), catalogPath, sqlite.Options{})
	if err != nil {
		t.Fatalf("open catalog for annotation state: %v", err)
	}
	history, historyErr := store.ListAnnotationRevisions(context.Background(), workspaceID, "")
	current, currentErr := store.GetAnnotation(context.Background(), workspaceID, annotationID)
	closeErr := store.Close()
	if historyErr != nil || currentErr != nil || closeErr != nil {
		t.Fatalf("read projected annotation state: history=%v current=%v close=%v", historyErr, currentErr, closeErr)
	}
	filtered := make([]sqlite.AnnotationRevision, 0, len(history))
	for _, revision := range history {
		if revision.AnnotationID == annotationID {
			filtered = append(filtered, revision)
		}
	}
	return filtered, current
}

func stopProjectionDaemon(t *testing.T, process *exec.Cmd, done <-chan error, daemonLog *bytes.Buffer) error {
	t.Helper()
	if err := process.Process.Signal(os.Interrupt); err != nil {
		return err
	}
	select {
	case err := <-done:
		if err != nil {
			return err
		}
	case <-time.After(5 * time.Second):
		_ = process.Process.Kill()
		return fmt.Errorf("daemon did not stop\n%s", daemonLog.String())
	}
	return nil
}
