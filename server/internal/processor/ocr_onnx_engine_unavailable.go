//go:build !cgo || (!darwin && !linux)

package processor

import "errors"

// newOCROnnxEngine is the honest non-cgo outcome: in-process ONNX Runtime
// execution requires a supported host, so OCR reports unavailable with the
// reason instead of pretending to recognize text. The ONNX Go binding is not
// imported here because it is cgo-only.
func newOCROnnxEngine(OCRBundleAdmission) (OCREngine, error) {
	return nil, errors.New("in-process ONNX Runtime requires a cgo host on darwin or linux")
}
