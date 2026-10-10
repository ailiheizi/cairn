import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale, Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import { dedupFacetValue, exactIdentityKey, formatFacetValue, itemInMonth, sortLibraryHits } from "../lib/format";
import { isMonthBucketKey } from "../lib/hashView";
import { libraryPageForMode } from "../lib/libraryViews";
import { filterResultScope, projectResultScope, resultScopeSource } from "../lib/resultScope";
import type { AnnotationRecord, BrowseCrumb, BrowseRoot, LibraryPageMode, Notice, SearchHit, SortDirection, SortField, SystemFacetState, ViewMode } from "../lib/types";

// The content library projection.
//
// `content.list` returns the complete publication set and the browser keeps it
// as one projection: tags, system facets, sorting, path browsing, and the
// registered pages are client-side views over data the daemon already
// returned. No filter here changes stored content, membership, or recovery
// meaning.

export type LibraryFlow = {
  hits: SearchHit[];
  setHits: (value: SearchHit[] | ((current: SearchHit[]) => SearchHit[])) => void;
  libraryItems: SearchHit[];
  setLibraryItems: (value: SearchHit[] | ((current: SearchHit[]) => SearchHit[])) => void;
  workspaceTags: AnnotationRecord[];
  setWorkspaceTags: (value: AnnotationRecord[]) => void;
  tagStatus: "loading" | "ready" | "unavailable";
  tagVocabularyWorkspaceID: string;
  tagSnapshotKnown: boolean;
  activeTags: string[];
  setActiveTags: (value: string[]) => void;
  activeSystemFacets: SystemFacetState;
  setActiveSystemFacets: (value: SystemFacetState) => void;
  browseRootID: string;
  browseRoots: BrowseRoot[];
  browseCrumbs: BrowseCrumb[];
  setBrowseRootID: (value: string) => void;
  setBrowseRoots: (value: BrowseRoot[]) => void;
  setBrowseCrumbs: (value: BrowseCrumb[]) => void;
  tagsBySubject: Map<string, string[]>;
  tagVocabulary: string[];
  identityCounts: Map<string, number>;
  facetFilteredItems: SearchHit[];
  /** The facet-filtered listing further narrowed by the active timeline month. */
  monthFilteredItems: SearchHit[];
  filteredLibraryItems: SearchHit[];
  /** Current result set after host-local tag/facet/month conditions, before page projection. */
  scopeHits: SearchHit[];
  activeTimelineMonth: string;
  setActiveTimelineMonth: (value: string) => void;
  toggleTimelineMonth: (month: string) => void;
  libraryLoaded: boolean;
  restoreLibraryHashView: (view: "content" | "tag", tags: string[], month: string) => boolean;
  tagFacets: Array<{ value: string; count: number }>;
  systemFacets: { types: Array<{ value: string; count: number }>; formats: Array<{ value: string; count: number }>; dedup: Array<{ value: string; count: number }>; tags: Array<{ value: string; count: number }>; index: Array<{ value: string; count: number }> };
  hasSystemFacets: boolean;
  hasActiveFilters: boolean;
  renderedHits: SearchHit[];
  loadContentLibrary: (activeWorkspaceID: string, refreshGeneration?: number, guardDrafts?: boolean) => Promise<void>;
  loadNamespace: (activeWorkspaceID: string, rootID: string, parentEntryID?: string, crumbs?: BrowseCrumb[]) => Promise<void>;
  navigateLibrary: (parentEntryID: string, crumbs: BrowseCrumb[], rootID?: string) => Promise<void>;
  loadTagVocabulary: (activeWorkspaceID: string) => Promise<AnnotationRecord[]>;
  reloadTagVocabulary: (activeWorkspaceID: string) => Promise<{ workspaceID: string; status: "ready" | "unavailable" | "stale"; records: AnnotationRecord[] }>;
  syncTagCoverage: (subjectRef: string, tags: AnnotationRecord[]) => void;
  showSourcesSurface: () => void;
  showLibrarySurface: (mode: "content" | LibraryPageMode) => boolean;
  toggleTagFilter: (value: string) => void;
  toggleSystemFacet: (kind: keyof SystemFacetState, value: string) => void;
  clearLibraryFilters: () => void;
  clearSearchScope: () => void;
  showFacetFilteredLibrary: () => void;
  resetLibraryProjection: () => void;
};

export function useLibrary({ t, locale, workspaceID, refreshGenerationRef, viewMode, presentationMode, setViewMode, setPresentationMode, sortField, sortDirection, setQuery, setLastExecutedQuery, setSelected, setBusy, notify, canLeaveDetailDrafts, discardDetailDrafts }: {
  t: Translator;
  locale: Locale;
  workspaceID: string;
  refreshGenerationRef: { current: number };
  viewMode: ViewMode;
  presentationMode: "content" | LibraryPageMode;
  setViewMode: (mode: ViewMode) => void;
  setPresentationMode: (mode: "content" | LibraryPageMode) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  setQuery: (value: string) => void;
  setLastExecutedQuery: (value: string) => void;
  setSelected: (hit: SearchHit | undefined | ((current: SearchHit | undefined) => SearchHit | undefined)) => void;
  setBusy: (value: boolean) => void;
  notify: (notice: Notice | undefined) => void;
  canLeaveDetailDrafts: () => boolean;
  discardDetailDrafts: () => void;
}): LibraryFlow {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [libraryItems, setLibraryItems] = useState<SearchHit[]>([]);
  const [workspaceTags, setWorkspaceTags] = useState<AnnotationRecord[]>([]);
  const [tagVocabularyWorkspaceID, setTagVocabularyWorkspaceID] = useState("");
  const [tagStatus, setTagStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [tagSnapshotKnown, setTagSnapshotKnown] = useState(false);
  const tagLoadSequence = useRef(0);
  const tagScopeRef = useRef("");
  const tagStatusRef = useRef<"loading" | "ready" | "unavailable">("loading");
  const tagRecordsRef = useRef<AnnotationRecord[]>([]);
  const currentWorkspaceID = useRef(workspaceID);
  currentWorkspaceID.current = workspaceID;
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [activeSystemFacets, setActiveSystemFacets] = useState<SystemFacetState>({ type: "", format: "", dedup: "", tags: "", index: "" });
  const [browseRootID, setBrowseRootID] = useState("");
  const [browseRoots, setBrowseRoots] = useState<BrowseRoot[]>([]);
  const [browseCrumbs, setBrowseCrumbs] = useState<BrowseCrumb[]>([]);
  // The timeline bucket is a browser-local filter over the loaded listing's
  // month projection; it is only settable from the strip or the URL hash and
  // never changes stored content or recovery meaning.
  const [activeTimelineMonth, setActiveTimelineMonth] = useState("");
  const [libraryLoaded, setLibraryLoaded] = useState(false);

  const visibleWorkspaceTags = tagVocabularyWorkspaceID === workspaceID ? workspaceTags : [];
  const visibleTagStatus = tagVocabularyWorkspaceID === workspaceID ? tagStatus : "loading";
  const tagsBySubject = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const tag of visibleWorkspaceTags) {
      const subject = tag.subject_ref?.trim();
      const value = tag.body?.trim();
      if (!subject || !value || tag.kind !== "TAG" || tag.tombstoned) continue;
      const values = result.get(subject) ?? [];
      if (!values.includes(value)) values.push(value);
      result.set(subject, values);
    }
    for (const values of result.values()) values.sort((left, right) => left.localeCompare(right, locale));
    return result;
  }, [locale, visibleWorkspaceTags]);
  const identityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of libraryItems) {
      const key = exactIdentityKey(item);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [libraryItems]);
  const facetFilteredItems = useMemo(() => libraryItems.filter((item) => {
    const format = formatFacetValue(item);
    const dedup = dedupFacetValue(item, identityCounts);
    const tagState = item.index_status?.tags;
    const indexStates = [item.index_status?.lexical, item.index_status?.semantic].filter((value): value is string => typeof value === "string" && value.length > 0);
    const indexNotReady = indexStates.length > 0 && indexStates.some((value) => value === "NOT_BUILT" || value === "UNAVAILABLE");
    return (!activeSystemFacets.type || item.entry_type === activeSystemFacets.type) && (!activeSystemFacets.format || format === activeSystemFacets.format) && (!activeSystemFacets.dedup || dedup === activeSystemFacets.dedup) && (!activeSystemFacets.tags || tagState === activeSystemFacets.tags) && (!activeSystemFacets.index || (activeSystemFacets.index === "NOT_READY" && indexNotReady));
  }), [activeSystemFacets, identityCounts, libraryItems]);
  const monthFilteredItems = useMemo(() => activeTimelineMonth ? facetFilteredItems.filter((item) => itemInMonth(item, activeTimelineMonth)) : facetFilteredItems, [activeTimelineMonth, facetFilteredItems]);
  const resultSource = useMemo(() => resultScopeSource(viewMode, hits, libraryItems), [hits, libraryItems, viewMode]);
  const scopedResult = useMemo(() => filterResultScope(resultSource, { activeTags, activeSystemFacets, activeTimelineMonth, tagsBySubject, identityCounts }), [activeTags, activeSystemFacets, activeTimelineMonth, identityCounts, resultSource, tagsBySubject]);
  const scopeMonthFilteredItems = scopedResult.monthFiltered;
  const scopeHits = scopedResult.scopeHits;
  const tagFacets = useMemo(() => {
    const visibleSubjects = new Set(scopeMonthFilteredItems.map((item) => item.subject_ref).filter((value): value is string => Boolean(value)));
    const counts = new Map<string, number>();
    for (const [subject, values] of tagsBySubject) {
      if (!visibleSubjects.has(subject)) continue;
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts].map(([value, count]) => ({ value, count })).sort((left, right) => left.value.localeCompare(right.value, locale));
  }, [locale, scopeMonthFilteredItems, tagsBySubject]);
  const systemFacets = useMemo(() => {
    const types = new Map<string, number>();
    const formats = new Map<string, number>();
    const dedup = new Map<string, number>();
    for (const item of libraryItems) {
      if (item.entry_type) types.set(item.entry_type, (types.get(item.entry_type) ?? 0) + 1);
      const format = formatFacetValue(item);
      if (format) formats.set(format, (formats.get(format) ?? 0) + 1);
      const status = dedupFacetValue(item, identityCounts);
      if (status) dedup.set(status, (dedup.get(status) ?? 0) + 1);
    }
    return {
      types: [...types].map(([value, count]) => ({ value, count })).sort((left, right) => left.value.localeCompare(right.value, locale)),
      formats: [...formats].map(([value, count]) => ({ value, count })).sort((left, right) => left.value.localeCompare(right.value, locale)),
      dedup: ["DUPLICATE", "UNIQUE"].filter((value) => dedup.has(value)).map((value) => ({ value, count: dedup.get(value) ?? 0 })),
      tags: [{ value: "UNMARKED", count: libraryItems.filter((item) => item.index_status?.tags === "UNMARKED").length }].filter((facet) => facet.count > 0),
      index: [{ value: "NOT_READY", count: libraryItems.filter((item) => {
        const states = [item.index_status?.lexical, item.index_status?.semantic].filter((value): value is string => typeof value === "string" && value.length > 0);
        return states.length > 0 && states.some((value) => value === "NOT_BUILT" || value === "UNAVAILABLE");
      }).length }].filter((facet) => facet.count > 0),
    };
  }, [identityCounts, libraryItems, locale]);
  const filteredLibraryItems = useMemo(() => monthFilteredItems.filter((item) => {
    const values = item.subject_ref ? tagsBySubject.get(item.subject_ref) ?? [] : [];
    return activeTags.every((tag) => values.includes(tag));
  }), [activeTags, monthFilteredItems, tagsBySubject]);
  const hasSystemFacets = Boolean(activeSystemFacets.type || activeSystemFacets.format || activeSystemFacets.dedup || activeSystemFacets.tags || activeSystemFacets.index);
  const hasActiveFilters = activeTags.length > 0 || hasSystemFacets || Boolean(activeTimelineMonth);
  const sortAvailable = viewMode !== "search";
  // When a filter is active the grid renders the reactive projection of the
  // same facets, not the imperative hits state: the loader, the hash restore,
  // and the facet toggles can then never race each other over hits. Search
  // keeps its daemon-ordered hits.
  const pageHits = useMemo(() => projectResultScope(scopeHits, presentationMode), [presentationMode, scopeHits]);
  const renderedHits = useMemo(() => sortAvailable && pageHits.length > 1
    ? sortLibraryHits(pageHits, sortField, sortDirection, locale)
    : pageHits, [locale, pageHits, sortAvailable, sortDirection, sortField]);
  const tagVocabulary = useMemo(() => [...new Set(visibleWorkspaceTags.map((tag) => tag.body?.trim()).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right, locale)), [locale, visibleWorkspaceTags]);

  useEffect(() => {
    if (!workspaceID) { tagLoadSequence.current += 1; tagScopeRef.current = ""; tagStatusRef.current = "unavailable"; tagRecordsRef.current = []; setTagVocabularyWorkspaceID(""); setTagStatus("unavailable"); setTagSnapshotKnown(false); setWorkspaceTags([]); setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); return; }
    void loadTagVocabulary(workspaceID);
    return () => { tagLoadSequence.current += 1; };
  }, [workspaceID]);

  async function loadNamespace(activeWorkspaceID: string, rootID: string, parentEntryID = "", crumbs: BrowseCrumb[] = []) {
    if (!canLeaveDetailDrafts()) return;
    const response = await command(operations.namespace.list, { workspace_id: activeWorkspaceID, root_id: rootID, parent_id: parentEntryID || undefined });
    const entries = (response.data?.entries ?? []) as Array<{ entry_id?: string; subject_ref?: string; display_name?: string; entry_type?: string; content_id?: string; logical_size?: number; index_status?: SearchHit["index_status"] }>;
    const prefix = crumbs.map((crumb) => crumb.name).join("/");
    discardDetailDrafts();
    setQuery(""); setLastExecutedQuery("");
    setHits(entries.map((entry) => ({
      subject_ref: entry.subject_ref || entry.entry_id,
      entry_id: entry.entry_id || entry.subject_ref,
      name: entry.display_name,
      path: [prefix, entry.display_name].filter(Boolean).join("/"),
      entry_type: entry.entry_type,
      content_id: entry.content_id,
      logical_size: entry.logical_size,
      index_status: entry.index_status,
    })));
    setSelected(undefined); setBrowseRootID(rootID); setBrowseCrumbs(crumbs); setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); setActiveTimelineMonth(""); setViewMode("path");
  }
  async function loadContentLibrary(activeWorkspaceID: string, refreshGeneration = refreshGenerationRef.current, guardDrafts = false) {
    if (guardDrafts && !canLeaveDetailDrafts()) return;
    const response = await command(operations.content.list, { workspace_id: activeWorkspaceID });
    if (refreshGenerationRef.current !== refreshGeneration) return;
    const items = (response.data?.items ?? []) as SearchHit[];
    if (guardDrafts) discardDetailDrafts();
    setQuery(""); setLastExecutedQuery("");
    setLibraryItems(items); setHits(items);
    const roots = (response.data?.roots ?? []) as BrowseRoot[];
    const rootID = response.data?.root_id || (roots.length === 1 ? roots[0].root_id : "");
    setSelected(undefined); setBrowseRoots(roots); setBrowseRootID(rootID); setBrowseCrumbs([]); setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); setActiveTimelineMonth(""); setViewMode("content");
    setLibraryLoaded(true);
  }
  async function reloadTagVocabulary(activeWorkspaceID: string): Promise<{ workspaceID: string; status: "ready" | "unavailable" | "stale"; records: AnnotationRecord[] }> {
    if (activeWorkspaceID !== currentWorkspaceID.current) return { workspaceID: activeWorkspaceID, status: "stale", records: [] };
    const requestSequence = ++tagLoadSequence.current;
    const sameScope = tagScopeRef.current === activeWorkspaceID;
    if (!sameScope) {
      tagScopeRef.current = activeWorkspaceID;
      tagRecordsRef.current = [];
      setTagVocabularyWorkspaceID(activeWorkspaceID);
      setTagSnapshotKnown(false);
      setWorkspaceTags([]);
    }
    tagStatusRef.current = "loading";
    setTagStatus("loading");
    try {
      const response = await command(operations.annotation.list, { workspace_id: activeWorkspaceID });
      if (requestSequence !== tagLoadSequence.current || currentWorkspaceID.current !== activeWorkspaceID) return { workspaceID: activeWorkspaceID, status: "stale", records: [] };
      if (response.status !== "SUCCEEDED" || !Array.isArray(response.data?.annotations)) throw new Error("Tag list was not completely available.");
      const items = ((response.data?.annotations ?? []) as AnnotationRecord[])
        .filter((item) => item.kind === "TAG" && !item.tombstoned && typeof item.body === "string" && Boolean(item.body.trim()));
      tagScopeRef.current = activeWorkspaceID;
      tagStatusRef.current = "ready";
      tagRecordsRef.current = items;
      setTagVocabularyWorkspaceID(activeWorkspaceID);
      setTagSnapshotKnown(true);
      setWorkspaceTags(items);
      setTagStatus("ready");
      return { workspaceID: activeWorkspaceID, status: "ready", records: items };
    } catch {
      if (requestSequence !== tagLoadSequence.current || currentWorkspaceID.current !== activeWorkspaceID) return { workspaceID: activeWorkspaceID, status: "stale", records: [] };
      tagScopeRef.current = activeWorkspaceID;
      tagStatusRef.current = "unavailable";
      setTagVocabularyWorkspaceID(activeWorkspaceID);
      if (!sameScope) { tagRecordsRef.current = []; setWorkspaceTags([]); }
      setTagStatus("unavailable");
      return { workspaceID: activeWorkspaceID, status: "unavailable", records: sameScope ? tagRecordsRef.current : [] };
    }
  }
  async function loadTagVocabulary(activeWorkspaceID: string): Promise<AnnotationRecord[]> {
    const result = await reloadTagVocabulary(activeWorkspaceID);
    return result.status === "ready" ? result.records : [];
  }
  function syncTagCoverage(subjectRef: string, tags: AnnotationRecord[]) {
    const normalized = subjectRef.trim();
    if (!normalized || tagStatusRef.current !== "ready" || tagScopeRef.current !== workspaceID || currentWorkspaceID.current !== workspaceID) return;
    const state = tags.some((item) => item.subject_ref?.trim() === normalized && item.kind === "TAG" && !item.tombstoned) ? "MARKED" : "UNMARKED";
    const update = (item: SearchHit) => item.subject_ref?.trim() === normalized ? { ...item, index_status: { ...item.index_status, tags: state } } : item;
    setLibraryItems((items) => items.map(update));
    setHits((items) => items.map(update));
    setSelected((item) => item && item.subject_ref?.trim() === normalized ? update(item) : item);
  }
  // The rail item and the compact mobile entry both drive this single mode
  // switch. It replaces the old scroll-into-view jump to the in-library
  // disclosure bar that duplicated the same sources.
  function showSourcesSurface() {
    if (!canLeaveDetailDrafts()) return;
    discardDetailDrafts();
    setSelected(undefined);
    setViewMode("sources");
  }
  // Registered pages are transient projections over one loaded Library set.
  // Their declared media context selects an existing suffix facet locally;
  // switching pages adds no query, index generation, or durable membership.
  function showLibrarySurface(mode: "content" | LibraryPageMode): boolean {
    if (!canLeaveDetailDrafts()) return false;
    discardDetailDrafts();
    setPresentationMode(mode);
    if (viewMode === "search" || viewMode === "tag") {
      setViewMode(viewMode);
      return true;
    }
    setQuery(""); setLastExecutedQuery("");
    setHits(libraryItems);
    setSelected(undefined); setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); setActiveTimelineMonth("");
    setBrowseRootID(""); setBrowseCrumbs([]); setViewMode(mode);
    return true;
  }
  function toggleTagFilter(value: string) {
    if (!canLeaveDetailDrafts()) return;
    discardDetailDrafts();
    const next = activeTags.includes(value) ? activeTags.filter((tag) => tag !== value) : [...activeTags, value];
    setSelected(undefined); setActiveTags(next);
    if (viewMode !== "search") setViewMode(next.length || hasSystemFacets || activeTimelineMonth ? "tag" : "content");
  }
  function toggleSystemFacet(kind: keyof SystemFacetState, value: string) {
    if (!canLeaveDetailDrafts()) return;
    discardDetailDrafts();
    const next = { ...activeSystemFacets, [kind]: activeSystemFacets[kind] === value ? "" : value };
    setSelected(undefined); setActiveSystemFacets(next);
    if (viewMode !== "search") setViewMode(activeTags.length || Object.values(next).some(Boolean) || activeTimelineMonth ? "tag" : "content");
  }
  function clearLibraryFilters() {
    if (!canLeaveDetailDrafts()) return;
    discardDetailDrafts();
    if (viewMode !== "search") { setQuery(""); setLastExecutedQuery(""); setViewMode(presentationMode === "content" ? "content" : presentationMode); }
    setHits((current) => viewMode === "search" ? current : libraryItems);
    setSelected(undefined); setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); setActiveTimelineMonth("");
  }
  function clearSearchScope() {
    if (viewMode !== "search" || !canLeaveDetailDrafts()) return;
    discardDetailDrafts();
    setQuery(""); setLastExecutedQuery(""); setHits(libraryItems); setSelected(undefined);
    setViewMode(activeTags.length || hasSystemFacets || activeTimelineMonth ? "tag" : presentationMode);
  }
  function showFacetFilteredLibrary() {
    if (!canLeaveDetailDrafts()) return;
    discardDetailDrafts();
    setSelected(undefined);
    setActiveTags([]);
    if (viewMode !== "search") { setHits(monthFilteredItems); setViewMode(hasSystemFacets ? "tag" : "content"); }
  }
  // Timeline browse: one month bucket filters the listing; clicking the active
  // bucket again clears it. The strip lives in the content and tag views; the
  // tag view re-derives its hits from the filtered projection, so only the
  // content view needs the immediate hit set here.
  function toggleTimelineMonth(month: string) {
    if (!canLeaveDetailDrafts()) return;
    discardDetailDrafts();
    const next = activeTimelineMonth === month ? "" : month;
    setActiveTimelineMonth(next);
    setSelected(undefined);
    if (viewMode !== "search") setViewMode(next ? "tag" : (activeTags.length || hasSystemFacets ? "tag" : "content"));
  }
  // Restores the browser-local filter view encoded in the URL hash. The hash
  // is never durable state: an unknown tag or month yields the honest
  // filtered-empty view, and nothing here touches stored content.
  function restoreLibraryHashView(view: "content" | "tag", tags: string[], month: string) {
    if (!canLeaveDetailDrafts()) return false;
    const tagValues = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    const monthValue = isMonthBucketKey(month) ? month : "";
    if (view === "tag" && tagValues.length === 0 && !monthValue) return false;
    if (view === "content" && !monthValue) return false;
    discardDetailDrafts();
    setQuery(""); setLastExecutedQuery(""); setSelected(undefined);
    setActiveTags(view === "tag" ? tagValues : []);
    setActiveTimelineMonth(monthValue);
    setViewMode(view);
    return true;
  }
  async function navigateLibrary(parentEntryID: string, crumbs: BrowseCrumb[], rootID = browseRootID) {
    if (!workspaceID || !rootID) return;
    setBusy(true);
    try { await loadNamespace(workspaceID, rootID, parentEntryID, crumbs); }
    catch (error) { notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not open folder") }); }
    finally { setBusy(false); }
  }
  function resetLibraryProjection() {
    setHits([]); setLibraryItems([]);
    setBrowseRootID(""); setBrowseRoots([]); setBrowseCrumbs([]);
    setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); setActiveTimelineMonth(""); setViewMode("content");
    setLibraryLoaded(false);
  }

  return {
    hits,
    setHits,
    libraryItems,
    setLibraryItems,
    workspaceTags: visibleWorkspaceTags,
    setWorkspaceTags,
    tagStatus: visibleTagStatus,
    tagVocabularyWorkspaceID,
    tagSnapshotKnown: tagVocabularyWorkspaceID === workspaceID && tagSnapshotKnown,
    activeTags,
    setActiveTags,
    activeSystemFacets,
    setActiveSystemFacets,
    browseRootID,
    browseRoots,
    browseCrumbs,
    setBrowseRootID,
    setBrowseRoots,
    setBrowseCrumbs,
    tagsBySubject,
    tagVocabulary,
    identityCounts,
    facetFilteredItems,
    monthFilteredItems,
    filteredLibraryItems,
    scopeHits,
    activeTimelineMonth,
    setActiveTimelineMonth,
    toggleTimelineMonth,
    libraryLoaded,
    restoreLibraryHashView,
    tagFacets,
    systemFacets,
    hasSystemFacets,
    hasActiveFilters,
    renderedHits,
    loadContentLibrary,
    loadNamespace,
    navigateLibrary,
    loadTagVocabulary,
    reloadTagVocabulary,
    syncTagCoverage,
    showSourcesSurface,
    showLibrarySurface,
    toggleTagFilter,
    toggleSystemFacet,
    clearLibraryFilters,
    clearSearchScope,
    showFacetFilteredLibrary,
    resetLibraryProjection,
  };
}
