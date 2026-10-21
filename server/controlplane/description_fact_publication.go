package controlplane

import (
	"context"
	"errors"
	"fmt"

	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// publishDescriptionFacts binds exact committed immutable description
// revisions to every retained authenticated parent that maps an affected
// subject. The caller supplies the rows captured by the successful write,
// never a later mutable catalog read.
func (d *Dispatcher) publishDescriptionFacts(ctx context.Context, workspaceID string, records []sqlite.DescriptionDocument) error {
	if d.exact == nil {
		return errors.New("exact service is unavailable for authenticated recovery publication")
	}
	if len(records) == 0 {
		return nil
	}
	mutations := make([]exact.DescriptionFactMutation, 0, len(records))
	subjects := make([]string, 0, len(records))
	for _, record := range records {
		if record.WorkspaceID != workspaceID {
			return fmt.Errorf("description %s belongs to workspace %s, not %s", record.ID, record.WorkspaceID, workspaceID)
		}
		mutations = append(mutations, exact.DescriptionFactMutation{
			DescriptionID: record.ID,
			SubjectRef:    record.SubjectRef,
			Revision:      record.Revision,
			BodyDigest:    record.BodyDigest,
			Accepted:      record.Accepted,
			Visibility:    record.Visibility,
		})
		subjects = append(subjects, record.SubjectRef)
	}
	targets, err := d.exact.ResolveSubjectFactPublicationTargets(ctx, workspaceID, subjects)
	if err != nil {
		return fmt.Errorf("resolve authenticated recovery parents: %w", err)
	}
	result, err := d.exact.PublishSubjectFactSuccessors(ctx, workspaceID, targets, nil, mutations)
	if err != nil {
		return fmt.Errorf("%s: %w", descriptionPublicationLabel(records), err)
	}
	for _, parent := range result.Parents {
		if !parent.Covered {
			return fmt.Errorf("%s: parent %s is not verified: %s", descriptionPublicationLabel(records), parent.Target.ParentCommitDigest, parent.Error)
		}
	}
	return nil
}

func descriptionPublicationLabel(records []sqlite.DescriptionDocument) string {
	if len(records) == 1 {
		return fmt.Sprintf("publish description revision %s@%d", records[0].ID, records[0].Revision)
	}
	return fmt.Sprintf("publish %d description revisions", len(records))
}
