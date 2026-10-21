package exact

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestRecoveryReferenceMarshalEnforcesReaderLimit(t *testing.T) {
	_, _, reference := artifactRecoveryReferenceFixture(t)

	limit := int(repository.MaxRecordBytes)
	exactReference, exactPayload := recoveryReferenceAtEncodedSize(t, reference, limit)
	if len(exactPayload) != limit {
		t.Fatalf("sized payload = %d, want %d", len(exactPayload), limit)
	}
	marshaled, err := MarshalRecoveryReference(exactReference)
	if err != nil {
		t.Fatalf("MarshalRecoveryReference rejected exact-limit reference: %v", err)
	}
	if len(marshaled) != limit {
		t.Fatalf("marshaled length = %d, want %d", len(marshaled), limit)
	}
	if _, err := DecodeRecoveryReference(marshaled); err != nil {
		t.Fatalf("reader rejected exact-limit reference: %v", err)
	}

	overReference, _ := recoveryReferenceAtEncodedSize(t, reference, limit+1)
	if payload, err := MarshalRecoveryReference(overReference); err == nil {
		t.Fatalf("MarshalRecoveryReference accepted %d-byte reference; reader limit is %d", len(payload), limit)
	}
}

func TestExportRecoveryReferenceRejectsOversizedAuthenticatedChildChainBeforeWrite(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "reference-size.txt", []byte("signed bounded reference"))
	result := fixture.ingest(t, "sha256:reference-size-plan")
	subject := stableSubjectForSnapshotFile(t, fixture.service, result.SnapshotRef, "reference-size.txt")

	for i := 0; i < 2; i++ {
		annotationID, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
		if err != nil {
			t.Fatal(err)
		}
		body := strings.Repeat(string(rune('a'+i)), 5_600_000)
		annotation := &sqlite.Annotation{
			ID: annotationID, WorkspaceID: result.WorkspaceID, SubjectRef: subject,
			Kind: sqlite.AnnotationNote, Body: body, Revision: 1,
		}
		if err := fixture.store.CreateAnnotation(ctx, annotation); err != nil {
			t.Fatalf("create large Note %d: %v", i+1, err)
		}
		if err := fixture.service.PublishPortableFactClosure(ctx, result.WorkspaceID, result.SnapshotRef, result.PublicationCommitDigest); err != nil {
			t.Fatalf("publish signed fact child %d: %v", i+1, err)
		}
	}

	closures, err := fixture.service.ListPortableFactClosures(ctx, result.SnapshotRef)
	if err != nil {
		t.Fatalf("read authenticated child chain: %v", err)
	}
	if len(closures) < 3 {
		t.Fatalf("authenticated fact child count = %d, want initial child plus two successors", len(closures))
	}
	for i, closure := range closures {
		payload, err := CanonicalJSON(closure)
		if err != nil {
			t.Fatalf("encode authenticated child %d: %v", i+1, err)
		}
		if int64(len(payload)) > repository.MaxRecordBytes {
			t.Fatalf("authenticated child %d is %d bytes, want each child within %d-byte record cap", i+1, len(payload), repository.MaxRecordBytes)
		}
		t.Logf("authenticated child %d encoded bytes=%d", i+1, len(payload))
	}
	reference, err := fixture.service.BuildRecoveryReference(ctx, result.SnapshotRef)
	if err != nil {
		t.Fatalf("build oversized-chain reference: %v", err)
	}
	reference.SelfDigest = ""
	referenceDigest, err := reference.Digest()
	if err != nil {
		t.Fatalf("digest oversized-chain reference for size evidence: %v", err)
	}
	reference.SelfDigest = referenceDigest
	referencePayload, err := CanonicalJSON(reference)
	if err != nil {
		t.Fatalf("encode oversized-chain reference for size evidence: %v", err)
	}
	if int64(len(referencePayload)) <= repository.MaxRecordBytes {
		t.Fatalf("signed chain reference = %d bytes, want over %d", len(referencePayload), repository.MaxRecordBytes)
	}
	t.Logf("aggregate reference encoded bytes=%d", len(referencePayload))

	destination := filepath.Join(t.TempDir(), "over-limit-reference.json")
	_, err = fixture.service.ExportRecoveryReference(ctx, result.SnapshotRef, destination)
	if err == nil {
		if payload, readErr := os.ReadFile(destination); readErr == nil {
			if _, decodeErr := DecodeRecoveryReference(payload); decodeErr == nil {
				t.Fatalf("control failed: exported reference is readable (%d bytes); authenticated chain did not exceed reader cap", len(payload))
			}
			t.Fatalf("oversized authenticated chain export succeeded with %d-byte unreadable artifact", len(payload))
		}
		t.Fatal("oversized authenticated chain export succeeded")
	}
	if _, statErr := os.Lstat(destination); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("export created an artifact before rejecting oversized reference: stat err=%v", statErr)
	}

	existingDestination := filepath.Join(t.TempDir(), "existing-reference.json")
	sentinel := []byte("preserve-existing-artifact")
	if err := os.WriteFile(existingDestination, sentinel, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = fixture.service.ExportRecoveryReference(ctx, result.SnapshotRef, existingDestination)
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("oversized export error = %v, want bounded-reference refusal before destination write", err)
	}
	got, err := os.ReadFile(existingDestination)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(sentinel) {
		t.Fatalf("existing destination changed: got %q, want %q", got, sentinel)
	}
}

func recoveryReferenceAtEncodedSize(t *testing.T, reference RecoveryReference, target int) (RecoveryReference, []byte) {
	t.Helper()
	for padLength := 0; padLength <= target; {
		padding := make([]byte, padLength)
		for i := range padding {
			padding[i] = 'x'
		}
		reference.OptionalExtensions = json.RawMessage(`{"pad":"` + string(padding) + `"}`)
		reference.SelfDigest = ""
		digest, err := reference.Digest()
		if err != nil {
			t.Fatalf("digest recovery reference while sizing: %v", err)
		}
		reference.SelfDigest = digest
		payload, err := CanonicalJSON(reference)
		if err != nil {
			t.Fatalf("encode recovery reference while sizing: %v", err)
		}
		delta := target - len(payload)
		if delta == 0 {
			return reference, payload
		}
		padLength += delta
		if padLength < 0 {
			t.Fatalf("base reference length %d already exceeds target %d", len(payload), target)
		}
	}
	t.Fatalf("could not size recovery reference to %d bytes", target)
	return RecoveryReference{}, nil
}
