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
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	OnlineOrganizeProfileSchemaV1 = "cairn.online-organize-profile.v1"
	OnlineOrganizeProfileDirName  = "online-organize"
	OnlineOrganizeProfileFileName = "profile.json"
	OnlineOrganizeProfileMaxBytes = uint64(256 << 10)
	OnlineOrganizeOutputSchema    = "cairn.material-list.v1"
	OnlineOrganizeMaxInputBytes   = int64(128 << 10)
	OnlineOrganizeMaxOutputBytes  = int64(512 << 10)
	OnlineOrganizeMaxOccurrences  = 32
	OnlineOrganizeMaxTimeoutMS    = 90_000
)

var ErrInvalidOnlineOrganizeProfile = errors.New("invalid online material organizer profile")

// OnlineOrganizeProfile is one immutable operator-installed candidate profile.
// It contains no credential material; the host resolves only CredentialRef.
type OnlineOrganizeProfile struct {
	Schema            string            `json:"schema"`
	ProfileID         string            `json:"profile_id"`
	Provider          string            `json:"provider"`
	APIStyle          string            `json:"api_style"`
	Endpoint          string            `json:"endpoint"`
	ModelID           string            `json:"model_id"`
	ModelRevision     string            `json:"model_revision"`
	SystemInstruction string            `json:"system_instruction"`
	OutputSchema      string            `json:"output_schema"`
	MaxOutputTokens   int               `json:"max_output_tokens"`
	MaxOutputBytes    int64             `json:"max_output_bytes"`
	TimeoutMS         int               `json:"timeout_ms"`
	CredentialRef     string            `json:"credential_ref"`
	Egress            OnlineEgressScope `json:"egress"`
}

func (p OnlineOrganizeProfile) ProviderProfileDigest() string {
	payload, _ := json.Marshal(p)
	h := sha256.Sum256(append([]byte(OnlineOrganizeProfileSchemaV1+"\n"), payload...))
	return "sha256:" + hex.EncodeToString(h[:])
}

func (p OnlineOrganizeProfile) EndpointHost() string {
	parsed, err := url.Parse(p.Endpoint)
	if err != nil {
		return ""
	}
	return parsed.Host
}

func (p OnlineOrganizeProfile) Validate() error { return p.ValidateAt(time.Now().UTC()) }

func (p OnlineOrganizeProfile) ValidateAt(now time.Time) error {
	bad := func(format string, args ...any) error {
		return fmt.Errorf("%w: %s", ErrInvalidOnlineOrganizeProfile, fmt.Sprintf(format, args...))
	}
	if p.Schema != OnlineOrganizeProfileSchemaV1 {
		return bad("schema must be %q", OnlineOrganizeProfileSchemaV1)
	}
	if err := validateOnlineProfileID("profile_id", p.ProfileID); err != nil {
		return bad("%v", err)
	}
	if err := validateOnlineProfileToken("provider", p.Provider, 64); err != nil {
		return bad("%v", err)
	}
	if p.APIStyle != OnlineDescribeAPIStyleOpenAI {
		return bad("api_style must be %q", OnlineDescribeAPIStyleOpenAI)
	}
	if err := validateOnlineEmbeddingEndpoint(p.Endpoint); err != nil {
		return bad("%v", err)
	}
	if err := validateOnlineProfileToken("model_id", p.ModelID, 256); err != nil {
		return bad("%v", err)
	}
	if err := validateOnlineProfileToken("model_revision", p.ModelRevision, 256); err != nil {
		return bad("%v", err)
	}
	if p.SystemInstruction == "" || !utf8.ValidString(p.SystemInstruction) || strings.ContainsRune(p.SystemInstruction, '\x00') || len(p.SystemInstruction) > 16<<10 {
		return bad("system_instruction must be valid UTF-8 inside 16 KiB")
	}
	if p.OutputSchema != OnlineOrganizeOutputSchema {
		return bad("output_schema must be %q", OnlineOrganizeOutputSchema)
	}
	if p.MaxOutputTokens < 1 || p.MaxOutputTokens > 200_000 {
		return bad("max_output_tokens is outside 1..200000")
	}
	if p.MaxOutputBytes < 1 || p.MaxOutputBytes > OnlineOrganizeMaxOutputBytes {
		return bad("max_output_bytes is outside 1..%d", OnlineOrganizeMaxOutputBytes)
	}
	if p.TimeoutMS < 1000 || p.TimeoutMS > OnlineOrganizeMaxTimeoutMS {
		return bad("timeout_ms is outside 1000..%d", OnlineOrganizeMaxTimeoutMS)
	}
	if _, err := OnlineCredentialRefScheme(p.CredentialRef); err != nil {
		return bad("credential_ref: %v", err)
	}
	e := p.Egress
	if err := validateOnlineProfileToken("egress.destination_host", e.DestinationHost, 255); err != nil {
		return bad("%v", err)
	}
	if err := validateEgressDestinationHost(e.DestinationHost, p.Endpoint); err != nil {
		return bad("%v", err)
	}
	if len(e.DisclosedDataClasses) != 1 || e.DisclosedDataClasses[0] != EgressDataClassTextMaterialList {
		return bad("egress.disclosed_data_classes must contain only %q", EgressDataClassTextMaterialList)
	}
	if err := validateEgressClassList("egress.allowed_subject_classes", e.AllowedSubjectClasses, ValidEgressSubjectClass); err != nil {
		return bad("%v", err)
	}
	if err := validateOnlineProfileToken("egress.minimization.statement", e.Minimization.Statement, 512); err != nil {
		return bad("%v", err)
	}
	want := []string{"max_tokens", "messages", "model"}
	if len(e.Minimization.Fields) != len(want) {
		return bad("egress.minimization.fields must declare exactly %s", strings.Join(want, ","))
	}
	fields := map[string]bool{}
	for _, field := range e.Minimization.Fields {
		if strings.TrimSpace(field) != field || fields[field] {
			return bad("egress.minimization.fields contains a padded or repeated field")
		}
		fields[field] = true
	}
	for _, field := range want {
		if !fields[field] {
			return bad("egress.minimization.fields must declare %q", field)
		}
	}
	if err := e.Budgets.Validate(); err != nil {
		return bad("egress.budgets: %v", err)
	}
	if e.Budgets.MaxRequests != 1 {
		return bad("egress.budgets.max_requests must be exactly 1")
	}
	if e.Budgets.MaxSeconds > int64(OnlineOrganizeMaxTimeoutMS/1000) {
		return bad("egress.budgets.max_seconds exceeds the operation deadline")
	}
	if _, err := e.ExpiryTime(); err != nil {
		return bad("egress.expiry: %v", err)
	}
	if !e.ExpiryTimeAfter(now) {
		return bad("egress.expiry must be in the future")
	}
	if _, err := OnlineCredentialRefScheme(e.RevocationRef); err != nil {
		return bad("egress.revocation_ref: %v", err)
	}
	for name, value := range map[string]string{"residency": e.PolicyRefs.Residency, "logging": e.PolicyRefs.Logging, "retention": e.PolicyRefs.Retention, "training_use": e.PolicyRefs.TrainingUse, "output_use": e.PolicyRefs.OutputUse} {
		if err := validateOnlineProfileToken("egress.policy_refs."+name, value, 256); err != nil {
			return bad("%v", err)
		}
	}
	return nil
}

func (e OnlineEgressScope) ExpiryTimeAfter(now time.Time) bool {
	expiry, err := e.ExpiryTime()
	return err == nil && expiry.After(now.UTC())
}

func ParseOnlineOrganizeProfile(payload []byte) (OnlineOrganizeProfile, error) {
	if len(payload) == 0 || uint64(len(payload)) > OnlineOrganizeProfileMaxBytes {
		return OnlineOrganizeProfile{}, fmt.Errorf("%w: descriptor size is outside bounds", ErrInvalidOnlineOrganizeProfile)
	}
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	var profile OnlineOrganizeProfile
	if err := decoder.Decode(&profile); err != nil {
		return profile, fmt.Errorf("%w: decode descriptor: %v", ErrInvalidOnlineOrganizeProfile, err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return profile, fmt.Errorf("%w: descriptor contains trailing JSON", ErrInvalidOnlineOrganizeProfile)
	}
	if err := profile.Validate(); err != nil {
		return profile, err
	}
	return profile, nil
}

func OnlineOrganizeProfilePath(modelsRoot, profileID string) (string, error) {
	if strings.TrimSpace(modelsRoot) == "" || !filepath.IsAbs(modelsRoot) || filepath.Clean(modelsRoot) != modelsRoot {
		return "", fmt.Errorf("%w: models root must be absolute and canonical", ErrInvalidOnlineOrganizeProfile)
	}
	if err := validateOnlineProfileID("profile_id", profileID); err != nil {
		return "", fmt.Errorf("%w: %v", ErrInvalidOnlineOrganizeProfile, err)
	}
	return filepath.Join(modelsRoot, OnlineOrganizeProfileDirName, profileID, OnlineOrganizeProfileFileName), nil
}

func LoadOnlineOrganizeProfile(modelsRoot, profileID string) (OnlineOrganizeProfile, error) {
	if _, err := OnlineOrganizeProfilePath(modelsRoot, profileID); err != nil {
		return OnlineOrganizeProfile{}, err
	}
	dir := filepath.Join(modelsRoot, OnlineOrganizeProfileDirName, profileID)
	info, err := os.Lstat(dir)
	if err != nil {
		return OnlineOrganizeProfile{}, fmt.Errorf("%w: profile %q is not installed", ErrInvalidOnlineOrganizeProfile, profileID)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return OnlineOrganizeProfile{}, fmt.Errorf("%w: profile directory must be real", ErrInvalidOnlineOrganizeProfile)
	}
	file, err := openBundleFileNoFollow(dir, OnlineOrganizeProfileFileName)
	if err != nil {
		return OnlineOrganizeProfile{}, fmt.Errorf("%w: open profile descriptor", ErrInvalidOnlineOrganizeProfile)
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !stat.Mode().IsRegular() || stat.Size() <= 0 || uint64(stat.Size()) > OnlineOrganizeProfileMaxBytes {
		return OnlineOrganizeProfile{}, fmt.Errorf("%w: descriptor must be a bounded regular file", ErrInvalidOnlineOrganizeProfile)
	}
	payload, err := io.ReadAll(io.LimitReader(file, int64(OnlineOrganizeProfileMaxBytes)+1))
	if err != nil {
		return OnlineOrganizeProfile{}, fmt.Errorf("%w: read descriptor", ErrInvalidOnlineOrganizeProfile)
	}
	profile, err := ParseOnlineOrganizeProfile(payload)
	if err != nil {
		return OnlineOrganizeProfile{}, err
	}
	if profile.ProfileID != profileID {
		return OnlineOrganizeProfile{}, fmt.Errorf("%w: profile id does not match selected directory", ErrInvalidOnlineOrganizeProfile)
	}
	return profile, nil
}

type InstalledOnlineOrganizeProfile struct {
	Profile     OnlineOrganizeProfile
	Destination string
	Expired     bool
}

func ListOnlineOrganizeProfiles(modelsRoot string) ([]InstalledOnlineOrganizeProfile, error) {
	root, err := canonicalSemanticBundleInstallRoot(modelsRoot)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidOnlineOrganizeProfile, err)
	}
	base := filepath.Join(root, OnlineOrganizeProfileDirName)
	info, err := os.Lstat(base)
	if errors.Is(err, os.ErrNotExist) {
		return []InstalledOnlineOrganizeProfile{}, nil
	}
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return nil, fmt.Errorf("%w: organizer profile directory is unavailable", ErrInvalidOnlineOrganizeProfile)
	}
	entries, err := os.ReadDir(base)
	if err != nil {
		return nil, fmt.Errorf("%w: read profile directory", ErrInvalidOnlineOrganizeProfile)
	}
	out := make([]InstalledOnlineOrganizeProfile, 0, len(entries))
	now := time.Now().UTC()
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if !entry.IsDir() {
			return nil, fmt.Errorf("%w: profile entry is not a directory", ErrInvalidOnlineOrganizeProfile)
		}
		profile, err := LoadOnlineOrganizeProfile(root, entry.Name())
		if err != nil {
			return nil, err
		}
		path, err := OnlineOrganizeProfilePath(root, entry.Name())
		if err != nil {
			return nil, err
		}
		out = append(out, InstalledOnlineOrganizeProfile{Profile: profile, Destination: path, Expired: profile.Egress.Expired(now)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Profile.ProfileID < out[j].Profile.ProfileID })
	return out, nil
}
