package search

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

const semanticGenerationStaleReason = "SEMANTIC_GENERATION_STALE"

var errSemanticFeedChanged = errors.New("semantic feed identities changed")

type semanticFeedIdentity struct {
	SubjectID                 string
	SourceKind                string
	SourceSubtype             string
	SourceRef                 string
	Revision                  string
	BodyDigest                string
	BodyLength                int64
	SegmentationProfileDigest string
	Selected                  bool
}

func (row semanticFeedIdentity) key() string {
	return strings.Join([]string{row.SubjectID, row.SourceKind, row.SourceSubtype, row.SourceRef, row.Revision}, "\x00")
}

func semanticFeedFilenameIdentity(entry sqlite.NamespaceEntry) semanticFeedIdentity {
	subject := entry.SubjectRef
	if subject == "" {
		subject = entry.ID
	}
	return semanticFeedIdentity{SubjectID: subject, SourceKind: "FILENAME", SourceRef: entry.ID,
		Revision: entry.ID, BodyDigest: sha256Text(entry.DisplayName), BodyLength: int64(len(entry.DisplayName)), Selected: true}
}

// semanticGenerationMatchesCurrentFeed compares the generation-local receipt
// with current durable source identities. It reads metadata and immutable
// revision identities only; it never embeds, retokenizes, or changes a receipt.
func (idx *Indexer) semanticGenerationMatchesCurrentFeed(ctx context.Context, semanticGeneration, lexicalGeneration sqlite.IndexGeneration) error {
	stale := func(reason string) error {
		idx.markSemanticFeedStale(reason)
		return fmt.Errorf("%w: %s: %s", ErrUnavailable, semanticGenerationStaleReason, reason)
	}
	unavailable := func(reason string) error {
		idx.markSemanticUnavailable(reason)
		return fmt.Errorf("%w: %s", ErrUnavailable, reason)
	}
	if idx == nil || idx.Store == nil || semanticGeneration.WorkspaceID == "" || lexicalGeneration.WorkspaceID != semanticGeneration.WorkspaceID {
		return unavailable("generation scope is unavailable")
	}
	currentRoots, err := idx.currentSemanticFeedRoots(ctx, semanticGeneration.WorkspaceID, lexicalGeneration)
	if err != nil {
		return unavailable("current root membership cannot be verified")
	}
	semanticRoots, err := idx.Store.ListIndexGenerationRoots(ctx, semanticGeneration.WorkspaceID, semanticGeneration.ID)
	if err != nil {
		return unavailable("semantic generation root membership cannot be read")
	}
	if !sameSemanticFeedRoots(semanticRoots, currentRoots) {
		return stale("semantic generation root membership differs from current feed")
	}
	lexicalRoots, err := idx.Store.ListIndexGenerationRoots(ctx, lexicalGeneration.WorkspaceID, lexicalGeneration.ID)
	if err != nil {
		return unavailable("latest lexical root membership cannot be read")
	}
	if !sameSemanticFeedRoots(lexicalRoots, currentRoots) {
		return stale("latest lexical root membership differs from current feed")
	}
	inventory, reason, err := readSemanticSourceInventory(semanticGeneration)
	if err != nil || inventory == nil {
		if err != nil {
			return unavailable("semantic source receipt cannot be read")
		}
		return unavailable("semantic source receipt is unavailable: " + reason)
	}
	current, err := idx.currentSemanticFeedIdentities(ctx, semanticGeneration.WorkspaceID, lexicalGeneration)
	if err != nil {
		return unavailable("current source identities cannot be verified: " + err.Error())
	}
	if err := compareSemanticFeedIdentities(*inventory, current); err != nil {
		if errors.Is(err, errSemanticFeedChanged) {
			return stale("source identities differ from current feed")
		}
		return unavailable("semantic source identity receipt is invalid")
	}
	if idx.LexicalUnavailableForWorkspace(semanticGeneration.WorkspaceID) {
		return unavailable("latest lexical rebuild failed")
	}
	if idx.semanticFeedStale.Load() {
		if health, ok := idx.SemanticProvider.(interface{ SemanticReady() bool }); ok && !health.SemanticReady() {
			return unavailable("semantic provider is not ready")
		}
		if health, ok := idx.SemanticZvec.(ZvecGenerationReadiness); !ok || !health.ZvecReady(idx.SemanticLibraryPath, idx.SemanticLibraryDigest, idx.SemanticManifest) {
			return unavailable("semantic backend is not ready")
		}
		if err := idx.ensureSemanticGenerationVerified(ctx, semanticGeneration); err != nil {
			return unavailable("semantic generation verification failed: " + err.Error())
		}
		idx.semanticIndexReady.Store(true)
	}
	idx.clearSemanticFeedStale()
	return nil
}

func sameSemanticFeedRoots(left, right []sqlite.NamespaceRoot) bool {
	if len(left) != len(right) {
		return false
	}
	ids := make(map[string]struct{}, len(left))
	for _, root := range left {
		ids[root.ID] = struct{}{}
	}
	for _, root := range right {
		if _, ok := ids[root.ID]; !ok {
			return false
		}
	}
	return true
}

func compareSemanticFeedIdentities(inventory semanticSourceInventory, current map[string]semanticFeedIdentity) error {
	oldNonDescription := map[string]semanticSourceInventoryRow{}
	oldDescriptions := map[string]semanticSourceInventoryRow{}
	for _, row := range inventory.Rows {
		switch row.SourceKind {
		case "NOTE", "EXTRACT", "FILENAME":
			key := semanticSourceRowIdentity(row)
			if _, duplicate := oldNonDescription[key]; duplicate {
				return errors.New("duplicate semantic source identity")
			}
			oldNonDescription[key] = row
		case "DESCRIPTION":
			key := semanticSourceRowIdentity(row)
			if _, duplicate := oldDescriptions[key]; duplicate {
				return errors.New("duplicate semantic description identity")
			}
			oldDescriptions[key] = row
		}
	}
	currentNonDescription := map[string]semanticFeedIdentity{}
	currentDescriptions := map[string]semanticFeedIdentity{}
	for key, row := range current {
		if row.SourceKind == "DESCRIPTION" {
			currentDescriptions[key] = row
		} else {
			currentNonDescription[key] = row
		}
	}
	if len(oldNonDescription) != len(currentNonDescription) {
		return errSemanticFeedChanged
	}
	for key, row := range oldNonDescription {
		want, ok := currentNonDescription[key]
		if !ok || row.BodyDigest != want.BodyDigest || row.BodyLength != want.BodyLength || row.SegmentationProfileDigest != want.SegmentationProfileDigest {
			return errSemanticFeedChanged
		}
	}
	for key, row := range oldDescriptions {
		want, exists := currentDescriptions[key]
		wasSelected := row.Disposition != SemanticSourceExcluded ||
			(row.Reason != SemanticSourceReasonDescriptionRejected && row.Reason != SemanticSourceReasonDescriptionSuperseded)
		isSelected := exists && want.Selected
		if wasSelected != isSelected {
			return errSemanticFeedChanged
		}
		if isSelected && (row.BodyDigest != want.BodyDigest || row.BodyLength != want.BodyLength) {
			return errSemanticFeedChanged
		}
	}
	for key, row := range currentDescriptions {
		if !row.Selected {
			continue
		}
		old, ok := oldDescriptions[key]
		if !ok || (old.Disposition == SemanticSourceExcluded &&
			(old.Reason == SemanticSourceReasonDescriptionRejected || old.Reason == SemanticSourceReasonDescriptionSuperseded)) {
			return errSemanticFeedChanged
		}
	}
	return nil
}

func (idx *Indexer) currentSemanticFeedIdentities(ctx context.Context, workspaceID string, lexicalGeneration sqlite.IndexGeneration) (map[string]semanticFeedIdentity, error) {
	roots, err := idx.currentSemanticFeedRoots(ctx, workspaceID, lexicalGeneration)
	if err != nil {
		return nil, err
	}
	var entries []sqlite.NamespaceEntry
	if _, err := idx.Store.LatestPublication(ctx, workspaceID); err == nil {
		var listErr error
		entries, listErr = idx.Store.ListLatestNamespaceEntries(ctx, workspaceID)
		if listErr != nil {
			return nil, listErr
		}
	} else if errors.Is(err, sqlite.ErrNotFound) {
		for _, root := range roots {
			nodes, listErr := idx.Store.ListNamespaceSubtree(ctx, workspaceID, root.ID, "")
			if listErr != nil {
				return nil, listErr
			}
			for _, node := range nodes {
				entries = append(entries, node.Entry)
			}
		}
	} else {
		return nil, err
	}

	rootByID := make(map[string]sqlite.NamespaceRoot, len(roots))
	entryByID := make(map[string]sqlite.NamespaceEntry, len(entries))
	currentSubjects := make(map[string]struct{}, len(entries))
	for _, root := range roots {
		rootByID[root.ID] = root
	}
	for _, entry := range entries {
		if entry.SubjectRef == "" {
			entry.SubjectRef = entry.ID
		}
		entryByID[entry.ID] = entry
		currentSubjects[entry.SubjectRef] = struct{}{}
	}
	canonical := func(ref string) string {
		if entry, ok := entryByID[ref]; ok {
			return entry.SubjectRef
		}
		return ref
	}
	rows := make(map[string]semanticFeedIdentity)
	add := func(row semanticFeedIdentity) error {
		if _, duplicate := rows[row.key()]; duplicate {
			return errors.New("duplicate current semantic source identity")
		}
		rows[row.key()] = row
		return nil
	}
	annotations, err := idx.Store.ListAnnotations(ctx, workspaceID, "", false)
	if err != nil {
		return nil, err
	}
	for _, annotation := range annotations {
		if annotation.Kind != sqlite.AnnotationNote {
			continue
		}
		subject := canonical(annotation.SubjectRef)
		if _, inScope := currentSubjects[subject]; !inScope {
			continue
		}
		profile := ""
		if int64(len(annotation.Body)) > semanticTextSourceSegmentTargetBytes {
			profile = semanticTextSourceSegmentationProfileDigest
		}
		if err := add(semanticFeedIdentity{SubjectID: subject, SourceKind: "NOTE", SourceRef: annotation.ID,
			Revision: strconv.FormatInt(annotation.Revision, 10), BodyDigest: annotation.BodyDigest,
			BodyLength: int64(len(annotation.Body)), SegmentationProfileDigest: profile, Selected: true}); err != nil {
			return nil, err
		}
	}
	artifacts, err := idx.Store.ListAdmittedArtifacts(ctx, workspaceID, "")
	if err != nil {
		return nil, err
	}
	for _, artifact := range artifacts {
		if artifact.Stage != "EXTRACT" {
			continue
		}
		subject := canonical(artifact.SubjectRef)
		if _, inScope := currentSubjects[subject]; !inScope {
			continue
		}
		if _, ok := semanticArtifactEntryInRoots(artifact, subject, entryByID, rootByID); !ok {
			continue
		}
		profile := ""
		if int64(len(artifact.Body)) > semanticTextSourceSegmentTargetBytes {
			profile = semanticTextSourceSegmentationProfileDigest
		}
		if err := add(semanticFeedIdentity{SubjectID: subject, SourceKind: "EXTRACT", SourceRef: artifact.ID,
			Revision: artifact.ID, BodyDigest: artifact.Digest, BodyLength: int64(len(artifact.Body)),
			SegmentationProfileDigest: profile, Selected: true}); err != nil {
			return nil, err
		}
	}
	descriptions, err := idx.Store.ListDescriptionDocuments(ctx, workspaceID, "")
	if err != nil {
		return nil, err
	}
	active := activeDescriptionLeaves(descriptions)
	for _, description := range descriptions {
		subject := canonical(description.SubjectRef)
		if _, inScope := currentSubjects[subject]; !inScope {
			continue
		}
		_, leaf := active[description.ID]
		selected := description.Accepted && leaf
		if err := add(semanticFeedIdentity{SubjectID: subject, SourceKind: "DESCRIPTION", SourceSubtype: string(description.Kind),
			SourceRef: description.ID, Revision: strconv.FormatInt(description.Revision, 10), BodyDigest: description.BodyDigest,
			BodyLength: int64(len(description.Body)), Selected: selected}); err != nil {
			return nil, err
		}
	}
	for _, entry := range entryByID {
		if err := add(semanticFeedFilenameIdentity(entry)); err != nil {
			return nil, err
		}
	}
	return rows, nil
}

func (idx *Indexer) currentSemanticFeedRoots(ctx context.Context, workspaceID string, lexicalGeneration sqlite.IndexGeneration) ([]sqlite.NamespaceRoot, error) {
	if _, err := idx.Store.LatestPublication(ctx, workspaceID); err == nil {
		return idx.Store.ListLatestNamespaceRoots(ctx, workspaceID)
	} else if errors.Is(err, sqlite.ErrNotFound) {
		return idx.Store.ListIndexGenerationRoots(ctx, workspaceID, lexicalGeneration.ID)
	} else {
		return nil, err
	}
}
