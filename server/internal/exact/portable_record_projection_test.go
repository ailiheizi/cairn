package exact

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// projectionFixture is a read-only capture plus a signed-publication service,
// so a test can compare the plan-time projection with the records the apply
// path actually places.
type projectionFixture struct {
	service    *Service
	store      *sqlite.Store
	repo       *repository.Dir
	source     string
	projection PublicationRecordProjection
}

func newProjectionFixture(t *testing.T, files int) projectionFixture {
	t.Helper()
	return newProjectionFixtureWith(t, files, nil)
}

// newProjectionFixtureWith builds the fixture and lets a test decorate each
// created file (for example with a large extended attribute) before the
// capture that the projection measures.
func newProjectionFixtureWith(t *testing.T, files int, decorate func(t *testing.T, path string)) projectionFixture {
	t.Helper()
	ctx := context.Background()
	source := t.TempDir()
	for index := 0; index < files; index++ {
		name := fmt.Sprintf("entry-%04d.txt", index)
		payload := []byte(strings.Repeat(string(rune('a'+index%26)), 8+index%24))
		path := filepath.Join(source, name)
		if err := os.WriteFile(path, payload, 0o600); err != nil {
			t.Fatal(err)
		}
		if decorate != nil {
			decorate(t, path)
		}
	}
	if err := os.MkdirAll(filepath.Join(source, "nested"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "nested", "leaf.txt"), []byte("nested leaf"), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := sqlite.Open(ctx, filepath.Join(t.TempDir(), "catalog.sqlite"), sqlite.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatal(err)
	}
	identity, anchor, err := OpenSigningMaterial(t.TempDir(), testPublicationDomain, true)
	if err != nil {
		t.Fatal(err)
	}
	// No Processor is bound, so the publication places only the records derived
	// from its own manifest. That is exactly the part the projection computes
	// without the measured post-publication allowance.
	service := &Service{
		Store: store, Repo: repo, SigningIdentity: &identity, TrustAnchor: &anchor,
		PublicationDomain: testPublicationDomain, RequireSignedPublication: true,
		ConfigDigest: "sha256:projection-test-config",
	}
	policy, err := service.resolveIngestOptions(IngestOptions{})
	if err != nil {
		t.Fatal(err)
	}
	captured, err := service.captureForIngest(ctx, source, "")
	if err != nil {
		t.Fatal(err)
	}
	defer captured.session.Close()
	boundLocators, err := bindIngestLocators(captured.sink.entries, policy)
	if err != nil {
		t.Fatal(err)
	}
	decisions, err := buildProtectionDecisionsWithResolutions(captured.sink.entries, policy, boundLocators)
	if err != nil {
		t.Fatal(err)
	}
	protectionDigest, err := protectionDecisionDigest(decisions)
	if err != nil {
		t.Fatal(err)
	}
	basis, err := captureBasisDigest(captured.binding, captured.sink.entries)
	if err != nil {
		t.Fatal(err)
	}
	projection, err := service.projectPublicationRecords(
		captured.sink.entries, policy, boundLocators, captured.binding, basis, protectionDigest)
	if err != nil {
		t.Fatal(err)
	}
	return projectionFixture{service: service, store: store, repo: repo, source: source, projection: projection}
}

func placedFactClosureBytes(t *testing.T, ctx context.Context, repo *repository.Dir, role repository.RecordRole) int64 {
	t.Helper()
	digests, err := repo.ListRecordDigests(ctx, role)
	if err != nil {
		t.Fatal(err)
	}
	if len(digests) != 1 {
		t.Fatalf("%s records = %d, want 1", role, len(digests))
	}
	payload, err := readRecord(ctx, repo, role, digests[0])
	if err != nil {
		t.Fatal(err)
	}
	return int64(len(payload))
}

// TestProjectedPublicationRecordsMatchThePlacedRecords is the exactness proof
// for the pre-flight check: with no processor bound, the apply path places only
// records derived from the publication's own manifest, and the plan-time
// projection of both entry-scaling records equals them. The projection is
// allowed to be slightly larger because a few signed-block fields (generation,
// fence token, parent digest and signed-at precision) cannot be known before
// apply and are pinned to their widest encoding; it must never be smaller, or
// the guard would let an unplaceable publication through.
func TestProjectedPublicationRecordsMatchThePlacedRecords(t *testing.T) {
	ctx := context.Background()
	fixture := newProjectionFixture(t, 24)
	if fixture.projection.Entries == 0 {
		t.Fatal("projection counted no entries")
	}
	if fixture.projection.ExceedsLimit() {
		t.Fatalf("fixture already exceeds the limit: %+v", fixture.projection)
	}
	plan, err := fixture.service.InspectIngest(ctx, fixture.source, IngestOptions{})
	if err != nil {
		t.Fatalf("inspect ingest: %v", err)
	}
	result, err := fixture.service.ApplyIngestPlanWithExecutionKey(ctx, plan, "sha256:projection-test-plan")
	if err != nil {
		t.Fatalf("apply ingest: %v", err)
	}
	if result.PreparedClosureDigest == "" || result.PublicationCommitDigest == "" {
		t.Fatalf("apply did not publish a signed closure: %+v", result)
	}
	preparedBytes := placedFactClosureBytes(t, ctx, fixture.repo, repository.RecordPreparedClosure)
	factBytes := placedFactClosureBytes(t, ctx, fixture.repo, repository.RecordPortableFactClosure)
	for _, record := range []struct {
		role      repository.RecordRole
		projected int64
		placed    int64
	}{
		{repository.RecordPreparedClosure, fixture.projection.PreparedClosureBytes, preparedBytes},
		{repository.RecordPortableFactClosure, fixture.projection.PortableFactClosureBytes, factBytes},
	} {
		if record.projected < record.placed {
			t.Fatalf("%s projection = %d under-reports the placed %d bytes", record.role, record.projected, record.placed)
		}
		if slack := record.projected - record.placed; slack > 512 {
			t.Fatalf("%s projection = %d, placed = %d: slack %d bytes is not the documented placeholder width",
				record.role, record.projected, record.placed, slack)
		} else {
			t.Logf("%s projected=%d placed=%d slack=%d", record.role, record.projected, record.placed, slack)
		}
	}
}

// TestLargePublicationIsOnePublicationWithOneNamespaceRoot is the
// convergence-phase fix at the exact-package level. A source root whose
// monolithic portable record would exceed the repository bound is published as
// one publication: the oversized logical records are placed as content-addressed
// parts, the authenticated reader reassembles the complete manifest, and every
// placed record stays inside the bound. No projection changes are involved.
func TestLargePublicationIsOnePublicationWithOneNamespaceRoot(t *testing.T) {
	ctx := context.Background()
	fixture := newProjectionFixture(t, 1200)
	if fixture.projection.ExceedsLimit() {
		t.Fatalf("a large publication must still be placeable: %+v", fixture.projection)
	}
	if fixture.projection.LargestBytes() <= repository.MaxRecordBytes {
		t.Fatalf("fixture does not exceed the monolithic record bound: %+v", fixture.projection)
	}
	if fixture.projection.LargestItemBytes > repository.MaxRecordBytes {
		t.Fatalf("fixture has an unsplittable single item: %+v", fixture.projection)
	}
	plan, err := fixture.service.InspectIngest(ctx, fixture.source, IngestOptions{})
	if err != nil {
		t.Fatalf("large inspect ingest: %v", err)
	}
	if _, err := fixture.service.ApplyIngestPlanWithExecutionKey(ctx, plan, "sha256:multi-part-plan"); err != nil {
		t.Fatalf("large apply: %v", err)
	}
	for _, role := range []repository.RecordRole{
		repository.RecordPreparedClosure, repository.RecordPublicationCommit, repository.RecordPortableFactClosure,
	} {
		digests, err := fixture.repo.ListRecordDigests(ctx, role)
		if err != nil {
			t.Fatal(err)
		}
		if len(digests) != 1 {
			t.Fatalf("%s records = %d, want exactly one publication", role, len(digests))
		}
	}
	for _, role := range []repository.RecordRole{
		repository.RecordPreparedClosure, repository.RecordPublicationCommit,
		repository.RecordPortableFactClosure, repository.RecordPart,
	} {
		digests, err := fixture.repo.ListRecordDigests(ctx, role)
		if err != nil {
			t.Fatal(err)
		}
		for _, digest := range digests {
			payload, err := readRecord(ctx, fixture.repo, role, digest)
			if err != nil {
				t.Fatalf("%s %s: %v", role, digest, err)
			}
			if int64(len(payload)) > repository.MaxRecordBytes {
				t.Fatalf("%s %s is %d bytes, above the %d-byte bound", role, digest, len(payload), repository.MaxRecordBytes)
			}
		}
	}
	parts, err := fixture.repo.ListRecordDigests(ctx, repository.RecordPart)
	if err != nil {
		t.Fatal(err)
	}
	if len(parts) == 0 {
		t.Fatal("the oversized publication placed no content-addressed record parts")
	}
	commits, err := fixture.repo.ListRecordDigests(ctx, repository.RecordPublicationCommit)
	if err != nil {
		t.Fatal(err)
	}
	commitPayload, err := readRecord(ctx, fixture.repo, repository.RecordPublicationCommit, commits[0])
	if err != nil {
		t.Fatal(err)
	}
	var commit PublicationCommitRecord
	if err := decodeStrictRecord(commitPayload, &commit); err != nil {
		t.Fatal(err)
	}
	// Whichever logical record the projection says is oversized must be placed
	// in the part-bound v3 shape; the other stays monolithic.
	wantPreparedV3 := fixture.projection.PreparedClosureBytes > repository.MaxRecordBytes
	wantFactV3 := fixture.projection.PortableFactClosureBytes > repository.MaxRecordBytes
	if !wantPreparedV3 && !wantFactV3 {
		t.Fatal("fixture is not oversized for either logical record")
	}
	preparedPayload, err := readRecord(ctx, fixture.repo, repository.RecordPreparedClosure, commit.PreparedObjectDigest)
	if err != nil {
		t.Fatal(err)
	}
	var envelope PreparedClosureEnvelope
	if err := decodeStrictRecord(preparedPayload, &envelope); err != nil {
		t.Fatal(err)
	}
	if wantPreparedV3 {
		if envelope.Schema != PreparedEnvelopeSchemaV3 || len(envelope.ManifestParts) == 0 {
			t.Fatalf("prepared envelope = schema %q with %d parts, want the part-bound v3 shape", envelope.Schema, len(envelope.ManifestParts))
		}
	} else if envelope.Schema != PreparedEnvelopeSchemaV2 || len(envelope.ManifestParts) != 0 {
		t.Fatalf("prepared envelope = schema %q with %d parts, want the monolithic v2 shape", envelope.Schema, len(envelope.ManifestParts))
	}
	factDigests, err := fixture.repo.ListRecordDigests(ctx, repository.RecordPortableFactClosure)
	if err != nil {
		t.Fatal(err)
	}
	factPayload, err := readRecord(ctx, fixture.repo, repository.RecordPortableFactClosure, factDigests[0])
	if err != nil {
		t.Fatal(err)
	}
	var factEnvelope PortableFactClosureEnvelope
	if err := decodeStrictRecord(factPayload, &factEnvelope); err != nil {
		t.Fatal(err)
	}
	if wantFactV3 {
		if factEnvelope.Schema != PortableFactClosureEnvelopeSchemaV3 || len(factEnvelope.BundleParts) == 0 {
			t.Fatalf("portable fact envelope = schema %q with %d parts, want the part-bound v3 shape", factEnvelope.Schema, len(factEnvelope.BundleParts))
		}
	} else if factEnvelope.Schema != PortableFactClosureEnvelopeSchemaV2 || len(factEnvelope.BundleParts) != 0 {
		t.Fatalf("portable fact envelope = schema %q with %d parts, want the monolithic v2 shape", factEnvelope.Schema, len(factEnvelope.BundleParts))
	}
	publications, err := fixture.service.committedPublications(ctx)
	if err != nil {
		t.Fatalf("committed publications: %v", err)
	}
	if len(publications) != 1 {
		t.Fatalf("committed publications = %d, want 1", len(publications))
	}
	if got, want := len(publications[0].Manifest.Entries), fixture.projection.Entries; got != want {
		t.Fatalf("reassembled manifest entries = %d, want %d", got, want)
	}
	if publications[0].Manifest.ManifestDigest != commit.ManifestDigest {
		t.Fatalf("reassembled manifest digest = %s, want the signed %s", publications[0].Manifest.ManifestDigest, commit.ManifestDigest)
	}
	closures, err := listPortableFactClosures(ctx, fixture.repo, fixture.repo, *fixture.service.TrustAnchor, testPublicationDomain, commits[0])
	if err != nil {
		t.Fatalf("portable fact closures: %v", err)
	}
	if len(closures) != 1 {
		t.Fatalf("portable fact closures = %d, want 1", len(closures))
	}
	if int64(len(closures[0].Bundle)) != closures[0].Closure.BundleLength {
		t.Fatalf("reassembled bundle = %d bytes, want the signed %d", len(closures[0].Bundle), closures[0].Closure.BundleLength)
	}
	if DigestBytes(closures[0].Bundle) != closures[0].Closure.BundleDigest {
		t.Fatal("reassembled bundle digest differs from the signed BundleDigest")
	}
}

// TestProjectionRefusesAnUnsplittableSingleItem keeps the pre-flight refusal for
// the only entry-scaling case a part split cannot place: one logical item larger
// than the per-record bound.
func TestProjectionRefusesAnUnsplittableSingleItem(t *testing.T) {
	projection := PublicationRecordProjection{
		Entries: 1, Limit: repository.MaxRecordBytes, LargestItemBytes: repository.MaxRecordBytes + 1,
	}
	if !projection.ExceedsLimit() {
		t.Fatal("an unsplittable single item must exceed the record bound")
	}
	refusal := projection.Refusal()
	if !errors.Is(refusal, ErrPortableRecordTooLarge) {
		t.Fatalf("refusal = %v, want ErrPortableRecordTooLarge", refusal)
	}
	message := refusal.Error()
	for _, fragment := range []string{
		"one item cannot be split across record parts",
		strconv.FormatInt(repository.MaxRecordBytes, 10) + "-byte repository record limit",
		"for 1 entries",
	} {
		if !strings.Contains(message, fragment) {
			t.Fatalf("refusal %q is missing %q", message, fragment)
		}
	}
	if measured := reportedRecordBytes(t, message); measured <= repository.MaxRecordBytes {
		t.Fatalf("refusal reports %d bytes, want more than the %d-byte limit", measured, repository.MaxRecordBytes)
	}
}

// TestManifestPartSplitterRefusesAnOversizedEntry proves the splitter itself,
// not only the gate, refuses an atomic item it cannot place.
func TestManifestPartSplitterRefusesAnOversizedEntry(t *testing.T) {
	oversized := json.RawMessage(`"` + strings.Repeat("A", int(repository.MaxRecordBytes)+1024) + `"`)
	manifest := Manifest{
		Schema: SnapshotSchemaV2, SnapshotRef: "snap:splitter-test",
		ManifestDigest: DigestBytes([]byte("splitter-test")),
		Entries:        []ManifestEntry{{RelativePath: "huge", RawPath: []byte("huge"), EntryType: "file", MetadataAfter: oversized}},
	}
	if _, err := buildManifestEntryParts(manifest, manifest.ManifestDigest); !errors.Is(err, ErrPortableRecordTooLarge) {
		t.Fatalf("oversized entry split = %v, want ErrPortableRecordTooLarge", err)
	}
}

var reportedRecordPattern = regexp.MustCompile(`would place a ([0-9]+)-byte portable recovery record`)

// reportedRecordBytes reads the measured size out of one refusal message.
func reportedRecordBytes(t *testing.T, message string) int64 {
	t.Helper()
	match := reportedRecordPattern.FindStringSubmatch(message)
	if match == nil {
		t.Fatalf("refusal %q does not name the projected record size", message)
	}
	value, err := strconv.ParseInt(match[1], 10, 64)
	if err != nil {
		t.Fatalf("refusal size %q: %v", match[1], err)
	}
	return value
}
