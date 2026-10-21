package exact

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

type recoveryProjectionRoot struct {
	publication            committedPublication
	bundle                 portableFactBundle
	headDigest             string
	recordDigest           string
	processorAttemptDigest string
}

type recoveryProjectionParent struct {
	publication  committedPublication
	workspaceID  string
	rootID       string
	headDigest   string
	recordDigest string
	subjects     map[string]struct{}
	annotations  map[string]map[string]recoveryProjectionFactState
	descriptions map[string]map[string]recoveryProjectionFactState
	protections  map[string]sqlite.ProtectionRecord
}

type recoveryProjectionFactState struct {
	revision int64
	payload  []byte
}

type recoveryProjectionProtectionProvenance struct {
	Origin                string `json:"origin"`
	PublicationDomain     string `json:"publication_domain"`
	TrustAnchorDigest     string `json:"trust_anchor_digest"`
	PublicationGeneration uint64 `json:"publication_generation"`
	SnapshotRef           string `json:"snapshot_ref"`
	CommitDigest          string `json:"commit_digest"`
	ManifestDigest        string `json:"manifest_digest"`
	NamespaceRootID       string `json:"namespace_root_id"`
}

type externalRecoveryRecipeV1 struct {
	Schema        string `json:"schema"`
	BindingDigest string `json:"binding_digest"`
	ContentID     string `json:"content_id"`
	LogicalLength int64  `json:"logical_length"`
	RelativePath  string `json:"relative_path"`
	Locators      []struct {
		Kind     string `json:"kind"`
		Locator  string `json:"locator"`
		Priority int64  `json:"priority"`
	} `json:"locators"`
	AcquireIsolated bool `json:"acquire_isolated"`
	VerifyBeforeUse bool `json:"verify_before_use"`
}

func shouldProjectRecoveryCatalog(ctx context.Context, store *sqlite.Store, snapshotRef, factHealth string) (bool, error) {
	if store == nil || factHealth != RecoveryFactHealthComplete {
		return false, nil
	}
	root, err := store.GetNamespaceRootBySnapshotRef(ctx, snapshotRef)
	if errors.Is(err, sqlite.ErrNotFound) {
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("inspect existing namespace root before recovery projection: %w", err)
	}
	var marker struct {
		Origin string `json:"origin"`
	}
	if err := json.Unmarshal(root.Metadata, &marker); err != nil {
		return false, err
	}
	return marker.Origin == "SIGNED_RECOVERY_PROJECTION", nil
}

// reconstructRecoveryCatalog projects only the parent explicitly selected by
// the input artifact. Other authenticated parents in the domain are validated
// for lineage and current-fact conflicts, but are never implicitly imported.
func (s *Service) reconstructRecoveryCatalog(ctx context.Context, anchor TrustAnchor, domain, selectedCommit, selectedHead string) (created bool, retErr error) {
	if s == nil || s.Store == nil || s.Repo == nil {
		return false, errors.New("store-backed recovery catalog reconstruction requires a catalog and repository")
	}
	driver, err := s.publicationRecordDriver()
	if err != nil {
		return false, err
	}
	reader := &Service{Repo: s.Repo, Store: s.Store, TrustAnchor: &anchor, PublicationDomain: domain, RequireSignedPublication: true, PublicationFencer: s.PublicationFencer, Now: s.Now}
	publications, err := reader.committedPublications(ctx)
	if err != nil {
		return false, fmt.Errorf("discover authenticated publications for catalog reconstruction: %w", err)
	}
	parents := make([]recoveryProjectionParent, 0, len(publications))
	var selected recoveryProjectionRoot
	selectedFound := false
	workspaceID := ""
	for _, publication := range publications {
		var last PortableFactClosureEnvelope
		var lastRecordDigest string
		var closureCount int
		err := visitPortableFactClosures(ctx, s.Repo, driver, anchor, domain, publication.CommitDigest, func(envelope PortableFactClosureEnvelope, recordDigest string) error {
			last = envelope
			lastRecordDigest = recordDigest
			closureCount++
			return nil
		})
		if err != nil {
			return false, fmt.Errorf("validate portable facts for publication %s: %w", publication.CommitDigest, err)
		}
		if closureCount == 0 {
			return false, fmt.Errorf("cannot reconstruct fresh catalog: publication %s has no complete portable subject mapping", publication.CommitDigest)
		}
		bundle, err := validatePortableFactBundle(last.Bundle, last.Closure.WorkspaceID, last.Closure.SnapshotRef)
		if err != nil {
			return false, fmt.Errorf("decode current portable fact bundle for publication %s: %w", publication.CommitDigest, err)
		}
		if err := validatePortableFactRecords(bundle); err != nil {
			return false, fmt.Errorf("validate current portable facts for publication %s: %w", publication.CommitDigest, err)
		}
		if err := validatePortableFactRecordsAgainstManifestOnly(bundle, publication.Manifest); err != nil {
			return false, fmt.Errorf("bind current portable facts to publication %s: %w", publication.CommitDigest, err)
		}
		if workspaceID == "" {
			workspaceID = bundle.WorkspaceID
		} else if workspaceID != bundle.WorkspaceID {
			return false, errors.New("authenticated publication set spans multiple workspaces; refusing partial catalog reconstruction")
		}
		headDigest, err := last.Closure.Digest()
		if err != nil {
			return false, err
		}
		placedBytes, err := CanonicalJSON(placedFactEnvelope(last))
		if err != nil {
			return false, err
		}
		recordDigest := DigestBytes(placedBytes)
		if recordDigest != lastRecordDigest {
			return false, errors.New("portable visitor record digest differs from reconstructed placed envelope")
		}
		parent, err := summarizeRecoveryProjectionParent(publication, bundle, headDigest, recordDigest, anchor, domain)
		if err != nil {
			return false, err
		}
		parents = append(parents, parent)
		if publication.CommitDigest == selectedCommit {
			selectedFound = true
			if recordDigest != selectedHead {
				return false, errors.New("selected recovery reference is stale: current authenticated fact head differs from its frozen prefix")
			}
			selected = recoveryProjectionRoot{publication: publication, bundle: bundle, headDigest: headDigest, recordDigest: recordDigest, processorAttemptDigest: last.Closure.ProcessorAttemptDigest}
		}
	}
	sort.Slice(parents, func(i, j int) bool {
		if parents[i].publication.Commit.Generation != parents[j].publication.Commit.Generation {
			return parents[i].publication.Commit.Generation < parents[j].publication.Commit.Generation
		}
		return parents[i].publication.CommitDigest < parents[j].publication.CommitDigest
	})
	if !selectedFound {
		return false, errors.New("selected recovery publication is absent from the authenticated repository lineage")
	}
	if err := validateRecoveryProjectionFactAgreement(parents); err != nil {
		return false, err
	}
	projection, err := buildRecoveryCatalogProjection(ctx, reader, anchor, domain, selected)
	if err != nil {
		return false, fmt.Errorf("prepare selected catalog projection for snapshot %s: %w", selected.publication.Commit.SnapshotRef, err)
	}

	// Serialize reconstruction with existing publication writers. The portable
	// lease is repository-scoped; re-reading the commit set and each fact head
	// under it prevents a valid suffix or new parent from racing the projection.
	s.publicationMu.Lock()
	defer s.publicationMu.Unlock()
	lease, err := reader.acquirePublicationFence(ctx)
	if err != nil {
		return false, fmt.Errorf("acquire publication fence for catalog reconstruction: %w", err)
	}
	defer func() {
		if releaseErr := lease.release(); releaseErr != nil {
			retErr = errors.Join(retErr, fmt.Errorf("%w: %w: release catalog reconstruction publication lease: %v", ErrNeedsReconciliation, ErrPublicationLeaseRelease, releaseErr))
		}
	}()
	fencedCtx := lease.context()
	latest, err := reader.committedPublications(fencedCtx)
	if err != nil {
		return false, fmt.Errorf("recheck authenticated publications under fence: %w", err)
	}
	if !sameRecoveryProjectionParentSet(parents, latest) {
		return false, errors.New("authenticated publication parent set changed during fresh catalog reconstruction")
	}
	for _, expected := range parents {
		var currentRecordDigest, currentClosureDigest string
		var count int
		err := visitPortableFactClosures(fencedCtx, s.Repo, driver, anchor, domain, expected.publication.CommitDigest, func(envelope PortableFactClosureEnvelope, recordDigest string) error {
			currentRecordDigest = recordDigest
			currentClosureDigest, err = envelope.Closure.Digest()
			if err != nil {
				return err
			}
			count++
			return nil
		})
		if err != nil || count == 0 {
			if err == nil {
				err = errors.New("current portable fact head is unavailable")
			}
			return false, fmt.Errorf("recheck portable fact head under fence: %w", err)
		}
		if currentRecordDigest != expected.recordDigest || currentClosureDigest != expected.headDigest {
			return false, errors.New("authenticated portable fact head changed during fresh catalog reconstruction")
		}
	}
	if err := lease.keepaliveError(); err != nil {
		return false, fmt.Errorf("publication fence became unavailable before catalog projection: %w", err)
	}
	if err := fencedCtx.Err(); err != nil {
		return false, err
	}
	if err := reader.validatePublicationFence(fencedCtx, lease); err != nil {
		return false, fmt.Errorf("%w: validate publication fence before catalog projection: %v", ErrNeedsReconciliation, err)
	}
	_, rootErr := s.Store.GetNamespaceRootBySnapshotRef(fencedCtx, projection.Root.SnapshotRef)
	newRoot := errors.Is(rootErr, sqlite.ErrNotFound)
	if rootErr != nil && !newRoot {
		return false, fmt.Errorf("inspect target namespace root before recovery projection: %w", rootErr)
	}
	if err := validateExistingRecoveryProjectionProtection(fencedCtx, s.Store, projection, parents, domain, anchor); err != nil {
		return false, err
	}
	if err := s.Store.RestoreRecoveryCatalogProjection(fencedCtx, projection); err != nil {
		return false, fmt.Errorf("restore selected authenticated root %s into operational catalog: %w", projection.Root.SnapshotRef, err)
	}
	created = newRoot
	if err := lease.keepaliveError(); err != nil {
		return created, fmt.Errorf("%w: publication fence renewal failed after catalog projection: %v", ErrNeedsReconciliation, err)
	}
	return created, nil
}

func validateExistingRecoveryProjectionProtection(ctx context.Context, store *sqlite.Store, incoming sqlite.RecoveryCatalogProjection, parents []recoveryProjectionParent, domain string, anchor TrustAnchor) error {
	anchorDigest, err := DigestCanonicalJSON(anchor)
	if err != nil {
		return err
	}
	for _, candidate := range incoming.Protections {
		current, err := store.GetProtectionRecordBySubject(ctx, candidate.WorkspaceID, candidate.SubjectRef)
		if errors.Is(err, sqlite.ErrNotFound) {
			continue
		}
		if err != nil {
			return fmt.Errorf("read current protection before recovery projection: %w", err)
		}
		var provenance recoveryProjectionProtectionProvenance
		if err := json.Unmarshal(current.Metadata, &provenance); err != nil || provenance.Origin != "SIGNED_RECOVERY_PROJECTION" || provenance.PublicationDomain != domain || provenance.TrustAnchorDigest != anchorDigest || provenance.CommitDigest == "" {
			return errors.New("existing protection projection lacks a verifiable signed publication source")
		}
		var source *recoveryProjectionParent
		for index := range parents {
			if parents[index].publication.CommitDigest == provenance.CommitDigest {
				source = &parents[index]
				break
			}
		}
		if source == nil || source.publication.Commit.SnapshotRef != provenance.SnapshotRef || source.publication.Manifest.ManifestDigest != provenance.ManifestDigest || source.rootID != provenance.NamespaceRootID {
			return errors.New("existing protection projection names a publication outside the authenticated reconstruction set")
		}
		if provenance.PublicationGeneration != source.publication.Commit.Generation {
			return errors.New("existing protection projection generation differs from its authenticated publication")
		}
		expected, ok := source.protections[current.SubjectRef]
		if !ok || current.ID != expected.ID || current.Mode != expected.Mode || current.Outcome != expected.Outcome || current.ExpectedContentID != expected.ExpectedContentID || !equalOptionalLength(current.ExpectedLogicalLength, expected.ExpectedLogicalLength) || current.LocalRepresentationID != expected.LocalRepresentationID || current.PolicyDecisionRef != expected.PolicyDecisionRef || current.LastVerificationRef != expected.LastVerificationRef {
			return fmt.Errorf("existing current protection for subject %q disagrees with its named authenticated publication", current.SubjectRef)
		}
	}
	return nil
}

func equalOptionalLength(left, right *int64) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func sameRecoveryProjectionParentSet(expected []recoveryProjectionParent, actual []committedPublication) bool {
	if len(expected) != len(actual) {
		return false
	}
	byDigest := make(map[string]struct{}, len(expected))
	for _, parent := range expected {
		byDigest[parent.publication.CommitDigest] = struct{}{}
	}
	for _, publication := range actual {
		if _, ok := byDigest[publication.CommitDigest]; !ok {
			return false
		}
	}
	return true
}

// summarizeRecoveryProjectionParent retains only current metadata heads and
// the authenticated protection values needed to compare parents. The bundle
// body is released after this summary unless this is the explicitly selected
// parent.
func summarizeRecoveryProjectionParent(publication committedPublication, bundle portableFactBundle, headDigest, recordDigest string, anchor TrustAnchor, domain string) (recoveryProjectionParent, error) {
	parent := recoveryProjectionParent{publication: publication, workspaceID: bundle.WorkspaceID, headDigest: headDigest, recordDigest: recordDigest, subjects: map[string]struct{}{}, annotations: map[string]map[string]recoveryProjectionFactState{}, descriptions: map[string]map[string]recoveryProjectionFactState{}, protections: map[string]sqlite.ProtectionRecord{}}
	anchorDigest, err := DigestCanonicalJSON(anchor)
	if err != nil {
		return parent, err
	}
	var descriptionRecords = map[string]descriptionPortablePayload{}
	for _, record := range bundle.Records {
		switch record.RecordKind {
		case "SUBJECT_MAPPING":
			var mapping subjectMappingPayload
			if err := decodeStrictRecord(record.Payload, &mapping); err != nil {
				return parent, err
			}
			parent.subjects[mapping.StableSubjectRef] = struct{}{}
			if parent.rootID == "" {
				parent.rootID = mapping.NamespaceRootID
			} else if parent.rootID != mapping.NamespaceRootID {
				return parent, errors.New("parent summary spans multiple signed namespace roots")
			}
			provenance, err := json.Marshal(recoveryProjectionProtectionProvenance{Origin: "SIGNED_RECOVERY_PROJECTION", PublicationDomain: domain, TrustAnchorDigest: anchorDigest, PublicationGeneration: publication.Commit.Generation, SnapshotRef: publication.Commit.SnapshotRef, CommitDigest: publication.CommitDigest, ManifestDigest: publication.Manifest.ManifestDigest, NamespaceRootID: mapping.NamespaceRootID})
			if err != nil {
				return parent, err
			}
			p := mapping.Protection
			verificationRef, err := signedProtectionVerificationReference(p)
			if err != nil {
				return parent, fmt.Errorf("authenticated protection for subject %q: %w", mapping.StableSubjectRef, err)
			}
			parent.protections[mapping.StableSubjectRef] = sqlite.ProtectionRecord{ID: p.RecordID, WorkspaceID: bundle.WorkspaceID, SubjectRef: mapping.StableSubjectRef, Mode: sqlite.ProtectionMode(p.Mode), Outcome: sqlite.ProtectionOutcome(p.Outcome), ExpectedContentID: p.ExpectedContentID, ExpectedLogicalLength: p.ExpectedLogicalLength, LocalRepresentationID: p.LocalRepresentationID, PolicyDecisionRef: "signed-manifest:" + publication.CommitDigest, LastVerificationRef: verificationRef, Metadata: provenance}
		case "ANNOTATION_REVISION":
			facts := parent.annotations[record.StableSubjectRef]
			if facts == nil {
				facts = map[string]recoveryProjectionFactState{}
				parent.annotations[record.StableSubjectRef] = facts
			}
			state := recoveryProjectionFactState{revision: record.Revision, payload: append([]byte(nil), record.Payload...)}
			if prior, ok := facts[record.RecordID]; !ok || state.revision > prior.revision {
				facts[record.RecordID] = state
			} else if state.revision == prior.revision && !bytes.Equal(state.payload, prior.payload) {
				return parent, fmt.Errorf("authenticated annotation history %q has conflicting revision %d", record.RecordID, state.revision)
			}
		case "DESCRIPTION_REVISION":
			var value descriptionPortablePayload
			if err := decodeStrictRecord(record.Payload, &value); err != nil {
				return parent, fmt.Errorf("decode authenticated description %q: %w", record.RecordID, err)
			}
			descriptionRecords[value.ID] = value
		case "METADATA_FACT":
			if portableCaptureFactRecord(record) {
				continue
			}
			if isCatalogRelationWitnessRecord(record) {
				continue // Catalog relations are snapshot-scoped, not current user metadata.
			}
			key := "metadata\x00" + record.StableSubjectRef + "\x00" + record.RecordID
			if parent.annotations[record.StableSubjectRef] == nil {
				parent.annotations[record.StableSubjectRef] = map[string]recoveryProjectionFactState{}
			}
			if prior, ok := parent.annotations[record.StableSubjectRef][key]; ok && (prior.revision != record.Revision || !bytes.Equal(prior.payload, record.Payload)) {
				return parent, fmt.Errorf("authenticated metadata fact %q is conflicting", record.RecordID)
			}
			parent.annotations[record.StableSubjectRef][key] = recoveryProjectionFactState{revision: record.Revision, payload: append([]byte(nil), record.Payload...)}
		}
	}
	for _, value := range descriptionRecords {
		chainRoot, err := descriptionChainRoot(value, descriptionRecords)
		if err != nil {
			return parent, err
		}
		facts := parent.descriptions[value.SubjectRef]
		if facts == nil {
			facts = map[string]recoveryProjectionFactState{}
			parent.descriptions[value.SubjectRef] = facts
		}
		payload, err := CanonicalJSON(value)
		if err != nil {
			return parent, err
		}
		state := recoveryProjectionFactState{revision: value.Revision, payload: payload}
		if prior, ok := facts[chainRoot]; !ok || state.revision > prior.revision {
			facts[chainRoot] = state
		} else if state.revision == prior.revision && !bytes.Equal(state.payload, prior.payload) {
			return parent, fmt.Errorf("authenticated description chain %q has conflicting revision %d", chainRoot, state.revision)
		}
	}
	for subject := range parent.subjects {
		if parent.annotations[subject] == nil {
			parent.annotations[subject] = map[string]recoveryProjectionFactState{}
		}
		if parent.descriptions[subject] == nil {
			parent.descriptions[subject] = map[string]recoveryProjectionFactState{}
		}
	}
	return parent, nil
}

func validateRecoveryProjectionFactAgreement(parents []recoveryProjectionParent) error {
	for left := 0; left < len(parents); left++ {
		for right := left + 1; right < len(parents); right++ {
			for subject := range parents[left].subjects {
				if _, shared := parents[right].subjects[subject]; !shared {
					continue
				}
				if err := compareFactStateMaps("annotation", subject, parents[left].annotations[subject], parents[right].annotations[subject]); err != nil {
					return err
				}
				if err := compareFactStateMaps("description", subject, parents[left].descriptions[subject], parents[right].descriptions[subject]); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func compareFactStateMaps(kind, subject string, expected, actual map[string]recoveryProjectionFactState) error {
	for key, state := range expected {
		other, ok := actual[key]
		if !ok || state.revision != other.revision || !bytes.Equal(state.payload, other.payload) {
			return fmt.Errorf("authenticated retained parents disagree on current %s state for subject %q; refusing stale writable reconstruction", kind, subject)
		}
	}
	for key, state := range actual {
		other, ok := expected[key]
		if !ok || state.revision != other.revision || !bytes.Equal(state.payload, other.payload) {
			return fmt.Errorf("authenticated retained parents disagree on current %s state for subject %q; refusing stale writable reconstruction", kind, subject)
		}
	}
	return nil
}

func signedProtectionVerificationReference(value ManifestProtection) (string, error) {
	mode, outcome := sqlite.ProtectionMode(value.Mode), sqlite.ProtectionOutcome(value.Outcome)
	if (mode != sqlite.ProtectionStoreExact && mode != sqlite.ProtectionStoreExactWithExternalFallback) || (outcome != sqlite.ProtectionExactProtected && outcome != sqlite.ProtectionExactFallback) {
		return "", nil
	}
	for _, reference := range value.RecoveryReferences {
		if reference.Kind == string(sqlite.RecoveryExactRepresentation) && reference.ReferenceID != "" && len(reference.Verification) > 0 {
			return "signed-recovery-reference:" + reference.ReferenceID, nil
		}
	}
	return "", errors.New("signed exact protection lacks its portable verification reference")
}

func externalBindingDigestFromRecoveryReference(reference ManifestRecoveryReference, contentID string, logicalLength *int64) (string, error) {
	if reference.Kind != string(sqlite.RecoveryExternalLocator) || reference.ExternalBindingID == "" || len(reference.Recipe) == 0 || logicalLength == nil {
		return "", errors.New("external recovery reference lacks its authenticated binding recipe")
	}
	var recipe externalRecoveryRecipeV1
	if err := decodeStrictRecord(reference.Recipe, &recipe); err != nil {
		return "", fmt.Errorf("decode external recovery recipe: %w", err)
	}
	if recipe.Schema != "org.cairn.external-recovery-recipe.v1" || !validExactContentID(recipe.BindingDigest) || recipe.ContentID != contentID || recipe.LogicalLength != *logicalLength || strings.TrimSpace(recipe.RelativePath) == "" || !recipe.AcquireIsolated || !recipe.VerifyBeforeUse || len(recipe.Locators) == 0 || len(recipe.Locators) != len(reference.ExternalLocators) {
		return "", errors.New("external recovery recipe is not bound to the signed content and locator set")
	}
	for index, locator := range recipe.Locators {
		portable := reference.ExternalLocators[index]
		if locator.Kind != portable.Kind || locator.Locator != portable.Locator || locator.Priority != portable.Priority || portable.ExpectedContentID != contentID || portable.ExpectedLogicalLength != *logicalLength {
			return "", errors.New("external recovery recipe locators differ from the authenticated manifest references")
		}
	}
	return recipe.BindingDigest, nil
}

func descriptionChainRoot(value descriptionPortablePayload, descriptions map[string]descriptionPortablePayload) (string, error) {
	seen := map[string]struct{}{}
	current := value
	for current.PredecessorID != "" {
		if _, ok := seen[current.ID]; ok {
			return "", fmt.Errorf("description successor chain for %q contains a cycle", value.ID)
		}
		seen[current.ID] = struct{}{}
		predecessor, ok := descriptions[current.PredecessorID]
		if !ok || predecessor.SubjectRef != value.SubjectRef {
			return "", fmt.Errorf("description successor chain for %q has a missing or cross-subject predecessor", value.ID)
		}
		current = predecessor
	}
	return current.ID, nil
}

func buildRecoveryCatalogProjection(ctx context.Context, reader *Service, anchor TrustAnchor, domain string, root recoveryProjectionRoot) (sqlite.RecoveryCatalogProjection, error) {
	manifest, commit := root.publication.Manifest, root.publication.Commit
	if root.bundle.WorkspaceID == "" || manifest.SnapshotRef != commit.SnapshotRef || manifest.ManifestDigest != commit.ManifestDigest {
		return sqlite.RecoveryCatalogProjection{}, errors.New("recovery projection publication identity is incomplete")
	}
	anchorDigest, err := DigestCanonicalJSON(anchor)
	if err != nil {
		return sqlite.RecoveryCatalogProjection{}, err
	}
	when := commit.SignedAt.UTC()
	if when.IsZero() {
		return sqlite.RecoveryCatalogProjection{}, errors.New("signed publication time is missing")
	}
	marker := map[string]any{
		"origin":                    "SIGNED_RECOVERY_PROJECTION",
		"publication_domain":        domain,
		"trust_anchor_digest":       anchorDigest,
		"projection_time_semantics": "signed-commit-time-used-for-unavailable-operational-timestamps",
	}
	marked := func(extra map[string]any) (json.RawMessage, error) {
		value := make(map[string]any, len(marker)+len(extra))
		for key, item := range marker {
			value[key] = item
		}
		for key, item := range extra {
			value[key] = item
		}
		return json.Marshal(value)
	}

	mappingsByPath := make(map[string]subjectMappingPayload)
	mappingsBySubject := make(map[string]subjectMappingPayload)
	for _, record := range root.bundle.Records {
		if record.RecordKind != "SUBJECT_MAPPING" {
			continue
		}
		var mapping subjectMappingPayload
		if err := decodeStrictRecord(record.Payload, &mapping); err != nil {
			return sqlite.RecoveryCatalogProjection{}, err
		}
		if mapping.StableSubjectRef == "" || mapping.StableSubjectRef != record.StableSubjectRef || mapping.WorkspaceID != root.bundle.WorkspaceID || mapping.NamespaceRootID == "" || mapping.SourceID == "" {
			return sqlite.RecoveryCatalogProjection{}, errors.New("catalog reconstruction requires complete stable-subject mappings")
		}
		pathKey := portableRawPathKey(mapping.RawPath)
		if _, ok := mappingsByPath[pathKey]; ok {
			return sqlite.RecoveryCatalogProjection{}, errors.New("duplicate subject mapping path in recovery projection")
		}
		mappingsByPath[pathKey] = mapping
		mappingsBySubject[mapping.StableSubjectRef] = mapping
	}
	if len(mappingsByPath) == 0 {
		return sqlite.RecoveryCatalogProjection{}, errors.New("portable fact closure has no stable subject mappings")
	}
	var sourceID, namespaceRootID string
	for _, mapping := range mappingsByPath {
		if sourceID == "" {
			sourceID, namespaceRootID = mapping.SourceID, mapping.NamespaceRootID
		} else if sourceID != mapping.SourceID || namespaceRootID != mapping.NamespaceRootID {
			return sqlite.RecoveryCatalogProjection{}, errors.New("portable subject mappings cross source or namespace-root boundaries")
		}
	}
	manifestByPath := make(map[string]ManifestEntry, len(manifest.Entries))
	for _, entry := range manifest.Entries {
		manifestByPath[portableRawPathKey(entry.RawPath)] = entry
	}
	for pathKey := range mappingsByPath {
		if _, ok := manifestByPath[pathKey]; !ok {
			return sqlite.RecoveryCatalogProjection{}, fmt.Errorf("portable mapping path %q is not present in signed manifest", pathKey)
		}
	}

	projection := sqlite.RecoveryCatalogProjection{}
	projection.Workspace = sqlite.Workspace{ID: root.bundle.WorkspaceID, Name: "Recovered content", Metadata: mustMarked(marker), Revision: 1, CreatedAt: when, UpdatedAt: when}
	projection.Source = sqlite.Source{ID: sourceID, WorkspaceID: root.bundle.WorkspaceID, StableKey: "cairn-recovery:" + sourceID, Kind: "RECOVERY_PUBLICATION", Locator: "cairn-recovery:" + sourceID, State: sqlite.SourceLost, Metadata: mustMarked(marker), Revision: 1, CreatedAt: when, UpdatedAt: when}
	projection.Scan = sqlite.ScanGeneration{ID: recoveryProjectionID(sqlite.IDPrefixScanGeneration, domain, commit.SnapshotRef, "scan"), WorkspaceID: root.bundle.WorkspaceID, SourceID: sourceID, Generation: int64(commit.Generation), State: sqlite.ScanIncomplete, FullTraversal: false, StartedAt: when, FinishedAt: timePointer(when)}
	projection.Binding = sqlite.CaptureRootBinding{ID: recoveryProjectionID(sqlite.IDPrefixCaptureBinding, domain, commit.SnapshotRef, "binding"), WorkspaceID: root.bundle.WorkspaceID, SourceID: sourceID, ScanGenerationID: projection.Scan.ID, CaptureMode: string(manifest.Binding.CaptureMode), Profile: manifest.Binding.Profile, DisplayPath: manifest.Binding.DisplayPath, DeviceID: manifest.Binding.DeviceID, Inode: manifest.Binding.Inode, ConsistencyClaim: manifest.Binding.ConsistencyClaim, IdentityDigest: manifest.Binding.IdentityDigest(), BoundAt: manifest.Binding.BoundAt.UTC()}
	bindingRecord, err := marked(map[string]any{"signed_binding": manifest.Binding})
	if err != nil {
		return sqlite.RecoveryCatalogProjection{}, err
	}
	projection.Binding.Record = bindingRecord
	projection.Scan.CaptureSetID = projection.Binding.ID
	projection.Scan.CaptureSetDigest = projection.Binding.IdentityDigest
	projection.Scan.Summary, err = marked(map[string]any{"commit_digest": root.publication.CommitDigest, "snapshot_ref": commit.SnapshotRef, "manifest_digest": commit.ManifestDigest, "fact_head_digest": root.headDigest, "local_projection": true, "scan_history": "not-reconstructed"})
	if err != nil {
		return sqlite.RecoveryCatalogProjection{}, err
	}
	rootMetadata, err := marked(map[string]any{"commit_digest": root.publication.CommitDigest, "manifest_digest": commit.ManifestDigest, "fact_head_digest": root.headDigest})
	if err != nil {
		return sqlite.RecoveryCatalogProjection{}, err
	}
	projection.Root = sqlite.NamespaceRoot{ID: namespaceRootID, WorkspaceID: root.bundle.WorkspaceID, SourceID: sourceID, ScanGenerationID: projection.Scan.ID, SnapshotRef: commit.SnapshotRef, Name: "Recovered content", RootPathKey: []byte{}, FilesystemSemantics: "posix", AuthorityDigest: manifest.Binding.IdentityDigest(), Metadata: rootMetadata, CreatedAt: when}
	publicationMetadata, err := marked(map[string]any{"commit_digest": root.publication.CommitDigest, "manifest_digest": commit.ManifestDigest, "fact_head_digest": root.headDigest, "publication_generation": commit.Generation})
	if err != nil {
		return sqlite.RecoveryCatalogProjection{}, err
	}
	projection.Publication = sqlite.Publication{ID: commit.PublicationID, WorkspaceID: root.bundle.WorkspaceID, PlanDigest: commit.PlanDigest, SnapshotRef: commit.SnapshotRef, ScanGenerationID: projection.Scan.ID, BindingID: projection.Binding.ID, NamespaceRootID: namespaceRootID, ManifestDigest: commit.ManifestDigest, CommittedAt: when, Metadata: publicationMetadata}

	if err := appendRecoveryProjectionFacts(ctx, reader, root, marker, &projection, mappingsBySubject); err != nil {
		return sqlite.RecoveryCatalogProjection{}, err
	}
	if err := appendRecoveryProjectionNamespace(ctx, reader, root, marker, &projection, mappingsByPath, manifestByPath); err != nil {
		return sqlite.RecoveryCatalogProjection{}, err
	}
	return projection, nil
}

func appendRecoveryProjectionFacts(ctx context.Context, reader *Service, root recoveryProjectionRoot, marker map[string]any, projection *sqlite.RecoveryCatalogProjection, mappings map[string]subjectMappingPayload) error {
	attachments := make(map[string]portableFactAttachment)
	for _, attachment := range root.bundle.Attachments {
		attachments[attachment.AttachmentID] = attachment
	}
	annotationRevisions := map[string][]sqlite.AnnotationRevision{}
	for _, record := range root.bundle.Records {
		switch record.RecordKind {
		case "METADATA_FACT":
			if portableCaptureFactRecord(record) {
				// Capture evidence is snapshot-specific. Keep the authenticated
				// payload on its namespace projection rather than flattening it into
				// SQLite's one-current-value MetadataFact key space.
				continue
			}
			if isCatalogRelationWitnessRecord(record) {
				// The signed witness stays in recovery authority and must not enter
				// SQLite's one-current-value MetadataFact key space.
				continue
			}
			var value sqlite.MetadataFact
			if err := decodeStrictRecord(record.Payload, &value); err != nil {
				return err
			}
			if value.SubjectRef != record.StableSubjectRef || value.WorkspaceID != root.bundle.WorkspaceID {
				return errors.New("durable metadata fact scope differs from its authenticated outer record")
			}
			projection.MetadataFacts = append(projection.MetadataFacts, value)
		case "ANNOTATION_REVISION":
			var value sqlite.AnnotationRevision
			if err := decodeStrictRecord(record.Payload, &value); err != nil {
				return err
			}
			if value.SubjectRef != record.StableSubjectRef || value.WorkspaceID != root.bundle.WorkspaceID {
				return errors.New("annotation revision has inconsistent authenticated subject scope")
			}
			annotationRevisions[value.AnnotationID] = append(annotationRevisions[value.AnnotationID], value)
		case "DESCRIPTION_REVISION":
			var value descriptionPortablePayload
			if err := decodeStrictRecord(record.Payload, &value); err != nil {
				return err
			}
			attachment, ok := attachments[value.BodyAttachmentID]
			if !ok {
				return fmt.Errorf("description %s has no authenticated body attachment", value.ID)
			}
			body, err := readRecoveryAttachment(ctx, reader.Repo, attachment)
			if err != nil {
				return fmt.Errorf("read description body %s: %w", value.ID, err)
			}
			projection.Descriptions = append(projection.Descriptions, sqlite.DescriptionDocument{ID: value.ID, WorkspaceID: value.WorkspaceID, SubjectRef: value.SubjectRef, Kind: value.Kind, Title: value.Title, Language: value.Language, Body: string(body), BodyDigest: value.BodyDigest, SourceRef: value.SourceRef, ProducerProfile: value.ProducerProfile, ConfigDigest: value.ConfigDigest, ProducerProfileDigest: value.ProducerProfileDigest, Confidence: value.Confidence, Coverage: value.Coverage, Visibility: value.Visibility, Accepted: value.Accepted, Revision: value.Revision, PredecessorID: value.PredecessorID, Metadata: value.Metadata, CreatedAt: value.CreatedAt.UTC(), UpdatedAt: value.UpdatedAt.UTC()})
		case "SEMANTIC_SEGMENT":
			var value sqlite.SemanticSegment
			if err := decodeStrictRecord(record.Payload, &value); err != nil {
				return err
			}
			projection.Segments = append(projection.Segments, value)
		case "PROCESSOR_ARTIFACT_DESCRIPTOR":
			var value artifactPortablePayload
			if err := decodeStrictRecord(record.Payload, &value); err != nil {
				return err
			}
			attachment, ok := attachments[value.BodyAttachmentID]
			if !ok {
				return fmt.Errorf("processor artifact %s has no authenticated body attachment", value.ID)
			}
			body, err := readRecoveryAttachment(ctx, reader.Repo, attachment)
			if err != nil {
				return fmt.Errorf("read processor artifact body %s: %w", value.ID, err)
			}
			projection.Artifacts = append(projection.Artifacts, sqlite.ProcessorArtifact{ID: value.ID, WorkspaceID: value.WorkspaceID, SubjectRef: value.SubjectRef, SnapshotRef: value.SnapshotRef, RouteDigest: value.RouteDigest, Stage: value.Stage, CapabilityID: value.CapabilityID, SchemaRef: value.SchemaRef, State: value.State, AuthorityClass: value.AuthorityClass, LifecycleClass: value.LifecycleClass, MediaType: value.MediaType, ByteLength: value.ByteLength, Digest: value.Digest, Body: string(body), AttemptID: value.AttemptID, FenceToken: value.FenceToken, ProducerDigest: value.ProducerDigest, Envelope: value.Envelope, CreatedAt: value.CreatedAt.UTC(), UpdatedAt: value.UpdatedAt.UTC()})
		}
	}
	for _, revisions := range annotationRevisions {
		sort.Slice(revisions, func(i, j int) bool { return revisions[i].Revision < revisions[j].Revision })
		if len(revisions) == 0 || revisions[0].Revision != 1 {
			return errors.New("annotation history does not begin at revision one")
		}
		last := revisions[len(revisions)-1]
		current := sqlite.Annotation{ID: last.AnnotationID, WorkspaceID: last.WorkspaceID, SubjectRef: last.SubjectRef, Kind: last.Kind, Body: last.Body, BodyDigest: last.BodyDigest, Revision: last.Revision, Tombstoned: last.Tombstoned, CreatedAt: revisions[0].CreatedAt.UTC(), UpdatedAt: last.CreatedAt.UTC()}
		if len(revisions) > 1 {
			current.PredecessorRevision = revisions[len(revisions)-2].Revision
		}
		projection.AnnotationHistories = append(projection.AnnotationHistories, sqlite.RecoveryAnnotationHistory{Current: current, Revisions: revisions})
	}
	if len(projection.Artifacts) > 0 || root.processorAttemptDigest != "" {
		entries, err := reader.processorAttemptClosureEntries(ctx, root.publication.Commit.SnapshotRef)
		if err != nil {
			return fmt.Errorf("read authenticated processor attempts: %w", err)
		}
		var selected *processorAttemptClosureEntry
		for index := range entries {
			if entries[index].ObjectDigest == root.processorAttemptDigest && entries[index].Envelope.Closure.ParentCommitDigest == root.publication.CommitDigest {
				candidate := entries[index]
				selected = &candidate
			}
		}
		if selected == nil || root.bundle.WorkspaceID != selected.Bundle.WorkspaceID {
			return errors.New("admitted artifacts have no authenticated terminal processor-attempt bundle")
		}
		for _, attempt := range selected.Bundle.Attempts {
			projection.ProcessorAttempts = append(projection.ProcessorAttempts, sqlite.ProcessorAttempt{ID: attempt.AttemptID, WorkspaceID: attempt.WorkspaceID, SubjectRef: attempt.SubjectRef, SnapshotRef: attempt.SnapshotRef, RouteDigest: attempt.RouteDigest, Route: attempt.Route, Stage: attempt.Stage, CapabilityID: attempt.CapabilityID, Status: attempt.Status, ReasonCode: attempt.ReasonCode, Reason: attempt.Reason, Provenance: attempt.Provenance, FenceToken: attempt.FenceToken, ProcessorDigest: attempt.ProcessorDigest, CreatedAt: attempt.CreatedAt.UTC(), FinishedAt: attempt.FinishedAt.UTC()})
		}
	}
	for _, fact := range projection.MetadataFacts {
		if _, ok := mappings[fact.SubjectRef]; !ok {
			return errors.New("metadata fact subject is absent from authenticated stable mappings")
		}
	}
	_ = marker // marker is retained by the projection's relational headers.
	return nil
}

func appendRecoveryProjectionNamespace(ctx context.Context, reader *Service, root recoveryProjectionRoot, marker map[string]any, projection *sqlite.RecoveryCatalogProjection, mappings map[string]subjectMappingPayload, manifestByPath map[string]ManifestEntry) error {
	when := root.publication.Commit.SignedAt.UTC()
	captureFactsBySubject := map[string][]json.RawMessage{}
	for _, record := range root.bundle.Records {
		if record.RecordKind != "METADATA_FACT" || !portableCaptureFactRecord(record) {
			continue
		}
		var fact ManifestPortableFact
		if err := decodeStrictRecord(record.Payload, &fact); err != nil {
			return fmt.Errorf("decode signed capture fact: %w", err)
		}
		encoded, err := json.Marshal(struct {
			PortableRecordID string               `json:"portable_record_id"`
			Fact             ManifestPortableFact `json:"fact"`
		}{record.RecordID, fact})
		if err != nil {
			return err
		}
		captureFactsBySubject[record.StableSubjectRef] = append(captureFactsBySubject[record.StableSubjectRef], encoded)
	}
	witnessesBySubject := make(map[string]catalogRelationWitness, len(mappings))
	witnessRecords := make(map[string]portableFactRecord)
	for _, record := range root.bundle.Records {
		if !isCatalogRelationWitnessRecord(record) {
			continue
		}
		if _, duplicate := witnessRecords[record.StableSubjectRef]; duplicate {
			return fmt.Errorf("catalog relation witness for subject %q is duplicated", record.StableSubjectRef)
		}
		witnessRecords[record.StableSubjectRef] = record
	}
	for _, mapping := range mappings {
		subject := mapping.StableSubjectRef
		record, found := witnessRecords[subject]
		if mapping.FileVersionID == "" {
			if found {
				return fmt.Errorf("catalog relation witness for subject %q is surplus because its mapping has no file version", subject)
			}
			continue
		}
		if !found {
			return fmt.Errorf("catalog relation witness for mapped file version %q is missing", mapping.FileVersionID)
		}
		witness, err := decodeCatalogRelationWitness(record, root.bundle, mapping)
		if err != nil {
			return fmt.Errorf("catalog relation witness for file version %q: %w", mapping.FileVersionID, err)
		}
		witnessesBySubject[subject] = witness
	}
	if len(witnessRecords) != len(witnessesBySubject) {
		return errors.New("catalog relation bundle contains a witness without exactly one mapped file version")
	}
	representationByID := map[string]sqlite.Representation{}
	for _, witness := range witnessesBySubject {
		for _, representation := range witness.Representations {
			if existing, ok := representationByID[representation.ID]; ok {
				if !reflect.DeepEqual(existing, representation) {
					return fmt.Errorf("catalog relation witnesses disagree on representation %q", representation.ID)
				}
				continue
			}
			representationByID[representation.ID] = representation
			projection.Representations = append(projection.Representations, representation)
		}
	}
	extentByID := map[string]sqlite.ContentExtent{}
	fileVersionByID := map[string]struct{}{}
	protectionBySubject := map[string]sqlite.ProtectionRecord{}
	for pathKey, mapping := range mappings {
		entry, ok := manifestByPath[pathKey]
		if !ok {
			return fmt.Errorf("signed subject path %q has no manifest record", pathKey)
		}
		name := append([]byte(nil), mapping.RawName...)
		if len(name) == 0 {
			return errors.New("signed subject mapping has an empty raw name")
		}
		entryType := sqlite.NamespaceEntryType(mapping.EntryType)
		observationID := recoveryProjectionID(sqlite.IDPrefixObservation, root.bundle.WorkspaceID, root.publication.Commit.SnapshotRef, mapping.NamespaceEntryID)
		var logicalSize *int64
		if mapping.LogicalLength != nil {
			size := *mapping.LogicalLength
			logicalSize = &size
		}
		var allocatedSize *int64
		if entry.AllocatedSize != nil {
			size := *entry.AllocatedSize
			allocatedSize = &size
		}
		observationMetadata, err := json.Marshal(map[string]any{"origin": "SIGNED_RECOVERY_PROJECTION", "metadata_before": mapping.MetadataBefore, "metadata_after": mapping.MetadataAfter, "read_state": entry.ReadState})
		if err != nil {
			return err
		}
		observation := sqlite.Observation{ID: observationID, WorkspaceID: root.bundle.WorkspaceID, SourceID: projection.Source.ID, ScanGenerationID: projection.Scan.ID, PathKey: append([]byte(nil), mapping.RawPath...), RawPath: append([]byte(nil), mapping.RawPath...), DisplayPath: entry.RelativePath, EntryType: entryType, ContentID: mapping.ContentID, FileVersionID: mapping.FileVersionID, LogicalSize: logicalSize, AllocatedSize: allocatedSize, ReadState: "RECOVERED_FROM_SIGNED_MANIFEST", Metadata: observationMetadata, ObservedAt: when}
		projection.Observations = append(projection.Observations, observation)
		parentID := ""
		if mapping.ParentSubjectRef != "" {
			parent, ok := mappingsBySubjectForPath(mappings, mapping.ParentSubjectRef)
			if !ok {
				return fmt.Errorf("parent subject %q is missing from signed mappings", mapping.ParentSubjectRef)
			}
			parentID = parent.NamespaceEntryID
		}
		nsMetadata, err := recoveryNamespaceMetadata(mapping.MetadataBefore, mapping.MetadataAfter, captureFactsBySubject[mapping.StableSubjectRef])
		if err != nil {
			return err
		}
		ns := sqlite.NamespaceEntry{ID: mapping.NamespaceEntryID, SubjectRef: mapping.StableSubjectRef, WorkspaceID: root.bundle.WorkspaceID, RootID: projection.Root.ID, ParentID: parentID, ObservationID: observationID, RawName: name, DisplayName: mapping.DisplayName, FullPathKey: append([]byte(nil), mapping.RawPath...), EntryType: entryType, Metadata: nsMetadata, ContentID: mapping.ContentID, FileVersionID: mapping.FileVersionID, SymlinkTargetRaw: append([]byte(nil), entry.SymlinkTarget...), LogicalSize: logicalSize, AllocatedSize: allocatedSize, CreatedAt: when}
		if entryType != sqlite.EntrySymlink {
			ns.SymlinkTargetRaw = nil
		}
		projection.NamespaceEntries = append(projection.NamespaceEntries, ns)
		protection, err := recoveryProtectionFromManifest(root, mapping, when, projection.Workspace.ID, marker, projection, representationByID)
		if err != nil {
			return err
		}
		protectionBySubject[mapping.StableSubjectRef] = protection
	}
	// Retain the authenticated immutable relation rows. Only the scan-generation
	// and observation handles are local to this reconstructed projection.
	for _, mapping := range mappings {
		if mapping.FileVersionID == "" {
			continue
		}
		if mapping.ContentID == "" || mapping.LogicalLength == nil || !validExactContentID(mapping.ContentID) {
			return errors.New("signed file version lacks exact content identity or logical length")
		}
		protection := protectionBySubject[mapping.StableSubjectRef]
		mustVerifyLocal := (protection.Mode == sqlite.ProtectionStoreExact || protection.Mode == sqlite.ProtectionStoreExactWithExternalFallback) && (protection.Outcome == sqlite.ProtectionExactProtected || protection.Outcome == sqlite.ProtectionExactFallback)
		if mustVerifyLocal {
			if err := verifyExactObjectReadback(ctx, reader.Repo, mapping.ContentID, *mapping.LogicalLength); err != nil {
				return fmt.Errorf("verify file bytes for catalog projection: %w", err)
			}
		}
		witness, ok := witnessesBySubject[mapping.StableSubjectRef]
		if !ok {
			return fmt.Errorf("catalog relation witness for mapped file version %q is unavailable", mapping.FileVersionID)
		}
		fileVersion := witness.FileVersion
		if fileVersion.ScanGenerationID != "" || fileVersion.ObservationID != "" {
			return fmt.Errorf("catalog relation witness for file version %q unexpectedly contains source scan or observation handles", fileVersion.ID)
		}
		if _, duplicate := fileVersionByID[fileVersion.ID]; duplicate {
			return fmt.Errorf("catalog relation witnesses map file version %q more than once", fileVersion.ID)
		}
		fileVersionByID[fileVersion.ID] = struct{}{}
		fileVersion.ScanGenerationID = projection.Scan.ID
		fileVersion.ObservationID = recoveryProjectionID(sqlite.IDPrefixObservation, root.bundle.WorkspaceID, root.publication.Commit.SnapshotRef, mapping.NamespaceEntryID)
		projection.FileVersions = append(projection.FileVersions, fileVersion)
		for _, extent := range witness.ContentExtents {
			if existing, duplicate := extentByID[extent.ID]; duplicate {
				if !reflect.DeepEqual(existing, extent) {
					return fmt.Errorf("catalog relation witnesses disagree on content extent %q", extent.ID)
				}
				continue
			}
			extentByID[extent.ID] = extent
			projection.ContentExtents = append(projection.ContentExtents, extent)
		}
	}
	for _, protection := range protectionBySubject {
		projection.Protections = append(projection.Protections, protection)
	}
	sort.Slice(projection.NamespaceEntries, func(i, j int) bool {
		if len(projection.NamespaceEntries[i].FullPathKey) != len(projection.NamespaceEntries[j].FullPathKey) {
			return len(projection.NamespaceEntries[i].FullPathKey) < len(projection.NamespaceEntries[j].FullPathKey)
		}
		return bytes.Compare(projection.NamespaceEntries[i].FullPathKey, projection.NamespaceEntries[j].FullPathKey) < 0
	})
	sort.Slice(projection.Observations, func(i, j int) bool {
		return bytes.Compare(projection.Observations[i].PathKey, projection.Observations[j].PathKey) < 0
	})
	return nil
}

func recoveryProtectionFromManifest(root recoveryProjectionRoot, mapping subjectMappingPayload, when time.Time, workspaceID string, marker map[string]any, projection *sqlite.RecoveryCatalogProjection, representations map[string]sqlite.Representation) (sqlite.ProtectionRecord, error) {
	value := mapping.Protection
	mode, outcome := sqlite.ProtectionMode(value.Mode), sqlite.ProtectionOutcome(value.Outcome)
	if mode == "" || outcome == "" || value.RecordID == "" {
		return sqlite.ProtectionRecord{}, errors.New("authenticated manifest has incomplete protection mapping")
	}
	provenance := make(map[string]any, len(marker)+5)
	for key, field := range marker {
		provenance[key] = field
	}
	provenance["publication_generation"] = root.publication.Commit.Generation
	provenance["snapshot_ref"] = root.publication.Commit.SnapshotRef
	provenance["commit_digest"] = root.publication.CommitDigest
	provenance["manifest_digest"] = root.publication.Manifest.ManifestDigest
	provenance["namespace_root_id"] = projection.Root.ID
	provenanceBytes, err := json.Marshal(provenance)
	if err != nil {
		return sqlite.ProtectionRecord{}, err
	}
	protection := sqlite.ProtectionRecord{ID: value.RecordID, WorkspaceID: workspaceID, SubjectRef: mapping.StableSubjectRef, Mode: mode, Outcome: outcome, ExpectedContentID: value.ExpectedContentID, ExpectedLogicalLength: value.ExpectedLogicalLength, LocalRepresentationID: value.LocalRepresentationID, PolicyDecisionRef: "signed-manifest:" + root.publication.CommitDigest, Revision: 1, Metadata: provenanceBytes, CreatedAt: when, UpdatedAt: when}
	protection.LastVerificationRef, err = signedProtectionVerificationReference(value)
	if err != nil {
		return sqlite.ProtectionRecord{}, err
	}
	for _, ref := range value.RecoveryReferences {
		kind := sqlite.RecoveryReferenceKind(ref.Kind)
		claim := sqlite.RecoveryClaim(ref.Claim)
		if kind == sqlite.RecoveryExternalLocator && ref.ExternalBindingID != "" {
			bindingDigest, err := externalBindingDigestFromRecoveryReference(ref, value.ExpectedContentID, value.ExpectedLogicalLength)
			if err != nil {
				return sqlite.ProtectionRecord{}, err
			}
			bindingMetadata, _ := json.Marshal(map[string]any{"origin": "SIGNED_RECOVERY_PROJECTION", "provider_identity": "not-asserted", "signed_reference_id": ref.ExternalBindingID})
			projection.ExternalBindings = append(projection.ExternalBindings, sqlite.ExternalBinding{ID: ref.ExternalBindingID, WorkspaceID: workspaceID, SubjectRef: mapping.StableSubjectRef, ProviderKind: "PORTABLE_EXTERNAL_REFERENCE", StableIdentity: ref.ExternalBindingID, Revision: 1, BindingDigest: bindingDigest, Metadata: bindingMetadata, CreatedAt: when})
			for _, locator := range ref.ExternalLocators {
				projection.ExternalLocators = append(projection.ExternalLocators, sqlite.ExternalLocator{ID: locator.LocatorID, WorkspaceID: workspaceID, BindingID: ref.ExternalBindingID, Revision: 1, Priority: locator.Priority, Kind: locator.Kind, Locator: locator.Locator, DisplayLocator: locator.DisplayLocator, ExpectedContentID: locator.ExpectedContentID, ExpectedLogicalLength: int64Ptr(locator.ExpectedLogicalLength), Availability: locator.Availability, ValidationStatus: locator.ValidationStatus, Metadata: json.RawMessage(`{"origin":"SIGNED_RECOVERY_PROJECTION"}`), CreatedAt: when})
			}
		}
		recoveryRef := sqlite.RecoveryReference{ID: ref.ReferenceID, WorkspaceID: workspaceID, ProtectionRecordID: value.RecordID, SubjectRef: mapping.StableSubjectRef, Kind: kind, Priority: ref.Priority, Claim: claim, ExpectedContentID: value.ExpectedContentID, ExpectedLogicalLength: value.ExpectedLogicalLength, RepresentationID: ref.RepresentationID, ExternalBindingID: ref.ExternalBindingID, CodecProfileRef: ref.CodecProfile, Recipe: ref.Recipe, Verification: ref.Verification, Status: ref.Status, Metadata: json.RawMessage(`{"origin":"SIGNED_RECOVERY_PROJECTION"}`), CreatedAt: when, UpdatedAt: when}
		if recoveryRef.RepresentationID != "" && recoveryRef.ExpectedContentID != "" {
			if _, ok := representations[recoveryRef.RepresentationID]; !ok {
				return sqlite.ProtectionRecord{}, fmt.Errorf("recovery reference %q names representation %q without an authenticated catalog relation witness", recoveryRef.ID, recoveryRef.RepresentationID)
			}
		}
		projection.RecoveryReferences = append(projection.RecoveryReferences, recoveryRef)
	}
	return protection, nil
}

func readRecoveryAttachment(ctx context.Context, repo repository.Driver, attachment portableFactAttachment) ([]byte, error) {
	if attachment.LogicalLength < 0 || attachment.LogicalLength > int64(^uint(0)>>1) {
		return nil, errors.New("portable attachment length is outside local addressable range")
	}
	reader, err := repo.Open(ctx, attachment.ContentID)
	if err != nil {
		return nil, err
	}
	body, readErr := io.ReadAll(io.LimitReader(reader, attachment.LogicalLength+1))
	closeErr := reader.Close()
	if readErr != nil {
		return nil, readErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if int64(len(body)) != attachment.LogicalLength || DigestBytes(body) != attachment.ContentID {
		return nil, errors.New("portable attachment body differs from authenticated exact identity")
	}
	return body, nil
}

func recoveryProjectionID(prefix, domain, snapshot, purpose string) string {
	sum := sha256.Sum256([]byte(prefix + "\x00" + domain + "\x00" + snapshot + "\x00" + purpose))
	return prefix + "_" + hex.EncodeToString(sum[:16])
}

func mustMarked(marker map[string]any) json.RawMessage {
	value, _ := json.Marshal(marker)
	return value
}

func recoveryNamespaceMetadata(before, after json.RawMessage, captureFacts []json.RawMessage) (json.RawMessage, error) {
	metadata := map[string]json.RawMessage{}
	if len(before) > 0 && string(before) != "null" {
		if err := json.Unmarshal(before, &metadata); err != nil {
			return nil, fmt.Errorf("decode signed namespace metadata: %w", err)
		}
		if metadata == nil {
			metadata = map[string]json.RawMessage{}
		}
	}
	const projectionKey = "_cairn_recovery_projection_v1"
	if _, exists := metadata[projectionKey]; exists {
		return nil, errors.New("signed namespace metadata uses the reserved recovery provenance key")
	}
	origin, _ := json.Marshal("SIGNED_RECOVERY_PROJECTION")
	facts, err := json.Marshal(captureFacts)
	if err != nil {
		return nil, err
	}
	recovery, err := json.Marshal(map[string]json.RawMessage{"origin": origin, "metadata_after": after, "capture_facts": facts})
	if err != nil {
		return nil, err
	}
	metadata[projectionKey] = recovery
	return json.Marshal(metadata)
}

func timePointer(value time.Time) *time.Time { value = value.UTC(); return &value }
func int64Ptr(value int64) *int64            { return &value }
func derefInt64(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func mappingsBySubjectForPath(mappings map[string]subjectMappingPayload, subject string) (subjectMappingPayload, bool) {
	for _, mapping := range mappings {
		if mapping.StableSubjectRef == subject {
			return mapping, true
		}
	}
	return subjectMappingPayload{}, false
}
