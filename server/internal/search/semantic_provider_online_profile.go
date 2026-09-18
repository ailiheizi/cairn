package search

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

// onlineInstructionFieldPattern admits only a plain lowercase JSON field name
// for the vendor instruction field.
var onlineInstructionFieldPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)

// Online embedding profiles
//
// `semantic.online_profile` names one immutable online embedding profile
// manifest. Like the local BGE bundle descriptor, the manifest pins every fact
// that can change produced vectors: endpoint identity, provider identity,
// model id and revision, output dimension, input type and instruction text,
// document/query prefixes, normalization, distance, element type, batching,
// and timeout. The config chooses the profile by name; it never partially
// overrides its meaning.
//
// A space is the tuple (model id, model revision, dimensions, input
// type/instruction, normalization). The same vendor with a different
// dimension, instruction, or normalization is a different space. The
// SpaceFingerprint below is that tuple; its digest is the provider identity
// recorded in EmbeddingGenerationManifest.ProviderDigest, and its readable
// form is EmbeddingGenerationManifest.SemanticSpace. Changing any
// space-affecting field therefore creates a new generation and never
// reinterprets previously stored vectors.

const (
	// OnlineEmbeddingProfileSchemaV1 is the only online profile schema
	// accepted by this package.
	OnlineEmbeddingProfileSchemaV1 = "restoreweave.online-embedding-profile.v1"

	// OnlineEmbeddingProfileDirName and OnlineEmbeddingProfileFileName are the
	// only accepted location below the configured paths.models root:
	// <models>/online-embedding/<profile_id>/profile.json. An online profile
	// is a text manifest, not an executable and not a model artifact, so it
	// uses no platform-arch subdirectory.
	OnlineEmbeddingProfileDirName  = "online-embedding"
	OnlineEmbeddingProfileFileName = "profile.json"

	// OnlineEmbeddingProfileMaxBytes bounds the strict manifest decode.
	OnlineEmbeddingProfileMaxBytes = uint64(256 << 10)

	// OnlineEmbeddingAPIStyleOpenAI is the only admitted HTTP request shape.
	// The provider speaks the OpenAI embeddings JSON shape, which the vendor
	// research identifies as the dependency-free common denominator for the
	// text-embedding vendors in scope (Voyage, Cohere, and the Chinese
	// vendors' compatible modes).
	OnlineEmbeddingAPIStyleOpenAI = "openai-embeddings-v1"

	OnlineEmbeddingInputTypeDocument = "document"
	OnlineEmbeddingInputTypeQuery    = "query"

	OnlineEmbeddingNormalizationL2   = "l2"
	OnlineEmbeddingNormalizationNone = "none"

	OnlineEmbeddingDistanceCosine = "cosine"
	OnlineEmbeddingDistanceDot    = "dot"

	// OnlineEmbeddingElementType is the only admitted element type in the
	// current profile.
	OnlineEmbeddingElementType = "float32"

	// OnlineEmbeddingTrainingUseUnknown is the honest declaration for a vendor
	// whose training-use policy cannot be verified. It is recorded in the
	// space fingerprint's provider identity and in every egress receipt; it is
	// never silently treated as "no training".
	OnlineEmbeddingTrainingUseUnknown = "unknown"
)

// ErrInvalidOnlineEmbeddingProfile identifies a profile manifest that cannot
// safely describe an online embedding space.
var ErrInvalidOnlineEmbeddingProfile = errors.New("invalid online embedding profile")

// OnlineEmbeddingProfile is one immutable, operator-installed online
// embedding profile. It contains no credential material: the profile names
// the endpoint, and the credential is a separate host secret reference.
type OnlineEmbeddingProfile struct {
	Schema    string `json:"schema"`
	ProfileID string `json:"profile_id"`
	// Provider is the vendor or aggregator identity ("voyage", "cohere",
	// "dashscope", "siliconflow", "provider-managed", ...). It is part of the
	// space fingerprint because the same model id served by a different
	// recipient is a different disclosure.
	Provider string `json:"provider"`
	APIStyle string `json:"api_style"`
	// Endpoint is the absolute request URL. Non-loopback endpoints must use
	// https; userinfo, query parameters, and fragments are rejected so a
	// destination cannot smuggle access material.
	Endpoint string `json:"endpoint"`
	ModelID  string `json:"model_id"`
	// ModelRevision pins the vendor revision/version string. It is required:
	// a silent vendor model update is a different space and must be recorded
	// as one.
	ModelRevision string `json:"model_revision"`
	Dimension     int    `json:"dimension"`
	// InputType records whether the vendor endpoint embeds documents or
	// queries by default.
	InputType string `json:"input_type"`
	// Instruction is the vendor task instruction/`instruct` value, when the
	// vendor has one. It is space-affecting: the same model with a different
	// instruction is a different space.
	Instruction string `json:"instruction"`
	// InstructionField names the JSON request field that carries Instruction
	// (for example "input_type" or "instruct"). When it is empty no
	// instruction field is sent and Instruction must also be empty, so the
	// recorded fingerprint can never claim an instruction that was not sent.
	InstructionField string `json:"instruction_field"`
	// DocumentPrefix and QueryPrefix are applied to input text exactly as the
	// local profile applies its BGE query prefix. They are space-affecting.
	DocumentPrefix string `json:"document_prefix"`
	QueryPrefix    string `json:"query_prefix"`
	Normalization  string `json:"normalization"`
	Distance       string `json:"distance"`
	ElementType    string `json:"element_type"`
	// Pooling is the vendor's declared pooling ("provider-managed" when the
	// vendor does not publish it). Recorded, never inferred.
	Pooling string `json:"pooling"`
	// Tokenizer is the vendor tokenizer identity ("provider-managed" when not
	// published). Recorded, never inferred.
	Tokenizer string `json:"tokenizer"`
	// SendDimensions asks the provider to return a specific dimension for
	// vendors with a dimensions/matryoshka parameter.
	SendDimensions bool `json:"send_dimensions"`
	MaxBatchInputs int  `json:"max_batch_inputs"`
	TimeoutMS      int  `json:"timeout_ms"`
	// RetentionDeclaration and TrainingUse are the vendor policy references
	// the operator recorded. They are required so an unverified policy is
	// visible as a declaration, never assumed benign.
	RetentionDeclaration string `json:"retention_declaration"`
	TrainingUse          string `json:"training_use"`
}

// OnlineSpaceFingerprint is the tuple that defines a retrieval space. Two
// vectors may only be compared when their fingerprints are identical.
type OnlineSpaceFingerprint struct {
	Provider         string `json:"provider"`
	APIStyle         string `json:"api_style"`
	ModelID          string `json:"model_id"`
	ModelRevision    string `json:"model_revision"`
	Dimension        int    `json:"dimension"`
	InputType        string `json:"input_type"`
	Instruction      string `json:"instruction"`
	InstructionField string `json:"instruction_field"`
	DocumentPrefix   string `json:"document_prefix"`
	QueryPrefix      string `json:"query_prefix"`
	Normalization    string `json:"normalization"`
	Distance         string `json:"distance"`
	ElementType      string `json:"element_type"`
}

// CanonicalDigest returns the stable digest of the space tuple. It is the
// identity stored in EmbeddingGenerationManifest.ProviderDigest for an online
// provider.
func (f OnlineSpaceFingerprint) CanonicalDigest() string {
	payload, _ := json.Marshal(f)
	h := sha256.Sum256(append([]byte("restoreweave.online-embedding-space.v1\n"), payload...))
	return "sha256:" + hex.EncodeToString(h[:])
}

// SpaceID is the readable space identifier stored in
// EmbeddingGenerationManifest.SemanticSpace. It is deliberately
// human-inspectable (provider, model, revision, dimension, normalization)
// and carries a short digest suffix of the complete space tuple, so two
// profiles that differ only in instruction or prefix cannot share a space
// label. The full tuple digest is CanonicalDigest.
func (f OnlineSpaceFingerprint) SpaceID() string {
	raw := "online-embedding:" + f.Provider + "/" + f.ModelID + "@" + f.ModelRevision +
		"-" + itoa(f.Dimension) + "d-" + f.Normalization + "-" + shortFingerprintDigest(f.CanonicalDigest())
	return sanitizeOnlineSpaceID(raw)
}

func shortFingerprintDigest(digest string) string {
	trimmed := strings.TrimPrefix(digest, "sha256:")
	if len(trimmed) > 12 {
		trimmed = trimmed[:12]
	}
	return trimmed
}

func sanitizeOnlineSpaceID(value string) string {
	var b strings.Builder
	b.Grow(len(value))
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case strings.ContainsRune("._@:+-", r):
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	out := b.String()
	if len(out) > 160 {
		out = out[:160]
	}
	return out
}

func itoa(value int) string {
	return fmt.Sprintf("%d", value)
}

// Fingerprint returns the space tuple of a validated profile.
func (p OnlineEmbeddingProfile) Fingerprint() OnlineSpaceFingerprint {
	return OnlineSpaceFingerprint{
		Provider: p.Provider, APIStyle: p.APIStyle,
		ModelID: p.ModelID, ModelRevision: p.ModelRevision,
		Dimension: p.Dimension, InputType: p.InputType,
		Instruction: p.Instruction, InstructionField: p.InstructionField,
		DocumentPrefix: p.DocumentPrefix, QueryPrefix: p.QueryPrefix,
		Normalization: p.Normalization, Distance: p.Distance, ElementType: p.ElementType,
	}
}

// ProviderProfileDigest binds the complete immutable profile (including
// endpoint identity and the declared policy references), not only the space
// tuple. Replacing the manifest therefore cannot reinterpret old provider
// facts even when the space tuple is unchanged.
func (p OnlineEmbeddingProfile) ProviderProfileDigest() string {
	payload, _ := json.Marshal(p)
	h := sha256.Sum256(append([]byte("restoreweave.online-embedding-profile.v1\n"), payload...))
	return "sha256:" + hex.EncodeToString(h[:])
}

// EndpointHost returns the sanitized destination authority (host[:port]) for
// receipts and diagnostics. It never contains userinfo or query material.
func (p OnlineEmbeddingProfile) EndpointHost() string {
	parsed, err := url.Parse(p.Endpoint)
	if err != nil || parsed.Host == "" {
		return ""
	}
	return parsed.Host
}

func digestOfString(prefix string, parts ...string) string {
	h := sha256.New()
	h.Write([]byte(prefix))
	for _, part := range parts {
		h.Write([]byte{0})
		h.Write([]byte(part))
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil))
}

// EmbeddingGenerationManifest returns the complete output-affecting binding
// for this online profile. It is the same identity shape the local bundle
// produces; the digests name provider-managed facts instead of local
// artifacts, so a local and an online generation can never be confused.
func (p OnlineEmbeddingProfile) EmbeddingGenerationManifest(configDigest string) (EmbeddingGenerationManifest, error) {
	if err := p.Validate(); err != nil {
		return EmbeddingGenerationManifest{}, err
	}
	if strings.TrimSpace(configDigest) == "" {
		return EmbeddingGenerationManifest{}, fmt.Errorf("%w: config digest is required", ErrInvalidOnlineEmbeddingProfile)
	}
	fingerprint := p.Fingerprint()
	return EmbeddingGenerationManifest{
		RuntimeDigest:       "provider-managed:" + digestOfString("restoreweave.online-endpoint.v1", p.Provider, p.APIStyle, p.Endpoint),
		ModelDigest:         digestOfString("restoreweave.online-model.v1", p.Provider, p.ModelID, p.ModelRevision),
		TokenizerDigest:     "provider-managed:" + strings.TrimSpace(p.Tokenizer),
		PreprocessingDigest: digestOfString("restoreweave.online-preprocessing.v1", p.InputType, p.Instruction, p.InstructionField, p.DocumentPrefix, p.QueryPrefix),
		Pooling:             strings.TrimSpace(p.Pooling),
		Normalization:       p.Normalization,
		ElementType:         p.ElementType,
		Dimension:           p.Dimension,
		VectorSchema:        p.ElementType + ":" + itoa(p.Dimension),
		SemanticSpace:       fingerprint.SpaceID(),
		Distance:            p.Distance,
		IndexConfig:         "hnsw:m=16",
		QueryConfig:         "ef=64",
		ProviderDigest:      p.ProviderProfileDigest(),
		ConfigDigest:        configDigest,
	}, nil
}

// Validate rejects an incomplete or unsafe profile before it can describe a
// production space. Empty values are not meaningful defaults.
func (p OnlineEmbeddingProfile) Validate() error {
	if p.Schema != OnlineEmbeddingProfileSchemaV1 {
		return fmt.Errorf("%w: schema must be %q", ErrInvalidOnlineEmbeddingProfile, OnlineEmbeddingProfileSchemaV1)
	}
	if err := validateOnlineProfileID("profile_id", p.ProfileID); err != nil {
		return err
	}
	if err := validateOnlineProfileToken("provider", p.Provider, 64); err != nil {
		return err
	}
	if p.APIStyle != OnlineEmbeddingAPIStyleOpenAI {
		return fmt.Errorf("%w: api_style %q is not supported (want %q)", ErrInvalidOnlineEmbeddingProfile, p.APIStyle, OnlineEmbeddingAPIStyleOpenAI)
	}
	if err := validateOnlineEmbeddingEndpoint(p.Endpoint); err != nil {
		return err
	}
	if err := validateOnlineProfileToken("model_id", p.ModelID, 200); err != nil {
		return err
	}
	if err := validateOnlineProfileToken("model_revision", p.ModelRevision, 200); err != nil {
		return err
	}
	if p.Dimension <= 0 || p.Dimension > 8192 {
		return fmt.Errorf("%w: dimension %d is outside 1..8192", ErrInvalidOnlineEmbeddingProfile, p.Dimension)
	}
	switch p.InputType {
	case OnlineEmbeddingInputTypeDocument, OnlineEmbeddingInputTypeQuery:
	default:
		return fmt.Errorf("%w: input_type %q must be document or query", ErrInvalidOnlineEmbeddingProfile, p.InputType)
	}
	if p.InstructionField == "" && strings.TrimSpace(p.Instruction) != "" {
		return fmt.Errorf("%w: instruction requires instruction_field naming the request field that carries it", ErrInvalidOnlineEmbeddingProfile)
	}
	if p.InstructionField != "" {
		if !onlineInstructionFieldPattern.MatchString(p.InstructionField) {
			return fmt.Errorf("%w: instruction_field must be a lowercase JSON field name", ErrInvalidOnlineEmbeddingProfile)
		}
		if strings.TrimSpace(p.Instruction) == "" {
			return fmt.Errorf("%w: instruction_field requires a non-empty instruction", ErrInvalidOnlineEmbeddingProfile)
		}
	}
	for name, value := range map[string]string{
		"instruction":     p.Instruction,
		"document_prefix": p.DocumentPrefix,
		"query_prefix":    p.QueryPrefix,
	} {
		if len(value) > 512 {
			return fmt.Errorf("%w: %s exceeds 512 bytes", ErrInvalidOnlineEmbeddingProfile, name)
		}
		if utf8.ValidString(value) == false || strings.ContainsRune(value, 0) {
			return fmt.Errorf("%w: %s must be valid text without NUL", ErrInvalidOnlineEmbeddingProfile, name)
		}
	}
	switch p.Normalization {
	case OnlineEmbeddingNormalizationL2, OnlineEmbeddingNormalizationNone:
	default:
		return fmt.Errorf("%w: normalization %q must be l2 or none", ErrInvalidOnlineEmbeddingProfile, p.Normalization)
	}
	switch p.Distance {
	case OnlineEmbeddingDistanceCosine:
		// A cosine index requires normalized vectors; a profile that claims
		// cosine over an unnormalized space would silently change scores.
		if p.Normalization != OnlineEmbeddingNormalizationL2 {
			return fmt.Errorf("%w: distance cosine requires normalization l2", ErrInvalidOnlineEmbeddingProfile)
		}
	case OnlineEmbeddingDistanceDot:
	default:
		return fmt.Errorf("%w: distance %q must be cosine or dot", ErrInvalidOnlineEmbeddingProfile, p.Distance)
	}
	if p.ElementType != OnlineEmbeddingElementType {
		return fmt.Errorf("%w: element_type %q must be %q", ErrInvalidOnlineEmbeddingProfile, p.ElementType, OnlineEmbeddingElementType)
	}
	if err := validateOnlineProfileToken("pooling", p.Pooling, 64); err != nil {
		return err
	}
	if err := validateOnlineProfileToken("tokenizer", p.Tokenizer, 200); err != nil {
		return err
	}
	if p.MaxBatchInputs <= 0 || p.MaxBatchInputs > 256 {
		return fmt.Errorf("%w: max_batch_inputs %d is outside 1..256", ErrInvalidOnlineEmbeddingProfile, p.MaxBatchInputs)
	}
	if p.TimeoutMS < 1000 || p.TimeoutMS > 600000 {
		return fmt.Errorf("%w: timeout_ms %d is outside 1000..600000", ErrInvalidOnlineEmbeddingProfile, p.TimeoutMS)
	}
	if err := validateOnlineProfileToken("retention_declaration", p.RetentionDeclaration, 256); err != nil {
		return err
	}
	if err := validateOnlineProfileToken("training_use", p.TrainingUse, 64); err != nil {
		return err
	}
	return nil
}

// validateOnlineEmbeddingEndpoint keeps the destination explicit and
// transport-safe. Loopback http is admitted for a local stub; every other
// destination must be https, and no endpoint may carry userinfo, a query, or
// a fragment.
func validateOnlineEmbeddingEndpoint(endpoint string) error {
	if strings.TrimSpace(endpoint) == "" || strings.TrimSpace(endpoint) != endpoint {
		return fmt.Errorf("%w: endpoint is required", ErrInvalidOnlineEmbeddingProfile)
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return fmt.Errorf("%w: endpoint: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	if parsed.Opaque != "" {
		return fmt.Errorf("%w: endpoint must be a hierarchical URL", ErrInvalidOnlineEmbeddingProfile)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return fmt.Errorf("%w: endpoint scheme %q must be https (http is admitted only for loopback)", ErrInvalidOnlineEmbeddingProfile, parsed.Scheme)
	}
	if parsed.User != nil {
		return fmt.Errorf("%w: endpoint must not contain userinfo; use the credential reference", ErrInvalidOnlineEmbeddingProfile)
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("%w: endpoint must not contain a query or fragment; use the credential reference", ErrInvalidOnlineEmbeddingProfile)
	}
	host := parsed.Hostname()
	if host == "" {
		return fmt.Errorf("%w: endpoint host is required", ErrInvalidOnlineEmbeddingProfile)
	}
	if parsed.Scheme != "https" {
		if !onlineEndpointHostIsLoopback(host) {
			return fmt.Errorf("%w: endpoint %q must use https unless the host is loopback", ErrInvalidOnlineEmbeddingProfile, parsed.Host)
		}
	}
	if strings.Contains(parsed.EscapedPath(), "..") {
		return fmt.Errorf("%w: endpoint path must not contain parent segments", ErrInvalidOnlineEmbeddingProfile)
	}
	return nil
}

func onlineEndpointHostIsLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// validateOnlineProfileID accepts the profile name used as one path
// component below the models root. It rejects separators, dot segments,
// whitespace, and control characters.
func validateOnlineProfileID(name, value string) error {
	if err := validateOnlineProfileToken(name, value, 128); err != nil {
		return err
	}
	if value == "." || value == ".." || strings.ContainsAny(value, `/\`) {
		return fmt.Errorf("%w: %s must be a single path-safe name", ErrInvalidOnlineEmbeddingProfile, name)
	}
	return nil
}

func validateOnlineProfileToken(name, value string, max int) error {
	if strings.TrimSpace(value) == "" || strings.TrimSpace(value) != value {
		return fmt.Errorf("%w: %s is required", ErrInvalidOnlineEmbeddingProfile, name)
	}
	if len(value) > max {
		return fmt.Errorf("%w: %s exceeds %d bytes", ErrInvalidOnlineEmbeddingProfile, name, max)
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return fmt.Errorf("%w: %s must not contain control characters", ErrInvalidOnlineEmbeddingProfile, name)
		}
	}
	return nil
}

// ParseOnlineEmbeddingProfile strictly decodes one profile manifest. Unknown
// fields are refused so a descriptor cannot carry unreviewed meaning.
func ParseOnlineEmbeddingProfile(payload []byte) (OnlineEmbeddingProfile, error) {
	if len(payload) == 0 || uint64(len(payload)) > OnlineEmbeddingProfileMaxBytes {
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: descriptor size %d is outside bounds", ErrInvalidOnlineEmbeddingProfile, len(payload))
	}
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	var profile OnlineEmbeddingProfile
	if err := decoder.Decode(&profile); err != nil {
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: decode descriptor: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return OnlineEmbeddingProfile{}, fmt.Errorf("%w: descriptor contains more than one JSON value", ErrInvalidOnlineEmbeddingProfile)
		}
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: read descriptor: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	if err := profile.Validate(); err != nil {
		return OnlineEmbeddingProfile{}, err
	}
	return profile, nil
}

// OnlineEmbeddingProfilePath returns the only accepted location of one
// profile manifest below the configured models root.
func OnlineEmbeddingProfilePath(modelsRoot, profileID string) (string, error) {
	if strings.TrimSpace(modelsRoot) == "" || !filepath.IsAbs(modelsRoot) || filepath.Clean(modelsRoot) != modelsRoot {
		return "", fmt.Errorf("%w: models root must be an absolute canonical path", ErrInvalidOnlineEmbeddingProfile)
	}
	if err := validateOnlineProfileID("profile_id", profileID); err != nil {
		return "", err
	}
	return filepath.Join(modelsRoot, OnlineEmbeddingProfileDirName, profileID, OnlineEmbeddingProfileFileName), nil
}

// LoadOnlineEmbeddingProfile reads and admits one operator-installed online
// embedding profile. The manifest is opened without following symlinks and is
// strictly decoded; the declared profile_id must match the selected name so a
// config reference cannot resolve to a different profile's meaning. No
// network call is made here, and no credential is read.
func LoadOnlineEmbeddingProfile(modelsRoot, profileID string) (OnlineEmbeddingProfile, error) {
	_, err := OnlineEmbeddingProfilePath(modelsRoot, profileID)
	if err != nil {
		return OnlineEmbeddingProfile{}, err
	}
	dir := filepath.Join(modelsRoot, OnlineEmbeddingProfileDirName, profileID)
	info, err := os.Lstat(dir)
	if err != nil {
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: profile %q is not installed: %v", ErrInvalidOnlineEmbeddingProfile, profileID, err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: profile %q root must be a real directory", ErrInvalidOnlineEmbeddingProfile, profileID)
	}
	file, err := openBundleFileNoFollow(dir, OnlineEmbeddingProfileFileName)
	if err != nil {
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: open descriptor: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: stat descriptor: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	if !stat.Mode().IsRegular() || stat.Size() <= 0 || uint64(stat.Size()) > OnlineEmbeddingProfileMaxBytes {
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: descriptor must be a regular file inside the size bounds", ErrInvalidOnlineEmbeddingProfile)
	}
	payload, err := io.ReadAll(io.LimitReader(file, int64(OnlineEmbeddingProfileMaxBytes)+1))
	if err != nil {
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: read descriptor: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	profile, err := ParseOnlineEmbeddingProfile(payload)
	if err != nil {
		return OnlineEmbeddingProfile{}, err
	}
	if profile.ProfileID != profileID {
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: descriptor profile_id %q does not match selected profile %q", ErrInvalidOnlineEmbeddingProfile, profile.ProfileID, profileID)
	}
	return profile, nil
}
