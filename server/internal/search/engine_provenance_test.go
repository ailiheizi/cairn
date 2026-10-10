package search

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/search/pinyin"
)

func provenanceJSON(t *testing.T, refs ...SegmentRef) string {
	t.Helper()
	encoded, err := json.Marshal(refs)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func TestQueryFilteredProjectsOnlyRequestedTextAxisProvenance(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	path, err := engine.Build(ctx, "idx_provenanceaxes000000000000000", []Document{{
		SubjectID: "subject-axes", Name: "file.txt", Notes: "旅行行程备注",
		Descriptions: "旅行行程说明",
		Segments: provenanceJSON(t,
			SegmentRef{SourceType: "ANNOTATION", SourceID: "note-1", SegmentID: "note-1", MatchedText: "旅行行程备注", Kind: "NOTE", Producer: "USER", Accepted: true},
			SegmentRef{SourceType: "DESCRIPTION", SourceID: "desc-1", SegmentID: "desc-seg-1", MatchedText: "旅行行程说明", Kind: "USER", Producer: "USER", Accepted: true},
			SegmentRef{SourceType: "ARTIFACT", SourceID: "artifact-1", SegmentID: "artifact-1", MatchedText: "旅行行程提取", Kind: "EXTRACT", Producer: "processor:v1", Accepted: true},
			SegmentRef{SourceType: "FILENAME", SourceID: "file-1", SegmentID: "file-1", MatchedText: "旅行行程.txt", Kind: "FILENAME", Producer: "CATALOG", Accepted: true},
		),
	}})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	hits, err := engine.QueryFiltered(ctx, path, "旅行", []string{AxisNotes}, Filters{})
	if err != nil || len(hits) != 1 {
		t.Fatalf("notes query = %+v, %v", hits, err)
	}
	if len(hits[0].Segments) != 1 || hits[0].Segments[0].SourceID != "note-1" {
		t.Fatalf("notes provenance = %+v, want only note-1", hits[0].Segments)
	}
	if len(hits[0].ConstructAxes) != 1 || hits[0].ConstructAxes[0] != AxisNotes {
		t.Fatalf("notes construct axes = %v, want only notes", hits[0].ConstructAxes)
	}
}

func TestQueryFilteredDoesNotInventPinyinAcrossDescriptionSegmentBoundary(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	left := SegmentRef{
		DescriptionDocumentID: "description-left", SourceType: "DESCRIPTION", SourceID: "description-left",
		SegmentID: "segment-left", MatchedText: "旅行", Kind: "USER", Producer: "USER", Accepted: true,
	}
	right := SegmentRef{
		DescriptionDocumentID: "description-right", SourceType: "DESCRIPTION", SourceID: "description-right",
		SegmentID: "segment-right", MatchedText: "西湖", Kind: "IMPORTED", Producer: "import:notes", Accepted: true,
	}
	joined := left.MatchedText + right.MatchedText
	path, err := engine.Build(ctx, "idx_provenancejoin0000000000000", []Document{{
		SubjectID: "subject-joined", Name: "descriptions.txt", Descriptions: joined,
		DescriptionsPinyin: pinyin.EnrichmentAppendix(joined), Segments: provenanceJSON(t, left, right),
	}})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	hits, err := engine.QueryFiltered(ctx, path, "lvxingxihu", []string{AxisDescriptions}, Filters{})
	if err != nil || len(hits) != 1 {
		t.Fatalf("joined description query = %+v, %v", hits, err)
	}
	if len(hits[0].Segments) != 0 {
		t.Fatalf("cross-boundary pinyin provenance = %+v, want no individual segment claim", hits[0].Segments)
	}
}

func TestQueryFilteredDescriptionAttributionDoesNotInventSegmentRunPrefix(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	refs := provenanceJSON(t,
		SegmentRef{DescriptionDocumentID: "description-a", SourceType: "DESCRIPTION", SourceID: "description-a", SegmentID: "a-0", Ordinal: 0, MatchedText: "西湖方案", Kind: "USER", Producer: "USER", Accepted: true},
		SegmentRef{DescriptionDocumentID: "description-b", SourceType: "DESCRIPTION", SourceID: "description-b", SegmentID: "b-0", Ordinal: 0, MatchedText: "杭州", Kind: "IMPORTED", Producer: "import:notes", Accepted: true},
		SegmentRef{DescriptionDocumentID: "description-b", SourceType: "DESCRIPTION", SourceID: "description-b", SegmentID: "b-1", Ordinal: 1, MatchedText: "西湖方案", Kind: "IMPORTED", Producer: "import:notes", Accepted: true},
	)
	field := "西湖方案 杭州西湖方案"
	path, err := engine.Build(ctx, "idx_provenancewhole000000000000", []Document{{
		SubjectID: "subject-whole", Name: "description.txt", Descriptions: field,
		DescriptionsPinyin: pinyin.EnrichmentAppendix(field), Segments: refs,
	}})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	hits, err := engine.QueryFiltered(ctx, path, "xihufangan", []string{AxisDescriptions}, Filters{})
	if err != nil || len(hits) != 1 {
		t.Fatalf("whole-description query = %+v, %v", hits, err)
	}
	if len(hits[0].Segments) != 1 || hits[0].Segments[0].DescriptionDocumentID != "description-a" {
		t.Fatalf("whole-description provenance = %+v, want only complete description-a", hits[0].Segments)
	}
}

func TestQueryFilteredDescriptionEnrichmentKeepsSourceProvenance(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	ref := SegmentRef{
		DescriptionDocumentID: "description-1", SourceType: "DESCRIPTION", SourceID: "description-1",
		SegmentID: "segment-1", MatchedText: "杭州旅行计划与西湖", Kind: "AI_SUMMARY",
		Producer: "model:summary-v2", Accepted: false, Language: "zh",
	}
	path, err := engine.Build(ctx, "idx_provenancedesc000000000000000", []Document{{
		SubjectID: "subject-desc", Name: "notes.txt", Descriptions: ref.MatchedText,
		DescriptionsPinyin: pinyin.EnrichmentAppendix(ref.MatchedText), Segments: provenanceJSON(t, ref),
	}})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	for _, query := range []string{"lvxing", "xihu", "西湖"} {
		hits, queryErr := engine.QueryFiltered(ctx, path, query, []string{AxisDescriptions}, Filters{})
		if queryErr != nil || len(hits) != 1 {
			t.Fatalf("description query %q = %+v, %v", query, hits, queryErr)
		}
		if !axisReported(hits[0].ConstructAxes, AxisDescriptions) {
			t.Errorf("description query %q construct axes = %v", query, hits[0].ConstructAxes)
		}
		if len(hits[0].Segments) != 1 {
			t.Fatalf("description query %q provenance = %+v", query, hits[0].Segments)
		}
		got := hits[0].Segments[0]
		if got.MatchedText != ref.MatchedText || got.Kind != ref.Kind || got.Producer != ref.Producer || got.Accepted != ref.Accepted {
			t.Errorf("description query %q provenance = %+v, want original source fields %+v", query, got, ref)
		}
	}
}

func TestQueryFilteredExtractedPinyinRespectsJoinedFieldBound(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	text := "旅行计划"
	filler := strings.Repeat("填", extractedPinyinEnrichmentBound)
	joined := text + " " + filler + " " + text
	refs := provenanceJSON(t,
		SegmentRef{SourceType: "ARTIFACT", SourceID: "artifact-before", SegmentID: "artifact-before", MatchedText: text, Kind: "EXTRACT", Producer: "processor:v1", Accepted: true},
		SegmentRef{SourceType: "ARTIFACT", SourceID: "artifact-middle", SegmentID: "artifact-middle", MatchedText: filler, Kind: "EXTRACT", Producer: "processor:v1", Accepted: true},
		SegmentRef{SourceType: "ARTIFACT", SourceID: "artifact-after", SegmentID: "artifact-after", MatchedText: text, Kind: "EXTRACT", Producer: "processor:v1", Accepted: true},
	)
	path, err := engine.Build(ctx, "idx_provenancebound00000000000000", []Document{{
		SubjectID: "subject-bound", Name: "extract.txt", Extracted: joined,
		ExtractedPinyin: boundedPinyinEnrichment(joined), Segments: refs,
	}})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	hits, err := engine.QueryFiltered(ctx, path, "lvxing", []string{AxisExtracted}, Filters{})
	if err != nil || len(hits) != 1 {
		t.Fatalf("in-bound extracted query = %+v, %v", hits, err)
	}
	if len(hits[0].Segments) != 1 || hits[0].Segments[0].SourceID != "artifact-before" {
		t.Fatalf("extracted provenance = %+v, want only in-bound artifact-before", hits[0].Segments)
	}
}

func TestQueryFilteredSegmentAttributionUsesTokenPrefixNotInteriorSubstring(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	path, err := engine.Build(ctx, "idx_provenanceprefix000000000000", []Document{{
		SubjectID: "subject-prefix", Name: "prefix.txt", Notes: "avel note", Descriptions: "travel notes",
		Segments: provenanceJSON(t, SegmentRef{SourceType: "DESCRIPTION", SourceID: "desc-prefix", SegmentID: "segment-prefix", MatchedText: "travel notes", Kind: "USER", Producer: "USER", Accepted: true}),
	}})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	for _, probe := range []struct {
		query string
		want  int
	}{{"trav", 1}, {"avel", 0}} {
		hits, queryErr := engine.QueryFiltered(ctx, path, probe.query, nil, Filters{})
		if queryErr != nil || len(hits) != 1 {
			t.Fatalf("query %q should still return lexical row: %+v %v", probe.query, hits, queryErr)
		}
		if got := len(hits[0].Segments); got != probe.want {
			t.Errorf("query %q segment count = %d, want %d (%+v)", probe.query, got, probe.want, hits[0].Segments)
		}
		if probe.query == "avel" && axisReported(hits[0].ConstructAxes, AxisDescriptions) {
			t.Errorf("interior query %q falsely attributes descriptions axis: %v", probe.query, hits[0].ConstructAxes)
		}
	}
}

func TestQueryFilteredSegmentAttributionKeepsCombiningMarkInsideToken(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	path, err := engine.Build(ctx, "idx_provenancecombining00000000000", []Document{{
		SubjectID: "subject-combining", Name: "prefix.txt", Notes: "bar note", Descriptions: "foo\u0301bar",
		Segments: provenanceJSON(t, SegmentRef{SourceType: "DESCRIPTION", SourceID: "desc-combining", SegmentID: "segment-combining", MatchedText: "foo\u0301bar", Kind: "USER", Producer: "USER", Accepted: true}),
	}})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	hits, err := engine.QueryFiltered(ctx, path, "bar", nil, Filters{})
	if err != nil || len(hits) != 1 {
		t.Fatalf("notes query = %+v, %v", hits, err)
	}
	if len(hits[0].Segments) != 0 || axisReported(hits[0].ConstructAxes, AxisDescriptions) {
		t.Fatalf("combining-mark interior attribution = axes %v segments %+v", hits[0].ConstructAxes, hits[0].Segments)
	}
}

func TestQueryFilteredSegmentAttributionKeepsPrivateUseCharacterInsideToken(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	path, err := engine.Build(ctx, "idx_provenanceprivate00000000000", []Document{{
		SubjectID: "subject-private", Name: "private.txt", Notes: "bar note", Descriptions: "foo\ue000bar",
		Segments: provenanceJSON(t, SegmentRef{SourceType: "DESCRIPTION", SourceID: "desc-private", SegmentID: "segment-private", MatchedText: "foo\ue000bar", Kind: "USER", Producer: "USER", Accepted: true}),
	}})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	hits, err := engine.QueryFiltered(ctx, path, "bar", nil, Filters{})
	if err != nil || len(hits) != 1 {
		t.Fatalf("notes query = %+v, %v", hits, err)
	}
	if len(hits[0].Segments) != 0 || axisReported(hits[0].ConstructAxes, AxisDescriptions) {
		t.Fatalf("private-use interior attribution = axes %v segments %+v", hits[0].ConstructAxes, hits[0].Segments)
	}
}

func TestQueryFilteredFTS5MatchSpansUseOriginalUTF8ByteRanges(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	text := "😀 e\u0301 前缀 café and 旅行计划 \x01RW_OPEN\x02 ending"
	ref := SegmentRef{SourceType: "ANNOTATION", SourceID: "note-span", SegmentID: "note-span", MatchedText: text, Kind: "NOTE", Producer: "USER", Accepted: true}
	path, err := engine.Build(ctx, "idx_provenancespan00000000000000", []Document{{
		SubjectID: "subject-span", Name: "span.txt", Notes: text, Segments: provenanceJSON(t, ref),
	}})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	for _, probe := range []struct{ query, wanted string }{{"cafe", "café"}, {"旅行", "旅行"}} {
		hits, queryErr := engine.QueryFiltered(ctx, path, probe.query, []string{AxisNotes}, Filters{})
		if queryErr != nil || len(hits) != 1 || len(hits[0].Segments) != 1 {
			t.Fatalf("query %q = %+v, %v", probe.query, hits, queryErr)
		}
		spans := hits[0].Segments[0].MatchSpans
		if len(spans) == 0 {
			t.Fatalf("query %q has no source byte span", probe.query)
		}
		for _, span := range spans {
			if span.StartByte < 0 || span.EndByte <= span.StartByte || span.EndByte > len(text) {
				t.Fatalf("query %q invalid span %+v", probe.query, span)
			}
		}
		found := false
		for _, span := range spans {
			if strings.Contains(text[span.StartByte:span.EndByte], probe.wanted) {
				found = true
			}
		}
		if !found {
			t.Fatalf("query %q spans %+v do not slice %q from %q", probe.query, spans, probe.wanted, text)
		}
	}
}

func TestQueryFilteredFTS5SpansOnlyCoverMatchedTokenPrefixes(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	text := "travel notes and travel plans"
	path, err := engine.Build(ctx, "idx_provenancespanprefix000000000", []Document{{
		SubjectID: "subject-span-prefix", Name: "span.txt", Notes: text,
		Segments: provenanceJSON(t, SegmentRef{SourceType: "ANNOTATION", SourceID: "note", SegmentID: "note", MatchedText: text}),
	}})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	hits, err := engine.QueryFiltered(ctx, path, "trav", []string{AxisNotes}, Filters{})
	if err != nil || len(hits) != 1 || len(hits[0].Segments) != 1 {
		t.Fatalf("Query: %+v %v", hits, err)
	}
	spans := hits[0].Segments[0].MatchSpans
	if len(spans) != 2 || text[spans[0].StartByte:spans[0].EndByte] != "travel" || text[spans[1].StartByte:spans[1].EndByte] != "travel" {
		t.Fatalf("prefix spans = %+v", spans)
	}
}

func BenchmarkQueryProvenanceThousandSmallSources(b *testing.B) {
	ctx := context.Background()
	matcher, err := newProvenanceMatcher(ctx)
	if err != nil {
		b.Fatal(err)
	}
	defer matcher.Close()
	refs := make([]SegmentRef, 1000)
	for i := range refs {
		refs[i] = SegmentRef{SourceType: "ANNOTATION", SourceID: "note", MatchedText: "travel notes for café and archive"}
	}
	tokens := queryTokens("travel cafe")
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, ref := range refs {
			_, _, err := matcher.matches(ctx, ref.MatchedText, tokens, true)
			if err != nil {
				b.Fatal(err)
			}
		}
	}
}

func BenchmarkQueryProvenanceLongSegment(b *testing.B) {
	ctx := context.Background()
	matcher, err := newProvenanceMatcher(ctx)
	if err != nil {
		b.Fatal(err)
	}
	defer matcher.Close()
	text := strings.Repeat("ordinary extracted text ", 20*1024) + " café "
	tokens := queryTokens("cafe")
	b.SetBytes(int64(len(text)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _, err := matcher.matches(ctx, text, tokens, true)
		if err != nil {
			b.Fatal(err)
		}
	}
}
