package processor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// ocrHarness is one in-process exact lane with the OCR processor registered.
type ocrHarness struct {
	store  *sqlite.Store
	result exact.IngestResult
	arts   []sqlite.ProcessorArtifact
	attemp []sqlite.ProcessorAttempt
	warns  []string
}

func ocrRunHarness(t *testing.T, processor *OCRImageText, files map[string][]byte) ocrHarness {
	t.Helper()
	ctx := context.Background()
	source := t.TempDir()
	for name, body := range files {
		path := filepath.Join(source, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(path, body, 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	store, repo := testLane(t)
	processors := append(DefaultProcessors(), Processor(processor))
	host := NewHost(store, repo, Options{StagingDir: t.TempDir(), Processors: processors})
	service := &exact.Service{Store: store, Repo: repo, Processor: host}
	ingested, err := service.Ingest(ctx, source)
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	artifacts, err := store.ListAdmittedArtifacts(ctx, ingested.WorkspaceID, ingested.SnapshotRef)
	if err != nil {
		t.Fatalf("list artifacts: %v", err)
	}
	attempts, err := store.ListProcessorAttempts(ctx, ingested.WorkspaceID, ingested.SnapshotRef)
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	return ocrHarness{store: store, result: ingested, arts: artifacts, attemp: attempts, warns: ingested.Warnings}
}

func ocrFixtureProcessor(engine OCREngine) *OCRImageText {
	processor := NewOCRImageText("")
	processor.explicitEngine = engine
	return processor
}

func ocrArtifactFor(t *testing.T, harness ocrHarness) ocrArtifact {
	t.Helper()
	for _, artifact := range harness.arts {
		if artifact.CapabilityID != CapabilityOCRImageText {
			continue
		}
		if artifact.Stage != "EXTRACT" || artifact.SchemaRef != SchemaRefOCRText() || artifact.MediaType != MediaTypeOCRJSON {
			t.Fatalf("OCR artifact envelope = %+v", artifact)
		}
		if artifact.State != sqlite.ArtifactAdmitted {
			t.Fatalf("OCR artifact state = %s", artifact.State)
		}
		var parsed ocrArtifact
		if err := json.Unmarshal([]byte(artifact.Body), &parsed); err != nil {
			t.Fatalf("unmarshal OCR artifact: %v", err)
		}
		sum := sha256.Sum256([]byte(artifact.Body))
		if artifact.Digest != "sha256:"+hex.EncodeToString(sum[:]) {
			t.Fatalf("host artifact digest %s does not match the sealed body", artifact.Digest)
		}
		if artifact.ByteLength != int64(len(artifact.Body)) {
			t.Fatalf("artifact length = %d for %d body bytes", artifact.ByteLength, len(artifact.Body))
		}
		return parsed
	}
	t.Fatalf("no admitted OCR artifact in %+v", harness.arts)
	return ocrArtifact{}
}

func TestOCRImageTextAdmitsRecognizedTextWithDigestsAndIdentity(t *testing.T) {
	pngBytes := encodeOCRFixturePNG(t, []string{"OCR", "ZXQ42"}, 4)
	harness := ocrRunHarness(t, ocrFixtureProcessor(fixtureOCREngine{}), map[string][]byte{"screenshot.png": pngBytes})
	artifact := ocrArtifactFor(t, harness)

	if artifact.Schema != SchemaOCRTextV1 {
		t.Fatalf("schema = %q", artifact.Schema)
	}
	if artifact.State != OCRArtifactStateText {
		t.Fatalf("state = %q, want TEXT: %+v", artifact.State, artifact.Quality)
	}
	if artifact.Text != "OCR\nZXQ42" {
		t.Fatalf("recognized text = %q", artifact.Text)
	}
	if len(artifact.Regions) != 2 {
		t.Fatalf("region count = %d, want 2 (one line region per rendered line)", len(artifact.Regions))
	}
	if artifact.Regions[0].Text != "OCR" || artifact.Regions[1].Text != "ZXQ42" {
		t.Fatalf("region texts = %q / %q", artifact.Regions[0].Text, artifact.Regions[1].Text)
	}
	for index, region := range artifact.Regions {
		if region.Ordinal != index {
			t.Fatalf("region %d has ordinal %d", index, region.Ordinal)
		}
		if region.Box.X1 <= region.Box.X0 || region.Box.Y1 <= region.Box.Y0 {
			t.Fatalf("region %d has an empty box %+v", index, region.Box)
		}
		if region.Box.X1 > artifact.Source.Width || region.Box.Y1 > artifact.Source.Height {
			t.Fatalf("region %d escapes the image: %+v", index, region.Box)
		}
		if region.Confidence <= 0 || region.Confidence > 1 {
			t.Fatalf("region %d confidence = %v", index, region.Confidence)
		}
	}
	if artifact.Source.ContentID == "" || !strings.HasPrefix(artifact.Source.ContentID, "sha256:") {
		t.Fatalf("source content id = %q", artifact.Source.ContentID)
	}
	if artifact.Source.LogicalLength != int64(len(pngBytes)) {
		t.Fatalf("source logical length = %d, want %d", artifact.Source.LogicalLength, len(pngBytes))
	}
	if artifact.Source.Encoding != "png" || artifact.Source.Width <= 0 || artifact.Source.Height <= 0 {
		t.Fatalf("source = %+v", artifact.Source)
	}
	if artifact.Engine.EngineID != "fixture-ocr-v1" || artifact.Engine.Runtime != "fixture-in-process" {
		t.Fatalf("engine = %+v", artifact.Engine)
	}
	if len(artifact.Engine.Languages) != 1 || artifact.Engine.Languages[0] != "en" {
		t.Fatalf("declared languages = %v", artifact.Engine.Languages)
	}
	if artifact.Engine.AngleClassification != "NOT_CONFIGURED" {
		t.Fatalf("angle classification claim = %q", artifact.Engine.AngleClassification)
	}
	if artifact.RecognitionDigest == "" || artifact.RecognitionDigest != ocrRecognitionDigest(artifact) {
		t.Fatalf("recognition digest = %q", artifact.RecognitionDigest)
	}
	if artifact.Quality.Truncated || artifact.Quality.LowConfidenceRegions != 0 {
		t.Fatalf("clean run reported degradation: %+v", artifact.Quality)
	}
	assertAttempt(t, harness.attemp, CapabilityOCRImageText, string(StatusSucceeded), "ADMITTED_ARTIFACT")
}

func TestOCRImageTextWithoutTextIsAnExplicitEmptyResult(t *testing.T) {
	blank := imageBlankPNG(t, 64, 40)
	harness := ocrRunHarness(t, ocrFixtureProcessor(fixtureOCREngine{}), map[string][]byte{"blank.png": blank})
	artifact := ocrArtifactFor(t, harness)
	if artifact.State != OCRArtifactStateEmpty {
		t.Fatalf("state = %q, want EMPTY", artifact.State)
	}
	if artifact.Text != "" || len(artifact.Regions) != 0 {
		t.Fatalf("empty result carried text: %+v", artifact)
	}
	if !containsString(artifact.Quality.Reasons, OCRReasonNoTextRegions) {
		t.Fatalf("empty result reasons = %v", artifact.Quality.Reasons)
	}
	// An explicit empty result is still an admitted, searchable artifact: it
	// is not an error and not a silent success.
	assertAttempt(t, harness.attemp, CapabilityOCRImageText, string(StatusSucceeded), "ADMITTED_ARTIFACT")
	if count := artifactsForCapability(harness.arts, CapabilityOCRImageText); count != 1 {
		t.Fatalf("admitted OCR artifacts = %d, want 1", count)
	}
}

// artifactsForCapability counts admitted artifacts of one capability. The
// image route carries both the bundled header reader and the optional OCR
// engine, so an OCR assertion must never be written against the route total.
func artifactsForCapability(artifacts []sqlite.ProcessorArtifact, capability string) int {
	count := 0
	for _, artifact := range artifacts {
		if artifact.CapabilityID == capability {
			count++
		}
	}
	return count
}

// ocrStubEngine is a test seam that returns caller-supplied regions without
// touching pixels, so the artifact marking rules can be asserted exactly. It
// declares itself as a stub in every artifact.
type ocrStubEngine struct {
	regions   []OCRRegion
	truncated bool
}

func (ocrStubEngine) Facts() OCRRunFacts {
	facts := fixtureOCREngine{}.Facts()
	facts.EngineID = "stub-ocr-v1"
	facts.EngineSource = "in-package test stub; not a shipped OCR engine"
	facts.LowConfidenceThreshold = 0.6
	return facts
}

func (e ocrStubEngine) Recognize(context.Context, OCRBitmap, OCRRunBounds) (OCRRunResult, error) {
	result := OCRRunResult{Regions: append([]OCRRegion(nil), e.regions...)}
	if e.truncated {
		result.Truncated = true
		result.Reasons = []string{OCRReasonRegionLimit}
	}
	return result, nil
}

func TestOCRImageTextMarksLowConfidenceAndEmptyRegionsAsPartial(t *testing.T) {
	engine := ocrStubEngine{regions: []OCRRegion{
		{Text: "OCR", Confidence: 0.99, BoxConfidence: 0.9, Box: OCRBox{X0: 2, Y0: 2, X1: 40, Y1: 22}},
		{Text: "LOW", Confidence: 0.4, BoxConfidence: 0.3, Box: OCRBox{X0: 2, Y0: 30, X1: 40, Y1: 50}},
		{Text: "", Confidence: 0.1, BoxConfidence: 0.05, Box: OCRBox{X0: 50, Y0: 2, X1: 70, Y1: 22}},
	}}
	harness := ocrRunHarness(t, ocrFixtureProcessor(engine), map[string][]byte{
		"scan.png": encodeOCRFixturePNG(t, []string{"OCR"}, 3),
	})
	artifact := ocrArtifactFor(t, harness)
	if artifact.State != OCRArtifactStatePartial {
		t.Fatalf("state = %q, want PARTIAL: %+v", artifact.State, artifact.Quality)
	}
	if artifact.Quality.LowConfidenceRegions != 2 || artifact.Quality.EmptyRegions != 1 {
		t.Fatalf("quality = %+v", artifact.Quality)
	}
	for _, want := range []string{OCRReasonLowConfidenceRegion, OCRReasonEmptyRegion} {
		if !containsString(artifact.Quality.Reasons, want) {
			t.Fatalf("reasons %v missing %s", artifact.Quality.Reasons, want)
		}
	}
	if artifact.Quality.MinConfidence != 0.4 || artifact.Regions[2].LowConfidence != true {
		t.Fatalf("low-confidence marking = %+v", artifact)
	}
	if artifact.Text != "OCR\nLOW" {
		t.Fatalf("text = %q", artifact.Text)
	}
	for index, region := range artifact.Regions {
		if region.Ordinal != index || region.Box.X1 <= region.Box.X0 {
			t.Fatalf("region %d = %+v", index, region)
		}
	}
}

func TestOCRImageTextReportsMissingBundleAsNotBuilt(t *testing.T) {
	// No bundle root at all: an unconfigured optional capability.
	harness := ocrRunHarness(t, NewOCRImageText(""), map[string][]byte{"scan.png": encodeOCRFixturePNG(t, []string{"OCR"}, 3)})
	assertAttempt(t, harness.attemp, CapabilityOCRImageText, string(StatusInapplicable), "PROCESSOR_INAPPLICABLE")
	if count := artifactsForCapability(harness.arts, CapabilityOCRImageText); count != 0 {
		t.Fatalf("a missing engine admitted %d OCR artifacts", count)
	}
	if !ocrAttemptReason(t, harness.attemp, CapabilityOCRImageText, StatusInapplicable, OCRReasonBundleNotBuilt) {
		t.Fatalf("attempts = %+v", harness.attemp)
	}

	// A resolved bundle root with nothing installed: NOT_BUILT naming the path.
	root := OCRBundleRoot(t.TempDir())
	state := InspectOCRBundle(root)
	if state.State != "NOT_BUILT" || !strings.Contains(state.Reason, OCRBundleManifestName) {
		t.Fatalf("inspect state = %+v", state)
	}
	harness = ocrRunHarness(t, NewOCRImageText(root), map[string][]byte{"scan.png": encodeOCRFixturePNG(t, []string{"OCR"}, 3)})
	assertAttempt(t, harness.attemp, CapabilityOCRImageText, string(StatusInapplicable), "PROCESSOR_INAPPLICABLE")
	if !ocrAttemptReason(t, harness.attemp, CapabilityOCRImageText, StatusInapplicable, root) {
		t.Fatalf("the NOT_BUILT reason must name the expected path: %+v", harness.attemp)
	}

	// A present but unreadable bundle is UNAVAILABLE, never READY.
	broken := t.TempDir()
	if err := os.WriteFile(filepath.Join(broken, OCRBundleManifestName), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if state := InspectOCRBundle(broken); state.State != "UNAVAILABLE" || state.Reason == "" {
		t.Fatalf("broken bundle state = %+v", state)
	}
	harness = ocrRunHarness(t, NewOCRImageText(broken), map[string][]byte{"scan.png": encodeOCRFixturePNG(t, []string{"OCR"}, 3)})
	assertAttempt(t, harness.attemp, CapabilityOCRImageText, string(StatusFailed), "PROCESSOR_STAGE_FAILED")
	if !ocrAttemptReason(t, harness.attemp, CapabilityOCRImageText, StatusFailed, OCRReasonBundleUnavailable) {
		t.Fatalf("attempts = %+v", harness.attemp)
	}
	if count := artifactsForCapability(harness.arts, CapabilityOCRImageText); count != 0 {
		t.Fatalf("a broken bundle admitted %d OCR artifacts", count)
	}
}

func TestOCRImageTextCorruptImageFailsOnlyThatItem(t *testing.T) {
	good := encodeOCRFixturePNG(t, []string{"OCR"}, 3)
	corrupt := good[:len(good)*2/3]
	harness := ocrRunHarness(t, ocrFixtureProcessor(fixtureOCREngine{}), map[string][]byte{
		"a-good.png": good,
		"b-bad.png":  corrupt,
		"c-good.png": good,
	})
	// The exact save is committed for every readable object and the batch is
	// not failed by one bad image; the defect stays visible as a warning.
	if _, err := harness.store.ListNamespaceContent(context.Background(), harness.result.WorkspaceID, harness.result.RootID); err != nil {
		t.Fatalf("namespace content: %v", err)
	}
	if harness.result.Files != 3 {
		t.Fatalf("ingested files = %d, want 3", harness.result.Files)
	}
	admitted := 0
	for _, artifact := range harness.arts {
		if artifact.CapabilityID == CapabilityOCRImageText {
			admitted++
		}
	}
	if admitted != 2 {
		t.Fatalf("admitted OCR artifacts = %d, want 2", admitted)
	}
	assertAttempt(t, harness.attemp, CapabilityOCRImageText, string(StatusFailed), "PROCESSOR_STAGE_FAILED")
	if !ocrAttemptReason(t, harness.attemp, CapabilityOCRImageText, StatusFailed, OCRReasonDecodeFailed) {
		t.Fatalf("the decode failure reason must be durable: %+v", harness.attemp)
	}
	if !ocrWarningsContain(harness.warns, "b-bad.png") {
		t.Fatalf("the failing subject must be named: %v", harness.warns)
	}
}

func TestOCRImageTextBoundsOversizedImageWithReason(t *testing.T) {
	processor := ocrFixtureProcessor(fixtureOCREngine{})
	processor.maxPixels = 64
	harness := ocrRunHarness(t, processor, map[string][]byte{"large.png": encodeOCRFixturePNG(t, []string{"OCR"}, 3)})
	if count := artifactsForCapability(harness.arts, CapabilityOCRImageText); count != 0 {
		t.Fatalf("an over-bound image admitted %d OCR artifacts", count)
	}
	assertAttempt(t, harness.attemp, CapabilityOCRImageText, string(StatusInapplicable), "PROCESSOR_INAPPLICABLE")
	if !ocrAttemptReason(t, harness.attemp, CapabilityOCRImageText, StatusInapplicable, OCRReasonInputBound) ||
		!ocrAttemptReason(t, harness.attemp, CapabilityOCRImageText, StatusInapplicable, "pixel cap") {
		t.Fatalf("the bound reason must be surfaced: %+v", harness.attemp)
	}
}

func TestOCRImageTextTimeoutIsBoundedAndReported(t *testing.T) {
	processor := ocrFixtureProcessor(fixtureOCREngine{})
	processor.timeout = time.Nanosecond
	harness := ocrRunHarness(t, processor, map[string][]byte{"scan.png": encodeOCRFixturePNG(t, []string{"OCR"}, 3)})
	assertAttempt(t, harness.attemp, CapabilityOCRImageText, string(StatusCancelled), "PROCESSOR_STAGE_CANCELLED")
	if !ocrAttemptReason(t, harness.attemp, CapabilityOCRImageText, StatusCancelled, OCRReasonTimeout) {
		t.Fatalf("attempts = %+v", harness.attemp)
	}
	if count := artifactsForCapability(harness.arts, CapabilityOCRImageText); count != 0 {
		t.Fatalf("a cancelled run admitted %d OCR artifacts", count)
	}
}

func TestOCRImageTextDoesNotRunForNonImageSubjects(t *testing.T) {
	// A subject with no image evidence is never routed to OCR: it is not
	// guessed at, downloaded for, or shelled out to, and it records no OCR
	// attempt at all.
	harness := ocrRunHarness(t, ocrFixtureProcessor(fixtureOCREngine{}), map[string][]byte{
		"note.txt": []byte("plain text is not an image"),
		"blob.bin": {0x00, 0x01, 0x02, 0xff},
	})
	for _, artifact := range harness.arts {
		if artifact.CapabilityID == CapabilityOCRImageText {
			t.Fatalf("a non-image subject admitted an OCR artifact: %+v", artifact)
		}
	}
	for _, attempt := range harness.attemp {
		if attempt.CapabilityID == CapabilityOCRImageText {
			t.Fatalf("a non-image subject recorded an OCR attempt: %+v", attempt)
		}
	}
}

// ocrAttemptReason returns the durable reason text of the first matching
// terminal attempt. The reason is the field that travels with the attempt row
// (and the sorted processing search axis); the host's per-subject warning is a
// generic message it owns.
func ocrAttemptReason(t *testing.T, attempts []sqlite.ProcessorAttempt, capabilityID string, status ResultStatus, want string) bool {
	t.Helper()
	for _, attempt := range attempts {
		if attempt.CapabilityID != capabilityID || attempt.Status != string(status) {
			continue
		}
		if strings.Contains(attempt.Reason, want) {
			return true
		}
	}
	return false
}

func ocrWarningsContain(warnings []string, want string) bool {
	for _, warning := range warnings {
		if strings.Contains(warning, want) {
			return true
		}
	}
	return false
}

func imageBlankPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{C: color.RGBA{R: 255, G: 255, B: 255, A: 255}}, image.Point{}, draw.Src)
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, canvas); err != nil {
		t.Fatalf("encode blank png: %v", err)
	}
	return buffer.Bytes()
}
