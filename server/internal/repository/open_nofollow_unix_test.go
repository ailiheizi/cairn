//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd

package repository

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestOpenRepositoryFileClosesNestedDirectoryDescriptors(t *testing.T) {
	root := t.TempDir()
	objectPath := filepath.Join(root, "blobs", "sha256", "aa", "object")
	if err := os.MkdirAll(filepath.Dir(objectPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(objectPath, []byte("nested repository object"), 0o600); err != nil {
		t.Fatal(err)
	}

	countDescriptors := func() int {
		var limit unix.Rlimit
		if err := unix.Getrlimit(unix.RLIMIT_NOFILE, &limit); err != nil {
			t.Skipf("cannot inspect process descriptor limit: %v", err)
		}
		max := limit.Cur
		if max > 1<<16 {
			max = 1 << 16
		}
		count := 0
		for fd := uintptr(0); fd < uintptr(max); fd++ {
			if _, err := unix.FcntlInt(fd, unix.F_GETFD, 0); err == nil {
				count++
			}
		}
		return count
	}
	before := countDescriptors()
	for i := 0; i < 64; i++ {
		file, err := openRepositoryFile(root, objectPath)
		if err != nil {
			t.Fatalf("open nested repository object %d: %v", i, err)
		}
		if err := file.Close(); err != nil {
			t.Fatalf("close nested repository object %d: %v", i, err)
		}
	}
	after := countDescriptors()
	if leaked := after - before; leaked > 1 {
		t.Fatalf("nested repository reads leaked %d file descriptors (before=%d after=%d)", leaked, before, after)
	}
}
