import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { RESULT_WINDOW_BOOTSTRAP_ITEMS, RESULT_WINDOW_MIN_ITEMS, RESULT_WINDOW_MIN_ROWS, RESULT_WINDOW_OVERSCAN_ROWS, emptyResultWindowLayout, resultAnchoredScrollTop, resultRowForIndex, resultWindowLayout } from "../lib/resultWindow";
import type { ResultWindowLayout } from "../lib/resultWindow";

// The React binding for the shared result window: it measures the row height and
// the column count of a wall that renders `[data-result-index]` children, and
// returns the bounded slice plus the spacer the wall must apply.
//
// The two walls (the library result list and the Photos wall) use this one
// binding, so both keep a bounded DOM over the same loaded listing. Items
// outside the window are not mounted; the spacer keeps the document long enough
// that every one of them is still reachable by scrolling.
//
// This component never drops an item from the projection: it only decides which
// part of it is mounted right now.

type Metrics = { columns: number; track: number; gap: number };
type Viewport = { relScroll: number; height: number };
type PendingAnchor = { index: number; viewportOffset: number; columns: number; track: number };
/** `contentTop` is the wall's content-box top in document coordinates and
 *  `scrollTop` is the scroll container's own offset. */
type ScrollerGeometry = { element: HTMLElement | null; contentTop: number; scrollTop: number; height: number };

/** A mounted item. A position whose page has not arrived yet is held open by the
 *  wall as a placeholder without this attribute, so it is never measured as an
 *  item and never read back as one. */
const TILE_SELECTOR = "[data-result-index]";
const HEIGHT_TOLERANCE = 0.5;

export type ResultWindowState = ResultWindowLayout & {
  /** Items the wall must render right now. */
  renderedCount: number;
  /** The measured row height the pending positions must keep. */
  rowHeight: number;
  /** True once a row height and a column count have been measured. */
  measured: boolean;
  /** Spacer and row height for the wall container. */
  containerStyle: CSSProperties | undefined;
  /** Class the wall container must add while it is windowed. */
  containerClass: string;
  /**
   * Scrolls the row that holds `index` into view. The keyboard path calls this
   * for a roving index outside the mounted window, so arrow keys, Home and End
   * reach every item in the listing, not only the mounted ones.
   */
  revealIndex: (index: number) => void;
};

/** The element that actually scrolls this wall, or null for the document.
 *
 *  `body` and `html` are deliberately excluded: `body` computes
 *  `overflow-y: auto` as soon as `overflow-x` is hidden, and its scrollHeight
 *  stays above its clientHeight while the page grows, so a naive walk would
 *  pick `body` as the scroller even though `body.scrollTop` never moves and the
 *  viewport is what scrolls. An inner scroll pane an appearance puts around the
 *  wall is still found, because it is neither of those two elements. */
function resolveScroller(node: HTMLElement | null): HTMLElement | null {
  for (let parent = node?.parentElement ?? null; parent; parent = parent.parentElement) {
    if (parent === document.body || parent === document.documentElement) break;
    const overflowY = window.getComputedStyle(parent).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight + 1) return parent;
  }
  return null;
}

function readGeometry(container: HTMLElement): ScrollerGeometry {
  const element = resolveScroller(container);
  const rect = container.getBoundingClientRect();
  const borderTop = Number.parseFloat(window.getComputedStyle(container).borderTopWidth) || 0;
  if (element) {
    return { element, contentTop: rect.top + borderTop - element.getBoundingClientRect().top + element.scrollTop, scrollTop: element.scrollTop, height: element.clientHeight };
  }
  const scrolling = document.scrollingElement ?? document.documentElement;
  return { element: null, contentTop: rect.top + borderTop + scrolling.scrollTop, scrollTop: scrolling.scrollTop, height: window.innerHeight };
}

function scrollTopOf(element: HTMLElement | null): number {
  if (element) return element.scrollTop;
  return document.scrollingElement?.scrollTop ?? window.scrollY;
}

function applyScrollTop(element: HTMLElement | null, value: number): void {
  const maximum = element
    ? Math.max(0, element.scrollHeight - element.clientHeight)
    : Math.max(0, (document.scrollingElement?.scrollHeight ?? document.documentElement.scrollHeight) - window.innerHeight);
  const next = Math.max(0, Math.min(maximum, value));
  if (element) element.scrollTop = next;
  else window.scrollTo({ top: next, behavior: "instant" });
}

/** The gap the container actually applies between rows. `row-gap` computes to
 *  the grid value even when the wall is laid out as `display: block` (the dense
 *  list), where it has no effect at all, so it may only be counted for a layout
 *  that uses it. Counting it in the dense list would overstate every row offset
 *  by that gap. */
function rowGapOf(container: HTMLElement): number {
  const style = window.getComputedStyle(container);
  if (!style.display.includes("grid") && !style.display.includes("flex")) return 0;
  const gap = Number.parseFloat(style.rowGap);
  return Number.isFinite(gap) && gap > 0 ? gap : 0;
}

/** Groups the mounted tiles into rows and returns the tallest row as the model
 *  height.
 *
 *  The window sets the container's row height to `minmax(track, max-content)`,
 *  so a mounted row is never shorter than its own content: `rect.height` is the
 *  true height of the row and a row that needs more than the current track
 *  reports it here, in the same pre-paint commit, instead of being clipped. */
function measureTiles(container: HTMLElement, allMounted: boolean): Metrics | null {
  const tiles = Array.from(container.querySelectorAll<HTMLElement>(TILE_SELECTOR));
  if (tiles.length === 0) return null;
  let columns = 0;
  let track = 0;
  let rowCount = 0;
  let rowTop = 0;
  let rowHeight = 0;
  let rowItems = 0;
  const commitRow = () => {
    rowCount += 1;
    if (rowItems > columns && rowCount === 1) columns = rowItems;
    track = Math.max(track, rowHeight);
  };
  for (const tile of tiles) {
    const rect = tile.getBoundingClientRect();
    const height = Math.max(rect.height, tile.scrollHeight);
    if (rowItems > 0 && Math.abs(rect.top - rowTop) < 1) {
      rowItems += 1;
      rowHeight = Math.max(rowHeight, height);
      continue;
    }
    if (rowItems > 0) commitRow();
    rowTop = rect.top;
    rowHeight = height;
    rowItems = 1;
  }
  commitRow();
  // A single mounted row cannot tell a full row from a short last window; the
  // first row of a window is always a whole row, so its width is the column
  // count whenever at least two rows (or the whole listing) are mounted.
  if (rowCount < 2 && !allMounted) return null;
  return { columns: Math.max(1, columns), track: Math.max(1, track), gap: rowGapOf(container) };
}

export function useResultWindow({ containerRef, count, loadedCount = count, enabled = true, minItems = RESULT_WINDOW_MIN_ITEMS, onNeedMore }: {
  containerRef: RefObject<HTMLElement | null>;
  /** Positions this wall lays out. It is the whole projection's exact total
   *  when the daemon reported one, so pending positions keep the scroll length
   *  of the real listing open. */
  count: number;
  /** How many of those positions have a real item right now. */
  loadedCount?: number;
  enabled?: boolean;
  minItems?: number;
  /** Called when the mounted window reaches the end of what is loaded, so the
   *  wall can fetch the next bounded page instead of stopping at the boundary. */
  onNeedMore?: () => void;
}): ResultWindowState {
  const [metrics, setMetrics] = useState<Metrics>({ columns: 0, track: 0, gap: 0 });
  const [viewport, setViewport] = useState<Viewport>({ relScroll: 0, height: 0 });
  // The value is never read; a bump only forces the commit that re-runs the
  // measurement, which is how a pure size change (a narrower content column, a
  // different wall density) reaches the geometry model.
  const [, bumpGeometry] = useState(0);
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const countRef = useRef(count);
  countRef.current = count;
  const pendingRef = useRef<PendingAnchor | null>(null);
  const observedWidth = useRef(-1);

  const measured = metrics.columns > 0 && metrics.track > 0 && enabled;
  const layout = measured
    ? resultWindowLayout({
      count,
      columns: metrics.columns,
      track: metrics.track,
      gap: metrics.gap,
      relScroll: viewport.relScroll,
      viewportHeight: viewport.height,
      overscanRows: RESULT_WINDOW_OVERSCAN_ROWS,
      minRows: Math.max(RESULT_WINDOW_MIN_ROWS, Math.ceil(Math.min(count, minItems) / metrics.columns)),
      minItems,
    })
    : { ...emptyResultWindowLayout, endIndex: Math.min(Math.max(0, count), RESULT_WINDOW_BOOTSTRAP_ITEMS) };

  // Track the scroll position of whichever surface actually scrolls this wall.
  useEffect(() => {
    if (!enabled) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;
    const read = () => {
      const geometry = readGeometry(container);
      const relScroll = Math.round(geometry.scrollTop - geometry.contentTop);
      const height = Math.round(geometry.height);
      setViewport((current) => (current.relScroll === relScroll && current.height === height ? current : { relScroll, height }));
    };
    read();
    // A scroll event does not bubble, so the capture phase is what lets one
    // listener observe both the document and any scroll container the current
    // appearance puts around the wall.
    window.addEventListener("scroll", read, { capture: true, passive: true });
    window.addEventListener("resize", read);
    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? -1);
      if (width === observedWidth.current) return;
      observedWidth.current = width;
      bumpGeometry((tick) => tick + 1);
    });
    observer.observe(container);
    return () => {
      window.removeEventListener("scroll", read, { capture: true });
      window.removeEventListener("resize", read);
      observer.disconnect();
    };
  }, [containerRef, enabled]);

  // Adopt the measured geometry after every commit. A change is applied through
  // the anchor in `pendingRef`, so the rows the operator can see do not move.
  useLayoutEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container || count <= 0) return;
    const geometry = readGeometry(container);
    const allMounted = container.querySelectorAll(TILE_SELECTOR).length >= count;
    const measuredTiles = measureTiles(container, allMounted);
    if (!measuredTiles) return;
    const current = metricsRef.current;
    const pending = pendingRef.current;
    // The row the operator has at the top of the viewport, in the layout that
    // was live before this commit. It is derived from the previous model rather
    // than read back from the DOM, because the browser has already reflowed the
    // mounted tiles under a new column count by the time this effect runs.
    const relScrollNow = Math.round(geometry.scrollTop - geometry.contentTop);
    let relScrollNext = relScrollNow;
    const pendingIsLive = pending !== null && pending.columns === measuredTiles.columns && Math.abs(pending.track - measuredTiles.track) <= HEIGHT_TOLERANCE;
    if (pendingIsLive && pending) {
      pendingRef.current = null;
      const row = resultRowForIndex(pending.index, measuredTiles.columns);
      const target = resultAnchoredScrollTop({ row, stride: measuredTiles.track + measuredTiles.gap, contentTop: geometry.contentTop, viewportOffset: pending.viewportOffset });
      applyScrollTop(geometry.element, target);
      relScrollNext = Math.round(scrollTopOf(geometry.element) - geometry.contentTop);
    }
    // A row height can grow (a taller row came into the window) or shrink (the
    // wall left a layout that enforced a fixed row height, such as the dense
    // list after the tile grid). Both are adopted through the anchor, so the
    // item the operator is looking at does not move.
    const changed = measuredTiles.columns !== current.columns || measuredTiles.gap !== current.gap || Math.abs(measuredTiles.track - current.track) > HEIGHT_TOLERANCE;
    if (changed) {
      if (current.columns > 0) {
        const previousStride = current.track + current.gap || 1;
        const previousRow = Math.floor(Math.max(0, relScrollNow) / previousStride);
        const anchorIndex = Math.min(count - 1, previousRow * current.columns);
        const anchorOffset = previousRow * previousStride - relScrollNow;
        pendingRef.current = { index: anchorIndex, viewportOffset: anchorOffset, columns: measuredTiles.columns, track: measuredTiles.track };
      }
      setMetrics(measuredTiles);
    }
    const height = Math.round(geometry.height);
    setViewport((state) => (state.relScroll === relScrollNext && state.height === height ? state : { relScroll: relScrollNext, height }));
    // No dependency list on purpose: any commit can have changed the rendered
    // content (a tag, a notes draft, the wall density, a format filter), so the
    // measurement has to be re-read after every commit rather than guessed from
    // a list of inputs it cannot see. Every update above is equality-guarded, so
    // a commit that changed nothing stops here.
  });

  // Fetch the next bounded page when the mounted window has reached the end of
  // what is loaded. This is the one place the two walls ask for more, so a page
  // boundary is never mistaken for the end of the listing and the scroll area
  // never collapses onto the loaded subset.
  //
  // The test is "the window now covers the last loaded position", not "the
  // window is short of the total": a projection over the loaded library (the
  // Photos wall, a tag or format filter) has no idea how many more of its items
  // the unfetched pages hold, so its position count is the loaded count and its
  // own end is the boundary that must keep loading. `onNeedMore` is only passed
  // while the daemon still offers a continuation, so a complete listing never
  // re-enters here. The callback is held in a ref: the effect only re-runs when
  // the window or the loaded count moves, and a fetch already in flight is
  // refused by the caller.
  const needMoreRef = useRef(onNeedMore);
  needMoreRef.current = onNeedMore;
  const wantMore = Boolean(onNeedMore);
  useEffect(() => {
    if (!wantMore) return;
    if (layout.endIndex < loadedCount) return;
    needMoreRef.current?.();
  }, [layout.endIndex, loadedCount, wantMore]);

  const revealIndex = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container || countRef.current <= 0) return;
    const geometry = readGeometry(container);
    const columns = Math.max(1, metricsRef.current.columns || 1);
    const track = Math.max(0, metricsRef.current.track);
    if (track <= 0) return;
    const stride = track + Math.max(0, metricsRef.current.gap) || 1;
    const row = resultRowForIndex(index, columns);
    const rowTop = geometry.contentTop + row * stride;
    const rowBottom = rowTop + track;
    const margin = Math.min(48, Math.max(0, geometry.height / 4));
    const viewTop = geometry.scrollTop;
    const viewBottom = viewTop + geometry.height;
    if (rowTop >= viewTop + margin && rowBottom <= viewBottom - margin) return;
    const target = rowTop < viewTop + margin ? rowTop - margin : rowBottom - geometry.height + margin;
    applyScrollTop(geometry.element, target);
    const applied = Math.round(scrollTopOf(geometry.element) - geometry.contentTop);
    setViewport((state) => (state.relScroll === applied ? state : { relScroll: applied, height: state.height }));
  }, [containerRef]);

  return {
    ...layout,
    renderedCount: Math.max(0, layout.endIndex - layout.startIndex),
    rowHeight: Math.max(0, metrics.track),
    measured,
    containerClass: measured ? "is-windowed" : "",
    containerStyle: measured
      ? ({
        paddingTop: layout.paddingTop,
        paddingBottom: layout.paddingBottom,
        // A minimum, not an exact height: rows stay uniform at the measured
        // height, while a row whose own content needs more grows instead of
        // being clipped, and the measurement above adopts that height before
        // the browser paints.
        gridAutoRows: `minmax(${metrics.track}px, max-content)`,
      } as CSSProperties)
      : undefined,
    revealIndex,
  };
}
