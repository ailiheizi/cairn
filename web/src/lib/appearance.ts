import { normalizeInterfaceId } from "./interfaceCatalog";

export const APPEARANCE_STORAGE_KEY = "restoreweave.appearance";

export type AppearanceMode = "system" | "light" | "dark";
export type EffectiveAppearance = Exclude<AppearanceMode, "system">;
export type ThemeID = "slate" | "paper" | "indigo";
export type InterfaceId = string;

export type AppearancePreference = {
  appearance: AppearanceMode;
  themeId: ThemeID;
  interfaceId: InterfaceId;
};

export const DEFAULT_APPEARANCE: AppearancePreference = {
  appearance: "system",
  themeId: "slate",
  interfaceId: "workspace",
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type RootElement = Pick<HTMLElement, "setAttribute">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeAppearancePreference(value: unknown): AppearancePreference {
  if (!isRecord(value)) return { ...DEFAULT_APPEARANCE };
  const appearance: AppearanceMode = value.appearance === "light" || value.appearance === "dark"
    ? value.appearance
    : "system";
  const themeId: ThemeID = value.themeId === "paper" || value.themeId === "indigo"
    ? value.themeId
    : "slate";
  const interfaceId = normalizeInterfaceId(value.interfaceId);
  return { appearance, themeId, interfaceId };
}

export function resolveEffectiveAppearance(preference: AppearancePreference, systemPrefersDark: boolean): EffectiveAppearance {
  return preference.appearance === "system"
    ? (systemPrefersDark ? "dark" : "light")
    : preference.appearance;
}

export function readAppearancePreference(storage?: StorageLike): AppearancePreference {
  try {
    const availableStorage = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    const stored = availableStorage?.getItem(APPEARANCE_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_APPEARANCE };
    return normalizeAppearancePreference(JSON.parse(stored) as unknown);
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function writeAppearancePreference(preference: AppearancePreference, storage?: StorageLike): void {
  try {
    const availableStorage = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    availableStorage?.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalizeAppearancePreference(preference)));
  } catch {
    // Browser presentation remains usable when storage is unavailable.
  }
}

export function resetAppearancePreference(storage?: StorageLike): void {
  try {
    const availableStorage = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    availableStorage?.removeItem(APPEARANCE_STORAGE_KEY);
  } catch {
    // Reset still applies the in-memory built-in default.
  }
}

export function applyAppearancePreference(
  root: RootElement,
  preference: AppearancePreference,
  systemPrefersDark: boolean,
): EffectiveAppearance {
  const normalized = normalizeAppearancePreference(preference);
  const effective = resolveEffectiveAppearance(normalized, systemPrefersDark);
  root.setAttribute("data-theme", normalized.themeId);
  root.setAttribute("data-appearance", effective);
  root.setAttribute("data-interface", normalized.interfaceId);
  return effective;
}

function systemPrefersDark(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/** Apply stored preference synchronously before React mounts to avoid a flash. */
export function bootstrapAppearance(
  root?: RootElement,
  storage?: StorageLike,
  prefersDark = systemPrefersDark(),
): AppearancePreference {
  const preference = readAppearancePreference(storage);
  const target = root ?? (typeof document === "undefined" ? undefined : document.documentElement);
  if (target) applyAppearancePreference(target, preference, prefersDark);
  return preference;
}
