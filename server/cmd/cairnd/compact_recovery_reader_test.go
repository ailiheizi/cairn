package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestCompactRecoveryReferenceV3SeparateProcessRestoresExactBytes(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	source := filepath.Join(root, "source")
	if err := os.Mkdir(source, 0o700); err != nil {
		t.Fatal(err)
	}
	want := []byte("compact v3 separate-process exact restore proof\n")
	sourcePath := filepath.Join(source, "payload.txt")
	if err := os.WriteFile(sourcePath, want, 0o600); err != nil {
		t.Fatal(err)
	}
	sourceHash := sha256.Sum256(want)

	writerState := filepath.Join(root, "writer-state")
	if err := os.Mkdir(writerState, 0o700); err != nil {
		t.Fatal(err)
	}
	catalogPath := filepath.Join(writerState, "catalog.sqlite")
	store, err := sqlite.Open(ctx, catalogPath, sqlite.Options{})
	if err != nil {
		t.Fatal(err)
	}
	repositoryRoot := filepath.Join(root, "repository")
	repo, err := repository.OpenDir(repositoryRoot)
	if err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	signingRoot := filepath.Join(root, "writer-signing")
	if err := os.Mkdir(signingRoot, 0o700); err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	identity, anchor, err := exact.OpenSigningMaterial(signingRoot, exact.DefaultPublicationDomain, true)
	if err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	writer := &exact.Service{
		Store: store, Repo: repo, SigningIdentity: &identity, TrustAnchor: &anchor,
		PublicationDomain: exact.DefaultPublicationDomain, RequireSignedPublication: true,
	}
	plan, err := writer.InspectIngest(ctx, source, exact.IngestOptions{})
	if err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	published, err := writer.ApplyIngestPlanWithExecutionKey(ctx, plan, "sha256:compact-v3-separate-process")
	if err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	rootRecord, err := store.GetNamespaceRootBySnapshotRef(ctx, published.SnapshotRef)
	if err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	nodes, err := store.ListNamespaceSubtree(ctx, published.WorkspaceID, rootRecord.ID, "")
	if err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	var subjectRef string
	for _, node := range nodes {
		if string(node.Entry.RawName) == "payload.txt" {
			subjectRef = node.Entry.SubjectRef
			break
		}
	}
	if subjectRef == "" {
		_ = store.Close()
		t.Fatal("exact-saved file has no stable subject mapping")
	}
	for i := 0; i < 2; i++ {
		body := strings.Repeat(string(rune('a'+i)), 5_600_000)
		bodyHash := sha256.Sum256([]byte(body))
		id, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
		if err != nil {
			_ = store.Close()
			t.Fatal(err)
		}
		annotation := &sqlite.Annotation{
			ID: id, WorkspaceID: published.WorkspaceID, SubjectRef: subjectRef,
			Kind: sqlite.AnnotationNote, Body: body, Revision: 1,
		}
		if err := store.CreateAnnotation(ctx, annotation); err != nil {
			_ = store.Close()
			t.Fatalf("create controlled Note %d: %v", i+1, err)
		}
		if err := writer.PublishPortableFactClosure(ctx, published.WorkspaceID, published.SnapshotRef, published.PublicationCommitDigest); err != nil {
			_ = store.Close()
			t.Fatalf("publish controlled Note successor %d: %v", i+1, err)
		}
		t.Logf("controlled Note %d bytes=%d sha256=%s", i+1, len(body), hex.EncodeToString(bodyHash[:]))
	}
	v2, err := writer.BuildRecoveryReference(ctx, published.SnapshotRef)
	if err != nil {
		_ = store.Close()
		t.Fatalf("build expanded v2 reference: %v", err)
	}
	if _, err := exact.MarshalRecoveryReference(v2); !errors.Is(err, exact.ErrRecoveryReferenceTooLarge) {
		_ = store.Close()
		t.Fatalf("expanded v2 marshal error = %v, want typed recovery-reference size refusal", err)
	} else {
		var sizeErr *exact.RecoveryReferenceSizeError
		if !errors.As(err, &sizeErr) {
			_ = store.Close()
			t.Fatalf("expanded v2 size refusal has no size evidence: %T %v", err, err)
		}
		t.Logf("expanded v2 refused serialized_bytes=%d limit_bytes=%d", sizeErr.SerializedBytes, sizeErr.LimitBytes)
	}
	for _, digest := range mustListRecordDigests(t, ctx, repo, repository.RecordPortableFactClosure) {
		record, err := repo.OpenRecord(ctx, repository.RecordPortableFactClosure, digest)
		if err != nil {
			_ = store.Close()
			t.Fatal(err)
		}
		payload, readErr := io.ReadAll(record)
		closeErr := record.Close()
		if readErr != nil || closeErr != nil {
			_ = store.Close()
			t.Fatalf("read fact record %s: read=%v close=%v", digest, readErr, closeErr)
		}
		if int64(len(payload)) > repository.MaxRecordBytes {
			_ = store.Close()
			t.Fatalf("fact record %s has %d bytes, above per-record limit %d", digest, len(payload), repository.MaxRecordBytes)
		}
		t.Logf("signed fact record digest=%s bytes=%d sha256=%s", digest, len(payload), digest)
	}

	referencePath := filepath.Join(root, "portable", "recovery-reference.json")
	if err := os.MkdirAll(filepath.Dir(referencePath), 0o700); err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	exported, err := writer.ExportRecoveryArtifact(ctx, published.SnapshotRef, referencePath)
	if err != nil {
		_ = store.Close()
		t.Fatalf("generic signed recovery export: %v", err)
	}
	if exported.Schema != exact.RecoveryReferenceSchemaV3 || exported.SnapshotRef != published.SnapshotRef || exported.ManifestDigest != published.ManifestDigest || exported.Length > repository.MaxRecordBytes {
		_ = store.Close()
		t.Fatalf("generic export result = %+v, want bounded v3 matching snapshot/manifest", exported)
	}
	referenceBytes, err := os.ReadFile(referencePath)
	if err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	if int64(len(referenceBytes)) != exported.Length || int64(len(referenceBytes)) > repository.MaxRecordBytes {
		_ = store.Close()
		t.Fatalf("generic artifact bytes=%d reported_length=%d cap=%d", len(referenceBytes), exported.Length, repository.MaxRecordBytes)
	}
	referenceHash := sha256.Sum256(referenceBytes)
	anchorPath := filepath.Join(root, "portable", "trust-anchor.json")
	if _, err := exact.ExportTrustAnchor(anchor, anchorPath); err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	anchorBytes, err := os.ReadFile(anchorPath)
	if err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	anchorHash := sha256.Sum256(anchorBytes)
	decoded, err := exact.DecodeCompactRecoveryReference(referenceBytes)
	if err != nil {
		_ = store.Close()
		t.Fatalf("decode generic v3 artifact: %v", err)
	}
	if err := decoded.ValidateAgainstRepository(ctx, repo, anchor); err != nil {
		_ = store.Close()
		t.Fatalf("validate generic v3 artifact before clean-reader handoff: %v", err)
	}
	t.Logf("generic export schema=%s bytes=%d sha256=%s anchor_bytes=%d anchor_sha256=%s", exported.Schema, len(referenceBytes), hex.EncodeToString(referenceHash[:]), len(anchorBytes), hex.EncodeToString(anchorHash[:]))

	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(writerState); err != nil {
		t.Fatalf("remove writer catalog state: %v", err)
	}
	if err := os.RemoveAll(signingRoot); err != nil {
		t.Fatalf("remove writer private signing state: %v", err)
	}
	if err := os.RemoveAll(source); err != nil {
		t.Fatalf("remove original source tree before clean-reader restore: %v", err)
	}
	repositoryBefore := recoveryProcessTree(t, repositoryRoot)
	workspaceRoot := testWorkspaceRoot(t)
	binDir := filepath.Join(root, "bin")
	if err := os.Mkdir(binDir, 0o700); err != nil {
		t.Fatal(err)
	}
	daemonBin := buildTestBinary(t, workspaceRoot, "./server/cmd/cairnd", filepath.Join(binDir, "cairnd"))
	cairnBin := buildTestBinary(t, workspaceRoot, "./client/cmd/cairn", filepath.Join(binDir, "cairn"))
	for _, binary := range []string{daemonBin, cairnBin} {
		payload, err := os.ReadFile(binary)
		if err != nil {
			t.Fatal(err)
		}
		hash := sha256.Sum256(payload)
		t.Logf("fresh binary path=%s bytes=%d sha256=%s", binary, len(payload), hex.EncodeToString(hash[:]))
	}

	socketPath := fmt.Sprintf("/tmp/cairn-v3-e2e-%d-%d.sock", os.Getpid(), time.Now().UnixNano())
	t.Cleanup(func() { _ = os.Remove(socketPath) })
	probeRoot := filepath.Join(root, "reader-forbidden-state")
	catalogProbe := filepath.Join(probeRoot, "catalog.sqlite")
	keyProbe := filepath.Join(probeRoot, "signing")
	indexProbe := filepath.Join(probeRoot, "indexes")
	vectorProbe := filepath.Join(probeRoot, "vectors")
	daemon := exec.Command(daemonBin,
		"--recovery-reader", "--repository", repositoryRoot,
		"--recovery-reference", referencePath, "--trust-anchor", anchorPath,
		"--socket", socketPath,
	)
	daemon.Env = append(os.Environ(),
		"CAIRN_CONFIG="+filepath.Join(probeRoot, "missing-config.yaml"),
		"CAIRN_CATALOG="+catalogProbe,
		"CAIRN_RECOVERY_RECORDS="+keyProbe,
		"CAIRN_VECTORS="+vectorProbe,
	)
	var daemonLog bytes.Buffer
	daemon.Stdout, daemon.Stderr = &daemonLog, &daemonLog
	if err := daemon.Start(); err != nil {
		t.Fatalf("start fresh clean reader: %v", err)
	}
	daemonDone := make(chan error, 1)
	go func() { daemonDone <- daemon.Wait() }()
	stopped := false
	defer func() {
		if stopped {
			return
		}
		_ = daemon.Process.Kill()
		<-daemonDone
	}()
	waitForReaderCLI(t, cairnBin, socketPath, daemonDone, &daemonLog)
	t.Logf("reader pid=%d executable=%s socket=%s", daemon.Process.Pid, daemonBin, socketPath)

	imported := runCompactV3CLI(t, cairnBin, socketPath, "recovery", "import", referencePath, anchorPath)
	var importData command.RecoveryImportData
	decodeProcessResult(t, imported, &importData)
	if importData.Schema != exact.RecoveryReferenceSchemaV3 || importData.SnapshotRef != published.SnapshotRef ||
		importData.ManifestDigest != published.ManifestDigest || importData.CommitDigest != published.PublicationCommitDigest ||
		importData.PreparedClosureDigest != decoded.PreparedClosure.RecordDigest || importData.TrustAnchorDigest != decoded.RequiredTrustAnchor.Digest ||
		importData.CatalogCreated || importData.FactHealth != exact.RecoveryFactHealthComplete ||
		importData.Files != 1 || importData.Bytes != int64(len(want)) {
		t.Fatalf("separate-process v3 recovery.import = %+v", importData)
	}
	listed := runCompactV3CLI(t, cairnBin, socketPath, "snapshot", "list")
	var listData command.SnapshotListData
	decodeProcessResult(t, listed, &listData)
	if len(listData.Snapshots) != 1 || listData.Snapshots[0].SnapshotRef != published.SnapshotRef {
		t.Fatalf("separate-process snapshot.list = %+v", listData)
	}
	verified := runCompactV3CLI(t, cairnBin, socketPath, "snapshot", "verify", published.SnapshotRef, "--mode", command.VerifyFullBytes)
	var verifyData command.SnapshotVerifyData
	decodeProcessResult(t, verified, &verifyData)
	if !verifyData.OK || verifyData.AcceptedLevel != command.VerifyFullBytes || verifyData.CatalogUsed || verifyData.Files != 1 || verifyData.Bytes != int64(len(want)) {
		t.Fatalf("separate-process full-byte verify = %+v", verifyData)
	}
	destination := filepath.Join(root, "restored")
	planned := runCompactV3CLI(t, cairnBin, socketPath, "restore", published.SnapshotRef, destination)
	var restorePlan command.PlanRestoreData
	decodeProcessResult(t, planned, &restorePlan)
	if restorePlan.Wrote || restorePlan.SnapshotRef != published.SnapshotRef || restorePlan.Files != 1 || restorePlan.PlanID == "" || restorePlan.PlanDigest == "" || restorePlan.WorkspaceID == "" {
		t.Fatalf("separate-process restore plan = %+v", restorePlan)
	}
	applied := runCompactV3CLI(t, cairnBin, socketPath, "plan", "apply", restorePlan.PlanID,
		"--workspace", restorePlan.WorkspaceID, "--digest", restorePlan.PlanDigest)
	var applyData command.PlanApplyData
	decodeProcessResult(t, applied, &applyData)
	if applyData.SnapshotRef != published.SnapshotRef || applyData.Files != 1 {
		t.Fatalf("separate-process restore apply = %+v", applyData)
	}
	got, err := os.ReadFile(filepath.Join(destination, "payload.txt"))
	if err != nil {
		t.Fatal(err)
	}
	gotHash := sha256.Sum256(got)
	if len(got) != len(want) || !bytes.Equal(got, want) || gotHash != sourceHash {
		t.Fatalf("restored payload identity bytes=%d sha256=%s; want bytes=%d sha256=%s", len(got), hex.EncodeToString(gotHash[:]), len(want), hex.EncodeToString(sourceHash[:]))
	}
	expectedRestoredTree := map[string]string{"payload.txt": hex.EncodeToString(sourceHash[:])}
	if restoredTree := recoveryProcessTree(t, destination); !reflect.DeepEqual(restoredTree, expectedRestoredTree) {
		t.Fatalf("restored path set/content = %v, want %v", restoredTree, expectedRestoredTree)
	}
	t.Logf("restored exact bytes=%d sha256=%s", len(got), hex.EncodeToString(gotHash[:]))
	for _, path := range []string{source, writerState, signingRoot, catalogProbe, keyProbe, indexProbe, vectorProbe, filepath.Join(repositoryRoot, "indexes"), filepath.Join(repositoryRoot, "staging")} {
		if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("clean reader has forbidden catalog/key/index/vector state %s: %v", path, err)
		}
	}
	if after := recoveryProcessTree(t, repositoryRoot); !reflect.DeepEqual(after, repositoryBefore) {
		t.Fatalf("clean reader changed repository tree\nbefore=%v\nafter=%v", repositoryBefore, after)
	}
	if err := daemon.Process.Signal(os.Interrupt); err != nil {
		t.Fatalf("stop separate reader process: %v", err)
	}
	select {
	case err := <-daemonDone:
		stopped = true
		if err != nil {
			t.Fatalf("separate reader exit: %v\n%s", err, daemonLog.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("separate reader did not stop gracefully\n%s", daemonLog.String())
	}
	if _, err := os.Lstat(socketPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("reader socket remains after clean stop: %v", err)
	}
	t.Logf("reader clean exit=0; repository entries=%d; source_bytes=%d source_sha256=%s", len(repositoryBefore), len(want), hex.EncodeToString(sourceHash[:]))
}

func mustListRecordDigests(t *testing.T, ctx context.Context, repo repository.RecordDriver, role repository.RecordRole) []string {
	t.Helper()
	digests, err := repo.ListRecordDigests(ctx, role)
	if err != nil {
		t.Fatal(err)
	}
	if len(digests) < 3 {
		t.Fatalf("record role %s has %d digests, want initial child and two Note successors", role, len(digests))
	}
	return digests
}

func runCompactV3CLI(t *testing.T, cairnBin, socketPath string, args ...string) command.Result {
	t.Helper()
	fullArgs := append([]string{"--socket", socketPath, "--json"}, args...)
	output, err := exec.Command(cairnBin, fullArgs...).CombinedOutput()
	t.Logf("CLI argv=%q exit=%v raw=%s", append([]string{cairnBin}, fullArgs...), err, strings.TrimSpace(string(output)))
	if err != nil {
		t.Fatalf("cairn %s: %v\n%s", strings.Join(args, " "), err, output)
	}
	var result command.Result
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatalf("decode cairn %s result: %v\n%s", strings.Join(args, " "), err, output)
	}
	if result.Status != command.StatusSucceeded {
		t.Fatalf("cairn %s status=%s reasons=%+v", strings.Join(args, " "), result.Status, result.Reasons)
	}
	return result
}

func TestCompactRecoveryReaderStartsFromIndependentAnchorAndRepository(t *testing.T) {
	ctx := context.Background()
	source := t.TempDir()
	if err := os.WriteFile(filepath.Join(source, "payload.bin"), []byte("compact reader payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	catalogPath := filepath.Join(t.TempDir(), "catalog.sqlite")
	store, err := sqlite.Open(ctx, catalogPath, sqlite.Options{})
	if err != nil {
		t.Fatal(err)
	}
	repoRoot := filepath.Join(t.TempDir(), "repository")
	repo, err := repository.OpenDir(repoRoot)
	if err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	identityDir := t.TempDir()
	identity, anchor, err := exact.OpenSigningMaterial(identityDir, exact.DefaultPublicationDomain, true)
	if err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	writer := &exact.Service{
		Store: store, Repo: repo, SigningIdentity: &identity, TrustAnchor: &anchor,
		PublicationDomain: exact.DefaultPublicationDomain, RequireSignedPublication: true,
	}
	plan, err := writer.InspectIngest(ctx, source, exact.IngestOptions{})
	if err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	publication, err := writer.ApplyIngestPlanWithExecutionKey(ctx, plan, "sha256:compact-reader-plan")
	if err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	v2, err := writer.BuildRecoveryReference(ctx, publication.SnapshotRef)
	if err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	facts := make([]exact.RecoveryFactDescriptor, 0, len(v2.PortableFactClosures))
	for _, fact := range v2.PortableFactClosures {
		facts = append(facts, exact.RecoveryFactDescriptor{
			RecordRole: repository.RecordPortableFactClosure, RecordDigest: fact.RecordDigest,
			ClosureDigest: fact.ClosureDigest, ClosureSequence: fact.Envelope.Closure.ClosureSequence,
			PredecessorClosureDigest: fact.Envelope.Closure.PredecessorClosureDigest,
		})
	}
	v3 := exact.RecoveryReferenceV3{
		Schema: exact.RecoveryReferenceSchemaV3, SnapshotRef: v2.SnapshotRef,
		PublicationDomain: v2.PublicationDomain, Repository: v2.Repository,
		RequiredTrustAnchor: v2.RequiredTrustAnchor, PublicationCommitDigest: v2.PublicationCommitDigest,
		PublicationCommit: v2.PublicationCommit,
		PreparedClosure:   exact.RecoveryRecordDescriptor{RecordRole: repository.RecordPreparedClosure, RecordDigest: v2.PreparedClosureDigest},
		FactHealth:        v2.FactHealth, PortableFactClosures: facts,
		RequiredReaderDependencies: append([]string(nil), v2.RequiredReaderDependencies...),
		CriticalExtensions:         append([]string{}, v2.CriticalExtensions...),
		OptionalExtensions:         append([]byte(nil), v2.OptionalExtensions...),
	}
	referencePath := filepath.Join(t.TempDir(), "compact-reference.json")
	referenceBytes, err := exact.MarshalCompactRecoveryReference(v3)
	if err != nil {
		_ = store.Close()
		t.Fatalf("marshal compact reference: %v", err)
	}
	if err := os.WriteFile(referencePath, referenceBytes, 0o600); err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	anchorPath := filepath.Join(t.TempDir(), "trust-anchor.json")
	if _, err := exact.ExportTrustAnchor(anchor, anchorPath); err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	legacyPath := filepath.Join(t.TempDir(), "legacy-bundle.json")
	if _, err := writer.ExportRecovery(ctx, publication.SnapshotRef, legacyPath); err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	legacyReader := &exact.Service{Repo: repo, TrustAnchor: &anchor, PublicationDomain: anchor.PublicationDomain, RequireSignedPublication: true}
	legacyImported, err := legacyReader.ImportRecoveryArtifact(ctx, legacyPath, anchorPath, anchor.PublicationDomain)
	if err != nil || legacyImported.Schema != exact.RecoveryExportBundleSchemaV1 {
		_ = store.Close()
		t.Fatalf("explicit v1 artifact import = %+v, err=%v", legacyImported, err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(catalogPath); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(identityDir); err != nil {
		t.Fatal(err)
	}
	legacySocket := filepath.Join(t.TempDir(), "legacy-reader.sock")
	legacyErr := runRecoveryReader(ctx, daemonOptions{
		socketPath: legacySocket, recoveryReader: true, recoveryReference: legacyPath,
		trustAnchorPath: anchorPath, repositoryPath: repoRoot,
	})
	if legacyErr == nil || !strings.Contains(legacyErr.Error(), "requires") {
		t.Fatalf("legacy v1 startup error = %v, want typed-reference refusal", legacyErr)
	}

	socketPath := fmt.Sprintf("/tmp/cairn-v3-reader-%d-%d.sock", os.Getpid(), time.Now().UnixNano())
	t.Cleanup(func() { _ = os.Remove(socketPath) })
	readerCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	readerErr := make(chan error, 1)
	go func() {
		readerErr <- runWithOptions(readerCtx, daemonOptions{
			socketPath: socketPath, recoveryReader: true, recoveryReference: referencePath,
			trustAnchorPath: anchorPath, repositoryPath: repoRoot,
		})
	}()
	conn := waitForRecoveryReader(t, socketPath, readerErr)
	defer conn.Close()
	input, err := json.Marshal(map[string]any{"artifact_path": referencePath, "trust_anchor_path": anchorPath})
	if err != nil {
		t.Fatal(err)
	}
	response, err := conn.Do(ctx, command.Envelope{Operation: command.OpRecoveryImport, Input: input})
	if err != nil {
		t.Fatal(err)
	}
	if response.Status != command.StatusSucceeded {
		t.Fatalf("compact recovery.import = %s, reasons=%+v", response.Status, response.Reasons)
	}
	var imported command.RecoveryImportData
	if err := json.Unmarshal(response.Data, &imported); err != nil {
		t.Fatal(err)
	}
	if imported.Schema != exact.RecoveryReferenceSchemaV3 || imported.SnapshotRef != publication.SnapshotRef || imported.CatalogCreated {
		t.Fatalf("compact reader import = %+v", imported)
	}
	if _, err := os.Stat(catalogPath); !os.IsNotExist(err) {
		t.Fatalf("catalog-free reader created a catalog: %v", err)
	}
	cancel()
	select {
	case err := <-readerErr:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("compact recovery reader did not stop")
	}
}
