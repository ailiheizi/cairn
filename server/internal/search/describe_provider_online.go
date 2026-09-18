package search

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

// Online DESCRIBE_SUBJECT provider
//
// The provider generates candidate long-form descriptions through an
// OpenAI-compatible chat-completions endpoint. It differs from a local worker
// in exactly one respect: the request discloses subject material to a remote
// service, so every request must pass the provider-neutral gate in
// egress_gate.go (AdmitEgress) before any HTTP request exists.
//
// The host (control plane) builds the request input from admitted facts only:
// the subject's admitted EXTRACT text artifacts and — only when the profile's
// disclosed data classes include image.bytes — the subject's admitted image
// bytes. Private notes, user annotations, and other descriptions are never
// part of the request, and this package has no way to obtain them: the request
// carries only what the host handed in.
//
// admission conditions, all evaluated before any HTTP request is built:
//
//	(a) the immutable describe profile resolves and is valid (it carries the
//	    egress scope: destination, data classes, subject classes, minimization,
//	    budgets, expiry, revocation, policy refs, audit);
//	(b) the host credential reference resolves and the profile's revocation
//	    reference resolves empty;
//	(c) the profile has not expired;
//	(d) the disclosed subject is allowed by the host protection policy and
//	    carries an admitted protection class;
//	(e) a durable, live egress grant covers the profile digest, endpoint host,
//	    model, DESCRIBE purpose, data classes, and subject class;
//	(f) semantic.send_content_without_confirmation is true, or the specific
//	    request carries an explicit SemanticEgressConfirmation naming the live
//	    grant; the config switch skips only the confirmation;
//	(g) an append-only audit sink is attached (the profile's audit_required
//	    flag is the stricter declared policy, checked by the gate).
//
// A refusal is a typed *SemanticEgressRefusedError that names the failed
// condition, and it is raised before any HTTP request is built. The only code
// path that performs the network call is performDescribeEgress, which requires
// an egressPermit produced by the gate and verifies that the permit binds the
// exact request bytes. There is no fallback: a refusal never degrades into a
// local model, a canned text, or another provider.

// DescribeTextContext is one admitted EXTRACT text artifact the host assembles
// for a describe request. ArtifactID is the durable provenance reference; Text
// is the artifact's retained body.
type DescribeTextContext struct {
	ArtifactID string
	Text       string
}

// DescribeImagePart is the subject's admitted image, read through the
// identity-checking content source. ContentID is the exact content identity
// the bytes were verified against.
type DescribeImagePart struct {
	ContentID string
	MediaType string
	Bytes     []byte
}

// DescribeRequest is one host-assembled DESCRIBE_SUBJECT input. It contains
// admitted facts only; the host never attaches private notes or other
// descriptions, and this provider transmits nothing beyond the request body
// fields the profile's minimization declaration names.
type DescribeRequest struct {
	// SubjectID is the stable subject the candidate will be bound to.
	SubjectID string
	// Kind is the requested durable kind: AI_SUMMARY or AI_ANALYSIS.
	Kind string
	// Language is the requested output language label (may be empty).
	Language string
	// TextContexts are the subject's admitted EXTRACT text artifacts.
	TextContexts []DescribeTextContext
	// Image is the subject's admitted image when the host chose to disclose
	// it; nil otherwise. The provider refuses an image when the profile does
	// not declare the image.bytes data class.
	Image *DescribeImagePart
}

// DescribeResult is one validated candidate produced by the provider. It is
// untrusted candidate evidence: only the host admits it as a new immutable
// DescriptionRevision, and the provider can never mark it user-accepted.
type DescribeResult struct {
	Text string
	// ModelID and ModelRevision are the profile identities that produced the
	// candidate.
	ModelID       string
	ModelRevision string
	// FinishReason is the vendor's finish reason for the admitted choice.
	FinishReason string
	// RequestDigest is the egress content digest bound by the gate and the
	// receipt; OutputDigest is the canonical digest of the candidate text.
	RequestDigest string
	OutputDigest  string
	// GrantID, ProfileID, ProfileDigest, and DataClasses name the exact
	// authorization the disclosure ran under.
	GrantID       string
	ProfileID     string
	ProfileDigest string
	DataClasses   []string
}

// DescribeEgressRecord is the append-only receipt for one attempted describe
// egress. It deliberately has no payload field: it records digests, byte
// counts, identities, authorizations, budget consumption, and the outcome
// classification, never the text or image bytes that were sent and never a
// secret.
type DescribeEgressRecord struct {
	ProviderProfile       string `json:"provider_profile"`
	ProviderProfileDigest string `json:"provider_profile_digest"`
	ModelID               string `json:"model_id"`
	ModelRevision         string `json:"model_revision"`
	APIStyle              string `json:"api_style"`
	EndpointHost          string `json:"endpoint_host"`
	Purpose               string `json:"purpose"`
	SubjectID             string `json:"subject_id"`
	SubjectClass          string `json:"subject_class,omitempty"`
	// TextBytes and TextDigests describe the disclosed text by count and
	// digest only.
	TextBytes   int64    `json:"text_bytes"`
	TextDigests []string `json:"text_digests"`
	// ImageIncluded records whether image bytes were disclosed, with their
	// count and digest; the bytes themselves are never recorded.
	ImageIncluded      bool                 `json:"image_included"`
	ImageDigest        string               `json:"image_digest,omitempty"`
	ImageBytes         int64                `json:"image_bytes,omitempty"`
	RequestDigest      string               `json:"request_digest"`
	PayloadDigest      string               `json:"payload_digest"`
	PayloadBytes       int64                `json:"payload_bytes"`
	Authorization      string               `json:"authorization"`
	HTTPStatus         int                  `json:"http_status,omitempty"`
	Outcome            string               `json:"outcome"`
	Reason             SemanticEgressReason `json:"reason,omitempty"`
	ProviderErrorClass string               `json:"provider_error_class,omitempty"`
	StartedAt          time.Time            `json:"started_at"`
	CompletedAt        time.Time            `json:"completed_at"`
	// GrantID is the durable grant that authorized this disclosure. It is
	// empty only for a receipt of an attempt refused before a grant applied.
	GrantID string `json:"grant_id,omitempty"`
	// DisclosedDataClasses names the closed data classes this attempt carried.
	DisclosedDataClasses []string `json:"disclosed_data_classes,omitempty"`
	// CredentialRef is the redacted credential reference (a location, never a
	// secret). The plaintext credential is never recorded.
	CredentialRef string `json:"credential_ref,omitempty"`
	// RequestSent distinguishes "no request was sent" from a transport
	// attempt. A refusal recorded before the HTTP request is built has
	// RequestSent=false.
	RequestSent bool `json:"request_sent"`
	// OutputDigest is the canonical digest of the validated candidate text.
	// It is empty when no candidate was decoded.
	OutputDigest string `json:"output_digest,omitempty"`
	OutputBytes  int64  `json:"output_bytes,omitempty"`
	// OutputSchemaRef names the admitted response schema.
	OutputSchemaRef string `json:"output_schema_ref,omitempty"`
	// BudgetUsage is the run's consumption after this attempt.
	BudgetUsage EgressBudgetUsage `json:"budget_usage"`
}

// DescribeEgressAuditSink appends one receipt per attempted describe egress.
// The host supplies an append-only implementation; a nil sink makes every
// egress refuse, so content can never leave the process unrecorded.
type DescribeEgressAuditSink interface {
	RecordDescribeEgress(ctx context.Context, record DescribeEgressRecord) error
}

// DescribeProvider is the narrow host contract for one on-demand description
// generator. It is the DESCRIBE_SUBJECT capability seam: implementations may
// be local workers or online providers, and the control plane depends only on
// this interface.
type DescribeProvider interface {
	// Describe validates the request, runs the egress gate, and returns one
	// untrusted candidate.
	Describe(ctx context.Context, request DescribeRequest) (DescribeResult, error)
	// CheckDescribeReadiness reports why this provider cannot run right now,
	// without reading any secret and without a network call.
	CheckDescribeReadiness(ctx context.Context) error
	// Profile returns the immutable admitted profile (no credential material).
	Profile() OnlineDescribeProfile
}

// OnlineDescribeProviderOptions constructs one online describe provider.
type OnlineDescribeProviderOptions struct {
	// Profile is the admitted immutable describe profile.
	Profile OnlineDescribeProfile
	// CredentialResolver defaults to DefaultOnlineCredentialResolver.
	CredentialResolver OnlineCredentialResolver
	// SendWithoutConfirmation mirrors
	// semantic.send_content_without_confirmation, the provider-neutral remote
	// egress safety switch. When false, every request needs an explicit
	// per-request confirmation.
	SendWithoutConfirmation bool
	// AuditSink is the append-only egress receipt ledger.
	AuditSink DescribeEgressAuditSink
	// SubjectPolicy resolves per-subject protection. It is required: a nil
	// policy refuses every disclosure.
	SubjectPolicy SemanticEgressSubjectPolicy
	// Grants is the durable, append-only egress grant ledger. It is required:
	// a provider without a grant ledger refuses every disclosure with
	// EGRESS_GRANT_MISSING.
	Grants EgressGrantLookup
	// HTTPClient is optional; tests inject one. The default refuses redirects
	// and uses the profile timeout.
	HTTPClient *http.Client
	// Now is optional; tests inject a clock.
	Now func() time.Time
}

// OnlineDescribeProvider is the HTTP-backed DESCRIBE_SUBJECT provider. One
// instance serves exactly one immutable profile.
type OnlineDescribeProvider struct {
	profile       OnlineDescribeProfile
	credentialRef string
	resolver      OnlineCredentialResolver
	sendWithout   bool
	audit         DescribeEgressAuditSink
	subjects      SemanticEgressSubjectPolicy
	grants        EgressGrantLookup
	client        *http.Client
	now           func() time.Time
}

// NewOnlineDescribeProvider validates the profile and returns a provider that
// can only egress through the gate.
func NewOnlineDescribeProvider(options OnlineDescribeProviderOptions) (*OnlineDescribeProvider, error) {
	if err := options.Profile.Validate(); err != nil {
		return nil, refusedEgress(EgressReasonProfileUnresolved, "describe_profile", err.Error())
	}
	if _, err := OnlineCredentialRefScheme(options.Profile.CredentialRef); err != nil {
		return nil, refusedEgress(EgressReasonCredentialUnresolved, "describe_profile.credential_ref", err.Error())
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
	return &OnlineDescribeProvider{
		profile: options.Profile, credentialRef: options.Profile.CredentialRef,
		resolver: resolver, sendWithout: options.SendWithoutConfirmation,
		audit: options.AuditSink, subjects: options.SubjectPolicy, grants: options.Grants,
		client: client, now: now,
	}, nil
}

// Profile returns the immutable admitted profile (no credential material).
func (p *OnlineDescribeProvider) Profile() OnlineDescribeProfile {
	if p == nil {
		return OnlineDescribeProfile{}
	}
	return p.profile
}

// CheckDescribeReadiness reports why this provider cannot egress right now,
// without reading any secret: it validates the profile (including expiry),
// credential reference form, audit sink, subject policy, and grant ledger. It
// never performs a network call and never checks a specific grant, because
// that is a per-request decision.
func (p *OnlineDescribeProvider) CheckDescribeReadiness(_ context.Context) error {
	if p == nil {
		return refusedEgress(EgressReasonProfileUnresolved, "describe_profile", "no describe provider is configured")
	}
	if p.profile.Egress.Expired(p.now()) {
		return refusedEgress(EgressReasonProfileExpired, "egress.expiry", "the describe profile has expired")
	}
	if err := p.profile.Validate(); err != nil {
		return refusedEgress(EgressReasonProfileUnresolved, "describe_profile", err.Error())
	}
	if _, err := OnlineCredentialRefScheme(p.credentialRef); err != nil {
		return refusedEgress(EgressReasonCredentialUnresolved, "describe_profile.credential_ref", err.Error())
	}
	if p.audit == nil {
		return refusedEgress(EgressReasonAuditUnavailable, "audit_ledger",
			"no append-only egress ledger is attached; remote description generation cannot be recorded")
	}
	if p.subjects == nil {
		return refusedEgress(EgressReasonSubjectPolicyUnavail, "protection",
			"no subject protection policy is attached; subject disclosure cannot be authorized")
	}
	if p.grants == nil {
		return refusedEgress(EgressReasonGrantMissing, "egress_grant",
			"no durable egress grant ledger is attached; remote disclosure requires a live grant")
	}
	return nil
}

// DescribeEgressContentDigest is the digest a per-request confirmation binds.
// It covers the ordered subject, kind, language, admitted text contexts, and
// the disclosed image identity, and it is the same value recorded as
// request_digest in every describe egress receipt.
func DescribeEgressContentDigest(request DescribeRequest) string {
	h := sha256.New()
	writeLengthPrefixed(h, []byte("restoreweave.describe-egress-content.v1"))
	writeLengthPrefixed(h, []byte(request.SubjectID))
	writeLengthPrefixed(h, []byte(request.Kind))
	writeLengthPrefixed(h, []byte(request.Language))
	for _, context := range request.TextContexts {
		writeLengthPrefixed(h, []byte(context.ArtifactID))
		writeLengthPrefixed(h, []byte(context.Text))
	}
	if request.Image != nil {
		writeLengthPrefixed(h, []byte(request.Image.ContentID))
		writeLengthPrefixed(h, []byte(request.Image.MediaType))
		writeLengthPrefixed(h, []byte(sha256Digest(request.Image.Bytes)))
	} else {
		writeLengthPrefixed(h, nil)
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil))
}

// DescribeEgressOutputDigest is the canonical digest of one validated candidate
// text. It never covers provider metadata and cannot be confused with an input
// digest.
func DescribeEgressOutputDigest(text string) string {
	h := sha256.New()
	writeLengthPrefixed(h, []byte("restoreweave.describe-egress-output.v1"))
	writeLengthPrefixed(h, []byte(text))
	return "sha256:" + hex.EncodeToString(h.Sum(nil))
}

// describeRequestBody is the OpenAI-compatible chat-completions request. Only
// the MarshalJSON field set below may ever be transmitted; the profile's
// minimization declaration names exactly these fields.
type describeRequestBody struct {
	Model     string
	MaxTokens int
	Messages  []describeMessage
}

type describeMessage struct {
	Role    string
	Content any // string, or []describeContentPart when an image is disclosed
}

type describeContentPart struct {
	Type     string            `json:"type"`
	Text     string            `json:"text,omitempty"`
	ImageURL *describeImageURL `json:"image_url,omitempty"`
}

type describeImageURL struct {
	URL string `json:"url"`
}

// MarshalJSON emits the request with sorted keys (map marshaling), so the
// request bytes are deterministic for a given profile and input.
func (b describeRequestBody) MarshalJSON() ([]byte, error) {
	messages := make([]map[string]any, 0, len(b.Messages))
	for _, message := range b.Messages {
		messages = append(messages, map[string]any{"role": message.Role, "content": message.Content})
	}
	return json.Marshal(map[string]any{
		"model":      b.Model,
		"max_tokens": b.MaxTokens,
		"messages":   messages,
	})
}

// validateDescribeRequest refuses an incomplete request before any gate or
// network work. The host assembles the input; the provider refuses to guess.
func validateDescribeRequest(request DescribeRequest, profile OnlineDescribeProfile) error {
	if strings.TrimSpace(request.SubjectID) == "" {
		return errors.New("subject id is required")
	}
	switch strings.ToUpper(strings.TrimSpace(request.Kind)) {
	case "AI_SUMMARY", "AI_ANALYSIS":
	default:
		return errors.New("kind must be AI_SUMMARY or AI_ANALYSIS")
	}
	hasText := false
	for _, context := range request.TextContexts {
		if strings.TrimSpace(context.Text) == "" {
			return errors.New("a text context is empty")
		}
		if !utf8.ValidString(context.Text) {
			return errors.New("a text context is not valid UTF-8")
		}
		hasText = true
	}
	if request.Image != nil {
		if !profile.Egress.CoversDataClass(EgressDataClassImageBytes) {
			return fmt.Errorf("the profile does not declare the %q data class; image bytes cannot be disclosed", EgressDataClassImageBytes)
		}
		if strings.TrimSpace(request.Image.ContentID) == "" || len(request.Image.Bytes) == 0 {
			return errors.New("an image part requires its content identity and bytes")
		}
	}
	if !hasText && request.Image == nil {
		return errors.New("the request carries no disclosed input")
	}
	return nil
}

// Describe implements DescribeProvider. Every call passes the same gate
// against one run budget; a refusal or failure is reported with its stable
// reason and nothing falls back to another provider or a local model.
func (p *OnlineDescribeProvider) Describe(ctx context.Context, request DescribeRequest) (DescribeResult, error) {
	if p == nil {
		return DescribeResult{}, refusedEgress(EgressReasonProfileUnresolved, "describe_profile", "no describe provider is configured")
	}
	if err := validateDescribeRequest(request, p.profile); err != nil {
		return DescribeResult{}, refusedEgress(EgressReasonRequestInvalid, "request", err.Error())
	}
	if p.profile.Egress.Expired(p.now()) {
		return DescribeResult{}, refusedEgress(EgressReasonProfileExpired, "egress.expiry",
			fmt.Sprintf("the describe profile expired at %s", p.profile.Egress.Expiry))
	}
	if err := p.profile.Validate(); err != nil {
		return DescribeResult{}, refusedEgress(EgressReasonProfileUnresolved, "describe_profile", err.Error())
	}
	body, err := p.buildRequestBody(request)
	if err != nil {
		return DescribeResult{}, refusedEgress(EgressReasonRequestInvalid, "request", err.Error())
	}
	run := NewEgressRunBudget(p.now())
	permit, credential, err := p.admitDescribeEgress(ctx, run, request, body)
	if err != nil {
		// A refusal after the grant check is recorded as an attempt that never
		// sent a request; a refusal before it is not a disclosure attempt at
		// all. Either way the refusal is typed and visible.
		if refusedAfterGrantCheck(err) {
			p.recordRefusedAttempt(ctx, permit, request, err, run)
		}
		return DescribeResult{}, err
	}
	started := p.now().UTC()
	response, meta, callErr := p.performDescribeEgress(ctx, permit, body, credential)
	completed := p.now().UTC()
	run.Record(permit.payloadBytes)

	var (
		result       DescribeResult
		failReason   SemanticEgressReason
		failDetail   string
		errorClass   string
		outputDigest string
		outputBytes  int64
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
		result, failReason, failDetail, errorClass = p.decodeDescribeResponse(request, response)
		if failReason == "" {
			outputDigest = result.OutputDigest
			outputBytes = int64(len(result.Text))
		}
	}

	// Exactly one append-only receipt per attempted egress: the receipt
	// records what was sent by digest and byte count plus the outcome, the
	// authorizing grant, the credential reference (redacted), and the run's
	// budget consumption.
	record := p.egressRecord(permit, request, meta, started, completed, failReason, errorClass, outputDigest, outputBytes, true, run.Usage(completed))
	receiptErr := p.recordEgressReceipt(ctx, record)

	switch {
	case failReason != "":
		return DescribeResult{}, refusedEgress(failReason, "provider", failDetail)
	case receiptErr != nil:
		return DescribeResult{}, refusedEgress(EgressReasonReceiptUnrecorded, "audit_ledger",
			"the disclosure succeeded but its append-only receipt could not be recorded")
	}
	result.GrantID = permit.grantID
	result.ProfileID = p.profile.ProfileID
	result.ProfileDigest = p.profile.ProviderProfileDigest()
	result.DataClasses = append([]string(nil), permit.dataClasses...)
	return result, nil
}

// describePermit carries the same binding facts as egressPermit, specialized
// for one describe request. It is used both for the admitted attempt and for a
// refusal receipt, so the two can never disagree about what was about to be
// sent.
type describePermit struct {
	profileID     string
	purpose       string
	authorization string
	grantID       string
	dataClasses   []string
	credentialRef string
	requestDigest string
	payloadDigest string
	payloadBytes  int64
	textBytes     int64
	textDigests   []string
}

func (p *OnlineDescribeProvider) newDescribePermit(request DescribeRequest, requestDigest string, body []byte) describePermit {
	permit := describePermit{
		profileID:     p.profile.ProfileID,
		purpose:       EgressPurposeDescribe,
		requestDigest: requestDigest,
		payloadDigest: sha256Digest(body),
		payloadBytes:  int64(len(body)),
	}
	for _, context := range request.TextContexts {
		permit.textBytes += int64(len(context.Text))
		permit.textDigests = append(permit.textDigests, sha256Digest([]byte(context.Text)))
	}
	return permit
}

// admitDescribeEgress is the single provider-side admission path. It
// classifies the subject against host protection policy, then delegates the
// decision to the provider-neutral gate (AdmitEgress) and admits the request
// against the run's budget. The returned permit is the only way to reach the
// network call.
func (p *OnlineDescribeProvider) admitDescribeEgress(ctx context.Context, run *EgressRunBudget, request DescribeRequest, body []byte) (describePermit, OnlineCredential, error) {
	requestDigest := DescribeEgressContentDigest(request)
	permit := p.newDescribePermit(request, requestDigest, body)
	// (a) protection: an unknown, unprotected, or blocked subject is never
	// disclosed, and an allowed subject must carry an admitted protection
	// class from the closed vocabulary.
	if p.subjects == nil {
		return permit, OnlineCredential{}, refusedEgress(EgressReasonSubjectPolicyUnavail, "protection",
			"no subject protection policy is attached")
	}
	allowed, class, reason, detail := p.subjects.SemanticEgressSubjectAllowed(ctx, strings.TrimSpace(request.SubjectID))
	if !allowed {
		if reason == "" {
			reason = EgressReasonSubjectUnknown
		}
		return permit, OnlineCredential{}, refusedEgress(reason, "protection", detail)
	}
	if !ValidEgressSubjectClass(class) {
		return permit, OnlineCredential{}, refusedEgress(EgressReasonSubjectClassDenied, "protection",
			fmt.Sprintf("the protection policy returned unknown subject class %q", class))
	}
	// (b) data classes: exactly what this request would disclose.
	dataClasses := []string{EgressDataClassTextSubjectContext}
	if request.Image != nil {
		dataClasses = append(dataClasses, EgressDataClassImageBytes)
	}
	// (c) the provider-neutral gate: credential, revocation, expiry, live
	// grant, class coverage, confirmation, and audit requirements.
	var confirmation *SemanticEgressConfirmation
	if attached, ok := SemanticEgressConfirmationFrom(ctx); ok {
		confirmation = &attached
	}
	admission, credential, err := AdmitEgress(ctx, EgressGateRequest{
		ProviderKind:            "describe",
		ProfileID:               p.profile.ProfileID,
		ProfileDigest:           p.profile.ProviderProfileDigest(),
		Endpoint:                p.profile.Endpoint,
		EndpointHost:            p.profile.EndpointHost(),
		ModelID:                 p.profile.ModelID,
		Purpose:                 EgressPurposeDescribe,
		DataClasses:             dataClasses,
		SubjectOutcomes:         []EgressSubjectOutcome{{SubjectID: request.SubjectID, Class: class}},
		CredentialRef:           p.credentialRef,
		ContentDigest:           requestDigest,
		ProfileEgress:           p.profile.Egress,
		ProfileBudget:           p.profile.Egress.Budgets,
		SendWithoutConfirmation: p.sendWithout,
		AuditRequired:           p.profile.Egress.AuditRequired,
		AuditAttached:           p.audit != nil,
		Confirmation:            confirmation,
		Now:                     p.now(),
	}, EgressGateDeps{Credential: p.resolver, Grants: p.grants})
	if err != nil {
		return permit, OnlineCredential{}, err
	}
	// One receipt per attempt is mandatory even when the profile does not
	// require audit: an unrecordable disclosure is refused rather than sent
	// with no evidence. The profile's audit_required flag is the stricter
	// declared policy, checked by the gate.
	if p.audit == nil {
		return permit, OnlineCredential{}, refusedEgressForGrant(EgressReasonAuditUnavailable, "audit_ledger",
			"no append-only egress ledger is attached; the disclosure cannot be recorded", admission.GrantID)
	}
	permit.authorization = admission.Authorization
	permit.grantID = admission.GrantID
	permit.dataClasses = append([]string(nil), admission.DataClasses...)
	permit.credentialRef = admission.CredentialRef
	// (d) run budget: one describe request. Exhaustion is a typed refusal,
	// never a partial success.
	if err := run.Admit(p.now(), permit.payloadBytes, admission.Budget); err != nil {
		var refused *SemanticEgressRefusedError
		detail := ""
		if errors.As(err, &refused) {
			detail = refused.Detail
		}
		return permit, OnlineCredential{}, refusedEgressForGrant(
			SemanticEgressReasonOf(err), "egress_budget", detail, admission.GrantID)
	}
	return permit, credential, nil
}

// buildRequestBody assembles the chat-completions request from the request's
// admitted facts only. The user message text is the joined extracted text; a
// short header names the requested kind and language so the vendor model knows
// the schema it is being asked for. The system message is the profile's
// digest-bound instruction. Image bytes are attached as a base64 data URL part
// only when the host disclosed them.
func (p *OnlineDescribeProvider) buildRequestBody(request DescribeRequest) ([]byte, error) {
	texts := make([]string, 0, len(request.TextContexts))
	for _, context := range request.TextContexts {
		texts = append(texts, context.Text)
	}
	header := "kind=" + strings.ToUpper(strings.TrimSpace(request.Kind))
	if strings.TrimSpace(request.Language) != "" {
		header += " language=" + strings.TrimSpace(request.Language)
	}
	userText := "[restoreweave describe " + header + "]\n" + strings.Join(texts, "\n\n")
	body := describeRequestBody{
		Model:     p.profile.ModelID,
		MaxTokens: p.profile.MaxOutputTokens,
	}
	if strings.TrimSpace(p.profile.SystemInstruction) != "" {
		body.Messages = append(body.Messages, describeMessage{Role: "system", Content: p.profile.SystemInstruction})
	}
	if request.Image != nil {
		mediaType := strings.TrimSpace(request.Image.MediaType)
		if mediaType == "" {
			mediaType = "application/octet-stream"
		}
		dataURL := "data:" + mediaType + ";base64," + base64.StdEncoding.EncodeToString(request.Image.Bytes)
		body.Messages = append(body.Messages, describeMessage{Role: "user", Content: []describeContentPart{
			{Type: "text", Text: userText},
			{Type: "image_url", ImageURL: &describeImageURL{URL: dataURL}},
		}})
	} else {
		body.Messages = append(body.Messages, describeMessage{Role: "user", Content: userText})
	}
	return json.Marshal(body)
}

// describeResponseBody is the admitted OpenAI-compatible chat-completions
// response shape (OnlineDescribeOutputSchema). Vendor error text is parsed for
// a short error class only and is never recorded.
type describeResponseBody struct {
	Choices []struct {
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Model string `json:"model"`
	Error struct {
		Code    string `json:"code"`
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error"`
}

// decodeDescribeResponse validates the response against the admitted output
// schema: one choice carrying a non-empty UTF-8 candidate inside the profile's
// byte bound, with the vendor's echoed model id matching the profile. Any
// mismatch is refused; nothing is truncated or padded to make it fit.
func (p *OnlineDescribeProvider) decodeDescribeResponse(request DescribeRequest, response describeResponseBody) (DescribeResult, SemanticEgressReason, string, string) {
	if strings.TrimSpace(response.Model) != "" && response.Model != p.profile.ModelID {
		return DescribeResult{}, EgressReasonResponseMalformed, fmt.Sprintf(
			"the provider answered with model %q for profile %q", response.Model, p.profile.ProfileID), ""
	}
	if len(response.Choices) != 1 {
		return DescribeResult{}, EgressReasonResponseMalformed, fmt.Sprintf(
			"the provider returned %d choices for one describe request", len(response.Choices)), ""
	}
	choice := response.Choices[0]
	text := choice.Message.Content
	if strings.TrimSpace(text) == "" {
		return DescribeResult{}, EgressReasonResponseMalformed, "the provider returned an empty candidate description", ""
	}
	if !utf8.ValidString(text) {
		return DescribeResult{}, EgressReasonResponseMalformed, "the provider candidate is not valid UTF-8", ""
	}
	if int64(len(text)) > p.profile.MaxOutputBytes {
		return DescribeResult{}, EgressReasonResponseMalformed, fmt.Sprintf(
			"the provider candidate exceeds the profile's %d byte output bound", p.profile.MaxOutputBytes), ""
	}
	if err := validateCandidateText(text); err != nil {
		return DescribeResult{}, EgressReasonResponseMalformed, err.Error(), ""
	}
	result := DescribeResult{
		Text:          text,
		ModelID:       p.profile.ModelID,
		ModelRevision: p.profile.ModelRevision,
		FinishReason:  strings.TrimSpace(choice.FinishReason),
		RequestDigest: DescribeEgressContentDigest(request),
		OutputDigest:  DescribeEgressOutputDigest(text),
	}
	return result, "", "", ""
}

// validateCandidateText refuses control characters other than tab, newline,
// and carriage return. It is the shared provider-side and host-side candidate
// check.
func validateCandidateText(text string) error {
	for _, r := range text {
		if r < 0x20 && r != '\t' && r != '\n' && r != '\r' {
			return errors.New("the candidate contains a control character")
		}
		if r == 0x7f {
			return errors.New("the candidate contains a control character")
		}
	}
	return nil
}

// ValidateDescribeCandidateText is the host-side candidate validation the
// describe operation re-runs before admission: control characters other than
// tab, newline, and carriage return are refused. The host re-checks the
// untrusted candidate even though the provider already validated it, because
// only the host admits.
func ValidateDescribeCandidateText(text string) error {
	return validateCandidateText(text)
}

// performDescribeEgress is the only network call in the describe provider. It
// requires a permit from admitDescribeEgress and refuses to run when the
// permit's bound payload digest does not match the exact bytes handed to it.
func (p *OnlineDescribeProvider) performDescribeEgress(
	ctx context.Context,
	permit describePermit,
	body []byte,
	credential OnlineCredential,
) (describeResponseBody, onlineHTTPMeta, error) {
	var response describeResponseBody
	var meta onlineHTTPMeta
	if permit.profileID != p.profile.ProfileID {
		return response, meta, refusedEgress(EgressReasonProviderProfileChanged, "describe_profile",
			"the egress permit was not issued for this provider profile")
	}
	if sha256Digest(body) != permit.payloadDigest {
		return response, meta, refusedEgress(EgressReasonProviderProfileChanged, "payload",
			"the egress permit does not bind these request bytes")
	}
	if credential.IsZero() {
		return response, meta, refusedEgress(EgressReasonCredentialUnresolved, "credential_ref", "empty credential")
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
		var parsed describeResponseBody
		if json.Unmarshal(raw, &parsed) == nil {
			errorClass = onlineProviderErrorClassFromDescribe(parsed)
		}
		return response, meta, &onlineHTTPStatusError{
			status: httpResponse.StatusCode, reason: onlineStatusReason(httpResponse.StatusCode), errorClass: errorClass,
		}
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		return response, meta, refusedEgress(EgressReasonResponseMalformed, "response",
			"the provider response is not a valid chat-completions payload")
	}
	return response, meta, nil
}

// onlineProviderErrorClassFromDescribe admits only a short identifier-shaped
// vendor error code or type. Vendor messages are never recorded: they can echo
// request content, so a receipt can never carry them.
func onlineProviderErrorClassFromDescribe(response describeResponseBody) string {
	for _, candidate := range []string{response.Error.Code, response.Error.Type} {
		if providerErrorClassPattern.MatchString(candidate) {
			return candidate
		}
	}
	return "unclassified"
}

// recordRefusedAttempt appends the receipt for a refusal that happened after
// the grant check but before any HTTP request was built. The receipt carries
// RequestSent=false, so it never claims a request was sent.
func (p *OnlineDescribeProvider) recordRefusedAttempt(ctx context.Context, permit describePermit, request DescribeRequest, refusal error, run *EgressRunBudget) {
	permit.grantID = SemanticEgressGrantIDOf(refusal)
	permit.credentialRef = RedactedOnlineCredentialRef(p.credentialRef)
	now := p.now().UTC()
	record := p.egressRecord(permit, request, onlineHTTPMeta{}, now, now,
		SemanticEgressReasonOf(refusal), "", "", 0, false, run.Usage(now))
	if err := p.recordEgressReceipt(ctx, record); err != nil {
		// A refusal whose receipt cannot be recorded stays a refusal; the
		// recording failure is never allowed to invent a successful run.
		_ = err
	}
}

// egressRecord builds the append-only receipt. It copies only digests, counts,
// identities, classifications, and budget consumption; the request text, the
// image bytes, the response body, and the credential value are never
// referenced.
func (p *OnlineDescribeProvider) egressRecord(
	permit describePermit,
	request DescribeRequest,
	meta onlineHTTPMeta,
	started, completed time.Time,
	failReason SemanticEgressReason,
	errorClass string,
	outputDigest string,
	outputBytes int64,
	requestSent bool,
	budgetUsage EgressBudgetUsage,
) DescribeEgressRecord {
	outcome := SemanticEgressOutcomeSucceeded
	if failReason != "" {
		outcome = SemanticEgressOutcomeFailed
	}
	record := DescribeEgressRecord{
		ProviderProfile:       p.profile.ProfileID,
		ProviderProfileDigest: p.profile.ProviderProfileDigest(),
		ModelID:               p.profile.ModelID,
		ModelRevision:         p.profile.ModelRevision,
		APIStyle:              p.profile.APIStyle,
		EndpointHost:          p.profile.EndpointHost(),
		Purpose:               EgressPurposeDescribe,
		SubjectID:             strings.TrimSpace(request.SubjectID),
		TextBytes:             permit.textBytes,
		TextDigests:           append([]string(nil), permit.textDigests...),
		ImageIncluded:         request.Image != nil,
		RequestDigest:         permit.requestDigest,
		PayloadDigest:         permit.payloadDigest,
		PayloadBytes:          permit.payloadBytes,
		Authorization:         permit.authorization,
		HTTPStatus:            meta.Status,
		Outcome:               outcome,
		Reason:                failReason,
		ProviderErrorClass:    errorClass,
		StartedAt:             started,
		CompletedAt:           completed,
		GrantID:               permit.grantID,
		DisclosedDataClasses:  append([]string(nil), permit.dataClasses...),
		CredentialRef:         permit.credentialRef,
		RequestSent:           requestSent,
		OutputDigest:          outputDigest,
		OutputBytes:           outputBytes,
		OutputSchemaRef:       OnlineDescribeOutputSchema,
		BudgetUsage:           budgetUsage,
	}
	if request.Image != nil {
		record.ImageDigest = sha256Digest(request.Image.Bytes)
		record.ImageBytes = int64(len(request.Image.Bytes))
	}
	return record
}

func (p *OnlineDescribeProvider) recordEgressReceipt(ctx context.Context, record DescribeEgressRecord) error {
	if p.audit == nil {
		return errors.New("egress ledger is not attached")
	}
	return p.audit.RecordDescribeEgress(ctx, record)
}
