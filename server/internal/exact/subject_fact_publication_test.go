package exact

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestResolveAndPublishSubjectFactSuccessorsAcrossRetainedParents(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "first.txt", []byte("first retained source bytes"))
	first := fixture.ingest(t, "sha256:subject-fact-first-plan")
	firstSubject := stableSubjectForSnapshotFile(t, fixture.service, first.SnapshotRef, "first.txt")

	if err := os.WriteFile(filepath.Join(fixture.source, "second.txt"), []byte("second retained source bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	second := fixture.ingest(t, "sha256:subject-fact-second-plan")
	if got := stableSubjectForSnapshotFile(t, fixture.service, second.SnapshotRef, "first.txt"); got != firstSubject {
		t.Fatalf("stable subject changed across retained snapshots: first=%q second=%q", firstSubject, got)
	}
	secondSubject := stableSubjectForSnapshotFile(t, fixture.service, second.SnapshotRef, "second.txt")

	firstTargets, err := fixture.service.ResolveSubjectFactPublicationTargets(ctx, first.WorkspaceID, []string{firstSubject})
	if err != nil {
		t.Fatalf("resolve shared subject parents: %v", err)
	}
	if len(firstTargets) != 2 {
		t.Fatalf("shared subject targets = %d, want both retained parents: %+v", len(firstTargets), firstTargets)
	}
	secondTargets, err := fixture.service.ResolveSubjectFactPublicationTargets(ctx, second.WorkspaceID, []string{secondSubject})
	if err != nil {
		t.Fatalf("resolve unrelated subject parent: %v", err)
	}
	if len(secondTargets) != 1 || secondTargets[0].SnapshotRef != second.SnapshotRef {
		t.Fatalf("unrelated subject targets = %+v, want only second parent %s", secondTargets, second.SnapshotRef)
	}

	annotationID, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
	if err != nil {
		t.Fatal(err)
	}
	annotation := &sqlite.Annotation{
		ID: annotationID, WorkspaceID: first.WorkspaceID,
		SubjectRef: firstSubject, Kind: sqlite.AnnotationTag, Body: "Reviewed", Revision: 1,
	}
	if err := fixture.store.CreateAnnotation(ctx, annotation); err != nil {
		t.Fatal(err)
	}
	descriptionID, err := sqlite.NewStableID(sqlite.IDPrefixDescription)
	if err != nil {
		t.Fatal(err)
	}
	description := &sqlite.DescriptionDocument{
		ID: descriptionID, WorkspaceID: first.WorkspaceID,
		SubjectRef: firstSubject, Kind: sqlite.DescriptionImported, Language: "en",
		Body: "Retained user metadata body", SourceRef: "user:subject-fact-test",
		ConfigDigest: first.ConfigDigest, Accepted: true, Visibility: "private",
	}
	if err := fixture.store.InsertDescriptionDocument(ctx, description); err != nil {
		t.Fatal(err)
	}

	parentBytes := captureImmutableParentBytes(t, fixture.service, []string{first.SnapshotRef, second.SnapshotRef})
	mutations := []AnnotationFactMutation{{
		AnnotationID: annotation.ID, SubjectRef: firstSubject, Revision: annotation.Revision,
		BodyDigest: annotation.BodyDigest, Kind: annotation.Kind, Tombstoned: annotation.Tombstoned,
	}}
	descriptionMutations := []DescriptionFactMutation{{
		DescriptionID: description.ID, SubjectRef: firstSubject, Revision: description.Revision,
		BodyDigest: description.BodyDigest, Accepted: description.Accepted, Visibility: description.Visibility,
	}}

	result, err := fixture.service.PublishSubjectFactSuccessors(ctx, first.WorkspaceID, firstTargets, mutations, descriptionMutations)
	if err != nil {
		t.Fatalf("publish subject facts: %v (result=%+v)", err, result)
	}
	if len(result.Parents) != 2 {
		t.Fatalf("parent evidence count = %d, want 2", len(result.Parents))
	}
	for _, parent := range result.Parents {
		if !parent.Covered || parent.ClosureSequence != 2 || len(parent.Mutations) != 2 || parent.ClosureDigest == "" || parent.BundleDigest == "" {
			t.Fatalf("incomplete parent mutation evidence: %+v", parent)
		}
	}

	// An unchanged catalog state must reuse the just-published child sequence.
	secondResult, err := fixture.service.PublishSubjectFactSuccessors(ctx, first.WorkspaceID, firstTargets, mutations, descriptionMutations)
	if err != nil {
		t.Fatalf("idempotent subject-fact publication: %v", err)
	}
	for i := range result.Parents {
		if secondResult.Parents[i].ClosureSequence != result.Parents[i].ClosureSequence || secondResult.Parents[i].ClosureDigest != result.Parents[i].ClosureDigest {
			t.Fatalf("idempotent publication changed child identity: first=%+v second=%+v", result.Parents[i], secondResult.Parents[i])
		}
	}
	assertImmutableParentBytes(t, fixture.service, parentBytes)
}

func TestSubjectFactTargetResolutionFailsClosedWithoutAuthenticatedMapping(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "mapping.txt", []byte("mapping evidence"))
	result := fixture.ingest(t, "sha256:subject-fact-missing-map")
	subject := stableSubjectForSnapshotFile(t, fixture.service, result.SnapshotRef, "mapping.txt")

	missing := &Service{
		Store: fixture.store, Repo: &subjectFactRecordFilter{Dir: fixture.repo, hideClosures: true},
		SigningIdentity: fixture.service.SigningIdentity, TrustAnchor: fixture.service.TrustAnchor,
		PublicationDomain: fixture.service.PublicationDomain, RequireSignedPublication: true,
	}
	if _, err := missing.ResolveSubjectFactPublicationTargets(ctx, result.WorkspaceID, []string{subject}); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("missing closure chain error = %v, want fail-closed mapping error", err)
	}

	invalid := &Service{
		Store: fixture.store, Repo: &subjectFactRecordFilter{Dir: fixture.repo, corruptClosures: true},
		SigningIdentity: fixture.service.SigningIdentity, TrustAnchor: fixture.service.TrustAnchor,
		PublicationDomain: fixture.service.PublicationDomain, RequireSignedPublication: true,
	}
	if _, err := invalid.ResolveSubjectFactPublicationTargets(ctx, result.WorkspaceID, []string{subject}); err == nil {
		t.Fatal("invalid signed mapping closure was accepted")
	}

	if _, err := fixture.service.ResolveSubjectFactPublicationTargets(ctx, result.WorkspaceID, []string{"sub_ffffffffffffffffffffffffffffffff"}); err == nil || !strings.Contains(err.Error(), "no authenticated committed parent") {
		t.Fatalf("unmapped subject error = %v, want explicit no-coverage error", err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if targets, err := fixture.service.ResolveSubjectFactPublicationTargets(cancelled, result.WorkspaceID, []string{subject}); err == nil || targets != nil {
		t.Fatalf("cancelled subject mapping resolution = %+v, err=%v; want no targets and cancellation failure", targets, err)
	}
}

func TestSubjectFactPublicationRejectsPartiallyMappedMutationSet(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "known.txt", []byte("known subject"))
	result := fixture.ingest(t, "sha256:subject-fact-partial-map")
	knownSubject := stableSubjectForSnapshotFile(t, fixture.service, result.SnapshotRef, "known.txt")
	targets, err := fixture.service.ResolveSubjectFactPublicationTargets(ctx, result.WorkspaceID, []string{knownSubject})
	if err != nil {
		t.Fatal(err)
	}
	unknownSubject := "sub_ffffffffffffffffffffffffffffffff"
	if _, err := fixture.service.ResolveSubjectFactPublicationTargets(ctx, result.WorkspaceID, []string{knownSubject, unknownSubject}); err == nil || !strings.Contains(err.Error(), unknownSubject) {
		t.Fatalf("mixed known/unmapped resolver result = %v, want explicit unmapped subject failure", err)
	}

	knownID, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
	if err != nil {
		t.Fatal(err)
	}
	unknownID, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
	if err != nil {
		t.Fatal(err)
	}
	mutations := []AnnotationFactMutation{
		{AnnotationID: knownID, SubjectRef: knownSubject, Revision: 1, BodyDigest: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", Kind: sqlite.AnnotationNote},
		{AnnotationID: unknownID, SubjectRef: unknownSubject, Revision: 1, BodyDigest: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", Kind: sqlite.AnnotationNote},
	}
	if _, err := fixture.service.PublishSubjectFactSuccessors(ctx, result.WorkspaceID, targets, mutations, nil); err == nil || !strings.Contains(err.Error(), unknownSubject) {
		t.Fatalf("mixed known/unmapped publication result = %v, want failure before publication", err)
	}
	closures, err := fixture.service.ListPortableFactClosures(ctx, result.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	if len(closures) != 1 {
		t.Fatalf("partial mutation set wrote a successor: closures=%d", len(closures))
	}
	if closures[0].Closure.ClosureSequence != 1 {
		t.Fatalf("partial mutation set wrote successor sequence %d", closures[0].Closure.ClosureSequence)
	}
}

func TestSubjectFactTargetResolutionReturnsNoPartialTargetsWhenLaterParentHasNoChain(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "first.txt", []byte("first retained source bytes"))
	first := fixture.ingest(t, "sha256:subject-fact-stream-first")
	sharedSubject := stableSubjectForSnapshotFile(t, fixture.service, first.SnapshotRef, "first.txt")
	if err := os.WriteFile(filepath.Join(fixture.source, "second.txt"), []byte("second retained source bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	fixture.ingest(t, "sha256:subject-fact-stream-second")
	parents, err := fixture.service.committedPublications(ctx)
	if err != nil || len(parents) != 2 {
		t.Fatalf("committed parents = %d, err=%v", len(parents), err)
	}
	// Hide the last parent's closure after an earlier parent has a complete,
	// valid chain. A failed resolution must never return the earlier target.
	missingParent := parents[len(parents)-1].CommitDigest
	digests, err := fixture.repo.ListRecordDigests(ctx, repository.RecordPortableFactClosure)
	if err != nil {
		t.Fatal(err)
	}
	hidden := make(map[string]struct{})
	for _, digest := range digests {
		payload, err := readRecord(ctx, fixture.repo, repository.RecordPortableFactClosure, digest)
		if err != nil {
			t.Fatal(err)
		}
		var envelope PortableFactClosureEnvelope
		if err := decodeStrictRecord(payload, &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.Closure.ParentCommitDigest == missingParent {
			hidden[digest] = struct{}{}
		}
	}
	if len(hidden) == 0 {
		t.Fatalf("test fixture has no closure records for parent %s", missingParent)
	}
	resolver := &Service{
		Store: fixture.store, Repo: &subjectFactRecordFilter{Dir: fixture.repo, hiddenClosureDigests: hidden},
		SigningIdentity: fixture.service.SigningIdentity, TrustAnchor: fixture.service.TrustAnchor,
		PublicationDomain: fixture.service.PublicationDomain, RequireSignedPublication: true,
	}
	targets, err := resolver.ResolveSubjectFactPublicationTargets(ctx, first.WorkspaceID, []string{sharedSubject})
	if err == nil || targets != nil || !strings.Contains(err.Error(), missingParent) {
		t.Fatalf("partial target resolution = %+v, err=%v; want no targets and missing-parent failure", targets, err)
	}
}

func TestStableSubjectsForParentChainInternalMappingSetAllowsRepeatedSubjectAndRejectsEntryDrift(t *testing.T) {
	const workspaceID = "wsp_11111111111111111111111111111111"
	const snapshotRef = "snp_22222222222222222222222222222222"
	const sharedSubject = "sub_33333333333333333333333333333333"
	mapping := func(entryID, rawPath string) portableFactRecord {
		payload, err := CanonicalJSON(subjectMappingPayload{
			WorkspaceID: workspaceID, NamespaceRootID: "nsr_44444444444444444444444444444444",
			NamespaceEntryID: entryID, StableSubjectRef: sharedSubject,
			SourceID: "src_55555555555555555555555555555555", RawPath: []byte(rawPath),
			RawName: []byte(filepath.Base(rawPath)), DisplayName: filepath.Base(rawPath),
			EntryType: "FILE", SelectedRepresentationRefs: []string{},
		})
		if err != nil {
			t.Fatal(err)
		}
		return portableFactRecord{RecordKind: "SUBJECT_MAPPING", RecordID: entryID, WorkspaceID: workspaceID, SnapshotRef: snapshotRef, StableSubjectRef: sharedSubject, Payload: payload}
	}
	closure := func(records ...portableFactRecord) PortableFactClosureEnvelope {
		bundle, err := CanonicalJSON(portableFactBundle{Schema: PortableFactBundleSchemaV2, WorkspaceID: workspaceID, SnapshotRef: snapshotRef, Records: records, Attachments: []portableFactAttachment{}})
		if err != nil {
			t.Fatal(err)
		}
		return PortableFactClosureEnvelope{Closure: PortableFactClosureRecord{WorkspaceID: workspaceID, SnapshotRef: snapshotRef}, Bundle: bundle}
	}

	// Internal-only shape test: the parent-chain helper keys immutable entries
	// independently from its deduplicated membership set. The current signed
	// bundle validator rejects this repeated-subject shape before the helper is
	// reached, so this test does not claim authenticated multi-path support.
	first := closure(mapping("nse_66666666666666666666666666666666", "one.txt"), mapping("nse_77777777777777777777777777777777", "alias.txt"))
	if subjects, err := stableSubjectsForParentChain([]PortableFactClosureEnvelope{first}, workspaceID); err != nil {
		t.Fatalf("multiple paths for one stable subject were rejected: %v", err)
	} else if len(subjects) != 1 {
		t.Fatalf("stable subject set = %v, want one deduplicated subject", subjects)
	}

	second := closure(mapping("nse_66666666666666666666666666666666", "renamed.txt"), mapping("nse_77777777777777777777777777777777", "alias.txt"))
	if _, err := stableSubjectsForParentChain([]PortableFactClosureEnvelope{first, second}, workspaceID); err == nil || !strings.Contains(err.Error(), "changed immutable subject mappings") {
		t.Fatalf("entry mapping drift error = %v, want fail-closed immutable mapping conflict", err)
	}
}

type subjectFactRecordFilter struct {
	*repository.Dir
	hideClosures         bool
	corruptClosures      bool
	hiddenClosureDigests map[string]struct{}
}

func (r *subjectFactRecordFilter) ListRecordDigests(ctx context.Context, role repository.RecordRole) ([]string, error) {
	if role == repository.RecordPortableFactClosure && r.hideClosures {
		return nil, nil
	}
	digests, err := r.Dir.ListRecordDigests(ctx, role)
	if err != nil || role != repository.RecordPortableFactClosure || len(r.hiddenClosureDigests) == 0 {
		return digests, err
	}
	filtered := make([]string, 0, len(digests))
	for _, digest := range digests {
		if _, hidden := r.hiddenClosureDigests[digest]; !hidden {
			filtered = append(filtered, digest)
		}
	}
	return filtered, nil
}

func (r *subjectFactRecordFilter) OpenRecord(ctx context.Context, role repository.RecordRole, digest string) (io.ReadCloser, error) {
	if role == repository.RecordPortableFactClosure && r.corruptClosures {
		return io.NopCloser(bytes.NewReader([]byte(`{"not":"the signed record"}`))), nil
	}
	return r.Dir.OpenRecord(ctx, role, digest)
}

func stableSubjectForSnapshotFile(t *testing.T, service *Service, snapshotRef, name string) string {
	t.Helper()
	closures, err := service.ListPortableFactClosures(context.Background(), snapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	var bundle portableFactBundle
	if err := decodeStrictRecord(closures[len(closures)-1].Bundle, &bundle); err != nil {
		t.Fatal(err)
	}
	for _, record := range bundle.Records {
		if record.RecordKind != "SUBJECT_MAPPING" {
			continue
		}
		var mapping subjectMappingPayload
		if err := decodeStrictRecord(record.Payload, &mapping); err != nil {
			t.Fatal(err)
		}
		if string(mapping.RawName) == name {
			return mapping.StableSubjectRef
		}
	}
	t.Fatalf("stable subject for %q not found in %s", name, snapshotRef)
	return ""
}

type immutableParentBytes struct {
	records   map[string][]byte
	objects   map[string][]byte
	snapshots []string
}

func captureImmutableParentBytes(t *testing.T, service *Service, snapshots []string) immutableParentBytes {
	t.Helper()
	result := immutableParentBytes{records: map[string][]byte{}, objects: map[string][]byte{}, snapshots: append([]string(nil), snapshots...)}
	driver, err := service.publicationRecordDriver()
	if err != nil {
		t.Fatal(err)
	}
	for _, role := range []repository.RecordRole{repository.RecordPublicationCommit, repository.RecordPreparedClosure} {
		digests, err := driver.ListRecordDigests(context.Background(), role)
		if err != nil {
			t.Fatal(err)
		}
		for _, digest := range digests {
			body, err := readRecord(context.Background(), driver, role, digest)
			if err != nil {
				t.Fatal(err)
			}
			result.records[string(role)+"\x00"+digest] = body
		}
	}
	for _, snapshotRef := range snapshots {
		parent, err := service.committedPublicationForSnapshot(context.Background(), snapshotRef)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range parent.Manifest.Entries {
			if entry.ContentID == "" {
				continue
			}
			body, err := readExactBytes(context.Background(), service.Repo, entry.ContentID, entry.LogicalSize)
			if err != nil {
				t.Fatal(err)
			}
			result.objects[entry.ContentID] = body
		}
	}
	return result
}

func assertImmutableParentBytes(t *testing.T, service *Service, before immutableParentBytes) {
	t.Helper()
	after := captureImmutableParentBytes(t, service, before.snapshots)
	if len(after.records) != len(before.records) || len(after.objects) != len(before.objects) {
		t.Fatalf("immutable parent object set changed: records %d->%d, exact objects %d->%d", len(before.records), len(after.records), len(before.objects), len(after.objects))
	}
	for key, want := range before.records {
		if got, ok := after.records[key]; !ok || !bytes.Equal(got, want) {
			t.Fatalf("authenticated root record bytes changed for %q", key)
		}
	}
	for key, want := range before.objects {
		if got, ok := after.objects[key]; !ok || !bytes.Equal(got, want) {
			t.Fatalf("exact parent bytes changed for %q", key)
		}
	}
}

func readExactBytes(ctx context.Context, repo repository.Driver, contentID string, logicalSize *int64) ([]byte, error) {
	if logicalSize == nil {
		return nil, fmt.Errorf("manifest object %s has no logical length", contentID)
	}
	reader, err := repo.Open(ctx, contentID)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	if int64(len(body)) != *logicalSize {
		return nil, fmt.Errorf("object %s length = %d, want %d", contentID, len(body), *logicalSize)
	}
	return body, nil
}
