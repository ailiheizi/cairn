package controlplane

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ailiheizi/cairn/client/command"
)

// writableProbePrefix marks the single empty file the repository writability
// probe creates and removes. The prefix keeps a leftover probe file
// recognizable and outside normal repository object naming.
const writableProbePrefix = ".cairn-writable-probe-"

// repositoryWritability is the fact reported for one zero-byte probe run.
type repositoryWritability struct {
	State     string
	Reason    string
	CheckedAt time.Time
}

// probeRepositoryWritability runs a zero-byte write probe: it creates exactly
// one empty probe file under the repository root and removes it immediately.
// No payload bytes are written and no existing object is touched. The probe
// reports READ_ONLY only for a clear permission or read-only-filesystem
// rejection; every other failure stays UNKNOWN with the underlying reason so a
// transient error is never presented as a healthy or read-only repository.
func probeRepositoryWritability(root string, now time.Time) repositoryWritability {
	probe := repositoryWritability{
		State:     command.RepositoryWritableStateUnknown,
		CheckedAt: now.UTC(),
	}
	trimmed := strings.TrimSpace(root)
	if trimmed == "" {
		probe.Reason = "repository root is not configured"
		return probe
	}
	file, err := os.CreateTemp(trimmed, writableProbePrefix+"*")
	if err != nil {
		if errors.Is(err, fs.ErrPermission) || isReadOnlyFilesystemError(err) {
			probe.State = command.RepositoryWritableStateReadOnly
			probe.Reason = err.Error()
			return probe
		}
		probe.Reason = err.Error()
		return probe
	}
	probePath := file.Name()
	closeErr := file.Close()
	removeErr := os.Remove(probePath)
	probe.State = command.RepositoryWritableStateWritable
	switch {
	case closeErr != nil:
		probe.Reason = "probe file close failed: " + closeErr.Error()
	case removeErr != nil:
		// Writability was already proven by creating the file. Keep the state
		// honest and surface the cleanup anomaly instead of hiding it.
		probe.Reason = "probe file " + filepath.Base(probePath) + " could not be removed: " + removeErr.Error()
	}
	return probe
}
