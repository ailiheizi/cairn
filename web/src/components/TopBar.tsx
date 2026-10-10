import { AlertCircle, ArchiveRestore, CheckCircle2, History, LoaderCircle, PanelLeft, Plus, RefreshCw, Search, Settings, ShieldCheck, X } from "lucide-react";
import type { RefObject } from "react";
import type { Translator } from "../i18n";
import type { SearchFlow } from "../app/useSearch";
import { predicateWireLabel, searchOperatorInfo, SEARCH_OPERATOR_NAMES } from "../lib/searchops";
import { StatusPanel } from "./StatusPanel";

// The top bar and the trusted status surface.
//
// The top bar holds the one search field, the operator autocomplete, the
// visible predicate row, the connection state, and the top-level actions
// (restore, add source, refresh, settings). Below it, `StatusPanel` owns the
// one rail disclosure that reports what this browser can actually prove; it is
// a report, never a control over stored content.
//
// Below the single compact boundary (`max-width: 640px`, the same query
// `useCompactLayout` asks) the top bar carries one workspace button instead:
// the rail is not rendered inline there, and `StatusPanel` moves into the
// panel the button opens, so exactly one status disclosure is mounted at a
// time and every rail surface stays reachable on a phone.
//
// The predicate row is a projection of the field text: every chip is one token
// the operator grammar recognised, it names the daemon input that token really
// writes, and removing or editing a chip rewrites the text instead of keeping
// a second copy of the query.

export function TopBar({ t, query, busy, status, statusData, capabilities, isConnected, coreStorageReady, catalogHealthy, snapshotRef, search, compact, onOpenRail, railTriggerRef, onRefresh, onOpenRestore, onOpenAdd, onOpenSettings, onOpenVerification, onOpenActivity, canLeaveSettings }: {
  t: Translator;
  query: string;
  busy: boolean;
  status: string;
  statusData: any;
  capabilities: any[];
  isConnected: boolean;
  coreStorageReady: boolean;
  catalogHealthy: boolean;
  snapshotRef: string;
  search: SearchFlow;
  compact?: boolean;
  onOpenRail?: (trigger?: EventTarget | null) => void;
  railTriggerRef?: RefObject<HTMLButtonElement | null>;
  onRefresh: () => void;
  onOpenRestore: (trigger?: EventTarget | null) => void;
  onOpenAdd: (sourceItem?: undefined, trigger?: EventTarget | null) => void;
  onOpenSettings: (trigger?: EventTarget | null) => void;
  onOpenVerification: (trigger?: EventTarget | null) => void;
  onOpenActivity?: () => void;
  canLeaveSettings: () => boolean;
}) {
  const ops = search.ops;
  const { parsed, plan, error, suggestions, suggestionsOpen, activeSuggestion, editing } = ops;
  const showOperators = parsed.predicates.length > 0 || Boolean(error);
  return <>
    <header className="topbar">
      <a className="brand" href="/" aria-label={t("RestoreWeave home")} onClick={(event) => { if (!canLeaveSettings()) event.preventDefault(); }}><span className="brand-mark"><ShieldCheck size={19} /></span><span>RestoreWeave</span></a>
      <form className="global-search" onSubmit={search.runSearch} onFocus={(event) => { search.handleSearchFieldFocus(event.target); }} onBlur={(event) => { search.handleSearchFieldBlur(event.currentTarget.contains(event.relatedTarget as Node | null)); }} onKeyDown={search.handleSearchFieldKeyDown}>
        <Search size={17} aria-hidden="true" />
        <input ref={search.searchInputRef} aria-label={t("Search content library")} aria-describedby="restoreweave-search-hint" aria-invalid={error ? true : undefined} value={query} onChange={(event) => { search.handleSearchFieldChange(event.target.value, event.target.selectionStart ?? undefined); }} onKeyUp={(event) => { search.handleSearchFieldCaret(event.currentTarget.selectionStart ?? 0); }} onClick={(event) => { search.handleSearchFieldCaret(event.currentTarget.selectionStart ?? 0); }} placeholder={t("Search names, notes, tags, or facts")} disabled={!isConnected || !catalogHealthy} />
        <span className="sr-only" id="restoreweave-search-hint">{t("Command or Control plus K focuses this field. Recent searches are kept in this browser only; saving a query as a view is the durable form.")}</span>
        {Boolean(query.trim()) && <button type="button" className="search-clear" aria-label={t("Clear search text")} title={t("Clears the field only. Current results stay until you search again or return to All content.")} onClick={search.clearSearchText}><X size={14} aria-hidden="true" /></button>}
        <button type="submit" className="search-submit" disabled={busy || !query.trim() || !isConnected || !catalogHealthy}>{busy ? <LoaderCircle className="spin" size={16} /> : t("Search")}</button>
        {suggestionsOpen && <div className="search-suggest" role="listbox" aria-label={t("Search operators and values")} aria-describedby="restoreweave-search-suggest-note">
          <p className="search-suggest-note" id="restoreweave-search-suggest-note">{t("Operators only. Values are suggested where this browser already knows them: tag names come from the loaded tag vocabulary, and protection modes from the daemon's closed protection vocabulary.")}</p>
          {suggestions.map((suggestion, index) => <button key={suggestion.key} type="button" role="option" aria-selected={index === activeSuggestion} className={`search-suggest-entry ${index === activeSuggestion ? "active" : ""}`} onClick={() => ops.acceptSuggestion(index)}>
            {suggestion.kind === "operator"
              ? <><b>{suggestion.name}</b><span>{t(suggestion.description)}</span><code>{suggestion.valueHint}</code></>
              : suggestion.kind === "protection"
                ? <><b>{suggestion.value}</b><span>{t(suggestion.description)}</span><code>{suggestion.token}</code></>
                : <><b>{suggestion.value}</b><span>{t("Tag, {{count}} items", { count: suggestion.count })}</span><code>{suggestion.token}</code></>}
          </button>)}
        </div>}
        {search.searchRecentsOpen && <div className="search-recents" role="group" aria-label={t("Local recent searches")} aria-describedby="restoreweave-search-recents-note">
          <div className="search-recents-head"><span><History size={13} aria-hidden="true" />{t("Local recent searches")}</span><button type="button" className="search-recents-clear" onClick={search.clearRecentSearches}>{t("Clear recent searches")}</button></div>
          <p className="search-recents-note" id="restoreweave-search-recents-note">{t("Kept in this browser only. These are not saved views; saving a query as a view is the durable form.")}</p>
          <ul className="search-recents-list" onKeyDown={search.handleRecentsListKeyDown}>
            {search.recentSearches.map((value) => <li className="search-recent-item" key={value}>
              <button type="button" className="search-recent-entry" title={value} onClick={() => search.pickRecentSearch(value)}>{value}</button>
              <button type="button" className="search-recent-remove" aria-label={t("Remove recent search {{query}}", { query: value })} title={t("Remove recent search {{query}}", { query: value })} onClick={() => search.removeRecentSearch(value)}><X size={12} aria-hidden="true" /></button>
            </li>)}
          </ul>
        </div>}
      </form>
      {showOperators && <div className="search-ops" role="group" aria-label={t("Search predicates")}>
        <span className="search-ops-heading">{t("Predicates")}</span>
        <ul className="search-ops-chips">
          {parsed.predicates.map((predicate, index) => <li className={`search-ops-chip${predicate.negated ? " negated" : ""}${predicate.overLoadedResults ? " loaded" : ""}`} key={`${predicate.raw}:${index}`} data-operator={predicate.operator} data-wire={predicateWireLabel(predicate, plan)}>
            {editing?.index === index
              ? <input className="search-ops-chip-edit" autoFocus value={editing.value} aria-label={t("Edit predicate {{token}}", { token: predicate.raw })} onChange={(event) => ops.changeEditValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); ops.commitEdit(); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); ops.cancelEdit(); } }} onBlur={ops.commitEdit} />
              : <button type="button" className="search-ops-chip-edit-trigger" aria-label={t("Edit predicate {{token}}", { token: predicate.raw })} title={t(predicate.negated ? "Negated predicate, evaluated over the loaded results. Select to edit." : searchOperatorInfo(predicate.operator).limitation || "Select to edit this predicate in place.")} onClick={() => ops.beginEdit(index)}>{predicate.raw}</button>}
            <span className="search-ops-chip-wire" title={t("The daemon input this predicate writes.")}>{predicateWireLabel(predicate, plan)}</span>
            <button type="button" className="search-ops-chip-remove" aria-label={t("Remove predicate {{token}}", { token: predicate.raw })} title={t("Removes this predicate from the search text.")} onClick={() => ops.removePredicate(index)}><X size={12} aria-hidden="true" /></button>
          </li>)}
          {parsed.freeText && <li className="search-ops-free"><span>{t("Free text")}</span><b>{parsed.freeText}</b></li>}
        </ul>
        {error && <p className="search-ops-error" role="alert"><AlertCircle size={14} aria-hidden="true" />{t(error.message, error.values)}<span className="sr-only">{t("No search was run for this text.")}</span></p>}
        {!error && plan.limits.length > 0 && <ul className="search-ops-limits">{plan.limits.map((limit) => <li key={limit}>{t(limit)}</li>)}</ul>}
        {!error && plan.limits.length === 0 && <p className="search-ops-hint">{t("Operators available: {{operators}}. Select a predicate to edit it, or remove it to rewrite the search text.", { operators: SEARCH_OPERATOR_NAMES.map((name) => `${name}:`).join(" ") })}</p>}
      </div>}
      <div className="top-actions">
        {compact && <button type="button" ref={railTriggerRef} className="icon-button rail-trigger" aria-label={t("Open workspace navigation")} title={t("Open workspace navigation")} aria-haspopup="dialog" onClick={(event) => onOpenRail?.(event.currentTarget)}><PanelLeft size={17} aria-hidden="true" /></button>}
        <span className={`connection ${isConnected ? "ok" : "bad"}`} aria-label={t(status)}>{status === "Checking service" ? <LoaderCircle className="spin" size={15} /> : isConnected ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}<span>{t(status)}</span></span>
        <button className="secondary-button restore-button" aria-label={t("Restore latest snapshot")} title={t("Restore latest snapshot")} onClick={(event) => onOpenRestore(event.currentTarget)} disabled={!snapshotRef || !isConnected || !coreStorageReady}><ArchiveRestore size={16} /><span>{t("Restore")}</span></button>
        <button className="primary-button add-button" aria-label={t("Add content")} title={t("Add content")} onClick={(event) => onOpenAdd(undefined, event.currentTarget)} disabled={!isConnected || !coreStorageReady}><Plus size={16} /><span>{t("Add content")}</span></button>
        <button className="icon-button" title={t("Refresh service status")} aria-label={t("Refresh service status")} onClick={onRefresh}><RefreshCw size={17} /></button>
        <button className="icon-button settings-trigger" title={t("Open settings")} aria-label={t("Open settings")} onClick={(event) => onOpenSettings(event.currentTarget)}><Settings size={17} /></button>
      </div>
    </header>
    {!compact && <StatusPanel t={t} status={status} statusData={statusData} capabilities={capabilities} onRefresh={onRefresh} onOpenVerification={onOpenVerification} onOpenActivity={onOpenActivity} />}
  </>;
}
