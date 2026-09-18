package search

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// Egress gate
//
// This file is the provider-neutral admission gate for one remote disclosure.
// It is deliberately independent of the online embedding provider: any future
// remote provider (for example a description generator) submits the same
// request shape and receives the same immutable admission or a typed refusal.
//
// The gate evaluates, in order and fail-closed:
//
//	(a) the provider identity is complete;
//	(b) the credential reference resolves to a non-empty secret;
//	(c) the profile's revocation reference resolves empty;
//	(d) the profile is not expired;
//	(e) the requested data classes are part of the closed vocabulary and are
//	    declared by the profile;
//	(f) a durable, unrevoked, unexpired grant covers the profile digest,
//	    endpoint host, model, and purpose, and admits every requested data
//	    class and every subject protection outcome;
//	(g) when semantic.send_content_without_confirmation is false, a
//	    per-request confirmation names the live grant and this exact
//	    disclosure;
//	(h) when the profile requires audit, an append-only receipt channel is
//	    attached.
//
// The gate performs no I/O beyond resolving the credential and revocation
// references through the injected resolver and reading grants through the
// injected lookup. It never sends content: the online provider's single
// network call site requires an admission produced here.

// Egress grant purpose vocabulary. It is the same purpose vocabulary the
// embedding provider uses, kept as plain strings so a second provider family
// can name its own admitted purposes without redefining this gate.
const (
	EgressPurposeDocument = string(SemanticEmbeddingDocument)
	EgressPurposeQuery    = string(SemanticEmbeddingQuery)
)

// ValidEgressPurpose reports whether value is a grant purpose this build
// admits.
func ValidEgressPurpose(value string) bool {
	return value == EgressPurposeDocument || value == EgressPurposeQuery
}

// EgressDataClassForPurpose maps one admitted purpose onto the data class the
// disclosure carries.
func EgressDataClassForPurpose(purpose string) string {
	if purpose == EgressPurposeQuery {
		return EgressDataClassTextQuery
	}
	return EgressDataClassTextSegment
}

// EgressSubjectOutcome is one already-classified subject protection outcome.
// Classification is host policy; the gate only checks that every outcome is
// admitted by the grant.
type EgressSubjectOutcome struct {
	SubjectID string
	Class     string
}

// EgressGrant is the provider-neutral projection of one durable immutable
// grant row. Revoked and ExpiresAt are facts; the gate derives liveness from
// them and its own clock so the exact same row can be reported as
// EGRESS_GRANT_REVOKED or EGRESS_GRANT_EXPIRED.
type EgressGrant struct {
	ID             string
	ProfileID      string
	ProfileDigest  string
	EndpointHost   string
	ModelID        string
	Purpose        string
	DataClasses    []string
	SubjectClasses []string
	MaxRequests    int64
	MaxBytes       int64
	MaxSeconds     int64
	ExpiresAt      time.Time
	Revoked        bool
	RevocationID   string
	RevokedReason  string
}

// Budget returns the grant's declared per-run budget.
func (g EgressGrant) Budget() EgressBudget {
	return EgressBudget{MaxRequests: g.MaxRequests, MaxBytes: g.MaxBytes, MaxSeconds: g.MaxSeconds}
}

// CoversDataClass reports whether the grant admits the data class.
func (g EgressGrant) CoversDataClass(class string) bool {
	for _, candidate := range g.DataClasses {
		if candidate == class {
			return true
		}
	}
	return false
}

// CoversSubjectClass reports whether the grant admits the protection outcome.
func (g EgressGrant) CoversSubjectClass(class string) bool {
	for _, candidate := range g.SubjectClasses {
		if candidate == class {
			return true
		}
	}
	return false
}

// Live reports whether the grant is unrevoked and unexpired at now.
func (g EgressGrant) Live(now time.Time) bool {
	return !g.Revoked && g.ExpiresAt.After(now.UTC())
}

// EgressGrantQuery names the exact disclosure identity an admission looks up.
type EgressGrantQuery struct {
	ProfileID     string
	ProfileDigest string
	EndpointHost  string
	ModelID       string
	Purpose       string
}

// EgressGrantLookup reads the durable grant ledger. Implementations must
// return every grant matching the identity fields, including revoked and
// expired rows, so the gate can report the precise refusal. An error fails the
// admission closed.
type EgressGrantLookup interface {
	EgressGrants(ctx context.Context, query EgressGrantQuery) ([]EgressGrant, error)
}

// EgressBudgetUsage is the consumption recorded in a receipt.
type EgressBudgetUsage struct {
	Requests int64 `json:"requests"`
	Bytes    int64 `json:"bytes"`
	Seconds  int64 `json:"seconds"`
}

// EgressRunBudget tracks one run's consumption against the effective budget
// (the profile ceiling intersected with the covering grant's declaration).
// Budget exhaustion is a typed refusal, never a partial silent success.
type EgressRunBudget struct {
	budget    EgressBudget
	hasBudget bool
	started   time.Time
	requests  int64
	bytes     int64
}

// NewEgressRunBudget starts one run at the given instant.
func NewEgressRunBudget(started time.Time) *EgressRunBudget {
	return &EgressRunBudget{started: started.UTC()}
}

// Budget returns the effective budget observed so far.
func (r *EgressRunBudget) Budget() EgressBudget {
	if r == nil {
		return EgressBudget{}
	}
	return r.budget
}

// Usage reports requests, bytes, and elapsed seconds for receipts.
func (r *EgressRunBudget) Usage(now time.Time) EgressBudgetUsage {
	if r == nil {
		return EgressBudgetUsage{}
	}
	seconds := now.UTC().Sub(r.started).Seconds()
	if seconds < 0 {
		seconds = 0
	}
	return EgressBudgetUsage{Requests: r.requests, Bytes: r.bytes, Seconds: int64(seconds)}
}

// Admit checks one proposed request against the effective budget. It refuses
// with EGRESS_BUDGET_EXCEEDED when the request count, byte count, or wall-clock
// deadline would be exceeded.
func (r *EgressRunBudget) Admit(now time.Time, requestBytes int64, ceiling EgressBudget) error {
	if r == nil {
		return refusedEgress(EgressReasonBudgetExceeded, "egress_budget", "no run budget is attached to this provider")
	}
	if err := ceiling.Validate(); err != nil {
		return refusedEgress(EgressReasonProfileUnresolved, "egress_budget", err.Error())
	}
	if !r.hasBudget {
		r.budget = ceiling
		r.hasBudget = true
	} else {
		r.budget = r.budget.Min(ceiling)
	}
	if elapsed := now.UTC().Sub(r.started); elapsed >= time.Duration(r.budget.MaxSeconds)*time.Second {
		return refusedEgress(EgressReasonBudgetExceeded, "egress_budget",
			fmt.Sprintf("the egress run reached its max_seconds=%d deadline", r.budget.MaxSeconds))
	}
	if r.requests+1 > r.budget.MaxRequests {
		return refusedEgress(EgressReasonBudgetExceeded, "egress_budget",
			fmt.Sprintf("the egress run reached its max_requests=%d budget", r.budget.MaxRequests))
	}
	if r.bytes+requestBytes > r.budget.MaxBytes {
		return refusedEgress(EgressReasonBudgetExceeded, "egress_budget",
			fmt.Sprintf("the egress run would exceed its max_bytes=%d budget", r.budget.MaxBytes))
	}
	return nil
}

// Record accounts one admitted and attempted request.
func (r *EgressRunBudget) Record(requestBytes int64) {
	if r == nil {
		return
	}
	r.requests++
	r.bytes += requestBytes
}

// EgressConfirmationBinding is the exact disclosure one confirmation must
// name. It is the provider's immutable identity plus the live grant id and the
// content digest of the request inputs.
type EgressConfirmationBinding struct {
	ProfileID     string
	ProfileDigest string
	Endpoint      string
	EndpointHost  string
	ModelID       string
	Purpose       string
	ContentDigest string
	GrantID       string
}

// EgressConfirmationMismatch reports why a confirmation does not authorize
// exactly this disclosure. An empty result means the confirmation matches.
func EgressConfirmationMismatch(confirmation SemanticEgressConfirmation, want EgressConfirmationBinding, now time.Time) string {
	switch {
	case strings.TrimSpace(confirmation.ProviderProfileID) == "" && strings.TrimSpace(confirmation.ProfileDigest) == "":
		return "the confirmation does not bind a provider profile"
	case strings.TrimSpace(confirmation.ProviderProfileID) != "" && strings.TrimSpace(confirmation.ProviderProfileID) != want.ProfileID:
		return "the confirmation names a different provider profile"
	case strings.TrimSpace(confirmation.ProfileDigest) != "" && strings.TrimSpace(confirmation.ProfileDigest) != want.ProfileDigest:
		return "the confirmation names a different provider profile digest"
	case strings.TrimSpace(confirmation.Endpoint) == "" && strings.TrimSpace(confirmation.EndpointHost) == "":
		return "the confirmation does not bind a destination endpoint"
	case strings.TrimSpace(confirmation.Endpoint) != "" && strings.TrimSpace(confirmation.Endpoint) != want.Endpoint:
		return "the confirmation names a different endpoint"
	case strings.TrimSpace(confirmation.EndpointHost) != "" && strings.TrimSpace(confirmation.EndpointHost) != want.EndpointHost:
		return "the confirmation names a different endpoint host"
	case strings.TrimSpace(confirmation.ModelID) == "":
		return "the confirmation does not bind a model"
	case strings.TrimSpace(confirmation.ModelID) != want.ModelID:
		return "the confirmation names a different model"
	case confirmation.Purpose == "":
		return "the confirmation does not bind an embedding purpose"
	case string(confirmation.Purpose) != want.Purpose:
		return "the confirmation names a different embedding purpose"
	case strings.TrimSpace(confirmation.GrantID) == "":
		return "the confirmation does not bind an egress grant"
	case strings.TrimSpace(confirmation.GrantID) != want.GrantID:
		return "the confirmation names a different egress grant"
	case strings.TrimSpace(confirmation.ContentDigest) != "" && strings.TrimSpace(confirmation.ContentDigest) != want.ContentDigest:
		return "the confirmation does not match the content digest of this request"
	case !confirmation.ExpiresAt.IsZero() && !confirmation.ExpiresAt.After(now.UTC()):
		return "the confirmation has expired"
	default:
		return ""
	}
}

// EgressGateRequest is one proposed disclosure submitted to the gate.
type EgressGateRequest struct {
	ProviderKind  string
	ProfileID     string
	ProfileDigest string
	Endpoint      string
	EndpointHost  string
	ModelID       string
	// Purpose and the data classes this request would disclose.
	Purpose     string
	DataClasses []string
	// SubjectOutcomes are the host-classified protection outcomes of every
	// disclosed subject. A query disclosure carries none.
	SubjectOutcomes []EgressSubjectOutcome
	CredentialRef   string
	// ContentDigest is the digest of the exact disclosed inputs. It binds a
	// per-request confirmation to this disclosure.
	ContentDigest string
	// ProfileEgress and ProfileBudget are the immutable profile facts the
	// grant must fit inside.
	ProfileEgress OnlineEgressScope
	ProfileBudget EgressBudget
	// Invocation authorization.
	SendWithoutConfirmation bool
	AuditRequired           bool
	AuditAttached           bool
	Confirmation            *SemanticEgressConfirmation
	Now                     time.Time
}

// EgressGateDeps are the gate's only injection points.
type EgressGateDeps struct {
	Credential OnlineCredentialResolver
	Grants     EgressGrantLookup
}

// EgressAdmission is the immutable authorization to disclose exactly the
// request the gate was asked about.
type EgressAdmission struct {
	GrantID       string
	ProfileID     string
	ProfileDigest string
	EndpointHost  string
	ModelID       string
	Purpose       string
	DataClasses   []string
	Authorization string
	Budget        EgressBudget
	// CredentialRef is always the redacted reference form.
	CredentialRef string
	AdmittedAt    time.Time
}

// AdmitEgress is the single provider-neutral gate.
func AdmitEgress(ctx context.Context, request EgressGateRequest, deps EgressGateDeps) (EgressAdmission, OnlineCredential, error) {
	var admission EgressAdmission
	var credential OnlineCredential
	// (a) provider identity and an explicit instant: expiry, revocation, and
	// grant liveness are all time-bound facts, so the gate never falls back to
	// an implicit clock.
	if request.Now.IsZero() {
		return admission, credential, refusedEgress(EgressReasonRequestInvalid, "now",
			"the gate requires an explicit instant; expiry and liveness cannot be evaluated without one")
	}
	if strings.TrimSpace(request.ProviderKind) == "" {
		return admission, credential, refusedEgress(EgressReasonModeNotOnline, "provider_kind",
			"the remote provider kind is empty; no disclosure can be admitted")
	}
	if strings.TrimSpace(request.ProfileID) == "" || strings.TrimSpace(request.ProfileDigest) == "" {
		return admission, credential, refusedEgress(EgressReasonProfileUnresolved, "provider_profile",
			"the provider profile identity is incomplete")
	}
	if strings.TrimSpace(request.Purpose) == "" || !ValidEgressPurpose(request.Purpose) {
		return admission, credential, refusedEgress(EgressReasonRequestInvalid, "purpose",
			fmt.Sprintf("purpose %q is not an admitted egress purpose", request.Purpose))
	}
	// (b) credential
	if _, err := OnlineCredentialRefScheme(request.CredentialRef); err != nil {
		return admission, credential, refusedEgress(EgressReasonCredentialUnresolved, "credential_ref", err.Error())
	}
	if deps.Credential == nil {
		return admission, credential, refusedEgress(EgressReasonCredentialUnresolved, "credential_ref",
			"no credential resolver is attached; the reference cannot be resolved")
	}
	resolved, err := deps.Credential.Resolve(ctx, request.CredentialRef)
	if err != nil {
		return admission, credential, refusedEgress(EgressReasonCredentialUnresolved, "credential_ref", err.Error())
	}
	if resolved.IsZero() {
		return admission, credential, refusedEgress(EgressReasonCredentialUnresolved, "credential_ref",
			"the resolved credential is empty")
	}
	credential = resolved
	// (c) revocation reference: a non-empty resolution revokes the profile.
	if ref := strings.TrimSpace(request.ProfileEgress.RevocationRef); ref != "" {
		revocation, revocationErr := deps.Credential.Resolve(ctx, ref)
		if revocationErr == nil && !revocation.IsZero() {
			return admission, credential, refusedEgress(EgressReasonProfileRevoked, "egress.revocation_ref",
				"the profile revocation reference resolves to a non-empty value")
		}
	}
	// (d) profile expiry
	if request.ProfileEgress.Expired(request.Now) {
		return admission, credential, refusedEgress(EgressReasonProfileExpired, "egress.expiry",
			fmt.Sprintf("the online profile expired at %s", request.ProfileEgress.Expiry))
	}
	// (e) data classes
	if len(request.DataClasses) == 0 {
		return admission, credential, refusedEgress(EgressReasonDataClassDenied, "egress.data_classes",
			"the request discloses no declared data class")
	}
	for _, class := range request.DataClasses {
		if !ValidEgressDataClass(class) {
			return admission, credential, refusedEgress(EgressReasonDataClassDenied, "egress.data_classes",
				fmt.Sprintf("data class %q is not part of the closed vocabulary", class))
		}
		if !request.ProfileEgress.CoversDataClass(class) {
			return admission, credential, refusedEgress(EgressReasonDataClassDenied, "egress.data_classes",
				fmt.Sprintf("the profile does not declare data class %q", class))
		}
	}
	if err := request.ProfileBudget.Validate(); err != nil {
		return admission, credential, refusedEgress(EgressReasonProfileUnresolved, "egress.budgets", err.Error())
	}
	// (f) the durable grant
	if deps.Grants == nil {
		return admission, credential, refusedEgress(EgressReasonGrantMissing, "egress_grant",
			"no egress grant ledger is attached; remote disclosure requires a live grant")
	}
	grants, err := deps.Grants.EgressGrants(ctx, EgressGrantQuery{
		ProfileID: request.ProfileID, ProfileDigest: request.ProfileDigest,
		EndpointHost: request.EndpointHost, ModelID: request.ModelID, Purpose: request.Purpose,
	})
	if err != nil {
		return admission, credential, refusedEgress(EgressReasonGrantStoreUnavailable, "egress_grant",
			"reading the egress grant ledger failed")
	}
	matches := make([]EgressGrant, 0, len(grants))
	for _, grant := range grants {
		if grant.ProfileID == request.ProfileID && grant.ProfileDigest == request.ProfileDigest &&
			grant.EndpointHost == request.EndpointHost && grant.ModelID == request.ModelID &&
			grant.Purpose == request.Purpose {
			matches = append(matches, grant)
		}
	}
	if len(matches) == 0 {
		return admission, credential, refusedEgress(EgressReasonGrantMissing, "egress_grant",
			"no egress grant covers this profile, destination, model, and purpose")
	}
	live := make([]EgressGrant, 0, len(matches))
	for _, grant := range matches {
		if grant.Live(request.Now) {
			live = append(live, grant)
		}
	}
	if len(live) == 0 {
		for _, grant := range matches {
			if grant.Revoked {
				return admission, credential, refusedEgress(EgressReasonGrantRevoked, "egress_grant",
					fmt.Sprintf("egress grant %s was revoked", grant.ID))
			}
		}
		return admission, credential, refusedEgress(EgressReasonGrantExpired, "egress_grant",
			"every matching egress grant has expired; a new grant is required")
	}
	covering := -1
	for index, grant := range live {
		if !grantCoversRequest(grant, request) {
			continue
		}
		// Prefer the grant with the tightest remaining ceiling? No: any live
		// covering grant is a valid authorization. Selection is deterministic:
		// the first live covering grant in the ledger's stable order.
		covering = index
		break
	}
	if covering < 0 {
		return admission, credential, grantClassRefusal(live, request)
	}
	grant := live[covering]
	if err := grant.Budget().Validate(); err != nil {
		return admission, credential, refusedEgress(EgressReasonGrantMissing, "egress_grant",
			fmt.Sprintf("egress grant %s declares an invalid budget: %v", grant.ID, err))
	}
	// (g) invocation authorization. The config switch skips only the
	// per-request confirmation; it never skips the grant.
	authorization := SemanticEgressAuthorizationConfig
	if !request.SendWithoutConfirmation {
		if request.Confirmation == nil {
			return admission, credential, refusedEgressForGrant(EgressReasonConfirmationRequired, "send_content_without_confirmation",
				"semantic.send_content_without_confirmation is false and the request carries no per-request confirmation", grant.ID)
		}
		if mismatch := EgressConfirmationMismatch(*request.Confirmation, EgressConfirmationBinding{
			ProfileID: request.ProfileID, ProfileDigest: request.ProfileDigest,
			Endpoint: request.Endpoint, EndpointHost: request.EndpointHost,
			ModelID: request.ModelID, Purpose: request.Purpose, GrantID: grant.ID,
			ContentDigest: request.ContentDigest,
		}, request.Now); mismatch != "" {
			return admission, credential, refusedEgressForGrant(EgressReasonConfirmationMismatch, "confirmation", mismatch, grant.ID)
		}
		authorization = SemanticEgressAuthorizationRequest
	}
	// (h) receipt channel
	if request.AuditRequired && !request.AuditAttached {
		return admission, credential, refusedEgressForGrant(EgressReasonAuditUnavailable, "audit_ledger",
			"the profile requires audit but no append-only egress ledger is attached", grant.ID)
	}
	return EgressAdmission{
		GrantID: grant.ID, ProfileID: request.ProfileID, ProfileDigest: request.ProfileDigest,
		EndpointHost: request.EndpointHost, ModelID: request.ModelID, Purpose: request.Purpose,
		DataClasses:   append([]string(nil), request.DataClasses...),
		Authorization: authorization,
		Budget:        request.ProfileBudget.Min(grant.Budget()),
		CredentialRef: RedactedOnlineCredentialRef(request.CredentialRef),
		AdmittedAt:    request.Now.UTC(),
	}, credential, nil
}

func grantCoversRequest(grant EgressGrant, request EgressGateRequest) bool {
	for _, class := range request.DataClasses {
		if !grant.CoversDataClass(class) {
			return false
		}
	}
	for _, outcome := range request.SubjectOutcomes {
		if !grant.CoversSubjectClass(outcome.Class) {
			return false
		}
	}
	return true
}

// grantClassRefusal names the exact class that no live grant admits. It never
// falls back to a generic reason: a missing data class and a missing subject
// class are different operator problems. Every refusal names the grant it
// inspected, so the attempt is attributable.
func grantClassRefusal(live []EgressGrant, request EgressGateRequest) error {
	dataDenied := false
	for _, grant := range live {
		dataCovered := true
		for _, class := range request.DataClasses {
			if !grant.CoversDataClass(class) {
				dataCovered = false
				break
			}
		}
		if !dataCovered {
			dataDenied = true
			continue
		}
		for _, outcome := range request.SubjectOutcomes {
			if !grant.CoversSubjectClass(outcome.Class) {
				return refusedEgressForGrant(EgressReasonSubjectClassDenied, "egress_grant",
					fmt.Sprintf("egress grant %s does not admit subject protection class %s", grant.ID, outcome.Class), grant.ID)
			}
		}
	}
	if !dataDenied {
		return refusedEgressForGrant(EgressReasonSubjectClassDenied, "egress_grant",
			"no live egress grant admits every subject protection class in this request", live[0].ID)
	}
	return refusedEgressForGrant(EgressReasonDataClassDenied, "egress_grant",
		"no live egress grant admits every requested data class", live[0].ID)
}
