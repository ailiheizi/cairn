import { dedupFacetValue, formatFacetValue, itemInMonth, mediaContentItems } from "./format";
import { libraryPageForMode } from "./libraryViews";
import type { LibraryPageMode, SearchHit, SystemFacetState, ViewMode } from "./types";

/** The result authority is selected independently from the active page renderer. */
export function resultScopeSource(viewMode: ViewMode, searchHits: SearchHit[], loadedHits: SearchHit[]): SearchHit[] {
  return viewMode === "search" || viewMode === "path" ? searchHits : loadedHits;
}

/** Apply only the registered page's deterministic media suffix projection, preserving order and row identity. */
export function projectResultScope(hits: SearchHit[], presentationMode: "content" | LibraryPageMode): SearchHit[] {
  const mediaClass = presentationMode === "content" ? undefined : libraryPageForMode(presentationMode)?.mediaClass;
  return mediaClass === "image" || mediaClass === "audio" ? mediaContentItems(hits, mediaClass) : hits;
}

export function filterResultScope(hits: SearchHit[], conditions: {
  activeTags: string[];
  activeSystemFacets: SystemFacetState;
  activeTimelineMonth: string;
  tagsBySubject: Map<string, string[]>;
  identityCounts: Map<string, number>;
}): { facetFiltered: SearchHit[]; monthFiltered: SearchHit[]; scopeHits: SearchHit[] } {
  const facetFiltered = hits.filter((item) => {
    const format = formatFacetValue(item);
    const dedup = dedupFacetValue(item, conditions.identityCounts);
    const tagState = item.index_status?.tags;
    const states = [item.index_status?.lexical, item.index_status?.semantic].filter((value): value is string => typeof value === "string" && value.length > 0);
    const indexNotReady = states.some((value) => value === "NOT_BUILT" || value === "UNAVAILABLE");
    const facets = conditions.activeSystemFacets;
    return (!facets.type || item.entry_type === facets.type) && (!facets.format || format === facets.format) && (!facets.dedup || dedup === facets.dedup) && (!facets.tags || tagState === facets.tags) && (!facets.index || (facets.index === "NOT_READY" && indexNotReady));
  });
  const monthFiltered = conditions.activeTimelineMonth ? facetFiltered.filter((item) => itemInMonth(item, conditions.activeTimelineMonth)) : facetFiltered;
  const scopeHits = monthFiltered.filter((item) => {
    const values = item.subject_ref ? conditions.tagsBySubject.get(item.subject_ref) ?? [] : [];
    return conditions.activeTags.every((tag) => values.includes(tag));
  });
  return { facetFiltered, monthFiltered, scopeHits };
}
