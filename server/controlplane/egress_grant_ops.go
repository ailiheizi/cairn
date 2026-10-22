package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// Durable egress grants
//
// egress.grant.create / list / revoke manage the immutable authorization that
// the provider-neutral egress gate requires for any remote disclosure. A grant
// is created only against an installed online provider profile whose endpoint
// host, model, and profile digest it matches; it is revoked by appending a
// revocation, never by editing or deleting it. Both lifecycle steps append a
// row to the same append-only audit ledger as the egress receipts.

func (d *Dispatcher) handleEgressGrantCreate(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input command.EgressGrantCreateInput
	if err := decodeStrictOperationInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	workspaceID, err := d.resolveEgressWorkspace(ctx, input.WorkspaceID)
	if err != nil {
		return egressWorkspaceResult(env, started, err)
	}
	profileID := strings.TrimSpace(input.ProfileID)
	if err := requireText("profile_id", profileID); err != nil {
		return invalidInputResult(env, started, err)
	}
	profileDigest := strings.TrimSpace(input.ProfileDigest)
	endpointHost := strings.TrimSpace(input.EndpointHost)
	modelID := strings.TrimSpace(input.ModelID)
	for name, value := range map[string]string{
		"profile_digest": profileDigest,
		"endpoint_host":  endpointHost,
		"model_id":       modelID,
	} {
		if err := requireText(name, value); err != nil {
			return invalidInputResult(env, started, err)
		}
	}
	purpose := strings.ToUpper(strings.TrimSpace(input.Purpose))
	if !search.ValidEgressPurpose(purpose) {
		return invalidInputResult(env, started, fmt.Errorf("purpose %q must be DOCUMENT, QUERY, DESCRIBE, or ORGANIZE", input.Purpose))
	}
	if err := validateEgressGrantClasses(input.DataClasses, search.ValidEgressDataClass, "data_classes"); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := validateEgressGrantClasses(input.SubjectClasses, search.ValidEgressSubjectClass, "subject_classes"); err != nil {
		return invalidInputResult(env, started, err)
	}
	budgets := search.EgressBudget{MaxRequests: input.MaxRequests, MaxBytes: input.MaxBytes, MaxSeconds: input.MaxSeconds}
	if err := budgets.Validate(); err != nil {
		return invalidInputResult(env, started, fmt.Errorf("budgets: %v", err))
	}
	expiresAt, err := time.Parse(time.RFC3339, strings.TrimSpace(input.ExpiresAt))
	if err != nil {
		return invalidInputResult(env, started, errors.New("expires_at must be an RFC3339 instant"))
	}
	now := d.now().UTC()
	if !expiresAt.UTC().After(now) {
		return invalidInputResult(env, started, errors.New("expires_at must be in the future"))
	}
	if d == nil || (strings.TrimSpace(d.onlineProviderModelsRoot) == "" && strings.TrimSpace(d.describeModelsRoot) == "" && strings.TrimSpace(d.materialOrganizeModelsRoot) == "") {
		return failed(env, started, newReason(ReasonCodeUnavailable,
			"no models root is configured; the grant cannot be verified against an installed provider profile"))
	}
	// The grant may only authorize exactly an installed profile: a grant is
	// never a free-floating destination decision. The installed profile may be
	// an online embedding profile or a describe profile; both families share
	// the same egress scope shape and the same durable grant ledger.
	target, found, err := d.resolveEgressGrantProfile(profileID, purpose)
	if err != nil {
		return failed(env, started, newReason(ReasonCodeUnavailable, "reading the installed provider profile: "+err.Error()))
	}
	if !found {
		return notFoundResult(env, started, fmt.Sprintf("provider profile %q is not installed", profileID))
	}
	if target.digest != profileDigest {
		return invalidInputResult(env, started, errors.New("profile_digest does not match the installed provider profile"))
	}
	if target.endpointHost != endpointHost {
		return invalidInputResult(env, started, fmt.Errorf("endpoint_host %q does not match the installed profile endpoint host %q", endpointHost, target.endpointHost))
	}
	if target.modelID != modelID {
		return invalidInputResult(env, started, fmt.Errorf("model_id %q does not match the installed profile model %q", modelID, target.modelID))
	}
	for _, class := range input.DataClasses {
		if !target.egress.CoversDataClass(class) {
			return invalidInputResult(env, started, fmt.Errorf("the installed profile does not declare data class %q", class))
		}
	}
	for _, class := range input.SubjectClasses {
		if !target.egress.CoversSubjectClass(class) {
			return invalidInputResult(env, started, fmt.Errorf("the installed profile does not allow subject class %q", class))
		}
	}
	// A grant may only narrow the profile's declared per-run ceiling.
	if budgets.MaxRequests > target.egress.Budgets.MaxRequests ||
		budgets.MaxBytes > target.egress.Budgets.MaxBytes ||
		budgets.MaxSeconds > target.egress.Budgets.MaxSeconds {
		return invalidInputResult(env, started,
			errors.New("grant budgets must not exceed the installed profile's declared budgets"))
	}
	grantedBy := strings.TrimSpace(input.GrantedBy)
	if grantedBy == "" {
		grantedBy = auditActorEgressGrant
	}
	grantID, err := sqlite.NewStableID(sqlite.IDPrefixEgressGrant)
	if err != nil {
		return failed(env, started, newReason(ReasonCodeCatalogError, err.Error()))
	}
	grant := sqlite.EgressGrant{
		ID: grantID, WorkspaceID: workspaceID, ProfileID: profileID, ProfileDigest: profileDigest,
		EndpointHost: endpointHost, ModelID: modelID, Purpose: purpose,
		DataClasses:    append([]string(nil), input.DataClasses...),
		SubjectClasses: append([]string(nil), input.SubjectClasses...),
		MaxRequests:    budgets.MaxRequests, MaxBytes: budgets.MaxBytes, MaxSeconds: budgets.MaxSeconds,
		ExpiresAt: expiresAt.UTC(), GrantedBy: grantedBy, CreatedAt: now,
	}
	details, err := json.Marshal(grantAuditDetails(grant))
	if err != nil {
		return failed(env, started, newReason(ReasonCodeCatalogError, err.Error()))
	}
	err = d.store.Update(ctx, func(tx *sqlite.Tx) error {
		if err := tx.InsertEgressGrant(ctx, &grant); err != nil {
			return err
		}
		event := sqlite.AuditEvent{
			ID: mustAuditID(), WorkspaceID: workspaceID, Actor: grantedBy,
			Action: AuditActionEgressGrantCreated, TargetType: AuditTargetEgressGrant, TargetID: grant.ID,
			Source: auditSourceEgressGrant, Outcome: "SUCCEEDED", Details: details,
		}
		return tx.AppendAuditEvent(ctx, &event)
	})
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	return succeeded(env, started, projectEgressGrant(sqlite.EgressGrantState{Grant: grant}, now))
}

// egressGrantProfileTarget is the family-neutral projection of one installed
// provider profile that grant creation verifies a request against.
type egressGrantProfileTarget struct {
	digest       string
	endpointHost string
	modelID      string
	egress       search.OnlineEgressScope
}

// resolveEgressGrantProfile finds the installed provider profile a grant names.
// The online embedding family is tried first; a describe profile is admitted
// as the second family so one durable grant ledger serves both. A profile that
// is installed in neither root is reported as not found.
// purpose-specific profile binding prevents a same-named profile from a
// different provider family from authorizing this grant.
func (d *Dispatcher) resolveEgressGrantProfile(profileID, purpose string) (egressGrantProfileTarget, bool, error) {
	if purpose == search.EgressPurposeOrganizeMaterialList {
		if strings.TrimSpace(d.materialOrganizeModelsRoot) == "" {
			return egressGrantProfileTarget{}, false, nil
		}
		profile, err := search.LoadOnlineOrganizeProfile(d.materialOrganizeModelsRoot, profileID)
		if err != nil {
			if !errors.Is(err, search.ErrInvalidOnlineOrganizeProfile) || !strings.Contains(err.Error(), "is not installed") {
				return egressGrantProfileTarget{}, false, err
			}
			return egressGrantProfileTarget{}, false, nil
		}
		return egressGrantProfileTarget{digest: profile.ProviderProfileDigest(), endpointHost: profile.EndpointHost(), modelID: profile.ModelID, egress: profile.Egress}, true, nil
	}
	if purpose == search.EgressPurposeDescribe {
		if strings.TrimSpace(d.describeModelsRoot) == "" {
			return egressGrantProfileTarget{}, false, nil
		}
		profile, err := search.LoadOnlineDescribeProfile(d.describeModelsRoot, profileID)
		if err != nil {
			if !errors.Is(err, search.ErrInvalidOnlineDescribeProfile) || !strings.Contains(err.Error(), "is not installed") {
				return egressGrantProfileTarget{}, false, err
			}
			return egressGrantProfileTarget{}, false, nil
		}
		return egressGrantProfileTarget{digest: profile.ProviderProfileDigest(), endpointHost: profile.EndpointHost(), modelID: profile.ModelID, egress: profile.Egress}, true, nil
	}
	if strings.TrimSpace(d.onlineProviderModelsRoot) != "" {
		profile, err := search.LoadOnlineEmbeddingProfile(d.onlineProviderModelsRoot, profileID)
		if err == nil {
			return egressGrantProfileTarget{
				digest: profile.ProviderProfileDigest(), endpointHost: profile.EndpointHost(),
				modelID: profile.ModelID, egress: profile.Egress,
			}, true, nil
		}
		if !errors.Is(err, search.ErrInvalidOnlineEmbeddingProfile) || !strings.Contains(err.Error(), "is not installed") {
			return egressGrantProfileTarget{}, false, err
		}
	}
	return egressGrantProfileTarget{}, false, nil
}

func (d *Dispatcher) handleEgressGrantList(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input command.EgressGrantListInput
	if err := decodeOptionalStrictInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	workspaceID, err := d.resolveEgressWorkspace(ctx, input.WorkspaceID)
	if err != nil {
		return egressWorkspaceResult(env, started, err)
	}
	states, err := d.store.ListEgressGrantStates(ctx, workspaceID, sqlite.EgressGrantMatch{}, "")
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	now := d.now().UTC()
	data := command.EgressGrantListData{Grants: make([]command.EgressGrantData, 0, len(states))}
	for _, state := range states {
		data.Grants = append(data.Grants, projectEgressGrant(state, now))
	}
	return succeeded(env, started, data)
}

func (d *Dispatcher) handleEgressGrantRevoke(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input command.EgressGrantRevokeInput
	if err := decodeStrictOperationInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	workspaceID, err := d.resolveEgressWorkspace(ctx, input.WorkspaceID)
	if err != nil {
		return egressWorkspaceResult(env, started, err)
	}
	if err := requireStableID("grant_id", input.GrantID); err != nil {
		return invalidInputResult(env, started, err)
	}
	reason := strings.TrimSpace(input.Reason)
	if err := requireText("reason", reason); err != nil {
		return invalidInputResult(env, started, err)
	}
	revokedBy := strings.TrimSpace(input.RevokedBy)
	if revokedBy == "" {
		revokedBy = auditActorEgressGrant
	}
	states, err := d.store.ListEgressGrantStates(ctx, workspaceID, sqlite.EgressGrantMatch{}, input.GrantID)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	if len(states) == 0 {
		return notFoundResult(env, started, "egress grant not found")
	}
	if states[0].Revoked {
		return conflictResult(env, started, "egress grant is already revoked")
	}
	now := d.now().UTC()
	revocationID, err := sqlite.NewStableID(sqlite.IDPrefixEgressRevocation)
	if err != nil {
		return failed(env, started, newReason(ReasonCodeCatalogError, err.Error()))
	}
	revocation := sqlite.EgressGrantRevocation{
		ID: revocationID, WorkspaceID: workspaceID, GrantID: input.GrantID,
		Reason: reason, RevokedBy: revokedBy, RevokedAt: now,
	}
	details, err := json.Marshal(map[string]any{
		"grant_id": input.GrantID, "revocation_id": revocationID, "reason": reason,
	})
	if err != nil {
		return failed(env, started, newReason(ReasonCodeCatalogError, err.Error()))
	}
	err = d.store.Update(ctx, func(tx *sqlite.Tx) error {
		if err := tx.InsertEgressGrantRevocation(ctx, &revocation); err != nil {
			return err
		}
		event := sqlite.AuditEvent{
			ID: mustAuditID(), WorkspaceID: workspaceID, Actor: revokedBy,
			Action: AuditActionEgressGrantRevoked, TargetType: AuditTargetEgressGrant, TargetID: input.GrantID,
			Source: auditSourceEgressGrant, Outcome: "SUCCEEDED", Details: details,
		}
		return tx.AppendAuditEvent(ctx, &event)
	})
	if err != nil {
		if errors.Is(err, sqlite.ErrConflict) {
			return conflictResult(env, started, "egress grant is already revoked")
		}
		return catalogErrorResult(env, started, err)
	}
	return succeeded(env, started, command.EgressGrantRevokeData{
		GrantID: input.GrantID, RevocationID: revocationID, RevokedBy: revokedBy,
		RevokedAt: now.Format(time.RFC3339), Reason: reason, Live: false,
	})
}

// errEgressWorkspaceNotFound distinguishes a missing workspace from malformed
// input so the operations report not_found instead of invalid_input.
var errEgressWorkspaceNotFound = errors.New("egress workspace not found")

// resolveEgressWorkspace resolves the optional workspace input. An empty value
// selects the single default workspace, exactly as the receipt ledger does.
func (d *Dispatcher) resolveEgressWorkspace(ctx context.Context, requested string) (string, error) {
	requested = strings.TrimSpace(requested)
	if requested != "" {
		if err := requireStableID("workspace_id", requested); err != nil {
			return "", err
		}
		if _, err := d.store.GetWorkspace(ctx, requested); err != nil {
			return "", errEgressWorkspaceNotFound
		}
		return requested, nil
	}
	workspace, err := d.store.GetWorkspaceByName(ctx, "default")
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			return "", errEgressWorkspaceNotFound
		}
		return "", err
	}
	return workspace.ID, nil
}

// egressWorkspaceResult maps a workspace resolution failure onto the honest
// result: a missing workspace is not_found, malformed input is invalid_input.
func egressWorkspaceResult(env command.Envelope, started time.Time, err error) command.Result {
	if errors.Is(err, errEgressWorkspaceNotFound) {
		return notFoundResult(env, started, "workspace not found")
	}
	return invalidInputResult(env, started, err)
}

func validateEgressGrantClasses(values []string, valid func(string) bool, name string) error {
	if len(values) == 0 {
		return fmt.Errorf("%s is required", name)
	}
	seen := map[string]struct{}{}
	for _, value := range values {
		if strings.TrimSpace(value) != value || value == "" {
			return fmt.Errorf("%s must not contain empty or padded values", name)
		}
		if !valid(value) {
			return fmt.Errorf("%s value %q is not part of the closed vocabulary", name, value)
		}
		if _, duplicate := seen[value]; duplicate {
			return fmt.Errorf("%s repeats %q", name, value)
		}
		seen[value] = struct{}{}
	}
	return nil
}

func grantAuditDetails(grant sqlite.EgressGrant) map[string]any {
	return map[string]any{
		"grant_id":        grant.ID,
		"profile_id":      grant.ProfileID,
		"profile_digest":  grant.ProfileDigest,
		"endpoint_host":   grant.EndpointHost,
		"model_id":        grant.ModelID,
		"purpose":         grant.Purpose,
		"data_classes":    grant.DataClasses,
		"subject_classes": grant.SubjectClasses,
		"max_requests":    grant.MaxRequests,
		"max_bytes":       grant.MaxBytes,
		"max_seconds":     grant.MaxSeconds,
		"expires_at":      grant.ExpiresAt.UTC().Format(time.RFC3339),
		"granted_by":      grant.GrantedBy,
	}
}

func projectEgressGrant(state sqlite.EgressGrantState, now time.Time) command.EgressGrantData {
	grant := state.Grant
	live := !state.Revoked && grant.ExpiresAt.After(now.UTC())
	data := command.EgressGrantData{
		GrantID: grant.ID, WorkspaceID: grant.WorkspaceID,
		ProfileID: grant.ProfileID, ProfileDigest: grant.ProfileDigest,
		EndpointHost: grant.EndpointHost, ModelID: grant.ModelID, Purpose: grant.Purpose,
		DataClasses:    append([]string(nil), grant.DataClasses...),
		SubjectClasses: append([]string(nil), grant.SubjectClasses...),
		MaxRequests:    grant.MaxRequests, MaxBytes: grant.MaxBytes, MaxSeconds: grant.MaxSeconds,
		ExpiresAt: grant.ExpiresAt.UTC().Format(time.RFC3339),
		GrantedBy: grant.GrantedBy, CreatedAt: grant.CreatedAt.UTC().Format(time.RFC3339),
		Live: live, Revoked: state.Revoked,
	}
	if state.Revoked {
		data.RevocationID = state.RevocationID
		data.RevokedReason = state.RevokedReason
		if !state.RevokedAt.IsZero() {
			data.RevokedAt = state.RevokedAt.UTC().Format(time.RFC3339)
		}
	}
	return data
}

// decodeOptionalStrictInput accepts an omitted input as an empty object and
// otherwise requires exactly one strict JSON object.
func decodeOptionalStrictInput(raw json.RawMessage, into any) error {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return nil
	}
	return decodeStrictOperationInput(raw, into)
}

func requireText(name, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", name)
	}
	return nil
}
