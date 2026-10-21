package search

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

func TestLexicalProfileV5UsesCapturedModificationTime(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	observedAt := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	rows := []struct {
		name    string
		modTime string
	}{
		{name: "captured-2020.txt", modTime: `"2020-06-01T12:00:00Z"`},
		{name: "captured-2022.txt", modTime: `"2022-06-01T12:00:00Z"`},
		{name: "captured-2024.txt", modTime: `"2024-06-01T12:00:00Z"`},
		{name: "captured-missing.txt"},
		{name: "captured-malformed.txt", modTime: `"not-a-time"`},
	}
	entries := make([]sqlite.NamespaceEntry, 0, len(rows))
	observations := make([]sqlite.Observation, 0, len(rows))
	for i, row := range rows {
		entryID := mustSearchID(t, sqlite.IDPrefixNamespaceEntry)
		observationID := mustSearchID(t, sqlite.IDPrefixObservation)
		pathKey := []byte("Music/" + row.name)
		metadata := json.RawMessage(`{}`)
		if row.modTime != "" {
			metadata = json.RawMessage(`{"mod_time":` + row.modTime + `}`)
		}
		entries = append(entries, sqlite.NamespaceEntry{
			ID: entryID, SubjectRef: entryID, WorkspaceID: seed.WorkspaceID,
			RootID: seed.RootID, ParentID: seed.DirEntryID, ObservationID: observationID,
			RawName: []byte(row.name), DisplayName: row.name, FullPathKey: pathKey,
			EntryType: sqlite.EntryFile, Metadata: metadata,
		})
		observations = append(observations, sqlite.Observation{
			ID: observationID, WorkspaceID: seed.WorkspaceID, SourceID: seed.SourceID,
			ScanGenerationID: seed.ScanGenerationID, PathKey: pathKey, RawPath: pathKey,
			DisplayPath: string(pathKey), EntryType: sqlite.EntryFile,
			StatDigest: "sha256:observed-stat-" + string(rune('a'+i)), ReadState: "READ_OK",
			ObservedAt: observedAt,
		})
	}
	if err := store.Update(ctx, func(tx *sqlite.Tx) error {
		for i := range observations {
			if err := tx.InsertObservation(ctx, &observations[i]); err != nil {
				return err
			}
		}
		for i := range entries {
			if err := tx.InsertNamespaceEntry(ctx, &entries[i]); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatalf("insert captured-time entries: %v", err)
	}

	// Construct a genuine V4-bound database with the old facet value: the
	// observation's scan time, not the captured source metadata. This pins both
	// historical binding behavior and that a matching V4 reader can still use it.
	oldEngine := &Engine{Dir: t.TempDir()}
	oldGenerationID := mustSearchID(t, sqlite.IDPrefixIndexGeneration)
	legacyObservedMillis := observedAt.UnixMilli()
	oldDBPath, err := oldEngine.Build(ctx, oldGenerationID, []Document{{
		SubjectID: entries[0].SubjectRef, Path: "Music/legacy-v4-observed.txt",
		Name: "legacy-v4-observed.txt", Suffix: "txt", EntryType: string(sqlite.EntryFile),
		MtimeMillis: &legacyObservedMillis,
	}})
	if err != nil {
		t.Fatalf("build historical V4 database: %v", err)
	}
	oldGeneration := sqlite.IndexGeneration{
		ID: oldGenerationID, WorkspaceID: seed.WorkspaceID,
		SnapshotRef: "snapshot:captured-mtime-v4", NamespaceRootID: seed.RootID,
		DBPath: oldDBPath, Dimension: DimensionLexical, ConfigDigest: "sha256:mtime-profile",
		ProviderProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4),
	}
	if err := store.InsertIndexGenerationWithRoots(ctx, &oldGeneration, []string{seed.RootID}); err != nil {
		t.Fatalf("register historical V4 generation: %v", err)
	}
	oldIndexer := &Indexer{
		Store: store, Engine: oldEngine, ConfigDigest: "sha256:mtime-profile",
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4),
	}
	oldStart := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	oldEnd := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	if _, hits, err := oldIndexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, GenerationID: oldGeneration.ID, Dimension: DimensionLexical,
		Text: "legacy", Filters: Filters{MtimeAfter: &oldStart, MtimeBefore: &oldEnd},
	}); err != nil || len(hits) != 1 || hits[0].Name != "legacy-v4-observed.txt" {
		t.Fatalf("matching V4 reader query = %+v err=%v; want the historical observation-time row", hits, err)
	}
	oldBytes, err := os.ReadFile(oldGeneration.DBPath)
	if err != nil {
		t.Fatalf("read V4 generation before refusal: %v", err)
	}

	indexer := &Indexer{Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:mtime-profile"}
	if got := indexer.profileDigest(DimensionLexical); got != ProfileDigest(DimensionLexical, LexicalProfileV5) {
		t.Fatalf("default lexical profile = %q, want V5", got)
	}
	if _, _, err := indexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, GenerationID: oldGeneration.ID, Dimension: DimensionLexical, Text: "captured",
	}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("V5 query of V4 generation = %v, want ErrUnavailable", err)
	}
	afterRefusal, err := os.ReadFile(oldGeneration.DBPath)
	if err != nil {
		t.Fatalf("read V4 generation after refusal: %v", err)
	}
	if string(afterRefusal) != string(oldBytes) {
		t.Fatal("refusing the old generation modified its database bytes")
	}

	generation, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:captured-mtime-v5", seed.RootID)
	if err != nil {
		t.Fatalf("build current V5 generation: %v", err)
	}
	if generation.ID == oldGeneration.ID || generation.ProviderProfileDigest != ProfileDigest(DimensionLexical, LexicalProfileV5) {
		t.Fatalf("V5 generation did not get a new profile-bound identity: old=%+v new=%+v", oldGeneration, generation)
	}
	start := time.Date(2021, 1, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	end := time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	_, filtered, err := indexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical, Text: "captured",
		Filters: Filters{MtimeAfter: &start, MtimeBefore: &end},
	})
	if err != nil {
		t.Fatalf("query captured-time range: %v", err)
	}
	if len(filtered) != 1 || filtered[0].Name != "captured-2022.txt" {
		t.Fatalf("captured-time range hits = %+v, want only captured-2022.txt", filtered)
	}
	_, unknownTimeHits, err := indexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical, Text: "captured",
		Filters: Filters{MtimeAfter: &oldStart, MtimeBefore: &oldEnd},
	})
	if err != nil {
		t.Fatalf("query absent-time range: %v", err)
	}
	if len(unknownTimeHits) != 0 {
		t.Fatalf("missing/malformed times inherited observation time: %+v", unknownTimeHits)
	}
	for _, test := range []struct{ query, name string }{
		{query: "missing", name: "captured-missing.txt"},
		{query: "malformed", name: "captured-malformed.txt"},
	} {
		_, hits, err := indexer.Query(ctx, QueryRequest{
			WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical, Text: test.query,
		})
		if err != nil || len(hits) != 1 || hits[0].Name != test.name {
			t.Errorf("text query for %q = %+v, err=%v; absent/invalid mtime must not hide text", test.query, hits, err)
		}
	}
	// Pin that the test data really has a conflicting capture time: every
	// observation is today, while the indexed metadata above spans 2020-2024.
	for _, observation := range observations {
		observed, err := store.GetObservation(ctx, seed.WorkspaceID, observation.ID)
		if err != nil {
			t.Fatalf("read observation timestamp: %v", err)
		}
		if !observed.ObservedAt.Equal(observedAt) {
			t.Fatalf("observation timestamp changed: %s", observed.ObservedAt)
		}
	}
}
