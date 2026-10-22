package search

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	EgressPurposeOrganizeMaterialList = "ORGANIZE"
	MaterialOrganizeLogicalTask       = "ORGANIZE_MATERIAL_LIST"
)

type MaterialOrganizeRequest struct {
	WorkspaceID     string
	DocumentJSON    string
	BaseDigest      string
	SubjectOutcomes []EgressSubjectOutcome
	Confirmation    SemanticEgressConfirmation
}

type MaterialOrganizeResult struct {
	CandidateJSON string
	BaseDigest    string
	ProfileID     string
	ProfileDigest string
}

// MaterialOrganizeEgressRecord contains digests and byte counts only. It never
// stores the submitted JSON, Skill, candidate body, credential, or subject IDs.
// RESPONSE_RECEIVED means only that the provider returned a bounded response;
// the control plane still validates the ML document before exposing it.
type MaterialOrganizeEgressRecord struct {
	WorkspaceID           string               `json:"workspace_id"`
	ProviderProfile       string               `json:"provider_profile"`
	ProviderProfileDigest string               `json:"provider_profile_digest"`
	Provider              string               `json:"provider"`
	ModelID               string               `json:"model_id"`
	ModelRevision         string               `json:"model_revision"`
	APIStyle              string               `json:"api_style"`
	EndpointHost          string               `json:"endpoint_host"`
	Purpose               string               `json:"purpose"`
	DataClasses           []string             `json:"disclosed_data_classes"`
	SubjectClasses        []string             `json:"subject_classes"`
	RequestDigest         string               `json:"request_digest"`
	InputBytes            int64                `json:"input_bytes"`
	PayloadDigest         string               `json:"payload_digest"`
	PayloadBytes          int64                `json:"payload_bytes"`
	OutputDigest          string               `json:"output_digest,omitempty"`
	OutputBytes           int64                `json:"output_bytes,omitempty"`
	ResponseModel         string               `json:"response_model,omitempty"`
	ResponseFinishReason  string               `json:"response_finish_reason,omitempty"`
	ResponseContentBytes  int64                `json:"response_content_bytes,omitempty"`
	GrantID               string               `json:"grant_id,omitempty"`
	Authorization         string               `json:"authorization,omitempty"`
	CredentialRef         string               `json:"credential_ref,omitempty"`
	HTTPStatus            int                  `json:"http_status,omitempty"`
	RequestSent           bool                 `json:"request_sent"`
	Outcome               string               `json:"outcome"`
	Reason                SemanticEgressReason `json:"reason,omitempty"`
	ProviderErrorClass    string               `json:"provider_error_class,omitempty"`
	StartedAt             time.Time            `json:"started_at"`
	CompletedAt           time.Time            `json:"completed_at"`
	BudgetUsage           EgressBudgetUsage    `json:"budget_usage"`
}

type MaterialOrganizeEgressAuditSink interface {
	RecordMaterialOrganizeEgress(context.Context, MaterialOrganizeEgressRecord) error
}

type MaterialOrganizer interface {
	Organize(context.Context, MaterialOrganizeRequest) (MaterialOrganizeResult, error)
	CheckMaterialOrganizeReadiness(context.Context) error
	Profile() OnlineOrganizeProfile
}

type OnlineMaterialOrganizerOptions struct {
	Profile            OnlineOrganizeProfile
	CredentialResolver OnlineCredentialResolver
	AuditSink          MaterialOrganizeEgressAuditSink
	Grants             EgressGrantLookup
	HTTPClient         *http.Client
	Now                func() time.Time
}

type OnlineMaterialOrganizer struct {
	profile  OnlineOrganizeProfile
	resolver OnlineCredentialResolver
	audit    MaterialOrganizeEgressAuditSink
	grants   EgressGrantLookup
	client   *http.Client
	now      func() time.Time
}

func NewOnlineMaterialOrganizer(options OnlineMaterialOrganizerOptions) (*OnlineMaterialOrganizer, error) {
	if err := options.Profile.Validate(); err != nil {
		return nil, refusedEgress(EgressReasonProfileUnresolved, "organize_profile", err.Error())
	}
	resolver := options.CredentialResolver
	if resolver == nil {
		resolver = DefaultOnlineCredentialResolver()
	}
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: time.Duration(options.Profile.TimeoutMS) * time.Millisecond, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	return &OnlineMaterialOrganizer{profile: options.Profile, resolver: resolver, audit: options.AuditSink, grants: options.Grants, client: client, now: now}, nil
}

func (p *OnlineMaterialOrganizer) Profile() OnlineOrganizeProfile {
	if p == nil {
		return OnlineOrganizeProfile{}
	}
	return p.profile
}

func (p *OnlineMaterialOrganizer) CheckMaterialOrganizeReadiness(ctx context.Context) error {
	if p == nil {
		return refusedEgress(EgressReasonProfileUnresolved, "organize_profile", "no organizer profile is configured")
	}
	if err := p.profile.ValidateAt(p.now()); err != nil {
		return refusedEgress(EgressReasonProfileUnresolved, "organize_profile", err.Error())
	}
	if _, err := OnlineCredentialRefScheme(p.profile.CredentialRef); err != nil {
		return refusedEgress(EgressReasonCredentialUnresolved, "credential_ref", err.Error())
	}
	if _, err := p.resolver.Resolve(ctx, p.profile.CredentialRef); err != nil {
		return refusedEgress(EgressReasonCredentialUnresolved, "credential_ref", "the configured organizer credential is unavailable")
	}
	if p.audit == nil {
		return refusedEgress(EgressReasonAuditUnavailable, "audit_ledger", "no append-only egress audit sink is attached")
	}
	if p.grants == nil {
		return refusedEgress(EgressReasonGrantMissing, "egress_grant", "no durable egress grant ledger is attached")
	}
	return ctx.Err()
}

func (p *OnlineMaterialOrganizer) Organize(ctx context.Context, request MaterialOrganizeRequest) (MaterialOrganizeResult, error) {
	var empty MaterialOrganizeResult
	if err := p.CheckMaterialOrganizeReadiness(ctx); err != nil {
		return empty, err
	}
	if strings.TrimSpace(request.WorkspaceID) == "" {
		return empty, refusedEgress(EgressReasonRequestInvalid, "request", "workspace is required")
	}
	if !utf8.ValidString(request.DocumentJSON) || int64(len(request.DocumentJSON)) > OnlineOrganizeMaxInputBytes {
		return empty, refusedEgress(EgressReasonBudgetExceeded, "request", "the material-list input exceeds the 128 KiB operation limit")
	}
	if digestMaterialBytes([]byte(request.DocumentJSON)) != request.BaseDigest {
		return empty, refusedEgress(EgressReasonRequestInvalid, "base_digest", "the material-list base digest does not match its exact UTF-8 bytes")
	}
	body, err := p.buildBody(request.DocumentJSON)
	if err != nil {
		return empty, refusedEgress(EgressReasonRequestInvalid, "request", err.Error())
	}
	started := p.now().UTC()
	run := NewEgressRunBudget(started)
	contentDigest := request.BaseDigest
	confirmation := request.Confirmation
	if confirmation.Purpose != SemanticEmbeddingPurpose(EgressPurposeOrganizeMaterialList) {
		return empty, refusedEgress(EgressReasonConfirmationMismatch, "confirmation", "confirmation must name ORGANIZE purpose")
	}
	gateRequest := EgressGateRequest{ProviderKind: "online-material-organizer", ProfileID: p.profile.ProfileID, ProfileDigest: p.profile.ProviderProfileDigest(), Endpoint: p.profile.Endpoint, EndpointHost: p.profile.EndpointHost(), ModelID: p.profile.ModelID, Purpose: EgressPurposeOrganizeMaterialList, DataClasses: []string{EgressDataClassTextMaterialList}, SubjectOutcomes: request.SubjectOutcomes, CredentialRef: p.profile.CredentialRef, ContentDigest: contentDigest, ProfileEgress: p.profile.Egress, ProfileBudget: p.profile.Egress.Budgets, AuditRequired: p.profile.Egress.AuditRequired, AuditAttached: p.audit != nil, Confirmation: &confirmation, Now: started}
	permit, credential, err := AdmitEgress(ctx, gateRequest, EgressGateDeps{Credential: p.resolver, Grants: p.grants})
	if err != nil {
		if SemanticEgressGrantIDOf(err) != "" {
			if auditErr := p.recordRefused(ctx, request, body, err, run, started); auditErr != nil {
				return empty, refusedEgress(EgressReasonReceiptUnrecorded, "audit_ledger", "the refused organizer attempt could not be recorded")
			}
		}
		return empty, err
	}
	if err := run.Admit(p.now().UTC(), int64(len(body)), permit.Budget); err != nil {
		if auditErr := p.recordRefusedWithPermit(ctx, request, body, permit, err, run, started); auditErr != nil {
			return empty, refusedEgress(EgressReasonReceiptUnrecorded, "audit_ledger", "the refused organizer attempt could not be recorded")
		}
		return empty, err
	}
	deadline := time.Duration(p.profile.TimeoutMS) * time.Millisecond
	grantDeadline := time.Duration(permit.Budget.MaxSeconds)*time.Second - p.now().UTC().Sub(started)
	if grantDeadline <= 0 {
		return empty, refusedEgress(EgressReasonBudgetExceeded, "egress_budget", "the egress run reached its max_seconds deadline")
	}
	if grantDeadline < deadline {
		deadline = grantDeadline
	}
	operationDeadline := time.Duration(OnlineOrganizeMaxTimeoutMS)*time.Millisecond - p.now().UTC().Sub(started)
	if operationDeadline <= 0 {
		return empty, refusedEgress(EgressReasonBudgetExceeded, "egress_budget", "the operation reached its 90 second deadline")
	}
	if operationDeadline < deadline {
		deadline = operationDeadline
	}
	ctx, cancel := context.WithTimeout(ctx, deadline)
	defer cancel()
	resp, status, callErr := p.perform(ctx, body, credential)
	completed := p.now().UTC()
	run.Record(int64(len(body)))
	reason := SemanticEgressReason("")
	errorClass := ""
	output := ""
	if callErr != nil {
		reason = SemanticEgressReasonOf(callErr)
		if reason == "" {
			reason = EgressReasonProviderError
		}
		var diagnostic *materialOrganizeDiagnosticError
		if errors.As(callErr, &diagnostic) {
			errorClass = diagnostic.stage
		}
		var statusErr *materialOrganizeHTTPError
		if errors.As(callErr, &statusErr) {
			errorClass = statusErr.class
		}
	} else {
		output = resp
	}
	outputBytes := int64(len(output))
	outputDigest := ""
	if reason == "" {
		if outputBytes == 0 || outputBytes > p.profile.MaxOutputBytes || outputBytes > OnlineOrganizeMaxOutputBytes {
			reason = EgressReasonResponseMalformed
			output = ""
		} else if !utf8.ValidString(output) {
			reason = EgressReasonResponseMalformed
			output = ""
		} else {
			outputDigest = digestMaterialBytes([]byte(output))
		}
	}
	record := p.record(request, body, permit, started, completed, status, reason, errorClass, true, run.Usage(completed), outputDigest, outputBytes)
	var diagnostic *materialOrganizeDiagnosticError
	if errors.As(callErr, &diagnostic) {
		record.ResponseModel = safeProviderMetadata(diagnostic.model, 128)
		record.ResponseFinishReason = safeProviderMetadata(diagnostic.finishReason, 64)
		record.ResponseContentBytes = diagnostic.contentBytes
	}
	if err := p.recordAudit(ctx, record); err != nil {
		return empty, refusedEgress(EgressReasonReceiptUnrecorded, "audit_ledger", "the disclosure completed but its append-only receipt could not be recorded")
	}
	if reason != "" {
		message := "the organizer request failed or returned an invalid bounded response"
		if callErr != nil {
			message = callErr.Error()
		}
		return empty, refusedEgress(reason, "provider", message)
	}
	return MaterialOrganizeResult{CandidateJSON: output, BaseDigest: request.BaseDigest, ProfileID: p.profile.ProfileID, ProfileDigest: p.profile.ProviderProfileDigest()}, nil
}

func (p *OnlineMaterialOrganizer) buildBody(document string) ([]byte, error) {
	user := []byte("Apply the draft's embedded guide.body as the organizing instructions. Make a concrete, bounded application of those instructions only through the title, ordering, labels, context, and occurrences of the refs already supplied in this draft. Preserve every existing copied context entry by default. For each item, add a concise context.reason grounded only in its supplied label/context explaining its placement or why it already fits; do not invent facts or infer content from a ref. If the current order and context already fit the guide, keep them and say why in context.reason rather than returning the draft unchanged without explanation. Keep every ref byte-for-byte unchanged; do not add refs, follow URLs or paths, use tools, fetch originals, or disclose anything beyond this exact draft. Return one complete cairn.material-list.v1 JSON document only.\n\nDraft:\n" + document)
	return json.Marshal(struct {
		Model     string            `json:"model"`
		MaxTokens int               `json:"max_tokens"`
		Messages  []organizeMessage `json:"messages"`
	}{p.profile.ModelID, p.profile.MaxOutputTokens, []organizeMessage{{Role: "system", Content: p.profile.SystemInstruction}, {Role: "user", Content: string(user)}}})
}

type organizeMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type organizeResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Error struct {
		Code string `json:"code"`
		Type string `json:"type"`
	} `json:"error"`
}
type materialOrganizeHTTPError struct{ class string }

func (e *materialOrganizeHTTPError) Error() string { return "organizer HTTP response failed" }

type materialOrganizeDiagnosticError struct {
	stage        string
	message      string
	model        string
	finishReason string
	contentBytes int64
}

func (e *materialOrganizeDiagnosticError) Error() string { return e.message }
func (e *materialOrganizeDiagnosticError) Unwrap() error {
	return refusedEgress(EgressReasonResponseMalformed, "response", e.message)
}

func materialOrganizeDiagnostic(stage, message, model, finishReason string, content string) error {
	return &materialOrganizeDiagnosticError{stage: stage, message: message, model: model, finishReason: finishReason, contentBytes: int64(len([]byte(content)))}
}

func safeProviderMetadata(value string, max int) string {
	if len(value) == 0 || len(value) > max {
		return ""
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("._:/@+-", r)) {
			return ""
		}
	}
	return value
}

func (p *OnlineMaterialOrganizer) perform(ctx context.Context, body []byte, credential OnlineCredential) (string, int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, p.profile.Endpoint, bytes.NewReader(body))
	if err != nil {
		return "", 0, refusedEgress(EgressReasonRequestInvalid, "endpoint", "could not construct organizer request")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+credential.Value())
	response, err := p.client.Do(request)
	if err != nil {
		reason := EgressReasonProviderUnreachable
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			reason = EgressReasonProviderTimeout
		}
		var netErr net.Error
		if errors.As(err, &netErr) && netErr.Timeout() {
			reason = EgressReasonProviderTimeout
		}
		return "", 0, refusedEgress(reason, "provider", "the organizer endpoint could not be reached")
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, p.profile.MaxOutputBytes+1))
	if err != nil {
		return "", response.StatusCode, refusedEgress(EgressReasonProviderUnreachable, "provider", "reading organizer response failed")
	}
	if int64(len(raw)) > p.profile.MaxOutputBytes {
		return "", response.StatusCode, materialOrganizeDiagnostic("OVERSIZE", "organizer response exceeded the configured response limit", "", "", "")
	}
	if response.StatusCode != http.StatusOK {
		return "", response.StatusCode, &materialOrganizeHTTPError{class: string(onlineStatusReason(response.StatusCode))}
	}
	var decoded organizeResponse
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := decoder.Decode(&decoded); err != nil {
		return "", response.StatusCode, materialOrganizeDiagnostic("JSON_INVALID", "organizer response was not valid chat-completions JSON", "", "", "")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return "", response.StatusCode, materialOrganizeDiagnostic("TRAILING_JSON", "organizer response contained trailing JSON", "", "", "")
	}
	if decoded.Model != "" && decoded.Model != p.profile.ModelID {
		return "", response.StatusCode, materialOrganizeDiagnostic("MODEL_MISMATCH", "organizer returned an unexpected model identity", decoded.Model, "", "")
	}
	if len(decoded.Choices) != 1 {
		return "", response.StatusCode, materialOrganizeDiagnostic("CHOICE_COUNT", "organizer must return exactly one candidate choice", decoded.Model, "", "")
	}
	content, finish := decoded.Choices[0].Message.Content, decoded.Choices[0].FinishReason
	if strings.TrimSpace(content) == "" {
		return "", response.StatusCode, materialOrganizeDiagnostic("EMPTY_CONTENT", "organizer returned an empty candidate", decoded.Model, finish, content)
	}
	if finish != "stop" {
		return "", response.StatusCode, materialOrganizeDiagnostic("NON_STOP", "organizer candidate did not finish with stop", decoded.Model, finish, content)
	}
	return content, response.StatusCode, nil
}

func digestMaterialBytes(value []byte) string {
	sum := sha256.Sum256(value)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func (p *OnlineMaterialOrganizer) record(request MaterialOrganizeRequest, body []byte, permit EgressAdmission, started, completed time.Time, status int, reason SemanticEgressReason, class string, sent bool, usage EgressBudgetUsage, outputDigest string, outputBytes int64) MaterialOrganizeEgressRecord {
	classes := make([]string, 0, len(request.SubjectOutcomes))
	seen := map[string]bool{}
	for _, outcome := range request.SubjectOutcomes {
		if !seen[outcome.Class] {
			seen[outcome.Class] = true
			classes = append(classes, outcome.Class)
		}
	}
	record := MaterialOrganizeEgressRecord{WorkspaceID: request.WorkspaceID, ProviderProfile: p.profile.ProfileID, ProviderProfileDigest: p.profile.ProviderProfileDigest(), Provider: p.profile.Provider, ModelID: p.profile.ModelID, ModelRevision: p.profile.ModelRevision, APIStyle: p.profile.APIStyle, EndpointHost: p.profile.EndpointHost(), Purpose: EgressPurposeOrganizeMaterialList, DataClasses: []string{EgressDataClassTextMaterialList}, SubjectClasses: classes, RequestDigest: request.BaseDigest, InputBytes: int64(len(request.DocumentJSON)), PayloadDigest: digestMaterialBytes(body), PayloadBytes: int64(len(body)), OutputDigest: outputDigest, OutputBytes: outputBytes, GrantID: permit.GrantID, Authorization: permit.Authorization, CredentialRef: permit.CredentialRef, HTTPStatus: status, RequestSent: sent, Outcome: "RESPONSE_RECEIVED", StartedAt: started, CompletedAt: completed, BudgetUsage: usage}
	if reason != "" {
		record.Outcome = "FAILED"
		record.Reason = reason
		record.ProviderErrorClass = class
	}
	return record
}

func (p *OnlineMaterialOrganizer) recordAudit(ctx context.Context, record MaterialOrganizeEgressRecord) error {
	auditCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	return p.audit.RecordMaterialOrganizeEgress(auditCtx, record)
}

func (p *OnlineMaterialOrganizer) recordRefused(ctx context.Context, request MaterialOrganizeRequest, body []byte, refusal error, run *EgressRunBudget, started time.Time) error {
	grant := SemanticEgressGrantIDOf(refusal)
	if grant == "" || p.audit == nil {
		return nil
	}
	permit := EgressAdmission{GrantID: grant, ProfileID: p.profile.ProfileID, ProfileDigest: p.profile.ProviderProfileDigest(), EndpointHost: p.profile.EndpointHost(), ModelID: p.profile.ModelID, Purpose: EgressPurposeOrganizeMaterialList, CredentialRef: RedactedOnlineCredentialRef(p.profile.CredentialRef)}
	return p.recordRefusedWithPermit(ctx, request, body, permit, refusal, run, started)
}

func (p *OnlineMaterialOrganizer) recordRefusedWithPermit(ctx context.Context, request MaterialOrganizeRequest, body []byte, permit EgressAdmission, refusal error, run *EgressRunBudget, started time.Time) error {
	record := p.record(request, body, permit, started, p.now().UTC(), 0, SemanticEgressReasonOf(refusal), "", false, run.Usage(p.now()), "", 0)
	return p.recordAudit(ctx, record)
}
