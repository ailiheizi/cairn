// Browser acceptance check for the admitted shared-favorite shortcut
// (RW-PERSONAL-UX-1, UX-F1): one favorite fact read back across domains,
// surviving a reload, and reconciled with the library's "Only favorites"
// filter.
//
// Favorites are not rendered on the generic library row and the domain
// presentations render different markup, so the starred set is read per domain
// and then reconciled against the library filter. Read-only: nothing is
// toggled.
//
// Assertions:
//   - the Photos presentation exposes at least one starred photo and the Music
//     presentation at least one starred track through the same `Favorite` tag;
//   - the starred photo names survive a full page reload;
//   - the library's "Only favorites" control is announced as pressed and
//     narrows the wall (0 < filtered < total);
//   - the filtered wall count equals the per-domain starred total, so the
//     shared filter and the domain presentations agree on one fact.
//
// Fixture assumption: the daemon at the target URL holds at least one
// favorited photo and at least one favorited music track, and every favorited
// subject in the loaded library scope is one of those (no other favorited
// subject). The counts and names are read at runtime.
//
// Usage:
//   node scripts/web-favorites-cross-domain-check.mjs [url]
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
async function poll(read, terminal, timeoutMs = 20000, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  while (Date.now() < deadline) {
    if (terminal(last)) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
    last = await read();
  }
  return last;
}

/** The starred subjects of the current presentation, by their nearest visible name. */
const readStarred = (page) => page.evaluate(() => {
  const pressed = [...document.querySelectorAll('.favorite-action[aria-pressed="true"]')];
  const names = pressed.map((element) => {
    const card = element.closest(".photo-card");
    if (card) return card.querySelector(".photo-card__name")?.textContent?.trim() ?? "";
    const row = element.closest("[data-result-index], tr, li, article, .music-track, .track-row");
    return row?.querySelector("strong, .track-title, .result-open-copy")?.textContent?.trim() ?? "";
  });
  return { count: pressed.length, names: names.filter(Boolean).sort() };
});

/** Poll until the favorite controls have resolved their stored state. */
const waitForFavoriteStatus = (page) => poll(
  () => page.evaluate(() => document.querySelectorAll(".favorite-action[aria-pressed]").length),
  (count) => count > 0,
  15000,
);

try {
  browser = await chromium.launch({ headless: true, executablePath: chrome });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator(".library-presentation-navigation__domain").first().waitFor({ state: "visible", timeout: 30000 });

  const domains = await page.$$eval(".library-presentation-navigation__domain", (nodes) => nodes.map((node) => ({ id: node.getAttribute("data-domain"), label: node.textContent.trim() })));
  observed.domains = domains;
  const domainId = (suffix) => (domains.find((domain) => (domain.id ?? "").endsWith(`:${suffix}`)) ?? domains.find((domain) => new RegExp(suffix, "i").test(domain.label)))?.id ?? null;

  const gotoDomain = async (suffix, marker) => {
    const id = domainId(suffix);
    assert.ok(id, `the Library navigation offers a ${suffix} presentation: observed ${JSON.stringify(domains)}`);
    await page.click(`.library-presentation-navigation__domain[data-domain="${id}"]`);
    await page.locator(marker).first().waitFor({ state: "visible", timeout: 20000 });
    await waitForFavoriteStatus(page);
  };

  await gotoDomain("photos", ".photo-card");
  const photos = await readStarred(page);
  observed.photos = photos;
  assert.ok(photos.count > 0, `Photos exposes a starred photo through the shared Favorite tag: observed ${JSON.stringify(photos)}`);

  await gotoDomain("music", ".music-track");
  const music = await readStarred(page);
  observed.music = music;
  assert.ok(music.count > 0, `Music exposes a starred track through the same tag: observed ${JSON.stringify(music)}`);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".library-presentation-navigation__domain").first().waitFor({ state: "visible", timeout: 30000 });
  await gotoDomain("photos", ".photo-card");
  const photosAfter = await readStarred(page);
  observed.photosAfterReload = photosAfter;
  assert.deepEqual(photosAfter.names, photos.names, `starred photos survive a full reload: observed before=${JSON.stringify(photos.names)} after=${JSON.stringify(photosAfter.names)}`);

  // The library filter must reconcile with the per-domain starred sets. The
  // ordinary All-content entry is the domain-grouped navigation's first button;
  // it may not carry a namespaced data-domain id, so resolve it by position when
  // no ":content" id is present.
  const contentId = domainId("content");
  const contentButton = contentId
    ? page.locator(`.library-presentation-navigation__domain[data-domain="${contentId}"]`).first()
    : page.locator(".library-presentation-navigation__domain").first();
  assert.equal(await contentButton.count(), 1, `the Library navigation offers the ordinary All-content presentation: observed ${JSON.stringify(domains)}`);
  await contentButton.click();
  await page.locator(".result-list:not(.list-mode) .result-row").first().waitFor({ state: "visible", timeout: 20000 });
  const total = await page.locator(".result-list:not(.list-mode) .result-row").count();
  observed.totalRows = total;

  const favoritesFilter = page.locator("button.library-return").filter({ hasText: /Only favorites|仅收藏/ }).first();
  assert.equal(await favoritesFilter.count(), 1, "the library exposes exactly one Only favorites control");
  await favoritesFilter.click();
  const pressed = await poll(() => favoritesFilter.getAttribute("aria-pressed"), (value) => value === "true", 10000);
  observed.filterPressed = pressed;
  assert.equal(pressed, "true", `the Only favorites filter announces itself as pressed: observed ${JSON.stringify(pressed)}`);
  await poll(
    () => page.locator(".result-list:not(.list-mode) .result-row").count(),
    (count) => count > 0 && count < total,
    10000,
  );
  const filtered = await page.locator(".result-list:not(.list-mode) .result-row").count();
  observed.filteredRows = filtered;
  assert.ok(filtered > 0 && filtered < total, `Only favorites narrows the wall: observed total=${total} filtered=${filtered}`);

  const expected = photos.count + music.count;
  observed.expectedFavorites = expected;
  assert.equal(filtered, expected, `Only favorites matches the per-domain starred total: observed filtered=${filtered} expected=${expected} photos=${JSON.stringify(photos.names)} music=${JSON.stringify(music.names)}`);
} catch (error) {
  failure = error;
} finally {
  if (browser) await browser.close();
}

console.log(`base                        : ${base}`);
console.log(`domains                     : ${JSON.stringify(observed.domains ?? null)}`);
console.log(`starred photos              : ${JSON.stringify(observed.photos ?? null)}`);
console.log(`starred music               : ${JSON.stringify(observed.music ?? null)}`);
console.log(`starred photos after reload : ${JSON.stringify(observed.photosAfterReload ?? null)}`);
console.log(`library total rows          : ${observed.totalRows ?? "not read"}`);
console.log(`filter aria-pressed         : ${JSON.stringify(observed.filterPressed ?? null)}`);
console.log(`filtered rows / expected    : ${observed.filteredRows ?? "not read"} / ${observed.expectedFavorites ?? "not read"}`);

if (failure) {
  console.error(`FAIL: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("PASS: one Favorite fact read back through Photos and Music, survived a reload, and the library's Only favorites filter reconciled exactly with the per-domain starred total.");
}
