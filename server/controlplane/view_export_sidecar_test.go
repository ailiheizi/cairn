package controlplane

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/ailiheizi/restoreweave/client/command"
	"github.com/ailiheizi/restoreweave/server/internal/exact"
	"github.com/ailiheizi/restoreweave/server/internal/store/sqlite"
)

// TestExportSidecarVocabularyMatchesClientContract keeps the wire vocabulary
// the client package publishes equal to the exact lane's implementation
// vocabulary; a silent drift would let a client request a policy the daemon
// rejects (or worse, believe it requested one the daemon ignores).
func TestExportSidecarVocabularyMatchesClientContract(t *testing.T) {
	if command.ExportSidecarPolicyHandoffV1ManifestJSON != exact.ExportSidecarPolicyHandoffV1ManifestJSON {
		t.Fatalf("implemented policy drifted: client %q, exact %q",
			command.ExportSidecarPolicyHandoffV1ManifestJSON, exact.ExportSidecarPolicyHandoffV1ManifestJSON)
	}
	if command.ExportSidecarPolicyNone != exact.ExportSidecarPolicyNone {
		t.Fatalf("empty policy drifted: client %q, exact %q", command.ExportSidecarPolicyNone, exact.ExportSidecarPolicyNone)
	}
	if command.ExportSidecarFileName != exact.ExportSidecarFileName {
		t.Fatalf("sidecar file name drifted: client %q, exact %q", command.ExportSidecarFileName, exact.ExportSidecarFileName)
	}
}

// TestExportPlanRejectsUnimplementedSidecarPolicy proves an unrecognized
// sidecar policy fails as invalid_input and freezes nothing, so an operator who
// asks for a sidecar can never silently receive a manifest without one. The
// empty policy keeps today's behavior: no sidecar, manifest frozen.
func TestExportPlanRejectsUnimplementedSidecarPolicy(t *testing.T) {
	root := t.TempDir()
	writeExportFixture(t, root, "payload.bin", "sidecar policy probe")
	h := newViewExportHarness(t, root)

	for _, unknown := range []string{
		"handoff-v2:manifest-json", "keep-metadata-and-subtitle-sidecars",
		"manifest-json", "handoff-v1:manifest-xml", "  handoff-v1:manifest-json  extra  ",
	} {
		result := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportPlan, map[string]any{
			"subjects": []string{h.subjectRef}, "sidecars": unknown,
		}))
		if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeInvalidInput) {
			t.Fatalf("sidecars %q = %q: %+v, want invalid_input", unknown, result.Status, result.Reasons)
		}
		if len(result.Reasons) == 0 || !strings.Contains(result.Reasons[0].Message, strings.TrimSpace(unknown)) ||
			!strings.Contains(result.Reasons[0].Message, exact.ExportSidecarPolicyHandoffV1ManifestJSON) {
			t.Fatalf("sidecars %q reason does not name the problem and the vocabulary: %+v", unknown, result.Reasons)
		}
	}

	listed := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportList, nil))
	var manifests []command.ExportManifestData
	if err := json.Unmarshal(listed.Data, &manifests); err != nil {
		t.Fatalf("decode export.list: %v", err)
	}
	if len(manifests) != 0 {
		t.Fatalf("a rejected sidecar policy froze a manifest: %+v", manifests)
	}

	// The empty policy remains the default and behaves exactly as before.
	for _, input := range []map[string]any{
		{"subjects": []string{h.subjectRef}, "sidecars": ""},
		{"subjects": []string{h.subjectRef}},
	} {
		planned := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportPlan, input))
		if planned.Status != command.StatusSucceeded {
			t.Fatalf("empty sidecar policy plan %+v = %q: %+v", input, planned.Status, planned.Reasons)
		}
		var manifest command.ExportManifestData
		if err := json.Unmarshal(planned.Data, &manifest); err != nil {
			t.Fatalf("decode export.plan: %v", err)
		}
		stored, err := h.dispatcher.loadFrozenManifest(context.Background(), manifest.ManifestID, manifest.ManifestDigest)
		if err != nil {
			t.Fatalf("rebuild empty-policy manifest: %v", err)
		}
		if stored.Sidecars != exact.ExportSidecarPolicyNone {
			t.Fatalf("empty-policy manifest sidecars = %q", stored.Sidecars)
		}
	}
}

// TestExportEmptySidecarPolicyMaterializesOnlySubjectFiles is the layout
// regression for the feature: without a policy the destination holds exactly
// the frozen subject files, no derived sidecar appears, and a hand-placed
// sidecar in such a destination is still an unexpected path that fails verify.
func TestExportEmptySidecarPolicyMaterializesOnlySubjectFiles(t *testing.T) {
	root := t.TempDir()
	writeExportFixture(t, root, "one/one.bin", "first payload")
	writeExportFixture(t, root, "two/two.bin", "second payload")
	h, _ := openViewExportHarness(t, root)
	refs := subjectRefsByPath(fixtureFileEntries(t, h))
	if len(refs) != 2 {
		t.Fatalf("fixture subjects = %+v, want 2", refs)
	}

	manifest := planFixtureExport(t, h, map[string]any{"subjects": refs})
	destination := filepath.Join(t.TempDir(), "out")
	applied := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportApply, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	}))
	if applied.Status != command.StatusSucceeded {
		t.Fatalf("export.apply = %q: %+v", applied.Status, applied.Reasons)
	}
	var applyData command.ExportApplyVerifyData
	if err := json.Unmarshal(applied.Data, &applyData); err != nil {
		t.Fatalf("decode export.apply: %v", err)
	}
	if len(applyData.Sidecars) != 0 {
		t.Fatalf("empty-policy apply reported sidecars %+v", applyData.Sidecars)
	}
	written, err := os.ReadDir(destination)
	if err != nil {
		t.Fatalf("read destination: %v", err)
	}
	if len(written) != 2 {
		t.Fatalf("empty-policy destination holds %d entries, want the 2 subject files: %+v", len(written), written)
	}
	for _, entry := range written {
		if entry.Name() == exact.ExportSidecarFileName {
			t.Fatalf("empty-policy destination contains a sidecar file")
		}
	}

	verified := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportVerify, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	}))
	if verified.Status != command.StatusSucceeded {
		t.Fatalf("empty-policy export.verify = %q: %+v", verified.Status, verified.Reasons)
	}
	var verifyData command.ExportApplyVerifyData
	if err := json.Unmarshal(verified.Data, &verifyData); err != nil {
		t.Fatalf("decode export.verify: %v", err)
	}
	if !verifyData.Verified || len(verifyData.Sidecars) != 0 {
		t.Fatalf("empty-policy verify data = %+v", verifyData)
	}

	// A sidecar this manifest never requested is still unexpected output.
	if err := os.WriteFile(filepath.Join(destination, exact.ExportSidecarFileName), []byte("{}"), 0o644); err != nil {
		t.Fatalf("place stray sidecar: %v", err)
	}
	stray := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportVerify, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": destination,
	}))
	if stray.Status != command.StatusFailed || len(stray.Reasons) == 0 ||
		!strings.Contains(stray.Reasons[0].Message, "unexpected path") {
		t.Fatalf("stray-sidecar verify = %q: %+v", stray.Status, stray.Reasons)
	}
}

// exportSidecarPayload parses one materialized sidecar so a test can compare it
// with the frozen manifest field by field.
type exportSidecarPayload struct {
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

func readExportSidecar(t *testing.T, destination string) []byte {
	t.Helper()
	payload, err := os.ReadFile(filepath.Join(destination, exact.ExportSidecarFileName))
	if err != nil {
		t.Fatalf("read sidecar in %s: %v", destination, err)
	}
	return payload
}

// TestExportApplyWritesDeterministicHandoffSidecar proves the implemented
// policy writes one derived sidecar next to the frozen subject files, that the
// sidecar restates the frozen item set (output name, exact identity, logical
// size, exactness) and its manifest binding, that the same frozen manifest
// renders byte-identical sidecar content in two different empty destinations,
// and that the subject files and manifest digest are unchanged by the feature.
func TestExportApplyWritesDeterministicHandoffSidecar(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	payloads := map[string]string{"one/one.bin": "first payload", "two/two.bin": "second payload"}
	for relative, payload := range payloads {
		writeExportFixture(t, root, relative, payload)
	}
	h, _ := openViewExportHarness(t, root)
	files := fixtureFileEntries(t, h)
	refs := subjectRefsByPath(files)
	manifest := planFixtureExport(t, h, map[string]any{
		"subjects": refs, "sidecars": exact.ExportSidecarPolicyHandoffV1ManifestJSON,
	})
	items := frozenItems(t, manifest)
	if len(items) != 2 {
		t.Fatalf("frozen items = %+v, want 2", items)
	}

	first := filepath.Join(t.TempDir(), "out-a")
	second := filepath.Join(t.TempDir(), "out-b")
	applyTo := func(destination string) command.ExportApplyVerifyData {
		t.Helper()
		applied := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportApply, map[string]any{
			"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
			"destination": destination,
		}))
		if applied.Status != command.StatusSucceeded {
			t.Fatalf("export.apply = %q: %+v", applied.Status, applied.Reasons)
		}
		var data command.ExportApplyVerifyData
		if err := json.Unmarshal(applied.Data, &data); err != nil {
			t.Fatalf("decode export.apply: %v", err)
		}
		return data
	}
	firstApply := applyTo(first)
	secondApply := applyTo(second)
	for name, data := range map[string]command.ExportApplyVerifyData{"first": firstApply, "second": secondApply} {
		if !data.Verified || data.ManifestDigest != manifest.ManifestDigest ||
			!reflect.DeepEqual(data.Sidecars, []string{exact.ExportSidecarFileName}) {
			t.Fatalf("%s apply data = %+v, want one reported sidecar", name, data)
		}
	}

	// Deterministic derived content: two applies of the same frozen manifest to
	// different empty destinations produce identical sidecar bytes.
	firstSidecar := readExportSidecar(t, first)
	secondSidecar := readExportSidecar(t, second)
	if !bytes.Equal(firstSidecar, secondSidecar) {
		t.Fatalf("sidecar bytes differ between destinations:\n%s\n%s", firstSidecar, secondSidecar)
	}

	var document exportSidecarPayload
	if err := json.Unmarshal(firstSidecar, &document); err != nil {
		t.Fatalf("decode sidecar: %v", err)
	}
	if document.Schema != exact.ExportSidecarSchemaV1 || document.ManifestID != manifest.ManifestID ||
		document.ManifestDigest != manifest.ManifestDigest ||
		document.SidecarPolicy != exact.ExportSidecarPolicyHandoffV1ManifestJSON ||
		document.Representation != "exact" {
		t.Fatalf("sidecar header = %+v", document)
	}
	if !strings.Contains(document.Note, "not content identity") {
		t.Fatalf("sidecar note does not disclaim identity: %q", document.Note)
	}
	if document.ProtectionOutcome != "UNAVAILABLE" || document.ProtectionOutcomeReason == "" {
		t.Fatalf("sidecar protection outcome = %q reason = %q", document.ProtectionOutcome, document.ProtectionOutcomeReason)
	}
	if len(document.Items) != len(items) {
		t.Fatalf("sidecar items = %+v, want %d frozen items", document.Items, len(items))
	}
	frozenByName := make(map[string]exact.ExportItem, len(items))
	for _, item := range items {
		frozenByName[item.OutputName] = item
	}
	for _, restated := range document.Items {
		frozen, ok := frozenByName[restated.OutputName]
		if !ok {
			t.Fatalf("sidecar item %+v has no frozen output", restated)
		}
		if restated.ContentID != frozen.ContentID || restated.LogicalSize != frozen.LogicalSize || restated.Exact != frozen.Exact {
			t.Fatalf("sidecar item %+v != frozen %+v", restated, frozen)
		}
		if !strings.HasPrefix(restated.ContentID, "sha256:") {
			t.Fatalf("sidecar item content id %q is not an exact identity", restated.ContentID)
		}
	}

	// The subject files are byte-exact copies of the source payloads and their
	// recorded identity is the SHA-256 of those bytes.
	payloadBySubject := make(map[string]string, len(files))
	for relative, entry := range files {
		payloadBySubject[entry.ID] = payloads[relative]
	}
	for _, item := range items {
		got, err := os.ReadFile(filepath.Join(first, item.OutputName))
		if err != nil {
			t.Fatalf("read subject output %q: %v", item.OutputName, err)
		}
		want := payloadBySubject[item.SubjectRef]
		if string(got) != want {
			t.Fatalf("subject output %q = %q, want %q", item.OutputName, got, want)
		}
		sum := sha256.Sum256(got)
		if item.ContentID != "sha256:"+hex.EncodeToString(sum[:]) {
			t.Fatalf("subject output %q content id = %s", item.OutputName, item.ContentID)
		}
	}

	// The manifest digest is still derived from the frozen field set alone.
	rebuilt, err := h.dispatcher.loadFrozenManifest(ctx, manifest.ManifestID, manifest.ManifestDigest)
	if err != nil {
		t.Fatalf("rebuild frozen manifest: %v", err)
	}
	probe := rebuilt
	probe.ManifestDigest = ""
	digest, err := probe.Digest()
	if err != nil {
		t.Fatalf("recompute digest: %v", err)
	}
	if digest != manifest.ManifestDigest {
		t.Fatalf("recomputed digest = %s, want %s", digest, manifest.ManifestDigest)
	}

	// Verify reports the same sidecar it checked.
	verified := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportVerify, map[string]any{
		"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
		"destination": first,
	}))
	if verified.Status != command.StatusSucceeded {
		t.Fatalf("export.verify = %q: %+v", verified.Status, verified.Reasons)
	}
	var verifyData command.ExportApplyVerifyData
	if err := json.Unmarshal(verified.Data, &verifyData); err != nil {
		t.Fatalf("decode export.verify: %v", err)
	}
	if !verifyData.Verified || !reflect.DeepEqual(verifyData.Sidecars, []string{exact.ExportSidecarFileName}) {
		t.Fatalf("verify data = %+v, want the verified sidecar named", verifyData)
	}
}

// TestExportVerifyFailsWhenSidecarMissingOrAltered proves a sidecar-only
// deviation is a verification failure with the reason: a missing sidecar, an
// altered sidecar of unchanged length, and that the intact export still
// verifies. It also proves the sidecar is reproducible: the byte-identical
// file from a second apply of the same frozen manifest repairs the destination.
func TestExportVerifyFailsWhenSidecarMissingOrAltered(t *testing.T) {
	root := t.TempDir()
	writeExportFixture(t, root, "payload.bin", "sidecar verification payload")
	h := newViewExportHarness(t, root)
	manifest := planFixtureExport(t, h, map[string]any{
		"subjects": []string{h.subjectRef}, "sidecars": exact.ExportSidecarPolicyHandoffV1ManifestJSON,
	})

	destination := filepath.Join(t.TempDir(), "out")
	intact := filepath.Join(t.TempDir(), "out-intact")
	applyAndVerifyExport(t, h, manifest, destination)
	applyAndVerifyExport(t, h, manifest, intact)
	want := readExportSidecar(t, intact)

	verify := func() command.Result {
		t.Helper()
		return handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportVerify, map[string]any{
			"manifest_id": manifest.ManifestID, "manifest_digest": manifest.ManifestDigest,
			"destination": destination,
		}))
	}

	// A missing sidecar fails with the reason; the subject files are untouched.
	sidecarPath := filepath.Join(destination, exact.ExportSidecarFileName)
	if err := os.Remove(sidecarPath); err != nil {
		t.Fatalf("remove sidecar: %v", err)
	}
	missing := verify()
	if missing.Status != command.StatusFailed || len(missing.Reasons) == 0 ||
		!strings.Contains(missing.Reasons[0].Message, "missing the sidecar") ||
		!strings.Contains(missing.Reasons[0].Message, exact.ExportSidecarFileName) {
		t.Fatalf("missing-sidecar verify = %q: %+v", missing.Status, missing.Reasons)
	}
	if subject, err := os.ReadFile(filepath.Join(destination, h.subjectName)); err != nil ||
		string(subject) != "sidecar verification payload" {
		t.Fatalf("subject output after sidecar removal = %q, err=%v", subject, err)
	}

	// The identical sidecar from the second apply repairs the destination.
	if err := os.WriteFile(sidecarPath, want, 0o644); err != nil {
		t.Fatalf("restore sidecar: %v", err)
	}
	if repaired := verify(); repaired.Status != command.StatusSucceeded {
		t.Fatalf("repaired verify = %q: %+v", repaired.Status, repaired.Reasons)
	}

	// One altered byte of the same length is not a clean verify.
	altered := append([]byte(nil), want...)
	altered[len(altered)/2] ^= 0xff
	if err := os.WriteFile(sidecarPath, altered, 0o644); err != nil {
		t.Fatalf("alter sidecar: %v", err)
	}
	info, err := os.Stat(sidecarPath)
	if err != nil {
		t.Fatalf("stat altered sidecar: %v", err)
	}
	if info.Size() != int64(len(want)) {
		t.Fatalf("altered sidecar length = %d, want the original %d", info.Size(), len(want))
	}
	tampered := verify()
	if tampered.Status != command.StatusFailed || len(tampered.Reasons) == 0 ||
		!strings.Contains(tampered.Reasons[0].Message, "does not match the frozen manifest") ||
		!strings.Contains(tampered.Reasons[0].Message, exact.ExportSidecarFileName) {
		t.Fatalf("altered-sidecar verify = %q: %+v", tampered.Status, tampered.Reasons)
	}
}

// TestExportPlanRejectsSidecarFileNameCollision proves a frozen output that
// would occupy the derived sidecar path fails as invalid_input with nothing
// frozen, while the same selection without the policy still materializes and
// verifies.
func TestExportPlanRejectsSidecarFileNameCollision(t *testing.T) {
	root := t.TempDir()
	writeExportFixture(t, root, exact.ExportSidecarFileName, "subject that shares the sidecar name")
	h := newViewExportHarness(t, root)

	rejected := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportPlan, map[string]any{
		"subjects": []string{h.subjectRef}, "sidecars": exact.ExportSidecarPolicyHandoffV1ManifestJSON,
	}))
	if rejected.Status != command.StatusFailed || !hasReasonCode(rejected, ReasonCodeInvalidInput) ||
		len(rejected.Reasons) == 0 || !strings.Contains(rejected.Reasons[0].Message, "collides") {
		t.Fatalf("colliding sidecar plan = %q: %+v", rejected.Status, rejected.Reasons)
	}

	listed := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportList, nil))
	var manifests []command.ExportManifestData
	if err := json.Unmarshal(listed.Data, &manifests); err != nil {
		t.Fatalf("decode export.list: %v", err)
	}
	if len(manifests) != 0 {
		t.Fatalf("colliding sidecar plan froze a manifest: %+v", manifests)
	}

	// Without the sidecar policy the same name is an ordinary frozen output.
	manifest := planFixtureExport(t, h, map[string]any{"subjects": []string{h.subjectRef}})
	destination := filepath.Join(t.TempDir(), "out")
	applyAndVerifyExport(t, h, manifest, destination)
	got, err := os.ReadFile(filepath.Join(destination, exact.ExportSidecarFileName))
	if err != nil || string(got) != "subject that shares the sidecar name" {
		t.Fatalf("materialized subject = %q, err=%v", got, err)
	}
}

// TestExportRefusesFrozenUnimplementedSidecarPolicy proves a frozen manifest
// that carries a policy no build implements - the state a manifest planned
// before the sidecar vocabulary existed is in - fails apply and verify as
// invalid_input with nothing written, instead of silently materializing the
// subject files without the requested sidecar.
func TestExportRefusesFrozenUnimplementedSidecarPolicy(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	writeExportFixture(t, root, "payload.bin", "legacy policy bytes")
	h := newViewExportHarness(t, root)

	planned := planFixtureExport(t, h, map[string]any{"subjects": []string{h.subjectRef}})
	items := frozenItems(t, planned)
	if len(items) != 1 {
		t.Fatalf("frozen items = %+v, want 1", items)
	}
	const legacyPolicy = "keep-metadata-and-subtitle-sidecars"
	legacy := exact.ExportManifest{
		Schema: exact.ExportManifestSchemaV1, ManifestID: "exm_" + strings.Repeat("e", 32),
		Representation: "exact", Sidecars: legacyPolicy,
		ConfigDigest:        h.dispatcher.effectiveConfigDigest(),
		TargetProfileDigest: exact.DescribeExportManifestProfile(h.dispatcher.exact.Repo),
		Items:               items,
	}
	legacyDigest, err := legacy.PrepareExportManifestDigest()
	if err != nil {
		t.Fatalf("prepare legacy digest: %v", err)
	}
	if _, err := h.dispatcher.store.InsertExportManifest(ctx, sqlite.ExportManifest{
		ManifestID: legacy.ManifestID, ManifestDigest: legacyDigest,
		Representation: legacy.Representation, Sidecars: legacyPolicy,
		SubjectCount: len(items), Items: exportItemsToStrings(items),
	}); err != nil {
		t.Fatalf("insert legacy manifest: %v", err)
	}

	destination := filepath.Join(t.TempDir(), "out")
	applied := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportApply, map[string]any{
		"manifest_id": legacy.ManifestID, "manifest_digest": legacyDigest, "destination": destination,
	}))
	if applied.Status != command.StatusFailed || !hasReasonCode(applied, ReasonCodeInvalidInput) ||
		len(applied.Reasons) == 0 || !strings.Contains(applied.Reasons[0].Message, legacyPolicy) {
		t.Fatalf("legacy-policy export.apply = %q: %+v", applied.Status, applied.Reasons)
	}
	if _, err := os.Lstat(destination); !os.IsNotExist(err) {
		t.Fatalf("legacy-policy apply touched the destination: %v", err)
	}

	verified := handleViewExport(h.dispatcher, mustEnvelope(t, command.OpExportVerify, map[string]any{
		"manifest_id": legacy.ManifestID, "manifest_digest": legacyDigest, "destination": destination,
	}))
	if verified.Status != command.StatusFailed || !hasReasonCode(verified, ReasonCodeInvalidInput) {
		t.Fatalf("legacy-policy export.verify = %q: %+v", verified.Status, verified.Reasons)
	}
}
