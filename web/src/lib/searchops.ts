// Search operators and their visible predicates.
//
// Pure grammar and planning for the one search field. The field text is the
// source of truth; this module is a deterministic projection of it: tokenize,
// classify, and plan the exact `search.query` input. No React, no daemon call,
// no browser storage, no durable state.
//
// Every operator maps onto an input `search.query` already accepts:
//   - `filters.entry_type` / `filters.media_class` / `filters.size_min` /
//     `filters.size_max` / `filters.mtime_after` / `filters.mtime_before` /
//     `filters.content_id` / `filters.duplicate_group`, and
//   - the lexical text plus `construct_axes` (the daemon's own lexical field
//     selector: `tags`, `path`, `name`, `duplicates`, ...).
// Nothing here invents a wire field. An operator the daemon cannot express is
// reported as an error and never becomes a silently different query.

/** The operator vocabulary of the one search field. */
export const SEARCH_OPERATOR_NAMES = ["tag", "type", "size", "mtime", "dup", "path", "name", "hash"] as const;
export type SearchOperatorName = (typeof SEARCH_OPERATOR_NAMES)[number];

export type SearchOperatorInfo = {
  name: SearchOperatorName;
  /** The English one-line description; the surface renders it through `t()`. */
  description: string;
  /** The value shape shown in the autocomplete row; never translated. */
  valueHint: string;
  /** The honest limit of the mapping, or "" when the mapping is exact. */
  limitation: string;
};

// The daemon's entry-type vocabulary (`server/internal/store/sqlite/types.go`).
// `type:` maps a filesystem class onto `filters.entry_type`, which compares one
// exact entry type.
const ENTRY_TYPE_ALIASES: Record<string, string> = {
  file: "REGULAR_FILE", files: "REGULAR_FILE", regular_file: "REGULAR_FILE", regularfile: "REGULAR_FILE",
  directory: "DIRECTORY", directories: "DIRECTORY", dir: "DIRECTORY", folder: "DIRECTORY",
  symlink: "SYMLINK", link: "SYMLINK",
  fifo: "FIFO", pipe: "FIFO",
  socket: "SOCKET", device: "DEVICE", special: "SPECIAL",
};

// The daemon's derived media-class vocabulary. The one definitions table is
// `server/internal/search/media_class.go`; a media class is a rebuildable
// projection over the entry's recorded filename suffix, not identity and not a
// durable fact. `type:image` and its siblings therefore map onto
// `filters.media_class` — never onto a value the daemon never records and
// never onto a guess from a name, a path, or a size. `other` is the recorded
// suffix the daemon's table does not classify; an entry whose suffix is not
// recorded matches no class at all, including `other`.
const MEDIA_CLASS_VALUES = ["image", "video", "audio", "document", "archive", "other"] as const;

// The daemon's lexical axes this surface scopes a predicate to. `tags`, `path`,
// `name`, and `duplicates` are the rebuildable text fields of the bundled FTS5
// generation, and `construct_axes` is the daemon input that selects them.
const SEARCH_AXIS_TAGS = "tags";
const SEARCH_AXIS_PATH = "path";
const SEARCH_AXIS_NAME = "name";
const SEARCH_AXIS_DUPLICATES = "duplicates";

export const SEARCH_OPERATORS: SearchOperatorInfo[] = [
  { name: "tag", description: "Durable tag on the subject. Repeat it to require several tags.", valueHint: "tag:reviewed", limitation: "Matched as a token prefix in the daemon's tag field, not as an exact tag string." },
  { name: "type", description: "The daemon's entry type (regular_file, directory, symlink, fifo, socket, device, special) or its derived media class (image, video, audio, document, archive, other).", valueHint: "type:image", limitation: "Entry types are compared exactly. A media class is derived from the entry's recorded filename suffix only — never from its content, name, path, or size — and one entry maps to one class: an entry whose suffix is not recorded matches no media class, including other." },
  { name: "size", description: "Logical size in bytes, KB, MB, GB, or TB. Use >10MB, <1GB, 1MB..10MB, or one exact value.", valueHint: "size:>10MB", limitation: "Items without a measured logical size never match a size range." },
  { name: "mtime", description: "Recorded modification time, as an exclusive < or > bound on a YYYY-MM-DD date.", valueHint: "mtime:<2024-01-01", limitation: "Exclusive: mtime:<2024-01-01 excludes that exact instant." },
  { name: "dup", description: "Exact-identity duplicates (dup:yes) or unique content (dup:no).", valueHint: "dup:yes", limitation: "The daemon records a duplicate projection but no unique-only filter, so dup:no is evaluated over loaded results." },
  { name: "path", description: "Recorded source path. Substring is matched as lexical tokens.", valueHint: "path:research", limitation: "Token and phrase matching, not an arbitrary substring match." },
  { name: "name", description: "Displayed file or folder name.", valueHint: "name:report", limitation: "Token and phrase matching, not an arbitrary substring match." },
  { name: "hash", description: "Recorded content id (SHA-256). A complete id filters exactly; a shorter value is a prefix.", valueHint: "hash:9f2c", limitation: "A prefix is matched over the hits the daemon returned, and only where a content id was recorded." },
];

const OPERATOR_BY_NAME = new Map<string, SearchOperatorInfo>(SEARCH_OPERATORS.map((operator) => [operator.name, operator]));

/** The declared metadata of one operator, for the chip and the autocomplete. */
export function searchOperatorInfo(name: SearchOperatorName): SearchOperatorInfo {
  return OPERATOR_BY_NAME.get(name)!;
}

/** The short name of the daemon input each operator writes, shown on the chip. */
export const SEARCH_OPERATOR_WIRE: Record<SearchOperatorName, string> = {
  tag: "tags", type: "entry_type", size: "size_min/size_max", mtime: "mtime_after/mtime_before",
  dup: "duplicates", path: "path", name: "name", hash: "content_id",
};

/** The badge a chip shows for the daemon input its predicate really writes. */
export function predicateWireLabel(predicate: SearchPredicate, plan: SearchPlan): string {
  if (predicate.overLoadedResults) return "loaded results";
  if (predicate.operator === "tag" || predicate.operator === "path" || predicate.operator === "name") return plan.axesRestricted ? predicate.axis : "any field";
  if (predicate.operator === "dup") return plan.axesRestricted ? SEARCH_AXIS_DUPLICATES : "loaded results";
  // `type:` writes one of two daemon inputs depending on the value: a
  // filesystem entry type or the derived media class.
  if (predicate.operator === "type" && predicate.mediaClass) return "media_class";
  return SEARCH_OPERATOR_WIRE[predicate.operator];
}

export type SearchPredicate = {
  operator: SearchOperatorName;
  negated: boolean;
  /** The token exactly as typed, including any quotes. */
  raw: string;
  /** The value exactly as typed, including any quotes. */
  valueRaw: string;
  /** The unquoted value. */
  value: string;
  start: number;
  end: number;
  /** The lexical axis this predicate scopes, or "" when it writes a typed filter. */
  axis: string;
  /**
   * The derived media class this predicate writes to `filters.media_class`, or
   * "" when `type:` writes an entry type to `filters.entry_type` instead.
   */
  mediaClass: string;
  /** True when this predicate can only be evaluated over the returned hits. */
  overLoadedResults: boolean;
};

export type SearchParseError = {
  /** The token that failed. */
  raw: string;
  /** An English source string; the surface renders it through `t()`. */
  message: string;
  /** The placeholder values the message expects. */
  values: Record<string, string>;
};

export type ParsedSearchQuery = {
  source: string;
  predicates: SearchPredicate[];
  /** The tokens that stay free text, exactly as typed. */
  freeTokens: string[];
  freeText: string;
  errors: SearchParseError[];
};

export type SearchFilters = {
  entry_type?: string;
  media_class?: string;
  content_id?: string;
  duplicate_group?: string;
  size_min?: number;
  size_max?: number;
  mtime_after?: number;
  mtime_before?: number;
};

export type SearchRequestPlan = {
  /** The lexical text `search.query` receives. Empty when only filters apply. */
  query: string;
  filters: SearchFilters;
  /** Sent only when every lexical token is scoped to a named field. */
  construct_axes?: string[];
};

export type SearchPlan = {
  request: SearchRequestPlan;
  /** The lexical axes the predicates name, in vocabulary order. */
  scopedAxes: string[];
  /** True when `construct_axes` is part of the request. */
  axesRestricted: boolean;
  /** True when free text is present and the daemon will match every token against every field. */
  axesWidened: boolean;
  /** Predicates this browser evaluates over the returned hits. */
  overLoadedResults: SearchPredicate[];
  /** Translation keys for the honest limits this plan carries. */
  limits: string[];
  /**
   * Set when the daemon would receive neither lexical text nor a typed filter,
   * which is the one request `search.query` refuses. A client-side predicate
   * cannot be evaluated without a query to narrow, so this is an error rather
   * than an empty request.
   */
  requestError: string;
};

const SIZE_UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };

// The field text is split into whitespace-separated tokens; a double-quoted or
// single-quoted run keeps its spaces inside one token. Quoting is the escape
// hatch: a quoted token is always free text and is never read as an operator.
export function tokenizeSearchText(source: string): Array<{ raw: string; start: number; end: number; quoted: boolean }> {
  const tokens: Array<{ raw: string; start: number; end: number; quoted: boolean }> = [];
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) { index += 1; continue; }
    const start = index;
    let quoted = false;
    while (index < source.length && !/\s/.test(source[index])) {
      const character = source[index];
      if (character === '"' || character === "'") {
        quoted = true;
        const close = source.indexOf(character, index + 1);
        index = close < 0 ? source.length : close + 1;
        continue;
      }
      index += 1;
    }
    tokens.push({ raw: source.slice(start, index), start, end: index, quoted });
  }
  return tokens;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    if ((first === '"' || first === "'") && trimmed[trimmed.length - 1] === first) return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitToken(raw: string): { name: string; value: string } | null {
  let inQuote = "";
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (inQuote) { if (character === inQuote) inQuote = ""; continue; }
    if (character === '"' || character === "'") { inQuote = character; continue; }
    if (character === ":") return { name: raw.slice(0, index).toLowerCase(), value: raw.slice(index + 1) };
  }
  return null;
}

function parseSize(value: string): { min?: number; max?: number; error?: string } {
  const text = value.trim().toLowerCase();
  const bytes = (token: string): number | null => {
    const match = /^([0-9]+(?:\.[0-9]+)?)\s*(b|kb|mb|gb|tb)?$/.exec(token.trim());
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = SIZE_UNITS[match[2] ?? "b"];
    if (!Number.isFinite(amount) || amount < 0) return null;
    const result = Math.round(amount * unit);
    return Number.isSafeInteger(result) ? result : null;
  };
  if (text.startsWith(">")) {
    const bound = bytes(text.slice(1));
    return bound === null ? { error: "size:{{value}} is not a size. Use >10MB, <1GB, 1MB..10MB, or one exact value." } : { min: bound };
  }
  if (text.startsWith("<")) {
    const bound = bytes(text.slice(1));
    return bound === null ? { error: "size:{{value}} is not a size. Use >10MB, <1GB, 1MB..10MB, or one exact value." } : { max: bound };
  }
  if (text.includes("..")) {
    const [lower, upper] = text.split("..", 2);
    const min = bytes(lower);
    const max = bytes(upper);
    if (min === null || max === null) return { error: "size:{{value}} is not a size. Use >10MB, <1GB, 1MB..10MB, or one exact value." };
    if (min > max) return { error: "size:{{value}} starts after it ends." };
    return { min, max };
  }
  const exact = bytes(text);
  return exact === null ? { error: "size:{{value}} is not a size. Use >10MB, <1GB, 1MB..10MB, or one exact value." } : { min: exact, max: exact };
}

// A date is read as UTC midnight, the same instant the daemon's millisecond
// facets are compared against. Only a complete YYYY-MM-DD is accepted.
export function parseSearchDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const millis = Date.UTC(year, month - 1, day);
  const date = new Date(millis);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return millis;
}

export function normalizeContentID(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("sha256:") ? trimmed.slice("sha256:".length) : trimmed;
}

export function isCompleteContentID(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(normalizeContentID(value));
}

export function isContentIDPrefix(value: string): boolean {
  return /^[0-9a-f]{1,64}$/.test(normalizeContentID(value));
}

/** True when a hit's recorded content id starts with the given value. */
export function contentIDMatchesPrefix(contentID: string | undefined, value: string): boolean {
  const recorded = normalizeContentID(contentID ?? "");
  return Boolean(recorded) && recorded.startsWith(normalizeContentID(value));
}

export function parseSearchQuery(source: string): ParsedSearchQuery {
  const predicates: SearchPredicate[] = [];
  const freeTokens: string[] = [];
  const errors: SearchParseError[] = [];
  for (const token of tokenizeSearchText(source)) {
    if (token.quoted && !token.raw.startsWith("-") && !splitToken(token.raw)) { freeTokens.push(token.raw); continue; }
    const negated = token.raw.startsWith("-") && token.raw.length > 1;
    const body = negated ? token.raw.slice(1) : token.raw;
    const parts = splitToken(body);
    if (!parts) { freeTokens.push(token.raw); continue; }
    const operator = OPERATOR_BY_NAME.get(parts.name);
    if (!operator) {
      // A quoted token is free text; an unquoted `word:value` looks like an
      // operator attempt and is reported instead of silently searching for it.
      const looksLikeOperator = /^[a-z][a-z0-9_-]+$/.test(parts.name) && parts.value.trim().length > 0 && !/^[/\\]/.test(parts.value);
      if (token.quoted || !looksLikeOperator) { freeTokens.push(token.raw); continue; }
      errors.push({ raw: token.raw, message: "Unknown operator \"{{name}}\". Quote the token to search for it literally.", values: { name: parts.name } });
      continue;
    }
    const valueRaw = parts.value;
    const value = unquote(valueRaw);
    const predicate: SearchPredicate = { operator: operator.name, negated, raw: token.raw, valueRaw, value, start: token.start, end: token.end, axis: "", mediaClass: "", overLoadedResults: false };
    if (!value) { errors.push({ raw: token.raw, message: "{{operator}}: needs a value.", values: { operator: operator.name } }); continue; }
    switch (operator.name) {
      case "tag": predicate.axis = SEARCH_AXIS_TAGS; break;
      case "path": predicate.axis = SEARCH_AXIS_PATH; break;
      case "name": predicate.axis = SEARCH_AXIS_NAME; break;
      case "hash": {
        if (!isContentIDPrefix(value)) { errors.push({ raw: token.raw, message: "hash:{{value}} is not a hexadecimal content id prefix.", values: { value } }); continue; }
        break;
      }
      case "type": {
        const requested = value.toLowerCase();
        const entryType = ENTRY_TYPE_ALIASES[requested];
        if (entryType) { predicate.value = entryType; break; }
        const mediaClass = (MEDIA_CLASS_VALUES as readonly string[]).includes(requested) ? requested : "";
        if (!mediaClass) {
          errors.push({
            raw: token.raw,
            message: "type:{{value}} is not one of the daemon's entry types (regular_file, directory, symlink, fifo, socket, device, special) or derived media classes (image, video, audio, document, archive, other).",
            values: { value },
          });
          continue;
        }
        if (negated) {
          // The daemon has no negation for the derived media class, and a
          // search hit carries no recorded suffix this browser could derive
          // the class from, so excluding it is reported instead of narrowed
          // with a guess.
          errors.push({
            raw: token.raw,
            message: "-type:{{value}} cannot be expressed: the daemon has no negation for the derived media class, and a search hit carries no recorded suffix, so this browser cannot exclude it.",
            values: { value },
          });
          continue;
        }
        predicate.value = mediaClass;
        predicate.mediaClass = mediaClass;
        break;
      }
      case "size": {
        const parsedSize = parseSize(value);
        if (parsedSize.error) { errors.push({ raw: token.raw, message: parsedSize.error, values: { value } }); continue; }
        break;
      }
      case "mtime": {
        const bound = /^([<>])\s*(\d{4}-\d{2}-\d{2})$/.exec(value);
        if (!bound || parseSearchDate(bound[2]) === null) { errors.push({ raw: token.raw, message: "mtime:{{value}} is not a date bound. Use <2024-01-01 or >2024-01-01.", values: { value } }); continue; }
        break;
      }
      case "dup": {
        if (!/^(yes|no)$/i.test(value)) { errors.push({ raw: token.raw, message: "dup:{{value}} is not yes or no.", values: { value } }); continue; }
        predicate.value = value.toLowerCase();
        break;
      }
    }
    if (negated && predicate.operator === "mtime") {
      errors.push({ raw: token.raw, message: "-mtime: cannot be expressed: a hit carries no modification time, so this browser cannot exclude it.", values: {} });
      continue;
    }
    if (negated) predicate.overLoadedResults = true;
    predicates.push(predicate);
  }
  return { source, predicates, freeTokens, freeText: freeTokens.join(" "), errors };
}

// The plan is the exact `search.query` input, plus what the browser must do
// with the answer. Free text is unscoped: when it is present the daemon
// matches every token against every indexed field, so the plan does not send a
// narrowed `construct_axes` and says so instead of pretending otherwise.
export function searchPlan(parsed: ParsedSearchQuery): SearchPlan {
  const filters: SearchFilters = {};
  const lexical: string[] = [...parsed.freeTokens];
  const scopedAxes: string[] = [];
  const overLoadedResults: SearchPredicate[] = [];
  const limits: string[] = [];
  let exactContentID = "";
  let duplicateRequested = false;
  let duplicateClientSide = false;
  const axisOf = (axis: string) => { if (!scopedAxes.includes(axis)) scopedAxes.push(axis); };
  for (const predicate of parsed.predicates) {
    if (predicate.negated) { overLoadedResults.push(predicate); continue; }
    switch (predicate.operator) {
      case "tag": case "path": case "name":
        lexical.push(/\s/.test(predicate.value) ? `"${predicate.value}"` : predicate.value);
        axisOf(predicate.axis);
        break;
      case "type":
        if (predicate.mediaClass) filters.media_class = predicate.mediaClass;
        else filters.entry_type = predicate.value;
        break;
      case "size": {
        const parsedSize = parseSize(predicate.value);
        if (parsedSize.min !== undefined) filters.size_min = parsedSize.min;
        if (parsedSize.max !== undefined) filters.size_max = parsedSize.max;
        break;
      }
      case "mtime": {
        const bound = /^([<>])\s*(\d{4}-\d{2}-\d{2})$/.exec(predicate.value)!;
        const millis = parseSearchDate(bound[2])!;
        if (bound[1] === "<") filters.mtime_before = millis; else filters.mtime_after = millis;
        break;
      }
      case "hash": {
        if (isCompleteContentID(predicate.value)) exactContentID = normalizeContentID(predicate.value);
        else { predicate.overLoadedResults = true; overLoadedResults.push(predicate); }
        break;
      }
      case "dup": {
        duplicateRequested = true;
        if (predicate.value === "no") { predicate.overLoadedResults = true; duplicateClientSide = true; overLoadedResults.push(predicate); }
        break;
      }
    }
  }
  if (exactContentID) filters.content_id = `sha256:${exactContentID}`;
  if (duplicateRequested && !duplicateClientSide) {
    if (exactContentID) {
      // The daemon's duplicate filter is one exact duplicate group, and a
      // duplicate group is the content id its members share.
      filters.duplicate_group = `sha256:${exactContentID}`;
      delete filters.content_id;
    } else if (parsed.freeTokens.length === 0) {
      lexical.push("duplicate");
      axisOf(SEARCH_AXIS_DUPLICATES);
    } else {
      const predicate = parsed.predicates.find((candidate) => candidate.operator === "dup" && !candidate.negated && candidate.value === "yes")!;
      predicate.overLoadedResults = true;
      duplicateClientSide = true;
      overLoadedResults.push(predicate);
    }
  }
  const axesWidened = parsed.freeTokens.length > 0;
  const axesRestricted = !axesWidened && scopedAxes.length > 0;
  const lexicalText = lexical.join(" ").trim();
  // `search.query` needs text or a typed filter. A query made only of
  // client-side predicates has neither, so it is reported instead of sending a
  // request the daemon rejects.
  const requestError = !lexicalText && Object.keys(filters).length === 0 && overLoadedResults.length > 0
    ? "Nothing here reaches the daemon: this text has no lexical token and no typed filter, so there are no results for the remaining predicates to narrow. Add a word, tag:, type:, size:, or a complete hash: value."
    : "";
  if (overLoadedResults.length > 0) limits.push("Evaluated over the loaded results only: the daemon has no expression for this predicate, so it is applied to the hits this query returned.");
  if (axesWidened && scopedAxes.length > 0) limits.push("Free text widens every field-scoped predicate: the daemon matches each token against all of its indexed fields in one query.");
  return {
    request: {
      query: lexicalText,
      filters,
      ...(axesRestricted ? { construct_axes: [...scopedAxes] } : {}),
    },
    scopedAxes,
    axesRestricted,
    axesWidened,
    overLoadedResults,
    limits,
    requestError,
  };
}

/** Rebuilds the field text with one predicate removed (`null`) or replaced. */
export function rewriteSearchText(parsed: ParsedSearchQuery, index: number, nextRaw: string | null): string {
  const predicate = parsed.predicates[index];
  if (!predicate) return parsed.source;
  const before = parsed.source.slice(0, predicate.start);
  const after = parsed.source.slice(predicate.end);
  if (nextRaw === null) return `${before}${after}`.replace(/\s+/g, " ").trim();
  return `${before}${nextRaw}${after}`;
}

/** The token the operator autocomplete should complete, if any. */
export type SearchCompletionContext = {
  kind: "operator" | "tag" | "none";
  /** The already typed text that a picked suggestion replaces. */
  prefix: string;
  replaceStart: number;
  replaceEnd: number;
};

export function searchCompletionContext(source: string, caret: number): SearchCompletionContext {
  const upto = source.slice(0, caret);
  const start = Math.max(upto.lastIndexOf(" "), upto.lastIndexOf("\t")) + 1;
  const token = upto.slice(start);
  if (!token || token.startsWith('"') || token.startsWith("'")) return { kind: "none", prefix: "", replaceStart: caret, replaceEnd: caret };
  const parts = splitToken(token);
  if (!parts) {
    if (!token.replace(/^-/, "")) return { kind: "none", prefix: "", replaceStart: caret, replaceEnd: caret };
    return { kind: "operator", prefix: token, replaceStart: start, replaceEnd: caret };
  }
  if (parts.name === "tag" && token.toLowerCase().startsWith("tag:")) return { kind: "tag", prefix: parts.value, replaceStart: start, replaceEnd: caret };
  return { kind: "none", prefix: "", replaceStart: caret, replaceEnd: caret };
}

/** The operator rows the autocomplete offers for a typed prefix. */
export function operatorSuggestions(prefix: string): SearchOperatorInfo[] {
  const name = prefix.replace(/^-/, "").toLowerCase();
  if (!name) return [];
  const matches = SEARCH_OPERATORS.filter((operator) => operator.name.startsWith(name));
  return matches.length === 1 && matches[0].name === name ? [] : matches;
}

/** The completed token for a picked operator suggestion. */
export function completedOperatorToken(prefix: string, operator: SearchOperatorInfo): string {
  const negated = prefix.startsWith("-") ? "-" : "";
  return `${negated}${operator.name}:`;
}

/** The completed token for a picked tag suggestion. */
export function completedTagToken(value: string): string {
  return `tag:${/\s/.test(value) ? `"${value}"` : value}`;
}
