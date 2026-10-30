import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import {
  completedOperatorToken, completedProtectionToken, completedTagToken, contentIDMatchesPrefix,
  operatorSuggestions, parseSearchQuery, rewriteSearchText, searchCompletionContext, searchPlan,
  SEARCH_OPERATOR_NAMES, SEARCH_PROTECTION_MODES,
} from "../lib/searchops";
import type { ParsedSearchQuery, SearchOperatorInfo, SearchParseError, SearchPlan } from "../lib/searchops";
import { exactIdentityKey } from "../lib/format";
import { resolveArchiveSelectionSizes } from "../lib/originalArchive";
import type { ExportFlow } from "./useExport";
import type { LibraryDraftsFlow } from "./useLibraryDrafts";
import type { LibraryFlow } from "./useLibrary";
import type { Notice, SearchHit, ViewMode } from "../lib/types";

// The one query surface.
//
// Submitting a query is the only search action. The field's recent-searches
// list, its operator autocomplete, its visible predicate row, and its focus
// shortcut never run a query, never record durable state, and never leave the
// drawers, the image viewer, or the settings dialog, which own their own
// dismiss behavior.
//
// The field text is the source of truth for the operators: the predicate row
// and the autocomplete are projections of it, and editing a chip rewrites the
// text. One submit runs `search.query` exactly once.

// "/" is only a shortcut outside a typing surface; an input, textarea, select,
// or contenteditable element keeps its own character.
export function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export type SearchSuggestion =
  | { kind: "operator"; key: string; token: string; name: string; description: string; valueHint: string }
  | { kind: "tag"; key: string; token: string; value: string; count: number }
  | { kind: "protection"; key: string; token: string; value: string; description: string };

export type PredicateEdit = { index: number; value: string };

export type KeywordBrowsePhase = "available" | "loading-first" | "more" | "loading-more" | "complete" | "bounded" | "first-error" | "more-error" | "stale";
export type KeywordBrowseState = { query: string; phase: KeywordBrowsePhase; loaded: number; error: string };

type KeywordBrowseCapture = { query: string; request: SearchPlan["request"]; plan: SearchPlan; workspaceID: string; refreshGeneration: number };
type KeywordBrowseChain = { capture: KeywordBrowseCapture; token: string; loaded: number; phase: KeywordBrowsePhase; rankedHits?: SearchHit[] };
const KEYWORD_BROWSE_PAGE_SIZE = 200;
const KEYWORD_BROWSE_DIMENSION = "lexical-metadata-fts";

type KeywordPageFacts = {
  mode?: unknown;
  lane?: unknown;
  limit?: unknown;
  returned?: unknown;
  completeness?: unknown;
  complete?: unknown;
  has_more?: unknown;
  truncated?: unknown;
  continuation_supported?: unknown;
  token?: unknown;
};

function readKeywordPage(response: Awaited<ReturnType<typeof command>>, t: Translator) {
  const data = response.data as { hits?: unknown; page?: KeywordPageFacts } | undefined;
  const page = data?.page;
  const hits = data?.hits;
  if (response.status !== "SUCCEEDED" || !page || !Array.isArray(hits) || hits.some((hit) => !hit || typeof hit !== "object")) {
    throw new Error(t("The server did not return a usable results page."));
  }
  if (page.mode !== "page" || page.lane !== KEYWORD_BROWSE_DIMENSION || page.limit !== KEYWORD_BROWSE_PAGE_SIZE || page.returned !== hits.length) {
    throw new Error(t("The server returned an incomplete or mismatched results page."));
  }
  if (page.completeness === "MORE_AVAILABLE") {
    if (page.complete !== false || page.has_more !== true || page.truncated !== false || page.continuation_supported !== true || typeof page.token !== "string" || !page.token.trim()) {
      throw new Error(t("The server did not provide a valid next page."));
    }
    return { hits: hits as SearchHit[], page, more: true, token: page.token };
  }
  if (page.completeness === "COMPLETE") {
    if (page.complete !== true || page.has_more !== false || page.truncated !== false || page.continuation_supported !== true || (page.token !== undefined && page.token !== "")) throw new Error(t("The server returned conflicting completeness information."));
    return { hits: hits as SearchHit[], page, more: false, token: "" };
  }
  throw new Error(t("The server did not provide a complete or pageable results set."));
}

export type SearchOpsFlow = {
  parsed: ParsedSearchQuery;
  plan: SearchPlan;
  /** The first token the field cannot express; submitting is refused while it is set. */
  error: SearchParseError | undefined;
  suggestions: SearchSuggestion[];
  suggestionsOpen: boolean;
  activeSuggestion: number;
  tagVocabulary: Array<{ value: string; count: number }>;
  editing: PredicateEdit | undefined;
  moveSuggestion: (delta: number) => void;
  acceptSuggestion: (index: number) => void;
  removePredicate: (index: number) => void;
  beginEdit: (index: number) => void;
  changeEditValue: (value: string) => void;
  commitEdit: () => void;
  cancelEdit: () => void;
};

export type SearchFlow = {
  recentSearches: string[];
  searchFocused: boolean;
  searchRecentsOpen: boolean;
  toggleSearchRecents: () => void;
  searchInputRef: { current: HTMLInputElement | null };
  focusSearchField: () => void;
  clearSearchText: () => void;
  pickRecentSearch: (value: string) => void;
  removeRecentSearch: (value: string) => void;
  clearRecentSearches: () => void;
  handleSearchFieldFocus: (target: EventTarget | null) => void;
  handleSearchFieldBlur: (stillInside: boolean) => void;
  handleSearchFieldChange: (value: string, caret?: number) => void;
  handleSearchFieldCaret: (caret: number) => void;
  handleSearchFieldKeyDown: (event: ReactKeyboardEvent<HTMLFormElement>) => void;
  handleRecentsListKeyDown: (event: ReactKeyboardEvent<HTMLUListElement>) => void;
  runSearch: (event?: FormEvent, explicitQuery?: string, onResults?: (hits: SearchHit[], coverage?: string) => void, acceptResults?: (hits: SearchHit[]) => boolean) => Promise<boolean>;
  keywordBrowse: KeywordBrowseState | undefined;
  runKeywordBrowseAction: () => Promise<void>;
  canReturnToRanked: boolean;
  returnToRanked: () => boolean;
  invalidateKeywordBrowse: () => void;
  /** Submits search.query with one selected image as the query material (search by image). */
  runImageSearch: (subjectRef: string) => Promise<void>;
  /** Submits a text description directly to the existing multimodal image dimension. */
  runVisualTextSearch: (description: string) => Promise<void>;
  ops: SearchOpsFlow;
};

// The client-side half of the plan: predicates the daemon cannot express are
// evaluated over the hits this query returned, and every one of them is
// labelled as such. A predicate whose projection this browser does not have
// refuses the query instead of showing broad hits as though they were filtered.
export function narrowSearchHits(hits: SearchHit[], plan: SearchPlan, context: {
  tagsBySubject: Map<string, string[]>;
  identityCounts: Map<string, number>;
  /**
   * A search hit carries no logical size, so its exact identity is resolved
   * through the loaded listing. A hit the listing does not carry has no
   * recorded identity and is never classified as a duplicate.
   */
  identityKeyFor: (hit: SearchHit) => string;
  tagProjectionAvailable: boolean;
  identityProjectionAvailable: boolean;
}): { hits: SearchHit[]; unavailable: string[] } {
  if (plan.overLoadedResults.length === 0) return { hits, unavailable: [] };
  const unavailable: string[] = [];
  for (const predicate of plan.overLoadedResults) {
    if (predicate.operator === "tag" && !context.tagProjectionAvailable && !unavailable.includes("tag")) unavailable.push("tag");
    if (predicate.operator === "dup" && !context.identityProjectionAvailable && !unavailable.includes("dup")) unavailable.push("dup");
  }
  // A missing projection invalidates the requested local predicate as a
  // whole. Never keep broad hits and let the caller present them as filtered.
  if (unavailable.length > 0) return { hits: [], unavailable };
  const tagsOf = (hit: SearchHit) => context.tagsBySubject.get(hit.subject_ref ?? "") ?? [];
  const identityCount = (hit: SearchHit) => {
    const key = context.identityKeyFor(hit);
    return key ? context.identityCounts.get(key) ?? 1 : 0;
  };
  // The size bounds are read once from the same pure plan the request used.
  const sizeBounds = new Map<string, { min?: number; max?: number }>();
  for (const predicate of plan.overLoadedResults) {
    if (predicate.operator !== "size") continue;
    const bounds = searchPlan(parseSearchQuery(predicate.raw)).request.filters;
    sizeBounds.set(predicate.raw, { min: bounds.size_min, max: bounds.size_max });
  }
  const sizeInRange = (hit: SearchHit, raw: string) => {
    const size = hit.logical_size;
    if (typeof size !== "number") return false;
    const bounds = sizeBounds.get(raw);
    if (!bounds) return false;
    return (bounds.min === undefined || size >= bounds.min) && (bounds.max === undefined || size <= bounds.max);
  };
  const keeps = (hit: SearchHit) => {
    for (const predicate of plan.overLoadedResults) {
      switch (predicate.operator) {
        case "tag": {
          const matches = tagsOf(hit).some((tag) => tag.toLowerCase() === predicate.value.toLowerCase());
          if (predicate.negated ? matches : !matches) return false;
          break;
        }
        case "type":
          if (hit.entry_type === predicate.value) return false;
          break;
        case "size":
          if (sizeInRange(hit, predicate.raw)) return false;
          break;
        case "path":
          if ((hit.path ?? "").toLowerCase().includes(predicate.value.toLowerCase())) return false;
          break;
        case "name":
          if ((hit.name ?? "").toLowerCase().includes(predicate.value.toLowerCase())) return false;
          break;
        case "hash": {
          const matches = contentIDMatchesPrefix(hit.content_id, predicate.value);
          if (predicate.negated ? matches : !matches) return false;
          break;
        }
        case "dup": {
          const duplicate = identityCount(hit) > 1;
          if (predicate.value === "yes" ? !duplicate : duplicate) return false;
          break;
        }
        case "mtime":
          break;
      }
    }
    return true;
  };
  return { hits: hits.filter(keeps), unavailable };
}

export function useSearch({ t, query, setQuery, setLastExecutedQuery, workspaceID, refreshGeneration, viewMode, isConnected, catalogHealthy, catalogStorageMessage, drawerOpen, settingsOpen, setBusy, notify, markConnected, recents, drafts, canLeaveSettings, exportFlow, library, setSelected, setViewMode, clearSelection }: {
  t: Translator;
  query: string;
  setQuery: (value: string) => void;
  setLastExecutedQuery: (value: string) => void;
  workspaceID: string;
  refreshGeneration: number;
  viewMode: ViewMode;
  isConnected: boolean;
  catalogHealthy: boolean;
  catalogStorageMessage: string;
  drawerOpen: boolean;
  settingsOpen: boolean;
  setBusy: (value: boolean) => void;
  notify: (notice: Notice | undefined) => void;
  markConnected: () => void;
  recents: { recentSearches: string[]; pushRecentSearch: (query: string) => void; removeRecentSearch: (value: string) => void; clearRecentSearches: () => void };
  drafts: LibraryDraftsFlow;
  canLeaveSettings: () => boolean;
  exportFlow: ExportFlow;
  library: LibraryFlow;
  setSelected: (hit: SearchHit | undefined) => void;
  setViewMode: (mode: ViewMode) => void;
  clearSelection: () => void;
}): SearchFlow {
  // Recent searches and the search field's interaction state are browser
  // convenience only: they never record a query as a durable saved view, and
  // they are never read back as authority.
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchRecentsOpen, setSearchRecentsOpen] = useState(false);
  const [caret, setCaret] = useState(0);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState("");
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [editing, setEditing] = useState<PredicateEdit | undefined>(undefined);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [keywordBrowse, setKeywordBrowse] = useState<KeywordBrowseState>();
  const [canReturnToRanked, setCanReturnToRanked] = useState(false);
  const keywordBrowseRef = useRef<KeywordBrowseChain | null>(null);
  const keywordBrowseRequestRef = useRef(0);
  const imageSearchInFlightRef = useRef(false);
  const currentBrowseContextRef = useRef({ workspaceID, refreshGeneration, viewMode });
  currentBrowseContextRef.current = { workspaceID, refreshGeneration, viewMode };
  const localProjectionRef = useRef({
    workspaceID,
    tagReady: library.tagStatus === "ready" && library.tagSnapshotKnown && library.tagVocabularyWorkspaceID === workspaceID,
    tagStatus: library.tagStatus,
    tagSnapshotKnown: library.tagSnapshotKnown,
    tagVocabularyWorkspaceID: library.tagVocabularyWorkspaceID,
    workspaceTags: library.workspaceTags,
    tagsBySubject: library.tagsBySubject,
    identityCounts: library.identityCounts,
  });
  localProjectionRef.current = {
    workspaceID,
    tagReady: library.tagStatus === "ready" && library.tagSnapshotKnown && library.tagVocabularyWorkspaceID === workspaceID,
    tagStatus: library.tagStatus,
    tagSnapshotKnown: library.tagSnapshotKnown,
    tagVocabularyWorkspaceID: library.tagVocabularyWorkspaceID,
    workspaceTags: library.workspaceTags,
    tagsBySubject: library.tagsBySubject,
    identityCounts: library.identityCounts,
  };

  function unavailableLocalProjections(plan: SearchPlan, activeWorkspaceID: string, snapshot = localProjectionRef.current) {
    const unavailable: string[] = [];
    for (const predicate of plan.overLoadedResults) {
      if (predicate.operator === "tag" && (snapshot.workspaceID !== activeWorkspaceID || !snapshot.tagReady)) unavailable.push("tag");
      if (predicate.operator === "dup" && (snapshot.workspaceID !== activeWorkspaceID || snapshot.identityCounts.size === 0)) unavailable.push("dup");
    }
    return [...new Set(unavailable)];
  }

  function requiredLocalProjectionNames(plan: SearchPlan) {
    return [...new Set(plan.overLoadedResults.flatMap((predicate) => predicate.operator === "tag" || predicate.operator === "dup" ? [predicate.operator] : []))];
  }

  function changedLocalProjectionNames(plan: SearchPlan, activeWorkspaceID: string, before: typeof localProjectionRef.current) {
    const after = localProjectionRef.current;
    const changed: string[] = [];
    if (before.workspaceID !== activeWorkspaceID || after.workspaceID !== activeWorkspaceID) return requiredLocalProjectionNames(plan);
    if (plan.overLoadedResults.some((predicate) => predicate.operator === "tag") && (before.tagReady !== after.tagReady || before.tagStatus !== after.tagStatus || before.tagSnapshotKnown !== after.tagSnapshotKnown || before.tagVocabularyWorkspaceID !== after.tagVocabularyWorkspaceID || before.workspaceTags !== after.workspaceTags || before.tagsBySubject !== after.tagsBySubject)) changed.push("tag");
    if (plan.overLoadedResults.some((predicate) => predicate.operator === "dup") && before.identityCounts !== after.identityCounts) changed.push("dup");
    return changed;
  }

  function localProjectionError(unavailable: string[]) {
    const conditions = unavailable.map((condition) => condition === "tag" ? t("Tags") : t("Exact duplicates")).join(", ");
    return t("Could not apply these filters: {{conditions}}. Their data is unavailable or changed. Previous results are unchanged; refresh and try again.", { conditions });
  }

  function invalidateKeywordBrowse() {
    keywordBrowseRequestRef.current += 1;
    keywordBrowseRef.current = null;
    setKeywordBrowse(undefined);
    setCanReturnToRanked(false);
  }

  function returnToRanked() {
    const chain = keywordBrowseRef.current;
    const context = currentBrowseContextRef.current;
    if (!canReturnToRanked || !chain?.rankedHits || context.viewMode !== "search"
      || context.workspaceID !== chain.capture.workspaceID || context.refreshGeneration !== chain.capture.refreshGeneration
      || exportFlow.recalledView || !canLeaveSettings() || !drafts.canLeaveDetailDrafts()) return false;
    drafts.discardDetailDrafts();
    clearSelection();
    setSelected(undefined);
    library.setHits(chain.rankedHits);
    library.setJustSavedBatch(false);
    setQuery(chain.capture.query);
    keywordBrowseRequestRef.current += 1;
    keywordBrowseRef.current = { ...chain, token: "", loaded: 0, phase: "available" };
    setKeywordBrowse({ query: chain.capture.query, phase: "available", loaded: 0, error: "" });
    setCanReturnToRanked(false);
    return true;
  }

  useEffect(() => {
    const chain = keywordBrowseRef.current;
    if (!chain) return;
    const context = currentBrowseContextRef.current;
    if (context.viewMode !== "search" || context.workspaceID !== chain.capture.workspaceID || context.refreshGeneration !== chain.capture.refreshGeneration || exportFlow.recalledView) {
      invalidateKeywordBrowse();
    }
  }, [exportFlow.recalledView, refreshGeneration, viewMode, workspaceID]);

  // The predicate row is a projection of the field text, never a second
  // source of truth: the same parse decides the chips, the errors, and the
  // exact request the next submit sends.
  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const plan = useMemo(() => searchPlan(parsed), [parsed]);
  // A token the grammar cannot express, and a query the daemon would receive
  // empty, are both errors: the surface refuses instead of sending a different
  // search than the one that was typed.
  const error: SearchParseError | undefined = parsed.errors[0] ?? (plan.requestError ? { raw: query.trim(), message: plan.requestError, values: {} } : undefined);

  // Operator autocomplete. Values are offered only where this browser really
  // knows them: the loaded tag vocabulary with its counts. Every other
  // operator offers its name and its one-line description, never a value.
  const completion = useMemo(() => searchCompletionContext(query, Math.min(caret, query.length)), [query, caret]);
  const suggestions = useMemo<SearchSuggestion[]>(() => {
    if (suggestionsDismissed && suggestionsDismissed === query) return [];
    if (completion.kind === "operator") {
      // An unqualified word, including a partial operator prefix, remains
      // ordinary search text. Offer operator choices after an exact name.
      const operatorName = completion.prefix.replace(/^-/, "").toLowerCase();
      if (!SEARCH_OPERATOR_NAMES.includes(operatorName as (typeof SEARCH_OPERATOR_NAMES)[number])) return [];
      return operatorSuggestions(completion.prefix.slice(0, -1))
        .filter((operator: SearchOperatorInfo) => operator.name === operatorName)
        .map((operator: SearchOperatorInfo) => ({
        kind: "operator" as const,
        key: `operator:${operator.name}`,
        token: completedOperatorToken(completion.prefix, operator),
        name: `${operator.name}:`,
        description: operator.description,
        valueHint: operator.valueHint,
      }));
    }
    if (completion.kind === "tag") {
      const prefix = completion.prefix.replace(/^["']/, "").toLowerCase();
      return library.tagFacets
        .filter((facet) => facet.value.toLowerCase().startsWith(prefix))
        .slice(0, 12)
        .map((facet) => ({ kind: "tag" as const, key: `tag:${facet.value}`, token: completedTagToken(facet.value), value: facet.value, count: facet.count }));
    }
    if (completion.kind === "protection") {
      // The protection modes are a closed vocabulary the daemon's own records
      // use, so offering them is a fact, not a fabrication; no other operator
      // offers values this browser cannot know.
      const prefix = completion.prefix.replace(/^["']/, "").toUpperCase();
      return SEARCH_PROTECTION_MODES
        .filter((mode) => mode.value.startsWith(prefix))
        .map((mode) => ({ kind: "protection" as const, key: `protection:${mode.value}`, token: completedProtectionToken(mode.value), value: mode.value, description: mode.description }));
    }
    return [];
  }, [completion, library.tagFacets, query, suggestionsDismissed]);
  const suggestionsOpen = searchFocused && suggestions.length > 0 && !drawerOpen && !settingsOpen;

  const ops: SearchOpsFlow = {
    parsed,
    plan,
    error,
    suggestions,
    suggestionsOpen,
    activeSuggestion,
    tagVocabulary: library.tagFacets,
    editing,
    moveSuggestion(delta: number) {
      if (!suggestionsOpen) return;
      const next = activeSuggestion + delta;
      setActiveSuggestion(next < 0 ? suggestions.length - 1 : next >= suggestions.length ? 0 : next);
    },
    acceptSuggestion(index: number) {
      const suggestion = suggestions[index];
      if (!suggestion) return;
      const source = query;
      const next = `${source.slice(0, completion.replaceStart)}${suggestion.token}${source.slice(completion.replaceEnd)}`;
      setQuery(next);
      setActiveSuggestion(-1);
      setSuggestionsDismissed("");
      const position = completion.replaceStart + suggestion.token.length;
      setCaret(position);
      requestAnimationFrame(() => {
        const field = searchInputRef.current;
        if (!field) return;
        field.focus({ preventScroll: true });
        field.setSelectionRange(position, position);
      });
    },
    removePredicate(index: number) {
      setEditing(undefined);
      setQuery(rewriteSearchText(parsed, index, null));
      focusSearchField();
    },
    beginEdit(index: number) {
      const predicate = parsed.predicates[index];
      if (!predicate) return;
      setActiveSuggestion(-1);
      setEditing({ index, value: predicate.valueRaw });
    },
    changeEditValue(value: string) { setEditing((current) => (current ? { ...current, value } : current)); },
    commitEdit() {
      if (!editing) return;
      const predicate = parsed.predicates[editing.index];
      const value = editing.value.trim();
      setEditing(undefined);
      if (!predicate || !value) { focusSearchField(); return; }
      setQuery(rewriteSearchText(parsed, editing.index, `${predicate.negated ? "-" : ""}${predicate.operator}:${value}`));
      focusSearchField();
    },
    cancelEdit() { setEditing(undefined); focusSearchField(); },
  };

  // Recent history is an explicit convenience disclosure. It is available only
  // for an empty query and never sits behind a drawer or settings dialog.
  const showSearchRecents = searchRecentsOpen && !query.trim() && !drawerOpen && !settingsOpen;

  // The search field is the one query surface, so the shortcut only moves
  // focus. It never runs a query, never leaves the drawers, the image viewer,
  // or the settings dialog (which own their focus traps), and never touches the
  // selected batch. A focused page keeps that one form inside a native
  // disclosure, so opening the closest details keeps the shortcut from
  // focusing a hidden field; nothing else about the field or its grammar moves.
  function focusSearchField() {
    const field = searchInputRef.current;
    const disclosure = field?.closest("details");
    if (disclosure && !disclosure.open) disclosure.open = true;
    field?.focus({ preventScroll: true });
  }
  function clearSearchText() {
    // Emptying the field is not a search: the current result set stays until
    // the operator submits, or returns to the full library explicitly.
    setQuery("");
    setSearchRecentsOpen(false);
    setSuggestionsDismissed("");
    setEditing(undefined);
    focusSearchField();
  }
  function pickRecentSearch(value: string) {
    setQuery(value);
    setSearchRecentsOpen(false);
    setSuggestionsDismissed("");
    void runSearch(undefined, value);
  }
  function removeRecentSearch(value: string) {
    recents.removeRecentSearch(value);
    focusSearchField();
  }
  function clearRecentSearches() {
    recents.clearRecentSearches();
    focusSearchField();
  }
  function toggleSearchRecents() {
    if (query.trim() || !recents.recentSearches.length) return;
    setSearchRecentsOpen((open) => !open);
  }
  function handleSearchFieldFocus(target: EventTarget | null) {
    setSearchFocused(true);
    if (target === (searchInputRef.current as EventTarget | null)) setActiveSuggestion(-1);
  }
  function handleSearchFieldBlur(stillInside: boolean) {
    if (!stillInside) { setSearchFocused(false); setSearchRecentsOpen(false); setActiveSuggestion(-1); }
  }
  function handleSearchFieldChange(value: string, nextCaret?: number) {
    setQuery(value);
    setSearchRecentsOpen(false);
    setSuggestionsDismissed("");
    setActiveSuggestion(-1);
    if (typeof nextCaret === "number") setCaret(nextCaret);
  }
  function handleSearchFieldCaret(nextCaret: number) {
    setCaret(nextCaret);
    setActiveSuggestion(-1);
  }
  // Escape closes the autocomplete, then the local recents list, and only
  // empties the field on the next press. All of it stays inside the search
  // field: the drawers, the image viewer, and the settings dialog keep their
  // own dismiss behavior.
  function handleSearchFieldKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.target !== searchInputRef.current) return;
    if (drawerOpen || settingsOpen || document.querySelector('[aria-modal="true"]')) return;
    if (event.key === "Escape") {
      if (suggestionsOpen) {
        event.preventDefault(); event.stopPropagation();
        setSuggestionsDismissed(query);
        setActiveSuggestion(-1);
        return;
      }
      if (showSearchRecents) {
        event.preventDefault(); event.stopPropagation();
        setSearchRecentsOpen(false);
        focusSearchField();
        return;
      }
      if (query) {
        event.preventDefault(); event.stopPropagation();
        setQuery("");
        setSearchRecentsOpen(false);
        focusSearchField();
      }
      return;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestionsOpen) {
      event.preventDefault();
      ops.moveSuggestion(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" && suggestionsOpen && activeSuggestion >= 0) {
      // Enter accepts the highlighted suggestion instead of submitting; a
      // submit still needs one more Enter, so no query is ever implied.
      event.preventDefault();
      ops.acceptSuggestion(activeSuggestion);
      return;
    }
    if (event.key === "ArrowDown" && showSearchRecents) {
      event.preventDefault();
      event.currentTarget.querySelector<HTMLElement>(".search-recent-entry")?.focus({ preventScroll: true });
    }
  }
  // Arrow Up/Down walk the recents controls; ArrowUp from the first control and
  // Escape both return to the field, which is where Enter submits a query.
  function handleRecentsListKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      setSearchRecentsOpen(false);
      focusSearchField();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(".search-recent-entry, .search-recent-remove"));
    const index = controls.indexOf((event.target as HTMLElement).closest<HTMLElement>("button") ?? (event.target as HTMLElement));
    if (index < 0) return;
    const next = event.key === "ArrowDown" ? controls[index + 1] : controls[index - 1];
    if (next) next.focus({ preventScroll: true });
    else if (event.key === "ArrowUp") focusSearchField();
  }
  async function runKeywordBrowseAction() {
    let chain = keywordBrowseRef.current;
    if (!chain) return;
    const firstPage = chain.phase === "available" || chain.phase === "first-error" || chain.phase === "stale";
    const nextPage = chain.phase === "more" || chain.phase === "more-error";
    if (!firstPage && !nextPage) return;
    const context = currentBrowseContextRef.current;
    if (context.viewMode !== "search" || context.workspaceID !== chain.capture.workspaceID || context.refreshGeneration !== chain.capture.refreshGeneration || exportFlow.recalledView) {
      invalidateKeywordBrowse();
      return;
    }
    if (!isConnected || !catalogHealthy) { notify({ kind: "error", text: catalogStorageMessage }); return; }
    if (!chain.capture.workspaceID) { notify({ kind: "warning", text: t("Add a source first so there is content to search.") }); return; }
    if (firstPage && (!canLeaveSettings() || !drafts.canLeaveDetailDrafts())) return;

    const projectionAtStart = localProjectionRef.current;
    const unavailableAtStart = unavailableLocalProjections(chain.capture.plan, chain.capture.workspaceID, projectionAtStart);
    if (unavailableAtStart.length > 0) {
      const message = localProjectionError(unavailableAtStart);
      chain.phase = firstPage ? "first-error" : "more-error";
      setKeywordBrowse({ query: chain.capture.query, phase: chain.phase, loaded: chain.loaded, error: message });
      notify({ kind: "error", text: message });
      return;
    }

    const requestSequence = ++keywordBrowseRequestRef.current;
    if (firstPage) {
      chain = { ...chain, token: "", loaded: 0, rankedHits: chain.rankedHits ?? [...library.hits] };
      keywordBrowseRef.current = chain;
    }
    chain.phase = firstPage ? "loading-first" : "loading-more";
    const searchIntent = library.beginSearchIntent(chain.capture.workspaceID);
    setKeywordBrowse({ query: chain.capture.query, phase: chain.phase, loaded: chain.loaded, error: "" });
    notify(undefined);
    try {
      const response = await command(operations.search.query, {
        workspace_id: chain.capture.workspaceID,
        ...chain.capture.request,
        dimension: KEYWORD_BROWSE_DIMENSION,
        page: { limit: KEYWORD_BROWSE_PAGE_SIZE, ...(firstPage ? {} : { token: chain.token }) },
      });
      const liveContext = currentBrowseContextRef.current;
      if (requestSequence !== keywordBrowseRequestRef.current || keywordBrowseRef.current !== chain || !library.isCurrentSearchIntent(searchIntent, chain.capture.workspaceID)) return;
      if (liveContext.viewMode !== "search" || liveContext.workspaceID !== chain.capture.workspaceID || liveContext.refreshGeneration !== chain.capture.refreshGeneration || exportFlow.recalledView) {
        invalidateKeywordBrowse();
        return;
      }
      const changedProjections = changedLocalProjectionNames(chain.capture.plan, chain.capture.workspaceID, projectionAtStart);
      if (changedProjections.length > 0) {
        const message = localProjectionError(changedProjections);
        chain.phase = firstPage ? "first-error" : "more-error";
        setKeywordBrowse({ query: chain.capture.query, phase: chain.phase, loaded: chain.loaded, error: message });
        notify({ kind: "error", text: message });
        return;
      }
      const rawPage = (response.data as { page?: KeywordPageFacts } | undefined)?.page;
      if (rawPage?.completeness === "BOUNDED_UNKNOWN") {
        const rawHits = (response.data as { hits?: unknown } | undefined)?.hits;
        if ((response.status !== "SUCCEEDED" && response.status !== "DEGRADED") || rawPage.mode !== "page" || rawPage.lane !== KEYWORD_BROWSE_DIMENSION || (rawPage.limit !== 0 && rawPage.limit !== KEYWORD_BROWSE_PAGE_SIZE) || !Array.isArray(rawHits) || rawPage.returned !== rawHits.length || rawPage.complete !== false || rawPage.has_more !== false || rawPage.truncated !== true || rawPage.continuation_supported !== false || (rawPage.token !== undefined && rawPage.token !== "")) {
          throw new Error(t("The server returned conflicting completeness information."));
        }
        chain.phase = "bounded";
        setKeywordBrowse({ query: chain.capture.query, phase: chain.phase, loaded: chain.loaded, error: "" });
        return;
      }
      const page = readKeywordPage(response, t);
      const loadedItems = library.currentLibraryItems(chain.capture.workspaceID);
      const statusBySubject = new Map(loadedItems.map((item) => [item.subject_ref, item.index_status]));
      const returned = resolveArchiveSelectionSizes(page.hits, loadedItems);
      const identityBySubject = new Map(loadedItems.map((item) => [item.subject_ref ?? "", exactIdentityKey(item)]));
      const narrowed = narrowSearchHits(returned, chain.capture.plan, {
        tagsBySubject: library.tagsBySubject,
        identityCounts: library.identityCounts,
        identityKeyFor: (hit) => identityBySubject.get(hit.subject_ref ?? "") ?? "",
        tagProjectionAvailable: projectionAtStart.tagReady,
        identityProjectionAvailable: projectionAtStart.identityCounts.size > 0,
      });
      if (narrowed.unavailable.length > 0) throw new Error(localProjectionError(narrowed.unavailable));
      const visibleHits = narrowed.hits.map((hit) => ({ ...hit, index_status: hit.index_status ?? statusBySubject.get(hit.subject_ref ?? "") }));
      if (firstPage) {
        if (!canLeaveSettings() || !drafts.canLeaveDetailDrafts()) {
          chain.phase = "available";
          setKeywordBrowse({ query: chain.capture.query, phase: "available", loaded: 0, error: "" });
          return;
        }
        drafts.discardDetailDrafts();
        clearSelection();
        setSelected(undefined);
        library.setJustSavedBatch(false);
        library.setHits(visibleHits);
        setCanReturnToRanked(true);
      } else {
        // The daemon's opaque token advances one exact lexical chain. Preserve
        // its order and every returned subject; it owns exact-once paging.
        library.setHits((current) => [...current, ...visibleHits]);
      }
      chain.loaded += page.hits.length;
      chain.token = page.more ? page.token : "";
      chain.phase = page.more ? "more" : "complete";
      setKeywordBrowse({ query: chain.capture.query, phase: chain.phase, loaded: chain.loaded, error: "" });
      markConnected();
    } catch (caught) {
      if (requestSequence !== keywordBrowseRequestRef.current || keywordBrowseRef.current !== chain || !library.isCurrentSearchIntent(searchIntent, chain.capture.workspaceID)) return;
      const rawMessage = caught instanceof Error ? caught.message : "Search failed";
      const message = t(rawMessage);
      const refusedContinuation = !firstPage && /continuation|cursor/i.test(rawMessage);
      chain.phase = firstPage ? "first-error" : refusedContinuation ? "stale" : "more-error";
      if (refusedContinuation) chain.token = "";
      setKeywordBrowse({ query: chain.capture.query, phase: chain.phase, loaded: chain.loaded, error: message });
    }
  }
  async function runSearch(event?: FormEvent, explicitQuery?: string, onResults?: (hits: SearchHit[], coverage?: string) => void, acceptResults?: (hits: SearchHit[]) => boolean) {
    const report = onResults ? (_notice: Notice | undefined) => {} : notify;
    event?.preventDefault();
    if (!canLeaveSettings()) return false;
    const submittedQuery = (explicitQuery ?? query).trim();
    if (!submittedQuery) return false;
    // A token this surface cannot express is an error, never a silently
    // different query: no request leaves the browser while one is present.
    const submitted = parseSearchQuery(submittedQuery);
    const submittedPlan = searchPlan(submitted);
    if (submitted.errors.length > 0 || submittedPlan.requestError) {
      setSuggestionsDismissed(submittedQuery);
      setActiveSuggestion(-1);
      report(undefined);
      focusSearchField();
      return false;
    }
    if (!isConnected || !catalogHealthy) { report({ kind: "error", text: catalogStorageMessage }); return false; }
    if (!workspaceID) { report({ kind: "warning", text: t("Add a source first so there is content to search.") }); return false; }
    if (!drafts.canLeaveDetailDrafts()) return false;
    const projectionAtStart = localProjectionRef.current;
    const unavailableAtStart = unavailableLocalProjections(submittedPlan, workspaceID, projectionAtStart);
    if (unavailableAtStart.length > 0) {
      report({ kind: "error", text: localProjectionError(unavailableAtStart) });
      return false;
    }
    if (!onResults) invalidateKeywordBrowse();
    const searchIntent = library.beginSearchIntent(workspaceID);
    setBusy(true); report(undefined);
    try {
      // Leave dimension selection to the typed dispatcher so ordinary search
      // always uses its lexical + structured + semantic default broker. The
      // operators only add the typed filters and the lexical field scope the
      // daemon already accepts.
      const response = await command(operations.search.query, { workspace_id: workspaceID, ...submittedPlan.request });
      if (!library.isCurrentSearchIntent(searchIntent, workspaceID)) return false;
      const changedProjections = changedLocalProjectionNames(submittedPlan, workspaceID, projectionAtStart);
      if (changedProjections.length > 0) {
        report({ kind: "error", text: localProjectionError(changedProjections) });
        return false;
      }
      const loadedItems = library.currentLibraryItems(workspaceID);
      const statusBySubject = new Map(loadedItems.map((item) => [item.subject_ref, item.index_status]));
      const returned = resolveArchiveSelectionSizes((response.data?.hits ?? []) as SearchHit[], loadedItems);
      const identityBySubject = new Map(loadedItems.map((item) => [item.subject_ref ?? "", exactIdentityKey(item)]));
      const narrowed = narrowSearchHits(returned, submittedPlan, {
        tagsBySubject: library.tagsBySubject,
        identityCounts: library.identityCounts,
        identityKeyFor: (hit) => identityBySubject.get(hit.subject_ref ?? "") ?? "",
        tagProjectionAvailable: projectionAtStart.tagReady,
        identityProjectionAvailable: projectionAtStart.identityCounts.size > 0,
      });
      if (narrowed.unavailable.length > 0) throw new Error(localProjectionError(narrowed.unavailable));
      // The floating client projects the same broker response without changing
      // the background query, selection, browse position or presentation.
      if (onResults) {
        onResults(narrowed.hits.map((hit) => ({ ...hit, index_status: hit.index_status ?? statusBySubject.get(hit.subject_ref ?? "") })), response.status === "DEGRADED" ? t("Search results are available, but some search coverage is degraded: {{reason}}", { reason: response.reasons?.map((item) => item.message).filter(Boolean).join("; ") || t("Search degradation reason was not reported.") }) : undefined);
        markConnected();
        return true;
      }
      // Explicit result navigation can reject a stale fresh answer before it
      // replaces the background scope. This is the normal host search path.
      if (acceptResults && !acceptResults(narrowed.hits)) return false;
      drafts.discardDetailDrafts();
      library.setJustSavedBatch(false);
      library.setHits(narrowed.hits.map((hit) => ({ ...hit, index_status: hit.index_status ?? statusBySubject.get(hit.subject_ref ?? "") })));
      setLastExecutedQuery(submittedQuery);
      // A submitted query that the daemon answered is recorded exactly once:
      // case-insensitive de-duplication moves a repeat to the front instead of
      // appending a second entry. This is local history, not a saved view.
      setSearchRecentsOpen(false);
      setSuggestionsDismissed("");
      setActiveSuggestion(-1);
      setEditing(undefined);
      recents.pushRecentSearch(submittedQuery);
      if (submittedPlan.request.query.trim() || Object.keys(submittedPlan.request.filters ?? {}).length > 0) {
        keywordBrowseRef.current = {
          capture: {
            query: submittedQuery,
            request: { ...submittedPlan.request, filters: { ...submittedPlan.request.filters }, ...(submittedPlan.request.construct_axes ? { construct_axes: [...submittedPlan.request.construct_axes] } : {}) },
            plan: submittedPlan,
            workspaceID,
            refreshGeneration: currentBrowseContextRef.current.refreshGeneration,
          },
          token: "",
          loaded: 0,
          phase: "available",
        };
        setKeywordBrowse({ query: submittedQuery, phase: "available", loaded: 0, error: "" });
      } else {
        keywordBrowseRef.current = null;
        setKeywordBrowse(undefined);
      }
      exportFlow.invalidateForSearch();
      setSelected(undefined); library.setActiveTags([]); library.setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); library.setActiveTimelineMonth(""); setViewMode("search");
      if (response.status === "DEGRADED") {
        const reason = response.reasons?.map((item) => item.message?.trim()).filter((message): message is string => Boolean(message)).map((message) => t(message)).join("; ") || t("Search degradation reason was not reported.");
        report({ kind: "warning", text: t("Search results are available, but some search coverage is degraded: {{reason}}", { reason }) });
      }
      markConnected();
      return true;
    } catch (error) {
      if (!library.isCurrentSearchIntent(searchIntent, workspaceID)) return false;
      report({ kind: "error", text: error instanceof Error ? error.message : t("Search failed") });
      return false;
    }
    finally { setBusy(false); }
  }

  // Search by image: the selection bar submits one selected image subject as
  // the query material of the daemon's image dimension. It runs the same
  // `search.query` operation and renders through the same fused pipeline; the
  // image is retrieval material the daemon resolves itself, and this browser
  // never reads or uploads the bytes.
  async function runMultimodalSearch(input: { imageSubjectRef?: string; description?: string }) {
    const imageSubjectRef = input.imageSubjectRef?.trim() ?? "";
    const description = input.description?.trim() ?? "";
    if (!imageSubjectRef && !description) return;
    if (imageSearchInFlightRef.current) return;
    if (!isConnected || !catalogHealthy) { notify({ kind: "error", text: catalogStorageMessage }); return; }
    if (!workspaceID) { notify({ kind: "warning", text: t("Add a source first so there is content to search.") }); return; }
    if (!drafts.canLeaveDetailDrafts()) return;
    imageSearchInFlightRef.current = true;
    const searchIntent = library.beginSearchIntent(workspaceID);
    setBusy(true); notify(undefined);
    try {
      // Pin the visual dimension so BGE/lexical results cannot stand in for a
      // missing CLIP text or image result. The daemon still owns query policy,
      // subject resolution and every source read.
      const response = await command(operations.search.query, {
        workspace_id: workspaceID,
        dimension: "multimodal-clip",
        ...(description ? { query: description } : { image_subject_ref: imageSubjectRef }),
      });
      if (!library.isCurrentSearchIntent(searchIntent, workspaceID)) return;
      const responseData = response.data as {
        dimension?: string;
        index_generation_ref?: string;
        query_provider_ref?: string;
        hits?: unknown;
      } | undefined;
      const generationRef = responseData?.index_generation_ref?.trim() ?? "";
      const validGenerationRef = /^[a-z0-9]{2,12}_[a-f0-9]{32}$/.test(generationRef);
      if (response.status !== "SUCCEEDED"
        || responseData?.dimension !== "multimodal-clip"
        || responseData?.query_provider_ref !== "query.multimodal.onnx-clip-zvec.v1"
        || !validGenerationRef) {
        const reason = response.reasons?.map((item) => item.message?.trim()).find(Boolean);
        notify({ kind: "error", text: reason ? `${t("Visual search is unavailable")}: ${t(reason)}` : t("Visual search is unavailable") });
        return;
      }
      if (!Array.isArray(responseData?.hits) || responseData.hits.some((hit) => !hit || typeof hit !== "object" || Array.isArray(hit) || !String((hit as SearchHit).subject_ref ?? "").trim())) {
        throw new Error(t("The server did not return a usable results page."));
      }
      const loadedItems = library.currentLibraryItems(workspaceID);
      const statusBySubject = new Map(loadedItems.map((item) => [item.subject_ref, item.index_status]));
      const returned = resolveArchiveSelectionSizes(responseData.hits as SearchHit[], loadedItems);
      invalidateKeywordBrowse();
      drafts.discardDetailDrafts();
      library.setHits(returned.map((hit) => ({ ...hit, index_status: hit.index_status ?? statusBySubject.get(hit.subject_ref ?? "") })));
      // Neither query is a lexical SavedView candidate: keep it out of the
      // shared lexical field and let the Photos form retain its own prompt.
      setLastExecutedQuery("");
      setSelected(undefined); library.setActiveTags([]); library.setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); library.setActiveTimelineMonth(""); setViewMode("search");
      exportFlow.invalidateForSearch();
      markConnected();
    } catch (error) {
      if (!library.isCurrentSearchIntent(searchIntent, workspaceID)) return;
      notify({ kind: "error", text: error instanceof Error ? error.message : t("Search failed") });
    }
    finally {
      imageSearchInFlightRef.current = false;
      if (library.isCurrentSearchIntent(searchIntent, workspaceID)) setBusy(false);
    }
  }

  async function runImageSearch(subjectRef: string) {
    await runMultimodalSearch({ imageSubjectRef: subjectRef });
  }

  async function runVisualTextSearch(description: string) {
    await runMultimodalSearch({ description });
  }

  return {
    recentSearches: recents.recentSearches,
    searchFocused,
    searchRecentsOpen: showSearchRecents,
    toggleSearchRecents,
    searchInputRef,
    focusSearchField,
    clearSearchText,
    pickRecentSearch,
    removeRecentSearch,
    clearRecentSearches,
    handleSearchFieldFocus,
    handleSearchFieldBlur,
    handleSearchFieldChange,
    handleSearchFieldCaret,
    handleSearchFieldKeyDown,
    handleRecentsListKeyDown,
    runSearch,
    keywordBrowse,
    runKeywordBrowseAction,
    canReturnToRanked,
    returnToRanked,
    invalidateKeywordBrowse,
    runImageSearch,
    runVisualTextSearch,
    ops,
  };
}
