package search

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeDescribeProfileForListTest(t *testing.T, root string, profile OnlineDescribeProfile, raw []byte) {
	t.Helper()
	dir := filepath.Join(root, OnlineDescribeProfileDirName, profile.ProfileID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if raw == nil {
		var err error
		raw, err = json.Marshal(profile)
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, OnlineDescribeProfileFileName), raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestListOnlineDescribeProfilesMissingDirectoryIsAvailableEmpty(t *testing.T) {
	root := filepath.Join(t.TempDir(), "models")
	profiles, err := ListOnlineDescribeProfiles(root)
	if err != nil {
		t.Fatalf("list absent describe directory: %v", err)
	}
	if profiles == nil || len(profiles) != 0 {
		t.Fatalf("profiles = %#v, want a non-nil empty list", profiles)
	}
}

func TestListOnlineDescribeProfilesReturnsValidatedSortedMetadata(t *testing.T) {
	root := t.TempDir()
	first := testDescribeProfile(t, "https://api.example.invalid/v1/chat/completions")
	first.ProfileID = "zeta-describe"
	second := first
	second.ProfileID = "alpha-describe"
	writeDescribeProfileForListTest(t, root, first, nil)
	writeDescribeProfileForListTest(t, root, second, nil)

	profiles, err := ListOnlineDescribeProfiles(root)
	if err != nil {
		t.Fatalf("list profiles: %v", err)
	}
	if len(profiles) != 2 || profiles[0].Profile.ProfileID != "alpha-describe" || profiles[1].Profile.ProfileID != "zeta-describe" {
		t.Fatalf("profiles = %+v, want stable profile-id order", profiles)
	}
	got := profiles[0]
	if got.Profile.ProviderProfileDigest() != second.ProviderProfileDigest() || got.Destination != filepath.Join(root, OnlineDescribeProfileDirName, second.ProfileID, OnlineDescribeProfileFileName) || got.Expired {
		t.Fatalf("listed profile = %+v", got)
	}
}

func TestListOnlineDescribeProfilesFailsClosedForMalformedExpiredAndUnsafeEntries(t *testing.T) {
	t.Run("malformed", func(t *testing.T) {
		root := t.TempDir()
		profile := testDescribeProfile(t, "https://api.example.invalid/v1/chat/completions")
		writeDescribeProfileForListTest(t, root, profile, []byte(`{"schema":"unknown"}`))
		if _, err := ListOnlineDescribeProfiles(root); err == nil {
			t.Fatal("malformed profile must make the listing unavailable")
		}
	})
	t.Run("expired", func(t *testing.T) {
		root := t.TempDir()
		profile := testDescribeProfile(t, "https://api.example.invalid/v1/chat/completions")
		profile.Egress.Expiry = time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
		writeDescribeProfileForListTest(t, root, profile, nil)
		if _, err := ListOnlineDescribeProfiles(root); err == nil {
			t.Fatal("expired profile must not be listed as grantable")
		}
	})
	t.Run("unexpected entry", func(t *testing.T) {
		root := t.TempDir()
		base := filepath.Join(root, OnlineDescribeProfileDirName)
		if err := os.MkdirAll(base, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(base, "not-a-profile"), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := ListOnlineDescribeProfiles(root); err == nil {
			t.Fatal("unexpected non-directory entry must make the listing unavailable")
		}
	})
}
