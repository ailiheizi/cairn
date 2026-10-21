package search

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/server/internal/search/pinyin"
)

func TestCompiledCJKPhraseQueryRequiresOneContinuousRawSource(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	valid := "月蚀之后的青铜海燕沿北冰洋暗流寻找失联的萤火浮标"
	fragmented := "西湖X湖的Y的备Z备份"
	path, err := engine.Build(ctx, "idx_cjkquery000000000000000000000", []Document{
		{SubjectID: "nse_cjkvalid", Name: "valid.txt", Path: "valid.txt", EntryType: "REGULAR_FILE", Notes: valid, NotesPinyin: pinyin.EnrichmentAppendix(valid)},
		{SubjectID: "nse_cjkfragment", Name: "fragment.txt", Path: "fragment.txt", EntryType: "REGULAR_FILE", Notes: fragmented, NotesPinyin: pinyin.EnrichmentAppendix(fragmented)},
	})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	for _, probe := range []struct {
		query string
		want  string
	}{
		{query: "铜海燕", want: "nse_cjkvalid"},
		{query: "萤火浮标", want: "nse_cjkvalid"},
		{query: "沿北冰洋", want: "nse_cjkvalid"},
		{query: "西湖的备份", want: ""},
	} {
		hits, queryErr := engine.Query(ctx, path, probe.query, []string{AxisNotes})
		if queryErr != nil {
			t.Fatalf("query %q: %v", probe.query, queryErr)
		}
		if probe.want == "" {
			if len(hits) != 0 {
				t.Fatalf("query %q false-positive hits = %+v", probe.query, hits)
			}
			continue
		}
		if len(hits) != 1 || hits[0].SubjectID != probe.want || !containsAxis(hits[0].ConstructAxes, AxisNotes) {
			t.Fatalf("query %q hits = %+v, want subject %s with Notes provenance", probe.query, hits, probe.want)
		}
	}
}

func TestCompiledCJKPhraseCandidateLimitAndCursorPolicy(t *testing.T) {
	tokens := queryTokens("萤火浮标")
	if len(tokens) != 1 || len(cjkQueryBigrams(tokens[0])) != 3 {
		t.Fatalf("four-character query expansion = %v / %v", tokens, cjkQueryBigrams(tokens[0]))
	}
	longRunes := make([]rune, 24)
	for i := range longRunes {
		longRunes[i] = rune(0x4E00 + i)
	}
	long := string(longRunes)
	if got := len(cjkQueryBigrams(long)); got != maxCJKQueryBigrams {
		t.Fatalf("long query generated %d bigrams, want bounded first %d", got, maxCJKQueryBigrams)
	}
	if !strings.Contains(ftsQuery(long, []string{AxisName}), `"`+long+`"*`) {
		t.Fatal("bounded expansion dropped the original token-prefix branch")
	}
	shape := QueryShape{WorkspaceID: "workspace", Dimension: DimensionLexical, Text: "萤火浮标"}
	digest, err := shape.Digest()
	if err != nil {
		t.Fatal(err)
	}
	if digest == "" || lexicalCJKQueryPolicy != "cairn.lexical-query.cjk-contiguous.v1" {
		t.Fatalf("query policy binding missing: digest=%q policy=%q", digest, lexicalCJKQueryPolicy)
	}
	legacyPayload, err := json.Marshal(struct {
		WorkspaceID     string   `json:"workspace_id"`
		Dimension       string   `json:"dimension"`
		Fuse            []string `json:"fuse"`
		Text            string   `json:"text"`
		Axes            []string `json:"construct_axes"`
		Filters         Filters  `json:"filters"`
		ImageSubjectRef string   `json:"image_subject_ref"`
	}{WorkspaceID: shape.WorkspaceID, Dimension: shape.Dimension, Text: shape.Text})
	if err != nil {
		t.Fatal(err)
	}
	legacyHash := sha256.Sum256(legacyPayload)
	legacyDigest := hex.EncodeToString(legacyHash[:])
	if digest == legacyDigest {
		t.Fatal("compiled query digest still accepts the legacy ranking policy")
	}
	now := time.Now().UTC()
	scope := AuthorizationScopeDigest(shape.WorkspaceID)
	oldToken, _, err := MintContinuation(ContinuationBinding{
		Scope: scope, Query: legacyDigest, GenerationID: "idx_cursorpolicy000000000000000000", Lane: DimensionLexical, Order: OrderRankRowID,
	}, PagePosition{Lane: DimensionLexical, RowID: 1, Rank: -1, HasRank: true}, now)
	if err != nil {
		t.Fatalf("mint legacy cursor fixture: %v", err)
	}
	_, err = ParseContinuation(oldToken, ContinuationBinding{
		Scope: scope, Query: digest, GenerationID: "idx_cursorpolicy000000000000000000", Lane: DimensionLexical, Order: OrderRankRowID,
	}, now)
	if !errors.Is(err, ErrStaleContinuation) {
		t.Fatalf("legacy-policy cursor error = %v; want ErrStaleContinuation", err)
	}
}

func TestCompiledCJKRawFieldFallbackAndAxisBoundaries(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	path, err := engine.Build(ctx, "idx_cjklegacyfield000000000000000", []Document{
		{SubjectID: "nse_old_note", Name: "old-note.txt", EntryType: "REGULAR_FILE", Notes: "前缀萤火浮标后缀", NotesPinyin: pinyin.EnrichmentAppendix("前缀萤火浮标后缀")},
		{SubjectID: "nse_old_description", Name: "old-description.txt", EntryType: "REGULAR_FILE", Descriptions: "前缀萤火浮标后缀", DescriptionsPinyin: pinyin.EnrichmentAppendix("前缀萤火浮标后缀")},
		{SubjectID: "nse_old_extract", Name: "old-extract.txt", EntryType: "REGULAR_FILE", Extracted: "前缀萤火浮标后缀", ExtractedPinyin: pinyin.EnrichmentAppendix("前缀萤火浮标后缀")},
		{SubjectID: "nse_metadata_only", Name: "metadata.txt", EntryType: "REGULAR_FILE", Metadata: "前缀萤火浮标后缀"},
	})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	wantByAxis := map[string]string{AxisNotes: "nse_old_note", AxisDescriptions: "nse_old_description", AxisExtracted: "nse_old_extract"}
	for _, axis := range []string{AxisNotes, AxisDescriptions, AxisExtracted} {
		hits, queryErr := engine.Query(ctx, path, "萤火浮标", []string{axis})
		if queryErr != nil || len(hits) != 1 || hits[0].SubjectID != wantByAxis[axis] {
			t.Fatalf("legacy %s interior query = %+v, %v; want one hit without segment records", axis, hits, queryErr)
		}
		if len(hits[0].Segments) != 0 {
			t.Fatalf("legacy %s fabricated source mapping: %+v", axis, hits[0].Segments)
		}
	}
	hits, err := engine.Query(ctx, path, "萤火浮标", []string{AxisMetadata})
	if err != nil || len(hits) != 0 {
		t.Fatalf("metadata-only interior query = %+v, %v; want no newly admitted substring", hits, err)
	}
}

func TestCompiledCJKProofPreservesUnicode61RawPrefix(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	marked := "萤\u0301火浮标 Café"
	path, err := engine.Build(ctx, "idx_cjkunicode61prefix000000000000", []Document{{
		SubjectID: "nse_unicode_prefix", Name: "unicode.txt", EntryType: "REGULAR_FILE", Notes: marked,
		NotesPinyin: pinyin.EnrichmentAppendix(marked),
	}})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	matcher, err := newProvenanceMatcher(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, rawPrefix, err := matcher.matches(ctx, marked, []string{"萤火浮标"}, true)
	_ = matcher.Close()
	if err != nil {
		t.Fatal(err)
	}
	if !rawPrefix {
		t.Skip("bundled unicode61 does not treat this combining-mark spelling as the same prefix")
	}
	hits, err := engine.Query(ctx, path, "萤火浮标 cafe", []string{AxisNotes})
	if err != nil || len(hits) != 1 || hits[0].SubjectID != "nse_unicode_prefix" {
		t.Fatalf("unicode61 raw-prefix proof = %+v, %v; want existing prefix hit", hits, err)
	}
}

func TestCompiledCJKSubstringMayBeContinuousInTwoRequestedAxes(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	path, err := engine.Build(ctx, "idx_cjkmixedaxes000000000000000000", []Document{{
		SubjectID: "nse_mixed_axes", Name: "north.txt", Path: "north.txt", EntryType: "REGULAR_FILE",
		NamePinyin: pinyin.EnrichmentAppendix("north.txt"), Notes: "前缀萤火浮标后缀",
		NotesPinyin: pinyin.EnrichmentAppendix("前缀萤火浮标后缀"),
	}})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	hits, err := engine.Query(ctx, path, "north 萤火浮标", []string{AxisName, AxisNotes})
	if err != nil || len(hits) != 1 || hits[0].SubjectID != "nse_mixed_axes" {
		t.Fatalf("mixed-axis AND query = %+v, %v; want one hit", hits, err)
	}
}

func TestCompiledCJKPrefixAndExactSpanAreMerged(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	body := "萤火浮标在海边"
	path, err := engine.Build(ctx, "idx_cjkspans000000000000000000000", []Document{{
		SubjectID: "nse_span_merge", Name: "span.txt", EntryType: "REGULAR_FILE", Descriptions: body,
		DescriptionsPinyin: pinyin.EnrichmentAppendix(body),
		Segments:           provenanceJSON(t, SegmentRef{SourceType: "DESCRIPTION", DescriptionDocumentID: "description-a", SourceID: "description-a", SegmentID: "segment-a", Ordinal: 0, MatchedText: body}),
	}})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	hits, err := engine.Query(ctx, path, "萤火浮标", []string{AxisDescriptions})
	if err != nil || len(hits) != 1 || len(hits[0].Segments) != 1 {
		t.Fatalf("query = %+v, %v; want one description source", hits, err)
	}
	spans := hits[0].Segments[0].MatchSpans
	if len(spans) != 1 || spans[0] != (MatchSpan{StartByte: 0, EndByte: len("萤火浮标")}) {
		t.Fatalf("merged phrase spans = %+v; want exactly one 0..%d span", spans, len("萤火浮标"))
	}
}

func TestCompiledCJKNameHitDoesNotAttributeExtractedInteriorPastAppendixBound(t *testing.T) {
	ctx := context.Background()
	query := "萤火浮标"
	beforeBound := strings.Repeat("界", extractedPinyinEnrichmentBound/len("界"))
	extracted := beforeBound + "界" + query
	engine := &Engine{Dir: t.TempDir()}
	path, err := engine.Build(ctx, "idx_cjkextractboundname000000000000", []Document{{
		SubjectID: "nse_name_only", Name: query + "-notes.txt", EntryType: "REGULAR_FILE",
		NamePinyin: pinyin.EnrichmentAppendix(query + "-notes.txt"),
		Extracted:  extracted, ExtractedPinyin: boundedPinyinEnrichment(extracted),
		Segments: provenanceJSON(t, SegmentRef{SourceType: "ARTIFACT", SourceID: "artifact-a", SegmentID: "artifact-a", MatchedText: extracted}),
	}})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	hits, err := engine.Query(ctx, path, query, []string{AxisName, AxisExtracted})
	if err != nil || len(hits) != 1 || hits[0].SubjectID != "nse_name_only" {
		t.Fatalf("name-proven query = %+v, %v; want the name hit", hits, err)
	}
	if !containsAxis(hits[0].ConstructAxes, AxisName) || containsAxis(hits[0].ConstructAxes, AxisExtracted) {
		t.Fatalf("construct axes = %v; want Name only because Extracted occurrence is beyond its appendix bound", hits[0].ConstructAxes)
	}
	if len(hits[0].Segments) != 0 {
		t.Fatalf("unindexed Extracted interior fabricated source spans: %+v", hits[0].Segments)
	}
}

func TestCompiledCJKNameHitDoesNotAttributeExtractedPhraseCrossingAppendixBound(t *testing.T) {
	ctx := context.Background()
	query := "萤火浮标"
	// Place the phrase's first rune three bytes before the bound. Its remaining
	// runes are outside the indexed appendix, and the preceding Han rune keeps
	// the query from being an old token-prefix match.
	prefix := strings.Repeat("界", (extractedPinyinEnrichmentBound-6)/len("界")) + "x界"
	if len(prefix) != extractedPinyinEnrichmentBound-3 {
		t.Fatalf("test prefix ends at byte %d, want phrase start at bound-3", len(prefix))
	}
	extracted := prefix + query
	engine := &Engine{Dir: t.TempDir()}
	path, err := engine.Build(ctx, "idx_cjkextractboundcross000000000", []Document{{
		SubjectID: "nse_name_cross_bound", Name: query + "-notes.txt", EntryType: "REGULAR_FILE",
		NamePinyin: pinyin.EnrichmentAppendix(query + "-notes.txt"),
		Extracted:  extracted, ExtractedPinyin: boundedPinyinEnrichment(extracted),
		Segments: provenanceJSON(t, SegmentRef{SourceType: "ARTIFACT", SourceID: "artifact-cross-bound", SegmentID: "artifact-cross-bound", MatchedText: extracted}),
	}})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	hits, err := engine.Query(ctx, path, query, []string{AxisName, AxisExtracted})
	if err != nil || len(hits) != 1 || hits[0].SubjectID != "nse_name_cross_bound" {
		t.Fatalf("name-proven crossing-bound query = %+v, %v; want the name hit", hits, err)
	}
	if !containsAxis(hits[0].ConstructAxes, AxisName) || containsAxis(hits[0].ConstructAxes, AxisExtracted) || len(hits[0].Segments) != 0 {
		t.Fatalf("cross-boundary phrase gained Extracted attribution: axes=%v segments=%+v", hits[0].ConstructAxes, hits[0].Segments)
	}
}

func TestCompiledCJKExtractedBoundPreservesOnlyVerifiedInteriorAndLegacyPrefix(t *testing.T) {
	ctx := context.Background()
	query := "萤火浮标"
	beforeBound := strings.Repeat("界", extractedPinyinEnrichmentBound/len("界"))
	legacyPrefix := beforeBound + " " + query
	engine := &Engine{Dir: t.TempDir()}
	path, err := engine.Build(ctx, "idx_cjkextractboundproof0000000000", []Document{
		{
			SubjectID: "nse_unknown_offsets", Name: "unknown.txt", EntryType: "REGULAR_FILE",
			NamePinyin: pinyin.EnrichmentAppendix("unknown.txt"), Extracted: "前缀萤火浮标后缀",
			ExtractedPinyin: pinyin.EnrichmentAppendix("前缀萤火浮标后缀"),
			Segments:        provenanceJSON(t, SegmentRef{SourceType: "ARTIFACT", SourceID: "artifact-unknown", SegmentID: "artifact-unknown", MatchedText: "错配萤火浮标文本"}),
		},
		{
			SubjectID: "nse_legacy_raw_prefix", Name: "prefix.txt", EntryType: "REGULAR_FILE",
			NamePinyin: pinyin.EnrichmentAppendix("prefix.txt"), Extracted: legacyPrefix,
			ExtractedPinyin: boundedPinyinEnrichment(legacyPrefix),
			Segments:        provenanceJSON(t, SegmentRef{SourceType: "ARTIFACT", SourceID: "artifact-prefix", SegmentID: "artifact-prefix", MatchedText: legacyPrefix}),
		},
	})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	hits, err := engine.Query(ctx, path, query, []string{AxisExtracted})
	if err != nil || len(hits) != 2 {
		t.Fatalf("Extracted results = %+v, %v; want the unknown-offset interior and raw-prefix row", hits, err)
	}
	bySubject := make(map[string]Hit, len(hits))
	for _, hit := range hits {
		bySubject[hit.SubjectID] = hit
	}
	unknown := bySubject["nse_unknown_offsets"]
	if unknown.SubjectID == "" || !containsAxis(unknown.ConstructAxes, AxisExtracted) || len(unknown.Segments) != 0 {
		t.Fatalf("valid raw-field hit with unknown artifact mapping = %+v; want Extracted axis and no fabricated source", unknown)
	}
	prefixHit := bySubject["nse_legacy_raw_prefix"]
	if prefixHit.SubjectID == "" || !containsAxis(prefixHit.ConstructAxes, AxisExtracted) || len(prefixHit.Segments) != 1 {
		t.Fatalf("raw-prefix explanation was lost: %+v", prefixHit)
	}
	spans := prefixHit.Segments[0].MatchSpans
	if len(spans) != 1 || spans[0].StartByte < extractedPinyinEnrichmentBound || spans[0].EndByte-spans[0].StartByte != len(query) {
		t.Fatalf("legacy raw-prefix spans = %+v; want one exact span beyond byte bound %d", spans, extractedPinyinEnrichmentBound)
	}
}

func TestCompiledCJKDescriptionMergesCJKAndLatinSourceExplanations(t *testing.T) {
	ctx := context.Background()
	query := "萤火浮标 along"
	body := "萤火浮标 along north"
	engine, path := testVersionedDescriptionDocument(t, "idx_cjkmergedescription0000000000", "Notes", body, []string{body}, nil)
	hits, err := engine.Query(ctx, path, query, []string{AxisDescriptions})
	if err != nil || len(hits) != 1 || len(hits[0].Segments) != 1 {
		t.Fatalf("mixed CJK/Latin description query = %+v, %v", hits, err)
	}
	wantCJK := MatchSpan{StartByte: 0, EndByte: len("萤火浮标")}
	wantLatin := MatchSpan{StartByte: len("萤火浮标 "), EndByte: len("萤火浮标 along")}
	spans := hits[0].Segments[0].MatchSpans
	if len(spans) != 2 || spans[0] != wantCJK || spans[1] != wantLatin {
		t.Fatalf("merged source spans = %+v; want exact CJK+Latin spans %+v and %+v", spans, wantCJK, wantLatin)
	}
}
