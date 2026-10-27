import type { SearchHit } from "./types";

export type OverviewIdentity = Pick<SearchHit, "entry_id" | "content_id" | "logical_size">;

/** Identity tuple used only to keep a spotlight stable during client rerenders. */
export function overviewHitIdentity(workspaceID: string, hit: OverviewIdentity): string {
  return JSON.stringify([workspaceID, hit.entry_id ?? "", hit.content_id ?? "", hit.logical_size ?? null]);
}

export function overviewScopeKey(workspaceID: string, hits: OverviewIdentity[]): string {
  return JSON.stringify([...new Set(hits.map((hit) => overviewHitIdentity(workspaceID, hit)))].sort());
}

/** Pick one member from the current scope; callers memoize by the scope key. */
export function pickOverviewSpotlight<T>(items: T[], _scopeKey: string): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}
