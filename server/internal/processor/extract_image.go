package processor

import (
	"context"
	"encoding/binary"
	"encoding/json"
)

// ImageMeta is the extract.image.meta.v1 EXTRACT processor: the image's
// declared pixel dimensions and format. It reads header structures only — no
// decoder runs and no pixel buffer is allocated — so a byte-deterministic
// header parse answers the ordinary "what is this picture" question without
// reading the whole image and without a codec dependency.
//
// The artifact body (schema restoreweave.domain.image.meta/v1,
// application/json) carries exactly the fields the file itself declares:
// `format` and the pixel `width`/`height`, plus the logical length this attempt
// read. A field the header does not declare is absent from the body and never
// becomes zero, so a downstream fact is absent for the same reason. A file
// whose header cannot be parsed is INAPPLICABLE with a typed reason: it is a
// visible degradation of an optional derived result, never a blocked exact
// save.
type ImageMeta struct{}

func (ImageMeta) CapabilityID() string { return CapabilityImageMeta }
func (ImageMeta) Stage() Stage         { return StageExtract }

// ProcessingBudget: a header parse is small, but it reads a real picture rather
// than a text-sized file, so it asks for the media budget the host already
// applies to other media capabilities.
func (ImageMeta) ProcessingBudget() CapabilityBudget {
	return CapabilityBudget{MaxSourceBytes: mediaMaxSourceBytes, StageTimeout: mediaStageTimeout}
}

// Stable reason markers for the operator-visible outcome vocabulary.
const (
	ImageReasonUnsupportedSignature = "IMAGE_META_UNSUPPORTED_SIGNATURE"
	ImageReasonMalformedHeader      = "IMAGE_META_MALFORMED_HEADER"
	ImageReasonEmptySource          = "IMAGE_META_EMPTY_SOURCE"
)

// Bounds. A declared dimension outside these limits is treated as a malformed
// header rather than as a fact: a corrupt length field must not become
// durable. The limit is far above any real photograph or scan.
const (
	maxImageDimension  = 1 << 17
	maxImageHeaderScan = 1 << 20
)

type imageMetaArtifact struct {
	Schema string `json:"schema"`
	Format string `json:"format,omitempty"`
	Width  int    `json:"width,omitempty"`
	Height int    `json:"height,omitempty"`
	Bytes  int64  `json:"bytes"`
}

func (ImageMeta) RunStage(ctx context.Context, inv Invocation) (StageResult, error) {
	if err := ctx.Err(); err != nil {
		return StageResult{Status: StatusCancelled, Reason: err.Error()}, err
	}
	if inv.Source == nil || inv.Staging == nil {
		return StageResult{Status: StatusFailed, Reason: "source and staging handles are required"}, nil
	}
	body, err := inv.Source.ReadAll(ctx)
	if err != nil {
		return StageResult{Status: StatusFailed, Reason: err.Error()}, nil
	}
	if len(body) == 0 {
		return StageResult{Status: StatusInapplicable, Reason: ImageReasonEmptySource}, nil
	}
	artifact, reason := parseImageMeta(body)
	if reason != "" {
		return StageResult{Status: StatusInapplicable, Reason: reason}, nil
	}
	payload, err := json.Marshal(artifact)
	if err != nil {
		return StageResult{Status: StatusFailed, Reason: err.Error()}, nil
	}
	if _, err := inv.Staging.Write(payload); err != nil {
		return StageResult{Status: StatusFailed, Reason: err.Error()}, nil
	}
	if err := inv.Staging.Seal(); err != nil {
		return StageResult{Status: StatusFailed, Reason: err.Error()}, nil
	}
	return StageResult{
		Status:           StatusSucceeded,
		DeterminismClass: DeterminismByteExact,
		SchemaRef:        SchemaRefImageMeta(),
		MediaType:        MediaTypeImageJSON,
		Sealed:           true,
	}, nil
}

// DurableFacts projects the admitted body into typed facts. Only fields the
// header declared are emitted; `bytes` is provenance for the artifact, not a
// fact about the image.
func (ImageMeta) DurableFacts(body []byte) []DurableFact {
	var artifact imageMetaArtifact
	if err := json.Unmarshal(body, &artifact); err != nil {
		return nil
	}
	facts := make([]DurableFact, 0, 3)
	if artifact.Format != "" {
		facts = append(facts, DurableFact{Namespace: FactNamespaceImage, Key: FactImageFormat, Value: artifact.Format, ValueType: FactValueString})
	}
	if artifact.Width > 0 {
		facts = append(facts, DurableFact{Namespace: FactNamespaceImage, Key: FactImageWidth, Value: artifact.Width, ValueType: FactValueInteger})
	}
	if artifact.Height > 0 {
		facts = append(facts, DurableFact{Namespace: FactNamespaceImage, Key: FactImageHeight, Value: artifact.Height, ValueType: FactValueInteger})
	}
	return facts
}

// parseImageMeta returns the declared format and dimensions of a PNG, JPEG, GIF,
// or WebP image, or a typed reason explaining why it could not. The return
// value never carries a guessed or zero-filled field.
func parseImageMeta(body []byte) (imageMetaArtifact, string) {
	if width, height, ok := parsePNGHeader(body); ok {
		if !validImageDimension(width, height) {
			return imageMetaArtifact{}, ImageReasonMalformedHeader
		}
		return imageMetaArtifact{Schema: SchemaImageMetaV1, Format: "png", Width: width, Height: height, Bytes: int64(len(body))}, ""
	}
	if width, height, ok := parseJPEGHeader(body); ok {
		if !validImageDimension(width, height) {
			return imageMetaArtifact{}, ImageReasonMalformedHeader
		}
		return imageMetaArtifact{Schema: SchemaImageMetaV1, Format: "jpeg", Width: width, Height: height, Bytes: int64(len(body))}, ""
	}
	if width, height, ok := parseGIFHeader(body); ok {
		if !validImageDimension(width, height) {
			return imageMetaArtifact{}, ImageReasonMalformedHeader
		}
		return imageMetaArtifact{Schema: SchemaImageMetaV1, Format: "gif", Width: width, Height: height, Bytes: int64(len(body))}, ""
	}
	// WebP is a RIFF container: the format is declared by the container even
	// when the first chunk is a variant whose dimensions cannot be read. That
	// still yields the format fact and an absent dimension pair.
	if format, width, height, ok := parseWebPHeader(body); ok {
		if width != 0 && !validImageDimension(width, height) {
			return imageMetaArtifact{}, ImageReasonMalformedHeader
		}
		return imageMetaArtifact{Schema: SchemaImageMetaV1, Format: format, Width: width, Height: height, Bytes: int64(len(body))}, ""
	}
	if isKnownImageSignature(body) {
		return imageMetaArtifact{}, ImageReasonMalformedHeader
	}
	return imageMetaArtifact{}, ImageReasonUnsupportedSignature
}

func validImageDimension(width, height int) bool {
	return width > 0 && height > 0 && width <= maxImageDimension && height <= maxImageDimension
}

// isKnownImageSignature distinguishes a malformed file of a recognized format
// from a format this processor does not claim.
func isKnownImageSignature(body []byte) bool {
	if len(body) >= 8 && string(body[:8]) == "\x89PNG\r\n\x1a\n" {
		return true
	}
	if len(body) >= 3 && body[0] == 0xff && body[1] == 0xd8 && body[2] == 0xff {
		return true
	}
	if len(body) >= 6 && (string(body[:6]) == "GIF87a" || string(body[:6]) == "GIF89a") {
		return true
	}
	if len(body) >= 12 && string(body[:4]) == "RIFF" && string(body[8:12]) == "WEBP" {
		return true
	}
	return false
}

// parsePNGHeader reads the fixed IHDR chunk that every PNG starts with.
func parsePNGHeader(body []byte) (int, int, bool) {
	if len(body) < 33 || string(body[:8]) != "\x89PNG\r\n\x1a\n" {
		return 0, 0, false
	}
	if string(body[12:16]) != "IHDR" || binary.BigEndian.Uint32(body[8:12]) != 13 {
		return 0, 0, false
	}
	return int(binary.BigEndian.Uint32(body[16:20])), int(binary.BigEndian.Uint32(body[20:24])), true
}

// parseJPEGHeader walks the JPEG marker segments looking for a start-of-frame
// header. The scan is bounded: a file whose SOF lies beyond the bound reports
// malformed instead of reading the whole stream.
func parseJPEGHeader(body []byte) (int, int, bool) {
	if len(body) < 4 || body[0] != 0xff || body[1] != 0xd8 {
		return 0, 0, false
	}
	limit := len(body)
	if limit > maxImageHeaderScan {
		limit = maxImageHeaderScan
	}
	offset := 2
	for offset+4 <= limit {
		if body[offset] != 0xff {
			return 0, 0, false
		}
		marker := body[offset+1]
		if marker == 0xff {
			offset++
			continue
		}
		// Standalone markers carry no length field.
		if marker == 0x01 || (marker >= 0xd0 && marker <= 0xd9) {
			offset += 2
			continue
		}
		length := int(binary.BigEndian.Uint16(body[offset+2 : offset+4]))
		if length < 2 || offset+2+length > limit {
			return 0, 0, false
		}
		if isJPEGStartOfFrame(marker) {
			if length < 7 {
				return 0, 0, false
			}
			height := int(binary.BigEndian.Uint16(body[offset+5 : offset+7]))
			width := int(binary.BigEndian.Uint16(body[offset+7 : offset+9]))
			return width, height, true
		}
		// A start-of-scan means the entropy-coded data begins; no SOF follows.
		if marker == 0xda {
			return 0, 0, false
		}
		offset += 2 + length
	}
	return 0, 0, false
}

func isJPEGStartOfFrame(marker byte) bool {
	switch marker {
	case 0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf:
		return true
	default:
		return false
	}
}

// parseGIFHeader reads the logical screen descriptor.
func parseGIFHeader(body []byte) (int, int, bool) {
	if len(body) < 10 {
		return 0, 0, false
	}
	signature := string(body[:6])
	if signature != "GIF87a" && signature != "GIF89a" {
		return 0, 0, false
	}
	return int(binary.LittleEndian.Uint16(body[6:8])), int(binary.LittleEndian.Uint16(body[8:10])), true
}

// parseWebPHeader reads the first chunk of a RIFF/WEBP container.
func parseWebPHeader(body []byte) (string, int, int, bool) {
	if len(body) < 16 || string(body[:4]) != "RIFF" || string(body[8:12]) != "WEBP" {
		return "", 0, 0, false
	}
	chunk := string(body[12:16])
	payload := body[20:]
	switch chunk {
	case "VP8 ":
		// Lossy: 3-byte frame tag, then the 0x9d012a start code and the
		// 14-bit dimensions.
		if len(payload) < 10 || payload[3] != 0x9d || payload[4] != 0x01 || payload[5] != 0x2a {
			return "webp", 0, 0, true
		}
		width := int(binary.LittleEndian.Uint16(payload[6:8]) & 0x3fff)
		height := int(binary.LittleEndian.Uint16(payload[8:10]) & 0x3fff)
		return "webp", width, height, true
	case "VP8L":
		// Lossless: signature byte 0x2f, then 14+14 bits of width-1/height-1.
		if len(payload) < 5 || payload[0] != 0x2f {
			return "webp", 0, 0, true
		}
		bits := binary.LittleEndian.Uint32(payload[1:5])
		width := int(bits&0x3fff) + 1
		height := int((bits>>14)&0x3fff) + 1
		return "webp", width, height, true
	case "VP8X":
		// Extended: 4 flag/reserved bytes, then 24-bit canvas width-1/height-1.
		if len(payload) < 10 {
			return "webp", 0, 0, true
		}
		width := int(uint32(payload[4])|uint32(payload[5])<<8|uint32(payload[6])<<16) + 1
		height := int(uint32(payload[7])|uint32(payload[8])<<8|uint32(payload[9])<<16) + 1
		return "webp", width, height, true
	default:
		return "webp", 0, 0, true
	}
}
