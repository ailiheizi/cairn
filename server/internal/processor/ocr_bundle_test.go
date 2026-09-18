package processor

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// ocrTestBundleFiles are the installed bytes of a synthetic bundle. They are
// never loaded by native code here; they exist so admission logic can be
// exercised without shipping or downloading a model.
func ocrTestBundleFiles() map[string][]byte {
	return map[string][]byte{
		"runtime.bin": []byte("synthetic onnx runtime placeholder"),
		"det.onnx":    []byte("synthetic det placeholder"),
		"rec.onnx":    []byte("synthetic rec placeholder"),
		"dict.txt":    []byte("a\nb\nc\n中\n"),
		"LICENSE":     []byte("Apache-2.0 placeholder"),
	}
}

func ocrTestAsset(body []byte) OCRBundleAsset {
	sum := sha256.Sum256(body)
	return OCRBundleAsset{SHA256: "sha256:" + hex.EncodeToString(sum[:]), Bytes: int64(len(body))}
}

func writeOCRTestBundle(t *testing.T, dir string, mutate func(*OCRBundleManifest)) string {
	t.Helper()
	files := ocrTestBundleFiles()
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), body, 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	manifest := OCRBundleManifest{
		Schema: OCRBundleSchemaV1, ProfileID: OCRProfileID,
		PlatformOS: runtime.GOOS, PlatformArch: runtime.GOARCH,
		EngineID: "rapidocr", EngineVersion: "3.0.0", EngineBuild: "cpu",
		EngineSource: "RapidOCR (test declaration)", EngineLicense: "Apache-2.0",
		ModelID: "PP-OCRv5-mobile-det-rec", ModelRevision: "2026-01", ModelLicenseID: "Apache-2.0",
		Stages:             []string{"DET", "REC"},
		Languages:          []string{"zh", "en"},
		DictionaryFormat:   "ppocr_keys_v1",
		LanguageNotes:      "Chinese and English coverage as declared by the installed dictionary",
		ONNXRuntimeVersion: "1.23.0", ONNXRuntimeBuild: "cpu", ONNXRuntimeCAPI: onnxRuntimeGoBindingCAPI,
		PreprocessingDigest: "sha256:" + strings.Repeat("1", 64),
		DetLimitSide:        960, DetThreshold: 0.3, DetBoxThreshold: 0.6, DetUnclipRatio: 1.5, DetMinBoxSize: 3,
		RecImageHeight: 48, RecImageWidth: 320, RecMinConfidence: 0.6,
		Runtime:     OCRBundleAsset{Path: "runtime.bin", SHA256: ocrTestAsset(files["runtime.bin"]).SHA256, Bytes: int64(len(files["runtime.bin"]))},
		Detection:   OCRBundleAsset{Path: "det.onnx", SHA256: ocrTestAsset(files["det.onnx"]).SHA256, Bytes: int64(len(files["det.onnx"]))},
		Recognition: OCRBundleAsset{Path: "rec.onnx", SHA256: ocrTestAsset(files["rec.onnx"]).SHA256, Bytes: int64(len(files["rec.onnx"]))},
		Dictionary:  OCRBundleAsset{Path: "dict.txt", SHA256: ocrTestAsset(files["dict.txt"]).SHA256, Bytes: int64(len(files["dict.txt"]))},
		License:     OCRBundleAsset{Path: "LICENSE", SHA256: ocrTestAsset(files["LICENSE"]).SHA256, Bytes: int64(len(files["LICENSE"]))},
	}
	if mutate != nil {
		mutate(&manifest)
	}
	payload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, OCRBundleManifestName), payload, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	return dir
}

func TestOCRBundleAdmitsVerifiedAssetsAndBindsFacts(t *testing.T) {
	root := writeOCRTestBundle(t, t.TempDir(), nil)
	admission, err := LoadOCRBundle(root)
	if err != nil {
		t.Fatalf("load bundle: %v", err)
	}
	if !strings.HasPrefix(admission.ProfileDigest, "sha256:") {
		t.Fatalf("profile digest = %q", admission.ProfileDigest)
	}
	if len(admission.AssetDigests) != 5 {
		t.Fatalf("asset digests = %+v", admission.AssetDigests)
	}
	if len(admission.AssetBytes["det"]) == 0 || len(admission.AssetBytes["dictionary"]) == 0 {
		t.Fatal("admitted bundle did not retain model and dictionary bytes")
	}
	again, err := LoadOCRBundle(root)
	if err != nil {
		t.Fatalf("reload bundle: %v", err)
	}
	if again.ProfileDigest != admission.ProfileDigest {
		t.Fatal("profile digest is not stable across reloads")
	}

	state := InspectOCRBundle(root)
	if state.State != "READY" || state.Reason == "" {
		t.Fatalf("state = %+v", state)
	}
	if state.EngineID != "rapidocr" || len(state.Languages) != 2 || state.License != "Apache-2.0" {
		t.Fatalf("state facts = %+v", state)
	}

	facts := ocrFactsFromAdmission(admission)
	if facts.Runtime != "onnxruntime" || facts.RuntimeVersion != "1.23.0" || facts.RuntimeDigest != admission.AssetDigests["runtime"] {
		t.Fatalf("runtime facts = %+v", facts)
	}
	if facts.ProfileDigest != admission.ProfileDigest || facts.PreprocessingDigest == "" {
		t.Fatalf("profile facts = %+v", facts)
	}
	if facts.AngleClassification != "NOT_CONFIGURED" {
		t.Fatalf("angle classification = %q", facts.AngleClassification)
	}
	if facts.DeterminismClass != "SEMANTICALLY_DETERMINISTIC" {
		t.Fatalf("determinism class = %q", facts.DeterminismClass)
	}
	if facts.LowConfidenceThreshold != 0.6 {
		t.Fatalf("threshold = %v", facts.LowConfidenceThreshold)
	}
	if len(facts.Assets) != 4 {
		t.Fatalf("asset pins = %+v", facts.Assets)
	}
	for index := 1; index < len(facts.Assets); index++ {
		if facts.Assets[index-1].Name >= facts.Assets[index].Name {
			t.Fatalf("asset pins are not deterministically ordered: %+v", facts.Assets)
		}
	}
	if strings.Join(facts.Languages, ",") != "zh,en" {
		t.Fatalf("languages = %v", facts.Languages)
	}

	dictionary := ocrDictionary(admission.AssetBytes["dictionary"])
	if len(dictionary) != 5 || dictionary[0] != "" || dictionary[1] != "a" || dictionary[4] != "中" {
		t.Fatalf("dictionary = %#v", dictionary)
	}
}

func TestOCRBundleRejectsMissingTamperedAndOverclaimingBundles(t *testing.T) {
	if _, err := LoadOCRBundle(filepath.Join(t.TempDir(), "absent")); !errors.Is(err, ErrOCRBundleNotBuilt) {
		t.Fatalf("missing bundle error = %v", err)
	}
	state := InspectOCRBundle(filepath.Join(t.TempDir(), "absent"))
	if state.State != "NOT_BUILT" || !strings.Contains(state.Reason, OCRBundleManifestName) {
		t.Fatalf("missing bundle state = %+v", state)
	}

	// Tampered model bytes must not be admitted under a declared digest.
	tampered := writeOCRTestBundle(t, t.TempDir(), nil)
	if err := os.WriteFile(filepath.Join(tampered, "rec.onnx"), []byte("different bytes entirely"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOCRBundle(tampered); !errors.Is(err, ErrOCRBundleUnavailable) || !strings.Contains(err.Error(), "rec asset") {
		t.Fatalf("tampered bundle error = %v", err)
	}
	if state := InspectOCRBundle(tampered); state.State != "UNAVAILABLE" {
		t.Fatalf("tampered bundle state = %+v", state)
	}

	// A declared but unimplemented stage is refused instead of silently
	// dropping part of the pipeline.
	clone := writeOCRTestBundle(t, t.TempDir(), func(manifest *OCRBundleManifest) {
		manifest.Stages = []string{"DET", "CLS", "REC"}
	})
	if _, err := LoadOCRBundle(clone); !errors.Is(err, ErrOCRBundleUnavailable) || !strings.Contains(err.Error(), "CLS") {
		t.Fatalf("unimplemented stage error = %v", err)
	}

	// An escaping asset path is refused.
	escape := writeOCRTestBundle(t, t.TempDir(), func(manifest *OCRBundleManifest) {
		manifest.Dictionary.Path = "../dict.txt"
	})
	if _, err := LoadOCRBundle(escape); !errors.Is(err, ErrOCRBundleUnavailable) {
		t.Fatalf("escaping path error = %v", err)
	}
	absolute := writeOCRTestBundle(t, t.TempDir(), func(manifest *OCRBundleManifest) {
		manifest.Dictionary.Path = filepath.Join(t.TempDir(), "dict.txt")
	})
	if _, err := LoadOCRBundle(absolute); !errors.Is(err, ErrOCRBundleUnavailable) {
		t.Fatalf("absolute path error = %v", err)
	}

	// A symlinked asset is refused even when the target bytes are correct.
	symlinked := writeOCRTestBundle(t, t.TempDir(), nil)
	target := filepath.Join(t.TempDir(), "real-dict.txt")
	if err := os.WriteFile(target, ocrTestBundleFiles()["dict.txt"], 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(symlinked, "dict.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(symlinked, "dict.txt")); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOCRBundle(symlinked); !errors.Is(err, ErrOCRBundleUnavailable) {
		t.Fatalf("symlinked asset error = %v", err)
	}

	// A profile, platform, or language overclaim is refused rather than
	// reported as this host's installed capability.
	for name, mutate := range map[string]func(*OCRBundleManifest){
		"profile":  func(manifest *OCRBundleManifest) { manifest.ProfileID = "someone-elses-profile" },
		"platform": func(manifest *OCRBundleManifest) { manifest.PlatformOS = "plan9" },
		"schema":   func(manifest *OCRBundleManifest) { manifest.Schema = "restoreweave.ocr-bundle.v2" },
		"language": func(manifest *OCRBundleManifest) { manifest.Languages = nil },
		"capi":     func(manifest *OCRBundleManifest) { manifest.ONNXRuntimeCAPI = 1 },
		"bounds":   func(manifest *OCRBundleManifest) { manifest.DetLimitSide = 4 },
		"det":      func(manifest *OCRBundleManifest) { manifest.DetThreshold = 0 },
		"rec":      func(manifest *OCRBundleManifest) { manifest.RecImageHeight = 2 },
		"unknown":  func(manifest *OCRBundleManifest) { manifest.DictionaryFormat = "" },
	} {
		root := writeOCRTestBundle(t, t.TempDir(), mutate)
		if _, err := LoadOCRBundle(root); !errors.Is(err, ErrOCRBundleUnavailable) {
			t.Fatalf("%s manifest was admitted: %v", name, err)
		}
	}
}

func TestOCRBundleRejectsUnknownManifestFieldsAndBadDigests(t *testing.T) {
	root := writeOCRTestBundle(t, t.TempDir(), nil)
	payload, err := os.ReadFile(filepath.Join(root, OCRBundleManifestName))
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(payload, &document); err != nil {
		t.Fatal(err)
	}
	document["silently_ignored_option"] = true
	patched, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, OCRBundleManifestName), patched, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOCRBundle(root); !errors.Is(err, ErrOCRBundleUnavailable) {
		t.Fatalf("unknown manifest field was accepted: %v", err)
	}

	// A bare hexadecimal digest is normalized to the sha256: form instead of
	// being compared as a different string.
	bare := writeOCRTestBundle(t, t.TempDir(), func(manifest *OCRBundleManifest) {
		manifest.Detection.SHA256 = strings.TrimPrefix(manifest.Detection.SHA256, "sha256:")
	})
	if _, err := LoadOCRBundle(bare); err != nil {
		t.Fatalf("bare digest rejected: %v", err)
	}

	// A declared byte length that does not match the installed file is a hard
	// error, so a partially copied bundle cannot be reported as installed.
	mismatched := writeOCRTestBundle(t, t.TempDir(), func(manifest *OCRBundleManifest) {
		manifest.Recognition.Bytes = manifest.Recognition.Bytes + 1
	})
	if _, err := LoadOCRBundle(mismatched); !errors.Is(err, ErrOCRBundleUnavailable) || !strings.Contains(err.Error(), "manifest declares") {
		t.Fatalf("byte-length mismatch error = %v", err)
	}
}

func TestOCRBundleRootFollowsTheModelsRootConvention(t *testing.T) {
	if root := OCRBundleRoot(""); root != "" {
		t.Fatalf("empty root produced %q", root)
	}
	root := OCRBundleRoot("/data/models")
	want := filepath.Join("/data/models", OCRProfileID, runtime.GOOS+"-"+runtime.GOARCH)
	if root != want {
		t.Fatalf("root = %q, want %q", root, want)
	}
	if state := InspectOCRBundle(""); state.State != "NOT_BUILT" || !strings.Contains(state.Reason, "paths.models") {
		t.Fatalf("unconfigured state = %+v", state)
	}
}
