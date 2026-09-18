//go:build cgo && (darwin || linux)

package processor

import (
	"context"
	"errors"
	"fmt"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

// Native image tower sessions. The two graphs are admitted separately and are
// validated by name, rank, and declared dimension before any inference runs;
// a combined graph, a different output name, or a different projection width
// fails admission with a reason instead of silently producing wrong vectors.
const (
	imageVisionInputName  = "pixel_values"
	imageVisionOutputName = "image_embeds"
	imageTextOutputName   = "text_embeds"
	// The text tower must consume the tokens and their attention mask: without
	// the mask the padded positions would pollute the embedding, which is a
	// correctness problem rather than a compatibility one. Token type ids are
	// optional, because the admitted CLIP-family exports differ on whether the
	// text tower declares them at all.
	imageTextRequiredInputName = "input_ids"
	imageTextMaskInputName     = "attention_mask"
	imageTextOptionalInputName = "token_type_ids"
)

type onnxImageTowerRunner struct {
	textHasTokenTypes bool
	mu                sync.Mutex
	vision            *ort.DynamicAdvancedSession
	text              *ort.DynamicAdvancedSession
	dimension         int
	imageSize         int
	closed            bool
}

func newImageTowerRunner(ctx context.Context, assets imageTowerAssets) (imageTowerRunner, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrImageTowerUnavailable, err)
	}
	if assets.dimension <= 0 || assets.imageSize <= 0 {
		return nil, fmt.Errorf("%w: image runtime requires a declared dimension and image size", ErrImageTowerUnavailable)
	}
	if err := acquireORTEnvironment(assets.runtimeBytes, assets.runtimeDigest, assets.runtimeVersion); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrImageTowerUnavailable, err)
	}
	cleanup := func() { _ = releaseORTEnvironment() }
	if err := validateImageVisionModelInfo(assets.visionBytes, assets.imageSize, assets.dimension); err != nil {
		cleanup()
		return nil, fmt.Errorf("%w: %v", ErrImageTowerUnavailable, err)
	}
	if err := validateImageTextModelInfo(assets.textBytes, assets.dimension); err != nil {
		cleanup()
		return nil, fmt.Errorf("%w: %v", ErrImageTowerUnavailable, err)
	}
	if err := ctx.Err(); err != nil {
		cleanup()
		return nil, fmt.Errorf("%w: %v", ErrImageTowerUnavailable, err)
	}
	vision, err := ort.NewDynamicAdvancedSessionWithONNXData(assets.visionBytes,
		[]string{imageVisionInputName}, []string{imageVisionOutputName}, nil)
	if err != nil {
		cleanup()
		return nil, fmt.Errorf("%w: create vision session: %v", ErrImageTowerUnavailable, err)
	}
	textInputs, err := imageTextSessionInputs(assets.textBytes)
	if err != nil {
		_ = vision.Destroy()
		cleanup()
		return nil, fmt.Errorf("%w: %v", ErrImageTowerUnavailable, err)
	}
	text, err := ort.NewDynamicAdvancedSessionWithONNXData(assets.textBytes,
		textInputs, []string{imageTextOutputName}, nil)
	if err != nil {
		_ = vision.Destroy()
		cleanup()
		return nil, fmt.Errorf("%w: create text tower session: %v", ErrImageTowerUnavailable, err)
	}
	hasTokenTypes := false
	for _, name := range textInputs {
		if name == imageTextOptionalInputName {
			hasTokenTypes = true
		}
	}
	return &onnxImageTowerRunner{
		vision: vision, text: text, dimension: assets.dimension, imageSize: assets.imageSize,
		textHasTokenTypes: hasTokenTypes,
	}, nil
}

// imageTextSessionInputs returns the admitted text inputs in the order the model
// declares them, so a tower without token type ids binds a two-input session
// while a tower that declares them keeps the three-input one.
func imageTextSessionInputs(model []byte) ([]string, error) {
	inputs, _, err := ort.GetInputOutputInfoWithONNXData(model)
	if err != nil {
		return nil, fmt.Errorf("inspect admitted text model: %w", err)
	}
	names := make([]string, 0, len(inputs))
	for _, input := range inputs {
		switch input.Name {
		case imageTextRequiredInputName, imageTextMaskInputName, imageTextOptionalInputName:
			names = append(names, input.Name)
		default:
			return nil, fmt.Errorf("text model input %q is outside the admitted text profile", input.Name)
		}
	}
	if len(names) < 2 {
		return nil, fmt.Errorf("text model must consume %s and %s, got %v", imageTextRequiredInputName, imageTextMaskInputName, names)
	}
	return names, nil
}

func inputNames(inputs []ort.InputOutputInfo) []string {
	names := make([]string, 0, len(inputs))
	for _, input := range inputs {
		names = append(names, input.Name)
	}
	return names
}

func validateImageVisionModelInfo(model []byte, imageSize, dimension int) error {
	inputs, outputs, err := ort.GetInputOutputInfoWithONNXData(model)
	if err != nil {
		return fmt.Errorf("inspect admitted vision model: %w", err)
	}
	if len(inputs) != 1 || inputs[0].Name != imageVisionInputName || inputs[0].OrtValueType != ort.ONNXTypeTensor ||
		inputs[0].DataType != ort.TensorElementDataTypeFloat || len(inputs[0].Dimensions) != 4 {
		return errors.New("vision model input does not match the admitted float32 rank-4 pixel profile")
	}
	// A symbolic dimension (0 or negative) means the export did not pin that
	// axis, which is fine: this host always feeds 3 x imageSize x imageSize from
	// its declared preprocessing profile. A pinned dimension that disagrees is
	// still refused, because that model was built for different input.
	dims := inputs[0].Dimensions
	if (dims[1] > 0 && dims[1] != 3) || (dims[2] > 0 && dims[2] != int64(imageSize)) || (dims[3] > 0 && dims[3] != int64(imageSize)) {
		return fmt.Errorf("vision model input shape %v does not match 3x%dx%d", dims, imageSize, imageSize)
	}
	if len(outputs) != 1 || outputs[0].Name != imageVisionOutputName || outputs[0].OrtValueType != ort.ONNXTypeTensor ||
		outputs[0].DataType != ort.TensorElementDataTypeFloat || len(outputs[0].Dimensions) != 2 ||
		outputs[0].Dimensions[1] != int64(dimension) {
		return errors.New("vision model output does not match the admitted projected-image-embedding profile")
	}
	return nil
}

func validateImageTextModelInfo(model []byte, dimension int) error {
	inputs, outputs, err := ort.GetInputOutputInfoWithONNXData(model)
	if err != nil {
		return fmt.Errorf("inspect admitted text model: %w", err)
	}
	want := map[string]bool{
		imageTextRequiredInputName: false,
		imageTextMaskInputName:     false,
		imageTextOptionalInputName: false,
	}
	for _, input := range inputs {
		seen, ok := want[input.Name]
		if !ok || seen || input.OrtValueType != ort.ONNXTypeTensor || input.DataType != ort.TensorElementDataTypeInt64 || len(input.Dimensions) != 2 {
			return fmt.Errorf("text model input %q does not match the admitted int64 rank-2 profile", input.Name)
		}
		want[input.Name] = true
	}
	if !want[imageTextRequiredInputName] || !want[imageTextMaskInputName] {
		return fmt.Errorf("text model must consume %s and %s, got %v", imageTextRequiredInputName, imageTextMaskInputName, inputNames(inputs))
	}
	if len(outputs) != 1 || outputs[0].Name != imageTextOutputName || outputs[0].OrtValueType != ort.ONNXTypeTensor ||
		outputs[0].DataType != ort.TensorElementDataTypeFloat || len(outputs[0].Dimensions) != 2 ||
		outputs[0].Dimensions[1] != int64(dimension) {
		return errors.New("text model output does not match the admitted projected-text-embedding profile")
	}
	return nil
}

func (r *onnxImageTowerRunner) RunVision(ctx context.Context, pixels []float32, batch int) ([]float32, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.vision == nil {
		return nil, errors.New("vision session is closed")
	}
	if batch <= 0 || len(pixels) != batch*3*r.imageSize*r.imageSize {
		return nil, fmt.Errorf("vision input has %d values, want %d", len(pixels), batch*3*r.imageSize*r.imageSize)
	}
	shape := ort.NewShape(int64(batch), 3, int64(r.imageSize), int64(r.imageSize))
	input, err := ort.NewTensor(shape, pixels)
	if err != nil {
		return nil, fmt.Errorf("create pixel_values tensor: %w", err)
	}
	defer input.Destroy()
	outputs := []ort.Value{nil}
	if err := runImageSession(ctx, r.vision, []ort.Value{input}, outputs); err != nil {
		return nil, err
	}
	if outputs[0] != nil {
		defer outputs[0].Destroy()
	}
	tensor, ok := outputs[0].(*ort.Tensor[float32])
	if !ok {
		return nil, errors.New("vision model returned a non-float32 tensor")
	}
	gotShape := tensor.GetShape()
	if len(gotShape) != 2 || gotShape[0] != int64(batch) || gotShape[1] != int64(r.dimension) {
		return nil, fmt.Errorf("vision model output shape %v does not match [%d,%d]", gotShape, batch, r.dimension)
	}
	data := tensor.GetData()
	if len(data) != batch*r.dimension {
		return nil, fmt.Errorf("vision model output has %d elements, want %d", len(data), batch*r.dimension)
	}
	return append([]float32(nil), data...), nil
}

func (r *onnxImageTowerRunner) RunText(ctx context.Context, ids, attention, tokenTypes []int64) ([]float32, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.text == nil {
		return nil, errors.New("text tower session is closed")
	}
	if len(ids) == 0 || len(ids) != len(attention) {
		return nil, errors.New("text tower inputs are inconsistent")
	}
	if r.textHasTokenTypes && len(ids) != len(tokenTypes) {
		return nil, errors.New("text tower inputs are inconsistent")
	}
	shape := ort.NewShape(1, int64(len(ids)))
	inputIDs, err := ort.NewTensor(shape, ids)
	if err != nil {
		return nil, fmt.Errorf("create input_ids tensor: %w", err)
	}
	defer inputIDs.Destroy()
	mask, err := ort.NewTensor(shape, attention)
	if err != nil {
		return nil, fmt.Errorf("create attention_mask tensor: %w", err)
	}
	defer mask.Destroy()
	feeds := []ort.Value{inputIDs, mask}
	if r.textHasTokenTypes {
		types, err := ort.NewTensor(shape, tokenTypes)
		if err != nil {
			return nil, fmt.Errorf("create token_type_ids tensor: %w", err)
		}
		defer types.Destroy()
		feeds = append(feeds, types)
	}
	outputs := []ort.Value{nil}
	if err := runImageSession(ctx, r.text, feeds, outputs); err != nil {
		return nil, err
	}
	if outputs[0] != nil {
		defer outputs[0].Destroy()
	}
	tensor, ok := outputs[0].(*ort.Tensor[float32])
	if !ok {
		return nil, errors.New("text tower returned a non-float32 tensor")
	}
	gotShape := tensor.GetShape()
	if len(gotShape) != 2 || gotShape[0] != 1 || gotShape[1] != int64(r.dimension) {
		return nil, fmt.Errorf("text tower output shape %v does not match [1,%d]", gotShape, r.dimension)
	}
	data := tensor.GetData()
	if len(data) != r.dimension {
		return nil, fmt.Errorf("text tower output has %d elements, want %d", len(data), r.dimension)
	}
	return append([]float32(nil), data...), nil
}

func runImageSession(ctx context.Context, session *ort.DynamicAdvancedSession, inputs, outputs []ort.Value) error {
	runOptions, err := ort.NewRunOptions()
	if err != nil {
		return fmt.Errorf("create ONNX run options: %w", err)
	}
	runDone := make(chan struct{})
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		select {
		case <-ctx.Done():
			_ = runOptions.Terminate()
		case <-runDone:
		}
	}()
	runErr := session.RunWithOptions(inputs, outputs, runOptions)
	close(runDone)
	<-watchDone
	destroyOptionsErr := runOptions.Destroy()
	if err := ctx.Err(); err != nil {
		return err
	}
	if runErr != nil {
		return fmt.Errorf("run admitted ONNX graph: %w", runErr)
	}
	if destroyOptionsErr != nil {
		return fmt.Errorf("destroy ONNX run options: %w", destroyOptionsErr)
	}
	return nil
}

func (r *onnxImageTowerRunner) Probe(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	// A deterministic, bounded probe: one synthetic image tensor and the
	// two-special-token text sequence. Both towers must answer with a finite
	// vector of the declared dimension before the provider may report READY.
	pixels := make([]float32, 3*r.imageSize*r.imageSize)
	for i := range pixels {
		pixels[i] = float32(i%17) / 17.0
	}
	if _, err := r.RunVision(ctx, pixels, 1); err != nil {
		return err
	}
	ids := []int64{101, 102}
	attention := []int64{1, 1}
	types := []int64{0, 0}
	if _, err := r.RunText(ctx, ids, attention, types); err != nil {
		return err
	}
	return nil
}

func (r *onnxImageTowerRunner) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil
	}
	r.closed = true
	var errs []error
	if r.vision != nil {
		errs = append(errs, r.vision.Destroy())
		r.vision = nil
	}
	if r.text != nil {
		errs = append(errs, r.text.Destroy())
		r.text = nil
	}
	errs = append(errs, releaseORTEnvironment())
	return errors.Join(errs...)
}
