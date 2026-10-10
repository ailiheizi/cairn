package search

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeOnlineProfileDocument(t *testing.T, dir string, profile OnlineEmbeddingProfile) string {
	t.Helper()
	payload, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "profile.json")
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestInstallOnlineEmbeddingProfileAdmitsAndIsIdempotent(t *testing.T) {
	modelsRoot := filepath.Join(t.TempDir(), "models")
	sourceDir := t.TempDir()
	profile := testOnlineProfile(t, "https://api.example.invalid/v1/embeddings")
	profile.ProfileID = "operator-online-v1"
	source := writeOnlineProfileDocument(t, sourceDir, profile)

	receipt, err := InstallOnlineEmbeddingProfile(context.Background(), modelsRoot, source, profile.ProviderProfileDigest())
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	if !receipt.Changed || receipt.AlreadyInstalled {
		t.Fatalf("receipt = %+v, want a changed install", receipt)
	}
	expected, err := OnlineEmbeddingProfilePath(modelsRoot, profile.ProfileID)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Destination != expected {
		t.Fatalf("destination = %q, want %q", receipt.Destination, expected)
	}
	installed, err := LoadOnlineEmbeddingProfile(modelsRoot, profile.ProfileID)
	if err != nil {
		t.Fatalf("load installed: %v", err)
	}
	if installed.ProviderProfileDigest() != profile.ProviderProfileDigest() {
		t.Fatal("the installed digest must match the admitted document")
	}

	// Reinstalling the identical document is a no-op.
	again, err := InstallOnlineEmbeddingProfile(context.Background(), modelsRoot, source, profile.ProviderProfileDigest())
	if err != nil {
		t.Fatalf("reinstall: %v", err)
	}
	if again.Changed || !again.AlreadyInstalled {
		t.Fatalf("reinstall receipt = %+v, want an unchanged already-installed result", again)
	}

	// Listing reports the daemon's own facts.
	installedProfiles, err := ListOnlineEmbeddingProfiles(modelsRoot)
	if err != nil {
		t.Fatal(err)
	}
	if len(installedProfiles) != 1 {
		t.Fatalf("installed profiles = %+v", installedProfiles)
	}
	if installedProfiles[0].Profile.ProfileID != profile.ProfileID || installedProfiles[0].Expired {
		t.Fatalf("listed profile = %+v", installedProfiles[0])
	}
}

func TestInstallOnlineEmbeddingProfileReplacesWithoutDeleting(t *testing.T) {
	modelsRoot := filepath.Join(t.TempDir(), "models")
	sourceDir := t.TempDir()
	profile := testOnlineProfile(t, "https://api.example.invalid/v1/embeddings")
	profile.ProfileID = "operator-online-v1"
	firstSource := writeOnlineProfileDocument(t, sourceDir, profile)
	if _, err := InstallOnlineEmbeddingProfile(context.Background(), modelsRoot, firstSource, profile.ProviderProfileDigest()); err != nil {
		t.Fatal(err)
	}

	// A different document under the same profile id is published, and the
	// previous tree is moved aside, never deleted.
	replacement := profile
	replacement.ModelRevision = "2026-10-01"
	replacementSource := writeOnlineProfileDocument(t, t.TempDir(), replacement)
	receipt, err := InstallOnlineEmbeddingProfile(context.Background(), modelsRoot, replacementSource, replacement.ProviderProfileDigest())
	if err != nil {
		t.Fatalf("replace: %v", err)
	}
	if !receipt.Changed || receipt.AlreadyInstalled {
		t.Fatalf("replace receipt = %+v", receipt)
	}
	loaded, err := LoadOnlineEmbeddingProfile(modelsRoot, profile.ProfileID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ProviderProfileDigest() != replacement.ProviderProfileDigest() {
		t.Fatal("the replacement must be the installed profile")
	}
	profileDir := filepath.Join(modelsRoot, OnlineEmbeddingProfileDirName, profile.ProfileID)
	entries, err := os.ReadDir(filepath.Join(modelsRoot, OnlineEmbeddingProfileDirName))
	if err != nil {
		t.Fatal(err)
	}
	movedAside := false
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), profile.ProfileID+".replaced-") {
			movedAside = true
		}
	}
	if !movedAside {
		t.Fatalf("the replaced profile must remain on disk as a moved-aside tree: %+v", entries)
	}
	if _, err := os.Stat(filepath.Join(profileDir, OnlineEmbeddingProfileFileName)); err != nil {
		t.Fatalf("the replacement profile file is missing: %v", err)
	}
}

func TestInstallOnlineEmbeddingProfileRefusesUnsafeSources(t *testing.T) {
	modelsRoot := filepath.Join(t.TempDir(), "models")
	profile := testOnlineProfile(t, "https://api.example.invalid/v1/embeddings")
	profile.ProfileID = "operator-online-v1"
	validSource := writeOnlineProfileDocument(t, t.TempDir(), profile)

	invalidProfile := profile
	invalidProfile.Egress.DestinationHost = "elsewhere.invalid"
	invalidSource := writeOnlineProfileDocument(t, t.TempDir(), invalidProfile)
	invalidJSON := filepath.Join(t.TempDir(), "profile.json")
	if err := os.WriteFile(invalidJSON, []byte(`{"schema":"cairn.online-embedding-profile.v1","surprise":true}`), 0o600); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name   string
		source string
		digest string
		want   string
	}{
		{"relative path", "profile.json", profile.ProviderProfileDigest(), "absolute and canonical"},
		{"empty path", "", profile.ProviderProfileDigest(), "absolute and canonical"},
		{"missing declared digest", validSource, "", "declared profile digest is required"},
		{"mismatched declared digest", validSource, "sha256:" + strings.Repeat("0", 64), "does not match"},
		{"invalid profile document", invalidSource, "", "must equal the endpoint host"},
		{"unknown descriptor field", invalidJSON, "", "unknown field"},
		{"missing source file", filepath.Join(t.TempDir(), "absent.json"), "sha256:x", "open profile source"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := InstallOnlineEmbeddingProfile(context.Background(), modelsRoot, test.source, test.digest)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("install error = %v, want substring %q", err, test.want)
			}
			if _, statErr := os.Stat(filepath.Join(modelsRoot, OnlineEmbeddingProfileDirName, profile.ProfileID)); statErr == nil {
				t.Fatal("a refused install must not publish a profile")
			}
		})
	}
}

func TestListOnlineEmbeddingProfilesIsHonestAboutEmptyAndCorruptRoots(t *testing.T) {
	modelsRoot := filepath.Join(t.TempDir(), "models")
	profiles, err := ListOnlineEmbeddingProfiles(modelsRoot)
	if err != nil {
		t.Fatalf("missing online-embedding directory must be an empty list: %v", err)
	}
	if len(profiles) != 0 {
		t.Fatalf("profiles = %+v", profiles)
	}
	profileDir := filepath.Join(modelsRoot, OnlineEmbeddingProfileDirName, "broken")
	if err := os.MkdirAll(profileDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(profileDir, OnlineEmbeddingProfileFileName), []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ListOnlineEmbeddingProfiles(modelsRoot); err == nil {
		t.Fatal("a malformed installed profile must be an explicit error, never silently skipped")
	}
	if _, err := ListOnlineEmbeddingProfiles("relative/models"); err == nil {
		t.Fatal("a relative models root must be refused")
	}
}

// TestInstalledProfileExpiryIsReportedHonestly proves listing reports an
// expired profile as expired; the profile document itself cannot be admitted
// with a past expiry, so this is proven at the scope level.
func TestInstalledProfileExpiryIsReportedHonestly(t *testing.T) {
	profile := testOnlineProfile(t, "https://api.example.invalid/v1/embeddings")
	if profile.Egress.Expired(time.Now().UTC()) {
		t.Fatal("the test profile must be unexpired")
	}
	expired := profile
	expired.Egress.Expiry = time.Now().UTC().Add(-time.Second).Format(time.RFC3339)
	if !expired.Egress.Expired(time.Now().UTC()) {
		t.Fatal("a past expiry must report expired")
	}
	if err := expired.Validate(); err == nil || !strings.Contains(err.Error(), "not in the future") {
		t.Fatalf("expired profile validation error = %v", err)
	}
}
