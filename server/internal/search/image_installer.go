package search

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

// ImageBundleArchiveMaxBytes bounds the transport archive this installer will
// read. The admitted development bundle is roughly a quarter of a gigabyte; a
// much larger archive is a mistake or an attack, not a model.
const ImageBundleArchiveMaxBytes = uint64(4 << 30)

// DefaultImageBundleDestination returns the only install location admitted for
// the image profile on this host: <models>/<profile>/<os>-<arch>.
func DefaultImageBundleDestination(modelsRoot string) (string, error) {
	modelsRoot, err := canonicalSemanticBundleInstallRoot(modelsRoot)
	if err != nil {
		return "", err
	}
	return filepath.Join(modelsRoot, ImageBundleDefaultProfileID, runtime.GOOS+"-"+runtime.GOARCH), nil
}

// ValidateDefaultImageBundleAdmission refuses an admitted bundle whose declared
// facts are not the image profile this build admits. The artifact may come from
// any conversion, but the runtime, its C API table, the tokenizer profile, and
// the profile identity itself must be the ones the loader can run, and the
// descriptor's own digests were already verified by LoadImageBundle.
func ValidateDefaultImageBundleAdmission(admission ImageBundleAdmission) error {
	descriptor := admission.Descriptor
	if strings.TrimSpace(descriptor.ProfileID) != ImageBundleDefaultProfileID {
		return fmt.Errorf("%w: profile %q is not the admitted image profile %q", ErrInvalidImageBundle, descriptor.ProfileID, ImageBundleDefaultProfileID)
	}
	if !onnxRuntime129(descriptor.RuntimeVersion) || descriptor.ONNXRuntimeCAPI != ImageBundleONNXRuntimeCAPI {
		return fmt.Errorf("%w: runtime %q with C API %d is not the admitted runtime", ErrInvalidImageBundle, descriptor.RuntimeVersion, descriptor.ONNXRuntimeCAPI)
	}
	if !strings.HasPrefix(strings.TrimSpace(descriptor.TokenizerVersion), "clip-roberta-wwm-wordpiece-v1") {
		return fmt.Errorf("%w: tokenizer profile %q is not the admitted image tokenizer", ErrInvalidImageBundle, descriptor.TokenizerVersion)
	}
	if descriptor.ImageSize <= 0 || descriptor.Dimension <= 0 {
		return fmt.Errorf("%w: image size and dimension must be positive", ErrInvalidImageBundle)
	}
	return nil
}

// InstallImageBundleFromArchive installs one image bundle archive into the
// configured models root and returns the admission it verified.
//
// The archive is transport, not identity: every declared asset is re-hashed by
// LoadImageBundle against the descriptor inside the archive, the archive may not
// carry any file the descriptor does not declare, and the declared profile facts
// must be the admitted image profile. An existing bundle at the destination is
// moved aside (never deleted) only after the replacement has been completely
// staged and admitted.
func InstallImageBundleFromArchive(ctx context.Context, modelsRoot, archivePath string) (ImageBundleAdmission, string, bool, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return ImageBundleAdmission{}, "", false, err
	}
	destination, err := DefaultImageBundleDestination(modelsRoot)
	if err != nil {
		return ImageBundleAdmission{}, "", false, err
	}
	if strings.TrimSpace(archivePath) == "" || !filepath.IsAbs(archivePath) || filepath.Clean(archivePath) != archivePath {
		return ImageBundleAdmission{}, "", false, fmt.Errorf("%w: archive path must be absolute and canonical", ErrInvalidImageBundle)
	}
	if err := validateSemanticBundlePath(filepath.Dir(archivePath), false); err != nil {
		return ImageBundleAdmission{}, "", false, fmt.Errorf("%w: archive parent: %v", ErrInvalidImageBundle, err)
	}
	info, err := os.Lstat(archivePath)
	if err != nil {
		return ImageBundleAdmission{}, "", false, fmt.Errorf("%w: archive: %v", ErrInvalidImageBundle, err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return ImageBundleAdmission{}, "", false, fmt.Errorf("%w: archive must be a regular non-symlink file", ErrInvalidImageBundle)
	}
	if info.Size() <= 0 || uint64(info.Size()) > ImageBundleArchiveMaxBytes {
		return ImageBundleAdmission{}, "", false, fmt.Errorf("%w: archive size %d is outside bounds", ErrInvalidImageBundle, info.Size())
	}
	stage, err := os.MkdirTemp("", ".cairn-image-archive-")
	if err != nil {
		return ImageBundleAdmission{}, "", false, fmt.Errorf("%w: stage archive: %v", ErrInvalidImageBundle, err)
	}
	defer os.RemoveAll(stage)
	if err := extractSemanticTarGz(archivePath, stage); err != nil {
		return ImageBundleAdmission{}, "", false, fmt.Errorf("%w: extract archive: %v", ErrInvalidImageBundle, err)
	}
	admission, err := LoadImageBundle(stage)
	if err != nil {
		return ImageBundleAdmission{}, "", false, fmt.Errorf("%w: archive admission: %v", ErrInvalidImageBundle, err)
	}
	if err := validateImageBundleArchiveContents(stage, admission); err != nil {
		return ImageBundleAdmission{}, "", false, err
	}
	if err := ValidateDefaultImageBundleAdmission(admission); err != nil {
		return ImageBundleAdmission{}, "", false, err
	}
	if err := ctx.Err(); err != nil {
		return ImageBundleAdmission{}, "", false, err
	}
	changed, err := publishImageBundle(ctx, stage, destination, admission)
	if err != nil {
		return ImageBundleAdmission{}, "", false, err
	}
	installed, err := LoadImageBundle(destination)
	if err != nil {
		return ImageBundleAdmission{}, "", false, fmt.Errorf("%w: installed bundle: %v", ErrInvalidImageBundle, err)
	}
	return installed, destination, changed, nil
}

// validateImageBundleArchiveContents refuses an archive that carries anything
// the descriptor does not declare, so a bundle can never smuggle an extra file
// into the models root.
func validateImageBundleArchiveContents(stage string, admission ImageBundleAdmission) error {
	allowed := map[string]bool{ImageBundleManifestName: true}
	for _, entry := range admission.Descriptor.assets() {
		allowed[filepath.FromSlash(entry.Asset.Path)] = true
	}
	return filepath.WalkDir(stage, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(stage, path)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		if entry.IsDir() {
			// Directories are allowed only as parents of declared assets.
			for candidate := range allowed {
				if strings.HasPrefix(candidate, relative+string(filepath.Separator)) {
					return nil
				}
			}
			return fmt.Errorf("%w: archive carries undeclared directory %q", ErrInvalidImageBundle, relative)
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("%w: archive carries a symlink %q", ErrInvalidImageBundle, relative)
		}
		if !allowed[relative] {
			return fmt.Errorf("%w: archive carries undeclared file %q", ErrInvalidImageBundle, relative)
		}
		return nil
	})
}

// publishImageBundle stages the admitted tree beside the destination and
// renames it into place. An identical existing bundle is left untouched; a
// different one is moved aside under a timestamped sibling name and is never
// deleted by this call.
func publishImageBundle(ctx context.Context, stage, destination string, admission ImageBundleAdmission) (bool, error) {
	if err := validateSemanticBundlePath(filepath.Dir(destination), true); err != nil {
		return false, fmt.Errorf("%w: bundle parent: %v", ErrInvalidImageBundle, err)
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return false, fmt.Errorf("%w: create models root: %v", ErrInvalidImageBundle, err)
	}
	if existing, err := LoadImageBundle(destination); err == nil {
		if existing.ProfileDigest == admission.ProfileDigest && sameImageAssetDigests(existing, admission) {
			return false, nil
		}
		aside := destination + ".replaced-" + time.Now().UTC().Format("20060102T150405Z")
		if err := os.Rename(destination, aside); err != nil {
			return false, fmt.Errorf("%w: move existing bundle aside: %v", ErrInvalidImageBundle, err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		if _, statErr := os.Lstat(destination); statErr == nil {
			aside := destination + ".replaced-" + time.Now().UTC().Format("20060102T150405Z")
			if err := os.Rename(destination, aside); err != nil {
				return false, fmt.Errorf("%w: move unusable bundle aside: %v", ErrInvalidImageBundle, err)
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	if err := os.Rename(stage, destination); err != nil {
		return false, fmt.Errorf("%w: publish bundle: %v", ErrInvalidImageBundle, err)
	}
	return true, nil
}

func sameImageAssetDigests(left, right ImageBundleAdmission) bool {
	if len(left.AssetDigests) != len(right.AssetDigests) {
		return false
	}
	for name, digest := range left.AssetDigests {
		if right.AssetDigests[name] != digest {
			return false
		}
	}
	return true
}

// PackageImageBundleArchive writes one deterministic tar.gz of an admitted
// bundle: the descriptor plus exactly its declared assets, in a fixed order and
// with fixed metadata, so the same bundle always produces the same archive.
func PackageImageBundleArchive(ctx context.Context, destination, sourceRoot string) (string, []byte, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	root, err := canonicalSemanticBundleRoot(sourceRoot)
	if err != nil {
		return "", nil, err
	}
	admission, err := LoadImageBundle(root)
	if err != nil {
		return "", nil, err
	}
	if strings.TrimSpace(destination) == "" || !filepath.IsAbs(destination) || filepath.Clean(destination) != destination {
		return "", nil, fmt.Errorf("%w: archive destination must be absolute and canonical", ErrInvalidImageBundle)
	}
	if _, err := os.Lstat(destination); err == nil {
		return "", nil, fmt.Errorf("%w: archive destination already exists", ErrInvalidImageBundle)
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", nil, fmt.Errorf("%w: inspect archive destination: %v", ErrInvalidImageBundle, err)
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return "", nil, fmt.Errorf("%w: create archive parent: %v", ErrInvalidImageBundle, err)
	}
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", nil, fmt.Errorf("%w: create archive: %v", ErrInvalidImageBundle, err)
	}
	defer output.Close()
	gz := gzip.NewWriter(output)
	tarWriter := tar.NewWriter(gz)
	entries := admission.Descriptor.assets()
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
	writeAsset := func(name string, payload []byte) error {
		return writeSemanticBundleArchiveBytes(tarWriter, name, payload)
	}
	manifest, err := os.ReadFile(filepath.Join(root, ImageBundleManifestName))
	if err != nil {
		return "", nil, fmt.Errorf("%w: read descriptor: %v", ErrInvalidImageBundle, err)
	}
	ordered := append([]imageBundleAssetEntry{{Name: "descriptor", Asset: ImageBundleAsset{Path: ImageBundleManifestName}}}, entries...)
	for _, entry := range ordered {
		if err := ctx.Err(); err != nil {
			return "", nil, err
		}
		var payload []byte
		if entry.Name == "descriptor" {
			payload = manifest
		} else {
			payload, err = os.ReadFile(filepath.Join(root, filepath.FromSlash(entry.Asset.Path)))
			if err != nil {
				return "", nil, fmt.Errorf("%w: read asset %s: %v", ErrInvalidImageBundle, entry.Name, err)
			}
		}
		if err := writeAsset(entry.Asset.Path, payload); err != nil {
			return "", nil, fmt.Errorf("%w: write asset %s: %v", ErrInvalidImageBundle, entry.Name, err)
		}
	}
	if err := tarWriter.Close(); err != nil {
		return "", nil, err
	}
	if err := gz.Close(); err != nil {
		return "", nil, err
	}
	if err := output.Sync(); err != nil {
		return "", nil, err
	}
	archive, err := os.ReadFile(destination)
	if err != nil {
		return "", nil, err
	}
	return destination, archive, nil
}
