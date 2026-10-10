// Real-browser check for the candidate semantic package. The Go integration
// test supplies a clean packaged daemon/WebUI containing a real admitted BGE
// and zvec bundle; this script exercises the visible settings and search path
// and validates the daemon's captured responses.
import assert from "node:assert/strict";

const url = process.env.RESTOREWEAVE_WEB_E2E_URL;
const playwrightModule = process.env.RESTOREWEAVE_PLAYWRIGHT_MODULE || "playwright";
const executablePath = process.env.RESTOREWEAVE_PLAYWRIGHT_EXECUTABLE_PATH;
assert.ok(url, "RESTOREWEAVE_WEB_E2E_URL is required");
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("main").waitFor({ state: "visible", timeout: 15000 });

  const operationResponse = (operation) => page.waitForResponse((response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/v1/command")) return false;
    try { return response.request().postDataJSON()?.operation === operation; } catch { return false; }
  }, { timeout: 90000 });
  const readOperation = async (pending) => {
    const response = await pending;
    assert.equal(response.status(), 200, `HTTP status for ${response.request().postDataJSON()?.operation}`);
    return response.json();
  };

  await page.getByRole("button", { name: /Open settings|打开设置/ }).click();
  const settings = page.getByRole("dialog", { name: /Settings|设置/ });
  await settings.waitFor({ state: "visible", timeout: 10000 });
  await settings.locator(".settings-category").filter({ hasText: /Search|搜索/ }).click();
  await settings.locator(".config-heading h3").filter({ hasText: /Search|搜索/ }).waitFor({ state: "visible", timeout: 10000 });

  const pendingRebuild = operationResponse("search.rebuild");
  await settings.getByRole("button", { name: /Rebuild search indexes|重建搜索索引/ }).click();
  const rebuiltEnvelope = await readOperation(pendingRebuild);
  assert.ok(["SUCCEEDED", "DEGRADED"].includes(rebuiltEnvelope.status), `search.rebuild status: ${rebuiltEnvelope.status}`);
  const rebuild = rebuiltEnvelope.data ?? {};
  assert.equal(rebuild.semantic_state, "AVAILABLE", `semantic rebuild state: ${JSON.stringify(rebuild)}`);
  assert.ok(rebuild.semantic_generation_ref || rebuild.semantic_generation_id, `semantic generation missing from rebuild response: ${JSON.stringify(rebuild)}`);
  await settings.getByText(/Installed and running|已安装并运行/).waitFor({ state: "visible", timeout: 30000 });
  await settings.getByRole("button", { name: /Close settings|关闭设置/ }).click();

  const search = page.getByRole("textbox", { name: /Search content library|搜索内容库/ });
  await search.fill("洪水城市");
  const pendingQuery = operationResponse("search.query");
  await page.getByRole("button", { name: /^Search$|^搜索$/ }).click();
  const queryEnvelope = await readOperation(pendingQuery);
  assert.equal(queryEnvelope.status, "SUCCEEDED", `search.query status: ${queryEnvelope.status}`);
  const query = queryEnvelope.data ?? {};
  const semantic = (query.components ?? []).find((component) => component.dimension === "semantic-embedding");
  assert.ok(semantic, `default fused query omitted semantic component: ${JSON.stringify(query)}`);
  assert.equal(semantic.query_provider_ref, "query.semantic.onnx-bge-zvec.v1", `semantic provider: ${JSON.stringify(semantic)}`);
  assert.equal(semantic.status, "SUCCEEDED", `semantic component state: ${JSON.stringify(semantic)}`);
  assert.ok(semantic.index_generation_ref, `semantic generation is absent from query component: ${JSON.stringify(semantic)}`);
  const semanticHits = (query.hits ?? []).filter((hit) => (hit.dimensions ?? []).includes("semantic-embedding"));
  assert.ok(semanticHits.length > 0, `default fused query has no real semantic result: ${JSON.stringify(query)}`);
  const sourceSegment = semanticHits.flatMap((hit) => hit.segments ?? []).find((segment) => segment.source_type === "DESCRIPTION");
  assert.ok(sourceSegment, `semantic result has no matched description provenance: ${JSON.stringify(semanticHits)}`);

  await page.getByRole("main").getByRole("heading", { name: /Results for|搜索结果/ }).waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".result-match").filter({ hasText: /洪水城市/ }).first().waitFor({ state: "visible", timeout: 15000 });
  console.log(JSON.stringify({
    provider: semantic.query_provider_ref,
    dimension: semantic.dimension,
    generation_id: semantic.index_generation_ref,
    hit_count: semanticHits.length,
    segment_source: sourceSegment.source_type,
  }));
} finally {
  await browser.close();
}
