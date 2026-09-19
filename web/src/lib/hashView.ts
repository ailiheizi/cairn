import type { ViewMode } from "./types";

// The URL hash is a browser-local deep link over the library's projection
// state. It is convenience only: restoring re-derives everything from the
// daemon (the listing reload, the search re-runs), and the hash never carries
// durable state or authorizes anything by itself.
//
// Vocabulary (hash-based only, written with history.replaceState so a change
// never spams the session history):
//   v      the view mode: content | tag | search | sources | activity |
//          duplicates | tags. "path" is deliberately never written: its
//          browse crumbs are browser-local namespace ids a reload cannot
//          rebuild, so it falls back to the default view.
//   q      the submitted search text (search view only).
//   tag    the active tag facet; the parameter repeats for multiple tags
//          (tag view only).
//   month  the active timeline bucket, YYYY-MM (content/tag views only).

export type HashView = { mode: ViewMode | ""; q: string; tags: string[]; month: string };

const HASH_VIEW_MODES: ViewMode[] = ["content", "tag", "path", "search", "sources", "activity", "duplicates", "tags"];
export const MONTH_BUCKET_PATTERN = /^\d{4}-\d{2}$/;

export function isMonthBucketKey(value: string) { return MONTH_BUCKET_PATTERN.test(value); }

export function parseHashView(hash: string): HashView {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return { mode: "", q: "", tags: [], month: "" };
  const params = new URLSearchParams(raw);
  const mode = params.get("v") ?? "";
  if (!(HASH_VIEW_MODES as string[]).includes(mode) || mode === "path") return { mode: "", q: "", tags: [], month: "" };
  const viewMode = mode as ViewMode;
  const monthValue = params.get("month") ?? "";
  const month = MONTH_BUCKET_PATTERN.test(monthValue) ? monthValue : "";
  if (viewMode === "search") return { mode: viewMode, q: params.get("q") ?? "", tags: [], month: "" };
  if (viewMode === "tag") return { mode: viewMode, q: "", tags: params.getAll("tag"), month };
  if (viewMode === "content") return { mode: viewMode, q: "", tags: [], month };
  return { mode: viewMode, q: "", tags: [], month: "" };
}

export function writeHashView(state: HashView): void {
  const params = new URLSearchParams();
  if (state.mode === "search") {
    params.set("v", "search");
    if (state.q.trim()) params.set("q", state.q.trim());
  } else if (state.mode === "tag") {
    params.set("v", "tag");
    for (const tag of state.tags) if (tag.trim()) params.append("tag", tag.trim());
    if (state.month) params.set("month", state.month);
  } else if (state.mode === "content") {
    // A content view with an active month is a distinct deep link, so it
    // carries v=content like every other encoded view; the default content
    // view still writes no hash at all.
    if (state.month) {
      params.set("v", "content");
      params.set("month", state.month);
    }
  } else if (state.mode === "sources" || state.mode === "activity" || state.mode === "duplicates" || state.mode === "tags") {
    params.set("v", state.mode);
  }
  const hash = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ""}`);
}
