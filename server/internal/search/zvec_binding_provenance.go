package search

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	semanticInstallerZvecGoSourceDigest = "sha256:15f6c7c021f4e5be1232c072e381c1c7c109e5b9d428857899bcb1f91fb338be"
	semanticInstallerZvecGoReplacePath  = "./third_party/zvec-go"
	semanticInstallerZvecGoBuildTag     = "cairn_zvec_dynamic"
	zvecGoBindingSourceDomain           = "cairn.zvec-go-source.v1\n"
)

// zvecGoBindingSourceDigest is a build/test-time provenance check for the
// complete in-repository upstream source copy. It is never used by runtime
// admission and never causes application code to read source paths.
func zvecGoBindingSourceDigest(root string) (string, error) {
	if strings.TrimSpace(root) == "" || !filepath.IsAbs(root) {
		return "", errors.New("zvec-go source root must be an absolute path")
	}
	root = filepath.Clean(root)
	rootInfo, err := os.Lstat(root)
	if err != nil {
		return "", err
	}
	if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("zvec-go source root must be a real directory")
	}
	var files []string
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("zvec-go source contains symlink %q", path)
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("zvec-go source contains non-regular file %q", path)
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files = append(files, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return "", err
	}
	sort.Strings(files)
	h := sha256.New()
	_, _ = io.WriteString(h, zvecGoBindingSourceDomain)
	for _, rel := range files {
		path := filepath.Join(root, filepath.FromSlash(rel))
		file, err := os.Open(path)
		if err != nil {
			return "", err
		}
		info, statErr := file.Stat()
		if statErr != nil {
			_ = file.Close()
			return "", statErr
		}
		if !info.Mode().IsRegular() || info.Size() < 0 {
			_ = file.Close()
			return "", fmt.Errorf("zvec-go source changed type at %q", rel)
		}
		fileDigest := sha256.New()
		if _, err := io.Copy(fileDigest, file); err != nil {
			_ = file.Close()
			return "", err
		}
		if err := file.Close(); err != nil {
			return "", err
		}
		_, _ = io.WriteString(h, rel)
		_, _ = h.Write([]byte{0})
		fileSum := fileDigest.Sum(nil)
		_, _ = h.Write([]byte(hex.EncodeToString(fileSum)))
		_, _ = h.Write([]byte{'\n'})
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil)), nil
}
