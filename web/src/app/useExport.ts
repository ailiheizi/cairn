import { useEffect, useRef, useState } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import { resolveArchiveSelectionSizes } from "../lib/originalArchive";
import { buildSavedRetrievalCandidate } from "../lib/savedRetrievalCandidate";
import type { LibraryFlow } from "./useLibrary";
import type { SelectionFlow } from "./useSelection";
import type { ExportActionState, ExportManifestData, ExportManifestSource, ExportMode, LibraryPageMode, Notice, SavedViewData, SearchHit, SystemFacetState, ViewMode } from "../lib/types";
import type { RecallOutcome, SavedViewsFlow } from "./useSavedViews";
export type { FailedRecall, RecalledViewState } from "../lib/types";

// The export drawer.
//
// A frozen manifest is a durable catalog record. This flow can plan and
// materialize it, or explicitly reuse a history manifest at a different
// destination without changing the frozen unit. The active write attempt is
// transient browser-session context, not a durable receipt or recovery
// guarantee. Because the current command contract does not attest that an
// apply error wrote nothing, every unconfirmed attempt stays pinned to its
// manifest and destination until verification; the client never retries the
// write automatically.

export type ExportWriteAttempt = Readonly<{
  manifestID: string;
  manifestDigest: string;
  destination: string;
  workspaceID: string;
  outcome: "applying" | "uncertain" | "written" | "verified";
}>;

export type ExportFlow = Omit<SavedViewsFlow, "recallSavedView" | "refreshRecalledView" | "resetRecallProjection"> & {
  exportMode: ExportMode;
  exportView: any;
  exportDestination: string;
  exportSidecars: string;
  exportPresetApplied: boolean;
  changeExportSidecars: (value: string) => void;
  exportManifest: ExportManifestData | undefined;
  exportManifestSource: ExportManifestSource;
  exportResult: any;
  exportAction: ExportActionState;
  exportMessage: string;
  exportWriteUncertain: boolean;
  exportVerificationOnly: boolean;
  exportHistoryReproductionReady: boolean;
  exportWriteAttempt?: ExportWriteAttempt;
  exportAttemptLocked: boolean;
  exportSelection: SearchHit[];
  retrievalCandidate: { query: string; fields: string[]; unsupportedConditions: string[] };
  exportHistory: ExportManifestData[];
  exportHistoryLoading: boolean;
  exportHistoryError: string;
  canOpenExport: boolean;
  canExportSavedView: boolean;
  openExport: (trigger?: EventTarget | null, explicitSelection?: SearchHit[]) => void;
  openSavedViewExport: (view: SavedViewData, trigger?: EventTarget | null) => void;
  closeExport: () => void;
  changeExportMode: (mode: ExportMode) => void;
  changeExportDestination: (value: string) => void;
  recallSavedView: (view: SavedViewData) => Promise<void>;
  refreshRecalledView: () => Promise<void>;
  previewExport: () => Promise<void>;
  applyExport: () => Promise<void>;
  verifyExport: () => Promise<void>;
  loadExportHistory: () => Promise<void>;
  pickSavedViewForExport: (view: SavedViewData) => void;
  pickHistoryManifest: (manifest: ExportManifestData) => void;
  beginHistoryReproduction: () => void;
  resetExportProjection: () => void;
};
// The export destination and sidecar choice this browser last used for one
// workspace. This is a convenience for this browser only, following the
// `cairn.*` recents prefix and its try/catch storage pattern: it is
// never a plan, a frozen manifest, a durable default, or recovery evidence.
// The manifest, the destination the daemon checks, and the written bytes stay
// with the daemon catalog. The key is scoped per workspace so one workspace's
// convenience never leaks into another's, and a missing or unreadable value
// pre-fills nothing rather than inventing a default.
const exportPresetPrefix = "cairn.export_preset.";
type ExportPreset = { destination: string; sidecars: string };
// The selector's closed vocabulary. The daemon implements exactly one policy
// besides the empty default, so a stored value outside it is dropped instead of
// being sent while the select cannot display it.
const ADMITTED_SIDECAR_POLICIES = new Set(["", "handoff-v1:manifest-json"]);

function readExportPreset(workspaceID: string): ExportPreset {
  const empty: ExportPreset = { destination: "", sidecars: "" };
  if (!workspaceID) return empty;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${exportPresetPrefix}${workspaceID}`) ?? "{}");
    const sidecars = typeof parsed?.sidecars === "string" ? parsed.sidecars.trim() : "";
    return {
      destination: typeof parsed?.destination === "string" ? parsed.destination.trim() : "",
      sidecars: ADMITTED_SIDECAR_POLICIES.has(sidecars) ? sidecars : "",
    };
  } catch { return empty; }
}

function writeExportPreset(workspaceID: string, preset: ExportPreset) {
  if (!workspaceID) return;
  try {
    const key = `${exportPresetPrefix}${workspaceID}`;
    const destination = preset.destination.trim();
    const sidecars = ADMITTED_SIDECAR_POLICIES.has(preset.sidecars.trim()) ? preset.sidecars.trim() : "";
    if (!destination && !sidecars) { window.localStorage.removeItem(key); return; }
    window.localStorage.setItem(key, JSON.stringify({ destination, sidecars }));
  } catch { /* a browser that refuses storage keeps no preset; the drawer still works */ }
}

export function useExport({ t, workspaceID, isConnected, coreStorageReady, coreStorageMessage, exportOpen, viewMode, presentationMode, lastExecutedQuery, activeTags, activeSystemFacets, activeTimelineMonth, selected, selection, library, savedViews: savedViewsFlow, setBusy, notify, canLeaveSettings, rememberDrawerTrigger, closeOtherDrawers, setExportOpen }: {
  t: Translator;
  workspaceID: string;
  isConnected: boolean;
  coreStorageReady: boolean;
  coreStorageMessage: string;
  exportOpen: boolean;
  viewMode: ViewMode;
  presentationMode: "content" | LibraryPageMode;
  lastExecutedQuery: string;
  activeTags: string[];
  activeSystemFacets: SystemFacetState;
  activeTimelineMonth: string;
  selected: SearchHit | undefined;
  selection: SelectionFlow;
  library: LibraryFlow;
  savedViews: SavedViewsFlow;
  setBusy: (value: boolean) => void;
  notify: (notice: Notice | undefined) => void;
  canLeaveSettings: () => boolean;
  rememberDrawerTrigger: (trigger?: EventTarget | null) => void;
  closeOtherDrawers: () => void;
  setExportOpen: (value: boolean) => void;
}): ExportFlow {
  const [exportSelection, setExportSelection] = useState<SearchHit[]>([]);
  const [exportMode, setExportMode] = useState<ExportMode>("selected");
  const [exportView, setExportView] = useState<any>();
  const [exportDestination, setExportDestination] = useState("");
  // The daemon implements one sidecar policy besides the empty default. The
  // selector offers exactly that vocabulary; a daemon that moves ahead surfaces
  // its own invalid_input rather than a silent no-op.
  const [exportSidecars, setExportSidecars] = useState("");
  // True while a pre-filled value still comes from the browser-local preset.
  // The drawer's helper line states that the prefill is browser-local, and it
  // stops being claimed as soon as the destination is edited.
  const [exportPresetApplied, setExportPresetApplied] = useState(false);
  const [exportManifest, setExportManifest] = useState<ExportManifestData>();
  const [exportResult, setExportResult] = useState<any>();
  const [exportAction, setExportAction] = useState<ExportActionState>("IDLE");
  const [exportMessage, setExportMessage] = useState("");
  const [exportWriteUncertain, setExportWriteUncertain] = useState(false);
  const [exportManifestSource, setExportManifestSource] = useState<ExportManifestSource>("planned");
  const [exportHistoryReproductionReady, setExportHistoryReproductionReady] = useState(false);
  const [exportWriteAttempt, setExportWriteAttemptState] = useState<ExportWriteAttempt>();
  const [exportHistory, setExportHistory] = useState<ExportManifestData[]>([]);
  const [exportHistoryLoading, setExportHistoryLoading] = useState(false);
  const [exportHistoryError, setExportHistoryError] = useState("");
  const exportRequestRef = useRef(0);
  const applyInFlightRef = useRef("");
  const exportWriteAttemptRef = useRef<ExportWriteAttempt | undefined>(undefined);
  const exportHistoryReadRef = useRef(0);
  const workspaceReadContextRef = useRef({ workspaceID, generation: 0 });
  if (workspaceReadContextRef.current.workspaceID !== workspaceID) {
    workspaceReadContextRef.current = {
      workspaceID,
      generation: workspaceReadContextRef.current.generation + 1,
    };
    exportHistoryReadRef.current += 1;
  }
  const currentWorkspaceRef = useRef(workspaceID);
  currentWorkspaceRef.current = workspaceID;
  function updateExportWriteAttempt(attempt: ExportWriteAttempt | undefined) {
    exportWriteAttemptRef.current = attempt;
    setExportWriteAttemptState(attempt);
  }
  function isExportAttemptLocked(attempt = exportWriteAttemptRef.current) {
    return Boolean(attempt && attempt.outcome !== "verified");
  }

  useEffect(() => {
    const attempt = exportWriteAttemptRef.current;
    if (attempt && attempt.outcome !== "verified" && attempt.workspaceID !== workspaceID) {
      exportRequestRef.current += 1;
      if (attempt.outcome === "applying") {
        updateExportWriteAttempt({ ...attempt, outcome: "uncertain" });
        setExportWriteUncertain(true);
      }
      setExportAction("FAILED");
      setExportMessage(t("The content workspace changed during this write. Verify the same frozen manifest at its attempted directory before continuing."));
    }
    setExportHistoryLoading(false);
    setExportHistoryError("");
  }, [workspaceID, t]);

  const retrievalCandidate = buildSavedRetrievalCandidate({
    t,
    lastExecutedQuery,
    viewMode,
    presentationMode,
    recalledView: savedViewsFlow.recalledView,
    activeTags,
    activeSystemFacets: { ...activeSystemFacets },
    activeTimelineMonth,
  });
  const canUseSearch = retrievalCandidate.unsupportedConditions.length === 0
    && Boolean(retrievalCandidate.query.trim() || retrievalCandidate.fields.length > 0);
  const exportAttemptLocked = isExportAttemptLocked(exportWriteAttempt);
  const exportVerificationOnly = (exportManifestSource === "history" && !exportHistoryReproductionReady)
    || exportAttemptLocked
    || exportWriteUncertain
    || exportResult?.materialized === true
    || exportResult?.verified?.verified === true;
  // An explicit multi-selection is a stronger statement of intent than the
  // open details subject, so it becomes the frozen selection when present.
  const detailSelection = selected?.subject_ref?.trim() && selected.entry_type !== "DIRECTORY" ? [selected] : [];
  const canOpenExport = selection.selectionSubjects.length > 0 || detailSelection.length > 0 || canUseSearch;
  const canExportSavedView = Boolean(isConnected && coreStorageReady && workspaceID);

  function openExport(trigger?: EventTarget | null, explicitSelection?: SearchHit[], initialSavedView?: SavedViewData) {
    if (isExportAttemptLocked()) {
      if (!canLeaveSettings()) return;
      rememberDrawerTrigger(trigger);
      closeOtherDrawers();
      setExportOpen(true);
      notify(undefined);
      return;
    }
    const selectionForExport = initialSavedView ? [] : explicitSelection && explicitSelection.length
      ? explicitSelection
      : selection.selectionSubjects.length > 0
        ? selection.selectionSubjects
        : detailSelection;
    if (!isConnected || !coreStorageReady || !workspaceID || (selectionForExport.length === 0 && !canUseSearch && !initialSavedView?.view_id)) {
      notify({ kind: "error", text: coreStorageMessage });
      return;
    }
    if (!canLeaveSettings()) return;
    rememberDrawerTrigger(trigger);
    const nextMode: ExportMode = initialSavedView ? "view" : selectionForExport.length ? "selected" : "view";
    closeOtherDrawers();
    exportRequestRef.current += 1;
    // The prefill is the last destination and sidecar choice this browser used
    // in this workspace. It is a browser-local convenience, labelled as such in
    // the drawer; a cleared or never-set value stays empty instead of inventing
    // a default.
    const preset = readExportPreset(workspaceID);
    setExportSelection(selectionForExport);
    setExportMode(nextMode); setExportView(initialSavedView); setExportManifest(undefined); setExportResult(undefined);
    setExportManifestSource("planned");
    setExportHistoryReproductionReady(false);
    updateExportWriteAttempt(undefined);
    setExportAction("IDLE"); setExportMessage(""); setExportDestination(preset.destination); setExportSidecars(preset.sidecars);
    setExportPresetApplied(Boolean(preset.destination || preset.sidecars));
    setExportWriteUncertain(false);
    setExportOpen(true); notify(undefined);
    // Recalling a saved view and re-verifying a frozen manifest are the
    // durability surfaces of this drawer: both come from the daemon catalog,
    // never from browser state.
    void savedViewsFlow.loadSavedViews();
    void loadExportHistory();
  }
  function openSavedViewExport(view: SavedViewData, trigger?: EventTarget | null) {
    if (!view.view_id?.trim()) return;
    openExport(trigger, undefined, view);
  }
  function closeExport() {
    setExportOpen(false);
    if (isExportAttemptLocked()) return;
    exportRequestRef.current += 1;
    setExportAction("IDLE"); setExportSelection([]);
  }
  function changeExportMode(nextMode: ExportMode) {
    if (isExportAttemptLocked()) return;
    if (nextMode === exportMode) return;
    exportRequestRef.current += 1;
    setExportMode(nextMode); setExportManifest(undefined); setExportResult(undefined); setExportManifestSource("planned"); setExportWriteUncertain(false); setExportAction("IDLE");
    setExportHistoryReproductionReady(false); updateExportWriteAttempt(undefined);
    setExportMessage(t("Export source changed. Preview a new frozen manifest."));
  }
  function changeExportDestination(value: string) {
    const activeAttempt = exportWriteAttemptRef.current;
    if (isExportAttemptLocked(activeAttempt)) {
      if (value.trim() !== activeAttempt!.destination.trim()) {
        setExportDestination(activeAttempt!.destination);
        setExportMessage(t("This write is unresolved. Verify the same frozen manifest at its attempted directory before choosing another destination."));
      }
      return;
    }
    const destinationChanged = value.trim() !== exportDestination.trim();
    setExportDestination(value);
    // Editing either field ends the preset claim, so the drawer never labels a
    // value the operator has replaced as the stored browser default.
    setExportPresetApplied(false);
    // A manifest recalled from history is already frozen: the destination is
    // only the place a later verify reads, so editing it must not discard the
    // frozen unit. A planned manifest still describes a write to one target.
    if (exportManifest && (exportManifestSource === "history" || exportVerificationOnly || exportResult?.materialized)) {
      if (destinationChanged) {
        exportRequestRef.current += 1;
        setExportAction("IDLE");
        setExportMessage(t("Verification directory changed. Verify this frozen manifest at the selected directory."));
      }
      return;
    }
    if (!exportManifest && exportAction === "IDLE") return;
    exportRequestRef.current += 1;
    setExportManifest(undefined); setExportResult(undefined); setExportAction("IDLE");
    setExportMessage(t("Destination changed. Preview a new frozen manifest."));
  }
  // The two fields form one preset and are remembered together, once a plan has
  // actually used them. Only the selector's own vocabulary is ever stored, so a
  // value the select cannot display is never sent back.
  function changeExportSidecars(value: string) {
    setExportSidecars(value);
    if (value.trim() === "") setExportPresetApplied(false);
  }
  // Both values are remembered only after the daemon accepted a plan that used
  // them: a partially typed path and an unsubmitted sidecar choice are not
  // "last used" values, so they never overwrite the stored pair.
  function rememberExportChoices() {
    if (!exportDestination.trim()) return;
    writeExportPreset(workspaceID, { destination: exportDestination, sidecars: exportSidecars });
  }
  async function previewExport() {
    if (exportManifest) return;
    if (!exportDestination.trim()) return;
    const exportRefs = exportSelection.map((hit) => hit.subject_ref?.trim() ?? "").filter(Boolean);
    if (exportMode === "selected" && exportRefs.length === 0) {
      setExportAction("FAILED"); setExportMessage(t("Select one file result before previewing an export."));
      return;
    }
    if (exportMode === "view" && !exportView?.view_id) {
      setExportAction("FAILED"); setExportMessage(t("Save this search before previewing an export."));
      return;
    }
    const request = ++exportRequestRef.current;
    setExportAction("PLANNING"); setExportMessage("");
    try {
      // A multi-selection is frozen as one explicit selection: every chosen
      // subject goes into the manifest. Repeated base names are disambiguated
      // by the daemon with a numeric suffix, and an unusable member is
      // surfaced with the daemon's own message.
      const input = exportMode === "selected"
        ? { subjects: exportRefs, output_name: exportSelection.length === 1 ? exportSelection[0].name : undefined, target: exportDestination.trim(), representation: "exact", sidecars: exportSidecars || undefined }
        : { view_id: exportView.view_id, target: exportDestination.trim(), representation: "exact", sidecars: exportSidecars || undefined };
      const response = await command(operations.export.plan, input);
      if (exportRequestRef.current !== request) return;
      setExportManifest(response.data as ExportManifestData);
      setExportManifestSource("planned");
      setExportWriteUncertain(false);
      setExportResult(undefined); setExportAction("IDLE");
      // The daemon accepted this destination and sidecar pair, so it is the
      // pair this browser offers next time in this workspace.
      rememberExportChoices();
      setExportMessage(t("Export manifest frozen. Review the files before writing to the server directory."));
      void loadExportHistory();
    } catch (error) {
      if (exportRequestRef.current !== request) return;
      setExportAction("FAILED");
      setExportMessage(error instanceof Error ? error.message : t("Could not create export manifest"));
    }
  }
  async function applyExport() {
    if (!exportManifest?.manifest_id || !exportManifest.manifest_digest || !exportDestination.trim() || exportVerificationOnly) return;
    if (exportManifestSource === "history") {
      if (!exportHistoryReproductionReady) return;
      if (exportDestination.trim() === exportManifest.target?.trim()) {
        setExportAction("FAILED");
        setExportMessage(t("Choose a destination different from the manifest's recorded directory."));
        return;
      }
    }
    const manifestKey = `${exportManifest.manifest_id}\u0000${exportManifest.manifest_digest}\u0000${exportDestination.trim()}`;
    if (applyInFlightRef.current === manifestKey) return;
    applyInFlightRef.current = manifestKey;
    const request = ++exportRequestRef.current;
    const attempt: ExportWriteAttempt = {
      manifestID: exportManifest.manifest_id,
      manifestDigest: exportManifest.manifest_digest,
      destination: exportDestination.trim(),
      workspaceID,
      outcome: "applying",
    };
    updateExportWriteAttempt(attempt);
    setExportHistoryReproductionReady(false);
    setExportAction("APPLYING"); setExportMessage("");
    try {
      const applied = await command(operations.export.apply, { manifest_id: attempt.manifestID, manifest_digest: attempt.manifestDigest, destination: attempt.destination });
      if (exportRequestRef.current !== request || attempt.workspaceID !== currentWorkspaceRef.current) return;
      updateExportWriteAttempt({ ...attempt, outcome: "written" });
      setExportResult({ applied: applied.data, materialized: true, status: applied.status });
      setExportAction("VERIFYING");
      try {
        const verified = await command(operations.export.verify, { manifest_id: attempt.manifestID, manifest_digest: attempt.manifestDigest, destination: attempt.destination });
        if (exportRequestRef.current !== request || attempt.workspaceID !== currentWorkspaceRef.current) return;
        setExportResult((current: any) => ({ ...current, verified: verified.data, verifiedDestination: attempt.destination, status: verified.status }));
        if (verified.data?.verified !== true) {
          setExportAction("FAILED");
          setExportMessage(t("Verification returned without a verified result. Retry verification against the frozen manifest."));
          return;
        }
        updateExportWriteAttempt({ ...attempt, outcome: "verified" });
      } catch (error) {
        if (exportRequestRef.current !== request || attempt.workspaceID !== currentWorkspaceRef.current) return;
        setExportAction("FAILED");
        setExportMessage(`${t("Output was written, but verification failed. Retry verification against the same frozen manifest; do not materialize again.")} ${error instanceof Error ? error.message : ""}`.trim());
        return;
      }
      setExportAction("SUCCEEDED");
      setExportMessage(t("Export materialized and verified in the server directory."));
    } catch (error) {
      if (exportRequestRef.current !== request || attempt.workspaceID !== currentWorkspaceRef.current) return;
      updateExportWriteAttempt({ ...attempt, outcome: "uncertain" });
      setExportWriteUncertain(true);
      setExportAction("FAILED");
      setExportMessage(`${t("Materialize did not return a confirmed result. Verify this same frozen manifest and destination before taking any further action.")} ${error instanceof Error ? error.message : ""}`.trim());
    } finally {
      if (applyInFlightRef.current === manifestKey) applyInFlightRef.current = "";
    }
  }
  async function verifyExport() {
    const activeAttempt = exportWriteAttemptRef.current;
    const attemptNeedsVerification = isExportAttemptLocked(activeAttempt);
    const manifestID = attemptNeedsVerification ? activeAttempt!.manifestID : exportManifest?.manifest_id;
    const manifestDigest = attemptNeedsVerification ? activeAttempt!.manifestDigest : exportManifest?.manifest_digest;
    const destination = attemptNeedsVerification ? activeAttempt!.destination : exportDestination.trim();
    if (!manifestID || !manifestDigest || !destination) return;
    if (attemptNeedsVerification && (manifestID !== exportManifest?.manifest_id || manifestDigest !== exportManifest?.manifest_digest)) return;
    if (attemptNeedsVerification && activeAttempt!.workspaceID !== workspaceID) {
      setExportAction("FAILED");
      setExportMessage(t("The content workspace changed during this write. Verify the same frozen manifest at its attempted directory before continuing."));
      return;
    }
    const request = ++exportRequestRef.current;
    setExportAction("VERIFYING"); setExportMessage("");
    try {
      const response = await command(operations.export.verify, { manifest_id: manifestID, manifest_digest: manifestDigest, destination });
      if (exportRequestRef.current !== request || (attemptNeedsVerification && activeAttempt!.workspaceID !== currentWorkspaceRef.current)) return;
      setExportResult((current: any) => ({ ...current, verified: response.data, verifiedDestination: destination, status: response.status }));
      if (response.data?.verified !== true) {
        setExportAction("FAILED");
        setExportMessage(t("Verification returned without a verified result. Retry verification against the frozen manifest."));
        return;
      }
      if (attemptNeedsVerification) {
        updateExportWriteAttempt({ ...activeAttempt!, outcome: "verified" });
        setExportWriteUncertain(false);
      } else if (exportWriteUncertain && exportManifest?.target?.trim() === destination) setExportWriteUncertain(false);
      setExportAction("SUCCEEDED");
      setExportMessage(t("Export verification passed against the frozen manifest."));
    } catch (error) {
      if (exportRequestRef.current !== request || (attemptNeedsVerification && activeAttempt!.workspaceID !== currentWorkspaceRef.current)) return;
      setExportAction("FAILED");
      setExportMessage(error instanceof Error ? error.message : t("Export verification failed."));
    }
  }
  // Frozen manifests are durable catalog records. The drawer reads export
  // history back from the daemon instead of caching it in the browser.
  async function loadExportHistory() {
    const requestWorkspaceID = workspaceID;
    const requestWorkspaceGeneration = workspaceReadContextRef.current.generation;
    const requestID = ++exportHistoryReadRef.current;
    const isCurrentRead = () => exportHistoryReadRef.current === requestID
      && workspaceReadContextRef.current.workspaceID === requestWorkspaceID
      && workspaceReadContextRef.current.generation === requestWorkspaceGeneration
      && currentWorkspaceRef.current === requestWorkspaceID;
    setExportHistoryLoading(true); setExportHistoryError("");
    try {
      const response = await command(operations.export.list, {});
      if (!isCurrentRead()) return;
      if (response.status !== "SUCCEEDED" || !Array.isArray(response.data)) {
        setExportHistoryError(t("Export history is unavailable."));
        return;
      }
      setExportHistory(response.data as ExportManifestData[]);
    } catch (error) {
      if (!isCurrentRead()) return;
      setExportHistoryError(error instanceof Error ? error.message : t("Export history is unavailable."));
    } finally { if (isCurrentRead()) setExportHistoryLoading(false); }
  }
  // Choosing a stored view reuses the existing view export path: the view
  // becomes the live source and a manifest is frozen only on preview.
  function pickSavedViewForExport(view: SavedViewData) {
    if (!view?.view_id || isExportAttemptLocked()) return;
    exportRequestRef.current += 1;
    setExportMode("view"); setExportView(view); setExportManifestSource("planned"); setExportWriteUncertain(false);
    setExportHistoryReproductionReady(false); updateExportWriteAttempt(undefined);
    setExportManifest(undefined); setExportResult(undefined); setExportAction("IDLE");
    setExportMessage(t("Saved view selected as the export source. Preview a frozen manifest to freeze its current membership."));
  }
  function showRecallOutcome(outcome: RecallOutcome) {
    if (outcome.kind === "success") closeExport();
    else if (outcome.kind === "failure") {
      setExportAction("FAILED");
      setExportMessage(outcome.message);
    }
  }
  async function recallSavedView(view: SavedViewData) {
    showRecallOutcome(await savedViewsFlow.recallSavedView(view));
  }
  async function refreshRecalledView() {
    showRecallOutcome(await savedViewsFlow.refreshRecalledView());
  }
  function pickHistoryManifest(manifest: ExportManifestData) {
    if (!manifest?.manifest_id || !manifest?.manifest_digest || isExportAttemptLocked()) return;
    exportRequestRef.current += 1;
    setExportManifest(manifest);
    setExportManifestSource("history");
    setExportHistoryReproductionReady(false);
    updateExportWriteAttempt(undefined);
    setExportDestination(typeof manifest.target === "string" ? manifest.target : "");
    setExportPresetApplied(false);
    setExportWriteUncertain(false);
    setExportResult(undefined); setExportAction("IDLE");
    setExportMessage(t("Frozen manifest loaded from history. Verify it against its destination; verification never writes files again."));
  }
  function beginHistoryReproduction() {
    if (exportManifestSource !== "history" || !exportManifest?.manifest_id || !exportManifest.manifest_digest || isExportAttemptLocked()) return;
    exportRequestRef.current += 1;
    updateExportWriteAttempt(undefined);
    setExportHistoryReproductionReady(true);
    setExportDestination("");
    setExportResult(undefined);
    setExportWriteUncertain(false);
    setExportAction("IDLE");
    setExportMessage(t("Choose a new empty server directory. The frozen files, names, sidecar policy, and recorded target stay unchanged."));
  }
  // A search changes what a "last submitted query" export would freeze, so the
  // drawer's frozen unit is discarded with an explicit reason instead of
  // silently describing a membership that no longer matches the query.
  //
  // It also ends any recalled saved view. Recall re-issues the stored query
  // *and* its stored structured conditions; a search submitted from the input
  // text carries only the text, so the displayed results are no longer the
  // view's evaluation and the library caption and saved-retrieval preview must
  // stop describing them with that view's stored conditions. This clear is
  // deliberately independent of the export drawer's own state, because the
  // recalled projection is shown while the drawer is closed.
  function invalidateForSearch() {
    savedViewsFlow.invalidateForSearch();
    // A new search is a result the browser did produce, so the previous
    // recall's failure explanation no longer describes what is on screen.
    if (!exportOpen || isExportAttemptLocked()) return;
    exportRequestRef.current += 1;
    setExportManifest(undefined); setExportResult(undefined); setExportManifestSource("planned"); setExportWriteUncertain(false); setExportAction("IDLE");
    setExportMessage(t("Search changed. Preview a new frozen manifest."));
  }
  function resetExportProjection() {
    if (isExportAttemptLocked()) return;
    exportRequestRef.current += 1;
    setExportSelection([]);
    setExportManifest(undefined); setExportResult(undefined); setExportManifestSource("planned"); setExportWriteUncertain(false); setExportAction("IDLE"); setExportMessage("");
    setExportHistoryReproductionReady(false); updateExportWriteAttempt(undefined);
    savedViewsFlow.resetRecallProjection();
  }

  return {
    ...savedViewsFlow,
    exportMode,
    exportView,
    exportDestination,
    exportSidecars,
    exportPresetApplied,
    changeExportSidecars,
    exportManifest,
    exportManifestSource,
    exportResult,
    exportAction,
    exportMessage,
    exportWriteUncertain,
    exportVerificationOnly,
    exportHistoryReproductionReady,
    exportWriteAttempt,
    exportAttemptLocked,
    exportSelection,
    retrievalCandidate,
    exportHistory,
    exportHistoryLoading,
    exportHistoryError,
    canOpenExport,
    canExportSavedView,
    openExport,
    openSavedViewExport,
    recallSavedView,
    refreshRecalledView,
    closeExport,
    changeExportMode,
    changeExportDestination,
    previewExport,
    applyExport,
    verifyExport,
    loadExportHistory,
    pickSavedViewForExport,
    pickHistoryManifest,
    beginHistoryReproduction,
    invalidateForSearch,
    resetExportProjection,
  };
}
