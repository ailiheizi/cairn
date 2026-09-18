package search

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// recordingDescribeAuditSink captures every describe egress receipt the
// provider appends.
type recordingDescribeAuditSink struct {
	mu      sync.Mutex
	records []DescribeEgressRecord
	err     error
}

func (s *recordingDescribeAuditSink) RecordDescribeEgress(_ context.Context, record DescribeEgressRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return s.err
	}
	s.records = append(s.records, record)
	return nil
}

func (s *recordingDescribeAuditSink) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.records)
}

func (s *recordingDescribeAuditSink) last() DescribeEgressRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.records) == 0 {
		return DescribeEgressRecord{}
	}
	return s.records[len(s.records)-1]
}

// describeStubServer is a loopback OpenAI-compatible chat-completions stub. It
// records the request bodies it receives and answers with a canned candidate.
type describeStubServer struct {
	*httptest.Server
	mu        sync.Mutex
	bodies    []map[string]any
	candidate string
	status    int
	payload   string
}

func newDescribeStubServer(t *testing.T, candidate string) *describeStubServer {
	t.Helper()
	stub := &describeStubServer{candidate: candidate, status: http.StatusOK}
	stub.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read stub request: %v", err)
		}
		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Errorf("stub request is not JSON: %v", err)
		}
		stub.mu.Lock()
		stub.bodies = append(stub.bodies, body)
		payload := stub.payload
		status := stub.status
		stub.mu.Unlock()
		if payload != "" {
			w.WriteHeader(status)
			_, _ = w.Write([]byte(payload))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model": "stub-describe-model",
			"choices": []map[string]any{{
				"message":       map[string]any{"role": "assistant", "content": candidate},
				"finish_reason": "stop",
			}},
		})
	}))
	t.Cleanup(stub.Close)
	return stub
}

func (s *describeStubServer) requestCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.bodies)
}

func (s *describeStubServer) lastBody() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.bodies) == 0 {
		return nil
	}
	return s.bodies[len(s.bodies)-1]
}

func testDescribeGrant(profile OnlineDescribeProfile, now time.Time, dataClasses ...string) EgressGrant {
	if len(dataClasses) == 0 {
		dataClasses = []string{EgressDataClassTextSubjectContext}
	}
	return EgressGrant{
		ID:             "egt_0123456789abcdef0123456789abcdef",
		ProfileID:      profile.ProfileID,
		ProfileDigest:  profile.ProviderProfileDigest(),
		EndpointHost:   profile.EndpointHost(),
		ModelID:        profile.ModelID,
		Purpose:        EgressPurposeDescribe,
		DataClasses:    dataClasses,
		SubjectClasses: EgressSubjectClasses(),
		MaxRequests:    profile.Egress.Budgets.MaxRequests,
		MaxBytes:       profile.Egress.Budgets.MaxBytes,
		MaxSeconds:     profile.Egress.Budgets.MaxSeconds,
		ExpiresAt:      now.Add(time.Hour),
	}
}

func newTestDescribeProvider(t *testing.T, endpoint string, grants *stubGrantLookup, sink DescribeEgressAuditSink, dataClasses ...string) (*OnlineDescribeProvider, OnlineDescribeProfile) {
	t.Helper()
	return newTestDescribeProviderWithSwitch(t, true, endpoint, grants, sink, dataClasses...)
}

// newTestDescribeProviderWithSwitch keeps the gate's per-request confirmation
// requirement when sendWithout is false, exactly as the daemon runs by default.
func newTestDescribeProviderWithSwitch(t *testing.T, sendWithout bool, endpoint string, grants *stubGrantLookup, sink DescribeEgressAuditSink, dataClasses ...string) (*OnlineDescribeProvider, OnlineDescribeProfile) {
	t.Helper()
	profile := testDescribeProfile(t, endpoint, dataClasses...)
	provider, err := NewOnlineDescribeProvider(OnlineDescribeProviderOptions{
		Profile: profile,
		CredentialResolver: EnvOnlineCredentialResolver{Lookup: func(name string) (string, bool) {
			if name == "RW_TEST_DESCRIBE_KEY" {
				return "resolved-describe-secret", true
			}
			return "", false
		}},
		SendWithoutConfirmation: sendWithout,
		AuditSink:               sink,
		SubjectPolicy:           stubSubjectPolicy{allowed: map[string]bool{"sub_00000000000000000000000000000001": true}},
		Grants:                  grants,
	})
	if err != nil {
		t.Fatalf("new describe provider: %v", err)
	}
	return provider, profile
}

func describeTestRequest() DescribeRequest {
	return DescribeRequest{
		SubjectID: "sub_00000000000000000000000000000001",
		Kind:      "AI_SUMMARY",
		Language:  "zh",
		TextContexts: []DescribeTextContext{
			{ArtifactID: "art_00000000000000000000000000000001", Text: "雪后的城市。主角在废墟中寻找失落的城市。"},
		},
	}
}

func TestDescribeProviderRefusesBeforeAnyRequestWithoutLiveGrant(t *testing.T) {
	stub := newDescribeStubServer(t, "候选描述")
	sink := &recordingDescribeAuditSink{}
	grants := &stubGrantLookup{}
	provider, profile := newTestDescribeProvider(t, stub.URL, grants, sink)
	if err := provider.CheckDescribeReadiness(context.Background()); err != nil {
		t.Fatalf("readiness: %v", err)
	}
	_, err := provider.Describe(context.Background(), describeTestRequest())
	if err == nil {
		t.Fatal("describe without a live grant must fail")
	}
	if reason := SemanticEgressReasonOf(err); reason != EgressReasonGrantMissing {
		t.Fatalf("reason = %q, want %q", reason, EgressReasonGrantMissing)
	}
	if stub.requestCount() != 0 {
		t.Fatalf("the stub received %d requests; a refusal must happen before any request", stub.requestCount())
	}
	if sink.count() != 0 {
		t.Fatalf("a refusal before the grant check must not be recorded as an attempt: %+v", sink.last())
	}
	// With a live covering grant the request goes through.
	grants.setGrants(testDescribeGrant(profile, time.Now()))
	result, err := provider.Describe(context.Background(), describeTestRequest())
	if err != nil {
		t.Fatalf("describe with a live grant: %v", err)
	}
	if result.Text != "候选描述" || result.GrantID != testOnlineGrantID {
		t.Fatalf("result = %+v", result)
	}
	if result.OutputDigest != DescribeEgressOutputDigest(result.Text) {
		t.Fatal("the result output digest must be bound to the returned text")
	}
	if stub.requestCount() != 1 {
		t.Fatalf("stub request count = %d, want 1", stub.requestCount())
	}
}

func TestDescribeProviderSendsImageBytesOnlyWhenClassDeclared(t *testing.T) {
	candidate := "图像内容概述"
	// (a) the profile declares only text.subject_context: the host cannot pass
	// an image at all, and the provider refuses one anyway.
	sinkTextOnly := &recordingDescribeAuditSink{}
	grantsTextOnly := &stubGrantLookup{}
	providerTextOnly, profileTextOnly := newTestDescribeProvider(t, newDescribeStubServer(t, candidate).URL, grantsTextOnly, sinkTextOnly)
	grantsTextOnly.setGrants(testDescribeGrant(profileTextOnly, time.Now(), EgressDataClassTextSubjectContext))
	request := describeTestRequest()
	request.Image = &DescribeImagePart{ContentID: "sha256:deadbeef", MediaType: "image/png", Bytes: []byte{0x89, 0x50}}
	if _, err := providerTextOnly.Describe(context.Background(), request); err == nil {
		t.Fatal("an undeclared image part must be refused")
	} else if reason := SemanticEgressReasonOf(err); reason != EgressReasonRequestInvalid {
		t.Fatalf("reason = %q, want %q", reason, EgressReasonRequestInvalid)
	}
	// (b) the profile declares both classes and the grant covers them: the
	// request body carries the image as a base64 data URL part.
	sink := &recordingDescribeAuditSink{}
	grants := &stubGrantLookup{}
	stub := newDescribeStubServer(t, candidate)
	provider, profile := newTestDescribeProvider(t, stub.URL, grants, sink, EgressDataClassTextSubjectContext, EgressDataClassImageBytes)
	grants.setGrants(testDescribeGrant(profile, time.Now(), EgressDataClassTextSubjectContext, EgressDataClassImageBytes))
	if _, err := provider.Describe(context.Background(), request); err != nil {
		t.Fatalf("describe with image: %v", err)
	}
	body := stub.lastBody()
	messages, ok := body["messages"].([]any)
	if !ok || len(messages) == 0 {
		t.Fatalf("request body has no messages: %+v", body)
	}
	user := messages[len(messages)-1].(map[string]any)
	content, ok := user["content"].([]any)
	if !ok {
		t.Fatalf("the image request must carry content parts: %+v", user)
	}
	foundImage := false
	for _, part := range content {
		partMap := part.(map[string]any)
		if partMap["type"] != "image_url" {
			continue
		}
		foundImage = true
		imageURL := partMap["image_url"].(map[string]any)["url"].(string)
		if !strings.HasPrefix(imageURL, "data:image/png;base64,") {
			t.Fatalf("image part is not a base64 data URL: %q", imageURL[:40])
		}
	}
	if !foundImage {
		t.Fatal("the declared image class must produce an image_url content part")
	}
	// A text-only request against the same profile sends no image part.
	if _, err := provider.Describe(context.Background(), describeTestRequest()); err != nil {
		t.Fatalf("text-only describe: %v", err)
	}
	user = stub.lastBody()["messages"].([]any)[len(stub.lastBody()["messages"].([]any))-1].(map[string]any)
	if content, ok := user["content"].([]any); ok {
		for _, part := range content {
			if part.(map[string]any)["type"] == "image_url" {
				t.Fatal("a text-only request must never carry an image part")
			}
		}
	}
}

func TestDescribeProviderReceiptFieldsAndSecretExclusion(t *testing.T) {
	stub := newDescribeStubServer(t, "候选描述内容")
	sink := &recordingDescribeAuditSink{}
	grants := &stubGrantLookup{}
	provider, profile := newTestDescribeProvider(t, stub.URL, grants, sink)
	grants.setGrants(testDescribeGrant(profile, time.Now()))
	request := describeTestRequest()
	result, err := provider.Describe(context.Background(), request)
	if err != nil {
		t.Fatalf("describe: %v", err)
	}
	if sink.count() != 1 {
		t.Fatalf("receipt count = %d, want exactly one per attempt", sink.count())
	}
	record := sink.last()
	if record.Outcome != SemanticEgressOutcomeSucceeded || record.HTTPStatus != http.StatusOK {
		t.Fatalf("receipt outcome = %s (%d)", record.Outcome, record.HTTPStatus)
	}
	if record.ProviderProfile != profile.ProfileID || record.ProviderProfileDigest != profile.ProviderProfileDigest() {
		t.Fatalf("receipt provider identity = %s/%s", record.ProviderProfile, record.ProviderProfileDigest)
	}
	if record.Purpose != EgressPurposeDescribe || record.GrantID != testOnlineGrantID {
		t.Fatalf("receipt purpose/grant = %s/%s", record.Purpose, record.GrantID)
	}
	if record.RequestDigest != result.RequestDigest || record.OutputDigest != result.OutputDigest {
		t.Fatal("the receipt must bind the same request and output digests the result carries")
	}
	if record.OutputDigest != DescribeEgressOutputDigest(result.Text) {
		t.Fatal("the receipt output digest must be bound to the returned text")
	}
	if !record.RequestSent || record.OutputBytes != int64(len(result.Text)) {
		t.Fatalf("receipt output facts: sent=%v bytes=%d", record.RequestSent, record.OutputBytes)
	}
	if len(record.DisclosedDataClasses) != 1 || record.DisclosedDataClasses[0] != EgressDataClassTextSubjectContext {
		t.Fatalf("receipt data classes = %v", record.DisclosedDataClasses)
	}
	if record.CredentialRef == "" || strings.Contains(record.CredentialRef, "secret") {
		t.Fatalf("credential ref = %q", record.CredentialRef)
	}
	// No receipt field may carry the disclosed text, the candidate text, or
	// the resolved credential value.
	encoded, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	receipt := string(encoded)
	if strings.Contains(receipt, request.TextContexts[0].Text) {
		t.Fatal("the receipt must never carry the disclosed input text")
	}
	if strings.Contains(receipt, result.Text) {
		t.Fatal("the receipt must never carry the candidate output text")
	}
	if strings.Contains(receipt, "resolved-describe-secret") {
		t.Fatal("the receipt must never carry credential material")
	}
}

func TestDescribeProviderOutputValidationAndMalformedResponses(t *testing.T) {
	cases := []struct {
		name    string
		payload string
		want    SemanticEgressReason
	}{
		{
			name:    "not json",
			payload: "<html>oops</html>",
			want:    EgressReasonResponseMalformed,
		},
		{
			name:    "no choices",
			payload: `{"model":"stub-describe-model","choices":[]}`,
			want:    EgressReasonResponseMalformed,
		},
		{
			name:    "empty candidate",
			payload: `{"model":"stub-describe-model","choices":[{"message":{"role":"assistant","content":"   "},"finish_reason":"stop"}]}`,
			want:    EgressReasonResponseMalformed,
		},
		{
			name:    "control character in candidate",
			payload: `{"model":"stub-describe-model","choices":[{"message":{"role":"assistant","content":"bad\u0007candidate"},"finish_reason":"stop"}]}`,
			want:    EgressReasonResponseMalformed,
		},
		{
			name:    "wrong echoed model",
			payload: `{"model":"other-model","choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`,
			want:    EgressReasonResponseMalformed,
		},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			stub := newDescribeStubServer(t, "")
			stub.mu.Lock()
			stub.payload = test.payload
			stub.status = http.StatusOK
			stub.mu.Unlock()
			sink := &recordingDescribeAuditSink{}
			grants := &stubGrantLookup{}
			provider, profile := newTestDescribeProvider(t, stub.URL, grants, sink)
			grants.setGrants(testDescribeGrant(profile, time.Now()))
			_, err := provider.Describe(context.Background(), describeTestRequest())
			if err == nil || SemanticEgressReasonOf(err) != test.want {
				t.Fatalf("error = %v, want reason %q", err, test.want)
			}
			if stub.requestCount() != 1 {
				t.Fatalf("stub request count = %d", stub.requestCount())
			}
			if sink.count() != 1 || sink.last().Outcome != SemanticEgressOutcomeFailed {
				t.Fatalf("a failed attempt must leave exactly one failed receipt: %+v", sink.last())
			}
		})
	}
}

func TestDescribeProviderRequiresConfirmationByDefault(t *testing.T) {
	stub := newDescribeStubServer(t, "候选描述")
	sink := &recordingDescribeAuditSink{}
	grants := &stubGrantLookup{}
	provider, profile := newTestDescribeProviderWithSwitch(t, false, stub.URL, grants, sink)
	grants.setGrants(testDescribeGrant(profile, time.Now()))
	// Without a confirmation the gate refuses with the typed reason and no
	// request is sent.
	_, err := provider.Describe(context.Background(), describeTestRequest())
	if err == nil || SemanticEgressReasonOf(err) != EgressReasonConfirmationRequired {
		t.Fatalf("error = %v, want %q", err, EgressReasonConfirmationRequired)
	}
	if stub.requestCount() != 0 {
		t.Fatal("a confirmation refusal must happen before any request")
	}
	if sink.count() != 1 || sink.last().RequestSent || sink.last().GrantID != testOnlineGrantID {
		t.Fatalf("the refused attempt must be recorded without a sent request: %+v", sink.last())
	}
	// A confirmation binding this exact profile, destination, model, purpose,
	// and grant authorizes the run.
	confirmation := SemanticEgressConfirmation{
		ProviderProfileID: profile.ProfileID,
		EndpointHost:      profile.EndpointHost(),
		ModelID:           profile.ModelID,
		Purpose:           SemanticEmbeddingPurpose(EgressPurposeDescribe),
		GrantID:           testOnlineGrantID,
	}
	ctx := WithSemanticEgressConfirmation(context.Background(), confirmation)
	if _, err := provider.Describe(ctx, describeTestRequest()); err != nil {
		t.Fatalf("describe with confirmation: %v", err)
	}
	if stub.requestCount() != 1 {
		t.Fatalf("stub request count = %d, want 1", stub.requestCount())
	}
	// A confirmation naming a different grant cannot authorize the run.
	stub.mu.Lock()
	stub.bodies = nil
	stub.mu.Unlock()
	wrongGrant := confirmation
	wrongGrant.GrantID = "egt_ffffffffffffffffffffffffffffffff"
	if _, err := provider.Describe(WithSemanticEgressConfirmation(context.Background(), wrongGrant), describeTestRequest()); err == nil {
		t.Fatal("a mismatched confirmation must be refused")
	}
	if stub.requestCount() != 0 {
		t.Fatal("a mismatched confirmation must happen before any request")
	}
}

func TestDescribeProviderRefusesUnprotectedSubject(t *testing.T) {
	stub := newDescribeStubServer(t, "候选描述")
	sink := &recordingDescribeAuditSink{}
	profile := testDescribeProfile(t, stub.URL)
	provider, err := NewOnlineDescribeProvider(OnlineDescribeProviderOptions{
		Profile:       profile,
		AuditSink:     sink,
		SubjectPolicy: stubSubjectPolicy{allowed: map[string]bool{}},
		Grants:        &stubGrantLookup{},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = provider.Describe(context.Background(), describeTestRequest())
	if err == nil || SemanticEgressReasonOf(err) != EgressReasonSubjectUnknown {
		t.Fatalf("error = %v, want %q", err, EgressReasonSubjectUnknown)
	}
	if stub.requestCount() != 0 {
		t.Fatal("an unprotected subject must be refused before any request")
	}
}
