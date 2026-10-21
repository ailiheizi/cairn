package controlplane

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

type annotationListInput struct {
	WorkspaceID string `json:"workspace_id"`
	SubjectRef  string `json:"subject_ref,omitempty"`
}

type annotationUpsertInput struct {
	WorkspaceID      string `json:"workspace_id"`
	SubjectRef       string `json:"subject_ref"`
	Kind             string `json:"kind"`
	Body             string `json:"body"`
	AnnotationID     string `json:"annotation_id,omitempty"`
	ExpectedRevision int64  `json:"expected_revision"`
}

type annotationDeleteInput struct {
	WorkspaceID      string `json:"workspace_id"`
	AnnotationID     string `json:"annotation_id"`
	ExpectedRevision int64  `json:"expected_revision"`
}

type annotationExportInput struct {
	WorkspaceID string `json:"workspace_id"`
	SubjectRef  string `json:"subject_ref,omitempty"`
}

type searchQueryInput struct {
	Query        json.RawMessage `json:"query"`
	WorkspaceID  string          `json:"workspace_id,omitempty"`
	GenerationID string          `json:"index_generation_ref,omitempty"`
	Dimension    string          `json:"dimension,omitempty"`
	Axes         []string        `json:"construct_axes,omitempty"`
	Fuse         []string        `json:"fuse,omitempty"`
	Filters      search.Filters  `json:"filters,omitempty"`
	// ImageSubjectRef is the optional stable subject of one admitted image
	// file used as the query material of the image dimension (search by
	// image). It is resolved once here into admitted bytes through the
	// repository image content source; the search package never resolves
	// subjects or opens a repository. It is retrieval material only and never
	// establishes exact identity.
	ImageSubjectRef string `json:"image_subject_ref,omitempty"`
	// EgressConfirmation is the optional typed per-request authorization for
	// remote embedding. When semantic.send_content_without_confirmation is
	// false and the semantic component would egress, a missing confirmation is
	// a typed EGRESS_CONFIRMATION_REQUIRED outcome, never a silent fallback.
	EgressConfirmation json.RawMessage `json:"egress_confirmation,omitempty"`
	// Page is the additive bounded-paging input. A caller that omits it keeps
	// the pre-paging single-answer bound; a caller that asks for a page gets
	// one, and every answer states the bound it applied.
	Page *pageInput `json:"page,omitempty"`
}

// egressConfirmationInput is the typed per-request egress confirmation carried
// by search.query and search.rebuild. It binds the disclosure to an installed
// profile, its destination host, model, purpose, and the live grant; the
// daemon fills the content digest when the caller leaves it empty because only
// the daemon assembles the exact inputs.
type egressConfirmationInput struct {
	ProfileID     string `json:"profile_id,omitempty"`
	ProfileDigest string `json:"profile_digest,omitempty"`
	Endpoint      string `json:"endpoint,omitempty"`
	EndpointHost  string `json:"endpoint_host,omitempty"`
	Model         string `json:"model,omitempty"`
	Purpose       string `json:"purpose,omitempty"`
	ContentDigest string `json:"content_digest,omitempty"`
	ExpiresAt     string `json:"expires_at,omitempty"`
	GrantID       string `json:"grant_id"`
}

// semanticEgressConfirmationFromInput strictly decodes the optional
// confirmation object. A partial confirmation is refused rather than silently
// ignored: the operator either authorizes this exact disclosure or does not.
func semanticEgressConfirmationFromInput(raw json.RawMessage) (*search.SemanticEgressConfirmation, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, nil
	}
	var input egressConfirmationInput
	if err := decodeStrictOperationInput(raw, &input); err != nil {
		return nil, fmt.Errorf("egress_confirmation: %w", err)
	}
	confirmation := &search.SemanticEgressConfirmation{
		ProviderProfileID: strings.TrimSpace(input.ProfileID),
		ProfileDigest:     strings.TrimSpace(input.ProfileDigest),
		Endpoint:          strings.TrimSpace(input.Endpoint),
		EndpointHost:      strings.TrimSpace(input.EndpointHost),
		ModelID:           strings.TrimSpace(input.Model),
		GrantID:           strings.TrimSpace(input.GrantID),
		ContentDigest:     strings.TrimSpace(input.ContentDigest),
	}
	if confirmation.GrantID == "" {
		return nil, errors.New("egress_confirmation.grant_id is required")
	}
	if confirmation.ProviderProfileID == "" && confirmation.ProfileDigest == "" {
		return nil, errors.New("egress_confirmation must name profile_id or profile_digest")
	}
	if confirmation.Endpoint == "" && confirmation.EndpointHost == "" {
		return nil, errors.New("egress_confirmation must name endpoint or endpoint_host")
	}
	if confirmation.ModelID == "" {
		return nil, errors.New("egress_confirmation.model is required")
	}
	switch strings.ToUpper(strings.TrimSpace(input.Purpose)) {
	case string(search.SemanticEmbeddingDocument):
		confirmation.Purpose = search.SemanticEmbeddingDocument
	case string(search.SemanticEmbeddingQuery):
		confirmation.Purpose = search.SemanticEmbeddingQuery
	default:
		return nil, errors.New("egress_confirmation.purpose must be DOCUMENT or QUERY")
	}
	if strings.TrimSpace(input.ExpiresAt) != "" {
		expiresAt, err := time.Parse(time.RFC3339, strings.TrimSpace(input.ExpiresAt))
		if err != nil {
			return nil, errors.New("egress_confirmation.expires_at must be an RFC3339 instant")
		}
		confirmation.ExpiresAt = expiresAt.UTC()
	}
	return confirmation, nil
}

func (d *Dispatcher) handleAnnotationList(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil {
		return unimplementedResult(env, started)
	}
	var input annotationListInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if input.SubjectRef != "" {
		if err := requireStableID("subject_ref", input.SubjectRef); err != nil {
			return invalidInputResult(env, started, err)
		}
		entry, err := d.resolveSubject(ctx, input.WorkspaceID, input.SubjectRef)
		if err != nil {
			return namespaceLookupResult(env, started, err)
		}
		input.SubjectRef = entry.SubjectRef
	}
	records, err := d.store.ListAnnotations(ctx, input.WorkspaceID, input.SubjectRef, false)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	return succeeded(env, started, command.AnnotationListData{Annotations: projectAnnotations(records)})
}

func (d *Dispatcher) handleAnnotationUpsert(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil {
		return unimplementedResult(env, started)
	}
	var input annotationUpsertInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("subject_ref", input.SubjectRef); err != nil {
		return invalidInputResult(env, started, err)
	}
	if strings.TrimSpace(input.Body) == "" {
		return invalidInputResult(env, started, errString("body is required"))
	}
	kind := sqlite.AnnotationKind(strings.ToUpper(strings.TrimSpace(input.Kind)))
	switch kind {
	case sqlite.AnnotationTag, sqlite.AnnotationNote, sqlite.AnnotationProgress:
	default:
		return invalidInputResult(env, started, errString("kind must be TAG, NOTE, or PROGRESS"))
	}
	entry, err := d.resolveSubject(ctx, input.WorkspaceID, input.SubjectRef)
	if err != nil {
		if containsNotFound(err) {
			return notFoundResult(env, started, "subject not found")
		}
		return catalogErrorResult(env, started, err)
	}
	input.SubjectRef = entry.SubjectRef
	if kind == sqlite.AnnotationNote && input.AnnotationID != "" {
		if err := requireStableID("annotation_id", input.AnnotationID); err != nil {
			return invalidInputResult(env, started, err)
		}
		existing, err := d.store.GetAnnotation(ctx, input.WorkspaceID, input.AnnotationID)
		if err != nil {
			return annotationWriteResult(env, started, err)
		}
		if existing.SubjectRef != input.SubjectRef {
			return invalidInputResult(env, started, errString("annotation_id belongs to a different subject"))
		}
	}
	var record sqlite.Annotation
	switch kind {
	case sqlite.AnnotationTag:
		record, err = d.upsertTag(ctx, input)
	case sqlite.AnnotationNote:
		record, err = d.upsertNote(ctx, input)
	case sqlite.AnnotationProgress:
		record, err = d.upsertProgress(ctx, input)
	}
	if err != nil {
		return annotationWriteResult(env, started, err)
	}
	var searchErr, publicationErr error
	if kind != sqlite.AnnotationProgress {
		searchErr = d.rebuildSearch(ctx, input.WorkspaceID)
	}
	publicationErr = d.publishAnnotationFact(ctx, record)
	if searchErr != nil || publicationErr != nil {
		data := command.AnnotationUpsertData{Annotation: projectAnnotation(record)}
		return annotationPostCommitDegradedResult(env, started, data, searchErr, publicationErr)
	}
	return succeeded(env, started, command.AnnotationUpsertData{Annotation: projectAnnotation(record)})
}

func (d *Dispatcher) handleAnnotationDelete(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil {
		return unimplementedResult(env, started)
	}
	var input annotationDeleteInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("annotation_id", input.AnnotationID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if input.ExpectedRevision < 1 {
		return invalidInputResult(env, started, errString("expected_revision is required"))
	}
	existing, err := d.store.GetAnnotation(ctx, input.WorkspaceID, input.AnnotationID)
	if err != nil {
		return annotationWriteResult(env, started, err)
	}
	if existing.Tombstoned {
		return notFoundResult(env, started, "annotation not found")
	}
	if existing.Revision != input.ExpectedRevision {
		return annotationWriteResult(env, started, sqlite.ErrConflict)
	}
	tombstoneTime := time.Now().UTC()
	if err := d.store.ReviseAnnotation(ctx, input.WorkspaceID, input.AnnotationID, input.ExpectedRevision, existing.Body, true, tombstoneTime); err != nil {
		return annotationWriteResult(env, started, err)
	}
	updated := sqlite.Annotation{
		ID:                  existing.ID,
		WorkspaceID:         existing.WorkspaceID,
		SubjectRef:          existing.SubjectRef,
		Kind:                existing.Kind,
		Body:                existing.Body,
		BodyDigest:          annotationBodyDigest(existing.Body),
		Revision:            input.ExpectedRevision + 1,
		PredecessorRevision: input.ExpectedRevision,
		Tombstoned:          true,
		CreatedAt:           existing.CreatedAt,
		UpdatedAt:           tombstoneTime,
	}
	searchErr := d.rebuildSearch(ctx, input.WorkspaceID)
	publicationErr := d.publishAnnotationFact(ctx, updated)
	if searchErr != nil || publicationErr != nil {
		return annotationPostCommitDegradedResult(env, started, command.AnnotationUpsertData{Annotation: projectAnnotation(updated)}, searchErr, publicationErr)
	}
	return succeeded(env, started, command.AnnotationUpsertData{Annotation: projectAnnotation(updated)})
}

func (d *Dispatcher) handleAnnotationExport(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil {
		return unimplementedResult(env, started)
	}
	var input annotationExportInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if input.SubjectRef != "" {
		if err := requireStableID("subject_ref", input.SubjectRef); err != nil {
			return invalidInputResult(env, started, err)
		}
		entry, err := d.resolveSubject(ctx, input.WorkspaceID, input.SubjectRef)
		if err != nil {
			return namespaceLookupResult(env, started, err)
		}
		input.SubjectRef = entry.SubjectRef
	}
	records, err := d.store.ListAnnotations(ctx, input.WorkspaceID, input.SubjectRef, true)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	return succeeded(env, started, command.AnnotationExportData{
		Schema:      command.AnnotationBundleSchema,
		Annotations: projectAnnotations(records),
	})
}

func (d *Dispatcher) handleAnnotationImport(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil {
		return unimplementedResult(env, started)
	}
	var bundle command.AnnotationExportData
	if err := decodeInput(env.Input, &bundle); err != nil {
		return invalidInputResult(env, started, err)
	}
	if bundle.Schema != "" && bundle.Schema != command.AnnotationBundleSchema {
		return invalidInputResult(env, started, errString("unsupported annotation bundle schema"))
	}
	policy, err := normalizeAnnotationConflict(bundle.Conflict)
	if err != nil {
		return invalidInputResult(env, started, err)
	}
	seenAnnotationIDs := make(map[string]struct{}, len(bundle.Annotations))
	for index := range bundle.Annotations {
		item := &bundle.Annotations[index]
		if err := requireStableID("annotation_id", item.ID); err != nil {
			return invalidInputResult(env, started, err)
		}
		if _, duplicate := seenAnnotationIDs[item.ID]; duplicate {
			return invalidInputResult(env, started, errString("duplicate annotation_id "+item.ID))
		}
		seenAnnotationIDs[item.ID] = struct{}{}
		if err := requireStableID("workspace_id", item.WorkspaceID); err != nil {
			return invalidInputResult(env, started, err)
		}
		if err := requireStableID("subject_ref", item.SubjectRef); err != nil {
			return invalidInputResult(env, started, err)
		}
		switch sqlite.AnnotationKind(item.Kind) {
		case sqlite.AnnotationTag, sqlite.AnnotationNote, sqlite.AnnotationProgress:
		default:
			return invalidInputResult(env, started, errString("annotation "+item.ID+" kind must be TAG, NOTE, or PROGRESS"))
		}
		if strings.TrimSpace(item.Body) == "" {
			return invalidInputResult(env, started, errString("annotation "+item.ID+" body is required"))
		}
		wantBodyDigest := fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(item.Body)))
		if item.BodyDigest != "" && item.BodyDigest != wantBodyDigest {
			return invalidInputResult(env, started, errString("annotation "+item.ID+" body_digest does not match body"))
		}
		if item.Revision < 1 {
			return invalidInputResult(env, started, errString("annotation "+item.ID+" revision must be positive"))
		}
		if item.PredecessorRevision < 0 || item.PredecessorRevision >= item.Revision {
			return invalidInputResult(env, started, errString("annotation "+item.ID+" predecessor_revision must be non-negative and less than revision"))
		}
		entry, err := d.resolveSubject(ctx, item.WorkspaceID, item.SubjectRef)
		if err != nil {
			if containsNotFound(err) {
				return invalidInputResult(env, started, errString("annotation "+item.ID+" subject not found"))
			}
			return catalogErrorResult(env, started, err)
		}
		item.SubjectRef = entry.SubjectRef
		existing, err := d.store.GetAnnotation(ctx, item.WorkspaceID, item.ID)
		if err == nil {
			if existing.SubjectRef != item.SubjectRef {
				return invalidInputResult(env, started, errString("annotation "+item.ID+" belongs to a different subject"))
			}
			if string(existing.Kind) != item.Kind {
				return invalidInputResult(env, started, errString("annotation "+item.ID+" belongs to a different kind"))
			}
		} else if !containsNotFound(err) {
			return catalogErrorResult(env, started, err)
		}
	}
	imported := make([]command.AnnotationData, 0, len(bundle.Annotations))
	changedWorkspaces := map[string]struct{}{}
	committedByWorkspace := map[string][]sqlite.Annotation{}
	err = d.store.Update(ctx, func(tx *sqlite.Tx) error {
		for _, item := range bundle.Annotations {
			existing, getErr := tx.GetAnnotation(ctx, item.WorkspaceID, item.ID)
			if getErr == nil {
				same := existing.Revision == item.Revision && existing.PredecessorRevision == item.PredecessorRevision && existing.Body == item.Body && existing.Tombstoned == item.Tombstoned
				if same {
					imported = append(imported, projectAnnotation(existing))
					committedByWorkspace[item.WorkspaceID] = append(committedByWorkspace[item.WorkspaceID], existing)
					continue
				}
				switch policy {
				case command.AnnotationConflictKeepLocal:
					imported = append(imported, projectAnnotation(existing))
					committedByWorkspace[item.WorkspaceID] = append(committedByWorkspace[item.WorkspaceID], existing)
					continue
				case command.AnnotationConflictKeepImported:
					if existing.Tombstoned {
						return fmt.Errorf("%w: annotation %s is tombstoned locally", sqlite.ErrConflict, item.ID)
					}
					if err := tx.UpdateAnnotationRevision(ctx, item.WorkspaceID, item.ID, existing.Revision, item.Body, item.Tombstoned, time.Time{}); err != nil {
						return err
					}
					updated, err := tx.GetAnnotation(ctx, item.WorkspaceID, item.ID)
					if err != nil {
						return err
					}
					imported = append(imported, projectAnnotation(updated))
					committedByWorkspace[item.WorkspaceID] = append(committedByWorkspace[item.WorkspaceID], updated)
					changedWorkspaces[item.WorkspaceID] = struct{}{}
					continue
				default:
					return fmt.Errorf("%w: annotation %s already exists with a different revision", sqlite.ErrConflict, item.ID)
				}
			}
			if !containsNotFound(getErr) {
				return getErr
			}
			record := &sqlite.Annotation{
				ID:                  item.ID,
				WorkspaceID:         item.WorkspaceID,
				SubjectRef:          item.SubjectRef,
				Kind:                sqlite.AnnotationKind(item.Kind),
				Body:                item.Body,
				Revision:            item.Revision,
				PredecessorRevision: item.PredecessorRevision,
				Tombstoned:          item.Tombstoned,
			}
			if err := tx.InsertAnnotation(ctx, record); err != nil {
				return err
			}
			created, err := tx.GetAnnotation(ctx, item.WorkspaceID, item.ID)
			if err != nil {
				return err
			}
			imported = append(imported, projectAnnotation(created))
			committedByWorkspace[item.WorkspaceID] = append(committedByWorkspace[item.WorkspaceID], created)
			changedWorkspaces[item.WorkspaceID] = struct{}{}
		}
		return nil
	})
	if err != nil {
		return annotationWriteResult(env, started, err)
	}
	searchErrors := make([]error, 0, len(changedWorkspaces))
	searchWorkspaces := sortedWorkspaceIDs(changedWorkspaces)
	for _, workspaceID := range searchWorkspaces {
		if rebuildErr := d.rebuildSearch(ctx, workspaceID); rebuildErr != nil {
			searchErrors = append(searchErrors, fmt.Errorf("workspace %s: %w", workspaceID, rebuildErr))
		}
	}
	publicationErrors := make([]error, 0, len(committedByWorkspace))
	for _, workspaceID := range sortedAnnotationWorkspaceIDs(committedByWorkspace) {
		if publishErr := d.publishAnnotationFacts(ctx, workspaceID, committedByWorkspace[workspaceID]); publishErr != nil {
			publicationErrors = append(publicationErrors, fmt.Errorf("workspace %s: %w", workspaceID, publishErr))
		}
	}
	var searchErr, publicationErr error
	if len(searchErrors) > 0 {
		searchErr = errors.Join(searchErrors...)
	}
	if len(publicationErrors) > 0 {
		publicationErr = errors.Join(publicationErrors...)
	}
	data := command.AnnotationExportData{
		Schema: command.AnnotationBundleSchema, Annotations: imported, Conflict: policy,
	}
	if searchErr != nil || publicationErr != nil {
		return metadataPostCommitDegradedResult(env, started, data, "annotation import", searchErr, publicationErr)
	}
	return succeeded(env, started, data)
}

func sortedWorkspaceIDs(workspaces map[string]struct{}) []string {
	ids := make([]string, 0, len(workspaces))
	for id := range workspaces {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func sortedAnnotationWorkspaceIDs(records map[string][]sqlite.Annotation) []string {
	ids := make([]string, 0, len(records))
	for id := range records {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func normalizeAnnotationConflict(policy string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(policy)) {
	case "", command.AnnotationConflictFail:
		return command.AnnotationConflictFail, nil
	case command.AnnotationConflictKeepLocal, command.AnnotationConflictKeepImported:
		return strings.ToLower(strings.TrimSpace(policy)), nil
	default:
		return "", errString("conflict must be fail, keep-local, or keep-imported")
	}
}

func (d *Dispatcher) handleSearchQuery(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.search == nil {
		return unimplementedResult(env, started)
	}
	var input searchQueryInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	page, err := resolvePageInput(input.Page, search.LegacyResultLimit)
	if err != nil {
		return invalidInputResult(env, started, err)
	}
	confirmation, err := semanticEgressConfirmationFromInput(input.EgressConfirmation)
	if err != nil {
		return invalidInputResult(env, started, err)
	}
	if confirmation != nil {
		ctx = search.WithSemanticEgressConfirmation(ctx, *confirmation)
	}
	queryText, dimensionID, requestedAxes, fuseIDs, filters := parseSearchRequest(input)
	if input.ImageSubjectRef != "" {
		if err := requireStableID("image_subject_ref", input.ImageSubjectRef); err != nil {
			return invalidInputResult(env, started, err)
		}
		if strings.TrimSpace(queryText) != "" {
			return invalidInputResult(env, started, errString("image_subject_ref and query text cannot be set together"))
		}
		if strings.TrimSpace(input.WorkspaceID) == "" {
			// The query image resolves to a subject of one workspace; a
			// cross-workspace default would silently answer about the wrong
			// subject.
			return invalidInputResult(env, started, errString("workspace_id is required with image_subject_ref"))
		}
	}
	if queryText == "" && !filters.Has() && input.ImageSubjectRef == "" {
		return invalidInputResult(env, started, errString("query or filters are required"))
	}
	filters, err = search.NormalizeFilters(filters)
	if err != nil {
		return invalidInputResult(env, started, err)
	}
	if input.WorkspaceID != "" {
		if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
			return invalidInputResult(env, started, err)
		}
	}
	// The query image is resolved exactly once, before any dimension runs: the
	// subject must be a published regular file with an admitted image suffix
	// and bound content identity, and the bytes are read through the
	// repository image content source, which re-hashes them against that
	// identity. Every caller-input refusal here is typed and stable, and none
	// of them touches a verified generation.
	var imageQuery *search.ImageQueryInput
	if input.ImageSubjectRef != "" {
		resolved, resolveErr := d.resolveImageQueryInput(ctx, input.WorkspaceID, input.ImageSubjectRef)
		if resolveErr != nil {
			if containsNotFound(resolveErr) {
				return notFoundResult(env, started, resolveErr.Error())
			}
			if errors.Is(resolveErr, errImageQueryInput) {
				return invalidInputResult(env, started, resolveErr)
			}
			return catalogErrorResult(env, started, resolveErr)
		}
		imageQuery = &resolved
	}
	defaultBroker := strings.TrimSpace(dimensionID) == "" && len(fuseIDs) == 0 && input.GenerationID == ""
	if imageQuery != nil && !defaultBroker {
		// A caller-pinned dimension or fuse list must actually use the image:
		// silently ignoring the resolved query image would answer a different
		// question than the one that was asked.
		if strings.TrimSpace(dimensionID) != "" && dimensionID != search.DimensionMultimodal {
			return invalidInputResult(env, started, errString("image_subject_ref requires the multimodal dimension"))
		}
		usesImage := false
		for _, id := range fuseIDs {
			if id == search.DimensionMultimodal {
				usesImage = true
				break
			}
		}
		if len(fuseIDs) > 0 && !usesImage {
			return invalidInputResult(env, started, errString("image_subject_ref requires the multimodal dimension in fuse"))
		}
	}
	if defaultBroker {
		// The ordinary query path is host-owned fusion. Structured predicates
		// remain enforced by the lexical projection while semantic contributes
		// only when its profile-bound generation is actually available. The
		// separate image space joins the default broker only when its own
		// generation is ready, so a text-only install behaves exactly as before.
		fuseIDs = search.DefaultFuseDimensions(search.IndexerReadiness(d.search))
	}
	if len(fuseIDs) > 0 {
		if strings.TrimSpace(dimensionID) != "" {
			return invalidInputResult(env, started, errString("fuse and dimension cannot be set together"))
		}
		if input.GenerationID != "" {
			return invalidInputResult(env, started, errString("fuse cannot pin one index_generation_ref"))
		}
		return d.handleFusedSearch(ctx, env, started, input.WorkspaceID, queryText, requestedAxes, fuseIDs, filters, defaultBroker, imageQuery, page)
	}
	dimension, ok := search.LookupDimension(dimensionID, search.IndexerReadiness(d.search))
	if !ok {
		return invalidInputResult(env, started, errString("dimension is not a declared index dimension"))
	}
	if dimension.ID != search.DimensionLexical && len(requestedAxes) > 0 {
		return invalidInputResult(env, started, errString("construct_axes are lexical only"))
	}
	var axes []string
	if dimension.ID == search.DimensionLexical {
		var err error
		axes, err = search.NormalizeConstructAxes(requestedAxes)
		if err != nil {
			return invalidInputResult(env, started, err)
		}
	}
	if input.GenerationID != "" {
		if err := requireStableID("index_generation_ref", input.GenerationID); err != nil {
			return invalidInputResult(env, started, err)
		}
	}
	// The lexical lane is the only lane with a complete, totally ordered match
	// set, so it is the only lane a continuation can be accepted for. A cursor
	// against any other shape is refused as invalid input instead of being
	// ignored or answered from a bounded top-k set.
	pageable := dimension.ID == search.DimensionLexical
	pageRefusal := "the " + dimension.ID + " lane is a bounded top-k answer with no seekable order; pin dimension=" + search.DimensionLexical + " to page the complete lexical match set"
	if err := resolveLexicalConstraint(pageable, dimension.ID, pageRefusal, page.Token); err != nil {
		return invalidInputResult(env, started, err)
	}
	empty := command.SearchQueryData{
		Dimension:      dimension.ID,
		Provider:       dimension.Provider,
		ScoreSemantics: dimension.ScoreSemantics,
		ConstructAxes:  axes,
		Hits:           []command.SearchHitData{},
	}
	pinnedStaleSemantic := dimension.ID == search.DimensionSemantic && input.GenerationID != "" && d.search.PinnedSemanticHistoryEligible()
	if dimension.State != command.CapabilityAvailable && !pinnedStaleSemantic {
		empty.ConstructAxes = nil
		empty.Page = boundedSearchPageData(page.Mode, page.Limit, dimension.ID, string(dimension.State), 0, 0)
		return degradedResult(env, started, empty,
			dimension.ID+" is unavailable in this build; lexical search, namespace, annotations, and restore are unaffected")
	}
	request := search.QueryRequest{
		WorkspaceID:  input.WorkspaceID,
		GenerationID: input.GenerationID,
		Dimension:    dimension.ID,
		Text:         queryText,
		Axes:         axes,
		Filters:      filters,
		ImageQuery:   imageQuery,
		Page:         search.PageRequest{Limit: page.Limit},
	}
	// A continuation is authenticated against the exact generation, query,
	// order, and authorization scope before anything runs. A token that names
	// another query, another generation, an expired instant, or another
	// workspace is refused as invalid input, never answered with a page.
	var binding search.ContinuationBinding
	if pageable && page.Token != "" {
		resolvedGeneration, resolveErr := d.search.ResolveQueryGeneration(ctx, request)
		if resolveErr != nil {
			return invalidInputResult(env, started, fmt.Errorf("%w: %v", search.ErrStaleContinuation, resolveErr))
		}
		queryDigest, digestErr := (search.QueryShape{
			WorkspaceID:     input.WorkspaceID,
			Dimension:       dimension.ID,
			Text:            queryText,
			Axes:            axes,
			Filters:         filters,
			ImageSubjectRef: input.ImageSubjectRef,
		}).Digest()
		if digestErr != nil {
			return invalidInputResult(env, started, digestErr)
		}
		binding = search.ContinuationBinding{
			Scope:        search.AuthorizationScopeDigest(input.WorkspaceID),
			Query:        queryDigest,
			GenerationID: resolvedGeneration.ID,
			Lane:         search.DimensionLexical,
			Order:        search.LexicalOrder(queryText),
		}
		position, parseErr := search.ParseContinuation(page.Token, binding, d.now())
		if parseErr != nil {
			return invalidInputResult(env, started, parseErr)
		}
		request.Page.Position = &position
	}
	result, err := d.search.QueryPage(ctx, request)
	if err != nil {
		if errors.Is(err, search.ErrInvalidQuery) {
			return invalidInputResult(env, started, err)
		}
		if errors.Is(err, search.ErrUnavailable) {
			empty.GenerationID = result.Generation.ID
			if reason := search.SemanticEgressReasonOf(err); reason != "" {
				return degradedResult(env, started, empty,
					"semantic search requires an egress authorization ("+string(reason)+"); lexical search, namespace, annotations, and restore are unaffected")
			}
			return degradedResult(env, started, empty, "search index is unavailable; namespace, annotations, and restore are unaffected")
		}
		return catalogErrorResult(env, started, err)
	}
	data := command.SearchQueryData{
		GenerationID:   result.Generation.ID,
		Dimension:      dimension.ID,
		Provider:       dimension.Provider,
		ScoreSemantics: dimension.ScoreSemantics,
		ConstructAxes:  axes,
		Hits:           d.authorizeHits(ctx, input.WorkspaceID, result.Generation.WorkspaceID, result.Hits, nil),
	}
	if pageable {
		data.Page = lexicalPageData(page.Mode, page.Limit, result.Page, len(data.Hits))
		if binding.Query == "" {
			// The binding is built for the answer even when this page carried
			// no cursor, so the continuation it issues is authenticated against
			// exactly this generation and query shape.
			queryDigest, digestErr := (search.QueryShape{
				WorkspaceID:     input.WorkspaceID,
				Dimension:       dimension.ID,
				Text:            queryText,
				Axes:            axes,
				Filters:         filters,
				ImageSubjectRef: input.ImageSubjectRef,
			}).Digest()
			if digestErr != nil {
				return catalogErrorResult(env, started, digestErr)
			}
			binding = search.ContinuationBinding{
				Scope:        search.AuthorizationScopeDigest(input.WorkspaceID),
				Query:        queryDigest,
				GenerationID: result.Generation.ID,
				Lane:         search.DimensionLexical,
				Order:        result.Page.Order,
			}
		}
		if err := d.attachLexicalContinuation(data.Page, binding, result.Page.Next); err != nil {
			return catalogErrorResult(env, started, err)
		}
	} else {
		data.Page = boundedSearchPageData(page.Mode, page.Limit, dimension.ID, string(command.StatusSucceeded), len(data.Hits), result.Page.BoundedTopK)
	}
	return succeeded(env, started, data)
}

func (d *Dispatcher) handleFusedSearch(ctx context.Context, env command.Envelope, started time.Time, workspaceID, queryText string, requestedAxes, fuseIDs []string, filters search.Filters, defaultBroker bool, imageQuery *search.ImageQueryInput, page searchPageRequest) command.Result {
	if err := resolveLexicalConstraint(false, strings.Join(fuseIDs, ","), "a fused answer unions the complete lexical match set with bounded top-k lanes, so the union itself cannot be one continuation chain; pin dimension="+search.DimensionLexical+" to page the complete lexical match set", page.Token); err != nil {
		return invalidInputResult(env, started, err)
	}
	dims, err := search.NormalizeFuse(fuseIDs)
	if err != nil {
		return invalidInputResult(env, started, err)
	}
	var axes []string
	for _, id := range dims {
		if id == search.DimensionLexical {
			axes, err = search.NormalizeConstructAxes(requestedAxes)
			if err != nil {
				return invalidInputResult(env, started, err)
			}
			break
		}
	}
	if axes == nil && len(requestedAxes) > 0 {
		return invalidInputResult(env, started, errString("construct_axes are lexical only"))
	}
	fused, err := d.search.Fuse(ctx, search.QueryRequest{
		WorkspaceID: workspaceID,
		Text:        queryText,
		Axes:        axes,
		Fuse:        dims,
		Filters:     filters,
		ImageQuery:  imageQuery,
		Page:        search.PageRequest{Limit: page.Limit},
	})
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	components := make([]command.SearchComponentData, 0, len(fused.Components))
	for _, component := range fused.Components {
		components = append(components, command.SearchComponentData{
			Dimension:      component.Dimension,
			Provider:       component.Provider,
			GenerationID:   component.GenerationID,
			ScoreSemantics: component.ScoreSemantics,
			Status:         component.Status,
			Reason:         component.Reason,
			Hits:           component.Hits,
		})
	}
	// A user-facing broker query may omit workspace_id. Indexer.Query can
	// select the newest generation in that case, but authorization still needs
	// the generation's workspace to resolve stable SubjectRefs. Derive it only
	// from successful, generation-pinned components and require every such
	// component to agree; never mix globally newest generations from different
	// workspaces or guess a default workspace.
	authorizedWorkspaceID, err := d.resolveFusedWorkspace(ctx, workspaceID, fused.Components)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	hits := make([]search.Hit, 0, len(fused.Hits))
	dimBySubject := map[string][]string{}
	for _, hit := range fused.Hits {
		hits = append(hits, hit.Hit)
		dimBySubject[hit.SubjectID] = hit.Dimensions
	}
	authorizedHits, canonicalBySource := d.authorizeHitsWithCanonicalSubjects(ctx, authorizedWorkspaceID, "", hits, dimBySubject)
	retained := fused.RetainAuthorizedSubjects(canonicalBySource)
	orderedAuthorizedHits := projectAuthorizedFusedOrder(authorizedHits, retained)
	data := command.SearchQueryData{
		Provider:        search.ProviderBrokerFuse,
		ScoreSemantics:  search.ScoreReciprocalRankFusion,
		FusedDimensions: dims,
		ConstructAxes:   axes,
		Components:      components,
		Hits:            orderedAuthorizedHits,
	}
	// The fused answer states its own partiality: a union that mixes the
	// complete lexical match set with bounded top-k lanes is not a complete
	// answer, and it never invents a continuation over lanes that cannot be
	// resumed. A caller that needs every match pins the lexical dimension.
	data.Page = fusedSearchPageData(page.Mode, page.Limit, fused.Components, len(data.Hits))
	if !search.FuseSucceeded(fused) {
		return degradedResult(env, started, data, fusedDegradedMessage(fused.Components,
			"all fused dimensions were unavailable; namespace, annotations, and restore are unaffected"))
	}
	if defaultBroker {
		for _, component := range fused.Components {
			if component.Status != string(command.StatusSucceeded) {
				// A ready semantic lane has no query to run for filter-only
				// requests. Only this explicitly non-failure skip is successful;
				// other skipped or unavailable states remain degraded.
				if component.Status == search.ComponentSkipped && component.Reason == search.QueryTextRequiredReason {
					continue
				}
				return degradedResult(env, started, data, fusedDegradedMessage(fused.Components,
					"one or more default search components are unavailable; available component results are still returned"))
			}
		}
	}
	return succeeded(env, started, data)
}

// fusedDegradedMessage preserves egress reasons and the one actionable
// semantic query input refusal while leaving other failures on the fallback.
// Egress authorization keeps priority over a query-specific message.
func fusedDegradedMessage(components []search.Component, fallback string) string {
	for _, component := range components {
		if component.Status == string(command.StatusSucceeded) {
			continue
		}
		if search.IsSemanticEgressReason(component.Reason) {
			return component.Dimension + " requires an egress authorization (" + component.Reason + "); " + fallback
		}
	}
	for _, component := range components {
		if component.Status != string(command.StatusSucceeded) && component.Dimension == search.DimensionSemantic &&
			component.Reason == search.SemanticQueryInputTruncatedReason {
			return "This query is too long for semantic search. Shorten it to use semantic search; available keyword and filter results are still shown."
		}
	}
	return fallback
}

func (d *Dispatcher) resolveFusedWorkspace(ctx context.Context, requested string, components []search.Component) (string, error) {
	workspaceID := strings.TrimSpace(requested)
	for _, component := range components {
		if component.Status != string(command.StatusSucceeded) {
			continue
		}
		generationID := strings.TrimSpace(component.GenerationID)
		if generationID == "" {
			return "", fmt.Errorf("fused component %q succeeded without an index generation", component.Dimension)
		}
		generation, err := d.store.GetIndexGeneration(ctx, generationID)
		if err != nil {
			return "", fmt.Errorf("resolve fused component %q generation: %w", component.Dimension, err)
		}
		// Query preserves compatibility with legacy generations whose dimension
		// field is empty; a non-empty value must still match the component.
		if (generation.Dimension != "" && generation.Dimension != component.Dimension) || strings.TrimSpace(generation.WorkspaceID) == "" {
			return "", fmt.Errorf("fused component %q generation binding is invalid", component.Dimension)
		}
		if workspaceID == "" {
			workspaceID = generation.WorkspaceID
			continue
		}
		if workspaceID != generation.WorkspaceID {
			return "", fmt.Errorf("fused component %q belongs to workspace %q, want %q", component.Dimension, generation.WorkspaceID, workspaceID)
		}
	}
	return workspaceID, nil
}

func (d *Dispatcher) authorizeHits(ctx context.Context, workspaceID, fallbackWorkspace string, hits []search.Hit, dimensions map[string][]string) []command.SearchHitData {
	rows, _ := d.authorizeHitsWithCanonicalSubjects(ctx, workspaceID, fallbackWorkspace, hits, dimensions)
	return rows
}

// authorizeHitsWithCanonicalSubjects keeps the existing authorization
// projection and records the canonical SubjectRef for each successfully
// resolved original hit in that same pass. The mapping is only an input to
// fused-result filtering; it is not an alternate authorization path.
func (d *Dispatcher) authorizeHitsWithCanonicalSubjects(ctx context.Context, workspaceID, fallbackWorkspace string, hits []search.Hit, dimensions map[string][]string) ([]command.SearchHitData, map[string]string) {
	return d.authorizeHitsWithCanonicalSubjectsAndLength(ctx, workspaceID, fallbackWorkspace, hits, dimensions, false)
}

// authorizePagedHitsWithCanonicalSubjects adds the already-authorized
// namespace entry's known length for paged SavedView use. Legacy callers keep
// the historical response shape through authorizeHitsWithCanonicalSubjects.
func (d *Dispatcher) authorizePagedHitsWithCanonicalSubjects(ctx context.Context, workspaceID, fallbackWorkspace string, hits []search.Hit, dimensions map[string][]string) ([]command.SearchHitData, map[string]string) {
	return d.authorizeHitsWithCanonicalSubjectsAndLength(ctx, workspaceID, fallbackWorkspace, hits, dimensions, true)
}

func (d *Dispatcher) authorizeHitsWithCanonicalSubjectsAndLength(ctx context.Context, workspaceID, fallbackWorkspace string, hits []search.Hit, dimensions map[string][]string, includeKnownRegularFileLength bool) ([]command.SearchHitData, map[string]string) {
	if workspaceID == "" {
		workspaceID = fallbackWorkspace
	}
	// Resolve and authorize every hit before projecting it.  Index status is a
	// read-only, best-effort projection; calculating it once for the resolved
	// set keeps the API result consistent without making search depend on a
	// disposable index or annotation read succeeding.
	type resolvedHit struct {
		hit         search.Hit
		entry       sqlite.NamespaceEntry
		displayPath string
	}
	resolved := make([]resolvedHit, 0, len(hits))
	canonicalBySource := make(map[string]string, len(hits))
	for _, hit := range hits {
		entry, err := d.resolveSubject(ctx, workspaceID, hit.SubjectID)
		if err != nil {
			continue
		}
		if entry.SubjectRef != "" {
			canonicalBySource[hit.SubjectID] = entry.SubjectRef
		}
		displayPath := strings.TrimSpace(hit.Path)
		if displayPath == "" {
			displayPath = d.namespaceDisplayPath(ctx, workspaceID, entry)
		}
		resolved = append(resolved, resolvedHit{hit: hit, entry: entry, displayPath: displayPath})
	}
	var statuses map[string]*command.ContentIndexStatus
	if len(resolved) > 0 && strings.TrimSpace(workspaceID) != "" {
		entries := make([]sqlite.NamespaceEntry, 0, len(resolved))
		for _, item := range resolved {
			entries = append(entries, item.entry)
		}
		// Search must remain usable when an optional annotation/index
		// projection is unavailable, so deliberately ignore this auxiliary
		// lookup's error and leave the field absent in that case.
		statuses, _ = d.contentIndexStatuses(ctx, workspaceID, entries)
	}
	authorized := make([]command.SearchHitData, 0, len(resolved))
	for _, item := range resolved {
		row := command.SearchHitData{
			SubjectRef:    item.entry.SubjectRef,
			EntryID:       item.entry.ID,
			Path:          item.displayPath,
			Name:          item.entry.DisplayName,
			EntryType:     string(item.entry.EntryType),
			ContentID:     item.entry.ContentID,
			ConstructAxes: item.hit.ConstructAxes,
			Dimensions:    dimensions[item.hit.SubjectID],
			Segments:      projectSearchSegments(item.hit.Segments),
			IndexStatus:   statuses[item.entry.SubjectRef],
		}
		if includeKnownRegularFileLength && item.entry.EntryType == sqlite.EntryFile && item.entry.LogicalSize != nil && *item.entry.LogicalSize >= 0 {
			size := *item.entry.LogicalSize
			row.LogicalSize = &size
		}
		authorized = append(authorized, row)
	}
	return authorized, canonicalBySource
}

func projectAuthorizedFusedOrder(authorized []command.SearchHitData, retained []search.FusedHit) []command.SearchHitData {
	firstBySubject := make(map[string]command.SearchHitData, len(authorized))
	for _, row := range authorized {
		if _, exists := firstBySubject[row.SubjectRef]; !exists {
			firstBySubject[row.SubjectRef] = row
		}
	}
	ordered := make([]command.SearchHitData, 0, len(retained))
	for _, hit := range retained {
		row, ok := firstBySubject[hit.SubjectID]
		if !ok {
			continue
		}
		row.SubjectRef = hit.SubjectID
		row.ConstructAxes = hit.ConstructAxes
		row.Dimensions = hit.Dimensions
		row.Segments = projectSearchSegments(hit.Segments)
		ordered = append(ordered, row)
	}
	return ordered
}

func (d *Dispatcher) namespaceDisplayPath(ctx context.Context, workspaceID string, entry sqlite.NamespaceEntry) string {
	parts := make([]string, 0, 8)
	seen := map[string]struct{}{}
	current := entry
	for current.ID != "" {
		if _, duplicate := seen[current.ID]; duplicate {
			break
		}
		seen[current.ID] = struct{}{}
		if current.DisplayName != "" {
			parts = append([]string{current.DisplayName}, parts...)
		}
		if current.ParentID == "" {
			break
		}
		parent, err := d.store.GetNamespaceEntry(ctx, workspaceID, current.ParentID)
		if err != nil || parent.RootID != entry.RootID {
			break
		}
		current = parent
	}
	return strings.Join(parts, "/")
}

func projectSearchSegments(segments []search.SegmentRef) []command.SearchSegmentData {
	if len(segments) == 0 {
		return nil
	}
	projected := make([]command.SearchSegmentData, 0, len(segments))
	for _, segment := range segments {
		projected = append(projected, command.SearchSegmentData{
			DescriptionDocumentID: segment.DescriptionDocumentID,
			SourceType:            segment.SourceType,
			SourceID:              segment.SourceID,
			SegmentID:             segment.SegmentID,
			Ordinal:               segment.Ordinal,
			MatchedText:           segment.MatchedText,
			Kind:                  segment.Kind,
			Producer:              segment.Producer,
			Accepted:              segment.Accepted,
			Language:              segment.Language,
			MatchedExcerpt:        matchedExcerpt(segment.MatchedText, segment.MatchSpans),
			MatchSpans:            projectMatchSpans(segment.MatchSpans),
			TextSourceProvenance:  projectTextSourceProvenance(segment.TextSourceProvenance),
		})
	}
	return projected
}

func projectTextSourceProvenance(provenance *search.TextSourceProvenance) *command.SearchTextSourceProvenanceData {
	if provenance == nil {
		return nil
	}
	return &command.SearchTextSourceProvenanceData{
		SourceRevision:            provenance.SourceRevision,
		BodyDigest:                provenance.BodyDigest,
		SegmentationProfileDigest: provenance.SegmentationProfileDigest,
		SourceStartByte:           provenance.SourceStartByte,
		SourceEndByte:             provenance.SourceEndByte,
		TextDigest:                provenance.TextDigest,
	}
}

func projectMatchSpans(spans []search.MatchSpan) []command.SearchMatchSpanData {
	if len(spans) == 0 {
		return nil
	}
	result := make([]command.SearchMatchSpanData, 0, len(spans))
	for _, span := range spans {
		result = append(result, command.SearchMatchSpanData{StartByte: span.StartByte, EndByte: span.EndByte})
	}
	return result
}

func matchedExcerpt(text string, spans []search.MatchSpan) string {
	if len(spans) == 0 {
		return ""
	}
	first := spans[0]
	for _, span := range spans {
		if span.StartByte < 0 || span.EndByte <= span.StartByte || span.EndByte > len(text) || !utf8.ValidString(text[:span.StartByte]) || !utf8.ValidString(text[:span.EndByte]) {
			return ""
		}
		if span.StartByte < first.StartByte {
			first = span
		}
	}
	start := first.StartByte
	for n := 0; n < 24 && start > 0; n++ {
		_, size := utf8.DecodeLastRuneInString(text[:start])
		start -= size
	}
	// A highlighted token may itself be a very long Han/Latin run. Keep the
	// query-derived excerpt bounded while retaining the complete source above.
	end := first.StartByte
	for n := 0; n < 64 && end < first.EndByte; n++ {
		_, size := utf8.DecodeRuneInString(text[end:])
		end += size
	}
	for n := 0; n < 24 && end < len(text); n++ {
		_, size := utf8.DecodeRuneInString(text[end:])
		end += size
	}
	excerpt := text[start:end]
	if start > 0 {
		excerpt = "…" + excerpt
	}
	if end < len(text) {
		excerpt += "…"
	}
	return excerpt
}

func (d *Dispatcher) upsertTag(ctx context.Context, input annotationUpsertInput) (sqlite.Annotation, error) {
	existing, err := d.store.FindLiveTag(ctx, input.WorkspaceID, input.SubjectRef, input.Body)
	if err == nil {
		return existing, nil
	}
	if !containsNotFound(err) {
		return sqlite.Annotation{}, err
	}
	if input.ExpectedRevision != 0 {
		return sqlite.Annotation{}, sqlite.ErrConflict
	}
	id, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
	if err != nil {
		return sqlite.Annotation{}, err
	}
	record := &sqlite.Annotation{
		ID:          id,
		WorkspaceID: input.WorkspaceID,
		SubjectRef:  input.SubjectRef,
		Kind:        sqlite.AnnotationTag,
		Body:        input.Body,
		Revision:    1,
	}
	if err := d.store.CreateAnnotation(ctx, record); err != nil {
		return sqlite.Annotation{}, err
	}
	return *record, nil
}

func (d *Dispatcher) upsertNote(ctx context.Context, input annotationUpsertInput) (sqlite.Annotation, error) {
	if input.AnnotationID == "" {
		if input.ExpectedRevision != 0 {
			return sqlite.Annotation{}, sqlite.ErrConflict
		}
		id, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
		if err != nil {
			return sqlite.Annotation{}, err
		}
		record := &sqlite.Annotation{
			ID:          id,
			WorkspaceID: input.WorkspaceID,
			SubjectRef:  input.SubjectRef,
			Kind:        sqlite.AnnotationNote,
			Body:        input.Body,
			Revision:    1,
		}
		if err := d.store.CreateAnnotation(ctx, record); err != nil {
			return sqlite.Annotation{}, err
		}
		return *record, nil
	}
	if err := requireStableID("annotation_id", input.AnnotationID); err != nil {
		return sqlite.Annotation{}, err
	}
	existing, err := d.store.GetAnnotation(ctx, input.WorkspaceID, input.AnnotationID)
	if err != nil {
		return sqlite.Annotation{}, err
	}
	if existing.Kind != sqlite.AnnotationNote || existing.Tombstoned {
		return sqlite.Annotation{}, sqlite.ErrNotFound
	}
	updatedAt := time.Now().UTC()
	if err := d.store.ReviseAnnotation(ctx, input.WorkspaceID, input.AnnotationID, input.ExpectedRevision, input.Body, false, updatedAt); err != nil {
		return sqlite.Annotation{}, err
	}
	return sqlite.Annotation{
		ID: input.AnnotationID, WorkspaceID: input.WorkspaceID,
		SubjectRef: existing.SubjectRef, Kind: sqlite.AnnotationNote,
		Body: input.Body, BodyDigest: annotationBodyDigest(input.Body),
		Revision: input.ExpectedRevision + 1, PredecessorRevision: input.ExpectedRevision,
		CreatedAt: existing.CreatedAt, UpdatedAt: updatedAt,
	}, nil
}

func (d *Dispatcher) upsertProgress(ctx context.Context, input annotationUpsertInput) (sqlite.Annotation, error) {
	existing, err := d.store.FindLiveProgress(ctx, input.WorkspaceID, input.SubjectRef)
	if err == nil {
		expected := input.ExpectedRevision
		if expected == 0 {
			expected = existing.Revision
		}
		updatedAt := time.Now().UTC()
		if err := d.store.ReviseAnnotation(ctx, input.WorkspaceID, existing.ID, expected, input.Body, false, updatedAt); err != nil {
			return sqlite.Annotation{}, err
		}
		return sqlite.Annotation{
			ID: existing.ID, WorkspaceID: existing.WorkspaceID,
			SubjectRef: existing.SubjectRef, Kind: sqlite.AnnotationProgress,
			Body: input.Body, BodyDigest: annotationBodyDigest(input.Body),
			Revision: expected + 1, PredecessorRevision: expected,
			CreatedAt: existing.CreatedAt, UpdatedAt: updatedAt,
		}, nil
	}
	if !containsNotFound(err) {
		return sqlite.Annotation{}, err
	}
	if input.ExpectedRevision != 0 {
		return sqlite.Annotation{}, sqlite.ErrConflict
	}
	id := input.AnnotationID
	if id == "" {
		id, err = sqlite.NewStableID(sqlite.IDPrefixAnnotation)
		if err != nil {
			return sqlite.Annotation{}, err
		}
	} else if err := requireStableID("annotation_id", id); err != nil {
		return sqlite.Annotation{}, err
	}
	record := &sqlite.Annotation{
		ID:          id,
		WorkspaceID: input.WorkspaceID,
		SubjectRef:  input.SubjectRef,
		Kind:        sqlite.AnnotationProgress,
		Body:        input.Body,
		Revision:    1,
	}
	if err := d.store.CreateAnnotation(ctx, record); err != nil {
		return sqlite.Annotation{}, err
	}
	return *record, nil
}

func (d *Dispatcher) rebuildSearch(ctx context.Context, workspaceID string) error {
	if d.search == nil {
		return nil
	}
	_, err := d.search.RebuildLatestLexical(ctx, workspaceID)
	return err
}

func annotationWriteResult(env command.Envelope, started time.Time, err error) command.Result {
	if containsNotFound(err) {
		return notFoundResult(env, started, "annotation not found")
	}
	if errors.Is(err, sqlite.ErrConflict) {
		return conflictResult(env, started, "annotation revision conflict")
	}
	return catalogErrorResult(env, started, err)
}

func projectAnnotations(records []sqlite.Annotation) []command.AnnotationData {
	projected := make([]command.AnnotationData, 0, len(records))
	for _, record := range records {
		projected = append(projected, projectAnnotation(record))
	}
	return projected
}

func projectAnnotation(record sqlite.Annotation) command.AnnotationData {
	return command.AnnotationData{
		ID:                  record.ID,
		WorkspaceID:         record.WorkspaceID,
		SubjectRef:          record.SubjectRef,
		Kind:                string(record.Kind),
		Body:                record.Body,
		BodyDigest:          record.BodyDigest,
		Revision:            record.Revision,
		PredecessorRevision: record.PredecessorRevision,
		Tombstoned:          record.Tombstoned,
		CreatedAt:           record.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:           record.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func parseSearchRequest(input searchQueryInput) (text, dimension string, axes, fuse []string, filters search.Filters) {
	text, nestedDimension, nestedAxes, nestedFuse, nestedFilters := parseSearchQueryObject(input.Query)
	dimension = strings.TrimSpace(input.Dimension)
	if dimension == "" {
		dimension = nestedDimension
	}
	axes = append([]string(nil), input.Axes...)
	if len(axes) == 0 {
		axes = nestedAxes
	}
	fuse = append([]string(nil), input.Fuse...)
	if len(fuse) == 0 {
		fuse = nestedFuse
	}
	filters = input.Filters
	if !filters.Has() {
		filters = nestedFilters
	}
	return text, dimension, axes, fuse, filters
}

func parseSearchQueryObject(raw json.RawMessage) (text, dimension string, axes, fuse []string, filters search.Filters) {
	if len(raw) == 0 {
		return "", "", nil, nil, search.Filters{}
	}
	if err := json.Unmarshal(raw, &text); err == nil {
		return strings.TrimSpace(text), "", nil, nil, search.Filters{}
	}
	var nested struct {
		Text        string         `json:"text"`
		Fingerprint string         `json:"fingerprint"`
		Relation    string         `json:"relation"`
		Value       string         `json:"value"`
		Dimension   string         `json:"dimension"`
		Axes        []string       `json:"construct_axes"`
		Fuse        []string       `json:"fuse"`
		Filters     search.Filters `json:"filters"`
	}
	if err := json.Unmarshal(raw, &nested); err == nil {
		text := strings.TrimSpace(nested.Text)
		if text == "" {
			text = strings.TrimSpace(nested.Fingerprint)
		}
		if text == "" && strings.TrimSpace(nested.Relation) != "" {
			text = strings.TrimSpace(nested.Relation) + ":" + strings.TrimSpace(nested.Value)
		}
		return text, strings.TrimSpace(nested.Dimension), nested.Axes, nested.Fuse, nested.Filters
	}
	return "", "", nil, nil, search.Filters{}
}
