export const CURRENT_DESCRIPTION_PAGE_SIZE = 200;

export type CurrentDescriptionSummary = Record<string, unknown> & {
  description_document_id: string;
  workspace_id: string;
  subject_ref: string;
  revision: number;
};

export type CurrentDescriptionPageSet = {
  workspaceID: string;
  subjectRef: string;
  projectionRef: string;
  documents: CurrentDescriptionSummary[];
  entries: number;
  token: string;
  hasMore: boolean;
};

export type CurrentDescriptionPageRead =
  | { ok: true; value: CurrentDescriptionPageSet }
  | { ok: false; reason: string };

type PageRequest = {
  workspaceID: string;
  subjectRef?: string;
  limit: number;
  previous?: CurrentDescriptionPageSet;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function summaryKey(value: unknown): [string, number, string] | undefined {
  const summary = record(value);
  if (!summary
    || !nonemptyString(summary.subject_ref)
    || !nonemptyString(summary.description_document_id)
    || !Number.isSafeInteger(summary.revision)
    || Number(summary.revision) < 1) return undefined;
  return [summary.subject_ref, Number(summary.revision), summary.description_document_id];
}

function compareKey(left: [string, number, string], right: [string, number, string]): number {
  if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
  if (left[1] !== right[1]) return left[1] < right[1] ? -1 : 1;
  if (left[2] !== right[2]) return left[2] < right[2] ? -1 : 1;
  return 0;
}

function responseReason(response: Record<string, unknown> | undefined): string {
  const reasons = Array.isArray(response?.reasons) ? response.reasons : [];
  const first = record(reasons[0]);
  return nonemptyString(first?.message) ? first.message : "The service did not return a current description page.";
}

/**
 * Validate and append one current-only description page. Page summaries are
 * only trusted as current when the daemon attests the complete projection and
 * the whole continuation remains bound to that same projection.
 */
export function readCurrentDescriptionPage(responseValue: unknown, request: PageRequest): CurrentDescriptionPageRead {
  const response = record(responseValue);
  if (!response || response.status !== "SUCCEEDED") return { ok: false, reason: responseReason(response) };
  const data = record(response.data);
  if (!data
    || data.workspace_id !== request.workspaceID
    || data.current_only !== true
    || !nonemptyString(data.projection_ref)
    || (request.subjectRef
      ? data.subject_ref !== request.subjectRef
      : data.subject_ref !== undefined && data.subject_ref !== "")) {
    return { ok: false, reason: "The service returned a description page for a different scope." };
  }
  if (!Array.isArray(data.documents)) {
    return { ok: false, reason: "The service returned an incomplete or invalid description page." };
  }

  const page = record(data.page);
  if (!Number.isSafeInteger(request.limit) || request.limit < 1
    || !page
    || page.mode !== "page"
    || page.lane !== "description-list"
    || page.order !== "subject_ref,revision,description_document_id"
    || page.limit !== request.limit
    || !validCount(page.returned)
    || page.returned !== data.documents.length
    || !validCount(page.entries)
    || (page.completeness !== "MORE_AVAILABLE" && page.completeness !== "COMPLETE")
    || page.complete !== (page.completeness === "COMPLETE")
    || page.has_more !== (page.completeness === "MORE_AVAILABLE")
    || page.truncated !== false
    || page.continuation_supported !== true
    || (data.truncated !== undefined && data.truncated !== page.has_more)
    || (page.has_more && data.documents.length === 0)
    || (page.has_more && !nonemptyString(page.token))) {
    return { ok: false, reason: "The service returned inconsistent description page metadata." };
  }

  const documents: CurrentDescriptionSummary[] = [];
  const seen = new Set<string>(request.previous?.documents.map((item) => item.description_document_id) ?? []);
  let lastKey = request.previous?.documents.length
    ? summaryKey(request.previous.documents[request.previous.documents.length - 1])
    : undefined;
  for (const value of data.documents) {
    const summary = record(value);
    const key = summaryKey(value);
    if (!summary || !key
      || summary.workspace_id !== request.workspaceID
      || (request.subjectRef && summary.subject_ref !== request.subjectRef)
      || seen.has(key[2])
      || (lastKey && compareKey(lastKey, key) >= 0)) {
      return { ok: false, reason: "The service returned duplicate, unordered, or out-of-scope description summaries." };
    }
    seen.add(key[2]);
    documents.push(summary as CurrentDescriptionSummary);
    lastKey = key;
  }

  const loaded = (request.previous?.documents.length ?? 0) + documents.length;
  if (page.entries < loaded
    || (page.has_more ? loaded >= page.entries : loaded !== page.entries)
    || (request.previous && page.has_more && page.token === request.previous.token)
    || (request.previous && (data.projection_ref !== request.previous.projectionRef || page.entries !== request.previous.entries))) {
    return { ok: false, reason: "The description projection changed or its page counts do not match." };
  }

  return {
    ok: true,
    value: {
      workspaceID: request.workspaceID,
      subjectRef: request.subjectRef ?? "",
      projectionRef: data.projection_ref,
      documents: [...(request.previous?.documents ?? []), ...documents],
      entries: page.entries,
      token: page.has_more && typeof page.token === "string" ? page.token : "",
      hasMore: page.has_more,
    },
  };
}
