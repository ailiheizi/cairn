import type { LibraryPageMode, ViewMode } from "./types";

/** A stable compiled page identity. New pages use a namespaced `page:` mode. */
export type LibraryPageId = string;
export type LibraryPageContext = "loaded-library";

export type LibraryPageDefinition = {
  id: LibraryPageId;
  mode: LibraryPageMode;
  /** Stable, human-readable URL value; photos/music are kept as legacy aliases. */
  route: string;
  /** Unique navigation contribution point. */
  slot: string;
  label: string;
  description?: string;
  context: LibraryPageContext;
  /** When present, this compiled renderer is a presentation of the named root page. */
  presentationOf?: LibraryPageId;
  /** Label used when this renderer appears beside its sibling presentations. */
  presentationLabel?: string;
  chrome?: "standard" | "immersive";
  mediaClass?: "image" | "audio" | "all";
  /** Aggregate layouts stay separate from media-domain destinations. */
  navigationKind?: "domain" | "layout";
};

/** Historical name retained for existing settings and client integrations. */
export type LibraryViewId = LibraryPageId;
export type LibraryViewDefinition = LibraryPageDefinition;

const reservedModes: ReadonlySet<string> = new Set([
  "content", "tag", "path", "search", "sources", "activity", "duplicates", "tags", "notes",
]);
const reservedRoutes: ReadonlySet<string> = new Set([...reservedModes, "", "settings", "restore", "export"]);
const reservedPageIDs: ReadonlySet<string> = new Set([
  "cairn:content", "cairn:search", "cairn:sources", "cairn:activity",
  "cairn:duplicates", "cairn:tags", "cairn:notes", "cairn:settings",
]);
const reservedSlots: ReadonlySet<string> = new Set([
  "host.shell", "host.navigation", "host.primary-navigation", "host.content", "host.details",
]);
const stableID = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._-]*$/;
const stablePageMode = /^page:[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._-]*$/;
const safeRoute = /^[a-z][a-z0-9-]*$/;
const safeSlot = /^page\.[a-z][a-z0-9-]*\.[a-z0-9][a-z0-9._-]*$/;

/** Validate all compiled pages before navigation, routing, or preferences expose them. */
export function validateLibraryPages(pages: readonly LibraryPageDefinition[]): void {
  const ids = new Set<string>();
  const routes = new Set<string>();
  const slots = new Set<string>();
  const modes = new Set<string>();
  const pagesByID = new Map<string, LibraryPageDefinition>();
  for (const page of pages) {
    if (!stableID.test(page.id)) throw new Error(`Invalid library page ID: ${page.id}`);
    if (reservedPageIDs.has(page.id)) throw new Error(`Library page ID is reserved by the host: ${page.id}`);
    if (ids.has(page.id)) throw new Error(`Duplicate library page ID: ${page.id}`);
    if (!safeRoute.test(page.route) || reservedRoutes.has(page.route)) throw new Error(`Library page route is reserved or invalid: ${page.route}`);
    if (routes.has(page.route)) throw new Error(`Duplicate library page route: ${page.route}`);
    if (!safeSlot.test(page.slot) || reservedSlots.has(page.slot)) throw new Error(`Library page slot is reserved or invalid: ${page.slot}`);
    if (slots.has(page.slot)) throw new Error(`Duplicate library page slot: ${page.slot}`);
    if (!page.label.trim()) throw new Error(`Library page label is empty: ${page.id}`);
    if (page.presentationLabel !== undefined && !page.presentationLabel.trim()) throw new Error(`Library presentation label is empty: ${page.id}`);
    if (page.chrome !== undefined && page.chrome !== "standard" && page.chrome !== "immersive") throw new Error(`Invalid library page chrome: ${page.id}`);
    if (page.navigationKind !== undefined && page.navigationKind !== "domain" && page.navigationKind !== "layout") throw new Error(`Invalid library page navigation kind: ${page.id}`);
    if (page.navigationKind === "layout" && (page.presentationOf || page.mediaClass !== "all")) throw new Error(`Aggregate library layouts must be all-types roots: ${page.id}`);
    if (reservedModes.has(page.mode)) throw new Error(`Library page mode is reserved by the host: ${page.mode}`);
    if (page.mode !== "photos" && page.mode !== "music" && !stablePageMode.test(page.mode)) {
      throw new Error(`Library page mode must be a stable namespaced page ID: ${page.mode}`);
    }
    if (modes.has(page.mode)) throw new Error(`Duplicate library page mode: ${page.mode}`);
    ids.add(page.id);
    routes.add(page.route);
    slots.add(page.slot);
    modes.add(page.mode);
    pagesByID.set(page.id, page);
  }
  for (const page of pages) {
    if (!page.presentationOf) continue;
    const parent = pagesByID.get(page.presentationOf);
    if (!parent) throw new Error(`Library presentation parent is not registered: ${page.id}`);
    if (parent.id === page.id) throw new Error(`Library presentation cannot reference itself: ${page.id}`);
    if (parent.presentationOf) throw new Error(`Library presentations cannot be nested: ${page.id}`);
    if (parent.navigationKind === "layout") throw new Error(`Domain presentations cannot reference an aggregate layout: ${page.id}`);
    if (page.context !== parent.context || page.mediaClass !== parent.mediaClass) {
      throw new Error(`Library presentation must share its root context and media class: ${page.id}`);
    }
  }
}
export const validateLibraryViews = validateLibraryPages;

/** Keep the separately compiled renderer catalog one-to-one with page records. */
export function validateLibraryRendererIDs(pages: readonly LibraryPageDefinition[], rendererIDs: readonly LibraryPageId[]): void {
  const ids = new Set<string>();
  for (const id of rendererIDs) {
    if (ids.has(id)) throw new Error(`Duplicate library page renderer ID: ${id}`);
    ids.add(id);
  }
  for (const page of pages) if (!ids.has(page.id)) throw new Error(`Missing compiled renderer for library page: ${page.id}`);
  for (const id of ids) if (!pages.some((page) => page.id === id)) throw new Error(`Renderer has no registered library page: ${id}`);
}

/** Compiled first-party metadata. Renderer implementations are bound by LibraryPageHost. */
export const libraryPages: readonly LibraryPageDefinition[] = [
  { id: "cairn:photos", mode: "photos", route: "photos", slot: "page.cairn.photos", label: "Photos", presentationLabel: "Photo wall", description: "Photos shows image files saved in your Library.", context: "loaded-library", mediaClass: "image" },
  { id: "cairn:music", mode: "music", route: "music", slot: "page.cairn.music", label: "Music", description: "Audio shows files in your Library; browsing does not play them.", context: "loaded-library", mediaClass: "audio" },
  { id: "cairn:exhibition", mode: "page:cairn:exhibition", route: "exhibition", slot: "page.cairn.exhibition", label: "Exhibition", presentationOf: "cairn:photos", presentationLabel: "Exhibition", description: "Walk through your saved images in a focused gallery.", context: "loaded-library", chrome: "immersive", mediaClass: "image" },
  { id: "cairn:overview", mode: "page:cairn:overview", route: "overview", slot: "page.cairn.overview", label: "Content overview", description: "Photos, music and other content together in the current Library scope.", context: "loaded-library", mediaClass: "all", navigationKind: "layout" },
];

validateLibraryPages(libraryPages);

/** Compatibility aliases for existing appearance/settings client code. */
export const libraryViews = libraryPages;
export const allLibraryPageIds: ReadonlySet<LibraryPageId> = new Set(libraryPages.map((page) => page.id));
export const allLibraryViewIds = allLibraryPageIds;

export type LibraryPageGroup = { root: LibraryPageDefinition; presentations: readonly LibraryPageDefinition[] };

/** Return the top-level domain page that owns a registered presentation. */
export function libraryPageRoot(page: LibraryPageDefinition, pages: readonly LibraryPageDefinition[] = libraryPages): LibraryPageDefinition | undefined {
  if (!page.presentationOf) return page;
  return pages.find((candidate) => candidate.id === page.presentationOf && !candidate.presentationOf);
}

/** Group visible roots with their enabled renderers; an enabled child keeps its root navigable. */
export function enabledLibraryPageGroups(enabledPageIds: ReadonlySet<LibraryPageId>, pages: readonly LibraryPageDefinition[] = libraryPages): LibraryPageGroup[] {
  return pages.filter((page) => !page.presentationOf).map((root) => ({
    root,
    presentations: pages.filter((page) => page.id === root.id || page.presentationOf === root.id).filter((page) => enabledPageIds.has(page.id)),
  })).filter((group) => group.presentations.length > 0);
}

export function libraryPageForMode(mode: ViewMode): LibraryPageDefinition | undefined {
  return libraryPages.find((page) => page.mode === mode);
}

export function libraryPageForRoute(route: string): LibraryPageDefinition | undefined {
  return libraryPages.find((page) => page.route === route);
}

export function libraryPageIdForMode(mode: ViewMode): LibraryPageId | undefined {
  return libraryPageForMode(mode)?.id;
}

export const libraryViewIdForMode = libraryPageIdForMode;

export function libraryModeForRoute(route: string): LibraryPageMode | undefined {
  return libraryPageForRoute(route)?.mode;
}

/** Generic host modes are always available; registered pages can be toggled. */
export function isLibraryPageEnabled(mode: ViewMode, enabledPageIds: ReadonlySet<LibraryPageId>): boolean {
  const id = libraryPageIdForMode(mode);
  return id === undefined || enabledPageIds.has(id);
}

export const isLibraryViewEnabled = isLibraryPageEnabled;

/** Route parsing never grants access; it only resolves a registered client projection. */
export function resolveLibraryPageRoute(route: string, enabledPageIds: ReadonlySet<LibraryPageId>): ViewMode {
  const page = libraryPageForRoute(route);
  return page && enabledPageIds.has(page.id) ? page.mode : "content";
}
