import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const playwrightModule = process.env.CAIRN_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(playwrightModule);
const url = process.env.CAIRN_WEB_E2E_URL;
const sourceParent = process.env.CAIRN_WEB_E2E_SOURCE || process.env.SOURCE;
assert(url, "CAIRN_WEB_E2E_URL is required");
assert(sourceParent, "CAIRN_WEB_E2E_SOURCE (or SOURCE) is required");
const source = fs.mkdtempSync(path.join(path.resolve(sourceParent), "cairn-plan-e2e-"));
fs.writeFileSync(path.join(source, "plan-e2e.txt"), "plan e2e exact content\n");
const browser = await chromium.launch({ headless: true, ...(process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const button = (name) => page.getByRole("button", { name });
let delayedIngest = true;
let applyRequests = 0;
let droppedApply = false;

try {
  await page.route("**/api/v1/command", async (route) => {
    let body;
    try { body = route.request().postDataJSON(); } catch { body = undefined; }
    if (body?.operation === "plan.ingest" && delayedIngest) {
      delayedIngest = false;
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
      return;
    }
    if (body?.operation === "plan.apply") {
      applyRequests += 1;
      const real = await route.fetch();
      if (!droppedApply) {
        droppedApply = true;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "FAILED", reasons: [{ message: "simulated lost apply response" }] }) });
        return;
      }
      await route.fulfill({ response: real });
      return;
    }
    await route.continue();
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByText(/已连接|Connected/).waitFor({ state: "visible", timeout: 10000 });
  await button(/添加来源|Add source/).first().click();
  const drawer = page.getByRole("dialog", { name: /添加来源|Add source/ });
  await drawer.waitFor({ state: "visible" });
  const input = drawer.getByRole("textbox", { name: /Cairn 主机上的路径|Path on Cairn host/ });
  await input.fill(source);
  await drawer.getByRole("button", { name: /预览存储计划|Preview storage plan/ }).click();
  await page.waitForTimeout(80);
  assert.equal(await input.isDisabled(), true, "source path must be disabled while plan.ingest is pending");
  await page.keyboard.press("Escape");
  assert.equal(await drawer.isVisible(), true, "Escape must not close an active plan operation");
  await drawer.getByText(/存储计划已生成|Storage plan is ready/).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await input.isDisabled(), false, "source path must re-enable after inspection");

  await drawer.getByRole("button", { name: /确认保存|Confirm save/ }).click();
  await drawer.getByText(/保护结果未知|保护结果等待核实|Protection outcome is unknown|Protection result needs verification|awaiting confirmation/i).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(applyRequests, 1, "lost apply response must still represent one real apply");
  assert.equal(await drawer.getByRole("button", { name: /确认保存|Confirm save/ }).count(), 0, "unknown result must not offer a second apply");
  await drawer.getByRole("button", { name: /检查保护结果|Check protection result/ }).click();
  await drawer.getByText(/内容已保存|Content saved/).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(applyRequests, 1, "plan status check must not apply twice");
  await drawer.getByRole("button", { name: /查看已保存内容|View saved content/ }).click();
  await drawer.waitFor({ state: "hidden", timeout: 10000 });
  await page.getByRole("button", { name: /plan-e2e\.txt/ }).first().waitFor({ state: "visible", timeout: 15000 });
  assert.equal(applyRequests, 1);
} finally {
  await browser.close();
  fs.rmSync(source, { recursive: true, force: true });
}
console.log("PASS: plan review/apply unknown-response reconciliation E2E");
