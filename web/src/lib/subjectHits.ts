import type { SearchHit } from "./types";

/** Keep the first loaded hit for each non-empty stable subject reference. */
export function uniqueSubjectHits(hits: readonly SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const subjectRef = hit.subject_ref?.trim();
    if (!subjectRef || seen.has(subjectRef)) return false;
    seen.add(subjectRef);
    return true;
  });
}
