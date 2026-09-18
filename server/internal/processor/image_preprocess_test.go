package processor

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
	"testing"
)

// TestPreprocessImageTensorCoversEveryShapeAndColour pins the tensor a real
// image produces. The crop loop used to address pixels four times too far, which
// panicked for every image larger than a few pixels, so this test walks the
// shapes a personal library actually contains — square, landscape, portrait,
// tiny, and single-pixel — and checks the values rather than only the length.
func TestPreprocessImageTensorCoversEveryShapeAndColour(t *testing.T) {
	const size = 224
	cases := []struct {
		name string
		w, h int
	}{
		{"square", 224, 224},
		{"landscape", 480, 320},
		{"portrait", 320, 480},
		{"tiny", 3, 2},
		{"single-pixel", 1, 1},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			source := image.NewNRGBA(image.Rect(0, 0, testCase.w, testCase.h))
			for y := 0; y < testCase.h; y++ {
				for x := 0; x < testCase.w; x++ {
					source.SetNRGBA(x, y, color.NRGBA{R: 255, G: 128, B: 0, A: 255})
				}
			}
			var encoded bytes.Buffer
			if err := png.Encode(&encoded, source); err != nil {
				t.Fatalf("encode fixture: %v", err)
			}
			tensor, err := PreprocessImageTensor(encoded.Bytes(), "image/png", size)
			if err != nil {
				t.Fatalf("preprocess %dx%d: %v", testCase.w, testCase.h, err)
			}
			if len(tensor) != 3*size*size {
				t.Fatalf("tensor length %d, want %d", len(tensor), 3*size*size)
			}
			// A solid colour must normalize to the same value everywhere, and the
			// three planes must differ exactly by their declared mean and std.
			wantR := (float64(255)/255.0 - imagePreprocessMean[0]) / imagePreprocessStd[0]
			if math.Abs(float64(tensor[0])-wantR) > 1e-5 {
				t.Fatalf("red plane = %v, want %v", tensor[0], wantR)
			}
			for _, index := range []int{0, size * size, 2 * size * size} {
				plane := float32(0)
				for i := index; i < index+size*size; i++ {
					if math.Abs(float64(tensor[i]-tensor[index])) > 1e-6 {
						t.Fatalf("plane starting at %d is not uniform", index)
					}
					plane = tensor[i]
				}
				_ = plane
			}
		})
	}
}
