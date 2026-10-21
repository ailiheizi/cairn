package search

import (
	"reflect"
	"testing"
)

func TestRankFusedHitsUsesRRFWithoutComponentConcatenation(t *testing.T) {
	lexical := make([]FusedHit, 200)
	lexicalRanks := make(map[string]int, len(lexical))
	for i := range lexical {
		subject := "lexical-" + string(rune('a'+i%26)) + "-" + string(rune('A'+i/26))
		lexical[i] = FusedHit{Hit: Hit{SubjectID: subject, Name: subject}, Dimensions: []string{DimensionLexical}}
		lexicalRanks[subject] = i + 1
	}
	semanticOnly := FusedHit{Hit: Hit{SubjectID: "semantic-only", Name: "semantic display",
		Segments: []SegmentRef{{SourceType: "ANNOTATION", SourceID: "note-1", SegmentID: "segment-1", MatchedText: "exact source"}}},
		Dimensions: []string{DimensionSemantic}}
	all := append(append([]FusedHit(nil), lexical...), semanticOnly)
	ranked := rankFusedHits(all, map[string]map[string]int{
		DimensionLexical:  lexicalRanks,
		DimensionSemantic: {"semantic-only": 1},
	})
	if len(ranked) != 201 || ranked[0].SubjectID != lexical[0].SubjectID || ranked[1].SubjectID != semanticOnly.SubjectID {
		t.Fatalf("rank-one semantic-only subject was buried: first=%q second=%q len=%d", ranked[0].SubjectID, ranked[1].SubjectID, len(ranked))
	}
	if ranked[1].Name != semanticOnly.Name || !reflect.DeepEqual(ranked[1].Segments, semanticOnly.Segments) {
		t.Fatalf("ranking changed authorized display/provenance: %+v", ranked[1])
	}
}

func TestRankFusedHitsDeduplicatesVotesAndUsesSharedEvidence(t *testing.T) {
	hits := []FusedHit{
		{Hit: Hit{SubjectID: "lexical-first"}, Dimensions: []string{DimensionLexical}},
		{Hit: Hit{SubjectID: "shared"}, Dimensions: []string{DimensionLexical, DimensionSemantic}},
		{Hit: Hit{SubjectID: "semantic-first"}, Dimensions: []string{DimensionSemantic}},
	}
	ranks := map[string]map[string]int{
		DimensionLexical:  {"lexical-first": 1, "shared": 2},
		DimensionSemantic: {"semantic-first": 1, "shared": 2},
	}
	got := rankFusedHits(hits, ranks)
	if got[0].SubjectID != "shared" {
		t.Fatalf("shared component evidence should lead: %+v", got)
	}
	// Repeated segment hits from one subject occupy one provider rank and cast
	// only one contribution to the fused score.
	duplicateRanks := rankComponentSubjects([]Hit{
		{SubjectID: "lexical-first"}, {SubjectID: "shared"}, {SubjectID: "shared"},
	})
	if !reflect.DeepEqual(duplicateRanks, map[string]int{"lexical-first": 1, "shared": 2}) {
		t.Fatalf("component subject ranks = %v", duplicateRanks)
	}
	gotDuplicate := rankFusedHits(hits, map[string]map[string]int{
		DimensionLexical:  duplicateRanks,
		DimensionSemantic: {"semantic-first": 1, "shared": 2},
	})
	if !reflect.DeepEqual(subjectOrder(got), subjectOrder(gotDuplicate)) {
		t.Fatalf("duplicate within-component subjects changed ranking: %v vs %v", subjectOrder(got), subjectOrder(gotDuplicate))
	}
}

func TestRankFusedHitsIsDimensionOrderIndependentAndSingleLaneStable(t *testing.T) {
	hits := []FusedHit{
		{Hit: Hit{SubjectID: "c"}}, {Hit: Hit{SubjectID: "a"}}, {Hit: Hit{SubjectID: "b"}},
	}
	first := map[string]map[string]int{
		DimensionLexical:  {"a": 2, "b": 3},
		DimensionSemantic: {"c": 1, "a": 2},
	}
	second := map[string]map[string]int{
		DimensionSemantic: {"c": 1, "a": 2},
		DimensionLexical:  {"a": 2, "b": 3},
	}
	if got, want := subjectOrder(rankFusedHits(hits, first)), subjectOrder(rankFusedHits(hits, second)); !reflect.DeepEqual(got, want) {
		t.Fatalf("dimension map order changed result: %v vs %v", got, want)
	}
	tied := []FusedHit{{Hit: Hit{SubjectID: "b-subject"}}, {Hit: Hit{SubjectID: "a-subject"}}}
	tiedRanks := map[string]map[string]int{
		DimensionSemantic:   {"b-subject": 1},
		DimensionMultimodal: {"a-subject": 1},
	}
	if want := []string{"a-subject", "b-subject"}; !reflect.DeepEqual(subjectOrder(rankFusedHits(tied, tiedRanks)), want) {
		t.Fatalf("stable subject tie-break changed: got %v want %v", subjectOrder(rankFusedHits(tied, tiedRanks)), want)
	}
	singleLane := []FusedHit{{Hit: Hit{SubjectID: "b"}}, {Hit: Hit{SubjectID: "a"}}, {Hit: Hit{SubjectID: "c"}}}
	got := rankFusedHits(singleLane, map[string]map[string]int{DimensionLexical: {"b": 1, "a": 2, "c": 3}})
	if want := []string{"b", "a", "c"}; !reflect.DeepEqual(subjectOrder(got), want) {
		t.Fatalf("single-lane order changed: got %v want %v", subjectOrder(got), want)
	}
}

func TestFuseResultRetainSubjectsCompactsRanksAfterAuthorization(t *testing.T) {
	original := []FusedHit{
		{Hit: Hit{SubjectID: "stale", Name: "stale", Segments: []SegmentRef{{SourceID: "stale-source"}}}, Dimensions: []string{DimensionLexical, DimensionSemantic}},
		{Hit: Hit{SubjectID: "lexical-a", Name: "a"}, Dimensions: []string{DimensionLexical}},
		{Hit: Hit{SubjectID: "lexical-b", Name: "b"}, Dimensions: []string{DimensionLexical}},
		{Hit: Hit{SubjectID: "shared", Name: "shared", Segments: []SegmentRef{{SourceID: "shared-note"}}}, Dimensions: []string{DimensionLexical, DimensionSemantic}},
		{Hit: Hit{SubjectID: "semantic-only", Name: "semantic"}, Dimensions: []string{DimensionSemantic}},
	}
	ranks := map[string]map[string]int{
		DimensionLexical:  {"stale": 1, "lexical-a": 2, "lexical-b": 3, "shared": 4},
		DimensionSemantic: {"stale": 1, "shared": 3, "semantic-only": 2},
	}
	result := FuseResult{originalHits: original, ranksByDimension: ranks,
		Hits: rankFusedHits(original, ranks)}
	allIDs := []string{"stale", "lexical-a", "lexical-b", "shared", "semantic-only"}
	if got := result.RetainAuthorizedSubjects(canonicalSubjectMap(allIDs...)); !reflect.DeepEqual(got, result.Hits) {
		t.Fatalf("identical authorized set changed order or provenance:\n got=%+v\nwant=%+v", got, result.Hits)
	}
	retained := result.RetainAuthorizedSubjects(canonicalSubjectMap("lexical-a", "lexical-b", "shared", "semantic-only", "injected"))
	if len(retained) != 4 {
		t.Fatalf("retained %d hits, want exactly four original authorized subjects: %+v", len(retained), retained)
	}
	for _, hit := range retained {
		if hit.SubjectID == "stale" || hit.SubjectID == "injected" {
			t.Fatalf("unauthorized or absent subject survived: %+v", hit)
		}
	}
	if retained[0].SubjectID != "shared" || retained[0].Dimensions[0] != DimensionLexical || len(retained[0].Segments) != 1 || retained[0].Segments[0].SourceID != "shared-note" {
		t.Fatalf("removed subject still affected ranks or source facts were lost: %+v", retained[0])
	}
	// Removing the lexical-only stale leader promotes lexical-a to rank one;
	// it then ties the semantic-only rank-one result and wins the documented
	// lexical tie-break. Without compaction the semantic result would lead.
	stalePrefix := FuseResult{
		originalHits: []FusedHit{{Hit: Hit{SubjectID: "unresolvable"}}, {Hit: Hit{SubjectID: "lexical-a"}}, {Hit: Hit{SubjectID: "semantic-only"}}},
		ranksByDimension: map[string]map[string]int{
			DimensionLexical:  {"unresolvable": 1, "lexical-a": 2},
			DimensionSemantic: {"semantic-only": 1},
		},
	}
	if got := subjectOrder(stalePrefix.RetainAuthorizedSubjects(canonicalSubjectMap("lexical-a", "semantic-only"))); !reflect.DeepEqual(got, []string{"lexical-a", "semantic-only"}) {
		t.Fatalf("removed prefix still consumed rank or vote: %v", got)
	}
}

func TestFuseResultRetainSubjectsPreservesFilteredSingleLaneOrder(t *testing.T) {
	original := []FusedHit{
		{Hit: Hit{SubjectID: "stale"}},
		{Hit: Hit{SubjectID: "first"}},
		{Hit: Hit{SubjectID: "second"}},
	}
	result := FuseResult{originalHits: original, ranksByDimension: map[string]map[string]int{
		DimensionLexical: {"stale": 1, "first": 2, "second": 3},
	}}
	if got, want := subjectOrder(result.RetainAuthorizedSubjects(canonicalSubjectMap("second", "first"))), []string{"first", "second"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("filtered single-lane order = %v, want %v", got, want)
	}
}

func TestFuseResultRetainsLegacyAliasAsCanonicalCrossLaneSubject(t *testing.T) {
	legacy := FusedHit{Hit: Hit{SubjectID: "legacy-entry", Name: "first display", ConstructAxes: []string{AxisNotes}, Segments: []SegmentRef{
		{SourceType: "ANNOTATION", SourceID: "note", SegmentID: "note", MatchedText: "note provenance"},
	}}, Dimensions: []string{DimensionLexical}}
	stable := FusedHit{Hit: Hit{SubjectID: "stable-subject", Name: "second display", ConstructAxes: []string{AxisDescriptions}, Segments: []SegmentRef{
		{SourceType: "DESCRIPTION", SourceID: "description", SegmentID: "segment", MatchedText: "description provenance"},
	}}, Dimensions: []string{DimensionSemantic}}
	result := FuseResult{
		originalHits: []FusedHit{legacy, stable},
		ranksByDimension: map[string]map[string]int{
			DimensionLexical:  {legacy.SubjectID: 1},
			DimensionSemantic: {stable.SubjectID: 1},
		},
	}
	got := result.RetainAuthorizedSubjects(map[string]string{
		legacy.SubjectID: "stable-subject", stable.SubjectID: "stable-subject",
	})
	if len(got) != 1 || got[0].SubjectID != "stable-subject" {
		t.Fatalf("legacy and stable handles did not merge canonically: %+v", got)
	}
	if got[0].Name != legacy.Name || !reflect.DeepEqual(got[0].Dimensions, []string{DimensionLexical, DimensionSemantic}) ||
		!reflect.DeepEqual(got[0].ConstructAxes, []string{AxisNotes, AxisDescriptions}) || len(got[0].Segments) != 2 ||
		got[0].Segments[0].SourceID != "note" || got[0].Segments[1].SourceID != "description" {
		t.Fatalf("canonical alias merge lost first display or cross-lane provenance: %+v", got[0])
	}
}

func canonicalSubjectMap(ids ...string) map[string]string {
	result := make(map[string]string, len(ids))
	for _, id := range ids {
		result[id] = id
	}
	return result
}

func subjectOrder(hits []FusedHit) []string {
	result := make([]string, len(hits))
	for i := range hits {
		result[i] = hits[i].SubjectID
	}
	return result
}
