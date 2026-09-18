package search

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func validOnlineProfileJSON(t *testing.T, endpoint string) []byte {
	t.Helper()
	payload, err := json.Marshal(testOnlineProfile(t, endpoint))
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func TestParseOnlineEmbeddingProfileRoundTrip(t *testing.T) {
	payload := validOnlineProfileJSON(t, "https://api.example.invalid/v1/embeddings")
	profile, err := ParseOnlineEmbeddingProfile(payload)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if profile.ProfileID != "stub-online-v1" || profile.Dimension != 4 || profile.ModelID != "stub-embed-v1" {
		t.Fatalf("profile = %+v", profile)
	}
	if profile.ProviderProfileDigest() == "" || profile.Fingerprint().CanonicalDigest() == "" {
		t.Fatal("fingerprint digests must be non-empty")
	}
}

func TestParseOnlineEmbeddingProfileRejectsUnsafeManifests(t *testing.T) {
	base := func(t *testing.T) map[string]any {
		t.Helper()
		var document map[string]any
		if err := json.Unmarshal(validOnlineProfileJSON(t, "https://api.example.invalid/v1/embeddings"), &document); err != nil {
			t.Fatal(err)
		}
		return document
	}
	mutations := []struct {
		name   string
		mutate func(document map[string]any)
		want   string
	}{
		{"unknown field", func(d map[string]any) { d["surprise"] = true }, "unknown field"},
		{"schema", func(d map[string]any) { d["schema"] = "restoreweave.online-embedding-profile.v2" }, "schema"},
		{"api style", func(d map[string]any) { d["api_style"] = "grpc-v1" }, "api_style"},
		{"plain http to remote host", func(d map[string]any) { d["endpoint"] = "http://api.example.invalid/v1/embeddings" }, "https"},
		{"endpoint userinfo", func(d map[string]any) { d["endpoint"] = "https://user:pass@api.example.invalid/v1/embeddings" }, "userinfo"},
		{"endpoint query", func(d map[string]any) { d["endpoint"] = "https://api.example.invalid/v1/embeddings?key=abc" }, "query"},
		{"dimension", func(d map[string]any) { d["dimension"] = 0 }, "dimension"},
		{"normalization", func(d map[string]any) { d["normalization"] = "unit" }, "normalization"},
		{"cosine without l2", func(d map[string]any) { d["normalization"] = "none" }, "cosine requires normalization l2"},
		{"element type", func(d map[string]any) { d["element_type"] = "float16" }, "element_type"},
		{"max batch", func(d map[string]any) { d["max_batch_inputs"] = 0 }, "max_batch_inputs"},
		{"timeout", func(d map[string]any) { d["timeout_ms"] = 10 }, "timeout_ms"},
		{"training use missing", func(d map[string]any) { d["training_use"] = "" }, "training_use"},
		{"instruction without field", func(d map[string]any) { d["instruction"] = "instruct: retrieve" }, "instruction_field"},
		{"instruction field without instruction", func(d map[string]any) { d["instruction_field"] = "input_type" }, "instruction_field"},
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
			_, err = ParseOnlineEmbeddingProfile(payload)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("parse error = %v, want substring %q", err, test.want)
			}
		})
	}
}

func TestOnlineProfileFingerprintBindsEverySpaceFact(t *testing.T) {
	t.Helper()
	profile := testOnlineProfile(t, "https://api.example.invalid/v1/embeddings")
	baseManifest := testOnlineManifest(t, profile)
	if baseManifest.SemanticSpace != profile.Fingerprint().SpaceID() {
		t.Fatalf("manifest space = %q, want %q", baseManifest.SemanticSpace, profile.Fingerprint().SpaceID())
	}
	if baseManifest.ProviderDigest != profile.ProviderProfileDigest() || baseManifest.Dimension != profile.Dimension {
		t.Fatalf("manifest = %+v", baseManifest)
	}
	mutations := []struct {
		name   string
		mutate func(*OnlineEmbeddingProfile)
	}{
		{"dimension", func(p *OnlineEmbeddingProfile) { p.Dimension = 8; p.ElementType = OnlineEmbeddingElementType }},
		{"model id", func(p *OnlineEmbeddingProfile) { p.ModelID = "stub-embed-v2" }},
		{"model revision", func(p *OnlineEmbeddingProfile) { p.ModelRevision = "2026-10-01" }},
		{"instruction", func(p *OnlineEmbeddingProfile) {
			p.Instruction = "instruct: retrieve"
			p.InstructionField = "instruction"
		}},
		{"query prefix", func(p *OnlineEmbeddingProfile) { p.QueryPrefix = "query: v2 " }},
		{"normalization", func(p *OnlineEmbeddingProfile) {
			p.Normalization = OnlineEmbeddingNormalizationNone
			p.Distance = OnlineEmbeddingDistanceDot
		}},
		{"provider", func(p *OnlineEmbeddingProfile) { p.Provider = "other-vendor" }},
		{"endpoint", func(p *OnlineEmbeddingProfile) { p.Endpoint = "https://other.example.invalid/v1/embeddings" }},
	}
	for _, test := range mutations {
		t.Run(test.name, func(t *testing.T) {
			mutated := profile
			test.mutate(&mutated)
			if err := mutated.Validate(); err != nil {
				t.Fatalf("mutated profile is invalid: %v", err)
			}
			mutatedManifest := testOnlineManifest(t, mutated)
			if mutatedManifest.CanonicalDigest() == baseManifest.CanonicalDigest() {
				t.Fatalf("changing %s must create a different generation manifest", test.name)
			}
			if mutated.Fingerprint().SpaceID() == profile.Fingerprint().SpaceID() &&
				test.name != "endpoint" {
				t.Fatalf("changing %s must create a different space fingerprint", test.name)
			}
			if mutated.ProviderProfileDigest() == profile.ProviderProfileDigest() {
				t.Fatalf("changing %s must create a different provider profile digest", test.name)
			}
		})
	}
}

func TestLoadOnlineEmbeddingProfileFromModelsRoot(t *testing.T) {
	modelsRoot := t.TempDir()
	profile := testOnlineProfile(t, "https://api.example.invalid/v1/embeddings")
	profile.ProfileID = "operator-online-v1"
	dir := filepath.Join(modelsRoot, OnlineEmbeddingProfileDirName, profile.ProfileID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, OnlineEmbeddingProfileFileName), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadOnlineEmbeddingProfile(modelsRoot, "operator-online-v1")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.ProfileID != profile.ProfileID || loaded.Endpoint != profile.Endpoint {
		t.Fatalf("loaded profile = %+v", loaded)
	}
	if _, err := LoadOnlineEmbeddingProfile(modelsRoot, "other-profile"); err == nil {
		t.Fatal("a missing profile must not load")
	}
	// A descriptor whose declared profile_id differs from the selected name
	// must be refused: the name is the profile's identity.
	if err := os.WriteFile(filepath.Join(dir, OnlineEmbeddingProfileFileName), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOnlineEmbeddingProfile(modelsRoot, "operator-online-v1"); err != nil {
		t.Fatalf("reload: %v", err)
	}
	aliasDir := filepath.Join(modelsRoot, OnlineEmbeddingProfileDirName, "alias-online-v1")
	if err := os.MkdirAll(aliasDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(aliasDir, OnlineEmbeddingProfileFileName), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOnlineEmbeddingProfile(modelsRoot, "alias-online-v1"); err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("profile id mismatch error = %v", err)
	}
}

func TestOnlineProfileLoopbackHTTPEndpointIsAdmitted(t *testing.T) {
	profile := testOnlineProfile(t, "http://127.0.0.1:8099/v1/embeddings")
	if err := profile.Validate(); err != nil {
		t.Fatalf("loopback http endpoint rejected: %v", err)
	}
	if host := profile.EndpointHost(); host != "127.0.0.1:8099" {
		t.Fatalf("endpoint host = %q", host)
	}
}
