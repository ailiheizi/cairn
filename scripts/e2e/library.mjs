// Assertions for the library surface: the tile projection, the inspector
// preview and viewer, notes/tags and their guard, plus sorting, batch
// selection, keyboard navigation, and the batch tag.
//
// Owner: the library surface (components/LibrarySurface.tsx, ResultList.tsx,
// DetailsPanel.tsx, SelectionBar.tsx, app/useLibrary.ts, app/useDetails.ts,
// app/useSelection.ts). The functions here keep the original assertion
// statements and order and may be extended, never weakened.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fillNoteDraft, assertFocusReturned, assertNoHorizontalOverflow } from "./support.mjs";

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
  await tinyTile.locator(".cairn-content-preview__thumb-image").waitFor({ state: "visible", timeout: 10000 });
  const tinyBadge = tinyTile.locator(".cairn-content-preview__thumb-size");
  await tinyBadge.waitFor({ state: "visible", timeout: 10000 });
  assert.equal((await tinyBadge.innerText()).trim(), "1x1", "the 1x1 image tile must show its natural size");
  // A text tile is the type glyph and the name. It must contain no preview
  // element at all and must never render the file's own text.
  const tileInspection = await page.locator(".result-list .result-row").evaluateAll((rows) => rows.map((row) => {
    const icon = row.querySelector(".file-icon");
    return {
      name: row.querySelector(".result-open-copy strong")?.textContent?.trim() ?? "tile",
      glyph: Boolean(icon?.querySelector("svg")),
      format: icon?.querySelector(".result-format")?.textContent?.trim() ?? "",
      preview: Boolean(icon?.querySelector(".cairn-content-preview")),
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
    assert.equal(tile.format, "TXT", `${tile.name}: the deterministic filename format cue must remain visible`);
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
  const previewPanel = page.locator(".cairn-content-preview__panel");
  await previewPanel.locator(".cairn-content-preview__image").waitFor({ state: "visible", timeout: 10000 });
  const viewerTrigger = previewPanel.getByRole("button", { name: /查看原图|View full size/ }).first();
  await viewerTrigger.click();
  const viewer = page.getByRole("dialog", { name: /图片查看器|Image viewer/ });
  await viewer.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await viewer.getAttribute("aria-modal"), "true", "the image viewer must be a modal dialog");
  const viewerName = (await viewer.locator(".cairn-image-viewer__name").innerText()).trim();
  assert.equal(viewerName, "tiny.png", `the viewer must name the file it shows: ${viewerName}`);
  const viewerSize = (await viewer.locator(".cairn-image-viewer__size").innerText()).trim();
  assert.match(viewerSize, /1\s*×\s*1/, `the viewer must report the natural pixel size: ${viewerSize}`);
  assert.equal((await viewer.getAttribute("data-zoom-min")), "10", "the viewer must bound the minimum zoom");
  assert.equal((await viewer.getAttribute("data-zoom-max")), "800", "the viewer must bound the maximum zoom");
  const zoomValue = viewer.locator(".cairn-image-viewer__zoom-value");
  const initialZoom = (await zoomValue.innerText()).trim();
  await viewer.getByRole("button", { name: /放大|Zoom in/ }).click();
  await page.waitForTimeout(50);
  const buttonZoom = (await zoomValue.innerText()).trim();
  assert.notEqual(buttonZoom, initialZoom, `the zoom control must change the percentage: ${initialZoom} -> ${buttonZoom}`);
  await viewer.locator(".cairn-image-viewer__stage").dispatchEvent("wheel", { deltaY: -120 });
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
  const sortDescription = await page.locator("#cairn-sort-description").innerText();
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

// The native download route must deliver original bytes for empty, small, and
// multi-chunk files. This reads the browser's saved download, not a page fetch
// or a preview buffer, and checks both full bytes and the exact identity.
export async function assertOriginalDownloads(ctx) {
  const { page, sourcePath } = ctx;
  const large = Buffer.alloc(1_250_123);
  for (let index = 0; index < large.length; index += 1) large[index] = (index * 31 + (index >>> 8)) & 0xff;
  const fixtures = [
    { name: "download-small.txt", bytes: Buffer.from("native browser download preserves these original bytes\n") },
    { name: "download-empty.bin", bytes: Buffer.alloc(0) },
    { name: "download-large.bin", bytes: large },
  ];
  for (const fixture of fixtures) writeFileSync(join(sourcePath, fixture.name), fixture.bytes);

  const command = async (operation, input) => {
    const response = await page.request.post(new URL("/api/v1/command", ctx.url).toString(), { data: { operation, input } });
    assert.ok(response.ok(), `${operation} must answer over the local adapter: ${response.status()}`);
    const envelope = await response.json();
    assert.equal(envelope.status, "SUCCEEDED", `${operation} must succeed: ${JSON.stringify(envelope.reasons ?? [])}`);
    return envelope.data ?? {};
  };
  const plan = await command("plan.ingest", { root: sourcePath });
  assert.equal(plan.executable, true, `download fixture plan must be executable: ${JSON.stringify(plan.blocked_entries ?? [])}`);
  const applied = await command("plan.apply", { workspace_id: plan.workspace_id, plan_id: plan.plan_id, plan_digest: plan.plan_digest });
  assert.equal(applied.state, "SUCCEEDED", `download fixture must be saved: ${JSON.stringify(applied)}`);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /全部内容|All content/ }).click();

  for (const fixture of fixtures) {
    const tile = page.getByRole("main").getByRole("button", { name: new RegExp(`^${fixture.name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`) }).first();
    await tile.waitFor({ state: "visible", timeout: 15000 });
    await tile.click();
    const downloadButton = page.getByRole("button", { name: /下载原始文件|Download original/ });
    await downloadButton.waitFor({ state: "visible", timeout: 10000 });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), downloadButton.click()]);
    assert.equal(download.suggestedFilename(), fixture.name, `${fixture.name}: browser attachment filename must be preserved`);
    const savedPath = await download.path();
    assert.ok(savedPath, `${fixture.name}: browser must save an actual download`);
    const saved = readFileSync(savedPath);
    assert.deepEqual(saved, fixture.bytes, `${fixture.name}: browser download bytes must match the original file`);
    const expectedDigest = createHash("sha256").update(fixture.bytes).digest("hex");
    assert.equal(createHash("sha256").update(saved).digest("hex"), expectedDigest, `${fixture.name}: full saved bytes must match SHA-256 identity`);
  }
  assert.equal(await page.getByText(/download complete|下载完成/i).count(), 0, "the UI must not claim completion before browser bytes are saved");
  const refusalURL = new URL("/api/v1/download", ctx.url);
  refusalURL.searchParams.set("workspace_id", plan.workspace_id);
  refusalURL.searchParams.set("entry_id", "missing-snapshot-entry");
  const errorTabReady = page.context().waitForEvent("page", { timeout: 10000 });
  const refusalRequestReady = page.context().waitForEvent("request", {
    predicate: (request) => request.url().includes("missing-snapshot-entry"),
    timeout: 10000,
  });
  await page.evaluate((href) => {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }, refusalURL.toString());
  const errorTab = await errorTabReady;
  const refusalRequest = await refusalRequestReady;
  const refusalResponse = await refusalRequest.response();
  assert.ok(refusalResponse, "the refused download must receive a transport response");
  assert.ok(refusalResponse.status() >= 400, "a refused download must return an HTTP error before attachment headers");
  await errorTab.locator("body").waitFor({ state: "visible", timeout: 10000 });
  assert.ok((await errorTab.locator("body").innerText()).trim().length > 0, "the new tab must visibly show the structured refusal");
  assert.equal(await page.getByRole("button", { name: /下载原始文件|Download original/ }).count(), 1, "a refusal must leave the library inspector intact");
  await errorTab.close();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getByRole("heading", { name: "download-large.bin" }).count(), 1, "the selected large file must stay in the inspector after the refusal");
  const mobileDownloadButton = page.getByRole("button", { name: /下载原始文件|Download original/ });
  const mobileExportButton = page.getByRole("button", { name: /导出此文件|Export this file/ });
  await mobileDownloadButton.waitFor({ state: "visible", timeout: 10000 });
  await mobileExportButton.waitFor({ state: "visible", timeout: 10000 });
  await assertNoHorizontalOverflow(ctx);
  for (const action of [mobileDownloadButton, mobileExportButton]) {
    const box = await action.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390, "mobile inspector actions must fit within the viewport");
  }
  const evidenceDir = "/tmp/cairn-download-evidence-20261005";
  mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: `${evidenceDir}/390-download-details.png`, fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: /返回列表|Back to results/ }).click();
  await page.getByRole("main").getByRole("button", { name: /^download-large\.bin$/i }).first().waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: `${evidenceDir}/1280-all-content.png`, fullPage: true, animations: "disabled" });
}

// The Phase-4 browser quick wins over the loaded listing: the space report, the
// timeline strip, the URL-hash deep links, and the empty-listing onboarding
// guide. Every projection here is browser-local over data the daemon already
// returned, and the assertions hold regardless of the UI locale.
//
// Timeline note: the daemon's content.list rows carry no modification time in
// this build, so the honest contract that is executable today is that the
// strip renders absent (never zero-filled). Bucket filter/clear and the month
// deep link need the daemon to project a per-row time first (reported to the
// operator, not faked here).
export async function assertLibraryQuickWins(ctx) {
  const { page } = ctx;
  await ctx.page.goto(ctx.url, { waitUntil: "networkidle" });
  await page.getByRole("main").getByRole("button", { name: /alpha\.txt/ }).first().waitFor({ state: "visible", timeout: 20000 });
  const tileNames = async () => (await page.locator(".result-list .result-open-copy strong").allInnerTexts()).map((value) => value.trim());
  const search = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });

  // 1. Timeline strip: rendered from the captured modification times, with
  //    the honest scope label; clicking the current-month bucket filters the
  //    listing and clicking it again clears. A bucket count must equal the
  //    number of loaded rows whose captured time falls in that month.
  const timelineControl = page.locator(".timeline-control");
  await timelineControl.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await timelineControl.evaluate((node) => node.parentElement?.classList.contains("library-tool-controls")), true, "the month picker belongs to the secondary browse tools");
  const firstTileTopBeforeTimeline = await page.locator(".result-list .result-row").first().evaluate((node) => Math.round(node.getBoundingClientRect().top));
  await timelineControl.locator("summary").click();
  const strip = timelineControl.locator(".timeline-strip");
  await strip.waitFor({ state: "visible", timeout: 10000 });
  const firstTileTopWithTimelineOpen = await page.locator(".result-list .result-row").first().evaluate((node) => Math.round(node.getBoundingClientRect().top));
  assert.equal(firstTileTopWithTimelineOpen, firstTileTopBeforeTimeline, "opening the month picker must not push the content wall down");
  assert.match(await strip.innerText(), /范围为已加载的 \d+ 个|loaded subjects/, `the strip must state its loaded scope: ${await strip.innerText()}`);
  const loadedItemsForTime = ctx.state.contentListItems ?? [];
  const expectedMonth = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  })();
  const expectedInMonth = loadedItemsForTime.filter((item) => {
    if (typeof item.modified_at !== "string" || !item.modified_at) return false;
    return item.modified_at.slice(0, 7) === expectedMonth;
  }).length;
  assert.ok(expectedInMonth >= 1, `the fixture rows must carry captured times: ${JSON.stringify(loadedItemsForTime.slice(0, 2))}`);
  const bucket = strip.locator(`[data-month="${expectedMonth}"]`);
  assert.equal(Number(await bucket.getAttribute("data-count")), expectedInMonth, "the current-month bucket must count exactly the rows whose captured time falls in that month");
  const before = await tileNames();
  await bucket.click();
  await page.waitForTimeout(250);
  assert.equal(await tileNames().then((names) => names.length), expectedInMonth, "the month filter must narrow the listing to that month's rows");
  assert.match(await page.evaluate(() => window.location.hash), new RegExp(`month=${expectedMonth}`), "the active month must be encoded in the URL hash");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("main").getByRole("button", { name: /alpha\.txt/ }).first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(400);
  await timelineControl.locator("summary").click();
  await strip.waitFor({ state: "visible", timeout: 10000 });
  assert.match(await page.evaluate(() => window.location.hash), new RegExp(`month=${expectedMonth}`), "the month deep link must survive a reload");
  assert.equal((await tileNames()).length, expectedInMonth, "the restored month filter must still narrow the listing");
  await strip.locator(`[data-month="${expectedMonth}"]`).click();
  await page.waitForTimeout(250);
  assert.deepEqual(await tileNames(), before, "clicking the bucket again must clear the month filter");
  await timelineControl.locator("summary").click();

  // 2. Space report: the byte total equals the sum of the loaded rows'
  //    logical_size exactly as the daemon returned them, and the largest-file
  //    entries name rows from that same payload.
  const spaceReport = page.locator(".space-report");
  await spaceReport.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await spaceReport.evaluate((node) => node.parentElement?.classList.contains("library-tool-controls")), true, "the space report belongs to the secondary browse tools");
  const firstTileTopBeforeReport = await page.locator(".result-list .result-row").first().evaluate((node) => Math.round(node.getBoundingClientRect().top));
  const loadedItems = ctx.state.contentListItems ?? [];
  assert.ok(loadedItems.length > 0, "the harness must have captured the content.list payload");
  const expectedTotal = loadedItems.reduce((sum, item) => sum + (typeof item.logical_size === "number" && Number.isSafeInteger(item.logical_size) && item.logical_size >= 0 ? item.logical_size : 0), 0);
  assert.equal(Number(await spaceReport.getAttribute("data-total-bytes")), expectedTotal, `the space report total must equal the sum of the loaded rows' logical_size (${expectedTotal})`);
  await spaceReport.locator("summary").click();
  const firstTileTopWithReportOpen = await page.locator(".result-list .result-row").first().evaluate((node) => Math.round(node.getBoundingClientRect().top));
  assert.equal(firstTileTopWithReportOpen, firstTileTopBeforeReport, "opening the space report must not push the content wall down");
  assert.match(await spaceReport.innerText(), /not a server query|不是服务器查询/, "the expanded report must retain its local-scope caveat");
  const topNames = (await spaceReport.locator(".space-report-top button strong").allInnerTexts()).map((value) => value.trim());
  const loadedNames = new Set(loadedItems.map((item) => String(item.name ?? "")));
  assert.ok(topNames.length >= 1 && topNames.length <= 3, `the space report must list at most three largest files: ${JSON.stringify(topNames)}`);
  for (const name of topNames) assert.ok(loadedNames.has(name), `the largest-file entry ${name} must come from the loaded rows`);
  // A largest-file entry opens through the existing row-open path: the inspector.
  await spaceReport.locator(".space-report-top button").first().click();
  const openedName = topNames[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("main").getByRole("heading", { name: new RegExp(`^${openedName}$`) }).waitFor({ state: "visible", timeout: 10000 });
  await spaceReport.locator("summary").click();

  // 3. Deep links: the submitted search text and the active tag facet survive a
  //    reload, and the restored views are re-derived from the daemon.
  await search.fill("txt");
  await search.press("Enter");
  await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(200);
  const searchHash = await page.evaluate(() => window.location.hash);
  assert.match(searchHash, /[#&]?v=search/, `the search view must be encoded in the URL hash: ${searchHash}`);
  assert.match(searchHash, /q=txt/, `the submitted search text must be encoded in the URL hash: ${searchHash}`);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(300);
  assert.equal(await search.inputValue(), "txt", "the restored search view must show the submitted text in the field");
  assert.deepEqual(await tileNames(), ctx.state.lastSearchHitNames, "the restored search view must re-run the same query through the daemon");
  await page.getByRole("button", { name: /全部内容|All content/ }).click();
  await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "hidden", timeout: 10000 });

  const tagChip = page.locator(".tag-filter").filter({ hasText: "browser-e2e" }).first();
  await tagChip.waitFor({ state: "visible", timeout: 10000 });
  await tagChip.click();
  await page.getByRole("main").getByRole("heading", { name: /标签：\s*browser-e2e|Content tagged browser-e2e/ }).waitFor({ state: "visible", timeout: 15000 });
  const tagHash = await page.evaluate(() => window.location.hash);
  assert.match(tagHash, /v=tag/, `the tag view must be encoded in the URL hash: ${tagHash}`);
  assert.match(tagHash, /tag=browser-e2e/, `the active tag facet must be encoded in the URL hash: ${tagHash}`);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("main").getByRole("heading", { name: /标签：\s*browser-e2e|Content tagged browser-e2e/ }).waitFor({ state: "visible", timeout: 20000 });
  assert.deepEqual(await tileNames(), ["alpha.txt"], "the restored tag view must show exactly the tagged row the daemon reported");
  // The restored view renders two Clear-filters controls (heading + summary);
  // click the summary's explicitly.
  await page.locator(".filter-summary-clear").click();
  await page.getByRole("main").getByRole("heading", { name: /全部内容|All content/ }).waitFor({ state: "visible", timeout: 10000 });

  // 4. Onboarding guide: never over a loaded listing, and a search-empty state
  //    keeps the filtered-empty style instead of the guide. The guide never
  //    claims the catalog is empty — only the loaded listing can be.
  assert.equal(await page.locator(".onboarding-steps").count(), 0, "the onboarding guide must not render over a loaded listing");
  await search.fill("no-such-browser-e2e-content");
  await search.press("Enter");
  await page.getByRole("main").getByRole("heading", { name: /没有找到匹配内容|No matches found/ }).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await page.locator(".onboarding-steps").count(), 0, "a searched-empty state must keep the filtered-empty style, not the onboarding guide");
}

// Photos and Audio are presentation modes inside the existing Library, not
// additional workspace entries. This fixture contains one real image and no
// audio, so these views must reuse the loaded set without type leakage or API
// requests and return to the complete listing locally.
export async function assertLibraryMediaViews(ctx) {
  const { page } = ctx;
  await page.setViewportSize({ width: 1280, height: 900 });
  const operations = [];
  const onRequest = (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/command")) return;
    try { operations.push(request.postDataJSON()?.operation); } catch { /* non-JSON request */ }
  };
  page.on("request", onRequest);
  try {
    const libraryNav = page.locator(".workspace-nav-item").filter({ hasText: /内容库|Library/ });
    assert.equal(await libraryNav.count(), 1, "the sidebar must have exactly one Library destination");
    assert.equal(await page.locator('.workspace-nav-item[data-view="photos"], .workspace-nav-item[data-view="music"]').count(), 0, "media modes must not be separate sidebar destinations");
    const viewSwitch = page.locator(".library-view-switch");
    await viewSwitch.waitFor({ state: "visible", timeout: 10000 });
    const allTab = viewSwitch.locator('[data-view="content"]');
    const photosTab = viewSwitch.locator('[data-view="photos"]');
    const audioTab = viewSwitch.locator('[data-view="music"]');
    assert.equal(await allTab.count(), 1, "Library must expose its all-types mode in the in-page switcher");
    assert.equal(await photosTab.count(), 1, "Library must expose Photos as an in-page mode");
    assert.equal(await audioTab.count(), 1, "Library must expose Audio as an in-page mode");

    await photosTab.click();
    const photos = page.locator('section.content-column[data-view="photos"]');
    await photos.waitFor({ state: "visible", timeout: 10000 });
    assert.match(await photos.locator(".media-view-context").innerText(), /shows image files saved in your Library|展示内容库中保存的图片文件/);
    assert.equal(await photosTab.getAttribute("aria-pressed"), "true", "the Photos mode must announce its selected state");
    assert.equal(await libraryNav.evaluate((node) => node.classList.contains("active")), true, "the single Library destination stays active in Photos mode");
    const photoNames = (await photos.locator(".result-list .result-open-copy strong").allInnerTexts()).map((name) => name.trim());
    assert.deepEqual(photoNames, ["tiny.png"], `Photos must show only regular image-suffix files: ${photoNames.join(", ")}`);
    assert.equal(await photos.locator(".space-report").isVisible(), false, "a filtered view must not show an unscoped whole-library report");
    const about = photos.locator(".media-view-about");
    assert.match(await about.locator("summary").innerText(), /About this view|关于此视图/, "Photos must expose keyboard-operable view details");
    await about.locator("summary").click();
    assert.equal(await photos.locator(".media-view-note").isVisible(), true, "expanded Photos details must retain the accurate suffix and preview limits");
    assert.match(await photos.locator(".media-view-note").innerText(), /filename suffixes|文件名后缀/i);
    await about.locator("summary").click();
    assert.match(await page.evaluate(() => window.location.hash), /v=photos/, "Photos must be deep-linkable");

    await page.setViewportSize({ width: 707, height: 900 });
    const photoOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(photoOverflow, 0, `Photos must not overflow at 707px: ${photoOverflow}px`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload({ waitUntil: "networkidle" });
    const restoredPhotos = page.locator('section.content-column[data-view="photos"]');
    await restoredPhotos.waitFor({ state: "visible", timeout: 20000 });
    assert.deepEqual((await restoredPhotos.locator(".result-list .result-open-copy strong").allInnerTexts()).map((name) => name.trim()), ["tiny.png"], "the Photos hash must restore its local projection");
    operations.length = 0;

    const restoredViewSwitch = page.locator(".library-view-switch");
    const restoredAudioTab = restoredViewSwitch.locator('[data-view="music"]');
    await restoredAudioTab.click();
    const audio = page.locator('section.content-column[data-view="music"]');
    await audio.waitFor({ state: "visible", timeout: 10000 });
    assert.match(await audio.locator("h1").innerText(), /音频|Audio/, "the Audio mode must be clearly labeled in the Library heading");
    assert.match(await audio.locator(".media-view-context").innerText(), /does not play them|不会播放/);
    assert.equal(await audio.locator(".media-view-about summary").isVisible(), true, "Audio must expose the view explanation on demand");
    await audio.locator(".media-view-about summary").click();
    assert.match(await audio.locator(".media-view-note").innerText(), /does not play|不播放/i, "Audio must make clear that browsing does not promise playback");
    await audio.locator(".media-view-about summary").click();
    assert.equal(await audio.locator(".result-list .result-row").count(), 0, "documents and images must not leak into the Audio mode");
    assert.equal(await audio.locator(".empty-state.media-empty-state").isVisible(), true, "the empty media state must stay compact");
    assert.equal(await audio.getByRole("heading", { name: /已加载列表中没有音频文件|No audio files in the loaded listing/ }).count(), 1, "an empty Audio mode must be explicit");
    assert.match(await page.evaluate(() => window.location.hash), /v=music/, "Audio must remain deep-linkable");
    assert.equal(await libraryNav.evaluate((node) => node.classList.contains("active")), true, "the same Library destination stays active in Audio mode");
    assert.equal(operations.some((operation) => operation === "search.query"), false, "switching Library modes must not issue a search query");
    assert.equal(operations.some((operation) => operation === "content.list"), false, "switching Library modes must filter the already loaded listing locally");

    await page.setViewportSize({ width: 707, height: 900 });
    const audioOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(audioOverflow, 0, `Audio must not overflow at 707px: ${audioOverflow}px`);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.reload({ waitUntil: "networkidle" });
    const restoredAudio = page.locator('section.content-column[data-view="music"]');
    await restoredAudio.waitFor({ state: "visible", timeout: 20000 });
    assert.equal(await restoredAudio.locator(".result-list .result-row").count(), 0, "the Audio hash must restore its honest empty projection");
    operations.length = 0;

    await page.locator(".library-view-switch [data-view=content]").click();
    await page.locator('section.content-column[data-view="content"]').waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await page.locator(".result-list .result-row").count(), 3, "All types must restore the complete loaded Library set");
    assert.equal(await page.evaluate(() => window.location.hash), "", "the default Library mode must clear the media hash");
    assert.equal(operations.some((operation) => operation === "content.list" || operation === "search.query"), false, "returning to All types must remain a local view switch");
  } finally {
    page.off("request", onRequest);
  }
}
