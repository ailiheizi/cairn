package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
)

// ReaderClosureSchemaV1 identifies the machine-readable reader-closure
// declaration this build emits. The declaration answers one question per
// reader dependency: is the decoder that can still consume this dependency
// retained, reproducibly rebuildable, or neither, and how would an independent
// reader verify that claim?
//
// This is a read-only projection of facts this build can observe about itself.
// It never grants recovery authority, never widens what a reader may decode,
// and never substitutes for the signed RequiredReaderDependencies carried by a
// portable recovery record.
const ReaderClosureSchemaV1 = "org.restoreweave.reader-closure.v1"

// Retention states how one reader dependency remains obtainable.
const (
	// ReaderRetentionRetainedReproducible means the decoder bits are retained
	// (they live in this checkout, in the pinned module bytes recorded by
	// go.sum, or in the running executable) and the dependency can also be
	// rebuilt from that complete retained closure by the recorded procedure.
	ReaderRetentionRetainedReproducible = "RETAINED_AND_REPRODUCIBLY_REBUILDABLE"
	// ReaderRetentionOperatorHeld means the dependency is held by the operator
	// outside this build (a host key). It is not reproducible from any
	// retained artifact, and losing it makes the dependent payload
	// unreadable.
	ReaderRetentionOperatorHeld = "OPERATOR_RETAINED"
	// ReaderRetentionUnavailable means no retained decoder and no rebuild
	// procedure exist for this dependency in this build.
	ReaderRetentionUnavailable = "UNAVAILABLE"
)

// Decoder fallback stages, in the frozen order a reader may try them.
const (
	// ReaderDecoderStageNativeInProcess is the decoder compiled into the
	// running build. It is tried first, and only when its observed
	// implementation digest matches the digest recorded in the declaration.
	ReaderDecoderStageNativeInProcess = "NATIVE_IN_PROCESS"
	// ReaderDecoderStageRetainedPinned is the retained pinned decoder: the
	// module bytes recorded by go.sum, or the retained executable itself.
	ReaderDecoderStageRetainedPinned = "RETAINED_PINNED"
	// ReaderDecoderStageOperatorHeld is a dependency the host must supply, such
	// as the key for an encrypted repository. It is never a decoder.
	ReaderDecoderStageOperatorHeld = "OPERATOR_HELD"
)

// Retained artifact kinds and the digest kinds recorded with them.
const (
	ReaderArtifactInTreeSource = "IN_TREE_SOURCE"
	ReaderArtifactPinnedModule = "PINNED_MODULE"
	ReaderArtifactExecutable   = "RUNNING_EXECUTABLE"
	ReaderArtifactOperatorKey  = "OPERATOR_KEY"

	ReaderDigestSourceSet  = "sha256-source-set"
	ReaderDigestModuleH1   = "go-sum-module-h1"
	ReaderDigestExecutable = "sha256-executable"
)

// Reader dependency roles. Roles describe what part of the reader contract the
// dependency belongs to; they do not imply separate admission.
const (
	ReaderRoleRepositoryDriver = "REPOSITORY_DRIVER"
	ReaderRoleCompressionCodec = "COMPRESSION_CODEC"
	ReaderRoleEncryptionCodec  = "ENCRYPTION_CODEC"
	ReaderRoleCanonicalization = "CANONICALIZATION"
	ReaderRoleSignature        = "SIGNATURE"
	ReaderRoleReaderProfile    = "READER_PROFILE"
	ReaderRoleKeyProvider      = "KEY_PROVIDER"
)

// Reader decoder refusal reasons. A refusal is a typed statement that this
// reader cannot decode the dependency with the decoders it has; it never
// authorizes a weaker fidelity class, and the caller is expected to fall
// through to the next recovery reference instead.
const (
	// ReaderRefusalNotAdmitted means the dependency has no declaration at all.
	ReaderRefusalNotAdmitted = "READER_DEPENDENCY_NOT_ADMITTED"
	// ReaderRefusalNotRetained means the declaration admits neither a retained
	// decoder nor a rebuild procedure.
	ReaderRefusalNotRetained = "DECODER_NOT_RETAINED"
	// ReaderRefusalNativeDigestMismatch means an in-process decoder was offered
	// but its observed digest differs from the declared digest.
	ReaderRefusalNativeDigestMismatch = "NATIVE_DECODER_DIGEST_MISMATCH"
	// ReaderRefusalRetainedUnavailable means no usable retained pinned decoder
	// was available.
	ReaderRefusalRetainedUnavailable = "RETAINED_DECODER_UNAVAILABLE"
	// ReaderRefusalKeyUnavailable means the codec needs a host-held key that
	// this reader does not have.
	ReaderRefusalKeyUnavailable = "OPERATOR_KEY_PROVIDER_UNAVAILABLE"
)

// ErrReaderDecoderUnavailable is the sentinel for every decoder refusal. Use
// errors.As with *ReaderDecoderRefusal for the typed reason.
var ErrReaderDecoderUnavailable = errors.New("reader decoder is unavailable")

// ReaderRetainedArtifact is one retained or rebuildable source of a decoder.
// Stage places it in the fallback order; Digest is the digest of the exact
// bytes this build could observe, and Available reports whether it was
// observable when the declaration was emitted.
type ReaderRetainedArtifact struct {
	Stage      string `json:"stage"`
	Kind       string `json:"kind"`
	Ref        string `json:"ref"`
	Digest     string `json:"digest,omitempty"`
	DigestKind string `json:"digest_kind,omitempty"`
	Available  bool   `json:"available"`
	Reason     string `json:"reason,omitempty"`
}

// ReaderClosureDeclaration is the machine-readable reader-closure statement
// for exactly one dependency name (the same strings that appear in
// CapabilityProfile.ReaderDependencies and in the signed
// RequiredReaderDependencies tuple).
type ReaderClosureDeclaration struct {
	Schema      string `json:"schema"`
	Dependency  string `json:"dependency"`
	Role        string `json:"role"`
	Description string `json:"description"`
	// Retention is the retention class of the whole dependency.
	Retention string `json:"retention"`
	// Artifacts is the fallback order for this dependency, first stage first.
	Artifacts []ReaderRetainedArtifact `json:"artifacts,omitempty"`
	// Rebuild is the exact procedure that re-obtains or rebuilds the decoder
	// from the retained closure. Empty means no rebuild procedure exists.
	Rebuild string `json:"rebuild,omitempty"`
	// Verify is the procedure that proves a rebuild is the declared decoder.
	// It never requires trusting this process.
	Verify string `json:"verify"`
	// DecoderSupportWindow states for how long this decoder is required to stay
	// readable and what forces a new profile ID instead of an in-place change.
	DecoderSupportWindow string `json:"decoder_support_window"`
	// PinnedModulePath and PinnedModuleVersion name the pinned decoder module
	// the retained-pinned stage must match, when the decoder comes from a
	// pinned module rather than from this checkout.
	PinnedModulePath    string `json:"pinned_module_path,omitempty"`
	PinnedModuleVersion string `json:"pinned_module_version,omitempty"`
	// State is AVAILABLE when at least one artifact in the fallback order is
	// usable in this build, UNAVAILABLE when none is, and HOST_DECIDED when
	// only the host's key provider can answer.
	State  string `json:"state"`
	Reason string `json:"reason,omitempty"`
}

// Reader closure states. They are deliberately not the repository health key
// states: a reader closure may be HOST_DECIDED without anything being wrong.
const (
	ReaderClosureStateAvailable   = "AVAILABLE"
	ReaderClosureStateUnavailable = "UNAVAILABLE"
	ReaderClosureStateHostDecided = "HOST_DECIDED"
)

// ReaderDecoderAttempt is one decoder a reader could offer for one dependency.
// Reader decides the attempts; this package never assumes a decoder exists.
type ReaderDecoderAttempt struct {
	Stage     string `json:"stage"`
	ID        string `json:"id"`
	Digest    string `json:"digest,omitempty"`
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

// ReaderDecoderOutcome records what happened to one declared stage.
type ReaderDecoderOutcome struct {
	Stage   string `json:"stage"`
	ID      string `json:"id,omitempty"`
	Outcome string `json:"outcome"`
	Reason  string `json:"reason,omitempty"`
}

// Reader decoder attempt outcomes.
const (
	ReaderAttemptSelected       = "SELECTED"
	ReaderAttemptNotAttempted   = "NOT_ATTEMPTED"
	ReaderAttemptUnavailable    = "UNAVAILABLE"
	ReaderAttemptDigestMismatch = "DIGEST_MISMATCH"
	ReaderAttemptNotRetained    = "NOT_RETAINED"
)

// ReaderDecoderSelection is the outcome of the frozen fallback order for one
// dependency: either the selected stage and decoder, or a typed refusal.
type ReaderDecoderSelection struct {
	Dependency string                 `json:"dependency"`
	Stage      string                 `json:"stage,omitempty"`
	DecoderID  string                 `json:"decoder_id,omitempty"`
	Digest     string                 `json:"digest,omitempty"`
	Outcomes   []ReaderDecoderOutcome `json:"outcomes"`
	Refusal    *ReaderDecoderRefusal  `json:"refusal,omitempty"`
}

// ReaderDecoderRefusal is the typed reason a reader must stop trying to decode
// this dependency and fall through to the next recovery reference.
type ReaderDecoderRefusal struct {
	Dependency string `json:"dependency"`
	Reason     string `json:"reason"`
	Detail     string `json:"detail,omitempty"`
	// CallerAction restates the only permitted response: fall through to the
	// next recovery reference. A weaker fidelity class is never implied.
	CallerAction string `json:"caller_action"`
}

func (refusal *ReaderDecoderRefusal) Error() string {
	if refusal == nil {
		return ErrReaderDecoderUnavailable.Error()
	}
	detail := ""
	if refusal.Detail != "" {
		detail = ": " + refusal.Detail
	}
	return fmt.Sprintf("%s (%s)%s", ErrReaderDecoderUnavailable, refusal.Reason, detail)
}

// Is lets errors.Is(err, ErrReaderDecoderUnavailable) report every typed
// refusal without callers matching on strings.
func (refusal *ReaderDecoderRefusal) Is(target error) bool {
	return target == ErrReaderDecoderUnavailable
}

// ReaderCodecClosure is one admitted codec together with every dependency a
// reader must satisfy before it can decode that codec's payloads and its
// signed portable records.
type ReaderCodecClosure struct {
	Schema       string                     `json:"schema"`
	Codec        string                     `json:"codec"`
	Repository   string                     `json:"repository_profile"`
	Compression  string                     `json:"compression_profile"`
	Encryption   string                     `json:"encryption_profile"`
	Admission    string                     `json:"admission"`
	Dependencies []string                   `json:"dependencies"`
	Declarations []ReaderClosureDeclaration `json:"declarations"`
	// Resolutions applies the fallback order to the decoders this build can
	// actually observe locally.
	Resolutions []ReaderDecoderSelection `json:"resolutions"`
	// Readable is true only when every dependency in this closure resolved to a
	// selected decoder stage.
	Readable bool   `json:"readable"`
	Reason   string `json:"reason,omitempty"`
}

// Codec admission states. The encrypted profile is reachable through this
// package's read-only opener but is refused by persisted config and by the
// daemon, and both facts must stay visible.
const (
	ReaderCodecAdmitted     = "ADMITTED"
	ReaderCodecExperimental = "EXPERIMENTAL_NOT_ADMITTED_BY_PERSISTED_CONFIG"
	ReaderCodecTestOnly     = "TEST_ONLY_NOT_A_RECOVERY_CODEC"
)

// Pinned decoder bytes for the third-party compression codec. The name string
// is the same dependency name CapabilityProfile.ReaderDependencies reports,
// and the digest is the Go module checksum recorded in this checkout's go.sum.
// A dependency bump must update the declaration with it: a decoder cannot be
// replaced while a retained representation depends on the old bytes.
const (
	zstdModulePath    = "github.com/klauspost/compress"
	zstdModuleVersion = "v1.18.7"
	zstdModuleDigest  = "h1:aUyZsS4kH3QTKurYhAOwAHxllVPnOthb3vPfnF1Ehjw="
	zstdDependency    = "klauspost/compress/zstd@v1.18.7"
)

// Dependency names used by the signed portable-record reader tuple and by the
// capability profiles. They are declared once as data so one table can answer
// for both naming schemes, and both the capability profiles and the exact
// package assert their own names against this table.
const (
	ReaderDependencyCanonicalizationCompactJSON = "canonicalization:encoding/json-compact-v1"
	ReaderDependencySignatureEd25519V1          = "signature:ed25519-v1"
	ReaderDependencyPortableFactReaderV1        = "restoreweave-reader:portable-fact-v1"
	ReaderDependencyPortableFactReaderV2        = "restoreweave-reader:portable-fact-v2"
	ReaderDependencyHostKeyProviderV1           = "host-key-provider:v1"

	ReaderDependencyDirectoryCASDev      = "restoreweave.repository.directory-cas-dev-v1"
	ReaderDependencyLocalZstdV1          = "restoreweave.repository.local-zstd-v1"
	ReaderDependencyLocalZstdEncryptedV1 = "restoreweave.repository.local-zstd-encrypted-v1"
	ReaderDependencyMemoryTest           = "restoreweave.memory-test"
	ReaderDependencyPinnedZstd           = zstdDependency
)

// recordReaderDependencies are the record-level dependencies every signed
// portable record family needs, one entry per naming role.
var recordReaderDependencies = []string{
	ReaderDependencyCanonicalizationCompactJSON,
	ReaderDependencySignatureEd25519V1,
	ReaderDependencyPortableFactReaderV1,
	ReaderDependencyPortableFactReaderV2,
}

type readerCodec struct {
	driverName   string
	repository   string
	compression  string
	encryption   string
	admission    string
	driverRole   string
	description  string
	sourceRefs   []string
	pinnedModule bool
	operatorKey  bool
}

// readerCodecs is the admitted codec table: one entry per repository profile
// this build can open. Identity payloads carry no compression, so the identity
// codec's decoder is the whole-file reader plus stdlib SHA-256.
var readerCodecs = []readerCodec{
	{
		driverName:  ReaderDependencyDirectoryCASDev,
		repository:  RepositoryProfileDirectoryCASDev,
		compression: CompressionProfileIdentity,
		encryption:  EncryptionNone,
		admission:   ReaderCodecAdmitted,
		driverRole:  ReaderRoleRepositoryDriver,
		description: "whole-file content-addressed storage storing identity (uncompressed) payloads whose content ID is the SHA-256 digest of the complete logical byte stream",
		sourceRefs:  []string{"server/internal/repository/driver.go"},
	},
	{
		driverName:   ReaderDependencyLocalZstdV1,
		repository:   RepositoryProfileLocalZstdV1,
		compression:  CompressionProfileZstdV1,
		encryption:   EncryptionNone,
		admission:    ReaderCodecAdmitted,
		driverRole:   ReaderRoleCompressionCodec,
		description:  "whole-file zstd repository; content IDs refer to the decompressed bytes and every stored object is a checksummed zstd frame from the pinned module",
		sourceRefs:   []string{"server/internal/repository/zstd.go"},
		pinnedModule: true,
	},
	{
		driverName:   ReaderDependencyLocalZstdEncryptedV1,
		repository:   RepositoryProfileLocalZstdEncryptedV1,
		compression:  CompressionProfileZstdV1,
		encryption:   EncryptionProfileAES256GCMZstdV1,
		admission:    ReaderCodecExperimental,
		driverRole:   ReaderRoleEncryptionCodec,
		description:  "experimental AES-256-GCM envelope around the local zstd profile; reachable through the read-only opener with an explicit host key provider only",
		sourceRefs:   []string{"server/internal/repository/zstd.go", "server/internal/repository/encryption.go"},
		pinnedModule: true,
		operatorKey:  true,
	},
	{
		driverName:  ReaderDependencyMemoryTest,
		repository:  "memory-test-v1",
		compression: CompressionProfileIdentity,
		encryption:  EncryptionNone,
		admission:   ReaderCodecTestOnly,
		driverRole:  ReaderRoleRepositoryDriver,
		description: "process-local test driver; payloads live only in the process that placed them and no retained decoder exists",
	},
}

// ReaderClosureDeclarations returns the declaration for every dependency name
// this build admits, in deterministic order. Every name that can appear in a
// CapabilityProfile.ReaderDependencies list or in a signed
// RequiredReaderDependencies tuple of a record this build emits has an entry.
func ReaderClosureDeclarations() []ReaderClosureDeclaration {
	var declarations []ReaderClosureDeclaration
	seen := map[string]bool{}
	add := func(declaration ReaderClosureDeclaration) {
		if seen[declaration.Dependency] {
			return
		}
		seen[declaration.Dependency] = true
		declarations = append(declarations, declaration)
	}
	for _, codec := range readerCodecs {
		add(driverDeclaration(codec))
		add(payloadTupleDeclaration(codec))
	}
	for _, dependency := range recordReaderDependencies {
		add(recordDeclaration(dependency))
	}
	add(moduleDeclaration())
	add(keyProviderDeclaration())
	return declarations
}

// ReaderClosureDeclarationFor returns the declaration for one dependency name.
// The second result is false when this build does not admit the name; a reader
// must then refuse rather than guess a decoder.
func ReaderClosureDeclarationFor(dependency string) (ReaderClosureDeclaration, bool) {
	for _, declaration := range ReaderClosureDeclarations() {
		if declaration.Dependency == dependency {
			return declaration, true
		}
	}
	return ReaderClosureDeclaration{}, false
}

// ReaderClosureForProfile projects the complete reader closure of one
// repository profile: the codec, every dependency name a reader must satisfy,
// the declaration of each dependency, and the outcome of the fallback order
// against the decoders this build can observe locally.
func ReaderClosureForProfile(profile string) (ReaderCodecClosure, error) {
	for _, codec := range readerCodecs {
		if codec.repository == profile {
			return closureForCodec(codec), nil
		}
	}
	return ReaderCodecClosure{}, fmt.Errorf("reader closure is not declared for repository profile %q", profile)
}

// ReaderClosureForRepository projects the reader closure of an opened driver.
// The profile tuple is read from the driver itself, so the projection always
// describes the codec this process actually opened.
func ReaderClosureForRepository(driver Driver) (ReaderCodecClosure, error) {
	if driver == nil {
		return ReaderCodecClosure{}, errors.New("reader closure requires an opened repository driver")
	}
	profile := DescribeProfile(driver)
	for _, codec := range readerCodecs {
		if codec.repository != profile.Repository || codec.compression != profile.Compression {
			continue
		}
		if codec.operatorKey && profile.Encryption != EncryptionProfileAES256GCMZstdV1 {
			continue
		}
		return closureForCodec(codec), nil
	}
	return ReaderCodecClosure{}, fmt.Errorf("reader closure is not declared for repository profile tuple %q/%q", profile.Repository, profile.Compression)
}

func closureForCodec(codec readerCodec) ReaderCodecClosure {
	closure := ReaderCodecClosure{
		Schema:      ReaderClosureSchemaV1,
		Codec:       codec.repository,
		Repository:  codec.repository,
		Compression: codec.compression,
		Encryption:  codec.encryption,
		Admission:   codec.admission,
	}
	dependencies := []string{codec.driverName, payloadTupleDependency(codec)}
	dependencies = append(dependencies, recordReaderDependencies...)
	if codec.operatorKey {
		dependencies = append(dependencies, ReaderDependencyHostKeyProviderV1)
	}
	if codec.pinnedModule {
		dependencies = append(dependencies, zstdDependency)
	}
	closure.Dependencies = dependencies
	closure.Readable = true
	for _, dependency := range dependencies {
		declaration, ok := ReaderClosureDeclarationFor(dependency)
		if !ok {
			// Unreachable for the table above; kept fail-closed so a codec that
			// gains a dependency without a declaration reads as unreadable.
			closure.Readable = false
			closure.Reason = fmt.Sprintf("dependency %q has no declaration", dependency)
			continue
		}
		closure.Declarations = append(closure.Declarations, declaration)
		selection, err := ResolveReaderDecoder(declaration, ObservedReaderDecoderAttempts(declaration))
		closure.Resolutions = append(closure.Resolutions, selection)
		if err != nil && closure.Reason == "" {
			closure.Readable = false
			closure.Reason = err.Error()
		}
	}
	return closure
}

// AdmitReaderDependency is the entry point a reader uses before it touches any
// codec: the dependency name comes from a signed RequiredReaderDependencies
// list or from a capability profile, and this build answers whether it can
// decode it. An undeclared name is refused with a typed reason rather than
// guessed at.
func AdmitReaderDependency(dependency string) (ReaderDecoderSelection, error) {
	declaration, declared := ReaderClosureDeclarationFor(dependency)
	if !declared {
		refusal := &ReaderDecoderRefusal{
			Dependency:   dependency,
			Reason:       ReaderRefusalNotAdmitted,
			Detail:       "no reader-closure declaration covers this dependency name",
			CallerAction: readerFallThroughAction,
		}
		return ReaderDecoderSelection{Dependency: dependency, Refusal: refusal}, refusal
	}
	return ResolveReaderDecoder(declaration, ObservedReaderDecoderAttempts(declaration))
}

// ResolveReaderDecoder applies the frozen decoder fallback order for one
// declared dependency:
//
//  1. the in-process decoder, accepted only when the reader observed a digest
//     that matches the digest recorded in the declaration;
//  2. the retained pinned decoder (module bytes recorded by go.sum, or the
//     retained executable), accepted only under the same digest rule;
//  3. refusal with a typed reason, so the caller falls through to the next
//     recovery reference instead of accepting a weaker fidelity class.
//
// The order is read from the declaration's artifact list, so a caller cannot
// reorder it, and a digest mismatch always continues to the next stage rather
// than authorizing a modified decoder.
func ResolveReaderDecoder(declaration ReaderClosureDeclaration, attempts []ReaderDecoderAttempt) (ReaderDecoderSelection, error) {
	selection := ReaderDecoderSelection{Dependency: declaration.Dependency}
	if len(declaration.Artifacts) == 0 {
		selection.Outcomes = append(selection.Outcomes, ReaderDecoderOutcome{
			Outcome: ReaderAttemptNotRetained,
			Reason:  "dependency declares no retained decoder and no rebuild path",
		})
		refusal := &ReaderDecoderRefusal{
			Dependency: declaration.Dependency, Reason: ReaderRefusalNotRetained,
			Detail:       "dependency declares no retained decoder and no rebuild path",
			CallerAction: readerFallThroughAction,
		}
		selection.Refusal = refusal
		return selection, refusal
	}
	var lastFailure *ReaderDecoderOutcome
	for _, artifact := range declaration.Artifacts {
		attempt, offered := findAttempt(attempts, artifact.Stage)
		outcome := ReaderDecoderOutcome{Stage: artifact.Stage, ID: artifact.Ref}
		switch {
		case !offered:
			outcome.Outcome = ReaderAttemptNotAttempted
			outcome.Reason = "the reader offered no decoder for this stage"
		case !attempt.Available:
			outcome.ID = firstNonEmptyString(attempt.ID, artifact.Ref)
			outcome.Outcome = ReaderAttemptUnavailable
			outcome.Reason = firstNonEmptyString(attempt.Reason, "the offered decoder reported itself unavailable")
		case artifact.Digest != "" && attempt.Digest != artifact.Digest:
			outcome.ID = firstNonEmptyString(attempt.ID, artifact.Ref)
			outcome.Outcome = ReaderAttemptDigestMismatch
			outcome.Reason = fmt.Sprintf("observed digest %q does not match the declared %s digest %q", attempt.Digest, artifact.DigestKind, artifact.Digest)
		default:
			outcome.ID = firstNonEmptyString(attempt.ID, artifact.Ref)
			outcome.Outcome = ReaderAttemptSelected
			selection.Stage = artifact.Stage
			selection.DecoderID = outcome.ID
			selection.Digest = firstNonEmptyString(attempt.Digest, artifact.Digest)
		}
		selection.Outcomes = append(selection.Outcomes, outcome)
		if outcome.Outcome == ReaderAttemptSelected {
			return selection, nil
		}
		failed := outcome
		lastFailure = &failed
	}
	reason, detail := refusalFor(declaration, selection.Outcomes)
	if lastFailure != nil && detail == "" {
		detail = lastFailure.Reason
	}
	refusal := &ReaderDecoderRefusal{
		Dependency: declaration.Dependency, Reason: reason, Detail: detail,
		CallerAction: readerFallThroughAction,
	}
	selection.Refusal = refusal
	return selection, refusal
}

const readerFallThroughAction = "fall through to the next recovery reference; a failed or unavailable reference remains in history with its evidence, and no weaker fidelity class is accepted automatically"

func refusalFor(declaration ReaderClosureDeclaration, outcomes []ReaderDecoderOutcome) (string, string) {
	if declaration.Retention == ReaderRetentionOperatorHeld || declaration.Role == ReaderRoleKeyProvider {
		return ReaderRefusalKeyUnavailable, "the codec requires a host-held key that this reader does not have"
	}
	for _, outcome := range outcomes {
		if outcome.Stage == ReaderDecoderStageNativeInProcess && outcome.Outcome == ReaderAttemptDigestMismatch {
			return ReaderRefusalNativeDigestMismatch, outcome.Reason
		}
	}
	return ReaderRefusalRetainedUnavailable, ""
}

func findAttempt(attempts []ReaderDecoderAttempt, stage string) (ReaderDecoderAttempt, bool) {
	for _, attempt := range attempts {
		if attempt.Stage == stage {
			return attempt, true
		}
	}
	return ReaderDecoderAttempt{}, false
}

// ObservedReaderDecoderAttempts observes every decoder stage this build can
// actually offer for one declaration. Digest values are always observed here,
// never assumed: an unavailable observation stays unavailable with a reason.
func ObservedReaderDecoderAttempts(declaration ReaderClosureDeclaration) []ReaderDecoderAttempt {
	attempts := make([]ReaderDecoderAttempt, 0, len(declaration.Artifacts))
	for _, artifact := range declaration.Artifacts {
		attempts = append(attempts, observeArtifact(declaration, artifact))
	}
	return attempts
}

func observeArtifact(declaration ReaderClosureDeclaration, artifact ReaderRetainedArtifact) ReaderDecoderAttempt {
	return observeArtifactWithBuildInfo(declaration, artifact, readBuildInfo())
}

func observeArtifactWithBuildInfo(declaration ReaderClosureDeclaration, artifact ReaderRetainedArtifact, buildInfo *debug.BuildInfo) ReaderDecoderAttempt {
	attempt := ReaderDecoderAttempt{Stage: artifact.Stage, ID: artifact.Ref}
	switch artifact.Kind {
	case ReaderArtifactInTreeSource:
		refs := strings.Split(artifact.Ref, ",")
		for _, ref := range refs {
			if ref == "" {
				attempt.Reason = "retained source reference contains an empty path"
				return attempt
			}
		}
		digest, ok, reason := SourceSetDigest(refs...)
		attempt.Digest = digest
		attempt.Available = ok
		attempt.Reason = reason
	case ReaderArtifactPinnedModule:
		if artifact.Stage == ReaderDecoderStageNativeInProcess {
			digest, ok, reason := linkedModuleObservationFromBuildInfo(buildInfo, declaration.PinnedModulePath, declaration.PinnedModuleVersion, artifact.Digest)
			attempt.Digest = digest
			attempt.Available = ok
			attempt.Reason = reason
		} else {
			digest, ok, reason := RetainedModuleDigest(declaration.PinnedModulePath, declaration.PinnedModuleVersion)
			attempt.Digest = digest
			attempt.Available = ok
			attempt.Reason = reason
		}
	case ReaderArtifactExecutable:
		if declaration.PinnedModulePath != "" {
			_, linkedOK, linkedReason := linkedModuleObservationFromBuildInfo(buildInfo, declaration.PinnedModulePath,
				declaration.PinnedModuleVersion, zstdModuleDigest)
			if !linkedOK {
				attempt.Reason = "the running executable cannot stand in for the pinned codec: " + linkedReason
				break
			}
		}
		digest, ok, reason := RunningExecutableDigest()
		attempt.Digest = digest
		attempt.Available = ok
		attempt.Reason = reason
	case ReaderArtifactOperatorKey:
		// Only the host can supply this attempt; a reader that has no key
		// provider must see the dependency as unavailable rather than assume
		// the key exists.
		attempt.Available = false
		attempt.Reason = "the key is held by the host key provider, never by the repository or this checkout"
	default:
		attempt.Available = false
		attempt.Reason = fmt.Sprintf("unsupported retained artifact kind %q", artifact.Kind)
	}
	return attempt
}

// ReaderClosureDigest is the digest of the canonical declaration, used as the
// capability row version so a reader can compare declarations across builds.
func (declaration ReaderClosureDeclaration) ReaderClosureDigest() (string, error) {
	payload, err := json.Marshal(declaration)
	if err != nil {
		return "", fmt.Errorf("marshal reader closure declaration: %w", err)
	}
	digest := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(digest[:]), nil
}

func driverDeclaration(codec readerCodec) ReaderClosureDeclaration {
	declaration := ReaderClosureDeclaration{
		Schema:      ReaderClosureSchemaV1,
		Dependency:  codec.driverName,
		Role:        codec.driverRole,
		Description: codec.description,
		Verify:      readerClosureVerifyProcedure,
		DecoderSupportWindow: "this profile ID stays readable while its retained decoder is retained or rebuildable; a change to the stored " +
			"representation requires a new profile ID plus an explicit migration, never an in-place reinterpretation of existing bytes",
	}
	if codec.admission == ReaderCodecTestOnly {
		declaration.Retention = ReaderRetentionUnavailable
		declaration.State = ReaderClosureStateUnavailable
		declaration.Reason = "process-local test driver: no retained payload decoder exists once the process exits"
		declaration.Verify = "not applicable; this driver never holds recovery-relevant bytes"
		return declaration
	}
	declaration.Retention = ReaderRetentionRetainedReproducible
	declaration.Artifacts = append(declaration.Artifacts, sourceSetArtifact(codec.sourceRefs...))
	if codec.pinnedModule {
		declaration.PinnedModulePath = zstdModulePath
		declaration.PinnedModuleVersion = zstdModuleVersion
		declaration.Artifacts = append(declaration.Artifacts, codecExecutableArtifact())
	} else {
		declaration.Artifacts = append(declaration.Artifacts, executableArtifact())
	}
	declaration.Rebuild = readerClosureRebuildProcedure
	declaration.State, declaration.Reason = artifactState(declaration.Artifacts)
	return declaration
}

func payloadTupleDeclaration(codec readerCodec) ReaderClosureDeclaration {
	declaration := driverDeclaration(codec)
	declaration.Dependency = payloadTupleDependency(codec)
	declaration.Description = "payload tuple name used in signed portable-fact reader dependencies: " + declaration.Description
	return declaration
}

func payloadTupleDependency(codec readerCodec) string {
	return "repository:" + codec.repository + "/" + codec.compression
}

func recordDeclaration(dependency string) ReaderClosureDeclaration {
	declaration := ReaderClosureDeclaration{
		Schema:               ReaderClosureSchemaV1,
		Dependency:           dependency,
		Retention:            ReaderRetentionRetainedReproducible,
		Verify:               readerClosureVerifyProcedure,
		DecoderSupportWindow: "records that carry this name stay readable while this reader profile is admitted; a reader profile change ships as a new name beside the old one, so an older record is read by the older profile rather than re-interpreted",
	}
	switch dependency {
	case ReaderDependencyCanonicalizationCompactJSON:
		declaration.Role = ReaderRoleCanonicalization
		declaration.Description = "compact canonical JSON over the strongly typed record fields, hashed and signed exactly as serialized"
		declaration.Artifacts = []ReaderRetainedArtifact{
			sourceSetArtifact("server/internal/exact/recovery_closure.go"),
			executableArtifact(),
		}
	case ReaderDependencySignatureEd25519V1:
		declaration.Role = ReaderRoleSignature
		declaration.Description = "Ed25519 signatures over restoreweave-signature-v1 domain-separated canonical bytes using the standard library implementation"
		declaration.Artifacts = []ReaderRetainedArtifact{
			sourceSetArtifact("server/internal/exact/recovery_closure.go"),
			executableArtifact(),
		}
	case ReaderDependencyPortableFactReaderV1:
		declaration.Role = ReaderRoleReaderProfile
		declaration.Description = "portable-fact reader profile v1: the predecessor record family stays readable by this reader"
		declaration.Artifacts = []ReaderRetainedArtifact{
			sourceSetArtifact("server/internal/exact/portable_fact_closure.go"),
			executableArtifact(),
		}
		declaration.DecoderSupportWindow = "v1 closures stay readable while this reader profile is admitted; v2 records are emitted beside them and never rewrite a v1 record"
	case ReaderDependencyPortableFactReaderV2:
		declaration.Role = ReaderRoleReaderProfile
		declaration.Description = "portable-fact reader profile v2: the record family this build emits"
		declaration.Artifacts = []ReaderRetainedArtifact{
			sourceSetArtifact("server/internal/exact/portable_fact_closure.go"),
			executableArtifact(),
		}
	default:
		declaration.Role = ReaderRoleReaderProfile
		declaration.Description = "reader profile dependency"
	}
	declaration.Rebuild = readerClosureRebuildProcedure
	declaration.State, declaration.Reason = artifactState(declaration.Artifacts)
	return declaration
}

// moduleDeclaration declares the pinned third-party codec dependency by the
// same name a capability profile reports for it.
func moduleDeclaration() ReaderClosureDeclaration {
	declaration := ReaderClosureDeclaration{
		Schema:              ReaderClosureSchemaV1,
		Dependency:          zstdDependency,
		Role:                ReaderRoleCompressionCodec,
		Description:         "pinned third-party zstd implementation that decodes every stored zstd frame; the linked module is checked first, then retained Go module bytes recorded by go.sum",
		Retention:           ReaderRetentionRetainedReproducible,
		PinnedModulePath:    zstdModulePath,
		PinnedModuleVersion: zstdModuleVersion,
		Artifacts:           []ReaderRetainedArtifact{linkedModuleArtifact(), pinnedModuleArtifact()},
		Rebuild:             readerClosureRebuildProcedure,
		Verify:              readerClosureVerifyProcedure,
		DecoderSupportWindow: "frames written by this pinned decoder stay readable while the module bytes recorded by go.sum remain retained; " +
			"a decoder upgrade ships as a new dependency name and never replaces this one while a stored frame depends on it",
	}
	declaration.State, declaration.Reason = artifactState(declaration.Artifacts)
	return declaration
}

func keyProviderDeclaration() ReaderClosureDeclaration {
	declaration := ReaderClosureDeclaration{
		Schema:      ReaderClosureSchemaV1,
		Dependency:  ReaderDependencyHostKeyProviderV1,
		Role:        ReaderRoleKeyProvider,
		Description: "host-owned key provider resolving the non-secret key reference persisted beside an encrypted repository; the key itself is never stored in the repository or a portable record",
		Retention:   ReaderRetentionOperatorHeld,
		Artifacts: []ReaderRetainedArtifact{{
			Stage: ReaderDecoderStageOperatorHeld, Kind: ReaderArtifactOperatorKey,
			Ref:       "host key provider key_ref recorded in repository.encryption.json",
			Available: false,
			Reason:    "the key is held by the operator, never by the repository or this checkout",
		}},
		Rebuild:              "not reproducible: the key is not derivable from any retained artifact and must be retained independently; only the non-secret key reference is persisted",
		Verify:               "not applicable by construction; a reader without the key refuses with " + ReaderRefusalKeyUnavailable + " instead of guessing",
		DecoderSupportWindow: "encrypted payloads stay readable only while the operator retains the key; missing database and recovery backups or a lost key make the payload unrecoverable",
		State:                ReaderClosureStateHostDecided,
		Reason:               "availability is decided by the host key provider at open time, never by this projection",
	}
	return declaration
}

const readerClosureRebuildProcedure = "go build ./server/cmd/restoreweaved from the retained source revision with the pinned modules recorded in go.sum (go mod download); no network-only or registry-only component is required"

const readerClosureVerifyProcedure = "go mod verify for the pinned module bytes, then go test ./server/internal/repository/... ./server/internal/exact/... which decodes the committed conformance vectors and golden payload frames byte-exactly"

func sourceSetArtifact(refs ...string) ReaderRetainedArtifact {
	artifact := ReaderRetainedArtifact{Stage: ReaderDecoderStageNativeInProcess, Kind: ReaderArtifactInTreeSource, Ref: strings.Join(refs, ","), DigestKind: ReaderDigestSourceSet}
	digest, ok, reason := SourceSetDigest(refs...)
	artifact.Digest = digest
	artifact.Available = ok
	artifact.Reason = reason
	return artifact
}

func pinnedModuleArtifact() ReaderRetainedArtifact {
	artifact := ReaderRetainedArtifact{
		Stage: ReaderDecoderStageRetainedPinned, Kind: ReaderArtifactPinnedModule,
		Ref: zstdModulePath + "@" + zstdModuleVersion, Digest: zstdModuleDigest, DigestKind: ReaderDigestModuleH1,
	}
	_, ok, reason := RetainedModuleDigest(zstdModulePath, zstdModuleVersion)
	artifact.Available = ok
	artifact.Reason = reason
	return artifact
}

func linkedModuleArtifact() ReaderRetainedArtifact {
	artifact := ReaderRetainedArtifact{
		Stage: ReaderDecoderStageNativeInProcess, Kind: ReaderArtifactPinnedModule,
		Ref: zstdModulePath + "@" + zstdModuleVersion, Digest: zstdModuleDigest, DigestKind: ReaderDigestModuleH1,
	}
	_, ok, reason := linkedModuleObservationFromBuildInfo(readBuildInfo(), zstdModulePath, zstdModuleVersion, zstdModuleDigest)
	artifact.Available = ok
	artifact.Reason = reason
	return artifact
}

func executableArtifact() ReaderRetainedArtifact {
	artifact := ReaderRetainedArtifact{Stage: ReaderDecoderStageRetainedPinned, Kind: ReaderArtifactExecutable, DigestKind: ReaderDigestExecutable}
	path, err := os.Executable()
	if err != nil {
		artifact.Ref = "running executable"
		artifact.Reason = fmt.Sprintf("cannot identify the running executable: %v", err)
		return artifact
	}
	artifact.Ref = path
	digest, ok, reason := RunningExecutableDigest()
	artifact.Digest = digest
	artifact.Available = ok
	artifact.Reason = reason
	return artifact
}

func codecExecutableArtifact() ReaderRetainedArtifact {
	artifact := ReaderRetainedArtifact{Stage: ReaderDecoderStageRetainedPinned, Kind: ReaderArtifactExecutable,
		DigestKind: ReaderDigestExecutable}
	path, err := os.Executable()
	if err != nil {
		artifact.Ref = "running executable"
		artifact.Reason = fmt.Sprintf("cannot identify the running executable: %v", err)
		return artifact
	}
	artifact.Ref = path
	digest, executableOK, executableReason := RunningExecutableDigest()
	return codecExecutableArtifactFromBuildInfo(readBuildInfo(), artifact, zstdModulePath, zstdModuleVersion,
		zstdModuleDigest, digest, executableOK, executableReason)
}

func codecExecutableArtifactFromBuildInfo(info *debug.BuildInfo, artifact ReaderRetainedArtifact,
	modulePath, moduleVersion, expectedModuleDigest, executableDigest string, executableOK bool, executableReason string) ReaderRetainedArtifact {
	_, linkedOK, linkedReason := linkedModuleObservationFromBuildInfo(info, modulePath, moduleVersion, expectedModuleDigest)
	if !linkedOK {
		artifact.Available = false
		artifact.Reason = "the running executable cannot stand in for the pinned codec: " + linkedReason
		return artifact
	}
	artifact.Digest = executableDigest
	artifact.Available = executableOK
	artifact.Reason = executableReason
	return artifact
}

func artifactState(artifacts []ReaderRetainedArtifact) (string, string) {
	if len(artifacts) == 0 {
		return ReaderClosureStateUnavailable, "no retained decoder or rebuild path is declared"
	}
	for _, artifact := range artifacts {
		if artifact.Available {
			return ReaderClosureStateAvailable, ""
		}
	}
	reason := artifacts[0].Reason
	if reason == "" {
		reason = "no declared decoder artifact was observable in this build"
	}
	return ReaderClosureStateUnavailable, reason
}

// SourceSetDigest hashes the retained source files named by repo-relative
// paths. It returns ok=false with a reason when the source tree is not present
// beside this build, because an installed binary must report what it cannot
// verify instead of inventing a digest.
func SourceSetDigest(refs ...string) (string, bool, string) {
	if len(refs) == 0 {
		return "", false, "no retained source reference is declared"
	}
	root, ok := readerSourceRoot()
	if !ok {
		return "", false, "the source tree location is unavailable in this build"
	}
	digest, err := sourceSetDigestAt(root, refs...)
	if err != nil {
		return "", false, err.Error()
	}
	return digest, true, ""
}

func sourceSetDigestAt(root string, refs ...string) (string, error) {
	sorted := append([]string(nil), refs...)
	sort.Strings(sorted)
	hasher := sha256.New()
	_, _ = hasher.Write([]byte("restoreweave-reader-source-set-v1\x00"))
	for _, ref := range sorted {
		payload, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(ref)))
		if err != nil {
			return "", fmt.Errorf("read retained source %s: %w", ref, err)
		}
		fileDigest := sha256.Sum256(payload)
		_, _ = hasher.Write([]byte(ref))
		_, _ = hasher.Write([]byte{0})
		_, _ = hasher.Write(fileDigest[:])
		_, _ = hasher.Write([]byte{'\n'})
	}
	return "sha256:" + hex.EncodeToString(hasher.Sum(nil)), nil
}

// readerSourceRoot locates the checkout root from this file's compiled path.
// Trimmed builds report a relative path, so the result is best-effort and
// always second-guessed by SourceSetDigest's error path.
func readerSourceRoot() (string, bool) {
	_, file, _, ok := runtime.Caller(0)
	if !ok || !filepath.IsAbs(file) {
		return "", false
	}
	// <root>/server/internal/repository/reader_closure.go
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..")), true
}

// RetainedModuleDigest reports the digest of the pinned decoder module bytes this
// checkout retains: the go.sum checksum recorded for the pinned version. The
// recorded digest is the retention claim; it is not weakened by a build that
// reports no linked-module information, and a build that reports a different
// linked version is a mismatch the reader must continue past rather than
// decode with.
func RetainedModuleDigest(path, version string) (string, bool, string) {
	if path == "" || version == "" {
		return "", false, "no pinned module is declared"
	}
	root, found := readerSourceRoot()
	if !found {
		return "", false, "the checkout root is unavailable in this build"
	}
	payload, err := os.ReadFile(filepath.Join(root, "go.sum"))
	if err != nil {
		return "", false, fmt.Sprintf("cannot read the retained go.sum checksums: %v", err)
	}
	prefix := path + " " + version + " "
	digest := ""
	for _, line := range strings.Split(string(payload), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, prefix) || !strings.Contains(line, "h1:") {
			continue
		}
		digest = line[len(prefix):]
	}
	if digest == "" {
		return "", false, fmt.Sprintf("go.sum records no checksum for %s@%s", path, version)
	}
	if path == zstdModulePath && zstdModuleDigest != "" && digest != zstdModuleDigest {
		// The declaration records the bytes a stored frame depends on. A
		// different checksum beside the same version means the retention claim
		// and the checkout disagree, so the reader must not treat these bytes
		// as the declared decoder.
		return digest, false, fmt.Sprintf("checkout checksum %s no longer matches the recorded decoder digest %s for %s@%s", digest, zstdModuleDigest, path, version)
	}
	if info := readBuildInfo(); info != nil {
		linkedDigest, linkedOK, linkedReason := linkedModuleObservationFromBuildInfo(info, path, version, digest)
		if linkedOK {
			return digest, true, ""
		}
		if !strings.Contains(linkedReason, "no linked module dependency") {
			return linkedDigest, false, linkedReason
		}
	}
	return digest, true, ""
}

// LinkedModuleDigest reports the digest recorded for the module version this
// build actually linked. Replacements and mismatched versions/checksums are
// rejected. A build without dependency information reports nothing here
// instead of guessing.
func LinkedModuleDigest(path, version string) (string, bool, string) {
	expected := ""
	if path == zstdModulePath && version == zstdModuleVersion {
		expected = zstdModuleDigest
	}
	return linkedModuleObservationFromBuildInfo(readBuildInfo(), path, version, expected)
}

func readBuildInfo() *debug.BuildInfo {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return nil
	}
	return info
}

// linkedModuleObservationFromBuildInfo is the pure check for the exact module
// selected by the Go linker. The expected checksum comes from the frozen
// dependency declaration, never from the BuildInfo being inspected.
func linkedModuleObservationFromBuildInfo(info *debug.BuildInfo, path, version, expectedDigest string) (string, bool, string) {
	if info == nil {
		return "", false, "this build does not report linked module information"
	}
	var match *debug.Module
	for _, dependency := range info.Deps {
		if dependency == nil || dependency.Path != path {
			continue
		}
		if match != nil {
			return "", false, fmt.Sprintf("build information contains multiple linked entries for module %s", path)
		}
		match = dependency
	}
	if match == nil {
		return "", false, fmt.Sprintf("no linked module dependency is recorded for %s", path)
	}
	if match.Replace != nil {
		return match.Sum, false, fmt.Sprintf("linked module %s@%s is replaced by %s@%s", path, match.Version, match.Replace.Path, match.Replace.Version)
	}
	if match.Version != version {
		return match.Sum, false, fmt.Sprintf("linked module %s@%s differs from the pinned %s@%s", path, match.Version, path, version)
	}
	if match.Sum == "" {
		return "", false, fmt.Sprintf("linked module %s@%s has no checksum", path, version)
	}
	if expectedDigest != "" && match.Sum != expectedDigest {
		return match.Sum, false, fmt.Sprintf("linked checksum %s does not match the declared decoder digest %s for %s@%s", match.Sum, expectedDigest, path, version)
	}
	return match.Sum, true, ""
}

// RunningExecutableDigest hashes the executable that is answering, which is the
// decoder a caller is trusting when it uses the in-process stage. The result is
// cached: the executable of a running process cannot change.
func RunningExecutableDigest() (string, bool, string) {
	executableDigestOnce.Do(func() {
		path, err := os.Executable()
		if err != nil {
			executableDigestReason = fmt.Sprintf("cannot identify the running executable: %v", err)
			return
		}
		payload, err := os.ReadFile(path)
		if err != nil {
			executableDigestReason = fmt.Sprintf("cannot read the running executable: %v", err)
			return
		}
		digest := sha256.Sum256(payload)
		executableDigest = "sha256:" + hex.EncodeToString(digest[:])
		executableDigestOK = true
	})
	return executableDigest, executableDigestOK, executableDigestReason
}

var (
	executableDigestOnce   sync.Once
	executableDigest       string
	executableDigestOK     bool
	executableDigestReason string
)

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
