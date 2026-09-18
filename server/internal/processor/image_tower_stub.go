//go:build !cgo || (!darwin && !linux)

package processor

import (
	"context"
	"fmt"
)

// newImageTowerRunner reports typed unavailability on hosts without the
// pinned cgo ONNX Runtime. The image dimension stays UNAVAILABLE with this
// reason; it is never silently replaced by a fixture or by the text model.
func newImageTowerRunner(ctx context.Context, assets imageTowerAssets) (imageTowerRunner, error) {
	return nil, fmt.Errorf("%w: the image embedding runtime requires a supported cgo host", ErrImageTowerUnavailable)
}
