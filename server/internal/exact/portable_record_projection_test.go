package exact

import (
	"context"
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

// TestInspectIngestRefusesPublicationAboveTheRecordBound proves the refusal is
// decided while planning. The oversized capture must not create a workspace, a
// plan, a repository object, or any record placement: inspection is read-only.
func TestInspectIngestRefusesPublicationAboveTheRecordBound(t *testing.T) {
	ctx := context.Background()
	// A plain-file capture projects about 15 KB of portable fact records per
	// entry, so this many entries cross the 16 MiB per-record bound with room
	// to spare and without relying on platform-specific extended attributes.
	fixture := newProjectionFixture(t, 1200)
	if !fixture.projection.ExceedsLimit() {
		t.Fatalf("fixture does not exceed the record bound: %+v", fixture.projection)
	}
	_, err := fixture.service.InspectIngest(ctx, fixture.source, IngestOptions{})
	if !errors.Is(err, ErrPortableRecordTooLarge) {
		t.Fatalf("oversized inspect ingest = %v, want ErrPortableRecordTooLarge", err)
	}
	message := err.Error()
	for _, fragment := range []string{
		"ingest subfolders as separate sources",
		strconv.FormatInt(repository.MaxRecordBytes, 10) + "-byte repository record limit",
		fmt.Sprintf("for %d entries", fixture.projection.Entries),
	} {
		if !strings.Contains(message, fragment) {
			t.Fatalf("refusal %q is missing %q", message, fragment)
		}
	}
	// The measured size in the message comes from the inspection that refused,
	// which is a second capture of the same tree; only its bound matters here.
	measured := reportedRecordBytes(t, message)
	if measured <= repository.MaxRecordBytes {
		t.Fatalf("refusal reports %d bytes, want more than the %d-byte limit", measured, repository.MaxRecordBytes)
	}
	if count, err := fixture.store.CountPlans(ctx); err != nil || count != 0 {
		t.Fatalf("refused inspection recorded %d plans (err=%v)", count, err)
	}
	if _, err := fixture.store.GetWorkspaceByName(ctx, defaultWorkspaceName); !errors.Is(err, sqlite.ErrNotFound) {
		t.Fatalf("refused inspection created a catalog workspace: %v", err)
	}
	for _, role := range []repository.RecordRole{
		repository.RecordPreparedClosure, repository.RecordPublicationCommit,
		repository.RecordProcessorAttemptClosure, repository.RecordPortableFactClosure,
	} {
		digests, err := fixture.repo.ListRecordDigests(ctx, role)
		if err != nil {
			t.Fatal(err)
		}
		if len(digests) != 0 {
			t.Fatalf("refused inspection placed %d %s records", len(digests), role)
		}
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
