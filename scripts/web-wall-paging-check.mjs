// Bounded-page chain check for the library walls (convergence-phase fetch
// evidence).
//
// The walls used to ask `content.list` for the whole published projection in
// one request, so the first screen waited for every entry and the browser
// projected all of them. This script measures the replacement contract on a
// real daemon, a real built client and real Google Chrome:
//
//   1. the first screen is rendered from one bounded page (`page.limit`), and
//      the daemon's exact total (`page.entries`) is what the wall's count label
//      and its scroll length describe — the loaded page is never reported as
//      the whole collection;
//   2. a position whose page has not arrived yet is held open (pending), never
//      rendered as an item and never counted as one;
//   3. the wall asks for the next page when the mounted window reaches the end
//      of what is loaded, so a page boundary is not the end of the listing;
//   4. while a page is in flight the surface says so (`data-listing-state`);
//   5. when the published projection moves under the wall, the daemon refuses
//      the cursor, the wall restarts from the beginning, says what happened,
//      and never blends rows from two generations into one list;
//   6. scrolling to the bottom still reaches every entry: the loaded count
//      converges on the exact total with no pending position left.
//
// It owns a temporary profile (its own config, catalog, repository, vectors,
// models, recovery directory, socket and daemon log) through the CAIRN_*
// variables, generates its own tiny corpus inside that temporary directory,
// opens it read-only, and removes the profile and stops the daemon on success,
// failure and signal. It never reads or writes a saved operator profile.
//
// Usage:
//   node scripts/web-wall-paging-check.mjs              # check the contract
//   node scripts/web-wall-paging-check.mjs --measure    # print the numbers only
//
// `--measure` exists to record the pre-change behaviour of a built client that
// has no bounded paging: it prints the same measurements and skips the paging
// assertions.
//
// Environment:
//   CAIRN_DAEMON_BIN                    absolute prebuilt cairnd; skips that build
//   CAIRN_BIN                           absolute prebuilt cairn; skips that build
//   CAIRN_WEB_DIST                      built WebUI root (default web/dist)
//   CAIRN_WALL_PORT                     loopback API port (default 4659)
//   CAIRN_WALL_FILES                    files per generated source folder
//                                       (default 480)
//   CAIRN_WALL_TIMEOUT_MS               daemon readiness budget (default 300000)
//   CAIRN_WALL_BROWSER_TIMEOUT_MS       browser budget (default 240000)
//   CAIRN_WALL_KEEP=1                   keep the daemon and the temporary profile
//   CAIRN_PLAYWRIGHT_MODULE             Playwright module
//   CAIRN_PLAYWRIGHT_EXECUTABLE_PATH    Chrome/Chromium binary
//   TMPDIR                              where the temporary profile is created

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const measureOnly = process.argv.includes("--measure");
const daemonOverride = (process.env.CAIRN_DAEMON_BIN || "").trim();
const cliOverride = (process.env.CAIRN_BIN || "").trim();
const webDistOverride = (process.env.CAIRN_WEB_DIST || "").trim();
const port = Number.parseInt(process.env.CAIRN_WALL_PORT || "4659", 10);
const timeoutMs = Number.parseInt(process.env.CAIRN_WALL_TIMEOUT_MS || "300000", 10);
const browserTimeoutMs = Number.parseInt(process.env.CAIRN_WALL_BROWSER_TIMEOUT_MS || "240000", 10);
const filesPerFolder = Number.parseInt(process.env.CAIRN_WALL_FILES || "480", 10);
const keepRunning = process.env.CAIRN_WALL_KEEP === "1";
const tempPrefix = join(tmpdir(), "cairn-web-wall-paging-");
const buildTag = "purego";
const WALL_ROW = ".result-row";
const PAGE_LIMIT = 200;
// Three generated sources: the first two are the measured library; the third is
// published while the wall holds a cursor, which is what moves the projection
// under it.
const SOURCE_A = filesPerFolder;
const SOURCE_B = filesPerFolder;
const SOURCE_C = Math.max(1, Math.round(filesPerFolder / 2));

function require(condition, message) {
  if (!condition) throw new Error(message);
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function kb(bytes) {
  return bytes === null || bytes === undefined ? "not captured" : `${(bytes / 1024).toFixed(1)} KiB (${bytes} bytes)`;
}

/** A page input for the report: a cursor is opaque and long, so only its kind
 *  and length are printed. */
function describePageInput(page) {
  if (!page || typeof page !== "object") return "none (whole listing)";
  if (typeof page.token === "string" && page.token) return `{"token": <opaque, ${page.token.length} chars>}`;
  return JSON.stringify(page);
}

if (process.argv.includes("--help")) {
  log("usage: node scripts/web-wall-paging-check.mjs [--measure]");
  process.exit(0);
}
require(Number.isInteger(filesPerFolder) && filesPerFolder >= PAGE_LIMIT, `CAIRN_WALL_FILES must be an integer >= ${PAGE_LIMIT}, got ${JSON.stringify(process.env.CAIRN_WALL_FILES)}`);

// --- isolation preflight ------------------------------------------------------

const realDataDir = process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, "cairn") : join(homedir(), ".local", "share", "cairn");
const realSocketDir = process.env.XDG_RUNTIME_DIR ? join(process.env.XDG_RUNTIME_DIR, "cairn") : join(tmpdir(), "cairn");

function snapshotPath(path) {
  try {
    const stat = statSync(path);
    return { exists: true, mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return { exists: false };
  }
}

function describeSnapshot(snapshot) {
  return snapshot.exists ? `exists (mtime ${new Date(snapshot.mtimeMs).toISOString()}, size ${snapshot.size})` : "absent";
}

const before = { dataDir: snapshotPath(realDataDir), socketDir: snapshotPath(realSocketDir) };

const state = { temp: "", daemon: null, daemonLog: "", logStream: null, cleaning: null };

function daemonLogTail(lines = 25) {
  const trimmed = state.daemonLog.trim();
  return trimmed ? trimmed.split("\n").slice(-lines).join("\n") : "(the daemon log is empty)";
}

async function probePortFree(value) {
  require(Number.isInteger(value) && value > 0 && value < 65536, `CAIRN_WALL_PORT must be a loopback port number, got ${JSON.stringify(process.env.CAIRN_WALL_PORT)}`);
  const probe = createServer();
  try {
    await new Promise((resolveProbe, rejectProbe) => {
      probe.once("error", rejectProbe);
      probe.listen(value, "127.0.0.1", resolveProbe);
    });
  } catch (error) {
    throw new Error(`the loopback port ${value} is not available (${error?.code ?? error?.message ?? error}).\n      Stop whatever holds it, or set CAIRN_WALL_PORT to a free port.`);
  }
  await new Promise((resolveProbe, rejectProbe) => probe.close((error) => error ? rejectProbe(error) : resolveProbe()));
}

function requireHarnessPrerequisites() {
  const playwrightModule = process.env.CAIRN_PLAYWRIGHT_MODULE || join(repo, "web", "node_modules", "playwright", "index.mjs");
  if (!existsSync(playwrightModule)) {
    throw new Error(`the browser check imports Playwright from ${playwrightModule}, which does not exist.\n      Install the web toolchain first:  cd web && npm ci`);
  }
  const chrome = (process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome").trim();
  if (!existsSync(chrome)) {
    throw new Error(`the browser check launches Chrome/Chromium at ${chrome}, which does not exist.\n      Set CAIRN_PLAYWRIGHT_EXECUTABLE_PATH to a Chrome/Chromium binary.`);
  }
  const webRoot = webDistOverride ? resolve(webDistOverride) : join(repo, "web", "dist");
  require(isAbsolute(webRoot), `the WebUI root must be an absolute path, got ${webRoot}`);
  if (!existsSync(join(webRoot, "index.html"))) {
    throw new Error(`there is no built WebUI at ${webRoot}.\n      Build the client first:  cd web && npm run build\n      or set CAIRN_WEB_DIST to an absolute prebuilt WebUI root.`);
  }
  return { playwrightModule, chrome, webRoot };
}

function buildBinaries(temp) {
  for (const [override, pkg] of [[daemonOverride, "./server/cmd/cairnd"], [cliOverride, "./client/cmd/cairn"]]) {
    if (override) require(isAbsolute(override), `${pkg} override must be an absolute path, got ${JSON.stringify(override)}`);
  }
  const daemonBin = daemonOverride ? resolve(daemonOverride) : join(temp, "cairnd");
  const cliBin = cliOverride ? resolve(cliOverride) : join(temp, "cairn");
  for (const [bin, override, pkg] of [[daemonBin, daemonOverride, "./server/cmd/cairnd"], [cliBin, cliOverride, "./client/cmd/cairn"]]) {
    if (override) {
      require(existsSync(bin), `${pkg} override ${bin} does not exist`);
      continue;
    }
    const built = spawnSync("go", ["build", "-tags", buildTag, "-o", bin, pkg], { cwd: repo, stdio: "inherit" });
    if (built.error) throw new Error(`go build ${pkg} could not start: ${built.error.message}`);
    require(built.status === 0, `go build ${pkg} failed (status ${built.status})`);
  }
  return { daemonBin, cliBin };
}

function cleanup() {
  if (state.cleaning) return state.cleaning;
  state.cleaning = (async () => {
    if (state.context) {
      try { await state.context.close(); } catch { /* the browser is already gone */ }
      state.context = null;
    }
    if (keepRunning) {
      if (state.daemon && state.daemon.exitCode === null && state.daemon.signalCode === null) state.daemon.unref();
      return;
    }
    const daemon = state.daemon;
    if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
      daemon.kill("SIGTERM");
      await Promise.race([once(daemon, "exit"), new Promise((resolveWait) => setTimeout(resolveWait, 15000))]);
      if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGKILL");
    }
    if (state.logStream) {
      const closed = once(state.logStream, "close").catch(() => undefined);
      state.logStream.end();
      await Promise.race([closed, new Promise((resolveWait) => setTimeout(resolveWait, 2000))]);
      state.logStream = null;
    }
    const target = state.temp;
    if (!target) return;
    if (!target.startsWith(tempPrefix) || target === tempPrefix) throw new Error(`refusing to remove ${target}: it is not one of this script's temporary directories`);
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  })();
  return state.cleaning;
}

// --- daemon command surface ---------------------------------------------------

async function command(base, operation, input = {}, { allowFailure = false } = {}) {
  const response = await fetch(`${base}/api/v1/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, input }) });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${operation} returned a non-JSON body (HTTP ${response.status}, ${text.length} bytes)`);
  }
  const ok = body.status === "SUCCEEDED" || body.status === "DEGRADED";
  if (!ok && !allowFailure) throw new Error(`${operation} was ${body.status}: ${JSON.stringify((body.reasons ?? []).map((reason) => reason.message))}`);
  return { status: body.status, ok, data: body.data, reasons: body.reasons ?? [], bytes: Buffer.byteLength(text) };
}

async function waitForHealth(base, daemon) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    require(daemon.exitCode === null && daemon.signalCode === null, `the isolated daemon exited before its API became ready (exit ${daemon.exitCode}, signal ${daemon.signalCode})`);
    try {
      if ((await fetch(`${base}/api/v1/healthz`, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch { /* not ready yet */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`the isolated daemon did not become ready within ${timeoutMs} ms`);
}

// --- generated corpus ---------------------------------------------------------

// A real 1x1 PNG, so every fifth generated file is a genuine image the Photos
// wall renders as a card. The wall's own boundary behaviour is measured on it.
const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function generateSource(root, count, tag) {
  await mkdir(root, { recursive: true });
  const body = `cairn bounded-paging fixture\n${tag}\n`;
  const pending = [];
  for (let index = 0; index < count; index += 1) {
    const image = index % 5 === 0;
    const name = `${tag}-${String(index).padStart(5, "0")}.${image ? "png" : "txt"}`;
    pending.push(writeFile(join(root, name), image ? ONE_PIXEL_PNG : Buffer.from(`${body}${name}\n`)));
    if (pending.length >= 64) {
      await Promise.all(pending.splice(0));
    }
  }
  await Promise.all(pending);
  return root;
}

async function publishSource(base, root) {
  const planned = await command(base, "plan.ingest", { root });
  const plan = planned.data ?? {};
  require(plan.executable === true, `plan.ingest for ${root} was not executable: ${JSON.stringify(plan.blocked_entries ?? [])}`);
  const applied = await command(base, "plan.apply", { workspace_id: plan.workspace_id, plan_id: plan.plan_id, plan_digest: plan.plan_digest });
  require(["SUCCEEDED", "DEGRADED"].includes(applied.data?.state), `plan.apply for ${root} was ${applied.status}/${applied.data?.state}`);
  return { workspaceID: applied.data?.workspace_id || plan.workspace_id, files: plan.files ?? 0 };
}

// --- browser measurement ------------------------------------------------------

async function waitForRowCount(page, selector, budgetMs) {
  const deadline = Date.now() + budgetMs;
  let last = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const count = await page.evaluate((value) => document.querySelectorAll(value).length, selector);
    if (count === last && count > 0) {
      stable += 1;
      if (stable >= 4) return count;
    } else {
      stable = 0;
    }
    last = count;
    await page.waitForTimeout(500);
  }
  return last;
}

const READ_WALL = () => {
  const list = document.querySelector(".result-list");
  const progress = document.querySelector(".library-listing-progress");
  const indices = list ? [...list.querySelectorAll("[data-result-index]")].map((node) => node.dataset.resultIndex) : [];
  return {
    rows: list ? list.querySelectorAll(".result-row").length : 0,
    pending: list ? list.querySelectorAll("[data-result-pending]").length : 0,
    loaded: list?.dataset.listingCount === undefined ? null : Number(list.dataset.listingCount),
    total: list?.dataset.listingTotal === undefined ? null : Number(list.dataset.listingTotal),
    label: document.querySelector(".result-count")?.textContent?.trim() ?? "",
    progressText: progress?.textContent?.trim() ?? "",
    progressState: progress?.dataset.listingState ?? "",
    progressCompleteness: progress?.dataset.listingCompleteness ?? "",
    scrollHeight: document.documentElement.scrollHeight,
    indices,
    distinctIndices: new Set(indices).size,
  };
};

/** Scroll with real wheel input until the bottom is reached or the budget is
 *  spent, then wait for the page chain to settle. */
async function scrollToBottom(page, { steps = 120, budgetMs = 90000 } = {}) {
  const started = Date.now();
  let used = 0;
  while (used < steps && Date.now() - started < budgetMs) {
    const at = await page.evaluate(() => ({ y: window.scrollY, max: Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight) }));
    if (at.y >= at.max - 2) break;
    await page.mouse.wheel(0, 3000);
    used += 1;
    await page.waitForTimeout(40);
  }
  // The chain may still be fetching after the wheel budget ends; wait for the
  // wall's own honest state to settle (nothing pending, or an error reported).
  await page.waitForFunction(() => {
    const list = document.querySelector(".result-list");
    if (!list) return true;
    const pending = list.querySelectorAll("[data-result-pending]").length;
    const progress = document.querySelector(".library-listing-progress");
    return pending === 0 || progress?.dataset.listingState === "ERROR";
  }, undefined, { timeout: budgetMs }).catch(() => undefined);
  return { wheelSteps: used, elapsedMs: Date.now() - started };
}

/** Scroll until the mounted window reaches the end of the loaded positions.
 *
 *  The scroll length describes the whole projection, so the loaded positions
 *  end at `loaded / total` of it. The loaded count can advance between the read
 *  and the scroll (a page already in flight), so this re-reads the wall and
 *  pushes further down until the rendered window really covers the loaded edge,
 *  which is the condition the wall must react to. */
async function scrollToLoadedEdge(page, attempts = 6) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await page.evaluate(() => {
      const list = document.querySelector(".result-list");
      const max = Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight);
      return {
        y: Math.round(window.scrollY),
        max,
        loaded: Number(list?.dataset.listingCount ?? "0"),
        total: Number(list?.dataset.listingTotal ?? "0"),
        to: Number(list?.dataset.renderedTo ?? "0"),
      };
    });
    last = state;
    if (state.to >= state.loaded) return state;
    const target = Math.max(0, Math.round(state.max * (state.loaded / Math.max(1, state.total)) - 200));
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), Math.max(target, state.y + 400));
    await page.waitForTimeout(250);
  }
  return last;
}

// --- measurement run ----------------------------------------------------------

async function main() {
  const harness = requireHarnessPrerequisites();
  await probePortFree(port);

  const temp = await mkdtemp(tempPrefix);
  state.temp = temp;
  require(temp.startsWith(tempPrefix) && temp !== tempPrefix, `refusing to use temporary directory ${temp}`);

  const { daemonBin, cliBin } = buildBinaries(temp);
  const config = join(temp, "config.toml");
  const init = spawnSync(cliBin, ["config", "init", "--path", config], { cwd: temp, stdio: "ignore" });
  require(init.status === 0, `cairn config init --path ${config} failed (status ${init.status})`);

  const env = {
    ...process.env,
    CAIRN_CATALOG: join(temp, "catalog.sqlite"),
    CAIRN_REPOSITORY: join(temp, "repository"),
    CAIRN_VECTORS: join(temp, "vectors"),
    CAIRN_MODELS: join(temp, "models"),
    CAIRN_RECOVERY_RECORDS: join(temp, "recovery"),
    CAIRN_SOCKET: join(temp, "daemon.sock"),
  };
  const sourceA = await generateSource(join(temp, "source-a"), SOURCE_A, "alpha");
  const sourceB = await generateSource(join(temp, "source-b"), SOURCE_B, "bravo");
  const sourceC = await generateSource(join(temp, "source-c"), SOURCE_C, "charlie");
  const corpusBefore = { a: snapshotPath(sourceA), b: snapshotPath(sourceB), c: snapshotPath(sourceC) };

  const base = `http://127.0.0.1:${port}`;
  const daemon = spawn(daemonBin, ["--config", config, "--socket", env.CAIRN_SOCKET, "--api-listen", `127.0.0.1:${port}`, "--web-root", harness.webRoot], { cwd: temp, env, stdio: ["ignore", "pipe", "pipe"] });
  state.daemon = daemon;
  state.logStream = createWriteStream(join(temp, "daemon.log"), { flags: "a" });
  for (const stream of [daemon.stdout, daemon.stderr]) {
    stream.on("data", (chunk) => {
      const text = chunk.toString();
      state.daemonLog += text;
      if (state.logStream?.writable) state.logStream.write(text);
    });
  }
  await new Promise((resolveSpawn, rejectSpawn) => { daemon.once("spawn", resolveSpawn); daemon.once("error", rejectSpawn); });
  try {
    await waitForHealth(base, daemon);
  } catch (error) {
    throw new Error(`${error.message}\n--- isolated daemon log (tail) ---\n${daemonLogTail()}`);
  }

  log(`temporary profile      : ${temp}`);
  log(`daemon                 : ${daemonBin} (pid ${daemon.pid})`);
  log(`catalog                : ${env.CAIRN_CATALOG}`);
  log(`repository             : ${env.CAIRN_REPOSITORY}`);
  log(`web root               : ${harness.webRoot}`);
  log(`chrome                 : ${harness.chrome}`);
  log(`generated sources      : ${SOURCE_A} + ${SOURCE_B} files (source-c: ${SOURCE_C} files, published mid-chain)`);
  log("");

  const first = await publishSource(base, sourceA);
  const second = await publishSource(base, sourceB);
  const workspaceID = second.workspaceID || first.workspaceID;
  const expected = SOURCE_A + SOURCE_B;
  const listing = await command(base, "content.list", { workspace_id: workspaceID });
  require((listing.data?.items ?? []).length === expected, `the daemon reported ${(listing.data?.items ?? []).length} items, expected ${expected}`);

  // --- real Chrome ------------------------------------------------------------
  const { chromium } = await import(harness.playwrightModule);
  const context = await chromium.launchPersistentContext(join(temp, "chrome-profile"), {
    headless: true,
    executablePath: harness.chrome,
    viewport: { width: 1496, height: 900 },
    locale: "en-US",
  });
  state.context = context;
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));

  const listRequests = [];
  page.on("response", (response) => {
    let body;
    try { body = response.request().postDataJSON(); } catch { return; }
    if (body?.operation !== "content.list") return;
    const entry = { page: body?.input?.page ?? null, bytes: null };
    listRequests.push(entry);
    response.body().then((buffer) => { entry.bytes = buffer.length; }).catch(() => undefined);
  });

  const wallStarted = Date.now();
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: browserTimeoutMs });
  await page.locator(".result-list").first().waitFor({ state: "visible", timeout: browserTimeoutMs });
  await page.locator(`${WALL_ROW}`).first().waitFor({ state: "visible", timeout: browserTimeoutMs });
  const firstRowMs = Date.now() - wallStarted;
  await page.waitForFunction(() => document.querySelector(".result-list.is-windowed") !== null, undefined, { timeout: browserTimeoutMs }).catch(() => undefined);
  await waitForRowCount(page, WALL_ROW, 20000);
  const firstScreen = await page.evaluate(READ_WALL);
  const firstScreenMs = Date.now() - wallStarted;
  const requestsAtFirstScreen = listRequests.length;

  const firstScreenRequest = listRequests[0];
  const paged = Boolean(firstScreenRequest?.page && typeof firstScreenRequest.page.limit === "number");

  // --- phase 1b: the Photos wall keeps loading at its own end ------------------
  // The Photos wall projects the loaded library, so it cannot know how many of
  // its cards the unfetched pages hold: its position count is the loaded count
  // and its own last card is the page boundary. Opening it must therefore fetch
  // the next page instead of silently ending at what happened to be loaded.
  const photosBoundary = { checked: false, requests: 0, continuations: 0, imagesBefore: null, imagesAfter: null, detail: "" };
  if (paged && !measureOnly) {
    const photosButton = page.locator('.library-presentation-navigation__domain[data-domain="cairn:photos"]').first();
    // The ordinary All-types entry is the navigation's first button; it carries
    // no namespaced data-domain, so it is resolved by position.
    const allTypesButton = page.locator(".library-presentation-navigation__domain").first();
    if (await photosButton.count() > 0) {
      // The images the first page already holds (every fifth generated file is
      // an image), which is what the Photos wall starts from.
      photosBoundary.imagesBefore = Math.ceil((firstScreen.loaded ?? 0) / 5);
      const requestsBefore = listRequests.length;
      await photosButton.click();
      await page.locator(".photo-wall .photo-card").first().waitFor({ state: "visible", timeout: 20000 }).catch(() => undefined);
      try {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline && listRequests.length <= requestsBefore) await page.waitForTimeout(100);
        while (Date.now() < deadline && await page.evaluate(() => document.querySelector(".library-listing-progress")?.dataset.listingState === "LOADING")) await page.waitForTimeout(100);
        photosBoundary.checked = listRequests.length > requestsBefore;
      } catch (error) {
        photosBoundary.detail = String(error?.message ?? error);
      }
      photosBoundary.requests = listRequests.length - requestsBefore;
      photosBoundary.continuations = listRequests.slice(requestsBefore).filter((entry) => typeof entry.page?.token === "string" && entry.page.token).length;
      photosBoundary.imagesAfter = await page.evaluate(() => Number(document.querySelector(".photo-wall")?.dataset.listingCount ?? "0"));
      if (await allTypesButton.count() > 0) {
        await allTypesButton.click();
        await page.locator(".result-list").first().waitFor({ state: "visible", timeout: 20000 }).catch(() => undefined);
      } else {
        photosBoundary.detail = "this build renders no All-types navigation entry";
      }
    } else {
      photosBoundary.detail = "this build renders no Photos presentation navigation";
    }
  }

  // --- phase 2: in-flight honesty (a delayed continuation) ---------------------
  const inFlight = { checked: false, state: "", text: "", label: "", loadedDuringFlight: null, pending: 0, detail: "" };
  if (paged && !measureOnly) {
    // Holding the continuation open is what makes the in-flight state
    // observable: a fixed delay is enough and cannot race the unroute call.
    await page.route("**/api/v1/command", async (route) => {
      let body;
      try { body = route.request().postDataJSON(); } catch { body = undefined; }
      if (body?.operation === "content.list" && body?.input?.page?.token) await new Promise((resolveWait) => setTimeout(resolveWait, 5000));
      try {
        await route.continue();
      } catch { /* the request was already handled or the page went away */ }
    });
    await scrollToLoadedEdge(page);
    try {
      await page.waitForFunction(() => document.querySelector(".library-listing-progress")?.dataset.listingState === "LOADING", undefined, { timeout: 15000 });
      const during = await page.evaluate(READ_WALL);
      inFlight.checked = true;
      inFlight.state = during.progressState;
      inFlight.text = during.progressText;
      inFlight.loadedDuringFlight = during.loaded;
      inFlight.label = during.label;
      inFlight.pending = during.pending;
      inFlight.scrollHeight = during.scrollHeight;
    } catch (error) {
      inFlight.detail = String(error?.message ?? error);
    }
    await page.waitForFunction(() => document.querySelector(".library-listing-progress")?.dataset.listingState !== "LOADING", undefined, { timeout: 30000 }).catch(() => undefined);
    await page.unroute("**/api/v1/command");
  }

  // --- phase 2b: the dense list holds the pending height too -------------------
  // The tile grid keeps a pending position at the measured row height through
  // `grid-auto-rows`; the dense list is `display: block`, where an empty
  // placeholder would collapse to zero and shorten the listing. This checks the
  // height the wall itself applies there.
  const listLayout = { checked: false, realHeight: 0, pendingHeight: 0, pending: 0, detail: "" };
  if (paged && !measureOnly) {
    const listButton = page.locator('button[aria-label="List view"]').first();
    if (await listButton.count() > 0) {
      await listButton.click();
      await page.waitForFunction(() => document.querySelector(".result-list.list-mode.is-windowed") !== null, undefined, { timeout: 15000 }).catch(() => undefined);
      await page.route("**/api/v1/command", async (route) => {
        let body;
        try { body = route.request().postDataJSON(); } catch { body = undefined; }
        if (body?.operation === "content.list" && body?.input?.page?.token) await new Promise((resolveWait) => setTimeout(resolveWait, 5000));
        try { await route.continue(); } catch { /* already handled */ }
      });
      await scrollToLoadedEdge(page);
      try {
        await page.waitForFunction(() => {
          const list = document.querySelector(".result-list.list-mode");
          return Boolean(list && list.querySelectorAll("[data-result-index]").length > 0 && list.querySelectorAll("[data-result-pending]").length > 0);
        }, undefined, { timeout: 15000 });
        const heights = await page.evaluate(() => {
          const list = document.querySelector(".result-list.list-mode");
          const heightsOf = (selector) => [...list.querySelectorAll(selector)].map((node) => Math.round(node.getBoundingClientRect().height));
          return { real: heightsOf("[data-result-index]"), pending: heightsOf("[data-result-pending]") };
        });
        listLayout.checked = true;
        listLayout.realHeight = heights.real[0] ?? 0;
        listLayout.pendingHeight = heights.pending[0] ?? 0;
        listLayout.pending = heights.pending.length;
      } catch (error) {
        listLayout.detail = String(error?.message ?? error);
      }
      await page.unroute("**/api/v1/command");
    } else {
      listLayout.detail = "this build offers no list-layout control";
    }
  }

  // --- phase 3: the projection moves under the wall ---------------------------
  const moved = { published: 0, notice: "", total: null, loaded: null, detail: "" };
  let entriesAfterMove = expected;
  if (paged && !measureOnly) {
    const wallBeforeMove = await page.evaluate(READ_WALL);
    const third = await publishSource(base, sourceC);
    moved.published = third.files;
    entriesAfterMove = expected + third.files;
    // Reach the end of what is loaded so the wall asks for its next page with
    // the cursor that was minted against the previous publication.
    const moveTarget = await scrollToLoadedEdge(page);
    try {
      // Any notice on the screen may match first (a tag-status notice shares the
      // class), so the whole document is searched for the message and the
      // matching notice is read back by its own text.
      await page.waitForFunction(() => /changed while you were browsing/i.test(document.body.innerText), undefined, { timeout: 30000 });
      moved.notice = await page.evaluate(() => [...document.querySelectorAll(".notice")].map((node) => node.textContent ?? "").find((text) => /changed while you were browsing/i.test(text)) ?? "");
      // The restart is a fresh first page of the new projection: wait for its
      // exact total to be adopted before reading what the wall now holds.
      await page.waitForFunction((total) => Number(document.querySelector(".result-list")?.dataset.listingTotal) === total, entriesAfterMove, { timeout: 20000 }).catch(() => undefined);
    } catch (error) {
      moved.detail = `${String(error?.message ?? error)} | reached=${JSON.stringify(moveTarget)} before=${JSON.stringify({ loaded: wallBeforeMove.loaded, total: wallBeforeMove.total })}`;
    }
    const afterMove = await page.evaluate(READ_WALL);
    moved.total = afterMove.total;
    moved.loaded = afterMove.loaded;
    moved.indices = afterMove.indices;
    moved.distinctIndices = afterMove.distinctIndices;
    moved.pending = afterMove.pending;
  }

  // --- phase 4: every entry stays reachable -----------------------------------
  const beforeScroll = await page.evaluate(READ_WALL);
  const scroll = await scrollToBottom(page);
  const settled = await page.evaluate(READ_WALL);
  const afterAll = await page.evaluate(READ_WALL);
  // The first-screen scroll length is only comparable to a scroll length
  // measured in the same layout: the dense list and the tile grid measure
  // different row heights. The wall is returned to the tile grid for the
  // reference model of the finished projection.
  let finalGridHeight = null;
  {
    const gridButton = page.locator('button[aria-label="Grid view"]').first();
    if (await gridButton.count() > 0) {
      await gridButton.click();
      await page.waitForFunction(() => document.querySelector(".result-list:not(.list-mode)") !== null, undefined, { timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(600);
      finalGridHeight = (await page.evaluate(READ_WALL)).scrollHeight;
    }
  }
  const gridReferenceHeight = finalGridHeight ?? afterAll.scrollHeight;
  const expectedScrollShare = entriesAfterMove > 0 ? expected / entriesAfterMove : 1;
  const firstScreenShare = gridReferenceHeight > 0 ? firstScreen.scrollHeight / gridReferenceHeight : 0;
  const finalRequests = listRequests.slice();
  const requestSummary = finalRequests.map((entry, index) => `#${index + 1} ${describePageInput(entry.page)} -> ${kb(entry.bytes)}`);
  const totalRequestBytes = finalRequests.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);

  const afterRun = { dataDir: snapshotPath(realDataDir), socketDir: snapshotPath(realSocketDir) };
  const dataUntouched = JSON.stringify(before.dataDir) === JSON.stringify(afterRun.dataDir);
  const socketUntouched = JSON.stringify(before.socketDir) === JSON.stringify(afterRun.socketDir);
  const corpusAfter = { a: snapshotPath(sourceA), b: snapshotPath(sourceB), c: snapshotPath(sourceC) };
  const corpusUntouched = JSON.stringify(corpusBefore) === JSON.stringify(corpusAfter);

  // --- report -----------------------------------------------------------------
  const failures = [];
  const lines = [];
  lines.push("");
  lines.push(`cairn wall bounded-paging measurement (real Chrome)${measureOnly ? " [measure only]" : ""}`);
  lines.push(`  generated entries                 : ${expected} (then ${entriesAfterMove} after the mid-chain publication)`);
  lines.push(`  whole listing, one request        : ${kb(listing.bytes)}`);
  lines.push("");
  lines.push("1. the first screen");
  lines.push(`   first result row visible after    : ${firstRowMs} ms`);
  lines.push(`   wall settled after                : ${firstScreenMs} ms`);
  lines.push(`   content.list requests so far      : ${requestsAtFirstScreen}`);
  lines.push(`   first request page input          : ${describePageInput(firstScreenRequest?.page)}`);
  lines.push(`   first response                    : ${kb(firstScreenRequest?.bytes)}`);
  lines.push(`   rows in the DOM                   : ${firstScreen.rows}`);
  lines.push(`   pending positions in the DOM      : ${firstScreen.pending}`);
  lines.push(`   data-listing-count (loaded)       : ${firstScreen.loaded}`);
  lines.push(`   data-listing-total (exact total)  : ${firstScreen.total}`);
  lines.push(`   count label                       : ${JSON.stringify(firstScreen.label)}`);
  lines.push(`   scroll height at the first screen : ${firstScreen.scrollHeight} px`);
  lines.push(`   ... of the finished grid model    : ${gridReferenceHeight} px = ${(firstScreenShare * 100).toFixed(1)}% (the whole ${expected}-entry projection is ${(expectedScrollShare * 100).toFixed(1)}% of ${entriesAfterMove})`);
  lines.push("");
  lines.push("1b. the Photos wall at its own boundary");
  lines.push(`   photos wall, requests on open       : ${photosBoundary.checked ? `${photosBoundary.requests} (${photosBoundary.continuations} with a cursor)` : `none observed${photosBoundary.detail ? ` (${photosBoundary.detail})` : " (not a paged client)"}`}`);
  lines.push(`   photo cards on the loaded listing   : ${photosBoundary.imagesBefore} -> ${photosBoundary.imagesAfter}`);
  lines.push("");
  lines.push("2. a page in flight");
  lines.push(`   surface said                            : ${inFlight.checked ? `${JSON.stringify(inFlight.state)} ${JSON.stringify(inFlight.text)}` : `not observed${inFlight.detail ? ` (${inFlight.detail})` : " (not a paged client)"}`}`);
  lines.push(`   count label while in flight              : ${inFlight.checked ? JSON.stringify(inFlight.label) : "not measured"}`);
  lines.push(`   pending positions while in flight        : ${inFlight.checked ? inFlight.pending : "not measured"}`);
  lines.push(`   dense list: real row / pending height    : ${listLayout.checked ? `${listLayout.realHeight} px / ${listLayout.pendingHeight} px (${listLayout.pending} pending)` : `not measured${listLayout.detail ? ` (${listLayout.detail})` : " (not a paged client)"}`}`);
  lines.push("");
  lines.push("3. the published projection moves under the wall");
  lines.push(`   mid-chain publication             : ${moved.published} entries`);
  lines.push(`   surface said                      : ${moved.notice ? JSON.stringify(moved.notice.trim()) : `not observed${moved.detail ? ` (${moved.detail})` : " (not a paged client)"}`}`);
  lines.push(`   after the restart: loaded / total : ${moved.loaded} / ${moved.total}`);
  lines.push(`   rows from two generations blended : ${moved.indices ? (moved.distinctIndices === moved.indices.length ? "NO (every row position appears once)" : "YES") : "not measured"}`);
  lines.push("");
  lines.push("4. reaching the end");
  lines.push(`   wheel steps / elapsed             : ${scroll.wheelSteps} / ${scroll.elapsedMs} ms`);
  lines.push(`   scroll height before / after      : ${beforeScroll.scrollHeight} px / ${afterAll.scrollHeight} px`);
  lines.push(`   rows in the DOM when settled      : ${settled.rows}`);
  lines.push(`   pending positions left            : ${afterAll.pending}`);
  lines.push(`   loaded / exact total              : ${afterAll.loaded} / ${afterAll.total}`);
  lines.push(`   distinct row positions in the DOM : ${afterAll.distinctIndices} of ${afterAll.indices.length}`);
  lines.push("");
  lines.push("5. content.list requests the wall issued");
  for (const line of requestSummary) lines.push(`   ${line}`);
  lines.push(`   total bytes                       : ${kb(totalRequestBytes)}`);
  lines.push("");
  lines.push("6. isolation and cleanup input");
  lines.push(`   operator data dir (${realDataDir}): before ${describeSnapshot(before.dataDir)}, after ${describeSnapshot(afterRun.dataDir)} — ${dataUntouched ? "UNTOUCHED" : "CHANGED"}`);
  lines.push(`   default socket dir (${realSocketDir}): before ${describeSnapshot(before.socketDir)}, after ${describeSnapshot(afterRun.socketDir)} — ${socketUntouched ? "UNTOUCHED" : "CHANGED"}`);
  lines.push(`   generated source folders          : ${corpusUntouched ? "UNTOUCHED (mtime and size unchanged)" : "CHANGED"}`);
  log(lines.join("\n"));

  if (!dataUntouched) failures.push(`the operator's real data directory changed: ${realDataDir}`);
  if (!socketUntouched) failures.push(`the default socket directory changed: ${realSocketDir}`);
  if (!corpusUntouched) failures.push("a generated source folder was modified");
  for (const error of pageErrors) failures.push(`the page raised an uncaught error: ${error}`);

  if (!measureOnly) {
    if (!paged) failures.push("the client asked content.list for the whole listing instead of a bounded page");
    else if (firstScreenRequest.page.limit !== PAGE_LIMIT) failures.push(`the first page limit was ${firstScreenRequest.page.limit}, expected ${PAGE_LIMIT}`);
    if (firstScreen.loaded !== PAGE_LIMIT) failures.push(`the first screen loaded ${firstScreen.loaded} entries, expected one page of ${PAGE_LIMIT}`);
    if (firstScreen.total !== expected) failures.push(`the count total was ${firstScreen.total}, expected the exact ${expected}`);
    if (!/^\d[\d,.]*\s+items$/i.test(firstScreen.label) || !firstScreen.label.includes(String(expected))) failures.push(`the count label ${JSON.stringify(firstScreen.label)} does not report the exact total ${expected}`);
    if (firstScreen.loaded >= firstScreen.total) failures.push("the first answer already claimed the whole collection");
    if (typeof firstScreenRequest.bytes === "number" && firstScreenRequest.bytes >= listing.bytes / 3) failures.push(`the first page was ${firstScreenRequest.bytes} bytes of the whole listing's ${listing.bytes}; it is not a bounded page`);
    // The scroll length must describe the whole projection from the first
    // answer. A spacer sized from the loaded page would be a small fraction of
    // the finished model; the whole projection's share is what it must be.
    if (Math.abs(firstScreenShare - expectedScrollShare) > 0.15) failures.push(`the first screen's scroll length ${firstScreen.scrollHeight} px is ${(firstScreenShare * 100).toFixed(1)}% of the finished grid model, expected about ${(expectedScrollShare * 100).toFixed(1)}%`);
    if (requestsAtFirstScreen !== 1) failures.push(`the first screen issued ${requestsAtFirstScreen} content.list requests, expected exactly one bounded page`);
    if (!inFlight.checked) failures.push(`the surface never reported a page in flight: ${inFlight.detail || "no LOADING state was observed"}`);
    else {
      if (!/loading more items/i.test(inFlight.text)) failures.push(`the in-flight message ${JSON.stringify(inFlight.text)} does not say a page is loading`);
      if (!(inFlight.pending > 0)) failures.push("no pending position was held open while the page was in flight");
      if (!inFlight.label.includes(String(expected))) failures.push(`the count label ${JSON.stringify(inFlight.label)} stopped reporting the exact total ${expected} while a page was in flight`);
    }
    if (!listLayout.checked) failures.push(`the dense list placement of a pending position was not observed: ${listLayout.detail || "no mixed window was rendered"}`);
    else if (Math.abs(listLayout.pendingHeight - listLayout.realHeight) > 1) failures.push(`a pending position kept ${listLayout.pendingHeight} px in the dense list instead of the row height ${listLayout.realHeight} px`);
    if (!photosBoundary.checked) failures.push(`the Photos wall did not fetch the next page at its own end: ${photosBoundary.detail || "no continuation was issued"}`);
    else if (photosBoundary.continuations < 1) failures.push("the Photos wall's next-page request did not carry a cursor");
    if (!(photosBoundary.imagesAfter > photosBoundary.imagesBefore)) failures.push(`opening the Photos wall did not grow its loaded card count (${photosBoundary.imagesBefore} -> ${photosBoundary.imagesAfter})`);
    if (!moved.notice) failures.push(`the moved projection was not reported: ${moved.detail || "no notice appeared"}`);
    else if (!/changed while you were browsing/i.test(moved.notice)) failures.push(`the notice ${JSON.stringify(moved.notice)} does not say the library changed`);
    if (moved.total !== entriesAfterMove) failures.push(`after the restart the exact total was ${moved.total}, expected ${entriesAfterMove}`);
    if (moved.loaded !== null && moved.loaded > entriesAfterMove) failures.push(`after the restart ${moved.loaded} entries were loaded for a ${entriesAfterMove}-entry projection (rows from two generations were blended)`);
    if (moved.indices && moved.distinctIndices !== moved.indices.length) failures.push("two rows shared one position after the restart");
    if (afterAll.pending !== 0) failures.push(`${afterAll.pending} positions were still pending after scrolling to the end`);
    if (afterAll.loaded !== entriesAfterMove || afterAll.total !== entriesAfterMove) failures.push(`scrolling to the end loaded ${afterAll.loaded} of ${afterAll.total}, expected every one of the ${entriesAfterMove} entries`);
    if (afterAll.distinctIndices !== afterAll.indices.length) failures.push("the final window held duplicate row positions");
    if (finalRequests.length < 2) failures.push("the wall never asked for a second page");
    // Every request is either a bounded first page (`limit`) or the
    // continuation of one (`token`), never both and never neither.
    for (const [index, entry] of finalRequests.entries()) {
      const hasLimit = typeof entry.page?.limit === "number";
      const hasToken = typeof entry.page?.token === "string" && entry.page.token.length > 0;
      if (hasLimit === hasToken) failures.push(`content.list request #${index + 1} carried ${hasLimit ? "both a limit and a cursor" : "neither a limit nor a cursor"}: ${JSON.stringify(entry.page)}`);
    }
    if (!finalRequests.some((entry) => typeof entry.page?.token === "string" && entry.page.token.length > 0)) failures.push("no continuation request was ever issued");
    if (finalRequests[0]?.page?.limit !== PAGE_LIMIT) failures.push(`the first request was not the bounded first page: ${JSON.stringify(finalRequests[0]?.page)}`);
  } else {
    log("");
    log("--measure: the numbers above are reported without the paging assertions.");
  }

  if (failures.length > 0) {
    log("");
    log("FAIL:");
    for (const failure of failures) log(`  - ${failure}`);
  } else if (!measureOnly) {
    log("");
    log("PASS: the first screen came from one bounded page, the exact total kept the label and the scroll length honest,");
    log("      every entry stayed reachable, and a moved projection restarted the chain without blending generations.");
  }

  return { failures, temp, daemon, entriesAfterMove };
}

// --- entry point --------------------------------------------------------------

// A failure anywhere — including one raised inside a Playwright route handler,
// which would otherwise be an unhandled rejection — must still stop the daemon
// and remove the temporary profile.
for (const event of ["uncaughtException", "unhandledRejection"]) {
  process.on(event, (error) => {
    console.error(`FAIL: ${event}: ${error instanceof Error ? error.message : String(error)}`);
    void cleanup().finally(() => process.exit(1));
  });
}

let outcome;
try {
  outcome = await main();
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  try { await cleanup(); } catch { /* reported below */ }
  process.exit(1);
}

const shutdown = (code, label) => {
  state.stopping = true;
  void cleanup().then(() => process.exit(code)).catch((error) => {
    console.error(`FAIL: ${label}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
};

if (keepRunning) {
  log("");
  log(`CAIRN_WALL_KEEP=1: the daemon stays up and the temporary profile is kept.`);
  log(`  stop it with  : kill ${outcome.daemon?.pid ?? "<pid>"}`);
  log(`  remove it with: rm -rf ${outcome.temp}`);
  await cleanup();
  process.exit(outcome.failures.length > 0 ? 1 : 0);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { log(`received ${signal}; stopping the daemon and removing the temporary profile`); shutdown(outcome.failures.length > 0 ? 1 : 0, `cleanup after ${signal}`); });
}

const exitCode = outcome.failures.length > 0 ? 1 : 0;
const daemon = outcome.daemon;
await cleanup();
const daemonStopped = Boolean(daemon && (daemon.exitCode !== null || daemon.signalCode !== null));
const tempRemoved = !existsSync(outcome.temp);
log("");
log(`   daemon stopped: ${daemonStopped ? "yes" : "NO"}; temporary profile removed: ${tempRemoved ? "yes" : "NO"} (${outcome.temp})`);
if (!daemonStopped || !tempRemoved) {
  console.error("FAIL: cleanup did not stop the daemon and remove the temporary profile");
  process.exit(1);
}
process.exit(exitCode);
