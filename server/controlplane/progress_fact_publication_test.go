package controlplane

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
)

func TestProgressUpsertPublishesOwnCreateAndRevisionToEveryRetainedParent(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	first := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	second := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	if second.WorkspaceID != first.WorkspaceID {
		t.Fatalf("second ingest workspace = %q, want %q", second.WorkspaceID, first.WorkspaceID)
	}
	subject := noteTestSubject(t, fixture.store, first.WorkspaceID, first.RootID)
	parents := captureAnnotationParentState(t, ctx, fixture)

	created := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": first.WorkspaceID, "subject_ref": subject,
		"kind": "PROGRESS", "body": "initial durable progress",
	}))
	if created.Status != command.StatusSucceeded {
		t.Fatalf("create PROGRESS = %q: %+v", created.Status, created.Reasons)
	}
	var createdData command.AnnotationUpsertData
	if err := json.Unmarshal(created.Data, &createdData); err != nil {
		t.Fatal(err)
	}
	createdAnnotation := createdData.Annotation
	if createdAnnotation.ID == "" || createdAnnotation.WorkspaceID != first.WorkspaceID ||
		createdAnnotation.SubjectRef != subject || createdAnnotation.Kind != "PROGRESS" ||
		createdAnnotation.Revision != 1 || createdAnnotation.PredecessorRevision != 0 ||
		createdAnnotation.Tombstoned || createdAnnotation.Body != "initial durable progress" ||
		createdAnnotation.BodyDigest != annotationBodyDigest(createdAnnotation.Body) || createdAnnotation.CreatedAt == "" ||
		createdAnnotation.UpdatedAt != createdAnnotation.CreatedAt {
		t.Fatalf("created PROGRESS identity = %+v", createdAnnotation)
	}
	assertAnnotationInEveryRetainedParent(t, ctx, fixture, first.WorkspaceID, subject, createdAnnotation)
	assertAnnotationParentStateUnchanged(t, ctx, fixture, parents)

	// A zero ExpectedRevision keeps its established meaning for PROGRESS: use
	// the live row's revision as the CAS base.
	revised := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": first.WorkspaceID, "subject_ref": subject,
		"kind": "PROGRESS", "body": "revised durable progress",
	}))
	if revised.Status != command.StatusSucceeded {
		t.Fatalf("revise PROGRESS with default expected revision = %q: %+v", revised.Status, revised.Reasons)
	}
	var revisedData command.AnnotationUpsertData
	if err := json.Unmarshal(revised.Data, &revisedData); err != nil {
		t.Fatal(err)
	}
	revisedAnnotation := revisedData.Annotation
	if revisedAnnotation.ID != createdAnnotation.ID || revisedAnnotation.WorkspaceID != createdAnnotation.WorkspaceID ||
		revisedAnnotation.SubjectRef != subject || revisedAnnotation.Kind != "PROGRESS" ||
		revisedAnnotation.Revision != 2 || revisedAnnotation.PredecessorRevision != 1 || revisedAnnotation.Tombstoned ||
		revisedAnnotation.Body != "revised durable progress" || revisedAnnotation.BodyDigest != annotationBodyDigest(revisedAnnotation.Body) ||
		revisedAnnotation.CreatedAt != createdAnnotation.CreatedAt || revisedAnnotation.UpdatedAt == "" {
		t.Fatalf("revised PROGRESS did not return its own revision: created=%+v revised=%+v", createdAnnotation, revisedAnnotation)
	}
	stored, err := fixture.store.GetAnnotation(ctx, first.WorkspaceID, createdAnnotation.ID)
	if err != nil || stored.ID != revisedAnnotation.ID || stored.Revision != revisedAnnotation.Revision ||
		stored.Body != revisedAnnotation.Body || stored.BodyDigest != revisedAnnotation.BodyDigest ||
		stored.CreatedAt.Format(time.RFC3339) != revisedAnnotation.CreatedAt ||
		stored.UpdatedAt.Format(time.RFC3339) != revisedAnnotation.UpdatedAt {
		t.Fatalf("stored PROGRESS revision = %+v, %v; response=%+v", stored, err, revisedAnnotation)
	}
	assertAnnotationInEveryRetainedParent(t, ctx, fixture, first.WorkspaceID, subject, revisedAnnotation)
	assertAnnotationParentStateUnchanged(t, ctx, fixture, parents)
}

func TestProgressUpsertWithoutPublicationAuthRetainsSavedIdentityDegraded(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	ingested := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	_ = mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, ingested.WorkspaceID, ingested.RootID)
	fixture.dispatcher.exact.SigningIdentity = nil
	fixture.dispatcher.exact.TrustAnchor = nil

	result := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": subject,
		"kind": "PROGRESS", "body": "saved without publication authority",
	}))
	if result.Status != command.StatusDegraded || len(result.Reasons) != 1 ||
		result.Reasons[0].Code != ReasonCodeUnavailable ||
		!strings.Contains(result.Reasons[0].Message, "authenticated recovery publication incomplete") ||
		!strings.Contains(result.Reasons[0].Message, "requires signing identity, trust anchor, and publication domain") {
		t.Fatalf("missing-auth PROGRESS result = %q: %+v", result.Status, result.Reasons)
	}
	var data command.AnnotationUpsertData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	annotation := data.Annotation
	if annotation.ID == "" || annotation.WorkspaceID != ingested.WorkspaceID || annotation.SubjectRef != subject ||
		annotation.Kind != "PROGRESS" || annotation.Revision != 1 || annotation.PredecessorRevision != 0 ||
		annotation.Tombstoned || annotation.Body != "saved without publication authority" ||
		annotation.BodyDigest != annotationBodyDigest(annotation.Body) {
		t.Fatalf("degraded PROGRESS lost committed identity: %+v", annotation)
	}
	stored, err := fixture.store.GetAnnotation(ctx, ingested.WorkspaceID, annotation.ID)
	if err != nil || stored.ID != annotation.ID || stored.Revision != annotation.Revision ||
		stored.Body != annotation.Body || stored.BodyDigest != annotation.BodyDigest {
		t.Fatalf("missing-auth saved PROGRESS = %+v, %v", stored, err)
	}
	live, err := fixture.store.ListAnnotations(ctx, ingested.WorkspaceID, subject, false)
	if err != nil || len(live) != 1 || live[0].ID != annotation.ID {
		t.Fatalf("missing-auth PROGRESS live rows = %+v, %v; want exactly one committed row", live, err)
	}
}

func TestProgressRevisionPartialPublicationReturnsOwnCommittedRevision(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	ingested := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	_ = mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, ingested.WorkspaceID, ingested.RootID)
	created := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": subject,
		"kind": "PROGRESS", "body": "initial progress before race",
	}))
	if created.Status != command.StatusSucceeded {
		t.Fatalf("create PROGRESS before partial-publication test = %q: %+v", created.Status, created.Reasons)
	}
	var createdData command.AnnotationUpsertData
	if err := json.Unmarshal(created.Data, &createdData); err != nil {
		t.Fatal(err)
	}

	failedRepo := &annotationFactFailingRepo{
		Driver: fixture.repo, RecordDriver: fixture.repo, failAt: 2,
		beforeFactPlace: func() error {
			return fixture.store.ReviseAnnotation(ctx, ingested.WorkspaceID, createdData.Annotation.ID,
				2, "concurrent later progress", false, time.Now().UTC())
		},
	}
	fixture.dispatcher.exact.Repo = failedRepo
	result := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": subject,
		"kind": "PROGRESS", "body": "this operation progress revision",
		"expected_revision": int64(1),
	}))
	if result.Status != command.StatusDegraded || len(result.Reasons) == 0 ||
		(result.Reasons[0].Code != ReasonCodeUnknownExternalOutcome && result.Reasons[0].Code != ReasonCodeNeedsReconciliation) ||
		!strings.Contains(result.Reasons[0].Message, "authenticated recovery publication incomplete") {
		t.Fatalf("partial PROGRESS publication = %q: %+v", result.Status, result.Reasons)
	}
	var response command.AnnotationUpsertData
	if err := json.Unmarshal(result.Data, &response); err != nil {
		t.Fatal(err)
	}
	if response.Annotation.ID != createdData.Annotation.ID || response.Annotation.Kind != "PROGRESS" ||
		response.Annotation.Revision != 2 || response.Annotation.PredecessorRevision != 1 ||
		response.Annotation.SubjectRef != subject || response.Annotation.Body != "this operation progress revision" ||
		response.Annotation.BodyDigest != annotationBodyDigest(response.Annotation.Body) ||
		response.Annotation.CreatedAt != createdData.Annotation.CreatedAt {
		t.Fatalf("degraded response returned a different revision than this operation committed: %+v", response.Annotation)
	}
	latest, err := fixture.store.GetAnnotation(ctx, ingested.WorkspaceID, createdData.Annotation.ID)
	if err != nil || latest.Revision != 3 || latest.Body != "concurrent later progress" ||
		latest.BodyDigest != annotationBodyDigest("concurrent later progress") {
		t.Fatalf("later concurrent catalog revision = %+v, %v", latest, err)
	}
	if failedRepo.failedCalls != 1 {
		t.Fatalf("fact publication failure count = %d, want one and no retry", failedRepo.failedCalls)
	}
}
