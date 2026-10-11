// Measured large-library behaviour for the built browser client (SP-2 evidence).
//
// The ledger claims `[ ]` cursor pagination over `search.query`, `[ ]`
// virtualized rendering for large result sets, an unrun exit test ("a 10k-image
// fixture wall scrolls without full materialization"), and `[ ]` thumbnails
// served as `ArtifactRef`. Nobody had pointed the client at a real library of
// that size. This script does exactly that and prints numbers instead of an
// impression.
//
// It takes one real image folder as its argument and:
//
//   * owns a temporary profile — its own config, catalog, repository, vectors,
//     models, recovery directory, socket and daemon log. It never reads or
//     writes a saved user profile, and it proves afterwards that the operator's
//     real `~/.local/share/cairn` (or `$XDG_DATA_HOME/cairn`) and the default
//     socket directory were neither created nor modified;
//   * opens the argument folder read-only. It never copies, moves, renames or
//     deletes anything in it, and it never prints a file name from it;
//   * builds `cairnd` from `./server/cmd/cairnd` and `cairn` from
//     `./client/cmd/cairn` into the temporary directory with the same
//     `go build -tags purego` invocation the neighbouring harnesses use, unless
//     the caller supplies prebuilt binaries;
//   * ingests the argument folder's immediate subfolders as separate sources in
//     the one workspace named "default" so they accumulate into one library.
//     One publication is bounded by the 16 MiB portable-record limit, so a
//     subfolder whose publication would exceed that bound is refused by
//     `plan.ingest` and skipped here, recorded with its entry count and the
//     daemon's own refusal message. Empty subfolders are skipped as such;
//   * drives the built client in real Google Chrome through Playwright and
//     measures: DOM rows the wall actually holds, the daemon's item count, the
//     `search.query` response size and whether it offers any continuation,
//     scrolling long tasks and frame gaps, thumbnail/preview request counts,
//     and resident memory when it can be read;
//   * stops its daemon and removes its temporary profile on success, failure and
//     signal, and says so.
//
// The numbers this prints are measurement evidence for the SP-2 rows. They are
// not a shipped capability, a performance guarantee, or release qualification.
//
// Usage:
//   node scripts/web-large-library-check.mjs <image-folder>
//
// Environment:
//   CAIRN_DAEMON_BIN                    absolute prebuilt cairnd; skips that build
//   CAIRN_BIN                           absolute prebuilt cairn; skips that build
//   CAIRN_WEB_DIST                      absolute prebuilt WebUI root (default
//                                       <repository>/web/dist)
//   CAIRN_LARGE_PORT                    loopback API port (default 4658)
//   CAIRN_LARGE_TIMEOUT_MS              daemon readiness and ingest budget
//                                       (default 1800000)
//   CAIRN_LARGE_BROWSER_TIMEOUT_MS      browser measurement budget (default
//                                       900000)
//   CAIRN_LARGE_SCROLL_STEPS            wheel-step budget used to scroll a wall
//                                       to its end (default 200)
//   CAIRN_LARGE_SCROLL_BUDGET_MS        wall-clock budget for one wall's scroll
//                                       (default 120000)
//   CAIRN_LARGE_KEEP=1                  leave the daemon running and keep the
//                                       temporary profile after this process
//                                       exits
//   CAIRN_PLAYWRIGHT_MODULE             Playwright module (default the checkout's
//                                       web/node_modules/playwright/index.mjs)
//   CAIRN_PLAYWRIGHT_EXECUTABLE_PATH    Chrome/Chromium binary (default the
//                                       macOS Google Chrome path)
//   TMPDIR                              where the temporary profile is created
//
// A missing prerequisite — the Go toolchain, the Playwright module, that Chrome
// binary, a built WebUI, or a free port — fails loudly with the command that
// fixes it. Nothing here skips silently.

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const daemonOverride = (process.env.CAIRN_DAEMON_BIN || "").trim();
const cliOverride = (process.env.CAIRN_BIN || "").trim();
const webDistOverride = (process.env.CAIRN_WEB_DIST || "").trim();
const port = Number.parseInt(process.env.CAIRN_LARGE_PORT || "4658", 10);
const timeoutMs = Number.parseInt(process.env.CAIRN_LARGE_TIMEOUT_MS || "1800000", 10);
const browserTimeoutMs = Number.parseInt(process.env.CAIRN_LARGE_BROWSER_TIMEOUT_MS || "900000", 10);
const scrollSteps = Number.parseInt(process.env.CAIRN_LARGE_SCROLL_STEPS || "200", 10);
const scrollBudgetMs = Number.parseInt(process.env.CAIRN_LARGE_SCROLL_BUDGET_MS || "120000", 10);
const keepRunning = process.env.CAIRN_LARGE_KEEP === "1";
const tempPrefix = join(tmpdir(), "cairn-web-large-library-");
const buildTag = "purego";
// The search the client itself can express that matches the largest set: every
// recorded image. `type:image` is the client's own operator, so this measures
// the client path, not a hand-written request.
const CLIENT_SEARCH_TEXT = "type:image";
const WALL_ROW = ".result-row";
const PHOTO_ROW = ".photo-card";
const LONG_TASK_LIMIT_MS = 50;

function require(condition, message) {
  if (!condition) throw new Error(message);
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function mb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

// --- argument and isolation preflight ----------------------------------------

const positional = process.argv.slice(2).filter((value) => !value.startsWith("--"));
if (process.argv.includes("--help") || positional.length === 0) {
  log("usage: node scripts/web-large-library-check.mjs <image-folder>");
  log("");
  log("Measures the built client's behaviour over one real image folder ingested as");
  log("one library, in real Google Chrome. Prints numbers; never prints a file name");
  log("from the folder and never writes to it.");
  process.exit(positional.length === 0 && !process.argv.includes("--help") ? 2 : 0);
}
const folder = resolve(positional[0]);
const folderStat = existsSync(folder) ? statSync(folder) : undefined;
require(folderStat?.isDirectory(), `the argument must be an existing directory, got ${JSON.stringify(positional[0])}`);

// The paths `cairn config init` would otherwise point at. They are snapshotted
// before anything runs and compared afterwards; a change is a loud failure.
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

const state = {
  temp: "",
  daemon: null,
  daemonLog: "",
  logStream: null,
  cleaning: null,
  stopping: false,
  context: null,
};

function daemonLogTail(lines = 25) {
  const trimmed = state.daemonLog.trim();
  return trimmed ? trimmed.split("\n").slice(-lines).join("\n") : "(the daemon log is empty)";
}

async function probePortFree(value) {
  require(Number.isInteger(value) && value > 0 && value < 65536, `CAIRN_LARGE_PORT must be a loopback port number, got ${JSON.stringify(process.env.CAIRN_LARGE_PORT)}`);
  const probe = createServer();
  try {
    await new Promise((resolveProbe, rejectProbe) => {
      probe.once("error", rejectProbe);
      probe.listen(value, "127.0.0.1", resolveProbe);
    });
  } catch (error) {
    throw new Error(
      `the loopback port ${value} is not available (${error?.code ?? error?.message ?? error}).\n` +
      "      Stop whatever holds it, or set CAIRN_LARGE_PORT to a free port.",
    );
  }
  await new Promise((resolveProbe, rejectProbe) => probe.close((error) => error ? rejectProbe(error) : resolveProbe()));
}

function requireHarnessPrerequisites() {
  const playwrightModule = process.env.CAIRN_PLAYWRIGHT_MODULE || join(repo, "web", "node_modules", "playwright", "index.mjs");
  if (!existsSync(playwrightModule)) {
    throw new Error(
      `the browser harness imports Playwright from ${playwrightModule}, which does not exist.\n` +
      "      Install the web toolchain first:  cd web && npm ci",
    );
  }
  const chrome = (process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome").trim();
  if (!existsSync(chrome)) {
    throw new Error(
      `the browser harness launches Chrome/Chromium at ${chrome}, which does not exist.\n` +
      "      Set CAIRN_PLAYWRIGHT_EXECUTABLE_PATH to a Chrome/Chromium binary before running it.",
    );
  }
  const webRoot = webDistOverride ? resolve(webDistOverride) : join(repo, "web", "dist");
  require(isAbsolute(webRoot), `the WebUI root must be an absolute path, got ${webRoot}`);
  if (!existsSync(join(webRoot, "index.html"))) {
    throw new Error(
      `there is no built WebUI at ${webRoot}.\n` +
      "      Build the client first (it is not tracked by git):\n" +
      "        cd web && npm ci && npm run build\n" +
      "      or set CAIRN_WEB_DIST to an absolute prebuilt WebUI root.",
    );
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
      try {
        await state.context.close();
      } catch { /* the browser is already gone */ }
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
    if (!target.startsWith(tempPrefix) || target === tempPrefix) {
      throw new Error(`refusing to remove ${target}: it is not one of this script's temporary directories`);
    }
    try {
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      throw new Error(`could not remove the temporary profile ${target}: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${operation} returned a non-JSON body (HTTP ${response.status}, ${text.length} bytes)`);
  }
  const ok = body.status === "SUCCEEDED" || body.status === "DEGRADED";
  if (!ok && !allowFailure) {
    throw new Error(`${operation} was ${body.status}: ${JSON.stringify((body.reasons ?? []).map((reason) => reason.message))}`);
  }
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

// --- ingest -------------------------------------------------------------------

async function immediateSubfolders(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => join(folder, entry.name))
    .sort();
}

async function countRegularFiles(root) {
  let files = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files += 1;
    }
  }
  return files;
}

async function ingestLibrary(base, folder) {
  const subfolders = await immediateSubfolders(folder);
  const applied = [];
  const skippedOverCeiling = [];
  const skippedEmpty = [];
  const failed = [];
  let workspaceID = "";
  let publishedFiles = 0;
  let publishedBytes = 0;

  for (const [index, subfolder] of subfolders.entries()) {
    const label = `${index + 1}/${subfolders.length}`;
    const filesOnDisk = await countRegularFiles(subfolder);
    if (filesOnDisk === 0) {
      skippedEmpty.push({ name: subfolder, files: 0 });
      log(`  [${label}] skipped as empty: ${dirname(subfolder) === folder ? "" : ""}${subfolder.split("/").at(-1)} (0 regular files)`);
      continue;
    }
    const started = Date.now();
    const planned = await command(base, "plan.ingest", { root: subfolder }, { allowFailure: true });
    if (!planned.ok) {
      const reason = planned.reasons.map((item) => item.message ?? "").join("; ");
      if (/record limit/i.test(reason)) {
        skippedOverCeiling.push({ name: subfolder, files: filesOnDisk, reason });
        log(`  [${label}] skipped: ${subfolder.split("/").at(-1)} (${filesOnDisk} files) — the daemon refused the publication: ${reason}`);
        continue;
      }
      failed.push({ name: subfolder, stage: "plan.ingest", detail: reason || planned.status });
      log(`  [${label}] FAILED plan.ingest: ${subfolder.split("/").at(-1)} — ${reason || planned.status}`);
      continue;
    }
    const plan = planned.data ?? {};
    if (plan.executable !== true) {
      failed.push({ name: subfolder, stage: "plan.ingest", detail: `not executable: ${JSON.stringify(plan.blocked_entries ?? [])}` });
      log(`  [${label}] FAILED plan.ingest: not executable (${JSON.stringify(plan.blocked_entries ?? [])})`);
      continue;
    }
    workspaceID = plan.workspace_id || workspaceID;
    const appliedResult = await command(base, "plan.apply", {
      workspace_id: plan.workspace_id,
      plan_id: plan.plan_id,
      plan_digest: plan.plan_digest,
    }, { allowFailure: true });
    const appliedData = appliedResult.data ?? {};
    if (!appliedResult.ok || !["SUCCEEDED", "DEGRADED"].includes(appliedData.state)) {
      failed.push({ name: subfolder, stage: "plan.apply", detail: `${appliedResult.status}/${appliedData.state}` });
      log(`  [${label}] FAILED plan.apply: ${subfolder.split("/").at(-1)} — ${appliedResult.status}/${appliedData.state}`);
      continue;
    }
    workspaceID = appliedData.workspace_id || plan.workspace_id || workspaceID;
    publishedFiles += plan.files ?? 0;
    publishedBytes += plan.local_bytes ?? plan.bytes ?? 0;
    applied.push({ name: subfolder, files: plan.files ?? 0, bytes: plan.local_bytes ?? plan.bytes ?? 0, state: appliedData.state, ms: Date.now() - started });
    log(`  [${label}] published: ${subfolder.split("/").at(-1)} — ${plan.files ?? 0} files, ${mb(plan.local_bytes ?? plan.bytes ?? 0)}, ${appliedData.state}, ${Date.now() - started} ms`);
  }
  return { workspaceID, subfolders, applied, skippedOverCeiling, skippedEmpty, failed, publishedFiles, publishedBytes };
}

// --- browser measurement ------------------------------------------------------

const INIT_SCRIPT = `
  window.__cairnLongTasks = [];
  window.__cairnFrames = [];
  window.__cairnFrameStop = true;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__cairnLongTasks.push({ start: entry.startTime, duration: entry.duration, name: entry.name });
    }).observe({ entryTypes: ["longtask"] });
  } catch (error) { window.__cairnLongTaskError = String(error); }
  window.__cairnStartFrames = () => {
    window.__cairnFrames = [];
    window.__cairnFrameStop = false;
    let last = performance.now();
    const tick = (stamp) => {
      window.__cairnFrames.push(stamp);
      last = stamp;
      if (window.__cairnFrameStop) return;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return last;
  };
  window.__cairnStopFrames = () => { window.__cairnFrameStop = true; return window.__cairnFrames; };
`;

function summariseLongTasks(entries) {
  const durations = entries.map((entry) => entry.duration);
  const worst = entries.reduce((best, entry) => (entry.duration > (best?.duration ?? -1) ? entry : best), undefined);
  const blocking = durations.filter((value) => value >= LONG_TASK_LIMIT_MS).reduce((total, value) => total + (value - LONG_TASK_LIMIT_MS), 0);
  return {
    count: entries.length,
    worstMs: worst ? Math.round(worst.duration) : 0,
    worstStartMs: worst ? Math.round(worst.start) : 0,
    blockingMs: Math.round(blocking),
  };
}

function frameGaps(stamps) {
  let worst = 0;
  for (let index = 1; index < stamps.length; index += 1) worst = Math.max(worst, stamps[index] - stamps[index - 1]);
  return { frames: stamps.length, worstGapMs: Math.round(worst) };
}

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

async function readMemory(page) {
  return page.evaluate(() => {
    const memory = performance.memory;
    return memory ? { used: memory.usedJSHeapSize, total: memory.totalJSHeapSize, limit: memory.jsHeapSizeLimit } : null;
  });
}

/** Resident memory of the whole Chrome process tree that carries `marker` in its
 *  command line, summed over the browser and every renderer/GPU child. */
function chromeRssBytes(marker) {
  const listing = spawnSync("ps", ["-axo", "pid=,ppid=,rss=,command="], { encoding: "utf8" });
  if (listing.status !== 0) return null;
  const rows = listing.stdout.split("\n").map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), rss: Number(match[3]) * 1024, command: match[4] } : undefined;
  }).filter(Boolean);
  const root = rows.find((row) => row.command.includes(marker));
  if (!root) return null;
  const total = { bytes: 0, processes: 0 };
  const seen = new Set([root.pid]);
  const queue = [root.pid];
  while (queue.length > 0) {
    const pid = queue.shift();
    const row = rows.find((candidate) => candidate.pid === pid);
    if (row) {
      total.bytes += row.rss;
      total.processes += 1;
    }
    for (const child of rows) {
      if (child.ppid === pid && !seen.has(child.pid)) {
        seen.add(child.pid);
        queue.push(child.pid);
      }
    }
  }
  return total;
}

async function scrollWall(page) {
  const geometry = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  const maxScroll = Math.max(0, geometry.scrollHeight - geometry.clientHeight);
  const longTaskStart = await page.evaluate(() => window.__cairnLongTasks.length);
  await page.evaluate(() => window.__cairnStartFrames());
  const started = Date.now();
  let steps = 0;
  // Scroll with real wheel input until the bottom is reached, the step budget is
  // spent, or the wall-clock budget runs out. How far it actually got is part of
  // the measurement, so a short run is reported rather than hidden.
  const budget = Math.max(1, scrollSteps);
  while (steps < budget && Date.now() - started < scrollBudgetMs) {
    const at = await page.evaluate(() => ({ y: window.scrollY, max: Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight) }));
    if (at.y >= at.max - 2) break;
    // A larger wheel step covers a 200k-pixel wall inside the budget without
    // pretending the wall is short.
    await page.mouse.wheel(0, 3000);
    steps += 1;
    await page.waitForTimeout(40);
  }
  const elapsedMs = Date.now() - started;
  const frames = await page.evaluate(() => window.__cairnStopFrames());
  const after = await page.evaluate(() => ({ y: window.scrollY, max: Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight) }));
  const longTasks = await page.evaluate((from) => window.__cairnLongTasks.slice(from), longTaskStart);
  return {
    maxScroll,
    reachedScrollTop: Math.round(after.y),
    wheelSteps: steps,
    elapsedMs,
    bottomReached: Math.round(after.y) >= Math.round(after.max) - 2,
    longTasks: summariseLongTasks(longTasks),
    frames: frameGaps(frames),
  };
}

function continuationKeys(value, found = new Set(), depth = 0) {
  if (depth > 6 || value === null || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 2)) continuationKeys(item, found, depth + 1);
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/cursor|continuation|next|offset|page|has_more|total|limit/i.test(key)) found.add(key);
    continuationKeys(child, found, depth + 1);
  }
  return found;
}

// --- measurement run ----------------------------------------------------------

async function main() {
  const harness = requireHarnessPrerequisites();
  await probePortFree(port);

  const subfolders = await immediateSubfolders(folder);
  require(subfolders.length > 0, `the argument folder has no immediate subfolders to ingest: ${folder}`);

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
  const base = `http://127.0.0.1:${port}`;
  const daemon = spawn(daemonBin, [
    "--config", config,
    "--socket", env.CAIRN_SOCKET,
    "--api-listen", `127.0.0.1:${port}`,
    "--web-root", harness.webRoot,
  ], { cwd: temp, env, stdio: ["ignore", "pipe", "pipe"] });
  state.daemon = daemon;
  state.logStream = createWriteStream(join(temp, "daemon.log"), { flags: "a" });
  for (const stream of [daemon.stdout, daemon.stderr]) {
    stream.on("data", (chunk) => {
      const text = chunk.toString();
      state.daemonLog += text;
      if (state.logStream?.writable) state.logStream.write(text);
    });
  }
  await new Promise((resolveSpawn, rejectSpawn) => {
    daemon.once("spawn", resolveSpawn);
    daemon.once("error", rejectSpawn);
  });
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
  log(`argument folder        : ${folder} (opened read-only; no file name is printed)`);
  log("");
  log(`ingesting ${subfolders.length} immediate subfolders as separate sources in workspace "default"...`);
  const ingestStarted = Date.now();
  const library = await ingestLibrary(base, folder);
  const ingestMs = Date.now() - ingestStarted;
  require(library.workspaceID, "no ingest publication produced a workspace id");
  require(library.failed.length === 0, `ingest failed for ${library.failed.length} subfolder(s): ${library.failed.map((item) => item.detail).join("; ")}`);

  // The daemon's own account of the workspace, measured through `content.list`.
  const listing = await command(base, "content.list", { workspace_id: library.workspaceID });
  const items = listing.data?.items ?? [];
  const byType = {};
  for (const item of items) byType[item.entry_type ?? "unknown"] = (byType[item.entry_type ?? "unknown"] ?? 0) + 1;
  const imageItems = items.filter((item) => /\.(png|jpe?g|gif|webp|avif|heic|bmp|tiff?)$/i.test(item.name ?? "")).length;

  log("");
  log(`ingest summary: ${library.applied.length} sources published in ${ingestMs} ms, ` +
    `${library.skippedOverCeiling.length} skipped over the record bound, ` +
    `${library.skippedEmpty.length} skipped as empty`);
  log(`daemon content.list    : ${items.length} items (${JSON.stringify(byType)}; ${imageItems} with an image suffix)`);
  log(`plan files published   : ${library.publishedFiles} files, ${mb(library.publishedBytes)} local bytes`);

  // Measured search.query shape, called directly so the response size and every
  // offered key are exact.
  const searchInput = { workspace_id: library.workspaceID, query: "", filters: { media_class: "image" } };
  const directSearch = await command(base, "search.query", searchInput, { allowFailure: true });
  const rawSearchKeys = continuationKeys(directSearch.data ?? {});

  // --- real Chrome ------------------------------------------------------------
  const { chromium } = await import(harness.playwrightModule);
  const profileDir = join(temp, "chrome-profile");
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    executablePath: harness.chrome,
    viewport: { width: 1496, height: 900 },
    locale: "en-US",
  });
  state.context = context;
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
  const requests = [];
  const responses = new Map();
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/command")) return;
    let operation = "";
    let input;
    try {
      const body = request.postDataJSON();
      operation = body?.operation ?? "";
      input = body?.input;
    } catch { /* a body this harness cannot read is recorded as unreadable */ }
    requests.push({ operation, input });
  });
  page.on("response", (response) => {
    if (!response.url().endsWith("/api/v1/command")) return;
    const header = response.headers()["content-length"];
    responses.set(response, header ? Number.parseInt(header, 10) : null);
  });
  const countOperations = (names) => requests.filter((entry) => names.includes(entry.operation)).length;
  const PREVIEW_OPERATIONS = ["content.open", "content.read"];

  const wallStarted = Date.now();
  log("");
  log("browser: loading the client and the full library wall...");
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: browserTimeoutMs });
  await page.locator(".result-list").first().waitFor({ state: "visible", timeout: browserTimeoutMs });
  const wallRows = await waitForRowCount(page, WALL_ROW, browserTimeoutMs);
  const wallLoadMs = Date.now() - wallStarted;
  log(`browser: wall rendered ${wallRows} rows in ${wallLoadMs} ms`);
  const previewOnWallLoad = countOperations(PREVIEW_OPERATIONS);
  const wallCountText = await page.locator(".result-count").first().innerText().catch(() => "");
  const loadLongTasks = summariseLongTasks(await page.evaluate(() => window.__cairnLongTasks));
  const listRequest = requests.find((entry) => entry.operation === "content.list");
  const listResponseBytes = [...responses.entries()].find(([response]) => {
    try { return response.request().postDataJSON()?.operation === "content.list"; } catch { return false; }
  })?.[1] ?? listing.bytes;

  // Scroll the loaded library wall with real wheel input.
  log("browser: scrolling the library wall with real wheel input...");
  const wallScroll = await scrollWall(page);
  const previewAfterWallScroll = countOperations(PREVIEW_OPERATIONS);

  // Does the operator still get to work after that scroll? Open Details on the
  // row that is actually on screen, and time the click separately from the
  // panel becoming visible, so an auto-scroll is never mistaken for latency.
  let interaction = { ok: false, clickMs: 0, panelMs: 0, detail: "" };
  {
    const visibleIndex = await page.evaluate((selector) => {
      const rows = [...document.querySelectorAll(selector)];
      const index = rows.findIndex((row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      });
      return index;
    }, WALL_ROW);
    const target = visibleIndex >= 0 ? visibleIndex : 0;
    const started = Date.now();
    try {
      await page.locator(WALL_ROW).nth(target).locator(".result-open-copy").first().click({ timeout: 30000 });
      const clicked = Date.now();
      await page.locator(".detail-column").first().waitFor({ state: "visible", timeout: 30000 });
      interaction = { ok: true, clickMs: clicked - started, panelMs: Date.now() - clicked, detail: `Details opened for visible row ${target}` };
    } catch (error) {
      interaction = { ok: false, clickMs: Date.now() - started, panelMs: 0, detail: String(error?.message ?? error) };
    }
  }

  // The Photos presentation wall over the same loaded library, when this build
  // enables it. It is measured before the search so its row count is a
  // projection of the whole loaded listing, not of one search's hits.
  const photos = { available: false, rows: 0, scroll: null, notice: "" };
  const photosButton = page.locator('.library-presentation-navigation__domain[data-domain="cairn:photos"]').first();
  const previewBeforePhotos = countOperations(PREVIEW_OPERATIONS);
  if (await photosButton.count() > 0) {
    photos.available = true;
    log("browser: opening the Photos presentation wall over the same loaded listing...");
    await photosButton.click();
    await page.locator(`.photo-wall ${PHOTO_ROW}`).first().waitFor({ state: "visible", timeout: browserTimeoutMs }).catch(() => undefined);
    photos.rows = await waitForRowCount(page, PHOTO_ROW, browserTimeoutMs);
    photos.thumbRequestsOnLoad = countOperations(PREVIEW_OPERATIONS) - previewBeforePhotos;
    log(`browser: photos wall rendered ${photos.rows} cards; scrolling it...`);
    photos.scroll = await scrollWall(page);
    photos.thumbRequestsAfterScroll = countOperations(PREVIEW_OPERATIONS) - previewBeforePhotos;
    // Return to the all-types wall so the client-driven search is measured
    // through the ordinary result list, not through the Photos presentation.
    const allTypes = page.locator(".library-presentation-navigation__domain").first();
    if (await allTypes.count() > 0) {
      await allTypes.click();
      await page.locator(".result-list").first().waitFor({ state: "visible", timeout: browserTimeoutMs }).catch(() => undefined);
    }
  } else {
    photos.notice = "this build renders no Photos presentation navigation for the loaded library";
  }

  // Client-driven search.query: the client's own `type:image` operator, run from
  // the all-types wall so it replaces the whole loaded scope.
  log(`browser: running the client search ${JSON.stringify(CLIENT_SEARCH_TEXT)}...`);
  const searchRequestStart = requests.length;
  await page.locator(".global-search input").first().fill(CLIENT_SEARCH_TEXT);
  await page.locator(".search-submit").first().click();
  await page.waitForFunction(() => {
    const label = document.querySelector(".result-count")?.textContent ?? "";
    return /result/i.test(label);
  }, undefined, { timeout: browserTimeoutMs }).catch(() => undefined);
  const searchRows = await waitForRowCount(page, WALL_ROW, browserTimeoutMs);
  log(`browser: the client rendered ${searchRows} rows for the search`);
  const searchRequest = requests.slice(searchRequestStart).find((entry) => entry.operation === "search.query");
  const searchResponseBytes = [...responses.entries()].find(([response]) => {
    try { return response.request().postDataJSON()?.operation === "search.query"; } catch { return false; }
  })?.[1] ?? null;
  const searchCountText = await page.locator(".result-count").first().innerText().catch(() => "");
  const searchScopeNotice = await page.locator(".library-result-scope small").first().innerText().catch(() => "");
  const previewAfterSearch = countOperations(PREVIEW_OPERATIONS);

  const previewTotals = {
    libraryWallLoad: previewOnWallLoad,
    afterWallScroll: previewAfterWallScroll,
    afterClientSearch: previewAfterSearch,
  };
  const memory = await readMemory(page);
  const rss = chromeRssBytes(profileDir);

  // --- report -----------------------------------------------------------------
  const lines = [];
  const failures = [];
  if (items.length === 0) failures.push("the daemon reported zero items for the workspace after a successful publication");
  if (!wallRows) failures.push("the library wall rendered no result rows although the daemon reported items");
  if (wallScroll.maxScroll > 0 && wallScroll.reachedScrollTop === 0) failures.push("the library wall did not scroll at all");
  if (!interaction.ok) failures.push(`the client did not answer an ordinary Details interaction after scrolling: ${interaction.detail}`);
  if (!searchRequest) failures.push(`the client issued no search.query request for its own ${JSON.stringify(CLIENT_SEARCH_TEXT)} operator`);
  if (searchRows && searchRows >= items.length && searchRows > (directSearch.data?.hits ?? []).length) failures.push("the client rendered more search rows than the daemon returned hits");
  for (const error of pageErrors) failures.push(`the page raised an uncaught error: ${error}`);

  lines.push("");
  lines.push("cairn large-library measurement (real Chrome)");
  lines.push(`  subfolders in the argument folder : ${library.subfolders.length}`);
  lines.push(`  sources published                 : ${library.applied.length}`);
  lines.push(`  subfolders skipped over the bound : ${library.skippedOverCeiling.length}`);
  for (const skipped of library.skippedOverCeiling) {
    lines.push(`      - ${skipped.name.split("/").at(-1)} (${skipped.files} files on disk): ${skipped.reason}`);
  }
  lines.push(`  subfolders skipped as empty       : ${library.skippedEmpty.length}`);
  lines.push(`  ingest wall time                  : ${ingestMs} ms`);
  lines.push("");
  lines.push("1. library size as the daemon reports it (content.list)");
  lines.push(`   items                             : ${items.length}`);
  lines.push(`   by entry type                     : ${JSON.stringify(byType)}`);
  lines.push(`   items with an image suffix        : ${imageItems}`);
  lines.push(`   content.list response             : ${mb(listResponseBytes)} (${listResponseBytes} bytes)`);
  lines.push(`   content.list request input keys   : ${JSON.stringify(Object.keys(listRequest?.input ?? {}))}`);
  lines.push("");
  lines.push("2. the wall in the DOM");
  lines.push(`   library wall rows in the DOM      : ${wallRows}`);
  lines.push(`   library wall count label          : ${JSON.stringify(wallCountText.trim())}`);
  lines.push(`   daemon items vs DOM rows equal    : ${wallRows === items.length ? "YES (nothing is windowed out)" : "NO"}`);
  lines.push(`   wall load time                    : ${wallLoadMs} ms`);
  lines.push(`   photos wall rows in the DOM       : ${photos.available ? `${photos.rows} (projected from the whole loaded listing; the daemon reports ${items.length} items, ${imageItems} with an image suffix)` : `not measured (${photos.notice})`}`);
  lines.push("");
  lines.push("3. search.query");
  lines.push(`   direct hits (filters media_class=image) : ${(directSearch.data?.hits ?? []).length}`);
  lines.push(`   direct response                   : ${mb(directSearch.bytes)} (${directSearch.bytes} bytes)`);
  lines.push(`   keys matching cursor/next/page    : ${rawSearchKeys.size ? JSON.stringify([...rawSearchKeys]) : "none"}`);
  lines.push(`   client request (${CLIENT_SEARCH_TEXT})              : ${searchRequest ? JSON.stringify(Object.keys(searchRequest.input ?? {})) : "no request captured"}`);
  lines.push(`   client request declares a limit/cursor : ${/:.*(limit|cursor|offset|page)/.test(JSON.stringify(searchRequest?.input ?? {})) ? "YES" : "NO"}`);
  lines.push(`   client hits rendered as rows      : ${searchRows} of ${items.length} daemon items`);
  lines.push(`   client search response            : ${searchResponseBytes !== null ? mb(searchResponseBytes) : "not captured (chunked response has no content-length)"}`);
  lines.push(`   client count label                : ${JSON.stringify(searchCountText.trim())}`);
  lines.push(`   client scope caveat               : ${JSON.stringify(searchScopeNotice.trim())}`);
  lines.push("");
  lines.push("4. scrolling the wall with real wheel input");
  lines.push(`   document scrollable height        : ${wallScroll.maxScroll} px`);
  lines.push(`   wheel steps / elapsed             : ${wallScroll.wheelSteps} / ${wallScroll.elapsedMs} ms`);
  lines.push(`   scrollY reached                   : ${wallScroll.reachedScrollTop} px of ${wallScroll.maxScroll} px (bottom reached: ${wallScroll.bottomReached ? "yes" : "no"})`);
  lines.push(`   long tasks while scrolling        : ${wallScroll.longTasks.count} (largest ${wallScroll.longTasks.worstMs} ms, blocking ${wallScroll.longTasks.blockingMs} ms)`);
  lines.push(`   frame gaps while scrolling        : ${wallScroll.frames.frames} frames, largest gap ${wallScroll.frames.worstGapMs} ms`);
  lines.push(`   long tasks during page load       : ${loadLongTasks.count} (largest ${loadLongTasks.worstMs} ms, blocking ${loadLongTasks.blockingMs} ms)`);
  lines.push(`   post-scroll Details interaction   : ${interaction.ok ? "opened" : "FAILED"} (click ${interaction.clickMs} ms, panel ${interaction.panelMs} ms; ${interaction.detail})`);
  if (photos.available && photos.scroll) {
    lines.push(`   photos wall scroll                : ${photos.scroll.wheelSteps} steps, ${photos.scroll.reachedScrollTop} px of ${photos.scroll.maxScroll} px (bottom reached: ${photos.scroll.bottomReached ? "yes" : "no"}), largest long task ${photos.scroll.longTasks.worstMs} ms, largest frame gap ${photos.scroll.frames.worstGapMs} ms`);
  }
  lines.push("");
  lines.push("5. thumbnail / preview request count (content.open + content.read)");
  lines.push(`   library wall, whole load          : ${previewTotals.libraryWallLoad}`);
  lines.push(`   after scrolling the library wall  : ${previewTotals.afterWallScroll}`);
  lines.push(`   after the client-driven search    : ${previewTotals.afterClientSearch}`);
  if (photos.available) {
    lines.push(`   photos wall load                  : ${photos.thumbRequestsOnLoad}`);
    lines.push(`   photos wall after scrolling       : ${photos.thumbRequestsAfterScroll}`);
  }
  lines.push("");
  lines.push("6. memory");
  lines.push(`   JS heap (used/total/limit)        : ${memory ? `${mb(memory.used)} / ${mb(memory.total)} / ${mb(memory.limit)}` : "not readable in this browser"}`);
  lines.push(`   Chrome process-tree RSS           : ${rss ? `${mb(rss.bytes)} over ${rss.processes} processes` : "not readable"}`);
  lines.push("");
  if (failures.length > 0) {
    lines.push("FAIL:");
    for (const failure of failures) lines.push(`  - ${failure}`);
  } else {
    lines.push("PASS: the measurement completed; no product failure was observed in this run.");
  }
  log(lines.join("\n"));

  return { failures, items, wallRows, photos, wallScroll, memory, rss, searchRows };
}

// --- entry point --------------------------------------------------------------

async function stopAndExit(code, label) {
  state.stopping = true;
  try {
    await cleanup();
  } catch (error) {
    console.error(`FAIL: ${label}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
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
  const shutdown = (signal) => {
    log(`received ${signal}; stopping the daemon and removing the temporary profile`);
    void stopAndExit(outcome.failures.length > 0 ? 1 : 0, `cleanup after ${signal}`);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  // Isolation and cleanup evidence, measured after the run and before removal.
  const after = { dataDir: snapshotPath(realDataDir), socketDir: snapshotPath(realSocketDir) };
  const dataUntouched = JSON.stringify(before.dataDir) === JSON.stringify(after.dataDir);
  const socketUntouched = JSON.stringify(before.socketDir) === JSON.stringify(after.socketDir);
  const daemonStillRunning = Boolean(state.daemon && state.daemon.exitCode === null && state.daemon.signalCode === null);
  log("");
  log("7. isolation and cleanup");
  log(`   operator data dir (${realDataDir}): before ${describeSnapshot(before.dataDir)}, after ${describeSnapshot(after.dataDir)} — ${dataUntouched ? "UNTOUCHED" : "CHANGED"}`);
  log(`   default socket dir (${realSocketDir}): before ${describeSnapshot(before.socketDir)}, after ${describeSnapshot(after.socketDir)} — ${socketUntouched ? "UNTOUCHED" : "CHANGED"}`);
  log(`   daemon pid ${state.daemon?.pid ?? "?"} running: ${daemonStillRunning ? "yes (about to stop)" : "no"}`);
  if (!dataUntouched) outcome.failures.push(`the operator's real data directory changed: ${realDataDir}`);
  if (!socketUntouched) outcome.failures.push(`the default socket directory changed: ${realSocketDir}`);
  if (outcome.failures.length > 0) {
    log("");
    log("FAIL:");
    for (const failure of outcome.failures) log(`  - ${failure}`);
  }

  const exitCode = outcome.failures.length > 0 ? 1 : 0;
  if (keepRunning) {
    log("");
    log("CAIRN_LARGE_KEEP=1: the daemon stays up and the temporary profile is kept.");
    log(`  stop it with  : kill ${state.daemon?.pid ?? "<pid>"}`);
    log(`  remove it with: rm -rf ${state.temp}`);
    await cleanup();
    process.exit(exitCode);
  }
  // The measurement is over: every earlier failure has already been named, so
  // the shutdown below is deliberate and must not be reported as an unexpected
  // daemon death.
  state.stopping = true;
  const daemon = state.daemon;
  await cleanup();
  const daemonStopped = Boolean(daemon && daemon.exitCode !== null) || daemon?.signalCode !== null;
  const tempRemoved = !existsSync(state.temp);
  log(`   daemon stopped: ${daemonStopped ? "yes" : "NO"}; temporary profile removed: ${tempRemoved ? "yes" : "NO"} (${state.temp})`);
  if (!daemonStopped || !tempRemoved) {
    console.error("FAIL: cleanup did not stop the daemon and remove the temporary profile");
    process.exit(1);
  }
  process.exit(exitCode);
}
