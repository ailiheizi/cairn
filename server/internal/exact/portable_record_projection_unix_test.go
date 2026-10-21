//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd

package exact

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"golang.org/x/sys/unix"

	"github.com/ailiheizi/cairn/server/internal/repository"
)

// projectionXAttrBytes is the per-file extended attribute used to make a small
// entry count reach a large portable record. The captured value appears in the
// manifest entry and again in the portable fact child, both base64-encoded.
const projectionXAttrBytes = 46 << 10

// decorateProjectionFile attaches a large extended attribute, skipping the test
// when the filesystem does not permit test xattrs (the same convention the
// filesystem-fact tests use).
func decorateProjectionFile(t *testing.T, path string) {
	t.Helper()
	value := make([]byte, projectionXAttrBytes)
	for index := range value {
		value[index] = byte('A' + index%26)
	}
	if err := unix.Lsetxattr(filepath.Clean(path), "user.cairn.projection", value, 0); err != nil {
		t.Skipf("filesystem does not permit test xattrs: %v", err)
	}
}

// TestInspectIngestAcceptsPublicationJustUnderTheRecordBoundAndAppliesIt is the
// other half of the pre-flight guard: a publication sized close to the bound is
// still planned and applied, so the refusal does not take capability away from
// work that fits. A 46 KiB extended attribute per file leaves room for the
// authenticated catalog-relation witnesses while keeping the fact closure
// monolithic and the real apply cheap.
func TestInspectIngestAcceptsPublicationJustUnderTheRecordBoundAndAppliesIt(t *testing.T) {
	ctx := context.Background()
	fixture := newProjectionFixtureWith(t, 200, decorateProjectionFile)
	t.Logf("near_limit_projection prepared=%d fact=%d largest=%d", fixture.projection.PreparedClosureBytes, fixture.projection.PortableFactClosureBytes, fixture.projection.LargestBytes())
	if fixture.projection.ExceedsLimit() {
		t.Fatalf("near-limit fixture was refused: %+v", fixture.projection)
	}
	// The bound is only meaningful if the fixture actually approaches it.
	if largest := fixture.projection.LargestBytes(); largest <= repository.MaxRecordBytes*9/10 {
		t.Fatalf("projected largest record = %d, want more than 90%% of the %d-byte bound for a near-limit fixture",
			largest, repository.MaxRecordBytes)
	}
	plan, err := fixture.service.InspectIngest(ctx, fixture.source, IngestOptions{})
	if err != nil {
		t.Fatalf("near-limit inspect ingest: %v", err)
	}
	result, err := fixture.service.ApplyIngestPlanWithExecutionKey(ctx, plan, "sha256:near-limit-plan")
	if err != nil {
		t.Fatalf("near-limit apply: %v", err)
	}
	if result.PreparedClosureDigest == "" || result.PublicationCommitDigest == "" {
		t.Fatalf("near-limit apply did not publish a signed closure: %+v", result)
	}
	factBytes := placedFactClosureBytes(t, ctx, fixture.repo, repository.RecordPortableFactClosure)
	if factBytes >= repository.MaxRecordBytes {
		t.Fatalf("placed portable fact closure = %d bytes, at or above the %d-byte bound", factBytes, repository.MaxRecordBytes)
	}
	if factBytes <= repository.MaxRecordBytes/2 {
		t.Fatalf("placed portable fact closure = %d bytes is too small to prove a near-limit publication", factBytes)
	}

	preparedPayload := placedRecordPayload(t, ctx, fixture.repo, repository.RecordPreparedClosure)
	var prepared PreparedClosureEnvelope
	if err := decodeStrictRecord(preparedPayload, &prepared); err != nil {
		t.Fatalf("decode placed prepared record: %v", err)
	}
	factDigests, err := fixture.repo.ListRecordDigests(ctx, repository.RecordPortableFactClosure)
	if err != nil || len(factDigests) != 1 {
		t.Fatalf("list placed fact records: count=%d err=%v", len(factDigests), err)
	}
	factPayload, err := readRecord(ctx, fixture.repo, repository.RecordPortableFactClosure, factDigests[0])
	if err != nil {
		t.Fatalf("read placed fact record: %v", err)
	}
	var fact PortableFactClosureEnvelope
	if err := decodeStrictRecord(factPayload, &fact); err != nil {
		t.Fatalf("decode placed fact record: %v", err)
	}
	if prepared.Schema != PreparedEnvelopeSchemaV2 || fact.Schema != PortableFactClosureEnvelopeSchemaV2 {
		t.Fatalf("near-limit record schemas prepared=%q fact=%q, want monolithic v2 records", prepared.Schema, fact.Schema)
	}
	if len(prepared.ManifestParts) != 0 || len(fact.BundleParts) != 0 {
		t.Fatalf("near-limit fixture unexpectedly part-bound prepared=%d fact=%d", len(prepared.ManifestParts), len(fact.BundleParts))
	}
	t.Logf("prepared_record schema=%s bytes=%d digest=%s manifest_parts=%d", prepared.Schema, len(preparedPayload), DigestBytes(preparedPayload), len(prepared.ManifestParts))
	t.Logf("fact_record schema=%s bytes=%d digest=%s bundle_parts=%d", fact.Schema, len(factPayload), DigestBytes(factPayload), len(fact.BundleParts))

	// The v2 independent reference embeds the full authenticated fact body. This
	// fixture must cross the existing reader cap so generic export is justified
	// in selecting the descriptor-only v3 reference.
	v2, err := fixture.service.BuildRecoveryReference(ctx, result.SnapshotRef)
	if err != nil {
		t.Fatalf("build measured v2 reference: %v", err)
	}
	_, v2Err := MarshalRecoveryReference(v2)
	var sizeErr *RecoveryReferenceSizeError
	if !errors.Is(v2Err, ErrRecoveryReferenceTooLarge) || !errors.As(v2Err, &sizeErr) {
		t.Fatalf("measured v2 reference error = %v, want typed reader-size refusal", v2Err)
	}
	t.Logf("expanded_v2_reference bytes=%d limit=%d", sizeErr.SerializedBytes, sizeErr.LimitBytes)

	artifactPath := filepath.Join(t.TempDir(), "recovery-reference.json")
	exported, err := fixture.service.ExportRecoveryArtifact(ctx, result.SnapshotRef, artifactPath)
	if err != nil {
		t.Fatalf("generic bounded recovery export: %v", err)
	}
	if exported.Schema != RecoveryReferenceSchemaV3 || exported.Length <= 0 || exported.Length >= repository.MaxRecordBytes {
		t.Fatalf("generic export result = %+v, want bounded v3", exported)
	}
	artifact, err := os.ReadFile(artifactPath)
	if err != nil {
		t.Fatalf("read exported artifact: %v", err)
	}
	compact, err := DecodeCompactRecoveryReference(artifact)
	if err != nil {
		t.Fatalf("decode exported compact reference: %v", err)
	}
	if compact.SnapshotRef != result.SnapshotRef || len(compact.PortableFactClosures) != 1 {
		t.Fatalf("compact reference selection snapshot=%s facts=%d", compact.SnapshotRef, len(compact.PortableFactClosures))
	}
	t.Logf("exported_reference schema=%s bytes=%d sha256=%x fact_descriptors=%d", exported.Schema, len(artifact), sha256.Sum256(artifact), len(compact.PortableFactClosures))

	anchorPath := filepath.Join(t.TempDir(), "trust-anchor.json")
	if _, err := ExportTrustAnchor(*fixture.service.TrustAnchor, anchorPath); err != nil {
		t.Fatalf("retain independent public anchor: %v", err)
	}
	anchor, err := LoadTrustAnchor(anchorPath)
	if err != nil {
		t.Fatalf("load retained public anchor: %v", err)
	}
	reader := &Service{Repo: fixture.repo, TrustAnchor: &anchor, PublicationDomain: testPublicationDomain, RequireSignedPublication: true}
	imported, err := reader.ImportRecoveryArtifact(ctx, artifactPath, anchorPath, testPublicationDomain)
	if err != nil {
		t.Fatalf("catalog-free compact import: %v", err)
	}
	if imported.Schema != RecoveryReferenceSchemaV3 || imported.SnapshotRef != result.SnapshotRef || imported.FactHealth != RecoveryFactHealthComplete || imported.CatalogCreated || reader.Store != nil || reader.SigningIdentity != nil {
		t.Fatalf("catalog-free import result=%+v store=%p signer=%p", imported, reader.Store, reader.SigningIdentity)
	}
	if err := compact.ValidateAgainstRepository(ctx, reader.Repo, anchor); err != nil {
		t.Fatalf("catalog-free compact validation: %v", err)
	}
	restored := filepath.Join(t.TempDir(), "restored")
	restoreResult, err := reader.Restore(ctx, result.SnapshotRef, restored)
	if err != nil {
		t.Fatalf("catalog-free exact restore: %v", err)
	}
	wantFiles, wantBytes := manifestFileTotals(v2.PreparedClosure.Manifest)
	if restoreResult.Files != wantFiles || restoreResult.Bytes != wantBytes {
		t.Fatalf("restore totals = %d files/%d bytes, want %d/%d", restoreResult.Files, restoreResult.Bytes, wantFiles, wantBytes)
	}
	wantIdentity := projectionFileByteIdentities(t, fixture.source)
	gotIdentity := projectionFileByteIdentities(t, restored)
	if !reflect.DeepEqual(gotIdentity, wantIdentity) {
		t.Fatalf("restored exact path/hash/length set differs: got %d files, want %d", len(gotIdentity), len(wantIdentity))
	}
	t.Logf("catalog_free_restore files=%d bytes=%d exact_path_hash_length_match=true", restoreResult.Files, restoreResult.Bytes)
}

func placedRecordPayload(t *testing.T, ctx context.Context, repo *repository.Dir, role repository.RecordRole) []byte {
	t.Helper()
	digests, err := repo.ListRecordDigests(ctx, role)
	if err != nil {
		t.Fatalf("list %s records: %v", role, err)
	}
	if len(digests) != 1 {
		t.Fatalf("%s records = %d, want 1", role, len(digests))
	}
	payload, err := readRecord(ctx, repo, role, digests[0])
	if err != nil {
		t.Fatalf("read %s record: %v", role, err)
	}
	if len(payload) == 0 || int64(len(payload)) >= repository.MaxRecordBytes {
		t.Fatalf("placed %s record = %d bytes, want a non-empty monolithic record below %d", role, len(payload), repository.MaxRecordBytes)
	}
	return payload
}

func projectionFileByteIdentities(t *testing.T, root string) map[string]string {
	t.Helper()
	identities := make(map[string]string)
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		payload, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		digest := sha256.Sum256(payload)
		identities[filepath.ToSlash(relative)] = fmt.Sprintf("sha256:%x/%d", digest, len(payload))
		return nil
	})
	if err != nil {
		t.Fatalf("hash file paths under %s: %v", root, err)
	}
	return identities
}
