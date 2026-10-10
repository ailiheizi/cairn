package repository

import (
	"runtime/debug"
	"strings"
	"testing"
)

func buildInfoForZstd(version, sum string, replacement *debug.Module) *debug.BuildInfo {
	return &debug.BuildInfo{Deps: []*debug.Module{{
		Path: zstdModulePath, Version: version, Sum: sum, Replace: replacement,
	}}}
}

func TestLinkedModuleObservationRequiresExactBuildInfo(t *testing.T) {
	replacement := &debug.Module{Path: zstdModulePath, Version: zstdModuleVersion, Sum: zstdModuleDigest}
	cases := []struct {
		name       string
		info       *debug.BuildInfo
		wantOK     bool
		wantReason string
	}{
		{name: "missing build info", info: nil, wantReason: "does not report linked module information"},
		{name: "empty build info", info: &debug.BuildInfo{}, wantReason: "no linked module dependency"},
		{name: "incorrect module path", info: &debug.BuildInfo{Deps: []*debug.Module{{Path: "github.com/other/compress", Version: zstdModuleVersion, Sum: zstdModuleDigest}}}, wantReason: "no linked module dependency"},
		{name: "wrong version", info: buildInfoForZstd("v1.18.8", zstdModuleDigest, nil), wantReason: "differs from the pinned"},
		{name: "missing checksum", info: buildInfoForZstd(zstdModuleVersion, "", nil), wantReason: "has no checksum"},
		{name: "wrong checksum", info: buildInfoForZstd(zstdModuleVersion, "h1:wrong", nil), wantReason: "does not match the declared decoder digest"},
		{name: "replacement with same version", info: buildInfoForZstd(zstdModuleVersion, zstdModuleDigest, replacement), wantReason: "is replaced by"},
		{name: "replacement with different version", info: buildInfoForZstd(zstdModuleVersion, zstdModuleDigest, &debug.Module{Path: zstdModulePath, Version: "v1.18.8"}), wantReason: "is replaced by"},
		{name: "exact linked module", info: buildInfoForZstd(zstdModuleVersion, zstdModuleDigest, nil), wantOK: true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			gotDigest, gotOK, reason := linkedModuleObservationFromBuildInfo(testCase.info, zstdModulePath, zstdModuleVersion, zstdModuleDigest)
			if gotOK != testCase.wantOK {
				t.Fatalf("observation ok = %t, want %t (digest=%q reason=%q)", gotOK, testCase.wantOK, gotDigest, reason)
			}
			if testCase.wantOK {
				if gotDigest != zstdModuleDigest || reason != "" {
					t.Fatalf("exact observation = digest %q, reason %q", gotDigest, reason)
				}
				return
			}
			if reason == "" || !strings.Contains(reason, testCase.wantReason) {
				t.Fatalf("observation reason = %q, want substring %q", reason, testCase.wantReason)
			}
		})
	}
}

func TestObservedMultiFileSourceSetMatchesDeclarationAndFailsOnMissingMember(t *testing.T) {
	refs := []string{"server/internal/repository/zstd.go", "server/internal/repository/encryption.go"}
	declaration := ReaderClosureDeclaration{
		Dependency:          ReaderDependencyLocalZstdEncryptedV1,
		PinnedModulePath:    zstdModulePath,
		PinnedModuleVersion: zstdModuleVersion,
	}
	artifact := sourceSetArtifact(refs...)
	if !artifact.Available {
		t.Fatalf("source fixture must be present: %s", artifact.Reason)
	}
	attempt := observeArtifactWithBuildInfo(declaration, artifact, nil)
	if !attempt.Available || attempt.Digest != artifact.Digest || attempt.Reason != "" {
		t.Fatalf("multi-file source-set observation = %+v, declared digest %q", attempt, artifact.Digest)
	}

	missing := sourceSetArtifact(refs[0], "server/internal/repository/does-not-exist.go")
	if missing.Available {
		t.Fatal("source-set fixture with a missing member was declared available")
	}
	missingAttempt := observeArtifactWithBuildInfo(declaration, missing, nil)
	if missingAttempt.Available || missingAttempt.Digest != "" || !strings.Contains(missingAttempt.Reason, "does-not-exist.go") {
		t.Fatalf("missing source-set member must fail closed, got %+v", missingAttempt)
	}

	for _, ref := range []string{"server/internal/repository/zstd.go,", ",server/internal/repository/encryption.go", "server/internal/repository/zstd.go,,server/internal/repository/encryption.go"} {
		bad := ReaderRetainedArtifact{Stage: ReaderDecoderStageNativeInProcess, Kind: ReaderArtifactInTreeSource, Ref: ref}
		got := observeArtifactWithBuildInfo(declaration, bad, nil)
		if got.Available || !strings.Contains(got.Reason, "empty path") {
			t.Fatalf("empty source-set member %q was not rejected: %+v", ref, got)
		}
	}
}

func TestZstdModuleDeclarationUsesExactLinkedStageBeforePinnedFallback(t *testing.T) {
	declaration := moduleDeclaration()
	if len(declaration.Artifacts) != 2 {
		t.Fatalf("module artifacts = %+v, want linked and retained stages", declaration.Artifacts)
	}
	linked, retained := declaration.Artifacts[0], declaration.Artifacts[1]
	if linked.Stage != ReaderDecoderStageNativeInProcess || retained.Stage != ReaderDecoderStageRetainedPinned ||
		linked.Digest != zstdModuleDigest || retained.Digest != zstdModuleDigest {
		t.Fatalf("module artifact order or declared checksums changed: %+v", declaration.Artifacts)
	}

	linkedAttempt := ReaderDecoderAttempt{Stage: ReaderDecoderStageNativeInProcess, ID: linked.Ref,
		Digest: zstdModuleDigest, Available: true}
	pinnedAttempt := ReaderDecoderAttempt{Stage: ReaderDecoderStageRetainedPinned, ID: retained.Ref,
		Digest: zstdModuleDigest, Available: true}
	selected, err := ResolveReaderDecoder(declaration, []ReaderDecoderAttempt{linkedAttempt, pinnedAttempt})
	if err != nil || selected.Stage != ReaderDecoderStageNativeInProcess || selected.Digest != zstdModuleDigest {
		t.Fatalf("exact linked module selection = %+v, err=%v", selected, err)
	}

	linkedAttempt.Digest = "h1:incorrect"
	selected, err = ResolveReaderDecoder(declaration, []ReaderDecoderAttempt{linkedAttempt, pinnedAttempt})
	if err != nil || selected.Stage != ReaderDecoderStageRetainedPinned || len(selected.Outcomes) != 2 || selected.Outcomes[0].Outcome != ReaderAttemptDigestMismatch {
		t.Fatalf("pinned fallback after mismatched linked digest = %+v, err=%v", selected, err)
	}

	linkedAttempt = ReaderDecoderAttempt{Stage: ReaderDecoderStageNativeInProcess, ID: linked.Ref,
		Available: false, Reason: "this build does not report linked module information"}
	selected, err = ResolveReaderDecoder(declaration, []ReaderDecoderAttempt{linkedAttempt, pinnedAttempt})
	if err != nil || selected.Stage != ReaderDecoderStageRetainedPinned || len(selected.Outcomes) != 2 || selected.Outcomes[0].Outcome != ReaderAttemptUnavailable {
		t.Fatalf("retained source fallback without BuildInfo = %+v, err=%v", selected, err)
	}
}

func TestLinkedModuleDigestObservesCurrentBuild(t *testing.T) {
	got, ok, reason := LinkedModuleDigest(zstdModulePath, zstdModuleVersion)
	if !ok {
		t.Skipf("test executable does not expose linked zstd module facts: %s", reason)
	}
	if got != zstdModuleDigest {
		t.Fatalf("linked zstd digest = %q, want frozen %q", got, zstdModuleDigest)
	}
}

func TestZstdDriverExecutableFallbackRequiresExactLinkedModule(t *testing.T) {
	codec, ok := codecForProfile(RepositoryProfileLocalZstdV1)
	if !ok {
		t.Fatal("local zstd codec is not declared")
	}
	for name, declaration := range map[string]ReaderClosureDeclaration{
		"driver":        driverDeclaration(codec),
		"payload tuple": payloadTupleDeclaration(codec),
	} {
		artifact, found := executableFallback(declaration)
		if !found {
			t.Fatalf("%s declaration has no executable fallback: %+v", name, declaration.Artifacts)
		}
		cases := []struct {
			name string
			info *debug.BuildInfo
		}{
			{name: "missing build info"},
			{name: "empty module facts", info: &debug.BuildInfo{}},
			{name: "wrong version", info: buildInfoForZstd("v1.18.8", zstdModuleDigest, nil)},
			{name: "wrong checksum", info: buildInfoForZstd(zstdModuleVersion, "h1:wrong", nil)},
			{name: "replaced with same version", info: buildInfoForZstd(zstdModuleVersion, zstdModuleDigest,
				&debug.Module{Path: zstdModulePath, Version: zstdModuleVersion, Sum: zstdModuleDigest})},
		}
		for _, testCase := range cases {
			t.Run(name+"/"+testCase.name, func(t *testing.T) {
				attempt := observeArtifactWithBuildInfo(declaration, artifact, testCase.info)
				if attempt.Available || attempt.Reason == "" {
					t.Fatalf("executable fallback accepted unproven codec facts: %+v", attempt)
				}
				constructed := codecExecutableArtifactFromBuildInfo(testCase.info, artifact, zstdModulePath,
					zstdModuleVersion, zstdModuleDigest, "sha256:binary", true, "")
				if constructed.Available || constructed.Reason == "" {
					t.Fatalf("artifact constructor accepted unproven codec facts: %+v", constructed)
				}
			})
		}
		attempt := observeArtifactWithBuildInfo(declaration, artifact,
			buildInfoForZstd(zstdModuleVersion, zstdModuleDigest, nil))
		if !attempt.Available || attempt.Digest == "" {
			t.Fatalf("exact module facts did not admit %s executable fallback: %+v", name, attempt)
		}
		constructed := codecExecutableArtifactFromBuildInfo(buildInfoForZstd(zstdModuleVersion, zstdModuleDigest, nil),
			artifact, zstdModulePath, zstdModuleVersion, zstdModuleDigest, "sha256:binary", true, "")
		if !constructed.Available || constructed.Digest != "sha256:binary" {
			t.Fatalf("exact module facts did not admit %s executable declaration: %+v", name, constructed)
		}
	}
}

func codecForProfile(profile string) (readerCodec, bool) {
	for _, codec := range readerCodecs {
		if codec.repository == profile {
			return codec, true
		}
	}
	return readerCodec{}, false
}

func executableFallback(declaration ReaderClosureDeclaration) (ReaderRetainedArtifact, bool) {
	for _, artifact := range declaration.Artifacts {
		if artifact.Kind == ReaderArtifactExecutable && artifact.Stage == ReaderDecoderStageRetainedPinned {
			return artifact, true
		}
	}
	return ReaderRetainedArtifact{}, false
}
