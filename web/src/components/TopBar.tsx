import { AlertCircle, ArchiveRestore, CheckCircle2, History, LoaderCircle, PanelLeft, Plus, RefreshCw, Search, Settings, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode, RefObject, SyntheticEvent } from "react";
import type { Translator } from "../i18n";
import type { SearchFlow } from "../app/useSearch";
import { predicateWireLabel, searchOperatorInfo } from "../lib/searchops";
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
// `useCompactLayout` asks) the normal top bar carries one workspace button
// instead: the rail is not rendered inline there, and `StatusPanel` moves into
// the panel the button opens, so exactly one status disclosure is mounted at a
// time and every rail surface stays reachable on a phone.
//
// A destination header uses one floating glass capsule across the standard
// Library and registered focused pages: brand, top-level destination links,
// Search, Add and one utility/status disclosure. The standard desktop Library
// keeps its rail in the frame, so the menu only mounts that rail on focused
// pages or compact layouts. The one search form stays mounted; the disclosure
// only decides whether it is shown, and `focusSearchField` opens it before focus.
//
// The predicate row is a projection of the field text: every chip is one token
// the operator grammar recognised, it names the daemon input that token really
// writes, and removing or editing a chip rewrites the text instead of keeping
// a second copy of the query.

export function TopBar({ t, onHome, query, busy, status, statusData, capabilities, isConnected, coreStorageReady, catalogHealthy, snapshotRef, search, compact, focused, destinationHeader, presentationNavigation, navigation, onOpenRail, railTriggerRef, onRefresh, onOpenRestore, onOpenAdd, onOpenSettings, onOpenVerification, onOpenActivity, canLeaveSettings }: {
  t: Translator;
  /** Client-navigation home; keeps playback and drafts alive instead of reloading. */
  onHome?: () => void;
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
  /** Keep top-level destinations and host affordances in one stable header on standard Library views. */
  destinationHeader?: boolean;
  /**
   * Registered focused composition. Preserves the shared rail inside the
   * utility disclosure while the fullpage destination omits the Library rail.
   */
  focused?: boolean;
  /** The top-level content-domain capsule, centred in the destination header. */
  presentationNavigation?: ReactNode;
  /** The shared rail element; rendered in the utility menu only for focused or compact layouts. */
  navigation?: ReactNode;
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
  const usesDestinationHeader = Boolean(focused || destinationHeader);
  const searchDisclosureRef = useRef<HTMLDetailsElement | null>(null);
  const searchHelpRef = useRef<HTMLDetailsElement | null>(null);
  const menuDisclosureRef = useRef<HTMLDetailsElement | null>(null);

  // The destination header overlays dismiss like every other transient surface: an outside
  // pointer, or an Escape no inner control consumed, closes the open disclosure
  // and returns focus to its summary. The search field's own layered Escape
  // stops propagation first, so clearing a predicate or a draft keeps its
  // meaning. The listeners exist only while the destination header is mounted.
  useEffect(() => {
    if (!usesDestinationHeader) return;
    const openDisclosures = () => [searchDisclosureRef.current, menuDisclosureRef.current].filter((element): element is HTMLDetailsElement => Boolean(element?.open));
    function closeFromOutside(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      for (const disclosure of openDisclosures()) {
        if (!disclosure.contains(target)) disclosure.open = false;
      }
    }
    function closeFromEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      const open = openDisclosures();
      if (!open.length) return;
      for (const disclosure of open) disclosure.open = false;
      open[0].querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    }
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [usesDestinationHeader]);

  // Native disclosures do not coordinate with each other, so opening one closes
  // its sibling. Focus lands in the search field on open, which makes a summary
  // click behave like the keyboard shortcut.
  function handleSearchToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open && searchHelpRef.current?.open) searchHelpRef.current.open = false;
    if (!event.currentTarget.open) return;
    if (menuDisclosureRef.current?.open) menuDisclosureRef.current.open = false;
    search.searchInputRef.current?.focus({ preventScroll: true });
  }
  function handleMenuToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open) return;
    if (searchDisclosureRef.current?.open) searchDisclosureRef.current.open = false;
  }
  function closeMenu() {
    const menu = menuDisclosureRef.current;
    if (!menu?.open) return;
    const focusWasInside = menu.contains(document.activeElement);
    menu.open = false;
    if (focusWasInside) menu.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
  }
  // A drawer opened from inside the menu closes the menu first. Focus returns to
  // the still-visible disclosure summary instead of a hidden menu item.
  function menuCloseTrigger(fallback: EventTarget | null): EventTarget | null {
    return menuDisclosureRef.current?.querySelector<HTMLElement>("summary") ?? fallback;
  }
  function closeFocusedOverlays() {
    if (searchDisclosureRef.current?.open) searchDisclosureRef.current.open = false;
    closeMenu();
  }

  const searchForm = <form className="global-search" onSubmit={search.runSearch} onFocus={(event) => { search.handleSearchFieldFocus(event.target); }} onBlur={(event) => { search.handleSearchFieldBlur(event.currentTarget.contains(event.relatedTarget as Node | null)); }} onKeyDown={search.handleSearchFieldKeyDown}>
    <Search size={17} aria-hidden="true" />
    <input ref={search.searchInputRef} aria-label={t("Search content library")} aria-describedby="cairn-search-hint" aria-invalid={error ? true : undefined} value={query} onChange={(event) => { search.handleSearchFieldChange(event.target.value, event.target.selectionStart ?? undefined); }} onKeyUp={(event) => { search.handleSearchFieldCaret(event.currentTarget.selectionStart ?? 0); }} onClick={(event) => { search.handleSearchFieldCaret(event.currentTarget.selectionStart ?? 0); }} placeholder={t("Search names, notes, tags, or facts")} disabled={!isConnected || !catalogHealthy} />
    <span className="sr-only" id="cairn-search-hint">{t("Command or Control plus K focuses this field. Recent searches are kept in this browser only; saving a query as a view is the durable form.")}</span>
    {Boolean(query.trim()) && <button type="button" className="search-clear" aria-label={t("Clear search text")} title={t("Clears the field only. Current results stay until you search again or return to All content.")} onClick={search.clearSearchText}><X size={14} aria-hidden="true" /></button>}
    <button type="submit" className="search-submit" disabled={busy || !query.trim() || !isConnected || !catalogHealthy}>{busy ? <LoaderCircle className="spin" size={16} /> : t("Search")}</button>
    <div className="search-assistance">
      <button type="button" className="search-assistance-toggle" aria-expanded={search.searchRecentsOpen} onClick={search.toggleSearchRecents} disabled={!search.recentSearches.length || Boolean(query.trim())}><History size={13} aria-hidden="true" />{t("Recent searches")}</button>
      <details className="search-help" ref={searchHelpRef}>
        <summary>{t("Search help")}</summary>
        <div className="search-help-content">
          <p>{t("Search by words in names, notes, tags, and recorded facts. Add a field when you need to narrow the results.")}</p>
          <p>{t("Examples: tag:family · type:image · name:report · size:>10MB")}</p>
          <p>{t("Search text is kept as entered. A field that cannot be parsed shows an error and is not submitted.")}</p>
          {parsed.predicates.length > 0 && <div className="search-help-wires" aria-label={t("Search predicates")}>
            {parsed.predicates.map((predicate) => <p key={`${predicate.raw}:${predicate.start}`}><code>{predicate.raw}</code><span aria-hidden="true">→</span><code title={t("The daemon input this predicate writes.")}>{predicateWireLabel(predicate, plan)}</code></p>)}
          </div>}
        </div>
      </details>
    </div>
    {suggestionsOpen && <div className="search-suggest" role="listbox" aria-label={t("Search operators and values")} aria-describedby="cairn-search-suggest-note">
      <p className="search-suggest-note" id="cairn-search-suggest-note">{t("Operators only. Values are suggested where this browser already knows them: tag names come from the loaded tag vocabulary, and protection modes from the daemon's closed protection vocabulary.")}</p>
      {suggestions.map((suggestion, index) => <button key={suggestion.key} type="button" role="option" aria-selected={index === activeSuggestion} className={`search-suggest-entry ${index === activeSuggestion ? "active" : ""}`} onClick={() => ops.acceptSuggestion(index)}>
        {suggestion.kind === "operator"
          ? <><b>{suggestion.name}</b><span>{t(suggestion.description)}</span><code>{suggestion.valueHint}</code></>
          : suggestion.kind === "protection"
            ? <><b>{suggestion.value}</b><span>{t(suggestion.description)}</span><code>{suggestion.token}</code></>
            : <><b>{suggestion.value}</b><span>{t("Tag, {{count}} items", { count: suggestion.count })}</span><code>{suggestion.token}</code></>}
      </button>)}
    </div>}
    {search.searchRecentsOpen && <div className="search-recents" role="group" aria-label={t("Local recent searches")} aria-describedby="cairn-search-recents-note">
      <div className="search-recents-head"><span><History size={13} aria-hidden="true" />{t("Local recent searches")}</span><button type="button" className="search-recents-clear" onClick={search.clearRecentSearches}>{t("Clear recent searches")}</button></div>
      <p className="search-recents-note" id="cairn-search-recents-note">{t("Kept in this browser only. These are not saved views; saving a query as a view is the durable form.")}</p>
      <ul className="search-recents-list" onKeyDown={search.handleRecentsListKeyDown}>
        {search.recentSearches.map((value) => <li className="search-recent-item" key={value}>
          <button type="button" className="search-recent-entry" title={value} onClick={() => search.pickRecentSearch(value)}>{value}</button>
          <button type="button" className="search-recent-remove" aria-label={t("Remove recent search {{query}}", { query: value })} title={t("Remove recent search {{query}}", { query: value })} onClick={() => search.removeRecentSearch(value)}><X size={12} aria-hidden="true" /></button>
        </li>)}
      </ul>
    </div>}
  </form>;

  const operatorPanel = showOperators ? <div className="search-ops" role="group" aria-label={t("Search predicates")}>
    <span className="search-ops-heading">{t("Predicates")}</span>
    <ul className="search-ops-chips">
      {parsed.predicates.map((predicate, index) => <li className={`search-ops-chip${predicate.negated ? " negated" : ""}${predicate.overLoadedResults ? " loaded" : ""}`} key={`${predicate.raw}:${index}`} data-operator={predicate.operator} data-wire={predicateWireLabel(predicate, plan)}>
        {editing?.index === index
          ? <input className="search-ops-chip-edit" autoFocus value={editing.value} aria-label={t("Edit predicate {{token}}", { token: predicate.raw })} onChange={(event) => ops.changeEditValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); ops.commitEdit(); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); ops.cancelEdit(); } }} onBlur={ops.commitEdit} />
          : <button type="button" className="search-ops-chip-edit-trigger" aria-label={t("Edit predicate {{token}}", { token: predicate.raw })} title={t(predicate.negated ? "Negated predicate, evaluated over the loaded results. Select to edit." : searchOperatorInfo(predicate.operator).limitation || "Select to edit this predicate in place.")} onClick={() => ops.beginEdit(index)}>{predicate.raw}</button>}
        <button type="button" className="search-ops-chip-remove" aria-label={t("Remove predicate {{token}}", { token: predicate.raw })} title={t("Removes this predicate from the search text.")} onClick={() => ops.removePredicate(index)}><X size={12} aria-hidden="true" /></button>
      </li>)}
      {parsed.freeText && <li className="search-ops-free"><span>{t("Free text")}</span><b>{parsed.freeText}</b></li>}
    </ul>
    {error && <p className="search-ops-error" role="alert"><AlertCircle size={14} aria-hidden="true" />{t(error.message, error.values)}<span className="sr-only">{t("No search was run for this text.")}</span></p>}
    {!error && plan.limits.length > 0 && <ul className="search-ops-limits">{plan.limits.map((limit) => <li key={limit}>{t(limit)}</li>)}</ul>}
    {!error && plan.limits.length === 0 && <p className="search-ops-hint">{t("Select a predicate to edit it, or remove it to rewrite the search text.")}</p>}
  </div> : null;

  const connection = <span className={`connection ${isConnected ? "ok" : "bad"}`} aria-label={t(status)} role={!isConnected ? "status" : undefined}>{status === "Checking service" ? <LoaderCircle className="spin" size={15} /> : isConnected ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}<span>{t(status)}</span></span>;

  if (usesDestinationHeader) {
    return <header className="topbar topbar--destinations" data-header="destinations">
      <a className="brand brand--focused" href="/" aria-label={t("Cairn home")} onClick={(event) => { if (!canLeaveSettings()) { event.preventDefault(); return; } if (onHome) { event.preventDefault(); onHome(); } }}><span className="brand-mark"><ShieldCheck size={19} /></span><span className="brand-name">Cairn</span></a>
      {presentationNavigation && <div className="topbar-focused-domains">{presentationNavigation}</div>}
      <div className="top-actions top-actions--focused">
        <details className="topbar-disclosure topbar-search" ref={searchDisclosureRef} onToggle={handleSearchToggle}>
          <summary className="topbar-entry topbar-search-summary" aria-label={t("Search content library")} title={t("Search content library")} aria-invalid={error ? true : undefined}><Search size={17} aria-hidden="true" /><span className="topbar-entry-label">{t("Search")}</span>{error && <AlertCircle className="topbar-entry-alert" size={14} aria-hidden="true" />}</summary>
          <div className="topbar-overlay topbar-search-overlay">{searchForm}{operatorPanel}</div>
        </details>
        <button className="primary-button add-button" aria-label={t("Add content")} title={t("Add content")} onClick={(event) => { closeFocusedOverlays(); onOpenAdd(undefined, event.currentTarget); }} disabled={!isConnected || !coreStorageReady}><Plus size={16} /><span className="topbar-entry-label">{t("Add content")}</span></button>
        <details className="topbar-disclosure topbar-menu" ref={menuDisclosureRef} onToggle={handleMenuToggle}>
          <summary className="topbar-entry topbar-menu-summary" aria-label={t("Navigation and status")} title={t("Navigation and status")}><PanelLeft size={17} aria-hidden="true" /><span className="topbar-entry-label">{t("Navigation and status")}</span></summary>
          <div className="topbar-overlay topbar-menu-overlay">
            {(focused || compact) && navigation && <div className="topbar-menu-navigation" onClick={(event) => { if ((event.target as HTMLElement).closest("button, a")) closeMenu(); }}>{navigation}</div>}
            <div className="topbar-menu-actions">
              <button className="secondary-button compact" aria-label={t("Restore latest snapshot")} title={t("Restore latest snapshot")} onClick={(event) => { closeMenu(); onOpenRestore(menuCloseTrigger(event.currentTarget)); }} disabled={!snapshotRef || !isConnected || !coreStorageReady}><ArchiveRestore size={16} /><span>{t("Restore")}</span></button>
              <button className="icon-button" title={t("Refresh service status")} aria-label={t("Refresh service status")} onClick={onRefresh}><RefreshCw size={17} /></button>
              <button className="icon-button settings-trigger" title={t("Open settings")} aria-label={t("Open settings")} onClick={(event) => { closeMenu(); onOpenSettings(menuCloseTrigger(event.currentTarget)); }}><Settings size={17} /></button>
            </div>
            <StatusPanel t={t} status={status} statusData={statusData} capabilities={capabilities} onRefresh={onRefresh} onOpenVerification={(trigger) => { closeMenu(); onOpenVerification(menuCloseTrigger(trigger ?? null)); }} onOpenActivity={onOpenActivity ? () => { closeMenu(); onOpenActivity(); } : undefined} />
          </div>
        </details>
      </div>
      {/* Failures have their own wrapping row; they never crowd out the phone
          actions, and the label remains visible outside the closed menu. */}
      {!isConnected && <div className="topbar-focused-status">{connection}</div>}
    </header>;
  }

  return <>
    <header className="topbar">
      <a className="brand" href="/" aria-label={t("Cairn home")} onClick={(event) => { if (!canLeaveSettings()) { event.preventDefault(); return; } if (onHome) { event.preventDefault(); onHome(); } }}><span className="brand-mark"><ShieldCheck size={19} /></span><span>Cairn</span></a>
      {searchForm}
      {operatorPanel}
      <div className="top-actions">
        {compact && <button type="button" ref={railTriggerRef} className="icon-button rail-trigger" aria-label={t("Open navigation")} title={t("Open navigation")} aria-haspopup="dialog" onClick={(event) => onOpenRail?.(event.currentTarget)}><PanelLeft size={17} aria-hidden="true" /></button>}
        {connection}
        <button className="secondary-button restore-button" aria-label={t("Restore latest snapshot")} title={t("Restore latest snapshot")} onClick={(event) => onOpenRestore(event.currentTarget)} disabled={!snapshotRef || !isConnected || !coreStorageReady}><ArchiveRestore size={16} /><span>{t("Restore")}</span></button>
        <button className="primary-button add-button" aria-label={t("Add content")} title={t("Add content")} onClick={(event) => onOpenAdd(undefined, event.currentTarget)} disabled={!isConnected || !coreStorageReady}><Plus size={16} /><span>{t("Add content")}</span></button>
        <button className="icon-button" title={t("Refresh service status")} aria-label={t("Refresh service status")} onClick={onRefresh}><RefreshCw size={17} /></button>
        <button className="icon-button settings-trigger" title={t("Open settings")} aria-label={t("Open settings")} onClick={(event) => onOpenSettings(event.currentTarget)}><Settings size={17} /></button>
      </div>
    </header>
    {!compact && <StatusPanel t={t} status={status} statusData={statusData} capabilities={capabilities} onRefresh={onRefresh} onOpenVerification={onOpenVerification} onOpenActivity={onOpenActivity} />}
  </>;
}
