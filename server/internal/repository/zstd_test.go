package repository

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
)

type interruptedPlacementReader struct {
	body      []byte
	remaining int
	err       error
}

func (reader *interruptedPlacementReader) Read(p []byte) (int, error) {
	if reader.remaining == 0 {
		return 0, reader.err
	}
	count := reader.remaining
	if count > len(p) {
		count = len(p)
	}
	copy(p, reader.body[:count])
	reader.body = reader.body[count:]
	reader.remaining -= count
	return count, nil
}

func TestZstdDirReadbackCompressionAndDeduplication(t *testing.T) {
	ctx := context.Background()
	repo, err := OpenZstdDir(filepath.Join(t.TempDir(), "repo"))
	if err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte("restoreweave semantic content "), 4096)
	first, err := repo.Place(ctx, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	if first.Existed || first.Bytes != int64(len(payload)) || first.StoredBytes >= first.Bytes {
		t.Fatalf("unexpected compressed receipt: %+v", first)
	}
	body, err := repo.Open(ctx, first.ContentID)
	if err != nil {
		t.Fatal(err)
	}
	got, readErr := io.ReadAll(body)
	closeErr := body.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(got, payload) {
		t.Fatalf("readback bytes mismatch: len=%d read=%v close=%v", len(got), readErr, closeErr)
	}
	if err := repo.Verify(ctx, first.ContentID); err != nil {
		t.Fatal(err)
	}
	second, err := repo.PlaceExact(ctx, first.ContentID, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	if !second.Existed || second.StoredBytes != first.StoredBytes || second.ContentID != first.ContentID {
		t.Fatalf("deduplicated receipt: %+v then %+v", first, second)
	}
}

func TestZstdPlaceExactReusesExistingUnencryptedObject(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "repo")
	repo, err := OpenZstdDir(root)
	if err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte("reuseExact identical logical bytes "), 2048)
	first, err := repo.Place(ctx, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	if first.Existed || first.Bytes != int64(len(payload)) {
		t.Fatalf("first placement receipt: %+v", first)
	}
	before, err := os.ReadFile(blobPath(root, first.ContentID))
	if err != nil {
		t.Fatal(err)
	}

	incomingID, incomingLen := hashCompleteStream(t, bytes.NewReader(payload))
	if incomingID != first.ContentID || incomingLen != first.Bytes {
		t.Fatalf("incoming stream identity = %s/%d, want %s/%d", incomingID, incomingLen, first.ContentID, first.Bytes)
	}

	second, err := repo.PlaceExact(ctx, first.ContentID, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	requireEmptyTmp(t, root)
	if !second.Existed || second.StoredBytes != first.StoredBytes || second.ContentID != first.ContentID || second.Bytes != first.Bytes {
		t.Fatalf("reuseExact receipt: first=%+v second=%+v", first, second)
	}
	after, err := os.ReadFile(blobPath(root, first.ContentID))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("reuseExact rewrote the existing object")
	}

	existing, err := repo.Open(ctx, first.ContentID)
	if err != nil {
		t.Fatal(err)
	}
	existingID, existingLen := hashCompleteStream(t, existing)
	if closeErr := existing.Close(); closeErr != nil {
		t.Fatal(closeErr)
	}
	if existingID != first.ContentID || existingLen != first.Bytes {
		t.Fatalf("existing stream identity = %s/%d, want %s/%d", existingID, existingLen, first.ContentID, first.Bytes)
	}
	if incomingID != existingID || incomingLen != existingLen {
		t.Fatalf("independent stream hashes diverged: incoming=%s/%d existing=%s/%d", incomingID, incomingLen, existingID, existingLen)
	}
}

func TestZstdPlaceExactMismatchDoesNotRewriteExisting(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "repo")
	repo, err := OpenZstdDir(root)
	if err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte("existing unencrypted object "), 1024)
	other := bytes.Repeat([]byte("different logical body      "), 1024)
	first, err := repo.Place(ctx, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(blobPath(root, first.ContentID))
	if err != nil {
		t.Fatal(err)
	}

	if _, err := repo.PlaceExact(ctx, first.ContentID, bytes.NewReader(other)); !errors.Is(err, ErrDigestMismatch) {
		t.Fatalf("mismatch PlaceExact error = %v, want ErrDigestMismatch", err)
	}
	requireEmptyTmp(t, root)
	after, err := os.ReadFile(blobPath(root, first.ContentID))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("mismatch PlaceExact rewrote the existing object")
	}
	if err := repo.Verify(ctx, first.ContentID); err != nil {
		t.Fatalf("existing object verify after rejected PlaceExact: %v", err)
	}
}

func TestZstdPlaceExactCorruptObjectFailsClosedWithoutRepair(t *testing.T) {
	payload := bytes.Repeat([]byte("corrupt object must not be repaired by PlaceExact "), 512)
	tests := []struct {
		name   string
		mutate func(t *testing.T, path string, original []byte) []byte
	}{
		{
			name: "truncated",
			mutate: func(t *testing.T, path string, original []byte) []byte {
				t.Helper()
				if err := os.Truncate(path, int64(len(original)-1)); err != nil {
					t.Fatal(err)
				}
				mutated, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				return mutated
			},
		},
		{
			name: "mutated",
			mutate: func(t *testing.T, path string, original []byte) []byte {
				t.Helper()
				mutated := append([]byte(nil), original...)
				mutated[len(mutated)/2] ^= 0xff
				if err := os.WriteFile(path, mutated, 0o600); err != nil {
					t.Fatal(err)
				}
				return mutated
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			root := filepath.Join(t.TempDir(), "repo")
			repo, err := OpenZstdDir(root)
			if err != nil {
				t.Fatal(err)
			}
			receipt, err := repo.Place(ctx, bytes.NewReader(payload))
			if err != nil {
				t.Fatal(err)
			}
			path := blobPath(root, receipt.ContentID)
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if len(original) < 2 {
				t.Fatalf("placed object too small to mutate: %d bytes", len(original))
			}
			mutated := test.mutate(t, path, original)
			if err := repo.Verify(ctx, receipt.ContentID); err == nil {
				t.Fatal("corrupt zstd object verified before PlaceExact")
			}

			if _, err := repo.PlaceExact(ctx, receipt.ContentID, bytes.NewReader(payload)); err == nil {
				t.Fatal("PlaceExact repaired or accepted a corrupt existing object")
			}
			requireEmptyTmp(t, root)
			if err := repo.Verify(ctx, receipt.ContentID); err == nil {
				t.Fatal("corrupt object verified after PlaceExact")
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(after, mutated) {
				t.Fatal("PlaceExact replaced a corrupt object; only Repair may rewrite")
			}
		})
	}
}

func TestZstdEncryptedPlaceExactDuplicateDoesNotUseReuseExact(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "encrypted")
	key := bytes.Repeat([]byte{0x51}, 32)
	repo, err := OpenEncryptedZstdDir(root, "key://placement-test", testKeyProvider(map[string][]byte{
		"key://placement-test": key,
	}))
	if err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte("encrypted duplicate must take the seal path\n"), 256)
	first, err := repo.Place(ctx, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	if first.Existed || repo.encryption == nil {
		t.Fatalf("encrypted first placement = %+v encryption=%v", first, repo.encryption == nil)
	}
	before, err := os.ReadFile(blobPath(root, first.ContentID))
	if err != nil {
		t.Fatal(err)
	}

	second, err := repo.PlaceExact(ctx, first.ContentID, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	requireEmptyTmp(t, root)
	if !second.Existed || second.StoredBytes != first.StoredBytes || second.ContentID != first.ContentID {
		t.Fatalf("encrypted duplicate receipt: first=%+v second=%+v", first, second)
	}
	after, err := os.ReadFile(blobPath(root, first.ContentID))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("encrypted duplicate PlaceExact rewrote the existing sealed object")
	}
	if err := repo.Verify(ctx, first.ContentID); err != nil {
		t.Fatalf("encrypted object verify after duplicate PlaceExact: %v", err)
	}
	body, err := repo.Open(ctx, first.ContentID)
	if err != nil {
		t.Fatal(err)
	}
	got, readErr := io.ReadAll(body)
	closeErr := body.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(got, payload) {
		t.Fatalf("encrypted readback after duplicate PlaceExact: len=%d read=%v close=%v", len(got), readErr, closeErr)
	}
}

func TestZstdPlaceExactSymlinkBlobFailsClosed(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("strict no-follow open is platform-specific on Windows")
	}
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "repo")
	repo, err := OpenZstdDir(root)
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("symlink blob must fail closed")
	receipt, err := repo.Place(ctx, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	path := blobPath(root, receipt.ContentID)
	outside := filepath.Join(t.TempDir(), "outside-blob")
	if err := os.Rename(path, outside); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, path); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(outside)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := repo.PlaceExact(ctx, receipt.ContentID, bytes.NewReader(payload)); err == nil {
		t.Fatal("PlaceExact followed or accepted a symlinked blob")
	}
	requireEmptyTmp(t, root)
	after, err := os.ReadFile(outside)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("PlaceExact wrote through a symlink")
	}
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatal("PlaceExact replaced the symlink blob path")
	}
}

func TestZstdPlacementInterruptionLeavesNoObjectAndRetrySucceeds(t *testing.T) {
	ctx := context.Background()
	payload := bytes.Repeat([]byte("interrupted exact placement\n"), 256)
	sum := sha256.Sum256(payload)
	contentID := AlgorithmSHA256 + ":" + hex.EncodeToString(sum[:])
	sentinel := errors.New("injected placement interruption")

	tests := []struct {
		name string
		open func(string) (*ZstdDir, error)
	}{
		{
			name: "zstd",
			open: OpenZstdDir,
		},
		{
			name: "encrypted zstd",
			open: func(root string) (*ZstdDir, error) {
				key := bytes.Repeat([]byte{0x51}, 32)
				return OpenEncryptedZstdDir(root, "key://placement-test", testKeyProvider(map[string][]byte{
					"key://placement-test": key,
				}))
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "repository")
			repo, err := test.open(root)
			if err != nil {
				t.Fatal(err)
			}
			reader := &interruptedPlacementReader{
				body:      append([]byte(nil), payload...),
				remaining: len(payload) / 2,
				err:       sentinel,
			}
			if _, err := repo.PlaceExact(ctx, contentID, reader); !errors.Is(err, sentinel) {
				t.Fatalf("interrupted placement error = %v, want sentinel", err)
			}
			if _, err := os.Lstat(blobPath(root, contentID)); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("interrupted placement published object: %v", err)
			}
			temporary, err := os.ReadDir(filepath.Join(root, tmpDirName))
			if err != nil {
				t.Fatal(err)
			}
			if len(temporary) != 0 {
				t.Fatalf("interrupted placement left temporary files: %v", temporary)
			}

			receipt, err := repo.PlaceExact(ctx, contentID, bytes.NewReader(payload))
			if err != nil {
				t.Fatalf("retry placement: %v", err)
			}
			if receipt.ContentID != contentID || receipt.Bytes != int64(len(payload)) || receipt.Existed {
				t.Fatalf("retry receipt = %+v", receipt)
			}
			if err := repo.Verify(ctx, contentID); err != nil {
				t.Fatalf("verify retry: %v", err)
			}
			body, err := repo.Open(ctx, contentID)
			if err != nil {
				t.Fatal(err)
			}
			got, readErr := io.ReadAll(body)
			closeErr := body.Close()
			if readErr != nil || closeErr != nil || !bytes.Equal(got, payload) {
				t.Fatalf("retry readback mismatch: len=%d read=%v close=%v", len(got), readErr, closeErr)
			}
		})
	}
}

func TestZstdDirDetectsTruncationAndCorruption(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "repo")
	repo, err := OpenZstdDir(root)
	if err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte("checksum-protected payload "), 1000)
	receipt, err := repo.Place(ctx, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	path := blobPath(root, receipt.ContentID)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(path, info.Size()-1); err != nil {
		t.Fatal(err)
	}
	if err := repo.Verify(ctx, receipt.ContentID); err == nil {
		t.Fatal("truncated zstd frame verified successfully")
	}
	if body, err := repo.Open(ctx, receipt.ContentID); err == nil {
		// Header parsing may reject a damaged object before the first read.
		_, _ = io.Copy(io.Discard, body)
		_ = body.Close()
	}

	// A fresh object exercises the frame checksum path rather than only the
	// decoder's truncated-frame check.
	repo, err = OpenZstdDir(filepath.Join(t.TempDir(), "repo"))
	if err != nil {
		t.Fatal(err)
	}
	receipt, err = repo.Place(ctx, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	path = blobPath(repo.Root(), receipt.ContentID)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)-1] ^= 0xff
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := repo.Verify(ctx, receipt.ContentID); err == nil {
		t.Fatal("corrupted zstd frame verified successfully")
	}
}

func TestZstdDirRepairReplacesCorruptObject(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "repo")
	repo, err := OpenZstdDir(root)
	if err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte("zstd repair payload "), 128)
	receipt, err := repo.Place(ctx, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	path := blobPath(root, receipt.ContentID)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)/2] ^= 0xff
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := repo.Verify(ctx, receipt.ContentID); err == nil {
		t.Fatal("corrupt zstd object verified before repair")
	}
	if _, err := repo.Repair(ctx, receipt.ContentID, bytes.NewReader(payload)); err != nil {
		t.Fatal(err)
	}
	if err := repo.Verify(ctx, receipt.ContentID); err != nil {
		t.Fatal(err)
	}
	body, err := repo.Open(ctx, receipt.ContentID)
	if err != nil {
		t.Fatal(err)
	}
	got, readErr := io.ReadAll(body)
	_ = body.Close()
	if readErr != nil || !bytes.Equal(got, payload) {
		t.Fatalf("repaired zstd readback = %d bytes, err=%v", len(got), readErr)
	}
}

func TestZstdDirRelocationAndProfileMismatch(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "repo")
	repo, err := OpenZstdDir(root)
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := repo.Place(ctx, bytes.NewBufferString("relocatable"))
	if err != nil {
		t.Fatal(err)
	}
	moved := filepath.Join(t.TempDir(), "moved")
	if err := os.Rename(root, moved); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenZstdDir(moved)
	if err != nil {
		t.Fatal(err)
	}
	if err := reopened.Verify(ctx, receipt.ContentID); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenDir(moved); err == nil {
		t.Fatal("raw profile opened a zstd repository")
	}
	raw, err := OpenDir(filepath.Join(t.TempDir(), "raw"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := OpenZstdDir(raw.Root()); err == nil {
		t.Fatal("zstd profile opened a raw repository")
	}
	if _, err := OpenProfileWithCompression(RepositoryProfileLocalZstdV1, CompressionProfileIdentity, filepath.Join(t.TempDir(), "bad")); err == nil {
		t.Fatal("invalid profile tuple accepted")
	}
}

func TestZstdDirRejectsUnmarkedLegacyRawRepository(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	payload := []byte("legacy raw repository object")
	sum := sha256.Sum256(payload)
	contentID := AlgorithmSHA256 + ":" + hex.EncodeToString(sum[:])
	dest := blobPath(root, contentID)
	if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dest, payload, 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := OpenZstdDir(root); err == nil {
		t.Fatal("zstd profile adopted an unmarked legacy raw repository")
	}
	if _, err := os.Stat(filepath.Join(root, repositoryProfileFile)); !os.IsNotExist(err) {
		t.Fatalf("failed zstd open wrote a profile marker: %v", err)
	}
	raw, err := OpenDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := raw.Verify(ctx, contentID); err != nil {
		t.Fatalf("legacy raw repository migration: %v", err)
	}
}

func TestConcurrentZstdOpenUsesOneProfileAndIdentity(t *testing.T) {
	root := filepath.Join(t.TempDir(), "repository")
	const workers = 8
	repositories := make([]*ZstdDir, workers)
	errs := make([]error, workers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			repositories[i], errs[i] = OpenZstdDir(root)
		}(i)
	}
	close(start)
	wg.Wait()
	identity := ""
	for i := range repositories {
		if errs[i] != nil {
			t.Fatalf("open %d: %v", i, errs[i])
		}
		if identity == "" {
			identity = repositories[i].RepositoryIdentity()
		}
		if repositories[i].RepositoryIdentity() != identity {
			t.Fatalf("repository identities differ: %q != %q", repositories[i].RepositoryIdentity(), identity)
		}
	}
}

func TestZstdDirRecordDriverAndConcurrentNoReplace(t *testing.T) {
	ctx := context.Background()
	repo, err := OpenProfile(RepositoryProfileLocalZstdV1, filepath.Join(t.TempDir(), "repo"))
	if err != nil {
		t.Fatal(err)
	}
	record, err := repo.PlaceRecord(ctx, RecordPublicationCommit, bytes.NewBufferString(`{"commit":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.VerifyRecord(ctx, record); err != nil {
		t.Fatal(err)
	}
	opened, err := repo.OpenRecord(ctx, record.Role, record.Digest)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(opened)
	_ = opened.Close()
	if err != nil || string(data) != `{"commit":true}` {
		t.Fatalf("record readback = %q, err=%v", data, err)
	}

	payload := bytes.Repeat([]byte("concurrent placement "), 1000)
	const workers = 8
	receipts := make([]Receipt, workers)
	errs := make([]error, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			receipts[i], errs[i] = repo.Place(ctx, bytes.NewReader(payload))
		}(i)
	}
	wg.Wait()
	created := 0
	for i := range receipts {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		if !receipts[i].Existed {
			created++
		}
	}
	if created != 1 {
		t.Fatalf("concurrent placements created %d objects", created)
	}
}

func TestStoredBytesForRawAndMemory(t *testing.T) {
	ctx := context.Background()
	payload := []byte("logical bytes")
	raw, err := OpenDir(filepath.Join(t.TempDir(), "raw"))
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := raw.Place(ctx, bytes.NewReader(payload))
	if err != nil || receipt.StoredBytes != receipt.Bytes {
		t.Fatalf("raw receipt = %+v, err=%v", receipt, err)
	}
	memory := NewMemory()
	receipt, err = memory.Place(ctx, bytes.NewReader(payload))
	if err != nil || receipt.StoredBytes != receipt.Bytes {
		t.Fatalf("memory receipt = %+v, err=%v", receipt, err)
	}
}

func TestDescribeRepositoryProfiles(t *testing.T) {
	raw, err := OpenDir(filepath.Join(t.TempDir(), "raw"))
	if err != nil {
		t.Fatal(err)
	}
	zstdRepo, err := OpenZstdDir(filepath.Join(t.TempDir(), "zstd"))
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name        string
		driver      Driver
		repository  string
		compression string
	}{
		{"raw", raw, RepositoryProfileDirectoryCASDev, CompressionProfileIdentity},
		{"zstd", zstdRepo, RepositoryProfileLocalZstdV1, CompressionProfileZstdV1},
		{"memory", NewMemory(), "memory-test-v1", CompressionProfileIdentity},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := DescribeProfile(test.driver)
			if got.Repository != test.repository || got.Compression != test.compression {
				t.Fatalf("profile = %+v", got)
			}
		})
	}
}

func hashCompleteStream(t *testing.T, body io.Reader) (string, int64) {
	t.Helper()
	digest := sha256.New()
	n, err := io.Copy(digest, body)
	if err != nil {
		t.Fatalf("hash complete stream: %v", err)
	}
	return AlgorithmSHA256 + ":" + hex.EncodeToString(digest.Sum(nil)), n
}

func requireEmptyTmp(t *testing.T, root string) {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(root, tmpDirName))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("tmp/ not empty after PlaceExact: %v", entries)
	}
}
