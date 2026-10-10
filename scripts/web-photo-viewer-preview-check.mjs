// Browser acceptance check for the admitted Photos client surface
// (RW-PERSONAL-UX-1): the photo viewer's honest preview state for every loaded
// photo, plus its fit / actual-size toggle.
//
// Assertions:
//   - the Photos presentation is offered and lists at least two photos;
//   - opening each loaded photo mounts the viewer with either an <img> or an
//     explicit status/alert element: a silent blank preview is a failure;
//   - the viewer opens in fit mode, "Actual size" switches to is-large, and
//     "Fit to window" returns to is-fit.
//
// Read-only: nothing is saved or edited. Fixture assumption: the daemon at the
// target URL serves the Photos presentation with at least two photo subjects;
// the count and each subject's outcome are read at runtime, so a photo that
// legitimately cannot be rendered must show its own explicit status rather than
// pass by omission.
//
// Usage:
//   node scripts/web-photo-viewer-preview-check.mjs [url]
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

const readViewer = (page) => page.evaluate(() => {
  const body = document.querySelector(".photo-viewer__body");
  if (!body) return { mounted: false };
  const image = body.querySelector("img");
  const status = body.querySelector('[role="status"], [role="alert"], .cairn-content-preview__status');
  const name = document.querySelector(".photo-viewer__identity h2")?.textContent?.trim() ?? "";
  const position = document.querySelector(".photo-viewer__identity span")?.textContent?.trim() ?? "";
  return {
    mounted: true,
    name,
    position,
    hasImage: Boolean(image),
    imageComplete: image ? image.complete : null,
    imageNaturalWidth: image ? image.naturalWidth : null,
    hasStatus: Boolean(status),
    statusText: status ? status.textContent.trim().slice(0, 90) : null,
    bodyClass: body.className,
    blank: !image && !status,
  };
});

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

  const total = await page.locator(".photo-card").count();
  observed.cardCount = total;
  assert.ok(total >= 2, `the Photos presentation must list at least two photos: observed ${total}`);

  const perPhoto = [];
  for (let index = 0; index < total; index += 1) {
    await page.locator(".photo-card__image").nth(index).click();
    const state = await poll(() => readViewer(page), (value) => value.mounted && (value.hasImage || value.hasStatus), 12000);
    perPhoto.push({ index, ...state });
    await page.keyboard.press("Escape");
    await poll(() => page.locator(".photo-viewer").count(), (count) => count === 0, 5000);
  }
  observed.perPhoto = perPhoto;

  const blanks = perPhoto.filter((photo) => photo.blank || !photo.mounted);
  assert.equal(blanks.length, 0, `no loaded photo may render a silent blank preview: observed ${JSON.stringify(blanks)}`);
  const withImage = perPhoto.filter((photo) => photo.hasImage);
  const withStatus = perPhoto.filter((photo) => photo.hasStatus);
  observed.withImage = withImage.length;
  observed.withStatus = withStatus.length;
  const noOutcome = perPhoto.filter((photo) => !photo.hasImage && !photo.hasStatus);
  assert.equal(noOutcome.length, 0, `every photo has an image or an explicit status: image=${withImage.length} status=${withStatus.length} total=${perPhoto.length} withoutOutcome=${JSON.stringify(noOutcome.map((photo) => photo.index))}`);

  // fit / actual-size toggle
  await page.locator(".photo-card__image").first().click();
  const fittedBody = await poll(() => readViewer(page), (state) => state.mounted, 10000);
  observed.fitBody = fittedBody.bodyClass;
  assert.match(fittedBody.bodyClass ?? "", /is-fit/, `the viewer opens in fit mode: observed ${JSON.stringify(fittedBody.bodyClass)}`);
  const actualSize = page.locator('.photo-viewer__actions button[aria-label="Actual size"], .photo-viewer__actions button[aria-label="原始尺寸"]').first();
  const fitToWindow = page.locator('.photo-viewer__actions button[aria-label="Fit to window"], .photo-viewer__actions button[aria-label="适应窗口"]').first();
  await actualSize.click();
  const largeBody = await poll(() => readViewer(page), (state) => /is-large/.test(state.bodyClass ?? ""), 5000);
  observed.largeBody = largeBody.bodyClass;
  assert.match(largeBody.bodyClass ?? "", /is-large/, `Actual size switches the viewer body to is-large: observed ${JSON.stringify(largeBody.bodyClass)}`);
  assert.equal(await fitToWindow.isDisabled(), false, "Fit to window is available in actual-size mode");
  await fitToWindow.click();
  const refitBody = await poll(() => readViewer(page), (state) => /is-fit/.test(state.bodyClass ?? ""), 5000);
  observed.refitBody = refitBody.bodyClass;
  assert.match(refitBody.bodyClass ?? "", /is-fit/, `Fit to window returns the viewer to is-fit: observed ${JSON.stringify(refitBody.bodyClass)}`);
} catch (error) {
  failure = error;
} finally {
  if (browser) await browser.close();
}

console.log(`base                        : ${base}`);
console.log(`photos domains              : ${JSON.stringify(observed.domains ?? null)}`);
console.log(`photo cards                 : ${observed.cardCount ?? "not read"}`);
for (const photo of observed.perPhoto ?? []) {
  console.log(`  photo ${photo.index}                  : mounted=${photo.mounted} image=${photo.hasImage} naturalWidth=${photo.imageNaturalWidth} status=${photo.hasStatus} statusText=${JSON.stringify(photo.statusText)} name=${JSON.stringify(photo.name)}`);
}
console.log(`photos with image / status  : ${observed.withImage ?? "not read"} / ${observed.withStatus ?? "not read"}`);
console.log(`viewer body open / large / refit : ${JSON.stringify(observed.fitBody ?? null)} / ${JSON.stringify(observed.largeBody ?? null)} / ${JSON.stringify(observed.refitBody ?? null)}`);

if (failure) {
  console.error(`FAIL: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("PASS: every loaded photo rendered an image or an explicit status with no silent blank, and the fit/actual-size toggle round-tripped.");
}
