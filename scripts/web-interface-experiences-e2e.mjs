// Browser acceptance for the two bundled interface layouts and their shared
// app state. The live-daemon pass is read-only: it uses the isolated QA
// deployment's existing content and never saves its transient Notes draft.
// A later disposable Vite build injects render faults only into that test
// bundle, leaving web/dist and the live daemon untouched.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { chromium } from "../web/node_modules/playwright/index.mjs";

const repo = resolve(new URL("..", import.meta.url).pathname);
const baseURL = (process.env.CAIRN_BASE_URL || "http://127.0.0.1:4648/").replace(/\/$/, "");
const qaDeployment = join(repo, "dist/client-appearance-20261006");
const qaContext = JSON.parse(await readFile(join(qaDeployment, "qa-context.json"), "utf8"));
const checkoutHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
const checkoutStatus = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).stdout.trimEnd();
const evidenceDir = process.env.CAIRN_INTERFACE_EVIDENCE_DIR
  ? resolve(process.env.CAIRN_INTERFACE_EVIDENCE_DIR)
  : await mkdtemp(join(tmpdir(), "cairn-interface-e2e-"));
const chrome = process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const storageKey = "cairn.appearance";
const apiPath = "/api/v1/command";
const readOnlyOperations = new Set(["status.get", "search.query"]);
const mutationOperations = new Set([
  "plan.apply", "annotation.upsert", "annotation.delete", "export.apply",
  "restore.apply", "description.generate", "search.rebuild",
]);

await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chrome });
const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, locale: "en-US" });
const page = await context.newPage();
const requests = [];
const responses = [];
page.on("request", (request) => {
  if (request.method() !== "POST" || !request.url().endsWith(apiPath)) return;
  let body;
  try { body = request.postDataJSON(); } catch { return; }
  requests.push({ operation: String(body?.operation ?? ""), input: body?.input ?? {} });
});
page.on("response", async (response) => {
  if (response.request().method() !== "POST" || !response.url().endsWith(apiPath)) return;
  let body;
  try { body = response.request().postDataJSON(); } catch { return; }
  if (!readOnlyOperations.has(body?.operation)) return;
  try { responses.push({ operation: body.operation, status: response.status(), envelope: await response.json() }); } catch {}
});

let releaseStatus;
let originalPreference;
let statusRequested;
const statusStarted = new Promise((resolveStatus) => { statusRequested = resolveStatus; });
let statusReleased = Promise.resolve();
let holdingStatus = false;
const holdStatus = async (route) => {
  let body;
  try { body = route.request().postDataJSON(); } catch {}
  if (holdingStatus && body?.operation === "status.get") {
    statusRequested();
    await statusReleased;
  }
  await route.continue();
};

try {
  const daemonHealth = await fetch(`${baseURL}/api/v1/healthz`);
  assert.equal(daemonHealth.status, 200, "the configured real daemon must be reachable");
  const htmlResponse = await fetch(`${baseURL}/`);
  assert.equal(htmlResponse.status, 200, "the real daemon must serve the built WebUI");
  const html = await htmlResponse.text();
  const assetNames = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
  assert.ok(assetNames.some((name) => name.endsWith(".js")), "served page identifies a JavaScript build asset");
  const assetDigests = {};
  for (const name of assetNames) {
    const response = await fetch(new URL(name, `${baseURL}/`));
    assert.equal(response.status, 200, `served build asset ${name}`);
    assetDigests[name] = createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
  }

  await page.route(`**${apiPath}`, holdStatus);
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  await page.getByRole("main").waitFor({ state: "visible", timeout: 15000 });

  originalPreference = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  // Prove an unknown stored layout safely resolves to the built-in workspace.
  await page.evaluate(({ key }) => localStorage.setItem(key, JSON.stringify({ appearance: "dark", themeId: "paper", interfaceId: "third-party" })), { key: storageKey });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('.interface-frame[data-interface="workspace"]').waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.locator("html").getAttribute("data-interface"), "workspace", "unknown saved interface falls back to workspace");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "paper", "unknown interface fallback preserves valid palette preference");

  // Search is real and read-only against the existing QA deployment.
  const search = page.getByRole("textbox", { name: /Search content library/ });
  await search.fill("Photo");
  const searchButton = page.getByRole("button", { name: /^Search$/ });
  await assertEventually(() => searchButton.isEnabled(), "live Photo search becomes enabled");
  await submitPhotoSearch(page, searchButton);
  const photo = page.getByRole("main").getByRole("button", { name: /Photo\.png/ }).first();
  await photo.waitFor({ state: "visible", timeout: 15000 });
  const resultRows = page.locator(".result-list .result-row");
  assert.ok(await resultRows.count() > 0, "actual Photo query returns a nonempty result set");
  assert.ok(await resultRows.filter({ hasText: "Photo.png" }).count() > 0, "actual Photo query includes the intended Photo QA subject");
  await photo.click();
  await page.locator(".details").getByRole("heading", { name: "Photo.png" }).waitFor({ state: "visible", timeout: 10000 });
  const noteDraft = "QA interface draft: keep across both layouts.";
  const noteComposer = page.getByRole("textbox", { name: "New note" });
  await noteComposer.fill(noteDraft);
  await assertEventually(async () => (await noteComposer.inputValue()) === noteDraft, "React keeps the unsaved Notes draft");

  // Hold one extra App-owned status refresh while changing the frame. Its
  // continuation reloads the library, so retention is asserted before release.
  const statusCountBeforeRefresh = countOperation(requests, "status.get");
  holdingStatus = true;
  statusReleased = new Promise((resolveStatus) => { releaseStatus = resolveStatus; });
  await page.getByRole("button", { name: "Refresh service status" }).click();
  await Promise.race([
    statusStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error("status.get did not enter the held browser route")), 10000)),
  ]);
  assert.equal(countOperation(requests, "status.get"), statusCountBeforeRefresh + 1, "exactly one extra shared status request is held in flight");
  assert.equal(countOperation(requests, "search.query"), 1, "interface work has not repeated the submitted query");
  const flowCountsBeforeSwitch = stableFlowCounts(requests);
  await openAppearance(page);
  await page.locator('.interface-option input[value="showcase"]').check();
  await page.locator('.interface-frame[data-interface="showcase"]').waitFor({ state: "visible", timeout: 10000 });
  assert.equal(countOperation(requests, "status.get"), statusCountBeforeRefresh + 1, "switching layouts does not duplicate the held status request");
  assert.equal(countOperation(requests, "search.query"), 1, "switching layouts does not refetch the shared query");
  await page.screenshot({ path: join(evidenceDir, "live-showcase.png"), animations: "disabled" });
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close settings" }).click();
  assert.deepEqual(stableFlowCounts(requests), flowCountsBeforeSwitch, "layout switching does not repeat the submitted query or held read");
  assert.equal(mutationCount(requests), 0, "read-only layout switching dispatches no mutation");
  await assertSharedState(page, { query: "Photo", noteDraft, subjectName: "Photo.png" });

  await openAppearance(page);
  await page.locator('.interface-option input[value="workspace"]').check();
  await page.locator('.interface-frame[data-interface="workspace"]').waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close settings" }).click();
  await assertSharedState(page, { query: "Photo", noteDraft, subjectName: "Photo.png" });
  await page.screenshot({ path: join(evidenceDir, "live-workspace.png"), animations: "disabled" });
  assert.deepEqual(stableFlowCounts(requests), flowCountsBeforeSwitch, "switching back while status refresh is pending does not repeat shared operations");

  releaseStatus();
  holdingStatus = false;
  await assertEventually(() => responses.some((item) => item.operation === "status.get" && item.envelope.status === "SUCCEEDED"), "held status refresh receives a successful real-daemon response");
  await page.locator(".connection").getByText("Connected", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
  const statusResponses = responses.filter((item) => item.operation === "status.get");
  assert.equal(statusResponses.length, statusCountBeforeRefresh + 1, "the held refresh receives one actual daemon response");

  const observedMutations = requests.filter((item) => mutationOperations.has(item.operation));
  assert.equal(observedMutations.length, 0, `this acceptance must dispatch no content mutation: ${JSON.stringify(observedMutations)}`);
  await writeFile(join(evidenceDir, "live-browser-evidence.json"), JSON.stringify({
    result: "PASS",
    scope: "existing live loopback daemon and its isolated client-appearance-20261006 QA deployment; read-only UI operations only",
    baseURL,
    checkout: { head: checkoutHead, dirtyPathCount: checkoutStatus ? checkoutStatus.split("\n").length : 0 },
    daemonHealthStatus: daemonHealth.status,
    servedBuild: { assetNames, assetSha256: assetDigests },
    qaDeployment: relative(repo, qaDeployment),
    workspaceId: qaContext.workspace_id,
    query: "Photo",
    selectedSubjectName: "Photo.png",
    unsavedNoteDraft: noteDraft,
    heldRequest: "App-owned status.get refresh",
    heldRequestReleasedAfterBothInterfaceSwitches: true,
    operationCounts: Object.fromEntries([...new Set(requests.map((item) => item.operation))].map((op) => [op, countOperation(requests, op)])),
    mutationDispatches: observedMutations.length,
    heldStatusResponse: statusResponses.at(-1).envelope.status,
  }, null, 2));
  console.log(`PASS: live interface state retention and held request; evidence=${evidenceDir}`);
} finally {
  if (releaseStatus) releaseStatus();
  if (originalPreference !== undefined) {
    try {
      await page.evaluate(({ key, value }) => {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }, { key: storageKey, value: originalPreference });
    } catch {}
  }
  await context.close();
  await browser.close();
}

async function openAppearance(page) {
  await page.getByRole("button", { name: "Open settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.waitFor({ state: "visible", timeout: 10000 });
  await settings.getByRole("button", { name: "Appearance" }).click();
  await settings.locator(".appearance-preferences").waitFor({ state: "visible", timeout: 10000 });
}

async function assertSharedState(page, { query, noteDraft, subjectName }) {
  const queryInput = page.getByRole("textbox", { name: "Search content library" });
  assert.equal(await queryInput.inputValue(), query, "query remains in shared app state after interface remount");
  assert.equal(await page.getByRole("heading", { name: subjectName }).count(), 1, "selected subject remains in the inspector");
  const composer = page.getByRole("textbox", { name: "New note" });
  assert.equal(await composer.inputValue(), noteDraft, "unsaved Notes draft remains in shared app state");
}

async function assertEventually(check, message) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await check()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  assert.fail(message);
}

function countOperation(items, operation) {
  return items.filter((item) => item.operation === operation).length;
}

await runRenderFaultChecks();

async function runRenderFaultChecks() {
  const testBuild = join(evidenceDir, "disposable-render-fault-build");
  await mkdir(testBuild, { recursive: true });
  const framePath = join(repo, "web/src/components/InterfaceFrame.tsx");
  // The fault injector stays deliberately narrow: it patches only the compiled
  // interface-frame renderers, with one explicit anchor per renderer, and it
  // refuses to run unless the renderer set is exactly the one it knows.
  //
  // The original injector anchored on `const stateClasses =`, the sole body
  // statement of the single exported `InterfaceFrame` component, so it matched
  // once. The current `InterfaceFrame` is a dispatcher that delegates to one
  // renderer per compiled shell slot, so that same local now appears exactly
  // once in `WorkspaceFrame` and once in `ShowcaseFrame`. Those two functions
  // are the correct narrow targets: each is the entire render path for exactly
  // one interface, so an injected fault is attributed to the interface that is
  // actually rendering (showcase-only vs. persistent across every shell).
  // Anchoring on the full function signatures keeps the rewrite bounded and
  // unambiguous instead of "inject wherever a pattern matches". `ImmersiveFrame`
  // never carried the legacy local and is intentionally not targeted, which
  // matches the original behaviour; the renderer-set assertion below fails
  // loudly if a renderer is renamed, removed, duplicated, or added without
  // updating this list, rather than silently injecting nothing or too broadly.
  const legacyMarker = "  const stateClasses =";
  const rendererSignature = "}: InterfaceFrameProps) {";
  const frameTargets = [
    { slot: "workspace", anchor: "function WorkspaceFrame({ header, navigation, content, details, compact, detailActive, empty, onDragOver, onDrop }: InterfaceFrameProps) {" },
    { slot: "showcase", anchor: "function ShowcaseFrame({ header, navigation, content, details, compact, detailActive, empty, onDragOver, onDrop }: InterfaceFrameProps) {" },
  ];
  let transformed = false;
  const faultPlugin = {
    name: "cairn-disposable-interface-render-fault",
    enforce: "pre",
    transform(source, id) {
      if (resolve(id.split("?")[0]) !== framePath) return null;
      const legacyMatches = source.split(legacyMarker).length - 1;
      assert.equal(legacyMatches, frameTargets.length, `fault injector expects the ${frameTargets.length} targeted frame renderers to hold the legacy marker exactly once each, found ${legacyMatches}`);
      const rendererMatches = source.split(rendererSignature).length - 1;
      assert.equal(rendererMatches, frameTargets.length + 1, `fault injector expects the known frame renderer set (${frameTargets.length} targeted + ImmersiveFrame), found ${rendererMatches}`);
      let code = source;
      for (const target of frameTargets) {
        const anchorMatches = code.split(target.anchor).length - 1;
        assert.equal(anchorMatches, 1, `fault injector requires exactly one ${target.slot} frame entry point, found ${anchorMatches}`);
        const faultCondition = target.slot === "showcase"
          ? '(mode === "showcase-once" || mode === "persistent-shared")'
          : 'mode === "persistent-shared"';
        code = code.replace(target.anchor, `${target.anchor}
  {
    let mode = "";
    try { mode = sessionStorage.getItem("cairn-e2e-render-fault") || ""; } catch {}
    if (${faultCondition}) {
      try {
        const count = Number(sessionStorage.getItem("cairn-e2e-render-fault-count") || "0");
        sessionStorage.setItem("cairn-e2e-render-fault-count", String(count + 1));
        // Keep the one-shot fault armed through React's immediate retry so
        // the error reaches the actual boundary; then let workspace recover.
        if (mode === "showcase-once" && count >= 1) sessionStorage.removeItem("cairn-e2e-render-fault");
      } catch {}
      throw new Error("Disposable interface E2E render fault: " + mode);
    }
  }`);
      }
      transformed = true;
      return { code, map: null };
    },
  };
  const { build } = await import("../web/node_modules/vite/dist/node/index.js");
  await build({
    configFile: join(repo, "web/vite.config.ts"),
    root: join(repo, "web"),
    mode: "production",
    logLevel: "error",
    plugins: [faultPlugin],
    build: { outDir: testBuild, emptyOutDir: true },
  });
  assert.equal(transformed, true, "disposable test build injected its fault only into InterfaceFrame");
  const testHTML = await readFile(join(testBuild, "index.html"), "utf8");
  const testAssetNames = [...testHTML.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g)].map((match) => match[1]);
  const testAssetDigests = {};
  for (const name of testAssetNames) testAssetDigests[name] = createHash("sha256").update(await readFile(join(testBuild, name.replace(/^\//, ""))).then((value) => value)).digest("hex");

  const server = createStaticHost(testBuild);
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object", "disposable static host has a loopback address");
  const url = `http://127.0.0.1:${address.port}/`;
  const scenarios = [];
  const faultBrowser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    scenarios.push(await runShowcaseFault(faultBrowser, url));
    scenarios.push(await runSharedFault(faultBrowser, url));
    scenarios.push(await runHeldWrite(faultBrowser, url, testBuild));
  } finally {
    await faultBrowser.close();
    await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  }
  await writeFile(join(evidenceDir, "render-fault-evidence.json"), JSON.stringify({
    result: "PASS",
    testBundle: "temporary Vite production output with an injected sessionStorage/counter fault at the compiled workspace and showcase frame entry points",
    productionHookAdded: false,
    productionWebDistOverwritten: false,
    staticHost: url,
    bundleAssets: { names: testAssetNames, sha256: testAssetDigests },
    apiContinuation: `Playwright routes /api/v1/* to the real daemon at ${baseURL}`,
    scenarios,
  }, null, 2));
  console.log(`PASS: disposable render-fault recovery; evidence=${evidenceDir}`);
}

async function runShowcaseFault(browser, url) {
  const ctx = await createFaultContext(browser, url, "showcase-once");
  const { page, requests } = ctx;
  try {
    const noteDraft = await prepareSharedState(page);
    await openAppearance(page);
    const flowCountsBeforeSwitch = stableFlowCounts(requests);
    // The boundary catches this selection synchronously and resets the saved
    // preference, so Playwright's check() would wait for a state that should
    // immediately revert.
    await page.locator('.interface-option input[value="showcase"]').click();
    await page.waitForTimeout(750);
    const firstRecovery = await page.evaluate(() => ({
      frame: document.querySelector(".interface-frame")?.getAttribute("data-interface") ?? "",
      panel: Boolean(document.querySelector(".interface-recovery[role=alert]")),
      htmlInterface: document.documentElement.getAttribute("data-interface"),
      faultCount: Number(sessionStorage.getItem("cairn-e2e-render-fault-count") || "0"),
      faultMode: sessionStorage.getItem("cairn-e2e-render-fault"),
      settingsOpen: Boolean(document.querySelector('[role="dialog"][aria-labelledby="settings-title"]')),
      visibleMainCount: [...document.querySelectorAll("main")].filter((item) => item.getBoundingClientRect().width > 0).length,
    }));
    await page.screenshot({ path: join(evidenceDir, "fault-showcase-after-catch.png"), animations: "disabled" });
    if (firstRecovery.panel) await page.screenshot({ path: join(evidenceDir, "fault-showcase-unexpected-panel.png"), animations: "disabled" });
    assert.equal(firstRecovery.frame, "workspace", `showcase-only fault must recover to the workspace frame: ${JSON.stringify(firstRecovery)}`);
    await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close settings" }).click();
    await page.getByRole("status").filter({ hasText: /selected interface failed.*switched to the workspace interface/i }).waitFor({ state: "visible", timeout: 10000 });
    assert.ok((await faultCount(page)) >= 2 && (await faultCount(page)) <= 4, "showcase-only failure is delivered through React retries to the boundary, then recovers to workspace");
    assert.equal(await page.locator(".interface-recovery[role=alert]").count(), 0, "successful workspace recovery does not strand the shared-state shell in an error panel");
    await assertSharedState(page, { query: "Photo", noteDraft, subjectName: "Photo.png" });
    assert.deepEqual(stableFlowCounts(requests), flowCountsBeforeSwitch, "automatic presentation fallback does not repeat the current query");
    const afterCloseCounts = stableFlowCounts(requests);
    await openAppearance(page);
    await page.locator('.interface-option input[value="showcase"]').click();
    await page.locator('.interface-frame[data-interface="showcase"]').waitFor({ state: "visible", timeout: 10000 });
    await assertSharedState(page, { query: "Photo", noteDraft, subjectName: "Photo.png" });
    assert.deepEqual(stableFlowCounts(requests), afterCloseCounts, "explicitly choosing the recovered layout does not replay the current query");
    await page.screenshot({ path: join(evidenceDir, "fault-showcase-recovered.png"), animations: "disabled" });
    return { fault: "showcase-only-once", faultAttempts: await faultCount(page), automaticRecovery: "workspace", explicitReselection: "showcase", sharedStateRetained: true, repeatedSearchOrMutationDispatches: 0, mutations: mutationCount(requests) };
  } finally {
    await ctx.close();
  }
}

async function runSharedFault(browser, url) {
  const ctx = await createFaultContext(browser, url, "");
  const { page, requests } = ctx;
  let releaseStatus;
  let statusStart;
  const statusStarted = new Promise((resolveStart) => { statusStart = resolveStart; });
  let hold = false;
  let release = Promise.resolve();
  await page.route(`**${apiPath}`, async (route) => {
    let body;
    try { body = route.request().postDataJSON(); } catch {}
    if (hold && body?.operation === "status.get") {
      statusStart();
      await release;
    }
    await forwardToDaemon(route);
  });
  try {
    const noteDraft = await prepareSharedState(page);
    await page.getByRole("button", { name: "Refresh service status" }).waitFor({ state: "visible", timeout: 10000 });
    const statusCountBeforeRefresh = countOperation(requests, "status.get");
    hold = true;
    release = new Promise((resolveRelease) => { releaseStatus = resolveRelease; });
    await page.getByRole("button", { name: "Refresh service status" }).click();
    await Promise.race([statusStarted, timeout("shared-fault status.get did not enter flight")]);
    assert.equal(countOperation(requests, "status.get"), statusCountBeforeRefresh + 1, "one extra App-owned status request is held");
    await openAppearance(page);
    const beforeSwitch = stableFlowCounts(requests);
    await page.evaluate(() => sessionStorage.setItem("cairn-e2e-render-fault", "persistent-shared"));
    await page.locator('.interface-option input[value="showcase"]').click();
    const recoveryPanel = page.locator(".interface-recovery[role=alert]");
    await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close settings" }).click();
    await recoveryPanel.waitFor({ state: "visible", timeout: 15000 });
    await recoveryPanel.getByRole("heading", { name: "Interface unavailable" }).waitFor({ state: "visible" });
    await recoveryPanel.getByRole("button", { name: "Retry selected interface" }).waitFor({ state: "visible" });
    const firstFallbackAttempts = await faultCount(page);
    assert.ok(firstFallbackAttempts >= 2 && firstFallbackAttempts <= 4, `shared frame fault reaches its panel in a small bounded attempt count, observed ${firstFallbackAttempts}`);
    await page.waitForTimeout(350);
    assert.equal(await faultCount(page), firstFallbackAttempts, "persistent fault stops rendering without an automatic retry loop");
    assert.deepEqual(stableFlowCounts(requests), beforeSwitch, "shared-fault fallback does not repeat the query or held status refresh");
    assert.equal(countOperation(requests, "status.get"), statusCountBeforeRefresh + 1, "only one added status request remains held through the fault");
    assert.equal(mutationCount(requests), 0, "fault fallback issues no content mutation");
    await page.screenshot({ path: join(evidenceDir, "fault-shared-panel.png"), animations: "disabled" });

    await recoveryPanel.getByRole("button", { name: "Retry selected interface" }).click();
    const retryAttempts = await faultCount(page);
    assert.ok(retryAttempts > firstFallbackAttempts && retryAttempts <= firstFallbackAttempts + 3, `one operator retry makes a bounded number of attempts: ${retryAttempts}`);
    await recoveryPanel.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(300);
    assert.equal(await faultCount(page), retryAttempts, "a failed explicit retry does not enter an automatic retry loop");

    // App-level state remains mounted while the frame displays its recovery
    // panel. Resolve the synthetic fault and explicitly choose the preferred
    // layout to verify that the same state returns.
    const settingsTrigger = recoveryPanel.getByRole("button", { name: "Open settings" });
    await settingsTrigger.click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Close settings" }).click();
    await assertEventually(() => settingsTrigger.evaluate((element) => document.activeElement === element), "closing Settings returns focus to the recovery panel action");
    await settingsTrigger.click();
    await settings.getByRole("button", { name: "Appearance" }).click();
    await settings.locator(".appearance-preferences").waitFor({ state: "visible", timeout: 10000 });
    await page.evaluate(() => sessionStorage.removeItem("cairn-e2e-render-fault"));
    await settings.locator('.interface-option input[value="showcase"]').check();
    await settings.getByRole("button", { name: "Close settings" }).click();
    await page.locator('.interface-frame[data-interface="showcase"]').waitFor({ state: "visible", timeout: 10000 });
    await assertSharedState(page, { query: "Photo", noteDraft, subjectName: "Photo.png" });
    assert.deepEqual(stableFlowCounts(requests), beforeSwitch, "explicit recovery does not repeat the query or held status refresh");
    assert.equal(countOperation(requests, "status.get"), statusCountBeforeRefresh + 1, "explicit recovery does not resubmit the held shared refresh");
    assert.equal(mutationCount(requests), 0, "explicit recovery dispatches no mutation");

    releaseStatus();
    hold = false;
    await assertEventually(() => ctx.responses.some((item) => item.operation === "status.get" && item.envelope.status === "SUCCEEDED"), "held status request receives a real-daemon response after recovery");
    await page.locator(".connection").getByText("Connected", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
    const statusResponses = ctx.responses.filter((item) => item.operation === "status.get");
    assert.equal(statusResponses.length, statusCountBeforeRefresh + 1, "held refresh receives one actual daemon response after recovery");
    await page.screenshot({ path: join(evidenceDir, "fault-shared-recovered.png"), animations: "disabled" });
    return { fault: "persistent-shared-frame", faultAttemptsBeforeRecovery: firstFallbackAttempts, explicitRetryAttempts: retryAttempts, automaticRetryLoop: false, visiblePanel: true, explicitReselectionAfterFaultRepair: "showcase", sharedStateRetainedWhileRefreshHeld: true, coreRequestCountsStableUntilRelease: true, heldRequestRealDaemonStatus: statusResponses.at(-1).envelope.status, mutations: mutationCount(requests) };
  } finally {
    if (releaseStatus) releaseStatus();
    await ctx.close();
  }
}

async function runHeldWrite(browser, url, webRoot) {
  // Keep the Unix socket pathname below macOS's sockaddr_un limit; the
  // harness evidence directory can be deeply nested.
  const daemonRoot = join("/tmp", `cairn-interface-e2e-${process.pid}`);
  const daemon = await startDisposableDaemon(daemonRoot, webRoot);
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, locale: "en-US" });
  const page = await context.newPage();
  const requests = [];
  const responses = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith(apiPath)) return;
    try {
      const body = request.postDataJSON();
      requests.push({ operation: String(body?.operation ?? ""), input: body?.input ?? {} });
    } catch {}
  });
  page.on("response", async (response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith(apiPath)) return;
    try {
      const body = response.request().postDataJSON();
      const envelope = await response.json();
      responses.push({ operation: body?.operation, envelope });
    } catch {}
  });
  let holdWrite = false;
  let releaseWrite;
  let writeStart;
  const writeStarted = new Promise((resolveStart) => { writeStart = resolveStart; });
  let released = Promise.resolve();
  await page.route(`**${apiPath}`, async (route) => {
    let body;
    try { body = route.request().postDataJSON(); } catch {}
    if (holdWrite && body?.operation === "annotation.upsert") {
      writeStart();
      await released;
    }
    await forwardToDaemon(route, daemon.baseURL);
  });
  try {
    await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ appearance: "light", themeId: "slate", interfaceId: "workspace" })), { key: storageKey });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.getByRole("main").waitFor({ state: "visible", timeout: 15000 });
    await page.locator(".connection").getByText("Connected", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
    await page.locator(".result-list .result-row").filter({ hasText: "InterfaceHoldWriteFixture.txt" }).waitFor({ state: "visible", timeout: 30000 });
    const query = "InterfaceHoldWriteFixture";
    const search = page.getByRole("textbox", { name: "Search content library" });
    await search.fill(query);
    const searchButton = page.getByRole("button", { name: /^Search$/ });
    await searchButton.waitFor({ state: "visible", timeout: 10000 });
    await assertEventually(() => searchButton.isEnabled(), "isolated fixture search becomes enabled after its library loads");
    await searchButton.click();
    const row = page.getByRole("main").getByRole("button", { name: /InterfaceHoldWriteFixture\.txt/ }).first();
    await row.waitFor({ state: "visible", timeout: 15000 });
    await row.click();
    await page.locator(".details").getByRole("heading", { name: "InterfaceHoldWriteFixture.txt" }).waitFor({ state: "visible", timeout: 10000 });
    const noteBody = "One interface E2E write held across a layout change.";
    const composer = page.getByRole("textbox", { name: "New note" });
    await composer.fill(noteBody);
    const addNote = page.getByRole("button", { name: "Add note" });
    await assertEventually(() => addNote.isEnabled(), "disposable annotation composer enables Add note after draft entry");

    holdWrite = true;
    released = new Promise((resolveRelease) => { releaseWrite = resolveRelease; });
    await page.getByRole("button", { name: "Add note" }).click();
    await Promise.race([writeStarted, timeout("annotation.upsert did not enter the held route")]);
    assert.equal(countOperation(requests, "annotation.upsert"), 1, "one annotation mutation is held before it reaches the daemon");
    await openAppearance(page);
    const beforeSwitch = stableFlowCounts(requests);
    await page.locator('.interface-option input[value="showcase"]').check();
    await page.locator('.interface-frame[data-interface="showcase"]').waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close settings" }).click();
    assert.deepEqual(stableFlowCounts(requests), beforeSwitch, "switching layouts while the write is held does not repeat the query or pending mutation");
    assert.equal(countOperation(requests, "annotation.upsert"), 1, "interface switch does not duplicate the pending write");
    assert.equal(await composer.inputValue(), noteBody, "the pending write retains its submitted Notes value across layout change");
    assert.equal(await page.getByRole("heading", { name: "InterfaceHoldWriteFixture.txt" }).count(), 1, "the pending write retains selected subject across layout change");
    assert.equal(mutationCount(requests), 1, "one mutation is dispatched while the real commit is still held");
    await page.screenshot({ path: join(evidenceDir, "held-write-showcase.png"), animations: "disabled" });

    releaseWrite();
    holdWrite = false;
    await page.getByText(noteBody, { exact: true }).waitFor({ state: "visible", timeout: 15000 });
    await assertEventually(() => responses.filter((item) => item.operation === "annotation.upsert").length === 1, "the held mutation response is recorded after the actual daemon reply");
    const mutationResponse = responses.filter((item) => item.operation === "annotation.upsert");
    assert.equal(mutationResponse.length, 1, "the held mutation reaches the daemon once");
    assert.equal(mutationResponse[0].envelope.status, "SUCCEEDED", "the disposable daemon commits the note successfully");
    const upsertRequest = requests.find((item) => item.operation === "annotation.upsert");
    const subjectRef = upsertRequest?.input?.subject_ref;
    assert.ok(upsertRequest?.input?.workspace_id && subjectRef, "the actual dispatched note includes workspace and subject references");
    const committed = await daemon.command("annotation.list", { workspace_id: daemon.workspaceID });
    const committedNotes = (committed.annotations ?? []).filter((item) => item.subject_ref === subjectRef && item.kind === "NOTE" && item.body === noteBody);
    assert.equal(committedNotes.length, 1, "disposable catalog has exactly one committed note record");
    assert.equal(committedNotes[0].revision, 1, "the real daemon committed exactly one note revision");
    assert.equal(countOperation(requests, "annotation.upsert"), 1, "browser dispatched one write total");
    assert.equal(mutationCount(requests), 1, "browser dispatched one mutation total");
    await writeFile(join(evidenceDir, "held-write-evidence.json"), JSON.stringify({
      result: "PASS",
      isolatedDaemon: daemon.baseURL,
      temporaryCatalogAndRepository: daemon.root,
      fixtureSubject: "InterfaceHoldWriteFixture.txt",
      selectedBinaries: daemon.binaries,
      interfaceChangedWhileHeld: "workspace -> showcase",
      annotationUpsertDispatches: countOperation(requests, "annotation.upsert"),
      annotationUpsertResponses: mutationResponse.length,
      committedMatchingNotes: committedNotes.length,
      committedRevision: committedNotes[0].revision,
    }, null, 2));
    return { fault: "none", scenario: "single held mutation on disposable daemon", mutationDispatches: 1, mutationResponses: 1, committedNotes: committedNotes.length, committedRevision: committedNotes[0].revision, duplicateMutationDispatches: 0 };
  } finally {
    if (releaseWrite) releaseWrite();
    await context.close();
    await daemon.close();
  }
}

async function createFaultContext(browser, url, startupFault) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, locale: "en-US" });
  const page = await context.newPage();
  const requests = [];
  const responses = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith(apiPath)) return;
    try {
      const body = request.postDataJSON();
      requests.push({ operation: String(body?.operation ?? ""), input: body?.input ?? {} });
    } catch {}
  });
  page.on("response", async (response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith(apiPath)) return;
    try {
      const body = response.request().postDataJSON();
      const envelope = await response.json();
      responses.push({ operation: body?.operation, envelope });
    } catch {}
  });
  await page.addInitScript(({ key, fault }) => {
    localStorage.setItem(key, JSON.stringify({ appearance: "light", themeId: "slate", interfaceId: "workspace" }));
    sessionStorage.removeItem("cairn-e2e-render-fault-count");
    if (fault) sessionStorage.setItem("cairn-e2e-render-fault", fault);
    else sessionStorage.removeItem("cairn-e2e-render-fault");
  }, { key: storageKey, fault: startupFault });
  await page.route(`**${apiPath}`, (route) => forwardToDaemon(route));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("main").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".connection").getByText("Connected", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
  await page.locator(".result-list .result-row").filter({ hasText: "Photo.png" }).waitFor({ state: "visible", timeout: 30000 });
  return { page, context, requests, responses, close: () => context.close() };
}

async function prepareSharedState(page) {
  await page.getByRole("main").waitFor({ state: "visible", timeout: 15000 });
  const search = page.getByRole("textbox", { name: "Search content library" });
  await search.fill("Photo");
  const searchButton = page.getByRole("button", { name: /^Search$/ });
  await assertEventually(() => searchButton.isEnabled(), "shared-state search becomes enabled after the QA library loads");
  await submitPhotoSearch(page, searchButton);
  const photo = page.getByRole("main").getByRole("button", { name: /Photo\.png/ }).first();
  await photo.waitFor({ state: "visible", timeout: 15000 });
  await photo.click();
  await page.locator(".details").getByRole("heading", { name: "Photo.png" }).waitFor({ state: "visible", timeout: 10000 });
  const noteDraft = "QA render-fault draft: keep across recovery.";
  await page.getByRole("textbox", { name: "New note" }).fill(noteDraft);
  await assertEventually(async () => await page.getByRole("textbox", { name: "New note" }).inputValue() === noteDraft, "render-fault precondition has an unsaved note draft");
  return noteDraft;
}

async function submitPhotoSearch(page, searchButton) {
  const photoSearchResponse = page.waitForResponse((response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith(apiPath)) return false;
    try {
      const request = response.request().postDataJSON();
      return request?.operation === "search.query" && request?.input?.query === "Photo";
    } catch { return false; }
  });
  await searchButton.click();
  const completedSearch = await photoSearchResponse;
  const searchRequest = completedSearch.request().postDataJSON();
  const searchResult = await completedSearch.json();
  assert.equal(searchRequest?.operation, "search.query", "setup waits for the daemon search operation");
  assert.equal(searchRequest?.input?.query, "Photo", "setup waits for the exact submitted Photo query");
  assert.ok(["SUCCEEDED", "DEGRADED"].includes(searchResult?.status), `the real Photo query must complete with results: ${searchResult?.status}`);
  assert.ok(Array.isArray(searchResult?.data?.hits), "the completed Photo query returns its hit list");
  assert.ok(searchResult.data.hits.some((hit) => hit?.name === "Photo.png"), "the completed Photo query contains its intended subject");
  await assertEventually(() => searchButton.isEnabled(), "the existing search loading state clears after the Photo response is applied");
}

async function faultCount(page) {
  return page.evaluate(() => Number(sessionStorage.getItem("cairn-e2e-render-fault-count") || "0"));
}

async function forwardToDaemon(route, daemonURL = baseURL) {
  const original = new URL(route.request().url());
  const target = new URL(daemonURL);
  target.pathname = original.pathname;
  target.search = original.search;
  try {
    const response = await route.fetch({ url: target.toString() });
    await route.fulfill({ response });
  } catch (error) {
    // A scenario assertion may close its browser context while a follow-up
    // refresh is in flight. Keep that cleanup from hiding the primary error.
    if (!/disposed|closed|aborted/i.test(String(error))) throw error;
  }
}

async function startDisposableDaemon(root, webRoot) {
  await mkdir(root, { recursive: true });
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "InterfaceHoldWriteFixture.txt"), "Disposable interface E2E content fixture.\n");
  const config = join(root, "config.toml");
  const daemonBinary = process.env.CAIRN_DAEMON_BIN || join(qaDeployment, "bin/cairnd");
  const clientBinary = process.env.CAIRN_BIN || join(qaDeployment, "bin/cairn");
  assert.ok(isAbsolute(daemonBinary), "CAIRN_DAEMON_BIN override must be absolute");
  assert.ok(isAbsolute(clientBinary), "CAIRN_BIN override must be absolute");
  const binaries = {
    daemon: { path: daemonBinary, sha256: createHash("sha256").update(await readFile(daemonBinary)).digest("hex") },
    rw: { path: clientBinary, sha256: createHash("sha256").update(await readFile(clientBinary)).digest("hex") },
  };
  assert.equal(spawnSync(clientBinary, ["config", "init", "--path", config], { cwd: repo, env: isolatedDaemonEnvironment(root), stdio: "ignore" }).status, 0, "initialize disposable daemon config");
  const port = await freeLoopbackPort();
  const env = {
    ...isolatedDaemonEnvironment(root),
    CAIRN_CATALOG: join(root, "catalog.sqlite"),
    CAIRN_REPOSITORY: join(root, "repository"),
    CAIRN_VECTORS: join(root, "vectors"),
    CAIRN_MODELS: join(root, "models"),
    CAIRN_RECOVERY_RECORDS: join(root, "recovery"),
  };
  const daemon = spawn(daemonBinary, ["--config", config, "--socket", join(root, "daemon.sock"), "--api-listen", `127.0.0.1:${port}`, "--web-root", webRoot], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
  const daemonOutput = [];
  daemon.stdout.on("data", (chunk) => daemonOutput.push(String(chunk)));
  daemon.stderr.on("data", (chunk) => daemonOutput.push(String(chunk)));
  try {
    await Promise.race([once(daemon, "spawn"), once(daemon, "error").then(([error]) => Promise.reject(error))]);
    const daemonURL = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      assert.equal(daemon.exitCode, null, `disposable daemon stays alive while its API starts: ${daemonOutput.join("")}`);
      try {
        const response = await fetch(`${daemonURL}/api/v1/healthz`);
        if (response.ok) {
          const ingestPlan = await apiCommand(daemonURL, "plan.ingest", { root: source });
          assert.equal(ingestPlan.status, "SUCCEEDED", "fixture plan is created in the disposable store");
          assert.equal(ingestPlan.data?.executable, true, "disposable fixture plan is executable");
          const applied = await apiCommand(daemonURL, "plan.apply", { workspace_id: ingestPlan.data.workspace_id, plan_id: ingestPlan.data.plan_id, plan_digest: ingestPlan.data.plan_digest });
          assert.ok(["SUCCEEDED", "DEGRADED"].includes(applied.status), `isolated fixture apply outcome: ${applied.status}`);
          const listing = await apiCommand(daemonURL, "content.list", { workspace_id: ingestPlan.data.workspace_id });
          assert.ok((listing.data?.items ?? []).some((item) => item.name === "InterfaceHoldWriteFixture.txt"), "disposable fixture publication can be listed");
          return {
            root,
            baseURL: daemonURL,
            workspaceID: ingestPlan.data.workspace_id,
            binaries,
            daemon,
            command: async (operation, input) => (await apiCommand(daemonURL, operation, input)).data,
            close: async () => {
              if (daemon.exitCode === null && daemon.signalCode === null) {
                const exited = once(daemon, "exit");
                daemon.kill("SIGTERM");
                await Promise.race([exited, new Promise((resolveExit) => setTimeout(resolveExit, 5000))]);
                if (daemon.exitCode === null && daemon.signalCode === null) {
                  const killed = once(daemon, "exit");
                  daemon.kill("SIGKILL");
                  await killed;
                }
              }
              await rm(root, { recursive: true, force: true });
            },
          };
        }
      } catch (error) {
        if (attempt === 119) throw error;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
    throw new Error("disposable daemon did not become ready");
  } catch (error) {
    if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGTERM");
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function apiCommand(daemonURL, operation, input) {
  const response = await fetch(`${daemonURL}${apiPath}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, input }) });
  assert.equal(response.status, 200, `${operation} HTTP status from disposable daemon`);
  const envelope = await response.json();
  assert.ok(envelope.status === "SUCCEEDED" || (operation === "plan.apply" && envelope.status === "DEGRADED"), `${operation}: ${JSON.stringify(envelope.reasons ?? [])}`);
  return envelope;
}

function isolatedDaemonEnvironment(root) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("CAIRN_")));
  return {
    ...inherited,
    XDG_CONFIG_HOME: join(root, "xdg/config"),
    XDG_DATA_HOME: join(root, "xdg/data"),
    XDG_CACHE_HOME: join(root, "xdg/cache"),
  };
}

async function freeLoopbackPort() {
  const probe = createServer();
  await new Promise((resolveListen, rejectListen) => {
    probe.once("error", rejectListen);
    probe.listen(0, "127.0.0.1", resolveListen);
  });
  const address = probe.address();
  assert.ok(address && typeof address === "object", "reserve an ephemeral loopback port");
  await new Promise((resolveClose, rejectClose) => probe.close((error) => error ? rejectClose(error) : resolveClose()));
  return address.port;
}

function createStaticHost(root) {
  const absoluteRoot = resolve(root);
  return createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end("method not allowed");
      return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname); }
    catch { response.writeHead(400).end("bad path"); return; }
    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    let file = resolve(absoluteRoot, requested);
    if (file !== absoluteRoot && !file.startsWith(`${absoluteRoot}${sep}`)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    let body;
    try { body = await readFile(file); }
    catch {
      file = join(absoluteRoot, "index.html");
      try { body = await readFile(file); } catch { response.writeHead(404).end("not found"); return; }
    }
    const contentType = ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" })[extname(file)] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType, "content-length": body.length, "cache-control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : body);
  });
}

function mutationCount(requests) {
  return requests.filter((item) => mutationOperations.has(item.operation)).length;
}

function stableFlowCounts(requests) {
  return {
    searchQuery: countOperation(requests, "search.query"),
    doctorCheck: countOperation(requests, "doctor.check"),
    annotationUpsert: countOperation(requests, "annotation.upsert"),
    otherMutation: requests.filter((item) => mutationOperations.has(item.operation) && item.operation !== "annotation.upsert").length,
  };
}

function timeout(message) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 10000));
}
