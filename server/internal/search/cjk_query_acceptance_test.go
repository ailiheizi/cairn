package search

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/search/pinyin"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// This acceptance test deliberately exercises only the public Engine build and
// query methods. The small SQL probe checks that the fixture puts unproven
// candidates ahead of the true rows under the actual query expression;
// it does not participate in result retrieval or assertions.
func TestCJKContiguousQueryRejectsUnorderedCandidatesWithoutBreakingPages(t *testing.T) {
	ctx := context.Background()
	const query = "甲乙丙丁戊己庚辛壬癸"
	grams := make([]string, 0, len([]rune(query))-1)
	runes := []rune(query)
	for i := 0; i+1 < len(runes); i++ {
		grams = append(grams, string(runes[i:i+2]))
	}
	// Reverse adjacency order with separators: each individual bigram exists,
	// but no candidate has the original continuous phrase.
	unordered := strings.Join(reverseStrings(grams), " ")
	noisy := strings.TrimSpace(strings.Repeat(unordered+" ", 24))
	docs := make([]Document, 0, 1006)
	for i := 0; i < 1002; i++ {
		text := fmt.Sprintf("%s noise%04d", noisy, i)
		docs = append(docs, Document{
			SubjectID: fmt.Sprintf("false-%04d", i), Name: text,
			NamePinyin: pinyin.EnrichmentAppendix(text), Language: "zh",
		})
	}
	// This complete phrase must remain excluded by the typed filter.
	docs = append(docs, Document{SubjectID: "typed-filter-excluded", Name: query, NamePinyin: pinyin.EnrichmentAppendix(query), Language: "en"})
	for _, subject := range []string{"true-first", "true-second", "true-third"} {
		text := "前缀材料" + query + "后缀材料"
		docs = append(docs, Document{
			SubjectID: subject, Name: text, NamePinyin: pinyin.EnrichmentAppendix(text), Language: "zh",
		})
	}
	engine := &Engine{Dir: t.TempDir()}
	path, err := engine.Build(ctx, "idx_cjkpageacceptance000000000000", docs)
	if err != nil {
		t.Fatalf("build generation: %v", err)
	}
	assertCJKFalseCandidatesRankBeforeTrue(t, path, query, []string{AxisName})

	filters := Filters{Language: "zh"}
	var cursor *PagePosition
	seen := map[string]int{}
	pages := 0
	for {
		page, queryErr := engine.QueryPage(ctx, path, query, []string{AxisName}, filters, PageRequest{Limit: 1, Position: cursor})
		if queryErr != nil {
			t.Fatalf("page %d: %v", pages+1, queryErr)
		}
		pages++
		if len(page.Hits) != 1 {
			t.Fatalf("page %d returned %d hits; want one proven match: %+v", pages, len(page.Hits), page)
		}
		for _, hit := range page.Hits {
			seen[hit.SubjectID]++
		}
		if page.HasMore {
			if page.Next == (PagePosition{}) {
				t.Fatalf("page %d claims more without a cursor: %+v", pages, page)
			}
			position := page.Next
			cursor = &position
		} else {
			if page.Next != (PagePosition{}) {
				t.Fatalf("final page %d carries a cursor: %+v", pages, page)
			}
			break
		}
		if pages > 3 {
			t.Fatalf("pagination did not terminate after proven result set: pages=%d", pages)
		}
	}
	if pages != 3 {
		t.Fatalf("returned %d pages for three proven subjects; want exactly three (has_more must exclude unproven candidates)", pages)
	}
	if len(seen) != 3 || seen["true-first"] != 1 || seen["true-second"] != 1 || seen["true-third"] != 1 || seen["typed-filter-excluded"] != 0 {
		t.Fatalf("paged proven subjects = %#v; want each eligible true row once, with typed-filter row excluded", seen)
	}
}

func reverseStrings(values []string) []string {
	copyOfValues := append([]string(nil), values...)
	for left, right := 0, len(copyOfValues)-1; left < right; left, right = left+1, right-1 {
		copyOfValues[left], copyOfValues[right] = copyOfValues[right], copyOfValues[left]
	}
	return copyOfValues
}

func assertCJKFalseCandidatesRankBeforeTrue(t *testing.T, path, query string, axes []string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	expression := ftsQuery(query, axes)
	rows, err := db.Query(`SELECT subject_id FROM documents WHERE documents MATCH ? ORDER BY rank, rowid`, expression)
	if err != nil {
		t.Fatalf("actual-query candidate-order fixture probe: %v", err)
	}
	defer rows.Close()
	falseBeforeTrue := 0
	firstTrueSeen := false
	for rows.Next() {
		var subject string
		if err := rows.Scan(&subject); err != nil {
			t.Fatal(err)
		}
		if strings.HasPrefix(subject, "true-") {
			firstTrueSeen = true
			break
		}
		if strings.HasPrefix(subject, "false-") {
			falseBeforeTrue++
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !firstTrueSeen || falseBeforeTrue < 1000 {
		t.Fatalf("actual query candidate order had %d unproven false rows before the first true row; want >=1000", falseBeforeTrue)
	}
}

func TestCJKContiguousQueryMapsVerifiedDescriptionPhraseAcrossSegments(t *testing.T) {
	const phrase = "萤火浮标沿北冰洋"
	engine, path := buildCJKThreeSegmentDescription(t, phrase, false)
	hits, err := engine.QueryPage(context.Background(), path, phrase, []string{AxisDescriptions}, Filters{}, PageRequest{Limit: 10})
	if err != nil || len(hits.Hits) != 1 {
		t.Fatalf("cross-segment contiguous phrase = %+v, %v; want one subject", hits, err)
	}
	segments := hits.Hits[0].Segments
	if len(segments) != 3 {
		t.Fatalf("cross-segment provenance = %+v; want all three adjacent fragments from the verified body", segments)
	}
	for _, segment := range segments {
		if segment.DescriptionDocumentID != "description_cjk" || segment.DescriptionSource == nil {
			t.Fatalf("segment lacks verified same-revision source mapping: %+v", segment)
		}
	}
	sort.Slice(segments, func(i, j int) bool {
		return segments[i].DescriptionSource.SourceStartByte < segments[j].DescriptionSource.SourceStartByte
	})
	var reconstructed strings.Builder
	for _, segment := range segments {
		if len(segment.MatchSpans) != 1 {
			t.Fatalf("segment spans = %+v; want its exact local portion of the cross-boundary phrase", segment.MatchSpans)
		}
		span := segment.MatchSpans[0]
		if span.StartByte < 0 || span.EndByte > len(segment.MatchedText) || span.EndByte-span.StartByte >= len(phrase) {
			t.Fatalf("segment span %+v claims the whole phrase or escapes local text %q", span, segment.MatchedText)
		}
		fragment := segment.MatchedText[span.StartByte:span.EndByte]
		if !strings.Contains(phrase, fragment) {
			t.Fatalf("local span %q is not a fragment of the query phrase %q", fragment, phrase)
		}
		reconstructed.WriteString(fragment)
	}
	if got := reconstructed.String(); got != phrase {
		t.Fatalf("source-ordered local span fragments reconstruct %q, want %q", got, phrase)
	}
}

func TestCJKContiguousQueryRejectsReorderedDescriptionProvenance(t *testing.T) {
	const phrase = "萤火浮标沿北冰洋"
	engine, path := buildCJKThreeSegmentDescription(t, phrase, true)
	page, err := engine.QueryPage(context.Background(), path, phrase, []string{AxisDescriptions}, Filters{}, PageRequest{Limit: 10})
	if err != nil || len(page.Hits) != 1 {
		t.Fatalf("malformed provenance query = %+v, %v; want raw lexical subject", page, err)
	}
	if len(page.Hits[0].Segments) != 0 {
		t.Fatalf("reordered invalid source mapping fabricated segment provenance: %+v", page.Hits[0].Segments)
	}
}

func buildCJKThreeSegmentDescription(t *testing.T, phrase string, reverseProjection bool) (*Engine, string) {
	t.Helper()
	// Split by rune boundaries so the query remains continuous in the original
	// body and intersects exactly three adjacent source segments.
	runes := []rune(phrase)
	if len(runes) < 3 {
		t.Fatalf("fixture phrase has %d runes; want at least three", len(runes))
	}
	part1, part2 := string(runes[:2]), string(runes[2:5])
	part3 := string(runes[5:])
	body := "前缀" + phrase + "结束"
	cut1 := len("前缀" + part1)
	cut2 := cut1 + len(part2)
	chunks := []string{body[:cut1], body[cut1:cut2], body[cut2:]}
	title := "资料标题"
	field := strings.Join([]string{title, "zh", body, "USER", "user:test"}, " ")
	bodyStart := len(title) + len(" zh ")
	document := sqlite.DescriptionDocument{ID: "description_cjk", WorkspaceID: "workspace_cjk", SubjectRef: "subject_cjk", Body: body, BodyDigest: sha256Text(body), Revision: 1}
	semanticSegments := make([]sqlite.SemanticSegment, 0, len(chunks))
	refs := make([]SegmentRef, 0, len(chunks))
	start := 0
	for ordinal, chunk := range chunks {
		end := start + len(chunk)
		span, err := json.Marshal(descriptionSourceSpan{StartByte: start, EndByte: end})
		if err != nil {
			t.Fatal(err)
		}
		semanticSegments = append(semanticSegments, sqlite.SemanticSegment{
			ID: fmt.Sprintf("segment_cjk_%d", ordinal), WorkspaceID: document.WorkspaceID,
			DocumentID: document.ID, SubjectRef: document.SubjectRef, DocumentRevision: document.Revision,
			Ordinal: int64(ordinal), Text: chunk, TextDigest: sha256Text(chunk), SourceSpan: span,
			SegmentationProfileDigest: sqlite.DescriptionSegmentationProfileDigestV1,
		})
		refs = append(refs, SegmentRef{DescriptionDocumentID: document.ID, SourceType: "DESCRIPTION", SourceID: document.ID,
			SegmentID: fmt.Sprintf("segment_cjk_%d", ordinal), Ordinal: int64(ordinal), MatchedText: chunk,
			Kind: "USER", Producer: "USER", Accepted: true, Language: "zh"})
		start = end
	}
	if start != len(body) {
		t.Fatalf("chunks cover %d bytes of %d-byte body", start, len(body))
	}
	provenance := verifiedDescriptionSourceProvenance(document, "subject_cjk", bodyStart, semanticSegments)
	for i := range refs {
		refs[i].DescriptionSource = provenance[i]
	}
	if part1+part2+part3 != phrase {
		t.Fatalf("rune fixture parts reconstruct %q, want %q", part1+part2+part3, phrase)
	}
	if reverseProjection {
		for left, right := 0, len(refs)-1; left < right; left, right = left+1, right-1 {
			refs[left], refs[right] = refs[right], refs[left]
		}
	}
	segmentsJSON, err := marshalLexicalSegmentProjection(refs, field)
	if err != nil {
		t.Fatal(err)
	}
	engine := &Engine{Dir: t.TempDir()}
	generation := "idx_cjkorderedsourceaccept000000"
	if reverseProjection {
		generation = "idx_cjkreordersourceaccept00000"
	}
	path, err := engine.Build(context.Background(), generation, []Document{{
		SubjectID: "subject_cjk", Name: "description.txt", Descriptions: field,
		DescriptionsPinyin: pinyin.EnrichmentAppendix(field), Segments: segmentsJSON,
	}})
	if err != nil {
		t.Fatalf("build reordered description generation: %v", err)
	}
	return engine, path
}

func TestCJKContiguousQueryDoesNotJoinNoteAndExtractedSources(t *testing.T) {
	ctx := context.Background()
	const query = "萤火浮标沿北冰洋"
	first, second := "萤火浮", "标沿北冰洋"
	docs := []Document{{
		SubjectID: "split-sources", Name: "separate-sources.txt",
		Notes: first, NotesPinyin: pinyin.EnrichmentAppendix(first),
		Extracted: second, ExtractedPinyin: pinyin.EnrichmentAppendix(second),
		Segments: `[{"source_type":"ANNOTATION","source_id":"note-a","segment_id":"note-segment","ordinal":0,"matched_text":"萤火浮"},{"source_type":"ARTIFACT","source_id":"artifact-b","segment_id":"artifact-segment","ordinal":0,"matched_text":"标沿北冰洋"}]`,
	}}
	engine := &Engine{Dir: t.TempDir()}
	path, err := engine.Build(ctx, "idx_cjkseparatesourceaccept000000", docs)
	if err != nil {
		t.Fatalf("build generation: %v", err)
	}
	page, err := engine.QueryPage(ctx, path, query, []string{AxisNotes, AxisExtracted}, Filters{}, PageRequest{Limit: 10})
	if err != nil {
		t.Fatalf("query page: %v", err)
	}
	if len(page.Hits) != 0 || page.HasMore {
		t.Fatalf("cross-source fragments produced a hit: %+v", page)
	}
}
