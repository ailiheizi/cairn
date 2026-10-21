package controlplane

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// publishAnnotationFact preserves the single-revision call contract while
// routing publication through the batch helper.
func (d *Dispatcher) publishAnnotationFact(ctx context.Context, record sqlite.Annotation) error {
	return d.publishAnnotationFacts(ctx, record.WorkspaceID, []sqlite.Annotation{record})
}

// publishAnnotationFacts joins exact already-committed annotation revisions
// to every retained authenticated parent that maps any affected subject.
func (d *Dispatcher) publishAnnotationFacts(ctx context.Context, workspaceID string, records []sqlite.Annotation) error {
	if d.exact == nil {
		return errors.New("exact service is unavailable for authenticated recovery publication")
	}
	if len(records) == 0 {
		return nil
	}
	mutations := make([]exact.AnnotationFactMutation, 0, len(records))
	subjects := make([]string, 0, len(records))
	for _, record := range records {
		if record.WorkspaceID != workspaceID {
			return fmt.Errorf("annotation %s belongs to workspace %s, not %s", record.ID, record.WorkspaceID, workspaceID)
		}
		mutations = append(mutations, exact.AnnotationFactMutation{
			AnnotationID: record.ID,
			SubjectRef:   record.SubjectRef,
			Revision:     record.Revision,
			BodyDigest:   record.BodyDigest,
			Kind:         record.Kind,
			Tombstoned:   record.Tombstoned,
		})
		subjects = append(subjects, record.SubjectRef)
	}
	targets, err := d.exact.ResolveSubjectFactPublicationTargets(ctx, workspaceID, subjects)
	if err != nil {
		return fmt.Errorf("resolve authenticated recovery parents: %w", err)
	}
	result, err := d.exact.PublishSubjectFactSuccessors(ctx, workspaceID, targets, mutations, nil)
	if err != nil {
		return fmt.Errorf("%s: %w", annotationPublicationLabel(records), err)
	}
	for _, parent := range result.Parents {
		if !parent.Covered {
			return fmt.Errorf("%s: parent %s is not verified: %s", annotationPublicationLabel(records), parent.Target.ParentCommitDigest, parent.Error)
		}
	}
	return nil
}

func annotationPublicationLabel(records []sqlite.Annotation) string {
	if len(records) == 1 {
		return fmt.Sprintf("publish annotation revision %s@%d", records[0].ID, records[0].Revision)
	}
	return fmt.Sprintf("publish %d annotation revisions", len(records))
}

func annotationBodyDigest(body string) string {
	return exact.DigestBytes([]byte(body))
}

func annotationPostCommitDegradedResult(
	env command.Envelope,
	started time.Time,
	data command.AnnotationUpsertData,
	searchErr error,
	publicationErr error,
) command.Result {
	return metadataPostCommitDegradedResult(env, started, data, "annotation", searchErr, publicationErr)
}

func metadataPostCommitDegradedResult(
	env command.Envelope,
	started time.Time,
	data any,
	label string,
	searchErr error,
	publicationErr error,
) command.Result {
	code := ReasonCodeUnavailable
	switch {
	case errors.Is(publicationErr, exact.ErrUnknownExternalOutcome):
		code = ReasonCodeUnknownExternalOutcome
	case errors.Is(publicationErr, exact.ErrNeedsReconciliation):
		code = ReasonCodeNeedsReconciliation
	}
	warnings := make([]string, 0, 2)
	if searchErr != nil {
		warnings = append(warnings, "search index unavailable: "+searchErr.Error())
	}
	if publicationErr != nil {
		warnings = append(warnings, "authenticated recovery publication incomplete: "+publicationErr.Error())
	}
	return command.NewResult(env, command.StatusDegraded, started, time.Now().UTC(), data, newReason(
		code,
		label+" committed with post-commit warning: "+strings.Join(warnings, "; "),
	))
}
