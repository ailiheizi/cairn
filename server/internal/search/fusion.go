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
		if id == DimensionMultimodal {
			// Report the image space's own state instead of a generic DEGRADED
			// so an operator can tell "not built" from "broken".
			switch dimension.State {
			case ImageProviderNotBuilt:
				component.Status = ImageProviderNotBuilt
			case ImageProviderUnavailable:
				component.Status = ImageProviderUnavailable
			}
			component.Reason = dimension.Reason
		}
		if !ok || dimension.State != "AVAILABLE" {
			result.Components = append(result.Components, component)
			continue
		}
		generation, hits, err := idx.Query(ctx, QueryRequest{
			WorkspaceID: req.WorkspaceID,
			Dimension:   id,
			Text:        req.Text,
			Axes:        req.Axes,
			Filters:     req.Filters,
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
				continue
			}
			seen[hit.SubjectID] = len(result.Hits)
			result.Hits = append(result.Hits, FusedHit{Hit: hit, Dimensions: []string{id}})
		}
	}
	return result, nil
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
// unrecognized failure is reported as QUERY_FAILED.
func QueryFailureReason(dimension string, err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	for _, reason := range []string{MultimodalSpaceMismatchReason, MultimodalIndexNotBuiltReason, MultimodalIndexUnavailableReason} {
		if strings.Contains(message, reason) {
			return reason
		}
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
