import assert from "node:assert/strict";
import fs from "node:fs";
import process from "node:process";

const { chromium } = await import(process.env.RESTOREWEAVE_PLAYWRIGHT_MODULE || "playwright");
const url = process.env.RESTOREWEAVE_WEB_PRODUCT_E2E_URL;
const textName = process.env.RESTOREWEAVE_WEB_PRODUCT_E2E_TEXT_NAME;
const textBodyFile = process.env.RESTOREWEAVE_WEB_PRODUCT_E2E_TEXT_BODY_FILE;
const textBody = process.env.RESTOREWEAVE_WEB_PRODUCT_E2E_TEXT_BODY ?? (textBodyFile ? fs.readFileSync(textBodyFile, "utf8") : undefined);
const imageName = process.env.RESTOREWEAVE_WEB_PRODUCT_E2E_IMAGE_NAME;
const largeName = process.env.RESTOREWEAVE_WEB_PRODUCT_E2E_LARGE_NAME;
assert(url, "RESTOREWEAVE_WEB_PRODUCT_E2E_URL is required");
assert(textName && textBody && imageName && largeName, "text/image/large sample names and expected text are required");

const executablePath = process.env.RESTOREWEAVE_PLAYWRIGHT_EXECUTABLE_PATH?.trim();
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const commandRequests = [];
const openedHandles = new Set();
const closedHandles = new Set();
page.on("request", (request) => {
  if (request.method() !== "POST" || !request.url().includes("/api/v1/command")) return;
  try {
    const payload = request.postDataJSON();
    if (payload?.operation?.startsWith("content.")) commandRequests.push({ ...payload, request });
  } catch {
    // Ignore non-JSON transport requests; the UI assertion remains authoritative.
  }
});
page.on("response", async (response) => {
  if (!response.url().includes("/api/v1/command") || response.request().method() !== "POST") return;
  let payload;
  try { payload = await response.json(); } catch { return; }
  const request = commandRequests.find((item) => item.request === response.request());
  const data = payload?.data;
  if (payload?.operation === "content.open" && ["SUCCEEDED", "DEGRADED"].includes(payload?.status) && typeof data?.handle === "string") openedHandles.add(data.handle);
  if (payload?.operation === "content.close" && ["SUCCEEDED", "DEGRADED"].includes(payload?.status) && typeof request?.input?.handle === "string") closedHandles.add(request.input.handle);
});

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByText(/已连接|Connected/).waitFor({ state: "visible", timeout: 10000 });
  const main = page.getByRole("main");

  await openEntry(textName);
  const textPreview = main.locator(".details .rw-content-preview");
  await textPreview.locator(".rw-content-preview__text").waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await textPreview.locator(".rw-content-preview__text").innerText(), textBody, "text preview must show exact UTF-8 content");
  await closePreview(textPreview);

  await openEntry(imageName);
  const imagePreview = main.locator(".details .rw-content-preview");
  const image = imagePreview.locator("img.rw-content-preview__image");
  await image.waitFor({ state: "visible", timeout: 10000 });
  assert.match(await image.getAttribute("src"), /^blob:/, "image preview must use a scoped in-memory object URL");
  assert.equal(await poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)), true, "PNG preview must decode to a non-empty image");
  await closePreview(imagePreview);

  await openEntry(largeName);
  const largePreview = main.locator(".details .rw-content-preview");
  const beforeLargeOpen = commandRequests.filter((request) => request.operation === "content.open").length;
  await largePreview.locator(".rw-content-preview__status--error").waitFor({ state: "visible", timeout: 10000 });
  await largePreview.getByText(/64 KiB|1 MiB|更大文件|Larger files/, { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(commandRequests.filter((request) => request.operation === "content.open").length, beforeLargeOpen, "oversized content must fail closed before opening a content handle");

  await openEntry(textName);
  const switchedPreview = main.locator(".details .rw-content-preview");
  await switchedPreview.locator(".rw-content-preview__text").waitFor({ state: "visible", timeout: 10000 });
  await openEntry(imageName);
  assert.equal(await main.locator(".details .rw-content-preview__text").count(), 0, "switching subjects must remove the previous text preview");
  const switchedImage = main.locator(".details .rw-content-preview__image");
  await switchedImage.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await poll(() => switchedImage.evaluate((element) => element.complete && element.naturalWidth > 0)), true, "switched PNG preview must decode to a non-empty image");

  await poll(() => closedHandles.size === openedHandles.size);
  assert.ok(openedHandles.size >= 3, `expected text, image, and switched content opens; got ${openedHandles.size}`);
  for (const handle of openedHandles) assert.ok(closedHandles.has(handle), `content handle ${handle} was not closed successfully`);
  console.log(`PASS: real content preview E2E (opens=${openedHandles.size}, closes=${closedHandles.size})`);
} finally {
  await browser.close();
}

async function openEntry(name) {
  const entry = page.getByRole("main").getByRole("button", { name: new RegExp(escapeRegExp(name)) }).first();
  await entry.waitFor({ state: "visible", timeout: 10000 });
  await entry.click();
  await page.getByRole("main").getByRole("heading", { name: new RegExp(escapeRegExp(name)) }).waitFor({ state: "visible", timeout: 10000 });
}

async function closePreview(preview) {
  await preview.locator(".rw-content-preview__header .rw-content-preview__close").click();
  await preview.locator(".rw-content-preview__panel").waitFor({ state: "detached", timeout: 10000 });
}

async function poll(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let value = await check();
  while (!value && Date.now() < deadline) {
    await page.waitForTimeout(50);
    value = await check();
  }
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
