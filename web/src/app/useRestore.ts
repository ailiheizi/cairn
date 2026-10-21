import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import type { ActionBarState, Notice, SnapshotSummary } from "../lib/types";

// The restore drawer.
//
// Restoring is planned, then applied once. A plan whose apply response was lost
// becomes non-executable and reports an unknown outcome instead of authorizing
// a second write.

export type RestoreFlow = {
  restoreDestination: string;
  restorePoints: SnapshotSummary[];
  restorePointsState: "IDLE" | "LOADING" | "READY" | "ERROR";
  restorePointsError: string;
  restorePointsSkippedCount: number;
  selectedSnapshotRef: string;
  canPlanSelectedSnapshot: boolean;
  setRestoreDestination: (value: string) => void;
  setDestinationInput: (value: string) => void;
  selectRestoreSnapshot: (snapshotRef: string) => void;
  refreshRestorePoints: () => Promise<void>;
  restorePlan: any;
  restoreAttempt?: RestoreAttempt;
  restoreBarState: ActionBarState;
  restoreBarReason: string;
  restoreConfirmLabel: string;
  restorePreviewDisabled: boolean;
  restoreApplyDisabled: boolean;
  restoreBusy: boolean;
  restoreAttemptActionLabel: string;
  restoreAttemptActionBusyLabel: string;
  restoreAttemptActionDisabled: boolean;
  advanceRestoreAttempt: () => Promise<void>;
  makeRestorePlan: (event: FormEvent) => void;
  runRestorePlan: (destination: string) => Promise<void>;
  pickRecentRestoreDestination: (destination: string) => void;
  applyRestore: () => Promise<void>;
  openRestore: (trigger?: EventTarget | null) => void;
  closeRestore: () => void;
  resetRestoreProjection: () => void;
};

type RestoreAttemptPhase = "APPLYING" | "UNKNOWN" | "CHECKING" | "RETRYABLE" | "RECONCILE" | "CONTINUING" | "RECORDED" | "COMPLETE";
type RestoreAttempt = {
  token: number;
  workspaceID: string;
  planID: string;
  planDigest: string;
  snapshotRef: string;
  destination: string;
  plan: any;
  planContext: { snapshotRef: string; destination: string };
  phase: RestoreAttemptPhase;
  message: string;
};
type RestoreOutcome = { files?: number; destination: string; degraded: boolean; verification: "VERIFIED" | "RECORDED" };

function restoreAttemptPending(attempt?: RestoreAttempt) {
  return Boolean(attempt && !["RECORDED", "COMPLETE"].includes(attempt.phase));
}

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
  const [restorePoints, setRestorePoints] = useState<SnapshotSummary[]>([]);
  const [restorePointsState, setRestorePointsState] = useState<"IDLE" | "LOADING" | "READY" | "ERROR">("IDLE");
  const [restorePointsError, setRestorePointsError] = useState("");
  const [restorePointsSkippedCount, setRestorePointsSkippedCount] = useState(0);
  const [selectedSnapshotRef, setSelectedSnapshotRef] = useState(snapshotRef);
  const selectedSnapshotRefRef = useRef(snapshotRef);
  const destinationRef = useRef("");
  const restoreOpenRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const snapshotListGenerationRef = useRef(0);
  const planInFlightRef = useRef(false);
  const applyInFlightRef = useRef(false);
  const restoreStatusInFlightRef = useRef(false);
  const planContextRef = useRef<{ snapshotRef: string; destination: string } | undefined>(undefined);
  const [restorePlan, setRestorePlan] = useState<any>();
  const [restoreAttempt, setRestoreAttempt] = useState<RestoreAttempt>();
  const restoreAttemptRef = useRef<RestoreAttempt | undefined>(undefined);
  const restoreAttemptTokenRef = useRef(0);
  // The verified restore result is client state for the sticky bar only: the
  // bytes, the destination, and the verification still come from the daemon.
  const [restoreOutcome, setRestoreOutcome] = useState<RestoreOutcome>();
  // The last local restore-planning failure is shown in the drawer's own bar so
  // the reason sits with the action that produced it.
  const [restorePlanError, setRestorePlanError] = useState("");

  function updateRestoreAttempt(next: RestoreAttempt | undefined) {
    restoreAttemptRef.current = next;
    setRestoreAttempt(next);
  }

  function canPlanSnapshot(snapshot: string) {
    return Boolean(snapshot) && (restorePoints.some((point) => point.snapshot_ref === snapshot) || (restorePointsState !== "READY" && snapshot === snapshotRef));
  }

  async function refreshRestorePoints() {
    if (!restoreOpenRef.current || busy || planInFlightRef.current || applyInFlightRef.current || restoreStatusInFlightRef.current) return;
    const generation = ++snapshotListGenerationRef.current;
    setRestorePointsState("LOADING");
    setRestorePointsError("");
    try {
      const response = await command(operations.snapshot.list, { projection: "identity" });
      if (snapshotListGenerationRef.current !== generation || !restoreOpenRef.current) return;
      const rawList = response.data?.snapshots;
      if (!Array.isArray(rawList) || rawList.some((point) => !point || typeof point !== "object" || Array.isArray(point))) {
        throw new Error(t("The saved-copy list response was unavailable or malformed."));
      }
      const candidates = rawList as SnapshotSummary[];
      const counts = new Map<string, number>();
      for (const point of candidates) {
        const ref = typeof point.snapshot_ref === "string" && point.snapshot_ref.trim() === point.snapshot_ref ? point.snapshot_ref : "";
        if (ref) counts.set(ref, (counts.get(ref) ?? 0) + 1);
      }
      const list = candidates.filter((point) => {
        const ref = typeof point.snapshot_ref === "string" && point.snapshot_ref.trim() === point.snapshot_ref ? point.snapshot_ref : "";
        return Boolean(ref && counts.get(ref) === 1);
      }).map((point) => ({
        ...point,
        created_at: typeof point.created_at === "string" ? point.created_at : undefined,
        display_path: typeof point.display_path === "string" ? point.display_path : undefined,
      }));
      setRestorePoints(list);
      setRestorePointsSkippedCount(candidates.length - list.length);
      setRestorePointsState("READY");
    } catch (error) {
      if (snapshotListGenerationRef.current !== generation || !restoreOpenRef.current) return;
      setRestorePointsError(error instanceof Error ? error.message : t("Could not load saved copies."));
      setRestorePointsState("ERROR");
    }
  }

  function selectRestoreSnapshot(nextSnapshotRef: string) {
    if (restoreAttemptPending(restoreAttemptRef.current) || busy || planInFlightRef.current || applyInFlightRef.current || restorePointsState !== "READY" || !restorePoints.some((point) => point.snapshot_ref === nextSnapshotRef)) return;
    if (selectedSnapshotRefRef.current === nextSnapshotRef) return;
    selectedSnapshotRefRef.current = nextSnapshotRef;
    setSelectedSnapshotRef(nextSnapshotRef);
    if (restoreAttemptRef.current) updateRestoreAttempt(undefined);
    requestGenerationRef.current += 1;
    planContextRef.current = undefined;
    setRestorePlan(undefined);
    setRestoreOutcome(undefined);
    setRestorePlanError("");
  }

  // Preview, Enter in the destination field, and a recent-destination chip all
  // end in the same recorded restore plan: planning is read-only, and only the
  // sticky bar's confirm action writes bytes.
  function makeRestorePlan(event: FormEvent) {
    event.preventDefault();
    void runRestorePlan(restoreDestination);
  }
  async function runRestorePlan(destination: string) {
    const target = destination.trim();
    const requestedSnapshotRef = selectedSnapshotRefRef.current;
    const mayPlanSelected = canPlanSnapshot(requestedSnapshotRef);
    if (restoreAttemptPending(restoreAttemptRef.current) || planInFlightRef.current || applyInFlightRef.current || !requestedSnapshotRef || !target || !mayPlanSelected) return;
    if (!coreStorageReady) { notify({ kind: "error", text: coreStorageMessage }); return; }
    if (restoreAttemptRef.current) updateRestoreAttempt(undefined);
    const generation = ++requestGenerationRef.current;
    planInFlightRef.current = true;
    setBusy(true); notify(undefined); setRestoreOutcome(undefined); setRestorePlanError("");
    try {
      const response = await command(operations.plan.restore, { snapshot_ref: requestedSnapshotRef, destination: target });
      if (requestGenerationRef.current !== generation || !restoreOpenRef.current || selectedSnapshotRefRef.current !== requestedSnapshotRef || destinationRef.current.trim() !== target) return;
      const data = response.data;
      const plannedDestination = typeof data?.destination === "string" && data.destination.trim() ? data.destination : "";
      if (data?.snapshot_ref !== requestedSnapshotRef || typeof data?.workspace_id !== "string" || !data.workspace_id || typeof data?.plan_id !== "string" || !data.plan_id || typeof data?.plan_digest !== "string" || !data.plan_digest || !plannedDestination) {
        throw new Error(t("The restore plan did not match the requested snapshot and destination."));
      }
      setRestorePlan(data);
      planContextRef.current = { snapshotRef: requestedSnapshotRef, destination: plannedDestination };
      destinationRef.current = plannedDestination;
      setRestoreDestination(plannedDestination);
      updateRestoreAttempt(undefined);
      pushRecentDestination(target);
      notify({ kind: "success", text: t("Restore plan is ready to review.") });
    }
    catch (error) {
      if (requestGenerationRef.current !== generation || !restoreOpenRef.current || selectedSnapshotRefRef.current !== requestedSnapshotRef || destinationRef.current.trim() !== target) return;
      // The bar carries the reason the plan could not be recorded, so the
      // operator does not have to look behind the drawer for it.
      setRestorePlanError(error instanceof Error ? error.message : t("Could not create restore plan"));
      notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not create restore plan") });
    }
    finally { planInFlightRef.current = false; setBusy(false); }
  }
  // A chip fills the destination field and plans that destination immediately,
  // exactly like picking a suggested source path. The plan it discards is only a
  // review of a destination the operator just replaced.
  function pickRecentRestoreDestination(destination: string) {
    if (restoreAttemptPending(restoreAttemptRef.current) || restoreBusy || !coreStorageReady) return;
    setDestinationInput(destination);
    void runRestorePlan(destination);
  }
  async function applyRestore() {
    if (restoreAttemptPending(restoreAttemptRef.current) || planInFlightRef.current || applyInFlightRef.current || restorePlan?.executable !== true || restorePlan?.awaiting_confirmation === true || !restorePlan?.plan_id || !restorePlan?.plan_digest || !restorePlan?.workspace_id) return;
    const requestedSnapshotRef = selectedSnapshotRefRef.current;
    const requestedDestination = destinationRef.current.trim();
    const planContext = planContextRef.current;
    if (!planContext || planContext.snapshotRef !== requestedSnapshotRef || planContext.destination !== requestedDestination) return;
    if (!coreStorageReady) { notify({ kind: "error", text: coreStorageMessage }); return; }
    const planAtStart = restorePlan;
    const lockedPlan = { ...planAtStart, executable: false, awaiting_confirmation: true };
    const attempt: RestoreAttempt = {
      token: ++restoreAttemptTokenRef.current,
      workspaceID: planAtStart.workspace_id,
      planID: planAtStart.plan_id,
      planDigest: planAtStart.plan_digest,
      snapshotRef: requestedSnapshotRef,
      destination: requestedDestination,
      plan: lockedPlan,
      planContext,
      phase: "APPLYING",
      message: t("Applying the reviewed restore plan to its original destination."),
    };
    updateRestoreAttempt(attempt);
    setRestorePlan(lockedPlan);
    applyInFlightRef.current = true;
    setBusy(true);
    try {
      const response = await command(operations.plan.apply, { workspace_id: planAtStart.workspace_id, plan_id: planAtStart.plan_id, plan_digest: planAtStart.plan_digest });
      if (restoreAttemptRef.current?.token !== attempt.token) return;
      if (response.data?.plan_id !== attempt.planID || response.data?.plan_digest !== attempt.planDigest
        || (response.data?.snapshot_ref !== undefined && response.data.snapshot_ref !== attempt.snapshotRef)
        || (response.data?.destination !== undefined && response.data.destination !== attempt.destination)
        || (response.data?.state !== undefined && response.data.state !== "SUCCEEDED")) {
        throw new Error(t("Restore response did not match the captured attempt. It remains unresolved."));
      }
      const files = response.data?.files ?? planAtStart.files;
      const destination = response.data?.destination ?? requestedDestination;
      const degraded = response.status === "DEGRADED";
      const alreadyApplied = response.data?.already_applied === true;
      const completedPlan = { ...planAtStart, ...response.data, executable: false, awaiting_confirmation: false, state: response.data?.state ?? "SUCCEEDED" };
      updateRestoreAttempt({ ...attempt, plan: completedPlan, phase: alreadyApplied ? "RECORDED" : "COMPLETE", message: alreadyApplied
        ? t("The same restore plan is recorded as applied. This status does not verify the destination's current bytes.")
        : t("The same restore plan completed at its original destination.") });
      // Keep the outcome attached to this attempt even if the drawer was closed
      // while the command was running. A completed plan cannot be applied again.
      setRestorePlan(completedPlan);
      setRestoreOutcome({ files: Number.isSafeInteger(files) && files >= 0 ? files : undefined, destination: String(destination ?? requestedDestination), degraded, verification: alreadyApplied ? "RECORDED" : "VERIFIED" });
      const reasonMessages = [
        ...(response.reasons ?? []).map((item) => item.message),
        ...(Array.isArray(response.data?.warnings) ? response.data.warnings : []),
        ...(Array.isArray(response.data?.reasons) ? response.data.reasons.map((item: unknown) => typeof item === "string" ? item : (item as { message?: string })?.message) : []),
      ].filter((message): message is string => typeof message === "string" && Boolean(message.trim()));
      const details = reasonMessages.length > 0 ? ` ${reasonMessages.join(" ")}` : "";
      if (alreadyApplied) {
        notify({ kind: degraded ? "warning" : "success", text: `${t("The restore plan is recorded as applied at {{destination}}. Current output bytes have not been verified by this status.", { destination })}${details}` });
      } else if (degraded) {
        notify({ kind: "warning", text: `${t("Restored {{files}} file(s) to {{destination}}, but some fidelity or metadata checks were unavailable.", { files, destination })}${details}` });
      } else {
        notify({ kind: "success", text: `${t("Restored and verified {{files}} file(s) to {{destination}}.", { files, destination })}${details}` });
      }
    }
    catch (error) {
      if (restoreAttemptRef.current?.token !== attempt.token) return;
      // A failed or lost apply response never authorizes a second write: the
      // same captured attempt remains available after the drawer closes.
      updateRestoreAttempt({ ...attempt, plan: lockedPlan, phase: "UNKNOWN", message: error instanceof Error ? error.message : t("Restore outcome is unknown. Check this same plan before continuing.") });
      setRestorePlan(lockedPlan);
      if (restoreOpenRef.current) notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not restore snapshot") });
    }
    finally { applyInFlightRef.current = false; setBusy(false); }
  }

  async function advanceRestoreAttempt() {
    const captured = restoreAttemptRef.current;
    if (!captured || busy || planInFlightRef.current || applyInFlightRef.current || restoreStatusInFlightRef.current) return;
    if (!isConnected || !coreStorageReady) {
      updateRestoreAttempt({ ...captured, message: !isConnected ? t("Cairn service is unavailable") : coreStorageMessage });
      return;
    }
    if (captured.phase === "UNKNOWN") {
      const checking = { ...captured, phase: "CHECKING" as const, message: t("Checking the status of the same restore plan.") };
      updateRestoreAttempt(checking);
      setRestorePlanError("");
      setBusy(true);
      restoreStatusInFlightRef.current = true;
      try {
        const response = await command(operations.plan.get, { workspace_id: captured.workspaceID, plan_id: captured.planID });
        if (restoreAttemptRef.current?.token !== captured.token) return;
        const data = response.data;
        if (!data || data.plan_id !== captured.planID || data.workspace_id !== captured.workspaceID || data.plan_digest !== captured.planDigest || data.kind !== "RESTORE" || data.abandoned === true || typeof data.applied !== "boolean" || typeof data.executable !== "boolean" || data.applied && data.executable) {
          throw new Error(t("Restore status did not match the captured attempt. It remains unresolved."));
        }
        if (data.applied === true) {
          const recordedPlan = { ...captured.plan, ...data, executable: false, awaiting_confirmation: false, state: "SUCCEEDED" };
          updateRestoreAttempt({ ...checking, plan: recordedPlan, phase: "RECORDED", message: t("The same restore plan is recorded as applied. This status does not verify the destination's current bytes.") });
          setRestorePlan(recordedPlan);
          setRestoreOutcome({ destination: captured.destination, degraded: false, verification: "RECORDED" });
        } else if (data.executable === true) {
          const retryablePlan = { ...captured.plan, ...data, executable: false, awaiting_confirmation: true };
          updateRestoreAttempt({ ...checking, plan: retryablePlan, phase: "RETRYABLE", message: t("No execution is recorded for this plan. Continuing the same plan may write to its original destination.") });
          setRestorePlan(retryablePlan);
        } else {
          const reconcilePlan = { ...captured.plan, ...data, executable: false, awaiting_confirmation: true };
          updateRestoreAttempt({ ...checking, plan: reconcilePlan, phase: "RECONCILE", message: t("An execution exists or is unresolved. Continue only through this same restore plan.") });
          setRestorePlan(reconcilePlan);
        }
        setRestorePlanError("");
      } catch (error) {
        if (restoreAttemptRef.current?.token !== captured.token) return;
        updateRestoreAttempt({ ...captured, phase: "UNKNOWN", message: error instanceof Error ? error.message : t("Restore status is unavailable. The original attempt remains unresolved.") });
        setRestorePlanError(error instanceof Error ? error.message : t("Restore status is unavailable. The original attempt remains unresolved."));
      } finally { restoreStatusInFlightRef.current = false; setBusy(false); }
      return;
    }
    if (captured.phase !== "RETRYABLE" && captured.phase !== "RECONCILE") return;
    const continuing = { ...captured, phase: "CONTINUING" as const, message: captured.phase === "RETRYABLE"
      ? t("Retrying the same plan may write to its original destination.")
      : t("Reconciling the existing execution through the same plan.") };
    updateRestoreAttempt(continuing);
    applyInFlightRef.current = true;
    setBusy(true);
    try {
      const response = await command(operations.plan.apply, { workspace_id: captured.workspaceID, plan_id: captured.planID, plan_digest: captured.planDigest });
      if (restoreAttemptRef.current?.token !== captured.token) return;
      if (response.data?.plan_id !== captured.planID || response.data?.plan_digest !== captured.planDigest
        || (response.data?.snapshot_ref !== undefined && response.data.snapshot_ref !== captured.snapshotRef)
        || (response.data?.destination !== undefined && response.data.destination !== captured.destination)
        || (response.data?.state !== undefined && response.data.state !== "SUCCEEDED")) {
        throw new Error(t("Restore response did not match the captured attempt. It remains unresolved."));
      }
      const alreadyApplied = response.data?.already_applied === true;
      const destination = typeof response.data?.destination === "string" ? response.data.destination : captured.destination;
      const files = response.data?.files;
      const degraded = response.status === "DEGRADED";
      const message = alreadyApplied
        ? t("The same restore plan is recorded as applied. This status does not verify the destination's current bytes.")
        : t("The same restore plan completed at its original destination.");
      const completedPlan = { ...captured.plan, ...response.data, executable: false, awaiting_confirmation: false, state: response.data?.state ?? "SUCCEEDED" };
      updateRestoreAttempt({ ...continuing, plan: completedPlan, phase: alreadyApplied ? "RECORDED" : "COMPLETE", message });
      setRestorePlan(completedPlan);
      setRestoreOutcome({ files: Number.isSafeInteger(files) && files >= 0 ? files : undefined, destination, degraded, verification: alreadyApplied ? "RECORDED" : "VERIFIED" });
      const reasonMessages = [
        ...(response.reasons ?? []).map((item) => item.message),
        ...(Array.isArray(response.data?.warnings) ? response.data.warnings : []),
        ...(Array.isArray(response.data?.reasons) ? response.data.reasons.map((item: unknown) => typeof item === "string" ? item : (item as { message?: string })?.message) : []),
      ].filter((message): message is string => typeof message === "string" && Boolean(message.trim()));
      if (reasonMessages.length > 0) setRestorePlanError(reasonMessages.join(" "));
    } catch (error) {
      if (restoreAttemptRef.current?.token !== captured.token) return;
      const lockedPlan = { ...captured.plan, executable: false, awaiting_confirmation: true };
      updateRestoreAttempt({ ...captured, plan: lockedPlan, phase: "UNKNOWN", message: error instanceof Error ? error.message : t("Restore outcome is unknown. Check this same plan before continuing.") });
      setRestorePlan(lockedPlan);
      setRestorePlanError(error instanceof Error ? error.message : t("Restore outcome is unknown. Check this same plan before continuing."));
    } finally { applyInFlightRef.current = false; setBusy(false); }
  }
  // Editing the destination invalidates the reviewed plan: the plan describes
  // one exact destination, so it is dropped rather than saved later.
  function setDestinationInput(value: string) {
    if (restoreAttemptPending(restoreAttemptRef.current)) return;
    if (restoreAttemptRef.current) updateRestoreAttempt(undefined);
    destinationRef.current = value;
    requestGenerationRef.current += 1;
    planContextRef.current = undefined;
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
    requestGenerationRef.current += 1;
    snapshotListGenerationRef.current += 1;
    restoreOpenRef.current = true;
    const retainedAttempt = restoreAttemptRef.current;
    if (retainedAttempt) {
      planContextRef.current = retainedAttempt.planContext;
      selectedSnapshotRefRef.current = retainedAttempt.snapshotRef;
      setSelectedSnapshotRef(retainedAttempt.snapshotRef);
      destinationRef.current = retainedAttempt.destination;
      setRestoreDestination(retainedAttempt.destination);
      setRestorePlan(retainedAttempt.plan);
      if (restoreAttemptPending(retainedAttempt)) setRestoreOutcome(undefined);
    } else {
      planContextRef.current = undefined;
      selectedSnapshotRefRef.current = snapshotRef;
      setSelectedSnapshotRef(snapshotRef);
      destinationRef.current = "";
      setRestorePlan(undefined); setRestoreOutcome(undefined); setRestorePlanError(""); setRestoreDestination("");
    }
    setRestorePointsState("IDLE"); setRestorePointsError("");
    setRestoreOpen(true); notify(undefined);
    void refreshRestorePoints();
  }
  function closeRestore() {
    restoreOpenRef.current = false;
    requestGenerationRef.current += 1;
    snapshotListGenerationRef.current += 1;
    if (!restoreAttemptPending(restoreAttemptRef.current)) updateRestoreAttempt(undefined);
    setRestoreOpen(false);
  }
  function resetRestoreProjection() {
    requestGenerationRef.current += 1;
    if (restoreAttemptPending(restoreAttemptRef.current)) {
      const attempt = restoreAttemptRef.current!;
      planContextRef.current = attempt.planContext;
      selectedSnapshotRefRef.current = attempt.snapshotRef;
      destinationRef.current = attempt.destination;
      setSelectedSnapshotRef(attempt.snapshotRef);
      setRestoreDestination(attempt.destination);
      setRestorePlan({ ...attempt.plan, executable: false, awaiting_confirmation: true });
      setRestoreOutcome(undefined);
      setRestorePoints([]);
      setRestorePointsState("IDLE");
      setRestorePointsError("");
      return;
    }
    planContextRef.current = undefined;
    destinationRef.current = "";
    selectedSnapshotRefRef.current = snapshotRef;
    setSelectedSnapshotRef(snapshotRef);
    setRestoreDestination("");
    setRestorePlan(undefined); setRestoreOutcome(undefined); setRestorePlanError("");
    updateRestoreAttempt(undefined);
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
    ? restoreOutcome.verification === "RECORDED"
      ? t("The restore plan is recorded as applied at {{destination}}. Current output bytes have not been verified by this status.", { destination: restoreOutcome.destination })
      : restoreOutcome.degraded
        ? restoreOutcome.files === undefined
          ? t("Restore finished at {{destination}}, but some fidelity or metadata checks were unavailable.", { destination: restoreOutcome.destination })
          : t("Restore finished, but some fidelity or metadata checks were unavailable. {{files}} file(s) are in {{destination}}.", { files: restoreOutcome.files, destination: restoreOutcome.destination })
        : restoreOutcome.files === undefined
          ? t("Restore verified at {{destination}}.", { destination: restoreOutcome.destination })
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
    ? restoreAttempt?.message || t("Restore outcome is unknown. Check this same plan before continuing.")
    : restoreBarState === "BLOCKED"
      ? (restorePlanReason || t("Restore is not executable."))
      : restoreBarState === "DONE"
        ? restoreOutcomeText
        : restorePlanError || (isUnavailable ? t("Cairn service is unavailable") : !coreStorageReady ? coreStorageMessage : "");
  const restoreBusy = busy;
  const restoreAttemptActionLabel = restoreAttempt?.phase === "RETRYABLE"
    ? t("Retry same restore (may write)")
    : restoreAttempt?.phase === "RECONCILE"
      ? t("Continue same restore plan")
      : t("Check this restore attempt");
  const restoreAttemptActionBusyLabel = restoreAttempt?.phase === "CHECKING"
    ? t("Checking restore status…")
    : restoreAttempt?.phase === "APPLYING"
      ? t("Restoring to the captured destination…")
      : t("Continuing restore attempt…");
  const restoreAttemptActionDisabled = !restoreAttempt || restoreBusy || !isConnected || !coreStorageReady;
  const canPlanSelectedSnapshot = canPlanSnapshot(selectedSnapshotRef);
  const restorePlanMatchesSelection = Boolean(restorePlan?.plan_id && planContextRef.current?.snapshotRef === selectedSnapshotRef && planContextRef.current?.destination === restoreDestination.trim());
  const restorePreviewDisabled = restoreBusy || restoreAttemptPending(restoreAttempt) || restorePointsState === "LOADING" || !coreStorageReady || !restoreDestination.trim() || !canPlanSelectedSnapshot;
  const restoreApplyDisabled = restoreBusy || !coreStorageReady || !canPlanSelectedSnapshot || !restorePlanMatchesSelection || restorePlan?.executable !== true || restorePlan?.awaiting_confirmation === true;

  return {
    restoreDestination,
    restorePoints,
    restorePointsState,
    restorePointsError,
    restorePointsSkippedCount,
    selectedSnapshotRef,
    canPlanSelectedSnapshot,
    setRestoreDestination: setDestinationInput,
    setDestinationInput,
    selectRestoreSnapshot,
    refreshRestorePoints,
    restorePlan,
    restoreAttempt,
    restoreBarState,
    restoreBarReason,
    restoreConfirmLabel,
    restorePreviewDisabled,
    restoreApplyDisabled,
    restoreBusy,
    restoreAttemptActionLabel,
    restoreAttemptActionBusyLabel,
    restoreAttemptActionDisabled,
    advanceRestoreAttempt,
    makeRestorePlan,
    runRestorePlan,
    pickRecentRestoreDestination,
    applyRestore,
    openRestore,
    closeRestore,
    resetRestoreProjection,
  };
}
