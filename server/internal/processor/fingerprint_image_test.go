package processor

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

func mustJSONBytes(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return raw
}

func openTestStaging(t *testing.T, attemptID string) *StagingHandle {
	t.Helper()
	staging, err := openStaging(t.TempDir(), attemptID, 1<<20)
	if err != nil {
		t.Fatalf("open staging: %v", err)
	}
	return staging
}

// The fixtures below are deterministic synthetic images. They prove the hash
// algorithm's own contract: determinism, robustness to re-encode and resize,
// and separation of unrelated images. None of them ever touches an identity
// claim.

func gradientImage(width, height int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8((x * 255) / maxInt2(width-1, 1)),
				G: uint8((y * 255) / maxInt2(height-1, 1)),
				B: uint8((x + y) % 256),
				A: 255,
			})
		}
	}
	return img
}

// checkerboardImage is a high-frequency pattern unrelated to a smooth gradient.
func checkerboardImage(width, height int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			shade := uint8(255)
			if (x/4+y/4)%2 == 0 {
				shade = 0
			}
			img.SetNRGBA(x, y, color.NRGBA{R: shade, G: shade, B: shade, A: 255})
		}
	}
	return img
}

func maxInt2(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func encodeTestPNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

func encodeTestJPEG(t *testing.T, img image.Image, quality int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	return buf.Bytes()
}

func hashTestImage(t *testing.T, data []byte) uint64 {
	t.Helper()
	hash, _, _, err := HashImagePerceptual(data)
	if err != nil {
		t.Fatalf("hash image: %v", err)
	}
	return hash
}

func TestHashImagePerceptualDeterministic(t *testing.T) {
	pngBytes := encodeTestPNG(t, gradientImage(64, 48))
	first, width, height, err := HashImagePerceptual(pngBytes)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if width != 64 || height != 48 {
		t.Fatalf("dimensions = %dx%d, want 64x48", width, height)
	}
	second, _, _, err := HashImagePerceptual(pngBytes)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if first != second {
		t.Fatalf("hash is not deterministic: %016x vs %016x", first, second)
	}
	if formatted := FormatPerceptualHash(first); len(formatted) != 16 || formatted != strings.ToLower(formatted) {
		t.Fatalf("formatted hash = %q, want 16 lowercase hex chars", formatted)
	}
	if PerceptualHashDistance(first, first) != 0 {
		t.Fatal("self distance must be zero")
	}
}

func TestHashImagePerceptualHandlesTinyAndPaletteImages(t *testing.T) {
	// 1x1: the preprocess must not divide by zero or guess.
	if _, _, _, err := HashImagePerceptual(encodeTestPNG(t, gradientImage(1, 1))); err != nil {
		t.Fatalf("1x1 image: %v", err)
	}
	// Palette PNG: a decoder path different from truecolor.
	palette := color.Palette{
		color.RGBA{R: 0, G: 0, B: 0, A: 255},
		color.RGBA{R: 255, G: 255, B: 255, A: 255},
		color.RGBA{R: 255, G: 0, B: 0, A: 255},
		color.RGBA{R: 0, G: 0, B: 255, A: 255},
	}
	img := image.NewPaletted(image.Rect(0, 0, 32, 24), palette)
	for y := 0; y < 24; y++ {
		for x := 0; x < 32; x++ {
			img.SetColorIndex(x, y, uint8((x/4+y/4)%len(palette)))
		}
	}
	paletteHash, _, _, err := HashImagePerceptual(encodeTestPNG(t, img))
	if err != nil {
		t.Fatalf("palette png: %v", err)
	}
	// The same picture in truecolor must land close to the palette encoding.
	truecolor := image.NewNRGBA(image.Rect(0, 0, 32, 24))
	for y := 0; y < 24; y++ {
		for x := 0; x < 32; x++ {
			truecolor.Set(x, y, palette[(x/4+y/4)%len(palette)])
		}
	}
	if distance := PerceptualHashDistance(paletteHash, hashTestImage(t, encodeTestPNG(t, truecolor))); distance > 10 {
		t.Fatalf("palette and truecolor encodings diverge: distance %d", distance)
	}
}

func TestHashImagePerceptualRobustToReencodeAndResize(t *testing.T) {
	original := gradientImage(160, 120)
	originalHash := hashTestImage(t, encodeTestPNG(t, original))
	// Re-encode as lossy JPEG: the hash must stay close.
	jpegHash := hashTestImage(t, encodeTestJPEG(t, original, 60))
	if distance := PerceptualHashDistance(originalHash, jpegHash); distance > 10 {
		t.Fatalf("jpeg re-encode distance = %d, want <= 10", distance)
	}
	// Re-encode as PNG at a different size: the fixed 9x8 preprocess absorbs it.
	resizedHash := hashTestImage(t, encodeTestPNG(t, gradientImage(96, 72)))
	if distance := PerceptualHashDistance(originalHash, resizedHash); distance > 10 {
		t.Fatalf("resize distance = %d, want <= 10", distance)
	}
}

func TestHashImagePerceptualSeparatesUnrelatedImages(t *testing.T) {
	gradientHash := hashTestImage(t, encodeTestPNG(t, gradientImage(64, 64)))
	checkerHash := hashTestImage(t, encodeTestPNG(t, checkerboardImage(64, 64)))
	if distance := PerceptualHashDistance(gradientHash, checkerHash); distance < 16 {
		t.Fatalf("unrelated images distance = %d, want >= 16", distance)
	}
}

func TestHashImagePerceptualExplicitlySkipsUndecodableBytes(t *testing.T) {
	if _, _, _, err := HashImagePerceptual([]byte("plainly not an image")); err == nil {
		t.Fatal("undecodable bytes must be an explicit skip, never a guess")
	}
	if _, _, _, err := HashImagePerceptual(nil); err == nil {
		t.Fatal("empty bytes must be an explicit skip")
	}
}

func TestParsePerceptualHashRequiresNotContentIdentity(t *testing.T) {
	hash, _, _, err := HashImagePerceptual(encodeTestPNG(t, gradientImage(32, 32)))
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	record := PerceptualHashRecord{
		Algorithm: PerceptualHashAlgorithmDHash64, Version: "1",
		HashHex: FormatPerceptualHash(hash), Width: 32, Height: 32,
		SourceContentID: "sha256:abc", LogicalLength: 10,
	}
	// Without the flag the body must not read as a hash.
	withoutFlag := record
	if parsed, ok := ParsePerceptualHash(string(mustJSONBytes(t, withoutFlag))); ok || parsed.HashHex != "" {
		t.Fatal("a body without not_content_identity must not parse as a hash")
	}
	record.NotContentIdentity = true
	parsed, ok := ParsePerceptualHash(string(mustJSONBytes(t, record)))
	if !ok || parsed.HashHex != FormatPerceptualHash(hash) {
		t.Fatalf("parse = %+v ok=%v", parsed, ok)
	}
	// Wrong algorithm or malformed hex fail closed.
	record.Algorithm = "sha256"
	if _, ok := ParsePerceptualHash(string(mustJSONBytes(t, record))); ok {
		t.Fatal("a body claiming another algorithm must not parse")
	}
	record.Algorithm = PerceptualHashAlgorithmDHash64
	record.HashHex = "zz"
	if _, ok := ParsePerceptualHash(string(mustJSONBytes(t, record))); ok {
		t.Fatal("malformed hex must not parse")
	}
}

func TestImagePerceptualHashRunStageEmitsNonIdentityArtifact(t *testing.T) {
	pngBytes := encodeTestPNG(t, gradientImage(48, 32))
	staging := openTestStaging(t, "attempt-image-1")
	defer staging.Close()
	source := &SourceHandle{id: "src", body: pngBytes, content: "sha256:" + strings.Repeat("a", 64)}
	result, err := ImagePerceptualHash{}.RunStage(context.Background(), Invocation{Source: source, Staging: staging})
	if err != nil {
		t.Fatalf("run stage: %v", err)
	}
	if result.Status != StatusSucceeded || !result.Sealed {
		t.Fatalf("status = %s sealed=%v reason=%q", result.Status, result.Sealed, result.Reason)
	}
	if result.SchemaRef != SchemaRefPerceptualHash() || result.DeterminismClass != DeterminismByteExact {
		t.Fatalf("schema/determinism = %s/%s", result.SchemaRef, result.DeterminismClass)
	}
	body, _, err := staging.sealedBytes()
	if err != nil {
		t.Fatalf("sealed bytes: %v", err)
	}
	record, ok := ParsePerceptualHash(string(body))
	if !ok {
		t.Fatalf("artifact body does not parse: %s", body)
	}
	if !record.NotContentIdentity || record.SourceContentID != source.ContentID() || record.LogicalLength != int64(len(pngBytes)) {
		t.Fatalf("record = %+v", record)
	}
	// The schema ref pins a schema whose name says what it is.
	if !strings.Contains(SchemaPerceptualHashV1, "perceptual-hash") {
		t.Fatalf("schema name = %s", SchemaPerceptualHashV1)
	}
}

func TestImagePerceptualHashRunStageSkipsUndecodable(t *testing.T) {
	staging := openTestStaging(t, "attempt-image-2")
	defer staging.Close()
	source := &SourceHandle{id: "src", body: []byte("not an image"), content: "sha256:" + strings.Repeat("b", 64)}
	result, err := ImagePerceptualHash{}.RunStage(context.Background(), Invocation{Source: source, Staging: staging})
	if err != nil {
		t.Fatalf("run stage: %v", err)
	}
	if result.Status != StatusInapplicable || result.Reason == "" {
		t.Fatalf("undecodable image = %s reason=%q, want an explicit skip", result.Status, result.Reason)
	}
}

func TestImagePerceptualHashIsOptInOnly(t *testing.T) {
	for _, proc := range DefaultProcessors() {
		if proc.CapabilityID() == CapabilityImagePerceptualHash {
			t.Fatal("the perceptual image hash must not be part of the default pack")
		}
	}
}

func TestImagePerceptualHashDeclaresMediaBudget(t *testing.T) {
	budget := ImagePerceptualHash{}.ProcessingBudget()
	if budget.MaxSourceBytes < 1<<20 || budget.StageTimeout <= 0 {
		t.Fatalf("media budget = %+v", budget)
	}
}
