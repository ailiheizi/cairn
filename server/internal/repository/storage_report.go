package repository

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const (
	StorageMeasureMeasured    = "MEASURED"
	StorageMeasureUnmeasured  = "UNMEASURED"
	StorageMeasureUnavailable = "UNAVAILABLE"
)

// SnapshotFileReference is an authenticated retained file reference supplied
// by the exact service after it has assembled and validated committed
// manifests. It is not an ingest placement receipt.
type SnapshotFileReference struct {
	ContentID string
	Bytes     int64
}

type StorageByteMeasure struct {
	Status string
	Bytes  int64
	Reason string
}

// SnapshotStorageReport measures snapshot-reference counts and the matching
// in-tree object repository. Duplicate savings here compare retained file
// reference occurrences with unique exact identities; they do not claim
// placement history or current-library uniqueness.
type SnapshotStorageReport struct {
	RetainedExactReferenceBytes             StorageByteMeasure
	UniqueExactObjectLogicalBytes           StorageByteMeasure
	WholeFileDuplicateReferenceSavingsBytes StorageByteMeasure
	CompressionSavingsBytes                 StorageByteMeasure
	StoredObjectFileBytes                   StorageByteMeasure
	RepositoryMetadataFileBytes             StorageByteMeasure
	RepositoryRecoveryRecordFileBytes       StorageByteMeasure
	RepositoryFootprintFileBytes            StorageByteMeasure
}

// MeasureSnapshotStorage verifies every unique referenced object through the
// repository driver, independently hashes its logical bytes, then checks the
// complete payload namespace for missing or extra objects. Unknown files,
// symlinks, unsupported layouts, and inconsistent references fail closed.
func MeasureSnapshotStorage(ctx context.Context, driver Driver, refs []SnapshotFileReference) (SnapshotStorageReport, error) {
	if err := ctx.Err(); err != nil {
		return SnapshotStorageReport{}, err
	}
	dir, ok := storageRoot(driver)
	if !ok || dir == nil {
		return SnapshotStorageReport{}, errors.New("storage report requires an in-tree directory repository")
	}
	profile, ok := driver.(profileReporter)
	if !ok {
		return SnapshotStorageReport{}, errors.New("storage report does not support the active repository profile")
	}
	description := profile.RepositoryProfile()
	if description.Encryption != EncryptionNone || description.Repository != RepositoryProfileDirectoryCASDev && description.Repository != RepositoryProfileLocalZstdV1 {
		return SnapshotStorageReport{}, errors.New("storage report does not support the active repository profile")
	}
	rootInfo, err := os.Lstat(dir.root)
	if err != nil || !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return SnapshotStorageReport{}, fmt.Errorf("repository root is not a stable directory: %v", err)
	}

	expected := make(map[string]int64, len(refs))
	var retained int64
	for _, ref := range refs {
		if _, err := parseContentID(ref.ContentID); err != nil || ref.Bytes < 0 {
			return SnapshotStorageReport{}, fmt.Errorf("invalid authenticated snapshot file reference %q", ref.ContentID)
		}
		if previous, exists := expected[ref.ContentID]; exists && previous != ref.Bytes {
			return SnapshotStorageReport{}, fmt.Errorf("conflicting logical lengths for %s", ref.ContentID)
		}
		expected[ref.ContentID] = ref.Bytes
		retained += ref.Bytes
	}

	var unique int64
	var compression int64
	verifiedObjects := make(map[string]os.FileInfo, len(expected))
	for contentID, want := range expected {
		if err := ctx.Err(); err != nil {
			return SnapshotStorageReport{}, err
		}
		objectPath := blobPath(dir.root, contentID)
		before, err := os.Lstat(objectPath)
		if err != nil || !before.Mode().IsRegular() {
			return SnapshotStorageReport{}, fmt.Errorf("referenced object is not a regular file before verification: %s", contentID)
		}
		got, err := readbackLogicalObject(ctx, driver, contentID)
		if err != nil {
			return SnapshotStorageReport{}, fmt.Errorf("verify referenced object %s: %w", contentID, err)
		}
		after, err := os.Lstat(objectPath)
		if err != nil || !sameMeasuredFile(before, after) {
			return SnapshotStorageReport{}, fmt.Errorf("referenced object changed while its logical bytes were verified: %s", contentID)
		}
		if got != want {
			return SnapshotStorageReport{}, fmt.Errorf("referenced object %s has logical length %d, expected %d", contentID, got, want)
		}
		verifiedObjects[contentID] = after
		unique += got
	}

	blobRoot := filepath.Join(dir.root, blobDirName, AlgorithmSHA256)
	blobParent := filepath.Join(dir.root, blobDirName)
	parentInfo, err := os.Lstat(blobParent)
	if err != nil || !parentInfo.IsDir() || parentInfo.Mode()&os.ModeSymlink != 0 {
		return SnapshotStorageReport{}, fmt.Errorf("payload parent is not a no-follow directory: %s", blobParent)
	}
	var stored int64
	seen := make(map[string]struct{}, len(expected))
	directories := map[string]os.FileInfo{blobParent: parentInfo}
	err = filepath.WalkDir(blobRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if path == blobRoot {
			if entry.Type()&os.ModeSymlink != 0 || !entry.IsDir() {
				return fmt.Errorf("payload root is not a directory: %s", path)
			}
			info, err := os.Lstat(path)
			if err != nil || !info.IsDir() {
				return fmt.Errorf("payload root changed during measurement: %s", path)
			}
			directories[path] = info
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in payload namespace: %s", path)
		}
		relative, err := filepath.Rel(blobRoot, path)
		if err != nil {
			return err
		}
		parts := strings.Split(relative, string(filepath.Separator))
		if entry.IsDir() {
			if len(parts) != 1 || !validDigestPrefix(parts[0]) {
				return fmt.Errorf("unexpected payload directory: %s", path)
			}
			info, err := os.Lstat(path)
			if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("payload directory changed during measurement: %s", path)
			}
			directories[path] = info
			return nil
		}
		if len(parts) != 2 || !validDigestPrefix(parts[0]) {
			return fmt.Errorf("unexpected payload entry: %s", path)
		}
		contentID := AlgorithmSHA256 + ":" + parts[1]
		if _, err := parseContentID(contentID); err != nil || len(parts[0]) != hexPrefixLen || !strings.HasPrefix(parts[1], parts[0]) {
			return fmt.Errorf("malformed payload object path: %s", path)
		}
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("payload object is not a regular file: %s", path)
		}
		if _, duplicate := seen[contentID]; duplicate {
			return fmt.Errorf("duplicate payload object path for %s", contentID)
		}
		seen[contentID] = struct{}{}
		if _, referenced := expected[contentID]; !referenced {
			return fmt.Errorf("unreferenced payload object %s", contentID)
		}
		if after, err := os.Lstat(path); err != nil || !sameMeasuredFile(info, after) {
			return fmt.Errorf("payload object changed during measurement: %s", path)
		}
		if verified, exists := verifiedObjects[contentID]; !exists || !sameMeasuredFile(verified, info) {
			return fmt.Errorf("payload object differs from the object whose logical bytes were verified: %s", path)
		}
		stored += info.Size()
		if int64(info.Size()) < expected[contentID] {
			compression += expected[contentID] - int64(info.Size())
		}
		return nil
	})
	if err != nil {
		return SnapshotStorageReport{}, fmt.Errorf("inventory payload objects: %w", err)
	}
	for directory, before := range directories {
		after, statErr := os.Lstat(directory)
		if statErr != nil || !after.IsDir() || after.Mode()&os.ModeSymlink != 0 || !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) {
			return SnapshotStorageReport{}, fmt.Errorf("payload directory changed during measurement: %s", directory)
		}
	}
	if len(seen) != len(expected) {
		return SnapshotStorageReport{}, fmt.Errorf("payload inventory has %d objects for %d referenced identities", len(seen), len(expected))
	}

	metadata, recovery, err := measureReportRepositoryFiles(ctx, dir)
	if err != nil {
		return SnapshotStorageReport{}, err
	}
	for contentID, verified := range verifiedObjects {
		if err := ctx.Err(); err != nil {
			return SnapshotStorageReport{}, err
		}
		current, statErr := os.Lstat(blobPath(dir.root, contentID))
		if statErr != nil || !sameMeasuredFile(verified, current) {
			return SnapshotStorageReport{}, fmt.Errorf("verified payload object changed before report completion: %s", contentID)
		}
	}
	if retained < unique {
		return SnapshotStorageReport{}, errors.New("retained reference total is smaller than unique object total")
	}
	footprint := stored + metadata + recovery
	return SnapshotStorageReport{
		RetainedExactReferenceBytes:             measuredStorageBytes(retained),
		UniqueExactObjectLogicalBytes:           measuredStorageBytes(unique),
		WholeFileDuplicateReferenceSavingsBytes: StorageByteMeasure{Status: StorageMeasureMeasured, Bytes: retained - unique, Reason: "retained snapshot-reference occurrences minus unique exact identities; not ingest placement-history savings"},
		CompressionSavingsBytes:                 measuredStorageBytes(compression),
		StoredObjectFileBytes:                   measuredStorageBytes(stored),
		RepositoryMetadataFileBytes:             StorageByteMeasure{Status: StorageMeasureMeasured, Bytes: metadata, Reason: "includes repository profile and identity, repo-local retained lexical indexes, and recognized publication locks"},
		RepositoryRecoveryRecordFileBytes:       measuredStorageBytes(recovery),
		RepositoryFootprintFileBytes:            measuredStorageBytes(footprint),
	}, nil
}

func measuredStorageBytes(value int64) StorageByteMeasure {
	return StorageByteMeasure{Status: StorageMeasureMeasured, Bytes: value}
}

func sameMeasuredFile(a, b os.FileInfo) bool {
	return a != nil && b != nil && a.Mode().IsRegular() && b.Mode().IsRegular() && os.SameFile(a, b) && a.Size() == b.Size() && a.ModTime().Equal(b.ModTime())
}

func measureReportRepositoryFiles(ctx context.Context, dir *Dir) (metadata, recovery int64, err error) {
	directories := make(map[string]os.FileInfo)
	err = filepath.WalkDir(dir.root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if path == dir.root || entry.IsDir() {
			if entry.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("symlink in repository: %s", path)
			}
			info, err := os.Lstat(path)
			if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("repository directory changed during measurement: %s", path)
			}
			directories[path] = info
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in repository: %s", path)
		}
		relative, err := filepath.Rel(dir.root, path)
		if err != nil {
			return err
		}
		parts := strings.Split(relative, string(filepath.Separator))
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("repository file is not regular: %s", path)
		}
		switch {
		case len(parts) == 1 && (entry.Name() == repositoryProfileFile || entry.Name() == repositoryIdentityFile):
			metadata += info.Size()
		case isPublicationLockPath(parts):
			// Persistent lock files are included as repository metadata so the
			// reported repository footprint does not omit owned regular files.
			metadata += info.Size()
		case isPortableRecordPath(parts):
			recovery += info.Size()
		case isRepoLocalLexicalIndexPath(parts):
			// The default dispatcher keeps lexical generations in the configured
			// repository's indexes directory; include their SQLite files and
			// standard sidecars in repository metadata.
			metadata += info.Size()
		case len(parts) == 2 && parts[0] == "snapshots" && strings.HasSuffix(parts[1], ".json") && len(strings.TrimSuffix(parts[1], ".json")) > 0:
			// Legacy unsigned manifests are retained recovery records too.
			recovery += info.Size()
		case len(parts) >= 4 && parts[0] == blobDirName && parts[1] == AlgorithmSHA256:
			// Object files were inventoried and measured above.
		case parts[0] == tmpDirName:
			return fmt.Errorf("temporary repository files are present; storage report cannot classify a stable repository footprint")
		default:
			return fmt.Errorf("unaccounted repository file: %s", path)
		}
		if after, err := os.Lstat(path); err != nil || !sameMeasuredFile(info, after) {
			return fmt.Errorf("repository file changed during measurement: %s", path)
		}
		return nil
	})
	if err == nil {
		for directory, before := range directories {
			after, statErr := os.Lstat(directory)
			if statErr != nil || !after.IsDir() || !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) {
				return 0, 0, fmt.Errorf("repository directory changed during measurement: %s", directory)
			}
		}
	}
	return metadata, recovery, err
}

func isPublicationLockPath(parts []string) bool {
	if len(parts) != 3 || parts[0] != recoveryDirName || parts[1] != "locks" {
		return false
	}
	name := parts[2]
	if !strings.HasPrefix(name, "publication-") || !strings.HasSuffix(name, ".lock") {
		return false
	}
	digest := strings.TrimSuffix(strings.TrimPrefix(name, "publication-"), ".lock")
	return isLowerHexDigest(digest)
}

func isRepoLocalLexicalIndexPath(parts []string) bool {
	if len(parts) != 2 || parts[0] != "indexes" {
		return false
	}
	name := parts[1]
	for _, suffix := range []string{"-wal", "-shm"} {
		if strings.HasSuffix(name, suffix) {
			name = strings.TrimSuffix(name, suffix)
			break
		}
	}
	if !strings.HasSuffix(name, ".sqlite") {
		return false
	}
	generation := strings.TrimSuffix(name, ".sqlite")
	if !strings.HasPrefix(generation, "idx_") {
		return false
	}
	return isLowerHexString(generation[len("idx_"):]) && len(generation[len("idx_"):]) == 32
}

func isPortableRecordPath(parts []string) bool {
	if len(parts) != 5 || parts[0] != recoveryDirName || parts[3] == "" {
		return false
	}
	switch parts[1] {
	case recordRoleDir(RecordPreparedClosure), recordRoleDir(RecordPublicationCommit), recordRoleDir(RecordProcessorAttemptClosure), recordRoleDir(RecordPortableFactClosure), recordRoleDir(RecordPart):
	default:
		return false
	}
	if parts[2] != AlgorithmSHA256 || !validDigestPrefix(parts[3]) || len(parts[4]) != 64 || !strings.HasPrefix(parts[4], parts[3]) {
		return false
	}
	_, err := parseContentID(AlgorithmSHA256 + ":" + parts[4])
	return err == nil
}

func isLowerHexDigest(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

func isLowerHexString(value string) bool {
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}
