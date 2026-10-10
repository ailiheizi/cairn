package processor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/draw"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"strings"
)

// PerceptualHash is an opt-in BYTE_DETERMINISTIC FINGERPRINT processor. Its
// output is a perceptual hash candidate signal only: it never establishes
// exact identity, never authorizes deletion, and never enters a dedup or
// recovery path. Exact identity remains whole-content SHA-256 plus logical
// length. Default ingest does not register it; the similarity scan stores its
// artifact shape through the same admitted-artifact table.
const (
	// CapabilityImagePerceptualHash is the opt-in image perceptual-hash
	// capability. It is deliberately absent from DefaultProcessors.
	CapabilityImagePerceptualHash = "fingerprint.image.perceptual.v1"
	// SchemaPerceptualHashV1 names the artifact body schema. Every body
	// carries not_content_identity=true so a reader can never mistake the
	// hash for a content identity.
	SchemaPerceptualHashV1 = "cairn.artifact.perceptual-hash.v1"
	// PerceptualHashAlgorithmDHash64 is the fixed algorithm profile: 64-bit
	// difference hash over a fixed 9x8 grayscale preprocess.
	PerceptualHashAlgorithmDHash64 = "dhash-64-v1"
)

// SchemaRefPerceptualHash pins the perceptual-hash artifact schema by digest,
// following the same pattern as the other bundled schemas.
func SchemaRefPerceptualHash() string {
	sum := sha256.Sum256([]byte(SchemaPerceptualHashV1))
	return "sha256:" + hex.EncodeToString(sum[:])
}

// PerceptualHashPreprocessWidth and PerceptualHashPreprocessHeight fix the
// preprocess geometry: 9 columns by 8 rows, so the 8x8 adjacent-column
// comparisons yield exactly 64 bits. Changing either number changes the
// algorithm identity and requires a new algorithm name.
const (
	PerceptualHashPreprocessWidth  = 9
	PerceptualHashPreprocessHeight = 8
	// PerceptualHashBits is the hash length in bits.
	PerceptualHashBits = 64
)

// PerceptualHashRecord is the admitted artifact body shape. SourceContentID
// and LogicalLength bind the hash to the exact content it was computed from;
// NotContentIdentity is mandatory and must stay true.
type PerceptualHashRecord struct {
	Algorithm          string `json:"algorithm"`
	Version            string `json:"version"`
	HashHex            string `json:"hash_hex"`
	Width              int    `json:"width"`
	Height             int    `json:"height"`
	SourceContentID    string `json:"source_content_id"`
	LogicalLength      int64  `json:"logical_length"`
	NotContentIdentity bool   `json:"not_content_identity"`
}

// ImagePerceptualHash is the opt-in processor. It is not Chromaprint, not a
// dedup engine, and not ContentIdentity.
type ImagePerceptualHash struct{}

func (ImagePerceptualHash) CapabilityID() string { return CapabilityImagePerceptualHash }
func (ImagePerceptualHash) Stage() Stage         { return StageFingerprint }

// ProcessingBudget declares the media budget: real photographs, a real
// deadline, and the same 64 MiB bound the repository image content source
// applies.
func (ImagePerceptualHash) ProcessingBudget() CapabilityBudget {
	return CapabilityBudget{MaxSourceBytes: mediaMaxSourceBytes, StageTimeout: mediaStageTimeout}
}

func (ImagePerceptualHash) RunStage(ctx context.Context, inv Invocation) (StageResult, error) {
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
	hash, width, height, err := HashImagePerceptual(body)
	if err != nil {
		// An undecodable image is an explicit skip, never a guess.
		return StageResult{Status: StatusInapplicable, Reason: err.Error()}, nil
	}
	payload, err := json.Marshal(PerceptualHashRecord{
		Algorithm:          PerceptualHashAlgorithmDHash64,
		Version:            "1",
		HashHex:            FormatPerceptualHash(hash),
		Width:              width,
		Height:             height,
		SourceContentID:    inv.Source.ContentID(),
		LogicalLength:      int64(len(body)),
		NotContentIdentity: true,
	})
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
		SchemaRef:        SchemaRefPerceptualHash(),
		MediaType:        MediaTypeFingerprintJSON,
		Sealed:           true,
	}, nil
}

// HashImagePerceptual decodes image bytes with the standard library decoders
// (PNG, JPEG, GIF) and computes the 64-bit dHash: grayscale, fixed 9x8
// bicubic resample, then one bit per adjacent column pair set when the left
// pixel is darker than the right one. The result is a similarity candidate
// signal only — never a content identity. A webp or otherwise undecodable
// image returns an error so the caller records an explicit skip with a reason.
func HashImagePerceptual(data []byte) (hash uint64, width, height int, err error) {
	if len(data) == 0 {
		return 0, 0, 0, fmt.Errorf("perceptual hash: empty image bytes")
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return 0, 0, 0, fmt.Errorf("perceptual hash: decode: %v", err)
	}
	bounds := decoded.Bounds()
	width, height = bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return 0, 0, 0, fmt.Errorf("perceptual hash: decoded image has no pixels")
	}
	if width > ImagePreprocessMaxDimension || height > ImagePreprocessMaxDimension ||
		int64(width)*int64(height) > ImagePreprocessMaxPixels {
		return 0, 0, 0, fmt.Errorf("perceptual hash: decoded image %dx%d exceeds the admitted bounds", width, height)
	}
	// Normalize to a stable 8-bit RGBA layout first so every decoder's pixel
	// order and alpha handling collapse to one deterministic input.
	rgba := image.NewNRGBA(image.Rect(0, 0, width, height))
	draw.Draw(rgba, rgba.Bounds(), decoded, bounds.Min, draw.Src)
	small := resizeBicubic(rgba, PerceptualHashPreprocessWidth, PerceptualHashPreprocessHeight)
	// Grayscale with the standard luminance weights, computed from the fixed
	// 9x8 grid only.
	gray := make([]uint8, PerceptualHashPreprocessWidth*PerceptualHashPreprocessHeight)
	for y := 0; y < PerceptualHashPreprocessHeight; y++ {
		for x := 0; x < PerceptualHashPreprocessWidth; x++ {
			offset := y*small.Stride + x*4
			r, g, b := float64(small.Pix[offset]), float64(small.Pix[offset+1]), float64(small.Pix[offset+2])
			luma := 0.299*r + 0.587*g + 0.114*b
			if luma < 0 {
				luma = 0
			}
			if luma > 255 {
				luma = 255
			}
			gray[y*PerceptualHashPreprocessWidth+x] = uint8(luma + 0.5)
		}
	}
	for y := 0; y < PerceptualHashPreprocessHeight; y++ {
		for x := 0; x < PerceptualHashPreprocessWidth-1; x++ {
			left := gray[y*PerceptualHashPreprocessWidth+x]
			right := gray[y*PerceptualHashPreprocessWidth+x+1]
			if left < right {
				bit := y*(PerceptualHashPreprocessWidth-1) + x
				hash |= 1 << uint(bit)
			}
		}
	}
	return hash, width, height, nil
}

// FormatPerceptualHash renders the hash as fixed-width lowercase hex.
func FormatPerceptualHash(hash uint64) string {
	var raw [8]byte
	for i := 0; i < 8; i++ {
		raw[i] = byte(hash >> uint(8*(7-i)))
	}
	return hex.EncodeToString(raw[:])
}

// ParsePerceptualHashHex decodes a stored hash hex string. It accepts exactly
// 16 hex bytes (64 bits); anything else is a rejected record, never a
// truncated guess.
func ParsePerceptualHashHex(hashHex string) (uint64, error) {
	trimmed := strings.ToLower(strings.TrimSpace(hashHex))
	raw, err := hex.DecodeString(trimmed)
	if err != nil || len(raw) != 8 {
		return 0, fmt.Errorf("perceptual hash %q is not 64-bit hex", hashHex)
	}
	var hash uint64
	for _, b := range raw {
		hash = hash<<8 | uint64(b)
	}
	return hash, nil
}

// PerceptualHashDistance is the Hamming distance between two 64-bit hashes.
func PerceptualHashDistance(a, b uint64) int {
	distance := 0
	for xor := a ^ b; xor != 0; xor &= xor - 1 {
		distance++
	}
	return distance
}

// ParsePerceptualHash reads an admitted perceptual-hash artifact body. It
// fails closed unless the body carries the pinned algorithm and the mandatory
// not_content_identity flag, so a body that could be mistaken for an identity
// claim is never read as a hash.
func ParsePerceptualHash(body string) (record PerceptualHashRecord, ok bool) {
	if err := json.Unmarshal([]byte(body), &record); err != nil {
		return PerceptualHashRecord{}, false
	}
	if !record.NotContentIdentity || record.Algorithm != PerceptualHashAlgorithmDHash64 {
		return PerceptualHashRecord{}, false
	}
	if _, err := ParsePerceptualHashHex(record.HashHex); err != nil {
		return PerceptualHashRecord{}, false
	}
	return record, true
}
