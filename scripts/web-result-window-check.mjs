// Focused check for the shared result window (SP-2 rendering evidence).
//
// The library wall and the Photos wall must keep a bounded DOM at ten thousand
// items while every item stays reachable. Both walls take their geometry from
// `web/src/lib/resultWindow.ts` and their row-height contract from the shipped
// stylesheets. This script checks those two halves directly, without a daemon:
//
//   1. geometry sweep (pure, exhaustive): with a real 9,138-item listing the
//      rendered window stays bounded, `paddingTop + renderedHeight +
//      paddingBottom` equals one constant total height for every scroll
//      position, and sweeping every pixel of that total height mounts every
//      one of the 9,138 items at least once — no gap, no cap, no truncation;
//   2. layout contract (real Chrome, the built stylesheet): a windowed
//      `.result-list` really places row `r` at `r * stride`, really gives every
//      row the one measured height, really honours the list-mode row height,
//      really gives every `.photo-wall` card that height, and `scrollHeight`
//      really reports content taller than the fixed row height, which is what
//      lets the measurement adopt a greater height instead of clipping it.
//
// These are geometry and layout facts, not a performance guarantee. The
// end-to-end wall numbers come from `scripts/web-large-library-check.mjs`.
//
// Usage:
//   node scripts/web-result-window-check.mjs
//
// Environment:
//   CAIRN_PLAYWRIGHT_MODULE           Playwright module
//   CAIRN_PLAYWRIGHT_EXECUTABLE_PATH  Chrome/Chromium binary
//   CAIRN_WEB_DIST                    built WebUI root (default web/dist)

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RESULT_WINDOW_BOOTSTRAP_ITEMS,
  RESULT_WINDOW_MIN_ITEMS,
  RESULT_WINDOW_MIN_ROWS,
  RESULT_WINDOW_OVERSCAN_ROWS,
  resultAnchoredScrollTop,
  resultRowCount,
  resultRowForIndex,
  resultWindowLayout,
} from "../web/src/lib/resultWindow.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const observed = {};
let failure;

function report(name, value) {
  observed[name] = value;
  console.log(`   ${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

// --- 1. geometry sweep --------------------------------------------------------

const COUNT = 9138;
const COLUMNS = 8;
const TRACK = 208;
const GAP = 14;
const VIEWPORT = 900;
const STRIDE = TRACK + GAP;

function section(title) {
  console.log("");
  console.log(title);
}

async function geometrySweep() {
  section("1. window geometry over a 9,138-item listing (8 columns, 208 px rows, 14 px gap)");
  const totalRows = resultRowCount(COUNT, COLUMNS);
  const expectedRows = Math.ceil(COUNT / COLUMNS);
  assert.equal(totalRows, expectedRows, `row count should be ceil(${COUNT}/${COLUMNS})`);
  report("total rows", totalRows);

  const at = (relScroll) => resultWindowLayout({ count: COUNT, columns: COLUMNS, track: TRACK, gap: GAP, relScroll, viewportHeight: VIEWPORT, overscanRows: RESULT_WINDOW_OVERSCAN_ROWS, minRows: RESULT_WINDOW_MIN_ROWS, minItems: RESULT_WINDOW_MIN_ITEMS });
  const totalHeight = at(0).totalHeight;
  report("total height model", `${totalHeight} px (${totalRows} rows)`);

  const covered = new Uint8Array(COUNT);
  let maxItems = 0;
  let minItems = Number.MAX_SAFE_INTEGER;
  let steps = 0;
  for (let relScroll = -STRIDE; relScroll <= totalHeight + STRIDE; relScroll += 1) {
    const layout = at(relScroll);
    steps += 1;
    const renderedHeight = (layout.endRow - layout.startRow - 1) * layout.stride + TRACK;
    assert.equal(
      layout.paddingTop + renderedHeight + layout.paddingBottom,
      layout.totalHeight,
      `total height must not depend on the window (relScroll ${relScroll})`,
    );
    assert.equal(layout.totalHeight, totalHeight, "the total height must be constant across the sweep");
    assert.equal(layout.startIndex % COLUMNS, 0, `a window must start on a whole row (relScroll ${relScroll})`);
    assert.ok(layout.startIndex >= 0 && layout.endIndex <= COUNT, `the window must stay inside the listing (relScroll ${relScroll})`);
    assert.ok(layout.endIndex > layout.startIndex, `a non-empty listing must render something (relScroll ${relScroll})`);
    const items = layout.endIndex - layout.startIndex;
    maxItems = Math.max(maxItems, items);
    minItems = Math.min(minItems, items);
    for (let index = layout.startIndex; index < layout.endIndex; index += 1) covered[index] = 1;
    // The row under the viewport top must be inside the window.
    if (relScroll >= 0 && relScroll <= totalHeight - VIEWPORT) {
      const rowAtTop = Math.min(totalRows - 1, Math.floor(relScroll / STRIDE));
      assert.ok(rowAtTop >= layout.startRow && rowAtTop < layout.endRow, `the row at the viewport top must be mounted (relScroll ${relScroll})`);
    }
  }
  report("swept scroll positions (1 px steps)", steps);
  report("mounted items, smallest window", minItems);
  report("mounted items, largest window", maxItems);
  const missing = [];
  for (let index = 0; index < COUNT; index += 1) if (!covered[index]) missing.push(index);
  report("items never mounted across the sweep", missing.length);
  assert.equal(missing.length, 0, `every item must be reachable; first missing ${JSON.stringify(missing.slice(0, 5))}`);
  assert.ok(maxItems <= 200, `the window must stay bounded, got ${maxItems} items`);

  const bottom = at(totalHeight - VIEWPORT);
  assert.ok(bottom.endIndex === COUNT, "scrolling to the end must mount the last item");
  report("last item mounted at the bottom", `index ${COUNT - 1} (window ${bottom.startIndex}..${bottom.endIndex})`);
  const top = at(0);
  assert.equal(top.startIndex, 0, "the first row must be mounted at the top");
  report("first window", `${top.startIndex}..${top.endIndex} (${top.endIndex - top.startIndex} items)`);
  assert.ok(top.endIndex >= Math.min(COUNT, RESULT_WINDOW_MIN_ITEMS), "the first window must keep the existing eager-preview budget whole");

  // The bootstrap render, before any row height is measured, still bounds the DOM.
  const bootstrap = { ...at(0), endIndex: Math.min(COUNT, RESULT_WINDOW_BOOTSTRAP_ITEMS) };
  assert.ok(bootstrap.endIndex - bootstrap.startIndex <= RESULT_WINDOW_BOOTSTRAP_ITEMS, "the bootstrap render must be bounded too");
  report("bootstrap window", `${bootstrap.endIndex - bootstrap.startIndex} items`);

  // Anchored adoption of a changed row height.
  assert.equal(resultAnchoredScrollTop({ row: 100, stride: 222, contentTop: 1000, viewportOffset: 30 }), 1000 + 100 * 222 - 30);
  assert.equal(resultAnchoredScrollTop({ row: 0, stride: 222, contentTop: 0, viewportOffset: 0 }), 0);
  report("anchored scroll for row 100 of a 222 px stride", resultAnchoredScrollTop({ row: 100, stride: 222, contentTop: 1000, viewportOffset: 30 }));

  // Degenerate shapes keep the same guarantees.
  const shapes = [
    { count: 0, columns: 8 },
    { count: 1, columns: 8 },
    { count: 7, columns: 8 },
    { count: 8, columns: 8 },
    { count: 9, columns: 8 },
    { count: 16, columns: 8 },
    { count: 17, columns: 8 },
    { count: 5, columns: 1 },
    { count: 9138, columns: 1 },
  ];
  for (const shape of shapes) {
    const layout = resultWindowLayout({ count: shape.count, columns: shape.columns, track: 74, gap: 0, relScroll: 0, viewportHeight: VIEWPORT });
    const rows = resultRowCount(shape.count, shape.columns);
    if (shape.count === 0) {
      assert.equal(layout.endIndex, 0);
      continue;
    }
    assert.equal(layout.totalRows, rows, `row count for ${shape.count}x${shape.columns}`);
    assert.equal(layout.startIndex, 0);
    assert.ok(layout.endIndex > 0 && layout.endIndex <= shape.count, `window for ${shape.count}x${shape.columns}`);
    const renderedHeight = (layout.endRow - layout.startRow - 1) * layout.stride + 74;
    assert.equal(layout.paddingTop + renderedHeight + layout.paddingBottom, layout.totalHeight);
    const last = resultWindowLayout({ count: shape.count, columns: shape.columns, track: 74, gap: 0, relScroll: Math.max(0, layout.totalHeight - VIEWPORT), viewportHeight: VIEWPORT });
    assert.equal(last.endIndex, shape.count, `last item reachable for ${shape.count}x${shape.columns}`);
  }
  report("degenerate shapes (0/1/7/8/9/16/17 items, 1 and 8 columns, 1-column 9,138 rows)", "reachable, total-height invariant holds");

  assert.equal(resultRowForIndex(0, 8), 0);
  assert.equal(resultRowForIndex(8, 8), 1);
  assert.equal(resultRowForIndex(COUNT - 1, 8), totalRows - 1);
  report("row of the last item", resultRowForIndex(COUNT - 1, COLUMNS));
}

// --- 2. shipped-stylesheet layout contract (real Chrome) ----------------------

function builtStylesheet() {
  const root = process.env.CAIRN_WEB_DIST ? resolve(process.env.CAIRN_WEB_DIST) : join(repo, "web", "dist");
  const assets = join(root, "assets");
  if (!existsSync(assets)) {
    throw new Error(`there is no built WebUI at ${root}.\n      Build the client first:  cd web && npm run build`);
  }
  const name = readdirSync(assets).filter((entry) => entry.endsWith(".css")).sort().at(-1);
  if (!name) throw new Error(`${assets} holds no built stylesheet.\n      Build the client first:  cd web && npm run build`);
  return { path: join(assets, name), css: readFileSync(join(assets, name), "utf8") };
}

async function layoutContract() {
  section("2. layout contract of the built stylesheet (real Chrome)");
  const module = process.env.CAIRN_PLAYWRIGHT_MODULE || join(repo, "web", "node_modules", "playwright", "index.mjs");
  if (!existsSync(module)) throw new Error(`the browser check imports Playwright from ${module}, which does not exist.\n      Install the web toolchain first:  cd web && npm ci`);
  const chrome = (process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome").trim();
  if (!existsSync(chrome)) throw new Error(`the browser check launches Chrome at ${chrome}, which does not exist.\n      Set CAIRN_PLAYWRIGHT_EXECUTABLE_PATH to a Chrome/Chromium binary.`);
  const stylesheet = builtStylesheet();
  report("built stylesheet", stylesheet.path.slice(repo.length + 1));
  const { chromium } = await import(module);
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const row = (index, extra = "") => `<div class="result-row" data-result-index="${index}">${extra}<button class="result-open-copy"><strong>row ${index}</strong></button></div>`;
    const card = (index) => `<article class="photo-card" data-result-index="${index}"><button class="photo-card__image">image</button><div class="photo-card__caption"><button class="result-open-copy"><strong>card ${index}</strong></button></div></article>`;
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${stylesheet.css}</style>
      <style>body{margin:0}</style></head><body>
      <div style="width:160px">
        <div id="grid" class="result-list is-windowed" style="grid-auto-rows:minmax(200px, max-content);padding-top:400px;padding-bottom:600px">
          ${Array.from({ length: 6 }, (_, index) => row(index, index === 3 ? '<span style="display:block;height:320px"></span>' : "")).join("")}
        </div>
        <div id="list" class="result-list list-mode is-windowed" style="padding-top:128px;padding-bottom:192px">
          ${Array.from({ length: 5 }, (_, index) => row(index)).join("")}
        </div>
        <div id="wall" class="photo-wall is-windowed" style="--photo-card-min:180px;grid-auto-rows:minmax(150px, max-content);padding-top:150px;padding-bottom:300px">
          ${Array.from({ length: 6 }, (_, index) => card(index)).join("")}
        </div>
      </div></body></html>`);
    const measured = await page.evaluate(() => {
      const tops = (id) => Array.from(document.querySelectorAll(`#${id} [data-result-index]`)).map((node) => {
        const rect = node.getBoundingClientRect();
        const scroll = window.scrollY;
        return { index: Number(node.dataset.resultIndex), top: rect.top + scroll, height: rect.height, content: node.scrollHeight };
      });
      const grid = document.querySelector("#grid");
      const list = document.querySelector("#list");
      const wall = document.querySelector("#wall");
      const gridStyle = getComputedStyle(grid);
      const padTop = Number.parseFloat(gridStyle.paddingTop) || 0;
      const padBottom = Number.parseFloat(gridStyle.paddingBottom) || 0;
      const gap = Number.parseFloat(gridStyle.rowGap) || 0;
      const heights = tops("grid").map((entry) => entry.height);
      return {
        grid: tops("grid"),
        list: tops("list"),
        wall: tops("wall"),
        gridRowGap: gap,
        listRowGap: Number.parseFloat(getComputedStyle(list).rowGap) || 0,
        wallRowGap: Number.parseFloat(getComputedStyle(wall).rowGap) || 0,
        gridHeight: grid.getBoundingClientRect().height,
        modelHeight: padTop + padBottom + heights.reduce((total, height) => total + height, 0) + gap * (heights.length - 1),
        gridDisplay: gridStyle.display,
        listDisplay: getComputedStyle(list).display,
      };
    });
    report("grid row gap / display", `${measured.gridRowGap} / ${measured.gridDisplay}`);
    report("grid row heights", [...new Set(measured.grid.map((entry) => Math.round(entry.height)))]);
    const deltas = measured.grid.slice(1).map((entry, index) => Math.round(entry.top - measured.grid[index].top));
    report("grid row-top deltas", deltas);
    for (const [index, delta] of deltas.entries()) {
      const expected = measured.grid[index].height + measured.gridRowGap;
      assert.ok(Math.abs(delta - expected) <= 1, `row ${index + 1} must sit exactly one stride below row ${index}, got ${delta} for ${Math.round(expected)}`);
    }
    assert.equal(Math.round(measured.grid[0].height), 200, "a row with less content must keep the measured minimum height");
    for (const entry of measured.grid) if (entry.index !== 3) assert.equal(Math.round(entry.height), 200, `row ${entry.index} must keep the measured minimum height`);
    assert.ok(measured.grid.find((entry) => entry.index === 3).height >= 320, "a row whose content needs more must grow instead of being clipped");
    report("taller row height / content", `${Math.round(measured.grid.find((entry) => entry.index === 3).height)} / ${measured.grid.find((entry) => entry.index === 3).content}`);
    report("grid container height vs model", `${Math.round(measured.gridHeight)} vs ${Math.round(measured.modelHeight)}`);
    assert.equal(Math.round(measured.gridHeight), Math.round(measured.modelHeight), "the spacer must reproduce the model height exactly");

    const listHeights = measured.list.map((entry) => Math.round(entry.height));
    report("list-mode row heights / display", `${[...new Set(listHeights)]} / ${measured.listDisplay}`);
    assert.ok(Math.max(...listHeights) < 200, `list-mode rows must keep their own dense height, got ${Math.max(...listHeights)}`);
    assert.ok(Math.max(...listHeights) - Math.min(...listHeights) <= 2, `list-mode rows must be uniform, got ${JSON.stringify(listHeights)}`);
    const listDeltas = measured.list.slice(1).map((entry, index) => Math.round(entry.top - measured.list[index].top));
    report("list-mode row-top deltas", listDeltas);
    for (const [index, delta] of listDeltas.entries()) assert.ok(Math.abs(delta - listHeights[index]) <= 1, `a block list stacks rows contiguously, got delta ${delta} for a ${listHeights[index]} px row`);
    // `row-gap` still computes to the grid value on a block container even
    // though the layout ignores it, which is the trap the window's gap reader
    // has to avoid.
    report("list-mode computed row gap (not applied)", measured.listRowGap);
    if (measured.listRowGap > 0) assert.ok(listDeltas.every((delta, index) => delta < listHeights[index] + measured.listRowGap), "a computed row gap must not be added to a block list's row offsets");

    const wallHeights = measured.wall.map((entry) => Math.round(entry.height));
    report("photo-wall card heights", [...new Set(wallHeights)]);
    assert.ok(Math.min(...wallHeights) >= 150, `photo cards must keep the measured minimum height, got ${Math.min(...wallHeights)}`);
    assert.ok(Math.max(...wallHeights) - Math.min(...wallHeights) <= 1, `photo cards must be uniform, got ${JSON.stringify(wallHeights)}`);
    const wallDeltas = measured.wall.slice(1).map((entry, index) => Math.round(entry.top - measured.wall[index].top));
    for (const [index, delta] of wallDeltas.entries()) assert.ok(Math.abs(delta - (wallHeights[index] + measured.wallRowGap)) <= 1, `photo cards must sit one stride apart, got ${delta}`);
    report("photo-wall row gap / deltas", `${measured.wallRowGap} / ${JSON.stringify(wallDeltas)}`);
  } finally {
    await browser.close();
  }
}

// --- run ----------------------------------------------------------------------

try {
  await geometrySweep();
  await layoutContract();
  console.log("");
  console.log("PASS: the shared result window is bounded, total-height invariant, and every item is reachable");
  console.log("      (geometry sweep 9,138 items; shipped-stylesheet row contract in real Chrome)");
} catch (error) {
  failure = error;
}

if (failure) {
  console.error("");
  console.error(`FAIL: ${failure?.message ?? failure}`);
  process.exit(1);
}
