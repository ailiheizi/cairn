package controlplane

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

type jobEventsInput struct {
	WorkspaceID   string `json:"workspace_id"`
	JobID         string `json:"job_id"`
	JobRef        string `json:"job_ref"`
	AfterSequence int64  `json:"after_sequence"`
	Limit         int    `json:"limit"`
}

type jobCancelInput struct {
	WorkspaceID string `json:"workspace_id"`
	JobID       string `json:"job_id"`
	JobRef      string `json:"job_ref"`
}

type jobListInput struct {
	WorkspaceID string `json:"workspace_id,omitempty"`
	Limit       int    `json:"limit,omitempty"`
}

// handleJobList is the bounded read of durable job rows. It reuses the same
// newest-first projection as status.get and never mutates a job. A workspace
// filter narrows the newest rows selected by limit; it never widens the bound.
func (d *Dispatcher) handleJobList(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input jobListInput
	if len(env.Input) > 0 {
		if err := decodeInput(env.Input, &input); err != nil {
			return invalidInputResult(env, started, err)
		}
	}
	if strings.TrimSpace(input.WorkspaceID) != "" {
		if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
			return invalidInputResult(env, started, err)
		}
	}
	limit := input.Limit
	if limit == 0 {
		limit = 20
	}
	if limit < 1 || limit > 100 {
		return invalidInputResult(env, started, errString("limit must be between 1 and 100"))
	}
	jobs, err := d.store.ListRecentJobs(ctx, limit)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	summaries := make([]command.JobSummary, 0, len(jobs))
	for _, job := range jobs {
		if input.WorkspaceID != "" && job.WorkspaceID != input.WorkspaceID {
			continue
		}
		summaries = append(summaries, projectJobSummary(job))
	}
	return succeeded(env, started, command.JobListData{Jobs: summaries})
}

// projectJobSummary projects only recorded job columns. An absent error_code
// stays absent: it is not a claim that the job succeeded.
func projectJobSummary(job sqlite.Job) command.JobSummary {
	return command.JobSummary{
		JobID:             job.ID,
		WorkspaceID:       job.WorkspaceID,
		PlanID:            job.PlanID,
		Kind:              job.Kind,
		State:             string(job.State),
		Attempt:           job.Attempt,
		MaxAttempts:       job.MaxAttempts,
		ErrorCode:         job.ErrorCode,
		CheckpointPresent: jobCheckpointPresent(job.Checkpoint),
		UpdatedAt:         job.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// jobCheckpointPresent is a hint only. The catalog normalizes an absent
// checkpoint to an empty object, so nothing beyond that default is reported
// as recorded progress.
func jobCheckpointPresent(checkpoint json.RawMessage) bool {
	switch strings.TrimSpace(string(checkpoint)) {
	case "", "{}", "null":
		return false
	}
	return true
}

func (d *Dispatcher) handleJobEvents(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input jobEventsInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	jobID := firstNonEmpty(input.JobID, input.JobRef)
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("job_id", jobID); err != nil {
		return invalidInputResult(env, started, err)
	}
	limit := input.Limit
	if limit == 0 {
		limit = 50
	}
	if limit < 1 || limit > 1000 {
		return invalidInputResult(env, started, errString("limit must be between 1 and 1000"))
	}
	if input.AfterSequence < 0 {
		return invalidInputResult(env, started, errString("after_sequence cannot be negative"))
	}
	job, err := d.store.GetJob(ctx, input.WorkspaceID, jobID)
	if err != nil {
		if containsNotFound(err) {
			return notFoundResult(env, started, "job not found")
		}
		return catalogErrorResult(env, started, err)
	}
	events, err := d.store.ListJobAuditEvents(ctx, input.WorkspaceID, jobID, input.AfterSequence, limit)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	page := make([]command.JobEventData, 0, len(events))
	next := input.AfterSequence
	for _, event := range events {
		page = append(page, command.JobEventData{
			Sequence:   event.Sequence,
			EventID:    event.ID,
			Action:     event.Action,
			Outcome:    event.Outcome,
			OccurredAt: event.OccurredAt.UTC().Format(time.RFC3339),
			Details:    event.Details,
		})
		next = event.Sequence
	}
	return succeeded(env, started, command.JobEventsData{
		JobID:        job.ID,
		JobState:     string(job.State),
		Events:       page,
		NextSequence: next,
		Terminal:     jobTerminal(job.State),
	})
}

func (d *Dispatcher) handleJobCancel(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input jobCancelInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	jobID := firstNonEmpty(input.JobID, input.JobRef)
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("job_id", jobID); err != nil {
		return invalidInputResult(env, started, err)
	}
	job, err := d.store.GetJob(ctx, input.WorkspaceID, jobID)
	if err != nil {
		if containsNotFound(err) {
			return notFoundResult(env, started, "job not found")
		}
		return catalogErrorResult(env, started, err)
	}
	if jobTerminal(job.State) {
		return succeeded(env, started, command.JobCancelData{
			JobID:             job.ID,
			JobState:          string(job.State),
			Cancelled:         job.State == sqlite.JobCancelled,
			AlreadyTerminal:   true,
			CancellationAsked: job.CancellationAsked,
		})
	}
	nextState := job.State
	cancelled := false
	if job.State == sqlite.JobQueued {
		nextState = sqlite.JobCancelled
		cancelled = true
	}
	err = d.store.Update(ctx, func(tx *sqlite.Tx) error {
		if err := tx.UpdateJob(ctx, sqlite.JobUpdate{
			WorkspaceID:       job.WorkspaceID,
			JobID:             job.ID,
			ExpectedRevision:  job.Revision,
			State:             nextState,
			Checkpoint:        job.Checkpoint,
			Result:            job.Result,
			ErrorCode:         job.ErrorCode,
			Attempt:           job.Attempt,
			CancellationAsked: true,
		}); err != nil {
			return err
		}
		action := "JOB_CANCEL_REQUESTED"
		outcome := "SUCCEEDED"
		if cancelled {
			action = "JOB_CANCELLED"
		}
		return tx.AppendAuditEvent(ctx, &sqlite.AuditEvent{
			ID:          mustAuditID(),
			WorkspaceID: job.WorkspaceID,
			Actor:       "cairnd",
			Action:      action,
			TargetType:  "JOB",
			TargetID:    job.ID,
			RequestID:   env.RequestID,
			Outcome:     outcome,
			Details:     json.RawMessage(`{"note":"cancellation does not roll back published snapshots"}`),
		})
	})
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	return succeeded(env, started, command.JobCancelData{
		JobID:             job.ID,
		JobState:          string(nextState),
		Cancelled:         cancelled,
		AlreadyTerminal:   false,
		CancellationAsked: true,
	})
}

func jobTerminal(state sqlite.JobState) bool {
	return state == sqlite.JobSucceeded || state == sqlite.JobFailed || state == sqlite.JobCancelled || state == sqlite.JobNeedsReconcile
}
