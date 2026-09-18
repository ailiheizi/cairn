package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/ailiheizi/restoreweave/server/internal/search"
	"github.com/ailiheizi/restoreweave/server/internal/store/sqlite"
)

// Remote embedding egress receipts
//
// The online embedding provider can only run when an append-only ledger is
// attached. Each attempted remote request appends exactly one audit event
// through this sink. The receipt records the provider profile, space
// fingerprint, model identity, the digests and byte counts of what was sent,
// the authorization that permitted it, timestamps, and the outcome. It never
// records the text that was sent, the credential, or the provider's response
// body: the details payload is built from search.SemanticEgressRecord, which
// has no payload fields.
//
// The audit ledger is append-only at the schema level: the audit_events
// triggers reject UPDATE and DELETE.

// Audit target and action vocabulary for remote embedding egress. These
// events share the single append-only audit_events ledger with snapshot
// verification receipts and plan events.
const (
	AuditTargetSemanticProvider        = "SEMANTIC_PROVIDER"
	AuditActionSemanticEgressSucceeded = "SEMANTIC_EGRESS_SUCCEEDED"
	AuditActionSemanticEgressFailed    = "SEMANTIC_EGRESS_FAILED"
	auditActorSemanticEgress           = "restoreweaved"
	auditSourceSemanticEgress          = "semantic.embedding.online"
)

type semanticEgressAuditSink struct {
	store *sqlite.Store
}

// NewSemanticEgressAuditSink returns the append-only receipt ledger used by
// the online embedding provider. It is deliberately narrow: the provider can
// append one record per attempted egress and cannot read, rewrite, or delete
// audit history.
func NewSemanticEgressAuditSink(store *sqlite.Store) search.SemanticEgressAuditSink {
	return semanticEgressAuditSink{store: store}
}

// RecordSemanticEgress implements search.SemanticEgressAuditSink.
func (s semanticEgressAuditSink) RecordSemanticEgress(ctx context.Context, record search.SemanticEgressRecord) error {
	if s.store == nil {
		return errors.New("semantic egress ledger requires an attached catalog")
	}
	workspaceID, err := semanticEgressWorkspaceID(ctx, s.store)
	if err != nil {
		return err
	}
	if strings.TrimSpace(record.ProviderProfile) == "" || strings.TrimSpace(record.SpaceFingerprint) == "" {
		return errors.New("semantic egress receipt requires a provider profile and space fingerprint")
	}
	details, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("encode semantic egress receipt: %w", err)
	}
	action := AuditActionSemanticEgressSucceeded
	outcome := search.SemanticEgressOutcomeSucceeded
	if record.Outcome == search.SemanticEgressOutcomeFailed {
		action = AuditActionSemanticEgressFailed
		outcome = search.SemanticEgressOutcomeFailed
	}
	return s.store.Update(ctx, func(tx *sqlite.Tx) error {
		auditEvent := sqlite.AuditEvent{
			ID:          mustAuditID(),
			WorkspaceID: workspaceID,
			Actor:       auditActorSemanticEgress,
			Action:      action,
			TargetType:  AuditTargetSemanticProvider,
			TargetID:    record.ProviderProfile,
			RequestID:   strings.TrimSpace(record.GenerationID),
			Source:      auditSourceSemanticEgress,
			Outcome:     outcome,
			Details:     details,
		}
		return tx.AppendAuditEvent(ctx, &auditEvent)
	})
}

// semanticEgressSubjectPolicy is the host protection authority for remote
// disclosure. It reads the current protection record of a subject and admits
// only outcomes that describe a locally protected or independently replayable
// exact copy. Every other state fails closed.
type semanticEgressSubjectPolicy struct {
	store *sqlite.Store
}

// NewSemanticEgressSubjectPolicy returns the catalog-backed protection policy
// used by the online embedding provider.
func NewSemanticEgressSubjectPolicy(store *sqlite.Store) search.SemanticEgressSubjectPolicy {
	return semanticEgressSubjectPolicy{store: store}
}

// SemanticEgressSubjectAllowed implements search.SemanticEgressSubjectPolicy.
func (p semanticEgressSubjectPolicy) SemanticEgressSubjectAllowed(ctx context.Context, subjectID string) (bool, search.SemanticEgressReason, string) {
	if p.store == nil {
		return false, search.EgressReasonSubjectPolicyUnavail, "no catalog is attached; protection cannot be established"
	}
	subjectID = strings.TrimSpace(subjectID)
	if subjectID == "" {
		return false, search.EgressReasonSubjectUnknown, "the subject identity is empty"
	}
	workspaceID, err := semanticEgressWorkspaceID(ctx, p.store)
	if err != nil {
		return false, search.EgressReasonSubjectPolicyUnavail, err.Error()
	}
	record, err := p.store.GetProtectionRecordBySubject(ctx, workspaceID, subjectID)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			return false, search.EgressReasonSubjectUnknown,
				"the subject has no protection record; unknown or unprotected content is never disclosed"
		}
		return false, search.EgressReasonSubjectPolicyUnavail, "reading the subject protection record failed"
	}
	switch record.Outcome {
	case sqlite.ProtectionExactProtected, sqlite.ProtectionExactFallback, sqlite.ProtectionExternalReplayable:
		return true, "", ""
	case sqlite.ProtectionLinkOnlyUnprotected:
		return false, search.EgressReasonSubjectUnprotected,
			"LINK_ONLY_UNPROTECTED content is never sent to a remote embedding provider"
	case sqlite.ProtectionExplicitlyUnprotected:
		return false, search.EgressReasonSubjectUnprotected,
			"explicitly unprotected content is never sent to a remote embedding provider"
	case sqlite.ProtectionBlocked:
		return false, search.EgressReasonSubjectBlocked, "the subject protection state is BLOCKED"
	default:
		return false, search.EgressReasonSubjectUnknown,
			"the subject protection outcome is not admitted for remote disclosure"
	}
}

// semanticEgressWorkspaceID resolves the workspace of the current single
// workspace profile. The audit ledger is workspace-scoped, so an unresolved
// workspace fails the egress closed instead of writing an unattributable
// receipt.
func semanticEgressWorkspaceID(ctx context.Context, store *sqlite.Store) (string, error) {
	workspace, err := store.GetWorkspaceByName(ctx, "default")
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			return "", errors.New("the catalog has no default workspace yet; the egress receipt cannot be attributed")
		}
		return "", fmt.Errorf("resolve workspace for semantic egress receipt: %w", err)
	}
	return workspace.ID, nil
}
