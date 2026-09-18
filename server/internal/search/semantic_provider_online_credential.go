package search

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// Online credential resolution
//
// `semantic.online_credential_ref` is a reference into a host secret store.
// The persisted configuration and every diagnostic view contain only the
// reference; the plaintext secret exists only between resolution and the one
// HTTP request that uses it. Resolvers return OnlineCredential, whose String
// and GoString forms are redacted so an accidental %v can never print it.
//
// Unknown or unavailable references fail closed with a typed reason. There is
// no fallback that would send content with a missing or substituted
// credential.

const (
	// OnlineCredentialSchemeEnv resolves "env://NAME" or "env:NAME" from the
	// daemon's environment.
	OnlineCredentialSchemeEnv = "env"
	// OnlineCredentialSchemeKeychain resolves "keychain://service/account"
	// from the platform keychain (darwin only; other platforms fail closed).
	OnlineCredentialSchemeKeychain = "keychain"
)

// ErrOnlineCredentialUnavailable identifies a credential reference that could
// not be resolved. Its message never contains secret material.
var ErrOnlineCredentialUnavailable = errors.New("online credential unavailable")

// OnlineCredential is a short-lived plaintext credential. Callers must pass
// it directly to the one permitted egress and must never copy it into logs,
// audit records, error messages, or configuration.
type OnlineCredential struct {
	value string
}

// NewOnlineCredential wraps plaintext for the provider call path.
func NewOnlineCredential(value string) OnlineCredential {
	return OnlineCredential{value: value}
}

// Value returns the plaintext secret. It is deliberately the only accessor.
func (c OnlineCredential) Value() string { return c.value }

// IsZero reports whether no credential was resolved.
func (c OnlineCredential) IsZero() bool { return c.value == "" }

// String is redacted so %v, %s, and error wrapping cannot disclose the
// secret.
func (c OnlineCredential) String() string { return "[redacted]" }

// GoString is redacted for %#v.
func (c OnlineCredential) GoString() string { return "[redacted]" }

// OnlineCredentialResolver resolves one host secret reference. Implementations
// must not log, cache to disk, or return the secret in an error message.
type OnlineCredentialResolver interface {
	Resolve(ctx context.Context, ref string) (OnlineCredential, error)
}

// OnlineCredentialRefScheme returns the scheme of a credential reference.
// References must be opaque, scheme-qualified host references; a bare name is
// refused so an operator cannot accidentally paste a secret-shaped value that
// the config surface would then treat as a location.
func OnlineCredentialRefScheme(ref string) (string, error) {
	scheme, _, err := onlineCredentialRefParts(ref)
	return scheme, err
}

func onlineCredentialRefParts(ref string) (scheme, target string, err error) {
	trimmed := strings.TrimSpace(ref)
	if trimmed == "" {
		return "", "", fmt.Errorf("%w: credential reference is empty", ErrOnlineCredentialUnavailable)
	}
	if trimmed != ref {
		return "", "", fmt.Errorf("%w: credential reference must not contain leading or trailing whitespace", ErrOnlineCredentialUnavailable)
	}
	var found bool
	scheme, target, found = strings.Cut(trimmed, "://")
	if !found || scheme == "" || strings.TrimSpace(target) == "" {
		return "", "", fmt.Errorf("%w: credential reference must be a scheme-qualified reference such as env://NAME or keychain://service/account", ErrOnlineCredentialUnavailable)
	}
	switch scheme {
	case OnlineCredentialSchemeEnv, OnlineCredentialSchemeKeychain:
		return scheme, target, nil
	default:
		return "", "", fmt.Errorf("%w: credential reference scheme %q is not supported", ErrOnlineCredentialUnavailable, scheme)
	}
}

// EnvOnlineCredentialResolver resolves env://NAME references from an explicit
// lookup function, so tests never depend on the process environment.
type EnvOnlineCredentialResolver struct {
	Lookup func(name string) (string, bool)
}

// NewEnvOnlineCredentialResolver returns the process-environment resolver.
func NewEnvOnlineCredentialResolver() EnvOnlineCredentialResolver {
	return EnvOnlineCredentialResolver{Lookup: os.LookupEnv}
}

// Resolve implements OnlineCredentialResolver.
func (r EnvOnlineCredentialResolver) Resolve(_ context.Context, ref string) (OnlineCredential, error) {
	scheme, name, err := onlineCredentialRefParts(ref)
	if err != nil {
		return OnlineCredential{}, err
	}
	if scheme != OnlineCredentialSchemeEnv {
		return OnlineCredential{}, fmt.Errorf("%w: credential reference scheme %q is not env", ErrOnlineCredentialUnavailable, scheme)
	}
	lookup := r.Lookup
	if lookup == nil {
		lookup = os.LookupEnv
	}
	value, ok := lookup(name)
	if !ok || strings.TrimSpace(value) == "" {
		// The variable name is a location, not a secret, and is safe to name.
		return OnlineCredential{}, fmt.Errorf("%w: environment variable %q is not set for the selected online provider", ErrOnlineCredentialUnavailable, name)
	}
	return NewOnlineCredential(value), nil
}

// KeychainOnlineCredentialResolver resolves keychain://service/account
// references. Run is injectable so tests never touch the real keychain.
type KeychainOnlineCredentialResolver struct {
	// GOOS selects the platform behavior; empty means runtime.GOOS.
	GOOS string
	// Run executes the platform command and returns its stdout. It must not
	// log the argument list.
	Run func(ctx context.Context, args ...string) ([]byte, error)
}

// Resolve implements OnlineCredentialResolver.
func (r KeychainOnlineCredentialResolver) Resolve(ctx context.Context, ref string) (OnlineCredential, error) {
	scheme, target, err := onlineCredentialRefParts(ref)
	if err != nil {
		return OnlineCredential{}, err
	}
	if scheme != OnlineCredentialSchemeKeychain {
		return OnlineCredential{}, fmt.Errorf("%w: credential reference scheme %q is not keychain", ErrOnlineCredentialUnavailable, scheme)
	}
	service, account, found := strings.Cut(target, "/")
	if !found || strings.TrimSpace(service) == "" || strings.TrimSpace(account) == "" {
		return OnlineCredential{}, fmt.Errorf("%w: keychain reference must be keychain://service/account", ErrOnlineCredentialUnavailable)
	}
	goos := strings.TrimSpace(r.GOOS)
	if goos == "" {
		goos = runtime.GOOS
	}
	if goos != "darwin" {
		return OnlineCredential{}, fmt.Errorf("%w: keychain credential references are not available on this platform", ErrOnlineCredentialUnavailable)
	}
	run := r.Run
	if run == nil {
		const securityPath = "/usr/bin/security"
		run = func(ctx context.Context, args ...string) ([]byte, error) {
			if _, statErr := os.Stat(securityPath); statErr != nil {
				return nil, fmt.Errorf("%w: platform keychain tool is unavailable", ErrOnlineCredentialUnavailable)
			}
			output, err := exec.CommandContext(ctx, securityPath, args...).Output()
			if err != nil {
				// Never surface command output: it could echo keychain data.
				return nil, fmt.Errorf("%w: keychain lookup failed", ErrOnlineCredentialUnavailable)
			}
			return output, nil
		}
	}
	output, err := run(ctx, "find-generic-password", "-s", service, "-a", account, "-w")
	if err != nil {
		if errors.Is(err, ErrOnlineCredentialUnavailable) {
			return OnlineCredential{}, err
		}
		return OnlineCredential{}, fmt.Errorf("%w: keychain lookup failed", ErrOnlineCredentialUnavailable)
	}
	value := strings.TrimRight(string(output), "\r\n")
	if strings.TrimSpace(value) == "" {
		return OnlineCredential{}, fmt.Errorf("%w: keychain item %q is empty", ErrOnlineCredentialUnavailable, service)
	}
	return NewOnlineCredential(value), nil
}

// DefaultOnlineCredentialResolver dispatches by reference scheme. Unsupported
// schemes fail closed.
func DefaultOnlineCredentialResolver() OnlineCredentialResolver {
	return schemeOnlineCredentialResolver{
		env:      NewEnvOnlineCredentialResolver(),
		keychain: KeychainOnlineCredentialResolver{},
	}
}

type schemeOnlineCredentialResolver struct {
	env      EnvOnlineCredentialResolver
	keychain KeychainOnlineCredentialResolver
}

func (r schemeOnlineCredentialResolver) Resolve(ctx context.Context, ref string) (OnlineCredential, error) {
	scheme, _, err := onlineCredentialRefParts(ref)
	if err != nil {
		return OnlineCredential{}, err
	}
	switch scheme {
	case OnlineCredentialSchemeEnv:
		return r.env.Resolve(ctx, ref)
	case OnlineCredentialSchemeKeychain:
		return r.keychain.Resolve(ctx, ref)
	default:
		return OnlineCredential{}, fmt.Errorf("%w: credential reference scheme %q is not supported", ErrOnlineCredentialUnavailable, scheme)
	}
}

// RedactedOnlineCredentialRef is the only form safe for diagnostics: the
// scheme and location name stay visible (they are locations, not secrets).
func RedactedOnlineCredentialRef(ref string) string {
	trimmed := strings.TrimSpace(ref)
	if trimmed == "" {
		return ""
	}
	scheme, rest, found := strings.Cut(trimmed, "://")
	if !found || scheme == "" || strings.TrimSpace(rest) == "" {
		return "[unresolved-credential-reference]"
	}
	return scheme + "://" + rest
}
