//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package controlplane

import (
	"errors"

	"golang.org/x/sys/unix"
)

// isReadOnlyFilesystemError reports whether err is EROFS. Directory permission
// bits can look writable while the mounted filesystem is read-only, so the
// zero-byte probe classifies that rejection explicitly instead of calling the
// repository UNKNOWN.
func isReadOnlyFilesystemError(err error) bool {
	return errors.Is(err, unix.EROFS)
}
