package sqlite

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"time"
)

// RecoveryAnnotationHistory is the authenticated current annotation together
// with every selected immutable revision retained by the portable closure.
type RecoveryAnnotationHistory struct {
	Current   Annotation
	Revisions []AnnotationRevision
}

// RecoveryCatalogProjection is a transaction-sized projection of one
// authenticated committed root. Signature and repository validation belong to
// the exact layer; this package only installs already-validated rows.
type RecoveryCatalogProjection struct {
	Workspace           Workspace
	Source              Source
	Scan                ScanGeneration
	Binding             CaptureRootBinding
	Root                NamespaceRoot
	Publication         Publication
	Representations     []Representation
	Observations        []Observation
	FileVersions        []FileVersion
	ContentExtents      []ContentExtent
	NamespaceEntries    []NamespaceEntry
	Protections         []ProtectionRecord
	RecoveryReferences  []RecoveryReference
	ExternalBindings    []ExternalBinding
	ExternalLocators    []ExternalLocator
	MetadataFacts       []MetadataFact
	AnnotationHistories []RecoveryAnnotationHistory
	Descriptions        []DescriptionDocument
	Segments            []SemanticSegment
	ProcessorAttempts   []ProcessorAttempt
	Artifacts           []ProcessorArtifact
}

const recoveryProjectionOrigin = "SIGNED_RECOVERY_PROJECTION"

type recoveryRootProvenance struct {
	CommitDigest   string `json:"commit_digest"`
	ManifestDigest string `json:"manifest_digest"`
	FactHeadDigest string `json:"fact_head_digest"`
}

type recoveryProtectionProvenance struct {
	Origin                string `json:"origin"`
	PublicationDomain     string `json:"publication_domain"`
	TrustAnchorDigest     string `json:"trust_anchor_digest"`
	PublicationGeneration int64  `json:"publication_generation"`
	SnapshotRef           string `json:"snapshot_ref"`
	CommitDigest          string `json:"commit_digest"`
	ManifestDigest        string `json:"manifest_digest"`
	NamespaceRootID       string `json:"namespace_root_id"`
}

// RestoreRecoveryCatalogProjection writes one verified root into the existing
// operational catalog. The publication row is deliberately last: it is the
// browse-visibility point for the otherwise incomplete reconstruction scan.
func (s *Store) RestoreRecoveryCatalogProjection(ctx context.Context, p RecoveryCatalogProjection) error {
	if err := validateRecoveryProjection(p); err != nil {
		return err
	}
	p = cloneRecoveryProjection(p)
	return s.Update(ctx, func(tx *Tx) error {
		if err := tx.ensureRecoveryProjectionTarget(ctx, p); err != nil {
			return err
		}
		if replayed, err := tx.exactRecoveryProjectionReplay(ctx, p); err != nil {
			return err
		} else if replayed {
			return nil
		}
		if err := tx.insertRecoverySharedHeaders(ctx, p); err != nil {
			return err
		}
		if err := tx.insertRecoveryProjectionRows(ctx, p); err != nil {
			return err
		}
		publication := p.Publication
		if err := tx.InsertPublication(ctx, &publication); err != nil {
			return err
		}
		return nil
	})
}

func (tx *Tx) exactRecoveryProjectionReplay(ctx context.Context, p RecoveryCatalogProjection) (bool, error) {
	stored, err := scanPublication(tx.tx.QueryRowContext(ctx, `SELECT publication_id, workspace_id, snapshot_ref, scan_generation_id, binding_id, namespace_root_id, manifest_digest, committed_at_ns, metadata_json, plan_digest FROM publications WHERE workspace_id = ? AND publication_id = ?`, p.Workspace.ID, p.Publication.ID))
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if stored.ID != p.Publication.ID || stored.SnapshotRef != p.Publication.SnapshotRef || stored.ScanGenerationID != p.Publication.ScanGenerationID || stored.BindingID != p.Publication.BindingID || stored.NamespaceRootID != p.Publication.NamespaceRootID || stored.ManifestDigest != p.Publication.ManifestDigest || stored.PlanDigest != p.Publication.PlanDigest || stored.CommittedAt.UTC().UnixNano() != p.Publication.CommittedAt.UTC().UnixNano() || !sameJSON(stored.Metadata, p.Publication.Metadata) {
		return false, ErrConflict
	}
	if err := tx.verifyRecoverySharedHeaders(ctx, p); err != nil {
		return false, err
	}
	if err := tx.verifyRecoveryProjectionRows(ctx, p); err != nil {
		return false, err
	}
	return true, nil
}

func (tx *Tx) verifyRecoveryProjectionRows(ctx context.Context, p RecoveryCatalogProjection) error {
	for _, history := range p.AnnotationHistories {
		if err := tx.RestoreAnnotationHistory(ctx, history.Current, history.Revisions); err != nil {
			return err
		}
	}
	if err := verifyProjectionValue("scan", p.Scan.ID, p.Scan, func() (ScanGeneration, error) {
		return scanScanGeneration(tx.tx.QueryRowContext(ctx, `SELECT scan_generation_id, workspace_id, source_id, generation, parent_scan_generation_id, capture_set_id, capture_set_digest, state, full_traversal, summary_json, started_at_ns, finished_at_ns FROM scan_generations WHERE workspace_id=? AND scan_generation_id=?`, p.Workspace.ID, p.Scan.ID))
	}); err != nil {
		return fmt.Errorf("replay scan: %w", err)
	}
	if err := verifyProjectionValue("binding", p.Binding.ID, p.Binding, func() (CaptureRootBinding, error) {
		return scanCaptureRootBinding(tx.tx.QueryRowContext(ctx, `SELECT binding_id, workspace_id, source_id, scan_generation_id, capture_mode, profile, display_path, device_id, inode, consistency_claim, identity_digest, bound_at_ns, record_json FROM capture_root_bindings WHERE workspace_id=? AND binding_id=?`, p.Workspace.ID, p.Binding.ID))
	}); err != nil {
		return fmt.Errorf("replay binding: %w", err)
	}
	if err := verifyProjectionRoot(p.Root, func() (NamespaceRoot, error) {
		return scanNamespaceRoot(tx.tx.QueryRowContext(ctx, `SELECT namespace_root_id, workspace_id, source_id, scan_generation_id, snapshot_ref, name, root_path_key, filesystem_semantics, authority_digest, metadata_json, created_at_ns FROM namespace_roots WHERE workspace_id=? AND namespace_root_id=?`, p.Workspace.ID, p.Root.ID))
	}); err != nil {
		return fmt.Errorf("replay root: %w", err)
	}
	for _, row := range p.Representations {
		if err := verifyProjectionValue("representation", row.ID, row, func() (Representation, error) {
			return scanRepresentation(tx.tx.QueryRowContext(ctx, `SELECT representation_id, workspace_id, content_id, decoded_length, ownership_mode, codec_profile_ref, access_mode, minimum_readable_unit, seek_checkpoint_interval, whole_read_required_to_verify, record_digest, metadata_json, created_at_ns FROM representations WHERE workspace_id=? AND representation_id=?`, row.WorkspaceID, row.ID))
		}); err != nil {
			return err
		}
	}
	for _, row := range p.Observations {
		if err := verifyProjectionValue("observation", row.ID, row, func() (Observation, error) {
			return scanObservation(tx.tx.QueryRowContext(ctx, `SELECT observation_id, workspace_id, source_id, scan_generation_id, path_key, raw_path, display_path, entry_type, content_id, file_version_id, stat_digest, logical_size, allocated_size, read_state, metadata_json, observed_at_ns FROM observations WHERE workspace_id=? AND observation_id=?`, row.WorkspaceID, row.ID))
		}); err != nil {
			return err
		}
	}
	for _, row := range p.FileVersions {
		if err := verifyProjectionValue("file version", row.ID, row, func() (FileVersion, error) {
			return scanFileVersionProjection(tx.tx.QueryRowContext(ctx, `SELECT file_version_id, workspace_id, scan_generation_id, observation_id, asset_id, content_id, logical_size, hashing_profile, authoritative_representation_id, extent_set_digest, hardlink_group_id, sparse_evidence_json, verification_ref, record_digest, created_at_ns FROM file_versions WHERE workspace_id=? AND file_version_id=?`, row.WorkspaceID, row.ID))
		}); err != nil {
			return err
		}
	}
	for _, row := range p.ContentExtents {
		if err := verifyProjectionValue("content extent", row.ID, row, func() (ContentExtent, error) {
			return scanContentExtent(tx.tx.QueryRowContext(ctx, `SELECT content_extent_id, workspace_id, file_version_id, ordinal, logical_offset, logical_length, extent_kind, representation_id, representation_offset, extent_digest, metadata_json, created_at_ns FROM content_extents WHERE workspace_id=? AND content_extent_id=?`, row.WorkspaceID, row.ID))
		}); err != nil {
			return err
		}
	}
	for _, row := range p.NamespaceEntries {
		if err := verifyProjectionValue("namespace entry", row.ID, row, func() (NamespaceEntry, error) {
			return scanNamespaceEntry(tx.tx.QueryRowContext(ctx, namespaceEntrySelect+`WHERE workspace_id=? AND namespace_entry_id=?`, row.WorkspaceID, row.ID))
		}); err != nil {
			return err
		}
	}
	for i := range p.Protections {
		if err := tx.restoreCurrentProjectionProtection(ctx, p, &p.Protections[i]); err != nil {
			return err
		}
	}
	for _, row := range p.RecoveryReferences {
		if err := verifyProjectionValue("recovery reference", row.ID, row, func() (RecoveryReference, error) {
			return scanRecoveryReference(tx.tx.QueryRowContext(ctx, recoveryReferenceSelect+`WHERE workspace_id=? AND recovery_reference_id=?`, row.WorkspaceID, row.ID))
		}); err != nil {
			return err
		}
	}
	for _, row := range p.ExternalBindings {
		if err := verifyProjectionValue("external binding", row.ID, row, func() (ExternalBinding, error) {
			return scanExternalBinding(tx.tx.QueryRowContext(ctx, externalBindingSelect+`WHERE workspace_id=? AND external_binding_id=?`, row.WorkspaceID, row.ID))
		}); err != nil {
			return err
		}
	}
	for _, row := range p.ExternalLocators {
		if err := verifyProjectionValue("external locator", row.ID, row, func() (ExternalLocator, error) {
			return scanExternalLocator(tx.tx.QueryRowContext(ctx, externalLocatorSelect+`WHERE workspace_id=? AND external_locator_id=?`, row.WorkspaceID, row.ID))
		}); err != nil {
			return err
		}
	}
	for _, row := range p.MetadataFacts {
		if err := verifyProjectionValue("metadata fact", row.ID, row, func() (MetadataFact, error) {
			return scanMetadataFact(tx.tx.QueryRowContext(ctx, metadataFactSelect+`WHERE workspace_id=? AND metadata_fact_id=?`, row.WorkspaceID, row.ID))
		}); err != nil {
			return err
		}
	}
	for _, row := range p.Descriptions {
		if err := verifyProjectionValue("description", row.ID, row, func() (DescriptionDocument, error) {
			return scanDescriptionDocument(tx.tx.QueryRowContext(ctx, descriptionDocumentSelect+`WHERE workspace_id=? AND description_document_id=?`, row.WorkspaceID, row.ID))
		}); err != nil {
			return err
		}
	}
	for _, row := range p.Segments {
		if err := verifyProjectionValue("segment", row.ID, row, func() (SemanticSegment, error) {
			return scanSemanticSegment(tx.tx.QueryRowContext(ctx, semanticSegmentSelect+`WHERE workspace_id=? AND semantic_segment_id=?`, row.WorkspaceID, row.ID))
		}); err != nil {
			return err
		}
	}
	for _, row := range p.ProcessorAttempts {
		if err := verifyProjectionValue("processor attempt", row.ID, row, func() (ProcessorAttempt, error) {
			return scanProcessorAttempt(tx.tx.QueryRowContext(ctx, processorAttemptSelect+`WHERE workspace_id=? AND attempt_id=?`, row.WorkspaceID, row.ID))
		}); err != nil {
			return err
		}
	}
	for _, row := range p.Artifacts {
		if err := verifyProjectionValue("artifact", row.ID, row, func() (ProcessorArtifact, error) {
			return scanProcessorArtifact(tx.tx.QueryRowContext(ctx, processorArtifactSelect+`WHERE workspace_id=? AND artifact_id=?`, row.WorkspaceID, row.ID))
		}); err != nil {
			return err
		}
	}
	return nil
}

func verifyProjectionValue[T any](kind, id string, want T, load func() (T, error)) error {
	got, err := load()
	if err != nil {
		return err
	}
	wantJSON, err := normalizedProjectionJSON(want)
	if err != nil {
		return err
	}
	gotJSON, err := normalizedProjectionJSON(got)
	if err != nil {
		return err
	}
	if !bytes.Equal(wantJSON, gotJSON) {
		return fmt.Errorf("recovery %s %q differs from stored row: %w", kind, id, ErrConflict)
	}
	return nil
}

func normalizedProjectionJSON(value any) ([]byte, error) {
	raw := reflect.ValueOf(value)
	copy := reflect.New(raw.Type()).Elem()
	copy.Set(raw)
	normalizeProjectionValue(copy)
	return json.Marshal(copy.Interface())
}

var rawMessageType = reflect.TypeOf(json.RawMessage(nil))
var timeType = reflect.TypeOf(time.Time{})

func normalizeProjectionValue(value reflect.Value) {
	if !value.IsValid() || !value.CanSet() {
		return
	}
	if value.Type() == rawMessageType {
		raw := json.RawMessage(value.Bytes())
		if len(raw) == 0 {
			value.SetBytes([]byte(`{}`))
			return
		}
		var decoded any
		if json.Unmarshal(raw, &decoded) == nil {
			if canonical, err := json.Marshal(decoded); err == nil {
				value.SetBytes(canonical)
			}
		}
		return
	}
	if value.Type() == timeType {
		value.Set(reflect.ValueOf(value.Interface().(time.Time).UTC()))
		return
	}
	switch value.Kind() {
	case reflect.Pointer, reflect.Interface:
		if !value.IsNil() {
			normalizeProjectionValue(value.Elem())
		}
	case reflect.Struct:
		for i := 0; i < value.NumField(); i++ {
			normalizeProjectionValue(value.Field(i))
		}
	case reflect.Slice:
		if value.Type().Elem().Kind() == reflect.Uint8 {
			return
		}
		if value.IsNil() {
			value.Set(reflect.MakeSlice(value.Type(), 0, 0))
			return
		}
		for i := 0; i < value.Len(); i++ {
			normalizeProjectionValue(value.Index(i))
		}
	case reflect.Array:
		for i := 0; i < value.Len(); i++ {
			normalizeProjectionValue(value.Index(i))
		}
	case reflect.Map:
		if !value.IsNil() {
			for _, key := range value.MapKeys() {
				item := reflect.New(value.Type().Elem()).Elem()
				item.Set(value.MapIndex(key))
				normalizeProjectionValue(item)
				value.SetMapIndex(key, item)
			}
		}
	}
}

func verifyProjectionRoot(want NamespaceRoot, load func() (NamespaceRoot, error)) error {
	got, err := load()
	if err != nil {
		return err
	}
	if got.ID != want.ID || got.WorkspaceID != want.WorkspaceID || got.SourceID != want.SourceID || got.ScanGenerationID != want.ScanGenerationID || got.SnapshotRef != want.SnapshotRef || got.Name != want.Name || !bytes.Equal(got.RootPathKey, want.RootPathKey) || got.FilesystemSemantics != want.FilesystemSemantics || got.AuthorityDigest != want.AuthorityDigest || string(got.Metadata) != string(want.Metadata) || got.CreatedAt.UTC().UnixNano() != want.CreatedAt.UTC().UnixNano() {
		return ErrConflict
	}
	return nil
}

func scanFileVersionProjection(scanner rowScanner) (FileVersion, error) {
	var r FileVersion
	var sparse string
	var created int64
	if err := scanner.Scan(&r.ID, &r.WorkspaceID, &r.ScanGenerationID, &r.ObservationID, &r.AssetID, &r.ContentID, &r.LogicalSize, &r.HashingProfile, &r.AuthoritativeRepresentationID, &r.ExtentSetDigest, &r.HardlinkGroupID, &sparse, &r.VerificationRef, &r.RecordDigest, &created); err != nil {
		return r, rowError("file version", err)
	}
	r.SparseEvidence = json.RawMessage(sparse)
	r.CreatedAt = time.Unix(0, created).UTC()
	return r, nil
}

func validateRecoveryProjection(p RecoveryCatalogProjection) error {
	if p.Workspace.ID == "" || p.Source.WorkspaceID != p.Workspace.ID || p.Scan.WorkspaceID != p.Workspace.ID || p.Source.ID != p.Scan.SourceID || p.Root.WorkspaceID != p.Workspace.ID || p.Root.SourceID != p.Source.ID || p.Root.ScanGenerationID != p.Scan.ID || p.Binding.WorkspaceID != p.Workspace.ID || p.Binding.SourceID != p.Source.ID || p.Binding.ScanGenerationID != p.Scan.ID || p.Publication.WorkspaceID != p.Workspace.ID || p.Publication.ScanGenerationID != p.Scan.ID || p.Publication.BindingID != p.Binding.ID || p.Publication.NamespaceRootID != p.Root.ID {
		return errors.New("recovery projection mixes workspace, source, scan, binding, root, or publication scope")
	}
	if p.Source.Kind != "RECOVERY_PUBLICATION" || p.Source.State != SourceLost || p.Source.Locator != "cairn-recovery:"+p.Source.ID {
		return errors.New("recovery projection source must be LOST with its opaque recovery locator")
	}
	if p.Scan.State != ScanIncomplete || p.Scan.FullTraversal {
		return errors.New("recovery projection scan must be INCOMPLETE with full_traversal=false")
	}
	if p.Scan.Generation < 1 {
		return errors.New("recovery projection ordering generation must be positive")
	}
	if p.Root.SnapshotRef != p.Publication.SnapshotRef || p.Scan.CaptureSetID != p.Binding.ID || p.Scan.CaptureSetDigest != p.Binding.IdentityDigest {
		return errors.New("root/publication or scan/binding capture identity does not match")
	}
	if p.Scan.FinishedAt == nil || p.Scan.StartedAt.IsZero() || p.Scan.FinishedAt.IsZero() {
		return errors.New("recovery projection scan requires deterministic start and finish times")
	}
	if err := validateProjectionOrigin(p.Workspace.Metadata); err != nil {
		return fmt.Errorf("workspace provenance: %w", err)
	}
	if err := validateProjectionOrigin(p.Source.Metadata); err != nil {
		return fmt.Errorf("source provenance: %w", err)
	}
	if err := validateProjectionOrigin(p.Root.Metadata); err != nil {
		return fmt.Errorf("root provenance: %w", err)
	}
	var rootProvenance recoveryRootProvenance
	if err := json.Unmarshal(p.Root.Metadata, &rootProvenance); err != nil {
		return err
	}
	if rootProvenance.CommitDigest == "" || rootProvenance.ManifestDigest == "" || rootProvenance.FactHeadDigest == "" {
		return errors.New("recovery root provenance requires commit, manifest, and fact-head digests")
	}
	if rootProvenance.ManifestDigest != p.Publication.ManifestDigest {
		return errors.New("root and publication manifest digests disagree")
	}
	if err := validateProjectionOrigin(p.Binding.Record); err != nil {
		return fmt.Errorf("binding provenance: %w", err)
	}
	if err := validateProjectionOrigin(p.Scan.Summary); err != nil {
		return fmt.Errorf("scan provenance: %w", err)
	}
	identities := make([]map[string]any, 0, 6)
	for _, raw := range []json.RawMessage{p.Workspace.Metadata, p.Source.Metadata, p.Root.Metadata, p.Binding.Record, p.Scan.Summary, p.Publication.Metadata} {
		identity, err := recoveryProjectionIdentity(raw)
		if err != nil {
			return err
		}
		identities = append(identities, identity)
	}
	for _, identity := range identities[1:] {
		if !sameProjectionIdentity(identity, identities[0]) {
			return errors.New("recovery provenance markers disagree on domain or trust anchor")
		}
	}
	for _, group := range []struct {
		name string
		rows []string
	}{
		{"representation", idsRepresentation(p.Representations)}, {"observation", idsObservation(p.Observations)}, {"file version", idsFileVersion(p.FileVersions)}, {"extent", idsExtent(p.ContentExtents)}, {"namespace entry", idsNamespaceEntry(p.NamespaceEntries)}, {"protection", idsProtection(p.Protections)}, {"recovery reference", idsRecovery(p.RecoveryReferences)}, {"external binding", idsBinding(p.ExternalBindings)}, {"external locator", idsLocator(p.ExternalLocators)}, {"metadata fact", idsMetadata(p.MetadataFacts)}, {"description", idsDescription(p.Descriptions)}, {"segment", idsSegment(p.Segments)}, {"processor attempt", idsAttempt(p.ProcessorAttempts)}, {"artifact", idsArtifact(p.Artifacts)},
	} {
		seen := make(map[string]struct{}, len(group.rows))
		for _, id := range group.rows {
			if err := requireID(group.name+" id", id); err != nil {
				return err
			}
			if _, duplicate := seen[id]; duplicate {
				return fmt.Errorf("duplicate %s id %q: %w", group.name, id, ErrConflict)
			}
			seen[id] = struct{}{}
		}
	}
	for name, id := range map[string]string{"workspace": p.Workspace.ID, "source": p.Source.ID, "scan": p.Scan.ID, "binding": p.Binding.ID, "root": p.Root.ID, "publication": p.Publication.ID} {
		if err := requireID(name+" id", id); err != nil {
			return err
		}
	}
	for _, history := range p.AnnotationHistories {
		if history.Current.WorkspaceID != p.Workspace.ID {
			return errors.New("annotation history crosses workspace")
		}
		if _, err := validateAnnotationHistory(history.Current, history.Revisions); err != nil {
			return err
		}
	}
	for _, row := range p.Representations {
		if row.WorkspaceID != p.Workspace.ID {
			return errors.New("representation crosses workspace")
		}
	}
	for _, row := range p.Observations {
		if row.WorkspaceID != p.Workspace.ID || row.SourceID != p.Source.ID || row.ScanGenerationID != p.Scan.ID {
			return errors.New("observation crosses recovery scope")
		}
	}
	for _, row := range p.FileVersions {
		if row.WorkspaceID != p.Workspace.ID || row.ScanGenerationID != p.Scan.ID {
			return errors.New("file version crosses recovery scope")
		}
	}
	observationIDs := make(map[string]struct{}, len(p.Observations))
	for _, row := range p.Observations {
		observationIDs[row.ID] = struct{}{}
	}
	representationIDs := make(map[string]struct{}, len(p.Representations))
	for _, row := range p.Representations {
		representationIDs[row.ID] = struct{}{}
	}
	fileVersionIDs := make(map[string]struct{}, len(p.FileVersions))
	for _, row := range p.FileVersions {
		fileVersionIDs[row.ID] = struct{}{}
		if _, ok := observationIDs[row.ObservationID]; !ok {
			return errors.New("file version has no selected observation")
		}
		if _, ok := representationIDs[row.AuthoritativeRepresentationID]; !ok {
			return errors.New("file version has no selected authoritative representation")
		}
	}
	mappedSubjects := map[string]struct{}{}
	for _, row := range p.NamespaceEntries {
		mappedSubjects[row.SubjectRef] = struct{}{}
	}
	for _, row := range p.Protections {
		if row.WorkspaceID != p.Workspace.ID {
			return errors.New("protection crosses workspace")
		}
		if _, ok := mappedSubjects[row.SubjectRef]; !ok {
			return fmt.Errorf("protection subject %q is outside the selected root/facts", row.SubjectRef)
		}
	}
	protectionIDs := make(map[string]struct{}, len(p.Protections))
	for _, row := range p.Protections {
		protectionIDs[row.ID] = struct{}{}
	}
	bindingIDs := make(map[string]struct{}, len(p.ExternalBindings))
	for _, row := range p.ExternalBindings {
		bindingIDs[row.ID] = struct{}{}
	}
	for _, row := range p.RecoveryReferences {
		if row.WorkspaceID != p.Workspace.ID {
			return errors.New("recovery reference crosses workspace")
		}
		if _, ok := protectionIDs[row.ProtectionRecordID]; !ok {
			return errors.New("recovery reference has no selected protection record")
		}
		if _, ok := mappedSubjects[row.SubjectRef]; !ok {
			return errors.New("recovery reference subject is outside the selected root/facts")
		}
		if row.ExternalBindingID != "" {
			if _, ok := bindingIDs[row.ExternalBindingID]; !ok {
				return errors.New("recovery reference has no selected external binding")
			}
		}
	}
	for _, row := range p.ExternalBindings {
		if row.WorkspaceID != p.Workspace.ID {
			return errors.New("external binding crosses workspace")
		}
		if _, ok := mappedSubjects[row.SubjectRef]; !ok {
			return errors.New("external binding subject is outside the selected root/facts")
		}
	}
	for _, row := range p.ExternalLocators {
		if row.WorkspaceID != p.Workspace.ID {
			return errors.New("external locator crosses workspace")
		}
		if _, ok := bindingIDs[row.BindingID]; !ok {
			return errors.New("external locator has no selected binding")
		}
	}
	for _, row := range p.ContentExtents {
		if row.WorkspaceID != p.Workspace.ID {
			return errors.New("content extent crosses workspace")
		}
		if _, ok := fileVersionIDs[row.FileVersionID]; !ok {
			return errors.New("content extent has no selected file version")
		}
		if row.Kind == ExtentData {
			if _, ok := representationIDs[row.RepresentationID]; !ok {
				return errors.New("content extent has no selected representation")
			}
		}
	}
	for _, row := range p.MetadataFacts {
		if row.WorkspaceID != p.Workspace.ID {
			return errors.New("metadata fact crosses workspace")
		}
		if _, ok := mappedSubjects[row.SubjectRef]; !ok {
			return errors.New("metadata fact subject is outside the selected root/facts")
		}
	}
	for _, history := range p.AnnotationHistories {
		if _, ok := mappedSubjects[history.Current.SubjectRef]; !ok {
			return errors.New("annotation subject is outside the selected root/facts")
		}
	}
	for _, row := range p.Descriptions {
		if _, ok := mappedSubjects[row.SubjectRef]; !ok {
			return errors.New("description subject is outside the selected root/facts")
		}
	}
	descriptionIDs := make(map[string]struct{}, len(p.Descriptions))
	for _, row := range p.Descriptions {
		descriptionIDs[row.ID] = struct{}{}
	}
	for _, row := range p.Segments {
		if row.WorkspaceID != p.Workspace.ID {
			return errors.New("segment crosses workspace")
		}
		if _, ok := descriptionIDs[row.DocumentID]; !ok {
			return errors.New("segment has no selected description document")
		}
	}
	for _, row := range p.Protections {
		if row.LocalRepresentationID != "" {
			if _, ok := representationIDs[row.LocalRepresentationID]; !ok {
				return errors.New("protection has no selected local representation")
			}
		}
		if row.ExpectedContentID != "" {
			matches := false
			for _, entry := range p.NamespaceEntries {
				if entry.SubjectRef == row.SubjectRef && entry.ContentID == row.ExpectedContentID && entry.LogicalSize != nil && row.ExpectedLogicalLength != nil && *entry.LogicalSize == *row.ExpectedLogicalLength {
					matches = true
					break
				}
			}
			if !matches {
				return errors.New("protection expected identity does not match a selected namespace entry")
			}
		}
		if err := validateInputProtectionProvenance(p, row); err != nil {
			return err
		}
	}
	for _, row := range p.ProcessorAttempts {
		if row.WorkspaceID != p.Workspace.ID || row.SnapshotRef != p.Root.SnapshotRef {
			return errors.New("processor attempt crosses selected publication")
		}
		if _, ok := mappedSubjects[row.SubjectRef]; !ok {
			return errors.New("processor attempt subject is outside the selected root/facts")
		}
	}
	attemptIDs := make(map[string]struct{}, len(p.ProcessorAttempts))
	for _, row := range p.ProcessorAttempts {
		attemptIDs[row.ID] = struct{}{}
	}
	for _, row := range p.Artifacts {
		if row.WorkspaceID != p.Workspace.ID || row.SnapshotRef != p.Root.SnapshotRef {
			return errors.New("processor artifact crosses selected publication")
		}
		if _, ok := mappedSubjects[row.SubjectRef]; !ok {
			return errors.New("processor artifact subject is outside the selected root/facts")
		}
		if row.AttemptID != "" {
			if _, ok := attemptIDs[row.AttemptID]; !ok {
				return errors.New("processor artifact has no selected terminal attempt")
			}
		}
	}
	for _, row := range p.NamespaceEntries {
		if row.WorkspaceID != p.Workspace.ID || row.RootID != p.Root.ID {
			return errors.New("namespace entry crosses recovery root")
		}
		if row.ObservationID != "" {
			if _, ok := observationIDs[row.ObservationID]; !ok {
				return errors.New("namespace entry has no selected observation")
			}
		}
		if row.FileVersionID != "" {
			if _, ok := fileVersionIDs[row.FileVersionID]; !ok {
				return errors.New("namespace entry has no selected file version")
			}
		}
	}
	for _, row := range p.Descriptions {
		if row.WorkspaceID != p.Workspace.ID {
			return errors.New("description crosses workspace")
		}
	}
	for _, row := range p.Segments {
		if row.WorkspaceID != p.Workspace.ID {
			return errors.New("segment crosses workspace")
		}
	}
	return nil
}

func validateProjectionOrigin(raw json.RawMessage) error {
	_, err := recoveryProjectionIdentity(raw)
	return err
}

func recoveryProjectionIdentity(raw json.RawMessage) (map[string]any, error) {
	var v struct {
		Origin            string `json:"origin"`
		PublicationDomain string `json:"publication_domain"`
		TrustAnchorDigest string `json:"trust_anchor_digest"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	if v.Origin != recoveryProjectionOrigin || v.PublicationDomain == "" || v.TrustAnchorDigest == "" {
		return nil, errors.New("origin, publication domain, or trust-anchor marker is missing")
	}
	return map[string]any{"origin": v.Origin, "publication_domain": v.PublicationDomain, "trust_anchor_digest": v.TrustAnchorDigest}, nil
}

func sameJSON(a, b json.RawMessage) bool {
	left, leftErr := normalizedProjectionJSON(a)
	right, rightErr := normalizedProjectionJSON(b)
	return leftErr == nil && rightErr == nil && bytes.Equal(left, right)
}

func (tx *Tx) ensureRecoveryProjectionTarget(ctx context.Context, p RecoveryCatalogProjection) error {
	var workspaceMetadata string
	err := tx.tx.QueryRowContext(ctx, `SELECT metadata_json FROM workspaces WHERE workspace_id=?`, p.Workspace.ID).Scan(&workspaceMetadata)
	if err == nil {
		wantIdentity, err := recoveryProjectionIdentity(p.Workspace.Metadata)
		if err != nil {
			return err
		}
		gotIdentity, err := recoveryProjectionIdentity(json.RawMessage(workspaceMetadata))
		if err != nil || !sameProjectionIdentity(gotIdentity, wantIdentity) {
			return fmt.Errorf("existing workspace is not a recovery projection: %w", ErrConflict)
		}
		var workspaceCount int
		if err := tx.tx.QueryRowContext(ctx, `SELECT count(*) FROM workspaces`).Scan(&workspaceCount); err != nil {
			return err
		}
		if workspaceCount != 1 {
			return fmt.Errorf("recovery projection target contains another workspace: %w", ErrConflict)
		}
		for _, query := range []string{
			`SELECT metadata_json FROM sources`,
			`SELECT metadata_json FROM namespace_roots`,
		} {
			rows, err := tx.tx.QueryContext(ctx, query)
			if err != nil {
				return err
			}
			for rows.Next() {
				var raw string
				if err := rows.Scan(&raw); err != nil {
					rows.Close()
					return err
				}
				identity, err := recoveryProjectionIdentity(json.RawMessage(raw))
				if err != nil || !sameProjectionIdentity(identity, wantIdentity) {
					rows.Close()
					return fmt.Errorf("catalog contains a source or root outside this recovery domain: %w", ErrConflict)
				}
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return err
			}
			rows.Close()
		}
		var orphanSources int
		if err := tx.tx.QueryRowContext(ctx, `SELECT count(*) FROM sources s WHERE NOT EXISTS (SELECT 1 FROM namespace_roots r WHERE r.workspace_id=s.workspace_id AND r.source_id=s.source_id)`).Scan(&orphanSources); err != nil {
			return err
		}
		if orphanSources != 0 {
			return fmt.Errorf("catalog contains source state without an authenticated root: %w", ErrConflict)
		}
		for _, table := range []string{"annotations", "description_documents", "metadata_facts", "protection_records", "recovery_references", "external_bindings", "processor_attempts", "processor_artifacts", "semantic_segments"} {
			query := `SELECT count(*) FROM ` + table + ` f WHERE f.workspace_id=? AND NOT EXISTS (SELECT 1 FROM namespace_entries e WHERE e.workspace_id=f.workspace_id AND e.subject_ref=f.subject_ref)`
			var orphanFacts int
			if err := tx.tx.QueryRowContext(ctx, query, p.Workspace.ID).Scan(&orphanFacts); err != nil {
				return err
			}
			if orphanFacts != 0 {
				return fmt.Errorf("catalog contains %s without a mapped subject: %w", table, ErrConflict)
			}
		}
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	var count int
	for _, table := range []string{"workspaces", "sources", "scan_generations", "capture_root_bindings", "representations", "namespace_roots", "namespace_entries", "observations", "file_versions", "content_extents", "physical_locator_projections", "annotations", "annotation_revisions", "description_documents", "semantic_segments", "protection_records", "recovery_references", "external_bindings", "external_locators", "metadata_facts", "processor_attempts", "processor_artifacts", "publications", "saved_views", "export_manifests"} {
		if err := tx.tx.QueryRowContext(ctx, `SELECT count(*) FROM `+table).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			return fmt.Errorf("recovery projection target contains ordinary content state (%s): %w", table, ErrConflict)
		}
	}
	return nil
}

func sameProjectionIdentity(a, b map[string]any) bool {
	return a["origin"] == b["origin"] && a["publication_domain"] == b["publication_domain"] && a["trust_anchor_digest"] == b["trust_anchor_digest"]
}

func (tx *Tx) insertRecoverySharedHeaders(ctx context.Context, p RecoveryCatalogProjection) error {
	workspace, err := scanWorkspace(tx.tx.QueryRowContext(ctx, `SELECT workspace_id, name, metadata_json, revision, created_at_ns, updated_at_ns FROM workspaces WHERE workspace_id=?`, p.Workspace.ID))
	if errors.Is(err, ErrNotFound) {
		if err := tx.InsertWorkspace(ctx, &p.Workspace); err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else if !equalProjectionHeader(workspace.Metadata, p.Workspace.Metadata) {
		return ErrConflict
	}
	// Header rows may predate a later root from the same authenticated domain;
	// preserve their first local display name and timestamps while requiring the
	// same reconstruction identity.
	var source Source
	source, err = scanSource(tx.tx.QueryRowContext(ctx, `SELECT source_id, workspace_id, stable_key, kind, locator, identity_fingerprint, state, metadata_json, revision, created_at_ns, updated_at_ns FROM sources WHERE workspace_id=? AND source_id=?`, p.Source.WorkspaceID, p.Source.ID))
	if errors.Is(err, ErrNotFound) {
		if err := tx.InsertSource(ctx, &p.Source); err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else if source.ID != "" {
		if source.StableKey != p.Source.StableKey || source.Kind != p.Source.Kind || source.Locator != p.Source.Locator || source.IdentityFingerprint != p.Source.IdentityFingerprint || source.State != p.Source.State || !equalProjectionHeader(source.Metadata, p.Source.Metadata) {
			return ErrConflict
		}
	}
	return nil
}

func (tx *Tx) verifyRecoverySharedHeaders(ctx context.Context, p RecoveryCatalogProjection) error {
	workspace, err := scanWorkspace(tx.tx.QueryRowContext(ctx, `SELECT workspace_id, name, metadata_json, revision, created_at_ns, updated_at_ns FROM workspaces WHERE workspace_id=?`, p.Workspace.ID))
	if err != nil || !equalProjectionHeader(workspace.Metadata, p.Workspace.Metadata) {
		return fmt.Errorf("replayed workspace header differs: %w", ErrConflict)
	}
	source, err := scanSource(tx.tx.QueryRowContext(ctx, `SELECT source_id, workspace_id, stable_key, kind, locator, identity_fingerprint, state, metadata_json, revision, created_at_ns, updated_at_ns FROM sources WHERE workspace_id=? AND source_id=?`, p.Source.WorkspaceID, p.Source.ID))
	if err != nil || source.StableKey != p.Source.StableKey || source.Kind != p.Source.Kind || source.Locator != p.Source.Locator || source.IdentityFingerprint != p.Source.IdentityFingerprint || source.State != p.Source.State || !equalProjectionHeader(source.Metadata, p.Source.Metadata) {
		return fmt.Errorf("replayed source header differs: %w", ErrConflict)
	}
	return nil
}

func validateInputProtectionProvenance(p RecoveryCatalogProjection, record ProtectionRecord) error {
	var provenance recoveryProtectionProvenance
	if err := json.Unmarshal(record.Metadata, &provenance); err != nil {
		return fmt.Errorf("protection %q provenance is invalid", record.ID)
	}
	var root recoveryRootProvenance
	if err := json.Unmarshal(p.Root.Metadata, &root); err != nil {
		return err
	}
	want, err := recoveryProjectionIdentity(p.Workspace.Metadata)
	if err != nil {
		return err
	}
	got := map[string]any{"origin": provenance.Origin, "publication_domain": provenance.PublicationDomain, "trust_anchor_digest": provenance.TrustAnchorDigest}
	if !sameProjectionIdentity(got, want) || provenance.PublicationGeneration != p.Scan.Generation || provenance.SnapshotRef != p.Publication.SnapshotRef || provenance.CommitDigest != root.CommitDigest || provenance.ManifestDigest != p.Publication.ManifestDigest || provenance.NamespaceRootID != p.Root.ID {
		return fmt.Errorf("protection %q is not bound to its selected publication: %w", record.ID, ErrConflict)
	}
	return nil
}

func (tx *Tx) restoreCurrentProjectionProtection(ctx context.Context, p RecoveryCatalogProjection, incoming *ProtectionRecord) error {
	if err := validateInputProtectionProvenance(p, *incoming); err != nil {
		return err
	}
	current, err := scanProtectionRecord(tx.tx.QueryRowContext(ctx, protectionRecordSelect+`WHERE workspace_id=? AND subject_ref=?`, incoming.WorkspaceID, incoming.SubjectRef))
	if errors.Is(err, ErrNotFound) {
		return tx.upsertAndVerifyProjectionProtection(ctx, incoming)
	}
	if err != nil {
		return err
	}
	if current.ID != incoming.ID {
		return fmt.Errorf("recovery protection identity differs for subject: %w", ErrConflict)
	}
	currentOrder, err := tx.validateStoredProjectionProtection(ctx, p, current)
	if err != nil {
		return err
	}
	var incomingOrder recoveryProtectionProvenance
	if err := json.Unmarshal(incoming.Metadata, &incomingOrder); err != nil {
		return err
	}
	switch {
	case currentOrder.PublicationGeneration > incomingOrder.PublicationGeneration:
		// A signed historical capture contributes its immutable references and
		// namespace rows, but never downgrades the single current protection row.
		return nil
	case currentOrder.PublicationGeneration == incomingOrder.PublicationGeneration:
		if currentOrder.SnapshotRef != incomingOrder.SnapshotRef || !sameProtectionProjection(current, *incoming) {
			return fmt.Errorf("same-order recovery protection differs: %w", ErrConflict)
		}
		return nil
	default:
		return tx.upsertAndVerifyProjectionProtection(ctx, incoming)
	}
}

func (tx *Tx) validateStoredProjectionProtection(ctx context.Context, p RecoveryCatalogProjection, current ProtectionRecord) (recoveryProtectionProvenance, error) {
	var provenance recoveryProtectionProvenance
	if err := json.Unmarshal(current.Metadata, &provenance); err != nil {
		return provenance, fmt.Errorf("stored protection provenance is invalid: %w", ErrConflict)
	}
	wantIdentity, err := recoveryProjectionIdentity(p.Workspace.Metadata)
	if err != nil {
		return provenance, err
	}
	gotIdentity := map[string]any{"origin": provenance.Origin, "publication_domain": provenance.PublicationDomain, "trust_anchor_digest": provenance.TrustAnchorDigest}
	if !sameProjectionIdentity(gotIdentity, wantIdentity) || provenance.PublicationGeneration < 1 || provenance.SnapshotRef == "" || provenance.CommitDigest == "" || provenance.ManifestDigest == "" || provenance.NamespaceRootID == "" {
		return provenance, fmt.Errorf("stored protection lacks recovery publication provenance: %w", ErrConflict)
	}
	root, err := scanNamespaceRoot(tx.tx.QueryRowContext(ctx, `SELECT namespace_root_id, workspace_id, source_id, scan_generation_id, snapshot_ref, name, root_path_key, filesystem_semantics, authority_digest, metadata_json, created_at_ns FROM namespace_roots WHERE workspace_id=? AND namespace_root_id=?`, current.WorkspaceID, provenance.NamespaceRootID))
	if err != nil {
		return provenance, fmt.Errorf("stored protection root is absent: %w", ErrConflict)
	}
	var rootProvenance recoveryRootProvenance
	if json.Unmarshal(root.Metadata, &rootProvenance) != nil || root.SnapshotRef != provenance.SnapshotRef || rootProvenance.CommitDigest != provenance.CommitDigest || rootProvenance.ManifestDigest != provenance.ManifestDigest {
		return provenance, fmt.Errorf("stored protection does not match its root provenance: %w", ErrConflict)
	}
	var publication Publication
	publication, err = scanPublication(tx.tx.QueryRowContext(ctx, `SELECT publication_id, workspace_id, snapshot_ref, scan_generation_id, binding_id, namespace_root_id, manifest_digest, committed_at_ns, metadata_json, plan_digest FROM publications WHERE workspace_id=? AND namespace_root_id=? AND snapshot_ref=?`, current.WorkspaceID, provenance.NamespaceRootID, provenance.SnapshotRef))
	if err != nil || publication.ManifestDigest != provenance.ManifestDigest || publication.ScanGenerationID != root.ScanGenerationID {
		return provenance, fmt.Errorf("stored protection has no matching publication: %w", ErrConflict)
	}
	scan, err := scanScanGeneration(tx.tx.QueryRowContext(ctx, `SELECT scan_generation_id, workspace_id, source_id, generation, parent_scan_generation_id, capture_set_id, capture_set_digest, state, full_traversal, summary_json, started_at_ns, finished_at_ns FROM scan_generations WHERE workspace_id=? AND scan_generation_id=?`, current.WorkspaceID, publication.ScanGenerationID))
	if err != nil || scan.Generation != provenance.PublicationGeneration || scan.SourceID != root.SourceID || scan.State != ScanIncomplete || scan.FullTraversal {
		return provenance, fmt.Errorf("stored protection publication order is not present in the catalog: %w", ErrConflict)
	}
	if identity, identityErr := recoveryProjectionIdentity(root.Metadata); identityErr != nil || !sameProjectionIdentity(identity, wantIdentity) {
		return provenance, fmt.Errorf("stored protection root is outside the recovery domain: %w", ErrConflict)
	}
	if identity, identityErr := recoveryProjectionIdentity(publication.Metadata); identityErr != nil || !sameProjectionIdentity(identity, wantIdentity) {
		return provenance, fmt.Errorf("stored protection publication is outside the recovery domain: %w", ErrConflict)
	}
	entry, err := scanNamespaceEntry(tx.tx.QueryRowContext(ctx, namespaceEntrySelect+
		`WHERE workspace_id=? AND namespace_root_id=? AND subject_ref=?`, current.WorkspaceID, provenance.NamespaceRootID, current.SubjectRef))
	if err != nil {
		return provenance, fmt.Errorf("stored protection subject is absent from its authenticated root: %w", ErrConflict)
	}
	if current.ExpectedContentID != "" && (entry.ContentID != current.ExpectedContentID || entry.LogicalSize == nil || current.ExpectedLogicalLength == nil || *entry.LogicalSize != *current.ExpectedLogicalLength) {
		return provenance, fmt.Errorf("stored protection identity differs from its authenticated subject mapping: %w", ErrConflict)
	}
	return provenance, nil
}

func sameProtectionProjection(stored, incoming ProtectionRecord) bool {
	stored.Revision, incoming.Revision = 0, 0
	stored.CreatedAt, incoming.CreatedAt = time.Time{}, time.Time{}
	stored.UpdatedAt, incoming.UpdatedAt = time.Time{}, time.Time{}
	a, errA := normalizedProjectionJSON(stored)
	b, errB := normalizedProjectionJSON(incoming)
	return errA == nil && errB == nil && bytes.Equal(a, b)
}

func (tx *Tx) upsertAndVerifyProjectionProtection(ctx context.Context, incoming *ProtectionRecord) error {
	incoming.Revision = 0
	incoming.CreatedAt = time.Time{}
	incoming.UpdatedAt = time.Time{}
	if _, err := tx.UpsertProtectionRecord(ctx, incoming); err != nil {
		return fmt.Errorf("upsert recovery protection %q: %w", incoming.ID, err)
	}
	stored, err := scanProtectionRecord(tx.tx.QueryRowContext(ctx, protectionRecordSelect+`WHERE workspace_id=? AND subject_ref=?`, incoming.WorkspaceID, incoming.SubjectRef))
	if err != nil || stored.ID != incoming.ID || !sameProtectionProjection(stored, *incoming) {
		return fmt.Errorf("recovery protection %q differs after upsert: %w", incoming.ID, ErrConflict)
	}
	return nil
}

func equalProjectionHeader(existing, incoming json.RawMessage) bool {
	var a, b map[string]any
	if json.Unmarshal(existing, &a) != nil || json.Unmarshal(incoming, &b) != nil {
		return false
	}
	return sameProjectionIdentity(a, b)
}

func (tx *Tx) insertRecoveryProjectionRows(ctx context.Context, p RecoveryCatalogProjection) error {
	scan := p.Scan
	scan.State = ScanRunning
	scan.FinishedAt = nil
	if err := tx.InsertScanGeneration(ctx, &scan); err != nil {
		if verifyErr := verifyProjectionValue("scan", p.Scan.ID, p.Scan, func() (ScanGeneration, error) {
			return scanScanGeneration(tx.tx.QueryRowContext(ctx, `SELECT scan_generation_id, workspace_id, source_id, generation, parent_scan_generation_id, capture_set_id, capture_set_digest, state, full_traversal, summary_json, started_at_ns, finished_at_ns FROM scan_generations WHERE workspace_id=? AND scan_generation_id=?`, p.Workspace.ID, p.Scan.ID))
		}); verifyErr == nil {
			return nil
		}
		return fmt.Errorf("insert recovery scan %q: %w", p.Scan.ID, err)
	}
	if err := insertOrVerifyRecoveryRow("binding", p.Binding.ID, func() error { return tx.InsertCaptureRootBinding(ctx, &p.Binding) }, func() (CaptureRootBinding, error) {
		return scanCaptureRootBinding(tx.tx.QueryRowContext(ctx, `SELECT binding_id, workspace_id, source_id, scan_generation_id, capture_mode, profile, display_path, device_id, inode, consistency_claim, identity_digest, bound_at_ns, record_json FROM capture_root_bindings WHERE workspace_id=? AND binding_id=?`, p.Binding.WorkspaceID, p.Binding.ID))
	}, p.Binding); err != nil {
		return err
	}
	for i := range p.Representations {
		row := &p.Representations[i]
		if err := insertOrVerifyRecoveryRow("representation", row.ID, func() error { return tx.InsertRepresentation(ctx, row) }, func() (Representation, error) {
			return scanRepresentation(tx.tx.QueryRowContext(ctx, `SELECT representation_id, workspace_id, content_id, decoded_length, ownership_mode, codec_profile_ref, access_mode, minimum_readable_unit, seek_checkpoint_interval, whole_read_required_to_verify, record_digest, metadata_json, created_at_ns FROM representations WHERE workspace_id=? AND representation_id=?`, row.WorkspaceID, row.ID))
		}, *row); err != nil {
			return err
		}
	}
	for i := range p.Observations {
		row := &p.Observations[i]
		if err := insertOrVerifyRecoveryRow("observation", row.ID, func() error { return tx.InsertObservation(ctx, row) }, func() (Observation, error) {
			return scanObservation(tx.tx.QueryRowContext(ctx, `SELECT observation_id, workspace_id, source_id, scan_generation_id, path_key, raw_path, display_path, entry_type, content_id, file_version_id, stat_digest, logical_size, allocated_size, read_state, metadata_json, observed_at_ns FROM observations WHERE workspace_id=? AND observation_id=?`, row.WorkspaceID, row.ID))
		}, *row); err != nil {
			return err
		}
	}
	for i := range p.FileVersions {
		row := &p.FileVersions[i]
		if err := insertOrVerifyRecoveryRow("file version", row.ID, func() error { return tx.InsertFileVersion(ctx, row) }, func() (FileVersion, error) {
			return scanFileVersionProjection(tx.tx.QueryRowContext(ctx, `SELECT file_version_id, workspace_id, scan_generation_id, observation_id, asset_id, content_id, logical_size, hashing_profile, authoritative_representation_id, extent_set_digest, hardlink_group_id, sparse_evidence_json, verification_ref, record_digest, created_at_ns FROM file_versions WHERE workspace_id=? AND file_version_id=?`, row.WorkspaceID, row.ID))
		}, *row); err != nil {
			return err
		}
	}
	extents := append([]ContentExtent(nil), p.ContentExtents...)
	sort.Slice(extents, func(i, j int) bool {
		if extents[i].FileVersionID != extents[j].FileVersionID {
			return extents[i].FileVersionID < extents[j].FileVersionID
		}
		return extents[i].Ordinal < extents[j].Ordinal
	})
	for i := range extents {
		row := &extents[i]
		if err := insertOrVerifyRecoveryRow("content extent", row.ID, func() error { return tx.InsertContentExtent(ctx, row) }, func() (ContentExtent, error) {
			return scanContentExtent(tx.tx.QueryRowContext(ctx, `SELECT content_extent_id, workspace_id, file_version_id, ordinal, logical_offset, logical_length, extent_kind, representation_id, representation_offset, extent_digest, metadata_json, created_at_ns FROM content_extents WHERE workspace_id=? AND content_extent_id=?`, row.WorkspaceID, row.ID))
		}, *row); err != nil {
			return err
		}
	}
	if err := insertOrVerifyRecoveryRow("namespace root", p.Root.ID, func() error { return tx.InsertNamespaceRoot(ctx, &p.Root) }, func() (NamespaceRoot, error) {
		return scanNamespaceRoot(tx.tx.QueryRowContext(ctx, `SELECT namespace_root_id, workspace_id, source_id, scan_generation_id, snapshot_ref, name, root_path_key, filesystem_semantics, authority_digest, metadata_json, created_at_ns FROM namespace_roots WHERE workspace_id=? AND namespace_root_id=?`, p.Root.WorkspaceID, p.Root.ID))
	}, p.Root); err != nil {
		return err
	}
	entries, err := orderRecoveryNamespaceEntries(p.NamespaceEntries)
	if err != nil {
		return err
	}
	for i := range entries {
		row := &entries[i]
		if err := insertOrVerifyRecoveryRow("namespace entry", row.ID, func() error { return tx.InsertNamespaceEntry(ctx, row) }, func() (NamespaceEntry, error) {
			return scanNamespaceEntry(tx.tx.QueryRowContext(ctx, namespaceEntrySelect+`WHERE workspace_id=? AND namespace_entry_id=?`, row.WorkspaceID, row.ID))
		}, *row); err != nil {
			return err
		}
	}
	for i := range p.Protections {
		if err := tx.restoreCurrentProjectionProtection(ctx, p, &p.Protections[i]); err != nil {
			return err
		}
	}
	for i := range p.ExternalBindings {
		row := &p.ExternalBindings[i]
		if err := insertOrVerifyRecoveryRow("external binding", row.ID, func() error { return tx.InsertExternalBinding(ctx, row) }, func() (ExternalBinding, error) {
			return scanExternalBinding(tx.tx.QueryRowContext(ctx, externalBindingSelect+`WHERE workspace_id=? AND external_binding_id=?`, row.WorkspaceID, row.ID))
		}, *row); err != nil {
			return err
		}
	}
	for i := range p.ExternalLocators {
		row := &p.ExternalLocators[i]
		if err := insertOrVerifyRecoveryRow("external locator", row.ID, func() error { return tx.InsertExternalLocator(ctx, row) }, func() (ExternalLocator, error) {
			return scanExternalLocator(tx.tx.QueryRowContext(ctx, externalLocatorSelect+`WHERE workspace_id=? AND external_locator_id=?`, row.WorkspaceID, row.ID))
		}, *row); err != nil {
			return err
		}
	}
	for i := range p.RecoveryReferences {
		row := &p.RecoveryReferences[i]
		if err := insertOrVerifyRecoveryRow("recovery reference", row.ID, func() error { return tx.InsertRecoveryReference(ctx, row) }, func() (RecoveryReference, error) {
			return scanRecoveryReference(tx.tx.QueryRowContext(ctx, recoveryReferenceSelect+`WHERE workspace_id=? AND recovery_reference_id=?`, row.WorkspaceID, row.ID))
		}, *row); err != nil {
			return err
		}
	}
	for i := range p.MetadataFacts {
		row := &p.MetadataFacts[i]
		if err := insertOrVerifyRecoveryRow("metadata fact", row.ID, func() error { return tx.InsertMetadataFact(ctx, row) }, func() (MetadataFact, error) {
			return scanMetadataFact(tx.tx.QueryRowContext(ctx, metadataFactSelect+`WHERE workspace_id=? AND metadata_fact_id=?`, row.WorkspaceID, row.ID))
		}, *row); err != nil {
			return err
		}
	}
	for _, history := range p.AnnotationHistories {
		if err := tx.RestoreAnnotationHistory(ctx, history.Current, history.Revisions); err != nil {
			return err
		}
	}
	descriptions, err := orderRecoveryDescriptionDocuments(ctx, tx, p.Descriptions)
	if err != nil {
		return err
	}
	for i := range descriptions {
		row := &descriptions[i]
		if err := insertOrVerifyRecoveryRow("description", row.ID, func() error { return tx.InsertDescriptionDocument(ctx, row) }, func() (DescriptionDocument, error) {
			return scanDescriptionDocument(tx.tx.QueryRowContext(ctx, descriptionDocumentSelect+`WHERE workspace_id=? AND description_document_id=?`, row.WorkspaceID, row.ID))
		}, *row); err != nil {
			return err
		}
	}
	for i := range p.Segments {
		row := &p.Segments[i]
		if err := insertOrVerifyRecoveryRow("segment", row.ID, func() error { return tx.InsertSemanticSegment(ctx, row) }, func() (SemanticSegment, error) {
			return scanSemanticSegment(tx.tx.QueryRowContext(ctx, semanticSegmentSelect+`WHERE workspace_id=? AND semantic_segment_id=?`, row.WorkspaceID, row.ID))
		}, *row); err != nil {
			return err
		}
	}
	for i := range p.ProcessorAttempts {
		row := &p.ProcessorAttempts[i]
		if err := insertOrVerifyRecoveryRow("processor attempt", row.ID, func() error { return tx.InsertProcessorAttempt(ctx, row) }, func() (ProcessorAttempt, error) {
			return scanProcessorAttempt(tx.tx.QueryRowContext(ctx, processorAttemptSelect+`WHERE workspace_id=? AND attempt_id=?`, row.WorkspaceID, row.ID))
		}, *row); err != nil {
			return err
		}
	}
	for i := range p.Artifacts {
		row := &p.Artifacts[i]
		if err := insertOrVerifyRecoveryRow("artifact", row.ID, func() error { return tx.InsertProcessorArtifact(ctx, row) }, func() (ProcessorArtifact, error) {
			return scanProcessorArtifact(tx.tx.QueryRowContext(ctx, processorArtifactSelect+`WHERE workspace_id=? AND artifact_id=?`, row.WorkspaceID, row.ID))
		}, *row); err != nil {
			return err
		}
	}
	return tx.FinishScanGeneration(ctx, p.Scan.WorkspaceID, p.Scan.ID, ScanIncomplete, false, p.Scan.Summary, p.Scan.FinishedAt.UTC())
}

// orderRecoveryDescriptionDocuments installs immutable description revisions
// in predecessor order without changing the authenticated projection or its
// signed record order. A predecessor outside this projection is permitted only
// when it is already present in the same workspace's operational catalog.
func orderRecoveryDescriptionDocuments(ctx context.Context, tx *Tx, input []DescriptionDocument) ([]DescriptionDocument, error) {
	byID := make(map[string]DescriptionDocument, len(input))
	for _, row := range input {
		if _, exists := byID[row.ID]; exists {
			return nil, fmt.Errorf("duplicate description %q: %w", row.ID, ErrConflict)
		}
		byID[row.ID] = row
	}
	ordered := make([]DescriptionDocument, 0, len(input))
	placed := make(map[string]struct{}, len(input))
	pending := append([]DescriptionDocument(nil), input...)
	for len(pending) > 0 {
		progress := false
		next := pending[:0]
		for _, row := range pending {
			if row.PredecessorID == "" {
				ordered = append(ordered, row)
				placed[row.ID] = struct{}{}
				progress = true
				continue
			}
			if predecessor, included := byID[row.PredecessorID]; included {
				if predecessor.WorkspaceID != row.WorkspaceID {
					return nil, fmt.Errorf("description predecessor %q crosses workspaces: %w", row.PredecessorID, ErrConflict)
				}
				if _, ready := placed[row.PredecessorID]; !ready {
					next = append(next, row)
					continue
				}
			} else {
				var found int
				err := tx.tx.QueryRowContext(ctx, `SELECT 1 FROM description_documents WHERE workspace_id=? AND description_document_id=?`, row.WorkspaceID, row.PredecessorID).Scan(&found)
				if errors.Is(err, sql.ErrNoRows) {
					return nil, fmt.Errorf("description predecessor %q is absent from selected history and catalog: %w", row.PredecessorID, ErrConflict)
				}
				if err != nil {
					return nil, fmt.Errorf("check description predecessor %q: %w", row.PredecessorID, err)
				}
			}
			ordered = append(ordered, row)
			placed[row.ID] = struct{}{}
			progress = true
		}
		if !progress {
			return nil, fmt.Errorf("description predecessor cycle or disconnected history: %w", ErrConflict)
		}
		pending = append([]DescriptionDocument(nil), next...)
	}
	return ordered, nil
}

func insertOrVerifyRecoveryRow[T any](kind, id string, insert func() error, load func() (T, error), want T) error {
	if err := insert(); err == nil {
		return nil
	} else {
		stored, loadErr := load()
		if loadErr != nil {
			return fmt.Errorf("insert recovery %s %q: %w", kind, id, err)
		}
		storedJSON, storedErr := normalizedProjectionJSON(stored)
		wantJSON, wantErr := normalizedProjectionJSON(want)
		if storedErr == nil && wantErr == nil && bytes.Equal(storedJSON, wantJSON) {
			return nil
		}
		return fmt.Errorf("recovery %s %q conflicts with stored row: %w", kind, id, ErrConflict)
	}
}

func orderRecoveryNamespaceEntries(input []NamespaceEntry) ([]NamespaceEntry, error) {
	byID := make(map[string]NamespaceEntry, len(input))
	for _, row := range input {
		if _, exists := byID[row.ID]; exists {
			return nil, ErrConflict
		}
		byID[row.ID] = row
	}
	ordered := make([]NamespaceEntry, 0, len(input))
	pending := append([]NamespaceEntry(nil), input...)
	for len(pending) > 0 {
		progress := false
		next := pending[:0]
		for _, row := range pending {
			if row.ParentID == "" {
				ordered = append(ordered, row)
				progress = true
				continue
			}
			if _, ok := byID[row.ParentID]; !ok {
				return nil, fmt.Errorf("namespace parent %q is outside selected root: %w", row.ParentID, ErrConflict)
			}
			placed := false
			for _, prior := range ordered {
				if prior.ID == row.ParentID {
					placed = true
					break
				}
			}
			if placed {
				ordered = append(ordered, row)
				progress = true
			} else {
				next = append(next, row)
			}
		}
		if !progress {
			return nil, fmt.Errorf("namespace parent cycle or disconnected entry: %w", ErrConflict)
		}
		pending = append([]NamespaceEntry(nil), next...)
	}
	return ordered, nil
}

func cloneRecoveryProjection(p RecoveryCatalogProjection) RecoveryCatalogProjection {
	p.Representations = append([]Representation(nil), p.Representations...)
	p.Observations = append([]Observation(nil), p.Observations...)
	p.FileVersions = append([]FileVersion(nil), p.FileVersions...)
	p.ContentExtents = append([]ContentExtent(nil), p.ContentExtents...)
	p.NamespaceEntries = append([]NamespaceEntry(nil), p.NamespaceEntries...)
	p.Protections = append([]ProtectionRecord(nil), p.Protections...)
	p.RecoveryReferences = append([]RecoveryReference(nil), p.RecoveryReferences...)
	p.ExternalBindings = append([]ExternalBinding(nil), p.ExternalBindings...)
	p.ExternalLocators = append([]ExternalLocator(nil), p.ExternalLocators...)
	p.MetadataFacts = append([]MetadataFact(nil), p.MetadataFacts...)
	p.AnnotationHistories = append([]RecoveryAnnotationHistory(nil), p.AnnotationHistories...)
	p.Descriptions = append([]DescriptionDocument(nil), p.Descriptions...)
	p.Segments = append([]SemanticSegment(nil), p.Segments...)
	p.ProcessorAttempts = append([]ProcessorAttempt(nil), p.ProcessorAttempts...)
	p.Artifacts = append([]ProcessorArtifact(nil), p.Artifacts...)
	for i := range p.AnnotationHistories {
		p.AnnotationHistories[i].Revisions = append([]AnnotationRevision(nil), p.AnnotationHistories[i].Revisions...)
	}
	return p
}

func idsRepresentation(v []Representation) []string {
	r := make([]string, len(v))
	for i := range v {
		r[i] = v[i].ID
	}
	return r
}
func idsObservation(v []Observation) []string {
	r := make([]string, len(v))
	for i := range v {
		r[i] = v[i].ID
	}
	return r
}
func idsFileVersion(v []FileVersion) []string {
	r := make([]string, len(v))
	for i := range v {
		r[i] = v[i].ID
	}
	return r
}
func idsExtent(v []ContentExtent) []string {
	r := make([]string, len(v))
	for i := range v {
		r[i] = v[i].ID
	}
	return r
}
func idsNamespaceEntry(v []NamespaceEntry) []string {
	r := make([]string, len(v))
	for i := range v {
		r[i] = v[i].ID
	}
	return r
}
func idsProtection(v []ProtectionRecord) []string {
	r := make([]string, len(v))
	for i := range v {
		r[i] = v[i].ID
	}
	return r
}
func idsRecovery(v []RecoveryReference) []string {
	r := make([]string, len(v))
	for i := range v {
		r[i] = v[i].ID
	}
	return r
}
func idsBinding(v []ExternalBinding) []string {
	r := make([]string, len(v))
	for i := range v {
		r[i] = v[i].ID
	}
	return r
}
func idsLocator(v []ExternalLocator) []string {
	r := make([]string, len(v))
	for i := range v {
		r[i] = v[i].ID
	}
	return r
}
func idsMetadata(v []MetadataFact) []string {
	r := make([]string, len(v))
	for i := range v {
		r[i] = v[i].ID
	}
	return r
}
func idsDescription(v []DescriptionDocument) []string {
	r := make([]string, len(v))
	for i := range v {
		r[i] = v[i].ID
	}
	return r
}
func idsSegment(v []SemanticSegment) []string {
	r := make([]string, len(v))
	for i := range v {
		r[i] = v[i].ID
	}
	return r
}
func idsAttempt(v []ProcessorAttempt) []string {
	r := make([]string, len(v))
	for i := range v {
		r[i] = v[i].ID
	}
	return r
}
func idsArtifact(v []ProcessorArtifact) []string {
	r := make([]string, len(v))
	for i := range v {
		r[i] = v[i].ID
	}
	return r
}
