// Assertions for the two action drawers that write: the restore drawer and the
// export drawer, including their unknown-outcome and verification-retry paths
// and the durable saved-view / frozen-manifest records they read back.
//
// Owner: the drawer surfaces (components/RestoreDrawer.tsx,
// ExportDrawer.tsx, DrawerActionBar.tsx, PlanCard.tsx, app/useRestore.ts,
// app/useExport.ts). The functions here keep the original assertion statements
// and order and may be extended, never weakened.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertStickyBarInView } from "./support.mjs";

async function openExportDisclosure(drawer, selector) {
  const disclosure = drawer.locator(selector);
  await disclosure.waitFor({ state: "visible", timeout: 10000 });
  if (!await disclosure.evaluate((element) => element.open)) await disclosure.locator("summary").click();
  assert.equal(await disclosure.evaluate((element) => element.open), true, `${selector} must be expanded before its content is used`);
  return disclosure;
}

// The restore drawer uses the same sticky action bar as the add-source drawer:
// one next step, always in the same pinned position. It starts as the preview
// action, disabled until a destination exists, and it never lets a confirm
// exist before a plan does. Editing the destination invalidates the plan that
// described it.
export async function assertRestoreDrawer(ctx) {
  const { page, button, text } = ctx;
  const restoreDestination = ctx.restoreDestination;
  await button(/恢复最新快照|Restore latest snapshot/).click();
  const restoreDrawer = page.getByRole("dialog", { name: /恢复快照|Restore snapshot/ });
  await restoreDrawer.waitFor({ state: "visible", timeout: 10000 });
  const restoreBar = restoreDrawer.locator(".drawer-action-bar");
  await restoreBar.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await restoreBar.getAttribute("data-state"), "PREVIEW", "an empty restore drawer must offer the preview action");
  const restorePreview = restoreBar.getByRole("button", { name: /预览恢复计划|Preview restore/ });
  assert.equal(await restorePreview.count(), 1, "the restore bar must own the single preview action");
  assert.equal(await restorePreview.isDisabled(), true, "the restore preview must stay disabled until a destination exists");
  assert.equal(await restoreDrawer.getByRole("button", { name: /确认恢复|Confirm restore/ }).count(), 0, "a restore that has not been planned must not be confirmable");
  await assertStickyBarInView(ctx, restoreDrawer, "an empty restore destination", "restore");

  const restoreInput = restoreDrawer.getByRole("textbox", { name: /目标文件夹|Destination folder/ });
  await restoreInput.fill(restoreDestination);
  assert.equal(await restoreBar.getAttribute("data-state"), "PREVIEW", "a destination without a plan must keep the preview action");
  await restorePreview.click();
  await text(/恢复计划已生成|Restore plan is ready/).waitFor({ state: "visible", timeout: 15000 });
  // The bar now reads as the confirm action, in the same pinned position, with
  // the file count. The plan card keeps the review evidence and holds no
  // duplicate confirm.
  assert.equal(await restoreBar.getAttribute("data-state"), "READY", "a ready restore plan must offer the confirm action");
  const restoreConfirm = restoreBar.getByRole("button", { name: /确认恢复|Confirm restore/ });
  assert.equal(await restoreConfirm.count(), 1, "the restore bar must own the single confirm action");
  assert.equal(await restoreConfirm.isEnabled(), true, "a ready restore plan must offer a runnable confirm action");
  const restoreConfirmLabel = (await restoreConfirm.innerText()).trim();
  assert.match(restoreConfirmLabel, /[1-9][0-9]*/, `the confirm action must carry the file count: ${restoreConfirmLabel}`);
  assert.equal(await restoreDrawer.locator(".plan-card").getByRole("button", { name: /确认恢复|Confirm restore/ }).count(), 0, "the restore plan card must not duplicate the confirm action");
  const restoreCardText = await restoreDrawer.locator(".plan-card").innerText();
  assert.match(restoreCardText, /[1-9][0-9]*\s*(?:files?|文件)/i, `the restore plan card must keep its item count: ${restoreCardText}`);
  assert.match(restoreCardText, /EXACT BYTES|原始内容/, `the restore plan card must keep the exact-byte outcome: ${restoreCardText}`);
  await assertStickyBarInView(ctx, restoreDrawer, "a ready restore plan", "restore");

  await restoreInput.fill(`${restoreDestination}-stale`);
  assert.equal(await restoreBar.getAttribute("data-state"), "PREVIEW", "editing the destination must invalidate the stale restore plan");
  assert.equal(await restoreBar.getByRole("button", { name: /确认恢复|Confirm restore/ }).count(), 0, "an invalidated restore plan must not be confirmable");
  await restoreDrawer.getByRole("button", { name: /关闭恢复|Close restore/ }).click();
  await restoreDrawer.waitFor({ state: "hidden", timeout: 10000 });
}

// A recent-destination chip fills the field and previews that destination. The
// chips come from this browser only; the plan still comes from the daemon, and
// the destination must still be an empty directory. The confirmed restore is
// the only thing that writes bytes, and the bar reports the verified result in
// place instead of offering a second apply.
export async function assertRestoreFromRecentDestination(ctx) {
  const { page, button, text } = ctx;
  const restoreDestination = ctx.restoreDestination;
  const normalizePath = (value) => String(value ?? "").replace(/\/+/g, "/");
  await button(/恢复最新快照|Restore latest snapshot/).click();
  const chipRestoreDrawer = page.getByRole("dialog", { name: /恢复快照|Restore snapshot/ });
  await chipRestoreDrawer.waitFor({ state: "visible", timeout: 10000 });
  const chipRestoreBar = chipRestoreDrawer.locator(".drawer-action-bar");
  const destinationChip = chipRestoreBar.locator('.source-suggestion[data-kind="recent"]').first();
  await destinationChip.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(normalizePath(await destinationChip.getAttribute("title")), normalizePath(restoreDestination), "the planned destination must be the offered chip");
  await destinationChip.click();
  const chipRestoreInput = chipRestoreDrawer.getByRole("textbox", { name: /目标文件夹|Destination folder/ });
  await chipRestoreInput.waitFor({ state: "visible", timeout: 10000 });
  await text(/恢复计划已生成|Restore plan is ready/).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(normalizePath(await chipRestoreInput.inputValue()), normalizePath(restoreDestination), "a recent-destination chip must fill the destination field");
  assert.equal(await chipRestoreBar.getAttribute("data-state"), "READY", "a recent-destination chip must preview the destination it filled");

  await chipRestoreBar.getByRole("button", { name: /确认恢复|Confirm restore/ }).click();
  // Exact restore is allowed to report a truthful DEGRADED result when a
  // non-essential fidelity/metadata check is unavailable. Both outcomes
  // still prove that the restore operation completed and exposed its state.
  await text(/已恢复(?:并校验|[^。]*但部分完整性或元数据检查不可用)|Restored(?: and verified| [^.]*(?:but some fidelity or metadata checks were unavailable))/i).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await chipRestoreBar.getAttribute("data-state"), "DONE", "a finished restore must switch the bar to the verified result");
  const restoreDoneText = await chipRestoreBar.innerText();
  assert.match(restoreDoneText, /恢复已校验|恢复已完成|Restore verified|Restore finished/i, `the finished bar must report the verified result: ${restoreDoneText}`);
  assert.equal(await chipRestoreBar.getByRole("button", { name: /确认恢复|Confirm restore/ }).count(), 0, "a finished restore must not offer a second apply");
  await assertStickyBarInView(ctx, chipRestoreDrawer, "a finished restore", "restore");
  const restoredAlpha = readFileSync(join(restoreDestination, "alpha.txt"));
  assert.equal(restoredAlpha.equals(readFileSync(join(ctx.sourcePath, "alpha.txt"))), true, "the confirmed restore must write the expected bytes to the destination");
  await chipRestoreBar.getByRole("button", { name: /^(关闭|Close)$/ }).click();
  await chipRestoreDrawer.waitFor({ state: "hidden", timeout: 10000 });
}

// A lost apply response leaves the outcome unknown: the bar says so plainly
// and never offers a second apply, exactly like the add-source drawer.
export async function assertRestoreUnknownOutcome(ctx) {
  const { page, button, text } = ctx;
  const unknownRestoreDestination = `${ctx.restoreDestination}-unknown`;
  mkdirSync(unknownRestoreDestination, { recursive: true });
  let unknownRestoreApplies = 0;
  await page.route("**/api/v1/command", async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
    if (payload?.operation === "plan.apply") {
      unknownRestoreApplies += 1;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "FAILED", reasons: [{ message: "simulated lost restore response" }] }) });
      return;
    }
    await route.continue();
  });
  await button(/恢复最新快照|Restore latest snapshot/).click();
  const unknownRestoreDrawer = page.getByRole("dialog", { name: /恢复快照|Restore snapshot/ });
  await unknownRestoreDrawer.waitFor({ state: "visible", timeout: 10000 });
  const unknownRestoreBar = unknownRestoreDrawer.locator(".drawer-action-bar");
  await unknownRestoreDrawer.getByRole("textbox", { name: /目标文件夹|Destination folder/ }).fill(unknownRestoreDestination);
  await unknownRestoreBar.getByRole("button", { name: /预览恢复计划|Preview restore/ }).click();
  await text(/恢复计划已生成|Restore plan is ready/).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await unknownRestoreBar.getAttribute("data-state"), "READY", "the unknown-outcome fixture must start from a ready restore plan");
  await unknownRestoreBar.getByRole("button", { name: /确认恢复|Confirm restore/ }).click();
  await text(/恢复结果未知|Restore outcome is unknown/i).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await unknownRestoreBar.getAttribute("data-state"), "AWAITING", "an unknown restore outcome must report the unknown state");
  assert.equal(await unknownRestoreBar.getByRole("button", { name: /确认恢复|Confirm restore/ }).count(), 0, "an unknown restore outcome must not offer a second apply");
  assert.equal(unknownRestoreApplies, 1, "a lost restore response must still represent exactly one apply attempt");
  await assertStickyBarInView(ctx, unknownRestoreDrawer, "an unknown restore outcome", "restore");
  await page.unroute("**/api/v1/command");
  await unknownRestoreBar.getByRole("button", { name: /^(关闭|Close)$/ }).click();
  await unknownRestoreDrawer.waitFor({ state: "hidden", timeout: 10000 });
}

// The search field is the export source for a selected result. Switching the
// export source must clear the frozen manifest instead of keeping a stale one.
export async function assertSelectedExport(ctx) {
  const { page, button } = ctx;
  await page.getByRole("main").getByRole("button", { name: /alpha\.txt/ }).first().click();
  await button(/^(导出|Export)$/).click();
  const selectedExportDrawer = page.getByRole("dialog", { name: /导出内容|Export content/ });
  await selectedExportDrawer.waitFor({ state: "visible", timeout: 10000 });
  await selectedExportDrawer.getByRole("button", { name: /选中的结果 alpha\.txt|Selected result alpha\.txt/ }).waitFor({ state: "visible", timeout: 10000 });
  await page.waitForLoadState("networkidle");
  for (const selector of [".export-other-sources", ".export-options", ".export-history"]) {
    assert.equal(await selectedExportDrawer.locator(selector).evaluate((element) => element.open), false, `${selector} must start collapsed for a selected-result export`);
  }
  const disclosureCommands = [];
  const captureDisclosureCommand = (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/command")) disclosureCommands.push(request.url());
  };
  page.on("request", captureDisclosureCommand);
  await openExportDisclosure(selectedExportDrawer, ".export-other-sources");
  page.off("request", captureDisclosureCommand);
  assert.deepEqual(disclosureCommands, [], "opening alternative sources must not issue a daemon command");
  assert.match(await selectedExportDrawer.getByRole("button", { name: /选中的结果 alpha\.txt|Selected result alpha\.txt/ }).getAttribute("class"), /active/, "opening alternatives must retain selected-result source intent");
  await selectedExportDrawer.getByRole("textbox", { name: /服务器输出目录|Server output directory/ }).fill(`${ctx.exportDestination}-selected`);
  await selectedExportDrawer.getByRole("button", { name: /预览冻结导出|Preview frozen export/ }).click();
  await selectedExportDrawer.getByText(/导出清单已冻结|Export manifest frozen/, { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  await selectedExportDrawer.getByRole("button", { name: /已保存的关键词查询|已保存查询|Saved query/ }).click();
  assert.equal(await selectedExportDrawer.getByText(/冻结导出清单|FROZEN EXPORT MANIFEST/, { exact: false }).count(), 0, "changing export source must clear the old frozen manifest");
  await selectedExportDrawer.getByRole("button", { name: /选中的结果 alpha\.txt|Selected result alpha\.txt/ }).click();
  await selectedExportDrawer.getByRole("button", { name: /预览冻结导出|Preview frozen export/ }).click();
  await selectedExportDrawer.getByText(/导出清单已冻结|Export manifest frozen/, { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  await selectedExportDrawer.getByRole("button", { name: /输出并校验|Materialize and verify/ }).click();
  await selectedExportDrawer.getByText(/导出已写入服务器目录并完成校验|Export materialized and verified in the server directory/, { exact: false }).waitFor({ state: "visible", timeout: 15000 });
  await selectedExportDrawer.getByRole("button", { name: /关闭导出|Close export/ }).click();
}

// A saved query becomes a durable view, freezes a manifest of its live
// membership, and materializes it. A failed verification offers only a retry
// against the same frozen manifest, never another export.apply.
export async function assertViewExportWithVerifyRetry(ctx) {
  const { page, button, text } = ctx;
  await button(/^(导出|Export)$/).click();
  let exportDrawer = page.getByRole("dialog", { name: /导出内容|Export content/ });
  await exportDrawer.waitFor({ state: "visible", timeout: 10000 });
  await openExportDisclosure(exportDrawer, ".export-other-sources");
  await page.route("**/api/v1/command", async (route) => {
    if (route.request().method() === "POST") {
      let payload;
      try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
      const input = payload?.input ?? {};
      if (payload?.operation === "export.apply" && input.destination === ctx.exportDestination) ctx.state.viewExportApplyRequests += 1;
      if (payload?.operation === "export.plan" && input.target === `${ctx.exportDestination}-delayed` && ctx.state.delayNextViewPlan) {
        ctx.state.delayNextViewPlan = false;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (payload?.operation === "export.verify" && input.destination === ctx.exportDestination && !ctx.state.injectedViewVerifyFailure) {
        ctx.state.injectedViewVerifyFailure = true;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "FAILED", reasons: [{ message: "temporary verification outage" }] }) });
        return;
      }
    }
    await route.continue();
  });
  // The frozen manifest planned later in this run must be the same durable
  // record that export.list history returns, so capture it from the daemon
  // reply instead of trusting the rendered drawer.
  page.on("response", async (response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/v1/command")) return;
    let request;
    try { request = response.request().postDataJSON(); } catch { request = undefined; }
    if (request?.operation !== "export.plan") return;
    // The sidecar policy assertion reads the payload the browser actually sent,
    // not the rendered drawer.
    ctx.state.lastExportPlanInput = request.input;
    let body;
    try { body = await response.json(); } catch { return; }
    if (body?.data?.manifest_id && body?.data?.manifest_digest) ctx.state.lastFrozenManifest = body.data;
  });
  await exportDrawer.getByRole("button", { name: /已保存的关键词查询|已保存查询|Saved query/ }).click();
  await exportDrawer.getByRole("textbox", { name: /保存查询名称|Saved query name/ }).fill("browser-note-view");
  await exportDrawer.getByRole("button", { name: /^(保存查询|Save query)$/ }).click();
  await exportDrawer.getByText(/查询已保存。冻结|Query saved\. The view remains/, { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  const sourceDisclosure = exportDrawer.locator(".export-other-sources");
  const sourceSummary = sourceDisclosure.locator("summary");
  assert.match(await sourceSummary.innerText(), /browser-note-view/, "a collapsed active-view disclosure must retain its selected source label");
  await sourceSummary.click();
  assert.equal(await sourceDisclosure.evaluate((element) => element.open), false, "the active saved-view source must remain identifiable while alternatives are collapsed");
  await sourceSummary.click();
  // The saved view is a durable daemon record: the drawer must list it back
  // immediately after the query is saved, with its stored revision.
  const savedViewRows = exportDrawer.locator(".export-view-row");
  await savedViewRows.first().waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await savedViewRows.count(), 1, "exactly one saved view must be listed after saving the query");
  const savedViewRowText = await savedViewRows.first().innerText();
  assert.match(savedViewRowText, /browser-note-view/, `saved view name missing: ${savedViewRowText}`);
  assert.match(savedViewRowText, /(?:版本|revision)\s*[1-9][0-9]*/i, `saved view revision missing: ${savedViewRowText}`);
  await exportDrawer.getByRole("textbox", { name: /服务器输出目录|Server output directory/ }).fill(`${ctx.exportDestination}-delayed`);
  ctx.state.delayNextViewPlan = true;
  const delayedPlan = exportDrawer.getByRole("button", { name: /预览冻结导出|Preview frozen export/ }).click();
  await exportDrawer.getByRole("button", { name: /关闭导出|Close export/ }).click();
  await delayedPlan;
  await button(/^(导出|Export)$/).click();
  exportDrawer = page.getByRole("dialog", { name: /导出内容|Export content/ });
  await exportDrawer.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await exportDrawer.getByText(/冻结导出清单|FROZEN EXPORT MANIFEST/, { exact: false }).count(), 0, "a delayed plan from a closed drawer must not reappear after reopening");
  await exportDrawer.getByRole("button", { name: /已保存的关键词查询|已保存查询|Saved query/ }).click();
  await exportDrawer.getByRole("textbox", { name: /保存查询名称|Saved query name/ }).fill("browser-note-view");
  await exportDrawer.getByRole("button", { name: /^(保存查询|Save query)$/ }).click();
  await exportDrawer.getByText(/查询已保存。冻结|Query saved\. The view remains/, { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  await exportDrawer.getByRole("textbox", { name: /服务器输出目录|Server output directory/ }).fill(ctx.exportDestination);
  await exportDrawer.getByRole("button", { name: /预览冻结导出|Preview frozen export/ }).click();
  await exportDrawer.getByText(/导出清单已冻结|Export manifest frozen/, { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  await exportDrawer.getByRole("button", { name: /输出并校验|Materialize and verify/ }).click();
  await exportDrawer.getByRole("alert").filter({ hasText: /输出已写入.*重试校验|Output was written.*verification failed.*Retry verification/i }).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(ctx.state.viewExportApplyRequests, 1, "the failed verification must follow exactly one export.apply");
  await exportDrawer.getByRole("button", { name: /重试校验|Retry verification/ }).click();
  await exportDrawer.getByText(/已根据冻结清单通过导出校验|Export verification passed/, { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(ctx.state.viewExportApplyRequests, 1, "retrying verification must not call export.apply again");
  await exportDrawer.getByRole("button", { name: /再次校验|Verify again/ }).click();
  await exportDrawer.getByText(/已根据冻结清单通过导出校验|Export verification passed/, { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  await exportDrawer.getByRole("button", { name: /关闭导出|Close export/ }).click();
  // The injection above must not outlive this check: a handler left registered
  // here keeps intercepting every later module's traffic and can collide with
  // a route another module registers on top of it.
  await page.unroute("**/api/v1/command");
}

// Isolate the bounded client outcome using the real durable view created by
// the drawer flow. The route is installed only for this explicit recall and is
// always removed before ordinary export-history assertions continue.
export async function assertBoundedSavedViewRecall(ctx, { viewName = "browser-note-view" } = {}) {
  const { page, button } = ctx;
  const boundedEvaluationRoute = async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
    if (payload?.operation === "view.evaluate") {
      const hits = Array.from({ length: 200 }, (_, index) => ({
        subject_ref: `fixture:bounded-view-${String(index + 1).padStart(3, "0")}`,
        name: `bounded-view-${String(index + 1).padStart(3, "0")}.txt`,
        entry_type: "REGULAR_FILE",
      }));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        status: "SUCCEEDED",
        data: { view_id: payload.input.view_id, query: "browser-note", hits, coverage: ["LEXICAL"] },
      }) });
      return;
    }
    await route.continue();
  };
  await page.route("**/api/v1/command", boundedEvaluationRoute);
  try {
    await button(/^(已保存的检索|Saved retrieval)$/).click();
    const retrievalPanel = page.locator("#saved-retrieval-panel");
    const savedRow = retrievalPanel.locator(".saved-retrieval-rows li").filter({ hasText: viewName });
    await savedRow.waitFor({ state: "visible", timeout: 10000 });
    await savedRow.getByRole("button", { name: /在内容库中打开|Open in library/ }).click();
    const recallCaption = page.locator(".recall-caption");
    await recallCaption.waitFor({ state: "visible", timeout: 10000 });
    // The shared result wall intentionally mounts only its visible window.
    // Assert the loaded sequence, not 200 simultaneous DOM rows.
    await page.waitForFunction(() => document.querySelector(".result-list")?.getAttribute("data-listing-count") === "200");
    await page.locator(".result-list .result-row").first().waitFor({ state: "visible", timeout: 10000 });
    const recalledHits = Number(await page.locator(".result-list").getAttribute("data-listing-count"));
    assert.equal(recalledHits, 200, `the bounded evaluation fixture must retain its returned matches: ${recalledHits}`);
    await recallCaption.getByText(/200 loaded matches|已加载 200 个匹配项/).waitFor({ state: "visible", timeout: 10000 });
    await recallCaption.getByText(/This view may have more matches|匹配项可能多于当前已加载结果/).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(".result-count").getByText(/200 loaded matches|已加载 200 个匹配项/).waitFor({ state: "visible", timeout: 10000 });
    await retrievalPanel.getByText(/200 loaded matches|已加载 200 个匹配项/).waitFor({ state: "visible", timeout: 10000 });
    await retrievalPanel.getByText(/This view may have more matches|匹配项可能多于当前已加载结果/).waitFor({ state: "visible", timeout: 10000 });
    const firstRecalledRow = page.locator(".result-list .result-row").first();
    await firstRecalledRow.hover();
    await firstRecalledRow.getByRole("checkbox", { name: /Select bounded-view-001\.txt|选择 bounded-view-001\.txt/i }).click();
    const recalledSelection = page.locator(".selection-bar");
    await recalledSelection.getByText(/更多操作|More actions/).click();
    await recalledSelection.getByRole("button", { name: /导出所选|Export selected/ }).click();
    const boundedExportDrawer = page.getByRole("dialog", { name: /导出内容|Export content/ });
    await boundedExportDrawer.waitFor({ state: "visible", timeout: 10000 });
    const selectedSource = boundedExportDrawer.getByRole("button", { name: /选中的结果 bounded-view-001\.txt|Selected result bounded-view-001\.txt/i });
    await selectedSource.waitFor({ state: "visible", timeout: 10000 });
    await boundedExportDrawer.getByRole("button", { name: /关闭导出|Close export/ }).click();
    await firstRecalledRow.getByRole("checkbox", { name: /Deselect bounded-view-001\.txt|取消选择 bounded-view-001\.txt/i }).click();
    await button(/^(导出|Export)$/).click();
    const viewSourceDrawer = page.getByRole("dialog", { name: /导出内容|Export content/ });
    await viewSourceDrawer.waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await viewSourceDrawer.locator(".export-other-sources").evaluate((element) => element.open), true, "a search with no selected file must initially expose the active view source");
    assert.match(await viewSourceDrawer.locator(".export-other-sources > summary").innerText(), /browser-note/, "the initially expanded view source must be named");
    await viewSourceDrawer.getByRole("button", { name: /关闭导出|Close export/ }).click();
  } finally {
    await page.unroute("**/api/v1/command", boundedEvaluationRoute);
  }
}

// Saved views and frozen manifests are durable daemon records: a full page
// reload must still list them, and neither may be rebuilt from client state.
// Recalling a saved view evaluates it now and renders the hits in the ordinary
// library result list. Export history lists the frozen manifest newest first,
// and re-verifying it from history must never materialize it again.
export async function assertDurableSavedViewsAfterReload(ctx) {
  const { page, button, text } = ctx;
  assert.ok(ctx.state.lastFrozenManifest?.manifest_id, "the view export must have been planned before checking export history");
  await page.reload({ waitUntil: "networkidle" });
  await text(/已连接|Connected/).waitFor({ state: "visible", timeout: 15000 });
  const reloadedItem = page.getByRole("main").getByRole("button", { name: /alpha\.txt/ }).first();
  await reloadedItem.waitFor({ state: "visible", timeout: 15000 });
  await reloadedItem.click();
  await button(/^(导出|Export)$/).click();
  const reloadedDrawer = page.getByRole("dialog", { name: /导出内容|Export content/ });
  await reloadedDrawer.waitFor({ state: "visible", timeout: 10000 });
  await openExportDisclosure(reloadedDrawer, ".export-other-sources");
  const reloadedRows = reloadedDrawer.locator(".export-view-row");
  await reloadedRows.first().waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await reloadedRows.count(), 1, "the saved view must still be listed after a page reload");
  const reloadedRowText = await reloadedRows.first().innerText();
  assert.match(reloadedRowText, /browser-note-view/, `reloaded saved view name missing: ${reloadedRowText}`);
  assert.match(reloadedRowText, /(?:版本|revision)\s*[1-9][0-9]*/i, `reloaded saved view revision missing: ${reloadedRowText}`);

  // Preserve real backend evaluation coverage before the bounded display case.
  await reloadedRows.first().getByRole("button", { name: /回到内容库|Recall in library/ }).click();
  await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "visible", timeout: 15000 });
  const recallCaption = page.locator(".recall-caption");
  await recallCaption.waitFor({ state: "visible", timeout: 10000 });
  await recallCaption.getByText(/实时求值|live evaluation/i).waitFor({ state: "visible", timeout: 10000 });
  await recallCaption.getByText(/成员是动态的|Membership is dynamic/).waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".result-list .result-row").first().waitFor({ state: "visible", timeout: 10000 });
  const recalledHits = Number(await page.locator(".result-list").getAttribute("data-listing-count"));
  assert.ok(recalledHits > 0, `real backend recall must render its dynamic hits: ${recalledHits}`);
  await recallCaption.getByText(new RegExp(`${recalledHits} loaded matches|已加载 ${recalledHits} 个匹配项`)).waitFor({ state: "visible", timeout: 10000 });
  if (recalledHits < 200) {
    assert.doesNotMatch(await recallCaption.innerText(), /This view may have more matches|匹配项可能多于当前已加载结果/, "under-cap real recall must not imply a bounded result");
  }

  await assertBoundedSavedViewRecall(ctx);

  await button(/^(导出|Export)$/).click();
  const historyDrawer = page.getByRole("dialog", { name: /导出内容|Export content/ });
  await historyDrawer.waitFor({ state: "visible", timeout: 10000 });
  await openExportDisclosure(historyDrawer, ".export-history");
  const historyRows = historyDrawer.locator(".export-history-row");
  await historyRows.first().waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await historyRows.first().getAttribute("title"), ctx.state.lastFrozenManifest.manifest_id, "export history must list the newest frozen manifest first");
  const historyRow = historyDrawer.locator(`.export-history-row[title="${ctx.state.lastFrozenManifest.manifest_id}"]`);
  await historyRow.waitFor({ state: "visible", timeout: 10000 });
  const historyText = await historyRow.innerText();
  assert.match(historyText, /(?:exact|精确)/i, `export history representation missing: ${historyText}`);
  assert.match(historyText, new RegExp(`${ctx.state.lastFrozenManifest.subject_count}\\s*(?:files?|文件)`), `export history subject count missing: ${historyText}`);
  assert.ok(historyText.includes(ctx.state.lastFrozenManifest.target), `export history target missing: ${historyText}`);
  await historyRow.click();
  const frozenDigest = (await historyDrawer.locator(".export-digest-body strong").first().textContent())?.trim();
  assert.equal(frozenDigest, ctx.state.lastFrozenManifest.manifest_digest, "a manifest recalled from history must keep its frozen digest");
  await historyDrawer.getByRole("textbox", { name: /服务器输出目录|Server output directory/ }).fill(ctx.exportDestination);
  assert.equal(await historyDrawer.getByRole("button", { name: /输出并校验|Materialize and verify/ }).count(), 0, "a history manifest must never offer to materialize again");
  const historyVerifyApplyCount = ctx.state.viewExportApplyRequests;
  await historyDrawer.getByRole("button", { name: /校验这份冻结清单|Verify this frozen manifest/ }).click();
  await historyDrawer.getByText(/已根据冻结清单通过导出校验|Export verification passed/, { exact: false }).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(ctx.state.viewExportApplyRequests, historyVerifyApplyCount, "verifying a manifest from history must not call export.apply");
  await historyDrawer.getByRole("button", { name: /关闭导出|Close export/ }).click();
}

// The sidecar policy is a closed vocabulary the daemon implements and verifies.
// These assertions pin that the browser sends exactly the selected policy, that
// the empty default is the absent field rather than an empty string, and that a
// frozen manifest locks the choice.
export async function assertExportSidecarPolicy(ctx) {
  const { page, button } = ctx;
  // This phase may start on any workspace view, so it establishes its own state:
  // the library listing with one selected subject.
  await button(/内容库|Library/).click();
  await page.getByRole("main").getByRole("button", { name: /alpha\.txt/ }).first().click();
  await button(/^(导出|Export)$/).click();
  const drawer = page.getByRole("dialog", { name: /导出内容|Export content/ });
  await drawer.waitFor({ state: "visible", timeout: 10000 });
  await openExportDisclosure(drawer, ".export-options");
  const selector = drawer.getByLabel(/随附文件策略|Sidecar policy/);
  await selector.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await selector.inputValue(), "", "the default sidecar policy must be the empty (none) value");
  // Default policy: the field is absent from the payload, not empty.
  await drawer.getByRole("textbox", { name: /服务器输出目录|Server output directory/ }).fill(`${ctx.exportDestination}-sidecar-default`);
  await drawer.getByRole("button", { name: /预览冻结导出|Preview frozen export/ }).click();
  await drawer.getByText(/导出清单已冻结|Export manifest frozen/, { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  assert.ok(ctx.state.lastExportPlanInput, "the default plan payload must have been captured");
  assert.equal(Object.prototype.hasOwnProperty.call(ctx.state.lastExportPlanInput, "sidecars"), false, `the empty policy must be the absent field: ${JSON.stringify(ctx.state.lastExportPlanInput)}`);
  assert.equal(await selector.isDisabled(), true, "a frozen manifest must lock the sidecar policy");
  await drawer.getByRole("button", { name: /关闭导出|Close export/ }).click();
  // Selected policy: the vocabulary reaches the daemon unchanged.
  await button(/^(导出|Export)$/).click();
  const second = page.getByRole("dialog", { name: /导出内容|Export content/ });
  await second.waitFor({ state: "visible", timeout: 10000 });
  await openExportDisclosure(second, ".export-options");
  await second.getByLabel(/随附文件策略|Sidecar policy/).selectOption("handoff-v1:manifest-json");
  await second.getByRole("textbox", { name: /服务器输出目录|Server output directory/ }).fill(`${ctx.exportDestination}-sidecar-handoff`);
  await second.getByRole("button", { name: /预览冻结导出|Preview frozen export/ }).click();
  await second.getByText(/导出清单已冻结|Export manifest frozen/, { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(ctx.state.lastExportPlanInput?.sidecars, "handoff-v1:manifest-json", `the selected policy must reach the daemon: ${JSON.stringify(ctx.state.lastExportPlanInput)}`);
  await second.getByRole("button", { name: /关闭导出|Close export/ }).click();
}

// The export preset is browser-local convenience state, and this phase pins
// both halves of that statement: the last plan's destination and sidecar choice
// are pre-filled on the next open in the same workspace, and the drawer labels
// the prefill as browser-local instead of letting it read as a durable daemon
// default. The stored pair never changes the plan payload, which stays exactly
// the fields the daemon accepts.
export async function assertExportBrowserPreset(ctx) {
  const { page, button } = ctx;
  const workspaceID = String(await page.evaluate(() => localStorage.getItem("cairn.workspace_id") ?? "")).trim();
  assert.ok(workspaceID, "the harness must have selected a workspace before the preset can be stored");
  const presetKey = `cairn.export_preset.${workspaceID}`;
  // The previous phase planned an export with this destination and the handoff
  // sidecar, so both must now be remembered for this workspace.
  const stored = JSON.parse(await page.evaluate((key) => localStorage.getItem(key) ?? "null", presetKey) ?? "null");
  assert.ok(stored, `the last used export choices must be stored under ${presetKey}: ${JSON.stringify(stored)}`);
  assert.equal(stored.sidecars, "handoff-v1:manifest-json", `the stored preset must keep the chosen sidecar: ${JSON.stringify(stored)}`);
  assert.ok(String(stored.destination ?? "").length > 0, `the stored preset must keep the planned destination: ${JSON.stringify(stored)}`);

  await button(/内容库|Library/).click();
  await page.getByRole("main").getByRole("button", { name: /alpha\.txt/ }).first().click();
  await button(/^(导出|Export)$/).click();
  const drawer = page.getByRole("dialog", { name: /导出内容|Export content/ });
  await drawer.waitFor({ state: "visible", timeout: 10000 });
  await openExportDisclosure(drawer, ".export-options");
  const destination = drawer.getByRole("textbox", { name: /服务器输出目录|Server output directory/ });
  const selector = drawer.getByLabel(/随附文件策略|Sidecar policy/);
  await destination.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await destination.inputValue(), stored.destination, "the drawer must pre-fill the last used destination");
  assert.equal(await selector.inputValue(), "handoff-v1:manifest-json", "the drawer must pre-fill the last used sidecar choice");
  const note = drawer.locator(".export-preset-note");
  assert.equal(await note.count(), 1, "a pre-filled drawer must label the prefill");
  assert.equal(await note.getAttribute("data-export-preset"), "browser-local", "the prefill label must state that it is browser-local");
  await drawer.getByRole("button", { name: /关闭导出|Close export/ }).click();
  // A cleared value stays empty: the preset is read on open, so removing it
  // must leave both fields empty and withdraw the browser-local label instead
  // of falling back to a default the operator never chose.
  await page.evaluate((key) => localStorage.removeItem(key), presetKey);
  await button(/^(导出|Export)$/).click();
  const clearedDrawer = page.getByRole("dialog", { name: /导出内容|Export content/ });
  await clearedDrawer.waitFor({ state: "visible", timeout: 10000 });
  await openExportDisclosure(clearedDrawer, ".export-options");
  assert.equal(await clearedDrawer.getByRole("textbox", { name: /服务器输出目录|Server output directory/ }).inputValue(), "", "a cleared preset must leave the destination empty");
  assert.equal(await clearedDrawer.getByLabel(/随附文件策略|Sidecar policy/).inputValue(), "", "a cleared preset must leave the sidecar choice empty");
  assert.equal(await clearedDrawer.locator(".export-preset-note").count(), 0, "an empty preset must not be labelled");
  await clearedDrawer.getByRole("button", { name: /关闭导出|Close export/ }).click();
}
