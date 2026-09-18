package search

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// logWriterSwap redirects the standard logger for one test. The provider must
// never write secrets to it.
func logWriterSwap(w io.Writer) io.Writer {
	previous := log.Writer()
	log.SetOutput(w)
	return previous
}

// ---- test doubles ----------------------------------------------------------

type onlineStub struct {
	server   *httptest.Server
	requests atomic.Int64
	mu       sync.Mutex
	bodies   [][]byte
	auths    []string
	handler  func(w http.ResponseWriter, r *http.Request, body []byte)
}

func newOnlineStub(t *testing.T, dimension int) *onlineStub {
	t.Helper()
	stub := &onlineStub{}
	stub.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		stub.requests.Add(1)
		body, _ := io.ReadAll(r.Body)
		stub.mu.Lock()
		stub.bodies = append(stub.bodies, body)
		stub.auths = append(stub.auths, r.Header.Get("Authorization"))
		handler := stub.handler
		stub.mu.Unlock()
		if handler != nil {
			handler(w, r, body)
			return
		}
		writeOnlineStubResponse(t, w, body, dimension, "stub-embed-v1")
	}))
	t.Cleanup(stub.server.Close)
	return stub
}

func (s *onlineStub) setHandler(handler func(w http.ResponseWriter, r *http.Request, body []byte)) {
	s.mu.Lock()
	s.handler = handler
	s.mu.Unlock()
}

func (s *onlineStub) callCount() int { return int(s.requests.Load()) }

func writeOnlineStubResponse(t *testing.T, w http.ResponseWriter, body []byte, dimension int, model string) {
	t.Helper()
	var request struct {
		Input []string `json:"input"`
	}
	_ = json.Unmarshal(body, &request)
	data := make([]map[string]any, 0, len(request.Input))
	for index := range request.Input {
		vector := make([]float32, dimension)
		vector[0] = 1
		data = append(data, map[string]any{"object": "embedding", "index": index, "embedding": vector})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "model": model, "data": data})
}

type recordingEgressSink struct {
	mu      sync.Mutex
	records []SemanticEgressRecord
	failErr error
}

func (s *recordingEgressSink) RecordSemanticEgress(_ context.Context, record SemanticEgressRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records = append(s.records, record)
	return s.failErr
}

func (s *recordingEgressSink) snapshot() []SemanticEgressRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]SemanticEgressRecord(nil), s.records...)
}

type stubSubjectPolicy struct {
	allowed map[string]bool
	reason  SemanticEgressReason
	detail  string
}

func (p stubSubjectPolicy) SemanticEgressSubjectAllowed(_ context.Context, subjectID string) (bool, SemanticEgressReason, string) {
	if p.allowed[subjectID] {
		return true, "", ""
	}
	reason := p.reason
	if reason == "" {
		reason = EgressReasonSubjectUnknown
	}
	detail := p.detail
	if detail == "" {
		detail = "subject is not admitted"
	}
	return false, reason, detail
}

// ---- helpers ---------------------------------------------------------------

func testOnlineProfile(t *testing.T, endpoint string) OnlineEmbeddingProfile {
	t.Helper()
	profile := OnlineEmbeddingProfile{
		Schema:               OnlineEmbeddingProfileSchemaV1,
		ProfileID:            "stub-online-v1",
		Provider:             "stub",
		APIStyle:             OnlineEmbeddingAPIStyleOpenAI,
		Endpoint:             endpoint,
		ModelID:              "stub-embed-v1",
		ModelRevision:        "2026-09-18",
		Dimension:            4,
		InputType:            OnlineEmbeddingInputTypeDocument,
		QueryPrefix:          "query: ",
		Normalization:        OnlineEmbeddingNormalizationL2,
		Distance:             OnlineEmbeddingDistanceCosine,
		ElementType:          OnlineEmbeddingElementType,
		Pooling:              "provider-managed",
		Tokenizer:            "provider-managed",
		MaxBatchInputs:       8,
		TimeoutMS:            5000,
		RetentionDeclaration: "loopback stub; no retention",
		TrainingUse:          "none",
	}
	if err := profile.Validate(); err != nil {
		t.Fatalf("test profile must be valid: %v", err)
	}
	return profile
}

func testOnlineManifest(t *testing.T, profile OnlineEmbeddingProfile) EmbeddingGenerationManifest {
	t.Helper()
	manifest, err := profile.EmbeddingGenerationManifest("sha256:" + strings.Repeat("a", 64))
	if err != nil {
		t.Fatalf("profile manifest: %v", err)
	}
	return manifest
}

type testOnlineOptions struct {
	options OnlineEmbeddingProviderOptions
	sink    *recordingEgressSink
}

func testOnlineProviderOptions(t *testing.T, profile OnlineEmbeddingProfile) testOnlineOptions {
	t.Helper()
	manifest := testOnlineManifest(t, profile)
	sink := &recordingEgressSink{}
	return testOnlineOptions{
		sink: sink,
		options: OnlineEmbeddingProviderOptions{
			Mode:          "online",
			Profile:       profile,
			Manifest:      manifest,
			CredentialRef: "env://RW_TEST_ONLINE_KEY",
			CredentialResolver: EnvOnlineCredentialResolver{Lookup: func(name string) (string, bool) {
				if name == "RW_TEST_ONLINE_KEY" {
					return testOnlineSecret, true
				}
				return "", false
			}},
			SendContentWithoutConfirmation: true,
			AuditSink:                      sink,
			SubjectPolicy:                  stubSubjectPolicy{allowed: map[string]bool{"subj_1": true}},
		},
	}
}

const testOnlineSecret = "stub-secret-value-never-logged"

func mustTestOnlineProvider(t *testing.T, options OnlineEmbeddingProviderOptions) *OnlineEmbeddingProvider {
	t.Helper()
	provider, err := NewOnlineEmbeddingProvider(options)
	if err != nil {
		t.Fatalf("NewOnlineEmbeddingProvider: %v", err)
	}
	return provider
}

func onlineDocumentRequest(manifest EmbeddingGenerationManifest, texts ...string) SemanticEmbeddingRequest {
	inputs := make([]SemanticTextInput, 0, len(texts))
	for index, text := range texts {
		inputs = append(inputs, SemanticTextInput{
			SubjectID: "subj_1", SegmentID: fmt.Sprintf("seg_%d", index+1), Text: text,
		})
	}
	return SemanticEmbeddingRequest{
		Purpose: SemanticEmbeddingDocument, GenerationID: "gen_test", Manifest: manifest, Inputs: inputs,
	}
}

func assertEgressRefused(t *testing.T, err error, stub *onlineStub, sink *recordingEgressSink, want SemanticEgressReason) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected a typed refusal with reason %s, got nil", want)
	}
	if got := SemanticEgressReasonOf(err); got != want {
		t.Fatalf("refusal reason = %q (%v), want %q", got, err, want)
	}
	if !errors.Is(err, ErrSemanticProviderUnavailable) {
		t.Fatalf("refusal %v must degrade as ErrSemanticProviderUnavailable", err)
	}
	if stub.callCount() != 0 {
		t.Fatalf("refused egress still made %d network call(s)", stub.callCount())
	}
	if records := sink.snapshot(); len(records) != 0 {
		t.Fatalf("refused egress recorded %d receipts, want 0", len(records))
	}
}

// onlineEmbedErr runs one provider call and returns only its error.
func onlineEmbedErr(t *testing.T, provider *OnlineEmbeddingProvider, ctx context.Context, request SemanticEmbeddingRequest) error {
	t.Helper()
	_, err := provider.Embed(ctx, request)
	return err
}

// ---- gate tests ------------------------------------------------------------

func TestOnlineProviderRefusesWhenModeIsNotOnline(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	built.options.Mode = "local"
	_, err := NewOnlineEmbeddingProvider(built.options)
	assertEgressRefused(t, err, stub, built.sink, EgressReasonModeNotOnline)
	if !strings.Contains(err.Error(), "embedding_mode") {
		t.Fatalf("refusal must name the failed condition: %v", err)
	}
}

func TestOnlineProviderRefusesProfileManifestOutsideItsSpace(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	provider := mustTestOnlineProvider(t, built.options)
	// A request bound to a different space must be refused, not answered from
	// this provider's space.
	other := testOnlineManifest(t, profile)
	other.SemanticSpace = "another-space"
	request := onlineDocumentRequest(other, "sensitive text")
	assertEgressRefused(t, onlineEmbedErr(t, provider, context.Background(), request), stub, built.sink, EgressReasonProfileUnresolved)
}

func TestOnlineProviderRefusesUnresolvableCredential(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	// An empty reference cannot even construct a provider.
	empty := built.options
	empty.CredentialRef = ""
	if _, err := NewOnlineEmbeddingProvider(empty); SemanticEgressReasonOf(err) != EgressReasonCredentialUnresolved {
		t.Fatalf("empty credential reference error = %v, want %s", err, EgressReasonCredentialUnresolved)
	}
	if stub.callCount() != 0 {
		t.Fatalf("empty credential reference made %d network call(s)", stub.callCount())
	}
	// A missing environment variable refuses per request.
	built.options.CredentialResolver = EnvOnlineCredentialResolver{Lookup: func(string) (string, bool) { return "", false }}
	provider := mustTestOnlineProvider(t, built.options)
	assertEgressRefused(t, onlineEmbedErr(t, provider, context.Background(), onlineDocumentRequest(built.options.Manifest, "sensitive text")),
		stub, built.sink, EgressReasonCredentialUnresolved)
}

func TestOnlineProviderRefusesWithoutConfirmation(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	built.options.SendContentWithoutConfirmation = false
	provider := mustTestOnlineProvider(t, built.options)
	request := onlineDocumentRequest(built.options.Manifest, "sensitive text")
	err := onlineEmbedErr(t, provider, context.Background(), request)
	assertEgressRefused(t, err, stub, built.sink, EgressReasonConfirmationRequired)
	if !strings.Contains(err.Error(), "send_content_without_confirmation") {
		t.Fatalf("refusal must name the failed condition: %v", err)
	}
	if !strings.Contains(provider.SemanticFailure(), string(EgressReasonConfirmationRequired)) {
		t.Fatalf("provider failure summary = %q, want the confirmation reason", provider.SemanticFailure())
	}
}

func TestOnlineProviderRefusesConfirmationForDifferentContent(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	built.options.SendContentWithoutConfirmation = false
	provider := mustTestOnlineProvider(t, built.options)
	request := onlineDocumentRequest(built.options.Manifest, "sensitive text")
	confirmation := SemanticEgressConfirmation{
		ProviderProfileID: profile.ProfileID, Endpoint: profile.Endpoint, ModelID: profile.ModelID,
		Purpose: SemanticEmbeddingDocument, ContentDigest: SemanticEgressContentDigest([]SemanticTextInput{
			{SubjectID: "subj_1", SegmentID: "seg_1", Text: "different text"},
		}),
	}
	ctx := WithSemanticEgressConfirmation(context.Background(), confirmation)
	assertEgressRefused(t, onlineEmbedErr(t, provider, ctx, request), stub, built.sink, EgressReasonConfirmationMismatch)

	// A confirmation for another endpoint is also refused.
	confirmation.ContentDigest = SemanticEgressContentDigest(request.Inputs)
	confirmation.Endpoint = "https://elsewhere.invalid/v1/embeddings"
	ctx = WithSemanticEgressConfirmation(context.Background(), confirmation)
	assertEgressRefused(t, onlineEmbedErr(t, provider, ctx, request), stub, built.sink, EgressReasonConfirmationMismatch)
}

func TestOnlineProviderAcceptsBoundPerRequestConfirmation(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	built.options.SendContentWithoutConfirmation = false
	provider := mustTestOnlineProvider(t, built.options)
	request := onlineDocumentRequest(built.options.Manifest, "confirmed disclosure")
	ctx := WithSemanticEgressConfirmation(context.Background(), SemanticEgressConfirmation{
		ProviderProfileID: profile.ProfileID, Endpoint: profile.Endpoint, ModelID: profile.ModelID,
		Purpose: SemanticEmbeddingDocument, ContentDigest: SemanticEgressContentDigest(request.Inputs),
	})
	if _, err := provider.Embed(ctx, request); err != nil {
		t.Fatalf("confirmed request refused: %v", err)
	}
	if stub.callCount() != 1 {
		t.Fatalf("network calls = %d, want 1", stub.callCount())
	}
	records := built.sink.snapshot()
	if len(records) != 1 || records[0].Authorization != SemanticEgressAuthorizationRequest {
		t.Fatalf("receipts = %+v, want one PER_REQUEST_CONFIRMATION receipt", records)
	}
}

func TestOnlineProviderRefusesUnprotectedAndUnknownSubjects(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	built.options.SubjectPolicy = stubSubjectPolicy{
		allowed: map[string]bool{"subj_1": false},
		reason:  EgressReasonSubjectUnprotected,
		detail:  "LINK_ONLY_UNPROTECTED content is never sent to a remote embedding provider",
	}
	provider := mustTestOnlineProvider(t, built.options)
	assertEgressRefused(t, onlineEmbedErr(t, provider, context.Background(), onlineDocumentRequest(built.options.Manifest, "unprotected text")),
		stub, built.sink, EgressReasonSubjectUnprotected)

	// A missing policy refuses every document disclosure.
	built.options.SubjectPolicy = nil
	provider = mustTestOnlineProvider(t, built.options)
	assertEgressRefused(t, onlineEmbedErr(t, provider, context.Background(), onlineDocumentRequest(built.options.Manifest, "unprotected text")),
		stub, built.sink, EgressReasonSubjectPolicyUnavail)
}

func TestOnlineProviderRefusesWithoutAuditLedger(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	built.options.AuditSink = nil
	provider := mustTestOnlineProvider(t, built.options)
	assertEgressRefused(t, onlineEmbedErr(t, provider, context.Background(), onlineDocumentRequest(built.options.Manifest, "unrecorded text")),
		stub, built.sink, EgressReasonAuditUnavailable)
}

// ---- success, receipt, and privacy tests -----------------------------------

func TestOnlineProviderSendsExactlyOneRequestAndRecordsOnlyDigests(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	provider := mustTestOnlineProvider(t, built.options)
	text := "洪水城市档案恢复说明：这是需要嵌入的正文"
	request := onlineDocumentRequest(built.options.Manifest, text)
	vectors, err := provider.Embed(context.Background(), request)
	if err != nil {
		t.Fatalf("embed: %v", err)
	}
	if len(vectors) != 1 || vectors[0].SubjectID != "subj_1" || vectors[0].SegmentID != "seg_1" {
		t.Fatalf("vectors = %+v", vectors)
	}
	if len(vectors[0].Vector) != profile.Dimension {
		t.Fatalf("vector dimension = %d", len(vectors[0].Vector))
	}
	if stub.callCount() != 1 {
		t.Fatalf("network calls = %d, want exactly 1", stub.callCount())
	}
	stub.mu.Lock()
	body := stub.bodies[0]
	auth := stub.auths[0]
	stub.mu.Unlock()
	if auth != "Bearer "+testOnlineSecret {
		t.Fatalf("request did not carry the resolved credential")
	}
	records := built.sink.snapshot()
	if len(records) != 1 {
		t.Fatalf("receipts = %d, want exactly 1", len(records))
	}
	record := records[0]
	if record.Outcome != SemanticEgressOutcomeSucceeded || record.Authorization != SemanticEgressAuthorizationConfig {
		t.Fatalf("receipt = %+v", record)
	}
	if record.PayloadDigest != sha256Digest(body) || record.PayloadBytes != int64(len(body)) {
		t.Fatalf("receipt payload digest/bytes do not match the sent request body")
	}
	if record.ItemCount != 1 || record.TextBytes != int64(len(text)) ||
		len(record.TextDigests) != 1 || record.TextDigests[0] != sha256Digest([]byte(text)) {
		t.Fatalf("receipt digests/counts = %+v", record)
	}
	if record.RequestDigest != SemanticEgressContentDigest(request.Inputs) {
		t.Fatalf("receipt request digest = %q", record.RequestDigest)
	}
	if record.SpaceFingerprint != profile.Fingerprint().SpaceID() ||
		record.SpaceFingerprintDigest != profile.Fingerprint().CanonicalDigest() ||
		record.ProviderProfileDigest != profile.ProviderProfileDigest() {
		t.Fatalf("receipt must carry the space and provider fingerprints: %+v", record)
	}
	if record.ModelID != profile.ModelID || record.ModelRevision != profile.ModelRevision || record.Dimension != profile.Dimension {
		t.Fatalf("receipt must carry the model identity: %+v", record)
	}
	if record.StartedAt.IsZero() || record.CompletedAt.Before(record.StartedAt) {
		t.Fatalf("receipt timestamps = %v .. %v", record.StartedAt, record.CompletedAt)
	}
	// The receipt must not carry the payload, its base64, or the credential.
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

func TestOnlineProviderBatchesKeepOneReceiptPerRequest(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	profile.MaxBatchInputs = 2
	built := testOnlineProviderOptions(t, profile)
	provider := mustTestOnlineProvider(t, built.options)
	request := onlineDocumentRequest(built.options.Manifest, "one", "two", "three")
	vectors, err := provider.Embed(context.Background(), request)
	if err != nil {
		t.Fatalf("embed: %v", err)
	}
	if len(vectors) != 3 || vectors[0].SegmentID != "seg_1" || vectors[1].SegmentID != "seg_2" || vectors[2].SegmentID != "seg_3" {
		t.Fatalf("batched vectors lost input order: %+v", vectors)
	}
	if stub.callCount() != 2 {
		t.Fatalf("network calls = %d, want 2 (one per batch)", stub.callCount())
	}
	records := built.sink.snapshot()
	if len(records) != 2 {
		t.Fatalf("receipts = %d, want one per batch", len(records))
	}
	for _, record := range records {
		if record.ItemCount > 2 || record.RequestDigest != SemanticEgressContentDigest(request.Inputs) {
			t.Fatalf("receipt = %+v", record)
		}
	}
}

func TestOnlineProviderHonestFailureStates(t *testing.T) {
	text := "failure state text"
	tests := []struct {
		name      string
		handler   func(w http.ResponseWriter, r *http.Request, body []byte)
		client    *http.Client
		dimension int
		want      SemanticEgressReason
	}{
		{
			name: "rate limited",
			handler: func(w http.ResponseWriter, _ *http.Request, _ []byte) {
				w.WriteHeader(http.StatusTooManyRequests)
				_, _ = w.Write([]byte(`{"error":{"code":"rate_limit_exceeded","message":"too many requests"}}`))
			},
			want: EgressReasonProviderQuota,
		},
		{
			name: "provider error",
			handler: func(w http.ResponseWriter, _ *http.Request, _ []byte) {
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"error":{"type":"internal_error","message":"boom"}}`))
			},
			want: EgressReasonProviderError,
		},
		{
			name: "credential rejected",
			handler: func(w http.ResponseWriter, _ *http.Request, _ []byte) {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":{"code":"invalid_api_key","message":"expired"}}`))
			},
			want: EgressReasonCredentialUnresolved,
		},
		{
			name: "redirect refused",
			handler: func(w http.ResponseWriter, r *http.Request, _ []byte) {
				http.Redirect(w, r, "https://elsewhere.invalid/v1/embeddings", http.StatusFound)
			},
			// The default provider client refuses redirects; the test server
			// still sees the first request only.
			want: EgressReasonProviderRedirect,
		},
		{
			name: "timeout",
			handler: func(w http.ResponseWriter, _ *http.Request, _ []byte) {
				time.Sleep(150 * time.Millisecond)
				writeOnlineStubResponse(t, w, []byte(`{"input":["x"]}`), 4, "stub-embed-v1")
			},
			client: &http.Client{Timeout: 40 * time.Millisecond},
			want:   EgressReasonProviderTimeout,
		},
		{
			name: "malformed response",
			handler: func(w http.ResponseWriter, _ *http.Request, _ []byte) {
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"object":"list","data":`))
			},
			want: EgressReasonResponseMalformed,
		},
		{
			name: "dimension mismatch",
			handler: func(w http.ResponseWriter, _ *http.Request, _ []byte) {
				writeOnlineStubResponse(t, w, []byte(`{"input":["x"]}`), 3, "stub-embed-v1")
			},
			want: EgressReasonDimensionMismatch,
		},
		{
			name: "different space answered",
			handler: func(w http.ResponseWriter, _ *http.Request, _ []byte) {
				writeOnlineStubResponse(t, w, []byte(`{"input":["x"]}`), 4, "another-model-v9")
			},
			want: EgressReasonSpaceMismatch,
		},
		{
			name: "invalid vector",
			handler: func(w http.ResponseWriter, _ *http.Request, _ []byte) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"model":"stub-embed-v1","data":[{"index":0,"embedding":[2,0,0,0]}]}`))
			},
			want: EgressReasonInvalidVector,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			stub := newOnlineStub(t, 4)
			stub.setHandler(test.handler)
			profile := testOnlineProfile(t, stub.server.URL)
			built := testOnlineProviderOptions(t, profile)
			if test.client != nil {
				built.options.HTTPClient = test.client
			}
			provider := mustTestOnlineProvider(t, built.options)
			err := onlineEmbedErr(t, provider, context.Background(), onlineDocumentRequest(built.options.Manifest, text))
			if err == nil {
				t.Fatalf("expected %s", test.want)
			}
			if got := SemanticEgressReasonOf(err); got != test.want {
				t.Fatalf("reason = %q (%v), want %q", got, err, test.want)
			}
			if !errors.Is(err, ErrSemanticProviderUnavailable) {
				t.Fatalf("failure must degrade as ErrSemanticProviderUnavailable: %v", err)
			}
			if strings.Contains(err.Error(), text) || strings.Contains(err.Error(), testOnlineSecret) {
				t.Fatalf("error leaked content or credential: %v", err)
			}
			records := built.sink.snapshot()
			if len(records) != 1 {
				t.Fatalf("receipts = %d, want exactly one failed-attempt receipt", len(records))
			}
			record := records[0]
			if record.Outcome != SemanticEgressOutcomeFailed || record.Reason != test.want {
				t.Fatalf("receipt = %+v, want FAILED with reason %s", record, test.want)
			}
			if record.PayloadDigest == "" || record.PayloadBytes == 0 || record.TextDigests[0] != sha256Digest([]byte(text)) {
				t.Fatalf("failed-attempt receipt must still carry what was sent: %+v", record)
			}
			encoded, _ := json.Marshal(record)
			if strings.Contains(string(encoded), text) {
				t.Fatalf("failed-attempt receipt leaked payload: %s", encoded)
			}
			if failure := provider.SemanticFailure(); !strings.Contains(failure, string(test.want)) {
				t.Fatalf("SemanticFailure = %q, want it to name %s", failure, test.want)
			}
		})
	}
}

func TestOnlineProviderReceiptFailureDegrades(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	built.sink.failErr = errors.New("ledger unavailable")
	provider := mustTestOnlineProvider(t, built.options)
	err := onlineEmbedErr(t, provider, context.Background(), onlineDocumentRequest(built.options.Manifest, "recorded text"))
	if SemanticEgressReasonOf(err) != EgressReasonReceiptUnrecorded {
		t.Fatalf("error = %v, want %s", err, EgressReasonReceiptUnrecorded)
	}
	if stub.callCount() != 1 {
		t.Fatalf("network calls = %d, want 1", stub.callCount())
	}
}

// ---- privacy of the credential --------------------------------------------

func TestOnlineCredentialNeverAppearsInLogsErrorsOrReceipts(t *testing.T) {
	stub := newOnlineStub(t, 4)
	stub.setHandler(func(w http.ResponseWriter, _ *http.Request, _ []byte) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"code":"invalid_api_key","message":"the key ` + testOnlineSecret + ` is expired"}}`))
	})
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	provider := mustTestOnlineProvider(t, built.options)

	logPath := filepath.Join(t.TempDir(), "provider.log")
	logFile, err := os.Create(logPath)
	if err != nil {
		t.Fatal(err)
	}
	previousWriter := logWriterSwap(logFile)
	embedErr := onlineEmbedErr(t, provider, context.Background(), onlineDocumentRequest(built.options.Manifest, "text"))
	logWriterSwap(previousWriter)
	if closeErr := logFile.Close(); closeErr != nil {
		t.Fatal(closeErr)
	}
	if embedErr == nil {
		t.Fatal("expected the rejected credential to fail")
	}
	if strings.Contains(embedErr.Error(), testOnlineSecret) {
		t.Fatalf("error leaked the credential: %v", embedErr)
	}
	if strings.Contains(provider.SemanticFailure(), testOnlineSecret) {
		t.Fatalf("failure summary leaked the credential: %q", provider.SemanticFailure())
	}
	records := built.sink.snapshot()
	if len(records) != 1 {
		t.Fatalf("receipts = %d", len(records))
	}
	encoded, _ := json.Marshal(records[0])
	if strings.Contains(string(encoded), testOnlineSecret) {
		t.Fatalf("receipt leaked the credential: %s", encoded)
	}
	logged, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(logged), testOnlineSecret) {
		t.Fatalf("log output leaked the credential: %s", logged)
	}
	if got := fmt.Sprintf("%v", NewOnlineCredential(testOnlineSecret)); strings.Contains(got, testOnlineSecret) {
		t.Fatalf("credential formatting leaked the secret: %s", got)
	}
	if got := fmt.Sprintf("%#v", NewOnlineCredential(testOnlineSecret)); strings.Contains(got, testOnlineSecret) {
		t.Fatalf("credential GoString leaked the secret: %s", got)
	}
}

// ---- structural proof of the single egress path ----------------------------

// TestOnlineProviderHasExactlyOneNetworkCallSite proves that the only code
// that constructs an HTTP request or invokes the client lives inside
// performPermittedEgress, which requires a permit from the gate.
func TestOnlineProviderHasExactlyOneNetworkCallSite(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	files := 0
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, "semantic_provider_online") || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		files++
		payload, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		source := string(payload)
		permitAt := strings.Index(source, "func (p *OnlineEmbeddingProvider) performPermittedEgress(")
		if permitAt < 0 {
			continue
		}
		// Everything after the function comment is the body of the one
		// permitted egress function.
		body := source[permitAt:]
		for _, needle := range []string{"http.NewRequestWithContext(", "client.Do("} {
			if count := strings.Count(source, needle); count != 1 || !strings.Contains(body, needle) {
				t.Fatalf("%s: %q occurs %d time(s); the single egress path requires exactly one occurrence inside performPermittedEgress",
					name, needle, count)
			}
		}
		if strings.Count(source, "p.client.Do(") != 1 {
			t.Fatalf("%s: the HTTP client must be invoked exactly once", name)
		}
	}
	if files == 0 {
		t.Fatal("online provider sources were not found")
	}
}
