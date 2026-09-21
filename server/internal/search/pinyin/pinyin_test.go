package pinyin

import (
	"runtime"
	"strings"
	"testing"
)

func TestReadingsCoverMandarinSyllables(t *testing.T) {
	cases := map[rune][]string{
		// Single primary readings, tone-stripped.
		'旅': {"lv"},
		'行': {"xing"}, // kMandarin records only xíng; other readings live in other fields
		'计': {"ji"},
		'划': {"hua"},
		// A multi-reading character keeps every kMandarin reading, primary first.
		'万': {"wan", "mo"},
		// Tone stripping maps the umlaut to ASCII v.
		'女': {"nv"},
		'绿': {"lv"},
		// Plain ASCII is not covered.
		'a': nil,
		'A': nil,
		'1': nil,
		'。': nil,
		'ß': nil,
	}
	for r, want := range cases {
		if got := Readings(r); !equalStrings(got, want) {
			t.Errorf("Readings(%q) = %q, want %q", r, got, want)
		}
	}
}

func TestSyllableAlphabetIsLowercaseASCIIV(t *testing.T) {
	ranges := loadTable()
	seen := map[string]bool{}
	for _, entry := range ranges {
		for _, syllable := range entry.readings {
			if seen[syllable] {
				continue
			}
			seen[syllable] = true
			if syllable == "" {
				t.Fatal("empty syllable in table")
			}
			for _, r := range syllable {
				if r < 'a' || r > 'z' {
					t.Fatalf("syllable %q contains non-lowercase-ASCII letter %q", syllable, r)
				}
			}
		}
	}
	if len(seen) < 400 {
		t.Fatalf("syllable inventory too small: %d unique syllables", len(seen))
	}
}

func TestForTransliteratesRunsAndKeepsNonCJKUntouched(t *testing.T) {
	cases := []struct {
		name     string
		text     string
		wantFull []string
		wantJoin string
		wantInit string
	}{
		{"plain ascii", "track.flac", nil, "", ""},
		{"empty", "", nil, "", ""},
		{"single run", "旅行计划.md", []string{"lv xing ji hua"}, "lvxingjihua", "lxjh"},
		{"two runs around ascii", "中文abc拼音", []string{"zhong wen", "pin yin"}, "zhongwen pinyin", "zw py"},
		{"multi reading primary wins", "万个", []string{"wan ge"}, "wange", "wg"},
		{"umlaut syllable", "女绿", []string{"nv lv"}, "nvlv", "nl"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			full, joined, initials := For(tc.text)
			if !equalStrings(full, tc.wantFull) {
				t.Errorf("full = %q, want %q", full, tc.wantFull)
			}
			if joined != tc.wantJoin {
				t.Errorf("joined = %q, want %q", joined, tc.wantJoin)
			}
			if initials != tc.wantInit {
				t.Errorf("initials = %q, want %q", initials, tc.wantInit)
			}
		})
	}
}

func TestRunsPreservesRunTextAndOffsets(t *testing.T) {
	text := "prefix中文abc拼音suffix"
	runs := Runs(text)
	if len(runs) != 2 {
		t.Fatalf("runs = %d, want 2", len(runs))
	}
	if runs[0].Text != "中文" || runs[0].Start != len("prefix") {
		t.Errorf("first run = %+v", runs[0])
	}
	wantStart := len("prefix") + len("中文") + len("abc")
	if runs[1].Text != "拼音" || runs[1].Start != wantStart {
		t.Errorf("second run = %+v, want start %d", runs[1], wantStart)
	}
	if len(runs[0].Readings) != 2 || !equalStrings(runs[0].Readings[0], Readings('中')) {
		t.Errorf("first run readings = %v", runs[0].Readings)
	}
}

func TestEnrichmentAppendixEmitsAdjacencyTokensThenPinyinForms(t *testing.T) {
	// Per run: every adjacent bigram first, then every single character, then
	// the adjacent syllable pairs, then the unchanged FieldAppendix (the
	// space-joined syllables, joined forms, and initials).
	if got, want := EnrichmentAppendix("旅行计划"),
		"旅行 行计 计划 旅 行 计 划 lvxing xingji jihua lv xing ji hua lvxingjihua lüxingjihua lxjh"; got != want {
		t.Errorf("EnrichmentAppendix = %q, want %q", got, want)
	}
	// An ASCII-only field gains nothing.
	if got := EnrichmentAppendix("track.flac"); got != "" {
		t.Errorf("EnrichmentAppendix non-CJK = %q, want empty", got)
	}
	// Bigrams never bridge the characters between two runs, while the pinyin
	// appendix still carries every run.
	if got, want := EnrichmentAppendix("中文 abc 拼音"),
		"中文 中 文 zhongwen 拼音 拼 音 pinyin zhong wen pin yin zhongwen pinyin zhongwen pinyin zw py"; got != want {
		t.Errorf("EnrichmentAppendix multi-run = %q, want %q", got, want)
	}
	// A two-character run has exactly one bigram and two characters. The
	// syllable pair and the joined umlaut form both spell the table's ASCII
	// 'v': 女绿 reads nv lv, so the pair and the umlaut form are "nvlv" and
	// "nülü".
	if got, want := EnrichmentAppendix("女绿"),
		"女绿 女 绿 nvlv nv lv nvlv nülü nl"; got != want {
		t.Errorf("EnrichmentAppendix two-character = %q, want %q", got, want)
	}
	// The enrichment is a superset of FieldAppendix: every existing form stays
	// byte-identical inside the new appendix.
	for _, text := range []string{"旅行计划.md", "中文abc拼音", "万个", "女绿"} {
		field := FieldAppendix(text)
		enriched := EnrichmentAppendix(text)
		if field == "" {
			if enriched != "" {
				t.Errorf("EnrichmentAppendix(%q) = %q, want empty like FieldAppendix", text, enriched)
			}
			continue
		}
		if !strings.Contains(enriched, field) {
			t.Errorf("EnrichmentAppendix(%q) = %q, misses FieldAppendix %q", text, enriched, field)
		}
	}
}

func TestFieldAppendixComposesAllForms(t *testing.T) {
	if got, want := FieldAppendix("旅行计划.md"), "lv xing ji hua lvxingjihua lüxingjihua lxjh"; got != want {
		t.Errorf("FieldAppendix = %q, want %q", got, want)
	}
	// Multi-run text keeps run boundaries as separate tokens; the umlaut form
	// is identical to the joined form when no syllable contains a v.
	if got, want := FieldAppendix("中文 拼音"), "zhong wen pin yin zhongwen pinyin zhongwen pinyin zw py"; got != want {
		t.Errorf("FieldAppendix multi-run = %q, want %q", got, want)
	}
	if got := FieldAppendix("track.flac"); got != "" {
		t.Errorf("FieldAppendix non-CJK = %q, want empty", got)
	}
}

func TestUmlautFormIsReversibleForTableSyllables(t *testing.T) {
	if got, want := UmlautForm("lvxingjihua"), "lüxingjihua"; got != want {
		t.Errorf("UmlautForm = %q, want %q", got, want)
	}
	if got := UmlautForm("no-umlaut-here"); got != "no-umlaut-here" {
		t.Errorf("UmlautForm changed text without v: %q", got)
	}
}

func TestForIsDeterministic(t *testing.T) {
	text := strings.Repeat("旅行计划与行程安排.md", 100)
	full1, joined1, initials1 := For(text)
	full2, joined2, initials2 := For(text)
	if joined1 != joined2 || initials1 != initials2 || !equalStrings(full1, full2) {
		t.Fatal("For produced different output for the same input")
	}
	if want := "lv xing ji hua"; !strings.HasPrefix(full1[0], want) {
		t.Errorf("unexpected leading syllables %q", full1[0])
	}
}

// TestForBoundedAllocationOnLongText pins the ingest-path budget: For must
// stay linear in the input (no per-character quadratic copying, no unbounded
// slice growth beyond the output itself).
func TestForBoundedAllocationOnLongText(t *testing.T) {
	unit := "旅行计划与行程安排" // 27 bytes of UTF-8 Han text
	padding := (1 << 20) % len(unit)
	long := strings.Repeat(unit, (1<<20)/len(unit)) + strings.Repeat(" ", padding) // 1 MiB
	if got := len(long); got != 1<<20 {
		t.Fatalf("fixture length = %d, want %d", got, 1<<20)
	}
	measure := func() (allocated uint64) {
		var before, after runtime.MemStats
		runtime.GC()
		runtime.ReadMemStats(&before)
		full, joined, initials := For(long)
		if len(full) == 0 || joined == "" || initials == "" {
			t.Fatal("For returned empty output for Han text")
		}
		runtime.ReadMemStats(&after)
		return after.TotalAlloc - before.TotalAlloc
	}
	first := measure()
	second := measure()
	if first == 0 {
		t.Fatal("no allocation measured")
	}
	if second > first*2 {
		t.Fatalf("allocation not stable: first run %d bytes, second run %d bytes", first, second)
	}
	// TotalAlloc counts every intermediate allocation, including the output
	// builders' doubling growth, so the bound is a small multiple of the
	// input. A superlinear implementation would blow far past it; measured
	// behavior is ~13x for single-run text.
	if first > uint64(len(long))*16 {
		t.Fatalf("allocation %d bytes exceeds the bound for %d bytes of input", first, len(long))
	}
}

func equalStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for index := range got {
		if got[index] != want[index] {
			return false
		}
	}
	return true
}
