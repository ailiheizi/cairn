//go:build !darwin && !dragonfly && !freebsd && !linux && !netbsd && !openbsd && !solaris

package controlplane

// isReadOnlyFilesystemError is always false on platforms without an explicit
// read-only-filesystem errno. The probe still reports READ_ONLY when the
// operating system returns a permission error, and UNKNOWN with the underlying
// reason otherwise.
func isReadOnlyFilesystemError(error) bool { return false }
