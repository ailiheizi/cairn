import { AlertCircle, ArrowDown, ArrowUp, Check, ChevronRight, Download as DownloadIcon, Folder, HardDrive, Home, LayoutGrid, Hash, List as ListIcon, Plus, RefreshCw, Server, ShieldCheck, Sparkles, Tag, X } from "lucide-react";
import { useMemo } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import type { Locale, Translator } from "../i18n";
import { ResultList } from "./ResultList";
import { SelectionBar } from "./SelectionBar";
import { SourcesSurface } from "./SourcesSurface";
import { sourceButtonLabel } from "../lib/format";
import { formatDedupFacet, formatEntryType } from "../lib/format";
import { parseSearchQuery, searchPlan } from "../lib/searchops";
import type { LibraryFlow } from "../app/useLibrary";
import type { SelectionFlow } from "../app/useSelection";
import type { SourcesFlow } from "../app/useSources";
import type { ViewModeFlow } from "../app/useViewMode";
import type { Command, Notice, RecalledView, RowClickEvent, SearchHit, SourceSummary, ViewMode } from "../lib/types";

// The library column: view heading, its controls, filters, notices, and the
// current view's content (the result list or the configured sources).
//
// Every control here changes a browser projection or opens a drawer; none of
// them writes durable state directly.

export function LibrarySurface({ t, locale, workspaceID, viewMode, library, selection, sources, view, command, selectedRef, showFirstSource, recalledView, lastExecutedQuery, sortAvailable, canOpenExport, isConnected, isUnavailable, coreStorageReady, coreStorageMessage, notice, busy, refresh, onOpenAdd, onViewSource, onRecheckSource, onRowClick, onLibraryKeyDown, onOpenExport, onClearNotice, libraryListRef }: {
  t: Translator;
  locale: Locale;
  workspaceID: string;
  viewMode: ViewMode;
  library: LibraryFlow;
  selection: SelectionFlow;
  sources: SourcesFlow;
  view: ViewModeFlow;
  command: Command;
  selectedRef: string;
  showFirstSource: boolean;
  recalledView: RecalledView | undefined;
  lastExecutedQuery: string;
  sortAvailable: boolean;
  canOpenExport: boolean;
  isConnected: boolean;
  isUnavailable: boolean;
  coreStorageReady: boolean;
  coreStorageMessage: string;
  notice: Notice | undefined;
  busy: boolean;
  refresh: () => void;
  onOpenAdd: (trigger?: EventTarget | null) => void;
  onViewSource: (sourceItem: SourceSummary) => void;
  onRecheckSource: (sourceItem: SourceSummary, trigger?: EventTarget | null) => void;
  onRowClick: (index: number, event: RowClickEvent) => void;
  onLibraryKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onOpenExport: (trigger?: EventTarget | null, selection?: SearchHit[]) => void;
  onClearNotice: () => void;
  libraryListRef: RefObject<HTMLDivElement | null>;
}) {
  const { hits, libraryItems, activeTags, activeSystemFacets, browseRoots, browseRootID, browseCrumbs, tagFacets, systemFacets, facetFilteredItems, renderedHits, identityCounts, tagsBySubject } = library;
  // The executed query is re-parsed here only to label what the daemon could
  // not express: those predicates were applied over the hits the query
  // returned, and the result set says so instead of implying a server filter.
  const executedPlan = useMemo(() => searchPlan(parseSearchQuery(lastExecutedQuery)), [lastExecutedQuery]);
  const overLoadedTokens = executedPlan.overLoadedResults.map((predicate) => predicate.raw).join(", ");
  const showConfiguredSourceEmpty = viewMode === "content" && libraryItems.length === 0 && sources.sources.length > 0;
  const showLibraryFacets = (viewMode === "content" || viewMode === "tag") && libraryItems.length > 0;
  return <section className="content-column">
    {/* The rail is hidden on phones; this compact entry drives the same
        sources mode and is hidden again from 641px up by CSS alone. */}
    <button type="button" className={`sources-entry ${viewMode === "sources" ? "active" : ""}`} onClick={library.showSourcesSurface}><HardDrive size={16} /><span>{t("Sources")}</span><small>{sources.sources.length}</small></button>
    <div className="workspace-heading"><div><p className="eyebrow">{t(viewMode === "sources" ? "WORKSPACE" : "YOUR LIBRARY")}</p><h1>{viewMode === "sources" ? t("Sources") : viewMode === "search" ? t("Results for \"{{query}}\"", { query: lastExecutedQuery }) : viewMode === "tag" ? activeTags.length ? t("Content tagged {{tags}}", { tags: activeTags.join(" + ") }) : t("Filtered content") : viewMode === "path" ? browseCrumbs.at(-1)?.name || t("Source paths") : t("All content")}</h1></div><div className="heading-actions">{viewMode === "sources" && <>{workspaceID && <button className="library-return" onClick={() => void library.loadContentLibrary(workspaceID, undefined, true)}><Home size={14} />{t("All content")}</button>}<span className="result-count">{sources.sourceProjection.state === "DEGRADED" ? t("Source status unavailable") : t("{{count}} configured", { count: sources.sources.length })}</span></>}{viewMode !== "sources" && <>{library.hasActiveFilters && <button className="library-return" onClick={library.clearLibraryFilters}><X size={14} />{t("Clear filters")}</button>}{(viewMode === "search" || viewMode === "path") && workspaceID && <button className="library-return" onClick={() => void library.loadContentLibrary(workspaceID, undefined, true)}><Home size={14} />{t("All content")}</button>}{hits.length > 0 && <span className="sort-control" role="group" aria-label={t("Sort library")} aria-describedby="restoreweave-sort-description"><span className="sr-only" id="restoreweave-sort-description">{t(sortAvailable ? "Sorts the items already loaded in this browser. The library listing is the complete publication set, so this is not a server query. Items without a logical size sort last." : "Search results keep their relevance order, so sorting is unavailable here.")}</span><select className="sort-field" aria-label={t("Sort field")} value={view.sortField} disabled={!sortAvailable} onChange={(event) => view.changeSortField(event.target.value as "name" | "size" | "type" | "path")}><option value="name">{t("Name")}</option><option value="size">{t("Size")}</option><option value="type">{t("Type")}</option><option value="path">{t("Path")}</option></select><button type="button" className="sort-direction" data-sort-direction={view.sortDirection} aria-label={t("Sort direction")} title={t(sortAvailable ? view.sortDirection === "asc" ? "Ascending order" : "Descending order" : "Search results keep their relevance order")} disabled={!sortAvailable} onClick={view.toggleSortDirection}>{view.sortDirection === "asc" ? <ArrowUp size={15} /> : <ArrowDown size={15} />}</button></span>}{hits.length > 0 && <span className="layout-switch" role="group" aria-label={t("Library layout")}><button type="button" aria-pressed={view.libraryLayout === "grid"} title={t("Grid view")} aria-label={t("Grid view")} onClick={() => view.changeLibraryLayout("grid")}><LayoutGrid size={15} /></button><button type="button" aria-pressed={view.libraryLayout === "list"} title={t("List view")} aria-label={t("List view")} onClick={() => view.changeLibraryLayout("list")}><ListIcon size={15} /></button></span>}{canOpenExport && workspaceID && <button className="secondary-button compact export-trigger" onClick={(event) => onOpenExport(event.currentTarget)} disabled={!isConnected || !coreStorageReady}><DownloadIcon size={14} />{t("Export")}</button>}<span className="result-count">{hits.length ? t(viewMode === "search" ? "{{count}} results" : "{{count}} items", { count: hits.length }) : workspaceID ? t("0 items") : t("No workspace yet")}</span></>}</div></div>
    {viewMode !== "sources" && recalledView && lastExecutedQuery === recalledView.query && <div className={`recall-caption ${recalledView.state.toLowerCase()}`} role="status"><Sparkles size={15} /><div><strong>{t("Live evaluation of saved view \"{{name}}\"", { name: recalledView.name })}</strong><small>{t("Membership is dynamic: re-running this view can return a different set of subjects as content and indexes change.")}</small>{recalledView.message && <small className="recall-caption-detail">{recalledView.message}</small>}</div></div>}
    {viewMode === "search" && executedPlan.overLoadedResults.length > 0 && <div className="search-ops-notice" role="status"><AlertCircle size={15} /><div><strong>{t("Evaluated over the loaded results")}</strong><small>{t("{{tokens}} cannot be expressed by the daemon's search.query, so this browser applied it to the hits this query returned. Hits without a recorded content id, size, or modification time are not classified.", { tokens: overLoadedTokens })}</small></div></div>}
    {showLibraryFacets && <section className="tag-browser" aria-label={t("Filter by tags")}>
      <div className="tag-browser-heading" title={t("Choose multiple tags to narrow the library.")}><Tag size={15} /><span>{t("Browse by tags")}</span><small>{t("Choose multiple tags to narrow the library.")}</small></div>
      <div className="tag-filter-list">
        <button type="button" className={`tag-filter all ${activeTags.length === 0 ? "active" : ""}`} aria-pressed={activeTags.length === 0} onClick={library.showFacetFilteredLibrary}><span>{t("All tags")}</span><b>{facetFilteredItems.length}</b></button>
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
      {library.hasActiveFilters && <div className="filter-summary" aria-label={t("Active filters")}><span className="filter-summary-label">{t("Active filters")}:</span>{activeTags.map((tag) => <button type="button" className="active-filter" key={tag} onClick={() => library.toggleTagFilter(tag)} aria-label={t("Remove tag filter {{tag}}", { tag })}><Tag size={11} />{tag}<X size={11} /></button>)}{library.hasSystemFacets && <span className="filter-summary-system">{[activeSystemFacets.type ? `type:${formatEntryType(activeSystemFacets.type, t)}` : "", activeSystemFacets.format ? `format:${activeSystemFacets.format}` : "", activeSystemFacets.dedup ? `dedup:${formatDedupFacet(activeSystemFacets.dedup, t)}` : "", activeSystemFacets.tags ? t("Unmarked") : "", activeSystemFacets.index ? t("Index not ready") : ""].filter(Boolean).join(" + ")}</span>}<button type="button" className="filter-summary-clear" onClick={library.clearLibraryFilters}>{t("Clear filters")}</button></div>}
    </section>}
    {(viewMode === "content" || viewMode === "tag") && browseRoots.length > 1 && <div className="source-aux-row">
      <details className="source-disclosure"><summary><Folder size={14} /><span>{t("Browse source paths")}</span><small>{t("Source paths are provenance")}</small><ChevronRight size={14} /></summary><div className="source-switcher" aria-label={t("Source paths")}>{browseRoots.map((root) => { const label = sourceButtonLabel(root, browseRoots, t); const path = root.source_path?.trim(); return <button type="button" key={root.root_id} title={path || label} aria-label={path ? t("Browse source {{name}} at {{path}}", { name: root.name || t("Source path"), path }) : label} onClick={() => void library.navigateLibrary("", [], root.root_id)}><Folder size={14} />{label}</button>; })}</div></details>
    </div>}
    {viewMode === "path" && browseRootID && <nav className="breadcrumbs" aria-label={t("Source paths")}><button title={t("Source paths")} aria-label={t("Source path root")} onClick={() => void library.navigateLibrary("", [])}><Home size={14} /></button>{browseCrumbs.map((crumb, index) => <span key={crumb.entry_id}><ChevronRight size={13} /><button onClick={() => void library.navigateLibrary(crumb.entry_id || crumb.subject_ref, browseCrumbs.slice(0, index + 1))}>{crumb.name}</button></span>)}</nav>}
    {isConnected && !coreStorageReady ? <div className="notice error" role="alert"><AlertCircle size={16} />{coreStorageMessage}</div> : isUnavailable ? <div className="service-offline" role="alert"><span><Server size={18} /></span><div><strong>{t("RestoreWeave service is unavailable")}</strong><small>{t("Start the service, then refresh this page. Saved content has not been changed.")}</small></div><button className="secondary-button compact" onClick={refresh}><RefreshCw size={15} />{t("Retry")}</button></div> : notice && <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.kind === "error" ? <AlertCircle size={16} /> : notice.kind === "warning" ? <Sparkles size={16} /> : <Check size={16} />}{notice.text}<button aria-label={t("Dismiss notice")} onClick={onClearNotice}><X size={14} /></button></div>}
    {viewMode === "sources" ? <SourcesSurface t={t} locale={locale} sources={sources.sources} sourceProjection={sources.sourceProjection} sourceChanges={sources.sourceChanges} busy={busy} coreStorageReady={coreStorageReady} isConnected={isConnected} onViewSource={onViewSource} onRecheckSource={onRecheckSource} onOpenAdd={onOpenAdd} /> : hits.length ? <>
      {selection.selectionSubjects.length > 0 && <SelectionBar count={selection.selectionSubjects.length} subjects={selection.selectionSubjects} workspaceID={workspaceID} locale={locale} viewMode={viewMode} query={lastExecutedQuery} tagDraft={selection.selectionTagDraft} busy={busy} t={t} onSelectAll={selection.selectAllVisible} onExport={(trigger) => onOpenExport(trigger, selection.selectionSubjects)} onTagDraft={selection.setSelectionTagDraft} onApplyTag={() => void selection.applySelectionTag()} onClear={selection.clearSelection} />}
      <ResultList hits={renderedHits} libraryListRef={libraryListRef} libraryLayout={view.libraryLayout} sortField={view.sortField} sortDirection={view.sortDirection} selectionCount={selection.selectionSubjects.length} rovingRow={selection.rovingRow} selectedRef={selectedRef} selectionRefs={selection.selectionRefs} identityCounts={identityCounts} tagsBySubject={tagsBySubject} viewMode={viewMode} locale={locale} t={t} command={command} workspaceID={workspaceID} onRowClick={onRowClick} onToggleSelection={selection.toggleSelectionAt} onKeyDown={onLibraryKeyDown} />
    </> : <div className="empty-state"><span className="vault-sigil"><ShieldCheck size={35} /></span><h2>{t(showFirstSource ? "Start by adding a source" : showConfiguredSourceEmpty ? "Source configured, no saved content yet" : viewMode === "search" ? "No matches found" : viewMode === "tag" ? activeTags.length ? "No content matches these tags" : library.hasSystemFacets ? "No content matches these filters" : "No content matches these tags" : viewMode === "path" ? "This source path is empty" : "No content yet")}</h2><p>{t(showFirstSource ? "Add a server folder, review what will be stored, then confirm." : showConfiguredSourceEmpty ? "Recheck creates a reviewable plan. Existing saved content is not changed until you confirm." : viewMode === "search" ? "Try another name, path, metadata value, tag, note, or extracted phrase." : viewMode === "tag" ? activeTags.length ? "Choose fewer tags to broaden the result." : library.hasSystemFacets ? "Adjust or clear the system filters." : "Choose fewer tags to broaden the result." : viewMode === "path" ? "No captured items are recorded at this source path." : "Saved content will appear here independent of its original folders.")}</p>{showFirstSource && <button className="primary-button" onClick={(event) => onOpenAdd(event.currentTarget)} disabled={!coreStorageReady}><Plus size={16} />{t("Add source")}</button>}</div>}
  </section>;
}
