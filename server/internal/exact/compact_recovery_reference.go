package exact

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/ailiheizi/cairn/server/internal/repository"
)

// RecoveryReferenceSchemaV3 selects existing signed repository records without
// copying their complete prepared/fact bodies into the independent artifact.
// Restore Manifest section 20.1 fixes this version's shape and prefix semantics.
const RecoveryReferenceSchemaV3 = "org.cairn.recovery-reference.v3"

// ErrRecoveryReferenceTooLarge identifies only a v2/v3 artifact-size refusal.
// Generic export may select v3 after this error, never after an auth/read error.
var ErrRecoveryReferenceTooLarge = errors.New("RECOVERY_REFERENCE_TOO_LARGE")

// RecoveryReferenceSizeError reports the final canonical artifact size. It does
// not change the existing reader cap or authorize splitting a placed record.
type RecoveryReferenceSizeError struct {
	SerializedBytes int64
	LimitBytes      int64
}

func (e *RecoveryReferenceSizeError) Error() string {
	return fmt.Sprintf("recovery reference exceeds %d bytes: serialized %d", e.LimitBytes, e.SerializedBytes)
}

func (e *RecoveryReferenceSizeError) Unwrap() error { return ErrRecoveryReferenceTooLarge }

// RecoveryRecordDescriptor names exact existing bytes under a fixed record role.
// The prepared descriptor must use RecordPreparedClosure and the commit's digest.
type RecoveryRecordDescriptor struct {
	RecordRole   repository.RecordRole `json:"record_role"`
	RecordDigest string                `json:"record_digest"`
}

// RecoveryFactDescriptor pins one existing fact successor. The ordered list
// includes sequence one through the exported head, with no skipped predecessor.
type RecoveryFactDescriptor struct {
	RecordRole               repository.RecordRole `json:"record_role"`
	RecordDigest             string                `json:"record_digest"`
	ClosureDigest            string                `json:"closure_digest"`
	ClosureSequence          uint64                `json:"closure_sequence"`
	PredecessorClosureDigest string                `json:"predecessor_closure_digest"`
}

// RecoveryReferenceV3 is a bounded selector, not a trust root, record rewrite,
// or second metadata authority. Every referenced record still requires the
// repository plus an independently supplied public anchor for admission.
type RecoveryReferenceV3 struct {
	Schema                     string                     `json:"schema"`
	SnapshotRef                string                     `json:"snapshot_ref"`
	PublicationDomain          string                     `json:"publication_domain"`
	Repository                 RecoveryRepositoryBinding  `json:"repository"`
	RequiredTrustAnchor        RecoveryTrustAnchorBinding `json:"required_trust_anchor"`
	PublicationCommitDigest    string                     `json:"publication_commit_digest"`
	PublicationCommit          PublicationCommitRecord    `json:"publication_commit"`
	PreparedClosure            RecoveryRecordDescriptor   `json:"prepared_closure"`
	FactHealth                 string                     `json:"fact_health"`
	PortableFactClosures       []RecoveryFactDescriptor   `json:"portable_fact_closures"`
	RequiredReaderDependencies []string                   `json:"required_reader_dependencies"`
	CriticalExtensions         []string                   `json:"critical_extensions"`
	OptionalExtensions         json.RawMessage            `json:"optional_extensions"`
	SelfDigest                 string                     `json:"self_digest,omitempty"`
}

// recoveryArtifactData is transient encoding/output metadata. All checks and
// totals are complete before a create-new output file may be opened.
type recoveryArtifactData struct {
	Payload        []byte
	Schema         string
	SnapshotRef    string
	ManifestDigest string
	Files          int
	Bytes          int64
}

// Digest returns the self digest for the canonical v3 reference with the
// self_digest field omitted, matching the existing v2 reference convention.
func (reference RecoveryReferenceV3) Digest() (string, error) {
	return reference.digest()
}

func (reference RecoveryReferenceV3) digest() (string, error) {
	reference.SelfDigest = ""
	if err := reference.validateShape(); err != nil {
		return "", err
	}
	payload, err := CanonicalJSON(reference)
	if err != nil {
		return "", err
	}
	return DigestBytes(payload), nil
}

func (reference RecoveryReferenceV3) validateShape() error {
	if reference.Schema != RecoveryReferenceSchemaV3 || strings.TrimSpace(reference.SnapshotRef) == "" || strings.TrimSpace(reference.PublicationDomain) == "" {
		return fmt.Errorf("%w: compact recovery reference schema or identity is invalid", ErrRecoveryRecordInvalid)
	}
	for name, value := range map[string]string{
		"repository id": reference.Repository.RepositoryID, "repository profile": reference.Repository.Profile,
		"compression profile": reference.Repository.Compression, "anchor domain": reference.RequiredTrustAnchor.PublicationDomain,
		"anchor key id": reference.RequiredTrustAnchor.KeyID, "anchor digest": reference.RequiredTrustAnchor.Digest,
		"publication commit digest": reference.PublicationCommitDigest, "prepared closure digest": reference.PreparedClosure.RecordDigest,
	} {
		if strings.TrimSpace(value) == "" || strings.ContainsRune(value, 0) {
			return fmt.Errorf("%w: %s is required", ErrRecoveryRecordInvalid, name)
		}
	}
	if reference.RequiredTrustAnchor.PublicationDomain != reference.PublicationDomain ||
		!validExactContentID(reference.RequiredTrustAnchor.Digest) ||
		!validExactContentID(reference.PublicationCommitDigest) ||
		!validExactContentID(reference.PreparedClosure.RecordDigest) ||
		reference.PreparedClosure.RecordRole != repository.RecordPreparedClosure {
		return fmt.Errorf("%w: compact recovery reference digest or role binding is invalid", ErrRecoveryRecordInvalid)
	}
	if reference.FactHealth != RecoveryFactHealthComplete && reference.FactHealth != RecoveryFactHealthIncomplete {
		return fmt.Errorf("%w: compact recovery fact health is invalid", ErrRecoveryRecordInvalid)
	}
	if reference.PortableFactClosures == nil || reference.RequiredReaderDependencies == nil || reference.CriticalExtensions == nil || reference.OptionalExtensions == nil || !json.Valid(reference.OptionalExtensions) {
		return fmt.Errorf("%w: compact recovery extensions or dependencies are invalid", ErrRecoveryRecordInvalid)
	}
	if err := validateRecoveryExtensions(reference.CriticalExtensions, reference.OptionalExtensions); err != nil {
		return err
	}
	commitDigest, err := reference.PublicationCommit.Digest()
	if err != nil || commitDigest != reference.PublicationCommitDigest {
		return errors.New("compact recovery publication commit digest mismatch")
	}
	commit := reference.PublicationCommit
	if commit.SnapshotRef != reference.SnapshotRef || commit.PublicationDomain != reference.PublicationDomain ||
		commit.PreparedObjectDigest != reference.PreparedClosure.RecordDigest ||
		commit.TargetIdentity != reference.Repository.RepositoryID {
		return errors.New("compact recovery reference publication binding mismatch")
	}
	if len(reference.PortableFactClosures) == 0 {
		if reference.FactHealth != RecoveryFactHealthIncomplete {
			return errors.New("complete compact recovery fact health requires a portable fact closure")
		}
	} else if reference.FactHealth != RecoveryFactHealthComplete {
		return errors.New("portable fact descriptors require complete compact recovery fact health")
	}
	for index, fact := range reference.PortableFactClosures {
		if fact.RecordRole != repository.RecordPortableFactClosure || !validExactContentID(fact.RecordDigest) || !validExactContentID(fact.ClosureDigest) || fact.ClosureSequence != uint64(index+1) {
			return fmt.Errorf("compact recovery fact descriptor %d has invalid role, digest, or sequence", index+1)
		}
		if index == 0 {
			if fact.PredecessorClosureDigest != "" {
				return errors.New("compact recovery fact sequence one has a predecessor")
			}
		} else if !validExactContentID(fact.PredecessorClosureDigest) || fact.PredecessorClosureDigest != reference.PortableFactClosures[index-1].ClosureDigest {
			return fmt.Errorf("compact recovery fact descriptor %d has an invalid predecessor", index+1)
		}
	}
	return nil
}

// MarshalCompactRecoveryReference returns canonical bounded v3 JSON with a
// self digest. The only enforced artifact limit is the existing reader cap.
func MarshalCompactRecoveryReference(reference RecoveryReferenceV3) ([]byte, error) {
	reference.SelfDigest = ""
	digest, err := reference.digest()
	if err != nil {
		return nil, err
	}
	reference.SelfDigest = digest
	payload, err := CanonicalJSON(reference)
	if err != nil {
		return nil, err
	}
	if int64(len(payload)) > portableRecordReadLimit {
		return nil, &RecoveryReferenceSizeError{SerializedBytes: int64(len(payload)), LimitBytes: portableRecordReadLimit}
	}
	return payload, nil
}

// DecodeCompactRecoveryReference accepts exactly one bounded v3 artifact and
// rejects unknown top-level fields before any repository reads occur.
func DecodeCompactRecoveryReference(payload []byte) (RecoveryReferenceV3, error) {
	var reference RecoveryReferenceV3
	if len(payload) == 0 || int64(len(payload)) > portableRecordReadLimit {
		return reference, fmt.Errorf("compact recovery reference exceeds %d bytes", portableRecordReadLimit)
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&reference); err != nil {
		return reference, fmt.Errorf("decode compact recovery reference: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return reference, errors.New("compact recovery reference contains more than one JSON value")
		}
		return reference, err
	}
	if err := reference.validateShape(); err != nil {
		return reference, err
	}
	digest, err := reference.digest()
	if err != nil {
		return reference, err
	}
	if reference.SelfDigest == "" || reference.SelfDigest != digest {
		return reference, errors.New("compact recovery reference self digest mismatch")
	}
	return reference, nil
}

// ValidateAgainstRepository verifies this selector with only the repository
// and an independently supplied public anchor. It never consults SQLite or a
// signing identity.
func (reference RecoveryReferenceV3) ValidateAgainstRepository(ctx context.Context, repo repository.Driver, anchor TrustAnchor) error {
	_, _, err := reference.validateAgainstRepository(ctx, repo, anchor)
	return err
}

func (reference RecoveryReferenceV3) validateAgainstRepository(ctx context.Context, repo repository.Driver, anchor TrustAnchor) (Manifest, PreparedClosureEnvelope, error) {
	var emptyManifest Manifest
	var emptyPrepared PreparedClosureEnvelope
	if repo == nil {
		return emptyManifest, emptyPrepared, errors.New("repository is required")
	}
	if err := ctx.Err(); err != nil {
		return emptyManifest, emptyPrepared, err
	}
	if err := anchor.validate(); err != nil {
		return emptyManifest, emptyPrepared, err
	}
	if err := reference.validateShape(); err != nil {
		return emptyManifest, emptyPrepared, err
	}
	selfDigest, err := reference.digest()
	if err != nil {
		return emptyManifest, emptyPrepared, err
	}
	if reference.SelfDigest == "" || reference.SelfDigest != selfDigest {
		return emptyManifest, emptyPrepared, errors.New("compact recovery reference self digest mismatch")
	}
	anchorDigest, err := DigestCanonicalJSON(anchor)
	if err != nil {
		return emptyManifest, emptyPrepared, err
	}
	if reference.RequiredTrustAnchor.Digest != anchorDigest || reference.RequiredTrustAnchor.KeyID != anchor.KeyID || reference.RequiredTrustAnchor.PublicationDomain != anchor.PublicationDomain {
		return emptyManifest, emptyPrepared, fmt.Errorf("%w: supplied anchor does not match compact recovery reference", ErrRecoveryTrustAnchor)
	}
	driver, ok := repo.(repository.RecordDriver)
	if !ok {
		return emptyManifest, emptyPrepared, errors.New("repository does not support recovery records")
	}
	profile := repository.DescribeProfile(repo)
	if reference.Repository.RepositoryID != driver.RepositoryIdentity() || reference.Repository.Profile != profile.Repository || reference.Repository.Compression != profile.Compression {
		return emptyManifest, emptyPrepared, errors.New("compact recovery reference repository binding mismatch")
	}
	if reference.PublicationCommit.TargetIdentity != driver.RepositoryIdentity() {
		return emptyManifest, emptyPrepared, errors.New("publication target identity differs from compact recovery repository")
	}
	commits, err := listCommitMarkers(ctx, driver, anchor, reference.PublicationDomain)
	if err != nil {
		return emptyManifest, emptyPrepared, fmt.Errorf("authenticated publication lineage is unavailable: %w", err)
	}
	committed := false
	for _, candidate := range commits {
		if candidate.CommitDigest == reference.PublicationCommitDigest {
			committed = true
			break
		}
	}
	if !committed {
		return emptyManifest, emptyPrepared, errors.New("referenced publication commit is not in the authenticated lineage")
	}
	commitPayload, err := readRecoveryRecord(ctx, driver, repository.RecordPublicationCommit, reference.PublicationCommitDigest)
	if err != nil {
		return emptyManifest, emptyPrepared, err
	}
	canonicalCommit, err := CanonicalJSON(reference.PublicationCommit)
	if err != nil || !bytes.Equal(commitPayload, canonicalCommit) {
		return emptyManifest, emptyPrepared, errors.New("publication commit bytes differ from compact recovery reference")
	}
	if err := reference.PublicationCommit.Verify(anchor); err != nil {
		return emptyManifest, emptyPrepared, err
	}
	preparedPayload, err := readRecoveryRecord(ctx, driver, repository.RecordPreparedClosure, reference.PreparedClosure.RecordDigest)
	if err != nil {
		return emptyManifest, emptyPrepared, err
	}
	var prepared PreparedClosureEnvelope
	if err := decodeStrictRecord(preparedPayload, &prepared); err != nil {
		return emptyManifest, emptyPrepared, err
	}
	canonicalPrepared, err := CanonicalJSON(prepared)
	if err != nil || !bytes.Equal(preparedPayload, canonicalPrepared) {
		return emptyManifest, emptyPrepared, errors.New("prepared closure bytes are not canonical")
	}
	manifest, err := validatePreparedEnvelope(ctx, driver, anchor, reference.PublicationCommit, prepared, int64(len(preparedPayload)))
	if err != nil {
		return emptyManifest, emptyPrepared, err
	}
	parentRef := RecoveryReference{
		PublicationCommitDigest: reference.PublicationCommitDigest,
		PublicationCommit:       reference.PublicationCommit,
		PreparedClosureDigest:   reference.PreparedClosure.RecordDigest,
		PreparedClosure:         prepared,
	}
	if err := validateReferencePublicationBinding(parentRef, &manifest); err != nil {
		return emptyManifest, emptyPrepared, err
	}
	for _, object := range prepared.PayloadReceipt.Objects {
		if err := verifyExactObjectReadback(ctx, repo, object.ContentID, object.LogicalBytes); err != nil {
			return emptyManifest, emptyPrepared, fmt.Errorf("payload object %s: %w", object.ContentID, err)
		}
	}
	matched := 0
	var selectedDependencies []string
	err = visitPortableFactClosures(ctx, repo, driver, anchor, reference.PublicationDomain, reference.PublicationCommitDigest, func(envelope PortableFactClosureEnvelope, digest string) error {
		index := matched
		if index >= len(reference.PortableFactClosures) {
			return nil // A valid suffix is authenticated but never adopted.
		}
		descriptor := reference.PortableFactClosures[index]
		closureDigest, digestErr := envelope.Closure.Digest()
		if digestErr != nil {
			return digestErr
		}
		if descriptor.RecordRole != repository.RecordPortableFactClosure || descriptor.RecordDigest != digest || descriptor.ClosureDigest != closureDigest || descriptor.ClosureSequence != envelope.Closure.ClosureSequence || descriptor.PredecessorClosureDigest != envelope.Closure.PredecessorClosureDigest {
			return fmt.Errorf("compact recovery fact prefix differs at sequence %d", index+1)
		}
		if index == len(reference.PortableFactClosures)-1 {
			selectedDependencies = append([]string(nil), envelope.Closure.RequiredReaderDependencies...)
		}
		matched++
		return nil
	})
	if err != nil {
		return emptyManifest, emptyPrepared, err
	}
	if matched != len(reference.PortableFactClosures) {
		return emptyManifest, emptyPrepared, errors.New("compact recovery fact prefix is missing from repository")
	}
	if len(reference.PortableFactClosures) == 0 {
		selectedDependencies = portableFactReaderDependencies(repo)
	}
	if !sameStrings(reference.RequiredReaderDependencies, selectedDependencies) {
		return emptyManifest, emptyPrepared, errors.New("compact recovery reader dependencies differ from selected fact prefix")
	}
	return manifest, prepared, nil
}

// buildRecoveryReferenceArtifact prefers the byte-compatible v2 reference and
// falls back to the root-defined descriptor-only v3 only for a typed v2 size
// refusal. Discovery validates every selected record before either output is
// returned and retains at most one bounded v2 candidate.
func (s *Service) buildRecoveryReferenceArtifact(ctx context.Context, snapshotRef string) (recoveryArtifactData, error) {
	var empty recoveryArtifactData
	if err := s.requireRepository(); err != nil {
		return empty, err
	}
	if strings.TrimSpace(snapshotRef) == "" {
		return empty, errors.New("snapshot reference is required")
	}
	if !s.signedPublicationEnabled() || s.TrustAnchor == nil || strings.TrimSpace(s.PublicationDomain) == "" {
		return empty, errors.New("recovery reference requires signed publication, trust anchor, and publication domain")
	}
	driver, err := s.publicationRecordDriver()
	if err != nil {
		return empty, err
	}
	markers, err := listCommitMarkers(ctx, driver, *s.TrustAnchor, s.PublicationDomain)
	if err != nil {
		return empty, err
	}
	var selected *committedPublication
	for i := range markers {
		preparedPayload, err := readRecord(ctx, driver, repository.RecordPreparedClosure, markers[i].Commit.PreparedObjectDigest)
		if err != nil {
			return empty, err
		}
		var prepared PreparedClosureEnvelope
		if err := decodeStrictRecord(preparedPayload, &prepared); err != nil {
			return empty, fmt.Errorf("decode prepared closure %s: %w", markers[i].Commit.PreparedObjectDigest, err)
		}
		manifest, err := validatePreparedEnvelope(ctx, driver, *s.TrustAnchor, markers[i].Commit, prepared, int64(len(preparedPayload)))
		if err != nil {
			return empty, fmt.Errorf("validate publication %s: %w", markers[i].CommitDigest, err)
		}
		if markers[i].Commit.SnapshotRef == snapshotRef {
			if selected != nil {
				return empty, fmt.Errorf("conflicting committed publications for snapshot %s", snapshotRef)
			}
			candidate := markers[i]
			candidate.Prepared = prepared
			candidate.Manifest = manifest
			selected = &candidate
		}
	}
	if selected == nil {
		return empty, fmt.Errorf("committed snapshot %s is unavailable", snapshotRef)
	}
	anchorDigest, err := DigestCanonicalJSON(*s.TrustAnchor)
	if err != nil {
		return empty, err
	}
	profile := repository.DescribeProfile(s.Repo)
	v2 := RecoveryReference{
		Schema: RecoveryReferenceSchemaV2, SnapshotRef: snapshotRef, PublicationDomain: s.PublicationDomain,
		Repository:              RecoveryRepositoryBinding{RepositoryID: driver.RepositoryIdentity(), Profile: profile.Repository, Compression: profile.Compression},
		RequiredTrustAnchor:     RecoveryTrustAnchorBinding{PublicationDomain: s.PublicationDomain, KeyID: s.TrustAnchor.KeyID, Digest: anchorDigest},
		PublicationCommitDigest: selected.CommitDigest, PublicationCommit: selected.Commit,
		PreparedClosureDigest: selected.Commit.PreparedObjectDigest, PreparedClosure: selected.Prepared,
		FactHealth: RecoveryFactHealthIncomplete, PortableFactClosures: []RecoveryFactClosureReference{},
		RequiredReaderDependencies: portableFactReaderDependencies(s.Repo), CriticalExtensions: []string{}, OptionalExtensions: json.RawMessage(`{}`),
	}
	v3 := RecoveryReferenceV3{
		Schema: RecoveryReferenceSchemaV3, SnapshotRef: snapshotRef, PublicationDomain: s.PublicationDomain,
		Repository: v2.Repository, RequiredTrustAnchor: v2.RequiredTrustAnchor,
		PublicationCommitDigest: selected.CommitDigest, PublicationCommit: selected.Commit,
		PreparedClosure: RecoveryRecordDescriptor{RecordRole: repository.RecordPreparedClosure, RecordDigest: selected.Commit.PreparedObjectDigest},
		FactHealth:      RecoveryFactHealthIncomplete, PortableFactClosures: []RecoveryFactDescriptor{},
		RequiredReaderDependencies: append([]string{}, v2.RequiredReaderDependencies...), CriticalExtensions: []string{}, OptionalExtensions: json.RawMessage(`{}`),
	}
	minimumV2Size, err := recoveryReferenceSize(v2, nil, nil)
	if err != nil {
		return empty, err
	}
	keepV2 := minimumV2Size <= portableRecordReadLimit
	elementLengths := make([]int, 0)
	var v3DescriptorBytes int64
	var v3DescriptorCount int
	v3TooLarge := false
	err = visitPortableFactClosures(ctx, s.Repo, driver, *s.TrustAnchor, s.PublicationDomain, selected.CommitDigest, func(envelope PortableFactClosureEnvelope, recordDigest string) error {
		placed := placedFactEnvelope(envelope)
		canonical, err := CanonicalJSON(placed)
		if err != nil {
			return err
		}
		if DigestBytes(canonical) != recordDigest {
			return errors.New("portable fact closure bytes are not canonical")
		}
		closureDigest, err := envelope.Closure.Digest()
		if err != nil {
			return err
		}
		descriptor := RecoveryFactDescriptor{
			RecordRole: repository.RecordPortableFactClosure, RecordDigest: recordDigest,
			ClosureDigest: closureDigest, ClosureSequence: envelope.Closure.ClosureSequence,
			PredecessorClosureDigest: envelope.Closure.PredecessorClosureDigest,
		}
		descriptorBytes, err := CanonicalJSON(descriptor)
		if err != nil {
			return err
		}
		v3DescriptorBytes += int64(len(descriptorBytes))
		v3DescriptorCount++
		v3.FactHealth = RecoveryFactHealthComplete
		v3.RequiredReaderDependencies = append(v3.RequiredReaderDependencies[:0], envelope.Closure.RequiredReaderDependencies...)
		if !v3TooLarge {
			v3.PortableFactClosures = append(v3.PortableFactClosures, descriptor)
			minimum, err := compactRecoveryReferenceSize(v3, []string{}, v3DescriptorBytes, v3DescriptorCount)
			if err != nil {
				return err
			}
			if minimum > portableRecordReadLimit {
				v3.PortableFactClosures = []RecoveryFactDescriptor{}
				v3TooLarge = true
			}
		}
		v2.RequiredReaderDependencies = append(v2.RequiredReaderDependencies[:0], envelope.Closure.RequiredReaderDependencies...)
		v2.FactHealth = RecoveryFactHealthComplete
		fact := RecoveryFactClosureReference{RecordDigest: recordDigest, ClosureDigest: closureDigest, Envelope: placed}
		factBytes, err := CanonicalJSON(fact)
		if err != nil {
			return err
		}
		elementLengths = append(elementLengths, len(factBytes))
		if keepV2 {
			v2.PortableFactClosures = append(v2.PortableFactClosures, fact)
			minimum, err := recoveryReferenceSize(v2, []string{}, elementLengths)
			if err != nil {
				return err
			}
			if minimum > portableRecordReadLimit {
				v2.PortableFactClosures = nil // Release every historical body immediately.
				keepV2 = false
			}
		}
		return nil
	})
	if err != nil {
		return empty, err
	}
	var payload []byte
	if keepV2 {
		payload, err = MarshalRecoveryReference(v2)
		if err == nil {
			manifest, validationErr := v2.validateAgainstRepository(ctx, s.Repo, *s.TrustAnchor)
			if validationErr != nil {
				return empty, validationErr
			}
			files, size := manifestFileTotals(manifest)
			return recoveryArtifactData{Payload: payload, Schema: RecoveryReferenceSchemaV2, SnapshotRef: snapshotRef, ManifestDigest: manifest.ManifestDigest, Files: files, Bytes: size}, nil
		}
		if !errors.Is(err, ErrRecoveryReferenceTooLarge) {
			return empty, err
		}
	} else {
		finalSize, sizeErr := recoveryReferenceSize(v2, v2.RequiredReaderDependencies, elementLengths)
		if sizeErr != nil {
			return empty, sizeErr
		}
		if finalSize <= portableRecordReadLimit {
			return empty, errors.New("bounded v2 candidate was released before its final size exceeded the reader limit")
		}
		err = &RecoveryReferenceSizeError{SerializedBytes: finalSize, LimitBytes: portableRecordReadLimit}
	}
	if !errors.Is(err, ErrRecoveryReferenceTooLarge) {
		return empty, err
	}
	if v3TooLarge {
		finalSize, sizeErr := compactRecoveryReferenceSize(v3, v3.RequiredReaderDependencies, v3DescriptorBytes, v3DescriptorCount)
		if sizeErr != nil {
			return empty, sizeErr
		}
		if finalSize <= portableRecordReadLimit {
			return empty, errors.New("compact descriptor set was released before its final size exceeded the reader limit")
		}
		return empty, &RecoveryReferenceSizeError{SerializedBytes: finalSize, LimitBytes: portableRecordReadLimit}
	}
	payload, err = MarshalCompactRecoveryReference(v3)
	if err != nil {
		return empty, err
	}
	validatedV3, err := DecodeCompactRecoveryReference(payload)
	if err != nil {
		return empty, err
	}
	manifest, _, err := validatedV3.validateAgainstRepository(ctx, s.Repo, *s.TrustAnchor)
	if err != nil {
		return empty, err
	}
	files, size := manifestFileTotals(manifest)
	return recoveryArtifactData{Payload: payload, Schema: RecoveryReferenceSchemaV3, SnapshotRef: snapshotRef, ManifestDigest: manifest.ManifestDigest, Files: files, Bytes: size}, nil
}

// recoveryReferenceSize returns the exact canonical byte size for a v2
// reference when fact element encodings are known. An empty dependency list is
// useful as a strict lower bound while deciding whether to retain v2 bodies.
func recoveryReferenceSize(reference RecoveryReference, dependencies []string, elementLengths []int) (int64, error) {
	copy := reference
	copy.SelfDigest = "sha256:" + strings.Repeat("0", 64)
	copy.PortableFactClosures = []RecoveryFactClosureReference{}
	copy.RequiredReaderDependencies = append([]string{}, dependencies...)
	base, err := CanonicalJSON(copy)
	if err != nil {
		return 0, err
	}
	total := int64(len(base))
	for _, length := range elementLengths {
		total += int64(length)
	}
	if len(elementLengths) > 1 {
		total += int64(len(elementLengths) - 1)
	}
	return total, nil
}

func compactRecoveryReferenceSize(reference RecoveryReferenceV3, dependencies []string, elementBytes int64, elementCount int) (int64, error) {
	copy := reference
	copy.SelfDigest = "sha256:" + strings.Repeat("0", 64)
	copy.PortableFactClosures = []RecoveryFactDescriptor{}
	copy.RequiredReaderDependencies = append([]string{}, dependencies...)
	base, err := CanonicalJSON(copy)
	if err != nil {
		return 0, err
	}
	total := int64(len(base)) + elementBytes
	if elementCount > 1 {
		total += int64(elementCount - 1)
	}
	return total, nil
}
