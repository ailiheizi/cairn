import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Expand, Image as ImageIcon, X } from "lucide-react";
import type { ComponentProps, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { ResultList } from "./ResultList";
import { useResultWindow } from "./ResultWindow";
import { ContentPreview, previewThumbKind } from "./ContentPreview";
import { PhotoThumbnail } from "./PhotoThumbnail";
import { FavoriteButton } from "./FavoriteButton";
import type { FavoriteControls } from "../lib/favorites";
import { formatFacetValue, formatBytes } from "../lib/format";
import type { SearchHit } from "../lib/types";
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
export type PhotoLibraryExperienceProps = ComponentProps<typeof ResultList> & {
  onOpenHit: (hit: SearchHit) => void;
  /** App-owned focus carried across same-context page presentations. */
  focusedSubjectRef?: string;
  onFocusSubject?: (subjectRef: string) => void;
  loading?: boolean;
  error?: string;
  favoriteControls?: FavoriteControls;
};

type PhotoItem = { hit: SearchHit; index: number; format: string; previewable: boolean };

// Swipe navigation thresholds. A release counts as a swipe only when the
// horizontal travel reaches this distance and dominates the vertical travel by
// this factor, so a vertical scroll or a short tap is never read as a photo
// change.
const SWIPE_MIN_DISTANCE_PX = 48;
const SWIPE_AXIS_RATIO = 1.6;

export function PhotoLibraryExperience(props: PhotoLibraryExperienceProps) {
  const { hits, command, locale, workspaceID, t, selectedRef, selectionRefs, tagsBySubject, rovingRow, onRowClick, onToggleSelection, onOpenHit, focusedSubjectRef, onFocusSubject, libraryListRef, onKeyDown, loading = false, error = "", favoriteControls } = props;
  const [format, setFormat] = useState("all");
  const [density, setDensity] = useState(3);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [fit, setFit] = useState(true);
  const openerRef = useRef<HTMLElement | null>(null);
  const viewerTitleRef = useRef<HTMLHeadingElement | null>(null);
  const viewerDialogRef = useRef<HTMLElement | null>(null);
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
  const visibleItems = useMemo(() => items.filter((item) => format === "all" || item.format === format), [format, items]);
  const wall = useResultWindow({ containerRef: libraryListRef, count: visibleItems.length, onNeedMore: props.onLoadMore });
  const mountedItems = useMemo(() => {
    const rendered: Array<{ item?: PhotoItem; position: number }> = [];
    for (let position = wall.startIndex; position < wall.endIndex; position += 1) {
      rendered.push({ item: visibleItems[position], position });
    }
    return rendered;
  }, [visibleItems, wall.startIndex, wall.endIndex]);
  const pendingFocusRef = useRef("");
  const current = viewerIndex == null ? undefined : visibleItems[viewerIndex];
  const resultsIdentity = useMemo(() => JSON.stringify([workspaceID, hits.map((hit) => [hit.subject_ref ?? "", hit.entry_id ?? "", hit.content_id ?? "", hit.logical_size ?? null, hit.path ?? "", hit.name ?? "", hit.entry_type ?? ""])]), [hits, workspaceID]);
  const previousResultsIdentity = useRef(resultsIdentity);

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
    const subjectRef = pendingFocusRef.current;
    if (!subjectRef) return;
    const position = visibleItems.findIndex((item) => item.hit.subject_ref === subjectRef);
    if (position < 0) { pendingFocusRef.current = ""; return; }
    if (position < wall.startIndex || position >= wall.endIndex) { wall.revealIndex(position); return; }
    const target = Array.from(libraryListRef.current?.querySelectorAll<HTMLElement>("[data-subject-ref] a, [data-subject-ref] button") ?? [])
      .find((node) => node.closest("[data-subject-ref]")?.getAttribute("data-subject-ref") === subjectRef);
    if (!target) return;
    pendingFocusRef.current = "";
    target.focus({ preventScroll: true });
  }, [libraryListRef, mountedItems, visibleItems, wall.endIndex, wall.measured, wall.revealIndex, wall.startIndex]);

  useEffect(() => {
    if (previousResultsIdentity.current !== resultsIdentity) {
      previousResultsIdentity.current = resultsIdentity;
      if (viewerIndex !== null) {
        setViewerIndex(null);
        requestAnimationFrame(() => openerRef.current?.focus());
      }
    }
  }, [resultsIdentity, viewerIndex]);

  // The roving index is an index into props.hits; the window counts positions
  // in the filtered listing. A roving index outside the mounted window is
  // revealed first and focused once mounted, so arrow keys, Home and End reach
  // every card on the wall, not only the mounted ones.
  const focusWasInWall = useRef(false);
  const rovingPosition = useMemo(() => visibleItems.findIndex((item) => item.index === rovingRow), [rovingRow, visibleItems]);
  useEffect(() => {
    const container = libraryListRef.current;
    if (!container || container.querySelector(`[data-result-index="${rovingRow}"]`)) return;
    focusWasInWall.current = container.contains(document.activeElement);
    if (rovingPosition >= 0) wall.revealIndex(rovingPosition);
  }, [libraryListRef, rovingPosition, rovingRow, wall.revealIndex]);
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
      const nestedViewer = document.querySelector<HTMLElement>(".cairn-image-viewer");
      const focusInsideNestedViewer = Boolean(nestedViewer && nestedViewer.contains(document.activeElement));
      if (event.key === "Escape") {
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
      if (event.key === "ArrowLeft") { event.preventDefault(); setViewerIndex((value) => value == null ? value : Math.max(0, value - 1)); }
      else if (event.key === "ArrowRight") { event.preventDefault(); setViewerIndex((value) => value == null ? value : Math.min(visibleItems.length - 1, value + 1)); }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [current?.hit, visibleItems.length, viewerIndex]);

  // A swipe in progress owns two temporary window listeners. The viewer can
  // close or change identity mid-gesture, so the effect detaches them again.
  useEffect(() => () => stopSwipeTracking(), [current?.hit, visibleItems.length]);

  function openViewer(position: number, trigger: HTMLElement) {
    openerRef.current = trigger;
    setFit(true);
    setViewerIndex(position);
  }
  function closeViewer(restoreFocus = true) {
    setViewerIndex(null);
    if (restoreFocus) requestAnimationFrame(() => { if (openerRef.current?.isConnected) openerRef.current.focus(); });
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
      setViewerIndex((value) => value == null ? value : deltaX < 0 ? Math.min(visibleItems.length - 1, value + 1) : Math.max(0, value - 1));
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
    if (event.button !== 0 || !event.isPrimary || visibleItems.length < 2) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest(".cairn-image-viewer")) return;
    const control = target.closest('button, a[href], input, select, textarea, [contenteditable="true"]');
    // The preview image is wrapped in a button, but it is the media surface
    // itself; every other control keeps its own tap/click behaviour.
    if (control && !control.classList.contains("cairn-content-preview__image-button")) return;
    swipeRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
    trackSwipe(event.pointerId);
  }
  function consumeSwipeClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!swipeHandledClick.current) return;
    swipeHandledClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }
  // Browsers that ignore -webkit-user-drag would otherwise turn a mouse drag on
  // the picture into a native image drag and never deliver the pointer release.
  function blockMediaDrag(event: ReactDragEvent<HTMLDivElement>) {
    if (swipeRef.current) event.preventDefault();
  }
  const openDetails = (item: PhotoItem) => {
    if (viewerIndex !== null) closeViewer(false);
    onOpenHit(item.hit);
  };
  const modal = current && <div className="photo-viewer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeViewer(); }}>
    <section ref={viewerDialogRef} className="photo-viewer" role="dialog" aria-modal="true" aria-label={t("Photo viewer")}>
      <header className="photo-viewer__header">
        <div className="photo-viewer__identity"><h2 ref={viewerTitleRef} tabIndex={-1}>{current.hit.name || t("Untitled subject")}</h2><span>{t("{{position}} of {{count}}", { position: viewerIndex! + 1, count: visibleItems.length })}</span></div>
        <div className="photo-viewer__actions">
          {/* Each control disables itself while it is already the active mode,
              so actual size is never a one-way trap: the way back to fit stays
              enabled exactly while the viewer is at actual size. */}
          <button type="button" disabled={fit} aria-label={t("Fit to window")} title={t("Fit to window")} onClick={() => setFit(true)}><Expand size={17} /></button>
          <button type="button" disabled={!fit} aria-label={t("Actual size")} title={t("Actual size")} onClick={() => setFit(false)}>{t("Actual size")}</button>
          <button type="button" aria-label={t("Details")} onClick={() => openDetails(current)}>{t("Details")}</button>
          <span className="photo-viewer__favorite" onKeyDown={(event) => event.stopPropagation()} onFocusCapture={() => current.hit.subject_ref && onFocusSubject?.(current.hit.subject_ref)}><FavoriteButton hit={current.hit} controls={favoriteControls} t={t} /></span>
          <button type="button" aria-label={t("Close viewer")} onClick={() => closeViewer()}><X size={18} /></button>
        </div>
      </header>
      <button type="button" className="photo-viewer__nav photo-viewer__nav--prev" aria-label={t("Previous photo")} disabled={viewerIndex === 0} onClick={() => setViewerIndex((value) => value == null ? value : Math.max(0, value - 1))}><ChevronLeft /></button>
      <div className={`photo-viewer__body ${fit ? "is-fit" : "is-large"}`} onPointerDown={beginSwipe} onClickCapture={consumeSwipeClick} onDragStart={blockMediaDrag}>
        <ContentPreview key={`${current.hit.entry_id ?? current.hit.subject_ref}:${current.hit.content_id ?? ""}`} variant="inspector" autoOpen command={command} locale={locale} workspaceId={workspaceID} entryId={current.hit.entry_id} subjectRef={current.hit.subject_ref} contentId={current.hit.content_id} name={current.hit.name || t("Untitled subject")} logicalSize={current.hit.logical_size} />
      </div>
      <button type="button" className="photo-viewer__nav photo-viewer__nav--next" aria-label={t("Next photo")} disabled={viewerIndex === visibleItems.length - 1} onClick={() => setViewerIndex((value) => value == null ? value : Math.min(visibleItems.length - 1, value + 1))}><ChevronRight /></button>
    </section>
  </div>;

  return <section className="photo-library" aria-label={t("Photos")} data-density={density}>
    <div className="photo-library__toolbar">
      <div><p className="photo-library__eyebrow">{t("PHOTO LIBRARY")}</p><h1>{t("Photos")}</h1><p>{t("{{count}} photos and files in the loaded listing", { count: visibleItems.length })}</p></div>
      <label className="photo-library__density">{t("Wall density")}<input type="range" min="1" max="5" step="1" value={density} onChange={(event) => setDensity(Number(event.target.value))} /><span>{density}</span></label>
    </div>
    <div className="photo-library__filters" role="group" aria-label={t("Filter by format")}>
      <button type="button" aria-pressed={format === "all"} onClick={() => setFormat("all")}>{t("All formats")}</button>
      {formats.map((value) => <button type="button" key={value} aria-pressed={format === value} onClick={() => setFormat(value)}>{value === "unknown" ? t("Unknown format") : value.toUpperCase()}</button>)}
    </div>
    {error && <p className="photo-library__state is-error" role="alert">{t("Photos could not be loaded")}: {error}</p>}
    {loading && <p className="photo-library__state" role="status">{t("Loading photos…")}</p>}
    {!loading && !error && visibleItems.length === 0 && <div className="photo-library__empty"><ImageIcon size={30} /><strong>{format === "all" ? t("No photos in the loaded listing") : t("No items match this format")}</strong><span>{t("Unsupported image formats remain available as originals from Details.")}</span></div>}
    <div ref={libraryListRef} onKeyDown={onKeyDown} className={`photo-wall ${wall.containerClass}`} style={wall.containerStyle} data-rendered-from={wall.startIndex} data-rendered-to={wall.endIndex} data-listing-count={visibleItems.length}>
      {mountedItems.map(({ item, position }) => {
        if (!item) {
          // A photo position whose library page has not arrived yet: it keeps
          // its height and place so the wall never shortens onto the loaded
          // subset, and it is not counted as a card.
          return <div className="result-pending" key={`pending-${position}`} style={wall.rowHeight > 0 ? { height: `${wall.rowHeight}px` } : undefined} data-result-pending={position} role="presentation" aria-hidden="true" />;
        }
        const { hit, index } = item;
        const name = hit.name || hit.path?.split(/[\\/]/).at(-1) || t("Untitled subject");
        const checked = Boolean(hit.subject_ref && selectionRefs.includes(hit.subject_ref));
        // Keep the legacy eager-thumbnail window bounded. Larger PNG/JPEG
        // candidates can appear anywhere because PhotoThumbnail reads them
        // only while the card is visible and enforces its separate budget.
        const thumbAllowed = item.previewable && (position < 48 || (hit.logical_size != null && hit.logical_size > (1 << 20)));
        const photoTrigger = (trigger: HTMLElement, event: ReactMouseEvent<HTMLElement>) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) {
            onRowClick(index, { metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, preventDefault: () => event.preventDefault() });
            return;
          }
          openViewer(position, trigger);
        };
        return <article className={`photo-card ${selectedRef === hit.subject_ref ? "is-current" : ""} ${item.previewable ? "has-preview" : "has-fallback"}`} key={hit.subject_ref ?? hit.entry_id ?? `${name}-${index}`} data-result-index={index} data-original-index={index} data-subject-ref={hit.subject_ref ?? ""}>
          <button type="button" className="photo-card__image" aria-label={t("Open {{name}}", { name })} onFocus={() => hit.subject_ref && onFocusSubject?.(hit.subject_ref)} onClick={(event) => photoTrigger(event.currentTarget, event)}>
            {thumbAllowed ? <PhotoThumbnail command={command} locale={locale} workspaceId={workspaceID} entryId={hit.entry_id} subjectRef={hit.subject_ref} contentId={hit.content_id} name={name} logicalSize={hit.logical_size} /> : <span className="photo-card__unsupported"><ImageIcon size={26} /><small>{item.format === "unknown" ? t("Unknown format") : item.format.toUpperCase()}</small><small>{t("Thumbnail not loaded")}</small></span>}
          </button>
          <div className="photo-card__caption"><div><button type="button" className="result-open-copy photo-card__name" aria-label={t("Open {{name}}", { name })} onFocus={() => hit.subject_ref && onFocusSubject?.(hit.subject_ref)} onClick={(event) => photoTrigger(event.currentTarget, event)}>{name}</button><small>{item.format === "unknown" ? t("Unknown format") : item.format.toUpperCase()}{hit.logical_size != null ? ` · ${formatBytes(hit.logical_size)}` : ""}</small></div>
            <div className="photo-card__caption-actions">
              <span className="photo-card__favorite" onKeyDown={(event) => event.stopPropagation()} onFocusCapture={() => hit.subject_ref && onFocusSubject?.(hit.subject_ref)}><FavoriteButton hit={hit} controls={favoriteControls} t={t} /></span>
              <label className="photo-card__select"><input type="checkbox" checked={checked} disabled={!hit.subject_ref} aria-label={t(checked ? "Deselect {{name}}" : "Select {{name}}", { name })} onChange={() => onToggleSelection(index)} /></label>
            </div>
          </div>
          <div className="photo-card__foot"><span>{hit.subject_ref ? (tagsBySubject.get(hit.subject_ref) ?? []).slice(0, 2).join(" · ") || t("No tags") : t("Details unavailable")}</span><button type="button" onClick={() => openDetails(item)}>{t("Details")}</button></div>
        </article>;
      })}
    </div>
    {current && createPortal(modal, document.body)}
  </section>;
}
