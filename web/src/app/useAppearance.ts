import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import {
  getPresentationPackageState,
  startPresentationPackageLoad,
  subscribePresentationPackages,
} from "../lib/presentationPackages";

function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function useAppearance() {
  // Installed presentation packages are pure data (ADR-032, Stage 2a). They are
  // read exactly once, at startup, and the admitted set is the only thing the
  // appearance plane may use: a package that was refused contributes nothing.
  const packages = useSyncExternalStore(subscribePresentationPackages, getPresentationPackageState, getPresentationPackageState);
  const installedThemes = useMemo(
    () => packages.admitted.map((presentationPackage) => ({ id: presentationPackage.id, tokens: presentationPackage.tokens })),
    [packages],
  );
  const installedKey = installedThemes.map((theme) => theme.id).join("\u0000");

  const [preference, setPreference] = useState<AppearancePreference>(() => readAppearancePreference());

  useEffect(() => { startPresentationPackageLoad(); }, []);

  // Admission completes after the first paint. Re-read the stored preference
  // then: storage may hold an installed id that only became valid now, while
  // the first synchronous read could only resolve a built-in.
  const resolvedKey = useRef(installedKey);
  useEffect(() => {
    if (resolvedKey.current === installedKey) return;
    resolvedKey.current = installedKey;
    setPreference(readAppearancePreference(undefined, installedThemes.map((theme) => theme.id)));
  }, [installedKey, installedThemes]);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => applyAppearancePreference(root, preference, prefersDark(), installedThemes);
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
  }, [preference, installedThemes]);

  const installedThemeIds = useMemo(() => installedThemes.map((theme) => theme.id), [installedThemes]);

  const updatePreference = useCallback((next: AppearancePreference) => {
    const normalized = normalizeAppearancePreference(next, installedThemeIds);
    writeAppearancePreference(normalized, undefined, installedThemeIds);
    applyAppearancePreference(document.documentElement, normalized, prefersDark(), installedThemes);
    setPreference(normalized);
  }, [installedThemeIds, installedThemes]);

  const resetPreference = useCallback(() => {
    resetAppearancePreference();
    const defaultPreference = { ...DEFAULT_APPEARANCE };
    applyAppearancePreference(document.documentElement, defaultPreference, prefersDark(), installedThemes);
    setPreference(defaultPreference);
  }, [installedThemes]);

  return { preference, updatePreference, resetPreference };
}

// Root may call this synchronously before createRoot() to prevent a palette
// flash. Keep it re-exported from the app hook for a single wiring import.
export { bootstrapAppearance };
