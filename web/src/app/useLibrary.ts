import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale, Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import { dedupFacetValue, exactIdentityKey, formatFacetValue, itemInMonth, sortLibraryHits } from "../lib/format";
import { isMonthBucketKey } from "../lib/hashView";
import { libraryPageForMode } from "../lib/libraryViews";
import { resolveArchiveSelectionSizes } from "../lib/originalArchive";
import { projectNamespaceCapturedTimes } from "../lib/namespaceProjection";
import { filterResultScope, projectResultScope, resultScopeSource } from "../lib/resultScope";
import type { AnnotationRecord, BrowseCrumb, BrowseRoot, LibraryPageMode, Notice, SearchHit, SortDirection, SortField, SystemFacetState, ViewMode } from "../lib/types";

// The content library projection.
//
// `content.list` is read as a bounded page chain, not as one whole answer: the
// first screen is rendered from the first page while the daemon's exact total
// (`page.entries`) keeps the wall's scroll length and count label describing
// the real publication set. Further pages are fetched only when the operator
// reaches the end of what is loaded, so every entry stays reachable without the
// whole collection being projected up front. Tags, system facets, sorting, path
// browsing, and the registered pages remain client-side views over the entries
// that are loaded; the surface says so while the chain is still incomplete. No
// filter here changes stored content, membership, or recovery meaning.
//
// A page cursor is refused when the published projection changed. That is a
// real event: the chain restarts from the beginning and says so, and rows from
// two generations are never blended into one list.

/** The bounded first-page size the walls ask `content.list` for.
 *
 *  It is inside the daemon's declared 1..1000 bound and is its documented
 *  default page size, so the first screen never waits for the whole collection
 *  and a page boundary is never mistaken for the end of the listing. */
export const LIBRARY_PAGE_SIZE = 200;

type LibraryPageFacts = { total: number; token: string; complete: boolean; paged: boolean };

/** Read the daemon's own page block. An answer with no page block is the whole
 *  projection (a pre-paging daemon): it is treated as complete and its total is
 *  never invented. */
function readLibraryPageFacts(data: unknown, fallbackTotal: number): LibraryPageFacts {
  const page = (data as { page?: Record<string, unknown> } | undefined)?.page;
  const fallback = Number.isFinite(fallbackTotal) && fallbackTotal > 0 ? Math.floor(fallbackTotal) : 0;
  if (!page || typeof page !== "object") return { total: fallback, token: "", complete: true, paged: false };
  const entries = page.entries;
  const total = typeof entries === "number" && Number.isFinite(entries) && entries >= 0 ? Math.floor(entries) : fallback;
  return {
    total,
    token: typeof page.token === "string" ? page.token : "",
    complete: page.complete === true || page.completeness === "COMPLETE",
    paged: page.mode === "page",
  };
}

/** The stable identity of one loaded entry, used only to keep a re-issued page
 *  from being appended twice. It is never a durable key. */
function libraryEntryKey(item: SearchHit): string {
  return (item.entry_id || item.subject_ref || "").trim();
}

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
  setActiveTags: (value: string[] | ((current: string[]) => string[])) => void;
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
  /** Current host result scope projected only by the active presentation. */
  readonly scopeFacetItems: SearchHit[];
  /** Current scope after system facets and timeline month, before user tags. */
  readonly scopeMonthFilteredItems: SearchHit[];
  /** Current scope after system facets and user tags, before timeline month. */
  readonly scopeTimelineItems: SearchHit[];
  /** Current result set after host-local tag/facet/month conditions, before page projection. */
  scopeHits: SearchHit[];
  activeTimelineMonth: string;
  setActiveTimelineMonth: (value: string) => void;
  toggleTimelineMonth: (month: string) => void;
  libraryLoaded: boolean;
  /** The exact total entry count of the published projection, when the daemon
   *  reported one (`page.entries`). It is the total in every paging mode, not
   *  the size of the page this browser happens to hold. */
  libraryTotal: number;
  /** True only when the loaded entries provably are the whole projection. */
  libraryListingComplete: boolean;
  /** True when the daemon offered a continuation this browser can follow. */
  libraryListingMore: boolean;
  libraryListingLoading: boolean;
  /** The daemon's own message when the next page could not be read, or "". */
  libraryListingError: string;
  /** Fetches the next bounded page of the same chain, if one is available. */
  loadMoreLibrary: () => void;
  restoreLibraryHashView: (view: "content" | "tag", tags: string[], month: string) => boolean;
  tagFacets: Array<{ value: string; count: number }>;
  systemFacets: { types: Array<{ value: string; count: number }>; formats: Array<{ value: string; count: number }>; dedup: Array<{ value: string; count: number }>; tags: Array<{ value: string; count: number }>; index: Array<{ value: string; count: number }> };
  hasSystemFacets: boolean;
  hasActiveFilters: boolean;
  renderedHits: SearchHit[];
  loadContentLibrary: (activeWorkspaceID: string, refreshGeneration?: number, guardDrafts?: boolean, resetPresentation?: boolean) => Promise<void>;
  /** Private coordination for a search that can race the initial loaded-list projection. */
  beginSearchIntent: (activeWorkspaceID: string) => number;
  isCurrentSearchIntent: (intent: number, activeWorkspaceID: string) => boolean;
  hasCurrentSearchIntent: (activeWorkspaceID: string) => boolean;
  cancelSearchIntent: () => void;
  currentLibraryItems: (activeWorkspaceID: string) => SearchHit[];
  loadNamespace: (activeWorkspaceID: string, rootID: string, parentEntryID?: string, crumbs?: BrowseCrumb[], stillCurrent?: () => boolean) => Promise<boolean>;
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

export function useLibrary({ t, locale, workspaceID, refreshGenerationRef, viewMode, scopeViewMode = viewMode, presentationMode, selected, setViewMode, setPresentationMode, sortField, sortDirection, setQuery, setLastExecutedQuery, setSelected, setBusy, notify, canLeaveDetailDrafts, hasDetailDrafts, detailDraftFingerprint, discardDetailDrafts }: {
  t: Translator;
  locale: Locale;
  workspaceID: string;
  refreshGenerationRef: { current: number };
  viewMode: ViewMode;
  /** Optional projection source mode for a temporary surface over an existing Library scope. */
  scopeViewMode?: ViewMode;
  presentationMode: "content" | LibraryPageMode;
  selected?: SearchHit;
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
  hasDetailDrafts: () => boolean;
  detailDraftFingerprint: () => string;
  discardDetailDrafts: () => void;
}): LibraryFlow {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [libraryItems, setLibraryItems] = useState<SearchHit[]>([]);
  const libraryItemsRef = useRef<SearchHit[]>([]);
  const libraryItemsWorkspaceRef = useRef("");
  const libraryItemsRefreshRef = useRef(-1);
  const searchIntentSequence = useRef(0);
  const activeSearchIntent = useRef<{ sequence: number; workspaceID: string; refreshGeneration: number } | undefined>(undefined);
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const presentationModeRef = useRef(presentationMode);
  presentationModeRef.current = presentationMode;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const hasDetailDraftsRef = useRef(hasDetailDrafts);
  hasDetailDraftsRef.current = hasDetailDrafts;
  const detailDraftFingerprintRef = useRef(detailDraftFingerprint);
  detailDraftFingerprintRef.current = detailDraftFingerprint;
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
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [libraryListingComplete, setLibraryListingComplete] = useState(true);
  const [libraryListingMore, setLibraryListingMore] = useState(false);
  const [libraryListingLoading, setLibraryListingLoading] = useState(false);
  const [libraryListingError, setLibraryListingError] = useState("");
  // The live cursor state is kept in a ref so two commits cannot race over the
  // same chain, and a new first page (a refresh, a workspace change, or a
  // refused cursor) invalidates every in-flight continuation through the
  // sequence counter.
  const libraryPageRef = useRef({ token: "", loading: false, error: "", complete: true });
  const libraryKeysRef = useRef<Set<string>>(new Set());
  const libraryLoadSequence = useRef(0);

  function setLoadedLibraryItems(value: SearchHit[] | ((current: SearchHit[]) => SearchHit[])) {
    const next = typeof value === "function" ? value(libraryItemsRef.current) : value;
    libraryItemsRef.current = next;
    setLibraryItems(next);
  }
  function beginSearchIntent(activeWorkspaceID: string) {
    const sequence = ++searchIntentSequence.current;
    activeSearchIntent.current = { sequence, workspaceID: activeWorkspaceID, refreshGeneration: refreshGenerationRef.current };
    return sequence;
  }
  function isCurrentSearchIntent(intent: number, activeWorkspaceID: string) {
    return activeSearchIntent.current?.sequence === intent
      && activeSearchIntent.current.workspaceID === activeWorkspaceID
      && activeSearchIntent.current.refreshGeneration === refreshGenerationRef.current
      && currentWorkspaceID.current === activeWorkspaceID;
  }
  function hasCurrentSearchIntent(activeWorkspaceID: string) {
    return activeSearchIntent.current?.workspaceID === activeWorkspaceID
      && activeSearchIntent.current.refreshGeneration === refreshGenerationRef.current
      && currentWorkspaceID.current === activeWorkspaceID;
  }
  function cancelSearchIntent() { activeSearchIntent.current = undefined; }
  function currentLibraryItems(activeWorkspaceID: string) {
    return libraryItemsWorkspaceRef.current === activeWorkspaceID
      && libraryItemsRefreshRef.current === refreshGenerationRef.current ? libraryItemsRef.current : [];
  }

  const visibleWorkspaceTags = tagVocabularyWorkspaceID === workspaceID ? workspaceTags : [];
  const visibleTagStatus = tagVocabularyWorkspaceID === workspaceID ? tagStatus : "loading";
  const tagsBySubject = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const tag of visibleWorkspaceTags) {
      const subject = tag.subject_ref?.trim();
      const value = tag.body;
      if (!subject || typeof value !== "string" || !value.trim() || tag.kind !== "TAG" || tag.tombstoned) continue;
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
  const resultSource = useMemo(() => resultScopeSource(scopeViewMode, hits, libraryItems), [hits, libraryItems, scopeViewMode]);
  const scopedResult = useMemo(() => filterResultScope(resultSource, { activeTags, activeSystemFacets, activeTimelineMonth, tagsBySubject, identityCounts }), [activeTags, activeSystemFacets, activeTimelineMonth, identityCounts, resultSource, tagsBySubject]);
  const scopeFacetItems = useMemo(() => projectResultScope(resultSource, presentationMode), [presentationMode, resultSource]);
  const scopeMonthFilteredItems = useMemo(() => projectResultScope(scopedResult.monthFiltered, presentationMode), [presentationMode, scopedResult.monthFiltered]);
  const scopeTimelineItems = useMemo(() => projectResultScope(scopedResult.facetFiltered.filter((item) => {
    const values = item.subject_ref ? tagsBySubject.get(item.subject_ref) ?? [] : [];
    return activeTags.every((tag) => values.includes(tag));
  }), presentationMode), [activeTags, presentationMode, scopedResult.facetFiltered, tagsBySubject]);
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
    for (const item of scopeFacetItems) {
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
      tags: [{ value: "UNMARKED", count: scopeFacetItems.filter((item) => item.index_status?.tags === "UNMARKED").length }].filter((facet) => facet.count > 0),
      index: [{ value: "NOT_READY", count: scopeFacetItems.filter((item) => {
        const states = [item.index_status?.lexical, item.index_status?.semantic].filter((value): value is string => typeof value === "string" && value.length > 0);
        return states.length > 0 && states.some((value) => value === "NOT_BUILT" || value === "UNAVAILABLE");
      }).length }].filter((facet) => facet.count > 0),
    };
  }, [identityCounts, locale, scopeFacetItems]);
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
  const tagVocabulary = useMemo(() => [...new Set([...tagsBySubject.values()].flat())].sort((left, right) => left.localeCompare(right, locale)), [locale, tagsBySubject]);

  useEffect(() => {
    if (!workspaceID) { tagLoadSequence.current += 1; tagScopeRef.current = ""; tagStatusRef.current = "unavailable"; tagRecordsRef.current = []; setTagVocabularyWorkspaceID(""); setTagStatus("unavailable"); setTagSnapshotKnown(false); setWorkspaceTags([]); setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); return; }
    void loadTagVocabulary(workspaceID);
    return () => { tagLoadSequence.current += 1; };
  }, [workspaceID]);

  async function loadNamespace(activeWorkspaceID: string, rootID: string, parentEntryID = "", crumbs: BrowseCrumb[] = [], stillCurrent?: () => boolean) {
    if (stillCurrent && !stillCurrent()) return false;
    if (!canLeaveDetailDrafts()) return false;
    const generation = refreshGenerationRef.current;
    const sequence = ++libraryLoadSequence.current;
    const viewModeAtStart = viewModeRef.current;
    const presentationModeAtStart = presentationModeRef.current;
    const selectedAtStart = selectedRef.current;
    const searchSequenceAtStart = searchIntentSequence.current;
    const draftFingerprintAtStart = detailDraftFingerprintRef.current();
    activeSearchIntent.current = undefined;
    const response = await command(operations.namespace.list, { workspace_id: activeWorkspaceID, root_id: rootID, parent_id: parentEntryID || undefined });
    const data = response.data as { root_id?: string; parent_id?: string } | undefined;
    // A namespace answer may only replace the current browse state if the
    // workspace, refresh, request, search and inspected subject still match
    // the context that started it. A draft created while the request was in
    // flight is retained rather than discarded by this late response.
    if (sequence !== libraryLoadSequence.current
      || refreshGenerationRef.current !== generation
      || currentWorkspaceID.current !== activeWorkspaceID
      || viewModeRef.current !== viewModeAtStart
      || presentationModeRef.current !== presentationModeAtStart
      || selectedRef.current !== selectedAtStart
      || searchIntentSequence.current !== searchSequenceAtStart
      || detailDraftFingerprintRef.current() !== draftFingerprintAtStart
      || (stillCurrent && !stillCurrent())
      || data?.root_id !== rootID
      || (data?.parent_id || "") !== parentEntryID) return false;
    const entries = (response.data?.entries ?? []) as Array<{ entry_id?: string; subject_ref?: string; display_name?: string; entry_type?: string; content_id?: string; logical_size?: number; index_status?: SearchHit["index_status"] }>;
    const prefix = crumbs.map((crumb) => crumb.name).join("/");
    discardDetailDrafts();
    setQuery(""); setLastExecutedQuery("");
    const namespaceHits = entries.map((entry) => ({
      subject_ref: entry.subject_ref,
      entry_id: entry.entry_id,
      name: entry.display_name,
      path: [prefix, entry.display_name].filter(Boolean).join("/"),
      entry_type: entry.entry_type,
      content_id: entry.content_id,
      logical_size: entry.logical_size,
      index_status: entry.index_status,
    }));
    // `namespace.list` omits modification time. Reuse only an already-loaded,
    // current-workspace content.list fact for the exact same file identity.
    setHits(projectNamespaceCapturedTimes(namespaceHits, currentLibraryItems(activeWorkspaceID)));
    setSelected(undefined); setBrowseRootID(rootID); setBrowseCrumbs(crumbs); setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); setActiveTimelineMonth(""); setViewMode("path");
    return true;
  }
  // Adopt the daemon's own account of the projection: its exact total, whether
  // this answer was the whole projection, and the continuation that reaches the
  // rest. The total is never derived from the size of the page.
  function applyLibraryPage(data: unknown, fallbackTotal: number) {
    const facts = readLibraryPageFacts(data, fallbackTotal);
    libraryPageRef.current.token = facts.token;
    libraryPageRef.current.complete = facts.complete;
    libraryPageRef.current.error = "";
    setLibraryTotal(facts.total);
    setLibraryListingComplete(facts.complete);
    setLibraryListingMore(!facts.complete && Boolean(facts.token));
    setLibraryListingError("");
  }
  // Replaces every loaded entry with a fresh first page of the same chain. It
  // preserves the operator's current filters and view: a moved projection is a
  // reason to restart the chain, not to throw the screen away.
  async function restartLibraryListing(activeWorkspaceID: string) {
    const generation = refreshGenerationRef.current;
    const sequence = ++libraryLoadSequence.current;
    const response = await command(operations.content.list, { workspace_id: activeWorkspaceID, page: { limit: LIBRARY_PAGE_SIZE } });
    if (sequence !== libraryLoadSequence.current) return;
    if (refreshGenerationRef.current !== generation || currentWorkspaceID.current !== activeWorkspaceID) return;
    const items = (response.data?.items ?? []) as SearchHit[];
    libraryPageRef.current = { token: "", loading: false, error: "", complete: true };
    libraryKeysRef.current = new Set(items.map(libraryEntryKey).filter(Boolean));
    libraryItemsWorkspaceRef.current = activeWorkspaceID;
    libraryItemsRefreshRef.current = generation;
    setLoadedLibraryItems(items);
    setHits((current) => resolveArchiveSelectionSizes(current, items));
    applyLibraryPage(response.data, items.length);
  }
  async function loadMoreLibrary() {
    const activeWorkspaceID = currentWorkspaceID.current;
    const page = libraryPageRef.current;
    // An existing error is only cleared by an explicit call (the surface's own
    // Retry), never retried in a loop by the window reaching its edge.
    if (!activeWorkspaceID || page.loading || page.complete || !page.token) return;
    const generation = refreshGenerationRef.current;
    const sequence = libraryLoadSequence.current;
    page.loading = true;
    page.error = "";
    setLibraryListingError("");
    setLibraryListingLoading(true);
    try {
      const response = await command(operations.content.list, { workspace_id: activeWorkspaceID, page: { token: page.token } });
      if (sequence !== libraryLoadSequence.current || refreshGenerationRef.current !== generation || currentWorkspaceID.current !== activeWorkspaceID) return;
      const returned = (response.data?.items ?? []) as SearchHit[];
      // A keyset chain returns each entry at most once; the identity check only
      // keeps a re-issued page from being appended twice.
      const fresh = returned.filter((item) => {
        const key = libraryEntryKey(item);
        return key ? !libraryKeysRef.current.has(key) : true;
      });
      for (const item of fresh) {
        const key = libraryEntryKey(item);
        if (key) libraryKeysRef.current.add(key);
      }
      setLoadedLibraryItems((current) => [...current, ...fresh]);
      setHits((current) => resolveArchiveSelectionSizes(current, fresh));
      applyLibraryPage(response.data, libraryKeysRef.current.size);
    } catch (error) {
      if (sequence !== libraryLoadSequence.current || refreshGenerationRef.current !== generation || currentWorkspaceID.current !== activeWorkspaceID) return;
      const message = error instanceof Error ? error.message : String(error);
      if (/continuation/i.test(message)) {
        // The daemon refused the cursor because the published projection moved
        // under this wall. That is a real event, not a transient error: restart
        // the chain from the beginning, say what happened, and never blend rows
        // from two generations into one list.
        notify({ kind: "warning", text: t("The library changed while you were browsing, so it was reloaded from the beginning.") });
        try {
          await restartLibraryListing(activeWorkspaceID);
        } catch (restartError) {
          const restartMessage = restartError instanceof Error ? restartError.message : String(restartError);
          libraryPageRef.current.error = restartMessage;
          setLibraryListingError(restartMessage);
          notify({ kind: "error", text: t("The library could not be read again after it changed: {{message}}", { message: restartMessage }) });
        }
        return;
      }
      page.error = message;
      setLibraryListingError(message);
      notify({ kind: "error", text: t("The next page of the library could not be read: {{message}}", { message }) });
    } finally {
      page.loading = false;
      setLibraryListingLoading(false);
    }
  }
  async function loadContentLibrary(activeWorkspaceID: string, refreshGeneration = refreshGenerationRef.current, guardDrafts = false, resetPresentation = false) {
    if (guardDrafts && !canLeaveDetailDrafts()) return;
    const detailDraftFingerprintAtStart = detailDraftFingerprintRef.current();
    const draftWouldBlockCommit = () => guardDrafts
      ? detailDraftFingerprintRef.current() !== detailDraftFingerprintAtStart
      : hasDetailDraftsRef.current();
    // The explicit All content/reload path is an intentional return to the
    // listing. Background startup loading does not revoke a newer search or
    // replace Notes while its listing request is still settling.
    if (guardDrafts) activeSearchIntent.current = undefined;
    const viewModeAtStart = viewModeRef.current;
    const presentationModeAtStart = presentationModeRef.current;
    const selectedAtStart = selected;
    const sequence = ++libraryLoadSequence.current;
    let response;
    try {
      response = await command(operations.content.list, { workspace_id: activeWorkspaceID, page: { limit: LIBRARY_PAGE_SIZE } });
    } catch (error) {
      if (refreshGenerationRef.current !== refreshGeneration || sequence !== libraryLoadSequence.current || currentWorkspaceID.current !== activeWorkspaceID) return;
      const currentIntent = hasCurrentSearchIntent(activeWorkspaceID);
      const destinationChanged = viewModeRef.current !== viewModeAtStart || presentationModeRef.current !== presentationModeAtStart;
      const userStateChanged = draftWouldBlockCommit() || selectedRef.current !== selectedAtStart;
      if (currentIntent || (!guardDrafts && (viewModeRef.current === "search" || viewModeRef.current === "notes")) || destinationChanged || userStateChanged) {
        const message = error instanceof Error ? error.message : String(error);
        setLibraryListingError(message);
        notify({ kind: "warning", text: t("Content library is unavailable: {{message}}", { message }) });
        return;
      }
      throw error;
    }
    if (refreshGenerationRef.current !== refreshGeneration || sequence !== libraryLoadSequence.current || currentWorkspaceID.current !== activeWorkspaceID) return;
    const items = (response.data?.items ?? []) as SearchHit[];
    libraryItemsWorkspaceRef.current = activeWorkspaceID;
    libraryItemsRefreshRef.current = refreshGeneration;
    setLoadedLibraryItems(items);
    libraryPageRef.current.loading = false;
    libraryKeysRef.current = new Set(items.map(libraryEntryKey).filter(Boolean));
    applyLibraryPage(response.data, items.length);
    setLibraryLoaded(true);
    const activeSearch = hasCurrentSearchIntent(activeWorkspaceID);
    const destinationChanged = viewModeRef.current !== viewModeAtStart
      || presentationModeRef.current !== presentationModeAtStart;
    const userStateChanged = draftWouldBlockCommit() || selectedRef.current !== selectedAtStart;
    if (activeSearch || (!guardDrafts && (viewModeRef.current === "search" || viewModeRef.current === "notes")) || destinationChanged || userStateChanged) {
      // Search remains the result authority and keeps its daemon order. The
      // loaded listing can add only an identical authorized tuple's length.
      if (activeSearch || viewModeRef.current === "search") setHits((current) => resolveArchiveSelectionSizes(current, items));
      setBrowseRoots((response.data?.roots ?? []) as BrowseRoot[]);
      return;
    }
    if (guardDrafts) {
      discardDetailDrafts();
      setQuery("");
    }
    setLastExecutedQuery("");
    libraryPageRef.current.error = "";
    setHits(items);
    const roots = (response.data?.roots ?? []) as BrowseRoot[];
    const rootID = response.data?.root_id || (roots.length === 1 ? roots[0].root_id : "");
    setSelected(undefined); setBrowseRoots(roots); setBrowseRootID(rootID); setBrowseCrumbs([]); setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); setActiveTimelineMonth(""); setViewMode("content");
    if (resetPresentation) setPresentationMode("content");
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
    setLoadedLibraryItems((items) => items.map(update));
    setHits((items) => items.map(update));
    setSelected((item) => item && item.subject_ref?.trim() === normalized ? update(item) : item);
  }
  // The rail item and the compact mobile entry both drive this single mode
  // switch. It replaces the old scroll-into-view jump to the in-library
  // disclosure bar that duplicated the same sources.
  function showSourcesSurface() {
    if (!canLeaveDetailDrafts()) return;
    cancelSearchIntent();
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
    if (viewMode === "search" || viewMode === "tag" || viewMode === "path") {
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
    if (viewMode !== "search" && viewMode !== "path") setViewMode(next.length || hasSystemFacets || activeTimelineMonth ? "tag" : "content");
  }
  function toggleSystemFacet(kind: keyof SystemFacetState, value: string) {
    if (!canLeaveDetailDrafts()) return;
    discardDetailDrafts();
    const next = { ...activeSystemFacets, [kind]: activeSystemFacets[kind] === value ? "" : value };
    setSelected(undefined); setActiveSystemFacets(next);
    if (viewMode !== "search" && viewMode !== "path") setViewMode(activeTags.length || Object.values(next).some(Boolean) || activeTimelineMonth ? "tag" : "content");
  }
  function clearLibraryFilters() {
    if (!canLeaveDetailDrafts()) return;
    discardDetailDrafts();
    if (viewMode !== "search") {
      setQuery(""); setLastExecutedQuery("");
      if (viewMode !== "path") setViewMode(presentationMode === "content" ? "content" : presentationMode);
    }
    setHits((current) => viewMode === "search" || viewMode === "path" ? current : libraryItems);
    setSelected(undefined); setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); setActiveTimelineMonth("");
  }
  function clearSearchScope() {
    if (viewMode !== "search" || !canLeaveDetailDrafts()) return;
    cancelSearchIntent();
    discardDetailDrafts();
    setQuery(""); setLastExecutedQuery(""); setHits(libraryItems); setSelected(undefined);
    setViewMode(activeTags.length || hasSystemFacets || activeTimelineMonth ? "tag" : presentationMode);
  }
  function showFacetFilteredLibrary() {
    if (!canLeaveDetailDrafts()) return;
    discardDetailDrafts();
    setSelected(undefined);
    setActiveTags([]);
    if (viewMode !== "search" && viewMode !== "path") { setHits(monthFilteredItems); setViewMode(hasSystemFacets ? "tag" : "content"); }
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
    if (viewMode !== "search" && viewMode !== "path") setViewMode(next ? "tag" : (activeTags.length || hasSystemFacets ? "tag" : "content"));
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
    // Any in-flight continuation belongs to the listing being dropped.
    libraryLoadSequence.current += 1;
    activeSearchIntent.current = undefined;
    libraryPageRef.current = { token: "", loading: false, error: "", complete: true };
    libraryKeysRef.current = new Set();
    setLibraryTotal(0); setLibraryListingComplete(true); setLibraryListingMore(false); setLibraryListingLoading(false); setLibraryListingError("");
    setHits([]); libraryItemsWorkspaceRef.current = ""; libraryItemsRefreshRef.current = -1; setLoadedLibraryItems([]);
    setBrowseRootID(""); setBrowseRoots([]); setBrowseCrumbs([]);
    setActiveTags([]); setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); setActiveTimelineMonth(""); setViewMode("content");
    setLibraryLoaded(false);
  }

  return {
    hits,
    setHits,
    libraryItems,
    setLibraryItems: setLoadedLibraryItems,
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
    scopeFacetItems,
    scopeMonthFilteredItems,
    scopeTimelineItems,
    scopeHits,
    activeTimelineMonth,
    setActiveTimelineMonth,
    toggleTimelineMonth,
    libraryLoaded,
    libraryTotal,
    libraryListingComplete,
    libraryListingMore,
    libraryListingLoading,
    libraryListingError,
    loadMoreLibrary,
    restoreLibraryHashView,
    tagFacets,
    systemFacets,
    hasSystemFacets,
    hasActiveFilters,
    renderedHits,
    loadContentLibrary,
    beginSearchIntent,
    isCurrentSearchIntent,
    hasCurrentSearchIntent,
    cancelSearchIntent,
    currentLibraryItems,
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
