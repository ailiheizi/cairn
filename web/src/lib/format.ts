import type { Locale, Translator } from "../i18n";
import type { BrowseRoot, SearchHit, SearchSegment, SnapshotSummary, SnapshotVerificationData, SortDirection, SortField } from "./types";

// Pure presentation and listing helpers.
//
// Everything here is a deterministic function of its arguments: no daemon
// call, no browser storage, no React state. Surfaces call these to render or
// order a value; none of the rules below belong to a single surface.

export function formatBytes(value: number) {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let scaled = value;
  let unit = -1;
  while (scaled >= 1024 && unit < units.length - 1) { scaled /= 1024; unit += 1; }
  return `${scaled.toFixed(1)} ${units[unit]}`;
}

export function formatNoteDate(value: string | undefined, locale: Locale, t: Translator) { if (!value) return t("Saved"); const date = new Date(value); return Number.isNaN(date.getTime()) ? t("Saved") : new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date); }
export function formatDateTime(value: string, locale: Locale, t: Translator) { const date = new Date(value); return Number.isNaN(date.getTime()) ? t("Not recorded") : new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date); }

export function formatEntryType(value: string | undefined, t: Translator) { return t(value ? value.replaceAll("_", " ") : "FILE"); }
export function formatDedupFacet(value: string, t: Translator) { return t(value === "DUPLICATE" ? "Duplicate content" : "Unique content"); }
export function looksLikeRemoteLocator(value: string) { return /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim()); }

// Search provenance can contain extracted or generated text close to the
// backend's payload limit. Keep the browser projection small while retaining
// the complete segment in the API response and its immutable identifiers.
export const MATCHED_TEXT_PREVIEW_CODE_POINTS = 280;
export function previewUnicodeText(value: string | undefined, limit = MATCHED_TEXT_PREVIEW_CODE_POINTS) {
  const text = value?.trim() ?? "";
  const codePointLimit = Math.max(1, Math.floor(limit));
  const codePoints = Array.from(text);
  return codePoints.length > codePointLimit ? `${codePoints.slice(0, codePointLimit).join("")}…` : text;
}

export function descriptionKindLabel(kind: string | undefined, t: Translator) {
  const normalized = kind?.trim().toUpperCase();
  const labels: Record<string, string> = {
    USER: "User note",
    IMPORTED: "Imported note",
    EXTRACTED: "Extracted note",
    AI_SUMMARY: "AI note",
    AI_ANALYSIS: "AI note",
  };
  if (normalized && labels[normalized]) return t(labels[normalized]);
  return normalized ? `${t("Unknown note type")}: ${normalized}` : t("Note source unavailable");
}

export function searchSegmentSourceLabel(segment: SearchSegment, t: Translator) {
  const sourceType = segment.source_type?.trim().toUpperCase();
  const kind = segment.kind?.trim().toUpperCase();
  if (sourceType === "ANNOTATION" && kind === "NOTE") return t("User note");
  if (sourceType === "ARTIFACT" && kind === "EXTRACT") return t("Extracted content");
  if (sourceType === "DESCRIPTION") return descriptionKindLabel(kind, t);
  if (sourceType === "FILENAME" || kind === "FILENAME") return t("Filename");
  const rawLabel = [segment.source_type?.trim(), segment.kind?.trim()].filter(Boolean).join(" / ");
  return rawLabel || t("Matched segment");
}

export function searchSegmentMetadata(segment: SearchSegment, t: Translator) {
  const metadata: string[] = [];
  if (segment.producer?.trim()) metadata.push(`${t("Producer")}: ${segment.producer.trim()}`);
  if (segment.language?.trim()) metadata.push(`${t("Language")}: ${segment.language.trim()}`);
  if (typeof segment.accepted === "boolean") metadata.push(segment.accepted ? t("Accepted") : t("Not accepted"));
  return metadata;
}

export function formatFacetValue(hit: SearchHit) {
  if (hit.entry_type === "DIRECTORY" || hit.entry_type === "SYMLINK") return "";
  const name = hit.name || hit.path?.split(/[\\/]/).at(-1) || "";
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

export function exactIdentityKey(hit: SearchHit) {
  const contentID = hit.content_id?.trim();
  return contentID && hit.logical_size != null ? JSON.stringify([contentID, hit.logical_size]) : "";
}

export function dedupFacetValue(hit: SearchHit, identityCounts: Map<string, number>) {
  const key = exactIdentityKey(hit);
  if (!key) return "";
  return (identityCounts.get(key) ?? 0) > 1 ? "DUPLICATE" : "UNIQUE";
}

// The library listing already contains the complete publication set, so the
// whole ordering happens here instead of asking the daemon for a sort. Unknown
// logical sizes (folders, unmeasured entries) sort after every known size in
// both directions, and equal keys fall back to the locale-aware name order so
// the rendered order is deterministic.
export function sortableName(hit: SearchHit) { return hit.name?.trim() || hit.path?.split(/[\\/]/).at(-1)?.trim() || ""; }
export function sortableSize(hit: SearchHit) { return typeof hit.logical_size === "number" && Number.isSafeInteger(hit.logical_size) && hit.logical_size >= 0 ? hit.logical_size : null; }

export function sortLibraryHits(hits: SearchHit[], field: SortField, direction: SortDirection, locale: Locale) {
  const collator = (left: string, right: string) => left.localeCompare(right, locale, { numeric: true, sensitivity: "base" });
  const comparePrimary = (left: SearchHit, right: SearchHit) => {
    if (field === "size") {
      const leftSize = sortableSize(left);
      const rightSize = sortableSize(right);
      // Entries without a logical size stay last in both directions.
      if (leftSize === null || rightSize === null) return leftSize === rightSize ? 0 : leftSize === null ? 1 : -1;
      return leftSize === rightSize ? 0 : leftSize < rightSize ? -1 : 1;
    }
    const value = (hit: SearchHit) => field === "name" ? sortableName(hit) : field === "type" ? (hit.entry_type ?? "") : (hit.path?.trim() || sortableName(hit));
    return collator(value(left), value(right));
  };
  return [...hits].sort((left, right) => {
    if (field === "size") {
      const leftSize = sortableSize(left);
      const rightSize = sortableSize(right);
      // Keep unknown sizes at the end independently of the requested value
      // direction. Equal unknowns still use the same directional name tie-break.
      if (leftSize === null && rightSize !== null) return 1;
      if (rightSize === null && leftSize !== null) return -1;
    }
    const primary = comparePrimary(left, right);
    if (primary !== 0) return direction === "asc" ? primary : -primary;
    // Equal keys keep a deterministic, locale-aware name order that follows the
    // requested direction, so toggling it always visibly reorders the tiles.
    const byName = collator(sortableName(left), sortableName(right));
    return direction === "asc" ? byName : -byName;
  });
}

// Arrow Up/Down move by one visual row, and the grid is fluid: the rendered
// column count is measured from the tiles themselves rather than assumed. List
// mode renders one tile per row, so the same measurement returns one.
export function renderedColumnCount(container: HTMLElement | null) {
  if (!container) return 1;
  const tiles = Array.from(container.querySelectorAll<HTMLElement>("[data-result-index]"));
  if (tiles.length < 2) return 1;
  const firstRowTop = tiles[0].offsetTop;
  return Math.max(1, tiles.filter((tile) => tile.offsetTop === firstRowTop).length);
}

export function formatSourceKind(value: string | undefined, t: Translator) { return t(value === "LOCAL_TREE" ? "Local folder" : value || "Source"); }
export function formatSourceState(value: string | undefined, t: Translator) {
  const labels: Record<string, string> = { ACTIVE: "Active", DECOMMISSIONED: "Decommissioned", LOST: "Lost", QUARANTINED: "Quarantined", PLANNED: "Planned" };
  return t(labels[value ?? ""] ?? "Not recorded");
}
export function formatReachability(value: string | undefined, t: Translator) { return t(value === "AVAILABLE" ? "Available now" : value === "UNAVAILABLE" ? "Not reachable now" : "Access unknown"); }
export function formatReachabilityMessage(value: string, t: Translator) {
  const known: Record<string, string> = {
    "source path is not accessible": "Source path is not accessible.",
    "source path is not a directory": "Source path is not a directory.",
  };
  return t(known[value] ?? "Source access could not be checked.");
}
export function formatScanState(value: string | undefined, t: Translator) {
  const labels: Record<string, string> = { PLANNED: "Scan planned", RUNNING: "Scan in progress", COMPLETE: "Scan complete", INCOMPLETE: "Scan incomplete", FAILED: "Scan failed", CANCELLED: "Scan cancelled" };
  return t(labels[value ?? ""] ?? "No scan recorded");
}

// Verification freshness. The age of a recorded verification receipt is
// computed from the daemon's own recorded time and from nothing else: a
// timestamp this browser cannot parse yields no age at all, so a caller that
// has no readable receipt time keeps its UNKNOWN wording instead of gaining an
// invented one. The age is presentation only; it is never a health claim and
// never a pass.
export const STALE_VERIFICATION_DAYS = 30;

export function recordedAgeMinutes(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const recorded = Date.parse(value);
  if (Number.isNaN(recorded)) return undefined;
  // A receipt the daemon stamped ahead of this browser's clock is still an
  // age of zero, never a negative one.
  return Math.max(0, Math.floor((Date.now() - recorded) / 60000));
}

// The one age fragment a receipt line may append. `verified` states the age of
// a passing record; `recorded` is the neutral form for a failed or unavailable
// outcome, whose record time is true but whose verification is not. A count of
// one uses the singular phrasing so the sentence stays readable. Every catalog
// key is handed to t() as a literal (never composed), so the i18n checker sees
// the whole vocabulary this helper can render.
export function verificationAgeLabel(t: Translator, minutes: number | undefined, verb: "verified" | "recorded"): string {
  if (minutes === undefined) return "";
  const verified = verb === "verified";
  if (minutes < 1) return verified ? t("verified just now") : t("recorded just now");
  if (minutes < 60) {
    if (minutes === 1) return verified ? t("verified a minute ago") : t("recorded a minute ago");
    return verified ? t("verified {{count}} minutes ago", { count: minutes }) : t("recorded {{count}} minutes ago", { count: minutes });
  }
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    if (hours === 1) return verified ? t("verified an hour ago") : t("recorded an hour ago");
    return verified ? t("verified {{count}} hours ago", { count: hours }) : t("recorded {{count}} hours ago", { count: hours });
  }
  const days = Math.floor(minutes / 1440);
  if (days === 1) return verified ? t("verified a day ago") : t("recorded a day ago");
  return verified ? t("verified {{count}} days ago", { count: days }) : t("recorded {{count}} days ago", { count: days });
}

export function verificationIsStale(minutes: number | undefined) {
  return minutes !== undefined && minutes > STALE_VERIFICATION_DAYS * 24 * 60;
}

// The most recent recorded, passing full-bytes receipt among the restore
// points a surface has read. Only that record dates the last full read of
// repository bytes: another mode's receipt says nothing about it, and a
// failed or unavailable outcome is not a verification. An empty result means
// no full-bytes read is recorded, so no age and no reminder may be claimed.
export function lastFullBytesVerification(snapshots: SnapshotSummary[]): SnapshotVerificationData | undefined {
  const passing = snapshots
    .map((summary) => summary.verification)
    .filter((receipt): receipt is SnapshotVerificationData => receipt?.state === "RECORDED"
      && (receipt.outcome === "SUCCEEDED" || receipt.ok === true)
      && (receipt.mode ?? "") === "full-bytes"
      && recordedAgeMinutes(receipt.verified_at) !== undefined);
  return passing.sort((left, right) => Date.parse(right.verified_at ?? "") - Date.parse(left.verified_at ?? ""))[0];
}

// A path root is labelled by its name, and only duplicate names are
// disambiguated by the shortest unique trailing path suffix.
export function sourceButtonLabel(root: BrowseRoot, roots: BrowseRoot[], t: Translator) {
  const name = root.name?.trim() || t("Source path");
  const duplicateRoots = roots.filter((other) => (other.name?.trim() || t("Source path")) === name);
  const duplicateName = duplicateRoots.length > 1;
  if (!duplicateName) return name;
  const path = root.source_path?.trim();
  if (!path) return `${name} · ${t("Source path")}`;
  const parts = path.split(/[\\/]+/).filter(Boolean);
  for (let depth = 2; depth <= parts.length; depth += 1) {
    const suffix = parts.slice(-depth).join("/");
    const matches = duplicateRoots.filter((other) => {
      const otherParts = other.source_path?.trim().split(/[\\/]+/).filter(Boolean) ?? [];
      return otherParts.slice(-depth).join("/") === suffix;
    });
    if (matches.length === 1) return suffix;
  }
  return path;
}

export function deriveSystemTags(hit: SearchHit) {
  const result: string[] = [];
  if (hit.entry_type) result.push(`type:${hit.entry_type.toLowerCase()}`);
  const name = hit.name || hit.path?.split("/").at(-1) || "";
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) result.push(`format:${name.slice(dot + 1).toLowerCase()}`);
  return result;
}

// A frozen manifest id stays fully available through the row title and
// aria-label; the visible form only shortens the stable-id payload.
export function shortManifestID(value: string | undefined) {
  const id = (value ?? "").trim();
  if (!id) return "—";
  return id.length > 24 ? `${id.slice(0, 22)}…` : id;
}

// Timeline browse: a browser-local month projection over the loaded listing.
// The daemon's `content.list` rows carry no modification time in this build
// (see ContentItemData in client/command/data.go), so this reader yields
// nothing for every row today and a strip over zero dated rows renders
// absent, never zero-filled. When the daemon starts projecting a per-row
// time, it is read here: epoch milliseconds (the unit of the daemon's own
// mtime search axis) or an RFC 3339 string (the daemon's JSON timestamp
// convention elsewhere).
export function rowModificationTime(item: SearchHit): number | undefined {
  const value = (item as { modified_at?: unknown }).modified_at;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

export function monthBucketKey(timeMs: number) {
  const date = new Date(timeMs);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function itemInMonth(item: SearchHit, month: string) {
  const time = rowModificationTime(item);
  return time !== undefined && monthBucketKey(time) === month;
}

// Ascending month buckets with a positive count; months with no loaded item
// are absent rather than zero-filled.
export function monthTimelineBuckets(items: SearchHit[]): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const time = rowModificationTime(item);
    if (time === undefined) continue;
    const key = monthBucketKey(time);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => ({ key, count })).sort((left, right) => left.key.localeCompare(right.key));
}

// Space report: a browser-local byte projection over the loaded listing. The
// total sums every row that carries a logical size; the largest entries are
// files (directories are excluded); media classes count only rows whose name
// suffix maps to a class, so unclassified rows are left out instead of being
// guessed into a bucket.
export type SpaceReportClass = "image" | "video" | "audio" | "document";
const MEDIA_CLASS_SUFFIXES: Record<SpaceReportClass, string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "heif", "avif", "tif", "tiff", "ico"],
  video: ["mp4", "mov", "mkv", "avi", "webm", "m4v", "mpg", "mpeg", "wmv", "flv", "ts", "3gp"],
  audio: ["mp3", "flac", "wav", "m4a", "aac", "ogg", "oga", "opus", "wma", "aiff", "aif"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "rtf", "csv", "epub"],
};
export function mediaClassFromSuffix(suffix: string): SpaceReportClass | "" {
  const normalized = suffix.trim().toLowerCase();
  for (const [className, suffixes] of Object.entries(MEDIA_CLASS_SUFFIXES) as Array<[SpaceReportClass, string[]]>) {
    if (suffixes.includes(normalized)) return className;
  }
  return "";
}
export type MediaBrowseClass = "image" | "audio";
// Media workspaces are browser projections over regular files in the loaded
// content listing. The suffix is a deterministic system facet, not proof of
// file contents and never a reason to create or rewrite durable facts.
export function mediaContentItems(items: SearchHit[], mediaClass: MediaBrowseClass): SearchHit[] {
  return items.filter((item) => item.entry_type === "REGULAR_FILE" && mediaClassFromSuffix(formatFacetValue(item)) === mediaClass);
}
export type SpaceReport = {
  totalBytes: number;
  sizedItems: number;
  top: Array<{ hit: SearchHit; size: number }>;
  classes: Array<{ class: SpaceReportClass; label: string; bytes: number; count: number }>;
};
export function spaceReportProjection(items: SearchHit[]): SpaceReport {
  let totalBytes = 0;
  let sizedItems = 0;
  const sized: Array<{ hit: SearchHit; size: number }> = [];
  const classes = new Map<SpaceReportClass, { bytes: number; count: number }>();
  for (const item of items) {
    const size = sortableSize(item);
    if (size === null) continue;
    totalBytes += size;
    sizedItems += 1;
    if (item.entry_type !== "DIRECTORY") {
      sized.push({ hit: item, size });
      const className = mediaClassFromSuffix(formatFacetValue(item));
      if (className) {
        const entry = classes.get(className) ?? { bytes: 0, count: 0 };
        entry.bytes += size;
        entry.count += 1;
        classes.set(className, entry);
      }
    }
  }
  const classLabels: Record<SpaceReportClass, string> = { image: "Images", video: "Videos", audio: "Audio", document: "Documents" };
  const orderedClasses: SpaceReportClass[] = ["image", "video", "audio", "document"];
  return {
    totalBytes,
    sizedItems,
    top: sized.sort((left, right) => right.size - left.size || sortableName(left.hit).localeCompare(sortableName(right.hit))).slice(0, 3),
    classes: orderedClasses.filter((className) => classes.has(className)).map((className) => ({ class: className, label: classLabels[className], bytes: classes.get(className)!.bytes, count: classes.get(className)!.count })),
  };
}
