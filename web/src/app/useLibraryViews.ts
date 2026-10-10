import { useCallback, useMemo, useState } from "react";
import { allLibraryViewIds, type LibraryViewId } from "../lib/libraryViews";

const storageKey = "restoreweave.library-view-preferences.v1";

function readEnabledViewIds(): ReadonlySet<LibraryViewId> {
  if (typeof window === "undefined") return allLibraryViewIds;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return allLibraryViewIds;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !Array.isArray((value as { disabledViewIds?: unknown }).disabledViewIds)) return allLibraryViewIds;
    const disabled = new Set((value as { disabledViewIds: unknown[] }).disabledViewIds.filter((id): id is LibraryViewId =>
      typeof id === "string" && allLibraryViewIds.has(id as LibraryViewId),
    ));
    return new Set([...allLibraryViewIds].filter((id) => !disabled.has(id)));
  } catch {
    return allLibraryViewIds;
  }
}

export function useLibraryViews() {
  const [enabledViewIds, setEnabledViewIds] = useState<ReadonlySet<LibraryViewId>>(readEnabledViewIds);

  const setEnabled = useCallback((id: LibraryViewId, enabled: boolean) => {
    setEnabledViewIds((current) => {
      const next = new Set(current);
      if (enabled) next.add(id);
      else next.delete(id);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ disabledViewIds: [...allLibraryViewIds].filter((viewId) => !next.has(viewId)) }));
      } catch {
        // The preference remains active for this page even when browser storage is unavailable.
      }
      return next;
    });
  }, []);

  const enabledLibraryViewIds = useMemo(() => enabledViewIds, [enabledViewIds]);
  return { enabledViewIds: enabledLibraryViewIds, setEnabled };
}
