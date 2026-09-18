package search

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testDescribeEgressScope(t *testing.T, endpoint string, dataClasses ...string) OnlineEgressScope {
	t.Helper()
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" {
		t.Fatalf("test endpoint %q has no host: %v", endpoint, err)
	}
	if len(dataClasses) == 0 {
		dataClasses = []string{EgressDataClassTextSubjectContext}
	}
	return OnlineEgressScope{
		DestinationHost:       parsed.Host,
		DisclosedDataClasses:  dataClasses,
		AllowedSubjectClasses: EgressSubjectClasses(),
		Minimization: OnlineEgressMinimization{
			Statement: "only the model id, the chat messages assembled from admitted extract text, and max_tokens are transmitted",
			Fields:    describeEgressRequestFields(),
		},
		Budgets:       EgressBudget{MaxRequests: 4, MaxBytes: 1 << 20, MaxSeconds: 120},
		Expiry:        time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339),
		RevocationRef: "env://RW_TEST_REVOKED_DESCRIBE",
		PolicyRefs: OnlineEgressPolicyRefs{
			Residency: "loopback-stub", Logging: "stub", Retention: "none",
			TrainingUse: "none", OutputUse: "operator-only",
		},
		AuditRequired: true,
	}
}

func testDescribeProfile(t *testing.T, endpoint string, dataClasses ...string) OnlineDescribeProfile {
	t.Helper()
	profile := OnlineDescribeProfile{
		Schema:            OnlineDescribeProfileSchemaV1,
		ProfileID:         "stub-describe-v1",
		Provider:          "stub",
		APIStyle:          OnlineDescribeAPIStyleOpenAI,
		Endpoint:          endpoint,
		ModelID:           "stub-describe-model",
		ModelRevision:     "2026-09-18",
		SystemInstruction: "You write short durable descriptions from the supplied source material.",
		MaxOutputTokens:   512,
		MaxOutputBytes:    1 << 20,
		TimeoutMS:         5000,
		CredentialRef:     "env://RW_TEST_DESCRIBE_KEY",
		Egress:            testDescribeEgressScope(t, endpoint, dataClasses...),
	}
	if err := profile.Validate(); err != nil {
		t.Fatalf("test describe profile must be valid: %v", err)
	}
	return profile
}

func TestParseOnlineDescribeProfileRoundTrip(t *testing.T) {
	endpoint := "https://api.example.invalid/v1/chat/completions"
	profile := testDescribeProfile(t, endpoint)
	payload, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseOnlineDescribeProfile(payload)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed.ProfileID != profile.ProfileID || parsed.ModelID != profile.ModelID || parsed.CredentialRef != profile.CredentialRef {
		t.Fatalf("parsed profile = %+v", parsed)
	}
	if parsed.ProviderProfileDigest() == "" || parsed.ProviderProfileDigest() != profile.ProviderProfileDigest() {
		t.Fatal("the profile digest must be stable across a parse round trip")
	}
	if parsed.EndpointHost() != "api.example.invalid" {
		t.Fatalf("endpoint host = %q", parsed.EndpointHost())
	}
}

func TestParseOnlineDescribeProfileRejectsUnsafeManifests(t *testing.T) {
	base := func(t *testing.T) map[string]any {
		t.Helper()
		payload, err := json.Marshal(testDescribeProfile(t, "https://api.example.invalid/v1/chat/completions"))
		if err != nil {
			t.Fatal(err)
		}
		var document map[string]any
		if err := json.Unmarshal(payload, &document); err != nil {
			t.Fatal(err)
		}
		return document
	}
	embeddingsDocument := base(t)
	embeddingsDocument["schema"] = OnlineEmbeddingProfileSchemaV2
	mutations := []struct {
		name   string
		mutate func(document map[string]any)
		want   string
	}{
		{"unknown field", func(d map[string]any) { d["surprise"] = true }, "unknown field"},
		{"embedding schema", func(d map[string]any) { d["schema"] = OnlineEmbeddingProfileSchemaV2 }, "schema must be"},
		{"unknown schema", func(d map[string]any) { d["schema"] = "restoreweave.online-describe-profile.v2" }, "schema must be"},
		{"api style", func(d map[string]any) { d["api_style"] = "openai-embeddings-v1" }, "api_style"},
		{"plain http to remote host", func(d map[string]any) { d["endpoint"] = "http://api.example.invalid/v1/chat/completions" }, "https"},
		{"endpoint userinfo", func(d map[string]any) { d["endpoint"] = "https://user:pass@api.example.invalid/v1/chat/completions" }, "userinfo"},
		{"endpoint query", func(d map[string]any) { d["endpoint"] = "https://api.example.invalid/v1/chat/completions?key=abc" }, "query"},
		{"model revision", func(d map[string]any) { d["model_revision"] = "" }, "model_revision"},
		{"max output tokens", func(d map[string]any) { d["max_output_tokens"] = 0 }, "max_output_tokens"},
		{"max output bytes", func(d map[string]any) { d["max_output_bytes"] = -1 }, "max_output_bytes"},
		{"timeout", func(d map[string]any) { d["timeout_ms"] = 10 }, "timeout_ms"},
		{"credential reference", func(d map[string]any) { d["credential_ref"] = "https://keys.example.invalid" }, "credential_ref"},
		{"data class outside the closed vocabulary", func(d map[string]any) {
			d["egress"].(map[string]any)["disclosed_data_classes"] = []string{"text.segment"}
		}, "closed vocabulary"},
		{"subject class outside the closed vocabulary", func(d map[string]any) {
			d["egress"].(map[string]any)["allowed_subject_classes"] = []string{"UNPROTECTED"}
		}, "closed vocabulary"},
		{"minimization fields", func(d map[string]any) {
			d["egress"].(map[string]any)["minimization"].(map[string]any)["fields"] = []string{"model", "input", "encoding_format"}
		}, "must declare request field"},
		{"destination host mismatch", func(d map[string]any) {
			d["egress"].(map[string]any)["destination_host"] = "other.example.invalid:443"
		}, "must equal the endpoint host"},
		{"budget", func(d map[string]any) {
			d["egress"].(map[string]any)["budgets"].(map[string]any)["max_requests"] = 0
		}, "max_requests"},
		{"profile id path", func(d map[string]any) { d["profile_id"] = "../escape" }, "path-safe"},
	}
	for _, test := range mutations {
		t.Run(test.name, func(t *testing.T) {
			document := base(t)
			test.mutate(document)
			payload, err := json.Marshal(document)
			if err != nil {
				t.Fatal(err)
			}
			_, err = ParseOnlineDescribeProfile(payload)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("parse error = %v, want substring %q", err, test.want)
			}
		})
	}
}

func TestOnlineDescribeProfileDigestBindsEveryFact(t *testing.T) {
	base := testDescribeProfile(t, "https://api.example.invalid/v1/chat/completions")
	fact := func(mutate func(*OnlineDescribeProfile)) string {
		profile := base
		mutate(&profile)
		return profile.ProviderProfileDigest()
	}
	baseline := base.ProviderProfileDigest()
	for name, mutate := range map[string]func(*OnlineDescribeProfile){
		"endpoint":           func(p *OnlineDescribeProfile) { p.Endpoint = "https://other.example.invalid/v1/chat/completions" },
		"model":              func(p *OnlineDescribeProfile) { p.ModelID = "other-model" },
		"model revision":     func(p *OnlineDescribeProfile) { p.ModelRevision = "2026-10-01" },
		"system instruction": func(p *OnlineDescribeProfile) { p.SystemInstruction = "different instruction" },
		"max output tokens":  func(p *OnlineDescribeProfile) { p.MaxOutputTokens = 256 },
		"timeout":            func(p *OnlineDescribeProfile) { p.TimeoutMS = 9000 },
		"credential ref":     func(p *OnlineDescribeProfile) { p.CredentialRef = "keychain://restoreweave/describe" },
		"egress data classes": func(p *OnlineDescribeProfile) {
			p.Egress.DisclosedDataClasses = []string{EgressDataClassTextSubjectContext, EgressDataClassImageBytes}
		},
		"egress budgets": func(p *OnlineDescribeProfile) { p.Egress.Budgets.MaxRequests = 2 },
	} {
		if digest := fact(mutate); digest == baseline {
			t.Fatalf("%s must change the provider profile digest", name)
		}
	}
}

func TestLoadOnlineDescribeProfile(t *testing.T) {
	modelsRoot := t.TempDir()
	profile := testDescribeProfile(t, "https://api.example.invalid/v1/chat/completions")
	payload, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(modelsRoot, OnlineDescribeProfileDirName, profile.ProfileID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, OnlineDescribeProfileFileName), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadOnlineDescribeProfile(modelsRoot, profile.ProfileID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.ProviderProfileDigest() != profile.ProviderProfileDigest() {
		t.Fatal("the loaded profile digest differs from the installed document")
	}
	// A config reference cannot resolve to a different profile's meaning.
	if _, err := LoadOnlineDescribeProfile(modelsRoot, "other-profile"); err == nil {
		t.Fatal("loading a profile that is not installed must fail")
	}
	// A mismatched profile_id inside the document is refused: the original
	// document (profile_id stub-describe-v1) must not load under the
	// other-profile name.
	other := filepath.Join(modelsRoot, OnlineDescribeProfileDirName, "other-profile")
	if err := os.MkdirAll(other, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(other, OnlineDescribeProfileFileName), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOnlineDescribeProfile(modelsRoot, "other-profile"); err == nil || !strings.Contains(err.Error(), "does not match selected profile") {
		t.Fatalf("mismatched profile_id error = %v", err)
	}
}

func TestValidDescribeEgressDataClassIsClosed(t *testing.T) {
	for _, class := range DescribeEgressDataClasses() {
		if !ValidDescribeEgressDataClass(class) || !ValidEgressDataClass(class) {
			t.Fatalf("describe data class %q must be admitted by the closed egress vocabulary", class)
		}
	}
	if ValidDescribeEgressDataClass("text.segment") || ValidDescribeEgressDataClass("text.query") {
		t.Fatal("the describe family must not disclose the embedding family's classes")
	}
	if ValidEgressDataClass("audio.frames") {
		t.Fatal("the closed data-class vocabulary admitted an unknown class")
	}
}
