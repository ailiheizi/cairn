import { useState } from "react";
import type { FormEvent } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import type { ActionBarState, Notice } from "../lib/types";

// The restore drawer.
//
// Restoring is planned, then applied once. A plan whose apply response was lost
// becomes non-executable and reports an unknown outcome instead of authorizing
// a second write.

export type RestoreFlow = {
  restoreDestination: string;
  setRestoreDestination: (value: string) => void;
  setDestinationInput: (value: string) => void;
  restorePlan: any;
  restoreBarState: ActionBarState;
  restoreBarReason: string;
  restoreConfirmLabel: string;
  restorePreviewDisabled: boolean;
  restoreApplyDisabled: boolean;
  restoreBusy: boolean;
  makeRestorePlan: (event: FormEvent) => void;
  runRestorePlan: (destination: string) => Promise<void>;
  pickRecentRestoreDestination: (destination: string) => void;
  applyRestore: () => Promise<void>;
  openRestore: (trigger?: EventTarget | null) => void;
  closeRestore: () => void;
  resetRestoreProjection: () => void;
};

export function useRestore({ t, snapshotRef, isConnected, coreStorageReady, coreStorageMessage, isUnavailable, busy, setBusy, notify, pushRecentDestination, canLeaveSettings, rememberDrawerTrigger, closeDrawers, setRestoreOpen }: {
  t: Translator;
  snapshotRef: string;
  isConnected: boolean;
  coreStorageReady: boolean;
  coreStorageMessage: string;
  isUnavailable: boolean;
  busy: boolean;
  setBusy: (value: boolean) => void;
  notify: (notice: Notice | undefined) => void;
  pushRecentDestination: (destination: string) => void;
  canLeaveSettings: () => boolean;
  rememberDrawerTrigger: (trigger?: EventTarget | null) => void;
  closeDrawers: () => void;
  setRestoreOpen: (value: boolean) => void;
}): RestoreFlow {
  const [restoreDestination, setRestoreDestination] = useState("");
  const [restorePlan, setRestorePlan] = useState<any>();
  // The verified restore result is client state for the sticky bar only: the
  // bytes, the destination, and the verification still come from the daemon.
  const [restoreOutcome, setRestoreOutcome] = useState<{ files: number; destination: string; degraded: boolean }>();
  // The last local restore-planning failure is shown in the drawer's own bar so
  // the reason sits with the action that produced it.
  const [restorePlanError, setRestorePlanError] = useState("");

  // Preview, Enter in the destination field, and a recent-destination chip all
  // end in the same recorded restore plan: planning is read-only, and only the
  // sticky bar's confirm action writes bytes.
  function makeRestorePlan(event: FormEvent) {
    event.preventDefault();
    void runRestorePlan(restoreDestination);
  }
  async function runRestorePlan(destination: string) {
    const target = destination.trim();
    if (!snapshotRef || !target) return;
    if (!coreStorageReady) { notify({ kind: "error", text: coreStorageMessage }); return; }
    setBusy(true); notify(undefined); setRestoreOutcome(undefined); setRestorePlanError("");
    try {
      const response = await command(operations.plan.restore, { snapshot_ref: snapshotRef, destination: target });
      setRestorePlan(response.data);
      pushRecentDestination(target);
      notify({ kind: "success", text: t("Restore plan is ready to review.") });
    }
    catch (error) {
      // The bar carries the reason the plan could not be recorded, so the
      // operator does not have to look behind the drawer for it.
      setRestorePlanError(error instanceof Error ? error.message : t("Could not create restore plan"));
      notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not create restore plan") });
    }
    finally { setBusy(false); }
  }
  // A chip fills the destination field and plans that destination immediately,
  // exactly like picking a suggested source path. The plan it discards is only a
  // review of a destination the operator just replaced.
  function pickRecentRestoreDestination(destination: string) {
    if (restoreBusy || !coreStorageReady) return;
    setRestoreDestination(destination);
    setRestorePlan(undefined);
    setRestoreOutcome(undefined);
    void runRestorePlan(destination);
  }
  async function applyRestore() {
    if (!restorePlan?.plan_id || !restorePlan?.plan_digest || !restorePlan?.workspace_id) return;
    if (!coreStorageReady) { notify({ kind: "error", text: coreStorageMessage }); return; }
    setBusy(true);
    try {
      const response = await command(operations.plan.apply, { workspace_id: restorePlan.workspace_id, plan_id: restorePlan.plan_id, plan_digest: restorePlan.plan_digest });
      const files = response.data?.files ?? restorePlan.files;
      const destination = response.data?.destination ?? restoreDestination;
      const degraded = response.status === "DEGRADED";
      // The drawer stays open so the sticky bar can report the verified result
      // in place. The plan itself is no longer executable: the bar offers the
      // close action instead of a second apply.
      setRestorePlan({ ...restorePlan, ...response.data, executable: false, awaiting_confirmation: false, state: response.data?.state ?? "SUCCEEDED" });
      setRestoreOutcome({ files: Number(files ?? 0), destination: String(destination ?? ""), degraded });
      const reasonMessages = [
        ...(response.reasons ?? []).map((item) => item.message),
        ...(Array.isArray(response.data?.warnings) ? response.data.warnings : []),
        ...(Array.isArray(response.data?.reasons) ? response.data.reasons.map((item: unknown) => typeof item === "string" ? item : (item as { message?: string })?.message) : []),
      ].filter((message): message is string => typeof message === "string" && Boolean(message.trim()));
      const details = reasonMessages.length > 0 ? ` ${reasonMessages.join(" ")}` : "";
      if (degraded) {
        notify({ kind: "warning", text: `${t("Restored {{files}} file(s) to {{destination}}, but some fidelity or metadata checks were unavailable.", { files, destination })}${details}` });
      } else {
        notify({ kind: "success", text: `${t("Restored and verified {{files}} file(s) to {{destination}}.", { files, destination })}${details}` });
      }
    }
    catch (error) {
      // A failed or lost apply response never authorizes a second write: the
      // plan becomes non-executable and the bar says the outcome is unknown.
      setRestorePlan((current: any) => current ? { ...current, executable: false, awaiting_confirmation: true } : current);
      notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not restore snapshot") });
    }
    finally { setBusy(false); }
  }
  // Editing the destination invalidates the reviewed plan: the plan describes
  // one exact destination, so it is dropped rather than saved later.
  function setDestinationInput(value: string) {
    setRestoreDestination(value);
    setRestorePlan(undefined);
    setRestoreOutcome(undefined);
    setRestorePlanError("");
  }
  function openRestore(trigger?: EventTarget | null) {
    if (!isConnected || !coreStorageReady) { notify({ kind: "error", text: coreStorageMessage }); return; }
    if (!canLeaveSettings()) return;
    rememberDrawerTrigger(trigger);
    closeDrawers();
    setRestorePlan(undefined); setRestoreOutcome(undefined); setRestorePlanError(""); setRestoreDestination("");
    setRestoreOpen(true); notify(undefined);
  }
  function closeRestore() { setRestoreOpen(false); }
  function resetRestoreProjection() {
    setRestorePlan(undefined); setRestoreOutcome(undefined); setRestorePlanError("");
  }

  // The restore drawer's sticky action bar follows the same rule: one action per
  // state, always in the same place, and no second apply once a restore has run
  // or its outcome is unknown. The review evidence stays in the card above it.
  const restorePlanDone = Boolean(restoreOutcome) || restorePlan?.state === "SUCCEEDED";
  const restorePlanAwaiting = Boolean(restorePlan?.awaiting_confirmation) && !restorePlanDone;
  const restoreBarState: ActionBarState = !restorePlan
    ? "PREVIEW"
    : restorePlanDone
      ? "DONE"
      : restorePlanAwaiting
        ? "AWAITING"
        : !restorePlan.executable ? "BLOCKED" : "READY";
  const restoreFileCount = Number(restorePlan?.files ?? 0);
  const restoreConfirmLabel = restoreFileCount > 0
    ? `${t("Confirm restore")} · ${t("{{count}} files", { count: restoreFileCount })}`
    : t("Confirm restore");
  const restoreOutcomeText = restoreOutcome
    ? restoreOutcome.degraded
      ? t("Restore finished, but some fidelity or metadata checks were unavailable. {{files}} file(s) are in {{destination}}.", { files: restoreOutcome.files, destination: restoreOutcome.destination })
      : t("Restore verified: {{files}} file(s) are in {{destination}}.", { files: restoreOutcome.files, destination: restoreOutcome.destination })
    : "";
  // A blocked restore plan states its own reason when the daemon reported one;
  // otherwise the bar says plainly that the plan cannot run.
  const restorePlanReason = [
    typeof restorePlan?.message === "string" ? restorePlan.message : "",
    ...(Array.isArray(restorePlan?.reasons) ? restorePlan.reasons.map((reason: unknown) => typeof reason === "string" ? reason : (reason as { message?: string })?.message ?? "") : []),
    ...(Array.isArray(restorePlan?.warnings) ? restorePlan.warnings.map((warning: unknown) => typeof warning === "string" ? warning : "") : []),
  ].filter((message: string) => Boolean(message?.trim())).join(" ");
  const restoreBarReason = restorePlanAwaiting
    ? t("Restore outcome is unknown. Check the destination before restoring again.")
    : restoreBarState === "BLOCKED"
      ? (restorePlanReason || t("Restore is not executable."))
      : restoreBarState === "DONE"
        ? restoreOutcomeText
        : restorePlanError || (isUnavailable ? t("Cairn service is unavailable") : !coreStorageReady ? coreStorageMessage : "");
  const restoreBusy = busy;
  const restorePreviewDisabled = restoreBusy || !coreStorageReady || !restoreDestination.trim();
  const restoreApplyDisabled = restoreBusy || !coreStorageReady;

  return {
    restoreDestination,
    setRestoreDestination,
    setDestinationInput,
    restorePlan,
    restoreBarState,
    restoreBarReason,
    restoreConfirmLabel,
    restorePreviewDisabled,
    restoreApplyDisabled,
    restoreBusy,
    makeRestorePlan,
    runRestorePlan,
    pickRecentRestoreDestination,
    applyRestore,
    openRestore,
    closeRestore,
    resetRestoreProjection,
  };
}
