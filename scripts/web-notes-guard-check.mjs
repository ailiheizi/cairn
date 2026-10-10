// Browser acceptance check for the admitted library surface (RW-PERSONAL-UX-1,
// UX-C1): the cross-domain unsaved-Notes guard.
//
// Assertions:
//   - an ordinary file opens Details with a usable Notes draft field;
//   - the Activity rail entry is present;
//   - leaving for Activity with an unsaved draft raises a confirmation that
//     names the unsaved Notes;
//   - CANCEL blocks the cross-domain navigation and preserves the draft;
//   - CONFIRM proceeds with the navigation and discards the draft.
//
// The dialog is intercepted with Playwright's page dialog event, so both
// branches are exercised deterministically rather than by racing a modal. The
// run is read-only at the daemon: the draft is never saved.
//
// Fixture assumption: the daemon at the target URL serves at least one regular
// file subject in the library wall, and annotation mutation is available so the
// Notes composer is enabled. The row and draft text are read at runtime.
//
// Usage:
//   node scripts/web-notes-guard-check.mjs [url]
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
const observed = { dialogs: [] };
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

/** Poll until the observed state is unchanged for three consecutive samples. */
async function settle(read, timeoutMs = 2000, intervalMs = 150) {
  let last = await read();
  let stable = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
    const now = await read();
    if (now.detailsOpen === last.detailsOpen && now.activityOpen === last.activityOpen && now.draft === last.draft) {
      stable += 1;
      if (stable >= 3) return now;
    } else {
      stable = 0;
    }
    last = now;
  }
  return last;
}

try {
  browser = await chromium.launch({ headless: true, executablePath: chrome });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US" });

  let dialogMode = "dismiss";
  page.on("dialog", async (dialog) => {
    observed.dialogs.push({ type: dialog.type(), message: dialog.message(), handled: dialogMode });
    if (dialogMode === "dismiss") await dialog.dismiss();
    else await dialog.accept();
  });

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator(".result-list:not(.list-mode) .result-row").first().waitFor({ state: "visible", timeout: 30000 });

  // Open Details for an ordinary file and dirty the Notes draft.
  await page.locator(".result-list:not(.list-mode) .result-row.is-file").first().locator(".result-open-copy").click();
  const noteInput = page.locator('textarea[aria-label="New note"]');
  const draftCount = await poll(() => noteInput.count(), (count) => count > 0, 15000);
  observed.draftFieldCount = draftCount;
  assert.ok(draftCount > 0, `the Notes draft field is available: observed ${draftCount}`);
  const draftText = "reviewer draft kept across the guard";
  await noteInput.first().fill(draftText);
  await poll(() => noteInput.first().inputValue(), (value) => value === draftText, 8000);

  const state = () => page.evaluate(() => ({
    detailsOpen: document.querySelectorAll(".details").length > 0,
    activityOpen: document.querySelectorAll(".activity-surface, [data-view='activity'].content-column").length > 0,
    draft: document.querySelector('textarea[aria-label="New note"]')?.value ?? null,
    url: location.hash,
  }));

  const activityRail = page.locator('button.workspace-nav-item[data-view="activity"]');
  const railCount = await activityRail.count();
  observed.activityRailCount = railCount;
  assert.ok(railCount > 0, `the Activity rail entry is present: observed ${railCount}`);

  // 1. Cancel: navigation must be blocked and the draft preserved.
  const before = await state();
  observed.before = before;
  dialogMode = "dismiss";
  await activityRail.first().click();
  await poll(() => observed.dialogs.length, (count) => count > 0, 8000);
  const afterCancel = await settle(state);
  observed.afterCancel = afterCancel;
  assert.ok(observed.dialogs.length > 0 && /discard unsaved note changes|放弃未保存的备注更改/i.test(observed.dialogs[0].message), `the guard asked before leaving the draft: observed ${JSON.stringify(observed.dialogs)}`);
  assert.equal(afterCancel.detailsOpen, before.detailsOpen, `UX-C1: cancelling blocks the cross-domain navigation (Details stayed open): observed ${JSON.stringify({ before, afterCancel })}`);
  assert.equal(afterCancel.activityOpen, false, `UX-C1: cancelling does not open Activity: observed ${JSON.stringify(afterCancel)}`);
  assert.equal(afterCancel.draft, draftText, `UX-C1: cancelling preserves the unsaved draft: observed ${JSON.stringify(afterCancel.draft)}`);

  // 2. Confirm: navigation proceeds and the draft is discarded.
  dialogMode = "accept";
  await activityRail.first().click();
  const afterAccept = await poll(state, (value) => value.activityOpen === true || value.detailsOpen === false, 15000);
  observed.afterAccept = afterAccept;
  assert.ok(afterAccept.activityOpen === true || afterAccept.detailsOpen === false, `UX-C1: confirming proceeds with the navigation: observed ${JSON.stringify(afterAccept)}`);
  assert.ok(afterAccept.draft === null || afterAccept.draft === "", `UX-C1: confirming discards the draft: observed ${JSON.stringify(afterAccept.draft)}`);
} catch (error) {
  failure = error;
} finally {
  if (browser) await browser.close();
}

console.log(`base                        : ${base}`);
console.log(`Notes draft field count     : ${observed.draftFieldCount ?? "not read"}`);
console.log(`Activity rail count         : ${observed.activityRailCount ?? "not read"}`);
console.log(`dialogs                     : ${JSON.stringify(observed.dialogs)}`);
console.log(`before                      : ${JSON.stringify(observed.before ?? null)}`);
console.log(`after cancel                : ${JSON.stringify(observed.afterCancel ?? null)}`);
console.log(`after accept                : ${JSON.stringify(observed.afterAccept ?? null)}`);

if (failure) {
  console.error(`FAIL: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("PASS: cancelling the cross-domain unsaved-Notes confirmation blocked navigation and kept the draft, while confirming proceeded and discarded it.");
}
