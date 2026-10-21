//go:build cgo && (darwin || linux)

package processor

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

// ocrOnnxEngine is the real in-process ONNX Runtime OCR engine for the
// admitted RapidOCR-style PP-OCR detection/recognition profile. It never
// downloads models: the operator installs the digest-pinned bundle, and every
// asset is re-verified before a session is created.
//
// Deliberate scope: detection and recognition only. Angle classification is
// not implemented, so a manifest that declares CLS is rejected by admission
// (validateOCRBundleManifest) rather than silently ignored. Detection output
// is required to be a sigmoid probability map; a graph exported without the
// sigmoid fails closed instead of producing plausible-looking nonsense.
type ocrOnnxEngine struct {
	mu          sync.Mutex
	facts       OCRRunFacts
	manifest    OCRBundleManifest
	detection   *ort.DynamicAdvancedSession
	recognition *ort.DynamicAdvancedSession
	dictionary  []string
	closed      bool
}

func newOCROnnxEngine(admission OCRBundleAdmission) (OCREngine, error) {
	manifest := admission.Manifest
	if len(admission.AssetBytes["runtime"]) == 0 || len(admission.AssetBytes["det"]) == 0 ||
		len(admission.AssetBytes["rec"]) == 0 || len(admission.AssetBytes["dictionary"]) == 0 {
		return nil, errors.New("verified OCR bundle assets are incomplete")
	}
	dictionary := ocrDictionary(admission.AssetBytes["dictionary"])
	if len(dictionary) < 2 || len(dictionary) > OCRMaxDictionaryEntries {
		return nil, fmt.Errorf("OCR dictionary has %d entries, outside 2..%d", len(dictionary), OCRMaxDictionaryEntries)
	}
	if err := acquireORTEnvironment(admission.AssetBytes["runtime"], admission.AssetDigests["runtime"], manifest.ONNXRuntimeVersion); err != nil {
		return nil, fmt.Errorf("initialize pinned ONNX Runtime: %w", err)
	}
	cleanup := func() { _ = releaseORTEnvironment() }
	detection, err := newOCRDetSession(admission.AssetBytes["det"])
	if err != nil {
		cleanup()
		return nil, err
	}
	recognition, err := newOCRRecSession(admission.AssetBytes["rec"])
	if err != nil {
		_ = detection.Destroy()
		cleanup()
		return nil, err
	}
	return &ocrOnnxEngine{
		facts:       ocrFactsFromAdmission(admission),
		manifest:    manifest,
		detection:   detection,
		recognition: recognition,
		dictionary:  dictionary,
	}, nil
}

// newOCRDetSession admits one detection graph whose single float32 rank-4
// input and single float32 rank-4 output are used by name from the model
// itself, so an export that renames nodes still loads.
func newOCRDetSession(model []byte) (*ort.DynamicAdvancedSession, error) {
	inputs, outputs, err := ort.GetInputOutputInfoWithONNXData(model)
	if err != nil {
		return nil, fmt.Errorf("inspect OCR detection model: %w", err)
	}
	if len(inputs) != 1 || len(outputs) != 1 {
		return nil, fmt.Errorf("OCR detection model has %d inputs and %d outputs, want 1 and 1", len(inputs), len(outputs))
	}
	if inputs[0].OrtValueType != ort.ONNXTypeTensor || inputs[0].DataType != ort.TensorElementDataTypeFloat || len(inputs[0].Dimensions) != 4 {
		return nil, errors.New("OCR detection input must be one float32 rank-4 tensor")
	}
	if outputs[0].OrtValueType != ort.ONNXTypeTensor || outputs[0].DataType != ort.TensorElementDataTypeFloat ||
		(len(outputs[0].Dimensions) != 4 && len(outputs[0].Dimensions) != 3) {
		return nil, errors.New("OCR detection output must be one float32 rank-3 or rank-4 tensor")
	}
	session, err := ort.NewDynamicAdvancedSessionWithONNXData(model, []string{inputs[0].Name}, []string{outputs[0].Name}, nil)
	if err != nil {
		return nil, fmt.Errorf("create OCR detection session: %w", err)
	}
	return session, nil
}

func newOCRRecSession(model []byte) (*ort.DynamicAdvancedSession, error) {
	inputs, outputs, err := ort.GetInputOutputInfoWithONNXData(model)
	if err != nil {
		return nil, fmt.Errorf("inspect OCR recognition model: %w", err)
	}
	if len(inputs) != 1 || len(outputs) != 1 {
		return nil, fmt.Errorf("OCR recognition model has %d inputs and %d outputs, want 1 and 1", len(inputs), len(outputs))
	}
	if inputs[0].OrtValueType != ort.ONNXTypeTensor || inputs[0].DataType != ort.TensorElementDataTypeFloat || len(inputs[0].Dimensions) != 4 {
		return nil, errors.New("OCR recognition input must be one float32 rank-4 tensor")
	}
	if outputs[0].OrtValueType != ort.ONNXTypeTensor || outputs[0].DataType != ort.TensorElementDataTypeFloat || len(outputs[0].Dimensions) != 3 {
		return nil, errors.New("OCR recognition output must be one float32 rank-3 tensor (1, steps, classes)")
	}
	session, err := ort.NewDynamicAdvancedSessionWithONNXData(model, []string{inputs[0].Name}, []string{outputs[0].Name}, nil)
	if err != nil {
		return nil, fmt.Errorf("create OCR recognition session: %w", err)
	}
	return session, nil
}

func (e *ocrOnnxEngine) Facts() OCRRunFacts {
	if e == nil {
		return OCRRunFacts{}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	facts := e.facts
	facts.Assets = append([]OCRAssetPin(nil), e.facts.Assets...)
	facts.Languages = append([]string(nil), e.facts.Languages...)
	facts.Stages = append([]string(nil), e.facts.Stages...)
	return facts
}

func (e *ocrOnnxEngine) Close() error {
	if e == nil {
		return nil
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return nil
	}
	e.closed = true
	var errs []error
	if e.recognition != nil {
		errs = append(errs, e.recognition.Destroy())
		e.recognition = nil
	}
	if e.detection != nil {
		errs = append(errs, e.detection.Destroy())
		e.detection = nil
	}
	errs = append(errs, releaseORTEnvironment())
	return errors.Join(errs...)
}

func (e *ocrOnnxEngine) Recognize(ctx context.Context, bitmap OCRBitmap, bounds OCRRunBounds) (OCRRunResult, error) {
	if e == nil {
		return OCRRunResult{}, errors.New("OCR engine is nil")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed || e.detection == nil || e.recognition == nil {
		return OCRRunResult{}, errors.New("OCR engine session is closed")
	}
	if err := ctx.Err(); err != nil {
		return OCRRunResult{}, err
	}
	prob, probWidth, probHeight, err := e.detect(ctx, bitmap)
	if err != nil {
		return OCRRunResult{}, err
	}
	result := OCRRunResult{Regions: make([]OCRRegion, 0, 8)}
	mask := ocrBinarizeProbMap(prob, probWidth, probHeight, e.manifest.DetThreshold)
	components := ocrConnectedComponents(mask, probWidth, probHeight, e.manifest.DetMinBoxSize)
	boxes := make([]OCRBox, 0, len(components))
	scores := make([]float64, 0, len(components))
	for _, component := range components {
		if component.Box.width() < e.manifest.DetMinBoxSize || component.Box.height() < e.manifest.DetMinBoxSize {
			continue
		}
		score := ocrComponentScore(prob, probWidth, component.Box)
		if score < e.manifest.DetBoxThreshold {
			continue
		}
		boxes = append(boxes, component.Box)
		scores = append(scores, score)
	}
	boxes = ocrSortBoxes(boxes)
	if len(boxes) == 0 {
		return result, nil
	}
	if bounds.MaxRegions > 0 && len(boxes) > bounds.MaxRegions {
		result.Truncated = true
		result.Reasons = append(result.Reasons, "REGION_LIMIT_REACHED")
		boxes = boxes[:bounds.MaxRegions]
		scores = scores[:bounds.MaxRegions]
	}
	scaleX := float64(bitmap.Width) / float64(probWidth)
	scaleY := float64(bitmap.Height) / float64(probHeight)
	textBytes := 0
	for index, box := range boxes {
		if err := ctx.Err(); err != nil {
			return OCRRunResult{}, err
		}
		source := OCRBox{
			X0: int(float64(box.X0) * scaleX), Y0: int(float64(box.Y0) * scaleY),
			X1: int(float64(box.X1)*scaleX + 0.5), Y1: int(float64(box.Y1)*scaleY + 0.5),
		}
		source = ocrUnclip(source, e.manifest.DetUnclipRatio, bitmap.Width, bitmap.Height)
		crop, ok := ocrCropBox(bitmap, source)
		if !ok {
			continue
		}
		input := ocrRecognitionInput(crop.Bitmap, e.manifest.RecImageHeight, e.manifest.RecImageWidth)
		text, confidence, err := e.recognize(ctx, input)
		if err != nil {
			return OCRRunResult{}, err
		}
		if bounds.MaxTextBytes > 0 && textBytes+len(text) > bounds.MaxTextBytes {
			result.Truncated = true
			result.Reasons = append(result.Reasons, "TEXT_LIMIT_REACHED")
			if remaining := bounds.MaxTextBytes - textBytes; remaining > 0 {
				if trimmed, _ := ocrClampText(text, remaining); trimmed != "" {
					result.Regions = append(result.Regions, OCRRegion{
						Text: trimmed, Confidence: confidence, BoxConfidence: scores[index],
						Box: source, Rotated: crop.Rotated,
					})
				}
			}
			break
		}
		textBytes += len(text)
		result.Regions = append(result.Regions, OCRRegion{
			Text: text, Confidence: confidence, BoxConfidence: scores[index], Box: source, Rotated: crop.Rotated,
		})
	}
	return result, nil
}

// detect runs the detection graph and returns the probability map.
func (e *ocrOnnxEngine) detect(ctx context.Context, bitmap OCRBitmap) ([]float32, int, int, error) {
	width, height := ocrScaledDimension(bitmap.Width, bitmap.Height, e.manifest.DetLimitSide)
	resized := ocrResizeBilinear(bitmap, width, height)
	tensor := ocrDetectTensor(resized)
	shape := ort.NewShape(1, 3, int64(height), int64(width))
	input, err := ort.NewTensor(shape, tensor)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("create OCR detection tensor: %w", err)
	}
	defer input.Destroy()
	outputs := []ort.Value{nil}
	if err := ocrRunSession(ctx, e.detection, []ort.Value{input}, outputs); err != nil {
		return nil, 0, 0, err
	}
	defer outputs[0].Destroy()
	output, ok := outputs[0].(*ort.Tensor[float32])
	if !ok {
		return nil, 0, 0, errors.New("OCR detection model returned a non-float32 tensor")
	}
	data := output.GetData()
	gotShape := output.GetShape()
	var gotHeight, gotWidth int
	switch len(gotShape) {
	case 4:
		if gotShape[0] != 1 || gotShape[1] != 1 {
			return nil, 0, 0, fmt.Errorf("OCR detection output shape %v is not (1,1,H,W)", gotShape)
		}
		gotHeight, gotWidth = int(gotShape[2]), int(gotShape[3])
	case 3:
		if gotShape[0] != 1 {
			return nil, 0, 0, fmt.Errorf("OCR detection output shape %v is not (1,H,W)", gotShape)
		}
		gotHeight, gotWidth = int(gotShape[1]), int(gotShape[2])
	default:
		return nil, 0, 0, fmt.Errorf("OCR detection output rank %d is not supported", len(gotShape))
	}
	if gotHeight != height || gotWidth != width {
		return nil, 0, 0, fmt.Errorf("OCR detection output is %dx%d for a %dx%d input", gotWidth, gotHeight, width, height)
	}
	if len(data) != gotWidth*gotHeight {
		return nil, 0, 0, fmt.Errorf("OCR detection output has %d values for a %dx%d map", len(data), gotWidth, gotHeight)
	}
	for _, value := range data {
		if value < 0 || value > 1 {
			return nil, 0, 0, errors.New("OCR detection output is not a 0..1 probability map; export the inference graph with sigmoid")
		}
	}
	return data, gotWidth, gotHeight, nil
}

func (e *ocrOnnxEngine) recognize(ctx context.Context, bitmap OCRBitmap) (string, float64, error) {
	tensor := ocrRecTensor(bitmap)
	shape := ort.NewShape(1, 3, int64(bitmap.Height), int64(bitmap.Width))
	input, err := ort.NewTensor(shape, tensor)
	if err != nil {
		return "", 0, fmt.Errorf("create OCR recognition tensor: %w", err)
	}
	defer input.Destroy()
	outputs := []ort.Value{nil}
	if err := ocrRunSession(ctx, e.recognition, []ort.Value{input}, outputs); err != nil {
		return "", 0, err
	}
	defer outputs[0].Destroy()
	output, ok := outputs[0].(*ort.Tensor[float32])
	if !ok {
		return "", 0, errors.New("OCR recognition model returned a non-float32 tensor")
	}
	data := output.GetData()
	gotShape := output.GetShape()
	if len(gotShape) != 3 || gotShape[0] != 1 {
		return "", 0, fmt.Errorf("OCR recognition output shape %v is not (1,steps,classes)", gotShape)
	}
	steps := int(gotShape[1])
	classes := int(gotShape[2])
	if classes != len(e.dictionary) {
		return "", 0, fmt.Errorf("OCR recognition model has %d classes but the admitted dictionary has %d entries", classes, len(e.dictionary))
	}
	if len(data) < steps*classes {
		return "", 0, fmt.Errorf("OCR recognition output has %d values for %d steps and %d classes", len(data), steps, classes)
	}
	text, confidence, err := ocrCTCDecode(data, steps, classes, e.dictionary)
	if err != nil {
		return "", 0, fmt.Errorf("decode OCR recognition probabilities: %w", err)
	}
	return strings.TrimSpace(text), confidence, nil
}

// ocrRunSession runs one session under the caller's deadline. A cancelled
// caller terminates the native run instead of waiting for it.
func ocrRunSession(ctx context.Context, session *ort.DynamicAdvancedSession, inputs, outputs []ort.Value) error {
	options, err := ort.NewRunOptions()
	if err != nil {
		return fmt.Errorf("create OCR run options: %w", err)
	}
	done := make(chan struct{})
	watcher := make(chan struct{})
	go func() {
		defer close(watcher)
		select {
		case <-ctx.Done():
			_ = options.Terminate()
		case <-done:
		}
	}()
	runErr := session.RunWithOptions(inputs, outputs, options)
	close(done)
	<-watcher
	destroyErr := options.Destroy()
	if err := ctx.Err(); err != nil {
		return err
	}
	if runErr != nil {
		return fmt.Errorf("%w: %v", ErrOCREngineFailed, runErr)
	}
	if destroyErr != nil {
		return fmt.Errorf("%w: destroy OCR run options: %v", ErrOCREngineFailed, destroyErr)
	}
	return nil
}
