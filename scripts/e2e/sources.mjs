// Assertions for the sources surface and the add/recheck source drawer.
//
// Owner: the sources surface (components/SourcesSurface.tsx,
// components/SourceDrawer.tsx, app/useSources.ts). The functions here run in
// the online phase from scripts/web-e2e.mjs; they keep the original assertion
// statements and order and may be extended, never weakened.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoHorizontalOverflow, assertStickyBarInView } from "./support.mjs";

// The tile preview must be an honest rendering of real content, so the fixture
// gains one genuine 1x1 PNG before the source is scanned. The daemon runs on
// this host and scans the same directory the harness received.
export async function seedFixtureAndConnect(ctx, { sourcePath }) {
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  writeFileSync(join(sourcePath, "tiny.png"), tinyPng);
  await ctx.text(/已连接|Connected/).waitFor({ state: "visible", timeout: 10000 });
}

// The first source save: the drawer's sticky action bar offers exactly one next
// step in the same pinned position at every stage, and the confirmed save
// reports a measured receipt instead of a second save.
export async function assertSourcePlanAndSave(ctx, { sourcePath }) {
  await ctx.button(/添加来源|Add source/).first().click();
  const addDrawer = ctx.page.getByRole("dialog", { name: /添加来源|Add source/ });
  await addDrawer.waitFor({ state: "visible", timeout: 10000 });
  const pathInput = addDrawer.getByRole("textbox", { name: /RestoreWeave 主机上的路径|Path on RestoreWeave host/ });
  // The drawer's next step is one sticky action bar at the bottom edge. With no
  // path it offers the preview action, disabled, and it stays in view without
  // scrolling the review body.
  const actionBar = addDrawer.locator(".drawer-action-bar");
  await actionBar.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await actionBar.getAttribute("data-state"), "PREVIEW", "an empty drawer must offer the preview action");
  assert.equal(await actionBar.getByRole("button", { name: /预览存储计划|Preview storage plan/ }).count(), 1, "the sticky bar must own the single preview action");
  assert.equal(await actionBar.getByRole("button", { name: /预览存储计划|Preview storage plan/ }).isDisabled(), true, "the preview action must stay disabled until a path exists");
  await assertStickyBarInView(ctx, addDrawer, "an empty path");
  await pathInput.fill(sourcePath);
  await addDrawer.getByRole("button", { name: /预览存储计划|Preview storage plan/ }).click();
  await addDrawer.getByText(/存储计划已生成|Storage plan is ready/).waitFor({ state: "visible", timeout: 10000 });
  const planStats = await addDrawer.locator(".plan-stats").first().innerText();
  // Three source files: alpha.txt, its duplicate beta.txt, and the 1x1 PNG.
  assert.match(planStats, /3\s*(?:files?|文件(?:数)?)/i, `expected three source files: ${planStats}`);
  assert.match(planStats, /(duplicate bytes expected to reuse|重复内容)/i, `missing duplicate facet: ${planStats}`);
  // Human-readable byte values may be fractional (for example, 20.4 KB).
  // Accept those values so the assertion checks the presence of the distinct
  // logical/physical figures without coupling the test to formatting.
  const planNumbers = planStats.match(/\b[1-9][0-9]*(?:\.[0-9]+)?\s*(B|KB|MB|GB|字节)\b/g) ?? [];
  assert.ok(planNumbers.length >= 2, `expected unique and duplicate byte figures: ${planStats}`);
  // The same bar now reads as the confirm action, with the file count, in the
  // same pinned position. The review evidence above it is unchanged.
  assert.equal(await actionBar.getAttribute("data-state"), "READY", "a ready plan must offer the confirm action");
  const confirmAction = actionBar.getByRole("button", { name: /确认保存|Confirm save/ });
  assert.equal(await confirmAction.count(), 1, "the sticky bar must own the single confirm action");
  assert.equal(await confirmAction.isEnabled(), true, "a ready plan must offer a runnable confirm action");
  const confirmLabel = (await confirmAction.innerText()).trim();
  assert.match(confirmLabel, /3/, `the confirm action must carry the file count: ${confirmLabel}`);
  await assertStickyBarInView(ctx, addDrawer, "a ready plan");
  await addDrawer.getByRole("button", { name: /确认保存|Confirm save/ }).click();
  await ctx.page.getByRole("main").getByText(/内容已保存|Content saved/).waitFor({ state: "visible", timeout: 15000 });
  // A completed save keeps the bar honest: it offers the library and a close
  // control instead of a second save.
  assert.equal(await actionBar.getAttribute("data-state"), "SAVED", "a saved plan must switch the bar to the saved state");
  const savedBarText = await actionBar.innerText();
  assert.match(savedBarText, /查看已保存内容|View saved content/, `the saved bar must offer the library: ${savedBarText}`);
  assert.equal(await actionBar.getByRole("button", { name: /确认保存|Confirm save/ }).count(), 0, "a saved plan must not offer a second save");
  await assertStickyBarInView(ctx, addDrawer, "a saved plan");
  // The applied plan remains open so the operator can inspect measured
  // deduplication/physical savings. Close it explicitly before continuing
  // with the library actions that sit behind the drawer.
  await addDrawer.getByRole("button", { name: /关闭添加来源|Close add source/ }).click();
}

// The path field previews on Enter, and the drawer offers one-tap path
// suggestions built only from data the client already has. Both flows end in
// the same sticky bar, in the same position.
export async function assertSourcePreviewOnEnter(ctx, { sourcePath }) {
  await ctx.button(/添加来源|Add source/).first().click();
  const enterDrawer = ctx.page.getByRole("dialog", { name: /添加来源|Add source/ });
  await enterDrawer.waitFor({ state: "visible", timeout: 10000 });
  const enterInput = enterDrawer.getByRole("textbox", { name: /RestoreWeave 主机上的路径|Path on RestoreWeave host/ });
  await enterInput.waitFor({ state: "visible", timeout: 10000 });
  // The keyboard lands on the path field, not on the bar: a user opens the
  // drawer and types immediately.
  let pathFocused = true;
  try {
    await ctx.page.waitForFunction(() => document.activeElement === document.querySelector(".source-drawer .stack-form input"), null, { timeout: 2000 });
  } catch { pathFocused = false; }
  assert.equal(pathFocused, true, "the path field must keep focus when the drawer opens");
  await enterInput.fill(sourcePath);
  await enterInput.press("Enter");
  await enterDrawer.getByText(/存储计划已生成|Storage plan is ready/).waitFor({ state: "visible", timeout: 15000 });
  const enterBar = enterDrawer.locator(".drawer-action-bar");
  const enterBarState = await enterBar.getAttribute("data-state");
  assert.notEqual(enterBarState, "PREVIEW", "Enter in the path field must produce a plan");
  // Every file in this source is already saved, so the bar must say so plainly
  // and offer the library instead of a save that would add nothing.
  assert.equal(enterBarState, "UP_TO_DATE", `an already-saved source must not offer a misleading save: ${enterBarState}`);
  assert.equal(await enterBar.getByRole("button", { name: /确认保存|Confirm save/ }).count(), 0, "an up-to-date plan must not offer a save");
  assert.match(await enterBar.innerText(), /查看已保存内容|View saved content/, "an up-to-date plan must offer the saved content");
  await assertStickyBarInView(ctx, enterDrawer, "an already-saved source");
  await enterDrawer.getByRole("button", { name: /关闭添加来源|Close add source/ }).click();
}

// A suggestion chip fills the path and previews it. The configured source is a
// recheck, not a fresh add, and the drawer must read that way.
export async function assertSourceSuggestionRecheck(ctx, { sourcePath }) {
  const { page } = ctx;
  await ctx.button(/添加来源|Add source/).first().click();
  const chipDrawer = page.locator(".source-drawer");
  await chipDrawer.waitFor({ state: "visible", timeout: 10000 });
  const sourceChip = chipDrawer.locator('.source-suggestion[data-kind="source"]').first();
  await sourceChip.waitFor({ state: "visible", timeout: 10000 });
  // The daemon reports the source locator with normalized separators.
  const normalizePath = (value) => String(value ?? "").replace(/\/+/g, "/");
  assert.equal(normalizePath(await sourceChip.getAttribute("title")), normalizePath(sourcePath), "the configured source path must be the offered suggestion");
  await sourceChip.click();
  await chipDrawer.getByRole("heading", { name: /重新检查来源|Recheck source/ }).waitFor({ state: "visible", timeout: 10000 });
  const chipInput = chipDrawer.getByRole("textbox", { name: /RestoreWeave 主机上的路径|Path on RestoreWeave host/ });
  assert.equal(normalizePath(await chipInput.inputValue()), normalizePath(sourcePath), "a suggestion chip must fill the path field");
  await chipDrawer.getByText(/存储计划已生成|Storage plan is ready/).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await chipDrawer.getByRole("heading", { name: /重新检查来源|Recheck source/ }).count(), 1, "rechecking a configured source must stay a recheck, not a fresh add");
  const chipBar = chipDrawer.locator(".drawer-action-bar");
  assert.equal(await chipBar.getAttribute("data-state"), "UP_TO_DATE", "rechecking an unchanged source must report that nothing new will be added");
  assert.equal(await chipBar.getByRole("button", { name: /确认保存|Confirm save/ }).count(), 0, "an unchanged recheck must not offer a save");
  await assertStickyBarInView(ctx, chipDrawer, "a recheck of an unchanged source");
  await chipDrawer.getByRole("button", { name: /关闭添加来源|Close add source/ }).click();
}

// Sources are one workspace view. The rail switches the content column to the
// configured sources instead of jumping to a second disclosure bar that
// duplicated the same surface inside the library. The rail is hidden on
// phones, so the compact entry above the library heading must reach the same
// view there.
export async function assertSourcesView(ctx) {
  const { page } = ctx;
  const contentColumn = page.locator(".content-column");
  assert.equal(await page.locator(".sources-entry").isVisible(), false, "the compact sources entry must stay hidden from 641px up");
  await page.locator(".workspace-nav-item").filter({ hasText: /^(来源|Sources)/ }).click();
  await contentColumn.locator(".sources-surface .source-card").first().waitFor({ state: "visible", timeout: 10000 });
  const sourcesHeading = (await contentColumn.locator(".workspace-heading h1").innerText()).trim();
  assert.match(sourcesHeading, /^(来源|Sources)$/, `the sources view must title the content column: ${sourcesHeading}`);
  assert.equal(await contentColumn.locator(".sources-surface-actions").count(), 1, "the sources view must keep the add-source action");
  assert.equal(await contentColumn.locator(".result-row").count(), 0, "the sources view must not render library results");
  assert.equal(await contentColumn.locator(".tag-browser").count(), 0, "the sources view must not render the library tag and facet chrome");
  assert.equal(await page.locator(".source-manager").count(), 0, "the library must not render a duplicated sources disclosure bar");
  await contentColumn.getByRole("button", { name: /全部内容|All content/ }).click();
  await page.getByRole("main").getByRole("button", { name: /alpha\.txt/ }).first().waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.locator(".content-column .source-manager").count(), 0, "the library must not keep a second sources surface behind the rail item");

  await page.setViewportSize({ width: 640, height: 900 });
  await page.waitForTimeout(150);
  assert.equal(await page.locator(".workspace-sidebar").isVisible(), false, "the navigation rail must stay hidden on phones");
  const compactSourcesEntry = page.locator(".sources-entry");
  await compactSourcesEntry.waitFor({ state: "visible", timeout: 10000 });
  await compactSourcesEntry.click();
  await contentColumn.locator(".sources-surface .source-card").first().waitFor({ state: "visible", timeout: 10000 });
  await assertNoHorizontalOverflow(ctx);
  await contentColumn.getByRole("button", { name: /全部内容|All content/ }).click();
  await page.getByRole("main").getByRole("button", { name: /alpha\.txt/ }).first().waitFor({ state: "visible", timeout: 10000 });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
}
