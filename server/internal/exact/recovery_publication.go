package exact

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/ailiheizi/cairn/server/internal/capture"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/scanner"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

const (
	PayloadReceiptSchemaV1             = "org.cairn.payload-receipt.v1"
	MetadataEvidenceSchemaV1           = "org.cairn.authenticated-metadata-evidence.v1"
	MetadataEvidenceSchemaV2           = "org.cairn.authenticated-metadata-evidence.v2"
	PreparedEnvelopeSchemaV1           = "org.cairn.prepared-envelope.v1"
	PreparedEnvelopeSchemaV2           = "org.cairn.prepared-envelope.v2"
	portableRecordReadLimit      int64 = repository.MaxRecordBytes
	portableFactsCoveragePartial       = "PARTIAL"
)

var portableFactsV1Omissions = []string{
	"annotations",
	"descriptions",
	"name-and-relation-per-field-provenance",
	"ownership-mode-and-time-per-field-state",
	"processor-attempts",
}

var (
	// ErrUnknownExternalOutcome means a repository operation may have crossed
	// its durable placement boundary, but the caller cannot prove the result.
	// Callers must reconcile the repository before retrying the operation.
	ErrUnknownExternalOutcome = errors.New("UNKNOWN_EXTERNAL_OUTCOME")
	// ErrNeedsReconciliation is the operator/action classification for an
	// unknown repository placement outcome.
	ErrNeedsReconciliation = errors.New("NEEDS_RECONCILIATION")
	// ErrPublicationLeaseRelease records a failed release after a publication
	// side effect. The immutable record may already be committed, so callers
	// must reconcile the publication before treating the operation as terminal.
	ErrPublicationLeaseRelease = errors.New("PUBLICATION_LEASE_RELEASE_FAILED")
)

// PublicationOutcomeError preserves the operation identity needed to perform
// bounded reconciliation after a repository returns an error at a placement
// boundary. It deliberately does not claim that a prepared-only object is a
// committed publication.
type PublicationOutcomeError struct {
	PlanDigest    string
	SnapshotRef   string
	PublicationID string
	Role          repository.RecordRole
	Cause         error
}

func (e *PublicationOutcomeError) Error() string {
	if e == nil {
		return ErrUnknownExternalOutcome.Error() + "; " + ErrNeedsReconciliation.Error()
	}
	message := ErrUnknownExternalOutcome.Error() + "; " + ErrNeedsReconciliation.Error()
	if e.Role != "" {
		message += fmt.Sprintf(" after %s placement", e.Role)
	}
	if e.PlanDigest != "" {
		message += fmt.Sprintf(" for plan %s", e.PlanDigest)
	}
	if e.Cause != nil {
		message += ": " + e.Cause.Error()
	}
	return message
}

func (e *PublicationOutcomeError) Unwrap() error { return e.Cause }

func (e *PublicationOutcomeError) Is(target error) bool {
	return target == ErrUnknownExternalOutcome || target == ErrNeedsReconciliation
}

// PayloadPlacementOutcomeError identifies an exact blob whose placement
// response could not be proven. The content identity is retained so a caller
// can reconcile the object without replaying source reads or creating a
// second logical payload.
type PayloadPlacementOutcomeError struct {
	ContentID string
	Cause     error
}

func (e *PayloadPlacementOutcomeError) Error() string {
	message := ErrUnknownExternalOutcome.Error() + "; " + ErrNeedsReconciliation.Error()
	if e != nil && e.ContentID != "" {
		message += fmt.Sprintf(" after payload %s placement", e.ContentID)
	}
	if e != nil && e.Cause != nil {
		message += ": " + e.Cause.Error()
	}
	return message
}

func (e *PayloadPlacementOutcomeError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func (e *PayloadPlacementOutcomeError) Is(target error) bool {
	return target == ErrUnknownExternalOutcome || target == ErrNeedsReconciliation
}

// placeExactWithReadback treats every post-boundary placement error as an
// unknown outcome until the expected content identity is independently
// verified. A successful readback returns a deterministic synthetic receipt;
// receipt transport itself is not recovery authority.
func placeExactWithReadback(ctx context.Context, driver repository.Driver, contentID string, logicalBytes int64, body io.Reader) (repository.Receipt, error) {
	receipt, placeErr := driver.PlaceExact(ctx, contentID, body)
	if placeErr == nil {
		// Hash the logical stream exposed by the reader rather than trusting a
		// backend Verify result. A replaceable driver may report backend health
		// while returning bytes that do not satisfy the signed exact identity.
		if verifyErr := verifyExactObjectReadback(ctx, driver, contentID, logicalBytes); verifyErr == nil {
			return receipt, nil
		} else {
			placeErr = fmt.Errorf("exact payload readback after successful placement: %w", verifyErr)
		}
	}
	if verifyErr := verifyExactObjectReadback(context.WithoutCancel(ctx), driver, contentID, logicalBytes); verifyErr == nil {
		return repository.Receipt{ContentID: contentID, Bytes: logicalBytes, StoredBytes: 0, StoredBytesState: repository.StoredBytesUnavailable, Existed: true}, nil
	} else {
		placeErr = fmt.Errorf("observe exact payload %s: %w; original placement: %v", contentID, verifyErr, placeErr)
	}
	return repository.Receipt{}, &PayloadPlacementOutcomeError{ContentID: contentID, Cause: placeErr}
}

type PayloadObjectReceipt struct {
	ContentID    string `json:"content_id"`
	LogicalBytes int64  `json:"logical_bytes"`
}

// PayloadReceipt is a deterministic aggregate of the exact objects read back
// before the prepared closure is signed. It is embedded in that closure.
type PayloadReceipt struct {
	Schema        string                 `json:"schema"`
	RepositoryID  string                 `json:"repository_id"`
	PublicationID string                 `json:"publication_id"`
	SnapshotRef   string                 `json:"snapshot_ref"`
	Objects       []PayloadObjectReceipt `json:"objects"`
	TotalBytes    int64                  `json:"total_bytes"`
}

type AuthenticatedMetadataEvidence struct {
	Schema                  string   `json:"schema"`
	ManifestDigest          string   `json:"manifest_digest"`
	PortableFactsSchema     string   `json:"portable_facts_schema,omitempty"`
	PortableFactsDigest     string   `json:"portable_facts_digest,omitempty"`
	PortableFactsEntryCount int64    `json:"portable_facts_entry_count,omitempty"`
	PortableFactsCoverage   string   `json:"portable_facts_coverage,omitempty"`
	PortableFactsOmissions  []string `json:"portable_facts_omissions,omitempty"`
	EntryCount              int64    `json:"entry_count"`
	FileCount               int64    `json:"file_count"`
	LocallyProtectedFiles   int64    `json:"locally_protected_files"`
	ExplicitlyUnprotected   int64    `json:"explicitly_unprotected_files"`
	ContentCoverageComplete bool     `json:"content_coverage_complete"`
}

type PreparedClosureEnvelope struct {
	Schema               string                        `json:"schema"`
	Prepared             SignedPreparedClosure         `json:"prepared"`
	PayloadReceipt       PayloadReceipt                `json:"payload_receipt"`
	VerificationEvidence AuthenticatedMetadataEvidence `json:"verification_evidence"`
	// Manifest carries the complete manifest for PreparedEnvelopeSchemaV1/V2.
	// For PreparedEnvelopeSchemaV3 it carries every manifest field except
	// entries, including the canonical manifest_digest, and ManifestParts binds
	// the content-addressed parts that carry the entries.
	Manifest      Manifest        `json:"manifest"`
	ManifestParts []RecordPartRef `json:"manifest_parts,omitempty"`
}

type stableRecordReceipt struct {
	RepositoryID string                `json:"repository_id"`
	Role         repository.RecordRole `json:"role"`
	Digest       string                `json:"digest"`
	Bytes        int64                 `json:"bytes"`
}

type PublicationClosureResult struct {
	PreparedDigest string
	CommitDigest   string
	Generation     uint64
}

type committedPublication struct {
	CommitDigest string
	Commit       PublicationCommitRecord
	Prepared     PreparedClosureEnvelope
	Manifest     Manifest
}

func (s *Service) signedPublicationEnabled() bool {
	return s != nil && (s.RequireSignedPublication || s.SigningIdentity != nil || s.TrustAnchor != nil)
}

func (s *Service) publicationRecordDriver() (repository.RecordDriver, error) {
	driver, ok := s.Repo.(repository.RecordDriver)
	if !ok {
		return nil, errors.New("repository profile does not support portable publication records")
	}
	return driver, nil
}

func buildPayloadReceipt(driver repository.RecordDriver, publicationID, snapshotRef string, placed placedSet) (PayloadReceipt, error) {
	receipt := PayloadReceipt{
		Schema: PayloadReceiptSchemaV1, RepositoryID: driver.RepositoryIdentity(),
		PublicationID: publicationID, SnapshotRef: snapshotRef,
		Objects: make([]PayloadObjectReceipt, 0, len(placed.payloadReceipts)),
	}
	seen := make(map[string]int64, len(placed.payloadReceipts))
	for _, object := range placed.payloadReceipts {
		if previous, ok := seen[object.ContentID]; ok {
			if previous != object.Bytes {
				return PayloadReceipt{}, fmt.Errorf("payload %s has conflicting lengths", object.ContentID)
			}
			continue
		}
		seen[object.ContentID] = object.Bytes
		receipt.Objects = append(receipt.Objects, PayloadObjectReceipt{ContentID: object.ContentID, LogicalBytes: object.Bytes})
		receipt.TotalBytes += object.Bytes
	}
	sort.Slice(receipt.Objects, func(i, j int) bool { return receipt.Objects[i].ContentID < receipt.Objects[j].ContentID })
	return receipt, validatePayloadReceipt(receipt)
}

func validatePayloadReceipt(receipt PayloadReceipt) error {
	if receipt.Schema != PayloadReceiptSchemaV1 || strings.TrimSpace(receipt.RepositoryID) == "" ||
		strings.TrimSpace(receipt.PublicationID) == "" || strings.TrimSpace(receipt.SnapshotRef) == "" || receipt.TotalBytes < 0 {
		return errors.New("payload receipt is incomplete")
	}
	var total int64
	previous := ""
	for _, object := range receipt.Objects {
		if !validExactContentID(object.ContentID) || object.LogicalBytes < 0 || (previous != "" && object.ContentID <= previous) {
			return errors.New("payload receipt objects must be unique, sorted, and non-negative")
		}
		previous = object.ContentID
		total += object.LogicalBytes
	}
	if total != receipt.TotalBytes {
		return fmt.Errorf("payload receipt total is %d, want %d", receipt.TotalBytes, total)
	}
	return nil
}

func validExactContentID(contentID string) bool {
	algorithm, payload, ok := strings.Cut(contentID, ":")
	if !ok || algorithm != repository.AlgorithmSHA256 || len(payload) != 64 || payload != strings.ToLower(payload) {
		return false
	}
	_, err := hex.DecodeString(payload)
	return err == nil
}

func buildMetadataEvidence(manifest Manifest) (AuthenticatedMetadataEvidence, error) {
	evidence := AuthenticatedMetadataEvidence{
		Schema: MetadataEvidenceSchemaV1, ManifestDigest: manifest.ManifestDigest,
		EntryCount: int64(len(manifest.Entries)), ContentCoverageComplete: true,
	}
	switch manifest.Schema {
	case SnapshotSchemaV1:
	case SnapshotSchemaV2:
		factsDigest, err := manifestFactsDigest(manifest)
		if err != nil {
			return AuthenticatedMetadataEvidence{}, err
		}
		evidence.Schema = MetadataEvidenceSchemaV2
		evidence.PortableFactsSchema = PortableFactsSchemaV1
		evidence.PortableFactsDigest = factsDigest
		evidence.PortableFactsEntryCount = int64(len(manifest.Entries))
		evidence.PortableFactsCoverage = portableFactsCoveragePartial
		evidence.PortableFactsOmissions = append([]string(nil), portableFactsV1Omissions...)
	default:
		return AuthenticatedMetadataEvidence{}, fmt.Errorf("unsupported manifest schema %q", manifest.Schema)
	}
	for _, entry := range manifest.Entries {
		if sqlite.NamespaceEntryType(entry.EntryType) != sqlite.EntryFile {
			continue
		}
		evidence.FileCount++
		if entry.Protection.LocalRepresentationID != "" && entry.ContentID != "" {
			evidence.LocallyProtectedFiles++
			continue
		}
		evidence.ExplicitlyUnprotected++
		evidence.ContentCoverageComplete = false
	}
	return evidence, nil
}

// postPublicationChildBytesPerFile is the measured conservative ceiling for the
// records one processed file adds to the post-publication portable fact child
// and that cannot exist while a plan is still read-only: the terminal attempt's
// artifact descriptor, the attachment reference to its body, and the extracted
// metadata facts the capability declares.
//
// Measured on a real 11,561-image library (a 353-file batch, one repository
// publication): the child placed 7,772,137 bytes, of which 5,690,066 bytes were
// the records derived from the publication's own manifest and 2,075,378 bytes
// (351 artifact descriptors, 1,053 extracted facts, 351 attachment references)
// depended on post-publication processing — 5,913 bytes per processed file.
// 6 KiB is that measurement with a small margin, and it is deliberately kept
// tight because the same library places a 16,310,074-byte child for 742 files
// and fails above that; a wider allowance would refuse work that fits. It is a
// measured model, not a proof: a capability that emits materially more per file
// than the measured profile can still cross the placement bound, which remains
// the backstop.
const postPublicationChildBytesPerFile = int64(6 << 10)

// ErrPortableRecordTooLarge reports that applying a plan would place a portable
// recovery record larger than the repository accepts. It is decided while
// planning, before any catalog, repository, or publication mutation, so the
// operator gets an ordinary refusal instead of an unknown-outcome
// reconciliation state.
var ErrPortableRecordTooLarge = errors.New("ingest publication exceeds the portable record limit")

// PublicationRecordProjection is the plan-time projection of the portable
// records one ingest publication would place. PreparedClosureBytes and
// PortableFactClosureBytes cover the two records that grow with the entry
// count. A publication's commit marker is a fixed-size record, and the
// processor-attempt closure was measured well below both projected records on
// a real library; both remain covered by the placement guard.
//
// An oversized logical record is placed as content-addressed parts, so the
// entry count no longer makes a publication unplaceable. LargestItemBytes is
// the largest single logical item (one manifest entry or one portable fact
// record); a part cannot be split below one item, and that is the only
// entry-scaling size that can still refuse a plan.
type PublicationRecordProjection struct {
	Entries                  int
	PreparedClosureBytes     int64
	PortableFactClosureBytes int64
	LargestItemBytes         int64
	Limit                    int64
}

// recordPartItemMargin is the conservative allowance for the part envelope's
// own fields and array punctuation when the largest single item is compared
// with the per-record bound. It is deliberately much larger than the measured
// part overhead.
const recordPartItemMargin = int64(4 << 10)

// LargestBytes returns the largest portable record the publication would place
// if it were placed whole. This is informational once part splitting is
// available; ExceedsLimit decides whether the publication can be placed.
func (p PublicationRecordProjection) LargestBytes() int64 {
	if p.PreparedClosureBytes > p.PortableFactClosureBytes {
		return p.PreparedClosureBytes
	}
	return p.PortableFactClosureBytes
}

// ExceedsLimit reports whether a single logical item cannot fit one repository
// record, so that no part split can place the publication.
func (p PublicationRecordProjection) ExceedsLimit() bool {
	return p.Limit > 0 && p.LargestItemBytes > p.Limit-recordPartItemMargin
}

// Refusal is the ordinary invalid-input refusal for a publication whose single
// largest item cannot be split across parts. It names the item size, the entry
// count, and the limit.
func (p PublicationRecordProjection) Refusal() error {
	return fmt.Errorf(
		"%w: applying this plan would place a %d-byte portable recovery record for %d entries, above the %d-byte repository record limit; one item cannot be split across record parts, so this publication cannot be placed",
		ErrPortableRecordTooLarge, p.LargestItemBytes, p.Entries, p.Limit,
	)
}

// projectPublicationRecords computes the byte length of the portable records a
// capture would place, from the same captured facts, through the same builders
// and the same JSON encoding the apply path uses. Identifiers and digests that
// cannot exist before apply are substituted with same-width placeholders, so
// the projected sizes are exact for the records derived from this publication's
// own manifest; measured against a real library those are the binding records
// (a 353-file batch, 356 manifest entries, placed a 2,730,823-byte prepared
// closure and a 7,772,137-byte portable fact closure, about 22 KB per entry).
//
// The post-publication portable fact child also carries records that only
// exist after processing runs. Those add postPublicationChildBytesPerFile for
// every processed file; that ceiling is a measurement of the real library, not
// a proof, so it is conservative rather than exact and the placement guard
// remains the backstop.
func (s *Service) projectPublicationRecords(
	entries []scanner.EntryRecord,
	policy ingestPolicy,
	boundLocators map[string][]IngestLocator,
	binding capture.BindingRecord,
	captureDigest, protectionDigest string,
) (PublicationRecordProjection, error) {
	projection := PublicationRecordProjection{Limit: repository.MaxRecordBytes}
	if s == nil || s.SigningIdentity == nil || s.TrustAnchor == nil {
		// Without a signing identity and trust anchor the apply path places no
		// portable record at all, so no record bound applies.
		return projection, nil
	}
	driver, ok := s.Repo.(repository.RecordDriver)
	if !ok {
		return projection, nil
	}
	// Every identifier the apply path allocates for this publication comes from
	// the same generator, so the placeholders carry the exact width of the real
	// values even though the values themselves cannot match.
	workspaceID, err := sqlite.NewStableID(sqlite.IDPrefixWorkspace)
	if err != nil {
		return projection, err
	}
	sourceID, err := sqlite.NewStableID(sqlite.IDPrefixSource)
	if err != nil {
		return projection, err
	}
	rootID, err := sqlite.NewStableID(sqlite.IDPrefixNamespaceRoot)
	if err != nil {
		return projection, err
	}
	snapshotRef, err := sqlite.NewStableID("snap")
	if err != nil {
		return projection, err
	}
	publicationID, err := sqlite.NewStableID(sqlite.IDPrefixPublication)
	if err != nil {
		return projection, err
	}
	projectedDigest := DigestBytes([]byte("cairn.projected.portable.record"))
	if strings.TrimSpace(captureDigest) == "" {
		captureDigest = projectedDigest
	}
	if strings.TrimSpace(protectionDigest) == "" {
		protectionDigest = projectedDigest
	}
	policy.decisionDigest = protectionDigest

	ordered := append([]scanner.EntryRecord(nil), entries...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].RelativePath < ordered[j].RelativePath })
	rootPathID := ""
	for _, entry := range ordered {
		if entry.RelativePath == "." {
			rootPathID = entry.PathID
			break
		}
	}

	// placeFiles places one payload object per unique exact-mode content
	// identity; the payload receipt is built from exactly those facts.
	placed := placedSet{}
	seenContent := make(map[string]struct{})
	for _, entry := range ordered {
		if entry.Kind != scanner.KindRegularFile {
			continue
		}
		if metadataOnlyResolutionQualified(scanner.CaptureModeRootedFD, entry, policy) {
			continue
		}
		if entry.State != scanner.EntryComplete || entry.Content == nil {
			continue
		}
		mode := policy.modeFor(entry.RelativePath)
		if mode != sqlite.ProtectionStoreExact && mode != sqlite.ProtectionStoreExactWithExternalFallback {
			continue
		}
		if _, seen := seenContent[entry.Content.ContentID]; seen {
			continue
		}
		seenContent[entry.Content.ContentID] = struct{}{}
		placed.payloadReceipts = append(placed.payloadReceipts, repository.Receipt{
			ContentID: entry.Content.ContentID, Bytes: entry.Content.BytesRead,
		})
	}
	payloadReceipt, err := buildPayloadReceipt(driver, publicationID, snapshotRef, placed)
	if err != nil {
		return projection, err
	}

	representations := make(map[string]string)
	manifestEntryCount, manifestEntryBytes := 0, int64(0)
	factRecordCount, factRecordBytes := 0, int64(0)
	processedFiles := 0
	fileCount, locallyProtected, explicitlyUnprotected := int64(0), int64(0), int64(0)
	contentCoverageComplete := true
	for _, entry := range ordered {
		entryType, ok := namespaceType(entry.Kind)
		if !ok {
			continue
		}
		if entry.RelativePath == "." {
			// The capture root is published as the namespace root, not as a
			// manifest entry; the apply path skips it here as well.
			continue
		}
		item, err := projectedPreparedItem(entry, entryType, policy, boundLocators, representations)
		if err != nil {
			return projection, err
		}
		if err := validatePreparedProtection(item); err != nil {
			return projection, fmt.Errorf("%w: %v", ErrBlocked, err)
		}
		manifestEntry, err := toManifestEntry(item.entry, item.entryType, item, binding)
		if err != nil {
			return projection, err
		}
		encoded, err := CanonicalJSON(manifestEntry)
		if err != nil {
			return projection, err
		}
		manifestEntryCount++
		manifestEntryBytes += int64(len(encoded))
		if int64(len(encoded)) > projection.LargestItemBytes {
			projection.LargestItemBytes = int64(len(encoded))
		}
		if sqlite.NamespaceEntryType(manifestEntry.EntryType) == sqlite.EntryFile {
			fileCount++
			if manifestEntry.ContentID != "" {
				processedFiles++
			}
			if manifestEntry.Protection.LocalRepresentationID != "" && manifestEntry.ContentID != "" {
				locallyProtected++
			} else {
				explicitlyUnprotected++
				contentCoverageComplete = false
			}
		}
		parentSubject := ""
		if entry.ParentPathID != "" && entry.ParentPathID != rootPathID {
			if parentSubject, err = sqlite.NewStableID(sqlite.IDPrefixSubject); err != nil {
				return projection, err
			}
		}
		recordBytes, recordCount, recordMax, err := projectedPortableFactRecordBytes(
			workspaceID, snapshotRef, rootID, sourceID, entry.Name, parentSubject, manifestEntry,
			item.entry, item.protectionMode, item.fileVersionID, item.representation)
		if err != nil {
			return projection, err
		}
		factRecordCount += recordCount
		factRecordBytes += recordBytes
		if recordMax > projection.LargestItemBytes {
			projection.LargestItemBytes = recordMax
		}
	}
	projection.Entries = manifestEntryCount

	manifestBase := Manifest{
		Schema: CurrentSnapshotSchema, SnapshotRef: snapshotRef, CreatedAt: s.now(), Binding: binding,
		ConfigDigest: s.ConfigDigest, ProtectionDigest: protectionDigest,
		ManifestDigest: projectedDigest, Entries: []ManifestEntry{},
	}
	// Reuse the real evidence builder so its record shape cannot drift, then
	// patch the counts it derived from the empty skeleton manifest.
	evidence, err := buildMetadataEvidence(manifestBase)
	if err != nil {
		return projection, err
	}
	evidence.EntryCount = int64(manifestEntryCount)
	evidence.PortableFactsEntryCount = int64(manifestEntryCount)
	evidence.FileCount = fileCount
	evidence.LocallyProtectedFiles = locallyProtected
	evidence.ExplicitlyUnprotected = explicitlyUnprotected
	evidence.ContentCoverageComplete = contentCoverageComplete

	// A JSON array literal of count elements costs its element bytes plus one
	// byte per separator and two brackets.
	entriesLiteralBytes := manifestEntryBytes + int64(manifestEntryCount) + 1
	if manifestEntryCount == 0 {
		entriesLiteralBytes = 2
	}
	preparedEnvelope := PreparedClosureEnvelope{
		Schema: PreparedEnvelopeSchemaV2,
		Prepared: SignedPreparedClosure{
			Schema: PreparedClosureSchemaV1, SignatureDomain: RecoverySignatureDomainV1,
			RecordKind: PreparedClosureKind, PublicationID: publicationID,
			PublicationDomain: s.PublicationDomain,
			// Unknown before apply: pin to the widest possible encoding so the
			// projection never under-reports the record that will be placed.
			Generation: math.MaxUint64, FenceToken: math.MaxUint64, ParentCommitDigest: projectedDigest,
			SnapshotRef: snapshotRef, RRFRootDigest: projectedDigest, ManifestDigest: projectedDigest,
			PayloadReceiptDigest: projectedDigest, PayloadReceiptLength: payloadReceipt.TotalBytes,
			PayloadReceiptObjectCount: int64(len(payloadReceipt.Objects)), PlanDigest: projectedDigest,
			CaptureDigest: captureDigest, PolicyDigest: protectionDigest, VerificationDigest: projectedDigest,
			TargetIdentity: driver.RepositoryIdentity(),
			WriterIdentity: s.SigningIdentity.WriterIdentity, KeyID: s.SigningIdentity.KeyID,
			SignedAt: s.now(), Signature: make([]byte, ed25519.SignatureSize),
		},
		PayloadReceipt: payloadReceipt, VerificationEvidence: evidence, Manifest: manifestBase,
	}
	preparedEnvelopeBytes, err := CanonicalJSON(preparedEnvelope)
	if err != nil {
		return projection, err
	}
	projection.PreparedClosureBytes = int64(len(preparedEnvelopeBytes)) - 2 + entriesLiteralBytes

	bundleBase := portableFactBundle{
		Schema: PortableFactBundleSchemaV2, WorkspaceID: workspaceID, SnapshotRef: snapshotRef,
		Records: []portableFactRecord{}, Attachments: []portableFactAttachment{},
	}
	bundleBaseBytes, err := CanonicalJSON(bundleBase)
	if err != nil {
		return projection, err
	}
	recordsLiteralBytes := factRecordBytes + int64(factRecordCount) + 1
	if factRecordCount == 0 {
		recordsLiteralBytes = 2
	}
	bundleBytes := int64(len(bundleBaseBytes)) - 2 + recordsLiteralBytes
	closureSchema, envelopeSchema, err := portableFactClosureSchemas(bundleBase.Schema)
	if err != nil {
		return projection, err
	}
	factClosure := PortableFactClosureRecord{
		Schema: closureSchema, SignatureDomain: RecoverySignatureDomainV1, RecordKind: PortableFactClosureKind,
		WorkspaceID: workspaceID, PublicationID: publicationID, PublicationDomain: s.PublicationDomain,
		SnapshotRef: snapshotRef, ManifestDigest: projectedDigest, ParentCommitDigest: projectedDigest,
		// Unknown before apply; the widest encoding is the conservative reading.
		ParentGeneration: math.MaxUint64, ClosureSequence: math.MaxUint64,
		PredecessorClosureDigest: projectedDigest,
		BundleSchema:             bundleBase.Schema, BundleDigest: projectedDigest, BundleLength: bundleBytes,
		RecordCount: int64(factRecordCount), AttachmentCount: 0,
		ProcessorAttemptDigest: projectedDigest, TargetIdentity: driver.RepositoryIdentity(),
		WriterIdentity: s.SigningIdentity.WriterIdentity, KeyID: s.SigningIdentity.KeyID,
		FenceToken:                 math.MaxUint64,
		RequiredReaderDependencies: portableFactReaderDependenciesForSchema(s.Repo, closureSchema),
		CanonicalizationProfile:    "encoding/json-compact-v1",
		CriticalExtensions:         []string{}, OptionalExtensions: json.RawMessage(`{}`),
		SignedAt: s.now(), Signature: make([]byte, ed25519.SignatureSize),
	}
	// The bundle is embedded verbatim, so measuring the envelope with an empty
	// bundle and substituting the bundle length is exact.
	factEnvelope := PortableFactClosureEnvelope{
		Schema: envelopeSchema, Closure: factClosure, Bundle: json.RawMessage(`[]`),
	}
	factEnvelopeBytes, err := CanonicalJSON(factEnvelope)
	if err != nil {
		return projection, err
	}
	projection.PortableFactClosureBytes = int64(len(factEnvelopeBytes)) - 2 + bundleBytes
	if s.Processor != nil {
		// The post-publication child also carries what processing emitted for
		// this publication. That output cannot exist before apply, so it is
		// covered by the measured per-file ceiling above.
		projection.PortableFactClosureBytes += postPublicationChildBytesPerFile * int64(processedFiles)
	}
	return projection, nil
}

// projectedPreparedItem mirrors the identifier allocation the apply path
// performs for one captured entry. It performs no catalog, repository, or
// publication mutation; the identifiers exist only to carry the right width
// into the projection.
func projectedPreparedItem(
	entry scanner.EntryRecord,
	entryType sqlite.NamespaceEntryType,
	policy ingestPolicy,
	boundLocators map[string][]IngestLocator,
	representations map[string]string,
) (prepared, error) {
	var item prepared
	observationID, err := sqlite.NewStableID(sqlite.IDPrefixObservation)
	if err != nil {
		return item, err
	}
	item = prepared{
		entry: entry, observationID: observationID, entryType: entryType,
		protectionMode: policy.modeFor(entry.RelativePath), protectionDigest: policy.decisionDigest,
	}
	item.protectionOutcome, item.protectionReason = protectionOutcome(entry, item.protectionMode)
	if item.namespaceID, err = sqlite.NewStableID(sqlite.IDPrefixNamespaceEntry); err != nil {
		return item, err
	}
	if item.protectionID, err = sqlite.NewStableID(sqlite.IDPrefixProtectionRecord); err != nil {
		return item, err
	}
	if entryType != sqlite.EntryFile {
		return item, nil
	}
	if entry.Content == nil && !(item.protectionMode == sqlite.ProtectionMetadataOnly && metadataOnlyEntryEvidence(entry)) {
		return item, fmt.Errorf("%w: regular file %q has no content digest", ErrBlocked, entry.RelativePath)
	}
	if entry.Content != nil {
		if item.fileVersionID, err = sqlite.NewStableID(sqlite.IDPrefixFileVersion); err != nil {
			return item, err
		}
		key := entry.Content.ContentID + "\x00" + string(item.protectionMode)
		representation, ok := representations[key]
		if !ok {
			if representation, err = sqlite.NewStableID(sqlite.IDPrefixRepresentation); err != nil {
				return item, err
			}
			representations[key] = representation
		}
		item.representation = representation
		if item.protectionMode == sqlite.ProtectionStoreExact || item.protectionMode == sqlite.ProtectionStoreExactWithExternalFallback {
			if item.recoveryID, err = sqlite.NewStableID(sqlite.IDPrefixRecoveryReference); err != nil {
				return item, err
			}
		}
	}
	for priority, locator := range boundLocators[entry.PathID] {
		if item.externalBindingID == "" {
			if item.externalBindingID, err = sqlite.NewStableID(sqlite.IDPrefixExternalBinding); err != nil {
				return item, err
			}
			if item.externalRecoveryID, err = sqlite.NewStableID(sqlite.IDPrefixRecoveryReference); err != nil {
				return item, err
			}
		}
		locatorID, err := sqlite.NewStableID(sqlite.IDPrefixExternalLocator)
		if err != nil {
			return item, err
		}
		item.externalLocators = append(item.externalLocators, preparedLocator{
			id: locatorID, priority: int64(priority), locator: locator,
		})
	}
	return item, nil
}

// projectedPortableFactRecordBytes returns the summed serialized length, the
// count, and the largest single serialized record that one manifest entry
// contributes to the post-publication child closure. The payloads are the same
// values the apply path serializes; catalog-derived identifiers are same-width
// placeholders.
func projectedPortableFactRecordBytes(
	workspaceID, snapshotRef, rootID, sourceID, displayName, parentSubject string,
	entry ManifestEntry,
	captured scanner.EntryRecord,
	protectionMode sqlite.ProtectionMode,
	fileVersionID, representationID string,
) (int64, int, int64, error) {
	recordSchema, err := portableFactRecordSchema(PortableFactBundleSchemaV2)
	if err != nil {
		return 0, 0, 0, err
	}
	entryID, err := sqlite.NewStableID(sqlite.IDPrefixNamespaceEntry)
	if err != nil {
		return 0, 0, 0, err
	}
	subjectRef, err := sqlite.NewStableID(sqlite.IDPrefixSubject)
	if err != nil {
		return 0, 0, 0, err
	}
	if entry.ContentID != "" && fileVersionID == "" {
		if fileVersionID, err = sqlite.NewStableID(sqlite.IDPrefixFileVersion); err != nil {
			return 0, 0, 0, err
		}
	}
	total, count, largest := int64(0), 0, int64(0)
	appendRecord := func(kind, id string, payload, provenance any) error {
		payloadBytes, err := CanonicalJSON(payload)
		if err != nil {
			return err
		}
		provenanceBytes, err := CanonicalJSON(provenance)
		if err != nil {
			return err
		}
		encoded, err := CanonicalJSON(portableFactRecord{
			Schema: recordSchema, RecordKind: kind, RecordID: id, WorkspaceID: workspaceID,
			SnapshotRef: snapshotRef, StableSubjectRef: subjectRef, Revision: 1,
			PayloadDigest: DigestBytes(payloadBytes), PayloadLength: int64(len(payloadBytes)),
			Provenance: provenanceBytes, Payload: payloadBytes,
		})
		if err != nil {
			return err
		}
		total += int64(len(encoded))
		count++
		if int64(len(encoded)) > largest {
			largest = int64(len(encoded))
		}
		return nil
	}
	selected := make(map[string]struct{})
	if entry.Protection.LocalRepresentationID != "" {
		selected[entry.Protection.LocalRepresentationID] = struct{}{}
	}
	for _, reference := range entry.Protection.RecoveryReferences {
		if reference.RepresentationID != "" {
			selected[reference.RepresentationID] = struct{}{}
		}
	}
	selectedRefs := make([]string, 0, len(selected))
	for ref := range selected {
		selectedRefs = append(selectedRefs, ref)
	}
	sort.Strings(selectedRefs)
	mapping := subjectMappingPayload{
		WorkspaceID: workspaceID, NamespaceRootID: rootID, NamespaceEntryID: entryID,
		StableSubjectRef: subjectRef, SourceID: sourceID, ParentSubjectRef: parentSubject,
		RawPath: entry.RawPath, RawName: entry.RawName, DisplayName: displayName,
		EntryType: entry.EntryType, ContentID: entry.ContentID, LogicalLength: entry.LogicalSize,
		FileVersionID: fileVersionID, SelectedRepresentationRefs: selectedRefs,
		MetadataBefore: entry.MetadataBefore, MetadataAfter: entry.MetadataAfter,
		Protection: entry.Protection,
	}
	if err := appendRecord("SUBJECT_MAPPING", entryID, mapping, map[string]any{
		"namespace_root_id": rootID, "entry_type": entry.EntryType,
	}); err != nil {
		return 0, 0, 0, err
	}
	if entry.Facts != nil {
		for _, fact := range entry.Facts.Facts {
			if err := appendRecord("METADATA_FACT", entryID+":capture:"+fact.Name, fact, map[string]any{
				"source_profile": fact.SourceProfile, "authority": fact.Authority,
				"capture_time": fact.CapturedAt, "provenance_digest": fact.ProvenanceDigest,
			}); err != nil {
				return 0, 0, 0, err
			}
		}
	}
	if fileVersionID != "" {
		witness, err := projectedCatalogRelationWitness(
			workspaceID, snapshotRef, rootID, subjectRef, fileVersionID, representationID,
			entry, captured, protectionMode)
		if err != nil {
			return 0, 0, 0, err
		}
		fact, err := catalogRelationWitnessFact(workspaceID, snapshotRef, rootID, subjectRef, witness)
		if err != nil {
			return 0, 0, 0, err
		}
		if err := appendRecord("METADATA_FACT", fact.ID, fact, map[string]any{
			"namespace": catalogRelationWitnessNamespace, "profile_digest": catalogRelationWitnessProfileDigest(),
			"snapshot_ref": snapshotRef, "namespace_root_id": rootID, "file_version_id": fileVersionID,
		}); err != nil {
			return 0, 0, 0, err
		}
	}
	return total, count, largest, nil
}

// projectedCatalogRelationWitness constructs the same immutable relation rows
// that ingest adopts, with same-width IDs and a maximum-width database time.
// The payload then passes through catalogRelationWitnessPayload, the builder
// used by the post-publication catalog reader, so this projection accounts for
// the actual authenticated witness rather than a per-file allowance.
func projectedCatalogRelationWitness(
	workspaceID, snapshotRef, rootID, subjectRef, fileVersionID, representationID string,
	manifestEntry ManifestEntry,
	captured scanner.EntryRecord,
	protectionMode sqlite.ProtectionMode,
) (catalogRelationWitness, error) {
	if captured.Content == nil || representationID == "" || manifestEntry.ContentID != captured.Content.ContentID {
		return catalogRelationWitness{}, errors.New("cannot project catalog relation witness without the captured exact identity")
	}
	const widestCanonicalTime = "2099-12-31T23:59:59.999999999Z"
	createdAt, err := time.Parse(time.RFC3339Nano, widestCanonicalTime)
	if err != nil {
		return catalogRelationWitness{}, err
	}
	size := captured.Content.BytesRead
	contentID := captured.Content.ContentID
	profile := representationProfile(protectionMode)
	fileVersion := sqlite.FileVersion{
		ID: fileVersionID, WorkspaceID: workspaceID, AssetID: "asset:" + captured.PathID,
		ContentID: contentID, LogicalSize: size, HashingProfile: scanner.HashVersion,
		AuthoritativeRepresentationID: representationID, ExtentSetDigest: contentID,
		HardlinkGroupID: captured.HardLink.GroupID, SparseEvidence: json.RawMessage(`{}`),
		VerificationRef: fileVersionVerificationRef(prepared{entry: captured, protectionMode: protectionMode}),
		RecordDigest:    contentID, CreatedAt: createdAt,
	}
	representations := []sqlite.Representation{{
		ID: representationID, WorkspaceID: workspaceID, ContentID: contentID, DecodedLength: size,
		OwnershipMode: profile.ownership, CodecProfileRef: profile.codec, AccessMode: profile.access,
		WholeReadRequiredToVerify: profile.wholeRead, RecordDigest: contentID,
		Metadata: profile.metadata, CreatedAt: createdAt,
	}}
	extents := make([]sqlite.ContentExtent, 0, 1)
	if size > 0 {
		extentID, err := sqlite.NewStableID(sqlite.IDPrefixContentExtent)
		if err != nil {
			return catalogRelationWitness{}, err
		}
		extents = append(extents, sqlite.ContentExtent{
			ID: extentID, WorkspaceID: workspaceID, FileVersionID: fileVersionID,
			Ordinal: 0, LogicalOffset: 0, LogicalLength: size, Kind: sqlite.ExtentData,
			RepresentationID: representationID, RepresentationOffset: 0, ExtentDigest: contentID,
			Metadata: json.RawMessage(`{}`), CreatedAt: createdAt,
		})
	}
	selected := make(map[string]struct{})
	if manifestEntry.Protection.LocalRepresentationID != "" {
		selected[manifestEntry.Protection.LocalRepresentationID] = struct{}{}
	}
	for _, reference := range manifestEntry.Protection.RecoveryReferences {
		if reference.RepresentationID != "" {
			selected[reference.RepresentationID] = struct{}{}
		}
	}
	selectedRefs := make([]string, 0, len(selected))
	for id := range selected {
		selectedRefs = append(selectedRefs, id)
	}
	sort.Strings(selectedRefs)
	return catalogRelationWitnessPayload(fileVersion, representations, extents, snapshotRef, rootID, subjectRef, selectedRefs)
}

func (s *Service) publishRecoveryClosure(ctx context.Context, adopted adopted, manifest Manifest, placed placedSet, planDigest, captureDigest, policyDigest string) (result PublicationClosureResult, retErr error) {
	if !s.signedPublicationEnabled() {
		return result, nil
	}
	if s.SigningIdentity == nil || s.TrustAnchor == nil {
		return result, errors.New("signed publication requires a signing identity and trust anchor")
	}
	if strings.TrimSpace(s.PublicationDomain) == "" || strings.TrimSpace(planDigest) == "" {
		return result, errors.New("signed publication requires a publication domain and immutable plan digest")
	}
	if s.TrustAnchor.PublicationDomain != s.PublicationDomain {
		return result, errors.New("trust anchor publication domain differs from service configuration")
	}
	driver, err := s.publicationRecordDriver()
	if err != nil {
		return result, err
	}
	// The in-process mutex keeps one process from double-acquiring the same
	// owner; the cross-process fence below protects concurrent processes.
	s.publicationMu.Lock()
	defer s.publicationMu.Unlock()
	lease, err := s.acquirePublicationFence(ctx)
	if err != nil {
		return result, err
	}
	ctx = lease.context()
	defer func() {
		if releaseErr := lease.release(); releaseErr != nil {
			retErr = errors.Join(retErr, fmt.Errorf("%w: %w: %v", ErrNeedsReconciliation, ErrPublicationLeaseRelease, releaseErr))
		}
	}()
	existing, err := listCommitMarkers(ctx, driver, *s.TrustAnchor, s.PublicationDomain)
	if err != nil {
		return result, err
	}
	for _, publication := range existing {
		if publication.Commit.PlanDigest == planDigest {
			return result, fmt.Errorf("%w: plan %s", ErrPublicationAlreadyCommitted, planDigest)
		}
	}
	payloadReceipt, err := buildPayloadReceipt(driver, adopted.publicationID, manifest.SnapshotRef, placed)
	if err != nil {
		return result, err
	}
	if err := authenticateManifest(manifest); err != nil {
		return result, fmt.Errorf("authenticate prepared manifest: %w", err)
	}
	if err := compareManifestPayloadReceipt(manifest, payloadReceipt); err != nil {
		return result, fmt.Errorf("verify prepared payload coverage: %w", err)
	}
	payloadDigest, err := DigestCanonicalJSON(payloadReceipt)
	if err != nil {
		return result, err
	}
	evidence, err := buildMetadataEvidence(manifest)
	if err != nil {
		return result, err
	}
	verificationDigest, err := DigestCanonicalJSON(evidence)
	if err != nil {
		return result, err
	}
	generation, parentDigest := uint64(1), ""
	recordFenceToken := uint64(FallbackFenceToken)
	if len(existing) > 0 {
		latest := existing[len(existing)-1]
		generation, parentDigest = latest.Commit.Generation+1, latest.CommitDigest
		if latest.Commit.FenceToken == ^uint64(0) {
			return result, errors.New("publication fence token exhausted")
		}
		recordFenceToken = latest.Commit.FenceToken + 1
	}
	// The signed token must advance both the authenticated commit lineage and
	// the coordination lease counter. An abandoned lease can advance the
	// latter without producing a commit; reusing a smaller lineage token would
	// let a stale writer appear newer to readers.
	if lease.coordinationToken > 0 && uint64(lease.coordinationToken) > recordFenceToken {
		recordFenceToken = uint64(lease.coordinationToken)
	}
	if recordFenceToken == 0 {
		return result, errors.New("publication fence token exhausted")
	}
	lease.token = recordFenceToken
	prepared, err := SignPreparedClosure(*s.SigningIdentity, SignedPreparedClosure{
		Schema: PreparedClosureSchemaV1, SignatureDomain: RecoverySignatureDomainV1,
		RecordKind: PreparedClosureKind, PublicationID: adopted.publicationID,
		PublicationDomain: s.PublicationDomain, Generation: generation,
		SnapshotRef: manifest.SnapshotRef, RRFRootDigest: manifest.ManifestDigest,
		ManifestDigest: manifest.ManifestDigest, PayloadReceiptDigest: payloadDigest,
		PayloadReceiptLength:      payloadReceipt.TotalBytes,
		PayloadReceiptObjectCount: int64(len(payloadReceipt.Objects)), PlanDigest: planDigest,
		CaptureDigest: captureDigest, PolicyDigest: policyDigest,
		VerificationDigest: verificationDigest, TargetIdentity: driver.RepositoryIdentity(),
		FenceToken: lease.token, WriterIdentity: s.SigningIdentity.WriterIdentity,
		KeyID: s.SigningIdentity.KeyID, SignedAt: s.now(), ParentCommitDigest: parentDigest,
	})
	if err != nil {
		return result, err
	}
	envelopeSchema := PreparedEnvelopeSchemaV1
	if manifest.Schema == SnapshotSchemaV2 {
		envelopeSchema = PreparedEnvelopeSchemaV2
	}
	envelope := PreparedClosureEnvelope{
		Schema: envelopeSchema, Prepared: prepared, PayloadReceipt: payloadReceipt,
		VerificationEvidence: evidence, Manifest: manifest,
	}
	preparedBytes, err := CanonicalJSON(envelope)
	if err != nil {
		return result, err
	}
	// A manifest whose canonical envelope does not fit one repository record is
	// placed as content-addressed parts plus a v3 binding envelope. The signed
	// ManifestDigest still describes the reassembled manifest, so the parts
	// carry no trust of their own.
	var partPlacements []recordPartPlacement
	if int64(len(preparedBytes)) > repository.MaxRecordBytes {
		partPlacements, err = buildManifestEntryParts(manifest, manifest.ManifestDigest)
		if err != nil {
			return result, err
		}
		header := manifest
		header.Entries = nil
		envelope = PreparedClosureEnvelope{
			Schema: PreparedEnvelopeSchemaV3, Prepared: prepared, PayloadReceipt: payloadReceipt,
			VerificationEvidence: evidence, Manifest: header, ManifestParts: recordPartRefs(partPlacements),
		}
		if preparedBytes, err = CanonicalJSON(envelope); err != nil {
			return result, err
		}
	}
	for _, placement := range partPlacements {
		if err := s.validatePublicationFence(ctx, lease); err != nil {
			return result, err
		}
		receipt, placeErr := driver.PlaceRecord(ctx, repository.RecordPart, bytes.NewReader(placement.payload))
		if placeErr == nil {
			placeErr = driver.VerifyRecord(ctx, receipt)
		}
		if placeErr != nil {
			if reconcileErr := s.reconcileUnknownChildOutcome(ctx, driver, repository.RecordPart, placement.payload, adopted.publicationID, manifest.SnapshotRef, "", planDigest, fmt.Errorf("place prepared closure part %d: %w", placement.ref.Ordinal, placeErr)); reconcileErr != nil {
				return result, reconcileErr
			}
		}
	}
	if err := s.validatePublicationFence(ctx, lease); err != nil {
		return result, err
	}
	preparedReceipt, err := driver.PlaceRecord(ctx, repository.RecordPreparedClosure, bytes.NewReader(preparedBytes))
	if err != nil {
		return s.reconcileUnknownPublicationOutcome(ctx, driver, adopted.publicationID, manifest.SnapshotRef, planDigest, repository.RecordPreparedClosure, err)
	}
	if err := driver.VerifyRecord(ctx, preparedReceipt); err != nil {
		return s.reconcileUnknownPublicationOutcome(ctx, driver, adopted.publicationID, manifest.SnapshotRef, planDigest, repository.RecordPreparedClosure, fmt.Errorf("reconcile prepared closure: %w", err))
	}
	if err := s.validatePublicationFence(ctx, lease); err != nil {
		return s.reconcileUnknownPublicationOutcome(ctx, driver, adopted.publicationID, manifest.SnapshotRef, planDigest, repository.RecordPreparedClosure, err)
	}
	preparedReceiptDigest, err := DigestCanonicalJSON(stableReceipt(preparedReceipt))
	if err != nil {
		return result, err
	}
	commit, err := SignPublicationCommit(*s.SigningIdentity, PublicationCommitRecord{
		Schema: PublicationCommitSchemaV1, SignatureDomain: RecoverySignatureDomainV1,
		RecordKind: PublicationCommitKind, PublicationID: adopted.publicationID,
		PublicationDomain: s.PublicationDomain, Generation: generation,
		SnapshotRef: manifest.SnapshotRef, RRFRootDigest: manifest.ManifestDigest,
		ManifestDigest: manifest.ManifestDigest, PayloadReceiptDigest: payloadDigest,
		PayloadReceiptLength:      payloadReceipt.TotalBytes,
		PayloadReceiptObjectCount: int64(len(payloadReceipt.Objects)), PlanDigest: planDigest,
		CaptureDigest: captureDigest, PolicyDigest: policyDigest,
		VerificationDigest: verificationDigest, TargetIdentity: driver.RepositoryIdentity(),
		PreparedObjectDigest: preparedReceipt.Digest, PreparedReceiptDigest: preparedReceiptDigest,
		FenceToken: lease.token, WriterIdentity: s.SigningIdentity.WriterIdentity,
		KeyID: s.SigningIdentity.KeyID, SignedAt: s.now(), ParentCommitDigest: parentDigest,
	})
	if err != nil {
		return result, err
	}
	commitBytes, err := CanonicalJSON(commit)
	if err != nil {
		return result, err
	}
	if err := s.validatePublicationFence(ctx, lease); err != nil {
		return result, err
	}
	commitReceipt, err := driver.PlaceRecord(ctx, repository.RecordPublicationCommit, bytes.NewReader(commitBytes))
	if err != nil {
		return s.reconcileUnknownPublicationOutcome(ctx, driver, adopted.publicationID, manifest.SnapshotRef, planDigest, repository.RecordPublicationCommit, err)
	}
	if err := driver.VerifyRecord(ctx, commitReceipt); err != nil {
		return s.reconcileUnknownPublicationOutcome(ctx, driver, adopted.publicationID, manifest.SnapshotRef, planDigest, repository.RecordPublicationCommit, fmt.Errorf("reconcile publication commit: %w", err))
	}
	if err := s.validatePublicationFence(ctx, lease); err != nil {
		return s.reconcileUnknownPublicationOutcome(ctx, driver, adopted.publicationID, manifest.SnapshotRef, planDigest, repository.RecordPublicationCommit, err)
	}
	return PublicationClosureResult{PreparedDigest: preparedReceipt.Digest, CommitDigest: commitReceipt.Digest, Generation: generation}, nil
}

// reconcileUnknownPublicationOutcome observes the repository after an error
// from a placement boundary. A valid commit matching this operation is the
// only evidence that permits success; prepared-only or unverifiable evidence
// remains an explicit unknown outcome and must not be retried blindly.
func (s *Service) reconcileUnknownPublicationOutcome(ctx context.Context, driver repository.RecordDriver, publicationID, snapshotRef, planDigest string, role repository.RecordRole, cause error) (PublicationClosureResult, error) {
	reconcileCtx := context.WithoutCancel(ctx)
	if s != nil && s.TrustAnchor != nil && strings.TrimSpace(s.PublicationDomain) != "" {
		commits, err := listCommitMarkers(reconcileCtx, driver, *s.TrustAnchor, s.PublicationDomain)
		if err == nil {
			var match *committedPublication
			for i := range commits {
				candidate := commits[i]
				if candidate.Commit.PlanDigest != planDigest || candidate.Commit.PublicationID != publicationID || candidate.Commit.SnapshotRef != snapshotRef {
					continue
				}
				if match != nil && match.CommitDigest != candidate.CommitDigest {
					return PublicationClosureResult{}, &PublicationOutcomeError{
						PlanDigest: planDigest, SnapshotRef: snapshotRef, PublicationID: publicationID,
						Role: role, Cause: errors.New("conflicting committed publications for one execution key"),
					}
				}
				match = &candidate
			}
			if match != nil {
				return PublicationClosureResult{
					PreparedDigest: match.Commit.PreparedObjectDigest,
					CommitDigest:   match.CommitDigest,
					Generation:     match.Commit.Generation,
				}, nil
			}
		} else {
			cause = fmt.Errorf("observe committed publication: %w; original placement: %v", err, cause)
		}
	}
	return PublicationClosureResult{}, &PublicationOutcomeError{
		PlanDigest: planDigest, SnapshotRef: snapshotRef, PublicationID: publicationID,
		Role: role, Cause: cause,
	}
}

// reconcileUnknownChildOutcome observes one immutable post-publication child
// after PlaceRecord or VerifyRecord returned an error. The expected payload
// digest is known before placement, so an exact readback proves that the
// child committed; a missing, unreadable, or changed object remains an
// explicit unknown outcome and must not be retried blindly.
func (s *Service) reconcileUnknownChildOutcome(ctx context.Context, driver repository.RecordDriver, role repository.RecordRole, payload []byte, publicationID, snapshotRef, parentDigest, planDigest string, cause error) error {
	reconcileCtx := context.WithoutCancel(ctx)
	recordDigest := DigestBytes(payload)
	observed, err := readRecord(reconcileCtx, driver, role, recordDigest)
	if err == nil && bytes.Equal(observed, payload) {
		return nil
	}
	if err != nil {
		cause = fmt.Errorf("observe %s %s: %w; original placement: %v", role, recordDigest, err, cause)
	} else {
		cause = fmt.Errorf("observed %s %s differs from the signed payload; original placement: %v", role, recordDigest, cause)
	}
	return &PublicationOutcomeError{
		PlanDigest: planDigest, SnapshotRef: snapshotRef, PublicationID: publicationID,
		Role: role, Cause: cause,
	}
}

func stableReceipt(receipt repository.RecordReceipt) stableRecordReceipt {
	return stableRecordReceipt{RepositoryID: receipt.RepositoryID, Role: receipt.Role, Digest: receipt.Digest, Bytes: receipt.Bytes}
}

func nextPublicationGeneration(ctx context.Context, driver repository.RecordDriver, anchor TrustAnchor, domain string) (uint64, string, error) {
	commits, err := listCommitMarkers(ctx, driver, anchor, domain)
	if err != nil {
		return 0, "", err
	}
	if len(commits) == 0 {
		return 1, "", nil
	}
	latest := commits[len(commits)-1]
	return latest.Commit.Generation + 1, latest.CommitDigest, nil
}

func listCommitMarkers(ctx context.Context, driver repository.RecordDriver, anchor TrustAnchor, domain string) ([]committedPublication, error) {
	digests, err := driver.ListRecordDigests(ctx, repository.RecordPublicationCommit)
	if err != nil {
		return nil, err
	}
	byGeneration := make(map[uint64]string)
	commits := make([]committedPublication, 0, len(digests))
	for _, digest := range digests {
		payload, err := readRecord(ctx, driver, repository.RecordPublicationCommit, digest)
		if err != nil {
			return nil, err
		}
		var commit PublicationCommitRecord
		if err := decodeStrictRecord(payload, &commit); err != nil {
			return nil, fmt.Errorf("decode publication commit %s: %w", digest, err)
		}
		if commit.PublicationDomain != domain {
			continue
		}
		if commitDigest, err := commit.Digest(); err != nil || commitDigest != digest {
			return nil, fmt.Errorf("publication commit %s object digest mismatch", digest)
		}
		if err := commit.Verify(anchor); err != nil {
			return nil, fmt.Errorf("verify publication commit %s: %w", digest, err)
		}
		if commit.FenceToken == 0 {
			return nil, fmt.Errorf("publication commit %s has zero fencing token", digest)
		}
		if commit.TargetIdentity != driver.RepositoryIdentity() {
			return nil, fmt.Errorf("publication commit %s targets another repository", digest)
		}
		if previous, ok := byGeneration[commit.Generation]; ok && previous != digest {
			return nil, fmt.Errorf("conflicting publication commits at generation %d", commit.Generation)
		}
		byGeneration[commit.Generation] = digest
		commits = append(commits, committedPublication{CommitDigest: digest, Commit: commit})
	}
	sort.Slice(commits, func(i, j int) bool {
		if commits[i].Commit.Generation != commits[j].Commit.Generation {
			return commits[i].Commit.Generation < commits[j].Commit.Generation
		}
		return commits[i].CommitDigest < commits[j].CommitDigest
	})
	for i, commit := range commits {
		if i == 0 {
			if commit.Commit.Generation != 1 {
				return nil, fmt.Errorf("first publication commit has generation %d, want 1", commit.Commit.Generation)
			}
			if commit.Commit.ParentCommitDigest != "" {
				return nil, errors.New("genesis publication commit names a parent")
			}
			continue
		}
		previous := commits[i-1]
		if commit.Commit.Generation != previous.Commit.Generation+1 || commit.Commit.ParentCommitDigest != previous.CommitDigest {
			return nil, fmt.Errorf("publication commit generation %d breaks commit lineage", commit.Commit.Generation)
		}
		if commit.Commit.FenceToken <= previous.Commit.FenceToken {
			return nil, fmt.Errorf("publication commit generation %d has non-increasing fencing token", commit.Commit.Generation)
		}
	}
	return commits, nil
}

func readRecord(ctx context.Context, driver repository.RecordDriver, role repository.RecordRole, digest string) ([]byte, error) {
	body, err := driver.OpenRecord(ctx, role, digest)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	payload, err := io.ReadAll(io.LimitReader(body, portableRecordReadLimit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(payload)) > portableRecordReadLimit {
		return nil, errors.New("portable recovery record exceeds reader limit")
	}
	if DigestBytes(payload) != digest {
		return nil, fmt.Errorf("portable record %s digest mismatch", digest)
	}
	receipt := repository.RecordReceipt{
		RepositoryID: driver.RepositoryIdentity(), Role: role, Digest: digest, Bytes: int64(len(payload)),
	}
	if err := driver.VerifyRecord(ctx, receipt); err != nil {
		return nil, err
	}
	return payload, nil
}

func decodeStrictRecord(payload []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("record contains more than one JSON value")
		}
		return err
	}
	return nil
}

func (s *Service) committedPublications(ctx context.Context) ([]committedPublication, error) {
	if s.TrustAnchor == nil || strings.TrimSpace(s.PublicationDomain) == "" {
		return nil, errors.New("committed publication discovery requires an independent trust anchor and publication domain")
	}
	driver, err := s.publicationRecordDriver()
	if err != nil {
		return nil, err
	}
	markers, err := listCommitMarkers(ctx, driver, *s.TrustAnchor, s.PublicationDomain)
	if err != nil {
		return nil, err
	}
	for i := range markers {
		preparedBytes, err := readRecord(ctx, driver, repository.RecordPreparedClosure, markers[i].Commit.PreparedObjectDigest)
		if err != nil {
			return nil, err
		}
		var envelope PreparedClosureEnvelope
		if err := decodeStrictRecord(preparedBytes, &envelope); err != nil {
			return nil, fmt.Errorf("decode prepared closure %s: %w", markers[i].Commit.PreparedObjectDigest, err)
		}
		manifest, err := validatePreparedEnvelope(ctx, driver, *s.TrustAnchor, markers[i].Commit, envelope, int64(len(preparedBytes)))
		if err != nil {
			return nil, fmt.Errorf("validate publication %s: %w", markers[i].CommitDigest, err)
		}
		markers[i].Prepared = envelope
		markers[i].Manifest = manifest
	}
	return markers, nil
}

// validatePreparedEnvelopeHead authenticates the entry-independent part of one
// prepared publication closure against its signed commit: the schema and shape
// agreement, the prepared-closure signature, every prepared/commit binding, the
// placement receipt, the payload receipt with its totals, and the authenticated
// metadata evidence digest. It deliberately stops before the manifest entries.
//
// It is split out so a bounded read can report an authenticated restore-point
// identity without assembling the entry parts, which is the step that costs a
// full-library read. The returned bool is the v2 evidence shape, which the
// caller needs to continue. Verifying the signature before reading any part is
// also strictly safer than the previous order, which read attacker-named parts
// before authenticating the envelope that names them.
func validatePreparedEnvelopeHead(driver repository.RecordDriver, anchor TrustAnchor, commit PublicationCommitRecord, envelope PreparedClosureEnvelope, preparedLength int64) (bool, error) {
	v2Shape := envelope.Schema == PreparedEnvelopeSchemaV2 || envelope.Schema == PreparedEnvelopeSchemaV3
	switch envelope.Schema {
	case PreparedEnvelopeSchemaV1, PreparedEnvelopeSchemaV2:
		if len(envelope.ManifestParts) != 0 {
			return false, fmt.Errorf("prepared envelope %q carries a part binding", envelope.Schema)
		}
	case PreparedEnvelopeSchemaV3:
		if len(envelope.ManifestParts) == 0 {
			return false, errors.New("prepared envelope v3 requires a part binding")
		}
	default:
		return false, fmt.Errorf("unsupported prepared envelope schema %q", envelope.Schema)
	}
	if envelope.Schema == PreparedEnvelopeSchemaV1 && envelope.Manifest.Schema != SnapshotSchemaV1 {
		return false, errors.New("prepared envelope v1 must contain snapshot v1")
	}
	if v2Shape && envelope.Manifest.Schema != SnapshotSchemaV2 {
		return false, errors.New("prepared envelope v2 must contain snapshot v2")
	}
	if err := envelope.Prepared.Verify(anchor); err != nil {
		return false, err
	}
	p := envelope.Prepared
	if p.PublicationID != commit.PublicationID || p.PublicationDomain != commit.PublicationDomain ||
		p.Generation != commit.Generation || p.SnapshotRef != commit.SnapshotRef ||
		p.RRFRootDigest != commit.RRFRootDigest || p.ManifestDigest != commit.ManifestDigest ||
		p.PayloadReceiptDigest != commit.PayloadReceiptDigest || p.PayloadReceiptLength != commit.PayloadReceiptLength ||
		p.PayloadReceiptObjectCount != commit.PayloadReceiptObjectCount || p.PlanDigest != commit.PlanDigest ||
		p.CaptureDigest != commit.CaptureDigest || p.PolicyDigest != commit.PolicyDigest ||
		p.VerificationDigest != commit.VerificationDigest || p.TargetIdentity != commit.TargetIdentity ||
		p.FenceToken != commit.FenceToken || p.ParentCommitDigest != commit.ParentCommitDigest {
		return false, errors.New("prepared closure and publication commit bindings differ")
	}
	preparedReceiptDigest, err := DigestCanonicalJSON(stableRecordReceipt{
		RepositoryID: driver.RepositoryIdentity(), Role: repository.RecordPreparedClosure,
		Digest: commit.PreparedObjectDigest, Bytes: preparedLength,
	})
	if err != nil || preparedReceiptDigest != commit.PreparedReceiptDigest {
		return false, errors.New("prepared closure placement receipt digest mismatch")
	}
	if err := validatePayloadReceipt(envelope.PayloadReceipt); err != nil {
		return false, err
	}
	if envelope.PayloadReceipt.RepositoryID != driver.RepositoryIdentity() ||
		envelope.PayloadReceipt.PublicationID != commit.PublicationID || envelope.PayloadReceipt.SnapshotRef != commit.SnapshotRef {
		return false, errors.New("payload receipt publication binding mismatch")
	}
	payloadDigest, _ := DigestCanonicalJSON(envelope.PayloadReceipt)
	if payloadDigest != commit.PayloadReceiptDigest || envelope.PayloadReceipt.TotalBytes != commit.PayloadReceiptLength ||
		int64(len(envelope.PayloadReceipt.Objects)) != commit.PayloadReceiptObjectCount {
		return false, errors.New("payload receipt digest or totals mismatch")
	}
	verificationDigest, _ := DigestCanonicalJSON(envelope.VerificationEvidence)
	wantEvidenceSchema := MetadataEvidenceSchemaV1
	if v2Shape {
		wantEvidenceSchema = MetadataEvidenceSchemaV2
	}
	if envelope.VerificationEvidence.Schema != wantEvidenceSchema || verificationDigest != commit.VerificationDigest {
		return false, errors.New("authenticated metadata evidence mismatch")
	}
	return v2Shape, nil
}

// validatePreparedEnvelope authenticates one prepared publication closure
// against its signed commit and returns the complete logical manifest. For the
// part-bound v3 schema it reassembles the manifest entries from the
// content-addressed parts and requires their digest to equal the signed
// manifest digest, so a missing, reordered or substituted part fails closed.
func validatePreparedEnvelope(ctx context.Context, driver repository.RecordDriver, anchor TrustAnchor, commit PublicationCommitRecord, envelope PreparedClosureEnvelope, preparedLength int64) (Manifest, error) {
	v2Shape, err := validatePreparedEnvelopeHead(driver, anchor, commit, envelope, preparedLength)
	if err != nil {
		return Manifest{}, err
	}
	manifest := envelope.Manifest
	if envelope.Schema == PreparedEnvelopeSchemaV3 {
		entries, err := readManifestEntryParts(ctx, driver, manifest.ManifestDigest, envelope.ManifestParts)
		if err != nil {
			return Manifest{}, err
		}
		manifest.Entries = entries
	}
	verificationDigest, _ := DigestCanonicalJSON(envelope.VerificationEvidence)
	if v2Shape {
		if envelope.VerificationEvidence.PortableFactsSchema != PortableFactsSchemaV1 ||
			envelope.VerificationEvidence.PortableFactsDigest == "" ||
			envelope.VerificationEvidence.PortableFactsEntryCount != int64(len(manifest.Entries)) ||
			envelope.VerificationEvidence.PortableFactsCoverage != portableFactsCoveragePartial ||
			!sameStrings(envelope.VerificationEvidence.PortableFactsOmissions, portableFactsV1Omissions) {
			return Manifest{}, errors.New("portable file-fact coverage declaration is invalid")
		}
	}
	if err := authenticateManifest(manifest); err != nil {
		return Manifest{}, err
	}
	manifestDigest, err := manifest.Digest()
	if err != nil || manifestDigest != manifest.ManifestDigest || manifestDigest != commit.ManifestDigest {
		return Manifest{}, errors.New("manifest digest differs from signed publication")
	}
	if manifest.SnapshotRef != commit.SnapshotRef || envelope.VerificationEvidence.ManifestDigest != manifestDigest {
		return Manifest{}, errors.New("manifest publication binding mismatch")
	}
	if err := compareManifestPayloadReceipt(manifest, envelope.PayloadReceipt); err != nil {
		return Manifest{}, err
	}
	wantEvidence, err := buildMetadataEvidence(manifest)
	if err != nil {
		return Manifest{}, err
	}
	wantEvidenceDigest, _ := DigestCanonicalJSON(wantEvidence)
	if wantEvidenceDigest != verificationDigest {
		return Manifest{}, errors.New("authenticated metadata evidence does not describe the manifest")
	}
	return manifest, nil
}

func sameStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func compareManifestPayloadReceipt(manifest Manifest, receipt PayloadReceipt) error {
	want := make(map[string]int64)
	for _, entry := range manifest.Entries {
		if sqlite.NamespaceEntryType(entry.EntryType) != sqlite.EntryFile || entry.Protection.LocalRepresentationID == "" {
			continue
		}
		if entry.ContentID == "" || entry.Protection.ExpectedLogicalLength == nil {
			return fmt.Errorf("locally protected manifest entry %q lacks content identity or length", entry.RelativePath)
		}
		if !validExactContentID(entry.ContentID) {
			return fmt.Errorf("locally protected manifest entry %q has invalid content identity", entry.RelativePath)
		}
		length := *entry.Protection.ExpectedLogicalLength
		if previous, ok := want[entry.ContentID]; ok && previous != length {
			return fmt.Errorf("manifest content %s has conflicting lengths", entry.ContentID)
		}
		want[entry.ContentID] = length
	}
	if len(want) != len(receipt.Objects) {
		return errors.New("payload receipt object set differs from manifest")
	}
	for _, object := range receipt.Objects {
		expectedLength, ok := want[object.ContentID]
		if !ok || expectedLength != object.LogicalBytes {
			return fmt.Errorf("payload receipt for %s differs from manifest", object.ContentID)
		}
	}
	return nil
}

func (s *Service) loadManifest(ctx context.Context, snapshotRef string) (Manifest, error) {
	if !s.signedPublicationEnabled() {
		return readManifest(s.Repo.Root(), snapshotRef)
	}
	publication, err := s.committedPublicationForSnapshot(ctx, snapshotRef)
	if err != nil {
		return Manifest{}, err
	}
	return publication.Manifest, nil
}

func (s *Service) committedPublicationForSnapshot(ctx context.Context, snapshotRef string) (committedPublication, error) {
	publications, err := s.committedPublications(ctx)
	if err != nil {
		return committedPublication{}, err
	}
	var found *committedPublication
	for i := range publications {
		if publications[i].Manifest.SnapshotRef != snapshotRef {
			continue
		}
		if found != nil {
			return committedPublication{}, fmt.Errorf("conflicting committed publications for snapshot %s", snapshotRef)
		}
		copy := publications[i]
		found = &copy
	}
	if found == nil {
		return committedPublication{}, fmt.Errorf("%w: committed snapshot %s", repository.ErrNotFound, snapshotRef)
	}
	return *found, nil
}
