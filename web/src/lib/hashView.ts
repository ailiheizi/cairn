import type { ViewMode } from "./types";
import { libraryModeForRoute, libraryPageForMode } from "./libraryViews";

// The URL hash is a browser-local deep link over the library's projection
// state. It is convenience only: restoring re-derives everything from the
// daemon (the listing reload, the search re-runs), and the hash never carries
// durable state or authorizes anything by itself.
//
// Vocabulary (hash-based only, written with history.replaceState so a change
// never spams the session history):
//   v      the host view or a registered library page route: content | photos |
//          music | exhibition | tag | search | sources | activity | duplicates | tags | notes.
//          "path" is deliberately never written: its
//          browse crumbs are browser-local namespace ids a reload cannot
//          rebuild, so it falls back to the default view.
//   q      the submitted search text (search view only).
//   tag    the active tag facet; the parameter repeats for multiple tags
//          (tag view only).
//   month  the active timeline bucket, YYYY-MM (content/tag views only).

export type HashView = { mode: ViewMode | ""; presentation: ViewMode | ""; invalidPresentation?: boolean; q: string; tags: string[]; month: string };

const HASH_VIEW_MODES: ViewMode[] = ["content", "tag", "path", "search", "sources", "activity", "duplicates", "tags", "notes"];
export const MONTH_BUCKET_PATTERN = /^\d{4}-\d{2}$/;

export function isMonthBucketKey(value: string) { return MONTH_BUCKET_PATTERN.test(value); }

export function parseHashView(hash: string): HashView {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return { mode: "", presentation: "", invalidPresentation: false, q: "", tags: [], month: "" };
  const params = new URLSearchParams(raw);
  const route = params.get("v") ?? "";
  let viewMode: ViewMode | "" = (HASH_VIEW_MODES as string[]).includes(route)
    ? route as ViewMode
    : libraryModeForRoute(route) ?? libraryPageForMode(route as ViewMode)?.mode ?? "";
  const rawPresentation = params.get("presentation") ?? "";
  let presentation: ViewMode | "" = (rawPresentation ? libraryModeForRoute(rawPresentation) : undefined) ?? "";
  const invalidPresentation = Boolean(rawPresentation && !presentation);
  if (viewMode && libraryPageForMode(viewMode)) { presentation = viewMode; viewMode = "content"; }
  if (!viewMode || viewMode === "path") return { mode: "", presentation: "", invalidPresentation, q: "", tags: [], month: "" };
  const monthValue = params.get("month") ?? "";
  const month = MONTH_BUCKET_PATTERN.test(monthValue) ? monthValue : "";
  if (viewMode === "search") return { mode: viewMode, presentation, invalidPresentation, q: params.get("q") ?? "", tags: params.getAll("tag"), month };
  if (viewMode === "tag") return { mode: viewMode, presentation, invalidPresentation, q: "", tags: params.getAll("tag"), month };
  if (viewMode === "content") return { mode: viewMode, presentation, invalidPresentation, q: "", tags: [], month };
  return { mode: viewMode, presentation: "", invalidPresentation, q: "", tags: [], month: "" };
}

export function writeHashView(state: HashView): void {
  const params = new URLSearchParams();
  if (state.mode === "search") {
    params.set("v", "search");
    if (state.q.trim()) params.set("q", state.q.trim());
    for (const tag of state.tags) if (tag.trim()) params.append("tag", tag.trim());
    if (state.month) params.set("month", state.month);
    if (state.presentation && state.presentation !== "content" && libraryPageForMode(state.presentation)) params.set("presentation", libraryPageForMode(state.presentation)!.route);
  } else if (state.mode === "tag") {
    params.set("v", "tag");
    for (const tag of state.tags) if (tag.trim()) params.append("tag", tag.trim());
    if (state.month) params.set("month", state.month);
    if (state.presentation && state.presentation !== "content" && libraryPageForMode(state.presentation)) params.set("presentation", libraryPageForMode(state.presentation)!.route);
  } else if (state.mode === "content") {
    // Library is now an explicit destination; an absent hash opens Home.
    // Keep v=content even without filters so reloading Library stays there.
    params.set("v", "content");
    if (state.month) params.set("month", state.month);
    if (state.presentation && state.presentation !== "content" && libraryPageForMode(state.presentation)) params.set("presentation", libraryPageForMode(state.presentation)!.route);
  } else if (state.mode !== "" && libraryPageForMode(state.mode)) {
    params.set("v", libraryPageForMode(state.mode)!.route);
  } else if (state.mode === "sources" || state.mode === "activity" || state.mode === "duplicates" || state.mode === "tags" || state.mode === "notes") {
    params.set("v", state.mode);
  }
  const hash = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ""}`);
}
