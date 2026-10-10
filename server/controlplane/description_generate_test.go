package controlplane

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

// seedExtractArtifact writes one admitted EXTRACT text artifact for a subject,
// including the terminal processor attempt the artifact trigger requires.
func seedExtractArtifact(t *testing.T, store *sqlite.Store, workspaceID, subjectRef, body string) string {
	t.Helper()
	ctx := context.Background()
	sum := sha256.Sum256([]byte(body))
	attemptID := mustTestID(t, sqlite.IDPrefixAttempt)
	if err := store.InsertProcessorAttempt(ctx, &sqlite.ProcessorAttempt{
		ID: attemptID, WorkspaceID: workspaceID, SubjectRef: subjectRef,
		SnapshotRef: "snap:test", RouteDigest: "sha256:route",
		Route: []byte(`{"kind":"PROCESSING","nodes":[]}`), Stage: "EXTRACT",
		CapabilityID: "extract:test", Status: "SUCCEEDED", ReasonCode: "ADMITTED_ARTIFACT",
		Provenance: []byte(`{"test":true}`), FenceToken: 1, ProcessorDigest: "sha256:producer",
	}); err != nil {
		t.Fatalf("insert attempt: %v", err)
	}
	artifactID := mustTestID(t, sqlite.IDPrefixArtifact)
	if err := store.InsertProcessorArtifact(ctx, &sqlite.ProcessorArtifact{
		ID: artifactID, WorkspaceID: workspaceID, SubjectRef: subjectRef,
		SnapshotRef: "snap:test", RouteDigest: "sha256:route", Stage: "EXTRACT",
		CapabilityID: "extract:test", SchemaRef: "schema:test", State: sqlite.ArtifactAdmitted,
		AuthorityClass: "STAGED_ARTIFACT", LifecycleClass: "REBUILDABLE", MediaType: "text/plain",
		ByteLength: int64(len(body)), Digest: "sha256:" + hex.EncodeToString(sum[:]), Body: body,
		AttemptID: attemptID, FenceToken: 1, ProducerDigest: "sha256:producer",
	}); err != nil {
		t.Fatalf("insert artifact: %v", err)
	}
	return artifactID
}

// seedExactProtection writes the protection record the describe subject policy
// requires before any subject may be disclosed. The egress policy, grant
// ledger, and receipt ledger resolve the single default workspace, so the
// fixture inserts its own admitted representation plus an EXACT_PROTECTED
// record there.
func seedExactProtection(t *testing.T, store *sqlite.Store, workspaceID, subjectRef string) {
	t.Helper()
	ctx := context.Background()
	representationID := mustTestID(t, sqlite.IDPrefixRepresentation)
	if err := store.Update(ctx, func(tx *sqlite.Tx) error {
		if err := tx.InsertRepresentation(ctx, &sqlite.Representation{
			ID: representationID, WorkspaceID: workspaceID, ContentID: "sha256:file-content",
			DecodedLength: 16, OwnershipMode: sqlite.OwnershipEngineManaged,
			CodecProfileRef: "raw/v1", AccessMode: sqlite.AccessSequentialStream,
			WholeReadRequiredToVerify: true, RecordDigest: "sha256:representation",
		}); err != nil {
			return err
		}
		verified := time.Now().UTC()
		return tx.InsertProtectionRecord(ctx, &sqlite.ProtectionRecord{
			ID: mustTestID(t, sqlite.IDPrefixProtectionRecord), WorkspaceID: workspaceID,
			SubjectRef: subjectRef, Mode: sqlite.ProtectionStoreExact, Outcome: sqlite.ProtectionExactProtected,
			ExpectedContentID: "sha256:file-content", LocalRepresentationID: representationID,
			PolicyDecisionRef: "policy:test", LastVerificationRef: "verification:test",
			LastVerifiedAt: &verified, Revision: 1,
		})
	}); err != nil {
		t.Fatalf("insert protection fixture: %v", err)
	}
}

// installDescribeProfile writes one valid describe profile manifest below a
// temp models root, pointed at the loopback stub endpoint.
func installDescribeProfile(t *testing.T, modelsRoot string, endpoint string) search.OnlineDescribeProfile {
	t.Helper()
	scope := func() search.OnlineEgressScope {
		return search.OnlineEgressScope{
			DestinationHost:       strings.TrimPrefix(strings.TrimPrefix(endpoint, "https://"), "http://"),
			DisclosedDataClasses:  []string{search.EgressDataClassTextSubjectContext},
			AllowedSubjectClasses: search.EgressSubjectClasses(),
			Minimization: search.OnlineEgressMinimization{
				Statement: "only the model id, the chat messages, and max_tokens are transmitted",
				Fields:    []string{"max_tokens", "messages", "model"},
			},
			Budgets:       search.EgressBudget{MaxRequests: 4, MaxBytes: 1 << 20, MaxSeconds: 120},
			Expiry:        time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339),
			RevocationRef: "env://RW_TEST_REVOKED_DESCRIBE",
			PolicyRefs: search.OnlineEgressPolicyRefs{
				Residency: "loopback-stub", Logging: "stub", Retention: "none",
				TrainingUse: "none", OutputUse: "operator-only",
			},
			AuditRequired: true,
		}
	}
	profile := search.OnlineDescribeProfile{
		Schema:            search.OnlineDescribeProfileSchemaV1,
		ProfileID:         "stub-describe-v1",
		Provider:          "stub",
		APIStyle:          search.OnlineDescribeAPIStyleOpenAI,
		Endpoint:          endpoint,
		ModelID:           "stub-describe-model",
		ModelRevision:     "2026-09-18",
		SystemInstruction: "You write short durable descriptions.",
		MaxOutputTokens:   512,
		MaxOutputBytes:    1 << 20,
		TimeoutMS:         5000,
		CredentialRef:     "env://RW_TEST_DESCRIBE_KEY",
		Egress:            scope(),
	}
	payload, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(modelsRoot, search.OnlineDescribeProfileDirName, profile.ProfileID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, search.OnlineDescribeProfileFileName), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	return profile
}

// newDescribeStub starts a loopback chat-completions stub that answers with a
// canned candidate and records the request bodies.
func newDescribeStub(t *testing.T, candidate string) (*httptest.Server, func() []map[string]any) {
	t.Helper()
	var (
		mu     sync.Mutex
		bodies []map[string]any
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		bodies = append(bodies, body)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model": "stub-describe-model",
			"choices": []map[string]any{{
				"message":       map[string]any{"role": "assistant", "content": candidate},
				"finish_reason": "stop",
			}},
		})
	}))
	t.Cleanup(server.Close)
	return server, func() []map[string]any {
		mu.Lock()
		defer mu.Unlock()
		return append([]map[string]any(nil), bodies...)
	}
}

// wireDescribeDispatcher builds a dispatcher with a real online describe
// provider bound to the loopback stub and an installed profile. The provider
// resolves its credential reference through the default host resolver, so the
// test sets the named environment variable explicitly.
func wireDescribeDispatcher(t *testing.T, store *sqlite.Store, endpoint, modelsRoot string) *Dispatcher {
	t.Helper()
	t.Setenv("RW_TEST_DESCRIBE_KEY", "resolved-describe-secret")
	profile := installDescribeProfile(t, modelsRoot, endpoint)
	provider, err := search.NewOnlineDescribeProvider(search.OnlineDescribeProviderOptions{
		Profile:       profile,
		AuditSink:     describeTestAuditSink{},
		SubjectPolicy: NewSemanticEgressSubjectPolicy(store),
		Grants:        NewSemanticEgressGrantLookup(store),
	})
	if err != nil {
		t.Fatalf("new describe provider: %v", err)
	}
	return NewDispatcher(store, "catalog.sqlite", "/tmp/cairn-describe.sock",
		WithConfigDigest("sha256:describe-config-v1"),
		WithDescribeProvider(provider, modelsRoot))
}

// describeTestAuditSink is the control-plane test's append-only receipt sink.
type describeTestAuditSink struct{}

func (describeTestAuditSink) RecordDescribeEgress(_ context.Context, _ search.DescribeEgressRecord) error {
	return nil
}

// createDescribeGrant creates a live grant through the typed operation and
// returns the confirmation input resolved from it. This is exactly the
// resolution the WebUI confirmation step performs against the live grant list.
func createDescribeGrant(t *testing.T, dispatcher *Dispatcher, workspaceID string, profile search.OnlineDescribeProfile) command.EgressGrantData {
	t.Helper()
	result := dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpEgressGrantCreate, map[string]any{
		"workspace_id":    workspaceID,
		"profile_id":      profile.ProfileID,
		"profile_digest":  profile.ProviderProfileDigest(),
		"endpoint_host":   profile.EndpointHost(),
		"model_id":        profile.ModelID,
		"purpose":         "DESCRIBE",
		"data_classes":    []string{search.EgressDataClassTextSubjectContext},
		"subject_classes": search.EgressSubjectClasses(),
		"max_requests":    profile.Egress.Budgets.MaxRequests,
		"max_bytes":       profile.Egress.Budgets.MaxBytes,
		"max_seconds":     profile.Egress.Budgets.MaxSeconds,
		"expires_at":      time.Now().UTC().Add(time.Hour).Format(time.RFC3339),
	}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("egress.grant.create status = %q: %+v", result.Status, result.Reasons)
	}
	var data command.EgressGrantData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	return data
}

func TestDescriptionGenerateUnavailableWithoutProvider(t *testing.T) {
	dispatcher, store := newTestDispatcher(t)
	seed := testutil.SeedNamespace(t, store)
	ctx := context.Background()
	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionGenerate, map[string]any{
		"workspace_id": seed.WorkspaceID,
		"subject_ref":  seed.FileEntryID,
		"kind":         "AI_SUMMARY",
	}))
	if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeUnimplemented) {
		t.Fatalf("generate status = %q reasons = %+v", result.Status, result.Reasons)
	}
	documents, err := store.ListDescriptionDocuments(ctx, seed.WorkspaceID, seed.FileEntryID)
	if err != nil {
		t.Fatal(err)
	}
	if len(documents) != 0 {
		t.Fatalf("an unavailable provider must not create documents: %+v", documents)
	}
	// The operation stays unimplemented without a bound provider: the honest
	// capability row plus the typed unimplemented result.
	if dispatcher.implemented[command.OpDescriptionGenerate] {
		t.Fatal("description.generate must not be implemented without a provider")
	}
}

// TestDescriptionGenerateUnhealthyProfileReturnsTypedUnavailable proves the
// content-store contract's honest path: a generation request against a bound
// but unhealthy provider (here: no receipt ledger attached, so egress cannot
// be recorded) returns DESCRIPTION_PROVIDER_UNAVAILABLE and does not alter the
// document or semantic-index state.
func TestDescriptionGenerateUnhealthyProfileReturnsTypedUnavailable(t *testing.T) {
	stub, requests := newDescribeStub(t, "候选描述")
	store := testutil.OpenStore(t, ":memory:")
	modelsRoot := t.TempDir()
	profile := installDescribeProfile(t, modelsRoot, stub.URL)
	provider, err := search.NewOnlineDescribeProvider(search.OnlineDescribeProviderOptions{
		Profile:       profile,
		AuditSink:     nil, // no append-only ledger: the provider is not healthy
		SubjectPolicy: NewSemanticEgressSubjectPolicy(store),
		Grants:        NewSemanticEgressGrantLookup(store),
	})
	if err != nil {
		t.Fatal(err)
	}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn-unhealthy.sock",
		WithConfigDigest("sha256:describe-config-v1"), WithDescribeProvider(provider, modelsRoot))
	seed := testutil.SeedNamespace(t, store)
	seedExtractArtifact(t, store, seed.WorkspaceID, seed.FileEntryID, "标题：雪后的城市。")
	seedExactProtection(t, store, seed.WorkspaceID, seed.FileEntryID)
	result := dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpDescriptionGenerate, map[string]any{
		"workspace_id": seed.WorkspaceID,
		"subject_ref":  seed.FileEntryID,
		"kind":         "AI_SUMMARY",
	}))
	if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonDescriptionProviderUnavailable) {
		t.Fatalf("generate status = %q reasons = %+v", result.Status, result.Reasons)
	}
	documents, err := store.ListDescriptionDocuments(context.Background(), seed.WorkspaceID, seed.FileEntryID)
	if err != nil {
		t.Fatal(err)
	}
	if len(documents) != 0 {
		t.Fatalf("an unhealthy provider must not create documents: %+v", documents)
	}
	if len(requests()) != 0 {
		t.Fatal("an unhealthy provider must not reach the endpoint")
	}
}

func TestDescriptionGenerateAdmitsCandidateAsImmutableRevision(t *testing.T) {
	stub, requests := newDescribeStub(t, "候选描述：主角在废墟中寻找失落的城市。")
	store := testutil.OpenStore(t, ":memory:")
	modelsRoot := t.TempDir()
	dispatcher := wireDescribeDispatcher(t, store, stub.URL, modelsRoot)
	seed := testutil.SeedNamespace(t, store)
	ctx := context.Background()
	seedExtractArtifact(t, store, seed.WorkspaceID, seed.FileEntryID, "标题：雪后的城市。\n主角在废墟中寻找失落的城市，并记录沿途的线索。")
	// The egress policy, grant ledger, and receipt ledger resolve the
	// single default workspace, so the fixture's protection record and grant
	// live there while the subject's artifacts stay in the seeded workspace.
	defaultWorkspace := mustDefaultWorkspace(t, store)
	seedExactProtection(t, store, defaultWorkspace, seed.FileEntryID)
	grant := createDescribeGrant(t, dispatcher, defaultWorkspace, wireDescribeProviderProfile(t, dispatcher))

	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionGenerate, map[string]any{
		"workspace_id": seed.WorkspaceID,
		"subject_ref":  seed.FileEntryID,
		"kind":         "AI_SUMMARY",
		"language":     "zh",
		"egress_confirmation": map[string]any{
			"profile_id":    grant.ProfileID,
			"endpoint_host": grant.EndpointHost,
			"model":         grant.ModelID,
			"purpose":       "DESCRIBE",
			"grant_id":      grant.GrantID,
		},
	}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("generate status = %q: %+v", result.Status, result.Reasons)
	}
	var data command.DescriptionGenerateData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	document := data.Document
	if document.Kind != "AI_SUMMARY" || document.Accepted {
		t.Fatalf("admitted revision must be a non-accepted AI_SUMMARY: %+v", document)
	}
	if document.ProducerProfile != "stub-describe-v1" || document.ProducerProfileDigest == "" {
		t.Fatalf("producer binding = %+v", document)
	}
	if document.SourceRef != "provider:describe:stub-describe-v1" {
		t.Fatalf("source ref = %q", document.SourceRef)
	}
	if len(document.Segments) == 0 {
		t.Fatal("the admitted revision must carry segments")
	}
	if document.PredecessorID != "" || document.Revision != 1 {
		t.Fatalf("revision chain = %d/%q", document.Revision, document.PredecessorID)
	}
	var metadata struct {
		Describe struct {
			ProfileDigest string `json:"profile_digest"`
			ModelID       string `json:"model_id"`
			RequestDigest string `json:"request_digest"`
			OutputDigest  string `json:"output_digest"`
		} `json:"describe"`
	}
	if err := json.Unmarshal(document.Metadata, &metadata); err != nil {
		t.Fatalf("metadata: %v", err)
	}
	if metadata.Describe.ProfileDigest != grant.ProfileDigest || metadata.Describe.ModelID != "stub-describe-model" ||
		metadata.Describe.RequestDigest == "" || metadata.Describe.OutputDigest == "" {
		t.Fatalf("describe metadata = %+v", metadata)
	}
	// The candidate text reached the stub inside the chat messages, and the
	// request body names exactly the declared minimization fields.
	sent := requests()
	if len(sent) != 1 {
		t.Fatalf("stub request count = %d", len(sent))
	}
	encoded, err := json.Marshal(sent[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), "雪后的城市") {
		t.Fatal("the request must carry the subject's admitted extract text")
	}
	if strings.Contains(string(encoded), "candidate") {
		t.Fatal("the request must never carry private note material")
	}
	// A second generate against the same subject creates an independent
	// revision: the chain grows without overwriting the first candidate.
	second := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionGenerate, map[string]any{
		"workspace_id": seed.WorkspaceID,
		"subject_ref":  seed.FileEntryID,
		"kind":         "AI_SUMMARY",
		"egress_confirmation": map[string]any{
			"profile_id":    grant.ProfileID,
			"endpoint_host": grant.EndpointHost,
			"model":         grant.ModelID,
			"purpose":       "DESCRIBE",
			"grant_id":      grant.GrantID,
		},
	}))
	if second.Status != command.StatusSucceeded {
		t.Fatalf("second generate status = %q: %+v", second.Status, second.Reasons)
	}
}

func TestDescriptionGenerateEgressRefusalChangesNothing(t *testing.T) {
	stub, requests := newDescribeStub(t, "候选描述")
	store := testutil.OpenStore(t, ":memory:")
	modelsRoot := t.TempDir()
	dispatcher := wireDescribeDispatcher(t, store, stub.URL, modelsRoot)
	seed := testutil.SeedNamespace(t, store)
	ctx := context.Background()
	seedExtractArtifact(t, store, seed.WorkspaceID, seed.FileEntryID, "标题：雪后的城市。")
	// The egress policy and grant ledger resolve the single default workspace.
	defaultWorkspace := mustDefaultWorkspace(t, store)
	seedExactProtection(t, store, defaultWorkspace, seed.FileEntryID)
	// No grant exists: the gate must refuse the disclosure before any request.
	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionGenerate, map[string]any{
		"workspace_id": seed.WorkspaceID,
		"subject_ref":  seed.FileEntryID,
		"kind":         "AI_SUMMARY",
	}))
	if result.Status != command.StatusFailed {
		t.Fatalf("generate status = %q", result.Status)
	}
	if !hasReasonCode(result, string(search.EgressReasonGrantMissing)) {
		t.Fatalf("reasons = %+v, want the typed egress reason %s", result.Reasons, search.EgressReasonGrantMissing)
	}
	if len(requests()) != 0 {
		t.Fatal("an egress refusal must not reach the provider endpoint")
	}
	documents, err := store.ListDescriptionDocuments(ctx, seed.WorkspaceID, seed.FileEntryID)
	if err != nil {
		t.Fatal(err)
	}
	if len(documents) != 0 {
		t.Fatalf("a refused generation must not create documents: %+v", documents)
	}
	// A live grant authorizes the run through the same confirmation binding
	// the WebUI resolves from the grant list.
	grant := createDescribeGrant(t, dispatcher, defaultWorkspace, wireDescribeProviderProfile(t, dispatcher))
	result = dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionGenerate, map[string]any{
		"workspace_id": seed.WorkspaceID,
		"subject_ref":  seed.FileEntryID,
		"kind":         "AI_SUMMARY",
		"egress_confirmation": map[string]any{
			"profile_id":    grant.ProfileID,
			"endpoint_host": grant.EndpointHost,
			"model":         grant.ModelID,
			"purpose":       "DESCRIBE",
			"grant_id":      grant.GrantID,
		},
	}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("generate with a live grant status = %q: %+v", result.Status, result.Reasons)
	}
}

func TestDescriptionGenerateAcceptanceSuccessorFlow(t *testing.T) {
	stub, _ := newDescribeStub(t, "候选描述：模型生成的剧情摘要。")
	store := testutil.OpenStore(t, ":memory:")
	modelsRoot := t.TempDir()
	dispatcher := wireDescribeDispatcher(t, store, stub.URL, modelsRoot)
	seed := testutil.SeedNamespace(t, store)
	ctx := context.Background()
	seedExtractArtifact(t, store, seed.WorkspaceID, seed.FileEntryID, "标题：雪后的城市。")
	// The egress policy, grant ledger, and receipt ledger resolve the
	// single default workspace, so the fixture's protection record and grant
	// live there while the subject's artifacts stay in the seeded workspace.
	defaultWorkspace := mustDefaultWorkspace(t, store)
	seedExactProtection(t, store, defaultWorkspace, seed.FileEntryID)
	grant := createDescribeGrant(t, dispatcher, defaultWorkspace, wireDescribeProviderProfile(t, dispatcher))
	generated := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionGenerate, map[string]any{
		"workspace_id": seed.WorkspaceID,
		"subject_ref":  seed.FileEntryID,
		"kind":         "AI_SUMMARY",
		"egress_confirmation": map[string]any{
			"profile_id":    grant.ProfileID,
			"endpoint_host": grant.EndpointHost,
			"model":         grant.ModelID,
			"purpose":       "DESCRIBE",
			"grant_id":      grant.GrantID,
		},
	}))
	if generated.Status != command.StatusSucceeded {
		t.Fatalf("generate status = %q: %+v", generated.Status, generated.Reasons)
	}
	var generateData command.DescriptionGenerateData
	if err := json.Unmarshal(generated.Data, &generateData); err != nil {
		t.Fatal(err)
	}
	// The user accepts the candidate: description.create builds the accepted
	// successor with the same body, predecessor, and kind. The model itself
	// never marks its own revision user-accepted.
	accepted := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id":   seed.WorkspaceID,
		"subject_ref":    seed.FileEntryID,
		"kind":           "AI_SUMMARY",
		"body":           generateData.Document.Body,
		"predecessor_id": generateData.Document.ID,
		"accepted":       true,
		"producer":       "operator",
	}))
	if accepted.Status != command.StatusSucceeded {
		t.Fatalf("accept status = %q: %+v", accepted.Status, accepted.Reasons)
	}
	var acceptData command.DescriptionCreateData
	if err := json.Unmarshal(accepted.Data, &acceptData); err != nil {
		t.Fatal(err)
	}
	if !acceptData.Document.Accepted || acceptData.Document.Revision != 2 || acceptData.Document.PredecessorID != generateData.Document.ID {
		t.Fatalf("accepted successor = %+v", acceptData.Document)
	}
	if acceptData.Document.Body != generateData.Document.Body {
		t.Fatal("the accepted successor must retain the candidate body")
	}
	listed := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionList, map[string]any{
		"workspace_id": seed.WorkspaceID,
		"subject_ref":  seed.FileEntryID,
	}))
	var listData command.DescriptionListData
	if err := json.Unmarshal(listed.Data, &listData); err != nil {
		t.Fatal(err)
	}
	if len(listData.Documents) != 2 {
		t.Fatalf("listed documents = %+v", listData.Documents)
	}
}

func TestDescriptionGenerateRejectsBadInputsAndUnhealthyProfiles(t *testing.T) {
	stub, _ := newDescribeStub(t, "候选描述")
	store := testutil.OpenStore(t, ":memory:")
	modelsRoot := t.TempDir()
	dispatcher := wireDescribeDispatcher(t, store, stub.URL, modelsRoot)
	seed := testutil.SeedNamespace(t, store)
	seedExtractArtifact(t, store, seed.WorkspaceID, seed.FileEntryID, "标题：雪后的城市。")
	seedExactProtection(t, store, mustDefaultWorkspace(t, store), seed.FileEntryID)
	ctx := context.Background()
	t.Run("wrong kind", func(t *testing.T) {
		result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionGenerate, map[string]any{
			"workspace_id": seed.WorkspaceID, "subject_ref": seed.FileEntryID, "kind": "USER",
		}))
		if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeInvalidInput) {
			t.Fatalf("status = %q reasons = %+v", result.Status, result.Reasons)
		}
	})
	t.Run("unknown subject", func(t *testing.T) {
		result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionGenerate, map[string]any{
			"workspace_id": seed.WorkspaceID, "subject_ref": "sub_00000000000000000000000000000000", "kind": "AI_SUMMARY",
		}))
		if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeNotFound) {
			t.Fatalf("status = %q reasons = %+v", result.Status, result.Reasons)
		}
	})
	// A profile that is not installed leaves the operation unimplemented.
	emptyDispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn-empty.sock",
		WithConfigDigest("sha256:describe-config-v1"))
	result := emptyDispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionGenerate, map[string]any{
		"workspace_id": seed.WorkspaceID, "subject_ref": seed.FileEntryID, "kind": "AI_SUMMARY",
	}))
	if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeUnimplemented) {
		t.Fatalf("unimplemented status = %q reasons = %+v", result.Status, result.Reasons)
	}
}

func TestCapabilityListAdvertisesDescriptionGenerateOnlyWhenWired(t *testing.T) {
	stub, _ := newDescribeStub(t, "候选描述")
	store := testutil.OpenStore(t, ":memory:")
	modelsRoot := t.TempDir()
	bound := wireDescribeDispatcher(t, store, stub.URL, modelsRoot)
	if !bound.implemented[command.OpDescriptionGenerate] {
		t.Fatal("a bound describe provider must implement description.generate")
	}
	capabilities := bound.Handle(context.Background(), mustEnvelope(t, command.OpCapabilityList, map[string]any{}))
	var data command.CapabilityListData
	if err := json.Unmarshal(capabilities.Data, &data); err != nil {
		t.Fatal(err)
	}
	advertised := false
	for _, capability := range data.Capabilities {
		if capability.Kind == "operation" && capability.ID == command.OpDescriptionGenerate {
			advertised = capability.State == command.CapabilityAvailable
		}
	}
	if !advertised {
		t.Fatal("capability.list must advertise a bound description.generate as available")
	}
	unbound := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn-unbound.sock")
	capabilities = unbound.Handle(context.Background(), mustEnvelope(t, command.OpCapabilityList, map[string]any{}))
	if err := json.Unmarshal(capabilities.Data, &data); err != nil {
		t.Fatal(err)
	}
	for _, capability := range data.Capabilities {
		if capability.Kind == "operation" && capability.ID == command.OpDescriptionGenerate {
			if capability.State == command.CapabilityAvailable {
				t.Fatal("capability.list must not advertise description.generate without a bound provider")
			}
			return
		}
	}
	t.Fatal("capability.list must carry a row for the known description.generate operation")
}

// wireDescribeProviderProfile re-reads the installed profile the test
// dispatcher's provider was built from, so grant creation binds the same
// digest the gate will check.
func wireDescribeProviderProfile(t *testing.T, dispatcher *Dispatcher) search.OnlineDescribeProfile {
	t.Helper()
	if dispatcher.describeProvider == nil {
		t.Fatal("the dispatcher has no describe provider")
	}
	return dispatcher.describeProvider.Profile()
}

// mustTestID mirrors testutil's stable-id helper for the store-level fixtures
// this file needs before a dispatcher exists.
func mustTestID(t *testing.T, prefix string) string {
	t.Helper()
	id, err := sqlite.NewStableID(prefix)
	if err != nil {
		t.Fatal(err)
	}
	return id
}
