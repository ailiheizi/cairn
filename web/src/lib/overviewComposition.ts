import { formatFacetValue, mediaClassFromSuffix } from "./format";
import type { SearchHit } from "./types";

export const OVERVIEW_SECTION_LIMIT = 6;

export type OverviewRow = { hit: SearchHit; index: number };
export type OverviewSection = { total: number; rows: OverviewRow[] };
export type OverviewSections = { photos: OverviewSection; audio: OverviewSection; other: OverviewSection };

/**
 * Project the host's current ordered scope into three fixed, bounded sections.
 * Counts describe all supplied rows; row indices always refer to that original
 * scope so host selection callbacks cannot accidentally use section offsets.
 */
export function projectOverviewSections(hits: readonly SearchHit[]): OverviewSections {
  const photos: OverviewRow[] = [];
  const audio: OverviewRow[] = [];
  const other: OverviewRow[] = [];
  let photoTotal = 0;
  let audioTotal = 0;
  let otherTotal = 0;

  hits.forEach((hit, index) => {
    const mediaClass = hit.entry_type === "REGULAR_FILE" ? mediaClassFromSuffix(formatFacetValue(hit)) : "";
    if (mediaClass === "image") {
      photoTotal++;
      if (photos.length < OVERVIEW_SECTION_LIMIT) photos.push({ hit, index });
    } else if (mediaClass === "audio") {
      audioTotal++;
      if (audio.length < OVERVIEW_SECTION_LIMIT) audio.push({ hit, index });
    } else {
      otherTotal++;
      if (other.length < OVERVIEW_SECTION_LIMIT) other.push({ hit, index });
    }
  });

  return {
    photos: { total: photoTotal, rows: photos },
    audio: { total: audioTotal, rows: audio },
    other: { total: otherTotal, rows: other },
  };
}
