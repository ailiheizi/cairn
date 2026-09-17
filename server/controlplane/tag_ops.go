package controlplane

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/ailiheizi/restoreweave/client/command"
	"github.com/ailiheizi/restoreweave/server/internal/store/sqlite"
)

// annotation.tag_plan and annotation.tag_apply are one reviewed pair that
// replaces N sequential per-subject annotation.upsert/annotation.delete calls
// for a rename or merge. The pair follows the admitted Phase 2 plan/apply
// discipline in its bounded form:
//
//   - the plan is derived from the live TAG records of one workspace and is
//     genuinely non-mutating: it writes no annotation, no plan row, and no
//     audit event, and it reports wrote=false explicitly;
//   - the apply carries the plan digest. It re-derives the plan from the
//     current records and refuses with a typed conflict before any write when
//     the digest does not match, so a plan that was altered, replayed after
//     the facts changed, or confirmed against stale facts fails closed;
//   - each subject is applied in the documented order: the target name is
//     added first, the source record is tombstoned second. An interruption
//     between the two steps therefore leaves the subject carrying both names
//     rather than neither, and the apply reports that subject exactly so;
//   - per-subject outcomes are returned honestly. A pre-existing change (a
//     derived plan that no longer matches the confirmed digest) refuses the
//     whole apply before any write; a step that fails after the digest was
//     confirmed fails only its own subject and the remaining subjects still
//     run, each with its own outcome and the daemon's own reason;
//   - the reverse change is expressible with the same pair (plan from=to,
//     to=from) and is again planned and confirmed. Nothing here claims an
//     automatic rollback.
//
// The existing per-subject annotation.upsert and annotation.delete behavior is
// untouched; this pair is an additional path.

const (
	annotationTagPlanKind            = "TAG_RENAME_MERGE"
	annotationTagPlanActionAddTag    = command.AnnotationTagPlanActionAddTag
	annotationTagPlanActionTombstone = command.AnnotationTagPlanActionTombstone
)

type annotationTagPlanInput struct {
	WorkspaceID string `json:"workspace_id"`
	From        string `json:"from"`
	To          string `json:"to"`
}

type annotationTagApplyInput struct {
	WorkspaceID string `json:"workspace_id"`
	From        string `json:"from"`
	To          string `json:"to"`
	PlanDigest  string `json:"plan_digest"`
}

// annotationTagPlanBody is the canonical plan document the digest is computed
// over. It is derived, never stored: the plan path writes nothing.
type annotationTagPlanBody struct {
	Schema      string                                 `json:"schema"`
	Kind        string                                 `json:"kind"`
	WorkspaceID string                                 `json:"workspace_id"`
	From        string                                 `json:"from"`
	To          string                                 `json:"to"`
	Subjects    []command.AnnotationTagPlanSubjectData `json:"subjects"`
}

func (d *Dispatcher) handleAnnotationTagPlan(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil {
		return unimplementedResult(env, started)
	}
	var input annotationTagPlanInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := validateTagRename(input.WorkspaceID, input.From, input.To); err != nil {
		return invalidInputResult(env, started, err)
	}
	if result, ok := d.requireTagWorkspace(ctx, env, started, input.WorkspaceID); !ok {
		return result
	}
	// Every read below is a catalog read. This handler never opens a write
	// transaction, so the plan cannot change a record, a plan row, or a job.
	body, err := d.deriveTagRenamePlan(ctx, input.WorkspaceID, input.From, input.To)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	return succeeded(env, started, projectTagRenamePlan(body))
}

func (d *Dispatcher) handleAnnotationTagApply(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil {
		return unimplementedResult(env, started)
	}
	var input annotationTagApplyInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := validateTagRename(input.WorkspaceID, input.From, input.To); err != nil {
		return invalidInputResult(env, started, err)
	}
	if strings.TrimSpace(input.PlanDigest) == "" {
		return invalidInputResult(env, started, errString("plan_digest is required"))
	}
	if result, ok := d.requireTagWorkspace(ctx, env, started, input.WorkspaceID); !ok {
		return result
	}
	// Re-derive the plan from the current records and bind the apply to the
	// digest the operator confirmed. A pre-existing change makes the derived
	// plan different, so the whole apply is refused before any subject write:
	// no subject is silently applied against facts the operator did not see.
	plan, err := d.deriveTagRenamePlan(ctx, input.WorkspaceID, input.From, input.To)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	digest := tagPlanDigest(plan)
	if digest != input.PlanDigest {
		return conflictResult(env, started, "plan digest does not match the current tag facts; nothing was written, so re-plan the change")
	}
	outcomes := make([]command.AnnotationTagApplySubjectData, 0, len(plan.Subjects))
	wrote := false
	for _, subject := range plan.Subjects {
		outcome, changed := d.applyTagRenameSubject(ctx, input.WorkspaceID, input.From, input.To, subject)
		outcomes = append(outcomes, outcome)
		wrote = wrote || changed
	}
	data := projectTagApplyData(input, digest, outcomes)
	if wrote {
		if rebuildErr := d.rebuildSearch(ctx, input.WorkspaceID); rebuildErr != nil {
			data.Warnings = append(data.Warnings, "the tag change was applied, but the search index is unavailable: "+rebuildErr.Error())
		}
	}
	if data.Failed > 0 {
		return degradedResult(env, started, data, fmt.Sprintf(
			"%d of %d subjects did not complete; each subject's own outcome and reason are listed and this is not a clean rename",
			data.Failed, len(outcomes)))
	}
	if len(data.Warnings) > 0 {
		return degradedResult(env, started, data, strings.Join(data.Warnings, "; "))
	}
	return succeeded(env, started, data)
}

// validateTagRename accepts tag names exactly as the annotation operations
// store them: no trimming, no case folding, no other normalization. The names
// must be non-empty and distinct, because a zero-change plan is expressed by
// the derived plan being empty, not by a degenerate from=to pair.
func validateTagRename(workspaceID, from, to string) error {
	if err := requireStableID("workspace_id", workspaceID); err != nil {
		return err
	}
	if strings.TrimSpace(from) == "" {
		return errString("from is required")
	}
	if strings.TrimSpace(to) == "" {
		return errString("to is required")
	}
	if from == to {
		return errString("from and to must be different tag names")
	}
	return nil
}

func (d *Dispatcher) requireTagWorkspace(ctx context.Context, env command.Envelope, started time.Time, workspaceID string) (command.Result, bool) {
	if _, err := d.store.GetWorkspace(ctx, workspaceID); err != nil {
		if containsNotFound(err) {
			return notFoundResult(env, started, "workspace not found"), false
		}
		return catalogErrorResult(env, started, err), false
	}
	return command.Result{}, true
}

// deriveTagRenamePlan lists every live TAG record carrying `from`, in
// deterministic subject order, with the exact record facts the apply must use.
// A subject that already carries `to` keeps its ADD_TAG step as an explicit
// no-op naming the live target record. The store admits at most one live TAG
// record per (workspace, subject, body), so each subject maps to exactly one
// source record and at most one target record.
func (d *Dispatcher) deriveTagRenamePlan(ctx context.Context, workspaceID, from, to string) (annotationTagPlanBody, error) {
	body := annotationTagPlanBody{
		Schema:      command.AnnotationTagPlanSchema,
		Kind:        annotationTagPlanKind,
		WorkspaceID: workspaceID,
		From:        from,
		To:          to,
	}
	if from == to {
		return body, errors.New("from and to must be different tag names")
	}
	records, err := d.store.ListAnnotations(ctx, workspaceID, "", false)
	if err != nil {
		return body, err
	}
	sourceBySubject := make(map[string]sqlite.Annotation)
	targetBySubject := make(map[string]sqlite.Annotation)
	for _, record := range records {
		if record.Kind != sqlite.AnnotationTag {
			continue
		}
		switch record.Body {
		case from:
			sourceBySubject[record.SubjectRef] = record
		case to:
			targetBySubject[record.SubjectRef] = record
		}
	}
	subjects := make([]string, 0, len(sourceBySubject))
	for subjectRef := range sourceBySubject {
		subjects = append(subjects, subjectRef)
	}
	sort.Strings(subjects)
	body.Subjects = make([]command.AnnotationTagPlanSubjectData, 0, len(subjects))
	for _, subjectRef := range subjects {
		source := sourceBySubject[subjectRef]
		add := command.AnnotationTagPlanChangeData{Action: annotationTagPlanActionAddTag, Body: to}
		if target, ok := targetBySubject[subjectRef]; ok {
			add.Noop = true
			add.AnnotationID = target.ID
			add.ExpectedRevision = target.Revision
		}
		tombstone := command.AnnotationTagPlanChangeData{
			Action: annotationTagPlanActionTombstone, Body: from,
			AnnotationID: source.ID, ExpectedRevision: source.Revision,
		}
		body.Subjects = append(body.Subjects, command.AnnotationTagPlanSubjectData{
			SubjectRef: subjectRef,
			Changes:    []command.AnnotationTagPlanChangeData{add, tombstone},
		})
	}
	return body, nil
}

func tagPlanDigest(body annotationTagPlanBody) string {
	payload, err := json.Marshal(body)
	if err != nil {
		return ""
	}
	return "sha256:" + hex.EncodeToString(sha256Sum(payload))
}

func projectTagRenamePlan(body annotationTagPlanBody) command.AnnotationTagPlanData {
	noopSubjects := 0
	for _, subject := range body.Subjects {
		for _, change := range subject.Changes {
			if change.Noop {
				noopSubjects++
				break
			}
		}
	}
	return command.AnnotationTagPlanData{
		Schema: body.Schema, Kind: body.Kind, WorkspaceID: body.WorkspaceID,
		From: body.From, To: body.To,
		Subjects:          body.Subjects,
		RemainingSubjects: len(body.Subjects),
		NoopSubjects:      noopSubjects,
		Wrote:             false,
		PlanDigest:        tagPlanDigest(body),
	}
}

// applyTagRenameSubject performs the documented pair for one subject. The
// target add is committed first and only then is the source tombstone
// attempted, so a failure at any point after the add leaves the subject
// carrying the target name and the source name. `changed` reports whether the
// subject's records were written by this call.
func (d *Dispatcher) applyTagRenameSubject(
	ctx context.Context,
	workspaceID, from, to string,
	subject command.AnnotationTagPlanSubjectData,
) (command.AnnotationTagApplySubjectData, bool) {
	outcome := command.AnnotationTagApplySubjectData{SubjectRef: subject.SubjectRef}
	var tombstone command.AnnotationTagPlanChangeData
	for _, change := range subject.Changes {
		switch change.Action {
		case annotationTagPlanActionTombstone:
			tombstone = change
			outcome.SourceAnnotationID = change.AnnotationID
		case annotationTagPlanActionAddTag:
			outcome.TargetAnnotationID = change.AnnotationID
		}
	}
	if tombstone.AnnotationID == "" || tombstone.ExpectedRevision < 1 {
		// A plan without a tombstone target cannot be applied; the digest gate
		// makes this unreachable for a plan this daemon derived.
		outcome.Outcome = command.AnnotationTagOutcomeUnchanged
		outcome.Reason = "the plan carries no source record to tombstone"
		return outcome, false
	}
	// Step 1: add the target name. The write is the same one annotation.upsert
	// performs for a TAG: reuse the live record when it exists, otherwise
	// create revision 1. No record is rewritten in place.
	if err := d.tagApplyStepFailureCheck(subject.SubjectRef, annotationTagPlanActionAddTag); err != nil {
		outcome.Outcome = command.AnnotationTagOutcomeUnchanged
		outcome.Reason = err.Error()
		return outcome, false
	}
	target, err := d.store.FindLiveTag(ctx, workspaceID, subject.SubjectRef, to)
	switch {
	case err == nil:
		outcome.TargetAnnotationID = target.ID
	case containsNotFound(err):
		id, idErr := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
		if idErr != nil {
			outcome.Outcome = command.AnnotationTagOutcomeUnchanged
			outcome.Reason = idErr.Error()
			return outcome, false
		}
		record := &sqlite.Annotation{
			ID: id, WorkspaceID: workspaceID, SubjectRef: subject.SubjectRef,
			Kind: sqlite.AnnotationTag, Body: to, Revision: 1,
		}
		if createErr := d.store.CreateAnnotation(ctx, record); createErr != nil {
			// CreateAnnotation is one transaction: nothing was written for this
			// subject, so the source record and the target name are unchanged.
			outcome.Outcome = command.AnnotationTagOutcomeUnchanged
			outcome.Reason = createErr.Error()
			return outcome, false
		}
		// Read the live record back so the reported id is the stored one even
		// when a concurrent writer created the same live tag first.
		live, readErr := d.store.FindLiveTag(ctx, workspaceID, subject.SubjectRef, to)
		if readErr != nil {
			outcome.Outcome = command.AnnotationTagOutcomeTargetAddedSourceRemains
			outcome.Reason = "the target tag was added but its record could not be read back: " + readErr.Error()
			return outcome, true
		}
		outcome.TargetAnnotationID = live.ID
		outcome.TargetCreated = live.ID == id
	default:
		outcome.Outcome = command.AnnotationTagOutcomeUnchanged
		outcome.Reason = err.Error()
		return outcome, false
	}
	// Step 2: tombstone the source record with the revision the plan bound.
	if err := d.tagApplyStepFailureCheck(subject.SubjectRef, annotationTagPlanActionTombstone); err != nil {
		outcome.Outcome = command.AnnotationTagOutcomeTargetAddedSourceRemains
		outcome.Reason = err.Error()
		return outcome, true
	}
	if err := d.store.ReviseAnnotation(ctx, workspaceID, tombstone.AnnotationID, tombstone.ExpectedRevision, tombstone.Body, true, time.Time{}); err != nil {
		outcome.Reason = tagApplyWriteReason(err)
		if errors.Is(err, sqlite.ErrConflict) {
			// A revision conflict also covers a record another writer already
			// tombstoned. Re-read it: when the source name is already gone the
			// subject has reached the planned end state and is reported as
			// changed rather than as carrying both names.
			if current, getErr := d.store.GetAnnotation(ctx, workspaceID, tombstone.AnnotationID); getErr == nil && current.Tombstoned {
				outcome.Outcome = command.AnnotationTagOutcomeChanged
				outcome.SourceTombstoned = true
				return outcome, true
			}
		}
		outcome.Outcome = command.AnnotationTagOutcomeTargetAddedSourceRemains
		return outcome, true
	}
	outcome.SourceTombstoned = true
	outcome.Outcome = command.AnnotationTagOutcomeChanged
	return outcome, true
}

// tagApplyStepFailureCheck consults the test-only seam. Production dispatchers
// leave the seam nil, so this is a nil check per step.
func (d *Dispatcher) tagApplyStepFailureCheck(subjectRef, action string) error {
	if d.tagApplyStepFailure == nil {
		return nil
	}
	return d.tagApplyStepFailure(subjectRef, action)
}

func tagApplyWriteReason(err error) string {
	switch {
	case errors.Is(err, sqlite.ErrConflict):
		return "annotation revision conflict: the record changed after this plan was derived, so the tombstone was refused and nothing was overwritten"
	case containsNotFound(err):
		return "annotation not found: the record is no longer present, so the tombstone was refused and nothing was overwritten"
	default:
		return err.Error()
	}
}

func projectTagApplyData(input annotationTagApplyInput, digest string, outcomes []command.AnnotationTagApplySubjectData) command.AnnotationTagApplyData {
	data := command.AnnotationTagApplyData{
		Schema:      command.AnnotationTagApplySchema,
		WorkspaceID: input.WorkspaceID,
		From:        input.From,
		To:          input.To,
		PlanDigest:  digest,
		Subjects:    outcomes,
	}
	for _, outcome := range outcomes {
		switch outcome.Outcome {
		case command.AnnotationTagOutcomeChanged:
			data.Changed++
		case command.AnnotationTagOutcomeUnchanged:
			data.Unchanged++
		case command.AnnotationTagOutcomeTargetAddedSourceRemains:
			data.SourceRemains++
		}
	}
	// Every subject whose change did not complete counts as failed, including
	// any outcome token this daemon does not itself produce: a partial apply
	// must never be under-reported.
	data.Failed = len(outcomes) - data.Changed
	data.Partial = data.Failed > 0
	data.Applied = data.Failed == 0
	return data
}
