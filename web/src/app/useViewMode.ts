import { useEffect, useState } from "react";
import type { LibraryLayout, SortDirection, SortField, ViewMode } from "../lib/types";

// Presentation preferences of the library view.
//
// The view mode is a session choice; the layout and the sort are browser
// preferences that reorder items already loaded. None of them changes what the
// daemon returns or what is stored.

export type ViewModeFlow = {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  libraryLayout: LibraryLayout;
  changeLibraryLayout: (next: LibraryLayout) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  changeSortField: (next: SortField) => void;
  toggleSortDirection: () => void;
  // Search results arrive in relevance order and carry no logical size, so the
  // sort control is disabled there instead of silently reordering the hits.
  sortAvailable: boolean;
};

export function useViewMode(): ViewModeFlow {
  const [viewMode, setViewMode] = useState<ViewMode>("content");
  // The pane container owns desktop sizing; below this width the workspace
  // falls back to a single stacked column (mobile is deferred).
  const [libraryLayout, setLibraryLayout] = useState<LibraryLayout>(() => (window.localStorage.getItem("restoreweave.library_layout") === "list" ? "list" : "grid"));
  // The sort choice is a browser preference: it reorders items that are already
  // loaded and never changes what the daemon returns. It persists across
  // navigation in this session (and across reloads) without touching the
  // separate grid/list switch.
  const [sortField, setSortField] = useState<SortField>(() => {
    const stored = window.localStorage.getItem("restoreweave.library_sort_field");
    return stored === "size" || stored === "type" || stored === "path" ? stored : "name";
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => (window.localStorage.getItem("restoreweave.library_sort_direction") === "desc" ? "desc" : "asc"));

  useEffect(() => {
    window.localStorage.setItem("restoreweave.library_sort_field", sortField);
    window.localStorage.setItem("restoreweave.library_sort_direction", sortDirection);
  }, [sortDirection, sortField]);

  function changeLibraryLayout(next: LibraryLayout) {
    setLibraryLayout(next);
    window.localStorage.setItem("restoreweave.library_layout", next);
  }
  function changeSortField(next: SortField) { setSortField(next); }
  function toggleSortDirection() { setSortDirection((current) => current === "asc" ? "desc" : "asc"); }

  return {
    viewMode,
    setViewMode,
    libraryLayout,
    changeLibraryLayout,
    sortField,
    sortDirection,
    changeSortField,
    toggleSortDirection,
    sortAvailable: viewMode !== "search",
  };
}
