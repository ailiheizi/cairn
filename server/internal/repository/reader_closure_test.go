package repository

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// admittedReporterDrivers returns one fresh driver per codec this build can
// open, so the declaration table is checked against the drivers that actually
// exist rather than against a copy of the table.
func admittedReporterDrivers(t *testing.T) map[string]Driver {
	t.Helper()
	root := t.TempDir()
	dir, err := OpenDir(filepath.Join(root, "cas"))
	if err != nil {
		t.Fatal(err)
	}
	zstd, err := OpenZstdDir(filepath.Join(root, "zstd"))
	if err != nil {
		t.Fatal(err)
	}
	key := []byte("0123456789abcdef0123456789abcdef")
	encrypted, err := OpenEncryptedZstdDir(filepath.Join(root, "encrypted"), "env:RW_TEST_KEY", KeyProviderFunc(func(context.Context, string) ([]byte, error) {
		return key, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	return map[string]Driver{"directory-cas": dir, "local-zstd": zstd, "local-zstd-encrypted": encrypted}
}

// TestEveryAdmittedDriverReaderDependencyIsDeclared closes the loop between the
// capability profile a driver reports and the reader-closure declaration
// table: a dependency name that no declaration covers would leave a reader
// unable to say how the decoder stays obtainable.
func TestEveryAdmittedDriverReaderDependencyIsDeclared(t *testing.T) {
	drivers := admittedReporterDrivers(t)
	drivers["memory-test"] = &Memory{}
	for name, driver := range drivers {
		reporter, ok := driver.(CapabilityReporter)
		if !ok {
			t.Fatalf("driver %s does not report capabilities", name)
		}
		profile := reporter.DescribeCapabilities()
		for _, dependency := range profile.ReaderDependencies {
			if _, declared := ReaderClosureDeclarationFor(dependency); !declared {
				t.Fatalf("driver %s requires undeclared reader dependency %q", name, dependency)
			}
		}
		closure, err := ReaderClosureForRepository(driver)
		if err != nil {
			t.Fatalf("driver %s reader closure: %v", name, err)
		}
		if closure.Schema != ReaderClosureSchemaV1 || closure.Codec != profile.RepositoryFormat {
			t.Fatalf("driver %s closure = %+v, want codec %q", name, closure, profile.RepositoryFormat)
		}
		for _, dependency := range profile.ReaderDependencies {
			if !containsString(closure.Dependencies, dependency) {
				t.Fatalf("driver %s closure omits required dependency %q: %v", name, dependency, closure.Dependencies)
			}
		}
	}
}

// TestAdmittedCodecClosuresAreReadableExceptTheTestDriver proves the two
// durable profiles resolve a decoder while the process-local test driver and
// the experimental encrypted profile report their real state: the test driver
// has no retained decoder at all, and the encrypted profile stays readable
// only through the operator-held key.
func TestAdmittedCodecClosuresAreReadableExceptTheTestDriver(t *testing.T) {
	drivers := admittedReporterDrivers(t)
	for _, name := range []string{"directory-cas", "local-zstd"} {
		closure, err := ReaderClosureForRepository(drivers[name])
		if err != nil {
			t.Fatal(err)
		}
		if !closure.Readable {
			t.Fatalf("%s closure is not readable: %s", name, closure.Reason)
		}
	}
	encrypted, err := ReaderClosureForRepository(drivers["local-zstd-encrypted"])
	if err != nil {
		t.Fatal(err)
	}
	if encrypted.Admission != ReaderCodecExperimental {
		t.Fatalf("encrypted admission = %q, want %q", encrypted.Admission, ReaderCodecExperimental)
	}
	if !containsString(encrypted.Dependencies, ReaderDependencyHostKeyProviderV1) {
		t.Fatalf("encrypted closure omits the host key dependency: %v", encrypted.Dependencies)
	}
	memory, err := ReaderClosureForRepository(&Memory{})
	if err != nil {
		t.Fatal(err)
	}
	if memory.Readable || memory.Admission != ReaderCodecTestOnly || memory.Reason == "" {
		t.Fatalf("test driver closure = %+v, want unreadable with a reason", memory)
	}
}

// TestReaderClosureDeclarationsCoverSignedRecordTuple proves every name the
// signed portable-fact reader tuple uses has a declaration, in both schema
// generations, so an old record's reader requirement is answered by the same
// table as a current one.
func TestReaderClosureDeclarationsCoverSignedRecordTuple(t *testing.T) {
	declared := map[string]bool{}
	for _, declaration := range ReaderClosureDeclarations() {
		if declaration.Dependency == "" || declaration.Schema != ReaderClosureSchemaV1 {
			t.Fatalf("invalid declaration: %+v", declaration)
		}
		if declaration.Role == "" {
			t.Fatalf("declaration %q has no role", declaration.Dependency)
		}
		if declaration.DecoderSupportWindow == "" {
			t.Fatalf("declaration %q states no decoder support window", declaration.Dependency)
		}
		if _, err := declaration.ReaderClosureDigest(); err != nil {
			t.Fatalf("declaration %q digest: %v", declaration.Dependency, err)
		}
		declared[declaration.Dependency] = true
	}
	want := []string{
		"repository:directory-cas-dev-v1/identity-v1",
		"repository:local-zstd-v1/zstd-v1",
		"repository:local-zstd-encrypted-v1/zstd-v1",
		ReaderDependencyCanonicalizationCompactJSON,
		ReaderDependencySignatureEd25519V1,
		ReaderDependencyPortableFactReaderV1,
		ReaderDependencyPortableFactReaderV2,
		ReaderDependencyHostKeyProviderV1,
		zstdDependency,
	}
	for _, dependency := range want {
		if !declared[dependency] {
			t.Fatalf("signed record dependency %q has no reader-closure declaration", dependency)
		}
	}
}

// TestReaderClosurePinnedModuleDigestMatchesCheckoutGoSum keeps the recorded
// decoder bytes honest: the digest published in the declaration must be the
// checksum this checkout pins, and the dependency name a capability profile
// reports must be the same string.
func TestReaderClosurePinnedModuleDigestMatchesCheckoutGoSum(t *testing.T) {
	payload, err := os.ReadFile(filepath.Join("..", "..", "..", "go.sum"))
	if err != nil {
		t.Fatalf("read checkout go.sum: %v", err)
	}
	prefix := zstdModulePath + " " + zstdModuleVersion + " "
	found := ""
	for _, line := range strings.Split(string(payload), "\n") {
		if strings.HasPrefix(line, prefix) && strings.HasSuffix(strings.TrimSpace(line), zstdModuleDigest) {
			found = strings.TrimSpace(line)
		}
	}
	if found == "" {
		t.Fatalf("go.sum has no %s line with digest %s", prefix, zstdModuleDigest)
	}
	declaration, ok := ReaderClosureDeclarationFor(zstdDependency)
	if !ok {
		t.Fatalf("pinned dependency %q is not declared", zstdDependency)
	}
	if declaration.PinnedModuleVersion != zstdModuleVersion || declaration.PinnedModulePath != zstdModulePath {
		t.Fatalf("declaration pins %s@%s, want %s@%s", declaration.PinnedModulePath, declaration.PinnedModuleVersion, zstdModulePath, zstdModuleVersion)
	}
	pinned := false
	for _, artifact := range declaration.Artifacts {
		if artifact.Kind == ReaderArtifactPinnedModule && artifact.Digest == zstdModuleDigest && artifact.DigestKind == ReaderDigestModuleH1 {
			pinned = true
		}
	}
	if !pinned {
		t.Fatalf("declaration does not retain the pinned module digest: %+v", declaration.Artifacts)
	}
	zstd, err := OpenZstdDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if !containsString(zstd.DescribeCapabilities().ReaderDependencies, zstdDependency) {
		t.Fatal("zstd capability profile does not report the pinned dependency name")
	}
	module, err := os.ReadFile(filepath.Join("..", "..", "..", "go.mod"))
	if err != nil {
		t.Fatalf("read checkout go.mod: %v", err)
	}
	requirement := ""
	for _, line := range strings.Split(string(module), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), zstdModulePath+" ") {
			requirement = strings.TrimSpace(line)
		}
	}
	if requirement != zstdModulePath+" "+zstdModuleVersion {
		t.Fatalf("checkout requires %q, but the retained decoder declaration pins %s@%s", requirement, zstdModulePath, zstdModuleVersion)
	}
}

func TestSourceSetDigestIsOrderIndependentAndMutationSensitive(t *testing.T) {
	root := t.TempDir()
	refs := []string{"a/one.go", "b/two.go"}
	for _, ref := range refs {
		path := filepath.Join(root, filepath.FromSlash(ref))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("package x\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	first, err := sourceSetDigestAt(root, refs...)
	if err != nil {
		t.Fatal(err)
	}
	reordered, err := sourceSetDigestAt(root, refs[1], refs[0])
	if err != nil {
		t.Fatal(err)
	}
	if first != reordered {
		t.Fatalf("source set digest depends on argument order: %s != %s", first, reordered)
	}
	if err := os.WriteFile(filepath.Join(root, "b", "two.go"), []byte("package x // changed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	changed, err := sourceSetDigestAt(root, refs...)
	if err != nil {
		t.Fatal(err)
	}
	if changed == first {
		t.Fatal("source set digest ignored a changed retained file")
	}
	if _, err := sourceSetDigestAt(root, "missing.go"); err == nil {
		t.Fatal("missing retained source produced a digest")
	}
}

// TestObservedAttemptsStayUnavailableWithReasons proves the observations this
// build makes about itself are reported rather than assumed: every declared
// artifact yields one attempt, and an available attempt always carries a
// digest except for the operator-held key, which this process can never verify.
func TestObservedAttemptsStayUnavailableWithReasons(t *testing.T) {
	for _, declaration := range ReaderClosureDeclarations() {
		attempts := ObservedReaderDecoderAttempts(declaration)
		if len(attempts) != len(declaration.Artifacts) {
			t.Fatalf("declaration %q observed %d attempts for %d artifacts", declaration.Dependency, len(attempts), len(declaration.Artifacts))
		}
		for i, attempt := range attempts {
			if attempt.Stage != declaration.Artifacts[i].Stage {
				t.Fatalf("declaration %q attempt order changed: %+v", declaration.Dependency, attempts)
			}
			if attempt.Available && attempt.Digest == "" && declaration.Artifacts[i].Kind != ReaderArtifactOperatorKey {
				t.Fatalf("declaration %q claims available %s with no digest", declaration.Dependency, attempt.Stage)
			}
			if !attempt.Available && strings.TrimSpace(attempt.Reason) == "" {
				t.Fatalf("declaration %q reports unavailable %s without a reason", declaration.Dependency, attempt.Stage)
			}
			if declaration.Artifacts[i].Kind == ReaderArtifactOperatorKey && attempt.Available {
				t.Fatalf("declaration %q claims the host-held key is available", declaration.Dependency)
			}
		}
	}
}

func TestReaderClosureForProfileRejectsUndeclaredProfile(t *testing.T) {
	if _, err := ReaderClosureForProfile("not-a-profile"); err == nil {
		t.Fatal("undeclared repository profile produced a reader closure")
	}
}

// TestResolveReaderDecoderAppliesFrozenFallbackOrder exercises the documented
// order: in-process decoder with the declared digest first, retained pinned
// decoder second, typed refusal third.
func TestResolveReaderDecoderAppliesFrozenFallbackOrder(t *testing.T) {
	declaration := ReaderClosureDeclaration{
		Schema: ReaderClosureSchemaV1, Dependency: "test:codec-v1", Role: ReaderRoleCompressionCodec,
		Retention: ReaderRetentionRetainedReproducible,
		Artifacts: []ReaderRetainedArtifact{
			{Stage: ReaderDecoderStageNativeInProcess, Kind: ReaderArtifactInTreeSource, Ref: "native", Digest: "sha256:native", DigestKind: ReaderDigestSourceSet, Available: true},
			{Stage: ReaderDecoderStageRetainedPinned, Kind: ReaderArtifactPinnedModule, Ref: "module@v1", Digest: "h1:pinned", DigestKind: ReaderDigestModuleH1, Available: true},
		},
	}
	native := ReaderDecoderAttempt{Stage: ReaderDecoderStageNativeInProcess, ID: "native", Digest: "sha256:native", Available: true}
	pinned := ReaderDecoderAttempt{Stage: ReaderDecoderStageRetainedPinned, ID: "module@v1", Digest: "h1:pinned", Available: true}

	selected, err := ResolveReaderDecoder(declaration, []ReaderDecoderAttempt{native, pinned})
	if err != nil {
		t.Fatalf("native digest match refused: %v", err)
	}
	if selected.Stage != ReaderDecoderStageNativeInProcess || selected.DecoderID != "native" {
		t.Fatalf("selection = %+v, want the in-process stage", selected)
	}

	mismatched := native
	mismatched.Digest = "sha256:modified"
	selected, err = ResolveReaderDecoder(declaration, []ReaderDecoderAttempt{mismatched, pinned})
	if err != nil {
		t.Fatalf("retained fallback refused: %v", err)
	}
	if selected.Stage != ReaderDecoderStageRetainedPinned || selected.Outcomes[0].Outcome != ReaderAttemptDigestMismatch {
		t.Fatalf("selection = %+v, want the retained stage after a native digest mismatch", selected)
	}

	unavailable := pinned
	unavailable.Available = false
	unavailable.Reason = "module bytes are absent"
	selected, err = ResolveReaderDecoder(declaration, []ReaderDecoderAttempt{mismatched, unavailable})
	if err == nil || !errors.Is(err, ErrReaderDecoderUnavailable) {
		t.Fatalf("unavailable retained decoder error = %v, want a typed refusal", err)
	}
	var refusal *ReaderDecoderRefusal
	if !errors.As(err, &refusal) {
		t.Fatalf("refusal is not typed: %v", err)
	}
	if refusal.Reason != ReaderRefusalNativeDigestMismatch || refusal.Dependency != "test:codec-v1" || refusal.CallerAction == "" {
		t.Fatalf("refusal = %+v, want a native digest mismatch that names the caller action", refusal)
	}
	if selected.Refusal == nil || selected.Stage != "" {
		t.Fatalf("refused selection = %+v, want no selected stage", selected)
	}
}

func TestResolveReaderDecoderRefusesEachTypedCase(t *testing.T) {
	cases := []struct {
		name        string
		declaration ReaderClosureDeclaration
		attempts    []ReaderDecoderAttempt
		wantReason  string
		wantOutcome string
	}{
		{
			name: "no retained decoder",
			declaration: ReaderClosureDeclaration{
				Dependency: "restoreweave.memory-test", Role: ReaderRoleRepositoryDriver, Retention: ReaderRetentionUnavailable,
			},
			wantReason:  ReaderRefusalNotRetained,
			wantOutcome: ReaderAttemptNotRetained,
		},
		{
			name: "retained decoder never offered",
			declaration: ReaderClosureDeclaration{
				Dependency: "restoreweave.repository.local-zstd-v1", Role: ReaderRoleCompressionCodec, Retention: ReaderRetentionRetainedReproducible,
				Artifacts: []ReaderRetainedArtifact{{Stage: ReaderDecoderStageRetainedPinned, Kind: ReaderArtifactPinnedModule, Ref: "module@v1", Digest: "h1:pinned"}},
			},
			wantReason:  ReaderRefusalRetainedUnavailable,
			wantOutcome: ReaderAttemptNotAttempted,
		},
		{
			name: "retained decoder digest mismatch",
			declaration: ReaderClosureDeclaration{
				Dependency: "restoreweave.repository.local-zstd-v1", Role: ReaderRoleCompressionCodec, Retention: ReaderRetentionRetainedReproducible,
				Artifacts: []ReaderRetainedArtifact{{Stage: ReaderDecoderStageRetainedPinned, Kind: ReaderArtifactPinnedModule, Ref: "module@v1", Digest: "h1:pinned"}},
			},
			attempts:    []ReaderDecoderAttempt{{Stage: ReaderDecoderStageRetainedPinned, ID: "module@v1", Digest: "h1:other", Available: true}},
			wantReason:  ReaderRefusalRetainedUnavailable,
			wantOutcome: ReaderAttemptDigestMismatch,
		},
		{
			name:        "host key unavailable",
			declaration: keyProviderDeclaration(),
			attempts:    ObservedReaderDecoderAttempts(keyProviderDeclaration()),
			wantReason:  ReaderRefusalKeyUnavailable,
			wantOutcome: ReaderAttemptUnavailable,
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			selection, err := ResolveReaderDecoder(testCase.declaration, testCase.attempts)
			if err == nil {
				t.Fatalf("resolution succeeded: %+v", selection)
			}
			var refusal *ReaderDecoderRefusal
			if !errors.As(err, &refusal) {
				t.Fatalf("error is not a typed refusal: %v", err)
			}
			if refusal.Reason != testCase.wantReason {
				t.Fatalf("refusal reason = %q, want %q", refusal.Reason, testCase.wantReason)
			}
			if len(selection.Outcomes) == 0 || selection.Outcomes[0].Outcome != testCase.wantOutcome {
				t.Fatalf("outcomes = %+v, want first outcome %q", selection.Outcomes, testCase.wantOutcome)
			}
			for _, outcome := range selection.Outcomes {
				if outcome.Outcome != ReaderAttemptSelected && strings.TrimSpace(outcome.Reason) == "" {
					t.Fatalf("failed outcome %+v carries no reason", outcome)
				}
			}
		})
	}
}

// TestReaderClosureDigestIsStable proves the declaration digest used to compare
// builds is deterministic for identical observations.
func TestReaderClosureDigestIsStable(t *testing.T) {
	declaration, ok := ReaderClosureDeclarationFor(ReaderDependencyCanonicalizationCompactJSON)
	if !ok {
		t.Fatal("canonicalization dependency is undeclared")
	}
	first, err := declaration.ReaderClosureDigest()
	if err != nil {
		t.Fatal(err)
	}
	second, err := declaration.ReaderClosureDigest()
	if err != nil {
		t.Fatal(err)
	}
	if first != second || !strings.HasPrefix(first, "sha256:") {
		t.Fatalf("declaration digest = %q, want a stable sha256 digest", first)
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
