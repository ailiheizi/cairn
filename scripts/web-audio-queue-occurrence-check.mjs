// Browser acceptance check for the admitted Music client surface
// (RW-PERSONAL-UX-1, UX-Q1): occurrence-aware transient queueing.
//
// Assertions:
//   - the same file can be queued twice, producing two independent occurrences
//     with the same displayed name;
//   - only the played occurrence becomes current; the duplicate is not also
//     current;
//   - the non-current duplicate stays removable;
//   - after Stop, removing one repetition preserves the other;
//   - the queue survives a domain navigation (Photos and back to Music)
//     unchanged.
//
// Fixture assumption: the daemon at the target URL serves at least one audio
// subject on its Music presentation, and the Music surface exposes its
// "Add <name> to queue" control. Nothing is saved or edited.
//
// Usage:
//   node scripts/web-audio-queue-occurrence-check.mjs [url]
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

try {
  browser = await chromium.launch({ headless: true, executablePath: chrome });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator(".library-presentation-navigation__domain").first().waitFor({ state: "visible", timeout: 30000 });

  const domains = await page.$$eval(".library-presentation-navigation__domain", (nodes) => nodes.map((node) => ({ id: node.getAttribute("data-domain"), label: node.textContent.trim() })));
  observed.domains = domains;
  const domainId = (suffix) => (domains.find((domain) => (domain.id ?? "").endsWith(`:${suffix}`)) ?? domains.find((domain) => new RegExp(suffix, "i").test(domain.label)))?.id ?? null;
  const music = domainId("music");
  const photos = domainId("photos");
  assert.ok(music, `the compiled Music presentation is offered in the Library navigation: observed ${JSON.stringify(domains)}`);
  assert.ok(photos, `the compiled Photos presentation is offered in the Library navigation: observed ${JSON.stringify(domains)}`);
  await page.click(`.library-presentation-navigation__domain[data-domain="${music}"]`);
  await page.locator(".music-track").first().waitFor({ state: "visible", timeout: 20000 });

  // Add the SAME track twice: two distinct occurrences of one file identity.
  const adder = page.getByRole("button", { name: /^Add .* to queue$/ }).first();
  const adderName = (await adder.getAttribute("aria-label")) ?? "";
  observed.adderLabel = adderName;
  await adder.click();
  await adder.click();
  await page.locator(".audio-player-queue summary").first().click();
  await page.locator(".audio-player-queue-panel").waitFor({ state: "visible", timeout: 10000 });

  const items = page.locator(".audio-player-queue-item");
  await poll(() => items.count(), (count) => count === 2, 10000);
  const count = await items.count();
  const names = (await page.locator(".audio-queue-play").allInnerTexts()).map((name) => name.trim());
  observed.queued = { count, names, adderName };
  assert.ok(count === 2 && names[0] === names[1], `the same file can be queued twice as two occurrences: observed ${JSON.stringify({ count, names, adderName })}`);

  await items.first().locator(".audio-queue-play").click();
  const currentCount = await poll(() => page.locator(".audio-player-queue-item.current").count(), (value) => value === 1, 20000);
  const currentIndex = await page.evaluate(() => [...document.querySelectorAll(".audio-player-queue-item")].findIndex((item) => item.className.includes("current")));
  observed.currentIndex = currentIndex;
  observed.currentCount = currentCount;
  assert.equal(currentIndex, 0, `UX-Q1: only the played repetition becomes current: observed currentIndex=${currentIndex}`);
  assert.equal(currentCount, 1, `UX-Q1: the duplicate occurrence is not also current: observed current=${currentCount}`);

  const secondRemove = items.nth(1).locator('button[aria-label^="Remove queue item"]');
  const secondRemovable = !(await secondRemove.isDisabled());
  observed.duplicateRemovable = secondRemovable;
  assert.equal(secondRemovable, true, "the non-current duplicate stays removable");

  await page.locator(".audio-player-stop").click();
  await poll(() => page.locator(".audio-player-queue-item.current").count(), (value) => value === 0, 10000);
  const before = await items.count();
  await items.first().locator('button[aria-label^="Remove queue item"]').click();
  const after = await poll(() => items.count(), (value) => value === before - 1, 10000);
  const afterNames = (await page.locator(".audio-queue-play").allInnerTexts()).map((name) => name.trim());
  observed.afterRemoval = { before, after, afterNames };
  assert.ok(after === before - 1 && afterNames.length === 1 && afterNames[0] === names[0], `UX-Q1: removing one repetition preserves the other: observed ${JSON.stringify(observed.afterRemoval)}`);

  // Navigation must not silently drop or duplicate the transient queue. The
  // queue list lives in the DOM regardless of whether the <details> is open, so
  // the count is read directly after the presentation round trip.
  await page.click(`.library-presentation-navigation__domain[data-domain="${photos}"]`);
  await page.locator(".photo-card").first().waitFor({ state: "visible", timeout: 20000 });
  await page.click(`.library-presentation-navigation__domain[data-domain="${music}"]`);
  await page.locator(".music-track").first().waitFor({ state: "visible", timeout: 20000 });
  const afterNav = await poll(() => page.locator(".audio-player-queue-item").count(), (value) => value === after, 10000);
  observed.afterNavigation = afterNav;
  assert.equal(afterNav, after, `UX-Q1: the queue survives domain navigation unchanged: observed ${JSON.stringify({ after, afterNav })}`);
} catch (error) {
  failure = error;
} finally {
  if (browser) await browser.close();
}

console.log(`base                        : ${base}`);
console.log(`domains                     : ${JSON.stringify(observed.domains ?? null)}`);
console.log(`queue-add label             : ${JSON.stringify(observed.adderLabel ?? null)}`);
console.log(`queued occurrences          : ${JSON.stringify(observed.queued ?? null)}`);
console.log(`current index / count       : ${observed.currentIndex ?? "not read"} / ${observed.currentCount ?? "not read"}`);
console.log(`duplicate removable         : ${observed.duplicateRemovable ?? "not read"}`);
console.log(`after removal               : ${JSON.stringify(observed.afterRemoval ?? null)}`);
console.log(`after domain navigation     : ${observed.afterNavigation ?? "not read"}`);

if (failure) {
  console.error(`FAIL: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("PASS: two occurrences of one file stayed independent, only the played one became current, removing one preserved the other, and the queue survived domain navigation.");
}
