// Reproducible content fixture for the promoted browser acceptance harnesses
// (RW-PERSONAL-UX-1 verification assets).
//
// The promoted `scripts/web-*-check.mjs` browser harnesses that need fixture
// content each assert a behaviour of the built client, and each one reads the
// content it needs out of whatever daemon it is pointed at. Their passing
// direction therefore needs a daemon whose content matches their stated fixture
// assumptions (at least two
// photos, one starred photo and one starred track and nothing else starred, one
// stored view with a supported condition that returns rows, at least two audio
// tracks, one ordinary file that carries bytes, at least one real JPEG). Until
// this file existed that recipe lived only in the ledger and a fresh checkout
// could not reproduce it.
//
// This script builds that fixture from nothing but the checkout:
//
//   * it owns a temporary profile — its own config, catalog, repository,
//     vectors, models, recovery directory, socket and daemon log. It never reads
//     or writes a saved user profile, and every binary and byte it creates lives
//     in that temporary directory. The one exception is documented below: when
//     the checkout has no built client at all it builds `web/dist` in place,
//     because that bundle is not tracked by git;
//   * it builds `cairnd` from `./server/cmd/cairnd` and `cairn` from
//     `./client/cmd/cairn` into that temporary directory with the same
//     `go build -tags purego` invocation the neighbouring harnesses use, unless
//     the caller supplies prebuilt binaries;
//   * it synthesizes the fixture bytes deterministically in pure Node — real
//     PNG, real baseline JPEG, real 16-bit PCM WAV and a real text file, with no
//     dependency on a platform image or audio tool;
//   * it ingests them through the ordinary `plan.ingest` + `plan.apply` command
//     path, stars exactly one photo and exactly one audio track with the
//     ordinary `Favorite` user TAG through `annotation.upsert`, and saves one
//     named view (`query` text plus `fields: ["suffix=wav"]`) through
//     `view.save`;
//   * it verifies its own recipe through the same command surface (tag count,
//     stored view, a lexical search that returns rows) and fails loudly rather
//     than serving a fixture that would make a harness fail for the wrong
//     reason;
//   * it starts the daemon with `--web-root` as an absolute path serving the
//     current `web/dist`, prints the URL and the copy-pasteable command for each
//     acceptance harness, and then serves until interrupted. On exit — success,
//     failure or signal — it stops its daemon and removes its temporary
//     directory.
//
// The client bundle is git-ignored, so a fresh checkout has no `web/dist`. This
// script prefers the existing bundle and never rebuilds it; when it is absent it
// runs the repository's own `npm run build` in `web/` (writing that directory)
// if the web toolchain is installed, and otherwise refuses with the exact
// commands to build it. All other build output stays in the temporary profile.
//
// These fixtures are QA bytes. They are not a shipped capability, a format
// support claim, or release evidence.
//
// Usage:
//   node scripts/web-fixture-seed.mjs
//
// Environment:
//   CAIRN_DAEMON_BIN                 absolute prebuilt cairnd; skips that build
//   CAIRN_BIN                        absolute prebuilt cairn; skips that build
//   CAIRN_WEB_DIST                   absolute prebuilt WebUI root (default
//                                    <repository>/web/dist)
//   CAIRN_FIXTURE_PORT               loopback API port (default 4648, the
//                                    harnesses' own default base URL)
//   CAIRN_FIXTURE_KEEP=1             leave the daemon running and keep the
//                                    temporary profile after this process exits;
//                                    the printed pid and directory are then the
//                                    caller's to stop and remove
//   CAIRN_FIXTURE_TIMEOUT_MS         readiness/ingest wait budget (default
//                                    180000)
//   CAIRN_PLAYWRIGHT_EXECUTABLE_PATH Chrome/Chromium binary the harnesses read
//                                    (default the macOS Google Chrome path)
//   TMPDIR                           where the temporary profile is created
//
// A missing prerequisite — the Go toolchain, the Playwright module, that Chrome
// binary, a built WebUI, or a free port — fails loudly with the command that
// fixes it. Nothing here skips silently.

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const daemonOverride = (process.env.CAIRN_DAEMON_BIN || "").trim();
const cliOverride = (process.env.CAIRN_BIN || "").trim();
const webDistOverride = (process.env.CAIRN_WEB_DIST || "").trim();
const port = Number.parseInt(process.env.CAIRN_FIXTURE_PORT || "4648", 10);
const timeoutMs = Number.parseInt(process.env.CAIRN_FIXTURE_TIMEOUT_MS || "180000", 10);
const keepRunning = process.env.CAIRN_FIXTURE_KEEP === "1";
const tempPrefix = join(tmpdir(), "cairn-web-fixture-");
const buildTag = "purego";

// The fixture content, named so that the ordinary lexical query `Tone` returns
// the WAV rows and the ordinary `suffix=wav` condition is supported by this
// build's saved-view vocabulary.
const FIXTURE_TEXT_NAME = "Cairn-Notes.txt";
const FIXTURE_SMALL_PNG = "Cairn-Frame-Small.png";
const FIXTURE_WIDE_PNG = "Cairn-Frame-Wide.png";
const FIXTURE_OVERPIXEL_PNG = "Cairn-Frame-Overpixel.png";
const FIXTURE_JPEG = "Cairn-Photo-Quarter.jpg";
const FIXTURE_WAV_NAMES = ["Tone-Alpha.wav", "Tone-Beta.wav", "Tone-Gamma.wav"];
const FAVORITE_TAG = "Favorite";
const SAVED_VIEW_NAME = "Luna QA 音频样例";
const SAVED_VIEW_QUERY = "Tone";
const SAVED_VIEW_FIELDS = ["suffix=wav"];
// The photo the fixture stars, and the audio track it stars. Both are chosen by
// name so the fixture is deterministic across runs.
const STARRED_PHOTO = FIXTURE_SMALL_PNG;
const STARRED_AUDIO = FIXTURE_WAV_NAMES[0];
const FIXTURE_TEXT = [
  "# Cairn browser-acceptance fixture",
  "",
  "This ordinary text file carries real bytes so the ordinary library row,",
  "the Details panel and the Notes guard have a non-empty regular file to open.",
  "It is QA content, not a shipped document or an import format claim.",
  "",
].join("\n");

const HARNESSES = [
  "web-photo-viewer-drag-check.mjs",
  "web-photo-viewer-touch-check.mjs",
  "web-photo-viewer-preview-check.mjs",
  "web-original-download-check.mjs",
  "web-photo-original-download-check.mjs",
  "web-favorites-cross-domain-check.mjs",
  "web-settings-layout-check.mjs",
  "web-audio-queue-edge-check.mjs",
  "web-audio-queue-occurrence-check.mjs",
  "web-notes-guard-check.mjs",
  "web-saved-retrieval-provenance-check.mjs",
];
// Self-contained: it builds its own daemon and synthesizes its own fixtures, so
// it takes no URL argument and is listed separately rather than pretending to
// accept one.
const SELF_CONTAINED_HARNESS = "web-audio-unsupported-check.mjs";

function require(condition, message) {
  if (!condition) throw new Error(message);
}

// --- deterministic fixture bytes ---------------------------------------------

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value;
  }
  return table;
})();

function crc32(bytes) {
  let value = -1;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return out;
}

/** A deterministic 32-bit PRNG with a long period, so deflate cannot collapse
 *  the image by matching one short repeating byte pattern. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return (value ^ (value >>> 14)) >>> 0;
  };
}

/** A genuinely valid truecolour PNG built from deterministic block colours.
 *  `block` controls how much structure survives deflate, which is what lets the
 *  fixture place one image above the client's 1 MiB "large preview" threshold
 *  while keeping its pixel count above the 12-megapixel decode limit. */
function pngBytes({ width, height, block, seed }) {
  const rowBytes = 1 + width * 3;
  const raw = Buffer.alloc(height * rowBytes);
  const next = mulberry32(seed);
  for (let y = 0; y < height; y += 1) {
    const row = y * rowBytes;
    let x = 0;
    while (x < width) {
      const red = next() & 0xff;
      const green = next() & 0xff;
      const blue = next() & 0xff;
      const run = Math.min(block, width - x);
      for (let i = 0; i < run; i += 1) {
        const offset = row + 1 + (x + i) * 3;
        raw[offset] = red;
        raw[offset + 1] = green;
        raw[offset + 2] = blue;
      }
      x += run;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A genuinely decodable baseline JPEG (SOI/APP0/DQT/SOF0/DHT/SOS/EOI) whose
 *  blocks all carry a zero DC coefficient and an immediate end-of-block, so the
 *  image is uniformly mid-grey. Written in pure Node because no JPEG encoder is
 *  available to a fresh checkout. */
function jpegBytes({ width, height }) {
  const segment = (marker, payload) => {
    const out = Buffer.alloc(4 + payload.length);
    out[0] = 0xff;
    out[1] = marker;
    out.writeUInt16BE(2 + payload.length, 2);
    payload.copy(out, 4);
    return out;
  };
  const parts = [Buffer.from([0xff, 0xd8])];
  // APP0 / JFIF 1.1, no thumbnail.
  parts.push(segment(0xe0, Buffer.concat([Buffer.from("JFIF\0", "binary"), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])])));
  // DQT: one 8-bit quantization table, all ones (the finest baseline step, so
  // the single DC coefficient reconstructs the flat image exactly).
  const quantize = Buffer.alloc(1 + 64);
  quantize[0] = 0x00;
  quantize.fill(1, 1);
  parts.push(segment(0xdb, quantize));
  // SOF0: 8-bit precision, three 1x1-sampled components sharing table 0.
  const frame = Buffer.alloc(6 + 3 * 3);
  frame[0] = 8;
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  frame[5] = 3;
  for (let component = 0; component < 3; component += 1) {
    frame[6 + component * 3] = component + 1;
    frame[7 + component * 3] = 0x11;
    frame[8 + component * 3] = 0x00;
  }
  parts.push(segment(0xc0, frame));
  // DHT: one DC and one AC table, each carrying a single 1-bit code for symbol
  // 0 (DC category 0 / AC end-of-block). Legal, minimal and complete.
  const huffman = Buffer.alloc(2 * 18);
  for (const [table, id] of [[0, 0x00], [1, 0x10]]) {
    const base = table * 18;
    huffman[base] = id;
    huffman[base + 1] = 1;
    huffman[base + 17] = 0x00;
  }
  parts.push(segment(0xc4, huffman));
  // SOS: all three components, table 0 for both DC and AC.
  const scan = Buffer.alloc(1 + 3 * 2 + 3);
  scan[0] = 3;
  for (let component = 0; component < 3; component += 1) {
    scan[1 + component * 2] = component + 1;
    scan[2 + component * 2] = 0x00;
  }
  scan[7] = 0;
  scan[8] = 63;
  scan[9] = 0;
  parts.push(segment(0xda, scan));
  // Entropy data: every block is DC-difference 0 (code "0") then end-of-block
  // (code "0"), so each MCU is six zero bits.
  const bits = [];
  const mcus = Math.ceil(width / 8) * Math.ceil(height / 8);
  for (let index = 0; index < mcus * 3 * 2; index += 1) bits.push(0);
  const entropy = [];
  for (let index = 0; index < bits.length; index += 8) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) value = (value << 1) | (bits[index + bit] ?? 1); // pad with ones
    entropy.push(value);
  }
  const stuffed = [];
  for (const byte of entropy) {
    stuffed.push(byte);
    if (byte === 0xff) stuffed.push(0x00);
  }
  parts.push(Buffer.from(stuffed));
  parts.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

/** A genuinely valid mono 16-bit PCM WAV. Three seconds keeps the track
 *  observable through the transient queue while the player is settling. */
function wavBytes({ sampleRate = 8000, seconds = 3, frequency = 440 }) {
  const frames = Math.floor(sampleRate * seconds);
  const samples = Buffer.alloc(frames * 2);
  for (let index = 0; index < frames; index += 1) {
    samples.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.35 * 32767), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

/** Width x height, block size and PRNG seed of every generated image. The
 *  over-pixel frame is deliberately just past the client's 12,000,000-pixel
 *  preview decode limit while its compressed size stays in the (1 MiB, 8 MiB]
 *  window the client treats as a "large automatic preview", so the card
 *  exercises the over-pixel fallback instead of the legacy thumbnail path. */
const IMAGE_PLAN = [
  { name: FIXTURE_SMALL_PNG, kind: "png", width: 96, height: 64, block: 8, seed: 0x51a1e001 },
  { name: FIXTURE_WIDE_PNG, kind: "png", width: 4096, height: 512, block: 16, seed: 0x57d1e002 },
  { name: FIXTURE_OVERPIXEL_PNG, kind: "png", width: 4096, height: 3100, block: 16, seed: 0x0b7e1003 },
  { name: FIXTURE_JPEG, kind: "jpeg", width: 320, height: 240, seed: 0x1a6e0004 },
];
const OVERPIXEL_PIXELS = 12_000_000;
const PREVIEW_MIN_BYTES = 1 << 20;
const PREVIEW_MAX_BYTES = 8 << 20;

function buildFixtureFiles() {
  const files = new Map();
  const overpixel = IMAGE_PLAN.find((image) => image.name === FIXTURE_OVERPIXEL_PNG);
  require(Boolean(overpixel), "the over-pixel fixture image is planned");
  require(
    overpixel.width * overpixel.height > OVERPIXEL_PIXELS && overpixel.width <= 8192 && overpixel.height <= 8192,
    `the over-pixel fixture image must exceed ${OVERPIXEL_PIXELS} pixels within the 8192-pixel dimension limit`,
  );
  for (const image of IMAGE_PLAN) {
    files.set(image.name, image.kind === "png" ? pngBytes(image) : jpegBytes(image));
  }
  const overpixelBytes = files.get(FIXTURE_OVERPIXEL_PNG);
  require(
    overpixelBytes.length > PREVIEW_MIN_BYTES && overpixelBytes.length <= PREVIEW_MAX_BYTES,
    `${FIXTURE_OVERPIXEL_PNG} must land in the (1 MiB, 8 MiB] large-preview window to exercise the over-pixel fallback; generated ${overpixelBytes.length} bytes`,
  );
  const frequencies = [440, 660, 880];
  FIXTURE_WAV_NAMES.forEach((name, index) => files.set(name, wavBytes({ frequency: frequencies[index] })));
  files.set(FIXTURE_TEXT_NAME, Buffer.from(FIXTURE_TEXT, "utf8"));
  require(files.get(FIXTURE_TEXT_NAME).length > 0, "the text fixture must carry real bytes, not zero bytes");
  return files;
}

// --- temporary profile, builds and daemon ------------------------------------

const state = {
  temp: "",
  daemon: null,
  daemonLog: "",
  logStream: null,
  cleaning: null,
  stopping: false,
};

function log(message) {
  process.stdout.write(`${message}\n`);
}

function daemonLogTail(lines = 25) {
  const trimmed = state.daemonLog.trim();
  return trimmed ? trimmed.split("\n").slice(-lines).join("\n") : "(the daemon log is empty)";
}

/**
 * The promoted harnesses import Playwright from `web/node_modules` and launch an
 * installed Chrome/Chromium. Both are real prerequisites of the acceptance run
 * this fixture exists to enable, so they are checked here and refused loudly
 * with the command that repairs them.
 */
function requireHarnessPrerequisites() {
  const playwright = join(repo, "web", "node_modules", "playwright", "index.mjs");
  if (!existsSync(playwright)) {
    throw new Error(
      `the browser harnesses import Playwright from ${playwright}, which is not installed.\n` +
      "      Install the web toolchain first:  cd web && npm ci",
    );
  }
  const chrome = (process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome").trim();
  if (!existsSync(chrome)) {
    throw new Error(
      `the browser harnesses launch Chrome/Chromium at ${chrome}, which does not exist.\n` +
      "      Set CAIRN_PLAYWRIGHT_EXECUTABLE_PATH to a Chrome/Chromium binary before running them.",
    );
  }
  return { playwright, chrome };
}

async function probePortFree(value) {
  require(Number.isInteger(value) && value > 0 && value < 65536, `CAIRN_FIXTURE_PORT must be a loopback port number, got ${JSON.stringify(process.env.CAIRN_FIXTURE_PORT)}`);
  const probe = createServer();
  try {
    await new Promise((resolveProbe, rejectProbe) => {
      probe.once("error", rejectProbe);
      probe.listen(value, "127.0.0.1", resolveProbe);
    });
  } catch (error) {
    throw new Error(
      `the loopback port ${value} is not available (${error?.code ?? error?.message ?? error}).\n` +
      "      Stop whatever holds it, or set CAIRN_FIXTURE_PORT to a free port and pass the URL this script prints to each harness.",
    );
  }
  await new Promise((resolveProbe, rejectProbe) => probe.close((error) => error ? rejectProbe(error) : resolveProbe()));
}

async function ensureWebRoot() {
  const configured = webDistOverride ? resolve(webDistOverride) : join(repo, "web", "dist");
  require(isAbsolute(configured), `the WebUI root must be an absolute path, got ${configured}`);
  if (existsSync(join(configured, "index.html"))) return configured;
  if (webDistOverride) throw new Error(`CAIRN_WEB_DIST=${configured} has no index.html; point it at a built WebUI root`);
  const vite = join(repo, "web", "node_modules", ".bin", "vite");
  if (!existsSync(vite)) {
    throw new Error(
      `the checkout has no built WebUI at ${configured} and no installed web toolchain at ${dirname(dirname(vite))}.\n` +
      "      Build the client first (it is not tracked by git):\n" +
      "        cd web && npm ci && npm run build\n" +
      "      or set CAIRN_WEB_DIST to an absolute prebuilt WebUI root.",
    );
  }
  log(`building the WebUI into ${configured} (web/dist is not tracked by git)`);
  const built = spawnSync("npm", ["run", "build"], { cwd: join(repo, "web"), stdio: "inherit" });
  require(built.status === 0, "npm run build in web/ failed; the fixture cannot serve the current client");
  require(existsSync(join(configured, "index.html")), `the WebUI build produced no ${join(configured, "index.html")}`);
  return configured;
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

/**
 * Stop the fixture daemon and remove the temporary profile exactly once. Every
 * exit path funnels through here, so a deliberate shutdown and a failure share
 * one cleanup and cannot race each other into leaving the daemon or the
 * temporary directory behind.
 */
function cleanup() {
  if (state.cleaning) return state.cleaning;
  state.cleaning = (async () => {
    if (keepRunning) {
      if (state.daemon && state.daemon.exitCode === null && state.daemon.signalCode === null) state.daemon.unref();
      return;
    }
    const daemon = state.daemon;
    if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
      daemon.kill("SIGTERM");
      await Promise.race([once(daemon, "exit"), new Promise((resolveWait) => setTimeout(resolveWait, 10000))]);
      if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGKILL");
    }
    if (state.logStream) {
      // The log file is diagnostic only: a stream error must not turn a clean
      // shutdown into a reported failure.
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

async function main() {
  const harness = requireHarnessPrerequisites();
  const webRoot = await ensureWebRoot();
  await probePortFree(port);
  const temp = await mkdtemp(tempPrefix);
  state.temp = temp;
  require(temp.startsWith(tempPrefix) && temp !== tempPrefix, `refusing to use temporary directory ${temp}`);

  const source = join(temp, "source");
  await mkdir(source, { recursive: true });
  const files = buildFixtureFiles();
  for (const [name, bytes] of files) await writeFile(join(source, name), bytes);

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
  const logPath = join(temp, "daemon.log");
  const base = `http://127.0.0.1:${port}`;
  const daemon = spawn(daemonBin, [
    "--config", config,
    "--socket", env.CAIRN_SOCKET,
    "--api-listen", `127.0.0.1:${port}`,
    "--web-root", webRoot,
  ], { cwd: temp, env, stdio: ["ignore", "pipe", "pipe"] });
  state.daemon = daemon;
  // Keep the daemon's own output both in memory (for the failure message) and
  // on disk in the temporary profile (for the operator).
  state.logStream = createWriteStream(logPath, { flags: "a" });
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

  const command = async (operation, input = {}) => {
    const response = await fetch(`${base}/api/v1/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation, input }),
    });
    require(response.ok, `${operation} returned HTTP ${response.status}`);
    const body = await response.json();
    require(
      body.status === "SUCCEEDED" || body.status === "DEGRADED",
      `${operation} was ${body.status}: ${JSON.stringify(body.reasons ?? [])}`,
    );
    return { status: body.status, data: body.data };
  };

  const plan = (await command("plan.ingest", { root: source })).data;
  require(plan.executable === true, `the fixture ingest plan is not executable: ${JSON.stringify(plan.blocked_entries ?? [])}`);
  require(plan.files === files.size, `the fixture ingest plan scanned ${plan.files} files, expected ${files.size}`);
  const applied = (await command("plan.apply", {
    workspace_id: plan.workspace_id,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
  })).data;
  require(["SUCCEEDED", "DEGRADED"].includes(applied.state), `the fixture publication was ${applied.state}`);
  const workspaceID = applied.workspace_id || plan.workspace_id;

  const listing = (await command("content.list", { workspace_id: workspaceID })).data;
  const items = listing.items ?? [];
  const findByName = (name) => items.find((item) => item.entry_type === "REGULAR_FILE" && item.name === name);
  const photo = findByName(STARRED_PHOTO);
  const audio = findByName(STARRED_AUDIO);
  require(Boolean(photo?.subject_ref), `the published content listing has no ${STARRED_PHOTO} with a stable subject reference`);
  require(Boolean(audio?.subject_ref), `the published content listing has no ${STARRED_AUDIO} with a stable subject reference`);
  const imageItems = items.filter((item) => item.entry_type === "REGULAR_FILE" && /\.(png|jpe?g)$/i.test(item.name ?? ""));
  const audioItems = items.filter((item) => item.entry_type === "REGULAR_FILE" && /\.wav$/i.test(item.name ?? ""));
  require(imageItems.length >= 2, `the fixture publishes ${imageItems.length} photos, the harnesses need at least two`);
  require(audioItems.length >= 2, `the fixture publishes ${audioItems.length} audio tracks, the harnesses need at least two`);

  // Star exactly one photo and exactly one track with the ordinary visible tag.
  for (const subject of [photo, audio]) {
    const upsert = await command("annotation.upsert", {
      workspace_id: workspaceID,
      subject_ref: subject.subject_ref,
      kind: "TAG",
      body: FAVORITE_TAG,
      expected_revision: 0,
    });
    require(upsert.data?.annotation?.body === FAVORITE_TAG, `the ${FAVORITE_TAG} tag did not round-trip for ${subject.name}`);
  }
  const annotations = (await command("annotation.list", { workspace_id: workspaceID })).data?.annotations ?? [];
  const favorites = annotations.filter((record) => record.kind === "TAG" && !record.tombstoned && (record.body ?? "").trim() === FAVORITE_TAG);
  const starred = new Set(favorites.map((record) => record.subject_ref));
  require(
    favorites.length === 2 && starred.size === 2 && starred.has(photo.subject_ref) && starred.has(audio.subject_ref),
    `the fixture must star exactly ${STARRED_PHOTO} and ${STARRED_AUDIO} and nothing else; observed ${JSON.stringify(favorites.map((record) => record.subject_ref))}`,
  );

  const saved = (await command("view.save", {
    name: SAVED_VIEW_NAME,
    query: SAVED_VIEW_QUERY,
    fields: SAVED_VIEW_FIELDS,
    scope: workspaceID,
  })).data;
  require(saved.view_id && saved.query === SAVED_VIEW_QUERY, `the stored view did not round-trip: ${JSON.stringify(saved)}`);

  // Self-check the two properties the harnesses read back, so a fixture that
  // would fail them is refused here instead of looking like a client defect.
  const search = (await command("search.query", { workspace_id: workspaceID, query: SAVED_VIEW_QUERY })).data;
  require(
    (search.hits ?? []).length > 0,
    `the lexical query ${JSON.stringify(SAVED_VIEW_QUERY)} returned no hits, so the saved-retrieval harness could not re-run it`,
  );
  const evaluated = (await command("view.evaluate", { name: SAVED_VIEW_NAME, limit: 50 })).data;
  require((evaluated.hits ?? []).length > 0, `evaluating the stored view returned no hits: ${JSON.stringify(evaluated)}`);

  return { temp, config, env, webRoot, daemonBin, cliBin, base, workspaceID, plan, applied, items, saved, evaluated, harness };
}

// --- reporting ---------------------------------------------------------------

function report(context) {
  const { temp, config, env, webRoot, daemonBin, cliBin, base, workspaceID, items, saved, evaluated, harness } = context;
  const starredNames = items.filter((item) => item.name === STARRED_PHOTO || item.name === STARRED_AUDIO).map((item) => item.name);
  const images = items.filter((item) => /\.(png|jpe?g)$/i.test(item.name ?? "")).length;
  const audio = items.filter((item) => /\.wav$/i.test(item.name ?? "")).length;
  log("");
  log("cairn browser-acceptance fixture");
  log(`  repository root      : ${repo}`);
  log(`  temporary profile    : ${temp}`);
  log(`  config               : ${config}`);
  log(`  catalog              : ${env.CAIRN_CATALOG}`);
  log(`  repository           : ${env.CAIRN_REPOSITORY}`);
  log(`  vectors / models     : ${env.CAIRN_VECTORS} / ${env.CAIRN_MODELS}`);
  log(`  recovery records     : ${env.CAIRN_RECOVERY_RECORDS}`);
  log(`  daemon socket        : ${env.CAIRN_SOCKET}`);
  log(`  daemon log           : ${join(temp, "daemon.log")}`);
  log(`  daemon / cli         : ${daemonBin} / ${cliBin}`);
  log(`  web root             : ${webRoot}`);
  log(`  playwright / chrome  : ${harness.playwright} / ${harness.chrome}`);
  log(`  daemon pid           : ${state.daemon?.pid ?? "not running"}`);
  log(`  workspace            : ${workspaceID}`);
  log(`  content              : ${items.length} ordinary files (${images} images incl. one over the 12 MP preview limit, ${audio} PCM WAV, ${items.length - images - audio} other)`);
  log(`  starred (Favorite)   : ${starredNames.join(", ")}`);
  log(`  saved view           : ${JSON.stringify(saved.name)} query=${JSON.stringify(saved.query)} fields=${JSON.stringify(SAVED_VIEW_FIELDS)} hits=${evaluated.hits.length}`);
  log("");
  log(`URL: ${base}/`);
  log("");
  log("Acceptance harnesses against this URL:");
  for (const script of HARNESSES) log(`  node scripts/${script} ${base}`);
  log(`  node scripts/${SELF_CONTAINED_HARNESS}   # self-contained: builds its own daemon and takes no URL`);
  log("");
  if (keepRunning) {
    log(`CAIRN_FIXTURE_KEEP=1: the daemon stays up and the temporary profile is kept.`);
    log(`  stop it with  : kill ${state.daemon?.pid ?? "<pid>"}`);
    log(`  remove it with: rm -rf ${temp}`);
  } else {
    log("Serving until interrupted (Ctrl-C). The daemon is stopped and the temporary profile removed on exit.");
  }
  log("");
}

// --- entry point -------------------------------------------------------------

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

let context;
try {
  context = await main();
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  await stopAndExit(1, "cleanup after the fixture failure");
}

if (context) {
  report(context);
  const shutdown = (signal) => {
    log(`received ${signal}; stopping the fixture daemon and removing ${context.temp}`);
    void stopAndExit(0, `cleanup after ${signal}`);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  if (keepRunning) {
    log("CAIRN_FIXTURE_KEEP=1: this process exits now; the daemon remains running.");
    await stopAndExit(0, "cleanup after the keep-running handoff");
  }
  // Hold the process open while the daemon serves. An unexpected daemon exit is
  // a loud failure: every harness would otherwise fail for the wrong reason. A
  // daemon exit we caused ourselves is not a failure.
  const daemon = state.daemon;
  if (daemon) {
    daemon.on("exit", (code, signal) => {
      if (state.stopping) return;
      console.error(`FAIL: the fixture daemon exited (code ${code}, signal ${signal})\n--- isolated daemon log (tail) ---\n${daemonLogTail()}`);
      void stopAndExit(1, "cleanup after the fixture daemon exited");
    });
  }
}
