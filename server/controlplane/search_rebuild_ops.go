package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/ailiheizi/restoreweave/client/command"
	"github.com/ailiheizi/restoreweave/server/internal/search"
	"github.com/ailiheizi/restoreweave/server/internal/store/sqlite"
)

type searchRebuildInput struct {
	WorkspaceID string `json:"workspace_id"`
	// EgressConfirmation is the optional typed per-request authorization for
	// the semantic rebuild's document disclosure. Without it (and with
	// semantic.send_content_without_confirmation=false) the semantic branch
	// degrades with EGRESS_CONFIRMATION_REQUIRED; lexical rebuild is unaffected.
	EgressConfirmation json.RawMessage `json:"egress_confirmation,omitempty"`
}

// handleSearchRebuild rebuilds disposable search projections from the newest
// published snapshot. The lexical generation is the required result; a real
// semantic provider may be unavailable without making exact content or the
// lexical projection unavailable.
func (d *Dispatcher) handleSearchRebuild(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input searchRebuildInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	confirmation, err := semanticEgressConfirmationFromInput(input.EgressConfirmation)
	if err != nil {
		return invalidInputResult(env, started, err)
	}
	if confirmation != nil {
		ctx = search.WithSemanticEgressConfirmation(ctx, *confirmation)
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if d.search == nil {
		return unimplementedResult(env, started)
	}
	if _, err := d.store.GetWorkspace(ctx, input.WorkspaceID); err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			return notFoundResult(env, started, "workspace not found")
		}
		return catalogErrorResult(env, started, err)
	}
	_, err = d.store.LatestPublication(ctx, input.WorkspaceID)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			return notFoundResult(env, started, "workspace has no published snapshot to rebuild")
		}
		return catalogErrorResult(env, started, err)
	}
	generation, err := d.search.RebuildLatest(ctx, input.WorkspaceID)
	if err != nil {
		return failed(env, started, newReason(ReasonCodeUnavailable, "search rebuild failed: "+err.Error()))
	}
	if strings.TrimSpace(generation.ID) == "" {
		return failed(env, started, newReason(ReasonCodeUnavailable, "search rebuild produced no lexical generation"))
	}
	coverage, coverageErr := d.search.CoverageGeneration(ctx, input.WorkspaceID, generation)
	if coverageErr != nil {
		return failed(env, started, newReason(ReasonCodeUnavailable, "lexical coverage measurement failed: "+coverageErr.Error()))
	}

	data := command.SearchRebuildData{
		WorkspaceID:          generation.WorkspaceID,
		SnapshotRef:          generation.SnapshotRef,
		NamespaceRootID:      generation.NamespaceRootID,
		LexicalGenerationRef: generation.ID,
		LexicalState:         command.CapabilityAvailable,
		LexicalCoverage:      projectSearchCoverage(coverage),
		SemanticState:        command.CapabilityUnavailable,
	}
	degradedReasons := make([]string, 0, 2)
	if !coverage.Available {
		degradedReasons = append(degradedReasons, "lexical field coverage is unavailable after rebuild")
	} else if !coverage.Complete {
		degradedReasons = append(degradedReasons, "lexical field coverage is incomplete after rebuild")
	}
	semantic := findDimension(search.DeclaredDimensions(search.IndexerReadiness(d.search)), search.DimensionSemantic)
	if semantic.State == command.CapabilityAvailable {
		semanticGeneration, semanticErr := d.store.LatestIndexGeneration(ctx, input.WorkspaceID, search.DimensionSemantic)
		if semanticErr == nil && semanticGeneration.WorkspaceID == generation.WorkspaceID &&
			semanticGeneration.SnapshotRef == generation.SnapshotRef &&
			semanticGeneration.NamespaceRootID == generation.NamespaceRootID {
			data.SemanticGenerationRef = semanticGeneration.ID
			data.SemanticState = command.CapabilityAvailable
		} else if semanticErr == nil {
			data.SemanticFailure = "semantic generation does not match rebuilt lexical snapshot"
		} else if !errors.Is(semanticErr, sqlite.ErrNotFound) {
			data.SemanticFailure = semanticErr.Error()
		}
	}
	if data.SemanticState != command.CapabilityAvailable {
		if data.SemanticFailure == "" {
			data.SemanticFailure = strings.TrimSpace(d.search.SemanticFailure())
			if data.SemanticFailure == "" {
				data.SemanticFailure = search.SemanticIndexUnavailableReason
			}
		}
		degradedReasons = append(degradedReasons, "semantic search unavailable; lexical search generation was rebuilt")
	}
	// A remote-provider refusal keeps its stable egress reason in the degraded
	// outcome: the operator must see EGRESS_CONFIRMATION_REQUIRED (or its
	// sibling) instead of a generic unavailability, and must know that the
	// lexical generation is unaffected.
	egressReason := d.search.SemanticFailureReason()
	if egressReason != "" && data.SemanticState != command.CapabilityAvailable {
		degradedReasons = append(degradedReasons,
			"semantic egress refused with "+string(egressReason)+"; lexical search generation was rebuilt")
	}
	// The image space is reported separately and never folded into the text
	// semantic state. NOT_BUILT, UNAVAILABLE, and READY are reported exactly as
	// the indexer observes them, with the stable reason code.
	imageState := d.search.ImageIndexState(ctx, input.WorkspaceID)
	data.ImageState = imageState.State
	data.ImageReason = imageState.Reason
	data.ImageSpaceFingerprint = imageState.SpaceFingerprint
	data.ImageGenerationRef = imageState.GenerationID
	data.ImageIndexed = imageState.Indexed
	data.ImageSkipped = imageState.Skipped
	data.ImageSkipReasons = imageState.SkipReasons
	if imageState.State != search.ImageProviderReady && search.IndexerReadiness(d.search).MultimodalInstalled {
		degradedReasons = append(degradedReasons, "image search is not ready ("+imageState.Reason+"); lexical search generation was rebuilt")
	}
	if len(degradedReasons) > 0 {
		return degradedResult(env, started, data, strings.Join(degradedReasons, "; "))
	}
	return succeeded(env, started, data)
}

func projectSearchCoverage(statement search.CoverageStatement) command.SearchCoverageData {
	fields := make(map[string]bool, len(statement.Fields))
	for field, present := range statement.Fields {
		fields[field] = present
	}
	return command.SearchCoverageData{
		Dimension: statement.Dimension,
		Available: statement.Available,
		Complete:  statement.Complete,
		Fields:    fields,
		Missing:   append([]string(nil), statement.Missing...),
		Notes:     statement.Notes,
	}
}

func findDimension(dimensions []search.Dimension, id string) search.Dimension {
	for _, dimension := range dimensions {
		if dimension.ID == id {
			return dimension
		}
	}
	return search.Dimension{ID: id, State: command.CapabilityUnavailable}
}
