package search

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// Component is one QueryProvider invocation inside host-owned result fusion.
type Component struct {
	Dimension      string
	Provider       string
	GenerationID   string
	ScoreSemantics string
	Status         string
	Hits           int
	// Reason carries the stable machine-readable reason when a component did
	// not succeed. It is empty for SUCCEEDED components.
	Reason string
}

// FusedHit is a subject that one or more components returned.
type FusedHit struct {
	Hit
	Dimensions []string
}

const (
	// ComponentSkipped is reported for a dimension that was deliberately not
	// queried because the request could not ask it anything. It is never a
	// silent zero: Reason names why.
	ComponentSkipped = "SKIPPED"
	// QueryTextRequiredReason is the stable reason for a vector dimension in a
	// request that carries no material for it: a text-less (filter-only) query
	// for a text-embedding space, or an image-only query for the text space. A
	// vector space has no vector to compare without query material, and such a
	// request is not a failure of that dimension.
	QueryTextRequiredReason = "QUERY_TEXT_REQUIRED"
)

// dimensionHasQueryMaterial reports whether the request carries query
// material for one dimension. The lexical and graph projections also answer
// filter-only browse requests; the vector spaces need their own material: the
// text space embeds query text, and the image space embeds query text through
// its text tower or a host-admitted query image through its vision tower. A
// request with no material for a dimension is skipped with its stable reason,
// never scored as a silent zero.
func dimensionHasQueryMaterial(req QueryRequest, id string) bool {
	switch id {
	case DimensionSemantic:
		return strings.TrimSpace(req.Text) != ""
	case DimensionMultimodal:
		return strings.TrimSpace(req.Text) != "" || req.ImageQuery != nil
	default:
		return strings.TrimSpace(req.Text) != "" || req.Filters.Has()
	}
}

// FuseResult unions typed component results without inventing a hybrid score.
type FuseResult struct {
	Hits       []FusedHit
	Components []Component
}

// DefaultFuseDimensions is the host-owned ordinary query surface. It is
// lexical + semantic, plus the separate image space only when its image
// generation is actually ready. An absent image dimension therefore leaves the
// text-only behavior byte-for-byte unchanged, and the qualification fixture is
// never silently promoted into the default broker.
func DefaultFuseDimensions(ready ProviderReadiness) []string {
	dimensions := []string{DimensionLexical, DimensionSemantic}
	if ready.MultimodalReal {
		dimensions = append(dimensions, DimensionMultimodal)
	}
	return dimensions
}

// Fuse queries each named dimension separately and unions authorized
// candidates by SubjectID. Score semantics stay per component.
//
// The image dimension is included only through its own query provider: when it
// is not ready it contributes no hits and is reported with its honest status
// and reason, never as a silent zero.
func (idx *Indexer) Fuse(ctx context.Context, req QueryRequest) (FuseResult, error) {
	var result FuseResult
	if idx == nil || idx.Store == nil || idx.Engine == nil {
		return result, errors.New("search indexer requires a catalog and engine")
	}
	filters, err := NormalizeFilters(req.Filters)
	if err != nil {
		return result, fmt.Errorf("%w: %v", ErrInvalidQuery, err)
	}
	req.Filters = filters
	dims, err := NormalizeFuse(req.Fuse)
	if err != nil {
		return result, err
	}
	readiness := IndexerReadiness(idx)
	seen := map[string]int{}
	for _, id := range dims {
		dimension, ok := LookupDimension(id, readiness)
		component := Component{
			Dimension:      id,
			Provider:       dimension.Provider,
			ScoreSemantics: dimension.ScoreSemantics,
			Status:         "DEGRADED",
		}
		if dimension.Reason != "" {
			// A dimension that reports its own stable reason code (an installed
			// image or semantic binding that is not served) states that code
			// instead of a generic DEGRADED, so an operator can tell "not
			// built yet" from "broken".
			switch dimension.State {
			case ImageProviderNotBuilt, ImageProviderUnavailable:
				component.Status = dimension.State
			}
			component.Reason = dimension.Reason
		}
		if !ok || dimension.State != "AVAILABLE" {
			result.Components = append(result.Components, component)
			continue
		}
		if !dimensionHasQueryMaterial(req, id) {
			// A browse request (filters only) is not a failure of the vector
			// spaces, and an image-only query is not a failure of the text
			// space: each dimension that has no material for this request is
			// skipped with its reason and must never be reported or remembered
			// as a failure.
			component.Status = ComponentSkipped
			component.Reason = QueryTextRequiredReason
			result.Components = append(result.Components, component)
			continue
		}
		generation, hits, err := idx.Query(ctx, QueryRequest{
			WorkspaceID: req.WorkspaceID,
			Dimension:   id,
			Text:        req.Text,
			Axes:        req.Axes,
			Filters:     req.Filters,
			ImageQuery:  req.ImageQuery,
		})
		component.GenerationID = generation.ID
		if err != nil {
			component.Reason = QueryFailureReason(id, err)
			result.Components = append(result.Components, component)
			continue
		}
		component.Status = "SUCCEEDED"
		component.Hits = len(hits)
		result.Components = append(result.Components, component)
		for _, hit := range hits {
			if at, ok := seen[hit.SubjectID]; ok {
				result.Hits[at].Dimensions = appendUnique(result.Hits[at].Dimensions, id)
				mergeHitProvenance(&result.Hits[at].Hit, hit)
				continue
			}
			seen[hit.SubjectID] = len(result.Hits)
			result.Hits = append(result.Hits, FusedHit{Hit: hit, Dimensions: []string{id}})
		}
	}
	return result, nil
}

// mergeHitProvenance keeps each component's source explanation when subjects
// overlap. Namespace/display fields retain the first authorized projection;
// no component gains authority to reinterpret another source's text or spans.
func mergeHitProvenance(target *Hit, candidate Hit) {
	for _, axis := range candidate.ConstructAxes {
		target.ConstructAxes = appendUnique(target.ConstructAxes, axis)
	}
	for _, incoming := range candidate.Segments {
		found := false
		for i, existing := range target.Segments {
			if existing.SourceType != incoming.SourceType || existing.SourceID != incoming.SourceID ||
				existing.DescriptionDocumentID != incoming.DescriptionDocumentID ||
				existing.SegmentID != incoming.SegmentID || existing.Ordinal != incoming.Ordinal ||
				existing.MatchedText != incoming.MatchedText || existing.Kind != incoming.Kind ||
				existing.Producer != incoming.Producer || existing.Accepted != incoming.Accepted ||
				existing.Language != incoming.Language {
				continue
			}
			if len(incoming.MatchSpans) > 0 {
				spans := append([]MatchSpan(nil), existing.MatchSpans...)
				spans = append(spans, incoming.MatchSpans...)
				target.Segments[i].MatchSpans = mergeMatchSpans(spans)
			}
			found = true
			break
		}
		if !found {
			target.Segments = append(target.Segments, incoming)
		}
	}
}

func FuseSucceeded(result FuseResult) bool {
	for _, component := range result.Components {
		if component.Status == "SUCCEEDED" {
			return true
		}
	}
	return false
}

// QueryFailureReason maps one dimension query failure onto a stable
// machine-readable reason. It never turns a failure into a success code: an
// unrecognized failure is reported as QUERY_FAILED. An egress refusal keeps
// its own stable reason so a remote-provider authorization problem is never
// reported as a generic unavailable index.
func QueryFailureReason(dimension string, err error) string {
	if err == nil {
		return ""
	}
	if reason := SemanticEgressReasonOf(err); reason != "" {
		return string(reason)
	}
	message := err.Error()
	for _, reason := range []string{MultimodalSpaceMismatchReason, MultimodalIndexNotBuiltReason, MultimodalIndexUnavailableReason, QueryTextRequiredReason} {
		if strings.Contains(message, reason) {
			return reason
		}
	}
	if egress := SemanticEgressReasonFromText(message); egress != "" {
		return string(egress)
	}
	if errors.Is(err, ErrUnavailable) {
		if dimension == DimensionMultimodal {
			return MultimodalIndexUnavailableReason
		}
		return SemanticIndexUnavailableReason
	}
	return "QUERY_FAILED"
}

func appendUnique(values []string, add string) []string {
	add = strings.TrimSpace(add)
	for _, value := range values {
		if value == add {
			return values
		}
	}
	return append(values, add)
}
