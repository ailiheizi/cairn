package exact

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestRecoveryCatalogProjectionFromV2AndV3(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "recovered.txt", []byte("exact recovered payload"))
	ingested := fixture.ingest(t, "sha256:recovery-projection-plan")
	nodes, err := fixture.store.ListNamespaceSubtree(ctx, ingested.WorkspaceID, ingested.RootID, "")
	if err != nil {
		t.Fatal(err)
	}
	var subject string
	for _, node := range nodes {
		if node.Entry.ContentID != "" {
			subject = node.Entry.SubjectRef
			break
		}
	}
	if subject == "" {
		t.Fatal("signed fixture has no stable file subject")
	}
	var originalFileVersion sqlite.FileVersion
	var originalExtents []sqlite.ContentExtent
	for _, node := range nodes {
		if node.Entry.SubjectRef != subject || node.Entry.FileVersionID == "" {
			continue
		}
		originalFileVersion, err = fixture.store.GetFileVersion(ctx, ingested.WorkspaceID, node.Entry.FileVersionID)
		if err != nil {
			t.Fatal(err)
		}
		originalExtents, err = fixture.store.ListContentExtents(ctx, ingested.WorkspaceID, node.Entry.FileVersionID)
		if err != nil {
			t.Fatal(err)
		}
		break
	}
	if originalFileVersion.ID == "" {
		t.Fatal("signed fixture has no original file-version row")
	}
	annotationID, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.store.CreateAnnotation(ctx, &sqlite.Annotation{ID: annotationID, WorkspaceID: ingested.WorkspaceID, SubjectRef: subject, Kind: sqlite.AnnotationNote, Body: "portable note body", Revision: 1}); err != nil {
		t.Fatal(err)
	}
	descriptionID, err := sqlite.NewStableID(sqlite.IDPrefixDescription)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.store.InsertDescriptionDocument(ctx, &sqlite.DescriptionDocument{ID: descriptionID, WorkspaceID: ingested.WorkspaceID, SubjectRef: subject, Kind: sqlite.DescriptionUser, Language: "en", Body: "portable description body", SourceRef: "user:test", ProducerProfile: "user", ConfigDigest: ingested.ConfigDigest, ProducerProfileDigest: sqlite.DescriptionProducerProfileDigest("user"), Visibility: "PRIVATE", Revision: 1}); err != nil {
		t.Fatal(err)
	}
	if err := fixture.service.PublishPortableFactClosure(ctx, ingested.WorkspaceID, ingested.SnapshotRef, ingested.PublicationCommitDigest); err != nil {
		t.Fatal(err)
	}
	reader := &Service{Repo: fixture.repo, TrustAnchor: fixture.service.TrustAnchor, PublicationDomain: testPublicationDomain}
	reference, err := reader.BuildRecoveryReference(ctx, ingested.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	v2Bytes, err := MarshalRecoveryReference(reference)
	if err != nil {
		t.Fatal(err)
	}
	v3 := compactReferenceFromV2ForTest(t, reference)
	v3Bytes, err := MarshalCompactRecoveryReference(v3)
	if err != nil {
		t.Fatal(err)
	}
	anchorPath := filepath.Join(t.TempDir(), "trust-anchor.json")
	if _, err := ExportTrustAnchor(*fixture.service.TrustAnchor, anchorPath); err != nil {
		t.Fatal(err)
	}

	for _, test := range []struct {
		name    string
		payload []byte
	}{
		{name: "v2", payload: v2Bytes},
		{name: "v3", payload: v3Bytes},
	} {
		t.Run(test.name, func(t *testing.T) {
			artifactPath := filepath.Join(t.TempDir(), "recovery.json")
			if err := os.WriteFile(artifactPath, test.payload, 0o600); err != nil {
				t.Fatal(err)
			}
			fresh, err := sqlite.Open(ctx, filepath.Join(t.TempDir(), "fresh.sqlite"), sqlite.Options{})
			if err != nil {
				t.Fatal(err)
			}
			defer fresh.Close()
			projectionService := &Service{Store: fresh, Repo: fixture.repo, RequireSignedPublication: true}
			imported, err := projectionService.ImportRecoveryArtifact(ctx, artifactPath, anchorPath, testPublicationDomain)
			if err != nil {
				t.Fatalf("store-backed import: %v", err)
			}
			if !imported.CatalogCreated {
				t.Fatal("fresh store-backed import did not create a catalog projection")
			}
			root, err := fresh.GetNamespaceRootBySnapshotRef(ctx, ingested.SnapshotRef)
			if err != nil {
				t.Fatalf("recovered namespace root: %v", err)
			}
			if root.Name != "Recovered content" || root.AuthorityDigest == "" {
				t.Fatalf("recovered root lost its local recovery provenance: %+v", root)
			}
			var rootMetadata map[string]any
			if err := json.Unmarshal(root.Metadata, &rootMetadata); err != nil || rootMetadata["projection_time_semantics"] != "signed-commit-time-used-for-unavailable-operational-timestamps" {
				t.Fatalf("recovered root does not disclose projected timestamp semantics: metadata=%s err=%v", root.Metadata, err)
			}
			publication, err := projectionTestPublication(ctx, fixture.service, ingested.SnapshotRef)
			if err != nil {
				t.Fatal(err)
			}
			storedPublication, err := fresh.GetPublicationBySnapshotRef(ctx, ingested.WorkspaceID, ingested.SnapshotRef)
			if err != nil {
				t.Fatalf("recovered publication: %v", err)
			}
			binding, err := fresh.GetCaptureRootBinding(ctx, ingested.WorkspaceID, storedPublication.BindingID)
			if err != nil {
				t.Fatalf("recovered capture binding: %v", err)
			}
			if binding.DisplayPath != publication.Manifest.Binding.DisplayPath {
				t.Fatalf("recovered binding display path = %q, want signed historical value %q", binding.DisplayPath, publication.Manifest.Binding.DisplayPath)
			}
			notes, err := fresh.ListAnnotations(ctx, ingested.WorkspaceID, subject, false)
			if err != nil || len(notes) != 1 || notes[0].ID != annotationID || notes[0].Body != "portable note body" {
				t.Fatalf("recovered Note = %+v, err=%v", notes, err)
			}
			descriptions, err := fresh.ListDescriptionDocuments(ctx, ingested.WorkspaceID, subject)
			if err != nil || len(descriptions) != 1 || descriptions[0].ID != descriptionID || descriptions[0].Body != "portable description body" {
				t.Fatalf("recovered descriptions = %+v, err=%v", descriptions, err)
			}
			entries, err := fresh.ListNamespaceSubtree(ctx, ingested.WorkspaceID, root.ID, "")
			if err != nil || len(entries) == 0 {
				t.Fatalf("recovered namespace entries = %d, err=%v", len(entries), err)
			}
			var fileVersion sqlite.FileVersion
			for _, node := range entries {
				if node.Entry.SubjectRef == subject {
					fileVersion, err = fresh.GetFileVersion(ctx, ingested.WorkspaceID, node.Entry.FileVersionID)
					break
				}
			}
			if err != nil || fileVersion.ContentID == "" || fileVersion.LogicalSize != int64(len("exact recovered payload")) {
				t.Fatalf("recovered file version = %+v, err=%v", fileVersion, err)
			}
			wantFileVersion := originalFileVersion
			wantFileVersion.ScanGenerationID = fileVersion.ScanGenerationID
			wantFileVersion.ObservationID = fileVersion.ObservationID
			if !reflect.DeepEqual(fileVersion, wantFileVersion) {
				t.Fatalf("recovered FileVersion changed authenticated non-FK fields: got=%+v want=%+v", fileVersion, wantFileVersion)
			}
			recoveredExtents, err := fresh.ListContentExtents(ctx, ingested.WorkspaceID, fileVersion.ID)
			if err != nil || !reflect.DeepEqual(recoveredExtents, originalExtents) {
				t.Fatalf("recovered ContentExtents = %+v, want original rows %+v; err=%v", recoveredExtents, originalExtents, err)
			}
			publicationEntry := findManifestEntryByPath(publication.Manifest, []byte("recovered.txt"))
			representationIDs := map[string]struct{}{originalFileVersion.AuthoritativeRepresentationID: {}}
			for _, extent := range originalExtents {
				representationIDs[extent.RepresentationID] = struct{}{}
			}
			for _, representationID := range portableSelectedRepresentationRefs(publicationEntry.Protection) {
				representationIDs[representationID] = struct{}{}
			}
			for representationID := range representationIDs {
				originalRepresentation, err := fixture.store.GetRepresentation(ctx, ingested.WorkspaceID, representationID)
				if err != nil {
					t.Fatal(err)
				}
				recoveredRepresentation, err := fresh.GetRepresentation(ctx, ingested.WorkspaceID, representationID)
				if err != nil || !reflect.DeepEqual(recoveredRepresentation, originalRepresentation) {
					t.Fatalf("recovered Representation %q = %+v, want original row %+v; err=%v", representationID, recoveredRepresentation, originalRepresentation, err)
				}
			}
			if err := verifyExactObjectReadback(ctx, fixture.repo, fileVersion.ContentID, fileVersion.LogicalSize); err != nil {
				t.Fatalf("recovered exact content identity: %v", err)
			}
			replayed, err := projectionService.ImportRecoveryArtifact(ctx, artifactPath, anchorPath, testPublicationDomain)
			if err != nil {
				t.Fatalf("exact recovery catalog replay: %v", err)
			}
			if replayed.CatalogCreated {
				t.Fatal("exact catalog replay was reported as a new reconstruction")
			}
		})
	}
}

func TestRecoveryCatalogProjectionFromTwoSnapshotsKeepsSignedHistory(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "recovered.txt", []byte("first exact payload"))
	first := fixture.ingest(t, "sha256:recovery-projection-first")

	firstPublication, err := projectionTestPublication(ctx, fixture.service, first.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	firstProtection := findManifestEntryByPath(firstPublication.Manifest, []byte("recovered.txt")).Protection

	if err := os.WriteFile(filepath.Join(fixture.source, "recovered.txt"), []byte("second exact payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	second := fixture.ingest(t, "sha256:recovery-projection-second")
	secondPublication, err := projectionTestPublication(ctx, fixture.service, second.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	secondProtection := findManifestEntryByPath(secondPublication.Manifest, []byte("recovered.txt")).Protection
	if firstProtection.RecordID != secondProtection.RecordID || firstProtection.ExpectedContentID == secondProtection.ExpectedContentID {
		t.Fatalf("expected same signed protection id with snapshot-specific content identity, got first=%+v second=%+v", firstProtection, secondProtection)
	}

	anchorPath := filepath.Join(t.TempDir(), "trust-anchor.json")
	if _, err := ExportTrustAnchor(*fixture.service.TrustAnchor, anchorPath); err != nil {
		t.Fatal(err)
	}
	var references []RecoveryReference
	for _, snapshot := range []string{first.SnapshotRef, second.SnapshotRef} {
		reference, err := fixture.service.BuildRecoveryReference(ctx, snapshot)
		if err != nil {
			t.Fatal(err)
		}
		references = append(references, reference)
	}

	fresh, err := sqlite.Open(ctx, filepath.Join(t.TempDir(), "fresh.sqlite"), sqlite.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	projectionService := &Service{Store: fresh, Repo: fixture.repo, RequireSignedPublication: true}
	// Import in reverse publication order. Reconstruction must retain both
	// signed roots while SQLite continues to identify the newer scan as latest.
	for index := len(references) - 1; index >= 0; index-- {
		payload, err := MarshalRecoveryReference(references[index])
		if err != nil {
			t.Fatal(err)
		}
		artifactPath := filepath.Join(t.TempDir(), "recovery.json")
		if err := os.WriteFile(artifactPath, payload, 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := projectionService.ImportRecoveryArtifact(ctx, artifactPath, anchorPath, testPublicationDomain); err != nil {
			t.Fatalf("import selected snapshot %s in reverse order: %v", references[index].SnapshotRef, err)
		}
	}
	subject := stableSubjectForSnapshotFile(t, fixture.service, second.SnapshotRef, "recovered.txt")
	currentProtection, err := fresh.GetProtectionRecordBySubject(ctx, first.WorkspaceID, subject)
	if err != nil {
		t.Fatalf("recovered current protection: %v", err)
	}
	if currentProtection.ExpectedContentID != secondProtection.ExpectedContentID {
		t.Fatalf("reverse import downgraded current protection to %q, want latest authenticated content %q", currentProtection.ExpectedContentID, secondProtection.ExpectedContentID)
	}
	latestRoots, err := fresh.ListLatestNamespaceRoots(ctx, first.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if len(latestRoots) != 1 || latestRoots[0].SnapshotRef != second.SnapshotRef {
		t.Fatalf("latest reconstructed roots = %+v, want newer signed snapshot %q", latestRoots, second.SnapshotRef)
	}
}

func TestRecoveryCatalogProjectionRejectsMissingOrMismatchedRelationWitness(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "witness.txt", []byte("authenticated relation bytes"))
	ingested := fixture.ingest(t, "sha256:recovery-projection-witness-refusal")
	if err := fixture.service.PublishPortableFactClosure(ctx, ingested.WorkspaceID, ingested.SnapshotRef, ingested.PublicationCommitDigest); err != nil {
		t.Fatal(err)
	}
	publication, err := projectionTestPublication(ctx, fixture.service, ingested.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	reference, err := fixture.service.BuildRecoveryReference(ctx, ingested.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	if len(reference.PortableFactClosures) == 0 {
		t.Fatal("fixture has no authenticated portable fact closure")
	}
	closureRef := reference.PortableFactClosures[len(reference.PortableFactClosures)-1]
	closures, err := fixture.service.ListPortableFactClosures(ctx, ingested.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	var closure PortableFactClosureEnvelope
	for _, candidate := range closures {
		digest, err := candidate.Closure.Digest()
		if err == nil && digest == closureRef.ClosureDigest {
			closure = candidate
			break
		}
	}
	if len(closure.Bundle) == 0 {
		t.Fatal("latest authenticated closure bundle could not be resolved")
	}
	var bundle portableFactBundle
	if err := decodeStrictRecord(closure.Bundle, &bundle); err != nil {
		t.Fatal(err)
	}
	witnessCount := 0
	for _, record := range bundle.Records {
		if isCatalogRelationWitnessRecord(record) {
			witnessCount++
		}
	}
	if witnessCount != 1 {
		t.Fatalf("fixture has %d catalog relation witnesses; want one", witnessCount)
	}
	reader := &Service{Repo: fixture.repo, TrustAnchor: fixture.service.TrustAnchor, PublicationDomain: testPublicationDomain}
	baseRoot := recoveryProjectionRoot{publication: publication, bundle: bundle, processorAttemptDigest: closure.Closure.ProcessorAttemptDigest}
	baseRoot.headDigest, err = closure.Closure.Digest()
	if err != nil {
		t.Fatal(err)
	}
	baseRoot.recordDigest = closureRef.RecordDigest

	for _, test := range []struct {
		name   string
		mutate func(*testing.T, *portableFactBundle)
		want   string
	}{
		{
			name: "missing witness",
			mutate: func(t *testing.T, bundle *portableFactBundle) {
				records := make([]portableFactRecord, 0, len(bundle.Records))
				for _, record := range bundle.Records {
					if !isCatalogRelationWitnessRecord(record) {
						records = append(records, record)
					}
				}
				bundle.Records = records
			},
			want: "catalog relation witness for mapped file version",
		},
		{
			name: "mapping identity mismatch",
			mutate: func(t *testing.T, bundle *portableFactBundle) {
				for index := range bundle.Records {
					record := &bundle.Records[index]
					if !isCatalogRelationWitnessRecord(*record) {
						continue
					}
					var fact sqlite.MetadataFact
					if err := decodeStrictRecord(record.Payload, &fact); err != nil {
						t.Fatal(err)
					}
					var witness catalogRelationWitness
					if err := decodeStrictRecord(fact.Value, &witness); err != nil {
						t.Fatal(err)
					}
					witness.FileVersion.ContentID = "sha256:" + strings.Repeat("a", 64)
					value, err := CanonicalJSON(witness)
					if err != nil {
						t.Fatal(err)
					}
					fact.Value = value
					payload, err := CanonicalJSON(fact)
					if err != nil {
						t.Fatal(err)
					}
					record.Payload = payload
					record.PayloadDigest = DigestBytes(record.Payload)
					record.PayloadLength = int64(len(record.Payload))
					return
				}
				t.Fatal("fixture has no catalog relation witness")
			},
			want: "catalog relation witness",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			mutated := baseRoot
			mutated.bundle = portableFactBundle{}
			encoded, err := CanonicalJSON(baseRoot.bundle)
			if err != nil {
				t.Fatal(err)
			}
			if err := decodeStrictRecord(encoded, &mutated.bundle); err != nil {
				t.Fatal(err)
			}
			test.mutate(t, &mutated.bundle)
			if _, err := buildRecoveryCatalogProjection(ctx, reader, *fixture.service.TrustAnchor, testPublicationDomain, mutated); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("catalog projection error = %v, want refusal containing %q", err, test.want)
			}
		})
	}
}

func TestRecoveryCatalogProjectionRejectsFrozenFactPrefix(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "frozen.txt", []byte("frozen bytes"))
	ingested := fixture.ingest(t, "sha256:recovery-projection-frozen-prefix")
	old, err := fixture.service.BuildRecoveryReference(ctx, ingested.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	if len(old.PortableFactClosures) == 0 {
		t.Fatal("fixture has no portable fact prefix")
	}
	subject := stableSubjectForSnapshotFile(t, fixture.service, ingested.SnapshotRef, "frozen.txt")
	noteID, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.store.CreateAnnotation(ctx, &sqlite.Annotation{ID: noteID, WorkspaceID: ingested.WorkspaceID, SubjectRef: subject, Kind: sqlite.AnnotationNote, Body: "after frozen export", Revision: 1}); err != nil {
		t.Fatal(err)
	}
	if err := fixture.service.PublishPortableFactClosure(ctx, ingested.WorkspaceID, ingested.SnapshotRef, ingested.PublicationCommitDigest); err != nil {
		t.Fatal(err)
	}
	anchorPath := filepath.Join(t.TempDir(), "trust-anchor.json")
	if _, err := ExportTrustAnchor(*fixture.service.TrustAnchor, anchorPath); err != nil {
		t.Fatal(err)
	}
	artifactPath := filepath.Join(t.TempDir(), "frozen.json")
	payload, err := MarshalRecoveryReference(old)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(artifactPath, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	fresh, err := sqlite.Open(ctx, filepath.Join(t.TempDir(), "fresh.sqlite"), sqlite.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	projectionService := &Service{Store: fresh, Repo: fixture.repo, RequireSignedPublication: true}
	if _, err := projectionService.ImportRecoveryArtifact(ctx, artifactPath, anchorPath, testPublicationDomain); err == nil || !bytes.Contains([]byte(err.Error()), []byte("selected recovery reference is stale")) {
		t.Fatalf("frozen prefix import error = %v, want stale selected-head refusal", err)
	}
	workspaces, err := fresh.ListWorkspaces(ctx)
	if err != nil || len(workspaces) != 0 {
		t.Fatalf("stale prefix created operational workspace rows: count=%d err=%v", len(workspaces), err)
	}
}

func TestRecoveryCatalogProjectionRejectsCrossParentCurrentFactMismatch(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "shared.txt", []byte("first snapshot"))
	first := fixture.ingest(t, "sha256:recovery-projection-fact-mismatch-first")
	subject := stableSubjectForSnapshotFile(t, fixture.service, first.SnapshotRef, "shared.txt")
	noteID, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.store.CreateAnnotation(ctx, &sqlite.Annotation{ID: noteID, WorkspaceID: first.WorkspaceID, SubjectRef: subject, Kind: sqlite.AnnotationNote, Body: "revision one", Revision: 1}); err != nil {
		t.Fatal(err)
	}
	if err := fixture.service.PublishPortableFactClosure(ctx, first.WorkspaceID, first.SnapshotRef, first.PublicationCommitDigest); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(fixture.source, "shared.txt"), []byte("second snapshot"), 0o600); err != nil {
		t.Fatal(err)
	}
	second := fixture.ingest(t, "sha256:recovery-projection-fact-mismatch-second")
	if err := fixture.service.PublishPortableFactClosure(ctx, second.WorkspaceID, second.SnapshotRef, second.PublicationCommitDigest); err != nil {
		t.Fatal(err)
	}
	if err := fixture.store.ReviseAnnotation(ctx, second.WorkspaceID, noteID, 1, "revision two", false, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if err := fixture.service.PublishPortableFactClosure(ctx, second.WorkspaceID, second.SnapshotRef, second.PublicationCommitDigest); err != nil {
		t.Fatal(err)
	}
	anchorPath := filepath.Join(t.TempDir(), "trust-anchor.json")
	if _, err := ExportTrustAnchor(*fixture.service.TrustAnchor, anchorPath); err != nil {
		t.Fatal(err)
	}
	latest, err := fixture.service.BuildRecoveryReference(ctx, second.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	artifactPath := filepath.Join(t.TempDir(), "latest.json")
	payload, err := MarshalRecoveryReference(latest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(artifactPath, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	fresh, err := sqlite.Open(ctx, filepath.Join(t.TempDir(), "fresh.sqlite"), sqlite.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	projectionService := &Service{Store: fresh, Repo: fixture.repo, RequireSignedPublication: true}
	if _, err := projectionService.ImportRecoveryArtifact(ctx, artifactPath, anchorPath, testPublicationDomain); err == nil || !bytes.Contains([]byte(err.Error()), []byte("disagree on current annotation state")) {
		t.Fatalf("cross-parent mismatch error = %v, want authenticated current-state refusal", err)
	}
	workspaces, err := fresh.ListWorkspaces(ctx)
	if err != nil || len(workspaces) != 0 {
		t.Fatalf("cross-parent mismatch created operational workspace rows: count=%d err=%v", len(workspaces), err)
	}
}

func TestRecoveryCatalogProjectionPreservesAuthenticatedExternalBindingDigest(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "linked.txt", []byte("linked source bytes"))
	fixture.service.AllowLinkOnly = true
	plan, err := fixture.service.InspectIngest(ctx, fixture.source, IngestOptions{
		ProtectionMode:   sqlite.ProtectionLinkOnly,
		ConfirmLinkOnly:  true,
		ExternalLocators: []IngestLocator{{Locator: "https://example.invalid/linked.txt"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	ingested, err := fixture.service.ApplyIngestPlanWithExecutionKey(ctx, plan, "sha256:recovery-projection-link-only")
	if err != nil {
		t.Fatal(err)
	}
	publication, err := projectionTestPublication(ctx, fixture.service, ingested.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	manifestEntry := findManifestEntryByPath(publication.Manifest, []byte("linked.txt"))
	if manifestEntry.Protection.RecordID == "" || len(manifestEntry.Protection.RecoveryReferences) != 1 {
		t.Fatalf("link-only manifest protection is incomplete: %+v", manifestEntry.Protection)
	}
	portableRef := manifestEntry.Protection.RecoveryReferences[0]
	var recipe externalRecoveryRecipeV1
	if err := decodeStrictRecord(portableRef.Recipe, &recipe); err != nil {
		t.Fatal(err)
	}
	if !validExactContentID(recipe.BindingDigest) {
		t.Fatalf("signed external recipe has no binding digest: %+v", recipe)
	}
	unboundRecipe := recipe
	unboundRecipe.BindingDigest = ""
	unboundPayload, err := json.Marshal(unboundRecipe)
	if err != nil {
		t.Fatal(err)
	}
	unboundReference := portableRef
	unboundReference.Recipe = unboundPayload
	if _, err := externalBindingDigestFromRecoveryReference(unboundReference, manifestEntry.Protection.ExpectedContentID, manifestEntry.Protection.ExpectedLogicalLength); err == nil {
		t.Fatal("external binding without its authenticated recipe digest was accepted")
	}
	reference, err := fixture.service.BuildRecoveryReference(ctx, ingested.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	referenceBytes, err := MarshalRecoveryReference(reference)
	if err != nil {
		t.Fatal(err)
	}
	artifactPath := filepath.Join(t.TempDir(), "recovery.json")
	if err := os.WriteFile(artifactPath, referenceBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	anchorPath := filepath.Join(t.TempDir(), "trust-anchor.json")
	if _, err := ExportTrustAnchor(*fixture.service.TrustAnchor, anchorPath); err != nil {
		t.Fatal(err)
	}
	fresh, err := sqlite.Open(ctx, filepath.Join(t.TempDir(), "fresh.sqlite"), sqlite.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	projectionService := &Service{Store: fresh, Repo: fixture.repo, RequireSignedPublication: true}
	if _, err := projectionService.ImportRecoveryArtifact(ctx, artifactPath, anchorPath, testPublicationDomain); err != nil {
		t.Fatalf("fresh link-only projection: %v", err)
	}
	binding, err := fresh.GetExternalBinding(ctx, ingested.WorkspaceID, portableRef.ExternalBindingID)
	if err != nil {
		t.Fatalf("recovered external binding: %v", err)
	}
	if binding.BindingDigest != recipe.BindingDigest {
		t.Fatalf("recovered binding digest = %q, want authenticated recipe digest %q", binding.BindingDigest, recipe.BindingDigest)
	}
	if binding.BindingDigest == reference.PortableFactClosures[len(reference.PortableFactClosures)-1].ClosureDigest {
		t.Fatal("recovered binding digest was replaced with the portable fact closure digest")
	}
}

func projectionTestPublication(ctx context.Context, service *Service, snapshotRef string) (committedPublication, error) {
	publications, err := service.committedPublications(ctx)
	if err != nil {
		return committedPublication{}, err
	}
	for _, publication := range publications {
		if publication.Commit.SnapshotRef == snapshotRef {
			return publication, nil
		}
	}
	return committedPublication{}, fmt.Errorf("snapshot %q is not committed", snapshotRef)
}

func findManifestEntryByPath(manifest Manifest, rawPath []byte) ManifestEntry {
	for _, entry := range manifest.Entries {
		if bytes.Equal(entry.RawPath, rawPath) {
			return entry
		}
	}
	return ManifestEntry{}
}
