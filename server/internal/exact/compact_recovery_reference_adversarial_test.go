package exact

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func compactAdversarialFixture(t *testing.T) (signedPublicationFixture, RecoveryReferenceV3, []byte) {
	t.Helper()
	fixture, _, v2 := artifactRecoveryReferenceFixture(t)
	v3 := compactReferenceFromV2ForTest(t, v2)
	payload, err := MarshalCompactRecoveryReference(v3)
	if err != nil {
		t.Fatalf("marshal signed compact fixture: %v", err)
	}
	v3, err = DecodeCompactRecoveryReference(payload)
	if err != nil {
		t.Fatalf("decode signed compact fixture: %v", err)
	}
	return fixture, v3, payload
}

func TestCompactRecoveryReferenceV3StrictJSONAndVersionBoundary(t *testing.T) {
	_, _, payload := compactAdversarialFixture(t)

	tests := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{name: "unknown top-level field", mutate: func(value map[string]any) { value["future_field"] = true }},
		{name: "unknown prepared descriptor field", mutate: func(value map[string]any) {
			compactObjectField(t, value, "prepared_closure")["future_field"] = true
		}},
		{name: "unknown fact descriptor field", mutate: func(value map[string]any) {
			compactFactObject(t, value)["future_field"] = true
		}},
		{name: "null fact descriptor list", mutate: func(value map[string]any) { value["portable_fact_closures"] = nil }},
		{name: "null dependencies", mutate: func(value map[string]any) { value["required_reader_dependencies"] = nil }},
		{name: "null critical extensions", mutate: func(value map[string]any) { value["critical_extensions"] = nil }},
		{name: "null optional extensions", mutate: func(value map[string]any) { value["optional_extensions"] = nil }},
		{name: "unsupported critical extension", mutate: func(value map[string]any) { value["critical_extensions"] = []any{"future.required"} }},
		{name: "unsupported schema", mutate: func(value map[string]any) { value["schema"] = "org.cairn.recovery-reference.v99" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			invalid := rewriteCompactReferencePayload(t, payload, test.mutate)
			if _, err := DecodeCompactRecoveryReference(invalid); err == nil {
				t.Fatal("decoder accepted nonconforming v3 artifact")
			}
		})
	}

	tampered := append([]byte(nil), payload...)
	var parsed map[string]any
	if err := json.Unmarshal(tampered, &parsed); err != nil {
		t.Fatal(err)
	}
	digest, ok := parsed["self_digest"].(string)
	if !ok || len(digest) < 8 {
		t.Fatalf("self_digest = %#v", parsed["self_digest"])
	}
	replacement := "0"
	if digest[len(digest)-1] == '0' {
		replacement = "1"
	}
	parsed["self_digest"] = digest[:len(digest)-1] + replacement
	tampered, err := CanonicalJSON(parsed)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeCompactRecoveryReference(tampered); err == nil {
		t.Fatal("decoder accepted self-digest tampering")
	}
	if _, err := DecodeRecoveryReference(payload); err == nil {
		t.Fatal("v2 decoder accepted a v3 artifact")
	}
}

func TestCompactRecoveryReferenceV3RejectsInvalidDescriptors(t *testing.T) {
	fixture, _, payload := compactAdversarialFixture(t)
	ctx := context.Background()
	anchor := *fixture.service.TrustAnchor
	if decoded, err := DecodeCompactRecoveryReference(rewriteCompactReferencePayload(t, payload, func(map[string]any) {})); err != nil {
		t.Fatalf("decode no-op rewritten selector: %v", err)
	} else if err := decoded.ValidateAgainstRepository(ctx, fixture.repo, anchor); err != nil {
		t.Fatalf("validate no-op rewritten selector: %v", err)
	}

	tests := []struct {
		name       string
		wantDecode bool
		mutate     func(map[string]any)
	}{
		{name: "prepared role", mutate: func(value map[string]any) {
			compactObjectField(t, value, "prepared_closure")["record_role"] = string(repository.RecordPortableFactClosure)
		}},
		{name: "prepared digest", mutate: func(value map[string]any) {
			compactObjectField(t, value, "prepared_closure")["record_digest"] = "sha256:" + strings.Repeat("0", 64)
		}},
		{name: "fact role", mutate: func(value map[string]any) {
			compactFactObject(t, value)["record_role"] = string(repository.RecordPreparedClosure)
		}},
		{name: "fact record digest", wantDecode: true, mutate: func(value map[string]any) {
			compactFactObject(t, value)["record_digest"] = "sha256:" + strings.Repeat("0", 64)
		}},
		{name: "closure digest", wantDecode: true, mutate: func(value map[string]any) {
			facts, ok := value["portable_fact_closures"].([]any)
			if !ok || len(facts) == 0 {
				t.Fatalf("portable_fact_closures = %#v", value["portable_fact_closures"])
			}
			last, ok := facts[len(facts)-1].(map[string]any)
			if !ok {
				t.Fatalf("portable_fact_closures[%d] = %T, want object", len(facts)-1, facts[len(facts)-1])
			}
			last["closure_digest"] = "sha256:" + strings.Repeat("0", 64)
		}},
		{name: "sequence", mutate: func(value map[string]any) { compactFactObject(t, value)["closure_sequence"] = float64(7) }},
		{name: "predecessor", mutate: func(value map[string]any) {
			compactFactObject(t, value)["predecessor_closure_digest"] = "sha256:" + strings.Repeat("0", 64)
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			invalid := rewriteCompactReferencePayload(t, payload, test.mutate)
			decoded, err := DecodeCompactRecoveryReference(invalid)
			if err != nil {
				if test.wantDecode {
					t.Fatalf("well-shaped descriptor failed decoding before repository binding: %v", err)
				}
				return
			}
			if err := decoded.ValidateAgainstRepository(ctx, fixture.repo, anchor); err == nil {
				t.Fatal("repository validator accepted descriptor not bound to signed records")
			}
		})
	}
}

func TestCompactRecoveryReferenceV3RepositoryAdmission(t *testing.T) {
	t.Run("wrong independent trust anchor", func(t *testing.T) {
		fixture, reference, _ := compactAdversarialFixture(t)
		identity, err := NewSigningIdentity()
		if err != nil {
			t.Fatal(err)
		}
		wrongAnchor, err := NewTrustAnchor(identity, testPublicationDomain)
		if err != nil {
			t.Fatal(err)
		}
		if err := reference.ValidateAgainstRepository(context.Background(), fixture.repo, wrongAnchor); !errors.Is(err, ErrRecoveryTrustAnchor) {
			t.Fatalf("wrong-anchor validation error = %v, want ErrRecoveryTrustAnchor", err)
		}
	})

	t.Run("canceled context", func(t *testing.T) {
		fixture, reference, _ := compactAdversarialFixture(t)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if err := reference.ValidateAgainstRepository(ctx, fixture.repo, *fixture.service.TrustAnchor); !errors.Is(err, context.Canceled) {
			t.Fatalf("canceled validation error = %v, want context.Canceled", err)
		}
		destination := filepath.Join(t.TempDir(), "canceled-selector.json")
		reader := compactCleanReader(fixture)
		if _, err := reader.ExportRecoveryArtifact(ctx, reference.SnapshotRef, destination); !errors.Is(err, context.Canceled) {
			t.Fatalf("canceled export error = %v, want context.Canceled", err)
		}
		if _, err := os.Stat(destination); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("canceled export destination stat error = %v, want not-exist", err)
		}
	})

	t.Run("wrong repository binding", func(t *testing.T) {
		fixture, reference, _ := compactAdversarialFixture(t)
		otherRepo, err := repository.OpenDir(filepath.Join(t.TempDir(), "other-repository"))
		if err != nil {
			t.Fatal(err)
		}
		if err := reference.ValidateAgainstRepository(context.Background(), otherRepo, *fixture.service.TrustAnchor); err == nil {
			t.Fatal("repository validator accepted a different repository identity")
		}
	})

	for _, test := range []struct {
		name   string
		mutate func(t *testing.T, fixture signedPublicationFixture, reference RecoveryReferenceV3)
	}{
		{name: "corrupted selected fact record", mutate: func(t *testing.T, fixture signedPublicationFixture, reference RecoveryReferenceV3) {
			fact := reference.PortableFactClosures[len(reference.PortableFactClosures)-1]
			if !flipFileByte(t, compactAdversarialRecordPath(fixture.repo.Root(), repository.RecordPortableFactClosure, fact.RecordDigest)) {
				t.Fatal("fact record tamper did not alter bytes")
			}
		}},
		{name: "missing selected prepared record", mutate: func(t *testing.T, fixture signedPublicationFixture, reference RecoveryReferenceV3) {
			if err := os.Remove(compactAdversarialRecordPath(fixture.repo.Root(), repository.RecordPreparedClosure, reference.PreparedClosure.RecordDigest)); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "missing selected body attachment", mutate: func(t *testing.T, fixture signedPublicationFixture, reference RecoveryReferenceV3) {
			fact := reference.PortableFactClosures[len(reference.PortableFactClosures)-1]
			payload, err := readRecoveryRecord(context.Background(), fixture.repo, repository.RecordPortableFactClosure, fact.RecordDigest)
			if err != nil {
				t.Fatal(err)
			}
			var envelope PortableFactClosureEnvelope
			if err := decodeStrictRecord(payload, &envelope); err != nil {
				t.Fatal(err)
			}
			var bundle portableFactBundle
			if err := decodeStrictRecord(envelope.Bundle, &bundle); err != nil {
				t.Fatal(err)
			}
			var attachment portableFactAttachment
			for _, candidate := range bundle.Attachments {
				if candidate.Purpose == "PROCESSOR_ARTIFACT_BODY" {
					attachment = candidate
					break
				}
			}
			if attachment.ContentID == "" {
				t.Fatal("selected closure has no processor body attachment")
			}
			contentHex := strings.TrimPrefix(attachment.ContentID, "sha256:")
			attachmentPath := filepath.Join(fixture.repo.Root(), "blobs", "sha256", contentHex[:2], contentHex)
			if err := os.Remove(attachmentPath); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture, reference, _ := compactAdversarialFixture(t)
			test.mutate(t, fixture, reference)
			if reference.FactHealth != RecoveryFactHealthComplete {
				t.Fatalf("fixture fact health = %q, want COMPLETE", reference.FactHealth)
			}
			if err := reference.ValidateAgainstRepository(context.Background(), fixture.repo, *fixture.service.TrustAnchor); err == nil {
				t.Fatal("compact reference accepted unavailable or corrupted selected repository evidence")
			}
		})
	}
}

func TestCompactRecoveryReferenceV3RejectsKnownForkAfterSelectedHead(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "compact-fork.txt", []byte("frozen prefix"))
	result := fixture.ingest(t, "sha256:compact-fork-plan")
	v2, err := fixture.service.BuildRecoveryReference(ctx, result.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	if len(v2.PortableFactClosures) == 0 {
		t.Fatal("fixture has no selected fact head")
	}
	selected := compactReferenceFromV2ForTest(t, v2)
	payload, err := MarshalCompactRecoveryReference(selected)
	if err != nil {
		t.Fatal(err)
	}
	selected, err = DecodeCompactRecoveryReference(payload)
	if err != nil {
		t.Fatal(err)
	}

	subject := stableSubjectForSnapshotFile(t, fixture.service, result.SnapshotRef, "compact-fork.txt")
	annotationID, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.store.CreateAnnotation(ctx, &sqlite.Annotation{
		ID: annotationID, WorkspaceID: result.WorkspaceID, SubjectRef: subject,
		Kind: sqlite.AnnotationTag, Body: "fork-trigger", Revision: 1,
	}); err != nil {
		t.Fatal(err)
	}
	if err := fixture.service.PublishPortableFactClosure(ctx, result.WorkspaceID, result.SnapshotRef, result.PublicationCommitDigest); err != nil {
		t.Fatalf("publish first successor after selected head: %v", err)
	}
	_, fork, bundle := latestPortableFactEnvelope(t, fixture, result.SnapshotRef)
	index := findPortableRecord(t, bundle, "ANNOTATION_REVISION")
	bundle.Records[index].Provenance = json.RawMessage(`{"fork":"authenticated"}`)
	bundleBytes, err := CanonicalJSON(bundle)
	if err != nil {
		t.Fatal(err)
	}
	fork.Bundle = bundleBytes
	fork.Closure.BundleDigest = DigestBytes(bundleBytes)
	fork.Closure.BundleLength = int64(len(bundleBytes))
	fork.Closure.Signature = nil
	signed, err := SignPortableFactClosure(*fixture.service.SigningIdentity, fork.Closure)
	if err != nil {
		t.Fatal(err)
	}
	fork.Schema = PortableFactClosureEnvelopeSchemaV1
	if signed.Schema == PortableFactClosureSchemaV2 {
		fork.Schema = PortableFactClosureEnvelopeSchemaV2
	}
	fork.Closure = signed
	if err := fork.Closure.Verify(*fixture.service.TrustAnchor); err != nil {
		t.Fatalf("fork successor is not independently authenticated: %v", err)
	}
	forkPayload, err := CanonicalJSON(fork)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.repo.PlaceRecord(ctx, repository.RecordPortableFactClosure, bytes.NewReader(forkPayload)); err != nil {
		t.Fatal(err)
	}
	if err := selected.ValidateAgainstRepository(ctx, fixture.repo, *fixture.service.TrustAnchor); !errors.Is(err, errPortableFactConflict) {
		t.Fatalf("compact reference fork error = %v, want authenticated successor conflict", err)
	}
}

func TestCompactRecoveryArtifactAdmissionFailureDoesNotCreateOrOverwriteDestination(t *testing.T) {
	for _, existing := range []bool{false, true} {
		name := "new destination"
		if existing {
			name = "pre-existing destination"
		}
		t.Run(name, func(t *testing.T) {
			fixture, _, v2 := artifactRecoveryReferenceFixture(t)
			preparedPath := compactAdversarialRecordPath(fixture.repo.Root(), repository.RecordPreparedClosure, v2.PreparedClosureDigest)
			if err := os.Remove(preparedPath); err != nil {
				t.Fatal(err)
			}
			destination := filepath.Join(t.TempDir(), "selector.json")
			var sentinel []byte
			if existing {
				sentinel = []byte("keep existing destination bytes")
				if err := os.WriteFile(destination, sentinel, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			reader := compactCleanReader(fixture)
			if _, err := reader.ExportRecoveryArtifact(context.Background(), v2.SnapshotRef, destination); err == nil {
				t.Fatal("generic export succeeded despite prepared-record admission failure")
			}
			actual, err := os.ReadFile(destination)
			if existing {
				if err != nil || !bytes.Equal(actual, sentinel) {
					t.Fatalf("pre-existing destination changed: bytes=%q err=%v", actual, err)
				}
			} else if !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("failed export destination read error = %v, want not-exist", err)
			}
		})
	}
}

func compactAdversarialRecordPath(root string, role repository.RecordRole, digest string) string {
	contentHex := strings.TrimPrefix(digest, "sha256:")
	roleDir := "commits"
	if role == repository.RecordPreparedClosure {
		roleDir = "prepared"
	} else if role == repository.RecordPortableFactClosure {
		roleDir = "portable-facts"
	}
	return filepath.Join(root, "recovery", roleDir, "sha256", contentHex[:2], contentHex)
}

func TestCompactRecoveryReferenceV3ExactReaderLimit(t *testing.T) {
	_, reference, _ := compactAdversarialFixture(t)
	limit := int(repository.MaxRecordBytes)

	exactPayload := compactReferenceAtEncodedSize(t, reference, limit)
	if len(exactPayload) != limit {
		t.Fatalf("exact-boundary payload = %d bytes, want %d", len(exactPayload), limit)
	}
	marshaled, err := MarshalCompactRecoveryReference(referenceWithSizedExtensions(t, reference, limit))
	if err != nil {
		t.Fatalf("marshal exact-limit selector: %v", err)
	}
	if len(marshaled) != limit {
		t.Fatalf("marshaled exact-limit selector = %d, want %d", len(marshaled), limit)
	}
	if _, err := DecodeCompactRecoveryReference(marshaled); err != nil {
		t.Fatalf("decode exact-limit selector: %v", err)
	}

	overReference := referenceWithSizedExtensions(t, reference, limit+1)
	if _, err := MarshalCompactRecoveryReference(overReference); !errors.Is(err, ErrRecoveryReferenceTooLarge) {
		t.Fatalf("over-limit marshal error = %v, want typed size refusal", err)
	}
	overPayload := compactReferenceAtEncodedSize(t, reference, limit+1)
	if len(overPayload) != limit+1 {
		t.Fatalf("over-boundary payload = %d bytes, want %d", len(overPayload), limit+1)
	}
	if _, err := DecodeCompactRecoveryReference(overPayload); err == nil {
		t.Fatal("decoder accepted payload one byte over reader limit")
	}
}

func compactObjectField(t *testing.T, object map[string]any, key string) map[string]any {
	t.Helper()
	value, ok := object[key].(map[string]any)
	if !ok {
		t.Fatalf("%s = %T, want object", key, object[key])
	}
	return value
}

func compactFactObject(t *testing.T, object map[string]any) map[string]any {
	t.Helper()
	facts, ok := object["portable_fact_closures"].([]any)
	if !ok || len(facts) == 0 {
		t.Fatalf("portable_fact_closures = %#v", object["portable_fact_closures"])
	}
	fact, ok := facts[0].(map[string]any)
	if !ok {
		t.Fatalf("portable_fact_closures[0] = %T, want object", facts[0])
	}
	return fact
}

func rewriteCompactReferencePayload(t *testing.T, payload []byte, mutate func(map[string]any)) []byte {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal(payload, &value); err != nil {
		t.Fatal(err)
	}
	delete(value, "self_digest")
	mutate(value)
	mutated, err := CanonicalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	var typed RecoveryReferenceV3
	if err := json.Unmarshal(mutated, &typed); err != nil {
		t.Fatal(err)
	}
	typed.SelfDigest = ""
	canonicalTyped, err := CanonicalJSON(typed)
	if err != nil {
		t.Fatal(err)
	}
	digest := DigestBytes(canonicalTyped)
	value["self_digest"] = digest
	updated, err := CanonicalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	return updated
}

func referenceWithSizedExtensions(t *testing.T, reference RecoveryReferenceV3, target int) RecoveryReferenceV3 {
	t.Helper()
	for padLength := 0; padLength <= target; {
		padding := strings.Repeat("x", padLength)
		reference.OptionalExtensions = json.RawMessage(fmt.Sprintf(`{"pad":"%s"}`, padding))
		reference.SelfDigest = ""
		digest, err := reference.Digest()
		if err != nil {
			t.Fatalf("digest sized compact reference: %v", err)
		}
		reference.SelfDigest = digest
		payload, err := CanonicalJSON(reference)
		if err != nil {
			t.Fatalf("encode sized compact reference: %v", err)
		}
		delta := target - len(payload)
		if delta == 0 {
			return reference
		}
		padLength += delta
		if padLength < 0 {
			t.Fatalf("base selector size %d exceeds target %d", len(payload), target)
		}
	}
	t.Fatalf("could not size compact reference to %d bytes", target)
	return RecoveryReferenceV3{}
}

func compactReferenceAtEncodedSize(t *testing.T, reference RecoveryReferenceV3, target int) []byte {
	t.Helper()
	candidate := referenceWithSizedExtensions(t, reference, target)
	payload, err := CanonicalJSON(candidate)
	if err != nil {
		t.Fatalf("encode compact reference at %d bytes: %v", target, err)
	}
	return payload
}
