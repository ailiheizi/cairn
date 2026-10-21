package controlplane

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/testutil"
)

func TestFusedAuthorizationCanonicalizesLegacyAndStableHandlesOnce(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "payload.txt"), []byte("searchable payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	dispatcher := NewDispatcher(store, "catalog.sqlite", testutil.TempSocketPath(t), WithExact(&exact.Service{Store: store, Repo: repo}))
	ingest := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})
	listed := dispatcher.Handle(ctx, mustEnvelope(t, command.OpNamespaceList, map[string]any{
		"workspace_id": ingest.WorkspaceID, "root_id": ingest.RootID,
	}))
	if listed.Status != command.StatusSucceeded {
		t.Fatalf("namespace.list = %q: %+v", listed.Status, listed.Reasons)
	}
	var namespace command.NamespaceListData
	if err := json.Unmarshal(listed.Data, &namespace); err != nil {
		t.Fatal(err)
	}
	if len(namespace.Entries) != 1 {
		t.Fatalf("namespace entries = %+v", namespace.Entries)
	}
	legacy := namespace.Entries[0]
	if legacy.SubjectRef == "" || legacy.SubjectRef == legacy.ID {
		t.Fatalf("fixture did not produce a stable subject: %+v", legacy)
	}
	hits := []search.Hit{
		{SubjectID: legacy.ID, Path: "current/payload.txt", ConstructAxes: []string{search.AxisNotes}, Segments: []search.SegmentRef{{SourceType: "ANNOTATION", SourceID: "note-legacy", SegmentID: "note-legacy", MatchedText: "legacy source"}}},
		{SubjectID: legacy.SubjectRef, Path: "current/payload.txt", ConstructAxes: []string{search.AxisDescriptions}, Segments: []search.SegmentRef{{SourceType: "DESCRIPTION", SourceID: "description-stable", SegmentID: "description-segment", MatchedText: "stable source"}}},
	}
	authorized, canonicalBySource := dispatcher.authorizeHitsWithCanonicalSubjects(ctx, ingest.WorkspaceID, "", hits, map[string][]string{
		legacy.ID: {search.DimensionLexical}, legacy.SubjectRef: {search.DimensionSemantic},
	})
	if canonicalBySource[legacy.ID] != legacy.SubjectRef || canonicalBySource[legacy.SubjectRef] != legacy.SubjectRef {
		t.Fatalf("same-pass canonical mappings = %v", canonicalBySource)
	}
	if len(authorized) != 2 || authorized[0].SubjectRef != legacy.SubjectRef || authorized[1].SubjectRef != legacy.SubjectRef {
		t.Fatalf("authorization did not return canonical rows: %+v", authorized)
	}
	retained := []search.FusedHit{{
		Hit: search.Hit{SubjectID: legacy.SubjectRef, ConstructAxes: []string{search.AxisNotes, search.AxisDescriptions}, Segments: []search.SegmentRef{
			{SourceType: "ANNOTATION", SourceID: "note-legacy", SegmentID: "note-legacy", MatchedText: "legacy source"},
			{SourceType: "DESCRIPTION", SourceID: "description-stable", SegmentID: "description-segment", MatchedText: "stable source"},
		}},
		Dimensions: []string{search.DimensionLexical, search.DimensionSemantic},
	}}
	projected := projectAuthorizedFusedOrder(authorized, retained)
	if len(projected) != 1 {
		t.Fatalf("canonical aliases projected as %d rows: %+v", len(projected), projected)
	}
	got := projected[0]
	if got.SubjectRef != legacy.SubjectRef || got.EntryID != legacy.ID || got.Name != legacy.DisplayName || got.ContentID != legacy.ContentID || got.Path != authorized[0].Path {
		t.Fatalf("canonical row lost existing authorized fields or first projection: %+v; first=%+v", got, authorized[0])
	}
	if !reflect.DeepEqual(got.ConstructAxes, []string{search.AxisNotes, search.AxisDescriptions}) ||
		!reflect.DeepEqual(got.Dimensions, []string{search.DimensionLexical, search.DimensionSemantic}) || len(got.Segments) != 2 ||
		got.Segments[0].SourceID != "note-legacy" || got.Segments[1].SourceID != "description-stable" {
		t.Fatalf("canonical row lost merged cross-lane provenance: %+v", got)
	}
}
