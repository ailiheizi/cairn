package search

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"unicode"
)

const lexicalCJKQueryPolicy = "cairn.lexical-query.cjk-contiguous.v1"
const maxCJKQueryBigrams = 16

func hanPhraseToken(token string) bool {
	runes := []rune(token)
	if len(runes) < 3 {
		return false
	}
	for _, r := range runes {
		if !unicode.Is(unicode.Han, r) {
			return false
		}
	}
	return true
}

func containsHanPhrase(tokens []string) bool {
	for _, token := range tokens {
		if hanPhraseToken(token) {
			return true
		}
	}
	return false
}

func cjkQueryBigrams(token string) []string {
	runes := []rune(token)
	seen := make(map[string]struct{}, maxCJKQueryBigrams)
	out := make([]string, 0, maxCJKQueryBigrams)
	for i := 0; i+1 < len(runes) && len(out) < maxCJKQueryBigrams; i++ {
		bigram := string(runes[i : i+2])
		if _, ok := seen[bigram]; ok {
			continue
		}
		seen[bigram] = struct{}{}
		out = append(out, bigram)
	}
	return out
}

func cjkCandidateProof(ctx context.Context, matcher *provenanceMatcher, tokens, axes []string, fields map[string]string) (bool, error) {
	for _, token := range tokens {
		if !hanPhraseToken(token) {
			continue
		}
		eligible := false
		for axis, text := range fields {
			if !axisAllowed(axis, axes) {
				continue
			}
			_, prefixMatch, err := matcher.matches(ctx, text, []string{token}, true)
			if err != nil {
				return false, err
			}
			if prefixMatch || cjkInteriorAllowed(axis, text, token) {
				eligible = true
				break
			}
		}
		if !eligible {
			return false, nil
		}
	}
	return true, nil
}

func decodeLexicalSegments(raw string) []SegmentRef {
	var projection lexicalSegmentProjection
	if err := json.Unmarshal([]byte(raw), &projection); err == nil && projection.SchemaVersion != 0 {
		return projection.Segments
	}
	var segments []SegmentRef
	_ = json.Unmarshal([]byte(raw), &segments)
	return segments
}

func verifiedDescriptionPhraseRanges(field, segmentsJSON, subjectID, token string) []sourceByteRange {
	segments := decodeLexicalSegments(segmentsJSON)
	var projection lexicalSegmentProjection
	if err := json.Unmarshal([]byte(segmentsJSON), &projection); err != nil || projection.SchemaVersion != lexicalSegmentProjectionSchemaV1 {
		return nil
	}
	ranges := verifiedDescriptionFieldRanges(field, projection.DescriptionsFieldHash, segments, subjectID)
	if ranges == nil {
		return nil
	}
	var verified []sourceByteRange
	for start := 0; start < len(field); {
		rel := strings.Index(field[start:], token)
		if rel < 0 {
			break
		}
		match := sourceByteRange{start: start + rel, end: start + rel + len(token)}
		for _, segment := range segments {
			if segment.SourceType != "DESCRIPTION" || segment.DescriptionSource == nil {
				continue
			}
			if _, ok := ranges[segment.SegmentID]; !ok {
				continue
			}
			// The existing validator already proves the complete, contiguous
			// source body. Never join ranges from different documents here.
			source := segment.DescriptionSource
			if source.BodyFieldStartByte <= match.start && match.end <= source.BodyFieldEndByte {
				verified = append(verified, match)
				break
			}
		}
		start = match.start + 1
	}
	return verified
}

func mergeSourceByteRanges(ranges []sourceByteRange) []sourceByteRange {
	if len(ranges) < 2 {
		return ranges
	}
	sort.Slice(ranges, func(i, j int) bool {
		if ranges[i].start == ranges[j].start {
			return ranges[i].end < ranges[j].end
		}
		return ranges[i].start < ranges[j].start
	})
	merged := ranges[:1]
	for _, next := range ranges[1:] {
		last := &merged[len(merged)-1]
		if next.start <= last.end {
			last.end = maxInt(last.end, next.end)
		} else {
			merged = append(merged, next)
		}
	}
	return merged
}

func cjkPhraseSpans(text string, tokens []string) []MatchSpan {
	var spans []MatchSpan
	for _, token := range tokens {
		if !hanPhraseToken(token) {
			continue
		}
		for from := 0; from < len(text); {
			rel := strings.Index(text[from:], token)
			if rel < 0 {
				break
			}
			start := from + rel
			spans = append(spans, MatchSpan{StartByte: start, EndByte: start + len(token)})
			from = start + 1
		}
	}
	return spans
}

func removeOverlappingSpans(spans, exact []MatchSpan) []MatchSpan {
	if len(spans) == 0 || len(exact) == 0 {
		return spans
	}
	filtered := spans[:0]
	for _, span := range spans {
		overlaps := false
		for _, phrase := range exact {
			if span.StartByte < phrase.EndByte && phrase.StartByte < span.EndByte {
				overlaps = true
				break
			}
		}
		if !overlaps {
			filtered = append(filtered, span)
		}
	}
	return filtered
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func cjkAxisProof(axis, text string, tokens []string) bool {
	if !isCJKEnrichedAxis(axis) {
		return false
	}
	for _, token := range tokens {
		if !hanPhraseToken(token) {
			continue
		}
		if cjkInteriorAllowed(axis, text, token) {
			return true
		}
	}
	return false
}

func cjkInteriorAllowed(axis, text, token string) bool {
	if !isCJKEnrichedAxis(axis) {
		return false
	}
	if axis == AxisExtracted {
		text = boundForPinyinEnrichment(text)
	}
	return strings.Contains(text, token)
}

func isCJKEnrichedAxis(axis string) bool {
	switch axis {
	case AxisName, AxisPath, AxisNotes, AxisDescriptions, AxisExtracted:
		return true
	default:
		return false
	}
}
