// Package pinyin provides the deterministic Hanzi-to-pinyin transliteration
// used by the lexical search feed. It is an additive token enrichment for the
// name and path fields: the original characters always stay in the feed, and
// the pinyin forms only add queryable tokens. The reading table is generated
// from the Unicode Unihan database (kMandarin field) under Unicode License V3;
// the required notice is included in this package's LICENSE.txt. The generated
// header records its source, version, and input digest. Like every other
// provider input, the table's content is part of the lexical profile; refreshing
// the table is therefore a feed-shape change that requires a new profile
// generation, never a reinterpretation of an old one.
//
// Tone marks are stripped and the umlaut is written as ASCII 'v' (the letter
// 'v' never occurs in pinyin), so "lü" is stored and queried as "lv". The
// first kMandarin reading of a multi-reading character is its primary
// reading; the phrase forms below always use primary readings, while
// Readings exposes every reading.
package pinyin

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"
)

// hanRange is one maximal rune range whose characters share one reading set.
type hanRange struct {
	first, last rune
	readings    []string
}

// tableState lazily decodes the generated blobs once per process.
var tableState struct {
	once   sync.Once
	ranges []hanRange
	err    error
}

// loadTable decodes the generated base64 blobs into a sorted, non-overlapping
// range table. Wire formats (also documented in table_gen.go):
//
//	pinyinSyllablesB64        unique sorted syllables, concatenated
//	pinyinSyllableOffsetsB64  (n+1) 2-byte big-endian byte offsets into the
//	                          syllable blob; the last offset is its length
//	pinyinReadingSetsB64      per unique reading set: 1 byte syllable count
//	                          then count 2-byte big-endian syllable indices
//	pinyinRangesB64           per maximal rune range with one reading set:
//	                          3-byte big-endian first rune, 2-byte span-1,
//	                          2-byte reading-set index
//
// A malformed table is a build-artifact bug: loadTable fails loudly instead
// of silently serving wrong readings.
func loadTable() []hanRange {
	tableState.once.Do(func() {
		tableState.ranges, tableState.err = decodeTable()
	})
	if tableState.err != nil {
		panic("search/pinyin: generated table is malformed: " + tableState.err.Error())
	}
	return tableState.ranges
}

func decodeTable() ([]hanRange, error) {
	syllableBytes, err := base64.StdEncoding.DecodeString(pinyinSyllablesB64)
	if err != nil {
		return nil, err
	}
	offsetBytes, err := base64.StdEncoding.DecodeString(pinyinSyllableOffsetsB64)
	if err != nil {
		return nil, err
	}
	setBytes, err := base64.StdEncoding.DecodeString(pinyinReadingSetsB64)
	if err != nil {
		return nil, err
	}
	rangeBytes, err := base64.StdEncoding.DecodeString(pinyinRangesB64)
	if err != nil {
		return nil, err
	}
	if len(offsetBytes) < 2 || len(offsetBytes)%2 != 0 {
		return nil, fmt.Errorf("syllable offset table length %d", len(offsetBytes))
	}
	lastOffset := int(binary.BigEndian.Uint16(offsetBytes[len(offsetBytes)-2:]))
	if lastOffset != len(syllableBytes) {
		return nil, fmt.Errorf("syllable blob length %d does not match final offset %d", len(syllableBytes), lastOffset)
	}
	syllables := make([]string, 0, len(offsetBytes)/2-1)
	for index := 0; index+2 < len(offsetBytes); index += 2 {
		start := int(binary.BigEndian.Uint16(offsetBytes[index:]))
		end := int(binary.BigEndian.Uint16(offsetBytes[index+2:]))
		if start > end || end > len(syllableBytes) {
			return nil, fmt.Errorf("syllable offsets %d..%d exceed blob length %d", start, end, len(syllableBytes))
		}
		syllables = append(syllables, string(syllableBytes[start:end]))
	}

	sets := make([][]string, 0, 64)
	for cursor := 0; cursor < len(setBytes); {
		count := int(setBytes[cursor])
		cursor++
		if count == 0 || cursor+count*2 > len(setBytes) {
			return nil, fmt.Errorf("reading set at byte %d overruns the blob", cursor-1)
		}
		set := make([]string, 0, count)
		for i := 0; i < count; i++ {
			index := int(binary.BigEndian.Uint16(setBytes[cursor:]))
			cursor += 2
			if index >= len(syllables) {
				return nil, fmt.Errorf("reading set references unknown syllable index %d", index)
			}
			set = append(set, syllables[index])
		}
		sets = append(sets, set)
	}

	const rangeRecordSize = 7
	if len(rangeBytes)%rangeRecordSize != 0 {
		return nil, fmt.Errorf("range table length %d is not a multiple of %d", len(rangeBytes), rangeRecordSize)
	}
	ranges := make([]hanRange, 0, len(rangeBytes)/rangeRecordSize)
	for cursor := 0; cursor < len(rangeBytes); cursor += rangeRecordSize {
		first := rune(rangeBytes[cursor])<<16 | rune(rangeBytes[cursor+1])<<8 | rune(rangeBytes[cursor+2])
		span := int(rangeBytes[cursor+3])<<8 | int(rangeBytes[cursor+4])
		setIndex := int(binary.BigEndian.Uint16(rangeBytes[cursor+5:]))
		if span == 0 || setIndex >= len(sets) {
			return nil, fmt.Errorf("range record at byte %d has span %d and set index %d", cursor, span, setIndex)
		}
		if first > 0x10FFFF || first+rune(span-1) > 0x10FFFF {
			return nil, fmt.Errorf("range record at byte %d exceeds the Unicode range", cursor)
		}
		if len(ranges) > 0 && ranges[len(ranges)-1].last >= first {
			return nil, fmt.Errorf("range U+%04X..U+%04X overlaps the previous range", first, first+rune(span-1))
		}
		ranges = append(ranges, hanRange{first: first, last: first + rune(span-1), readings: sets[setIndex]})
	}
	return ranges, nil
}

// Readings returns every tone-stripped Mandarin reading of r, primary reading
// first. Characters without a recorded kMandarin reading, including all
// non-Han characters, return nil.
func Readings(r rune) []string {
	ranges := loadTable()
	if index := lookup(ranges, r); index >= 0 {
		return ranges[index].readings
	}
	return nil
}

// lookup binary-searches the sorted, non-overlapping range table and returns
// -1 when r is not covered.
func lookup(ranges []hanRange, r rune) int {
	low, high := 0, len(ranges)-1
	for low <= high {
		mid := (low + high) / 2
		switch {
		case r < ranges[mid].first:
			high = mid - 1
		case r > ranges[mid].last:
			low = mid + 1
		default:
			return mid
		}
	}
	return -1
}

// Run is one maximal sequence of characters with recorded readings,
// together with their per-character readings.
type Run struct {
	// Text is the exact substring of the input covered by this run.
	Text string
	// Start is the byte offset of Text within the input.
	Start int
	// Readings holds one entry per character of Text. Each entry lists all
	// readings of that character; the first is the primary reading.
	Readings [][]string
}

// Runs splits text into maximal runs of characters with recorded readings.
// Text outside a run — every non-Han character and every Han character
// without a kMandarin reading — separates runs and contributes nothing to
// the transliterations, so non-CJK text passes through untouched.
func Runs(text string) []Run {
	ranges := loadTable()
	var runs []Run
	var readings [][]string
	start := -1
	flush := func(end int) {
		if start < 0 {
			return
		}
		runs = append(runs, Run{Text: text[start:end], Start: start, Readings: readings})
		readings = nil
		start = -1
	}
	offset := 0
	for offset < len(text) {
		r, size := utf8.DecodeRuneInString(text[offset:])
		if index := lookup(ranges, r); index >= 0 {
			if start < 0 {
				start = offset
			}
			readings = append(readings, ranges[index].readings)
		} else {
			flush(offset)
		}
		offset += size
	}
	flush(len(text))
	return runs
}

// For returns the pinyin projections of text's Han runs, using primary
// readings:
//
//   - full holds one entry per run: the space-joined per-character syllables
//     ("lv xing ji hua");
//   - joined concatenates each run's syllables without separators and joins
//     multiple runs with single spaces ("lvxingjihua");
//   - initials holds the first letter of each character's primary reading,
//     runs separated by single spaces ("lxjh").
//
// Text without covered characters yields empty results; non-CJK text is
// never transformed, so callers can append these forms to a field without
// disturbing its original content. For scans the text once and allocates
// only its output builders, so long text is safe at ingest time.
func For(text string) (full []string, joined string, initials string) {
	ranges := loadTable()
	var syllables, joinedOut, initialsOut strings.Builder
	var entries []string
	started := false // at least one run was seen; guards inter-run separators
	inRun := false
	flushRun := func() {
		if inRun {
			entries = append(entries, syllables.String())
			syllables.Reset()
			inRun = false
		}
	}
	for offset := 0; offset < len(text); {
		r, size := utf8.DecodeRuneInString(text[offset:])
		if index := lookup(ranges, r); index >= 0 {
			if !inRun {
				if started {
					joinedOut.WriteByte(' ')
					initialsOut.WriteByte(' ')
				}
				started = true
				inRun = true
			}
			primary := ranges[index].readings[0]
			if syllables.Len() > 0 {
				syllables.WriteByte(' ')
			}
			syllables.WriteString(primary)
			joinedOut.WriteString(primary)
			initialsOut.WriteString(primary[:1])
		} else {
			flushRun()
		}
		offset += size
	}
	flushRun()
	if len(entries) == 0 {
		return nil, "", ""
	}
	return entries, joinedOut.String(), initialsOut.String()
}

// FieldAppendix renders the additional search tokens the lexical feed appends
// to a name or path field: the space-joined syllables, the joined syllables,
// the joined syllables in the 'ü' spelling (so a query typed with the umlaut
// tokenizes to the same forms), and the initials. Multi-run text separates
// runs with spaces. Text without covered characters yields "" and the caller
// must not append a separator.
func FieldAppendix(text string) string {
	full, joined, initials := For(text)
	if len(full) == 0 {
		return ""
	}
	parts := make([]string, 0, len(full)+3)
	parts = append(parts, full...)
	parts = append(parts, joined, UmlautForm(joined), initials)
	return strings.Join(parts, " ")
}

// EnrichmentAppendix renders the complete additional search token text the
// lexical feed appends to a CJK-bearing field. It is the superset of
// FieldAppendix: for every maximal run of characters with recorded readings it
// emits the CJK adjacency tokens — every adjacent character bigram and every
// single character — followed by the pinyin appendix of FieldAppendix plus the
// adjacent pinyin syllable pairs, so a two-character query matches anywhere
// inside a run in characters and in pinyin, not only at the run's start.
//
// The feed's tokenizer (unicode61) treats one contiguous CJK run as a single
// token matched by prefix, which is why the raw field alone answers only a
// query at the start of a run; these tokens are the declared derived feed
// shape, never display content. Adjacent means adjacent inside one run: no
// token ever bridges the text between two runs. Text without covered
// characters yields "" and the caller must not append a separator.
func EnrichmentAppendix(text string) string {
	runs := Runs(text)
	if len(runs) == 0 {
		return ""
	}
	var parts []string
	for _, run := range runs {
		characters := []rune(run.Text)
		for index := 0; index+1 < len(characters); index++ {
			parts = append(parts, string(characters[index:index+2]))
		}
		for _, character := range characters {
			parts = append(parts, string(character))
		}
		// Primary readings only, exactly like For; Runs records one reading
		// set per character of the run, so the pairs align with the characters.
		for index := 0; index+1 < len(run.Readings); index++ {
			parts = append(parts, run.Readings[index][0]+run.Readings[index+1][0])
		}
	}
	if appendix := FieldAppendix(text); appendix != "" {
		parts = append(parts, appendix)
	}
	return strings.Join(parts, " ")
}

// TokenOrigin maps one whitespace-delimited token in EnrichmentAppendix back
// to the exact source byte interval that generated it. Offsets are UTF-8 byte
// positions; token generation remains owned by EnrichmentAppendix.
type TokenOrigin struct {
	StartByte       int
	EndByte         int
	SourceStartByte int
	SourceEndByte   int
}

// EnrichmentAppendixWithOrigins returns the existing appendix unchanged and
// an origin interval for every emitted token. The mapping is accepted only
// when its generated token stream exactly matches EnrichmentAppendix, so any
// future enrichment change safely disables attribution until this mapper is
// updated.
func EnrichmentAppendixWithOrigins(text string) (string, []TokenOrigin) {
	appendix := EnrichmentAppendix(text)
	runs := Runs(text)
	if len(runs) == 0 {
		return appendix, nil
	}
	runBoundaries := make([][]int, len(runs))
	for runIndex, run := range runs {
		boundaries := make([]int, 1, len(run.Readings)+1)
		boundaries[0] = run.Start
		for offset := 0; offset < len(run.Text); {
			_, size := utf8.DecodeRuneInString(run.Text[offset:])
			offset += size
			boundaries = append(boundaries, run.Start+offset)
		}
		if len(boundaries) != len(run.Readings)+1 {
			return appendix, nil
		}
		runBoundaries[runIndex] = boundaries
	}
	var tokens []string
	var origins []TokenOrigin
	appendToken := func(token string, sourceStart, sourceEnd int) {
		if token == "" {
			return
		}
		start := 0
		if len(tokens) > 0 {
			start = origins[len(origins)-1].EndByte + 1
		}
		end := start + len(token)
		tokens = append(tokens, token)
		origins = append(origins, TokenOrigin{StartByte: start, EndByte: end, SourceStartByte: sourceStart, SourceEndByte: sourceEnd})
	}
	for runIndex, run := range runs {
		boundaries := runBoundaries[runIndex]
		characters := []rune(run.Text)
		if len(characters) != len(run.Readings) {
			return appendix, nil
		}
		for index := 0; index+1 < len(characters); index++ {
			appendToken(string(characters[index:index+2]), boundaries[index], boundaries[index+2])
		}
		for index, character := range characters {
			appendToken(string(character), boundaries[index], boundaries[index+1])
		}
		for index := 0; index+1 < len(run.Readings); index++ {
			appendToken(run.Readings[index][0]+run.Readings[index+1][0], boundaries[index], boundaries[index+2])
		}
	}
	for runIndex, run := range runs {
		boundaries := runBoundaries[runIndex]
		for index, reading := range run.Readings {
			appendToken(reading[0], boundaries[index], boundaries[index+1])
		}
	}
	for _, run := range runs {
		var joined strings.Builder
		for _, reading := range run.Readings {
			joined.WriteString(reading[0])
		}
		appendToken(joined.String(), run.Start, run.Start+len(run.Text))
	}
	for _, run := range runs {
		var joined strings.Builder
		for _, reading := range run.Readings {
			joined.WriteString(reading[0])
		}
		appendToken(UmlautForm(joined.String()), run.Start, run.Start+len(run.Text))
	}
	for _, run := range runs {
		var initials strings.Builder
		for _, reading := range run.Readings {
			initials.WriteString(reading[0][:1])
		}
		appendToken(initials.String(), run.Start, run.Start+len(run.Text))
	}
	if strings.Join(tokens, " ") != appendix {
		return appendix, nil
	}
	return appendix, origins
}

// UmlautForm rewrites the ASCII 'v' umlaut spelling to 'ü'. Only table
// syllables feed this mapping and pinyin never uses the letter 'v', so no
// legitimate spelling is affected.
func UmlautForm(text string) string {
	if !strings.Contains(text, "v") {
		return text
	}
	return strings.Map(func(r rune) rune {
		if r == 'v' {
			return 'ü'
		}
		return r
	}, text)
}
