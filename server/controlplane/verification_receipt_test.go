package controlplane

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

// mustEnvelopeWithRequestID builds an envelope whose request id is fixed, so
// tests can prove the recorded receipt carries the caller's request id.
func mustEnvelopeWithRequestID(t *testing.T, requestID, operation string, input any) command.Envelope {
	t.Helper()
	env := mustEnvelope(t, operation, input)
	env.RequestID = requestID
	return env
}

func snapshotAuditRows(t *testing.T, store *sqlite.Store, workspaceID string) []sqlite.AuditEvent {
	t.Helper()
	events, err := store.ListAuditEvents(context.Background(), workspaceID, 0, 500)
	if err != nil {
		t.Fatalf("list audit events: %v", err)
	}
	var rows []sqlite.AuditEvent
	for _, event := range events {
		if event.TargetType == sqlite.AuditTargetSnapshot {
			rows = append(rows, event)
		}
	}
	return rows
}

func findSnapshotSummary(t *testing.T, data command.SnapshotListData, snapshotRef string) command.SnapshotSummary {
	t.Helper()
	for _, summary := range data.Snapshots {
		if summary.SnapshotRef == snapshotRef {
			return summary
		}
	}
	t.Fatalf("snapshot %s missing from list: %+v", snapshotRef, data.Snapshots)
	return command.SnapshotSummary{}
}

// TestSnapshotVerifyWritesOneAppendOnlyReceiptPerRun proves one receipt per
// run, append rather than overwrite, caller request-id retention, and that
// aborted runs and never-verified snapshots write and report nothing healthy.
func TestSnapshotVerifyWritesOneAppendOnlyReceiptPerRun(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock", WithExact(&exact.Service{
		Store: store,
		Repo:  repo,
	}))
	first := t.TempDir()
	if err := os.WriteFile(filepath.Join(first, "a.txt"), []byte("verify-one"), 0o600); err != nil {
		t.Fatal(err)
	}
	ingest := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": first})
	second := t.TempDir()
	if err := os.WriteFile(filepath.Join(second, "b.txt"), []byte("verify-two"), 0o600); err != nil {
		t.Fatal(err)
	}
	unverified := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": second})

	listSnapshots := func() command.SnapshotListData {
		t.Helper()
		result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSnapshotList, map[string]any{}))
		if result.Status != command.StatusSucceeded {
			t.Fatalf("snapshot.list = %q: %+v", result.Status, result.Reasons)
		}
		var data command.SnapshotListData
		if err := json.Unmarshal(result.Data, &data); err != nil {
			t.Fatal(err)
		}
		return data
	}

	// Before any run: no receipt, and no zeroed timestamp pretending to be one.
	before := findSnapshotSummary(t, listSnapshots(), ingest.SnapshotRef)
	if before.Verification == nil ||
		before.Verification.State != command.SnapshotVerificationStateUnrecorded ||
		before.Verification.Reason == "" ||
		before.Verification.VerifiedAt != "" {
		t.Fatalf("unverified restore point = %+v, want UNRECORDED with a reason and no timestamp", before.Verification)
	}
	if rows := snapshotAuditRows(t, store, ingest.WorkspaceID); len(rows) != 0 {
		t.Fatalf("unverified catalog already has %d snapshot audit rows", len(rows))
	}

	metadata := dispatcher.Handle(ctx, mustEnvelopeWithRequestID(t, "req-verify-one", command.OpSnapshotVerify, map[string]any{
		"snapshot_ref": ingest.SnapshotRef,
		"mode":         command.VerifyAuthenticatedMetadata,
	}))
	if metadata.Status != command.StatusSucceeded {
		t.Fatalf("metadata verify = %q: %+v", metadata.Status, metadata.Reasons)
	}
	rows := snapshotAuditRows(t, store, ingest.WorkspaceID)
	if len(rows) != 1 {
		t.Fatalf("one verify run wrote %d snapshot audit rows, want exactly 1", len(rows))
	}
	if rows[0].Action != sqlite.AuditActionSnapshotVerifySucceeded || rows[0].TargetID != ingest.SnapshotRef ||
		rows[0].RequestID != "req-verify-one" || rows[0].Outcome != "SUCCEEDED" {
		t.Fatalf("verification receipt row = %+v", rows[0])
	}

	afterMetadata := findSnapshotSummary(t, listSnapshots(), ingest.SnapshotRef)
	receipt := afterMetadata.Verification
	if receipt == nil || receipt.State != command.SnapshotVerificationStateRecorded ||
		receipt.Outcome != command.SnapshotVerificationOutcomeSucceeded ||
		receipt.Mode != command.VerifyAuthenticatedMetadata || !receipt.OK {
		t.Fatalf("recorded receipt = %+v", receipt)
	}
	if receipt.AttemptedFiles != snapshotReadInt(t, "files", afterMetadata.Files) || receipt.PassedFiles != snapshotReadInt(t, "files", afterMetadata.Files) ||
		receipt.AttemptedBytes != snapshotReadBytes(t, afterMetadata.Bytes) || receipt.PassedBytes != snapshotReadBytes(t, afterMetadata.Bytes) {
		t.Fatalf("receipt counts = %+v do not match the restore point %+v", receipt, afterMetadata)
	}
	if receipt.RequestID != "req-verify-one" || receipt.VerifiedAt == "" {
		t.Fatalf("receipt provenance = request %q verified_at %q", receipt.RequestID, receipt.VerifiedAt)
	}
	if _, err := time.Parse(time.RFC3339, receipt.VerifiedAt); err != nil {
		t.Fatalf("verified_at %q: %v", receipt.VerifiedAt, err)
	}

	// A second run appends; the first row is never rewritten.
	full := dispatcher.Handle(ctx, mustEnvelopeWithRequestID(t, "req-verify-two", command.OpSnapshotVerify, map[string]any{
		"snapshot_ref": ingest.SnapshotRef,
		"mode":         command.VerifyFullBytes,
	}))
	if full.Status != command.StatusSucceeded {
		t.Fatalf("full-bytes verify = %q: %+v", full.Status, full.Reasons)
	}
	rows = snapshotAuditRows(t, store, ingest.WorkspaceID)
	if len(rows) != 2 {
		t.Fatalf("second verify run left %d rows, want 2 appended rows", len(rows))
	}
	if rows[0].Action != sqlite.AuditActionSnapshotVerifySucceeded || rows[0].RequestID != "req-verify-one" {
		t.Fatalf("first receipt was rewritten: %+v", rows[0])
	}
	var firstDetails snapshotVerifyReceiptDetails
	if err := json.Unmarshal(rows[0].Details, &firstDetails); err != nil {
		t.Fatal(err)
	}
	if firstDetails.Mode != command.VerifyAuthenticatedMetadata {
		t.Fatalf("first receipt details = %+v, want the metadata run", firstDetails)
	}
	latest := findSnapshotSummary(t, listSnapshots(), ingest.SnapshotRef).Verification
	if latest == nil || latest.Mode != command.VerifyFullBytes || latest.RequestID != "req-verify-two" {
		t.Fatalf("latest receipt = %+v, want the full-bytes run", latest)
	}

	// A snapshot that was never verified in the same catalog stays UNRECORDED.
	stillUnverified := findSnapshotSummary(t, listSnapshots(), unverified.SnapshotRef)
	if stillUnverified.Verification == nil ||
		stillUnverified.Verification.State != command.SnapshotVerificationStateUnrecorded ||
		stillUnverified.Verification.VerifiedAt != "" {
		t.Fatalf("second restore point = %+v, want UNRECORDED", stillUnverified.Verification)
	}

	// Aborted runs write nothing: an unknown mode is refused before any
	// verification and must not leave a success-looking receipt.
	unknown := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSnapshotVerify, map[string]any{
		"snapshot_ref": ingest.SnapshotRef,
		"mode":         "looks-fine",
	}))
	if unknown.Status != command.StatusFailed {
		t.Fatalf("unknown mode = %q: %+v", unknown.Status, unknown.Reasons)
	}
	if rows := snapshotAuditRows(t, store, ingest.WorkspaceID); len(rows) != 2 {
		t.Fatalf("aborted run wrote a receipt: %d rows", len(rows))
	}
	missing := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSnapshotVerify, map[string]any{
		"snapshot_ref": "snap_00000000000000000000000000000000",
	}))
	if missing.Status != command.StatusFailed {
		t.Fatalf("missing snapshot = %q: %+v", missing.Status, missing.Reasons)
	}
	if rows := snapshotAuditRows(t, store, ingest.WorkspaceID); len(rows) != 2 {
		t.Fatalf("missing-snapshot run wrote a receipt: %d rows", len(rows))
	}
}

// TestSnapshotVerifyFailureReceiptIsReadableAsFailed proves a verification
// that found broken repository bytes records a FAILED receipt with its reason
// while the restore point stays listed.
func TestSnapshotVerifyFailureReceiptIsReadableAsFailed(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repoDir := filepath.Join(t.TempDir(), "repository")
	repo, err := repository.OpenDir(repoDir)
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock", WithExact(&exact.Service{
		Store: store,
		Repo:  repo,
	}))
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("tamper-me"), 0o600); err != nil {
		t.Fatal(err)
	}
	ingest := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})

	// Corrupt the stored repository object so readback verification finds a
	// mismatch while the portable snapshot itself stays readable.
	manifestPayload, err := os.ReadFile(filepath.Join(repoDir, "snapshots", ingest.SnapshotRef+".json"))
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var manifest struct {
		Entries []struct {
			EntryType string `json:"entry_type"`
			ContentID string `json:"content_id"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(manifestPayload, &manifest); err != nil {
		t.Fatal(err)
	}
	contentID := ""
	for _, entry := range manifest.Entries {
		if entry.EntryType == string(sqlite.EntryFile) && entry.ContentID != "" {
			contentID = entry.ContentID
		}
	}
	if contentID == "" {
		t.Fatalf("manifest has no file content id: %s", manifestPayload)
	}
	hexID := strings.TrimPrefix(contentID, "sha256:")
	blobPath := filepath.Join(repoDir, "blobs", "sha256", hexID[:2], hexID)
	if err := os.WriteFile(blobPath, []byte("corrupt"), 0o600); err != nil {
		t.Fatalf("corrupt blob %s: %v", blobPath, err)
	}

	verified := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSnapshotVerify, map[string]any{
		"snapshot_ref": ingest.SnapshotRef,
	}))
	if verified.Status != command.StatusFailed {
		t.Fatalf("corrupted verify = %q: %+v", verified.Status, verified.Reasons)
	}
	rows := snapshotAuditRows(t, store, ingest.WorkspaceID)
	if len(rows) != 1 || rows[0].Action != sqlite.AuditActionSnapshotVerifyFailed {
		t.Fatalf("failed verification receipt rows = %+v", rows)
	}
	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSnapshotList, map[string]any{}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("snapshot.list = %q: %+v", result.Status, result.Reasons)
	}
	var data command.SnapshotListData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	receipt := findSnapshotSummary(t, data, ingest.SnapshotRef).Verification
	if receipt == nil || receipt.State != command.SnapshotVerificationStateRecorded ||
		receipt.Outcome != command.SnapshotVerificationOutcomeFailed ||
		receipt.FailureReason == "" || receipt.OK {
		t.Fatalf("failed receipt = %+v, want FAILED with a reason and no ok flag", receipt)
	}
	if receipt.Mode != command.VerifyFullBytes {
		t.Fatalf("failed receipt mode = %q, want the mode that ran", receipt.Mode)
	}
	if receipt.AttemptedFiles != 1 || receipt.PassedFiles != 0 {
		t.Fatalf("failed receipt counts = %+v, want the failing file attempted and not passed", receipt)
	}
}

// TestLinkOnlyRestorePointReportsUnprotectedMixHonestly proves a mixed restore
// point counts its LINK_ONLY member as unprotected, never counts non-file
// entries, and records an UNAVAILABLE receipt instead of a pass when the
// requested bytes are not locally restorable.
func TestLinkOnlyRestorePointReportsUnprotectedMixHonestly(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatal(err)
	}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock", WithExact(&exact.Service{
		Store: store, Repo: repo, AllowLinkOnly: true, LinkOnlyRequiresConfirmation: true,
	}))
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "stored"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "stored", "stored.bin"), []byte("stored"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "linked.bin"), []byte("linked"), 0o600); err != nil {
		t.Fatal(err)
	}
	ingest := mustAppliedIngest(t, ctx, dispatcher, map[string]any{
		"root":              root,
		"confirm_link_only": true,
		"file_protection":   map[string]string{"linked.bin": "LINK_ONLY"},
		"external_locators": []map[string]any{{
			"path":    "linked.bin",
			"locator": "https://downloads.example.test/linked.bin",
		}},
	})

	list := func() command.SnapshotListData {
		t.Helper()
		result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSnapshotList, map[string]any{}))
		if result.Status != command.StatusSucceeded {
			t.Fatalf("snapshot.list = %q: %+v", result.Status, result.Reasons)
		}
		var data command.SnapshotListData
		if err := json.Unmarshal(result.Data, &data); err != nil {
			t.Fatal(err)
		}
		return data
	}

	summary := findSnapshotSummary(t, list(), ingest.SnapshotRef)
	if snapshotReadInt(t, "files", summary.Files) != 2 || snapshotReadInt(t, "protected_files", summary.ProtectedFiles) != 1 ||
		snapshotReadInt(t, "unprotected_files", summary.UnprotectedFiles) != 1 {
		t.Fatalf("mixed protection mix = files %d protected %d unprotected %d, want 2/1/1",
			snapshotReadInt(t, "files", summary.Files), snapshotReadInt(t, "protected_files", summary.ProtectedFiles),
			snapshotReadInt(t, "unprotected_files", summary.UnprotectedFiles))
	}
	// The locally stored member is protected whichever recorded exact outcome
	// the detector produced; the LINK_ONLY member must never count as protected.
	localExact := summary.ProtectionOutcomes[string(sqlite.ProtectionExactProtected)] +
		summary.ProtectionOutcomes[string(sqlite.ProtectionExactFallback)]
	if localExact != 1 || summary.ProtectionOutcomes[string(sqlite.ProtectionLinkOnlyUnprotected)] != 1 {
		t.Fatalf("protection outcomes = %+v", summary.ProtectionOutcomes)
	}
	bucketed := 0
	for _, count := range summary.ProtectionOutcomes {
		bucketed += count
	}
	if bucketed != snapshotReadInt(t, "files", summary.Files) {
		t.Fatalf("protection outcomes %+v do not account for all %d files", summary.ProtectionOutcomes, snapshotReadInt(t, "files", summary.Files))
	}
	if snapshotReadInt(t, "entries", summary.Entries) <= snapshotReadInt(t, "files", summary.Files) {
		t.Fatalf("entries = %d, want non-file entries included and excluded from the protection mix", snapshotReadInt(t, "entries", summary.Entries))
	}
	if snapshotReadBytes(t, summary.Bytes) != int64(len("stored")+len("linked")) || !snapshotReadFlag(t, "bytes_complete", summary.BytesComplete) {
		t.Fatalf("restore point bytes = %+v", summary)
	}

	// Full-bytes verification cannot read the LINK_ONLY member, so the run
	// records the unavailability rather than a pass.
	verified := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSnapshotVerify, map[string]any{
		"snapshot_ref": ingest.SnapshotRef,
	}))
	if verified.Status != command.StatusFailed {
		t.Fatalf("LINK_ONLY full-bytes verify = %q: %+v", verified.Status, verified.Reasons)
	}
	rows := snapshotAuditRows(t, store, ingest.WorkspaceID)
	if len(rows) != 1 || rows[0].Action != sqlite.AuditActionSnapshotVerifyFailed {
		t.Fatalf("unavailable verification receipt rows = %+v", rows)
	}
	receipt := findSnapshotSummary(t, list(), ingest.SnapshotRef).Verification
	if receipt == nil || receipt.State != command.SnapshotVerificationStateRecorded ||
		receipt.Outcome != command.SnapshotVerificationOutcomeUnavailable ||
		receipt.FailureReason == "" || receipt.OK || receipt.PassedFiles != 0 {
		t.Fatalf("unavailable receipt = %+v, want UNAVAILABLE with a reason and no pass", receipt)
	}

	// Authenticated-metadata verification of the same snapshot does pass and
	// appends a second, separate receipt.
	metadata := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSnapshotVerify, map[string]any{
		"snapshot_ref": ingest.SnapshotRef,
		"mode":         command.VerifyAuthenticatedMetadata,
	}))
	if metadata.Status != command.StatusSucceeded {
		t.Fatalf("LINK_ONLY metadata verify = %q: %+v", metadata.Status, metadata.Reasons)
	}
	if rows := snapshotAuditRows(t, store, ingest.WorkspaceID); len(rows) != 2 {
		t.Fatalf("metadata receipt was not appended: %d rows", len(rows))
	}
	latest := findSnapshotSummary(t, list(), ingest.SnapshotRef).Verification
	if latest == nil || latest.Outcome != command.SnapshotVerificationOutcomeSucceeded ||
		latest.Mode != command.VerifyAuthenticatedMetadata || latest.AttemptedFiles != 2 {
		t.Fatalf("latest receipt = %+v, want the metadata pass", latest)
	}
}
