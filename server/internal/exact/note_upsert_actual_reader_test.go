package exact

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

const actualNoteReaderCaseEnv = "CAIRN_NOTE_UPSERT_READER_CASE"

type actualNoteReaderCase struct {
	Schema               string                      `json:"schema"`
	RuntimeRoot          string                      `json:"runtime_root"`
	SourceRepositoryPath string                      `json:"source_repository_path"`
	RepositoryPath       string                      `json:"repository_path"`
	RepositoryProfile    string                      `json:"repository_profile"`
	TrustAnchorPath      string                      `json:"trust_anchor_path"`
	References           []actualNoteReaderReference `json:"references"`
	CorpusManifestPath   string                      `json:"corpus_manifest_path"`
	CorpusManifestDigest string                      `json:"corpus_manifest_digest"`
	ExpectedFileCount    int                         `json:"expected_file_count"`
	ExpectedLogicalBytes int64                       `json:"expected_logical_bytes"`
	ExpectedWorkspaceID  string                      `json:"expected_workspace_id"`
	ExpectedSubjectRef   string                      `json:"expected_subject_ref"`
	ExpectedAnnotationID string                      `json:"expected_annotation_id"`
	ExpectedRevision     int64                       `json:"expected_revision"`
	ExpectedBody         string                      `json:"expected_body"`
	ExpectedBodySHA256   string                      `json:"expected_body_sha256"`
	ExpectedBodyBytes    int64                       `json:"expected_body_bytes"`
}

type actualNoteReaderReference struct {
	SnapshotRef string `json:"snapshot_ref"`
	Path        string `json:"path"`
}

type actualNoteCorpusManifest struct {
	Schema       string                  `json:"schema"`
	Digest       string                  `json:"digest"`
	Count        int                     `json:"count"`
	LogicalBytes int64                   `json:"logical_bytes"`
	Entries      []actualNoteCorpusEntry `json:"entries"`
}

type actualNoteCorpusEntry struct {
	CorpusPath string `json:"corpus_path"`
	Bytes      int64  `json:"bytes"`
	SHA256     string `json:"sha256"`
}

// TestActualNoteUpsertPortableRecoveryReader is an opt-in, read-only proof
// against artifacts emitted by one separately authorized ordinary CLI Note
// mutation. The clean reader never opens the source catalog or signing key.
func TestActualNoteUpsertPortableRecoveryReader(t *testing.T) {
	casePath := strings.TrimSpace(os.Getenv(actualNoteReaderCaseEnv))
	if casePath == "" {
		t.Skip("set " + actualNoteReaderCaseEnv + " to an explicit absolute runtime case JSON path")
	}
	if !filepath.IsAbs(casePath) {
		t.Fatalf("%s must be an absolute path", actualNoteReaderCaseEnv)
	}
	caseData, err := os.ReadFile(casePath)
	if err != nil {
		t.Fatalf("read runtime case: %v", err)
	}
	var proof actualNoteReaderCase
	if err := json.Unmarshal(caseData, &proof); err != nil {
		t.Fatalf("decode runtime case: %v", err)
	}
	if err := validateActualNoteReaderCase(proof, casePath); err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	anchor, err := LoadTrustAnchor(proof.TrustAnchorPath)
	if err != nil {
		t.Fatalf("load independently retained public anchor: %v", err)
	}
	if anchor.PublicationDomain == "" {
		t.Fatal("trust anchor has an empty publication domain")
	}
	repo, err := repository.OpenProfileReadOnly(proof.RepositoryProfile, proof.RepositoryPath)
	if err != nil {
		t.Fatalf("open copied repository read-only: %v", err)
	}
	reader := &Service{Repo: repo, TrustAnchor: &anchor, PublicationDomain: anchor.PublicationDomain}
	recordDriver := repo

	referencesBySnapshot := make(map[string]RecoveryReference, len(proof.References))
	for _, input := range proof.References {
		reference, err := LoadRecoveryReference(input.Path)
		if err != nil {
			t.Fatalf("load reference for %s: %v", input.SnapshotRef, err)
		}
		if reference.SnapshotRef != input.SnapshotRef || reference.FactHealth != RecoveryFactHealthComplete || len(reference.PortableFactClosures) == 0 {
			t.Fatalf("recovery reference for %s lacks its complete authenticated fact chain", input.SnapshotRef)
		}
		if reference.Repository.Profile != proof.RepositoryProfile {
			t.Fatalf("reference %s repository profile = %q, want %q", input.SnapshotRef, reference.Repository.Profile, proof.RepositoryProfile)
		}
		if err := reference.ValidateAgainstRepository(ctx, repo, anchor); err != nil {
			t.Fatalf("validate reference %s against copied repository: %v", input.SnapshotRef, err)
		}
		if _, exists := referencesBySnapshot[input.SnapshotRef]; exists {
			t.Fatalf("duplicate recovery reference for snapshot %s", input.SnapshotRef)
		}
		referencesBySnapshot[input.SnapshotRef] = reference
	}

	// Enumerate every authenticated committed parent, not merely the parents
	// named by the mutating process. Missing or ambiguous mapping evidence fails
	// closed before an affected-parent set is accepted.
	parents, err := reader.committedPublications(ctx)
	if err != nil {
		t.Fatalf("enumerate authenticated committed parents: %v", err)
	}
	if len(parents) == 0 {
		t.Fatal("repository has no authenticated committed parents")
	}
	var applicableParents int
	seenSnapshots := make(map[string]struct{}, len(parents))
	for _, parent := range parents {
		snapshotRef := parent.Commit.SnapshotRef
		if _, duplicate := seenSnapshots[snapshotRef]; duplicate {
			t.Fatalf("ambiguous authenticated parents share snapshot reference %s", snapshotRef)
		}
		seenSnapshots[snapshotRef] = struct{}{}
		chain, err := listPortableFactClosures(ctx, repo, recordDriver, anchor, anchor.PublicationDomain, parent.CommitDigest)
		if err != nil {
			t.Fatalf("read authenticated fact chain for parent %s: %v", parent.CommitDigest, err)
		}
		if len(chain) == 0 {
			t.Fatalf("parent %s lacks a complete portable subject-mapping chain", parent.CommitDigest)
		}
		workspaceID := chain[len(chain)-1].Closure.WorkspaceID
		members, err := stableSubjectsForParentChain(chain, workspaceID)
		if err != nil {
			t.Fatalf("validate stable subject mappings for parent %s: %v", parent.CommitDigest, err)
		}
		if _, affected := members[proof.ExpectedSubjectRef]; !affected {
			continue
		}
		applicableParents++
		reference, ok := referencesBySnapshot[snapshotRef]
		if !ok {
			t.Fatalf("affected retained parent %s (%s) has no separately exported recovery reference", parent.CommitDigest, snapshotRef)
		}
		if err := assertReferenceNamesLatestFactChild(reference, chain); err != nil {
			t.Fatalf("recovery reference for affected parent %s: %v", parent.CommitDigest, err)
		}
		assertCurrentNoteRevision(t, chain[len(chain)-1], proof)
	}
	if applicableParents == 0 {
		t.Fatal("no authenticated retained parent maps the expected stable subject")
	}

	manifestBytes, err := os.ReadFile(proof.CorpusManifestPath)
	if err != nil {
		t.Fatalf("read frozen corpus manifest: %v", err)
	}
	var corpus actualNoteCorpusManifest
	if err := json.Unmarshal(manifestBytes, &corpus); err != nil {
		t.Fatalf("decode frozen corpus manifest: %v", err)
	}
	if corpus.Schema != "cairn.phase4-real-project-corpus-manifest.v1" || corpus.Digest != proof.CorpusManifestDigest ||
		corpus.Count != proof.ExpectedFileCount || len(corpus.Entries) != proof.ExpectedFileCount || corpus.LogicalBytes != proof.ExpectedLogicalBytes {
		t.Fatalf("frozen source manifest identity/count mismatch: schema=%q digest=%q count=%d entries=%d bytes=%d",
			corpus.Schema, corpus.Digest, corpus.Count, len(corpus.Entries), corpus.LogicalBytes)
	}
	manifestRefs := make(map[string]Manifest, len(referencesBySnapshot))
	for snapshotRef, reference := range referencesBySnapshot {
		manifest, err := reference.reassembledManifest(ctx, recordDriver)
		if err != nil {
			t.Fatalf("reassemble exact manifest for %s: %v", snapshotRef, err)
		}
		manifestRefs[snapshotRef] = manifest
	}
	// At least one frozen snapshot must contain the complete 104-file corpus;
	// other applicable retained parents may legitimately contain the same paths.
	var fullCorpusManifest *Manifest
	for snapshotRef := range referencesBySnapshot {
		manifest := manifestRefs[snapshotRef]
		byRawPath := make(map[string]ManifestEntry, len(manifest.Entries))
		for _, entry := range manifest.Entries {
			if len(entry.RawPath) != 0 {
				byRawPath[string(entry.RawPath)] = entry
			}
		}
		complete := true
		for _, expected := range corpus.Entries {
			entry, ok := byRawPath[expected.CorpusPath]
			if !ok || entry.ContentID != "sha256:"+expected.SHA256 || entry.LogicalSize == nil || *entry.LogicalSize != expected.Bytes {
				complete = false
				break
			}
		}
		if complete {
			copy := manifest
			fullCorpusManifest = &copy
			break
		}
	}
	if fullCorpusManifest == nil {
		t.Fatal("no exported snapshot manifest contains the complete frozen 104-file corpus with matching SHA-256 and length")
	}
	byRawPath := make(map[string]ManifestEntry, len(fullCorpusManifest.Entries))
	for _, entry := range fullCorpusManifest.Entries {
		if len(entry.RawPath) != 0 {
			byRawPath[string(entry.RawPath)] = entry
		}
	}
	var exactFileCount int
	var exactBytes int64
	for _, expected := range corpus.Entries {
		matched, ok := byRawPath[expected.CorpusPath]
		if !ok {
			t.Fatalf("frozen original %q is absent from selected full-corpus manifest", expected.CorpusPath)
		}
		wantContentID := "sha256:" + expected.SHA256
		if matched.ContentID != wantContentID || matched.LogicalSize == nil || *matched.LogicalSize != expected.Bytes {
			t.Fatalf("frozen original %q identity differs: content=%q length=%v want=%q/%d",
				expected.CorpusPath, matched.ContentID, matched.LogicalSize, wantContentID, expected.Bytes)
		}
		if err := verifyExactObjectReadback(ctx, repo, wantContentID, expected.Bytes); err != nil {
			t.Fatalf("exact object verification for %q: %v", expected.CorpusPath, err)
		}
		exactFileCount++
		exactBytes += expected.Bytes
	}
	if exactFileCount != proof.ExpectedFileCount || exactBytes != proof.ExpectedLogicalBytes {
		t.Fatalf("exact original verification totals = %d files/%d bytes, want %d/%d",
			exactFileCount, exactBytes, proof.ExpectedFileCount, proof.ExpectedLogicalBytes)
	}
	t.Logf("catalog-free authenticated Note revision %d verified in %d applicable retained parent(s); exact originals verified: %d files/%d bytes (no restore drill performed)",
		proof.ExpectedRevision, applicableParents, exactFileCount, exactBytes)
}

func validateActualNoteReaderCase(proof actualNoteReaderCase, casePath string) error {
	if proof.Schema != "cairn.note-upsert-actual-reader-case.v1" {
		return fmt.Errorf("unsupported case schema %q", proof.Schema)
	}
	for name, value := range map[string]string{
		"runtime_root": proof.RuntimeRoot, "source_repository_path": proof.SourceRepositoryPath,
		"repository_path": proof.RepositoryPath, "trust_anchor_path": proof.TrustAnchorPath,
		"corpus_manifest_path": proof.CorpusManifestPath,
	} {
		if value == "" || !filepath.IsAbs(value) {
			return fmt.Errorf("%s must be an absolute path", name)
		}
	}
	if !filepath.IsAbs(casePath) || !pathWithin(casePath, proof.RuntimeRoot) || !pathWithin(proof.RepositoryPath, proof.RuntimeRoot) ||
		filepath.Clean(proof.RepositoryPath) == filepath.Clean(proof.SourceRepositoryPath) {
		return fmt.Errorf("case or copied repository path is outside the private runtime, or aliases the source repository")
	}
	if !pathWithin(proof.TrustAnchorPath, proof.RuntimeRoot) || pathWithin(proof.TrustAnchorPath, proof.RepositoryPath) {
		return fmt.Errorf("public trust anchor must be independently stored under runtime custody, outside the repository copy")
	}
	if len(proof.References) == 0 || proof.ExpectedFileCount != 104 || proof.ExpectedLogicalBytes != 2_486_895 ||
		proof.ExpectedWorkspaceID == "" || proof.ExpectedSubjectRef == "" || proof.ExpectedAnnotationID == "" ||
		proof.ExpectedRevision < 1 || proof.ExpectedBody == "" || proof.ExpectedBodyBytes < 0 {
		return fmt.Errorf("case lacks required Note, reference, or frozen-corpus identity fields")
	}
	body := []byte(proof.ExpectedBody)
	digest := sha256.Sum256(body)
	if int64(len(body)) != proof.ExpectedBodyBytes || hex.EncodeToString(digest[:]) != proof.ExpectedBodySHA256 {
		return fmt.Errorf("expected Note body does not match its declared UTF-8 byte length and SHA-256")
	}
	for _, reference := range proof.References {
		if reference.SnapshotRef == "" || !filepath.IsAbs(reference.Path) || !pathWithin(reference.Path, proof.RuntimeRoot) ||
			pathWithin(reference.Path, proof.RepositoryPath) {
			return fmt.Errorf("each recovery reference must be an absolute independently retained runtime artifact outside the repository copy")
		}
	}
	return nil
}

func pathWithin(child, parent string) bool {
	childAbs, err := filepath.Abs(child)
	if err != nil {
		return false
	}
	parentAbs, err := filepath.Abs(parent)
	if err != nil {
		return false
	}
	relative, err := filepath.Rel(parentAbs, childAbs)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func assertReferenceNamesLatestFactChild(reference RecoveryReference, chain []PortableFactClosureEnvelope) error {
	if len(reference.PortableFactClosures) == 0 || len(chain) == 0 {
		return fmt.Errorf("reference or repository chain has no portable fact child")
	}
	want, err := chain[len(chain)-1].Closure.Digest()
	if err != nil {
		return err
	}
	got := reference.PortableFactClosures[len(reference.PortableFactClosures)-1].ClosureDigest
	if got != want || reference.PortableFactClosures[len(reference.PortableFactClosures)-1].Envelope.Closure.ClosureSequence != chain[len(chain)-1].Closure.ClosureSequence {
		return fmt.Errorf("exported reference does not carry the latest authenticated fact successor")
	}
	return nil
}

func assertCurrentNoteRevision(t *testing.T, latest PortableFactClosureEnvelope, proof actualNoteReaderCase) {
	t.Helper()
	var bundle portableFactBundle
	if err := decodeStrictRecord(latest.Bundle, &bundle); err != nil {
		t.Fatalf("decode latest authenticated fact bundle: %v", err)
	}
	found := false
	for _, record := range bundle.Records {
		if record.RecordKind != "ANNOTATION_REVISION" {
			continue
		}
		var revision sqlite.AnnotationRevision
		if err := decodeStrictRecord(record.Payload, &revision); err != nil {
			t.Fatalf("decode portable annotation revision %s: %v", record.RecordID, err)
		}
		if revision.AnnotationID != proof.ExpectedAnnotationID || revision.Revision != proof.ExpectedRevision {
			continue
		}
		if found {
			t.Fatalf("latest closure duplicates the expected Note identity/revision")
		}
		found = true
		if revision.Kind != sqlite.AnnotationNote || revision.WorkspaceID != proof.ExpectedWorkspaceID ||
			revision.SubjectRef != proof.ExpectedSubjectRef || record.StableSubjectRef != proof.ExpectedSubjectRef ||
			record.RecordID != revision.ID || record.Revision != proof.ExpectedRevision ||
			revision.Body != proof.ExpectedBody || revision.BodyDigest != "sha256:"+proof.ExpectedBodySHA256 ||
			int64(len([]byte(revision.Body))) != proof.ExpectedBodyBytes || DigestBytes([]byte(revision.Body)) != revision.BodyDigest ||
			revision.Tombstoned || !revision.HistoryComplete {
			t.Fatalf("portable Note revision does not match the exact expected saved identity/body/lifecycle: %+v", revision)
		}
	}
	if !found {
		t.Fatalf("latest complete-state fact successor does not contain expected Note %s revision %d", proof.ExpectedAnnotationID, proof.ExpectedRevision)
	}
}
