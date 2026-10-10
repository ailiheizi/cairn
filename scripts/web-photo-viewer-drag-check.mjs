// Browser acceptance check for the admitted Photos client surface
// (RW-PERSONAL-UX-1): the photo viewer's pointer-drag matrix and its
// fit / actual-size round trip.
//
// It drives the real built client in real Chrome and dispatches real pointer
// input. Assertions:
//   - the Photos presentation is offered and the viewer opens on the first photo;
//   - a leftward drag advances one photo and a rightward drag returns;
//   - a rightward drag on the first photo clamps (it must not wrap to the end);
//   - a 30 px drag (below the viewer's 48 px threshold) does not navigate;
//   - a vertically dominant drag does not navigate;
//   - the viewer opens in fit mode, "Actual size" switches to is-large, the
//     "Fit to window" control becomes enabled there and returns to is-fit;
//   - Escape closes the viewer and restores focus into the opening photo card.
//
// Fixture assumption: the daemon at the target URL serves at least two photo
// subjects on its Photos presentation, in a stable order. Point it at an
// isolated QA profile holding real image originals; the card count is read at
// runtime and its ordering is the presentation's own.
//
// Usage:
//   node scripts/web-photo-viewer-drag-check.mjs [url]
//
// Environment:
//   CAIRN_BASE_URL                     default http://127.0.0.1:4648/
//   CAIRN_PLAYWRIGHT_EXECUTABLE_PATH   optional browser binary
//
// A failure exits nonzero with the concrete observation that failed.

import assert from "node:assert/strict";
import { chromium } from "../web/node_modules/playwright/index.mjs";

const base = (process.argv[2] || process.env.CAIRN_BASE_URL || "http://127.0.0.1:4648/").replace(/\/$/, "");
const chrome = process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const observed = {};
let failure;
let browser;

/** Poll a page read until it satisfies `terminal`, then return the last read. */
async function poll(read, terminal, timeoutMs = 15000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  while (Date.now() < deadline) {
    if (terminal(last)) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
    last = await read();
  }
  return last;
}

/** Poll until the read is unchanged for three consecutive samples, then return it. */
async function settle(read, timeoutMs = 2000, intervalMs = 100) {
  let last = await read();
  let stable = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
    const now = await read();
    if (now.index === last.index) {
      stable += 1;
      if (stable >= 3) return now;
    } else {
      stable = 0;
    }
    last = now;
  }
  return last;
}

const readPosition = (page) => page.evaluate(() => {
  const element = document.querySelector(".photo-viewer__identity span") ?? document.querySelector(".photo-viewer__identity");
  const raw = element?.textContent?.trim() ?? "";
  const match = raw.match(/(\d+)\D+(\d+)/);
  return { index: match ? Number(match[1]) : null, total: match ? Number(match[2]) : null, raw };
});

const readBody = (page) => page.evaluate(() => {
  const body = document.querySelector(".photo-viewer__body");
  const actions = [...document.querySelectorAll(".photo-viewer__actions button")].map((button) => ({
    label: button.getAttribute("aria-label"),
    disabled: button.disabled,
  }));
  return { bodyClass: body?.className ?? null, actions };
});

async function drag(page, box, fromRatio, toRatio, dy = 0) {
  const y = Math.round(box.y + box.height / 2);
  const fromX = Math.round(box.x + box.width * fromRatio);
  const toX = Math.round(box.x + box.width * toRatio);
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(fromX + ((toX - fromX) * step) / steps, y + (dy * step) / steps);
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
}

try {
  browser = await chromium.launch({ headless: true, executablePath: chrome });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator(".library-presentation-navigation__domain").first().waitFor({ state: "visible", timeout: 30000 });

  const domains = await page.$$eval(".library-presentation-navigation__domain", (nodes) => nodes.map((node) => ({ id: node.getAttribute("data-domain"), label: node.textContent.trim() })));
  const photos = domains.find((domain) => (domain.id ?? "").endsWith(":photos")) || domains.find((domain) => /photo/i.test(domain.label));
  observed.domains = domains;
  assert.ok(photos, `the compiled Photos presentation is offered in the Library navigation: observed ${JSON.stringify(domains)}`);
  await page.click(`.library-presentation-navigation__domain[data-domain="${photos.id}"]`);
  await page.locator(".photo-card").first().waitFor({ state: "visible", timeout: 20000 });

  const cards = await page.locator(".photo-card").count();
  observed.cardCount = cards;
  assert.ok(cards >= 2, `the Photos presentation must list at least two photos for a drag matrix: observed ${cards}`);

  await page.locator(".photo-card__image").first().click();
  await page.locator(".photo-viewer").waitFor({ state: "visible", timeout: 10000 });
  const start = await poll(() => readPosition(page), (state) => state.index === 1, 10000);
  observed.start = start;
  assert.equal(start.index, 1, `the viewer opens on the first photo: observed ${JSON.stringify(start)}`);

  const box = await page.locator(".photo-viewer__body").boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `the viewer body has a measurable drag area: observed ${JSON.stringify(box)}`);

  observed.dragForward = await drag(page, box, 0.75, 0.75 - 200 / box.width);
  const afterLeft = await poll(() => readPosition(page), (state) => state.index === 2, 5000);
  observed.afterSwipeLeft = afterLeft;
  assert.equal(afterLeft.index, 2, `a leftward drag advances to photo 2: observed ${JSON.stringify(afterLeft)}`);

  observed.dragBack = await drag(page, box, 0.25, 0.25 + 200 / box.width);
  const afterRight = await poll(() => readPosition(page), (state) => state.index === 1, 5000);
  observed.afterSwipeRight = afterRight;
  assert.equal(afterRight.index, 1, `a rightward drag returns to photo 1: observed ${JSON.stringify(afterRight)}`);

  await drag(page, box, 0.25, 0.25 + 200 / box.width);
  const clamped = await settle(() => readPosition(page));
  observed.afterClampSwipe = clamped;
  assert.equal(clamped.index, 1, `a rightward drag on the first photo clamps and must not wrap: observed ${JSON.stringify(clamped)}`);

  await drag(page, box, 0.5, 0.5 - 30 / box.width);
  const shortDrag = await settle(() => readPosition(page));
  observed.afterShortDrag = shortDrag;
  assert.equal(shortDrag.index, 1, `a 30 px drag (below the 48 px threshold) must not navigate: observed ${JSON.stringify(shortDrag)}`);

  await drag(page, box, 0.5, 0.5 - 120 / box.width, 160);
  const verticalDrag = await settle(() => readPosition(page));
  observed.afterVerticalDrag = verticalDrag;
  assert.equal(verticalDrag.index, 1, `a vertically dominant drag must not navigate: observed ${JSON.stringify(verticalDrag)}`);

  // fit / actual-size round trip: the control that was disabled in the wrong mode
  // is asserted here so the defect cannot come back.
  const actualSize = page.locator('.photo-viewer__actions button[aria-label="Actual size"], .photo-viewer__actions button[aria-label="原始尺寸"]').first();
  const fitToWindow = page.locator('.photo-viewer__actions button[aria-label="Fit to window"], .photo-viewer__actions button[aria-label="适应窗口"]').first();
  assert.equal(await actualSize.count(), 1, "the viewer exposes one Actual size control");
  assert.equal(await fitToWindow.count(), 1, "the viewer exposes one Fit to window control");
  const opened = await readBody(page);
  observed.openedBody = opened;
  assert.match(opened.bodyClass ?? "", /is-fit/, `the viewer opens in fit mode: observed ${JSON.stringify(opened.bodyClass)}`);
  assert.equal(await fitToWindow.isDisabled(), true, "in fit mode the Fit to window control is already applied and disabled");

  await actualSize.click();
  const large = await poll(() => readBody(page), (state) => /is-large/.test(state.bodyClass ?? ""), 5000);
  observed.actualSizeBody = large;
  assert.match(large.bodyClass ?? "", /is-large/, `Actual size switches the viewer body to is-large: observed ${JSON.stringify(large.bodyClass)}`);
  assert.equal(await fitToWindow.isDisabled(), false, `Fit to window must become available in actual-size mode: observed ${JSON.stringify(large.actions)}`);

  await fitToWindow.click();
  const refit = await poll(() => readBody(page), (state) => /is-fit/.test(state.bodyClass ?? ""), 5000);
  observed.refitBody = refit;
  assert.match(refit.bodyClass ?? "", /is-fit/, `Fit to window returns the viewer to is-fit: observed ${JSON.stringify(refit.bodyClass)}`);

  await page.keyboard.press("Escape");
  const closed = await poll(() => page.locator(".photo-viewer").count(), (count) => count === 0, 5000);
  observed.viewerCountAfterEscape = closed;
  assert.equal(closed, 0, `Escape closes the viewer: observed ${closed} viewer(s)`);
  // The restoration is scheduled on the next animation frame, so poll for it
  // instead of reading the focused element once.
  const focus = await poll(() => page.evaluate(() => {
    const element = document.activeElement;
    return { tag: element?.tagName ?? null, className: typeof element?.className === "string" ? element.className : null, insidePhotoCard: Boolean(element?.closest?.(".photo-card")) };
  }), (value) => value.insidePhotoCard === true, 5000);
  observed.focusAfterEscape = focus;
  assert.equal(focus.insidePhotoCard, true, `Escape restores focus into the opening photo card: observed ${JSON.stringify(focus)}`);
} catch (error) {
  failure = error;
} finally {
  if (browser) await browser.close();
}

console.log(`base                        : ${base}`);
console.log(`photos domains              : ${JSON.stringify(observed.domains ?? null)}`);
console.log(`photo cards                 : ${observed.cardCount ?? "not read"}`);
console.log(`viewer start                : ${JSON.stringify(observed.start ?? null)}`);
console.log(`after left drag             : ${JSON.stringify(observed.afterSwipeLeft ?? null)}`);
console.log(`after right drag            : ${JSON.stringify(observed.afterSwipeRight ?? null)}`);
console.log(`after clamp drag            : ${JSON.stringify(observed.afterClampSwipe ?? null)}`);
console.log(`after 30 px drag            : ${JSON.stringify(observed.afterShortDrag ?? null)}`);
console.log(`after vertical drag         : ${JSON.stringify(observed.afterVerticalDrag ?? null)}`);
console.log(`viewer body open            : ${JSON.stringify(observed.openedBody ?? null)}`);
console.log(`viewer body actual size     : ${JSON.stringify(observed.actualSizeBody ?? null)}`);
console.log(`viewer body refit           : ${JSON.stringify(observed.refitBody ?? null)}`);
console.log(`viewers after Escape        : ${observed.viewerCountAfterEscape ?? "not read"}`);
console.log(`focus after Escape          : ${JSON.stringify(observed.focusAfterEscape ?? null)}`);

if (failure) {
  console.error(`FAIL: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("PASS: the photo viewer's pointer-drag matrix (advance, return, clamp, sub-threshold, vertical), fit/actual-size round trip, and Escape focus restoration all hold.");
}
