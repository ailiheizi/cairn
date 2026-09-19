import { useRef, useState } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import type { LibraryDraftsFlow } from "./useLibraryDrafts";
import type { LibraryFlow } from "./useLibrary";
import type { SelectionFlow } from "./useSelection";
import type { ExportActionState, ExportManifestData, ExportManifestSource, ExportMode, Notice, RecalledView, SavedViewData, SearchHit, ViewMode } from "../lib/types";

// The export drawer.
//
// A frozen manifest is a durable catalog record: this flow plans, materializes
// once, and verifies against the same frozen digest. A manifest recalled from
// history may be verified again but is never written again.

export type ExportFlow = {
  exportMode: ExportMode;
  exportViewName: string;
  setViewName: (value: string) => void;
  exportView: any;
  exportDestination: string;
  exportSidecars: string;
  /** At least one field still holds the browser-local preset read on open. */
  exportPresetApplied: boolean;
  changeExportSidecars: (value: string) => void;
  exportManifest: ExportManifestData | undefined;
  exportManifestSource: ExportManifestSource;
  exportResult: any;
  exportAction: ExportActionState;
  exportMessage: string;
  exportSelection: SearchHit[];
  savedViews: SavedViewData[];
  savedViewsLoading: boolean;
  savedViewsError: string;
  exportHistory: ExportManifestData[];
  exportHistoryLoading: boolean;
  exportHistoryError: string;
  canOpenExport: boolean;
  recalledView: RecalledView | undefined;
  openExport: (trigger?: EventTarget | null, explicitSelection?: SearchHit[]) => void;
  closeExport: () => void;
  changeExportMode: (mode: ExportMode) => void;
  changeExportDestination: (value: string) => void;
  saveViewForExport: () => Promise<void>;
  previewExport: () => Promise<void>;
  applyExport: () => Promise<void>;
  verifyExport: () => Promise<void>;
  loadSavedViews: () => Promise<void>;
  loadExportHistory: () => Promise<void>;
  pickSavedViewForExport: (view: SavedViewData) => void;
  recallSavedView: (view: SavedViewData) => Promise<void>;
  pickHistoryManifest: (manifest: ExportManifestData) => void;
  invalidateForSearch: () => void;
  resetExportProjection: () => void;
};

// The flat content library is served as one unbounded projection, so a saved
// view recall asks for the same practical page size instead of silently
// truncating dynamic membership to a small default.
const libraryPageSize = 200;

// The export destination and sidecar choice this browser last used for one
// workspace. This is a convenience for this browser only, following the
// `restoreweave.*` recents prefix and its try/catch storage pattern: it is
// never a plan, a frozen manifest, a durable default, or recovery evidence.
// The manifest, the destination the daemon checks, and the written bytes stay
// with the daemon catalog. The key is scoped per workspace so one workspace's
// convenience never leaks into another's, and a missing or unreadable value
// pre-fills nothing rather than inventing a default.
const exportPresetPrefix = "restoreweave.export_preset.";
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

export function useExport({ t, workspaceID, isConnected, coreStorageReady, coreStorageMessage, exportOpen, viewMode, lastExecutedQuery, setQuery, setLastExecutedQuery, selected, setSelected, setViewMode, selection, library, drafts, setBusy, notify, canLeaveSettings, rememberDrawerTrigger, closeOtherDrawers, setExportOpen }: {
  t: Translator;
  workspaceID: string;
  isConnected: boolean;
  coreStorageReady: boolean;
  coreStorageMessage: string;
  exportOpen: boolean;
  viewMode: ViewMode;
  lastExecutedQuery: string;
  setQuery: (value: string) => void;
  setLastExecutedQuery: (value: string) => void;
  selected: SearchHit | undefined;
  setSelected: (hit: SearchHit | undefined) => void;
  setViewMode: (mode: ViewMode) => void;
  selection: SelectionFlow;
  library: LibraryFlow;
  drafts: LibraryDraftsFlow;
  setBusy: (value: boolean) => void;
  notify: (notice: Notice | undefined) => void;
  canLeaveSettings: () => boolean;
  rememberDrawerTrigger: (trigger?: EventTarget | null) => void;
  closeOtherDrawers: () => void;
  setExportOpen: (value: boolean) => void;
}): ExportFlow {
  const [exportSelection, setExportSelection] = useState<SearchHit[]>([]);
  const [exportMode, setExportMode] = useState<ExportMode>("selected");
  const [exportViewName, setExportViewName] = useState("");
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
  const [exportManifestSource, setExportManifestSource] = useState<ExportManifestSource>("planned");
  const [savedViews, setSavedViews] = useState<SavedViewData[]>([]);
  const [savedViewsLoading, setSavedViewsLoading] = useState(false);
  const [savedViewsError, setSavedViewsError] = useState("");
  const [exportHistory, setExportHistory] = useState<ExportManifestData[]>([]);
  const [exportHistoryLoading, setExportHistoryLoading] = useState(false);
  const [exportHistoryError, setExportHistoryError] = useState("");
  const [recalledView, setRecalledView] = useState<RecalledView>();
  const exportRequestRef = useRef(0);

  const canUseSearch = viewMode === "search" && Boolean(lastExecutedQuery.trim());
  // An explicit multi-selection is a stronger statement of intent than the
  // open details subject, so it becomes the frozen selection when present.
  const detailSelection = selected?.subject_ref?.trim() && selected.entry_type !== "DIRECTORY" ? [selected] : [];
  const canOpenExport = selection.selectionSubjects.length > 0 || detailSelection.length > 0 || canUseSearch;

  function openExport(trigger?: EventTarget | null, explicitSelection?: SearchHit[]) {
    const selectionForExport = explicitSelection && explicitSelection.length
      ? explicitSelection
      : detailSelection;
    if (!isConnected || !coreStorageReady || !workspaceID || (selectionForExport.length === 0 && !canUseSearch)) {
      notify({ kind: "error", text: coreStorageMessage });
      return;
    }
    if (!canLeaveSettings()) return;
    rememberDrawerTrigger(trigger);
    const nextMode: ExportMode = selectionForExport.length ? "selected" : "view";
    closeOtherDrawers();
    exportRequestRef.current += 1;
    // The prefill is the last destination and sidecar choice this browser used
    // in this workspace. It is a browser-local convenience, labelled as such in
    // the drawer; a cleared or never-set value stays empty instead of inventing
    // a default.
    const preset = readExportPreset(workspaceID);
    setExportSelection(selectionForExport);
    setExportMode(nextMode); setExportView(undefined); setExportManifest(undefined); setExportResult(undefined);
    setExportManifestSource("planned");
    setExportAction("IDLE"); setExportMessage(""); setExportDestination(preset.destination); setExportSidecars(preset.sidecars);
    setExportPresetApplied(Boolean(preset.destination || preset.sidecars));
    setExportViewName(lastExecutedQuery.trim() ? `Search · ${lastExecutedQuery.trim().slice(0, 48)}` : "My saved search");
    setExportOpen(true); notify(undefined);
    // Recalling a saved view and re-verifying a frozen manifest are the
    // durability surfaces of this drawer: both come from the daemon catalog,
    // never from browser state.
    void loadSavedViews();
    void loadExportHistory();
  }
  function closeExport() { exportRequestRef.current += 1; setExportOpen(false); setExportAction("IDLE"); setExportSelection([]); }
  function changeExportMode(nextMode: ExportMode) {
    if (nextMode === exportMode) return;
    exportRequestRef.current += 1;
    setExportMode(nextMode); setExportManifest(undefined); setExportResult(undefined); setExportAction("IDLE");
    setExportMessage(t("Export source changed. Preview a new frozen manifest."));
  }
  function changeExportDestination(value: string) {
    setExportDestination(value);
    // Editing either field ends the preset claim, so the drawer never labels a
    // value the operator has replaced as the stored browser default.
    setExportPresetApplied(false);
    // A manifest recalled from history is already frozen: the destination is
    // only the place a later verify reads, so editing it must not discard the
    // frozen unit. A planned manifest still describes a write to one target.
    if (exportManifestSource === "history" && exportManifest) return;
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
  async function saveViewForExport() {
    const name = exportViewName.trim();
    const submittedQuery = lastExecutedQuery.trim();
    if (!submittedQuery || !name) return;
    const request = ++exportRequestRef.current;
    setExportManifest(undefined); setExportResult(undefined);
    setExportAction("SAVING_VIEW"); setExportMessage("");
    try {
      const response = await command(operations.view.save, { name, query: submittedQuery });
      if (exportRequestRef.current !== request) return;
      setExportView(response.data);
      setExportMode("view");
      setExportAction("IDLE");
      setExportMessage(t("Query saved. The view remains dynamic until you freeze an export."));
      void loadSavedViews();
    } catch (error) {
      if (exportRequestRef.current !== request) return;
      setExportAction("FAILED");
      setExportMessage(error instanceof Error ? error.message : t("Could not save query"));
    }
  }
  async function previewExport() {
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
    if (!exportManifest?.manifest_id || !exportManifest.manifest_digest || !exportDestination.trim()) return;
    const request = ++exportRequestRef.current;
    setExportAction("APPLYING"); setExportMessage("");
    try {
      const applied = await command(operations.export.apply, { manifest_id: exportManifest.manifest_id, manifest_digest: exportManifest.manifest_digest, destination: exportDestination.trim() });
      if (exportRequestRef.current !== request) return;
      setExportResult({ applied: applied.data, materialized: true, status: applied.status });
      setExportAction("VERIFYING");
      try {
        const verified = await command(operations.export.verify, { manifest_id: exportManifest.manifest_id, manifest_digest: exportManifest.manifest_digest, destination: exportDestination.trim() });
        if (exportRequestRef.current !== request) return;
        setExportResult((current: any) => ({ ...current, verified: verified.data, status: verified.status }));
        if (verified.data?.verified !== true) {
          setExportAction("FAILED");
          setExportMessage(t("Verification returned without a verified result. Retry verification against the frozen manifest."));
          return;
        }
      } catch (error) {
        if (exportRequestRef.current !== request) return;
        setExportAction("FAILED");
        setExportMessage(`${t("Output was written, but verification failed. Retry verification against the same frozen manifest; do not materialize again.")} ${error instanceof Error ? error.message : ""}`.trim());
        return;
      }
      setExportAction("SUCCEEDED");
      setExportMessage(t("Export materialized and verified in the server directory."));
    } catch (error) {
      if (exportRequestRef.current !== request) return;
      setExportAction("FAILED");
      setExportMessage(error instanceof Error ? error.message : t("Export failed; no verified output claim was made."));
    }
  }
  async function verifyExport() {
    if (!exportManifest?.manifest_id || !exportManifest.manifest_digest || !exportDestination.trim()) return;
    const request = ++exportRequestRef.current;
    setExportAction("VERIFYING"); setExportMessage("");
    try {
      const response = await command(operations.export.verify, { manifest_id: exportManifest.manifest_id, manifest_digest: exportManifest.manifest_digest, destination: exportDestination.trim() });
      if (exportRequestRef.current !== request) return;
      setExportResult((current: any) => ({ ...current, verified: response.data, status: response.status }));
      if (response.data?.verified !== true) {
        setExportAction("FAILED");
        setExportMessage(t("Verification returned without a verified result. Retry verification against the frozen manifest."));
        return;
      }
      setExportAction("SUCCEEDED");
      setExportMessage(t("Export verification passed against the frozen manifest."));
    } catch (error) {
      if (exportRequestRef.current !== request) return;
      setExportAction("FAILED");
      setExportMessage(error instanceof Error ? error.message : t("Export verification failed."));
    }
  }
  // Saved views and frozen manifests are durable catalog records. The drawer
  // reads them back from the daemon instead of caching them in the browser, so
  // a reload or a second browser sees the same organization.
  async function loadSavedViews() {
    setSavedViewsLoading(true); setSavedViewsError("");
    try {
      const response = await command(operations.view.list, {});
      setSavedViews(Array.isArray(response.data) ? (response.data as SavedViewData[]) : []);
    } catch (error) {
      setSavedViews([]);
      setSavedViewsError(error instanceof Error ? error.message : t("Saved views are unavailable."));
    } finally { setSavedViewsLoading(false); }
  }
  async function loadExportHistory() {
    setExportHistoryLoading(true); setExportHistoryError("");
    try {
      const response = await command(operations.export.list, {});
      setExportHistory(Array.isArray(response.data) ? (response.data as ExportManifestData[]) : []);
    } catch (error) {
      setExportHistory([]);
      setExportHistoryError(error instanceof Error ? error.message : t("Export history is unavailable."));
    } finally { setExportHistoryLoading(false); }
  }
  // Choosing a stored view reuses the existing view export path: the view
  // becomes the live source and a manifest is frozen only on preview.
  function pickSavedViewForExport(view: SavedViewData) {
    if (!view?.view_id) return;
    exportRequestRef.current += 1;
    setExportMode("view"); setExportView(view); setExportViewName(view.name || "");
    setExportManifest(undefined); setExportResult(undefined); setExportAction("IDLE");
    setExportMessage(t("Saved view selected as the export source. Preview a frozen manifest to freeze its current membership."));
  }
  async function recallSavedView(view: SavedViewData) {
    const viewID = view?.view_id?.trim() ?? "";
    if (!viewID) return;
    setBusy(true); notify(undefined);
    try {
      // Re-read the durable revision before evaluating: the listed row may
      // predate a successor revision, and the library caption must describe
      // the view that was actually evaluated.
      const current = await command(operations.view.get, { view_id: viewID });
      const resolved = ((current.data ?? view) ?? {}) as SavedViewData;
      const evaluation = await command(operations.view.evaluate, { view_id: viewID, limit: libraryPageSize });
      const evaluatedHits = ((evaluation.data?.hits ?? []) as SearchHit[]);
      const viewQuery = resolved.query?.trim() ?? "";
      const statusBySubject = new Map(library.libraryItems.map((item) => [item.subject_ref, item.index_status]));
      drafts.discardDetailDrafts();
      setQuery(viewQuery); setLastExecutedQuery(viewQuery);
      library.setHits(evaluatedHits.map((hit) => ({ ...hit, index_status: hit.index_status ?? statusBySubject.get(hit.subject_ref ?? "") })));
      setSelected(undefined); library.setActiveTags([]); library.setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" });
      setViewMode("search");
      const degradedReason = evaluation.status === "DEGRADED"
        ? (evaluation.reasons ?? []).map((item) => item.message?.trim()).filter((message): message is string => Boolean(message)).map((message) => t(message)).join("; ") || t("Search degradation reason was not reported.")
        : "";
      setRecalledView({
        view_id: viewID,
        name: resolved.name || t("Unnamed saved view"),
        revision: Number(resolved.revision ?? 0),
        query: viewQuery,
        state: evaluation.status === "DEGRADED" ? "DEGRADED" : evaluatedHits.length === 0 ? "EMPTY" : "READY",
        message: degradedReason
          ? t("Saved view evaluation is degraded: {{reason}}", { reason: degradedReason })
          : evaluatedHits.length === 0
            ? t("This saved view currently matches no content.")
            : "",
      });
      // The recalled hits render in the library, so the drawer has delivered
      // its result and closes instead of covering the result list.
      closeExport();
    } catch (error) {
      setExportAction("FAILED");
      setExportMessage(error instanceof Error ? error.message : t("Could not evaluate this saved view."));
    } finally { setBusy(false); }
  }
  function pickHistoryManifest(manifest: ExportManifestData) {
    if (!manifest?.manifest_id || !manifest?.manifest_digest) return;
    exportRequestRef.current += 1;
    setExportManifest(manifest);
    setExportManifestSource("history");
    setExportResult(undefined); setExportAction("IDLE");
    setExportMessage(t("Frozen manifest loaded from history. Verify it against its destination; verification never writes files again."));
  }
  // A search changes what a "last submitted query" export would freeze, so the
  // drawer's frozen unit is discarded with an explicit reason instead of
  // silently describing a membership that no longer matches the query.
  function invalidateForSearch() {
    if (!exportOpen) return;
    exportRequestRef.current += 1;
    setExportManifest(undefined); setExportResult(undefined); setExportAction("IDLE");
    setExportMessage(t("Search changed. Preview a new frozen manifest."));
  }
  function resetExportProjection() {
    exportRequestRef.current += 1;
    setExportSelection([]);
    setExportManifest(undefined); setExportResult(undefined); setExportAction("IDLE"); setExportMessage("");
    setRecalledView(undefined);
  }

  return {
    exportMode,
    exportViewName,
    setViewName: setExportViewName,
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
    exportSelection,
    savedViews,
    savedViewsLoading,
    savedViewsError,
    exportHistory,
    exportHistoryLoading,
    exportHistoryError,
    canOpenExport,
    recalledView,
    openExport,
    closeExport,
    changeExportMode,
    changeExportDestination,
    saveViewForExport,
    previewExport,
    applyExport,
    verifyExport,
    loadSavedViews,
    loadExportHistory,
    pickSavedViewForExport,
    recallSavedView,
    pickHistoryManifest,
    invalidateForSearch,
    resetExportProjection,
  };
}
