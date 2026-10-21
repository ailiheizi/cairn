package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestAnnotationTagRenamePublishesExactTargetAndOwnTombstoneToEveryRetainedParent(t *testing.T) {
	ctx := context.Background()
	fixture, subject, source, parents := newSignedTagRenameFixture(t, "rename-source")

	result, report := applySignedTagRename(t, fixture, source.WorkspaceID, "rename-source", "rename-target")
	if result.Status != command.StatusSucceeded {
		t.Fatalf("tag rename apply = %q: %+v", result.Status, result.Reasons)
	}
	if report.Changed != 1 || report.Failed != 0 || !report.Applied || report.Partial {
		t.Fatalf("rename report = %+v", report)
	}
	outcome := tagApplySubject(t, report, subject)
	if outcome.Outcome != command.AnnotationTagOutcomeChanged || !outcome.TargetCreated || !outcome.SourceTombstoned {
		t.Fatalf("rename subject outcome = %+v", outcome)
	}
	target, err := fixture.store.GetAnnotation(ctx, source.WorkspaceID, outcome.TargetAnnotationID)
	if err != nil || target.ID != outcome.TargetAnnotationID || target.SubjectRef != subject ||
		target.Kind != sqlite.AnnotationTag || target.Body != "rename-target" || target.Revision != 1 || target.Tombstoned {
		t.Fatalf("committed target tag = %+v, %v", target, err)
	}
	tombstone, err := fixture.store.GetAnnotation(ctx, source.WorkspaceID, source.ID)
	if err != nil || tombstone.ID != source.ID || tombstone.SubjectRef != subject || tombstone.Kind != sqlite.AnnotationTag ||
		tombstone.Body != "rename-source" || tombstone.BodyDigest != source.BodyDigest || tombstone.Revision != source.Revision+1 ||
		tombstone.PredecessorRevision != source.Revision || !tombstone.Tombstoned || tombstone.UpdatedAt.IsZero() || tombstone.UpdatedAt.Location() != time.UTC {
		t.Fatalf("committed source tombstone = %+v, %v", tombstone, err)
	}
	assertAnnotationInEveryRetainedParent(t, ctx, fixture, source.WorkspaceID, subject, annotationDataFromStore(target))
	assertAnnotationInEveryRetainedParent(t, ctx, fixture, source.WorkspaceID, subject, annotationDataFromStore(tombstone))
	assertAnnotationParentStateUnchanged(t, ctx, fixture, parents)
}

func TestAnnotationTagRenamePublishesCommittedTargetWhenSourceTombstoneStepFails(t *testing.T) {
	ctx := context.Background()
	fixture, subject, source, parents := newSignedTagRenameFixture(t, "partial-source")
	fixture.dispatcher.tagApplyStepFailure = func(gotSubject, action string) error {
		if gotSubject == subject && action == command.AnnotationTagPlanActionTombstone {
			return errors.New("injected tag rename interruption after target commit")
		}
		return nil
	}
	result, report := applySignedTagRename(t, fixture, source.WorkspaceID, "partial-source", "partial-target")
	fixture.dispatcher.tagApplyStepFailure = nil
	if result.Status != command.StatusDegraded || !hasReasonCode(result, ReasonCodeUnavailable) {
		t.Fatalf("partial tag rename = %q: %+v", result.Status, result.Reasons)
	}
	if report.Changed != 0 || report.SourceRemains != 1 || report.Failed != 1 || !report.Partial || report.Applied {
		t.Fatalf("partial rename report = %+v", report)
	}
	outcome := tagApplySubject(t, report, subject)
	if outcome.Outcome != command.AnnotationTagOutcomeTargetAddedSourceRemains || !outcome.TargetCreated || outcome.SourceTombstoned {
		t.Fatalf("partial rename outcome = %+v", outcome)
	}
	target, err := fixture.store.GetAnnotation(ctx, source.WorkspaceID, outcome.TargetAnnotationID)
	if err != nil || target.ID != outcome.TargetAnnotationID || target.Body != "partial-target" || target.Revision != 1 || target.Tombstoned {
		t.Fatalf("committed partial target = %+v, %v", target, err)
	}
	currentSource, err := fixture.store.GetAnnotation(ctx, source.WorkspaceID, source.ID)
	if err != nil || currentSource.Revision != source.Revision || currentSource.Tombstoned {
		t.Fatalf("partial rename mutated source tombstone: %+v, %v", currentSource, err)
	}
	assertAnnotationInEveryRetainedParent(t, ctx, fixture, source.WorkspaceID, subject, annotationDataFromStore(target))
	assertAnnotationInEveryRetainedParent(t, ctx, fixture, source.WorkspaceID, subject, source)
	assertAnnotationParentStateUnchanged(t, ctx, fixture, parents)
}

func TestAnnotationTagRenamePublicationFailureRetainsPartialMutationWithoutRetry(t *testing.T) {
	ctx := context.Background()
	fixture, subject, source, parents := newSignedTagRenameFixture(t, "failed-source")
	fixture.dispatcher.tagApplyStepFailure = func(gotSubject, action string) error {
		if gotSubject == subject && action == command.AnnotationTagPlanActionTombstone {
			return errors.New("injected tag rename interruption after target commit")
		}
		return nil
	}
	baseRepo := fixture.repo
	failingRepo := &annotationFactFailingRepo{Driver: baseRepo, RecordDriver: baseRepo, failAt: 1}
	fixture.dispatcher.exact.Repo = failingRepo
	result, report := applySignedTagRename(t, fixture, source.WorkspaceID, "failed-source", "failed-target")
	fixture.dispatcher.exact.Repo = baseRepo
	fixture.dispatcher.tagApplyStepFailure = nil
	if result.Status != command.StatusDegraded || len(result.Reasons) == 0 ||
		(result.Reasons[0].Code != ReasonCodeUnknownExternalOutcome && result.Reasons[0].Code != ReasonCodeNeedsReconciliation) ||
		!strings.Contains(result.Reasons[0].Message, "authenticated recovery publication incomplete") {
		t.Fatalf("partial rename with publication failure = %q: %+v", result.Status, result.Reasons)
	}
	if report.Failed != 1 || report.SourceRemains != 1 || !report.Partial || len(report.Warnings) == 0 {
		t.Fatalf("publication failure lost per-subject partial outcome/warning: %+v", report)
	}
	outcome := tagApplySubject(t, report, subject)
	target, err := fixture.store.GetAnnotation(ctx, source.WorkspaceID, outcome.TargetAnnotationID)
	if err != nil || target.ID != outcome.TargetAnnotationID || target.Body != "failed-target" || target.Revision != 1 || target.Tombstoned {
		t.Fatalf("publication failure rolled back or changed committed target: %+v, %v", target, err)
	}
	currentSource, err := fixture.store.GetAnnotation(ctx, source.WorkspaceID, source.ID)
	if err != nil || currentSource.Revision != source.Revision || currentSource.Tombstoned {
		t.Fatalf("publication failure changed source despite injected pre-write interruption: %+v, %v", currentSource, err)
	}
	if failingRepo.failedCalls != 1 || failingRepo.factCalls != 2 {
		t.Fatalf("fact publication calls failed=%d total=%d, want one failure and one attempt per retained parent", failingRepo.failedCalls, failingRepo.factCalls)
	}
	revisions, err := fixture.store.ListAnnotationRevisions(ctx, source.WorkspaceID, subject)
	if err != nil {
		t.Fatal(err)
	}
	var targetRevisionCount int
	for _, revision := range revisions {
		if revision.AnnotationID == outcome.TargetAnnotationID && revision.Revision == 1 && revision.Body == "failed-target" {
			targetRevisionCount++
		}
	}
	if targetRevisionCount != 1 {
		t.Fatalf("target revision occurrences = %d, want exactly one committed user mutation", targetRevisionCount)
	}
	assertAnnotationParentStateUnchanged(t, ctx, fixture, parents)
}

func newSignedTagRenameFixture(t *testing.T, from string) (planIngestFixture, string, command.AnnotationData, annotationParentState) {
	t.Helper()
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	first := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	second := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	if first.WorkspaceID != second.WorkspaceID {
		t.Fatalf("retained parents have different workspaces: %q and %q", first.WorkspaceID, second.WorkspaceID)
	}
	subject := noteTestSubject(t, fixture.store, first.WorkspaceID, first.RootID)
	created := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": first.WorkspaceID, "subject_ref": subject, "kind": "TAG", "body": from,
	}))
	if created.Status != command.StatusSucceeded {
		t.Fatalf("create source tag = %q: %+v", created.Status, created.Reasons)
	}
	var data command.AnnotationUpsertData
	if err := json.Unmarshal(created.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Annotation.Kind != "TAG" || data.Annotation.Body != from || data.Annotation.Revision != 1 || data.Annotation.Tombstoned {
		t.Fatalf("source tag = %+v", data.Annotation)
	}
	return fixture, subject, data.Annotation, captureAnnotationParentState(t, ctx, fixture)
}

func applySignedTagRename(t *testing.T, fixture planIngestFixture, workspaceID, from, to string) (command.Result, command.AnnotationTagApplyData) {
	t.Helper()
	ctx := context.Background()
	planned := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationTagPlan, map[string]any{
		"workspace_id": workspaceID, "from": from, "to": to,
	}))
	if planned.Status != command.StatusSucceeded {
		t.Fatalf("tag rename plan = %q: %+v", planned.Status, planned.Reasons)
	}
	var plan command.AnnotationTagPlanData
	if err := json.Unmarshal(planned.Data, &plan); err != nil {
		t.Fatal(err)
	}
	applied := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationTagApply, map[string]any{
		"workspace_id": plan.WorkspaceID, "from": from, "to": to, "plan_digest": plan.PlanDigest,
	}))
	return applied, decodeTagApply(t, applied)
}

func annotationDataFromStore(record sqlite.Annotation) command.AnnotationData {
	return command.AnnotationData{
		ID: record.ID, WorkspaceID: record.WorkspaceID, SubjectRef: record.SubjectRef,
		Kind: string(record.Kind), Body: record.Body, BodyDigest: record.BodyDigest,
		Revision: record.Revision, PredecessorRevision: record.PredecessorRevision,
		Tombstoned: record.Tombstoned,
		CreatedAt:  record.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt:  record.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}
