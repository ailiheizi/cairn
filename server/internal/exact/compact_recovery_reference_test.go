package exact

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestBuildRecoveryReferenceArtifactPreservesSmallV2Bytes(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "compact-small.txt", []byte("small v2 bytes stay compatible"))
	result := fixture.ingest(t, "sha256:compact-small-plan")
	legacy, err := fixture.service.BuildRecoveryReference(ctx, result.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	want, err := MarshalRecoveryReference(legacy)
	if err != nil {
		t.Fatal(err)
	}
	reader := compactCleanReader(fixture)
	artifact, err := reader.buildRecoveryReferenceArtifact(ctx, result.SnapshotRef)
	if err != nil {
		t.Fatalf("build small recovery artifact: %v", err)
	}
	if artifact.Schema != RecoveryReferenceSchemaV2 {
		t.Fatalf("small artifact schema = %q, want v2", artifact.Schema)
	}
	if !bytes.Equal(artifact.Payload, want) {
		t.Fatal("small artifact changed the existing canonical v2 bytes")
	}
}

func TestBuildRecoveryReferenceArtifactUsesCompactReferenceForAggregateHistory(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "compact-history.txt", []byte("exact bytes with retained history"))
	result := fixture.ingest(t, "sha256:compact-history-plan")
	subject := stableSubjectForSnapshotFile(t, fixture.service, result.SnapshotRef, "compact-history.txt")
	for i := 0; i < 2; i++ {
		id, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
		if err != nil {
			t.Fatal(err)
		}
		annotation := &sqlite.Annotation{
			ID: id, WorkspaceID: result.WorkspaceID, SubjectRef: subject,
			Kind: sqlite.AnnotationNote, Body: string(bytes.Repeat([]byte{'a' + byte(i)}, 5_600_000)), Revision: 1,
		}
		if err := fixture.store.CreateAnnotation(ctx, annotation); err != nil {
			t.Fatalf("create Note %d: %v", i+1, err)
		}
		if err := fixture.service.PublishPortableFactClosure(ctx, result.WorkspaceID, result.SnapshotRef, result.PublicationCommitDigest); err != nil {
			t.Fatalf("publish fact successor %d: %v", i+1, err)
		}
	}
	reader := compactCleanReader(fixture)
	artifact, err := reader.buildRecoveryReferenceArtifact(ctx, result.SnapshotRef)
	if err != nil {
		t.Fatalf("build compact recovery artifact: %v", err)
	}
	if artifact.Schema != RecoveryReferenceSchemaV3 {
		t.Fatalf("aggregate artifact schema = %q, want v3", artifact.Schema)
	}
	if int64(len(artifact.Payload)) > portableRecordReadLimit {
		t.Fatalf("compact artifact is %d bytes, above reader cap %d", len(artifact.Payload), portableRecordReadLimit)
	}
	decoded, err := DecodeCompactRecoveryReference(artifact.Payload)
	if err != nil {
		t.Fatalf("decode compact artifact: %v", err)
	}
	if len(decoded.PortableFactClosures) != 3 {
		t.Fatalf("compact fact prefix length = %d, want 3", len(decoded.PortableFactClosures))
	}
	if err := decoded.ValidateAgainstRepository(ctx, reader.Repo, *reader.TrustAnchor); err != nil {
		t.Fatalf("catalog-free compact validation: %v", err)
	}
}

func TestCompactReferenceKeepsFrozenPrefixWhenValidSuffixAppears(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "compact-prefix.txt", []byte("frozen prefix"))
	result := fixture.ingest(t, "sha256:compact-prefix-plan")
	v2, err := fixture.service.BuildRecoveryReference(ctx, result.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	v3 := compactReferenceFromV2ForPublicationTest(v2)
	encoded, err := MarshalCompactRecoveryReference(v3)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeCompactRecoveryReference(encoded)
	if err != nil {
		t.Fatal(err)
	}
	reader := compactCleanReader(fixture)
	if err := decoded.ValidateAgainstRepository(ctx, reader.Repo, *reader.TrustAnchor); err != nil {
		t.Fatalf("validate frozen prefix before suffix: %v", err)
	}
	subject := stableSubjectForSnapshotFile(t, fixture.service, result.SnapshotRef, "compact-prefix.txt")
	id, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.store.CreateAnnotation(ctx, &sqlite.Annotation{
		ID: id, WorkspaceID: result.WorkspaceID, SubjectRef: subject,
		Kind: sqlite.AnnotationTag, Body: "after-export", Revision: 1,
	}); err != nil {
		t.Fatal(err)
	}
	if err := fixture.service.PublishPortableFactClosure(ctx, result.WorkspaceID, result.SnapshotRef, result.PublicationCommitDigest); err != nil {
		t.Fatalf("publish valid later suffix: %v", err)
	}
	if err := decoded.ValidateAgainstRepository(ctx, reader.Repo, *reader.TrustAnchor); err != nil {
		t.Fatalf("valid later suffix changed the frozen prefix: %v", err)
	}
}

func TestCompactReferenceRequiresExplicitFactDescriptorArray(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "compact-null-array.txt", []byte("explicit arrays"))
	result := fixture.ingest(t, "sha256:compact-null-array-plan")
	v2, err := fixture.service.BuildRecoveryReference(ctx, result.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	empty := compactReferenceFromV2ForPublicationTest(v2)
	empty.FactHealth = RecoveryFactHealthIncomplete
	empty.PortableFactClosures = []RecoveryFactDescriptor{}
	empty.RequiredReaderDependencies = portableFactReaderDependencies(fixture.repo)
	payload, err := MarshalCompactRecoveryReference(empty)
	if err != nil {
		t.Fatalf("marshal valid empty-prefix reference: %v", err)
	}
	decoded, err := DecodeCompactRecoveryReference(payload)
	if err != nil || decoded.FactHealth != RecoveryFactHealthIncomplete || len(decoded.PortableFactClosures) != 0 {
		t.Fatalf("valid explicit empty prefix decoded as %+v, err=%v", decoded, err)
	}
	nilArray := empty
	nilArray.PortableFactClosures = nil
	if _, err := MarshalCompactRecoveryReference(nilArray); err == nil {
		t.Fatal("MarshalCompactRecoveryReference accepted a nil fact descriptor array")
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(payload, &object); err != nil {
		t.Fatal(err)
	}
	object["portable_fact_closures"] = json.RawMessage("null")
	malformed, err := json.Marshal(object)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeCompactRecoveryReference(malformed); err == nil {
		t.Fatal("compact reader accepted null portable_fact_closures on an otherwise valid empty prefix")
	}
}

func TestRecoveryReferenceSizeCalculationsMatchCanonicalPayloads(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "compact-size-math.txt", []byte("size estimator facts"))
	result := fixture.ingest(t, "sha256:compact-size-math-plan")
	subject := stableSubjectForSnapshotFile(t, fixture.service, result.SnapshotRef, "compact-size-math.txt")
	id, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.store.CreateAnnotation(ctx, &sqlite.Annotation{
		ID: id, WorkspaceID: result.WorkspaceID, SubjectRef: subject,
		Kind: sqlite.AnnotationTag, Body: "size-check", Revision: 1,
	}); err != nil {
		t.Fatal(err)
	}
	if err := fixture.service.PublishPortableFactClosure(ctx, result.WorkspaceID, result.SnapshotRef, result.PublicationCommitDigest); err != nil {
		t.Fatal(err)
	}
	v2, err := fixture.service.BuildRecoveryReference(ctx, result.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	if len(v2.PortableFactClosures) < 2 || len(v2.RequiredReaderDependencies) == 0 {
		t.Fatalf("size fixture has %d fact references and %d dependencies; want multiple facts and non-empty dependencies", len(v2.PortableFactClosures), len(v2.RequiredReaderDependencies))
	}
	v2ElementLengths := make([]int, 0, len(v2.PortableFactClosures))
	for _, fact := range v2.PortableFactClosures {
		encoded, err := CanonicalJSON(fact)
		if err != nil {
			t.Fatal(err)
		}
		v2ElementLengths = append(v2ElementLengths, len(encoded))
	}
	v2Payload, err := MarshalRecoveryReference(v2)
	if err != nil {
		t.Fatal(err)
	}
	v2Estimated, err := recoveryReferenceSize(v2, v2.RequiredReaderDependencies, v2ElementLengths)
	if err != nil {
		t.Fatal(err)
	}
	if v2Estimated != int64(len(v2Payload)) {
		t.Fatalf("v2 estimated size = %d, canonical size = %d", v2Estimated, len(v2Payload))
	}

	v3 := compactReferenceFromV2ForPublicationTest(v2)
	v3ElementBytes := int64(0)
	for _, descriptor := range v3.PortableFactClosures {
		encoded, err := CanonicalJSON(descriptor)
		if err != nil {
			t.Fatal(err)
		}
		v3ElementBytes += int64(len(encoded))
	}
	v3Payload, err := MarshalCompactRecoveryReference(v3)
	if err != nil {
		t.Fatal(err)
	}
	v3Estimated, err := compactRecoveryReferenceSize(v3, v3.RequiredReaderDependencies, v3ElementBytes, len(v3.PortableFactClosures))
	if err != nil {
		t.Fatal(err)
	}
	if v3Estimated != int64(len(v3Payload)) {
		t.Fatalf("v3 estimated size = %d, canonical size = %d", v3Estimated, len(v3Payload))
	}
}

func compactCleanReader(fixture signedPublicationFixture) *Service {
	return &Service{
		Repo: fixture.repo, TrustAnchor: fixture.service.TrustAnchor,
		PublicationDomain: testPublicationDomain, RequireSignedPublication: true,
	}
}

func compactReferenceFromV2ForPublicationTest(reference RecoveryReference) RecoveryReferenceV3 {
	facts := make([]RecoveryFactDescriptor, 0, len(reference.PortableFactClosures))
	for _, fact := range reference.PortableFactClosures {
		closure := fact.Envelope.Closure
		facts = append(facts, RecoveryFactDescriptor{
			RecordRole: repository.RecordPortableFactClosure, RecordDigest: fact.RecordDigest,
			ClosureDigest: fact.ClosureDigest, ClosureSequence: closure.ClosureSequence,
			PredecessorClosureDigest: closure.PredecessorClosureDigest,
		})
	}
	return RecoveryReferenceV3{
		Schema: RecoveryReferenceSchemaV3, SnapshotRef: reference.SnapshotRef,
		PublicationDomain: reference.PublicationDomain, Repository: reference.Repository,
		RequiredTrustAnchor:     reference.RequiredTrustAnchor,
		PublicationCommitDigest: reference.PublicationCommitDigest,
		PublicationCommit:       reference.PublicationCommit,
		PreparedClosure:         RecoveryRecordDescriptor{RecordRole: repository.RecordPreparedClosure, RecordDigest: reference.PreparedClosureDigest},
		FactHealth:              reference.FactHealth, PortableFactClosures: facts,
		RequiredReaderDependencies: append([]string(nil), reference.RequiredReaderDependencies...),
		CriticalExtensions:         append([]string{}, reference.CriticalExtensions...),
		OptionalExtensions:         append([]byte(nil), reference.OptionalExtensions...),
	}
}
