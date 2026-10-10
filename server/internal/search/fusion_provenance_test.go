package search

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestFusionPreservesDifferentSourcesAndLexicalSpans(t *testing.T) {
	semantic := SegmentRef{SourceType: "ANNOTATION", SourceID: "note-1", SegmentID: "note-1", MatchedText: "travel records", Kind: "NOTE", Producer: "USER", Accepted: true}
	lexical := semantic
	lexical.MatchSpans = []MatchSpan{{StartByte: 0, EndByte: 6}}
	description := SegmentRef{SourceType: "DESCRIPTION", SourceID: "desc-1", SegmentID: "segment-1", MatchedText: "holiday evidence", Kind: "IMPORTED"}
	for _, order := range []string{"semantic-first", "lexical-first"} {
		t.Run(order, func(t *testing.T) {
			a, b := semantic, lexical
			if order == "lexical-first" {
				a, b = b, a
			}
			hit := Hit{SubjectID: "subject-1", Name: "first.txt", ConstructAxes: []string{AxisNotes}, Segments: []SegmentRef{a}}
			mergeHitProvenance(&hit, Hit{SubjectID: "subject-1", Name: "second.txt", ConstructAxes: []string{AxisNotes, AxisDescriptions}, Segments: []SegmentRef{b, description}})
			if hit.Name != "first.txt" || len(hit.Segments) != 2 || len(hit.Segments[0].MatchSpans) != 1 || len(hit.ConstructAxes) != 2 {
				t.Fatalf("overlapping components lost provenance: %+v", hit)
			}
			changed := b
			changed.MatchedText = "a different source revision"
			changed.MatchSpans = nil
			mergeHitProvenance(&hit, Hit{Segments: []SegmentRef{changed}})
			if len(hit.Segments) != 3 || len(hit.Segments[2].MatchSpans) != len(changed.MatchSpans) {
				t.Fatal("different source text must never inherit another source's span")
			}
		})
	}
}

func TestQuerySpansNeverEnterSerializedIndexSources(t *testing.T) {
	ref := SegmentRef{MatchedText: "travel", MatchSpans: []MatchSpan{{StartByte: 0, EndByte: 6}}}
	data, err := json.Marshal(ref)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "MatchSpans") || strings.Contains(string(data), "start_byte") {
		t.Fatalf("query-derived spans entered the rebuildable source feed: %s", data)
	}
}
