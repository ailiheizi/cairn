package sqlite

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestRestoreRecoveryCatalogProjectionReplaysNotesAndDescriptions(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, ":memory:")
	p := recoveryProjectionFixture(t, 1, "portable-root-a")
	p.Descriptions[0].Metadata = nil
	p.Segments[0].Metadata = nil
	if err := store.RestoreRecoveryCatalogProjection(ctx, p); err != nil {
		t.Fatal(err)
	}
	protectionBefore, err := scanProtectionRecord(store.db.QueryRowContext(ctx, protectionRecordSelect+`WHERE workspace_id=? AND subject_ref=?`, p.Workspace.ID, p.Protections[0].SubjectRef))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RestoreRecoveryCatalogProjection(ctx, p); err != nil {
		t.Fatalf("exact replay: %v", err)
	}
	protectionAfter, err := scanProtectionRecord(store.db.QueryRowContext(ctx, protectionRecordSelect+`WHERE workspace_id=? AND subject_ref=?`, p.Workspace.ID, p.Protections[0].SubjectRef))
	if err != nil || !sameProtectionProjection(protectionBefore, protectionAfter) || protectionBefore.Revision != protectionAfter.Revision || !sameTime(protectionBefore.UpdatedAt, protectionAfter.UpdatedAt) {
		t.Fatalf("exact replay changed current protection: before=%+v after=%+v err=%v", protectionBefore, protectionAfter, err)
	}
	got, err := store.GetScanGeneration(ctx, p.Workspace.ID, p.Scan.ID)
	if err != nil || got.State != ScanIncomplete || got.FullTraversal {
		t.Fatalf("scan=%+v err=%v", got, err)
	}
	if root, err := store.GetNamespaceRoot(ctx, p.Workspace.ID, p.Root.ID); err != nil || root.ID != p.Root.ID {
		t.Fatalf("root=%+v err=%v", root, err)
	}
	annotations, err := store.ListAnnotations(ctx, p.Workspace.ID, p.AnnotationHistories[0].Current.SubjectRef, true)
	if err != nil || len(annotations) != 1 || annotations[0].Revision != 2 || annotations[0].Body != "retained note revision two" {
		t.Fatalf("annotations=%+v err=%v", annotations, err)
	}
	revisions, err := store.ListAnnotationRevisions(ctx, p.Workspace.ID, p.AnnotationHistories[0].Current.SubjectRef)
	if err != nil || len(revisions) != 2 || revisions[0].Body != "retained note revision one" {
		t.Fatalf("revisions=%+v err=%v", revisions, err)
	}
	documents, err := store.ListDescriptionDocuments(ctx, p.Workspace.ID, p.Descriptions[0].SubjectRef)
	if err != nil || len(documents) != 1 || documents[0].Body != p.Descriptions[0].Body {
		t.Fatalf("documents=%+v err=%v", documents, err)
	}
	segments, err := store.ListSemanticSegments(ctx, p.Workspace.ID, p.Descriptions[0].ID)
	if err != nil || len(segments) != 1 || segments[0].Text != "retained description body" {
		t.Fatalf("segments=%+v err=%v", segments, err)
	}
	changed := p
	changed.AnnotationHistories = append([]RecoveryAnnotationHistory(nil), p.AnnotationHistories...)
	changed.AnnotationHistories[0].Current.Body = "conflicting body"
	changed.AnnotationHistories[0].Current.BodyDigest = digestText("conflicting body")
	changed.AnnotationHistories[0].Revisions = append([]AnnotationRevision(nil), p.AnnotationHistories[0].Revisions...)
	changed.AnnotationHistories[0].Revisions[1].Body = "conflicting body"
	changed.AnnotationHistories[0].Revisions[1].BodyDigest = digestText("conflicting body")
	if err := store.RestoreRecoveryCatalogProjection(ctx, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("conflicting replay error=%v", err)
	}
	storedAnnotation, err := store.GetAnnotation(ctx, p.Workspace.ID, p.AnnotationHistories[0].Current.ID)
	if err != nil || storedAnnotation.Body != "retained note revision two" {
		t.Fatalf("conflicting replay changed annotation: %+v err=%v", storedAnnotation, err)
	}
	changedEntry := p
	changedEntry.NamespaceEntries = append([]NamespaceEntry(nil), p.NamespaceEntries...)
	changedEntry.NamespaceEntries[0].DisplayName = "different authenticated name"
	if err := store.RestoreRecoveryCatalogProjection(ctx, changedEntry); !errors.Is(err, ErrConflict) {
		t.Fatalf("namespace replay mismatch error=%v", err)
	}
}

func TestRestoreRecoveryCatalogProjectionOrdersDescriptionPredecessors(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, ":memory:")
	p := recoveryProjectionFixture(t, 1, "portable-description-history")
	baseDoc := p.Descriptions[0]
	baseSegment := p.Segments[0]

	parentID := "dsc_ffffffffffffffffffffffffffffffff"
	middleID := "dsc_80000000000000000000000000000000"
	childID := "dsc_00000000000000000000000000000001"
	parent := baseDoc
	parent.ID, parent.Revision, parent.PredecessorID = parentID, 1, ""
	parent.Body, parent.Title = "description revision one", "revision one"
	parent.BodyDigest = digestText(parent.Body)
	middle := baseDoc
	middle.ID, middle.Revision, middle.PredecessorID = middleID, 2, parentID
	middle.Body, middle.Title = "description revision two", "revision two"
	middle.BodyDigest = digestText(middle.Body)
	child := baseDoc
	child.ID, child.Revision, child.PredecessorID = childID, 3, middleID
	child.Body, child.Title = "description revision three", "revision three"
	child.BodyDigest = digestText(child.Body)
	p.Descriptions = []DescriptionDocument{child, middle, parent}

	makeSegment := func(template SemanticSegment, id string, document DescriptionDocument) SemanticSegment {
		segment := template
		segment.ID = id
		segment.DocumentID = document.ID
		segment.DocumentRevision = document.Revision
		segment.Text = document.Body
		segment.TextDigest = digestText(document.Body)
		return segment
	}
	p.Segments = []SemanticSegment{
		makeSegment(baseSegment, "seg_00000000000000000000000000000001", child),
		makeSegment(baseSegment, "seg_80000000000000000000000000000000", middle),
		makeSegment(baseSegment, "seg_ffffffffffffffffffffffffffffffff", parent),
	}

	if err := store.RestoreRecoveryCatalogProjection(ctx, p); err != nil {
		t.Fatalf("restore child-ID-before-parent history: %v", err)
	}
	documents, err := store.ListDescriptionDocuments(ctx, p.Workspace.ID, parent.SubjectRef)
	if err != nil || len(documents) != 3 {
		t.Fatalf("description history=%+v err=%v", documents, err)
	}
	want := []DescriptionDocument{parent, middle, child}
	for i := range want {
		if documents[i].ID != want[i].ID || documents[i].Revision != int64(i+1) || documents[i].Body != want[i].Body || documents[i].PredecessorID != want[i].PredecessorID {
			t.Fatalf("description[%d]=%+v want=%+v", i, documents[i], want[i])
		}
		segments, err := store.ListSemanticSegments(ctx, p.Workspace.ID, want[i].ID)
		if err != nil || len(segments) != 1 || segments[0].DocumentRevision != want[i].Revision || segments[0].Text != want[i].Body {
			t.Fatalf("segments for %s=%+v err=%v", want[i].ID, segments, err)
		}
	}
	if err := store.RestoreRecoveryCatalogProjection(ctx, p); err != nil {
		t.Fatalf("exact replay of ordered description history: %v", err)
	}
	documents, err = store.ListDescriptionDocuments(ctx, p.Workspace.ID, parent.SubjectRef)
	if err != nil || len(documents) != 3 {
		t.Fatalf("description replay changed history: documents=%+v err=%v", documents, err)
	}

	cyclicStore := openTestStore(t, ":memory:")
	cyclic := recoveryProjectionFixture(t, 1, "portable-description-cycle")
	first, second := cyclic.Descriptions[0], cyclic.Descriptions[0]
	first.ID, first.Revision, first.PredecessorID = parentID, 1, childID
	second.ID, second.Revision, second.PredecessorID = childID, 2, parentID
	cyclic.Descriptions = []DescriptionDocument{second, first}
	firstSegment := makeSegment(cyclic.Segments[0], "seg_ffffffffffffffffffffffffffffffff", first)
	secondSegment := makeSegment(cyclic.Segments[0], "seg_00000000000000000000000000000001", second)
	cyclic.Segments = []SemanticSegment{secondSegment, firstSegment}
	if err := cyclicStore.RestoreRecoveryCatalogProjection(ctx, cyclic); !errors.Is(err, ErrConflict) {
		t.Fatalf("cyclic description predecessor error=%v, want conflict", err)
	}
	assertProjectionRolledBack := func(t *testing.T, target *Store) {
		t.Helper()
		for _, table := range []string{"workspaces", "namespace_roots", "description_documents", "semantic_segments", "publications"} {
			var count int
			if err := target.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&count); err != nil || count != 0 {
				t.Fatalf("invalid projection left %d rows in %s (err=%v)", count, table, err)
			}
		}
	}
	assertProjectionRolledBack(t, cyclicStore)

	danglingStore := openTestStore(t, ":memory:")
	dangling := recoveryProjectionFixture(t, 1, "portable-description-dangling")
	danglingDoc := dangling.Descriptions[0]
	danglingDoc.ID, danglingDoc.Revision = childID, 2
	danglingDoc.PredecessorID = "dsc_22222222222222222222222222222222"
	dangling.Descriptions = []DescriptionDocument{danglingDoc}
	danglingSegment := makeSegment(dangling.Segments[0], "seg_00000000000000000000000000000001", danglingDoc)
	dangling.Segments = []SemanticSegment{danglingSegment}
	if err := danglingStore.RestoreRecoveryCatalogProjection(ctx, dangling); !errors.Is(err, ErrConflict) {
		t.Fatalf("dangling description predecessor error=%v, want conflict", err)
	}
	assertProjectionRolledBack(t, danglingStore)
}

func TestRestoreRecoveryCatalogProjectionRejectsOrdinarySavedViewOrExportCatalog(t *testing.T) {
	tests := []struct {
		name  string
		seed  func(context.Context, *Store) error
		check func(context.Context, *Store) error
	}{
		{
			name: "saved view",
			seed: func(ctx context.Context, store *Store) error {
				_, err := store.InsertSavedView(ctx, SavedView{ViewID: testID(t, IDPrefixAnnotation), Name: "Existing view", Query: "notes"})
				return err
			},
			check: func(ctx context.Context, store *Store) error {
				_, err := store.GetSavedViewByName(ctx, "Existing view")
				return err
			},
		},
		{
			name: "export manifest",
			seed: func(ctx context.Context, store *Store) error {
				_, err := store.InsertExportManifest(ctx, ExportManifest{ManifestID: testID(t, "exm"), ManifestDigest: "sha256:" + strings.Repeat("ab", 32), Representation: "EXACT"})
				return err
			},
			check: func(ctx context.Context, store *Store) error {
				rows, err := store.ListExportManifests(ctx)
				if err == nil && len(rows) != 1 {
					return fmt.Errorf("export manifest count=%d, want 1", len(rows))
				}
				return err
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			store := openTestStore(t, ":memory:")
			if err := test.seed(ctx, store); err != nil {
				t.Fatal(err)
			}
			projection := recoveryProjectionFixture(t, 1, "ordinary-catalog-root")
			if err := store.RestoreRecoveryCatalogProjection(ctx, projection); !errors.Is(err, ErrConflict) {
				t.Fatalf("reconstruction over an ordinary %s catalog error = %v, want conflict", test.name, err)
			}
			if err := test.check(ctx, store); err != nil {
				t.Fatalf("existing %s was changed or lost: %v", test.name, err)
			}
			var workspaces int
			if err := store.db.QueryRowContext(ctx, `SELECT count(*) FROM workspaces`).Scan(&workspaces); err != nil || workspaces != 0 {
				t.Fatalf("failed reconstruction left workspaces=%d err=%v", workspaces, err)
			}
		})
	}
}

func TestRestoreCurrentProjectionProtectionRejectsDifferentSameOrderContent(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, ":memory:")
	current := recoveryProjectionFixture(t, 1, "same-order-current")
	if err := store.RestoreRecoveryCatalogProjection(ctx, current); err != nil {
		t.Fatal(err)
	}
	incoming := recoveryProjectionFixture(t, 2, "same-order-incoming")
	incoming.Workspace = current.Workspace
	incoming.Source = current.Source
	incoming.Scan.WorkspaceID = current.Workspace.ID
	incoming.Scan.SourceID = current.Source.ID
	incoming.Scan.Generation = current.Scan.Generation
	incoming.Root.WorkspaceID = current.Workspace.ID
	incoming.Root.SourceID = current.Source.ID
	incoming.Binding.WorkspaceID = current.Workspace.ID
	incoming.Binding.SourceID = current.Source.ID
	incoming.Protections[0].WorkspaceID = current.Workspace.ID
	incoming.Protections[0].ID = current.Protections[0].ID
	incoming.Protections[0].SubjectRef = current.Protections[0].SubjectRef
	incoming.Protections[0].Metadata = protectionProjectionMetadata(current.Scan.Generation, incoming.Root.SnapshotRef, "sha256:incoming-commit", "sha256:incoming-manifest", incoming.Root.ID)
	incoming.Root.Metadata = recoveryProjectionMetadata(map[string]any{"commit_digest": "sha256:incoming-commit", "manifest_digest": "sha256:incoming-manifest", "fact_head_digest": "sha256:incoming-head"})
	incoming.Publication.ManifestDigest = "sha256:incoming-manifest"
	incoming.Protections[0].ExpectedContentID = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
	incoming.Protections[0].ExpectedLogicalLength = current.Protections[0].ExpectedLogicalLength
	before, err := scanProtectionRecord(store.db.QueryRowContext(ctx, protectionRecordSelect+`WHERE workspace_id=? AND subject_ref=?`, current.Workspace.ID, current.Protections[0].SubjectRef))
	if err != nil {
		t.Fatal(err)
	}
	err = store.Update(ctx, func(tx *Tx) error {
		return tx.restoreCurrentProjectionProtection(ctx, incoming, &incoming.Protections[0])
	})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("different same-order protection error = %v, want conflict", err)
	}
	after, err := scanProtectionRecord(store.db.QueryRowContext(ctx, protectionRecordSelect+`WHERE workspace_id=? AND subject_ref=?`, current.Workspace.ID, current.Protections[0].SubjectRef))
	if err != nil || !sameProtectionProjection(before, after) || before.Revision != after.Revision {
		t.Fatalf("rejected same-order protection changed current row: before=%+v after=%+v err=%v", before, after, err)
	}
}

func TestValidateStoredProjectionProtectionRequiresNamedRootSubjectMapping(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, ":memory:")
	projection := recoveryProjectionFixture(t, 1, "mapped-protection-root")
	if err := store.RestoreRecoveryCatalogProjection(ctx, projection); err != nil {
		t.Fatal(err)
	}

	// Install a second recovery-projection root in the same domain, but keep its
	// distinct stable subject. Publication metadata alone cannot ground a
	// protection when that subject is absent from the named root.
	stamp := projection.Scan.StartedAt.Add(2 * time.Minute)
	scanID := testID(t, IDPrefixScanGeneration)
	bindingID := testID(t, IDPrefixCaptureBinding)
	rootID := testID(t, IDPrefixNamespaceRoot)
	publicationID := testID(t, IDPrefixPublication)
	commitDigest, manifestDigest, snapshotRef := "sha256:unmapped-commit", "sha256:unmapped-manifest", "unmapped-protection-snapshot"
	if err := store.Update(ctx, func(tx *Tx) error {
		scan := projection.Scan
		scan.ID, scan.Generation, scan.State, scan.FinishedAt = scanID, 2, ScanRunning, nil
		scan.CaptureSetID = bindingID
		scan.StartedAt = stamp
		if err := tx.InsertScanGeneration(ctx, &scan); err != nil {
			return err
		}
		binding := projection.Binding
		binding.ID, binding.ScanGenerationID, binding.BoundAt = bindingID, scanID, stamp
		if err := tx.InsertCaptureRootBinding(ctx, &binding); err != nil {
			return err
		}
		root := projection.Root
		root.ID, root.ScanGenerationID, root.SnapshotRef = rootID, scanID, snapshotRef
		root.AuthorityDigest = manifestDigest
		root.CreatedAt = stamp
		root.Metadata = recoveryProjectionMetadata(map[string]any{"commit_digest": commitDigest, "manifest_digest": manifestDigest, "fact_head_digest": "sha256:unmapped-head"})
		if err := tx.InsertNamespaceRoot(ctx, &root); err != nil {
			return err
		}
		publication := projection.Publication
		publication.ID, publication.ScanGenerationID, publication.BindingID = publicationID, scanID, bindingID
		publication.NamespaceRootID, publication.SnapshotRef, publication.ManifestDigest = rootID, snapshotRef, manifestDigest
		publication.CommittedAt, publication.Metadata = stamp, recoveryProjectionMetadata(map[string]any{})
		if err := tx.InsertPublication(ctx, &publication); err != nil {
			return err
		}
		finished := stamp.Add(time.Second)
		return tx.FinishScanGeneration(ctx, projection.Workspace.ID, scanID, ScanIncomplete, false, scan.Summary, finished)
	}); err != nil {
		t.Fatalf("insert same-domain root without selected subject: %v", err)
	}

	forged := projection.Protections[0]
	forged.Metadata = protectionProjectionMetadata(2, snapshotRef, commitDigest, manifestDigest, rootID)
	err := store.Update(ctx, func(tx *Tx) error {
		_, err := tx.validateStoredProjectionProtection(ctx, projection, forged)
		return err
	})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("protection grounded only by publication metadata error = %v, want subject-mapping conflict", err)
	}
}

func TestRestoreRecoveryCatalogProjectionAllowsTwoRootsAndKeepsLatestOrder(t *testing.T) {
	ctx := context.Background()
	first := recoveryProjectionFixture(t, 1, "portable-root-one")
	second := recoveryProjectionFixture(t, 2, "portable-root-two")
	second.Workspace = first.Workspace
	second.Source = first.Source
	second.Scan.WorkspaceID = first.Workspace.ID
	second.Scan.SourceID = first.Source.ID
	second.Binding.WorkspaceID = first.Workspace.ID
	second.Binding.SourceID = first.Source.ID
	second.Root.WorkspaceID = first.Workspace.ID
	second.Root.SourceID = first.Source.ID
	second.Publication.WorkspaceID = first.Workspace.ID
	second.AnnotationHistories = first.AnnotationHistories
	// The same stable subject is present under both retained roots, with
	// independently identified per-root observation and file-version rows.
	second.NamespaceEntries[0].SubjectRef = first.AnnotationHistories[0].Current.SubjectRef
	second.Descriptions = first.Descriptions
	second.Segments = first.Segments
	second.MetadataFacts = first.MetadataFacts
	contentTwo := "sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
	second.Representations[0].ContentID = contentTwo
	second.Representations[0].RecordDigest = "sha256:representation-two"
	second.Observations[0].ContentID = contentTwo
	second.Observations[0].StatDigest = "sha256:stat-two"
	second.FileVersions[0].ContentID = contentTwo
	second.FileVersions[0].AuthoritativeRepresentationID = second.Representations[0].ID
	second.FileVersions[0].ExtentSetDigest = "sha256:extent-set-two"
	second.ContentExtents[0].RepresentationID = second.Representations[0].ID
	second.ContentExtents[0].ExtentDigest = "sha256:extent-two"
	second.NamespaceEntries[0].ContentID = contentTwo
	second.NamespaceEntries[0].FileVersionID = second.FileVersions[0].ID
	second.Protections[0].ID = first.Protections[0].ID
	second.Protections[0].SubjectRef = first.Protections[0].SubjectRef
	second.Protections[0].ExpectedContentID = contentTwo
	second.Protections[0].LocalRepresentationID = second.Representations[0].ID
	second.Protections[0].LastVerificationRef = "portable-commit:verified-content-two"
	second.Protections[0].LastVerifiedAt = timePtr(second.Scan.StartedAt)
	second.Protections[0].Metadata = protectionProjectionMetadata(second.Scan.Generation, second.Root.SnapshotRef, "sha256:commit-two", "sha256:manifest-two", second.Root.ID)
	second.RecoveryReferences[0].ProtectionRecordID = first.Protections[0].ID
	second.RecoveryReferences[0].ExpectedContentID = contentTwo
	second.RecoveryReferences[0].RepresentationID = second.Representations[0].ID
	second.RecoveryReferences[0].RecordDigest = "sha256:recovery-reference-two"
	second.Root.AuthorityDigest = "sha256:manifest-two"
	second.Root.Metadata = recoveryProjectionMetadata(map[string]any{"commit_digest": "sha256:commit-two", "manifest_digest": "sha256:manifest-two", "fact_head_digest": "sha256:head-two"})
	second.Publication.ManifestDigest = "sha256:manifest-two"
	second.Protections[0].ExpectedLogicalLength = second.NamespaceEntries[0].LogicalSize
	second.MetadataFacts[0].SubjectRef = first.Protections[0].SubjectRef
	for i := range second.Representations {
		second.Representations[i].WorkspaceID = first.Workspace.ID
	}
	for i := range second.Observations {
		second.Observations[i].WorkspaceID = first.Workspace.ID
		second.Observations[i].SourceID = first.Source.ID
	}
	for i := range second.FileVersions {
		second.FileVersions[i].WorkspaceID = first.Workspace.ID
	}
	for i := range second.ContentExtents {
		second.ContentExtents[i].WorkspaceID = first.Workspace.ID
	}
	for i := range second.NamespaceEntries {
		second.NamespaceEntries[i].WorkspaceID = first.Workspace.ID
	}
	for i := range second.Protections {
		second.Protections[i].WorkspaceID = first.Workspace.ID
	}
	for i := range second.RecoveryReferences {
		second.RecoveryReferences[i].WorkspaceID = first.Workspace.ID
		second.RecoveryReferences[i].SubjectRef = first.Protections[0].SubjectRef
	}

	for _, tc := range []struct {
		name  string
		order []RecoveryCatalogProjection
	}{
		{name: "newer then older", order: []RecoveryCatalogProjection{second, first}},
		{name: "older then newer", order: []RecoveryCatalogProjection{first, second}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := openTestStore(t, ":memory:")
			for _, projection := range tc.order {
				if err := store.RestoreRecoveryCatalogProjection(ctx, projection); err != nil {
					t.Fatalf("restore generation %d: %v", projection.Scan.Generation, err)
				}
			}
			// Exact replay of both publications remains safe after the current
			// protection projection has advanced to the newer signed capture.
			for _, projection := range []RecoveryCatalogProjection{first, second} {
				if err := store.RestoreRecoveryCatalogProjection(ctx, projection); err != nil {
					t.Fatalf("replay generation %d: %v", projection.Scan.Generation, err)
				}
			}
			publication, err := store.LatestPublicationForSource(ctx, first.Workspace.ID, first.Source.ID)
			if err != nil || publication.ID != second.Publication.ID {
				t.Fatalf("latest=%+v err=%v", publication, err)
			}
			protection, err := scanProtectionRecord(store.db.QueryRowContext(ctx, protectionRecordSelect+`WHERE workspace_id=? AND subject_ref=?`, first.Workspace.ID, first.Protections[0].SubjectRef))
			if err != nil || protection.ID != first.Protections[0].ID || protection.ExpectedContentID != contentTwo || protection.LocalRepresentationID != second.Representations[0].ID {
				t.Fatalf("current protection=%+v err=%v", protection, err)
			}
			var roots, docs, segments, metadataFacts, refs int
			for _, item := range []struct {
				table  string
				target *int
			}{{"namespace_roots", &roots}, {"description_documents", &docs}, {"semantic_segments", &segments}, {"metadata_facts", &metadataFacts}, {"recovery_references", &refs}} {
				if err := store.db.QueryRowContext(ctx, `SELECT count(*) FROM `+item.table+` WHERE workspace_id=?`, first.Workspace.ID).Scan(item.target); err != nil {
					t.Fatal(err)
				}
			}
			if roots != 2 || docs != 1 || segments != 1 || metadataFacts != 1 || refs != 2 {
				t.Fatalf("roots=%d docs=%d segments=%d metadata facts=%d recovery refs=%d", roots, docs, segments, metadataFacts, refs)
			}
			storedAnnotations, err := store.ListAnnotations(ctx, first.Workspace.ID, first.AnnotationHistories[0].Current.SubjectRef, true)
			if err != nil || len(storedAnnotations) != 1 || storedAnnotations[0].Revision != 2 {
				t.Fatalf("shared annotation=%+v err=%v", storedAnnotations, err)
			}
		})
	}
}

func TestRestoreRecoveryCatalogProjectionLateFailureRollsBack(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, ":memory:")
	p := recoveryProjectionFixture(t, 1, "late-conflict-root")
	if _, err := store.db.Exec(`CREATE TRIGGER reject_recovery_publication BEFORE INSERT ON publications WHEN NEW.publication_id = '` + p.Publication.ID + `' BEGIN SELECT RAISE(ABORT, 'injected final publication failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err := store.RestoreRecoveryCatalogProjection(ctx, p); err == nil {
		t.Fatal("late publication failure was ignored")
	}
	for _, table := range []string{
		"workspaces", "sources", "scan_generations", "capture_root_bindings", "representations",
		"namespace_roots", "namespace_entries", "observations", "file_versions", "content_extents",
		"physical_locator_projections", "annotations", "annotation_revisions", "description_documents",
		"semantic_segments", "protection_records", "recovery_references", "external_bindings",
		"external_locators", "metadata_facts", "processor_attempts", "processor_artifacts",
		"publications", "saved_views", "export_manifests",
	} {
		var count int
		if err := store.db.QueryRow(`SELECT count(*) FROM ` + table).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("late failure left %d rows in %s", count, table)
		}
	}
}

func recoveryProjectionFixture(t *testing.T, generation int64, snapshot string) RecoveryCatalogProjection {
	t.Helper()
	timestamp := time.Date(2026, 10, 16, 12, 0, 0, 0, time.FixedZone("fixture+08", 8*60*60)).Add(time.Duration(generation) * time.Minute)
	workspace := testID(t, IDPrefixWorkspace)
	source := testID(t, IDPrefixSource)
	scan := testID(t, IDPrefixScanGeneration)
	binding := testID(t, IDPrefixCaptureBinding)
	root := testID(t, IDPrefixNamespaceRoot)
	projectionMeta := recoveryProjectionMetadata
	subject := testID(t, IDPrefixSubject)
	observationID := testID(t, IDPrefixObservation)
	fileVersionID := testID(t, IDPrefixFileVersion)
	representationID := testID(t, IDPrefixRepresentation)
	contentID := "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	fileLength := int64(4)
	allocatedLength := int64(4096)
	lastVerified := timestamp
	annotationID := testID(t, IDPrefixAnnotation)
	current, revisions := restoreAnnotationChain(workspace, subject, annotationID, AnnotationNote)
	revisions = revisions[:2]
	for i := range revisions {
		revisions[i].CreatedAt = timestamp.Add(time.Duration(i-2) * time.Minute)
	}
	current.CreatedAt = revisions[0].CreatedAt
	current.UpdatedAt = revisions[1].CreatedAt
	current.Revision = 2
	current.PredecessorRevision = 1
	current.Tombstoned = false
	current.Body = "retained note revision two"
	current.BodyDigest = digestText(current.Body)
	revisions[0].Body = "retained note revision one"
	revisions[0].BodyDigest = digestText(revisions[0].Body)
	revisions[1].Body = current.Body
	revisions[1].BodyDigest = current.BodyDigest
	descriptionID := testID(t, IDPrefixDescription)
	description := DescriptionDocument{ID: descriptionID, WorkspaceID: workspace, SubjectRef: subject, Kind: DescriptionImported, Title: "Imported", Language: "en", Body: "retained description body", BodyDigest: digestText("retained description body"), SourceRef: "sha256:source:0:28", ProducerProfile: "verbatim-import", ConfigDigest: "sha256:config", ProducerProfileDigest: DescriptionProducerProfileDigest("verbatim-import"), Visibility: "private", Accepted: true, Revision: 1, Metadata: json.RawMessage(`{"origin":"SIGNED_RECOVERY_PROJECTION"}`), CreatedAt: timestamp, UpdatedAt: timestamp}
	segment := SemanticSegment{ID: testID(t, IDPrefixSemanticSegment), WorkspaceID: workspace, DocumentID: descriptionID, SubjectRef: subject, DocumentRevision: 1, Ordinal: 0, Text: "retained description body", TextDigest: digestText("retained description body"), Language: "en", SourceSpan: json.RawMessage(`{"start":0,"end":28}`), Metadata: json.RawMessage(`{"origin":"SIGNED_RECOVERY_PROJECTION"}`), SegmentationProfileDigest: DescriptionSegmentationProfileDigestV1, CreatedAt: timestamp}
	representation := Representation{ID: representationID, WorkspaceID: workspace, ContentID: contentID, DecodedLength: fileLength, OwnershipMode: OwnershipCairnPacks, CodecProfileRef: "identity/sha256-v1", AccessMode: AccessRandomNative, MinimumReadableUnit: 1, RecordDigest: "sha256:representation", Metadata: json.RawMessage(`{"origin":"SIGNED_RECOVERY_PROJECTION"}`), CreatedAt: timestamp}
	observation := Observation{ID: observationID, WorkspaceID: workspace, SourceID: source, ScanGenerationID: scan, PathKey: []byte("note.txt"), RawPath: []byte("note.txt"), DisplayPath: "note.txt", EntryType: EntryFile, ContentID: contentID, FileVersionID: fileVersionID, StatDigest: "sha256:stat", LogicalSize: &fileLength, AllocatedSize: &allocatedLength, ReadState: "RECOVERED_AUTHENTICATED", Metadata: projectionMeta(map[string]any{}), ObservedAt: timestamp}
	fileVersion := FileVersion{ID: fileVersionID, WorkspaceID: workspace, ScanGenerationID: scan, ObservationID: observationID, AssetID: testID(t, "ast"), ContentID: contentID, LogicalSize: fileLength, HashingProfile: "sha256-complete-stream-v1", AuthoritativeRepresentationID: representationID, ExtentSetDigest: "sha256:extent-set", HardlinkGroupID: "", SparseEvidence: json.RawMessage(`{"known":false,"origin":"SIGNED_RECOVERY_PROJECTION"}`), VerificationRef: "portable-commit:verified-content", RecordDigest: "sha256:file-version", CreatedAt: timestamp}
	extent := ContentExtent{ID: testID(t, IDPrefixContentExtent), WorkspaceID: workspace, FileVersionID: fileVersionID, Ordinal: 0, LogicalOffset: 0, LogicalLength: fileLength, Kind: ExtentData, RepresentationID: representationID, RepresentationOffset: 0, ExtentDigest: "sha256:extent", Metadata: projectionMeta(map[string]any{}), CreatedAt: timestamp}
	entry := NamespaceEntry{ID: testID(t, IDPrefixNamespaceEntry), SubjectRef: subject, WorkspaceID: workspace, RootID: root, ObservationID: observationID, RawName: []byte("note.txt"), DisplayName: "note.txt", FullPathKey: []byte("note.txt"), EntryType: EntryFile, Metadata: projectionMeta(map[string]any{}), ContentID: contentID, FileVersionID: fileVersionID, HardlinkGroupID: "", LogicalSize: &fileLength, AllocatedSize: &allocatedLength, CreatedAt: timestamp}
	protection := ProtectionRecord{ID: testID(t, IDPrefixProtectionRecord), WorkspaceID: workspace, SubjectRef: subject, Mode: ProtectionStoreExact, Outcome: ProtectionExactProtected, ExpectedContentID: contentID, ExpectedLogicalLength: &fileLength, LocalRepresentationID: representationID, LastVerificationRef: "portable-commit:verified-content", LastVerifiedAt: &lastVerified, Revision: 1, Metadata: projectionMeta(map[string]any{}), CreatedAt: timestamp, UpdatedAt: timestamp}
	protection.Metadata = protectionProjectionMetadata(generation, snapshot, "sha256:commit", "sha256:manifest", root)
	metadataFact := MetadataFact{ID: testID(t, IDPrefixMetadataFact), WorkspaceID: workspace, SubjectRef: subject, Namespace: "recovery-test", Key: "fixture", Value: json.RawMessage(`{"source":"portable"}`), ValueType: "OBJECT", AuthorityClass: "SIGNED", SourceRef: "portable-commit:metadata", Revision: 1, CreatedAt: timestamp}
	recoveryReference := RecoveryReference{ID: testID(t, IDPrefixRecoveryReference), WorkspaceID: workspace, ProtectionRecordID: protection.ID, SubjectRef: subject, Kind: RecoveryExactRepresentation, Priority: 0, Claim: RecoveryClaimRestoreVerified, ExpectedContentID: contentID, ExpectedLogicalLength: &fileLength, RepresentationID: representationID, Verification: json.RawMessage(`{"verified":true}`), Status: "VERIFIED", RecordDigest: "sha256:recovery-reference", Metadata: projectionMeta(map[string]any{}), CreatedAt: timestamp, UpdatedAt: timestamp}
	return RecoveryCatalogProjection{
		Workspace:       Workspace{ID: workspace, Name: "Recovered", Metadata: projectionMeta(map[string]any{}), Revision: 1, CreatedAt: timestamp, UpdatedAt: timestamp},
		Source:          Source{ID: source, WorkspaceID: workspace, StableKey: "recovered-source", Kind: "RECOVERY_PUBLICATION", Locator: "cairn-recovery:" + source, IdentityFingerprint: "sha256:source", State: SourceLost, Metadata: projectionMeta(map[string]any{}), Revision: 1, CreatedAt: timestamp, UpdatedAt: timestamp},
		Scan:            ScanGeneration{ID: scan, WorkspaceID: workspace, SourceID: source, Generation: generation, CaptureSetID: binding, CaptureSetDigest: "sha256:binding", State: ScanIncomplete, FullTraversal: false, Summary: projectionMeta(map[string]any{}), StartedAt: timestamp, FinishedAt: timePtr(timestamp.Add(time.Second))},
		Binding:         CaptureRootBinding{ID: binding, WorkspaceID: workspace, SourceID: source, ScanGenerationID: scan, CaptureMode: "ROOTED_FD", Profile: "recovery-projection", DisplayPath: "recovery-projection", ConsistencyClaim: "SIGNED_RECOVERY_PROJECTION", IdentityDigest: "sha256:binding", BoundAt: timestamp, Record: projectionMeta(map[string]any{})},
		Root:            NamespaceRoot{ID: root, WorkspaceID: workspace, SourceID: source, ScanGenerationID: scan, SnapshotRef: snapshot, Name: "Recovered root", RootPathKey: []byte{}, FilesystemSemantics: "recovery-projection", AuthorityDigest: "sha256:manifest", Metadata: projectionMeta(map[string]any{"commit_digest": "sha256:commit", "manifest_digest": "sha256:manifest", "fact_head_digest": "sha256:head"}), CreatedAt: timestamp},
		Publication:     Publication{ID: testID(t, IDPrefixPublication), WorkspaceID: workspace, SnapshotRef: snapshot, ScanGenerationID: scan, BindingID: binding, NamespaceRootID: root, ManifestDigest: "sha256:manifest", CommittedAt: timestamp, Metadata: projectionMeta(map[string]any{})},
		Representations: []Representation{representation}, Observations: []Observation{observation}, FileVersions: []FileVersion{fileVersion}, ContentExtents: []ContentExtent{extent}, NamespaceEntries: []NamespaceEntry{entry}, Protections: []ProtectionRecord{protection},
		RecoveryReferences: []RecoveryReference{recoveryReference}, MetadataFacts: []MetadataFact{metadataFact},
		AnnotationHistories: []RecoveryAnnotationHistory{{Current: current, Revisions: revisions}},
		Descriptions:        []DescriptionDocument{description}, Segments: []SemanticSegment{segment},
	}
}

func recoveryProjectionMetadata(extra map[string]any) json.RawMessage {
	extra["origin"] = recoveryProjectionOrigin
	extra["publication_domain"] = "domain-a"
	extra["trust_anchor_digest"] = "sha256:anchor"
	value, _ := json.Marshal(extra)
	return value
}

func protectionProjectionMetadata(generation int64, snapshot, commit, manifest, rootID string) json.RawMessage {
	return recoveryProjectionMetadata(map[string]any{
		"publication_generation": generation,
		"snapshot_ref":           snapshot,
		"commit_digest":          commit,
		"manifest_digest":        manifest,
		"namespace_root_id":      rootID,
	})
}

func timePtr(value time.Time) *time.Time { value = value.UTC(); return &value }
