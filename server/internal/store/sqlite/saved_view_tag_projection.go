package sqlite

import (
	"context"
	"fmt"
	"strings"
)

// SavedViewTagFact is the minimal live TAG record needed to bind a dynamic
// SavedView projection. It deliberately excludes NOTE and other annotation
// bodies.
type SavedViewTagFact struct {
	AnnotationID string
	SubjectRef   string
	Body         string
	Revision     int64
}

// ListSavedViewTagFacts reads only live TAG facts whose exact body occurs in
// wanted. The ordered result is suitable for a read-only projection digest.
func (s *Store) ListSavedViewTagFacts(ctx context.Context, workspaceID string, wanted []string) ([]SavedViewTagFact, error) {
	if strings.TrimSpace(workspaceID) == "" {
		return nil, fmt.Errorf("workspace id is required")
	}
	if len(wanted) == 0 {
		return []SavedViewTagFact{}, nil
	}
	set := make(map[string]struct{}, len(wanted))
	for _, body := range wanted {
		set[body] = struct{}{}
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT annotation_id, subject_ref, body, revision
FROM annotations
WHERE workspace_id = ? AND kind = 'TAG' AND tombstoned = 0
ORDER BY subject_ref, body, annotation_id`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list saved-view TAG facts: %w", err)
	}
	defer rows.Close()
	facts := make([]SavedViewTagFact, 0)
	for rows.Next() {
		var fact SavedViewTagFact
		if err := rows.Scan(&fact.AnnotationID, &fact.SubjectRef, &fact.Body, &fact.Revision); err != nil {
			return nil, err
		}
		if _, relevant := set[fact.Body]; relevant {
			facts = append(facts, fact)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate saved-view TAG facts: %w", err)
	}
	return facts, nil
}
