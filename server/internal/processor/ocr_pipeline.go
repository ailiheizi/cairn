package processor

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"math"
	"sort"
	"strings"
	"time"
)

// OCR resource bounds. One pathological image must never stall or exhaust the
// processing queue: the header is inspected before a full decode, the pixel
// budget is enforced before allocation, and the region/text ceilings are
// enforced while the run is in progress. Every bound that changes an outcome
// is surfaced in the artifact or the attempt reason.
const (
	// OCRMaxDimension is the largest accepted image side in pixels.
	OCRMaxDimension = 20000
	// OCRMaxPixels is the largest accepted decoded bitmap (width * height).
	OCRMaxPixels = 40_000_000
	// OCRMaxRegions bounds recognized text regions per image.
	OCRMaxRegions = 2048
	// OCRMaxTextBytes bounds the recognized text stored per image.
	OCRMaxTextBytes = 256 << 10
	// OCRStageTimeout is the OCR-specific per-image ceiling. The effective
	// deadline is this value or the host stage deadline, whichever is shorter.
	OCRStageTimeout = 20 * time.Second
	// OCRMaxDictionaryEntries bounds a dictionary file before it is trusted.
	OCRMaxDictionaryEntries = 200_000
)

// OCR box scores below this value are reported as low confidence when no
// manifest threshold applies (fixture/engine default).
const OCRDefaultLowConfidence = 0.6

var (
	// ErrOCRInputBound means the image is valid but outside the OCR input
	// bounds. It is an explicit inapplicable outcome, not a failure.
	ErrOCRInputBound = errors.New("OCR input is outside the admitted bounds")
	// ErrOCRUnsupportedEncoding means no decoder in this build understands the
	// image encoding. No other codec is downloaded or shelled out to.
	ErrOCRUnsupportedEncoding = errors.New("OCR supports PNG, JPEG, and GIF input only")
	// ErrOCRDecode means the bytes are not a decodable image.
	ErrOCRDecode = errors.New("OCR could not decode the image")
	// ErrOCRSourceBudget means the host source read stopped at its own byte
	// budget, so the processor never saw the complete image.
	ErrOCRSourceBudget = errors.New("OCR source bytes reached the host source budget")
)

// OCRInputBounds are the resource bounds applied before and during decode.
type OCRInputBounds struct {
	// MaxPixels is the decoded-bitmap ceiling; zero means OCRMaxPixels.
	MaxPixels int64
	// SourceBudgetBytes is the host source budget this attempt observed. When
	// the payload reached it, a decode failure is reported as truncated input
	// rather than as an authoritative defect of the image.
	SourceBudgetBytes int64
}

// OCRImageInfo records what was actually inspected.
type OCRImageInfo struct {
	Encoding string
	Width    int
	Height   int
	Bytes    int
}

// OCRBox is an axis-aligned pixel box in source-image coordinates. The box
// postprocess uses axis-aligned rectangles; no rotated polygon geometry is
// claimed.
type OCRBox struct {
	X0 int `json:"x0"`
	Y0 int `json:"y0"`
	X1 int `json:"x1"`
	Y1 int `json:"y1"`
}

func (b OCRBox) width() int  { return b.X1 - b.X0 }
func (b OCRBox) height() int { return b.Y1 - b.Y0 }

// decodeOCRImage inspects the image header before any full decode. The format
// registry is the pinned Go standard library pack (PNG, JPEG, GIF); an unknown
// encoding is reported instead of being guessed or downloaded.
func decodeOCRImage(body []byte, bounds OCRInputBounds) (image.Image, OCRImageInfo, error) {
	info := OCRImageInfo{Bytes: len(body)}
	maxPixels := bounds.MaxPixels
	if maxPixels <= 0 {
		maxPixels = OCRMaxPixels
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil {
		if bounds.SourceBudgetBytes > 0 && int64(len(body)) >= bounds.SourceBudgetBytes {
			return nil, info, fmt.Errorf("%w (%d bytes read of a larger object); raise the host source budget or skip OCR for this subject: %v",
				ErrOCRSourceBudget, len(body), err)
		}
		if errors.Is(err, image.ErrFormat) {
			return nil, info, fmt.Errorf("%w: %v", ErrOCRUnsupportedEncoding, err)
		}
		return nil, info, fmt.Errorf("%w: %v", ErrOCRDecode, err)
	}
	info.Encoding = format
	info.Width = config.Width
	info.Height = config.Height
	switch format {
	case "png", "jpeg", "gif":
	default:
		return nil, info, fmt.Errorf("%w: %s", ErrOCRUnsupportedEncoding, format)
	}
	if config.Width <= 0 || config.Height <= 0 {
		return nil, info, fmt.Errorf("%w: %s declares %dx%d", ErrOCRDecode, format, config.Width, config.Height)
	}
	if config.Width > OCRMaxDimension || config.Height > OCRMaxDimension {
		return nil, info, fmt.Errorf("%w: %s is %dx%d, larger than the %d pixel side cap", ErrOCRInputBound, format, config.Width, config.Height, OCRMaxDimension)
	}
	if int64(config.Width)*int64(config.Height) > maxPixels {
		return nil, info, fmt.Errorf("%w: %s is %dx%d (%d pixels), larger than the %d pixel cap",
			ErrOCRInputBound, format, config.Width, config.Height, int64(config.Width)*int64(config.Height), maxPixels)
	}
	img, err := decodeOCRImageBytes(body, format)
	if err != nil {
		if bounds.SourceBudgetBytes > 0 && int64(len(body)) >= bounds.SourceBudgetBytes {
			return nil, info, fmt.Errorf("%w: %s decode failed after reading %d bytes, the host source budget: %v",
				ErrOCRSourceBudget, format, len(body), err)
		}
		return nil, info, fmt.Errorf("%w: %v", ErrOCRDecode, err)
	}
	decoded := img.Bounds()
	info.Width = decoded.Dx()
	info.Height = decoded.Dy()
	if int64(info.Width)*int64(info.Height) > maxPixels {
		return nil, info, fmt.Errorf("%w: decoded bitmap is %dx%d, larger than the %d pixel cap", ErrOCRInputBound, info.Width, info.Height, maxPixels)
	}
	return img, info, nil
}

func decodeOCRImageBytes(body []byte, format string) (image.Image, error) {
	reader := bytes.NewReader(body)
	switch format {
	case "png":
		return png.Decode(reader)
	case "jpeg":
		return jpeg.Decode(reader)
	case "gif":
		return gif.Decode(reader)
	default:
		return nil, fmt.Errorf("%w: %s", ErrOCRUnsupportedEncoding, format)
	}
}

// OCRPixel is one decoded RGB sample in 0..255 after premultiplication
// removal. Image pixels are kept as a flat buffer so cropping and resizing do
// not depend on the concrete decoded image type.
type OCRPixel struct {
	R, G, B uint8
}

// OCRBitmap is the normalized decoded image used by the pipeline.
type OCRBitmap struct {
	Width  int
	Height int
	Pixels []OCRPixel
}

func (b OCRBitmap) at(x, y int) OCRPixel {
	if x < 0 || y < 0 || x >= b.Width || y >= b.Height {
		return OCRPixel{}
	}
	return b.Pixels[y*b.Width+x]
}

func ocrBitmapFromImage(img image.Image) OCRBitmap {
	bounds := img.Bounds()
	bitmap := OCRBitmap{Width: bounds.Dx(), Height: bounds.Dy()}
	bitmap.Pixels = make([]OCRPixel, bitmap.Width*bitmap.Height)
	index := 0
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			// RGBA() returns alpha-premultiplied 16-bit values. OCR operates on
			// the visible composite, which is exactly what premultiplied
			// samples describe for opaque images; no alpha reconstruction is
			// attempted.
			bitmap.Pixels[index] = OCRPixel{R: uint8(r >> 8), G: uint8(g >> 8), B: uint8(b >> 8)}
			index++
		}
	}
	return bitmap
}

// ocrScaledDimension applies the PP-OCR det resize policy: scale the longest
// side down to limitSide (never up), then round both sides to a multiple of 32.
func ocrScaledDimension(width, height, limitSide int) (int, int) {
	if limitSide <= 0 || (width <= limitSide && height <= limitSide) {
		return width, height
	}
	ratio := float64(limitSide) / float64(width)
	if height > width {
		ratio = float64(limitSide) / float64(height)
	}
	scaledW := int(math.Round(float64(width) * ratio))
	scaledH := int(math.Round(float64(height) * ratio))
	return ocrRoundUp32(scaledW), ocrRoundUp32(scaledH)
}

func ocrRoundUp32(value int) int {
	rounded := ((value + 31) / 32) * 32
	if rounded < 32 {
		return 32
	}
	return rounded
}

// ocrResizeBilinear resizes with bilinear sampling. It is the single resize
// used by both the detection and recognition inputs so the preprocessing
// digest covers one algorithm.
func ocrResizeBilinear(src OCRBitmap, width, height int) OCRBitmap {
	dst := OCRBitmap{Width: width, Height: height}
	dst.Pixels = make([]OCRPixel, width*height)
	if width == 0 || height == 0 {
		return dst
	}
	if src.Width == 0 || src.Height == 0 {
		return dst
	}
	scaleX := float64(src.Width) / float64(width)
	scaleY := float64(src.Height) / float64(height)
	for y := 0; y < height; y++ {
		srcY := (float64(y)+0.5)*scaleY - 0.5
		if srcY < 0 {
			srcY = 0
		}
		if srcY > float64(src.Height-1) {
			srcY = float64(src.Height - 1)
		}
		y0 := int(math.Floor(srcY))
		y1 := y0 + 1
		if y1 > src.Height-1 {
			y1 = src.Height - 1
		}
		fy := srcY - float64(y0)
		for x := 0; x < width; x++ {
			srcX := (float64(x)+0.5)*scaleX - 0.5
			if srcX < 0 {
				srcX = 0
			}
			if srcX > float64(src.Width-1) {
				srcX = float64(src.Width - 1)
			}
			x0 := int(math.Floor(srcX))
			x1 := x0 + 1
			if x1 > src.Width-1 {
				x1 = src.Width - 1
			}
			fx := srcX - float64(x0)
			p00 := src.at(x0, y0)
			p01 := src.at(x1, y0)
			p10 := src.at(x0, y1)
			p11 := src.at(x1, y1)
			dst.Pixels[y*width+x] = OCRPixel{
				R: ocrBilinear(p00.R, p01.R, p10.R, p11.R, fx, fy),
				G: ocrBilinear(p00.G, p01.G, p10.G, p11.G, fx, fy),
				B: ocrBilinear(p00.B, p01.B, p10.B, p11.B, fx, fy),
			}
		}
	}
	return dst
}

func ocrBilinear(a, b, c, d uint8, fx, fy float64) uint8 {
	top := float64(a)*(1-fx) + float64(b)*fx
	bottom := float64(c)*(1-fx) + float64(d)*fx
	value := top*(1-fy) + bottom*fy
	if value < 0 {
		value = 0
	}
	if value > 255 {
		value = 255
	}
	return uint8(math.Round(value))
}

// ocrDetectTensor converts a bitmap into the detection model's NCHW RGB
// input using the PP-OCR normalization constants.
func ocrDetectTensor(bitmap OCRBitmap) []float32 {
	mean := [3]float64{0.485, 0.456, 0.406}
	std := [3]float64{0.229, 0.224, 0.225}
	plane := bitmap.Width * bitmap.Height
	tensor := make([]float32, 3*plane)
	for i, pixel := range bitmap.Pixels {
		channels := [3]uint8{pixel.R, pixel.G, pixel.B}
		for c := 0; c < 3; c++ {
			value := (float64(channels[c])/255.0 - mean[c]) / std[c]
			tensor[c*plane+i] = float32(value)
		}
	}
	return tensor
}

// ocrRecTensor converts one recognition crop into the recognition model's
// NCHW RGB input using the PP-OCR recognition normalization constants.
func ocrRecTensor(bitmap OCRBitmap) []float32 {
	plane := bitmap.Width * bitmap.Height
	tensor := make([]float32, 3*plane)
	for i, pixel := range bitmap.Pixels {
		channels := [3]uint8{pixel.R, pixel.G, pixel.B}
		for c := 0; c < 3; c++ {
			value := (float64(channels[c])/255.0 - 0.5) / 0.5
			tensor[c*plane+i] = float32(value)
		}
	}
	return tensor
}

// ocrBinarizeProbMap thresholds the detection probability map.
func ocrBinarizeProbMap(prob []float32, width, height int, threshold float64) []bool {
	mask := make([]bool, width*height)
	for i := 0; i < len(prob) && i < len(mask); i++ {
		mask[i] = float64(prob[i]) >= threshold
	}
	return mask
}

// ocrComponent is one connected component of the thresholded text mask.
type ocrComponent struct {
	Box    OCRBox
	Pixels int
}

// ocrConnectedComponents finds 8-connected components and returns their
// bounding boxes in map coordinates. Components smaller than minPixels are
// dropped; an empty mask returns no components.
func ocrConnectedComponents(mask []bool, width, height, minPixels int) []ocrComponent {
	visited := make([]bool, len(mask))
	components := make([]ocrComponent, 0)
	queue := make([]int, 0, 64)
	for start := 0; start < len(mask); start++ {
		if visited[start] || !mask[start] {
			continue
		}
		queue = queue[:0]
		queue = append(queue, start)
		visited[start] = true
		box := OCRBox{X0: width, Y0: height}
		pixels := 0
		for head := 0; head < len(queue); head++ {
			index := queue[head]
			x := index % width
			y := index / width
			pixels++
			if x < box.X0 {
				box.X0 = x
			}
			if y < box.Y0 {
				box.Y0 = y
			}
			if x+1 > box.X1 {
				box.X1 = x + 1
			}
			if y+1 > box.Y1 {
				box.Y1 = y + 1
			}
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					if dx == 0 && dy == 0 {
						continue
					}
					nx, ny := x+dx, y+dy
					if nx < 0 || ny < 0 || nx >= width || ny >= height {
						continue
					}
					nIndex := ny*width + nx
					if visited[nIndex] || !mask[nIndex] {
						continue
					}
					visited[nIndex] = true
					queue = append(queue, nIndex)
				}
			}
		}
		if pixels < minPixels {
			continue
		}
		components = append(components, ocrComponent{Box: box, Pixels: pixels})
	}
	return components
}

// ocrComponentScore averages the probability map over the component's
// bounding rectangle. The rectangle includes sub-threshold pixels, so the
// score is conservative and comparable to a detection box score.
func ocrComponentScore(prob []float32, width int, box OCRBox) float64 {
	if box.width() <= 0 || box.height() <= 0 {
		return 0
	}
	var total float64
	var count int
	for y := box.Y0; y < box.Y1; y++ {
		for x := box.X0; x < box.X1; x++ {
			index := y*width + x
			if index < 0 || index >= len(prob) {
				continue
			}
			total += float64(prob[index])
			count++
		}
	}
	if count == 0 {
		return 0
	}
	return total / float64(count)
}

// ocrUnclip expands a rectangle by the unclip delta derived from its area and
// perimeter, then clamps it to the bitmap. This is the axis-aligned form of
// the PP-OCR unclip step.
func ocrUnclip(box OCRBox, ratio float64, width, height int) OCRBox {
	w := float64(box.width())
	h := float64(box.height())
	if w <= 0 || h <= 0 {
		return box
	}
	delta := (w * h * ratio) / (2 * (w + h))
	expanded := OCRBox{
		X0: int(math.Floor(float64(box.X0) - delta)),
		Y0: int(math.Floor(float64(box.Y0) - delta)),
		X1: int(math.Ceil(float64(box.X1) + delta)),
		Y1: int(math.Ceil(float64(box.Y1) + delta)),
	}
	if expanded.X0 < 0 {
		expanded.X0 = 0
	}
	if expanded.Y0 < 0 {
		expanded.Y0 = 0
	}
	if expanded.X1 > width {
		expanded.X1 = width
	}
	if expanded.Y1 > height {
		expanded.Y1 = height
	}
	if expanded.X1 <= expanded.X0 || expanded.Y1 <= expanded.Y0 {
		return box
	}
	return expanded
}

// ocrSortBoxes orders regions in reading order: line buckets derived from the
// median box height, then left to right. The order is deterministic for a
// given set of boxes.
func ocrSortBoxes(boxes []OCRBox) []OCRBox {
	if len(boxes) < 2 {
		return boxes
	}
	heights := make([]int, 0, len(boxes))
	for _, box := range boxes {
		heights = append(heights, box.height())
	}
	sort.Ints(heights)
	lineHeight := heights[len(heights)/2]
	if lineHeight < 1 {
		lineHeight = 1
	}
	ordered := append([]OCRBox(nil), boxes...)
	sort.SliceStable(ordered, func(i, j int) bool {
		iRow := (ordered[i].Y0 + ordered[i].Y1) / (2 * lineHeight)
		jRow := (ordered[j].Y0 + ordered[j].Y1) / (2 * lineHeight)
		if iRow != jRow {
			return iRow < jRow
		}
		if ordered[i].X0 != ordered[j].X0 {
			return ordered[i].X0 < ordered[j].X0
		}
		return ordered[i].Y0 < ordered[j].Y0
	})
	return ordered
}

// ocrCropResult is one recognition crop plus its orientation fact.
type ocrCropResult struct {
	Bitmap  OCRBitmap
	Rotated bool
}

// ocrCropBox extracts an axis-aligned crop and rotates it upright when the box
// is clearly taller than wide, which is the PP-OCR recognition convention for
// vertical text runs.
func ocrCropBox(bitmap OCRBitmap, box OCRBox) (ocrCropResult, bool) {
	box = OCRBox{
		X0: ocrMaxInt(box.X0, 0), Y0: ocrMaxInt(box.Y0, 0),
		X1: ocrMinInt(box.X1, bitmap.Width), Y1: ocrMinInt(box.Y1, bitmap.Height),
	}
	if box.width() <= 0 || box.height() <= 0 {
		return ocrCropResult{}, false
	}
	crop := OCRBitmap{Width: box.width(), Height: box.height()}
	crop.Pixels = make([]OCRPixel, crop.Width*crop.Height)
	for y := 0; y < crop.Height; y++ {
		for x := 0; x < crop.Width; x++ {
			crop.Pixels[y*crop.Width+x] = bitmap.at(box.X0+x, box.Y0+y)
		}
	}
	if crop.Height > crop.Width*3/2 {
		return ocrCropResult{Bitmap: ocrRotate90(crop), Rotated: true}, true
	}
	return ocrCropResult{Bitmap: crop}, true
}

func ocrRotate90(src OCRBitmap) OCRBitmap {
	dst := OCRBitmap{Width: src.Height, Height: src.Width}
	dst.Pixels = make([]OCRPixel, dst.Width*dst.Height)
	for y := 0; y < src.Height; y++ {
		for x := 0; x < src.Width; x++ {
			// Rotate counter-clockwise so a vertical run reads bottom-to-top.
			dx := y
			dy := src.Width - 1 - x
			dst.Pixels[dy*dst.Width+dx] = src.Pixels[y*src.Width+x]
		}
	}
	return dst
}

// ocrRecognitionInput scales a crop to the recognition height, pads to the
// recognition width with white, and returns the normalized tensor.
func ocrRecognitionInput(crop OCRBitmap, height, width int) OCRBitmap {
	scaledHeight := height
	scaledWidth := crop.Width
	if crop.Height > 0 {
		scaledWidth = int(math.Ceil(float64(crop.Width) * float64(height) / float64(crop.Height)))
	}
	if scaledWidth < 1 {
		scaledWidth = 1
	}
	if scaledWidth > width {
		scaledWidth = width
	}
	resized := ocrResizeBilinear(crop, scaledWidth, scaledHeight)
	padded := OCRBitmap{Width: width, Height: height}
	padded.Pixels = make([]OCRPixel, width*height)
	// The background is white after normalization (1.0), matching the
	// PP-OCR padding convention.
	for i := range padded.Pixels {
		padded.Pixels[i] = OCRPixel{R: 255, G: 255, B: 255}
	}
	for y := 0; y < resized.Height && y < height; y++ {
		for x := 0; x < resized.Width && x < width; x++ {
			padded.Pixels[y*width+x] = resized.Pixels[y*resized.Width+x]
		}
	}
	return padded
}

// ocrCTCDecode greedily decodes one (steps x classes) probability matrix from
// PP-OCR's Softmax output. Class 0 is the CTC blank. It rejects tensors that
// do not satisfy that explicit output contract instead of guessing whether
// the values are logits.
func ocrCTCDecode(probabilities []float32, steps, classes int, dictionary []string) (string, float64, error) {
	if steps <= 0 || classes <= 0 || len(probabilities) < steps*classes {
		return "", 0, errors.New("OCR recognition probabilities have an invalid shape")
	}
	var builder strings.Builder
	var confidenceTotal float64
	var kept int
	previous := -1
	for step := 0; step < steps; step++ {
		offset := step * classes
		best := 0
		bestValue := probabilities[offset]
		for class := 1; class < classes; class++ {
			if value := probabilities[offset+class]; value > bestValue {
				bestValue = value
				best = class
			}
		}
		var total float64
		for class := 0; class < classes; class++ {
			value := probabilities[offset+class]
			if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) || value < 0 || value > 1 {
				return "", 0, fmt.Errorf("OCR recognition probability at step %d class %d is outside [0,1] or non-finite", step, class)
			}
			total += float64(value)
		}
		if math.Abs(total-1) > 1e-3 {
			return "", 0, fmt.Errorf("OCR recognition probabilities at step %d sum to %.6f, want 1", step, total)
		}
		if best == 0 {
			previous = -1
			continue
		}
		if best == previous {
			continue
		}
		previous = best
		if best < len(dictionary) {
			builder.WriteString(dictionary[best])
		}
		confidenceTotal += float64(bestValue)
		kept++
	}
	if kept == 0 {
		return "", 0, nil
	}
	return builder.String(), confidenceTotal / float64(kept), nil
}

// ocrEffectiveDeadline combines the OCR per-image ceiling with the host stage
// deadline. Whichever is shorter wins, and the caller reports which one
// stopped the run, so a cancelled result is never ambiguous.
func ocrEffectiveDeadline(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc, string) {
	limit := timeout
	if limit <= 0 {
		limit = OCRStageTimeout
	}
	reason := "OCR per-image timeout"
	if deadline, ok := ctx.Deadline(); ok {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			cancelCtx, cancel := context.WithCancel(ctx)
			return cancelCtx, cancel, "host stage deadline"
		}
		if remaining < limit {
			limit = remaining
			reason = "host stage deadline"
		}
	}
	runCtx, cancel := context.WithTimeout(ctx, limit)
	return runCtx, cancel, reason
}

func ocrMaxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func ocrMinInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ocrClampText truncates recognized text to the byte ceiling on a rune
// boundary and reports whether truncation happened.
func ocrClampText(text string, maxBytes int) (string, bool) {
	if maxBytes <= 0 || len(text) <= maxBytes {
		return text, false
	}
	truncated := 0
	for index := range text {
		if index > maxBytes {
			break
		}
		truncated = index
	}
	if truncated == 0 {
		return "", true
	}
	return text[:truncated], true
}
