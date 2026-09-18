package controlplane

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/restoreweave/server/internal/search"
	"github.com/ailiheizi/restoreweave/server/internal/store/sqlite"
	"github.com/ailiheizi/restoreweave/server/testutil"
)

func mustStableID(t *testing.T, prefix string) string {
	t.Helper()
	id, err := sqlite.NewStableID(prefix)
	if err != nil {
		t.Fatalf("generate stable id: %v", err)
	}
	return id
}

func mustDefaultWorkspace(t *testing.T, store *sqlite.Store) string {
	t.Helper()
	ctx := context.Background()
	workspaceID, err := sqlite.NewStableID(sqlite.IDPrefixWorkspace)
	if err != nil {
		t.Fatal(err)
	}
	workspace := sqlite.Workspace{ID: workspaceID, Name: "default"}
	if err := store.Update(ctx, func(tx *sqlite.Tx) error {
		return tx.InsertWorkspace(ctx, &workspace)
	}); err != nil {
		t.Fatalf("create default workspace: %v", err)
	}
	return workspaceID
}

func testEgressRecord() search.SemanticEgressRecord {
	started := time.Date(2026, 9, 18, 8, 0, 0, 0, time.UTC)
	return search.SemanticEgressRecord{
		ProviderProfile:        "operator-online-v1",
		ProviderProfileDigest:  "sha256:" + strings.Repeat("1", 64),
		SpaceFingerprint:       "online-embedding:stub/stub-embed-v1@2026-09-18-4d-l2-abcdef123456",
		SpaceFingerprintDigest: "sha256:" + strings.Repeat("2", 64),
		ModelID:                "stub-embed-v1",
		ModelRevision:          "2026-09-18",
		Dimension:              4,
		InputType:              "document",
		Normalization:          "l2",
		APIStyle:               "openai-embeddings-v1",
		EndpointHost:           "127.0.0.1:8099",
		TrainingUse:            "unknown",
		RetentionDeclaration:   "vendor policy unverified",
		Purpose:                "DOCUMENT",
		GenerationID:           "idx_generation",
		ItemCount:              2,
		TextBytes:              42,
		TextDigests:            []string{"sha256:" + strings.Repeat("3", 64), "sha256:" + strings.Repeat("4", 64)},
		RequestDigest:          "sha256:" + strings.Repeat("5", 64),
		PayloadDigest:          "sha256:" + strings.Repeat("6", 64),
		PayloadBytes:           256,
		Authorization:          search.SemanticEgressAuthorizationConfig,
		HTTPStatus:             200,
		Outcome:                search.SemanticEgressOutcomeSucceeded,
		StartedAt:              started,
		CompletedAt:            started.Add(120 * time.Millisecond),
		GrantID:                "egt_0123456789abcdef0123456789abcdef",
		DisclosedDataClasses:   []string{search.EgressDataClassTextSegment},
		CredentialRef:          "env://RW_TEST_ONLINE_KEY",
		RequestSent:            true,
		OutputDigest:           "sha256:" + strings.Repeat("7", 64),
		Truncated:              false,
		OutputSchemaRef:        search.OnlineEmbeddingOutputSchema,
		BudgetUsage:            search.EgressBudgetUsage{Requests: 1, Bytes: 256, Seconds: 1},
	}
}

// TestSemanticEgressSinkAppendsDigestOnlyReceipts proves the receipt shape:
// one append-only audit event per attempted egress carrying provider, space,
// model, digests, counts, authorization, and timestamps, and no payload text.
func TestSemanticEgressSinkAppendsDigestOnlyReceipts(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	workspaceID := mustDefaultWorkspace(t, store)
	sink := NewSemanticEgressAuditSink(store)
	record := testEgressRecord()
	if err := sink.RecordSemanticEgress(ctx, record); err != nil {
		t.Fatalf("record egress: %v", err)
	}
	failed := record
	failed.Outcome = search.SemanticEgressOutcomeFailed
	failed.Reason = search.EgressReasonProviderQuota
	failed.Authorization = search.SemanticEgressAuthorizationRequest
	if err := sink.RecordSemanticEgress(ctx, failed); err != nil {
		t.Fatalf("record failed egress: %v", err)
	}
	events, err := store.ListAuditEvents(ctx, workspaceID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("audit events = %d, want 2 append-only receipts", len(events))
	}
	if events[0].Action != AuditActionSemanticEgressSucceeded || events[0].Outcome != search.SemanticEgressOutcomeSucceeded {
		t.Fatalf("first event = %+v", events[0])
	}
	if events[1].Action != AuditActionSemanticEgressFailed || events[1].Outcome != search.SemanticEgressOutcomeFailed {
		t.Fatalf("second event = %+v", events[1])
	}
	if events[0].TargetType != AuditTargetSemanticProvider || events[0].TargetID != record.ProviderProfile {
		t.Fatalf("receipt target = %s/%s", events[0].TargetType, events[0].TargetID)
	}
	if events[0].PreviousEventDigest != "" || events[1].PreviousEventDigest != events[0].EventDigest {
		t.Fatal("receipts must chain in the append-only ledger")
	}
	var details search.SemanticEgressRecord
	if err := json.Unmarshal(events[0].Details, &details); err != nil {
		t.Fatalf("decode receipt details: %v", err)
	}
	if details.SpaceFingerprintDigest != record.SpaceFingerprintDigest || details.PayloadDigest != record.PayloadDigest ||
		details.PayloadBytes != record.PayloadBytes || details.ItemCount != record.ItemCount ||
		details.TextBytes != record.TextBytes || len(details.TextDigests) != 2 {
		t.Fatalf("receipt digests/counts = %+v", details)
	}
	// The grant, class, credential reference, request/output provenance, and
	// budget consumption are part of the durable receipt.
	if details.GrantID != record.GrantID ||
		len(details.DisclosedDataClasses) != 1 || details.DisclosedDataClasses[0] != search.EgressDataClassTextSegment ||
		details.CredentialRef != record.CredentialRef || !details.RequestSent ||
		details.OutputDigest != record.OutputDigest || details.Truncated ||
		details.OutputSchemaRef != search.OnlineEmbeddingOutputSchema ||
		details.BudgetUsage != record.BudgetUsage {
		t.Fatalf("receipt provenance fields = %+v", details)
	}
	if !details.StartedAt.Equal(record.StartedAt) || !details.CompletedAt.Equal(record.CompletedAt) {
		t.Fatalf("receipt timestamps = %v .. %v", details.StartedAt, details.CompletedAt)
	}
	encoded, err := json.Marshal(events[0].Details)
	if err != nil {
		t.Fatal(err)
	}
	// The receipt carries no field for payload text or credentials; prove the
	// stored JSON contains none of the record's payload-shaped fields either.
	for _, forbidden := range []string{"\"text\"", "\"payload\"", "Bearer ", "Authorization"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("receipt details contain forbidden key %q: %s", forbidden, encoded)
		}
	}
}

func TestSemanticEgressSinkFailsClosedWithoutWorkspace(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	sink := NewSemanticEgressAuditSink(store)
	err := sink.RecordSemanticEgress(ctx, testEgressRecord())
	if err == nil || !strings.Contains(err.Error(), "default workspace") {
		t.Fatalf("unattributable receipt error = %v", err)
	}
}

// TestSemanticEgressSubjectPolicyFailsClosed proves only locally protected or
// independently replayable exact content may be disclosed.
func TestSemanticEgressSubjectPolicyFailsClosed(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	workspaceID := mustDefaultWorkspace(t, store)
	policy := NewSemanticEgressSubjectPolicy(store)

	insertProtection := func(record sqlite.ProtectionRecord) {
		t.Helper()
		record.ID = mustStableID(t, sqlite.IDPrefixProtectionRecord)
		record.WorkspaceID = workspaceID
		if err := store.InsertProtectionRecord(ctx, &record); err != nil {
			t.Fatalf("insert protection record %s: %v", record.SubjectRef, err)
		}
	}
	subjectID := func() string { return mustStableID(t, sqlite.IDPrefixSubject) }
	exactSubject, linkOnlySubject, blockedSubject, unknownSubject := subjectID(), subjectID(), subjectID(), subjectID()

	representationID, err := sqlite.NewStableID(sqlite.IDPrefixRepresentation)
	if err != nil {
		t.Fatal(err)
	}
	representation := sqlite.Representation{
		ID: representationID, WorkspaceID: workspaceID, ContentID: "sha256:" + strings.Repeat("a", 64),
		DecodedLength: 16, OwnershipMode: sqlite.OwnershipEngineManaged, CodecProfileRef: "restic-stream/v1",
		AccessMode: sqlite.AccessSequentialStream, WholeReadRequiredToVerify: true,
		RecordDigest: "sha256:" + strings.Repeat("b", 64),
	}
	if err := store.Update(ctx, func(tx *sqlite.Tx) error {
		return tx.InsertRepresentation(ctx, &representation)
	}); err != nil {
		t.Fatalf("insert representation: %v", err)
	}
	insertProtection(sqlite.ProtectionRecord{
		SubjectRef: exactSubject, Mode: sqlite.ProtectionStoreExact, Outcome: sqlite.ProtectionExactProtected,
		LocalRepresentationID: representation.ID, LastVerificationRef: "verification:test",
	})
	insertProtection(sqlite.ProtectionRecord{
		SubjectRef: linkOnlySubject, Mode: sqlite.ProtectionLinkOnly, Outcome: sqlite.ProtectionLinkOnlyUnprotected,
	})
	insertProtection(sqlite.ProtectionRecord{
		SubjectRef: blockedSubject, Mode: sqlite.ProtectionLinkOnly, Outcome: sqlite.ProtectionBlocked,
	})

	allowed, class, reason, _ := policy.SemanticEgressSubjectAllowed(ctx, exactSubject)
	if !allowed || reason != "" || class != search.EgressSubjectClassExactProtected {
		t.Fatalf("EXACT_PROTECTED subject refused: allowed=%v class=%q reason=%q", allowed, class, reason)
	}
	allowed, class, reason, detail := policy.SemanticEgressSubjectAllowed(ctx, linkOnlySubject)
	if allowed || reason != search.EgressReasonSubjectUnprotected || !strings.Contains(detail, "LINK_ONLY_UNPROTECTED") {
		t.Fatalf("LINK_ONLY_UNPROTECTED subject = %v/%q/%q/%q", allowed, class, reason, detail)
	}
	allowed, _, reason, _ = policy.SemanticEgressSubjectAllowed(ctx, blockedSubject)
	if allowed || reason != search.EgressReasonSubjectBlocked {
		t.Fatalf("BLOCKED subject = %v/%q", allowed, reason)
	}
	allowed, _, reason, _ = policy.SemanticEgressSubjectAllowed(ctx, unknownSubject)
	if allowed || reason != search.EgressReasonSubjectUnknown {
		t.Fatalf("unknown subject = %v/%q", allowed, reason)
	}
	allowed, _, reason, _ = policy.SemanticEgressSubjectAllowed(ctx, "")
	if allowed || reason != search.EgressReasonSubjectUnknown {
		t.Fatalf("empty subject = %v/%q", allowed, reason)
	}
}
