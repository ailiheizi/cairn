package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ailiheizi/cairn/client/command"
	cairnconfig "github.com/ailiheizi/cairn/config"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

const (
	descriptionSegmentMaxBytes  = 1024
	descriptionMaxBodyBytes     = 16 << 20
	descriptionListDefaultLimit = 100
	descriptionListMaxLimit     = 1000
)

type descriptionListInput struct {
	WorkspaceID string `json:"workspace_id"`
	SubjectRef  string `json:"subject_ref,omitempty"`
	Limit       int    `json:"limit,omitempty"`
}

type descriptionGetInput struct {
	WorkspaceID string `json:"workspace_id"`
	DocumentID  string `json:"description_document_id"`
}

type descriptionCreateInput struct {
	WorkspaceID     string          `json:"workspace_id"`
	SubjectRef      string          `json:"subject_ref"`
	Kind            string          `json:"kind"`
	Title           string          `json:"title,omitempty"`
	Language        string          `json:"language,omitempty"`
	Body            string          `json:"body"`
	SourceRef       string          `json:"source_ref,omitempty"`
	ProducerProfile string          `json:"producer_profile,omitempty"`
	Confidence      *float64        `json:"confidence,omitempty"`
	Coverage        *float64        `json:"coverage,omitempty"`
	Visibility      string          `json:"visibility,omitempty"`
	Accepted        bool            `json:"accepted,omitempty"`
	PredecessorID   string          `json:"predecessor_id,omitempty"`
	Metadata        json.RawMessage `json:"metadata,omitempty"`
}

func (d *Dispatcher) handleDescriptionList(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input descriptionListInput
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
	limit := input.Limit
	if limit == 0 {
		limit = descriptionListDefaultLimit
	}
	if limit < 1 || limit > descriptionListMaxLimit {
		return invalidInputResult(env, started, fmt.Errorf("limit must be between 1 and %d", descriptionListMaxLimit))
	}
	documents, err := d.store.ListDescriptionSummaries(ctx, input.WorkspaceID, input.SubjectRef, limit+1)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	truncated := len(documents) > limit
	if len(documents) > limit {
		documents = documents[:limit]
	}
	projected := make([]command.DescriptionSummaryData, 0, len(documents))
	for _, document := range documents {
		projected = append(projected, projectDescriptionSummary(document))
	}
	return succeeded(env, started, command.DescriptionListData{Documents: projected, Truncated: truncated})
}

func (d *Dispatcher) handleDescriptionGet(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input descriptionGetInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("description_document_id", input.DocumentID); err != nil {
		return invalidInputResult(env, started, err)
	}
	document, err := d.store.GetDescriptionDocument(ctx, input.WorkspaceID, input.DocumentID)
	if err != nil {
		if containsNotFound(err) {
			return notFoundResult(env, started, "description document not found")
		}
		return catalogErrorResult(env, started, err)
	}
	segments, err := d.store.ListSemanticSegments(ctx, input.WorkspaceID, input.DocumentID)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	return succeeded(env, started, command.DescriptionGetData{Document: projectDescription(document, segments)})
}

func (d *Dispatcher) handleDescriptionCreate(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input descriptionCreateInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if _, err := d.store.GetWorkspace(ctx, input.WorkspaceID); err != nil {
		if containsNotFound(err) {
			return notFoundResult(env, started, "workspace not found")
		}
		return catalogErrorResult(env, started, err)
	}
	if err := requireStableID("subject_ref", input.SubjectRef); err != nil {
		return invalidInputResult(env, started, err)
	}
	entry, err := d.resolveSubject(ctx, input.WorkspaceID, input.SubjectRef)
	if err != nil {
		if containsNotFound(err) {
			return notFoundResult(env, started, "subject not found")
		}
		return catalogErrorResult(env, started, err)
	}
	input.SubjectRef = entry.SubjectRef
	if strings.TrimSpace(input.Body) == "" {
		return invalidInputResult(env, started, errString("body is required"))
	}
	if len(input.Body) > descriptionMaxBodyBytes {
		return invalidInputResult(env, started, fmt.Errorf("body exceeds maximum size of %d bytes", descriptionMaxBodyBytes))
	}
	if !utf8.ValidString(input.Body) {
		return invalidInputResult(env, started, errString("body must be valid UTF-8"))
	}
	kind := sqlite.DescriptionKind(strings.ToUpper(strings.TrimSpace(input.Kind)))
	if !validDescriptionKind(kind) {
		return invalidInputResult(env, started, errString("kind must be USER, IMPORTED, EXTRACTED, AI_SUMMARY, or AI_ANALYSIS"))
	}
	if err := validateDescriptionRange("confidence", input.Confidence); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := validateDescriptionRange("coverage", input.Coverage); err != nil {
		return invalidInputResult(env, started, err)
	}
	return d.admitDescriptionRevision(ctx, env, started, descriptionAdmission{
		WorkspaceID:     input.WorkspaceID,
		SubjectRef:      input.SubjectRef,
		Kind:            kind,
		Title:           input.Title,
		Language:        input.Language,
		Body:            input.Body,
		SourceRef:       strings.TrimSpace(input.SourceRef),
		ProducerProfile: strings.TrimSpace(input.ProducerProfile),
		Confidence:      input.Confidence,
		Coverage:        input.Coverage,
		Visibility:      input.Visibility,
		Accepted:        input.Accepted,
		PredecessorID:   input.PredecessorID,
		Metadata:        input.Metadata,
	})
}

// descriptionAdmission is one validated description revision waiting for the
// shared admission path. description.create and description.generate both
// admit through admitDescriptionRevision, so a generated candidate becomes
// exactly the same immutable revision shape a caller-supplied body does.
type descriptionAdmission struct {
	WorkspaceID     string
	SubjectRef      string
	Kind            sqlite.DescriptionKind
	Title           string
	Language        string
	Body            string
	SourceRef       string
	ProducerProfile string
	// ProducerProfileDigest overrides the derived digest of the producer
	// profile string. The describe operation passes the immutable profile
	// document digest so the admitted revision names the exact profile that
	// produced it.
	ProducerProfileDigest string
	Confidence            *float64
	Coverage              *float64
	Visibility            string
	Accepted              bool
	PredecessorID         string
	Metadata              json.RawMessage
}

// admitDescriptionRevision is the single admission path for description
// revisions: predecessor validation, immutable revision construction, ordered
// segment splitting, the transactional insert, and the post-write search
// rebuild (DEGRADED on rebuild failure).
func (d *Dispatcher) admitDescriptionRevision(ctx context.Context, env command.Envelope, started time.Time, admission descriptionAdmission) command.Result {
	revision := int64(1)
	if admission.PredecessorID != "" {
		if err := requireStableID("predecessor_id", admission.PredecessorID); err != nil {
			return invalidInputResult(env, started, err)
		}
		predecessor, err := d.store.GetDescriptionDocument(ctx, admission.WorkspaceID, admission.PredecessorID)
		if err != nil {
			return invalidInputResult(env, started, fmt.Errorf("predecessor_id is invalid: %w", err))
		}
		if predecessor.SubjectRef != admission.SubjectRef {
			return invalidInputResult(env, started, errString("predecessor_id belongs to a different subject"))
		}
		if predecessor.Kind != admission.Kind {
			return invalidInputResult(env, started, errString("predecessor_id belongs to a different description kind"))
		}
		revision = predecessor.Revision + 1
	}

	documentID, err := sqlite.NewStableID(sqlite.IDPrefixDescription)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	document := &sqlite.DescriptionDocument{
		ID:              documentID,
		WorkspaceID:     admission.WorkspaceID,
		SubjectRef:      admission.SubjectRef,
		Kind:            admission.Kind,
		Title:           admission.Title,
		Language:        admission.Language,
		Body:            admission.Body,
		SourceRef:       admission.SourceRef,
		ProducerProfile: admission.ProducerProfile,
		ConfigDigest:    d.effectiveConfigDigest(),
		Confidence:      admission.Confidence,
		Coverage:        admission.Coverage,
		Visibility:      admission.Visibility,
		Accepted:        admission.Accepted,
		Revision:        revision,
		PredecessorID:   admission.PredecessorID,
		Metadata:        admission.Metadata,
	}
	if document.SourceRef == "" {
		document.SourceRef = "command:description.create"
	}
	if document.ProducerProfile == "" {
		document.ProducerProfile = "command"
	}
	if admission.ProducerProfileDigest != "" {
		document.ProducerProfileDigest = admission.ProducerProfileDigest
	} else {
		document.ProducerProfileDigest = sqlite.DescriptionProducerProfileDigest(document.ProducerProfile)
	}
	chunks := splitDescriptionBody(document.Body)
	segments := make([]sqlite.SemanticSegment, 0, len(chunks))
	for ordinal, chunk := range chunks {
		segmentID, idErr := sqlite.NewStableID(sqlite.IDPrefixSemanticSegment)
		if idErr != nil {
			return catalogErrorResult(env, started, idErr)
		}
		span, marshalErr := json.Marshal(descriptionSourceSpan{StartByte: chunk.start, EndByte: chunk.end})
		if marshalErr != nil {
			return catalogErrorResult(env, started, marshalErr)
		}
		segments = append(segments, sqlite.SemanticSegment{
			ID:                        segmentID,
			WorkspaceID:               document.WorkspaceID,
			DocumentID:                document.ID,
			SubjectRef:                document.SubjectRef,
			DocumentRevision:          document.Revision,
			Ordinal:                   int64(ordinal),
			Text:                      chunk.text,
			Language:                  document.Language,
			Section:                   "body",
			SourceSpan:                span,
			SegmentationProfileDigest: sqlite.DescriptionSegmentationProfileDigestV1,
		})
	}
	if err := d.store.Update(ctx, func(tx *sqlite.Tx) error {
		if err := tx.InsertDescriptionDocument(ctx, document); err != nil {
			return err
		}
		for i := range segments {
			if err := tx.InsertSemanticSegment(ctx, &segments[i]); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return descriptionWriteResult(env, started, err)
	}
	if rebuildErr := d.rebuildSearch(ctx, admission.WorkspaceID); rebuildErr != nil {
		return degradedResult(env, started, command.DescriptionCreateData{Document: projectDescription(*document, segments)}, "description saved, but search index is unavailable: "+rebuildErr.Error())
	}
	return succeeded(env, started, command.DescriptionCreateData{Document: projectDescription(*document, segments)})
}

func projectDescriptionSummary(document sqlite.DescriptionDocument) command.DescriptionSummaryData {
	return command.DescriptionSummaryData{
		ID:                    document.ID,
		WorkspaceID:           document.WorkspaceID,
		SubjectRef:            document.SubjectRef,
		Kind:                  string(document.Kind),
		Title:                 document.Title,
		Language:              document.Language,
		BodyDigest:            document.BodyDigest,
		SourceRef:             document.SourceRef,
		ProducerProfile:       document.ProducerProfile,
		ConfigDigest:          document.ConfigDigest,
		ProducerProfileDigest: document.ProducerProfileDigest,
		Confidence:            document.Confidence,
		Coverage:              document.Coverage,
		Visibility:            document.Visibility,
		Accepted:              document.Accepted,
		Revision:              document.Revision,
		PredecessorID:         document.PredecessorID,
		CreatedAt:             document.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:             document.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func projectDescription(document sqlite.DescriptionDocument, segments []sqlite.SemanticSegment) command.DescriptionDocumentData {
	projectedSegments := make([]command.SemanticSegmentData, 0, len(segments))
	for _, segment := range segments {
		projectedSegments = append(projectedSegments, command.SemanticSegmentData{
			ID:                        segment.ID,
			WorkspaceID:               segment.WorkspaceID,
			DocumentID:                segment.DocumentID,
			SubjectRef:                segment.SubjectRef,
			DocumentRevision:          segment.DocumentRevision,
			Ordinal:                   segment.Ordinal,
			Text:                      segment.Text,
			TextDigest:                segment.TextDigest,
			Language:                  segment.Language,
			Section:                   segment.Section,
			SourceSpan:                segment.SourceSpan,
			Metadata:                  segment.Metadata,
			SegmentationProfileDigest: segment.SegmentationProfileDigest,
			CreatedAt:                 segment.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return command.DescriptionDocumentData{
		ID:                    document.ID,
		WorkspaceID:           document.WorkspaceID,
		SubjectRef:            document.SubjectRef,
		Kind:                  string(document.Kind),
		Title:                 document.Title,
		Language:              document.Language,
		Body:                  document.Body,
		BodyDigest:            document.BodyDigest,
		SourceRef:             document.SourceRef,
		ProducerProfile:       document.ProducerProfile,
		ConfigDigest:          document.ConfigDigest,
		ProducerProfileDigest: document.ProducerProfileDigest,
		Confidence:            document.Confidence,
		Coverage:              document.Coverage,
		Visibility:            document.Visibility,
		Accepted:              document.Accepted,
		Revision:              document.Revision,
		PredecessorID:         document.PredecessorID,
		Metadata:              document.Metadata,
		CreatedAt:             document.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:             document.UpdatedAt.UTC().Format(time.RFC3339),
		Segments:              projectedSegments,
	}
}

type descriptionSourceSpan struct {
	StartByte int `json:"start_byte"`
	EndByte   int `json:"end_byte"`
}

type descriptionChunk struct {
	start int
	end   int
	text  string
}

// splitDescriptionBody makes contiguous chunks at UTF-8 rune boundaries. A
// natural whitespace or sentence boundary is preferred within the byte cap;
// the exact source bytes are retained in each chunk so spans are verifiable.
func splitDescriptionBody(body string) []descriptionChunk {
	chunks := make([]descriptionChunk, 0, 1)
	for start := 0; start < len(body); {
		remaining := len(body) - start
		end := len(body)
		if remaining > descriptionSegmentMaxBytes {
			end = start + descriptionSegmentMaxBytes
			for end > start && !utf8.RuneStart(body[end]) {
				end--
			}
			preferred := end
			for cursor := end; cursor > start; {
				runeValue, size := utf8.DecodeLastRuneInString(body[start:cursor])
				if unicode.IsSpace(runeValue) || strings.ContainsRune(".!?。！？", runeValue) {
					preferred = cursor
					break
				}
				cursor -= size
			}
			if preferred > start {
				end = preferred
			}
		}
		if end <= start {
			_, size := utf8.DecodeRuneInString(body[start:])
			end = start + size
		}
		chunks = append(chunks, descriptionChunk{start: start, end: end, text: body[start:end]})
		start = end
	}
	// A long whitespace run can otherwise become a rejected, whitespace-only
	// segment. Attach such runs to an adjacent meaningful segment while
	// preserving contiguous source spans.
	meaningful := make([]descriptionChunk, 0, len(chunks))
	for i := range chunks {
		chunk := chunks[i]
		if strings.TrimSpace(chunk.text) != "" {
			meaningful = append(meaningful, chunk)
			continue
		}
		if len(meaningful) > 0 {
			previous := &meaningful[len(meaningful)-1]
			previous.end = chunk.end
			previous.text = body[previous.start:previous.end]
			continue
		}
		if i+1 < len(chunks) {
			chunks[i+1].start = chunk.start
			chunks[i+1].text = body[chunks[i+1].start:chunks[i+1].end]
		}
	}
	return meaningful
}

func validDescriptionKind(kind sqlite.DescriptionKind) bool {
	switch kind {
	case sqlite.DescriptionUser, sqlite.DescriptionImported, sqlite.DescriptionExtracted,
		sqlite.DescriptionAISummary, sqlite.DescriptionAIAnalysis:
		return true
	default:
		return false
	}
}

func validateDescriptionRange(name string, value *float64) error {
	if value != nil && (*value < 0 || *value > 1) {
		return fmt.Errorf("%s must be between 0 and 1", name)
	}
	return nil
}

func descriptionWriteResult(env command.Envelope, started time.Time, err error) command.Result {
	if containsNotFound(err) {
		return notFoundResult(env, started, "description predecessor or workspace not found")
	}
	if errors.Is(err, sqlite.ErrConflict) {
		return conflictResult(env, started, "description revision conflict")
	}
	if strings.Contains(err.Error(), "description_documents_predecessor_idx") ||
		strings.Contains(err.Error(), "description_documents.workspace_id, description_documents.predecessor_id") {
		return conflictResult(env, started, "description predecessor already has a successor")
	}
	return catalogErrorResult(env, started, err)
}

// On-demand description generation (DESCRIBE_SUBJECT)
//
// description.generate is the host-side DESCRIBE_SUBJECT operation. It never
// runs a model implicitly: the caller names one subject, the daemon resolves
// the configured describe profile, and only a healthy profile plus a live
// egress grant plus (by default) an explicit per-request confirmation can
// produce one candidate. The candidate stays untrusted evidence until this
// host validates it and admits it through the same immutable revision path
// description.create uses; the model can never mark its own revision
// user-accepted. A generation request without a selected healthy profile
// returns DESCRIPTION_PROVIDER_UNAVAILABLE and does not alter the document or
// semantic-index state; an egress refusal returns the daemon's typed EGRESS_*
// reason and changes nothing either.

const (
	// ReasonDescriptionProviderUnavailable is the typed reason the
	// content-store contract names for a generation request without a
	// selected healthy provider profile.
	ReasonDescriptionProviderUnavailable = "DESCRIPTION_PROVIDER_UNAVAILABLE"
	// ReasonDescriptionCandidateRejected names a candidate the host refused
	// to admit after validation. It is visible, typed, and never silently
	// retried.
	ReasonDescriptionCandidateRejected = "DESCRIPTION_CANDIDATE_REJECTED"
)

// descriptionGenerateInput is the strict description.generate input.
type descriptionGenerateInput struct {
	WorkspaceID string `json:"workspace_id"`
	SubjectRef  string `json:"subject_ref"`
	Kind        string `json:"kind"`
	Language    string `json:"language,omitempty"`
	Title       string `json:"title,omitempty"`
	// EgressConfirmation stays raw so the optional confirmation object can be
	// strict-decoded below: a partial or unknown-field confirmation is
	// refused, never silently normalized.
	EgressConfirmation json.RawMessage `json:"egress_confirmation,omitempty"`
}

// describeEgressConfirmationInput is the wire form of one per-request
// authorization. It binds the disclosure to an installed describe profile, its
// destination host, model, the DESCRIBE purpose, and the live grant; the
// daemon fills the content digest because only the daemon assembles the exact
// inputs.
type describeEgressConfirmationInput struct {
	ProfileID     string `json:"profile_id,omitempty"`
	ProfileDigest string `json:"profile_digest,omitempty"`
	EndpointHost  string `json:"endpoint_host,omitempty"`
	Model         string `json:"model,omitempty"`
	Purpose       string `json:"purpose,omitempty"`
	GrantID       string `json:"grant_id"`
}

// describeEgressConfirmationFromInput strictly decodes the optional
// confirmation object. A partial confirmation is refused rather than silently
// ignored: the operator either authorizes this exact disclosure or does not.
func describeEgressConfirmationFromInput(raw json.RawMessage) (*search.SemanticEgressConfirmation, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, nil
	}
	var input describeEgressConfirmationInput
	if err := decodeStrictOperationInput(raw, &input); err != nil {
		return nil, fmt.Errorf("egress_confirmation: %w", err)
	}
	confirmation := &search.SemanticEgressConfirmation{
		ProviderProfileID: strings.TrimSpace(input.ProfileID),
		ProfileDigest:     strings.TrimSpace(input.ProfileDigest),
		EndpointHost:      strings.TrimSpace(input.EndpointHost),
		ModelID:           strings.TrimSpace(input.Model),
		GrantID:           strings.TrimSpace(input.GrantID),
	}
	if confirmation.GrantID == "" {
		return nil, errors.New("egress_confirmation.grant_id is required")
	}
	if confirmation.ProviderProfileID == "" && confirmation.ProfileDigest == "" {
		return nil, errors.New("egress_confirmation must name profile_id or profile_digest")
	}
	if confirmation.EndpointHost == "" {
		return nil, errors.New("egress_confirmation must name endpoint_host")
	}
	if confirmation.ModelID == "" {
		return nil, errors.New("egress_confirmation.model is required")
	}
	if strings.ToUpper(strings.TrimSpace(input.Purpose)) != search.EgressPurposeDescribe {
		return nil, fmt.Errorf("egress_confirmation.purpose must be %s", search.EgressPurposeDescribe)
	}
	confirmation.Purpose = search.SemanticEmbeddingPurpose(search.EgressPurposeDescribe)
	return confirmation, nil
}

// resolvedDescriptions reads the persisted operator profile's descriptions
// section. It re-reads the file so a config.update followed by a generate
// request observes the operator's saved selection; the running services are
// still those the daemon started with, which is exactly what the health gates
// below compare against.
func (s *operatorConfigState) resolvedDescriptions() cairnconfig.DescriptionConfig {
	if s == nil {
		return cairnconfig.DescriptionConfig{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	resolved, err := cairnconfig.LoadEffective(cairnconfig.LoadOptions{
		Path:           s.path,
		ResolveOptions: cairnconfig.ResolveOptions{Environ: map[string]string{}},
	})
	if err != nil {
		return cairnconfig.DescriptionConfig{}
	}
	return resolved.Config.Descriptions
}

// handleDescriptionGenerate runs one explicit, on-demand DESCRIBE_SUBJECT
// operation for one subject.
func (d *Dispatcher) handleDescriptionGenerate(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input descriptionGenerateInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if _, err := d.store.GetWorkspace(ctx, input.WorkspaceID); err != nil {
		if containsNotFound(err) {
			return notFoundResult(env, started, "workspace not found")
		}
		return catalogErrorResult(env, started, err)
	}
	if err := requireStableID("subject_ref", input.SubjectRef); err != nil {
		return invalidInputResult(env, started, err)
	}
	entry, err := d.resolveSubject(ctx, input.WorkspaceID, input.SubjectRef)
	if err != nil {
		if containsNotFound(err) {
			return notFoundResult(env, started, "subject not found")
		}
		return catalogErrorResult(env, started, err)
	}
	kind := sqlite.DescriptionKind(strings.ToUpper(strings.TrimSpace(input.Kind)))
	switch kind {
	case sqlite.DescriptionAISummary, sqlite.DescriptionAIAnalysis:
	default:
		return invalidInputResult(env, started, errString("kind must be AI_SUMMARY or AI_ANALYSIS"))
	}
	// (a) a configured, healthy provider. Everything in this block is a
	// profile-health fact: the honest outcome is
	// DESCRIPTION_PROVIDER_UNAVAILABLE with no document or index change.
	provider := d.describeProvider
	if provider == nil {
		return d.descriptionProviderUnavailable(env, started, "no description provider is configured; select descriptions.provider_profile and restart the daemon")
	}
	if d.operatorConfig != nil {
		descriptions := d.operatorConfig.resolvedDescriptions()
		if descriptions.ProviderProfile != "" && descriptions.ProviderProfile != provider.Profile().ProfileID {
			return d.descriptionProviderUnavailable(env, started,
				fmt.Sprintf("the configured profile %q does not match the loaded provider profile %q", descriptions.ProviderProfile, provider.Profile().ProfileID))
		}
		if strings.TrimSpace(descriptions.CredentialRef) != "" && descriptions.CredentialRef != provider.Profile().CredentialRef {
			return d.descriptionProviderUnavailable(env, started,
				"descriptions.credential_ref does not match the installed describe profile's credential_ref")
		}
	}
	if err := provider.CheckDescribeReadiness(ctx); err != nil {
		return d.descriptionProviderUnavailable(env, started, err.Error())
	}
	profile := provider.Profile()
	// (b) assemble the gated input from admitted facts only: the subject's
	// admitted EXTRACT text artifacts and — only when the profile declares the
	// image.bytes class — the subject's admitted image bytes. Private notes
	// and other descriptions are never sent.
	textContexts, err := d.describeTextContexts(ctx, input.WorkspaceID, entry.SubjectRef)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	var image *search.DescribeImagePart
	if profile.Egress.CoversDataClass(search.EgressDataClassImageBytes) {
		image, err = d.describeImagePart(ctx, entry)
		if err != nil {
			return catalogErrorResult(env, started, err)
		}
	}
	if len(textContexts) == 0 && image == nil {
		return invalidInputResult(env, started, errString(
			"the subject has no admitted extract text and no disclosable image; there is nothing to describe"))
	}
	// (c) per-request confirmation. The client resolves the live grant list
	// and names the covering grant; the daemon binds the content digest.
	confirmation, err := describeEgressConfirmationFromInput(input.EgressConfirmation)
	if err != nil {
		return invalidInputResult(env, started, err)
	}
	if confirmation != nil {
		ctx = search.WithSemanticEgressConfirmation(ctx, *confirmation)
	}
	// (d) call the provider. Every failure from here on is the daemon's typed
	// egress reason or a candidate validation failure; no document or index
	// state changes.
	request := search.DescribeRequest{
		SubjectID:    entry.SubjectRef,
		Kind:         string(kind),
		Language:     strings.TrimSpace(input.Language),
		TextContexts: textContexts,
		Image:        image,
	}
	result, err := provider.Describe(ctx, request)
	if err != nil {
		return descriptionEgressResult(env, started, err)
	}
	// (e) validate the untrusted candidate before admission: UTF-8, size cap,
	// non-empty, no control characters. The provider applies the same checks;
	// the host re-checks because only the host admits.
	body := result.Text
	if strings.TrimSpace(body) == "" {
		return failed(env, started, newReason(ReasonDescriptionCandidateRejected, "the candidate description is empty"))
	}
	if int64(len(body)) > descriptionMaxBodyBytes || int64(len(body)) > profile.MaxOutputBytes {
		return failed(env, started, newReason(ReasonDescriptionCandidateRejected,
			fmt.Sprintf("the candidate description exceeds the %d byte cap", min64(int64(profile.MaxOutputBytes), descriptionMaxBodyBytes))))
	}
	if !utf8.ValidString(body) {
		return failed(env, started, newReason(ReasonDescriptionCandidateRejected, "the candidate description is not valid UTF-8"))
	}
	if err := search.ValidateDescribeCandidateText(body); err != nil {
		return failed(env, started, newReason(ReasonDescriptionCandidateRejected, err.Error()))
	}
	// (f) admit the candidate as a new immutable, non-accepted revision
	// through the same path description.create uses. The producer identity is
	// the describe profile, and the metadata records the egress evidence by
	// digest only.
	metadata, marshalErr := json.Marshal(map[string]any{
		"describe": map[string]any{
			"profile_id":     profile.ProfileID,
			"profile_digest": profile.ProviderProfileDigest(),
			"model_id":       profile.ModelID,
			"model_revision": profile.ModelRevision,
			"purpose":        search.EgressPurposeDescribe,
			"grant_id":       result.GrantID,
			"request_digest": result.RequestDigest,
			"output_digest":  result.OutputDigest,
			"finish_reason":  result.FinishReason,
			"data_classes":   result.DataClasses,
			"output_schema":  search.OnlineDescribeOutputSchema,
		},
	})
	if marshalErr != nil {
		return catalogErrorResult(env, started, marshalErr)
	}
	title := strings.TrimSpace(input.Title)
	if title == "" && kind == sqlite.DescriptionAIAnalysis {
		title = "AI analysis"
	}
	return d.admitDescriptionRevision(ctx, env, started, descriptionAdmission{
		WorkspaceID:           input.WorkspaceID,
		SubjectRef:            entry.SubjectRef,
		Kind:                  kind,
		Title:                 title,
		Language:              strings.TrimSpace(input.Language),
		Body:                  body,
		SourceRef:             "provider:describe:" + profile.ProfileID,
		ProducerProfile:       profile.ProfileID,
		ProducerProfileDigest: profile.ProviderProfileDigest(),
		Accepted:              false,
		Metadata:              metadata,
	})
}

// descriptionProviderUnavailable returns the contract's typed honest outcome
// for a generation request without a selected healthy profile.
func (d *Dispatcher) descriptionProviderUnavailable(env command.Envelope, started time.Time, detail string) command.Result {
	return failed(env, started, newReason(ReasonDescriptionProviderUnavailable, detail))
}

// descriptionEgressResult maps a provider failure onto the honest result: a
// typed egress reason keeps its stable EGRESS_* code; anything else is a
// provider the operation could not run.
func descriptionEgressResult(env command.Envelope, started time.Time, err error) command.Result {
	if reason := search.SemanticEgressReasonOf(err); reason != "" {
		return failed(env, started, newReason(string(reason), err.Error()))
	}
	return failed(env, started, newReason(ReasonDescriptionProviderUnavailable, err.Error()))
}

func min64(left, right int64) int64 {
	if left < right {
		return left
	}
	return right
}

// describeTextContexts collects the subject's admitted EXTRACT text artifacts.
// The artifacts are already host-admitted facts; the context is bounded by the
// 16 MiB description body cap so one subject cannot expand beyond the durable
// candidate bound.
func (d *Dispatcher) describeTextContexts(ctx context.Context, workspaceID, subjectRef string) ([]search.DescribeTextContext, error) {
	artifacts, err := d.store.ListAdmittedArtifacts(ctx, workspaceID, "")
	if err != nil {
		return nil, err
	}
	contexts := make([]search.DescribeTextContext, 0, 4)
	total := int64(0)
	for _, artifact := range artifacts {
		if artifact.SubjectRef != subjectRef || artifact.Stage != "EXTRACT" {
			continue
		}
		if strings.TrimSpace(artifact.Body) == "" || !utf8.ValidString(artifact.Body) {
			continue
		}
		total += int64(len(artifact.Body))
		if total > descriptionMaxBodyBytes {
			break
		}
		contexts = append(contexts, search.DescribeTextContext{ArtifactID: artifact.ID, Text: artifact.Body})
	}
	return contexts, nil
}

// describeImagePart reads the subject's admitted image bytes through the
// identity-checking content source. The source re-hashes the bytes and
// refuses any identity mismatch, so the provider request can only carry bytes
// the repository admits for this exact content identity.
func (d *Dispatcher) describeImagePart(ctx context.Context, entry sqlite.NamespaceEntry) (*search.DescribeImagePart, error) {
	if entry.EntryType != sqlite.EntryFile || strings.TrimSpace(entry.ContentID) == "" {
		return nil, nil
	}
	if d.exact == nil || d.exact.Repo == nil {
		return nil, errors.New("the describe image content source is not configured")
	}
	source := NewRepositoryImageContentSource(d.exact.Repo, 0)
	content, err := source.ReadImageContent(ctx, entry.ContentID)
	if err != nil {
		return nil, err
	}
	return &search.DescribeImagePart{ContentID: content.ContentID, MediaType: content.MediaType, Bytes: content.Bytes}, nil
}

// Describe egress receipts
//
// description.generate shares the single append-only audit_events ledger with
// the remote embedding receipts. Each attempted describe egress appends
// exactly one event; the details payload is built from
// search.DescribeEgressRecord, which has no payload fields: it records digests,
// byte counts, identities, authorizations, and the outcome, never the text or
// image bytes that were sent and never a credential.
const (
	AuditTargetDescribeProvider        = "DESCRIBE_PROVIDER"
	AuditActionDescribeEgressSucceeded = "DESCRIBE_EGRESS_SUCCEEDED"
	AuditActionDescribeEgressFailed    = "DESCRIBE_EGRESS_FAILED"
	auditActorDescribeEgress           = "cairnd"
	auditSourceDescribeEgress          = "description.generate"
)

type describeEgressAuditSink struct {
	store *sqlite.Store
}

// NewDescribeEgressAuditSink returns the append-only receipt ledger used by
// the online describe provider. It is deliberately narrow: the provider can
// append one record per attempted egress and cannot read, rewrite, or delete
// audit history.
func NewDescribeEgressAuditSink(store *sqlite.Store) search.DescribeEgressAuditSink {
	return describeEgressAuditSink{store: store}
}

// RecordDescribeEgress implements search.DescribeEgressAuditSink.
func (s describeEgressAuditSink) RecordDescribeEgress(ctx context.Context, record search.DescribeEgressRecord) error {
	if s.store == nil {
		return errors.New("describe egress ledger requires an attached catalog")
	}
	workspaceID, err := semanticEgressWorkspaceID(ctx, s.store)
	if err != nil {
		return err
	}
	if strings.TrimSpace(record.ProviderProfile) == "" || strings.TrimSpace(record.ProviderProfileDigest) == "" {
		return errors.New("describe egress receipt requires a provider profile and its digest")
	}
	details, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("encode describe egress receipt: %w", err)
	}
	action := AuditActionDescribeEgressSucceeded
	outcome := search.SemanticEgressOutcomeSucceeded
	if record.Outcome == search.SemanticEgressOutcomeFailed {
		action = AuditActionDescribeEgressFailed
		outcome = search.SemanticEgressOutcomeFailed
	}
	return s.store.Update(ctx, func(tx *sqlite.Tx) error {
		auditEvent := sqlite.AuditEvent{
			ID:          mustAuditID(),
			WorkspaceID: workspaceID,
			Actor:       auditActorDescribeEgress,
			Action:      action,
			TargetType:  AuditTargetDescribeProvider,
			TargetID:    record.ProviderProfile,
			RequestID:   strings.TrimSpace(record.SubjectID),
			Source:      auditSourceDescribeEgress,
			Outcome:     outcome,
			Details:     details,
		}
		return tx.AppendAuditEvent(ctx, &auditEvent)
	})
}
