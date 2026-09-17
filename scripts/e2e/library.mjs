// Assertions for the library surface: the tile projection, the inspector
// preview and viewer, notes/tags and their guard, plus sorting, batch
// selection, keyboard navigation, and the batch tag.
//
// Owner: the library surface (components/LibrarySurface.tsx, ResultList.tsx,
// DetailsPanel.tsx, SelectionBar.tsx, app/useLibrary.ts, app/useDetails.ts,
// app/useSelection.ts). The functions here keep the original assertion
// statements and order and may be extended, never weakened.

import assert from "node:assert/strict";
import { fillNoteDraft, assertFocusReturned } from "./support.mjs";

// A tile is a picture and a name. Text tiles must render no preview text and
// must not read content at all: the reader opens the file instead. The tiny
// image tile keeps its thumbnail and names its natural size.
export async function assertLibraryTiles(ctx) {
  const { page, button } = ctx;
  const item = button(/alpha\.txt/);
  await item.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.locator(".result-list .result-row").count(), 3, "the library must list the saved content after the confirmed save");

  const tinyTile = page.locator(".result-list .result-row").filter({ hasText: /tiny\.png/ }).first();
  await tinyTile.waitFor({ state: "visible", timeout: 10000 });
  await tinyTile.locator(".rw-content-preview__thumb-image").waitFor({ state: "visible", timeout: 10000 });
  const tinyBadge = tinyTile.locator(".rw-content-preview__thumb-size");
  await tinyBadge.waitFor({ state: "visible", timeout: 10000 });
  assert.equal((await tinyBadge.innerText()).trim(), "1x1", "the 1x1 image tile must show its natural size");
  // A text tile is the type glyph and the name. It must contain no preview
  // element at all and must never render the file's own text.
  const tileInspection = await page.locator(".result-list .result-row").evaluateAll((rows) => rows.map((row) => {
    const icon = row.querySelector(".file-icon");
    return {
      name: row.querySelector(".result-open-copy strong")?.textContent?.trim() ?? "tile",
      glyph: Boolean(icon?.querySelector("svg")),
      preview: Boolean(icon?.querySelector(".rw-content-preview")),
      image: Boolean(icon?.querySelector("img")),
      iconText: (icon?.textContent ?? "").trim(),
    };
  }));
  const textTiles = tileInspection.filter((tile) => tile.name.endsWith(".txt"));
  assert.equal(textTiles.length, 2, `the fixture must expose both text tiles: ${JSON.stringify(tileInspection)}`);
  for (const tile of textTiles) {
    assert.ok(tile.glyph, `${tile.name}: a text tile must keep the file-type glyph`);
    assert.equal(tile.preview, false, `${tile.name}: a text tile must not render a preview element`);
    assert.equal(tile.image, false, `${tile.name}: a text tile must not render an image`);
    assert.ok(!tile.iconText.includes("durable duplicate content"), `${tile.name}: a text tile must not render file text: ${tile.iconText}`);
  }
  // The image thumbnail may still be in flight; wait for the tile projection to
  // settle before counting what the tiles asked the daemon for.
  await page.waitForTimeout(300);
  const textTileOpens = ctx.state.contentOpenEntryIDs
    .map((entryID) => ctx.state.entryNames.get(entryID) ?? entryID)
    .filter((name) => ["alpha.txt", "beta.txt"].includes(name));
  assert.deepEqual(textTileOpens, [], `text tiles must not fetch content for a preview: ${textTileOpens.join(", ")}`);
  assert.deepEqual(ctx.state.contentOpenEntryIDs.map((entryID) => ctx.state.entryNames.get(entryID) ?? entryID), ["tiny.png"], "only the image tile may read content for its thumbnail");
}

// The inspector preview is the entry point to the real viewer. Selecting a tile
// still only selects it; the viewer opens from the preview controls.
export async function assertDetailsViewerNotesAndGuard(ctx) {
  const { page, button } = ctx;
  const tinyItem = page.getByRole("main").getByRole("button", { name: /tiny\.png/ }).first();
  await tinyItem.click();
  const previewPanel = page.locator(".rw-content-preview__panel");
  await previewPanel.locator(".rw-content-preview__image").waitFor({ state: "visible", timeout: 10000 });
  const viewerTrigger = previewPanel.getByRole("button", { name: /查看原图|View full size/ }).first();
  await viewerTrigger.click();
  const viewer = page.getByRole("dialog", { name: /图片查看器|Image viewer/ });
  await viewer.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await viewer.getAttribute("aria-modal"), "true", "the image viewer must be a modal dialog");
  const viewerName = (await viewer.locator(".rw-image-viewer__name").innerText()).trim();
  assert.equal(viewerName, "tiny.png", `the viewer must name the file it shows: ${viewerName}`);
  const viewerSize = (await viewer.locator(".rw-image-viewer__size").innerText()).trim();
  assert.match(viewerSize, /1\s*×\s*1/, `the viewer must report the natural pixel size: ${viewerSize}`);
  assert.equal((await viewer.getAttribute("data-zoom-min")), "10", "the viewer must bound the minimum zoom");
  assert.equal((await viewer.getAttribute("data-zoom-max")), "800", "the viewer must bound the maximum zoom");
  const zoomValue = viewer.locator(".rw-image-viewer__zoom-value");
  const initialZoom = (await zoomValue.innerText()).trim();
  await viewer.getByRole("button", { name: /放大|Zoom in/ }).click();
  await page.waitForTimeout(50);
  const buttonZoom = (await zoomValue.innerText()).trim();
  assert.notEqual(buttonZoom, initialZoom, `the zoom control must change the percentage: ${initialZoom} -> ${buttonZoom}`);
  await viewer.locator(".rw-image-viewer__stage").dispatchEvent("wheel", { deltaY: -120 });
  await page.waitForTimeout(50);
  const wheelZoom = (await zoomValue.innerText()).trim();
  assert.notEqual(wheelZoom, buttonZoom, `the mouse wheel must zoom the viewer: ${buttonZoom} -> ${wheelZoom}`);
  await page.keyboard.press("Escape");
  await viewer.waitFor({ state: "hidden", timeout: 10000 });
  assert.equal(await page.getByRole("dialog", { name: /图片查看器|Image viewer/ }).count(), 0, "Escape must close the image viewer");
  await assertFocusReturned(ctx, viewerTrigger);

  const item = button(/alpha\.txt/);
  await item.click();
  await page.getByRole("combobox", { name: /新标签|New tag/ }).fill("browser-e2e");
  await button(/添加标签|Add tag/).click();
  await page.getByRole("button", { name: /移除标签 browser-e2e|Remove tag browser-e2e/ }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("textbox", { name: /新备注|New note/ }).fill("durable browser note");
  await button(/添加备注|Add note/).click();
  await page.getByText("durable browser note", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("complementary").getByText("browser-e2e", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: /导出此文件|Export this file/ }).waitFor({ state: "visible", timeout: 10000 });
  page.on("dialog", async (dialog) => {
    assert.match(dialog.message(), /放弃未保存的备注更改|Discard unsaved note changes|放弃未保存的设置|Discard unsaved settings/i);
    if (ctx.state.nextDialogAction === "accept") await dialog.accept();
    else await dialog.dismiss();
  });
  const noteComposer = page.getByRole("textbox", { name: /新备注|New note/ });
  // The composer is a controlled input: the draft exists only after React
  // processed the input event (the section's Add note action then enables).
  // A background refresh can commit a re-render that restores the last known
  // value, so wait for the app state instead of assuming the DOM write is
  // durable.
  await fillNoteDraft(ctx, noteComposer, page.getByRole("button", { name: /添加备注|Add note/ }));
  await page.getByRole("main").getByRole("button", { name: /beta\.txt/ }).first().click();
  assert.equal(await page.getByRole("heading", { name: /alpha\.txt/ }).count(), 1, "dismissing the note guard must keep the current subject");
  assert.equal(await noteComposer.inputValue(), "unsaved browser note draft", "dismissing the note guard must keep the draft");
  ctx.state.nextDialogAction = "accept";
  await page.getByRole("main").getByRole("button", { name: /beta\.txt/ }).first().click();
  await page.getByRole("heading", { name: /beta\.txt/ }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByRole("textbox", { name: /新备注|New note/ }).inputValue(), "", "accepting the note guard must discard the draft");
}

// The flat library listing is one client-side projection of the complete
// publication set, so the browser owns the ordering there; search results keep
// the relevance order the daemon returned. Selection is a second concept on
// top of the single details subject, and the keyboard walks the rendered
// (fluid) grid.
export async function assertLibrarySortAndSelection(ctx) {
  const { page } = ctx;
  const tileNames = async () => (await page.locator(".result-list .result-open-copy strong").allInnerTexts()).map((value) => value.trim());
  const selectionCount = async () => Number(await page.locator(".result-list").getAttribute("data-selection-count"));
  const sortField = page.getByRole("combobox", { name: /排序字段|Sort field/ });
  const sortDirection = page.getByRole("button", { name: /排序方向|Sort direction/ });
  const listDirection = () => page.locator(".result-list").getAttribute("data-sort-direction");
  const rowButton = (name) => page.getByRole("main").getByRole("button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first();
  const selectionBar = page.locator(".selection-bar");
  const barButton = (pattern) => selectionBar.getByRole("button", { name: pattern });
  // An input backed by a datalist exposes the combobox role, not textbox.
  const barTagInput = selectionBar.getByRole("combobox", { name: /为所选项目添加标签|Tag for selected items/ });
  const focusedIndex = () => page.evaluate(() => Number(document.activeElement?.closest("[data-result-index]")?.getAttribute("data-result-index") ?? -1));
  const focusedTitle = () => page.evaluate(() => document.activeElement?.closest("[data-result-index]")?.querySelector(".result-open-copy strong")?.textContent?.trim() ?? "");
  const renderedColumns = () => page.evaluate(() => {
    const tiles = [...document.querySelectorAll("[data-result-index]")];
    return tiles.length < 2 ? 1 : tiles.filter((tile) => tile.offsetTop === tiles[0].offsetTop).length;
  });
  const openLibrary = async () => {
    await page.getByRole("button", { name: /全部内容|All content/ }).click();
    await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "hidden", timeout: 10000 });
    await page.getByRole("main").getByRole("button", { name: /alpha\.txt/ }).first().waitFor({ state: "visible", timeout: 10000 });
  };
  const search = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });

  // 1. Sorting. The daemon never sorts, so the whole order happens here; the
  // field choice and the direction toggle must both change the rendered tiles.
  assert.deepEqual(await tileNames(), ["alpha.txt", "beta.txt", "tiny.png"], "the library must open in ascending name order");
  await sortDirection.click();
  assert.equal(await listDirection(), "desc", "the direction toggle must switch the control to descending");
  assert.deepEqual(await tileNames(), ["tiny.png", "beta.txt", "alpha.txt"], "descending name order must reorder the tiles");
  await sortField.selectOption("size");
  if (await listDirection() !== "asc") await sortDirection.click();
  assert.deepEqual(await tileNames(), ["alpha.txt", "beta.txt", "tiny.png"], "ascending size order must sort the smaller files first");
  const sizeMetas = await page.locator(".result-list .result-meta").allInnerTexts();
  assert.equal(sizeMetas.length, 3, `sorting by size must show the size of every tile: ${JSON.stringify(sizeMetas)}`);
  await sortDirection.click();
  assert.deepEqual(await tileNames(), ["tiny.png", "beta.txt", "alpha.txt"], "descending size order must put the larger file first");
  await sortField.selectOption("type");
  if (await listDirection() !== "desc") await sortDirection.click();
  // Every fixture entry is a regular file, so the type key ties and the
  // deterministic name order must still follow the requested direction.
  assert.deepEqual(await tileNames(), ["tiny.png", "beta.txt", "alpha.txt"], "a tied type key must still follow the requested direction");
  await sortField.selectOption("path");
  if (await listDirection() !== "asc") await sortDirection.click();
  assert.deepEqual(await tileNames(), ["alpha.txt", "beta.txt", "tiny.png"], "ascending path order must order the tiles by path");
  const sortDescription = await page.locator("#restoreweave-sort-description").innerText();
  assert.match(sortDescription, /不是服务器查询|not a server query/, `the sort control must say that it sorts loaded items: ${sortDescription}`);

  // Search results keep the relevance order the daemon returned. Descending
  // name order stays selected, so an un-reversed result list proves the client
  // did not apply its own order there.
  await sortField.selectOption("name");
  if (await listDirection() !== "desc") await sortDirection.click();
  await search.fill("txt");
  await search.press("Enter");
  await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(200);
  assert.equal(await sortField.isDisabled(), true, "the sort control must be disabled in search mode");
  assert.equal(await sortDirection.isDisabled(), true, "the direction toggle must be disabled in search mode");
  assert.ok(ctx.state.lastSearchHitNames.length >= 2, `the fixture must match both text files by name: ${JSON.stringify(ctx.state.lastSearchHitNames)}`);
  assert.deepEqual(await tileNames(), ctx.state.lastSearchHitNames, "search results must keep the relevance order the daemon returned");
  await openLibrary();
  // The choice persisted across that navigation.
  assert.equal(await sortField.inputValue(), "name", "the sort field must persist across navigation");
  assert.equal(await sortDirection.isDisabled(), false, "the sort control must be usable again in the library");
  assert.deepEqual(await tileNames(), ["tiny.png", "beta.txt", "alpha.txt"], "the persisted descending order must survive navigation");

  // 2. Multi-selection. Cmd/Ctrl+click toggles one row, Shift+click extends
  // the range from the last anchor, and the tile affordance toggles the row it
  // belongs to without opening details.
  await rowButton("alpha.txt").click({ modifiers: ["Meta"] });
  await rowButton("beta.txt").click({ modifiers: ["Meta"] });
  await selectionBar.waitFor({ state: "visible", timeout: 10000 });
  assert.match(await selectionBar.locator(".selection-count").innerText(), /(?:已选择\s*2|2\s*selected)/, "the selection bar must report two selected items");
  assert.equal(await selectionCount(), 2, "two Cmd/Ctrl+clicks must select two rows");
  await sortDirection.click();
  assert.equal(await selectionCount(), 2, "sorting must keep the selected subjects");
  await sortDirection.click();
  await rowButton("tiny.png").click({ modifiers: ["Shift"] });
  assert.equal(await selectionCount(), 3, "Shift+click must extend the selection as a range from the anchor");
  assert.match(await selectionBar.locator(".selection-count").innerText(), /(?:已选择\s*3|3\s*selected)/, "the selection bar must follow the extended range");
  assert.equal(await page.locator(".detail-column").count(), 0, "selecting must not open details");
  await page.locator('.result-list .result-row[data-result-index="0"] .result-select').click();
  assert.equal(await selectionCount(), 2, "the tile affordance must toggle exactly one row");
  assert.equal(await page.locator(".detail-column").count(), 0, "the tile affordance must not open details");
  await barButton(/选择当前可见项|Select all visible/).click();
  assert.equal(await selectionCount(), 3, "Select all visible must select every rendered item");
  await page.keyboard.press("Escape");
  await selectionBar.waitFor({ state: "hidden", timeout: 10000 });
  assert.equal(await selectionCount(), 0, "Escape must clear the selection");

  // 3. Keyboard navigation over the same rendered grid: one tab stop, arrow
  // movement by item and by rendered row, Space to select, Enter to open
  // details for the focused tile.
  await page.locator(".result-list .result-open-copy").first().focus();
  assert.equal(await focusedIndex(), 0, "the first tile must be focusable");
  assert.equal(await page.locator('.result-list .result-open-copy[tabindex="0"]').count(), 1, "the list must own exactly one tab stop");
  assert.equal(await page.locator('.result-list .result-open-copy[tabindex="-1"]').count(), 2, "every other tile must leave the tab order");
  await page.keyboard.press("Control+a");
  assert.equal(await selectionCount(), 3, "Cmd/Ctrl+A must select every visible item");
  await page.keyboard.press("Escape");
  await selectionBar.waitFor({ state: "hidden", timeout: 10000 });
  assert.equal(await selectionCount(), 0, "Escape must clear a keyboard-selected batch");
  await page.keyboard.press("ArrowRight");
  assert.equal(await focusedIndex(), 1, "Arrow Right must move one item");
  const columns = await renderedColumns();
  await page.keyboard.press("ArrowDown");
  const downIndex = Math.min(1 + columns, 2);
  assert.equal(await focusedIndex(), downIndex, `Arrow Down must move one rendered row (${columns} columns)`);
  await page.keyboard.press("ArrowUp");
  assert.equal(await focusedIndex(), Math.max(downIndex - columns, 0), "Arrow Up must move one rendered row back");
  await page.keyboard.press("End");
  assert.equal(await focusedIndex(), 2, "End must jump to the last item");
  await page.keyboard.press("Home");
  assert.equal(await focusedIndex(), 0, "Home must jump to the first item");
  await page.keyboard.press("Space");
  await selectionBar.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await selectionCount(), 1, "Space must toggle the focused tile");
  assert.equal(await page.locator(".detail-column").count(), 0, "Space must not open details");
  await page.keyboard.press("Escape");
  await selectionBar.waitFor({ state: "hidden", timeout: 10000 });
  const enterTarget = await focusedTitle();
  assert.ok(enterTarget, "Enter must act on the focused tile");
  await page.keyboard.press("Enter");
  await page.getByRole("main").getByRole("heading", { name: new RegExp(`^${enterTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).waitFor({ state: "visible", timeout: 10000 });
  // List mode has one tile per row, so Up/Down falls back to one item per step.
  await page.getByRole("button", { name: /列表视图|List view/ }).click();
  await page.locator(".result-list .result-open-copy").first().focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await focusedIndex(), 1, "list mode must move one item per arrow step");
  await page.keyboard.press("ArrowUp");
  assert.equal(await focusedIndex(), 0, "list mode must move back one item");
  await page.getByRole("button", { name: /网格视图|Grid view/ }).click();

  // 4. Export selected: the frozen manifest carries the whole selection.
  await rowButton("alpha.txt").click({ modifiers: ["Meta"] });
  await rowButton("beta.txt").click({ modifiers: ["Meta"] });
  assert.equal(await selectionCount(), 2, "the export selection must hold two rows");
  await barButton(/导出所选|Export selected/).click();
  const selectionDrawer = page.getByRole("dialog", { name: /导出内容|Export content/ });
  await selectionDrawer.waitFor({ state: "visible", timeout: 10000 });
  await selectionDrawer.getByText(/(?:已选择\s*2\s*个项目|2\s*selected items)/).first().waitFor({ state: "visible", timeout: 10000 });
  await selectionDrawer.getByRole("textbox", { name: /服务器输出目录|Server output directory/ }).fill(`${ctx.exportDestination}-multi`);
  await selectionDrawer.getByRole("button", { name: /预览冻结导出|Preview frozen export/ }).click();
  await selectionDrawer.getByText(/导出清单已冻结|Export manifest frozen/, { exact: false }).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(ctx.state.lastPlanSubjects?.length, 2, `export.plan must receive the explicit selection: ${JSON.stringify(ctx.state.lastPlanSubjects)}`);
  const selectionStats = await selectionDrawer.locator(".plan-stats").first().innerText();
  assert.match(selectionStats, /2\s*(?:files?|文件)/i, `the frozen manifest must carry both selected files: ${selectionStats}`);
  const frozenNames = await selectionDrawer.locator(".export-items .plan-file-heading strong").allInnerTexts();
  assert.deepEqual(frozenNames.map((value) => value.trim()).sort(), ["alpha.txt", "beta.txt"], `the frozen manifest must name both selected files: ${JSON.stringify(frozenNames)}`);
  await selectionDrawer.getByRole("button", { name: /关闭导出|Close export/ }).click();

  // 5. Batch tag: one body applied to every selected subject, honestly reported
  // and visible on each selected row.
  const batchTag = "selection-batch-e2e";
  assert.equal(await selectionCount(), 2, "the batch tag must act on the surviving selection");
  await barTagInput.fill(batchTag);
  await barButton(/^添加标签$|^Add tag$/).click();
  await page.getByText(/(?:已添加到\s*2\s*个所选项目|added to 2 selected items)/).waitFor({ state: "visible", timeout: 15000 });
  const taggedRows = await page.locator(".result-list .result-row").evaluateAll((tiles, tag) => tiles.map((tile) => ({
    name: tile.querySelector(".result-open-copy strong")?.textContent?.trim() ?? "",
    checked: tile.querySelector(".result-select")?.getAttribute("aria-checked") === "true",
    tagged: [...tile.querySelectorAll(".result-tag")].some((chip) => chip.textContent?.trim() === tag),
  })), batchTag);
  const taggedChecked = taggedRows.filter((row) => row.checked);
  assert.equal(taggedChecked.length, 2, `both selected rows must stay selected: ${JSON.stringify(taggedRows)}`);
  for (const row of taggedChecked) assert.ok(row.tagged, `${row.name}: the batch tag must be visible on every selected row`);
  assert.equal(taggedRows.filter((row) => row.tagged).length, 2, `only the selected rows may show the batch tag: ${JSON.stringify(taggedRows)}`);
  // The tag is a durable annotation record, so the tag browser lists it too.
  await page.locator(".tag-filter").filter({ hasText: batchTag }).first().waitFor({ state: "visible", timeout: 10000 });
  await barButton(/清除选择|Clear selection/).click();
  await selectionBar.waitFor({ state: "hidden", timeout: 10000 });

  // A subject that leaves the listing is dropped instead of being kept
  // silently; the daemon's own result set decides who survives.
  await rowButton("alpha.txt").click({ modifiers: ["Meta"] });
  await rowButton("beta.txt").click({ modifiers: ["Meta"] });
  assert.equal(await selectionCount(), 2, "both text files must be selected before the listing changes");
  await search.fill("txt");
  await search.press("Enter");
  await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(200);
  const surviving = ["alpha.txt", "beta.txt"].filter((name) => ctx.state.lastSearchHitNames.includes(name));
  await openLibrary();
  assert.equal(await selectionCount(), surviving.length, `the selection must drop subjects that left the listing: expected ${surviving.length}`);
  if (surviving.length > 0) await barButton(/清除选择|Clear selection/).click();

  // 6. A plain click still opens details, and selection never discards an
  // unsaved note draft.
  await rowButton("alpha.txt").click();
  await page.getByRole("main").getByRole("heading", { name: /^alpha\.txt$/ }).waitFor({ state: "visible", timeout: 10000 });
  const composer = page.getByRole("textbox", { name: /新备注|New note/ });
  await composer.waitFor({ state: "visible", timeout: 10000 });
  await fillNoteDraft(ctx, composer, page.getByRole("button", { name: /添加备注|Add note/ }));
  await rowButton("beta.txt").click({ modifiers: ["Meta"] });
  assert.equal(await selectionCount(), 1, "Cmd/Ctrl+click must select without opening details");
  assert.equal(await composer.inputValue(), "unsaved browser note draft", "selecting must not discard an unsaved note draft");
  await barButton(/清除选择|Clear selection/).click();
  await composer.fill("");
}
