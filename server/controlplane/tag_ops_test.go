package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/ailiheizi/restoreweave/client/command"
	"github.com/ailiheizi/restoreweave/server/internal/exact"
	"github.com/ailiheizi/restoreweave/server/internal/repository"
	"github.com/ailiheizi/restoreweave/server/internal/store/sqlite"
	"github.com/ailiheizi/restoreweave/server/testutil"
)

// tagFixture publishes one workspace with two distinct file subjects so the
// rename/merge pair is exercised against real subjects, not synthetic refs.
type tagFixture struct {
	dispatcher  *Dispatcher
	store       *sqlite.Store
	workspaceID string
	byName      map[string]string // display name -> stable subject ref
}

func newTagFixture(t *testing.T) tagFixture {
	t.Helper()
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/rw.sock", WithExact(&exact.Service{
		Store: store,
		Repo:  repo,
	}))
	root := t.TempDir()
	for name, body := range map[string]string{"alpha.txt": "alpha bytes", "beta.txt": "beta bytes"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0o600); err != nil {
			t.Fatalf("write fixture %s: %v", name, err)
		}
	}
	ingest := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})
	listed := dispatcher.Handle(ctx, mustEnvelope(t, command.OpContentList, map[string]any{
		"workspace_id": ingest.WorkspaceID,
	}))
	if listed.Status != command.StatusSucceeded {
		t.Fatalf("content.list = %q: %+v", listed.Status, listed.Reasons)
	}
	var data command.ContentListData
	if err := json.Unmarshal(listed.Data, &data); err != nil {
		t.Fatalf("decode content.list: %v", err)
	}
	fixture := tagFixture{dispatcher: dispatcher, store: store, workspaceID: ingest.WorkspaceID, byName: map[string]string{}}
	for _, item := range data.Items {
		if item.EntryType == "DIRECTORY" {
			continue
		}
		fixture.byName[item.Name] = item.SubjectRef
	}
	if fixture.byName["alpha.txt"] == "" || fixture.byName["beta.txt"] == "" ||
		fixture.byName["alpha.txt"] == fixture.byName["beta.txt"] {
		t.Fatalf("fixture subjects = %+v", fixture.byName)
	}
	return fixture
}

// putTag seeds one live TAG record through the admitted per-subject write and
// returns the record the daemon stored.
func (f tagFixture) putTag(t *testing.T, subjectRef, body string) command.AnnotationData {
	t.Helper()
	result := f.dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": f.workspaceID, "subject_ref": subjectRef, "kind": "TAG", "body": body,
	}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("annotation.upsert %s on %s = %q: %+v", body, subjectRef, result.Status, result.Reasons)
	}
	var data command.AnnotationUpsertData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatalf("decode annotation.upsert: %v", err)
	}
	return data.Annotation
}

func (f tagFixture) liveBodies(t *testing.T, subjectRef string) []string {
	t.Helper()
	records, err := f.store.ListAnnotations(context.Background(), f.workspaceID, subjectRef, false)
	if err != nil {
		t.Fatalf("list annotations: %v", err)
	}
	bodies := make([]string, 0, len(records))
	for _, record := range records {
		if record.Kind != sqlite.AnnotationTag {
			continue
		}
		bodies = append(bodies, record.Body)
	}
	sort.Strings(bodies)
	return bodies
}

// tagStoreSnapshot is a full read of every durable row this pair could touch.
// The plan path must leave it byte-identical.
func (f tagFixture) snapshot(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	annotations, err := f.store.ListAnnotations(ctx, f.workspaceID, "", true)
	if err != nil {
		t.Fatalf("snapshot annotations: %v", err)
	}
	revisions, err := f.store.ListAnnotationRevisions(ctx, f.workspaceID, "")
	if err != nil {
		t.Fatalf("snapshot annotation revisions: %v", err)
	}
	plans, err := f.store.ListPlans(ctx, f.workspaceID)
	if err != nil {
		t.Fatalf("snapshot plans: %v", err)
	}
	payload, err := json.Marshal(map[string]any{
		"annotations": annotations, "annotation_revisions": revisions, "plans": plans,
	})
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	return string(payload)
}

func (f tagFixture) plan(t *testing.T, from, to string) command.AnnotationTagPlanData {
	t.Helper()
	result := f.dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpAnnotationTagPlan, map[string]any{
		"workspace_id": f.workspaceID, "from": from, "to": to,
	}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("annotation.tag_plan %s -> %s = %q: %+v", from, to, result.Status, result.Reasons)
	}
	var data command.AnnotationTagPlanData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatalf("decode annotation.tag_plan: %v", err)
	}
	return data
}

func (f tagFixture) apply(t *testing.T, from, to, digest string) command.Result {
	t.Helper()
	return f.dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpAnnotationTagApply, map[string]any{
		"workspace_id": f.workspaceID, "from": from, "to": to, "plan_digest": digest,
	}))
}

func decodeTagApply(t *testing.T, result command.Result) command.AnnotationTagApplyData {
	t.Helper()
	var data command.AnnotationTagApplyData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatalf("decode annotation.tag_apply: %v", err)
	}
	return data
}

func tagPlanSubject(t *testing.T, plan command.AnnotationTagPlanData, subjectRef string) command.AnnotationTagPlanSubjectData {
	t.Helper()
	for _, subject := range plan.Subjects {
		if subject.SubjectRef == subjectRef {
			return subject
		}
	}
	t.Fatalf("plan does not list subject %s: %+v", subjectRef, plan.Subjects)
	return command.AnnotationTagPlanSubjectData{}
}

func tagApplySubject(t *testing.T, data command.AnnotationTagApplyData, subjectRef string) command.AnnotationTagApplySubjectData {
	t.Helper()
	for _, subject := range data.Subjects {
		if subject.SubjectRef == subjectRef {
			return subject
		}
	}
	t.Fatalf("apply result does not list subject %s: %+v", subjectRef, data.Subjects)
	return command.AnnotationTagApplySubjectData{}
}

func assertBodies(t *testing.T, got []string, want ...string) {
	t.Helper()
	sort.Strings(want)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("live tag bodies = %v, want %v", got, want)
	}
}

// TestAnnotationTagPlanIsReadOnlyAndApplyIsDigestBound proves the whole
// admitted shape in one flow: the plan is a canonical, non-mutating derivation
// with explicit no-op steps; the apply re-derives it, refuses a stale or
// altered digest with a typed conflict and no write; the confirmed apply
// reports per-subject outcomes; and a re-plan after the rename reports zero
// remaining work.
func TestAnnotationTagPlanIsReadOnlyAndApplyIsDigestBound(t *testing.T) {
	ctx := context.Background()
	fixture := newTagFixture(t)
	alpha, beta := fixture.byName["alpha.txt"], fixture.byName["beta.txt"]

	const from, to = "rw-tag-plan-src", "rw-tag-plan-dst"
	alphaSource := fixture.putTag(t, alpha, from)
	betaSource := fixture.putTag(t, beta, from)
	alphaTarget := fixture.putTag(t, alpha, to)

	before := fixture.snapshot(t)
	plan := fixture.plan(t, from, to)
	after := fixture.snapshot(t)
	if before != after {
		t.Fatal("annotation.tag_plan changed durable catalog state; the plan path must write nothing")
	}
	if plan.Wrote {
		t.Fatal("plan reports wrote=true; the plan path is read-only")
	}
	if plan.Schema != command.AnnotationTagPlanSchema || plan.Kind != "TAG_RENAME_MERGE" {
		t.Fatalf("plan schema/kind = %q/%q", plan.Schema, plan.Kind)
	}
	if plan.From != from || plan.To != to || plan.WorkspaceID != fixture.workspaceID {
		t.Fatalf("plan identity = %+v", plan)
	}
	if !strings.HasPrefix(plan.PlanDigest, "sha256:") || len(plan.PlanDigest) != len("sha256:")+64 {
		t.Fatalf("plan digest = %q, want sha256:<64 hex>", plan.PlanDigest)
	}
	if plan.RemainingSubjects != 2 || plan.NoopSubjects != 1 || len(plan.Subjects) != 2 {
		t.Fatalf("plan counts = remaining %d, no-op %d, subjects %d", plan.RemainingSubjects, plan.NoopSubjects, len(plan.Subjects))
	}
	refs := []string{plan.Subjects[0].SubjectRef, plan.Subjects[1].SubjectRef}
	if !sort.StringsAreSorted(refs) {
		t.Fatalf("plan subjects are not in deterministic subject order: %v", refs)
	}
	// The subject that already carries the target keeps an explicit no-op add
	// that names the live target record; the other subject plans a real add.
	alphaPlan := tagPlanSubject(t, plan, alpha)
	if len(alphaPlan.Changes) != 2 {
		t.Fatalf("alpha changes = %+v", alphaPlan.Changes)
	}
	add, tombstone := alphaPlan.Changes[0], alphaPlan.Changes[1]
	if add.Action != command.AnnotationTagPlanActionAddTag || add.Body != to || !add.Noop ||
		add.AnnotationID != alphaTarget.ID || add.ExpectedRevision != alphaTarget.Revision {
		t.Fatalf("no-op add = %+v, want the live target record %s@%d", add, alphaTarget.ID, alphaTarget.Revision)
	}
	if tombstone.Action != command.AnnotationTagPlanActionTombstone || tombstone.Body != from ||
		tombstone.Noop || tombstone.AnnotationID != alphaSource.ID || tombstone.ExpectedRevision != alphaSource.Revision {
		t.Fatalf("tombstone change = %+v, want the live source record %s@%d", tombstone, alphaSource.ID, alphaSource.Revision)
	}
	betaPlan := tagPlanSubject(t, plan, beta)
	if betaPlan.Changes[0].Noop || betaPlan.Changes[0].AnnotationID != "" || betaPlan.Changes[0].Body != to {
		t.Fatalf("beta add change = %+v, want a real add with no record bound", betaPlan.Changes[0])
	}
	if betaPlan.Changes[1].AnnotationID != betaSource.ID || betaPlan.Changes[1].ExpectedRevision != betaSource.Revision {
		t.Fatalf("beta tombstone change = %+v, want %s@%d", betaPlan.Changes[1], betaSource.ID, betaSource.Revision)
	}

	// The same facts derive the same digest; the digest is canonical.
	if again := fixture.plan(t, from, to); again.PlanDigest != plan.PlanDigest {
		t.Fatalf("re-plan digest = %q, want %q", again.PlanDigest, plan.PlanDigest)
	}

	// An altered digest is refused with a conflict, before any write.
	stale := fixture.apply(t, from, to, "sha256:"+strings.Repeat("0", 64))
	if stale.Status != command.StatusFailed || !hasReasonCode(stale, ReasonCodeConflict) {
		t.Fatalf("apply with a wrong digest = %q: %+v", stale.Status, stale.Reasons)
	}
	if after != fixture.snapshot(t) {
		t.Fatal("a refused apply wrote durable state")
	}

	// A confirmed apply reports every subject's own outcome.
	applied := fixture.apply(t, from, to, plan.PlanDigest)
	if applied.Status != command.StatusSucceeded {
		t.Fatalf("apply = %q: %+v", applied.Status, applied.Reasons)
	}
	report := decodeTagApply(t, applied)
	if report.Schema != command.AnnotationTagApplySchema || report.PlanDigest != plan.PlanDigest {
		t.Fatalf("apply schema/digest = %+v", report)
	}
	if report.Changed != 2 || report.Unchanged != 0 || report.SourceRemains != 0 || report.Failed != 0 ||
		report.Partial || !report.Applied || len(report.Subjects) != 2 {
		t.Fatalf("apply counts = %+v", report)
	}
	for _, subject := range report.Subjects {
		if subject.Outcome != command.AnnotationTagOutcomeChanged || !subject.SourceTombstoned || subject.Reason != "" {
			t.Fatalf("apply outcome = %+v, want CHANGED with the source tombstoned", subject)
		}
	}
	alphaReport := tagApplySubject(t, report, alpha)
	if alphaReport.TargetAnnotationID != alphaTarget.ID || alphaReport.TargetCreated {
		t.Fatalf("alpha outcome = %+v, want the pre-existing target record reused", alphaReport)
	}
	betaReport := tagApplySubject(t, report, beta)
	if !betaReport.TargetCreated || betaReport.TargetAnnotationID == "" || betaReport.TargetAnnotationID == betaSource.ID {
		t.Fatalf("beta outcome = %+v, want a created target record", betaReport)
	}
	if betaReport.SourceAnnotationID != betaSource.ID {
		t.Fatalf("beta outcome names %q as the tombstoned record, want %q", betaReport.SourceAnnotationID, betaSource.ID)
	}
	assertBodies(t, fixture.liveBodies(t, alpha), to)
	assertBodies(t, fixture.liveBodies(t, beta), to)

	// Replaying the old digest after the facts changed fails closed.
	replay := fixture.apply(t, from, to, plan.PlanDigest)
	if replay.Status != command.StatusFailed || !hasReasonCode(replay, ReasonCodeConflict) {
		t.Fatalf("replayed apply = %q: %+v", replay.Status, replay.Reasons)
	}

	// A re-plan after the rename reports zero remaining work, and applying that
	// empty plan is an honest no-op rather than an error.
	remaining := fixture.plan(t, from, to)
	if remaining.RemainingSubjects != 0 || len(remaining.Subjects) != 0 || remaining.Wrote {
		t.Fatalf("re-plan after the rename = %+v, want zero remaining work", remaining)
	}
	if remaining.PlanDigest == plan.PlanDigest {
		t.Fatal("the empty plan must not reuse the digest of a non-empty plan")
	}
	noop := fixture.apply(t, from, to, remaining.PlanDigest)
	if noop.Status != command.StatusSucceeded {
		t.Fatalf("empty apply = %q: %+v", noop.Status, noop.Reasons)
	}
	noopReport := decodeTagApply(t, noop)
	if noopReport.Changed != 0 || noopReport.Failed != 0 || !noopReport.Applied || len(noopReport.Subjects) != 0 {
		t.Fatalf("empty apply report = %+v", noopReport)
	}

	// The reverse change is expressible with the same pair: plan from=to,
	// to=from and apply it as its own confirmed operation.
	reverse := fixture.plan(t, to, from)
	if reverse.RemainingSubjects != 2 || reverse.NoopSubjects != 0 {
		t.Fatalf("reverse plan = %+v", reverse)
	}
	reversed := fixture.apply(t, to, from, reverse.PlanDigest)
	if reversed.Status != command.StatusSucceeded {
		t.Fatalf("reverse apply = %q: %+v", reversed.Status, reversed.Reasons)
	}
	reverseReport := decodeTagApply(t, reversed)
	if reverseReport.Changed != 2 || !reverseReport.Applied {
		t.Fatalf("reverse report = %+v", reverseReport)
	}
	assertBodies(t, fixture.liveBodies(t, alpha), from)
	assertBodies(t, fixture.liveBodies(t, beta), from)
	// The reverse re-adds the name as a new revision-1 record; the original
	// records stay tombstoned. Nothing claims a record-level rollback.
	for _, retired := range []command.AnnotationData{alphaSource, betaSource} {
		record, err := fixture.store.GetAnnotation(ctx, fixture.workspaceID, retired.ID)
		if err != nil {
			t.Fatalf("read retired record %s: %v", retired.ID, err)
		}
		if !record.Tombstoned {
			t.Fatalf("retired record %s was resurrected; the reverse change must not claim a rollback", retired.ID)
		}
	}
}

// TestAnnotationTagApplyInterruptionLeavesBothNames injects a failure between
// the add and the tombstone. The subject must be left carrying both names, the
// apply must report that subject with the daemon's reason, and the subject
// whose add failed must be left untouched - while the other subjects still
// run.
func TestAnnotationTagApplyInterruptionLeavesBothNames(t *testing.T) {
	fixture := newTagFixture(t)
	alpha, beta := fixture.byName["alpha.txt"], fixture.byName["beta.txt"]

	const from, to = "rw-tag-interrupt-src", "rw-tag-interrupt-dst"
	fixture.putTag(t, alpha, from)
	fixture.putTag(t, beta, from)
	plan := fixture.plan(t, from, to)
	if plan.RemainingSubjects != 2 {
		t.Fatalf("plan subjects = %+v", plan)
	}

	fixture.dispatcher.tagApplyStepFailure = func(subjectRef, action string) error {
		switch {
		case subjectRef == alpha && action == command.AnnotationTagPlanActionAddTag:
			return errors.New("injected target add failure")
		case subjectRef == beta && action == command.AnnotationTagPlanActionTombstone:
			return errors.New("injected interruption between the add and the tombstone")
		default:
			return nil
		}
	}
	result := fixture.apply(t, from, to, plan.PlanDigest)
	fixture.dispatcher.tagApplyStepFailure = nil
	if result.Status != command.StatusDegraded {
		t.Fatalf("partial apply = %q: %+v, want DEGRADED", result.Status, result.Reasons)
	}
	if !hasReasonCode(result, ReasonCodeUnavailable) || !strings.Contains(result.Reasons[0].Message, "not a clean rename") {
		t.Fatalf("partial apply reasons = %+v", result.Reasons)
	}
	report := decodeTagApply(t, result)
	if report.Partial != true || report.Applied != false || report.Failed != 2 ||
		report.Changed != 0 || report.Unchanged != 1 || report.SourceRemains != 1 {
		t.Fatalf("partial apply counts = %+v", report)
	}
	alphaOutcome := tagApplySubject(t, report, alpha)
	if alphaOutcome.Outcome != command.AnnotationTagOutcomeUnchanged ||
		!strings.Contains(alphaOutcome.Reason, "injected target add failure") {
		t.Fatalf("alpha outcome = %+v, want UNCHANGED with the injected reason", alphaOutcome)
	}
	betaOutcome := tagApplySubject(t, report, beta)
	if betaOutcome.Outcome != command.AnnotationTagOutcomeTargetAddedSourceRemains ||
		!strings.Contains(betaOutcome.Reason, "injected interruption") || betaOutcome.SourceTombstoned {
		t.Fatalf("beta outcome = %+v, want TARGET_ADDED_SOURCE_REMAINS with the injected reason", betaOutcome)
	}
	// The interrupted subject carries both names; the subject whose add failed
	// carries exactly what it carried before.
	assertBodies(t, fixture.liveBodies(t, beta), from, to)
	assertBodies(t, fixture.liveBodies(t, alpha), from)

	// The reverse change handles the both-names state the same way: for the
	// interrupted subject the add is already satisfied, so only the added name
	// is tombstoned, and the untouched subject is not part of the reverse plan
	// at all.
	reverse := fixture.plan(t, to, from)
	if reverse.RemainingSubjects != 1 || reverse.NoopSubjects != 1 || reverse.Subjects[0].SubjectRef != beta {
		t.Fatalf("reverse plan over the interrupted state = %+v, want only the interrupted subject with a no-op add", reverse)
	}

	// The interruption is reconciled by re-planning, not by replay. The plan
	// now states exactly the remaining work: the untouched subject needs its
	// add and tombstone, and the interrupted subject needs only the tombstone
	// because its target add is already satisfied.
	remaining := fixture.plan(t, from, to)
	if remaining.RemainingSubjects != 2 || remaining.NoopSubjects != 1 {
		t.Fatalf("re-plan after the interruption = %+v, want both subjects with the interrupted subject's add as a no-op", remaining)
	}
	interrupted := tagPlanSubject(t, remaining, beta)
	if !interrupted.Changes[0].Noop || interrupted.Changes[0].AnnotationID == "" {
		t.Fatalf("re-plan for the interrupted subject = %+v, want the already-live target as an explicit no-op", interrupted.Changes)
	}
	if remaining.PlanDigest == plan.PlanDigest {
		t.Fatal("the re-planned digest must differ after the interrupted apply wrote records")
	}
	completed := fixture.apply(t, from, to, remaining.PlanDigest)
	if completed.Status != command.StatusSucceeded {
		t.Fatalf("reconciled apply = %q: %+v", completed.Status, completed.Reasons)
	}
	if report := decodeTagApply(t, completed); report.Changed != 2 || report.Unchanged != 0 || report.SourceRemains != 0 || !report.Applied {
		t.Fatalf("reconciled apply report = %+v", report)
	}
	assertBodies(t, fixture.liveBodies(t, alpha), to)
	assertBodies(t, fixture.liveBodies(t, beta), to)
}

// TestAnnotationTagPlanValidation pins the fail-closed input checks.
func TestAnnotationTagPlanValidation(t *testing.T) {
	fixture := newTagFixture(t)
	ctx := context.Background()
	for name, input := range map[string]map[string]any{
		"empty from":        {"workspace_id": fixture.workspaceID, "from": "", "to": "b"},
		"empty to":          {"workspace_id": fixture.workspaceID, "from": "a", "to": "  "},
		"same name":         {"workspace_id": fixture.workspaceID, "from": "a", "to": "a"},
		"missing workspace": {"from": "a", "to": "b"},
	} {
		result := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationTagPlan, input))
		if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeInvalidInput) {
			t.Fatalf("annotation.tag_plan %s = %q: %+v", name, result.Status, result.Reasons)
		}
	}
	unknown := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationTagPlan, map[string]any{
		"workspace_id": "ws_00000000000000000000000000000000", "from": "a", "to": "b",
	}))
	if unknown.Status != command.StatusFailed || !hasReasonCode(unknown, ReasonCodeNotFound) {
		t.Fatalf("annotation.tag_plan for an unknown workspace = %q: %+v", unknown.Status, unknown.Reasons)
	}
	noDigest := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationTagApply, map[string]any{
		"workspace_id": fixture.workspaceID, "from": "a", "to": "b",
	}))
	if noDigest.Status != command.StatusFailed || !hasReasonCode(noDigest, ReasonCodeInvalidInput) {
		t.Fatalf("annotation.tag_apply without a digest = %q: %+v", noDigest.Status, noDigest.Reasons)
	}
	// The byte-exact names are the durable names: a padded name is a different
	// plan that matches no record, never a normalized lookup.
	plan := fixture.plan(t, " rw-tag-plan-src", "rw-tag-plan-dst")
	if plan.RemainingSubjects != 0 {
		t.Fatalf("padded name plan = %+v, want an empty plan", plan)
	}
}
