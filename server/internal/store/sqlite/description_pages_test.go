package sqlite

import (
	"context"
	"path/filepath"
	"testing"
)

func TestDescriptionSummaryPageUsesWholeChainAndStableKeyset(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	defer store.Close()
	workspace := Workspace{ID: testID(t, IDPrefixWorkspace), Name: "description pages"}
	if err := store.Update(ctx, func(tx *Tx) error { return tx.InsertWorkspace(ctx, &workspace) }); err != nil {
		t.Fatal(err)
	}
	subject := testID(t, IDPrefixNamespaceEntry)
	const count = 1003
	ids := make([]string, count)
	for i := range ids {
		ids[i] = testID(t, IDPrefixDescription)
	}
	if err := store.Update(ctx, func(tx *Tx) error {
		for i, id := range ids {
			predecessor := ""
			if i > 0 {
				predecessor = ids[i-1]
			}
			document := &DescriptionDocument{
				ID: id, WorkspaceID: workspace.ID, SubjectRef: subject,
				Kind: DescriptionUser, Body: "revision body", Revision: int64(i + 1),
				PredecessorID: predecessor,
			}
			if err := tx.InsertDescriptionDocument(ctx, document); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	first, err := store.ListDescriptionSummaryPage(ctx, workspace.ID, "", false, 1000, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Total != count || len(first.Documents) != 1000 || !first.HasMore || first.ProjectionRef == "" {
		t.Fatalf("first page total=%d returned=%d hasMore=%t projection=%q", first.Total, len(first.Documents), first.HasMore, first.ProjectionRef)
	}
	if first.Documents[0].Revision != 1 || first.Documents[999].Revision != 1000 {
		t.Fatalf("first page revisions = %d..%d", first.Documents[0].Revision, first.Documents[999].Revision)
	}
	second, err := store.ListDescriptionSummaryPage(ctx, workspace.ID, "", false, 1000, &first.Next)
	if err != nil {
		t.Fatal(err)
	}
	if second.Total != count || second.HasMore || len(second.Documents) != 3 || second.Documents[0].Revision != 1001 || second.Documents[2].Revision != count {
		t.Fatalf("second page total=%d rows=%d range=%v..%v hasMore=%t", second.Total, len(second.Documents), revisionAt(second.Documents, 0), revisionAt(second.Documents, len(second.Documents)-1), second.HasMore)
	}
	if first.Documents[len(first.Documents)-1].ID == second.Documents[0].ID {
		t.Fatal("keyset pages repeated a description")
	}

	current, err := store.ListDescriptionSummaryPage(ctx, workspace.ID, subject, true, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	if current.Total != 1 || len(current.Documents) != 1 || current.Documents[0].Revision != count || current.HasMore {
		t.Fatalf("current projection did not inspect the full chain: total=%d rows=%+v hasMore=%t", current.Total, current.Documents, current.HasMore)
	}
	boundedCurrent, err := store.ListCurrentDescriptionSummaries(ctx, workspace.ID, subject, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(boundedCurrent) != 1 || boundedCurrent[0].Revision != count {
		t.Fatalf("bounded current projection = %+v", boundedCurrent)
	}

	before := current.ProjectionRef
	if err := store.InsertDescriptionDocument(ctx, &DescriptionDocument{
		ID: testID(t, IDPrefixDescription), WorkspaceID: workspace.ID,
		SubjectRef: subject, Kind: DescriptionUser, Body: "new current leaf", Revision: 1,
	}); err != nil {
		t.Fatal(err)
	}
	after, err := store.ListDescriptionSummaryPage(ctx, workspace.ID, subject, true, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	if before == after.ProjectionRef || after.Total != 2 {
		t.Fatalf("projection did not change with visible summary: before=%s after=%s total=%d", before, after.ProjectionRef, after.Total)
	}
}

func revisionAt(documents []DescriptionDocument, index int) any {
	if index < 0 || index >= len(documents) {
		return "<none>"
	}
	return documents[index].Revision
}
