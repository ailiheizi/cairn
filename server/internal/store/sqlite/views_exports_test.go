package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

// exportManifestSidecarMigration is the migration that added the frozen
// sidecar policy column. The legacy-upgrade test replays every earlier
// migration to build a genuine pre-migration catalog.
const exportManifestSidecarMigration = 24

const exportManifestSidecarPolicy = "keep-metadata-and-subtitle-sidecars"

func exportManifestFixture(t *testing.T, digest string) ExportManifest {
	t.Helper()
	return ExportManifest{
		ManifestID:     testID(t, "exm"),
		ManifestDigest: digest,
		ViewID:         testID(t, "view"),
		Representation: "exact",
		Sidecars:       exportManifestSidecarPolicy,
		Target:         "album-directory",
		SubjectCount:   2,
		Items: []string{
			`{"subject_ref":"nse_00000000000000000000000000000001","output_name":"01-track.flac","exact":true}`,
			`{"subject_ref":"nse_00000000000000000000000000000002","output_name":"02-track.flac","exact":true}`,
		},
	}
}

func assertExportManifestMatches(t *testing.T, got, want ExportManifest) {
	t.Helper()
	if got.ManifestID != want.ManifestID || got.ManifestDigest != want.ManifestDigest ||
		got.ViewID != want.ViewID || got.Representation != want.Representation ||
		got.Sidecars != want.Sidecars || got.Target != want.Target ||
		got.SubjectCount != want.SubjectCount || len(got.Items) != len(want.Items) {
		t.Fatalf("export manifest = %+v, want %+v", got, want)
	}
	for index := range want.Items {
		if got.Items[index] != want.Items[index] {
			t.Fatalf("export manifest item %d = %q, want %q", index, got.Items[index], want.Items[index])
		}
	}
}

func TestExportManifestSidecarsRoundTripAcrossReadPathsAndReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "catalog.sqlite")
	store := openTestStore(t, path)

	manifest := exportManifestFixture(t, "sha256:"+strings.Repeat("ab", 32))
	inserted, err := store.InsertExportManifest(ctx, manifest)
	if err != nil {
		t.Fatalf("InsertExportManifest: %v", err)
	}
	if inserted.Sidecars != exportManifestSidecarPolicy {
		t.Fatalf("inserted sidecar policy = %q, want %q", inserted.Sidecars, exportManifestSidecarPolicy)
	}

	byID, err := store.GetExportManifestByID(ctx, manifest.ManifestID)
	if err != nil {
		t.Fatalf("GetExportManifestByID: %v", err)
	}
	assertExportManifestMatches(t, byID, manifest)

	byDigest, err := store.GetExportManifestByDigest(ctx, manifest.ManifestDigest)
	if err != nil {
		t.Fatalf("GetExportManifestByDigest: %v", err)
	}
	assertExportManifestMatches(t, byDigest, manifest)

	listed, err := store.ListExportManifests(ctx)
	if err != nil {
		t.Fatalf("ListExportManifests: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("listed manifests = %+v", listed)
	}
	assertExportManifestMatches(t, listed[0], manifest)

	// Re-inserting the same frozen record is idempotent.
	if _, err := store.InsertExportManifest(ctx, manifest); err != nil {
		t.Fatalf("idempotent insert: %v", err)
	}
	// The same id and digest with a different sidecar policy is a conflict:
	// the column is covered by the frozen digest, so a divergent projection
	// must fail closed instead of silently keeping the stored policy.
	conflicting := manifest
	conflicting.Sidecars = "drop-sidecars"
	if _, err := store.InsertExportManifest(ctx, conflicting); !errors.Is(err, ErrConflict) {
		t.Fatalf("conflicting sidecar insert error = %v, want ErrConflict", err)
	}
	// A divergent digest under the same id keeps failing closed.
	divergent := manifest
	divergent.ManifestDigest = "sha256:" + strings.Repeat("cd", 32)
	if _, err := store.InsertExportManifest(ctx, divergent); !errors.Is(err, ErrConflict) {
		t.Fatalf("divergent digest insert error = %v, want ErrConflict", err)
	}

	// A fresh store handle on the same database file must observe the same
	// sidecar policy: the value is durably persisted, not cached in memory.
	if err := store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}
	reopened := openTestStore(t, path)
	defer reopened.Close()

	afterReopen, err := reopened.GetExportManifestByID(ctx, manifest.ManifestID)
	if err != nil {
		t.Fatalf("GetExportManifestByID after reopen: %v", err)
	}
	assertExportManifestMatches(t, afterReopen, manifest)

	afterReopenDigest, err := reopened.GetExportManifestByDigest(ctx, manifest.ManifestDigest)
	if err != nil {
		t.Fatalf("GetExportManifestByDigest after reopen: %v", err)
	}
	assertExportManifestMatches(t, afterReopenDigest, manifest)

	reopenedList, err := reopened.ListExportManifests(ctx)
	if err != nil {
		t.Fatalf("ListExportManifests after reopen: %v", err)
	}
	if len(reopenedList) != 1 {
		t.Fatalf("listed manifests after reopen = %+v", reopenedList)
	}
	assertExportManifestMatches(t, reopenedList[0], manifest)
}

// TestExportManifestSidecarsMigrationUpgradesLegacyDatabase builds a real
// pre-migration catalog by replaying every admitted migration before the
// sidecar-policy one, writes one manifest row in the pre-migration shape, and
// then proves that opening the store upgrades the catalog without changing the
// legacy row: the added column defaults to the empty policy those manifests
// were planned with, so the record keeps its digest and replays idempotently.
func TestExportManifestSidecarsMigrationUpgradesLegacyDatabase(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy.sqlite")

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open legacy database: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at_ns INTEGER NOT NULL
) STRICT`); err != nil {
		t.Fatalf("create legacy migration ledger: %v", err)
	}
	for _, item := range migrations {
		if item.version >= exportManifestSidecarMigration {
			break
		}
		if _, err := db.ExecContext(ctx, item.sql); err != nil {
			t.Fatalf("apply legacy migration %d (%s): %v", item.version, item.name, err)
		}
		if _, err := db.ExecContext(ctx,
			`INSERT INTO schema_migrations(version, name, checksum, applied_at_ns) VALUES (?, ?, ?, ?)`,
			item.version, item.name, migrationChecksum(item), testEpoch.UnixNano()); err != nil {
			t.Fatalf("record legacy migration %d: %v", item.version, err)
		}
	}
	var sidecarColumns int
	if err := db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM pragma_table_info('export_manifests') WHERE name = 'sidecars'`).Scan(&sidecarColumns); err != nil {
		t.Fatalf("inspect legacy export manifest columns: %v", err)
	}
	if sidecarColumns != 0 {
		t.Fatalf("legacy database unexpectedly has %d sidecar columns", sidecarColumns)
	}
	legacyID := testID(t, "exm")
	legacyDigest := "sha256:" + strings.Repeat("11", 32)
	if _, err := db.ExecContext(ctx, `
INSERT INTO export_manifests(
    manifest_id, manifest_digest, view_id, representation, target,
    subject_count, created_at_ns, items_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		legacyID, legacyDigest, "", "exact", "", 1, testEpoch.UnixNano(),
		`["{\"subject_ref\":\"nse_00000000000000000000000000000001\",\"output_name\":\"legacy.bin\",\"exact\":false}"]`); err != nil {
		t.Fatalf("write legacy manifest row: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close legacy database: %v", err)
	}

	store := openTestStore(t, path)
	defer store.Close()
	version, err := store.SchemaVersion(ctx)
	if err != nil {
		t.Fatalf("SchemaVersion: %v", err)
	}
	if want := migrations[len(migrations)-1].version; version != want {
		t.Fatalf("upgraded schema version = %d, want %d", version, want)
	}

	legacy, err := store.GetExportManifestByID(ctx, legacyID)
	if err != nil {
		t.Fatalf("GetExportManifestByID after upgrade: %v", err)
	}
	if legacy.Sidecars != "" {
		t.Fatalf("legacy manifest sidecar policy = %q, want the empty pre-migration policy", legacy.Sidecars)
	}
	if legacy.ManifestDigest != legacyDigest {
		t.Fatalf("legacy manifest digest = %q, want %q", legacy.ManifestDigest, legacyDigest)
	}

	byDigest, err := store.GetExportManifestByDigest(ctx, legacyDigest)
	if err != nil {
		t.Fatalf("GetExportManifestByDigest after upgrade: %v", err)
	}
	if byDigest.Sidecars != "" || byDigest.ManifestDigest != legacyDigest {
		t.Fatalf("legacy manifest by digest = %+v", byDigest)
	}

	listed, err := store.ListExportManifests(ctx)
	if err != nil {
		t.Fatalf("ListExportManifests after upgrade: %v", err)
	}
	if len(listed) != 1 || listed[0].ManifestID != legacyID ||
		listed[0].ManifestDigest != legacyDigest || listed[0].Sidecars != "" {
		t.Fatalf("listed legacy manifests = %+v", listed)
	}

	// The stored empty policy is exactly the value the frozen digest was
	// planned with, so replaying the record stays idempotent.
	if _, err := store.InsertExportManifest(ctx, legacy); err != nil {
		t.Fatalf("replay upgraded legacy manifest: %v", err)
	}
}
