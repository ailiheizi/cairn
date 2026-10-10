package controlplane

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/api"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/testutil"
)

// apiUploadStagingForTest is the same six-line adapter the daemon uses to
// expose the dispatcher's staging sessions to the loopback adapter.
type apiUploadStagingForTest struct {
	dispatcher *Dispatcher
}

func (s apiUploadStagingForTest) BeginUploadSession() (api.UploadSession, error) {
	return s.dispatcher.BeginUploadSession()
}

// uploadFixture is one multipart file part with its expected content.
type uploadFixture struct {
	name    string
	content []byte
}

func mustUploadRequestBuilt(t *testing.T, files []uploadFixture) (*http.Request, string) {
	t.Helper()
	pr, pw := io.Pipe()
	writer := multipart.NewWriter(pw)
	go func() {
		var writeErr error
		defer func() {
			if writeErr != nil {
				_ = pw.CloseWithError(writeErr)
				return
			}
			_ = pw.Close()
		}()
		for _, file := range files {
			part, err := writer.CreateFormFile("files", file.name)
			if err != nil {
				writeErr = err
				return
			}
			if _, err := part.Write(file.content); err != nil {
				writeErr = err
				return
			}
		}
		writeErr = writer.Close()
	}()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/upload", pr)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request, writer.FormDataContentType()
}

func mustUploadResponse(t *testing.T, response *httptest.ResponseRecorder) (int, command.UploadResult) {
	t.Helper()
	var payload command.UploadResult
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode upload response %q: %v", response.Body.String(), err)
	}
	return response.Code, payload
}

func mustUploadError(t *testing.T, response *httptest.ResponseRecorder) (int, string, string) {
	t.Helper()
	var payload struct {
		Error  string `json:"error"`
		Reason string `json:"reason"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode upload error %q: %v", response.Body.String(), err)
	}
	return response.Code, payload.Reason, payload.Error
}

func mustReasonFromResult(t *testing.T, result command.Result, code string) {
	t.Helper()
	if result.Status != command.StatusFailed && result.Status != command.StatusBlocked {
		t.Fatalf("result status = %s, want a refusal: %+v", result.Status, result.Reasons)
	}
	if !hasReasonCode(result, code) {
		t.Fatalf("result missing reason %s: %+v", code, result.Reasons)
	}
}

func expectedDigest(t *testing.T, content []byte) string {
	t.Helper()
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}

// newUploadDispatcher builds a dispatcher whose catalog lives in an absolute
// temp directory so the derived inbox root is inspectable.
func newUploadDispatcher(t *testing.T) (*Dispatcher, string) {
	t.Helper()
	dataRoot := t.TempDir()
	store := testutil.OpenStore(t, filepath.Join(dataRoot, "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	dispatcher := NewDispatcher(store, filepath.Join(dataRoot, "catalog.sqlite"), "/tmp/cairn.sock", WithExact(&exact.Service{Store: store, Repo: repo}))
	inbox := filepath.Join(dataRoot, inboxDirName)
	if dispatcher.inboxRoot != inbox {
		t.Fatalf("derived inbox root = %q, want %q", dispatcher.inboxRoot, inbox)
	}
	return dispatcher, inbox
}

func TestUploadEndpointStagesFilesWithDigestsAndSanitizedNames(t *testing.T) {
	dispatcher, inbox := newUploadDispatcher(t)
	handler := api.Handler(dispatcher.Handle, api.Options{Upload: apiUploadStagingForTest{dispatcher}})
	first := []byte("hello staged\n")
	second := []byte("nested bytes")
	request, _ := mustUploadRequestBuilt(t, []uploadFixture{
		{name: "plain.txt", content: first},
		{name: "folder/nested name.txt", content: second},
	})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("upload status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	_, payload := mustUploadResponse(t, recorder)
	if payload.StagingDir == "" || !localDirContains(inbox, payload.StagingDir) || filepath.Clean(payload.StagingDir) == filepath.Clean(inbox) {
		t.Fatalf("staging dir %q is not a fresh directory below %q", payload.StagingDir, inbox)
	}
	if len(payload.Files) != 2 {
		t.Fatalf("upload files = %+v", payload.Files)
	}
	plain := payload.Files[0]
	if plain.OriginalName != "plain.txt" || plain.StoredName != "plain.txt" || plain.NameRewritten {
		t.Fatalf("plain file receipt = %+v", plain)
	}
	if plain.Length != int64(len(first)) || plain.SHA256 != expectedDigest(t, first) {
		t.Fatalf("plain file identity = %+v", plain)
	}
	nested := payload.Files[1]
	if nested.OriginalName != "folder/nested name.txt" || nested.StoredName != "nested name.txt" || !nested.NameRewritten {
		t.Fatalf("nested file receipt = %+v", nested)
	}
	if nested.Length != int64(len(second)) || nested.SHA256 != expectedDigest(t, second) {
		t.Fatalf("nested file identity = %+v", nested)
	}
	// The staging directory was created 0700 and each staged file 0600, and
	// the stored bytes match the digests the response echoed.
	dirInfo, err := os.Stat(payload.StagingDir)
	if err != nil || !dirInfo.IsDir() {
		t.Fatalf("staging dir stat = %v, %v", dirInfo, err)
	}
	if dirInfo.Mode().Perm() != 0o700 {
		t.Fatalf("staging dir mode = %v, want 0700", dirInfo.Mode().Perm())
	}
	for _, receipt := range []command.UploadFileResult{plain, nested} {
		info, err := os.Stat(receipt.StoredPath)
		if err != nil {
			t.Fatalf("stat staged file: %v", err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("staged file mode = %v, want 0600", info.Mode().Perm())
		}
		if !localDirContains(payload.StagingDir, receipt.StoredPath) {
			t.Fatalf("staged path %q escaped the staging dir %q", receipt.StoredPath, payload.StagingDir)
		}
	}
	if dispatcher.uploadInFlight.Load() != 0 {
		t.Fatalf("in-flight bytes left at %d after a finished request", dispatcher.uploadInFlight.Load())
	}
}

func TestUploadEndpointDeletesOversizedPartialAndKeepsOtherFiles(t *testing.T) {
	dispatcher, _ := newUploadDispatcher(t)
	dispatcher.uploadLimits.maxFileBytes = 16
	handler := api.Handler(dispatcher.Handle, api.Options{Upload: apiUploadStagingForTest{dispatcher}})
	oversized := bytesOf(t, 32)
	request, _ := mustUploadRequestBuilt(t, []uploadFixture{
		{name: "big.bin", content: oversized},
		{name: "small.txt", content: []byte("ok")},
	})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("upload status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	_, payload := mustUploadResponse(t, recorder)
	if payload.StagingDir == "" || len(payload.Files) != 2 {
		t.Fatalf("upload result = %+v", payload)
	}
	small := payload.Files[1]
	if small.SkippedReason != "" || small.StoredName != "small.txt" {
		t.Fatalf("small file receipt = %+v", small)
	}
	big := payload.Files[0]
	if big.SkippedReason != command.UploadReasonTooLarge || big.StoredName != "" || big.StoredPath != "" {
		t.Fatalf("oversized receipt = %+v", big)
	}
	// The oversized file's partial must be gone: the staging dir holds only
	// the small file, and nothing retains the oversized bytes on disk.
	entries, err := os.ReadDir(payload.StagingDir)
	if err != nil {
		t.Fatalf("read staging dir: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "small.txt" {
		t.Fatalf("staging dir entries after oversized refusal = %+v", entries)
	}
	if dispatcher.uploadInFlight.Load() != 0 {
		t.Fatalf("in-flight bytes left at %d after oversized refusal", dispatcher.uploadInFlight.Load())
	}
}

func TestUploadEndpointRefusesMoreThanTwoHundredFilesAndRollsBack(t *testing.T) {
	dispatcher, inbox := newUploadDispatcher(t)
	handler := api.Handler(dispatcher.Handle, api.Options{Upload: apiUploadStagingForTest{dispatcher}})
	files := make([]uploadFixture, 0, UploadMaxFilesPerRequest+1)
	for i := 0; i <= UploadMaxFilesPerRequest; i++ {
		files = append(files, uploadFixture{name: fmt.Sprintf("file-%03d.txt", i), content: []byte("x")})
	}
	request, _ := mustUploadRequestBuilt(t, files)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	code, reason, message := mustUploadError(t, recorder)
	if code != http.StatusUnprocessableEntity || reason != command.UploadReasonTooMany {
		t.Fatalf("upload refusal = %d %q %q", code, reason, message)
	}
	// The whole request was refused: no staged bytes and no empty directory
	// survive below the inbox.
	entries, err := os.ReadDir(inbox)
	if err != nil {
		t.Fatalf("read inbox: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("inbox not rolled back: %d entries remain", len(entries))
	}
	if dispatcher.uploadInFlight.Load() != 0 {
		t.Fatalf("in-flight bytes left at %d after rollback", dispatcher.uploadInFlight.Load())
	}
}

func TestUploadEndpointRejectsTraversalAndDisallowedNames(t *testing.T) {
	dispatcher, inbox := newUploadDispatcher(t)
	handler := api.Handler(dispatcher.Handle, api.Options{Upload: apiUploadStagingForTest{dispatcher}})
	cases := []struct {
		name   string
		reason string
	}{
		{name: "../evil.txt", reason: command.UploadReasonNameRejected},
		{name: `..\evil.txt`, reason: command.UploadReasonNameRejected},
		{name: "dir/../../evil", reason: command.UploadReasonNameRejected},
		{name: ".", reason: command.UploadReasonNameRejected},
		{name: "...", reason: command.UploadReasonNameRejected},
		{name: "", reason: command.UploadReasonNameRejected},
		{name: "CON", reason: command.UploadReasonNameRejected},
	}
	for _, testCase := range cases {
		request, _ := mustUploadRequestBuilt(t, []uploadFixture{{name: testCase.name, content: []byte("x")}})
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		code, reason, _ := mustUploadError(t, recorder)
		if code != http.StatusUnprocessableEntity || reason != testCase.reason {
			t.Fatalf("name %q refusal = %d %q, want %d %q", testCase.name, code, reason, http.StatusUnprocessableEntity, testCase.reason)
		}
		entries, err := os.ReadDir(inbox)
		if err != nil {
			t.Fatalf("read inbox: %v", err)
		}
		if len(entries) != 0 {
			t.Fatalf("refused name %q left staging behind: %d entries", testCase.name, len(entries))
		}
	}
}

func TestUploadWithoutStagingSupportIsTypedUnavailable(t *testing.T) {
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	dispatcher := NewDispatcher(store, filepath.Join(t.TempDir(), "catalog.sqlite"), "/tmp/cairn.sock")
	handler := api.Handler(dispatcher.Handle, api.Options{})
	request, _ := mustUploadRequestBuilt(t, []uploadFixture{{name: "a.txt", content: []byte("x")}})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	code, reason, _ := mustUploadError(t, recorder)
	if code != http.StatusServiceUnavailable || reason != command.UploadReasonUnavailable {
		t.Fatalf("upload without staging = %d reason=%q", code, reason)
	}
}

func TestUploadRefusedWhenInboxOverlapsTheRepository(t *testing.T) {
	dataRoot := t.TempDir()
	store := testutil.OpenStore(t, filepath.Join(dataRoot, "catalog.sqlite"))
	// A pathological profile pointing the repository at the derived inbox
	// subtree must disable uploads instead of writing into the repository.
	repo, err := repository.OpenDir(filepath.Join(dataRoot, inboxDirName))
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	dispatcher := NewDispatcher(store, filepath.Join(dataRoot, "catalog.sqlite"), "/tmp/cairn.sock", WithExact(&exact.Service{Store: store, Repo: repo}))
	if _, err := dispatcher.BeginUploadSession(); err == nil {
		t.Fatal("upload session started although the inbox overlaps the repository")
	}
}

func TestSourceListProjectsStagingInboxWithCountsAndBytes(t *testing.T) {
	ctx := context.Background()
	dispatcher, inbox := newUploadDispatcher(t)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "seed.txt"), []byte("seed"), 0o600); err != nil {
		t.Fatalf("write seed source: %v", err)
	}
	ingested := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})
	assertStagingEntry := func(wantFiles int, wantBytes int64, wantPresent bool) {
		t.Helper()
		listed := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSourceList, map[string]any{"workspace_id": ingested.WorkspaceID}))
		if listed.Status != command.StatusSucceeded {
			t.Fatalf("source.list = %q: %+v", listed.Status, listed.Reasons)
		}
		var data command.SourceListData
		if err := json.Unmarshal(listed.Data, &data); err != nil {
			t.Fatalf("decode source.list: %v", err)
		}
		var staging *command.SourceSummaryData
		configured := 0
		for index := range data.Sources {
			if data.Sources[index].Kind == inboxEntryKind {
				staging = &data.Sources[index]
			} else {
				configured++
			}
		}
		if !wantPresent {
			if staging != nil {
				t.Fatalf("staging entry present without staged bytes: %+v", staging)
			}
			if configured != 1 {
				t.Fatalf("configured sources = %d, want 1", configured)
			}
			return
		}
		if staging == nil {
			t.Fatalf("staging entry missing from source.list: %+v", data.Sources)
		}
		if staging.SourceRef != "" {
			t.Fatalf("staging entry must not carry a catalog source ref: %+v", staging)
		}
		if staging.Locator != inbox || staging.Staging == nil || staging.Staging.Path != inbox {
			t.Fatalf("staging entry locator = %+v", staging)
		}
		if staging.Staging.Files != wantFiles || staging.Staging.Bytes != wantBytes {
			t.Fatalf("staging counts = %+v, want files=%d bytes=%d", staging.Staging, wantFiles, wantBytes)
		}
		if staging.Staging.ProtectionRecord != inboxProtectionNone || staging.Staging.Note == "" {
			t.Fatalf("staging entry must say the bytes are unprotected: %+v", staging.Staging)
		}
	}
	assertStagingEntry(0, 0, false)
	handler := api.Handler(dispatcher.Handle, api.Options{Upload: apiUploadStagingForTest{dispatcher}})
	request, _ := mustUploadRequestBuilt(t, []uploadFixture{
		{name: "one.txt", content: []byte("12345")},
		{name: "two.txt", content: []byte("678")},
	})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("upload status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	assertStagingEntry(2, 8, true)
}

func TestStagingCleanRefusesAnythingOutsideTheInbox(t *testing.T) {
	ctx := context.Background()
	dispatcher, inbox := newUploadDispatcher(t)
	outside := t.TempDir()
	keep := filepath.Join(outside, "keep.txt")
	if err := os.WriteFile(keep, []byte("keep me"), 0o600); err != nil {
		t.Fatalf("write outside file: %v", err)
	}
	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSourceStagingClean, map[string]any{"directory": outside}))
	mustReasonFromResult(t, result, ReasonCodeInvalidInput)
	if _, err := os.Stat(keep); err != nil {
		t.Fatalf("outside file must survive a refused cleanup: %v", err)
	}
	// A directory below the inbox (one staging session) is also refused: the
	// operation is the inbox root's own cleanup, nothing broader.
	if err := os.MkdirAll(filepath.Join(inbox, "20260919-000000-000000"), 0o700); err != nil {
		t.Fatalf("create session dir: %v", err)
	}
	result = dispatcher.Handle(ctx, mustEnvelope(t, command.OpSourceStagingClean, map[string]any{"directory": filepath.Join(inbox, "20260919-000000-000000")}))
	mustReasonFromResult(t, result, ReasonCodeInvalidInput)
	// Cleanups are refused while upload bytes are still in flight, so a
	// concurrent request's partial files can never be swept away.
	dispatcher.uploadInFlight.Store(1024)
	result = dispatcher.Handle(ctx, mustEnvelope(t, command.OpSourceStagingClean, map[string]any{"directory": inbox}))
	mustReasonFromResult(t, result, ReasonCodeConflict)
	dispatcher.uploadInFlight.Store(0)
}

func TestStagingCleanRemovesOnlyInboxFilesAndReportsThem(t *testing.T) {
	ctx := context.Background()
	dispatcher, inbox := newUploadDispatcher(t)
	handler := api.Handler(dispatcher.Handle, api.Options{Upload: apiUploadStagingForTest{dispatcher}})
	request, _ := mustUploadRequestBuilt(t, []uploadFixture{
		{name: "one.txt", content: []byte("12345")},
		{name: "two.txt", content: []byte("678")},
	})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("upload status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	// A non-regular entry inside the inbox must be skipped, never followed.
	if err := os.Symlink(filepath.Join(t.TempDir(), "outside-target"), filepath.Join(inbox, "link")); err != nil {
		t.Fatalf("create symlink: %v", err)
	}
	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSourceStagingClean, map[string]any{"directory": inbox}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("staging clean = %q: %+v", result.Status, result.Reasons)
	}
	var data command.SourceStagingCleanData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatalf("decode staging clean: %v", err)
	}
	if data.Directory != filepath.Clean(inbox) {
		t.Fatalf("clean directory = %q, want %q", data.Directory, inbox)
	}
	if data.RemovedFiles != 2 || data.RemovedBytes != 8 || len(data.Removed) != 2 {
		t.Fatalf("clean report = %+v", data)
	}
	if len(data.Skipped) != 1 || data.Skipped[0] != "link" {
		t.Fatalf("clean skipped = %+v, want the symlink", data.Skipped)
	}
	remaining, err := os.ReadDir(inbox)
	if err != nil {
		t.Fatalf("read inbox after clean: %v", err)
	}
	// Files only: the empty daemon-created session directory and the skipped
	// symlink remain, while every staged regular file is gone.
	dirs, links := 0, 0
	for _, entry := range remaining {
		switch {
		case entry.IsDir():
			dirs++
		case !entry.Type().IsRegular():
			links++
		default:
			t.Fatalf("regular file %q survived the cleanup", entry.Name())
		}
	}
	if dirs != 1 || links != 1 {
		t.Fatalf("inbox after clean = %+v, want one empty session dir and one skipped symlink", remaining)
	}
}

func TestUploadToIngestHandoffProtectsStagedBytesThroughTheOrdinaryPlan(t *testing.T) {
	ctx := context.Background()
	dispatcher, inbox := newUploadDispatcher(t)
	handler := api.Handler(dispatcher.Handle, api.Options{Upload: apiUploadStagingForTest{dispatcher}})
	first := []byte("staged content one\n")
	second := []byte("staged content two\n")
	request, _ := mustUploadRequestBuilt(t, []uploadFixture{
		{name: "folder/first.txt", content: first},
		{name: "second.txt", content: second},
	})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("upload status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	_, upload := mustUploadResponse(t, recorder)
	if upload.StagingDir == "" {
		t.Fatalf("upload staged nothing: %+v", upload)
	}
	// The ordinary review -> digest-bound apply flow takes over from the
	// staging directory; nothing auto-ingests and nothing else is written.
	planned := dispatcher.Handle(ctx, mustEnvelope(t, command.OpPlanIngest, map[string]any{"root": upload.StagingDir}))
	if planned.Status != command.StatusSucceeded {
		t.Fatalf("plan.ingest = %q: %+v", planned.Status, planned.Reasons)
	}
	var plan command.PlanIngestData
	if err := json.Unmarshal(planned.Data, &plan); err != nil {
		t.Fatalf("decode plan.ingest: %v", err)
	}
	if plan.Files != 2 || plan.Bytes != int64(len(first)+len(second)) || !plan.Executable {
		t.Fatalf("staged plan estimate = %+v", plan)
	}
	applied := dispatcher.Handle(ctx, mustEnvelope(t, command.OpPlanApply, map[string]any{
		"workspace_id": plan.WorkspaceID,
		"plan_id":      plan.PlanID,
		"plan_digest":  plan.PlanDigest,
	}))
	if applied.Status != command.StatusSucceeded {
		t.Fatalf("plan.apply = %q: %+v", applied.Status, applied.Reasons)
	}
	var appliedData command.PlanApplyData
	if err := json.Unmarshal(applied.Data, &appliedData); err != nil {
		t.Fatalf("decode plan.apply: %v", err)
	}
	if appliedData.Files != 2 || appliedData.SnapshotRef == "" {
		t.Fatalf("plan.apply data = %+v", appliedData)
	}
	// The protected subjects are exactly the staged bytes: their snapshots
	// report both files protected, and the bytes match the digests the
	// upload echoed.
	snapshots := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSnapshotList, map[string]any{}))
	if snapshots.Status != command.StatusSucceeded {
		t.Fatalf("snapshot.list = %q: %+v", snapshots.Status, snapshots.Reasons)
	}
	var list command.SnapshotListData
	if err := json.Unmarshal(snapshots.Data, &list); err != nil {
		t.Fatalf("decode snapshot.list: %v", err)
	}
	if len(list.Snapshots) != 1 {
		t.Fatalf("snapshots = %+v", list.Snapshots)
	}
	snapshot := list.Snapshots[0]
	if snapshot.SnapshotRef != appliedData.SnapshotRef || snapshot.Files != 2 || snapshot.ProtectedFiles != 2 || snapshot.UnprotectedFiles != 0 {
		t.Fatalf("snapshot mix = %+v", snapshot)
	}
	destination := filepath.Join(t.TempDir(), "restore")
	restored := mustAppliedRestore(t, ctx, dispatcher, plan.WorkspaceID, appliedData.SnapshotRef, destination)
	if restored.Files != 2 {
		t.Fatalf("restore files = %d, want the 2 staged files", restored.Files)
	}
	for _, receipt := range upload.Files {
		name := receipt.StoredName
		stored, err := os.ReadFile(filepath.Join(destination, name))
		if err != nil {
			t.Fatalf("read restored %s: %v", name, err)
		}
		if expected := expectedDigest(t, stored); expected != receipt.SHA256 {
			t.Fatalf("restored %s digest = %s, want the staged %s", name, expected, receipt.SHA256)
		}
	}
	// The staging entry remains until the operator cleans it; protection
	// never deletes sources, and the staging entry stays visible.
	listed := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSourceList, map[string]any{"workspace_id": plan.WorkspaceID}))
	if listed.Status != command.StatusSucceeded {
		t.Fatalf("source.list after apply = %q: %+v", listed.Status, listed.Reasons)
	}
	var sources command.SourceListData
	if err := json.Unmarshal(listed.Data, &sources); err != nil {
		t.Fatalf("decode source.list: %v", err)
	}
	stagedEntry := false
	for _, item := range sources.Sources {
		if item.Kind == inboxEntryKind {
			stagedEntry = item.Staging != nil && item.Staging.Files == 2
		}
	}
	if !stagedEntry {
		t.Fatalf("staging entry must remain after apply: %+v", sources.Sources)
	}
	cleaned := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSourceStagingClean, map[string]any{"directory": inbox}))
	if cleaned.Status != command.StatusSucceeded {
		t.Fatalf("staging clean = %q: %+v", cleaned.Status, cleaned.Reasons)
	}
	var cleanData command.SourceStagingCleanData
	if err := json.Unmarshal(cleaned.Data, &cleanData); err != nil {
		t.Fatalf("decode staging clean: %v", err)
	}
	if cleanData.RemovedFiles != 2 {
		t.Fatalf("clean report = %+v", cleanData)
	}
}

func TestSanitizeUploadNameCases(t *testing.T) {
	cases := []struct {
		raw       string
		want      string
		rewritten bool
		rejected  bool
	}{
		{raw: "plain.txt", want: "plain.txt"},
		{raw: "folder/inside.txt", want: "inside.txt", rewritten: true},
		{raw: `win\path.bin`, want: "path.bin", rewritten: true},
		{raw: ".hidden", want: "hidden", rewritten: true},
		{raw: "trailing. ", want: "trailing", rewritten: true},
		{raw: "spaced  name.txt", want: "spaced  name.txt"},
		{raw: "../evil", rejected: true},
		{raw: "..", rejected: true},
		{raw: ".", rejected: true},
		{raw: "a/../../evil", rejected: true},
		{raw: "NUL", rejected: true},
		{raw: "con.txt", rejected: true},
		{raw: "  ", rejected: true},
	}
	for _, testCase := range cases {
		got, rewritten, err := sanitizeUploadName(testCase.raw)
		if testCase.rejected {
			if err == nil {
				t.Fatalf("sanitize(%q) = %q, want rejection", testCase.raw, got)
			}
			continue
		}
		if err != nil {
			t.Fatalf("sanitize(%q) refused: %v", testCase.raw, err)
		}
		if got != testCase.want || rewritten != testCase.rewritten {
			t.Fatalf("sanitize(%q) = %q rewritten=%v, want %q rewritten=%v", testCase.raw, got, rewritten, testCase.want, testCase.rewritten)
		}
	}
}

func TestUploadRejectsNonMultipartAndEmptyForms(t *testing.T) {
	dispatcher, _ := newUploadDispatcher(t)
	handler := api.Handler(dispatcher.Handle, api.Options{Upload: apiUploadStagingForTest{dispatcher}})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/upload", strings.NewReader("not multipart"))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	code, reason, _ := mustUploadError(t, recorder)
	if code != http.StatusBadRequest || reason != command.UploadReasonMalformed {
		t.Fatalf("non-multipart upload = %d %q", code, reason)
	}
	body, contentType := mustEmptyFormRequest(t)
	request = httptest.NewRequest(http.MethodPost, "/api/v1/upload", body)
	request.Header.Set("Content-Type", contentType)
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	code, reason, _ = mustUploadError(t, recorder)
	if code != http.StatusBadRequest || reason != command.UploadReasonEmpty {
		t.Fatalf("empty form upload = %d %q", code, reason)
	}
}

func mustEmptyFormRequest(t *testing.T) (io.Reader, string) {
	t.Helper()
	pr, pw := io.Pipe()
	writer := multipart.NewWriter(pw)
	go func() {
		_ = pw.CloseWithError(writer.Close())
	}()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/upload", pr)
	return request.Body, writer.FormDataContentType()
}

func bytesOf(t *testing.T, size int) []byte {
	t.Helper()
	content := make([]byte, size)
	if _, err := rand.Read(content); err != nil {
		t.Fatalf("random bytes: %v", err)
	}
	return content
}
