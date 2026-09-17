import { ArchiveRestore, X } from "lucide-react";
import type { Translator } from "../i18n";
import { DrawerActionBar } from "./DrawerActionBar";
import { formatBytes } from "../lib/format";
import type { RestoreFlow } from "../app/useRestore";

// The restore drawer.
//
// One column: the destination field, the reviewed plan, and the sticky action
// bar. The card keeps the review evidence; the bar keeps the single next step.

const restoreFormID = "restoreweave-restore-form";

// The restore card keeps the review evidence: what will be restored, the item
// and byte counts, and the exact-byte outcome. Its primary action lives in the
// drawer's sticky action bar, exactly like the add-source drawer.
function RestoreCard({ plan, t }: { plan: any; t: Translator }) { return <div className="plan-card"><div className="plan-title"><div><p className="eyebrow">{t("REVIEW RESTORE")}</p><h3>{t(plan.state || "READY")}</h3></div><ArchiveRestore size={21} /></div><div className="plan-stats"><span><b>{plan.files ?? 0}</b>{t("files")}</span><span><b>{formatBytes(plan.bytes ?? 0)}</b>{t("verified output")}</span></div><div className="plan-outcomes"><span>{t("EXACT BYTES")}</span></div>{!plan.executable && <p className="muted">{t("Restore is not executable.")}</p>}</div>; }

export function RestoreDrawer({ t, restore, recentRestoreDestinations, coreStorageReady, onClose }: {
  t: Translator;
  restore: RestoreFlow;
  recentRestoreDestinations: string[];
  coreStorageReady: boolean;
  onClose: () => void;
}) {
  const { restoreDestination, restorePlan, restoreBarState, restoreBarReason, restoreConfirmLabel, restorePreviewDisabled, restoreApplyDisabled, restoreBusy } = restore;
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="drawer restore-drawer" role="dialog" aria-modal="true" aria-label={t("Restore snapshot")}>
      <div className="restore-drawer-scroll">
        <div className="drawer-header"><div><p className="eyebrow">{t("RECOVER")}</p><h2>{t("Restore snapshot")}</h2></div><button className="icon-button" aria-label={t("Close restore")} onClick={onClose}><X size={17} /></button></div>
        <p className="drawer-copy">{t("Choose an empty destination, inspect the plan, then restore and verify exact bytes.")}</p>
        <form className="stack-form" id={restoreFormID} onSubmit={restore.makeRestorePlan}><label>{t("Destination folder")}<input autoFocus value={restoreDestination} onChange={(event) => { restore.setDestinationInput(event.target.value); }} placeholder={t("/data/restored-copy")} /></label></form>
        {restorePlan && <RestoreCard plan={restorePlan} t={t} />}
      </div>
      <DrawerActionBar
        state={restoreBarState}
        reason={restoreBarReason}
        formID={restoreFormID}
        groupLabel={t("Restore action")}
        previewLabel={t("Preview restore")}
        previewBusyLabel={t("Inspecting...")}
        previewBusy={restoreBusy && restoreBarState === "PREVIEW"}
        previewDisabled={restorePreviewDisabled}
        confirmLabel={restoreConfirmLabel}
        confirmBusyLabel={t("Restoring...")}
        confirmBusy={restoreBusy && restoreBarState === "READY"}
        confirmDisabled={restoreApplyDisabled}
        doneLabel={t("Close")}
        chipLabel={t("Recent destinations")}
        chips={recentRestoreDestinations.map((destination) => ({ key: `destination:${destination}`, path: destination, label: t("Use recent destination {{path}}", { path: destination }), onClick: () => restore.pickRecentRestoreDestination(destination) }))}
        chipsDisabled={restoreBusy || !coreStorageReady}
        onApply={() => void restore.applyRestore()}
        onDone={onClose}
        onClose={onClose}
        t={t}
      />
    </aside>
  </div>;
}
