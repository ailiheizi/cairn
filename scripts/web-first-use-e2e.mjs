// Fresh-profile browser acceptance for the existing first-use content path.
// The runner owns a temporary config, catalog, repository, recovery directory,
// inbox, browser, and loopback listener. It never reads or changes a saved user
// profile or the persistent local QA daemon.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(repo, "web");
const tempRoot = await mkdtemp(join(tmpdir(), "cairn-first-use-"));
const evidenceDir = process.env.CAIRN_FIRST_USE_EVIDENCE_DIR
  ? resolve(process.env.CAIRN_FIRST_USE_EVIDENCE_DIR)
  : join(repo, "dist", "whole-product-20261006", "first-use");
let daemon;
let browserContext;
let closeout = false;

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

async function assertSparseLibrary(page, expectedCount, label) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(50);
  const measured = await page.evaluate(() => {
    const list = document.querySelector(".result-list:not(.list-mode)");
    const tiles = [...(list?.querySelectorAll(".result-row") ?? [])];
    const first = tiles[0];
    const name = first?.querySelector(".result-open-copy strong");
    const rect = first?.getBoundingClientRect();
    const nameRect = name?.getBoundingClientRect();
    return {
      count: tiles.length,
      tileWidth: rect?.width ?? 0,
      tileHeight: rect?.height ?? 0,
      nameText: name?.textContent?.trim() ?? "",
      nameTop: nameRect?.top ?? 0,
      nameBottom: nameRect?.bottom ?? Infinity,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  assert.equal(measured.count, expectedCount, `${label}: expected ${expectedCount} visible file tiles, got ${JSON.stringify(measured)}`);
  assert.ok(measured.tileWidth > 0 && measured.tileWidth <= 250, `${label}: sparse result tiles must stay within 250px, got ${JSON.stringify(measured)}`);
  assert.ok(measured.nameTop >= 0 && measured.nameBottom <= measured.viewportHeight, `${label}: file name must be in the first viewport, got ${JSON.stringify(measured)}`);
  assert.ok(measured.documentWidth <= measured.viewportWidth + 1, `${label}: page must not overflow horizontally, got ${JSON.stringify(measured)}`);
  return measured;
}

async function setInterface(page, interfaceId) {
  await page.getByRole("button", { name: /Open settings|打开设置/ }).click();
  const settings = page.getByRole("dialog", { name: /Settings|设置/ });
  await settings.getByRole("button", { name: /Appearance|外观/ }).click();
  await settings.locator(`input[name="cairn-interface"][value="${interfaceId}"]`).check();
  await page.locator(`.interface-frame[data-interface="${interfaceId}"]`).waitFor({ state: "visible", timeout: 10000 });
  await settings.getByRole("button", { name: /Close settings|关闭设置/ }).click();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repo, encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? result.signal})\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

async function pickPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function hashDirectory(directory) {
  const names = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const entries = [];
  for (const item of names) {
    const path = join(directory, item.name);
    if (item.isDirectory()) entries.push(`${item.name}/:${await hashDirectory(path)}`);
    else entries.push(`${item.name}:${sha256(await readFile(path))}`);
  }
  return sha256(entries.join("\n"));
}

function isolatedEnvironment(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of [
    "CAIRN_API_TOKEN", "CAIRN_SEMANTIC_BUNDLE", "CAIRN_IMAGE_BUNDLE",
    "CAIRN_BGE_ONNX_RUNTIME", "CAIRN_BGE_ONNX_MODEL", "CAIRN_BGE_TOKENIZER",
    "CAIRN_ZVEC_LIBRARY", "CAIRN_SEMANTIC_BUNDLE_ROOT", "CAIRN_RUN_SUPERVISED_ONNX",
    "ZVEC_LIBRARY_PATH", "CAIRN_CATALOG", "CAIRN_REPOSITORY", "CAIRN_VECTORS",
    "CAIRN_MODELS", "CAIRN_RECOVERY_RECORDS", "CAIRN_CONFIG",
  ]) delete env[key];
  return env;
}

async function executableFrom(override, name, packagePath, outputPath) {
  if (override) {
    const path = resolve(override);
    assert.ok(isAbsolute(path), `${name} override must resolve to an absolute path`);
    return path;
  }
  run("go", ["build", "-tags", "purego", "-o", outputPath, packagePath]);
  return outputPath;
}

async function buildWebDist() {
  const suppliedWebDist = process.env.CAIRN_WEB_DIST || process.env.WEB_DIST;
  if (suppliedWebDist) {
    const path = resolve(suppliedWebDist);
    assert.ok(isAbsolute(path), "CAIRN_WEB_DIST must resolve to an absolute path");
    assert.ok((await readFile(join(path, "index.html"))).length > 0, "CAIRN_WEB_DIST must contain index.html");
    return path;
  }
  const output = join(tempRoot, "web-dist");
  run("npm", ["--prefix", webDir, "run", "build", "--", "--outDir", output, "--emptyOutDir"]);
  return output;
}

async function waitForHealth(url, child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`daemon exited before startup (${child.exitCode})`);
    try {
      const response = await fetch(`${url}/api/v1/healthz`);
      if (response.ok) return;
    } catch { /* startup is still in progress */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("temporary daemon did not become ready");
}

async function stopDaemon() {
  if (!daemon || daemon.exitCode !== null) return;
  daemon.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => daemon.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5000)),
  ]);
  if (daemon.exitCode === null) daemon.kill("SIGKILL");
}

try {
  const daemonBin = await executableFrom(process.env.CAIRN_DAEMON_BIN || process.env.DAEMON_BIN, "DAEMON_BIN", "./server/cmd/cairnd", join(tempRoot, "cairnd"));
  const cairnBin = await executableFrom(process.env.CAIRN_BIN || process.env.BIN, "BIN", "./client/cmd/cairn", join(tempRoot, "cairn"));
  const webDist = await buildWebDist();
  const webDigest = await hashDirectory(webDist);
  const binaryDigests = { daemon: sha256(await readFile(daemonBin)), cairn: sha256(await readFile(cairnBin)), web: webDigest };
  console.log(`FIRST_USE_BUILD daemon=${daemonBin} sha256=${binaryDigests.daemon}`);
  console.log(`FIRST_USE_BUILD cairn=${cairnBin} sha256=${binaryDigests.cairn}`);
  console.log(`FIRST_USE_BUILD web_dist=${webDist} tree_sha256=${binaryDigests.web}`);

  const configPath = join(tempRoot, "config.toml");
  const socketPath = join(tempRoot, "cairnd.sock");
  const dataRoot = join(tempRoot, "data");
  await mkdir(dataRoot, { recursive: true });
  const daemonEnv = isolatedEnvironment({
    XDG_CONFIG_HOME: join(tempRoot, "xdg-config"),
    XDG_DATA_HOME: join(tempRoot, "xdg-data"),
    CAIRN_CATALOG: join(dataRoot, "catalog.sqlite"),
    CAIRN_REPOSITORY: join(dataRoot, "repository"),
    CAIRN_VECTORS: join(dataRoot, "vectors"),
    CAIRN_MODELS: join(dataRoot, "models"),
    CAIRN_RECOVERY_RECORDS: join(dataRoot, "recovery"),
  });
  run(cairnBin, ["config", "init", "--path", configPath], { env: daemonEnv });
  const port = await pickPort();
  const baseURL = `http://127.0.0.1:${port}`;
  daemon = spawn(daemonBin, ["--config", configPath, "--socket", socketPath, "--api-listen", `127.0.0.1:${port}`, "--web-root", webDist], {
    cwd: repo,
    env: daemonEnv,
    stdio: ["ignore", "ignore", "ignore"],
  });
  await waitForHealth(baseURL, daemon);

  let playwrightPath = process.env.CAIRN_PLAYWRIGHT_MODULE;
  if (!playwrightPath) {
    const candidate = join(webDir, "node_modules", "playwright", "index.mjs");
    try { await readFile(candidate); playwrightPath = candidate; } catch { playwrightPath = "playwright"; }
  }
  const playwright = await import(playwrightPath.startsWith(".") || isAbsolute(playwrightPath) ? pathToFileURL(resolve(playwrightPath)).href : playwrightPath);
  // The installed browser is the fallback, matching the sibling harnesses: a
  // checkout without Playwright's own downloaded browser must still be able to
  // run this journey instead of failing at launch.
  const executablePath = process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await playwright.chromium.launch({ headless: true, executablePath });
  browserContext = browser;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const fixtureName = `first-use-${process.pid}.txt`;
  const fixtureBody = `Cairn first-use exact bytes ${process.pid}\nSearchable note and tag journey.\n`;
  const fixtureBytes = Buffer.from(fixtureBody, "utf8");
  const fixturePath = join(tempRoot, fixtureName);
  const expectedDigest = sha256(fixtureBytes);
  await writeFile(fixturePath, fixtureBytes);
  const rxName = new RegExp(`^${fixtureName.replaceAll(".", "\\.")}$`);
  await mkdir(evidenceDir, { recursive: true });
  await copyFile(fixturePath, join(evidenceDir, "generated-original.txt"));
  const screenshots = [];
  async function capture(name) {
    const path = join(evidenceDir, `${name}.png`);
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    screenshots.push(path);
  }

  const degradeSourceList = (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { return route.continue(); }
    if (payload?.operation === "source.list") return route.abort();
    return route.continue();
  };
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  await page.locator(".onboarding-steps").waitFor({ state: "visible", timeout: 15000 });
  assert.match(await page.locator(".onboarding-steps").innerText(), /Review the plan|检查计划/, "fresh-library guide must explain that the operator reviews before saving");
  await capture("01-empty-library");

  await page.getByRole("button", { name: /Choose content|选择内容/ }).click();
  const intake = page.locator(".source-drawer");
  await intake.waitFor({ state: "visible", timeout: 10000 });
  await intake.locator('input[type="file"]').setInputFiles(fixturePath);
  await intake.locator('.upload-rows[data-staged="1"]').waitFor({ state: "visible", timeout: 15000 });
  assert.match(await intake.locator(".upload-rows").innerText(), new RegExp(expectedDigest.slice(0, 12)), "staging must show the daemon's digest receipt");
  assert.match(await intake.innerText(), /no protection record yet|尚无保护记录/i, "staged bytes must be clearly marked unprotected");
  await capture("02-staged-unprotected");
  await intake.getByRole("button", { name: /Review staged files|检查暂存文件/ }).click();
  await intake.getByText(/Storage plan is ready to review|存储计划已生成/).waitFor({ state: "visible", timeout: 15000 });
  await intake.locator(".plan-files").first().click();
  assert.match(await intake.locator(".plan-file-list").innerText(), new RegExp(expectedDigest), "the reviewed plan must bind the complete byte identity");
  assert.match(await intake.locator(".plan-file-list").innerText(), /STORE_EXACT/, "the review must use the exact-save default");
  await capture("03-explicit-store-exact-review");

  const workspaceID = await page.evaluate(() => localStorage.getItem("cairn.workspace_id") ?? "");
  assert.ok(workspaceID, "the reviewed plan should establish the workspace for the daemon query");
  const beforeApply = await page.evaluate(async (input) => {
    const response = await fetch("/api/v1/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "snapshot.list", input }) });
    const body = await response.json();
    return { status: body.status, snapshots: body.data?.snapshots ?? [] };
  }, { workspace_id: workspaceID });
  assert.equal(beforeApply.status, "SUCCEEDED");
  assert.equal(beforeApply.snapshots.length, 0, "the preview must not publish a snapshot before explicit confirmation");

  // An ingest preview has now established the workspace but has not changed
  // protected content. Fail only the secondary source projection so the
  // empty state must report that its source status could not be read.
  await page.route("**/api/v1/command", degradeSourceList);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText(/Source status could not be read|无法读取来源状态/).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await page.locator(".onboarding-steps").count(), 0, "a degraded source projection must not look like a clean first-use state");
  await capture("00-source-status-degraded");
  await page.unroute("**/api/v1/command", degradeSourceList);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".onboarding-steps").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".workspace-nav-item").filter({ hasText: /^(来源|Sources)/ }).click();
  const stagedCard = page.locator('.sources-surface [data-kind="staging"]');
  await stagedCard.waitFor({ state: "visible", timeout: 15000 });
  await stagedCard.getByRole("button", { name: /Review staged files|检查暂存文件/ }).click();
  await intake.getByText(/Storage plan is ready to review|存储计划已生成/).waitFor({ state: "visible", timeout: 15000 });
  await intake.locator(".plan-files").first().waitFor({ state: "visible", timeout: 15000 });
  await intake.locator(".plan-files").first().click();
  await capture("03-resumed-store-exact-review-state");
  assert.match(await intake.locator(".plan-file-list").innerText(), new RegExp(expectedDigest), "the resumed review must bind the staged original");
  assert.match(await intake.locator(".plan-file-list").innerText(), /STORE_EXACT/, "the resumed review must preserve exact-save default");
  await capture("03-explicit-store-exact-review");

  await intake.getByRole("button", { name: /Confirm save|确认保存/ }).click();
  await intake.locator('.drawer-action-bar[data-state="SAVED"]').waitFor({ state: "visible", timeout: 20000 });
  await intake.getByRole("button", { name: /View saved content|查看已保存内容/ }).click();
  const firstStep = page.locator(".first-use-next-step");
  await firstStep.waitFor({ state: "visible", timeout: 15000 });
  // The save completion can keep the saved row selected. Clear that transient
  // inspector state so sparse-layout checks measure the ordinary browse view.
  await page.keyboard.press("Escape");
  const layoutEvidence = { workspaceOneFileDesktop: await assertSparseLibrary(page, 1, "workspace, one file, 1280x900") };
  await capture("04-first-saved-library-workspace-1file");
  await page.setViewportSize({ width: 390, height: 844 });
  layoutEvidence.workspaceOneFileMobile = await assertSparseLibrary(page, 1, "workspace, one file, 390x844");
  await capture("04b-first-saved-library-workspace-1file-mobile");
  await page.setViewportSize({ width: 1280, height: 900 });
  await setInterface(page, "showcase");
  layoutEvidence.showcaseOneFileDesktop = await assertSparseLibrary(page, 1, "showcase, one file, 1280x900");
  await capture("04c-first-saved-library-showcase-1file");
  await page.setViewportSize({ width: 390, height: 844 });
  layoutEvidence.showcaseOneFileMobile = await assertSparseLibrary(page, 1, "showcase, one file, 390x844");
  await capture("04d-first-saved-library-showcase-1file-mobile");
  await page.setViewportSize({ width: 1280, height: 900 });
  await setInterface(page, "workspace");
  await firstStep.locator("summary").click();
  await firstStep.getByRole("button", { name: /Search the library|搜索内容库/ }).click();
  const search = page.getByRole("textbox", { name: /Search content library|搜索内容库/ });
  await search.fill(fixtureName);
  await search.press("Enter");
  await page.getByRole("main").getByRole("heading", { name: /Results for|搜索结果/ }).waitFor({ state: "visible", timeout: 15000 });
  const result = page.getByRole("main").getByRole("button", { name: rxName }).first();
  await result.waitFor({ state: "visible", timeout: 15000 });
  await result.click();
  await page.getByRole("main").getByRole("heading", { name: rxName }).waitFor({ state: "visible", timeout: 15000 });
  await capture("05-inspector-after-name-search");

  const details = page.locator(".detail-column");
  await details.getByRole("combobox", { name: /New tag|新标签/ }).fill("first-use");
  await details.getByRole("button", { name: /Add tag|添加标签/ }).click();
  await details.locator(".tag-chip.user").getByText("first-use").waitFor({ state: "visible", timeout: 15000 });
  await details.getByRole("textbox", { name: /New note|新备注/ }).fill("Keep this original with the travel records.");
  await details.getByRole("button", { name: /Add note|添加备注/ }).click();
  await details.getByText("Keep this original with the travel records.").waitFor({ state: "visible", timeout: 15000 });
  await capture("05-item-tag-and-notes");

  await details.getByRole("button", { name: /Back to results|返回列表/ }).click();
  await page.locator(".detail-column").waitFor({ state: "hidden", timeout: 10000 });
  await search.fill("tag:first-use");
  await search.press("Enter");
  await page.getByRole("main").getByRole("heading", { name: /Results for|搜索结果/ }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("main").getByRole("button", { name: rxName }).first().waitFor({ state: "visible", timeout: 15000 });
  await capture("06-found-by-tag");
  await search.fill('"travel records"');
  await search.press("Enter");
  await page.getByRole("main").getByRole("heading", { name: /Results for|搜索结果/ }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("main").getByRole("button", { name: rxName }).first().waitFor({ state: "visible", timeout: 15000 });
  await capture("07-found-by-note");
  await page.getByRole("main").getByRole("button", { name: rxName }).first().click();
  await details.getByRole("heading", { name: rxName }).waitFor({ state: "visible", timeout: 15000 });
  await capture("08-original-takeout-ready");

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    details.getByRole("button", { name: /Download original|下载原始文件/ }).click(),
  ]);
  assert.equal(download.suggestedFilename(), fixtureName, "original takeout must preserve the item name");
  const downloadedPath = await download.path();
  assert.ok(downloadedPath, "the browser must receive an actual file download");
  const downloadedBytes = await readFile(downloadedPath);
  assert.deepEqual(downloadedBytes, fixtureBytes, "downloaded original bytes must match the generated source");
  assert.equal(sha256(downloadedBytes), expectedDigest, "downloaded original SHA-256 must match the daemon's staged digest");
  await copyFile(downloadedPath, join(evidenceDir, "original-takeout.txt"));

  // Add one more generated file through the same browser intake so sparse
  // two-item layouts receive the same first-viewport check.
  const secondName = `first-use-second-${process.pid}.txt`;
  const secondBytes = Buffer.from(`Second first-use layout fixture ${process.pid}\n`);
  const secondDigest = sha256(secondBytes);
  const secondPath = join(tempRoot, secondName);
  await writeFile(secondPath, secondBytes);
  await page.getByRole("button", { name: /Add content|添加内容|Add source|添加来源/ }).first().click();
  const secondIntake = page.locator(".source-drawer");
  await secondIntake.locator('input[type="file"]').setInputFiles(secondPath);
  await secondIntake.locator('.upload-rows[data-staged="1"]').waitFor({ state: "visible", timeout: 15000 });
  await secondIntake.getByRole("button", { name: /Review staged files|检查暂存文件/ }).click();
  await secondIntake.getByText(/Storage plan is ready to review|存储计划已生成/).waitFor({ state: "visible", timeout: 15000 });
  await secondIntake.locator(".plan-files").first().click();
  assert.match(await secondIntake.locator(".plan-file-list").innerText(), new RegExp(secondDigest), "the second layout fixture must appear in its explicit review plan");
  assert.match(await secondIntake.locator(".plan-file-list").innerText(), /STORE_EXACT/);
  await secondIntake.getByRole("button", { name: /Confirm save|确认保存/ }).click();
  await secondIntake.locator('.drawer-action-bar[data-state="SAVED"]').waitFor({ state: "visible", timeout: 20000 });
  await secondIntake.getByRole("button", { name: /View saved content|查看已保存内容/ }).click();
  await page.locator(".result-list .result-row").nth(1).waitFor({ state: "visible", timeout: 15000 });
  layoutEvidence.workspaceTwoFilesDesktop = await assertSparseLibrary(page, 2, "workspace, two files, 1280x900");
  await capture("10-two-files-workspace");
  await page.setViewportSize({ width: 390, height: 844 });
  layoutEvidence.workspaceTwoFilesMobile = await assertSparseLibrary(page, 2, "workspace, two files, 390x844");
  await capture("10b-two-files-workspace-mobile");
  await page.setViewportSize({ width: 1280, height: 900 });
  await setInterface(page, "showcase");
  layoutEvidence.showcaseTwoFilesDesktop = await assertSparseLibrary(page, 2, "showcase, two files, 1280x900");
  await capture("10c-two-files-showcase");
  await page.setViewportSize({ width: 390, height: 844 });
  layoutEvidence.showcaseTwoFilesMobile = await assertSparseLibrary(page, 2, "showcase, two files, 390x844");
  await capture("10d-two-files-showcase-mobile");

  await page.route("**/api/v1/**", (route) => route.abort());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("alert").filter({ hasText: /Cairn service is unavailable|服务不可用/ }).waitFor({ state: "visible", timeout: 10000 });
  await capture("09-service-offline-explicit");
  const report = {
    status: "PASS",
    date: new Date().toISOString(),
    scope: "fresh empty browser profile using existing upload, plan/apply, query, annotation, and original-download operations",
    build: { daemonPath: daemonBin, daemonSha256: binaryDigests.daemon, cairnPath: cairnBin, cairnSha256: binaryDigests.cairn, webDistPath: webDist, webDistTreeSha256: binaryDigests.web },
    isolatedRuntime: { config: configPath, catalog: join(dataRoot, "catalog.sqlite"), repository: join(dataRoot, "repository"), recovery: join(dataRoot, "recovery"), socket: socketPath, listener: baseURL, profileRoot: tempRoot },
    generatedFile: { name: fixtureName, logicalBytes: fixtureBytes.length, sha256: expectedDigest, stagingUnprotectedBeforeApply: true, noPublishedSnapshotBeforeConfirmation: true, reviewProtectionMode: "STORE_EXACT" },
    userJourney: { freshEmptyGuide: true, explicitReviewAndConfirm: true, foundByName: true, taggedAndNoteAdded: true, foundByTag: true, foundByNoteText: true, originalDownloadBytesMatch: true, originalDownloadSha256: expectedDigest },
    failureVisibility: { degradedSourceProjectionExplicit: true, serviceOfflineExplicit: true },
    sparseLayout: layoutEvidence,
    screenshots,
    evidenceFiles: [join(evidenceDir, "generated-original.txt"), join(evidenceDir, "original-takeout.txt")],
  };
  await writeFile(join(evidenceDir, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`PASS: fresh browser journey ${fixtureName} SHA-256=${expectedDigest}; stage -> explicit STORE_EXACT -> name search -> tag and Notes -> tag search -> Notes search -> SHA-256-verified original download.`);
  console.log(`FIRST_USE_EVIDENCE ${join(evidenceDir, "result.json")}`);
  console.log(`FIRST_USE_RUNTIME profile=${tempRoot} config=${configPath} catalog=${join(dataRoot, "catalog.sqlite")} repository=${join(dataRoot, "repository")} socket=${socketPath} listener=${baseURL}`);
  closeout = true;
  await browser.close();
  browserContext = undefined;
} finally {
  if (browserContext) await browserContext.close().catch(() => {});
  await stopDaemon();
  await rm(tempRoot, { recursive: true, force: true });
  if (!closeout) console.error("FAIL: first-use browser acceptance did not complete; owned temporary data was removed.");
}
