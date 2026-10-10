package pinyin

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestEnrichmentAppendixOriginsMapUmlautAndLongHanRun(t *testing.T) {
	text := "吕ü女，" + strings.Repeat("旅行计划", 128)
	appendix, origins := EnrichmentAppendixWithOrigins(text)
	if appendix != EnrichmentAppendix(text) {
		t.Fatalf("appendix changed: got %q want %q", appendix, EnrichmentAppendix(text))
	}
	tokens := strings.Split(appendix, " ")
	if len(tokens) != len(origins) {
		t.Fatalf("origin count = %d, token count = %d", len(origins), len(tokens))
	}
	foundUmlaut := false
	for index, token := range tokens {
		origin := origins[index]
		if token == "nü" {
			foundUmlaut = true
			if text[origin.SourceStartByte:origin.SourceEndByte] != "女" {
				t.Fatalf("umlaut token source = %q, want 女", text[origin.SourceStartByte:origin.SourceEndByte])
			}
		}
	}
	if !foundUmlaut {
		t.Fatalf("appendix has no umlaut form: %q", appendix)
	}
}

func TestEnrichmentAppendixOriginsReproduceExactTokens(t *testing.T) {
	for _, text := range []string{"", "English only", "旅行计划", "标题 旅行计划", "甲乙xyz丙丁", "😀杭州旅行", "吕ü女，" + strings.Repeat("旅行计划", 128)} {
		appendix, origins := EnrichmentAppendixWithOrigins(text)
		if appendix != EnrichmentAppendix(text) {
			t.Fatalf("appendix changed for %q: %q != %q", text, appendix, EnrichmentAppendix(text))
		}
		tokens := strings.Split(appendix, " ")
		if appendix == "" {
			if len(origins) != 0 {
				t.Fatalf("origins for empty appendix %q: %+v", text, origins)
			}
			continue
		}
		if len(tokens) != len(origins) {
			t.Fatalf("origin count for %q = %d, want %d", text, len(origins), len(tokens))
		}
		for i, origin := range origins {
			if origin.StartByte < 0 || origin.EndByte <= origin.StartByte || origin.EndByte > len(appendix) ||
				origin.SourceStartByte < 0 || origin.SourceEndByte <= origin.SourceStartByte || origin.SourceEndByte > len(text) ||
				!utf8.ValidString(text[:origin.SourceStartByte]) || !utf8.ValidString(text[:origin.SourceEndByte]) {
				t.Fatalf("invalid origin for %q token %q: %+v", text, tokens[i], origin)
			}
			if got := appendix[origin.StartByte:origin.EndByte]; got != tokens[i] {
				t.Fatalf("token range = %q, want %q", got, tokens[i])
			}
		}
	}
}
