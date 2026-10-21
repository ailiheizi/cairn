package controlplane

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestSavedViewPagingStreamsEligibleExactTagAndStructuredResults(t *testing.T) {
	const count = 1005
	root := t.TempDir()
	for i := 0; i < count; i++ {
		name := fmt.Sprintf("eligible-%04d.txt", i)
		if err := os.WriteFile(filepath.Join(root, name), []byte("ordinary eligible record"), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	h, entries := openViewExportHarness(t, root, true)
	if len(entries) != count {
		t.Fatalf("ingested files = %d, want %d", len(entries), count)
	}
	expectedLengths := make(map[string]int64, len(entries))
	for _, entry := range entries {
		if entry.EntryType != string(sqlite.EntryFile) || entry.LogicalSize == nil || *entry.LogicalSize < 0 {
			t.Fatalf("fixture entry %q lacks a known regular-file length: %+v", entry.DisplayName, entry)
		}
		expectedLengths[entry.SubjectRef] = *entry.LogicalSize
	}
	ctx := context.Background()
	const tag = "  daily = \"ready\"  "
	annotationIDs := make(map[string]string, len(entries))
	if err := h.dispatcher.store.Update(ctx, func(tx *sqlite.Tx) error {
		for _, entry := range entries {
			id, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
			if err != nil {
				return err
			}
			record := &sqlite.Annotation{
				ID: id, WorkspaceID: h.ingest.WorkspaceID, SubjectRef: entry.SubjectRef,
				Kind: sqlite.AnnotationTag, Body: tag, Revision: 1,
			}
			if err := tx.InsertAnnotation(ctx, record); err != nil {
				return err
			}
			annotationIDs[entry.SubjectRef] = id
		}
		return nil
	}); err != nil {
		t.Fatalf("insert fixture TAG facts: %v", err)
	}
	encodedTag, err := json.Marshal(tag)
	if err != nil {
		t.Fatal(err)
	}
	saved := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpViewSave, map[string]any{
		"name": "paged exact tag and type", "query": "eligible", "scope": h.ingest.WorkspaceID,
		"fields": []string{"entry_type=REGULAR_FILE", "tag=" + string(encodedTag)},
	}))
	if saved.Status != command.StatusSucceeded {
		t.Fatalf("view.save = %q: %+v", saved.Status, saved.Reasons)
	}
	var view command.ViewData
	if err := json.Unmarshal(saved.Data, &view); err != nil {
		t.Fatal(err)
	}
	evaluate := func(input map[string]any) (command.Result, command.ViewEvaluateData) {
		t.Helper()
		result := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpViewEvaluate, input))
		var data command.ViewEvaluateData
		if result.Status == command.StatusSucceeded {
			if err := json.Unmarshal(result.Data, &data); err != nil {
				t.Fatalf("decode view.evaluate: %v; result=%+v", err, result)
			}
		}
		return result, data
	}
	first, firstData := evaluate(map[string]any{"view_id": view.ViewID, "page": map[string]any{"limit": 317}})
	if first.Status != command.StatusSucceeded || firstData.Page == nil {
		t.Fatalf("first page = %q %+v: %+v", first.Status, firstData, first.Reasons)
	}
	if firstData.ViewRevision != view.Revision || firstData.WorkspaceID != h.ingest.WorkspaceID ||
		firstData.IndexGenerationRef == "" || firstData.ProjectionRef == "" ||
		firstData.Page.Mode != command.PageModePage || firstData.Page.Lane != search.LaneSavedView ||
		firstData.Page.Order != search.OrderSavedViewLexical || firstData.Page.Limit != 317 ||
		firstData.Page.Returned != 317 || firstData.Page.Entries == nil || *firstData.Page.Entries != count ||
		firstData.Page.Complete || !firstData.Page.HasMore || firstData.Page.Truncated || firstData.Page.Token == "" || firstData.Page.ExpiresAt == "" {
		t.Fatalf("first page metadata = %+v, result=%+v", firstData, firstData.Page)
	}
	if malformed, _ := evaluate(map[string]any{"view_id": view.ViewID, "limit": 0, "page": map[string]any{"limit": 25}}); malformed.Status != command.StatusFailed || !hasReasonCode(malformed, ReasonCodeInvalidInput) {
		t.Fatalf("explicit legacy limit with page = %q: %+v", malformed.Status, malformed.Reasons)
	}
	if tooLarge, _ := evaluate(map[string]any{"view_id": view.ViewID, "page": map[string]any{"limit": search.MaxPageSize + 1}}); tooLarge.Status != command.StatusFailed || !hasReasonCode(tooLarge, ReasonCodeInvalidInput) {
		t.Fatalf("oversized page limit = %q: %+v", tooLarge.Status, tooLarge.Reasons)
	}
	all := make([]command.SearchHitData, 0, count)
	all = append(all, firstData.Hits...)
	seen := make(map[string]struct{}, count)
	assertAuthorizedLength := func(hit command.SearchHitData) {
		t.Helper()
		want, ok := expectedLengths[hit.SubjectRef]
		if !ok || hit.LogicalSize == nil || *hit.LogicalSize != want {
			t.Fatalf("paged hit %q logical_size = %v, want %d", hit.SubjectRef, hit.LogicalSize, want)
		}
	}
	for _, hit := range all {
		assertAuthorizedLength(hit)
		if _, duplicate := seen[hit.SubjectRef]; duplicate {
			t.Fatalf("duplicate subject on first page: %s", hit.SubjectRef)
		}
		seen[hit.SubjectRef] = struct{}{}
	}
	token := firstData.Page.Token
	for pageNumber, pageLimit := range []int{200, 500} {
		result, data := evaluate(map[string]any{"view_id": view.ViewID, "page": map[string]any{"limit": pageLimit, "token": token}})
		if result.Status != command.StatusSucceeded || data.Page == nil {
			t.Fatalf("continuation page %d = %q: %+v", pageNumber+1, result.Status, result.Reasons)
		}
		if data.ProjectionRef != firstData.ProjectionRef || data.IndexGenerationRef != firstData.IndexGenerationRef || data.Page.Entries == nil || *data.Page.Entries != count {
			t.Fatalf("continuation changed projection metadata: %+v", data)
		}
		for _, hit := range data.Hits {
			assertAuthorizedLength(hit)
			if _, duplicate := seen[hit.SubjectRef]; duplicate {
				t.Fatalf("duplicate subject across pages: %s", hit.SubjectRef)
			}
			seen[hit.SubjectRef] = struct{}{}
			all = append(all, hit)
		}
		token = data.Page.Token
		if pageNumber == 0 && (!data.Page.HasMore || data.Page.Complete || data.Page.Token == "") {
			t.Fatalf("middle page did not continue: %+v", data.Page)
		}
		if pageNumber == 1 && (data.Page.HasMore || !data.Page.Complete || data.Page.Token != "") {
			t.Fatalf("last page was not complete: %+v", data.Page)
		}
	}
	if len(all) != count || len(seen) != count {
		t.Fatalf("paged projection returned %d unique hits, want %d", len(seen), count)
	}

	// A live TAG mutation invalidates the projection token rather than silently
	// continuing with a different eligible set.
	firstAgain, firstAgainData := evaluate(map[string]any{"view_id": view.ViewID, "page": map[string]any{"limit": 10}})
	if firstAgain.Status != command.StatusSucceeded || firstAgainData.Page == nil || firstAgainData.Page.Token == "" {
		t.Fatalf("fresh page before TAG mutation = %q: %+v", firstAgain.Status, firstAgain.Reasons)
	}
	for subject, id := range annotationIDs {
		if err := h.dispatcher.store.ReviseAnnotation(ctx, h.ingest.WorkspaceID, id, 1, tag, true, h.dispatcher.now()); err != nil {
			t.Fatalf("tombstone TAG on %s: %v", subject, err)
		}
		break
	}
	stale, _ := evaluate(map[string]any{"view_id": view.ViewID, "page": map[string]any{"limit": 10, "token": firstAgainData.Page.Token}})
	if stale.Status != command.StatusFailed || !hasReasonCode(stale, ReasonCodeInvalidInput) {
		t.Fatalf("continuation after TAG mutation = %q: %+v", stale.Status, stale.Reasons)
	}
}

func TestSavedViewContinuationRefusesScopeDefinitionGenerationAndExpiryChanges(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"needle-saved-alpha.txt", "needle-saved-beta.txt"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("needle saved view"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	h, _ := openViewExportHarness(t, root, true)
	save := func(query string) command.ViewData {
		t.Helper()
		result := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpViewSave, map[string]any{
			"name": "continuation binding", "query": query, "scope": h.ingest.WorkspaceID,
		}))
		if result.Status != command.StatusSucceeded {
			t.Fatalf("view.save(%q) = %q: %+v", query, result.Status, result.Reasons)
		}
		var data command.ViewData
		if err := json.Unmarshal(result.Data, &data); err != nil {
			t.Fatal(err)
		}
		return data
	}
	evaluate := func(input map[string]any) (command.Result, command.ViewEvaluateData) {
		t.Helper()
		result := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpViewEvaluate, input))
		var data command.ViewEvaluateData
		if result.Status == command.StatusSucceeded {
			if err := json.Unmarshal(result.Data, &data); err != nil {
				t.Fatal(err)
			}
		}
		return result, data
	}
	view := save("needle")
	legacy, legacyData := evaluate(map[string]any{"view_id": view.ViewID})
	if legacy.Status != command.StatusSucceeded || legacyData.Page != nil || len(legacyData.Hits) != 2 ||
		legacyData.ViewRevision != 0 || legacyData.WorkspaceID != "" || legacyData.ProjectionRef != "" {
		t.Fatalf("legacy view.evaluate shape changed: status=%q data=%+v reasons=%+v", legacy.Status, legacyData, legacy.Reasons)
	}
	legacyHitsJSON, err := json.Marshal(legacyData.Hits)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(legacyHitsJSON), `"logical_size"`) {
		t.Fatalf("legacy view.evaluate unexpectedly added logical_size: %s", legacyHitsJSON)
	}
	first, data := evaluate(map[string]any{"view_id": view.ViewID, "page": map[string]any{"limit": 1}})
	if first.Status != command.StatusSucceeded || data.Page == nil || data.Page.Token == "" {
		t.Fatalf("first page = %q: %+v", first.Status, first.Reasons)
	}
	if scope, _ := evaluate(map[string]any{"view_id": view.ViewID, "scope": "wsp_ffffffffffffffffffffffffffffffff", "page": map[string]any{"token": data.Page.Token}}); scope.Status != command.StatusFailed || !hasReasonCode(scope, ReasonCodeInvalidInput) {
		t.Fatalf("scope override = %q: %+v", scope.Status, scope.Reasons)
	}
	parts := strings.Split(data.Page.Token, ".")
	if len(parts) != 2 || len(parts[0]) < 8 {
		t.Fatalf("unexpected continuation encoding: %q", data.Page.Token)
	}
	if parts[0][7] == 'A' {
		parts[0] = parts[0][:7] + "B" + parts[0][8:]
	} else {
		parts[0] = parts[0][:7] + "A" + parts[0][8:]
	}
	if tampered, _ := evaluate(map[string]any{"view_id": view.ViewID, "page": map[string]any{"token": strings.Join(parts, ".")}}); tampered.Status != command.StatusFailed || !hasReasonCode(tampered, ReasonCodeInvalidInput) {
		t.Fatalf("tampered continuation = %q: %+v", tampered.Status, tampered.Reasons)
	}
	updated := save("saved")
	if updated.Revision <= view.Revision {
		t.Fatalf("saved view revision did not advance: before=%d after=%d", view.Revision, updated.Revision)
	}
	if stale, _ := evaluate(map[string]any{"view_id": view.ViewID, "page": map[string]any{"token": data.Page.Token}}); stale.Status != command.StatusFailed || !hasReasonCode(stale, ReasonCodeInvalidInput) {
		t.Fatalf("continuation after definition revision = %q: %+v", stale.Status, stale.Reasons)
	}

	// A newly published lexical generation invalidates a chain even when the
	// same saved definition and query remain in use.
	current, currentData := evaluate(map[string]any{"view_id": view.ViewID, "page": map[string]any{"limit": 1}})
	if current.Status != command.StatusSucceeded || currentData.Page == nil || currentData.Page.Token == "" {
		t.Fatalf("current-generation first page = %q: %+v", current.Status, current.Reasons)
	}
	if _, err := h.dispatcher.search.RebuildLatestLexical(context.Background(), h.ingest.WorkspaceID); err != nil {
		t.Fatalf("rebuild lexical generation: %v", err)
	}
	if staleGeneration, _ := evaluate(map[string]any{"view_id": view.ViewID, "page": map[string]any{"token": currentData.Page.Token}}); staleGeneration.Status != command.StatusFailed || !hasReasonCode(staleGeneration, ReasonCodeInvalidInput) {
		t.Fatalf("continuation after generation change = %q: %+v", staleGeneration.Status, staleGeneration.Reasons)
	}

	latest, latestData := evaluate(map[string]any{"view_id": view.ViewID, "page": map[string]any{"limit": 1}})
	if latest.Status != command.StatusSucceeded || latestData.Page == nil || latestData.Page.Token == "" {
		t.Fatalf("expiry first page = %q: %+v", latest.Status, latest.Reasons)
	}
	now := h.dispatcher.now
	h.dispatcher.now = func() time.Time { return now().Add(search.ContinuationTTL + time.Second) }
	expired, _ := evaluate(map[string]any{"view_id": view.ViewID, "page": map[string]any{"token": latestData.Page.Token}})
	h.dispatcher.now = now
	if expired.Status != command.StatusFailed || !hasReasonCode(expired, ReasonCodeInvalidInput) {
		t.Fatalf("expired continuation = %q: %+v", expired.Status, expired.Reasons)
	}
}
