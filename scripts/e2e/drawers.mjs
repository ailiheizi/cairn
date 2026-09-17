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
    let body;
    try { body = await response.json(); } catch { return; }
    if (body?.data?.manifest_id && body?.data?.manifest_digest) ctx.state.lastFrozenManifest = body.data;
  });
  await exportDrawer.getByRole("button", { name: /已保存的关键词查询|已保存查询|Saved query/ }).click();
  await exportDrawer.getByRole("textbox", { name: /保存查询名称|Saved query name/ }).fill("browser-note-view");
  await exportDrawer.getByRole("button", { name: /^(保存查询|Save query)$/ }).click();
  await exportDrawer.getByText(/查询已保存。冻结|Query saved\. The view remains/, { exact: false }).waitFor({ state: "visible", timeout: 10000 });
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
  const reloadedRows = reloadedDrawer.locator(".export-view-row");
  await reloadedRows.first().waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await reloadedRows.count(), 1, "the saved view must still be listed after a page reload");
  const reloadedRowText = await reloadedRows.first().innerText();
  assert.match(reloadedRowText, /browser-note-view/, `reloaded saved view name missing: ${reloadedRowText}`);
  assert.match(reloadedRowText, /(?:版本|revision)\s*[1-9][0-9]*/i, `reloaded saved view revision missing: ${reloadedRowText}`);

  await reloadedRows.first().getByRole("button", { name: /回到内容库|Recall in library/ }).click();
  await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "visible", timeout: 15000 });
  const recallCaption = page.locator(".recall-caption");
  await recallCaption.waitFor({ state: "visible", timeout: 10000 });
  await recallCaption.getByText(/实时求值|live evaluation/i).waitFor({ state: "visible", timeout: 10000 });
  await recallCaption.getByText(/成员是动态的|Membership is dynamic/).waitFor({ state: "visible", timeout: 10000 });
  const recalledResult = page.locator(".result-list .result-row").first();
  await recalledResult.waitFor({ state: "visible", timeout: 10000 });
  const recalledHits = await page.locator(".result-list .result-row").count();
  assert.ok(recalledHits > 0, `recalling the saved view must render its dynamic hits: ${recalledHits}`);

  await button(/^(导出|Export)$/).click();
  const historyDrawer = page.getByRole("dialog", { name: /导出内容|Export content/ });
  await historyDrawer.waitFor({ state: "visible", timeout: 10000 });
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
