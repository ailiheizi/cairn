package search

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// imageInstallerFixtureBundle builds a tiny but fully admitted image bundle so
// the installer can be exercised without a real model: the loader validates
// schema, facts, and digests, not tensor shapes, so a handful of bytes per asset
// is enough to prove the transport path.
func imageInstallerFixtureBundle(t *testing.T, root string) ImageBundleAdmission {
	t.Helper()
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatalf("create bundle root: %v", err)
	}
	write := func(name string, payload string) ImageBundleAsset {
		if err := os.WriteFile(filepath.Join(root, name), []byte(payload), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
		digest, err := fileSHA256(filepath.Join(root, name))
		if err != nil {
			t.Fatalf("digest %s: %v", name, err)
		}
		return ImageBundleAsset{Path: name, SHA256: digest, Size: uint64(len(payload))}
	}
	descriptor := ImageBundleDescriptor{
		Schema: ImageBundleSchemaV1, ProfileID: ImageBundleDefaultProfileID,
		PlatformOS: runtime.GOOS, PlatformArch: runtime.GOARCH,
		RuntimeVersion: "1.29.0", RuntimeBuild: "onnxruntime-cpu-" + runtime.GOOS + "-" + runtime.GOARCH + "-1.29.0",
		ONNXRuntimeCAPI: ImageBundleONNXRuntimeCAPI, ONNXOpset: 14,
		ModelID: "fixture/model", ModelRevision: "fixture-revision", ModelExport: "fixture-export",
		ModelLicenseID: "MIT", LicenseExpression: "MIT",
		TokenizerVersion: "clip-roberta-wwm-wordpiece-v1+lowercase",
		ModelVersion:     "fixture-version", ImageInput: "pixel_values", TextInput: "input_ids+attention_mask",
		Pooling: "graph-projected-embedding", Normalization: "l2",
		PreprocessingDigest: "sha256:" + repeatedHex("a1", 32),
		ElementType:         "float32",
		Dimension:           512,
		VectorSchema:        "float32:512",
		Distance:            "cosine",
		IndexConfig:         "hnsw:m=16",
		QueryConfig:         "ef=64",
		ImageSize:           224,
		MaxTokens:           52,
	}
	descriptor.Runtime = write("runtime.bin", "runtime")
	descriptor.Vision = write("vision.onnx", "vision")
	descriptor.Text = write("text.onnx", "text")
	descriptor.Tokenizer = write("tokenizer.json", "tokenizer")
	descriptor.License = write("LICENSE", "license")
	descriptor.Notice = write("NOTICE", "notice")
	descriptor.SBOM = write("sbom.json", "sbom")
	payload, err := jsonMarshalIndent(descriptor)
	if err != nil {
		t.Fatalf("marshal descriptor: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, ImageBundleManifestName), payload, 0o600); err != nil {
		t.Fatalf("write descriptor: %v", err)
	}
	admission, err := LoadImageBundle(root)
	if err != nil {
		t.Fatalf("admit fixture bundle: %v", err)
	}
	return admission
}

func TestImageBundleArchiveRoundTripIsIdempotentAndRefusesExtras(t *testing.T) {
	ctx := context.Background()
	work := t.TempDir()
	source := filepath.Join(work, "source")
	imageInstallerFixtureBundle(t, source)
	archive := filepath.Join(work, "bundle.tar.gz")
	if _, _, err := PackageImageBundleArchive(ctx, archive, source); err != nil {
		t.Fatalf("package archive: %v", err)
	}
	modelsRoot := filepath.Join(work, "models")
	if err := os.MkdirAll(modelsRoot, 0o700); err != nil {
		t.Fatalf("create models root: %v", err)
	}
	installed, _, _, err := InstallImageBundleFromArchive(ctx, modelsRoot, archive)
	if err != nil {
		t.Fatalf("install from archive: %v", err)
	}
	destination, err := DefaultImageBundleDestination(modelsRoot)
	if err != nil {
		t.Fatalf("destination: %v", err)
	}
	if installed.Root != destination {
		t.Fatalf("installed root %q, want %q", installed.Root, destination)
	}
	// Idempotent: a second install of the same archive leaves the same bundle and
	// does not create a replaced-aside sibling.
	if _, _, _, err := InstallImageBundleFromArchive(ctx, modelsRoot, archive); err != nil {
		t.Fatalf("re-install: %v", err)
	}
	entries, err := os.ReadDir(filepath.Dir(destination))
	if err != nil {
		t.Fatalf("read models root: %v", err)
	}
	for _, entry := range entries {
		if entry.Name() != filepath.Base(destination) {
			t.Fatalf("unexpected sibling %q after an idempotent install", entry.Name())
		}
	}
	// An archive that carries a file the descriptor does not declare is refused.
	// Packaging walks declared assets only, so this archive is built by hand: the
	// check under test is the installer's contents validation, not the packager's.
	smuggled := filepath.Join(work, "smuggled.tar.gz")
	writeArchiveWithExtraFile(t, source, smuggled, "smuggled.bin")
	if _, _, _, err := InstallImageBundleFromArchive(ctx, modelsRoot, smuggled); err == nil {
		t.Fatal("an archive carrying an undeclared file must be refused")
	}
	// A non-image profile is refused before anything is published.
	other := filepath.Join(work, "other-profile")
	admission := imageInstallerFixtureBundle(t, other)
	descriptor := admission.Descriptor
	descriptor.ProfileID = "some-other-profile"
	payload, err := jsonMarshalIndent(descriptor)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(filepath.Join(other, ImageBundleManifestName), payload, 0o600); err != nil {
		t.Fatalf("rewrite descriptor: %v", err)
	}
	changed, err := LoadImageBundle(other)
	if err != nil {
		t.Fatalf("a self-consistent bundle still loads; the profile guard is separate: %v", err)
	}
	if err := ValidateDefaultImageBundleAdmission(changed); err == nil {
		t.Fatal("a bundle whose profile is not the admitted image profile must be refused by the installer guard")
	}
	// The runtime guard is separate too: a bundle claiming another ONNX Runtime
	// must be refused even when every asset digest is consistent.
	changed.Descriptor.RuntimeVersion = "1.20.0"
	if err := ValidateDefaultImageBundleAdmission(changed); err == nil {
		t.Fatal("a bundle claiming a non-admitted runtime must be refused")
	}
}

// Local helpers keep the fixture self-contained; the package owns no test-wide
// file-digest or JSON helper today.
func fileSHA256(path string) (string, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func repeatedHex(pair string, count int) string {
	return strings.Repeat(pair, count)
}

func jsonMarshalIndent(value any) ([]byte, error) {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(payload, '\n'), nil
}

// writeArchiveWithExtraFile builds a tar.gz of the bundle plus one undeclared
// file, which is what a hand-crafted or tampered archive would look like.
func writeArchiveWithExtraFile(t *testing.T, sourceRoot, destination, extraName string) {
	t.Helper()
	output, err := os.Create(destination)
	if err != nil {
		t.Fatalf("create archive: %v", err)
	}
	defer output.Close()
	gz := gzip.NewWriter(output)
	writer := tar.NewWriter(gz)
	entries, err := os.ReadDir(sourceRoot)
	if err != nil {
		t.Fatalf("read bundle: %v", err)
	}
	write := func(name string, payload []byte) {
		if err := writer.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: int64(len(payload)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatalf("write header %s: %v", name, err)
		}
		if _, err := writer.Write(payload); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		payload, err := os.ReadFile(filepath.Join(sourceRoot, entry.Name()))
		if err != nil {
			t.Fatalf("read %s: %v", entry.Name(), err)
		}
		write(entry.Name(), payload)
	}
	write(extraName, []byte("undeclared"))
	if err := writer.Close(); err != nil {
		t.Fatalf("close tar: %v", err)
	}
	if err := gz.Close(); err != nil {
		t.Fatalf("close gzip: %v", err)
	}
}

// TestImageBundleArchiveRoundTripsTheInstalledBundle exercises the transport
// path against the real, operator-installed image bundle. It is opt-in because
// it needs that artifact: set CAIRN_IMAGE_BUNDLE to the bundle root.
func TestImageBundleArchiveRoundTripsTheInstalledBundle(t *testing.T) {
	root := strings.TrimSpace(os.Getenv("CAIRN_IMAGE_BUNDLE"))
	if root == "" {
		t.Skip("CAIRN_IMAGE_BUNDLE is not set")
	}
	ctx := context.Background()
	source, err := LoadImageBundle(root)
	if err != nil {
		t.Fatalf("admit the installed bundle: %v", err)
	}
	work := t.TempDir()
	archive := filepath.Join(work, "installed.tar.gz")
	if _, size, err := PackageImageBundleArchive(ctx, archive, root); err != nil {
		t.Fatalf("package the installed bundle: %v", err)
	} else if len(size) == 0 {
		t.Fatal("packaged archive is empty")
	}
	modelsRoot := filepath.Join(work, "models")
	if err := os.MkdirAll(modelsRoot, 0o700); err != nil {
		t.Fatalf("create models root: %v", err)
	}
	installed, _, _, err := InstallImageBundleFromArchive(ctx, modelsRoot, archive)
	if err != nil {
		t.Fatalf("install the packaged bundle: %v", err)
	}
	if installed.ProfileDigest != source.ProfileDigest {
		t.Fatalf("installed profile digest %s, want %s", installed.ProfileDigest, source.ProfileDigest)
	}
	for name, digest := range source.AssetDigests {
		if installed.AssetDigests[name] != digest {
			t.Fatalf("installed asset %s digest %s, want %s", name, installed.AssetDigests[name], digest)
		}
	}
	t.Logf("round-tripped %d assets, profile %s", len(installed.AssetDigests), installed.ProfileDigest)
}
