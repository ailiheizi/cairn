package controlplane

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
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

// TestPlanIngestPublishesALargeRootAsOnePublicationWithOneNamespaceRoot is the
// operator-facing half of the convergence-phase fix. A root whose monolithic
// portable record would exceed the repository bound is planned and applied as
// ONE publication with ONE namespace root: the oversized logical records are
// placed as content-addressed parts, the operational content.list projection
// reports every entry without any projection change, and no placed record
// exceeds the bound.
func TestPlanIngestPublishesALargeRootAsOnePublicationWithOneNamespaceRoot(t *testing.T) {
	ctx := context.Background()
	// A plain-file capture with a bound processor projects about 21 KB per
	// entry and really places about 15 KB of portable fact records per entry,
	// so this many entries make the placed child cross the 16 MiB record bound
	// while its data volume is far below it.
	const files = 1200
	fixture := newPlanIngestFixture(t, files)
	planned := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpPlanIngest, map[string]any{"root": fixture.source}))
	if planned.Status != command.StatusSucceeded {
		t.Fatalf("large plan.ingest = %q %+v", planned.Status, planned.Reasons)
	}
	var plan command.PlanIngestData
	if err := json.Unmarshal(planned.Data, &plan); err != nil {
		t.Fatal(err)
	}
	applied := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpPlanApply, map[string]any{
		"workspace_id": plan.WorkspaceID, "plan_id": plan.PlanID, "plan_digest": plan.PlanDigest,
	}))
	if applied.Status != command.StatusSucceeded {
		t.Fatalf("large plan.apply = %q %+v", applied.Status, applied.Reasons)
	}

	// One publication, one namespace root in the rebuildable projection.
	counts := catalogTableCounts(t, fixture.catalogPath)
	if counts["publications"] != 1 {
		t.Fatalf("publications = %d, want exactly one", counts["publications"])
	}
	if counts["namespace_roots"] != 1 {
		t.Fatalf("namespace_roots = %d, want exactly one", counts["namespace_roots"])
	}

	// The operational view reports every entry, so no projection needed a change.
	listed := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpContentList, map[string]any{"workspace_id": plan.WorkspaceID}))
	if listed.Status != command.StatusSucceeded {
		t.Fatalf("content.list = %q %+v", listed.Status, listed.Reasons)
	}
	var content command.ContentListData
	if err := json.Unmarshal(listed.Data, &content); err != nil {
		t.Fatal(err)
	}
	if content.Page == nil || content.Page.Entries == nil {
		t.Fatalf("content.list carried no complete page block: %+v", content.Page)
	}
	if *content.Page.Entries != files {
		t.Fatalf("content.list entries = %d, want %d", *content.Page.Entries, files)
	}
	if len(content.Items) != files {
		t.Fatalf("content.list returned %d items, want %d", len(content.Items), files)
	}

	// The repository placed content-addressed parts and nothing above the bound.
	parts, err := fixture.repo.ListRecordDigests(ctx, repository.RecordPart)
	if err != nil {
		t.Fatal(err)
	}
	if len(parts) == 0 {
		t.Fatal("the oversized publication placed no content-addressed record parts")
	}
	for _, role := range []repository.RecordRole{
		repository.RecordPreparedClosure, repository.RecordPublicationCommit,
		repository.RecordProcessorAttemptClosure, repository.RecordPortableFactClosure, repository.RecordPart,
	} {
		digests, err := fixture.repo.ListRecordDigests(ctx, role)
		if err != nil {
			t.Fatal(err)
		}
		for _, digest := range digests {
			body, err := fixture.repo.OpenRecord(ctx, role, digest)
			if err != nil {
				t.Fatal(err)
			}
			payload, readErr := io.ReadAll(body)
			closeErr := body.Close()
			if readErr != nil {
				t.Fatal(readErr)
			}
			if closeErr != nil {
				t.Fatal(closeErr)
			}
			if int64(len(payload)) > repository.MaxRecordBytes {
				t.Fatalf("%s %s is %d bytes, above the %d-byte bound", role, digest, len(payload), repository.MaxRecordBytes)
			}
		}
	}
	commits, err := fixture.repo.ListRecordDigests(ctx, repository.RecordPublicationCommit)
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) != 1 {
		t.Fatalf("publication commits = %d, want exactly one publication", len(commits))
	}
}
