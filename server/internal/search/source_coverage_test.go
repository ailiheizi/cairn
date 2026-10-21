package search

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

func TestLexicalSourceCoverageBindsSelectedSourcesToGeneration(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	tagID, noteID := mustSearchID(t, sqlite.IDPrefixAnnotation), mustSearchID(t, sqlite.IDPrefixAnnotation)
	for _, annotation := range []sqlite.Annotation{
		{ID: tagID, WorkspaceID: seed.WorkspaceID, SubjectRef: seed.FileEntryID, Kind: sqlite.AnnotationTag, Body: "Favorite", Revision: 1},
		{ID: noteID, WorkspaceID: seed.WorkspaceID, SubjectRef: seed.FileEntryID, Kind: sqlite.AnnotationNote, Body: "durable note v1", Revision: 1},
	} {
		if err := store.CreateAnnotation(ctx, &annotation); err != nil {
			t.Fatalf("create annotation: %v", err)
		}
	}
	for _, document := range []sqlite.DescriptionDocument{
		{ID: mustSearchID(t, sqlite.IDPrefixDescription), WorkspaceID: seed.WorkspaceID, SubjectRef: seed.FileEntryID, Kind: sqlite.DescriptionUser, Title: "Accepted", Language: "en", Body: "accepted source body", SourceRef: "user", ProducerProfile: "human", Accepted: true, Revision: 1},
		{ID: mustSearchID(t, sqlite.IDPrefixDescription), WorkspaceID: seed.WorkspaceID, SubjectRef: seed.FileEntryID, Kind: sqlite.DescriptionImported, Title: "Rejected", Language: "en", Body: "rejected source body", SourceRef: "import", ProducerProfile: "importer", Accepted: false, Revision: 1},
	} {
		if err := store.InsertDescriptionDocument(ctx, &document); err != nil {
			t.Fatalf("insert description: %v", err)
		}
	}
	seedExtractedText(t, store, seed, seed.FileEntryID, "admitted extracted source   ")
	seedExtractedText(t, store, seed, seed.DirEntryID, "")
	seedExtractedText(t, store, seed, seed.SymlinkEntryID, "   ")
	indexer := &Indexer{Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:source-coverage-config",
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4)}
	generation, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:source-coverage", seed.RootID)
	if err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	coverage, err := indexer.CoverageGeneration(ctx, seed.WorkspaceID, generation)
	if err != nil {
		t.Fatalf("coverage: %v", err)
	}
	if coverage.SourceCoverage == nil || !coverage.SourceCoverage.Available || !coverage.SourceCoverage.Complete {
		t.Fatalf("source coverage = %+v", coverage.SourceCoverage)
	}
	wrongBinding := generation
	wrongBinding.ID = mustSearchID(t, sqlite.IDPrefixIndexGeneration)
	wrongBindingCoverage, err := indexer.CoverageGeneration(ctx, seed.WorkspaceID, wrongBinding)
	if err != nil || wrongBindingCoverage.SourceCoverage == nil || wrongBindingCoverage.SourceCoverage.Available ||
		wrongBindingCoverage.SourceCoverage.Reason != SourceCoverageReasonSourceProofInvalid {
		t.Fatalf("generation metadata swap was accepted: %+v err=%v", wrongBindingCoverage.SourceCoverage, err)
	}
	seen := map[string]int{}
	for _, row := range coverage.SourceCoverage.Rows {
		seen[row.SourceKind]++
		if row.SourceKind == "DESCRIPTION" && row.SourceSubtype == string(sqlite.DescriptionImported) {
			// Rejected descriptions remain in the lexical selected-source scope.
		}
	}
	for _, sourceKind := range []string{"FILENAME", "TAG", "NOTE", "DESCRIPTION", "EXTRACT"} {
		if seen[sourceKind] == 0 {
			t.Errorf("source kind %s missing from report: %+v", sourceKind, coverage.SourceCoverage.Rows)
		}
	}
	if seen["DESCRIPTION"] != 2 {
		t.Errorf("description revisions = %d, want accepted and rejected revisions", seen["DESCRIPTION"])
	}
	if seen["EXTRACT"] != 3 {
		t.Errorf("extract artifacts = %d, want trailing-whitespace, empty, and whitespace-only sources", seen["EXTRACT"])
	}

	// A later catalog revision must not change the generation-local denominator.
	if err := store.ReviseAnnotation(ctx, seed.WorkspaceID, noteID, 1, "durable note v2", false, time.Now().UTC()); err != nil {
		t.Fatalf("revise note after build: %v", err)
	}
	afterCatalogChange, err := indexer.CoverageGeneration(ctx, seed.WorkspaceID, generation)
	if err != nil || afterCatalogChange.SourceCoverage == nil || !afterCatalogChange.SourceCoverage.Complete ||
		afterCatalogChange.SourceCoverage.Expected != coverage.SourceCoverage.Expected {
		t.Fatalf("historical generation changed after catalog revision: coverage=%+v err=%v", afterCatalogChange.SourceCoverage, err)
	}

	// Corrupting the actual generation field invalidates its exact source proof.
	db, err := sql.Open("sqlite", generation.DBPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET notes = 'changed after generation build' WHERE subject_id = ?`, seed.FileEntryID); err != nil {
		_ = db.Close()
		t.Fatalf("mutate generation field: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	changed, err := indexer.CoverageGeneration(ctx, seed.WorkspaceID, generation)
	if err != nil || changed.SourceCoverage == nil || changed.SourceCoverage.Complete || changed.SourceCoverage.Missing == 0 {
		t.Fatalf("changed source field was reported complete: coverage=%+v err=%v", changed.SourceCoverage, err)
	}
}

func TestSourceCoverageDetailLimitPreservesCountsAndBadRowsFirst(t *testing.T) {
	records := make(map[string]sourceCoverageRecord, SourceCoverageDetailLimit+44)
	for i := 0; i < SourceCoverageDetailLimit+44; i++ {
		disposition := SourceCoverageIndexed
		reason := ""
		if i == 299 {
			disposition, reason = SourceCoverageMissing, SourceCoverageReasonSourceMissing
		} else if i == 298 {
			disposition, reason = SourceCoverageUnavailable, SourceCoverageReasonSourceChanged
		}
		row := sourceCoverageRecord{SourceCoverageRow: SourceCoverageRow{
			SourceKind: "NOTE", Field: "notes", SourceRef: "source-" + strconv.Itoa(i), Revision: "1",
			Disposition: disposition, Reason: reason,
		}, SubjectID: "subject"}
		records[sourceCoverageIdentity(row)] = row
	}
	var statement SourceCoverageStatement
	finalizeSourceCoverage(&statement, records)
	if statement.Expected != 300 || statement.Indexed != 298 || statement.Missing != 1 || statement.Unavailable != 1 || statement.Complete {
		t.Fatalf("full counts or completion = %+v", statement)
	}
	if !statement.Truncated || len(statement.Rows) != SourceCoverageDetailLimit {
		t.Fatalf("detail bound = truncated:%t rows:%d", statement.Truncated, len(statement.Rows))
	}
	if statement.Rows[0].Disposition == SourceCoverageIndexed || statement.Rows[1].Disposition == SourceCoverageIndexed {
		t.Fatalf("bad records were not prioritized: first rows=%+v", statement.Rows[:2])
	}
	var second SourceCoverageStatement
	finalizeSourceCoverage(&second, records)
	if !reflect.DeepEqual(statement.Rows, second.Rows) {
		t.Fatal("bounded detail ordering was not deterministic")
	}
}

func TestLexicalSourceCoverageUsesAnchorCommitmentForMissingRows(t *testing.T) {
	ctx := context.Background()
	makeGeneration := func(t *testing.T) (*Indexer, *sqlite.Store, string, sqlite.IndexGeneration) {
		t.Helper()
		store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
		seed := testutil.SeedNamespace(t, store)
		indexer := &Indexer{Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:source-coverage-anchor",
			LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4)}
		generation, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:source-coverage-anchor", seed.RootID)
		if err != nil {
			t.Fatalf("rebuild: %v", err)
		}
		return indexer, store, seed.WorkspaceID, generation
	}
	findDocs := func(t *testing.T, path string) (string, string) {
		t.Helper()
		db, err := sql.Open("sqlite", path)
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		rows, err := db.QueryContext(ctx, `SELECT rowid, segments FROM documents ORDER BY rowid`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		anchorRow, fragmentRow := "", ""
		for rows.Next() {
			var rowid, raw string
			if err := rows.Scan(&rowid, &raw); err != nil {
				t.Fatal(err)
			}
			var projection lexicalSegmentProjection
			if err := json.Unmarshal([]byte(raw), &projection); err != nil {
				t.Fatal(err)
			}
			var marker lexicalSourceCoverageProjection
			if err := json.Unmarshal(projection.SourceCoverage, &marker); err != nil {
				t.Fatal(err)
			}
			if marker.Role == "ANCHOR" {
				anchorRow = rowid
			} else if marker.Role == "FRAGMENT" && fragmentRow == "" {
				fragmentRow = rowid
			}
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return anchorRow, fragmentRow
	}
	t.Run("non-anchor source row deletion remains missing", func(t *testing.T) {
		indexer, _, workspaceID, generation := makeGeneration(t)
		_, fragment := findDocs(t, generation.DBPath)
		if fragment == "" {
			t.Fatal("generation has no non-anchor fragment")
		}
		db, err := sql.Open("sqlite", generation.DBPath)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `DELETE FROM documents WHERE rowid = ?`, fragment); err != nil {
			_ = db.Close()
			t.Fatalf("delete non-anchor document: %v", err)
		}
		_ = db.Close()
		coverage, err := indexer.CoverageGeneration(ctx, workspaceID, generation)
		if err != nil || coverage.SourceCoverage == nil || coverage.SourceCoverage.Complete || coverage.SourceCoverage.Missing == 0 {
			t.Fatalf("deleted source row was reported complete: %+v err=%v", coverage.SourceCoverage, err)
		}
	})
	t.Run("anchor deletion is typed unavailable", func(t *testing.T) {
		indexer, _, workspaceID, generation := makeGeneration(t)
		anchor, _ := findDocs(t, generation.DBPath)
		if anchor == "" {
			t.Fatal("generation has no source inventory anchor")
		}
		db, err := sql.Open("sqlite", generation.DBPath)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `DELETE FROM documents WHERE rowid = ?`, anchor); err != nil {
			_ = db.Close()
			t.Fatalf("delete source anchor: %v", err)
		}
		_ = db.Close()
		coverage, err := indexer.CoverageGeneration(ctx, workspaceID, generation)
		if err != nil || coverage.SourceCoverage == nil || coverage.SourceCoverage.Available ||
			coverage.SourceCoverage.Reason != SourceCoverageReasonAnchorMissing {
			t.Fatalf("deleted anchor source coverage = %+v err=%v", coverage.SourceCoverage, err)
		}
	})
}

func TestLexicalSourceCoverageKeepsUnavailableSourceDigestState(t *testing.T) {
	ctx := context.Background()
	catalogPath := filepath.Join(t.TempDir(), "catalog.sqlite")
	store := testutil.OpenStore(t, catalogPath)
	seed := testutil.SeedNamespace(t, store)
	noteID := mustSearchID(t, sqlite.IDPrefixAnnotation)
	if err := store.CreateAnnotation(ctx, &sqlite.Annotation{ID: noteID, WorkspaceID: seed.WorkspaceID,
		SubjectRef: seed.FileEntryID, Kind: sqlite.AnnotationNote, Body: "durable note", Revision: 1}); err != nil {
		t.Fatalf("create note: %v", err)
	}
	db, err := sql.Open("sqlite", catalogPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE annotations SET body_digest = ? WHERE annotation_id = ?`, "sha256:"+strings.Repeat("0", 64), noteID); err != nil {
		_ = db.Close()
		t.Fatalf("corrupt stored source digest: %v", err)
	}
	_ = db.Close()
	indexer := &Indexer{Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: "sha256:source-digest-state",
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4)}
	generation, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:source-digest-state", seed.RootID)
	if err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	coverage, err := indexer.CoverageGeneration(ctx, seed.WorkspaceID, generation)
	if err != nil {
		t.Fatalf("coverage: %v", err)
	}
	if coverage.SourceCoverage == nil || !coverage.SourceCoverage.Available || coverage.SourceCoverage.Complete ||
		coverage.SourceCoverage.Unavailable != 1 || coverage.SourceCoverage.Missing != 0 {
		t.Fatalf("source digest mismatch state = %+v", coverage.SourceCoverage)
	}
}

func TestSourceCoverageRevisionRequiresCanonicalPositiveDecimal(t *testing.T) {
	validDigest := "sha256:" + strings.Repeat("a", 64)
	base := sourceCoverageRecord{SourceCoverageRow: SourceCoverageRow{SourceKind: "NOTE", Field: "notes",
		SourceRef: "annotation-id", Revision: "1", SourceDigest: validDigest, Disposition: SourceCoverageIndexed},
		SubjectID: "subject-id", FieldStart: 0, FieldEnd: 1, FieldDigest: validDigest}
	if !validSourceCoverageRecord(base) {
		t.Fatal("valid canonical revision was rejected")
	}
	for _, revision := range []string{"abc", "0", "-1", "+1", "01"} {
		t.Run(revision, func(t *testing.T) {
			candidate := base
			candidate.Revision = revision
			if validSourceCoverageRecord(candidate) {
				t.Fatalf("noncanonical revision %q was accepted", revision)
			}
		})
	}
}

func TestLegacyLexicalProjectionHasTypedSourceCoverageUnavailable(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	path, err := engine.Build(ctx, "idx_legacycoverage000000000000000000", []Document{{
		SubjectID: "nse_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Name: "legacy.txt", Path: "legacy.txt",
	}})
	if err != nil {
		t.Fatalf("build legacy generation: %v", err)
	}
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	generation := sqlite.IndexGeneration{ID: "idx_legacycoverage000000000000000000", WorkspaceID: seed.WorkspaceID,
		SnapshotRef: "snapshot:legacy", NamespaceRootID: seed.RootID, Dimension: DimensionLexical, DBPath: path}
	indexer := &Indexer{Store: store, Engine: engine}
	coverage, err := indexer.CoverageGeneration(ctx, seed.WorkspaceID, generation)
	if err != nil {
		t.Fatalf("legacy coverage: %v", err)
	}
	if coverage.SourceCoverage == nil || coverage.SourceCoverage.Available || coverage.SourceCoverage.Complete ||
		coverage.SourceCoverage.Reason != SourceCoverageReasonLegacyProjection {
		t.Fatalf("legacy source coverage = %+v", coverage.SourceCoverage)
	}
	if _, err := engine.Query(ctx, path, "legacy", []string{AxisName}); err != nil {
		t.Fatalf("legacy generation search stopped working: %v", err)
	}
}
