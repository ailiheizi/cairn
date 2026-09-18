// Command restoreweaved runs the RestoreWeave control-plane daemon. It
// exposes the client/command envelope protocol over a Unix socket.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/ailiheizi/restoreweave/client/command"
	rwconfig "github.com/ailiheizi/restoreweave/config"
	"github.com/ailiheizi/restoreweave/server/controlplane"
	"github.com/ailiheizi/restoreweave/server/internal/api"
	"github.com/ailiheizi/restoreweave/server/internal/exact"
	"github.com/ailiheizi/restoreweave/server/internal/processor"
	"github.com/ailiheizi/restoreweave/server/internal/processor/sandbox"
	"github.com/ailiheizi/restoreweave/server/internal/repository"
	"github.com/ailiheizi/restoreweave/server/internal/search"
	"github.com/ailiheizi/restoreweave/server/internal/store/sqlite"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("restoreweaved: %v", err)
	}
}

func run() error {
	var (
		socketPath = flag.String("socket", controlplane.DefaultSocketPath(),
			"Unix socket path (overrides RESTOREWEAVE_SOCKET)")
		recoveryReader = flag.Bool("recovery-reader", false,
			"serve a catalog-free read-only recovery reader")
		recoveryReference = flag.String("recovery-reference", "",
			"v2 portable recovery reference for --recovery-reader")
		trustAnchorPath = flag.String("trust-anchor", "",
			"independently retained public trust anchor for --recovery-reader")
		configPath = flag.String("config", "",
			"persisted RestoreWeave config path (overrides RESTOREWEAVE_CONFIG)")
		catalogPath = flag.String("catalog", "",
			"SQLite catalog path (overrides persisted config and RESTOREWEAVE_CATALOG)")
		repositoryPath = flag.String("repository", "",
			"Exact-lane repository path (overrides persisted config and RESTOREWEAVE_REPOSITORY)")
		semanticBundle = flag.String("semantic-bundle", os.Getenv("RESTOREWEAVE_SEMANTIC_BUNDLE"),
			"operator-provided custom semantic bundle root (overrides configured paths.models profile; not the release-pinned default; disables fixed bundle installation)")
		imageBundle = flag.String("image-bundle", os.Getenv("RESTOREWEAVE_IMAGE_BUNDLE"),
			"operator-provided custom image bundle root (overrides configured paths.models profile; not the release-pinned default)")
		apiListen               = flag.String("api-listen", "", "HTTP /api/v1 listen address (overrides api.listen; empty uses config)")
		webRoot                 = flag.String("web-root", "", "explicit absolute pre-built WebUI root served on the loopback API listener")
		apiToken                = flag.String("api-token", os.Getenv("RESTOREWEAVE_API_TOKEN"), "Bearer token for HTTP /api/v1")
		onnxWorkerProcessBundle = flag.String("onnx-worker-process", "",
			"private host-supervisor ONNX worker bundle root")
	)
	flag.Parse()
	semanticBundleOverride := strings.TrimSpace(*semanticBundle) != ""

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if strings.TrimSpace(*onnxWorkerProcessBundle) != "" {
		return processor.RunONNXWorkerProcess(ctx, *onnxWorkerProcessBundle)
	}
	return runWithOptions(ctx, daemonOptions{
		socketPath:             *socketPath,
		recoveryReader:         *recoveryReader,
		recoveryReference:      *recoveryReference,
		trustAnchorPath:        *trustAnchorPath,
		configPath:             *configPath,
		catalogPath:            *catalogPath,
		repositoryPath:         *repositoryPath,
		semanticBundle:         *semanticBundle,
		imageBundle:            *imageBundle,
		semanticBundleOverride: semanticBundleOverride,
		apiListen:              *apiListen,
		webRoot:                *webRoot,
		apiToken:               *apiToken,
	})
}

type daemonOptions struct {
	socketPath             string
	recoveryReader         bool
	recoveryReference      string
	trustAnchorPath        string
	configPath             string
	catalogPath            string
	repositoryPath         string
	semanticBundle         string
	semanticBundleOverride bool
	imageBundle            string
	apiListen              string
	webRoot                string
	apiToken               string
}

// semanticWorkerBinding is one admitted embedding provider together with the
// vector backend and immutable generation binding it produces.
type semanticWorkerBinding struct {
	provider      search.SemanticEmbeddingProvider
	zvec          search.ZvecGenerationDriver
	libraryPath   string
	libraryDigest string
	manifest      search.EmbeddingGenerationManifest
	release       func() error
}

// configureSemanticBinding admits the pinned local ONNX/BGE worker for
// embedding_mode=local. The local path is unchanged: same profile checks,
// same admission, same worker lease, same probe.
func configureSemanticBinding(ctx context.Context, resolved rwconfig.ResolvedConfig, store *sqlite.Store, bundleRoot string, operatorOverride bool) (controlplane.DispatcherOption, func() error, error) {
	binding, err := startLocalSemanticBinding(ctx, resolved, store, bundleRoot, operatorOverride)
	if err != nil {
		return nil, nil, err
	}
	if binding.provider == nil {
		return nil, nil, nil
	}
	return controlplane.WithSemanticIndexerBinding(binding.provider, binding.zvec, binding.libraryPath, binding.libraryDigest, binding.manifest), binding.release, nil
}

func startLocalSemanticBinding(ctx context.Context, resolved rwconfig.ResolvedConfig, store *sqlite.Store, bundleRoot string, operatorOverride bool) (semanticWorkerBinding, error) {
	if strings.TrimSpace(bundleRoot) == "" {
		return semanticWorkerBinding{}, nil
	}
	if strings.TrimSpace(resolved.Config.Semantic.EmbeddingMode) != "local" {
		return semanticWorkerBinding{}, fmt.Errorf("semantic.embedding_mode %q is not compatible with the admitted local bundle", resolved.Config.Semantic.EmbeddingMode)
	}
	if strings.TrimSpace(resolved.Config.Semantic.LocalProfile) != search.SemanticBundleBGEProfileID {
		return semanticWorkerBinding{}, fmt.Errorf("semantic.local_profile %q is not compatible with the admitted bundle profile %q", resolved.Config.Semantic.LocalProfile, search.SemanticBundleBGEProfileID)
	}
	if strings.TrimSpace(resolved.Config.Semantic.VectorBackend) != "zvec" {
		return semanticWorkerBinding{}, fmt.Errorf("semantic.vector_backend %q is not compatible with the admitted zvec bundle", resolved.Config.Semantic.VectorBackend)
	}
	bundle, err := loadSemanticBundleAdmission(bundleRoot, operatorOverride)
	if err != nil {
		return semanticWorkerBinding{}, err
	}
	manifest, err := bundle.EmbeddingGenerationManifest(resolved.Digest)
	if err != nil {
		return semanticWorkerBinding{}, err
	}
	owner := fmt.Sprintf("restoreweave-semantic-%d", os.Getpid())
	leaseToken := fmt.Sprintf("semantic:%d", time.Now().UnixNano())
	domain := resolved.Config.Recovery.PublicationDomain + ":semantic-worker"
	now := time.Now()
	fencer := exact.NewPublicationFencer(store, time.Now)
	fenceToken, err := fencer.Acquire(ctx, domain, owner, leaseToken, now, now.Add(exact.DefaultPublicationFenceTTL))
	if err != nil {
		return semanticWorkerBinding{}, fmt.Errorf("acquire semantic worker lease: %w", err)
	}
	validateLease := func(checkCtx context.Context) error {
		return renewAndValidateSemanticLease(checkCtx, fencer, domain, owner, leaseToken, fenceToken, time.Now())
	}
	factory, err := processor.NewONNXSemanticEmbeddingProviderFactory(processor.ONNXWorkerSupervisorOptions{
		BundleRoot: bundleRoot, ConfigDigest: resolved.Digest, FenceToken: fenceToken,
		SandboxPolicyDigest: sandbox.PolicyDigest(), FenceValidator: validateLease,
	})
	if err != nil {
		_ = fencer.Release(context.Background(), domain, owner, leaseToken, fenceToken, time.Now())
		return semanticWorkerBinding{}, err
	}
	probeCtx, cancelProbe := context.WithTimeout(ctx, 45*time.Second)
	_, err = factory.Embed(probeCtx, search.SemanticEmbeddingRequest{
		Purpose:      search.SemanticEmbeddingQuery,
		GenerationID: "semantic-readiness-probe",
		Manifest:     manifest,
		Inputs: []search.SemanticTextInput{{
			SegmentID: "query",
			Language:  "zh",
			Text:      "语义搜索就绪检查",
		}},
	})
	cancelProbe()
	if err != nil {
		_ = fencer.Release(context.Background(), domain, owner, leaseToken, fenceToken, time.Now())
		return semanticWorkerBinding{}, fmt.Errorf("probe semantic worker: %w", err)
	}
	leaseCtx, stopLease := context.WithCancel(ctx)
	leaseDone := make(chan struct{})
	go keepSemanticLeaseAlive(leaseCtx, exact.DefaultPublicationFenceTTL/3, func(renewCtx context.Context) error {
		return renewAndValidateSemanticLease(renewCtx, fencer, domain, owner, leaseToken, fenceToken, time.Now())
	}, func(renewErr error) {
		factory.Invalidate(renewErr)
		log.Printf("semantic worker lease renewal: %v", renewErr)
	}, leaseDone)
	release := func() error {
		stopLease()
		<-leaseDone
		factory.Invalidate(errors.New("semantic worker lease released"))
		return fencer.Release(context.Background(), domain, owner, leaseToken, fenceToken, time.Now())
	}
	libraryPath := filepath.Join(bundleRoot, filepath.FromSlash(bundle.Descriptor.Zvec.Path))
	libraryDigest := "sha256:" + bundle.AssetDigests["zvec"]
	return semanticWorkerBinding{
		provider: factory, zvec: search.NewZvecGenerationDriver(libraryPath),
		libraryPath: libraryPath, libraryDigest: libraryDigest, manifest: manifest, release: release,
	}, nil
}

// configureSemanticBindingForMode dispatches on semantic.embedding_mode.
//
//   - local:  the pinned ONNX/BGE worker (unchanged default).
//   - online: the egress-gated HTTP provider. The local model worker is not
//     started; the admitted bundle supplies only the in-process zvec vector
//     backend, which is a local projection and never sees content of its own.
//   - hybrid: both components, each bound to its own immutable space, with
//     the local component serving the daemon's default generation space.
//
// A mode that cannot admit its provider is reported as a degraded semantic
// capability by the caller; it never falls back to another mode, provider, or
// space.
func configureSemanticBindingForMode(ctx context.Context, resolved rwconfig.ResolvedConfig, store *sqlite.Store, modelsRoot, bundleRoot string, operatorOverride bool) (controlplane.DispatcherOption, func() error, error) {
	switch strings.TrimSpace(resolved.Config.Semantic.EmbeddingMode) {
	case "online":
		return configureOnlineSemanticBinding(ctx, resolved, store, modelsRoot, bundleRoot, operatorOverride)
	case "hybrid":
		return configureHybridSemanticBinding(ctx, resolved, store, modelsRoot, bundleRoot, operatorOverride)
	default:
		// The local path is byte-for-byte the existing behavior, including
		// its own compatibility errors.
		return configureSemanticBinding(ctx, resolved, store, bundleRoot, operatorOverride)
	}
}

// configureOnlineSemanticBinding admits the immutable online profile and its
// one HTTP egress path. The vector backend comes from the admitted local
// bundle's zvec asset: the current packaging ships the in-process vector
// backend inside that bundle, and an online-only backend artifact is not
// admitted yet. No local model artifact is used to produce vectors.
func configureOnlineSemanticBinding(ctx context.Context, resolved rwconfig.ResolvedConfig, store *sqlite.Store, modelsRoot, bundleRoot string, operatorOverride bool) (controlplane.DispatcherOption, func() error, error) {
	provider, zvec, libraryPath, libraryDigest, manifest, err := buildOnlineSemanticBinding(ctx, resolved, store, modelsRoot, bundleRoot, operatorOverride)
	if err != nil {
		return nil, nil, err
	}
	return controlplane.WithSemanticIndexerBinding(provider, zvec, libraryPath, libraryDigest, manifest), nil, nil
}

// configureHybridSemanticBinding starts the local default worker and adds the
// online component beside it. The daemon's bound generation space remains the
// local one; the online component's state is reported per component and is
// only used when a request names its space.
func configureHybridSemanticBinding(ctx context.Context, resolved rwconfig.ResolvedConfig, store *sqlite.Store, modelsRoot, bundleRoot string, operatorOverride bool) (controlplane.DispatcherOption, func() error, error) {
	local, err := startLocalSemanticBinding(ctx, resolved, store, bundleRoot, operatorOverride)
	if err != nil {
		return nil, nil, fmt.Errorf("hybrid local component: %w", err)
	}
	if local.provider == nil {
		return nil, nil, errors.New("hybrid embedding requires the admitted local bundle; the local default is not silently dropped")
	}
	online, _, _, _, onlineManifest, err := buildOnlineSemanticBinding(ctx, resolved, store, modelsRoot, bundleRoot, operatorOverride)
	if err != nil {
		if local.release != nil {
			_ = local.release()
		}
		return nil, nil, fmt.Errorf("hybrid online component: %w", err)
	}
	hybrid, err := search.NewHybridSemanticProvider(
		search.SemanticProviderComponent{Name: "local", Provider: local.provider, Manifest: local.manifest, Default: true},
		search.SemanticProviderComponent{Name: "online", Provider: online, Manifest: onlineManifest},
	)
	if err != nil {
		if local.release != nil {
			_ = local.release()
		}
		return nil, nil, err
	}
	return controlplane.WithSemanticIndexerBinding(hybrid, local.zvec, local.libraryPath, local.libraryDigest, local.manifest), local.release, nil
}

// configureImageBinding admits the installed Chinese-CLIP image bundle and binds
// it to the image dimension. The binding is optional: without an admitted bundle
// the dimension reports NOT_BUILT with its reason, and exact save, lexical
// search, and the text semantic dimension are unaffected. The vector backend is
// the in-process zvec library the admitted text bundle already ships, because
// the image bundle admits no vector library of its own.
func configureImageBinding(ctx context.Context, resolved rwconfig.ResolvedConfig, repo repository.Driver, textBundleRoot, imageBundleRoot string, textBundleOverride bool) (controlplane.DispatcherOption, error) {
	if strings.TrimSpace(imageBundleRoot) == "" {
		return nil, nil
	}
	admission, err := search.LoadImageBundle(imageBundleRoot)
	if err != nil {
		return nil, err
	}
	provider, err := processor.NewChineseCLIPImageEmbeddingProvider(ctx, admission, processor.ImageEmbeddingProviderOptions{
		ConfigDigest: resolved.Digest,
	})
	if err != nil {
		return nil, err
	}
	textBundle, err := loadSemanticBundleAdmission(textBundleRoot, textBundleOverride)
	if err != nil {
		_ = provider.Close()
		return nil, fmt.Errorf("image vector backend: %w", err)
	}
	libraryPath := filepath.Join(textBundleRoot, filepath.FromSlash(textBundle.Descriptor.Zvec.Path))
	libraryDigest := "sha256:" + textBundle.AssetDigests["zvec"]
	source := controlplane.NewRepositoryImageContentSource(repo, 0)
	return controlplane.WithImageIndexerBinding(
		provider, search.NewZvecGenerationDriver(libraryPath), source,
		libraryPath, libraryDigest, provider.Manifest(),
	), nil
}

func buildOnlineSemanticBinding(ctx context.Context, resolved rwconfig.ResolvedConfig, store *sqlite.Store, modelsRoot, bundleRoot string, operatorOverride bool) (*search.OnlineEmbeddingProvider, search.ZvecGenerationDriver, string, string, search.EmbeddingGenerationManifest, error) {
	profile, err := search.LoadOnlineEmbeddingProfile(modelsRoot, resolved.Config.Semantic.OnlineProfile)
	if err != nil {
		return nil, nil, "", "", search.EmbeddingGenerationManifest{}, err
	}
	manifest, err := profile.EmbeddingGenerationManifest(resolved.Digest)
	if err != nil {
		return nil, nil, "", "", search.EmbeddingGenerationManifest{}, err
	}
	bundle, err := loadSemanticBundleAdmission(bundleRoot, operatorOverride)
	if err != nil {
		return nil, nil, "", "", search.EmbeddingGenerationManifest{}, fmt.Errorf("online embedding vector backend: %w", err)
	}
	libraryPath := filepath.Join(bundleRoot, filepath.FromSlash(bundle.Descriptor.Zvec.Path))
	libraryDigest := "sha256:" + bundle.AssetDigests["zvec"]
	provider, err := search.NewOnlineEmbeddingProvider(search.OnlineEmbeddingProviderOptions{
		Mode:                           strings.TrimSpace(resolved.Config.Semantic.EmbeddingMode),
		Profile:                        profile,
		Manifest:                       manifest,
		CredentialRef:                  resolved.Config.Semantic.OnlineCredentialRef,
		SendContentWithoutConfirmation: resolved.Config.Semantic.SendContentWithoutConfirmation,
		AuditSink:                      controlplane.NewSemanticEgressAuditSink(store),
		SubjectPolicy:                  controlplane.NewSemanticEgressSubjectPolicy(store),
	})
	if err != nil {
		return nil, nil, "", "", search.EmbeddingGenerationManifest{}, err
	}
	if readinessErr := provider.CheckEgressReadiness(ctx); readinessErr != nil {
		// The provider stays bound so capability and status name the exact
		// failed condition; the daemon starts degraded, not silently online.
		log.Printf("online semantic egress not ready: %v", readinessErr)
	}
	return provider, search.NewZvecGenerationDriver(libraryPath), libraryPath, libraryDigest, manifest, nil
}

// loadSemanticBundleAdmission is the single daemon admission boundary for the
// model bundle. The configured personal default must match the immutable
// installer tuple; an explicit --semantic-bundle is the only path that may
// accept a generic, operator-owned bundle, and its status remains labeled as
// an override by the caller.
func loadSemanticBundleAdmission(bundleRoot string, operatorOverride bool) (search.SemanticBundleAdmission, error) {
	bundle, err := search.LoadSemanticBundle(strings.TrimSpace(bundleRoot))
	if err != nil {
		return search.SemanticBundleAdmission{}, err
	}
	if !operatorOverride {
		if err := search.ValidateDefaultSemanticBundleAdmission(bundle); err != nil {
			return search.SemanticBundleAdmission{}, fmt.Errorf("default semantic bundle admission: %w", err)
		}
	}
	return bundle, nil
}

func semanticBundleCapability(bundleRoot string, operatorOverride bool) command.Capability {
	source := "BAAI/bge-small-zh-v1.5"
	notes := "local semantic bundle is not installed or has not passed integrity admission"
	if operatorOverride {
		source = "operator-provided"
		notes = "operator-provided semantic bundle override; not the release-pinned default"
	}
	capability := command.Capability{
		Kind:    "model-bundle",
		ID:      search.SemanticBundleBGEProfileID,
		State:   command.CapabilityUnavailable,
		Version: "1",
		Source:  source,
		Notes:   notes,
	}
	bundle, err := loadSemanticBundleAdmission(bundleRoot, operatorOverride)
	if err != nil {
		return capability
	}
	capability.State = command.CapabilityAvailable
	capability.Version = bundle.ProfileDigest
	if operatorOverride {
		capability.Notes = "operator-provided semantic bundle override is installed and locally verified; not the release-pinned default; semantic index readiness is reported separately"
	} else {
		capability.Notes = "bundle is installed and locally verified; semantic index readiness is reported separately"
	}
	return capability
}

func semanticBundleInstallerEnabled(options daemonOptions) bool {
	return !options.semanticBundleOverride && strings.TrimSpace(options.semanticBundle) == ""
}

func keepSemanticLeaseAlive(ctx context.Context, interval time.Duration, renew func(context.Context) error, invalidate func(error), done chan<- struct{}) {
	defer close(done)
	if invalidate == nil {
		return
	}
	if interval <= 0 || renew == nil {
		invalidate(errors.New("semantic worker lease keepalive is not configured"))
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := renew(ctx); err != nil {
				invalidate(err)
				return
			}
		}
	}
}

// renewAndValidateSemanticLease keeps a long-lived worker's coordination
// lease alive while preserving the original fencing token. A takeover is
// never adopted silently: the changed token fails the worker closed.
func renewAndValidateSemanticLease(ctx context.Context, fencer exact.PublicationFencer, domain, owner, leaseToken string, fenceToken int64, now time.Time) error {
	if fencer == nil {
		return errors.New("semantic worker lease provider is unavailable")
	}
	renewed, err := fencer.Acquire(ctx, domain, owner, leaseToken, now, now.Add(exact.DefaultPublicationFenceTTL))
	if err != nil {
		return fmt.Errorf("renew semantic worker lease: %w", err)
	}
	if renewed != fenceToken {
		return fmt.Errorf("semantic worker lease fencing token changed from %d to %d", fenceToken, renewed)
	}
	return fencer.Validate(ctx, domain, owner, leaseToken, fenceToken, now)
}

func runWithOptions(ctx context.Context, options daemonOptions) error {
	if options.recoveryReader {
		return runRecoveryReader(ctx, options)
	}
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	resolved, err := rwconfig.LoadEffective(rwconfig.LoadOptions{
		Path: options.configPath,
		// Normal daemon mode must be anchored to an operator-created persisted
		// profile.  Falling back to platform defaults here can create a new
		// catalog/repository (and signing state) in an unexpected location when
		// a config path is misspelled or has not been initialized yet.
		// Recovery-reader mode intentionally returns above and remains
		// catalog/config-free.
		AllowMissing: false,
		ResolveOptions: rwconfig.ResolveOptions{
			Overrides: rwconfig.PathOverrides{Catalog: options.catalogPath, Repository: options.repositoryPath},
		},
	})
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	if err := validateRuntimeStorageProfile(resolved.Config); err != nil {
		return err
	}
	catalogPath := resolved.Config.Paths.Catalog
	repositoryPath := resolved.Config.Paths.Repository

	store, err := sqlite.Open(runCtx, catalogPath, sqlite.Options{})
	if err != nil {
		return fmt.Errorf("open catalog: %w", err)
	}
	defer store.Close()

	repo, err := repository.OpenProfileWithCompression(
		resolved.Config.Storage.RepositoryProfile,
		resolved.Config.Storage.CompressionProfile,
		repositoryPath,
	)
	if err != nil {
		return fmt.Errorf("open repository: %w", err)
	}
	commits, err := repo.ListRecordDigests(runCtx, repository.RecordPublicationCommit)
	if err != nil {
		return fmt.Errorf("inspect publication commits: %w", err)
	}
	identity, anchor, err := exact.OpenSigningMaterial(
		resolved.Config.Paths.RecoveryRecords, resolved.Config.Recovery.PublicationDomain, len(commits) == 0,
	)
	if err != nil {
		return fmt.Errorf("open publication signing material: %w", err)
	}
	exactLane := &exact.Service{
		Store:                        store,
		Repo:                         repo,
		ConfigDigest:                 resolved.Digest,
		DefaultProtection:            sqlite.ProtectionMode(resolved.Config.Storage.DefaultProtection),
		AllowLinkOnly:                resolved.Config.Storage.AllowLinkOnly,
		LinkOnlyRequiresConfirmation: resolved.Config.Storage.LinkOnlyRequiresConfirmation,
		SigningIdentity:              &identity,
		TrustAnchor:                  &anchor,
		PublicationDomain:            resolved.Config.Recovery.PublicationDomain,
		RequireSignedPublication:     true,
	}
	bundleRoot := strings.TrimSpace(options.semanticBundle)
	if bundleRoot == "" {
		bundleRoot = filepath.Join(resolved.Config.Paths.Models, search.SemanticBundleBGEProfileID, runtime.GOOS+"-"+runtime.GOARCH)
	}
	bundleCapability := semanticBundleCapability(bundleRoot, options.semanticBundleOverride)
	imageBundleRoot := strings.TrimSpace(options.imageBundle)
	if imageBundleRoot == "" {
		imageBundleRoot = filepath.Join(resolved.Config.Paths.Models, search.ImageBundleDefaultProfileID, runtime.GOOS+"-"+runtime.GOARCH)
	}
	imageOption, imageErr := configureImageBinding(runCtx, resolved, repo, bundleRoot, imageBundleRoot, options.semanticBundleOverride)
	if imageErr != nil {
		log.Printf("image capability unavailable: %v", imageErr)
	}
	semanticOption, semanticCleanup, semanticErr := configureSemanticBindingForMode(
		runCtx, resolved, store, resolved.Config.Paths.Models, bundleRoot, options.semanticBundleOverride)
	if semanticErr != nil {
		log.Printf("semantic capability unavailable: %v", semanticErr)
	}
	if semanticCleanup != nil {
		defer func() {
			if err := semanticCleanup(); err != nil {
				log.Printf("semantic lease release: %v", err)
			}
		}()
	}
	indexBinding := search.IndexBinding{
		ConfigDigest:         resolved.Digest,
		LexicalProfileDigest: search.ProfileDigest(search.DimensionLexical, search.LexicalProfileV1),
		GraphProfileDigest:   search.ProfileDigest(search.DimensionGraph, search.GraphProfileV1),
	}
	dispatcherOptions := []controlplane.DispatcherOption{
		controlplane.WithConfigDigest(resolved.Digest), controlplane.WithIndexBinding(indexBinding),
		controlplane.WithOperatorConfig(resolved),
		controlplane.WithSemanticBundleCapability(bundleCapability),
		controlplane.WithVectorPath(resolved.Config.Paths.Vectors), controlplane.WithExact(exactLane),
	}
	if imageOption != nil {
		dispatcherOptions = append(dispatcherOptions, imageOption)
	}
	if semanticBundleInstallerEnabled(options) {
		modelsRoot := resolved.Config.Paths.Models
		dispatcherOptions = append(dispatcherOptions, controlplane.WithSemanticBundleInstaller(modelsRoot,
			func(installCtx context.Context, root string) (controlplane.SemanticBundleInstallReceipt, error) {
				beforeRoot := filepath.Join(root, search.SemanticBundleBGEProfileID, runtime.GOOS+"-"+runtime.GOARCH)
				before, beforeErr := search.LoadSemanticBundle(beforeRoot)
				admission, installErr := search.InstallDefaultSemanticBundle(installCtx, root)
				if installErr != nil {
					return controlplane.SemanticBundleInstallReceipt{}, installErr
				}
				changed := beforeErr != nil || before.ProfileDigest != admission.ProfileDigest
				return controlplane.SemanticBundleInstallReceipt{
					Admission:   admission,
					Destination: filepath.Join(root, search.SemanticBundleBGEProfileID, runtime.GOOS+"-"+runtime.GOARCH),
					Changed:     changed,
				}, nil
			},
		))
		dispatcherOptions = append(dispatcherOptions, controlplane.WithSemanticBundleArchiveInstaller(modelsRoot,
			func(installCtx context.Context, root, archivePath string) (controlplane.SemanticBundleInstallReceipt, error) {
				beforeRoot := filepath.Join(root, search.SemanticBundleBGEProfileID, runtime.GOOS+"-"+runtime.GOARCH)
				before, beforeErr := search.LoadSemanticBundle(beforeRoot)
				admission, installErr := search.InstallDefaultSemanticBundleFromArchive(installCtx, root, archivePath)
				if installErr != nil {
					return controlplane.SemanticBundleInstallReceipt{}, installErr
				}
				changed := beforeErr != nil || before.ProfileDigest != admission.ProfileDigest
				return controlplane.SemanticBundleInstallReceipt{
					Admission:   admission,
					Destination: beforeRoot,
					Changed:     changed,
				}, nil
			},
		))
	}
	if semanticOption != nil {
		dispatcherOptions = append(dispatcherOptions, semanticOption)
	}
	dispatcher := controlplane.NewDispatcher(store, catalogPath, options.socketPath, dispatcherOptions...)
	if semanticOption != nil {
		if workspace, workspaceErr := store.GetWorkspaceByName(runCtx, "default"); workspaceErr == nil {
			if warmErr := dispatcher.WarmSemanticGeneration(runCtx, workspace.ID); warmErr != nil {
				log.Printf("semantic generation warm-up unavailable: %v", warmErr)
			}
		} else if !errors.Is(workspaceErr, sqlite.ErrNotFound) {
			log.Printf("semantic workspace lookup: %v", workspaceErr)
		}
	}
	apiAddress, err := resolveAPIAddress(options.apiListen, resolved.Config.API)
	if err != nil {
		return err
	}
	if strings.TrimSpace(options.webRoot) != "" && apiAddress == "" {
		return errors.New("--web-root requires an enabled loopback API listener")
	}
	var apiServer *http.Server
	var apiListener net.Listener
	if apiAddress != "" {
		handler, handlerErr := api.HandlerWithStatic(dispatcher.Handle, api.Options{Token: options.apiToken}, options.webRoot)
		if handlerErr != nil {
			return fmt.Errorf("load WebUI: %w", handlerErr)
		}
		apiServer, apiListener, err = prepareAPIHTTPServer(apiAddress, handler)
		if err != nil {
			return err
		}
	}
	server, err := controlplane.NewServer(dispatcher, options.socketPath,
		controlplane.WithErrorHandler(func(err error) { log.Printf("%v", err) }))
	if err != nil {
		if apiListener != nil {
			_ = apiListener.Close()
		}
		return err
	}
	serveDone := make(chan struct{})
	go func() {
		defer close(serveDone)
		if err := server.Serve(runCtx); err != nil {
			log.Printf("serve: %v", err)
		}
	}()
	retryDone := make(chan struct{})
	go func() {
		defer close(retryDone)
		_ = exactLane.RunProcessorRetryWorker(runCtx, exact.ProcessorRetryWorkerOptions{
			Owner:   fmt.Sprintf("restoreweaved-%d", os.Getpid()),
			OnError: func(err error) { log.Printf("processor retry worker: %v", err) },
		})
	}()
	if apiServer != nil {
		go func() {
			log.Printf("restoreweaved API listening on %s", apiAddress)
			if err := apiServer.Serve(apiListener); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Printf("api: %v", err)
			}
		}()
	}
	log.Printf("restoreweaved listening on %s (catalog %s, repository %s)", server.SocketPath(), catalogPath, repositoryPath)

	<-ctx.Done()
	log.Printf("shutting down")
	cancel()
	if apiServer != nil {
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		if shutdownErr := apiServer.Shutdown(shutdownCtx); shutdownErr != nil {
			_ = apiServer.Close()
		}
		shutdownCancel()
	}
	if err := server.Close(); err != nil {
		return fmt.Errorf("close control plane: %w", err)
	}
	shutdownDeadline := time.NewTimer(5 * time.Second)
	defer shutdownDeadline.Stop()
	select {
	case <-serveDone:
	case <-shutdownDeadline.C:
		return errors.New("control plane shutdown timed out")
	}
	select {
	case <-retryDone:
	case <-shutdownDeadline.C:
		return errors.New("processor retry worker shutdown timed out")
	}
	return nil
}

func resolveAPIAddress(override string, configured rwconfig.APIConfig) (string, error) {
	address := strings.TrimSpace(override)
	if address == "" && configured.Enabled {
		address = configured.Listen
	}
	if address == "" {
		return "", nil
	}
	if err := rwconfig.ValidateLoopbackAPIListen(address); err != nil {
		return "", fmt.Errorf("start local HTTP adapter: %w", err)
	}
	return address, nil
}

// prepareAPIHTTPServer binds synchronously; serving starts only after all
// daemon startup checks have succeeded.
func prepareAPIHTTPServer(address string, handler http.Handler) (*http.Server, net.Listener, error) {
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return nil, nil, fmt.Errorf("bind local HTTP adapter on %s: %w", address, err)
	}
	server := &http.Server{Addr: address, Handler: handler}
	return server, listener, nil
}

func runRecoveryReader(ctx context.Context, options daemonOptions) error {
	if strings.TrimSpace(options.repositoryPath) == "" ||
		strings.TrimSpace(options.recoveryReference) == "" ||
		strings.TrimSpace(options.trustAnchorPath) == "" {
		return errors.New("--recovery-reader requires --repository, --recovery-reference, and --trust-anchor")
	}
	profile, err := repository.DetectProfileReadOnly(options.repositoryPath)
	if err != nil {
		return fmt.Errorf("detect repository profile: %w", err)
	}
	repo, err := repository.OpenProfileReadOnly(profile, options.repositoryPath)
	if err != nil {
		return fmt.Errorf("open recovery repository read-only: %w", err)
	}
	anchor, err := exact.LoadTrustAnchor(options.trustAnchorPath)
	if err != nil {
		return fmt.Errorf("load recovery trust anchor: %w", err)
	}
	reference, err := exact.LoadRecoveryReference(options.recoveryReference)
	if err != nil {
		return fmt.Errorf("load recovery reference: %w", err)
	}
	service := &exact.Service{
		Repo:                     repo,
		TrustAnchor:              &anchor,
		PublicationDomain:        reference.PublicationDomain,
		RequireSignedPublication: true,
	}
	imported, err := service.ImportRecoveryArtifact(ctx, options.recoveryReference, options.trustAnchorPath, reference.PublicationDomain)
	if err != nil {
		return fmt.Errorf("admit recovery reference: %w", err)
	}
	if imported.Schema != exact.RecoveryReferenceSchemaV2 {
		return fmt.Errorf("recovery reader requires %s, got %s", exact.RecoveryReferenceSchemaV2, imported.Schema)
	}
	dispatcher, err := controlplane.NewRecoveryDispatcher(options.socketPath, service)
	if err != nil {
		return fmt.Errorf("create recovery reader: %w", err)
	}
	server, err := controlplane.NewServer(dispatcher, options.socketPath,
		controlplane.WithErrorHandler(func(err error) { log.Printf("%v", err) }))
	if err != nil {
		return err
	}
	serveDone := make(chan struct{})
	go func() {
		defer close(serveDone)
		if err := server.Serve(ctx); err != nil {
			log.Printf("serve recovery reader: %v", err)
		}
	}()
	log.Printf("restoreweaved recovery reader listening on %s (repository %s, profile %s)", server.SocketPath(), repo.Root(), profile)
	<-ctx.Done()
	if err := server.Close(); err != nil {
		return fmt.Errorf("close recovery reader: %w", err)
	}
	<-serveDone
	return nil
}

func validateRuntimeStorageProfile(cfg rwconfig.Config) error {
	if cfg.Recovery.PublicationSigning != rwconfig.PublicationSigningLocalEd25519 {
		return fmt.Errorf(
			"recovery publication signing profile %q is not available in this build (available: %s)",
			cfg.Recovery.PublicationSigning, rwconfig.PublicationSigningLocalEd25519,
		)
	}
	if cfg.Storage.RepositoryProfile == rwconfig.RepositoryProfileLocalZstdEncryptedV1 {
		return fmt.Errorf(
			"storage repository profile %q is experimental and is not admitted in this build (no daemon/secret-provider wiring)",
			rwconfig.RepositoryProfileLocalZstdEncryptedV1,
		)
	}
	switch cfg.Storage.RepositoryProfile {
	case rwconfig.RepositoryProfileDirectoryCASDev:
		if cfg.Storage.CompressionProfile != rwconfig.CompressionProfileIdentity {
			return fmt.Errorf(
				"storage compression profile %q is not available with repository profile %q (required: %s)",
				cfg.Storage.CompressionProfile, cfg.Storage.RepositoryProfile, rwconfig.CompressionProfileIdentity,
			)
		}
	case rwconfig.RepositoryProfileLocalZstdV1:
		if cfg.Storage.CompressionProfile != rwconfig.CompressionProfileZstdV1 {
			return fmt.Errorf(
				"storage compression profile %q is not available with repository profile %q (required: %s)",
				cfg.Storage.CompressionProfile, cfg.Storage.RepositoryProfile, rwconfig.CompressionProfileZstdV1,
			)
		}
	default:
		return fmt.Errorf(
			"storage repository profile %q is not available in this build (available: %s, %s)",
			cfg.Storage.RepositoryProfile, rwconfig.RepositoryProfileDirectoryCASDev, rwconfig.RepositoryProfileLocalZstdV1,
		)
	}
	if cfg.Storage.NeuralCodec != rwconfig.NeuralCodecDisabled {
		return fmt.Errorf(
			"storage neural codec %q is not available in this build (available: %s)",
			cfg.Storage.NeuralCodec, rwconfig.NeuralCodecDisabled,
		)
	}
	return nil
}
