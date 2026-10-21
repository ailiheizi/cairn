package controlplane

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ailiheizi/cairn/client/command"
	cairnconfig "github.com/ailiheizi/cairn/config"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
)

const storageReportBasis = "AUTHENTICATED_RETAINED_SNAPSHOT_FILE_REFERENCES"

func (d *Dispatcher) buildStorageReport(ctx context.Context) *command.StorageReport {
	report := &command.StorageReport{
		Status:                             "PARTIAL",
		Basis:                              storageReportBasis,
		ConfigDigest:                       d.configDigest,
		ConfiguredRecoveryRecordsFileBytes: unknownMeasure("UNMEASURED", "effective configured recovery-record path is unavailable"),
		TemporaryFileBytes:                 unknownMeasure("UNMEASURED", "temporary and active staging files are transient and are not inventoried"),
		RetainedSourceBytes:                unknownMeasure("UNMEASURED", "source trees remain operator-managed and are not scanned or measured by this report"),
		ModelFileBytes:                     unknownMeasure("UNMEASURED", "the active model tree is not available as one verified, disjoint path"),
		NetSavingsBytes:                    unknownMeasure("UNMEASURED", "net savings require complete deployment, source, and temporary-file accounting"),
	}
	if d.exact == nil || d.exact.Repo == nil {
		return makeStorageReportUnavailable(report, "exact repository is not attached")
	}
	signedPublicationConfigured := d.exact.RequireSignedPublication || d.exact.SigningIdentity != nil || d.exact.TrustAnchor != nil
	if !signedPublicationConfigured || d.exact.TrustAnchor == nil || strings.TrimSpace(d.exact.PublicationDomain) == "" {
		return makeStorageReportUnavailable(report, "authenticated signed snapshot publications require an independent trust anchor and publication domain")
	}
	profile := repository.DescribeProfile(d.exact.Repo)
	report.RepositoryProfile = profile.Repository
	report.CompressionProfile = profile.Compression
	manifests, err := d.exact.ListSnapshots(ctx)
	if err != nil {
		return makeStorageReportUnavailable(report, "authenticate retained snapshots: "+err.Error())
	}
	snapshotCount := len(manifests)
	report.SnapshotCount = &snapshotCount
	refs := make([]repository.SnapshotFileReference, 0)
	for _, manifest := range manifests {
		for _, entry := range manifest.Entries {
			if entry.EntryType != "REGULAR_FILE" || entry.Protection.LocalRepresentationID == "" {
				continue
			}
			if entry.Protection.Mode != "STORE_EXACT" && entry.Protection.Mode != "STORE_EXACT_WITH_EXTERNAL_FALLBACK" {
				return makeStorageReportUnavailable(report, "authenticated local representation has unsupported protection mode")
			}
			if entry.Protection.Outcome != "EXACT_PROTECTED" && entry.Protection.Outcome != "EXACT_FALLBACK" {
				return makeStorageReportUnavailable(report, "authenticated local representation has unsupported protection outcome")
			}
			if entry.Protection.ExpectedContentID == "" || entry.Protection.ExpectedLogicalLength == nil || entry.ContentID != entry.Protection.ExpectedContentID {
				return makeStorageReportUnavailable(report, "authenticated local representation is missing consistent exact identity evidence")
			}
			refs = append(refs, repository.SnapshotFileReference{
				ContentID: entry.Protection.ExpectedContentID,
				Bytes:     *entry.Protection.ExpectedLogicalLength,
			})
		}
	}
	repoReport, err := repository.MeasureSnapshotStorage(ctx, d.exact.Repo, refs)
	if err != nil {
		markSnapshotMeasuresUnavailable(report, err.Error())
	} else {
		report.RetainedExactReferenceBytes = toCommandMeasure(repoReport.RetainedExactReferenceBytes)
		report.UniqueExactObjectLogicalBytes = toCommandMeasure(repoReport.UniqueExactObjectLogicalBytes)
		report.WholeFileDuplicateReferenceSavingsBytes = toCommandMeasure(repoReport.WholeFileDuplicateReferenceSavingsBytes)
		report.CompressionSavingsBytes = toCommandMeasure(repoReport.CompressionSavingsBytes)
		report.StoredObjectFileBytes = toCommandMeasure(repoReport.StoredObjectFileBytes)
		report.RepositoryMetadataFileBytes = toCommandMeasure(repoReport.RepositoryMetadataFileBytes)
		report.RepositoryRecoveryRecordFileBytes = toCommandMeasure(repoReport.RepositoryRecoveryRecordFileBytes)
		report.RepositoryFootprintFileBytes = toCommandMeasure(repoReport.RepositoryFootprintFileBytes)
	}
	if report.CatalogFileBytes, err = measureCatalogFiles(ctx, d.catalogPath, d.exact.Repo.Root(), d.vectorPath); err != nil {
		report.CatalogFileBytes = unknownMeasure("UNMEASURED", err.Error())
	}
	if strings.TrimSpace(d.vectorPath) == "" {
		report.VectorIndexFileBytes = unknownMeasure("UNMEASURED", "no configured vector-index path is available")
	} else if bytes, err := measurePathTree(ctx, d.vectorPath); err != nil {
		report.VectorIndexFileBytes = unknownMeasure("UNMEASURED", err.Error())
	} else if overlap, err := pathsOverlap(d.vectorPath, d.catalogPath, d.exact.Repo.Root()); err != nil || overlap {
		reason := "vector index overlaps another measured storage category"
		if err != nil {
			reason = err.Error()
		}
		report.VectorIndexFileBytes = unknownMeasure("UNMEASURED", reason)
	} else {
		report.VectorIndexFileBytes = measuredMeasure(bytes)
	}
	d.measureConfiguredStoragePaths(ctx, report)
	if err := retainedSnapshotSetUnchanged(ctx, d.exact, manifests); err != nil {
		report.SnapshotCount = nil
		report.Reason = "retained snapshot set changed during measurement: " + err.Error()
		markSnapshotMeasuresUnavailable(report, report.Reason)
	}
	if measuresPartial(report) {
		report.Status = "PARTIAL"
	} else {
		report.Status = "MEASURED"
	}
	return report
}

func retainedSnapshotSetUnchanged(ctx context.Context, service *exact.Service, manifests []exact.Manifest) error {
	identities, err := service.ListSnapshotIdentities(ctx)
	if err != nil {
		return err
	}
	if len(identities) != len(manifests) {
		return fmt.Errorf("snapshot count changed from %d to %d", len(manifests), len(identities))
	}
	seen := make(map[string]string, len(manifests))
	for _, manifest := range manifests {
		seen[manifest.SnapshotRef] = manifest.ManifestDigest
	}
	for _, identity := range identities {
		digest, ok := seen[identity.SnapshotRef]
		if !ok || digest != identity.ManifestDigest {
			return fmt.Errorf("snapshot identity changed for %s", identity.SnapshotRef)
		}
		delete(seen, identity.SnapshotRef)
	}
	if len(seen) != 0 {
		return fmt.Errorf("snapshot identity set changed")
	}
	return nil
}

func makeStorageReportUnavailable(report *command.StorageReport, reason string) *command.StorageReport {
	report.Status = "UNAVAILABLE"
	report.Reason = reason
	markSnapshotMeasuresUnavailable(report, reason)
	report.CatalogFileBytes = unknownMeasure("UNMEASURED", reason)
	report.VectorIndexFileBytes = unknownMeasure("UNMEASURED", reason)
	report.ModelFileBytes = unknownMeasure("UNMEASURED", reason)
	report.ConfiguredRecoveryRecordsFileBytes = unknownMeasure("UNMEASURED", reason)
	return report
}

func markSnapshotMeasuresUnavailable(report *command.StorageReport, reason string) {
	report.RetainedExactReferenceBytes = unknownMeasure("UNAVAILABLE", reason)
	report.UniqueExactObjectLogicalBytes = unknownMeasure("UNAVAILABLE", reason)
	report.WholeFileDuplicateReferenceSavingsBytes = unknownMeasure("UNAVAILABLE", reason)
	report.CompressionSavingsBytes = unknownMeasure("UNAVAILABLE", reason)
	report.StoredObjectFileBytes = unknownMeasure("UNAVAILABLE", reason)
	report.RepositoryMetadataFileBytes = unknownMeasure("UNAVAILABLE", reason)
	report.RepositoryRecoveryRecordFileBytes = unknownMeasure("UNAVAILABLE", reason)
	report.RepositoryFootprintFileBytes = unknownMeasure("UNAVAILABLE", reason)
}

func unknownMeasure(status, reason string) command.StorageByteMeasure {
	return command.StorageByteMeasure{Status: status, Reason: reason}
}

func measuredMeasure(value int64) command.StorageByteMeasure {
	return command.StorageByteMeasure{Status: "MEASURED", Bytes: &value}
}

func toCommandMeasure(value repository.StorageByteMeasure) command.StorageByteMeasure {
	if value.Status != repository.StorageMeasureMeasured {
		return unknownMeasure(value.Status, value.Reason)
	}
	measure := measuredMeasure(value.Bytes)
	measure.Reason = value.Reason
	return measure
}

func measuresPartial(report *command.StorageReport) bool {
	for _, measure := range []command.StorageByteMeasure{
		report.RetainedExactReferenceBytes, report.UniqueExactObjectLogicalBytes,
		report.WholeFileDuplicateReferenceSavingsBytes, report.CompressionSavingsBytes,
		report.StoredObjectFileBytes, report.RepositoryMetadataFileBytes,
		report.RepositoryRecoveryRecordFileBytes, report.CatalogFileBytes,
		report.VectorIndexFileBytes, report.ModelFileBytes, report.TemporaryFileBytes,
		report.ConfiguredRecoveryRecordsFileBytes, report.RetainedSourceBytes,
		report.RepositoryFootprintFileBytes, report.NetSavingsBytes,
	} {
		if measure.Status != "MEASURED" {
			return true
		}
	}
	return false
}

func (d *Dispatcher) measureConfiguredStoragePaths(ctx context.Context, report *command.StorageReport) {
	if d.operatorConfig == nil {
		report.ModelFileBytes = unknownMeasure("UNMEASURED", "effective model path is unavailable")
		return
	}
	configData, err := d.operatorConfig.load()
	if err != nil {
		report.ModelFileBytes = unknownMeasure("UNMEASURED", "load effective storage paths: "+err.Error())
		report.ConfiguredRecoveryRecordsFileBytes = unknownMeasure("UNMEASURED", "load effective storage paths: "+err.Error())
		return
	}
	if d.configDigest == "" || configData.ConfigDigest != configData.RunningConfigDigest || configData.RunningConfigDigest != d.configDigest {
		reason := "persisted paths differ from the running configuration"
		if d.configDigest == "" {
			reason = "running config digest is unavailable, so effective paths cannot be bound to this report"
		}
		report.ModelFileBytes = unknownMeasure("UNMEASURED", reason)
		report.ConfiguredRecoveryRecordsFileBytes = unknownMeasure("UNMEASURED", reason)
		return
	}
	var cfg cairnconfig.Config
	if err := json.Unmarshal(configData.Config, &cfg); err != nil {
		report.ModelFileBytes = unknownMeasure("UNMEASURED", "decode effective storage paths: "+err.Error())
		report.ConfiguredRecoveryRecordsFileBytes = unknownMeasure("UNMEASURED", "decode effective storage paths: "+err.Error())
		return
	}
	report.ConfigDigest = configData.RunningConfigDigest
	measurePath := func(path, label string, peerPaths ...string) command.StorageByteMeasure {
		if strings.TrimSpace(path) == "" {
			return unknownMeasure("UNMEASURED", label+" path is unavailable")
		}
		if _, err := os.Lstat(path); err != nil {
			return unknownMeasure("UNMEASURED", label+" path cannot be measured: "+err.Error())
		}
		if reason := storagePathOverlapReason(path, append([]string{d.exact.Repo.Root(), d.catalogPath, d.vectorPath}, peerPaths...)...); reason != "" {
			return unknownMeasure("UNMEASURED", label+" path separation is unknown: "+reason)
		}
		bytes, err := measurePathTree(ctx, path)
		if err != nil {
			return unknownMeasure("UNMEASURED", label+" path measurement failed: "+err.Error())
		}
		return measuredMeasure(bytes)
	}
	report.ModelFileBytes = measurePath(cfg.Paths.Models, "model tree", cfg.Paths.RecoveryRecords)
	report.ConfiguredRecoveryRecordsFileBytes = measurePath(cfg.Paths.RecoveryRecords, "configured recovery-record", cfg.Paths.Models)
}

func storagePathOverlapReason(path string, peers ...string) string {
	overlap, err := pathsOverlap(append([]string{path}, peers...)...)
	if err != nil {
		return err.Error()
	}
	if overlap {
		return "path overlaps another measured storage category"
	}
	return ""
}

func measureCatalogFiles(ctx context.Context, catalogPath, repositoryRoot, vectorPath string) (command.StorageByteMeasure, error) {
	if strings.TrimSpace(catalogPath) == "" {
		return unknownMeasure("UNMEASURED", "catalog path is unavailable"), nil
	}
	overlap, err := pathsOverlap(catalogPath, repositoryRoot, vectorPath)
	if err != nil {
		return command.StorageByteMeasure{}, err
	}
	if overlap {
		return command.StorageByteMeasure{}, fmt.Errorf("catalog path overlaps another storage category")
	}
	paths := []string{catalogPath, catalogPath + "-wal", catalogPath + "-shm"}
	scan := func() (map[string]os.FileInfo, error) {
		files := make(map[string]os.FileInfo, len(paths))
		for i, path := range paths {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			info, err := os.Lstat(path)
			if os.IsNotExist(err) {
				if i == 0 {
					return nil, fmt.Errorf("catalog file is absent: %s", catalogPath)
				}
				continue
			}
			if err != nil {
				return nil, err
			}
			if !info.Mode().IsRegular() {
				return nil, fmt.Errorf("catalog component is not a regular file: %s", path)
			}
			files[path] = info
		}
		return files, nil
	}
	before, err := scan()
	if err != nil {
		return command.StorageByteMeasure{}, err
	}
	after, err := scan()
	if err != nil {
		return command.StorageByteMeasure{}, err
	}
	if len(before) != len(after) {
		return command.StorageByteMeasure{}, fmt.Errorf("catalog sidecars changed during measurement")
	}
	var total int64
	for path, info := range before {
		current, ok := after[path]
		if !ok || !stableFileInfo(info, current) {
			return command.StorageByteMeasure{}, fmt.Errorf("catalog component changed during measurement: %s", path)
		}
		total += info.Size()
	}
	return measuredMeasure(total), nil
}

func measurePathTree(ctx context.Context, path string) (int64, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return 0, err
	}
	rootInfo, err := os.Lstat(absolute)
	if err != nil {
		return 0, err
	}
	if rootInfo.Mode()&os.ModeSymlink != 0 {
		return 0, fmt.Errorf("storage path is a symlink: %s", absolute)
	}
	if rootInfo.Mode().IsRegular() {
		after, err := os.Lstat(absolute)
		if err != nil || !stableFileInfo(rootInfo, after) {
			return 0, fmt.Errorf("storage file changed during measurement: %s", absolute)
		}
		return rootInfo.Size(), nil
	}
	if !rootInfo.IsDir() {
		return 0, fmt.Errorf("storage path is not a regular file or directory: %s", absolute)
	}
	var total int64
	directories := make(map[string]os.FileInfo)
	err = filepath.WalkDir(absolute, func(current string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in storage path: %s", current)
		}
		if entry.IsDir() {
			info, err := os.Lstat(current)
			if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("storage directory changed during measurement: %s", current)
			}
			directories[current] = info
			return nil
		}
		info, err := os.Lstat(current)
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("non-regular storage entry: %s", current)
		}
		after, err := os.Lstat(current)
		if err != nil || !stableFileInfo(info, after) {
			return fmt.Errorf("storage entry changed during measurement: %s", current)
		}
		total += info.Size()
		return nil
	})
	if err == nil {
		for directory, before := range directories {
			after, statErr := os.Lstat(directory)
			if statErr != nil || !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) {
				return 0, fmt.Errorf("storage directory changed during measurement: %s", directory)
			}
		}
	}
	return total, err
}

func stableFileInfo(before, after os.FileInfo) bool {
	return before != nil && after != nil && before.Mode().IsRegular() && after.Mode().IsRegular() && os.SameFile(before, after) && before.Size() == after.Size() && before.ModTime().Equal(after.ModTime())
}

func pathsOverlap(paths ...string) (bool, error) {
	resolved := make([]string, 0, len(paths))
	for _, path := range paths {
		if strings.TrimSpace(path) == "" {
			continue
		}
		absolute, err := filepath.Abs(path)
		if err != nil {
			return false, err
		}
		canonical, err := canonicalPathAllowMissing(absolute)
		if err != nil {
			return false, err
		}
		resolved = append(resolved, filepath.Clean(canonical))
	}
	for i := range resolved {
		for j := i + 1; j < len(resolved); j++ {
			a, b := resolved[i], resolved[j]
			relAB, errAB := filepath.Rel(a, b)
			relBA, errBA := filepath.Rel(b, a)
			if errAB != nil || errBA != nil {
				return false, fmt.Errorf("cannot establish storage path separation")
			}
			if relAB == "." || relBA == "." || relAB != ".." && !strings.HasPrefix(relAB, ".."+string(filepath.Separator)) || relBA != ".." && !strings.HasPrefix(relBA, ".."+string(filepath.Separator)) {
				return true, nil
			}
		}
	}
	return false, nil
}

func canonicalPathAllowMissing(absolute string) (string, error) {
	current := filepath.Clean(absolute)
	var suffix []string
	for {
		canonical, err := filepath.EvalSymlinks(current)
		if err == nil {
			for i := len(suffix) - 1; i >= 0; i-- {
				canonical = filepath.Join(canonical, suffix[i])
			}
			return filepath.Clean(canonical), nil
		}
		if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", err
		}
		suffix = append(suffix, filepath.Base(current))
		current = parent
	}
}
