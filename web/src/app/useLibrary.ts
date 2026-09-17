import { useEffect, useMemo, useState } from "react";
import type { Locale, Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import { dedupFacetValue, exactIdentityKey, formatFacetValue, sortLibraryHits } from "../lib/format";
import type { AnnotationRecord, BrowseCrumb, BrowseRoot, Notice, SearchHit, SortDirection, SortField, SystemFacetState, ViewMode } from "../lib/types";

// The content library projection.
//
// `content.list` returns the complete publication set and the browser keeps it
// as one projection: tags, system facets, sorting, and path browsing are
// client-side views over data the daemon already returned. No filter here
// changes stored content, membership, or recovery meaning.

export type LibraryFlow = {
  hits: SearchHit[];
  setHits: (value: SearchHit[] | ((current: SearchHit[]) => SearchHit[])) => void;
  libraryItems: SearchHit[];
  setLibraryItems: (value: SearchHit[] | ((current: SearchHit[]) => SearchHit[])) => void;
  workspaceTags: AnnotationRecord[];
  setWorkspaceTags: (value: AnnotationRecord[]) => void;
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
  filteredLibraryItems: SearchHit[];
  tagFacets: Array<{ value: string; count: number }>;
  systemFacets: { types: Array<{ value: string; count: number }>; formats: Array<{ value: string; count: number }>; dedup: Array<{ value: string; count: number }>; tags: Array<{ value: string; count: number }>; index: Array<{ value: string; count: number }> };
  hasSystemFacets: boolean;
  hasActiveFilters: boolean;
  renderedHits: SearchHit[];
  loadContentLibrary: (activeWorkspaceID: string, refreshGeneration?: number, guardDrafts?: boolean) => Promise<void>;
  loadNamespace: (activeWorkspaceID: string, rootID: string, parentEntryID?: string, crumbs?: BrowseCrumb[]) => Promise<void>;
  navigateLibrary: (parentEntryID: string, crumbs: BrowseCrumb[], rootID?: string) => Promise<void>;
  loadTagVocabulary: (activeWorkspaceID: string) => Promise<AnnotationRecord[]>;
  syncTagCoverage: (subjectRef: string, tags: AnnotationRecord[]) => void;
  showSourcesSurface: () => void;
  toggleTagFilter: (value: string) => void;
  toggleSystemFacet: (kind: keyof SystemFacetState, value: string) => void;
  clearLibraryFilters: () => void;
  showFacetFilteredLibrary: () => void;
  resetLibraryProjection: () => void;
};

export function useLibrary({ t, locale, workspaceID, refreshGenerationRef, viewMode, setViewMode, sortField, sortDirection, setQuery, setLastExecutedQuery, setSelected, setBusy, notify, canLeaveDetailDrafts, discardDetailDrafts }: {
  t: Translator;
  locale: Locale;
  workspaceID: string;
  refreshGenerationRef: { current: number };
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
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
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [activeSystemFacets, setActiveSystemFacets] = useState<SystemFacetState>({ type: "", format: "", dedup: "", tags: "", index: "" });
  const [browseRootID, setBrowseRootID] = useState("");
  const [browseRoots, setBrowseRoots] = useState<BrowseRoot[]>([]);
  const [browseCrumbs, setBrowseCrumbs] = useState<BrowseCrumb[]>([]);

  const tagsBySubject = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const tag of workspaceTags) {
      const subject = tag.subject_ref?.trim();
      const value = tag.body?.trim();
      if (!subject || !value || tag.kind !== "TAG" || tag.tombstoned) continue;
      const values = result.get(subject) ?? [];
      if (!values.includes(value)) values.push(value);
      result.set(subject, values);
    }
    for (const values of result.values()) values.sort((left, right) => left.localeCompare(right, locale));
    return result;
  }, [locale, workspaceTags]);
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
  const tagFacets = useMemo(() => {
    const visibleSubjects = new Set(facetFilteredItems.map((item) => item.subject_ref).filter((value): value is string => Boolean(value)));
    const counts = new Map<string, number>();
    for (const [subject, values] of tagsBySubject) {
      if (!visibleSubjects.has(subject)) continue;
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts].map(([value, count]) => ({ value, count })).sort((left, right) => left.value.localeCompare(right.value, locale));
  }, [facetFilteredItems, locale, tagsBySubject]);
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
  const filteredLibraryItems = useMemo(() => facetFilteredItems.filter((item) => {
    const values = item.subject_ref ? tagsBySubject.get(item.subject_ref) ?? [] : [];
    return activeTags.every((tag) => values.includes(tag));
  }), [activeTags, facetFilteredItems, tagsBySubject]);
  const hasSystemFacets = Boolean(activeSystemFacets.type || activeSystemFacets.format || activeSystemFacets.dedup || activeSystemFacets.tags || activeSystemFacets.index);
  const hasActiveFilters = activeTags.length > 0 || hasSystemFacets;
  const sortAvailable = viewMode !== "search";
  const renderedHits = useMemo(() => sortAvailable && hits.length > 1
    ? sortLibraryHits(hits, sortField, sortDirection, locale)
    : hits, [hits, locale, sortAvailable, sortDirection, sortField]);
  const tagVocabulary = useMemo(() => [...new Set(workspaceTags.map((tag) => tag.body?.trim()).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right, locale)), [locale, workspaceTags]);

  useEffect(() => {
    if (!workspaceID) { setWorkspaceTags([]); setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); return; }
    void loadTagVocabulary(workspaceID);
  }, [workspaceID]);
  useEffect(() => {
    if (viewMode !== "tag") return;
    const subjects = new Set(filteredLibraryItems.map((item) => item.subject_ref));
    setHits(filteredLibraryItems);
    setSelected((current) => current?.subject_ref && subjects.has(current.subject_ref) ? current : undefined);
  }, [filteredLibraryItems, viewMode]);

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
    setSelected(undefined); setBrowseRootID(rootID); setBrowseCrumbs(crumbs); setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); setViewMode("path");
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
    setSelected(undefined); setBrowseRoots(roots); setBrowseRootID(rootID); setBrowseCrumbs([]); setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); setViewMode("content");
  }
  async function loadTagVocabulary(activeWorkspaceID: string): Promise<AnnotationRecord[]> {
    try {
      const response = await command(operations.annotation.list, { workspace_id: activeWorkspaceID });
      const items = ((response.data?.annotations ?? []) as AnnotationRecord[])
        .filter((item) => item.kind === "TAG" && !item.tombstoned && typeof item.body === "string" && Boolean(item.body.trim()));
      setWorkspaceTags(items);
      return items;
    } catch {
      setWorkspaceTags([]);
      return [];
    }
  }
  function syncTagCoverage(subjectRef: string, tags: AnnotationRecord[]) {
    const normalized = subjectRef.trim();
    if (!normalized) return;
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
  function toggleTagFilter(value: string) {
    if (!canLeaveDetailDrafts()) return;
    discardDetailDrafts();
    const next = activeTags.includes(value) ? activeTags.filter((tag) => tag !== value) : [...activeTags, value];
    if (next.length === 0) {
      setQuery(""); setLastExecutedQuery(""); setHits(facetFilteredItems); setSelected(undefined); setActiveTags([]); setViewMode(hasSystemFacets ? "tag" : "content");
      return;
    }
    setQuery(""); setLastExecutedQuery(""); setSelected(undefined); setActiveTags(next); setViewMode("tag");
  }
  function toggleSystemFacet(kind: keyof SystemFacetState, value: string) {
    if (!canLeaveDetailDrafts()) return;
    discardDetailDrafts();
    const next = { ...activeSystemFacets, [kind]: activeSystemFacets[kind] === value ? "" : value };
    setQuery(""); setLastExecutedQuery(""); setSelected(undefined); setActiveSystemFacets(next); setViewMode("tag");
  }
  function clearLibraryFilters() {
    if (!canLeaveDetailDrafts()) return;
    discardDetailDrafts();
    setQuery(""); setLastExecutedQuery(""); setHits(libraryItems); setSelected(undefined); setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); setViewMode("content");
  }
  function showFacetFilteredLibrary() {
    if (!canLeaveDetailDrafts()) return;
    discardDetailDrafts();
    setQuery(""); setLastExecutedQuery(""); setHits(facetFilteredItems); setSelected(undefined); setActiveTags([]); setViewMode(hasSystemFacets ? "tag" : "content");
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
    setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); setViewMode("content");
  }

  return {
    hits,
    setHits,
    libraryItems,
    setLibraryItems,
    workspaceTags,
    setWorkspaceTags,
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
    filteredLibraryItems,
    tagFacets,
    systemFacets,
    hasSystemFacets,
    hasActiveFilters,
    renderedHits,
    loadContentLibrary,
    loadNamespace,
    navigateLibrary,
    loadTagVocabulary,
    syncTagCoverage,
    showSourcesSurface,
    toggleTagFilter,
    toggleSystemFacet,
    clearLibraryFilters,
    showFacetFilteredLibrary,
    resetLibraryProjection,
  };
}
