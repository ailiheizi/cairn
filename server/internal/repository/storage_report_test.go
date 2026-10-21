package repository

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type swapOnOpenStorageDriver struct {
	*Dir
	contentID string
}

func (d *swapOnOpenStorageDriver) Open(ctx context.Context, contentID string) (io.ReadCloser, error) {
	body, err := d.Dir.Open(ctx, contentID)
	if err != nil || contentID != d.contentID {
		return body, err
	}
	path := blobPath(d.Root(), contentID)
	stat, err := os.Stat(path)
	if err != nil {
		_ = body.Close()
		return nil, err
	}
	replacement := path + ".replacement"
	if err := os.WriteFile(replacement, []byte("same bytes"), stat.Mode().Perm()); err != nil {
		_ = body.Close()
		return nil, err
	}
	if err := os.Rename(replacement, path); err != nil {
		_ = body.Close()
		return nil, err
	}
	return body, nil
}

func (d *swapOnOpenStorageDriver) RepositoryProfile() ProfileDescription {
	return d.Dir.RepositoryProfile()
}
func (d *swapOnOpenStorageDriver) savingsRoot() *Dir { return d.Dir }

func TestMeasureSnapshotStorageUsesAuthenticatedReferenceOccurrences(t *testing.T) {
	ctx := context.Background()
	repo, err := OpenDir(t.TempDir() + "/repo")
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("one exact object, referenced by two retained snapshots")
	placed, err := repo.Place(ctx, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	report, err := MeasureSnapshotStorage(ctx, repo, []SnapshotFileReference{
		{ContentID: placed.ContentID, Bytes: int64(len(payload))},
		{ContentID: placed.ContentID, Bytes: int64(len(payload))},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := report.RetainedExactReferenceBytes.Bytes; got != int64(len(payload))*2 {
		t.Fatalf("retained reference bytes = %d, want %d", got, int64(len(payload))*2)
	}
	if got := report.UniqueExactObjectLogicalBytes.Bytes; got != int64(len(payload)) {
		t.Fatalf("unique logical bytes = %d, want %d", got, len(payload))
	}
	if got := report.WholeFileDuplicateReferenceSavingsBytes.Bytes; got != int64(len(payload)) {
		t.Fatalf("duplicate reference comparison = %d, want %d", got, len(payload))
	}
	if report.StoredObjectFileBytes.Status != StorageMeasureMeasured || report.RepositoryFootprintFileBytes.Status != StorageMeasureMeasured {
		t.Fatalf("repository byte categories not measured: %+v", report)
	}
}

func TestMeasureSnapshotStorageRawAndZstdAccounting(t *testing.T) {
	ctx := context.Background()
	payload := bytes.Repeat([]byte("Cairn storage report compressible fixture\n"), 4096)
	for _, profile := range []struct {
		name            string
		open            func(string) (Driver, error)
		wantCompression bool
	}{
		{name: "raw", open: func(path string) (Driver, error) { return OpenDir(path) }},
		{name: "zstd", open: func(path string) (Driver, error) { return OpenZstdDir(path) }, wantCompression: true},
	} {
		t.Run(profile.name, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "repo")
			driver, err := profile.open(root)
			if err != nil {
				t.Fatal(err)
			}
			placed, err := driver.Place(ctx, bytes.NewReader(payload))
			if err != nil {
				t.Fatal(err)
			}
			report, err := MeasureSnapshotStorage(ctx, driver, []SnapshotFileReference{{ContentID: placed.ContentID, Bytes: int64(len(payload))}})
			if err != nil {
				t.Fatal(err)
			}
			if report.CompressionSavingsBytes.Status != StorageMeasureMeasured {
				t.Fatalf("compression savings are not measured: %+v", report.CompressionSavingsBytes)
			}
			if profile.wantCompression && report.CompressionSavingsBytes.Bytes <= 0 {
				t.Fatalf("zstd fixture did not show positive compression: %+v", report.CompressionSavingsBytes)
			}
			if !profile.wantCompression && report.CompressionSavingsBytes.Bytes != 0 {
				t.Fatalf("raw profile reported compression savings: %+v", report.CompressionSavingsBytes)
			}
			var walked int64
			if err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
				if walkErr != nil {
					return walkErr
				}
				if entry.IsDir() {
					return nil
				}
				info, err := os.Lstat(path)
				if err != nil {
					return err
				}
				if !info.Mode().IsRegular() {
					return fmt.Errorf("unexpected non-regular fixture entry: %s", path)
				}
				walked += info.Size()
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			accounted := report.StoredObjectFileBytes.Bytes + report.RepositoryMetadataFileBytes.Bytes + report.RepositoryRecoveryRecordFileBytes.Bytes
			if accounted != walked || report.RepositoryFootprintFileBytes.Bytes != walked {
				t.Fatalf("repository accounting = stored %d + metadata %d + recovery %d = %d, independently walked %d, footprint %d", report.StoredObjectFileBytes.Bytes, report.RepositoryMetadataFileBytes.Bytes, report.RepositoryRecoveryRecordFileBytes.Bytes, accounted, walked, report.RepositoryFootprintFileBytes.Bytes)
			}
		})
	}
}

func TestMeasureSnapshotStorageRejectsUnreferencedObject(t *testing.T) {
	ctx := context.Background()
	repo, err := OpenDir(t.TempDir() + "/repo")
	if err != nil {
		t.Fatal(err)
	}
	first, err := repo.Place(ctx, bytes.NewReader([]byte("referenced")))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Place(ctx, bytes.NewReader([]byte("unreferenced"))); err != nil {
		t.Fatal(err)
	}
	if _, err := MeasureSnapshotStorage(ctx, repo, []SnapshotFileReference{{ContentID: first.ContentID, Bytes: first.Bytes}}); err == nil {
		t.Fatal("measurement accepted an unreferenced payload object")
	}
}

func TestMeasureSnapshotStorageRejectsUnknownRecoveryLayout(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "repo")
	repo, err := OpenDir(root)
	if err != nil {
		t.Fatal(err)
	}
	placed, err := repo.Place(ctx, bytes.NewReader([]byte("referenced")))
	if err != nil {
		t.Fatal(err)
	}
	unknown := filepath.Join(root, recoveryDirName, "unknown", "nested", "payload")
	if err := os.MkdirAll(filepath.Dir(unknown), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(unknown, []byte("unclassified"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := MeasureSnapshotStorage(ctx, repo, []SnapshotFileReference{{ContentID: placed.ContentID, Bytes: placed.Bytes}}); err == nil {
		t.Fatal("measurement accepted an unrecognized nested recovery file")
	}
}

func TestMeasureSnapshotStorageCountsOnlyRecognizedPublicationLock(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "repo")
	repo, err := OpenDir(root)
	if err != nil {
		t.Fatal(err)
	}
	placed, err := repo.Place(ctx, bytes.NewReader([]byte("referenced")))
	if err != nil {
		t.Fatal(err)
	}
	lockDir := filepath.Join(root, recoveryDirName, "locks")
	if err := os.MkdirAll(lockDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(lockDir, "publication-"+strings.Repeat("a", 64)+".lock"), []byte("lock"), 0o600); err != nil {
		t.Fatal(err)
	}
	report, err := MeasureSnapshotStorage(ctx, repo, []SnapshotFileReference{{ContentID: placed.ContentID, Bytes: placed.Bytes}})
	if err != nil {
		t.Fatal(err)
	}
	if report.RepositoryMetadataFileBytes.Bytes < int64(len("lock")) {
		t.Fatalf("valid lock bytes were omitted from repository metadata: %+v", report.RepositoryMetadataFileBytes)
	}
}

func TestMeasureSnapshotStorageIncludesRepoLocalLexicalIndexAndSidecars(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "repo")
	repo, err := OpenDir(root)
	if err != nil {
		t.Fatal(err)
	}
	placed, err := repo.Place(ctx, bytes.NewReader([]byte("referenced")))
	if err != nil {
		t.Fatal(err)
	}
	indexDir := filepath.Join(root, "indexes")
	if err := os.MkdirAll(indexDir, 0o700); err != nil {
		t.Fatal(err)
	}
	indexPath := filepath.Join(indexDir, "idx_0123456789abcdef0123456789abcdef.sqlite")
	for path, body := range map[string]string{
		indexPath:          "sqlite-index",
		indexPath + "-wal": "wal",
		indexPath + "-shm": "shm",
	} {
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	report, err := MeasureSnapshotStorage(ctx, repo, []SnapshotFileReference{{ContentID: placed.ContentID, Bytes: placed.Bytes}})
	if err != nil {
		t.Fatal(err)
	}
	want := int64(len("sqlite-index") + len("wal") + len("shm"))
	if report.RepositoryMetadataFileBytes.Bytes < want {
		t.Fatalf("repo-local lexical index bytes omitted: got %d, want at least %d", report.RepositoryMetadataFileBytes.Bytes, want)
	}
	if !strings.Contains(report.RepositoryMetadataFileBytes.Reason, "repo-local retained lexical indexes") {
		t.Fatalf("metadata measure does not disclose lexical index inclusion: %+v", report.RepositoryMetadataFileBytes)
	}
}

func TestMeasureSnapshotStorageRejectsUnknownIndexLayout(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "repo")
	repo, err := OpenDir(root)
	if err != nil {
		t.Fatal(err)
	}
	placed, err := repo.Place(ctx, bytes.NewReader([]byte("referenced")))
	if err != nil {
		t.Fatal(err)
	}
	indexDir := filepath.Join(root, "indexes")
	if err := os.MkdirAll(indexDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(indexDir, "other.sqlite"), []byte("unknown"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := MeasureSnapshotStorage(ctx, repo, []SnapshotFileReference{{ContentID: placed.ContentID, Bytes: placed.Bytes}}); err == nil {
		t.Fatal("measurement accepted an unrecognized index filename")
	}
}

func TestMeasureSnapshotStorageBindsPhysicalSizeToVerifiedFile(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "repo")
	repo, err := OpenDir(root)
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("same bytes")
	placed, err := repo.Place(ctx, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	driver := &swapOnOpenStorageDriver{Dir: repo, contentID: placed.ContentID}
	if _, err := MeasureSnapshotStorage(ctx, driver, []SnapshotFileReference{{ContentID: placed.ContentID, Bytes: int64(len(payload))}}); err == nil {
		t.Fatal("measurement accepted a physical file replaced after its verified descriptor was opened")
	}
}
