import { parseSearchQuery, searchPlan } from "./searchops";
import type { SavedViewData } from "./types";

const supportedFields = new Set([
  "tag", "entry_type", "content_id", "duplicate_group", "protection_mode",
  "suffix", "language", "size_min", "size_max", "mtime_after", "mtime_before",
]);
const integerFields = new Set(["size_min", "size_max", "mtime_after", "mtime_before"]);

export type EditableSavedRetrieval = Readonly<{
  query: string;
  fields: string[];
}>;

export function savedRetrievalRecordFingerprint(view: SavedViewData): string {
  return JSON.stringify([
    view.view_id, view.revision, view.name, view.query, view.fields, view.scope,
    view.sort, view.output_names, view.required_capabilities, view.when_missing,
  ]);
}

/** Refuse stored records this client cannot preserve or safely edit. */
export function editableSavedRetrieval(view: SavedViewData, workspaceID: string): EditableSavedRetrieval | undefined {
  if (!view.view_id?.trim() || !Number.isSafeInteger(view.revision) || (view.revision ?? 0) < 1
    || !view.name?.trim() || !workspaceID || view.scope !== workspaceID
    || typeof view.query !== "string"
    || (view.fields !== undefined && (!Array.isArray(view.fields) || view.fields.some((field) => typeof field !== "string")))) return undefined;

  // This build only knows how to preserve the default policies. A nonempty
  // stored option must not disappear when the record is edited or copied.
  if ([view.sort, view.output_names, view.when_missing].some((value) => value !== undefined && (typeof value !== "string" || value !== ""))
    || (view.required_capabilities !== undefined
      && (!Array.isArray(view.required_capabilities)
        || view.required_capabilities.some((value) => typeof value !== "string" || value !== "")))) return undefined;

  const fields = [...(view.fields ?? [])];
  for (const field of fields) {
    const separator = field.indexOf("=");
    if (separator < 1) return undefined;
    const key = field.slice(0, separator).trim().toLowerCase();
    const value = field.slice(separator + 1);
    if (!supportedFields.has(key)) return undefined;
    if (key === "tag") {
      try {
        const tag: unknown = JSON.parse(value);
        if (typeof tag !== "string" || !tag.trim()) return undefined;
      } catch { return undefined; }
    } else if (integerFields.has(key)) {
      if (!/^-?\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value.trim()))) return undefined;
    } else if (!value.trim()) return undefined;
  }

  // The editor treats this box as plain keyword text. Structured predicates
  // belong in the separate saved-fields list; refusing them here prevents a
  // query such as `name:report` from being resaved as literal keyword text.
  const parsed = parseSearchQuery(view.query);
  const plan = searchPlan(parsed);
  if (parsed.errors.length || parsed.predicates.length || plan.axesRestricted || plan.overLoadedResults.length) return undefined;
  return { query: view.query, fields };
}

/** Validate an edited draft without inventing query or SavedView semantics. */
export function validateSavedRetrievalDraft(query: string, fields: string[]): boolean {
  // Keep the query box lexical-only; structured conditions are edited below.
  const parsed = parseSearchQuery(query);
  const plan = searchPlan(parsed);
  if (parsed.errors.length || parsed.predicates.length || plan.axesRestricted || plan.overLoadedResults.length) return false;
  return editableSavedRetrieval({
    view_id: "draft",
    revision: 1,
    name: "draft",
    scope: "draft",
    query,
    fields,
    sort: "",
    output_names: "",
    required_capabilities: [],
    when_missing: "",
  }, "draft") !== undefined;
}
