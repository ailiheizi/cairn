// Per-command breakdown of the browser client's startup sequence.
//
// The large-library harness (`web-large-library-check.mjs`) prints one wall-load
// number for a real library but does not say which command spends the time. This
// script measures the client's own startup command sequence instead: every
// `/api/v1/command` the page issues while the first screen is being built, in
// the order the page issued it, with its wall time and its response size.
//
// It prints numbers. It is measurement evidence, not a shipped capability and
// not release qualification.
//
// Usage:
//   node scripts/web-startup-breakdown.mjs <image-folder> [--reuse <profile-dir>] [--keep] [--label <text>]
//
//   <image-folder>   one real image folder, opened read-only. Its immediate
//                    subfolders are ingested as separate sources, exactly like
//                    the large-library harness. No file name from it is printed.
//   --reuse <dir>    reuse a profile directory a previous run kept with
//                    `--keep` instead of ingesting again. Its catalog,
//                    repository, vectors, models and recovery directory are
//                    reused verbatim, so a before/after comparison runs against
//                    the same library.
//   --keep           leave the daemon running and keep the profile afterwards.
//   --label <text>   a label printed with the report (e.g. "before" / "after").
//
// Environment:
//   CAIRN_DAEMON_BIN / CAIRN_BIN        absolute prebuilt binaries
//   CAIRN_WEB_DIST                      prebuilt WebUI root (default web/dist)
//   CAIRN_STARTUP_PORT                  loopback API port (default 4661)
//   CAIRN_STARTUP_TIMEOUT_MS            daemon readiness and ingest budget
//   CAIRN_STARTUP_BROWSER_TIMEOUT_MS    browser measurement budget
//   CAIRN_STARTUP_SAMPLES               direct per-command samples (default 3)
//
// A missing prerequisite fails loudly. Nothing here skips silently.

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const daemonOverride = (process.env.CAIRN_DAEMON_BIN || "").trim();
const cliOverride = (process.env.CAIRN_BIN || "").trim();
const webDistOverride = (process.env.CAIRN_WEB_DIST || "").trim();
const port = Number.parseInt(process.env.CAIRN_STARTUP_PORT || "4661", 10);
const timeoutMs = Number.parseInt(process.env.CAIRN_STARTUP_TIMEOUT_MS || "1800000", 10);
const browserTimeoutMs = Number.parseInt(process.env.CAIRN_STARTUP_BROWSER_TIMEOUT_MS || "900000", 10);
const samples = Math.max(1, Number.parseInt(process.env.CAIRN_STARTUP_SAMPLES || "3", 10));
const tempPrefix = join(tmpdir(), "cairn-web-startup-");
const buildTag = "purego";
const WALL_ROW = ".result-row";

// The startup sequence the shell issues before the first screen is usable,
// in the order `refresh()` composes it. `content.list` is the listing page
// itself; it is the one command the first screen genuinely needs.
const STARTUP_SEQUENCE = [
  { operation: "status.get", input: {} },
  { operation: "capability.list", input: {} },
  { operation: "snapshot.list", input: {} },
];

function require(condition, message) {
  if (!condition) throw new Error(message);
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function mb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

// --- arguments ----------------------------------------------------------------

const argv = process.argv.slice(2);
function flagValue(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : "";
}
const keepRunning = argv.includes("--keep");
const label = flagValue("--label") || "measurement";
const reuseDir = flagValue("--reuse");
const positional = argv.filter((value, index) => !value.startsWith("--") && argv[index - 1] !== "--reuse" && argv[index - 1] !== "--label");
if (argv.includes("--help") || positional.length === 0) {
  log("usage: node scripts/web-startup-breakdown.mjs <image-folder> [--reuse <profile-dir>] [--keep] [--label <text>]");
  process.exit(positional.length === 0 && !argv.includes("--help") ? 2 : 0);
}
const folder = resolve(positional[0]);
require(existsSync(folder) && statSync(folder).isDirectory(), `the argument must be an existing directory, got ${JSON.stringify(positional[0])}`);

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

// --- temporary profile --------------------------------------------------------

const state = { temp: "", ownsProfile: true, daemon: null, daemonLog: "", logStream: null, cleaning: null, context: null, chromeProfile: "" };

function daemonLogTail(lines = 25) {
  const trimmed = state.daemonLog.trim();
  return trimmed ? trimmed.split("\n").slice(-lines).join("\n") : "(the daemon log is empty)";
}

async function probePortFree(value) {
  require(Number.isInteger(value) && value > 0 && value < 65536, `CAIRN_STARTUP_PORT must be a loopback port number, got ${JSON.stringify(process.env.CAIRN_STARTUP_PORT)}`);
  const probe = createServer();
  try {
    await new Promise((resolveProbe, rejectProbe) => {
      probe.once("error", rejectProbe);
      probe.listen(value, "127.0.0.1", resolveProbe);
    });
  } catch (error) {
    throw new Error(`the loopback port ${value} is not available (${error?.code ?? error?.message ?? error}).\n      Stop whatever holds it, or set CAIRN_STARTUP_PORT to a free port.`);
  }
  await new Promise((resolveProbe, rejectProbe) => probe.close((error) => error ? rejectProbe(error) : resolveProbe()));
}

function requireHarnessPrerequisites() {
  const playwrightModule = process.env.CAIRN_PLAYWRIGHT_MODULE || join(repo, "web", "node_modules", "playwright", "index.mjs");
  if (!existsSync(playwrightModule)) {
    throw new Error(`the browser harness imports Playwright from ${playwrightModule}, which does not exist.\n      Install the web toolchain first:  cd web && npm ci`);
  }
  const chrome = (process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome").trim();
  if (!existsSync(chrome)) {
    throw new Error(`the browser harness launches Chrome/Chromium at ${chrome}, which does not exist.\n      Set CAIRN_PLAYWRIGHT_EXECUTABLE_PATH to a Chrome/Chromium binary before running it.`);
  }
  const webRoot = webDistOverride ? resolve(webDistOverride) : join(repo, "web", "dist");
  require(isAbsolute(webRoot), `the WebUI root must be an absolute path, got ${webRoot}`);
  if (!existsSync(join(webRoot, "index.html"))) {
    throw new Error(`there is no built WebUI at ${webRoot}.\n      Build the client first:  cd web && npm ci && npm run build`);
  }
  return { playwrightModule, chrome, webRoot };
}

function buildBinaries(temp) {
  const daemonBin = daemonOverride ? resolve(daemonOverride) : join(temp, "cairnd");
  const cliBin = cliOverride ? resolve(cliOverride) : join(temp, "cairn");
  // A reused profile already has its binaries for the ingest half, but the
  // daemon always comes from the current tree so a fix is actually exercised.
  if (daemonOverride) {
    require(existsSync(daemonBin), `CAIRN_DAEMON_BIN ${daemonBin} does not exist`);
  } else {
    const built = spawnSync("go", ["build", "-tags", buildTag, "-o", daemonBin, "./server/cmd/cairnd"], { cwd: repo, stdio: "inherit" });
    require(built.status === 0, `go build ./server/cmd/cairnd failed (status ${built.status})`);
  }
  if (cliOverride) {
    require(existsSync(cliBin), `CAIRN_BIN ${cliBin} does not exist`);
  } else if (!existsSync(cliBin)) {
    const built = spawnSync("go", ["build", "-tags", buildTag, "-o", cliBin, "./client/cmd/cairn"], { cwd: repo, stdio: "inherit" });
    require(built.status === 0, `go build ./client/cmd/cairn failed (status ${built.status})`);
  }
  return { daemonBin, cliBin };
}

function cleanup() {
  if (state.cleaning) return state.cleaning;
  state.cleaning = (async () => {
    if (state.context) {
      try { await state.context.close(); } catch { /* already gone */ }
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
    const chromeProfile = state.chromeProfile;
    if (chromeProfile && chromeProfile.startsWith(join(tmpdir(), "cairn-startup-chrome-"))) {
      await rm(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
      state.chromeProfile = "";
    }
    // A reused profile belongs to the caller, not to this run: a failure while
    // measuring it must never delete the library it was pointed at.
    if (!state.ownsProfile) return;
    const target = state.temp;
    if (!target) return;
    if (!target.startsWith(tempPrefix) || target === tempPrefix) {
      throw new Error(`refusing to remove ${target}: it is not one of this script's temporary directories`);
    }
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  })();
  return state.cleaning;
}

// --- daemon command surface ---------------------------------------------------

async function command(base, operation, input = {}, { allowFailure = false } = {}) {
  const response = await fetch(`${base}/api/v1/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, input }),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${operation} returned a non-JSON body (HTTP ${response.status}, ${text.length} bytes)`); }
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

// --- ingest (identical shape to web-large-library-check.mjs) -------------------

async function immediateSubfolders(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => join(root, entry.name)).sort();
}

async function countRegularFiles(root) {
  let files = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files += 1;
    }
  }
  return files;
}

async function ingestLibrary(base, root) {
  const subfolders = await immediateSubfolders(root);
  const applied = [];
  const skipped = [];
  const failed = [];
  let workspaceID = "";
  for (const subfolder of subfolders) {
    const name = basename(subfolder);
    const filesOnDisk = await countRegularFiles(subfolder);
    if (filesOnDisk === 0) { skipped.push({ name, files: 0, reason: "empty" }); continue; }
    const planned = await command(base, "plan.ingest", { root: subfolder }, { allowFailure: true });
    if (!planned.ok) {
      const reason = planned.reasons.map((item) => item.message ?? "").join("; ");
      skipped.push({ name, files: filesOnDisk, reason });
      log(`  skipped ${name} (${filesOnDisk} files): ${reason}`);
      continue;
    }
    const plan = planned.data ?? {};
    require(plan.executable === true, `plan.ingest for ${name} was not executable: ${JSON.stringify(plan.blocked_entries ?? [])}`);
    workspaceID = plan.workspace_id || workspaceID;
    const appliedResult = await command(base, "plan.apply", { workspace_id: plan.workspace_id, plan_id: plan.plan_id, plan_digest: plan.plan_digest }, { allowFailure: true });
    const appliedData = appliedResult.data ?? {};
    if (!appliedResult.ok || !["SUCCEEDED", "DEGRADED"].includes(appliedData.state)) {
      failed.push({ name, detail: `${appliedResult.status}/${appliedData.state}` });
      log(`  FAILED ${name}: ${appliedResult.status}/${appliedData.state}`);
      continue;
    }
    workspaceID = appliedData.workspace_id || plan.workspace_id || workspaceID;
    applied.push({ name, files: plan.files ?? 0 });
    log(`  published ${name} — ${plan.files ?? 0} files, ${appliedData.state}`);
  }
  return { workspaceID, subfolders: subfolders.length, applied, skipped, failed };
}

// --- browser instrumentation --------------------------------------------------

const INIT_SCRIPT = `
  window.__cairnStartup = [];
  window.__cairnStartupStart = performance.now();
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const entry = { kind: "other", operation: "", url };
    if (url.endsWith("/api/v1/command")) {
      entry.kind = "command";
      try { entry.operation = JSON.parse((init && init.body) || "{}").operation || ""; } catch (error) { entry.operation = "(unreadable)"; }
    } else if (url.endsWith("/api/v1/healthz")) {
      entry.kind = "health";
    }
    const queuedAt = performance.now();
    const response = await originalFetch(input, init);
    const settledAt = performance.now();
    entry.queuedMs = queuedAt - window.__cairnStartupStart;
    entry.headersMs = settledAt - queuedAt;
    entry.settledMs = settledAt - window.__cairnStartupStart;
    entry.status = response.status;
    entry.bytes = null;
    entry.bodyMs = null;
    // Read the body off a clone so the app is never made to wait for the
    // measurement. bytes/bodyMs fill in asynchronously.
    try {
      const clone = response.clone();
      const bodyStarted = performance.now();
      clone.arrayBuffer().then((buffer) => {
        entry.bytes = buffer.byteLength;
        entry.bodyMs = performance.now() - bodyStarted;
      }).catch(() => { entry.bytes = -1; });
    } catch (error) { entry.bytes = -1; }
    window.__cairnStartup.push(entry);
    return response;
  };
`;

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

function summarise(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)];
  return { min: sorted[0], median: middle, max: sorted[sorted.length - 1] };
}

// --- measurement --------------------------------------------------------------

async function main() {
  const harness = requireHarnessPrerequisites();
  await probePortFree(port);

  let workspaceID = "";
  let reuse = false;
  if (reuseDir) {
    const reused = resolve(reuseDir);
    require(reused.startsWith(tempPrefix) && reused !== tempPrefix, `refusing to reuse ${reused}: it is not one of this script's temporary directories`);
    require(existsSync(join(reused, "catalog.sqlite")), `the reuse directory ${reused} holds no catalog.sqlite`);
    state.temp = reused;
    reuse = true;
    state.ownsProfile = false;
  } else {
    const subfolders = await immediateSubfolders(folder);
    require(subfolders.length > 0, `the argument folder has no immediate subfolders to ingest: ${folder}`);
    state.temp = await mkdtemp(tempPrefix);
    require(state.temp.startsWith(tempPrefix) && state.temp !== tempPrefix, `refusing to use temporary directory ${state.temp}`);
  }

  const { daemonBin, cliBin } = buildBinaries(state.temp);
  const config = join(state.temp, "config.toml");
  if (!reuse) {
    const init = spawnSync(cliBin, ["config", "init", "--path", config], { cwd: state.temp, stdio: "ignore" });
    require(init.status === 0, `cairn config init --path ${config} failed (status ${init.status})`);
  }

  const env = {
    ...process.env,
    CAIRN_CATALOG: join(state.temp, "catalog.sqlite"),
    CAIRN_REPOSITORY: join(state.temp, "repository"),
    CAIRN_VECTORS: join(state.temp, "vectors"),
    CAIRN_MODELS: join(state.temp, "models"),
    CAIRN_RECOVERY_RECORDS: join(state.temp, "recovery"),
    CAIRN_SOCKET: join(state.temp, "daemon.sock"),
  };
  const base = `http://127.0.0.1:${port}`;
  const daemon = spawn(daemonBin, ["--config", config, "--socket", env.CAIRN_SOCKET, "--api-listen", `127.0.0.1:${port}`, "--web-root", harness.webRoot], { cwd: state.temp, env, stdio: ["ignore", "pipe", "pipe"] });
  state.daemon = daemon;
  state.logStream = createWriteStream(join(state.temp, "daemon-breakingdown.log"), { flags: "a" });
  for (const stream of [daemon.stdout, daemon.stderr]) {
    stream.on("data", (chunk) => { state.daemonLog += chunk.toString(); if (state.logStream?.writable) state.logStream.write(chunk.toString()); });
  }
  await new Promise((resolveSpawn, rejectSpawn) => { daemon.once("spawn", resolveSpawn); daemon.once("error", rejectSpawn); });
  try {
    await waitForHealth(base, daemon);
  } catch (error) {
    throw new Error(`${error.message}\n--- isolated daemon log (tail) ---\n${daemonLogTail()}`);
  }

  let library = { workspaceID: "", subfolders: 0, applied: [], skipped: [], failed: [] };
  let ingestMs = 0;
  if (!reuse) {
    log(`ingesting the argument folder's immediate subfolders as separate sources...`);
    const started = Date.now();
    library = await ingestLibrary(base, folder);
    ingestMs = Date.now() - started;
    require(library.workspaceID, "no ingest publication produced a workspace id");
    require(library.failed.length === 0, `ingest failed for ${library.failed.length} subfolder(s): ${library.failed.map((item) => item.detail).join("; ")}`);
  } else {
    const plans = await command(base, "status.get", {});
    workspaceID = plans.data?.recent_plans?.[0]?.workspace_id ?? "";
    if (!workspaceID) {
      const snapshots = await command(base, "snapshot.list", {});
      workspaceID = snapshots.data?.snapshots?.at(-1)?.workspace_id ?? "";
    }
  }
  if (!workspaceID) workspaceID = library.workspaceID;
  require(workspaceID, "no workspace id could be resolved for the loaded library");

  const listing = await command(base, "content.list", { workspace_id: workspaceID, page: { limit: 200 } });
  const items = listing.data?.items ?? [];
  const total = listing.data?.page?.entries ?? items.length;
  const publications = (await command(base, "status.get", {})).data?.publications ?? 0;

  log("");
  log(`profile                : ${state.temp}${reuse ? " (reused)" : ""}`);
  log(`workspace              : ${workspaceID}`);
  log(`library                : ${total} entries reported by content.list (page 1: ${items.length})`);
  log(`publications           : ${publications}`);
  if (!reuse) log(`ingest                 : ${library.applied.length} published, ${library.skipped.length} skipped, ${ingestMs} ms`);

  // --- direct per-command timings, one at a time ------------------------------
  const direct = [];
  const sequence = [
    ...STARTUP_SEQUENCE,
    { operation: "snapshot.list", label: "snapshot.list[identity]", input: { projection: "identity" } },
    { operation: "snapshot.list", label: "snapshot.list[latest]", input: { projection: "latest" } },
    { operation: "source.list", input: { workspace_id: workspaceID } },
    { operation: "content.list", input: { workspace_id: workspaceID, page: { limit: 200 } } },
    { operation: "annotation.list", input: { workspace_id: workspaceID } },
    { operation: "audio.list", input: { workspace_id: workspaceID } },
    { operation: "job.list", input: { workspace_id: workspaceID } },
  ];
  log("");
  log(`direct per-command measurements (${samples} samples each, sequential, no browser):`);
  for (const step of sequence) {
    const times = [];
    let bytes = 0;
    for (let index = 0; index < samples + 1; index += 1) {
      const started = Date.now();
      const result = await command(base, step.operation, step.input, { allowFailure: true });
      const elapsed = Date.now() - started;
      bytes = result.bytes;
      if (index > 0) times.push(elapsed);
    }
    const summary = summarise(times);
    const label = step.label ?? step.operation;
    direct.push({ operation: label, bytes, ...summary, samples: times.length });
    log(`  ${label.padEnd(26)} min ${String(summary.min).padStart(6)} ms  median ${String(summary.median).padStart(6)} ms  max ${String(summary.max).padStart(6)} ms  ${String(bytes).padStart(9)} bytes`);
  }

  // --- the client's own startup sequence, in the browser ----------------------
  const { chromium } = await import(harness.playwrightModule);
  // A fresh browser profile every run. A persistent one carries the previous
  // run's localStorage — including `cairn.workspace_id` — which changes what the
  // client requests before its first frame and makes two runs incomparable.
  const profileDir = await mkdtemp(join(tmpdir(), "cairn-startup-chrome-"));
  state.chromeProfile = profileDir;
  const context = await chromium.launchPersistentContext(profileDir, { headless: true, executablePath: harness.chrome, viewport: { width: 1496, height: 900 }, locale: "en-US" });
  state.context = context;
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));

  log("");
  log("browser: loading the client and waiting for the first screen...");
  const wallStarted = Date.now();
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: browserTimeoutMs });
  await page.locator(".result-list").first().waitFor({ state: "visible", timeout: browserTimeoutMs });
  const wallRows = await waitForRowCount(page, WALL_ROW, browserTimeoutMs);
  const wallLoadMs = Date.now() - wallStarted;
  // Let the asynchronous body reads finish before reading the records.
  await page.waitForTimeout(1500);
  const records = await page.evaluate(() => window.__cairnStartup);
  const countLabel = await page.locator(".result-count").first().innerText().catch(() => "");

  const commands = records.filter((entry) => entry.kind === "command");
  log("");
  log(`browser: ${wallRows} rows in ${wallLoadMs} ms; ${commands.length} command requests while the first screen was built`);
  log("");
  log("the client's own startup sequence, in issue order:");
  for (const entry of commands) {
    log(`  +${String(Math.round(entry.queuedMs)).padStart(6)} ms  ${String(entry.operation).padEnd(18)} headers ${String(Math.round(entry.headersMs)).padStart(6)} ms  settled +${String(Math.round(entry.settledMs)).padStart(6)} ms  ${entry.bytes === null ? "bytes pending" : `${String(entry.bytes).padStart(9)} bytes (body ${Math.round(entry.bodyMs ?? 0)} ms)`}`);
  }
  const totals = {};
  for (const entry of commands) {
    totals[entry.operation] = totals[entry.operation] ?? { count: 0, headersMs: 0, bytes: 0 };
    totals[entry.operation].count += 1;
    totals[entry.operation].headersMs += entry.headersMs;
    totals[entry.operation].bytes += entry.bytes ?? 0;
  }
  log("");
  log("per-operation totals across the startup sequence:");
  for (const [operation, value] of Object.entries(totals).sort((left, right) => right[1].headersMs - left[1].headersMs)) {
    log(`  ${operation.padEnd(18)} ${String(value.count).padStart(2)}x  ${String(Math.round(value.headersMs)).padStart(6)} ms  ${String(value.bytes).padStart(9)} bytes`);
  }

  const lines = [];
  lines.push("");
  lines.push(`cairn startup-command breakdown (${label})`);
  lines.push(`  library entries reported          : ${total}`);
  lines.push(`  publications                      : ${publications}`);
  lines.push(`  wall load (first screen)          : ${wallLoadMs} ms (${wallRows} rows in the DOM)`);
  lines.push(`  wall count label                  : ${JSON.stringify(String(countLabel).trim())}`);
  lines.push(`  uncaught page errors              : ${pageErrors.length}`);
  for (const error of pageErrors) lines.push(`      - ${error}`);
  log(lines.join("\n"));

  return { failures: pageErrors, wallLoadMs, wallRows, direct, records: commands, total };
}

// --- entry point --------------------------------------------------------------

async function stopAndExit(code, label) {
  try { await cleanup(); } catch (error) { console.error(`FAIL: ${label}: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); }
  process.exit(code);
}

let outcome;
try {
  outcome = await main();
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  await stopAndExit(1, "cleanup after the measurement failure");
}

if (outcome) {
  const shutdown = (signal) => { log(`received ${signal}; stopping`); void stopAndExit(outcome.failures.length > 0 ? 1 : 0, `cleanup after ${signal}`); };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  const after = { dataDir: snapshotPath(realDataDir), socketDir: snapshotPath(realSocketDir) };
  const dataUntouched = JSON.stringify(before.dataDir) === JSON.stringify(after.dataDir);
  const socketUntouched = JSON.stringify(before.socketDir) === JSON.stringify(after.socketDir);
  log("");
  log("isolation and cleanup");
  log(`  operator data dir (${realDataDir}): before ${describeSnapshot(before.dataDir)}, after ${describeSnapshot(after.dataDir)} — ${dataUntouched ? "UNTOUCHED" : "CHANGED"}`);
  log(`  default socket dir (${realSocketDir}): before ${describeSnapshot(before.socketDir)}, after ${describeSnapshot(after.socketDir)} — ${socketUntouched ? "UNTOUCHED" : "CHANGED"}`);
  if (!dataUntouched) outcome.failures.push(`the operator's real data directory changed: ${realDataDir}`);
  if (!socketUntouched) outcome.failures.push(`the default socket directory changed: ${realSocketDir}`);

  const exitCode = outcome.failures.length > 0 ? 1 : 0;
  if (keepRunning) {
    log("");
    log("--keep: the daemon stays up and the temporary profile is kept.");
    log(`  profile : ${state.temp}`);
    log(`  stop it : kill ${state.daemon?.pid ?? "<pid>"}`);
    await cleanup();
    process.exit(exitCode);
  }
  const daemon = state.daemon;
  await cleanup();
  const stopped = Boolean(daemon && daemon.exitCode !== null) || daemon?.signalCode !== null;
  log(`  daemon stopped: ${stopped ? "yes" : "NO"}; temporary profile removed: ${!existsSync(state.temp) ? "yes" : "NO"} (${state.temp})`);
  if (!stopped || existsSync(state.temp)) { console.error("FAIL: cleanup did not stop the daemon and remove the temporary profile"); process.exit(1); }
  process.exit(exitCode);
}
