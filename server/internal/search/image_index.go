package search

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// ImageContent is one admitted image byte stream resolved by the host. The
// search package never opens a repository, a source path, or a network
// location itself; it receives bytes that the host has already bound to the
// exact content identity.
type ImageContent struct {
	ContentID string
	MediaType string
	Bytes     []byte
}

// ImageContentSource is the host-owned byte boundary for image embedding. A
// source must return bytes whose SHA-256 identity equals the requested
// ContentID or fail closed; it must respect the context for cancellation and
// bound the returned payload.
type ImageContentSource interface {
	ReadImageContent(ctx context.Context, contentID string) (ImageContent, error)
}

// ImageIndexReport is the honest result of one image generation build.
type ImageIndexReport struct {
	GenerationID     string
	ProviderDigest   string
	SpaceFingerprint string
	Indexed          int
	Skipped          int
	SkipReasons      map[string]int
}

// ImageIndexState is the operator-facing state of the image dimension for one
// workspace. State is READY, NOT_BUILT, or UNAVAILABLE; Reason carries the
// stable reason code when it is not READY.
type ImageIndexState struct {
	Dimension        string
	Provider         string
	State            string
	Reason           string
	Notes            string
	Artifact         string
	ProviderDigest   string
	SpaceFingerprint string
	GenerationID     string
	Indexed          int
	Skipped          int
	SkipReasons      map[string]int
}

const (
	// MultimodalIndexNotBuiltReason is the stable reason used when no image
	// model artifact or binding is installed. Absence is reported, never
	// worked around with fixture vectors.
	MultimodalIndexNotBuiltReason = "MULTIMODAL_INDEX_NOT_BUILT"
	// MultimodalIndexUnavailableReason is the stable reason used when an
	// artifact is present but no runnable generation can be served.
	MultimodalIndexUnavailableReason = "MULTIMODAL_INDEX_UNAVAILABLE"
	// MultimodalSpaceMismatchReason is the stable reason used when a query
	// vector was produced under a different space fingerprint than the
	// generation it would have been scored against.
	MultimodalSpaceMismatchReason = "MULTIMODAL_SPACE_FINGERPRINT_MISMATCH"
)

// ImageMediaTypeForName maps an admitted filename suffix to one of the
// standard-library decodable media types. Suffix evidence alone is not
// identity: the decode step still validates the actual bytes, and a mismatch
// is a reported skip rather than a silent success.
func ImageMediaTypeForName(name string) (string, bool) {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg":
		return ImageMediaTypeJPEG, true
	case ".png":
		return ImageMediaTypePNG, true
	default:
		return "", false
	}
}

// ImageQueryInput is one host-admitted query image for the image dimension
// (search by image). The host resolves the subject, reads the bytes through
// its own identity-checking content source, and passes the admitted material
// here; the search package never opens a repository or a source path. A query
// image is retrieval material only: its vector never establishes identity and
// never authorizes deletion.
type ImageQueryInput struct {
	// MediaType is one of the admitted image media types (jpeg or png).
	MediaType string
	// Digest is the content identity of Bytes: "sha256:" + hex(SHA-256).
	Digest string
	// Bytes are the complete admitted image bytes.
	Bytes []byte
}

// Validate is the caller-input admission for one query image. Every failure is
// an ErrInvalidQuery so a bad input can never revoke a verified generation.
// The identity rule matches the ingest embedding contract exactly: the digest
// must be the SHA-256 of the admitted bytes.
func (q ImageQueryInput) Validate() error {
	if err := validateImageMediaType(q.MediaType); err != nil {
		return fmt.Errorf("%w: query image media type is not admitted: %v", ErrInvalidQuery, err)
	}
	if len(q.Bytes) == 0 {
		return fmt.Errorf("%w: query image bytes are empty", ErrInvalidQuery)
	}
	if len(q.Bytes) > MaxImageEmbeddingInputBytes {
		return fmt.Errorf("%w: query image exceeds the %d byte bound", ErrInvalidQuery, MaxImageEmbeddingInputBytes)
	}
	sum := sha256.Sum256(q.Bytes)
	if got := "sha256:" + hex.EncodeToString(sum[:]); strings.TrimSpace(q.Digest) != got {
		return fmt.Errorf("%w: query image digest does not match the admitted bytes", ErrInvalidQuery)
	}
	return nil
}

// imageBindingActive reports whether a real image provider binding is
// configured. It is deliberately stricter than "some multimodal fields are
// set": a real generation requires a provider, a vector backend, a validated
// manifest, and the vector/native library bindings.
func (idx *Indexer) imageBindingActive() bool {
	return idx != nil && idx.ImageProvider != nil && idx.ImageZvec != nil &&
		idx.MultimodalManifest != (EmbeddingGenerationManifest{}) &&
		strings.TrimSpace(idx.MultimodalManifest.SemanticSpace) != MultimodalFixtureProfileV1
}

// imageProviderReport returns the provider's own honest state. A provider
// without a health boundary is UNAVAILABLE: a bare interface implementation is
// not proof that a model can run.
func (idx *Indexer) imageProviderReport() ImageProviderReport {
	if idx == nil || idx.ImageProvider == nil {
		return ImageProviderReport{State: ImageProviderNotBuilt, Reason: MultimodalIndexNotBuiltReason}
	}
	health, ok := idx.ImageProvider.(ImageEmbeddingHealth)
	if !ok {
		return ImageProviderReport{State: ImageProviderUnavailable, Reason: "image provider does not report readiness"}
	}
	report := health.ImageProviderReport()
	if report.State == "" {
		report.State = ImageProviderUnavailable
	}
	return report
}

// imageFingerprint resolves the configured space fingerprint. It prefers the
// provider's declared fingerprint and falls back to the manifest binding so a
// misconfigured process still compares against the recorded space.
func (idx *Indexer) imageFingerprint() ImageSpaceFingerprint {
	if idx == nil {
		return ImageSpaceFingerprint{}
	}
	if idx.ImageProvider != nil {
		if health, ok := idx.ImageProvider.(ImageEmbeddingHealth); ok {
			if fingerprint := health.ImageProviderReport().Fingerprint; fingerprint.Validate() == nil {
				return fingerprint
			}
		}
	}
	return ImageSpaceFingerprint{}
}

func (idx *Indexer) setImageFailure(err error) {
	if idx == nil || err == nil {
		return
	}
	idx.imageFailure.Store(err.Error())
}

// ImageFailure returns the latest real image-provider failure for operator
// diagnostics. It never changes exact preservation or recovery.
func (idx *Indexer) ImageFailure() string {
	if idx == nil {
		return ""
	}
	value := idx.imageFailure.Load()
	if value == nil {
		return ""
	}
	failure, _ := value.(string)
	return strings.TrimSpace(failure)
}

// imageGenerationMatchesLatestFeed binds the implicit latest image lane to the
// same durable lexical feed that is current after restart. Pinned historical
// generations remain addressable explicitly.
func (idx *Indexer) imageGenerationMatchesLatestFeed(ctx context.Context, generation sqlite.IndexGeneration) error {
	if idx == nil || idx.Store == nil {
		return ErrUnavailable
	}
	lexical, err := idx.Store.LatestIndexGeneration(ctx, generation.WorkspaceID, DimensionLexical)
	if err != nil {
		return fmt.Errorf("latest lexical generation: %w", err)
	}
	if lexical.WorkspaceID != generation.WorkspaceID || lexical.SnapshotRef != generation.SnapshotRef ||
		lexical.NamespaceRootID != generation.NamespaceRootID || !generationBindingMatches(idx, lexical, DimensionLexical) {
		return errors.New("image generation does not match latest lexical feed")
	}
	return nil
}

// rebuildImage builds one disposable image generation from admitted image
// bytes. It is bounded derived work: it never touches exact placement,
// protection records, or recovery state, and a failure leaves the exact and
// lexical lanes usable. The context must be honoured so the caller can cancel
// the build.
func (idx *Indexer) rebuildImage(ctx context.Context, workspaceID, snapshotRef, namespaceRootID string, rootIDs []string, byID map[string]sqlite.NamespaceEntry) (ImageIndexReport, error) {
	report := ImageIndexReport{SkipReasons: map[string]int{}}
	idx.imageIndexReady.Store(false)
	if !idx.imageBindingActive() {
		return report, fmt.Errorf("%w: %s", ErrImageProviderUnavailable, MultimodalIndexNotBuiltReason)
	}
	manifest := idx.MultimodalManifest
	fingerprint := idx.imageFingerprint()
	if err := ValidateImageGenerationManifest(manifest, fingerprint); err != nil {
		return report, err
	}
	if providerReport := idx.imageProviderReport(); providerReport.State != ImageProviderReady {
		reason := strings.TrimSpace(providerReport.Reason)
		if reason == "" {
			reason = MultimodalIndexUnavailableReason
		}
		return report, fmt.Errorf("%w: %s", ErrImageProviderUnavailable, reason)
	}
	if idx.ImageSource == nil {
		return report, fmt.Errorf("%w: image content source is not configured", ErrImageProviderUnavailable)
	}
	if strings.TrimSpace(idx.ImageLibraryPath) == "" || strings.TrimSpace(idx.ImageLibraryDigest) == "" {
		return report, fmt.Errorf("%w: image vector library binding is missing", ErrImageProviderUnavailable)
	}
	if !filepath.IsAbs(idx.Engine.Dir) || filepath.Clean(idx.Engine.Dir) != idx.Engine.Dir {
		return report, fmt.Errorf("%w: image index directory must be absolute and canonical", ErrImageProviderUnavailable)
	}

	// Deduplicate exact content: identical bytes are embedded once and fan out
	// to every entry that shares the content identity. Membership stays
	// per-entry so provenance is never collapsed.
	entriesByContent := map[string][]sqlite.NamespaceEntry{}
	for _, entry := range byID {
		if entry.ContentID == "" || entry.EntryType != sqlite.EntryFile {
			continue
		}
		if _, ok := ImageMediaTypeForName(entry.DisplayName); !ok {
			continue
		}
		entriesByContent[entry.ContentID] = append(entriesByContent[entry.ContentID], entry)
	}
	contentIDs := make([]string, 0, len(entriesByContent))
	for contentID := range entriesByContent {
		contentIDs = append(contentIDs, contentID)
	}
	sort.Strings(contentIDs)
	if len(contentIDs) == 0 {
		return report, fmt.Errorf("%w: no admitted image content in generation scope", ErrImageProviderUnavailable)
	}
	generationID, err := sqlite.NewStableID(sqlite.IDPrefixIndexGeneration)
	if err != nil {
		return report, err
	}
	vectors := make([]ZvecSegment, 0, len(contentIDs))
	for start := 0; start < len(contentIDs); start += MaxImageEmbeddingInputs {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		end := start + MaxImageEmbeddingInputs
		if end > len(contentIDs) {
			end = len(contentIDs)
		}
		batch := make([]ImageEmbeddingInput, 0, end-start)
		batchEntries := map[string][]sqlite.NamespaceEntry{}
		for _, contentID := range contentIDs[start:end] {
			entries := entriesByContent[contentID]
			content, readErr := idx.ImageSource.ReadImageContent(ctx, contentID)
			if readErr != nil {
				report.Skipped += len(entries)
				report.SkipReasons["content-unavailable"] += len(entries)
				continue
			}
			mediaType := strings.ToLower(strings.TrimSpace(content.MediaType))
			if content.ContentID != contentID || (mediaType != ImageMediaTypeJPEG && mediaType != ImageMediaTypePNG) {
				report.Skipped += len(entries)
				report.SkipReasons["content-identity-or-type-mismatch"] += len(entries)
				continue
			}
			// One provider identity per content digest; the first entry's
			// subject is only a carrier for the request, never a claim about
			// the other subjects.
			carrier := entries[0]
			batch = append(batch, ImageEmbeddingInput{
				SubjectID:   semanticEntrySubject(carrier),
				SegmentID:   contentID,
				MediaType:   mediaType,
				ImageDigest: contentID,
				ImageBytes:  content.Bytes,
			})
			batchEntries[contentID] = entries
		}
		if len(batch) == 0 {
			continue
		}
		request := ImageEmbeddingRequest{
			Purpose: ImageEmbeddingImage, GenerationID: generationID,
			Manifest: manifest, Fingerprint: fingerprint, Inputs: batch,
		}
		if err := ValidateImageEmbeddingRequest(request); err != nil {
			return report, err
		}
		results, embedErr := idx.ImageProvider.EmbedImages(ctx, request)
		if embedErr != nil {
			return report, fmt.Errorf("%w: provider: %v", ErrImageProviderUnavailable, embedErr)
		}
		if err := ValidateImageEmbeddingResults(request, results); err != nil {
			return report, err
		}
		for _, result := range results {
			for _, entry := range batchEntries[result.SegmentID] {
				vectors = append(vectors, ZvecSegment{
					SubjectID: semanticEntrySubject(entry), SegmentID: entry.ID,
					Vector: append([]float32(nil), result.Vector...),
				})
			}
		}
	}
	if len(vectors) == 0 {
		return report, fmt.Errorf("%w: no image content could be embedded", ErrImageProviderUnavailable)
	}
	sort.Slice(vectors, func(i, j int) bool {
		if vectors[i].SegmentID != vectors[j].SegmentID {
			return vectors[i].SegmentID < vectors[j].SegmentID
		}
		return vectors[i].SubjectID < vectors[j].SubjectID
	})
	spec := ZvecGenerationSpec{
		Path: filepath.Join(idx.Engine.Dir, generationID+".zvec"), LibraryPath: idx.ImageLibraryPath,
		LibraryDigest: idx.ImageLibraryDigest, ProfileDigest: manifest.CanonicalDigest(), Manifest: manifest,
	}
	if _, ok := idx.ImageZvec.(ZvecGenerationMembershipVerifier); !ok {
		return report, fmt.Errorf("%w: image backend does not provide generation membership verification", ErrImageProviderUnavailable)
	}
	receipt, err := idx.ImageZvec.Build(ctx, spec, vectors)
	if err != nil {
		return report, fmt.Errorf("%w: build image generation: %v", ErrImageProviderUnavailable, err)
	}
	if err := validateSemanticBuildReceipt(receipt, spec, len(vectors)); err != nil {
		return report, fmt.Errorf("%w: %v", ErrImageProviderUnavailable, err)
	}
	candidates := make([]ZvecCoverageIdentity, 0, len(vectors))
	for _, segment := range vectors {
		candidates = append(candidates, ZvecCoverageIdentity{SubjectID: segment.SubjectID, SegmentID: segment.SegmentID})
	}
	actualCoverage, err := verifyZvecGenerationCoverage(ctx, idx.ImageZvec, spec, candidates)
	if err != nil {
		return report, err
	}
	if err := openCloseZvecGeneration(ctx, idx.ImageZvec, spec); err != nil {
		return report, fmt.Errorf("%w: built image generation lifecycle: %v", ErrImageProviderUnavailable, err)
	}
	imageSnapshotRef := snapshotRef
	if primaryRoot, rootErr := idx.Store.GetNamespaceRoot(ctx, workspaceID, namespaceRootID); rootErr == nil && strings.TrimSpace(primaryRoot.SnapshotRef) != "" {
		imageSnapshotRef = primaryRoot.SnapshotRef
	}
	generation := sqlite.IndexGeneration{
		ID: generationID, WorkspaceID: workspaceID, SnapshotRef: imageSnapshotRef, NamespaceRootID: namespaceRootID,
		DBPath: receipt.Path, Dimension: DimensionMultimodal, ConfigDigest: manifest.ConfigDigest,
		ProviderProfileDigest: manifest.CanonicalDigest(), SemanticSpace: fingerprint.CanonicalDigest(),
	}
	if strings.TrimSpace(generation.DBPath) == "" {
		generation.DBPath = spec.Path
	}
	if err := writeImageGenerationReceipt(generation, idx.ImageLibraryDigest, fingerprint, actualCoverage); err != nil {
		return report, fmt.Errorf("%w: write image generation receipt: %v", ErrImageProviderUnavailable, err)
	}
	if err := idx.Store.InsertIndexGenerationWithRoots(ctx, &generation, rootIDs); err != nil {
		_ = os.Remove(semanticGenerationReceiptPath(generation.DBPath))
		return report, err
	}
	idx.cacheImageGeneration(generation, actualCoverage)
	idx.imageIndexReady.Store(true)
	idx.imageFailure.Store("")
	report.GenerationID = generation.ID
	report.ProviderDigest = manifest.ProviderDigest
	report.SpaceFingerprint = fingerprint.CanonicalDigest()
	report.Indexed = len(actualCoverage)
	return report, nil
}

// WarmImageGeneration reopens the latest disposable image generation after a
// daemon restart. Readiness is granted only after its persisted bindings match
// the current provider/space and the native driver opens it.
func (idx *Indexer) WarmImageGeneration(ctx context.Context, workspaceID string) error {
	if !idx.imageBindingActive() || idx.ImageSource == nil {
		return ErrUnavailable
	}
	idx.imageIndexReady.Store(false)
	generation, err := idx.Store.LatestIndexGeneration(ctx, workspaceID, DimensionMultimodal)
	if err != nil {
		return err
	}
	if !generationBindingMatches(idx, generation, DimensionMultimodal) {
		return fmt.Errorf("%w: image generation binding mismatch", ErrUnavailable)
	}
	if err := validateSemanticGenerationMapping(ctx, idx.Store, generation); err != nil {
		return fmt.Errorf("%w: image generation root mapping: %v", ErrUnavailable, err)
	}
	if providerReport := idx.imageProviderReport(); providerReport.State != ImageProviderReady {
		return fmt.Errorf("%w: %s", ErrUnavailable, providerReport.Reason)
	}
	if err := idx.ensureImageGenerationVerified(ctx, generation); err != nil {
		return err
	}
	idx.imageIndexReady.Store(true)
	idx.imageFailure.Store("")
	return nil
}

// ensureImageGenerationVerified validates one image generation against its
// immutable receipt exactly once per process and binding.
func (idx *Indexer) ensureImageGenerationVerified(ctx context.Context, generation sqlite.IndexGeneration) error {
	if idx == nil || idx.ImageZvec == nil {
		return fmt.Errorf("%w: image backend is unavailable", ErrUnavailable)
	}
	idx.imageVerifyMu.Lock()
	defer idx.imageVerifyMu.Unlock()
	if identityCount, ok := idx.cachedImageGeneration(generation); ok {
		if identityCount == 0 {
			return fmt.Errorf("%w: image generation coverage is empty", ErrUnavailable)
		}
		return nil
	}
	identities, _, libraryDigest, err := readImageGenerationReceipt(generation)
	if err != nil {
		return fmt.Errorf("%w: read image generation receipt: %v", ErrUnavailable, err)
	}
	if strings.TrimSpace(libraryDigest) == "" || libraryDigest != idx.ImageLibraryDigest {
		return fmt.Errorf("%w: image generation library binding is invalid", ErrUnavailable)
	}
	spec := ZvecGenerationSpec{
		Path: generation.DBPath, LibraryPath: idx.ImageLibraryPath, LibraryDigest: idx.ImageLibraryDigest,
		ProfileDigest: idx.MultimodalManifest.CanonicalDigest(), Manifest: idx.MultimodalManifest,
	}
	if err := openCloseZvecGeneration(ctx, idx.ImageZvec, spec); err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	actual, err := verifyZvecGenerationCoverage(ctx, idx.ImageZvec, spec, identities)
	if err != nil {
		return err
	}
	idx.cacheImageGeneration(generation, actual)
	return nil
}

// queryImage embeds the query material with the image model's own towers and
// scores it only against a generation whose space fingerprint matches the
// vector that was produced. A text query goes through the text tower; an image
// query goes through the same vision tower and preprocessing profile that
// built the generation, so the produced vectors are comparable by
// construction. The two materials are never mixed into one hybrid vector.
func (idx *Indexer) queryImage(ctx context.Context, generation sqlite.IndexGeneration, text string, imageQuery *ImageQueryInput) (result []Hit, err error) {
	querySucceeded := false
	var opened ZvecGeneration
	defer func() {
		if opened != nil {
			if closeErr := opened.Close(); closeErr != nil {
				result = nil
				err = fmt.Errorf("%w: close image generation: %v", ErrUnavailable, closeErr)
				querySucceeded = false
			}
		}
		// A caller-side input error says nothing about the generation, so it
		// must never revoke a verified one.
		if !querySucceeded && !errors.Is(err, ErrInvalidQuery) {
			idx.revokeImageGeneration(generation.ID)
		}
	}()
	if imageQuery != nil {
		if strings.TrimSpace(text) != "" {
			return nil, fmt.Errorf("%w: a multimodal query carries either query text or a query image, not both", ErrInvalidQuery)
		}
		if err := imageQuery.Validate(); err != nil {
			return nil, err
		}
	} else if strings.TrimSpace(text) == "" {
		return nil, fmt.Errorf("%w: %s", ErrInvalidQuery, QueryTextRequiredReason)
	}
	if !idx.imageBindingActive() {
		return nil, fmt.Errorf("%w: %s", ErrUnavailable, MultimodalIndexNotBuiltReason)
	}
	manifest := idx.MultimodalManifest
	fingerprint := idx.imageFingerprint()
	if err := ValidateImageGenerationManifest(manifest, fingerprint); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if providerReport := idx.imageProviderReport(); providerReport.State != ImageProviderReady {
		reason := strings.TrimSpace(providerReport.Reason)
		if reason == "" {
			reason = MultimodalIndexUnavailableReason
		}
		return nil, fmt.Errorf("%w: %s", ErrUnavailable, reason)
	}
	// The generation record and the query vector must describe the same space.
	// A mismatch is refused here, before any scoring, and is reported with its
	// own stable reason.
	if strings.TrimSpace(generation.SemanticSpace) != fingerprint.CanonicalDigest() {
		return nil, fmt.Errorf("%w: %s", ErrUnavailable, MultimodalSpaceMismatchReason)
	}
	if generation.ProviderProfileDigest != manifest.CanonicalDigest() {
		return nil, fmt.Errorf("%w: image generation provider profile does not match the configured provider", ErrUnavailable)
	}
	if err := idx.ensureImageGenerationVerified(ctx, generation); err != nil {
		return nil, err
	}
	request := ImageEmbeddingRequest{GenerationID: generation.ID, Manifest: manifest, Fingerprint: fingerprint}
	if imageQuery != nil {
		// The query image is embedded by the identical vision tower and
		// preprocessing profile that embedded the stored content, validated by
		// the same request contract. "query" is a request-local carrier, never
		// a subject claim.
		request.Purpose = ImageEmbeddingImage
		request.Inputs = []ImageEmbeddingInput{{
			SubjectID: "query", SegmentID: "query", MediaType: imageQuery.MediaType,
			ImageDigest: imageQuery.Digest, ImageBytes: imageQuery.Bytes,
		}}
	} else {
		request.Purpose = ImageEmbeddingText
		request.Inputs = []ImageEmbeddingInput{{SegmentID: "query", Language: "und", Text: text}}
	}
	if err := ValidateImageEmbeddingRequest(request); err != nil {
		return nil, err
	}
	results, embedErr := idx.ImageProvider.EmbedImages(ctx, request)
	if embedErr != nil {
		return nil, fmt.Errorf("%w: provider: %v", ErrUnavailable, embedErr)
	}
	if err := ValidateImageEmbeddingResults(request, results); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if len(results) != 1 {
		return nil, ErrUnavailable
	}
	spec := ZvecGenerationSpec{
		Path: generation.DBPath, LibraryPath: idx.ImageLibraryPath, LibraryDigest: idx.ImageLibraryDigest,
		ProfileDigest: manifest.CanonicalDigest(), Manifest: manifest,
	}
	opened, err = idx.ImageZvec.Open(ctx, spec)
	if err != nil {
		return nil, fmt.Errorf("%w: open image generation: %v", ErrUnavailable, err)
	}
	if opened == nil {
		return nil, fmt.Errorf("%w: image backend returned a nil generation", ErrUnavailable)
	}
	membershipVerifier, ok := idx.ImageZvec.(ZvecGenerationMembershipVerifier)
	if !ok {
		return nil, fmt.Errorf("%w: image backend does not provide generation membership verification", ErrUnavailable)
	}
	hits, err := opened.Query(ctx, results[0].Vector, 100)
	if err != nil {
		return nil, err
	}
	entries, err := semanticNamespaceEntries(ctx, idx.Store, generation)
	if err != nil {
		return nil, fmt.Errorf("%w: image namespace provenance: %v", ErrUnavailable, err)
	}
	candidates := make([]ZvecCoverageIdentity, 0, len(hits))
	for _, hit := range hits {
		if strings.TrimSpace(hit.SubjectID) == "" || strings.TrimSpace(hit.SegmentID) == "" {
			return nil, fmt.Errorf("%w: image hit has incomplete identity", ErrUnavailable)
		}
		candidates = append(candidates, ZvecCoverageIdentity{SubjectID: hit.SubjectID, SegmentID: hit.SegmentID})
	}
	if err := membershipVerifier.VerifyMembership(ctx, spec, candidates); err != nil {
		return nil, fmt.Errorf("%w: image generation membership: %v", ErrUnavailable, err)
	}
	result = make([]Hit, 0, len(hits))
	bySubject := make(map[string]int, len(hits))
	for _, hit := range hits {
		entry, entryOK, entryErr := semanticFilenameEntry(ctx, idx.Store, generation, entries, hit.SegmentID, hit.SubjectID)
		if entryErr != nil {
			return nil, fmt.Errorf("%w: image provenance: %v", ErrUnavailable, entryErr)
		}
		if !entryOK {
			return nil, fmt.Errorf("%w: image provenance %q subject binding mismatch", ErrUnavailable, hit.SegmentID)
		}
		projected := SegmentRef{
			SourceType: "IMAGE", SourceID: entry.ID, SegmentID: entry.ID,
			MatchedText: entry.DisplayName, Kind: "IMAGE", Producer: manifest.ProviderDigest,
			Accepted: true, Language: "und",
		}
		if at, ok := bySubject[hit.SubjectID]; ok {
			result[at].Segments = appendUniqueSegment(result[at].Segments, projected)
			continue
		}
		bySubject[hit.SubjectID] = len(result)
		result = append(result, Hit{SubjectID: hit.SubjectID, Segments: []SegmentRef{projected}})
	}
	querySucceeded = true
	return result, nil
}

// ImageSubjectCoverage validates the admitted image generation and returns
// only subject IDs proven by its receipt/backend coverage.
func (idx *Indexer) ImageSubjectCoverage(ctx context.Context, workspaceID string) (map[string]struct{}, error) {
	if !idx.imageBindingActive() {
		return nil, ErrUnavailable
	}
	generation, err := idx.Store.LatestIndexGeneration(ctx, workspaceID, DimensionMultimodal)
	if err != nil {
		return nil, err
	}
	if !generationBindingMatches(idx, generation, DimensionMultimodal) {
		return nil, ErrUnavailable
	}
	if err := idx.ensureImageGenerationVerified(ctx, generation); err != nil {
		return nil, err
	}
	identities, _, _, err := readImageGenerationReceipt(generation)
	if err != nil {
		return nil, err
	}
	out := map[string]struct{}{}
	for _, identity := range identities {
		if identity.SubjectID != "" {
			out[identity.SubjectID] = struct{}{}
		}
	}
	if len(out) == 0 {
		return nil, errors.New("image generation has no subject coverage")
	}
	return out, nil
}

// ImageIndexState reports the honest state of the image dimension for one
// workspace. A missing artifact is NOT_BUILT; an installed but unrunnable
// artifact is UNAVAILABLE with its reason; only a verified generation is READY.
func (idx *Indexer) ImageIndexState(ctx context.Context, workspaceID string) ImageIndexState {
	state := ImageIndexState{
		Dimension: DimensionMultimodal, Provider: ProviderMultimodalONNX, State: ImageProviderNotBuilt,
		Reason: MultimodalIndexNotBuiltReason, Notes: "no image model artifact or binding is installed",
	}
	if idx == nil || idx.Store == nil {
		state.State = ImageProviderUnavailable
		state.Reason = MultimodalIndexUnavailableReason
		state.Notes = "search indexer is not configured"
		return state
	}
	if !idx.imageBindingActive() {
		if idx.MultimodalManifest != (EmbeddingGenerationManifest{}) &&
			idx.MultimodalManifest.SemanticSpace != MultimodalFixtureProfileV1 {
			state.Provider = ProviderMultimodalONNX
		}
		if idx.EnableFixtureDimensions {
			// A fixture binding is never a production capability and must not
			// masquerade as a partial image model install.
			state.Notes = "fixture multimodal projections are qualification-only and are not an image model"
		}
		return state
	}
	providerReport := idx.imageProviderReport()
	if providerReport.Artifact != "" {
		state.Artifact = providerReport.Artifact
	}
	state.ProviderDigest = providerReport.ProviderDigest
	if fingerprint := idx.imageFingerprint(); fingerprint.Validate() == nil {
		state.SpaceFingerprint = fingerprint.CanonicalDigest()
	}
	state.Provider = ProviderMultimodalONNX
	if providerReport.State != ImageProviderReady {
		state.State = ImageProviderUnavailable
		state.Reason = strings.TrimSpace(providerReport.Reason)
		if state.Reason == "" {
			state.Reason = MultimodalIndexUnavailableReason
		}
		state.Notes = "image model artifact is installed but the provider is not runnable"
		return state
	}
	generation, err := idx.Store.LatestIndexGeneration(ctx, workspaceID, DimensionMultimodal)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			state.State = ImageProviderNotBuilt
			state.Reason = MultimodalIndexNotBuiltReason
			state.Notes = "image provider is ready but no image generation has been built for this workspace"
			return state
		}
		state.State = ImageProviderUnavailable
		state.Reason = MultimodalIndexUnavailableReason
		state.Notes = err.Error()
		return state
	}
	if !generationBindingMatches(idx, generation, DimensionMultimodal) {
		state.State = ImageProviderUnavailable
		state.Reason = MultimodalSpaceMismatchReason
		state.Notes = "latest image generation was produced under a different space or provider digest"
		return state
	}
	if err := idx.ensureImageGenerationVerified(ctx, generation); err != nil {
		state.State = ImageProviderUnavailable
		state.Reason = MultimodalIndexUnavailableReason
		state.Notes = err.Error()
		return state
	}
	if failure := idx.ImageFailure(); failure != "" {
		state.State = ImageProviderUnavailable
		state.Reason = MultimodalIndexUnavailableReason
		state.Notes = failure
		return state
	}
	identities, _, _, err := readImageGenerationReceipt(generation)
	if err != nil {
		state.State = ImageProviderUnavailable
		state.Reason = MultimodalIndexUnavailableReason
		state.Notes = err.Error()
		return state
	}
	if report := idx.imageReportSnapshot(); report.Indexed > 0 || report.Skipped > 0 {
		state.Indexed = report.Indexed
		state.Skipped = report.Skipped
		state.SkipReasons = report.SkipReasons
	} else {
		state.Indexed = len(identities)
	}
	state.GenerationID = generation.ID
	state.State = ImageProviderReady
	state.Reason = ""
	state.Notes = "disposable image-space generation over admitted image content; never recovery authority"
	return state
}

// SortImageSkipReasons returns the skip reasons in stable order for reports.
func SortImageSkipReasons(reasons map[string]int) []string {
	out := make([]string, 0, len(reasons))
	for reason := range reasons {
		out = append(out, reason)
	}
	sort.Strings(out)
	return out
}
