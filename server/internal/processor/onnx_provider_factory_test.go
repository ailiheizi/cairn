package processor

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/server/internal/search"
)

func TestONNXSemanticProviderFactoryInvalidationFailsClosedAndStopsWorkers(t *testing.T) {
	factory, err := NewONNXSemanticEmbeddingProviderFactory(ONNXWorkerSupervisorOptions{
		BundleRoot:     "bundle",
		ConfigDigest:   "sha256:config",
		FenceToken:     7,
		FenceValidator: func(context.Context) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	factory.ready.Store(true)
	var closed atomic.Bool
	if _, ok := factory.registerWorker(func() error { closed.Store(true); return nil }); !ok {
		t.Fatal("register active worker")
	}

	factory.Invalidate(errors.New("lease lost"))
	if factory.SemanticReady() {
		t.Fatal("invalidated provider remained ready")
	}
	if !closed.Load() {
		t.Fatal("invalidated provider did not close its active worker")
	}
	if failure := factory.SemanticFailure(); !strings.Contains(failure, "lease lost") {
		t.Fatalf("failure = %q", failure)
	}
	_, err = factory.Embed(context.Background(), search.SemanticEmbeddingRequest{GenerationID: "gen"})
	if !errors.Is(err, search.ErrSemanticProviderUnavailable) {
		t.Fatalf("Embed error = %v, want unavailable", err)
	}
}

func TestONNXSemanticProviderFactoryValidatorFailureInvalidatesProvider(t *testing.T) {
	factory, err := NewONNXSemanticEmbeddingProviderFactory(ONNXWorkerSupervisorOptions{
		BundleRoot:     "bundle",
		ConfigDigest:   "sha256:config",
		FenceToken:     7,
		FenceValidator: func(context.Context) error { return errors.New("renew failed") },
	})
	if err != nil {
		t.Fatal(err)
	}
	factory.ready.Store(true)
	if err := factory.validateFence(context.Background()); err == nil {
		t.Fatal("validator failure was accepted")
	}
	if factory.SemanticReady() {
		t.Fatal("provider remained ready after validator failure")
	}
	if failure := factory.SemanticFailure(); !strings.Contains(failure, "renew failed") {
		t.Fatalf("failure = %q", failure)
	}
}

type factoryLifecycleRuntime struct {
	ONNXWorkerRuntime
	admission    ONNXWorkerAdmission
	generationID string
	fenceToken   string
	identity     *onnxWorkerProcessIdentity
	active       atomic.Int32
	maxActive    atomic.Int32
	entered      chan struct{}
	block        atomic.Bool
	coverage     []EmbedTextCoverage
	embedCount   atomic.Int32
	afterEmbed   func()
}

func (r *factoryLifecycleRuntime) onnxWorkerProcessIdentity() *onnxWorkerProcessIdentity {
	return r.identity
}

func (r *factoryLifecycleRuntime) onnxWorkerInvocationBinding() (string, string, string) {
	return "factory-test-session", r.generationID, r.fenceToken
}

func (r *factoryLifecycleRuntime) EmbedTextWithText(ctx context.Context, req EmbedTextRequest, inputs []ONNXWorkerTextInput) (EmbedTextResultBatch, error) {
	active := r.active.Add(1)
	defer r.active.Add(-1)
	for current := r.maxActive.Load(); active > current; current = r.maxActive.Load() {
		if r.maxActive.CompareAndSwap(current, active) {
			break
		}
	}
	if r.entered != nil && r.block.Load() {
		select {
		case r.entered <- struct{}{}:
		default:
		}
		<-ctx.Done()
		return EmbedTextResultBatch{}, ctx.Err()
	}
	coverage := EmbedTextCoverageFull
	index := int(r.embedCount.Add(1) - 1)
	if index < len(r.coverage) {
		coverage = r.coverage[index]
	}
	result, err := (semanticProviderTestRuntime{admission: r.admission, coverage: coverage}).EmbedTextWithText(ctx, req, inputs)
	if r.afterEmbed != nil {
		r.afterEmbed()
	}
	return result, err
}

func (r *factoryLifecycleRuntime) Probe(ctx context.Context, admission ONNXWorkerAdmission) (ONNXWorkerProbeResult, error) {
	return r.ONNXWorkerRuntime.Probe(ctx, admission)
}

var _ ONNXWorkerRuntime = (*factoryLifecycleRuntime)(nil)

func newLifecycleFactory(t *testing.T, admission ONNXWorkerAdmission, runtimeFor func(string) *factoryLifecycleRuntime) (*ONNXSemanticEmbeddingProviderFactory, *atomic.Int32, *atomic.Int32, *[]TextHandleStore) {
	t.Helper()
	var starts atomic.Int32
	var closes atomic.Int32
	var storesMu sync.Mutex
	var stores []TextHandleStore
	factory, err := NewONNXSemanticEmbeddingProviderFactory(ONNXWorkerSupervisorOptions{
		BundleRoot: admission.Assets.Root, ConfigDigest: admission.Manifest.ConfigDigest,
		FenceToken: 7, FenceValidator: func(ctx context.Context) error { return ctx.Err() },
	})
	if err != nil {
		t.Fatal(err)
	}
	factory.startWorker = func(ctx context.Context, options ONNXWorkerSupervisorOptions) (NegotiatedONNXWorker, func() error, error) {
		starts.Add(1)
		base := semanticProviderTestRuntime{admission: admission}
		attested, proof := attestONNXWorkerProcessRuntimeForTest(base)
		runtime := runtimeFor(options.GenerationID)
		runtime.ONNXWorkerRuntime = attested
		runtime.identity = proof.identity
		runtime.fenceToken = strconv.FormatInt(options.FenceToken, 10)
		runtime.admission = admission
		runtime.generationID = options.GenerationID
		host := ONNXWorkerHostCapabilities{
			Protocol: ONNXWorkerProtocol, Schema: ONNXWorkerSchema, Platform: admission.Platform,
			MaxInputBytes: MaxEmbedTextInputBytes, MaxInputTokens: MaxEmbedTextInputTokens,
			MaxOutputBytes: MaxEmbedTextOutputBytes, Runtime: runtime,
			TextHandles: options.TextHandles, processProof: proof,
		}
		worker, err := admission.Negotiate(ctx, host)
		if err != nil {
			return NegotiatedONNXWorker{}, nil, err
		}
		storesMu.Lock()
		stores = append(stores, options.TextHandles)
		storesMu.Unlock()
		return worker, func() error { closes.Add(1); return nil }, nil
	}
	return factory, &starts, &closes, &stores
}

func embedFactoryQuery(factory *ONNXSemanticEmbeddingProviderFactory, admission ONNXWorkerAdmission, generationID, text string) error {
	_, err := factory.Embed(context.Background(), search.SemanticEmbeddingRequest{
		Purpose: search.SemanticEmbeddingQuery, GenerationID: generationID,
		Manifest: admission.Manifest, Inputs: []search.SemanticTextInput{{SegmentID: "query", Text: text}},
	})
	return err
}

func TestONNXSemanticProviderFactoryTruncatedQueryKeepsHealthyWorker(t *testing.T) {
	admission := testONNXAdmission(t)
	var runtime *factoryLifecycleRuntime
	factory, starts, closes, stores := newLifecycleFactory(t, admission, func(string) *factoryLifecycleRuntime {
		runtime = &factoryLifecycleRuntime{coverage: []EmbedTextCoverage{EmbedTextCoverageFull, EmbedTextCoverageTruncated, EmbedTextCoverageFull}}
		return runtime
	})
	if err := embedFactoryQuery(factory, admission, "generation-a", "initial short query"); err != nil {
		t.Fatal(err)
	}
	if err := embedFactoryQuery(factory, admission, "generation-a", "overlong query"); !errors.Is(err, search.ErrInvalidQuery) || !errors.Is(err, search.ErrSemanticQueryInputTruncated) {
		t.Fatalf("truncated query error = %v, want typed query refusal", err)
	}
	if !factory.SemanticReady() || starts.Load() != 1 || closes.Load() != 0 || factory.session == nil {
		t.Fatalf("truncation damaged healthy session: ready=%t starts=%d closes=%d session=%p", factory.SemanticReady(), starts.Load(), closes.Load(), factory.session)
	}
	if err := embedFactoryQuery(factory, admission, "generation-a", "following short query"); err != nil {
		t.Fatalf("short query after truncation: %v", err)
	}
	if !factory.SemanticReady() || starts.Load() != 1 || closes.Load() != 0 || runtime.embedCount.Load() != 3 {
		t.Fatalf("post-truncation lifecycle: ready=%t starts=%d closes=%d embeds=%d", factory.SemanticReady(), starts.Load(), closes.Load(), runtime.embedCount.Load())
	}
	factory.Invalidate(errors.New("test shutdown"))
	if closes.Load() != 1 || len(*stores) != 1 {
		t.Fatalf("shutdown lifecycle: closes=%d stores=%d, want 1/1", closes.Load(), len(*stores))
	}
}

func TestONNXSemanticProviderFactoryTruncatedQueryStillFailsClosedOnPostCallChanges(t *testing.T) {
	for _, mode := range []string{"fence", "admission"} {
		t.Run(mode, func(t *testing.T) {
			admission := testONNXAdmission(t)
			var runtime *factoryLifecycleRuntime
			factory, starts, closes, _ := newLifecycleFactory(t, admission, func(string) *factoryLifecycleRuntime {
				runtime = &factoryLifecycleRuntime{coverage: []EmbedTextCoverage{EmbedTextCoverageFull, EmbedTextCoverageTruncated}}
				return runtime
			})
			if err := embedFactoryQuery(factory, admission, "generation-a", "initial query"); err != nil {
				t.Fatal(err)
			}
			if mode == "fence" {
				var lost atomic.Bool
				factory.leaseValidator = func(ctx context.Context) error {
					if lost.Load() {
						return errors.New("lease changed during worker call")
					}
					return ctx.Err()
				}
				runtime.afterEmbed = func() { lost.Store(true) }
			} else {
				runtime.afterEmbed = func() {
					model, err := os.ReadFile(admission.Assets.Model)
					if err != nil {
						t.Errorf("read model fixture: %v", err)
						return
					}
					if err := os.WriteFile(admission.Assets.Model, append(model, 'x'), 0o600); err != nil {
						t.Errorf("change model fixture: %v", err)
					}
				}
			}
			err := embedFactoryQuery(factory, admission, "generation-a", "overlong query")
			if err == nil || errors.Is(err, search.ErrSemanticQueryInputTruncated) {
				t.Fatalf("query error = %v, want post-call admission/fence failure", err)
			}
			if factory.SemanticReady() || !factory.invalid.Load() || starts.Load() != 1 || closes.Load() != 1 {
				t.Fatalf("post-call failure did not fail closed: ready=%t invalid=%t starts=%d closes=%d", factory.SemanticReady(), factory.invalid.Load(), starts.Load(), closes.Load())
			}
		})
	}
}

func TestONNXSemanticProviderFactoryReusesGenerationAndClosesOnSwitch(t *testing.T) {
	admission := testONNXAdmission(t)
	factory, starts, closes, stores := newLifecycleFactory(t, admission, func(string) *factoryLifecycleRuntime { return &factoryLifecycleRuntime{} })
	if err := embedFactoryQuery(factory, admission, "generation-a", "first"); err != nil {
		t.Fatal(err)
	}
	if err := embedFactoryQuery(factory, admission, "generation-a", "second"); err != nil {
		t.Fatal(err)
	}
	if starts.Load() != 1 {
		t.Fatalf("same-generation starts = %d, want 1", starts.Load())
	}
	if err := embedFactoryQuery(factory, admission, "generation-b", "new generation"); err != nil {
		t.Fatal(err)
	}
	if starts.Load() != 2 {
		t.Fatalf("starts after generation switch = %d, want 2", starts.Load())
	}
	if len(*stores) != 2 {
		t.Fatalf("text stores = %d, want 2", len(*stores))
	}
	if !textStoreIsClosed(t, (*stores)[0]) {
		t.Fatal("old generation text store remains open")
	}
	if closes.Load() != 1 {
		t.Fatalf("worker closes after generation switch = %d, want 1", closes.Load())
	}
	factory.Invalidate(errors.New("test shutdown"))
	if !textStoreIsClosed(t, (*stores)[1]) {
		t.Fatal("text store remains open after invalidation")
	}
	if closes.Load() != 2 {
		t.Fatalf("worker closes after shutdown = %d, want 2", closes.Load())
	}
}

func textStoreIsClosed(t *testing.T, store TextHandleStore) bool {
	t.Helper()
	memory, ok := store.(*InMemoryTextHandleStore)
	if !ok {
		t.Fatalf("text handle store type = %T", store)
	}
	memory.mu.RLock()
	defer memory.mu.RUnlock()
	return memory.closed && memory.totalBytes == 0 && len(memory.handles) == 0
}

func TestONNXSemanticProviderFactoryCancellationClosesSession(t *testing.T) {
	admission := testONNXAdmission(t)
	entered := make(chan struct{}, 1)
	var created atomic.Int32
	var firstRuntime *factoryLifecycleRuntime
	factory, starts, closes, stores := newLifecycleFactory(t, admission, func(string) *factoryLifecycleRuntime {
		if created.Add(1) == 1 {
			firstRuntime = &factoryLifecycleRuntime{entered: entered}
			return firstRuntime
		}
		return &factoryLifecycleRuntime{}
	})
	if err := embedFactoryQuery(factory, admission, "generation-a", "readiness probe"); err != nil {
		t.Fatal(err)
	}
	preCanceled, cancelPreCanceled := context.WithCancel(context.Background())
	cancelPreCanceled()
	_, err := factory.Embed(preCanceled, search.SemanticEmbeddingRequest{
		Purpose: search.SemanticEmbeddingQuery, GenerationID: "generation-a", Manifest: admission.Manifest,
		Inputs: []search.SemanticTextInput{{SegmentID: "query", Text: "already canceled"}},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("pre-canceled request error = %v, want context.Canceled", err)
	}
	if factory.invalid.Load() || !factory.SemanticReady() || starts.Load() != 1 {
		t.Fatalf("pre-canceled request damaged the cached provider: invalid=%t ready=%t starts=%d", factory.invalid.Load(), factory.SemanticReady(), starts.Load())
	}
	firstRuntime.block.Store(true)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := factory.Embed(ctx, search.SemanticEmbeddingRequest{
			Purpose: search.SemanticEmbeddingQuery, GenerationID: "generation-a", Manifest: admission.Manifest,
			Inputs: []search.SemanticTextInput{{SegmentID: "query", Text: "cancel me"}},
		})
		done <- err
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("worker was not entered")
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("canceled request succeeded")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("canceled request did not return")
	}
	if !factory.SemanticReady() {
		t.Fatal("soft cancellation disabled provider readiness and prevents a retry")
	}
	if !textStoreIsClosed(t, (*stores)[0]) {
		t.Fatal("canceled worker retained its text handle store")
	}
	if closes.Load() != 1 {
		t.Fatalf("worker closes after cancellation = %d, want 1", closes.Load())
	}
	if err := embedFactoryQuery(factory, admission, "generation-a", "retry"); err != nil {
		t.Fatal(err)
	}
	if starts.Load() != 2 {
		t.Fatalf("worker starts after cancel = %d, want 2", starts.Load())
	}
	factory.Invalidate(errors.New("test shutdown"))
}

func TestONNXSemanticProviderFactoryCallerCanceledStartupRemainsRetryable(t *testing.T) {
	admission := testONNXAdmission(t)
	factory, starts, closes, _ := newLifecycleFactory(t, admission, func(string) *factoryLifecycleRuntime { return &factoryLifecycleRuntime{} })
	if err := embedFactoryQuery(factory, admission, "generation-a", "initial ready query"); err != nil {
		t.Fatal(err)
	}
	// Force the next query through worker startup, then model the native
	// supervisor returning a serialized cancellation error after the request
	// context cancels its startup context.
	factory.dropSession(factory.session)
	realStart := factory.startWorker
	started := make(chan struct{})
	factory.startWorker = func(ctx context.Context, _ ONNXWorkerSupervisorOptions) (NegotiatedONNXWorker, func() error, error) {
		starts.Add(1)
		close(started)
		<-ctx.Done()
		return NegotiatedONNXWorker{}, nil, errors.New("worker startup ended: request context canceled")
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := factory.Embed(ctx, search.SemanticEmbeddingRequest{
			Purpose: search.SemanticEmbeddingQuery, GenerationID: "generation-a", Manifest: admission.Manifest,
			Inputs: []search.SemanticTextInput{{SegmentID: "query", Text: "cancel startup"}},
		})
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("worker startup did not begin")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("canceled startup error = %v, want context.Canceled", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("canceled startup did not return")
	}
	if !factory.SemanticReady() || factory.invalid.Load() {
		t.Fatalf("caller cancellation damaged admitted provider: ready=%t invalid=%t", factory.SemanticReady(), factory.invalid.Load())
	}
	factory.startWorker = realStart
	if err := embedFactoryQuery(factory, admission, "generation-a", "retry after startup cancellation"); err != nil {
		t.Fatalf("retry after canceled startup: %v", err)
	}
	if starts.Load() != 3 {
		t.Fatalf("worker starts = %d, want initial, canceled, and retry starts", starts.Load())
	}
	if closes.Load() != 1 {
		t.Fatalf("closed completed workers = %d, want initial session only", closes.Load())
	}
	factory.Invalidate(errors.New("test shutdown"))
}

func TestONNXSemanticProviderFactorySerializesConcurrentQueries(t *testing.T) {
	admission := testONNXAdmission(t)
	var mu sync.Mutex
	var runtime *factoryLifecycleRuntime
	factory, starts, _, _ := newLifecycleFactory(t, admission, func(string) *factoryLifecycleRuntime {
		mu.Lock()
		defer mu.Unlock()
		runtime = &factoryLifecycleRuntime{}
		return runtime
	})
	start := make(chan struct{})
	errs := make(chan error, 2)
	for _, text := range []string{"one", "two"} {
		go func(text string) {
			<-start
			errs <- embedFactoryQuery(factory, admission, "generation-a", text)
		}(text)
	}
	close(start)
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	if starts.Load() != 1 {
		t.Fatalf("concurrent same-generation starts = %d, want 1", starts.Load())
	}
	mu.Lock()
	gotMax := int32(0)
	if runtime != nil {
		gotMax = runtime.maxActive.Load()
	}
	mu.Unlock()
	if gotMax != 1 {
		t.Fatalf("maximum active calls on cached worker = %d, want 1", gotMax)
	}
	factory.Invalidate(errors.New("test shutdown"))
}

func TestONNXSemanticProviderFactoryRecyclesBoundedTransportSession(t *testing.T) {
	admission := testONNXAdmission(t)
	factory, starts, closes, _ := newLifecycleFactory(t, admission, func(string) *factoryLifecycleRuntime { return &factoryLifecycleRuntime{} })
	if err := embedFactoryQuery(factory, admission, "generation-a", "initial"); err != nil {
		t.Fatal(err)
	}
	factory.session.requestCount = maxONNXWorkerSessionEmbeddings - 1
	if err := embedFactoryQuery(factory, admission, "generation-a", "at ceiling"); err != nil {
		t.Fatal(err)
	}
	if starts.Load() != 1 || closes.Load() != 0 {
		t.Fatalf("worker lifecycle before ceiling = starts %d, closes %d", starts.Load(), closes.Load())
	}
	if err := embedFactoryQuery(factory, admission, "generation-a", "after ceiling"); err != nil {
		t.Fatal(err)
	}
	if starts.Load() != 2 || closes.Load() != 1 {
		t.Fatalf("worker lifecycle after ceiling = starts %d, closes %d, want 2/1", starts.Load(), closes.Load())
	}
	factory.Invalidate(errors.New("test shutdown"))
	if closes.Load() != 2 {
		t.Fatalf("shutdown close count = %d, want 2", closes.Load())
	}
}

func TestONNXSemanticProviderFactoryRevalidatesBundleBeforeReuse(t *testing.T) {
	admission := testONNXAdmission(t)
	factory, starts, closes, _ := newLifecycleFactory(t, admission, func(string) *factoryLifecycleRuntime { return &factoryLifecycleRuntime{} })
	if err := embedFactoryQuery(factory, admission, "generation-a", "first"); err != nil {
		t.Fatal(err)
	}
	asset, err := os.ReadFile(admission.Assets.Model)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(admission.Assets.Model, append(asset, 'x'), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := embedFactoryQuery(factory, admission, "generation-a", "tampered"); err == nil {
		t.Fatal("tampered bundle was accepted")
	}
	if factory.SemanticReady() {
		t.Fatal("tampered bundle left stale readiness")
	}
	if starts.Load() != 1 {
		t.Fatalf("asset failure launched %d workers, want 1", starts.Load())
	}
	if !factory.invalid.Load() || closes.Load() != 1 {
		t.Fatalf("asset failure must hard invalidate and close cached worker: invalid=%t closes=%d", factory.invalid.Load(), closes.Load())
	}
	factory.Invalidate(errors.New("test shutdown"))
}
