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
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/ailiheizi/cairn/server/internal/search/pinyin"

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
	// DescriptionSource is a verified, disposable lexical projection. It is
	// absent in older generations and for segments whose durable spans fail
	// validation; it never changes semantic inputs or source authority.
	DescriptionSource *descriptionSourceProvenance `json:"description_source_provenance,omitempty"`
	// MatchSpans are query-derived byte ranges within MatchedText. They are
	// absent when the match came only from derived text or cannot be mapped
	// exactly to this source segment.
	MatchSpans []MatchSpan `json:"-"`
}

type MatchSpan struct {
	StartByte int `json:"start_byte"`
	EndByte   int `json:"end_byte"`
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
//
// It keeps the pre-paging single-answer shape: at most legacyResultLimit hits
// and no continuation. Callers that must be able to retrieve every match use
// QueryPage, which replaces the same bound with an explicit, pageable one.
func (engine *Engine) QueryFiltered(ctx context.Context, dbPath, text string, axes []string, filters Filters) ([]Hit, error) {
	page, err := engine.queryPage(ctx, dbPath, text, axes, filters, PageRequest{Limit: legacyResultLimit})
	if err != nil {
		return nil, err
	}
	return page.Hits, nil
}

// QueryPage returns one bounded page of lexical hits in a total order.
//
// The page is a keyset page: the caller resumes strictly after the position
// the previous page reported. A generation is immutable, so (rank, rowid) --
// or rowid alone when no MATCH runs -- is a total order over the whole match
// set and a page boundary cannot lose or duplicate a row. The continuation is
// bound to that exact generation and query by its caller, never by this
// method.
func (engine *Engine) QueryPage(ctx context.Context, dbPath, text string, axes []string, filters Filters, page PageRequest) (HitPage, error) {
	return engine.queryPage(ctx, dbPath, text, axes, filters, page)
}

func (engine *Engine) queryPage(ctx context.Context, dbPath, text string, axes []string, filters Filters, page PageRequest) (result HitPage, err error) {
	normalizedFilters, err := NormalizeFilters(filters)
	if err != nil {
		return result, fmt.Errorf("%w: %v", ErrInvalidQuery, err)
	}
	filters = normalizedFilters
	if strings.TrimSpace(text) == "" && !filters.Has() {
		return result, errors.New("search query text is required")
	}
	limit, err := ResolvePageSize(page.Limit)
	if err != nil {
		return result, err
	}
	if page.Position != nil {
		if err := validatePosition(*page.Position, orderFor(!page.Position.HasRank)); err != nil {
			return result, err
		}
	}
	if _, err := os.Stat(dbPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return result, ErrUnavailable
		}
		return result, err
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return result, err
	}
	defer db.Close()
	matcher, err := newProvenanceMatcher(ctx)
	if err != nil {
		return result, fmt.Errorf("initialize provenance matcher: %w", err)
	}
	defer matcher.Close()
	tokens := queryTokens(text)
	hasText := len(tokens) > 0
	result.Order = orderFor(!hasText)
	// FTS5 MATCH requires at least one term. With no free text the structured
	// filters still run, so fall back to a plain full-table scan; typed
	// post-filter predicates do the real constraint work in both cases.
	where := ""
	args := []any{}
	if hasText {
		where = "WHERE documents MATCH ?"
		args = append(args, ftsQuery(text, axes))
	}
	if page.Position != nil {
		position := *page.Position
		if position.Lane != "" && position.Lane != DimensionLexical {
			return result, fmt.Errorf("%w: continuation position belongs to lane %q", ErrInvalidQuery, position.Lane)
		}
		if hasText {
			if where == "" {
				where = "WHERE"
			} else {
				where += " AND"
			}
			// bm25 is lower-is-better and rowid is unique, so this is a strict
			// resume after the last returned row of the previous page.
			where += " (rank > ? OR (rank = ? AND rowid > ?))"
			args = append(args, position.Rank, position.Rank, position.RowID)
		} else {
			if where == "" {
				where = "WHERE"
			} else {
				where += " AND"
			}
			where += " rowid > ?"
			args = append(args, position.RowID)
		}
	}
	rankColumn := ""
	if hasText {
		rankColumn = ", rank"
	}
	query := `
SELECT subject_id, path, name, suffix, entry_type, content_id, metadata,
       duplicates, protection, locators, tags, notes, descriptions, descriptions_pinyin, extracted,
       detection, processing, representations, language,
       size_facet, mtime_facet, duplicate_group, segments, rowid` + rankColumn + `
FROM documents ` + where
	if hasText {
		query += ` ORDER BY rank, rowid`
	} else {
		// A deterministic order makes candidate paging stable while filters
		// are applied after the row is decoded.
		query += ` ORDER BY rowid`
	}
	const candidatePageSize = 1000
	hits := make([]Hit, 0, limit)
	var last PagePosition
	hasMore := false
	for offset := 0; ; offset += candidatePageSize {
		pageArgs := append(append([]any(nil), args...), candidatePageSize, offset)
		rows, queryErr := db.QueryContext(ctx, query+` LIMIT ? OFFSET ?`, pageArgs...)
		if queryErr != nil {
			return result, fmt.Errorf("query fts5: %w", queryErr)
		}
		pageRows := 0
		for rows.Next() {
			pageRows++
			var hit Hit
			var suffix, metadata, duplicates, protection, locators, tags, notes, descriptions, descriptionsPinyin, extracted string
			var detection, processing, representations, language string
			var sizeFacet, mtimeFacet sql.NullInt64
			var duplicateGroup, segments string
			var rowID int64
			var rank float64
			scan := []any{
				&hit.SubjectID, &hit.Path, &hit.Name, &suffix, &hit.EntryType,
				&hit.ContentID, &metadata, &duplicates, &protection, &locators,
				&tags, &notes, &descriptions, &descriptionsPinyin, &extracted, &detection, &processing,
				&representations, &language, &sizeFacet, &mtimeFacet, &duplicateGroup,
				&segments, &rowID,
			}
			if hasText {
				scan = append(scan, &rank)
			}
			if err := rows.Scan(scan...); err != nil {
				_ = rows.Close()
				return result, err
			}
			if !matchesFilters(hit, filters, sizeFacet, mtimeFacet, duplicateGroup, suffix, protection, language) {
				continue
			}
			if len(hits) == limit {
				// The (limit+1)-th match proves the generation holds more
				// matches than this page. Report it explicitly instead of
				// silently truncating: the page keeps the first limit matches
				// and resumes strictly after the last of them.
				hasMore = true
				break
			}
			hit.ConstructAxes, queryErr = matchedConstructAxes(ctx, matcher, hit, suffix, metadata, duplicates,
				protection, locators, tags, notes, descriptions, extracted,
				detection, processing, representations, language, duplicateGroup, tokens, axes)
			if queryErr != nil {
				_ = rows.Close()
				return result, fmt.Errorf("project construct match: %w", queryErr)
			}
			hit.Segments, queryErr = matchedDescriptionSegments(ctx, matcher, segments, tokens, axes, descriptions, descriptionsPinyin, extracted, hit.SubjectID)
			if queryErr != nil {
				_ = rows.Close()
				return result, fmt.Errorf("project source match spans: %w", queryErr)
			}
			hits = append(hits, hit)
			last = PagePosition{Lane: DimensionLexical, RowID: rowID, Rank: rank, HasRank: hasText}
		}
		rowsErr := rows.Err()
		closeErr := rows.Close()
		if rowsErr != nil {
			return result, rowsErr
		}
		if closeErr != nil {
			return result, closeErr
		}
		if hasMore || pageRows < candidatePageSize {
			break
		}
	}
	result.Hits = hits
	result.HasMore = hasMore
	if hasMore {
		result.Next = last
	}
	return result, nil
}

// orderFor names the total order a lexical page is produced in. A free-text
// page orders by (bm25 rank, rowid); a filter-only page has no rank column and
// orders by the unique rowid alone.
func orderFor(filterOnly bool) string {
	if filterOnly {
		return OrderRowID
	}
	return OrderRankRowID
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

// provenanceTokens keeps combining marks inside a source token when checking
// whether a lexical match can be attributed to that source. It is deliberately
// separate from queryTokens so provenance projection never changes the query
// text handed to FTS5.
func provenanceTokens(text string) []string {
	text = strings.ToLower(text)
	var tokens []string
	var current strings.Builder
	flush := func() {
		token := strings.TrimSpace(current.String())
		current.Reset()
		if token != "" {
			tokens = append(tokens, token)
		}
	}
	for _, r := range text {
		if !unicode.IsLetter(r) && !unicode.IsNumber(r) && !unicode.IsMark(r) && !unicode.Is(unicode.Co, r) {
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

func matchedConstructAxes(ctx context.Context, matcher *provenanceMatcher, hit Hit, suffix, metadata, duplicates, protection, locators, tags, notes, descriptions, extracted string,
	detection, processing, representations, language, duplicateGroup string, tokens, axes []string) ([]string, error) {
	if len(tokens) == 0 {
		return nil, nil
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
		if !axisAllowed(field.axis, axes) {
			continue
		}
		_, rawMatch, err := matcher.matches(ctx, field.text, tokens, true)
		if err != nil {
			return nil, err
		}
		if rawMatch {
			matched = append(matched, field.axis)
			continue
		}
		if field.enrichment != nil {
			_, derivedMatch, err := matcher.matches(ctx, field.enrichment(field.text), tokens, false)
			if err != nil {
				return nil, err
			}
			if derivedMatch {
				matched = append(matched, field.axis)
			}
		}
	}
	return matched, nil
}

func axisAllowed(axis string, axes []string) bool {
	if len(axes) == 0 {
		return true
	}
	for _, requested := range axes {
		if requested == axis {
			return true
		}
	}
	return false
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

// matchedDescriptionSegments projects lexical segment provenance from the
// durable source text. The FTS generation indexes annotations, descriptions,
// and extracted artifacts on separate axes, so attribution must honor the
// requested axes. Derived extracted tokens are bounded over the joined field;
// only when the segment list reconstructs that field exactly can their source
// offsets be inferred safely.
type provenanceMatcher struct {
	db *sql.DB
}

func newProvenanceMatcher(ctx context.Context) (*provenanceMatcher, error) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.ExecContext(ctx, `CREATE VIRTUAL TABLE provenance USING fts5(raw, derived, tokenize='unicode61')`); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &provenanceMatcher{db: db}, nil
}

func (m *provenanceMatcher) Close() error { return m.db.Close() }

func (m *provenanceMatcher) matches(ctx context.Context, text string, tokens []string, raw bool) ([]MatchSpan, bool, error) {
	if _, err := m.db.ExecContext(ctx, `DELETE FROM provenance`); err != nil {
		return nil, false, err
	}
	columnName := "derived"
	if raw {
		columnName = "raw"
	}
	if _, err := m.db.ExecContext(ctx, `INSERT INTO provenance(rowid, `+columnName+`) VALUES(1, ?)`, text); err != nil {
		return nil, false, err
	}
	var spans []MatchSpan
	matched := false
	column := 1
	columnName = "derived"
	if raw {
		column = 0
		columnName = "raw"
	}
	terms := make([]string, 0, len(tokens))
	for _, token := range tokens {
		terms = append(terms, `"`+token+`"*`)
	}
	query := columnName + ` : (` + strings.Join(terms, " OR ") + `)`
	openMark, closeMark := "\x01RW_OPEN\x02", "\x02RW_CLOSE\x01"
	for strings.Contains(text, openMark) {
		openMark += "_"
	}
	for strings.Contains(text, closeMark) || closeMark == openMark {
		closeMark += "_"
	}
	var marked string
	err := m.db.QueryRowContext(ctx, `SELECT highlight(provenance, ?, ?, ?) FROM provenance WHERE provenance MATCH ?`, column, openMark, closeMark, query).Scan(&marked)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	matched = true
	original := marked
	for {
		start := strings.Index(marked, openMark)
		if start < 0 {
			break
		}
		marked = marked[:start] + marked[start+len(openMark):]
		end := strings.Index(marked[start:], closeMark)
		if end < 0 {
			return nil, false, errors.New("FTS5 highlight returned an incomplete span")
		}
		spans = append(spans, MatchSpan{StartByte: start, EndByte: start + end})
		marked = marked[:start+end] + marked[start+end+len(closeMark):]
	}
	if strings.ReplaceAll(strings.ReplaceAll(original, openMark, ""), closeMark, "") != text {
		return nil, false, errors.New("FTS5 highlight did not preserve source bytes")
	}
	return mergeMatchSpans(spans), matched, nil
}

func mergeMatchSpans(spans []MatchSpan) []MatchSpan {
	if len(spans) < 2 {
		return spans
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i].StartByte < spans[j].StartByte })
	merged := spans[:1]
	for _, span := range spans[1:] {
		last := &merged[len(merged)-1]
		if span.StartByte <= last.EndByte {
			if span.EndByte > last.EndByte {
				last.EndByte = span.EndByte
			}
			continue
		}
		merged = append(merged, span)
	}
	return merged
}

// matchedDescriptionSourceRanges maps FTS highlights in the derived appendix
// back to source-byte intervals. Origins are ordered by appendix position,
// while their source intervals may be out of order (for example, the appendix
// emits all CJK bigrams before its single-character tokens).
func matchedDescriptionSourceRanges(spans []MatchSpan, origins []pinyin.TokenOrigin) []sourceByteRange {
	var sources []sourceByteRange
	originIndex := 0
	for _, span := range spans {
		for originIndex < len(origins) && origins[originIndex].EndByte <= span.StartByte {
			originIndex++
		}
		for i := originIndex; i < len(origins) && origins[i].StartByte < span.EndByte; i++ {
			origin := origins[i]
			if origin.EndByte > span.StartByte && origin.StartByte < span.EndByte {
				sources = append(sources, sourceByteRange{start: origin.SourceStartByte, end: origin.SourceEndByte})
			}
		}
	}
	if len(sources) < 2 {
		return sources
	}
	sort.Slice(sources, func(i, j int) bool {
		if sources[i].start == sources[j].start {
			return sources[i].end < sources[j].end
		}
		return sources[i].start < sources[j].start
	})
	merged := sources[:1]
	for _, source := range sources[1:] {
		last := &merged[len(merged)-1]
		if source.start <= last.end {
			if source.end > last.end {
				last.end = source.end
			}
			continue
		}
		merged = append(merged, source)
	}
	return merged
}

func sourceRangeOverlapsAny(segment sourceByteRange, sources []sourceByteRange) bool {
	index := sort.Search(len(sources), func(i int) bool { return sources[i].end > segment.start })
	return index < len(sources) && sources[index].start < segment.end
}

func matchedDescriptionSegments(ctx context.Context, matcher *provenanceMatcher, segmentsJSON string, tokens, axes []string, descriptions, descriptionsPinyin, extracted, subjectID string) ([]SegmentRef, error) {
	if len(tokens) == 0 || strings.TrimSpace(segmentsJSON) == "" {
		return nil, nil
	}
	var segments []SegmentRef
	var projection lexicalSegmentProjection
	versionedProjection := false
	if err := json.Unmarshal([]byte(segmentsJSON), &projection); err == nil && projection.SchemaVersion != 0 {
		segments = projection.Segments
		versionedProjection = true
	} else if err := json.Unmarshal([]byte(segmentsJSON), &segments); err != nil {
		return nil, nil
	}
	var verifiedRanges map[string]sourceByteRange
	var derivedOrigins []pinyin.TokenOrigin
	if versionedProjection && projection.SchemaVersion == lexicalSegmentProjectionSchemaV1 {
		verifiedRanges = verifiedDescriptionFieldRanges(descriptions, projection.DescriptionsFieldHash, segments, subjectID)
		appendix, origins := pinyin.EnrichmentAppendixWithOrigins(descriptions)
		if verifiedRanges != nil && appendix == descriptionsPinyin {
			derivedOrigins = origins
		}
	}
	var refs []SegmentRef
	artifactTexts := make([]string, 0)
	descriptionSegmentCounts := make(map[string]int)
	for _, segment := range segments {
		if segment.SourceType == "ARTIFACT" {
			artifactTexts = append(artifactTexts, segment.MatchedText)
		}
		if segment.SourceType == "DESCRIPTION" ||
			(segment.SourceType == "" && strings.TrimSpace(segment.DescriptionDocumentID) != "") {
			if documentID := strings.TrimSpace(segment.DescriptionDocumentID); documentID != "" {
				descriptionSegmentCounts[documentID]++
			}
		}
	}
	joinedArtifacts := strings.Join(artifactTexts, " ")
	extractedOffsetsKnown := len(artifactTexts) > 0 && joinedArtifacts == extracted
	var extractedCursor int
	extractedBound := len(boundForPinyinEnrichment(extracted))
	var derivedDescriptionSources []sourceByteRange
	if versionedProjection && len(derivedOrigins) > 0 && axisAllowed(AxisDescriptions, axes) {
		derivedSpans, _, err := matcher.matches(ctx, descriptionsPinyin, tokens, false)
		if err != nil {
			return nil, err
		}
		derivedDescriptionSources = matchedDescriptionSourceRanges(derivedSpans, derivedOrigins)
	}
	for _, segment := range segments {
		axis := ""
		switch segment.SourceType {
		case "ANNOTATION":
			axis = AxisNotes
		case "DESCRIPTION":
			axis = AxisDescriptions
		case "ARTIFACT":
			axis = AxisExtracted
		case "FILENAME":
			axis = AxisName
		default:
			// Older lexical generations serialized description provenance
			// before SourceType existed. The stable description document ID is
			// sufficient to retain that existing projection without guessing
			// for other unknown source shapes.
			if strings.TrimSpace(segment.DescriptionDocumentID) != "" {
				axis = AxisDescriptions
			} else {
				continue
			}
		}
		if !axisAllowed(axis, axes) {
			continue
		}
		text := segment.MatchedText
		derivedText := text
		derivedMatch := false
		if axis == AxisDescriptions {
			if versionedProjection {
				segmentRange, ok := verifiedRanges[segment.SegmentID]
				if !ok {
					// Invalid or incomplete provenance omits this explanation only.
					continue
				}
				derivedMatch = sourceRangeOverlapsAny(segmentRange, derivedDescriptionSources)
			} else {
				// Legacy generations lack source offsets. Keep their conservative
				// one-segment attribution rule without inventing provenance.
				documentID := strings.TrimSpace(segment.DescriptionDocumentID)
				if documentID == "" || segment.Ordinal != 0 || descriptionSegmentCounts[documentID] != 1 {
					derivedText = ""
				}
			}
		}
		if axis == AxisExtracted {
			if extractedOffsetsKnown {
				at := strings.Index(extracted[extractedCursor:], text)
				if at < 0 {
					continue
				}
				start := extractedCursor + at
				end := start + len(text)
				extractedCursor = end
				if start >= extractedBound {
					derivedText = ""
				} else if end > extractedBound {
					derivedText = boundForPinyinEnrichment(text[:extractedBound-start])
				}
			} else {
				// Without an exact source-to-field reconstruction, raw text can
				// still be explained, but no derived token is assigned to an
				// individual artifact because its joined-field offset is unknown.
				derivedText = ""
			}
		}
		rawSpans, rawMatch, rawErr := matcher.matches(ctx, text, tokens, true)
		if rawErr != nil {
			return nil, rawErr
		}
		if !(versionedProjection && axis == AxisDescriptions) && !rawMatch && derivedText != "" {
			var derivedErr error
			_, derivedMatch, derivedErr = matcher.matches(ctx, pinyin.EnrichmentAppendix(derivedText), tokens, false)
			if derivedErr != nil {
				return nil, derivedErr
			}
		}
		if rawMatch || derivedMatch {
			segment.MatchSpans = rawSpans
			refs = append(refs, segment)
		}
	}
	return refs, nil
}

// segmentMatchesTokens mirrors the lexical token-prefix behavior needed for
// source attribution. FTS5 matches prefixes at token starts; substring checks
// would falsely attribute a Latin interior such as "avel" to "travel".
// provenanceTokens approximates the bundled unicode61 token boundaries,
// including combining marks and private-use characters, without duplicating
// unicode61's diacritic folding. That can suppress some valid provenance for
// folded accents, but avoids claiming an interior substring as a token match.
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

// segmentMatchesTokens is retained for the legacy construct-axis projection.
// Source segment attribution and spans use the actual FTS5 matcher below.
func segmentMatchesTokens(text string, tokens []string) bool {
	fieldTokens := provenanceTokens(text)
	for _, queryToken := range tokens {
		wanted := strings.ToLower(queryToken)
		for _, fieldToken := range fieldTokens {
			if strings.HasPrefix(fieldToken, wanted) {
				return true
			}
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
