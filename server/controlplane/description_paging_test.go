package controlplane

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

func TestDescriptionListPagesCurrentProjectionAndRejectsStaleTokens(t *testing.T) {
	dispatcher, store := newTestDispatcher(t)
	seed := testutil.SeedNamespace(t, store)
	ctx := context.Background()
	const count = 1003
	ids := make([]string, count)
	for i := range ids {
		id, err := sqlite.NewStableID(sqlite.IDPrefixDescription)
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = id
	}
	if err := store.Update(ctx, func(tx *sqlite.Tx) error {
		for i, id := range ids {
			predecessor := ""
			if i > 0 {
				predecessor = ids[i-1]
			}
			if err := tx.InsertDescriptionDocument(ctx, &sqlite.DescriptionDocument{
				ID: id, WorkspaceID: seed.WorkspaceID, SubjectRef: seed.FileEntryID,
				Kind: sqlite.DescriptionUser, Body: fmt.Sprintf("revision %d", i+1),
				Revision: int64(i + 1), PredecessorID: predecessor,
			}); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	otherWorkspace, err := sqlite.NewStableID(sqlite.IDPrefixWorkspace)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Update(ctx, func(tx *sqlite.Tx) error {
		return tx.InsertWorkspace(ctx, &sqlite.Workspace{ID: otherWorkspace, Name: "other workspace"})
	}); err != nil {
		t.Fatal(err)
	}

	first := dispatchDescriptionPage(t, dispatcher, map[string]any{
		"workspace_id": seed.WorkspaceID,
		"page":         map[string]any{"limit": 1000},
	})
	if len(first.Documents) != 1000 || first.Page == nil || !first.Page.HasMore || first.Page.Truncated || !first.Truncated || first.Page.Entries == nil || *first.Page.Entries != count || first.Page.Token == "" {
		t.Fatalf("first history page = %+v", first)
	}
	if first.WorkspaceID != seed.WorkspaceID || first.CurrentOnly == nil || *first.CurrentOnly || first.Page.Mode != command.PageModePage || first.Page.Lane != "description-list" || first.Page.Order != "subject_ref,revision,description_document_id" {
		t.Fatalf("page identity/bounds = %+v", first)
	}
	if first.Documents[0].Revision != 1 || first.Documents[999].Revision != 1000 {
		t.Fatalf("first page revisions = %d..%d", first.Documents[0].Revision, first.Documents[999].Revision)
	}
	second := dispatchDescriptionPage(t, dispatcher, map[string]any{
		"workspace_id": seed.WorkspaceID,
		"page":         map[string]any{"limit": 2, "token": first.Page.Token},
	})
	if len(second.Documents) != 2 || second.Page == nil || !second.Page.HasMore || second.Page.Truncated || second.Page.Token == "" || second.Documents[0].Revision != 1001 || second.Documents[1].Revision != 1002 {
		t.Fatalf("second history page = %+v", second)
	}
	third := dispatchDescriptionPage(t, dispatcher, map[string]any{
		"workspace_id": seed.WorkspaceID,
		"page":         map[string]any{"token": second.Page.Token},
	})
	if len(third.Documents) != 1 || third.Page == nil || third.Page.Limit != 200 || third.Page.HasMore || third.Page.Token != "" || third.Documents[0].Revision != count {
		t.Fatalf("third history page = %+v", third)
	}

	current := dispatchDescriptionPage(t, dispatcher, map[string]any{
		"workspace_id": seed.WorkspaceID, "subject_ref": seed.FileEntryID,
		"current_only": true, "page": map[string]any{"limit": 10},
	})
	if len(current.Documents) != 1 || current.Documents[0].Revision != count || current.Page == nil || current.Page.Entries == nil || *current.Page.Entries != 1 || !current.Page.Complete || current.Truncated {
		t.Fatalf("current-only page = %+v", current)
	}
	bounded := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionList, map[string]any{
		"workspace_id": seed.WorkspaceID, "subject_ref": seed.FileEntryID,
		"current_only": true, "limit": 1,
	}))
	if bounded.Status != command.StatusSucceeded {
		t.Fatalf("bounded current-only list status=%q reasons=%+v", bounded.Status, bounded.Reasons)
	}
	var boundedData command.DescriptionListData
	if err := json.Unmarshal(bounded.Data, &boundedData); err != nil {
		t.Fatal(err)
	}
	if len(boundedData.Documents) != 1 || boundedData.Documents[0].Revision != count || boundedData.Truncated || boundedData.CurrentOnly == nil || !*boundedData.CurrentOnly {
		t.Fatalf("bounded current-only result = %+v", boundedData)
	}
	// Current-only paging must not cap the projection at the historical
	// revision scan prefix. Add enough independent leaf documents to cross the
	// page boundary while retaining the existing long revision chain above.
	const additionalLeaves = 1001
	leafIDs := make([]string, additionalLeaves)
	for i := range leafIDs {
		leafIDs[i], err = sqlite.NewStableID(sqlite.IDPrefixDescription)
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Update(ctx, func(tx *sqlite.Tx) error {
		for i, id := range leafIDs {
			if err := tx.InsertDescriptionDocument(ctx, &sqlite.DescriptionDocument{
				ID: id, WorkspaceID: seed.WorkspaceID, SubjectRef: seed.FileEntryID,
				Kind: sqlite.DescriptionUser, Body: fmt.Sprintf("independent leaf %d", i), Revision: 1,
			}); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	leafFirst := dispatchDescriptionPage(t, dispatcher, map[string]any{
		"workspace_id": seed.WorkspaceID, "subject_ref": seed.FileEntryID,
		"current_only": true, "page": map[string]any{"limit": 1000},
	})
	const expectedCurrentLeaves = additionalLeaves + 1 // the extra roots plus the original chain's head
	if len(leafFirst.Documents) != 1000 || leafFirst.Page == nil || leafFirst.Page.Entries == nil || *leafFirst.Page.Entries != expectedCurrentLeaves || !leafFirst.Page.HasMore || leafFirst.Page.Token == "" {
		t.Fatalf("first current-leaf page = %+v", leafFirst)
	}
	seenLeafIDs := make(map[string]struct{}, expectedCurrentLeaves)
	for _, document := range leafFirst.Documents {
		if _, duplicate := seenLeafIDs[document.ID]; duplicate {
			t.Fatalf("duplicate current leaf on first page: %s", document.ID)
		}
		seenLeafIDs[document.ID] = struct{}{}
	}
	leafSecond := dispatchDescriptionPage(t, dispatcher, map[string]any{
		"workspace_id": seed.WorkspaceID, "subject_ref": seed.FileEntryID,
		"current_only": true, "page": map[string]any{"token": leafFirst.Page.Token},
	})
	if len(leafSecond.Documents) != expectedCurrentLeaves-1000 || leafSecond.Page == nil || leafSecond.Page.Entries == nil || *leafSecond.Page.Entries != expectedCurrentLeaves || leafSecond.Page.HasMore || leafSecond.Page.Token != "" {
		t.Fatalf("second current-leaf page = %+v", leafSecond)
	}
	for _, document := range leafSecond.Documents {
		if _, duplicate := seenLeafIDs[document.ID]; duplicate {
			t.Fatalf("current leaf repeated across pages: %s", document.ID)
		}
		seenLeafIDs[document.ID] = struct{}{}
	}
	if len(seenLeafIDs) != expectedCurrentLeaves {
		t.Fatalf("current leaf pages returned %d unique documents, want %d", len(seenLeafIDs), expectedCurrentLeaves)
	}
	legacy := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionList, map[string]any{
		"workspace_id": seed.WorkspaceID, "limit": 1,
	}))
	if legacy.Status != command.StatusSucceeded {
		t.Fatalf("legacy description.list status=%q reasons=%+v", legacy.Status, legacy.Reasons)
	}
	var legacyShape map[string]json.RawMessage
	if err := json.Unmarshal(legacy.Data, &legacyShape); err != nil {
		t.Fatal(err)
	}
	if len(legacyShape) != 2 || legacyShape["documents"] == nil || legacyShape["truncated"] == nil {
		t.Fatalf("legacy description.list shape changed: %s", legacy.Data)
	}

	pageForRefusal := dispatchDescriptionPage(t, dispatcher, map[string]any{
		"workspace_id": seed.WorkspaceID, "subject_ref": seed.FileEntryID,
		"page": map[string]any{"limit": 1},
	})
	if pageForRefusal.Page == nil || pageForRefusal.Page.Token == "" {
		t.Fatalf("expected token for refusal checks: %+v", pageForRefusal)
	}
	for name, input := range map[string]map[string]any{
		"cross subject":         {"workspace_id": seed.WorkspaceID, "subject_ref": seed.DirEntryID, "page": map[string]any{"limit": 1, "token": pageForRefusal.Page.Token}},
		"cross workspace":       {"workspace_id": otherWorkspace, "page": map[string]any{"limit": 1, "token": pageForRefusal.Page.Token}},
		"legacy limit conflict": {"workspace_id": seed.WorkspaceID, "limit": 2, "page": map[string]any{"limit": 1}},
		"zero legacy conflict":  {"workspace_id": seed.WorkspaceID, "limit": 0, "page": map[string]any{"limit": 1}},
		"zero page limit":       {"workspace_id": seed.WorkspaceID, "page": map[string]any{"limit": 0}},
		"oversized page limit":  {"workspace_id": seed.WorkspaceID, "page": map[string]any{"limit": 1001}},
		"tampered token":        {"workspace_id": seed.WorkspaceID, "subject_ref": seed.FileEntryID, "page": map[string]any{"limit": 1, "token": tamperDescriptionPagingToken(pageForRefusal.Page.Token)}},
	} {
		result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionList, input))
		if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeInvalidInput) {
			t.Errorf("%s status=%q reasons=%+v", name, result.Status, result.Reasons)
		}
	}
	staleTokenData := dispatchDescriptionPage(t, dispatcher, map[string]any{
		"workspace_id": seed.WorkspaceID,
		"page":         map[string]any{"limit": 1},
	})
	if staleTokenData.Page == nil || staleTokenData.Page.Token == "" {
		t.Fatalf("expected unscoped stale token: %+v", staleTokenData)
	}
	// A different row changes the complete projection and invalidates a cursor
	// even when the old prefix itself is unchanged.
	newID, err := sqlite.NewStableID(sqlite.IDPrefixDescription)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InsertDescriptionDocument(ctx, &sqlite.DescriptionDocument{
		ID: newID, WorkspaceID: seed.WorkspaceID, SubjectRef: seed.DirEntryID,
		Kind: sqlite.DescriptionUser, Body: "new projection row",
	}); err != nil {
		t.Fatal(err)
	}
	stale := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionList, map[string]any{
		"workspace_id": seed.WorkspaceID,
		"page":         map[string]any{"limit": 1, "token": staleTokenData.Page.Token},
	}))
	if stale.Status != command.StatusFailed || !hasReasonCode(stale, ReasonCodeInvalidInput) {
		t.Fatalf("stale token status=%q reasons=%+v", stale.Status, stale.Reasons)
	}
}

func dispatchDescriptionPage(t *testing.T, dispatcher *Dispatcher, input map[string]any) command.DescriptionListData {
	t.Helper()
	result := dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpDescriptionList, input))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("description.list status=%q reasons=%+v", result.Status, result.Reasons)
	}
	if strings.Contains(string(result.Data), `"body":`) || strings.Contains(string(result.Data), `"segments":`) {
		t.Fatalf("description summary page leaked body or segments: %s", result.Data)
	}
	var data command.DescriptionListData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	return data
}

func tamperDescriptionPagingToken(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) != 2 || len(parts[0]) < 2 {
		return token + "x"
	}
	if parts[0][1] == 'A' {
		parts[0] = parts[0][:1] + "B" + parts[0][2:]
	} else {
		parts[0] = parts[0][:1] + "A" + parts[0][2:]
	}
	return strings.Join(parts, ".")
}

func TestDescriptionPagingPositionDecoderIsStrict(t *testing.T) {
	subject, err := sqlite.NewStableID(sqlite.IDPrefixNamespaceEntry)
	if err != nil {
		t.Fatal(err)
	}
	documentID, err := sqlite.NewStableID(sqlite.IDPrefixDescription)
	if err != nil {
		t.Fatal(err)
	}
	valid, err := json.Marshal(descriptionPagePosition{SubjectRef: subject, Revision: 7, DocumentID: documentID})
	if err != nil {
		t.Fatal(err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(valid)
	position, err := decodeDescriptionPagePosition(encoded)
	if err != nil || position.SubjectRef != subject || position.Revision != 7 || position.DocumentID != documentID {
		t.Fatalf("valid cursor position = %+v, %v", position, err)
	}
	for name, raw := range map[string][]byte{
		"unknown field":    []byte(strings.TrimSuffix(string(valid), "}") + `,"path":"private"}`),
		"trailing value":   append(append([]byte(nil), valid...), []byte(` {}`)...),
		"invalid revision": []byte(fmt.Sprintf(`{"subject_ref":%q,"revision":0,"description_document_id":%q}`, subject, documentID)),
		"invalid ids":      []byte(`{"subject_ref":"not-an-id","revision":1,"description_document_id":"also-not-an-id"}`),
	} {
		if _, err := decodeDescriptionPagePosition(base64.RawURLEncoding.EncodeToString(raw)); err == nil {
			t.Errorf("%s cursor position was accepted", name)
		}
	}
}
