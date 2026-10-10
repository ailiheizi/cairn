package controlplane

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/testutil"
)

// mustTestDispatcher builds the shared catalog-only dispatcher, which wires no
// repository at all.
func mustTestDispatcher(t *testing.T) *Dispatcher {
	t.Helper()
	dispatcher, _ := newTestDispatcher(t)
	return dispatcher
}

// capabilityDispatcherWithRepository builds a daemon dispatcher whose exact
// lane owns a real directory CAS.
func capabilityDispatcherWithRepository(t *testing.T) (*Dispatcher, repository.Driver) {
	t.Helper()
	store := testutil.OpenStore(t, ":memory:")
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatal(err)
	}
	return NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock", WithExact(&exact.Service{
		Store: store,
		Repo:  repo,
	})), repo
}

// readerClosureRows decodes capability.list and returns the reader-closure
// rows keyed by dependency name.
func readerClosureRows(t *testing.T, dispatcher *Dispatcher) map[string]command.Capability {
	t.Helper()
	result := dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpCapabilityList, map[string]any{}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("capability.list = %q: %+v", result.Status, result.Reasons)
	}
	var data command.CapabilityListData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	rows := map[string]command.Capability{}
	for _, capability := range data.Capabilities {
		if capability.Kind != capabilityKindReaderClosure {
			continue
		}
		rows[capability.ID] = capability
	}
	return rows
}

// TestCapabilityListReportsReaderClosureOnlyWhenRepositoryIsWired proves the
// declaration is a projection of a real repository: without one, no
// reader-closure row exists, and with one, every dependency the codec needs is
// reported with its retention class, rebuild procedure, and verification.
func TestCapabilityListReportsReaderClosureOnlyWhenRepositoryIsWired(t *testing.T) {
	if rows := readerClosureRows(t, mustTestDispatcher(t)); len(rows) != 0 {
		t.Fatalf("reader closure rows without a wired repository = %+v", rows)
	}
	dispatcher, repo := capabilityDispatcherWithRepository(t)
	rows := readerClosureRows(t, dispatcher)
	profile := repository.DescribeProfile(repo)
	summary, ok := rows["repository-reader-closure"]
	if !ok {
		t.Fatalf("wired repository produced no reader-closure summary: %+v", rows)
	}
	if summary.State != command.CapabilityAvailable || !strings.Contains(summary.Notes, profile.Repository) {
		t.Fatalf("reader-closure summary = %+v, want an available row naming %s", summary, profile.Repository)
	}
	closure, err := repository.ReaderClosureForRepository(repo)
	if err != nil {
		t.Fatal(err)
	}
	for _, declaration := range closure.Declarations {
		row, ok := rows[declaration.Dependency]
		if !ok {
			t.Fatalf("reader closure row for %q is missing: %+v", declaration.Dependency, rows)
		}
		if row.Version == "" || len(row.Version) != len("sha256:")+64 {
			t.Fatalf("row %q version = %q, want the declaration digest", declaration.Dependency, row.Version)
		}
		for _, want := range []string{declaration.Role, declaration.Retention, declaration.Verify} {
			if want != "" && !strings.Contains(row.Notes, want) {
				t.Fatalf("row %q notes omit %q: %s", declaration.Dependency, want, row.Notes)
			}
		}
	}
	if rows[repository.ReaderDependencyDirectoryCASDev].State != command.CapabilityAvailable {
		t.Fatalf("identity decoder row = %+v, want AVAILABLE", rows[repository.ReaderDependencyDirectoryCASDev])
	}
	if rows[repository.ReaderDependencyPortableFactReaderV1].State != command.CapabilityAvailable ||
		rows[repository.ReaderDependencyPortableFactReaderV2].State != command.CapabilityAvailable {
		t.Fatalf("reader profile rows = %+v, want both generations AVAILABLE", rows)
	}
}

// TestRecoveryReaderCapabilityListReportsItsOwnClosure proves the clean reader
// itself answers what it can decode: the rows come from the repository the
// reader opened, and no catalog, index, or processor claim appears beside them.
func TestRecoveryReaderCapabilityListReportsItsOwnClosure(t *testing.T) {
	reader, _, _, _, _ := openRecoveryReaderDispatcher(t)
	rows := readerClosureRows(t, reader)
	if rows["repository-reader-closure"].State != command.CapabilityAvailable {
		t.Fatalf("recovery reader closure summary = %+v", rows["repository-reader-closure"])
	}
	if _, ok := rows[repository.ReaderDependencyDirectoryCASDev]; !ok {
		t.Fatalf("recovery reader did not report its codec decoder: %+v", rows)
	}
	if _, ok := rows[repository.ReaderDependencyLocalZstdV1]; ok {
		t.Fatalf("recovery reader reported a codec it did not open: %+v", rows)
	}
}
