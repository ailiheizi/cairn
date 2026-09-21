// Package search implements the bundled lexical IndexProvider/QueryProvider:
// one physically separate disposable SQLite FTS5 database per index generation.
package search

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/ailiheizi/restoreweave/server/internal/search/pinyin"

	_ "modernc.org/sqlite"
)

var (
	ErrUnavailable  = errors.New("search index is unavailable")
	ErrNotFound     = errors.New("index generation not found")
	ErrInvalidQuery = errors.New("search query is invalid")
)

type Document struct {
	SubjectID string
	Path      string
	// NamePinyin, PathPinyin, NotesPinyin, DescriptionsPinyin, and
	// ExtractedPinyin hold the derived CJK/pinyin token enrichment the feed
	// appends for the name/path/notes/descriptions/extracted axes (see
	// pinyin.EnrichmentAppendix; the extracted axis is bounded, see
	// extractedPinyinEnrichmentBound). They are searchable through the same
	// axes, but never returned as display data: the Hit fields stay the
	// original raw values.
	NamePinyin         string
	PathPinyin         string
	NotesPinyin        string
	DescriptionsPinyin string
	ExtractedPinyin    string
	Name               string
	Suffix             string
	EntryType          string
	ContentID          string
	Metadata           string
	Duplicates         string
	DuplicateGroup     string
	Protection         string
	Locators           string
	Tags               string
	Notes              string
	Descriptions       string
	Extracted          string
	Detection          string
	Processing         string
	Representations    string
	Language           string
	LogicalSize        *int64
	MtimeMillis        *int64
	Segments           string
}

// SegmentRef is provenance for one durable text span inside a hit.
type SegmentRef struct {
	DescriptionDocumentID string
	SourceType            string
	SourceID              string
	SegmentID             string
	Ordinal               int64
	MatchedText           string
	Kind                  string
	Producer              string
	Accepted              bool
	Language              string
}

type Hit struct {
	SubjectID     string
	Path          string
	Name          string
	EntryType     string
	ContentID     string
	ConstructAxes []string
	Segments      []SegmentRef
}

type Engine struct {
	Dir string
}

func (engine *Engine) PathFor(generationID string) string {
	return filepath.Join(engine.Dir, generationID+".sqlite")
}

func (engine *Engine) Build(ctx context.Context, generationID string, docs []Document) (string, error) {
	if strings.TrimSpace(generationID) == "" {
		return "", errors.New("index generation id is required")
	}
	if err := os.MkdirAll(engine.Dir, 0o700); err != nil {
		return "", err
	}
	path := engine.PathFor(generationID)
	_ = os.Remove(path)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return "", err
	}
	defer db.Close()
	if _, err := db.ExecContext(ctx, `
CREATE VIRTUAL TABLE documents USING fts5(
    subject_id UNINDEXED,
    path,
    path_pinyin,
    name,
    name_pinyin,
    suffix,
    entry_type,
    content_id,
    metadata,
    duplicates,
    protection,
    locators,
    tags,
    notes,
    notes_pinyin,
    descriptions,
    descriptions_pinyin,
    extracted,
    extracted_pinyin,
    detection,
    processing,
    representations,
    language,
    size_facet UNINDEXED,
    mtime_facet UNINDEXED,
    duplicate_group UNINDEXED,
    segments UNINDEXED,
    tokenize = 'unicode61'
)`); err != nil {
		return "", fmt.Errorf("create fts5 table: %w", err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `
INSERT INTO documents(
    subject_id, path, path_pinyin, name, name_pinyin, suffix, entry_type, content_id, metadata,
    duplicates, protection, locators, tags, notes, notes_pinyin, descriptions, descriptions_pinyin,
    extracted, extracted_pinyin, detection, processing, representations, language, size_facet,
    mtime_facet, duplicate_group, segments
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return "", err
	}
	defer stmt.Close()
	for _, doc := range docs {
		if _, err := stmt.ExecContext(ctx, doc.SubjectID, doc.Path, doc.PathPinyin, doc.Name, doc.NamePinyin,
			doc.Suffix, doc.EntryType, doc.ContentID, doc.Metadata, doc.Duplicates,
			doc.Protection, doc.Locators, doc.Tags, doc.Notes, doc.NotesPinyin,
			doc.Descriptions, doc.DescriptionsPinyin, doc.Extracted, doc.ExtractedPinyin,
			doc.Detection, doc.Processing, doc.Representations, doc.Language,
			nullableInt64Value(doc.LogicalSize),
			nullableInt64Value(doc.MtimeMillis), doc.DuplicateGroup, doc.Segments); err != nil {
			return "", err
		}
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return path, nil
}

func (engine *Engine) Query(ctx context.Context, dbPath, text string, axes []string) ([]Hit, error) {
	return engine.QueryFiltered(ctx, dbPath, text, axes, Filters{})
}

// QueryFiltered is the structured form of Query. Typed filters become precise
// post-filter predicates; free-text behavior is unchanged from Query.
func (engine *Engine) QueryFiltered(ctx context.Context, dbPath, text string, axes []string, filters Filters) ([]Hit, error) {
	normalizedFilters, err := NormalizeFilters(filters)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidQuery, err)
	}
	filters = normalizedFilters
	if strings.TrimSpace(text) == "" && !filters.Has() {
		return nil, errors.New("search query text is required")
	}
	if _, err := os.Stat(dbPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrUnavailable
		}
		return nil, err
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	tokens := queryTokens(text)
	// FTS5 MATCH requires at least one term. With no free text the structured
	// filters still run, so fall back to a plain full-table scan; typed
	// post-filter predicates do the real constraint work in both cases.
	where := ""
	args := []any{}
	if len(tokens) > 0 {
		where = "WHERE documents MATCH ?"
		args = append(args, ftsQuery(text, axes))
	}
	query := `
SELECT subject_id, path, name, suffix, entry_type, content_id, metadata,
       duplicates, protection, locators, tags, notes, descriptions, extracted,
       detection, processing, representations, language,
       size_facet, mtime_facet, duplicate_group, segments
FROM documents ` + where
	if len(tokens) > 0 {
		query += ` ORDER BY rank, rowid`
	} else {
		// A deterministic order makes candidate paging stable while filters
		// are applied after the row is decoded.
		query += ` ORDER BY rowid`
	}
	const (
		candidatePageSize = 1000
		resultLimit       = 1000
	)
	var hits []Hit
	for offset := 0; len(hits) < resultLimit; offset += candidatePageSize {
		pageArgs := append(append([]any(nil), args...), candidatePageSize, offset)
		rows, queryErr := db.QueryContext(ctx, query+` LIMIT ? OFFSET ?`, pageArgs...)
		if queryErr != nil {
			return nil, fmt.Errorf("query fts5: %w", queryErr)
		}
		pageRows := 0
		for rows.Next() {
			pageRows++
			var hit Hit
			var suffix, metadata, duplicates, protection, locators, tags, notes, descriptions, extracted string
			var detection, processing, representations, language string
			var sizeFacet, mtimeFacet sql.NullInt64
			var duplicateGroup, segments string
			if err := rows.Scan(
				&hit.SubjectID, &hit.Path, &hit.Name, &suffix, &hit.EntryType,
				&hit.ContentID, &metadata, &duplicates, &protection, &locators,
				&tags, &notes, &descriptions, &extracted, &detection, &processing,
				&representations, &language, &sizeFacet, &mtimeFacet, &duplicateGroup,
				&segments,
			); err != nil {
				_ = rows.Close()
				return nil, err
			}
			if !matchesFilters(hit, filters, sizeFacet, mtimeFacet, duplicateGroup, suffix, protection, language) {
				continue
			}
			hit.ConstructAxes = matchedConstructAxes(hit, suffix, metadata, duplicates,
				protection, locators, tags, notes, descriptions, extracted,
				detection, processing, representations, language, duplicateGroup, tokens)
			hit.Segments = matchedDescriptionSegments(segments, tokens)
			hits = append(hits, hit)
			if len(hits) >= resultLimit {
				break
			}
		}
		rowsErr := rows.Err()
		closeErr := rows.Close()
		if rowsErr != nil {
			return nil, rowsErr
		}
		if closeErr != nil {
			return nil, closeErr
		}
		if pageRows < candidatePageSize || len(hits) >= resultLimit {
			break
		}
	}
	return hits, nil
}

// filterCandidates applies lexical typed facets to an already bounded set of
// provider hits. The provider's path/type fields are display data only; filter
// authority comes from the generation-aligned lexical row.
func (engine *Engine) filterCandidates(ctx context.Context, dbPath string, candidates []Hit, filters Filters) ([]Hit, error) {
	if _, err := os.Stat(dbPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrUnavailable
		}
		return nil, err
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	stmt, err := db.PrepareContext(ctx, `
SELECT entry_type, content_id, duplicate_group, suffix, protection, language,
       size_facet, mtime_facet
FROM documents
WHERE subject_id = ?
LIMIT 1`)
	if err != nil {
		return nil, fmt.Errorf("%w: prepare candidate filter: %w", ErrUnavailable, err)
	}
	defer stmt.Close()
	if len(candidates) == 0 {
		// Preparing against the lexical schema is part of the dependency
		// check. An empty provider result must not hide a missing, corrupt, or
		// wrong-schema lexical authority.
		return nil, nil
	}
	filtered := make([]Hit, 0, len(candidates))
	for _, candidate := range candidates {
		var indexed Hit
		var duplicateGroup, suffix, protection, language string
		var sizeFacet, mtimeFacet sql.NullInt64
		err := stmt.QueryRowContext(ctx, candidate.SubjectID).Scan(
			&indexed.EntryType, &indexed.ContentID, &duplicateGroup, &suffix,
			&protection, &language, &sizeFacet, &mtimeFacet,
		)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("filter provider candidate %q: %w", candidate.SubjectID, err)
		}
		if matchesFilters(indexed, filters, sizeFacet, mtimeFacet, duplicateGroup, suffix, protection, language) {
			filtered = append(filtered, candidate)
		}
	}
	return filtered, nil
}

// matchesFilters applies typed structured constraints as post-filter
// predicates over the FTS row. Numeric facets are stored in UNINDEXED columns
// so MATCH can never touch them; constraints never invent a hit.
func matchesFilters(hit Hit, filters Filters, sizeFacet, mtimeFacet sql.NullInt64, duplicateGroup, suffix, protection, language string) bool {
	if filters.EntryType != "" && strings.ToUpper(filters.EntryType) != strings.ToUpper(hit.EntryType) {
		return false
	}
	if filters.ContentID != "" && hit.ContentID != filters.ContentID {
		return false
	}
	if filters.DuplicateGroup != "" && duplicateGroup != filters.DuplicateGroup {
		return false
	}
	if filters.ProtectionMode != "" && !containsWord(filters.ProtectionMode, protection) {
		return false
	}
	// Language is a structured exact facet. Compare canonicalized display
	// values without treating missing or whitespace-only values as a match.
	if want := strings.TrimSpace(filters.Language); want != "" &&
		!strings.EqualFold(want, strings.TrimSpace(language)) {
		return false
	}
	if filters.Suffix != "" && NormalizeSuffix(suffix) != NormalizeSuffix(filters.Suffix) {
		return false
	}
	// The media class is derived from the recorded suffix by the one table in
	// media_class.go. An entry whose suffix is not recorded has no class and
	// matches no media_class value, including "other"; a recorded suffix the
	// table does not classify is "other".
	if filters.MediaClass != "" && MediaClassOf(suffix) != filters.MediaClass {
		return false
	}
	if filters.SizeMin != nil {
		if !sizeFacet.Valid || sizeFacet.Int64 < *filters.SizeMin {
			return false
		}
	}
	if filters.SizeMax != nil {
		if !sizeFacet.Valid || sizeFacet.Int64 > *filters.SizeMax {
			return false
		}
	}
	if filters.MtimeAfter != nil {
		if !mtimeFacet.Valid || mtimeFacet.Int64 <= *filters.MtimeAfter {
			return false
		}
	}
	if filters.MtimeBefore != nil {
		if !mtimeFacet.Valid || mtimeFacet.Int64 >= *filters.MtimeBefore {
			return false
		}
	}
	return true
}

func (engine *Engine) RemoveFile(dbPath string) error {
	if err := os.Remove(dbPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	_ = os.Remove(dbPath + "-wal")
	_ = os.Remove(dbPath + "-shm")
	return nil
}

func ftsQuery(text string, axes []string) string {
	tokens := queryTokens(text)
	if len(tokens) == 0 {
		return `""`
	}
	if !restrictToAxes(axes) {
		parts := make([]string, len(tokens))
		for i, token := range tokens {
			parts[i] = `"` + token + `"*`
		}
		return strings.Join(parts, " AND ")
	}
	groups := make([]string, 0, len(tokens))
	for _, token := range tokens {
		alts := make([]string, 0, len(axes))
		for _, axis := range axes {
			for _, column := range ftsColumnsForAxis(axis) {
				alts = append(alts, column+`:"`+token+`"*`)
			}
		}
		if len(alts) == 1 {
			groups = append(groups, alts[0])
			continue
		}
		groups = append(groups, "("+strings.Join(alts, " OR ")+")")
	}
	return strings.Join(groups, " AND ")
}

// ftsColumnsForAxis maps one lexical construct axis to the FTS5 columns that
// carry it. The name, path, notes, descriptions, and extracted axes span both
// the raw field and its pinyin token enrichment, so a pinyin query reaches the
// same axis without ever changing the raw display values.
func ftsColumnsForAxis(axis string) []string {
	switch axis {
	case AxisType:
		return []string{"entry_type"}
	case AxisChecksum:
		return []string{"content_id"}
	case AxisName:
		return []string{"name", "name_pinyin"}
	case AxisPath:
		return []string{"path", "path_pinyin"}
	case AxisNotes:
		return []string{"notes", "notes_pinyin"}
	case AxisDescriptions:
		return []string{"descriptions", "descriptions_pinyin"}
	case AxisExtracted:
		return []string{"extracted", "extracted_pinyin"}
	default:
		return []string{axis}
	}
}

func queryTokens(text string) []string {
	text = strings.TrimSpace(text)
	var tokens []string
	var current strings.Builder
	flush := func() {
		token := strings.TrimSpace(current.String())
		current.Reset()
		if token == "" {
			return
		}
		tokens = append(tokens, token)
	}
	for _, r := range text {
		if !unicode.IsLetter(r) && !unicode.IsNumber(r) {
			flush()
			continue
		}
		current.WriteRune(r)
	}
	flush()
	return tokens
}

func restrictToAxes(axes []string) bool {
	return len(axes) > 0 && len(axes) < len(LexicalConstructAxes)
}

func matchedConstructAxes(hit Hit, suffix, metadata, duplicates, protection, locators, tags, notes, descriptions, extracted string,
	detection, processing, representations, language, duplicateGroup string, tokens []string) []string {
	if len(tokens) == 0 {
		return nil
	}
	fields := []struct {
		axis string
		text string
		// enrichment returns the additional derived token text indexed for
		// this field's axis: the CJK adjacency tokens (bigrams plus single
		// characters) and the pinyin tokens (see pinyin.EnrichmentAppendix).
		// It is nil for fields without that enrichment, and it is called
		// lazily so a query already answered by the raw text never pays for
		// the transliteration (the extracted axis can be large).
		enrichment func(string) string
	}{
		{AxisPath, hit.Path, pinyin.EnrichmentAppendix},
		{AxisName, hit.Name, pinyin.EnrichmentAppendix},
		{AxisSuffix, suffix, nil},
		{AxisType, hit.EntryType, nil},
		{AxisChecksum, hit.ContentID, nil},
		{AxisMetadata, metadata, nil},
		{AxisDuplicates, duplicates, nil},
		{AxisDuplicateGroup, duplicateGroup, nil},
		{AxisProtection, protection, nil},
		{AxisLocators, locators, nil},
		{AxisTags, tags, nil},
		{AxisNotes, notes, pinyin.EnrichmentAppendix},
		{AxisDescriptions, descriptions, pinyin.EnrichmentAppendix},
		{AxisExtracted, extracted, boundedPinyinEnrichment},
		{AxisDetection, detection, nil},
		{AxisProcessing, processing, nil},
		{AxisRepresentations, representations, nil},
		{AxisLanguage, language, nil},
	}
	var matched []string
	for _, field := range fields {
		lower := strings.ToLower(field.text)
		enriched := ""
		enrichedComputed := false
		for _, token := range tokens {
			if token == "" {
				continue
			}
			wanted := strings.ToLower(token)
			if strings.Contains(lower, wanted) {
				matched = append(matched, field.axis)
				break
			}
			if field.enrichment == nil {
				continue
			}
			if !enrichedComputed {
				enriched = strings.ToLower(field.enrichment(field.text))
				enrichedComputed = true
			}
			if enriched != "" && strings.Contains(enriched, wanted) {
				matched = append(matched, field.axis)
				break
			}
		}
	}
	return matched
}

// extractedPinyinEnrichmentBound bounds the derived token enrichment of the
// extracted axis to the first 256 KiB of the joined extracted-field text,
// measured in bytes and always cut at a UTF-8 rune boundary. Extracted
// document text can be arbitrarily large while the appendix adds a bounded
// number of tokens per Han character (adjacency bigrams, single characters,
// and syllables), so the bound keeps feed growth proportional for huge
// documents. This is an honest feed shape, not silent truncation: the raw
// extracted text stays whole in its own field, so raw-character queries over
// the full body still match (a contiguous raw run matches at its start even
// beyond the bound); only the derived token appendix stops at the bound
// (profile: fts5-metadata-v4).
const extractedPinyinEnrichmentBound = 256 << 10

// boundedPinyinEnrichment is the extracted-axis token enrichment: the same
// pinyin.EnrichmentAppendix the other text axes use, applied to the declared
// bounded prefix of the field text.
func boundedPinyinEnrichment(text string) string {
	return pinyin.EnrichmentAppendix(boundForPinyinEnrichment(text))
}

// boundForPinyinEnrichment returns the prefix of text the pinyin enrichment
// covers: the whole text when it fits, otherwise the first
// extractedPinyinEnrichmentBound bytes backed up to a UTF-8 rune boundary so
// the prefix never splits a character.
func boundForPinyinEnrichment(text string) string {
	if len(text) <= extractedPinyinEnrichmentBound {
		return text
	}
	cut := extractedPinyinEnrichmentBound
	for cut > 0 && !utf8.RuneStart(text[cut]) {
		cut--
	}
	return text[:cut]
}

// matchedDescriptionSegments returns provenance for description matches. The
// segments UNINDEXED column carries the durable segment text digests; a hit
// reports exactly the segments whose text matched a query token. No token
// match means no segment is claimed, even when the whole-body axis matched.
func matchedDescriptionSegments(segmentsJSON string, tokens []string) []SegmentRef {
	if len(tokens) == 0 || strings.TrimSpace(segmentsJSON) == "" {
		return nil
	}
	var segments []SegmentRef
	if err := json.Unmarshal([]byte(segmentsJSON), &segments); err != nil {
		return nil
	}
	var refs []SegmentRef
	for _, segment := range segments {
		lower := strings.ToLower(segment.MatchedText)
		for _, token := range tokens {
			if token != "" && strings.Contains(lower, strings.ToLower(token)) {
				refs = append(refs, segment)
				break
			}
		}
	}
	return refs
}

func containsWord(word, text string) bool {
	word = strings.ToLower(word)
	text = strings.ToLower(text)
	for _, field := range strings.Fields(text) {
		if field == word || strings.HasPrefix(field, word+"_") {
			return true
		}
	}
	return false
}

func nullableInt64Value(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}
