package search

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// imageGenerationReceiptFile is the immutable, generation-local record of one
// image generation. It records the complete space fingerprint next to the
// generation's semantic-space field so a later reader can prove which space a
// set of vectors belongs to without consulting the mutable catalog.
type imageGenerationReceiptFile struct {
	Schema         string                 `json:"schema"`
	GenerationID   string                 `json:"generation_id"`
	WorkspaceID    string                 `json:"workspace_id"`
	SnapshotRef    string                 `json:"snapshot_ref"`
	NamespaceRoot  string                 `json:"namespace_root_id"`
	ConfigDigest   string                 `json:"config_digest"`
	ProfileDigest  string                 `json:"profile_digest"`
	SemanticSpace  string                 `json:"semantic_space"`
	Fingerprint    ImageSpaceFingerprint  `json:"space_fingerprint"`
	LibraryDigest  string                 `json:"library_digest"`
	IdentityDigest string                 `json:"identity_digest"`
	Identities     []ZvecCoverageIdentity `json:"identities"`
}

const imageGenerationReceiptSchema = "cairn.image-generation-receipt.v1"

// writeImageGenerationReceipt publishes the receipt with the same atomic
// no-replace pattern as the semantic receipt.
func writeImageGenerationReceipt(generation sqlite.IndexGeneration, libraryDigest string, fingerprint ImageSpaceFingerprint, identities []ZvecCoverageIdentity) error {
	if strings.TrimSpace(generation.DBPath) == "" || strings.TrimSpace(generation.ID) == "" {
		return errors.New("image generation receipt requires generation identity and path")
	}
	if err := fingerprint.Validate(); err != nil {
		return err
	}
	if generation.SemanticSpace != fingerprint.CanonicalDigest() {
		return fmt.Errorf("%w: generation space is not the declared fingerprint", ErrImageSpaceFingerprintMismatch)
	}
	identities = append([]ZvecCoverageIdentity(nil), identities...)
	receipt := imageGenerationReceiptFile{
		Schema: imageGenerationReceiptSchema, GenerationID: generation.ID,
		WorkspaceID: generation.WorkspaceID, SnapshotRef: generation.SnapshotRef,
		NamespaceRoot: generation.NamespaceRootID, ConfigDigest: generation.ConfigDigest,
		ProfileDigest: generation.ProviderProfileDigest, SemanticSpace: generation.SemanticSpace,
		Fingerprint: fingerprint, LibraryDigest: libraryDigest,
		IdentityDigest: semanticCoverageDigest(identities), Identities: identities,
	}
	payload, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	finalPath := semanticGenerationReceiptPath(generation.DBPath)
	parent := filepath.Dir(finalPath)
	file, err := os.CreateTemp(parent, ".cairn-image-receipt-*")
	if err != nil {
		return err
	}
	tmpPath := file.Name()
	published := false
	linked := false
	defer func() {
		_ = file.Close()
		if !published {
			_ = os.Remove(tmpPath)
			if linked {
				_ = os.Remove(finalPath)
			}
		}
	}()
	if _, err := file.Write(payload); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Link(tmpPath, finalPath); err != nil {
		return err
	}
	linked = true
	if err := os.Remove(tmpPath); err != nil {
		return err
	}
	directory, err := os.Open(parent)
	if err != nil {
		return err
	}
	if err := directory.Sync(); err != nil {
		_ = directory.Close()
		return err
	}
	if err := directory.Close(); err != nil {
		return err
	}
	published = true
	return nil
}

// readImageGenerationReceipt reads and validates one image generation receipt.
// The fingerprint facts and the semantic-space field must both agree with the
// generation row; a disagreement is a hard error, never a repaired value.
func readImageGenerationReceipt(generation sqlite.IndexGeneration) ([]ZvecCoverageIdentity, string, string, error) {
	if strings.TrimSpace(generation.DBPath) == "" {
		return nil, "", "", errors.New("image generation path is empty")
	}
	payload, err := readBoundedSemanticGenerationReceipt(semanticGenerationReceiptPath(generation.DBPath))
	if err != nil {
		return nil, "", "", err
	}
	var receipt imageGenerationReceiptFile
	if err := json.Unmarshal(payload, &receipt); err != nil {
		return nil, "", "", fmt.Errorf("image generation receipt: %v", err)
	}
	if receipt.Schema != imageGenerationReceiptSchema || receipt.GenerationID != generation.ID || receipt.WorkspaceID != generation.WorkspaceID ||
		receipt.SnapshotRef != generation.SnapshotRef || receipt.NamespaceRoot != generation.NamespaceRootID ||
		receipt.ConfigDigest != generation.ConfigDigest || receipt.ProfileDigest != generation.ProviderProfileDigest ||
		receipt.SemanticSpace != generation.SemanticSpace ||
		receipt.IdentityDigest == "" || receipt.IdentityDigest != semanticCoverageDigest(receipt.Identities) {
		return nil, "", "", errors.New("image generation receipt binding is invalid")
	}
	if err := receipt.Fingerprint.Validate(); err != nil {
		return nil, "", "", fmt.Errorf("image generation receipt fingerprint: %v", err)
	}
	if receipt.Fingerprint.CanonicalDigest() != generation.SemanticSpace {
		return nil, "", "", fmt.Errorf("%w: receipt fingerprint does not match the recorded generation space", ErrImageSpaceFingerprintMismatch)
	}
	if validateZvecLibraryDigest(receipt.LibraryDigest) != nil {
		return nil, "", "", errors.New("image generation receipt library digest is invalid")
	}
	if err := validateZvecCoverageIdentities(receipt.Identities); err != nil || len(receipt.Identities) == 0 {
		return nil, "", "", errors.New("image generation receipt identities are invalid")
	}
	return append([]ZvecCoverageIdentity(nil), receipt.Identities...), receipt.IdentityDigest, receipt.LibraryDigest, nil
}
