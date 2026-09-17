package repository

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestCleanStaleTemporaryRemovesOnlyAgedRegularFiles proves the sweep removes
// exactly the aged orphan and leaves payload objects and portable records
// byte-identical.
func TestCleanStaleTemporaryRemovesOnlyAgedRegularFiles(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "repository")
	repo, err := OpenZstdDir(root)
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := repo.Place(ctx, bytes.NewReader(bytes.Repeat([]byte("swept payload\n"), 64)))
	if err != nil {
		t.Fatal(err)
	}
	record, err := repo.PlaceRecord(ctx, RecordPublicationCommit, strings.NewReader(`{"swept":true}`))
	if err != nil {
		t.Fatal(err)
	}
	objectBefore, err := os.ReadFile(blobPath(root, receipt.ContentID))
	if err != nil {
		t.Fatal(err)
	}

	orphan := filepath.Join(root, tmpDirName, "place-orphan.zst")
	if err := os.WriteFile(orphan, []byte("orphan bytes"), 0o600); err != nil {
		t.Fatal(err)
	}

	removed, err := CleanStaleTemporary(ctx, root, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 0 {
		t.Fatalf("fresh sweep removed %d entries, want 0", removed)
	}

	past := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(orphan, past, past); err != nil {
		t.Fatal(err)
	}
	removed, err = CleanStaleTemporary(ctx, root, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 1 {
		t.Fatalf("aged sweep removed %d entries, want 1", removed)
	}
	if _, err := os.Lstat(orphan); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("aged orphan survived the sweep: %v", err)
	}
	objectAfter, err := os.ReadFile(blobPath(root, receipt.ContentID))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(objectBefore, objectAfter) {
		t.Fatal("sweep changed payload object bytes")
	}
	if err := repo.Verify(ctx, receipt.ContentID); err != nil {
		t.Fatalf("payload verify after sweep: %v", err)
	}
	if err := repo.VerifyRecord(ctx, record); err != nil {
		t.Fatalf("portable record verify after sweep: %v", err)
	}
}

func TestCleanStaleTemporaryRejectsNonPositiveThreshold(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "repository")
	if _, err := OpenZstdDir(root); err != nil {
		t.Fatal(err)
	}
	orphan := filepath.Join(root, tmpDirName, "place-orphan.zst")
	if err := os.WriteFile(orphan, []byte("orphan bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(orphan, past, past); err != nil {
		t.Fatal(err)
	}
	for _, threshold := range []time.Duration{0, -time.Second} {
		if _, err := CleanStaleTemporary(ctx, root, threshold); err == nil {
			t.Fatalf("threshold %s was accepted", threshold)
		}
		if _, err := os.Lstat(orphan); err != nil {
			t.Fatalf("threshold %s removed the orphan: %v", threshold, err)
		}
	}
}

// TestCleanStaleTemporaryFailsClosedOnUnexpectedEntries proves an unexpected
// entry stops the whole sweep, so an aged orphan is not removed while the
// repository is in an unexplained state.
func TestCleanStaleTemporaryFailsClosedOnUnexpectedEntries(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "repository")
	if _, err := OpenZstdDir(root); err != nil {
		t.Fatal(err)
	}
	temporaryRoot := filepath.Join(root, tmpDirName)
	orphan := filepath.Join(temporaryRoot, "place-orphan.zst")
	if err := os.WriteFile(orphan, []byte("orphan bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(orphan, past, past); err != nil {
		t.Fatal(err)
	}

	outside := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(outside, []byte("outside bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(temporaryRoot, "suspect-link")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	if _, err := CleanStaleTemporary(ctx, root, time.Hour); err == nil {
		t.Fatal("sweep accepted a symlink under tmp/")
	}
	if _, err := os.Lstat(link); err != nil {
		t.Fatalf("sweep removed the symlink before failing: %v", err)
	}
	if _, err := os.Lstat(orphan); err != nil {
		t.Fatalf("symlink failure also removed the aged orphan: %v", err)
	}
	outsideAfter, err := os.ReadFile(outside)
	if err != nil {
		t.Fatal(err)
	}
	if string(outsideAfter) != "outside bytes" {
		t.Fatal("sweep followed a symlink out of the repository")
	}

	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	nested := filepath.Join(temporaryRoot, "nested")
	if err := os.MkdirAll(nested, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := CleanStaleTemporary(ctx, root, time.Hour); err == nil {
		t.Fatal("sweep accepted a directory under tmp/")
	}
	if _, err := os.Lstat(nested); err != nil {
		t.Fatalf("sweep removed the nested directory: %v", err)
	}
	if _, err := os.Lstat(orphan); err != nil {
		t.Fatalf("directory failure also removed the aged orphan: %v", err)
	}
}

func TestCleanStaleTemporaryRequiresTemporaryDirectory(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	if _, err := CleanStaleTemporary(ctx, root, time.Hour); err == nil {
		t.Fatal("sweep silently succeeded without a repository temporary directory")
	}
	if _, err := CleanStaleTemporary(ctx, "", time.Hour); err == nil {
		t.Fatal("sweep accepted an empty repository path")
	}
}

// TestPlaceExactProcessCrashLeavesStaleTemporaryAndRecovers kills a real
// process during exact placement and proves the resulting state: nothing was
// published, one orphan temp file remains, a fresh retry publishes and
// verifies the object, and the explicit sweep is what makes the repository
// measurable again. Placement itself never sweeps the orphan.
func TestPlaceExactProcessCrashLeavesStaleTemporaryAndRecovers(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "repository")
	repo, err := OpenZstdDir(root)
	if err != nil {
		t.Fatal(err)
	}
	payload := placementCrashPayload()
	sum := sha256.Sum256(payload)
	contentID := AlgorithmSHA256 + ":" + hex.EncodeToString(sum[:])
	marker := filepath.Join(t.TempDir(), "placement-crash.marker")

	command := exec.Command(os.Args[0], "-test.run=TestPlaceExactProcessCrashHelperProcess")
	command.Env = append(os.Environ(),
		"RW_PLACEMENT_CRASH_HELPER=1",
		"RW_PLACEMENT_CRASH_ROOT="+root,
		"RW_PLACEMENT_CRASH_MARKER="+marker,
	)
	var helperOutput bytes.Buffer
	command.Stdout = &helperOutput
	command.Stderr = &helperOutput
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	waitComplete := false
	defer func() {
		if !waitComplete {
			_ = command.Process.Kill()
			<-done
		}
	}()
	deadline := time.NewTimer(15 * time.Second)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer deadline.Stop()
	defer ticker.Stop()
	for {
		select {
		case err := <-done:
			waitComplete = true
			t.Fatalf("crash helper exited before the marker: %v (%s)", err, helperOutput.String())
		case <-ticker.C:
			if _, err := os.Stat(marker); err == nil {
				if entries, readErr := os.ReadDir(filepath.Join(root, tmpDirName)); readErr == nil && len(entries) > 0 {
					goto crash
				}
			} else if !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("stat crash marker: %v", err)
			}
		case <-deadline.C:
			_ = command.Process.Kill()
			<-done
			waitComplete = true
			t.Fatal("timed out waiting for the placement crash marker")
		}
	}

crash:
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err == nil {
		t.Fatal("crash helper unexpectedly exited cleanly")
	}
	waitComplete = true

	if _, err := os.Lstat(blobPath(root, contentID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("crashed placement published an object: %v", err)
	}
	entries, err := os.ReadDir(filepath.Join(root, tmpDirName))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].IsDir() {
		t.Fatalf("crashed placement left unexpected temporary state: %v", entries)
	}
	orphan := filepath.Join(root, tmpDirName, entries[0].Name())

	retry, err := repo.PlaceExact(ctx, contentID, bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("retry after crash: %v", err)
	}
	if retry.Existed || retry.ContentID != contentID {
		t.Fatalf("retry receipt after crash = %+v", retry)
	}
	if err := repo.Verify(ctx, contentID); err != nil {
		t.Fatalf("verify retry after crash: %v", err)
	}
	body, err := repo.Open(ctx, contentID)
	if err != nil {
		t.Fatal(err)
	}
	gotID, gotLen := hashCompleteStream(t, body)
	closeErr := body.Close()
	if closeErr != nil {
		t.Fatal(closeErr)
	}
	if gotID != contentID || gotLen != int64(len(payload)) {
		t.Fatalf("retry readback = %s/%d, want %s/%d", gotID, gotLen, contentID, len(payload))
	}
	if _, err := os.Lstat(orphan); err != nil {
		t.Fatalf("successful retry swept the crash orphan: %v", err)
	}

	if report, err := MeasureSavings(ctx, repo, []Receipt{retry}); err == nil {
		t.Fatalf("measurement accepted a repository with a crash orphan: %+v", report)
	}
	removed, err := CleanStaleTemporary(ctx, root, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 0 {
		t.Fatalf("fresh-threshold sweep removed %d entries, want 0", removed)
	}
	if report, err := MeasureSavings(ctx, repo, []Receipt{retry}); err == nil {
		t.Fatalf("measurement accepted the crash orphan after a fresh-threshold sweep: %+v", report)
	}

	past := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(orphan, past, past); err != nil {
		t.Fatal(err)
	}
	removed, err = CleanStaleTemporary(ctx, root, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 1 {
		t.Fatalf("aged sweep removed %d entries, want 1", removed)
	}
	if _, err := os.Lstat(orphan); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("crash orphan survived the aged sweep: %v", err)
	}
	if _, err := MeasureSavings(ctx, repo, []Receipt{retry}); err != nil {
		t.Fatalf("measurement after the sweep: %v", err)
	}
}

// placementCrashPayload is shared by the parent test and the helper process so
// both compute the same content identity.
func placementCrashPayload() []byte {
	return bytes.Repeat([]byte("placement crash payload\n"), 4096)
}

// crashPlacementReader delivers one chunk, signals readiness, and then blocks
// so the parent can kill this process while the placement temp file exists.
type crashPlacementReader struct {
	body      []byte
	offset    int
	marker    string
	delivered bool
}

func (reader *crashPlacementReader) Read(p []byte) (int, error) {
	if reader.delivered {
		time.Sleep(time.Hour)
	}
	if reader.offset >= len(reader.body) {
		return 0, io.EOF
	}
	reader.delivered = true
	if err := os.WriteFile(reader.marker, []byte("placement-started\n"), 0o600); err != nil {
		return 0, err
	}
	n := copy(p, reader.body[reader.offset:])
	reader.offset += n
	return n, nil
}

func TestPlaceExactProcessCrashHelperProcess(t *testing.T) {
	if os.Getenv("RW_PLACEMENT_CRASH_HELPER") != "1" {
		return
	}
	root := os.Getenv("RW_PLACEMENT_CRASH_ROOT")
	repo, err := OpenZstdDir(root)
	if err != nil {
		t.Fatalf("crash helper open repository: %v", err)
	}
	payload := placementCrashPayload()
	sum := sha256.Sum256(payload)
	contentID := AlgorithmSHA256 + ":" + hex.EncodeToString(sum[:])
	reader := &crashPlacementReader{body: payload, marker: os.Getenv("RW_PLACEMENT_CRASH_MARKER")}
	if _, err := repo.PlaceExact(context.Background(), contentID, reader); err != nil {
		t.Fatalf("crash helper placement: %v", err)
	}
}
