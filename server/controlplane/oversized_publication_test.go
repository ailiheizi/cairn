package controlplane

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	_ "modernc.org/sqlite"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

// noopPublicationProcessor keeps the dispatcher from attaching its real
// processor host, so a test publication places exactly the records derived from
// its own manifest. The pre-flight projection still charges the measured
// post-publication allowance because the service has a processor bound.
type noopPublicationProcessor struct{}

func (noopPublicationProcessor) ProcessPublication(context.Context, string, string, string) error {
	return nil
}

type planIngestFixture struct {
	dispatcher  *Dispatcher
	store       *sqlite.Store
	repo        *repository.Dir
	catalogPath string
	source      string
}

func newPlanIngestFixture(t *testing.T, files int) planIngestFixture {
	t.Helper()
	return newPlanIngestFixtureWith(t, files, nil)
}

func newPlanIngestFixtureWith(t *testing.T, files int, decorate func(t *testing.T, path string)) planIngestFixture {
	t.Helper()
	catalogPath := filepath.Join(t.TempDir(), "catalog.sqlite")
	store := testutil.OpenStore(t, catalogPath)
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatal(err)
	}
	identity, anchor, err := exact.OpenSigningMaterial(t.TempDir(), "workspace:default", true)
	if err != nil {
		t.Fatal(err)
	}
	service := &exact.Service{
		Store: store, Repo: repo, SigningIdentity: &identity, TrustAnchor: &anchor,
		PublicationDomain: "workspace:default", RequireSignedPublication: true,
		ConfigDigest: "sha256:plan-ingest-guard-config",
		Processor:    noopPublicationProcessor{},
	}
	dispatcher := NewDispatcher(store, catalogPath, filepath.Join(t.TempDir(), "cairnd.sock"), WithExact(service))
	source := t.TempDir()
	for index := 0; index < files; index++ {
		path := filepath.Join(source, fmt.Sprintf("entry-%04d.txt", index))
		if err := os.WriteFile(path, []byte(fmt.Sprintf("payload %04d", index)), 0o600); err != nil {
			t.Fatal(err)
		}
		if decorate != nil {
			decorate(t, path)
		}
	}
	return planIngestFixture{dispatcher: dispatcher, store: store, repo: repo, catalogPath: catalogPath, source: source}
}

// catalogTableCounts reports the durable rows a refused plan must not have
// created. Anything above zero means the refusal happened after a durable write.
func catalogTableCounts(t *testing.T, catalogPath string) map[string]int {
	t.Helper()
	db, err := sql.Open("sqlite", catalogPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tables := []string{
		"workspaces", "sources", "scan_generations", "plans", "jobs", "publications",
		"namespace_roots", "namespace_entries", "observations", "file_versions",
		"representations", "protection_records", "recovery_references", "audit_events",
	}
	counts := make(map[string]int, len(tables))
	for _, table := range tables {
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		counts[table] = count
	}
	return counts
}

// TestPlanIngestRefusesOversizedPublicationBeforeAnyDurableWrite is the
// operator-facing half of the pre-flight guard. An ingest whose publication
// would place a portable record above the repository bound is refused as
// ordinary invalid input, with the entry count, the projected size, the limit,
// and the split-into-sources remedy, and with no plan, job, publication,
// namespace, or repository record left behind.
func TestPlanIngestRefusesOversizedPublicationBeforeAnyDurableWrite(t *testing.T) {
	ctx := context.Background()
	// A plain-file capture with a bound processor projects about 21 KB per
	// entry, so this many entries cross the 16 MiB record bound without relying
	// on platform-specific extended attributes.
	fixture := newPlanIngestFixture(t, 900)
	result := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpPlanIngest, map[string]any{"root": fixture.source}))
	if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeInvalidInput) {
		t.Fatalf("oversized plan.ingest = %q %+v, want a failed invalid_input refusal", result.Status, result.Reasons)
	}
	if len(result.Reasons) != 1 {
		t.Fatalf("oversized refusal reasons = %+v, want exactly one", result.Reasons)
	}
	message := result.Reasons[0].Message
	for _, fragment := range []string{
		"ingest subfolders as separate sources",
		strconv.FormatInt(repository.MaxRecordBytes, 10) + "-byte repository record limit",
		"entries",
	} {
		if !strings.Contains(message, fragment) {
			t.Fatalf("refusal %q is missing %q", message, fragment)
		}
	}
	if measured := reportedRecordBytes(t, message); measured <= repository.MaxRecordBytes {
		t.Fatalf("refusal reports %d bytes, want more than the %d-byte limit", measured, repository.MaxRecordBytes)
	}
	if result.Reasons[0].Resolution != nil {
		t.Fatalf("a refusal must not offer a reconciliation resolution: %+v", result.Reasons[0].Resolution)
	}
	for table, count := range catalogTableCounts(t, fixture.catalogPath) {
		if count != 0 {
			t.Fatalf("refused plan.ingest left %d %s rows", count, table)
		}
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
			t.Fatalf("refused plan.ingest placed %d %s records", len(digests), role)
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
