package search

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	semanticTextSourceSegmentationProfile     = "cairn.semantic-text-source-segmentation.v1"
	semanticTextSourceSegmentationProfileSpec = semanticTextSourceSegmentationProfile + "|target=384-source-bytes|utf8-boundaries|prefer-last-latter-half-CJK-sentence-terminator-without-space-or-ASCII-sentence-terminator-followed-by-whitespace|fallback-last-Unicode-whitespace|contiguous-no-overlap-no-dropped-bytes|whitespace-only-runs-attach-adjacent-meaningful-segment-may-exceed-target|tokenizer-FULL-never-inferred|segment-id=sha256-hex64"
	semanticTextSourceSegmentTargetBytes      = 384
)

var semanticTextSourceSegmentationProfileDigest = sha256Text(semanticTextSourceSegmentationProfileSpec)

// TextSourceProvenance binds a derived semantic input to exact bytes in an
// immutable NOTE revision or admitted EXTRACT artifact. These are transient
// search-generation facts, not durable segment records.
type TextSourceProvenance struct {
	SourceRevision            string `json:"source_revision"`
	BodyDigest                string `json:"body_digest"`
	SegmentationProfileDigest string `json:"segmentation_profile_digest"`
	SourceStartByte           int    `json:"source_start_byte"`
	SourceEndByte             int    `json:"source_end_byte"`
	TextDigest                string `json:"text_digest"`
}

type semanticTextSpan struct{ Start, End int }

type semanticTextSegmentIdentity struct {
	Kind          string `json:"kind"`
	SubjectID     string `json:"subject_id"`
	SourceRef     string `json:"source_ref"`
	Revision      string `json:"revision"`
	BodyDigest    string `json:"body_digest"`
	ProfileDigest string `json:"profile_digest"`
	Ordinal       int64  `json:"ordinal"`
	Start         int    `json:"start_byte"`
	End           int    `json:"end_byte"`
	TextDigest    string `json:"text_digest"`
}

func semanticTextSegmentID(kind, subjectID, sourceRef, revision, bodyDigest, profileDigest string, ordinal int64, start, end int, textDigest string) string {
	identity := semanticTextSegmentIdentity{kind, subjectID, sourceRef, revision, bodyDigest, profileDigest, ordinal, start, end, textDigest}
	encoded, _ := json.Marshal(identity)
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

func deriveSemanticTextSpans(body string) ([]semanticTextSpan, error) {
	if !utf8.ValidString(body) {
		return nil, errors.New("semantic text source is not valid UTF-8")
	}
	if len(body) <= semanticTextSourceSegmentTargetBytes {
		return nil, nil
	}
	spans := make([]semanticTextSpan, 0, (len(body)+semanticTextSourceSegmentTargetBytes-1)/semanticTextSourceSegmentTargetBytes)
	for start := 0; start < len(body); {
		limit := start + semanticTextSourceSegmentTargetBytes
		if limit >= len(body) {
			spans = append(spans, semanticTextSpan{start, len(body)})
			break
		}
		for limit > start && !utf8.RuneStart(body[limit]) {
			limit--
		}
		minimum := start + semanticTextSourceSegmentTargetBytes/2
		cut := -1
		// Prefer the last CJK sentence terminator in the latter half even when
		// CJK prose has no following space. ASCII .!? qualify only before
		// whitespace. Newlines are sentence boundaries for either script.
		for at := start; at < limit; {
			r, size := utf8.DecodeRuneInString(body[at:])
			next := at + size
			if next >= minimum && (r == '\n' || r == '。' || r == '！' || r == '？') {
				cut = next
			} else if next >= minimum && (r == '.' || r == '!' || r == '?') && next < len(body) {
				nextRune, _ := utf8.DecodeRuneInString(body[next:])
				if unicode.IsSpace(nextRune) {
					cut = next
				}
			}
			at = next
		}
		// Otherwise use the last whitespace boundary in the latter half.
		if cut < 0 {
			for at := start; at < limit; {
				r, size := utf8.DecodeRuneInString(body[at:])
				next := at + size
				if next >= minimum && unicode.IsSpace(r) {
					cut = next
				}
				at = next
			}
		}
		if cut < 0 {
			cut = limit
		}
		// Attach the entire following whitespace run to this segment. Long
		// runs may exceed the target; no source bytes are dropped.
		for cut < len(body) {
			r, size := utf8.DecodeRuneInString(body[cut:])
			if !unicode.IsSpace(r) {
				break
			}
			cut += size
		}
		if cut <= start {
			return nil, errors.New("semantic text segmentation made no progress")
		}
		spans = append(spans, semanticTextSpan{start, cut})
		start = cut
	}
	// A whitespace-only leading run is attached to the next meaningful span;
	// interior/trailing runs were attached by the cutter above.
	for len(spans) > 1 && strings.TrimSpace(body[spans[0].Start:spans[0].End]) == "" {
		spans[1].Start = spans[0].Start
		spans = spans[1:]
	}
	clean := spans[:0]
	for _, span := range spans {
		if span.End > span.Start {
			clean = append(clean, span)
		}
	}
	spans = clean
	if len(spans) == 0 || spans[0].Start != 0 || spans[len(spans)-1].End != len(body) {
		return nil, errors.New("semantic text spans do not cover source")
	}
	for i, span := range spans {
		if span.End <= span.Start || !utf8.RuneStart(body[span.Start]) || (span.End < len(body) && !utf8.RuneStart(body[span.End])) || (i > 0 && spans[i-1].End != span.Start) {
			return nil, errors.New("semantic text spans are invalid or discontinuous")
		}
	}
	return spans, nil
}

func deriveSemanticTextSourceSegments(kind, subjectID, sourceRef, revision, body, bodyDigest, producer string) ([]SegmentRef, bool) {
	spans, err := deriveSemanticTextSpans(body)
	if err != nil || len(spans) == 0 {
		return nil, false
	}
	segments := make([]SegmentRef, 0, len(spans))
	for ordinal, span := range spans {
		text := body[span.Start:span.End]
		textDigest := sha256Text(text)
		provenance := &TextSourceProvenance{SourceRevision: revision, BodyDigest: bodyDigest,
			SegmentationProfileDigest: semanticTextSourceSegmentationProfileDigest,
			SourceStartByte:           span.Start, SourceEndByte: span.End, TextDigest: textDigest}
		segments = append(segments, SegmentRef{SourceType: map[bool]string{true: "ANNOTATION", false: "ARTIFACT"}[kind == "NOTE"],
			SourceID: sourceRef, SegmentID: semanticTextSegmentID(kind, subjectID, sourceRef, revision, bodyDigest,
				semanticTextSourceSegmentationProfileDigest, int64(ordinal), span.Start, span.End, textDigest),
			Ordinal: int64(ordinal), MatchedText: text, Kind: kind, Producer: producer, Accepted: true,
			Language: "und", TextSourceProvenance: provenance})
	}
	return segments, true
}
