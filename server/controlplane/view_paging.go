package controlplane

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

var errSavedViewProjectionChanged = errors.New("saved view projection changed while evaluating; retry")

type savedViewProjection struct {
	GenerationID  string
	ProjectionRef string
	Entries       int
	Window        []command.SearchHitData
	CanonicalIDs  map[string]struct{}
}

type savedViewPagingDefinition struct {
	Version          string   `json:"version"`
	LexicalPolicyRef string   `json:"lexical_query_policy_digest"`
	ViewID           string   `json:"view_id"`
	Revision         int64    `json:"revision"`
	Name             string   `json:"name"`
	Query            string   `json:"query"`
	Fields           []string `json:"fields"`
	WorkspaceID      string   `json:"workspace_id"`
	Scope            string   `json:"scope"`
	Sort             string   `json:"sort"`
	OutputNames      string   `json:"output_names"`
	Required         []string `json:"required_capabilities"`
	WhenMissing      string   `json:"when_missing"`
	TagFactsRef      string   `json:"tag_facts_ref"`
	Projection       string   `json:"projection_ref"`
	Generation       string   `json:"index_generation_ref"`
	Lane             string   `json:"lane"`
	Order            string   `json:"order"`
}

type savedViewTagSnapshot struct {
	ref       string
	bySubject map[string]map[string]struct{}
}

func (d *Dispatcher) evaluateViewPage(
	ctx context.Context,
	view sqlite.SavedView,
	requestedScope string,
	pageInput command.ViewEvaluatePageInput,
) (command.ViewEvaluateData, error) {
	var empty command.ViewEvaluateData
	if err := validateSupportedSavedViewPolicy(view); err != nil {
		return empty, err
	}
	if d.search == nil || d.store == nil {
		return empty, fmt.Errorf("search index is unavailable")
	}
	if strings.TrimSpace(requestedScope) != "" {
		workspaceID := d.viewEvaluationWorkspace(ctx, view.Scope)
		if requestedScope != workspaceID {
			return empty, fmt.Errorf("%w: paged saved-view scope is determined by the stored view", search.ErrInvalidQuery)
		}
	}
	conditions, err := viewFiltersFromFields(view.Fields)
	if err != nil {
		return empty, err
	}
	if strings.TrimSpace(view.Query) == "" && !conditions.Filters.Has() && len(conditions.Tags) == 0 {
		return empty, fmt.Errorf("%w: view query is empty and carries no structured filters", search.ErrInvalidQuery)
	}
	workspaceID := d.viewEvaluationWorkspace(ctx, view.Scope)
	if workspaceID == "" {
		return empty, errString("saved view workspace is unavailable")
	}
	limit := search.DefaultPageSize
	if pageInput.Limit != nil {
		limit = *pageInput.Limit
	}
	if limit < 1 || limit > search.MaxPageSize {
		return empty, fmt.Errorf("%w: page.limit must be between 1 and %d", search.ErrInvalidQuery, search.MaxPageSize)
	}
	token := strings.TrimSpace(pageInput.Token)
	if pageInput.Token != "" && token == "" {
		return empty, fmt.Errorf("%w: page.token must not be blank", search.ErrInvalidQuery)
	}
	dimension, ok := search.LookupDimension(search.DimensionLexical, search.IndexerReadiness(d.search))
	if !ok || dimension.State != command.CapabilityAvailable {
		return empty, errString("lexical search is unavailable")
	}
	generation, err := d.store.LatestIndexGeneration(ctx, workspaceID, search.DimensionLexical)
	if err != nil {
		return empty, fmt.Errorf("saved view lexical generation is unavailable: %w", err)
	}
	if generation.ID == "" || generation.WorkspaceID != workspaceID || generation.Dimension != "" && generation.Dimension != search.DimensionLexical {
		return empty, errString("saved view lexical generation binding is unavailable")
	}
	tags, err := d.savedViewTagSnapshot(ctx, workspaceID, conditions.Tags)
	if err != nil {
		return empty, err
	}
	windowStart := 0
	if token != "" {
		windowStart = -1
	}
	projection, err := d.scanSavedViewProjection(ctx, view, workspaceID, generation.ID, conditions, tags.bySubject, windowStart, limit)
	if err != nil {
		return empty, err
	}
	if err := d.verifySavedViewPagingInputs(ctx, view, workspaceID, generation.ID, conditions.Tags, tags.ref); err != nil {
		if token != "" {
			return empty, search.ErrStaleContinuation
		}
		return empty, errSavedViewProjectionChanged
	}
	binding, err := savedViewContinuationBinding(view, workspaceID, generation.ID, conditions, tags.ref, projection.ProjectionRef)
	if err != nil {
		return empty, err
	}
	start := 0
	if token != "" {
		position, parseErr := search.ParseContinuation(token, binding, d.now())
		if parseErr != nil {
			return empty, parseErr
		}
		ordinal, parseErr := strconv.ParseInt(position.EntryID, 10, 64)
		if parseErr != nil || ordinal < 0 || ordinal >= int64(projection.Entries) {
			return empty, fmt.Errorf("%w: saved-view ordinal is outside the current projection", search.ErrStaleContinuation)
		}
		start = int(ordinal)
		second, scanErr := d.scanSavedViewProjection(ctx, view, workspaceID, generation.ID, conditions, tags.bySubject, start, limit)
		if scanErr != nil {
			return empty, scanErr
		}
		if second.GenerationID != projection.GenerationID || second.ProjectionRef != projection.ProjectionRef || second.Entries != projection.Entries || !sameStringSet(second.CanonicalIDs, projection.CanonicalIDs) {
			return empty, search.ErrStaleContinuation
		}
		projection = second
		if err := d.verifySavedViewPagingInputs(ctx, view, workspaceID, generation.ID, conditions.Tags, tags.ref); err != nil {
			return empty, search.ErrStaleContinuation
		}
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	if start+len(projection.Window) > projection.Entries {
		return empty, search.ErrStaleContinuation
	}
	hasMore := start+len(projection.Window) < projection.Entries
	pageData := &command.PageData{
		Mode: command.PageModePage, Limit: limit, Returned: len(projection.Window),
		Completeness: completenessOf(!hasMore, hasMore), Complete: !hasMore, HasMore: hasMore,
		Lane: search.LaneSavedView, Order: search.OrderSavedViewLexical,
		ContinuationSupported: true,
	}
	pageData.Entries = &projection.Entries
	if hasMore {
		position := search.PagePosition{Lane: search.LaneSavedView, EntryID: strconv.Itoa(start + len(projection.Window))}
		pageData.Token, pageData.ExpiresAt, err = mintSavedViewContinuation(binding, position, d.now())
		if err != nil {
			return empty, err
		}
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return command.ViewEvaluateData{
		ViewID: view.ViewID, ViewRevision: view.Revision, Query: view.Query,
		WorkspaceID: workspaceID, IndexGenerationRef: generation.ID,
		ProjectionRef: projection.ProjectionRef, Hits: projection.Window,
		Coverage: []string{search.DimensionLexical}, Page: pageData,
	}, nil
}

func (d *Dispatcher) scanSavedViewProjection(
	ctx context.Context,
	view sqlite.SavedView,
	workspaceID, generationID string,
	conditions parsedViewConditions,
	tagsBySubject map[string]map[string]struct{},
	windowStart, windowLimit int,
) (savedViewProjection, error) {
	result := savedViewProjection{GenerationID: generationID, Window: make([]command.SearchHitData, 0, max(0, windowLimit)), CanonicalIDs: make(map[string]struct{})}
	hash := sha256.New()
	_, _ = hash.Write([]byte("cairn-saved-view-result-projection-v1\x00"))
	var position *search.PagePosition
	seenPositions := make(map[search.PagePosition]struct{})
	pageSize := search.DefaultPageSize
	var expectedOrder string
	for {
		if err := ctx.Err(); err != nil {
			return savedViewProjection{}, err
		}
		var page search.QueryPageResult
		var err error
		request := search.PageRequest{Limit: pageSize, Position: position}
		if strings.TrimSpace(view.Query) == "" && !conditions.Filters.Has() {
			page, err = d.search.QueryLexicalAllPage(ctx, workspaceID, generationID, request)
		} else {
			page, err = d.search.QueryPage(ctx, search.QueryRequest{
				WorkspaceID: workspaceID, GenerationID: generationID,
				Dimension: search.DimensionLexical, Text: view.Query, Filters: conditions.Filters, Page: request,
			})
		}
		if err != nil {
			return savedViewProjection{}, err
		}
		if page.Generation.ID != generationID || page.Generation.WorkspaceID != workspaceID ||
			(page.Generation.Dimension != "" && page.Generation.Dimension != search.DimensionLexical) ||
			page.Page.Lane != search.DimensionLexical || page.Page.Returned != len(page.Hits) || page.Page.Truncated ||
			page.Page.Order != search.OrderRowID && page.Page.Order != search.OrderRankRowID {
			return savedViewProjection{}, errString("saved view lexical page cannot prove its pinned total order")
		}
		if expectedOrder == "" {
			expectedOrder = page.Page.Order
		} else if expectedOrder != page.Page.Order {
			return savedViewProjection{}, errString("saved view lexical pages changed order")
		}
		if err := ctx.Err(); err != nil {
			return savedViewProjection{}, err
		}
		authorized, _ := d.authorizePagedHitsWithCanonicalSubjects(ctx, workspaceID, page.Generation.WorkspaceID, page.Hits, nil)
		if err := ctx.Err(); err != nil {
			return savedViewProjection{}, err
		}
		for _, hit := range authorized {
			if hit.SubjectRef == "" {
				continue
			}
			if _, duplicate := result.CanonicalIDs[hit.SubjectRef]; duplicate {
				continue
			}
			result.CanonicalIDs[hit.SubjectRef] = struct{}{}
			matched := true
			subjectTags := tagsBySubject[hit.SubjectRef]
			for _, wanted := range conditions.Tags {
				if _, ok := subjectTags[wanted]; !ok {
					matched = false
					break
				}
			}
			if !matched {
				continue
			}
			encoded, err := json.Marshal(hit)
			if err != nil {
				return savedViewProjection{}, fmt.Errorf("fingerprint saved-view hit: %w", err)
			}
			var size [8]byte
			binary.BigEndian.PutUint64(size[:], uint64(len(encoded)))
			_, _ = hash.Write(size[:])
			_, _ = hash.Write(encoded)
			ordinal := result.Entries
			result.Entries++
			if windowStart >= 0 && ordinal >= windowStart && ordinal < windowStart+windowLimit {
				result.Window = append(result.Window, hit)
			}
		}
		if err := ctx.Err(); err != nil {
			return savedViewProjection{}, err
		}
		if page.Page.HasMore == page.Page.Complete {
			return savedViewProjection{}, errString("saved view lexical page has inconsistent completeness")
		}
		if !page.Page.HasMore {
			if !page.Page.Complete {
				return savedViewProjection{}, errString("saved view lexical page did not prove projection exhaustion")
			}
			break
		}
		if page.Page.Next == nil || len(page.Hits) == 0 {
			return savedViewProjection{}, errString("saved view lexical continuation did not progress")
		}
		next := *page.Page.Next
		if next.Lane != search.DimensionLexical || next.RowID < 0 ||
			(page.Page.Order == search.OrderRankRowID && !next.HasRank) ||
			(page.Page.Order == search.OrderRowID && next.HasRank) {
			return savedViewProjection{}, errString("saved view lexical continuation does not match its total order")
		}
		if position != nil && next == *position {
			return savedViewProjection{}, errString("saved view lexical continuation did not progress")
		}
		if _, duplicate := seenPositions[next]; duplicate {
			return savedViewProjection{}, errString("saved view lexical continuation repeated")
		}
		seenPositions[next] = struct{}{}
		position = &next
	}
	sum := hash.Sum(nil)
	result.ProjectionRef = "sha256:" + hex.EncodeToString(sum)
	return result, nil
}

func (d *Dispatcher) savedViewTagSnapshot(ctx context.Context, workspaceID string, tags []string) (savedViewTagSnapshot, error) {
	if len(tags) == 0 {
		sum := sha256.Sum256([]byte("cairn-saved-view-tag-facts-v1\x00"))
		return savedViewTagSnapshot{ref: "sha256:" + hex.EncodeToString(sum[:]), bySubject: map[string]map[string]struct{}{}}, nil
	}
	facts, err := d.store.ListSavedViewTagFacts(ctx, workspaceID, tags)
	if err != nil {
		return savedViewTagSnapshot{}, err
	}
	encoded, err := json.Marshal(facts)
	if err != nil {
		return savedViewTagSnapshot{}, err
	}
	sum := sha256.Sum256(append([]byte("cairn-saved-view-tag-facts-v1\x00"), encoded...))
	snapshot := savedViewTagSnapshot{ref: "sha256:" + hex.EncodeToString(sum[:]), bySubject: make(map[string]map[string]struct{})}
	for _, fact := range facts {
		values := snapshot.bySubject[fact.SubjectRef]
		if values == nil {
			values = make(map[string]struct{})
			snapshot.bySubject[fact.SubjectRef] = values
		}
		values[fact.Body] = struct{}{}
	}
	return snapshot, nil
}

func (d *Dispatcher) verifySavedViewPagingInputs(ctx context.Context, original sqlite.SavedView, workspaceID, generationID string, tags []string, tagFactsRef string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	current, err := d.store.GetSavedViewByID(ctx, original.ViewID)
	if err != nil || !reflect.DeepEqual(current, original) || d.viewEvaluationWorkspace(ctx, current.Scope) != workspaceID {
		return errSavedViewProjectionChanged
	}
	generation, err := d.store.LatestIndexGeneration(ctx, workspaceID, search.DimensionLexical)
	if err != nil || generation.ID != generationID {
		return errSavedViewProjectionChanged
	}
	currentTags, err := d.savedViewTagSnapshot(ctx, workspaceID, tags)
	if err != nil {
		return err
	}
	if currentTags.ref != tagFactsRef {
		return errSavedViewProjectionChanged
	}
	return ctx.Err()
}

func savedViewContinuationBinding(view sqlite.SavedView, workspaceID, generationID string, conditions parsedViewConditions, tagFactsRef, projectionRef string) (search.ContinuationBinding, error) {
	lexicalPolicyRef, err := (search.QueryShape{
		WorkspaceID: workspaceID,
		Dimension:   search.DimensionLexical,
		Text:        view.Query,
		Filters:     conditions.Filters,
	}).Digest()
	if err != nil {
		return search.ContinuationBinding{}, err
	}
	definition := savedViewPagingDefinition{
		Version: "saved-view-lexical-v1", LexicalPolicyRef: lexicalPolicyRef, ViewID: view.ViewID, Revision: view.Revision,
		Name: view.Name, Query: view.Query, Fields: view.Fields, WorkspaceID: workspaceID,
		Scope: view.Scope, Sort: view.Sort, OutputNames: view.OutputNames,
		Required: view.Required, WhenMissing: view.WhenMissing, TagFactsRef: tagFactsRef,
		Projection: projectionRef, Generation: generationID,
		Lane: search.LaneSavedView, Order: search.OrderSavedViewLexical,
	}
	encoded, err := json.Marshal(definition)
	if err != nil {
		return search.ContinuationBinding{}, err
	}
	sum := sha256.Sum256(encoded)
	return search.ContinuationBinding{
		Scope: search.AuthorizationScopeDigest(workspaceID), Query: hex.EncodeToString(sum[:]),
		GenerationID: generationID, Lane: search.LaneSavedView, Order: search.OrderSavedViewLexical,
	}, nil
}

func mintSavedViewContinuation(binding search.ContinuationBinding, position search.PagePosition, now time.Time) (string, string, error) {
	token, expires, err := search.MintContinuation(binding, position, now)
	if err != nil {
		return "", "", err
	}
	return token, expires.UTC().Format(time.RFC3339), nil
}

func sameStringSet(left, right map[string]struct{}) bool {
	if len(left) != len(right) {
		return false
	}
	for value := range left {
		if _, ok := right[value]; !ok {
			return false
		}
	}
	return true
}
