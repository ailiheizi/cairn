import type { SearchHit } from "./types";
import { capturedModificationTimeMillis } from "./capturedTime";

type CapturedTimeHit = SearchHit & { modified_at?: unknown };

const canonicalContentID = /^sha256:[0-9a-f]{64}$/;
function nonempty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function safeLength(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Add only a captured content.list modification time to an identical,
 * unambiguous namespace file row. Namespace membership and all its own
 * fields remain authoritative; absent or conflicting evidence stays unknown.
 */
export function projectNamespaceCapturedTimes(hits: SearchHit[], loaded: SearchHit[]): SearchHit[] {
  const loadedByEntry = new Map<string, CapturedTimeHit[]>();
  for (const row of loaded) {
    const entryID = nonempty(row.entry_id);
    if (!entryID) continue;
    const matches = loadedByEntry.get(entryID) ?? [];
    matches.push(row as CapturedTimeHit);
    loadedByEntry.set(entryID, matches);
  }

  return hits.map((hit) => {
    if ((hit as CapturedTimeHit).modified_at !== undefined) {
      return capturedModificationTimeMillis(hit.modified_at) === undefined
        ? { ...hit, modified_at: undefined }
        : hit;
    }
    const entryID = nonempty(hit.entry_id);
    const subject = nonempty(hit.subject_ref);
    const contentID = nonempty(hit.content_id);
    const length = safeLength(hit.logical_size);
    if (!entryID || !subject || hit.entry_type !== "REGULAR_FILE" || !contentID || !canonicalContentID.test(contentID) || length === undefined) return hit;

    const candidates = loadedByEntry.get(entryID);
    if (!candidates || candidates.length !== 1) return hit;
    const candidate = candidates[0]!;
    if (candidate.entry_type !== "REGULAR_FILE"
      || nonempty(candidate.subject_ref) !== subject
      || nonempty(candidate.entry_id) !== entryID
      || nonempty(candidate.content_id) !== contentID
      || safeLength(candidate.logical_size) !== length
      || capturedModificationTimeMillis(candidate.modified_at) === undefined) return hit;

    return { ...hit, modified_at: candidate.modified_at };
  });
}
