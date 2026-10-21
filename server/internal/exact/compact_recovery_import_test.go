package exact

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/repository"
)

func compactReferenceFromV2ForTest(t *testing.T, reference RecoveryReference) RecoveryReferenceV3 {
	t.Helper()
	facts := make([]RecoveryFactDescriptor, 0, len(reference.PortableFactClosures))
	for _, fact := range reference.PortableFactClosures {
		closure := fact.Envelope.Closure
		facts = append(facts, RecoveryFactDescriptor{
			RecordRole:               repository.RecordPortableFactClosure,
			RecordDigest:             fact.RecordDigest,
			ClosureDigest:            fact.ClosureDigest,
			ClosureSequence:          closure.ClosureSequence,
			PredecessorClosureDigest: closure.PredecessorClosureDigest,
		})
	}
	return RecoveryReferenceV3{
		Schema:                     RecoveryReferenceSchemaV3,
		SnapshotRef:                reference.SnapshotRef,
		PublicationDomain:          reference.PublicationDomain,
		Repository:                 reference.Repository,
		RequiredTrustAnchor:        reference.RequiredTrustAnchor,
		PublicationCommitDigest:    reference.PublicationCommitDigest,
		PublicationCommit:          reference.PublicationCommit,
		PreparedClosure:            RecoveryRecordDescriptor{RecordRole: repository.RecordPreparedClosure, RecordDigest: reference.PreparedClosureDigest},
		FactHealth:                 reference.FactHealth,
		PortableFactClosures:       facts,
		RequiredReaderDependencies: append([]string(nil), reference.RequiredReaderDependencies...),
		CriticalExtensions:         append([]string{}, reference.CriticalExtensions...),
		OptionalExtensions:         append([]byte(nil), reference.OptionalExtensions...),
	}
}

func TestCompactRecoveryArtifactImportAndMigrationPreserveSelectedReference(t *testing.T) {
	ctx := context.Background()
	repoRoot, _, legacyPath, anchorPath, anchor, result := cleanInstallFixture(t)
	reader := openCleanInstallReader(t, repoRoot, anchor)
	v2, err := reader.BuildRecoveryReference(ctx, result.SnapshotRef)
	if err != nil {
		t.Fatalf("build reference fixture: %v", err)
	}
	v3 := compactReferenceFromV2ForTest(t, v2)
	encoded, err := MarshalCompactRecoveryReference(v3)
	if err != nil {
		t.Fatalf("marshal compact reference: %v", err)
	}
	artifactPath := filepath.Join(t.TempDir(), "compact-reference.json")
	if err := os.WriteFile(artifactPath, encoded, 0o600); err != nil {
		t.Fatal(err)
	}

	imported, err := reader.ImportRecoveryArtifact(ctx, artifactPath, anchorPath, testPublicationDomain)
	if err != nil {
		t.Fatalf("import compact reference: %v", err)
	}
	if imported.Schema != RecoveryReferenceSchemaV3 || imported.SnapshotRef != result.SnapshotRef ||
		imported.ManifestDigest != result.ManifestDigest || imported.CommitDigest != result.PublicationCommitDigest ||
		imported.FactHealth != v3.FactHealth || imported.CatalogCreated {
		t.Fatalf("compact import result = %+v", imported)
	}

	migratedPath := filepath.Join(t.TempDir(), "migrated-reference.json")
	migrated, err := reader.MigrateRecoveryArtifact(ctx, artifactPath, anchorPath, migratedPath, testPublicationDomain)
	if err != nil {
		t.Fatalf("migrate compact reference: %v", err)
	}
	if migrated.Schema != RecoveryReferenceSchemaV3 || migrated.SnapshotRef != result.SnapshotRef ||
		migrated.ManifestDigest != result.ManifestDigest || !migrated.IndependentlyStored {
		t.Fatalf("compact migration result = %+v", migrated)
	}
	migratedBytes, err := os.ReadFile(migratedPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(migratedBytes, encoded) {
		t.Fatal("v3 migration changed the selected reference bytes")
	}
	if _, err := os.Stat(legacyPath); err != nil {
		t.Fatalf("migration removed its legacy source: %v", err)
	}
}

func TestGenericSignedExportSelectsBoundedReferenceSchema(t *testing.T) {
	ctx := context.Background()
	repoRoot, _, _, _, anchor, result := cleanInstallFixture(t)
	reader := openCleanInstallReader(t, repoRoot, anchor)
	destination := filepath.Join(t.TempDir(), "recovery-reference.json")
	exported, err := reader.ExportRecoveryArtifact(ctx, result.SnapshotRef, destination)
	if err != nil {
		t.Fatalf("generic signed export: %v", err)
	}
	if exported.Schema != RecoveryReferenceSchemaV2 {
		t.Fatalf("small generic signed export selected schema %q, want v2", exported.Schema)
	}
	if exported.SnapshotRef != result.SnapshotRef || exported.ManifestDigest != result.ManifestDigest ||
		!exported.IndependentlyStored || exported.Length <= 0 {
		t.Fatalf("generic signed export result = %+v", exported)
	}
	v2, err := reader.BuildRecoveryReference(ctx, result.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	want, err := MarshalRecoveryReference(v2)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("small generic signed export differs from the existing v2 artifact bytes")
	}
}
