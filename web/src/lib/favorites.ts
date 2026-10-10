import type { AnnotationRecord, SearchHit } from "./types";

// An ordinary visible user tag. It has no special server-side kind or authority.
export const FAVORITE_TAG = "Favorite";

export type FavoriteControls = {
  status: "loading" | "ready" | "unavailable";
  writable: boolean;
  isFavorite: (subjectRef: string) => boolean;
  isBusy: (subjectRef: string) => boolean;
  onToggle: (hit: SearchHit) => void;
};

export function favoriteAnnotations(records: AnnotationRecord[], subjectRef: string): AnnotationRecord[] {
  const subject = subjectRef.trim();
  if (!subject) return [];
  return records.filter((record) => record.subject_ref?.trim() === subject && record.kind === "TAG" && !record.tombstoned && record.body?.trim() === FAVORITE_TAG);
}
