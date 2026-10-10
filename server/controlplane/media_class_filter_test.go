package controlplane

import (
	"context"
	"encoding/json"
	"path/filepath"
	"sort"
	"testing"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/testutil"
)

// TestSearchQueryMediaClassFilterFollowsTheRecordedSuffix proves the additive
// media_class filter end to end through the real search.query operation: a
// fixture with an image, a video-like file, a document, an unknown-suffix
// file, and an extensionless file narrows to exactly the right set, an entry
// with no recorded suffix is not classified as a member of any class
// (including "other"), the existing entry_type and suffix filters keep their
// behavior, and an unknown class value fails closed.
func TestSearchQueryMediaClassFilterFollowsTheRecordedSuffix(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock", WithExact(&exact.Service{
		Store: store,
		Repo:  repo,
	}))

	root := t.TempDir()
	// Every file carries distinct bytes so exact deduplication cannot merge them.
	fixture := map[string]string{
		"holiday.png":   "image fixture bytes",
		"clip.mp4":      "video-like fixture bytes",
		"report.txt":    "document fixture bytes",
		"mystery.xyzzy": "unknown suffix fixture bytes",
		"README":        "extensionless fixture bytes",
	}
	for name, body := range fixture {
		if err := writeFile(filepath.Join(root, name), []byte(body)); err != nil {
			t.Fatalf("write fixture %s: %v", name, err)
		}
	}
	ingestData := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})

	names := func(filters map[string]any) []string {
		t.Helper()
		result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
			"workspace_id": ingestData.WorkspaceID,
			"dimension":    search.DimensionLexical,
			"filters":      filters,
		}))
		if result.Status != command.StatusSucceeded {
			t.Fatalf("search.query %v = %q: %+v", filters, result.Status, result.Reasons)
		}
		var data command.SearchQueryData
		if err := json.Unmarshal(result.Data, &data); err != nil {
			t.Fatalf("decode search.query: %v", err)
		}
		out := make([]string, 0, len(data.Hits))
		for _, hit := range data.Hits {
			out = append(out, hit.Name)
		}
		sort.Strings(out)
		return out
	}
	equal := func(got, want []string, message string) {
		t.Helper()
		if len(got) != len(want) {
			t.Fatalf("%s: got %v, want %v", message, got, want)
		}
		for index := range want {
			if got[index] != want[index] {
				t.Fatalf("%s: got %v, want %v", message, got, want)
			}
		}
	}

	equal(names(map[string]any{"media_class": "image"}), []string{"holiday.png"}, "image class")
	equal(names(map[string]any{"media_class": "video"}), []string{"clip.mp4"}, "video class")
	equal(names(map[string]any{"media_class": "audio"}), nil, "audio class with no audio fixture")
	equal(names(map[string]any{"media_class": "document"}), []string{"report.txt"}, "document class")
	equal(names(map[string]any{"media_class": "archive"}), nil, "archive class with no archive fixture")
	// "other" is the recorded suffix the table does not classify. README has no
	// recorded suffix, so it must not be classified as any class at all.
	equal(names(map[string]any{"media_class": "other"}), []string{"mystery.xyzzy"}, "other class excludes the extensionless file")

	// The existing filters are unchanged: entry_type selects every regular file
	// regardless of class, and the exact suffix facet still works.
	equal(names(map[string]any{"entry_type": "REGULAR_FILE"}), []string{
		"README", "clip.mp4", "holiday.png", "mystery.xyzzy", "report.txt",
	}, "entry_type REGULAR_FILE")
	equal(names(map[string]any{"suffix": "png"}), []string{"holiday.png"}, "suffix facet")
	equal(names(map[string]any{"entry_type": "REGULAR_FILE", "media_class": "document"}), []string{"report.txt"}, "entry_type and media_class intersect")

	// A class value outside the closed vocabulary must fail closed instead of
	// silently matching nothing.
	invalid := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id": ingestData.WorkspaceID,
		"dimension":    search.DimensionLexical,
		"filters":      map[string]any{"media_class": "banana"},
	}))
	if invalid.Status != command.StatusFailed || !hasReasonCode(invalid, ReasonCodeInvalidInput) {
		t.Fatalf("invalid media_class = %q: %+v", invalid.Status, invalid.Reasons)
	}
}
