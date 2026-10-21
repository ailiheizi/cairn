package search

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

func TestLexicalSubjectCoverageRequiresCurrentGenerationBinding(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	engine := &Engine{Dir: t.TempDir()}
	const configDigest = "sha256:readiness-binding-test"
	indexer := &Indexer{
		Store: store, Engine: engine, ConfigDigest: configDigest,
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4),
	}
	old, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:readiness-v4", seed.RootID)
	if err != nil {
		t.Fatalf("build V4 generation: %v", err)
	}
	if old.ProviderProfileDigest != ProfileDigest(DimensionLexical, LexicalProfileV4) {
		t.Fatalf("V4 generation profile = %q", old.ProviderProfileDigest)
	}
	oldBytes, err := os.ReadFile(old.DBPath)
	if err != nil {
		t.Fatalf("read V4 generation: %v", err)
	}

	indexer.LexicalProfileDigest = ProfileDigest(DimensionLexical, LexicalProfileV5)
	if covered, err := indexer.LexicalSubjectCoverageForWorkspace(ctx, seed.WorkspaceID); !errors.Is(err, ErrUnavailable) || covered != nil {
		t.Fatalf("V5 reader coverage over V4 generation = %#v, %v; want unavailable and no subjects", covered, err)
	}

	// The profile matches again, but a current configuration mismatch still
	// refuses the generation rather than exposing its subjects as current.
	indexer.LexicalProfileDigest = ProfileDigest(DimensionLexical, LexicalProfileV4)
	indexer.ConfigDigest = "sha256:other-config"
	if covered, err := indexer.LexicalSubjectCoverageForWorkspace(ctx, seed.WorkspaceID); !errors.Is(err, ErrUnavailable) || covered != nil {
		t.Fatalf("wrong-config coverage = %#v, %v; want unavailable and no subjects", covered, err)
	}
	indexer.ConfigDigest = configDigest
	if covered, err := indexer.LexicalSubjectCoverageForWorkspace(ctx, seed.WorkspaceID); err != nil || len(covered) == 0 {
		t.Fatalf("matching V4 coverage = %#v, %v; want subjects", covered, err)
	}

	indexer.LexicalProfileDigest = ProfileDigest(DimensionLexical, LexicalProfileV5)
	current, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:readiness-v5", seed.RootID)
	if err != nil {
		t.Fatalf("build V5 generation: %v", err)
	}
	if current.ID == old.ID || current.ProviderProfileDigest != ProfileDigest(DimensionLexical, LexicalProfileV5) {
		t.Fatalf("current generation = %+v; want a distinct V5 generation", current)
	}
	covered, err := indexer.LexicalSubjectCoverageForWorkspace(ctx, seed.WorkspaceID)
	if err != nil || len(covered) == 0 {
		t.Fatalf("matching V5 coverage = %#v, %v; want subjects", covered, err)
	}
	oldBytesAfter, err := os.ReadFile(old.DBPath)
	if err != nil {
		t.Fatalf("read old V4 generation after current rebuild: %v", err)
	}
	if string(oldBytesAfter) != string(oldBytes) {
		t.Fatal("checking current binding or rebuilding V5 changed old V4 database bytes")
	}

	missingWorkspace, err := sqlite.NewStableID(sqlite.IDPrefixWorkspace)
	if err != nil {
		t.Fatalf("allocate missing workspace: %v", err)
	}
	if _, err := indexer.LexicalSubjectCoverageForWorkspace(ctx, missingWorkspace); !errors.Is(err, sqlite.ErrNotFound) {
		t.Fatalf("missing generation error = %v, want sqlite.ErrNotFound", err)
	}
	if covered, err := (*Indexer)(nil).LexicalSubjectCoverageForWorkspace(ctx, seed.WorkspaceID); !errors.Is(err, ErrUnavailable) || covered != nil {
		t.Fatalf("nil indexer coverage = %#v, %v; want unavailable and no subjects", covered, err)
	}
	if covered, err := (&Indexer{Store: store}).LexicalSubjectCoverageForWorkspace(ctx, seed.WorkspaceID); !errors.Is(err, ErrUnavailable) || covered != nil {
		t.Fatalf("nil engine coverage = %#v, %v; want unavailable and no subjects", covered, err)
	}
}
