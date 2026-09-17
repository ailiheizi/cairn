// Shared E2E assertion helpers.
//
// These are the phase-independent helpers the surface modules call: text and
// regex plumbing, the sticky-action-bar geometry check, the overflow check,
// focus return, and the settings layout probes. They take the harness context
// (which owns `page`) as their first argument and never read or write the
// captured daemon state.

import assert from "node:assert/strict";

export function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export async function fillNoteDraft(ctx, composer, addNote) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await composer.fill("unsaved browser note draft");
    if (await addNote.isEnabled()) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  assert.fail("the note composer never kept the unsaved draft");
}

// The add-source and restore drawers pin their next action to the bottom edge:
// the bar must be inside the viewport without scrolling, and it must not move
// when the review body above it scrolls.
export async function assertStickyBarInView(ctx, drawer, state, kind = "source") {
  const { page } = ctx;
  const bar = drawer.locator(".drawer-action-bar");
  await bar.waitFor({ state: "visible", timeout: 10000 });
  const drawerClass = kind === "restore" ? ".restore-drawer" : ".source-drawer";
  const scrollClass = kind === "restore" ? ".restore-drawer-scroll" : ".source-drawer-scroll";
  const geometry = () => page.evaluate(({ drawerSelector, scrollSelector }) => {
    const root = document.querySelector(drawerSelector);
    const barBox = root?.querySelector(".drawer-action-bar")?.getBoundingClientRect();
    const scroll = root?.querySelector(scrollSelector);
    return {
      top: barBox ? Math.round(barBox.top) : -1,
      bottom: barBox ? Math.round(barBox.bottom) : -1,
      viewport: window.innerHeight,
      scrollTop: Math.round(scroll?.scrollTop ?? 0),
    };
  }, { drawerSelector: drawerClass, scrollSelector: scrollClass });
  const before = await geometry();
  assert.ok(before.top >= 0 && before.bottom <= before.viewport, `${state}: the action bar must sit inside the viewport without scrolling: ${JSON.stringify(before)}`);
  await page.evaluate((scrollSelector) => {
    const scroll = document.querySelector(scrollSelector);
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, `${drawerClass} ${scrollClass}`);
  await page.waitForTimeout(80);
  const after = await geometry();
  assert.equal(after.top, before.top, `${state}: the action bar must not move when the review body scrolls: ${JSON.stringify({ before, after })}`);
  assert.equal(after.bottom, before.bottom, `${state}: the action bar must keep its pinned position: ${JSON.stringify({ before, after })}`);
  await page.evaluate((scrollSelector) => {
    const scroll = document.querySelector(scrollSelector);
    if (scroll) scroll.scrollTop = 0;
  }, `${drawerClass} ${scrollClass}`);
}

export async function assertNoHorizontalOverflow(ctx) {
  const { page } = ctx;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  assert.ok(dimensions.scrollWidth <= dimensions.clientWidth, `horizontal overflow: ${JSON.stringify(dimensions)}`);
  assert.ok(dimensions.bodyScrollWidth <= dimensions.clientWidth, `body horizontal overflow: ${JSON.stringify(dimensions)}`);
}

export async function assertFocusReturned(ctx, trigger) {
  const { page } = ctx;
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), await trigger.getAttribute("aria-label"));
}

// The five settings categories, by their localized label and section heading.
export const settingsCategories = [
  { label: /^(存储|Storage)$/, heading: /^(存储|Storage)$/ },
  { label: /^(搜索|Search)$/, heading: /^(搜索|Search)$/ },
  { label: /^(备注|Notes)$/, heading: /^(备注|Notes)$/ },
  { label: /^(恢复|Recovery)$/, heading: /^(恢复|Recovery)$/ },
  { label: /^(服务|Service)$/, heading: /^(服务|Service)$/ },
];

// The real settings layout element is `.settings-body`: it owns the two panes
// above the mobile boundary and the single column below it. Asserting its
// computed column count replaces the old `.settings-layout` query, which no
// longer matched any element and therefore asserted nothing.
export async function settingsLayoutProbe(ctx) {
  const { page } = ctx;
  return page.evaluate(() => {
    const columns = (element) => element ? getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length : 0;
    const body = document.querySelector(".settings-body");
    const repository = document.querySelector(".config-section .config-field input");
    return {
      bodyColumns: columns(body),
      bodyColumnsValue: body ? getComputedStyle(body).gridTemplateColumns : "",
      formColumns: columns(document.querySelector(".config-section .form-grid")),
      repositoryWidth: repository?.getBoundingClientRect().width ?? 0,
      categoryCount: document.querySelectorAll(".settings-categories .settings-category").length,
      activeCategory: document.querySelector(".settings-category.active .settings-category-label")?.textContent?.trim() ?? "",
      sectionCount: document.querySelectorAll(".settings-content .config-section").length,
      heading: document.querySelector(".settings-content .config-heading h3")?.textContent?.trim() ?? "",
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

export async function assertSettingsCategories(ctx, settings) {
  const { page } = ctx;
  for (const category of settingsCategories) {
    await settings.getByRole("button", { name: category.label }).click();
    const heading = settings.locator(".settings-content .config-heading h3");
    await heading.waitFor({ state: "visible", timeout: 10000 });
    let headingText = "";
    let activeText = "";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      headingText = (await heading.innerText()).trim();
      activeText = (await settings.locator(".settings-category.active .settings-category-label").first().innerText()).trim();
      if (category.heading.test(headingText) && category.label.test(activeText)) break;
      await page.waitForTimeout(50);
    }
    assert.match(headingText, category.heading, `activating ${category.label} must render its section: ${headingText}`);
    assert.match(activeText, category.label, `the active category indicator must follow the selection: ${activeText}`);
    assert.equal(await settings.locator(".config-section").count(), 1, `only the active category may render its section: ${headingText}`);
  }
}
