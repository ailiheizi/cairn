package controlplane

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/ailiheizi/cairn/server/internal/search"
)

func TestSearchExcerptRetainsContextAndUTF8Boundaries(t *testing.T) {
	text := strings.Repeat("前😀", 40) + "Keep the café travel records together." + strings.Repeat("后😀", 40)
	start := strings.Index(text, "café")
	excerpt := matchedExcerpt(text, []search.MatchSpan{{StartByte: start, EndByte: start + len("café")}})
	if !utf8.ValidString(excerpt) || !strings.Contains(excerpt, "Keep the café travel records") {
		t.Fatalf("excerpt lost context or UTF8 boundaries: %q", excerpt)
	}
	if !strings.HasPrefix(excerpt, "…") || !strings.HasSuffix(excerpt, "…") || utf8.RuneCountInString(excerpt) > 114 {
		t.Fatalf("excerpt is not bounded with visible truncation: %q", excerpt)
	}
	if !strings.Contains(text, strings.Trim(excerpt, "…")) {
		t.Fatalf("excerpt invented source text: %q", excerpt)
	}
}

func TestSearchExcerptRejectsInvalidSpansAndBoundsLongToken(t *testing.T) {
	text := "😀旅行原件"
	for _, span := range []search.MatchSpan{{StartByte: -1, EndByte: 4}, {StartByte: 1, EndByte: 4}, {StartByte: 0, EndByte: 2}, {StartByte: 4, EndByte: 4}, {StartByte: 4, EndByte: len(text) + 1}} {
		if excerpt := matchedExcerpt(text, []search.MatchSpan{span}); excerpt != "" {
			t.Fatalf("invalid span %+v produced %q", span, excerpt)
		}
	}
	if matchedExcerpt(text, nil) != "" {
		t.Fatal("unknown matching offsets must omit the excerpt")
	}
	long := strings.Repeat("旅", 1000)
	excerpt := matchedExcerpt(long, []search.MatchSpan{{StartByte: 0, EndByte: len(long)}})
	if !utf8.ValidString(excerpt) || utf8.RuneCountInString(excerpt) > 114 || !strings.HasSuffix(excerpt, "…") {
		t.Fatalf("long highlighted token escaped the excerpt bound: %q", excerpt)
	}
}
