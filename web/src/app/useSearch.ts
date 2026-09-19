import { useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import {
  completedOperatorToken, completedProtectionToken, completedTagToken, contentIDMatchesPrefix,
  operatorSuggestions, parseSearchQuery, rewriteSearchText, searchCompletionContext, searchPlan,
  SEARCH_PROTECTION_MODES,
} from "../lib/searchops";
import type { ParsedSearchQuery, SearchOperatorInfo, SearchParseError, SearchPlan } from "../lib/searchops";
import { exactIdentityKey } from "../lib/format";
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
  runSearch: (event?: FormEvent, explicitQuery?: string) => Promise<void>;
  /** Submits search.query with one selected image as the query material (search by image). */
  runImageSearch: (subjectRef: string) => Promise<void>;
  ops: SearchOpsFlow;
};

// The client-side half of the plan: predicates the daemon cannot express are
// evaluated over the hits this query returned, and every one of them is
// labelled as such. A predicate whose projection this browser does not have
// (an empty tag vocabulary, no exact-identity counts) narrows nothing and is
// reported instead of pretending to filter.
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
          if (!context.tagProjectionAvailable) { if (!unavailable.includes("tag")) unavailable.push("tag"); continue; }
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
          if (!context.identityProjectionAvailable) { if (!unavailable.includes("dup")) unavailable.push("dup"); continue; }
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

export function useSearch({ t, query, setQuery, setLastExecutedQuery, workspaceID, isConnected, catalogHealthy, catalogStorageMessage, drawerOpen, settingsOpen, setBusy, notify, markConnected, recents, drafts, canLeaveSettings, exportFlow, library, setSelected, setViewMode }: {
  t: Translator;
  query: string;
  setQuery: (value: string) => void;
  setLastExecutedQuery: (value: string) => void;
  workspaceID: string;
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
}): SearchFlow {
  // Recent searches and the search field's interaction state are browser
  // convenience only: they never record a query as a durable saved view, and
  // they are never read back as authority.
  const [searchFocused, setSearchFocused] = useState(false);
  const [recentsDismissed, setRecentsDismissed] = useState(false);
  const [caret, setCaret] = useState(0);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState("");
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [editing, setEditing] = useState<PredicateEdit | undefined>(undefined);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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
      return operatorSuggestions(completion.prefix).map((operator: SearchOperatorInfo) => ({
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

  // The local recents list appears only while the search field is focused and
  // empty, and it never sits behind a drawer, the image viewer, or the settings
  // dialog.
  const searchRecentsOpen = searchFocused && !query.trim() && recents.recentSearches.length > 0 && !recentsDismissed && !drawerOpen && !settingsOpen;

  // The search field is the one query surface, so the shortcut only moves
  // focus. It never runs a query, never leaves the drawers, the image viewer,
  // or the settings dialog (which own their focus traps), and never touches the
  // selected batch.
  function focusSearchField() {
    searchInputRef.current?.focus({ preventScroll: true });
  }
  function clearSearchText() {
    // Emptying the field is not a search: the current result set stays until
    // the operator submits, or returns to the full library explicitly.
    setQuery("");
    setRecentsDismissed(false);
    setSuggestionsDismissed("");
    setEditing(undefined);
    focusSearchField();
  }
  function pickRecentSearch(value: string) {
    setQuery(value);
    setRecentsDismissed(false);
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
  function handleSearchFieldFocus(target: EventTarget | null) {
    setSearchFocused(true);
    if (target === (searchInputRef.current as EventTarget | null)) setRecentsDismissed(false);
  }
  function handleSearchFieldBlur(stillInside: boolean) {
    if (!stillInside) { setSearchFocused(false); setActiveSuggestion(-1); }
  }
  function handleSearchFieldChange(value: string, nextCaret?: number) {
    setQuery(value);
    setRecentsDismissed(false);
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
      if (searchRecentsOpen) {
        event.preventDefault(); event.stopPropagation();
        setRecentsDismissed(true);
        focusSearchField();
        return;
      }
      if (query) {
        event.preventDefault(); event.stopPropagation();
        setQuery("");
        setRecentsDismissed(false);
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
    if (event.key === "ArrowDown" && searchRecentsOpen) {
      event.preventDefault();
      event.currentTarget.querySelector<HTMLElement>(".search-recent-entry")?.focus({ preventScroll: true });
    }
  }
  // Arrow Up/Down walk the recents controls; ArrowUp from the first control and
  // Escape both return to the field, which is where Enter submits a query.
  function handleRecentsListKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      setRecentsDismissed(true);
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
  async function runSearch(event?: FormEvent, explicitQuery?: string) {
    event?.preventDefault();
    if (!canLeaveSettings()) return;
    const submittedQuery = (explicitQuery ?? query).trim();
    if (!submittedQuery) return;
    // A token this surface cannot express is an error, never a silently
    // different query: no request leaves the browser while one is present.
    const submitted = parseSearchQuery(submittedQuery);
    const submittedPlan = searchPlan(submitted);
    if (submitted.errors.length > 0 || submittedPlan.requestError) {
      setSuggestionsDismissed(submittedQuery);
      setActiveSuggestion(-1);
      notify(undefined);
      focusSearchField();
      return;
    }
    if (!isConnected || !catalogHealthy) { notify({ kind: "error", text: catalogStorageMessage }); return; }
    if (!workspaceID) { notify({ kind: "warning", text: t("Add a source first so there is content to search.") }); return; }
    if (!drafts.canLeaveDetailDrafts()) return;
    setBusy(true); notify(undefined);
    try {
      // Leave dimension selection to the typed dispatcher so ordinary search
      // always uses its lexical + structured + semantic default broker. The
      // operators only add the typed filters and the lexical field scope the
      // daemon already accepts.
      const response = await command(operations.search.query, { workspace_id: workspaceID, ...submittedPlan.request });
      const statusBySubject = new Map(library.libraryItems.map((item) => [item.subject_ref, item.index_status]));
      const returned = (response.data?.hits ?? []) as SearchHit[];
      const identityBySubject = new Map(library.libraryItems.map((item) => [item.subject_ref ?? "", exactIdentityKey(item)]));
      const narrowed = narrowSearchHits(returned, submittedPlan, {
        tagsBySubject: library.tagsBySubject,
        identityCounts: library.identityCounts,
        identityKeyFor: (hit) => identityBySubject.get(hit.subject_ref ?? "") ?? "",
        tagProjectionAvailable: library.workspaceTags.length > 0,
        identityProjectionAvailable: library.identityCounts.size > 0,
      });
      drafts.discardDetailDrafts();
      library.setHits(narrowed.hits.map((hit) => ({ ...hit, index_status: hit.index_status ?? statusBySubject.get(hit.subject_ref ?? "") })));
      setLastExecutedQuery(submittedQuery);
      // A submitted query that the daemon answered is recorded exactly once:
      // case-insensitive de-duplication moves a repeat to the front instead of
      // appending a second entry. This is local history, not a saved view.
      setRecentsDismissed(false);
      setSuggestionsDismissed("");
      setActiveSuggestion(-1);
      setEditing(undefined);
      recents.pushRecentSearch(submittedQuery);
      exportFlow.invalidateForSearch();
      setSelected(undefined); library.setActiveTags([]); library.setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); library.setActiveTimelineMonth(""); setViewMode("search");
      if (response.status === "DEGRADED") {
        const reason = response.reasons?.map((item) => item.message?.trim()).filter((message): message is string => Boolean(message)).map((message) => t(message)).join("; ") || t("Search degradation reason was not reported.");
        notify({ kind: "warning", text: t("Search results are available, but some search coverage is degraded: {{reason}}", { reason }) });
      }
      markConnected();
    } catch (error) { notify({ kind: "error", text: error instanceof Error ? error.message : t("Search failed") }); }
    finally { setBusy(false); }
  }

  // Search by image: the selection bar submits one selected image subject as
  // the query material of the daemon's image dimension. It runs the same
  // `search.query` operation and renders through the same fused pipeline; the
  // image is retrieval material the daemon resolves itself, and this browser
  // never reads or uploads the bytes.
  async function runImageSearch(subjectRef: string) {
    const imageSubjectRef = subjectRef.trim();
    if (!imageSubjectRef) return;
    if (!isConnected || !catalogHealthy) { notify({ kind: "error", text: catalogStorageMessage }); return; }
    if (!workspaceID) { notify({ kind: "warning", text: t("Add a source first so there is content to search.") }); return; }
    if (!drafts.canLeaveDetailDrafts()) return;
    setBusy(true); notify(undefined);
    try {
      // The typed dispatcher owns the default broker; the image-only request
      // carries no text and no filters, so the daemon skips every dimension
      // that has no material for it and reports each one's reason.
      const response = await command(operations.search.query, { workspace_id: workspaceID, image_subject_ref: imageSubjectRef });
      const statusBySubject = new Map(library.libraryItems.map((item) => [item.subject_ref, item.index_status]));
      const returned = (response.data?.hits ?? []) as SearchHit[];
      drafts.discardDetailDrafts();
      library.setHits(returned.map((hit) => ({ ...hit, index_status: hit.index_status ?? statusBySubject.get(hit.subject_ref ?? "") })));
      // An image query has no field text: the results heading says so instead
      // of echoing a query that was never run.
      setLastExecutedQuery("");
      setSelected(undefined); library.setActiveTags([]); library.setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" }); library.setActiveTimelineMonth(""); setViewMode("search");
      exportFlow.invalidateForSearch();
      if (response.status === "DEGRADED") {
        const reason = response.reasons?.map((item) => item.message?.trim()).filter((message): message is string => Boolean(message)).map((message) => t(message)).join("; ") || t("Search degradation reason was not reported.");
        notify({ kind: "warning", text: t("Search results are available, but some search coverage is degraded: {{reason}}", { reason }) });
      }
      markConnected();
    } catch (error) { notify({ kind: "error", text: error instanceof Error ? error.message : t("Search failed") }); }
    finally { setBusy(false); }
  }

  return {
    recentSearches: recents.recentSearches,
    searchFocused,
    searchRecentsOpen,
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
    runImageSearch,
    ops,
  };
}
