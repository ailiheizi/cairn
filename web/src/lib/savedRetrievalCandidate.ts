import type { Translator } from "../i18n";
import { libraryPageForMode } from "./libraryViews";
import type { ViewMode } from "./types";
import { parseSearchQuery, searchPlan } from "./searchops";

export type SavedRetrievalCandidate = {
  query: string;
  fields: string[];
  unsupportedConditions: string[];
};

export type SavedRetrievalCandidateInput = {
  t: Translator;
  lastExecutedQuery: string;
  viewMode: ViewMode;
  presentationMode: ViewMode;
  recalledView?: { query?: string; fields?: string[] };
  activeTags: string[];
  activeSystemFacets: Record<string, string | boolean | undefined>;
  activeTimelineMonth?: string;
};

const supportedSavedFields = new Set([
  "entry_type",
  "content_id",
  "duplicate_group",
  "protection_mode",
  "suffix",
  "language",
  "size_min",
  "size_max",
  "mtime_after",
  "mtime_before",
]);

/** Decode one exact TAG value stored in the legacy SavedView fields array. */
export function decodeSavedRetrievalTagField(field: string): string | undefined {
  if (!field.startsWith("tag=")) return undefined;
  try {
    const value: unknown = JSON.parse(field.slice("tag=".length));
    return typeof value === "string" && value.trim() ? value : undefined;
  } catch {
    return undefined;
  }
}

export function hasSavedRetrievalTagFields(fields: string[] = []): boolean {
  return fields.some((field) => decodeSavedRetrievalTagField(field) !== undefined);
}

/** Build the one host-owned, reviewable candidate from the submitted search. */
export function buildSavedRetrievalCandidate({
  t,
  lastExecutedQuery,
  viewMode,
  presentationMode,
  recalledView,
  activeTags,
  activeSystemFacets,
  activeTimelineMonth,
}: SavedRetrievalCandidateInput): SavedRetrievalCandidate {
  const executedPlan = searchPlan(parseSearchQuery(viewMode === "search" ? lastExecutedQuery : ""));
  const query = executedPlan.request.query;
  const recalledActive = Boolean(recalledView && viewMode === "search" && lastExecutedQuery === recalledView.query);
  // `toggleTagFilter` routes an ordinary tag-scoped Library browse through the
  // `tag` view mode; also accept the same content scope before that transition.
  const tagOnlyContent = (viewMode === "content" || viewMode === "tag") && activeTags.some((tag) => tag.trim());
  const pageDefinition = libraryPageForMode(presentationMode);
  const fields = recalledActive
    ? [...(recalledView?.fields ?? [])]
    : Object.entries(executedPlan.request.filters)
      .filter(([key]) => supportedSavedFields.has(key))
      .map(([key, value]) => `${key}=${value}`)
      .concat(activeTags.filter((tag) => tag.trim()).map((tag) => `tag=${JSON.stringify(tag)}`));
  const unsupportedConditions = [
    ...(pageDefinition?.mediaClass === "image" || pageDefinition?.mediaClass === "audio"
      ? [t("Switch to All types before saving this retrieval; a display choice is not a saved query condition.")]
      : []),
    ...(viewMode !== "search" && !tagOnlyContent ? [t("Run a keyword search before saving a retrieval.")] : []),
    ...Object.keys(executedPlan.request.filters)
      .filter((key) => !supportedSavedFields.has(key))
      .map((key) => key === "media_class" ? `${t("Type")}: ${executedPlan.request.filters.media_class}` : key),
    ...(executedPlan.axesRestricted ? [executedPlan.request.construct_axes?.join(", ") || "construct_axes"] : []),
    ...executedPlan.overLoadedResults.map((predicate) => predicate.raw),
    ...activeTags.filter((tag) => !tag.trim()).map(() => t("An empty tag cannot be saved as a retrieval condition.")),
    ...Object.entries(activeSystemFacets)
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) => `${key}:${value}`),
    ...(activeTimelineMonth ? [activeTimelineMonth] : []),
    ...(recalledActive ? [t("Recalled view conditions are not editable here. Run a new search to save changes.")] : []),
  ];

  return { query, fields, unsupportedConditions };
}
