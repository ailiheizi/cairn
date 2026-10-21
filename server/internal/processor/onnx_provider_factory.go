package processor

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/ailiheizi/cairn/server/internal/search"
)

// The transport retains replay IDs for one worker session. Recycle at a
// fixed serialized boundary instead of clearing that history in place.
const maxONNXWorkerSessionEmbeddings = 1024

// ONNXSemanticEmbeddingProviderFactory binds one admitted bundle and host
// lease policy to per-generation workers. A worker session is intentionally
// scoped to the request's generation ID, so document rebuilds and queries
// cannot cross-replay a generation-bound transport session.
type ONNXSemanticEmbeddingProviderFactory struct {
	options        ONNXWorkerSupervisorOptions
	leaseValidator func(context.Context) error
	workerCtx      context.Context
	workerCancel   context.CancelFunc
	// embedSlot serializes use of the one cached generation-bound worker. A
	// caller waiting behind another query can still cancel without waiting for
	// the active worker to finish.
	embedSlot   chan struct{}
	startWorker func(context.Context, ONNXWorkerSupervisorOptions) (NegotiatedONNXWorker, func() error, error)
	ready       atomic.Bool
	invalid     atomic.Bool
	failure     atomic.Value
	mu          sync.Mutex
	workers     map[uint64]func() error
	nextID      uint64
	session     *onnxCachedSemanticSession
}

type onnxCachedSemanticSession struct {
	generationID     string
	worker           NegotiatedONNXWorker
	textHandles      TextHandleStore
	ownsTextHandles  bool
	closeWorker      func() error
	workerCancel     context.CancelFunc
	workerID         uint64
	executableDigest string
	requestCount     uint64
	closeOnce        sync.Once
	closeErr         error
}

func (s *onnxCachedSemanticSession) close() error {
	if s == nil {
		return nil
	}
	s.closeOnce.Do(func() {
		if s.workerCancel != nil {
			s.workerCancel()
		}
		if s.closeWorker != nil {
			s.closeErr = s.closeWorker()
		}
		if s.ownsTextHandles && s.textHandles != nil {
			if err := s.textHandles.Close(); s.closeErr == nil {
				s.closeErr = err
			}
		}
	})
	return s.closeErr
}

func NewONNXSemanticEmbeddingProviderFactory(options ONNXWorkerSupervisorOptions) (*ONNXSemanticEmbeddingProviderFactory, error) {
	if options.BundleRoot == "" || options.ConfigDigest == "" || options.FenceToken <= 0 || options.FenceValidator == nil {
		return nil, errors.New("ONNX semantic provider factory requires bundle, config, and lease bindings")
	}
	workerCtx, workerCancel := context.WithCancel(context.Background())
	factory := &ONNXSemanticEmbeddingProviderFactory{
		options:        options,
		leaseValidator: options.FenceValidator,
		workerCtx:      workerCtx,
		workerCancel:   workerCancel,
		embedSlot:      make(chan struct{}, 1),
		workers:        make(map[uint64]func() error),
	}
	factory.embedSlot <- struct{}{}
	factory.options.FenceValidator = factory.validateFence
	return factory, nil
}

func (f *ONNXSemanticEmbeddingProviderFactory) Embed(ctx context.Context, req search.SemanticEmbeddingRequest) ([]search.SemanticVector, error) {
	if f == nil || f.options.BundleRoot == "" || req.GenerationID == "" {
		return nil, search.ErrSemanticProviderUnavailable
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("%w: %w", search.ErrSemanticProviderUnavailable, err)
	}
	if err := f.validateFence(ctx); err != nil {
		return nil, fmt.Errorf("%w: %w", search.ErrSemanticProviderUnavailable, err)
	}
	select {
	case <-ctx.Done():
		return nil, fmt.Errorf("%w: %w", search.ErrSemanticProviderUnavailable, ctx.Err())
	case <-f.embedSlot:
	}
	defer func() { f.embedSlot <- struct{}{} }()
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("%w: %w", search.ErrSemanticProviderUnavailable, err)
	}
	if err := f.validateFence(ctx); err != nil {
		return nil, fmt.Errorf("%w: %w", search.ErrSemanticProviderUnavailable, err)
	}

	session, err := f.sessionFor(ctx, req.GenerationID, req.Manifest)
	if err != nil {
		if ctx.Err() == nil || f.invalid.Load() {
			f.ready.Store(false)
			f.failure.Store(err.Error())
		}
		return nil, err
	}
	provider, err := NewONNXSemanticEmbeddingProvider(session.worker)
	if err != nil {
		f.dropSession(session)
		if ctx.Err() == nil || f.invalid.Load() {
			f.ready.Store(false)
			f.failure.Store(err.Error())
		}
		return nil, err
	}
	session.requestCount++
	results, err := provider.Embed(ctx, req)
	queryInputRefusal := req.Purpose == search.SemanticEmbeddingQuery && errors.Is(err, search.ErrSemanticQueryInputTruncated)
	callerCanceled := false
	if ctx.Err() != nil && !f.invalid.Load() && (err == nil || serializedRequestCancellation(ctx, err)) {
		if admissionErr := f.validateCachedAdmission(session); admissionErr != nil {
			f.Invalidate(admissionErr)
			err = fmt.Errorf("%w: cached worker admission changed during embedding: %v", search.ErrSemanticProviderUnavailable, admissionErr)
		} else {
			callerCanceled = true
			err = fmt.Errorf("%w: %w", search.ErrSemanticProviderUnavailable, ctx.Err())
		}
	} else if err == nil || queryInputRefusal {
		requestErr := err
		if admissionErr := f.validateCachedAdmission(session); admissionErr != nil {
			f.Invalidate(admissionErr)
			err = fmt.Errorf("%w: cached worker admission changed during embedding: %v", search.ErrSemanticProviderUnavailable, admissionErr)
		} else {
			err = f.validateFence(ctx)
			if err == nil {
				err = requestErr
			}
		}
	}
	if err != nil && ctx.Err() != nil && !f.invalid.Load() && serializedRequestCancellation(ctx, err) {
		callerCanceled = true
		err = fmt.Errorf("%w: %w", search.ErrSemanticProviderUnavailable, ctx.Err())
	}
	if err != nil {
		if queryInputRefusal && errors.Is(err, search.ErrSemanticQueryInputTruncated) && ctx.Err() == nil && !f.invalid.Load() {
			// Tokenizer refusal is local to this query. Keep the admitted worker
			// only after the same post-call admission and lease checks as success.
			return nil, err
		}
		// An interrupted or failed request can leave the worker transport out of
		// sync. Close it and its bounded plaintext handle store before retry.
		f.dropSession(session)
		if !callerCanceled {
			f.ready.Store(false)
			f.failure.Store(err.Error())
		}
		return nil, err
	}
	f.failure.Store("")
	f.ready.Store(true)
	return results, err
}

// The worker transport serializes some cancellation failures into an outcome
// string. Recover only the current caller's exact context cause, and callers
// must still pass the post-call asset admission check before it is exempted.
func serializedRequestCancellation(ctx context.Context, err error) bool {
	if ctx == nil || err == nil {
		return false
	}
	cause := ctx.Err()
	if cause == nil {
		return false
	}
	return errors.Is(err, cause) || strings.Contains(err.Error(), cause.Error())
}

func (f *ONNXSemanticEmbeddingProviderFactory) sessionFor(ctx context.Context, generationID string, expectedManifest search.EmbeddingGenerationManifest) (*onnxCachedSemanticSession, error) {
	f.mu.Lock()
	session := f.session
	f.mu.Unlock()
	if session != nil && session.generationID != generationID {
		f.dropSession(session)
		session = nil
	}
	if session != nil && session.requestCount >= maxONNXWorkerSessionEmbeddings {
		// A session's transport owns its replay-ID history. Close and re-admit
		// the same generation rather than weakening replay protection by clearing
		// that history while the process remains alive.
		f.dropSession(session)
		session = nil
	}
	if session != nil {
		if err := f.validateCachedAdmission(session); err != nil {
			f.Invalidate(err)
			return nil, fmt.Errorf("%w: cached worker admission changed: %v", search.ErrSemanticProviderUnavailable, err)
		}
		return session, nil
	}
	textHandles := f.options.TextHandles
	ownsTextHandles := textHandles == nil
	if ownsTextHandles {
		var err error
		textHandles, err = NewTextHandleStore(MaxEmbedTextInputBytes*2, MaxEmbedTextInputBytes)
		if err != nil {
			return nil, fmt.Errorf("%w: text handle store: %v", search.ErrSemanticProviderUnavailable, err)
		}
	}
	options := f.options
	options.GenerationID = generationID
	options.TextHandles = textHandles
	start := f.startWorker
	if start == nil {
		start = StartONNXWorker
	}
	executableDigest, err := f.currentExecutableDigest()
	if err != nil {
		if ownsTextHandles {
			_ = textHandles.Close()
		}
		return nil, err
	}
	workerCtx, cancelWorker := context.WithCancel(f.workerCtx)
	stopOnRequestCancel := context.AfterFunc(ctx, func() {
		cancelWorker()
	})
	worker, closeWorker, err := start(workerCtx, options)
	stopOnRequestCancel()
	if err != nil {
		cancelWorker()
		if ownsTextHandles {
			_ = textHandles.Close()
		}
		if ctx.Err() != nil && !f.invalid.Load() {
			if admissionErr := f.validateStartupCancellation(expectedManifest, executableDigest); admissionErr != nil {
				f.Invalidate(admissionErr)
				return nil, fmt.Errorf("%w: startup admission changed while caller canceled: %v", search.ErrSemanticProviderUnavailable, admissionErr)
			}
			return nil, fmt.Errorf("%w: %w", search.ErrSemanticProviderUnavailable, ctx.Err())
		}
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		cancelWorker()
		_ = closeWorker()
		if ownsTextHandles {
			_ = textHandles.Close()
		}
		if !f.invalid.Load() {
			if admissionErr := f.validateStartupCancellation(expectedManifest, executableDigest); admissionErr != nil {
				f.Invalidate(admissionErr)
				return nil, fmt.Errorf("%w: startup admission changed while caller canceled: %v", search.ErrSemanticProviderUnavailable, admissionErr)
			}
		}
		return nil, fmt.Errorf("%w: %w", search.ErrSemanticProviderUnavailable, err)
	}
	currentExecutableDigest, err := f.currentExecutableDigest()
	if err != nil || currentExecutableDigest != executableDigest {
		cancelWorker()
		_ = closeWorker()
		if ownsTextHandles {
			_ = textHandles.Close()
		}
		if err != nil {
			return nil, err
		}
		return nil, errors.New("worker executable changed during admission")
	}
	session = &onnxCachedSemanticSession{
		generationID: generationID, worker: worker, textHandles: textHandles,
		ownsTextHandles: ownsTextHandles, closeWorker: closeWorker, workerCancel: cancelWorker,
		executableDigest: executableDigest,
	}
	workerID, ok := f.registerWorker(session.close)
	if !ok {
		_ = session.close()
		return nil, search.ErrSemanticProviderUnavailable
	}
	session.workerID = workerID
	f.mu.Lock()
	if f.invalid.Load() {
		delete(f.workers, workerID)
		f.mu.Unlock()
		_ = session.close()
		return nil, search.ErrSemanticProviderUnavailable
	}
	f.session = session
	f.mu.Unlock()
	return session, nil
}

// validateStartupCancellation permits only a caller-canceled worker startup to
// remain retryable. Re-admit the current bundle and check the requested
// generation binding plus the host lease before preserving provider readiness.
func (f *ONNXSemanticEmbeddingProviderFactory) validateStartupCancellation(expected search.EmbeddingGenerationManifest, expectedExecutableDigest string) error {
	current, err := LoadONNXWorkerAdmission(f.options.BundleRoot, expected.ProviderDigest, f.options.ConfigDigest)
	if err != nil {
		return err
	}
	if current.Manifest.CanonicalDigest() != expected.CanonicalDigest() {
		return errors.New("worker profile, config, or generation manifest changed during canceled startup")
	}
	executableDigest, err := f.currentExecutableDigest()
	if err != nil {
		return err
	}
	if executableDigest != expectedExecutableDigest {
		return errors.New("worker executable changed during canceled startup")
	}
	if f.leaseValidator == nil {
		return errors.New("semantic worker lease validator is unavailable")
	}
	if err := f.leaseValidator(f.workerCtx); err != nil {
		return err
	}
	return nil
}

// validateCachedAdmission preserves the fresh-worker path's asset and
// executable integrity checks on every reuse. A changed or unavailable bundle
// never leaves the cached generation advertised as ready.
func (f *ONNXSemanticEmbeddingProviderFactory) validateCachedAdmission(session *onnxCachedSemanticSession) error {
	current, err := LoadONNXWorkerAdmission(f.options.BundleRoot, session.worker.Admission.ProfileDigest, f.options.ConfigDigest)
	if err != nil {
		return err
	}
	previous := session.worker.Admission
	if current.ProfileDigest != previous.ProfileDigest || current.WorkerDigest != previous.WorkerDigest ||
		current.QueryPreprocessingDigest != previous.QueryPreprocessingDigest ||
		current.DocumentPreprocessingDigest != previous.DocumentPreprocessingDigest ||
		current.Manifest.CanonicalDigest() != previous.Manifest.CanonicalDigest() {
		return errors.New("worker profile, config, or generation manifest changed")
	}
	executableDigest, err := f.currentExecutableDigest()
	if err != nil {
		return err
	}
	if executableDigest != session.executableDigest {
		return errors.New("worker executable digest changed")
	}
	return nil
}

func (f *ONNXSemanticEmbeddingProviderFactory) currentExecutableDigest() (string, error) {
	command := f.options.Command
	if command == "" {
		var err error
		command, err = os.Executable()
		if err != nil {
			return "", err
		}
	}
	command, err := filepath.Abs(command)
	if err != nil {
		return "", err
	}
	return digestONNXExecutable(command)
}

func (f *ONNXSemanticEmbeddingProviderFactory) dropSession(session *onnxCachedSemanticSession) {
	if session == nil {
		return
	}
	f.mu.Lock()
	if f.session == session {
		f.session = nil
	}
	delete(f.workers, session.workerID)
	f.mu.Unlock()
	_ = session.close()
}

// SemanticReady reports whether this factory has completed a validated real
// embedding call and remains uninvalidated. A canceled request discards its
// worker session but keeps the admitted provider available to start a fresh
// generation-bound session on the next query.
func (f *ONNXSemanticEmbeddingProviderFactory) SemanticReady() bool {
	return f != nil && f.ready.Load() && !f.invalid.Load()
}

// SemanticFailure exposes the host-owned reason that made the real provider
// unavailable without leaking worker details into the public search shape.
func (f *ONNXSemanticEmbeddingProviderFactory) SemanticFailure() string {
	if f == nil {
		return ""
	}
	value := f.failure.Load()
	failure, _ := value.(string)
	return failure
}

// Invalidate fails the provider closed and stops every active worker. A
// daemon restart must acquire a fresh lease before semantic work can resume.
func (f *ONNXSemanticEmbeddingProviderFactory) Invalidate(err error) {
	if f == nil {
		return
	}
	if err == nil {
		err = errors.New("semantic worker lease is unavailable")
	}
	f.failure.Store(err.Error())
	f.invalid.Store(true)
	f.ready.Store(false)
	if f.workerCancel != nil {
		f.workerCancel()
	}
	f.mu.Lock()
	workers := make([]func() error, 0, len(f.workers))
	for workerID, closeWorker := range f.workers {
		workers = append(workers, closeWorker)
		delete(f.workers, workerID)
	}
	f.session = nil
	f.mu.Unlock()
	for _, closeWorker := range workers {
		_ = closeWorker()
	}
}

func (f *ONNXSemanticEmbeddingProviderFactory) validateFence(ctx context.Context) error {
	if f == nil || f.invalid.Load() {
		return errors.New("semantic worker lease is unavailable")
	}
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	validator := f.leaseValidator
	if validator == nil {
		return errors.New("semantic worker lease validator is unavailable")
	}
	if err := validator(ctx); err != nil {
		if ctx != nil && ctx.Err() != nil && errors.Is(err, ctx.Err()) {
			return ctx.Err()
		}
		f.Invalidate(err)
		return err
	}
	return nil
}

func (f *ONNXSemanticEmbeddingProviderFactory) registerWorker(closeWorker func() error) (uint64, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.invalid.Load() {
		return 0, false
	}
	f.nextID++
	f.workers[f.nextID] = closeWorker
	return f.nextID, true
}

var _ search.SemanticEmbeddingProvider = (*ONNXSemanticEmbeddingProviderFactory)(nil)
