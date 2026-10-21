package exact

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestCatalogRelationWitnessBindingAndRoundTripStability(t *testing.T) {
	workspace := catalogWitnessTestID(t, sqlite.IDPrefixWorkspace)
	root := catalogWitnessTestID(t, sqlite.IDPrefixNamespaceRoot)
	subject := catalogWitnessTestID(t, sqlite.IDPrefixSubject)
	fileVersionID := catalogWitnessTestID(t, sqlite.IDPrefixFileVersion)
	representationID := catalogWitnessTestID(t, sqlite.IDPrefixRepresentation)
	extentID := catalogWitnessTestID(t, sqlite.IDPrefixContentExtent)
	scanID := catalogWitnessTestID(t, sqlite.IDPrefixScanGeneration)
	observationID := catalogWitnessTestID(t, sqlite.IDPrefixObservation)
	snapshot := "snapshot:catalog-relation"
	contentID := "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	created := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	length := int64(5)
	fv := sqlite.FileVersion{
		ID: fileVersionID, WorkspaceID: workspace, ScanGenerationID: scanID, ObservationID: observationID,
		AssetID: "asset:test", ContentID: contentID, LogicalSize: length, HashingProfile: "sha256-complete-stream-v1",
		AuthoritativeRepresentationID: representationID, ExtentSetDigest: contentID,
		SparseEvidence: json.RawMessage(`{"state":"UNKNOWN"}`), VerificationRef: "source-observation:" + contentID,
		RecordDigest: contentID, CreatedAt: created,
	}
	representation := sqlite.Representation{
		ID: representationID, WorkspaceID: workspace, ContentID: contentID, DecodedLength: length,
		OwnershipMode: sqlite.OwnershipEngineManaged, CodecProfileRef: "observed-reference/sha256-v1",
		AccessMode: sqlite.AccessWholeObjectOnly, WholeReadRequiredToVerify: true, RecordDigest: contentID,
		Metadata: json.RawMessage(`{"availability":"source-observed-not-retained"}`), CreatedAt: created,
	}
	extent := sqlite.ContentExtent{
		ID: extentID, WorkspaceID: workspace, FileVersionID: fileVersionID, Ordinal: 0,
		LogicalOffset: 0, LogicalLength: length, Kind: sqlite.ExtentData, RepresentationID: representationID,
		RepresentationOffset: 0, ExtentDigest: contentID, Metadata: json.RawMessage(`{}`), CreatedAt: created,
	}
	selected := []string{representationID}
	witness, err := catalogRelationWitnessPayload(fv, []sqlite.Representation{representation}, []sqlite.ContentExtent{extent}, snapshot, root, subject, selected)
	if err != nil {
		t.Fatal(err)
	}
	canonicalBefore, err := CanonicalJSON(witness)
	if err != nil {
		t.Fatal(err)
	}
	// Recovery installs new local FK handles. Re-publishing must normalize only
	// those handles so this authenticated snapshot witness remains byte-stable.
	fv.ScanGenerationID = catalogWitnessTestID(t, sqlite.IDPrefixScanGeneration)
	fv.ObservationID = catalogWitnessTestID(t, sqlite.IDPrefixObservation)
	republished, err := catalogRelationWitnessPayload(fv, []sqlite.Representation{representation}, []sqlite.ContentExtent{extent}, snapshot, root, subject, selected)
	if err != nil {
		t.Fatal(err)
	}
	canonicalAfter, err := CanonicalJSON(republished)
	if err != nil || !bytes.Equal(canonicalBefore, canonicalAfter) {
		t.Fatalf("re-published witness differs after local FK rebinding: err=%v", err)
	}

	mapping := subjectMappingPayload{
		WorkspaceID: workspace, NamespaceRootID: root, NamespaceEntryID: catalogWitnessTestID(t, sqlite.IDPrefixNamespaceEntry),
		StableSubjectRef: subject, EntryType: string(sqlite.EntryFile), ContentID: contentID,
		LogicalLength: &length, FileVersionID: fileVersionID, SelectedRepresentationRefs: selected,
		Protection: ManifestProtection{LocalRepresentationID: representation.ID},
	}
	fact, err := catalogRelationWitnessFact(workspace, snapshot, root, subject, witness)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := CanonicalJSON(fact)
	if err != nil {
		t.Fatal(err)
	}
	provenance, err := CanonicalJSON(map[string]any{
		"namespace": catalogRelationWitnessNamespace, "profile_digest": catalogRelationWitnessProfileDigest(),
		"snapshot_ref": snapshot, "namespace_root_id": root, "file_version_id": fileVersionID,
	})
	if err != nil {
		t.Fatal(err)
	}
	record := portableFactRecord{
		Schema: PortableFactRecordSchemaV2, RecordKind: "METADATA_FACT", RecordID: fact.ID,
		WorkspaceID: workspace, SnapshotRef: snapshot, StableSubjectRef: subject, Revision: 1,
		PayloadDigest: DigestBytes(payload), PayloadLength: int64(len(payload)), Provenance: provenance, Payload: payload,
	}
	bundle := portableFactBundle{Schema: PortableFactBundleSchemaV2, WorkspaceID: workspace, SnapshotRef: snapshot}
	decoded, err := decodeCatalogRelationWitness(record, bundle, mapping)
	if err != nil {
		t.Fatal(err)
	}
	decodedBytes, err := CanonicalJSON(decoded)
	if err != nil || !bytes.Equal(canonicalBefore, decodedBytes) {
		t.Fatalf("decoded witness differs from published value: err=%v", err)
	}

	decoded.ProfileDigest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	badValue, err := CanonicalJSON(decoded)
	if err != nil {
		t.Fatal(err)
	}
	fact.Value = badValue
	badPayload, err := CanonicalJSON(fact)
	if err != nil {
		t.Fatal(err)
	}
	record.Payload = badPayload
	record.PayloadDigest = DigestBytes(badPayload)
	record.PayloadLength = int64(len(badPayload))
	if _, err := decodeCatalogRelationWitness(record, bundle, mapping); err == nil {
		t.Fatal("unknown witness profile digest was accepted")
	}
}

func catalogWitnessTestID(t *testing.T, prefix string) string {
	t.Helper()
	id, err := sqlite.NewStableID(prefix)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestCatalogRelationWitnessNamespaceMatchIsExact(t *testing.T) {
	payload, err := CanonicalJSON(sqlite.MetadataFact{Namespace: catalogRelationWitnessNamespace + ".nearby"})
	if err != nil {
		t.Fatal(err)
	}
	if isCatalogRelationWitnessRecord(portableFactRecord{RecordKind: "METADATA_FACT", Payload: payload}) {
		t.Fatal("nearby user namespace was classified as a catalog relation witness")
	}
	if !isCatalogRelationWitnessRecord(portableFactRecord{RecordKind: "METADATA_FACT", Payload: json.RawMessage(`{"Namespace":"cairn.recovery.catalog-relation.v1"}`)}) {
		t.Fatal("exact reserved namespace was not recognized")
	}
}
