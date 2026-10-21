import { Check, Folder, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import type { Translator } from "../i18n";
import type { ActionBarState } from "../lib/types";

// The sticky action bar of a drawer.
//
// It is the drawer's next step, always in the same place at the bottom of the
// drawer. The add-source and restore drawers render the same component so both
// keep one action per state, never offer a write that cannot run, and never
// hide the review evidence above them. Labels arrive already translated
// because the confirm label carries its own file count.

export type DrawerActionBarChip = { key: string; path: string; label: string; onClick: () => void };

export function DrawerActionBar({ state, reason, groupLabel, previewLabel, previewBusyLabel, previewBusy, previewDisabled, confirmLabel, confirmBusyLabel, confirmBusy, confirmDisabled, awaitingActionLabel, awaitingActionBusyLabel, awaitingActionBusy, awaitingActionDisabled, onAwaitingAction, doneLabel, formID, chipLabel, chips, chipsDisabled, t, onApply, onDone, onClose }: { state: ActionBarState; reason: string; groupLabel: string; previewLabel: string; previewBusyLabel: string; previewBusy: boolean; previewDisabled: boolean; confirmLabel: string; confirmBusyLabel: string; confirmBusy: boolean; confirmDisabled: boolean; awaitingActionLabel?: string; awaitingActionBusyLabel?: string; awaitingActionBusy?: boolean; awaitingActionDisabled?: boolean; onAwaitingAction?: () => void; doneLabel: string; formID: string; chipLabel?: string; chips?: DrawerActionBarChip[]; chipsDisabled?: boolean; t: Translator; onApply: () => void; onDone: () => void; onClose: () => void }) {
  // Zero-new-bytes and saved plans offer the library instead of a save that
  // would add nothing; a blocked, unknown, or finished plan offers no save at
  // all. A recently used destination stays reachable while planning is still
  // the bar's next step, and disappears once bytes may already exist.
  const terminal = state === "UP_TO_DATE" || state === "SAVED";
  const showChips = Boolean(chips?.length) && (state === "PREVIEW" || state === "READY" || state === "BLOCKED");
  return <footer className="drawer-action-bar" data-state={state} role="group" aria-label={groupLabel}>
    {showChips && <div className="source-suggestions action-bar-chips" role="group" aria-label={chipLabel}><span className="source-suggestions-label">{chipLabel}</span><div className="source-suggestions-list">{chips?.map((chip) => <button type="button" key={chip.key} className="source-suggestion" data-kind="recent" title={chip.path} aria-label={chip.label} disabled={chipsDisabled} onClick={chip.onClick}><RefreshCw size={12} /><span>{chip.path}</span></button>)}</div></div>}
    {reason && <p className="source-action-reason" role="status">{reason}</p>}
    <div className="source-action-controls">
      {state === "PREVIEW" && <button type="submit" form={formID} className="primary-button source-action-primary" disabled={previewDisabled}>{previewBusy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}{previewBusy ? previewBusyLabel : previewLabel}</button>}
      {state === "READY" && <button type="button" className="primary-button source-action-primary" disabled={confirmDisabled} onClick={onApply}>{confirmBusy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}{confirmLabel}</button>}
      {state === "BLOCKED" && <button type="button" className="primary-button source-action-primary" disabled>{confirmLabel}</button>}
      {state === "AWAITING" && onAwaitingAction && <button type="button" className="primary-button source-action-primary" disabled={awaitingActionDisabled || awaitingActionBusy} onClick={onAwaitingAction}>{awaitingActionBusy && <LoaderCircle className="spin" size={15} />}{awaitingActionBusy ? awaitingActionBusyLabel : awaitingActionLabel}</button>}
      {terminal && <button type="button" className="primary-button source-action-primary" onClick={onDone}><Folder size={15} />{doneLabel}</button>}
      {state === "DONE" && <button type="button" className="primary-button source-action-primary" onClick={onDone}><Check size={15} />{doneLabel}</button>}
      {(terminal || state === "AWAITING") && <button type="button" className="secondary-button" onClick={onClose}>{t("Close")}</button>}
    </div>
  </footer>;
}
