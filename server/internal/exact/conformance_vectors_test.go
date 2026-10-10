package exact

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/server/internal/repository"
)

// Conformance vectors are the executable form of "any independent reader can
// verify this record". Every vector is generated from the production signing
// and verification path with a fixed key seed, a fixed timestamp, and fixed
// digest patterns, so regenerating the vectors from the current code must
// reproduce the committed bytes exactly. A changed canonicalization,
// signature domain, schema rule, or reader-dependency name therefore fails
// this test instead of drifting silently.
const (
	conformanceVectorSchema = "org.cairn.conformance-vector.v1"
	conformanceVectorDir    = "testdata/conformance"
	conformanceWriteEnv     = "CAIRN_WRITE_CONFORMANCE_VECTORS"
	conformanceDomain       = "workspace:conformance"
)

// conformanceSeedA is the fixed signing seed every accept vector is signed
// with. conformanceSeedB is a second independent identity used only to prove
// that a record signed by another writer is rejected by this anchor.
var conformanceSeedA = bytes.Repeat([]byte{0x5a}, 64)
var conformanceSeedB = bytes.Repeat([]byte{0x3c}, 64)

// Record families this checkout emits or must keep readable.
const (
	conformanceFamilyTrustAnchor         = "TRUST_ANCHOR"
	conformanceFamilyPreparedClosure     = "PREPARED_CLOSURE"
	conformanceFamilyPublicationCommit   = "PUBLICATION_COMMIT"
	conformanceFamilyProcessorAttempt    = "PROCESSOR_ATTEMPT_CLOSURE"
	conformanceFamilyPortableFactClosure = "PORTABLE_FACT_CLOSURE"
)

// Mutations applied to a generated record to produce a rejection vector. The
// mutation string is recorded in the vector so a reader can see exactly what
// changed, and every mutation is applied after signing, which is why a
// post-signature structural change is rejected by the record's own validator
// before any signature or payload trust is considered.
const (
	conformanceMutationNone                   = ""
	conformanceMutationSignatureBitFlip       = "signature-bit-flip"
	conformanceMutationFieldTamper            = "post-signature-field-tamper"
	conformanceMutationMissingPreparedReceipt = "post-signature-missing-prepared-receipt"
	conformanceMutationCriticalExtension      = "post-signature-critical-extension"
	conformanceMutationUndeclaredDependency   = "post-signature-undeclared-reader-dependency"
	conformanceMutationSuccessorWithoutSeq    = "post-signature-successor-without-sequence"
	conformanceMutationWrongAnchor            = "verify-with-wrong-anchor"
	conformanceMutationAnchorPublicKeyDigest  = "anchor-public-key-digest"
)

const (
	conformanceExpectAccept = "ACCEPT"
	conformanceExpectReject = "REJECT"
)

type conformanceVector struct {
	Schema            string `json:"schema"`
	Name              string `json:"name"`
	Family            string `json:"family"`
	RecordSchema      string `json:"record_schema"`
	EmittedByCheckout bool   `json:"emitted_by_checkout"`
	Expect            string `json:"expect"`
	Mutation          string `json:"mutation,omitempty"`
	ExpectedSentinel  string `json:"expected_sentinel,omitempty"`
	ExpectedReason    string `json:"expected_reason,omitempty"`
	Notes             string `json:"notes,omitempty"`
	AnchorBase64      string `json:"anchor_base64"`
	RecordBase64      string `json:"record_base64"`
}

type conformanceGenerated struct {
	conformanceVector
	record []byte
	anchor TrustAnchor
}

func conformanceIdentity(t *testing.T, seed []byte) SigningIdentity {
	t.Helper()
	identity, err := NewSigningIdentityFromReader(bytes.NewReader(seed))
	if err != nil {
		t.Fatalf("derive conformance identity: %v", err)
	}
	return identity
}

func conformanceAnchor(t *testing.T, identity SigningIdentity) TrustAnchor {
	t.Helper()
	anchor, err := NewTrustAnchor(identity, conformanceDomain)
	if err != nil {
		t.Fatalf("derive conformance anchor: %v", err)
	}
	return anchor
}

// conformanceDigest is a fixed, well-formed content identifier for a labelled
// field. Vector digests are synthetic on purpose: the vectors prove record
// semantics, not payload contents.
func conformanceDigest(label string) string {
	sum := sha256.Sum256([]byte("cairn-conformance-vector\x00" + label))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func selectReaderDependencies(readerVersion string, override []string) []string {
	if len(override) > 0 {
		return override
	}
	return []string{
		"canonicalization:encoding/json-compact-v1",
		"repository:directory-cas-dev-v1/identity-v1",
		"cairn-reader:portable-fact-" + readerVersion,
		"signature:ed25519-v1",
	}
}

func conformanceSignedAt() time.Time {
	return time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
}

func mustCanonical(t *testing.T, value any) []byte {
	t.Helper()
	payload, err := CanonicalJSON(value)
	if err != nil {
		t.Fatalf("canonical json: %v", err)
	}
	return payload
}

func conformancePreparedClosure(t *testing.T, identity SigningIdentity) ([]byte, string) {
	t.Helper()
	record, err := SignPreparedClosure(identity, SignedPreparedClosure{
		Schema: PreparedClosureSchemaV1, SignatureDomain: RecoverySignatureDomainV1, RecordKind: PreparedClosureKind,
		PublicationID: "conformance-publication", PublicationDomain: conformanceDomain, Generation: 1,
		SnapshotRef: "snapshot-conformance", RRFRootDigest: conformanceDigest("rrf-root"),
		ManifestDigest: conformanceDigest("manifest"), PayloadReceiptDigest: conformanceDigest("payload-receipt"),
		PayloadReceiptLength: 4096, PayloadReceiptObjectCount: 3, PlanDigest: conformanceDigest("plan"),
		CaptureDigest: conformanceDigest("capture"), PolicyDigest: conformanceDigest("policy"),
		VerificationDigest: conformanceDigest("verification"), TargetIdentity: conformanceDigest("target"),
		FenceToken: 7, WriterIdentity: identity.WriterIdentity, KeyID: identity.KeyID,
		SignedAt: conformanceSignedAt(),
	})
	if err != nil {
		t.Fatalf("sign prepared closure: %v", err)
	}
	return mustCanonical(t, record), PreparedClosureSchemaV1
}

func conformancePublicationCommit(t *testing.T, identity SigningIdentity) ([]byte, string) {
	t.Helper()
	record, err := SignPublicationCommit(identity, PublicationCommitRecord{
		Schema: PublicationCommitSchemaV1, SignatureDomain: RecoverySignatureDomainV1, RecordKind: PublicationCommitKind,
		PublicationID: "conformance-publication", PublicationDomain: conformanceDomain, Generation: 1,
		SnapshotRef: "snapshot-conformance", RRFRootDigest: conformanceDigest("rrf-root"),
		ManifestDigest: conformanceDigest("manifest"), PayloadReceiptDigest: conformanceDigest("payload-receipt"),
		PayloadReceiptLength: 4096, PayloadReceiptObjectCount: 3, PlanDigest: conformanceDigest("plan"),
		CaptureDigest: conformanceDigest("capture"), PolicyDigest: conformanceDigest("policy"),
		VerificationDigest: conformanceDigest("verification"), TargetIdentity: conformanceDigest("target"),
		PreparedObjectDigest: conformanceDigest("prepared-object"), PreparedReceiptDigest: conformanceDigest("prepared-receipt"),
		FenceToken: 7, WriterIdentity: identity.WriterIdentity, KeyID: identity.KeyID,
		SignedAt: conformanceSignedAt(),
	})
	if err != nil {
		t.Fatalf("sign publication commit: %v", err)
	}
	return mustCanonical(t, record), PublicationCommitSchemaV1
}

func conformanceProcessorAttemptClosure(t *testing.T, identity SigningIdentity, schema string) ([]byte, string) {
	t.Helper()
	record := ProcessorAttemptClosureRecord{
		Schema: schema, SignatureDomain: RecoverySignatureDomainV1, RecordKind: ProcessorAttemptClosureKind,
		WorkspaceID: "workspace-conformance", PublicationID: "conformance-publication", PublicationDomain: conformanceDomain,
		SnapshotRef: "snapshot-conformance", ManifestDigest: conformanceDigest("manifest"),
		ParentCommitDigest: conformanceDigest("parent-commit"), AttemptBundleSchema: "org.cairn.processor-attempt-bundle.v1",
		AttemptBundleDigest: conformanceDigest("attempt-bundle"), AttemptBundleLength: 512, AttemptCount: 1,
		TargetIdentity: conformanceDigest("target"), WriterIdentity: identity.WriterIdentity, KeyID: identity.KeyID,
		FenceToken: 7, SignedAt: conformanceSignedAt(),
	}
	if schema == ProcessorAttemptClosureSchemaV2 {
		record.ClosureSequence = 1
	}
	signed, err := SignProcessorAttemptClosure(identity, record)
	if err != nil {
		t.Fatalf("sign processor attempt closure: %v", err)
	}
	return mustCanonical(t, signed), schema
}

// conformancePortableFactClosure signs one portable-fact closure envelope.
// readerDependencyOverride replaces the reader tuple so a vector can prove the
// reader refuses a validly signed record that names a decoder this build does
// not admit.
func conformancePortableFactClosure(t *testing.T, identity SigningIdentity, closureSchema, bundleSchema, readerVersion string, readerDependencyOverride ...string) ([]byte, string) {
	t.Helper()
	bundle := mustCanonical(t, portableFactBundle{
		Schema: bundleSchema, WorkspaceID: "workspace-conformance", SnapshotRef: "snapshot-conformance",
		Records: []portableFactRecord{}, Attachments: []portableFactAttachment{},
	})
	closureSchemaOut, envelopeSchema, err := portableFactClosureSchemas(bundleSchema)
	if err != nil {
		t.Fatal(err)
	}
	if closureSchemaOut != closureSchema {
		t.Fatalf("bundle schema %s maps to closure schema %s, want %s", bundleSchema, closureSchemaOut, closureSchema)
	}
	closure, err := SignPortableFactClosure(identity, PortableFactClosureRecord{
		Schema: closureSchema, SignatureDomain: RecoverySignatureDomainV1, RecordKind: PortableFactClosureKind,
		WorkspaceID: "workspace-conformance", PublicationID: "conformance-publication", PublicationDomain: conformanceDomain,
		SnapshotRef: "snapshot-conformance", ManifestDigest: conformanceDigest("manifest"),
		ParentCommitDigest: conformanceDigest("parent-commit"), ParentGeneration: 1, ClosureSequence: 1,
		BundleSchema: bundleSchema, BundleDigest: DigestBytes(bundle), BundleLength: int64(len(bundle)),
		RecordCount: 0, AttachmentCount: 0, TargetIdentity: conformanceDigest("target"),
		WriterIdentity: identity.WriterIdentity, KeyID: identity.KeyID, FenceToken: 7,
		RequiredReaderDependencies: selectReaderDependencies(readerVersion, readerDependencyOverride),
		CanonicalizationProfile:    "encoding/json-compact-v1", CriticalExtensions: []string{},
		OptionalExtensions: json.RawMessage(`{}`), SignedAt: conformanceSignedAt(),
	})
	if err != nil {
		t.Fatalf("sign portable fact closure: %v", err)
	}
	return mustCanonical(t, PortableFactClosureEnvelope{Schema: envelopeSchema, Closure: closure, Bundle: bundle}), closureSchema
}

func conformanceTrustAnchor(t *testing.T, anchor TrustAnchor) ([]byte, string) {
	t.Helper()
	return mustCanonical(t, anchor), RecoveryTrustAnchorSchemaV1
}

// conformanceBlueprints lists every vector this suite commits. The record
// bytes are always produced by the production builders above.
type conformanceBlueprint struct {
	name              string
	family            string
	expect            string
	mutation          string
	expectedSentinel  string
	expectedReason    string
	emittedByCheckout bool
	notes             string
	build             func(t *testing.T, identity SigningIdentity) ([]byte, string)
}

func conformanceBlueprints() []conformanceBlueprint {
	return []conformanceBlueprint{
		{
			name: conformanceFamilyTrustAnchor + "-v1-accept", family: conformanceFamilyTrustAnchor, expect: conformanceExpectAccept,
			emittedByCheckout: true,
			notes:             "independently retained public verification material; the vector carries only public key bytes and their digest",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformanceTrustAnchor(t, conformanceAnchor(t, identity))
			},
		},
		{
			name: conformanceFamilyTrustAnchor + "-v1-reject-public-key-digest", family: conformanceFamilyTrustAnchor, expect: conformanceExpectReject,
			mutation: conformanceMutationAnchorPublicKeyDigest, expectedSentinel: "ErrRecoveryTrustAnchor",
			expectedReason: "public key digest mismatch",
			notes:          "an anchor whose recorded digest does not match its public key bytes is refused before any signature is trusted",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformanceTrustAnchor(t, conformanceAnchor(t, identity))
			},
		},
		{
			name: conformanceFamilyPreparedClosure + "-v1-accept", family: conformanceFamilyPreparedClosure, expect: conformanceExpectAccept,
			emittedByCheckout: true,
			notes:             "signed pre-publication closure as this checkout emits it",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformancePreparedClosure(t, identity)
			},
		},
		{
			name: conformanceFamilyPreparedClosure + "-v1-reject-signature-bit-flip", family: conformanceFamilyPreparedClosure, expect: conformanceExpectReject,
			mutation: conformanceMutationSignatureBitFlip, expectedSentinel: "ErrRecoverySignature",
			expectedReason: "recovery record signature is invalid",
			notes:          "one bit changed inside the Ed25519 signature",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformancePreparedClosure(t, identity)
			},
		},
		{
			name: conformanceFamilyPreparedClosure + "-v1-reject-field-tamper", family: conformanceFamilyPreparedClosure, expect: conformanceExpectReject,
			mutation: conformanceMutationFieldTamper, expectedSentinel: "ErrRecoverySignature",
			expectedReason: "recovery record signature is invalid",
			notes:          "snapshot_ref changed after signing; the canonical bytes no longer match the signature",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformancePreparedClosure(t, identity)
			},
		},
		{
			name: conformanceFamilyPreparedClosure + "-v1-reject-wrong-anchor", family: conformanceFamilyPreparedClosure, expect: conformanceExpectReject,
			mutation: conformanceMutationWrongAnchor, expectedSentinel: "ErrRecoveryTrustAnchor",
			expectedReason: "signer or publication binding differs from trust anchor",
			notes:          "the same record verified against an independent writer's anchor; anchor_base64 is that other anchor",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformancePreparedClosure(t, identity)
			},
		},
		{
			name: conformanceFamilyPublicationCommit + "-v1-accept", family: conformanceFamilyPublicationCommit, expect: conformanceExpectAccept,
			emittedByCheckout: true,
			notes:             "portable logical commit point; the record deliberately has no field for its own placement receipt",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformancePublicationCommit(t, identity)
			},
		},
		{
			name: conformanceFamilyPublicationCommit + "-v1-reject-signature-bit-flip", family: conformanceFamilyPublicationCommit, expect: conformanceExpectReject,
			mutation: conformanceMutationSignatureBitFlip, expectedSentinel: "ErrRecoverySignature",
			expectedReason: "recovery record signature is invalid",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformancePublicationCommit(t, identity)
			},
		},
		{
			name: conformanceFamilyPublicationCommit + "-v1-reject-missing-prepared-receipt", family: conformanceFamilyPublicationCommit, expect: conformanceExpectReject,
			mutation: conformanceMutationMissingPreparedReceipt, expectedSentinel: "ErrRecoveryRecordInvalid",
			expectedReason: "prepared object and receipt digests are required",
			notes:          "prepared_receipt_digest cleared after signing; structural validity is checked before the signature",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformancePublicationCommit(t, identity)
			},
		},
		{
			name: conformanceFamilyProcessorAttempt + "-v2-accept", family: conformanceFamilyProcessorAttempt, expect: conformanceExpectAccept,
			emittedByCheckout: true,
			notes:             "terminal processor-attempt successor chain as this checkout emits it",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformanceProcessorAttemptClosure(t, identity, ProcessorAttemptClosureSchemaV2)
			},
		},
		{
			name: conformanceFamilyProcessorAttempt + "-v1-accept", family: conformanceFamilyProcessorAttempt, expect: conformanceExpectAccept,
			emittedByCheckout: false,
			notes:             "predecessor generation of the same record family, still readable as the root of a chain; a v1 record cannot declare successor lineage",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformanceProcessorAttemptClosure(t, identity, ProcessorAttemptClosureSchemaV1)
			},
		},
		{
			name: conformanceFamilyProcessorAttempt + "-v2-reject-successor-without-sequence", family: conformanceFamilyProcessorAttempt, expect: conformanceExpectReject,
			mutation: conformanceMutationSuccessorWithoutSeq, expectedSentinel: "ErrRecoveryRecordInvalid",
			expectedReason: "sequence one cannot have a predecessor",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformanceProcessorAttemptClosure(t, identity, ProcessorAttemptClosureSchemaV2)
			},
		},
		{
			name: conformanceFamilyProcessorAttempt + "-v2-reject-signature-bit-flip", family: conformanceFamilyProcessorAttempt, expect: conformanceExpectReject,
			mutation: conformanceMutationSignatureBitFlip, expectedSentinel: "ErrRecoverySignature",
			expectedReason: "recovery record signature is invalid",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformanceProcessorAttemptClosure(t, identity, ProcessorAttemptClosureSchemaV2)
			},
		},
		{
			name: conformanceFamilyPortableFactClosure + "-v2-accept", family: conformanceFamilyPortableFactClosure, expect: conformanceExpectAccept,
			emittedByCheckout: true,
			notes:             "carries a canonical empty bundle; every declared reader dependency is admitted by this build's reader-closure table",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformancePortableFactClosure(t, identity, PortableFactClosureSchemaV2, PortableFactBundleSchemaV2, "v2")
			},
		},
		{
			name: conformanceFamilyPortableFactClosure + "-v1-accept", family: conformanceFamilyPortableFactClosure, expect: conformanceExpectAccept,
			emittedByCheckout: false,
			notes:             "predecessor portable-fact generation, still readable by this reader profile",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformancePortableFactClosure(t, identity, PortableFactClosureSchemaV1, PortableFactBundleSchemaV1, "v1")
			},
		},
		{
			name: conformanceFamilyPortableFactClosure + "-v2-reject-critical-extension", family: conformanceFamilyPortableFactClosure, expect: conformanceExpectReject,
			mutation: conformanceMutationCriticalExtension, expectedSentinel: "ErrRecoveryRecordInvalid",
			expectedReason: "unsupported critical extension",
			notes:          "an unknown critical extension is refused rather than ignored",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformancePortableFactClosure(t, identity, PortableFactClosureSchemaV2, PortableFactBundleSchemaV2, "v2")
			},
		},
		{
			name: conformanceFamilyPortableFactClosure + "-v2-reject-undeclared-reader-dependency", family: conformanceFamilyPortableFactClosure, expect: conformanceExpectReject,
			mutation: conformanceMutationUndeclaredDependency, expectedSentinel: "ErrReaderDecoderUnavailable",
			expectedReason: repository.ReaderRefusalNotAdmitted,
			notes:          "validly signed record declaring a reader dependency no decoder in this build answers; the reader refuses and falls through to the next recovery reference",
			build: func(t *testing.T, identity SigningIdentity) ([]byte, string) {
				return conformancePortableFactClosure(t, identity, PortableFactClosureSchemaV2, PortableFactBundleSchemaV2, "v2",
					"cairn-reader:semantic-semantics-v1")
			},
		},
	}
}

// generate builds every vector from the production code path.
func generateConformanceVectors(t *testing.T) []conformanceGenerated {
	t.Helper()
	identity := conformanceIdentity(t, conformanceSeedA)
	anchor := conformanceAnchor(t, identity)
	otherAnchor := conformanceAnchor(t, conformanceIdentity(t, conformanceSeedB))
	var generated []conformanceGenerated
	for _, blueprint := range conformanceBlueprints() {
		record, recordSchema := blueprint.build(t, identity)
		// A mutation either changes the record bytes or, for the wrong-anchor
		// case, changes only which independently retained anchor is asked to
		// authenticate an otherwise valid record.
		if conformanceMutationChangesBytes(blueprint.mutation) {
			record = applyConformanceMutation(t, blueprint.family, blueprint.mutation, record)
		}
		vectorAnchor := anchor
		if blueprint.mutation == conformanceMutationWrongAnchor {
			vectorAnchor = otherAnchor
		}
		vector := conformanceVector{
			Schema: conformanceVectorSchema, Name: blueprint.name, Family: blueprint.family,
			RecordSchema: recordSchema, EmittedByCheckout: blueprint.emittedByCheckout,
			Expect: blueprint.expect, Mutation: blueprint.mutation,
			ExpectedSentinel: blueprint.expectedSentinel, ExpectedReason: blueprint.expectedReason,
			Notes:        blueprint.notes,
			AnchorBase64: base64.StdEncoding.EncodeToString(mustCanonical(t, vectorAnchor)),
			RecordBase64: base64.StdEncoding.EncodeToString(record),
		}
		if blueprint.mutation == conformanceMutationAnchorPublicKeyDigest {
			// The mutated anchor is the subject of this vector, so the anchor
			// bytes themselves are the record under test.
			vector.AnchorBase64 = vector.RecordBase64
		}
		generated = append(generated, conformanceGenerated{conformanceVector: vector, record: record, anchor: vectorAnchor})
	}
	return generated
}

// conformanceMutationChangesBytes reports whether a mutation rewrites the
// record bytes. The wrong-anchor case changes only the verifying anchor, and
// the undeclared-dependency case is baked into the signed record, so both are
// left untouched here.
func conformanceMutationChangesBytes(mutation string) bool {
	switch mutation {
	case conformanceMutationNone, conformanceMutationWrongAnchor, conformanceMutationUndeclaredDependency:
		return false
	default:
		return true
	}
}

func applyConformanceMutation(t *testing.T, family, mutation string, record []byte) []byte {
	t.Helper()
	switch family {
	case conformanceFamilyTrustAnchor:
		var anchor TrustAnchor
		decodeConformanceRecord(t, record, &anchor)
		switch mutation {
		case conformanceMutationAnchorPublicKeyDigest:
			anchor.PublicKeyDigest = conformanceDigest("not-the-public-key")
		default:
			t.Fatalf("unsupported %s mutation %q", family, mutation)
		}
		return mustCanonical(t, anchor)
	case conformanceFamilyPreparedClosure:
		var decoded SignedPreparedClosure
		decodeConformanceRecord(t, record, &decoded)
		switch mutation {
		case conformanceMutationSignatureBitFlip:
			flipConformanceSignature(t, &decoded.Signature)
		case conformanceMutationFieldTamper:
			decoded.SnapshotRef = "snapshot-tampered"
		default:
			t.Fatalf("unsupported %s mutation %q", family, mutation)
		}
		return mustCanonical(t, decoded)
	case conformanceFamilyPublicationCommit:
		var decoded PublicationCommitRecord
		decodeConformanceRecord(t, record, &decoded)
		switch mutation {
		case conformanceMutationSignatureBitFlip:
			flipConformanceSignature(t, &decoded.Signature)
		case conformanceMutationMissingPreparedReceipt:
			decoded.PreparedReceiptDigest = ""
		default:
			t.Fatalf("unsupported %s mutation %q", family, mutation)
		}
		return mustCanonical(t, decoded)
	case conformanceFamilyProcessorAttempt:
		var decoded ProcessorAttemptClosureRecord
		decodeConformanceRecord(t, record, &decoded)
		switch mutation {
		case conformanceMutationSignatureBitFlip:
			flipConformanceSignature(t, &decoded.Signature)
		case conformanceMutationSuccessorWithoutSeq:
			decoded.PredecessorClosureDigest = conformanceDigest("predecessor")
		default:
			t.Fatalf("unsupported %s mutation %q", family, mutation)
		}
		return mustCanonical(t, decoded)
	case conformanceFamilyPortableFactClosure:
		var decoded PortableFactClosureEnvelope
		decodeConformanceRecord(t, record, &decoded)
		switch mutation {
		case conformanceMutationCriticalExtension:
			decoded.Closure.CriticalExtensions = []string{"org.cairn.unknown-critical-extension.v1"}
		case conformanceMutationUndeclaredDependency:
			decoded.Closure.RequiredReaderDependencies = []string{"cairn-reader:semantic-semantics-v1"}
		case conformanceMutationSignatureBitFlip:
			flipConformanceSignature(t, &decoded.Closure.Signature)
		default:
			t.Fatalf("unsupported %s mutation %q", family, mutation)
		}
		return mustCanonical(t, decoded)
	default:
		t.Fatalf("unsupported conformance family %q", family)
		return nil
	}
}

func decodeConformanceRecord(t *testing.T, payload []byte, into any) {
	t.Helper()
	if err := decodeStrictRecord(payload, into); err != nil {
		t.Fatalf("decode conformance record: %v", err)
	}
}

func flipConformanceSignature(t *testing.T, signature *[]byte) {
	t.Helper()
	if len(*signature) != 64 {
		t.Fatalf("signature length = %d, want 64", len(*signature))
	}
	flipped := append([]byte(nil), (*signature)...)
	flipped[0] ^= 0x01
	*signature = flipped
}

// checkConformanceVector runs the production verification path for one vector.
func checkConformanceVector(t *testing.T, vector conformanceGenerated) error {
	t.Helper()
	switch vector.Family {
	case conformanceFamilyTrustAnchor:
		var anchor TrustAnchor
		decodeConformanceRecord(t, vector.record, &anchor)
		if _, err := ExportTrustAnchor(anchor, filepath.Join(t.TempDir(), "trust-anchor.json")); err != nil {
			return err
		}
		return nil
	case conformanceFamilyPreparedClosure:
		var record SignedPreparedClosure
		decodeConformanceRecord(t, vector.record, &record)
		return record.Verify(vector.anchor)
	case conformanceFamilyPublicationCommit:
		var record PublicationCommitRecord
		decodeConformanceRecord(t, vector.record, &record)
		return record.Verify(vector.anchor)
	case conformanceFamilyProcessorAttempt:
		var record ProcessorAttemptClosureRecord
		decodeConformanceRecord(t, vector.record, &record)
		return record.Verify(vector.anchor)
	case conformanceFamilyPortableFactClosure:
		var envelope PortableFactClosureEnvelope
		decodeConformanceRecord(t, vector.record, &envelope)
		if err := envelope.Closure.Verify(vector.anchor); err != nil {
			return err
		}
		// A verified closure is not yet readable: every dependency it declares
		// must be answered by a decoder this build actually admits.
		for _, dependency := range envelope.Closure.RequiredReaderDependencies {
			if _, err := repository.AdmitReaderDependency(dependency); err != nil {
				return err
			}
		}
		return nil
	default:
		t.Fatalf("unsupported conformance family %q", vector.Family)
		return nil
	}
}

func conformanceSentinel(t *testing.T, name string) error {
	t.Helper()
	switch name {
	case "":
		return nil
	case "ErrRecoveryRecordInvalid":
		return ErrRecoveryRecordInvalid
	case "ErrRecoverySignature":
		return ErrRecoverySignature
	case "ErrRecoveryTrustAnchor":
		return ErrRecoveryTrustAnchor
	case "ErrReaderDecoderUnavailable":
		return repository.ErrReaderDecoderUnavailable
	default:
		t.Fatalf("unknown conformance sentinel %q", name)
		return nil
	}
}

func TestConformanceVectorsVerifyAndRegenerateByteForByte(t *testing.T) {
	generated := generateConformanceVectors(t)
	if os.Getenv(conformanceWriteEnv) == "1" {
		if err := os.MkdirAll(conformanceVectorDir, 0o755); err != nil {
			t.Fatal(err)
		}
		for _, vector := range generated {
			payload, err := json.MarshalIndent(vector.conformanceVector, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(conformanceVectorDir, vector.Name+".json")
			if err := os.WriteFile(path, append(payload, '\n'), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	committed, err := committedConformanceVectors()
	if err != nil {
		t.Fatal(err)
	}
	if len(committed) != len(generated) {
		t.Fatalf("committed vectors = %d, generated = %d", len(committed), len(generated))
	}
	names := make([]string, 0, len(generated))
	for _, vector := range generated {
		names = append(names, vector.Name)
	}
	sort.Strings(names)
	if fmt.Sprint(names) != fmt.Sprint(committedNames(committed)) {
		t.Fatalf("committed vector names = %v, want %v", committedNames(committed), names)
	}
	for _, vector := range generated {
		t.Run(vector.Name, func(t *testing.T) {
			file, ok := committed[vector.Name]
			if !ok {
				t.Fatalf("vector %s is not committed; regenerate with %s=1", vector.Name, conformanceWriteEnv)
			}
			if file.Schema != conformanceVectorSchema || file.Name != vector.Name || file.Family != vector.Family {
				t.Fatalf("committed vector header = %+v", file)
			}
			if file.RecordBase64 != vector.RecordBase64 {
				t.Fatal("regenerating this vector from current code did not reproduce the committed bytes")
			}
			if file.AnchorBase64 != vector.AnchorBase64 {
				t.Fatal("the committed anchor does not match the anchor derived from the fixed seed")
			}
			if file.Expect != vector.Expect || file.Mutation != vector.Mutation ||
				file.ExpectedSentinel != vector.ExpectedSentinel || file.ExpectedReason != vector.ExpectedReason {
				t.Fatalf("committed expectation = %+v, generated = %+v", file, vector.conformanceVector)
			}
			// The vector must be runnable from its committed bytes alone: an
			// independent reader has the file, not this test's fixtures.
			anchorPayload, err := base64.StdEncoding.DecodeString(file.AnchorBase64)
			if err != nil {
				t.Fatalf("decode committed anchor: %v", err)
			}
			recordPayload, err := base64.StdEncoding.DecodeString(file.RecordBase64)
			if err != nil {
				t.Fatalf("decode committed record: %v", err)
			}
			var anchor TrustAnchor
			decodeConformanceRecord(t, anchorPayload, &anchor)
			runnable := conformanceGenerated{conformanceVector: file, record: recordPayload, anchor: anchor}
			err = checkConformanceVector(t, runnable)
			switch file.Expect {
			case conformanceExpectAccept:
				if err != nil {
					t.Fatalf("valid vector failed verification: %v", err)
				}
			case conformanceExpectReject:
				if err == nil {
					t.Fatalf("rejection vector %s verified; %s was not detected", file.Name, file.Mutation)
				}
				if sentinel := conformanceSentinel(t, file.ExpectedSentinel); sentinel != nil && !errors.Is(err, sentinel) {
					t.Fatalf("rejection reason = %v, want %v", err, sentinel)
				}
				if file.ExpectedReason != "" && !strings.Contains(err.Error(), file.ExpectedReason) {
					t.Fatalf("rejection reason = %v, want it to state %q", err, file.ExpectedReason)
				}
			default:
				t.Fatalf("unknown expectation %q", file.Expect)
			}
		})
	}
}

func committedConformanceVectors() (map[string]conformanceVector, error) {
	entries, err := os.ReadDir(conformanceVectorDir)
	if err != nil {
		return nil, fmt.Errorf("read committed conformance vectors: %w", err)
	}
	vectors := make(map[string]conformanceVector, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		payload, err := os.ReadFile(filepath.Join(conformanceVectorDir, entry.Name()))
		if err != nil {
			return nil, err
		}
		var vector conformanceVector
		if err := json.Unmarshal(payload, &vector); err != nil {
			return nil, fmt.Errorf("decode committed vector %s: %w", entry.Name(), err)
		}
		if want := strings.TrimSuffix(entry.Name(), ".json"); vector.Name != want {
			return nil, fmt.Errorf("committed vector %s declares name %q", entry.Name(), vector.Name)
		}
		if _, err := base64.StdEncoding.DecodeString(vector.RecordBase64); err != nil {
			return nil, fmt.Errorf("committed vector %s has an undecodable record: %w", entry.Name(), err)
		}
		vectors[vector.Name] = vector
	}
	return vectors, nil
}

func committedNames(vectors map[string]conformanceVector) []string {
	names := make([]string, 0, len(vectors))
	for name := range vectors {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// TestConformanceVectorsCoverEverySignedRecordFamily proves the suite is
// complete for the record families this checkout emits, with both an accepted
// and a refused case per family.
func TestConformanceVectorsCoverEverySignedRecordFamily(t *testing.T) {
	accepted := map[string]bool{}
	rejected := map[string]bool{}
	emitted := map[string]bool{}
	for _, vector := range generateConformanceVectors(t) {
		switch vector.Expect {
		case conformanceExpectAccept:
			accepted[vector.Family] = true
		case conformanceExpectReject:
			rejected[vector.Family] = true
		}
		if vector.EmittedByCheckout {
			emitted[vector.Family] = true
		}
	}
	for _, family := range []string{
		conformanceFamilyTrustAnchor, conformanceFamilyPreparedClosure, conformanceFamilyPublicationCommit,
		conformanceFamilyProcessorAttempt, conformanceFamilyPortableFactClosure,
	} {
		if !accepted[family] || !rejected[family] {
			t.Fatalf("family %s has accept=%v reject=%v vectors; every family needs both", family, accepted[family], rejected[family])
		}
		if !emitted[family] {
			t.Fatalf("family %s has no vector marked as emitted by this checkout", family)
		}
	}
}
