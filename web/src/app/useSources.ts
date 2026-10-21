import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import { formatBytes, looksLikeRemoteLocator } from "../lib/format";
import type { LibraryFlow } from "./useLibrary";
import type { ActionBarState, Notice, PathSuggestion, PlanActionState, SourceChangeSummary, SourceProjection, SourceStaging, SourceSummary, SnapshotDiffItem, SnapshotSummary, UploadFileRow } from "../lib/types";

// The configured sources surface and the add/recheck drawer.
//
// Planning is read-only and reviewable: `plan.ingest` records a plan, and only
// `plan.apply` on the exact plan digest writes bytes. A plan whose outcome is
// unknown is never made executable again by this flow.
//
// The change summary between a source's two newest restore points is the
// daemon's own comparison: the restore points come from `snapshot.list` (read
// by the shell on the same refresh) and the counts come from `snapshot.diff`.
// The browser never derives a change, and a comparison the daemon did not
// answer stays unavailable with the daemon's reason instead of reading as
// "nothing changed".

export type SourcesFlow = {
  sources: SourceSummary[];
  setSources: (value: SourceSummary[]) => void;
  staging: SourceStaging | undefined;
  stagingBusy: boolean;
  sourceProjection: SourceProjection;
  setSourceProjection: (value: SourceProjection) => void;
  sourceChanges: Record<string, SourceChangeSummary>;
  source: string;
  setSource: (value: string) => void;
  pastedTextDraft: PastedTextDraft;
  openTextComposerRequested: boolean;
  editPastedTextDraft: (filename: string, text: string) => void;
  beginPastedTextUpload: () => number;
  recordPastedTextUpload: (outcome: { attemptID: number; stagingDir: string; rows: UploadFileRow[]; error: string; partial: boolean }) => void;
  clearPastedTextDraft: () => void;
  changeSourceInput: (value: string) => void;
  continueAfterSavedUpload: (planID: string, stagingDir: string) => boolean;
  recheckSourceRef: string;
  setRecheckSourceRef: (value: string) => void;
  plan: any;
  planAction: PlanActionState;
  planCheckBusy: boolean;
  sourceLooksRemote: boolean;
  pathSuggestions: PathSuggestion[];
  sourceBarState: ActionBarState;
  sourceBarReason: string;
  sourceSaveLabel: string;
  sourcePreviewDisabled: boolean;
  sourcePlanBusy: boolean;
  sourceSaveDisabled: boolean;
  sourceSuggestionDisabled: boolean;
  loadSources: (activeWorkspaceID: string, refreshGeneration?: number, restorePoints?: SnapshotSummary[]) => Promise<void>;
  makePlan: (event?: FormEvent) => void;
  runIngestPlan: (rootPath: string, associatePastedText?: boolean) => Promise<any>;
  pickSuggestedPath: (suggestion: PathSuggestion) => void;
  checkPlanStatus: () => Promise<void>;
  applyPlan: () => Promise<void>;
  viewSource: (sourceItem: SourceSummary) => Promise<void>;
  openAdd: (sourceItem?: SourceSummary, trigger?: EventTarget | null, options?: { openTextComposer?: boolean; beforeOpen?: () => boolean }) => void;
  closeAdd: () => void;
  ingestStaged: () => void;
  cleanStaged: () => Promise<void>;
  resetSourceProjection: () => void;
};

export type PastedTextDraft = {
  filename: string;
  text: string;
  locked: boolean;
  stagingDir: string;
  rows: UploadFileRow[];
  error: string;
  partial: boolean;
  planID: string;
  attemptID: number;
  receiving: boolean;
};

export function useSources({ t, workspaceID, isConnected, coreStorageReady, coreStorageMessage, isUnavailable, busy, setBusy, notify, refresh, refreshGenerationRef, lastPlannedSource, rememberLastSourcePath, canLeaveSettings, rememberDrawerTrigger, closeDrawers, setAddOpen, library, rememberWorkspace }: {
  t: Translator;
  workspaceID: string;
  isConnected: boolean;
  coreStorageReady: boolean;
  coreStorageMessage: string;
  isUnavailable: boolean;
  busy: boolean;
  setBusy: (value: boolean) => void;
  notify: (notice: Notice | undefined) => void;
  refresh: () => Promise<void>;
  refreshGenerationRef: { current: number };
  lastPlannedSource: string;
  rememberLastSourcePath: (path: string) => void;
  canLeaveSettings: () => boolean;
  rememberDrawerTrigger: (trigger?: EventTarget | null) => void;
  closeDrawers: () => void;
  setAddOpen: (value: boolean) => void;
  library: LibraryFlow;
  rememberWorkspace: (value: unknown) => void;
}): SourcesFlow {
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [staging, setStaging] = useState<SourceStaging | undefined>(undefined);
  const [stagingBusy, setStagingBusy] = useState(false);
  const [sourceProjection, setSourceProjection] = useState<SourceProjection>({ state: "READY" });
  const [sourceChanges, setSourceChanges] = useState<Record<string, SourceChangeSummary>>({});
  const [source, setSource] = useState("");
  // This transient draft points back to the existing staging directory/plan
  // so the ordinary Add drawer can resume the same operation after remount.
  const [pastedTextDraft, setPastedTextDraft] = useState<PastedTextDraft>({
    filename: "reading-notes.txt", text: "", locked: false, stagingDir: "", rows: [], error: "", partial: false, planID: "", attemptID: 0, receiving: false,
  });
  const [openTextComposerRequested, setOpenTextComposerRequested] = useState(false);
  const pastedTextAttemptRef = useRef(0);
  const editPastedTextDraft = (filename: string, text: string) => {
    setPastedTextDraft((draft) => draft.locked ? draft : { ...draft, filename, text });
  };
  const beginPastedTextUpload = () => {
    const attemptID = ++pastedTextAttemptRef.current;
    setPastedTextDraft((draft) => ({ ...draft, locked: true, receiving: true, attemptID, stagingDir: "", rows: [], error: "", partial: false, planID: "" }));
    return attemptID;
  };
  const recordPastedTextUpload = (outcome: { attemptID: number; stagingDir: string; rows: UploadFileRow[]; error: string; partial: boolean }) => {
    setPastedTextDraft((draft) => draft.attemptID !== outcome.attemptID ? draft : { ...draft, ...outcome, receiving: false });
  };
  const clearPastedTextDraft = () => {
    const attemptID = ++pastedTextAttemptRef.current;
    setPastedTextDraft({ filename: "reading-notes.txt", text: "", locked: false, stagingDir: "", rows: [], error: "", partial: false, planID: "", attemptID, receiving: false });
  };
  const [recheckSourceRef, setRecheckSourceRef] = useState("");
  const [plan, setPlan] = useState<any>();
  const [planAction, setPlanAction] = useState<PlanActionState>("IDLE");
  const [planCheckBusy, setPlanCheckBusy] = useState(false);
  const planRequestRef = useRef(0);

  // One-tap path suggestions use only data the client already has: the
  // configured source locators and the last path planned in this browser.
  // There is no host-filesystem browser and no extra operation behind them.
  const pathSuggestions = useMemo(() => {
    const suggestions: PathSuggestion[] = [];
    const seen = new Set<string>();
    for (const item of sources) {
      const path = item.locator?.trim();
      if (!path || seen.has(path)) continue;
      seen.add(path);
      suggestions.push({ key: `source:${item.source_ref ?? path}`, path, sourceRef: item.source_ref?.trim() ?? "", kind: "source" });
    }
    const recent = lastPlannedSource.trim();
    if (recent && !seen.has(recent)) suggestions.push({ key: `recent:${recent}`, path: recent, sourceRef: "", kind: "recent" });
    return suggestions.slice(0, 6);
  }, [lastPlannedSource, sources]);

  async function loadSources(activeWorkspaceID: string, refreshGeneration = refreshGenerationRef.current, restorePoints: SnapshotSummary[] = []) {
    try {
      const response = await command(operations.source.list, { workspace_id: activeWorkspaceID });
      if (refreshGenerationRef.current !== refreshGeneration) return;
      const projected = (response.data?.sources ?? []) as SourceSummary[];
      // The daemon-owned staging inbox arrives beside the configured sources
      // as a clearly labelled projection (kind STAGING_INBOX) with no source
      // ref. It is never counted as a configured source.
      setSources(projected.filter((item) => item.kind !== "STAGING_INBOX"));
      setStaging(projected.find((item) => item.kind === "STAGING_INBOX")?.staging);
      setSourceProjection({ state: "READY" });
      void loadSourceChanges(projected, restorePoints, refreshGeneration);
    } catch {
      if (refreshGenerationRef.current !== refreshGeneration) return;
      // Source management is a secondary projection; an unavailable projection
      // must not hide the content library or imply that saved bytes are gone.
      // Drop the old cards so a failed refresh cannot leave actions bound to a
      // stale source projection.
      setSources([]);
      setStaging(undefined);
      setSourceChanges({});
      setSourceProjection({ state: "DEGRADED" });
    }
  }
  // The daemon's own answer to "what changed since the previous restore
  // point". `restorePoints` is the `snapshot.list` projection the shell read on
  // this refresh; one `snapshot.diff` call compares a source's two newest
  // points, and a source with fewer than two points issues no diff at all.
  async function loadSourceChanges(projected: SourceSummary[], restorePoints: SnapshotSummary[], refreshGeneration: number) {
    const next: Record<string, SourceChangeSummary> = {};
    const pending: Array<{ key: string; from: SnapshotSummary; to: SnapshotSummary }> = [];
    for (const item of projected) {
      const key = item.source_ref?.trim();
      if (!key) continue;
      const resolved = resolveSourceRestorePoints(item, restorePoints, t);
      if (resolved.state === "READY") {
        next[key] = {
          state: "READING",
          added: 0, removed: 0, changed: 0, changes: [],
          fromRef: resolved.previous.snapshot_ref ?? "",
          toRef: resolved.newest.snapshot_ref ?? "",
          fromAt: resolved.previous.created_at ?? "",
          toAt: resolved.newest.created_at ?? "",
          newestVerification: resolved.newest.verification,
        };
        pending.push({ key, from: resolved.previous, to: resolved.newest });
        continue;
      }
      if (resolved.state === "UNAVAILABLE") {
        next[key] = { state: "UNAVAILABLE", reason: resolved.reason, added: 0, removed: 0, changed: 0, changes: [] };
        continue;
      }
      const newest = resolved.state === "SINGLE_POINT" ? resolved.newest : undefined;
      next[key] = {
        state: resolved.state,
        added: 0, removed: 0, changed: 0, changes: [],
        fromRef: newest?.snapshot_ref ?? "",
        toRef: newest?.snapshot_ref ?? "",
        fromAt: newest?.created_at ?? "",
        toAt: newest?.created_at ?? "",
        newestVerification: newest?.verification,
      };
    }
    if (refreshGenerationRef.current !== refreshGeneration) return;
    setSourceChanges(next);
    if (!pending.length) return;
    await Promise.allSettled(pending.map(async ({ key, from, to }) => {
      const summary = await readChangeSummary(from, to);
      if (refreshGenerationRef.current !== refreshGeneration) return;
      setSourceChanges((current) => ({ ...current, [key]: summary }));
    }));
  }
  // One `snapshot.diff` read. Only a SUCCEEDED answer that echoes the two
  // requested refs proves the daemon compared these restore points; every
  // other outcome is UNAVAILABLE with the daemon's reason and asserts no count.
  async function readChangeSummary(from: SnapshotSummary, to: SnapshotSummary): Promise<SourceChangeSummary> {
    const fromRef = from.snapshot_ref ?? "";
    const toRef = to.snapshot_ref ?? "";
    const base = {
      added: 0, removed: 0, changed: 0, changes: [] as SnapshotDiffItem[],
      fromRef, toRef,
      fromAt: from.created_at ?? "", toAt: to.created_at ?? "",
      newestVerification: to.verification,
    };
    try {
      const response = await command(operations.snapshot.diff, { from_snapshot_ref: fromRef, to_snapshot_ref: toRef });
      const data = response.data ?? {};
      const answered = response.status === "SUCCEEDED"
        && String(data.from_snapshot_ref ?? "") === fromRef
        && String(data.to_snapshot_ref ?? "") === toRef;
      if (!answered) {
        return { ...base, state: "UNAVAILABLE", reason: t("The daemon did not answer snapshot.diff for these two restore points, so no comparison is reported.") };
      }
      const items = (Array.isArray(data.changes) ? data.changes : []) as SnapshotDiffItem[];
      let added = 0;
      let removed = 0;
      let changed = 0;
      for (const item of items) {
        if (item?.kind === "added") added += 1;
        else if (item?.kind === "removed") removed += 1;
        else changed += 1;
      }
      return { ...base, state: "READY", added, removed, changed, changes: items };
    } catch (error) {
      return { ...base, state: "UNAVAILABLE", reason: error instanceof Error ? error.message : t("The change summary could not be read.") };
    }
  }
  // Preview and suggestion taps share one ingest runner so Enter in the path
  // field, the sticky bar's preview action, and a suggestion chip all produce
  // exactly the same recorded plan.
  function makePlan(event?: FormEvent) {
    event?.preventDefault();
    void runIngestPlan(source);
  }
  async function runIngestPlan(rootPath: string, associatePastedText = false) {
    const root = rootPath.trim();
    if (!root) return undefined;
    if (!coreStorageReady) { notify({ kind: "error", text: coreStorageMessage }); return undefined; }
    if (looksLikeRemoteLocator(root)) {
      notify({ kind: "warning", text: t("Web addresses are not supported here. Mount remote storage on the Cairn host, then enter its server path.") });
      return undefined;
    }
    if (planAction === "INSPECTING" || planAction === "PROTECTING") return undefined;
    const request = ++planRequestRef.current;
    setPlan(undefined); setPlanAction("INSPECTING"); setBusy(true); notify(undefined);
    try {
      const response = await command(operations.plan.ingest, { root });
      if (request !== planRequestRef.current) return undefined;
      setPlan(response.data);
      if ((associatePastedText || (pastedTextDraft.locked && root === pastedTextDraft.stagingDir)) && typeof response.data?.plan_id === "string") {
        setPastedTextDraft((draft) => ({ ...draft, planID: response.data.plan_id }));
      }
      rememberWorkspace(response.data?.workspace_id);
      rememberLastSourcePath(root);
      notify({ kind: response.data?.executable ? "success" : "warning", text: response.data?.executable ? t("Storage plan is ready to review.") : t("This source has blocked entries and cannot be saved yet.") });
      return response.data;
    }
    catch (error) { setPlanAction("IDLE"); notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not create storage plan") }); return undefined; }
    finally { setBusy(false); setPlanAction("IDLE"); }
  }
  // A suggestion that names a configured source is a recheck of that source,
  // not a fresh add: the drawer copy, the recorded plan, and the sticky bar all
  // keep that distinction honest.
  function pickSuggestedPath(suggestion: PathSuggestion) {
    if (planAction === "INSPECTING" || planAction === "PROTECTING" || planCheckBusy) return;
    setSource(suggestion.path);
    setRecheckSourceRef(suggestion.sourceRef);
    void runIngestPlan(suggestion.path);
  }
  async function checkPlanStatus() {
    if (!plan?.plan_id || !plan?.plan_digest || planCheckBusy) return;
    const request = planRequestRef.current;
    const targetPlanID = plan.plan_id;
    const targetPlanDigest = plan.plan_digest;
    const targetWorkspaceID = plan.workspace_id;
    setPlanCheckBusy(true);
    try {
      const response = await command(operations.plan.get, { workspace_id: targetWorkspaceID, plan_id: targetPlanID });
      if (request !== planRequestRef.current || plan?.plan_id !== targetPlanID || plan?.plan_digest !== targetPlanDigest) return;
      const data = response.data;
      if (data?.plan_id !== targetPlanID || data?.plan_digest !== targetPlanDigest) throw new Error(t("The protection plan changed. Review a fresh plan before continuing."));
      if (data.applied === true) {
        setPlan({ ...plan, ...data, state: "SUCCEEDED", executable: false, awaiting_confirmation: false });
        setPlanAction("SUCCEEDED");
        if (pastedTextDraft.planID && targetPlanID === pastedTextDraft.planID) clearPastedTextDraft();
        notify({ kind: "success", text: t("Content saved. Exact bytes are now in the repository.") });
        try { await refresh(); } catch { notify({ kind: "warning", text: t("Content saved. Refresh the library to update its list.") }); }
      } else {
        setPlan({ ...plan, ...data, awaiting_confirmation: true, executable: false });
        notify({ kind: "warning", text: t("Protection is not confirmed yet. Keep this plan and check again later.") });
      }
    } catch (error) { notify({ kind: "warning", text: error instanceof Error ? error.message : t("Could not verify protection result.") }); }
    finally { setPlanCheckBusy(false); }
  }
  async function applyPlan() {
    if (planAction === "INSPECTING" || planAction === "PROTECTING") return;
    if (!plan?.plan_id || !plan?.plan_digest) return;
    if (!coreStorageReady) { notify({ kind: "error", text: coreStorageMessage }); return; }
    setPlanAction("PROTECTING"); setBusy(true);
    try {
      const response = await command(operations.plan.apply, { workspace_id: plan.workspace_id, plan_id: plan.plan_id, plan_digest: plan.plan_digest });
      const appliedState = response.data?.state;
      if (appliedState !== "SUCCEEDED" && response.data?.already_applied !== true) {
        setPlan({ ...plan, ...response.data, state: "UNKNOWN", executable: false, awaiting_confirmation: true });
        setPlanAction("IDLE");
        notify({ kind: "warning", text: t("Protection result needs verification. Check the plan status before trying again.") });
        return;
      }
      setPlan({ ...plan, ...response.data, state: appliedState === "SUCCEEDED" ? appliedState : "SUCCEEDED", executable: false, awaiting_confirmation: false });
      rememberWorkspace(response.data?.workspace_id ?? plan.workspace_id);
      const degraded = response.status === "DEGRADED" || (response.data?.warnings?.length ?? 0) > 0;
      setPlanAction("SUCCEEDED");
      if (pastedTextDraft.planID && plan.plan_id === pastedTextDraft.planID) clearPastedTextDraft();
      notify({ kind: degraded ? "warning" : "success", text: t(degraded ? "Exact bytes saved, but derived processing is unavailable." : "Content saved. Exact bytes are now in the repository.") });
      try { await refresh(); } catch { notify({ kind: "warning", text: t("Content saved. Refresh the library to update its list.") }); }
    } catch (error) {
      setPlanAction("IDLE");
      setPlan((current: any) => current ? { ...current, executable: false, awaiting_confirmation: true } : current);
      notify({ kind: "warning", text: error instanceof Error ? error.message : t("Protection outcome is unknown. Check the plan status before trying again.") });
    } finally { setBusy(false); }
  }
  async function viewSource(sourceItem: SourceSummary) {
    if (!workspaceID) return;
    setBusy(true);
    try {
      if (sourceItem.latest_namespace_root_id) {
        await library.loadNamespace(workspaceID, sourceItem.latest_namespace_root_id);
      } else {
        await library.loadContentLibrary(workspaceID, refreshGenerationRef.current, true);
      }
    } catch (error) {
      notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not open source content") });
    } finally { setBusy(false); }
  }
  function openAdd(sourceItem?: SourceSummary, trigger?: EventTarget | null, options?: { openTextComposer?: boolean; beforeOpen?: () => boolean }) {
    setOpenTextComposerRequested(false);
    if (!isConnected || !coreStorageReady) { notify({ kind: "error", text: coreStorageMessage }); return; }
    if (!canLeaveSettings()) return;
    if (options?.beforeOpen && !options.beforeOpen()) return;
    rememberDrawerTrigger(trigger);
    closeDrawers();
    if (pastedTextDraft.locked) {
      const stagingDir = pastedTextDraft.stagingDir.trim();
      setSource(stagingDir || "");
      // Keep a matching plan so its existing check/apply path resumes.
      if (!pastedTextDraft.planID || plan?.plan_id !== pastedTextDraft.planID) setPlan(undefined);
      setPlanAction("IDLE");
      setRecheckSourceRef("");
    } else {
      planRequestRef.current += 1;
      setPlanCheckBusy(false);
      setSource(sourceItem?.locator?.trim() ?? "");
      setPlan(undefined);
      setPlanAction("IDLE");
      setRecheckSourceRef(sourceItem?.source_ref?.trim() ?? "");
    }
    if (options?.openTextComposer && !pastedTextDraft.locked) setOpenTextComposerRequested(true);
    setAddOpen(true); notify(undefined);
  }
  // Editing the path invalidates the plan being reviewed: a plan describes one
  // exact root, so the stale plan is dropped instead of being saved later.
  function changeSourceInput(value: string) {
    planRequestRef.current += 1;
    setSource(value);
    setPlan(undefined);
    setPlanAction("IDLE");
  }
  // Start a second upload only after the current upload's exact plan has a
  // confirmed terminal success. This clears the transient association; it
  // never removes staged files or starts another ingest/apply operation.
  function continueAfterSavedUpload(planID: string, stagingDir: string): boolean {
    if (!planID || !stagingDir || source.trim() !== stagingDir.trim()) return false;
    if (plan?.plan_id !== planID || plan?.state !== "SUCCEEDED" || plan?.awaiting_confirmation === true) return false;
    if (planAction !== "SUCCEEDED" || planCheckBusy || busy || pastedTextDraft.receiving) return false;
    planRequestRef.current += 1;
    setSource("");
    setPlan(undefined);
    setPlanAction("IDLE");
    setRecheckSourceRef("");
    clearPastedTextDraft();
    return true;
  }
  function closeAdd() {
    if (planAction === "INSPECTING" || planAction === "PROTECTING") { notify({ kind: "warning", text: t("This operation is still running. Keep this panel open until it finishes.") }); return; }
    setAddOpen(false); setRecheckSourceRef(""); setOpenTextComposerRequested(false);
  }
  // The staging handoff: one action prefills the ordinary add-source drawer
  // with the staging directory as the root and starts the same reviewable
  // plan.ingest preview every other path uses. Nothing auto-ingests; only
  // the operator's digest-bound confirm writes bytes.
  function ingestStaged() {
    const directory = staging?.path?.trim();
    if (!directory || planAction !== "IDLE") return;
    openAdd({ locator: directory });
    void runIngestPlan(directory, pastedTextDraft.locked && directory === pastedTextDraft.stagingDir);
  }
  // The staged-file cleanup deletes ONLY regular files inside the daemon's
  // own staging inbox, after an explicit window.confirm. The copy states the
  // truth about what this is: staged files carry no protection record yet, so
  // deleting never-ingested scratch is not destructive garbage collection of
  // protected content — but if the bytes were never ingested, this removes
  // the only copy. The daemon independently refuses anything outside its
  // inbox root.
  async function cleanStaged() {
    const directory = staging?.path?.trim();
    if (!directory || stagingBusy) return;
    const count = Number(staging?.files ?? 0);
    const bytes = formatBytes(Number(staging?.bytes ?? 0));
    if (!window.confirm(t("Delete the {{count}} staged file(s) ({{bytes}})? Staged files have no protection record yet: if they were never saved to the library, this removes the only copy. Saved and protected content is never touched.", { count, bytes }))) return;
    setStagingBusy(true);
    try {
      const response = await command(operations.source.stagingClean, { directory });
      const data = response.data ?? {};
      notify({ kind: response.status === "DEGRADED" ? "warning" : "success", text: t("Removed {{count}} staged file(s) ({{bytes}}) from the staging area.", { count: Number(data.removed_files ?? 0), bytes: formatBytes(Number(data.removed_bytes ?? 0)) }) });
    } catch (error) {
      notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not clean staged files.") });
    } finally {
      setStagingBusy(false);
    }
    try { await refresh(); } catch { /* the refresh reports its own projection failures */ }
  }
  function resetSourceProjection() {
    setPlan(undefined);
    setSources([]);
    setStaging(undefined);
    setSourceChanges({});
  }

  const sourceLooksRemote = looksLikeRemoteLocator(source);
  // The sticky action bar is the drawer's single next step. It performs exactly
  // one action per state, never offers a save that cannot run, and leaves the
  // review evidence (files, bytes, warnings, per-file decisions) in the card
  // above it.
  const sourcePlanApplied = plan?.state === "SUCCEEDED";
  const sourcePlanAwaiting = Boolean(plan?.awaiting_confirmation) && !sourcePlanApplied;
  const sourceBarState: ActionBarState = !plan
    ? "PREVIEW"
    : sourcePlanApplied
      ? "SAVED"
      : sourcePlanAwaiting
        ? "AWAITING"
        : !plan.executable
          ? "BLOCKED"
          : Number(plan.files ?? 0) <= 0 ? "UP_TO_DATE" : "READY";
  const sourceBlockedCount = Number(plan?.blocked_entries?.length ?? 0);
  const sourceFileCount = Number(plan?.files ?? 0);
  const sourceBarReason = sourceBarState === "AWAITING"
    ? t("Result not confirmed yet. Check the plan status before saving again.")
    : sourceBarState === "BLOCKED"
      ? t(sourceBlockedCount > 0 ? "Resolve blocked entries before confirming." : "This plan is no longer executable.")
      : sourceBarState === "UP_TO_DATE"
        ? t("Already up to date. Nothing new to add from this source.")
        : "";
  const sourceSaveLabel = sourceFileCount > 0
    ? `${t("Confirm save")} · ${t("{{count}} files", { count: sourceFileCount })}`
    : t("Confirm save");
  const sourceActionBusy = busy || planAction !== "IDLE" || planCheckBusy;
  const sourcePreviewDisabled = sourceActionBusy || isUnavailable || !coreStorageReady || !source.trim() || sourceLooksRemote;
  // The save and suggestion actions stay scoped to this drawer's own plan
  // operation, exactly as the plan-card button did, so an unrelated background
  // read can never pretend the save is unavailable.
  const sourcePlanBusy = planAction !== "IDLE" || planCheckBusy;
  const sourceSaveDisabled = sourcePlanBusy || isUnavailable || !coreStorageReady;
  const sourceSuggestionDisabled = sourcePlanBusy || isUnavailable || !coreStorageReady;

  return {
    sources,
    openTextComposerRequested,
    setSources,
    staging,
    stagingBusy,
    sourceProjection,
    setSourceProjection,
    sourceChanges,
    source,
    setSource,
    changeSourceInput,
    pastedTextDraft,
    editPastedTextDraft,
    beginPastedTextUpload,
    recordPastedTextUpload,
    clearPastedTextDraft,
    continueAfterSavedUpload,
    recheckSourceRef,
    setRecheckSourceRef,
    plan,
    planAction,
    planCheckBusy,
    sourceLooksRemote,
    pathSuggestions,
    sourceBarState,
    sourceBarReason,
    sourceSaveLabel,
    sourcePreviewDisabled,
    sourcePlanBusy,
    sourceSaveDisabled,
    sourceSuggestionDisabled,
    loadSources,
    makePlan,
    runIngestPlan,
    pickSuggestedPath,
    checkPlanStatus,
    applyPlan,
    viewSource,
    openAdd,
    closeAdd,
    ingestStaged,
    cleanStaged,
    resetSourceProjection,
  };
}

// Resolve the two newest restore points of one configured source. The newest
// point is the daemon's own source record (`latest_snapshot_ref`); the point
// before it is the newest other restore point whose recorded provenance path
// is this source's locator. Both facts are the daemon's; the browser selects
// two of its restore points and never invents one. A source with one point is
// SINGLE_POINT — there is nothing to compare against yet, which is not the
// same claim as "no changes".
function resolveSourceRestorePoints(source: SourceSummary, snapshots: SnapshotSummary[], t: Translator):
  | { state: "NO_POINTS" }
  | { state: "SINGLE_POINT"; newest: SnapshotSummary }
  | { state: "UNAVAILABLE"; reason: string }
  | { state: "READY"; newest: SnapshotSummary; previous: SnapshotSummary } {
  const latestRef = source.latest_snapshot_ref?.trim() ?? "";
  if (!latestRef) return { state: "NO_POINTS" };
  const newest = snapshots.find((snapshot) => snapshot.snapshot_ref === latestRef);
  if (!newest) {
    return { state: "UNAVAILABLE", reason: t("snapshot.list did not report this source's newest restore point, so its restore points cannot be compared.") };
  }
  const pathKey = provenanceKey(source.locator);
  if (!pathKey) {
    return { state: "UNAVAILABLE", reason: t("This source record does not report a path, so its restore points cannot be matched to it.") };
  }
  const previous = snapshots
    .filter((snapshot) => snapshot.snapshot_ref !== latestRef && provenanceKey(snapshot.display_path) === pathKey)
    .sort((left, right) => String(left.created_at ?? "").localeCompare(String(right.created_at ?? "")))
    .at(-1);
  if (!previous) return { state: "SINGLE_POINT", newest };
  return { state: "READY", newest, previous };
}

// The recorded provenance path with separators normalized. It is a matching
// key only: a source and its restore points are bound by the path the daemon
// recorded, never by a browser-computed identity.
function provenanceKey(value?: string) {
  return String(value ?? "").trim().replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}
