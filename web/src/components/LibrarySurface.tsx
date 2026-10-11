import { AlertCircle, ArrowDown, ArrowUp, Calendar, Check, ChevronRight, Download as DownloadIcon, Folder, HardDrive, Home, Image, LayoutGrid, Hash, List as ListIcon, Music2, Plus, RefreshCw, Server, ShieldCheck, Sparkles, Tag, X } from "lucide-react";
import { useMemo, useState } from "react";
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
import type { AudioTrack } from "../lib/audioPlayback";
import { SelectionBar } from "./SelectionBar";
import { SourcesSurface } from "./SourcesSurface";
import { TimelineStrip } from "./TimelineStrip";
import { sourceButtonLabel } from "../lib/format";
import { formatBytes, formatDedupFacet, formatEntryType, mediaContentItems, spaceReportProjection } from "../lib/format";
import { allLibraryViewIds, libraryPageForMode, type LibraryViewId } from "../lib/libraryViews";
import { parseSearchQuery, searchPlan } from "../lib/searchops";
import type { LibraryFlow } from "../app/useLibrary";
import type { SelectionFlow } from "../app/useSelection";
import type { SourcesFlow } from "../app/useSources";
import type { ViewModeFlow } from "../app/useViewMode";
import type { Command, Notice, RowClickEvent, SearchHit, SourceSummary, ViewMode, LibraryPageMode } from "../lib/types";

// The library column: view heading, its controls, filters, notices, and the
// current view's content (the result list or the configured sources).
//
// Every control here changes a browser projection or opens a drawer; none of
// them writes durable state directly.

export function LibrarySurface({ t, locale, workspaceID, viewMode, onLibraryView, enabledViews = allLibraryViewIds, library, selection, sources, view, command, selectedRef, showFirstSource, recalledView, lastExecutedQuery, sortAvailable, canOpenExport, isConnected, isUnavailable, coreStorageReady, coreStorageMessage, notice, busy, scopeRestoring = false, scopeRestoreFailed = false, originalTakeoutBusy = false, onDownloadOriginals, refresh, onOpenAdd, onViewSource, onRecheckSource, onRowClick, onLibraryKeyDown, onOpenExport, onClearNotice, onImageSearch, onOpenHit, onFocusSearch, libraryListRef, onPlayTrack, onQueueTrack, onPlayTracks, musicMetadata, favoriteControls, musicQueueControls, focusedSubjectRef, onFocusSubject, retrievalFlow }: {
  t: Translator;
  locale: Locale;
  workspaceID: string;
  viewMode: ViewMode;
  onLibraryView: (mode: "content" | LibraryPageMode) => void;
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
  onFocusSubject: (subjectRef: string) => void;
  retrievalFlow: ExportFlow;
}) {
  const [retrievalOpen, setRetrievalOpen] = useState(false);
  const { hits, libraryItems, activeTags, activeSystemFacets, activeTimelineMonth, monthFilteredItems, browseRoots, browseRootID, browseCrumbs, tagFacets, systemFacets, renderedHits, identityCounts, tagsBySubject } = library;
  // The executed query is re-parsed here only to label what the daemon could
  // not express: those predicates were applied over the hits the query
  // returned, and the result set says so instead of implying a server filter.
  const executedPlan = useMemo(() => searchPlan(parseSearchQuery(lastExecutedQuery)), [lastExecutedQuery]);
  const overLoadedTokens = executedPlan.overLoadedResults.map((predicate) => predicate.raw).join(", ");
  const showConfiguredSourceEmpty = viewMode === "content" && libraryItems.length === 0 && sources.sources.length > 0;
  const showFilteredContentEmpty = viewMode === "content" && library.hasActiveFilters && renderedHits.length === 0;
  const presentationMode = viewMode === "content" || viewMode === "search" || viewMode === "tag" || Boolean(libraryPageForMode(viewMode)) ? view.presentationMode : viewMode;
  const showLibraryFacets = (viewMode === "content" || viewMode === "tag" || viewMode === "search" || Boolean(libraryPageForMode(viewMode))) && libraryItems.length > 0;
  // The space report and the timeline strip are browser-local projections over
  // the loaded listing; the onboarding guide only replaces the empty state
  // when nothing filters it, so a filtered-empty view keeps its own honest style.
  const spaceReport = useMemo(() => spaceReportProjection(libraryItems), [libraryItems]);
  const showLibraryOnboarding = viewMode === "content" && libraryItems.length === 0 && !library.hasActiveFilters && sources.sourceProjection.state !== "DEGRADED";
  const pageDefinition = libraryPageForMode(presentationMode);
  const photoWallPage = libraryPageForMode("photos");
  const photoWallEnabled = Boolean(photoWallPage && enabledViews.has(photoWallPage.id));
  const returnToPhotoWall = pageDefinition?.mediaClass === "image" && photoWallEnabled;
  const exhibitionReturnLabel = t(returnToPhotoWall ? "Return to photo wall" : "All types");
  const isPhotoView = pageDefinition?.mediaClass === "image";
  const isMusicView = pageDefinition?.mediaClass === "audio";
  const isMediaView = Boolean(pageDefinition);
  const showLibraryViewSwitch = library.libraryLoaded && libraryItems.length > 0 && (isMediaView || viewMode === "content" || viewMode === "search" || viewMode === "tag");
  const scopeCount = library.scopeHits.length;
  const photoScopeCount = mediaContentItems(library.scopeHits, "image").length;
  const musicScopeCount = mediaContentItems(library.scopeHits, "audio").length;
  const otherScopeCount = scopeCount - photoScopeCount - musicScopeCount;
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
  const supportedSavedFields = new Set(["entry_type", "content_id", "duplicate_group", "protection_mode", "suffix", "language", "size_min", "size_max", "mtime_after", "mtime_before"]);
  // A recalled view is active only while the library is still showing the
  // result set recall produced. Recall is the only path that sets this state,
  // and any later search clears it in useExport.invalidateForSearch, so the
  // caption and the saved-retrieval preview never label a result set with a
  // view whose stored conditions did not produce it.
  const recalledViewActive = Boolean(recalledView && viewMode === "search" && lastExecutedQuery === recalledView.query);
  const activeRecalledView = recalledViewActive ? recalledView : undefined;
  // A recalled view hands the panel every stored condition, including one this
  // build cannot name: the panel renders an unknown condition raw and marks it,
  // so a stored-but-unlabelled condition is disclosed instead of hidden. The
  // live branch keeps its existing behaviour of passing only the conditions
  // this build understands; the rest are listed as unsupported conditions.
  const retrievalFields = activeRecalledView
    ? [...(activeRecalledView.fields ?? [])]
    : Object.entries(executedPlan.request.filters).filter(([key]) => supportedSavedFields.has(key)).map(([key, value]) => `${key}=${value}`);
  const unsupportedRetrievalConditions = [
    ...(pageDefinition?.mediaClass === "image" || pageDefinition?.mediaClass === "audio" ? [t("Switch to All types before saving this retrieval; a display choice is not a saved query condition.")] : []),
    ...(viewMode !== "search" ? [t("Run a keyword search before saving a retrieval.")] : []),
    ...Object.keys(executedPlan.request.filters).filter((key) => !supportedSavedFields.has(key)).map((key) => key === "media_class" ? t("Type") + ": " + executedPlan.request.filters.media_class : key),
    ...(executedPlan.axesRestricted ? [executedPlan.request.construct_axes?.join(", ") || "construct_axes"] : []),
    ...executedPlan.overLoadedResults.map((predicate) => predicate.raw),
    ...activeTags.map((tag) => `tag:${tag}`),
    ...Object.entries(activeSystemFacets).filter(([, value]) => Boolean(value)).map(([key, value]) => `${key}:${value}`),
    ...(activeTimelineMonth ? [activeTimelineMonth] : []),
    // A recalled query may contain stored fields absent from its displayed text.
    ...(recalledViewActive ? [t("Recalled view conditions are not editable here. Run a new search to save changes.")] : []),
  ];
  const resultProps = { hits: renderedHits, libraryListRef, libraryLayout: view.libraryLayout, sortField: view.sortField, sortDirection: view.sortDirection, selectionCount: selection.selectionSubjects.length, rovingRow: selection.rovingRow, selectedRef, selectionRefs: selection.selectionRefs, identityCounts, tagsBySubject, viewMode, locale, t, command, workspaceID, onRowClick, onToggleSelection: selection.toggleSelectionAt, onKeyDown: onLibraryKeyDown, listingPositions, onLoadMore: wallCanLoadMore ? library.loadMoreLibrary : undefined };
  const savedRetrievalPanel = <SavedRetrievalPanel flow={retrievalFlow} query={executedPlan.request.query} fields={retrievalFields} unsupportedConditions={unsupportedRetrievalConditions} workspaceID={workspaceID} recalledActive={recalledViewActive} t={t} busy={busy} />;
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
        <button type="button" className="secondary-button" onClick={library.clearSearchScope}>{t("All content")}</button>
      </div>
      {retrievalOpen && <div id="saved-retrieval-panel">{savedRetrievalPanel}</div>}
    </section>;
  }
  return <section className={`content-column ${isMediaView ? "library-type-view" : ""}`} data-view={viewMode} data-presentation={presentationMode}>
    {/* The rail is hidden on phones; this compact entry drives the same
        sources mode and is hidden again from 641px up by CSS alone. */}
    <button type="button" className={`sources-entry ${viewMode === "sources" ? "active" : ""}`} onClick={library.showSourcesSurface}><HardDrive size={16} /><span>{t("Sources")}</span><small>{sources.sources.length}</small></button>
    {!isMediaView && <div className="workspace-heading">
      <div>
        <p className="eyebrow">{t(viewMode === "sources" ? "CONTENT" : "YOUR LIBRARY")}</p>
        <h1>{isPhotoView ? t("Photos") : isMusicView ? t("Audio") : viewMode === "sources" ? t("Sources") : viewMode === "search" ? (lastExecutedQuery.trim() ? t("Results for \"{{query}}\"", { query: lastExecutedQuery }) : t("Image search results")) : viewMode === "tag" ? activeTags.length ? t("Content tagged {{tags}}", { tags: activeTags.join(" + ") }) : t("Filtered content") : viewMode === "path" ? browseCrumbs.at(-1)?.name || t("Source paths") : t("All content")}</h1>
        {viewMode === "content" && <p className="library-summary">{t("Find saved content, select what you need, and export a verified copy.")}</p>}
      </div>
    </div>}
    {library.libraryLoaded && library.tagStatus !== "ready" && <div className={`notice ${library.tagStatus === "unavailable" ? "warning" : "info"}`} role="status">{t(library.tagStatus === "unavailable" ? "Tags and favorites could not be read. Retry before editing them." : "Loading tags and favorites…")}{library.tagStatus === "unavailable" && <button type="button" className="secondary-button compact" onClick={() => { void library.loadTagVocabulary(workspaceID); }}>{t("Reload tags and favorites")}</button>}</div>}
    <div className="library-controls">
      {showLibraryViewSwitch && <LibraryPresentationNavigation t={t} mode={presentationMode} enabledPageIds={enabledViews} onNavigate={onLibraryView} />}
      <div className="heading-actions">
        {library.libraryLoaded && viewMode !== "sources" && <button type="button" className="library-return" aria-pressed={activeTags.includes(FAVORITE_TAG)} disabled={favoriteControls?.status !== "ready"} title={t("Favorites use the visible Favorite tag shared across your library.")} onClick={() => library.toggleTagFilter(FAVORITE_TAG)}>{t("Only favorites")}</button>}
        {viewMode === "sources" && <>
          {workspaceID && <button className="library-return" onClick={() => void library.loadContentLibrary(workspaceID, undefined, true)}><Home size={14} />{t("All content")}</button>}
          <span className="result-count">{sources.sourceProjection.state === "DEGRADED" ? t("Source status unavailable") : t("{{count}} configured", { count: sources.sources.length })}</span>
        </>}
        {viewMode !== "sources" && <>
          {library.hasActiveFilters && <button className="library-return" onClick={library.clearLibraryFilters}><X size={14} />{t("Clear filters")}</button>}
          {viewMode === "search" && <button className="library-return" onClick={library.clearSearchScope}><X size={14} />{t("Clear search")}</button>}
          {viewMode === "path" && workspaceID && <button className="library-return" onClick={() => void library.loadContentLibrary(workspaceID, undefined, true)}><Home size={14} />{t("All content")}</button>}
          {renderedHits.length > 0 && <span className="sort-control" role="group" aria-label={t("Sort library")} aria-describedby="cairn-sort-description">
            <span className="sr-only" id="cairn-sort-description">{t(sortAvailable ? "Sorts the items already loaded in this browser. Items whose page has not arrived yet keep their pending place, and items without a logical size sort last." : "Search results keep their relevance order, so sorting is unavailable here.")}</span>
            <select className="sort-field" aria-label={t("Sort field")} value={view.sortField} disabled={!sortAvailable} onChange={(event) => view.changeSortField(event.target.value as "name" | "size" | "type" | "path")}>
              <option value="name">{t("Name")}</option>
              <option value="size">{t("Size")}</option>
              <option value="type">{t("Type")}</option>
              <option value="path">{t("Path")}</option>
            </select>
            <button type="button" className="sort-direction" data-sort-direction={view.sortDirection} aria-label={t("Sort direction")} title={t(sortAvailable ? view.sortDirection === "asc" ? "Ascending order" : "Descending order" : "Search results keep their relevance order")} disabled={!sortAvailable} onClick={view.toggleSortDirection}>{view.sortDirection === "asc" ? <ArrowUp size={15} /> : <ArrowDown size={15} />}</button>
          </span>}
          {renderedHits.length > 0 && !isMediaView && <span className="layout-switch" role="group" aria-label={t("Library layout")}>
            <button type="button" aria-pressed={view.libraryLayout === "grid"} title={t("Grid view")} aria-label={t("Grid view")} onClick={() => view.changeLibraryLayout("grid")}><LayoutGrid size={15} /></button>
            <button type="button" aria-pressed={view.libraryLayout === "list"} title={t("List view")} aria-label={t("List view")} onClick={() => view.changeLibraryLayout("list")}><ListIcon size={15} /></button>
          </span>}
          {canOpenExport && workspaceID && <button className="secondary-button compact export-trigger" onClick={(event) => onOpenExport(event.currentTarget)} disabled={!isConnected || !coreStorageReady}><DownloadIcon size={14} />{t("Export")}</button>}
          {workspaceID && <button type="button" className="secondary-button compact" aria-expanded={retrievalOpen} aria-controls="saved-retrieval-panel" onClick={() => { setRetrievalOpen(!retrievalOpen); if (!retrievalOpen) void retrievalFlow.loadSavedViews(); }} disabled={!isConnected}>{t("Saved retrieval")}</button>}
          <span className="result-count">{listingPositions ? t(viewMode === "search" ? "{{count}} results" : "{{count}} items", { count: listingPositions }) : workspaceID ? t("0 items") : t("Nothing added yet")}</span>
          {listingIncomplete && <p className={`library-listing-progress ${library.libraryListingError ? "is-error" : ""}`} role="status" data-loaded={libraryItems.length} data-total={library.libraryTotal} data-listing-completeness={library.libraryListingComplete ? "COMPLETE" : library.libraryListingMore ? "MORE_AVAILABLE" : "BOUNDED_UNKNOWN"} data-listing-state={library.libraryListingError ? "ERROR" : library.libraryListingLoading ? "LOADING" : "IDLE"}>
            {/* The loaded figure is the listing this browser actually holds, not
                the rows a narrowed projection shows: a media page or a filter
                shows fewer rows than are loaded, and saying "40 of 960 loaded"
                there would understate what the daemon already answered. */}
            {library.libraryListingError
              ? t("{{loaded}} of {{total}} items loaded. The next page could not be read: {{message}}", { loaded: libraryItems.length, total: library.libraryTotal, message: library.libraryListingError })
              : library.libraryListingLoading
                ? t("Loading more items: {{loaded}} of {{total}} loaded…", { loaded: libraryItems.length, total: library.libraryTotal })
                : library.hasActiveFilters || !wallShowsWholeListing
                  ? t("{{loaded}} of {{total}} items loaded. This screen shows the loaded items only.", { loaded: libraryItems.length, total: library.libraryTotal })
                  : t("{{loaded}} of {{total}} items loaded.", { loaded: libraryItems.length, total: library.libraryTotal })}
            {library.libraryListingError && <button type="button" className="secondary-button compact" onClick={() => { void library.loadMoreLibrary(); }}>{t("Retry")}</button>}
          </p>}
        </>}
      </div>
      {(viewMode === "content" || viewMode === "tag") && <section className="library-secondary-tools" aria-label={t("Browse tools")}>
        <span className="library-secondary-tools-label" aria-hidden="true">{t("Browse tools")}</span>
        <div className="library-tool-controls">
          {libraryItems.length > 0 && <details className="space-report" data-total-bytes={spaceReport.totalBytes}>
            <summary><HardDrive size={14} /><span>{t("Space report")}</span><ChevronRight size={14} /></summary>
            <div className="space-report-body">
              <p className="space-report-note">{t("Computed in this browser over {{count}} loaded items; not a server query.", { count: libraryItems.length })}</p>
              <p className="space-report-total"><b>{formatBytes(spaceReport.totalBytes)}</b><span>{t("total logical size over {{count}} loaded items", { count: libraryItems.length })}</span></p>
              {spaceReport.top.length > 0 && <div className="space-report-top" role="group" aria-label={t("Largest files")}>{spaceReport.top.map((entry) => <button type="button" key={entry.hit.subject_ref ?? entry.hit.entry_id ?? entry.hit.name} aria-label={t("Open {{name}}", { name: entry.hit.name ?? "" })} onClick={() => onOpenHit(entry.hit)}><strong>{entry.hit.name || t("Untitled subject")}</strong><b>{formatBytes(entry.size)}</b></button>)}</div>}
              {spaceReport.classes.length > 0 && <div className="space-report-classes"><span className="space-report-classes-label">{t("Bytes by media class (suffix-derived)")}</span>{spaceReport.classes.map((entry) => <span className="space-report-class" key={entry.class}><span>{t(entry.label)}</span><b>{formatBytes(entry.bytes)}</b></span>)}</div>}
            </div>
          </details>}
          <TimelineStrip t={t} items={libraryItems} activeMonth={activeTimelineMonth} onToggleMonth={library.toggleTimelineMonth} />
        </div>
      </section>}
    </div>
    {(viewMode === "search" || viewMode === "tag") && <section className="library-result-scope" aria-label={t("Current result scope")}>
      {isMediaView && <strong>{viewMode === "search" ? (lastExecutedQuery.trim() ? t("Results for \"{{query}}\"", { query: lastExecutedQuery }) : t("Image search results")) : activeTags.length ? t("Content tagged {{tags}}", { tags: activeTags.join(" + ") }) : t("Filtered content")}</strong>}
      <p>{t(viewMode === "search" ? "Among returned results: {{photos}} photos, {{music}} audio, {{other}} other items. Display changes keep this query and relevance order." : "Within this filtered listing: {{photos}} photos, {{music}} audio, {{other}} other items.", { photos: photoScopeCount, music: musicScopeCount, other: otherScopeCount })}</p>
      {viewMode === "search" && <small>{t("These counts cover the returned results, which may be limited; they are not full-library matching totals.")}</small>}
      {(isPhotoView || isMusicView) && renderedHits.length === 0 && <div className="library-result-scope__empty" role="status"><span>{t(isPhotoView ? "No photos among these {{count}} scoped results." : "No audio among these {{count}} scoped results.", { count: scopeCount })}</span><button type="button" className="secondary-button compact" onClick={() => onLibraryView("content")}>{t("Show all returned types")}</button></div>}
    </section>}
    {retrievalOpen && <div id="saved-retrieval-panel">{savedRetrievalPanel}</div>}
    {activeRecalledView && <div className={`recall-caption ${activeRecalledView.state.toLowerCase()}`} role="status"><Sparkles size={15} /><div><strong>{t("Live evaluation of saved view \"{{name}}\"", { name: activeRecalledView.name })}</strong><small>{t("Membership is dynamic: re-running this view can return a different set of subjects as content and indexes change.")}</small>{activeRecalledView.foreignScope && <small className="recall-caption-detail">{t("This saved view was stored for content other than what is open here. Its results came from that stored scope, not from the content open here.")}</small>}{activeRecalledView.message && <small className="recall-caption-detail">{activeRecalledView.message}</small>}</div></div>}
    {viewMode === "search" && executedPlan.overLoadedResults.length > 0 && <div className="search-ops-notice" role="status"><AlertCircle size={15} /><div><strong>{t("Evaluated over the loaded results")}</strong><small>{t("{{tokens}} cannot be expressed by the daemon's search.query, so this browser applied it to the hits this query returned. Hits without a recorded content id, size, or modification time are not classified.", { tokens: overLoadedTokens })}</small></div></div>}
    {showLibraryFacets && <section className="tag-browser" aria-label={t("Filter by tags")}>
      <div className="tag-browser-heading" title={t("Choose multiple tags to narrow the library.")}><Tag size={15} /><span>{t("Browse by tags")}</span><small>{t("Choose multiple tags to narrow the library.")}</small></div>
      <div className="tag-filter-list">
        <button type="button" className={`tag-filter all ${activeTags.length === 0 ? "active" : ""}`} aria-pressed={activeTags.length === 0} onClick={library.showFacetFilteredLibrary}><span>{t("All tags")}</span><b>{monthFilteredItems.length}</b></button>
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
      {library.hasActiveFilters && <div className="filter-summary" aria-label={t("Active filters")}><span className="filter-summary-label">{t("Active filters")}:</span>{activeTags.map((tag) => <button type="button" className="active-filter" key={tag} onClick={() => library.toggleTagFilter(tag)} aria-label={t("Remove tag filter {{tag}}", { tag })}><Tag size={11} />{tag}<X size={11} /></button>)}{activeTimelineMonth && <button type="button" className="active-filter" onClick={() => library.toggleTimelineMonth(activeTimelineMonth)} aria-label={t("Remove month filter {{month}}", { month: activeTimelineMonth })}><Calendar size={11} />{activeTimelineMonth}<X size={11} /></button>}{library.hasSystemFacets && <span className="filter-summary-system">{[activeSystemFacets.type ? `type:${formatEntryType(activeSystemFacets.type, t)}` : "", activeSystemFacets.format ? `format:${activeSystemFacets.format}` : "", activeSystemFacets.dedup ? `dedup:${formatDedupFacet(activeSystemFacets.dedup, t)}` : "", activeSystemFacets.tags ? t("Unmarked") : "", activeSystemFacets.index ? t("Index not ready") : ""].filter(Boolean).join(" + ")}</span>}<button type="button" className="filter-summary-clear" onClick={library.clearLibraryFilters}>{t("Clear filters")}</button></div>}
    </section>}
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
    {viewMode === "sources" ? <SourcesSurface t={t} locale={locale} sources={sources.sources} staging={sources.staging} stagingBusy={sources.stagingBusy} sourceProjection={sources.sourceProjection} sourceChanges={sources.sourceChanges} busy={busy} coreStorageReady={coreStorageReady} isConnected={isConnected} onViewSource={onViewSource} onRecheckSource={onRecheckSource} onOpenAdd={onOpenAdd} onIngestStaged={() => sources.ingestStaged()} onCleanStaged={() => void sources.cleanStaged()} /> : renderedHits.length || isMediaView ? <>
      {hiddenSelectionCount > 0 && <p className="library-selection-scope" role="status">{t("{{count}} selected items are outside this display. Batch actions still include them.", { count: hiddenSelectionCount })}</p>}
      {selection.selectionRefs.length > 0 && <SelectionBar count={selection.selectionSubjects.length} subjects={selection.selectionSubjects} unresolvedCount={selection.selectionRefs.length - selection.selectionSubjects.length} workspaceID={workspaceID} locale={locale} viewMode={viewMode} query={lastExecutedQuery} tagDraft={selection.selectionTagDraft} busy={busy} originalTakeoutBusy={originalTakeoutBusy} t={t} onSelectAll={selection.selectAllVisible} onExport={(trigger) => onOpenExport(trigger, selection.selectionSubjects)} onDownloadOriginals={onDownloadOriginals} onTagDraft={selection.setSelectionTagDraft} onApplyTag={() => void selection.applySelectionTag()} onClear={selection.clearSelection} onImageSearch={onImageSearch} />}
      {isMediaView ? <LibraryPageHost
        mode={presentationMode} enabledPageIds={enabledViews} resultProps={resultProps}
        onOpenHit={onOpenHit} focusedSubjectRef={focusedSubjectRef} onFocusSubject={onFocusSubject}
        onPlayTrack={onPlayTrack} onQueueTrack={onQueueTrack} onPlayTracks={onPlayTracks}
        musicMetadata={musicMetadata} favoriteControls={favoriteControls} musicQueueControls={musicQueueControls} photoLoading={!library.libraryLoaded}
        onReturnToWall={() => onLibraryView(returnToPhotoWall ? "photos" : "content")}
        onNavigate={onLibraryView}
        returnLabel={exhibitionReturnLabel}
        onFallback={() => onLibraryView("content")}
      /> : <ResultList {...resultProps} />}
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
