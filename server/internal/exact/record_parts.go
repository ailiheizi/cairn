package exact

import (
	"bytes"
	"context"
	"errors"
	"fmt"

	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// A logical portable record whose canonical JSON exceeds repository.MaxRecordBytes
// is placed as several content-addressed part records plus the binding record
// that already binds the logical value (ADR-033). The parts carry no trust of
// their own: the reader concatenates them in ordinal order and compares the
// re-derived canonical digest and counts against the values the existing
// signature already covers. A missing, reordered, truncated or substituted part
// therefore fails closed, and no catalog or index is consulted.
const (
	RecordPartSchemaManifestV1   = "org.cairn.record-part.manifest-entry.v1"
	RecordPartSchemaFactBundleV1 = "org.cairn.record-part.portable-fact-bundle.v1"

	// PreparedEnvelopeSchemaV3 is the successor to PreparedEnvelopeSchemaV2. Its
	// manifest member carries every manifest field except entries, and it adds
	// manifest_parts.
	PreparedEnvelopeSchemaV3 = "org.cairn.prepared-envelope.v3"
	// PortableFactClosureEnvelopeSchemaV3 is the successor to
	// PortableFactClosureEnvelopeSchemaV2. It drops the inline bundle and adds
	// bundle_parts.
	PortableFactClosureEnvelopeSchemaV3 = "org.cairn.portable-fact-closure-envelope.v3"

	// recordPartTargetBytes keeps each built part comfortably inside the hard
	// per-record bound after the part envelope's own fields and array
	// punctuation are added. The final payload is checked against the bound as
	// well, so this is a sizing target rather than the enforcement point.
	recordPartTargetBytes = repository.MaxRecordBytes - (64 << 10)
)

// RecordPartRef is one ordered part of a logical portable record. Digest and
// Bytes address the placed part record itself; Count is the number of logical
// items (manifest entries, or bundle records and attachments) the part carries.
type RecordPartRef struct {
	Ordinal int    `json:"ordinal"`
	Digest  string `json:"digest"`
	Bytes   int64  `json:"bytes"`
	Count   int64  `json:"count"`
}

type manifestEntryPart struct {
	Schema        string          `json:"schema"`
	LogicalDigest string          `json:"logical_digest"`
	Ordinal       int             `json:"ordinal"`
	Total         int             `json:"total"`
	Entries       []ManifestEntry `json:"entries"`
}

type portableFactBundlePart struct {
	Schema        string                   `json:"schema"`
	LogicalDigest string                   `json:"logical_digest"`
	Ordinal       int                      `json:"ordinal"`
	Total         int                      `json:"total"`
	Records       []portableFactRecord     `json:"records"`
	Attachments   []portableFactAttachment `json:"attachments"`
}

// recordPartPlacement is one built part together with the binding that names
// it. The payload is deterministic, so an unknown placement outcome can be
// reconciled against it without replaying source reads.
type recordPartPlacement struct {
	ref     RecordPartRef
	payload []byte
}

// buildManifestEntryParts splits the manifest entries of one oversized prepared
// closure into parts. It returns an explicit refusal when a single entry cannot
// fit a part, which is the only entry-scaling case that remains unplaceable.
func buildManifestEntryParts(manifest Manifest, logicalDigest string) ([]recordPartPlacement, error) {
	if len(manifest.Entries) == 0 {
		return nil, errors.New("a part-bound prepared closure requires at least one manifest entry")
	}
	overhead := recordPartOverhead(RecordPartSchemaManifestV1, logicalDigest)
	groups := make([][]ManifestEntry, 0, 1+len(manifest.Entries)/512)
	current := make([]ManifestEntry, 0, 512)
	used := overhead
	for _, entry := range manifest.Entries {
		encoded, err := CanonicalJSON(entry)
		if err != nil {
			return nil, err
		}
		size := int64(len(encoded)) + 1
		if overhead+size > repository.MaxRecordBytes {
			return nil, fmt.Errorf(
				"%w: one manifest entry serializes to %d bytes, above the %d-byte repository record limit",
				ErrPortableRecordTooLarge, len(encoded), repository.MaxRecordBytes,
			)
		}
		if used+size > recordPartTargetBytes && len(current) > 0 {
			groups = append(groups, current)
			current = make([]ManifestEntry, 0, 512)
			used = overhead
		}
		current = append(current, entry)
		used += size
	}
	groups = append(groups, current)
	total := len(groups)
	placements := make([]recordPartPlacement, 0, total)
	for index, group := range groups {
		payload, err := CanonicalJSON(manifestEntryPart{
			Schema: RecordPartSchemaManifestV1, LogicalDigest: logicalDigest,
			Ordinal: index + 1, Total: total, Entries: group,
		})
		if err != nil {
			return nil, err
		}
		if int64(len(payload)) > repository.MaxRecordBytes {
			return nil, fmt.Errorf(
				"%w: prepared closure part %d of %d is %d bytes, above the %d-byte repository record limit",
				ErrPortableRecordTooLarge, index+1, total, len(payload), repository.MaxRecordBytes,
			)
		}
		placements = append(placements, recordPartPlacement{
			ref:     RecordPartRef{Ordinal: index + 1, Digest: DigestBytes(payload), Bytes: int64(len(payload)), Count: int64(len(group))},
			payload: payload,
		})
	}
	return placements, nil
}

// buildFactBundleParts splits one oversized portable fact bundle into parts. The
// records keep their relative order and the attachments keep theirs, so
// re-canonicalizing the reassembled bundle reproduces the signed BundleDigest.
func buildFactBundleParts(bundle portableFactBundle, logicalDigest string) ([]recordPartPlacement, error) {
	if len(bundle.Records) == 0 && len(bundle.Attachments) == 0 {
		return nil, errors.New("a part-bound portable fact bundle requires at least one item")
	}
	type group struct {
		records     []portableFactRecord
		attachments []portableFactAttachment
	}
	overhead := recordPartOverhead(RecordPartSchemaFactBundleV1, logicalDigest)
	groups := make([]group, 0, 1+(len(bundle.Records)+len(bundle.Attachments))/512)
	current := group{}
	used := overhead
	flush := func() {
		groups = append(groups, current)
		current = group{}
		used = overhead
	}
	for _, record := range bundle.Records {
		encoded, err := CanonicalJSON(record)
		if err != nil {
			return nil, err
		}
		size := int64(len(encoded)) + 1
		if overhead+size > repository.MaxRecordBytes {
			return nil, fmt.Errorf(
				"%w: one portable fact record serializes to %d bytes, above the %d-byte repository record limit",
				ErrPortableRecordTooLarge, len(encoded), repository.MaxRecordBytes,
			)
		}
		if used+size > recordPartTargetBytes && (len(current.records) > 0 || len(current.attachments) > 0) {
			flush()
		}
		current.records = append(current.records, record)
		used += size
	}
	for _, attachment := range bundle.Attachments {
		encoded, err := CanonicalJSON(attachment)
		if err != nil {
			return nil, err
		}
		size := int64(len(encoded)) + 1
		if overhead+size > repository.MaxRecordBytes {
			return nil, fmt.Errorf(
				"%w: one portable fact attachment serializes to %d bytes, above the %d-byte repository record limit",
				ErrPortableRecordTooLarge, len(encoded), repository.MaxRecordBytes,
			)
		}
		if used+size > recordPartTargetBytes && (len(current.records) > 0 || len(current.attachments) > 0) {
			flush()
		}
		current.attachments = append(current.attachments, attachment)
		used += size
	}
	flush()
	total := len(groups)
	placements := make([]recordPartPlacement, 0, total)
	for index, part := range groups {
		payload, err := CanonicalJSON(portableFactBundlePart{
			Schema: RecordPartSchemaFactBundleV1, LogicalDigest: logicalDigest,
			Ordinal: index + 1, Total: total, Records: part.records, Attachments: part.attachments,
		})
		if err != nil {
			return nil, err
		}
		if int64(len(payload)) > repository.MaxRecordBytes {
			return nil, fmt.Errorf(
				"%w: portable fact part %d of %d is %d bytes, above the %d-byte repository record limit",
				ErrPortableRecordTooLarge, index+1, total, len(payload), repository.MaxRecordBytes,
			)
		}
		placements = append(placements, recordPartPlacement{
			ref: RecordPartRef{
				Ordinal: index + 1, Digest: DigestBytes(payload), Bytes: int64(len(payload)),
				Count: int64(len(part.records) + len(part.attachments)),
			},
			payload: payload,
		})
	}
	return placements, nil
}

// recordPartOverhead is a generous upper bound on the bytes one part envelope
// spends on everything except its item array. The 64 KiB sizing margin already
// absorbs the difference between this estimate and the true digits.
func recordPartOverhead(schema, logicalDigest string) int64 {
	return int64(len(schema)+len(logicalDigest)) + 256
}

func recordPartRefs(placements []recordPartPlacement) []RecordPartRef {
	refs := make([]RecordPartRef, 0, len(placements))
	for _, placement := range placements {
		refs = append(refs, placement.ref)
	}
	return refs
}

func validateRecordPartRefs(logicalDigest string, refs []RecordPartRef) error {
	if !validExactContentID(logicalDigest) {
		return errors.New("part-bound record logical digest is invalid")
	}
	if len(refs) == 0 {
		return errors.New("part-bound record requires at least one part")
	}
	for index, ref := range refs {
		if ref.Ordinal != index+1 {
			return fmt.Errorf("record part ordinal %d appears at position %d", ref.Ordinal, index+1)
		}
		if !validExactContentID(ref.Digest) || ref.Bytes <= 0 || ref.Bytes > repository.MaxRecordBytes || ref.Count < 0 {
			return fmt.Errorf("record part %d of %d has an invalid binding", ref.Ordinal, len(refs))
		}
	}
	return nil
}

func readManifestEntryParts(ctx context.Context, driver repository.RecordDriver, logicalDigest string, refs []RecordPartRef) ([]ManifestEntry, error) {
	if err := validateRecordPartRefs(logicalDigest, refs); err != nil {
		return nil, err
	}
	total := len(refs)
	entries := make([]ManifestEntry, 0, total)
	for _, ref := range refs {
		payload, err := readRecord(ctx, driver, repository.RecordPart, ref.Digest)
		if err != nil {
			return nil, fmt.Errorf("read prepared closure part %d of %d: %w", ref.Ordinal, total, err)
		}
		var part manifestEntryPart
		if err := decodeStrictRecord(payload, &part); err != nil {
			return nil, fmt.Errorf("decode prepared closure part %d of %d: %w", ref.Ordinal, total, err)
		}
		if part.Schema != RecordPartSchemaManifestV1 || part.LogicalDigest != logicalDigest ||
			part.Ordinal != ref.Ordinal || part.Total != total ||
			int64(len(part.Entries)) != ref.Count || int64(len(payload)) != ref.Bytes {
			return nil, fmt.Errorf("prepared closure part %d of %d does not match its binding", ref.Ordinal, total)
		}
		entries = append(entries, part.Entries...)
	}
	return entries, nil
}

func readFactBundleParts(ctx context.Context, driver repository.RecordDriver, logicalDigest string, refs []RecordPartRef) ([]portableFactRecord, []portableFactAttachment, error) {
	if err := validateRecordPartRefs(logicalDigest, refs); err != nil {
		return nil, nil, err
	}
	total := len(refs)
	// The portable fact builder always emits non-nil record and attachment
	// arrays, and re-canonicalizing the reassembled bundle must reproduce the
	// signed BundleDigest byte for byte.
	records := make([]portableFactRecord, 0)
	attachments := make([]portableFactAttachment, 0)
	for _, ref := range refs {
		payload, err := readRecord(ctx, driver, repository.RecordPart, ref.Digest)
		if err != nil {
			return nil, nil, fmt.Errorf("read portable fact part %d of %d: %w", ref.Ordinal, total, err)
		}
		var part portableFactBundlePart
		if err := decodeStrictRecord(payload, &part); err != nil {
			return nil, nil, fmt.Errorf("decode portable fact part %d of %d: %w", ref.Ordinal, total, err)
		}
		if part.Schema != RecordPartSchemaFactBundleV1 || part.LogicalDigest != logicalDigest ||
			part.Ordinal != ref.Ordinal || part.Total != total ||
			int64(len(part.Records)+len(part.Attachments)) != ref.Count || int64(len(payload)) != ref.Bytes {
			return nil, nil, fmt.Errorf("portable fact part %d of %d does not match its binding", ref.Ordinal, total)
		}
		records = append(records, part.Records...)
		attachments = append(attachments, part.Attachments...)
	}
	return records, attachments, nil
}

// placeRecordPartPlacements places every built part and verifies its readback.
// It is the caller's responsibility to reconcile an unknown outcome through the
// publication identity the enclosing record carries.
func placeRecordPartPlacements(ctx context.Context, driver repository.RecordDriver, placements []recordPartPlacement) (recordPartPlacement, error) {
	for _, placement := range placements {
		if err := ctx.Err(); err != nil {
			return placement, err
		}
		receipt, err := driver.PlaceRecord(ctx, repository.RecordPart, bytes.NewReader(placement.payload))
		if err != nil {
			return placement, err
		}
		if err := driver.VerifyRecord(ctx, receipt); err != nil {
			return placement, err
		}
	}
	return recordPartPlacement{}, nil
}

// openPortableFactBundle fills Bundle for a part-bound v3 fact envelope by
// reassembling its content-addressed parts. The reassembled canonical bytes are
// checked against the signed BundleDigest by the caller's existing binding
// checks, so a missing, reordered or substituted part fails closed.
func openPortableFactBundle(ctx context.Context, driver repository.RecordDriver, envelope *PortableFactClosureEnvelope) error {
	if envelope == nil {
		return errors.New("portable fact closure envelope is required")
	}
	switch envelope.Schema {
	case PortableFactClosureEnvelopeSchemaV1, PortableFactClosureEnvelopeSchemaV2:
		if len(envelope.BundleParts) != 0 {
			return fmt.Errorf("portable fact closure envelope %q carries a part binding", envelope.Schema)
		}
		if len(envelope.Bundle) == 0 {
			return errors.New("portable fact closure envelope has no bundle")
		}
		return nil
	case PortableFactClosureEnvelopeSchemaV3:
		if len(envelope.Bundle) != 0 {
			return errors.New("portable fact closure envelope v3 must not carry an inline bundle")
		}
		records, attachments, err := readFactBundleParts(ctx, driver, envelope.Closure.BundleDigest, envelope.BundleParts)
		if err != nil {
			return err
		}
		bundleBytes, err := CanonicalJSON(portableFactBundle{
			Schema: envelope.Closure.BundleSchema, WorkspaceID: envelope.Closure.WorkspaceID,
			SnapshotRef: envelope.Closure.SnapshotRef, Records: records, Attachments: attachments,
		})
		if err != nil {
			return err
		}
		envelope.Bundle = bundleBytes
		return nil
	default:
		return fmt.Errorf("unsupported portable fact closure envelope schema %q", envelope.Schema)
	}
}

func partBoundFactEnvelope(envelope PortableFactClosureEnvelope) bool {
	return envelope.Schema == PortableFactClosureEnvelopeSchemaV3
}

// buildProcessorAttemptParts splits one oversized processor attempt bundle into
// parts. Reassembly re-marshals the same struct, so concatenating the bound
// attempts in ordinal order reproduces the signed AttemptBundleDigest byte for
// byte.
func buildProcessorAttemptParts(bundle processorAttemptBundle, logicalDigest string) ([]recordPartPlacement, error) {
	if len(bundle.Attempts) == 0 {
		return nil, errors.New("a part-bound processor attempt bundle requires at least one attempt")
	}
	overhead := recordPartOverhead(ProcessorAttemptBundlePartSchemaV1, logicalDigest)
	groups := make([][]sqlite.ProcessorAttemptExport, 0, 1+len(bundle.Attempts)/512)
	current := make([]sqlite.ProcessorAttemptExport, 0, 512)
	used := overhead
	for _, attempt := range bundle.Attempts {
		encoded, err := CanonicalJSON(attempt)
		if err != nil {
			return nil, err
		}
		size := int64(len(encoded)) + 1
		if overhead+size > repository.MaxRecordBytes {
			return nil, fmt.Errorf(
				"%w: one processor attempt serializes to %d bytes, above the %d-byte repository record limit",
				ErrPortableRecordTooLarge, len(encoded), repository.MaxRecordBytes,
			)
		}
		if used+size > recordPartTargetBytes && len(current) > 0 {
			groups = append(groups, current)
			current = make([]sqlite.ProcessorAttemptExport, 0, 512)
			used = overhead
		}
		current = append(current, attempt)
		used += size
	}
	groups = append(groups, current)
	total := len(groups)
	placements := make([]recordPartPlacement, 0, total)
	for index, group := range groups {
		payload, err := CanonicalJSON(processorAttemptBundlePart{
			Schema: ProcessorAttemptBundlePartSchemaV1, LogicalDigest: logicalDigest,
			Ordinal: index + 1, Total: total, Attempts: group,
		})
		if err != nil {
			return nil, err
		}
		if int64(len(payload)) > repository.MaxRecordBytes {
			return nil, fmt.Errorf(
				"%w: processor attempt part %d of %d is %d bytes, above the %d-byte repository record limit",
				ErrPortableRecordTooLarge, index+1, total, len(payload), repository.MaxRecordBytes,
			)
		}
		placements = append(placements, recordPartPlacement{
			ref:     RecordPartRef{Ordinal: index + 1, Digest: DigestBytes(payload), Bytes: int64(len(payload)), Count: int64(len(group))},
			payload: payload,
		})
	}
	return placements, nil
}

func readProcessorAttemptParts(ctx context.Context, driver repository.RecordDriver, logicalDigest string, refs []RecordPartRef) ([]sqlite.ProcessorAttemptExport, error) {
	if err := validateRecordPartRefs(logicalDigest, refs); err != nil {
		return nil, err
	}
	total := len(refs)
	attempts := make([]sqlite.ProcessorAttemptExport, 0, total)
	for _, ref := range refs {
		payload, err := readRecord(ctx, driver, repository.RecordPart, ref.Digest)
		if err != nil {
			return nil, fmt.Errorf("read processor attempt part %d of %d: %w", ref.Ordinal, total, err)
		}
		var part processorAttemptBundlePart
		if err := decodeStrictRecord(payload, &part); err != nil {
			return nil, fmt.Errorf("decode processor attempt part %d of %d: %w", ref.Ordinal, total, err)
		}
		if part.Schema != ProcessorAttemptBundlePartSchemaV1 || part.LogicalDigest != logicalDigest ||
			part.Ordinal != ref.Ordinal || part.Total != total ||
			int64(len(part.Attempts)) != ref.Count || int64(len(payload)) != ref.Bytes {
			return nil, fmt.Errorf("processor attempt part %d of %d does not match its binding", ref.Ordinal, total)
		}
		attempts = append(attempts, part.Attempts...)
	}
	return attempts, nil
}

// openProcessorAttemptBundle fills Bundle for a part-bound v2 attempt envelope
// by reassembling its content-addressed parts. The caller's existing binding
// checks against the signed AttemptBundleDigest, length and count then decide
// whether the reassembly is complete.
func openProcessorAttemptBundle(ctx context.Context, driver repository.RecordDriver, envelope *ProcessorAttemptClosureEnvelope) error {
	if envelope == nil {
		return errors.New("processor attempt closure envelope is required")
	}
	switch envelope.Schema {
	case ProcessorAttemptClosureEnvelopeSchemaV1:
		if len(envelope.BundleParts) != 0 {
			return errors.New("processor attempt closure envelope v1 carries a part binding")
		}
		if len(envelope.Bundle) == 0 {
			return errors.New("processor attempt closure envelope has no bundle")
		}
		return nil
	case ProcessorAttemptClosureEnvelopeSchemaV2:
		if len(envelope.Bundle) != 0 {
			return errors.New("processor attempt closure envelope v2 must not carry an inline bundle")
		}
		attempts, err := readProcessorAttemptParts(ctx, driver, envelope.Closure.AttemptBundleDigest, envelope.BundleParts)
		if err != nil {
			return err
		}
		bundleBytes, err := CanonicalJSON(processorAttemptBundle{
			Schema: envelope.Closure.AttemptBundleSchema, WorkspaceID: envelope.Closure.WorkspaceID,
			SnapshotRef: envelope.Closure.SnapshotRef, Attempts: attempts,
		})
		if err != nil {
			return err
		}
		envelope.Bundle = bundleBytes
		return nil
	default:
		return fmt.Errorf("unsupported processor attempt closure envelope schema %q", envelope.Schema)
	}
}

func partBoundAttemptEnvelope(envelope ProcessorAttemptClosureEnvelope) bool {
	return envelope.Schema == ProcessorAttemptClosureEnvelopeSchemaV2
}

// placedFactEnvelope returns the envelope exactly as it was placed: the
// reassembled inline bundle is dropped for a part-bound v3 envelope so its
// canonical JSON still reproduces the placed record digest.
func placedFactEnvelope(envelope PortableFactClosureEnvelope) PortableFactClosureEnvelope {
	if len(envelope.BundleParts) == 0 {
		return envelope
	}
	envelope.Bundle = nil
	return envelope
}

func partBoundPreparedEnvelope(envelope PreparedClosureEnvelope) bool {
	return envelope.Schema == PreparedEnvelopeSchemaV3
}
