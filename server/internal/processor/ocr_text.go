package processor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strings"
	"sync"
	"time"
)

// OCRImageText is the optional ocr.image.text.v1 EXTRACT processor: text
// inside images. It is a learned, operator-installed capability and is never
// part of the bundled byte-deterministic extract pack, so a missing engine
// cannot block exact preservation.
//
// Artifact body (schema restoreweave.artifact.ocr-text.v1, application/json):
// the recognized text, per-region boxes and confidences, the source image's
// exact identity (content_id and the logical length of the bytes actually
// read), the engine/runtime/model/dictionary digests, the declared language
// coverage, and a recognition digest over the canonical payload. The host
// additionally seals the exact body bytes and records their SHA-256 as the
// artifact digest (ProcessorArtifact.Digest), independent of anything the
// processor writes.
//
// The recognized plain text reaches lexical and semantic discovery through the
// existing indexer, which already feeds every admitted EXTRACT-stage UTF-8
// body into the Extracted and segment axes. No second index, second store, or
// new embedding dimension is created here.
type OCRImageText struct {
	bundleRoot string

	mu      sync.Mutex
	engine  OCREngine
	loadErr error

	// explicitEngine is the test seam for engines that are not constructed
	// from an operator bundle. It is unreachable from configuration.
	explicitEngine OCREngine
	// maxPixels overrides the default pixel ceiling so a test can exercise the
	// bound without allocating a huge bitmap.
	maxPixels int64
	// timeout overrides OCRStageTimeout so a test can prove bounded
	// cancellation without waiting for the full ceiling.
	timeout time.Duration
}

// NewOCRImageText returns the OCR processor for one operator-installed bundle
// root. The capability is registered even when the bundle is absent so that
// capability.list and per-subject processing state report NOT_BUILT with the
// expected path instead of hiding the capability.
func NewOCRImageText(bundleRoot string) *OCRImageText {
	return &OCRImageText{
		bundleRoot: strings.TrimSpace(bundleRoot),
		maxPixels:  OCRMaxPixels,
		timeout:    OCRStageTimeout,
	}
}

func (*OCRImageText) CapabilityID() string { return CapabilityOCRImageText }

// ProcessingBudget: recognition reads a real screenshot or scan rather than a
// text-sized file, and runs detection plus recognition, so it asks for the media
// budget instead of the host's text defaults.
func (*OCRImageText) ProcessingBudget() CapabilityBudget {
	return CapabilityBudget{MaxSourceBytes: mediaMaxSourceBytes, StageTimeout: mediaStageTimeout}
}
func (*OCRImageText) Stage() Stage { return StageExtract }

// Close releases a lazily created native engine. A host that keeps the
// processor for the process lifetime may call it during shutdown.
func (p *OCRImageText) Close() error {
	if p == nil {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.engine == nil {
		return nil
	}
	var err error
	if closer, ok := p.engine.(interface{ Close() error }); ok {
		err = closer.Close()
	}
	p.engine = nil
	return err
}

// Artifact states and stable reason markers. They are the operator-visible
// vocabulary; a low-confidence or partially readable result is never reported
// as a clean one.
const (
	OCRArtifactStateText    = "TEXT"
	OCRArtifactStateEmpty   = "EMPTY"
	OCRArtifactStatePartial = "PARTIAL"

	OCRReasonLowConfidenceRegion = "LOW_CONFIDENCE_REGION"
	OCRReasonEmptyRegion         = "EMPTY_REGION"
	OCRReasonNoTextRegions       = "NO_TEXT_REGIONS"
	OCRReasonRegionLimit         = "REGION_LIMIT_REACHED"
	OCRReasonTextLimit           = "TEXT_LIMIT_REACHED"
	OCRReasonTimeout             = "OCR_TIMEOUT"
	OCRReasonInputBound          = "OCR_INPUT_BOUND_EXCEEDED"
	OCRReasonBundleNotBuilt      = "OCR_BUNDLE_NOT_BUILT"
	OCRReasonBundleUnavailable   = "OCR_BUNDLE_UNAVAILABLE"
	OCRReasonEngineUnavailable   = "OCR_ENGINE_UNAVAILABLE"
	OCRReasonUnsupportedEncoding = "OCR_UNSUPPORTED_ENCODING"
	OCRReasonDecodeFailed        = "OCR_DECODE_FAILED"
)

// ocrArtifact is the canonical artifact payload. Field order and the absence
// of maps are part of the canonical form used by the recognition digest.
type ocrArtifact struct {
	Schema            string              `json:"schema"`
	State             string              `json:"state"`
	Text              string              `json:"text"`
	Source            ocrArtifactSource   `json:"source"`
	Engine            ocrArtifactEngine   `json:"engine"`
	Regions           []ocrArtifactRegion `json:"regions"`
	Quality           ocrArtifactQuality  `json:"quality"`
	RecognitionDigest string              `json:"recognition_digest"`
}

type ocrArtifactSource struct {
	ContentID string `json:"content_id"`
	// LogicalLength is the byte length of the exact source object this attempt
	// read. A host-budget truncation is visible in the quality block instead of
	// being silently accepted as the whole image.
	LogicalLength int64  `json:"logical_length"`
	Encoding      string `json:"encoding"`
	Width         int    `json:"width"`
	Height        int    `json:"height"`
	DigestBasis   string `json:"digest_basis"`
}

type ocrArtifactEngine struct {
	EngineID      string `json:"engine_id"`
	EngineVersion string `json:"engine_version"`
	EngineBuild   string `json:"engine_build,omitempty"`
	EngineSource  string `json:"engine_source,omitempty"`
	EngineLicense string `json:"engine_license,omitempty"`

	Runtime        string `json:"runtime"`
	RuntimeVersion string `json:"runtime_version"`
	RuntimeDigest  string `json:"runtime_digest,omitempty"`

	ProfileDigest       string `json:"profile_digest"`
	PreprocessingDigest string `json:"preprocessing_digest"`
	ModelID             string `json:"model_id,omitempty"`
	ModelRevision       string `json:"model_revision,omitempty"`
	ModelLicenseID      string `json:"model_license_id,omitempty"`

	Assets []OCRAssetPin `json:"assets,omitempty"`

	Languages           []string `json:"languages"`
	LanguageNotes       string   `json:"language_notes,omitempty"`
	LanguageScope       string   `json:"language_scope"`
	DictionaryFormat    string   `json:"dictionary_format,omitempty"`
	AngleClassification string   `json:"angle_classification"`
	Stages              []string `json:"stages,omitempty"`

	DeterminismClass string `json:"determinism_class"`
	DeterminismNotes string `json:"determinism_notes,omitempty"`
}

type ocrArtifactRegion struct {
	Ordinal       int     `json:"ordinal"`
	Text          string  `json:"text"`
	Confidence    float64 `json:"confidence"`
	BoxConfidence float64 `json:"box_confidence"`
	Box           OCRBox  `json:"box"`
	Rotated       bool    `json:"rotated,omitempty"`
	LowConfidence bool    `json:"low_confidence,omitempty"`
}

type ocrArtifactQuality struct {
	RegionCount            int      `json:"region_count"`
	MinConfidence          float64  `json:"min_confidence"`
	MeanConfidence         float64  `json:"mean_confidence"`
	LowConfidenceThreshold float64  `json:"low_confidence_threshold"`
	LowConfidenceRegions   int      `json:"low_confidence_regions"`
	EmptyRegions           int      `json:"empty_regions"`
	Truncated              bool     `json:"truncated"`
	Reasons                []string `json:"reasons,omitempty"`
	MaxPixels              int64    `json:"max_pixels"`
	MaxRegions             int      `json:"max_regions"`
	MaxTextBytes           int      `json:"max_text_bytes"`
	SourceBudgetBytes      int64    `json:"source_budget_bytes,omitempty"`
}

// RunStage implements the Processor contract.
func (p *OCRImageText) RunStage(ctx context.Context, inv Invocation) (StageResult, error) {
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
		return StageResult{Status: StatusInapplicable, Reason: "source image has no readable bytes"}, nil
	}
	timeout := OCRStageTimeout
	if p != nil && p.timeout > 0 {
		timeout = p.timeout
	}
	runCtx, cancel, timeoutReason := ocrEffectiveDeadline(ctx, timeout)
	defer cancel()

	// Resource bounds first: the header is inspected before any full decode so
	// a pathological image cannot allocate its way past the queue.
	inputBounds := OCRInputBounds{MaxPixels: OCRMaxPixels, SourceBudgetBytes: inv.MaxOutputBytes}
	if p != nil && p.maxPixels > 0 {
		inputBounds.MaxPixels = p.maxPixels
	}
	img, info, err := decodeOCRImage(body, inputBounds)
	if err != nil {
		switch {
		case errors.Is(err, ErrOCRInputBound), errors.Is(err, ErrOCRSourceBudget):
			return StageResult{Status: StatusInapplicable, Reason: OCRReasonInputBound + ": " + err.Error()}, nil
		case errors.Is(err, ErrOCRUnsupportedEncoding):
			return StageResult{Status: StatusInapplicable, Reason: OCRReasonUnsupportedEncoding + ": " + err.Error()}, nil
		default:
			return StageResult{Status: StatusFailed, Reason: OCRReasonDecodeFailed + ": " + err.Error()}, nil
		}
	}
	engine, status, reason := p.resolveEngine(runCtx)
	if engine == nil {
		if status == "" {
			status = StatusFailed
		}
		return StageResult{Status: status, Reason: reason}, nil
	}
	facts := engine.Facts()
	runBounds := ocrRunBoundsFromManifest(OCRBundleManifest{}, facts)
	result, runErr := engine.Recognize(runCtx, ocrBitmapFromImage(img), runBounds)
	if runErr != nil {
		switch {
		case errors.Is(runCtx.Err(), context.DeadlineExceeded), errors.Is(runErr, context.DeadlineExceeded):
			return StageResult{Status: StatusCancelled, Reason: OCRReasonTimeout + " (" + timeoutReason + "): " + runErr.Error()}, nil
		case errors.Is(runErr, context.Canceled):
			return StageResult{Status: StatusCancelled, Reason: OCRReasonTimeout + ": " + runErr.Error()}, nil
		default:
			return StageResult{Status: StatusFailed, Reason: OCRReasonEngineUnavailable + ": " + runErr.Error()}, nil
		}
	}
	artifact := buildOCRArtifact(inv, info, facts, runBounds, result, inputBounds)
	payload, err := json.Marshal(artifact)
	if err != nil {
		return StageResult{Status: StatusFailed, Reason: "encode OCR artifact: " + err.Error()}, nil
	}
	if _, err := inv.Staging.Write(payload); err != nil {
		return StageResult{Status: StatusFailed, Reason: err.Error()}, nil
	}
	if err := inv.Staging.Seal(); err != nil {
		return StageResult{Status: StatusFailed, Reason: err.Error()}, nil
	}
	return StageResult{
		Status:           StatusSucceeded,
		DeterminismClass: facts.DeterminismClass,
		SchemaRef:        SchemaRefOCRText(),
		MediaType:        MediaTypeOCRJSON,
		Sealed:           true,
	}, nil
}

// resolveEngine returns the cached engine, or a status and reason explaining
// why no engine is available. A missing bundle is INAPPLICABLE (an
// operator-installed optional capability is absent); a present but broken
// bundle is FAILED, because that is a defect the operator must see.
func (p *OCRImageText) resolveEngine(ctx context.Context) (OCREngine, ResultStatus, string) {
	if p == nil {
		return nil, StatusFailed, OCRReasonEngineUnavailable + ": OCR processor is nil"
	}
	if err := ctx.Err(); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, StatusCancelled, OCRReasonTimeout + ": " + err.Error()
		}
		return nil, StatusCancelled, err.Error()
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.engine != nil {
		return p.engine, "", ""
	}
	if p.explicitEngine != nil {
		p.engine = p.explicitEngine
		return p.engine, "", ""
	}
	if p.loadErr != nil {
		return nil, ocrLoadStatus(p.loadErr), ocrLoadReason(p.loadErr)
	}
	if p.bundleRoot == "" {
		p.loadErr = ErrOCRBundleNotBuilt
		return nil, StatusInapplicable, OCRReasonBundleNotBuilt + ": no OCR bundle root is configured for this host, so no operator-installed OCR profile can be found"
	}
	admission, err := LoadOCRBundle(p.bundleRoot)
	if err != nil {
		p.loadErr = err
		return nil, ocrLoadStatus(err), ocrLoadReason(err)
	}
	engine, err := newOCRBundleEngine(admission)
	if err != nil {
		p.loadErr = err
		return nil, ocrLoadStatus(err), ocrLoadReason(err)
	}
	p.engine = engine
	return p.engine, "", ""
}

func ocrLoadStatus(err error) ResultStatus {
	if errors.Is(err, ErrOCRBundleNotBuilt) {
		return StatusInapplicable
	}
	return StatusFailed
}

func ocrLoadReason(err error) string {
	switch {
	case errors.Is(err, ErrOCRBundleNotBuilt):
		return OCRReasonBundleNotBuilt + ": " + err.Error()
	case errors.Is(err, ErrOCREngineUnavailable):
		return OCRReasonEngineUnavailable + ": " + err.Error()
	default:
		return OCRReasonBundleUnavailable + ": " + err.Error()
	}
}

// buildOCRArtifact is the single place where engine output becomes durable
// artifact content.
func buildOCRArtifact(inv Invocation, info OCRImageInfo, facts OCRRunFacts, runBounds OCRRunBounds, result OCRRunResult, bounds OCRInputBounds) ocrArtifact {
	threshold := runBounds.LowConfidenceThreshold
	if threshold <= 0 {
		threshold = OCRDefaultLowConfidence
	}
	regions := make([]ocrArtifactRegion, 0, len(result.Regions))
	textParts := make([]string, 0, len(result.Regions))
	var confidenceTotal float64
	minConfidence := 0.0
	recognized := 0
	lowConfidenceRegions := 0
	emptyRegions := 0
	for _, region := range result.Regions {
		low := region.Confidence < threshold
		if low {
			lowConfidenceRegions++
		}
		if region.Text == "" {
			emptyRegions++
		} else {
			if recognized == 0 || region.Confidence < minConfidence {
				minConfidence = region.Confidence
			}
			confidenceTotal += region.Confidence
			recognized++
			textParts = append(textParts, region.Text)
		}
		regions = append(regions, ocrArtifactRegion{
			Ordinal: len(regions), Text: region.Text, Confidence: ocrRound(region.Confidence),
			BoxConfidence: ocrRound(region.BoxConfidence), Box: region.Box, Rotated: region.Rotated,
			LowConfidence: low,
		})
	}
	text, textTruncated := ocrClampText(strings.Join(textParts, "\n"), runBounds.MaxTextBytes)
	reasons := append([]string(nil), result.Reasons...)
	if textTruncated {
		reasons = appendUnique(reasons, OCRReasonTextLimit)
	}
	if lowConfidenceRegions > 0 {
		reasons = appendUnique(reasons, OCRReasonLowConfidenceRegion)
	}
	if emptyRegions > 0 {
		reasons = appendUnique(reasons, OCRReasonEmptyRegion)
	}
	truncated := result.Truncated || textTruncated
	state := OCRArtifactStateText
	switch {
	case len(regions) == 0:
		state = OCRArtifactStateEmpty
		reasons = appendUnique(reasons, OCRReasonNoTextRegions)
	case truncated || lowConfidenceRegions > 0 || emptyRegions > 0:
		state = OCRArtifactStatePartial
	}
	sort.Strings(reasons)
	meanConfidence := 0.0
	if recognized > 0 {
		meanConfidence = confidenceTotal / float64(recognized)
	}
	artifact := ocrArtifact{
		Schema: SchemaOCRTextV1,
		State:  state,
		Text:   text,
		Source: ocrArtifactSource{
			ContentID:     inv.Source.ContentID(),
			LogicalLength: int64(info.Bytes),
			Encoding:      info.Encoding,
			Width:         info.Width,
			Height:        info.Height,
			DigestBasis:   "logical_length is the byte count this attempt read from the exact source object; the host independently seals the artifact body and records its own SHA-256 as the artifact digest",
		},
		Engine: ocrArtifactEngine{
			EngineID: facts.EngineID, EngineVersion: facts.EngineVersion, EngineBuild: facts.EngineBuild,
			EngineSource: facts.EngineSource, EngineLicense: facts.EngineLicense,
			Runtime: facts.Runtime, RuntimeVersion: facts.RuntimeVersion, RuntimeDigest: facts.RuntimeDigest,
			ProfileDigest: facts.ProfileDigest, PreprocessingDigest: facts.PreprocessingDigest,
			ModelID: facts.ModelID, ModelRevision: facts.ModelRevision, ModelLicenseID: facts.ModelLicenseID,
			Assets: facts.Assets, Languages: facts.Languages, LanguageNotes: facts.LanguageNotes,
			LanguageScope:       "declared by the installed engine profile and dictionary; no per-region language detection is claimed",
			DictionaryFormat:    facts.DictionaryFormat,
			AngleClassification: facts.AngleClassification,
			Stages:              facts.Stages,
			DeterminismClass:    facts.DeterminismClass,
			DeterminismNotes:    "recognition_digest covers the canonical recognition payload; box coordinates and confidences are recorded at pinned float precision, so a different runtime build or SIMD profile is a new output generation",
		},
		Regions: regions,
		Quality: ocrArtifactQuality{
			RegionCount: len(regions), MinConfidence: ocrRound(minConfidence), MeanConfidence: ocrRound(meanConfidence),
			LowConfidenceThreshold: ocrRound(threshold), LowConfidenceRegions: lowConfidenceRegions, EmptyRegions: emptyRegions,
			Truncated: truncated, Reasons: reasons,
			MaxPixels: bounds.MaxPixels, MaxRegions: runBounds.MaxRegions, MaxTextBytes: runBounds.MaxTextBytes,
			SourceBudgetBytes: bounds.SourceBudgetBytes,
		},
	}
	artifact.RecognitionDigest = ocrRecognitionDigest(artifact)
	return artifact
}

// ocrRecognitionDigest is the SHA-256 over the canonical recognition payload
// with the digest field empty. The schema string versions the canonical form.
func ocrRecognitionDigest(artifact ocrArtifact) string {
	artifact.RecognitionDigest = ""
	payload, err := json.Marshal(artifact)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func ocrRound(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return math.Round(value*1e6) / 1e6
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func appendUnique(values []string, value string) []string {
	if containsString(values, value) {
		return values
	}
	return append(values, value)
}
