package search

import (
	"fmt"
	"net/url"
	"strings"
	"time"
)

// Online egress scope
//
// The `egress` object embedded in every online provider profile is the
// immutable declaration of what one provider may ever disclose. It is part of
// the profile document, so the profile digest covers it: an installed grant or
// a recorded receipt can never be reinterpreted by editing one egress fact in
// place.
//
// This file owns the closed vocabularies and the strict validation of the
// scope. It performs no I/O and never reads a secret; revocation and budget
// enforcement happen in egress_gate.go, and the credential reference is
// resolved by the provider's injected resolver.

const (
	// EgressDataClassTextSegment names document segment text: durable
	// description and annotation segments plus filename facts that a semantic
	// rebuild embeds.
	EgressDataClassTextSegment = "text.segment"
	// EgressDataClassTextQuery names one query string sent for embedding.
	EgressDataClassTextQuery = "text.query"
)

// EgressDataClasses returns the closed data-class vocabulary in stable order.
func EgressDataClasses() []string {
	return []string{EgressDataClassTextSegment, EgressDataClassTextQuery}
}

// Egress subject classes are exactly the protection outcomes the host policy
// already admits for remote disclosure. The vocabulary is closed: a class not
// listed here can appear in neither a profile nor a grant.
const (
	EgressSubjectClassExactProtected     = "EXACT_PROTECTED"
	EgressSubjectClassExactFallback      = "EXACT_FALLBACK"
	EgressSubjectClassExternalReplayable = "EXTERNAL_REPLAYABLE"
)

// EgressSubjectClasses returns the closed subject-class vocabulary in stable
// order.
func EgressSubjectClasses() []string {
	return []string{EgressSubjectClassExactProtected, EgressSubjectClassExactFallback, EgressSubjectClassExternalReplayable}
}

// ValidEgressDataClass reports whether value is part of the closed data-class
// vocabulary.
func ValidEgressDataClass(value string) bool {
	for _, candidate := range EgressDataClasses() {
		if value == candidate {
			return true
		}
	}
	return false
}

// ValidEgressSubjectClass reports whether value is part of the closed
// subject-class vocabulary.
func ValidEgressSubjectClass(value string) bool {
	for _, candidate := range EgressSubjectClasses() {
		if value == candidate {
			return true
		}
	}
	return false
}

// OnlineEmbeddingOutputSchema is the schema reference recorded in every egress
// receipt: the exact OpenAI-compatible embeddings response shape this provider
// admits (a data array of embeddings plus an optional echoed model id).
const OnlineEmbeddingOutputSchema = "restoreweave.online-embedding-output.v1"

// EgressBudget is one strictly positive per-run egress budget. Zero or
// negative values are never an "unbounded" default; they are refused.
type EgressBudget struct {
	MaxRequests int64 `json:"max_requests"`
	MaxBytes    int64 `json:"max_bytes"`
	MaxSeconds  int64 `json:"max_seconds"`
}

// Bounds keep a declared budget finite and meaningful. The caps are generous
// (a million requests, one TiB, seven days) but they exist so a manifest can
// never declare an effectively unbounded run.
const (
	EgressBudgetMaxRequests = int64(1_000_000)
	EgressBudgetMaxBytes    = int64(1 << 40)
	EgressBudgetMaxSeconds  = int64(7 * 24 * 60 * 60)
)

// Validate refuses a missing, non-positive, or beyond-bounds budget.
func (b EgressBudget) Validate() error {
	if b.MaxRequests <= 0 || b.MaxRequests > EgressBudgetMaxRequests {
		return fmt.Errorf("max_requests %d is outside 1..%d", b.MaxRequests, EgressBudgetMaxRequests)
	}
	if b.MaxBytes <= 0 || b.MaxBytes > EgressBudgetMaxBytes {
		return fmt.Errorf("max_bytes %d is outside 1..%d", b.MaxBytes, EgressBudgetMaxBytes)
	}
	if b.MaxSeconds <= 0 || b.MaxSeconds > EgressBudgetMaxSeconds {
		return fmt.Errorf("max_seconds %d is outside 1..%d", b.MaxSeconds, EgressBudgetMaxSeconds)
	}
	return nil
}

// Min returns the tighter of two validated budgets. The effective budget of a
// run is the profile ceiling intersected with the grant's declaration, so
// neither document can widen the other.
func (b EgressBudget) Min(other EgressBudget) EgressBudget {
	min := func(left, right int64) int64 {
		if left < right {
			return left
		}
		return right
	}
	return EgressBudget{
		MaxRequests: min(b.MaxRequests, other.MaxRequests),
		MaxBytes:    min(b.MaxBytes, other.MaxBytes),
		MaxSeconds:  min(b.MaxSeconds, other.MaxSeconds),
	}
}

// OnlineEgressMinimization is the declared statement of exactly what is sent.
// Fields is the closed list of JSON request-body fields the provider
// transmits; ValidateFor refuses a declaration that does not match the fields
// the bound profile actually builds.
type OnlineEgressMinimization struct {
	Statement string   `json:"statement"`
	Fields    []string `json:"fields"`
}

// OnlineEgressPolicyRefs are opaque, operator-recorded policy references. They
// are provenance, not enforcement: the host enforces what it can observe and
// records the rest.
type OnlineEgressPolicyRefs struct {
	Residency   string `json:"residency"`
	Logging     string `json:"logging"`
	Retention   string `json:"retention"`
	TrainingUse string `json:"training_use"`
	OutputUse   string `json:"output_use"`
}

// OnlineEgressScope is the immutable egress declaration of one online
// provider profile.
type OnlineEgressScope struct {
	// DestinationHost must equal the endpoint's host[:port]; a mismatch is
	// refused so the declared destination cannot disagree with the wire.
	DestinationHost string `json:"destination_host"`
	// DisclosedDataClasses is the closed set of data classes this provider may
	// ever receive.
	DisclosedDataClasses []string `json:"disclosed_data_classes"`
	// AllowedSubjectClasses is the closed set of subject protection outcomes
	// a grant may cover for this provider.
	AllowedSubjectClasses []string `json:"allowed_subject_classes"`
	// Minimization names exactly what is transmitted.
	Minimization OnlineEgressMinimization `json:"minimization"`
	// Budgets is the per-run ceiling. Grants may only narrow it.
	Budgets EgressBudget `json:"budgets"`
	// Expiry is the RFC3339 instant after which the profile refuses all
	// egress, independently of any grant.
	Expiry string `json:"expiry"`
	// RevocationRef is a scheme-qualified host reference (env://... or
	// keychain://...). Egress is refused whenever it resolves to a non-empty
	// value.
	RevocationRef string `json:"revocation_ref"`
	// PolicyRefs are opaque policy references carried as provenance.
	PolicyRefs OnlineEgressPolicyRefs `json:"policy_refs"`
	// AuditRequired means an unattached audit sink refuses egress outright.
	AuditRequired bool `json:"audit_required"`
}

// ExpiryTime parses the declared expiry.
func (e OnlineEgressScope) ExpiryTime() (time.Time, error) {
	value := strings.TrimSpace(e.Expiry)
	if value == "" {
		return time.Time{}, fmt.Errorf("expiry is required")
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("expiry %q must be RFC3339: %v", e.Expiry, err)
	}
	return parsed.UTC(), nil
}

// Expired reports whether the declared expiry is at or before now.
func (e OnlineEgressScope) Expired(now time.Time) bool {
	expiry, err := e.ExpiryTime()
	if err != nil {
		return true
	}
	return !expiry.After(now.UTC())
}

// ValidateFor validates the scope against the endpoint and request shape of
// the profile that embeds it. now is the instant the declaration is admitted;
// a past expiry is refused.
func (e OnlineEgressScope) ValidateFor(endpoint, instructionField string, sendDimensions bool, now time.Time) error {
	if err := validateOnlineProfileToken("egress.destination_host", e.DestinationHost, 255); err != nil {
		return err
	}
	if err := validateEgressDestinationHost(e.DestinationHost, endpoint); err != nil {
		return err
	}
	if err := validateEgressClassList("egress.disclosed_data_classes", e.DisclosedDataClasses, ValidEgressDataClass); err != nil {
		return err
	}
	if err := validateEgressClassList("egress.allowed_subject_classes", e.AllowedSubjectClasses, ValidEgressSubjectClass); err != nil {
		return err
	}
	if err := e.Minimization.validate(expectedOnlineEgressRequestFields(instructionField, sendDimensions)); err != nil {
		return err
	}
	if err := e.Budgets.Validate(); err != nil {
		return fmt.Errorf("%w: egress.budgets: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	expiry, err := e.ExpiryTime()
	if err != nil {
		return fmt.Errorf("%w: egress: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	if !expiry.After(now.UTC()) {
		return fmt.Errorf("%w: egress.expiry %s is not in the future", ErrInvalidOnlineEmbeddingProfile, e.Expiry)
	}
	if _, err := OnlineCredentialRefScheme(e.RevocationRef); err != nil {
		return fmt.Errorf("%w: egress.revocation_ref: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	for name, value := range map[string]string{
		"residency":    e.PolicyRefs.Residency,
		"logging":      e.PolicyRefs.Logging,
		"retention":    e.PolicyRefs.Retention,
		"training_use": e.PolicyRefs.TrainingUse,
		"output_use":   e.PolicyRefs.OutputUse,
	} {
		if err := validateOnlineProfileToken("egress.policy_refs."+name, value, 256); err != nil {
			return err
		}
	}
	return nil
}

// CoversDataClass reports whether the scope declares the data class.
func (e OnlineEgressScope) CoversDataClass(class string) bool {
	for _, candidate := range e.DisclosedDataClasses {
		if candidate == class {
			return true
		}
	}
	return false
}

// CoversSubjectClass reports whether the scope admits the protection outcome.
func (e OnlineEgressScope) CoversSubjectClass(class string) bool {
	for _, candidate := range e.AllowedSubjectClasses {
		if candidate == class {
			return true
		}
	}
	return false
}

func (m OnlineEgressMinimization) validate(expected []string) error {
	if err := validateOnlineProfileToken("egress.minimization.statement", m.Statement, 512); err != nil {
		return err
	}
	if len(m.Fields) == 0 {
		return fmt.Errorf("%w: egress.minimization.fields is required", ErrInvalidOnlineEmbeddingProfile)
	}
	declared := map[string]struct{}{}
	for _, field := range m.Fields {
		if strings.TrimSpace(field) == "" || strings.TrimSpace(field) != field {
			return fmt.Errorf("%w: egress.minimization.fields must not contain empty or padded names", ErrInvalidOnlineEmbeddingProfile)
		}
		if _, duplicate := declared[field]; duplicate {
			return fmt.Errorf("%w: egress.minimization.fields repeats %q", ErrInvalidOnlineEmbeddingProfile, field)
		}
		declared[field] = struct{}{}
	}
	if len(declared) != len(expected) {
		return fmt.Errorf("%w: egress.minimization.fields must be exactly %s (the request body may contain nothing outside it)",
			ErrInvalidOnlineEmbeddingProfile, strings.Join(expected, ","))
	}
	for _, field := range expected {
		if _, ok := declared[field]; !ok {
			return fmt.Errorf("%w: egress.minimization.fields must declare request field %q", ErrInvalidOnlineEmbeddingProfile, field)
		}
	}
	return nil
}

// expectedOnlineEgressRequestFields is the exact JSON field set
// buildRequestBody can transmit for one profile. Map marshaling sorts keys, so
// this list is the complete body vocabulary.
func expectedOnlineEgressRequestFields(instructionField string, sendDimensions bool) []string {
	fields := []string{"model", "input", "encoding_format"}
	if sendDimensions {
		fields = append(fields, "dimensions")
	}
	if strings.TrimSpace(instructionField) != "" {
		fields = append(fields, instructionField)
	}
	return fields
}

func validateEgressClassList(name string, values []string, valid func(string) bool) error {
	if len(values) == 0 {
		return fmt.Errorf("%w: %s is required", ErrInvalidOnlineEmbeddingProfile, name)
	}
	seen := map[string]struct{}{}
	for _, value := range values {
		if strings.TrimSpace(value) != value || value == "" {
			return fmt.Errorf("%w: %s must not contain empty or padded values", ErrInvalidOnlineEmbeddingProfile, name)
		}
		if !valid(value) {
			return fmt.Errorf("%w: %s value %q is not part of the closed vocabulary", ErrInvalidOnlineEmbeddingProfile, name, value)
		}
		if _, duplicate := seen[value]; duplicate {
			return fmt.Errorf("%w: %s repeats %q", ErrInvalidOnlineEmbeddingProfile, name, value)
		}
		seen[value] = struct{}{}
	}
	return nil
}

func validateEgressDestinationHost(destinationHost, endpoint string) error {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" {
		return fmt.Errorf("%w: endpoint host is required before egress.destination_host can be checked", ErrInvalidOnlineEmbeddingProfile)
	}
	if parsed.Host != destinationHost {
		return fmt.Errorf("%w: egress.destination_host %q must equal the endpoint host %q",
			ErrInvalidOnlineEmbeddingProfile, destinationHost, parsed.Host)
	}
	return nil
}
