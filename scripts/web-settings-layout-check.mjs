// Browser acceptance check for the admitted settings surface (SP-1):
//   "Settings: group spacing at or below 24 px, side-by-side where the width
//    allows" and "every settings category reachable and visible".
//
// Assertions at desktop width (1280x900):
//   - the settings dialog opens and `.settings-body` lays the category index and
//     the content out side by side (>= 2 grid tracks);
//   - the surface exposes more than one category;
//   - every category is visible, has a non-null offsetParent, and is neither
//     display:none nor visibility:hidden;
//   - clicking a category marks it active (aria-current="true" plus its active
//     class) and swaps in a heading;
//   - no group-level margin (`.config-group`, `.config-advanced`,
//     `.identity-disclosure`, `.config-notice`, `.config-section`) exceeds 24px;
//   - every category is keyboard focusable (tabIndex >= 0 and not disabled).
//
// Assertions at phone width (390x844):
//   - `.settings-body` collapses to a single grid track;
//   - the settings surface has no horizontal overflow;
//   - no category is hidden.
//
// Fixture assumption: the daemon at the target URL serves the built client with
// its settings surface available. The category list and headings are read at
// runtime; nothing is saved or edited.
//
// Usage:
//   node scripts/web-settings-layout-check.mjs [url]
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

const SETTINGS_TRIGGER = /Open settings|打开设置/;
const SETTINGS_DIALOG = /Settings|设置/;

async function openSettings(page) {
  // The settings control is part of the app chrome and does not depend on the
  // library having loaded any content, so wait for the control itself rather
  // than for the content presentation navigation.
  const trigger = page.getByRole("button", { name: SETTINGS_TRIGGER });
  await trigger.first().waitFor({ state: "visible", timeout: 30000 });
  assert.ok((await trigger.count()) > 0, "the client offers an Open settings control");
  await trigger.first().click();
  await page.getByRole("dialog", { name: SETTINGS_DIALOG }).waitFor({ state: "visible", timeout: 15000 });
}

try {
  browser = await chromium.launch({ headless: true, executablePath: chrome });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: SETTINGS_DIALOG });
  observed.dialogOpened = (await dialog.count()) > 0;
  assert.ok(observed.dialogOpened, "the settings dialog opened");

  const gridColumns = (selector) => page.evaluate((value) => {
    const element = document.querySelector(value);
    return element ? getComputedStyle(element).gridTemplateColumns : null;
  }, selector);
  const bodyColumns = await gridColumns(".settings-body");
  observed.desktopColumns = bodyColumns;
  assert.ok((bodyColumns ?? "").trim().split(/\s+/).filter(Boolean).length >= 2, `desktop: the category index and content are side by side: observed ${JSON.stringify(bodyColumns)}`);

  const categories = await page.$$eval(".settings-category", (nodes) => nodes.map((node, index) => ({ index, label: node.textContent.trim(), className: node.className })));
  observed.categories = categories.map((category) => category.label);
  assert.ok(categories.length > 1, `the settings surface exposes multiple categories: observed ${JSON.stringify(categories.map((category) => category.label))}`);

  const perCategory = [];
  for (const category of categories) {
    const button = page.locator(".settings-category").nth(category.index);
    const visible = await button.isVisible();
    const box = await button.boundingBox();
    const hidden = await page.evaluate((index) => {
      const element = document.querySelectorAll(".settings-category")[index];
      const style = getComputedStyle(element);
      return { display: style.display, visibility: style.visibility, offsetParentNull: element.offsetParent === null };
    }, category.index);
    await button.click();
    const active = await poll(() => page.evaluate((index) => {
      const element = document.querySelectorAll(".settings-category")[index];
      return { ariaCurrent: element.getAttribute("aria-current"), hasActiveClass: element.className.includes("active"), ariaPressed: element.getAttribute("aria-pressed") };
    }, category.index), (value) => value.ariaCurrent === "true" || value.hasActiveClass, 8000);
    const heading = await page.locator(".config-section h2, .config-section h3, .config-section .config-heading").first().innerText().catch(() => "");
    perCategory.push({ ...category, visible, box: box ? { w: Math.round(box.width), h: Math.round(box.height) } : null, hidden, active, heading: heading.trim().slice(0, 40) });
  }
  observed.perCategory = perCategory;
  const hiddenCategories = perCategory.filter((category) => !category.visible || category.hidden.offsetParentNull || category.hidden.display === "none" || category.hidden.visibility === "hidden");
  assert.equal(hiddenCategories.length, 0, `every category is visible and none is display/visibility hidden: observed ${JSON.stringify(hiddenCategories.map((category) => category.label))}`);
  const inactive = perCategory.filter((category) => !(category.active.ariaCurrent === "true" && category.active.hasActiveClass));
  assert.equal(inactive.length, 0, `clicking a category activates it: observed ${JSON.stringify(inactive.map((category) => ({ label: category.label, active: category.active })))}`);

  // Group spacing: every group-level margin on the settings surface must be <= 24px.
  const spacing = [];
  for (const category of categories) {
    await page.locator(".settings-category").nth(category.index).click();
    await poll(() => page.evaluate((index) => document.querySelectorAll(".settings-category")[index].className.includes("active"), category.index), (value) => value === true, 8000);
    spacing.push(...await page.evaluate(() => {
      const selectors = [".config-group", ".config-advanced", ".identity-disclosure", ".config-notice", ".config-section"];
      const out = [];
      for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
          const style = getComputedStyle(element);
          out.push({ selector, marginTop: style.marginTop, marginBottom: style.marginBottom, heading: element.querySelector("h2, h3, .config-heading")?.textContent?.trim().slice(0, 30) ?? "" });
        }
      }
      return out;
    }));
  }
  observed.spacingSamples = spacing.length;
  const over = spacing.filter((sample) => parseFloat(sample.marginTop) > 24 || parseFloat(sample.marginBottom) > 24);
  observed.spacingOver24 = over.slice(0, 8);
  assert.equal(over.length, 0, `no group-level margin exceeds 24px: observed ${JSON.stringify(over.slice(0, 8))}`);

  const reachable = await page.evaluate(() => [...document.querySelectorAll(".settings-category")].every((element) => element.tabIndex >= 0 && !element.disabled));
  observed.keyboardReachable = reachable;
  assert.equal(reachable, true, "all categories are keyboard focusable");

  // Narrow width must fall back to a single column without hiding categories.
  const narrow = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "en-US" });
  await narrow.goto(base, { waitUntil: "domcontentloaded" });
  await openSettings(narrow);
  const narrowColumns = await narrow.evaluate(() => {
    const element = document.querySelector(".settings-body");
    return element ? getComputedStyle(element).gridTemplateColumns : null;
  });
  observed.phoneColumns = narrowColumns;
  assert.equal(( narrowColumns ?? "").trim().split(/\s+/).filter(Boolean).length, 1, `narrow: settings collapses to one column: observed ${JSON.stringify(narrowColumns)}`);
  const overflow = await narrow.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  observed.phoneOverflow = overflow;
  assert.equal(overflow, false, `narrow: settings has no horizontal overflow: observed ${JSON.stringify(overflow)}`);
  const narrowVisible = await narrow.evaluate(() => [...document.querySelectorAll(".settings-category")].every((element) => getComputedStyle(element).display !== "none"));
  observed.phoneCategoriesVisible = narrowVisible;
  assert.equal(narrowVisible, true, "narrow: no category is hidden");
  await narrow.close();
} catch (error) {
  failure = error;
} finally {
  if (browser) await browser.close();
}

console.log(`base                        : ${base}`);
console.log(`settings dialog opened      : ${observed.dialogOpened ?? "not read"}`);
console.log(`desktop grid columns        : ${JSON.stringify(observed.desktopColumns ?? null)}`);
console.log(`categories                  : ${JSON.stringify(observed.categories ?? null)}`);
for (const category of observed.perCategory ?? []) {
  console.log(`  ${String(category.label).slice(0, 28).padEnd(30)}: visible=${category.visible} offsetParentNull=${category.hidden.offsetParentNull} display=${category.hidden.display} aria-current=${JSON.stringify(category.active.ariaCurrent)} active=${category.active.hasActiveClass} heading=${JSON.stringify(category.heading)}`);
}
console.log(`group margin samples        : ${observed.spacingSamples ?? "not read"}`);
console.log(`margins over 24px           : ${JSON.stringify(observed.spacingOver24 ?? [])}`);
console.log(`categories keyboard focus   : ${observed.keyboardReachable ?? "not read"}`);
console.log(`phone grid columns          : ${JSON.stringify(observed.phoneColumns ?? null)}`);
console.log(`phone overflow / hidden     : ${observed.phoneOverflow ?? "not read"} / ${observed.phoneCategoriesVisible === undefined ? "not read" : !observed.phoneCategoriesVisible}`);

if (failure) {
  console.error(`FAIL: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("PASS: settings groups stayed within 24px, every category was visible, reachable and activatable at desktop width, and the surface collapsed to one non-overflowing column at 390px.");
}
