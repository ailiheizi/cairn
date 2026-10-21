package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

type preparedSavedViewEvaluation struct {
	conditions  parsedViewConditions
	workspaceID string
}

// prepareSavedViewEvaluation performs the shared policy, lexical-readiness,
// condition, empty-query, and workspace checks in their established order.
func (d *Dispatcher) prepareSavedViewEvaluation(ctx context.Context, view sqlite.SavedView) (preparedSavedViewEvaluation, error) {
	if err := validateSupportedSavedViewPolicy(view); err != nil {
		return preparedSavedViewEvaluation{}, err
	}
	if d.search == nil {
		return preparedSavedViewEvaluation{}, errString("search index is unavailable")
	}
	dimension, ok := search.LookupDimension(search.DimensionLexical, search.IndexerReadiness(d.search))
	if !ok || dimension.State != command.CapabilityAvailable {
		return preparedSavedViewEvaluation{}, errString("lexical search is unavailable")
	}
	conditions, err := viewFiltersFromFields(view.Fields)
	if err != nil {
		return preparedSavedViewEvaluation{}, err
	}
	if strings.TrimSpace(view.Query) == "" && !conditions.Filters.Has() && len(conditions.Tags) == 0 {
		return preparedSavedViewEvaluation{}, errString("view query is empty and carries no structured filters")
	}
	workspaceID := d.viewEvaluationWorkspace(ctx, view.Scope)
	if workspaceID == "" {
		return preparedSavedViewEvaluation{}, errString("saved view workspace is unavailable")
	}
	return preparedSavedViewEvaluation{conditions: conditions, workspaceID: workspaceID}, nil
}

// evaluateViewNow runs a dynamic view query through the lexical search lane.
// Membership is intentionally dynamic: evaluating twice may differ. When the
// exact lane or its index is unavailable it fails closed instead of
// fabricating hits.
func (d *Dispatcher) evaluateViewNow(ctx context.Context, view sqlite.SavedView, limit int) ([]command.SearchHitData, error) {
	prepared, err := d.prepareSavedViewEvaluation(ctx, view)
	if err != nil {
		return nil, err
	}
	conditions, workspaceID := prepared.conditions, prepared.workspaceID
	if len(conditions.Tags) == 0 {
		generation, hits, err := d.search.Query(ctx, search.QueryRequest{
			WorkspaceID: workspaceID, Dimension: search.DimensionLexical,
			Text: view.Query, Axes: nil, Filters: conditions.Filters,
		})
		if err != nil {
			return nil, err
		}
		authorized := d.authorizeHits(ctx, workspaceID, generation.WorkspaceID, hits, nil)
		if limit > 0 && limit < len(authorized) {
			authorized = authorized[:limit]
		}
		return authorized, nil
	}
	return d.evaluateTaggedView(ctx, workspaceID, view.Query, conditions, limit, false)
}

// evaluateViewForExport exhausts one pinned lexical generation before an
// ExportManifest can be created. The ordinary view.evaluate path remains
// bounded; export must never mistake its legacy prefix for full membership.
func (d *Dispatcher) evaluateViewForExport(ctx context.Context, view sqlite.SavedView) ([]command.SearchHitData, error) {
	prepared, err := d.prepareSavedViewEvaluation(ctx, view)
	if err != nil {
		return nil, err
	}
	conditions, workspaceID := prepared.conditions, prepared.workspaceID
	if len(conditions.Tags) > 0 {
		return d.evaluateTaggedView(ctx, workspaceID, view.Query, conditions, 0, true)
	}
	return d.evaluateLexicalViewForExport(ctx, workspaceID, view.Query, conditions.Filters)
}

func (d *Dispatcher) evaluateLexicalViewForExport(ctx context.Context, workspaceID, text string, filters search.Filters) ([]command.SearchHitData, error) {
	const pageSize = search.DefaultPageSize
	var generationID string
	var position *search.PagePosition
	seenPositions := make(map[search.PagePosition]struct{})
	seenSubjects := make(map[string]struct{})
	var all []command.SearchHitData
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		page, err := d.search.QueryPage(ctx, search.QueryRequest{
			WorkspaceID: workspaceID, GenerationID: generationID,
			Dimension: search.DimensionLexical, Text: text, Filters: filters,
			Page: search.PageRequest{Limit: pageSize, Position: position},
		})
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(page.Generation.ID) == "" || page.Generation.WorkspaceID != workspaceID ||
			(page.Generation.Dimension != "" && page.Generation.Dimension != search.DimensionLexical) {
			return nil, errString("saved view lexical page returned an invalid generation binding")
		}
		if generationID == "" {
			generationID = page.Generation.ID
		} else if generationID != page.Generation.ID {
			return nil, errString("saved view lexical pages crossed index generations")
		}
		if page.Page.Truncated || page.Page.Lane != search.DimensionLexical || page.Page.Returned != len(page.Hits) {
			return nil, errString("saved view lexical page cannot prove complete membership")
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		authorized := d.authorizeHits(ctx, workspaceID, page.Generation.WorkspaceID, page.Hits, nil)
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		for _, hit := range authorized {
			if hit.SubjectRef == "" {
				continue
			}
			if _, duplicate := seenSubjects[hit.SubjectRef]; duplicate {
				continue
			}
			seenSubjects[hit.SubjectRef] = struct{}{}
			all = append(all, hit)
		}
		if !page.Page.HasMore {
			if !page.Page.Complete {
				return nil, errString("saved view lexical page did not prove exhaustion")
			}
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			return all, nil
		}
		if page.Page.Next == nil || len(page.Hits) == 0 {
			return nil, errString("saved view lexical page reported more results without a progressing continuation")
		}
		next := *page.Page.Next
		if position != nil && next == *position {
			return nil, errString("saved view lexical continuation made no progress")
		}
		if _, duplicate := seenPositions[next]; duplicate {
			return nil, errString("saved view lexical continuation repeated")
		}
		seenPositions[next] = struct{}{}
		position = &next
	}
}

// evaluateTaggedView evaluates exact live TAG membership over one pinned
// lexical generation. Authorization is projected before tags are intersected
// so legacy source IDs resolve to the same canonical SubjectRef used by TAGs.
func (d *Dispatcher) evaluateTaggedView(ctx context.Context, workspaceID, text string, conditions parsedViewConditions, requestedLimit int, exhaustive bool) ([]command.SearchHitData, error) {
	limit := requestedLimit
	if !exhaustive && (limit <= 0 || limit > search.LegacyResultLimit) {
		limit = search.LegacyResultLimit
	}
	annotations, err := d.store.ListAnnotations(ctx, workspaceID, "", false)
	if err != nil {
		return nil, fmt.Errorf("read saved-view TAG facts: %w", err)
	}
	liveTagsBySubject := make(map[string]map[string]struct{})
	for _, annotation := range annotations {
		if annotation.Kind != sqlite.AnnotationTag || annotation.Tombstoned {
			continue
		}
		tags := liveTagsBySubject[annotation.SubjectRef]
		if tags == nil {
			tags = make(map[string]struct{})
			liveTagsBySubject[annotation.SubjectRef] = tags
		}
		tags[annotation.Body] = struct{}{}
	}

	pageSize := search.DefaultPageSize
	var generationID string
	var position *search.PagePosition
	seenPositions := make(map[search.PagePosition]struct{})
	seenCanonical := make(map[string]struct{})
	eligible := make([]command.SearchHitData, 0, max(limit, 0))
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		pageRequest := search.PageRequest{Limit: pageSize, Position: position}
		var page search.QueryPageResult
		if strings.TrimSpace(text) == "" && !conditions.Filters.Has() {
			page, err = d.search.QueryLexicalAllPage(ctx, workspaceID, generationID, pageRequest)
		} else {
			page, err = d.search.QueryPage(ctx, search.QueryRequest{
				WorkspaceID: workspaceID, GenerationID: generationID,
				Dimension: search.DimensionLexical, Text: text, Filters: conditions.Filters,
				Page: pageRequest,
			})
		}
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(page.Generation.ID) == "" || page.Generation.WorkspaceID != workspaceID ||
			(page.Generation.Dimension != "" && page.Generation.Dimension != search.DimensionLexical) {
			return nil, errString("saved view lexical page returned an invalid generation binding")
		}
		if page.Page.Truncated || page.Page.Lane != search.DimensionLexical || page.Page.Returned != len(page.Hits) {
			return nil, errString("saved view lexical page cannot prove complete membership")
		}
		if generationID == "" {
			generationID = page.Generation.ID
		} else if generationID != page.Generation.ID {
			return nil, errString("saved view lexical pages crossed index generations")
		}

		authorized := d.authorizeHits(ctx, workspaceID, page.Generation.WorkspaceID, page.Hits, nil)
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		for _, hit := range authorized {
			if hit.SubjectRef == "" {
				continue
			}
			if _, duplicate := seenCanonical[hit.SubjectRef]; duplicate {
				continue
			}
			subjectTags := liveTagsBySubject[hit.SubjectRef]
			matches := true
			for _, tag := range conditions.Tags {
				if _, found := subjectTags[tag]; !found {
					matches = false
					break
				}
			}
			if !matches {
				continue
			}
			seenCanonical[hit.SubjectRef] = struct{}{}
			eligible = append(eligible, hit)
			if !exhaustive && len(eligible) == limit {
				if err := ctx.Err(); err != nil {
					return nil, err
				}
				return eligible, nil
			}
		}

		if !page.Page.HasMore {
			if !page.Page.Complete || page.Page.Truncated || page.Page.Returned != len(page.Hits) {
				return nil, errString("saved view lexical page did not prove complete membership")
			}
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			return eligible, nil
		}
		if page.Page.Truncated || page.Page.Next == nil || len(page.Hits) == 0 {
			return nil, errString("saved view lexical page reported more results without a continuation")
		}
		next := *page.Page.Next
		if position != nil && next == *position {
			return nil, errString("saved view lexical continuation made no progress")
		}
		if _, duplicate := seenPositions[next]; duplicate {
			return nil, errString("saved view lexical continuation repeated")
		}
		seenPositions[next] = struct{}{}
		position = &next
	}
}

// viewEvaluationWorkspace resolves the workspace a dynamic view evaluates
// against. Ingest creates the default workspace, so a view without an explicit
// scope evaluates against it; an unavailable workspace fails closed instead of
// fabricating membership.
func (d *Dispatcher) viewEvaluationWorkspace(ctx context.Context, scope string) string {
	if strings.TrimSpace(scope) != "" {
		return strings.TrimSpace(scope)
	}
	workspace, err := d.store.GetWorkspaceByName(ctx, "default")
	if err != nil {
		return ""
	}
	return workspace.ID
}

// parsedViewConditions keeps existing structured filters beside exact live
// TAG predicates; TAG values are never converted into FTS text.
// Fields use the same snake_case keys as search.filters plus JSON-quoted tag;
// an empty field list means no constraint. A condition this build
// cannot evaluate is refused with an unsupportedViewConditionError instead of
// being dropped: silently skipping it would evaluate the saved view as a
// wider, unfiltered result set that is not its membership.
type parsedViewConditions struct {
	Filters search.Filters
	Tags    []string
}

func viewFiltersFromFields(fields []string) (parsedViewConditions, error) {
	var conditions parsedViewConditions
	seenTags := make(map[string]struct{})
	for _, field := range fields {
		key, value, ok := strings.Cut(field, "=")
		if !ok {
			return parsedViewConditions{}, unsupportedViewConditionError(fmt.Sprintf(
				"saved view condition %q is not a key=value condition", strings.TrimSpace(field)))
		}
		key = strings.TrimSpace(key)
		switch strings.ToLower(key) {
		case "tag":
			tag, err := parseSavedViewTagCondition(value, field)
			if err != nil {
				return parsedViewConditions{}, err
			}
			if _, duplicate := seenTags[tag]; !duplicate {
				seenTags[tag] = struct{}{}
				conditions.Tags = append(conditions.Tags, tag)
			}
		case "entry_type":
			conditions.Filters.EntryType = strings.TrimSpace(value)
		case "content_id":
			conditions.Filters.ContentID = strings.TrimSpace(value)
		case "duplicate_group":
			conditions.Filters.DuplicateGroup = strings.TrimSpace(value)
		case "protection_mode":
			conditions.Filters.ProtectionMode = strings.TrimSpace(value)
		case "suffix":
			conditions.Filters.Suffix = strings.TrimSpace(value)
		case "language":
			conditions.Filters.Language = strings.TrimSpace(value)
		case "size_min":
			parsed, err := parseInt64Field(strings.TrimSpace(value))
			if err != nil {
				return parsedViewConditions{}, err
			}
			conditions.Filters.SizeMin = &parsed
		case "size_max":
			parsed, err := parseInt64Field(strings.TrimSpace(value))
			if err != nil {
				return parsedViewConditions{}, err
			}
			conditions.Filters.SizeMax = &parsed
		case "mtime_after":
			parsed, err := parseInt64Field(strings.TrimSpace(value))
			if err != nil {
				return parsedViewConditions{}, err
			}
			conditions.Filters.MtimeAfter = &parsed
		case "mtime_before":
			parsed, err := parseInt64Field(strings.TrimSpace(value))
			if err != nil {
				return parsedViewConditions{}, err
			}
			conditions.Filters.MtimeBefore = &parsed
		default:
			return parsedViewConditions{}, unsupportedViewConditionError(fmt.Sprintf(
				"saved view condition %q is not supported by view.evaluate", strings.TrimSpace(field)))
		}
	}
	normalized, err := search.NormalizeFilters(conditions.Filters)
	if err != nil {
		return parsedViewConditions{}, err
	}
	conditions.Filters = normalized
	return conditions, nil
}

func parseSavedViewTagCondition(value, field string) (string, error) {
	var tag string
	if err := json.Unmarshal([]byte(value), &tag); err != nil || strings.TrimSpace(tag) == "" {
		return "", unsupportedViewConditionError(fmt.Sprintf(
			"saved view condition %q must contain one nonblank JSON string tag", strings.TrimSpace(field)))
	}
	return tag, nil
}

// unsupportedViewConditionError marks a saved-view condition or policy this
// build cannot honor. It is a caller-visible input problem, not a catalog
// failure, so view.evaluate and export.plan report invalid_input; view.save
// refuses to persist a new unsupported value.
type unsupportedViewConditionError string

func (err unsupportedViewConditionError) Error() string { return string(err) }

// isUnsupportedViewCondition reports whether err is a saved-view condition or
// policy this build cannot evaluate or honor.
func isUnsupportedViewCondition(err error) bool {
	var unsupported unsupportedViewConditionError
	return errors.As(err, &unsupported)
}

// validateSupportedSavedViewPolicy prevents stored options from being
// acknowledged and then silently ignored. Legacy records remain readable;
// their unsupported policy is refused only when evaluated or exported.
func validateSupportedSavedViewPolicy(view sqlite.SavedView) error {
	if value := strings.TrimSpace(view.Sort); value != "" {
		return unsupportedViewConditionError(fmt.Sprintf("saved view policy sort=%q is not supported by this build", value))
	}
	if value := strings.TrimSpace(view.OutputNames); value != "" {
		return unsupportedViewConditionError(fmt.Sprintf("saved view policy output_names=%q is not supported by this build", value))
	}
	for _, value := range view.Required {
		if value = strings.TrimSpace(value); value != "" {
			return unsupportedViewConditionError(fmt.Sprintf("saved view policy required_capabilities=%q is not supported by this build", value))
		}
	}
	if value := strings.TrimSpace(view.WhenMissing); value != "" {
		return unsupportedViewConditionError(fmt.Sprintf("saved view policy when_missing=%q is not supported by this build", value))
	}
	return nil
}

// validateViewConditions refuses to persist a condition this build cannot
// evaluate, so a non-browser caller cannot create a saved retrieval that would
// later fail or silently broaden. It reuses viewFiltersFromFields as the single
// source of the recognized key set and only surfaces the unsupported/malformed
// condition error: a value this build rejects at evaluation time (an unparsable
// integer, a contradictory size range) keeps its existing outcome instead of
// being reclassified at save time.
func validateViewConditions(fields []string) error {
	// Validate every TAG literal before parsing other fields. A malformed
	// numeric predicate earlier in the list must not mask a later unsafe TAG
	// condition and allow that condition to be persisted.
	for _, field := range fields {
		key, value, ok := strings.Cut(field, "=")
		if !ok {
			key = field
		}
		if strings.EqualFold(strings.TrimSpace(key), "tag") {
			if !ok {
				return unsupportedViewConditionError(fmt.Sprintf(
					"saved view condition %q must contain a JSON string tag", strings.TrimSpace(field)))
			}
			if _, err := parseSavedViewTagCondition(value, field); err != nil {
				return err
			}
		}
	}
	_, err := viewFiltersFromFields(fields)
	if isUnsupportedViewCondition(err) {
		return err
	}
	return nil
}

// validateFilterOnlyViewConditions requires an empty-text SavedView to retain
// at least one usable structured predicate. This is deliberately stricter than
// the historic non-empty-query save path, which preserves its existing
// validation behavior for supported numeric conditions.
func validateFilterOnlyViewConditions(fields []string) error {
	conditions, err := viewFiltersFromFields(fields)
	if err != nil {
		return err
	}
	if !conditions.Filters.Has() && len(conditions.Tags) == 0 {
		return errString("query is empty and no non-empty supported filters were provided")
	}
	for _, field := range fields {
		key, value, ok := strings.Cut(field, "=")
		if !ok || (strings.ToLower(strings.TrimSpace(key)) != "tag" && strings.TrimSpace(value) == "") {
			return errString(fmt.Sprintf("saved view condition %q must have a non-empty value", strings.TrimSpace(field)))
		}
	}
	return nil
}

func parseInt64Field(value string) (int64, error) {
	var parsed int64
	if err := json.Unmarshal([]byte(value), &parsed); err != nil {
		return 0, fmt.Errorf("field value %q must be an integer", value)
	}
	return parsed, nil
}
