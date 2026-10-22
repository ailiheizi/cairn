package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Durable egress grants
//
// An egress grant is the operator's immutable authorization for one remote
// provider disclosure scope. Grants and their revocations are append-only at
// the schema level: UPDATE and DELETE are refused by triggers. A grant is live
// iff its expiry is in the future and no revocation row exists.
//
// The store intentionally keeps no enforcement policy here: the search package
// owns the provider-neutral gate, and the control plane reads these rows into
// its neutral projection. The store only records exactly what the operator
// granted, forever.

// Egress grant purpose vocabulary. The catalog accepts only the purposes the
// egress gate admits.
const (
	EgressGrantPurposeDocument = "DOCUMENT"
	EgressGrantPurposeQuery    = "QUERY"
	// EgressGrantPurposeDescribe is the additive DESCRIBE_SUBJECT purpose: the
	// same durable grant ledger serves both provider families.
	EgressGrantPurposeDescribe = "DESCRIBE"
	// EgressGrantPurposeOrganize is the bounded material-list organizer purpose.
	EgressGrantPurposeOrganize = "ORGANIZE"
)

// EgressGrant is one durable immutable grant row.
type EgressGrant struct {
	ID             string
	WorkspaceID    string
	ProfileID      string
	ProfileDigest  string
	EndpointHost   string
	ModelID        string
	Purpose        string
	DataClasses    []string
	SubjectClasses []string
	MaxRequests    int64
	MaxBytes       int64
	MaxSeconds     int64
	ExpiresAt      time.Time
	GrantedBy      string
	CreatedAt      time.Time
}

// EgressGrantRevocation is one append-only revocation.
type EgressGrantRevocation struct {
	ID          string
	WorkspaceID string
	GrantID     string
	Reason      string
	RevokedBy   string
	RevokedAt   time.Time
}

// EgressGrantState is one grant together with its revocation evidence.
type EgressGrantState struct {
	Grant         EgressGrant
	Revoked       bool
	RevocationID  string
	RevokedReason string
	RevokedAt     time.Time
}

// EgressGrantMatch filters the grant projection. Empty fields do not filter.
type EgressGrantMatch struct {
	ProfileID     string
	ProfileDigest string
	EndpointHost  string
	ModelID       string
	Purpose       string
}

func validEgressGrantPurpose(value string) bool {
	return value == EgressGrantPurposeDocument || value == EgressGrantPurposeQuery || value == EgressGrantPurposeDescribe || value == EgressGrantPurposeOrganize
}

func normalizeEgressGrantClasses(name string, values []string) ([]string, error) {
	if len(values) == 0 {
		return nil, fmt.Errorf("%s is required", name)
	}
	normalized := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" || trimmed != value {
			return nil, fmt.Errorf("%s must not contain empty or padded values", name)
		}
		if _, duplicate := seen[trimmed]; duplicate {
			return nil, fmt.Errorf("%s repeats %q", name, trimmed)
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	return normalized, nil
}

// InsertEgressGrant appends one immutable grant inside the caller's write
// transaction so a create and its audit row cannot diverge.
func (tx *Tx) InsertEgressGrant(ctx context.Context, grant *EgressGrant) error {
	if grant == nil {
		return errors.New("egress grant is required")
	}
	if err := requireID("egress grant id", grant.ID); err != nil {
		return err
	}
	if err := requireID("workspace id", grant.WorkspaceID); err != nil {
		return err
	}
	for name, value := range map[string]string{
		"egress grant profile id":     grant.ProfileID,
		"egress grant profile digest": grant.ProfileDigest,
		"egress grant endpoint host":  grant.EndpointHost,
		"egress grant model id":       grant.ModelID,
		"egress grant purpose":        grant.Purpose,
		"egress grant granted by":     grant.GrantedBy,
	} {
		if err := requireText(name, value); err != nil {
			return err
		}
	}
	if !validEgressGrantPurpose(grant.Purpose) {
		return fmt.Errorf("egress grant purpose %q must be %s, %s, %s, or %s", grant.Purpose, EgressGrantPurposeDocument, EgressGrantPurposeQuery, EgressGrantPurposeDescribe, EgressGrantPurposeOrganize)
	}
	dataClasses, err := normalizeEgressGrantClasses("egress grant data classes", grant.DataClasses)
	if err != nil {
		return err
	}
	subjectClasses, err := normalizeEgressGrantClasses("egress grant subject classes", grant.SubjectClasses)
	if err != nil {
		return err
	}
	if grant.MaxRequests <= 0 || grant.MaxBytes <= 0 || grant.MaxSeconds <= 0 {
		return errors.New("egress grant budgets must be positive")
	}
	if grant.ExpiresAt.IsZero() {
		return errors.New("egress grant expiry is required")
	}
	dataJSON, err := json.Marshal(dataClasses)
	if err != nil {
		return fmt.Errorf("encode egress grant data classes: %w", err)
	}
	subjectJSON, err := json.Marshal(subjectClasses)
	if err != nil {
		return fmt.Errorf("encode egress grant subject classes: %w", err)
	}
	createdAt := recordTime(grant.CreatedAt, tx.now)
	expiresAt := grant.ExpiresAt.UTC()
	if _, err := tx.tx.ExecContext(ctx, `
INSERT INTO egress_grants(
    grant_id, workspace_id, profile_id, profile_digest, endpoint_host, model_id,
    purpose, data_classes_json, subject_classes_json, max_requests, max_bytes,
    max_seconds, expires_at_ns, granted_by, created_at_ns
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		grant.ID, grant.WorkspaceID, grant.ProfileID, grant.ProfileDigest, grant.EndpointHost, grant.ModelID,
		grant.Purpose, string(dataJSON), string(subjectJSON), grant.MaxRequests, grant.MaxBytes,
		grant.MaxSeconds, expiresAt.UnixNano(), grant.GrantedBy, createdAt.UnixNano()); err != nil {
		return fmt.Errorf("insert egress grant: %w", err)
	}
	grant.DataClasses = dataClasses
	grant.SubjectClasses = subjectClasses
	grant.CreatedAt = createdAt
	return nil
}

// InsertEgressGrantRevocation appends one revocation. The store refuses a
// second revocation of the same grant so revocation stays a single visible
// decision.
func (tx *Tx) InsertEgressGrantRevocation(ctx context.Context, revocation *EgressGrantRevocation) error {
	if revocation == nil {
		return errors.New("egress grant revocation is required")
	}
	if err := requireID("egress grant revocation id", revocation.ID); err != nil {
		return err
	}
	if err := requireID("workspace id", revocation.WorkspaceID); err != nil {
		return err
	}
	if err := requireID("egress grant id", revocation.GrantID); err != nil {
		return err
	}
	for name, value := range map[string]string{
		"egress grant revocation reason":     revocation.Reason,
		"egress grant revocation revoked by": revocation.RevokedBy,
	} {
		if err := requireText(name, value); err != nil {
			return err
		}
	}
	revokedAt := recordTime(revocation.RevokedAt, tx.now)
	if _, err := tx.tx.ExecContext(ctx, `
INSERT INTO egress_grant_revocations(
    revocation_id, workspace_id, grant_id, reason, revoked_by, revoked_at_ns
) VALUES (?, ?, ?, ?, ?, ?)`,
		revocation.ID, revocation.WorkspaceID, revocation.GrantID, revocation.Reason,
		revocation.RevokedBy, revokedAt.UnixNano()); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return ErrConflict
		}
		return fmt.Errorf("insert egress grant revocation: %w", err)
	}
	revocation.RevokedAt = revokedAt
	return nil
}

// GetEgressGrant reads one grant row.
func (s *Store) GetEgressGrant(ctx context.Context, workspaceID, grantID string) (EgressGrant, error) {
	states, err := s.ListEgressGrantStates(ctx, workspaceID, EgressGrantMatch{}, grantID)
	if err != nil {
		return EgressGrant{}, err
	}
	if len(states) == 0 {
		return EgressGrant{}, ErrNotFound
	}
	return states[0].Grant, nil
}

// ListEgressGrantStates projects grants, optionally filtered by identity
// fields, together with their revocation evidence.
func (s *Store) ListEgressGrantStates(ctx context.Context, workspaceID string, match EgressGrantMatch, grantID string) ([]EgressGrantState, error) {
	if err := requireID("workspace id", workspaceID); err != nil {
		return nil, err
	}
	conditions := []string{"g.workspace_id = ?"}
	args := []any{workspaceID}
	for column, value := range map[string]string{
		"g.profile_id":     match.ProfileID,
		"g.profile_digest": match.ProfileDigest,
		"g.endpoint_host":  match.EndpointHost,
		"g.model_id":       match.ModelID,
		"g.purpose":        match.Purpose,
		"g.grant_id":       grantID,
	} {
		if strings.TrimSpace(value) == "" {
			continue
		}
		conditions = append(conditions, column+" = ?")
		args = append(args, value)
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT g.grant_id, g.workspace_id, g.profile_id, g.profile_digest, g.endpoint_host,
       g.model_id, g.purpose, g.data_classes_json, g.subject_classes_json,
       g.max_requests, g.max_bytes, g.max_seconds, g.expires_at_ns, g.granted_by, g.created_at_ns,
       r.revocation_id, r.reason, r.revoked_at_ns
FROM egress_grants g
LEFT JOIN egress_grant_revocations r
    ON r.workspace_id = g.workspace_id AND r.grant_id = g.grant_id
WHERE `+strings.Join(conditions, " AND ")+`
ORDER BY g.created_at_ns DESC, g.grant_id`, args...)
	if err != nil {
		return nil, fmt.Errorf("list egress grants: %w", err)
	}
	defer rows.Close()
	var states []EgressGrantState
	for rows.Next() {
		var (
			state         EgressGrantState
			dataJSON      string
			subjectJSON   string
			expiresAtNS   int64
			createdAtNS   int64
			revocationID  sql.NullString
			revocationWhy sql.NullString
			revokedAtNS   sql.NullInt64
		)
		if err := rows.Scan(
			&state.Grant.ID, &state.Grant.WorkspaceID, &state.Grant.ProfileID, &state.Grant.ProfileDigest,
			&state.Grant.EndpointHost, &state.Grant.ModelID, &state.Grant.Purpose, &dataJSON, &subjectJSON,
			&state.Grant.MaxRequests, &state.Grant.MaxBytes, &state.Grant.MaxSeconds, &expiresAtNS,
			&state.Grant.GrantedBy, &createdAtNS,
			&revocationID, &revocationWhy, &revokedAtNS,
		); err != nil {
			return nil, fmt.Errorf("scan egress grant: %w", err)
		}
		if err := json.Unmarshal([]byte(dataJSON), &state.Grant.DataClasses); err != nil {
			return nil, fmt.Errorf("decode egress grant data classes: %w", err)
		}
		if err := json.Unmarshal([]byte(subjectJSON), &state.Grant.SubjectClasses); err != nil {
			return nil, fmt.Errorf("decode egress grant subject classes: %w", err)
		}
		state.Grant.ExpiresAt = time.Unix(0, expiresAtNS).UTC()
		state.Grant.CreatedAt = time.Unix(0, createdAtNS).UTC()
		if revocationID.Valid {
			state.Revoked = true
			state.RevocationID = revocationID.String
			state.RevokedReason = revocationWhy.String
			if revokedAtNS.Valid {
				state.RevokedAt = time.Unix(0, revokedAtNS.Int64).UTC()
			}
		}
		states = append(states, state)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate egress grants: %w", err)
	}
	return states, nil
}

// ListEgressGrants returns the workspace's grant rows without revocation
// evidence. It exists for control-plane projections that pair it with
// ListEgressGrantRevocations.
func (s *Store) ListEgressGrants(ctx context.Context, workspaceID string) ([]EgressGrant, error) {
	states, err := s.ListEgressGrantStates(ctx, workspaceID, EgressGrantMatch{}, "")
	if err != nil {
		return nil, err
	}
	grants := make([]EgressGrant, 0, len(states))
	for _, state := range states {
		grants = append(grants, state.Grant)
	}
	return grants, nil
}

// ListEgressGrantRevocations returns the workspace's revocation rows.
func (s *Store) ListEgressGrantRevocations(ctx context.Context, workspaceID string) ([]EgressGrantRevocation, error) {
	if err := requireID("workspace id", workspaceID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT revocation_id, workspace_id, grant_id, reason, revoked_by, revoked_at_ns
FROM egress_grant_revocations
WHERE workspace_id = ?
ORDER BY revoked_at_ns, revocation_id`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list egress grant revocations: %w", err)
	}
	defer rows.Close()
	var revocations []EgressGrantRevocation
	for rows.Next() {
		var (
			revocation  EgressGrantRevocation
			revokedAtNS int64
		)
		if err := rows.Scan(&revocation.ID, &revocation.WorkspaceID, &revocation.GrantID,
			&revocation.Reason, &revocation.RevokedBy, &revokedAtNS); err != nil {
			return nil, fmt.Errorf("scan egress grant revocation: %w", err)
		}
		revocation.RevokedAt = time.Unix(0, revokedAtNS).UTC()
		revocations = append(revocations, revocation)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate egress grant revocations: %w", err)
	}
	return revocations, nil
}
