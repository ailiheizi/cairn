package controlplane

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestAnnotationTagUpsertPublishesExactFactToEveryRetainedParent(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	first := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	second := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, first.WorkspaceID, first.RootID)
	parents := captureAnnotationParentState(t, ctx, fixture)
	if second.WorkspaceID != first.WorkspaceID {
		t.Fatalf("second ingest workspace = %q, want %q", second.WorkspaceID, first.WorkspaceID)
	}

	result := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": first.WorkspaceID,
		"subject_ref":  subject,
		"kind":         "TAG",
		"body":         "lifecycle-publication-tag",
	}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("TAG upsert = %q: %+v", result.Status, result.Reasons)
	}
	var data command.AnnotationUpsertData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	want := data.Annotation
	if want.ID == "" || want.Kind != "TAG" || want.SubjectRef != subject || want.Revision != 1 || want.Tombstoned || want.Body != "lifecycle-publication-tag" {
		t.Fatalf("TAG upsert identity = %+v", want)
	}
	assertAnnotationInEveryRetainedParent(t, ctx, fixture, first.WorkspaceID, subject, want)
	assertAnnotationParentStateUnchanged(t, ctx, fixture, parents)

	// Repeating an idempotent TAG upsert must verify the existing stored fact;
	// it must not create another annotation revision.
	repeated := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": first.WorkspaceID,
		"subject_ref":  subject,
		"kind":         "TAG",
		"body":         "lifecycle-publication-tag",
	}))
	if repeated.Status != command.StatusSucceeded {
		t.Fatalf("idempotent TAG upsert = %q: %+v", repeated.Status, repeated.Reasons)
	}
	var repeatedData command.AnnotationUpsertData
	if err := json.Unmarshal(repeated.Data, &repeatedData); err != nil {
		t.Fatal(err)
	}
	if repeatedData.Annotation.ID != want.ID || repeatedData.Annotation.Revision != want.Revision || repeatedData.Annotation.BodyDigest != want.BodyDigest {
		t.Fatalf("idempotent TAG changed identity: first=%+v repeated=%+v", want, repeatedData.Annotation)
	}
	assertAnnotationInEveryRetainedParent(t, ctx, fixture, first.WorkspaceID, subject, repeatedData.Annotation)
	assertAnnotationParentStateUnchanged(t, ctx, fixture, parents)
}

func TestAnnotationDeletePublishesTombstoneForEachAnnotationKind(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	first := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	second := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, first.WorkspaceID, first.RootID)
	parents := captureAnnotationParentState(t, ctx, fixture)
	if second.WorkspaceID != first.WorkspaceID {
		t.Fatalf("second ingest workspace = %q, want %q", second.WorkspaceID, first.WorkspaceID)
	}

	for _, kind := range []string{"TAG", "NOTE", "PROGRESS"} {
		created := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
			"workspace_id": first.WorkspaceID,
			"subject_ref":  subject,
			"kind":         kind,
			"body":         "delete-proof-" + kind,
		}))
		if created.Status != command.StatusSucceeded {
			t.Fatalf("create %s annotation = %q: %+v", kind, created.Status, created.Reasons)
		}
		var createdData command.AnnotationUpsertData
		if err := json.Unmarshal(created.Data, &createdData); err != nil {
			t.Fatal(err)
		}
		if createdData.Annotation.Kind != kind || createdData.Annotation.Revision != 1 {
			t.Fatalf("created %s annotation = %+v", kind, createdData.Annotation)
		}

		deleted := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationDelete, map[string]any{
			"workspace_id":      first.WorkspaceID,
			"annotation_id":     createdData.Annotation.ID,
			"expected_revision": int64(1),
		}))
		if deleted.Status != command.StatusSucceeded {
			t.Fatalf("delete %s annotation = %q: %+v", kind, deleted.Status, deleted.Reasons)
		}
		var deletedData command.AnnotationUpsertData
		if err := json.Unmarshal(deleted.Data, &deletedData); err != nil {
			t.Fatal(err)
		}
		want := deletedData.Annotation
		if want.ID != createdData.Annotation.ID || want.SubjectRef != subject || want.Kind != kind ||
			want.Revision != 2 || want.PredecessorRevision != 1 || !want.Tombstoned ||
			want.Body != createdData.Annotation.Body || want.BodyDigest != createdData.Annotation.BodyDigest {
			t.Fatalf("delete %s did not return its exact tombstone revision: %+v", kind, want)
		}
		stored, err := fixture.store.GetAnnotation(ctx, first.WorkspaceID, want.ID)
		if err != nil || stored.ID != want.ID || stored.Revision != want.Revision || stored.BodyDigest != want.BodyDigest || !stored.Tombstoned {
			t.Fatalf("stored %s tombstone = %+v, %v", kind, stored, err)
		}
		assertAnnotationInEveryRetainedParent(t, ctx, fixture, first.WorkspaceID, subject, want)
	}
	assertAnnotationParentStateUnchanged(t, ctx, fixture, parents)
}

func TestAnnotationDeleteRejectsMismatchedExpectedRevisionWithoutMutation(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	ingested := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	_ = mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, ingested.WorkspaceID, ingested.RootID)
	created := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": subject, "kind": "TAG", "body": "stale-delete-proof",
	}))
	if created.Status != command.StatusSucceeded {
		t.Fatalf("create TAG = %q: %+v", created.Status, created.Reasons)
	}
	var createdData command.AnnotationUpsertData
	if err := json.Unmarshal(created.Data, &createdData); err != nil {
		t.Fatal(err)
	}
	before := captureAnnotationParentState(t, ctx, fixture)
	beforeFactClosures, err := fixture.repo.ListRecordDigests(ctx, repository.RecordPortableFactClosure)
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(beforeFactClosures)
	result := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationDelete, map[string]any{
		"workspace_id": ingested.WorkspaceID, "annotation_id": createdData.Annotation.ID, "expected_revision": int64(2),
	}))
	if result.Status != command.StatusFailed || len(result.Reasons) == 0 || result.Reasons[0].Code != ReasonCodeConflict {
		t.Fatalf("delete with current revision 1 and future expected revision 2 = %q: %+v", result.Status, result.Reasons)
	}
	after, err := fixture.store.GetAnnotation(ctx, ingested.WorkspaceID, createdData.Annotation.ID)
	if err != nil || after.ID != createdData.Annotation.ID || after.Revision != createdData.Annotation.Revision ||
		after.Body != createdData.Annotation.Body || after.BodyDigest != createdData.Annotation.BodyDigest || after.Tombstoned {
		t.Fatalf("mismatched delete mutated annotation: %+v, %v", after, err)
	}
	assertAnnotationParentStateUnchanged(t, ctx, fixture, before)
	afterFactClosures, err := fixture.repo.ListRecordDigests(ctx, repository.RecordPortableFactClosure)
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(afterFactClosures)
	if !reflect.DeepEqual(beforeFactClosures, afterFactClosures) {
		t.Fatalf("mismatched delete published portable fact closures: before=%v after=%v", beforeFactClosures, afterFactClosures)
	}
}

func TestAnnotationDeleteMissingAuthenticationRetainsCommittedTombstone(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	ingested := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	_ = mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, ingested.WorkspaceID, ingested.RootID)
	created := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": subject, "kind": "TAG", "body": "delete-without-auth",
	}))
	if created.Status != command.StatusSucceeded {
		t.Fatalf("create TAG = %q: %+v", created.Status, created.Reasons)
	}
	var createdData command.AnnotationUpsertData
	if err := json.Unmarshal(created.Data, &createdData); err != nil {
		t.Fatal(err)
	}
	fixture.dispatcher.exact.SigningIdentity = nil
	fixture.dispatcher.exact.TrustAnchor = nil
	deleted := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationDelete, map[string]any{
		"workspace_id": ingested.WorkspaceID, "annotation_id": createdData.Annotation.ID, "expected_revision": int64(1),
	}))
	if deleted.Status != command.StatusDegraded || len(deleted.Reasons) != 1 || deleted.Reasons[0].Code != ReasonCodeUnavailable ||
		!strings.Contains(deleted.Reasons[0].Message, "authenticated recovery publication incomplete") {
		t.Fatalf("delete without auth = %q: %+v", deleted.Status, deleted.Reasons)
	}
	var deletedData command.AnnotationUpsertData
	if err := json.Unmarshal(deleted.Data, &deletedData); err != nil {
		t.Fatal(err)
	}
	want := deletedData.Annotation
	if want.ID != createdData.Annotation.ID || want.WorkspaceID != createdData.Annotation.WorkspaceID ||
		want.SubjectRef != createdData.Annotation.SubjectRef || want.Kind != "TAG" || want.Revision != 2 ||
		want.PredecessorRevision != 1 || !want.Tombstoned || want.Body != createdData.Annotation.Body ||
		want.BodyDigest != createdData.Annotation.BodyDigest || want.CreatedAt != createdData.Annotation.CreatedAt ||
		want.UpdatedAt == "" {
		t.Fatalf("degraded delete lost exact tombstone identity/timestamps: created=%+v deleted=%+v", createdData.Annotation, want)
	}
	stored, err := fixture.store.GetAnnotation(ctx, ingested.WorkspaceID, want.ID)
	wantCreatedAt, parseCreatedErr := time.Parse(time.RFC3339Nano, want.CreatedAt)
	wantUpdatedAt, parseUpdatedErr := time.Parse(time.RFC3339Nano, want.UpdatedAt)
	if err != nil || stored.ID != want.ID || stored.Revision != want.Revision || !stored.Tombstoned ||
		stored.Body != want.Body || stored.BodyDigest != want.BodyDigest || parseCreatedErr != nil || parseUpdatedErr != nil ||
		!stored.CreatedAt.Truncate(time.Second).Equal(wantCreatedAt) || !stored.UpdatedAt.Truncate(time.Second).Equal(wantUpdatedAt) {
		t.Fatalf("missing-auth delete catalog state = %+v, %v", stored, err)
	}
}

func TestAnnotationTagUpsertPublicationFailureRetainsSavedIdentity(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	first := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	_ = mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, first.WorkspaceID, first.RootID)

	fixture.dispatcher.exact.SigningIdentity = nil
	fixture.dispatcher.exact.TrustAnchor = nil
	missingAuth := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": first.WorkspaceID, "subject_ref": subject, "kind": "TAG", "body": "tag-without-signer",
	}))
	assertPostCommitAnnotationDegraded(t, missingAuth, "tag-without-signer", ReasonCodeUnavailable)

	// Use a fresh fixture for an ambiguous later-parent placement. The user
	// mutation is dispatched once; its failed publication is not retried.
	partial := newPlanIngestFixture(t, 1)
	partialFirst := mustAppliedIngest(t, ctx, partial.dispatcher, map[string]any{"root": partial.source})
	_ = mustAppliedIngest(t, ctx, partial.dispatcher, map[string]any{"root": partial.source})
	partialSubject := noteTestSubject(t, partial.store, partialFirst.WorkspaceID, partialFirst.RootID)
	failedRepo := &annotationFactFailingRepo{Driver: partial.repo, RecordDriver: partial.repo, failAt: 2}
	partial.dispatcher.exact.Repo = failedRepo
	partialResult := partial.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": partialFirst.WorkspaceID, "subject_ref": partialSubject, "kind": "TAG", "body": "tag-partial-publication",
	}))
	if partialResult.Status != command.StatusDegraded || len(partialResult.Reasons) == 0 ||
		(partialResult.Reasons[0].Code != ReasonCodeUnknownExternalOutcome && partialResult.Reasons[0].Code != ReasonCodeNeedsReconciliation) {
		t.Fatalf("partial TAG publication = %q: %+v", partialResult.Status, partialResult.Reasons)
	}
	var partialData command.AnnotationUpsertData
	if err := json.Unmarshal(partialResult.Data, &partialData); err != nil {
		t.Fatal(err)
	}
	if partialData.Annotation.ID == "" || partialData.Annotation.Kind != "TAG" || partialData.Annotation.Body != "tag-partial-publication" || partialData.Annotation.Revision != 1 {
		t.Fatalf("partial TAG result lost committed identity: %+v", partialData.Annotation)
	}
	stored, err := partial.store.GetAnnotation(ctx, partialFirst.WorkspaceID, partialData.Annotation.ID)
	if err != nil || stored.ID != partialData.Annotation.ID || stored.Revision != 1 || stored.BodyDigest != partialData.Annotation.BodyDigest {
		t.Fatalf("partial TAG catalog state = %+v, %v", stored, err)
	}
	if failedRepo.failedCalls != 1 {
		t.Fatalf("portable placement failure calls = %d, want exactly one", failedRepo.failedCalls)
	}
}

func assertPostCommitAnnotationDegraded(t *testing.T, result command.Result, body, wantCode string) {
	t.Helper()
	if result.Status != command.StatusDegraded || len(result.Reasons) != 1 || result.Reasons[0].Code != wantCode ||
		!strings.Contains(result.Reasons[0].Message, "authenticated recovery publication incomplete") {
		t.Fatalf("post-commit annotation result = %q: %+v", result.Status, result.Reasons)
	}
	var data command.AnnotationUpsertData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Annotation.ID == "" || data.Annotation.Body != body || data.Annotation.Kind != "TAG" || data.Annotation.Revision != 1 {
		t.Fatalf("post-commit degraded result lost exact annotation: %+v", data.Annotation)
	}
}

func assertUnsignedFixtureTAG(t *testing.T, result command.Result, workspaceID, body string) command.AnnotationData {
	t.Helper()
	const wantMessage = "annotation committed with post-commit warning: authenticated recovery publication incomplete: resolve authenticated recovery parents: subject-fact publication requires signed publication to be enabled"
	if result.Status != command.StatusDegraded || len(result.Reasons) != 1 ||
		result.Reasons[0].Code != ReasonCodeUnavailable || result.Reasons[0].Message != wantMessage {
		t.Fatalf("unsigned fixture TAG = %q: %+v", result.Status, result.Reasons)
	}
	var data command.AnnotationUpsertData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	annotation := data.Annotation
	if annotation.ID == "" || annotation.WorkspaceID != workspaceID || annotation.SubjectRef == "" ||
		annotation.Kind != "TAG" || annotation.Revision != 1 || annotation.PredecessorRevision != 0 ||
		annotation.Tombstoned || annotation.Body != body || annotation.BodyDigest != annotationBodyDigest(body) {
		t.Fatalf("unsigned fixture TAG lost committed identity: %+v", annotation)
	}
	return annotation
}

func assertUnsignedFixtureTombstone(t *testing.T, result command.Result, previous command.AnnotationData) command.AnnotationData {
	t.Helper()
	const wantMessage = "annotation committed with post-commit warning: authenticated recovery publication incomplete: resolve authenticated recovery parents: subject-fact publication requires signed publication to be enabled"
	if result.Status != command.StatusDegraded || len(result.Reasons) != 1 ||
		result.Reasons[0].Code != ReasonCodeUnavailable || result.Reasons[0].Message != wantMessage {
		t.Fatalf("unsigned fixture annotation delete = %q: %+v", result.Status, result.Reasons)
	}
	var data command.AnnotationUpsertData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	annotation := data.Annotation
	if annotation.ID != previous.ID || annotation.WorkspaceID != previous.WorkspaceID ||
		annotation.SubjectRef != previous.SubjectRef || annotation.Kind != previous.Kind ||
		annotation.Revision != previous.Revision+1 || annotation.PredecessorRevision != previous.Revision ||
		!annotation.Tombstoned || annotation.Body != previous.Body || annotation.BodyDigest != previous.BodyDigest ||
		annotation.CreatedAt != previous.CreatedAt || annotation.UpdatedAt == "" {
		t.Fatalf("unsigned fixture delete lost committed tombstone: previous=%+v deleted=%+v", previous, annotation)
	}
	return annotation
}

type annotationParentState struct {
	commitDigests []string
	manifestByRef map[string]string
}

func captureAnnotationParentState(t *testing.T, ctx context.Context, fixture planIngestFixture) annotationParentState {
	t.Helper()
	var driver repository.RecordDriver = fixture.repo
	commits, err := driver.ListRecordDigests(ctx, repository.RecordPublicationCommit)
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(commits)
	manifests, err := fixture.dispatcher.exact.ListSnapshots(ctx)
	if err != nil {
		t.Fatal(err)
	}
	byRef := make(map[string]string, len(manifests))
	for _, manifest := range manifests {
		byRef[manifest.SnapshotRef] = manifest.ManifestDigest
	}
	if len(byRef) != 2 {
		t.Fatalf("baseline retained parents = %d, want 2", len(byRef))
	}
	return annotationParentState{commitDigests: commits, manifestByRef: byRef}
}

func assertAnnotationParentStateUnchanged(t *testing.T, ctx context.Context, fixture planIngestFixture, before annotationParentState) {
	t.Helper()
	after := captureAnnotationParentState(t, ctx, fixture)
	if !reflect.DeepEqual(before.commitDigests, after.commitDigests) {
		t.Fatalf("immutable publication commit digests changed: before=%v after=%v", before.commitDigests, after.commitDigests)
	}
	if !reflect.DeepEqual(before.manifestByRef, after.manifestByRef) {
		t.Fatalf("exact parent manifests changed: before=%v after=%v", before.manifestByRef, after.manifestByRef)
	}
}

func assertAnnotationInEveryRetainedParent(
	t *testing.T,
	ctx context.Context,
	fixture planIngestFixture,
	workspaceID, subjectRef string,
	want command.AnnotationData,
) {
	t.Helper()
	targets, err := fixture.dispatcher.exact.ResolveSubjectFactPublicationTargets(ctx, workspaceID, []string{subjectRef})
	if err != nil {
		t.Fatalf("resolve affected parents: %v", err)
	}
	if len(targets) != 2 {
		t.Fatalf("applicable retained parents = %d, want 2: %+v", len(targets), targets)
	}
	readerRepo, err := repository.OpenProfileReadOnly(repository.RepositoryProfileDirectoryCASDev, fixture.repo.Root())
	if err != nil {
		t.Fatalf("open catalog-free record reader: %v", err)
	}
	anchor := *fixture.dispatcher.exact.TrustAnchor
	reader := &exact.Service{Repo: readerRepo, TrustAnchor: &anchor, PublicationDomain: fixture.dispatcher.exact.PublicationDomain, RequireSignedPublication: true}
	if reader.Store != nil || reader.SigningIdentity != nil {
		t.Fatal("portable reader must have no catalog or signing identity")
	}
	seen := make(map[string]struct{}, len(targets))
	for _, target := range targets {
		if _, duplicate := seen[target.SnapshotRef]; duplicate {
			t.Fatalf("duplicate applicable parent %q", target.SnapshotRef)
		}
		seen[target.SnapshotRef] = struct{}{}
		reference, err := fixture.dispatcher.exact.BuildRecoveryReference(ctx, target.SnapshotRef)
		if err != nil {
			t.Fatalf("build recovery reference for %s: %v", target.SnapshotRef, err)
		}
		if err := reference.ValidateAgainstRepository(ctx, readerRepo, anchor); err != nil {
			t.Fatalf("validate independent reference for %s: %v", target.SnapshotRef, err)
		}
		closures, err := reader.ListPortableFactClosures(ctx, target.SnapshotRef)
		if err != nil {
			t.Fatalf("read portable facts for %s: %v", target.SnapshotRef, err)
		}
		if len(closures) == 0 {
			t.Fatalf("parent %s has no portable fact successor", target.SnapshotRef)
		}
		var bundle struct {
			Records []struct {
				RecordKind       string          `json:"record_kind"`
				RecordID         string          `json:"record_id"`
				StableSubjectRef string          `json:"stable_subject_ref"`
				Revision         int64           `json:"revision"`
				Payload          json.RawMessage `json:"payload"`
			} `json:"records"`
		}
		if err := json.Unmarshal(closures[len(closures)-1].Bundle, &bundle); err != nil {
			t.Fatalf("decode portable facts for %s: %v", target.SnapshotRef, err)
		}
		wantRecordID := fmt.Sprintf("%s@%d", want.ID, want.Revision)
		matched := false
		for _, record := range bundle.Records {
			if record.RecordKind != "ANNOTATION_REVISION" || record.RecordID != wantRecordID ||
				record.StableSubjectRef != subjectRef || record.Revision != want.Revision {
				continue
			}
			var actual sqlite.AnnotationRevision
			if err := json.Unmarshal(record.Payload, &actual); err != nil {
				t.Fatalf("decode annotation %s: %v", wantRecordID, err)
			}
			matched = actual.ID == wantRecordID && actual.AnnotationID == want.ID && actual.WorkspaceID == workspaceID &&
				actual.SubjectRef == subjectRef && actual.Kind == sqlite.AnnotationKind(want.Kind) &&
				actual.Revision == want.Revision && actual.Body == want.Body && actual.BodyDigest == want.BodyDigest &&
				actual.Tombstoned == want.Tombstoned
			if matched {
				break
			}
		}
		if !matched {
			t.Fatalf("parent %s lacks exact annotation revision %+v", target.SnapshotRef, want)
		}
	}
}
