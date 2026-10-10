// Browser acceptance check for the admitted first-party client surface
// (RW-PERSONAL-UX-1, UX-T1/P2): the original download of a real photograph
// reached through the Photos presentation at a phone viewport.
//
// Assertions:
//   - the Photos presentation is offered and lists at least two photos at
//     390x844;
//   - a real photograph is chosen (an image-named card, preferring JPEG) rather
//     than a placeholder;
//   - the card's own Details action exposes "Download original";
//   - clicking it produces a REAL browser download event whose suggested
//     filename is the photograph's own name, with no tab navigation;
//   - the download route serves the original with HTTP 200 and non-empty bytes,
//     verified independently by fetching the exact URL the browser downloaded.
//
// Fixture assumption: the daemon at the target URL serves the Photos
// presentation with at least two image subjects, at least one of them a real
// photograph whose displayed name is its original filename. Names and card
// count are read at runtime.
//
// Usage:
//   node scripts/web-photo-original-download-check.mjs [url]
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
const observed = { downloads: [], routeResponses: [] };
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
  page.on("response", (response) => {
    try {
      const url = new URL(response.url());
      if (url.pathname === "/api/v1/download") observed.routeResponses.push({ status: response.status(), pathname: url.pathname });
    } catch { /* non-URL response */ }
  });

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator(".library-presentation-navigation__domain").first().waitFor({ state: "visible", timeout: 30000 });
  const domains = await page.$$eval(".library-presentation-navigation__domain", (nodes) => nodes.map((node) => ({ id: node.getAttribute("data-domain"), label: node.textContent.trim() })));
  const photos = domains.find((domain) => (domain.id ?? "").endsWith(":photos")) || domains.find((domain) => /photo/i.test(domain.label));
  observed.domains = domains;
  assert.ok(photos, `the compiled Photos presentation is offered in the Library navigation: observed ${JSON.stringify(domains)}`);
  await page.click(`.library-presentation-navigation__domain[data-domain="${photos.id}"]`);
  await page.locator(".photo-card").first().waitFor({ state: "visible", timeout: 20000 });

  const cards = page.locator(".photo-card");
  const total = await cards.count();
  observed.cardCount = total;
  assert.ok(total >= 2, `the Photos presentation must list at least two photos at 390x844: observed ${total}`);

  const names = [];
  for (let index = 0; index < total; index += 1) {
    const name = await cards.nth(index).locator(".photo-card__name").innerText().catch(async () => cards.nth(index).innerText());
    names.push(name.trim());
  }
  observed.names = names;
  const jpeg = names.findIndex((name) => /\.(jpe?g)$/i.test(name));
  const targetIndex = jpeg >= 0 ? jpeg : 0;
  const targetName = names[targetIndex];
  observed.targetIndex = targetIndex;
  observed.targetName = targetName;
  assert.ok(targetName, `a real photograph card is chosen by name: observed ${JSON.stringify(names)}`);

  await cards.nth(targetIndex).locator(".photo-card__foot button").first().click();
  const downloadButton = page.locator("button.detail-download");
  const hasDownload = await poll(() => downloadButton.count(), (count) => count > 0, 10000);
  observed.hasDownload = hasDownload;
  assert.ok(hasDownload > 0, "the photo's Details panel exposes a Download original action");

  const urlBefore = page.url();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    downloadButton.first().click(),
  ]);
  observed.downloadedSuggested = download.suggestedFilename();
  observed.downloadedURL = download.url();
  assert.equal(observed.downloadedSuggested, targetName, `the photo download keeps the original filename: observed ${JSON.stringify(observed.downloadedSuggested)} for ${JSON.stringify(targetName)}`);
  assert.equal(page.url(), urlBefore, `the photo download must not navigate the tab: observed ${JSON.stringify(page.url())}`);

  const route = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "same-origin" });
    const bytes = await response.arrayBuffer();
    return { status: response.status, byteLength: bytes.byteLength };
  }, download.url());
  observed.route = route;
  assert.equal(route.status, 200, `the original download route serves the stored photograph: observed ${JSON.stringify(route)}`);
  assert.ok(route.byteLength > 0, `the downloaded photograph carries bytes: observed ${JSON.stringify(route)}`);
  const badResponses = observed.routeResponses.filter((entry) => entry.status >= 400);
  assert.equal(badResponses.length, 0, `no download response reported an HTTP error: observed ${JSON.stringify(badResponses)}`);
} catch (error) {
  failure = error;
} finally {
  if (browser) await browser.close();
}

console.log(`base                        : ${base}`);
console.log(`photos domains              : ${JSON.stringify(observed.domains ?? null)}`);
console.log(`photo cards at 390px        : ${observed.cardCount ?? "not read"}`);
console.log(`photo names                 : ${JSON.stringify(observed.names ?? null)}`);
console.log(`chosen photograph           : index=${observed.targetIndex ?? "none"} name=${JSON.stringify(observed.targetName ?? null)}`);
console.log(`Details exposes download    : ${observed.hasDownload ?? "not read"}`);
console.log(`downloads                   : ${JSON.stringify(observed.downloads)}`);
console.log(`downloaded suggested name   : ${JSON.stringify(observed.downloadedSuggested ?? null)}`);
console.log(`/api/v1/download responses  : ${JSON.stringify(observed.routeResponses)}`);
console.log(`independent route witness   : ${JSON.stringify(observed.route ?? null)}`);

if (failure) {
  console.error(`FAIL: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`PASS: a real photograph reached through Photos at 390x844 downloaded as ${JSON.stringify(observed.downloadedSuggested)} with no tab navigation, and the route served non-empty original bytes.`);
}
