package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	cairnconfig "github.com/ailiheizi/cairn/config"
	"github.com/ailiheizi/cairn/server/internal/access"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/identify"
	"github.com/ailiheizi/cairn/server/internal/processor"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// Dispatcher routes command envelopes to implemented operations and returns a
// truthful result for every operation, including known-but-unimplemented ones.
// It only reads the rebuildable SQLite projection; it never fabricates success
// for operations that have no implementation in this build.
type Dispatcher struct {
	store                          *sqlite.Store
	catalogPath                    string
	socketPath                     string
	configDigest                   string
	indexBinding                   search.IndexBinding
	vectorPath                     string
	semanticBinding                semanticIndexerBinding
	imageBinding                   imageIndexerBinding
	semanticBundle                 command.Capability
	semanticBundleMu               sync.RWMutex
	semanticBundleInstallMu        sync.Mutex
	semanticBundleModelsRoot       string
	semanticBundleInstaller        SemanticBundleInstaller
	semanticBundleArchiveInstaller SemanticBundleArchiveInstaller
	imageBundleModelsRoot          string
	imageBundleArchiveInstaller    ImageBundleArchiveInstaller
	imageBundleInstallMu           sync.Mutex
	onlineProviderModelsRoot       string
	onlineProviderInstaller        OnlineProviderProfileInstaller
	onlineProviderInstallMu        sync.Mutex
	// describeProvider is the on-demand DESCRIBE_SUBJECT provider bound at
	// daemon startup. A nil provider keeps description.generate visible but
	// unimplemented, which keeps the operation's capability row honest.
	describeProvider search.DescribeProvider
	// describeModelsRoot is the models root the describe provider's profile
	// was admitted from. Egress grant creation verifies a grant against the
	// installed profile there when no embedding profile matches.
	describeModelsRoot string
	now                func() time.Time
	exact              *exact.Service
	search             *search.Indexer
	fixtureDimensions  bool
	sessions           *contentSessions
	access             *access.Service
	recoveryReader     *recoveryReaderState
	operatorConfig     *operatorConfigState
	// ocrBundleRoot is the single operator-installed OCR profile location
	// below the resolved paths.models root. It is empty when no persisted
	// profile was supplied; OCR then reports NOT_BUILT and never runs.
	ocrBundleRoot string
	// ocrProcessor is the registered OCR processor, kept so shutdown can
	// release its native session.
	ocrProcessor *processor.OCRImageText
	// tagApplyStepFailure is a test-only seam on the documented
	// add-then-tombstone boundary of annotation.tag_apply. It is nil in
	// production; a test installs it to fail one named step exactly as a real
	// store failure would, so an interruption between the two steps can be
	// proven to leave a subject carrying both names rather than neither.
	tagApplyStepFailure func(subjectRef, action string) error
	// inboxRoot is the daemon-owned upload staging inbox, derived from the
	// configured catalog's parent directory. It is daemon scratch, never a
	// durable store; an empty root keeps uploads disabled.
	inboxRoot string
	// uploadInFlight is the process-wide count of bytes currently being
	// streamed into the staging inbox. It bounds concurrent upload traffic
	// and is the only cross-request upload state in the process.
	uploadInFlight atomic.Int64
	// uploadLimits holds the operator-approved upload bounds; tests may
	// shrink them without rewriting the constants.
	uploadLimits  uploadLimits
	implemented   map[string]bool
	unimplemented []string
}

const modelBundleCapabilityKind = "model-bundle"

// semanticIndexerBinding is a host-owned runtime handoff. It is deliberately
// not persisted or exposed through the command ABI; a missing binding keeps
// the default daemon's semantic capability unavailable.
type semanticIndexerBinding struct {
	provider      search.SemanticEmbeddingProvider
	zvec          search.ZvecGenerationDriver
	libraryPath   string
	libraryDigest string
	manifest      search.EmbeddingGenerationManifest
}

// imageIndexerBinding is the host-owned runtime handoff for the separate image
// embedding space. It is additive and optional: a missing binding keeps the
// multimodal dimension NOT_BUILT (no artifact) or UNAVAILABLE (artifact present
// but unrunnable), and never affects exact save, lexical search, or the text
// semantic dimension. source is the host-owned admitted-bytes boundary; the
// search package never opens a repository itself.
type imageIndexerBinding struct {
	provider      search.ImageEmbeddingProvider
	zvec          search.ZvecGenerationDriver
	source        search.ImageContentSource
	libraryPath   string
	libraryDigest string
	manifest      search.EmbeddingGenerationManifest
}

// SemanticBundleInstallReceipt is the narrow control-plane receipt returned by
// the host-owned fixed bundle installer. Admission remains owned by the
// search package; the control plane only publishes its result as a capability.
type SemanticBundleInstallReceipt struct {
	Admission   search.SemanticBundleAdmission
	Destination string
	Changed     bool
}

// SemanticBundleInstaller is deliberately not a general model manager. The
// daemon supplies the persisted paths.models root and the callback may only
// install the pinned local BGE/ONNX+zvec profile there.
type SemanticBundleInstaller func(context.Context, string) (SemanticBundleInstallReceipt, error)

// SemanticBundleArchiveInstaller is the offline counterpart to
// SemanticBundleInstaller. The archive path is supplied by the operator and
// the callback remains restricted to the configured models root.
type SemanticBundleArchiveInstaller func(context.Context, string, string) (SemanticBundleInstallReceipt, error)

// ImageBundleInstallReceipt is the deterministic result of one image bundle
// archive installation: the admission the daemon verified and where it landed.
type ImageBundleInstallReceipt struct {
	Admission   search.ImageBundleAdmission
	Destination string
	Changed     bool
}

// ImageBundleArchiveInstaller installs one image bundle archive into the
// configured models root. Like its semantic counterpart it is not a general
// model manager: the callback may only install the admitted image profile there.
type ImageBundleArchiveInstaller func(context.Context, string, string) (ImageBundleInstallReceipt, error)

// OnlineProviderInstallReceipt is the deterministic result of one online
// provider profile installation: the admission the daemon verified and where
// it landed.
type OnlineProviderInstallReceipt struct {
	Profile          search.OnlineEmbeddingProfile
	Destination      string
	Changed          bool
	AlreadyInstalled bool
}

// OnlineProviderProfileInstaller admits one operator-supplied online provider
// profile document into the configured models root. The source is an absolute
// local path on the host; a URL is never an install source.
type OnlineProviderProfileInstaller func(context.Context, string, string, string) (OnlineProviderInstallReceipt, error)

// DispatcherOption configures optional exact-lane handlers.
type DispatcherOption func(*Dispatcher)

// WithConfigDigest binds the resolved, redacted operator profile to status,
// plans, and publications without exposing credential material.
func WithConfigDigest(digest string) DispatcherOption {
	return func(d *Dispatcher) {
		d.configDigest = strings.TrimSpace(digest)
		// The effective config is authoritative when both options are used.
		// This keeps option order deterministic and prevents a stale binding
		// digest from being attached to a current daemon profile.
		d.indexBinding.ConfigDigest = d.configDigest
	}
}

// WithOperatorConfig enables validated reads and atomic updates of the same
// persisted profile selected at daemon startup. Updates never hot-swap live
// services; callers receive an explicit restart-required state instead.
func WithOperatorConfig(resolved cairnconfig.ResolvedConfig) DispatcherOption {
	return func(d *Dispatcher) {
		if strings.TrimSpace(resolved.ConfigPath) == "" {
			return
		}
		d.operatorConfig = &operatorConfigState{path: resolved.ConfigPath, runningDigest: resolved.Digest}
		// The OCR profile location follows the same persisted paths.models
		// root and <profile>/<goos-goarch> convention as the pinned semantic
		// bundle. No second config key and no second location are introduced.
		d.ocrBundleRoot = processor.OCRBundleRoot(resolved.Config.Paths.Models)
	}
}

// WithIndexBinding binds daemon-created index generations to the resolved
// configuration and immutable provider/profile identities.
func WithIndexBinding(binding search.IndexBinding) DispatcherOption {
	return func(d *Dispatcher) {
		if strings.TrimSpace(d.configDigest) != "" {
			binding.ConfigDigest = d.configDigest
		}
		d.indexBinding = binding
		if strings.TrimSpace(d.configDigest) == "" {
			d.configDigest = strings.TrimSpace(binding.ConfigDigest)
		}
	}
}

// WithVectorPath binds disposable search generations to the persisted vector
// location selected by the operator profile. Daemon callers should always
// provide this path; the repository-relative fallback below is retained for
// low-level harnesses that construct a dispatcher without resolved config.
func WithVectorPath(path string) DispatcherOption {
	return func(d *Dispatcher) {
		d.vectorPath = strings.TrimSpace(path)
	}
}

// WithSemanticIndexerBinding installs an already-admitted semantic worker and
// zvec driver. The caller remains responsible for process proof, bundle
// admission, and native-library digest validation before invoking this option.
func WithSemanticIndexerBinding(provider search.SemanticEmbeddingProvider, zvec search.ZvecGenerationDriver, libraryPath, libraryDigest string, manifest search.EmbeddingGenerationManifest) DispatcherOption {
	return func(d *Dispatcher) {
		d.semanticBinding = semanticIndexerBinding{
			provider: provider, zvec: zvec, libraryPath: strings.TrimSpace(libraryPath),
			libraryDigest: strings.TrimSpace(libraryDigest), manifest: manifest,
		}
	}
}

// WithImageIndexerBinding installs an already-admitted image embedding
// provider, its vector backend, its admitted-bytes source, and the immutable
// generation manifest. The caller remains responsible for bundle admission,
// native-library digest validation, and the provider's readiness probe before
// invoking this option. A missing binding leaves the image dimension NOT_BUILT
// and is never substituted by fixture vectors.
func WithImageIndexerBinding(provider search.ImageEmbeddingProvider, zvec search.ZvecGenerationDriver, source search.ImageContentSource, libraryPath, libraryDigest string, manifest search.EmbeddingGenerationManifest) DispatcherOption {
	return func(d *Dispatcher) {
		d.imageBinding = imageIndexerBinding{
			provider: provider, zvec: zvec, source: source, libraryPath: strings.TrimSpace(libraryPath),
			libraryDigest: strings.TrimSpace(libraryDigest), manifest: manifest,
		}
	}
}

// WithSemanticBundleCapability reports the independent local bundle admission
// result. It deliberately remains separate from semantic index readiness:
// valid model files do not imply that a generation has been built.
func WithSemanticBundleCapability(capability command.Capability) DispatcherOption {
	return func(d *Dispatcher) {
		if strings.TrimSpace(capability.Kind) == "" {
			capability.Kind = modelBundleCapabilityKind
		}
		d.semanticBundle = capability
	}
}

// WithSemanticBundleInstaller enables the explicit semantic.bundle.install
// operation for one persisted models root. A nil callback leaves the
// operation visible but unavailable, which keeps override and test harness
// configurations honest.
func WithSemanticBundleInstaller(modelsRoot string, installer SemanticBundleInstaller) DispatcherOption {
	return func(d *Dispatcher) {
		d.semanticBundleModelsRoot = strings.TrimSpace(modelsRoot)
		d.semanticBundleInstaller = installer
	}
}

// WithSemanticBundleArchiveInstaller enables archive-backed installs for the
// same semantic.bundle.install operation. It does not create a second policy
// or publication path.
// WithImageBundleArchiveInstaller enables one archive-backed install path for
// the image dimension's model bundle. It creates no second policy or state: the
// install admits the archive into the configured models root, and the image
// dimension keeps reporting NOT_BUILT until a generation is built.
func WithImageBundleArchiveInstaller(modelsRoot string, installer ImageBundleArchiveInstaller) DispatcherOption {
	return func(d *Dispatcher) {
		d.imageBundleModelsRoot = strings.TrimSpace(modelsRoot)
		d.imageBundleArchiveInstaller = installer
	}
}

func WithSemanticBundleArchiveInstaller(modelsRoot string, installer SemanticBundleArchiveInstaller) DispatcherOption {
	return func(d *Dispatcher) {
		d.semanticBundleModelsRoot = strings.TrimSpace(modelsRoot)
		d.semanticBundleArchiveInstaller = installer
	}
}

// WithOnlineProviderInstaller enables the explicit semantic.provider.install
// operation and the read-only semantic.provider.list operation for one
// persisted models root. A nil callback leaves installation unimplemented
// while listing stays available, which keeps override and test harness
// configurations honest.
func WithOnlineProviderInstaller(modelsRoot string, installer OnlineProviderProfileInstaller) DispatcherOption {
	return func(d *Dispatcher) {
		d.onlineProviderModelsRoot = strings.TrimSpace(modelsRoot)
		d.onlineProviderInstaller = installer
	}
}

// WithDescribeProvider binds the on-demand DESCRIBE_SUBJECT provider the
// daemon admitted at startup and enables the description.generate operation.
// A nil provider leaves the operation unimplemented so capability.list keeps
// reporting the honest state. modelsRoot is where the provider's immutable
// profile is installed; egress grant creation verifies against it.
func WithDescribeProvider(provider search.DescribeProvider, modelsRoot string) DispatcherOption {
	return func(d *Dispatcher) {
		if provider == nil {
			return
		}
		d.describeProvider = provider
		d.describeModelsRoot = strings.TrimSpace(modelsRoot)
	}
}

// WithExact enables capture-qualified ingest, snapshot list/diff/verify,
// recovery.export, and catalog-free restore when a repository-backed exact
// service is available.
func WithExact(service *exact.Service) DispatcherOption {
	return func(d *Dispatcher) {
		d.exact = service
	}
}

// WithFixtureDimensions enables deterministic acoustic/embedding fixtures for
// tests and qualification harnesses. It does not represent the production
// local BGE+zvec capability; the real provider must replace this wiring.
func WithFixtureDimensions() DispatcherOption {
	return func(d *Dispatcher) {
		d.fixtureDimensions = true
	}
}

// WithExactDir opens a directory CAS at repoDir and enables the exact lane.
// Harness tests outside server/internal use this instead of constructing
// internal exact.Service values.
func WithExactDir(store *sqlite.Store, repoDir string) (DispatcherOption, error) {
	if store == nil {
		return nil, errors.New("catalog is required")
	}
	repo, err := repository.OpenDir(repoDir)
	if err != nil {
		return nil, err
	}
	return WithExact(&exact.Service{Store: store, Repo: repo}), nil
}

// WarmSemanticGeneration reopens a previously built real semantic index for
// one workspace after process restart. It does not rebuild or mutate durable
// descriptions and annotations.
func (d *Dispatcher) WarmSemanticGeneration(ctx context.Context, workspaceID string) error {
	if d == nil || d.search == nil {
		return search.ErrUnavailable
	}
	return d.search.WarmSemanticGeneration(ctx, workspaceID)
}

// WarmImageGeneration reopens a previously built image generation for one
// workspace after process restart. Readiness is granted only after the
// generation's bindings and receipt verify against the current binding.
func (d *Dispatcher) WarmImageGeneration(ctx context.Context, workspaceID string) error {
	if d == nil || d.search == nil {
		return search.ErrUnavailable
	}
	return d.search.WarmImageGeneration(ctx, workspaceID)
}

// NewDispatcher wires the control plane to the opened catalog. catalogPath is
// reported by status.get; socketPath is reported as the listen address.
func NewDispatcher(store *sqlite.Store, catalogPath, socketPath string, opts ...DispatcherOption) *Dispatcher {
	implemented := map[string]bool{
		command.OpStatusGet:          true,
		command.OpDoctorCheck:        true,
		command.OpCapabilityList:     true,
		command.OpNamespaceList:      true,
		command.OpSourceList:         true,
		command.OpContentList:        true,
		command.OpSubjectFactsList:   true,
		command.OpNamespaceResolve:   true,
		command.OpNamespaceStat:      true,
		command.OpNamespaceReadlink:  true,
		command.OpRepresentationList: true,
		command.OpPlanGet:            true,
		command.OpPlanApply:          true,
		command.OpPlanRevise:         true,
		command.OpPlanAbandon:        true,
		command.OpJobEvents:          true,
		command.OpJobCancel:          true,
		command.OpJobList:            true,
		command.OpDescriptionList:    true,
		command.OpDescriptionGet:     true,
		command.OpDescriptionCreate:  true,
	}
	dispatcher := &Dispatcher{
		store:        store,
		catalogPath:  catalogPath,
		socketPath:   socketPath,
		now:          time.Now,
		inboxRoot:    inboxRoot(catalogPath),
		uploadLimits: defaultUploadLimits(),
		semanticBundle: command.Capability{
			Kind: modelBundleCapabilityKind, ID: search.SemanticBundleBGEProfileID,
			State: command.CapabilityUnavailable, Version: "1",
			Source: "BAAI/bge-small-zh-v1.5",
			Notes:  "local semantic bundle is not installed or has not passed integrity admission",
		},
		implemented: implemented,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(dispatcher)
		}
	}
	if dispatcher.semanticBundleInstaller != nil && strings.TrimSpace(dispatcher.semanticBundleModelsRoot) != "" {
		implemented[command.OpSemanticBundleInstall] = true
	}
	if dispatcher.imageBundleArchiveInstaller != nil && strings.TrimSpace(dispatcher.imageBundleModelsRoot) != "" {
		implemented[command.OpImageBundleInstall] = true
	}
	if dispatcher.onlineProviderModelsRoot != "" {
		implemented[command.OpSemanticProviderList] = true
	}
	if dispatcher.onlineProviderInstaller != nil && dispatcher.onlineProviderModelsRoot != "" {
		implemented[command.OpSemanticProviderInstall] = true
	}
	// description.generate is implemented only when a describe provider was
	// admitted at startup; otherwise the operation stays unimplemented and
	// capability.list reports it as unavailable.
	if dispatcher.describeProvider != nil {
		implemented[command.OpDescriptionGenerate] = true
	}
	if dispatcher.store != nil {
		// Egress grant operations are durable catalog facts; they need no
		// provider binding beyond the configured models root for install
		// verification, which grant.create checks itself.
		implemented[command.OpEgressGrantCreate] = true
		implemented[command.OpEgressGrantList] = true
		implemented[command.OpEgressGrantRevoke] = true
	}
	// The staged-file cleanup is daemon-scratch work over the derived inbox;
	// it needs no catalog or provider binding and is implemented whenever the
	// daemon resolved an inbox root.
	if dispatcher.inboxRoot != "" {
		implemented[command.OpSourceStagingClean] = true
	}
	if dispatcher.exact != nil {
		implemented[command.OpPlanIngest] = true
		implemented[command.OpPlanRestore] = true
		implemented[command.OpSnapshotList] = true
		implemented[command.OpSnapshotDiff] = true
		implemented[command.OpSnapshotVerify] = true
		implemented[command.OpRecoveryExport] = true
		implemented[command.OpRecoveryAnchorExport] = true
		implemented[command.OpRecoveryImport] = true
		implemented[command.OpRecoveryTokenExport] = true
		implemented[command.OpExportPlan] = true
		implemented[command.OpExportApply] = true
		implemented[command.OpExportVerify] = true
		implemented[command.OpExportList] = true
		implemented[command.OpViewSave] = true
		implemented[command.OpViewGet] = true
		implemented[command.OpViewEvaluate] = true
		implemented[command.OpViewList] = true
		implemented[command.OpAnnotationList] = true
		implemented[command.OpAnnotationUpsert] = true
		implemented[command.OpAnnotationDelete] = true
		implemented[command.OpAnnotationExport] = true
		implemented[command.OpAnnotationImport] = true
		implemented[command.OpAnnotationTagPlan] = true
		implemented[command.OpAnnotationTagApply] = true
		implemented[command.OpSearchQuery] = true
		implemented[command.OpContentOpen] = true
		implemented[command.OpContentRead] = true
		implemented[command.OpContentClose] = true
		// similarity.scan/groups are wired only with the exact lane: the scan
		// reads admitted bytes through the repository image content source and
		// stores hash artifacts; see similarity_ops.go.
		implemented[command.OpSimilarityScan], implemented[command.OpSimilarityGroups] = true, true
		if dispatcher.search == nil && dispatcher.exact.Repo != nil {
			dir := dispatcher.vectorPath
			if dir == "" {
				dir = filepath.Join(dispatcher.exact.Repo.Root(), "indexes")
			}
			binding := dispatcher.indexBinding
			semantic := dispatcher.semanticBinding
			if strings.TrimSpace(binding.ConfigDigest) == "" {
				binding.ConfigDigest = dispatcher.configDigest
			}
			if binding.SemanticManifest == (search.EmbeddingGenerationManifest{}) && semantic.manifest != (search.EmbeddingGenerationManifest{}) {
				binding.SemanticManifest = semantic.manifest
				binding.SemanticProfileDigest = semantic.manifest.CanonicalDigest()
				binding.SemanticSpace = semantic.manifest.SemanticSpace
			}
			dispatcher.search = &search.Indexer{
				Store:                   store,
				Engine:                  &search.Engine{Dir: dir},
				EnableFixtureDimensions: dispatcher.fixtureDimensions,
				ConfigDigest:            binding.ConfigDigest,
				LexicalProfileDigest:    binding.LexicalProfileDigest,
				SemanticProfileDigest:   binding.SemanticProfileDigest,
				MultimodalProfileDigest: binding.MultimodalProfileDigest,
				AcousticProfileDigest:   binding.AcousticProfileDigest,
				GraphProfileDigest:      binding.GraphProfileDigest,
				SemanticSpace:           binding.SemanticSpace,
				MultimodalSemanticSpace: binding.MultimodalSemanticSpace,
				SemanticManifest:        binding.SemanticManifest,
				MultimodalManifest:      binding.MultimodalManifest,
				SemanticProvider:        dispatcher.semanticBinding.provider,
				SemanticZvec:            dispatcher.semanticBinding.zvec,
				SemanticLibraryPath:     dispatcher.semanticBinding.libraryPath,
				SemanticLibraryDigest:   dispatcher.semanticBinding.libraryDigest,
				ImageProvider:           dispatcher.imageBinding.provider,
				ImageZvec:               dispatcher.imageBinding.zvec,
				ImageSource:             dispatcher.imageBinding.source,
				ImageLibraryPath:        dispatcher.imageBinding.libraryPath,
				ImageLibraryDigest:      dispatcher.imageBinding.libraryDigest,
			}
			if dispatcher.imageBinding.manifest != (search.EmbeddingGenerationManifest{}) {
				dispatcher.search.MultimodalManifest = dispatcher.imageBinding.manifest
				dispatcher.search.MultimodalProfileDigest = dispatcher.imageBinding.manifest.CanonicalDigest()
				dispatcher.search.MultimodalSemanticSpace = dispatcher.imageBinding.manifest.SemanticSpace
			}
		}
		if dispatcher.search != nil && dispatcher.fixtureDimensions {
			dispatcher.search.EnableFixtureDimensions = true
		}
		if dispatcher.exact.Indexer == nil {
			dispatcher.exact.Indexer = dispatcher.search
		}
		if dispatcher.search != nil {
			implemented[command.OpSearchRebuild] = true
		}
		if dispatcher.exact.Processor == nil && dispatcher.exact.Repo != nil {
			// The bundled byte-deterministic pack is always enabled. The
			// optional OCR capability is registered only when a persisted
			// models root resolved an OCR bundle location, so a host without
			// that profile keeps the existing CAPABILITY_NOT_CONFIGURED
			// outcome instead of inventing one.
			processors := processor.DefaultProcessors()
			if strings.TrimSpace(dispatcher.ocrBundleRoot) != "" {
				dispatcher.ocrProcessor = processor.NewOCRImageText(dispatcher.ocrBundleRoot)
				processors = append(processors, dispatcher.ocrProcessor)
			}
			dispatcher.exact.Processor = processor.NewHost(store, dispatcher.exact.Repo, processor.Options{
				StagingDir: filepath.Join(dispatcher.exact.Repo.Root(), "staging"),
				Processors: processors,
			})
		}
		if dispatcher.sessions == nil && dispatcher.exact.Repo != nil {
			dispatcher.sessions = newContentSessions(dispatcher.exact.Repo)
		}
		if dispatcher.access == nil && dispatcher.exact.Repo != nil {
			dispatcher.access = &access.Service{Store: store, Repo: dispatcher.exact.Repo}
		}
		implemented[command.OpAudioList] = true
		implemented[command.OpBooksList] = true
	}
	if dispatcher.operatorConfig != nil {
		implemented[command.OpConfigGet] = true
		implemented[command.OpConfigUpdate] = true
	}
	var unimplemented []string
	for _, operation := range command.KnownOperations() {
		if !implemented[operation] {
			unimplemented = append(unimplemented, operation)
		}
	}
	sort.Strings(unimplemented)
	dispatcher.unimplemented = unimplemented
	return dispatcher
}

// Handle executes one envelope and always returns a command.Result. Malformed
// envelopes and unknown operations fail explicitly; no status is ever inferred
// from an absent implementation.
func (d *Dispatcher) Handle(ctx context.Context, raw command.Envelope) command.Result {
	started := d.now().UTC()
	env, err := command.NormalizeEnvelope(raw)
	if err != nil {
		return failedRawResult(raw, started, newReason(ReasonCodeInvalidRequest, err.Error()))
	}
	if !d.implemented[env.Operation] {
		if command.IsKnown(env.Operation) {
			return unimplementedResult(env, started)
		}
		return unknownOperationResult(env, started)
	}
	switch env.Operation {
	case command.OpStatusGet:
		return d.handleStatusGet(ctx, env, started)
	case command.OpDoctorCheck:
		return d.handleDoctorCheck(ctx, env, started)
	case command.OpCapabilityList:
		return d.handleCapabilityList(env, started)
	case command.OpConfigGet:
		return d.handleConfigGet(env, started)
	case command.OpConfigUpdate:
		return d.handleConfigUpdate(env, started)
	case command.OpNamespaceList:
		return d.handleNamespaceList(ctx, env, started)
	case command.OpSourceList:
		return d.handleSourceList(ctx, env, started)
	case command.OpSourceStagingClean:
		return d.handleSourceStagingClean(ctx, env, started)
	case command.OpContentList:
		return d.handleContentList(ctx, env, started)
	case command.OpNamespaceResolve:
		return d.handleNamespaceResolve(ctx, env, started)
	case command.OpNamespaceStat:
		return d.handleNamespaceStat(ctx, env, started)
	case command.OpNamespaceReadlink:
		return d.handleNamespaceReadlink(ctx, env, started)
	case command.OpRepresentationList:
		return d.handleRepresentationList(ctx, env, started)
	case command.OpPlanIngest:
		return d.handlePlanIngest(ctx, env, started)
	case command.OpPlanGet:
		return d.handlePlanGet(ctx, env, started)
	case command.OpPlanApply:
		return d.handlePlanApply(ctx, env, started)
	case command.OpPlanRevise:
		return d.handlePlanRevise(ctx, env, started)
	case command.OpPlanAbandon:
		return d.handlePlanAbandon(ctx, env, started)
	case command.OpJobEvents:
		return d.handleJobEvents(ctx, env, started)
	case command.OpJobCancel:
		return d.handleJobCancel(ctx, env, started)
	case command.OpJobList:
		return d.handleJobList(ctx, env, started)
	case command.OpDescriptionList:
		return d.handleDescriptionList(ctx, env, started)
	case command.OpDescriptionGet:
		return d.handleDescriptionGet(ctx, env, started)
	case command.OpDescriptionCreate:
		return d.handleDescriptionCreate(ctx, env, started)
	case command.OpDescriptionGenerate:
		return d.handleDescriptionGenerate(ctx, env, started)
	case command.OpPlanRestore:
		return d.handlePlanRestore(ctx, env, started)
	case command.OpSnapshotList:
		return d.handleSnapshotList(ctx, env, started)
	case command.OpSnapshotDiff:
		return d.handleSnapshotDiff(ctx, env, started)
	case command.OpSnapshotVerify:
		return d.handleSnapshotVerify(ctx, env, started)
	case command.OpRecoveryExport:
		return d.handleRecoveryExport(ctx, env, started)
	case command.OpRecoveryAnchorExport:
		return d.handleRecoveryAnchorExport(ctx, env, started)
	case command.OpRecoveryImport:
		return d.handleRecoveryImport(ctx, env, started)
	case command.OpRecoveryTokenExport:
		return d.handleRecoveryTokenExport(ctx, env, started)
	case command.OpViewSave:
		return d.handleViewSave(ctx, env, started)
	case command.OpViewGet:
		return d.handleViewGet(ctx, env, started)
	case command.OpViewEvaluate:
		return d.handleViewEvaluate(ctx, env, started)
	case command.OpViewList:
		return d.handleViewList(ctx, env, started)
	case command.OpExportList:
		return d.handleExportList(ctx, env, started)
	case command.OpExportPlan:
		return d.handleExportPlan(ctx, env, started)
	case command.OpExportApply:
		return d.handleExportApply(ctx, env, started)
	case command.OpExportVerify:
		return d.handleExportVerify(ctx, env, started)
	case command.OpAnnotationList:
		return d.handleAnnotationList(ctx, env, started)
	case command.OpAnnotationUpsert:
		return d.handleAnnotationUpsert(ctx, env, started)
	case command.OpAnnotationDelete:
		return d.handleAnnotationDelete(ctx, env, started)
	case command.OpAnnotationExport:
		return d.handleAnnotationExport(ctx, env, started)
	case command.OpAnnotationImport:
		return d.handleAnnotationImport(ctx, env, started)
	case command.OpAnnotationTagPlan:
		return d.handleAnnotationTagPlan(ctx, env, started)
	case command.OpAnnotationTagApply:
		return d.handleAnnotationTagApply(ctx, env, started)
	case command.OpSearchQuery:
		return d.handleSearchQuery(ctx, env, started)
	case command.OpSearchRebuild:
		return d.handleSearchRebuild(ctx, env, started)
	case command.OpImageBundleInstall:
		return d.handleImageBundleInstall(ctx, env, started)
	case command.OpSemanticBundleInstall:
		return d.handleSemanticBundleInstall(ctx, env, started)
	case command.OpSemanticProviderInstall:
		return d.handleSemanticProviderInstall(ctx, env, started)
	case command.OpSemanticProviderList:
		return d.handleSemanticProviderList(ctx, env, started)
	case command.OpEgressGrantCreate:
		return d.handleEgressGrantCreate(ctx, env, started)
	case command.OpEgressGrantList:
		return d.handleEgressGrantList(ctx, env, started)
	case command.OpEgressGrantRevoke:
		return d.handleEgressGrantRevoke(ctx, env, started)
	case command.OpContentOpen:
		return d.handleContentOpen(ctx, env, started)
	case command.OpContentRead:
		return d.handleContentRead(ctx, env, started)
	case command.OpContentClose:
		return d.handleContentClose(ctx, env, started)
	case command.OpAudioList:
		return d.handleAudioList(ctx, env, started)
	case command.OpBooksList:
		return d.handleBooksList(ctx, env, started)
	case command.OpSimilarityScan, command.OpSimilarityGroups:
		return d.handleSimilarity(ctx, env, started)
	case command.OpSubjectFactsList:
		return d.handleSubjectFactsList(ctx, env, started)
	default:
		if command.IsKnown(env.Operation) {
			return unimplementedResult(env, started)
		}
		return unknownOperationResult(env, started)
	}
}

// UnimplementedOperations lists every known operation this build does not
// implement, in deterministic order. status.get reports it verbatim.
func (d *Dispatcher) UnimplementedOperations() []string {
	return append([]string(nil), d.unimplemented...)
}

func (d *Dispatcher) handleStatusGet(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	catalogOK := true
	if err := d.store.Ping(ctx); err != nil {
		catalogOK = false
	}
	catalog := command.CatalogStatus{
		Path: d.catalogPath,
		OK:   catalogOK,
	}
	// The schema ledger is read unconditionally: an unreachable catalog
	// reports UNKNOWN with the read error instead of an omitted fact that
	// could be mistaken for a healthy schema.
	schema := d.store.SchemaStatus(ctx)
	catalog.SchemaVersion = schema.Version
	catalog.SchemaMigration = schema.Name
	catalog.SchemaState = schema.State
	catalog.SchemaReason = schema.Reason
	catalog.SchemaBinaryVersion = schema.BinaryVersion
	data := command.StatusData{
		Controller:   "cairnd",
		ConfigDigest: d.configDigest,
		Catalog:      catalog,
		Identify: command.IdentifyStatus{
			ID:          IdentifyBuiltinID,
			RulesDigest: identify.RulesDigest(),
		},
		Listen:        d.socketPath,
		Unimplemented: d.unimplemented,
	}
	if pubs, err := d.store.ListPublications(ctx); err == nil {
		data.Publications = len(pubs)
	}
	if count, err := d.store.CountPlans(ctx); err == nil {
		data.Plans = count
	}
	if plans, err := d.store.ListRecentPlans(ctx, 8); err == nil {
		recent := make([]command.PlanSummary, 0, len(plans))
		for _, plan := range plans {
			recent = append(recent, command.PlanSummary{
				PlanID:      plan.ID,
				WorkspaceID: plan.WorkspaceID,
				Kind:        plan.Kind,
				State:       string(plan.State),
				PlanDigest:  plan.PlanDigest,
				CreatedAt:   plan.CreatedAt.UTC().Format(time.RFC3339),
			})
		}
		data.RecentPlans = recent
	}
	if count, err := d.store.CountJobs(ctx); err == nil {
		data.Jobs = count
	}
	if jobs, err := d.store.ListRecentJobs(ctx, 8); err == nil {
		recent := make([]command.JobSummary, 0, len(jobs))
		for _, job := range jobs {
			recent = append(recent, projectJobSummary(job))
		}
		data.RecentJobs = recent
	}
	// Index states are read-only projections of rebuildable generations. A
	// workspace without a published generation stays NOT_BUILT or UNAVAILABLE;
	// it is never folded into a catalog-wide healthy claim.
	if workspaces, err := d.store.ListWorkspaces(ctx); err == nil {
		index := make([]command.IndexStatusData, 0, len(workspaces))
		for _, workspace := range workspaces {
			states := d.indexDimensionStates(ctx, workspace.ID)
			index = append(index, command.IndexStatusData{
				WorkspaceID:    workspace.ID,
				Lexical:        states.lexicalState,
				Semantic:       states.semanticState,
				SemanticReason: states.semanticReason,
			})
		}
		if len(index) > 0 {
			data.Index = index
		}
	}
	if d.sessions != nil {
		data.ReapedHandles = d.sessions.sweep(time.Now())
		data.OpenHandles = d.sessions.len()
	}
	if d.exact != nil && d.exact.Repo != nil {
		profile := repository.DescribeProfile(d.exact.Repo)
		repo := &command.RepositoryStatus{
			Path: d.exact.Repo.Root(), RepositoryProfile: profile.Repository,
			CompressionProfile: profile.Compression, OK: true,
			CapacityState: repository.CapacityUnknown,
		}
		if reporter, ok := d.exact.Repo.(repository.CapabilityReporter); ok {
			if health, healthErr := reporter.DescribeHealthAndCapacity(ctx); healthErr == nil {
				repo.CapacityState = health.CapacityState
				repo.CapacityTotal = health.CapacityTotal
				repo.CapacityFree = health.CapacityFree
				repo.CapacityUsed = health.CapacityUsed
				repo.CapacityMeasuredAt = health.CapacityMeasuredAt
				repo.CapacityReason = health.CapacityReason
			} else {
				// Capacity is advisory. A probe error must remain visible while
				// leaving exact save/read availability unchanged.
				repo.CapacityState = repository.CapacityUnknown
				repo.CapacityReason = healthErr.Error()
			}
		}
		// Writability is a live zero-byte probe over the repository root. It
		// is deliberately separate from repository.OK: an exact read or
		// restore can still succeed against a read-only repository.
		writability := probeRepositoryWritability(d.exact.Repo.Root(), d.now())
		repo.Writable = writability.State
		repo.WritableReason = writability.Reason
		repo.WritableCheckedAt = writability.CheckedAt.Format(time.RFC3339)
		if manifests, err := d.exact.ListSnapshots(ctx); err != nil {
			repo.OK = false
		} else {
			repo.Snapshots = len(manifests)
		}
		data.Repository = repo
	}
	return succeeded(env, started, data)
}

func (d *Dispatcher) handleCapabilityList(env command.Envelope, started time.Time) command.Result {
	capabilities := make([]command.Capability, 0, len(command.KnownOperations())+2)
	for _, operation := range command.KnownOperations() {
		state := command.CapabilityUnavailable
		notes := "not implemented by this cairnd build"
		if d.implemented[operation] {
			state = command.CapabilityAvailable
			notes = "implemented by cairnd"
		}
		capabilities = append(capabilities, command.Capability{
			Kind:  "operation",
			ID:    operation,
			State: state,
			Notes: notes,
		})
	}
	capabilities = append(capabilities,
		command.Capability{
			Kind:    "transport",
			ID:      "command-envelope-json-over-unix-socket",
			State:   command.CapabilityAvailable,
			Version: "1",
			Notes:   "client/command Envelope JSON in 4-byte big-endian length-prefixed frames",
		},
		command.Capability{
			Kind:    "identify",
			ID:      IdentifyBuiltinID,
			State:   command.CapabilityAvailable,
			Version: identify.RulesDigest(),
			Notes:   "host-owned suffix and magic-byte detector",
		},
	)
	d.semanticBundleMu.RLock()
	semanticBundle := d.semanticBundle
	d.semanticBundleMu.RUnlock()
	if strings.TrimSpace(semanticBundle.Kind) != "" {
		// A reader-only dispatcher carries no semantic bundle: reporting a
		// zero-valued row would invent a capability nobody installed.
		capabilities = append(capabilities, semanticBundle)
	}
	for _, dimension := range search.DeclaredDimensions(search.IndexerReadiness(d.search)) {
		if dimension.ID == search.DimensionSemantic && dimension.State == command.CapabilityUnavailable && d.search != nil {
			if failure := strings.TrimSpace(d.search.SemanticFailure()); failure != "" {
				dimension.Notes += "; latest rebuild failed: " + failure
			}
		}
		capabilities = append(capabilities, command.Capability{
			Kind:    search.CapabilityKindDimension,
			ID:      dimension.ID,
			State:   dimension.State,
			Version: dimension.Version,
			Source:  dimension.Provider,
			Notes:   dimension.Notes,
		})
	}
	brokerState := command.CapabilityUnavailable
	brokerNotes := "host-owned fusion broker; unavailable until the exact lane wires a search indexer"
	if d.search != nil {
		brokerState = command.CapabilityAvailable
		brokerNotes = "fuses separately generation-pinned QueryProvider results; does not invent a hybrid score"
	}
	capabilities = append(capabilities, command.Capability{
		Kind:    search.CapabilityKindBroker,
		ID:      search.ProviderBrokerFuse,
		State:   brokerState,
		Version: "1",
		Notes:   brokerNotes,
	})
	capabilities = append(capabilities, d.ocrCapability())
	capabilities = append(capabilities, d.readerClosureCapabilities()...)
	return succeeded(env, started, command.CapabilityListData{Capabilities: capabilities})
}

// capabilityKindReaderClosure is the capability kind for a reader-closure
// dependency: the codec, canonicalization, signature, or key dependency a
// reader must satisfy before it can decode one of this repository's records.
// It is separate from index-dimension and processor so "this build can still
// read that encoding" is never confused with a processing capability.
const capabilityKindReaderClosure = "reader-closure"

// readerClosureCapabilities projects the reader closure of the wired
// repository. It emits rows only when a repository is wired, so the operation
// reports a declaration only for a codec this process actually opened, and an
// unreadable dependency stays UNAVAILABLE with its typed refusal reason.
func (d *Dispatcher) readerClosureCapabilities() []command.Capability {
	if d.exact == nil || d.exact.Repo == nil {
		return nil
	}
	closure, err := repository.ReaderClosureForRepository(d.exact.Repo)
	if err != nil {
		return []command.Capability{{
			Kind: capabilityKindReaderClosure, ID: "repository-reader-closure",
			State: command.CapabilityUnavailable, Notes: err.Error(),
		}}
	}
	readable := "codec " + closure.Codec + " reader closure is satisfiable by this build"
	if !closure.Readable {
		readable = "codec " + closure.Codec + " reader closure is incomplete: " + closure.Reason
	}
	rows := make([]command.Capability, 0, len(closure.Declarations)+1)
	for _, declaration := range closure.Declarations {
		resolution, resolveErr := repository.AdmitReaderDependency(declaration.Dependency)
		version, digestErr := declaration.ReaderClosureDigest()
		if digestErr != nil {
			version = ""
		}
		notes := declaration.Role + "; retention " + declaration.Retention + "; " + declaration.DecoderSupportWindow
		if declaration.Rebuild != "" {
			notes += "; rebuild: " + declaration.Rebuild
		}
		notes += "; verify: " + declaration.Verify
		row := command.Capability{
			Kind: capabilityKindReaderClosure, ID: declaration.Dependency,
			Version: version, Notes: notes, State: command.CapabilityUnavailable,
		}
		if resolveErr == nil {
			row.State = command.CapabilityAvailable
			row.Source = resolution.Stage + ":" + resolution.DecoderID
			rows = append(rows, row)
			continue
		}
		var refusal *repository.ReaderDecoderRefusal
		if errors.As(resolveErr, &refusal) {
			row.Notes = refusal.Reason + "; " + refusal.Detail + "; " + refusal.CallerAction + "; " + notes
		} else {
			row.Notes = resolveErr.Error() + "; " + notes
		}
		rows = append(rows, row)
	}
	return append([]command.Capability{{
		Kind: capabilityKindReaderClosure, ID: "repository-reader-closure",
		State: readerClosureState(closure), Notes: readable,
	}}, rows...)
}

func readerClosureState(closure repository.ReaderCodecClosure) string {
	if closure.Readable {
		return command.CapabilityAvailable
	}
	return command.CapabilityUnavailable
}

// capabilityKindProcessor is the capability kind for an optional learned
// processor. It is deliberately separate from index-dimension and model-bundle
// so an installed OCR profile is never read as an index-readiness claim.
const capabilityKindProcessor = "processor"

// ocrCapability reports the honest OCR capability state. It re-inspects the
// operator-installed bundle on every call: an uninstalled profile is NOT_BUILT
// with the expected path, a present but unusable profile is UNAVAILABLE with
// its reason, and only a verified bundle is READY. A missing bundle never
// degrades exact preservation, and this state never claims recognition
// coverage beyond the languages the installed models declare.
func (d *Dispatcher) ocrCapability() command.Capability {
	root := strings.TrimSpace(d.ocrBundleRoot)
	state := processor.InspectOCRBundle(root)
	notes := state.Reason
	if root != "" {
		notes += "; expected bundle root: " + root
	}
	capability := command.Capability{
		Kind:  capabilityKindProcessor,
		ID:    processor.CapabilityOCRImageText,
		State: state.State,
		Notes: notes,
	}
	if state.EngineID != "" {
		capability.Source = state.EngineID
	}
	if state.ProfileDigest != "" {
		capability.Version = state.ProfileDigest
	}
	if len(state.Languages) > 0 {
		capability.Notes = notes + "; declared languages: " + strings.Join(state.Languages, ",")
		if state.License != "" {
			capability.Notes += "; license: " + state.License
		}
	}
	return capability
}

// CloseOCRCapability releases the lazily created native OCR session. It is
// called by a host that owns the dispatcher for a bounded lifetime.
func (d *Dispatcher) CloseOCRCapability() error {
	if d == nil || d.ocrProcessor == nil {
		return nil
	}
	return d.ocrProcessor.Close()
}

// namespaceListInput is the namespace.list input. Workspace, root, and parent
// references are catalog stable IDs, not filesystem paths.
type namespaceListInput struct {
	WorkspaceID string `json:"workspace_id"`
	RootID      string `json:"root_id"`
	ParentID    string `json:"parent_id,omitempty"`
}

type contentListInput struct {
	WorkspaceID string `json:"workspace_id"`
}

// handleContentList is the flat content-library projection. Directory
// navigation remains the separate namespace.list operation.
func (d *Dispatcher) handleContentList(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input contentListInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if _, err := d.store.GetWorkspace(ctx, input.WorkspaceID); err != nil {
		return namespaceLookupResult(env, started, err)
	}
	// Keep the operation scoped to a workspace with committed content. An
	// empty result for an existing but unpublished workspace must not look like
	// a successful library projection.
	if _, err := d.store.LatestPublication(ctx, input.WorkspaceID); err != nil {
		return namespaceLookupResult(env, started, err)
	}
	entries, err := d.store.ListLatestNamespaceContent(ctx, input.WorkspaceID)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	roots, err := d.store.ListLatestNamespaceRoots(ctx, input.WorkspaceID)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	// RootID remains useful for the single-source case and deliberately becomes
	// empty when a workspace spans multiple source roots. The flat library is
	// content-first; directory traversal uses an explicit namespace root.
	rootID := ""
	for _, entry := range entries {
		if rootID == "" {
			rootID = entry.RootID
		} else if rootID != entry.RootID {
			rootID = ""
			break
		}
	}
	items := make([]command.ContentItemData, 0, len(entries))
	indexStatus, err := d.contentIndexStatuses(ctx, input.WorkspaceID, entries)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	for _, entry := range entries {
		items = append(items, command.ContentItemData{
			SubjectRef:  entry.SubjectRef,
			EntryID:     entry.ID,
			Name:        entry.DisplayName,
			Path:        d.namespaceDisplayPath(ctx, input.WorkspaceID, entry),
			EntryType:   string(entry.EntryType),
			ContentID:   entry.ContentID,
			LogicalSize: entry.LogicalSize,
			// The modification time is the fact the scanner recorded at
			// capture; a row whose metadata does not carry one simply omits
			// the field, never zero-fills it.
			ModifiedAt:  entryModifiedAt(entry),
			IndexStatus: indexStatus[entry.SubjectRef],
		})
	}
	rootChoices := make([]command.ContentRootData, 0, len(roots))
	for _, root := range roots {
		source, err := d.store.GetSource(ctx, input.WorkspaceID, root.SourceID)
		if err != nil {
			return namespaceLookupResult(env, started, err)
		}
		rootChoices = append(rootChoices, command.ContentRootData{
			RootID:     root.ID,
			Name:       root.Name,
			SourcePath: source.Locator,
		})
	}
	return succeeded(env, started, command.ContentListData{
		WorkspaceID: input.WorkspaceID,
		RootID:      rootID,
		Roots:       rootChoices,
		Items:       items,
	})
}

// entryModifiedAt reads the modification time the scanner recorded in the
// entry's captured metadata. It is a captured fact, not a live stat: a row
// with no recorded time carries no field.
func entryModifiedAt(entry sqlite.NamespaceEntry) string {
	var snapshot struct {
		ModTime string `json:"mod_time"`
	}
	if len(entry.Metadata) == 0 || json.Unmarshal(entry.Metadata, &snapshot) != nil {
		return ""
	}
	parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(snapshot.ModTime))
	if err != nil || parsed.IsZero() || parsed.Unix() <= 0 {
		return ""
	}
	return parsed.UTC().Format(time.RFC3339)
}

// indexDimensionStates computes the lexical and semantic discovery state for
// one workspace. Per-item index status and the status.get index summary share
// this one implementation so they cannot drift apart. A missing generation
// stays NOT_BUILT and a broken or failed provider stays UNAVAILABLE with its
// recorded reason; neither is ever folded into READY.
type indexDimensionStates struct {
	lexicalBySubject  map[string]struct{}
	lexicalState      string
	semanticBySubject map[string]struct{}
	semanticState     string
	semanticReason    string
}

func (d *Dispatcher) indexDimensionStates(ctx context.Context, workspaceID string) indexDimensionStates {
	states := indexDimensionStates{
		lexicalBySubject:  map[string]struct{}{},
		lexicalState:      "NOT_BUILT",
		semanticBySubject: map[string]struct{}{},
		semanticState:     "UNAVAILABLE",
	}
	if d.search != nil && d.search.LexicalUnavailableForWorkspace(workspaceID) {
		states.lexicalState = "UNAVAILABLE"
	} else if generation, generationErr := d.store.LatestIndexGeneration(ctx, workspaceID, search.DimensionLexical); generationErr == nil {
		if covered, err := search.LexicalSubjectCoverage(ctx, generation); err == nil {
			states.lexicalBySubject, states.lexicalState = covered, "READY"
		} else {
			states.lexicalState = "UNAVAILABLE"
		}
	} else if !errors.Is(generationErr, sqlite.ErrNotFound) {
		states.lexicalState = "UNAVAILABLE"
	}
	if d.search != nil {
		if covered, err := d.search.SemanticSubjectCoverage(ctx, workspaceID); err == nil {
			states.semanticBySubject, states.semanticState = covered, "READY"
		} else if errors.Is(err, sqlite.ErrNotFound) {
			// The provider/backend is present, but no generation has been
			// published yet. Keep this distinct from a broken or unavailable
			// provider so the operator can tell "not analysed" from "failed".
			if failure := strings.TrimSpace(d.search.SemanticFailure()); failure != "" {
				states.semanticState = "UNAVAILABLE"
				states.semanticReason = failure
			} else {
				states.semanticState = "NOT_BUILT"
			}
		} else {
			states.semanticState = "UNAVAILABLE"
			states.semanticReason = err.Error()
		}
	}
	return states
}

// contentIndexStatuses reads only rebuildable projections. It never creates
// or updates index state, and a missing projection is reported explicitly.
func (d *Dispatcher) contentIndexStatuses(ctx context.Context, workspaceID string, entries []sqlite.NamespaceEntry) (map[string]*command.ContentIndexStatus, error) {
	statuses := make(map[string]*command.ContentIndexStatus, len(entries))
	states := d.indexDimensionStates(ctx, workspaceID)
	lexicalBySubject, lexicalState := states.lexicalBySubject, states.lexicalState
	semanticBySubject, semanticState := states.semanticBySubject, states.semanticState
	annotations, err := d.store.ListAnnotations(ctx, workspaceID, "", false)
	if err != nil {
		return nil, err
	}
	tagged := make(map[string]bool)
	for _, annotation := range annotations {
		if annotation.Kind == sqlite.AnnotationTag {
			tagged[annotation.SubjectRef] = true
		}
	}
	for _, entry := range entries {
		tags := "UNMARKED"
		if tagged[entry.SubjectRef] {
			tags = "MARKED"
		}
		lexical := lexicalState
		if _, ok := lexicalBySubject[entry.SubjectRef]; !ok && lexicalState == "READY" {
			lexical = "NOT_BUILT"
		}
		semantic := semanticState
		if _, ok := semanticBySubject[entry.SubjectRef]; !ok && semanticState == "READY" {
			semantic = "NOT_BUILT"
		}
		statuses[entry.SubjectRef] = &command.ContentIndexStatus{Lexical: lexical, Semantic: semantic, Tags: tags}
	}
	return statuses, nil
}

func (d *Dispatcher) handleNamespaceList(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input namespaceListInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("root_id", input.RootID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if input.ParentID != "" {
		if err := requireStableID("parent_id", input.ParentID); err != nil {
			return invalidInputResult(env, started, err)
		}
	}
	entries, err := d.store.ListNamespaceChildren(ctx, input.WorkspaceID, input.RootID, input.ParentID)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	indexStatus, err := d.contentIndexStatuses(ctx, input.WorkspaceID, entries)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	projected := make([]command.NamespaceEntryData, 0, len(entries))
	for _, entry := range entries {
		item := projectNamespaceEntry(entry)
		item.IndexStatus = indexStatus[entry.SubjectRef]
		projected = append(projected, item)
	}
	return succeeded(env, started, command.NamespaceListData{
		RootID:   input.RootID,
		ParentID: input.ParentID,
		Entries:  projected,
	})
}

type namespaceResolveInput struct {
	WorkspaceID string `json:"workspace_id"`
	RootID      string `json:"root_id,omitempty"`
	SnapshotRef string `json:"snapshot_ref,omitempty"`
	Path        string `json:"path"`
}

func (d *Dispatcher) handleNamespaceResolve(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input namespaceResolveInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	parts, err := splitDisplayPath(input.Path)
	if err != nil {
		return invalidInputResult(env, started, err)
	}
	rootID := strings.TrimSpace(input.RootID)
	if rootID == "" {
		if strings.TrimSpace(input.SnapshotRef) == "" {
			return invalidInputResult(env, started, errString("root_id or snapshot_ref is required"))
		}
		publication, pubErr := d.store.GetPublicationBySnapshotRef(ctx, input.WorkspaceID, input.SnapshotRef)
		if pubErr != nil {
			if containsNotFound(pubErr) {
				return notFoundResult(env, started, "publication not found")
			}
			return catalogErrorResult(env, started, pubErr)
		}
		rootID = publication.NamespaceRootID
	} else if err := requireStableID("root_id", rootID); err != nil {
		return invalidInputResult(env, started, err)
	}
	parentID := ""
	var entry sqlite.NamespaceEntry
	for i, name := range parts {
		found, lookupErr := d.store.LookupNamespaceChild(ctx, input.WorkspaceID, rootID, parentID, nil, name)
		if lookupErr != nil {
			if containsNotFound(lookupErr) {
				return notFoundResult(env, started, "namespace path not found")
			}
			return catalogErrorResult(env, started, lookupErr)
		}
		if found.EntryType == sqlite.EntrySymlink && i < len(parts)-1 {
			return invalidInputResult(env, started, errString("namespace.resolve does not follow symbolic links"))
		}
		entry = found
		parentID = found.ID
	}
	projected := projectNamespaceEntry(entry)
	return succeeded(env, started, command.NamespaceResolveData{
		WorkspaceID: input.WorkspaceID,
		RootID:      rootID,
		Path:        strings.Join(parts, "/"),
		PathRef:     entry.ID,
		Entry:       projected,
	})
}

func splitDisplayPath(path string) ([]string, error) {
	trimmed := strings.Trim(path, "/")
	if strings.TrimSpace(trimmed) == "" {
		return nil, errString("path is required")
	}
	var parts []string
	for _, part := range strings.Split(trimmed, "/") {
		if part == "" || part == "." {
			continue
		}
		if part == ".." {
			return nil, fmt.Errorf("path %q is unsafe", path)
		}
		parts = append(parts, part)
	}
	if len(parts) == 0 {
		return nil, errString("path is required")
	}
	return parts, nil
}

// namespaceEntryInput is the namespace.stat and namespace.readlink input.
type namespaceEntryInput struct {
	WorkspaceID string `json:"workspace_id"`
	EntryID     string `json:"entry_id"`
}

func (d *Dispatcher) handleNamespaceStat(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	entry, reason, ok := d.lookupEntry(ctx, env, started)
	if !ok {
		return reason
	}
	return succeeded(env, started, command.NamespaceStatData{Entry: projectNamespaceEntry(entry)})
}

func (d *Dispatcher) handleNamespaceReadlink(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	entry, reason, ok := d.lookupEntry(ctx, env, started)
	if !ok {
		return reason
	}
	if entry.EntryType != sqlite.EntrySymlink {
		return failed(env, started, newReason(
			ReasonCodeInvalidInput,
			fmt.Sprintf("entry %s is not a symlink", entry.ID),
		))
	}
	return succeeded(env, started, command.NamespaceReadlinkData{
		EntryID:       entry.ID,
		TargetDisplay: entry.SymlinkTargetDisplay,
		TargetRaw:     entry.SymlinkTargetRaw,
	})
}

// lookupEntry resolves one namespace entry and maps store errors to results.
func (d *Dispatcher) lookupEntry(ctx context.Context, env command.Envelope, started time.Time) (sqlite.NamespaceEntry, command.Result, bool) {
	var input namespaceEntryInput
	if err := decodeInput(env.Input, &input); err != nil {
		return sqlite.NamespaceEntry{}, invalidInputResult(env, started, err), false
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return sqlite.NamespaceEntry{}, invalidInputResult(env, started, err), false
	}
	if err := requireStableID("entry_id", input.EntryID); err != nil {
		return sqlite.NamespaceEntry{}, invalidInputResult(env, started, err), false
	}
	entry, err := d.store.GetNamespaceEntry(ctx, input.WorkspaceID, input.EntryID)
	if err != nil {
		return sqlite.NamespaceEntry{}, namespaceLookupResult(env, started, err), false
	}
	return entry, command.Result{}, true
}

func namespaceLookupResult(env command.Envelope, started time.Time, err error) command.Result {
	if containsNotFound(err) {
		return notFoundResult(env, started, "namespace entry not found")
	}
	return catalogErrorResult(env, started, err)
}

func decodeInput(raw json.RawMessage, into any) error {
	if len(raw) == 0 {
		return fmt.Errorf("input must be a JSON object")
	}
	if err := json.Unmarshal(raw, into); err != nil {
		return fmt.Errorf("invalid input: %w", err)
	}
	return nil
}

func requireStableID(name, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", name)
	}
	if !validStableID(value) {
		return fmt.Errorf("%s must be a catalog stable id (prefix_32-hex)", name)
	}
	return nil
}

func invalidInputResult(env command.Envelope, started time.Time, err error) command.Result {
	return failed(env, started, newReason(ReasonCodeInvalidInput, err.Error()))
}

func containsNotFound(err error) bool {
	return errors.Is(err, sqlite.ErrNotFound) || (err != nil && strings.Contains(err.Error(), "not found"))
}

// resolveSubject accepts both the current stable subject reference and the
// pre-stable namespace-entry handle. The latter is retained only as a
// compatibility alias; all callers should use the returned SubjectRef when
// addressing durable annotations, descriptions, and search results.
func (d *Dispatcher) resolveSubject(ctx context.Context, workspaceID, ref string) (sqlite.NamespaceEntry, error) {
	entry, err := d.store.LookupLatestNamespaceEntryBySubjectRef(ctx, workspaceID, ref)
	if err == nil || !containsNotFound(err) {
		return entry, err
	}
	// Fixture/low-level catalogs may contain an unpublished namespace without
	// a committed publication from which continuity can be resolved. Preserve
	// compatibility for those direct rows; published catalogs always take the
	// stable-subject latest path above.
	return d.store.GetNamespaceEntry(ctx, workspaceID, ref)
}

func projectNamespaceEntry(entry sqlite.NamespaceEntry) command.NamespaceEntryData {
	return command.NamespaceEntryData{
		ID:                   entry.ID,
		SubjectRef:           entry.SubjectRef,
		RootID:               entry.RootID,
		ParentID:             entry.ParentID,
		DisplayName:          entry.DisplayName,
		EntryType:            string(entry.EntryType),
		ContentID:            entry.ContentID,
		FileVersionID:        entry.FileVersionID,
		HardlinkGroupID:      entry.HardlinkGroupID,
		LogicalSize:          entry.LogicalSize,
		AllocatedSize:        entry.AllocatedSize,
		SymlinkTargetDisplay: entry.SymlinkTargetDisplay,
	}
}
