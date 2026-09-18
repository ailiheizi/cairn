package search

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
)

// fakeSemanticProvider is a deterministic stand-in for the local ONNX/BGE
// worker. It is a test double only; no daemon wiring uses it.
type fakeSemanticProvider struct {
	calls   atomic.Int64
	ready   bool
	failure string
	reason  SemanticEgressReason
}

func (f *fakeSemanticProvider) Embed(_ context.Context, request SemanticEmbeddingRequest) ([]SemanticVector, error) {
	f.calls.Add(1)
	results := make([]SemanticVector, 0, len(request.Inputs))
	for _, input := range request.Inputs {
		vector := make([]float32, request.Manifest.Dimension)
		vector[0] = 1
		results = append(results, SemanticVector{SubjectID: input.SubjectID, SegmentID: input.SegmentID, Vector: vector})
	}
	return results, nil
}

func (f *fakeSemanticProvider) SemanticReady() bool { return f.ready }
func (f *fakeSemanticProvider) SemanticFailure() string {
	return f.failure
}

func (f *fakeSemanticProvider) SemanticFailureReason() SemanticEgressReason { return f.reason }

func TestHybridProviderRoutesBySpaceWithoutCrossSpaceFallback(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	online := mustTestOnlineProvider(t, built.options)
	localManifest := testZvecManifest()
	local := &fakeSemanticProvider{ready: true}
	hybrid, err := NewHybridSemanticProvider(
		SemanticProviderComponent{Name: "local", Provider: local, Manifest: localManifest, Default: true},
		SemanticProviderComponent{Name: "online", Provider: online, Manifest: built.options.Manifest},
	)
	if err != nil {
		t.Fatalf("hybrid: %v", err)
	}
	if hybrid.SemanticProviderKind() != "hybrid" || hybrid.DefaultSpace() != localManifest.SemanticSpace {
		t.Fatalf("hybrid kind/space = %q/%q", hybrid.SemanticProviderKind(), hybrid.DefaultSpace())
	}
	// The default (local) space never touches the network.
	localRequest := SemanticEmbeddingRequest{
		Purpose: SemanticEmbeddingDocument, GenerationID: "gen_local", Manifest: localManifest,
		Inputs: []SemanticTextInput{{SubjectID: "subj_led", SegmentID: "seg_1", Text: "local text"}},
	}
	if _, err := hybrid.Embed(context.Background(), localRequest); err != nil {
		t.Fatalf("local route: %v", err)
	}
	if local.calls.Load() != 1 || stub.callCount() != 0 {
		t.Fatalf("local route calls = %d/%d, want 1 local and 0 remote", local.calls.Load(), stub.callCount())
	}
	// The online space routes to the egress-gated provider.
	onlineRequest := onlineDocumentRequest(built.options.Manifest, "online text")
	if _, err := hybrid.Embed(context.Background(), onlineRequest); err != nil {
		t.Fatalf("online route: %v", err)
	}
	if stub.callCount() != 1 || local.calls.Load() != 1 {
		t.Fatalf("online route calls = %d/%d, want 1/1", local.calls.Load(), stub.callCount())
	}
	if len(built.sink.snapshot()) != 1 {
		t.Fatalf("online route receipts = %d, want 1", len(built.sink.snapshot()))
	}
	// An unbound space is refused; nothing falls back to either component.
	unbound := testOnlineManifest(t, profile)
	unbound.SemanticSpace = "some-other-space"
	_, err = hybrid.Embed(context.Background(), onlineDocumentRequest(unbound, "unbound text"))
	if reason := SemanticEgressReasonOf(err); reason != EgressReasonSpaceUnbound {
		t.Fatalf("unbound space reason = %q (%v), want %s", reason, err, EgressReasonSpaceUnbound)
	}
	if local.calls.Load() != 1 || stub.callCount() != 1 {
		t.Fatalf("unbound space must not fall back: local=%d online=%d", local.calls.Load(), stub.callCount())
	}
}

func TestHybridProviderReportsComponentsIndependently(t *testing.T) {
	stub := newOnlineStub(t, 4)
	profile := testOnlineProfile(t, stub.server.URL)
	built := testOnlineProviderOptions(t, profile)
	// The request path requires per-request confirmation, which this request
	// does not carry: the online component degrades while the local default
	// stays ready.
	built.options.SendContentWithoutConfirmation = false
	online := mustTestOnlineProvider(t, built.options)
	local := &fakeSemanticProvider{ready: true}
	hybrid, err := NewHybridSemanticProvider(
		SemanticProviderComponent{Name: "local", Provider: local, Manifest: testZvecManifest(), Default: true},
		SemanticProviderComponent{Name: "online", Provider: online, Manifest: built.options.Manifest},
	)
	if err != nil {
		t.Fatalf("hybrid: %v", err)
	}
	if !hybrid.SemanticReady() {
		t.Fatal("the default local component is ready; hybrid must report ready")
	}
	_, err = hybrid.Embed(context.Background(), onlineDocumentRequest(built.options.Manifest, "refused text"))
	if SemanticEgressReasonOf(err) != EgressReasonConfirmationRequired {
		t.Fatalf("online refusal = %v", err)
	}
	if stub.callCount() != 0 {
		t.Fatalf("refused online component made %d network call(s)", stub.callCount())
	}
	statuses := hybrid.ComponentStatuses()
	if len(statuses) != 2 {
		t.Fatalf("component statuses = %+v", statuses)
	}
	if statuses[0].Component != "local" || statuses[0].State != SemanticComponentReady || !statuses[0].Default {
		t.Fatalf("local status = %+v, want READY and default", statuses[0])
	}
	if statuses[1].Component != "online" || statuses[1].State != SemanticComponentUnavailable ||
		statuses[1].Reason != string(EgressReasonConfirmationRequired) {
		t.Fatalf("online status = %+v, want UNAVAILABLE with %s", statuses[1], EgressReasonConfirmationRequired)
	}
	summary := hybrid.SemanticFailure()
	if !strings.Contains(summary, "local=READY") || !strings.Contains(summary, "online=UNAVAILABLE("+string(EgressReasonConfirmationRequired)+")") {
		t.Fatalf("per-component summary = %q", summary)
	}
	// A degraded local default is reported on its own component too.
	local.ready = false
	local.failure = "worker exited"
	local.reason = EgressReasonProviderUnreachable
	statuses = hybrid.ComponentStatuses()
	if statuses[0].State != SemanticComponentUnavailable || statuses[0].Failure != "worker exited" {
		t.Fatalf("local status = %+v", statuses[0])
	}
	if hybrid.SemanticReady() {
		t.Fatal("a degraded default component must make the hybrid provider not ready")
	}
}

func TestHybridProviderConstructionRejectsAmbiguousBindings(t *testing.T) {
	manifest := testZvecManifest()
	local := &fakeSemanticProvider{ready: true}
	other := &fakeSemanticProvider{ready: true}
	tests := []struct {
		name       string
		components []SemanticProviderComponent
		want       string
	}{
		{"single component", []SemanticProviderComponent{{Name: "local", Provider: local, Manifest: manifest, Default: true}}, "at least two"},
		{"no default", []SemanticProviderComponent{
			{Name: "local", Provider: local, Manifest: manifest},
			{Name: "online", Provider: other, Manifest: func() EmbeddingGenerationManifest { m := manifest; m.SemanticSpace = "other"; return m }()},
		}, "exactly one default"},
		{"duplicate space", []SemanticProviderComponent{
			{Name: "local", Provider: local, Manifest: manifest, Default: true},
			{Name: "online", Provider: other, Manifest: manifest},
		}, "duplicates another component's embedding space"},
		{"duplicate name", []SemanticProviderComponent{
			{Name: "local", Provider: local, Manifest: manifest, Default: true},
			{Name: "local", Provider: other, Manifest: func() EmbeddingGenerationManifest { m := manifest; m.SemanticSpace = "other"; return m }()},
		}, "duplicated"},
		{"nil provider", []SemanticProviderComponent{
			{Name: "local", Provider: local, Manifest: manifest, Default: true},
			{Name: "online", Provider: nil, Manifest: func() EmbeddingGenerationManifest { m := manifest; m.SemanticSpace = "other"; return m }()},
		}, "no provider"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := NewHybridSemanticProvider(test.components...)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("construction error = %v, want substring %q", err, test.want)
			}
		})
	}
}
