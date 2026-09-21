package search

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/restoreweave/server/internal/search/pinyin"
	"github.com/ailiheizi/restoreweave/server/internal/store/sqlite"
	"github.com/ailiheizi/restoreweave/server/testutil"
	_ "modernc.org/sqlite"
)

// The CJK facts seeded for the pinyin tests. Each text opens a run with 旅行
// so the joined form ("lvxing...") is a queryable token prefix, and each axis
// carries one distinctive place name (北京 in the note, 上海 in the
// description, 杭州 in the extracted text) so cross-axis leaks are provable.
const (
	cjkNoteBody        = "旅行笔记：北京的金秋"
	cjkDescriptionTool = "旅行手记"
	cjkDescriptionBody = "旅行从上海出发，一路向南"
	cjkExtractedBody   = "旅行记录：这一天路过杭州西湖"
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

// seedCJKNote adds one CJK user note to the given subject.
func seedCJKNote(t *testing.T, store *sqlite.Store, seed *testutil.NamespaceSeed, subjectRef string) {
	t.Helper()
	seedNoteBody(t, store, seed, subjectRef, cjkNoteBody)
}

// seedNoteBody adds one user note carrying body to the given subject.
func seedNoteBody(t *testing.T, store *sqlite.Store, seed *testutil.NamespaceSeed, subjectRef, body string) {
	t.Helper()
	if err := store.Update(context.Background(), func(tx *sqlite.Tx) error {
		return tx.InsertAnnotation(context.Background(), &sqlite.Annotation{
			ID: mustSearchID(t, sqlite.IDPrefixAnnotation), WorkspaceID: seed.WorkspaceID,
			SubjectRef: subjectRef, Kind: sqlite.AnnotationNote, Body: body, Revision: 1,
		})
	}); err != nil {
		t.Fatalf("insert CJK note: %v", err)
	}
}

// seedCJKDescription adds one CJK user description document to the given
// subject.
func seedCJKDescription(t *testing.T, store *sqlite.Store, seed *testutil.NamespaceSeed, subjectRef string) {
	t.Helper()
	if err := store.InsertDescriptionDocument(context.Background(), &sqlite.DescriptionDocument{
		ID: mustSearchID(t, sqlite.IDPrefixDescription), WorkspaceID: seed.WorkspaceID,
		SubjectRef: subjectRef, Kind: sqlite.DescriptionUser,
		Title: cjkDescriptionTool, Language: "zh", Body: cjkDescriptionBody,
		SourceRef: "user:test", ProducerProfile: "human", Accepted: true,
	}); err != nil {
		t.Fatalf("insert CJK description: %v", err)
	}
}

// seedExtractedText adds one admitted EXTRACT artifact carrying body for the
// given subject. The artifact's SnapshotRef must be the seeded root's
// snapshot so the rebuild's root-scope gating admits it into the feed.
func seedExtractedText(t *testing.T, store *sqlite.Store, seed *testutil.NamespaceSeed, subjectRef, body string) {
	t.Helper()
	const snapshotRef = "apfs-snapshot:2026-08-11T12:00:00Z"
	attemptID := mustSearchID(t, sqlite.IDPrefixAttempt)
	if err := store.InsertProcessorAttempt(context.Background(), &sqlite.ProcessorAttempt{
		ID: attemptID, WorkspaceID: seed.WorkspaceID, SubjectRef: subjectRef,
		SnapshotRef: snapshotRef, RouteDigest: "sha256:pinyin-extract-route",
		Route: json.RawMessage(`{"capability":"extract.text.v1"}`), Stage: "EXTRACT",
		CapabilityID: "extract.text.v1", Status: "SUCCEEDED", ReasonCode: "ADMITTED_ARTIFACT",
		Provenance: json.RawMessage(`{}`), FenceToken: 1, ProcessorDigest: "sha256:pinyin-extract-producer",
	}); err != nil {
		t.Fatalf("insert extract attempt: %v", err)
	}
	digest := sha256.Sum256([]byte(body))
	if err := store.InsertProcessorArtifact(context.Background(), &sqlite.ProcessorArtifact{
		ID: mustSearchID(t, sqlite.IDPrefixArtifact), WorkspaceID: seed.WorkspaceID, SubjectRef: subjectRef,
		SnapshotRef: snapshotRef, RouteDigest: "sha256:pinyin-extract-route",
		Stage: "EXTRACT", CapabilityID: "extract.text.v1", SchemaRef: "text/plain:v1",
		State: sqlite.ArtifactAdmitted, AuthorityClass: "STAGED_ARTIFACT", LifecycleClass: "DURABLE",
		MediaType: "text/plain", ByteLength: int64(len(body)), Digest: "sha256:" + hex.EncodeToString(digest[:]),
		Body: body, AttemptID: attemptID, FenceToken: 1, ProducerDigest: "sha256:pinyin-extract-producer",
		Envelope: json.RawMessage(`{"source":"controlled-test"}`),
	}); err != nil {
		t.Fatalf("insert admitted extract artifact: %v", err)
	}
}

func TestLexicalFeedAppendsPinyinTokensForNamePathNotesDescriptionsAndExtracted(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	planID := seedCJKFile(t, store, seed)
	seedCJKNote(t, store, seed, planID)
	seedCJKDescription(t, store, seed, planID)
	seedExtractedText(t, store, seed, planID, cjkExtractedBody)
	// An ASCII note must stay untouched and gain no appendix.
	englishNote := "a plain english note"
	if err := store.Update(ctx, func(tx *sqlite.Tx) error {
		return tx.InsertAnnotation(ctx, &sqlite.Annotation{
			ID: mustSearchID(t, sqlite.IDPrefixAnnotation), WorkspaceID: seed.WorkspaceID,
			SubjectRef: seed.FileEntryID, Kind: sqlite.AnnotationNote, Body: englishNote, Revision: 1,
		})
	}); err != nil {
		t.Fatalf("insert english note: %v", err)
	}
	indexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:config-pinyin",
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4),
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
	var cjkNotes, cjkNotesPinyin, cjkDescriptions, cjkDescriptionsPinyin string
	var cjkExtracted, cjkExtractedPinyin string
	if err := db.QueryRowContext(ctx,
		`SELECT path, path_pinyin, name, name_pinyin, notes, notes_pinyin,
		        descriptions, descriptions_pinyin, extracted, extracted_pinyin
		 FROM documents WHERE name = '旅行计划.md'`,
	).Scan(&cjkPath, &cjkPathPinyin, &cjkName, &cjkNamePinyin,
		&cjkNotes, &cjkNotesPinyin, &cjkDescriptions, &cjkDescriptionsPinyin,
		&cjkExtracted, &cjkExtractedPinyin); err != nil {
		t.Fatalf("read CJK feed row: %v", err)
	}
	// The raw characters stay in every field; the pinyin forms are appended
	// tokens on the same axis.
	if cjkName != "旅行计划.md" {
		t.Errorf("feed name = %q, want the untouched original", cjkName)
	}
	if cjkNotes != cjkNoteBody {
		t.Errorf("feed notes = %q, want the untouched original %q", cjkNotes, cjkNoteBody)
	}
	if !strings.Contains(cjkDescriptions, cjkDescriptionBody) || !strings.Contains(cjkDescriptions, cjkDescriptionTool) {
		t.Errorf("feed descriptions = %q, want the untouched title and body", cjkDescriptions)
	}
	if cjkExtracted != cjkExtractedBody {
		t.Errorf("feed extracted = %q, want the untouched original %q", cjkExtracted, cjkExtractedBody)
	}
	for _, form := range []string{"lv xing ji hua", "lvxingjihua", "lüxingjihua", "lxjh"} {
		if !strings.Contains(cjkNamePinyin, form) {
			t.Errorf("name pinyin %q misses form %q", cjkNamePinyin, form)
		}
	}
	if !strings.Contains(cjkPathPinyin, "lvxingjihua") {
		t.Errorf("path pinyin %q misses the joined form", cjkPathPinyin)
	}
	for _, form := range []string{"lv xing bi ji", "bei jing de jin qiu", "lvxingbiji", "lxbj", "bjdjq"} {
		if !strings.Contains(cjkNotesPinyin, form) {
			t.Errorf("notes pinyin %q misses form %q", cjkNotesPinyin, form)
		}
	}
	for _, form := range []string{"lv xing cong shang hai chu fa", "shang hai", "lvxingcongshanghaichufa", "lxcshcf"} {
		if !strings.Contains(cjkDescriptionsPinyin, form) {
			t.Errorf("descriptions pinyin %q misses form %q", cjkDescriptionsPinyin, form)
		}
	}
	for _, form := range []string{"lv xing ji lu", "hang zhou xi hu", "lvxingjilu", "lxjl"} {
		if !strings.Contains(cjkExtractedPinyin, form) {
			t.Errorf("extracted pinyin %q misses form %q", cjkExtractedPinyin, form)
		}
	}
	// Non-CJK names and notes are unchanged and get no appendix.
	var trackName, trackNamePinyin, trackNotes, trackNotesPinyin string
	if err := db.QueryRowContext(ctx,
		`SELECT name, name_pinyin, notes, notes_pinyin FROM documents WHERE name LIKE '%track.flac'`,
	).Scan(&trackName, &trackNamePinyin, &trackNotes, &trackNotesPinyin); err != nil {
		t.Fatalf("read non-CJK feed row: %v", err)
	}
	if trackNamePinyin != "" {
		t.Errorf("non-CJK name pinyin = %q, want empty", trackNamePinyin)
	}
	if trackNotes != englishNote {
		t.Errorf("non-CJK notes = %q, want the untouched original", trackNotes)
	}
	if trackNotesPinyin != "" {
		t.Errorf("non-CJK notes pinyin = %q, want empty", trackNotesPinyin)
	}
	if want := pinyin.FieldAppendix("track.flac"); want != "" {
		t.Errorf("FieldAppendix(track.flac) = %q, want empty", want)
	}

	// The coverage statement vocabulary is unchanged: pinyin is token
	// enrichment inside the existing axes, so no new coverage field may be
	// invented, and the enrichment must not make an empty field look present.
	coverage, err := indexer.Coverage(ctx, seed.WorkspaceID)
	if err != nil {
		t.Fatalf("coverage: %v", err)
	}
	for _, axis := range []string{AxisName, AxisPath, AxisNotes, AxisDescriptions, AxisExtracted} {
		if !coverage.Fields[axis] {
			t.Errorf("coverage field %q = false, want present", axis)
		}
	}
	for _, invented := range []string{"name_pinyin", "path_pinyin", "notes_pinyin", "descriptions_pinyin", "extracted_pinyin", "pinyin"} {
		if _, ok := coverage.Fields[invented]; ok {
			t.Errorf("coverage invented a %q field", invented)
		}
	}
	if strings.Contains(coverage.Notes, "pinyin") {
		t.Errorf("coverage notes claim pinyin coverage: %q", coverage.Notes)
	}
}

func TestPinyinQueriesFindCJKContentThroughEveryEnrichedAxis(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	planID := seedCJKFile(t, store, seed)
	seedCJKNote(t, store, seed, planID)
	seedCJKDescription(t, store, seed, planID)
	seedExtractedText(t, store, seed, planID, cjkExtractedBody)
	indexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:config-pinyin",
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4),
	}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:pinyin-query", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}

	// Every enriched axis — name, notes, descriptions, and extracted — is
	// reachable by the pinyin syllables, the space-joined syllables, the
	// initials, and the original characters.
	for _, axis := range []string{AxisName, AxisNotes, AxisDescriptions, AxisExtracted} {
		for _, query := range []string{"lvxing", "lüxing", "lx", "lv xing", "旅行"} {
			_, hits, err := indexer.Query(ctx, QueryRequest{
				WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical,
				Text: query, Axes: []string{axis},
			})
			if err != nil {
				t.Fatalf("axis %q query %q: %v", axis, query, err)
			}
			if len(hits) != 1 || hits[0].SubjectID != planID {
				t.Fatalf("axis %q query %q hits = %+v, want exactly the CJK file", axis, query, hits)
			}
			// The hit must be attributable to the queried axis and must still
			// display the original characters, never the appended pinyin.
			if !axisReported(hits[0].ConstructAxes, axis) {
				t.Errorf("axis %q query %q construct axes = %v, want %q", axis, query, hits[0].ConstructAxes, axis)
			}
			if hits[0].Name != "旅行计划.md" {
				t.Errorf("axis %q query %q hit name = %q, want the raw display name", axis, query, hits[0].Name)
			}
		}
	}

	// The path axis also carries the enrichment.
	_, hits, err := indexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical,
		Text: "lvxing", Axes: []string{AxisPath},
	})
	if err != nil || len(hits) != 1 || hits[0].SubjectID != planID {
		t.Fatalf("path-axis pinyin query = %+v err=%v, want the CJK file", hits, err)
	}

	// The per-axis place names prove the enrichment never leaks across axes:
	// 北京 lives only in the note, 上海 only in the description, 杭州 only in
	// the extracted text.
	for _, probe := range []struct {
		text string
		axes []string
	}{
		{text: "beijing", axes: []string{AxisDescriptions}},
		{text: "beijing", axes: []string{AxisExtracted}},
		{text: "shanghai", axes: []string{AxisNotes}},
		{text: "shanghai", axes: []string{AxisExtracted}},
		{text: "hangzhou", axes: []string{AxisNotes}},
		{text: "hangzhou", axes: []string{AxisDescriptions}},
		// An unrelated pinyin finds nothing anywhere.
		{text: "tianqi", axes: nil},
		{text: "tianqi", axes: []string{AxisNotes, AxisDescriptions, AxisExtracted}},
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

// TestExtractedAxisPinyinEnrichmentCoversDeclaredBoundPrefixOnly pins the
// extracted-axis feed shape: the derived token appendix (CJK adjacency tokens
// and pinyin forms) covers only the declared 256 KiB prefix while the raw
// extracted field carries the whole text, so raw-character queries over the
// unenriched tail still find the subject.
func TestExtractedAxisPinyinEnrichmentCoversDeclaredBoundPrefixOnly(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	planID := seedCJKFile(t, store, seed)
	head := "旅行开始于杭州西湖。"
	tail := "沙漠的尽头是敦煌。"
	fillerUnit := "The quiet caravan crossed the dunes under a wide sky. "
	filler := strings.Repeat(fillerUnit, extractedPinyinEnrichmentBound/len(fillerUnit)+8)
	body := head + filler + tail
	if strings.Index(body, tail) <= extractedPinyinEnrichmentBound {
		t.Fatalf("test layout: the CJK tail starts at %d, want beyond the %d-byte bound",
			strings.Index(body, tail), extractedPinyinEnrichmentBound)
	}
	seedExtractedText(t, store, seed, planID, body)
	indexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:config-pinyin",
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4),
	}
	generation, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:pinyin-bound", seed.RootID)
	if err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	db, err := sql.Open("sqlite", generation.DBPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var extracted, extractedPinyin string
	if err := db.QueryRowContext(ctx,
		`SELECT extracted, extracted_pinyin FROM documents WHERE name = '旅行计划.md'`,
	).Scan(&extracted, &extractedPinyin); err != nil {
		t.Fatalf("read bounded extracted row: %v", err)
	}
	// The raw field carries the whole text; the appendix covers the prefix.
	if extracted != body {
		t.Fatalf("raw extracted field length = %d, want the whole %d-byte body", len(extracted), len(body))
	}
	if !strings.HasSuffix(extracted, tail) {
		t.Fatalf("raw extracted field lost the tail: %q", tail)
	}
	for _, form := range []string{"lv xing kai shi yu hang zhou xi hu", "lvxingkaishiyuhangzhouxihu", "lxksyhzxh",
		"西湖", "州西", "xihu", "zhouxi"} {
		if !strings.Contains(extractedPinyin, form) {
			t.Errorf("extracted pinyin %q misses the in-bound form %q", extractedPinyin, form)
		}
	}
	for _, absent := range []string{"sha mo de jin tou shi dun huang", "shamodejintoushidunhuang", "smdjtsdh",
		"漠的", "mode", "dunhuang"} {
		if strings.Contains(extractedPinyin, absent) {
			t.Errorf("extracted pinyin %q contains beyond-bound form %q", extractedPinyin, absent)
		}
	}

	// The prefix enrichment is searchable; the unenriched tail is reachable
	// only through its raw characters, never through pinyin or an adjacency
	// token. The adjacency tokens follow the same declared bound as the rest
	// of the appendix: an in-bound mid-run pair matches, and a pair inside the
	// beyond-bound tail does not exist.
	for _, probe := range []struct {
		text string
		axes []string
		want int
	}{
		{text: "lvxing", axes: []string{AxisExtracted}, want: 1},
		{text: "hang zhou", axes: []string{AxisExtracted}, want: 1},
		{text: "西湖", axes: []string{AxisExtracted}, want: 1},
		{text: "xihu", axes: []string{AxisExtracted}, want: 1},
		// 沙漠 starts the beyond-bound CJK run, so the raw-character query
		// still finds the whole-text field; its adjacency tokens do not exist.
		{text: "沙漠", axes: []string{AxisExtracted}, want: 1},
		{text: "漠的", axes: []string{AxisExtracted}, want: 0},
		{text: "mode", axes: []string{AxisExtracted}, want: 0},
		{text: "dunhuang", axes: []string{AxisExtracted}, want: 0},
		{text: "shamo", axes: []string{AxisExtracted}, want: 0},
		{text: "dunhuang", axes: nil, want: 0},
	} {
		_, hits, err := indexer.Query(ctx, QueryRequest{
			WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical,
			Text: probe.text, Axes: probe.axes,
		})
		if err != nil {
			t.Fatalf("bound query %q axes %v: %v", probe.text, probe.axes, err)
		}
		if len(hits) != probe.want {
			t.Fatalf("bound query %q axes %v hits = %+v, want %d", probe.text, probe.axes, hits, probe.want)
		}
	}
}

// cjkMidRunNote is the V4 exit-test note. Every two-character word in it sits
// mid-run or at the end of the run, where the bare unicode61 tokenizer can
// only prefix-match: 杭州 opens the run, 西湖, 备份, and 备注 are interior or
// trailing. The note is a second note body so the fixture note above keeps its
// cross-axis place names.
const cjkMidRunNote = "杭州西湖的备份方案备注"

// TestLexicalProfileV4AnswersTheExitTestQueries pins the V4 feed shape end to
// end through Rebuild and Query: a note containing 杭州西湖的备份方案备注 answers
// 西湖, 备份, and 备注 mid-run and 杭州 at the run start, answers the pinyin
// pairs xihu and beifen, keeps answering the raw full-run query, and never
// answers an unrelated bigram.
func TestLexicalProfileV4AnswersTheExitTestQueries(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	planID := seedCJKFile(t, store, seed)
	seedNoteBody(t, store, seed, planID, cjkMidRunNote)
	indexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:config-pinyin-v4",
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4),
	}
	generation, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:pinyin-v4", seed.RootID)
	if err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	if generation.ProviderProfileDigest != ProfileDigest(DimensionLexical, LexicalProfileV4) {
		t.Fatalf("generation profile digest = %q, want V4", generation.ProviderProfileDigest)
	}

	for _, probe := range []struct {
		text  string
		axes  []string
		axis  string
		want  int
		notes string
	}{
		// The four exit-test words: 杭州 opens the run, 西湖/备份/备注 do not.
		{text: "杭州", axes: []string{AxisNotes}, axis: AxisNotes, want: 1, notes: "run start"},
		{text: "西湖", axes: []string{AxisNotes}, axis: AxisNotes, want: 1, notes: "mid-run"},
		{text: "备份", axes: []string{AxisNotes}, axis: AxisNotes, want: 1, notes: "mid-run"},
		{text: "备注", axes: []string{AxisNotes}, axis: AxisNotes, want: 1, notes: "run end"},
		{text: "州西", axes: []string{AxisNotes}, axis: AxisNotes, want: 1, notes: "adjacent interior pair"},
		// The pinyin pairs for the same words, which V3 could not answer.
		{text: "xihu", axes: []string{AxisNotes}, axis: AxisNotes, want: 1, notes: "mid-run pinyin pair"},
		{text: "beifen", axes: []string{AxisNotes}, axis: AxisNotes, want: 1, notes: "mid-run pinyin pair"},
		// The raw full run still matches, with and without an axis restriction.
		{text: cjkMidRunNote, axes: []string{AxisNotes}, axis: AxisNotes, want: 1, notes: "raw full run"},
		{text: cjkMidRunNote, axes: nil, want: 1, notes: "raw full run, all axes"},
		// Negative probes: a non-adjacent character pair, a non-adjacent
		// pinyin pair, and an unrelated two-character word find nothing.
		{text: "杭西", axes: nil, want: 0, notes: "non-adjacent characters"},
		{text: "zhoubei", axes: nil, want: 0, notes: "non-adjacent syllables"},
		{text: "春晓", axes: nil, want: 0, notes: "unrelated bigram"},
		{text: "chunxiao", axes: nil, want: 0, notes: "unrelated pinyin pair"},
	} {
		_, hits, err := indexer.Query(ctx, QueryRequest{
			WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical,
			Text: probe.text, Axes: probe.axes,
		})
		if err != nil {
			t.Fatalf("query %q (%s): %v", probe.text, probe.notes, err)
		}
		if len(hits) != probe.want {
			t.Fatalf("query %q (%s) hits = %+v, want %d", probe.text, probe.notes, hits, probe.want)
		}
		if probe.want == 0 {
			continue
		}
		if hits[0].SubjectID != planID {
			t.Fatalf("query %q (%s) hit subject = %q, want the CJK file", probe.text, probe.notes, hits[0].SubjectID)
		}
		// A match on the note must be attributed to the notes axis and must
		// still display the untouched raw note text.
		if probe.axis != "" && !axisReported(hits[0].ConstructAxes, probe.axis) {
			t.Errorf("query %q construct axes = %v, want %q", probe.text, hits[0].ConstructAxes, probe.axis)
		}
		if !containsWord(hits[0].Name, "旅行计划.md") {
			t.Errorf("query %q hit name = %q, want the raw display name", probe.text, hits[0].Name)
		}
	}

	// The coverage vocabulary is unchanged: the adjacency tokens are token
	// enrichment inside the existing axes, not a new field.
	coverage, err := indexer.Coverage(ctx, seed.WorkspaceID)
	if err != nil {
		t.Fatalf("coverage: %v", err)
	}
	if len(LexicalCoverageFields()) == 0 {
		t.Fatal("coverage vocabulary is empty")
	}
	for _, invented := range []string{"name_pinyin", "path_pinyin", "notes_pinyin", "descriptions_pinyin",
		"extracted_pinyin", "pinyin", "bigram", "bigrams", "cjk", "adjacency"} {
		if _, ok := coverage.Fields[invented]; ok {
			t.Errorf("coverage invented a %q field", invented)
		}
	}
	if !coverage.Fields[AxisNotes] || !coverage.Fields[AxisName] {
		t.Errorf("coverage fields = %+v, want notes and name present", coverage.Fields)
	}
}

// TestCJKAdjacencyTokensMatchAtRunStartMiddleAndEnd proves the adjacency
// tokens of one field reach every position of a run — start, middle, and end —
// for the raw characters and the pinyin pair, and that a pair never bridges
// the separators between runs.
func TestCJKAdjacencyTokensMatchAtRunStartMiddleAndEnd(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	entryID := mustSearchID(t, sqlite.IDPrefixNamespaceEntry)
	name := cjkMidRunNote + ".md"
	if err := store.Update(ctx, func(tx *sqlite.Tx) error {
		return tx.InsertNamespaceEntry(ctx, &sqlite.NamespaceEntry{
			ID: entryID, WorkspaceID: seed.WorkspaceID, RootID: seed.RootID,
			ParentID: seed.DirEntryID, RawName: []byte(name), DisplayName: name,
			FullPathKey: []byte("Music\x00" + name), EntryType: sqlite.EntryFile,
			Metadata: []byte(`{}`),
		})
	}); err != nil {
		t.Fatalf("insert mid-run file entry: %v", err)
	}
	// A second subject whose note carries two separate runs: no adjacency
	// token may bridge the ASCII text between them.
	seedNoteBody(t, store, seed, entryID, "杭州abc西湖")
	indexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:config-pinyin-v4",
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4),
	}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:pinyin-positions", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}

	for _, probe := range []struct {
		text string
		axis string
		want int
	}{
		// Name field: start, middle, and end of its run.
		{text: "杭州", axis: AxisName, want: 1},
		{text: "西湖", axis: AxisName, want: 1},
		{text: "备份", axis: AxisName, want: 1},
		{text: "备注", axis: AxisName, want: 1},
		{text: "xihu", axis: AxisName, want: 1},
		{text: "beizhu", axis: AxisName, want: 1},
		{text: name, axis: AxisName, want: 1},
		// Path field carries the same run.
		{text: "备注", axis: AxisPath, want: 1},
		{text: "beifen", axis: AxisPath, want: 1},
		// The two-run note: an intra-run pair matches, a pair spanning the
		// ASCII between the runs does not.
		{text: "西湖", axis: AxisNotes, want: 1},
		{text: "xihu", axis: AxisNotes, want: 1},
		{text: "杭西", axis: AxisNotes, want: 0},
		{text: "hangxi", axis: AxisNotes, want: 0},
	} {
		_, hits, err := indexer.Query(ctx, QueryRequest{
			WorkspaceID: seed.WorkspaceID, Dimension: DimensionLexical,
			Text: probe.text, Axes: []string{probe.axis},
		})
		if err != nil {
			t.Fatalf("query %q on %s: %v", probe.text, probe.axis, err)
		}
		if len(hits) != probe.want {
			t.Fatalf("query %q on %s hits = %+v, want %d", probe.text, probe.axis, hits, probe.want)
		}
		if probe.want == 1 && hits[0].SubjectID != entryID {
			t.Fatalf("query %q on %s hit subject = %q, want the mid-run file", probe.text, probe.axis, hits[0].SubjectID)
		}
	}
}

// axisReported reports whether want appears in axes.
func axisReported(axes []string, want string) bool {
	for _, axis := range axes {
		if axis == want {
			return true
		}
	}
	return false
}

// TestLexicalProfileV4CreatesNewGenerationAndRefusesOldOnes pins the
// fail-closed generation binding: changing the feed shape creates a new
// generation, and a generation built under a different lexical profile is
// refused, never reinterpreted. It follows the V1→V2→V3 precedent: an old
// generation recorded under the superseded V3 profile stays addressable and
// is refused by the V4 wiring, and the V4 generation is refused by the V3
// wiring in the other direction.
func TestLexicalProfileV4CreatesNewGenerationAndRefusesOldOnes(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	planID := seedCJKFile(t, store, seed)
	seedCJKNote(t, store, seed, planID)
	configDigest := "sha256:config-pinyin-binding"

	// An "old" generation: recorded under the superseded V3 profile digest.
	// The old profile string is quoted literally so the test documents the
	// refused shape rather than deriving it from the current constant.
	oldDigest := ProfileDigest(DimensionLexical, "fts5-metadata-v3")
	if oldDigest == ProfileDigest(DimensionLexical, LexicalProfileV4) {
		t.Fatal("v3 and v4 lexical profile digests collide")
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

	// The current wiring computes the V4 profile and must refuse the old
	// generation instead of silently serving it.
	newIndexer := &Indexer{
		Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: configDigest,
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4),
	}
	if _, _, err := newIndexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, GenerationID: oldGeneration.ID, Dimension: DimensionLexical, Text: "track",
	}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("query of old-profile generation under V4 wiring = %v, want ErrUnavailable", err)
	}

	// A rebuild under the new feed shape creates a new generation; the old
	// generation row stays addressable in the catalog.
	newGeneration, err := newIndexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:pinyin-new", seed.RootID)
	if err != nil {
		t.Fatalf("V4 rebuild: %v", err)
	}
	if newGeneration.ID == oldGeneration.ID {
		t.Fatal("V4 rebuild reused the old generation")
	}
	if newGeneration.ProviderProfileDigest != ProfileDigest(DimensionLexical, LexicalProfileV4) {
		t.Fatalf("new generation profile digest = %q", newGeneration.ProviderProfileDigest)
	}
	if _, err := store.GetIndexGeneration(ctx, oldGeneration.ID); err != nil {
		t.Fatalf("old generation row must remain readable: %v", err)
	}

	// The new generation serves pinyin and mid-run queries through the newly
	// enriched axes; the old wiring refuses the new generation in the other
	// direction.
	if _, hits, err := newIndexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, GenerationID: newGeneration.ID, Dimension: DimensionLexical,
		Text: "lvxing", Axes: []string{AxisNotes},
	}); err != nil || len(hits) != 1 || hits[0].SubjectID != planID {
		t.Fatalf("V4 generation notes-axis pinyin query = %+v err=%v", hits, err)
	}
	if _, _, err := oldIndexer.Query(ctx, QueryRequest{
		WorkspaceID: seed.WorkspaceID, GenerationID: newGeneration.ID, Dimension: DimensionLexical, Text: "track",
	}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("query of V4 generation under old wiring = %v, want ErrUnavailable", err)
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
