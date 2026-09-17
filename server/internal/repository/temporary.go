package repository

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// CleanStaleTemporary removes orphaned temporary placement files from a
// repository. Placement removes its own temporary file on every ordinary
// return, but a process kill runs no deferred cleanup, so a crashed exact
// placement leaves a private temp file behind. Measurement and migration treat
// that state as interrupted and fail closed, so this explicit host-owned sweep
// is the supported way to return the repository to a clean state. Placement
// code never calls it.
//
// Only regular, non-symlink files directly under <root>/tmp/ whose modification
// time is older than olderThan are removed. Every entry under tmp/ is validated
// before anything is deleted, so an unexpected entry (symlink, directory, or
// other non-regular file) fails the sweep without removing anything. Payload
// objects, portable records, the profile marker, and the repository identity
// are never considered. olderThan must be positive so an active placement is
// never swept.
func CleanStaleTemporary(ctx context.Context, root string, olderThan time.Duration) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	if olderThan <= 0 {
		return 0, errors.New("stale temporary threshold must be positive")
	}
	if strings.TrimSpace(root) == "" {
		return 0, errors.New("repository path is required")
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return 0, fmt.Errorf("resolve repository path: %w", err)
	}
	temporaryRoot := filepath.Join(absolute, tmpDirName)
	entries, err := os.ReadDir(temporaryRoot)
	if errors.Is(err, os.ErrNotExist) {
		return 0, fmt.Errorf("repository temporary directory %q is missing", temporaryRoot)
	}
	if err != nil {
		return 0, fmt.Errorf("read repository temporary directory: %w", err)
	}

	cutoff := time.Now().Add(-olderThan)
	stale := make([]string, 0, len(entries))
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		path := filepath.Join(temporaryRoot, entry.Name())
		info, err := os.Lstat(path)
		if err != nil {
			return 0, fmt.Errorf("inspect temporary entry %q: %w", entry.Name(), err)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return 0, fmt.Errorf("temporary entry %q is not a regular file", entry.Name())
		}
		if info.ModTime().Before(cutoff) {
			stale = append(stale, path)
		}
	}

	removed := 0
	for _, path := range stale {
		if err := ctx.Err(); err != nil {
			return removed, err
		}
		if err := os.Remove(path); err != nil {
			return removed, fmt.Errorf("remove stale temporary entry %q: %w", filepath.Base(path), err)
		}
		removed++
	}
	return removed, nil
}
