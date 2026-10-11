package controlplane

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// Bounded discovery paging.
//
// Exactly one discovery lane is complete and pageable: the lexical generation.
// Its match set is materializable and its order is total, so a caller can walk
// it to exhaustion in bounded pages without loss or duplication. Every other
// lane (semantic, multimodal, acoustic, graph, token) answers with a bounded
// top-k candidate set that has no seekable order, so its completeness cannot
// be claimed and it never issues a continuation.
//
// Every search.query and content.list answer therefore carries an explicit
// page block stating which mode it was produced in, how it was bounded, and
// which of the three completeness states it is in: COMPLETE (this is
// everything), MORE_AVAILABLE (more exists, and this answer says how to get
// it), or BOUNDED_UNKNOWN (the lane cannot tell you whether more exists).
// Collapsing those last two would be the dishonest case, so they stay separate
// facts rather than one ambiguous count.

// pageInput is the canonical bounded-paging input shared by search.query and
// content.list. It carries one explicit bound and one opaque continuation
// token, and nothing else: a token is never a place to send a query, a path, a
// workspace, or a filter.
type pageInput struct {
	// Limit is the requested page size. It is refused outside 1..MaxPageSize
	// rather than silently clamped.
	Limit *int `json:"limit,omitempty"`
	// Token is the opaque continuation a previous answer issued.
	Token string `json:"token,omitempty"`
}

// searchPageRequest is the resolved form of pageInput.
type searchPageRequest struct {
	// Mode is the request shape the caller asked for.
	Mode string
	// Limit is the bounded size one page will use.
	Limit int
	// Token is the opaque continuation the caller supplied, if any.
	Token string
}

// resolvePageInput turns the optional page_size/cursor input into the page the
// daemon will execute.
//
// An absent page_size and cursor keeps the caller in default mode with
// defaultLimit applied (0 means "no bound": the answer carries the whole
// projection and reports its exact total). A caller that asks for a page gets
// one; there is no path where the daemon silently picks a different bound than
// the one it reports.
func resolvePageInput(page *pageInput, defaultLimit int) (searchPageRequest, error) {
	if page == nil {
		return searchPageRequest{Mode: command.PageModeDefault, Limit: defaultLimit}, nil
	}
	trimmedToken := strings.TrimSpace(page.Token)
	if page.Limit == nil && trimmedToken == "" {
		return searchPageRequest{Mode: command.PageModeDefault, Limit: defaultLimit}, nil
	}
	limit := search.DefaultPageSize
	if page.Limit != nil {
		if *page.Limit < 1 {
			return searchPageRequest{}, errString("page.limit must be at least 1")
		}
		resolved, err := search.ResolvePageSize(*page.Limit)
		if err != nil {
			return searchPageRequest{}, err
		}
		limit = resolved
	}
	return searchPageRequest{Mode: command.PageModePage, Limit: limit, Token: trimmedToken}, nil
}

// completenessOf is the single place the explicit three-state answer is
// derived, so no caller can receive one state's fields under another's name.
func completenessOf(complete, hasMore bool) string {
	switch {
	case complete:
		return command.PageCompletenessComplete
	case hasMore:
		return command.PageCompletenessMoreAvailable
	default:
		return command.PageCompletenessBoundedUnknown
	}
}

// lexicalPageData projects one pageable lexical lane answer. A pageable answer
// is never "truncated": when more matches exist it says so and hands back the
// continuation that reaches them.
func lexicalPageData(mode string, limit int, state search.PageState, returned int) *command.PageData {
	facts := &command.PageData{
		Mode:                  mode,
		Limit:                 limit,
		Returned:              returned,
		Lane:                  search.DimensionLexical,
		Order:                 state.Order,
		Complete:              state.Complete,
		HasMore:               state.HasMore,
		ContinuationSupported: true,
	}
	facts.Completeness = completenessOf(state.Complete, state.HasMore)
	return facts
}

// attachLexicalContinuation mints the continuation for a lexical page that
// proved more matches exist. The token is bound to the exact generation,
// query, order, and authorization scope, so it cannot be replayed against
// another query or continued into a replacement index.
func (d *Dispatcher) attachLexicalContinuation(facts *command.PageData, binding search.ContinuationBinding, next *search.PagePosition) error {
	if facts == nil || !facts.HasMore || next == nil {
		return nil
	}
	cursor, expires, err := search.MintContinuation(binding, *next, d.now())
	if err != nil {
		return err
	}
	facts.Token = cursor
	facts.ExpiresAt = expires.UTC().Format(time.RFC3339)
	return nil
}

// boundedSearchPageData projects one answer from a lane that is a bounded
// top-k set. Completeness is never claimed and no continuation is offered.
func boundedSearchPageData(mode string, limit int, lane, status string, returned, boundedTopK int) *command.PageData {
	facts := &command.PageData{
		Mode:                  mode,
		Returned:              returned,
		Lane:                  lane,
		Complete:              false,
		HasMore:               false,
		Truncated:             true,
		ContinuationSupported: false,
		ContinuationReason:    command.PageContinuationBoundedLane,
		Completeness:          command.PageCompletenessBoundedUnknown,
	}
	if status == string(command.StatusSucceeded) {
		facts.Limit = limit
		facts.TruncationReason = command.PageTruncationBoundedTopK
	} else {
		// A lane that did not answer omitted every match it would have found.
		// That is its own visible state and never a silent zero.
		facts.TruncationReason = command.PageTruncationUnansweredLane
	}
	if boundedTopK > 0 {
		facts.Limit = limit
	}
	return facts
}

// resolveLexicalConstraint refuses a continuation on a request shape that has
// no complete match set to resume, instead of ignoring it or answering a
// different question than the caller asked.
func resolveLexicalConstraint(pageable bool, lane, reason, cursor string) error {
	if strings.TrimSpace(cursor) == "" || pageable {
		return nil
	}
	message := "cursor is not valid for this query shape"
	if trimmed := strings.TrimSpace(reason); trimmed != "" {
		message += ": " + trimmed
	}
	if trimmed := strings.TrimSpace(lane); trimmed != "" {
		message += " (lane " + trimmed + ")"
	}
	return errString(message)
}

// fusedSearchPageData aggregates a fused answer's per-lane completeness into
// one answer the caller cannot misread. A fused union is only complete when
// every declared lane is complete; when any lane is a bounded top-k set the
// union is inherently partial and says so, and it never offers a continuation
// because there is no one order over the union to resume.
func fusedSearchPageData(mode string, lexicalLimit int, components []search.Component, returned int) *command.PageData {
	facts := &command.PageData{
		Mode:                  mode,
		Returned:              returned,
		ContinuationSupported: false,
		ContinuationReason:    command.PageContinuationFusedUnion,
	}
	complete := true
	hasMore := false
	boundedLane := false
	unansweredLane := false
	lanes := make([]command.PageLaneData, 0, len(components))
	for _, component := range components {
		lane := command.PageLaneData{
			Dimension: component.Dimension,
			Status:    component.Status,
			Returned:  component.Hits,
			Pageable:  component.Dimension == search.DimensionLexical,
		}
		switch {
		case component.Status == search.ComponentSkipped:
			// The lane was correctly not asked anything: it carries no
			// omission, so its silence is not incompleteness.
			lane.Complete = true
		case component.Status == string(command.StatusSucceeded) && component.Dimension == search.DimensionLexical:
			lane.Limit = lexicalLimit
			lane.Complete = component.Page.Complete
			lane.HasMore = component.Page.HasMore
		case component.Status == string(command.StatusSucceeded):
			// A bounded top-k lane: it ranks a candidate set and cannot prove
			// it saw every match.
			lane.BoundedTopK = component.Page.BoundedTopK
			lane.Truncated = true
			boundedLane = true
		default:
			lane.Truncated = true
			unansweredLane = true
		}
		complete = complete && lane.Complete
		hasMore = hasMore || lane.HasMore
		lanes = append(lanes, lane)
	}
	facts.Lanes = lanes
	facts.Complete = complete
	facts.HasMore = hasMore
	facts.Completeness = completenessOf(complete, hasMore)
	switch {
	case boundedLane:
		facts.Truncated = true
		facts.TruncationReason = command.PageTruncationBoundedTopK
	case unansweredLane:
		facts.Truncated = true
		facts.TruncationReason = command.PageTruncationUnansweredLane
	}
	return facts
}

// contentListPageData projects the content-library projection's bounding
// state. The total entry count is always reported: a caller that asks for the
// complete projection is told "complete: true, entries: N", and a caller that
// asks for a page is told the same N alongside whether more exist.
func contentListPageData(mode string, pageSize, returned, total int, hasMore, complete bool) *command.PageData {
	count := total
	return &command.PageData{
		Mode:                  mode,
		Limit:                 pageSize,
		Returned:              returned,
		Entries:               &count,
		Order:                 search.OrderEntryPathID,
		Complete:              complete,
		HasMore:               hasMore,
		Completeness:          completenessOf(complete, hasMore),
		ContinuationSupported: true,
	}
}

// contentListRoot is the immutable identity of one published source root in
// the projection a content.list chain is pinned to.
type contentListRoot struct {
	RootID           string
	ScanGenerationID string
	SnapshotRef      string
}

// contentListRoots reduces the latest published roots to their immutable
// identity, ordered by root id so two identical publication sets always digest
// the same.
func contentListRoots(roots []sqlite.NamespaceRoot) []contentListRoot {
	projected := make([]contentListRoot, 0, len(roots))
	for _, root := range roots {
		projected = append(projected, contentListRoot{
			RootID:           root.ID,
			ScanGenerationID: root.ScanGenerationID,
			SnapshotRef:      root.SnapshotRef,
		})
	}
	sort.Slice(projected, func(i, j int) bool { return projected[i].RootID < projected[j].RootID })
	return projected
}

// contentListPublicationDigest is the immutable identity of the published
// projection one content.list chain is pinned to. Replacing any source root
// changes it, so every outstanding cursor fails closed instead of crossing the
// change and silently skipping or repeating an entry.
func contentListPublicationDigest(workspaceID string, roots []sqlite.NamespaceRoot) string {
	var payload strings.Builder
	payload.WriteString("cairn-content-list-publication\x00")
	payload.WriteString(strings.TrimSpace(workspaceID))
	for _, root := range contentListRoots(roots) {
		payload.WriteString("\x00")
		payload.WriteString(root.RootID)
		payload.WriteString("\x00")
		payload.WriteString(root.ScanGenerationID)
		payload.WriteString("\x00")
		payload.WriteString(root.SnapshotRef)
	}
	sum := sha256.Sum256([]byte(payload.String()))
	return hex.EncodeToString(sum[:])
}

// contentListBinding is the continuation scope of one content.list chain.
func contentListBinding(workspaceID, publicationDigest string) search.ContinuationBinding {
	return search.ContinuationBinding{
		Scope:        search.AuthorizationScopeDigest(workspaceID),
		Query:        publicationDigest,
		GenerationID: publicationDigest,
		Lane:         search.LaneContentList,
		Order:        search.OrderEntryPathID,
	}
}

// resolveContentListCursor validates a content.list continuation against the
// exact latest publication set and returns the entry id the chain resumes
// after. A malformed, tampered, expired, or publication-crossing cursor is
// refused as invalid input rather than seeked.
func (d *Dispatcher) resolveContentListCursor(workspaceID, publicationDigest, cursor string) (string, error) {
	trimmed := strings.TrimSpace(cursor)
	if trimmed == "" {
		return "", nil
	}
	position, err := search.ParseContinuation(trimmed, contentListBinding(workspaceID, publicationDigest), d.now())
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(position.EntryID) == "" {
		return "", fmt.Errorf("%w: continuation token carries no resume entry", search.ErrInvalidContinuation)
	}
	return position.EntryID, nil
}

// mintContentListCursor issues the continuation for a content.list page that
// proved more entries exist. The position is the stable namespace entry id the
// page stopped at: resuming re-finds that exact id in the same ordered
// projection, so a stale cursor fails closed instead of seeking a shifted
// offset.
func (d *Dispatcher) mintContentListCursor(workspaceID, publicationDigest, entryID string) (string, string, error) {
	if strings.TrimSpace(entryID) == "" {
		return "", "", fmt.Errorf("%w: content.list page has no resume entry", search.ErrInvalidContinuation)
	}
	cursor, expires, err := search.MintContinuation(
		contentListBinding(workspaceID, publicationDigest),
		search.PagePosition{Lane: search.LaneContentList, EntryID: entryID},
		d.now(),
	)
	if err != nil {
		return "", "", err
	}
	return cursor, expires.UTC().Format(time.RFC3339), nil
}
