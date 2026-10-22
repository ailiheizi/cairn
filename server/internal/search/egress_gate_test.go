package search

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

// staticGrantLookup returns exactly the grants a test seeds.
type staticGrantLookup struct {
	grants []EgressGrant
	err    error
}

func (l staticGrantLookup) EgressGrants(_ context.Context, _ EgressGrantQuery) ([]EgressGrant, error) {
	if l.err != nil {
		return nil, l.err
	}
	return l.grants, nil
}

func gateTestResolver(secret string) OnlineCredentialResolver {
	return EnvOnlineCredentialResolver{Lookup: func(name string) (string, bool) {
		if name == "RW_GATE_TEST_KEY" {
			return secret, true
		}
		return "", false
	}}
}

func gateTestRequest(t *testing.T, profile OnlineEmbeddingProfile, now time.Time) EgressGateRequest {
	t.Helper()
	return EgressGateRequest{
		ProviderKind:            "online",
		ProfileID:               profile.ProfileID,
		ProfileDigest:           profile.ProviderProfileDigest(),
		Endpoint:                profile.Endpoint,
		EndpointHost:            profile.EndpointHost(),
		ModelID:                 profile.ModelID,
		Purpose:                 EgressPurposeDocument,
		DataClasses:             []string{EgressDataClassTextSegment},
		SubjectOutcomes:         []EgressSubjectOutcome{{SubjectID: "subj_1", Class: EgressSubjectClassExactProtected}},
		CredentialRef:           "env://RW_GATE_TEST_KEY",
		ContentDigest:           "sha256:" + strings.Repeat("c", 64),
		ProfileEgress:           profile.Egress,
		ProfileBudget:           profile.Egress.Budgets,
		SendWithoutConfirmation: true,
		AuditRequired:           true,
		AuditAttached:           true,
		Now:                     now,
	}
}

func gateTestGrant(profile OnlineEmbeddingProfile, now time.Time) EgressGrant {
	grant := testOnlineGrant(profile, now)
	return grant
}

// TestAdmitEgressRefusalsAreTypedAndFailClosed covers every gate refusal with
// a stable reason. Every case must be refused before any content could move.
func TestAdmitEgressRefusalsAreTypedAndFailClosed(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	profile := testOnlineProfile(t, "https://api.example.invalid/v1/embeddings")
	base := gateTestGrant(profile, now)

	tests := []struct {
		name   string
		mutate func(*EgressGateRequest, *staticGrantLookup)
		want   SemanticEgressReason
	}{
		{"no grant", func(_ *EgressGateRequest, lookup *staticGrantLookup) {
			lookup.grants = nil
		}, EgressReasonGrantMissing},
		{"grant ledger unavailable", func(_ *EgressGateRequest, lookup *staticGrantLookup) {
			lookup.err = errors.New("catalog offline")
		}, EgressReasonGrantStoreUnavailable},
		{"expired grant", func(_ *EgressGateRequest, lookup *staticGrantLookup) {
			expired := base
			expired.ExpiresAt = now.Add(-time.Minute)
			lookup.grants = []EgressGrant{expired}
		}, EgressReasonGrantExpired},
		{"revoked grant", func(_ *EgressGateRequest, lookup *staticGrantLookup) {
			revoked := base
			revoked.Revoked = true
			revoked.RevocationID = "egr_0123456789abcdef0123456789abcdef"
			revoked.RevokedReason = "key rotation"
			lookup.grants = []EgressGrant{revoked}
		}, EgressReasonGrantRevoked},
		{"grant does not cover the data class", func(_ *EgressGateRequest, lookup *staticGrantLookup) {
			narrow := base
			narrow.DataClasses = []string{EgressDataClassTextQuery}
			lookup.grants = []EgressGrant{narrow}
		}, EgressReasonDataClassDenied},
		{"grant does not cover the subject class", func(_ *EgressGateRequest, lookup *staticGrantLookup) {
			narrow := base
			narrow.SubjectClasses = []string{EgressSubjectClassExternalReplayable}
			lookup.grants = []EgressGrant{narrow}
		}, EgressReasonSubjectClassDenied},
		{"profile does not declare the data class", func(request *EgressGateRequest, _ *staticGrantLookup) {
			request.ProfileEgress.DisclosedDataClasses = []string{EgressDataClassTextQuery}
		}, EgressReasonDataClassDenied},
		{"unknown data class", func(request *EgressGateRequest, _ *staticGrantLookup) {
			request.DataClasses = []string{"text.unknown"}
		}, EgressReasonDataClassDenied},
		{"profile expired", func(request *EgressGateRequest, _ *staticGrantLookup) {
			request.ProfileEgress.Expiry = now.Add(-time.Hour).Format(time.RFC3339)
		}, EgressReasonProfileExpired},
		{"profile revoked", func(request *EgressGateRequest, _ *staticGrantLookup) {
			request.ProfileEgress.RevocationRef = "env://RW_GATE_TEST_KEY"
		}, EgressReasonProfileRevoked},
		{"unbounded profile budget", func(request *EgressGateRequest, _ *staticGrantLookup) {
			request.ProfileBudget = EgressBudget{MaxRequests: 0, MaxBytes: 1, MaxSeconds: 1}
		}, EgressReasonProfileUnresolved},
		{"confirmation required", func(request *EgressGateRequest, _ *staticGrantLookup) {
			request.SendWithoutConfirmation = false
		}, EgressReasonConfirmationRequired},
		{"confirmation names another grant", func(request *EgressGateRequest, _ *staticGrantLookup) {
			request.SendWithoutConfirmation = false
			request.Confirmation = &SemanticEgressConfirmation{
				ProfileDigest: profile.ProviderProfileDigest(), EndpointHost: profile.EndpointHost(),
				ModelID: profile.ModelID, Purpose: SemanticEmbeddingDocument,
				GrantID: "egt_ffffffffffffffffffffffffffffffff",
			}
		}, EgressReasonConfirmationMismatch},
		{"confirmation for another disclosure", func(request *EgressGateRequest, _ *staticGrantLookup) {
			request.SendWithoutConfirmation = false
			request.Confirmation = &SemanticEgressConfirmation{
				ProfileDigest: profile.ProviderProfileDigest(), EndpointHost: profile.EndpointHost(),
				ModelID: profile.ModelID, Purpose: SemanticEmbeddingDocument, GrantID: base.ID,
				ContentDigest: "sha256:" + strings.Repeat("d", 64),
			}
		}, EgressReasonConfirmationMismatch},
		{"audit required but unattached", func(request *EgressGateRequest, _ *staticGrantLookup) {
			request.AuditAttached = false
		}, EgressReasonAuditUnavailable},
		{"missing credential", func(request *EgressGateRequest, _ *staticGrantLookup) {
			request.CredentialRef = ""
		}, EgressReasonCredentialUnresolved},
		{"unknown purpose", func(request *EgressGateRequest, _ *staticGrantLookup) {
			request.Purpose = "TRAINING"
		}, EgressReasonRequestInvalid},
		{"missing clock", func(request *EgressGateRequest, _ *staticGrantLookup) {
			request.Now = time.Time{}
		}, EgressReasonRequestInvalid},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := gateTestRequest(t, profile, now)
			lookup := &staticGrantLookup{grants: []EgressGrant{base}}
			test.mutate(&request, lookup)
			admission, _, err := AdmitEgress(context.Background(), request,
				EgressGateDeps{Credential: gateTestResolver("gate-secret-value"), Grants: lookup})
			if err == nil {
				t.Fatalf("expected %s, got admission %+v", test.want, admission)
			}
			if got := SemanticEgressReasonOf(err); got != test.want {
				t.Fatalf("reason = %q (%v), want %q", got, err, test.want)
			}
			if !errors.Is(err, ErrSemanticProviderUnavailable) {
				t.Fatalf("refusal must degrade as ErrSemanticProviderUnavailable: %v", err)
			}
			if strings.Contains(err.Error(), "gate-secret-value") {
				t.Fatalf("refusal leaked the credential: %v", err)
			}
		})
	}
}

// TestAdmitEgressAdmitsWithLiveGrant proves the admitted shape: grant id,
// disclosed classes, the tighter budget, and the redacted credential
// reference.
func TestAdmitEgressAdmitsWithLiveGrant(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	profile := testOnlineProfile(t, "https://api.example.invalid/v1/embeddings")
	grant := gateTestGrant(profile, now)
	grant.MaxBytes = 512
	request := gateTestRequest(t, profile, now)
	request.DataClasses = []string{EgressDataClassTextSegment, EgressDataClassTextQuery}
	admission, credential, err := AdmitEgress(context.Background(), request,
		EgressGateDeps{Credential: gateTestResolver("gate-secret-value"), Grants: staticGrantLookup{grants: []EgressGrant{grant}}})
	if err != nil {
		t.Fatalf("admit: %v", err)
	}
	if admission.GrantID != grant.ID || admission.ProfileDigest != profile.ProviderProfileDigest() {
		t.Fatalf("admission = %+v", admission)
	}
	if admission.Authorization != SemanticEgressAuthorizationConfig {
		t.Fatalf("authorization = %q", admission.Authorization)
	}
	if admission.Budget.MaxBytes != 512 || admission.Budget.MaxRequests != profile.Egress.Budgets.MaxRequests {
		t.Fatalf("effective budget = %+v, want the tighter grant ceiling", admission.Budget)
	}
	if admission.CredentialRef != "env://RW_GATE_TEST_KEY" {
		t.Fatalf("admission credential ref = %q, want the redacted reference", admission.CredentialRef)
	}
	if credential.Value() != "gate-secret-value" {
		t.Fatal("the resolved credential must reach the caller for the one permitted request")
	}
}

// TestEgressRunBudgetEnforcesRequestsBytesAndDeadline proves budget exhaustion
// is a typed refusal, never a partial silent success.
func TestEgressRunBudgetEnforcesRequestsBytesAndDeadline(t *testing.T) {
	start := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	budget := EgressBudget{MaxRequests: 2, MaxBytes: 100, MaxSeconds: 60}

	t.Run("requests", func(t *testing.T) {
		run := NewEgressRunBudget(start)
		for i := 0; i < 2; i++ {
			if err := run.Admit(start, 10, budget); err != nil {
				t.Fatalf("request %d refused: %v", i+1, err)
			}
			run.Record(10)
		}
		err := run.Admit(start, 10, budget)
		if SemanticEgressReasonOf(err) != EgressReasonBudgetExceeded {
			t.Fatalf("request 3 error = %v, want %s", err, EgressReasonBudgetExceeded)
		}
	})
	t.Run("bytes", func(t *testing.T) {
		run := NewEgressRunBudget(start)
		if err := run.Admit(start, 40, budget); err != nil {
			t.Fatal(err)
		}
		run.Record(40)
		err := run.Admit(start, 61, budget)
		if SemanticEgressReasonOf(err) != EgressReasonBudgetExceeded {
			t.Fatalf("oversized request error = %v, want %s", err, EgressReasonBudgetExceeded)
		}
	})
	t.Run("deadline", func(t *testing.T) {
		run := NewEgressRunBudget(start)
		if err := run.Admit(start, 10, budget); err != nil {
			t.Fatal(err)
		}
		err := run.Admit(start.Add(61*time.Second), 10, budget)
		if SemanticEgressReasonOf(err) != EgressReasonBudgetExceeded {
			t.Fatalf("late request error = %v, want %s", err, EgressReasonBudgetExceeded)
		}
	})
	t.Run("unbounded ceiling is refused", func(t *testing.T) {
		run := NewEgressRunBudget(start)
		err := run.Admit(start, 10, EgressBudget{})
		if SemanticEgressReasonOf(err) != EgressReasonProfileUnresolved {
			t.Fatalf("unbounded budget error = %v, want %s", err, EgressReasonProfileUnresolved)
		}
	})
}

// TestOnlineProviderRefusesBeforeAnyNetworkCallWhenGrantIsMissing is the exit
// test's core property: the transport is never invoked without a live grant.
func TestOnlineProviderRefusesBeforeAnyNetworkCallWhenGrantIsMissing(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	built.grants.setGrants() // no grant at all
	provider := mustTestOnlineProvider(t, built.options)
	err := onlineEmbedErr(t, provider, context.Background(), onlineDocumentRequest(built.options.Manifest, "no grant text"))
	assertEgressRefused(t, err, stub, built.sink, EgressReasonGrantMissing)
	if built.grants.callCount() == 0 {
		t.Fatal("the gate must consult the durable grant ledger")
	}
	if strings.Contains(err.Error(), "no grant text") {
		t.Fatalf("refusal leaked payload: %v", err)
	}
}

// TestOnlineProviderRefusesExpiredAndRevokedGrantsWithOwnReasons proves the
// lifetime refusals keep distinct stable reasons.
func TestOnlineProviderRefusesExpiredAndRevokedGrantsWithOwnReasons(t *testing.T) {
	now := time.Now().UTC()
	tests := []struct {
		name   string
		grant  func(profile OnlineEmbeddingProfile) EgressGrant
		reason SemanticEgressReason
	}{
		{"expired", func(profile OnlineEmbeddingProfile) EgressGrant {
			grant := testOnlineGrant(profile, now)
			grant.ExpiresAt = now.Add(-time.Second)
			return grant
		}, EgressReasonGrantExpired},
		{"revoked", func(profile OnlineEmbeddingProfile) EgressGrant {
			grant := testOnlineGrant(profile, now)
			grant.Revoked = true
			return grant
		}, EgressReasonGrantRevoked},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			stub := newOnlineStub(t, 4)
			profile := testOnlineProfile(t, stub.server.URL)
			built := testOnlineProviderOptions(t, profile)
			built.grants.setGrants(test.grant(profile))
			provider := mustTestOnlineProvider(t, built.options)
			err := onlineEmbedErr(t, provider, context.Background(), onlineDocumentRequest(built.options.Manifest, "text"))
			assertEgressRefused(t, err, stub, built.sink, test.reason)
		})
	}
}

// TestOnlineProviderStillRequiresGrantWithoutConfirmation proves the config
// switch skips only the confirmation, never the grant.
func TestOnlineProviderStillRequiresGrantWithoutConfirmation(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	built.options.SendContentWithoutConfirmation = true
	built.grants.setGrants()
	provider := mustTestOnlineProvider(t, built.options)
	err := onlineEmbedErr(t, provider, context.Background(), onlineDocumentRequest(built.options.Manifest, "text"))
	if reason := SemanticEgressReasonOf(err); reason != EgressReasonGrantMissing {
		t.Fatalf("reason = %q (%v), want %s", reason, err, EgressReasonGrantMissing)
	}
	if stub.callCount() != 0 {
		t.Fatal("a missing grant must be refused before any network call")
	}
}

// TestOnlineProviderRecordsGrantBoundReceipt proves one receipt per attempt
// with the grant, class, credential reference, output, and budget fields, and
// no payload text or credential value.
func TestOnlineProviderRecordsGrantBoundReceipt(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	provider := mustTestOnlineProvider(t, built.options)
	text := "grant bound receipt text"
	request := onlineDocumentRequest(built.options.Manifest, text)
	vectors, err := provider.Embed(context.Background(), request)
	if err != nil {
		t.Fatalf("embed: %v", err)
	}
	records := built.sink.snapshot()
	if len(records) != 1 {
		t.Fatalf("receipts = %d, want exactly 1", len(records))
	}
	record := records[0]
	if record.GrantID != testOnlineGrantID {
		t.Fatalf("receipt grant id = %q, want %q", record.GrantID, testOnlineGrantID)
	}
	if len(record.DisclosedDataClasses) != 1 || record.DisclosedDataClasses[0] != EgressDataClassTextSegment {
		t.Fatalf("receipt data classes = %+v", record.DisclosedDataClasses)
	}
	if record.CredentialRef != "env://RW_TEST_ONLINE_KEY" {
		t.Fatalf("receipt credential ref = %q, want the redacted reference", record.CredentialRef)
	}
	if !record.RequestSent {
		t.Fatal("a successful attempt must record RequestSent=true")
	}
	if record.OutputDigest == "" || record.OutputDigest != SemanticEgressOutputDigest(vectors) {
		t.Fatalf("receipt output digest = %q", record.OutputDigest)
	}
	if record.OutputSchemaRef != OnlineEmbeddingOutputSchema {
		t.Fatalf("receipt output schema = %q, want %q", record.OutputSchemaRef, OnlineEmbeddingOutputSchema)
	}
	if record.Truncated {
		t.Fatal("the current profile never truncates locally; the receipt must not claim it did")
	}
	if record.BudgetUsage.Requests != 1 || record.BudgetUsage.Bytes != record.PayloadBytes {
		t.Fatalf("receipt budget usage = %+v, want 1 request and %d bytes", record.BudgetUsage, record.PayloadBytes)
	}
	encoded, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{text, testOnlineSecret, "Bearer"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("receipt leaked %q: %s", forbidden, encoded)
		}
	}
}

// TestOnlineProviderBudgetExhaustionIsTypedNotPartial proves a run that
// exceeds its request budget fails the whole call and never returns partial
// vectors.
func TestOnlineProviderBudgetExhaustionIsTypedNotPartial(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	profile.MaxBatchInputs = 1
	profile.Egress.Budgets = EgressBudget{MaxRequests: 1, MaxBytes: 1 << 20, MaxSeconds: 120}
	built := testOnlineProviderOptions(t, profile)
	built.grants.setGrants(testOnlineGrant(profile, time.Now().UTC()))
	provider := mustTestOnlineProvider(t, built.options)
	vectors, err := provider.Embed(context.Background(), onlineDocumentRequest(built.options.Manifest, "one", "two"))
	if reason := SemanticEgressReasonOf(err); reason != EgressReasonBudgetExceeded {
		t.Fatalf("reason = %q (%v), want %s", reason, err, EgressReasonBudgetExceeded)
	}
	if vectors != nil {
		t.Fatalf("a budget exhaustion must not return partial vectors: %+v", vectors)
	}
	if stub.callCount() != 1 {
		t.Fatalf("network calls = %d, want exactly 1 before the budget closed", stub.callCount())
	}
	records := built.sink.snapshot()
	if len(records) != 2 {
		t.Fatalf("receipts = %d, want one success and one refused attempt", len(records))
	}
	if !records[0].RequestSent || records[1].RequestSent {
		t.Fatalf("receipt RequestSent flags = %t/%t, want true/false", records[0].RequestSent, records[1].RequestSent)
	}
	if records[1].Reason != EgressReasonBudgetExceeded {
		t.Fatalf("refusal receipt reason = %q", records[1].Reason)
	}
}

// TestOnlineProviderSubjectsMustCarryAdmittedClasses proves an unclassifiable
// subject is refused instead of being disclosed under an assumed class.
func TestOnlineProviderSubjectsMustCarryAdmittedClasses(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	built.options.SubjectPolicy = stubSubjectPolicy{allowed: map[string]bool{"subj_1": true}, class: "SOMETHING_ELSE"}
	provider := mustTestOnlineProvider(t, built.options)
	err := onlineEmbedErr(t, provider, context.Background(), onlineDocumentRequest(built.options.Manifest, "unclassified text"))
	assertEgressRefused(t, err, stub, built.sink, EgressReasonSubjectClassDenied)
}

func TestSemanticEgressOutputDigestIsDeterministicAndBound(t *testing.T) {
	first := []SemanticVector{{SubjectID: "subj_1", SegmentID: "seg_1", Vector: []float32{0.5, 0.5}}}
	same := []SemanticVector{{SubjectID: "subj_1", SegmentID: "seg_1", Vector: []float32{0.5, 0.5}}}
	different := []SemanticVector{{SubjectID: "subj_1", SegmentID: "seg_2", Vector: []float32{0.5, 0.5}}}
	if SemanticEgressOutputDigest(first) != SemanticEgressOutputDigest(same) {
		t.Fatal("identical outputs must produce the same digest")
	}
	if SemanticEgressOutputDigest(first) == SemanticEgressOutputDigest(different) {
		t.Fatal("a different segment identity must change the output digest")
	}
	if !strings.HasPrefix(SemanticEgressOutputDigest(first), "sha256:") {
		t.Fatal("the output digest must be a sha256 digest")
	}
}

func TestEgressScopeVocabularyIsClosed(t *testing.T) {
	// The closed data-class vocabulary includes the embedding, describe, image,
	// and admitted material-list organizer classes.
	if len(EgressDataClasses()) != 5 {
		t.Fatalf("data classes = %+v", EgressDataClasses())
	}
	for _, class := range []string{EgressDataClassTextSegment, EgressDataClassTextQuery, EgressDataClassTextSubjectContext, EgressDataClassImageBytes, EgressDataClassTextMaterialList} {
		if !ValidEgressDataClass(class) {
			t.Fatalf("data class %q must be valid", class)
		}
	}
	if ValidEgressDataClass("text.secret") {
		t.Fatal("an unknown data class must be refused")
	}
	if len(EgressSubjectClasses()) != 3 {
		t.Fatalf("subject classes = %+v", EgressSubjectClasses())
	}
	if ValidEgressSubjectClass("EXACT_MAYBE") {
		t.Fatal("an unknown subject class must be refused")
	}
	if !ValidEgressPurpose(EgressPurposeDocument) || !ValidEgressPurpose(EgressPurposeQuery) ||
		!ValidEgressPurpose(EgressPurposeDescribe) || !ValidEgressPurpose(EgressPurposeOrganize) || ValidEgressPurpose("OTHER") {
		t.Fatal("purpose vocabulary must be exactly DOCUMENT, QUERY, DESCRIBE, and ORGANIZE")
	}
	if EgressDataClassForPurpose(EgressPurposeQuery) != EgressDataClassTextQuery ||
		EgressDataClassForPurpose(EgressPurposeDocument) != EgressDataClassTextSegment ||
		EgressDataClassForPurpose(EgressPurposeOrganize) != EgressDataClassTextMaterialList {
		t.Fatal("data class mapping does not match the purpose vocabulary")
	}
}

func TestAllSemanticEgressReasonsAreUniqueAndClassifiable(t *testing.T) {
	seen := map[SemanticEgressReason]bool{}
	for _, reason := range AllSemanticEgressReasons() {
		if seen[reason] {
			t.Fatalf("duplicate reason %s", reason)
		}
		seen[reason] = true
		if !IsSemanticEgressReason(string(reason)) {
			t.Fatalf("reason %s is not classifiable", reason)
		}
	}
	for _, want := range []SemanticEgressReason{
		EgressReasonGrantMissing, EgressReasonGrantExpired, EgressReasonGrantRevoked,
		EgressReasonProfileExpired, EgressReasonProfileRevoked, EgressReasonBudgetExceeded,
		EgressReasonDataClassDenied, EgressReasonSubjectClassDenied,
	} {
		if !seen[want] {
			t.Fatalf("reason %s is missing from the vocabulary", want)
		}
	}
	if IsSemanticEgressReason("SOME_OTHER_FAILURE") {
		t.Fatal("an unrelated reason must not be classified as an egress reason")
	}
	if got := SemanticEgressReasonFromText(fmt.Sprintf("online provider refused: %s (x)", EgressReasonBudgetExceeded)); got != EgressReasonBudgetExceeded {
		t.Fatalf("text classification = %q", got)
	}
	if got := SemanticEgressReasonFromText("worker exited"); got != "" {
		t.Fatalf("unrelated text classified as %q", got)
	}
}

// TestEgressReasonsSurviveIndexerWrapping proves the disposable-index
// degradation keeps the provider's stable egress reason, so search.query and
// search.rebuild can report EGRESS_CONFIRMATION_REQUIRED instead of a generic
// unavailable component.
func TestEgressReasonsSurviveIndexerWrapping(t *testing.T) {
	refusal := refusedEgress(EgressReasonConfirmationRequired, "send_content_without_confirmation", "no confirmation")
	wrapped := fmt.Errorf("%w: provider: %w", ErrUnavailable, refusal)
	if got := SemanticEgressReasonOf(wrapped); got != EgressReasonConfirmationRequired {
		t.Fatalf("wrapped reason = %q (%v)", got, wrapped)
	}
	if !errors.Is(wrapped, ErrUnavailable) {
		t.Fatalf("the wrapped failure must still degrade as ErrUnavailable: %v", wrapped)
	}
	if got := QueryFailureReason(DimensionSemantic, wrapped); got != string(EgressReasonConfirmationRequired) {
		t.Fatalf("component reason = %q, want %s", got, EgressReasonConfirmationRequired)
	}
	// A stored diagnostic is classified as well, so a persisted failure keeps
	// its stable reason after a restart.
	idx := &Indexer{SemanticProvider: &fakeSemanticProvider{ready: false, failure: "online provider FAILED: " + string(EgressReasonBudgetExceeded)}}
	if got := idx.SemanticFailureReason(); got != EgressReasonBudgetExceeded {
		t.Fatalf("stored failure reason = %q, want %s", got, EgressReasonBudgetExceeded)
	}
	plain := &Indexer{SemanticProvider: &fakeSemanticProvider{ready: false, failure: "worker exited"}}
	if got := plain.SemanticFailureReason(); got != "" {
		t.Fatalf("unrelated stored failure classified as %q", got)
	}
}

func TestQueryFailureReasonPreservesSemanticQueryTruncation(t *testing.T) {
	err := ErrSemanticQueryInputTruncated
	if !errors.Is(err, ErrInvalidQuery) {
		t.Fatalf("semantic truncation sentinel must remain an invalid caller query: %v", err)
	}
	if got := QueryFailureReason(DimensionSemantic, err); got != SemanticQueryInputTruncatedReason {
		t.Fatalf("semantic truncation reason = %q, want %s", got, SemanticQueryInputTruncatedReason)
	}
	if got := QueryFailureReason(DimensionSemantic, ErrInvalidQuery); got != "QUERY_FAILED" {
		t.Fatalf("ordinary invalid query reason = %q, want existing generic reason", got)
	}
}
