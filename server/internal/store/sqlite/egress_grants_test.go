package sqlite

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testEgressGrant(t *testing.T, workspaceID string) EgressGrant {
	return EgressGrant{
		ID:            testID(t, IDPrefixEgressGrant),
		WorkspaceID:   workspaceID,
		ProfileID:     "operator-online-v1",
		ProfileDigest: "sha256:" + strings.Repeat("1", 64),
		EndpointHost:  "api.example.invalid",
		ModelID:       "stub-embed-v1",
		Purpose:       EgressGrantPurposeDocument,
		DataClasses:   []string{"text.segment", "text.query"},
		SubjectClasses: []string{
			"EXACT_PROTECTED", "EXACT_FALLBACK", "EXTERNAL_REPLAYABLE",
		},
		MaxRequests: 16, MaxBytes: 1 << 20, MaxSeconds: 120,
		ExpiresAt: testEpoch.Add(24 * time.Hour),
		GrantedBy: "operator", CreatedAt: testEpoch,
	}
}

func newEgressWorkspace(t *testing.T, store *Store) string {
	t.Helper()
	workspace := Workspace{ID: testID(t, IDPrefixWorkspace), Name: "egress workspace"}
	if err := store.Update(context.Background(), func(tx *Tx) error {
		return tx.InsertWorkspace(context.Background(), &workspace)
	}); err != nil {
		t.Fatalf("insert workspace: %v", err)
	}
	return workspace.ID
}

// TestEgressGrantsRoundTripAndRevocationsAreAppendOnly proves the durable
// grant shape and the schema-level immutability of both tables.
func TestEgressGrantsRoundTripAndRevocationsAreAppendOnly(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	defer store.Close()
	workspaceID := newEgressWorkspace(t, store)

	grant := testEgressGrant(t, workspaceID)
	if err := store.Update(ctx, func(tx *Tx) error { return tx.InsertEgressGrant(ctx, &grant) }); err != nil {
		t.Fatalf("insert egress grant: %v", err)
	}
	states, err := store.ListEgressGrantStates(ctx, workspaceID, EgressGrantMatch{ProfileID: grant.ProfileID}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(states) != 1 || states[0].Revoked {
		t.Fatalf("states = %+v", states)
	}
	loaded := states[0].Grant
	if loaded.ID != grant.ID || loaded.ProfileDigest != grant.ProfileDigest ||
		loaded.Purpose != EgressGrantPurposeDocument ||
		len(loaded.DataClasses) != 2 || len(loaded.SubjectClasses) != 3 ||
		loaded.MaxRequests != grant.MaxRequests || loaded.MaxBytes != grant.MaxBytes ||
		loaded.MaxSeconds != grant.MaxSeconds ||
		!loaded.ExpiresAt.Equal(grant.ExpiresAt) || loaded.GrantedBy != "operator" ||
		!loaded.CreatedAt.Equal(testEpoch) {
		t.Fatalf("loaded grant = %+v", loaded)
	}
	if _, err := store.GetEgressGrant(ctx, workspaceID, "egt_missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing grant error = %v, want ErrNotFound", err)
	}

	revocation := EgressGrantRevocation{
		ID: testID(t, IDPrefixEgressRevocation), WorkspaceID: workspaceID, GrantID: grant.ID,
		Reason: "key rotation", RevokedBy: "operator", RevokedAt: testEpoch.Add(time.Hour),
	}
	if err := store.Update(ctx, func(tx *Tx) error { return tx.InsertEgressGrantRevocation(ctx, &revocation) }); err != nil {
		t.Fatalf("insert revocation: %v", err)
	}
	// A second revocation of the same grant is refused: revocation stays one
	// visible decision.
	duplicate := revocation
	duplicate.ID = testID(t, IDPrefixEgressRevocation)
	if err := store.Update(ctx, func(tx *Tx) error { return tx.InsertEgressGrantRevocation(ctx, &duplicate) }); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate revocation error = %v, want ErrConflict", err)
	}
	states, err = store.ListEgressGrantStates(ctx, workspaceID, EgressGrantMatch{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(states) != 1 || !states[0].Revoked || states[0].RevocationID != revocation.ID ||
		states[0].RevokedReason != "key rotation" {
		t.Fatalf("revoked state = %+v", states)
	}
	// Liveness is derived, never stored: a revoked grant must not be live,
	// and an expired one must not be live either.
	liveAt := func(state EgressGrantState, at time.Time) bool {
		return !state.Revoked && state.Grant.ExpiresAt.After(at)
	}
	if liveAt(states[0], testEpoch) {
		t.Fatal("a revoked grant must not be live")
	}
	if liveAt(EgressGrantState{}, testEpoch) {
		t.Fatal("an empty grant must not be live")
	}
	unrevoked := states[0]
	unrevoked.Revoked = false
	if !liveAt(unrevoked, testEpoch.Add(-time.Hour)) {
		t.Fatal("a future-expiry unrevoked grant must be live before expiry")
	}
	if liveAt(unrevoked, testEpoch.Add(48*time.Hour)) {
		t.Fatal("an expired grant must not be live")
	}
	revocations, err := store.ListEgressGrantRevocations(ctx, workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if len(revocations) != 1 || revocations[0].GrantID != grant.ID {
		t.Fatalf("revocations = %+v", revocations)
	}
}

// TestEgressGrantsAndRevocationsRejectUpdateAndDelete proves the append-only
// triggers on both tables.
func TestEgressGrantsAndRevocationsRejectUpdateAndDelete(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	defer store.Close()
	workspaceID := newEgressWorkspace(t, store)

	grant := testEgressGrant(t, workspaceID)
	if err := store.Update(ctx, func(tx *Tx) error { return tx.InsertEgressGrant(ctx, &grant) }); err != nil {
		t.Fatal(err)
	}
	revocation := EgressGrantRevocation{
		ID: testID(t, IDPrefixEgressRevocation), WorkspaceID: workspaceID, GrantID: grant.ID,
		Reason: "rotation", RevokedBy: "operator", RevokedAt: testEpoch,
	}
	if err := store.Update(ctx, func(tx *Tx) error { return tx.InsertEgressGrantRevocation(ctx, &revocation) }); err != nil {
		t.Fatal(err)
	}
	statements := []struct {
		name string
		sql  string
		args []any
	}{
		{"grant update", `UPDATE egress_grants SET max_requests = 1 WHERE grant_id = ?`, []any{grant.ID}},
		{"grant delete", `DELETE FROM egress_grants WHERE grant_id = ?`, []any{grant.ID}},
		{"revocation update", `UPDATE egress_grant_revocations SET reason = 'x' WHERE revocation_id = ?`, []any{revocation.ID}},
		{"revocation delete", `DELETE FROM egress_grant_revocations WHERE revocation_id = ?`, []any{revocation.ID}},
	}
	for _, statement := range statements {
		t.Run(statement.name, func(t *testing.T) {
			_, err := store.db.ExecContext(ctx, statement.sql, statement.args...)
			if err == nil {
				t.Fatalf("%s must abort: grants and revocations are append-only", statement.name)
			}
			if !strings.Contains(err.Error(), "immutable") {
				t.Fatalf("%s error = %v, want an immutability abort", statement.name, err)
			}
		})
	}
	// The rows are still exactly as written.
	states, err := store.ListEgressGrantStates(ctx, workspaceID, EgressGrantMatch{}, grant.ID)
	if err != nil || len(states) != 1 || states[0].Grant.MaxRequests != grant.MaxRequests || !states[0].Revoked {
		t.Fatalf("states after rejected mutations = %+v (%v)", states, err)
	}
}

// TestInsertEgressGrantRefusesInvalidRows keeps the ledger honest: an
// unbounded budget, an unknown purpose, or a missing expiry never becomes a
// durable authorization.
func TestInsertEgressGrantRefusesInvalidRows(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	defer store.Close()
	workspaceID := newEgressWorkspace(t, store)

	tests := []struct {
		name   string
		mutate func(*EgressGrant)
	}{
		{"zero requests", func(g *EgressGrant) { g.MaxRequests = 0 }},
		{"zero bytes", func(g *EgressGrant) { g.MaxBytes = 0 }},
		{"zero seconds", func(g *EgressGrant) { g.MaxSeconds = 0 }},
		{"unknown purpose", func(g *EgressGrant) { g.Purpose = "TRAINING" }},
		{"missing expiry", func(g *EgressGrant) { g.ExpiresAt = time.Time{} }},
		{"missing classes", func(g *EgressGrant) { g.DataClasses = nil }},
		{"empty class", func(g *EgressGrant) { g.SubjectClasses = []string{""} }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			grant := testEgressGrant(t, workspaceID)
			grant.ID = testID(t, IDPrefixEgressGrant)
			test.mutate(&grant)
			if err := store.Update(ctx, func(tx *Tx) error { return tx.InsertEgressGrant(ctx, &grant) }); err == nil {
				t.Fatalf("invalid grant must be refused")
			}
		})
	}
}
