package sqlite

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestRestoreAnnotationHistoryRoundTripAndReplay(t *testing.T) {
	for _, kind := range []AnnotationKind{AnnotationNote, AnnotationTag, AnnotationProgress} {
		t.Run(string(kind), func(t *testing.T) {
			ctx := context.Background()
			store := openTestStore(t, ":memory:")
			workspace := restoreAnnotationWorkspace(t, store)
			subject := testID(t, IDPrefixNamespaceEntry)
			annotationID := testID(t, IDPrefixAnnotation)
			current, revisions := restoreAnnotationChain(workspace.ID, subject, annotationID, kind)
			inputFirstID := revisions[0].ID
			// Reverse the caller's slice to prove validation sorts a private copy.
			revisions[0], revisions[2] = revisions[2], revisions[0]
			if err := store.Update(ctx, func(tx *Tx) error {
				return tx.RestoreAnnotationHistory(ctx, current, revisions)
			}); err != nil {
				t.Fatalf("restore complete history: %v", err)
			}
			if revisions[0].ID != annotationRevisionID(annotationID, 3) || inputFirstID != annotationRevisionID(annotationID, 1) {
				t.Fatalf("RestoreAnnotationHistory changed caller order: %+v", revisions)
			}
			got, err := store.GetAnnotation(ctx, workspace.ID, annotationID)
			if err != nil || !sameAnnotation(got, current) {
				t.Fatalf("current = %+v, err=%v", got, err)
			}
			gotRevisions, err := store.ListAnnotationRevisions(ctx, workspace.ID, subject)
			if err != nil || len(gotRevisions) != 3 {
				t.Fatalf("revisions = %+v, err=%v", gotRevisions, err)
			}
			for i, want := range []AnnotationRevision{revisions[2], revisions[1], revisions[0]} {
				if !sameAnnotationRevision(gotRevisions[i], want) {
					t.Fatalf("revision[%d] = %+v, want %+v", i, gotRevisions[i], want)
				}
			}
			if err := store.Update(ctx, func(tx *Tx) error {
				return tx.RestoreAnnotationHistory(ctx, current, revisions)
			}); err != nil {
				t.Fatalf("exact replay: %v", err)
			}
			gotRevisions, err = store.ListAnnotationRevisions(ctx, workspace.ID, subject)
			if err != nil || len(gotRevisions) != 3 {
				t.Fatalf("replayed revisions = %+v, err=%v", gotRevisions, err)
			}
		})
	}
}

func TestRestoreAnnotationHistoryPreservesIncompleteGap(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, ":memory:")
	workspace := restoreAnnotationWorkspace(t, store)
	subject := testID(t, IDPrefixNamespaceEntry)
	annotationID := testID(t, IDPrefixAnnotation)
	current, complete := restoreAnnotationChain(workspace.ID, subject, annotationID, AnnotationNote)
	incomplete := []AnnotationRevision{complete[0], complete[2]}
	incomplete[1].HistoryComplete = false
	incomplete[1].Tombstoned = false
	current.Revision = incomplete[1].Revision
	current.Body = incomplete[1].Body
	current.BodyDigest = incomplete[1].BodyDigest
	current.Tombstoned = false
	current.PredecessorRevision = incomplete[1].Revision - 1
	current.UpdatedAt = incomplete[1].CreatedAt
	if err := store.Update(ctx, func(tx *Tx) error {
		return tx.RestoreAnnotationHistory(ctx, current, incomplete)
	}); err != nil {
		t.Fatalf("restore incomplete retained history: %v", err)
	}
	got, err := store.ListAnnotationRevisions(ctx, workspace.ID, subject)
	if err != nil || len(got) != 2 {
		t.Fatalf("retained revisions = %+v, err=%v", got, err)
	}
	if got[1].Revision != 3 || got[1].PredecessorID != annotationRevisionID(annotationID, 2) || got[1].HistoryComplete {
		t.Fatalf("incomplete gap was not preserved honestly: %+v", got)
	}
}

func TestRestoreAnnotationHistoryPreservesAuthenticatedIncompleteFlag(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, ":memory:")
	workspace := restoreAnnotationWorkspace(t, store)
	subject := testID(t, IDPrefixNamespaceEntry)
	annotationID := testID(t, IDPrefixAnnotation)
	current, revisions := restoreAnnotationChain(workspace.ID, subject, annotationID, AnnotationNote)
	revisions[0].HistoryComplete = false
	revisions[1].HistoryComplete = false
	revisions[2].HistoryComplete = false
	if err := store.Update(ctx, func(tx *Tx) error {
		return tx.RestoreAnnotationHistory(ctx, current, revisions)
	}); err != nil {
		t.Fatalf("restore authenticated incomplete flags: %v", err)
	}
	got, err := store.ListAnnotationRevisions(ctx, workspace.ID, subject)
	if err != nil || len(got) != 3 {
		t.Fatalf("retained revisions = %+v, err=%v", got, err)
	}
	for _, revision := range got {
		if revision.HistoryComplete {
			t.Fatalf("authenticated incomplete flag was rewritten: %+v", revision)
		}
	}

	_, dishonest := restoreAnnotationChain(workspace.ID, testID(t, IDPrefixNamespaceEntry), testID(t, IDPrefixAnnotation), AnnotationNote)
	dishonest[1].HistoryComplete = false
	if err := store.Update(ctx, func(tx *Tx) error {
		return tx.RestoreAnnotationHistory(ctx, func() Annotation {
			current, _ := restoreAnnotationChain(workspace.ID, dishonest[0].SubjectRef, dishonest[0].AnnotationID, AnnotationNote)
			return current
		}(), dishonest)
	}); err == nil {
		t.Fatal("complete flag was accepted after an incomplete predecessor")
	}
}

func TestRestoreAnnotationHistoryAcceptsEmptyTombstoneBodies(t *testing.T) {
	for _, body := range []string{"", "   "} {
		t.Run(fmt.Sprintf("body-%d", len(body)), func(t *testing.T) {
			ctx := context.Background()
			store := openTestStore(t, ":memory:")
			workspace := restoreAnnotationWorkspace(t, store)
			subject := testID(t, IDPrefixNamespaceEntry)
			annotationID := testID(t, IDPrefixAnnotation)
			current, revisions := restoreAnnotationChain(workspace.ID, subject, annotationID, AnnotationNote)
			revisions[2].Body = body
			revisions[2].BodyDigest = digestText(body)
			current.Body = body
			current.BodyDigest = digestText(body)
			if err := store.Update(ctx, func(tx *Tx) error {
				return tx.RestoreAnnotationHistory(ctx, current, revisions)
			}); err != nil {
				t.Fatalf("restore tombstone body %q: %v", body, err)
			}
			got, err := store.GetAnnotation(ctx, workspace.ID, annotationID)
			if err != nil || got.Body != body || got.BodyDigest != digestText(body) || !got.Tombstoned {
				t.Fatalf("tombstone projection = %+v, err=%v", got, err)
			}
		})
	}
}

func TestRestoreAnnotationHistoryRoundTripsRealWriterOutput(t *testing.T) {
	ctx := context.Background()
	source := openTestStore(t, ":memory:")
	workspace := restoreAnnotationWorkspace(t, source)
	annotation := Annotation{
		ID:          testID(t, IDPrefixAnnotation),
		WorkspaceID: workspace.ID,
		SubjectRef:  testID(t, IDPrefixNamespaceEntry),
		Kind:        AnnotationNote,
		Body:        "  first line\nsecond line\t ",
		Revision:    1,
	}
	if err := source.CreateAnnotation(ctx, &annotation); err != nil {
		t.Fatalf("CreateAnnotation: %v", err)
	}
	secondBody := "\n  revised note\nwith a trailing tab\t"
	if err := source.ReviseAnnotation(ctx, workspace.ID, annotation.ID, 1, secondBody, false, testEpoch.Add(time.Second)); err != nil {
		t.Fatalf("revise annotation: %v", err)
	}
	if err := source.ReviseAnnotation(ctx, workspace.ID, annotation.ID, 2, "", true, testEpoch.Add(2*time.Second)); err != nil {
		t.Fatalf("tombstone annotation with empty body: %v", err)
	}
	wantCurrent, err := source.GetAnnotation(ctx, workspace.ID, annotation.ID)
	if err != nil {
		t.Fatal(err)
	}
	wantHistory, err := source.ListAnnotationRevisions(ctx, workspace.ID, annotation.SubjectRef)
	if err != nil || len(wantHistory) != 3 {
		t.Fatalf("source history = %+v, err=%v", wantHistory, err)
	}

	fresh := openTestStore(t, ":memory:")
	if err := fresh.Update(ctx, func(tx *Tx) error {
		return tx.InsertWorkspace(ctx, &Workspace{ID: workspace.ID, Name: workspace.Name})
	}); err != nil {
		t.Fatalf("create fresh workspace projection: %v", err)
	}
	if err := fresh.Update(ctx, func(tx *Tx) error {
		return tx.RestoreAnnotationHistory(ctx, wantCurrent, append([]AnnotationRevision(nil), wantHistory...))
	}); err != nil {
		t.Fatalf("restore real writer output: %v", err)
	}
	gotCurrent, err := fresh.GetAnnotation(ctx, workspace.ID, annotation.ID)
	if err != nil || !sameAnnotation(gotCurrent, wantCurrent) {
		t.Fatalf("restored current = %+v, want %+v, err=%v", gotCurrent, wantCurrent, err)
	}
	gotHistory, err := fresh.ListAnnotationRevisions(ctx, workspace.ID, annotation.SubjectRef)
	if err != nil || len(gotHistory) != len(wantHistory) {
		t.Fatalf("restored history = %+v, err=%v", gotHistory, err)
	}
	for i := range wantHistory {
		if !sameAnnotationRevision(gotHistory[i], wantHistory[i]) {
			t.Fatalf("restored revision[%d] = %+v, want %+v", i, gotHistory[i], wantHistory[i])
		}
	}
}

func TestRestoreAnnotationHistoryRejectsInvalidInputWithoutWrites(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Annotation, []AnnotationRevision)
	}{
		{"bad-current-digest", func(c *Annotation, _ []AnnotationRevision) { c.BodyDigest = "sha256:bad" }},
		{"bad-revision-digest", func(_ *Annotation, r []AnnotationRevision) { r[1].BodyDigest = "sha256:bad" }},
		{"bad-revision-id", func(_ *Annotation, r []AnnotationRevision) { r[1].ID = "wrong@2" }},
		{"bad-predecessor", func(_ *Annotation, r []AnnotationRevision) { r[1].PredecessorID = "wrong@1" }},
		{"scope-mismatch", func(_ *Annotation, r []AnnotationRevision) { r[1].SubjectRef = testID(t, IDPrefixNamespaceEntry) }},
		{"history-flag-mismatch", func(_ *Annotation, r []AnnotationRevision) { r[1].HistoryComplete = false }},
		{"tombstone-resurrection", func(_ *Annotation, r []AnnotationRevision) { r[1].Tombstoned = true }},
		{"current-updated-time-mismatch", func(c *Annotation, _ []AnnotationRevision) { c.UpdatedAt = c.UpdatedAt.Add(time.Second) }},
		{"current-predecessor-mismatch", func(c *Annotation, _ []AnnotationRevision) { c.PredecessorRevision = 0 }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			store := openTestStore(t, ":memory:")
			workspace := restoreAnnotationWorkspace(t, store)
			subject := testID(t, IDPrefixNamespaceEntry)
			annotationID := testID(t, IDPrefixAnnotation)
			current, revisions := restoreAnnotationChain(workspace.ID, subject, annotationID, AnnotationNote)
			revisions = append([]AnnotationRevision(nil), revisions...)
			test.mutate(&current, revisions)
			if err := store.Update(ctx, func(tx *Tx) error {
				return tx.RestoreAnnotationHistory(ctx, current, revisions)
			}); err == nil {
				t.Fatal("invalid history was accepted")
			}
			if _, err := store.GetAnnotation(ctx, workspace.ID, annotationID); !errors.Is(err, ErrNotFound) {
				t.Fatalf("current after rejection = %v, want absent", err)
			}
			got, err := store.ListAnnotationRevisions(ctx, workspace.ID, subject)
			if err != nil || len(got) != 0 {
				t.Fatalf("history after rejection = %+v, err=%v", got, err)
			}
		})
	}
}

func TestRestoreAnnotationHistoryRejectsConflictsAndRollsBack(t *testing.T) {
	ctx := context.Background()
	t.Run("different-current", func(t *testing.T) {
		store := openTestStore(t, ":memory:")
		workspace := restoreAnnotationWorkspace(t, store)
		subject := testID(t, IDPrefixNamespaceEntry)
		annotationID := testID(t, IDPrefixAnnotation)
		current, revisions := restoreAnnotationChain(workspace.ID, subject, annotationID, AnnotationProgress)
		seed := Annotation{ID: annotationID, WorkspaceID: workspace.ID, SubjectRef: subject, Kind: AnnotationProgress,
			Body: "different existing", Revision: 1, CreatedAt: revisions[0].CreatedAt, UpdatedAt: revisions[0].CreatedAt}
		if err := store.CreateAnnotation(ctx, &seed); err != nil {
			t.Fatal(err)
		}
		if err := store.Update(ctx, func(tx *Tx) error { return tx.RestoreAnnotationHistory(ctx, current, revisions) }); !errors.Is(err, ErrConflict) {
			t.Fatalf("conflicting current error = %v", err)
		}
		got, err := store.GetAnnotation(ctx, workspace.ID, annotationID)
		if err != nil || got.Body != seed.Body {
			t.Fatalf("existing current changed: %+v, %v", got, err)
		}
	})

	t.Run("transaction-rolls-back-partial-insert", func(t *testing.T) {
		store := openTestStore(t, ":memory:")
		workspace := restoreAnnotationWorkspace(t, store)
		subject := testID(t, IDPrefixNamespaceEntry)
		annotationID := testID(t, IDPrefixAnnotation)
		current, revisions := restoreAnnotationChain(workspace.ID, subject, annotationID, AnnotationNote)
		revisions = revisions[:2]
		current.Revision = 2
		current.Body = revisions[1].Body
		current.BodyDigest = revisions[1].BodyDigest
		current.PredecessorRevision = 1
		current.Tombstoned = false
		current.UpdatedAt = revisions[1].CreatedAt
		if _, err := store.db.Exec(`CREATE TRIGGER fail_restore_revision BEFORE INSERT ON annotation_revisions
WHEN NEW.annotation_id = '` + annotationID + `' AND NEW.revision = 2
BEGIN SELECT RAISE(ABORT, 'injected restore failure'); END`); err != nil {
			t.Fatal(err)
		}
		err := store.Update(ctx, func(tx *Tx) error { return tx.RestoreAnnotationHistory(ctx, current, revisions) })
		if err == nil {
			t.Fatal("injected insert failure was not returned")
		}
		if _, err := store.GetAnnotation(ctx, workspace.ID, annotationID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("current after rollback = %v, want absent", err)
		}
		got, err := store.ListAnnotationRevisions(ctx, workspace.ID, subject)
		if err != nil || len(got) != 0 {
			t.Fatalf("history after rollback = %+v, err=%v", got, err)
		}
	})
}

func restoreAnnotationWorkspace(t *testing.T, store *Store) Workspace {
	t.Helper()
	workspace := Workspace{ID: testID(t, IDPrefixWorkspace), Name: "annotation recovery"}
	if err := store.Update(context.Background(), func(tx *Tx) error { return tx.InsertWorkspace(context.Background(), &workspace) }); err != nil {
		t.Fatalf("insert workspace: %v", err)
	}
	return workspace
}

func restoreAnnotationChain(workspaceID, subject, annotationID string, kind AnnotationKind) (Annotation, []AnnotationRevision) {
	base := testEpoch.Add(time.Hour)
	texts := []string{"first body", "second body", "second body"}
	complete := []AnnotationRevision{
		{ID: annotationRevisionID(annotationID, 1), AnnotationID: annotationID, WorkspaceID: workspaceID, SubjectRef: subject, Kind: kind,
			Body: texts[0], BodyDigest: digestText(texts[0]), Revision: 1, HistoryComplete: true, CreatedAt: base},
		{ID: annotationRevisionID(annotationID, 2), AnnotationID: annotationID, WorkspaceID: workspaceID, SubjectRef: subject, Kind: kind,
			Body: texts[1], BodyDigest: digestText(texts[1]), Revision: 2, PredecessorID: annotationRevisionID(annotationID, 1), HistoryComplete: true, CreatedAt: base.Add(time.Second)},
		{ID: annotationRevisionID(annotationID, 3), AnnotationID: annotationID, WorkspaceID: workspaceID, SubjectRef: subject, Kind: kind,
			Body: texts[2], BodyDigest: digestText(texts[2]), Revision: 3, PredecessorID: annotationRevisionID(annotationID, 2), Tombstoned: true, HistoryComplete: true, CreatedAt: base.Add(2 * time.Second)},
	}
	current := Annotation{ID: annotationID, WorkspaceID: workspaceID, SubjectRef: subject, Kind: kind,
		Body: texts[2], BodyDigest: digestText(texts[2]), Revision: 3, PredecessorRevision: 2,
		Tombstoned: true, CreatedAt: base, UpdatedAt: base.Add(2 * time.Second)}
	return current, complete
}
