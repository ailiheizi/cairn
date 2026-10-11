package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

type planIngestInput struct {
	Root             string                       `json:"root"`
	ProtectionMode   string                       `json:"protection_mode,omitempty"`
	FileProtection   map[string]string            `json:"file_protection,omitempty"`
	ConfirmLinkOnly  bool                         `json:"confirm_link_only,omitempty"`
	ExternalLocators []command.IngestLocatorInput `json:"external_locators,omitempty"`
}

type planRestoreInput struct {
	SnapshotRef string `json:"snapshot_ref"`
	Destination string `json:"destination"`
}

type snapshotRefInput struct {
	SnapshotRef string `json:"snapshot_ref"`
}

type snapshotVerifyInput struct {
	SnapshotRef string `json:"snapshot_ref"`
	Mode        string `json:"mode"`
	Destination string `json:"destination"`
}

func (d *Dispatcher) handlePlanIngest(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil {
		return unimplementedResult(env, started)
	}
	var input planIngestInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if strings.TrimSpace(input.Root) == "" {
		return invalidInputResult(env, started, errString("root is required"))
	}
	locators := make([]exact.IngestLocator, 0, len(input.ExternalLocators))
	for _, locator := range input.ExternalLocators {
		locators = append(locators, exact.IngestLocator{
			Path: locator.Path, Kind: locator.Kind, Locator: locator.Locator,
			DisplayLocator: locator.DisplayLocator, CredentialRef: locator.CredentialRef,
			RightsEvidenceRef: locator.RightsEvidenceRef,
		})
	}
	fileProtection := make(map[string]sqlite.ProtectionMode, len(input.FileProtection))
	for path, mode := range input.FileProtection {
		fileProtection[path] = sqlite.ProtectionMode(mode)
	}
	inspected, err := d.exact.InspectIngest(ctx, input.Root, exact.IngestOptions{
		ProtectionMode:   sqlite.ProtectionMode(input.ProtectionMode),
		FileProtection:   fileProtection,
		ConfirmLinkOnly:  input.ConfirmLinkOnly,
		ExternalLocators: locators,
	})
	if err != nil {
		if errors.Is(err, exact.ErrBlocked) {
			return invalidInputResult(env, started, err)
		}
		// A publication the repository cannot place is refused while planning,
		// before any catalog or repository mutation, as ordinary invalid input.
		// Without this the operator would only learn the bound from a
		// mid-apply UNKNOWN_EXTERNAL_OUTCOME whose offered resolution is to
		// replay the same failing plan.apply.
		if errors.Is(err, exact.ErrPortableRecordTooLarge) {
			return invalidInputResult(env, started, err)
		}
		return failed(env, started, newReason(ReasonCodeCatalogError, err.Error()))
	}
	workspaceID, err := d.ensurePlanningSource(ctx, &inspected)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	planID, digest, jobID, err := d.recordIngestPlan(ctx, workspaceID, inspected)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	data := command.PlanIngestData{
		WorkspaceID:         workspaceID,
		SourceID:            inspected.SourceID,
		PlanID:              planID,
		PlanDigest:          digest,
		JobID:               jobID,
		ProtectionMode:      string(inspected.ProtectionMode),
		ProtectionDigest:    inspected.ProtectionDigest,
		FileProtection:      protectionModesForCommand(inspected.FileProtection),
		ProtectionDecisions: protectionDecisionsForCommand(inspected.ProtectionDecisions),
		BlockedEntries:      ingestPlanIssuesForCommand(inspected.BlockedEntries),
		Files:               inspected.Estimate.Files,
		Bytes:               inspected.Estimate.Bytes,
		LocalFiles:          inspected.Estimate.LocalFiles,
		LocalBytes:          inspected.Estimate.LocalBytes,
		NewBytes:            inspected.Estimate.NewBytes,
		LinkOnlyFiles:       inspected.Estimate.LinkOnlyFiles,
		LocatorCount:        inspected.Estimate.LocatorCount,
		State:               string(sqlite.PlanReady),
		Executable:          inspected.Executable,
		ConfigDigest:        firstNonEmpty(inspected.ConfigDigest, d.configDigest),
		SourceBasisDigest:   inspected.CaptureBasisDigest,
	}
	return succeeded(env, started, data)
}

func ingestPlanIssuesForCommand(issues []exact.IngestPlanIssue) []command.IngestPlanIssueData {
	if len(issues) == 0 {
		return nil
	}
	result := make([]command.IngestPlanIssueData, 0, len(issues))
	for _, issue := range issues {
		result = append(result, command.IngestPlanIssueData{
			RelativePath:   issue.RelativePath,
			Mode:           string(issue.Mode),
			PlannedOutcome: string(issue.PlannedOutcome),
			State:          issue.State,
			ReasonCode:     issue.ReasonCode,
			Message:        issue.Message,
		})
	}
	return result
}

func protectionDecisionsForCommand(decisions []exact.IngestProtectionDecision) []command.IngestProtectionDecisionData {
	if len(decisions) == 0 {
		return nil
	}
	result := make([]command.IngestProtectionDecisionData, 0, len(decisions))
	for _, decision := range decisions {
		result = append(result, command.IngestProtectionDecisionData{
			RelativePath:         decision.RelativePath,
			Mode:                 string(decision.Mode),
			PlannedOutcome:       string(decision.PlannedOutcome),
			ReasonCode:           decision.ReasonCode,
			ExpectedContentID:    decision.ExpectedContentID,
			ExpectedLogicalBytes: decision.ExpectedLogicalBytes,
			LocatorCount:         decision.LocatorCount,
		})
	}
	return result
}

func protectionModesForCommand(modes map[string]sqlite.ProtectionMode) map[string]string {
	if len(modes) == 0 {
		return nil
	}
	result := make(map[string]string, len(modes))
	for path, mode := range modes {
		result[path] = string(mode)
	}
	return result
}

func (d *Dispatcher) handlePlanRestore(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil {
		return unimplementedResult(env, started)
	}
	var input planRestoreInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if strings.TrimSpace(input.SnapshotRef) == "" {
		return invalidInputResult(env, started, errString("snapshot_ref is required"))
	}
	inspected, err := d.exact.InspectRestore(ctx, input.SnapshotRef, strings.TrimSpace(input.Destination))
	if err != nil {
		return exactOperationErrorResult(env, started, err)
	}
	var planID, digest, workspaceID string
	if d.recoveryReader != nil {
		planID, digest, workspaceID, err = d.recordRecoveryRestorePlan(inspected)
	} else {
		planID, digest, workspaceID, err = d.recordRestorePlan(ctx, inspected)
	}
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	data := command.PlanRestoreData{
		WorkspaceID: workspaceID,
		SnapshotRef: inspected.SnapshotRef,
		Destination: inspected.Destination,
		Files:       inspected.Files,
		Bytes:       inspected.Bytes,
		Wrote:       false,
		PlanID:      planID,
		PlanDigest:  digest,
		State:       string(sqlite.PlanReady),
		Executable:  inspected.Destination != "",
	}
	return succeeded(env, started, data)
}

func (d *Dispatcher) handleSnapshotList(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil {
		return unimplementedResult(env, started)
	}
	manifests, err := d.exact.ListSnapshots(ctx)
	if err != nil {
		return failed(env, started, newReason(ReasonCodeCatalogError, err.Error()))
	}
	summaries := make([]command.SnapshotSummary, 0, len(manifests))
	for _, manifest := range manifests {
		summary := command.SnapshotSummary{
			SnapshotRef:    manifest.SnapshotRef,
			CreatedAt:      manifest.CreatedAt.UTC().Format(time.RFC3339),
			DisplayPath:    manifest.Binding.DisplayPath,
			ManifestDigest: manifest.ManifestDigest,
		}
		applySnapshotManifestFacts(&summary, manifest)
		// Namespace browsing and verification receipts are optional
		// operational projections. Snapshot discovery and recovery remain
		// repository-backed when the catalog is absent, and an absent receipt
		// is reported as UNRECORDED with a reason rather than a zeroed time.
		summary.Verification = unrecordedSnapshotVerification(
			"catalog is not attached; verification receipts are stored in the catalog audit ledger")
		if d.exact.Store != nil {
			if root, rootErr := d.exact.Store.GetNamespaceRootBySnapshotRef(ctx, manifest.SnapshotRef); rootErr == nil {
				summary.WorkspaceID = root.WorkspaceID
				summary.NamespaceRootID = root.ID
				summary.Verification = d.snapshotVerificationReceipt(ctx, root.WorkspaceID, manifest.SnapshotRef)
			} else {
				summary.Verification = unrecordedSnapshotVerification(
					"snapshot has no catalog namespace root; verification receipts are read from the catalog audit ledger")
			}
		}
		summaries = append(summaries, summary)
	}
	return succeeded(env, started, command.SnapshotListData{Snapshots: summaries})
}

// applySnapshotManifestFacts derives restore-point counts only from the
// repository-loaded manifest. Non-file entries never contribute to the
// protection mix: their recorded METADATA_ONLY projection says nothing about
// user content protection. Every regular file lands in exactly one outcome
// bucket, including an explicit UNRECORDED bucket for a legacy entry without a
// recorded outcome, so no member silently disappears from the mix.
func applySnapshotManifestFacts(summary *command.SnapshotSummary, manifest exact.Manifest) {
	outcomes := map[string]int{}
	complete := true
	for _, entry := range manifest.Entries {
		summary.Entries++
		if sqlite.NamespaceEntryType(entry.EntryType) != sqlite.EntryFile {
			continue
		}
		summary.Files++
		if entry.LogicalSize == nil {
			complete = false
		} else {
			summary.Bytes += *entry.LogicalSize
		}
		outcome := entry.Protection.Outcome
		if outcome == "" {
			outcome = command.SnapshotProtectionOutcomeUnrecorded
		}
		outcomes[outcome]++
		switch sqlite.ProtectionOutcome(outcome) {
		case sqlite.ProtectionExactProtected, sqlite.ProtectionExactFallback:
			summary.ProtectedFiles++
		case sqlite.ProtectionLinkOnlyUnprotected, sqlite.ProtectionExplicitlyUnprotected:
			summary.UnprotectedFiles++
		}
	}
	summary.BytesComplete = complete
	if len(outcomes) > 0 {
		summary.ProtectionOutcomes = outcomes
	}
}

func unrecordedSnapshotVerification(reason string) *command.SnapshotVerificationData {
	return &command.SnapshotVerificationData{
		State:  command.SnapshotVerificationStateUnrecorded,
		Reason: reason,
	}
}

// snapshotVerificationReceipt reads the newest append-only verification
// receipt. A missing or unreadable receipt is UNRECORDED with a reason; it is
// never a zeroed timestamp and never a healthy default.
func (d *Dispatcher) snapshotVerificationReceipt(ctx context.Context, workspaceID, snapshotRef string) *command.SnapshotVerificationData {
	if d == nil || d.store == nil {
		return unrecordedSnapshotVerification(
			"catalog is not attached; verification receipts are stored in the catalog audit ledger")
	}
	event, err := d.store.LatestSnapshotVerificationEvent(ctx, workspaceID, snapshotRef)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			return unrecordedSnapshotVerification(
				"no snapshot.verify receipt has been recorded for this restore point")
		}
		return unrecordedSnapshotVerification("verification receipts could not be read: " + err.Error())
	}
	var details snapshotVerifyReceiptDetails
	if err := json.Unmarshal(event.Details, &details); err != nil {
		return unrecordedSnapshotVerification("the newest verification receipt is unreadable: " + err.Error())
	}
	return &command.SnapshotVerificationData{
		State:           command.SnapshotVerificationStateRecorded,
		Mode:            details.Mode,
		Outcome:         details.Outcome,
		AttemptedFiles:  details.AttemptedFiles,
		AttemptedBytes:  details.AttemptedBytes,
		PassedFiles:     details.PassedFiles,
		PassedBytes:     details.PassedBytes,
		OK:              details.OK,
		RestoreVerified: details.RestoreVerified,
		FailureReason:   details.Reason,
		VerifiedAt:      event.OccurredAt.UTC().Format(time.RFC3339),
		RequestID:       firstNonEmpty(details.RequestID, event.RequestID),
	}
}

type snapshotDiffInput struct {
	FromSnapshotRef string `json:"from_snapshot_ref"`
	ToSnapshotRef   string `json:"to_snapshot_ref"`
}

type recoveryExportInput struct {
	SnapshotRef string `json:"snapshot_ref"`
	Destination string `json:"destination"`
}

type recoveryAnchorExportInput struct {
	Destination string `json:"destination"`
}

func (d *Dispatcher) handleSnapshotDiff(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil {
		return unimplementedResult(env, started)
	}
	var input snapshotDiffInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if strings.TrimSpace(input.FromSnapshotRef) == "" || strings.TrimSpace(input.ToSnapshotRef) == "" {
		return invalidInputResult(env, started, errString("from_snapshot_ref and to_snapshot_ref are required"))
	}
	diffed, err := d.exact.DiffSnapshots(ctx, input.FromSnapshotRef, input.ToSnapshotRef)
	if err != nil {
		return failed(env, started, newReason(ReasonCodeCatalogError, err.Error()))
	}
	return succeeded(env, started, command.SnapshotDiffData{
		FromSnapshotRef: diffed.FromSnapshotRef,
		ToSnapshotRef:   diffed.ToSnapshotRef,
		Changes:         diffed.Changes,
	})
}

func (d *Dispatcher) handleRecoveryExport(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil {
		return unimplementedResult(env, started)
	}
	var input recoveryExportInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if strings.TrimSpace(input.SnapshotRef) == "" || strings.TrimSpace(input.Destination) == "" {
		return invalidInputResult(env, started, errString("snapshot_ref and destination are required"))
	}
	exported, err := d.exact.ExportRecoveryArtifact(ctx, input.SnapshotRef, input.Destination)
	if err != nil {
		if strings.Contains(err.Error(), "already exists") {
			return conflictResult(env, started, err.Error())
		}
		return failed(env, started, newReason(ReasonCodeCatalogError, err.Error()))
	}
	return succeeded(env, started, command.RecoveryExportData{
		SnapshotRef:         exported.SnapshotRef,
		Schema:              exported.Schema,
		ManifestDigest:      exported.ManifestDigest,
		ArtifactPath:        exported.ArtifactPath,
		Length:              exported.Length,
		Files:               exported.Files,
		Bytes:               exported.Bytes,
		IndependentlyStored: exported.IndependentlyStored,
	})
}

func (d *Dispatcher) handleRecoveryAnchorExport(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil {
		return unimplementedResult(env, started)
	}
	var input recoveryAnchorExportInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if strings.TrimSpace(input.Destination) == "" {
		return invalidInputResult(env, started, errString("destination is required"))
	}
	path, err := d.exact.ExportTrustAnchor(input.Destination)
	if err != nil {
		if errors.Is(err, exact.ErrBlocked) {
			return conflictResult(env, started, err.Error())
		}
		return exactOperationErrorResult(env, started, err)
	}
	anchor := d.exact.TrustAnchor
	if anchor == nil {
		return failed(env, started, newReason(ReasonCodeCatalogError, "recovery trust anchor is unavailable"))
	}
	return succeeded(env, started, command.RecoveryAnchorExportData{
		Schema:            anchor.Schema,
		ArtifactPath:      path,
		PublicationDomain: anchor.PublicationDomain,
		WriterIdentity:    anchor.WriterIdentity,
		KeyID:             anchor.KeyID,
		Algorithm:         anchor.Algorithm,
		PublicKeyDigest:   anchor.PublicKeyDigest,
	})
}

func (d *Dispatcher) handleSnapshotVerify(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil {
		return unimplementedResult(env, started)
	}
	var input snapshotVerifyInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if strings.TrimSpace(input.SnapshotRef) == "" {
		return invalidInputResult(env, started, errString("snapshot_ref is required"))
	}
	verified, err := d.exact.VerifyMode(ctx, input.SnapshotRef, input.Mode, input.Destination)
	// One append-only receipt per run. Runs that never attempted verification
	// (invalid mode or destination, unknown snapshot, cancelled context) write
	// nothing, so they can never be mistaken for a pass.
	receiptErr := d.recordSnapshotVerificationReceipt(ctx, env.RequestID, input.SnapshotRef, verified, err)
	if err != nil {
		return exactOperationErrorResult(env, started, err)
	}
	data := command.SnapshotVerifyData{
		SnapshotRef:     verified.SnapshotRef,
		Mode:            verified.Mode,
		AcceptedLevel:   verified.AcceptedLevel,
		Entries:         verified.Entries,
		Files:           verified.Files,
		Bytes:           verified.Bytes,
		AttemptedFiles:  verified.AttemptedFiles,
		AttemptedBytes:  verified.AttemptedBytes,
		PassedFiles:     verified.PassedFiles,
		PassedBytes:     verified.PassedBytes,
		OK:              verified.OK,
		RestoreVerified: verified.RestoreVerified,
		CatalogUsed:     verified.CatalogUsed,
	}
	if receiptErr != nil {
		// The verification itself succeeded and stays valid; the missing
		// receipt is reported explicitly instead of being hidden.
		return degradedResult(env, started, data,
			"snapshot verification succeeded, but the audit receipt could not be recorded: "+receiptErr.Error())
	}
	return succeeded(env, started, data)
}

// snapshotVerifyReceiptDetails is the append-only audit details payload for
// one verification run. It carries the mode that ran, the recorded outcome,
// the counts the run actually reached, the caller request id, and the failure
// or unavailability reason when the run did not pass.
type snapshotVerifyReceiptDetails struct {
	Mode            string `json:"mode"`
	Outcome         string `json:"outcome"`
	AttemptedFiles  int    `json:"attempted_files"`
	AttemptedBytes  int64  `json:"attempted_bytes"`
	PassedFiles     int    `json:"passed_files"`
	PassedBytes     int64  `json:"passed_bytes"`
	OK              bool   `json:"ok"`
	RestoreVerified bool   `json:"restore_verified"`
	RequestID       string `json:"request_id"`
	Reason          string `json:"reason,omitempty"`
}

// snapshotVerificationReceiptOutcome classifies one verification error into
// the receipt outcome. Runs that never attempted verification report no
// outcome and write nothing.
func snapshotVerificationReceiptOutcome(verifyErr error) (string, bool) {
	switch {
	case verifyErr == nil:
		return command.SnapshotVerificationOutcomeSucceeded, true
	case errors.Is(verifyErr, exact.ErrVerificationUnavailable):
		return command.SnapshotVerificationOutcomeUnavailable, true
	case errors.Is(verifyErr, exact.ErrBlocked),
		errors.Is(verifyErr, context.Canceled),
		errors.Is(verifyErr, context.DeadlineExceeded),
		containsNotFound(verifyErr):
		return "", false
	default:
		return command.SnapshotVerificationOutcomeFailed, true
	}
}

// recordSnapshotVerificationReceipt appends exactly one audit event for a
// completed verification. Catalog-free readers retain no audit ledger and
// return nil; a snapshot without a catalog namespace root cannot be keyed to a
// workspace, so it stays visibly unreceipted instead of fabricating one.
func (d *Dispatcher) recordSnapshotVerificationReceipt(
	ctx context.Context, requestID, snapshotRef string, result exact.VerifyResult, verifyErr error,
) error {
	if d == nil || d.store == nil {
		return nil
	}
	outcome, record := snapshotVerificationReceiptOutcome(verifyErr)
	if !record {
		return nil
	}
	root, err := d.store.GetNamespaceRootBySnapshotRef(ctx, snapshotRef)
	if err != nil {
		if containsNotFound(err) {
			return nil
		}
		return err
	}
	reason := ""
	if verifyErr != nil {
		reason = verifyErr.Error()
	}
	details, err := json.Marshal(snapshotVerifyReceiptDetails{
		Mode:            result.Mode,
		Outcome:         outcome,
		AttemptedFiles:  result.AttemptedFiles,
		AttemptedBytes:  result.AttemptedBytes,
		PassedFiles:     result.PassedFiles,
		PassedBytes:     result.PassedBytes,
		OK:              result.OK,
		RestoreVerified: result.RestoreVerified,
		RequestID:       requestID,
		Reason:          reason,
	})
	if err != nil {
		return err
	}
	action := sqlite.AuditActionSnapshotVerifyFailed
	auditOutcome := "FAILED"
	if outcome == command.SnapshotVerificationOutcomeSucceeded {
		action = sqlite.AuditActionSnapshotVerifySucceeded
		auditOutcome = "SUCCEEDED"
	}
	return d.store.Update(ctx, func(tx *sqlite.Tx) error {
		return tx.AppendAuditEvent(ctx, &sqlite.AuditEvent{
			ID:          mustAuditID(),
			WorkspaceID: root.WorkspaceID,
			Actor:       "cairnd",
			Action:      action,
			TargetType:  sqlite.AuditTargetSnapshot,
			TargetID:    snapshotRef,
			RequestID:   requestID,
			Outcome:     auditOutcome,
			Details:     details,
		})
	})
}

func exactOperationErrorResult(env command.Envelope, started time.Time, err error) command.Result {
	if errors.Is(err, exact.ErrRestorePlanStale) {
		return conflictResult(env, started, err.Error())
	}
	if errors.Is(err, exact.ErrBlocked) {
		return failed(env, started, newReason(ReasonCodeUnavailable, err.Error()))
	}
	return failed(env, started, newReason(ReasonCodeCatalogError, err.Error()))
}

type stringError string

func (err stringError) Error() string { return string(err) }

func errString(message string) error { return stringError(message) }
