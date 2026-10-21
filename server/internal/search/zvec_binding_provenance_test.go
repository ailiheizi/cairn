//go:build purego || cairn_zvec_dynamic

package search

import (
	"os"
	"path/filepath"
	"testing"
)

func TestZvecGoBindingSourceDigestMatchesPinnedPatch(t *testing.T) {
	root := moduleRootForDependencyTest(t)
	source := filepath.Join(root, "third_party", "zvec-go")
	digest, err := zvecGoBindingSourceDigest(source)
	if err != nil {
		t.Fatal(err)
	}
	if digest != semanticInstallerZvecGoSourceDigest {
		t.Fatalf("vendored zvec-go source digest = %q, want %q", digest, semanticInstallerZvecGoSourceDigest)
	}
	if digest == "" || digest == semanticInstallerZvecGoReceiptDigest {
		t.Fatal("source provenance digest must be distinct from the packaged receipt digest")
	}
}

func TestZvecGoBindingSourceDigestRejectsMutation(t *testing.T) {
	root := moduleRootForDependencyTest(t)
	source := filepath.Join(root, "third_party", "zvec-go")
	digest, err := zvecGoBindingSourceDigest(source)
	if err != nil {
		t.Fatal(err)
	}
	if digest != semanticInstallerZvecGoSourceDigest {
		t.Fatalf("vendored zvec-go source digest = %q, want %q", digest, semanticInstallerZvecGoSourceDigest)
	}
	mutated := t.TempDir()
	if err := copyZvecBindingSourceForTest(source, mutated); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(mutated, "CAIRN-PATCH.md")
	if err := os.WriteFile(file, []byte("tampered\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	changed, err := zvecGoBindingSourceDigest(mutated)
	if err != nil {
		t.Fatal(err)
	}
	if changed == semanticInstallerZvecGoSourceDigest {
		t.Fatal("modified vendored source passed the pinned digest")
	}
}

func copyZvecBindingSourceForTest(source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		to := filepath.Join(destination, rel)
		if entry.IsDir() {
			return os.MkdirAll(to, 0o700)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(to, data, 0o600)
	})
}
