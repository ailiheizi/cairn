import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const { chromium } = await import(process.env.RESTOREWEAVE_PLAYWRIGHT_MODULE || "../web/node_modules/playwright/index.mjs");
const url = process.env.RESTOREWEAVE_PREVIEW_E2E_URL;
const largeImageName = process.env.RESTOREWEAVE_PREVIEW_E2E_IMAGE_NAME;
const overBudgetName = process.env.RESTOREWEAVE_PREVIEW_E2E_OVER_BUDGET_NAME;
const zeroTextName = process.env.RESTOREWEAVE_PREVIEW_E2E_ZERO_TEXT_NAME;
const textName = process.env.RESTOREWEAVE_PREVIEW_E2E_TEXT_NAME;
const unsupportedFiles = JSON.parse(process.env.RESTOREWEAVE_PREVIEW_E2E_UNSUPPORTED_FILES || "[]");
const evidenceDir = process.env.RESTOREWEAVE_PREVIEW_E2E_EVIDENCE_DIR;
assert(url && largeImageName && overBudgetName, "RESTOREWEAVE_PREVIEW_E2E_URL, _IMAGE_NAME and _OVER_BUDGET_NAME are required");

const executablePath = process.env.RESTOREWEAVE_PLAYWRIGHT_EXECUTABLE_PATH?.trim();
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const calls = [];
const opens = new Map();
const closes = new Map();
const readResults = new Map();
let fault = "";
let releaseHeldRead;
let markHeldRead;
const heldReadSeen = new Promise((resolve) => { markHeldRead = resolve; });
const heldReadGate = new Promise((resolve) => { releaseHeldRead = resolve; });
page.on("request", (request) => {
  if (request.method() !== "POST" || !request.url().includes("/api/v1/command")) return;
  try {
    const payload = request.postDataJSON();
    if (payload?.operation?.startsWith("content.")) calls.push({ ...payload, request });
  } catch { /* Other command traffic is not part of this evidence. */ }
});
page.on("response", async (response) => {
  if (!response.url().includes("/api/v1/command") || response.request().method() !== "POST") return;
  let result;
  try { result = await response.json(); } catch { return; }
  const call = calls.find((item) => item.request === response.request());
  if (call?.operation === "content.read" && result?.data) readResults.set(response.request(), result.data);
  if (result?.operation === "content.open" && ["SUCCEEDED", "DEGRADED"].includes(result.status) && result.data?.handle) opens.set(result.data.handle, result.data);
  if (result?.operation === "content.close" && ["SUCCEEDED", "DEGRADED"].includes(result.status)) {
    const handle = call?.input?.handle;
    if (handle) closes.set(handle, (closes.get(handle) || 0) + 1);
  }
});

try {
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
      await settings.locator(`input[name="restoreweave-interface"][value="${interfaceId}"]`).check();
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
  const preview = page.getByRole("main").locator(".details .rw-content-preview");
  const image = preview.locator("img.rw-content-preview__image");
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
  const over = page.getByRole("main").locator(".details .rw-content-preview");
  await over.locator('[data-state="unavailable"][data-reason="size-limit"]').waitFor({ state: "visible", timeout: 10000 });
  await over.getByText(/8 MiB|8 MiB|下载或导出|downloaded or exported/, { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(opens.size, opensBefore, "over-budget image must show takeout fallback without opening a content handle");

  for (const [index, mode] of ["range", "corrupt", "interrupted"].entries()) {
    if (index > 0) await openEntry(overBudgetName);
    const priorHandles = new Set(opens.keys());
    fault = mode;
    await openEntry(largeImageName);
    const failed = page.getByRole("main").locator(".details .rw-content-preview");
    await page.waitForTimeout(1000);
    const errorCount = await failed.locator(".rw-content-preview__status--error").count();
    const imageCount = await failed.locator("img.rw-content-preview__image").count();
    assert.equal(errorCount, 1, `${mode} injected read should fail closed (preview text=${await failed.innerText()}, image count=${imageCount})`);
    assert.equal(await failed.locator("img.rw-content-preview__image").count(), 0, `${mode} content must never render`);
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
  await page.getByRole("main").locator('.details .rw-content-preview [data-state="unavailable"][data-reason="size-limit"]').waitFor({ state: "visible", timeout: 10000 });
  assert.equal(closes.get(heldHandle), 1, "canceled in-flight read must close exactly once after becoming stale");

  let zeroTextEvidence = null;
  if (zeroTextName) {
    const priorZeroHandles = new Set(opens.keys());
    await openEntry(zeroTextName);
    const zeroPreview = page.getByRole("main").locator(".details .rw-content-preview");
    const text = zeroPreview.locator(".rw-content-preview__text");
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
    const textPreview = page.getByRole("main").locator(".details .rw-content-preview");
    await textPreview.locator(".rw-content-preview__text").waitFor({ state: "visible", timeout: 15000 });
    assert.match(await textPreview.innerText(), /UTF-8.*中文/s, "real UTF-8 text remains readable");
    textEvidence = { name: textName, utf8_rendered: true };
  }
  const unsupportedEvidence = [];
  for (const file of unsupportedFiles) {
    assert.equal(typeof file.name, "string");
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    const beforeCount = calls.filter((call) => ["content.open", "content.read"].includes(call.operation)).length;
    await openEntry(file.name);
    const fallback = page.getByRole("main").locator(".details .rw-content-preview");
    await fallback.locator('[data-state="unavailable"][data-reason="unsupported-format"]').waitFor({ state: "visible", timeout: 10000 });
    assert.match(await fallback.innerText(), /下载|download/i, "unsupported format gives original takeout guidance");
    assert.equal(await fallback.locator(".rw-content-preview__status--error").count(), 0, "unsupported format is distinguished from a read or integrity error");
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
      schema: "restoreweave.web-content-preview-e2e.v1",
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
} finally {
  await browser.close();
}

async function openEntry(name) {
  const entry = page.getByRole("main").getByRole("button", { name: new RegExp(escapeRegExp(name)) }).first();
  await entry.waitFor({ state: "visible", timeout: 15000 });
  await entry.click();
  await page.getByRole("main").getByRole("heading", { name: new RegExp(escapeRegExp(name)) }).waitFor({ state: "visible", timeout: 15000 });
}

async function closePreview(preview) {
  await preview.locator(".rw-content-preview__header .rw-content-preview__close").click();
  await preview.locator(".rw-content-preview__panel").waitFor({ state: "detached", timeout: 10000 });
}

async function waitClosed(handle) {
  await poll(() => closes.get(handle) === 1, 10000);
  assert.equal(closes.get(handle), 1, `content handle ${handle} should have exactly one successful close`);
}

async function assertInspectorImageBounds(image, viewportWidth, label) {
  const geometry = await image.evaluate((node) => {
    const imageRect = node.getBoundingClientRect();
    const button = node.closest(".rw-content-preview__image-button");
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
