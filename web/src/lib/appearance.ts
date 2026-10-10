import { normalizeInterfaceId } from "./interfaceCatalog";

export const APPEARANCE_STORAGE_KEY = "cairn.appearance";

export type AppearanceMode = "system" | "light" | "dark";
export type EffectiveAppearance = Exclude<AppearanceMode, "system">;

// The built-in palettes are compiled into `web/src/styles/tokens.css` and stay
// exactly what they are. An installed presentation package (ADR-032, Stage 2a)
// adds one more id at runtime; that id is only ever a value proven by
// `web/src/lib/presentationPackages.ts` admission, and the widened id below is
// re-validated against the admitted set by `normalizeAppearancePreference`.
export const BUILT_IN_THEME_IDS = ["slate", "paper", "indigo"] as const;
export type BuiltInThemeID = (typeof BUILT_IN_THEME_IDS)[number];
export type ThemeID = BuiltInThemeID | (string & {});
export type InterfaceId = string;

/**
 * An admitted theme package's tokens. The host writes them as inline custom
 * properties on the root element, which is why a package can restate a design
 * token and cannot introduce a rule, a selector, or a resource.
 */
export type InstalledThemeTokens = {
  id: string;
  tokens: Readonly<Record<string, string>>;
};

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
// `style` is optional so a caller without a CSSOM (and the existing unit
// harness, which passes only `setAttribute`) still applies attributes.
type RootElement = Pick<HTMLElement, "setAttribute"> & {
  style?: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBuiltInThemeId(value: unknown): value is BuiltInThemeID {
  return typeof value === "string" && (BUILT_IN_THEME_IDS as readonly string[]).includes(value);
}

/**
 * A stored theme id survives only when it is a built-in or an id the caller
 * proved by admission. Anything else — an old value, a hand-edited
 * localStorage entry, a package that is no longer installed — falls back to the
 * built-in default instead of reaching `data-theme`.
 */
function resolveThemeId(value: unknown, installedThemeIds?: readonly string[]): ThemeID {
  if (isBuiltInThemeId(value)) return value;
  if (typeof value === "string" && installedThemeIds?.includes(value)) return value;
  return DEFAULT_APPEARANCE.themeId;
}

export function normalizeAppearancePreference(value: unknown, installedThemeIds?: readonly string[]): AppearancePreference {
  if (!isRecord(value)) return { ...DEFAULT_APPEARANCE };
  const appearance: AppearanceMode = value.appearance === "light" || value.appearance === "dark"
    ? value.appearance
    : "system";
  const themeId = resolveThemeId(value.themeId, installedThemeIds);
  const interfaceId = normalizeInterfaceId(value.interfaceId);
  return { appearance, themeId, interfaceId };
}

export function resolveEffectiveAppearance(preference: AppearancePreference, systemPrefersDark: boolean): EffectiveAppearance {
  return preference.appearance === "system"
    ? (systemPrefersDark ? "dark" : "light")
    : preference.appearance;
}

export function readAppearancePreference(storage?: StorageLike, installedThemeIds?: readonly string[]): AppearancePreference {
  try {
    const availableStorage = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    const stored = availableStorage?.getItem(APPEARANCE_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_APPEARANCE };
    return normalizeAppearancePreference(JSON.parse(stored) as unknown, installedThemeIds);
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function writeAppearancePreference(preference: AppearancePreference, storage?: StorageLike, installedThemeIds?: readonly string[]): void {
  try {
    const availableStorage = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    availableStorage?.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalizeAppearancePreference(preference, installedThemeIds)));
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

// Custom properties an installed package wrote on the last apply. A built-in
// palette has none, so they are removed before the compiled `[data-theme]`
// blocks take over again — otherwise a stale override would outlive the
// selection of the package that declared it.
let appliedInstalledTokens: string[] = [];

function applyInstalledThemeTokens(root: RootElement, tokens?: Readonly<Record<string, string>>): void {
  if (!root.style) return;
  for (const name of appliedInstalledTokens) root.style.removeProperty(name);
  appliedInstalledTokens = [];
  if (!tokens) return;
  // `setProperty` is a property assignment, never a declaration the value could
  // terminate; admission has already refused any value that could try.
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value);
    appliedInstalledTokens.push(name);
  }
}

export function applyAppearancePreference(
  root: RootElement,
  preference: AppearancePreference,
  systemPrefersDark: boolean,
  installedThemes: readonly InstalledThemeTokens[] = [],
): EffectiveAppearance {
  const normalized = normalizeAppearancePreference(preference, installedThemes.map((theme) => theme.id));
  const effective = resolveEffectiveAppearance(normalized, systemPrefersDark);
  root.setAttribute("data-theme", normalized.themeId);
  root.setAttribute("data-appearance", effective);
  root.setAttribute("data-interface", normalized.interfaceId);
  applyInstalledThemeTokens(root, installedThemes.find((theme) => theme.id === normalized.themeId)?.tokens);
  return effective;
}

function systemPrefersDark(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/**
 * Apply stored preference synchronously before React mounts to avoid a flash.
 *
 * Installed packages are asynchronous data, so at this point no package is
 * admitted yet: a stored installed id resolves to the built-in default here and
 * is applied for real by `useAppearance` as soon as admission completes. That
 * one step is visible only when a package is installed and selected.
 */
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
