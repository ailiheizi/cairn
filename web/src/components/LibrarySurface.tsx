import { AlertCircle, ArrowDown, ArrowUp, Calendar, Check, ChevronRight, Download as DownloadIcon, Folder, HardDrive, Home, Image, LayoutGrid, Hash, List as ListIcon, MoreHorizontal, Music2, Plus, RefreshCw, Server, ShieldCheck, Sparkles, Tag, X } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import type { Locale, Translator } from "../i18n";
import { ResultList } from "./ResultList";
import { LibraryPageHost } from "./LibraryPageHost";
import { LibraryPresentationNavigation } from "./LibraryPresentationNavigation";
import type { MusicMetadataState } from "../lib/musicMetadata";
import type { MusicQueueControls } from "../lib/musicQueueControls";
import { FAVORITE_TAG, type FavoriteControls } from "../lib/favorites";
import { SavedRetrievalPanel } from "./SavedRetrievalPanel";
import type { ExportFlow, RecalledViewState } from "../app/useExport";
import type { KeywordBrowseState } from "../app/useSearch";
import type { AudioTrack } from "../lib/audioPlayback";
import { SelectionBar } from "./SelectionBar";
import { SourcesSurface } from "./SourcesSurface";
import { TimelineStrip } from "./TimelineStrip";
import { sourceButtonLabel } from "../lib/format";
import { formatBytes, formatDedupFacet, formatEntryType, formatFacetValue, mediaClassFromSuffix, mediaContentItems, spaceReportProjection } from "../lib/format";
import { allLibraryViewIds, libraryPageForMode, type LibraryViewId } from "../lib/libraryViews";
import { parseSearchQuery, searchPlan } from "../lib/searchops";
import type { LibraryFlow } from "../app/useLibrary";
import type { SelectionFlow } from "../app/useSelection";
import type { SourcesFlow } from "../app/useSources";
import type { ViewModeFlow } from "../app/useViewMode";
import type { Command, Notice, RowClickEvent, SearchHit, SourceSummary, ViewMode, LibraryPageMode } from "../lib/types";
import "./LibraryWorkflow.css";

// The library column: view heading, its controls, filters, notices, and the
// current view's content (the result list or the configured sources).
//
// Every control here changes a browser projection or opens a drawer; none of
// them writes durable state directly.

export function LibrarySurface({ t, locale, workspaceID, viewMode, onLibraryView, enabledViews = allLibraryViewIds, library, selection, sources, view, command, selectedRef, showFirstSource, recalledView, lastExecutedQuery, keywordBrowse, onRunKeywordBrowseAction, canReturnToRanked = false, onReturnToRanked, onInvalidateKeywordBrowse, sortAvailable, canOpenExport, isConnected, isUnavailable, coreStorageReady, coreStorageMessage, notice, busy, scopeRestoring = false, scopeRestoreFailed = false, originalTakeoutBusy = false, onDownloadOriginals, onCreateMaterialList, materialListCreationDisabled = false, refresh, onOpenAdd, onViewSource, onRecheckSource, onRowClick, onLibraryKeyDown, onOpenExport, onClearNotice, onImageSearch, onVisualTextSearch, onOpenHit, onFocusSearch, libraryListRef, onPlayTrack, onQueueTrack, onPlayTracks, musicMetadata, favoriteControls, musicQueueControls, focusedSubjectRef, focusRequest, onFocusSubject, retrievalFlow }: {
  t: Translator;
  locale: Locale;
  workspaceID: string;
  viewMode: ViewMode;
  onLibraryView: (mode: "content" | LibraryPageMode, focusHit?: SearchHit) => void;
  /** Browser-local visibility choices for bundled photo/audio library views. */
  enabledViews?: ReadonlySet<LibraryViewId>;
  library: LibraryFlow;
  selection: SelectionFlow;
  sources: SourcesFlow;
  view: ViewModeFlow;
  command: Command;
  selectedRef: string;
  showFirstSource: boolean;
  recalledView: RecalledViewState | undefined;
  lastExecutedQuery: string;
  keywordBrowse?: KeywordBrowseState;
  onRunKeywordBrowseAction?: () => void;
  canReturnToRanked?: boolean;
  onReturnToRanked?: () => boolean;
  onInvalidateKeywordBrowse: () => void;
  sortAvailable: boolean;
  canOpenExport: boolean;
  isConnected: boolean;
  isUnavailable: boolean;
  coreStorageReady: boolean;
  coreStorageMessage: string;
  notice: Notice | undefined;
  busy: boolean;
  scopeRestoring?: boolean;
  scopeRestoreFailed?: boolean;
  originalTakeoutBusy?: boolean;
  onDownloadOriginals?: (subjects: SearchHit[]) => void;
  onCreateMaterialList?: (subjects: SearchHit[]) => void;
  materialListCreationDisabled?: boolean;
  refresh: () => void;
  onOpenAdd: (trigger?: EventTarget | null) => void;
  onViewSource: (sourceItem: SourceSummary) => void;
  onRecheckSource: (sourceItem: SourceSummary, trigger?: EventTarget | null) => void;
  onRowClick: (index: number, event: RowClickEvent) => void;
  onLibraryKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onOpenExport: (trigger?: EventTarget | null, selection?: SearchHit[]) => void;
  onClearNotice: () => void;
  /** Runs the image-dimension search.query for one selected image subject. */
  onImageSearch: (subjectRef: string) => void;
  onVisualTextSearch: (description: string) => void;
  /** Opens one loaded row through the existing row-open path (the inspector). */
  onOpenHit: (hit: SearchHit) => void;
  /** Focuses the existing library search field without changing its query. */
  onFocusSearch: () => void;
  libraryListRef: RefObject<HTMLDivElement | null>;
  onPlayTrack: (track: AudioTrack) => void;
  onQueueTrack: (track: AudioTrack) => void;
  onPlayTracks: (tracks: AudioTrack[]) => void;
  musicMetadata: MusicMetadataState;
  favoriteControls?: FavoriteControls;
  musicQueueControls?: MusicQueueControls;
  focusedSubjectRef: string;
  focusRequest?: number;
  onFocusSubject: (subjectRef: string) => void;
  retrievalFlow: ExportFlow;
}) {
  const [retrievalOpen, setRetrievalOpen] = useState(false);
  const selectionActionsRef = useRef<HTMLDivElement | null>(null);
  const selectionActionsDisclosureRef = useRef<HTMLDetailsElement | null>(null);
  function showSelectionActions() {
    const target = selectionActionsRef.current;
    if (!target) return;
    if (selectionActionsDisclosureRef.current) selectionActionsDisclosureRef.current.open = true;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    });
  }
  const { hits, libraryItems, scopeFacetItems, scopeMonthFilteredItems, scopeTimelineItems, activeTags, activeSystemFacets, activeTimelineMonth, browseRoots, browseRootID, browseCrumbs, tagFacets, systemFacets, renderedHits, identityCounts, tagsBySubject } = library;
  const keywordPageApplied = keywordBrowse ? ["more", "loading-more", "complete", "more-error", "stale"].includes(keywordBrowse.phase) : false;
  // The executed query is re-parsed here only to label what the daemon could
  // not express: those predicates were applied over the hits the query
  // returned, and the result set says so instead of implying a server filter.
  const executedPlan = useMemo(() => searchPlan(parseSearchQuery(lastExecutedQuery)), [lastExecutedQuery]);
  const overLoadedTokens = executedPlan.overLoadedResults.map((predicate) => predicate.raw).join(", ");
  const showConfiguredSourceEmpty = viewMode === "content" && libraryItems.length === 0 && sources.sources.length > 0;
  const showFilteredContentEmpty = viewMode === "content" && library.hasActiveFilters && renderedHits.length === 0;
  const presentationMode = viewMode === "content" || viewMode === "search" || viewMode === "tag" || viewMode === "path" || Boolean(libraryPageForMode(viewMode)) ? view.presentationMode : viewMode;
  const tagHeading = activeTags.length > 0
    ? t("Content tagged {{tags}}", { tags: activeTags.join(" + ") })
    : library.hasActiveFilters ? t("Filtered content") : t("All content");
  const showLibraryFacets = (viewMode === "content" || viewMode === "tag" || viewMode === "search" || viewMode === "path" || Boolean(libraryPageForMode(viewMode))) && scopeFacetItems.length > 0;
  // The space report and the timeline strip are browser-local projections over
  // the loaded listing; the onboarding guide only replaces the empty state
  // when nothing filters it, so a filtered-empty view keeps its own honest style.
  const spaceReport = useMemo(() => spaceReportProjection(renderedHits), [renderedHits]);
  const spaceReportPartial = spaceReport.sizedItems < renderedHits.length;
  const showLibraryOnboarding = viewMode === "content" && libraryItems.length === 0 && !library.hasActiveFilters && sources.sourceProjection.state !== "DEGRADED";
  const pageDefinition = libraryPageForMode(presentationMode);
  const photoWallPage = libraryPageForMode("photos");
  const photoWallEnabled = Boolean(photoWallPage && enabledViews.has(photoWallPage.id));
  const returnToPhotoWall = pageDefinition?.mediaClass === "image" && photoWallEnabled;
  const exhibitionReturnLabel = t(returnToPhotoWall ? "Return to photo wall" : "All types");
  const isPhotoView = pageDefinition?.mediaClass === "image";
  const isMusicView = pageDefinition?.mediaClass === "audio";
  const isVideoView = pageDefinition?.mediaClass === "video";
  const domainOwnsSelection = presentationMode === "photos" || presentationMode === "music" || isVideoView;
  const isMediaView = Boolean(pageDefinition);
  const wasMediaViewRef = useRef(isMediaView);
  useLayoutEffect(() => {
    const disclosure = selectionActionsDisclosureRef.current;
    const enteredMediaView = !wasMediaViewRef.current && isMediaView;
    wasMediaViewRef.current = isMediaView;
    if (!disclosure) return;
    if (!isMediaView || selection.tagMutationProgress) disclosure.open = true;
    else if (enteredMediaView) disclosure.open = false;
  }, [isMediaView, selection.tagMutationProgress]);
  const showLibraryViewSwitch = viewMode === "path" ? hits.length > 0 : library.libraryLoaded && libraryItems.length > 0 && (isMediaView || viewMode === "content" || viewMode === "search" || viewMode === "tag");
  const scopeCount = library.scopeHits.length;
  const photoScopeCount = mediaContentItems(library.scopeHits, "image").length;
  const musicScopeCount = mediaContentItems(library.scopeHits, "audio").length;
  const videoScopeCount = library.scopeHits.filter((hit) => hit.entry_type === "REGULAR_FILE" && mediaClassFromSuffix(formatFacetValue(hit)) === "video").length;
  const otherScopeCount = scopeCount - photoScopeCount - musicScopeCount - videoScopeCount;
  // The walls are fed one bounded `content.list` page at a time. A wall that
  // projects the loaded library (not a search result set or a namespace path)
  // can continue that chain when the operator reaches the loaded edge.
  const wallProjectsListing = viewMode !== "search" && viewMode !== "path";
  // Only the all-types wall whose conditions narrow nothing shows exactly the
  // published projection, so only there does the daemon's exact total describe
  // this wall's positions and hold the full scroll length open from the first
  // answer. A media page, a tag/facet/month filter, and a search result set are
  // projections over the entries that are loaded; their position count is what
  // is loaded, and the progress line below says the listing is still arriving.
  const wallShowsWholeListing = wallProjectsListing && presentationMode === "content" && !library.hasActiveFilters;
  const listingPositions = wallShowsWholeListing ? Math.max(renderedHits.length, library.libraryTotal) : renderedHits.length;
  const listingIncomplete = wallProjectsListing && library.libraryLoaded && !library.libraryListingComplete;
  const wallCanLoadMore = wallProjectsListing && library.libraryListingMore && !library.libraryListingLoading && !library.libraryListingError;
  const visibleSubjectRefs = new Set(renderedHits.map((hit) => hit.subject_ref));
  const hiddenSelectionCount = selection.selectionSubjects.filter((hit) => !visibleSubjectRefs.has(hit.subject_ref)).length;
  const firstSavedFile = renderedHits.find((hit) => hit.entry_type === "REGULAR_FILE" && Boolean(hit.entry_id && hit.content_id));
  // A recalled view is active only while the library is still showing the
  // result set recall produced. Recall is the only path that sets this state,
  // and any later search clears it in useExport.invalidateForSearch, so the
  // caption and the saved-retrieval preview never label a result set with a
  // view whose stored conditions did not produce it.
  const recalledViewActive = Boolean(recalledView && viewMode === "search" && lastExecutedQuery === recalledView.query);
  const searchHeading = lastExecutedQuery.trim()
    ? t('Results for "{{query}}"', { query: lastExecutedQuery })
    : recalledViewActive ? recalledView?.name || t("Saved retrieval") : t("Image search results");
  const activeRecalledView = recalledViewActive ? recalledView : undefined;
  // Daily retrieval and the export drawer share the host's submitted candidate.
  const resultProps = { hits: renderedHits, libraryListRef, libraryLayout: view.libraryLayout, sortField: view.sortField, sortDirection: view.sortDirection, selectionCount: selection.selectionSubjects.length, rovingRow: selection.rovingRow, selectedRef, selectionRefs: selection.selectionRefs, identityCounts, tagsBySubject, viewMode, locale, t, command, workspaceID, onRowClick, onToggleSelection: selection.toggleSelectionAt, onKeyDown: onLibraryKeyDown, listingPositions, onLoadMore: wallCanLoadMore ? library.loadMoreLibrary : undefined };
  const retrievalFlowWithBrowseInvalidation = { ...retrievalFlow, recallSavedView: async (savedView: Parameters<ExportFlow["recallSavedView"]>[0]) => { onInvalidateKeywordBrowse(); await retrievalFlow.recallSavedView(savedView); }, refreshRecalledView: async () => { onInvalidateKeywordBrowse(); await retrievalFlow.refreshRecalledView(); } };
  const savedRetrievalPanel = <SavedRetrievalPanel flow={retrievalFlowWithBrowseInvalidation} candidate={retrievalFlow.retrievalCandidate} workspaceID={workspaceID} recalledActive={recalledViewActive} t={t} busy={busy} />;
  // UX-D1: a registered page may declare `composition: "focused"`. The page
  // then owns the viewport: one compact wrapping bar carries only the active
  // domain's alternative renderers (none for Music), the labelled "Library
  // tools" disclosure and a compact count. The top-level domain capsule lives
  // once in the host header, not again here. The generic tools (sort, export,
  // saved retrieval, tags and system fields) open on demand. Scope and
  // incomplete-listing statements stay outside the closed disclosure, so a
  // collapsed tool never hides an active query, tag or partial listing.
  const focusedComposition = pageDefinition?.composition === "focused";
  const privateSpaceHome = presentationMode === "page:cairn:overview" && viewMode === "content"
    && !library.hasActiveFilters && selection.selectionRefs.length === 0 && !selection.tagMutationProgress && !notice
    && !isUnavailable && coreStorageReady && !scopeRestoring && !scopeRestoreFailed;
  const favoritesToggle = library.libraryLoaded && viewMode !== "sources"
    ? <button type="button" className="library-return" aria-pressed={activeTags.includes(FAVORITE_TAG)} disabled={favoriteControls?.status !== "ready"} title={t("Favorites use the visible Favorite tag shared across your library.")} onClick={() => library.toggleTagFilter(FAVORITE_TAG)}>{t("Only favorites")}</button>
    : null;
  const sourceScopeActions = viewMode === "sources"
    ? <>
        {workspaceID && <button className="library-return" onClick={() => void library.loadContentLibrary(workspaceID, undefined, true)}><Home size={14} />{t("All content")}</button>}
        <span className="result-count">{sources.sourceProjection.state === "DEGRADED" ? t("Source status unavailable") : t("{{count}} configured", { count: sources.sources.length })}</span>
      </>
    : null;
  const filterActions = <>
    {library.hasActiveFilters && <button className="library-return" onClick={library.clearLibraryFilters}><X size={14} />{t("Clear filters")}</button>}
    {viewMode === "search" && <button className="library-return" onClick={library.clearSearchScope}><X size={14} />{t("Clear search")}</button>}
    {viewMode === "path" && workspaceID && <button className="library-return" onClick={() => void library.loadContentLibrary(workspaceID, undefined, true, true)}><Home size={14} />{t("All content")}</button>}
  </>;
  const sortControl = renderedHits.length > 0
    ? <span className="sort-control" role="group" aria-label={t("Sort library")} aria-describedby="cairn-sort-description">
        <span className="sr-only" id="cairn-sort-description">{t(sortAvailable ? "Sorts the items already loaded in this browser. Items whose page has not arrived yet keep their pending place, and items without a recorded value sort last." : "Search results keep their relevance order, so sorting is unavailable here.")}</span>
        <select className="sort-field" aria-label={t("Sort field")} value={view.sortField} disabled={!sortAvailable} onChange={(event) => view.changeSortField(event.target.value as "name" | "size" | "type" | "path" | "modified")}>
          <option value="name">{t("Name")}</option>
          <option value="size">{t("Size")}</option>
          <option value="type">{t("Type")}</option>
          <option value="path">{t("Path")}</option>
          <option value="modified">{t("Recorded modification time")}</option>
        </select>
        <button type="button" className="sort-direction" data-sort-direction={view.sortDirection} aria-label={t("Sort direction")} title={t(sortAvailable ? view.sortDirection === "asc" ? "Ascending order" : "Descending order" : "Search results keep their relevance order")} disabled={!sortAvailable} onClick={view.toggleSortDirection}>{view.sortDirection === "asc" ? <ArrowUp size={15} /> : <ArrowDown size={15} />}</button>
      </span>
    : null;
  const layoutSwitch = renderedHits.length > 0 && !isMediaView
    ? <span className="layout-switch" role="group" aria-label={t("Library layout")}>
        <button type="button" aria-pressed={view.libraryLayout === "grid"} title={t("Grid view")} aria-label={t("Grid view")} onClick={() => view.changeLibraryLayout("grid")}><LayoutGrid size={15} /></button>
        <button type="button" aria-pressed={view.libraryLayout === "list"} title={t("List view")} aria-label={t("List view")} onClick={() => view.changeLibraryLayout("list")}><ListIcon size={15} /></button>
      </span>
    : null;
  const exportActions = <>
    {canOpenExport && workspaceID && <button className="secondary-button compact export-trigger" onClick={(event) => onOpenExport(event.currentTarget)} disabled={!isConnected || !coreStorageReady}><DownloadIcon size={14} />{t("Export")}</button>}
  </>;
  const savedRetrievalAction = workspaceID && <button type="button" className="secondary-button compact" aria-expanded={retrievalOpen} aria-controls="saved-retrieval-panel" onClick={() => { setRetrievalOpen(!retrievalOpen); if (!retrievalOpen) void retrievalFlow.loadSavedViews(); }} disabled={!isConnected}>{t("Saved retrieval")}</button>;
  // The loaded figure is the listing this browser actually holds, not the rows
  // a narrowed projection shows: a media page or a filter shows fewer rows than
  // are loaded, and saying "40 of 960 loaded" there would understate what the
  // daemon already answered.
  const listingProgress = listingIncomplete
    ? <p className={`library-listing-progress ${library.libraryListingError ? "is-error" : ""}`} role="status" data-loaded={libraryItems.length} data-total={library.libraryTotal} data-listing-completeness={library.libraryListingComplete ? "COMPLETE" : library.libraryListingMore ? "MORE_AVAILABLE" : "BOUNDED_UNKNOWN"} data-listing-state={library.libraryListingError ? "ERROR" : library.libraryListingLoading ? "LOADING" : "IDLE"}>
        {library.libraryListingError
          ? t("{{loaded}} of {{total}} items loaded. The next page could not be read: {{message}}", { loaded: libraryItems.length, total: library.libraryTotal, message: library.libraryListingError })
          : library.libraryListingLoading
            ? t("Loading more items: {{loaded}} of {{total}} loaded…", { loaded: libraryItems.length, total: library.libraryTotal })
            : library.hasActiveFilters || !wallShowsWholeListing
              ? t("{{loaded}} of {{total}} items loaded. This screen shows the loaded items only.", { loaded: libraryItems.length, total: library.libraryTotal })
              : t("{{loaded}} of {{total}} items loaded.", { loaded: libraryItems.length, total: library.libraryTotal })}
        {library.libraryListingError && <button type="button" className="secondary-button compact" onClick={() => { void library.loadMoreLibrary(); }}>{t("Retry")}</button>}
        {library.libraryListingMore && !library.libraryListingError && <button type="button" className="secondary-button compact" disabled={library.libraryListingLoading || busy} onClick={() => { void library.loadMoreLibrary(); }}>{t("Load more content")}</button>}
      </p>
    : null;
  const resultCount = <span className="result-count">{activeRecalledView ? t("{{count}} loaded matches", { count: activeRecalledView.loadedCount }) : listingPositions ? t(viewMode === "search" ? "{{count}} results" : "{{count}} items", { count: listingPositions }) : workspaceID ? t("0 items") : t("Nothing added yet")}</span>;
  const scopeStatus = viewMode !== "sources" ? <>{resultCount}{listingProgress}</> : null;
  // Selection remains scoped to the currently displayed rows. Keep its bulk
  // action available on demand alongside the other secondary tools.
  const selectAllVisibleButton = !domainOwnsSelection && renderedHits.length > 0 && viewMode !== "sources" && selection.selectionRefs.length === 0
    ? <button type="button" className="secondary-button compact library-workflow-select-all" onClick={selection.selectAllVisible}><Check size={14} />{t("Select all visible")}</button>
    : null;
  const headingActions = <div className="heading-actions">
    {favoritesToggle}
    {sourceScopeActions}
    {viewMode !== "sources" && <>
      {filterActions}
      {sortControl}
      {layoutSwitch}
      {focusedComposition && savedRetrievalAction}
      {exportActions}
      {!focusedComposition && scopeStatus}
    </>}
  </div>;
  const secondaryTools = viewMode !== "sources" && scopeFacetItems.length > 0
    ? <section className="library-secondary-tools" aria-label={t("Browse tools")}>
        <span className="library-secondary-tools-label" aria-hidden="true">{t("Browse tools")}</span>
        <div className="library-tool-controls">
          {renderedHits.length > 0 && <details className="space-report" name="cairn-browse-statistics" data-total-bytes={spaceReport.totalBytes}>
            <summary><HardDrive size={14} /><span>{t("Space report")}</span><ChevronRight size={14} /></summary>
            <div className="space-report-body">
              <p className="space-report-note">{t("Computed in this browser over the current displayed scope; not a server query.")}{spaceReportPartial && <> {t("Unknown sizes are excluded from this partial total.")}</>}</p>
              <p className="space-report-total"><b>{formatBytes(spaceReport.totalBytes)}</b><span>{spaceReportPartial
                ? t("Known logical size over {{known}} of {{count}} visible items", { known: spaceReport.sizedItems, count: renderedHits.length })
                : t("Total logical size over {{count}} visible items", { count: renderedHits.length })}</span></p>
              {spaceReport.top.length > 0 && <div className="space-report-top" role="group" aria-label={t("Largest files")}>{spaceReport.top.map((entry) => <button type="button" key={entry.hit.subject_ref ?? entry.hit.entry_id ?? entry.hit.name} aria-label={t("Open {{name}}", { name: entry.hit.name ?? "" })} onClick={() => onOpenHit(entry.hit)}><strong>{entry.hit.name || t("Untitled subject")}</strong><b>{formatBytes(entry.size)}</b></button>)}</div>}
              {spaceReport.classes.length > 0 && <div className="space-report-classes"><span className="space-report-classes-label">{t("Bytes by media class (suffix-derived; known sizes only)")}</span>{spaceReport.classes.map((entry) => <span className="space-report-class" key={entry.class}><span>{t(entry.label)}</span><b>{formatBytes(entry.bytes)}</b></span>)}</div>}
            </div>
          </details>}
          <TimelineStrip t={t} items={scopeTimelineItems} activeMonth={activeTimelineMonth} onToggleMonth={library.toggleTimelineMonth} />
        </div>
      </section>
    : null;
  const tagBrowserItems = <>
    <div className="tag-browser-heading" title={t("Choose multiple tags to narrow the library.")}><Tag size={15} /><span>{t("Browse by tags")}</span><small>{t("Choose multiple tags to narrow the library.")}</small></div>
    <div className="tag-filter-list">
      <button type="button" className={`tag-filter all ${activeTags.length === 0 ? "active" : ""}`} aria-pressed={activeTags.length === 0} onClick={library.showFacetFilteredLibrary}><span>{t("All tags")}</span><b>{scopeMonthFilteredItems.length}</b></button>
      {tagFacets.map((facet) => <button type="button" key={facet.value} className={`tag-filter ${activeTags.includes(facet.value) ? "active" : ""}`} aria-pressed={activeTags.includes(facet.value)} aria-label={t("Filter by tag {{tag}}, {{count}} items", { tag: facet.value, count: facet.count })} onClick={() => library.toggleTagFilter(facet.value)}><span>{facet.value}</span><b>{facet.count}</b></button>)}
      {tagFacets.length === 0 && <span className="tag-filter-empty">{t("No tags yet")}</span>}
    </div>
    <details className="system-facets-disclosure">
    <summary className="system-facet-heading"><Hash size={14} /><span>{t("System fields")}</span><small>{t("Read-only type, format, dedup, and index facets")}</small><ChevronRight size={14} /></summary>
    <div className="system-facet-groups">
      <div className="system-facet-group"><span>{t("Type")}</span>{systemFacets.types.map((facet) => <button type="button" key={facet.value} className={`system-facet ${activeSystemFacets.type === facet.value ? "active" : ""}`} aria-pressed={activeSystemFacets.type === facet.value} onClick={() => library.toggleSystemFacet("type", facet.value)}><span>{formatEntryType(facet.value, t)}</span><b>{facet.count}</b></button>)}</div>
      <div className="system-facet-group"><span>{t("Format")}</span>{systemFacets.formats.length ? systemFacets.formats.map((facet) => <button type="button" key={facet.value} className={`system-facet ${activeSystemFacets.format === facet.value ? "active" : ""}`} aria-pressed={activeSystemFacets.format === facet.value} onClick={() => library.toggleSystemFacet("format", facet.value)}><span>{facet.value}</span><b>{facet.count}</b></button>) : <small className="facet-unavailable">{t("No file formats")}</small>}</div>
      <div className="system-facet-group"><span>{t("Dedup")}</span>{systemFacets.dedup.map((facet) => <button type="button" key={facet.value} className={`system-facet ${activeSystemFacets.dedup === facet.value ? "active" : ""}`} aria-pressed={activeSystemFacets.dedup === facet.value} onClick={() => library.toggleSystemFacet("dedup", facet.value)}><span>{formatDedupFacet(facet.value, t)}</span><b>{facet.count}</b></button>)}</div>
      <div className="system-facet-group"><span>{t("Coverage")}</span>{systemFacets.tags.map((facet) => <button type="button" key={facet.value} className={`system-facet ${activeSystemFacets.tags === facet.value ? "active" : ""}`} aria-pressed={activeSystemFacets.tags === facet.value} onClick={() => library.toggleSystemFacet("tags", facet.value)}><span>{t("Unmarked")}</span><b>{facet.count}</b></button>)}{systemFacets.index.map((facet) => <button type="button" key={facet.value} className={`system-facet ${activeSystemFacets.index === facet.value ? "active" : ""}`} aria-pressed={activeSystemFacets.index === facet.value} onClick={() => library.toggleSystemFacet("index", facet.value)}><span>{t("Index not ready")}</span><b>{facet.count}</b></button>)}{!systemFacets.tags.length && !systemFacets.index.length && <small className="facet-unavailable">{t("No incomplete coverage")}</small>}</div>
    </div></details>
  </>;
  const filterSummary = library.hasActiveFilters ? <div className="filter-summary" aria-label={t("Active filters")}><span className="filter-summary-label">{t("Active filters")}:</span>{activeTags.map((tag) => <button type="button" className="active-filter" key={tag} onClick={() => library.toggleTagFilter(tag)} aria-label={t("Remove tag filter {{tag}}", { tag })}><Tag size={11} />{tag}<X size={11} /></button>)}{activeTimelineMonth && <button type="button" className="active-filter" onClick={() => library.toggleTimelineMonth(activeTimelineMonth)} aria-label={t("Remove month filter {{month}}", { month: activeTimelineMonth })}><Calendar size={11} />{activeTimelineMonth}<X size={11} /></button>}{library.hasSystemFacets && <span className="filter-summary-system">{[activeSystemFacets.type ? `type:${formatEntryType(activeSystemFacets.type, t)}` : "", activeSystemFacets.format ? `format:${activeSystemFacets.format}` : "", activeSystemFacets.dedup ? `dedup:${formatDedupFacet(activeSystemFacets.dedup, t)}` : "", activeSystemFacets.tags ? t("Unmarked") : "", activeSystemFacets.index ? t("Index not ready") : ""].filter(Boolean).join(" + ")}</span>}<button type="button" className="filter-summary-clear" onClick={library.clearLibraryFilters}>{t("Clear filters")}</button></div> : null;
  const tagBrowser = showLibraryFacets ? <section className="tag-browser" aria-label={t("Filter by tags")}>
    {tagBrowserItems}
  </section> : null;
  const focusedLibraryTools = <div className="library-focused-bar">
    {!privateSpaceHome && showLibraryViewSwitch && <LibraryPresentationNavigation t={t} mode={presentationMode} enabledPageIds={enabledViews} onNavigate={onLibraryView} variant="presentations" />}
    {resultCount}
    <details className="library-tools">
      <summary className="library-tools-summary" aria-label={t("More options")} title={t("More options")}><MoreHorizontal size={18} aria-hidden="true" /><span className="sr-only">{t("More options")}</span></summary>
      <div className="library-tools-body">
        {headingActions}
        {secondaryTools}
        {tagBrowser}
      </div>
    </details>
  </div>;
  // Standard (non-focused) workflow disclosures. The Filters disclosure holds
  // the normal tag/system browser; More tools holds the secondary saved
  // retrieval, export, space report and timeline. Both keep every callback
  // and disabled check unchanged, and the active-filter summary stays outside.
  const filtersDisclosure = tagBrowser || favoritesToggle
    ? <details className="library-workflow-disclosure library-filters-disclosure">
        <summary><Tag size={14} /><span>{t("Filters")}</span><ChevronRight size={14} /></summary>
        <div className="library-workflow-disclosure-body">{favoritesToggle}{tagBrowser}</div>
      </details>
    : null;
  const viewOptionsDisclosure = !focusedComposition && viewMode !== "sources"
    ? <details className="library-workflow-disclosure library-view-options">
        <summary><LayoutGrid size={14} /><span>{t("View options")}</span><ChevronRight size={14} /></summary>
        <div className="library-workflow-disclosure-body">
          <LibraryPresentationNavigation t={t} mode={presentationMode} enabledPageIds={enabledViews} onNavigate={onLibraryView} variant="layouts" />
          {sortControl}
          {layoutSwitch}
        </div>
      </details>
    : null;
  // Export and Saved retrieval render only with a workspace (their disabled
  // state still shows while disconnected), and the browse tools only in
  // content/tag views. The fragment itself is always truthy, so test real availability.
  const moreToolsDisclosure = viewMode !== "sources" && (Boolean(workspaceID) || Boolean(secondaryTools))
    ? <details className="library-workflow-disclosure library-more-tools">
        <summary><span>{t("More tools")}</span><ChevronRight size={14} /></summary>
        <div className="library-workflow-disclosure-body">{selectAllVisibleButton}{savedRetrievalAction}{exportActions}{secondaryTools}</div>
      </details>
    : null;
  if (scopeRestoring || scopeRestoreFailed) {
    return <section className="content-column scope-restore-state" data-view={viewMode} data-presentation={presentationMode}>
      {isConnected && !coreStorageReady ? <div className="notice error" role="alert"><AlertCircle size={16} />{coreStorageMessage}</div> : isUnavailable ? <div className="service-offline" role="alert"><span><Server size={18} /></span><div><strong>{t("Cairn service is unavailable")}</strong><small>{t("Start the service, then refresh this page. Saved content has not been changed.")}</small></div><button className="secondary-button compact" onClick={refresh}><RefreshCw size={15} />{t("Retry")}</button></div> : notice && <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.kind === "error" ? <AlertCircle size={16} /> : notice.kind === "warning" ? <Sparkles size={16} /> : <Check size={16} />}{notice.text}<button aria-label={t("Dismiss notice")} onClick={onClearNotice}><X size={14} /></button></div>}
      <div className="empty-state" role={scopeRestoreFailed ? "alert" : "status"}>
        <h1>{t(scopeRestoreFailed ? "Your view could not be restored. The original link is retained; search again or choose a view." : "Restoring your content view…")}</h1>
        {scopeRestoreFailed && <button type="button" className="secondary-button compact" onClick={() => onLibraryView("content")}>{t("All types")}</button>}
      </div>
    </section>;
  }
  if (activeTags.length > 0 && (library.tagStatus === "unavailable" || !library.tagSnapshotKnown)) {
    return <section className="content-column" data-view={viewMode} data-presentation={presentationMode}>
      {notice && <div className={`notice ${notice.kind}`} role="status">{notice.text}</div>}
      <div className="empty-state" role={library.tagStatus === "unavailable" ? "alert" : "status"}>
        <h1>{t(library.tagStatus === "unavailable" ? "Tags and favorites could not be read. Retry before editing them." : "Loading tags and favorites…")}</h1>
        {library.tagStatus === "unavailable" && <button type="button" className="secondary-button" onClick={() => { void library.loadTagVocabulary(workspaceID); }}>{t("Reload tags and favorites")}</button>}
        <button type="button" className="secondary-button" onClick={library.clearLibraryFilters}>{t("Clear filters")}</button>
      </div>
    </section>;
  }
  // A saved view this browser could not open has no membership. The previous
  // view's "live evaluation"/"opened" claim and its hits were dropped when the
  // request failed, so this surface explains the failure instead of letting
  // either the earlier success claim or a widened result set stand in for it.
  if (viewMode === "search" && retrievalFlow.failedRecall) {
    return <section className="content-column" data-view={viewMode} data-presentation={presentationMode}>
      <div className="empty-state" role="alert">
        <h1>{t("This saved view could not be opened: {{name}}", { name: retrievalFlow.failedRecall.name })}</h1>
        <p>{t("No results are shown for it. The stored conditions were refused rather than dropped, so this view's membership is unknown and the previous view's results are no longer displayed.")}</p>
        <div className="notice error"><AlertCircle size={16} />{retrievalFlow.failedRecall.message}</div>
        {savedRetrievalAction}
        <button type="button" className="secondary-button" onClick={library.clearSearchScope}>{t("All content")}</button>
      </div>
      {retrievalOpen && <div id="saved-retrieval-panel">{savedRetrievalPanel}</div>}
    </section>;
  }
  return <section className={`content-column ${isMediaView ? "library-type-view" : ""}`} data-view={viewMode} data-presentation={presentationMode} data-content-space-target={viewMode === "content" && presentationMode === "content" ? "library" : undefined} tabIndex={viewMode === "content" && presentationMode === "content" ? -1 : undefined}>
    {/* The rail is hidden on phones; this compact entry drives the same
        sources mode and is hidden again from 641px up by CSS alone. */}
    <button type="button" className={`sources-entry ${viewMode === "sources" ? "active" : ""}`} onClick={library.showSourcesSurface}><HardDrive size={16} /><span>{t("Sources")}</span><small>{sources.sources.length}</small></button>
    {!isMediaView && <div className="workspace-heading">
      <div>
        <p className="eyebrow">{t(viewMode === "sources" ? "CONTENT" : "YOUR LIBRARY")}</p>
        <h1>{isPhotoView ? t("Photos") : isMusicView ? t("Audio") : viewMode === "sources" ? t("Sources") : viewMode === "search" ? searchHeading : viewMode === "tag" ? tagHeading : viewMode === "path" ? library.justSavedBatch ? t("Just saved") : browseCrumbs.at(-1)?.name || t("Source paths") : t("All content")}</h1>
        {viewMode === "path" && library.justSavedBatch && <p className="library-summary">{t("These are the exact files confirmed in the latest save. Select or open them to continue.")}</p>}
      </div>
    </div>}
    {library.libraryLoaded && library.tagStatus !== "ready" && <div className={`notice ${library.tagStatus === "unavailable" ? "warning" : "info"}`} role="status">{t(library.tagStatus === "unavailable" ? "Tags and favorites could not be read. Retry before editing them." : "Loading tags and favorites…")}{library.tagStatus === "unavailable" && <button type="button" className="secondary-button compact" onClick={() => { void library.loadTagVocabulary(workspaceID); }}>{t("Reload tags and favorites")}</button>}</div>}
    <div className={`library-controls${focusedComposition ? " library-controls--focused" : ""}`}>
      {focusedComposition ? <>
        {!privateSpaceHome && focusedLibraryTools}
        {listingProgress}
        {filterSummary}
      </> : viewMode === "sources" ? <>
        {headingActions}
      </> : <>
        <div className="library-workflow-bar" data-workflow="standard">
          {filterActions}
          {resultCount}
          {viewOptionsDisclosure}
          {filtersDisclosure}
          {moreToolsDisclosure}
        </div>
        {listingProgress}
        {filterSummary}
      </>}
    </div>
    {retrievalOpen && <div id="saved-retrieval-panel">{savedRetrievalPanel}</div>}
    {(viewMode === "search" || viewMode === "tag") && <section className={`library-result-scope${isMediaView ? " library-result-scope--media" : ""}`} aria-label={t("Current result scope")}>
      {isMediaView && <strong>{viewMode === "search" ? (lastExecutedQuery.trim() ? t("Results for \"{{query}}\"", { query: lastExecutedQuery }) : t(isVideoView ? "Video search results" : isMusicView ? "Audio search results" : "Image search results")) : tagHeading}</strong>}
      {isMediaView ? <>
        <p>{t("{{count}} items in this result view", { count: isPhotoView ? photoScopeCount : isMusicView ? musicScopeCount : isVideoView ? videoScopeCount : scopeCount })}{viewMode === "search" && <> · {t("Returned results may be limited.")}</>}</p>
        {viewMode === "search" && <button type="button" className="library-return" onClick={library.clearSearchScope}><X size={14} />{t("Clear search")}</button>}
        <details className="library-result-scope-details"><summary>{t("About these results")}</summary>
          <p>{t(viewMode === "search" ? "Among returned results: {{photos}} photos, {{music}} audio, {{videos}} videos, {{other}} other items. Display changes keep this query and relevance order." : "Within this filtered listing: {{photos}} photos, {{music}} audio, {{videos}} videos, {{other}} other items.", { photos: photoScopeCount, music: musicScopeCount, videos: videoScopeCount, other: otherScopeCount })}</p>
          {viewMode === "search" && <small>{t("These counts cover the returned results, which may be limited; they are not full-library matching totals.")}</small>}
        </details>
      </> : <>
        <p>{t(viewMode === "search" ? "Among returned results: {{photos}} photos, {{music}} audio, {{videos}} videos, {{other}} other items. Display changes keep this query and relevance order." : "Within this filtered listing: {{photos}} photos, {{music}} audio, {{videos}} videos, {{other}} other items.", { photos: photoScopeCount, music: musicScopeCount, videos: videoScopeCount, other: otherScopeCount })}</p>
        {viewMode === "search" && <small>{t("These counts cover the returned results, which may be limited; they are not full-library matching totals.")}</small>}
      </>}
      {viewMode === "search" && keywordBrowse && <div className="keyword-browse" role="status" aria-live="polite">
        <div>
          <strong>{keywordPageApplied ? (keywordBrowse.query.trim() ? t("Matching results for \"{{query}}\"", { query: keywordBrowse.query }) : t("Matching results")) : t("More matching results")}</strong>
          {keywordBrowse.phase === "available" && <small>{t("Browse keyword and filter matches for this search. Opening this view replaces the displayed results; return to restore the ranked results.")}</small>}
          {keywordBrowse.phase === "loading-first" && <small>{t("Loading matching results…")}</small>}
          {keywordBrowse.phase === "more" && <small>{t("{{count}} matching results loaded. More are available.", { count: keywordBrowse.loaded })}</small>}
          {keywordBrowse.phase === "loading-more" && <small>{t("Loading the next page of matching results…")}</small>}
          {keywordBrowse.phase === "complete" && <small>{t("All matching results loaded: {{count}}.", { count: keywordBrowse.loaded })}</small>}
          {keywordBrowse.phase === "bounded" && <small>{t("The server cannot confirm whether more matching results exist. Current results were left unchanged.")}</small>}
          {keywordBrowse.phase === "first-error" && <small>{t("Could not load matching results: {{reason}}", { reason: keywordBrowse.error })}</small>}
          {keywordBrowse.phase === "more-error" && <small>{t("Could not load the next page of matching results: {{reason}}", { reason: keywordBrowse.error })}</small>}
          {keywordBrowse.phase === "stale" && <small>{t("The next matching results page was refused: {{reason}}. Restart browsing to continue.", { reason: keywordBrowse.error })}</small>}
          {keywordPageApplied && <small>{t("This view includes keyword and filter matches only; meaning-based suggestions are excluded.")}</small>}
        </div>
        {keywordBrowse.phase !== "complete" && keywordBrowse.phase !== "bounded" && <button type="button" className="secondary-button compact" disabled={busy || keywordBrowse.phase === "loading-first" || keywordBrowse.phase === "loading-more"} onClick={onRunKeywordBrowseAction}>
          {keywordBrowse.phase === "available" && t("Browse matching results")}
          {keywordBrowse.phase === "loading-first" && t("Loading matching results…")}
          {keywordBrowse.phase === "more" && t("Load more matching results")}
          {keywordBrowse.phase === "loading-more" && t("Loading matching results…")}
          {keywordBrowse.phase === "first-error" && t("Retry matching results")}
          {keywordBrowse.phase === "more-error" && t("Retry matching results page")}
          {keywordBrowse.phase === "stale" && t("Restart matching results")}
        </button>}
        {canReturnToRanked && <button type="button" className="secondary-button compact" disabled={busy} onClick={onReturnToRanked}>{t("Return to ranked results")}</button>}
      </div>}
      {(isPhotoView || isMusicView || isVideoView) && renderedHits.length === 0 && <div className="library-result-scope__empty" role="status"><span>{t(isPhotoView ? "No photos among these {{count}} scoped results." : isMusicView ? "No audio among these {{count}} scoped results." : "No videos among these {{count}} scoped results.", { count: scopeCount })}</span><button type="button" className="secondary-button compact" onClick={() => onLibraryView("content")}>{t("Show all returned types")}</button></div>}
    </section>}
    {activeRecalledView && <div className={`recall-caption ${activeRecalledView.state.toLowerCase()}${activeRecalledView.pageState === "stale" ? " stale" : ""}`} role={activeRecalledView.state === "DEGRADED" || activeRecalledView.pageState === "stale" ? "alert" : "status"}>
      <Sparkles size={15} /><div>
        <strong>{activeRecalledView.pageState === "stale"
          ? t("Saved-view results need refresh: {{name}}", { name: activeRecalledView.name })
          : t("Live evaluation of saved view \"{{name}}\"", { name: activeRecalledView.name })}</strong>
        <small>{activeRecalledView.totalCount === undefined
          ? t("{{count}} loaded matches", { count: activeRecalledView.loadedCount })
          : t("{{loaded}} of {{total}} saved results loaded.", { loaded: activeRecalledView.loadedCount, total: activeRecalledView.totalCount })}</small>
        {activeRecalledView.pageState === "more" && <small className="recall-caption-detail">{t("More results are available for this saved view.")}</small>}
        {activeRecalledView.pageState === "paging" && <small className="recall-caption-detail">{t("Loading the next saved-view page…")}</small>}
        {activeRecalledView.pageState === "stale" && <small className="recall-caption-detail">{t("These saved-view results are no longer shown as current. Reopen the view to load a fresh result scope.")}</small>}
        {activeRecalledView.state !== "EMPTY" && <small>{t("Membership is dynamic: re-running this view can return a different set of subjects as content and indexes change.")}</small>}
        {activeRecalledView.foreignScope && <small className="recall-caption-detail">{t("This saved view was stored for content other than what is open here. Its results came from that stored scope, not from the content open here.")}</small>}
        {activeRecalledView.message && <small className="recall-caption-detail">{activeRecalledView.message}</small>}
      </div>
      {activeRecalledView.pageState === "more" && <button type="button" className="secondary-button compact" disabled={busy} onClick={() => void retrievalFlow.continueRecalledViewPage()}>{t("Load more saved results")}</button>}
      {activeRecalledView.pageState === "paging" && <button type="button" className="secondary-button compact" disabled>{t("Loading saved results…")}</button>}
      {activeRecalledView.pageState === "stale" && <button type="button" className="secondary-button compact" disabled={busy} onClick={() => void retrievalFlow.refreshRecalledView()}>{t("Refresh saved results")}</button>}
    </div>}
    {viewMode === "search" && executedPlan.overLoadedResults.length > 0 && <div className="search-ops-notice" role="status"><AlertCircle size={15} /><div><strong>{t("Evaluated over the loaded results")}</strong><small>{t("{{tokens}} cannot be expressed by the daemon's search.query, so this browser applied it to the hits this query returned. Hits without a recorded content id, size, or modification time are not classified.", { tokens: overLoadedTokens })}</small></div></div>}
    {!isMediaView && (viewMode === "content" || viewMode === "tag") && browseRoots.length > 1 && <div className="source-aux-row">
      <details className="source-disclosure"><summary><Folder size={14} /><span>{t("Browse source paths")}</span><small>{t("Source paths are provenance")}</small><ChevronRight size={14} /></summary><div className="source-switcher" aria-label={t("Source paths")}>{browseRoots.map((root) => { const label = sourceButtonLabel(root, browseRoots, t); const path = root.source_path?.trim(); return <button type="button" key={root.root_id} title={path || label} aria-label={path ? t("Browse source {{name}} at {{path}}", { name: root.name || t("Source path"), path }) : label} onClick={() => void library.navigateLibrary("", [], root.root_id)}><Folder size={14} />{label}</button>; })}</div></details>
    </div>}
    {viewMode === "path" && browseRootID && <nav className="breadcrumbs" aria-label={t("Source paths")}><button title={t("Source paths")} aria-label={t("Source path root")} onClick={() => void library.navigateLibrary("", [])}><Home size={14} /></button>{browseCrumbs.map((crumb, index) => <span key={crumb.entry_id}><ChevronRight size={13} /><button onClick={() => void library.navigateLibrary(crumb.entry_id || crumb.subject_ref, browseCrumbs.slice(0, index + 1))}>{crumb.name}</button></span>)}</nav>}
    {isConnected && !coreStorageReady ? <div className="notice error" role="alert"><AlertCircle size={16} />{coreStorageMessage}</div> : isUnavailable ? <div className="service-offline" role="alert"><span><Server size={18} /></span><div><strong>{t("Cairn service is unavailable")}</strong><small>{t("Start the service, then refresh this page. Saved content has not been changed.")}</small></div><button className="secondary-button compact" onClick={refresh}><RefreshCw size={15} />{t("Retry")}</button></div> : notice && <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.kind === "error" ? <AlertCircle size={16} /> : notice.kind === "warning" ? <Sparkles size={16} /> : <Check size={16} />}{notice.text}<button aria-label={t("Dismiss notice")} onClick={onClearNotice}><X size={14} /></button></div>}
    {viewMode === "content" && libraryItems.length === 1 && firstSavedFile && !library.hasActiveFilters && sources.sourceProjection.state !== "DEGRADED" && <details className="first-use-next-step">
      <summary>{t("Next: find, add a Note, and take out this file")}</summary>
      <p>{t("Search the library, open this file to add a Note or tag, then download the original from its details.")}</p>
      <div className="first-use-actions"><button type="button" className="secondary-button compact" onClick={onFocusSearch}>{t("Search the library")}</button><button type="button" className="secondary-button compact" onClick={() => onOpenHit(firstSavedFile)}>{t("Open {{name}}", { name: firstSavedFile.name || t("saved file") })}</button></div>
    </details>}
    {viewMode === "sources" ? <SourcesSurface t={t} locale={locale} sources={sources.sources} staging={sources.staging} stagingBusy={sources.stagingBusy} sourceProjection={sources.sourceProjection} sourceChanges={sources.sourceChanges} busy={busy} coreStorageReady={coreStorageReady} isConnected={isConnected} onViewSource={onViewSource} onRecheckSource={onRecheckSource} onOpenAdd={onOpenAdd} onIngestStaged={() => sources.ingestStaged()} onCleanStaged={() => void sources.cleanStaged()} /> : renderedHits.length || isMediaView || selection.tagMutationProgress ? <>
      {!isMediaView && hiddenSelectionCount > 0 && <p className="library-selection-scope" role="status">{t("{{count}} selected items are outside this display. Batch actions still include them.", { count: hiddenSelectionCount })}</p>}
      {(selection.selectionRefs.length > 0 || selection.tagMutationProgress) && <details
        ref={selectionActionsDisclosureRef}
        className={`selection-actions-disclosure${isMediaView ? " is-media" : ""}`}
        open={!isMediaView || Boolean(selection.tagMutationProgress) || undefined}
        onToggle={() => {
          if (selection.tagMutationProgress && !selectionActionsDisclosureRef.current?.open) {
            requestAnimationFrame(() => { if (selectionActionsDisclosureRef.current) selectionActionsDisclosureRef.current.open = true; });
          }
        }}
      >
        <summary className={isMediaView ? undefined : "is-hidden"}>
          {isMediaView && <>
            <strong>{t("Selection actions ({{count}})", { count: selection.selectionRefs.length })}</strong>
            {hiddenSelectionCount > 0 && <small>{t("{{hidden}} of {{selected}} selected items are outside this display; expanded actions apply to all.", { hidden: hiddenSelectionCount, selected: selection.selectionRefs.length })}</small>}
            {selection.selectionRefs.length > selection.selectionSubjects.length && <small>{t("{{count}} selected items are unresolved.", { count: selection.selectionRefs.length - selection.selectionSubjects.length })}</small>}
          </>}
        </summary>
        <div ref={selectionActionsRef} className="selection-actions-focus-target" role="group" tabIndex={-1} aria-label={t("Selection actions")}><SelectionBar count={selection.selectionSubjects.length} subjects={selection.selectionSubjects} unresolvedCount={selection.selectionRefs.length - selection.selectionSubjects.length} workspaceID={workspaceID} locale={locale} viewMode={viewMode} query={lastExecutedQuery} tagDraft={selection.selectionTagDraft} tagActionsReady={selection.tagActionsReady} tagActionsUnavailableMessage={selection.tagActionsUnavailableMessage} tagMatchCount={selection.selectionTagMatchCount} favoriteMatchCount={selection.selectionTagMatchCount(FAVORITE_TAG)} busy={busy} originalTakeoutBusy={originalTakeoutBusy} t={t} onSelectAll={domainOwnsSelection ? undefined : selection.selectAllVisible} onInvertSelection={domainOwnsSelection ? undefined : selection.invertVisibleSelection} onExport={(trigger) => onOpenExport(trigger, selection.selectionSubjects)} onDownloadOriginals={onDownloadOriginals} onCreateMaterialList={onCreateMaterialList} materialListCreationDisabled={materialListCreationDisabled} onTagDraft={selection.setSelectionTagDraft} onApplyTag={() => void selection.applySelectionTag()} tagQueue={selection.selectionTagQueue} tagQueueDraft={selection.selectionTagQueueDraft} onTagQueueDraft={selection.setSelectionTagQueueDraft} onAddQueuedTag={selection.addSelectionTagToQueue} onRemoveQueuedTag={selection.removeQueuedSelectionTag} onClearQueuedTags={selection.clearQueuedSelectionTags} onApplyQueuedTags={() => void selection.applySelectionTagQueue()} onRemoveTag={() => void selection.removeSelectionTag()} onAddFavorite={() => void selection.addSelectionFavorite()} onRemoveFavorite={() => void selection.removeSelectionFavorite()} onClear={selection.clearSelection} onImageSearch={onImageSearch} tagMutationProgress={selection.tagMutationProgress} onStopTagMutation={selection.stopSelectionTagMutation} onRefreshTagState={() => void selection.refreshSelectionTagState()} /></div>
      </details>}
      {isMediaView ? <LibraryPageHost
        mode={presentationMode} enabledPageIds={enabledViews} resultProps={resultProps}
        onOpenHit={onOpenHit} focusedSubjectRef={focusedSubjectRef} focusRequest={focusRequest} onFocusSubject={onFocusSubject}
        onPlayTrack={onPlayTrack} onQueueTrack={onQueueTrack} onPlayTracks={onPlayTracks}
        musicMetadata={musicMetadata} favoriteControls={favoriteControls} musicQueueControls={musicQueueControls} photoLoading={!library.libraryLoaded}
        onShowSelectionActions={showSelectionActions}
        onSelectSubjects={selection.changeScopeSelection}
        onImageSearch={onImageSearch}
        onVisualTextSearch={onVisualTextSearch}
        imageSearchBusy={busy}
        onDownloadOriginals={onDownloadOriginals}
        originalTakeoutBusy={originalTakeoutBusy}
        onCreateMaterialList={onCreateMaterialList}
        materialListCreationDisabled={materialListCreationDisabled || busy}
        onReturnToWall={() => onLibraryView(returnToPhotoWall ? "photos" : "content")}
        onNavigate={onLibraryView}
        returnLabel={exhibitionReturnLabel}
        onFallback={() => onLibraryView("content")}
      /> : <ResultList {...resultProps} onExtendSelection={selection.extendSelectionTo} />}
    </> : <div className={`empty-state ${isMediaView ? "media-empty-state" : ""}`}>{isMediaView ? <span className="media-empty-icon" aria-hidden="true">{isPhotoView ? <Image size={20} /> : <Music2 size={20} />}</span> : <span className="vault-sigil"><ShieldCheck size={35} /></span>}{showLibraryOnboarding ? <>
      <h2>{t("The loaded listing is empty")}</h2>
      <ol className="onboarding-steps">
        <li><b>{t("Choose files or a server folder")}</b><span>{t("Upload files from this browser, or inspect a folder already available on the Cairn host.")}</span><button className="primary-button" onClick={(event) => onOpenAdd(event.currentTarget)} disabled={!coreStorageReady}><Plus size={16} />{t("Choose content")}</button></li>
        <li><b>{t("Review before saving")}</b><span>{t("Review the plan, then confirm to save the original bytes. Uploaded files remain unprotected until you confirm.")}</span></li>
        <li><b>{t("Find and take out")}</b><span>{t("Search by name, tag, or note. Open a file to add context, then download its original copy.")}</span></li>
      </ol>
    </> : <>
      {viewMode === "content" && sources.sourceProjection.state === "DEGRADED" && <p className="notice warning" role="status">{t("Source status could not be read, so this empty listing may be incomplete. Retry before adding content.")}<button type="button" className="secondary-button compact" onClick={refresh}>{t("Retry")}</button></p>}
      <h2>{t(showFilteredContentEmpty ? "No content matches these filters" : showFirstSource ? "Start by adding a source" : showConfiguredSourceEmpty ? "Source configured, no saved content yet" : viewMode === "search" ? "No matches found" : viewMode === "tag" ? activeTags.length ? "No content matches these tags" : library.hasSystemFacets ? "No content matches these filters" : "No content matches these tags" : viewMode === "path" ? "This source path is empty" : isPhotoView ? "No photos in the loaded listing" : isMusicView ? "No audio files in the loaded listing" : "No content yet")}</h2><p>{t(showFilteredContentEmpty ? "Adjust or clear these filters." : showFirstSource ? "Add a server folder, review what will be stored, then confirm." : showConfiguredSourceEmpty ? "Recheck creates a reviewable plan. Existing saved content is not changed until you confirm." : viewMode === "search" ? "Try another name, path, metadata value, tag, note, or extracted phrase." : viewMode === "tag" ? activeTags.length ? "Choose fewer tags to broaden the result." : library.hasSystemFacets ? "Adjust or clear the system filters." : "Choose fewer tags to broaden the result." : viewMode === "path" ? "No captured items are recorded at this source path." : isPhotoView ? "Regular files with recognized image filename suffixes appear here." : isMusicView ? "Regular files with recognized audio filename suffixes appear here." : "Saved content will appear here independent of its original folders.")}</p>
      {/* A filter that matches nothing among the loaded entries must not claim
          the whole collection was searched: the wall is not mounted, so no page
          boundary can fetch the rest, and the empty heading would otherwise
          read as "the library has no match". */}
      {listingIncomplete && library.hasActiveFilters && renderedHits.length === 0 && <p className="library-listing-progress" role="status" data-listing-state="IDLE" data-loaded={libraryItems.length} data-total={library.libraryTotal}>{t("Only the {{loaded}} loaded items of {{total}} have been filtered so far; the rest of the listing is not loaded yet.", { loaded: libraryItems.length, total: library.libraryTotal })}</p>}
      {showFirstSource && <button className="primary-button" onClick={(event) => onOpenAdd(event.currentTarget)} disabled={!coreStorageReady}><Plus size={16} />{t("Add content")}</button>}
    </>}</div>}
  </section>;
}
