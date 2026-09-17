// Assertions for the one search surface: the submitted query and its heading,
// the honest result surface, and the browser-local recents list that never
// becomes a durable saved view.
//
// Owner: app/useSearch.ts, components/TopBar.tsx (the search field), and the
// library heading. The functions here keep the original assertion statements
// and order and may be extended, never weakened.

import assert from "node:assert/strict";
import { escapeRegExp } from "./support.mjs";

// The executed query is stated in the heading; the unsubmitted text in the
// field is not. A healthy semantic provider does not need to emit a
// degradation notice, but when it does it must be visibly labelled.
export async function assertSearchResultSurface(ctx) {
  const { page, text } = ctx;
  const search = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
  await search.fill("durable browser note");
  await search.press("Enter");
  await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "visible", timeout: 15000 });
  const executedHeading = await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).innerText();
  await search.fill("draft-only-input");
  assert.equal(await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).innerText(), executedHeading, "search draft must not replace the executed-query heading");
  await search.fill("durable browser note");
  await page.locator(".result-match").filter({ hasText: "durable browser note" }).first().waitFor({ state: "visible", timeout: 10000 });
  const degradedSearch = text(/部分搜索覆盖已降级|search coverage.*degraded/i);
  if (await degradedSearch.count() > 0) {
    await degradedSearch.first().waitFor({ state: "visible", timeout: 10000 });
  }
}

// The export drawer is opened from a fresh execution of the same query; the
// heading proves the daemon returned a result set before the drawer reads it.
export async function assertSearchQueryReexecuted(ctx) {
  const { page } = ctx;
  const search = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
  await search.fill("durable browser note");
  await search.press("Enter");
  await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "visible", timeout: 15000 });
}

// The one search field gains a focus shortcut, a clear control, and a short
// local recents list. All of it is browser convenience over the same typed
// search.query operation: the recents list is local history, and the durable
// form of a query remains the daemon's SavedView (`view.save`).
export async function assertSearchRecents(ctx) {
  const { page, button } = ctx;
  const searchField = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
  const resultsHeading = page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i });
  const headingActions = page.locator(".heading-actions");
  const resultCount = async () => (await page.locator(".workspace-heading .result-count").innerText()).trim();
  const activeLabel = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  const blurActive = () => page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  const recents = page.locator(".search-recents");
  const libraryTile = (name) => page.getByRole("main").getByRole("button", { name }).first();
  const returnToLibrary = async () => {
    const control = headingActions.locator("button.library-return").filter({ hasText: /全部内容|All content/ }).first();
    if (await control.count()) {
      await control.click();
      await resultsHeading.waitFor({ state: "hidden", timeout: 10000 });
    }
    // The full library is the listing that contains the tiny image as well;
    // the search results for a text query would not.
    await libraryTile(/tiny\.png/).waitFor({ state: "visible", timeout: 10000 });
  };

  // 1. Cmd/Ctrl+K focuses the field from the library; "/" does the same outside
  // a text field. Focusing must not scroll the page.
  await returnToLibrary();
  await blurActive();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("Control+k");
  assert.match(await activeLabel(), /搜索内容库|Search content library/, "Ctrl/Cmd+K must focus the search field");
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore, "focusing the search field must not scroll the page");
  await blurActive();
  await page.keyboard.press("Meta+k");
  assert.match(await activeLabel(), /搜索内容库|Search content library/, "Cmd/Ctrl+K must focus the search field with either modifier");
  await blurActive();
  await page.keyboard.press("/");
  assert.match(await activeLabel(), /搜索内容库|Search content library/, "the / key must focus the search field from the library");

  // 2. A submitted query is stated with its count in the existing heading area,
  // recorded exactly once in the local list, and reproducible from that list.
  await searchField.fill("alpha");
  await searchField.press("Enter");
  await resultsHeading.waitFor({ state: "visible", timeout: 15000 });
  const searchedHeading = (await resultsHeading.innerText()).trim();
  assert.match(searchedHeading, /alpha/, `the executed query must be stated in the heading: ${searchedHeading}`);
  const searchedCount = await resultCount();
  assert.match(searchedCount, /[1-9][0-9]*/, `the heading must state the result count: ${searchedCount}`);
  const storedRecents = await page.evaluate(() => localStorage.getItem("restoreweave.recent_searches"));
  assert.ok(storedRecents && JSON.parse(storedRecents).includes("alpha"), `the submitted query must persist locally: ${storedRecents}`);

  // 3. The clear control empties the field without touching the executed query
  // or the result set.
  await page.locator(".search-clear").click();
  assert.equal(await searchField.inputValue(), "", "the clear control must empty the search field");
  assert.equal((await resultsHeading.innerText()).trim(), searchedHeading, "clearing the text must not change the executed query");
  assert.equal(await resultCount(), searchedCount, "clearing the text must not change the result set");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), await searchField.getAttribute("aria-label"), "the clear control must return focus to the field");
  await recents.waitFor({ state: "visible", timeout: 10000 });
  const recentsText = await recents.innerText();
  assert.match(recentsText, /(?:本机最近搜索|Local recent searches)/, `the recents panel must be labelled as local: ${recentsText}`);
  assert.match(recentsText, /(?:不是已保存的视图|not saved views)/, `the recents panel must not claim to be a saved view: ${recentsText}`);
  assert.equal(await recents.locator(".search-recent-entry", { hasText: /^alpha$/ }).count(), 1, "the submitted query must appear exactly once in the local list");

  // Re-running an entry reproduces the same search and count, and a repeated
  // submission de-duplicates instead of appending.
  await recents.locator(".search-recent-entry", { hasText: /^alpha$/ }).click();
  await resultsHeading.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(200);
  assert.equal((await resultsHeading.innerText()).trim(), searchedHeading, "re-running a recent query must state the same query");
  assert.equal(await resultCount(), searchedCount, "re-running a recent query must reproduce the same result count");
  await page.locator(".search-clear").click();
  await recents.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await recents.locator(".search-recent-entry", { hasText: /^alpha$/ }).count(), 1, "a repeated query must not duplicate its local entry");
  // The list is local history: it must not have created a daemon saved view.
  const savedViewCount = await page.evaluate(async () => {
    const response = await fetch("/api/v1/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "view.list", input: {} }) });
    const body = await response.json();
    return Array.isArray(body?.data) ? body.data.length : -1;
  });
  assert.equal(savedViewCount, 1, "a local recent search must never create a durable saved view");

  // 4. Escape closes the local list first and only empties the field on the
  // next press; neither press runs a search.
  await searchField.press("Escape");
  await recents.waitFor({ state: "hidden", timeout: 10000 });
  assert.equal(await searchField.inputValue(), "", "closing the recents list must leave the field text alone");
  assert.equal(await resultCount(), searchedCount, "closing the recents list must not run a search");
  await searchField.fill("draft-only-escape");
  await searchField.press("Escape");
  assert.equal(await searchField.inputValue(), "", "Escape must empty the field once the recents list is closed");
  assert.equal((await resultsHeading.innerText()).trim(), searchedHeading, "emptying the field must not change the executed search");
  assert.equal(await resultCount(), searchedCount, "emptying the field must not change the result set");

  // 5. The local list can drop one entry and be cleared entirely; the durable
  // saved view survives both.
  await blurActive();
  await searchField.click();
  await recents.waitFor({ state: "visible", timeout: 10000 });
  const removeTarget = (await recents.locator(".search-recent-entry").first().innerText()).trim();
  await recents.locator(".search-recent-remove").first().click();
  assert.equal(await recents.locator(".search-recent-entry", { hasText: new RegExp(`^${escapeRegExp(removeTarget)}$`) }).count(), 0, `removing one entry must drop only that entry: ${removeTarget}`);
  const persistedAfterRemove = JSON.parse(await page.evaluate(() => localStorage.getItem("restoreweave.recent_searches") ?? "[]"));
  assert.equal(persistedAfterRemove.includes(removeTarget), false, "the removed entry must leave the persisted local list");
  assert.ok(persistedAfterRemove.length > 0, `the other entries must stay in the local list: ${JSON.stringify(persistedAfterRemove)}`);
  await recents.getByRole("button", { name: /清除最近搜索|Clear recent searches/ }).click();
  await recents.waitFor({ state: "hidden", timeout: 10000 });
  assert.equal(await page.evaluate(() => localStorage.getItem("restoreweave.recent_searches")), null, "clearing the local list must clear the persisted list");
  assert.equal(await page.evaluate(async () => {
    const response = await fetch("/api/v1/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "view.list", input: {} }) });
    const body = await response.json();
    return Array.isArray(body?.data) ? body.data.length : -1;
  }), 1, "clearing the local list must not touch durable saved views");

  // 6. "/" stays a literal character inside a text field, and neither shortcut
  // pierces an open drawer or the image viewer.
  await returnToLibrary();
  await blurActive();
  await libraryTile(/alpha\.txt/).click();
  const noteComposer = page.getByRole("textbox", { name: /新备注|New note/ });
  await noteComposer.waitFor({ state: "visible", timeout: 10000 });
  await noteComposer.click();
  await noteComposer.press("/");
  await page.waitForTimeout(100);
  assert.equal(await noteComposer.inputValue(), "/", "the / key must stay a literal character inside a text field");
  assert.equal(await activeLabel(), await noteComposer.getAttribute("aria-label"), "the / key must not steal focus from another text field");
  await noteComposer.fill("");

  await button(/添加来源|Add source/).first().click();
  const shortcutDrawer = page.getByRole("dialog", { name: /添加来源|Add source/ });
  await shortcutDrawer.waitFor({ state: "visible", timeout: 10000 });
  const drawerPath = shortcutDrawer.getByRole("textbox", { name: /RestoreWeave 主机上的路径|Path on RestoreWeave host/ });
  await drawerPath.waitFor({ state: "visible", timeout: 10000 });
  await drawerPath.press("/");
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[aria-modal="true"]'))), true, "the search shortcuts must not steal focus from an open drawer");
  assert.equal(await drawerPath.inputValue(), "/", "the / key must stay a literal character inside the drawer's path field");
  await shortcutDrawer.getByRole("button", { name: /关闭添加来源|Close add source/ }).click();
  await shortcutDrawer.waitFor({ state: "hidden", timeout: 10000 });

  await libraryTile(/tiny\.png/).click();
  const previewPanel = page.locator(".rw-content-preview__panel");
  await previewPanel.locator(".rw-content-preview__image").waitFor({ state: "visible", timeout: 10000 });
  await previewPanel.getByRole("button", { name: /查看原图|View full size/ }).first().click();
  const viewer = page.getByRole("dialog", { name: /图片查看器|Image viewer/ });
  await viewer.waitFor({ state: "visible", timeout: 10000 });
  await page.keyboard.press("Control+k");
  await page.keyboard.press("/");
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest(".rw-image-viewer"))), true, "the search shortcuts must not steal focus from the image viewer");
  await page.keyboard.press("Escape");
  await viewer.waitFor({ state: "hidden", timeout: 10000 });
  assert.equal(await viewer.count(), 0, "Escape must still close the image viewer");

  // 7. The existing library-return control is the one way back to the full
  // library from an active search.
  await searchField.fill("alpha");
  await searchField.press("Enter");
  await resultsHeading.waitFor({ state: "visible", timeout: 15000 });
  const returnControl = headingActions.locator("button.library-return").filter({ hasText: /全部内容|All content/ }).first();
  await returnControl.waitFor({ state: "visible", timeout: 10000 });
  await returnControl.click();
  await resultsHeading.waitFor({ state: "hidden", timeout: 10000 });
  await libraryTile(/tiny\.png/).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.locator(".result-list .result-row").count(), 3, "returning to All content must restore the full library");
  assert.equal(await resultsHeading.count(), 0, "returning to All content must leave the search results view");
  await blurActive();
}
