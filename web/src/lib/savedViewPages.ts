import type { SearchHit } from "./types";

export type SavedViewPageBinding = Readonly<{
  viewID: string;
  revision: number;
  query: string;
  expectedWorkspaceID?: string;
  limit: number;
  loadedBefore: number;
  totalBefore?: number;
  generationBefore?: string;
  projectionBefore?: string;
  seenSubjects: ReadonlySet<string>;
  previousToken?: string;
}>;

export type SavedViewPage = Readonly<{
  viewID: string;
  revision: number;
  query: string;
  workspaceID: string;
  generationRef: string;
  projectionRef: string;
  hits: SearchHit[];
  total: number;
  hasMore: boolean;
  token: string;
  expiresAt?: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Strictly validate one view.evaluate page before it can join a recalled scope. */
export function readSavedViewPage(value: unknown, binding: SavedViewPageBinding): SavedViewPage {
  if (!isRecord(value) || !Array.isArray(value.hits) || !isRecord(value.page)) {
    throw new Error("This service did not return a safely pageable saved view. Reopen it after updating the service.");
  }
  const revision = value.view_revision;
  const query = value.query;
  const workspaceID = typeof value.workspace_id === "string" ? value.workspace_id.trim() : "";
  const generationRef = typeof value.index_generation_ref === "string" ? value.index_generation_ref.trim() : "";
  const projectionRef = typeof value.projection_ref === "string" ? value.projection_ref.trim() : "";
  const page = value.page;
  const limit = page.limit;
  const returned = page.returned;
  const total = page.entries;
  const hasMore = page.has_more;
  const complete = page.complete;
  const token = typeof page.token === "string" ? page.token : "";
  const expiresAt = typeof page.expires_at === "string" ? page.expires_at : undefined;
  const validExpiry = expiresAt !== undefined
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(expiresAt)
    && Number.isFinite(Date.parse(expiresAt));

  if (value.view_id !== binding.viewID
    || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision !== binding.revision
    || typeof query !== "string" || query !== binding.query
    || !workspaceID || (binding.expectedWorkspaceID && workspaceID !== binding.expectedWorkspaceID)
    || !generationRef
    || !/^sha256:[0-9a-f]{64}$/.test(projectionRef)) {
    throw new Error("The saved view changed while it was being read. Reopen it to refresh the results.");
  }
  if (!Array.isArray(value.coverage)
    || value.coverage.length !== 1
    || value.coverage[0] !== "lexical-metadata-fts") {
    throw new Error("This saved view did not confirm its lexical search coverage. Reopen it to refresh the results.");
  }
  if (page.mode !== "page" || page.lane !== "saved-view" || page.order !== "saved-view-lexical"
    || limit !== binding.limit || typeof returned !== "number" || !Number.isSafeInteger(returned) || returned > binding.limit || returned !== value.hits.length
    || typeof total !== "number" || !Number.isSafeInteger(total) || total < 0 || total < binding.loadedBefore + returned
    || (binding.totalBefore !== undefined && total !== binding.totalBefore)
    || (binding.generationBefore !== undefined && generationRef !== binding.generationBefore)
    || (binding.projectionBefore !== undefined && projectionRef !== binding.projectionBefore)
    || page.truncated !== false || page.continuation_supported !== true
    || typeof hasMore !== "boolean" || complete !== !hasMore
    || (page.completeness !== (hasMore ? "MORE_AVAILABLE" : "COMPLETE"))) {
    throw new Error("The saved view page did not match the current bounded result scope. Reopen it to refresh the results.");
  }
  if (hasMore) {
    if (!token || token === binding.previousToken || returned === 0 || binding.loadedBefore + returned >= total || !validExpiry) {
      throw new Error("The saved view did not provide a progressing continuation. Reopen it to refresh the results.");
    }
  } else if (page.token !== undefined || page.expires_at !== undefined || binding.loadedBefore + returned !== total) {
    throw new Error("The saved view page reported conflicting completion information. Reopen it to refresh the results.");
  }

  const localSubjects = new Set<string>();
  for (const hit of value.hits) {
    if (!isRecord(hit) || typeof hit.subject_ref !== "string" || !hit.subject_ref.trim()) {
      throw new Error("The saved view contained a result without a stable subject. Reopen it to refresh the results.");
    }
    if (Object.prototype.hasOwnProperty.call(hit, "logical_size")) {
      const logicalSize = hit.logical_size;
      const entryID = typeof hit.entry_id === "string" ? hit.entry_id.trim() : "";
      if (hit.entry_type !== "REGULAR_FILE"
        || !entryID
        || typeof logicalSize !== "number"
        || !Number.isSafeInteger(logicalSize)
        || logicalSize < 0) {
        throw new Error("The saved view returned an invalid original size. Reopen it to refresh the results.");
      }
    }
    const subject = hit.subject_ref.trim();
    if (localSubjects.has(subject) || binding.seenSubjects.has(subject)) {
      throw new Error("The saved view continuation repeated a result. Reopen it to refresh the results.");
    }
    localSubjects.add(subject);
  }
  return {
    viewID: binding.viewID,
    revision,
    query,
    workspaceID,
    generationRef,
    projectionRef,
    hits: value.hits as SearchHit[],
    total,
    hasMore,
    token,
    ...(expiresAt ? { expiresAt } : {}),
  };
}
