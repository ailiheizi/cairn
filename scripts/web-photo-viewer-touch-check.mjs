// Browser acceptance check for the admitted Photos client surface
// (RW-PERSONAL-UX-1): the photo viewer's swipe matrix under REAL touch input.
//
// It uses a hasTouch / isMobile Chromium context and dispatches real CDP
// `Input.dispatchTouchEvent` sequences, so the touch-only CSS
// (`touch-action: pan-y`) is genuinely in play rather than simulated by a mouse
// drag. Assertions:
//   - the context reports touch support and the Photos presentation is offered;
//   - the viewer opens on the first photo;
//   - a left touch swipe advances to photo 2, a right touch swipe returns to 1;
//   - a right touch swipe on the first photo clamps (it must not wrap);
//   - a 30 px touch swipe (below the 48 px threshold) does not navigate;
//   - a vertically dominant touch swipe does not navigate.
//
// Fixture assumption: the daemon at the target URL serves at least two photo
// subjects on its Photos presentation, in a stable order. Point it at an
// isolated QA profile holding real image originals.
//
// Usage:
//   node scripts/web-photo-viewer-touch-check.mjs [url]
//
// Environment:
//   RESTOREWEAVE_BASE_URL                     default http://127.0.0.1:4648/
//   RESTOREWEAVE_PLAYWRIGHT_EXECUTABLE_PATH   optional browser binary
//
// A failure exits nonzero with the concrete observation that failed.

import assert from "node:assert/strict";
import { chromium } from "../web/node_modules/playwright/index.mjs";

const base = (process.argv[2] || process.env.RESTOREWEAVE_BASE_URL || "http://127.0.0.1:4648/").replace(/\/$/, "");
const chrome = process.env.RESTOREWEAVE_PLAYWRIGHT_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
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

/** Poll until the position is unchanged for three consecutive samples. */
async function settle(readPosition, timeoutMs = 2000, intervalMs = 100) {
  let last = await readPosition();
  let stable = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
    const now = await readPosition();
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

/** One real touch sequence through CDP, from touchStart to touchEnd. */
async function touchSwipe(cdp, page, startX, endX, centerY, dy = 0) {
  const points = (x, y) => [{ x: Math.round(x), y: Math.round(y), radiusX: 12, radiusY: 12, force: 1, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(startX, centerY) });
  const steps = 10;
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(startX + ((endX - startX) * step) / steps, centerY + (dy * step) / steps) });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

try {
  browser = await chromium.launch({ headless: true, executablePath: chrome });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    locale: "en-US",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator(".library-presentation-navigation__domain").first().waitFor({ state: "visible", timeout: 30000 });

  const domains = await page.$$eval(".library-presentation-navigation__domain", (nodes) => nodes.map((node) => ({ id: node.getAttribute("data-domain"), label: node.textContent.trim() })));
  const photos = domains.find((domain) => (domain.id ?? "").endsWith(":photos")) || domains.find((domain) => /photo/i.test(domain.label));
  observed.domains = domains;
  assert.ok(photos, `the compiled Photos presentation is offered in the Library navigation: observed ${JSON.stringify(domains)}`);
  await page.tap(`.library-presentation-navigation__domain[data-domain="${photos.id}"]`).catch(async () => {
    await page.click(`.library-presentation-navigation__domain[data-domain="${photos.id}"]`);
  });
  await page.locator(".photo-card").first().waitFor({ state: "visible", timeout: 20000 });

  const cards = await page.locator(".photo-card").count();
  observed.cardCount = cards;
  assert.ok(cards >= 2, `the Photos presentation must list at least two photos for a swipe matrix: observed ${cards}`);
  const hasTouch = await page.evaluate(() => "ontouchstart" in window || navigator.maxTouchPoints > 0);
  observed.hasTouch = hasTouch;
  assert.equal(hasTouch, true, "the touch context genuinely exposes touch support to the page");

  await page.locator(".photo-card__image").first().click();
  await page.locator(".photo-viewer").waitFor({ state: "visible", timeout: 10000 });
  const start = await poll(() => readPosition(page), (state) => state.index === 1, 10000);
  observed.start = start;
  assert.equal(start.index, 1, `the viewer opens on the first photo: observed ${JSON.stringify(start)}`);

  const box = await page.locator(".photo-viewer__body").boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `the viewer body has a measurable touch area: observed ${JSON.stringify(box)}`);
  const centerY = Math.round(box.y + box.height / 2);

  await touchSwipe(cdp, page, box.x + box.width * 0.75, box.x + box.width * 0.75 - 220, centerY);
  const afterLeft = await poll(() => readPosition(page), (state) => state.index === 2, 5000);
  observed.afterTouchLeft = afterLeft;
  assert.equal(afterLeft.index, 2, `a left touch swipe advances to photo 2: observed ${JSON.stringify(afterLeft)}`);

  await touchSwipe(cdp, page, box.x + box.width * 0.25, box.x + box.width * 0.25 + 220, centerY);
  const afterRight = await poll(() => readPosition(page), (state) => state.index === 1, 5000);
  observed.afterTouchRight = afterRight;
  assert.equal(afterRight.index, 1, `a right touch swipe returns to photo 1: observed ${JSON.stringify(afterRight)}`);

  await touchSwipe(cdp, page, box.x + box.width * 0.25, box.x + box.width * 0.25 + 220, centerY);
  const clamped = await settle(() => readPosition(page));
  observed.afterTouchClamp = clamped;
  assert.equal(clamped.index, 1, `a right touch swipe on the first photo clamps and must not wrap: observed ${JSON.stringify(clamped)}`);

  await touchSwipe(cdp, page, box.x + box.width * 0.5, box.x + box.width * 0.5 - 30, centerY);
  const shortSwipe = await settle(() => readPosition(page));
  observed.afterShortTouch = shortSwipe;
  assert.equal(shortSwipe.index, 1, `a 30 px touch swipe (below the 48 px threshold) must not navigate: observed ${JSON.stringify(shortSwipe)}`);

  await touchSwipe(cdp, page, box.x + box.width * 0.5, box.x + box.width * 0.5 - 130, centerY, 170);
  const verticalSwipe = await settle(() => readPosition(page));
  observed.afterVerticalTouch = verticalSwipe;
  assert.equal(verticalSwipe.index, 1, `a vertically dominant touch swipe must not navigate: observed ${JSON.stringify(verticalSwipe)}`);
} catch (error) {
  failure = error;
} finally {
  if (browser) await browser.close();
}

console.log(`base                        : ${base}`);
console.log(`photos domains              : ${JSON.stringify(observed.domains ?? null)}`);
console.log(`photo cards                 : ${observed.cardCount ?? "not read"}`);
console.log(`context hasTouch            : ${observed.hasTouch ?? "not read"}`);
console.log(`viewer start                : ${JSON.stringify(observed.start ?? null)}`);
console.log(`after touch left            : ${JSON.stringify(observed.afterTouchLeft ?? null)}`);
console.log(`after touch right           : ${JSON.stringify(observed.afterTouchRight ?? null)}`);
console.log(`after touch clamp           : ${JSON.stringify(observed.afterTouchClamp ?? null)}`);
console.log(`after 30 px touch           : ${JSON.stringify(observed.afterShortTouch ?? null)}`);
console.log(`after vertical touch        : ${JSON.stringify(observed.afterVerticalTouch ?? null)}`);

if (failure) {
  console.error(`FAIL: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("PASS: real CDP touch input drives the photo viewer's swipe matrix (advance, return, clamp, sub-threshold, vertical) in a hasTouch context.");
}
