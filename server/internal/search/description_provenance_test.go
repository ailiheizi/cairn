package search

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/search/pinyin"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func testVersionedDescriptionDocument(t *testing.T, generationID, title, body string, chunks []string, corrupt func([]*descriptionSourceProvenance)) (*Engine, string) {
	t.Helper()
	field := strings.Join([]string{title, "zh", body, "USER", "user:test"}, " ")
	bodyStart := len(title) + len(" zh ")
	document := sqlite.DescriptionDocument{
		ID: "description_test", WorkspaceID: "workspace_test", SubjectRef: "subject_test",
		Body: body, BodyDigest: sha256Text(body), Revision: 1,
	}
	segments := make([]sqlite.SemanticSegment, 0, len(chunks))
	refs := make([]SegmentRef, 0, len(chunks))
	start := 0
	for ordinal, text := range chunks {
		end := start + len(text)
		span, err := json.Marshal(descriptionSourceSpan{StartByte: start, EndByte: end})
		if err != nil {
			t.Fatal(err)
		}
		segment := sqlite.SemanticSegment{
			ID: "segment_test_" + string(rune('a'+ordinal)), WorkspaceID: document.WorkspaceID,
			DocumentID: document.ID, SubjectRef: document.SubjectRef, DocumentRevision: 1,
			Ordinal: int64(ordinal), Text: text, TextDigest: sha256Text(text),
			SourceSpan: span, SegmentationProfileDigest: sqlite.DescriptionSegmentationProfileDigestV1,
		}
		segments = append(segments, segment)
		refs = append(refs, SegmentRef{
			DescriptionDocumentID: document.ID, SourceType: "DESCRIPTION", SourceID: document.ID,
			SegmentID: segment.ID, Ordinal: int64(ordinal), MatchedText: text,
			Kind: "USER", Producer: "USER", Accepted: true, Language: "zh",
		})
		start = end
	}
	if start != len(body) {
		t.Fatalf("test chunks cover %d bytes, body has %d", start, len(body))
	}
	provenance := verifiedDescriptionSourceProvenance(document, "subject_test", bodyStart, segments)
	for i := range refs {
		if i < len(provenance) {
			refs[i].DescriptionSource = provenance[i]
		}
	}
	if corrupt != nil {
		corrupt(provenance)
		for i := range refs {
			if i < len(provenance) {
				refs[i].DescriptionSource = provenance[i]
			}
		}
	}
	segmentsJSON, err := marshalLexicalSegmentProjection(refs, field)
	if err != nil {
		t.Fatal(err)
	}
	engine := &Engine{Dir: t.TempDir()}
	path, err := engine.Build(context.Background(), generationID, []Document{{
		SubjectID: "subject_test", Name: "description.txt", Descriptions: field,
		DescriptionsPinyin: pinyin.EnrichmentAppendix(field), Segments: segmentsJSON,
	}})
	if err != nil {
		t.Fatalf("build generation: %v", err)
	}
	return engine, path
}

func TestVersionedDescriptionOriginsCrossSegmentsForRawPinyinAndInitials(t *testing.T) {
	engine, path := testVersionedDescriptionDocument(t, "idx_sourceorigins00000000000001", "旅行说明", "重庆", []string{"重", "庆"}, nil)
	for _, query := range []string{"重庆", "zhongqing", "zq"} {
		hits, err := engine.QueryFiltered(context.Background(), path, query, []string{AxisDescriptions}, Filters{})
		if err != nil || len(hits) != 1 || len(hits[0].Segments) != 2 {
			t.Fatalf("query %q = %+v, %v; want one candidate attributed to both source segments", query, hits, err)
		}
		for _, segment := range hits[0].Segments {
			if segment.MatchSpans != nil {
				t.Errorf("cross-segment query %q fabricated segment-local spans: %+v", query, segment)
			}
		}
	}
	hits, err := engine.QueryFiltered(context.Background(), path, "庆", []string{AxisDescriptions}, Filters{})
	if err != nil || len(hits) != 1 || len(hits[0].Segments) != 1 || hits[0].Segments[0].SegmentID != "segment_test_b" || len(hits[0].Segments[0].MatchSpans) == 0 {
		t.Fatalf("single-segment raw source match = %+v, %v", hits, err)
	}
}

func TestVersionedDescriptionDoesNotAttributeTitleOnlyTokenToBodySegment(t *testing.T) {
	engine, path := testVersionedDescriptionDocument(t, "idx_titleorigin00000000000000001", "西湖方案", "杭州西湖方案", []string{"杭州", "西湖方案"}, nil)
	hits, err := engine.QueryFiltered(context.Background(), path, "xihufangan", []string{AxisDescriptions}, Filters{})
	if err != nil || len(hits) != 1 || len(hits[0].Segments) != 0 || !axisReported(hits[0].ConstructAxes, AxisDescriptions) {
		t.Fatalf("title-only pinyin candidate = %+v, %v; want the lexical candidate without a body-segment claim", hits, err)
	}
}

func TestVersionedDescriptionInvalidSourceProjectionOnlyOmitsExplanation(t *testing.T) {
	for _, tc := range []struct {
		name    string
		corrupt func([]*descriptionSourceProvenance)
	}{
		{name: "missing", corrupt: func(provenance []*descriptionSourceProvenance) { provenance[0] = nil }},
		{name: "gap", corrupt: func(provenance []*descriptionSourceProvenance) { provenance[1].SourceStartByte++ }},
		{name: "bad body digest", corrupt: func(provenance []*descriptionSourceProvenance) {
			provenance[0].BodyDigest = "sha256:" + strings.Repeat("0", 64)
		}},
		{name: "bad text digest", corrupt: func(provenance []*descriptionSourceProvenance) {
			provenance[0].TextDigest = "sha256:" + strings.Repeat("0", 64)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			engine, path := testVersionedDescriptionDocument(t, "idx_invalidsource000000000000000", "说明", "旅行计划", []string{"旅行", "计划"}, tc.corrupt)
			hits, err := engine.QueryFiltered(context.Background(), path, "旅行", []string{AxisDescriptions}, Filters{})
			if err != nil || len(hits) != 1 || len(hits[0].Segments) != 0 || !axisReported(hits[0].ConstructAxes, AxisDescriptions) {
				t.Fatalf("invalid span query = %+v, %v; want lexical hit with omitted explanation", hits, err)
			}
		})
	}
}

func TestLegacyDescriptionGenerationDoesNotInventMultiSegmentPinyinOrigin(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	body := "杭州西湖方案"
	field := strings.Join([]string{"西湖方案", "zh", body, "USER", "user:test"}, " ")
	refs := []SegmentRef{
		{DescriptionDocumentID: "description_legacy", SourceType: "DESCRIPTION", SourceID: "description_legacy", SegmentID: "legacy_0", Ordinal: 0, MatchedText: "杭州", Kind: "USER", Accepted: true},
		{DescriptionDocumentID: "description_legacy", SourceType: "DESCRIPTION", SourceID: "description_legacy", SegmentID: "legacy_1", Ordinal: 1, MatchedText: "西湖方案", Kind: "USER", Accepted: true},
	}
	segmentsJSON, err := json.Marshal(refs)
	if err != nil {
		t.Fatal(err)
	}
	path, err := engine.Build(ctx, "idx_legacyprovenance000000000000", []Document{{
		SubjectID: "subject_test", Name: "description.txt", Descriptions: field,
		DescriptionsPinyin: pinyin.EnrichmentAppendix(field), Segments: string(segmentsJSON),
	}})
	if err != nil {
		t.Fatal(err)
	}
	hits, err := engine.QueryFiltered(ctx, path, "xihufangan", []string{AxisDescriptions}, Filters{})
	if err != nil || len(hits) != 1 || len(hits[0].Segments) != 0 || !axisReported(hits[0].ConstructAxes, AxisDescriptions) {
		t.Fatalf("legacy query = %+v, %v; want queryable hit with no fabricated offset", hits, err)
	}
}
