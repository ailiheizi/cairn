package processor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"

	"github.com/ailiheizi/cairn/server/internal/search"
)

// ImageTextTokenizerProfileID is the admitted tokenizer profile identity for
// the image model's text tower. It is a declared fact, not a default: a
// different tokenizer family requires a new profile constant, a new descriptor,
// and therefore a new space fingerprint.
const ImageTextTokenizerProfileID = "clip-roberta-wwm-wordpiece-v1"

const (
	imageTextTokenizerVocabSize         = 21128
	imageTextTokenizerMaxCharsPerWord   = 100
	imageTextTokenizerContinuingPrefix  = "##"
	imageTextTokenizerMaxTokensPerInput = 512
)

// imageTowerAssets are the admitted bytes one image runtime needs.
type imageTowerAssets struct {
	runtimeBytes   []byte
	runtimeVersion string
	runtimeDigest  string
	visionBytes    []byte
	textBytes      []byte
	tokenizerBytes []byte
	dimension      int
	imageSize      int
}

// imageTowerRunner is the narrow, replaceable execution boundary for the two
// admitted ONNX graphs. A runner either answers both towers or fails closed; it
// has no catalog, repository, or index authority.
type imageTowerRunner interface {
	// RunVision returns batch*dimension float32 values in row-major order.
	RunVision(ctx context.Context, pixels []float32, batch int) ([]float32, error)
	// RunText returns one dimension-length float32 vector.
	RunText(ctx context.Context, ids, attention, tokenTypes []int64) ([]float32, error)
	// Probe executes both towers once with bounded synthetic input.
	Probe(ctx context.Context) error
	Close() error
}

// ImageEmbeddingProviderOptions carries the explicit host bindings for one
// image provider. ConfigDigest is required: a generation manifest without it
// has no host binding.
type ImageEmbeddingProviderOptions struct {
	ConfigDigest string
}

// ErrImageTowerUnavailable is returned when the image runtime, its admitted
// assets, or its readiness probe cannot establish a runnable provider. The
// caller reports UNAVAILABLE with the returned reason; exact save, lexical
// search, and every other dimension remain usable.
var ErrImageTowerUnavailable = errors.New("image tower runtime unavailable")

// ChineseCLIPImageEmbeddingProvider adapts one content-addressed image bundle
// to the narrow image embedding contract. The provider owns no catalog,
// repository, or index authority: it receives admitted image bytes or durable
// query text and returns validated vectors carrying the space fingerprint and
// provider digest they were produced under.
type ChineseCLIPImageEmbeddingProvider struct {
	admission   search.ImageBundleAdmission
	manifest    search.EmbeddingGenerationManifest
	fingerprint search.ImageSpaceFingerprint
	runner      imageTowerRunner
	tokenizer   *bertTokenizer

	mu     sync.RWMutex
	closed bool
	state  search.ImageProviderReport
}

// NewChineseCLIPImageEmbeddingProvider admits one installed image bundle,
// loads its runtime and tokenizer bytes, and proves both towers with a
// readiness probe. A missing or unrunnable artifact returns an error that the
// caller reports as UNAVAILABLE; it never returns a partially ready provider.
func NewChineseCLIPImageEmbeddingProvider(ctx context.Context, admission search.ImageBundleAdmission, options ImageEmbeddingProviderOptions) (*ChineseCLIPImageEmbeddingProvider, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := admission.Validate(); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrImageTowerUnavailable, err)
	}
	if strings.TrimSpace(options.ConfigDigest) == "" {
		return nil, fmt.Errorf("%w: config digest is required", ErrImageTowerUnavailable)
	}
	manifest, err := admission.EmbeddingGenerationManifest(options.ConfigDigest)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrImageTowerUnavailable, err)
	}
	fingerprint := admission.Fingerprint()
	if err := search.ValidateImageGenerationManifest(manifest, fingerprint); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrImageTowerUnavailable, err)
	}
	runtimeBytes, err := search.ReadImageBundleAsset(ctx, admission.Root, admission, "runtime")
	if err != nil {
		return nil, fmt.Errorf("%w: runtime asset: %v", ErrImageTowerUnavailable, err)
	}
	visionBytes, err := search.ReadImageBundleAsset(ctx, admission.Root, admission, "vision")
	if err != nil {
		return nil, fmt.Errorf("%w: vision asset: %v", ErrImageTowerUnavailable, err)
	}
	textBytes, err := search.ReadImageBundleAsset(ctx, admission.Root, admission, "text")
	if err != nil {
		return nil, fmt.Errorf("%w: text asset: %v", ErrImageTowerUnavailable, err)
	}
	tokenizerBytes, err := search.ReadImageBundleAsset(ctx, admission.Root, admission, "tokenizer")
	if err != nil {
		return nil, fmt.Errorf("%w: tokenizer asset: %v", ErrImageTowerUnavailable, err)
	}
	tokenizer, err := loadClipTextTokenizer(tokenizerBytes, admission.Descriptor.MaxTokens)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrImageTowerUnavailable, err)
	}
	runner, err := newImageTowerRunner(ctx, imageTowerAssets{
		runtimeBytes: runtimeBytes, runtimeVersion: admission.Descriptor.RuntimeVersion,
		runtimeDigest: "sha256:" + admission.AssetDigests["runtime"],
		visionBytes:   visionBytes, textBytes: textBytes, tokenizerBytes: tokenizerBytes,
		dimension: fingerprint.Dimension, imageSize: admission.Descriptor.ImageSize,
	})
	if err != nil {
		return nil, err
	}
	provider := &ChineseCLIPImageEmbeddingProvider{
		admission: admission, manifest: manifest, fingerprint: fingerprint,
		runner: runner, tokenizer: tokenizer,
	}
	probeCtx := ctx
	if err := runner.Probe(probeCtx); err != nil {
		_ = runner.Close()
		return nil, fmt.Errorf("%w: readiness probe: %v", ErrImageTowerUnavailable, err)
	}
	provider.state = search.ImageProviderReport{
		State:          search.ImageProviderReady,
		Artifact:       admission.Descriptor.ModelID + "@" + admission.Descriptor.ModelRevision,
		ProviderDigest: manifest.ProviderDigest,
		Fingerprint:    fingerprint,
	}
	return provider, nil
}

// ImageProviderReport returns the provider's honest readiness report.
func (p *ChineseCLIPImageEmbeddingProvider) ImageProviderReport() search.ImageProviderReport {
	if p == nil {
		return search.ImageProviderReport{State: search.ImageProviderNotBuilt, Reason: search.MultimodalIndexNotBuiltReason}
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	report := p.state
	if p.closed || p.runner == nil {
		report.State = search.ImageProviderUnavailable
		report.Reason = "image provider is closed"
	}
	return report
}

// Manifest returns the immutable generation manifest for this provider.
func (p *ChineseCLIPImageEmbeddingProvider) Manifest() search.EmbeddingGenerationManifest {
	if p == nil {
		return search.EmbeddingGenerationManifest{}
	}
	return p.manifest
}

// EmbedImages executes one bounded request. Query text goes through the image
// model's own text tower; image bytes are decoded and resized by the pinned
// preprocessing profile. Any failure fails the whole call so a partial vector
// set can never create or query a generation.
func (p *ChineseCLIPImageEmbeddingProvider) EmbedImages(ctx context.Context, req search.ImageEmbeddingRequest) ([]search.ImageEmbeddingVector, error) {
	if p == nil {
		return nil, search.ErrImageProviderUnavailable
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("%w: %v", search.ErrImageProviderUnavailable, err)
	}
	p.mu.RLock()
	closed := p.closed
	p.mu.RUnlock()
	if closed || p.runner == nil {
		return nil, fmt.Errorf("%w: image provider is closed", search.ErrImageProviderUnavailable)
	}
	if err := search.ValidateImageEmbeddingRequest(req); err != nil {
		return nil, err
	}
	if req.Manifest != p.manifest {
		return nil, fmt.Errorf("%w: manifest does not match the admitted image bundle", search.ErrImageProviderUnavailable)
	}
	if req.Fingerprint != p.fingerprint {
		return nil, fmt.Errorf("%w: %s", search.ErrImageSpaceFingerprintMismatch, search.MultimodalSpaceMismatchReason)
	}
	results := make([]search.ImageEmbeddingVector, 0, len(req.Inputs))
	for _, input := range req.Inputs {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		var vector []float32
		var err error
		switch req.Purpose {
		case search.ImageEmbeddingImage:
			tensor, preprocessErr := PreprocessImageTensor(input.ImageBytes, input.MediaType, p.admission.Descriptor.ImageSize)
			if preprocessErr != nil {
				return nil, fmt.Errorf("%w: %v", search.ErrImageProviderUnavailable, preprocessErr)
			}
			vector, err = p.runner.RunVision(ctx, tensor, 1)
		case search.ImageEmbeddingText:
			encoded, encodeErr := p.tokenizer.encode(p.fingerprint.QueryInstruction + input.Text)
			if encodeErr != nil {
				return nil, fmt.Errorf("%w: %v", search.ErrImageProviderUnavailable, encodeErr)
			}
			vector, err = p.runner.RunText(ctx, encoded.ids, encoded.attention, encoded.tokenTypes)
		default:
			return nil, fmt.Errorf("%w: unknown purpose", search.ErrImageProviderUnavailable)
		}
		if err != nil {
			return nil, fmt.Errorf("%w: %v", search.ErrImageProviderUnavailable, err)
		}
		if len(vector) != p.fingerprint.Dimension {
			return nil, fmt.Errorf("%w: runtime returned dimension %d, want %d", search.ErrImageProviderUnavailable, len(vector), p.fingerprint.Dimension)
		}
		normalized, err := l2NormalizeImageVector(vector)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", search.ErrImageProviderUnavailable, err)
		}
		results = append(results, search.ImageEmbeddingVector{
			SubjectID: input.SubjectID, SegmentID: input.SegmentID,
			SpaceFingerprint: p.fingerprint.CanonicalDigest(), ProviderDigest: p.manifest.ProviderDigest,
			Vector: normalized,
		})
	}
	if err := search.ValidateImageEmbeddingResults(req, results); err != nil {
		return nil, err
	}
	return results, nil
}

// Close releases the native sessions. It is idempotent and never modifies
// bundle assets or durable state.
func (p *ChineseCLIPImageEmbeddingProvider) Close() error {
	if p == nil {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil
	}
	p.closed = true
	if p.runner == nil {
		return nil
	}
	err := p.runner.Close()
	p.runner = nil
	if err != nil {
		return fmt.Errorf("close image provider: %w", err)
	}
	return nil
}

func l2NormalizeImageVector(vector []float32) ([]float32, error) {
	var squared float64
	for _, value := range vector {
		if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
			return nil, fmt.Errorf("runtime returned a non-finite value")
		}
		squared += float64(value) * float64(value)
	}
	norm := math.Sqrt(squared)
	if norm == 0 || math.IsNaN(norm) || math.IsInf(norm, 0) {
		return nil, fmt.Errorf("runtime returned a zero-norm vector")
	}
	out := make([]float32, len(vector))
	for i, value := range vector {
		out[i] = float32(float64(value) / norm)
	}
	return out, nil
}

// spaceFingerprintDigest is a stable digest of the declared fingerprint facts,
// used in provider diagnostics. It is not the generation identity; the
// fingerprint's own CanonicalDigest is.
func spaceFingerprintDigest(fingerprint search.ImageSpaceFingerprint) string {
	payload, _ := json.Marshal(fingerprint)
	sum := sha256.Sum256(append([]byte("cairn.image-space.diagnostic.v1\n"), payload...))
	return "sha256:" + hex.EncodeToString(sum[:])
}
