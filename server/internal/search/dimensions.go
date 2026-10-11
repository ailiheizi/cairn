package search

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Named discovery dimensions. One QueryProvider invocation queries exactly
// one dimension and one IndexGenerationRef. Later acoustic/semantic providers
// attach to the same SubjectRef and never become ContentIdentity.
const (
	CapabilityKindDimension = "index-dimension"

	// SemanticIndexUnavailableReason is the stable operator-facing reason used
	// while the configured real embedding provider has not been wired. Fixture
	// embeddings are deliberately not a substitute for this capability.
	SemanticIndexUnavailableReason = "SEMANTIC_INDEX_UNAVAILABLE"

	// SemanticIndexNotBuiltReason is the stable operator-facing reason used
	// when a real semantic provider and vector binding are installed but no
	// verified generation is served for this workspace yet. It is distinct
	// from SemanticIndexUnavailableReason, which means nothing is installed or
	// the binding cannot be served at all.
	SemanticIndexNotBuiltReason = "SEMANTIC_INDEX_NOT_BUILT"

	// IndexStateNotBuilt is the shared dimension state for "the provider is
	// installed, but no generation is built for this workspace". It is the
	// same state the image dimension reports, so a caller never has to read
	// "not built yet" as "nothing is installed".
	IndexStateNotBuilt = "NOT_BUILT"

	DimensionLexical    = "lexical-metadata-fts"
	DimensionAcoustic   = "acoustic-fingerprint"
	DimensionSemantic   = "semantic-embedding"
	DimensionMultimodal = "multimodal-clip"
	DimensionGraph      = "graph-relation"

	ProviderLexicalFTS5   = "query.lexical.fts5.v1"
	ProviderAcousticFix   = "query.acoustic.fixture.v1"
	ProviderSemanticFix   = "query.semantic.fixture.v1"
	ProviderSemanticONNX  = "query.semantic.onnx-bge-zvec.v1"
	ProviderMultimodalFix = "query.multimodal.fixture.v1"
	// ProviderMultimodalONNX is the real local image-space query provider. Its
	// text queries go through the image model's own text tower; they are never
	// served by the text embedding provider.
	ProviderMultimodalONNX = "query.multimodal.onnx-clip-zvec.v1"
	ProviderBrokerFuse     = "query.broker.fuse.v1"
	ProviderGraphCatalog   = "query.graph.catalog.v1"
	ScoreLexicalRank       = "fts5-rank"
	ScoreGraphExact        = "relation-exact"
	ScoreAcousticExact     = "fixture-exact"
	ScoreSemanticExact     = "fixture-exact"
	ScoreSemanticCosine    = "cosine-similarity"
	ScoreMultimodalExact   = "fixture-exact"
	ScoreMultimodalCosine  = "cosine-similarity"
	ScoreComponentUnion    = "component-union"
	CapabilityKindBroker   = "query-broker"

	AxisPath            = "path"
	AxisName            = "name"
	AxisSuffix          = "suffix"
	AxisType            = "type"
	AxisChecksum        = "checksum"
	AxisMetadata        = "metadata"
	AxisDuplicates      = "duplicates"
	AxisDuplicateGroup  = "duplicate_group"
	AxisProtection      = "protection"
	AxisLocators        = "locators"
	AxisTags            = "tags"
	AxisNotes           = "notes"
	AxisDescriptions    = "descriptions"
	AxisExtracted       = "extracted"
	AxisDetection       = "detection"
	AxisProcessing      = "processing"
	AxisRepresentations = "representations"
	AxisLanguage        = "language"

	// AxisSize and AxisMtime are numeric facets, not FTS5 text columns. They
	// are constrained through typed Filters and reported by coverage, never
	// by a MATCH clause.
	AxisSize  = "size"
	AxisMtime = "mtime"
)

// ProviderSemanticOnline is the real egress-gated online embedding provider.
// Its embedding space is the selected online profile's space fingerprint, and
// its vectors are only produced after the egress gate admits one request.
// --- online embedding provider (additive wiring) ---
const ProviderSemanticOnline = "query.semantic.online-embeddings.v1"

// LexicalConstructAxes are the rebuildable text fields of the bundled FTS5
// generation. Size and mtime are numeric facets, not text axes: they are
// searchable through typed structured filters, never through MATCH.
// These are not six products and not recovery evidence.
var LexicalConstructAxes = []string{
	AxisPath, AxisName, AxisSuffix, AxisType, AxisChecksum, AxisMetadata,
	AxisDuplicates, AxisDuplicateGroup, AxisProtection, AxisLocators,
	AxisTags, AxisNotes, AxisDescriptions, AxisExtracted,
	AxisDetection, AxisProcessing, AxisRepresentations, AxisLanguage,
}

// Dimension is the capability projection of one named retrieval space.
type Dimension struct {
	ID             string
	Provider       string
	State          string
	Version        string
	ScoreSemantics string
	ConstructAxes  []string
	// Reason is the stable machine-readable reason code for a dimension that
	// is not AVAILABLE. It is empty for a ready dimension and for the physical
	// dimensions whose absence has no separate code.
	Reason string
	Notes  string
}

// QueryRequest is one search.query dispatch against a named generation.
type QueryRequest struct {
	WorkspaceID  string
	GenerationID string
	Dimension    string
	Text         string
	Axes         []string
	Filters      Filters
	Fuse         []string
	// ImageQuery is the optional host-admitted query image for the separate
	// image space (search by image). It is retrieval material only: a
	// vision-tower vector never establishes identity and never authorizes any
	// deletion. Exactly one of Text and ImageQuery may serve one dimension.
	ImageQuery *ImageQueryInput
	// Page bounds this invocation and, for the pageable lexical lane, resumes
	// strictly after an exact keyset position. A zero Page keeps the
	// pre-paging single-answer bound (legacyResultLimit) so callers that do not
	// page see the same shape as before.
	Page PageRequest
}

// IndexBinding identifies the host configuration and immutable provider
// profiles that produced disposable index generations. Empty bindings are
// reserved for low-level fixture harnesses; a daemon must provide ConfigDigest.
type IndexBinding struct {
	ConfigDigest            string
	LexicalProfileDigest    string
	SemanticProfileDigest   string
	MultimodalProfileDigest string
	AcousticProfileDigest   string
	GraphProfileDigest      string
	SemanticSpace           string
	MultimodalSemanticSpace string
	SemanticManifest        EmbeddingGenerationManifest
	MultimodalManifest      EmbeddingGenerationManifest
}

// EmbeddingGenerationManifest is the immutable identity of one embedding
// generation. Its digest is stored in IndexGeneration.ProviderProfileDigest;
// changing any runtime, model, preprocessing, vector, distance, index/query,
// provider, or host-config field therefore creates a different generation.
type EmbeddingGenerationManifest struct {
	RuntimeDigest       string `json:"runtime_digest"`
	ModelDigest         string `json:"model_digest"`
	TokenizerDigest     string `json:"tokenizer_digest"`
	PreprocessingDigest string `json:"preprocessing_digest"`
	Pooling             string `json:"pooling"`
	Normalization       string `json:"normalization"`
	ElementType         string `json:"element_type"`
	Dimension           int    `json:"dimension"`
	VectorSchema        string `json:"vector_schema"`
	SemanticSpace       string `json:"semantic_space"`
	Distance            string `json:"distance"`
	IndexConfig         string `json:"index_config"`
	QueryConfig         string `json:"query_config"`
	ProviderDigest      string `json:"provider_digest"`
	ConfigDigest        string `json:"config_digest"`
}

// ErrInvalidEmbeddingGenerationManifest identifies a binding that cannot
// safely describe output-affecting embedding generation parameters.
var ErrInvalidEmbeddingGenerationManifest = errors.New("invalid embedding generation manifest")

// Validate rejects incomplete manifests before they can identify a
// production generation. Empty values are not meaningful defaults: the
// selected profile must state every fact that can change produced vectors or
// their retrieval semantics.
func (m EmbeddingGenerationManifest) Validate() error {
	fields := []struct {
		name  string
		value string
	}{
		{"runtime_digest", m.RuntimeDigest},
		{"model_digest", m.ModelDigest},
		{"tokenizer_digest", m.TokenizerDigest},
		{"preprocessing_digest", m.PreprocessingDigest},
		{"pooling", m.Pooling},
		{"normalization", m.Normalization},
		{"element_type", m.ElementType},
		{"vector_schema", m.VectorSchema},
		{"semantic_space", m.SemanticSpace},
		{"distance", m.Distance},
		{"index_config", m.IndexConfig},
		{"query_config", m.QueryConfig},
		{"provider_digest", m.ProviderDigest},
		{"config_digest", m.ConfigDigest},
	}
	missing := make([]string, 0, len(fields)+1)
	for _, field := range fields {
		if strings.TrimSpace(field.value) == "" {
			missing = append(missing, field.name)
		}
	}
	if m.Dimension <= 0 {
		missing = append(missing, "dimension")
	}
	if len(missing) > 0 {
		return fmt.Errorf("%w: missing %s", ErrInvalidEmbeddingGenerationManifest, strings.Join(missing, ", "))
	}
	return nil
}

// CanonicalDigest returns a stable digest over the ordered manifest fields.
// Struct JSON encoding is deterministic here because the manifest has no
// maps or unordered collections. An incomplete manifest has no usable
// canonical identity and returns an empty digest.
func (m EmbeddingGenerationManifest) CanonicalDigest() string {
	if err := m.Validate(); err != nil {
		return ""
	}
	payload, _ := json.Marshal(m)
	h := sha256.Sum256(append([]byte("cairn.embedding-generation-manifest.v1\n"), payload...))
	return "sha256:" + hex.EncodeToString(h[:])
}

// FixtureIndexBinding returns the explicit deterministic binding used by
// qualification harnesses. It is not a production semantic capability.
func FixtureIndexBinding(configDigest string) IndexBinding {
	semanticManifest := EmbeddingGenerationManifest{
		RuntimeDigest: "fixture-runtime", ModelDigest: "fixture-model",
		TokenizerDigest: "fixture-tokenizer", PreprocessingDigest: "fixture-preprocessing",
		Pooling: "mean", Normalization: "l2", ElementType: "float32", Dimension: 512,
		VectorSchema: "fixture-vector-v1", SemanticSpace: SemanticFixtureProfileV1,
		Distance: "cosine", IndexConfig: "fixture-index-v1", QueryConfig: "fixture-query-v1",
		ProviderDigest: ProfileDigest(DimensionSemantic, SemanticFixtureProfileV1),
		ConfigDigest:   strings.TrimSpace(configDigest),
	}
	multimodalManifest := semanticManifest
	multimodalManifest.SemanticSpace = MultimodalFixtureProfileV1
	multimodalManifest.ProviderDigest = ProfileDigest(DimensionMultimodal, MultimodalFixtureProfileV1)
	return IndexBinding{
		ConfigDigest:            strings.TrimSpace(configDigest),
		LexicalProfileDigest:    ProfileDigest(DimensionLexical, LexicalProfileV4),
		SemanticProfileDigest:   semanticManifest.CanonicalDigest(),
		MultimodalProfileDigest: multimodalManifest.CanonicalDigest(),
		AcousticProfileDigest:   ProfileDigest(DimensionAcoustic, AcousticFixtureProfileV1),
		GraphProfileDigest:      ProfileDigest(DimensionGraph, GraphProfileV1),
		SemanticSpace:           SemanticFixtureProfileV1,
		MultimodalSemanticSpace: MultimodalFixtureProfileV1,
		SemanticManifest:        semanticManifest,
		MultimodalManifest:      multimodalManifest,
	}
}

// ProfileDigest returns a stable provider/profile identity for an index
// dimension. It is intentionally separate from config_digest: changing the
// host configuration creates new work, while this digest records which
// immutable retrieval implementation produced the bytes.
func ProfileDigest(dimension, profile string) string {
	h := sha256.Sum256([]byte("cairn.index-profile.v1\n" + strings.TrimSpace(dimension) + "\n" + strings.TrimSpace(profile)))
	return "sha256:" + hex.EncodeToString(h[:])
}

const (
	// LexicalProfileV4 is the lexical feed shape that adds the derived CJK
	// adjacency tokens — every adjacent character bigram plus every single
	// character of each CJK run, and the adjacent pinyin syllable pairs — on
	// top of the V3 pinyin token enrichment (name/path/notes/descriptions/
	// extracted axes, the extracted axis bounded to its first 256 KiB, see
	// extractedPinyinEnrichmentBound, in the dedicated *_pinyin FTS5 columns).
	// The raw feed's unicode61 tokenizer treats one contiguous CJK run as a
	// single prefix-matchable token, so V3 answered only a query at the start
	// of a run; the adjacency tokens make any two-character query match
	// anywhere inside the run, in characters and in pinyin, without a new
	// field. It supersedes the "fts5-metadata-v3" profile: a generation built
	// under an older profile records a different ProviderProfileDigest and is
	// refused, never reinterpreted, by the current wiring.
	LexicalProfileV4           = "fts5-metadata-v4"
	GraphProfileV1             = "graph-catalog-v1"
	AcousticFixtureProfileV1   = "acoustic-fixture-v1"
	SemanticFixtureProfileV1   = "semantic-fixture-v1"
	MultimodalFixtureProfileV1 = "multimodal-fixture-v1"
)

// Filters are typed structured constraints applied on top of the free-text
// MATCH expression. Empty fields are absent constraints. Times are
// milliseconds since the Unix epoch so the command surface can pass them as
// plain JSON integers without a time layout. JSON tags keep the command
// surface's snake_case keys stable across package boundaries.
type Filters struct {
	EntryType      string `json:"entry_type"`
	ContentID      string `json:"content_id"`
	DuplicateGroup string `json:"duplicate_group"`
	ProtectionMode string `json:"protection_mode"`
	Language       string `json:"language"`
	Suffix         string `json:"suffix"`
	// MediaClass is the derived media-class projection (see media_class.go).
	// It is an additive convenience facet computed from the entry's recorded
	// suffix; it is not a durable fact and not exact identity.
	MediaClass  string `json:"media_class"`
	SizeMin     *int64 `json:"size_min"`
	SizeMax     *int64 `json:"size_max"`
	MtimeAfter  *int64 `json:"mtime_after"`
	MtimeBefore *int64 `json:"mtime_before"`
}

// Has reports whether at least one structured constraint is set.
func (f Filters) Has() bool {
	if f.EntryType != "" || f.ContentID != "" || f.DuplicateGroup != "" ||
		f.ProtectionMode != "" || f.Language != "" || f.Suffix != "" || f.MediaClass != "" {
		return true
	}
	return f.SizeMin != nil || f.SizeMax != nil || f.MtimeAfter != nil || f.MtimeBefore != nil
}

// NumericFilters reports which numeric facets are constrained. It is used by
// coverage reporting so absent numeric facets stay visible as absent.
func (f Filters) NumericFilters() []string {
	var out []string
	if f.SizeMin != nil || f.SizeMax != nil {
		out = append(out, AxisSize)
	}
	if f.MtimeAfter != nil || f.MtimeBefore != nil {
		out = append(out, AxisMtime)
	}
	return out
}

// FieldCoverage reports whether one named text facet is present in the feed
// with any non-empty content. It never invents coverage for fields the feed
// does not carry.
func (f FieldCoverage) Present(field string) bool {
	if field == "" {
		return false
	}
	return f[field]
}

// ProviderReadiness says which QueryProviders this process has wired.
// A ready acoustic provider can still degrade when no generation exists.
// The multimodal fields describe the separate image space: Multimodal is the
// qualification-only fixture projection, MultimodalInstalled says a real image
// binding is configured, and MultimodalReal says a verified real image
// generation is currently served.
type ProviderReadiness struct {
	Lexical             bool
	Acoustic            bool
	Semantic            bool
	SemanticReal        bool
	Multimodal          bool
	MultimodalInstalled bool
	MultimodalReal      bool
	MultimodalState     string
	MultimodalReason    string
	// MultimodalFailure is the image provider's latest payload-free failure
	// summary. A failed generation is reported UNAVAILABLE with this reason in
	// the notes, never as "not built".
	MultimodalFailure string
	Graph             bool
	// SemanticInstalled says a real (non-fixture) semantic provider and vector
	// binding are configured for this process. It is deliberately separate
	// from SemanticReal: installed with no served generation is reported as
	// NOT_BUILT with its reason, never as "nothing is wired".
	SemanticInstalled bool
	// SemanticState and SemanticReason carry the installed binding's own state
	// for the served generation ("NOT_BUILT" or "UNAVAILABLE") and its stable
	// reason code. Both are empty when no real binding is installed.
	SemanticState  string
	SemanticReason string
	// --- online embedding provider (additive wiring) ---
	// SemanticOnline marks that the real semantic provider is an online
	// (remote, egress-gated) provider rather than the local ONNX/BGE worker,
	// so the dimension notes never mislabel a remote space as local. A hybrid
	// provider is reported as online because one of its components is remote.
	SemanticOnline bool
	// SemanticComponents carries the per-component status of a hybrid
	// provider ("local"/"online"), empty for a single-component provider.
	SemanticComponents []SemanticProviderComponentStatus
	// SemanticFailure is the provider's latest payload-free failure summary
	// (reason codes and batch positions only). It is reported in the semantic
	// dimension notes so a refused or failed egress is visible without
	// claiming the dimension is fine.
	SemanticFailure string
}

// DeclaredDimensions returns every discovery dimension the contract names.
func DeclaredDimensions(ready ProviderReadiness) []Dimension {
	lexicalState := "UNAVAILABLE"
	lexicalNotes := "bundled FTS5 IndexProvider/QueryProvider; unavailable until the exact lane wires a search indexer"
	if ready.Lexical {
		lexicalState = "AVAILABLE"
		lexicalNotes = "bundled disposable FTS5 generation over namespace, metadata, checksum, duplicate, protection, locator, annotation, description, and extracted text fields; not recovery authority"
	}
	acousticState := "UNAVAILABLE"
	acousticNotes := "fixture fingerprint QueryProvider; unavailable until the exact lane wires a search indexer"
	if ready.Acoustic {
		acousticState = "AVAILABLE"
		acousticNotes = "disposable fixture-fingerprint generation over admitted FINGERPRINT artifacts; not Chromaprint, not SHA-256, not recovery authority"
	}
	semanticState := "UNAVAILABLE"
	semanticProvider := ProviderSemanticFix
	semanticScore := ScoreSemanticExact
	semanticReason := ""
	semanticNotes := "real embedding model and vector IndexProvider are not wired (" + SemanticIndexUnavailableReason + "); fixture embeddings require explicit opt-in"
	if ready.SemanticInstalled && !ready.Semantic {
		// A real provider and vector binding exist. What is missing is a
		// verified generation for this workspace, so the dimension reports
		// NOT_BUILT (or the binding's own unavailable reason) instead of
		// claiming nothing is installed.
		semanticProvider = ProviderSemanticONNX
		semanticScore = ScoreSemanticCosine
		semanticReason = strings.TrimSpace(ready.SemanticReason)
		if semanticReason == "" {
			semanticReason = SemanticIndexNotBuiltReason
		}
		if ready.SemanticState == ImageProviderUnavailable || semanticReason == SemanticIndexUnavailableReason {
			semanticState = "UNAVAILABLE"
			semanticNotes = "real embedding provider or vector binding is installed but cannot be served (" + semanticReason + ")"
		} else {
			semanticState = IndexStateNotBuilt
			semanticNotes = "real embedding provider and vector binding are installed, but no semantic generation is built for this workspace (" + semanticReason + "); rebuild the semantic generation to serve this dimension"
		}
		if ready.SemanticOnline {
			semanticProvider = ProviderSemanticOnline
			semanticNotes += "; disclosed only through the egress gate (confirmation, credential, protection, and append-only receipt)" + semanticOnlineDetail(ready)
		}
	}
	if ready.Semantic {
		semanticState = "AVAILABLE"
		semanticReason = ""
		semanticNotes = "explicitly enabled fixture-embedding generation over admitted ENRICH artifacts; not a model runtime, not SHA-256, not recovery authority"
		if ready.SemanticReal {
			semanticProvider = ProviderSemanticONNX
			semanticScore = ScoreSemanticCosine
			semanticNotes = "host-owned local ONNX/BGE embedding plus in-process zvec generation over durable semantic segments; disposable index, not recovery authority"
			// --- online embedding provider (additive wiring) ---
			// A remote embedding space is never described as the local BGE
			// worker, and its per-component status is named with its reason.
			if ready.SemanticOnline {
				semanticProvider = ProviderSemanticOnline
				semanticNotes = "host-owned online embedding provider over durable semantic segments, disclosed only through the egress gate (confirmation, credential, protection, and append-only receipt); disposable index, not recovery authority" + semanticOnlineDetail(ready)
			}
		}
	}
	multimodalState := ImageProviderNotBuilt
	multimodalProvider := ProviderMultimodalONNX
	multimodalScore := ScoreMultimodalCosine
	multimodalReason := MultimodalIndexNotBuiltReason
	multimodalNotes := "no image model artifact or binding is installed (" + MultimodalIndexNotBuiltReason + "); the separate image space requires an operator-installed model and is never served by fixture vectors"
	if ready.MultimodalInstalled {
		// A real image binding exists. Its state is reported exactly as the
		// provider reports it; absence of a built generation is NOT_BUILT and a
		// broken artifact or backend is UNAVAILABLE, each with its reason.
		multimodalProvider = ProviderMultimodalONNX
		multimodalScore = ScoreMultimodalCosine
		multimodalReason = strings.TrimSpace(ready.MultimodalReason)
		switch ready.MultimodalState {
		case ImageProviderReady:
			multimodalState = "AVAILABLE"
			multimodalNotes = "separate local image embedding space queried through the image model's own text tower, with its own generation, space fingerprint, and provider digest; never compared or fused with text-space vectors; disposable index, not recovery authority"
		case ImageProviderNotBuilt:
			multimodalState = ImageProviderNotBuilt
			if multimodalReason == "" {
				multimodalReason = MultimodalIndexNotBuiltReason
			}
			multimodalNotes = "image model provider is installed but no image generation is built for this workspace (" + multimodalReason + ")"
		default:
			multimodalState = "UNAVAILABLE"
			if multimodalReason == "" {
				multimodalReason = MultimodalIndexUnavailableReason
			}
			multimodalNotes = "image model artifact, provider, or vector backend is unavailable (" + multimodalReason + ")"
			if failure := strings.TrimSpace(ready.MultimodalFailure); failure != "" {
				multimodalNotes += "; last failure: " + failure
			}
		}
	}
	if ready.Multimodal {
		multimodalState = "AVAILABLE"
		multimodalProvider = ProviderMultimodalFix
		multimodalScore = ScoreMultimodalExact
		multimodalReason = ""
		multimodalNotes = "explicitly enabled fixture joint-space generation over audio-tag ENRICH artifacts; not CLIP weights, not a real embedding model, not SHA-256, not recovery authority"
	}
	graphState := "UNAVAILABLE"
	graphNotes := "catalog relation QueryProvider; unavailable until the exact lane wires a search indexer"
	if ready.Graph {
		graphState = "AVAILABLE"
		graphNotes = "disposable relation projection over namespace, tags, and extracted artist/album/author labels; not a second catalog and not recovery authority"
	}
	return []Dimension{
		{
			ID:             DimensionLexical,
			Provider:       ProviderLexicalFTS5,
			State:          lexicalState,
			Version:        "1",
			ScoreSemantics: ScoreLexicalRank,
			ConstructAxes:  append([]string(nil), LexicalConstructAxes...),
			Notes:          lexicalNotes,
		},
		{
			ID:             DimensionAcoustic,
			Provider:       ProviderAcousticFix,
			State:          acousticState,
			Version:        "1",
			ScoreSemantics: ScoreAcousticExact,
			Notes:          acousticNotes,
		},
		{
			ID:             DimensionSemantic,
			Provider:       semanticProvider,
			State:          semanticState,
			Version:        "1",
			ScoreSemantics: semanticScore,
			Reason:         semanticReason,
			Notes:          semanticNotes,
		},
		{
			ID:             DimensionMultimodal,
			Provider:       multimodalProvider,
			State:          multimodalState,
			Version:        "1",
			ScoreSemantics: multimodalScore,
			Reason:         multimodalReason,
			Notes:          multimodalNotes,
		},
		{
			ID:             DimensionGraph,
			Provider:       ProviderGraphCatalog,
			State:          graphState,
			Version:        "1",
			ScoreSemantics: ScoreGraphExact,
			Notes:          graphNotes,
		},
	}
}

// LookupDimension returns a declared dimension by id.
func LookupDimension(id string, ready ProviderReadiness) (Dimension, bool) {
	id = strings.TrimSpace(id)
	if id == "" {
		id = DimensionLexical
	}
	for _, dimension := range DeclaredDimensions(ready) {
		if dimension.ID == id {
			return dimension, true
		}
	}
	return Dimension{}, false
}

// FieldCoverage is a per-field presence map for one lexical generation.
// Absence is an honest reported fact: a field missing from the feed is never
// silently claimed. The map is nil when no generation exists.
type FieldCoverage map[string]bool

// CoverageStatement is the operator-facing lexical feed coverage report.
// Complete is true only when every documented baseline feed field is present
// and non-empty for at least one subject. It is never asserted from the index
// schema alone; it requires an actual built generation.
type CoverageStatement struct {
	Dimension string
	Available bool
	Complete  bool
	Fields    FieldCoverage
	Missing   []string
	Notes     string
}

// LexicalCoverage reports what one built generation actually feeds. When the
// generation is unavailable, Fields is nil and Complete is false so a caller
// cannot claim the complete baseline. The coverage map keys are Axis values.
func LexicalCoverage(available bool, perField map[string]bool) CoverageStatement {
	statement := CoverageStatement{
		Dimension: DimensionLexical,
		Available: available,
		Complete:  false,
		Notes:     "field-level presence in the lexical feed; absence is reported, never invented",
	}
	if !available {
		return statement
	}
	if perField == nil {
		return statement
	}
	fields := FieldCoverage{}
	complete := true
	for _, axis := range LexicalCoverageFields() {
		present := perField[axis]
		fields[axis] = present
		if !present {
			complete = false
			statement.Missing = append(statement.Missing, axis)
		}
	}
	statement.Fields = fields
	statement.Complete = complete
	return statement
}

// LexicalCoverageFields is the documented complete-baseline feed surface.
// It pairs the FTS5 text axes with the two numeric facets (size, mtime) that
// structured filters can constrain.
func LexicalCoverageFields() []string {
	fields := make([]string, 0, len(LexicalConstructAxes)+2)
	fields = append(fields, LexicalConstructAxes...)
	fields = append(fields, AxisSize, AxisMtime)
	return fields
}

// semanticOnlineDetail names each non-ready component of a hybrid online
// provider and its latest payload-free failure summary, so a refused or failed
// egress is visible without claiming the dimension is fine.
// --- online embedding provider (additive wiring) ---
func semanticOnlineDetail(ready ProviderReadiness) string {
	detail := ""
	for _, component := range ready.SemanticComponents {
		if component.State == SemanticComponentReady {
			continue
		}
		reason := strings.TrimSpace(component.Reason)
		if reason == "" {
			reason = strings.TrimSpace(component.Failure)
		}
		if reason == "" {
			reason = SemanticIndexUnavailableReason
		}
		detail += "; " + component.Component + "=" + SemanticComponentUnavailable + "(" + reason + ")"
	}
	if failure := strings.TrimSpace(ready.SemanticFailure); failure != "" {
		detail += "; last failure: " + failure
	}
	return detail
}

// semanticBindingActive reports whether a real (non-fixture) semantic provider
// binding is configured. It mirrors imageBindingActive: a real binding needs a
// provider, a vector backend, a validated non-fixture manifest, and the
// digest-pinned native library binding. It says nothing about whether a
// generation is built; that is SemanticReal.
func (idx *Indexer) semanticBindingActive() bool {
	return idx != nil && idx.SemanticProvider != nil && idx.SemanticZvec != nil &&
		idx.SemanticManifest != (EmbeddingGenerationManifest{}) &&
		strings.TrimSpace(idx.SemanticManifest.SemanticSpace) != SemanticFixtureProfileV1 &&
		strings.TrimSpace(idx.SemanticLibraryPath) != "" &&
		strings.TrimSpace(idx.SemanticLibraryDigest) != ""
}

func IndexerReadiness(idx *Indexer) ProviderReadiness {
	ready := idx != nil && idx.Store != nil && idx.Engine != nil
	fixtures := ready && idx.fixtureDimensionsActive()
	providerReady := ready
	if ready {
		if health, ok := idx.SemanticProvider.(interface{ SemanticReady() bool }); ok {
			providerReady = health.SemanticReady()
		}
	}
	zvecReady := false
	if ready && idx.SemanticZvec != nil {
		if health, ok := idx.SemanticZvec.(ZvecGenerationReadiness); ok {
			zvecReady = health.ZvecReady(idx.SemanticLibraryPath, idx.SemanticLibraryDigest, idx.SemanticManifest)
		}
	}
	realSemantic := ready && providerReady && idx.SemanticProvider != nil && idx.SemanticZvec != nil &&
		zvecReady &&
		idx.SemanticManifest.Validate() == nil && strings.TrimSpace(idx.SemanticLibraryPath) != "" &&
		strings.TrimSpace(idx.SemanticLibraryDigest) != "" && idx.semanticIndexReady.Load() && !idx.semanticUnavailable.Load()
	fixtureSemantic := fixtures && (idx.SemanticManifest == (EmbeddingGenerationManifest{}) ||
		idx.SemanticManifest.SemanticSpace == SemanticFixtureProfileV1)
	imageInstalled := ready && idx.imageBindingActive()
	imageState := ""
	imageReason := ""
	imageFailure := ""
	imageReal := false
	if imageInstalled {
		report := idx.imageProviderReport()
		switch {
		case report.State != ImageProviderReady:
			imageState = report.State
			imageReason = strings.TrimSpace(report.Reason)
			if imageReason == "" {
				imageReason = MultimodalIndexUnavailableReason
			}
		case idx.ImageSource == nil:
			imageState = ImageProviderUnavailable
			imageReason = "image content source is not configured"
		case idx.ImageZvec == nil || strings.TrimSpace(idx.ImageLibraryPath) == "" || strings.TrimSpace(idx.ImageLibraryDigest) == "" ||
			idx.MultimodalManifest.Validate() != nil:
			imageState = ImageProviderUnavailable
			imageReason = MultimodalIndexUnavailableReason
		case strings.TrimSpace(idx.ImageFailure()) != "":
			// A failed image generation or provider is UNAVAILABLE with its
			// reason. It is never collapsed into "nothing is built", which
			// would hide the failure.
			imageState = ImageProviderUnavailable
			imageReason = MultimodalIndexUnavailableReason
			imageFailure = strings.TrimSpace(idx.ImageFailure())
		case !idx.imageIndexReady.Load():
			imageState = ImageProviderNotBuilt
			imageReason = MultimodalIndexNotBuiltReason
		default:
			imageZvecReady := true
			if health, ok := idx.ImageZvec.(ZvecGenerationReadiness); ok {
				imageZvecReady = health.ZvecReady(idx.ImageLibraryPath, idx.ImageLibraryDigest, idx.MultimodalManifest)
			}
			if !imageZvecReady {
				imageState = ImageProviderUnavailable
				imageReason = MultimodalIndexUnavailableReason
			} else {
				imageState = ImageProviderReady
				imageReal = true
			}
		}
	}
	semanticInstalled := idx.semanticBindingActive()
	semanticState := ""
	semanticReason := ""
	if semanticInstalled && !realSemantic {
		// The model, the vector backend, and the native library binding are all
		// present. Distinguish "no generation is built for this workspace yet"
		// from "the binding cannot be served": only the first is NOT_BUILT, and
		// a failure latch or an unusable binding is reported as UNAVAILABLE.
		switch {
		case providerReady && zvecReady && !idx.semanticUnavailable.Load():
			semanticState = IndexStateNotBuilt
			semanticReason = SemanticIndexNotBuiltReason
		default:
			semanticState = "UNAVAILABLE"
			semanticReason = SemanticIndexUnavailableReason
		}
	}
	// An installed online binding is described as online even before a
	// generation is built: its component statuses and payload-free failure
	// summary are exactly what an operator needs to read a NOT_BUILT or
	// UNAVAILABLE semantic dimension honestly.
	semanticOnline, semanticComponents, semanticFailure := semanticProviderReport(idx, realSemantic || semanticInstalled)
	return ProviderReadiness{
		Lexical: ready, Acoustic: fixtures, Semantic: fixtureSemantic || realSemantic, SemanticReal: realSemantic,
		Multimodal: fixtures, MultimodalInstalled: imageInstalled, MultimodalReal: imageReal,
		MultimodalState: imageState, MultimodalReason: imageReason, MultimodalFailure: imageFailure, Graph: ready,
		SemanticInstalled: semanticInstalled, SemanticState: semanticState, SemanticReason: semanticReason,
		SemanticOnline: semanticOnline, SemanticComponents: semanticComponents, SemanticFailure: semanticFailure,
	}
}

// semanticProviderReport reports whether the real semantic provider is remote
// (online or hybrid), its honest per-component status for a hybrid provider,
// and its latest payload-free failure summary.
// --- online embedding provider (additive wiring) ---
func semanticProviderReport(idx *Indexer, real bool) (bool, []SemanticProviderComponentStatus, string) {
	if !real || idx == nil || idx.SemanticProvider == nil {
		return false, nil, ""
	}
	kind := ""
	if provider, ok := idx.SemanticProvider.(interface{ SemanticProviderKind() string }); ok {
		kind = provider.SemanticProviderKind()
	}
	online := kind == "online" || kind == "hybrid"
	var components []SemanticProviderComponentStatus
	if provider, ok := idx.SemanticProvider.(interface {
		ComponentStatuses() []SemanticProviderComponentStatus
	}); ok {
		components = provider.ComponentStatuses()
	}
	failure := ""
	if health, ok := idx.SemanticProvider.(interface{ SemanticFailure() string }); ok {
		failure = strings.TrimSpace(health.SemanticFailure())
	}
	if !online {
		failure = ""
	}
	return online, components, failure
}

// NormalizeFuse accepts two or more declared dimension IDs. Duplicates drop.
func NormalizeFuse(ids []string) ([]string, error) {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := LookupDimension(id, ProviderReadiness{}); !ok {
			return nil, fmt.Errorf("fuse dimension %q is not a declared index dimension", id)
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	if len(out) < 2 {
		return nil, fmt.Errorf("fuse requires at least two dimensions")
	}
	return out, nil
}

// NormalizeConstructAxes accepts an empty list as "all lexical axes" and
// rejects unknown names. Duplicates are dropped in declaration order.
func NormalizeConstructAxes(axes []string) ([]string, error) {
	if len(axes) == 0 {
		return append([]string(nil), LexicalConstructAxes...), nil
	}
	allowed := make(map[string]struct{}, len(LexicalConstructAxes))
	for _, axis := range LexicalConstructAxes {
		allowed[axis] = struct{}{}
	}
	seen := map[string]struct{}{}
	normalized := make([]string, 0, len(axes))
	for _, axis := range axes {
		axis = strings.TrimSpace(strings.ToLower(axis))
		if axis == "" {
			continue
		}
		if _, ok := allowed[axis]; !ok {
			return nil, fmt.Errorf("construct axis %q is not a lexical field", axis)
		}
		if _, ok := seen[axis]; ok {
			continue
		}
		seen[axis] = struct{}{}
		normalized = append(normalized, axis)
	}
	if len(normalized) == 0 {
		return append([]string(nil), LexicalConstructAxes...), nil
	}
	return normalized, nil
}

// NormalizeFilters trims structured constraints, rejects invalid numeric
// ranges, and rejects a media_class outside the closed vocabulary. It is the
// search-package contract; the control plane performs the same validation so a
// malformed request fails before any generation lookup.
func NormalizeFilters(f Filters) (Filters, error) {
	f.EntryType = strings.TrimSpace(strings.ToUpper(f.EntryType))
	f.ContentID = strings.TrimSpace(f.ContentID)
	f.DuplicateGroup = strings.TrimSpace(f.DuplicateGroup)
	f.ProtectionMode = strings.TrimSpace(strings.ToUpper(f.ProtectionMode))
	f.Language = strings.TrimSpace(f.Language)
	f.Suffix = strings.TrimSpace(strings.ToLower(f.Suffix))
	mediaClass, err := NormalizeMediaClass(f.MediaClass)
	if err != nil {
		return f, err
	}
	f.MediaClass = mediaClass
	if f.SizeMin != nil && f.SizeMax != nil && *f.SizeMin > *f.SizeMax {
		return f, errors.New("size_min must not exceed size_max")
	}
	if f.MtimeAfter != nil && f.MtimeBefore != nil && *f.MtimeAfter > *f.MtimeBefore {
		return f, errors.New("mtime_after must not exceed mtime_before")
	}
	if f.SizeMin != nil && *f.SizeMin < 0 {
		return f, errors.New("size_min cannot be negative")
	}
	if f.SizeMax != nil && *f.SizeMax < 0 {
		return f, errors.New("size_max cannot be negative")
	}
	return f, nil
}
