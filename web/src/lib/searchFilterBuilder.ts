import { completedTagToken, parseSearchQuery, rewriteSearchText, searchPlan } from "./searchops";
import type { SearchOperatorName } from "./searchops";

export type VisualSearchField = "type" | "suffix" | "tag" | "size" | "mtime" | "protection" | "name" | "path" | "lang" | "hash" | "dup";

export const VISUAL_SEARCH_TYPES = [
  { value: "image", label: "Photos" },
  { value: "audio", label: "Music" },
  { value: "video", label: "Video" },
  { value: "document", label: "Documents" },
  { value: "archive", label: "Archives" },
  { value: "regular_file", label: "Files" },
  { value: "directory", label: "Folders" },
] as const;

export type VisualSearchEdit = {
  field: VisualSearchField;
  value: string;
  /** Index of one positive predicate to replace. Omit to add another condition. */
  replaceIndex?: number;
  /** Raw source token observed when the user chose that predicate. */
  expectedRaw?: string;
};

export type VisualSearchRewrite = { ok: true; query: string } | { ok: false; reason: string };

const FIELD_OPERATOR: Record<VisualSearchField, SearchOperatorName> = {
  type: "type", suffix: "suffix", tag: "tag", size: "size", mtime: "mtime", protection: "protection",
  name: "name", path: "path", lang: "lang", hash: "hash", dup: "dup",
};

function tokenFor(field: VisualSearchField, value: string): string {
  const trimmed = value.trim();
  if (field === "tag") return completedTagToken(trimmed);
  if (field === "name" || field === "path") {
    if (!/[\s\"']/.test(trimmed)) return `${field}:${trimmed}`;
    const quote = trimmed.includes('"') ? "'" : '"';
    if (trimmed.includes(quote)) return "";
    return `${field}:${quote}${trimmed}${quote}`;
  }
  return `${field}:${trimmed}`;
}

const RANGE_ERROR = "The size or date range starts after it ends.";
const REMOVE_STALE_ERROR = "This condition changed. Choose it again before removing it.";

function hasInvertedRange(source: string): boolean {
  const filters = searchPlan(parseSearchQuery(source)).request.filters;
  return (filters.size_min !== undefined && filters.size_max !== undefined && filters.size_min > filters.size_max)
    || (filters.mtime_after !== undefined && filters.mtime_before !== undefined && filters.mtime_after >= filters.mtime_before);
}

function mtimeBound(value: string): "before" | "after" | null {
  const match = /^([<>])\s*\d{4}-\d{2}-\d{2}$/.exec(value.trim());
  if (!match) return null;
  return match[1] === "<" ? "before" : "after";
}

/**
 * Edits only the selected positive condition, or appends one new condition.
 * The parser remains the authority for validity; errors prevent any rewrite.
 */
export function rewriteVisualSearchFilter(source: string, edit: VisualSearchEdit): VisualSearchRewrite {
  const parsed = parseSearchQuery(source);
  if (parsed.errors.length) {
    if (parsed.errors.some((error) => error.message.includes("starts after it ends"))) return { ok: false, reason: RANGE_ERROR };
    return { ok: false, reason: "The current search has a condition that needs attention before visual filters can change it." };
  }
  const operator = FIELD_OPERATOR[edit.field];
  const value = edit.value.trim();
  if (!value) return { ok: false, reason: "Choose or enter a value first." };

  let token = tokenFor(edit.field, value);
  if (!token) return { ok: false, reason: "This value cannot be represented safely by the current search syntax." };
  const candidate = parseSearchQuery(token);
  if (candidate.errors.some((error) => error.message.includes("starts after it ends"))) return { ok: false, reason: RANGE_ERROR };
  if (candidate.errors.length || candidate.freeTokens.length > 0 || candidate.predicates.length !== 1 || candidate.predicates[0].operator !== operator || candidate.predicates[0].negated) {
    return { ok: false, reason: "That value is not supported by this filter." };
  }
  if (edit.field === "tag" && candidate.predicates[0].value !== value) return { ok: false, reason: "That value is not supported by this filter." };
  if (["name", "path", "lang"].includes(edit.field) && candidate.predicates[0].value !== value) return { ok: false, reason: "That value cannot be represented exactly by the current search syntax." };

  let next: string;
  if (edit.replaceIndex !== undefined) {
    const positiveMatches = parsed.predicates.filter((predicate) => predicate.operator === operator && !predicate.negated);
    if ((edit.field === "lang" || edit.field === "hash" || edit.field === "dup") && positiveMatches.length > 1) {
      return { ok: false, reason: "This search has multiple conditions for a single-value filter. Remove the extra conditions before editing it." };
    }
    const existing = parsed.predicates[edit.replaceIndex];
    if (!existing || existing.operator !== operator || existing.negated || (edit.expectedRaw !== undefined && existing.raw !== edit.expectedRaw)) return { ok: false, reason: "Choose a matching positive condition to replace." };
    next = rewriteSearchText(parsed, edit.replaceIndex, token);
  } else {
    const positives = parsed.predicates.filter((predicate) => predicate.operator === operator && !predicate.negated);
    const requestedMtimeBound = edit.field === "mtime" ? mtimeBound(value) : null;
    const repeatable = edit.field === "tag" || edit.field === "name" || edit.field === "path";
    const conflicts = repeatable ? false
      : edit.field === "mtime" ? positives.some((predicate) => mtimeBound(predicate.value) === requestedMtimeBound)
      : positives.length > 0;
    if (conflicts) {
      return { ok: false, reason: "A matching condition already exists. Choose it above to replace its value." };
    }
    next = `${source}${source && !/\s$/.test(source) ? " " : ""}${token}`;
  }

  const nextParsed = parseSearchQuery(next);
  if (nextParsed.errors.length) {
    if (nextParsed.errors.some((error) => error.message.includes("starts after it ends"))) return { ok: false, reason: RANGE_ERROR };
    return { ok: false, reason: "This change would make the search invalid, so the original text was kept." };
  }
  const mtimeBounds = nextParsed.predicates.filter((predicate) => predicate.operator === "mtime" && !predicate.negated).map((predicate) => mtimeBound(predicate.value));
  if (mtimeBounds.some((bound) => bound !== null && mtimeBounds.filter((candidateBound) => candidateBound === bound).length > 1)) {
    return { ok: false, reason: "A matching condition already exists. Choose it above to replace its value." };
  }
  if (hasInvertedRange(next)) return { ok: false, reason: RANGE_ERROR };
  return { ok: true, query: next };
}

/** Removes one still-current parsed condition while retaining every other token. */
export function removeVisualSearchFilter(source: string, intent: { predicateIndex: number; expectedRaw: string }): VisualSearchRewrite {
  const parsed = parseSearchQuery(source);
  const selected = parsed.predicates[intent.predicateIndex];
  if (parsed.errors.length || !selected || selected.raw !== intent.expectedRaw) return { ok: false, reason: REMOVE_STALE_ERROR };
  return { ok: true, query: rewriteSearchText(parsed, intent.predicateIndex, null) };
}

export function visualFilterPredicates(source: string, field: VisualSearchField) {
  const operator = FIELD_OPERATOR[field];
  return parseSearchQuery(source).predicates
    .map((predicate, index) => ({ predicate, index }))
    .filter(({ predicate }) => predicate.operator === operator && !predicate.negated);
}
