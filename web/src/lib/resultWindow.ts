// Windowing geometry shared by the library result wall and the Photos wall.
//
// Both walls project one already-loaded listing. At ten thousand items neither
// wall may hold that listing in the DOM, and neither may quietly drop items
// behind a cap: the DOM keeps a bounded window while the document keeps a
// scroll length that still reaches the last item, so every item stays
// reachable and the count labels keep describing the real listing.
//
// The model is one measured row height plus the container's row gap. Each
// rendered row is laid out at that exact height (see the `is-windowed` rules in
// styles/library.css), so the document offset of a row is exactly
// `row * stride` no matter which window is mounted. A measured change of that
// height is only ever adopted through `resultAnchoredScrollTop`, which keeps
// the first visible item where it was instead of letting the list jump.
//
// This module is pure geometry: no DOM, no React, no dependency. The React
// binding lives in components/ResultWindow.tsx.

/** Rows rendered beyond the viewport on each side. */
export const RESULT_WINDOW_OVERSCAN_ROWS = 4;
/** Smallest window, in rows. */
export const RESULT_WINDOW_MIN_ROWS = 6;
/** Smallest window, in items: keeps the existing eager-preview window whole. */
export const RESULT_WINDOW_MIN_ITEMS = 48;
/** Items rendered while the row height and column count are still unknown. */
export const RESULT_WINDOW_BOOTSTRAP_ITEMS = 64;

export type ResultWindowLayout = {
  startRow: number;
  /** Exclusive. */
  endRow: number;
  startIndex: number;
  /** Exclusive. */
  endIndex: number;
  paddingTop: number;
  paddingBottom: number;
  totalRows: number;
  totalHeight: number;
  /** Row height plus row gap. */
  stride: number;
};

export const emptyResultWindowLayout: ResultWindowLayout = {
  startRow: 0,
  endRow: 0,
  startIndex: 0,
  endIndex: 0,
  paddingTop: 0,
  paddingBottom: 0,
  totalRows: 0,
  totalHeight: 0,
  stride: 0,
};

export function resultRowCount(count: number, columns: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const cols = Math.max(1, Math.floor(columns));
  return Math.ceil(count / cols);
}

export function resultRowForIndex(index: number, columns: number): number {
  const cols = Math.max(1, Math.floor(columns));
  return Math.max(0, Math.floor(Math.max(0, index) / cols));
}

/**
 * The rendered window for one scroll position. `relScroll` is measured from the
 * first row's top edge inside the same scroll container, so a wall that sits
 * below other page content still maps its own rows exactly.
 *
 * Guarantees the exit test relies on:
 *  - `paddingTop + renderedHeight + paddingBottom === totalHeight` for every
 *    scroll position, so the document keeps one stable scroll length and the
 *    last row is reachable by scrolling to the end;
 *  - the window always spans the viewport plus `overscanRows` on each side, so
 *    no scroll step can leave a blank region inside the viewport;
 *  - the window start is always a whole row, so the grid never renders a
 *    half-filled first row.
 */
export function resultWindowLayout({ count, columns, track, gap, relScroll, viewportHeight, overscanRows = RESULT_WINDOW_OVERSCAN_ROWS, minRows = RESULT_WINDOW_MIN_ROWS, minItems = RESULT_WINDOW_MIN_ITEMS }: {
  count: number;
  columns: number;
  track: number;
  gap: number;
  relScroll: number;
  viewportHeight: number;
  overscanRows?: number;
  minRows?: number;
  minItems?: number;
}): ResultWindowLayout {
  const cols = Math.max(1, Math.floor(columns));
  const totalRows = resultRowCount(count, cols);
  if (totalRows === 0) return emptyResultWindowLayout;
  const rowHeight = Math.max(0, Number.isFinite(track) ? track : 0);
  const rowGap = Math.max(0, Number.isFinite(gap) ? gap : 0);
  const stride = rowHeight + rowGap;
  // A model without a positive stride cannot place rows; keep one item deep
  // rather than dividing by zero. The measured bootstrap always has a height,
  // so this only covers the degenerate "everything is 0px" layout.
  const step = stride > 0 ? stride : 1;
  const scroll = Math.max(0, Number.isFinite(relScroll) ? relScroll : 0);
  const viewport = Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 0);
  const firstRow = Math.min(totalRows - 1, Math.floor(scroll / step));
  const lastRow = Math.min(totalRows - 1, Math.floor((scroll + viewport) / step));
  const overscan = Math.max(0, Math.floor(overscanRows));
  let startRow = Math.max(0, firstRow - overscan);
  let endRow = Math.min(totalRows, lastRow + overscan + 1);
  const wantedRows = Math.max(1, Math.floor(minRows), Math.ceil(Math.min(count, Math.max(0, minItems)) / cols));
  if (endRow - startRow < wantedRows) endRow = Math.min(totalRows, startRow + wantedRows);
  if (endRow - startRow < wantedRows) startRow = Math.max(0, endRow - wantedRows);
  const startIndex = startRow * cols;
  const endIndex = Math.min(count, endRow * cols);
  const totalHeight = (totalRows - 1) * stride + rowHeight;
  const paddingTop = startRow * stride;
  const renderedHeight = (endRow - startRow - 1) * stride + rowHeight;
  const paddingBottom = Math.max(0, totalHeight - paddingTop - renderedHeight);
  return { startRow, endRow, startIndex, endIndex, paddingTop, paddingBottom, totalRows, totalHeight, stride };
}

/**
 * The scroll position that keeps the item at `row` at `viewportOffset` pixels
 * below the scroll container's top edge. Used when the measured row height or
 * the column count changes after the user has already scrolled: the item the
 * operator is looking at stays where it is.
 */
export function resultAnchoredScrollTop({ row, stride, contentTop, viewportOffset }: { row: number; stride: number; contentTop: number; viewportOffset: number }): number {
  const step = Math.max(0, Number.isFinite(stride) ? stride : 0);
  return contentTop + Math.max(0, Math.floor(row)) * step - (Number.isFinite(viewportOffset) ? viewportOffset : 0);
}
