import { useEffect, useRef, useState } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import { resolveArchiveSelectionSizes } from "../lib/originalArchive";
import { editableSavedRetrieval, savedRetrievalRecordFingerprint } from "../lib/savedRetrievalEdit";
import { readSavedViewPage, type SavedViewPage } from "../lib/savedViewPages";
import type { FailedRecall, Notice, RecalledView, RecalledViewState, SavedViewData, SearchHit, SystemFacetState, ViewMode } from "../lib/types";

// Saved query records and their current browser projection. The export
// coordinator consumes recall outcomes; this hook never owns an export write.
export type RecallOutcome = { kind: "success" } | { kind: "failure"; message: string } | { kind: "stale" };

export type SavedViewsFlow = {
  savedViews: SavedViewData[];
  /** True only after a complete successful view.list response in this workspace. */
  savedViewsLoaded: boolean;
  savedViewsLoading: boolean;
  savedViewsError: string;
  savedRetrievalSaving: boolean;
  savedRetrievalMessage: string;
  savedRetrievalError: boolean;
  recalledView: RecalledViewState | undefined;
  failedRecall: FailedRecall | undefined;
  saveSavedRetrievalView: (name: string, query: string, fields: string[], unsupportedConditions: string[], replacing?: SavedViewData, copyingFrom?: SavedViewData) => Promise<SavedViewData | undefined>;
  loadSavedViews: () => Promise<void>;
  loadSavedRetrievalForEdit: (view: SavedViewData) => Promise<SavedViewData | undefined>;
  recallSavedView: (view: SavedViewData, acceptRecall?: () => boolean) => Promise<RecallOutcome>;
  continueRecalledViewPage: () => Promise<void>;
  refreshRecalledView: () => Promise<RecallOutcome>;
  invalidateForSearch: () => void;
  resetRecallProjection: () => void;
};

function normalizedSavedViewFields(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((field) => typeof field !== "string")) return undefined;
  return [...new Set(value.map((field) => field.trim()).filter(Boolean))].sort();
}

type SavedViewRecallChain = {
  viewID: string;
  revision: number;
  query: string;
  storedWorkspaceID: string;
  openWorkspaceID: string;
  generationRef: string;
  projectionRef: string;
  total: number;
  token: string;
  loaded: number;
  subjects: Set<string>;
  searchIntent: number;
  phase: "more" | "paging" | "complete" | "stale";
};

const libraryPageSize = 200;

type SavedViewsLibrary = {
  hits: SearchHit[];
  beginSearchIntent: (workspaceID: string) => number;
  isCurrentSearchIntent: (intent: number, workspaceID: string) => boolean;
  hasCurrentSearchIntent: (workspaceID: string) => boolean;
  currentLibraryItems: (workspaceID: string) => SearchHit[];
  setHits: (value: SearchHit[] | ((current: SearchHit[]) => SearchHit[])) => void;
  setActiveTags: (value: string[]) => void;
  setActiveSystemFacets: (value: SystemFacetState) => void;
  setActiveTimelineMonth: (value: string) => void;
};

type SavedViewsSelection = { clearSelection: () => void };
type SavedViewsDrafts = { discardDetailDrafts: () => void };

export function useSavedViews({ t, workspaceID, viewMode, lastExecutedQuery, library, selection, drafts, setQuery, setLastExecutedQuery, setSelected, setViewMode, setBusy, notify, canLeaveSettings, canLeaveDetailDrafts }: {
  t: Translator;
  workspaceID: string;
  viewMode: ViewMode;
  lastExecutedQuery: string;
  library: SavedViewsLibrary;
  selection: SavedViewsSelection;
  drafts: SavedViewsDrafts;
  setQuery: (value: string) => void;
  setLastExecutedQuery: (value: string) => void;
  setSelected: (hit: SearchHit | undefined) => void;
  setViewMode: (mode: ViewMode) => void;
  setBusy: (value: boolean) => void;
  notify: (notice: Notice | undefined) => void;
  canLeaveSettings: () => boolean;
  canLeaveDetailDrafts: () => boolean;
}): SavedViewsFlow {
  const [savedViews, setSavedViews] = useState<SavedViewData[]>([]);
  const [savedViewsLoaded, setSavedViewsLoaded] = useState(false);
  const [savedViewsLoading, setSavedViewsLoading] = useState(false);
  const [savedViewsError, setSavedViewsError] = useState("");
  const [savedRetrievalSaving, setSavedRetrievalSaving] = useState(false);
  const [savedRetrievalMessage, setSavedRetrievalMessage] = useState("");
  const [savedRetrievalError, setSavedRetrievalError] = useState(false);
  const [recalledView, setRecalledView] = useState<RecalledViewState>();
  const [failedRecall, setFailedRecall] = useState<FailedRecall>();
  const recallRequestRef = useRef(0);
  const recalledPageRequestRef = useRef(0);
  const recalledPageChainRef = useRef<SavedViewRecallChain | null>(null);
  const savedViewsReadRef = useRef(0);
  const savedViewEditReadRef = useRef(0);
  const workspaceReadContextRef = useRef({ workspaceID, generation: 0 });
  if (workspaceReadContextRef.current.workspaceID !== workspaceID) {
    workspaceReadContextRef.current = { workspaceID, generation: workspaceReadContextRef.current.generation + 1 };
    savedViewsReadRef.current += 1;
    savedViewEditReadRef.current += 1;
  }
  const currentWorkspaceRef = useRef(workspaceID);
  currentWorkspaceRef.current = workspaceID;
  const currentViewModeRef = useRef(viewMode);
  currentViewModeRef.current = viewMode;
  const currentLastExecutedQueryRef = useRef(lastExecutedQuery);
  currentLastExecutedQueryRef.current = lastExecutedQuery;
  const currentRecalledViewRef = useRef(recalledView);
  currentRecalledViewRef.current = recalledView;
  const currentDisplayedHitsRef = useRef(library.hits);
  currentDisplayedHitsRef.current = library.hits;

  useEffect(() => {
    setSavedViews([]);
    setSavedViewsLoaded(false);
    setSavedViewsLoading(false);
    setSavedViewsError("");
    setSavedRetrievalSaving(false);
    setSavedRetrievalMessage("");
    setSavedRetrievalError(false);
    setRecalledView(undefined);
    recalledPageChainRef.current = null;
    recalledPageRequestRef.current += 1;
    setFailedRecall(undefined);
  }, [workspaceID, t]);

  function invalidateForSearch() {
    setRecalledView(undefined);
    recalledPageChainRef.current = null;
    recalledPageRequestRef.current += 1;
    setFailedRecall(undefined);
  }

  function resetRecallProjection() {
    setRecalledView(undefined);
    recalledPageChainRef.current = null;
    recalledPageRequestRef.current += 1;
  }

  async function loadSavedRetrievalForEdit(view: SavedViewData): Promise<SavedViewData | undefined> {
    const requestWorkspaceID = workspaceID;
    const listed = savedViews.find((item) => item.view_id === view.view_id);
    const listedFingerprint = listed ? savedRetrievalRecordFingerprint(listed) : "";
    if (!requestWorkspaceID || !savedViewsLoaded || savedViewsLoading || savedViewsError || savedRetrievalSaving
      || !listed || listedFingerprint !== savedRetrievalRecordFingerprint(view)) {
      setSavedRetrievalMessage(t("Refresh saved views before editing this retrieval."));
      setSavedRetrievalError(true);
      return undefined;
    }
    const requestID = ++savedViewEditReadRef.current;
    setSavedRetrievalSaving(true);
    setSavedRetrievalMessage("");
    setSavedRetrievalError(false);
    try {
      const response = await command(operations.view.get, { view_id: view.view_id });
      if (savedViewEditReadRef.current !== requestID || currentWorkspaceRef.current !== requestWorkspaceID) return undefined;
      const current = response.data as SavedViewData | undefined;
      if (response.status !== "SUCCEEDED" || !current
        || savedRetrievalRecordFingerprint(current) !== listedFingerprint) {
        throw new Error(t("This saved view changed or could not be confirmed. Refresh the list before editing."));
      }
      if (!editableSavedRetrieval(current, requestWorkspaceID)) {
        throw new Error(t("This saved view contains a scope, condition, query, or policy this editor cannot safely preserve."));
      }
      return current;
    } catch (error) {
      if (savedViewEditReadRef.current !== requestID || currentWorkspaceRef.current !== requestWorkspaceID) return undefined;
      setSavedRetrievalMessage(error instanceof Error ? error.message : t("Could not load this saved view for editing."));
      setSavedRetrievalError(true);
      return undefined;
    } finally {
      if (savedViewEditReadRef.current === requestID && currentWorkspaceRef.current === requestWorkspaceID) setSavedRetrievalSaving(false);
    }
  }

  // Save only the submitted query and supported field constraints. A success
  // means the daemon returned the exact saved record, not merely an OK status.
  async function saveSavedRetrievalView(name: string, query: string, fields: string[], unsupportedConditions: string[], replacing?: SavedViewData, copyingFrom?: SavedViewData): Promise<SavedViewData | undefined> {
    const requestWorkspaceID = workspaceID;
    const savedName = name.trim();
    const savedQuery = query.trim();
    const savedFields = [...new Set(fields.map((field) => field.trim()).filter(Boolean))].sort();
    if (!savedName || (!savedQuery && savedFields.length === 0) || unsupportedConditions.length > 0 || !workspaceID || savedRetrievalSaving || (replacing && copyingFrom)) return undefined;
    if (!savedViewsLoaded || savedViewsLoading || savedViewsError) {
      setSavedRetrievalMessage(t("Refresh saved views before saving, so an existing name is not overwritten unknowingly."));
      setSavedRetrievalError(true);
      return undefined;
    }
    const sameName = savedViews.find((view) => view.name?.trim() === savedName);
    const sourceView = replacing ?? copyingFrom;
    const listedSource = sourceView && savedViews.find((view) => view.view_id === sourceView.view_id);
    if ((sameName && (!replacing?.view_id || !Number.isFinite(replacing.revision) || sameName.view_id !== replacing.view_id || sameName.revision !== replacing.revision))
      || (!sameName && replacing)
      || (copyingFrom && (sameName || !listedSource || savedRetrievalRecordFingerprint(listedSource) !== savedRetrievalRecordFingerprint(copyingFrom)))) {
      setSavedRetrievalMessage(t("Saved views changed or could not be confirmed. Refresh the list before saving."));
      setSavedRetrievalError(true);
      return undefined;
    }
    setSavedRetrievalSaving(true);
    setSavedRetrievalMessage("");
    setSavedRetrievalError(false);
    try {
      let existingView = sourceView;
      if (copyingFrom) {
        // `view.save` is an upsert keyed by name, so re-read the list directly
        // before a copy to avoid replacing a name that appeared after the UI
        // was opened. The daemon remains the authority for the final write.
        const latestList = await command(operations.view.list, {});
        if (currentWorkspaceRef.current !== requestWorkspaceID) return undefined;
        if (latestList.status !== "SUCCEEDED" || !Array.isArray(latestList.data)) {
          throw new Error(t("Saved views could not be confirmed. Refresh the list before copying."));
        }
        const latestViews = latestList.data as SavedViewData[];
        if (latestViews.some((view) => view.name?.trim() === savedName)) {
          throw new Error(t("A saved view already uses this name. Choose a different name."));
        }
        const latestSource = latestViews.find((view) => view.view_id === copyingFrom.view_id);
        if (!latestSource || savedRetrievalRecordFingerprint(latestSource) !== savedRetrievalRecordFingerprint(copyingFrom)) {
          throw new Error(t("This saved view changed after confirmation. Refresh the list and review the copy again."));
        }
      }
      if (sourceView?.view_id) {
        // Confirm that the listed revision is still current before advancing
        // it, and use the current policy fields as the successor base. This
        // is a read-before-write check, not a concurrency/CAS guarantee.
        const expectedSourceFingerprint = savedRetrievalRecordFingerprint(sourceView);
        const current = await command(operations.view.get, { view_id: sourceView.view_id });
        if (currentWorkspaceRef.current !== requestWorkspaceID) return undefined;
        const resolved = current.data as SavedViewData | undefined;
        if (current.status !== "SUCCEEDED" || !resolved
          || savedRetrievalRecordFingerprint(resolved) !== expectedSourceFingerprint
          || !editableSavedRetrieval(resolved, requestWorkspaceID)
          || (replacing && resolved.name?.trim() !== savedName)
          || (copyingFrom && resolved.scope !== requestWorkspaceID)) {
          throw new Error(t("This saved view changed after confirmation. Refresh the list and review the update again."));
        }
        existingView = resolved;
      }
      const targetScope = existingView?.scope ?? requestWorkspaceID;
      const response = await command(operations.view.save, {
        name: savedName,
        query: savedQuery,
        scope: targetScope,
        fields: savedFields,
        // This narrow same-name update changes retrieval conditions while
        // retaining the existing export strategy and capability policy.
        sort: existingView?.sort ?? "",
        output_names: existingView?.output_names ?? "",
        required_capabilities: [...(existingView?.required_capabilities ?? [])],
        when_missing: existingView?.when_missing ?? "",
      });
      if (currentWorkspaceRef.current !== requestWorkspaceID) return undefined;
      const saved = response.data as SavedViewData | undefined;
      const returnedFields = normalizedSavedViewFields(saved?.fields);
      const fieldsMatch = Boolean(returnedFields)
        && returnedFields!.length === savedFields.length
        && returnedFields!.every((field, index) => field === savedFields[index]);
      const expectedRequired = existingView?.required_capabilities ?? [];
      const requiredWellFormed = saved?.required_capabilities === undefined
        || (Array.isArray(saved.required_capabilities) && saved.required_capabilities.every((value) => typeof value === "string"));
      const returnedRequired = Array.isArray(saved?.required_capabilities) ? saved.required_capabilities : [];
      const responsePolicy = (value: unknown) => value === undefined ? "" : typeof value === "string" ? value : undefined;
      const policiesMatch = responsePolicy(saved?.sort) === (existingView?.sort ?? "")
        && responsePolicy(saved?.output_names) === (existingView?.output_names ?? "")
        && responsePolicy(saved?.when_missing) === (existingView?.when_missing ?? "")
        && JSON.stringify(returnedRequired) === JSON.stringify(expectedRequired);
      if (response.status !== "SUCCEEDED"
        || !saved?.view_id?.trim()
        || saved.name !== savedName
        || saved.query !== savedQuery
        || !fieldsMatch
        || !requiredWellFormed
        || !policiesMatch
        || saved.scope !== targetScope
        || !Number.isSafeInteger(saved.revision)
        || (saved.revision ?? 0) < 1
        || (replacing && (saved.view_id !== replacing.view_id || (saved.revision ?? 0) <= (replacing.revision ?? 0)))
        || (copyingFrom && (saved.view_id === copyingFrom.view_id || saved.revision !== 1))) {
        throw new Error(t("The saved view response did not confirm the requested name, conditions, scope, policies, and revision."));
      }
      setSavedRetrievalMessage(t(replacing
        ? "Saved view updated. It will be evaluated against current lexical results and saved filters when opened."
        : copyingFrom
          ? "A new saved view copy was created. Its content scope and supported policies were retained."
          : "Saved view saved. It will be evaluated against current lexical results and saved filters when opened."));
      await loadSavedViews();
      if (currentWorkspaceRef.current !== requestWorkspaceID) return undefined;
      return saved;
    } catch (error) {
      if (currentWorkspaceRef.current !== requestWorkspaceID) return undefined;
      setSavedRetrievalMessage(error instanceof Error ? error.message : t("Could not save this view."));
      setSavedRetrievalError(true);
      return undefined;
    } finally {
      if (currentWorkspaceRef.current === requestWorkspaceID) setSavedRetrievalSaving(false);
    }
  }
  async function loadSavedViews() {
    const requestWorkspaceID = workspaceID;
    const requestWorkspaceGeneration = workspaceReadContextRef.current.generation;
    const requestID = ++savedViewsReadRef.current;
    const isCurrentRead = () => savedViewsReadRef.current === requestID
      && workspaceReadContextRef.current.workspaceID === requestWorkspaceID
      && workspaceReadContextRef.current.generation === requestWorkspaceGeneration
      && currentWorkspaceRef.current === requestWorkspaceID;
    setSavedViewsLoading(true); setSavedViewsError("");
    try {
      const response = await command(operations.view.list, {});
      if (!isCurrentRead()) return;
      if (response.status !== "SUCCEEDED" || !Array.isArray(response.data)) {
        setSavedViews([]);
        setSavedViewsLoaded(false);
        setSavedViewsError(t("Saved views could not be confirmed. Refresh the list before saving."));
        return;
      }
      setSavedViews(Array.isArray(response.data) ? (response.data as SavedViewData[]) : []);
      setSavedViewsLoaded(true);
    } catch (error) {
      if (!isCurrentRead()) return;
      setSavedViews([]);
      setSavedViewsLoaded(false);
      setSavedViewsError(error instanceof Error ? error.message : t("Saved views are unavailable."));
    } finally { if (isCurrentRead()) setSavedViewsLoading(false); }
  }
  async function recallSavedView(view: SavedViewData, acceptRecall?: () => boolean): Promise<RecallOutcome> {
    const viewID = view?.view_id?.trim() ?? "";
    if (!viewID) return { kind: "stale" };
    if (!canLeaveSettings() || !canLeaveDetailDrafts()) return { kind: "stale" };
    const requestWorkspaceID = workspaceID;
    const searchIntent = library.beginSearchIntent(requestWorkspaceID);
    const request = ++recallRequestRef.current;
    recalledPageChainRef.current = null;
    recalledPageRequestRef.current += 1;
    // The listed name is what the operator asked to open. It is the honest
    // label if resolution or evaluation fails before a resolved name exists.
    const requestedName = view.name?.trim() || t("Unnamed saved view");
    // Whether the library was actually displaying a recalled view's hits: only
    // then does a failure have stale results to retract, and only then does the
    // failure surface need to replace them. The test matches the library's own
    // "recalled view is active" test: the same view, in the search view, with
    // the query it was recalled with.
    const retractsDisplayedResults = Boolean(recalledView && viewMode === "search" && lastExecutedQuery === recalledView.query);
    // No older view may stay described as "live" or "opened" while this
    // request is in flight, and a failure below must not resurrect that claim.
    setRecalledView(undefined);
    setFailedRecall(undefined);
    setBusy(true); setSavedRetrievalMessage(""); setSavedRetrievalError(false); notify(undefined);
    try {
      // Re-read the durable revision before evaluating: the listed row may
      // predate a successor revision, and the library caption must describe
      // the view that was actually evaluated.
      const current = await command(operations.view.get, { view_id: viewID });
      if (currentWorkspaceRef.current !== requestWorkspaceID || !library.isCurrentSearchIntent(searchIntent, requestWorkspaceID) || (acceptRecall && !acceptRecall())) return { kind: "stale" };
      const resolved = current.data as SavedViewData | undefined;
      const fieldsAreValid = resolved?.fields === undefined
        || (Array.isArray(resolved.fields) && resolved.fields.every((field) => typeof field === "string"));
      const scopeIsValid = resolved?.scope === undefined || typeof resolved.scope === "string";
      if (current.status !== "SUCCEEDED"
        || !resolved
        || resolved.view_id?.trim() !== viewID
        || !resolved.name?.trim()
        || typeof resolved.query !== "string"
        || !scopeIsValid
        || !fieldsAreValid
        || !Number.isSafeInteger(resolved.revision)
        || (resolved.revision ?? 0) < 1) {
        throw new Error(t("Could not evaluate this saved view."));
      }
      // view.evaluate resolves its workspace from the stored record, not from
      // the workspace this browser has open. Comparing the two is the only way
      // this client can tell the operator that the hits below came from a
      // different saved scope instead of the library they are looking at.
      const storedScope = resolved.scope?.trim() ?? "";
      const evaluation = await command(operations.view.evaluate, { view_id: viewID, page: { limit: libraryPageSize } });
      if (recallRequestRef.current !== request || currentWorkspaceRef.current !== requestWorkspaceID || !library.isCurrentSearchIntent(searchIntent, requestWorkspaceID) || (acceptRecall && !acceptRecall())) return { kind: "stale" };
      const evaluationData = evaluation.data as Record<string, unknown> | undefined;
      if ((evaluation.status !== "SUCCEEDED" && evaluation.status !== "DEGRADED")
        || !evaluationData) {
        if (evaluation.status === "DEGRADED") {
          const reason = evaluation.reasons?.map((item) => item.message?.trim()).filter((message): message is string => Boolean(message)).map((message) => t(message)).join("; ") || t("Search degradation reason was not reported.");
          throw new Error(t("Saved view evaluation is degraded, but its result page could not be confirmed: {{reason}}", { reason }));
        }
        throw new Error(t("Could not evaluate this saved view."));
      }
      const viewQuery = resolved.query;
      const degradedReason = evaluation.status === "DEGRADED"
        ? (evaluation.reasons ?? []).map((item) => item.message?.trim()).filter((message): message is string => Boolean(message)).map((message) => t(message)).join("; ") || t("Search degradation reason was not reported.")
        : "";
      let firstPage: SavedViewPage;
      try {
        firstPage = readSavedViewPage(evaluationData, {
          viewID,
          revision: resolved.revision!,
          query: viewQuery,
          ...(storedScope ? { expectedWorkspaceID: storedScope } : {}),
          limit: libraryPageSize,
          loadedBefore: 0,
          seenSubjects: new Set(),
        });
      } catch (error) {
        if (evaluation.status !== "DEGRADED") throw error;
        const pageReason = error instanceof Error ? t(error.message) : t("The saved view page did not match the current bounded result scope. Reopen it to refresh the results.");
        throw new Error(t("Saved view evaluation is degraded, but its result page could not be confirmed: {{reason}}", { reason: `${degradedReason} ${pageReason}`.trim() }));
      }
      if (recallRequestRef.current !== request || currentWorkspaceRef.current !== requestWorkspaceID || !library.isCurrentSearchIntent(searchIntent, requestWorkspaceID) || (acceptRecall && !acceptRecall())) return { kind: "stale" };
      const evaluatedHits = firstPage.hits;
      const sameWorkspace = firstPage.workspaceID === requestWorkspaceID;
      const loadedItems = sameWorkspace ? library.currentLibraryItems(requestWorkspaceID) : [];
      const statusBySubject = new Map(loadedItems.map((item) => [item.subject_ref, item.index_status]));
      const recalledHits = resolveArchiveSelectionSizes(evaluatedHits, loadedItems);
      drafts.discardDetailDrafts();
      setQuery(viewQuery); setLastExecutedQuery(viewQuery);
      library.setHits(recalledHits.map((hit) => ({ ...hit, index_status: hit.index_status ?? statusBySubject.get(hit.subject_ref ?? "") })));
      setSelected(undefined); selection.clearSelection(); library.setActiveTags([]); library.setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); library.setActiveTimelineMonth("");
      setViewMode("search");
      setRecalledView({
        view_id: viewID,
        name: resolved.name || t("Unnamed saved view"),
        revision: Number(resolved.revision ?? 0),
        query: viewQuery,
        fields: [...(resolved.fields ?? [])],
        loadedCount: evaluatedHits.length,
        totalCount: firstPage.total,
        // The daemon's explicit page completeness and total govern continuation;
        // a client-side page size alone never implies more results.
        mayHaveMore: firstPage.hasMore,
        pageState: firstPage.hasMore ? "more" : "complete",
        foreignScope: firstPage.workspaceID !== requestWorkspaceID,
        state: evaluation.status === "DEGRADED" ? "DEGRADED" : evaluatedHits.length === 0 ? "EMPTY" : "READY",
        message: degradedReason
          ? t("Saved view evaluation is degraded: {{reason}}", { reason: degradedReason })
          : evaluatedHits.length === 0
            ? t("This saved view currently matches no content.")
            : "",
      });
      recalledPageChainRef.current = {
        viewID,
        revision: firstPage.revision,
        query: firstPage.query,
        storedWorkspaceID: firstPage.workspaceID,
        openWorkspaceID: requestWorkspaceID,
        generationRef: firstPage.generationRef,
        projectionRef: firstPage.projectionRef,
        total: firstPage.total,
        token: firstPage.token,
        loaded: firstPage.hits.length,
        subjects: new Set(firstPage.hits.map((hit) => hit.subject_ref!.trim())),
        searchIntent,
        phase: firstPage.hasMore ? "more" : "complete",
      };
      // The caller closes the export drawer after the library result is committed.
      return { kind: "success" };
    } catch (error) {
      if (currentWorkspaceRef.current !== requestWorkspaceID || !library.isCurrentSearchIntent(searchIntent, requestWorkspaceID) || (acceptRecall && !acceptRecall())) return { kind: "stale" };
      const message = error instanceof Error ? t(error.message) : t("Could not evaluate this saved view.");
      // A refused view has no membership to show. Drop the recalled projection,
      // and when the library was actually displaying a previous view's hits,
      // drop those too so neither the earlier view's "opened"/"live" claim nor
      // its rows can be read as this view's outcome. A failure that retracted
      // nothing keeps its explanation in the saved-retrieval panel only.
      setRecalledView(undefined);
      if (retractsDisplayedResults && currentViewModeRef.current === "search") {
        library.setHits([]);
        setFailedRecall({ name: requestedName, message });
      }
      setSavedRetrievalMessage(message);
      setSavedRetrievalError(true);
      return { kind: "failure", message };
    } finally {
      // Workspace changes suppress stale data writes, but must not strand the
      // busy flag this request acquired. A request token keeps an older recall
      // from releasing a newer recall's busy state.
      if (recallRequestRef.current === request
        && (!library.hasCurrentSearchIntent(requestWorkspaceID) || library.isCurrentSearchIntent(searchIntent, requestWorkspaceID))) setBusy(false);
    }
  }
  function recallChainIsCurrent(chain: SavedViewRecallChain) {
    const currentView = currentRecalledViewRef.current;
    const displayedSubjects = currentDisplayedHitsRef.current.map((hit) => hit.subject_ref?.trim() ?? "");
    const expectedSubjects = [...chain.subjects];
    return recalledPageChainRef.current === chain
      && currentWorkspaceRef.current === chain.openWorkspaceID
      && currentViewModeRef.current === "search"
      && currentLastExecutedQueryRef.current === chain.query
      && currentView?.view_id === chain.viewID
      && currentView.revision === chain.revision
      && currentView.pageState !== "stale"
      && library.isCurrentSearchIntent(chain.searchIntent, chain.openWorkspaceID)
      && displayedSubjects.length === chain.loaded
      && displayedSubjects.every((subject, index) => subject === expectedSubjects[index]);
  }
  async function continueRecalledViewPage() {
    const chain = recalledPageChainRef.current;
    if (!chain || chain.phase !== "more" || !chain.token || !recallChainIsCurrent(chain)) return;
    const requestID = ++recalledPageRequestRef.current;
    const token = chain.token;
    chain.phase = "paging";
    setRecalledView((current) => current?.view_id === chain.viewID && current.revision === chain.revision
      ? { ...current, pageState: "paging" }
      : current);
    setBusy(true);
    setSavedRetrievalMessage(""); setSavedRetrievalError(false); notify(undefined);
    try {
      const response = await command(operations.view.evaluate, {
        view_id: chain.viewID,
        page: { limit: libraryPageSize, token },
      });
      if (requestID !== recalledPageRequestRef.current || !recallChainIsCurrent(chain)) return;
      if (response.status !== "SUCCEEDED" && response.status !== "DEGRADED") {
        throw new Error(t("The saved view continuation could not be confirmed. Reopen it to refresh the results."));
      }
      let page: SavedViewPage;
      try {
        page = readSavedViewPage(response.data, {
          viewID: chain.viewID,
          revision: chain.revision,
          query: chain.query,
          expectedWorkspaceID: chain.storedWorkspaceID,
          limit: libraryPageSize,
          loadedBefore: chain.loaded,
          totalBefore: chain.total,
          generationBefore: chain.generationRef,
          projectionBefore: chain.projectionRef,
          seenSubjects: chain.subjects,
          previousToken: token,
        });
      } catch (error) {
        if (response.status !== "DEGRADED") throw error;
        const daemonReason = response.reasons?.map((item) => item.message?.trim()).filter((message): message is string => Boolean(message)).map((message) => t(message)).join("; ") || t("Search degradation reason was not reported.");
        const pageReason = error instanceof Error ? t(error.message) : t("The saved view continuation could not be confirmed. Reopen it to refresh the results.");
        throw new Error(t("Saved view continuation is degraded and its next page was not confirmed: {{reason}}", { reason: `${daemonReason} ${pageReason}`.trim() }));
      }
      if (requestID !== recalledPageRequestRef.current || !recallChainIsCurrent(chain)) return;
      const items = page.workspaceID === chain.openWorkspaceID
        ? library.currentLibraryItems(chain.openWorkspaceID)
        : [];
      const statusBySubject = new Map(items.map((item) => [item.subject_ref, item.index_status]));
      const nextHits = resolveArchiveSelectionSizes(page.hits, items)
        .map((hit) => ({ ...hit, index_status: hit.index_status ?? statusBySubject.get(hit.subject_ref ?? "") }));
      library.setHits((current) => [...current, ...nextHits]);
      for (const hit of page.hits) chain.subjects.add(hit.subject_ref!.trim());
      chain.loaded += page.hits.length;
      chain.token = page.token;
      chain.phase = page.hasMore ? "more" : "complete";
      setRecalledView((current) => current?.view_id === chain.viewID && current.revision === chain.revision
        ? {
          ...current,
          loadedCount: chain.loaded,
          totalCount: chain.total,
          mayHaveMore: page.hasMore,
          pageState: page.hasMore ? "more" : "complete",
          state: current.state === "EMPTY" ? "READY" : current.state,
        }
        : current);
      if (response.status === "DEGRADED") {
        const reason = response.reasons?.map((item) => item.message?.trim()).filter((message): message is string => Boolean(message)).map((message) => t(message)).join("; ") || t("Search degradation reason was not reported.");
        setRecalledView((current) => current?.view_id === chain.viewID && current.revision === chain.revision
          ? { ...current, state: "DEGRADED", message: t("Saved view evaluation is degraded: {{reason}}", { reason }) }
          : current);
      }
    } catch (error) {
      if (requestID !== recalledPageRequestRef.current || !recallChainIsCurrent(chain)) return;
      const message = error instanceof Error ? t(error.message) : t("The saved view continuation could not be confirmed. Reopen it to refresh the results.");
      // A failed continuation cannot establish which membership is current.
      // Retract those rows instead of keeping them actionable under a stale view.
      chain.phase = "stale";
      chain.token = "";
      library.setHits([]);
      setRecalledView((current) => current?.view_id === chain.viewID && current.revision === chain.revision
        ? { ...current, loadedCount: 0, totalCount: undefined, mayHaveMore: false, pageState: "stale", message }
        : current);
      setSavedRetrievalMessage(message); setSavedRetrievalError(true);
    } finally {
      if (requestID === recalledPageRequestRef.current
        && recalledPageChainRef.current === chain
        && !library.isCurrentSearchIntent(chain.searchIntent, chain.openWorkspaceID)) {
        chain.phase = "stale";
        chain.token = "";
        const stillDisplayed = currentWorkspaceRef.current === chain.openWorkspaceID
          && currentViewModeRef.current === "search"
          && currentLastExecutedQueryRef.current === chain.query
          && currentRecalledViewRef.current?.view_id === chain.viewID;
        if (stillDisplayed) {
          library.setHits([]);
          setRecalledView((current) => current?.view_id === chain.viewID && current.revision === chain.revision
            ? { ...current, loadedCount: 0, totalCount: undefined, mayHaveMore: false, pageState: "stale", message: t("These saved-view results are no longer shown as current. Reopen the view to load a fresh result scope.") }
            : current);
        }
      }
      if (requestID === recalledPageRequestRef.current
        && (!library.hasCurrentSearchIntent(chain.openWorkspaceID) || library.isCurrentSearchIntent(chain.searchIntent, chain.openWorkspaceID))) setBusy(false);
    }
  }
  async function refreshRecalledView(): Promise<RecallOutcome> {
    const current = currentRecalledViewRef.current;
    if (!current?.view_id) return { kind: "stale" };
    return recallSavedView({ view_id: current.view_id, name: current.name });
  }
  return {
    savedViews, savedViewsLoaded, savedViewsLoading, savedViewsError,
    savedRetrievalSaving, savedRetrievalMessage, savedRetrievalError,
    recalledView, failedRecall,
    saveSavedRetrievalView, loadSavedViews, loadSavedRetrievalForEdit,
    recallSavedView, continueRecalledViewPage, refreshRecalledView,
    invalidateForSearch, resetRecallProjection,
  };
}
