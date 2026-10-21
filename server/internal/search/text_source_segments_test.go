package search

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestDeriveSemanticTextSpansAreContiguousUTF8AndDeterministic(t *testing.T) {
	cases := []struct{ name, body string }{
		{name: "sentence boundary", body: strings.Repeat("第一句内容。第二句内容 ", 45)},
		{name: "whitespace runs", body: strings.Repeat("alpha beta\n\t", 45)},
		{name: "unicode boundary", body: strings.Repeat("星空🌌资料内容 ", 50)},
		{name: "exact target", body: strings.Repeat("x", semanticTextSourceSegmentTargetBytes+1)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			spans, err := deriveSemanticTextSpans(tc.body)
			if err != nil || len(spans) < 2 {
				t.Fatalf("spans=%v err=%v", spans, err)
			}
			offset := 0
			for _, span := range spans {
				if span.Start != offset || span.End <= span.Start || !utf8.RuneStart(tc.body[span.Start]) ||
					(span.End < len(tc.body) && !utf8.RuneStart(tc.body[span.End])) {
					t.Fatalf("invalid span %+v at %d", span, offset)
				}
				if strings.TrimSpace(tc.body[span.Start:span.End]) == "" {
					t.Fatalf("whitespace-only segment %+v", span)
				}
				offset = span.End
			}
			if offset != len(tc.body) {
				t.Fatalf("covered %d of %d bytes", offset, len(tc.body))
			}
			again, err := deriveSemanticTextSpans(tc.body)
			if err != nil || len(again) != len(spans) {
				t.Fatalf("second derivation: %v %v", again, err)
			}
			for i := range spans {
				if spans[i] != again[i] {
					t.Fatalf("nondeterministic spans %v vs %v", spans, again)
				}
			}
		})
	}
	chinese := strings.Repeat("第一句。第二句！第三句？", 40)
	chineseSpans, err := deriveSemanticTextSpans(chinese)
	if err != nil {
		t.Fatal(err)
	}
	for _, span := range chineseSpans[:len(chineseSpans)-1] {
		if r, _ := utf8.DecodeLastRuneInString(chinese[:span.End]); r != '。' && r != '！' && r != '？' {
			t.Fatalf("Chinese boundary did not prefer sentence punctuation: end=%d rune=%q", span.End, r)
		}
	}
}

func TestDeriveSemanticTextSpansRejectsInvalidUTF8AndKeepsShortLegacyBody(t *testing.T) {
	if spans, err := deriveSemanticTextSpans("short whole body"); err != nil || spans != nil {
		t.Fatalf("short body spans=%v err=%v", spans, err)
	}
	invalid := strings.Repeat("a", semanticTextSourceSegmentTargetBytes) + string([]byte{0xff})
	if _, err := deriveSemanticTextSpans(invalid); err == nil {
		t.Fatal("invalid UTF-8 was accepted")
	}
}

func TestSemanticTextSegmentIDFitsNativeZvecPrimaryKey(t *testing.T) {
	body := strings.Repeat("native zvec primary key boundary ", 30)
	segments, ok := deriveSemanticTextSourceSegments("NOTE", "subject-1", "note-1", "revision-1", body,
		sha256Text(body), "USER")
	if !ok || len(segments) < 2 {
		t.Fatalf("segmented=%v count=%d", ok, len(segments))
	}
	for ordinal, segment := range segments {
		id := segment.SegmentID
		if len(id) != 64 {
			t.Fatalf("segment %d ID length=%d, want 64: %q", ordinal, len(id), id)
		}
		for _, b := range []byte(id) {
			if !((b >= '0' && b <= '9') || (b >= 'a' && b <= 'f')) {
				t.Fatalf("segment %d ID contains byte outside native zvec PK alphabet: %q", ordinal, id)
			}
		}
		provenance := segment.TextSourceProvenance
		identity := semanticTextSegmentIdentity{Kind: segment.Kind, SubjectID: "subject-1", SourceRef: "note-1",
			Revision: "revision-1", BodyDigest: sha256Text(body), ProfileDigest: semanticTextSourceSegmentationProfileDigest,
			Ordinal: int64(ordinal), Start: provenance.SourceStartByte, End: provenance.SourceEndByte,
			TextDigest: provenance.TextDigest}
		encoded, err := json.Marshal(identity)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(encoded)
		if id != hex.EncodeToString(digest[:]) {
			t.Fatalf("segment %d ID is not the full canonical SHA-256: %q", ordinal, id)
		}
	}
}
