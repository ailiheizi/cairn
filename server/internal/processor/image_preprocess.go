package processor

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/draw"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"strings"
)

// Image preprocessing for the image embedding space. It uses the standard
// library image decoders only; no new dependency is introduced for decode or
// resample. The preprocessing profile is a declared, content-addressed fact:
// changing the kernel, size, mean, or standard deviation requires a new
// descriptor and therefore a new space fingerprint.
const (
	// ImagePreprocessProfileV1 identifies the exact resample/normalize path
	// implemented by PreprocessImageTensor. The kernel is a separable Keys
	// cubic (a = -0.75, the torchvision bicubic constant) with a support scaled
	// by the downsample ratio; it is a documented approximation of the
	// reference antialiased bicubic path, and the approximation is part of this
	// profile identity.
	ImagePreprocessProfileV1 = "clip-224-rgb-bicubic-a075-scaled-center-crop-l2-v1"
	// ImagePreprocessSizeV1 is the CLIP 224x224 input size.
	ImagePreprocessSizeV1 = 224
	// ImagePreprocessMaxPixels bounds decoded pixels so a decompression bomb
	// fails closed instead of exhausting memory.
	ImagePreprocessMaxPixels = 64 << 20
	// ImagePreprocessMaxDimension bounds one decoded side.
	ImagePreprocessMaxDimension = 32768
)

// clip mean/standard deviation from the Chinese-CLIP/CLIP preprocessing
// profile. They are declared facts of the fingerprint, not tunable defaults.
var (
	imagePreprocessMean = [3]float64{0.48145466, 0.4578275, 0.40821073}
	imagePreprocessStd  = [3]float64{0.26862954, 0.26130258, 0.27577711}
)

var (
	ErrImagePreprocess = errors.New("image preprocessing failed")
)

// mediaTypeForDecodedFormat maps a standard-library decoder name to the media
// type recorded by the host. A mismatch between the declared and actual format
// is an explicit failure, never a silent substitution.
func mediaTypeForDecodedFormat(format string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "jpeg":
		return "image/jpeg", nil
	case "png":
		return "image/png", nil
	default:
		return "", fmt.Errorf("%w: decoded format %q is not admitted", ErrImagePreprocess, format)
	}
}

// ValidateImageBytes admits image bytes for image-tower work: the bytes must
// decode to an admitted standard-library format that matches the declared
// media type and stay inside the bounded geometry. It is the shared admission
// for ingest embeddings and for host-admitted query images; the query path
// uses it so an undecodable query image is rejected as caller input before it
// can reach a provider.
func ValidateImageBytes(data []byte, mediaType string) error {
	if len(data) == 0 {
		return fmt.Errorf("%w: empty image bytes", ErrImagePreprocess)
	}
	decoded, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("%w: decode: %v", ErrImagePreprocess, err)
	}
	actual, err := mediaTypeForDecodedFormat(format)
	if err != nil {
		return err
	}
	if declared := strings.ToLower(strings.TrimSpace(mediaType)); declared != "" && declared != actual {
		return fmt.Errorf("%w: declared media type %q does not match decoded %q", ErrImagePreprocess, declared, actual)
	}
	bounds := decoded.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return fmt.Errorf("%w: decoded image has no pixels", ErrImagePreprocess)
	}
	if width > ImagePreprocessMaxDimension || height > ImagePreprocessMaxDimension ||
		int64(width)*int64(height) > ImagePreprocessMaxPixels {
		return fmt.Errorf("%w: decoded image %dx%d exceeds the admitted bounds", ErrImagePreprocess, width, height)
	}
	return nil
}

// PreprocessImageTensor decodes admitted image bytes and returns a normalized
// CHW float32 tensor of size*size pixels. The declared mediaType must match the
// actual decoded format.
func PreprocessImageTensor(data []byte, mediaType string, size int) ([]float32, error) {
	if size <= 0 || size > 1024 {
		return nil, fmt.Errorf("%w: image size %d is outside bounds", ErrImagePreprocess, size)
	}
	if err := ValidateImageBytes(data, mediaType); err != nil {
		return nil, err
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		// ValidateImageBytes just admitted these bytes; a decode failure here
		// would be a reader defect, not an input fact.
		return nil, fmt.Errorf("%w: decode: %v", ErrImagePreprocess, err)
	}
	bounds := decoded.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	// Normalize the decoded color model once so the resample kernel sees a
	// stable 8-bit RGBA layout regardless of the source format.
	rgba := image.NewNRGBA(image.Rect(0, 0, width, height))
	draw.Draw(rgba, rgba.Bounds(), decoded, bounds.Min, draw.Src)

	// Resize the shorter side to the target size, preserving aspect ratio, then
	// center crop the target square. This mirrors the reference CLIP transform.
	scale := float64(size) / float64(minInt(width, height))
	targetW := int(math.Round(float64(width) * scale))
	targetH := int(math.Round(float64(height) * scale))
	if targetW < size {
		targetW = size
	}
	if targetH < size {
		targetH = size
	}
	resized := resizeBicubic(rgba, targetW, targetH)
	cropX := (targetW - size) / 2
	cropY := (targetH - size) / 2

	tensor := make([]float32, 3*size*size)
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			// NRGBA.Stride is already bytes per row, so the pixel address is
			// row*Stride + column*4; only the channel index is added on top.
			offset := (y+cropY)*resized.Stride + (x+cropX)*4
			for channel := 0; channel < 3; channel++ {
				value := float64(resized.Pix[offset+channel]) / 255.0
				normalized := (value - imagePreprocessMean[channel]) / imagePreprocessStd[channel]
				tensor[channel*size*size+y*size+x] = float32(normalized)
			}
		}
	}
	return tensor, nil
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// cubicWeight is the separable Keys cubic kernel used by torchvision's
// bicubic interpolation (a = -0.75).
func cubicWeight(distance float64) float64 {
	const a = -0.75
	t := math.Abs(distance)
	switch {
	case t <= 1:
		return ((a+2)*t-(a+3))*t*t + 1
	case t < 2:
		return (((t-5)*t+8)*t - 4) * a
	default:
		return 0
	}
}

// resamplePlan is the deterministic per-axis resampling plan.
type resamplePlan struct {
	indices [][]int
	weights [][]float64
}

func planAxis(srcLen, dstLen int) resamplePlan {
	scale := float64(srcLen) / float64(dstLen)
	support := 2.0
	if scale > 1 {
		support *= scale
	}
	plan := resamplePlan{indices: make([][]int, dstLen), weights: make([][]float64, dstLen)}
	for dst := 0; dst < dstLen; dst++ {
		center := (float64(dst)+0.5)*scale - 0.5
		start := int(math.Ceil(center - support))
		end := int(math.Floor(center + support))
		total := 0.0
		var row []float64
		var index []int
		for src := start; src <= end; src++ {
			weight := cubicWeight((center - float64(src)) / (support / 2))
			if weight == 0 {
				continue
			}
			clamped := src
			if clamped < 0 {
				clamped = 0
			}
			if clamped >= srcLen {
				clamped = srcLen - 1
			}
			index = append(index, clamped)
			row = append(row, weight)
			total += weight
		}
		if total == 0 {
			nearest := int(math.Round(center))
			if nearest < 0 {
				nearest = 0
			}
			if nearest >= srcLen {
				nearest = srcLen - 1
			}
			index = []int{nearest}
			row = []float64{1}
			total = 1
		}
		for i := range row {
			row[i] /= total
		}
		plan.indices[dst] = index
		plan.weights[dst] = row
	}
	return plan
}

// resizeBicubic resamples an NRGBA image with a separable cubic kernel. It is
// deterministic for identical input bytes and geometry.
func resizeBicubic(src *image.NRGBA, dstW, dstH int) *image.NRGBA {
	if src == nil || dstW <= 0 || dstH <= 0 {
		return image.NewNRGBA(image.Rect(0, 0, 0, 0))
	}
	srcW, srcH := src.Bounds().Dx(), src.Bounds().Dy()
	if srcW == dstW && srcH == dstH {
		return src
	}
	horizontal := planAxis(srcW, dstW)
	vertical := planAxis(srcH, dstH)
	// Horizontal pass: srcH x dstW, four channels.
	intermediate := make([]float64, srcH*dstW*4)
	for y := 0; y < srcH; y++ {
		rowStart := y * src.Stride
		for x := 0; x < dstW; x++ {
			indices := horizontal.indices[x]
			weights := horizontal.weights[x]
			var accum [4]float64
			for i, index := range indices {
				offset := rowStart + index*4
				weight := weights[i]
				for channel := 0; channel < 4; channel++ {
					accum[channel] += weight * float64(src.Pix[offset+channel])
				}
			}
			out := (y*dstW + x) * 4
			for channel := 0; channel < 4; channel++ {
				intermediate[out+channel] = accum[channel]
			}
		}
	}
	// Vertical pass.
	dst := image.NewNRGBA(image.Rect(0, 0, dstW, dstH))
	for y := 0; y < dstH; y++ {
		indices := vertical.indices[y]
		weights := vertical.weights[y]
		for x := 0; x < dstW; x++ {
			var accum [4]float64
			for i, index := range indices {
				offset := (index*dstW + x) * 4
				weight := weights[i]
				for channel := 0; channel < 4; channel++ {
					accum[channel] += weight * intermediate[offset+channel]
				}
			}
			out := y*dst.Rect.Dx()*4 + x*4
			for channel := 0; channel < 4; channel++ {
				value := math.Round(accum[channel])
				if value < 0 {
					value = 0
				}
				if value > 255 {
					value = 255
				}
				dst.Pix[out+channel] = uint8(value)
			}
		}
	}
	return dst
}
