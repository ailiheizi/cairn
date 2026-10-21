package search

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// ImageBundleDescriptor is the offline admission record for one operator-
// installed image embedding model. It describes artifacts; it does not load a
// runtime, execute a model, or imply provider readiness. The model identity is
// deliberately configurable: swapping the model is a new descriptor (and
// therefore a new space fingerprint and a new generation), never a silent
// reinterpretation of existing vectors.
type ImageBundleDescriptor struct {
	Schema    string `json:"schema"`
	ProfileID string `json:"profile_id"`

	PlatformOS   string `json:"platform_os"`
	PlatformArch string `json:"platform_arch"`

	// RuntimeVersion must be an ONNX Runtime 1.29.x build, matching the pinned
	// text bundle so both towers can share one pinned runtime environment.
	RuntimeVersion  string `json:"runtime_version"`
	RuntimeBuild    string `json:"runtime_build"`
	ONNXRuntimeCAPI int    `json:"onnx_runtime_c_api"`
	ONNXOpset       int    `json:"onnx_opset"`

	ModelID           string `json:"model_id"`
	ModelRevision     string `json:"model_revision"`
	ModelExport       string `json:"model_export"`
	ModelLicenseID    string `json:"model_license_id"`
	TokenizerVersion  string `json:"tokenizer_version"`
	LicenseExpression string `json:"license_expression"`

	// Declared space fingerprint facts. They are recorded verbatim in the
	// generation manifest and its canonical digest.
	ModelVersion     string `json:"model_version"`
	ImageInput       string `json:"image_input"`
	TextInput        string `json:"text_input"`
	QueryInstruction string `json:"query_instruction"`
	Pooling          string `json:"pooling"`
	Normalization    string `json:"normalization"`

	// Declared vector and preprocessing facts.
	PreprocessingDigest string `json:"preprocessing_digest"`
	ElementType         string `json:"element_type"`
	Dimension           int    `json:"dimension"`
	VectorSchema        string `json:"vector_schema"`
	Distance            string `json:"distance"`
	IndexConfig         string `json:"index_config"`
	QueryConfig         string `json:"query_config"`
	ImageSize           int    `json:"image_size"`
	MaxTokens           int    `json:"max_tokens"`

	Runtime   ImageBundleAsset `json:"runtime"`
	Vision    ImageBundleAsset `json:"vision"`
	Text      ImageBundleAsset `json:"text"`
	Tokenizer ImageBundleAsset `json:"tokenizer"`
	License   ImageBundleAsset `json:"license"`
	Notice    ImageBundleAsset `json:"notice"`
	SBOM      ImageBundleAsset `json:"sbom"`
}

// ImageBundleAsset identifies one immutable, locally retained bundle file.
type ImageBundleAsset struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   uint64 `json:"size"`
}

const (
	ImageBundleSchemaV1 = "cairn.image-bundle.v1"
	// ImageBundleManifestName is the only descriptor filename accepted by
	// LoadImageBundle. A caller still supplies the already-resolved bundle root;
	// no current-directory or network lookup is performed.
	ImageBundleManifestName = "image-bundle.json"
	// ImageBundleMaxAssetBytes bounds admission even when a malformed
	// descriptor points at a sparse or device-backed file.
	ImageBundleMaxAssetBytes    = uint64(4 << 30)
	ImageBundleMaxManifestBytes = uint64(1 << 20)
	// ImageBundleDefaultProfileID is the shortlist default model identity from
	// the local model research: Chinese-CLIP ViT-B/16 (512 dimensions,
	// Chinese-native text tower). Actual model/export licenses and provenance
	// are bound in each installed descriptor; a code license is not a weight license.
	ImageBundleDefaultProfileID = "chinese-clip-vit-base-patch16"
	ImageBundleDefaultModelID   = "OFA-Sys/chinese-clip-vit-base-patch16"
	// ImageBundleONNXRuntimeCAPI matches the pinned text bundle's C API table.
	ImageBundleONNXRuntimeCAPI = 29
)

var (
	ErrInvalidImageBundle = errors.New("invalid image bundle")
	ErrImageBundleAsset   = errors.New("invalid image bundle asset")
)

type imageBundleAssetEntry struct {
	Name  string
	Asset ImageBundleAsset
}

func (d ImageBundleDescriptor) assets() []imageBundleAssetEntry {
	return []imageBundleAssetEntry{
		{Name: "runtime", Asset: d.Runtime},
		{Name: "vision", Asset: d.Vision},
		{Name: "text", Asset: d.Text},
		{Name: "tokenizer", Asset: d.Tokenizer},
		{Name: "license", Asset: d.License},
		{Name: "notice", Asset: d.Notice},
		{Name: "sbom", Asset: d.SBOM},
	}
}

// Fingerprint returns the declared space identity of this descriptor.
func (d ImageBundleDescriptor) Fingerprint() ImageSpaceFingerprint {
	return ImageSpaceFingerprint{
		Schema:           ImageSpaceFingerprintSchemaV1,
		ModelID:          d.ModelID,
		ModelVersion:     d.ModelVersion,
		Dimension:        d.Dimension,
		ImageInput:       d.ImageInput,
		TextInput:        d.TextInput,
		QueryInstruction: d.QueryInstruction,
		Pooling:          d.Pooling,
		Normalization:    d.Normalization,
	}
}

// ProviderDigest is the immutable provider identity recorded in the
// generation manifest. It is derived from the admitted descriptor and asset
// digests, so a changed artifact or profile fact always changes it.
func (d ImageBundleDescriptor) ProviderDigest() string {
	canonical := struct {
		Descriptor ImageBundleDescriptor `json:"descriptor"`
	}{d}
	payload, _ := json.Marshal(canonical)
	digest := sha256.Sum256(append([]byte("cairn.image-provider.v1\n"), payload...))
	return "sha256:" + hex.EncodeToString(digest[:])
}

func (d ImageBundleDescriptor) validateFacts() error {
	if d.Schema != ImageBundleSchemaV1 {
		return fmt.Errorf("%w: schema must be %q", ErrInvalidImageBundle, ImageBundleSchemaV1)
	}
	if strings.TrimSpace(d.ProfileID) == "" || strings.TrimSpace(d.ProfileID) != d.ProfileID {
		return fmt.Errorf("%w: profile_id is required", ErrInvalidImageBundle)
	}
	if strings.TrimSpace(d.PlatformOS) != runtime.GOOS || strings.TrimSpace(d.PlatformArch) != runtime.GOARCH {
		return fmt.Errorf("%w: platform %q/%q does not match host %q/%q", ErrInvalidImageBundle, d.PlatformOS, d.PlatformArch, runtime.GOOS, runtime.GOARCH)
	}
	if !onnxRuntime129(d.RuntimeVersion) || strings.TrimSpace(d.RuntimeBuild) == "" {
		return fmt.Errorf("%w: ONNX Runtime version must be 1.29.x with a recorded build", ErrInvalidImageBundle)
	}
	if d.ONNXRuntimeCAPI != ImageBundleONNXRuntimeCAPI {
		return fmt.Errorf("%w: runtime C API must be %d", ErrInvalidImageBundle, ImageBundleONNXRuntimeCAPI)
	}
	if d.ONNXOpset <= 0 {
		return fmt.Errorf("%w: ONNX opset is required", ErrInvalidImageBundle)
	}
	if strings.TrimSpace(d.ModelID) == "" || strings.TrimSpace(d.ModelRevision) == "" || strings.TrimSpace(d.ModelExport) == "" {
		return fmt.Errorf("%w: model id, revision, and export identity are required", ErrInvalidImageBundle)
	}
	if strings.TrimSpace(d.ModelVersion) == "" {
		return fmt.Errorf("%w: model_version (the declared space version) is required", ErrInvalidImageBundle)
	}
	if strings.TrimSpace(d.ModelLicenseID) == "" || strings.TrimSpace(d.LicenseExpression) == "" {
		return fmt.Errorf("%w: model license identity and license expression are required", ErrInvalidImageBundle)
	}
	if strings.TrimSpace(d.TokenizerVersion) == "" {
		return fmt.Errorf("%w: tokenizer version is required", ErrInvalidImageBundle)
	}
	if validateSHA256(strings.TrimPrefix(strings.TrimSpace(d.PreprocessingDigest), "sha256:")) != nil {
		return fmt.Errorf("%w: preprocessing digest must be a sha256 value", ErrInvalidImageBundle)
	}
	if d.Dimension <= 0 || d.Dimension > 4096 {
		return fmt.Errorf("%w: dimension %d is outside the admitted range", ErrInvalidImageBundle, d.Dimension)
	}
	if d.ImageSize <= 0 || d.ImageSize > 1024 || d.MaxTokens < 3 || d.MaxTokens > 512 {
		return fmt.Errorf("%w: image size and token budget are outside the admitted range", ErrInvalidImageBundle)
	}
	if d.ElementType != "float32" || d.VectorSchema != fmt.Sprintf("float32:%d", d.Dimension) ||
		d.Distance != "cosine" || strings.TrimSpace(d.IndexConfig) == "" || strings.TrimSpace(d.QueryConfig) == "" {
		return fmt.Errorf("%w: incomplete vector or index profile", ErrInvalidImageBundle)
	}
	if err := d.Fingerprint().Validate(); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidImageBundle, err)
	}
	seen := make(map[string]string, len(d.assets()))
	for _, entry := range d.assets() {
		if err := validateSemanticBundleAssetPath(entry.Asset.Path); err != nil {
			return fmt.Errorf("%w: asset %s: %v", ErrInvalidImageBundle, entry.Name, err)
		}
		if err := validateSHA256(entry.Asset.SHA256); err != nil {
			return fmt.Errorf("%w: asset %s digest: %v", ErrInvalidImageBundle, entry.Name, err)
		}
		if previous, ok := seen[entry.Asset.Path]; ok {
			return fmt.Errorf("%w: assets %s and %s reuse path %q", ErrInvalidImageBundle, previous, entry.Name, entry.Asset.Path)
		}
		seen[entry.Asset.Path] = entry.Name
		if entry.Asset.Size == 0 || entry.Asset.Size > ImageBundleMaxAssetBytes {
			return fmt.Errorf("%w: asset %s has invalid declared size %d", ErrInvalidImageBundle, entry.Name, entry.Asset.Size)
		}
	}
	return nil
}

// ImageBundleAdmission is the deterministic result of offline validation. It
// is intentionally not a readiness or health result. Root is the explicit
// installed directory that was admitted; a consumer reopens assets only under
// this recorded root and can never silently re-bind to another directory.
type ImageBundleAdmission struct {
	Root          string                `json:"root"`
	Descriptor    ImageBundleDescriptor `json:"descriptor"`
	ProfileDigest string                `json:"profile_digest"`
	AssetDigests  map[string]string     `json:"asset_digests"`
}

func (a ImageBundleAdmission) validate() error {
	if err := a.Descriptor.validateFacts(); err != nil {
		return err
	}
	root, err := canonicalSemanticBundleRoot(a.Root)
	if err != nil || root != a.Root {
		return fmt.Errorf("%w: admission root must be an absolute canonical path", ErrInvalidImageBundle)
	}
	entries := a.Descriptor.assets()
	if len(a.AssetDigests) != len(entries) {
		return fmt.Errorf("%w: admission asset digest set is incomplete", ErrInvalidImageBundle)
	}
	for _, entry := range entries {
		if a.AssetDigests[entry.Name] != entry.Asset.SHA256 {
			return fmt.Errorf("%w: admission digest for %s does not match descriptor", ErrInvalidImageBundle, entry.Name)
		}
	}
	want, err := imageBundleProfileDigest(a.Descriptor, a.AssetDigests)
	if err != nil {
		return err
	}
	if a.ProfileDigest != want {
		return fmt.Errorf("%w: admission profile digest does not match descriptor", ErrInvalidImageBundle)
	}
	return nil
}

// Validate rechecks the complete content-addressed admission. Callers that
// receive an admission through a process boundary must not trust only its
// profile ID or digest string.
func (a ImageBundleAdmission) Validate() error { return a.validate() }

// Fingerprint returns the admitted space identity.
func (a ImageBundleAdmission) Fingerprint() ImageSpaceFingerprint {
	return a.Descriptor.Fingerprint()
}

// ProviderDigest returns the admitted provider identity.
func (a ImageBundleAdmission) ProviderDigest() string { return a.Descriptor.ProviderDigest() }

// EmbeddingGenerationManifest returns the complete output-affecting binding
// for this admitted image bundle. ConfigDigest is supplied by the host and is
// never inferred from the bundle. This creates a generation identity; it does
// not load or health-check any runtime or index.
func (a ImageBundleAdmission) EmbeddingGenerationManifest(configDigest string) (EmbeddingGenerationManifest, error) {
	if strings.TrimSpace(configDigest) == "" {
		return EmbeddingGenerationManifest{}, fmt.Errorf("%w: admission and config digest are required", ErrInvalidImageBundle)
	}
	if err := a.validate(); err != nil {
		return EmbeddingGenerationManifest{}, err
	}
	fingerprint := a.Fingerprint()
	manifest := EmbeddingGenerationManifest{
		RuntimeDigest:       "sha256:" + a.AssetDigests["runtime"],
		ModelDigest:         "sha256:" + a.AssetDigests["vision"] + "+sha256:" + a.AssetDigests["text"],
		TokenizerDigest:     "sha256:" + a.AssetDigests["tokenizer"],
		PreprocessingDigest: a.Descriptor.PreprocessingDigest,
		Pooling:             fingerprint.Pooling,
		Normalization:       fingerprint.Normalization,
		ElementType:         a.Descriptor.ElementType,
		Dimension:           fingerprint.Dimension,
		VectorSchema:        a.Descriptor.VectorSchema,
		SemanticSpace:       fingerprint.CanonicalDigest(),
		Distance:            a.Descriptor.Distance,
		IndexConfig:         a.Descriptor.IndexConfig,
		QueryConfig:         a.Descriptor.QueryConfig,
		ProviderDigest:      a.ProviderDigest(),
		ConfigDigest:        configDigest,
	}
	if err := ValidateImageGenerationManifest(manifest, fingerprint); err != nil {
		return EmbeddingGenerationManifest{}, err
	}
	return manifest, nil
}

// imageBundleProfileDigest is the immutable admission identity of one
// installed image bundle.
func imageBundleProfileDigest(descriptor ImageBundleDescriptor, digests map[string]string) (string, error) {
	canonical := struct {
		Descriptor ImageBundleDescriptor `json:"descriptor"`
		Assets     map[string]string     `json:"assets"`
	}{descriptor, digests}
	payload, err := json.Marshal(canonical)
	if err != nil {
		return "", fmt.Errorf("%w: canonical descriptor: %v", ErrInvalidImageBundle, err)
	}
	digest := sha256.Sum256(append([]byte("cairn.image-bundle.v1\n"), payload...))
	return "sha256:" + hex.EncodeToString(digest[:]), nil
}

func openImageBundleAsset(root string, entry imageBundleAssetEntry) (*os.File, error) {
	if err := validateSemanticBundleAssetPath(entry.Asset.Path); err != nil {
		return nil, fmt.Errorf("%w %s: %v", ErrImageBundleAsset, entry.Name, err)
	}
	path := filepath.FromSlash(entry.Asset.Path)
	if err := validateSHA256(entry.Asset.SHA256); err != nil {
		return nil, fmt.Errorf("%w %s: %v", ErrImageBundleAsset, entry.Name, err)
	}
	rootAbs, err := canonicalSemanticBundleRoot(root)
	if err != nil {
		return nil, err
	}
	rootInfo, err := os.Lstat(rootAbs)
	if err != nil {
		return nil, fmt.Errorf("bundle root: %w", err)
	}
	if rootInfo.Mode()&os.ModeSymlink != 0 || !rootInfo.IsDir() {
		return nil, fmt.Errorf("bundle root must be a real directory")
	}
	final := filepath.Join(rootAbs, path)
	current := rootAbs
	for _, part := range strings.Split(path, string(filepath.Separator)) {
		current = filepath.Join(current, part)
		info, statErr := os.Lstat(current)
		if statErr != nil {
			return nil, fmt.Errorf("%s %s: %w", entry.Name, entry.Asset.Path, statErr)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("%w %s: symlink is not allowed", ErrImageBundleAsset, entry.Name)
		}
		if current != final && !info.IsDir() && current != rootAbs {
			return nil, fmt.Errorf("%w %s: path component is not a directory", ErrImageBundleAsset, entry.Name)
		}
	}
	info, err := os.Lstat(final)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", entry.Name, err)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("%w %s: asset must be a regular file", ErrImageBundleAsset, entry.Name)
	}
	f, err := openBundleFileNoFollow(rootAbs, path)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", entry.Name, err)
	}
	opened, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("%s: stat: %w", entry.Name, err)
	}
	if !opened.Mode().IsRegular() {
		_ = f.Close()
		return nil, fmt.Errorf("%w %s: asset is not a regular file", ErrImageBundleAsset, entry.Name)
	}
	if opened.Size() < 0 || uint64(opened.Size()) != entry.Asset.Size {
		_ = f.Close()
		return nil, fmt.Errorf("%w %s: size %d does not match declared %d", ErrImageBundleAsset, entry.Name, opened.Size(), entry.Asset.Size)
	}
	return f, nil
}

func hashImageBundleAsset(root string, entry imageBundleAssetEntry) (string, error) {
	f, err := openImageBundleAsset(root, entry)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	readBytes, err := io.Copy(h, io.LimitReader(f, int64(entry.Asset.Size)+1))
	if err != nil {
		return "", fmt.Errorf("%s: read: %w", entry.Name, err)
	}
	if readBytes != int64(entry.Asset.Size) {
		return "", fmt.Errorf("%w %s: read %d bytes, want %d", ErrImageBundleAsset, entry.Name, readBytes, entry.Asset.Size)
	}
	got := hex.EncodeToString(h.Sum(nil))
	if got != entry.Asset.SHA256 {
		return "", fmt.Errorf("%w %s: digest %s does not match declared %s", ErrImageBundleAsset, entry.Name, got, entry.Asset.SHA256)
	}
	return got, nil
}

// AdmitImageBundle validates all required local assets and returns their
// content digests plus a profile digest. It performs no runtime loading or
// network operation.
func AdmitImageBundle(root string, descriptor ImageBundleDescriptor) (ImageBundleAdmission, error) {
	if err := descriptor.validateFacts(); err != nil {
		return ImageBundleAdmission{}, err
	}
	root, err := canonicalSemanticBundleRoot(root)
	if err != nil {
		return ImageBundleAdmission{}, err
	}
	digests := make(map[string]string, len(descriptor.assets()))
	for _, entry := range descriptor.assets() {
		got, err := hashImageBundleAsset(root, entry)
		if err != nil {
			return ImageBundleAdmission{}, err
		}
		digests[entry.Name] = got
	}
	profileDigest, err := imageBundleProfileDigest(descriptor, digests)
	if err != nil {
		return ImageBundleAdmission{}, err
	}
	return ImageBundleAdmission{Root: root, Descriptor: descriptor, ProfileDigest: profileDigest, AssetDigests: digests}, nil
}

// LoadImageBundle reads the fixed descriptor from an installed bundle root and
// admits it. JSON is strict and bounded so unknown fields cannot silently
// change the profile meaning.
func LoadImageBundle(root string) (ImageBundleAdmission, error) {
	root, err := canonicalSemanticBundleRoot(root)
	if err != nil {
		return ImageBundleAdmission{}, err
	}
	file, err := openBundleFileNoFollow(root, ImageBundleManifestName)
	if err != nil {
		return ImageBundleAdmission{}, fmt.Errorf("%w: open descriptor: %v", ErrInvalidImageBundle, err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return ImageBundleAdmission{}, fmt.Errorf("%w: stat descriptor: %v", ErrInvalidImageBundle, err)
	}
	if info.Size() <= 0 || uint64(info.Size()) > ImageBundleMaxManifestBytes {
		return ImageBundleAdmission{}, fmt.Errorf("%w: descriptor size %d is outside bounds", ErrInvalidImageBundle, info.Size())
	}
	decoder := json.NewDecoder(io.LimitReader(file, int64(ImageBundleMaxManifestBytes)+1))
	decoder.DisallowUnknownFields()
	var descriptor ImageBundleDescriptor
	if err := decoder.Decode(&descriptor); err != nil {
		return ImageBundleAdmission{}, fmt.Errorf("%w: decode descriptor: %v", ErrInvalidImageBundle, err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return ImageBundleAdmission{}, fmt.Errorf("%w: descriptor contains more than one JSON value", ErrInvalidImageBundle)
		}
		return ImageBundleAdmission{}, fmt.Errorf("%w: read descriptor: %v", ErrInvalidImageBundle, err)
	}
	return AdmitImageBundle(root, descriptor)
}

// ReadImageBundleAsset reopens one admitted asset through the same no-follow
// path and verifies its size and digest before returning bytes. The runtime
// and tokenizer consumers use these bytes rather than reopening a previously
// checked mutable path.
func ReadImageBundleAsset(ctx context.Context, root string, admission ImageBundleAdmission, name string) ([]byte, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := admission.validate(); err != nil {
		return nil, err
	}
	var entry imageBundleAssetEntry
	found := false
	for _, candidate := range admission.Descriptor.assets() {
		if candidate.Name == name {
			entry = candidate
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("%w: unknown asset %q", ErrImageBundleAsset, name)
	}
	if admission.AssetDigests[name] != entry.Asset.SHA256 {
		return nil, fmt.Errorf("%w %s: admitted digest does not match descriptor", ErrImageBundleAsset, name)
	}
	maxInt := uint64(^uint(0) >> 1)
	if entry.Asset.Size > maxInt {
		return nil, fmt.Errorf("%w %s: asset is too large for this platform", ErrImageBundleAsset, name)
	}
	f, err := openImageBundleAsset(root, entry)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	payload := make([]byte, int(entry.Asset.Size))
	reader := &semanticBundleContextReader{ctx: ctx, reader: f}
	if _, err := io.ReadFull(reader, payload); err != nil {
		return nil, fmt.Errorf("%s: read: %w", name, err)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	digest := sha256.Sum256(payload)
	if got := hex.EncodeToString(digest[:]); got != entry.Asset.SHA256 {
		return nil, fmt.Errorf("%w %s: digest %s does not match declared %s", ErrImageBundleAsset, name, got, entry.Asset.SHA256)
	}
	return payload, nil
}
