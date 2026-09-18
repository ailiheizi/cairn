package processor

import (
	"bytes"
	"context"
	"encoding/binary"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"testing"
)

// The image reader is a header parser, so these tests generate real encoded
// images with the standard encoders and then assert that the parse reproduces
// the dimensions the encoder was given. A hand-built header covers the WebP
// variants the standard library cannot encode.

func TestImageMetaReadsEncodedHeaders(t *testing.T) {
	tests := []struct {
		name   string
		width  int
		height int
		encode func(t *testing.T, width, height int) []byte
		format string
	}{
		{name: "png", width: 37, height: 19, format: "png", encode: encodePNG},
		{name: "jpeg", width: 64, height: 48, format: "jpeg", encode: encodeJPEG},
		{name: "gif", width: 12, height: 30, format: "gif", encode: encodeGIF},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			body := test.encode(t, test.width, test.height)
			artifact, reason := parseImageMeta(body)
			if reason != "" {
				t.Fatalf("parse reason = %q", reason)
			}
			if artifact.Schema != SchemaImageMetaV1 || artifact.Format != test.format {
				t.Fatalf("artifact = %+v", artifact)
			}
			if artifact.Width != test.width || artifact.Height != test.height {
				t.Fatalf("dimensions = %dx%d, want %dx%d", artifact.Width, artifact.Height, test.width, test.height)
			}
			if artifact.Bytes != int64(len(body)) {
				t.Fatalf("bytes = %d, want %d", artifact.Bytes, len(body))
			}
			facts := ImageMeta{}.DurableFacts(mustJSON(t, artifact))
			if len(facts) != 3 {
				t.Fatalf("facts = %+v", facts)
			}
			if facts[0].Key != FactImageFormat || facts[0].Namespace != FactNamespaceImage {
				t.Fatalf("format fact = %+v", facts[0])
			}
			if facts[1].Key != FactImageWidth || facts[1].Value != test.width {
				t.Fatalf("width fact = %+v", facts[1])
			}
			if facts[2].Key != FactImageHeight || facts[2].Value != test.height {
				t.Fatalf("height fact = %+v", facts[2])
			}
		})
	}
}

func TestImageMetaReadsWebPChunks(t *testing.T) {
	lossless := buildWebP("VP8L", append([]byte{0x2f}, packLosslessDimensions(100, 50)...))
	artifact, reason := parseImageMeta(lossless)
	if reason != "" || artifact.Format != "webp" || artifact.Width != 100 || artifact.Height != 50 {
		t.Fatalf("lossless webp = %+v reason=%q", artifact, reason)
	}
	extended := buildWebP("VP8X", packExtendedDimensions(2048, 1024))
	artifact, reason = parseImageMeta(extended)
	if reason != "" || artifact.Width != 2048 || artifact.Height != 1024 {
		t.Fatalf("extended webp = %+v reason=%q", artifact, reason)
	}
	lossy := buildWebP("VP8 ", append([]byte{0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a}, packLossyDimensions(320, 240)...))
	artifact, reason = parseImageMeta(lossy)
	if reason != "" || artifact.Width != 320 || artifact.Height != 240 {
		t.Fatalf("lossy webp = %+v reason=%q", artifact, reason)
	}
	// An unknown first chunk still declares the container: the format is a
	// fact and the dimensions stay absent rather than guessed.
	unknown := buildWebP("ZZZZ", []byte{1, 2, 3, 4})
	artifact, reason = parseImageMeta(unknown)
	if reason != "" || artifact.Format != "webp" || artifact.Width != 0 || artifact.Height != 0 {
		t.Fatalf("unknown webp chunk = %+v reason=%q", artifact, reason)
	}
	if facts := (ImageMeta{}).DurableFacts(mustJSON(t, artifact)); len(facts) != 1 || facts[0].Key != FactImageFormat {
		t.Fatalf("unknown webp chunk facts = %+v", facts)
	}
}

func TestImageMetaRejectsMalformedHeaders(t *testing.T) {
	valid := encodePNG(t, 8, 8)
	tests := []struct {
		name string
		body []byte
		want string
	}{
		{name: "truncated png header", body: valid[:20], want: ImageReasonMalformedHeader},
		{name: "absurd png width", body: pngWithDimensions(0xffffffff, 8), want: ImageReasonMalformedHeader},
		{name: "zero png height", body: pngWithDimensions(8, 0), want: ImageReasonMalformedHeader},
		{name: "empty gif screen", body: append([]byte("GIF89a"), 0, 0, 0, 0, 0x00, 0x00, 0x00, 0x00), want: ImageReasonMalformedHeader},
		{name: "unsupported signature", body: []byte{0x42, 0x4d, 0x36, 0x00, 0x00, 0x00, 0x00, 0x00}, want: ImageReasonUnsupportedSignature},
		{name: "plain text", body: []byte("this is not an image at all"), want: ImageReasonUnsupportedSignature},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, reason := parseImageMeta(test.body); reason != test.want {
				t.Fatalf("reason = %q, want %q", reason, test.want)
			}
		})
	}
}

func TestImageMetaRunStageIsInapplicableForMalformedInput(t *testing.T) {
	// A file that cannot be parsed is a visible derived-result degradation: the
	// attempt is INAPPLICABLE with a reason and writes no artifact.
	result, err := runStageForTest(t, ImageMeta{}, encodePNG(t, 8, 8)[:16])
	if err != nil {
		t.Fatalf("run stage: %v", err)
	}
	if result.Status != StatusInapplicable || result.Reason != ImageReasonMalformedHeader {
		t.Fatalf("stage result = %+v", result)
	}
	if result.Sealed || result.SchemaRef != "" {
		t.Fatalf("a malformed image sealed an artifact: %+v", result)
	}
	// The unparsable input still points at a real header reader: a valid image
	// seals the declared schema.
	result, err = runStageForTest(t, ImageMeta{}, encodePNG(t, 8, 8))
	if err != nil {
		t.Fatalf("run stage: %v", err)
	}
	if result.Status != StatusSucceeded || result.SchemaRef != SchemaRefImageMeta() || result.MediaType != MediaTypeImageJSON || !result.Sealed {
		t.Fatalf("stage result = %+v", result)
	}
}

func encodePNG(t *testing.T, width, height int) []byte {
	t.Helper()
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, testImage(width, height)); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buffer.Bytes()
}

func encodeJPEG(t *testing.T, width, height int) []byte {
	t.Helper()
	var buffer bytes.Buffer
	if err := jpeg.Encode(&buffer, testImage(width, height), nil); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	return buffer.Bytes()
}

func encodeGIF(t *testing.T, width, height int) []byte {
	t.Helper()
	var buffer bytes.Buffer
	if err := gif.Encode(&buffer, testImage(width, height), nil); err != nil {
		t.Fatalf("encode gif: %v", err)
	}
	return buffer.Bytes()
}

func testImage(width, height int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 7), G: uint8(y * 11), B: 0x90, A: 0xff})
		}
	}
	return img
}

// pngWithDimensions builds a PNG whose IHDR declares caller-supplied
// dimensions, so a corrupt length field can be exercised directly.
func pngWithDimensions(width, height uint32) []byte {
	body := append([]byte("\x89PNG\r\n\x1a\n"), 0, 0, 0, 13)
	body = append(body, []byte("IHDR")...)
	body = binary.BigEndian.AppendUint32(body, width)
	body = binary.BigEndian.AppendUint32(body, height)
	body = append(body, 8, 6, 0, 0, 0)
	return append(body, 0, 0, 0, 0)
}

func buildWebP(chunk string, payload []byte) []byte {
	body := append([]byte("RIFF"), 0, 0, 0, 0)
	body = append(body, []byte("WEBP")...)
	body = append(body, []byte(chunk)...)
	body = binary.LittleEndian.AppendUint32(body, uint32(len(payload)))
	body = append(body, payload...)
	if len(body)%2 == 1 {
		body = append(body, 0)
	}
	binary.LittleEndian.PutUint32(body[4:8], uint32(len(body)-8))
	return body
}

func packLosslessDimensions(width, height int) []byte {
	bits := uint32(width-1) | uint32(height-1)<<14
	return binary.LittleEndian.AppendUint32(nil, bits)
}

func packExtendedDimensions(width, height int) []byte {
	payload := make([]byte, 10)
	w := width - 1
	h := height - 1
	payload[4] = byte(w)
	payload[5] = byte(w >> 8)
	payload[6] = byte(w >> 16)
	payload[7] = byte(h)
	payload[8] = byte(h >> 8)
	payload[9] = byte(h >> 16)
	return payload
}

func packLossyDimensions(width, height int) []byte {
	return binary.LittleEndian.AppendUint16(binary.LittleEndian.AppendUint16(nil, uint16(width)), uint16(height))
}

func TestImageMetaBudgetIsTheMediaBudget(t *testing.T) {
	budget := ImageMeta{}.ProcessingBudget()
	if budget.MaxSourceBytes != mediaMaxSourceBytes || budget.StageTimeout != mediaStageTimeout {
		t.Fatalf("image budget = %+v", budget)
	}
	if budget := (VideoMeta{}).ProcessingBudget(); budget.MaxSourceBytes != mediaMaxSourceBytes || budget.StageTimeout != mediaStageTimeout {
		t.Fatalf("video budget = %+v", budget)
	}
	if budget := (AudioTags{}).ProcessingBudget(); budget.MaxSourceBytes != mediaMaxSourceBytes || budget.StageTimeout != mediaStageTimeout {
		t.Fatalf("audio budget = %+v", budget)
	}
}

// runStageForTest runs one processor stage over an in-package source handle and
// returns the typed stage result.
func runStageForTest(t *testing.T, proc Processor, body []byte) (StageResult, error) {
	t.Helper()
	ctx := context.Background()
	staging, err := openStaging(t.TempDir(), "attempt-test", 1<<20)
	if err != nil {
		t.Fatalf("open staging: %v", err)
	}
	defer staging.Close()
	source := &SourceHandle{id: "sch_test", body: append([]byte(nil), body...), content: "sha256:test-source"}
	return proc.RunStage(ctx, Invocation{
		AttemptID: "attempt-test", FenceToken: 1,
		Route:          Route{Kind: RouteProcessing, Nodes: []RouteNode{{Stage: proc.Stage(), CapabilityID: proc.CapabilityID()}}},
		Node:           RouteNode{Stage: proc.Stage(), CapabilityID: proc.CapabilityID()},
		Source:         source,
		Staging:        staging,
		MaxOutputBytes: 1 << 20,
	})
}
