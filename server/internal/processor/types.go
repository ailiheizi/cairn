// Package processor is the host-owned Processor seam: typed routes, opaque
// handles, staging/seal/admit, and a bounded in-process RUN_STAGE pool.
// Large bytes stay in host-owned handles. The legacy plugin category model
// is not imported. Real semantic workers use an authenticated child process;
// Linux may add bubblewrap isolation through processor/sandbox.
// The protobuf/gRPC FD control plane lives in processor/rpc: length-prefixed
// Unix protobuf frames, grpc-go wrapping of the same messages, and SCM_RIGHTS
// for source/staging bytes. Default ingest remains in-process RUN_STAGE.
package processor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/ailiheizi/cairn/server/internal/identify"
)

const (
	CapabilityTextExtract       = "extract.text.v1"
	CapabilityAudioTags         = "extract.audio.tags.v1"
	CapabilityBookMeta          = "extract.book.meta.v1"
	CapabilityPDFTextExtract    = "extract.document.pdf.v1"
	CapabilityDOCXTextExtract   = "extract.document.docx.v1"
	CapabilityImageMeta         = "extract.image.meta.v1"
	CapabilityVideoMeta         = "extract.video.meta.v1"
	CapabilityAudioFingerprint  = "fingerprint.audio.fixture.v1"
	CapabilityTextEmbedding     = "embed.text.fixture.v1"
	CapabilityClipEmbedding     = "embed.clip.fixture.v1"
	CapabilityOCRImageText      = "ocr.image.text.v1"
	SchemaExtractedTextV1       = "cairn.artifact.extracted-text.v1"
	SchemaAudioTrackV1          = "cairn.domain.audio.track/v1"
	SchemaBookWorkV1            = "cairn.domain.book.work/v1"
	SchemaImageMetaV1           = "cairn.domain.image.meta/v1"
	SchemaVideoMetaV1           = "cairn.domain.video.meta/v1"
	SchemaAcousticFingerprintV1 = "cairn.artifact.acoustic-fingerprint.v1"
	SchemaTextEmbeddingV1       = "cairn.artifact.text-embedding.v1"
	SchemaClipEmbeddingV1       = "cairn.artifact.clip-embedding.v1"
	SchemaOCRTextV1             = "cairn.artifact.ocr-text.v1"
	MediaTypeUTF8Text           = "text/plain; charset=utf-8"
	MediaTypeAudioJSON          = "application/json"
	MediaTypeBookJSON           = "application/json"
	MediaTypeImageJSON          = "application/json"
	MediaTypeVideoJSON          = "application/json"
	MediaTypeFingerprintJSON    = "application/json"
	MediaTypeEmbeddingJSON      = "application/json"
	MediaTypeOCRJSON            = "application/json"
	FixtureFingerprintAlgorithm = "fixture-v1"
	FixtureTextSpace            = "fixture-text-v1"
	FixtureClipSpace            = "fixture-clip-v1"

	AuthorityStagedArtifact = "STAGED_ARTIFACT"
	LifecycleRebuildable    = "REBUILDABLE_DERIVATIVE"
	DeterminismByteExact    = "BYTE_DETERMINISTIC"

	defaultMaxSourceBytes = 1 << 20
	defaultStageTimeout   = 2 * time.Second
	defaultMaxConcurrent  = 2

	// A capability that reads media rather than text needs room for a real
	// picture and time for more than one model stage: at the 1 MiB default a
	// screenshot is truncated before the processor sees it, and at the 2s
	// default a detection plus recognition run is cancelled mid-flight.
	mediaMaxSourceBytes = int64(64 << 20)
	mediaStageTimeout   = 60 * time.Second
)

// CapabilityBudget overrides the host defaults for one capability; a zero field
// keeps the host default.
type CapabilityBudget struct {
	MaxSourceBytes int64
	MaxOutputBytes int64
	StageTimeout   time.Duration
}

// MediaBudget is implemented by processors whose work reads media instead of
// text. The host asks the processor rather than hard-coding capability names, so
// a new media processor declares its own budget where it is defined.
type MediaBudget interface {
	ProcessingBudget() CapabilityBudget
}

type Stage string

const (
	StageClassifyLearned Stage = "CLASSIFY_LEARNED"
	StageParse           Stage = "PARSE"
	StageExtract         Stage = "EXTRACT"
	StageEnrich          Stage = "ENRICH"
	StageFingerprint     Stage = "FINGERPRINT"
	StageTransform       Stage = "TRANSFORM"
	StageValidate        Stage = "VALIDATE"
	StageIndexPrepare    Stage = "INDEX_PREPARE"
)

type RouteKind string

const (
	RouteIdentification RouteKind = "IDENTIFICATION"
	RouteProcessing     RouteKind = "PROCESSING"
)

type ResultStatus string

const (
	StatusSucceeded    ResultStatus = "SUCCEEDED"
	StatusInapplicable ResultStatus = "INAPPLICABLE"
	StatusFailed       ResultStatus = "FAILED"
	StatusCancelled    ResultStatus = "CANCELLED"
)

type RouteNode struct {
	Stage        Stage  `json:"stage"`
	CapabilityID string `json:"capability_id"`
}

type Route struct {
	Kind  RouteKind   `json:"kind"`
	Nodes []RouteNode `json:"nodes"`
}

func (route Route) Digest() string {
	payload, _ := json.Marshal(route)
	sum := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(sum[:])
}

type ClassificationRecord struct {
	State    identify.IdentificationState `json:"state"`
	Evidence []identify.DetectionEvidence `json:"evidence"`
}

type Invocation struct {
	AttemptID      string
	FenceToken     int64
	Route          Route
	Node           RouteNode
	Classification ClassificationRecord
	Source         *SourceHandle
	Staging        *StagingHandle
	MaxOutputBytes int64
}

type StageResult struct {
	Status           ResultStatus
	DeterminismClass string
	SchemaRef        string
	MediaType        string
	Sealed           bool
	Reason           string
}

type Processor interface {
	CapabilityID() string
	Stage() Stage
	RunStage(ctx context.Context, inv Invocation) (StageResult, error)
}

// Durable fact namespaces. One namespace per durable fact vocabulary; the key
// names the field inside it. The host, not the processor, decides which keys
// may become durable rows.
const (
	FactNamespaceImage = "cairn.domain.image"
	FactNamespaceVideo = "cairn.domain.video"
	FactNamespaceAudio = "cairn.domain.audio"
)

// Admitted durable fact keys. A key outside this table is a processor defect
// and fails the attempt; it never becomes a catalog row.
const (
	FactImageFormat = "image.format"
	FactImageWidth  = "image.width"
	FactImageHeight = "image.height"

	FactVideoContainer  = "video.container"
	FactVideoDuration   = "video.duration_ms"
	FactVideoWidth      = "video.width"
	FactVideoHeight     = "video.height"
	FactVideoCodec      = "video.video_codec"
	FactVideoAudioCodec = "video.audio_codec"

	FactAudioDuration          = "audio.duration_ms"
	FactAudioDurationEstimated = "audio.duration_estimated"
	FactAudioSampleRate        = "audio.sample_rate"
	FactAudioChannels          = "audio.channels"
	FactAudioCodec             = "audio.codec"
)

// Fact value types accepted by the metadata_facts writer.
const (
	FactValueInteger = "integer"
	FactValueNumber  = "number"
	FactValueString  = "string"
	FactValueBoolean = "boolean"
)

// admittedFactNamespaces is the host-owned vocabulary: it maps every admitted
// fact key to its one namespace. It is the only place a key becomes writable.
var admittedFactNamespaces = map[string]string{
	FactImageFormat: FactNamespaceImage,
	FactImageWidth:  FactNamespaceImage,
	FactImageHeight: FactNamespaceImage,

	FactVideoContainer:  FactNamespaceVideo,
	FactVideoDuration:   FactNamespaceVideo,
	FactVideoWidth:      FactNamespaceVideo,
	FactVideoHeight:     FactNamespaceVideo,
	FactVideoCodec:      FactNamespaceVideo,
	FactVideoAudioCodec: FactNamespaceVideo,

	FactAudioDuration:          FactNamespaceAudio,
	FactAudioDurationEstimated: FactNamespaceAudio,
	FactAudioSampleRate:        FactNamespaceAudio,
	FactAudioChannels:          FactNamespaceAudio,
	FactAudioCodec:             FactNamespaceAudio,
}

var admittedFactValueTypes = map[string]bool{
	FactValueInteger: true,
	FactValueNumber:  true,
	FactValueString:  true,
	FactValueBoolean: true,
}

// maxDurableFactsPerArtifact bounds one artifact's fact set.
const maxDurableFactsPerArtifact = 32

// DurableFact is one typed key/value fact declared by an admitted artifact
// body. A fact is emitted only when the source file declared it; the host
// rejects a fact whose value is nil instead of writing a zero or a guess.
type DurableFact struct {
	Namespace string
	Key       string
	Value     any
	ValueType string
}

// FactSource is implemented by a processor whose artifact body also expresses
// typed durable facts. The host validates the body's schema first and then
// records these facts as immutable metadata_facts revisions in the same
// transaction that admits the artifact.
type FactSource interface {
	DurableFacts(body []byte) []DurableFact
}

// estimateFactSuffix marks a fact whose value is derived rather than declared
// by the file itself. It is appended to the key so a reader can never mistake
// an estimate for a declared field.
const estimateFactSuffix = "_estimated"

// SchemaRefExtractedText pins the bundled extracted-text schema by digest.
func SchemaRefExtractedText() string {
	sum := sha256.Sum256([]byte(SchemaExtractedTextV1))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func SchemaRefAudioTrack() string {
	sum := sha256.Sum256([]byte(SchemaAudioTrackV1))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func SchemaRefImageMeta() string {
	sum := sha256.Sum256([]byte(SchemaImageMetaV1))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func SchemaRefVideoMeta() string {
	sum := sha256.Sum256([]byte(SchemaVideoMetaV1))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func SchemaRefBookWork() string {
	sum := sha256.Sum256([]byte(SchemaBookWorkV1))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func SchemaRefAcousticFingerprint() string {
	sum := sha256.Sum256([]byte(SchemaAcousticFingerprintV1))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func SchemaRefTextEmbedding() string {
	sum := sha256.Sum256([]byte(SchemaTextEmbeddingV1))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func SchemaRefClipEmbedding() string {
	sum := sha256.Sum256([]byte(SchemaClipEmbeddingV1))
	return "sha256:" + hex.EncodeToString(sum[:])
}

// SchemaRefOCRText pins the operator-installed OCR extracted-text schema by
// digest. The schema names the exact artifact body shape; it does not claim
// that an OCR engine is installed.
func SchemaRefOCRText() string {
	sum := sha256.Sum256([]byte(SchemaOCRTextV1))
	return "sha256:" + hex.EncodeToString(sum[:])
}

// DefaultProcessors are the in-process EXTRACT pack. Fixture fingerprint
// and embedding processors are opt-in and are not part of default ingest.
func DefaultProcessors() []Processor {
	return []Processor{TextExtract{}, AudioTags{}, BookMeta{}, PDFTextExtract{}, DOCXTextExtract{}, ImageMeta{}, VideoMeta{}}
}

func ProducerDigest(capabilityID string) string {
	profile := "processor:" + capabilityID
	switch capabilityID {
	case CapabilityOCRImageText:
		profile = "processor:ocr.image.text.v1|recognition-output=ppocrv4-ctc-softmax-probabilities-v1|probability-range=0..1|row-sum-absolute-tolerance=0.001|source-bytes=67108864|side=20000|pixels=40000000|regions=2048|text-bytes=262144|timeout-ns=20000000000"
	case CapabilityPDFTextExtract:
		profile = "processor:extract.document.pdf.v1|parser=github.com/giraffesyo/pdf@v0.5.0|module=h1:xq1gQzlE5W8lW+mJqvu0cB0WkY2AfLCdynPf6t3CN4g=|profile=" + documentTextProfile + "|source=16777216|output=1048576|strict=true|concurrency=1|encryption=reject-authentication-preflight-v1|pages=256|stream=8388608|operators-per-page=250000|glyphs-per-page=50000|form-depth=16|timeout-ns=10000000000"
	case CapabilityDOCXTextExtract:
		profile = "processor:extract.document.docx.v1|parser=stdlib-archive-zip-encoding-xml-v1|profile=" + documentTextProfile + "|source=16777216|output=1048576|entries=2048|expanded=33554432|main-xml=16777216|xml-depth=128|timeout-ns=10000000000"
	}
	sum := sha256.Sum256([]byte(profile))
	return "sha256:" + hex.EncodeToString(sum[:])
}
