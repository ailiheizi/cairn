package search

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/restoreweave/server/internal/search/pinyin"
	"github.com/ailiheizi/restoreweave/server/internal/store/sqlite"
	"github.com/ailiheizi/restoreweave/server/testutil"
	_ "modernc.org/sqlite"
)

// seedCJKFile adds one file named 旅行计划.md to the seeded namespace.
func seedCJKFile(t *testing.T, store *sqlite.Store, seed *testutil.NamespaceSeed) string {
	t.Helper()
	entryID := mustSearchID(t, sqlite.IDPrefixNamespaceEntry)
	if err := store.Update(context.Background(), func(tx *sqlite.Tx) error {
		return tx.InsertNamespaceEntry(context.Background(), &sqlite.NamespaceEntry{
			ID: entryID, WorkspaceID: seed.WorkspaceID, RootID: seed.RootID,
			ParentID: seed.DirEntryID, RawName: []byte("旅行计划.md"), DisplayName: "旅行计划.md",
			FullPathKey: []byte("Music\x00旅行计划.md"), EntryType: sqlite.EntryFile,
			Metadata: []byte(`{}`),
		})
	}); err != nil {
		t.Fatalf("insert CJK file entry: %v", err)
	}
	return entryID
}

func TestLexicalFeedAppendsPinyinTokensForNameAndPath(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	seedCJKFile(t, store, seed)
	indexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:config-pinyin",
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV2),
	}
	generation, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:pinyin-feed", seed.RootID)
	if err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	db, err := sql.Open("sqlite", generation.DBPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var cjkPath, cjkPathPinyin, cjkName, cjkNamePinyin string
	if err := db.QueryRowContext(ctx,
		`SELECT path, path_pinyin, name, name_pinyin FROM documents WHERE name = '旅行计划.md'`,
	).Scan(&cjkPath, &cjkPathPinyin, &cjkName, &cjkNamePinyin); err != nil {
		t.Fatalf("read CJK feed row: %v", err)
	}
	// The raw characters stay in the field; the pinyin forms are appended
	// tokens on the same axis.
	if cjkName != "旅行计划.md" {
		t.Errorf("feed name = %q, want the untouched original", cjkName)
	}
	for _, form := range []string{"lv xing ji hua", "lvxingjihua", "lüxingjihua", "lxjh"} {
		if !strings.Contains(cjkNamePinyin, form) {
			t.Errorf("name pinyin %q misses form %q", cjkNamePinyin, form)
		}
	}
	if !strings.Contains(cjkPathPinyin, "lvxingjihua") {
		t.Errorf("path pinyin %q misses the joined form", cjkPathPinyin)
	}
	// Non-CJK names are unchanged and get no appendix.
	var trackName, trackNamePinyin string
	if err := db.QueryRowContext(ctx,
		`SELECT name, name_pinyin FROM documents WHERE name LIKE '%track.flac'`,
	).Scan(&trackName, &trackNamePinyin); err != nil {
		t.Fatalf("read non-CJK feed row: %v", err)
	}
	if trackNamePinyin != "" {
		t.Errorf("non-CJK name pinyin = %q, want empty", trackNamePinyin)
	}
	if want := pinyin.FieldAppendix("track.flac"); want != "" {
		t.Errorf("FieldAppendix(track.flac) = %q, want empty", want)
	}

	// The coverage statement vocabulary is unchanged: pinyin is token
	// enrichment inside the name/path axes, so no new coverage field may be
	// invented, and the enrichment must not make an empty field look present.
	coverage, err := indexer.Coverage(ctx, seed.WorkspaceID)
	if err != nil {
		t.Fatalf("coverage: %v", err)
	}
	for _, axis := range []string{AxisName, AxisPath} {
		if !coverage.Fields[axis] {
			t.Errorf("coverage field %q = false, want present", axis)
		}
	}
	for _, invented := range []string{"name_pinyin", "path_pinyin", "pinyin"} {
		if _, ok := coverage.Fields[invented]; ok {
			t.Errorf("coverage invented a %q field", invented)
		}
	}
	if strings.Contains(coverage.Notes, "pinyin") {
		t.Errorf("coverage notes claim pinyin coverage: %q", coverage.Notes)
	}
}

func TestPinyinQueriesFindCJKNamesThroughNameAxis(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	planID := seedCJKFile(t, store, seed)
	indexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:config-pinyin",
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV2),
	}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:pinyin-query", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}

	for _, query := range []string{"lvxing", "lüxing", "lx", "lv xing", "旅行计划"} {
		_, hits, err := indexer.Query(ctx, QueryRequest{
			WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical,
			Text: query, Axes: []string{AxisName},
		})
		if err != nil {
			t.Fatalf("query %q: %v", query, err)
		}
		if len(hits) != 1 || hits[0].SubjectID != planID {
			t.Fatalf("query %q hits = %+v, want exactly the CJK file", query, hits)
		}
		// The hit must be attributable to the name axis and must still display
		// the original characters, never the appended pinyin tokens.
		if !axisReported(hits[0].ConstructAxes, AxisName) {
			t.Errorf("query %q construct axes = %v, want %q", query, hits[0].ConstructAxes, AxisName)
		}
		if hits[0].Name != "旅行计划.md" {
			t.Errorf("query %q hit name = %q, want the raw display name", query, hits[0].Name)
		}
	}

	// The space-joined form matches the per-syllable tokens.
	_, hits, err := indexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical,
		Text: "lv xing", Axes: []string{AxisName},
	})
	if err != nil || len(hits) != 1 || hits[0].SubjectID != planID {
		t.Fatalf("syllable-token query = %+v err=%v, want the CJK file", hits, err)
	}

	// The path axis also carries the enrichment.
	_, hits, err = indexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical,
		Text: "lvxing", Axes: []string{AxisPath},
	})
	if err != nil || len(hits) != 1 || hits[0].SubjectID != planID {
		t.Fatalf("path-axis pinyin query = %+v err=%v, want the CJK file", hits, err)
	}

	// An unrelated pinyin finds nothing, and the enrichment never leaks into
	// other axes.
	for _, probe := range []struct {
		text string
		axes []string
	}{
		{text: "tianqi", axes: nil},
		{text: "lvxing", axes: []string{AxisTags}},
		{text: "lvxing", axes: []string{AxisNotes}},
	} {
		_, hits, err := indexer.Query(ctx, QueryRequest{
			WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical,
			Text: probe.text, Axes: probe.axes,
		})
		if err != nil {
			t.Fatalf("negative query %q axes %v: %v", probe.text, probe.axes, err)
		}
		if len(hits) != 0 {
			t.Fatalf("negative query %q axes %v hits = %+v, want none", probe.text, probe.axes, hits)
		}
	}
}

func axisReported(axes []string, want string) bool {
	for _, axis := range axes {
		if axis == want {
			return true
		}
	}
	return false
}

// TestLexicalProfileV2CreatesNewGenerationAndRefusesOldOnes pins the
// fail-closed generation binding: changing the feed shape creates a new
// generation, and a generation built under a different lexical profile is
// refused, never reinterpreted.
func TestLexicalProfileV2CreatesNewGenerationAndRefusesOldOnes(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	seedCJKFile(t, store, seed)
	configDigest := "sha256:config-pinyin-binding"

	// An "old" generation: recorded under the pre-V2 profile digest. The old
	// profile string is quoted literally so the test documents the refused
	// shape rather than deriving it from the current constant.
	oldDigest := ProfileDigest(DimensionLexical, "fts5-metadata-v1")
	if oldDigest == ProfileDigest(DimensionLexical, LexicalProfileV2) {
		t.Fatal("v1 and v2 lexical profile digests collide")
	}
	oldIndexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: configDigest,
		LexicalProfileDigest: oldDigest,
	}
	oldGeneration, err := oldIndexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:pinyin-old", seed.RootID)
	if err != nil {
		t.Fatalf("old-profile rebuild: %v", err)
	}
	if oldGeneration.ProviderProfileDigest != oldDigest {
		t.Fatalf("old generation profile digest = %q, want %q", oldGeneration.ProviderProfileDigest, oldDigest)
	}

	// The current wiring computes the V2 profile and must refuse the old
	// generation instead of silently serving it.
	newIndexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: configDigest,
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV2),
	}
	if _, _, err := newIndexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, GenerationID: oldGeneration.ID, Dimension: DimensionLexical, Text: "track",
	}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("query of old-profile generation under V2 wiring = %v, want ErrUnavailable", err)
	}

	// A rebuild under the new feed shape creates a new generation; the old
	// generation row stays addressable in the catalog.
	newGeneration, err := newIndexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:pinyin-new", seed.RootID)
	if err != nil {
		t.Fatalf("V2 rebuild: %v", err)
	}
	if newGeneration.ID == oldGeneration.ID {
		t.Fatal("V2 rebuild reused the old generation")
	}
	if newGeneration.ProviderProfileDigest != ProfileDigest(DimensionLexical, LexicalProfileV2) {
		t.Fatalf("new generation profile digest = %q", newGeneration.ProviderProfileDigest)
	}
	if _, err := store.GetIndexGeneration(ctx, oldGeneration.ID); err != nil {
		t.Fatalf("old generation row must remain readable: %v", err)
	}

	// The new generation serves pinyin queries; the old wiring refuses the
	// new generation in the other direction.
	if _, hits, err := newIndexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, GenerationID: newGeneration.ID, Dimension: DimensionLexical,
		Text: "lvxing", Axes: []string{AxisName},
	}); err != nil || len(hits) != 1 {
		t.Fatalf("V2 generation pinyin query = %+v err=%v", hits, err)
	}
	if _, _, err := oldIndexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, GenerationID: newGeneration.ID, Dimension: DimensionLexical, Text: "track",
	}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("query of V2 generation under old wiring = %v, want ErrUnavailable", err)
	}

	// Without a pinned generation, the latest generation is only served when
	// the wiring matches its recorded profile.
	if _, _, err := newIndexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical, Text: "lvxing",
	}); err != nil {
		t.Fatalf("latest-generation query under matching wiring: %v", err)
	}
	if _, _, err := oldIndexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical, Text: "track",
	}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("latest-generation query under old wiring = %v, want ErrUnavailable", err)
	}
}
