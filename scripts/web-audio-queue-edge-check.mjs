// Browser acceptance check for the admitted Music client surface
// (RW-PERSONAL-UX-1, UX-Q1; ledger row M4): the transient audio queue's edge
// states.
//
// Assertions:
//   - the Music presentation exposes at least two "Add <name> to queue"
//     controls, and queueing two of them opens a two-entry queue;
//   - no queue item is current before playback starts;
//   - starting one occurrence marks exactly that occurrence current;
//   - the active queue item cannot be removed and its title explains that
//     playback must stop first;
//   - a non-current queue item remains removable;
//   - Stop clears the current occurrence and makes the previously active row
//     removable;
//   - removing one occurrence removes exactly one entry.
//
// Fixture assumption: the daemon at the target URL serves at least two audio
// subjects on its Music presentation. Nothing is saved or edited; the queue is
// transient.
//
// Usage:
//   node scripts/web-audio-queue-edge-check.mjs [url]
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

const readQueueItem = (locator) => locator.evaluate((item) => {
  const remove = [...item.querySelectorAll("button")].find((button) => (button.getAttribute("aria-label") || "").startsWith("Remove queue item"));
  const play = item.querySelector(".audio-queue-play");
  return {
    current: item.className.includes("current"),
    name: play?.textContent?.trim() ?? "",
    removeDisabled: remove?.disabled ?? null,
    removeTitle: remove?.getAttribute("title") ?? null,
    ariaCurrent: play?.getAttribute("aria-current") ?? null,
  };
});

try {
  browser = await chromium.launch({ headless: true, executablePath: chrome });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator(".library-presentation-navigation__domain").first().waitFor({ state: "visible", timeout: 30000 });

  const domains = await page.$$eval(".library-presentation-navigation__domain", (nodes) => nodes.map((node) => ({ id: node.getAttribute("data-domain"), label: node.textContent.trim() })));
  const music = domains.find((domain) => (domain.id ?? "").endsWith(":music")) || domains.find((domain) => /music/i.test(domain.label));
  observed.domains = domains;
  assert.ok(music, `the compiled Music presentation is offered in the Library navigation: observed ${JSON.stringify(domains)}`);
  await page.click(`.library-presentation-navigation__domain[data-domain="${music.id}"]`);
  await page.locator(".music-track").first().waitFor({ state: "visible", timeout: 20000 });

  const adders = page.getByRole("button", { name: /^Add .* to queue$/ });
  const addCount = await adders.count();
  observed.addControlCount = addCount;
  assert.ok(addCount >= 2, `the Music surface exposes at least two queue-add controls: observed ${addCount}`);
  for (let index = 0; index < Math.min(2, addCount); index += 1) {
    await adders.nth(index).click();
    await poll(() => page.locator(".audio-player-queue-item").count(), (count) => count >= index + 1, 8000);
  }

  const queueSummary = page.locator(".audio-player-queue summary");
  assert.equal(await queueSummary.count(), 1, "the queue control appears once items are queued");
  await queueSummary.first().click();
  await page.locator(".audio-player-queue-panel").waitFor({ state: "visible", timeout: 10000 });

  const items = page.locator(".audio-player-queue-item");
  const queued = await poll(() => items.count(), (count) => count >= 2, 8000);
  observed.queuedCount = queued;
  assert.ok(queued >= 2, `two occurrences are queued: observed ${queued}`);
  const currentBefore = await page.locator(".audio-player-queue-item.current").count();
  observed.currentBeforePlayback = currentBefore;
  assert.equal(currentBefore, 0, `no queue item is current before playback starts: observed ${currentBefore}`);

  await items.first().locator(".audio-queue-play").click();
  const currentCount = await poll(() => page.locator(".audio-player-queue-item.current").count(), (count) => count === 1, 15000);
  observed.currentAfterPlay = currentCount;
  assert.equal(currentCount, 1, `starting an item marks exactly that occurrence current: observed ${currentCount}`);

  const currentState = await readQueueItem(page.locator(".audio-player-queue-item.current").first());
  observed.currentItem = currentState;
  assert.equal(currentState.removeDisabled, true, `M4: the active queue item cannot be removed: observed ${JSON.stringify(currentState)}`);
  assert.match(currentState.removeTitle ?? "", /stop playback before removing/i, `M4: the active item explains why removal is blocked: observed ${JSON.stringify(currentState.removeTitle)}`);

  const all = await items.count();
  let otherState = null;
  for (let index = 0; index < all; index += 1) {
    const state = await readQueueItem(items.nth(index));
    if (!state.current) { otherState = state; break; }
  }
  observed.nonCurrentItem = otherState;
  assert.ok(otherState && otherState.removeDisabled === false, `a non-current queue item remains removable: observed ${JSON.stringify(otherState)}`);

  await page.locator(".audio-player-stop").click();
  const afterStopCurrent = await poll(() => page.locator(".audio-player-queue-item.current").count(), (count) => count === 0, 10000);
  observed.currentAfterStop = afterStopCurrent;
  assert.equal(afterStopCurrent, 0, `stopping clears the current occurrence: observed ${afterStopCurrent}`);
  const afterStopState = await readQueueItem(items.first());
  observed.itemAfterStop = afterStopState;
  assert.equal(afterStopState.removeDisabled, false, `M4: after Stop the previously active row becomes removable: observed ${JSON.stringify(afterStopState)}`);

  const before = await items.count();
  await items.first().locator('button[aria-label^="Remove queue item"]').click();
  const after = await poll(() => items.count(), (count) => count === before - 1, 10000);
  observed.removal = { before, after };
  assert.equal(after, before - 1, `removing one occurrence removes exactly one entry: observed before=${before} after=${after}`);
} catch (error) {
  failure = error;
} finally {
  if (browser) await browser.close();
}

console.log(`base                        : ${base}`);
console.log(`domains                     : ${JSON.stringify(observed.domains ?? null)}`);
console.log(`queue-add controls          : ${observed.addControlCount ?? "not read"}`);
console.log(`queued occurrences          : ${observed.queuedCount ?? "not read"}`);
console.log(`current before / after play : ${observed.currentBeforePlayback ?? "not read"} / ${observed.currentAfterPlay ?? "not read"}`);
console.log(`active item                 : ${JSON.stringify(observed.currentItem ?? null)}`);
console.log(`non-current item            : ${JSON.stringify(observed.nonCurrentItem ?? null)}`);
console.log(`current after Stop          : ${observed.currentAfterStop ?? "not read"}`);
console.log(`row after Stop              : ${JSON.stringify(observed.itemAfterStop ?? null)}`);
console.log(`removal before / after      : ${JSON.stringify(observed.removal ?? null)}`);

if (failure) {
  console.error(`FAIL: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("PASS: the active queue occurrence was protected from removal and explained why, a non-current occurrence stayed removable, Stop released the active row, and one removal removed exactly one entry.");
}
