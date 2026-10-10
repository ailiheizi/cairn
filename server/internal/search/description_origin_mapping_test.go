package search

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/search/pinyin"
)

func TestMatchedDescriptionSourceRangesUsesHalfOpenOverlapsAndMerges(t *testing.T) {
	origins := []pinyin.TokenOrigin{
		{StartByte: 0, EndByte: 2, SourceStartByte: 6, SourceEndByte: 8},
		{StartByte: 3, EndByte: 5, SourceStartByte: 0, SourceEndByte: 2},
		{StartByte: 6, EndByte: 8, SourceStartByte: 2, SourceEndByte: 6},
		{StartByte: 9, EndByte: 11, SourceStartByte: 10, SourceEndByte: 12},
	}
	got := matchedDescriptionSourceRanges([]MatchSpan{{StartByte: 1, EndByte: 3}, {StartByte: 4, EndByte: 7}}, origins)
	want := []sourceByteRange{{start: 0, end: 8}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("mapped source intervals = %#v, want %#v", got, want)
	}
	if sourceRangeOverlapsAny(sourceByteRange{start: 8, end: 10}, got) {
		t.Fatal("touching source intervals must not overlap")
	}
	if !sourceRangeOverlapsAny(sourceByteRange{start: 7, end: 9}, got) {
		t.Fatal("crossing source intervals must overlap")
	}
}

func TestMatchedDescriptionSourceRangesMapsMultipleHighlightsAndUnsortedOrigins(t *testing.T) {
	origins := []pinyin.TokenOrigin{
		{StartByte: 0, EndByte: 2, SourceStartByte: 30, SourceEndByte: 32},
		{StartByte: 3, EndByte: 5, SourceStartByte: 10, SourceEndByte: 12},
		{StartByte: 6, EndByte: 8, SourceStartByte: 11, SourceEndByte: 14},
		{StartByte: 9, EndByte: 11, SourceStartByte: 40, SourceEndByte: 42},
	}
	got := matchedDescriptionSourceRanges([]MatchSpan{{StartByte: 1, EndByte: 4}, {StartByte: 7, EndByte: 10}}, origins)
	want := []sourceByteRange{{start: 10, end: 14}, {start: 30, end: 32}, {start: 40, end: 42}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("mapped source intervals = %#v, want %#v", got, want)
	}
	for _, tc := range []struct {
		segment sourceByteRange
		want    bool
	}{{sourceByteRange{start: 14, end: 30}, false}, {sourceByteRange{start: 13, end: 15}, true}, {sourceByteRange{start: 31, end: 33}, true}, {sourceByteRange{start: 32, end: 40}, false}} {
		if got := sourceRangeOverlapsAny(tc.segment, got); got != tc.want {
			t.Errorf("overlap(%#v) = %v, want %v", tc.segment, got, tc.want)
		}
	}
}

func TestVersionedDescriptionLongChineseQueryPreservesSourceResults(t *testing.T) {
	unit := "杭州旅行计划西湖方案"
	body := strings.Repeat(unit, 256)
	mid := len(body) / 2
	engine, path := testVersionedDescriptionDocument(t, "idx_longoriginmapping000000000000", "旅行资料", body, []string{body[:mid], body[mid:]}, nil)
	for _, tc := range []struct {
		query       string
		derivedOnly bool
	}{
		{query: "hangzhou xihu", derivedOnly: true},
		{query: "lvxing fangan", derivedOnly: true},
		{query: "杭州 西湖"},
	} {
		query := tc.query
		hits, err := engine.QueryFiltered(context.Background(), path, query, []string{AxisDescriptions}, Filters{})
		if err != nil || len(hits) != 1 {
			t.Fatalf("long Chinese query %q = %+v, %v", query, hits, err)
		}
		if len(hits[0].Segments) != 2 {
			t.Fatalf("long Chinese query %q mapped %d segments, want both source segments", query, len(hits[0].Segments))
		}
		for _, segment := range hits[0].Segments {
			if tc.derivedOnly && segment.MatchSpans != nil {
				t.Errorf("derived-only query %q fabricated local spans: %+v", query, segment)
			}
		}
	}
}
