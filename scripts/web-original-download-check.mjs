// Browser acceptance check for the admitted first-party client surface
// (RW-PERSONAL-UX-1, UX-T1/P2): the ordinary library row's original download at
// a phone viewport.
//
// Assertions:
//   - the library wall has at least one ordinary file row at 390x844;
//   - some row opens Details with a "Download original" action at that width;
//   - clicking it produces a REAL browser download event (not a same-tab
//     navigation) whose suggested filename is the item's own name;
//   - the download route serves the original with HTTP 200 and non-empty bytes,
//     verified independently by fetching the exact URL the browser downloaded.
//
// Fixture assumption: the daemon at the target URL serves at least one regular
// file subject in the library wall. The row and its name are read at runtime.
//
// Usage:
//   node scripts/web-original-download-check.mjs [url]
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
const observed = { downloads: [], navigations: [], routeResponses: [] };
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, locale: "en-US" });
  const page = await context.newPage();
  page.on("download", (download) => observed.downloads.push({ suggested: download.suggestedFilename(), url: download.url() }));
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) observed.navigations.push(frame.url()); });
  page.on("response", (response) => {
    try {
      const url = new URL(response.url());
      if (url.pathname === "/api/v1/download") observed.routeResponses.push({ status: response.status(), pathname: url.pathname });
    } catch { /* non-URL response */ }
  });

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator(".library-presentation-navigation__domain, .result-list .result-row").first().waitFor({ state: "visible", timeout: 30000 });

  const fileRows = page.locator(".result-list:not(.list-mode) .result-row.is-file");
  const rowCount = await fileRows.count();
  observed.rowCount = rowCount;
  assert.ok(rowCount > 0, `the library wall exposes at least one ordinary file row at 390x844: observed ${rowCount}`);

  // Prefer an ordinary file that actually carries bytes. The QA fixture contains
  // a legitimately empty file, and a zero-byte original proves nothing about
  // whether the route carries content, so the row's own declared size picks the
  // subject and later makes the byte oracle hold for either case.
  const sizeTokenOf = async (row) => {
    const meta = await row.locator(".result-meta").first().innerText().catch(() => "");
    return (meta.split("·")[0] ?? "").trim();
  };
  const isZeroByte = (token) => /^0\s*(B|bytes?)$/i.test(token);
  const candidates = [];
  for (let index = 0; index < Math.min(rowCount, 12); index += 1) {
    candidates.push({ index, sizeToken: await sizeTokenOf(fileRows.nth(index)) });
  }
  candidates.sort((a, b) => Number(isZeroByte(a.sizeToken)) - Number(isZeroByte(b.sizeToken)));

  let opened = null;
  let declaredSize = "";
  for (const candidate of candidates) {
    const openCopy = fileRows.nth(candidate.index).locator(".result-open-copy");
    if ((await openCopy.count()) === 0) continue;
    await openCopy.first().click();
    const state = await poll(() => page.evaluate(() => ({
      download: document.querySelectorAll("button.detail-download").length,
      back: document.querySelectorAll("button.detail-back").length,
    })), (value) => value.download > 0 || value.back > 0, 8000);
    if (state.download > 0) { opened = candidate.index; declaredSize = candidate.sizeToken; break; }
    if (state.back > 0) {
      await page.locator("button.detail-back").first().click();
      await poll(() => page.locator(".detail-column").count(), (count) => count === 0, 5000);
    }
  }
  observed.openedRow = opened;
  observed.declaredSize = declaredSize;
  assert.notEqual(opened, null, `some library row must open Details with a Download original action at 390x844: observed row=${opened} of ${rowCount}`);

  const name = (await page.locator(".detail-title-copy h2").innerText()).trim();
  observed.detailName = name;
  assert.ok(name.length > 0, "the open Details panel names the item");

  const navigationsBefore = observed.navigations.length;
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.locator("button.detail-download").first().click(),
  ]);
  const suggested = download.suggestedFilename();
  observed.downloadedSuggested = suggested;
  observed.downloadedURL = download.url();
  assert.ok(suggested.length > 0, "the download event reports a suggested filename");
  assert.equal(suggested, name, `the download keeps the original filename: observed ${JSON.stringify(suggested)} for ${JSON.stringify(name)}`);
  assert.equal(observed.navigations.length, navigationsBefore, `the download must not navigate the same tab: observed ${JSON.stringify(observed.navigations)}`);

  // Independent route oracle: fetch the exact URL the browser downloaded. A
  // download that fired but served an error body would otherwise look fine.
  const route = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "same-origin" });
    const bytes = await response.arrayBuffer();
    return { status: response.status, byteLength: bytes.byteLength };
  }, download.url());
  observed.route = route;
  assert.equal(route.status, 200, `the original download route serves the stored original: observed ${JSON.stringify(route)}`);
  // A zero-byte original is a legitimate case (the takeout acceptance covers it),
  // so the oracle follows the item's own declared size instead of assuming bytes.
  if (isZeroByte(declaredSize)) {
    assert.equal(route.byteLength, 0, `a zero-byte original downloads as zero bytes: observed ${JSON.stringify({ declaredSize, ...route })}`);
  } else {
    assert.ok(route.byteLength > 0, `the downloaded original carries bytes: observed ${JSON.stringify({ declaredSize, ...route })}`);
  }
  const badResponses = observed.routeResponses.filter((entry) => entry.status >= 400);
  assert.equal(badResponses.length, 0, `no download response reported an HTTP error: observed ${JSON.stringify(badResponses)}`);
} catch (error) {
  failure = error;
} finally {
  if (browser) await browser.close();
}

console.log(`base                        : ${base}`);
console.log(`file rows at 390px          : ${observed.rowCount ?? "not read"}`);
console.log(`row with Details + download : ${observed.openedRow ?? "none"}`);
console.log(`detail item name            : ${JSON.stringify(observed.detailName ?? null)}`);
console.log(`downloads                   : ${JSON.stringify(observed.downloads)}`);
console.log(`downloaded suggested name   : ${JSON.stringify(observed.downloadedSuggested ?? null)}`);
console.log(`same-tab navigations        : ${JSON.stringify(observed.navigations)}`);
console.log(`/api/v1/download responses  : ${JSON.stringify(observed.routeResponses)}`);
console.log(`independent route witness   : ${JSON.stringify(observed.route ?? null)}`);

if (failure) {
  console.error(`FAIL: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`PASS: "Download original" at 390x844 produced a real browser download named ${JSON.stringify(observed.downloadedSuggested)} with no same-tab navigation, and the route served non-empty original bytes.`);
}
