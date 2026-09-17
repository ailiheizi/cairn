package exact

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestResolveExportSidecarFilesVocabulary pins the policy vocabulary: the empty
// policy requests no derived file, the one implemented policy requests exactly
// the handoff sidecar, and every other value is refused instead of ignored.
func TestResolveExportSidecarFilesVocabulary(t *testing.T) {
	files, err := ResolveExportSidecarFiles(ExportSidecarPolicyNone)
	if err != nil || len(files) != 0 {
		t.Fatalf("empty policy = %+v, err=%v, want no sidecar", files, err)
	}
	if files, err = ResolveExportSidecarFiles("  "); err != nil || len(files) != 0 {
		t.Fatalf("blank policy = %+v, err=%v, want no sidecar", files, err)
	}
	files, err = ResolveExportSidecarFiles(ExportSidecarPolicyHandoffV1ManifestJSON)
	if err != nil || len(files) != 1 || files[0] != ExportSidecarFileName {
		t.Fatalf("implemented policy = %+v, err=%v, want [%s]", files, err, ExportSidecarFileName)
	}
	for _, unknown := range []string{"keep-metadata-and-subtitle-sidecars", "handoff-v1:manifest-xml", "manifest-json"} {
		_, err = ResolveExportSidecarFiles(unknown)
		if !IsUnsupportedSidecarPolicy(err) || !errors.Is(err, UnsupportedSidecarPolicyError{Policy: unknown}) {
			t.Fatalf("policy %q error = %v, want UnsupportedSidecarPolicyError", unknown, err)
		}
		if !strings.Contains(err.Error(), unknown) || !strings.Contains(err.Error(), ExportSidecarPolicyHandoffV1ManifestJSON) {
			t.Fatalf("policy %q reason does not name the vocabulary: %v", unknown, err)
		}
	}
}

// TestExportManifestSidecarRendersFromFrozenFields proves the sidecar restates
// exactly the frozen item set, states that it is derived output rather than
// identity, asserts no protection outcome the manifest does not carry, and
// renders byte-identically from the same frozen manifest.
func TestExportManifestSidecarRendersFromFrozenFields(t *testing.T) {
	service := newExportTestService(t)
	manifest := mustBuildExportManifest(t, service, map[string][]byte{
		"alpha.txt": []byte("alpha sidecar payload"),
		"beta.bin":  []byte(strings.Repeat("B", 128)),
	})
	manifest.Sidecars = ExportSidecarPolicyHandoffV1ManifestJSON
	digest, err := manifest.PrepareExportManifestDigest()
	if err != nil {
		t.Fatalf("prepare digest: %v", err)
	}
	manifest.ManifestDigest = digest

	first, err := RenderExportSidecar(manifest)
	if err != nil {
		t.Fatalf("render sidecar: %v", err)
	}
	second, err := RenderExportSidecar(manifest)
	if err != nil {
		t.Fatalf("render sidecar again: %v", err)
	}
	if string(first) != string(second) {
		t.Fatalf("sidecar rendering is not deterministic:\n%s\n%s", first, second)
	}
	var document struct {
		Schema                  string `json:"schema"`
		Note                    string `json:"note"`
		ManifestID              string `json:"manifest_id"`
		ManifestDigest          string `json:"manifest_digest"`
		SidecarPolicy           string `json:"sidecar_policy"`
		Representation          string `json:"representation"`
		ProtectionOutcome       string `json:"protection_outcome"`
		ProtectionOutcomeReason string `json:"protection_outcome_reason"`
		Items                   []struct {
			OutputName  string `json:"output_name"`
			ContentID   string `json:"content_id"`
			LogicalSize int64  `json:"logical_size"`
			Exact       bool   `json:"exact"`
		} `json:"items"`
	}
	if err := json.Unmarshal(first, &document); err != nil {
		t.Fatalf("decode sidecar: %v", err)
	}
	if document.Schema != ExportSidecarSchemaV1 || document.ManifestID != manifest.ManifestID ||
		document.ManifestDigest != digest || document.SidecarPolicy != ExportSidecarPolicyHandoffV1ManifestJSON ||
		document.Representation != manifest.Representation {
		t.Fatalf("sidecar header = %+v", document)
	}
	if !strings.Contains(document.Note, "not content identity") {
		t.Fatalf("sidecar note does not disclaim identity: %q", document.Note)
	}
	if document.ProtectionOutcome != exportSidecarProtectionOutcome || document.ProtectionOutcomeReason == "" {
		t.Fatalf("sidecar protection outcome = %q reason = %q", document.ProtectionOutcome, document.ProtectionOutcomeReason)
	}
	if len(document.Items) != len(manifest.Items) {
		t.Fatalf("sidecar items = %+v, want %d frozen items", document.Items, len(manifest.Items))
	}
	for index, item := range manifest.Items {
		restated := document.Items[index]
		if restated.OutputName != item.OutputName || restated.ContentID != item.ContentID ||
			restated.LogicalSize != item.LogicalSize || restated.Exact != item.Exact {
			t.Fatalf("sidecar item %d = %+v, want frozen %+v", index, restated, item)
		}
	}
}

// TestExportManifestSidecarMaterializeVerifyAndTamper proves apply writes the
// requested sidecar next to the frozen subject files, that verify fails closed
// when the sidecar is missing or altered by a single byte of the same length,
// and that an unimplemented policy or a frozen-name collision writes nothing.
func TestExportManifestSidecarMaterializeVerifyAndTamper(t *testing.T) {
	ctx := context.Background()
	service := newExportTestService(t)
	manifest := mustBuildExportManifest(t, service, map[string][]byte{
		"alpha.txt": []byte("sidecar verify payload"),
	})
	manifest.Sidecars = ExportSidecarPolicyHandoffV1ManifestJSON
	digest, err := manifest.PrepareExportManifestDigest()
	if err != nil {
		t.Fatalf("prepare digest: %v", err)
	}
	manifest.ManifestDigest = digest

	destination := filepath.Join(t.TempDir(), "out")
	result, err := service.ApplyExportManifest(ctx, manifest, destination)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if !result.Verified || len(result.Sidecars) != 1 || result.Sidecars[0] != ExportSidecarFileName {
		t.Fatalf("apply result = %+v", result)
	}
	want, err := RenderExportSidecar(manifest)
	if err != nil {
		t.Fatalf("render expected sidecar: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(destination, ExportSidecarFileName))
	if err != nil {
		t.Fatalf("read materialized sidecar: %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("materialized sidecar = %s, want %s", got, want)
	}

	// A missing sidecar is a verification failure, not a clean verify.
	if err := os.Remove(filepath.Join(destination, ExportSidecarFileName)); err != nil {
		t.Fatalf("remove sidecar: %v", err)
	}
	if _, err := service.VerifyExportManifest(ctx, manifest, destination); !errors.Is(err, ErrBlocked) ||
		!strings.Contains(err.Error(), "missing the sidecar") {
		t.Fatalf("missing-sidecar verify = %v, want a blocked missing-sidecar failure", err)
	}
	if err := os.WriteFile(filepath.Join(destination, ExportSidecarFileName), want, 0o644); err != nil {
		t.Fatalf("restore sidecar: %v", err)
	}
	if verified, err := service.VerifyExportManifest(ctx, manifest, destination); err != nil || !verified {
		t.Fatalf("verify after restoring the identical sidecar = %v, err=%v", verified, err)
	}

	// A one-byte alteration of the same length fails closed.
	altered := append([]byte(nil), want...)
	altered[len(altered)/2] ^= 0xff
	if err := os.WriteFile(filepath.Join(destination, ExportSidecarFileName), altered, 0o644); err != nil {
		t.Fatalf("alter sidecar: %v", err)
	}
	if verified, err := service.VerifyExportManifest(ctx, manifest, destination); !errors.Is(err, ErrBlocked) ||
		!strings.Contains(err.Error(), "does not match the frozen manifest") {
		t.Fatalf("altered-sidecar verify = %v (verified=%v), want a blocked mismatch failure", err, verified)
	}

	// An unimplemented frozen policy fails closed before anything is written.
	legacy := manifest
	legacy.ManifestDigest = ""
	legacy.Sidecars = "keep-metadata-and-subtitle-sidecars"
	legacyDigest, err := legacy.PrepareExportManifestDigest()
	if err != nil {
		t.Fatalf("prepare legacy digest: %v", err)
	}
	legacy.ManifestDigest = legacyDigest
	untouched := filepath.Join(t.TempDir(), "legacy-out")
	if _, err := service.ApplyExportManifest(ctx, legacy, untouched); !IsUnsupportedSidecarPolicy(err) {
		t.Fatalf("legacy policy apply = %v, want unsupported-policy failure", err)
	}
	if _, err := os.Lstat(untouched); !os.IsNotExist(err) {
		t.Fatalf("legacy policy apply touched the destination: %v", err)
	}

	// A frozen output that would occupy the sidecar path fails closed.
	colliding := manifest
	colliding.ManifestDigest = ""
	colliding.Items = []ExportItem{{
		SubjectRef: manifest.Items[0].SubjectRef, OutputName: ExportSidecarFileName,
		ContentID: manifest.Items[0].ContentID, LogicalSize: manifest.Items[0].LogicalSize, Exact: true,
	}}
	collisionDigest, err := colliding.PrepareExportManifestDigest()
	if err != nil {
		t.Fatalf("prepare collision digest: %v", err)
	}
	colliding.ManifestDigest = collisionDigest
	if _, err := service.ApplyExportManifest(ctx, colliding, filepath.Join(t.TempDir(), "collision-out")); !errors.Is(err, ErrBlocked) {
		t.Fatalf("colliding apply = %v, want a blocked name collision", err)
	}
}
