import { ArchiveRestore, X } from "lucide-react";
import { useState } from "react";
import type { Translator } from "../i18n";
import { DrawerActionBar } from "./DrawerActionBar";
import { RecoveryRecordsSection } from "./RecoveryRecordsSection";
import { formatBytes } from "../lib/format";
import type { RestoreFlow } from "../app/useRestore";

// The restore drawer.
//
// One column: the destination field, the reviewed plan, and the sticky action
// bar. The card keeps the review evidence; the bar keeps the single next step.

const restoreFormID = "cairn-restore-form";

function restorePointLabel(point: { created_at?: string; display_path?: string }, t: Translator) {
  const createdAt = point.created_at ? new Date(point.created_at) : undefined;
  const time = createdAt && Number.isFinite(createdAt.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(createdAt)
    : t("Restore-point time unknown");
  const source = point.display_path?.trim() || t("Restore-point source unavailable");
  return `${time} · ${source}`;
}

// This card describes the recorded plan only. The sticky action bar owns the
// result of apply; a preview must not imply that destination bytes were written
// or verified.
function RestoreCard({ plan, attemptDestination, t }: { plan: any; attemptDestination?: string; t: Translator }) {
  const filesKnown = typeof plan.files === "number" && Number.isSafeInteger(plan.files) && plan.files >= 0;
  const bytesKnown = typeof plan.bytes === "number" && Number.isSafeInteger(plan.bytes) && plan.bytes >= 0;
  return <div className="plan-card">
    <div className="plan-title">
      <div><p className="eyebrow">{t("REVIEW RESTORE")}</p><h3>{t("Restore plan")}</h3></div>
      <ArchiveRestore size={21} />
    </div>
    <div className="plan-stats">
      <span><b>{filesKnown ? plan.files : "—"}</b>{t(filesKnown ? "files planned" : "Planned file count unavailable")}</span>
      <span><b>{bytesKnown ? formatBytes(plan.bytes) : "—"}</b>{t(bytesKnown ? "planned output size" : "Planned output size unavailable")}</span>
    </div>
    <div className="plan-outcomes"><span>{t("Plan to restore the selected copy's exact bytes")}</span></div>
    {attemptDestination && <p className="muted">{t("Captured restore destination: {{destination}}", { destination: attemptDestination })}</p>}
    <p className="muted">{t("Preview does not write or verify restored output.")}</p>
  </div>;
}

export function RestoreDrawer({ t, restore, recentRestoreDestinations, coreStorageReady, onClose }: {
  t: Translator;
  restore: RestoreFlow;
  recentRestoreDestinations: string[];
  coreStorageReady: boolean;
  onClose: () => void;
}) {
  const { restoreDestination, restorePoints, restorePointsState, restorePointsError, restorePointsSkippedCount, selectedSnapshotRef, canPlanSelectedSnapshot, restorePlan, restoreAttempt, restoreBarState, restoreBarReason, restoreConfirmLabel, restorePreviewDisabled, restoreApplyDisabled, restoreBusy, restoreAttemptActionLabel, restoreAttemptActionBusyLabel, restoreAttemptActionDisabled, advanceRestoreAttempt } = restore;
  const [recoveryRecordsBusy, setRecoveryRecordsBusy] = useState(false);
  const drawerBusy = restoreBusy || recoveryRecordsBusy;
  const restoreAttemptBusy = restoreAttempt?.phase === "APPLYING" || restoreAttempt?.phase === "CHECKING" || restoreAttempt?.phase === "CONTINUING";
  const restoreAttemptLocked = Boolean(restoreAttempt && restoreAttempt.phase !== "RECORDED" && restoreAttempt.phase !== "COMPLETE");
  const [restorePointSearch, setRestorePointSearch] = useState("");
  const [restorePointOrder, setRestorePointOrder] = useState<"newest" | "oldest">("newest");
  const selectedPoint = restorePoints.find((point) => point.snapshot_ref === selectedSnapshotRef);
  const selectedCopyLabel = selectedPoint ? restorePointLabel(selectedPoint, t) : t("Selected restore point unavailable");
  const recoveryUnavailableReason = !coreStorageReady
    ? t("Recovery artifact export is unavailable: {{reason}}", { reason: t("Core storage is unavailable.") })
    : restoreAttemptLocked
      ? t("Finish checking the existing restore attempt before exporting recovery records.")
      : restorePointsState === "ERROR"
        ? t("Refresh the saved-copy list before exporting recovery records.")
        : restorePointsState === "LOADING"
          ? t("Wait for the saved-copy list to finish loading.")
          : restorePointsState !== "READY" || !selectedPoint
        ? t("Choose an available saved copy before exporting recovery records.")
        : restoreBusy
          ? t("Wait for the current restore action to finish.")
          : "";
  const handleClose = () => { if (!recoveryRecordsBusy) onClose(); };
  const searchNeedle = restorePointSearch.trim().toLocaleLowerCase();
  const visibleRestorePoints = restorePoints
    .map((point, index) => {
      const timestamp = typeof point.created_at === "string" ? Date.parse(point.created_at) : Number.NaN;
      const source = point.display_path?.trim() ?? "";
      const shownTime = typeof point.created_at === "string" && Number.isFinite(timestamp)
        ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(timestamp))
        : t("Restore-point time unknown");
      const haystack = `${source} ${point.created_at ?? ""} ${shownTime}`.toLocaleLowerCase();
      return { point, index, timestamp: Number.isFinite(timestamp) ? timestamp : undefined, haystack };
    })
    .filter(({ haystack }) => !searchNeedle || haystack.includes(searchNeedle))
    .sort((left, right) => {
      if (left.timestamp === undefined && right.timestamp !== undefined) return 1;
      if (right.timestamp === undefined && left.timestamp !== undefined) return -1;
      if (left.timestamp === undefined || right.timestamp === undefined) return left.index - right.index;
      const byTime = restorePointOrder === "newest" ? right.timestamp - left.timestamp : left.timestamp - right.timestamp;
      return byTime || left.index - right.index;
    });
  const selectedPointVisible = visibleRestorePoints.some(({ point }) => point.snapshot_ref === selectedSnapshotRef);
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) handleClose(); }}>
    <aside className="drawer restore-drawer" role="dialog" aria-modal="true" aria-label={t("Restore snapshot")}>
      <div className="restore-drawer-scroll">
        <div className="drawer-header"><div><p className="eyebrow">{t("RECOVER")}</p><h2>{t("Restore snapshot")}</h2></div><button className="icon-button" aria-label={t("Close restore")} disabled={recoveryRecordsBusy} onClick={handleClose}><X size={17} /></button></div>
        <p className="drawer-copy">{t("Choose which saved copy to restore. Preview shows the files and output size before confirmation.")}</p>
        <details className="restore-point-picker">
          <summary>{t("Restore point")}: {selectedPoint ? restorePointLabel(selectedPoint, t) : t(canPlanSelectedSnapshot ? "Current restore point" : "Selected restore point unavailable")}</summary>
          <div className="restore-point-picker-panel">
            <p>{t("Saved-copy details show the time and source path when available; unknown information stays unknown.")}</p>
            <button type="button" className="restore-point-refresh" disabled={drawerBusy || restorePointsState === "LOADING"} onClick={() => void restore.refreshRestorePoints()}>{t(restorePointsState === "LOADING" ? "Loading restore points…" : "Refresh restore points")}</button>
            {restorePoints.length > 0 && <div className="restore-point-controls">
              <label>{t("Find in returned restore points")}
                <input type="search" value={restorePointSearch} onChange={(event) => setRestorePointSearch(event.target.value)} placeholder={t("Search source or date")} disabled={drawerBusy} />
              </label>
              <label>{t("Order by recorded time")}
                <select value={restorePointOrder} onChange={(event) => setRestorePointOrder(event.target.value === "oldest" ? "oldest" : "newest")} disabled={drawerBusy}>
                  <option value="newest">{t("Newest first")}</option>
                  <option value="oldest">{t("Oldest first")}</option>
                </select>
              </label>
              <div className="restore-point-filter-status" role="status">
                <span>{t("Showing {{visible}} of {{total}} returned restore points", { visible: visibleRestorePoints.length, total: restorePoints.length })}</span>
                {(restorePointSearch || restorePointOrder !== "newest") && <button type="button" className="text-button" disabled={drawerBusy} onClick={() => { setRestorePointSearch(""); setRestorePointOrder("newest"); }}>{t("Clear filters")}</button>}
              </div>
              {!selectedPointVisible && selectedPoint && <p className="restore-point-selection-hidden" role="status">
                {t("The selected restore point is hidden by this filter; it remains selected.")}
                <button type="button" className="text-button" disabled={drawerBusy} onClick={() => setRestorePointSearch("")}>{t("Show selected restore point")}</button>
              </p>}
            </div>}
            {restorePointsState === "LOADING" && <p role="status">{t("Loading retained restore points…")}</p>}
            {restorePointsState === "READY" && restorePoints.length === 0 && <p role="status">{t("No available restore points were returned.")}</p>}
            {restorePoints.length > 0 && visibleRestorePoints.length === 0 && <p className="restore-point-no-matches" role="status">{t("No returned restore points match this filter. The selected restore point and preview are unchanged.")}</p>}
            {visibleRestorePoints.length > 0 && <ul className="restore-point-list" aria-label={t("Available restore points")}>
            {visibleRestorePoints.map(({ point }) => <li key={point.snapshot_ref}><button type="button" aria-pressed={point.snapshot_ref === selectedSnapshotRef} disabled={drawerBusy || restoreAttemptLocked || restorePointsState !== "READY"} onClick={() => restore.selectRestoreSnapshot(point.snapshot_ref!)}>{restorePointLabel(point, t)}</button></li>)}
            </ul>}
            {restorePointsState === "ERROR" && restorePoints.length > 0 && <p role="status">{t("Showing the last available restore points; choices are disabled until refresh succeeds.")}</p>}
            {restorePointsState === "READY" && restorePointsSkippedCount > 0 && <p role="status">{t("{{count}} entries could not be identified uniquely and were omitted.", { count: restorePointsSkippedCount })}</p>}
            {restorePointsState === "READY" && !canPlanSelectedSnapshot && <p role="status">{t("The selected copy is not among the available restore points. Refresh or choose an available restore point.")}</p>}
          </div>
        </details>
        {restorePointsState === "ERROR" && <><div className="restore-points-error" role="alert"><p>{t("Could not load saved copies.")}</p><button type="button" disabled={drawerBusy} onClick={() => void restore.refreshRestorePoints()}>{t("Retry loading saved copies")}</button></div><details className="restore-point-error-details"><summary>{t("Error details")}</summary><p>{restorePointsError}</p></details></>}
        <form className="stack-form" id={restoreFormID} onSubmit={restore.makeRestorePlan}><label>{t("Destination folder")}<input autoFocus disabled={drawerBusy || restoreAttemptLocked} value={restoreDestination} onChange={(event) => { restore.setDestinationInput(event.target.value); }} placeholder={t("/data/restored-copy")} /></label></form>
        {restorePlan && <RestoreCard plan={restorePlan} attemptDestination={restoreAttempt ? restoreAttempt.destination : undefined} t={t} />}
        <RecoveryRecordsSection
          t={t}
          snapshotRef={selectedSnapshotRef}
          selectedCopyLabel={selectedCopyLabel}
          enabled={coreStorageReady && !restoreBusy && !restoreAttemptLocked && restorePointsState === "READY" && Boolean(selectedPoint)}
          unavailableReason={recoveryUnavailableReason}
          busy={restoreBusy}
          onBusyChange={setRecoveryRecordsBusy}
        />
      </div>
      {recoveryRecordsBusy ? <footer className="recovery-records-inflight" role="status">{t("Keep this restore review open until the export finishes.")}</footer> : <DrawerActionBar
        state={restoreBarState}
        reason={restoreBarReason}
        formID={restoreFormID}
        groupLabel={t("Restore action")}
        previewLabel={t("Preview restore")}
        previewBusyLabel={t("Inspecting...")}
        previewBusy={restoreBusy && restoreBarState === "PREVIEW"}
        previewDisabled={restorePreviewDisabled || recoveryRecordsBusy}
        confirmLabel={restoreConfirmLabel}
        confirmBusyLabel={t("Restoring...")}
        confirmBusy={restoreBusy && restoreBarState === "READY"}
        confirmDisabled={restoreApplyDisabled || recoveryRecordsBusy}
        awaitingActionLabel={restoreAttemptActionLabel}
        awaitingActionBusyLabel={restoreAttemptActionBusyLabel}
        awaitingActionBusy={restoreAttemptBusy}
        awaitingActionDisabled={restoreAttemptActionDisabled || recoveryRecordsBusy}
        onAwaitingAction={() => void restore.advanceRestoreAttempt()}
        doneLabel={t("Close")}
        chipLabel={t("Recent destinations")}
        chips={recentRestoreDestinations.map((destination) => ({ key: `destination:${destination}`, path: destination, label: t("Use recent destination {{path}}", { path: destination }), onClick: () => restore.pickRecentRestoreDestination(destination) }))}
        chipsDisabled={drawerBusy || restoreAttemptLocked || !coreStorageReady}
        onApply={() => void restore.applyRestore()}
        onDone={handleClose}
        onClose={handleClose}
        t={t}
      />}
    </aside>
  </div>;
}
