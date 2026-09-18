package processor

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// OCREngine is the narrow recognition contract behind ocr.image.text.v1. One
// invocation recognizes text in one decoded bitmap. An engine never reads
// repository paths, never writes durable state, and never decides protection.
type OCREngine interface {
	// Facts are the immutable engine identity recorded in every artifact.
	Facts() OCRRunFacts
	// Recognize runs the detection/recognition pipeline over one bitmap.
	Recognize(ctx context.Context, bitmap OCRBitmap, bounds OCRRunBounds) (OCRRunResult, error)
}

// OCRRunBounds are the per-run ceilings enforced by the engine.
type OCRRunBounds struct {
	MaxRegions   int
	MaxTextBytes int
	// LowConfidenceThreshold is recorded by the caller; the engine reports raw
	// confidences and never rewrites text because of this value.
	LowConfidenceThreshold float64
}

// OCRRegion is one recognized text region. Boxes are axis-aligned pixel
// rectangles in source-image coordinates.
type OCRRegion struct {
	Text          string
	Confidence    float64
	BoxConfidence float64
	Box           OCRBox
	// Rotated marks a crop that was rotated upright before recognition.
	Rotated bool
}

// OCRRunResult is the engine output before it is bound to an artifact.
type OCRRunResult struct {
	Regions []OCRRegion
	// Truncated marks a run stopped by a declared bound, never by luck.
	Truncated bool
	// Reasons are stable machine-readable markers for the operator.
	Reasons []string
}

// OCRAssetPin is one digest-pinned dependency recorded in the artifact.
type OCRAssetPin struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Digest string `json:"digest"`
	Bytes  int64  `json:"bytes"`
}

// OCRRunFacts are the engine and runtime facts that must travel with every
// recognized result. They are recorded verbatim in the artifact.
type OCRRunFacts struct {
	EngineID      string
	EngineVersion string
	EngineBuild   string
	EngineSource  string
	EngineLicense string

	Runtime        string
	RuntimeVersion string
	RuntimeDigest  string

	ProfileDigest       string
	PreprocessingDigest string
	ModelID             string
	ModelRevision       string
	ModelLicenseID      string

	Assets []OCRAssetPin

	Languages     []string
	LanguageNotes string

	DictionaryFormat    string
	AngleClassification string
	Stages              []string

	// LowConfidenceThreshold is the engine profile's marking threshold. It is
	// reported in the artifact; it never rewrites or hides recognized text.
	LowConfidenceThreshold float64

	DeterminismClass string
}

// Engine failure classes. They keep a broken bundle, a wrong runtime, and an
// unusable image distinguishable in the attempt reason.
var (
	// ErrOCREngineUnavailable means the engine could not be constructed.
	ErrOCREngineUnavailable = errors.New("OCR engine is unavailable")
	// ErrOCREngineFailed means the engine ran and did not produce a result.
	ErrOCREngineFailed = errors.New("OCR engine failed")
)

// ocrRunBoundsFromManifest derives the effective per-run bounds.
func ocrRunBoundsFromManifest(manifest OCRBundleManifest, facts OCRRunFacts) OCRRunBounds {
	threshold := manifest.RecMinConfidence
	if threshold <= 0 {
		threshold = facts.LowConfidenceThreshold
	}
	if threshold <= 0 {
		threshold = OCRDefaultLowConfidence
	}
	return OCRRunBounds{
		MaxRegions:             OCRMaxRegions,
		MaxTextBytes:           OCRMaxTextBytes,
		LowConfidenceThreshold: threshold,
	}
}

// ocrFactsFromAdmission binds the artifact facts to the verified bundle.
func ocrFactsFromAdmission(admission OCRBundleAdmission) OCRRunFacts {
	manifest := admission.Manifest
	pins := []OCRAssetPin{
		{Name: "runtime", Path: manifest.Runtime.Path, Digest: admission.AssetDigests["runtime"], Bytes: manifest.Runtime.Bytes},
		{Name: "det", Path: manifest.Detection.Path, Digest: admission.AssetDigests["det"], Bytes: manifest.Detection.Bytes},
		{Name: "rec", Path: manifest.Recognition.Path, Digest: admission.AssetDigests["rec"], Bytes: manifest.Recognition.Bytes},
		{Name: "dictionary", Path: manifest.Dictionary.Path, Digest: admission.AssetDigests["dictionary"], Bytes: manifest.Dictionary.Bytes},
	}
	sort.SliceStable(pins, func(i, j int) bool { return pins[i].Name < pins[j].Name })
	stages := make([]string, 0, len(manifest.Stages))
	for _, stage := range manifest.Stages {
		stages = append(stages, strings.ToUpper(strings.TrimSpace(stage)))
	}
	sort.Strings(stages)
	return OCRRunFacts{
		EngineID:      manifest.EngineID,
		EngineVersion: manifest.EngineVersion,
		EngineBuild:   manifest.EngineBuild,
		EngineSource:  manifest.EngineSource,
		EngineLicense: manifest.EngineLicense,

		Runtime:        "onnxruntime",
		RuntimeVersion: manifest.ONNXRuntimeVersion,
		RuntimeDigest:  admission.AssetDigests["runtime"],

		ProfileDigest:       admission.ProfileDigest,
		PreprocessingDigest: manifest.PreprocessingDigest,
		ModelID:             manifest.ModelID,
		ModelRevision:       manifest.ModelRevision,
		ModelLicenseID:      manifest.ModelLicenseID,

		Assets: pins,

		Languages:     append([]string(nil), manifest.Languages...),
		LanguageNotes: manifest.LanguageNotes,

		DictionaryFormat:    manifest.DictionaryFormat,
		AngleClassification: "NOT_CONFIGURED",
		Stages:              stages,

		LowConfidenceThreshold: manifest.RecMinConfidence,

		// Recognition runs on a pinned runtime, model, dictionary, and
		// preprocessing profile; the canonical recognition payload plus its
		// digest is the comparator. A different CPU SIMD profile or runtime
		// build may still move a coordinate or a probability, so the class is
		// declared semantic, not byte, determinism.
		DeterminismClass: "SEMANTICALLY_DETERMINISTIC",
	}
}

// newOCRBundleEngine constructs the real in-process ONNX Runtime engine. The
// implementation is build-tagged: hosts without cgo report an honest
// unavailable state instead of a fake success.
func newOCRBundleEngine(admission OCRBundleAdmission) (OCREngine, error) {
	engine, err := newOCROnnxEngine(admission)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrOCREngineUnavailable, err)
	}
	return engine, nil
}
