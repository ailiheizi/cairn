package exact

import (
	"bytes"
	"context"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// oldPreparedEnvelope mirrors the pre-ADR-033 prepared closure shape: it has no
// manifest_parts member. A reader at an older build uses exactly this struct, so
// decoding a part-bound record into it proves an older binary refuses rather
// than misreads.
type oldPreparedEnvelope struct {
	Schema               string                        `json:"schema"`
	Prepared             SignedPreparedClosure         `json:"prepared"`
	PayloadReceipt       PayloadReceipt                `json:"payload_receipt"`
	VerificationEvidence AuthenticatedMetadataEvidence `json:"verification_evidence"`
	Manifest             Manifest                      `json:"manifest"`
}

// oldFactEnvelope mirrors the pre-ADR-033 portable fact closure shape: it has an
// inline bundle and no bundle_parts member.
type oldFactEnvelope struct {
	Schema  string                    `json:"schema"`
	Closure PortableFactClosureRecord `json:"closure"`
	Bundle  json.RawMessage           `json:"bundle"`
}

// TestOldReaderRefusesPartBoundRecordsAndAcceptsTheOldShape is the explicit
// reader-dependency proof: the strict decoder an older binary uses rejects the
// new part binding as an unknown field, and accepts the unchanged monolithic
// shape.
func TestOldReaderRefusesPartBoundRecordsAndAcceptsTheOldShape(t *testing.T) {
	manifest := testManifest(t, 3, 0)
	placements, err := buildManifestEntryParts(manifest, manifest.ManifestDigest)
	if err != nil {
		t.Fatal(err)
	}
	partBound, err := CanonicalJSON(PreparedClosureEnvelope{
		Schema: PreparedEnvelopeSchemaV3, Manifest: headerManifest(manifest), ManifestParts: recordPartRefs(placements),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := decodeStrictRecord(partBound, &oldPreparedEnvelope{}); err == nil {
		t.Fatal("an old prepared-envelope reader accepted a part-bound v3 record")
	}
	monolithic, err := CanonicalJSON(PreparedClosureEnvelope{
		Schema: PreparedEnvelopeSchemaV2, Manifest: manifest,
	})
	if err != nil {
		t.Fatal(err)
	}
	var decoded oldPreparedEnvelope
	if err := decodeStrictRecord(monolithic, &decoded); err != nil {
		t.Fatalf("an old prepared-envelope reader rejected the monolithic v2 record: %v", err)
	}
	if decoded.Schema != PreparedEnvelopeSchemaV2 || len(decoded.Manifest.Entries) != len(manifest.Entries) {
		t.Fatalf("old reader decoded %q with %d entries", decoded.Schema, len(decoded.Manifest.Entries))
	}

	factPartBound, err := CanonicalJSON(PortableFactClosureEnvelope{
		Schema:      PortableFactClosureEnvelopeSchemaV3,
		BundleParts: []RecordPartRef{{Ordinal: 1, Digest: DigestBytes([]byte("x")), Bytes: 1, Count: 1}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := decodeStrictRecord(factPartBound, &oldFactEnvelope{}); err == nil {
		t.Fatal("an old fact-closure reader accepted a part-bound v3 record")
	}
	factMonolithic, err := CanonicalJSON(PortableFactClosureEnvelope{
		Schema: PortableFactClosureEnvelopeSchemaV2, Bundle: json.RawMessage(`{"schema":"x"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := decodeStrictRecord(factMonolithic, &oldFactEnvelope{}); err != nil {
		t.Fatalf("an old fact-closure reader rejected the monolithic v2 record: %v", err)
	}
}

// TestNewReaderAcceptsAMonolithicRecordWrittenByThePreviousFormat proves that a
// record written before this change is still read correctly: the write path for
// a record that fits is byte-identical, and it carries none of the new members
// a strict decoder would reject.
func TestNewReaderAcceptsAMonolithicRecordWrittenByThePreviousFormat(t *testing.T) {
	ctx := context.Background()
	fixture := newProjectionFixture(t, 12)
	plan, err := fixture.service.InspectIngest(ctx, fixture.source, IngestOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.service.ApplyIngestPlanWithExecutionKey(ctx, plan, "sha256:previous-format-plan"); err != nil {
		t.Fatal(err)
	}
	for _, role := range []repository.RecordRole{repository.RecordPreparedClosure, repository.RecordPortableFactClosure} {
		digests, err := fixture.repo.ListRecordDigests(ctx, role)
		if err != nil {
			t.Fatal(err)
		}
		if len(digests) != 1 {
			t.Fatalf("%s records = %d, want 1", role, len(digests))
		}
		payload, err := readRecord(ctx, fixture.repo, role, digests[0])
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(payload, []byte("manifest_parts")) || bytes.Contains(payload, []byte("bundle_parts")) {
			t.Fatalf("%s carries a part binding although it fits one record", role)
		}
	}
	publications, err := fixture.service.committedPublications(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(publications) != 1 {
		t.Fatalf("committed publications = %d, want 1", len(publications))
	}
	if publications[0].Prepared.Schema != PreparedEnvelopeSchemaV2 {
		t.Fatalf("previous-format prepared schema = %q, want the monolithic v2 shape", publications[0].Prepared.Schema)
	}
	if len(publications[0].Manifest.Entries) != fixture.projection.Entries {
		t.Fatalf("previous-format manifest entries = %d, want %d", len(publications[0].Manifest.Entries), fixture.projection.Entries)
	}
}

// TestManifestPartReaderRejectsReorderedSubstitutedAndTamperedParts proves every
// part damage mode fails closed against the signed manifest digest.
func TestManifestPartReaderRejectsReorderedSubstitutedAndTamperedParts(t *testing.T) {
	ctx := context.Background()
	driver, err := repository.OpenDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	manifest := testManifest(t, 12, 5<<20)
	placements, err := buildManifestEntryParts(manifest, manifest.ManifestDigest)
	if err != nil {
		t.Fatal(err)
	}
	if len(placements) < 3 {
		t.Fatalf("splitter produced %d parts, want at least 3 to exercise reordering", len(placements))
	}
	if _, err := placeRecordPartPlacements(ctx, driver, placements); err != nil {
		t.Fatal(err)
	}
	refs := recordPartRefs(placements)
	entries, err := readManifestEntryParts(ctx, driver, manifest.ManifestDigest, refs)
	if err != nil {
		t.Fatalf("read complete parts: %v", err)
	}
	if len(entries) != len(manifest.Entries) {
		t.Fatalf("reassembled entries = %d, want %d", len(entries), len(manifest.Entries))
	}

	swapped := append([]RecordPartRef(nil), refs...)
	swapped[0], swapped[1] = swapped[1], swapped[0]
	if _, err := readManifestEntryParts(ctx, driver, manifest.ManifestDigest, swapped); err == nil {
		t.Fatal("reordered manifest parts were accepted")
	}
	substituted := append([]RecordPartRef(nil), refs...)
	substituted[1].Digest = refs[2].Digest
	if _, err := readManifestEntryParts(ctx, driver, manifest.ManifestDigest, substituted); err == nil {
		t.Fatal("a substituted manifest part was accepted")
	}
	dropped := refs[:len(refs)-1]
	if _, err := readManifestEntryParts(ctx, driver, manifest.ManifestDigest, dropped); err == nil {
		t.Fatal("a dropped manifest part was accepted")
	}
	if _, err := readManifestEntryParts(ctx, driver, DigestBytes([]byte("another-record")), refs); err == nil {
		t.Fatal("manifest parts bound to another record were accepted")
	}
	changedCount := append([]RecordPartRef(nil), refs...)
	changedCount[0].Count++
	if _, err := readManifestEntryParts(ctx, driver, manifest.ManifestDigest, changedCount); err == nil {
		t.Fatal("a manifest part with a changed bound count was accepted")
	}
}

// TestFactBundlePartReaderRejectsReorderedSubstitutedAndTamperedParts is the
// same proof for the portable fact child.
func TestFactBundlePartReaderRejectsReorderedSubstitutedAndTamperedParts(t *testing.T) {
	ctx := context.Background()
	driver, err := repository.OpenDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	bundle := testBundle(t, 12, 5<<20)
	bundleBytes, err := CanonicalJSON(bundle)
	if err != nil {
		t.Fatal(err)
	}
	logicalDigest := DigestBytes(bundleBytes)
	placements, err := buildFactBundleParts(bundle, logicalDigest)
	if err != nil {
		t.Fatal(err)
	}
	if len(placements) < 3 {
		t.Fatalf("splitter produced %d parts, want at least 3 to exercise reordering", len(placements))
	}
	if _, err := placeRecordPartPlacements(ctx, driver, placements); err != nil {
		t.Fatal(err)
	}
	refs := recordPartRefs(placements)
	records, attachments, err := readFactBundleParts(ctx, driver, logicalDigest, refs)
	if err != nil {
		t.Fatalf("read complete parts: %v", err)
	}
	reassembled, err := CanonicalJSON(portableFactBundle{
		Schema: bundle.Schema, WorkspaceID: bundle.WorkspaceID, SnapshotRef: bundle.SnapshotRef,
		Records: records, Attachments: attachments,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(reassembled, bundleBytes) {
		t.Fatal("reassembled bundle does not reproduce the logical bundle bytes")
	}
	if DigestBytes(reassembled) != logicalDigest {
		t.Fatal("reassembled bundle digest differs from the logical digest")
	}

	swapped := append([]RecordPartRef(nil), refs...)
	swapped[0], swapped[1] = swapped[1], swapped[0]
	if _, _, err := readFactBundleParts(ctx, driver, logicalDigest, swapped); err == nil {
		t.Fatal("reordered fact parts were accepted")
	}
	substituted := append([]RecordPartRef(nil), refs...)
	substituted[1].Digest = refs[2].Digest
	if _, _, err := readFactBundleParts(ctx, driver, logicalDigest, substituted); err == nil {
		t.Fatal("a substituted fact part was accepted")
	}
	dropped := refs[:len(refs)-1]
	if _, _, err := readFactBundleParts(ctx, driver, logicalDigest, dropped); err == nil {
		t.Fatal("a dropped fact part was accepted")
	}
	if _, _, err := readFactBundleParts(ctx, driver, DigestBytes([]byte("another-bundle")), refs); err == nil {
		t.Fatal("fact parts bound to another bundle were accepted")
	}
}

// TestPartBoundPublicationFailsClosedAndStillRestores runs the whole thing end
// to end on one oversized source root: both logical records are part-bound, the
// bytes restore exactly from a catalog-free reader, and every on-disk part
// damage mode refuses a complete-publication claim.
func TestPartBoundPublicationFailsClosedAndStillRestores(t *testing.T) {
	ctx := context.Background()
	// The prepared closure grows by about 6.9 KB per entry on this fixture, so
	// this root crosses the 16 MiB bound for the prepared closure as well as the
	// portable fact child.
	fixture := newProjectionFixture(t, 2500)
	if fixture.projection.ExceedsLimit() {
		t.Fatalf("large fixture was refused: %+v", fixture.projection)
	}
	if fixture.projection.PreparedClosureBytes <= repository.MaxRecordBytes ||
		fixture.projection.PortableFactClosureBytes <= repository.MaxRecordBytes {
		t.Fatalf("fixture does not oversize both logical records: %+v", fixture.projection)
	}
	plan, err := fixture.service.InspectIngest(ctx, fixture.source, IngestOptions{})
	if err != nil {
		t.Fatal(err)
	}
	result, err := fixture.service.ApplyIngestPlanWithExecutionKey(ctx, plan, "sha256:part-damage-plan")
	if err != nil {
		t.Fatal(err)
	}
	commits, err := fixture.repo.ListRecordDigests(ctx, repository.RecordPublicationCommit)
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) != 1 {
		t.Fatalf("publication commits = %d, want 1", len(commits))
	}
	preparedParts := placedPreparedParts(t, ctx, fixture.repo, commits[0])
	factParts := placedFactParts(t, ctx, fixture.repo)
	if len(preparedParts) == 0 || len(factParts) == 0 {
		t.Fatalf("prepared parts = %d, fact parts = %d, want both part-bound", len(preparedParts), len(factParts))
	}

	// Exact-byte restore through the part-bound shape, from a reader that has no
	// catalog at all.
	reader := &Service{
		Repo: fixture.repo, TrustAnchor: fixture.service.TrustAnchor,
		PublicationDomain: fixture.service.PublicationDomain, RequireSignedPublication: true,
	}
	destination := t.TempDir()
	if _, err := reader.Restore(ctx, result.SnapshotRef, destination); err != nil {
		t.Fatalf("restore through the part-bound publication: %v", err)
	}
	restored := 0
	err = filepath.WalkDir(fixture.source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return walkErr
		}
		relative, err := filepath.Rel(fixture.source, path)
		if err != nil {
			return err
		}
		want, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		got, err := os.ReadFile(filepath.Join(destination, relative))
		if err != nil {
			return err
		}
		if !bytes.Equal(want, got) {
			t.Fatalf("restored %s differs from the stored bytes", relative)
		}
		restored++
		return nil
	})
	if err != nil {
		t.Fatalf("walk restored output: %v", err)
	}
	if want := fixture.projection.Entries - 1; restored != want {
		t.Fatalf("restored %d files, want the complete %d-file tree", restored, want)
	}

	// The independently retainable portable recovery record stays inside the
	// reader's artifact bound, loads, validates against the repository, and is
	// admitted by a catalog-free clean reader.
	referencePath := filepath.Join(t.TempDir(), "recovery-reference.json")
	exported, err := fixture.service.ExportRecoveryReference(ctx, result.SnapshotRef, referencePath)
	if err != nil {
		t.Fatalf("export recovery reference: %v", err)
	}
	if exported.Length > repository.MaxRecordBytes {
		t.Fatalf("recovery reference is %d bytes, above the %d-byte reader bound", exported.Length, repository.MaxRecordBytes)
	}
	if exported.Files != restored {
		t.Fatalf("recovery reference reports %d files, want %d", exported.Files, restored)
	}
	reference, err := LoadRecoveryReference(referencePath)
	if err != nil {
		t.Fatalf("load recovery reference: %v", err)
	}
	if reference.PreparedClosure.Schema != PreparedEnvelopeSchemaV3 {
		t.Fatalf("recovery reference prepared schema = %q, want the part-bound v3 shape", reference.PreparedClosure.Schema)
	}
	if err := reference.ValidateAgainstRepository(ctx, fixture.repo, *fixture.service.TrustAnchor); err != nil {
		t.Fatalf("validate recovery reference against the repository: %v", err)
	}
	compactPayload, err := MarshalCompactRecoveryReference(compactReferenceFromV2ForTest(t, reference))
	if err != nil {
		t.Fatalf("marshal compact reference over existing part-bound fixture: %v", err)
	}
	compactReference, err := DecodeCompactRecoveryReference(compactPayload)
	if err != nil {
		t.Fatalf("decode compact reference over existing part-bound fixture: %v", err)
	}
	if err := compactReference.ValidateAgainstRepository(ctx, fixture.repo, *fixture.service.TrustAnchor); err != nil {
		t.Fatalf("validate compact reference over prepared/fact parts: %v", err)
	}
	anchorPath := filepath.Join(t.TempDir(), "trust-anchor.json")
	if _, err := fixture.service.ExportTrustAnchor(anchorPath); err != nil {
		t.Fatalf("export trust anchor: %v", err)
	}
	imported, err := reader.ImportRecoveryArtifact(ctx, referencePath, anchorPath, fixture.service.PublicationDomain)
	if err != nil {
		t.Fatalf("clean reader admit recovery reference: %v", err)
	}
	if imported.Schema != RecoveryReferenceSchemaV2 || imported.Files != restored {
		t.Fatalf("clean reader admitted %q with %d files, want %s with %d", imported.Schema, imported.Files, RecoveryReferenceSchemaV2, restored)
	}

	// A truncated prepared part cannot be mistaken for a complete publication,
	// and restore refuses it.
	preparedPart := partFilePath(t, fixture.repo, preparedParts[0].Digest)
	payload, err := os.ReadFile(preparedPart)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preparedPart, payload[:len(payload)/2], 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.service.committedPublications(ctx); err == nil {
		t.Fatal("a truncated prepared part was accepted as a complete publication")
	}
	if _, err := reader.Restore(ctx, result.SnapshotRef, t.TempDir()); err == nil {
		t.Fatal("restore accepted a truncated prepared part")
	}
	if err := compactReference.ValidateAgainstRepository(ctx, fixture.repo, *fixture.service.TrustAnchor); err == nil {
		t.Fatal("compact recovery reference accepted a truncated prepared part")
	}
	if err := os.WriteFile(preparedPart, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.service.committedPublications(ctx); err != nil {
		t.Fatalf("restored part bytes were not accepted again: %v", err)
	}

	// A missing fact part leaves the fact child explicitly unavailable rather
	// than silently complete.
	factPart := partFilePath(t, fixture.repo, factParts[0].Digest)
	factPayload, err := os.ReadFile(factPart)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(factPart); err != nil {
		t.Fatal(err)
	}
	if _, err := listPortableFactClosures(ctx, fixture.repo, fixture.repo, *fixture.service.TrustAnchor, fixture.service.PublicationDomain, commits[0]); err == nil {
		t.Fatal("a missing fact part was accepted as a complete fact child")
	}
	if err := compactReference.ValidateAgainstRepository(ctx, fixture.repo, *fixture.service.TrustAnchor); err == nil {
		t.Fatal("compact recovery reference accepted a missing fact part")
	}
	if err := os.WriteFile(factPart, factPayload, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := listPortableFactClosures(ctx, fixture.repo, fixture.repo, *fixture.service.TrustAnchor, fixture.service.PublicationDomain, commits[0]); err != nil {
		t.Fatalf("restored fact part bytes were not accepted again: %v", err)
	}
	if err := compactReference.ValidateAgainstRepository(ctx, fixture.repo, *fixture.service.TrustAnchor); err != nil {
		t.Fatalf("restored fact part bytes were rejected by the compact reference: %v", err)
	}

	// A missing prepared part cannot be mistaken for a complete publication.
	if err := os.Remove(preparedPart); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.service.committedPublications(ctx); err == nil {
		t.Fatal("a missing prepared part was accepted as a complete publication")
	}
	if _, err := reader.Restore(ctx, result.SnapshotRef, t.TempDir()); err == nil {
		t.Fatal("restore accepted a missing prepared part")
	}
}

func placedPreparedParts(t *testing.T, ctx context.Context, repo *repository.Dir, commitDigest string) []RecordPartRef {
	t.Helper()
	payload, err := readRecord(ctx, repo, repository.RecordPublicationCommit, commitDigest)
	if err != nil {
		t.Fatal(err)
	}
	var commit PublicationCommitRecord
	if err := decodeStrictRecord(payload, &commit); err != nil {
		t.Fatal(err)
	}
	preparedPayload, err := readRecord(ctx, repo, repository.RecordPreparedClosure, commit.PreparedObjectDigest)
	if err != nil {
		t.Fatal(err)
	}
	var envelope PreparedClosureEnvelope
	if err := decodeStrictRecord(preparedPayload, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Schema != PreparedEnvelopeSchemaV3 {
		t.Fatalf("prepared envelope schema = %q, want v3", envelope.Schema)
	}
	return envelope.ManifestParts
}

func placedFactParts(t *testing.T, ctx context.Context, repo *repository.Dir) []RecordPartRef {
	t.Helper()
	digests, err := repo.ListRecordDigests(ctx, repository.RecordPortableFactClosure)
	if err != nil {
		t.Fatal(err)
	}
	if len(digests) != 1 {
		t.Fatalf("portable fact closures = %d, want 1", len(digests))
	}
	payload, err := readRecord(ctx, repo, repository.RecordPortableFactClosure, digests[0])
	if err != nil {
		t.Fatal(err)
	}
	var envelope PortableFactClosureEnvelope
	if err := decodeStrictRecord(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Schema != PortableFactClosureEnvelopeSchemaV3 {
		t.Fatalf("portable fact envelope schema = %q, want v3", envelope.Schema)
	}
	return envelope.BundleParts
}

// testManifest builds a manifest with count entries, each carrying an optional
// oversized metadata blob so the splitter produces several parts.
func testManifest(t *testing.T, count int, metadataBytes int) Manifest {
	t.Helper()
	entries := make([]ManifestEntry, 0, count)
	for index := 0; index < count; index++ {
		name := "entry-" + strconv.Itoa(index) + ".txt"
		entry := ManifestEntry{
			RelativePath: name, RawPath: []byte(name), RawName: []byte(name), EntryType: "file",
		}
		if metadataBytes > 0 {
			entry.MetadataAfter = json.RawMessage(`"` + strings.Repeat("m", metadataBytes) + `"`)
		}
		entries = append(entries, entry)
	}
	manifest := Manifest{Schema: SnapshotSchemaV2, SnapshotRef: "snap:part-test", Entries: entries}
	digest, err := manifest.Digest()
	if err != nil {
		t.Fatal(err)
	}
	manifest.ManifestDigest = digest
	return manifest
}

func headerManifest(manifest Manifest) Manifest {
	header := manifest
	header.Entries = nil
	return header
}

// testBundle builds a portable fact bundle with count oversized records so the
// splitter produces several parts.
func testBundle(t *testing.T, count int, recordBytes int) portableFactBundle {
	t.Helper()
	records := make([]portableFactRecord, 0, count)
	for index := 0; index < count; index++ {
		payload := json.RawMessage(`"` + strings.Repeat("p", recordBytes) + `"`)
		records = append(records, portableFactRecord{
			Schema: PortableFactRecordSchemaV2, RecordKind: "METADATA_FACT",
			RecordID: "record-" + strconv.Itoa(index), WorkspaceID: "ws:part-test", SnapshotRef: "snap:part-test",
			StableSubjectRef: "subj-" + strconv.Itoa(index), Revision: 1,
			PayloadDigest: DigestBytes(payload), PayloadLength: int64(len(payload)),
			Provenance: json.RawMessage(`{}`), Payload: payload,
		})
	}
	return portableFactBundle{
		Schema: PortableFactBundleSchemaV2, WorkspaceID: "ws:part-test", SnapshotRef: "snap:part-test",
		Records: records, Attachments: make([]portableFactAttachment, 0),
	}
}

// TestProcessorAttemptPartReaderRejectsReorderedSubstitutedAndTamperedParts is
// the same proof for the processor-attempt bundle, which is the third
// entry-scaling record and is what a real processed root actually crosses.
func TestProcessorAttemptPartReaderRejectsReorderedSubstitutedAndTamperedParts(t *testing.T) {
	ctx := context.Background()
	driver, err := repository.OpenDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	bundle := testAttemptBundle(t, 12, 5<<20)
	bundleBytes, err := CanonicalJSON(bundle)
	if err != nil {
		t.Fatal(err)
	}
	logicalDigest := DigestBytes(bundleBytes)
	placements, err := buildProcessorAttemptParts(bundle, logicalDigest)
	if err != nil {
		t.Fatal(err)
	}
	if len(placements) < 3 {
		t.Fatalf("splitter produced %d parts, want at least 3 to exercise reordering", len(placements))
	}
	if _, err := placeRecordPartPlacements(ctx, driver, placements); err != nil {
		t.Fatal(err)
	}
	refs := recordPartRefs(placements)
	attempts, err := readProcessorAttemptParts(ctx, driver, logicalDigest, refs)
	if err != nil {
		t.Fatalf("read complete parts: %v", err)
	}
	reassembled, err := CanonicalJSON(processorAttemptBundle{
		Schema: bundle.Schema, WorkspaceID: bundle.WorkspaceID, SnapshotRef: bundle.SnapshotRef, Attempts: attempts,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(reassembled, bundleBytes) {
		t.Fatal("reassembled processor attempt bundle does not reproduce the logical bytes")
	}
	if DigestBytes(reassembled) != logicalDigest {
		t.Fatal("reassembled processor attempt bundle digest differs from the logical digest")
	}

	swapped := append([]RecordPartRef(nil), refs...)
	swapped[0], swapped[1] = swapped[1], swapped[0]
	if _, err := readProcessorAttemptParts(ctx, driver, logicalDigest, swapped); err == nil {
		t.Fatal("reordered processor attempt parts were accepted")
	}
	substituted := append([]RecordPartRef(nil), refs...)
	substituted[1].Digest = refs[2].Digest
	if _, err := readProcessorAttemptParts(ctx, driver, logicalDigest, substituted); err == nil {
		t.Fatal("a substituted processor attempt part was accepted")
	}
	dropped := refs[:len(refs)-1]
	if _, err := readProcessorAttemptParts(ctx, driver, logicalDigest, dropped); err == nil {
		t.Fatal("a dropped processor attempt part was accepted")
	}
	if _, err := readProcessorAttemptParts(ctx, driver, DigestBytes([]byte("another-bundle")), refs); err == nil {
		t.Fatal("processor attempt parts bound to another bundle were accepted")
	}
}

// TestOldReaderRefusesPartBoundProcessorAttemptEnvelope proves an older binary
// refuses the v2 attempt envelope rather than reading a partial bundle.
func TestOldReaderRefusesPartBoundProcessorAttemptEnvelope(t *testing.T) {
	type oldAttemptEnvelope struct {
		Schema  string                        `json:"schema"`
		Closure ProcessorAttemptClosureRecord `json:"closure"`
		Bundle  json.RawMessage               `json:"bundle"`
	}
	partBound, err := CanonicalJSON(ProcessorAttemptClosureEnvelope{
		Schema:      ProcessorAttemptClosureEnvelopeSchemaV2,
		BundleParts: []RecordPartRef{{Ordinal: 1, Digest: DigestBytes([]byte("x")), Bytes: 1, Count: 1}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := decodeStrictRecord(partBound, &oldAttemptEnvelope{}); err == nil {
		t.Fatal("an old processor-attempt reader accepted a part-bound v2 envelope")
	}
	monolithic, err := CanonicalJSON(ProcessorAttemptClosureEnvelope{
		Schema: ProcessorAttemptClosureEnvelopeSchemaV1, Bundle: json.RawMessage(`{"schema":"x"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := decodeStrictRecord(monolithic, &oldAttemptEnvelope{}); err != nil {
		t.Fatalf("an old processor-attempt reader rejected the monolithic v1 envelope: %v", err)
	}
}

// testAttemptBundle builds a processor attempt bundle with count oversized
// attempts so the splitter produces several parts.
func testAttemptBundle(t *testing.T, count int, routeBytes int) processorAttemptBundle {
	t.Helper()
	attempts := make([]sqlite.ProcessorAttemptExport, 0, count)
	for index := 0; index < count; index++ {
		attempts = append(attempts, sqlite.ProcessorAttemptExport{
			WorkspaceID: "ws:part-test", SnapshotRef: "snap:part-test",
			AttemptID: "attempt-" + strconv.Itoa(index), SubjectRef: "subj-" + strconv.Itoa(index),
			RouteDigest: "sha256:" + strings.Repeat("a", 64), Stage: "PROCESS", CapabilityID: "EXTRACT",
			ReasonCode: "OK", ProcessorDigest: "sha256:" + strings.Repeat("b", 64), Status: "SUCCEEDED",
			FenceToken: 1, CreatedAt: time.Unix(1700000000, 0).UTC(), FinishedAt: time.Unix(1700000001, 0).UTC(),
			Route:      json.RawMessage(`"` + strings.Repeat("r", routeBytes) + `"`),
			Provenance: json.RawMessage(`{}`),
		})
	}
	return processorAttemptBundle{
		Schema: sqlite.ProcessorAttemptExportSchema, WorkspaceID: "ws:part-test", SnapshotRef: "snap:part-test",
		Attempts: attempts,
	}
}

func partFilePath(t *testing.T, repo *repository.Dir, digest string) string {
	t.Helper()
	hexDigest := strings.TrimPrefix(digest, repository.AlgorithmSHA256+":")
	path := filepath.Join(repo.Root(), "recovery", "parts", repository.AlgorithmSHA256, hexDigest[:2], hexDigest)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("part %s: %v", digest, err)
	}
	return path
}
