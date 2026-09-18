package search

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestOnlineCredentialRefSchemeValidation(t *testing.T) {
	accepted := []string{"env://RW_KEY", "keychain://restoreweave/semantic"}
	for _, ref := range accepted {
		if _, err := OnlineCredentialRefScheme(ref); err != nil {
			t.Fatalf("reference %q rejected: %v", ref, err)
		}
	}
	rejected := []struct{ ref, want string }{
		{"", "empty"},
		{"RW_KEY", "scheme-qualified"},
		{"env://", "scheme-qualified"},
		{"vault://secret/key", "not supported"},
		{" env://RW_KEY", "whitespace"},
		{"sk-live-plaintext", "scheme-qualified"},
	}
	for _, test := range rejected {
		_, err := OnlineCredentialRefScheme(test.ref)
		if err == nil || !strings.Contains(err.Error(), test.want) {
			t.Fatalf("reference %q error = %v, want substring %q", test.ref, err, test.want)
		}
	}
}

func TestEnvOnlineCredentialResolver(t *testing.T) {
	resolver := EnvOnlineCredentialResolver{Lookup: func(name string) (string, bool) {
		if name == "RW_KEY" {
			return "resolved-secret", true
		}
		return "", false
	}}
	credential, err := resolver.Resolve(context.Background(), "env://RW_KEY")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if credential.Value() != "resolved-secret" || credential.IsZero() {
		t.Fatalf("credential = %v", credential)
	}
	if _, err := resolver.Resolve(context.Background(), "env://MISSING_KEY"); err == nil ||
		!strings.Contains(err.Error(), "MISSING_KEY") || strings.Contains(err.Error(), "resolved-secret") {
		t.Fatalf("missing variable error = %v", err)
	}
	if _, err := resolver.Resolve(context.Background(), "keychain://service/account"); err == nil {
		t.Fatal("env resolver must refuse a keychain reference")
	}
}

func TestKeychainOnlineCredentialResolver(t *testing.T) {
	secret := "keychain-secret-value"
	runner := func(_ context.Context, args ...string) ([]byte, error) {
		joined := strings.Join(args, " ")
		if !strings.Contains(joined, "find-generic-password") || !strings.Contains(joined, "-s restoreweave") ||
			!strings.Contains(joined, "-a semantic") {
			return nil, errors.New("unexpected keychain query")
		}
		return []byte(secret + "\n"), nil
	}
	resolver := KeychainOnlineCredentialResolver{GOOS: "darwin", Run: runner}
	credential, err := resolver.Resolve(context.Background(), "keychain://restoreweave/semantic")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if credential.Value() != secret {
		t.Fatal("keychain secret did not resolve")
	}
	// A failing keychain command must not surface its output, which could
	// contain keychain material.
	failing := KeychainOnlineCredentialResolver{GOOS: "darwin", Run: func(context.Context, ...string) ([]byte, error) {
		return []byte(secret), errors.New("security: exit 44")
	}}
	if _, err := failing.Resolve(context.Background(), "keychain://restoreweave/semantic"); err == nil ||
		strings.Contains(err.Error(), secret) {
		t.Fatalf("keychain failure error = %v", err)
	}
	// Other platforms fail closed.
	other := KeychainOnlineCredentialResolver{GOOS: "linux", Run: runner}
	if _, err := other.Resolve(context.Background(), "keychain://restoreweave/semantic"); err == nil ||
		!strings.Contains(err.Error(), "not available") {
		t.Fatalf("non-darwin keychain error = %v", err)
	}
	// A malformed keychain reference is refused before any lookup.
	if _, err := resolver.Resolve(context.Background(), "keychain://only-service"); err == nil ||
		!strings.Contains(err.Error(), "service/account") {
		t.Fatalf("malformed keychain reference error = %v", err)
	}
}

func TestDefaultOnlineCredentialResolverDispatchesAndRedacts(t *testing.T) {
	resolver := DefaultOnlineCredentialResolver()
	if _, err := resolver.Resolve(context.Background(), "env://RESTOREWEAVE_TEST_ABSENT_KEY"); err == nil {
		t.Fatal("absent environment variable must not resolve")
	}
	if _, err := resolver.Resolve(context.Background(), "https://api.example.invalid"); err == nil {
		t.Fatal("unsupported scheme must not resolve")
	}
	if got := RedactedOnlineCredentialRef("keychain://restoreweave/semantic"); got != "keychain://restoreweave/semantic" {
		t.Fatalf("redacted reference = %q", got)
	}
	if got := RedactedOnlineCredentialRef("plain-secret-value"); got != "[unresolved-credential-reference]" {
		t.Fatalf("redacted bare reference = %q", got)
	}
	if got := RedactedOnlineCredentialRef(""); got != "" {
		t.Fatalf("redacted empty reference = %q", got)
	}
}
