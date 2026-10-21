import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { chromium } = await import(process.env.CAIRN_PLAYWRIGHT_MODULE || "../web/node_modules/playwright/index.mjs");
const url = process.env.CAIRN_PREVIEW_E2E_URL;
const largeImageName = process.env.CAIRN_PREVIEW_E2E_IMAGE_NAME;
const overBudgetName = process.env.CAIRN_PREVIEW_E2E_OVER_BUDGET_NAME;
const zeroTextName = process.env.CAIRN_PREVIEW_E2E_ZERO_TEXT_NAME;
let textName = process.env.CAIRN_PREVIEW_E2E_TEXT_NAME;
const seedTextReferences = process.env.CAIRN_PREVIEW_E2E_SEED_TEXT_REFERENCES === "1";
const pasteTextReferences = process.env.CAIRN_PREVIEW_E2E_PASTE_TEXT_REFERENCES === "1";
const unsupportedFiles = JSON.parse(process.env.CAIRN_PREVIEW_E2E_UNSUPPORTED_FILES || "[]");
const evidenceDir = process.env.CAIRN_PREVIEW_E2E_EVIDENCE_DIR;
assert(url && (seedTextReferences || pasteTextReferences || (largeImageName && overBudgetName)), "CAIRN_PREVIEW_E2E_URL is required; the existing image/over-budget names are required outside reference-only mode");
assert(!(seedTextReferences && pasteTextReferences), "choose exactly one text-reference setup mode");

const executablePath = process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH?.trim();
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const calls = [];
const opens = new Map();
const closes = new Map();
const readResults = new Map();
const exportPlans = [];
const externalRequests = [];
const requestedURLs = [];
const commandOperations = [];
const uploadRequests = [];
let seededTextRoot;
let seededReferenceText = "";
let seededSafeClickTarget = "";
let fault = "";
let releaseHeldRead;
let markHeldRead;
const heldReadSeen = new Promise((resolve) => { markHeldRead = resolve; });
const heldReadGate = new Promise((resolve) => { releaseHeldRead = resolve; });
page.context().on("request", (request) => {
  requestedURLs.push(request.url());
  try {
    const requestURL = new URL(request.url());
    const appOrigin = new URL(url).origin;
    if (["http:", "https:"].includes(requestURL.protocol) && requestURL.origin !== appOrigin) externalRequests.push(request.url());
  } catch { /* Non-network Playwright request URLs are ignored. */ }
  if (request.method() === "POST" && /\/api\/v1\/upload(?:\?|$)/.test(request.url())) uploadRequests.push(request);
  if (request.method() !== "POST" || !request.url().includes("/api/v1/command")) return;
  try {
    const payload = request.postDataJSON();
    commandOperations.push({ operation: payload?.operation, input: payload?.input });
    if (payload?.operation?.startsWith("content.")) calls.push({ ...payload, request });
    if (payload?.operation === "export.plan") exportPlans.push({ input: payload.input, result: null });
  } catch { /* Other command traffic is not part of this evidence. */ }
});
page.on("response", async (response) => {
  if (!response.url().includes("/api/v1/command") || response.request().method() !== "POST") return;
  let result;
  try { result = await response.json(); } catch { return; }
  const call = calls.find((item) => item.request === response.request());
  if (call?.operation === "content.read" && result?.data) readResults.set(response.request(), result.data);
  if (result?.operation === "export.plan" && ["SUCCEEDED", "DEGRADED"].includes(result.status)) {
    const plan = [...exportPlans].reverse().find((item) => item.result === null);
    if (plan) plan.result = result.data;
  }
  if (call?.operation === "content.open" && ["SUCCEEDED", "DEGRADED"].includes(result.status) && result.data?.handle) opens.set(result.data.handle, result.data);
  if (call?.operation === "content.close" && ["SUCCEEDED", "DEGRADED"].includes(result.status)) {
    const handle = call?.input?.handle;
    if (handle) closes.set(handle, (closes.get(handle) || 0) + 1);
  }
});

try {
  if (pasteTextReferences) {
    const base = new URL(url);
    assert(["127.0.0.1", "localhost", "::1"].includes(base.hostname), "pasted-text fixture must use a loopback preview");
    assert.notEqual(base.port, "4648", "pasted-text fixture must not target the protected local preview on port 4648");
    seededSafeClickTarget = new URL("/__cairn_text_reference_click__/authorized", base.origin).href;
    seededReferenceText = [
      "  UTF-8 research note 中文 — links stay inert until selected.\n",
      `A local reference: ${seededSafeClickTarget}，继续。\n`,
      "Other references: (https://example.test/path) https://example.test/wiki/Test_(case). （https://example.test/path） https://example.test/path). https://example.test/path]. https://example.test，继续\n",
      "Unsafe tokens: javascript:https://example.test/x data:text/plain,https://example.test/x //relative.example/path https://user:pass@example.test/x https://?bad=x https:///example.test/x https://example.test/%GG https://example.test/c1\u009ftail https://example.test\\trick\n",
      "\tkeep trailing text exactly  \n",
    ].join("");
    textName = "Cairn-Pasted-Text-References-20261014.txt";
    process.env.CAIRN_PREVIEW_E2E_TEXT_EXPECTED = seededReferenceText;
    process.env.CAIRN_PREVIEW_E2E_TEXT_SAFE_CLICK_TARGET = seededSafeClickTarget;
  }
  if (seedTextReferences) {
    const base = new URL(url);
    assert(["127.0.0.1", "localhost", "::1"].includes(base.hostname), "reference fixture seeding is limited to loopback previews");
    assert.notEqual(base.port, "4648", "reference fixture seeding must not target the protected local preview on port 4648");
    seededSafeClickTarget = new URL("/__cairn_text_reference_click__/authorized", base.origin).href;
    seededReferenceText = [
      "UTF-8 research note 中文 — links stay inert until selected.\n",
      `A local reference: ${seededSafeClickTarget}，继续。\n`,
      "Other references: (https://example.test/path) https://example.test/wiki/Test_(case). （https://example.test/path） https://example.test/path). https://example.test/path]. https://example.test，继续\n",
      "Unsafe tokens: javascript:https://example.test/x data:text/plain,https://example.test/x //relative.example/path https://user:pass@example.test/x https://?bad=x https:///example.test/x https://example.test/%GG https://example.test/c1\u009ftail https://example.test\\trick\n",
    ].join("");
    seededTextRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cairn-text-reference-e2e-"));
    const referenceTextName = "Cairn-Text-References-20261014.txt";
    fs.writeFileSync(path.join(seededTextRoot, referenceTextName), seededReferenceText, "utf8");
    const sendCommand = async (operation, input) => {
      const response = await fetch(new URL("/api/v1/command", base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, input }) });
      assert.equal(response.ok, true, `${operation} returned HTTP ${response.status}`);
      const result = await response.json();
      assert(["SUCCEEDED", "DEGRADED"].includes(result.status), `${operation}: ${JSON.stringify(result.reasons ?? [])}`);
      return result.data;
    };
    const plan = await sendCommand("plan.ingest", { root: seededTextRoot });
    assert.equal(plan.executable, true, "reference fixture ingest plan is executable");
    const applied = await sendCommand("plan.apply", { workspace_id: plan.workspace_id, plan_id: plan.plan_id, plan_digest: plan.plan_digest });
    assert(["SUCCEEDED", "DEGRADED"].includes(applied.state), "reference fixture is ingested through the ordinary exact-save path");
    textName = referenceTextName;
    process.env.CAIRN_PREVIEW_E2E_TEXT_EXPECTED = seededReferenceText;
    process.env.CAIRN_PREVIEW_E2E_TEXT_SAFE_CLICK_TARGET = seededSafeClickTarget;
  }
  if (pasteTextReferences) {
    await preparePastedTextThroughAdd();
    await runTextReferenceJourney();
  } else if (seedTextReferences) {
    await runTextReferenceJourney();
  } else {
  await page.route("**/api/v1/command", async (route) => {
    if (!fault) return route.continue();
    const request = route.request();
    let payload;
    try { payload = request.postDataJSON(); } catch { return route.continue(); }
    if (payload?.operation !== "content.read") return route.continue();
    const response = await route.fetch();
    const result = await response.json();
    if (fault === "hold") {
      fault = "";
      markHeldRead();
      await heldReadGate;
      return route.fulfill({ response, body: JSON.stringify(result) });
    }
    if (fault === "interrupted") {
      fault = "";
      return route.fulfill({ response, body: JSON.stringify({ ...result, status: "FAILED", data: null, reasons: [{ message: "Injected interrupted read" }] }) });
    }
    if (fault === "range") {
      fault = "";
      result.data.offset += 1;
    } else if (fault === "corrupt") {
      fault = "";
      const bytes = Buffer.from(result.data.bytes, "base64");
      bytes[0] ^= 1;
      result.data.bytes = bytes.toString("base64");
    }
    await route.fulfill({ response, body: JSON.stringify(result) });
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByText(/已连接|Connected/).waitFor({ state: "visible", timeout: 15000 });
  const browseEvidence = [];
  if (textName && unsupportedFiles.length) {
    await page.locator(".result-open-copy strong").first().waitFor({ state: "visible", timeout: 15000 });
    const initialNames = await page.locator(".result-open-copy strong").allTextContents();
    const sort = page.getByRole("combobox", { name: /Sort field|排序字段/ });
    await sort.selectOption("size");
    assert.equal((await page.locator(".result-open-copy strong").allTextContents())[0], zeroTextName, "ascending size puts the zero-byte file first");
    await page.getByRole("button", { name: /Sort direction|排序方向/ }).click();
    assert.equal((await page.locator(".result-open-copy strong").allTextContents())[0], overBudgetName, "descending size puts the largest file first");
    await page.getByRole("button", { name: /Sort direction|排序方向/ }).click();
    await sort.selectOption("name");
    await page.locator(".system-facets-disclosure > summary").click();
    await page.locator(".system-facet-group").getByRole("button", { name: /^png\s+2$/i }).click();
    assert.deepEqual(new Set(await page.locator(".result-open-copy strong").allTextContents()), new Set([largeImageName, overBudgetName]), "format facet shows the two recorded PNG entries");
    assert.equal(await page.locator(".filter-summary").isVisible(), true, "active filter stays visible");
    await page.locator(".filter-summary-clear").click();
    assert.deepEqual(new Set(await page.locator(".result-open-copy strong").allTextContents()), new Set(initialNames), "clear restores the same listing");
    await page.getByRole("button", { name: /List view|列表视图/, exact: true }).click();
    assert.equal(await page.locator(".result-list.list-mode").count(), 1, "list control retains all content");
    await page.getByRole("button", { name: /Grid view|网格视图/, exact: true }).click();
    await page.locator('.library-view-switch [data-view="photos"]').click();
    assert.deepEqual(new Set(await page.locator(".result-open-copy strong").allTextContents()), new Set([largeImageName, overBudgetName]));
    await page.locator('.library-view-switch [data-view="music"]').click();
    assert.deepEqual(await page.locator(".result-open-copy strong").allTextContents(), ["Track.m4a"]);
    await page.locator('.library-view-switch [data-view="content"]').click();
    await page.goto(`${url.replace(/\/$/, "")}/#v=content&month=1900-01`, { waitUntil: "networkidle" });
    // Hash projections are restored once on mount; a same-document hash
    // navigation alone intentionally does not remount the client.
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".filter-summary").waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await page.locator(".result-row").count(), 0, "unmatched month has no visible rows");
    assert.match(await page.locator(".result-count").innerText(), /^0\s/, "unmatched month reports zero visible items");
    assert.match(await page.locator(".empty-state").innerText(), /filters|筛选/, "unmatched month shows a meaningful filtered-empty state");
    await page.locator(".filter-summary-clear").click();
    assert.deepEqual(new Set(await page.locator(".result-open-copy strong").allTextContents()), new Set(initialNames), "clearing an empty month restores the listing");
    for (const interfaceId of ["workspace", "showcase"]) {
      await page.getByRole("button", { name: /Open settings|打开设置/ }).click();
      const settings = page.getByRole("dialog", { name: /Settings|设置/ });
      await settings.getByRole("button", { name: /Appearance|外观/ }).click();
      await settings.locator(`input[name="cairn-interface"][value="${interfaceId}"]`).check();
      await settings.getByRole("button", { name: /Close settings|关闭设置/ }).click();
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        const geometry = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert(geometry.scroll <= geometry.viewport + 1, `${interfaceId} library does not overflow at ${width}`);
        const tools = page.locator(".space-report > summary");
        await tools.press("Enter");
        const popover = await page.locator(".space-report-body").boundingBox();
        assert(popover && popover.x >= 0 && popover.x + popover.width <= width + 1, `${interfaceId} space report stays within ${width}`);
        assert.match(await page.locator(".space-report-body").innerText(), /loaded|已加载/, "the report retains its measured scope");
        await tools.press("Enter");
        const timeline = page.locator(".timeline-control > summary");
        await timeline.press("Enter");
        const timelineBox = await page.locator(".timeline-strip").boundingBox();
        assert(timelineBox && timelineBox.x >= 0 && timelineBox.x + timelineBox.width <= width + 1, `${interfaceId} month browser stays within ${width}`);
        await timeline.press("Enter");
        browseEvidence.push({ interface: interfaceId, width, no_overflow: true, report_inside_viewport: true, timeline_inside_viewport: true });
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await openEntry(largeImageName);
  const preview = page.getByRole("main").locator(".details .cairn-content-preview");
  const image = preview.locator("img.cairn-content-preview__image");
  await image.waitFor({ state: "visible", timeout: 30000 });
  assert.equal(await poll(() => image.evaluate((node) => node.complete && node.naturalWidth > 0), 30000), true, "large exact image should decode after bounded reads and digest verification");
  const desktopGeometry = await assertInspectorImageBounds(image, 1280, "desktop");
  if (evidenceDir) {
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, "large-image-preview.png") });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await image.waitFor({ state: "visible", timeout: 10000 });
  const narrowGeometry = await assertInspectorImageBounds(image, 390, "narrow");
  if (evidenceDir) await page.screenshot({ path: path.join(evidenceDir, "large-image-preview-narrow.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  const opened = [...opens.values()].find((item) => item.logical_size > (1 << 20) && item.logical_size <= (8 << 20));
  assert(opened, "expected content.open to bind a 1-8 MiB image");
  assert.match(opened.content_id, /^sha256:[a-f0-9]{64}$/i, "opened content must identify its exact SHA-256");
  const reads = calls.filter((call) => call.operation === "content.read" && call.input?.handle === opened.handle);
  assert(reads.length > 1, "image must use multiple content.read requests");
  assert.deepEqual(reads.map((call) => call.input.offset), reads.map((_, index) => index === 0 ? 0 : reads[index - 1].input.offset + reads[index - 1].input.length), "read ranges must be contiguous");
  assert.equal(reads.reduce((total, call) => total + call.input.length, 0), opened.logical_size, "read ranges must cover the exact logical length");
  assert(reads.every((call) => call.input.length <= opened.max_read && call.input.length <= (1 << 20)), "each read must honor max_read and the 1 MiB transport cap");
  const imageParts = reads.map((call) => Buffer.from(readResults.get(call.request)?.bytes ?? "", "base64"));
  const reconstructed = Buffer.concat(imageParts);
  assert.equal(reconstructed.length, opened.logical_size, "captured ranges must reconstruct the complete logical byte stream");
  assert.equal(`sha256:${createHash("sha256").update(reconstructed).digest("hex")}`, opened.content_id, "captured browser ranges must match the original exact identity");
  await closePreview(preview);
  await waitClosed(opened.handle);
  assert.equal(closes.get(opened.handle), 1, "successful preview must close its handle exactly once");

  const opensBefore = opens.size;
  await openEntry(overBudgetName);
  const over = page.getByRole("main").locator(".details .cairn-content-preview");
  await over.locator('[data-state="unavailable"][data-reason="size-limit"]').waitFor({ state: "visible", timeout: 10000 });
  await over.getByText(/8 MiB|8 MiB|下载或导出|downloaded or exported/, { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(opens.size, opensBefore, "over-budget image must show takeout fallback without opening a content handle");

  for (const [index, mode] of ["range", "corrupt", "interrupted"].entries()) {
    if (index > 0) await openEntry(overBudgetName);
    const priorHandles = new Set(opens.keys());
    fault = mode;
    await openEntry(largeImageName);
    const failed = page.getByRole("main").locator(".details .cairn-content-preview");
    await page.waitForTimeout(1000);
    const errorCount = await failed.locator(".cairn-content-preview__status--error").count();
    const imageCount = await failed.locator("img.cairn-content-preview__image").count();
    assert.equal(errorCount, 1, `${mode} injected read should fail closed (preview text=${await failed.innerText()}, image count=${imageCount})`);
    assert.equal(await failed.locator("img.cairn-content-preview__image").count(), 0, `${mode} content must never render`);
    const handle = [...opens.keys()].reverse().find((candidate) => !priorHandles.has(candidate));
    assert(handle, `${mode} request must open a scoped handle`);
    await waitClosed(handle);
    assert.equal(closes.get(handle), 1, `${mode} failure must close its handle exactly once`);
    await closePreview(failed);
  }

  await openEntry(overBudgetName);
  const priorHandles = new Set(opens.keys());
  fault = "hold";
  await openEntry(largeImageName);
  await Promise.race([heldReadSeen, new Promise((_, reject) => setTimeout(() => reject(new Error("held read did not start")), 15000))]);
  const heldHandle = [...opens.keys()].reverse().find((candidate) => !priorHandles.has(candidate));
  assert(heldHandle, "cancellation case must acquire a scoped handle");
  await openEntry(overBudgetName);
  await waitClosed(heldHandle);
  releaseHeldRead();
  await page.getByRole("main").locator('.details .cairn-content-preview [data-state="unavailable"][data-reason="size-limit"]').waitFor({ state: "visible", timeout: 10000 });
  assert.equal(closes.get(heldHandle), 1, "canceled in-flight read must close exactly once after becoming stale");

  let zeroTextEvidence = null;
  if (zeroTextName) {
    const priorZeroHandles = new Set(opens.keys());
    await openEntry(zeroTextName);
    const zeroPreview = page.getByRole("main").locator(".details .cairn-content-preview");
    const text = zeroPreview.locator(".cairn-content-preview__text");
    await text.waitFor({ state: "visible", timeout: 15000 });
    assert.equal(await text.innerText(), "", "zero-length UTF-8 text remains a valid preview");
    const zeroHandle = [...opens.keys()].reverse().find((candidate) => !priorZeroHandles.has(candidate));
    assert(zeroHandle, "zero-length text must acquire an exact content handle");
    const zeroRead = calls.find((call) => call.operation === "content.read" && call.input?.handle === zeroHandle);
    assert(zeroRead, "zero-length text must perform its exact zero-length read");
    assert.equal(zeroRead.input.offset, 0);
    assert.equal(zeroRead.input.length, 0);
    assert.equal(readResults.get(zeroRead.request)?.eof, true);
    await closePreview(zeroPreview);
    await waitClosed(zeroHandle);
    zeroTextEvidence = { content_id: opens.get(zeroHandle).content_id, logical_size: 0, read_length: 0, closed_once: true };
  }
  let textEvidence = null;
  if (textName) {
    await openEntry(textName);
    const textPreview = page.getByRole("main").locator(".details .cairn-content-preview");
    await textPreview.locator(".cairn-content-preview__text").waitFor({ state: "visible", timeout: 15000 });
    assert.match(await textPreview.innerText(), /UTF-8.*中文/s, "real UTF-8 text remains readable");
    textEvidence = { name: textName, utf8_rendered: true };
  }
  const unsupportedEvidence = [];
  for (const file of unsupportedFiles) {
    assert.equal(typeof file.name, "string");
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    const beforeCount = calls.filter((call) => ["content.open", "content.read"].includes(call.operation)).length;
    await openEntry(file.name);
    const fallback = page.getByRole("main").locator(".details .cairn-content-preview");
    await fallback.locator('[data-state="unavailable"][data-reason="unsupported-format"]').waitFor({ state: "visible", timeout: 10000 });
    assert.match(await fallback.innerText(), /下载|download/i, "unsupported format gives original takeout guidance");
    assert.equal(await fallback.locator(".cairn-content-preview__status--error").count(), 0, "unsupported format is distinguished from a read or integrity error");
    assert.equal(calls.filter((call) => ["content.open", "content.read"].includes(call.operation)).length, beforeCount, "unsupported format must not request preview open or read");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.getByRole("button", { name: /Download original|下载原始文件/, exact: true }).click(),
    ]);
    const downloaded = await download.path();
    assert(downloaded, "unsupported content still has an actual original download");
    const bytes = fs.readFileSync(downloaded);
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, "unsupported original must remain byte-exact");
    unsupportedEvidence.push({ name: file.name, preview_opened: false, download_bytes: bytes.length, download_sha256: file.sha256 });
  }
  if (evidenceDir) {
    fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify({
      schema: "cairn.web-content-preview-e2e.v1",
      status: "PASS",
      large_image: { name: largeImageName, content_id: opened.content_id, logical_size: opened.logical_size, max_read: opened.max_read, ranges: reads.map((call) => ({ offset: call.input.offset, length: call.input.length })), browser_reconstructed_sha256: `sha256:${createHash("sha256").update(reconstructed).digest("hex")}`, rendered: true, desktop_geometry: desktopGeometry, narrow_geometry: narrowGeometry, closed_once: true },
      over_budget: { name: overBudgetName, opened: false, fallback: "download/export" },
      injected_failures: { mismatched_range: "PASS", corrupt_bytes: "PASS", interrupted_read: "PASS", canceled_read: "PASS", all_handles_closed_once: true },
      ...(zeroTextEvidence ? { zero_length_text: zeroTextEvidence } : {}),
      ...(textEvidence ? { text: textEvidence } : {}),
      ...(unsupportedEvidence.length ? { unsupported_original_downloads: unsupportedEvidence } : {}),
      ...(browseEvidence.length ? { library_controls: { sort_and_filter: "PASS", type_and_layout_switch: "PASS", responsive: browseEvidence } } : {}),
    }, null, 2)}\n`);
  }
  console.log(`PASS: bounded real-browser content preview; ${reads.length} reads, each <= max_read; SHA-256-bound ${opened.logical_size} bytes; over-budget fallback; range/corruption/interruption/cancellation rejected; handles closed once${zeroTextEvidence ? "; zero-length text passed" : ""}`);
  }
} finally {
  await browser.close();
  if (seededTextRoot) fs.rmSync(seededTextRoot, { recursive: true, force: true });
}

async function openEntry(name) {
  const entry = page.getByRole("main").getByRole("button", { name: new RegExp(escapeRegExp(name)) }).first();
  await entry.waitFor({ state: "visible", timeout: 15000 });
  await entry.click();
  await page.getByRole("main").getByRole("heading", { name: new RegExp(escapeRegExp(name)) }).waitFor({ state: "visible", timeout: 15000 });
}

async function preparePastedTextThroughAdd() {
  await page.goto(url, { waitUntil: "networkidle" });
  const noLifecycleChangesYet = () => ({
    uploads: uploadRequests.length,
    plans: commandOperations.filter((item) => item.operation === "plan.ingest").length,
    applies: commandOperations.filter((item) => item.operation === "plan.apply").length,
    planGets: commandOperations.filter((item) => item.operation === "plan.get").length,
  });
  const before = noLifecycleChangesYet();
  const addButton = page.getByRole("button", { name: /Add content|添加内容/ }).first();
  await addButton.click();
  const drawer = page.getByRole("dialog", { name: /Upload files|上传文件/ });
  await drawer.waitFor({ state: "visible", timeout: 10000 });
  await drawer.getByRole("button", { name: /Paste text into a \.txt file|粘贴文字并创建 \.txt 文件/ }).click();
  const filename = drawer.getByRole("textbox", { name: /Output filename|文件名/ });
  const textBody = drawer.getByRole("textbox", { name: /Text to save|要保存的文字/ });
  await filename.fill(textName);
  await textBody.fill(seededReferenceText);
  const expectedBytes = Buffer.byteLength(seededReferenceText, "utf8");
  assert(expectedBytes <= 64 * 1024, "pasted literal remains within the 64 KiB UTF-8 budget");
  assert((await drawer.locator(".pasted-text-size").allTextContents()).some((value) => value.includes(String(expectedBytes))), "Add shows the exact UTF-8 byte size");
  if (evidenceDir) {
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, "paste-add-composer-1280.png"), animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    const composerGeometry = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(composerGeometry.scroll <= composerGeometry.viewport + 1, "the expanded paste composer fits the 390px viewport");
    await page.screenshot({ path: path.join(evidenceDir, "paste-add-composer-390.png"), animations: "disabled" });
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  // The draft is transient client state and must survive closing and reopening
  // the same Add surface before it is uploaded.
  await drawer.getByRole("button", { name: /Close add source|关闭添加来源/ }).click();
  await drawer.waitFor({ state: "detached", timeout: 10000 });
  assert.deepEqual(noLifecycleChangesYet(), before, "closing an unprepared draft performs no upload, plan, or apply");
  await page.getByRole("button", { name: /Add content|添加内容/ }).first().click();
  const reopened = page.getByRole("dialog", { name: /Upload files|上传文件/ });
  await reopened.waitFor({ state: "visible", timeout: 10000 });
  await reopened.getByRole("button", { name: /Paste text into a \.txt file|粘贴文字并创建 \.txt 文件/ }).click();
  assert.equal(await reopened.getByRole("textbox", { name: /Output filename|文件名/ }).inputValue(), textName, "the literal filename draft survives close and reopen");
  assert.equal(await reopened.getByRole("textbox", { name: /Text to save|要保存的文字/ }).inputValue(), seededReferenceText, "the exact multiline Unicode text survives close and reopen");

  const prepare = reopened.getByRole("button", { name: /Prepare text file|准备文本文件/ });
  const invalidFilename = "../unsafe.txt";
  await reopened.getByRole("textbox", { name: /Output filename|文件名/ }).fill(invalidFilename);
  await prepare.click();
  await reopened.getByRole("alert").getByText(/safe single filename|安全的单一文件名/).waitFor({ state: "visible", timeout: 5000 });
  assert.deepEqual(noLifecycleChangesYet(), before, "invalid filename is refused before upload, plan, or apply");

  const oversizedText = "界".repeat(22 * 1024);
  assert(Buffer.byteLength(oversizedText, "utf8") > 64 * 1024, "invalid test draft exceeds the cap in UTF-8 bytes");
  await reopened.getByRole("textbox", { name: /Output filename|文件名/ }).fill(textName);
  await reopened.getByRole("textbox", { name: /Text to save|要保存的文字/ }).fill(oversizedText);
  await prepare.click();
  await reopened.getByRole("alert").getByText(/limit is 64 KiB|超过 64 KiB 上限/).waitFor({ state: "visible", timeout: 5000 });
  assert.deepEqual(noLifecycleChangesYet(), before, "over-limit UTF-8 text is refused before upload, plan, or apply");

  const oversizedASCIIText = "a".repeat(64 * 1024 + 1);
  await reopened.getByRole("textbox", { name: /Output filename|文件名/ }).fill(textName);
  const bodyEditor = reopened.getByRole("textbox", { name: /Text to save|要保存的文字/ });
  await bodyEditor.fill(oversizedASCIIText);
  assert.equal(await bodyEditor.inputValue(), oversizedASCIIText, "the full oversized ASCII paste remains visible instead of being silently truncated");
  await prepare.click();
  await reopened.getByRole("alert").getByText(/limit is 64 KiB|超过 64 KiB 上限/).waitFor({ state: "visible", timeout: 5000 });
  assert.deepEqual(noLifecycleChangesYet(), before, "oversized ASCII text is refused before upload, plan, or apply");

  await reopened.getByRole("textbox", { name: /Text to save|要保存的文字/ }).fill(seededReferenceText);
  let releaseUploadResponse;
  let markUploadResponseSeen;
  let markUploadResponseHandled;
  const uploadResponseSeen = new Promise((resolve) => { markUploadResponseSeen = resolve; });
  const uploadResponseHandled = new Promise((resolve) => { markUploadResponseHandled = resolve; });
  const uploadResponseGate = new Promise((resolve) => { releaseUploadResponse = resolve; });
  await page.context().route("**/api/v1/upload", async (route) => {
    const backendResponse = await route.fetch();
    const backendBody = await backendResponse.body();
    markUploadResponseSeen({ backendResponse, backendBody });
    await uploadResponseGate;
    try {
      await route.fulfill({ response: backendResponse, body: backendBody });
      markUploadResponseHandled();
    } catch (error) {
      markUploadResponseHandled();
      throw error;
    }
  });
  await reopened.getByRole("button", { name: /Prepare text file|准备文本文件/ }).click();
  const heldUpload = await uploadResponseSeen;
  assert(heldUpload.backendResponse.ok(), "the real upload completed successfully at the daemon before the test holds its browser response");
  assert.equal(uploadRequests.length, before.uploads + 1, "valid Prepare starts exactly one staging upload");
  assert.equal(commandOperations.filter((item) => item.operation === "plan.ingest").length, before.plans, "no plan starts before the upload response reports accepted staging");
  assert.equal(commandOperations.filter((item) => item.operation === "plan.apply").length, before.applies, "no apply starts before review");
  await page.getByRole("button", { name: /Close add source|关闭添加来源/ }).click();
  await reopened.waitFor({ state: "detached", timeout: 10000 });
  await page.getByRole("button", { name: /Add content|添加内容/ }).first().click();
  const whileUploading = page.getByRole("dialog", { name: /Upload files|上传文件/ });
  await whileUploading.waitFor({ state: "visible", timeout: 10000 });
  await whileUploading.locator('.upload-status[data-phase="receiving"]').waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await whileUploading.getByRole("button", { name: /Clear text draft|清除文本草稿/ }).isDisabled(), true, "the draft cannot be cleared while its upload response is outstanding");
  assert.equal(commandOperations.filter((item) => item.operation === "plan.ingest").length, before.plans, "closing and reopening during upload does not start a stale plan");
  releaseUploadResponse();
  await uploadResponseHandled;
  await page.context().unroute("**/api/v1/upload");
  await whileUploading.getByRole("button", { name: /Review staged text file|审核暂存的文本文件/ }).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await whileUploading.getByRole("button", { name: /Clear text draft|清除文本草稿/ }).isDisabled(), false, "after accepted staging, draft clearing remains an explicit available choice");
  assert.match(await whileUploading.locator(".pasted-text-warning").innerText(), /staged and unprotected|暂存.*未受保护/, "late upload result remains visible as staged and unprotected");
  assert.equal(commandOperations.filter((item) => item.operation === "plan.ingest").length, before.plans, "late accepted upload after the drawer closed does not auto-start review");
  await whileUploading.getByRole("button", { name: /Review staged text file|审核暂存的文本文件/ }).click();
  await page.locator('.drawer-action-bar[data-state="READY"]').waitFor({ state: "visible", timeout: 30000 });
  assert.equal(uploadRequests.length, before.uploads + 1, "explicit review reuses the accepted staging upload");
  assert.equal(commandOperations.filter((item) => item.operation === "plan.ingest").length, before.plans + 1, "explicit Review starts one ordinary plan");
  assert.equal(await page.locator(".plan-compact-file-list li").filter({ hasText: textName }).count(), 1, "the reviewed plan visibly names the staged pasted text");
  assert.match(await page.locator(".plan-compact-note").innerText(), /Nothing is stored until you confirm|确认后才会保存原件/, "the staged plan stays visibly unprotected before confirmation");
  assert.equal(commandOperations.filter((item) => item.operation === "plan.apply").length, before.applies, "preparing and reviewing do not save the text");

  const readyDrawer = page.getByRole("dialog", { name: /Upload files|上传文件/ });
  await readyDrawer.getByRole("button", { name: /Close add source|关闭添加来源/ }).click();
  await readyDrawer.waitFor({ state: "detached", timeout: 10000 });
  await page.getByRole("button", { name: /Add content|添加内容/ }).first().click();
  const reopenedReady = page.getByRole("dialog", { name: /Upload files|上传文件/ });
  await reopenedReady.waitFor({ state: "visible", timeout: 10000 });
  await page.locator('.drawer-action-bar[data-state="READY"]').waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.locator(".plan-compact-file-list li").filter({ hasText: textName }).count(), 1, "closing and reopening a ready draft retains its matching plan");
  assert.equal(commandOperations.filter((item) => item.operation === "plan.ingest").length, before.plans + 1, "reopening the ready draft does not replace its existing plan");

  let capturedAppliedPlan;
  await page.context().route("**/api/v1/command", async (route) => {
    const request = route.request();
    let payload;
    try { payload = request.postDataJSON(); } catch { return route.continue(); }
    if (payload?.operation !== "plan.apply") return route.continue();
    const backendResponse = await route.fetch();
    const backendBody = await backendResponse.body();
    const backendResult = JSON.parse(backendBody.toString("utf8"));
    capturedAppliedPlan = backendResult;
    assert.equal(backendResult.data?.state, "SUCCEEDED", "the real daemon applied the plan before the test hides its response");
    await route.fulfill({ response: backendResponse, status: 502, body: JSON.stringify({ error: "simulated lost apply response after daemon success" }) });
  });
  await reopenedReady.locator('.drawer-action-bar[data-state="READY"] .source-action-primary').click();
  await page.locator('.drawer-action-bar[data-state="AWAITING"]').waitFor({ state: "visible", timeout: 30000 });
  assert.equal(capturedAppliedPlan?.data?.state, "SUCCEEDED", "the hidden backend response confirms actual save success");
  assert.equal(commandOperations.filter((item) => item.operation === "plan.apply").length, before.applies + 1, "one explicit apply reaches the daemon");
  await reopenedReady.getByRole("button", { name: /Close add source|关闭添加来源/ }).click();
  await reopenedReady.waitFor({ state: "detached", timeout: 10000 });
  await page.getByRole("button", { name: /Add content|添加内容/ }).first().click();
  const awaitingDrawer = page.getByRole("dialog", { name: /Upload files|上传文件/ });
  await awaitingDrawer.waitFor({ state: "visible", timeout: 10000 });
  await page.locator('.drawer-action-bar[data-state="AWAITING"]').waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await awaitingDrawer.getByRole("button", { name: /Confirm save|确认保存/ }).count(), 0, "an unknown save outcome never offers a second apply");
  await page.context().unroute("**/api/v1/command");
  await awaitingDrawer.getByRole("button", { name: /Check protection result|检查保护结果/ }).click();
  await page.locator('.drawer-action-bar[data-state="SAVED"]').waitFor({ state: "visible", timeout: 30000 });
  assert.equal(commandOperations.filter((item) => item.operation === "plan.apply").length, before.applies + 1, "status reconciliation does not retry the non-idempotent apply");
  assert.equal(commandOperations.filter((item) => item.operation === "plan.get").length, before.planGets + 1, "reopening checks the existing plan through plan.get");
  assert.equal(await awaitingDrawer.getByRole("textbox", { name: /Output filename|文件名/ }).inputValue(), "reading-notes.txt", "a reconciled success clears the pasted filename draft");
  assert.equal(await awaitingDrawer.getByRole("textbox", { name: /Text to save|要保存的文字/ }).inputValue(), "", "a reconciled success clears the pasted body draft");
  await awaitingDrawer.getByRole("button", { name: /Close add source|关闭添加来源/ }).click();
  await awaitingDrawer.waitFor({ state: "detached", timeout: 10000 });
  assert.equal(Buffer.byteLength(seededReferenceText, "utf8"), expectedBytes, "the confirmed UTF-8 logical bytes match the reviewed byte count");
}

async function runTextReferenceJourney() {
  await page.goto(url, { waitUntil: "networkidle" });
  const searchDisclosure = page.locator(".topbar-search");
  if (await searchDisclosure.count()) await searchDisclosure.locator("summary.topbar-search-summary").click();
  const search = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
  await search.fill(textName);
  await search.press("Enter");
  await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "visible", timeout: 15000 });
  const searchedRecord = page.getByRole("main").getByRole("button", { name: new RegExp(escapeRegExp(textName)) }).first();
  await searchedRecord.waitFor({ state: "visible", timeout: 15000 });
  await searchedRecord.click();
  await page.getByRole("main").getByRole("heading", { name: textName, exact: true }).waitFor({ state: "visible", timeout: 15000 });
  const openedBeforeText = new Set(opens.keys());
  const textPreview = page.getByRole("main").locator(".details .cairn-content-preview");
  const renderedText = textPreview.locator(".cairn-content-preview__text");
  await renderedText.waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await renderedText.textContent(), seededReferenceText, "text, UTF-8 punctuation and line order are preserved exactly");
  await page.waitForTimeout(250);
  assert.deepEqual(externalRequests, [], "rendering references makes no outside request");

  const links = renderedText.locator("a");
  const expectedTargets = [
    seededSafeClickTarget,
    "https://example.test/path",
    "https://example.test/wiki/Test_(case)",
    "https://example.test/path",
    "https://example.test/path",
    "https://example.test/path",
    "https://example.test/",
  ];
  assert.deepEqual(await links.evaluateAll((nodes) => nodes.map((node) => node.href)), expectedTargets, "safe web references parse balanced closers, retain Chinese following text, and trim prose closers");
  assert.deepEqual(await links.evaluateAll((nodes) => nodes.map((node) => ({ target: node.target, rel: node.rel }))), expectedTargets.map(() => ({ target: "_blank", rel: "noopener noreferrer" })), "links open in a protected new tab");
  const domText = await renderedText.textContent();
  for (const unsafe of [
    "javascript:https://example.test/x",
    "data:text/plain,https://example.test/x",
    "//relative.example/path",
    "https://user:pass@example.test/x",
    "https://?bad=x",
    "https:///example.test/x",
    "https://example.test/%GG",
    "https://example.test/c1\u009ftail",
    "https://example.test\\trick",
  ]) {
    assert(domText.includes(unsafe), `unsafe/malformed reference remains readable as text: ${unsafe}`);
    assert.equal(await links.filter({ hasText: unsafe }).count(), 0, `unsafe/malformed reference never becomes an anchor: ${unsafe}`);
  }
  assert(domText.includes("https://example.test，继续"), "CJK punctuation and following prose remain attached to the original text");
  assert.equal(requestedURLs.includes(seededSafeClickTarget), false, "the same-origin target has not been prefetched before explicit activation");
  if (evidenceDir) {
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, "text-reference-preview-1280.png"), animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    const narrowGeometry = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(narrowGeometry.scroll <= narrowGeometry.viewport + 1, "text reference preview fits the 390px viewport");
    await page.screenshot({ path: path.join(evidenceDir, "text-reference-preview-390.png"), animations: "disabled" });
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  let controlledTargetRequested = false;
  await page.context().route(seededSafeClickTarget, async (route) => {
    controlledTargetRequested = true;
    await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Controlled reference target</title><p>Local navigation reached.</p>" });
  });
  assert.equal(controlledTargetRequested, false, "the safe local URL is not fetched during render");
  const [popup] = await Promise.all([page.waitForEvent("popup"), links.first().click()]);
  await popup.waitForLoadState("domcontentloaded");
  assert.equal(popup.url(), seededSafeClickTarget, "explicit activation opens the controlled local target");
  assert.equal(controlledTargetRequested, true, "the controlled route is reached only by the explicit click");
  assert.equal(requestedURLs.filter((requestURL) => requestURL === seededSafeClickTarget).length, 1, "the controlled target receives exactly one request after activation");
  assert.deepEqual(externalRequests, [], "activating the local target still makes no outside request");
  await popup.close();

  const capturedText = Buffer.from(seededReferenceText, "utf8");
  assert.equal(capturedText.toString("utf8"), seededReferenceText, "the self-owned UTF-8 source fixture bytes remain the exact pre-ingest comparison");
  await closePreview(textPreview);
  const [textDownload] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.locator("button.detail-download").first().click()]);
  assert.equal(textDownload.suggestedFilename(), textName, "record download keeps the original text filename");
  const textPath = await textDownload.path();
  assert(textPath, "record download saves browser output");
  const downloadedText = fs.readFileSync(textPath);
  assert.equal(downloadedText.length, capturedText.length, "record download has the exact logical length");
  assert.equal(createHash("sha256").update(downloadedText).digest("hex"), createHash("sha256").update(capturedText).digest("hex"), "record download matches captured fixture bytes");

  await page.locator("button.detail-back").first().click();
  await page.locator(".detail-column").waitFor({ state: "detached", timeout: 10000 });
  const secondName = "Cairn-Notes.txt";
  if (!(await search.isVisible())) await searchDisclosure.locator("summary.topbar-search-summary").click();
  await search.fill(secondName);
  await search.press("Enter");
  await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "visible", timeout: 15000 });
  const secondResult = page.getByRole("main").getByRole("button", { name: new RegExp(escapeRegExp(secondName)) }).first();
  await secondResult.waitFor({ state: "visible", timeout: 15000 });
  await secondResult.click();
  await page.getByRole("main").getByRole("heading", { name: secondName, exact: true }).waitFor({ state: "visible", timeout: 15000 });
  const [secondDownload] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.locator("button.detail-download").first().click()]);
  assert.equal(secondDownload.suggestedFilename(), secondName, "the second fixture original downloads with its source name");
  const secondPath = await secondDownload.path();
  assert(secondPath, "the second original has browser-saved bytes for the ZIP comparison");
  const secondBytes = fs.readFileSync(secondPath);
  await page.locator("button.detail-back").first().click();
  await page.locator(".detail-column").waitFor({ state: "detached", timeout: 10000 });
  await page.getByRole("button", { name: /全部内容|All content/ }).first().click();
  await page.getByRole("main").getByRole("heading", { name: /全部内容|All content/i }).waitFor({ state: "visible", timeout: 15000 });

  for (const selectedName of [textName, secondName]) {
    const row = page.locator(".result-list .result-row").filter({ hasText: selectedName }).first();
    await row.hover();
    await row.getByRole("checkbox", { name: new RegExp(`^(Select|选择) ${escapeRegExp(selectedName)}$`) }).click();
  }
  await page.locator(".selection-actions-focus-target").waitFor({ state: "visible", timeout: 10000 });
  const [zipDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.getByRole("button", { name: /Download originals \(ZIP\)|下载所选原件/ }).click(),
  ]);
  assert.equal(zipDownload.suggestedFilename(), "cairn-takeout.zip", "the selected originals download as the frozen ZIP");
  const zipPath = await zipDownload.path();
  assert(zipPath, "the selected ZIP has browser-saved bytes");
  const completedPlan = [...exportPlans].reverse().find((plan) => plan.result);
  assert(completedPlan, "selected ZIP takeout returns a frozen export plan");
  assert.equal(completedPlan.input?.representation, "exact", "the frozen plan asks for exact originals");
  assert.equal(completedPlan.input?.subjects?.length, 2, "the frozen plan contains both selected subjects");
  assert.match(completedPlan.result.manifest_digest ?? "", /^sha256:[a-f0-9]{64}$/i, "the frozen plan exposes its manifest digest");
  assert.equal(completedPlan.result.items?.length, 2, "the frozen plan resolves both selected records");
  const expected = {
    [textName]: { bytes: capturedText.length, sha256: createHash("sha256").update(capturedText).digest("hex") },
    [secondName]: { bytes: secondBytes.length, sha256: createHash("sha256").update(secondBytes).digest("hex") },
  };
  const verifyZip = spawnSync("python3", ["-c", [
    "import hashlib, json, sys, zipfile",
    "archive, expected_json = sys.argv[1], sys.argv[2]",
    "expected = json.loads(expected_json)",
    "with zipfile.ZipFile(archive) as zipped:",
    "    names = zipped.namelist()",
    "    assert len(names) == len(set(names)) == len(expected), (names, expected)",
    "    assert set(names) == set(expected), (names, expected)",
    "    for name, proof in expected.items():",
    "        payload = zipped.read(name)",
    "        assert len(payload) == proof['bytes'], (name, len(payload), proof['bytes'])",
    "        assert hashlib.sha256(payload).hexdigest() == proof['sha256'], name",
    "print('PASS ZIP names, lengths and SHA-256')",
  ].join("\n"), zipPath, JSON.stringify(expected)], { encoding: "utf8" });
  assert.equal(verifyZip.status, 0, verifyZip.stderr || verifyZip.stdout);
  if (evidenceDir) {
    fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify({
      schema: "cairn.web-content-preview-reference-e2e.v1",
      status: "PASS",
      intake: pasteTextReferences ? {
        path: "Add UI -> paste -> upload staging -> review -> explicit confirm",
        utf8_bytes: Buffer.byteLength(seededReferenceText, "utf8"), filename: textName,
        draft_close_reopen: true, invalid_filename_refused_before_upload: true,
        multibyte_over_limit_refused_before_upload: true, ascii_over_limit_untruncated_and_refused_before_upload: true,
        held_real_upload_response_survived_close_reopen: true, late_staging_visible_without_autoplan: true,
        explicit_review_reused_upload: true, ready_plan_preserved_on_reopen: true,
        unknown_apply_reconciled_by_one_plan_get_without_retry: true, draft_cleared_after_reconciliation: true,
        expanded_composer_screenshots_1280_and_390: Boolean(evidenceDir), apply_calls: 1,
      } : { path: "self-owned fixture seed", not_intake_acceptance: true },
      text_references: { anchor_count: expectedTargets.length, unsafe_plain_tokens: true, preserved_text_order: true, no_fetch_until_click: true, isolated_new_tab: true },
      original_download: { name: textName, bytes: downloadedText.length, sha256: createHash("sha256").update(downloadedText).digest("hex") },
      frozen_zip: { names: Object.keys(expected), manifest_digest: completedPlan.result.manifest_digest, exact_hash_and_length_check: true },
    }, null, 2)}\n`);
  }
  console.log(`PASS: safe text references, inert render, explicit controlled navigation, exact ${textName} download, and two-original frozen ZIP byte verification`);
}

async function captureHandleBytes(handle, metadata) {
  const reads = calls.filter((call) => call.operation === "content.read" && call.input?.handle === handle).sort((left, right) => left.input.offset - right.input.offset);
  assert(reads.length > 0, `content.read captured at least one range for ${handle}`);
  assert.deepEqual(reads.map((call) => call.input.offset), reads.map((call, index) => index === 0 ? 0 : reads[index - 1].input.offset + reads[index - 1].input.length), "captured original ranges are contiguous");
  assert.equal(reads.reduce((sum, call) => sum + call.input.length, 0), metadata.logical_size, "captured original ranges cover the exact logical length");
  const bytes = Buffer.concat(reads.map((call) => Buffer.from(readResults.get(call.request)?.bytes ?? "", "base64")));
  assert.equal(bytes.length, metadata.logical_size, "captured original has its declared length");
  assert.equal(`sha256:${createHash("sha256").update(bytes).digest("hex")}`, metadata.content_id, "captured original matches its exact content id");
  return bytes;
}

async function closePreview(preview) {
  await preview.locator(".cairn-content-preview__header .cairn-content-preview__close").click();
  await preview.locator(".cairn-content-preview__panel").waitFor({ state: "detached", timeout: 10000 });
}

async function waitClosed(handle) {
  await poll(() => closes.get(handle) === 1, 10000);
  assert.equal(closes.get(handle), 1, `content handle ${handle} should have exactly one successful close`);
}

async function assertInspectorImageBounds(image, viewportWidth, label) {
  const geometry = await image.evaluate((node) => {
    const imageRect = node.getBoundingClientRect();
    const button = node.closest(".cairn-content-preview__image-button");
    const buttonRect = button.getBoundingClientRect();
    return { width: imageRect.width, height: imageRect.height, buttonWidth: buttonRect.width, naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight, scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
  });
  assert.equal(geometry.naturalWidth, geometry.naturalHeight, `${label} fixture remains square`);
  assert(geometry.width > 0 && geometry.height > 0, `${label} inspector image must be visible`);
  assert(Math.abs(geometry.width - geometry.height) <= 1, `${label} inspector image must preserve square aspect ratio`);
  assert(geometry.height <= 320, `${label} inspector image must stay within the 320px height bound`);
  assert(geometry.width <= geometry.buttonWidth + 1, `${label} image must fit within its inspector control`);
  assert(geometry.scrollWidth <= viewportWidth + 1, `${label} layout must not overflow horizontally`);
  return geometry;
}

async function poll(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await page.waitForTimeout(50);
  }
  return await check();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
