package search

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync/atomic"
	"time"
)

// Online embedding provider and the single egress gate
//
// The provider implements the same SemanticEmbeddingProvider contract as the
// local ONNX worker. It differs in exactly one respect: vectors are produced
// by a remote service, so every request must pass the egress gate below.
//
// Gate conditions, all evaluated in admitOnlineEgress:
//
//	(a) semantic.embedding_mode is online or hybrid;
//	(b) the immutable online profile resolves and is valid;
//	(c) the host credential reference resolves;
//	(d) semantic.send_content_without_confirmation is true, or the specific
//	    request carries an explicit SemanticEgressConfirmation;
//	(e) every document subject is allowed by the host protection policy
//	    (LINK_ONLY_UNPROTECTED and every other unprotected or unknown outcome
//	    is refused);
//	(f) an append-only audit sink is attached.
//
// A refusal is a typed *SemanticEgressRefusedError that names the failed
// condition, and it is raised before any HTTP request is built. The only code
// path that performs the network call is performPermittedEgress, which
// requires an egressPermit produced by the gate and verifies that the permit
// binds the exact request bytes. There is no fallback: a refusal never
// degrades into a local model, a fixture vector, or another space.

// SemanticEgressReason is a stable, operator-facing reason code for a refused
// or failed remote embedding.
type SemanticEgressReason string

const (
	EgressReasonModeNotOnline          SemanticEgressReason = "EGRESS_MODE_NOT_ONLINE"
	EgressReasonProfileUnresolved      SemanticEgressReason = "EGRESS_PROFILE_UNRESOLVED"
	EgressReasonCredentialUnresolved   SemanticEgressReason = "EGRESS_CREDENTIAL_UNRESOLVED"
	EgressReasonConfirmationRequired   SemanticEgressReason = "EGRESS_CONFIRMATION_REQUIRED"
	EgressReasonConfirmationMismatch   SemanticEgressReason = "EGRESS_CONFIRMATION_MISMATCH"
	EgressReasonSubjectPolicyUnavail   SemanticEgressReason = "EGRESS_SUBJECT_POLICY_UNAVAILABLE"
	EgressReasonSubjectUnknown         SemanticEgressReason = "EGRESS_SUBJECT_UNKNOWN"
	EgressReasonSubjectUnprotected     SemanticEgressReason = "EGRESS_SUBJECT_UNPROTECTED"
	EgressReasonSubjectBlocked         SemanticEgressReason = "EGRESS_SUBJECT_BLOCKED"
	EgressReasonAuditUnavailable       SemanticEgressReason = "EGRESS_AUDIT_UNAVAILABLE"
	EgressReasonProviderUnreachable    SemanticEgressReason = "EGRESS_PROVIDER_UNREACHABLE"
	EgressReasonProviderTimeout        SemanticEgressReason = "EGRESS_PROVIDER_TIMEOUT"
	EgressReasonProviderQuota          SemanticEgressReason = "EGRESS_PROVIDER_QUOTA_EXCEEDED"
	EgressReasonProviderRejected       SemanticEgressReason = "EGRESS_PROVIDER_REJECTED"
	EgressReasonProviderError          SemanticEgressReason = "EGRESS_PROVIDER_ERROR"
	EgressReasonProviderRedirect       SemanticEgressReason = "EGRESS_PROVIDER_REDIRECT_REFUSED"
	EgressReasonResponseMalformed      SemanticEgressReason = "EGRESS_RESPONSE_MALFORMED"
	EgressReasonDimensionMismatch      SemanticEgressReason = "EGRESS_RESPONSE_DIMENSION_MISMATCH"
	EgressReasonSpaceMismatch          SemanticEgressReason = "EGRESS_RESPONSE_SPACE_MISMATCH"
	EgressReasonInvalidVector          SemanticEgressReason = "EGRESS_RESPONSE_INVALID_VECTOR"
	EgressReasonRequestInvalid         SemanticEgressReason = "EGRESS_REQUEST_INVALID"
	EgressReasonReceiptUnrecorded      SemanticEgressReason = "EGRESS_RECEIPT_UNRECORDED"
	EgressReasonSpaceUnbound           SemanticEgressReason = "EGRESS_SPACE_UNBOUND"
	EgressReasonModeInvalid            SemanticEgressReason = "EGRESS_MODE_INVALID"
	EgressReasonProviderProfileChanged SemanticEgressReason = "EGRESS_PROVIDER_PROFILE_CHANGED"
)

// Egress outcome vocabulary for the append-only receipt.
const (
	SemanticEgressOutcomeSucceeded = "SUCCEEDED"
	SemanticEgressOutcomeFailed    = "FAILED"
)

// Egress authorization vocabulary. The receipt records which of the two
// admitted authorizations permitted the disclosure.
const (
	// SemanticEgressAuthorizationConfig means
	// semantic.send_content_without_confirmation=true allowed the request.
	SemanticEgressAuthorizationConfig = "CONFIG_SEND_WITHOUT_CONFIRMATION"
	// SemanticEgressAuthorizationRequest means the specific request carried an
	// explicit per-request confirmation.
	SemanticEgressAuthorizationRequest = "PER_REQUEST_CONFIRMATION"
)

// SemanticEgressRefusedError is the typed, visible refusal raised by the gate.
// Its message names the failed condition and never contains payload text or
// credential material.
type SemanticEgressRefusedError struct {
	Reason    SemanticEgressReason
	Condition string
	Detail    string
}

func (e *SemanticEgressRefusedError) Error() string {
	if e == nil {
		return string(EgressReasonAuditUnavailable)
	}
	message := string(e.Reason)
	if strings.TrimSpace(e.Condition) != "" {
		message += " (" + e.Condition + ")"
	}
	if strings.TrimSpace(e.Detail) != "" {
		message += ": " + e.Detail
	}
	return message
}

// Unwrap keeps the existing degradation contract: a refused remote embedding
// is an unavailable semantic component, never a silent success.
func (e *SemanticEgressRefusedError) Unwrap() error { return ErrSemanticProviderUnavailable }

// EgressReason implements the reason carrier used by SemanticEgressReasonOf.
func (e *SemanticEgressRefusedError) EgressReason() SemanticEgressReason {
	if e == nil {
		return ""
	}
	return e.Reason
}

// semanticEgressReasonCarrier is implemented by every typed error that names
// one stable egress reason.
type semanticEgressReasonCarrier interface {
	EgressReason() SemanticEgressReason
}

// SemanticEgressReasonOf extracts the stable reason of a refusal or failure.
func SemanticEgressReasonOf(err error) SemanticEgressReason {
	var carrier semanticEgressReasonCarrier
	if errors.As(err, &carrier) {
		return carrier.EgressReason()
	}
	return ""
}

func refusedEgress(reason SemanticEgressReason, condition, detail string) error {
	return &SemanticEgressRefusedError{Reason: reason, Condition: condition, Detail: detail}
}

// SemanticEgressConfirmation is one explicit, per-request authorization to
// disclose exactly one embedding request. It binds the provider profile,
// endpoint, model id, purpose, and the content digest of the request inputs,
// so a confirmation for one disclosure cannot authorize another.
type SemanticEgressConfirmation struct {
	ProviderProfileID string
	Endpoint          string
	ModelID           string
	Purpose           SemanticEmbeddingPurpose
	ContentDigest     string
	ConfirmedAt       time.Time
	ExpiresAt         time.Time
}

type semanticEgressConfirmationKey struct{}

// WithSemanticEgressConfirmation attaches one explicit per-request
// confirmation to a context. The host (CLI, API, or a review step) creates it
// only after the operator approved the named provider, endpoint, model, and
// content digest.
func WithSemanticEgressConfirmation(ctx context.Context, confirmation SemanticEgressConfirmation) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, semanticEgressConfirmationKey{}, confirmation)
}

// SemanticEgressConfirmationFrom returns the attached per-request
// confirmation, if any.
func SemanticEgressConfirmationFrom(ctx context.Context) (SemanticEgressConfirmation, bool) {
	if ctx == nil {
		return SemanticEgressConfirmation{}, false
	}
	confirmation, ok := ctx.Value(semanticEgressConfirmationKey{}).(SemanticEgressConfirmation)
	return confirmation, ok
}

// SemanticEgressContentDigest is the digest a per-request confirmation binds.
// It covers the ordered subject, segment, and text of every input and is the
// same value recorded as request_digest in every egress receipt.
func SemanticEgressContentDigest(inputs []SemanticTextInput) string {
	h := sha256.New()
	writeLengthPrefixed(h, []byte("restoreweave.semantic-egress-content.v1"))
	for _, input := range inputs {
		writeLengthPrefixed(h, []byte(input.SubjectID))
		writeLengthPrefixed(h, []byte(input.SegmentID))
		writeLengthPrefixed(h, []byte(input.Text))
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil))
}

func writeLengthPrefixed(w io.Writer, payload []byte) {
	var size [8]byte
	binary.BigEndian.PutUint64(size[:], uint64(len(payload)))
	_, _ = w.Write(size[:])
	_, _ = w.Write(payload)
}

// SemanticEgressRecord is the append-only receipt for one attempted remote
// embedding request. It deliberately has no payload field: it records
// digests, byte counts, identities, authorizations, timestamps, and the
// outcome classification, never the text that was sent.
type SemanticEgressRecord struct {
	ProviderProfile        string               `json:"provider_profile"`
	ProviderProfileDigest  string               `json:"provider_profile_digest"`
	SpaceFingerprint       string               `json:"space_fingerprint"`
	SpaceFingerprintDigest string               `json:"space_fingerprint_digest"`
	ModelID                string               `json:"model_id"`
	ModelRevision          string               `json:"model_revision"`
	Dimension              int                  `json:"dimension"`
	InputType              string               `json:"input_type"`
	Instruction            string               `json:"instruction,omitempty"`
	Normalization          string               `json:"normalization"`
	APIStyle               string               `json:"api_style"`
	EndpointHost           string               `json:"endpoint_host"`
	TrainingUse            string               `json:"training_use"`
	RetentionDeclaration   string               `json:"retention_declaration"`
	Purpose                string               `json:"purpose"`
	GenerationID           string               `json:"generation_id,omitempty"`
	ItemCount              int                  `json:"item_count"`
	TextBytes              int64                `json:"text_bytes"`
	TextDigests            []string             `json:"text_digests"`
	RequestDigest          string               `json:"request_digest"`
	PayloadDigest          string               `json:"payload_digest"`
	PayloadBytes           int64                `json:"payload_bytes"`
	Authorization          string               `json:"authorization"`
	HTTPStatus             int                  `json:"http_status,omitempty"`
	Outcome                string               `json:"outcome"`
	Reason                 SemanticEgressReason `json:"reason,omitempty"`
	ProviderErrorClass     string               `json:"provider_error_class,omitempty"`
	StartedAt              time.Time            `json:"started_at"`
	CompletedAt            time.Time            `json:"completed_at"`
}

// SemanticEgressAuditSink appends one receipt per attempted egress. The host
// supplies an append-only implementation; a nil sink makes every egress
// refuse, so content can never leave the process unrecorded.
type SemanticEgressAuditSink interface {
	RecordSemanticEgress(ctx context.Context, record SemanticEgressRecord) error
}

// SemanticEgressSubjectPolicy is the host-owned protection authority. It must
// fail closed: an unknown subject, an unavailable catalog, or any unprotected
// outcome reports allowed=false with a stable reason.
type SemanticEgressSubjectPolicy interface {
	SemanticEgressSubjectAllowed(ctx context.Context, subjectID string) (allowed bool, reason SemanticEgressReason, detail string)
}

// OnlineEmbeddingProviderOptions constructs one online provider.
type OnlineEmbeddingProviderOptions struct {
	// Mode is the configured embedding mode: online or hybrid.
	Mode string
	// Profile is the admitted immutable online profile.
	Profile OnlineEmbeddingProfile
	// Manifest is the generation manifest derived from Profile, including the
	// host config digest.
	Manifest EmbeddingGenerationManifest
	// CredentialRef is the host secret reference, never a secret.
	CredentialRef string
	// CredentialResolver defaults to DefaultOnlineCredentialResolver.
	CredentialResolver OnlineCredentialResolver
	// SendContentWithoutConfirmation mirrors
	// semantic.send_content_without_confirmation. When false, every request
	// needs an explicit per-request confirmation.
	SendContentWithoutConfirmation bool
	// AuditSink is the append-only egress receipt ledger.
	AuditSink SemanticEgressAuditSink
	// SubjectPolicy resolves per-subject protection. It is required for
	// document embedding; a nil policy refuses every disclosure.
	SubjectPolicy SemanticEgressSubjectPolicy
	// HTTPClient is optional; tests inject one. The default refuses redirects
	// and uses the profile timeout.
	HTTPClient *http.Client
	// Now is optional; tests inject a clock.
	Now func() time.Time
}

// OnlineEmbeddingProvider is the HTTP-backed text embedding provider. One
// instance serves exactly one immutable space.
type OnlineEmbeddingProvider struct {
	profile        OnlineEmbeddingProfile
	manifest       EmbeddingGenerationManifest
	manifestDigest string
	mode           string
	credentialRef  string
	resolver       OnlineCredentialResolver
	sendWithout    bool
	audit          SemanticEgressAuditSink
	subjects       SemanticEgressSubjectPolicy
	client         *http.Client
	now            func() time.Time

	lastFailure atomic.Value // string
	lastReason  atomic.Value // string
}

// NewOnlineEmbeddingProvider validates the profile/manifest pair and returns a
// provider that can only egress through the gate.
func NewOnlineEmbeddingProvider(options OnlineEmbeddingProviderOptions) (*OnlineEmbeddingProvider, error) {
	mode := strings.TrimSpace(options.Mode)
	switch mode {
	case "online", "hybrid":
	default:
		return nil, refusedEgress(EgressReasonModeNotOnline, "embedding_mode",
			fmt.Sprintf("online embedding requires embedding_mode online or hybrid, got %q", options.Mode))
	}
	if err := options.Profile.Validate(); err != nil {
		return nil, refusedEgress(EgressReasonProfileUnresolved, "online_profile", err.Error())
	}
	if err := options.Manifest.Validate(); err != nil {
		return nil, refusedEgress(EgressReasonProfileUnresolved, "online_profile", "manifest: "+err.Error())
	}
	expected, err := options.Profile.EmbeddingGenerationManifest(options.Manifest.ConfigDigest)
	if err != nil {
		return nil, refusedEgress(EgressReasonProfileUnresolved, "online_profile", err.Error())
	}
	if options.Manifest.CanonicalDigest() != expected.CanonicalDigest() {
		return nil, refusedEgress(EgressReasonProfileUnresolved, "online_profile",
			"the bound generation manifest is not the selected online profile's manifest")
	}
	if _, err := OnlineCredentialRefScheme(options.CredentialRef); err != nil {
		// An empty or unsupported credential reference cannot be resolved, but
		// the provider still exists so its state is reported honestly.
		// CheckEgressReadiness and every request report this typed reason.
		if strings.TrimSpace(options.CredentialRef) == "" {
			return nil, refusedEgress(EgressReasonCredentialUnresolved, "online_credential_ref",
				"semantic.online_credential_ref is required for online embedding")
		}
		return nil, refusedEgress(EgressReasonCredentialUnresolved, "online_credential_ref", err.Error())
	}
	resolver := options.CredentialResolver
	if resolver == nil {
		resolver = DefaultOnlineCredentialResolver()
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{
			Timeout: time.Duration(options.Profile.TimeoutMS) * time.Millisecond,
			// The egress profile names one destination. A redirect would
			// silently retarget the disclosure, so it is refused rather than
			// followed.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		}
	}
	return &OnlineEmbeddingProvider{
		profile: options.Profile, manifest: options.Manifest,
		manifestDigest: options.Manifest.CanonicalDigest(),
		mode:           mode, credentialRef: options.CredentialRef, resolver: resolver,
		sendWithout: options.SendContentWithoutConfirmation,
		audit:       options.AuditSink, subjects: options.SubjectPolicy,
		client: client, now: now,
	}, nil
}

// SemanticProviderKind identifies the provider family for capability
// reporting. It is not a durable fact.
func (p *OnlineEmbeddingProvider) SemanticProviderKind() string {
	if p == nil {
		return ""
	}
	return p.mode
}

// SemanticSpaceFingerprint returns the readable space identity recorded in
// every generation manifest and receipt.
func (p *OnlineEmbeddingProvider) SemanticSpaceFingerprint() string {
	if p == nil {
		return ""
	}
	return p.profile.Fingerprint().SpaceID()
}

// Profile returns the immutable admitted profile (no credential material).
func (p *OnlineEmbeddingProvider) Profile() OnlineEmbeddingProfile {
	if p == nil {
		return OnlineEmbeddingProfile{}
	}
	return p.profile
}

// SemanticReady reports whether the provider's static gate prerequisites are
// satisfied. Per-request confirmation and per-subject protection are still
// evaluated on every request.
func (p *OnlineEmbeddingProvider) SemanticReady() bool {
	if p == nil {
		return false
	}
	if p.mode != "online" && p.mode != "hybrid" {
		return false
	}
	if p.profile.Validate() != nil || p.audit == nil || p.subjects == nil {
		return false
	}
	if _, err := OnlineCredentialRefScheme(p.credentialRef); err != nil {
		return false
	}
	return true
}

// CheckEgressReadiness reports why this provider cannot egress right now,
// without reading any secret: it validates the mode, profile, credential
// reference form, audit sink, and subject policy. It never performs a network
// call.
func (p *OnlineEmbeddingProvider) CheckEgressReadiness(_ context.Context) error {
	if p == nil {
		return refusedEgress(EgressReasonModeNotOnline, "embedding_mode", "online provider is not configured")
	}
	if p.mode != "online" && p.mode != "hybrid" {
		return refusedEgress(EgressReasonModeNotOnline, "embedding_mode", "embedding mode is not online or hybrid")
	}
	if err := p.profile.Validate(); err != nil {
		return refusedEgress(EgressReasonProfileUnresolved, "online_profile", err.Error())
	}
	if _, err := OnlineCredentialRefScheme(p.credentialRef); err != nil {
		return refusedEgress(EgressReasonCredentialUnresolved, "online_credential_ref", err.Error())
	}
	if p.audit == nil {
		return refusedEgress(EgressReasonAuditUnavailable, "audit_ledger",
			"no append-only egress ledger is attached; remote embedding cannot be recorded")
	}
	if p.subjects == nil {
		return refusedEgress(EgressReasonSubjectPolicyUnavail, "protection",
			"no subject protection policy is attached; document disclosure cannot be authorized")
	}
	return nil
}

// SemanticFailure returns the latest failure summary for operator
// diagnostics. It contains reason codes only, never payload or credentials.
func (p *OnlineEmbeddingProvider) SemanticFailure() string {
	if p == nil {
		return ""
	}
	failure, _ := p.lastFailure.Load().(string)
	return strings.TrimSpace(failure)
}

// SemanticFailureReason returns the stable reason code of the latest failure.
func (p *OnlineEmbeddingProvider) SemanticFailureReason() SemanticEgressReason {
	if p == nil {
		return ""
	}
	reason, _ := p.lastReason.Load().(string)
	return SemanticEgressReason(reason)
}

func (p *OnlineEmbeddingProvider) recordFailure(message string, reason SemanticEgressReason) {
	if p == nil {
		return
	}
	p.lastFailure.Store(message)
	p.lastReason.Store(string(reason))
}

func (p *OnlineEmbeddingProvider) clearFailure() {
	if p == nil {
		return
	}
	p.lastFailure.Store("")
	p.lastReason.Store("")
}

// Embed implements SemanticEmbeddingProvider. Every batch passes the same
// gate; a failure in any batch is reported with its stable reason and nothing
// falls back to another space.
func (p *OnlineEmbeddingProvider) Embed(ctx context.Context, request SemanticEmbeddingRequest) ([]SemanticVector, error) {
	if p == nil {
		return nil, refusedEgress(EgressReasonModeNotOnline, "embedding_mode", "online provider is not configured")
	}
	if err := validateSemanticEmbeddingRequest(request); err != nil {
		return nil, refusedEgress(EgressReasonRequestInvalid, "request", err.Error())
	}
	// The request must be bound to this provider's immutable space. A caller
	// asking for a different space is refused instead of being served with
	// vectors that would silently mismatch its index.
	if digest := request.Manifest.CanonicalDigest(); digest != p.manifestDigest {
		return nil, refusedEgress(EgressReasonProfileUnresolved, "online_profile",
			"request manifest does not match the bound online embedding space")
	}
	batchSize := p.profile.MaxBatchInputs
	if batchSize <= 0 {
		batchSize = len(request.Inputs)
	}
	requestDigest := SemanticEgressContentDigest(request.Inputs)
	results := make([]SemanticVector, 0, len(request.Inputs))
	batchCount := (len(request.Inputs) + batchSize - 1) / batchSize
	for start := 0; start < len(request.Inputs); start += batchSize {
		end := start + batchSize
		if end > len(request.Inputs) {
			end = len(request.Inputs)
		}
		batchIndex := start/batchSize + 1
		vectors, err := p.embedBatch(ctx, request.Purpose, request.GenerationID, requestDigest, batchIndex, batchCount, request.Inputs[start:end])
		if err != nil {
			return nil, err
		}
		results = append(results, vectors...)
	}
	if err := validateSemanticEmbeddingResults(request, results); err != nil {
		return nil, refusedEgress(EgressReasonInvalidVector, "response", err.Error())
	}
	p.clearFailure()
	return results, nil
}

type onlineEmbeddingResponseBody struct {
	Data []struct {
		Index     *int      `json:"index"`
		Embedding []float32 `json:"embedding"`
		Object    string    `json:"object"`
	} `json:"data"`
	Model string `json:"model"`
	Error struct {
		Code    string `json:"code"`
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error"`
}

// providerErrorClassPattern admits only a short identifier-shaped vendor error
// code or type. Vendor messages are never recorded: they can echo request
// content, so a receipt can never carry them.
var providerErrorClassPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,64}$`)

func onlineProviderErrorClass(response onlineEmbeddingResponseBody) string {
	for _, candidate := range []string{response.Error.Code, response.Error.Type} {
		if providerErrorClassPattern.MatchString(candidate) {
			return candidate
		}
	}
	return "unclassified"
}

func (p *OnlineEmbeddingProvider) embedBatch(
	ctx context.Context,
	purpose SemanticEmbeddingPurpose,
	generationID, requestDigest string,
	batchIndex, batchCount int,
	batch []SemanticTextInput,
) ([]SemanticVector, error) {
	body, err := p.buildRequestBody(purpose, batch)
	if err != nil {
		return nil, refusedEgress(EgressReasonRequestInvalid, "request", err.Error())
	}
	permit, credential, err := p.admitOnlineEgress(ctx, purpose, batch, requestDigest, body)
	if err != nil {
		p.recordFailure(fmt.Sprintf("online provider refused (batch %d/%d): %v", batchIndex, batchCount, err), SemanticEgressReasonOf(err))
		return nil, err
	}
	started := p.now().UTC()
	response, meta, callErr := p.performPermittedEgress(ctx, permit, body, credential)
	completed := p.now().UTC()

	var (
		vectors    []SemanticVector
		failReason SemanticEgressReason
		failDetail string
		errorClass string
	)
	if callErr != nil {
		reason := SemanticEgressReasonOf(callErr)
		if reason == "" {
			reason = EgressReasonProviderError
		}
		failReason = reason
		failDetail = callErr.Error()
		var httpErr *onlineHTTPStatusError
		if errors.As(callErr, &httpErr) {
			errorClass = httpErr.errorClass
		}
	} else {
		vectors, failReason, failDetail, errorClass = p.decodeOnlineEmbeddingResponse(purpose, batch, response)
	}

	// Exactly one append-only receipt per attempted egress: the receipt
	// records what was sent by digest and byte count plus the outcome.
	record := p.egressRecord(permit, purpose, generationID, batch, requestDigest, meta, started, completed, failReason, errorClass)
	receiptErr := p.recordEgressReceipt(ctx, record)

	switch {
	case failReason != "":
		p.recordFailure(fmt.Sprintf("online provider %s (batch %d/%d): %s", SemanticEgressOutcomeFailed, batchIndex, batchCount, failReason),
			failReason)
		return nil, refusedEgress(failReason, "provider", failDetail)
	case receiptErr != nil:
		p.recordFailure(fmt.Sprintf("online provider %s (batch %d/%d): %s", SemanticEgressOutcomeSucceeded, batchIndex, batchCount, EgressReasonReceiptUnrecorded),
			EgressReasonReceiptUnrecorded)
		return nil, refusedEgress(EgressReasonReceiptUnrecorded, "audit_ledger",
			"the disclosure succeeded but its append-only receipt could not be recorded")
	}
	return vectors, nil
}

// egressPermit is produced only by admitOnlineEgress and binds the exact
// request bytes it authorizes. performPermittedEgress refuses a permit whose
// payload digest does not match the body it was handed.
type egressPermit struct {
	profileID     string
	spaceID       string
	purpose       SemanticEmbeddingPurpose
	authorization string
	requestDigest string
	payloadDigest string
	payloadBytes  int64
	itemCount     int
	textBytes     int64
	textDigests   []string
}

// admitOnlineEgress is the single gate. Every condition is evaluated here,
// before any HTTP request exists, and the returned permit is the only way to
// reach the network call.
func (p *OnlineEmbeddingProvider) admitOnlineEgress(
	ctx context.Context,
	purpose SemanticEmbeddingPurpose,
	batch []SemanticTextInput,
	requestDigest string,
	body []byte,
) (egressPermit, OnlineCredential, error) {
	// (a) mode
	if p.mode != "online" && p.mode != "hybrid" {
		return egressPermit{}, OnlineCredential{}, refusedEgress(EgressReasonModeNotOnline, "embedding_mode",
			fmt.Sprintf("content is not sent in embedding_mode %q", p.mode))
	}
	// (b) immutable profile
	if err := p.profile.Validate(); err != nil {
		return egressPermit{}, OnlineCredential{}, refusedEgress(EgressReasonProfileUnresolved, "online_profile", err.Error())
	}
	// (c) credential
	if _, err := OnlineCredentialRefScheme(p.credentialRef); err != nil {
		return egressPermit{}, OnlineCredential{}, refusedEgress(EgressReasonCredentialUnresolved, "online_credential_ref", err.Error())
	}
	credential, err := p.resolver.Resolve(ctx, p.credentialRef)
	if err != nil {
		return egressPermit{}, OnlineCredential{}, refusedEgress(EgressReasonCredentialUnresolved, "online_credential_ref", err.Error())
	}
	if credential.IsZero() {
		return egressPermit{}, OnlineCredential{}, refusedEgress(EgressReasonCredentialUnresolved, "online_credential_ref",
			"the resolved credential is empty")
	}
	// (d) authorization: the config switch or an explicit per-request
	// confirmation bound to exactly this disclosure.
	authorization := SemanticEgressAuthorizationConfig
	if !p.sendWithout {
		confirmation, ok := SemanticEgressConfirmationFrom(ctx)
		if !ok {
			return egressPermit{}, OnlineCredential{}, refusedEgress(EgressReasonConfirmationRequired, "send_content_without_confirmation",
				"semantic.send_content_without_confirmation is false and the request carries no per-request confirmation")
		}
		if mismatch := p.confirmationMismatch(confirmation, purpose, requestDigest); mismatch != "" {
			return egressPermit{}, OnlineCredential{}, refusedEgress(EgressReasonConfirmationMismatch, "confirmation", mismatch)
		}
		authorization = SemanticEgressAuthorizationRequest
	}
	// (e) protection: unprotected or unknown subjects are never disclosed.
	if purpose == SemanticEmbeddingDocument {
		if p.subjects == nil {
			return egressPermit{}, OnlineCredential{}, refusedEgress(EgressReasonSubjectPolicyUnavail, "protection",
				"no subject protection policy is attached")
		}
		checked := map[string]struct{}{}
		for _, input := range batch {
			subject := strings.TrimSpace(input.SubjectID)
			if _, done := checked[subject]; done {
				continue
			}
			checked[subject] = struct{}{}
			allowed, reason, detail := p.subjects.SemanticEgressSubjectAllowed(ctx, subject)
			if !allowed {
				if reason == "" {
					reason = EgressReasonSubjectUnknown
				}
				return egressPermit{}, OnlineCredential{}, refusedEgress(reason, "protection", detail)
			}
		}
	}
	// (f) receipt channel
	if p.audit == nil {
		return egressPermit{}, OnlineCredential{}, refusedEgress(EgressReasonAuditUnavailable, "audit_ledger",
			"no append-only egress ledger is attached")
	}
	payloadDigest := sha256Digest(body)
	permit := egressPermit{
		profileID:     p.profile.ProfileID,
		spaceID:       p.profile.Fingerprint().SpaceID(),
		purpose:       purpose,
		authorization: authorization,
		requestDigest: requestDigest,
		payloadDigest: payloadDigest,
		payloadBytes:  int64(len(body)),
		itemCount:     len(batch),
	}
	for _, input := range batch {
		permit.textBytes += int64(len(input.Text))
		permit.textDigests = append(permit.textDigests, sha256Digest([]byte(input.Text)))
	}
	return permit, credential, nil
}

func (p *OnlineEmbeddingProvider) confirmationMismatch(confirmation SemanticEgressConfirmation, purpose SemanticEmbeddingPurpose, requestDigest string) string {
	switch {
	case strings.TrimSpace(confirmation.ProviderProfileID) != p.profile.ProfileID:
		return "the confirmation names a different provider profile"
	case strings.TrimSpace(confirmation.Endpoint) != p.profile.Endpoint:
		return "the confirmation names a different endpoint"
	case strings.TrimSpace(confirmation.ModelID) != p.profile.ModelID:
		return "the confirmation names a different model"
	case confirmation.Purpose != purpose:
		return "the confirmation names a different embedding purpose"
	case strings.TrimSpace(confirmation.ContentDigest) != requestDigest:
		return "the confirmation does not match the content digest of this request"
	case !confirmation.ExpiresAt.IsZero() && !confirmation.ExpiresAt.After(p.now()):
		return "the confirmation has expired"
	default:
		return ""
	}
}

type onlineEmbeddingRequestBody struct {
	Model            string
	Input            []string
	EncodingFormat   string
	Dimensions       *int
	InstructionField string
	Instruction      string
}

// MarshalJSON emits the OpenAI-compatible embedding request. Map marshaling
// sorts keys, so the request bytes are deterministic for a given profile and
// batch; the vendor instruction field is completely absent when the profile
// does not declare one.
func (b onlineEmbeddingRequestBody) MarshalJSON() ([]byte, error) {
	fields := map[string]any{
		"model":           b.Model,
		"input":           b.Input,
		"encoding_format": b.EncodingFormat,
	}
	if b.Dimensions != nil {
		fields["dimensions"] = *b.Dimensions
	}
	if b.InstructionField != "" {
		fields[b.InstructionField] = b.Instruction
	}
	return json.Marshal(fields)
}

func (p *OnlineEmbeddingProvider) buildRequestBody(purpose SemanticEmbeddingPurpose, batch []SemanticTextInput) ([]byte, error) {
	prefix := p.profile.DocumentPrefix
	if purpose == SemanticEmbeddingQuery {
		prefix = p.profile.QueryPrefix
	}
	inputs := make([]string, 0, len(batch))
	for _, input := range batch {
		if strings.TrimSpace(input.Text) == "" {
			return nil, errors.New("empty input text")
		}
		inputs = append(inputs, prefix+input.Text)
	}
	body := onlineEmbeddingRequestBody{
		Model:            p.profile.ModelID,
		Input:            inputs,
		EncodingFormat:   "float",
		InstructionField: p.profile.InstructionField,
		Instruction:      p.profile.Instruction,
	}
	if p.profile.SendDimensions {
		dimension := p.profile.Dimension
		body.Dimensions = &dimension
	}
	return json.Marshal(body)
}

// onlineHTTPStatusError carries the HTTP classification without the response
// body, so provider error text can never reach a log or a receipt.
type onlineHTTPStatusError struct {
	status     int
	reason     SemanticEgressReason
	errorClass string
}

func (e *onlineHTTPStatusError) Error() string {
	return fmt.Sprintf("%s: provider returned HTTP %d", e.reason, e.status)
}

func (e *onlineHTTPStatusError) Unwrap() error { return ErrSemanticProviderUnavailable }

// EgressReason implements the reason carrier used by SemanticEgressReasonOf.
func (e *onlineHTTPStatusError) EgressReason() SemanticEgressReason {
	if e == nil {
		return ""
	}
	return e.reason
}

type onlineHTTPMeta struct {
	Status        int
	RequestBytes  int64
	ResponseBytes int64
}

// performPermittedEgress is the only network call in the online provider. It
// requires a permit from admitOnlineEgress and refuses to run when the
// permit's bound payload digest does not match the exact bytes handed to it.
func (p *OnlineEmbeddingProvider) performPermittedEgress(
	ctx context.Context,
	permit egressPermit,
	body []byte,
	credential OnlineCredential,
) (onlineEmbeddingResponseBody, onlineHTTPMeta, error) {
	var response onlineEmbeddingResponseBody
	var meta onlineHTTPMeta
	if permit.profileID != p.profile.ProfileID || permit.spaceID != p.profile.Fingerprint().SpaceID() {
		return response, meta, refusedEgress(EgressReasonProviderProfileChanged, "online_profile",
			"the egress permit was not issued for this provider profile")
	}
	if sha256Digest(body) != permit.payloadDigest {
		return response, meta, refusedEgress(EgressReasonProviderProfileChanged, "payload",
			"the egress permit does not bind these request bytes")
	}
	if credential.IsZero() {
		return response, meta, refusedEgress(EgressReasonCredentialUnresolved, "online_credential_ref", "empty credential")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, p.profile.Endpoint, bytes.NewReader(body))
	if err != nil {
		return response, meta, refusedEgress(EgressReasonRequestInvalid, "endpoint", err.Error())
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+credential.Value())
	meta.RequestBytes = int64(len(body))
	httpResponse, err := p.client.Do(request)
	if err != nil {
		reason := EgressReasonProviderUnreachable
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			reason = EgressReasonProviderTimeout
		}
		var netErr net.Error
		if errors.As(err, &netErr) && netErr.Timeout() {
			reason = EgressReasonProviderTimeout
		}
		return response, meta, refusedEgress(reason, "provider", "the provider endpoint could not be reached")
	}
	defer httpResponse.Body.Close()
	meta.Status = httpResponse.StatusCode
	raw, err := io.ReadAll(io.LimitReader(httpResponse.Body, 32<<20))
	if err != nil {
		return response, meta, refusedEgress(EgressReasonProviderUnreachable, "provider", "reading the provider response failed")
	}
	meta.ResponseBytes = int64(len(raw))
	if httpResponse.StatusCode != http.StatusOK {
		errorClass := "unclassified"
		var parsed onlineEmbeddingResponseBody
		if json.Unmarshal(raw, &parsed) == nil {
			errorClass = onlineProviderErrorClass(parsed)
		}
		return response, meta, &onlineHTTPStatusError{
			status: httpResponse.StatusCode, reason: onlineStatusReason(httpResponse.StatusCode), errorClass: errorClass,
		}
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		return response, meta, refusedEgress(EgressReasonResponseMalformed, "response",
			"the provider response is not a valid embedding payload")
	}
	return response, meta, nil
}

// onlineStatusReason maps one HTTP status onto a stable reason. The mapping
// never turns an error status into a success.
func onlineStatusReason(status int) SemanticEgressReason {
	switch {
	case status == http.StatusTooManyRequests:
		return EgressReasonProviderQuota
	case status == http.StatusUnauthorized, status == http.StatusForbidden:
		return EgressReasonCredentialUnresolved
	case status >= 300 && status < 400:
		return EgressReasonProviderRedirect
	case status >= 400 && status < 500:
		return EgressReasonProviderRejected
	default:
		return EgressReasonProviderError
	}
}

// decodeOnlineEmbeddingResponse validates the response against the bound
// space: dimension, finite/normalized values, and the vendor's echoed model
// id. Any mismatch is refused; nothing is normalized, truncated, or padded to
// make it fit.
func (p *OnlineEmbeddingProvider) decodeOnlineEmbeddingResponse(
	_ SemanticEmbeddingPurpose,
	batch []SemanticTextInput,
	response onlineEmbeddingResponseBody,
) ([]SemanticVector, SemanticEgressReason, string, string) {
	if strings.TrimSpace(response.Model) != "" && response.Model != p.profile.ModelID {
		return nil, EgressReasonSpaceMismatch, fmt.Sprintf(
			"the provider answered with model %q for space fingerprint %q", response.Model, p.profile.Fingerprint().SpaceID()), ""
	}
	if len(response.Data) != len(batch) {
		return nil, EgressReasonResponseMalformed, fmt.Sprintf(
			"the provider returned %d vectors for %d inputs", len(response.Data), len(batch)), ""
	}
	indexed := false
	for position := range response.Data {
		if response.Data[position].Index != nil {
			indexed = true
		}
	}
	if indexed {
		for position := range response.Data {
			if response.Data[position].Index == nil {
				return nil, EgressReasonResponseMalformed, "the provider returned a mix of indexed and unindexed vectors", ""
			}
		}
	}
	vectors := make([]SemanticVector, len(batch))
	placed := make([]bool, len(batch))
	for position, item := range response.Data {
		target := position
		if indexed {
			target = *item.Index
		}
		if target < 0 || target >= len(batch) {
			return nil, EgressReasonResponseMalformed, "the provider returned a vector with an out-of-range index", ""
		}
		if placed[target] {
			return nil, EgressReasonResponseMalformed, "the provider returned duplicate vector indexes", ""
		}
		if len(item.Embedding) != p.profile.Dimension {
			return nil, EgressReasonDimensionMismatch, fmt.Sprintf(
				"the provider returned dimension %d; the bound space is %d-dimensional", len(item.Embedding), p.profile.Dimension), ""
		}
		if err := validateSemanticVectorValues(item.Embedding, p.profile.Normalization); err != nil {
			return nil, EgressReasonInvalidVector, err.Error(), ""
		}
		vectors[target] = SemanticVector{
			SubjectID: batch[target].SubjectID,
			SegmentID: batch[target].SegmentID,
			Vector:    append([]float32(nil), item.Embedding...),
		}
		placed[target] = true
	}
	return vectors, "", "", ""
}

// egressRecord builds the append-only receipt. It copies only digests,
// counts, identities, and classifications; the request text and the response
// body are not referenced.
func (p *OnlineEmbeddingProvider) egressRecord(
	permit egressPermit,
	purpose SemanticEmbeddingPurpose,
	generationID string,
	batch []SemanticTextInput,
	requestDigest string,
	meta onlineHTTPMeta,
	started, completed time.Time,
	failReason SemanticEgressReason,
	errorClass string,
) SemanticEgressRecord {
	outcome := SemanticEgressOutcomeSucceeded
	if failReason != "" {
		outcome = SemanticEgressOutcomeFailed
	}
	fingerprint := p.profile.Fingerprint()
	return SemanticEgressRecord{
		ProviderProfile:        p.profile.ProfileID,
		ProviderProfileDigest:  p.profile.ProviderProfileDigest(),
		SpaceFingerprint:       fingerprint.SpaceID(),
		SpaceFingerprintDigest: fingerprint.CanonicalDigest(),
		ModelID:                p.profile.ModelID,
		ModelRevision:          p.profile.ModelRevision,
		Dimension:              p.profile.Dimension,
		InputType:              p.profile.InputType,
		Instruction:            p.profile.Instruction,
		Normalization:          p.profile.Normalization,
		APIStyle:               p.profile.APIStyle,
		EndpointHost:           p.profile.EndpointHost(),
		TrainingUse:            p.profile.TrainingUse,
		RetentionDeclaration:   p.profile.RetentionDeclaration,
		Purpose:                string(purpose),
		GenerationID:           generationID,
		ItemCount:              len(batch),
		TextBytes:              permit.textBytes,
		TextDigests:            append([]string(nil), permit.textDigests...),
		RequestDigest:          requestDigest,
		PayloadDigest:          permit.payloadDigest,
		PayloadBytes:           permit.payloadBytes,
		Authorization:          permit.authorization,
		HTTPStatus:             meta.Status,
		Outcome:                outcome,
		Reason:                 failReason,
		ProviderErrorClass:     errorClass,
		StartedAt:              started,
		CompletedAt:            completed,
	}
}

func (p *OnlineEmbeddingProvider) recordEgressReceipt(ctx context.Context, record SemanticEgressRecord) error {
	if p.audit == nil {
		return errors.New("egress ledger is not attached")
	}
	return p.audit.RecordSemanticEgress(ctx, record)
}

func sha256Digest(payload []byte) string {
	digest := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(digest[:])
}
