// Presentation packages: themes as pure data (ADR-032, Stage 2a).
//
// WHAT A PACKAGE IS
// A presentation package is one JSON document of design tokens. It contains no
// JavaScript, no components, no CSS text and no executable content of any kind,
// so the running application never executes third-party code. It can only
// restate values for design tokens that `web/src/styles/tokens.css` already
// declares; the package id is a *data* id, never a code entry point. Interface
// shells shipped as code are Stage 2b and are not this file.
//
// MANIFEST SHAPE — `cairn.presentation-package.v1`
//
//   {
//     "schema": "cairn.presentation-package.v1",
//     "id": "community:aurora",                  // built-in ids are reserved
//     "name": "Aurora",                          // shown in the palette picker
//     "hostRange": ">=0.1.0-prealpha.1 <0.2.0",  // semver comparator list
//     "swatches": ["#0b1020", "#7aa2f7", "#e6edf3"],
//     "tokens": { "--canvas": "#0b1020", "--ink": "#e6edf3" }
//   }
//
// `tokens` is either that flat value set — one set applied under every
// appearance, the declaration Stage 2a shipped — or one complete value set per
// effective appearance, which is the capability a built-in palette already has:
//
//   "tokens": {
//     "light": { "--canvas": "#f4f8ff", "--ink": "#0f2b46" },
//     "dark":  { "--canvas": "#0b1020", "--ink": "#e6edf3" }
//   }
//
// The two forms are exclusive, because a flat token name beside `light`/`dark`
// would make one field mean two things, and both appearances must be declared:
// a half-declared theme would keep claiming the theme id while leaving the other
// appearance on the built-in palette. Every value set passes the identical
// allowlist and forbidden-value rules through one code path, and the *effective*
// appearance selects the set, so a stored preference of `system` behaves exactly
// like the explicit appearance it resolves to.
//
// Every field is required. An unknown field is refused rather than ignored: a
// document that declares `"css"`, `"script"` or `"components"` must be refused
// whole, never admitted with the executable-looking part silently dropped. An
// unknown key inside a value set is refused the same way, by name.
//
// WHERE PACKAGES COME FROM
// The source of truth is the source tree, not the served output:
//
//   web/public/presentation-packages/index.json
//     { "schema": "cairn.presentation-package-index.v1",
//       "packages": ["inkstone-indigo.json"] }
//   web/public/presentation-packages/<id>.json
//
// `web/public/` is Vite's public directory, so every build copies it verbatim
// into the served root (`web/dist/presentation-packages/`) and the operator's
// packages survive a client rebuild. `web/vite.config.ts` admits every package
// in that source directory during the build and refuses the build when one
// fails, so a bad package cannot ship.
//
// The client still reads packages from the *served* root:
//
//   <web root>/presentation-packages/index.json
//   <web root>/presentation-packages/aurora.json
//
// The index lists plain file names in its own directory. A name that is not a
// plain `*.json` name is refused, so an index cannot point the client at another
// origin, another route or a parent directory. The documents are fetched at
// runtime as *data* — a file dropped straight into the served root is still
// admitted or refused here, which is the defence in depth behind the build
// check. An absent index is normal — the built-in palettes stay in charge — and
// produces no refusal, so nothing spams the interface when no package is
// installed.
//
// ADMISSION IS PURE
// `admitPresentationPackage` is a pure function over the decoded document plus
// the application version and the ids already in use: same input, same verdict,
// no I/O, no globals, no side effects. It returns either a whole admitted
// package or one refusal carrying a stable reason code. There is no partial
// admission: one bad token refuses the whole document, and a refused document
// contributes nothing.
//
// THE ALLOWLIST IS THE SECURITY BOUNDARY
// Only keys that are exactly one of the design tokens declared in
// `tokens.css` are admitted, and a value is refused when it contains a
// character or substring that could escape a CSS declaration or fetch
// something (`;`, `{`, `}`, `@`, `url(`, `expression(`, `image-set(`, quotes,
// backslashes, control characters, `/*`, `!important`). This is exactly why a
// package cannot position an overlay, load a remote resource, or open network
// access: it can only supply a value for a token the host already consumes, and
// the host writes that value with `style.setProperty` — a property assignment,
// never a declaration or stylesheet that the value could terminate or extend.
// The application version is injected at build time (`web/vite.config.ts`), so
// admission never reads `package.json` at runtime.

import { BUILT_IN_THEME_IDS } from "./appearance";
import type { PresentationTokens } from "./appearance";

export const PRESENTATION_PACKAGE_SCHEMA = "cairn.presentation-package.v1";
export const PRESENTATION_PACKAGE_INDEX_SCHEMA = "cairn.presentation-package-index.v1";
/** Document path, relative to the served web root and to the document base. */
export const PRESENTATION_PACKAGE_INDEX_PATH = "presentation-packages/index.json";

// The design tokens a package may restate: every custom property declared by
// the `:root` block of `web/src/styles/tokens.css` (42 names). `--tile-size` is
// deliberately absent: it is declared inside two component stylesheets as a
// locally scoped layout variable, so an inline root property could not change
// it even if it were admitted. Anything not listed here is refused by name.
export const PRESENTATION_TOKEN_ALLOWLIST: readonly string[] = Object.freeze([
  "--accent",
  "--accent-soft",
  "--blue",
  "--canvas",
  "--card-fill",
  "--card-fill-quiet",
  "--card-radius",
  "--card-radius-sm",
  "--card-shadow",
  "--card-shadow-soft",
  "--coral",
  "--floating-surface",
  "--glass",
  "--gold",
  "--hairline",
  "--hairline-strong",
  "--health",
  "--health-soft",
  "--ink",
  "--line",
  "--line-strong",
  "--muted",
  "--on-primary-container",
  "--overlay",
  "--page-gutter",
  "--primary",
  "--primary-container",
  "--primary-deep",
  "--primary-ink",
  "--primary-soft",
  "--quiet",
  "--rail",
  "--shadow",
  "--shadow-soft",
  "--surface",
  "--surface-container",
  "--surface-container-high",
  "--surface-container-highest",
  "--surface-container-low",
  "--surface-dim",
  "--surface-raised",
  "--surface-soft",
]);

const allowedTokenNames = new Set(PRESENTATION_TOKEN_ALLOWLIST);

// The two appearance keys a per-appearance value-set declaration may name.
// Every admitted design token starts with `--`, so neither name can collide
// with one.
const PRESENTATION_APPEARANCE_KEYS = ["light", "dark"] as const;

/** A built-in palette id or a namespaced package id such as `community:aurora`. */
const PACKAGE_ID_PATTERN = /^[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9._-]*)?$/;
/** An index entry: a plain JSON file name in the index's own directory. */
const PACKAGE_FILE_PATTERN = /^[a-z0-9][a-z0-9._-]*\.json$/i;

const MAX_NAME_LENGTH = 80;
const MAX_TOKEN_VALUE_LENGTH = 200;
const MAX_SWATCH_LENGTH = 40;
const MAX_SWATCHES = 4;
const MAX_DETAIL_LENGTH = 80;

// Characters that could terminate or extend a CSS declaration, and substrings
// that could fetch a resource or carry an expression. Quotes are refused too:
// they are the only way to spell a string URL without `url(`, and no admitted
// design token needs them.
const FORBIDDEN_VALUE_CHARACTERS = /[\\;{}@"'\u0000-\u001f\u007f]/;
const FORBIDDEN_VALUE_SUBSTRINGS = ["url(", "expression(", "image-set(", "javascript:", "/*", "*/", "!important"];

export type PresentationPackage = {
  readonly schema: typeof PRESENTATION_PACKAGE_SCHEMA;
  readonly id: string;
  readonly name: string;
  readonly hostRange: string;
  readonly swatches: readonly string[];
  /**
   * Either one flat value set applied under every appearance (the original
   * declaration, preserved exactly) or one value set per effective appearance.
   * Both forms are the same admitted shape; only the host's apply step chooses.
   */
  readonly tokens: PresentationTokens;
  /** The index file name this package was read from, or "" for a direct call. */
  readonly source: string;
};

export type PresentationRefusalCode =
  | "index-schema"
  | "index-entry"
  | "schema"
  | "manifest"
  | "id"
  | "collision"
  | "host-range"
  | "host-range-syntax"
  | "token-key"
  | "token-value"
  | "read";

/** A refusal always names its source and carries a stable, translatable code. */
export type PresentationPackageRefusal = {
  readonly code: PresentationRefusalCode;
  readonly source: string;
  readonly id: string;
  readonly detail: string;
};

export type PresentationAdmission =
  | { readonly admitted: true; readonly package: PresentationPackage }
  | { readonly admitted: false; readonly refusal: PresentationPackageRefusal };

export type PresentationPackageState = {
  readonly admitted: readonly PresentationPackage[];
  readonly refusals: readonly PresentationPackageRefusal[];
  readonly loaded: boolean;
};

export type PresentationAdmissionOptions = {
  /** The running application version, injected at build time. */
  readonly appVersion: string;
  /** Ids that may never be reused: the built-in palettes. */
  readonly builtInThemeIds: readonly string[];
  /** Ids already admitted in this load; a second claim is a collision. */
  readonly admittedIds?: readonly string[];
  readonly source?: string;
};

/** Injected by `web/vite.config.ts`. Guarded so a non-injected import is inert
 *  rather than a ReferenceError; an unversioned host then refuses packages
 *  loudly by host range instead of admitting them blindly. */
declare const __CAIRN_APP_VERSION__: string;
export const PRESENTATION_APP_VERSION: string = typeof __CAIRN_APP_VERSION__ === "string" ? __CAIRN_APP_VERSION__ : "0.0.0";

type SemanticVersion = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (string | number)[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refusal(
  code: PresentationRefusalCode,
  source: string,
  id: string,
  detail: string,
): PresentationAdmission {
  return { admitted: false, refusal: { code, source, id, detail: truncateDetail(detail) } };
}

function truncateDetail(detail: string): string {
  // A refusal reason is shown as text; control characters would render as
  // invisible noise, so they are replaced before the value reaches the UI.
  const cleaned = detail.replace(/[\u0000-\u001f\u007f]/g, "?");
  return cleaned.length > MAX_DETAIL_LENGTH ? `${cleaned.slice(0, MAX_DETAIL_LENGTH - 1)}…` : cleaned;
}

/** The offending fragment of a value, or undefined when the value is admitted. */
export function forbiddenTokenValueFragment(value: string): string | undefined {
  if (value.length === 0) return "empty value";
  if (value.length > MAX_TOKEN_VALUE_LENGTH) return `longer than ${MAX_TOKEN_VALUE_LENGTH} characters`;
  const character = FORBIDDEN_VALUE_CHARACTERS.exec(value);
  if (character) return character[0];
  const lowered = value.toLowerCase();
  for (const fragment of FORBIDDEN_VALUE_SUBSTRINGS) {
    if (lowered.includes(fragment)) return fragment;
  }
  return undefined;
}

type TokenValueSetAdmission =
  | { readonly admitted: true; readonly values: Record<string, string> }
  | { readonly admitted: false; readonly refusal: PresentationPackageRefusal };

/**
 * One value set, checked by the one rule: every key must be an admitted design
 * token and every value must pass the forbidden-value rule. `where` names the
 * appearance a set belongs to, so a refusal inside a per-appearance
 * declaration says which set it came from. A flat set passes `""`.
 */
function admitTokenValueSet(
  value: Record<string, unknown>,
  source: string,
  id: string,
  where: string,
): TokenValueSetAdmission {
  const values: Record<string, string> = {};
  const prefix = where === "" ? "" : `${where}: `;
  for (const [name, tokenValue] of Object.entries(value)) {
    if (!allowedTokenNames.has(name)) {
      return { admitted: false, refusal: { code: "token-key", source, id, detail: truncateDetail(`${prefix}${name}`) } };
    }
    if (typeof tokenValue !== "string") {
      return { admitted: false, refusal: { code: "token-value", source, id, detail: truncateDetail(`${prefix}${name}`) } };
    }
    const fragment = forbiddenTokenValueFragment(tokenValue);
    if (fragment) {
      return { admitted: false, refusal: { code: "token-value", source, id, detail: truncateDetail(`${prefix}${name}: ${fragment}`) } };
    }
    values[name] = tokenValue;
  }
  return { admitted: true, values };
}

type TokensAdmission =
  | { readonly admitted: true; readonly tokens: PresentationTokens }
  | { readonly admitted: false; readonly refusal: PresentationPackageRefusal };

/**
 * The `tokens` field in either admitted form. Presence of `light` or `dark`
 * selects the per-appearance form; a flat value set is every other case, so a
 * document that never heard of the new form is admitted exactly as before. The
 * two forms never mix: a flat token name beside an appearance key would make one
 * field mean two things and is refused whole. The per-appearance form requires
 * both appearances, because a half-declared theme would keep claiming the theme
 * id while leaving the other appearance to the built-in palette.
 */
function admitTokenDeclaration(value: Record<string, unknown>, source: string, id: string): TokensAdmission {
  const declaredKeys = Object.keys(value);
  const declaresAppearances = declaredKeys.some((key) => (PRESENTATION_APPEARANCE_KEYS as readonly string[]).includes(key));
  if (!declaresAppearances) {
    const flat = admitTokenValueSet(value, source, id, "");
    if (!flat.admitted) return { admitted: false, refusal: flat.refusal };
    return { admitted: true, tokens: flat.values };
  }
  for (const key of declaredKeys) {
    if (!(PRESENTATION_APPEARANCE_KEYS as readonly string[]).includes(key)) {
      return {
        admitted: false,
        refusal: { code: "manifest", source, id, detail: truncateDetail(`tokens mixes value sets: ${key}`) },
      };
    }
  }
  const sets: Partial<Record<(typeof PRESENTATION_APPEARANCE_KEYS)[number], Record<string, string>>> = {};
  for (const appearance of PRESENTATION_APPEARANCE_KEYS) {
    const declaredSet = value[appearance];
    if (!isRecord(declaredSet) || Object.keys(declaredSet).length === 0) {
      return { admitted: false, refusal: { code: "manifest", source, id, detail: truncateDetail(`tokens.${appearance}`) } };
    }
    const admittedSet = admitTokenValueSet(declaredSet, source, id, appearance);
    if (!admittedSet.admitted) return { admitted: false, refusal: admittedSet.refusal };
    sets[appearance] = admittedSet.values;
  }
  return { admitted: true, tokens: { light: sets.light as Record<string, string>, dark: sets.dark as Record<string, string> } };
}

function parseSemanticVersion(value: string): SemanticVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (!match) return undefined;
  const prerelease = match[4] === undefined
    ? []
    : match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease };
}

function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
  for (const part of ["major", "minor", "patch"] as const) {
    if (left[part] !== right[part]) return left[part] < right[part] ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    if (a === b) continue;
    if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

/**
 * A local semver comparator list — no dependency, no range syntax beyond the
 * comparators a host range actually needs. Returns undefined when the range or
 * the version is not a range this host can reason about, which is a refusal.
 */
function hostRangeSatisfied(appVersion: string, range: string): boolean | undefined {
  const version = parseSemanticVersion(appVersion);
  if (!version) return undefined;
  const comparators = range.split(/[\s,]+/).filter(Boolean);
  if (comparators.length === 0) return undefined;
  for (const comparator of comparators) {
    const match = /^(>=|<=|>|<|=)?(.*)$/.exec(comparator);
    const bound = match && parseSemanticVersion(match[2]);
    if (!match || !bound) return undefined;
    const order = compareSemanticVersions(version, bound);
    switch (match[1] ?? "=") {
      case ">=": if (order < 0) return false; break;
      case ">": if (order <= 0) return false; break;
      case "<=": if (order > 0) return false; break;
      case "<": if (order >= 0) return false; break;
      default: if (order !== 0) return false; break;
    }
  }
  return true;
}

/**
 * The one admission decision. Pure: it reads only its arguments and returns
 * either the whole admitted package or one refusal. Validation order is
 * schema, id, collision, manifest fields, host range, swatches, tokens — so a
 * package that reuses a built-in id is reported as a collision even when it is
 * also wrong elsewhere.
 */
export function admitPresentationPackage(value: unknown, options: PresentationAdmissionOptions): PresentationAdmission {
  const source = options.source ?? "";
  if (!isRecord(value)) return refusal("manifest", source, "", "not a JSON object");
  const declaredId = typeof value.id === "string" ? value.id : "";

  if (value.schema !== PRESENTATION_PACKAGE_SCHEMA) {
    return refusal("schema", source, declaredId, typeof value.schema === "string" ? value.schema : "missing");
  }
  for (const key of Object.keys(value)) {
    if (!["schema", "id", "name", "hostRange", "swatches", "tokens"].includes(key)) {
      return refusal("manifest", source, declaredId, `unknown field ${key}`);
    }
  }
  if (typeof value.id !== "string" || !PACKAGE_ID_PATTERN.test(value.id)) {
    return refusal("id", source, declaredId, declaredId || "missing");
  }
  if (options.builtInThemeIds.includes(value.id) || (options.admittedIds ?? []).includes(value.id)) {
    return refusal("collision", source, value.id, value.id);
  }
  if (typeof value.name !== "string" || value.name.trim().length === 0 || value.name.length > MAX_NAME_LENGTH) {
    return refusal("manifest", source, value.id, "name");
  }
  if (typeof value.hostRange !== "string" || value.hostRange.trim().length === 0) {
    return refusal("manifest", source, value.id, "hostRange");
  }
  const satisfied = hostRangeSatisfied(options.appVersion, value.hostRange);
  if (satisfied === undefined) return refusal("host-range-syntax", source, value.id, value.hostRange);
  if (!satisfied) return refusal("host-range", source, value.id, value.hostRange);
  if (!Array.isArray(value.swatches) || value.swatches.length === 0 || value.swatches.length > MAX_SWATCHES) {
    return refusal("manifest", source, value.id, "swatches");
  }
  const swatches: string[] = [];
  for (const swatch of value.swatches) {
    if (typeof swatch !== "string" || swatch.length === 0 || swatch.length > MAX_SWATCH_LENGTH || forbiddenTokenValueFragment(swatch)) {
      return refusal("manifest", source, value.id, "swatches");
    }
    swatches.push(swatch);
  }
  if (!isRecord(value.tokens) || Object.keys(value.tokens).length === 0) {
    return refusal("manifest", source, value.id, "tokens");
  }
  // One code path decides both forms, so a per-appearance value set can never be
  // validated more loosely than the flat declaration it extends.
  const tokenDeclaration = admitTokenDeclaration(value.tokens, source, value.id);
  if (!tokenDeclaration.admitted) return { admitted: false, refusal: tokenDeclaration.refusal };
  return {
    admitted: true,
    package: {
      schema: PRESENTATION_PACKAGE_SCHEMA,
      id: value.id,
      name: value.name,
      hostRange: value.hostRange,
      swatches,
      tokens: tokenDeclaration.tokens,
      source,
    },
  };
}

/** The index document, validated into a list of plain file names. */
export function readPresentationPackageIndex(
  value: unknown,
  source = PRESENTATION_PACKAGE_INDEX_PATH,
): { readonly files: readonly string[]; readonly refusals: readonly PresentationPackageRefusal[] } {
  const refusals: PresentationPackageRefusal[] = [];
  const refuse = (code: PresentationRefusalCode, detail: string) => {
    refusals.push({ code, source, id: "", detail: truncateDetail(detail) });
  };
  if (!isRecord(value) || value.schema !== PRESENTATION_PACKAGE_INDEX_SCHEMA) {
    refuse("index-schema", isRecord(value) && typeof value.schema === "string" ? value.schema : "missing");
    return { files: [], refusals };
  }
  for (const key of Object.keys(value)) {
    if (key !== "schema" && key !== "packages") {
      refuse("index-schema", `unknown field ${key}`);
      return { files: [], refusals };
    }
  }
  if (!Array.isArray(value.packages)) {
    refuse("index-schema", "packages");
    return { files: [], refusals };
  }
  const files: string[] = [];
  for (const entry of value.packages) {
    if (typeof entry !== "string" || !PACKAGE_FILE_PATTERN.test(entry)) {
      refuse("index-entry", typeof entry === "string" ? entry : String(entry));
      continue;
    }
    files.push(entry);
  }
  return { files, refusals };
}

export type PresentationPackageLoadOptions = {
  readonly fetchImpl?: typeof fetch;
  readonly baseURI?: string;
  readonly appVersion?: string;
};

/**
 * Fetch and admit the installed packages. Only I/O is injected `fetch`; every
 * decision is `admitPresentationPackage`. An absent index (404, a host that
 * answers with its HTML shell, or a transport failure) is "nothing installed":
 * the built-in palettes stay in charge and no refusal is reported.
 */
export async function readPresentationPackages(options: PresentationPackageLoadOptions = {}): Promise<PresentationPackageState> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseURI = options.baseURI ?? (typeof document === "undefined" ? undefined : document.baseURI);
  const appVersion = options.appVersion ?? PRESENTATION_APP_VERSION;
  const empty: PresentationPackageState = { admitted: [], refusals: [], loaded: true };
  if (typeof fetchImpl !== "function" || !baseURI) return empty;
  const indexURL = new URL(PRESENTATION_PACKAGE_INDEX_PATH, baseURI);
  const indexDocument = await readJSONDocument(fetchImpl, indexURL);
  if (indexDocument.state !== "json") {
    // Absent is normal (nothing installed). A document the host did serve as
    // JSON that does not parse is a real misconfiguration and is reported.
    if (indexDocument.state === "invalid") {
      return {
        admitted: [],
        refusals: [{ code: "index-schema", source: PRESENTATION_PACKAGE_INDEX_PATH, id: "", detail: "not a JSON document" }],
        loaded: true,
      };
    }
    return empty;
  }
  const index = readPresentationPackageIndex(indexDocument.value, PRESENTATION_PACKAGE_INDEX_PATH);
  const refusals = [...index.refusals];
  const admitted: PresentationPackage[] = [];
  const admittedIds: string[] = [];
  for (const file of index.files) {
    const document = await readJSONDocument(fetchImpl, new URL(file, indexURL));
    if (document.state !== "json") {
      refusals.push({
        code: "read",
        source: file,
        id: "",
        detail: truncateDetail(document.state === "absent" ? "not served" : "not a JSON document"),
      });
      continue;
    }
    const result = admitPresentationPackage(document.value, {
      appVersion,
      builtInThemeIds: BUILT_IN_THEME_IDS,
      admittedIds,
      source: file,
    });
    if (result.admitted) {
      admitted.push(result.package);
      admittedIds.push(result.package.id);
    } else {
      refusals.push(result.refusal);
    }
  }
  return { admitted, refusals, loaded: true };
}

type JSONDocument = { readonly state: "json"; readonly value: unknown } | { readonly state: "absent" | "invalid" };

async function readJSONDocument(fetchImpl: typeof fetch, url: URL): Promise<JSONDocument> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" }, cache: "no-store" });
  } catch {
    return { state: "absent" };
  }
  if (!response.ok) return { state: "absent" };
  const contentType = response.headers.get("content-type") ?? "";
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { state: "absent" };
  }
  try {
    return { state: "json", value: JSON.parse(text) as unknown };
  } catch {
    // A host that answers a data path with its HTML shell has nothing installed
    // there; a JSON document that does not parse is a real, visible refusal.
    return { state: contentType.toLowerCase().includes("json") ? "invalid" : "absent" };
  }
}

// --- the one admission result the client holds -------------------------------

let packageState: PresentationPackageState = { admitted: [], refusals: [], loaded: false };
const packageListeners = new Set<() => void>();
let loadStarted = false;

export function getPresentationPackageState(): PresentationPackageState {
  return packageState;
}

export function subscribePresentationPackages(listener: () => void): () => void {
  packageListeners.add(listener);
  return () => { packageListeners.delete(listener); };
}

function commitPresentationPackageState(next: PresentationPackageState): void {
  packageState = next;
  for (const listener of [...packageListeners]) listener();
}

/** Start the one startup load. Idempotent, and never throws into the shell. */
export function startPresentationPackageLoad(options: PresentationPackageLoadOptions = {}): void {
  if (loadStarted) return;
  loadStarted = true;
  void readPresentationPackages(options)
    .then(commitPresentationPackageState)
    .catch(() => { commitPresentationPackageState({ admitted: [], refusals: [], loaded: true }); });
}
