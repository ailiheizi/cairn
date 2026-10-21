package exact

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

const catalogRelationWitnessNamespace = "cairn.recovery.catalog-relation.v1"
const catalogRelationWitnessSchema = "org.cairn.catalog-relation-witness.v1"
const catalogRelationWitnessAuthority = "SYSTEM_CATALOG_EXPORT"
const catalogRelationWitnessKeyPrefix = "file-version:"
const catalogRelationWitnessSourcePrefix = "cairn:snapshot-catalog-relation:"

// Changing any fixed profile meaning requires a new namespace/schema and
// profile digest. This is a typed payload profile of METADATA_FACT only.
const catalogRelationWitnessProfileDefinition = "org.cairn.catalog-relation-witness.v1|whole-logical-stream-extents-v1|immutable-file-version-and-representation-rows-v1|local-scan-observation-handles-excluded-v1"

// This fixed metadata-value profile retains original catalog facts. It never
// turns a recovered route into current byte availability or a new authority.
type catalogRelationWitness struct {
	Schema           string                  `json:"schema"`
	ProfileDigest    string                  `json:"profile_digest"`
	SnapshotRef      string                  `json:"snapshot_ref"`
	NamespaceRootID  string                  `json:"namespace_root_id"`
	StableSubjectRef string                  `json:"stable_subject_ref"`
	FileVersion      sqlite.FileVersion      `json:"file_version"`
	Representations  []sqlite.Representation `json:"representations"`
	ContentExtents   []sqlite.ContentExtent  `json:"content_extents"`
}

func catalogRelationWitnessProfileDigest() string {
	return DigestBytes([]byte(catalogRelationWitnessProfileDefinition))
}

// isCatalogRelationWitnessRecord deliberately recognizes only the exact
// reserved namespace. Nearby user namespaces stay on the ordinary fact path.
func isCatalogRelationWitnessRecord(record portableFactRecord) bool {
	if record.RecordKind != "METADATA_FACT" {
		return false
	}
	var identity struct {
		Namespace string `json:"Namespace"`
	}
	if json.Unmarshal(record.Payload, &identity) != nil {
		return false
	}
	return identity.Namespace == catalogRelationWitnessNamespace
}

func catalogRelationWitnessRecordID(snapshotRef, rootID, subjectRef, fileVersionID string) string {
	material := strings.Join([]string{catalogRelationWitnessNamespace, snapshotRef, rootID, subjectRef, fileVersionID}, "\x00")
	digest := sha256.Sum256([]byte(material))
	return sqlite.IDPrefixMetadataFact + "_" + hex.EncodeToString(digest[:16])
}

func catalogRelationWitnessKey(fileVersionID string) string {
	return catalogRelationWitnessKeyPrefix + fileVersionID
}

func catalogRelationWitnessSource(snapshotRef, rootID, subjectRef, fileVersionID string) string {
	return strings.Join([]string{catalogRelationWitnessSourcePrefix, snapshotRef, rootID, subjectRef, fileVersionID}, ":")
}

// catalogRelationWitnessPayload normalizes only the two local FK handles. All
// other FileVersion, Representation, and ContentExtent fields are copied from
// the actual catalog rows so a recovery followed by republishing is stable.
func catalogRelationWitnessPayload(fileVersion sqlite.FileVersion, representations []sqlite.Representation, extents []sqlite.ContentExtent, snapshotRef, rootID, subjectRef string, selectedRefs []string) (catalogRelationWitness, error) {
	if snapshotRef == "" || rootID == "" || subjectRef == "" || fileVersion.ID == "" || fileVersion.WorkspaceID == "" {
		return catalogRelationWitness{}, errors.New("catalog relation witness identity is incomplete")
	}
	fileVersion.ScanGenerationID = ""
	fileVersion.ObservationID = ""
	representationRows := make([]sqlite.Representation, len(representations))
	copy(representationRows, representations)
	extentRows := make([]sqlite.ContentExtent, len(extents))
	copy(extentRows, extents)
	sort.Slice(representationRows, func(i, j int) bool { return representationRows[i].ID < representationRows[j].ID })
	sort.Slice(extentRows, func(i, j int) bool { return extentRows[i].Ordinal < extentRows[j].Ordinal })
	witness := catalogRelationWitness{
		Schema: catalogRelationWitnessSchema, ProfileDigest: catalogRelationWitnessProfileDigest(),
		SnapshotRef: snapshotRef, NamespaceRootID: rootID, StableSubjectRef: subjectRef,
		FileVersion: fileVersion, Representations: representationRows, ContentExtents: extentRows,
	}
	if err := validateCatalogRelationWitnessValue(witness, fileVersion.WorkspaceID, snapshotRef, rootID, subjectRef, fileVersion.ID, fileVersion.ContentID, fileVersion.LogicalSize, selectedRefs); err != nil {
		return catalogRelationWitness{}, err
	}
	return witness, nil
}

func catalogRelationWitnessFact(workspaceID, snapshotRef, rootID, subjectRef string, witness catalogRelationWitness) (sqlite.MetadataFact, error) {
	if workspaceID == "" || workspaceID != witness.FileVersion.WorkspaceID || subjectRef != witness.StableSubjectRef ||
		snapshotRef != witness.SnapshotRef || rootID != witness.NamespaceRootID {
		return sqlite.MetadataFact{}, errors.New("catalog relation witness metadata fact scope differs from its value")
	}
	value, err := CanonicalJSON(witness)
	if err != nil {
		return sqlite.MetadataFact{}, err
	}
	fileVersionID := witness.FileVersion.ID
	return sqlite.MetadataFact{
		ID:          catalogRelationWitnessRecordID(snapshotRef, rootID, subjectRef, fileVersionID),
		WorkspaceID: workspaceID, SubjectRef: subjectRef, Namespace: catalogRelationWitnessNamespace,
		Key: catalogRelationWitnessKey(fileVersionID), Value: value, ValueType: "OBJECT",
		AuthorityClass: catalogRelationWitnessAuthority,
		SourceRef:      catalogRelationWitnessSource(snapshotRef, rootID, subjectRef, fileVersionID),
		Revision:       1, CreatedAt: witness.FileVersion.CreatedAt.UTC(),
	}, nil
}

func buildCatalogRelationWitness(ctx context.Context, store *sqlite.Store, workspaceID, snapshotRef, rootID string, mapping subjectMappingPayload) (catalogRelationWitness, error) {
	if store == nil || mapping.EntryType != string(sqlite.EntryFile) || mapping.FileVersionID == "" || mapping.StableSubjectRef == "" ||
		mapping.LogicalLength == nil || !validExactContentID(mapping.ContentID) {
		return catalogRelationWitness{}, errors.New("catalog relation witness requires a mapped regular file with exact identity")
	}
	fileVersion, err := store.GetFileVersion(ctx, workspaceID, mapping.FileVersionID)
	if err != nil {
		return catalogRelationWitness{}, fmt.Errorf("read mapped file version: %w", err)
	}
	if fileVersion.ID != mapping.FileVersionID || fileVersion.WorkspaceID != workspaceID || fileVersion.ContentID != mapping.ContentID ||
		fileVersion.LogicalSize != *mapping.LogicalLength {
		return catalogRelationWitness{}, errors.New("catalog FileVersion differs from the signed subject mapping")
	}
	extents, err := store.ListContentExtents(ctx, workspaceID, mapping.FileVersionID)
	if err != nil {
		return catalogRelationWitness{}, fmt.Errorf("read mapped content extents: %w", err)
	}
	required := make(map[string]struct{}, len(mapping.SelectedRepresentationRefs)+len(extents)+1)
	for _, id := range mapping.SelectedRepresentationRefs {
		if strings.TrimSpace(id) == "" {
			return catalogRelationWitness{}, errors.New("signed selected representation reference is empty")
		}
		required[id] = struct{}{}
	}
	if strings.TrimSpace(fileVersion.AuthoritativeRepresentationID) == "" {
		return catalogRelationWitness{}, errors.New("catalog FileVersion has no authoritative representation")
	}
	required[fileVersion.AuthoritativeRepresentationID] = struct{}{}
	for _, extent := range extents {
		if extent.RepresentationID == "" {
			return catalogRelationWitness{}, errors.New("catalog content extent has no representation reference")
		}
		required[extent.RepresentationID] = struct{}{}
	}
	representationIDs := make([]string, 0, len(required))
	for id := range required {
		representationIDs = append(representationIDs, id)
	}
	sort.Strings(representationIDs)
	representations := make([]sqlite.Representation, 0, len(representationIDs))
	for _, id := range representationIDs {
		representation, err := store.GetRepresentation(ctx, workspaceID, id)
		if err != nil {
			return catalogRelationWitness{}, fmt.Errorf("read required representation %q: %w", id, err)
		}
		representations = append(representations, representation)
	}
	return catalogRelationWitnessPayload(fileVersion, representations, extents, snapshotRef, rootID, mapping.StableSubjectRef, mapping.SelectedRepresentationRefs)
}

// decodeCatalogRelationWitness validates the record wrapper and the complete
// snapshot-scoped relation tuple against the authenticated bundle mapping.
func decodeCatalogRelationWitness(record portableFactRecord, bundle portableFactBundle, mapping subjectMappingPayload) (catalogRelationWitness, error) {
	if !isCatalogRelationWitnessRecord(record) {
		return catalogRelationWitness{}, errors.New("portable record is not a catalog relation witness")
	}
	wantRecordSchema, err := portableFactRecordSchema(bundle.Schema)
	if err != nil || bundle.Schema != PortableFactBundleSchemaV2 || record.Schema != wantRecordSchema ||
		record.PayloadDigest != DigestBytes(record.Payload) || record.PayloadLength != int64(len(record.Payload)) ||
		!sameStrings(mapping.SelectedRepresentationRefs, portableSelectedRepresentationRefs(mapping.Protection)) {
		return catalogRelationWitness{}, errors.New("catalog relation witness record schema, digest, or selected references are invalid")
	}
	var fact sqlite.MetadataFact
	if err := decodeStrictRecord(record.Payload, &fact); err != nil {
		return catalogRelationWitness{}, fmt.Errorf("decode catalog relation witness fact: %w", err)
	}
	if record.WorkspaceID != bundle.WorkspaceID || record.SnapshotRef != bundle.SnapshotRef ||
		record.StableSubjectRef != mapping.StableSubjectRef || mapping.WorkspaceID != bundle.WorkspaceID ||
		mapping.EntryType != string(sqlite.EntryFile) ||
		fact.WorkspaceID != bundle.WorkspaceID || fact.SubjectRef != mapping.StableSubjectRef ||
		fact.Namespace != catalogRelationWitnessNamespace || fact.ValueType != "OBJECT" ||
		fact.AuthorityClass != catalogRelationWitnessAuthority || fact.Revision != 1 ||
		record.Revision != 1 || record.PredecessorRecordID != "" || mapping.FileVersionID == "" ||
		mapping.StableSubjectRef == "" {
		return catalogRelationWitness{}, errors.New("catalog relation witness outer fact identity is invalid")
	}
	wantID := catalogRelationWitnessRecordID(bundle.SnapshotRef, mapping.NamespaceRootID, mapping.StableSubjectRef, mapping.FileVersionID)
	if fact.ID != wantID || record.RecordID != wantID || fact.Key != catalogRelationWitnessKey(mapping.FileVersionID) ||
		fact.SourceRef != catalogRelationWitnessSource(bundle.SnapshotRef, mapping.NamespaceRootID, mapping.StableSubjectRef, mapping.FileVersionID) ||
		fact.CreatedAt.IsZero() {
		return catalogRelationWitness{}, errors.New("catalog relation witness deterministic ID, source, key, or time is invalid")
	}
	var provenance struct {
		Namespace       string `json:"namespace"`
		ProfileDigest   string `json:"profile_digest"`
		SnapshotRef     string `json:"snapshot_ref"`
		NamespaceRootID string `json:"namespace_root_id"`
		FileVersionID   string `json:"file_version_id"`
	}
	if err := decodeStrictRecord(record.Provenance, &provenance); err != nil ||
		provenance.Namespace != catalogRelationWitnessNamespace || provenance.ProfileDigest != catalogRelationWitnessProfileDigest() ||
		provenance.SnapshotRef != bundle.SnapshotRef || provenance.NamespaceRootID != mapping.NamespaceRootID ||
		provenance.FileVersionID != mapping.FileVersionID {
		return catalogRelationWitness{}, errors.New("catalog relation witness provenance binding is invalid")
	}
	if fact.Confidence != nil || len(bytes.TrimSpace(fact.Value)) == 0 || !json.Valid(fact.Value) {
		return catalogRelationWitness{}, errors.New("catalog relation witness value is invalid")
	}
	var witness catalogRelationWitness
	if err := decodeStrictRecord(fact.Value, &witness); err != nil {
		return catalogRelationWitness{}, fmt.Errorf("decode catalog relation witness value: %w", err)
	}
	canonicalValue, err := CanonicalJSON(witness)
	if err != nil || !bytes.Equal(canonicalValue, fact.Value) {
		return catalogRelationWitness{}, errors.New("catalog relation witness value is not canonical")
	}
	length := int64(-1)
	if mapping.LogicalLength != nil {
		length = *mapping.LogicalLength
	}
	if err := validateCatalogRelationWitnessValue(witness, bundle.WorkspaceID, bundle.SnapshotRef, mapping.NamespaceRootID, mapping.StableSubjectRef, mapping.FileVersionID, mapping.ContentID, length, mapping.SelectedRepresentationRefs); err != nil {
		return catalogRelationWitness{}, err
	}
	if !fact.CreatedAt.UTC().Equal(witness.FileVersion.CreatedAt.UTC()) {
		return catalogRelationWitness{}, errors.New("catalog relation witness outer time does not match the authenticated FileVersion")
	}
	return witness, nil
}

func validateCatalogRelationWitnessValue(witness catalogRelationWitness, workspaceID, snapshotRef, rootID, subjectRef, fileVersionID, contentID string, logicalLength int64, selectedRefs []string) error {
	fv := witness.FileVersion
	if witness.Schema != catalogRelationWitnessSchema || witness.ProfileDigest != catalogRelationWitnessProfileDigest() ||
		witness.SnapshotRef != snapshotRef || witness.NamespaceRootID != rootID || witness.StableSubjectRef != subjectRef ||
		witness.Representations == nil || witness.ContentExtents == nil ||
		fv.ID != fileVersionID || fv.WorkspaceID != workspaceID || fv.ContentID != contentID || fv.LogicalSize != logicalLength ||
		logicalLength < 0 || !validExactContentID(contentID) || fv.AuthoritativeRepresentationID == "" ||
		fv.ScanGenerationID != "" || fv.ObservationID != "" || strings.TrimSpace(fv.HashingProfile) == "" ||
		strings.TrimSpace(fv.ExtentSetDigest) == "" || strings.TrimSpace(fv.RecordDigest) == "" ||
		fv.CreatedAt.IsZero() || fv.SparseEvidence == nil || !json.Valid(fv.SparseEvidence) {
		return errors.New("catalog relation witness FileVersion identity or fields are invalid")
	}
	required := make(map[string]struct{}, len(selectedRefs)+len(witness.ContentExtents)+1)
	for _, id := range selectedRefs {
		if strings.TrimSpace(id) == "" {
			return errors.New("catalog relation witness selected representation reference is empty")
		}
		required[id] = struct{}{}
	}
	required[fv.AuthoritativeRepresentationID] = struct{}{}
	if fv.LogicalSize == 0 {
		if len(witness.ContentExtents) != 0 {
			return errors.New("empty-file catalog relation witness must have no content extents")
		}
	} else {
		if len(witness.ContentExtents) != 1 {
			return errors.New("catalog relation witness v1 requires one whole-logical-stream extent")
		}
		extent := witness.ContentExtents[0]
		if extent.WorkspaceID != workspaceID || extent.FileVersionID != fileVersionID || extent.Ordinal != 0 ||
			extent.LogicalOffset != 0 || extent.LogicalLength != fv.LogicalSize || extent.Kind != sqlite.ExtentData ||
			extent.RepresentationID != fv.AuthoritativeRepresentationID || extent.RepresentationOffset != 0 || extent.ExtentDigest != contentID ||
			extent.CreatedAt.IsZero() || extent.Metadata == nil || !json.Valid(extent.Metadata) {
			return errors.New("catalog relation witness extent is outside the admitted logical-stream profile")
		}
		required[extent.RepresentationID] = struct{}{}
	}
	if len(witness.Representations) != len(required) {
		return errors.New("catalog relation witness representation set is incomplete or has surplus rows")
	}
	seen := make(map[string]struct{}, len(witness.Representations))
	for _, representation := range witness.Representations {
		if _, ok := required[representation.ID]; !ok {
			return fmt.Errorf("catalog relation witness contains unselected representation %q", representation.ID)
		}
		if _, ok := seen[representation.ID]; ok {
			return errors.New("catalog relation witness duplicates a representation row")
		}
		seen[representation.ID] = struct{}{}
		if representation.WorkspaceID != workspaceID || representation.ContentID != contentID ||
			representation.DecodedLength != logicalLength || representation.CodecProfileRef == "" ||
			representation.RecordDigest == "" || !validCatalogRelationOwnership(representation.OwnershipMode) ||
			!validCatalogRelationAccess(representation.AccessMode) || representation.CreatedAt.IsZero() ||
			representation.MinimumReadableUnit < 0 || representation.SeekCheckpointInterval < 0 ||
			representation.Metadata == nil || !json.Valid(representation.Metadata) {
			return fmt.Errorf("catalog relation witness representation %q is incomplete", representation.ID)
		}
	}
	for id := range required {
		if _, ok := seen[id]; !ok {
			return fmt.Errorf("catalog relation witness omits required representation %q", id)
		}
	}
	if !sort.SliceIsSorted(witness.Representations, func(i, j int) bool { return witness.Representations[i].ID < witness.Representations[j].ID }) ||
		!sort.SliceIsSorted(witness.ContentExtents, func(i, j int) bool { return witness.ContentExtents[i].Ordinal < witness.ContentExtents[j].Ordinal }) {
		return errors.New("catalog relation witness rows are not canonically ordered")
	}
	return nil
}

func validCatalogRelationOwnership(value sqlite.OwnershipMode) bool {
	return value == sqlite.OwnershipCairnPacks || value == sqlite.OwnershipEngineManaged || value == sqlite.OwnershipInline
}

func validCatalogRelationAccess(value sqlite.AccessMode) bool {
	switch value {
	case sqlite.AccessRandomNative, sqlite.AccessRandomCheckpointed, sqlite.AccessSequentialStream, sqlite.AccessWholeObjectOnly:
		return true
	default:
		return false
	}
}
