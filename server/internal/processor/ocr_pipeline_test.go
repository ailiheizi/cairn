package processor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"math"
	"strings"
	"testing"
	"time"
)

func encodeOCRFixturePNG(t *testing.T, lines []string, scale int) []byte {
	t.Helper()
	canvas := renderOCRFixtureImage(lines, scale, color.RGBA{R: 255, G: 255, B: 255, A: 255}, color.RGBA{A: 255})
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, canvas); err != nil {
		t.Fatalf("encode fixture png: %v", err)
	}
	return buffer.Bytes()
}

func TestOCRDecodeImageAcceptsPinnedCodecsAndReportsBounds(t *testing.T) {
	pngBytes := encodeOCRFixturePNG(t, []string{"OCR"}, 3)
	img, info, err := decodeOCRImage(pngBytes, OCRInputBounds{})
	if err != nil {
		t.Fatalf("decode png: %v", err)
	}
	if info.Encoding != "png" || info.Width <= 0 || info.Height <= 0 || info.Bytes != len(pngBytes) {
		t.Fatalf("png info = %+v", info)
	}
	if img.Bounds().Dx() != info.Width {
		t.Fatal("decoded image does not match reported width")
	}

	var jpegBuffer bytes.Buffer
	if err := jpeg.Encode(&jpegBuffer, renderOCRFixtureImage([]string{"OCR"}, 3, color.White, color.Black), nil); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	if _, jpegInfo, err := decodeOCRImage(jpegBuffer.Bytes(), OCRInputBounds{}); err != nil || jpegInfo.Encoding != "jpeg" {
		t.Fatalf("jpeg decode = %+v, %v", jpegInfo, err)
	}

	var gifBuffer bytes.Buffer
	if err := gif.Encode(&gifBuffer, renderOCRFixtureImage([]string{"OCR"}, 3, color.White, color.Black), nil); err != nil {
		t.Fatalf("encode gif: %v", err)
	}
	if _, gifInfo, err := decodeOCRImage(gifBuffer.Bytes(), OCRInputBounds{}); err != nil || gifInfo.Encoding != "gif" {
		t.Fatalf("gif decode = %+v, %v", gifInfo, err)
	}

	// The pixel cap is enforced from the inspected header, before a full
	// decode can allocate.
	if _, _, err := decodeOCRImage(pngBytes, OCRInputBounds{MaxPixels: 16}); !errors.Is(err, ErrOCRInputBound) {
		t.Fatalf("pixel cap error = %v, want ErrOCRInputBound", err)
	}

	// An unparsable payload is an unsupported encoding, not a silent skip and
	// not a decode crash.
	notAnImage := []byte("this is plain text, not an image")
	if _, _, err := decodeOCRImage(notAnImage, OCRInputBounds{}); !errors.Is(err, ErrOCRUnsupportedEncoding) {
		t.Fatalf("non-image error = %v, want ErrOCRUnsupportedEncoding", err)
	}

	// A truncated image header that decodes but has no readable pixels fails
	// as a corrupt image when the full payload was available.
	truncated := pngBytes[:len(pngBytes)*2/3]
	if _, _, err := decodeOCRImage(truncated, OCRInputBounds{}); !errors.Is(err, ErrOCRDecode) {
		t.Fatalf("truncated png error = %v, want ErrOCRDecode", err)
	}
	// The same bytes at the host source budget are reported as a resource
	// outcome, because the processor never saw the complete object.
	if _, _, err := decodeOCRImage(truncated, OCRInputBounds{SourceBudgetBytes: int64(len(truncated))}); !errors.Is(err, ErrOCRSourceBudget) {
		t.Fatalf("truncated-at-budget error = %v, want ErrOCRSourceBudget", err)
	}
}

func TestOCRDetectionPostprocessBuildsOrderedBoxes(t *testing.T) {
	const width, height = 40, 24
	prob := make([]float32, width*height)
	fill := func(x0, y0, x1, y1 int, value float32) {
		for y := y0; y < y1; y++ {
			for x := x0; x < x1; x++ {
				prob[y*width+x] = value
			}
		}
	}
	// Two regions on the first line and one on a second line.
	fill(2, 2, 10, 8, 0.9)
	fill(20, 2, 30, 8, 0.8)
	fill(2, 16, 14, 21, 0.7)

	mask := ocrBinarizeProbMap(prob, width, height, 0.5)
	components := ocrConnectedComponents(mask, width, height, 3)
	if len(components) != 3 {
		t.Fatalf("components = %d, want 3: %+v", len(components), components)
	}
	var boxes []OCRBox
	for _, component := range components {
		score := ocrComponentScore(prob, width, component.Box)
		if score < 0.6 {
			t.Fatalf("component score = %v, want >= 0.6", score)
		}
		if component.Box.width() < 3 || component.Box.height() < 3 {
			t.Fatalf("component box too small: %+v", component.Box)
		}
		boxes = append(boxes, component.Box)
	}
	ordered := ocrSortBoxes(boxes)
	if ordered[0].Y0 >= ordered[2].Y0 {
		t.Fatalf("reading order not top-down: %+v", ordered)
	}
	if ordered[0].X0 > ordered[1].X0 {
		t.Fatalf("reading order not left-to-right inside a line: %+v", ordered)
	}
	unclipped := ocrUnclip(ordered[0], 1.5, width, height)
	if unclipped.width() <= ordered[0].width() || unclipped.height() <= ordered[0].height() {
		t.Fatalf("unclip did not expand: %+v -> %+v", ordered[0], unclipped)
	}
	clamped := ocrUnclip(OCRBox{X0: 0, Y0: 0, X1: width, Y1: height}, 5, width, height)
	if clamped != (OCRBox{X0: 0, Y0: 0, X1: width, Y1: height}) {
		t.Fatalf("unclip escaped the bitmap: %+v", clamped)
	}
	// An empty mask produces no components and therefore no regions.
	if components := ocrConnectedComponents(make([]bool, width*height), width, height, 1); len(components) != 0 {
		t.Fatalf("empty mask produced %d components", len(components))
	}
}

func TestOCRCropRotatesVerticalRunsAndPadsRecognitionInput(t *testing.T) {
	bitmap := ocrBitmapFromImage(renderOCRFixtureImage([]string{"OCR"}, 6, color.White, color.Black))
	tall := OCRBox{X0: 4, Y0: 4, X1: 14, Y1: bitmap.Height}
	crop, ok := ocrCropBox(bitmap, tall)
	if !ok {
		t.Fatal("crop failed")
	}
	if !crop.Rotated {
		t.Fatal("a clearly vertical run must be rotated upright")
	}
	if crop.Bitmap.Width != tall.height() || crop.Bitmap.Height != tall.width() {
		t.Fatalf("rotated crop = %dx%d", crop.Bitmap.Width, crop.Bitmap.Height)
	}
	input := ocrRecognitionInput(crop.Bitmap, 16, 24)
	if input.Width != 24 || input.Height != 16 {
		t.Fatalf("recognition input = %dx%d", input.Width, input.Height)
	}
	if pixels := len(input.Pixels); pixels != 24*16 {
		t.Fatalf("recognition input pixels = %d", pixels)
	}
	// Padding is white in image space, which normalizes to +1.
	tensor := ocrRecTensor(input)
	if len(tensor) != 3*24*16 {
		t.Fatalf("tensor length = %d", len(tensor))
	}
	if math.Abs(float64(tensor[23])-1.0) > 1e-6 {
		t.Fatalf("padded pixel normalized to %v, want 1", tensor[23])
	}
	if _, ok := ocrCropBox(bitmap, OCRBox{X0: 500, Y0: 500, X1: 520, Y1: 520}); ok {
		t.Fatal("an out-of-bitmap box must not produce a crop")
	}
}

func TestOCRCTCDecodeUsesGreedyBlankCollapse(t *testing.T) {
	dictionary := []string{"", "A", "B", "C"}
	const classes = 4
	steps := 6
	logits := make([]float32, steps*classes)
	set := func(step, class int, value float32) { logits[step*classes+class] = value }
	// blank, A, A, blank, C, blank
	set(0, 0, 10)
	set(1, 1, 10)
	set(2, 1, 10)
	set(3, 0, 10)
	set(4, 3, 10)
	set(5, 0, 10)
	text, confidence := ocrCTCDecode(logits, steps, classes, dictionary)
	if text != "AC" {
		t.Fatalf("decoded text = %q, want AC", text)
	}
	if confidence < 0.99 {
		t.Fatalf("dominant confidence = %v, want ~1", confidence)
	}
	// A near-tie must produce a genuinely uncertain, low confidence instead of
	// a confident-looking constant.
	uncertain := make([]float32, 2*classes)
	uncertain[1] = 5.0
	uncertain[2] = 4.9
	uncertain[classes+1] = 5.0
	uncertain[classes+2] = 4.9
	_, lowConfidence := ocrCTCDecode(uncertain, 2, classes, dictionary)
	if lowConfidence >= 0.6 {
		t.Fatalf("uncertain confidence = %v, want < 0.6", lowConfidence)
	}
	if text, _ := ocrCTCDecode(nil, 0, 0, dictionary); text != "" {
		t.Fatalf("empty logits decoded to %q", text)
	}
}

func TestOCRTextClampAndEffectiveDeadline(t *testing.T) {
	clamped, truncated := ocrClampText("abcdef", 3)
	if !truncated || clamped != "abc" {
		t.Fatalf("clamp = %q truncated=%v", clamped, truncated)
	}
	if _, truncated := ocrClampText("abc", 3); truncated {
		t.Fatal("exact-length text reported as truncated")
	}
	// Multi-byte runes are never split in half.
	clamped, truncated = ocrClampText("中文中文", 5)
	if !truncated || !strings.HasPrefix("中文中文", clamped) || len(clamped) > 5 {
		t.Fatalf("rune clamp = %q truncated=%v", clamped, truncated)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	defer cancel()
	runCtx, runCancel, reason := ocrEffectiveDeadline(ctx, time.Hour)
	defer runCancel()
	if deadline, ok := runCtx.Deadline(); !ok || time.Until(deadline) > 50*time.Millisecond {
		t.Fatalf("effective deadline did not follow the shorter host deadline: %v", deadline)
	}
	if reason != "host stage deadline" {
		t.Fatalf("deadline reason = %q", reason)
	}
	if _, cancelNow, reasonNow := ocrEffectiveDeadline(context.Background(), 10*time.Second); reasonNow != "OCR per-image timeout" {
		t.Fatalf("reason = %q, want the OCR per-image ceiling", reasonNow)
	} else {
		cancelNow()
	}
}

func TestBuildOCRArtifactMarksLowConfidenceAndTruncation(t *testing.T) {
	inv := Invocation{Source: &SourceHandle{content: "sha256:source"}}
	info := OCRImageInfo{Encoding: "png", Width: 100, Height: 50, Bytes: 4096}
	facts := fixtureOCREngine{}.Facts()
	runBounds := ocrRunBoundsFromManifest(OCRBundleManifest{}, facts)
	bounds := OCRInputBounds{MaxPixels: OCRMaxPixels, SourceBudgetBytes: 1 << 20}

	artifact := buildOCRArtifact(inv, info, facts, runBounds, OCRRunResult{Regions: []OCRRegion{
		{Text: "OCR", Confidence: 0.99, BoxConfidence: 0.8, Box: OCRBox{X0: 1, Y0: 2, X1: 30, Y1: 20}},
		{Text: "", Confidence: 0.2, BoxConfidence: 0.1, Box: OCRBox{X0: 40, Y0: 2, X1: 60, Y1: 20}},
		{Text: "LOW", Confidence: 0.5, BoxConfidence: 0.3, Box: OCRBox{X0: 1, Y0: 30, X1: 30, Y1: 45}},
	}}, bounds)
	if artifact.State != OCRArtifactStatePartial {
		t.Fatalf("state = %q, want PARTIAL", artifact.State)
	}
	if artifact.Quality.EmptyRegions != 1 || artifact.Quality.LowConfidenceRegions != 2 {
		t.Fatalf("quality = %+v", artifact.Quality)
	}
	for _, want := range []string{OCRReasonLowConfidenceRegion, OCRReasonEmptyRegion} {
		if !containsString(artifact.Quality.Reasons, want) {
			t.Fatalf("reasons %v missing %s", artifact.Quality.Reasons, want)
		}
	}
	if artifact.Text != "OCR\nLOW" {
		t.Fatalf("text = %q", artifact.Text)
	}
	if artifact.Source.ContentID != "sha256:source" || artifact.Source.LogicalLength != 4096 {
		t.Fatalf("source identity = %+v", artifact.Source)
	}
	if artifact.Regions[1].LowConfidence != true || artifact.Regions[0].LowConfidence != false {
		t.Fatalf("per-region low confidence flags = %+v", artifact.Regions)
	}
	if artifact.RecognitionDigest != ocrRecognitionDigest(artifact) {
		t.Fatal("recognition digest does not recompute")
	}

	truncated := buildOCRArtifact(inv, info, facts, runBounds, OCRRunResult{
		Regions:   []OCRRegion{{Text: "OCR", Confidence: 1, BoxConfidence: 1, Box: OCRBox{X0: 1, Y0: 1, X1: 10, Y1: 10}}},
		Truncated: true,
		Reasons:   []string{OCRReasonRegionLimit},
	}, bounds)
	if truncated.State != OCRArtifactStatePartial || !truncated.Quality.Truncated {
		t.Fatalf("truncated artifact = %+v", truncated)
	}
	if !containsString(truncated.Quality.Reasons, OCRReasonRegionLimit) {
		t.Fatalf("truncation reason dropped: %v", truncated.Quality.Reasons)
	}

	empty := buildOCRArtifact(inv, info, facts, runBounds, OCRRunResult{}, bounds)
	if empty.State != OCRArtifactStateEmpty || empty.Text != "" || len(empty.Regions) != 0 {
		t.Fatalf("empty artifact = %+v", empty)
	}
	if !containsString(empty.Quality.Reasons, OCRReasonNoTextRegions) {
		t.Fatalf("empty artifact reasons = %v", empty.Quality.Reasons)
	}

	// The artifact is valid JSON and the schema string is the pinned schema.
	payload, err := json.Marshal(artifact)
	if err != nil {
		t.Fatalf("marshal artifact: %v", err)
	}
	var decoded ocrArtifact
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("unmarshal artifact: %v", err)
	}
	if decoded.Schema != SchemaOCRTextV1 {
		t.Fatalf("schema = %q", decoded.Schema)
	}
}

func TestOCRFIXTUREFontRoundTripsEveryGlyph(t *testing.T) {
	names := make([]rune, 0, len(ocrFixtureFont))
	for name := range ocrFixtureFont {
		if name == ' ' {
			continue
		}
		names = append(names, name)
	}
	for _, name := range names {
		rows := ocrFixtureFont[name]
		if len(rows) != ocrFixtureGlyphHeight {
			t.Fatalf("glyph %q has %d rows", name, len(rows))
		}
		for _, row := range rows {
			if len(row) != ocrFixtureGlyphWidth {
				t.Fatalf("glyph %q row %q is not %d wide", name, row, ocrFixtureGlyphWidth)
			}
		}
		for column := 0; column < ocrFixtureGlyphWidth; column++ {
			hasInk := false
			for _, row := range rows {
				if row[column] == '#' {
					hasInk = true
					break
				}
			}
			if !hasInk {
				t.Fatalf("glyph %q has an empty interior column %d", name, column)
			}
		}
	}
	for _, glyph := range names {
		canvas := renderOCRFixtureImage([]string{string(glyph)}, 4, color.White, color.Black)
		bitmap := ocrBitmapFromImage(canvas)
		result, err := fixtureOCREngine{}.Recognize(context.Background(), bitmap, OCRRunBounds{MaxRegions: 4, MaxTextBytes: 64})
		if err != nil {
			t.Fatalf("recognize %q: %v", glyph, err)
		}
		if len(result.Regions) != 1 {
			t.Fatalf("glyph %q produced %d regions", glyph, len(result.Regions))
		}
		if result.Regions[0].Text != string(glyph) {
			t.Fatalf("glyph %q round-tripped to %q", glyph, result.Regions[0].Text)
		}
		if result.Regions[0].Confidence < 0.999 {
			t.Fatalf("exact glyph %q confidence = %v", glyph, result.Regions[0].Confidence)
		}
	}
}
