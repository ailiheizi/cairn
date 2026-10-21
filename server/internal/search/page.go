package search

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Bounded paging over a search generation.
//
// Only the lexical generation has a complete, materializable, totally ordered
// match set, so only the lexical lane can be walked to exhaustion. Every other
// lane (semantic, multimodal, acoustic, graph, token) is a bounded top-k
// answer with no seekable order; it is reported as bounded and truncated, and
// it never issues a continuation. A continuation is therefore accepted only
// for a request that resolves to exactly one pageable lane.
const (
	// DefaultPageSize is the bounded page size used when a caller does not
	// ask for one.
	DefaultPageSize = 200
	// MaxPageSize is the documented maximum a caller may request.
	MaxPageSize = 1000
	// LegacyResultLimit is the provider bound used by callers that do not
	// page. It keeps the pre-paging single-answer shape unchanged, and it is
	// the bound the control plane applies in default (unpaged) mode.
	LegacyResultLimit = legacyResultLimit
	// legacyResultLimit is the internal spelling of LegacyResultLimit.
	legacyResultLimit = 1000

	// OrderRankRowID is the total order of a free-text lexical page: the FTS5
	// bm25 rank first, then the unique FTS5 rowid as the tie-breaker.
	OrderRankRowID = "rank,rowid"
	// OrderRowID is the total order of a filter-only lexical page, where no
	// MATCH runs and the unique FTS5 rowid is already total.
	OrderRowID = "rowid"
	// OrderEntryPathID is the total order of the content-library projection:
	// the entry's recorded full path key first, then the unique namespace entry
	// id. Both are stable per published entry, so a page boundary cannot lose
	// or repeat an entry.
	OrderEntryPathID = "entry_path,entry_id"
	// OrderDescriptionSubjectRevisionID is the total order of a description
	// summary projection. Its key is internal to the authenticated cursor.
	OrderDescriptionSubjectRevisionID = "subject_ref,revision,description_document_id"
	// OrderSavedViewLexical is the total order of an authorized, filtered
	// SavedView projection. Its cursor carries a projection ordinal rather than
	// an index row key.
	OrderSavedViewLexical = "saved-view-lexical"

	// LaneContentList names the content-library projection lane. It is not an
	// index dimension: it is the published namespace projection, whose order is
	// total and whose position is a stable entry identity rather than an index
	// coordinate.
	LaneContentList = "content-list"
	// LaneDescriptionList names the pageable catalog description projection.
	LaneDescriptionList = "description-list"
	// LaneSavedView names a pageable projection of existing dynamic view
	// membership; it is not a new index dimension.
	LaneSavedView = "saved-view"

	// ContinuationTTL bounds how long an issued continuation stays valid. A
	// longer-lived token would let a stale page chain cross a generation
	// change, which this product treats as a correctness fault.
	ContinuationTTL = 15 * time.Minute

	continuationVersion = 1
)

// ErrInvalidContinuation is returned for a malformed, tampered, or
// out-of-scope continuation token. It is always an invalid-input refusal and
// never a partial answer.
var ErrInvalidContinuation = errors.New("invalid continuation token")

// ErrStaleContinuation is returned for an authentic continuation that names a
// generation, query, or order that no longer matches the live request. The
// caller restarts the chain; crossing silently is never allowed.
var ErrStaleContinuation = errors.New("continuation token is stale")

// PagePosition is the generation-bound keyset position of one candidate. It is
// never caller-visible on its own: it travels inside an authenticated
// continuation token, and it is only meaningful inside the exact generation,
// query, order, and authorization scope the token is bound to.
type PagePosition struct {
	// Lane is the lane whose ordered stream this position belongs to.
	Lane string
	// RowID is the FTS5 rowid of the last returned hit. It is unique within a
	// generation, which is what makes the order total.
	RowID int64
	// Rank is the FTS5 bm25 rank of the last returned hit. It is only present
	// for a free-text lexical page, whose order is (rank, rowid).
	Rank    float64
	HasRank bool
	// EntryID carries an authenticated catalog/projection position for
	// content-list, description-list, or saved-view continuations. It is not an
	// index coordinate.
	EntryID string
}

// PageRequest is one bounded page request against a provider.
type PageRequest struct {
	// Limit is the bounded page size. Zero means DefaultPageSize.
	Limit int
	// Position resumes strictly after this key. A nil position starts at the
	// beginning of the generation.
	Position *PagePosition
}

// HitPage is one bounded page of lexical hits.
type HitPage struct {
	Hits []Hit
	// HasMore is true only when the generation proves at least one further
	// candidate exists beyond this page.
	HasMore bool
	// Next is the position of the first candidate the page did not return. It
	// is meaningful only when HasMore is true.
	Next PagePosition
	// Order names the total order the page was produced in.
	Order string
}

// PageState is the honest bounding state of one provider answer.
type PageState struct {
	// Returned is the number of hits in this answer.
	Returned int
	// HasMore is true only when the provider proves further matches exist
	// beyond this answer.
	HasMore bool
	// Complete is true only when the answer provably contains every match of
	// the query.
	Complete bool
	// Truncated is true when the answer is bounded by a limit the provider
	// cannot page (a bounded top-k lane), so completeness cannot be claimed.
	Truncated bool
	// BoundedTopK is the provider's top-k ceiling for a bounded lane, or 0 for
	// the pageable lexical lane.
	BoundedTopK int
	// Order names the total order of a pageable lane; empty for a bounded lane.
	Order string
	// Lane is the dimension the state describes.
	Lane string
	// Next is the resume key for a pageable lane. It is nil when the answer is
	// complete or the lane is not pageable.
	Next *PagePosition
}

// QueryShape is the canonical identity of one provider query. Two requests may
// share a continuation chain only when every field here is equal; the
// continuation token carries its digest and a mismatch fails closed instead of
// answering a different question.
type QueryShape struct {
	WorkspaceID     string
	Dimension       string
	Fuse            []string
	Text            string
	Axes            []string
	Filters         Filters
	ImageSubjectRef string
}

// Normalize canonicalizes a query shape so two spellings of the same query
// share one digest. It never invents a field: an absent axis stays absent.
func (shape QueryShape) Normalize() (QueryShape, error) {
	filters, err := NormalizeFilters(shape.Filters)
	if err != nil {
		return shape, err
	}
	shape.WorkspaceID = strings.TrimSpace(shape.WorkspaceID)
	shape.Dimension = strings.TrimSpace(shape.Dimension)
	shape.Text = strings.TrimSpace(shape.Text)
	shape.ImageSubjectRef = strings.TrimSpace(shape.ImageSubjectRef)
	shape.Filters = filters
	shape.Axes = canonicalList(shape.Axes)
	shape.Fuse = canonicalList(shape.Fuse)
	return shape, nil
}

// Digest is the stable hex digest of the normalized query shape.
func (shape QueryShape) Digest() (string, error) {
	normalized, err := shape.Normalize()
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(struct {
		LexicalQueryPolicy string   `json:"lexical_query_policy"`
		WorkspaceID        string   `json:"workspace_id"`
		Dimension          string   `json:"dimension"`
		Fuse               []string `json:"fuse"`
		Text               string   `json:"text"`
		Axes               []string `json:"construct_axes"`
		Filters            Filters  `json:"filters"`
		ImageSubjectRef    string   `json:"image_subject_ref"`
	}{
		LexicalQueryPolicy: lexicalCJKQueryPolicy,
		WorkspaceID:        normalized.WorkspaceID,
		Dimension:          normalized.Dimension,
		Fuse:               normalized.Fuse,
		Text:               normalized.Text,
		Axes:               normalized.Axes,
		Filters:            normalized.Filters,
		ImageSubjectRef:    normalized.ImageSubjectRef,
	})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

// AuthorizationScopeDigest binds a continuation to the authorization scope the
// page was produced under. This instance is one operator's trust domain, so
// the effective scope is the workspace the page was authorized against.
func AuthorizationScopeDigest(workspaceID string) string {
	sum := sha256.Sum256([]byte("cairn-continuation-scope\x00" + strings.TrimSpace(workspaceID)))
	return hex.EncodeToString(sum[:])
}

// ContinuationBinding is what a continuation token is valid for. Minting and
// parsing both take it, and every field is compared on the way back in.
type ContinuationBinding struct {
	// Scope is AuthorizationScopeDigest of the effective workspace.
	Scope string
	// Query is the QueryShape digest of the effective query.
	Query string
	// GenerationID is the immutable index generation the chain is pinned to.
	GenerationID string
	// Lane is the pageable dimension the chain walks.
	Lane string
	// Order is the total order the chain was produced in.
	Order string
}

type continuationPayload struct {
	Version     int     `json:"v"`
	Scope       string  `json:"s"`
	Query       string  `json:"q"`
	Generation  string  `json:"g"`
	Lane        string  `json:"l"`
	Order       string  `json:"o"`
	RowID       int64   `json:"i,omitempty"`
	Rank        float64 `json:"r,omitempty"`
	HasRank     bool    `json:"hr,omitempty"`
	EntryID     string  `json:"ie,omitempty"`
	ExpiresAtNS int64   `json:"e"`
}

var (
	continuationKeyOnce sync.Once
	continuationKey     []byte
	continuationKeyErr  error
)

// continuationMACKey returns the process-local key that authenticates
// continuation tokens. It is generated once per process and never persisted:
// this adds no durable state, no cache, and no second catalog. A daemon
// restart therefore invalidates outstanding tokens, which fails closed (the
// caller restarts the chain) instead of letting a chain cross a restart into
// different process state.
func continuationMACKey() ([]byte, error) {
	continuationKeyOnce.Do(func() {
		var material [32]byte
		if _, err := rand.Read(material[:]); err != nil {
			continuationKeyErr = fmt.Errorf("generate continuation key: %w", err)
			return
		}
		continuationKey = material[:]
	})
	return continuationKey, continuationKeyErr
}

// MintContinuation returns an opaque, authenticated continuation token and its
// expiry. The token carries only the binding digests and the keyset position;
// it never carries the query text, a path, a workspace, or a filter.
func MintContinuation(binding ContinuationBinding, position PagePosition, now time.Time) (string, time.Time, error) {
	key, err := continuationMACKey()
	if err != nil {
		return "", time.Time{}, err
	}
	if err := validateBinding(binding); err != nil {
		return "", time.Time{}, err
	}
	if position.Lane != binding.Lane {
		return "", time.Time{}, fmt.Errorf("%w: position lane %q does not match binding lane %q", ErrInvalidContinuation, position.Lane, binding.Lane)
	}
	if err := validatePosition(position, binding.Order); err != nil {
		return "", time.Time{}, err
	}
	expires := now.UTC().Add(ContinuationTTL)
	payload := continuationPayload{
		Version:     continuationVersion,
		Scope:       binding.Scope,
		Query:       binding.Query,
		Generation:  binding.GenerationID,
		Lane:        binding.Lane,
		Order:       binding.Order,
		RowID:       position.RowID,
		Rank:        position.Rank,
		HasRank:     position.HasRank,
		EntryID:     position.EntryID,
		ExpiresAtNS: expires.UnixNano(),
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", time.Time{}, err
	}
	mac := hmac.New(sha256.New, key)
	mac.Write(encoded)
	token := base64.RawURLEncoding.EncodeToString(encoded) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return token, expires, nil
}

// ParseContinuation validates an opaque token against the live request and
// returns the position it authorizes. It fails closed: a malformed, tampered,
// expired, or out-of-scope token is refused as invalid input, never answered
// with a page from another query, generation, or authorization scope.
func ParseContinuation(token string, binding ContinuationBinding, now time.Time) (PagePosition, error) {
	var position PagePosition
	key, err := continuationMACKey()
	if err != nil {
		return position, err
	}
	if err := validateBinding(binding); err != nil {
		return position, err
	}
	raw := strings.TrimSpace(token)
	if raw == "" {
		return position, fmt.Errorf("%w: continuation token is empty", ErrInvalidContinuation)
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return position, fmt.Errorf("%w: continuation token is malformed", ErrInvalidContinuation)
	}
	encoded, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return position, fmt.Errorf("%w: continuation token is malformed", ErrInvalidContinuation)
	}
	providedMAC, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return position, fmt.Errorf("%w: continuation token is malformed", ErrInvalidContinuation)
	}
	mac := hmac.New(sha256.New, key)
	mac.Write(encoded)
	if !hmac.Equal(mac.Sum(nil), providedMAC) {
		return position, fmt.Errorf("%w: continuation token failed authentication", ErrInvalidContinuation)
	}
	var payload continuationPayload
	if err := json.Unmarshal(encoded, &payload); err != nil {
		return position, fmt.Errorf("%w: continuation token is malformed", ErrInvalidContinuation)
	}
	if payload.Version != continuationVersion {
		return position, fmt.Errorf("%w: continuation token version %d is not supported", ErrInvalidContinuation, payload.Version)
	}
	if payload.ExpiresAtNS <= 0 {
		return position, fmt.Errorf("%w: continuation token has no expiry", ErrInvalidContinuation)
	}
	if !now.UTC().Before(time.Unix(0, payload.ExpiresAtNS).UTC()) {
		return position, fmt.Errorf("%w: continuation token expired", ErrStaleContinuation)
	}
	if payload.Scope != binding.Scope {
		return position, fmt.Errorf("%w: continuation token authorization scope does not match this request", ErrStaleContinuation)
	}
	if payload.Query != binding.Query {
		return position, fmt.Errorf("%w: continuation token belongs to a different query", ErrStaleContinuation)
	}
	if payload.Generation != binding.GenerationID {
		return position, fmt.Errorf("%w: continuation token belongs to index generation %q, not the resolved generation %q", ErrStaleContinuation, payload.Generation, binding.GenerationID)
	}
	if payload.Lane != binding.Lane || payload.Order != binding.Order {
		return position, fmt.Errorf("%w: continuation token order does not match this request", ErrStaleContinuation)
	}
	position = PagePosition{Lane: payload.Lane, RowID: payload.RowID, Rank: payload.Rank, HasRank: payload.HasRank, EntryID: payload.EntryID}
	if err := validatePosition(position, binding.Order); err != nil {
		return position, err
	}
	return position, nil
}

func validateBinding(binding ContinuationBinding) error {
	if strings.TrimSpace(binding.Scope) == "" {
		return fmt.Errorf("%w: authorization scope is required", ErrInvalidContinuation)
	}
	if strings.TrimSpace(binding.Query) == "" {
		return fmt.Errorf("%w: query digest is required", ErrInvalidContinuation)
	}
	if strings.TrimSpace(binding.GenerationID) == "" {
		return fmt.Errorf("%w: index generation is required", ErrInvalidContinuation)
	}
	if strings.TrimSpace(binding.Lane) == "" {
		return fmt.Errorf("%w: lane is required", ErrInvalidContinuation)
	}
	switch binding.Order {
	case OrderRankRowID, OrderRowID, OrderEntryPathID, OrderDescriptionSubjectRevisionID, OrderSavedViewLexical:
	default:
		return fmt.Errorf("%w: order %q is not a declared total order", ErrInvalidContinuation, binding.Order)
	}
	return nil
}

func validatePosition(position PagePosition, order string) error {
	switch position.Lane {
	case "", DimensionLexical:
	case LaneContentList:
		// A content-list position is an entry identity, not an index
		// coordinate: it must name the entry the chain resumes after and must
		// not carry a row id or a rank that a caller could read as an offset.
		if strings.TrimSpace(position.EntryID) == "" {
			return fmt.Errorf("%w: content-list position carries no entry id", ErrInvalidContinuation)
		}
		if position.RowID != 0 || position.HasRank {
			return fmt.Errorf("%w: content-list position carries an index coordinate", ErrInvalidContinuation)
		}
		if order != OrderEntryPathID {
			return fmt.Errorf("%w: content-list position is not in the content-list order", ErrInvalidContinuation)
		}
		return nil
	case LaneDescriptionList:
		if strings.TrimSpace(position.EntryID) == "" {
			return fmt.Errorf("%w: description-list position carries no resume key", ErrInvalidContinuation)
		}
		if position.RowID != 0 || position.Rank != 0 || position.HasRank || order != OrderDescriptionSubjectRevisionID {
			return fmt.Errorf("%w: description-list position does not match its declared order", ErrInvalidContinuation)
		}
		return nil
	case LaneSavedView:
		if position.EntryID == "" {
			return fmt.Errorf("%w: saved-view position carries no projection ordinal", ErrInvalidContinuation)
		}
		if position.RowID != 0 || position.Rank != 0 || position.HasRank || order != OrderSavedViewLexical {
			return fmt.Errorf("%w: saved-view position does not match its declared order", ErrInvalidContinuation)
		}
		ordinal, err := strconv.ParseUint(position.EntryID, 10, 63)
		if err != nil || strconv.FormatUint(ordinal, 10) != position.EntryID {
			return fmt.Errorf("%w: saved-view projection ordinal is invalid", ErrInvalidContinuation)
		}
		return nil
	default:
		return fmt.Errorf("%w: position lane %q is not pageable", ErrInvalidContinuation, position.Lane)
	}
	if position.Lane == LaneContentList || position.Lane == LaneDescriptionList || position.Lane == LaneSavedView || order == OrderEntryPathID || order == OrderDescriptionSubjectRevisionID || order == OrderSavedViewLexical {
		return fmt.Errorf("%w: position does not match its declared lane", ErrInvalidContinuation)
	}
	if position.RowID < 0 {
		return fmt.Errorf("%w: position row id is invalid", ErrInvalidContinuation)
	}
	switch order {
	case OrderRankRowID:
		if !position.HasRank {
			return fmt.Errorf("%w: position has no rank for a rank-ordered page", ErrInvalidContinuation)
		}
		if math.IsNaN(position.Rank) || math.IsInf(position.Rank, 0) {
			return fmt.Errorf("%w: position rank is not finite", ErrInvalidContinuation)
		}
	case OrderRowID:
		if position.HasRank {
			return fmt.Errorf("%w: position carries a rank for a rowid-ordered page", ErrInvalidContinuation)
		}
	default:
		return fmt.Errorf("%w: order %q is not a declared total order", ErrInvalidContinuation, order)
	}
	return nil
}

// ResolvePageSize turns a caller-supplied page size into the bounded size one
// page will use. It refuses an out-of-range value instead of silently clamping
// it, so a caller always knows the bound that was actually applied.
func ResolvePageSize(requested int) (int, error) {
	if requested < 0 {
		return 0, fmt.Errorf("%w: page_size cannot be negative", ErrInvalidQuery)
	}
	if requested == 0 {
		return DefaultPageSize, nil
	}
	if requested > MaxPageSize {
		return 0, fmt.Errorf("%w: page_size %d exceeds the maximum %d", ErrInvalidQuery, requested, MaxPageSize)
	}
	return requested, nil
}

// LexicalOrder names the total order a lexical query will be produced in. It
// is derived from the same tokenizer the query uses, so a caller binding a
// continuation to it can never disagree with the engine about which order the
// page is in.
func LexicalOrder(text string) string {
	if len(queryTokens(text)) > 0 {
		return OrderRankRowID
	}
	return OrderRowID
}

func canonicalList(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, duplicate := seen[trimmed]; duplicate {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	if len(out) == 0 {
		return nil
	}
	sort.Strings(out)
	return out
}
