package sqlite

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

func TestSchemaStatusReportsCurrentLedger(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	defer store.Close()

	status := store.SchemaStatus(ctx)
	if status.State != SchemaStateCurrent {
		t.Fatalf("schema status = %+v, want %s", status, SchemaStateCurrent)
	}
	if status.Version == 0 || strings.TrimSpace(status.Name) == "" {
		t.Fatalf("schema ledger facts are missing: %+v", status)
	}
	if status.BinaryVersion != status.Version {
		t.Fatalf("binary schema version = %d, applied = %d; want equal after Open", status.BinaryVersion, status.Version)
	}
	if status.Reason != "" {
		t.Fatalf("current schema reported a reason: %+v", status)
	}
}

// TestSchemaStatusSurfacesLedgerProblemsAsFacts proves the open-time
// ErrSchemaTooNew and ErrMigrationDrift conditions are reported as facts with
// reasons, and that an unreadable ledger is UNKNOWN rather than a healthy
// zero-version catalog.
func TestSchemaStatusSurfacesLedgerProblemsAsFacts(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "catalog.sqlite")
	store := openTestStore(t, path)
	defer store.Close()

	current := store.SchemaStatus(ctx)
	if current.State != SchemaStateCurrent {
		t.Fatalf("precondition: schema status = %+v, want %s", current, SchemaStateCurrent)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open side connection: %v", err)
	}
	defer db.Close()

	if _, err := db.ExecContext(ctx, `
INSERT INTO schema_migrations(version, name, checksum, applied_at_ns)
VALUES (?, 'future_migration', 'future-checksum', 0)`, current.BinaryVersion+1); err != nil {
		t.Fatalf("insert newer ledger row: %v", err)
	}
	newer := store.SchemaStatus(ctx)
	if newer.State != SchemaStateNewerThanBinary {
		t.Fatalf("newer schema status = %+v, want %s", newer, SchemaStateNewerThanBinary)
	}
	if !strings.Contains(newer.Reason, "newer") || newer.Version != current.BinaryVersion+1 {
		t.Fatalf("newer schema fact = %+v, want the applied version and a reason", newer)
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM schema_migrations WHERE version = ?`, current.BinaryVersion+1); err != nil {
		t.Fatalf("remove newer ledger row: %v", err)
	}

	if _, err := db.ExecContext(ctx,
		`UPDATE schema_migrations SET checksum = 'drifted-checksum' WHERE version = ?`, current.BinaryVersion); err != nil {
		t.Fatalf("drift ledger row: %v", err)
	}
	drifted := store.SchemaStatus(ctx)
	if drifted.State != SchemaStateDrift {
		t.Fatalf("drifted schema status = %+v, want %s", drifted, SchemaStateDrift)
	}
	if !strings.Contains(drifted.Reason, "checksum") || drifted.Version != current.BinaryVersion {
		t.Fatalf("drift fact = %+v, want the applied version and a checksum reason", drifted)
	}
	if _, err := db.ExecContext(ctx,
		`UPDATE schema_migrations SET checksum = ? WHERE version = ?`, migrationChecksum(migrations[len(migrations)-1]), current.BinaryVersion); err != nil {
		t.Fatalf("restore ledger row: %v", err)
	}
	if restored := store.SchemaStatus(ctx); restored.State != SchemaStateCurrent {
		t.Fatalf("restored schema status = %+v, want %s", restored, SchemaStateCurrent)
	}

	if _, err := db.ExecContext(ctx, `DELETE FROM schema_migrations`); err != nil {
		t.Fatalf("clear ledger: %v", err)
	}
	empty := store.SchemaStatus(ctx)
	if empty.State != SchemaStateUnknown {
		t.Fatalf("empty ledger status = %+v, want %s", empty, SchemaStateUnknown)
	}
	if empty.Reason == "" || empty.Version != 0 {
		t.Fatalf("empty ledger fact = %+v, want no fabricated version and a reason", empty)
	}
}
