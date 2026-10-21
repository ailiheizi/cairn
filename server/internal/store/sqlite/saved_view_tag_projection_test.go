package sqlite

import (
	"context"
	"testing"
)

func TestListSavedViewTagFactsReturnsOnlyRequestedLiveTAGMetadata(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, ":memory:")
	workspace := Workspace{ID: testID(t, IDPrefixWorkspace), Name: "Saved view tags"}
	if err := store.Update(ctx, func(tx *Tx) error { return tx.InsertWorkspace(ctx, &workspace) }); err != nil {
		t.Fatal(err)
	}
	subject := testID(t, IDPrefixNamespaceEntry)
	tag := &Annotation{ID: testID(t, IDPrefixAnnotation), WorkspaceID: workspace.ID, SubjectRef: subject, Kind: AnnotationTag, Body: `出门 = "先"`, Revision: 1}
	if err := store.CreateAnnotation(ctx, tag); err != nil {
		t.Fatal(err)
	}
	note := &Annotation{ID: testID(t, IDPrefixAnnotation), WorkspaceID: workspace.ID, SubjectRef: subject, Kind: AnnotationNote, Body: "private note body", Revision: 1}
	if err := store.CreateAnnotation(ctx, note); err != nil {
		t.Fatal(err)
	}
	other := &Annotation{ID: testID(t, IDPrefixAnnotation), WorkspaceID: workspace.ID, SubjectRef: subject, Kind: AnnotationTag, Body: "unrequested", Revision: 1}
	if err := store.CreateAnnotation(ctx, other); err != nil {
		t.Fatal(err)
	}
	facts, err := store.ListSavedViewTagFacts(ctx, workspace.ID, []string{tag.Body})
	if err != nil {
		t.Fatal(err)
	}
	if len(facts) != 1 || facts[0].AnnotationID != tag.ID || facts[0].SubjectRef != subject || facts[0].Body != tag.Body || facts[0].Revision != 1 {
		t.Fatalf("requested TAG facts = %+v", facts)
	}
	if err := store.ReviseAnnotation(ctx, workspace.ID, tag.ID, 1, tag.Body, true, testEpoch); err != nil {
		t.Fatal(err)
	}
	facts, err = store.ListSavedViewTagFacts(ctx, workspace.ID, []string{tag.Body})
	if err != nil || len(facts) != 0 {
		t.Fatalf("tombstoned TAG facts = %+v, %v; want empty", facts, err)
	}
	empty, err := store.ListSavedViewTagFacts(ctx, workspace.ID, nil)
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty requested TAG projection = %+v, %v", empty, err)
	}
}
