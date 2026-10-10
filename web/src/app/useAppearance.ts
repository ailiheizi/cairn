import { useCallback, useEffect, useState } from "react";
import {
  applyAppearancePreference,
  bootstrapAppearance,
  DEFAULT_APPEARANCE,
  normalizeAppearancePreference,
  readAppearancePreference,
  resetAppearancePreference,
  writeAppearancePreference,
} from "../lib/appearance";
import type { AppearancePreference } from "../lib/appearance";

function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function useAppearance() {
  const [preference, setPreference] = useState<AppearancePreference>(() => readAppearancePreference());

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => applyAppearancePreference(root, preference, prefersDark());
    apply();

    if (preference.appearance !== "system") return;

    let media: MediaQueryList | undefined;
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", apply);
    } catch {
      media = undefined;
    }
    return () => media?.removeEventListener("change", apply);
  }, [preference]);

  const updatePreference = useCallback((next: AppearancePreference) => {
    const normalized = normalizeAppearancePreference(next);
    writeAppearancePreference(normalized);
    applyAppearancePreference(document.documentElement, normalized, prefersDark());
    setPreference(normalized);
  }, []);

  const resetPreference = useCallback(() => {
    resetAppearancePreference();
    const defaultPreference = { ...DEFAULT_APPEARANCE };
    applyAppearancePreference(document.documentElement, defaultPreference, prefersDark());
    setPreference(defaultPreference);
  }, []);

  return { preference, updatePreference, resetPreference };
}

// Root may call this synchronously before createRoot() to prevent a palette
// flash. Keep it re-exported from the app hook for a single wiring import.
export { bootstrapAppearance };
