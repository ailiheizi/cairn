package search

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

// Online describe profiles
//
// `descriptions.provider_profile` names one immutable online DESCRIBE_SUBJECT
// profile manifest. Like the online embedding profile, the manifest pins every
// fact that can change what the provider is and what it may receive: endpoint
// identity, provider identity, model id and revision, output bounds, timeout,
// the vendor system instruction, the egress scope, and the credential
// reference. The config chooses the profile by name; it never partially
// overrides its meaning.
//
// The profile is digest-bound: ProviderProfileDigest covers the whole document
// including its egress scope, so an installed grant or a recorded receipt can
// never be reinterpreted by editing one egress fact in place.

const (
	// OnlineDescribeProfileSchemaV1 is the only describe profile schema
	// accepted by this package. Unlike the embedding profile there is no
	// superseded version: the schema carries the required egress scope from
	// the start.
	OnlineDescribeProfileSchemaV1 = "cairn.online-describe-profile.v1"

	// OnlineDescribeProfileDirName and OnlineDescribeProfileFileName are the
	// only accepted location below the configured paths.models root:
	// <models>/online-describe/<profile_id>/profile.json.
	OnlineDescribeProfileDirName  = "online-describe"
	OnlineDescribeProfileFileName = "profile.json"

	// OnlineDescribeProfileMaxBytes bounds the strict manifest decode.
	OnlineDescribeProfileMaxBytes = uint64(256 << 10)

	// OnlineDescribeAPIStyleOpenAI is the only admitted HTTP request shape:
	// the OpenAI-compatible chat-completions JSON body.
	OnlineDescribeAPIStyleOpenAI = "openai-chat-completions-v1"

	// OnlineDescribeOutputSchema is the schema reference recorded in every
	// describe egress receipt: the admitted chat-completions response shape
	// (one choice carrying a UTF-8 message content string).
	OnlineDescribeOutputSchema = "cairn.online-describe-output.v1"

	// Output bounds. The durable description revision cap remains the
	// content-store contract's 16 MiB; a describe profile can never declare a
	// larger candidate.
	OnlineDescribeMaxOutputBytes = int64(16 << 20)
)

// DescribeEgressDataClasses returns the describe-family data classes in stable
// order. They are part of the single closed egress vocabulary in
// egress_scope.go; an embedding profile or grant never names them.
func DescribeEgressDataClasses() []string {
	return []string{EgressDataClassTextSubjectContext, EgressDataClassImageBytes}
}

// ErrInvalidOnlineDescribeProfile identifies a profile manifest that cannot
// safely describe a DESCRIBE_SUBJECT provider.
var ErrInvalidOnlineDescribeProfile = errors.New("invalid online describe profile")

// OnlineDescribeProfile is one immutable, operator-installed online
// DESCRIBE_SUBJECT profile. It contains no credential material: the profile
// names the credential reference, and the secret is resolved at request time
// through the host resolver.
type OnlineDescribeProfile struct {
	Schema    string `json:"schema"`
	ProfileID string `json:"profile_id"`
	// Provider is the vendor or aggregator identity. It is recorded in every
	// receipt so the same model id served by a different recipient stays
	// attributable.
	Provider string `json:"provider"`
	APIStyle string `json:"api_style"`
	// Endpoint is the absolute request URL. Non-loopback endpoints must use
	// https; userinfo, query parameters, and fragments are rejected so a
	// destination cannot smuggle access material.
	Endpoint string `json:"endpoint"`
	ModelID  string `json:"model_id"`
	// ModelRevision pins the vendor revision/version string. It is required:
	// a silent vendor model update is a different provider identity.
	ModelRevision string `json:"model_revision"`
	// SystemInstruction is the vendor task instruction sent as the system
	// message. It is digest-bound so the profile's meaning cannot change
	// without a new provider identity. It must be valid UTF-8 without NUL.
	SystemInstruction string `json:"system_instruction"`
	// MaxOutputTokens is the max_tokens value sent with every request.
	MaxOutputTokens int `json:"max_output_tokens"`
	// MaxOutputBytes is the candidate body bound the host enforces before
	// admission.
	MaxOutputBytes int64 `json:"max_output_bytes"`
	TimeoutMS      int   `json:"timeout_ms"`
	// CredentialRef is the scheme-qualified host secret reference (env:// or
	// keychain://). It is part of the digest; a re-pointed credential is a new
	// provider identity.
	CredentialRef string `json:"credential_ref"`
	// Egress is the immutable egress declaration. It is part of the profile
	// document, so ProviderProfileDigest covers it.
	Egress OnlineEgressScope `json:"egress"`
}

// ProviderProfileDigest binds the complete immutable profile (including the
// endpoint, the egress scope, and the credential reference). Replacing the
// manifest therefore cannot reinterpret old provider facts.
func (p OnlineDescribeProfile) ProviderProfileDigest() string {
	payload, _ := json.Marshal(p)
	h := sha256.Sum256(append([]byte(OnlineDescribeProfileSchemaV1+"\n"), payload...))
	return "sha256:" + hex.EncodeToString(h[:])
}

// EndpointHost returns the sanitized destination authority (host[:port]) for
// receipts and diagnostics. It never contains userinfo or query material.
func (p OnlineDescribeProfile) EndpointHost() string {
	parsed, err := url.Parse(p.Endpoint)
	if err != nil || parsed.Host == "" {
		return ""
	}
	return parsed.Host
}

// Validate rejects an incomplete or unsafe profile before it can describe a
// production disclosure. Empty values are not meaningful defaults.
func (p OnlineDescribeProfile) Validate() error {
	return p.ValidateAt(time.Now().UTC())
}

// ValidateAt is Validate against one explicit instant. Expiry is a profile
// fact, so admitting a past-expiry profile is refused; a profile that expires
// while a daemon runs is refused per request by the egress gate with the
// dedicated EGRESS_PROFILE_EXPIRED reason.
func (p OnlineDescribeProfile) ValidateAt(now time.Time) error {
	if p.Schema != OnlineDescribeProfileSchemaV1 {
		return fmt.Errorf("%w: schema must be %q", ErrInvalidOnlineDescribeProfile, OnlineDescribeProfileSchemaV1)
	}
	if err := validateOnlineProfileID("profile_id", p.ProfileID); err != nil {
		return describeProfileError(err)
	}
	if err := validateOnlineProfileToken("provider", p.Provider, 64); err != nil {
		return describeProfileError(err)
	}
	if p.APIStyle != OnlineDescribeAPIStyleOpenAI {
		return fmt.Errorf("%w: api_style %q is not supported (want %q)", ErrInvalidOnlineDescribeProfile, p.APIStyle, OnlineDescribeAPIStyleOpenAI)
	}
	if err := validateOnlineEmbeddingEndpoint(p.Endpoint); err != nil {
		return describeProfileError(err)
	}
	if err := validateOnlineProfileToken("model_id", p.ModelID, 200); err != nil {
		return describeProfileError(err)
	}
	if err := validateOnlineProfileToken("model_revision", p.ModelRevision, 200); err != nil {
		return describeProfileError(err)
	}
	if len(p.SystemInstruction) > 2048 {
		return fmt.Errorf("%w: system_instruction exceeds 2048 bytes", ErrInvalidOnlineDescribeProfile)
	}
	if !utf8.ValidString(p.SystemInstruction) || strings.ContainsRune(p.SystemInstruction, 0) {
		return fmt.Errorf("%w: system_instruction must be valid text without NUL", ErrInvalidOnlineDescribeProfile)
	}
	if p.MaxOutputTokens <= 0 || p.MaxOutputTokens > 200_000 {
		return fmt.Errorf("%w: max_output_tokens %d is outside 1..200000", ErrInvalidOnlineDescribeProfile, p.MaxOutputTokens)
	}
	if p.MaxOutputBytes <= 0 || p.MaxOutputBytes > OnlineDescribeMaxOutputBytes {
		return fmt.Errorf("%w: max_output_bytes %d is outside 1..%d", ErrInvalidOnlineDescribeProfile, p.MaxOutputBytes, OnlineDescribeMaxOutputBytes)
	}
	if p.TimeoutMS < 1000 || p.TimeoutMS > 600000 {
		return fmt.Errorf("%w: timeout_ms %d is outside 1000..600000", ErrInvalidOnlineDescribeProfile, p.TimeoutMS)
	}
	if _, err := OnlineCredentialRefScheme(p.CredentialRef); err != nil {
		return fmt.Errorf("%w: credential_ref: %v", ErrInvalidOnlineDescribeProfile, err)
	}
	return validateDescribeEgressScope(p.Egress, p.Endpoint, now)
}

func describeProfileError(err error) error {
	return fmt.Errorf("%w: %v", ErrInvalidOnlineDescribeProfile, err)
}

// validateDescribeEgressScope validates the immutable egress declaration of one
// describe profile. The request body this family builds carries exactly the
// JSON fields max_tokens, messages, and model, so the minimization declaration
// must be exactly that set; the data classes must come from the closed
// describe-family vocabulary.
func validateDescribeEgressScope(e OnlineEgressScope, endpoint string, now time.Time) error {
	if err := validateOnlineProfileToken("egress.destination_host", e.DestinationHost, 255); err != nil {
		return describeProfileError(err)
	}
	if err := validateEgressDestinationHost(e.DestinationHost, endpoint); err != nil {
		return describeProfileError(err)
	}
	if err := describeClassList("egress.disclosed_data_classes", e.DisclosedDataClasses, true); err != nil {
		return err
	}
	if err := describeClassList("egress.allowed_subject_classes", e.AllowedSubjectClasses, false); err != nil {
		return err
	}
	if err := validateOnlineProfileToken("egress.minimization.statement", e.Minimization.Statement, 512); err != nil {
		return describeProfileError(err)
	}
	expected := describeEgressRequestFields()
	if len(e.Minimization.Fields) != len(expected) {
		return fmt.Errorf("%w: egress.minimization.fields must be exactly %s (the request body may contain nothing outside it)",
			ErrInvalidOnlineDescribeProfile, strings.Join(expected, ","))
	}
	declared := map[string]struct{}{}
	for _, field := range e.Minimization.Fields {
		if strings.TrimSpace(field) == "" || strings.TrimSpace(field) != field {
			return fmt.Errorf("%w: egress.minimization.fields must not contain empty or padded names", ErrInvalidOnlineDescribeProfile)
		}
		if _, duplicate := declared[field]; duplicate {
			return fmt.Errorf("%w: egress.minimization.fields repeats %q", ErrInvalidOnlineDescribeProfile, field)
		}
		declared[field] = struct{}{}
	}
	for _, field := range expected {
		if _, ok := declared[field]; !ok {
			return fmt.Errorf("%w: egress.minimization.fields must declare request field %q", ErrInvalidOnlineDescribeProfile, field)
		}
	}
	if err := e.Budgets.Validate(); err != nil {
		return fmt.Errorf("%w: egress.budgets: %v", ErrInvalidOnlineDescribeProfile, err)
	}
	expiry, err := e.ExpiryTime()
	if err != nil {
		return fmt.Errorf("%w: egress: %v", ErrInvalidOnlineDescribeProfile, err)
	}
	if !expiry.After(now.UTC()) {
		return fmt.Errorf("%w: egress.expiry %s is not in the future", ErrInvalidOnlineDescribeProfile, e.Expiry)
	}
	if _, err := OnlineCredentialRefScheme(e.RevocationRef); err != nil {
		return fmt.Errorf("%w: egress.revocation_ref: %v", ErrInvalidOnlineDescribeProfile, err)
	}
	for name, value := range map[string]string{
		"residency":    e.PolicyRefs.Residency,
		"logging":      e.PolicyRefs.Logging,
		"retention":    e.PolicyRefs.Retention,
		"training_use": e.PolicyRefs.TrainingUse,
		"output_use":   e.PolicyRefs.OutputUse,
	} {
		if err := validateOnlineProfileToken("egress.policy_refs."+name, value, 256); err != nil {
			return describeProfileError(err)
		}
	}
	return nil
}

// describeEgressRequestFields is the exact JSON field set the describe
// provider's request builder can transmit. Map marshaling sorts keys, so this
// list is the complete body vocabulary.
func describeEgressRequestFields() []string {
	return []string{"max_tokens", "messages", "model"}
}

// describeClassList validates a closed class list. Data classes come from the
// describe-family vocabulary; subject classes are the shared protection
// outcome vocabulary both provider families use.
func describeClassList(name string, values []string, dataClasses bool) error {
	if len(values) == 0 {
		return fmt.Errorf("%w: %s is required", ErrInvalidOnlineDescribeProfile, name)
	}
	valid := ValidEgressSubjectClass
	if dataClasses {
		valid = ValidDescribeEgressDataClass
	}
	seen := map[string]struct{}{}
	for _, value := range values {
		if strings.TrimSpace(value) != value || value == "" {
			return fmt.Errorf("%w: %s must not contain empty or padded values", ErrInvalidOnlineDescribeProfile, name)
		}
		if !valid(value) {
			return fmt.Errorf("%w: %s value %q is not part of the closed vocabulary", ErrInvalidOnlineDescribeProfile, name, value)
		}
		if _, duplicate := seen[value]; duplicate {
			return fmt.Errorf("%w: %s repeats %q", ErrInvalidOnlineDescribeProfile, name, value)
		}
		seen[value] = struct{}{}
	}
	return nil
}

// ValidDescribeEgressDataClass reports whether value is a data class the
// describe family may disclose.
func ValidDescribeEgressDataClass(value string) bool {
	for _, candidate := range DescribeEgressDataClasses() {
		if value == candidate {
			return true
		}
	}
	return false
}

// ParseOnlineDescribeProfile strictly decodes one profile manifest. Unknown
// fields are refused so a descriptor cannot carry unreviewed meaning.
func ParseOnlineDescribeProfile(payload []byte) (OnlineDescribeProfile, error) {
	if len(payload) == 0 || uint64(len(payload)) > OnlineDescribeProfileMaxBytes {
		return OnlineDescribeProfile{}, fmt.Errorf("%w: descriptor size %d is outside bounds", ErrInvalidOnlineDescribeProfile, len(payload))
	}
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	var profile OnlineDescribeProfile
	if err := decoder.Decode(&profile); err != nil {
		return OnlineDescribeProfile{}, fmt.Errorf("%w: decode descriptor: %v", ErrInvalidOnlineDescribeProfile, err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return OnlineDescribeProfile{}, fmt.Errorf("%w: descriptor contains more than one JSON value", ErrInvalidOnlineDescribeProfile)
		}
		return OnlineDescribeProfile{}, fmt.Errorf("%w: read descriptor: %v", ErrInvalidOnlineDescribeProfile, err)
	}
	if err := profile.Validate(); err != nil {
		return OnlineDescribeProfile{}, err
	}
	return profile, nil
}

// OnlineDescribeProfilePath returns the only accepted location of one profile
// manifest below the configured models root.
func OnlineDescribeProfilePath(modelsRoot, profileID string) (string, error) {
	if strings.TrimSpace(modelsRoot) == "" || !filepath.IsAbs(modelsRoot) || filepath.Clean(modelsRoot) != modelsRoot {
		return "", fmt.Errorf("%w: models root must be an absolute canonical path", ErrInvalidOnlineDescribeProfile)
	}
	if err := validateOnlineProfileID("profile_id", profileID); err != nil {
		return "", describeProfileError(err)
	}
	return filepath.Join(modelsRoot, OnlineDescribeProfileDirName, profileID, OnlineDescribeProfileFileName), nil
}

// LoadOnlineDescribeProfile reads and admits one operator-installed describe
// profile. The manifest is opened without following symlinks and is strictly
// decoded; the declared profile_id must match the selected name so a config
// reference cannot resolve to a different profile's meaning. No network call
// is made here, and no credential is read.
func LoadOnlineDescribeProfile(modelsRoot, profileID string) (OnlineDescribeProfile, error) {
	if _, err := OnlineDescribeProfilePath(modelsRoot, profileID); err != nil {
		return OnlineDescribeProfile{}, err
	}
	dir := filepath.Join(modelsRoot, OnlineDescribeProfileDirName, profileID)
	info, err := os.Lstat(dir)
	if err != nil {
		return OnlineDescribeProfile{}, fmt.Errorf("%w: profile %q is not installed: %v", ErrInvalidOnlineDescribeProfile, profileID, err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return OnlineDescribeProfile{}, fmt.Errorf("%w: profile %q root must be a real directory", ErrInvalidOnlineDescribeProfile, profileID)
	}
	file, err := openBundleFileNoFollow(dir, OnlineDescribeProfileFileName)
	if err != nil {
		return OnlineDescribeProfile{}, fmt.Errorf("%w: open descriptor: %v", ErrInvalidOnlineDescribeProfile, err)
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return OnlineDescribeProfile{}, fmt.Errorf("%w: stat descriptor: %v", ErrInvalidOnlineDescribeProfile, err)
	}
	if !stat.Mode().IsRegular() || stat.Size() <= 0 || uint64(stat.Size()) > OnlineDescribeProfileMaxBytes {
		return OnlineDescribeProfile{}, fmt.Errorf("%w: descriptor must be a regular file inside the size bounds", ErrInvalidOnlineDescribeProfile)
	}
	payload, err := io.ReadAll(io.LimitReader(file, int64(OnlineDescribeProfileMaxBytes)+1))
	if err != nil {
		return OnlineDescribeProfile{}, fmt.Errorf("%w: read descriptor: %v", ErrInvalidOnlineDescribeProfile, err)
	}
	profile, err := ParseOnlineDescribeProfile(payload)
	if err != nil {
		return OnlineDescribeProfile{}, err
	}
	if profile.ProfileID != profileID {
		return OnlineDescribeProfile{}, fmt.Errorf("%w: descriptor profile_id %q does not match selected profile %q", ErrInvalidOnlineDescribeProfile, profile.ProfileID, profileID)
	}
	return profile, nil
}
