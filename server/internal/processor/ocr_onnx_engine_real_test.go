//go:build cgo && (darwin || linux)

package processor

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// TestOCROnnxEngineAgainstOperatorInstalledBundle is the real-engine smoke
// test. It never downloads anything: it runs only when the operator has
// installed a bundle and points RESTOREWEAVE_OCR_BUNDLE at it (either the
// bundle root itself or the models root that contains
// <profile>/<goos-goarch>). Without that bundle it skips with an explicit
// statement instead of faking a pass.
func TestOCROnnxEngineAgainstOperatorInstalledBundle(t *testing.T) {
	configured := strings.TrimSpace(os.Getenv("RESTOREWEAVE_OCR_BUNDLE"))
	if configured == "" {
		t.Skip("RESTOREWEAVE_OCR_BUNDLE is not set: no operator-installed OCR bundle is present, so the in-process ONNX detection/recognition path cannot be exercised. The image pipeline, artifact shape, bounds, honest states, and search feed are covered by the fixture-engine tests instead.")
	}
	root := configured
	if _, err := os.Stat(filepath.Join(root, OCRBundleManifestName)); err != nil {
		root = OCRBundleRoot(configured)
	}
	admission, err := LoadOCRBundle(root)
	if err != nil {
		t.Fatalf("load installed OCR bundle at %s: %v", root, err)
	}
	if state := InspectOCRBundle(root); state.State != "READY" {
		t.Fatalf("installed bundle state = %+v", state)
	}
	engine, err := newOCRBundleEngine(admission)
	if err != nil {
		t.Fatalf("construct in-process ONNX OCR engine: %v", err)
	}
	if closer, ok := engine.(interface{ Close() error }); ok {
		defer closer.Close()
	}
	facts := engine.Facts()
	if facts.ProfileDigest != admission.ProfileDigest || facts.RuntimeDigest != admission.AssetDigests["runtime"] {
		t.Fatalf("engine facts are not bound to the admitted bundle: %+v", facts)
	}
	if len(facts.Languages) == 0 || facts.LanguageNotes == "" {
		t.Fatalf("engine did not declare its installed language coverage: %+v", facts)
	}

	pngBytes := encodeOCRFixturePNG(t, []string{"OCR"}, 8)
	img, info, err := decodeOCRImage(pngBytes, OCRInputBounds{})
	if err != nil {
		t.Fatalf("decode test image: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	result, err := engine.Recognize(ctx, ocrBitmapFromImage(img), ocrRunBoundsFromManifest(admission.Manifest, facts))
	if err != nil {
		t.Fatalf("recognize with the installed engine: %v", err)
	}
	t.Logf("installed engine %s %s read %d region(s) from a %dx%d %s image",
		facts.EngineID, facts.EngineVersion, len(result.Regions), info.Width, info.Height, info.Encoding)
	for index, region := range result.Regions {
		if !utf8.ValidString(region.Text) {
			t.Fatalf("region %d text is not valid UTF-8", index)
		}
		if region.Confidence < 0 || region.Confidence > 1 {
			t.Fatalf("region %d confidence = %v", index, region.Confidence)
		}
		if region.Box.X1 <= region.Box.X0 || region.Box.Y1 <= region.Box.Y0 {
			t.Fatalf("region %d box = %+v", index, region.Box)
		}
		t.Logf("  region %d %q confidence=%.4f box=%+v", index, region.Text, region.Confidence, region.Box)
	}
}
