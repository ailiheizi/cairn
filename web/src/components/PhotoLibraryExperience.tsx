import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon } from "lucide-react";
import type { DragEvent as ReactDragEvent, FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useClientBrowseValue } from "../app/ClientBrowseSession";
import { useBrowsePosition } from "../app/useBrowsePosition";
import { useResultWindow } from "./ResultWindow";
import { previewThumbKind } from "./ContentPreview";
import { PhotoCard } from "./photo/PhotoCard";
import { PhotoViewer } from "./photo/PhotoViewer";
import type { PhotoItem, PhotoLibraryExperienceProps } from "./photo/photoTypes";
import { photoCandidateMime } from "../lib/photoRendition";
import { matchesPhotoTimelinePeriod, parsePhotoTimelinePeriod, photoTimelineCalendarDate, photoTimelineMonthKey, photoTimelineParts, photoTimelinePeriodValue, type PhotoTimelineBucket } from "../lib/photoTimeline";
import { capturedModificationTimeMillis } from "../lib/capturedTime";
import { uniqueSubjectHits } from "../lib/subjectHits";
import type { SearchHit } from "../lib/types";
import { formatFacetValue, renderedColumnCount } from "../lib/format";
import "./PhotoLibraryExperience.css";

/**
 * A photo-first browser over the already loaded library projection.
 * Integration: render in place of ResultList for viewMode === "photos", pass
 * the same ResultList props and the existing onOpenHit details callback.
 * Indices passed to row/selection callbacks always refer to props.hits.
 *
 * The wall is windowed by the same shared result window as the library result
 * list (components/ResultWindow.tsx): the DOM holds the cards around the
 * viewport and the spacer keeps every card reachable. Positions handed to the
 * viewer and to the row callbacks are always positions in the filtered listing,
 * exactly as before.
 */
export type { PhotoLibraryExperienceProps } from "./photo/photoTypes";

type PhotoKeyboardFocus = { key: string; control: "image" | "name"; signature: string; resultsIdentity: string };
type PhotoSelectionAnchor = { subjectRef: string; workspaceID: string; signature: string; resultsIdentity: string };
const photoItemKey = (item: PhotoItem) => item.hit.subject_ref || item.hit.entry_id || item.hit.content_id || `row:${item.index}`;

// Swipe navigation thresholds. A release counts as a swipe only when the
// horizontal travel reaches this distance and dominates the vertical travel by
// this factor, so a vertical scroll or a short tap is never read as a photo
// change.
const SWIPE_MIN_DISTANCE_PX = 48;
const SWIPE_AXIS_RATIO = 1.6;

export function PhotoLibraryExperience(props: PhotoLibraryExperienceProps) {
  const { hits, command, locale, workspaceID, t, selectedRef, selectionRefs, selectionCount = selectionRefs.length, tagsBySubject, rovingRow, onRowClick, onToggleSelection, onOpenHit, focusedSubjectRef, onFocusSubject, onShowSelectionActions, onSelectSubjects, onImageSearch, onVisualTextSearch, imageSearchBusy = false, onDownloadOriginals, originalTakeoutBusy = false, libraryListRef, onKeyDown, loading = false, error = "", favoriteControls } = props;
  const photoTagStatus = favoriteControls?.status ?? "unavailable";
  const [format, setFormat] = useClientBrowseValue("photos", "format", "all");
  const [photoSortValue, setPhotoSort] = useClientBrowseValue<"library" | "filename" | "size" | "modified">("photos", "sort", "library");
  const [photoSortDirectionValue, setPhotoSortDirection] = useClientBrowseValue<"asc" | "desc">("photos", "sort-direction", "asc");
  const [density, setDensity] = useClientBrowseValue("photos", "density", 2);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewerScope, setViewerScope] = useState<"matches" | "selected">("matches");
  const [photoQuery, setPhotoQuery] = useClientBrowseValue("photos", "query", "");
  const [visualSearchDescription, setVisualSearchDescription] = useState("");
  const [searchScope, setSearchScope] = useClientBrowseValue<"visual" | "name-tags">("photos", "search-scope", onVisualTextSearch ? "visual" : "name-tags");
  const [selectedPhotoTags, setSelectedPhotoTags] = useClientBrowseValue<string[]>("photos", "tag-filter", []);
  const [onlySelectedPhotos, setOnlySelectedPhotos] = useClientBrowseValue<boolean>("photos", "selected-only", false);
  const [photoTimelineValue, setPhotoTimelineValue] = useClientBrowseValue("photos", "timeline-period", "all");
  const photoTimelinePeriod = useMemo(() => parsePhotoTimelinePeriod(photoTimelineValue), [photoTimelineValue]);
  const photoSort = photoSortValue === "filename" || photoSortValue === "size" || photoSortValue === "modified" ? photoSortValue : "library";
  const photoSortDirection = photoSortDirectionValue === "desc" ? "desc" : "asc";
  const [slideshowPlaying, setSlideshowPlaying] = useState(false);
  const [slideshowSeconds, setSlideshowSeconds] = useState(5);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [viewerPhotoKey, setViewerPhotoKey] = useState("");
  const viewerTitleRef = useRef<HTMLHeadingElement | null>(null);
  const viewerDialogRef = useRef<HTMLElement | null>(null);
  const viewerFullscreenOwnerRef = useRef<HTMLElement | null>(null);
  const [viewerFullscreen, setViewerFullscreen] = useState(false);
  const [viewerFullscreenMessage, setViewerFullscreenMessage] = useState("");
  const lastHostFocus = useRef("");
  const swipeRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  const swipeListenersRef = useRef<(() => void) | null>(null);
  const swipeHandledClick = useRef(false);
  const items = useMemo<PhotoItem[]>(() => hits.map((hit, index) => {
    const name = hit.name || hit.path?.split(/[\\/]/).at(-1) || "";
    const itemFormat = formatFacetValue(hit);
    const previewable = hit.entry_type !== "DIRECTORY" && previewThumbKind(name) === "image" &&
      (hit.logical_size == null || (Number.isSafeInteger(hit.logical_size) && hit.logical_size >= 0 && hit.logical_size <= 8 << 20));
    return { hit, index, format: itemFormat || "unknown", previewable };
  }).filter((item) => item.hit.entry_type !== "DIRECTORY"), [hits]);
  const formats = useMemo(() => [...new Set(items.map((item) => item.format))].sort(), [items]);
  const photoTagFacets = useMemo(() => {
    const seenSubjects = new Set<string>();
    const counts = new Map<string, number>();
    for (const item of items) {
      const subjectRef = item.hit.subject_ref?.trim() ?? "";
      if (!subjectRef || seenSubjects.has(subjectRef)) continue;
      seenSubjects.add(subjectRef);
      const subjectTags = new Set(tagsBySubject.get(subjectRef) ?? []);
      for (const value of subjectTags) {
        if (!value.trim()) continue;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    return [...counts].map(([value, count]) => ({ value, count }))
      .sort((left, right) => left.value.localeCompare(right.value, locale));
  }, [items, locale, tagsBySubject]);
  const photoTagOptions = useMemo(() => {
    const counts = new Map(photoTagFacets.map(({ value, count }) => [value, count]));
    for (const value of selectedPhotoTags) if (!counts.has(value)) counts.set(value, 0);
    return [...counts].map(([value, count]) => ({ value, count }))
      .sort((left, right) => left.value.localeCompare(right.value, locale));
  }, [locale, photoTagFacets, selectedPhotoTags]);
  const selectedSubjectRefs = useMemo(() => new Set(selectionRefs), [selectionRefs]);
  const matchingItems = useMemo(() => {
    const query = photoQuery.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (format !== "all" && item.format !== format) return false;
      const subjectRef = item.hit.subject_ref?.trim() ?? "";
      const tags = subjectRef ? tagsBySubject.get(subjectRef) ?? [] : [];
      if (selectedPhotoTags.length > 0 && !selectedPhotoTags.every((tag) => tags.includes(tag))) return false;
      if (onlySelectedPhotos && (!item.hit.subject_ref || !selectedSubjectRefs.has(item.hit.subject_ref))) return false;
      if (!query) return true;
      const name = item.hit.name || item.hit.path?.split(/[\\/]/).at(-1) || "";
      return `${name}\n${tags.join("\n")}`.toLocaleLowerCase().includes(query);
    });
  }, [format, items, onlySelectedPhotos, photoQuery, selectedPhotoTags, selectedSubjectRefs, tagsBySubject]);
  const photoTimelineFacets = useMemo(() => {
    const years = new Map<number, number>();
    const months = new Map<string, PhotoTimelineBucket>();
    let unknownCount = 0;
    for (const item of matchingItems) {
      const parts = photoTimelineParts(item.hit.modified_at);
      if (!parts) { unknownCount += 1; continue; }
      years.set(parts.year, (years.get(parts.year) ?? 0) + 1);
      const key = photoTimelineMonthKey(parts.year, parts.month);
      const bucket = months.get(key);
      months.set(key, { year: parts.year, month: parts.month, count: (bucket?.count ?? 0) + 1 });
    }
    return {
      years: [...years].map(([year, count]) => ({ year, count })).sort((left, right) => right.year - left.year),
      months: [...months.values()].sort((left, right) => right.year - left.year || right.month - left.month),
      unknownCount,
    };
  }, [matchingItems]);
  const selectedTimelineYear = photoTimelinePeriod.kind === "year" || photoTimelinePeriod.kind === "month" ? photoTimelinePeriod.year : undefined;
  const timelineYearOptions = useMemo(() => {
    const years = new Map(photoTimelineFacets.years.map(({ year, count }) => [year, count]));
    if (selectedTimelineYear !== undefined && !years.has(selectedTimelineYear)) years.set(selectedTimelineYear, 0);
    return [...years].map(([year, count]) => ({ year, count })).sort((left, right) => right.year - left.year);
  }, [photoTimelineFacets.years, selectedTimelineYear]);
  const timelineMonthOptions = useMemo(() => {
    if (selectedTimelineYear === undefined) return [];
    const months = new Map(photoTimelineFacets.months.filter((month) => month.year === selectedTimelineYear).map((month) => [month.month, month.count]));
    if (photoTimelinePeriod.kind === "month" && !months.has(photoTimelinePeriod.month)) months.set(photoTimelinePeriod.month, 0);
    return [...months].map(([month, count]) => ({ year: selectedTimelineYear, month, count })).sort((left, right) => right.month - left.month);
  }, [photoTimelineFacets.months, photoTimelinePeriod, selectedTimelineYear]);
  const timelineMonthNavigationOptions = useMemo(() => {
    const months = new Map(photoTimelineFacets.months.map((bucket) => [photoTimelineMonthKey(bucket.year, bucket.month), bucket]));
    if (photoTimelinePeriod.kind === "month") {
      const key = photoTimelineMonthKey(photoTimelinePeriod.year, photoTimelinePeriod.month);
      if (!months.has(key)) months.set(key, { year: photoTimelinePeriod.year, month: photoTimelinePeriod.month, count: 0 });
    }
    return [...months.values()].sort((left, right) => right.year - left.year || right.month - left.month);
  }, [photoTimelineFacets.months, photoTimelinePeriod]);
  const selectedTimelineYearIndex = selectedTimelineYear === undefined ? -1 : timelineYearOptions.findIndex(({ year }) => year === selectedTimelineYear);
  const selectedTimelineMonthIndex = photoTimelinePeriod.kind === "month"
    ? timelineMonthNavigationOptions.findIndex(({ year, month }) => year === photoTimelinePeriod.year && month === photoTimelinePeriod.month)
    : -1;
  const periodItems = useMemo(() => matchingItems.filter((item) => matchesPhotoTimelinePeriod(item.hit.modified_at, photoTimelinePeriod)), [matchingItems, photoTimelinePeriod]);
  const photoTimelineLabel = photoTimelinePeriod.kind === "all"
    ? t("All loaded dates")
    : photoTimelinePeriod.kind === "unknown"
      ? t("Unknown date")
      : photoTimelinePeriod.kind === "year"
        ? t("Year {{year}}", { year: photoTimelinePeriod.year })
        : new Intl.DateTimeFormat(locale || undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(photoTimelineCalendarDate(photoTimelinePeriod.year, photoTimelinePeriod.month));
  const visibleItems = useMemo(() => {
    if (photoSort === "library") return periodItems;
    const ordered = [...periodItems];
    if (photoSort === "filename") {
      const collator = new Intl.Collator(locale || undefined, { numeric: true, sensitivity: "base" });
      ordered.sort((left, right) => {
        const leftName = left.hit.name || left.hit.path?.split(/[\\/]/).at(-1) || "";
        const rightName = right.hit.name || right.hit.path?.split(/[\\/]/).at(-1) || "";
        const comparison = collator.compare(leftName, rightName);
        if (comparison === 0) return left.index - right.index;
        return photoSortDirection === "desc" ? -comparison : comparison;
      });
      return ordered;
    }
    if (photoSort === "modified") {
      ordered.sort((left, right) => {
        const leftTime = capturedModificationTimeMillis(left.hit.modified_at);
        const rightTime = capturedModificationTimeMillis(right.hit.modified_at);
        if (leftTime === undefined || rightTime === undefined) {
          if (leftTime !== rightTime) return leftTime === undefined ? 1 : -1;
          return left.index - right.index;
        }
        const comparison = leftTime - rightTime;
        if (comparison === 0) return left.index - right.index;
        return photoSortDirection === "desc" ? -comparison : comparison;
      });
      return ordered;
    }
    ordered.sort((left, right) => {
      const leftSize = left.hit.logical_size;
      const rightSize = right.hit.logical_size;
      const leftKnown = Number.isSafeInteger(leftSize) && leftSize! >= 0;
      const rightKnown = Number.isSafeInteger(rightSize) && rightSize! >= 0;
      if (!leftKnown || !rightKnown) {
        if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
        return left.index - right.index;
      }
      const comparison = leftSize! - rightSize!;
      if (comparison === 0) return left.index - right.index;
      return photoSortDirection === "desc" ? -comparison : comparison;
    });
    return ordered;
  }, [locale, periodItems, photoSort, photoSortDirection]);
  const matchingSubjects = useMemo(() => uniqueSubjectHits(visibleItems.map(({ hit }) => hit)), [visibleItems]);
  const selectedMatchingSubjects = useMemo(() => matchingSubjects.filter((hit) => Boolean(hit.subject_ref && selectionRefs.includes(hit.subject_ref))), [matchingSubjects, selectionRefs]);
  const selectedPhotoItems = useMemo(() => {
    const remaining = new Set(selectedMatchingSubjects.map((hit) => hit.subject_ref).filter((value): value is string => Boolean(value)));
    return visibleItems.filter((item) => {
      const subjectRef = item.hit.subject_ref;
      if (!subjectRef || !remaining.has(subjectRef)) return false;
      remaining.delete(subjectRef);
      return true;
    });
  }, [selectedMatchingSubjects, visibleItems]);
  const viewerItems = viewerScope === "selected" ? selectedPhotoItems : visibleItems;
  const selectedOutsidePhotoMatches = Math.max(0, selectionRefs.length - selectedMatchingSubjects.length);
  const activeFormatLabel = format === "all" ? t("All formats") : format === "unknown" ? t("Unknown format") : format.toUpperCase();
  const activePhotoFilters = [
    activeFormatLabel,
    selectedPhotoTags.length > 0 ? t("{{count}} exact tags", { count: selectedPhotoTags.length }) : "",
    onlySelectedPhotos ? t("Selected photos only") : "",
    photoQuery.trim() ? t("Name or tag search") : "",
    photoTimelinePeriod.kind !== "all" ? photoTimelineLabel : "",
  ].filter(Boolean).join(" · ");
  const hasLocalPhotoFilters = format !== "all" || selectedPhotoTags.length > 0 || onlySelectedPhotos || Boolean(photoQuery.trim()) || photoTimelinePeriod.kind !== "all";
  const activeFilterCount = Number(format !== "all") + selectedPhotoTags.length + Number(onlySelectedPhotos) + Number(Boolean(photoQuery.trim())) + Number(photoTimelinePeriod.kind !== "all");
  const photoTagAvailabilityMessage = photoTagStatus === "loading"
    ? selectedPhotoTags.length > 0 ? t("Tag records are loading; selected exact-tag filters remain active.") : t("Tag records are loading. Exact-tag choices are temporarily disabled.")
    : photoTagStatus === "unavailable"
      ? selectedPhotoTags.length > 0 ? t("Tag records are unavailable; selected exact-tag filters remain active over the last-known records.") : t("Tag records are unavailable. Exact-tag choices are disabled.")
      : "";
  const photoEmptyMessage = items.length === 0
    ? t("No photos in the loaded listing")
    : onlySelectedPhotos && selectedMatchingSubjects.length === 0
      ? selectedPhotoTags.length > 0 || photoQuery.trim() || format !== "all"
        ? t("No selected photos match all current filters")
        : t("No selected photos in the current loaded scope")
      : selectedPhotoTags.length > 0 && (photoQuery.trim() || format !== "all" || onlySelectedPhotos)
        ? t("No photos match all current filters")
        : selectedPhotoTags.length > 0
          ? t("No loaded photos have all selected tags")
          : photoQuery.trim()
            ? t("No photos match this search")
            : format !== "all"
              ? t("No items match this format")
              : t("No photos match all current filters");
  const activeSortLabel = photoSort === "library" ? t("Library order") : photoSort === "filename" ? t("Filename") : photoSort === "modified" ? t("Recorded modification time") : t("Known file size");
  const activeSortDirectionLabel = photoSortDirection === "desc" ? t("Descending") : t("Ascending");
  const wall = useResultWindow({ containerRef: libraryListRef, count: visibleItems.length, onNeedMore: props.onLoadMore });
  const mountedItems = useMemo(() => {
    const rendered: Array<{ item?: PhotoItem; position: number }> = [];
    for (let position = wall.startIndex; position < wall.endIndex; position += 1) {
      rendered.push({ item: visibleItems[position], position });
    }
    return rendered;
  }, [visibleItems, wall.startIndex, wall.endIndex]);
  const photoPositionSignature = useMemo(() => JSON.stringify([props.sortField, props.sortDirection, format, photoQuery, selectedPhotoTags, onlySelectedPhotos, photoSort, photoSortDirection, photoTimelinePeriodValue(photoTimelinePeriod)]), [format, onlySelectedPhotos, photoQuery, photoSort, photoSortDirection, photoTimelinePeriod, props.sortDirection, props.sortField, selectedPhotoTags]);
  useBrowsePosition({
    slotKey: "photos:wall",
    signature: photoPositionSignature,
    containerRef: libraryListRef,
    ready: wall.measured,
    restoreKey: `${wall.startIndex}:${wall.endIndex}:${wall.measured}:${visibleItems.length}`,
    anchorSelector: ".photo-card[data-subject-ref]",
    onUnresolved: (bookmark) => {
      const position = visibleItems.findIndex((item) => photoItemKey(item) === bookmark.anchor);
      if (position < 0) return false;
      if (position < wall.startIndex || position >= wall.endIndex) wall.revealIndex(position);
      return true;
    },
  });
  const pendingFocusRef = useRef("");
  const pendingReturnIndexRef = useRef<number | null>(null);
  const [pendingKeyboardFocus, setPendingKeyboardFocus] = useState<PhotoKeyboardFocus | null>(null);
  const localKeyboardFocusRef = useRef<{ key: string; control: "image" | "name" } | null>(null);
  const photoSelectionAnchorRef = useRef<PhotoSelectionAnchor | null>(null);
  const activeViewerIndex = viewerIndex == null ? -1 : viewerItems.findIndex((item) => photoItemKey(item) === viewerPhotoKey);
  const current = activeViewerIndex < 0 ? undefined : viewerItems[activeViewerIndex];
  const viewerOpen = viewerIndex !== null && Boolean(current);
  const nextItem = activeViewerIndex < 0 ? undefined : viewerItems[activeViewerIndex + 1];
  const filmstripStart = Math.max(0, Math.min(activeViewerIndex - 2, viewerItems.length - 5));
  const nearbyViewerItems = viewerItems.slice(filmstripStart, Math.min(viewerItems.length, filmstripStart + 5));
  const slideshowItemSupported = useCallback((item: PhotoItem | undefined) => {
    if (!workspaceID || !item || item.hit.entry_type !== "REGULAR_FILE" || !(item.hit.entry_id || item.hit.subject_ref) || !/^sha256:[a-f0-9]{64}$/.test(item.hit.content_id ?? "")) return false;
    const name = item.hit.name || item.hit.path?.split(/[\\/]/).at(-1) || "";
    const size = item.hit.logical_size;
    return Boolean(item.previewable && photoCandidateMime(name) && Number.isSafeInteger(size) && size! >= 0 && size! <= 8 << 20);
  }, [workspaceID]);
  const moveViewer = useCallback((position: number) => {
    const bounded = Math.max(0, Math.min(viewerItems.length - 1, position));
    const item = viewerItems[bounded];
    if (!item) return;
    setViewerPhotoKey(photoItemKey(item));
    setViewerIndex(bounded);
  }, [viewerItems]);
  const currentSelected = Boolean(current?.hit.subject_ref && selectionRefs.includes(current.hit.subject_ref));
  const resultsIdentity = useMemo(() => JSON.stringify([workspaceID, hits.map((hit) => [hit.subject_ref ?? "", hit.entry_id ?? "", hit.content_id ?? "", hit.logical_size ?? null, hit.path ?? "", hit.name ?? "", hit.entry_type ?? ""])]), [hits, workspaceID]);
  const previousResultsIdentity = useRef(resultsIdentity);

  useEffect(() => {
    if (!viewerOpen) return undefined;
    const dialog = viewerDialogRef.current;
    if (!dialog) return undefined;
    const syncFullscreen = () => {
      const active = document.fullscreenElement === dialog;
      setViewerFullscreen(active);
      if (active) setViewerFullscreenMessage("");
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    syncFullscreen();
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      if (viewerFullscreenOwnerRef.current === dialog && document.fullscreenElement === dialog) {
        viewerFullscreenOwnerRef.current = null;
        if (typeof document.exitFullscreen === "function") void document.exitFullscreen().catch(() => undefined);
      } else if (viewerFullscreenOwnerRef.current === dialog) {
        viewerFullscreenOwnerRef.current = null;
      }
    };
  }, [viewerOpen]);

  useEffect(() => {
    const anchor = photoSelectionAnchorRef.current;
    if (!anchor) return;
    if (anchor.workspaceID !== workspaceID || anchor.signature !== photoPositionSignature || anchor.resultsIdentity !== resultsIdentity ||
      selectionRefs.length === 0 || !visibleItems.some((item) => item.hit.subject_ref === anchor.subjectRef)) {
      photoSelectionAnchorRef.current = null;
    }
  }, [photoPositionSignature, resultsIdentity, selectionRefs, visibleItems, workspaceID]);

  function setPhotoSelectionAnchor(hit: SearchHit) {
    const subjectRef = hit.subject_ref?.trim() ?? "";
    photoSelectionAnchorRef.current = subjectRef
      ? { subjectRef, workspaceID, signature: photoPositionSignature, resultsIdentity }
      : null;
  }

  function addDisplayedPhotoRange(item: PhotoItem) {
    const subjectRef = item.hit.subject_ref?.trim() ?? "";
    if (!subjectRef) return;
    if (!onSelectSubjects) {
      toggleDisplayedPhotoSelection(item);
      return;
    }
    const targetPosition = visibleItems.findIndex((candidate) => candidate.hit.subject_ref === subjectRef);
    if (targetPosition < 0) return;
    const anchor = photoSelectionAnchorRef.current;
    const usableAnchor = anchor && anchor.workspaceID === workspaceID && anchor.signature === photoPositionSignature && anchor.resultsIdentity === resultsIdentity
      ? visibleItems.findIndex((candidate) => candidate.hit.subject_ref === anchor.subjectRef)
      : -1;
    const first = usableAnchor < 0 ? targetPosition : Math.min(usableAnchor, targetPosition);
    const last = usableAnchor < 0 ? targetPosition : Math.max(usableAnchor, targetPosition);
    const subjects = uniqueSubjectHits(visibleItems.slice(first, last + 1).map((candidate) => candidate.hit));
    if (subjects.length > 0) onSelectSubjects(subjects, "add");
    if (usableAnchor < 0) setPhotoSelectionAnchor(item.hit);
  }

  function toggleDisplayedPhotoSelection(item: PhotoItem) {
    setPhotoSelectionAnchor(item.hit);
    onToggleSelection(item.index);
  }

  useEffect(() => {
    const subjectRef = focusedSubjectRef?.trim();
    if (!subjectRef || subjectRef === lastHostFocus.current) return;
    lastHostFocus.current = subjectRef;
    pendingFocusRef.current = subjectRef;
  }, [focusedSubjectRef]);

  // Focus follows the App-owned subject once its card is mounted. A subject
  // outside the window is revealed first, so a focus carried across
  // presentations still lands on the real card instead of a missing element.
  useEffect(() => {
    // Keep the return target pending until the viewer has actually unmounted.
    // Focusing the wall while the modal is still present leaves focus on BODY
    // when the dialog is removed, especially after navigating inside it.
    if (viewerIndex !== null) return;
    const subjectRef = pendingFocusRef.current;
    const originalIndex = pendingReturnIndexRef.current;
    if (!subjectRef && originalIndex == null) return;
    const position = visibleItems.findIndex((item) => subjectRef ? item.hit.subject_ref === subjectRef : item.index === originalIndex);
    if (position < 0) {
      pendingFocusRef.current = "";
      pendingReturnIndexRef.current = null;
      searchInputRef.current?.focus();
      return;
    }
    if (position < wall.startIndex || position >= wall.endIndex) { wall.revealIndex(position); return; }
    const item = visibleItems[position];
    const localFocus = localKeyboardFocusRef.current;
    const preferredControl = localFocus?.key === photoItemKey(item) ? localFocus.control : undefined;
    const card = libraryListRef.current?.querySelector<HTMLElement>(`[data-original-index="${item.index}"]`);
    const preferredTarget = preferredControl
      ? card?.querySelector<HTMLElement>(preferredControl === "image" ? ".photo-card__image" : ".photo-card__name")
      : null;
    const target = preferredTarget ?? (item.hit.subject_ref
      ? Array.from(libraryListRef.current?.querySelectorAll<HTMLElement>("[data-subject-ref] a, [data-subject-ref] button") ?? [])
        .find((node) => node.closest("[data-subject-ref]")?.getAttribute("data-subject-ref") === item.hit.subject_ref)
      : card?.querySelector<HTMLElement>(".photo-card__name"));
    if (!target) return;
    pendingFocusRef.current = "";
    pendingReturnIndexRef.current = null;
    target.focus({ preventScroll: true });
  }, [libraryListRef, mountedItems, viewerIndex, visibleItems, wall.endIndex, wall.measured, wall.revealIndex, wall.startIndex]);

  // Local keyboard moves target positions in the filtered/sorted photo wall,
  // while each card keeps its original host index for shared actions. A target
  // outside the mounted window is revealed before its main control receives
  // focus.
  useEffect(() => {
    if (!pendingKeyboardFocus) return;
    if (pendingKeyboardFocus.signature !== photoPositionSignature || pendingKeyboardFocus.resultsIdentity !== resultsIdentity) { setPendingKeyboardFocus(null); return; }
    const position = visibleItems.findIndex((item) => photoItemKey(item) === pendingKeyboardFocus.key);
    if (position < 0) { setPendingKeyboardFocus(null); return; }
    if (position < wall.startIndex || position >= wall.endIndex) { wall.revealIndex(position); return; }
    const item = visibleItems[position];
    const card = libraryListRef.current?.querySelector<HTMLElement>(`[data-original-index="${item.index}"]`);
    const target = card?.querySelector<HTMLElement>(pendingKeyboardFocus.control === "image" ? ".photo-card__image" : ".photo-card__name");
    if (!target) return;
    target.focus({ preventScroll: true });
    setPendingKeyboardFocus(null);
  }, [libraryListRef, pendingKeyboardFocus, photoPositionSignature, resultsIdentity, visibleItems, wall.endIndex, wall.revealIndex, wall.startIndex]);

  useEffect(() => {
    if (previousResultsIdentity.current !== resultsIdentity) {
      previousResultsIdentity.current = resultsIdentity;
      if (viewerIndex !== null) {
        closeViewer(true);
      }
    }
  }, [resultsIdentity, viewerIndex]);

  // Search, format, tag or host-result changes keep the same photo selected by
  // stable identity. If it leaves the visible scope, close rather than letting
  // the old numeric index silently point at a different file.
  useEffect(() => {
    if (viewerIndex === null) return;
    const photoKey = viewerPhotoKey;
    const position = viewerItems.findIndex((item) => photoItemKey(item) === photoKey);
    if (!viewerItems.length) { setSlideshowPlaying(false); closeViewer(); return; }
    if (!photoKey || position < 0) {
      setSlideshowPlaying(false);
      const stillInMatches = visibleItems.some((item) => photoItemKey(item) === photoKey);
      if (viewerScope === "selected" && stillInMatches && viewerItems.length) moveViewer(0);
      else closeViewer();
      return;
    }
    if (position !== viewerIndex) setViewerIndex(position);
  }, [moveViewer, viewerIndex, viewerItems, viewerPhotoKey, viewerScope, visibleItems]);

  // The roving index is an index into props.hits; the window counts positions
  // in the filtered listing. A roving index outside the mounted window is
  // revealed first and focused once mounted, so arrow keys, Home and End reach
  // every card on the wall, not only the mounted ones.
  const focusWasInWall = useRef(false);
  const rovingPosition = useMemo(() => visibleItems.findIndex((item) => item.index === rovingRow), [rovingRow, visibleItems]);
  useEffect(() => {
    const container = libraryListRef.current;
    if (pendingKeyboardFocus?.signature === photoPositionSignature && pendingKeyboardFocus.resultsIdentity === resultsIdentity) { focusWasInWall.current = false; return; }
    const localFocus = localKeyboardFocusRef.current;
    const activeMain = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>(".photo-card__image, .photo-card__name") : null;
    const activeIndex = Number(activeMain?.closest<HTMLElement>(".photo-card")?.dataset.originalIndex ?? "-1");
    const activeItem = visibleItems.find((item) => item.index === activeIndex);
    if (localFocus && activeMain && activeItem && photoItemKey(activeItem) === localFocus.key) { focusWasInWall.current = false; return; }
    if (!container || container.querySelector(`[data-result-index="${rovingRow}"]`)) return;
    focusWasInWall.current = container.contains(document.activeElement);
    if (rovingPosition >= 0) wall.revealIndex(rovingPosition);
  }, [libraryListRef, pendingKeyboardFocus, photoPositionSignature, resultsIdentity, rovingPosition, rovingRow, visibleItems, wall.revealIndex]);
  useEffect(() => {
    const container = libraryListRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-result-index="${rovingRow}"] .result-open-copy`);
    if (!target || document.activeElement === target) { focusWasInWall.current = false; return; }
    if (!focusWasInWall.current) return;
    focusWasInWall.current = false;
    target.focus({ preventScroll: true });
  }, [libraryListRef, rovingRow, wall.endIndex, wall.startIndex]);

  useEffect(() => {
    if (!current) return undefined;
    viewerTitleRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      const dialog = viewerDialogRef.current;
      if (!dialog) return;
      const nestedViewer = document.querySelector<HTMLElement>('.cairn-image-viewer[role="dialog"]');
      const focusInsideNestedViewer = Boolean(nestedViewer && nestedViewer.contains(document.activeElement));
      if (event.key === "Escape") {
        // Let the browser's first Escape leave fullscreen. The following
        // Escape closes this viewer through the existing focus-return path.
        if (document.fullscreenElement === dialog) return;
        if (focusInsideNestedViewer) return;
        event.preventDefault(); event.stopPropagation(); closeViewer(); return;
      }
      if (event.key === "Tab") {
        if (focusInsideNestedViewer) return;
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((node) => node.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && (activeIndex <= 0 || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (activeIndex === -1 || activeIndex === focusable.length - 1 || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        return;
      }
      if (focusInsideNestedViewer) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (target?.closest(".cairn-image-viewer__controls") && (event.key === "ArrowLeft" || event.key === "ArrowRight")) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); if (viewerIndex !== null) moveViewer(Math.max(0, activeViewerIndex - 1)); }
      else if (event.key === "ArrowRight") { event.preventDefault(); if (viewerIndex !== null) moveViewer(Math.min(viewerItems.length - 1, activeViewerIndex + 1)); }
      else if (event.key === "Home") { event.preventDefault(); if (viewerIndex !== null) moveViewer(0); }
      else if (event.key === "End") { event.preventDefault(); if (viewerIndex !== null) moveViewer(viewerItems.length - 1); }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [activeViewerIndex, current?.hit, moveViewer, viewerItems.length, viewerIndex]);

  // Automatic advancement is deliberately stricter than manual navigation:
  // it requires the current image to have decoded and the next loaded result to
  // be a known-size supported image. The timer never asks the wall for more rows.
  useEffect(() => {
    if (!slideshowPlaying || !current) return undefined;
    const stopIfHidden = () => {
      if (document.visibilityState !== "visible") setSlideshowPlaying(false);
    };
    document.addEventListener("visibilitychange", stopIfHidden);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") { setSlideshowPlaying(false); return; }
      const image = viewerDialogRef.current?.querySelector<HTMLImageElement>(".photo-viewer__body img");
      if (!image?.complete || image.naturalWidth <= 0 || !slideshowItemSupported(current)) {
        setSlideshowPlaying(false);
        return;
      }
      if (!nextItem || !slideshowItemSupported(nextItem)) {
        setSlideshowPlaying(false);
        return;
      }
      const destination = Math.min(viewerItems.length - 1, activeViewerIndex + 1);
      if (destination === viewerItems.length - 1) setSlideshowPlaying(false);
      moveViewer(destination);
    }, slideshowSeconds * 1000);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", stopIfHidden);
    };
  }, [activeViewerIndex, current, moveViewer, nextItem, slideshowItemSupported, slideshowPlaying, slideshowSeconds, viewerIndex, viewerItems.length]);

  useEffect(() => {
    if (!current) setSlideshowPlaying(false);
  }, [current]);

  // A swipe in progress owns two temporary window listeners. The viewer can
  // close or change identity mid-gesture, so the effect detaches them again.
  useEffect(() => () => stopSwipeTracking(), [current?.hit, viewerItems.length]);

  function openViewer(position: number) {
    setSlideshowPlaying(false);
    setViewerFullscreenMessage("");
    setViewerScope("matches");
    const item = visibleItems[position];
    if (!item) return;
    setViewerPhotoKey(photoItemKey(item));
    setViewerIndex(position);
  }
  function openSelectedViewer() {
    const first = selectedPhotoItems[0];
    if (!first) return;
    setSlideshowPlaying(false);
    setViewerFullscreenMessage("");
    setViewerScope("selected");
    setViewerPhotoKey(photoItemKey(first));
    setViewerIndex(0);
  }
  function changeViewerScope(scope: "matches" | "selected") {
    if (scope === viewerScope) return;
    const nextItems = scope === "selected" ? selectedPhotoItems : visibleItems;
    if (!nextItems.length) return;
    setSlideshowPlaying(false);
    const currentKey = viewerPhotoKey;
    const position = nextItems.findIndex((item) => photoItemKey(item) === currentKey);
    const nextPosition = position >= 0 ? position : 0;
    setViewerPhotoKey(photoItemKey(nextItems[nextPosition]));
    setViewerScope(scope);
    setViewerIndex(nextPosition);
  }
  function closeViewer(restoreFocus = true) {
    const photoKey = viewerPhotoKey;
    setSlideshowPlaying(false);
    setViewerIndex(null);
    setViewerScope("matches");
    setViewerPhotoKey("");
    if (!restoreFocus) return;
    const item = visibleItems.find((candidate) => photoItemKey(candidate) === photoKey);
    // A filtered-out subject uses an impossible index so the pending-focus
    // effect falls back to the search field after the viewer has unmounted.
    pendingReturnIndexRef.current = item?.index ?? -1;
    pendingFocusRef.current = item?.hit.subject_ref ?? "";
  }
  async function toggleViewerFullscreen() {
    const dialog = viewerDialogRef.current;
    if (!dialog || typeof dialog.requestFullscreen !== "function" || typeof document.exitFullscreen !== "function" || document.fullscreenEnabled === false) {
      setViewerFullscreenMessage(t("Fullscreen is unavailable in this browser."));
      return;
    }
    if (document.fullscreenElement === dialog) {
      viewerFullscreenOwnerRef.current = dialog;
      try {
        await document.exitFullscreen();
      } catch {
        setViewerFullscreenMessage(t("Fullscreen could not be changed. Use the browser controls to exit fullscreen."));
      }
      return;
    }
    if (document.fullscreenElement && document.fullscreenElement !== dialog) {
      setViewerFullscreenMessage(t("Another element is already using fullscreen."));
      return;
    }
    setViewerFullscreenMessage("");
    viewerFullscreenOwnerRef.current = dialog;
    try {
      await dialog.requestFullscreen();
    } catch {
      if (viewerFullscreenOwnerRef.current === dialog) viewerFullscreenOwnerRef.current = null;
      if (viewerDialogRef.current === dialog) {
        setViewerFullscreen(false);
        setViewerFullscreenMessage(t("Fullscreen could not be started. Check browser permissions and try again."));
      }
    }
  }
  function stopSwipeTracking() {
    swipeListenersRef.current?.();
    swipeListenersRef.current = null;
    swipeRef.current = null;
  }
  // The release is measured on window so a drag that ends outside the media
  // surface still resolves; nothing commits until the pointer is released.
  function trackSwipe(pointerId: number) {
    const onRelease = (event: PointerEvent) => {
      const gesture = swipeRef.current;
      if (!gesture || gesture.pointerId !== pointerId) return;
      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;
      stopSwipeTracking();
      if (event.type === "pointercancel") return;
      if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE_PX || Math.abs(deltaX) < Math.abs(deltaY) * SWIPE_AXIS_RATIO) return;
      // Swipe left advances, swipe right goes back, clamped exactly like the
      // arrow keys. The click a drag would otherwise leave behind is consumed.
      swipeHandledClick.current = true;
      if (viewerIndex !== null) moveViewer(deltaX < 0 ? Math.min(viewerItems.length - 1, activeViewerIndex + 1) : Math.max(0, activeViewerIndex - 1));
    };
    window.addEventListener("pointerup", onRelease);
    window.addEventListener("pointercancel", onRelease);
    swipeListenersRef.current = () => {
      window.removeEventListener("pointerup", onRelease);
      window.removeEventListener("pointercancel", onRelease);
    };
  }
  function beginSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    swipeHandledClick.current = false;
    stopSwipeTracking();
    if (event.button !== 0 || !event.isPrimary || viewerItems.length < 2) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const imageViewer = target.closest<HTMLElement>(".cairn-image-viewer");
    if (imageViewer) {
      const stage = target.closest(".cairn-image-viewer__stage");
      const scale = Number(imageViewer.dataset.zoomCurrent);
      const fitScale = Number(imageViewer.dataset.fitZoom);
      // Keep the existing fit-scale swipe affordance, but never let it claim a
      // zoomed image pan. The image stage owns zoomed pointer gestures.
      if (!stage || !Number.isFinite(scale) || !Number.isFinite(fitScale) || scale > fitScale + 0.000001) return;
    }
    const control = target.closest('button, a[href], input, select, textarea, [contenteditable="true"]');
    // The preview image is wrapped in a button, but it is the media surface
    // itself; every other control keeps its own tap/click behaviour.
    if (control && !control.classList.contains("cairn-content-preview__image-button")) return;
    swipeRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
    trackSwipe(event.pointerId);
  }
  function consumeSwipeClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!swipeHandledClick.current) {
      if (event.target instanceof Element && event.target.closest(".cairn-content-preview__image-button, .cairn-content-preview__viewer-button, .cairn-image-viewer__stage, .cairn-image-viewer__controls")) setSlideshowPlaying(false);
      return;
    }
    swipeHandledClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }
  // Browsers that ignore -webkit-user-drag would otherwise turn a mouse drag on
  // the picture into a native image drag and never deliver the pointer release.
  function blockMediaDrag(event: ReactDragEvent<HTMLDivElement>) {
    if (swipeRef.current) event.preventDefault();
  }
  function handlePhotoWallKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (event.key === "Escape") { onKeyDown?.(event); return; }
    const editable = target?.closest("textarea, select, [contenteditable=\"true\"], input:not([type=\"checkbox\"]):not([type=\"radio\"])");
    if (editable) {
      // Keep select-all local to the photo matches instead of letting the host
      // apply it to the broader listing; editable controls retain their own
      // text-selection behavior.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "a") event.stopPropagation();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      event.stopPropagation();
      onSelectSubjects?.(matchingSubjects, "add");
      return;
    }
    const mainControl = target?.closest<HTMLButtonElement>(".photo-card__image, .photo-card__name");
    const card = mainControl?.closest<HTMLElement>(".photo-card");
    const originalIndex = Number(card?.dataset.originalIndex ?? "-1");
    const currentPosition = mainControl && Number.isInteger(originalIndex)
      ? visibleItems.findIndex((item) => item.index === originalIndex)
      : -1;
    if (mainControl && card && currentPosition >= 0) {
      const item = visibleItems[currentPosition];
      const control = mainControl.classList.contains("photo-card__image") ? "image" : "name";
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        const last = visibleItems.length - 1;
        const columns = renderedColumnCount(libraryListRef.current);
        const nextPosition = event.key === "Home" ? 0 : event.key === "End" ? last
          : Math.max(0, Math.min(last, currentPosition + (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -columns : columns)));
        const next = visibleItems[nextPosition];
        event.preventDefault();
        event.stopPropagation();
        if (next) {
          wall.revealIndex(nextPosition);
          setPendingKeyboardFocus({ key: photoItemKey(next), control, signature: photoPositionSignature, resultsIdentity });
        }
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) {
          if (event.shiftKey) addDisplayedPhotoRange(item);
          else toggleDisplayedPhotoSelection(item);
        }
        return;
      }
      // Leave native button activation intact: Enter opens this photo through
      // the same existing button click path, without host row-key handling.
      if (event.key === "Enter") { event.stopPropagation(); return; }
    } else if (target?.closest("button, a, input, textarea, select, [contenteditable=\"true\"]")) {
      // Nested card actions and checkboxes own their native activation. Keep
      // their arrows and Space/Enter from reaching the host's unsorted row
      // navigation handler.
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", " ", "Enter"].includes(event.key)) event.stopPropagation();
      return;
    }
    onKeyDown?.(event);
  }
  function handlePhotoWallFocusCapture(event: ReactFocusEvent<HTMLDivElement>) {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".photo-card__image, .photo-card__name") : null;
    const card = target?.closest<HTMLElement>(".photo-card");
    const originalIndex = Number(card?.dataset.originalIndex ?? "-1");
    const item = Number.isInteger(originalIndex) ? visibleItems.find((candidate) => candidate.index === originalIndex) : undefined;
    localKeyboardFocusRef.current = target && item
      ? { key: photoItemKey(item), control: target.classList.contains("photo-card__image") ? "image" : "name" }
      : null;
    if (pendingKeyboardFocus && (!item || photoItemKey(item) !== pendingKeyboardFocus.key)) setPendingKeyboardFocus(null);
  }
  const openDetails = (item: PhotoItem) => {
    if (viewerIndex !== null) closeViewer(false);
    onOpenHit(item.hit);
  };
  function showBatchActions() {
    closeViewer(false);
    requestAnimationFrame(() => onShowSelectionActions?.());
  }
  function toggleExactPhotoTag(value: string) {
    setSelectedPhotoTags((currentTags) => currentTags.includes(value)
      ? currentTags.filter((tag) => tag !== value)
      : [...currentTags, value]);
  }
  function clearPhotoFilters() {
    setFormat("all");
    setPhotoQuery("");
    setSelectedPhotoTags([]);
    setOnlySelectedPhotos(false);
    setPhotoTimelineValue("all");
  }
  function selectTimelineYear(year: number) {
    setPhotoTimelineValue(photoTimelinePeriodValue({ kind: "year", year }));
  }
  function selectTimelineMonth(month: number) {
    if (selectedTimelineYear === undefined) return;
    setPhotoTimelineValue(photoTimelinePeriodValue({ kind: "month", year: selectedTimelineYear, month }));
  }
  function moveTimelineYear(direction: -1 | 1) {
    const target = timelineYearOptions[selectedTimelineYearIndex + direction];
    if (!target) return;
    selectTimelineYear(target.year);
  }
  function moveTimelineMonth(direction: -1 | 1) {
    const target = timelineMonthNavigationOptions[selectedTimelineMonthIndex + direction];
    if (!target) return;
    setPhotoTimelineValue(photoTimelinePeriodValue({ kind: "month", year: target.year, month: target.month }));
  }
  const fullscreenSupported = typeof document !== "undefined"
    && document.fullscreenEnabled !== false
    && typeof Element !== "undefined"
    && typeof Element.prototype.requestFullscreen === "function"
    && typeof document.exitFullscreen === "function";
  const modal = current && <PhotoViewer
    current={current}
    viewerItems={viewerItems}
    visibleCount={visibleItems.length}
    selectedPhotoCount={selectedPhotoItems.length}
    activeViewerIndex={activeViewerIndex}
    filmstripStart={filmstripStart}
    nearbyViewerItems={nearbyViewerItems}
    selected={currentSelected}
    viewerScope={viewerScope}
    viewerFullscreen={viewerFullscreen}
    viewerFullscreenMessage={viewerFullscreenMessage}
    fullscreenSupported={fullscreenSupported}
    slideshowPlaying={slideshowPlaying}
    slideshowSeconds={slideshowSeconds}
    nextItem={nextItem}
    viewerDialogRef={viewerDialogRef}
    viewerTitleRef={viewerTitleRef}
    command={command}
    locale={locale}
    workspaceID={workspaceID}
    t={t}
    favoriteControls={favoriteControls}
    selectionRefs={selectionRefs}
    onFocusSubject={onFocusSubject}
    onShowSelectionActions={onShowSelectionActions}
    onClose={closeViewer}
    onToggleFullscreen={() => void toggleViewerFullscreen()}
    onOpenDetails={openDetails}
    onToggleSelection={toggleDisplayedPhotoSelection}
    onShowBatchActions={showBatchActions}
    onMove={(position) => { if (viewerIndex !== null) moveViewer(position); }}
    onBeginSwipe={beginSwipe}
    onConsumeSwipeClick={consumeSwipeClick}
    onBlockMediaDrag={blockMediaDrag}
    onChangeScope={changeViewerScope}
    onToggleSlideshow={() => setSlideshowPlaying((playing) => !playing)}
    onStopSlideshow={() => setSlideshowPlaying(false)}
    onSlideshowSecondsChange={setSlideshowSeconds}
    slideshowItemSupported={slideshowItemSupported}
  />;
  return <section className="photo-library" aria-label={t("Photos")} data-density={density}>
    <header className="photo-library__masthead">
      <div className="photo-library__title">
        <h1>{t("Photos")}</h1>
        <p className="photo-library__count">{t("{{count}} items in this photo view", { count: visibleItems.length })}</p>
      </div>
      <section className="photo-library__search-panel" aria-label={t("Search photos")}>
        {onVisualTextSearch && <div className="photo-library__search-scopes" role="group" aria-label={t("Photo search scope")}>
          <button type="button" aria-pressed={searchScope === "visual"} onClick={() => setSearchScope("visual")}>{t("Scene")}</button>
          <button type="button" aria-pressed={searchScope === "name-tags"} onClick={() => setSearchScope("name-tags")}>{t("Names and tags")}</button>
        </div>}
        {searchScope === "visual" && onVisualTextSearch ? <form className="photo-library__search-row is-visual" onSubmit={(event) => {
          event.preventDefault();
          const description = visualSearchDescription.trim();
          if (description && !imageSearchBusy) onVisualTextSearch(description);
        }}>
          <label className="sr-only" htmlFor="photo-visual-search">{t("Describe a scene")}</label>
          <input ref={searchInputRef} id="photo-visual-search" type="search" value={visualSearchDescription} placeholder={t("A sunset by the sea, a red car")} onChange={(event) => setVisualSearchDescription(event.target.value)} />
          <button type="submit" disabled={imageSearchBusy || !visualSearchDescription.trim()}>{imageSearchBusy ? t("Searching visual matches…") : t("Find")}</button>
        </form> : <div className="photo-library__search-row is-local">
          <label className="sr-only" htmlFor="photo-name-search">{t("Search photos by name or tag")}</label>
          <input id="photo-name-search" ref={searchInputRef} type="search" value={photoQuery} placeholder={t("Search photos by name or tag")} onChange={(event) => setPhotoQuery(event.target.value)} />
          {photoQuery && <button type="button" onClick={() => setPhotoQuery("")}>{t("Clear search")}</button>}
        </div>}
        {onVisualTextSearch && searchScope === "visual" && <p className="photo-library__search-hint">{t("Search indexed photos by what they show.")}</p>}
      </section>
      <details className="photo-library__format-filter">
        <summary><span>{t("Filter and display")}</span><strong>{activeFilterCount ? t("{{count}} active filters", { count: activeFilterCount }) : t("All loaded photos")} · {activeSortLabel}{photoSort === "library" ? "" : ` · ${activeSortDirectionLabel}`}</strong></summary>
        <div className="photo-library__filters">
          <label className="photo-library__density">
            <span>{t("Wall density")}</span>
            <input type="range" min="1" max="5" step="1" value={density} onChange={(event) => setDensity(Number(event.target.value))} />
            <span className="photo-library__density-value" aria-hidden="true">{density}</span>
          </label>
          <div className="photo-library__format-options" role="group" aria-label={t("Filter by format")}>
            <button type="button" aria-pressed={format === "all"} onClick={() => setFormat("all")}>{t("All formats")}</button>
            {formats.map((value) => <button type="button" key={value} aria-pressed={format === value} onClick={() => setFormat(value)}>{value === "unknown" ? t("Unknown format") : value.toUpperCase()}</button>)}
          </div>
          <section className="photo-library__tag-filter" aria-label={t("Filter by exact tags")}>
            <strong>{t("Filter by exact tags")}</strong>
            {photoTagAvailabilityMessage && <small className="photo-library__tag-status" role="status">{photoTagAvailabilityMessage}</small>}
            {photoTagOptions.length > 0
              ? <div className="photo-library__tag-options">{photoTagOptions.map(({ value, count }) => <div className="photo-library__tag-option" key={value}>
                <label><input type="checkbox" checked={selectedPhotoTags.includes(value)} disabled={photoTagStatus !== "ready"} onChange={() => toggleExactPhotoTag(value)} />
                  <span>{value}</span>{photoTagStatus === "ready" && <small>{count}</small>}</label>
                {selectedPhotoTags.includes(value) && photoTagStatus !== "ready" && <button type="button" onClick={() => toggleExactPhotoTag(value)}>{t("Remove tag filter")}</button>}
              </div>)}</div>
              : photoTagStatus === "ready" && <small className="photo-library__tag-empty">{t("No tag values are available in the current loaded photo scope")}</small>}
            <label className="photo-library__selected-only"><input type="checkbox" checked={onlySelectedPhotos} onChange={(event) => setOnlySelectedPhotos(event.target.checked)} /><span>{t("Show selected photos only")}</span></label>
            {hasLocalPhotoFilters && <button type="button" className="photo-library__clear-filters" onClick={clearPhotoFilters}>{t("Clear photo filters")}</button>}
          </section>
          <div className="photo-library__sort-controls">
            <label><span>{t("Sort by")}</span><select aria-label={t("Sort by")} value={photoSort} onChange={(event) => setPhotoSort(event.target.value as "library" | "filename" | "size" | "modified")}>
              <option value="library">{t("Library order")}</option>
              <option value="filename">{t("Filename")}</option>
              <option value="size">{t("Known file size")}</option>
              <option value="modified">{t("Recorded modification time")}</option>
            </select></label>
            <label><span>{t("Sort direction")}</span><select aria-label={t("Sort direction")} value={photoSortDirection} disabled={photoSort === "library"} onChange={(event) => setPhotoSortDirection(event.target.value === "desc" ? "desc" : "asc")}>
              <option value="asc">{t("Ascending")}</option>
              <option value="desc">{t("Descending")}</option>
            </select></label>
            {photoSort === "size" && <small>{t("Unknown sizes always appear last")}</small>}
            {photoSort === "modified" && <small>{t("Items without recorded modification times always appear last")}</small>}
          </div>
          <section className="photo-library__timeline" aria-label={t("Browse recorded modification time")}>
            <strong>{t("Recorded modification time")}</strong>
            <small>{t("Uses source modification time in loaded results; this is not a capture date.")}</small>
            <div className="photo-library__timeline-presets" role="group" aria-label={t("Photo date periods")}>
              <button type="button" aria-pressed={photoTimelinePeriod.kind === "all"} onClick={() => setPhotoTimelineValue("all")}>{t("All loaded dates")} <small>{matchingItems.length}</small></button>
              <button type="button" aria-pressed={photoTimelinePeriod.kind === "unknown"} onClick={() => setPhotoTimelineValue("unknown")}>{t("Unknown date")} <small>{photoTimelineFacets.unknownCount}</small></button>
            </div>
            <div className="photo-library__timeline-selectors">
              <label><span>{t("Year")}</span><select aria-label={t("Year")} value={selectedTimelineYear ?? ""} onChange={(event) => { if (event.target.value === "") { setPhotoTimelineValue("all"); return; } const year = Number(event.target.value); if (Number.isInteger(year)) selectTimelineYear(year); }}>
                <option value="">{t("Choose a year")}</option>
                {timelineYearOptions.map(({ year, count }) => <option key={year} value={year}>{year} · {count}</option>)}
              </select></label>
              <label><span>{t("Month")}</span><select aria-label={t("Month")} value={photoTimelinePeriod.kind === "month" ? photoTimelinePeriod.month : ""} disabled={selectedTimelineYear === undefined} onChange={(event) => { if (event.target.value === "") { if (selectedTimelineYear !== undefined) selectTimelineYear(selectedTimelineYear); return; } const month = Number(event.target.value); if (Number.isInteger(month) && month >= 1 && month <= 12) selectTimelineMonth(month); }}>
                <option value="">{t("All months")}</option>
                {timelineMonthOptions.map(({ month, count }) => <option key={month} value={month}>{new Intl.DateTimeFormat(locale || undefined, { month: "long", timeZone: "UTC" }).format(photoTimelineCalendarDate(selectedTimelineYear!, month))} · {count}</option>)}
              </select></label>
            </div>
            {selectedTimelineYear !== undefined && <div className="photo-library__timeline-nav" role="group" aria-label={t("Year navigation")}>
              <button type="button" disabled={selectedTimelineYearIndex <= 0} onClick={() => moveTimelineYear(-1)}>{t("Newer year")}</button>
              <button type="button" disabled={selectedTimelineYearIndex < 0 || selectedTimelineYearIndex >= timelineYearOptions.length - 1} onClick={() => moveTimelineYear(1)}>{t("Older year")}</button>
            </div>}
            {photoTimelinePeriod.kind === "month" && <div className="photo-library__timeline-nav" role="group" aria-label={t("Month navigation")}>
              <button type="button" disabled={selectedTimelineMonthIndex <= 0} onClick={() => moveTimelineMonth(-1)}>{t("Newer month")}</button>
              <button type="button" disabled={selectedTimelineMonthIndex < 0 || selectedTimelineMonthIndex >= timelineMonthNavigationOptions.length - 1} onClick={() => moveTimelineMonth(1)}>{t("Older month")}</button>
            </div>}
            {photoTimelinePeriod.kind !== "all" && <p className="photo-library__timeline-current" role="status">{t("Showing {{count}} items · {{period}}", { count: periodItems.length, period: photoTimelineLabel })}</p>}
          </section>
          {(onSelectSubjects || onDownloadOriginals) && <section className="photo-library__bulk-actions" aria-label={t("Selection and takeout")}>
            <strong>{t("Selection and takeout")}</strong>
            <button type="button" className="photo-library__review-selected" disabled={!selectedPhotoItems.length} onClick={openSelectedViewer}>{t("View selected photos ({{count}})", { count: selectedPhotoItems.length })}</button>
            {(onSelectSubjects || onDownloadOriginals) && <details className="photo-takeout">
              <summary>{t("Selection actions and original ZIP")}</summary>
              <div className="photo-takeout__body">
                <p className="photo-takeout__count" role="status">{t("{{selected}} selected in {{matches}} current photo matches", { selected: selectedMatchingSubjects.length, matches: visibleItems.length })}</p>
                {selectedOutsidePhotoMatches > 0 && <p className="photo-takeout__outside">{t("{{count}} selected items are outside these photo matches", { count: selectedOutsidePhotoMatches })}</p>}
                {onSelectSubjects && <div className="photo-takeout__actions" role="group" aria-label={t("Selection in current photo matches")}>
                  <button type="button" disabled={!matchingSubjects.length} onClick={() => onSelectSubjects(matchingSubjects, "add")}>{t("Select matching photos ({{count}})", { count: matchingSubjects.length })}</button>
                  <button type="button" disabled={!matchingSubjects.length} onClick={() => onSelectSubjects(matchingSubjects, "invert")}>{t("Invert matching photo selection ({{count}})", { count: matchingSubjects.length })}</button>
                  <button type="button" disabled={!selectedMatchingSubjects.length} onClick={() => onSelectSubjects(selectedMatchingSubjects, "remove")}>{t("Clear matching photo selection ({{count}})", { count: selectedMatchingSubjects.length })}</button>
                </div>}
                {onDownloadOriginals && <div className="photo-takeout__actions" role="group" aria-label={t("Original photo ZIP takeout")}>
                  <button type="button" disabled={!visibleItems.length || originalTakeoutBusy} onClick={() => onDownloadOriginals(visibleItems.map((item) => item.hit))}>{t("Download matching photos ZIP ({{count}})", { count: visibleItems.length })}</button>
                  <button type="button" disabled={!selectedMatchingSubjects.length || originalTakeoutBusy} onClick={() => onDownloadOriginals(selectedMatchingSubjects)}>{t("Download selected matching photos ZIP ({{count}})", { count: selectedMatchingSubjects.length })}</button>
                </div>}
                <p className="photo-takeout__note">{t("Selection actions affect only the current photo matches. Other selected items are retained.")}</p>
                <p className="photo-takeout__note">{t("Select a photo, then Shift-click or Shift+Space another to add the displayed range.")}</p>
              </div>
            </details>}
          </section>}
        </div>
      </details>
      {hasLocalPhotoFilters && <div className="photo-library__active-filters">
        <span>{activePhotoFilters}{photoSort === "library" ? "" : ` · ${activeSortLabel} · ${activeSortDirectionLabel}`}</span>
        <button type="button" onClick={clearPhotoFilters}>{t("Clear filters")}</button>
      </div>}
      {selectedPhotoTags.length > 0 && photoTagAvailabilityMessage && <p className="photo-library__tag-filter-notice" role="status">{photoTagAvailabilityMessage}</p>}
    </header>
    {error && <p className="photo-library__state is-error" role="alert">{t("Photos could not be loaded")}: {error}</p>}
    {loading && <p className="photo-library__state" role="status">{t("Loading photos…")}</p>}
    {!loading && !error && visibleItems.length === 0 && <div className="photo-library__empty"><ImageIcon size={30} /><strong>{photoEmptyMessage}</strong>{hasLocalPhotoFilters ? <button type="button" onClick={clearPhotoFilters}>{t("Clear photo filters")}</button> : <span>{t("Unsupported image formats remain available as originals from Details.")}</span>}</div>}
    <div ref={libraryListRef} tabIndex={-1} onFocusCapture={handlePhotoWallFocusCapture} onKeyDown={handlePhotoWallKeyDown} className={`photo-wall ${wall.containerClass}`} style={wall.containerStyle} data-rendered-from={wall.startIndex} data-rendered-to={wall.endIndex} data-listing-count={visibleItems.length}>
      {mountedItems.map(({ item, position }) => {
        if (!item) {
          // A photo position whose library page has not arrived yet: it keeps
          // its height and place so the wall never shortens onto the loaded
          // subset, and it is not counted as a card.
          return <div className="result-pending" key={`pending-${position}`} style={wall.rowHeight > 0 ? { height: `${wall.rowHeight}px` } : undefined} data-result-pending={position} role="presentation" aria-hidden="true" />;
        }
        const { hit } = item;
        const name = hit.name || hit.path?.split(/[\\/]/).at(-1) || t("Untitled subject");
        const checked = Boolean(hit.subject_ref && selectionRefs.includes(hit.subject_ref));
        // Only real recorded tags are shown: repeating "No tags" on every card
        // is noise, while the Details action below stays available.
        const cardTags = hit.subject_ref ? (tagsBySubject.get(hit.subject_ref) ?? []).slice(0, 2) : [];
        return <PhotoCard
          key={hit.subject_ref ?? hit.entry_id ?? `${name}-${item.index}`}
          item={item}
          position={position}
          current={selectedRef === hit.subject_ref}
          selected={checked}
          tags={cardTags}
          selectedTags={selectedPhotoTags}
          tagStatus={photoTagStatus}
          photoSort={photoSort}
          imageSearchBusy={imageSearchBusy}
          command={command}
          locale={locale}
          workspaceID={workspaceID}
          t={t}
          favoriteControls={favoriteControls}
          onFocusSubject={onFocusSubject}
          onActivate={(event) => {
            if (event.shiftKey) {
              event.preventDefault();
              addDisplayedPhotoRange(item);
              return;
            }
            if (event.metaKey || event.ctrlKey) {
              setPhotoSelectionAnchor(hit);
              onRowClick(item.index, { metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, preventDefault: () => event.preventDefault() });
              return;
            }
            openViewer(position);
          }}
          onSelectRange={() => addDisplayedPhotoRange(item)}
          onToggleSelection={() => { setPhotoSelectionAnchor(hit); onToggleSelection(item.index); }}
          onOpenDetails={openDetails}
          onToggleTag={toggleExactPhotoTag}
          onImageSearch={onImageSearch}
        />;
      })}
    </div>
    {current && createPortal(modal, document.body)}
  </section>;
}
