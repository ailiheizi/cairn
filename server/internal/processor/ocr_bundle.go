package processor

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// OCRBundleSchemaV1 identifies the operator-installed OCR bundle manifest.
// The bundle is the OCR counterpart of the pinned local semantic bundle: it
// names one engine profile and pins every output-affecting artifact (ONNX
// Runtime, detection model, recognition model, dictionary) by digest. Nothing
// is downloaded automatically, and no ad hoc config key may partially override
// the profile.
const OCRBundleSchemaV1 = "cairn.ocr-bundle.v1"

// OCRBundleManifestName is the fixed manifest file name inside a bundle root.
const OCRBundleManifestName = "manifest.json"

// OCRProfileID is the named admitted OCR profile. It is the directory name
// below the configured paths.models root, mirroring the semantic bundle
// convention <paths.models>/<profile>/<goos-goarch>.
const OCRProfileID = "rapidocr-ppocr-mobile-v1"

// Fixed bundle bounds. They reuse the ONNX asset ceilings that the package
// already enforces for the semantic worker so a second, weaker budget class
// does not appear.
const (
	ocrMaxDictionaryBytes = int64(maxONNXTokenizerAssetBytes)
	ocrMaxAssetBytes      = int64(maxONNXModelAssetBytes)
	ocrMaxRuntimeBytes    = int64(maxONNXRuntimeAssetBytes)
)

var (
	// ErrOCRBundleNotBuilt means no usable OCR bundle is installed. It is a
	// capability state, not a failure: exact preservation is unaffected.
	ErrOCRBundleNotBuilt = errors.New("OCR model bundle is not built")
	// ErrOCRBundleUnavailable means a bundle exists but cannot be admitted.
	ErrOCRBundleUnavailable = errors.New("OCR model bundle is unavailable")
)

// OCRBundleAsset is one digest-pinned file inside a bundle root. Path is
// always bundle-relative; an absolute or escaping path is rejected.
type OCRBundleAsset struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
}

// OCRBundleManifest is the immutable OCR profile declaration. It is written by
// the operator (or an offline installer) and is never synthesized at runtime.
type OCRBundleManifest struct {
	Schema    string `json:"schema"`
	ProfileID string `json:"profile_id"`

	PlatformOS   string `json:"platform_os"`
	PlatformArch string `json:"platform_arch"`

	EngineID      string `json:"engine_id"`
	EngineVersion string `json:"engine_version"`
	EngineBuild   string `json:"engine_build"`
	EngineSource  string `json:"engine_source"`
	EngineLicense string `json:"engine_license"`

	ModelID        string `json:"model_id"`
	ModelRevision  string `json:"model_revision"`
	ModelLicenseID string `json:"model_license_id"`

	// Stages declares the pipeline stages this bundle provides. Only DET and
	// REC are implemented; a manifest that declares anything else is rejected
	// rather than silently running a partial pipeline.
	Stages []string `json:"stages"`

	// Languages is the declared coverage of the installed models and
	// dictionary. It is reported verbatim in the artifact; the processor never
	// infers or upgrades it.
	Languages     []string `json:"languages"`
	LanguageNotes string   `json:"language_notes"`

	DictionaryFormat string `json:"dictionary_format"`

	ONNXRuntimeVersion string `json:"onnx_runtime_version"`
	ONNXRuntimeBuild   string `json:"onnx_runtime_build"`
	ONNXRuntimeCAPI    int    `json:"onnx_runtime_c_api"`

	// PreprocessingDigest pins the preprocessing profile (resize policy,
	// normalization constants, tensor layout, postprocess thresholds that are
	// not separately listed). It is recorded in the artifact so a change is a
	// new output generation.
	PreprocessingDigest string `json:"preprocessing_digest"`

	DetLimitSide    int     `json:"det_limit_side"`
	DetThreshold    float64 `json:"det_threshold"`
	DetBoxThreshold float64 `json:"det_box_threshold"`
	DetUnclipRatio  float64 `json:"det_unclip_ratio"`
	DetMinBoxSize   int     `json:"det_min_box_size"`
	RecImageHeight  int     `json:"rec_image_height"`
	RecImageWidth   int     `json:"rec_image_width"`
	// RecMinConfidence marks a region as low confidence. It never rewrites or
	// hides the recognized text.
	RecMinConfidence float64 `json:"rec_min_confidence"`

	Runtime     OCRBundleAsset `json:"runtime"`
	Detection   OCRBundleAsset `json:"det"`
	Recognition OCRBundleAsset `json:"rec"`
	Dictionary  OCRBundleAsset `json:"dictionary"`
	License     OCRBundleAsset `json:"license"`
}

// OCRBundleAdmission is the verified bundle: declared digests were recomputed
// from the installed bytes, so the files on disk are the declared files.
type OCRBundleAdmission struct {
	Manifest      OCRBundleManifest
	ProfileDigest string
	AssetDigests  map[string]string
	AssetBytes    map[string][]byte
}

// OCRBundleState is the operator-facing capability statement for the OCR
// profile. READY, NOT_BUILT, and UNAVAILABLE are the same vocabulary the
// discovery-index status uses; a missing bundle is never folded into READY.
type OCRBundleState struct {
	State         string
	Reason        string
	BundleRoot    string
	ProfileDigest string
	EngineID      string
	Languages     []string
	License       string
}

// OCRBundleRoot is the single deterministic bundle location for the current
// platform below the configured paths.models root. Callers never invent a
// second location.
func OCRBundleRoot(modelsRoot string) string {
	root := strings.TrimSpace(modelsRoot)
	if root == "" {
		return ""
	}
	return filepath.Join(root, OCRProfileID, runtime.GOOS+"-"+runtime.GOARCH)
}

// InspectOCRBundle reports the honest capability state without loading native
// code. It is safe to call for status and capability surfaces.
func InspectOCRBundle(bundleRoot string) OCRBundleState {
	root := strings.TrimSpace(bundleRoot)
	state := OCRBundleState{State: "NOT_BUILT", BundleRoot: root}
	if root == "" {
		state.Reason = "paths.models is not configured for this process, so no OCR bundle root can be resolved"
		return state
	}
	admission, err := LoadOCRBundle(root)
	if err != nil {
		if errors.Is(err, ErrOCRBundleNotBuilt) {
			state.Reason = err.Error()
			return state
		}
		state.State = "UNAVAILABLE"
		state.Reason = err.Error()
		return state
	}
	state.State = "READY"
	state.ProfileDigest = admission.ProfileDigest
	state.EngineID = admission.Manifest.EngineID
	state.Languages = append([]string(nil), admission.Manifest.Languages...)
	state.License = admission.Manifest.EngineLicense
	state.Reason = "operator-installed OCR bundle is installed and locally verified; text recognition runs in-process and never blocks exact preservation"
	return state
}

// LoadOCRBundle verifies one bundle root against its manifest. Every declared
// asset is re-read and re-hashed; a declared digest that does not match the
// installed bytes is a hard error, so a tampered or partially copied bundle
// cannot be reported as installed.
func LoadOCRBundle(bundleRoot string) (OCRBundleAdmission, error) {
	root := strings.TrimSpace(bundleRoot)
	if root == "" {
		return OCRBundleAdmission{}, fmt.Errorf("%w: bundle root is empty", ErrOCRBundleNotBuilt)
	}
	manifestPath := filepath.Join(root, OCRBundleManifestName)
	info, err := os.Lstat(manifestPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return OCRBundleAdmission{}, fmt.Errorf("%w: no %s at %s; install the pinned OCR det+rec ONNX models, dictionary, ONNX Runtime, and manifest.json there",
				ErrOCRBundleNotBuilt, OCRBundleManifestName, root)
		}
		return OCRBundleAdmission{}, fmt.Errorf("%w: inspect %s: %v", ErrOCRBundleUnavailable, manifestPath, err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return OCRBundleAdmission{}, fmt.Errorf("%w: %s must be a regular file", ErrOCRBundleUnavailable, manifestPath)
	}
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		return OCRBundleAdmission{}, fmt.Errorf("%w: read %s: %v", ErrOCRBundleUnavailable, manifestPath, err)
	}
	manifest, err := decodeOCRBundleManifest(raw)
	if err != nil {
		return OCRBundleAdmission{}, fmt.Errorf("%w: %s: %v", ErrOCRBundleUnavailable, manifestPath, err)
	}
	if err := validateOCRBundleManifest(manifest); err != nil {
		return OCRBundleAdmission{}, fmt.Errorf("%w: %s: %v", ErrOCRBundleUnavailable, manifestPath, err)
	}
	admission := OCRBundleAdmission{
		Manifest:     manifest,
		AssetDigests: map[string]string{},
		AssetBytes:   map[string][]byte{},
	}
	assets := []struct {
		name  string
		asset OCRBundleAsset
		max   int64
	}{
		{"runtime", manifest.Runtime, ocrMaxRuntimeBytes},
		{"det", manifest.Detection, ocrMaxAssetBytes},
		{"rec", manifest.Recognition, ocrMaxAssetBytes},
		{"dictionary", manifest.Dictionary, ocrMaxDictionaryBytes},
		{"license", manifest.License, ocrMaxDictionaryBytes},
	}
	for _, item := range assets {
		body, digest, readErr := readOCRBundleAsset(root, item.name, item.asset, item.max)
		if readErr != nil {
			return OCRBundleAdmission{}, readErr
		}
		admission.AssetDigests[item.name] = digest
		if item.name == "license" {
			continue
		}
		admission.AssetBytes[item.name] = body
	}
	profileDigest, err := ocrBundleProfileDigest(manifest, admission.AssetDigests)
	if err != nil {
		return OCRBundleAdmission{}, fmt.Errorf("%w: compute profile digest: %v", ErrOCRBundleUnavailable, err)
	}
	admission.ProfileDigest = profileDigest
	return admission, nil
}

func decodeOCRBundleManifest(raw []byte) (OCRBundleManifest, error) {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	var manifest OCRBundleManifest
	if err := decoder.Decode(&manifest); err != nil {
		return OCRBundleManifest{}, fmt.Errorf("decode manifest: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return OCRBundleManifest{}, errors.New("manifest has trailing content")
	}
	return manifest, nil
}

func validateOCRBundleManifest(manifest OCRBundleManifest) error {
	switch {
	case manifest.Schema != OCRBundleSchemaV1:
		return fmt.Errorf("schema %q is not %q", manifest.Schema, OCRBundleSchemaV1)
	case manifest.ProfileID != OCRProfileID:
		return fmt.Errorf("profile_id %q is not the admitted profile %q", manifest.ProfileID, OCRProfileID)
	case manifest.PlatformOS != runtime.GOOS || manifest.PlatformArch != runtime.GOARCH:
		return fmt.Errorf("bundle targets %s-%s, this host is %s-%s", manifest.PlatformOS, manifest.PlatformArch, runtime.GOOS, runtime.GOARCH)
	case strings.TrimSpace(manifest.EngineID) == "" || strings.TrimSpace(manifest.EngineVersion) == "":
		return errors.New("engine_id and engine_version are required")
	case strings.TrimSpace(manifest.EngineSource) == "" || strings.TrimSpace(manifest.EngineLicense) == "":
		return errors.New("engine_source and engine_license are required")
	case strings.TrimSpace(manifest.ModelID) == "" || strings.TrimSpace(manifest.ModelLicenseID) == "":
		return errors.New("model_id and model_license_id are required")
	case len(manifest.Languages) == 0:
		return errors.New("languages must declare the installed coverage")
	case strings.TrimSpace(manifest.ONNXRuntimeVersion) == "":
		return errors.New("onnx_runtime_version is required")
	case manifest.ONNXRuntimeCAPI != onnxRuntimeGoBindingCAPI:
		return fmt.Errorf("onnx_runtime_c_api must be %d (Go binding C API)", onnxRuntimeGoBindingCAPI)
	case strings.TrimSpace(manifest.PreprocessingDigest) == "":
		return errors.New("preprocessing_digest is required")
	case manifest.DetLimitSide < 32 || manifest.DetLimitSide > 4096:
		return fmt.Errorf("det_limit_side %d is outside 32..4096", manifest.DetLimitSide)
	case manifest.DetThreshold <= 0 || manifest.DetThreshold >= 1:
		return fmt.Errorf("det_threshold %v must be strictly between 0 and 1", manifest.DetThreshold)
	case manifest.DetBoxThreshold <= 0 || manifest.DetBoxThreshold > 1:
		return fmt.Errorf("det_box_threshold %v must be in (0,1]", manifest.DetBoxThreshold)
	case manifest.DetUnclipRatio < 0 || manifest.DetUnclipRatio > 5:
		return fmt.Errorf("det_unclip_ratio %v is outside 0..5", manifest.DetUnclipRatio)
	case manifest.DetMinBoxSize < 1 || manifest.DetMinBoxSize > 256:
		return fmt.Errorf("det_min_box_size %d is outside 1..256", manifest.DetMinBoxSize)
	case manifest.RecImageHeight < 8 || manifest.RecImageHeight > 256:
		return fmt.Errorf("rec_image_height %d is outside 8..256", manifest.RecImageHeight)
	case manifest.RecImageWidth < 16 || manifest.RecImageWidth > 4096:
		return fmt.Errorf("rec_image_width %d is outside 16..4096", manifest.RecImageWidth)
	case manifest.RecMinConfidence <= 0 || manifest.RecMinConfidence >= 1:
		return fmt.Errorf("rec_min_confidence %v must be strictly between 0 and 1", manifest.RecMinConfidence)
	case strings.TrimSpace(manifest.DictionaryFormat) == "":
		return errors.New("dictionary_format is required")
	}
	stages := map[string]bool{}
	for _, stage := range manifest.Stages {
		switch strings.ToUpper(strings.TrimSpace(stage)) {
		case "DET", "REC":
			stages[strings.ToUpper(strings.TrimSpace(stage))] = true
		default:
			return fmt.Errorf("stage %q is not implemented by this engine profile (only DET and REC run)", stage)
		}
	}
	if !stages["DET"] || !stages["REC"] {
		return errors.New("stages must declare DET and REC")
	}
	return nil
}

// readOCRBundleAsset reads one declared asset with a no-follow check, a fixed
// size ceiling, and a digest recomputation. Declared byte length and declared
// SHA-256 must both match the installed file.
func readOCRBundleAsset(root, name string, asset OCRBundleAsset, maxBytes int64) ([]byte, string, error) {
	relative := strings.TrimSpace(asset.Path)
	if relative == "" {
		return nil, "", fmt.Errorf("%w: %s asset has no path", ErrOCRBundleUnavailable, name)
	}
	if filepath.IsAbs(relative) || relative != filepath.Clean(relative) || strings.HasPrefix(relative, "..") {
		return nil, "", fmt.Errorf("%w: %s asset path %q must be a clean bundle-relative path", ErrOCRBundleUnavailable, name, relative)
	}
	path := filepath.Join(root, relative)
	info, err := os.Lstat(path)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %s asset %s: %v", ErrOCRBundleUnavailable, name, path, err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, "", fmt.Errorf("%w: %s asset %s must be a regular file", ErrOCRBundleUnavailable, name, path)
	}
	if info.Size() <= 0 || info.Size() > maxBytes {
		return nil, "", fmt.Errorf("%w: %s asset %s is %d bytes, outside 1..%d", ErrOCRBundleUnavailable, name, path, info.Size(), maxBytes)
	}
	if asset.Bytes != info.Size() {
		return nil, "", fmt.Errorf("%w: %s asset %s is %d bytes, manifest declares %d", ErrOCRBundleUnavailable, name, path, info.Size(), asset.Bytes)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, "", fmt.Errorf("%w: read %s asset: %v", ErrOCRBundleUnavailable, name, err)
	}
	sum := sha256.Sum256(body)
	digest := "sha256:" + hex.EncodeToString(sum[:])
	declared := strings.TrimSpace(asset.SHA256)
	if !strings.HasPrefix(declared, "sha256:") {
		declared = "sha256:" + declared
	}
	if declared != digest {
		return nil, "", fmt.Errorf("%w: %s asset %s digest %s does not match declared %s", ErrOCRBundleUnavailable, name, path, digest, declared)
	}
	return body, digest, nil
}

func ocrBundleProfileDigest(manifest OCRBundleManifest, digests map[string]string) (string, error) {
	names := make([]string, 0, len(digests))
	for name := range digests {
		names = append(names, name)
	}
	sort.Strings(names)
	ordered := make([]string, 0, len(names))
	for _, name := range names {
		ordered = append(ordered, name+"="+digests[name])
	}
	payload, err := json.Marshal(struct {
		Schema string            `json:"schema"`
		Bundle OCRBundleManifest `json:"bundle"`
		Assets []string          `json:"assets"`
	}{Schema: OCRBundleSchemaV1, Bundle: manifest, Assets: ordered})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

// ocrDictionary splits one PP-OCR dictionary file into indexed characters.
// The blank token is index 0 and is prepended here, so recognition output
// indices are dictionary indices shifted by one.
func ocrDictionary(body []byte) []string {
	text := strings.ReplaceAll(string(body), "\r\n", "\n")
	lines := strings.Split(text, "\n")
	entries := make([]string, 0, len(lines)+1)
	entries = append(entries, "")
	for _, line := range lines {
		line = strings.TrimRight(line, "\r")
		if line == "" {
			continue
		}
		entries = append(entries, line)
	}
	return entries
}
