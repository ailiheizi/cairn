package sqlite

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// RestoreAnnotationHistory restores an authenticated annotation history and
// its current projection into the caller's transaction. It never synthesizes
// missing revisions; an incomplete retained chain stays incomplete.
func (tx *Tx) RestoreAnnotationHistory(ctx context.Context, current Annotation, revisions []AnnotationRevision) error {
	ordered, err := validateAnnotationHistory(current, revisions)
	if err != nil {
		return err
	}

	existingCurrent, err := scanAnnotation(tx.tx.QueryRowContext(ctx, annotationSelect+
		`WHERE workspace_id = ? AND annotation_id = ?`, current.WorkspaceID, current.ID))
	if err == nil && !sameAnnotation(existingCurrent, current) {
		return fmt.Errorf("restore annotation current conflicts with existing row: %w", ErrConflict)
	}
	if err != nil && !errors.Is(err, ErrNotFound) {
		return fmt.Errorf("read existing annotation current: %w", err)
	}
	currentExists := err == nil

	existingRevisions, err := tx.annotationRevisionsByID(ctx, current.ID)
	if err != nil {
		return err
	}
	byRevision := make(map[int64]AnnotationRevision, len(ordered))
	existingByRevision := make(map[int64]AnnotationRevision, len(existingRevisions))
	for _, revision := range ordered {
		byRevision[revision.Revision] = revision
	}
	for _, existing := range existingRevisions {
		want, ok := byRevision[existing.Revision]
		if !ok || !sameAnnotationRevision(existing, want) {
			return fmt.Errorf("restore annotation history conflicts with existing revision %q: %w", existing.ID, ErrConflict)
		}
		existingByRevision[existing.Revision] = existing
	}
	if len(existingRevisions) > len(ordered) {
		return fmt.Errorf("restore annotation history has unexpected existing revisions: %w", ErrConflict)
	}

	if !currentExists {
		_, err = tx.tx.ExecContext(ctx, `
INSERT INTO annotations(
    annotation_id, workspace_id, subject_ref, kind, body, body_digest,
    revision, predecessor_revision, tombstoned, created_at_ns, updated_at_ns
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT DO NOTHING`,
			current.ID, current.WorkspaceID, current.SubjectRef, current.Kind,
			current.Body, current.BodyDigest, current.Revision,
			current.PredecessorRevision, boolInt(current.Tombstoned),
			current.CreatedAt.UTC().UnixNano(), current.UpdatedAt.UTC().UnixNano())
		if err != nil {
			return fmt.Errorf("insert restored annotation current: %w", err)
		}
		stored, readErr := scanAnnotation(tx.tx.QueryRowContext(ctx, annotationSelect+
			`WHERE workspace_id = ? AND annotation_id = ?`, current.WorkspaceID, current.ID))
		if readErr != nil {
			return fmt.Errorf("verify restored annotation current: %w", readErr)
		}
		if !sameAnnotation(stored, current) {
			return fmt.Errorf("restored annotation current conflicts with existing row: %w", ErrConflict)
		}
	}

	for _, revision := range ordered {
		if existing, ok := existingByRevision[revision.Revision]; ok && sameAnnotationRevision(existing, revision) {
			continue
		}
		if err := tx.insertAnnotationRevision(ctx, revision); err != nil {
			// insertAnnotationRevision reports a conflict when an identical
			// immutable row already exists. Read it back before deciding whether
			// this is an exact replay or a real identity collision.
			stored, readErr := tx.getAnnotationRevision(ctx, current.WorkspaceID, revision.ID)
			if readErr == nil && sameAnnotationRevision(stored, revision) {
				continue
			}
			return fmt.Errorf("insert restored annotation revision %q: %w", revision.ID, err)
		}
		stored, err := tx.getAnnotationRevision(ctx, current.WorkspaceID, revision.ID)
		if err != nil {
			return fmt.Errorf("verify restored annotation revision %q: %w", revision.ID, err)
		}
		if !sameAnnotationRevision(stored, revision) {
			return fmt.Errorf("restored annotation revision %q conflicts with existing row: %w", revision.ID, ErrConflict)
		}
	}
	return nil
}

func validateAnnotationHistory(current Annotation, revisions []AnnotationRevision) ([]AnnotationRevision, error) {
	if err := requireID("annotation id", current.ID); err != nil {
		return nil, err
	}
	if err := requireID("workspace id", current.WorkspaceID); err != nil {
		return nil, err
	}
	if err := requireID("subject ref", current.SubjectRef); err != nil {
		return nil, err
	}
	if current.Kind != AnnotationTag && current.Kind != AnnotationNote && current.Kind != AnnotationProgress {
		return nil, fmt.Errorf("invalid annotation kind %q", current.Kind)
	}
	if len(revisions) == 0 {
		return nil, errors.New("annotation history requires at least one retained revision")
	}
	if current.Revision < 1 || (!current.Tombstoned && strings.TrimSpace(current.Body) == "") || current.BodyDigest != digestText(current.Body) {
		return nil, errors.New("annotation current revision or body digest is invalid")
	}
	if current.CreatedAt.IsZero() || current.UpdatedAt.IsZero() {
		return nil, errors.New("annotation current timestamps are required")
	}

	ordered := append([]AnnotationRevision(nil), revisions...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Revision < ordered[j].Revision })
	var previous *AnnotationRevision
	for i := range ordered {
		revision := &ordered[i]
		if revision.Revision < 1 || revision.ID != annotationRevisionID(current.ID, revision.Revision) {
			return nil, fmt.Errorf("annotation revision id %q does not match its positive revision", revision.ID)
		}
		if revision.AnnotationID != current.ID || revision.WorkspaceID != current.WorkspaceID ||
			revision.SubjectRef != current.SubjectRef || revision.Kind != current.Kind {
			return nil, fmt.Errorf("annotation revision %q has mismatched scope", revision.ID)
		}
		if (!revision.Tombstoned && strings.TrimSpace(revision.Body) == "") || revision.BodyDigest != digestText(revision.Body) {
			return nil, fmt.Errorf("annotation revision %q has mismatched body digest", revision.ID)
		}
		if revision.CreatedAt.IsZero() {
			return nil, fmt.Errorf("annotation revision %q timestamp is required", revision.ID)
		}
		if i == 0 {
			if revision.Revision == 1 {
				if revision.PredecessorID != "" {
					return nil, fmt.Errorf("annotation revision 1 must have no predecessor")
				}
			} else if revision.PredecessorID != annotationRevisionID(current.ID, revision.Revision-1) || revision.HistoryComplete {
				return nil, fmt.Errorf("first retained annotation revision must identify its missing predecessor and be incomplete")
			}
		} else {
			if previous.Tombstoned {
				return nil, fmt.Errorf("annotation revision %q resurrects a tombstoned annotation", revision.ID)
			}
			if revision.PredecessorID != annotationRevisionID(current.ID, revision.Revision-1) {
				return nil, fmt.Errorf("annotation revision %q has invalid predecessor", revision.ID)
			}
			contiguous := revision.Revision == previous.Revision+1
			if revision.HistoryComplete && (!previous.HistoryComplete || !contiguous) {
				return nil, fmt.Errorf("annotation revision %q claims complete history across an incomplete or missing predecessor", revision.ID)
			}
		}
		if i > 0 && revision.Revision == previous.Revision {
			return nil, fmt.Errorf("duplicate annotation revision %d", revision.Revision)
		}
		previous = revision
	}
	if previous == nil || current.Revision != previous.Revision || current.Body != previous.Body ||
		current.BodyDigest != previous.BodyDigest || current.Tombstoned != previous.Tombstoned ||
		current.PredecessorRevision != previous.Revision-1 ||
		!sameTime(current.UpdatedAt, previous.CreatedAt) {
		return nil, errors.New("annotation current does not exactly bind the highest retained revision")
	}
	for _, revision := range ordered {
		if revision.Revision == 1 && !sameTime(current.CreatedAt, revision.CreatedAt) {
			return nil, errors.New("annotation current created time differs from revision 1")
		}
	}
	return ordered, nil
}

func (tx *Tx) annotationRevisionsByID(ctx context.Context, annotationID string) ([]AnnotationRevision, error) {
	rows, err := tx.tx.QueryContext(ctx, annotationRevisionSelect+`WHERE annotation_id = ? ORDER BY revision`, annotationID)
	if err != nil {
		return nil, fmt.Errorf("read existing annotation history: %w", err)
	}
	defer rows.Close()
	var records []AnnotationRevision
	for rows.Next() {
		record, err := scanAnnotationRevision(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate existing annotation history: %w", err)
	}
	return records, nil
}

func sameAnnotation(a, b Annotation) bool {
	return a.ID == b.ID && a.WorkspaceID == b.WorkspaceID && a.SubjectRef == b.SubjectRef &&
		a.Kind == b.Kind && a.Body == b.Body && a.BodyDigest == b.BodyDigest &&
		a.Revision == b.Revision && a.PredecessorRevision == b.PredecessorRevision &&
		a.Tombstoned == b.Tombstoned && sameTime(a.CreatedAt, b.CreatedAt) && sameTime(a.UpdatedAt, b.UpdatedAt)
}

func sameAnnotationRevision(a, b AnnotationRevision) bool {
	return a.ID == b.ID && a.AnnotationID == b.AnnotationID && a.WorkspaceID == b.WorkspaceID &&
		a.SubjectRef == b.SubjectRef && a.Kind == b.Kind && a.Body == b.Body &&
		a.BodyDigest == b.BodyDigest && a.Revision == b.Revision &&
		a.PredecessorID == b.PredecessorID && a.Tombstoned == b.Tombstoned &&
		a.HistoryComplete == b.HistoryComplete && sameTime(a.CreatedAt, b.CreatedAt)
}

func sameTime(a, b time.Time) bool { return a.UTC().UnixNano() == b.UTC().UnixNano() }
