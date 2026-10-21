package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
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
	if coverage.SourceCoverage == nil || !coverage.SourceCoverage.Available {
		degradedReasons = append(degradedReasons, "lexical source coverage is unavailable after rebuild")
	} else if !coverage.SourceCoverage.Complete {
		degradedReasons = append(degradedReasons, "lexical source coverage is incomplete after rebuild")
	}
	semantic := findDimension(search.DeclaredDimensions(search.IndexerReadiness(d.search)), search.DimensionSemantic)
	var semanticGenerationForCoverage *sqlite.IndexGeneration
	if semantic.State == command.CapabilityAvailable {
		semanticGeneration, semanticErr := d.store.LatestIndexGeneration(ctx, input.WorkspaceID, search.DimensionSemantic)
		if semanticErr == nil && semanticGeneration.WorkspaceID == generation.WorkspaceID &&
			semanticGeneration.SnapshotRef == generation.SnapshotRef &&
			semanticGeneration.NamespaceRootID == generation.NamespaceRootID {
			data.SemanticGenerationRef = semanticGeneration.ID
			data.SemanticState = command.CapabilityAvailable
			semanticGenerationForCoverage = &semanticGeneration
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
	} else {
		// Pair-only SemanticCoverage retains its historical meaning. Project
		// source lineage only when it is bound to this exact semantic generation
		// and the rebuilt lexical snapshot/root; an absent or stale source proof
		// degrades the report without revoking otherwise usable vectors.
		semanticCoverage, semanticCoverageErr := d.search.SemanticCoverage(ctx, input.WorkspaceID)
		semanticVerificationFailure := ""
		semanticVerificationValid := false
		sourceCoverage := semanticCoverage.SourceCoverage
		switch {
		case semanticCoverageErr != nil:
			semanticVerificationFailure = semanticCoverageErr.Error()
			data.SemanticSourceCoverage = unavailableSemanticSourceCoverage(semanticGenerationForCoverage, "SOURCE_REPORT_UNAVAILABLE")
			degradedReasons = append(degradedReasons, "semantic source coverage is unavailable after rebuild")
		case semanticGenerationForCoverage == nil || semanticCoverage.GenerationID != data.SemanticGenerationRef ||
			semanticCoverage.ConfigDigest != semanticGenerationForCoverage.ConfigDigest || semanticCoverage.ProfileDigest != semanticGenerationForCoverage.ProviderProfileDigest:
			semanticVerificationFailure = "semantic generation coverage does not match rebuilt generation"
			data.SemanticSourceCoverage = unavailableSemanticSourceCoverage(semanticGenerationForCoverage, "GENERATION_BINDING_MISMATCH")
			degradedReasons = append(degradedReasons, "semantic source coverage does not match rebuilt generation")
		case sourceCoverage == nil:
			semanticVerificationValid = semanticCoverage.Available && semanticCoverage.Complete
			if !semanticVerificationValid {
				semanticVerificationFailure = strings.TrimSpace(semanticCoverage.Notes)
			}
			data.SemanticSourceCoverage = unavailableSemanticSourceCoverage(semanticGenerationForCoverage, "SOURCE_REPORT_UNAVAILABLE")
			degradedReasons = append(degradedReasons, "semantic source coverage is unavailable after rebuild")
		case sourceCoverage.GenerationID != data.SemanticGenerationRef || sourceCoverage.SnapshotRef != data.SnapshotRef ||
			sourceCoverage.NamespaceRootID != data.NamespaceRootID || sourceCoverage.ConfigDigest != semanticGenerationForCoverage.ConfigDigest ||
			sourceCoverage.ProfileDigest != semanticGenerationForCoverage.ProviderProfileDigest:
			semanticVerificationFailure = "semantic generation coverage does not match rebuilt scope"
			data.SemanticSourceCoverage = unavailableSemanticSourceCoverage(semanticGenerationForCoverage, "GENERATION_BINDING_MISMATCH")
			degradedReasons = append(degradedReasons, "semantic source coverage does not match rebuilt scope")
		default:
			semanticVerificationValid = semanticCoverage.Available && semanticCoverage.Complete
			if !semanticVerificationValid {
				semanticVerificationFailure = strings.TrimSpace(semanticCoverage.Notes)
			}
			data.SemanticSourceCoverage = projectSemanticSourceCoverage(sourceCoverage)
			if !sourceCoverage.Available {
				degradedReasons = append(degradedReasons, "semantic source coverage is unavailable after rebuild")
			} else if !sourceCoverage.Complete {
				degradedReasons = append(degradedReasons, "semantic source coverage is incomplete after rebuild")
			}
		}
		// Coverage validation itself reopens and probes the semantic backend.
		// A lifecycle/pair verification failure must not leave the earlier
		// readiness snapshot advertising vectors as usable. Source-only
		// incompleteness (for example a TRUNCATED input) does not affect this
		// pair/runtime decision and keeps SemanticState AVAILABLE.
		semanticAfterCoverage := findDimension(search.DeclaredDimensions(search.IndexerReadiness(d.search)), search.DimensionSemantic)
		if !semanticVerificationValid || semanticAfterCoverage.State != command.CapabilityAvailable {
			data.SemanticState = command.CapabilityUnavailable
			failure := strings.TrimSpace(semanticVerificationFailure)
			if failure == "" {
				failure = strings.TrimSpace(d.search.SemanticFailure())
			}
			if failure == "" {
				failure = strings.TrimSpace(semanticAfterCoverage.Reason)
			}
			if failure == "" {
				failure = search.SemanticIndexUnavailableReason
			}
			data.SemanticFailure = failure
			degradedReasons = append(degradedReasons, "semantic search is unavailable after generation coverage validation; lexical search generation was rebuilt")
		}
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
		Dimension:      statement.Dimension,
		Available:      statement.Available,
		Complete:       statement.Complete,
		Fields:         fields,
		Missing:        append([]string(nil), statement.Missing...),
		Notes:          statement.Notes,
		SourceCoverage: projectSearchSourceCoverage(statement.SourceCoverage),
	}
}

func projectSearchSourceCoverage(statement *search.SourceCoverageStatement) *command.SearchSourceCoverageData {
	if statement == nil {
		return nil
	}
	rows := make([]command.SearchSourceCoverageRowData, 0, len(statement.Rows))
	for _, row := range statement.Rows {
		rows = append(rows, command.SearchSourceCoverageRowData{
			SourceKind: row.SourceKind, SourceSubtype: row.SourceSubtype, Field: row.Field,
			SourceRef: row.SourceRef, Revision: row.Revision, SourceDigest: row.SourceDigest,
			Disposition: command.SearchSourceCoverageDisposition(row.Disposition), Reason: row.Reason,
		})
	}
	return &command.SearchSourceCoverageData{
		Scope: statement.Scope, GenerationID: statement.GenerationID, SnapshotRef: statement.SnapshotRef,
		NamespaceRootID: statement.NamespaceRootID, ConfigDigest: statement.ConfigDigest,
		ProfileDigest: statement.ProfileDigest, Available: statement.Available, Complete: statement.Complete,
		Expected: statement.Expected, Indexed: statement.Indexed, Excluded: statement.Excluded,
		Missing: statement.Missing, Unavailable: statement.Unavailable, Truncated: statement.Truncated,
		Rows: rows, Reason: statement.Reason, Notes: statement.Notes,
	}
}

func projectSemanticSourceCoverage(statement *search.SemanticSourceCoverageStatement) *command.SearchSemanticSourceCoverageData {
	if statement == nil {
		return nil
	}
	rows := make([]command.SearchSemanticSourceCoverageRowData, 0, len(statement.Rows))
	for _, row := range statement.Rows {
		rows = append(rows, command.SearchSemanticSourceCoverageRowData{
			SubjectID: row.SubjectID, SourceKind: row.SourceKind, SourceSubtype: row.SourceSubtype,
			SourceRef: row.SourceRef, Revision: row.Revision, BodyDigest: row.BodyDigest,
			Disposition: command.SearchSemanticSourceCoverageDisposition(row.Disposition), Reason: row.Reason,
			SegmentCount: row.SegmentCount, SegmentIndexed: row.SegmentIndexed, SegmentMissing: row.SegmentMissing,
			InputFull: row.InputFull, InputTruncated: row.InputTruncated, InputUnknown: row.InputUnknown,
		})
	}
	return &command.SearchSemanticSourceCoverageData{
		Scope: statement.Scope, GenerationID: statement.GenerationID, SnapshotRef: statement.SnapshotRef,
		NamespaceRootID: statement.NamespaceRootID, ConfigDigest: statement.ConfigDigest,
		ProfileDigest: statement.ProfileDigest, Available: statement.Available, Complete: statement.Complete,
		Expected: statement.Expected, Indexed: statement.Indexed, Excluded: statement.Excluded,
		Missing: statement.Missing, Unavailable: statement.Unavailable,
		InputFull: statement.InputFull, InputTruncated: statement.InputTruncated, InputUnknown: statement.InputUnknown,
		Truncated: statement.Truncated, Rows: rows, Reason: statement.Reason, Notes: statement.Notes,
	}
}

func unavailableSemanticSourceCoverage(generation *sqlite.IndexGeneration, reason string) *command.SearchSemanticSourceCoverageData {
	if generation == nil {
		return nil
	}
	return &command.SearchSemanticSourceCoverageData{
		Scope: "SEMANTIC_SELECTED_TEXT_V1", GenerationID: generation.ID,
		SnapshotRef: generation.SnapshotRef, NamespaceRootID: generation.NamespaceRootID,
		ConfigDigest: generation.ConfigDigest, ProfileDigest: generation.ProviderProfileDigest,
		Available: false, Complete: false, Reason: reason,
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
