// The two phase-level checkpoints that span surfaces: the offline phase (the
// service is unreachable and the library must say so without losing saved
// content) and the recovered phase (a restarted daemon still serves the same
// durable content).
//
// Owner: the shell's connection projection. The assertions here keep the
// original statements and order and may be extended, never weakened.

import assert from "node:assert/strict";
import { assertNoHorizontalOverflow } from "./support.mjs";
import { assertStatusServiceDown } from "./status.mjs";

export async function assertOfflinePhase(ctx) {
  const { page, text } = ctx;
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /刷新服务状态|Refresh service status/ }).click();
  await text(/服务不可用|service is unavailable/i).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByRole("textbox", { name: /搜索内容库|Search library/ }).isDisabled(), true);
  // The trusted status surface must not claim any fact while the service is
  // unreachable, and it must not render a readiness dot at all.
  await assertStatusServiceDown(ctx);
}

export async function assertRecoveredPhase(ctx) {
  const { page, text } = ctx;
  await page.getByRole("button", { name: /刷新服务状态|Refresh service status/ }).click();
  await text(/已连接|Connected/).waitFor({ state: "visible", timeout: 10000 });
  const recoveredItem = page.getByRole("main").getByRole("button", { name: /alpha\.txt/ }).first();
  await recoveredItem.waitFor({ state: "visible", timeout: 10000 });
  await recoveredItem.click();
  await page.getByRole("complementary").getByText("browser-e2e", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("durable browser note", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await assertNoHorizontalOverflow(ctx);
}
