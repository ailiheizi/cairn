import { useState } from "react";

// Browser-local convenience lists.
//
// These values are a convenience for one browser only. They are never
// membership, a saved view, a recorded plan, or recovery evidence: the durable
// forms of a query, a destination, and a source path stay with the daemon
// catalog.

// The drawer's path field offers the last path planned in this browser as a
// one-tap suggestion. It is a browser convenience only: the durable source
// record still comes from the daemon, never from localStorage.
const lastSourcePathKey = "restoreweave.last_source_path";
// The restore drawer offers the last few destinations planned in this browser
// as one-tap chips. They are a browser convenience only: the recorded plan,
// the empty-directory check, and the restored bytes stay with the daemon.
const recentRestoreDestinationsKey = "restoreweave.recent_restore_destinations";
const maxRecentRestoreDestinations = 3;
// The search field keeps a short list of the queries this browser submitted.
// It is a local convenience only: the durable form of a query is a SavedView
// (`view.save`), which lives in the daemon catalog with a stable id and
// revision. This list is never membership, a saved view, or recovery evidence.
const recentSearchesKey = "restoreweave.recent_searches";
const maxRecentSearches = 8;

// The recent-destination chips reuse the last few destinations planned in this
// browser. The stored value is a display convenience for the destination field
// only: it never records a plan, a byte count, or a restore result.
function readRecentRestoreDestinations(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(recentRestoreDestinationsKey) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const values: string[] = [];
    for (const item of parsed) {
      const value = typeof item === "string" ? item.trim() : "";
      if (!value || seen.has(value)) continue;
      seen.add(value);
      values.push(value);
      if (values.length >= maxRecentRestoreDestinations) break;
    }
    return values;
  } catch { return []; }
}

function withRecentRestoreDestination(current: string[], destination: string): string[] {
  const value = destination.trim();
  if (!value) return current;
  return [value, ...current.filter((item) => item !== value)].slice(0, maxRecentRestoreDestinations);
}

// The recent-search list is local convenience state: most recent first, at
// most eight entries, and de-duplicated case-insensitively so a repeated query
// moves to the front instead of appearing twice.
function readRecentSearches(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(recentSearchesKey) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const values: string[] = [];
    for (const item of parsed) {
      const value = typeof item === "string" ? item.trim() : "";
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      values.push(value);
      if (values.length >= maxRecentSearches) break;
    }
    return values;
  } catch { return []; }
}

function withRecentSearch(current: string[], submitted: string): string[] {
  const value = submitted.trim();
  if (!value) return current;
  const key = value.toLowerCase();
  return [value, ...current.filter((item) => item.toLowerCase() !== key)].slice(0, maxRecentSearches);
}

export type RecentsFlow = {
  recentSearches: string[];
  recentRestoreDestinations: string[];
  lastPlannedSource: string;
  pushRecentSearch: (submitted: string) => void;
  removeRecentSearch: (value: string) => void;
  clearRecentSearches: () => void;
  pushRecentDestination: (destination: string) => void;
  rememberLastSourcePath: (path: string) => void;
  forgetLastSourcePath: () => void;
};

export function useRecents(): RecentsFlow {
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentSearches());
  const [recentRestoreDestinations, setRecentRestoreDestinations] = useState<string[]>(() => readRecentRestoreDestinations());
  const [lastPlannedSource, setLastPlannedSource] = useState(() => window.localStorage.getItem(lastSourcePathKey) ?? "");

  function pushRecentSearch(submitted: string) {
    setRecentSearches((current) => {
      const next = withRecentSearch(current, submitted);
      window.localStorage.setItem(recentSearchesKey, JSON.stringify(next));
      return next;
    });
  }
  function removeRecentSearch(value: string) {
    setRecentSearches((current) => {
      const next = current.filter((item) => item !== value);
      window.localStorage.setItem(recentSearchesKey, JSON.stringify(next));
      return next;
    });
  }
  function clearRecentSearches() {
    setRecentSearches([]);
    window.localStorage.removeItem(recentSearchesKey);
  }
  function pushRecentDestination(destination: string) {
    setRecentRestoreDestinations((current) => {
      const next = withRecentRestoreDestination(current, destination);
      window.localStorage.setItem(recentRestoreDestinationsKey, JSON.stringify(next));
      return next;
    });
  }
  function rememberLastSourcePath(path: string) {
    const value = path.trim();
    if (!value) return;
    setLastPlannedSource(value);
    window.localStorage.setItem(lastSourcePathKey, value);
  }
  function forgetLastSourcePath() {
    setLastPlannedSource("");
  }

  return {
    recentSearches,
    recentRestoreDestinations,
    lastPlannedSource,
    pushRecentSearch,
    removeRecentSearch,
    clearRecentSearches,
    pushRecentDestination,
    rememberLastSourcePath,
    forgetLastSourcePath,
  };
}
