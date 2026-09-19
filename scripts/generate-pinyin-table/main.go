// Command generate-pinyin-table builds the committed Hanzi-to-pinyin table
// used by server/internal/search/pinyin from the Unicode Unihan database.
//
// The source data is the public-domain Unicode Character Database:
//
//	https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip
//
// The generator reads the kMandarin field of Unihan_Readings.txt, strips the
// tone marks with pinyin-aware rules (the umlaut of lü/nü survives as an
// ASCII 'v', which pinyin otherwise never uses), resolves each reading to a
// lowercase ASCII syllable, and emits a deterministic Go source file whose
// header records the source URL, the Unihan version and date, the SHA-256 of
// the input zip, and the generation date.
//
// Usage (run from the repository root):
//
//	go run ./scripts/generate-pinyin-table
//	go run ./scripts/generate-pinyin-table -zip /path/to/Unihan.zip
//
// Downloads honor the standard HTTPS_PROXY environment variable.
package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"flag"
	"fmt"
	"go/format"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	defaultSourceURL = "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip"
	readingFileName  = "Unihan_Readings.txt"
	// pinyinTableTarget is the repo-relative output path.
	pinyinTableTarget = "server/internal/search/pinyin/table_gen.go"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "generate-pinyin-table:", err)
		os.Exit(1)
	}
}

func run() error {
	url := flag.String("url", defaultSourceURL, "Unihan.zip source URL")
	zipPath := flag.String("zip", "", "local Unihan.zip path (skips the download)")
	out := flag.String("out", pinyinTableTarget, "output .go path (resolved against the repository root when relative)")
	flag.Parse()

	payload, sourceUsed, err := loadZip(*zipPath, *url)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(payload)
	table, err := buildTable(payload)
	if err != nil {
		return err
	}
	source, err := emit(table, sourceUsed, digest)
	if err != nil {
		return err
	}
	outPath := *out
	if !filepath.IsAbs(outPath) {
		outPath = filepath.Join(repoRoot(), outPath)
	}
	if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(outPath, source, 0o644); err != nil {
		return err
	}
	fmt.Printf("wrote %s: %d characters, %d syllables, %d reading sets, %d ranges, %d bytes of Go source\n",
		outPath, table.runeCount, len(table.syllables), len(table.sets), len(table.rangeRecs), len(source))
	return nil
}

func loadZip(zipPath, url string) (payload []byte, sourceUsed string, err error) {
	if zipPath != "" {
		payload, err = os.ReadFile(zipPath)
		return payload, zipPath, err
	}
	resp, err := http.Get(url) //nolint:gosec,noctx // the URL is the documented UCD source or an explicit -url override
	if err != nil {
		return nil, "", fmt.Errorf("download %s (set HTTPS_PROXY if needed, or pass -zip): %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("download %s: unexpected status %s", url, resp.Status)
	}
	payload, err = io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}
	return payload, url, nil
}

// pinyinTable is the intermediate representation before encoding.
type pinyinTable struct {
	unicodeVersion string
	unihanDate     string
	// readings maps each covered rune to its ordered readings; the first
	// reading of a multi-reading character is the primary one.
	readings  map[rune][]string
	runeCount int
	syllables []string
	sets      [][]int
	rangeRecs []runeRange
}

type runeRange struct {
	first, last rune
	set         int
}

func buildTable(payload []byte) (*pinyinTable, error) {
	archive, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return nil, fmt.Errorf("open Unihan.zip: %w", err)
	}
	var readingsFile *zip.File
	for _, file := range archive.File {
		if file.Name == readingFileName {
			readingsFile = file
			break
		}
	}
	if readingsFile == nil {
		return nil, fmt.Errorf("Unihan.zip does not contain %s", readingFileName)
	}
	reader, err := readingsFile.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	content, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	table := &pinyinTable{readings: map[rune][]string{}}
	if err := table.parseReadings(content); err != nil {
		return nil, err
	}
	table.encode()
	return table, nil
}

// parseReadings collects the kMandarin field per rune in record order so the
// first reading of a multi-value field stays primary.
func (t *pinyinTable) parseReadings(content []byte) error {
	for lineNo, line := range strings.Split(string(content), "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.HasPrefix(line, "#") {
			t.captureHeader(line)
			continue
		}
		if strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) != 3 {
			return fmt.Errorf("%s line %d: expected 3 fields, got %d", readingFileName, lineNo+1, len(fields))
		}
		if fields[1] != "kMandarin" {
			continue
		}
		if !strings.HasPrefix(fields[0], "U+") {
			return fmt.Errorf("%s line %d: unexpected code point %q", readingFileName, lineNo+1, fields[0])
		}
		var code rune
		if _, err := fmt.Sscanf(fields[0], "U+%X", &code); err != nil {
			return fmt.Errorf("%s line %d: bad code point %q: %v", readingFileName, lineNo+1, fields[0], err)
		}
		for _, raw := range strings.Fields(fields[2]) {
			syllable, err := normalizeSyllable(raw)
			if err != nil {
				return fmt.Errorf("%s line %d (%s): %v", readingFileName, lineNo+1, fields[0], err)
			}
			duplicate := false
			for _, have := range t.readings[code] {
				if have == syllable {
					duplicate = true
					break
				}
			}
			if !duplicate {
				t.readings[code] = append(t.readings[code], syllable)
			}
		}
	}
	if len(t.readings) == 0 {
		return fmt.Errorf("%s contains no kMandarin records", readingFileName)
	}
	if t.unicodeVersion == "" {
		return fmt.Errorf("%s header does not record a Unicode version", readingFileName)
	}
	t.runeCount = len(t.readings)
	return nil
}

func (t *pinyinTable) captureHeader(line string) {
	comment := strings.TrimSpace(strings.TrimPrefix(line, "#"))
	if version, ok := strings.CutPrefix(comment, "Unicode Version "); ok {
		t.unicodeVersion = strings.TrimSpace(version)
		return
	}
	if date, ok := strings.CutPrefix(comment, "Date: "); ok {
		t.unihanDate = strings.TrimSpace(date)
	}
}

// toneStripped maps every precomposed pinyin letter with a tone mark to its
// tone-free form. The umlaut vowels of lü/nü map to ASCII 'v'; pinyin never
// uses the letter 'v', so the mapping is unambiguous inside the table's
// syllable alphabet. Unicode normalization is intentionally not used: the
// standard library has none, and kMandarin values are composed of exactly the
// characters in this table plus plain ASCII letters.
var toneStripped = strings.NewReplacer(
	"ā", "a", "á", "a", "ǎ", "a", "à", "a",
	"ē", "e", "é", "e", "ě", "e", "è", "e",
	"ī", "i", "í", "i", "ǐ", "i", "ì", "i",
	"ō", "o", "ó", "o", "ǒ", "o", "ò", "o",
	"ū", "u", "ú", "u", "ǔ", "u", "ù", "u",
	"ǖ", "v", "ǘ", "v", "ǚ", "v", "ǜ", "v",
	"ü", "v",
)

// normalizeSyllable strips tone marks and validates the ASCII result.
func normalizeSyllable(raw string) (string, error) {
	stripped := toneStripped.Replace(strings.ToLower(raw))
	for _, r := range stripped {
		if r < 'a' || r > 'z' {
			return "", fmt.Errorf("reading %q does not resolve to ASCII pinyin letters", raw)
		}
	}
	if stripped == "" {
		return "", fmt.Errorf("reading %q is empty after tone stripping", raw)
	}
	return stripped, nil
}

// encode builds the sorted syllable table, the deduplicated reading sets, and
// the maximal rune ranges. All orders are derived from sorted keys so the
// output is deterministic for a given input.
func (t *pinyinTable) encode() {
	syllableSet := map[string]struct{}{}
	for _, list := range t.readings {
		for _, syllable := range list {
			syllableSet[syllable] = struct{}{}
		}
	}
	t.syllables = make([]string, 0, len(syllableSet))
	for syllable := range syllableSet {
		t.syllables = append(t.syllables, syllable)
	}
	sort.Strings(t.syllables)
	syllableIndex := make(map[string]int, len(t.syllables))
	for index, syllable := range t.syllables {
		syllableIndex[syllable] = index
	}

	setKeyIndex := map[string]int{}
	runes := make([]rune, 0, len(t.readings))
	for code := range t.readings {
		runes = append(runes, code)
	}
	sort.Slice(runes, func(i, j int) bool { return runes[i] < runes[j] })
	t.rangeRecs = t.rangeRecs[:0]
	for _, code := range runes {
		key := make([]byte, 0, len(t.readings[code])*2)
		for _, syllable := range t.readings[code] {
			key = binary.BigEndian.AppendUint16(key, uint16(syllableIndex[syllable]))
		}
		setIndex, ok := setKeyIndex[string(key)]
		if !ok {
			setIndex = len(t.sets)
			setKeyIndex[string(key)] = setIndex
			t.sets = append(t.sets, decodeUint16List(key))
		}
		if last := len(t.rangeRecs) - 1; last >= 0 && t.rangeRecs[last].set == setIndex && t.rangeRecs[last].last+1 == code {
			t.rangeRecs[last].last = code
			continue
		}
		t.rangeRecs = append(t.rangeRecs, runeRange{first: code, last: code, set: setIndex})
	}
}

func decodeUint16List(key []byte) []int {
	set := make([]int, 0, len(key)/2)
	for len(key) >= 2 {
		set = append(set, int(binary.BigEndian.Uint16(key)))
		key = key[2:]
	}
	return set
}

// emit renders the generated Go source file. The wire formats are documented
// in pinyin.go's loadTable.
func emit(table *pinyinTable, sourceUsed string, digest [32]byte) ([]byte, error) {
	syllableBlob := strings.Join(table.syllables, "")
	offsets := make([]uint16, 0, len(table.syllables)+1)
	var offset uint16
	for _, syllable := range table.syllables {
		offsets = append(offsets, offset)
		offset += uint16(len(syllable))
	}
	offsets = append(offsets, offset)
	if int(offset) != len(syllableBlob) {
		return nil, fmt.Errorf("syllable blob overflows the 16-bit offset table")
	}

	setBlob := make([]byte, 0, 4*len(table.sets))
	for _, set := range table.sets {
		if len(set) == 0 || len(set) > 255 {
			return nil, fmt.Errorf("reading set of length %d cannot be encoded", len(set))
		}
		setBlob = append(setBlob, byte(len(set)))
		for _, index := range set {
			setBlob = binary.BigEndian.AppendUint16(setBlob, uint16(index))
		}
	}

	rangeBlob := make([]byte, 0, 7*len(table.rangeRecs))
	for _, record := range table.rangeRecs {
		span := uint32(record.last - record.first + 1)
		if span > 0xFFFF {
			return nil, fmt.Errorf("rune range U+%04X..U+%04X overflows the 16-bit span", record.first, record.last)
		}
		rangeBlob = append(rangeBlob,
			byte(uint32(record.first)>>16), byte(uint32(record.first)>>8), byte(uint32(record.first)),
			byte(span>>8), byte(span))
		rangeBlob = binary.BigEndian.AppendUint16(rangeBlob, uint16(record.set))
	}

	var b bytes.Buffer
	fmt.Fprintln(&b, "// Code generated by scripts/generate-pinyin-table; DO NOT EDIT.")
	fmt.Fprintln(&b, "//")
	fmt.Fprintln(&b, "// Hanzi-to-pinyin readings for the lexical search feed. The table holds")
	fmt.Fprintln(&b, "// the kMandarin readings of the Unicode Unihan database with tone marks")
	fmt.Fprintln(&b, "// stripped and the umlaut written as ASCII 'v'. The first reading of a")
	fmt.Fprintln(&b, "// multi-reading character is its primary reading. Re-run the generator")
	fmt.Fprintln(&b, "// to refresh it; never edit this file by hand.")
	fmt.Fprintln(&b, "//")
	fmt.Fprintf(&b, "// Source: %s\n", defaultSourceURL)
	fmt.Fprintf(&b, "// Input read from: %s\n", sourceUsed)
	fmt.Fprintf(&b, "// Unihan version: %s\n", table.unicodeVersion)
	fmt.Fprintf(&b, "// Unihan_Readings.txt date: %s\n", table.unihanDate)
	fmt.Fprintf(&b, "// Input SHA-256: sha256:%s\n", hex.EncodeToString(digest[:]))
	fmt.Fprintf(&b, "// Generated (UTC): %s\n", time.Now().UTC().Format("2006-01-02"))
	fmt.Fprintf(&b, "// Characters covered: %d\n", table.runeCount)
	fmt.Fprintln(&b, "// License: Unicode Character Database terms of use (public domain);")
	fmt.Fprintln(&b, "// see https://www.unicode.org/license.txt")
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, "package pinyin")
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, "// The constants below are base64-encoded blobs decoded by loadTable:")
	fmt.Fprintln(&b, "//")
	fmt.Fprintln(&b, "//\tpinyinSyllablesB64        unique sorted syllables, concatenated")
	fmt.Fprintln(&b, "//\tpinyinSyllableOffsetsB64  (n+1) 2-byte big-endian byte offsets into the")
	fmt.Fprintln(&b, "//\t                         syllable blob; the last offset is its length")
	fmt.Fprintln(&b, "//\tpinyinReadingSetsB64      per unique reading set: 1 byte syllable count")
	fmt.Fprintln(&b, "//\t                         then count 2-byte big-endian syllable indices")
	fmt.Fprintln(&b, "//\tpinyinRangesB64          per maximal rune range with one reading set:")
	fmt.Fprintln(&b, "//\t                         3-byte big-endian first rune, 2-byte span-1,")
	fmt.Fprintln(&b, "//\t                         2-byte reading-set index")
	fmt.Fprintln(&b)
	writeB64Const(&b, "pinyinSyllablesB64", []byte(syllableBlob))
	writeB64Const(&b, "pinyinSyllableOffsetsB64", uint16Bytes(offsets))
	writeB64Const(&b, "pinyinReadingSetsB64", setBlob)
	writeB64Const(&b, "pinyinRangesB64", rangeBlob)
	return format.Source(b.Bytes())
}

func uint16Bytes(values []uint16) []byte {
	out := make([]byte, 0, len(values)*2)
	for _, value := range values {
		out = binary.BigEndian.AppendUint16(out, value)
	}
	return out
}

// writeB64Const writes one base64 string constant, wrapped across lines so
// the generated source stays readable.
func writeB64Const(b *bytes.Buffer, name string, payload []byte) {
	encoded := base64.StdEncoding.EncodeToString(payload)
	fmt.Fprintf(b, "const %s = \"\" +\n", name)
	const lineLen = 100
	for len(encoded) > lineLen {
		fmt.Fprintf(b, "\t\"%s\" +\n", encoded[:lineLen])
		encoded = encoded[lineLen:]
	}
	fmt.Fprintf(b, "\t\"%s\"\n\n", encoded)
}

func repoRoot() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}
