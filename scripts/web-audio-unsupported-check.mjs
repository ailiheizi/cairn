// End-to-end browser acceptance check for the admitted Music client surface
// (RW-PERSONAL-UX-1; M1/Q1):
//
//   A failed or unsupported audio decode must surface an explicit, honest error
//   through the player's live status region. Native playback must remain visibly
//   pending until the actual play() promise settles, and late acknowledgments
//   must not resurrect playback after Stop or a replacement track.
//
// Isolation follows scripts/web-content-visual-e2e.mjs: this file owns a
// temporary config, catalog, repository, vectors, models, recovery directory and
// Chrome profile; it builds `cairnd` and `cairn` with `go build -tags purego`
// into that temporary directory, starts its own daemon on a probed loopback port,
// and launches its own Playwright Chrome against the installed Google Chrome. It
// never touches a saved user profile or the persistent QA daemon, and it removes
// its temporary directory on exit. It exercises the prebuilt web/dist bundle
// exactly like the other browser harnesses; no web build step runs here. Set
// CAIRN_TEST_WEB_ROOT to exercise a separate absolute candidate bundle without
// touching web/dist. Like its neighbours it runs unconditionally; the other
// knob is CAIRN_PLAYWRIGHT_EXECUTABLE_PATH for the browser executable.
//
// Fixtures are synthesized deterministically in Node: two distinct real mono
// 16-bit PCM WAVs (supported control and replacement) and a real 8x8 RGB PNG
// renamed to .mp3 (the non-audio original). They are ingested through the
// ordinary plan -> apply path. These are QA bytes, not a shipped capability or
// format-support claim.
//
// Honest-assertion notes:
//  - The player consumes the failure through two concurrent browser signals: the
//    media element's `error` event (AudioPlayer.tsx -> playback.fail) and the
//    rejected `audio.play()` promise (useAudioPlayback.ts -> fail). Whichever wins
//    writes the same `playback.error` field, which the status region renders. The
//    harness asserts that a terminal error string is shown; it REPORTS whether the
//    string is the prepared `unsupported-format` key or a raw browser rejection
//    message instead of failing on that wording, because both are explicit and
//    neither is silently wrong.
//  - The media element's own MediaError is not observable after the app handles
//    the failure: `fail()` calls `clearMedia()`, which removes `src` and reloads,
//    which clears `audio.error`. So the harness verifies the undecodable bytes
//    independently, through the browser's own decoder, using the exact download
//    URL the app requested.
//  - The stable, pre-mounted sr-only status node's role="status"/aria-live and
//    localized announcement for an error are exit conditions. The visible
//    status line remains plain text; routine loading/ready/playing state must
//    not populate the live region. The harness captures the node before playback
//    and checks that the same connected node announces the real decode failure.
//  - For pending-start/fencing cases, the harness calls the browser's real
//    HTMLMediaElement.play() immediately and only holds delivery of its actual
//    promise settlement to the application. It does not fabricate acknowledgments
//    or media events.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { openSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { chromium } from "../web/node_modules/playwright/index.mjs";

const repo = resolve(new URL("..", import.meta.url).pathname);
const chrome = process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const webRoot = resolve(process.env.CAIRN_TEST_WEB_ROOT || join(repo, "web", "dist"));
const port = 4561;
const supportedName = "Tone-Valid.wav";
const replacementName = "Tone-Replacement.wav";
const unsupportedName = "Renamed-Original.mp3";
// The player's own non-error lifecycle texts, per locale. English has no
// separate catalogue: createTranslator returns the message key unchanged, so the
// English strings are the keys themselves.
const lifecycle = {
  en: { loading: "Loading and verifying original", starting: "Starting audio…", ready: "Ready", playing: "Original audio", idle: "Nothing playing", currentTrack: "Current track", nowPlaying: "Now playing", playLabel: "Play", pauseLabel: "Pause" },
  "zh-CN": { loading: "正在读取并校验原件", starting: "正在开始播放音频…", ready: "就绪", playing: "原始音频", idle: "未在播放", currentTrack: "当前曲目", nowPlaying: "正在播放", playLabel: "播放", pauseLabel: "暂停" },
};
const nonErrorStatus = (locale) => new Set([lifecycle[locale].loading, lifecycle[locale].starting, lifecycle[locale].ready, lifecycle[locale].playing, lifecycle[locale].idle, ""]);
// The prepared error outcomes the player can render, per locale (English has no
// separate catalogue, so the rendered English text is the message key, and
// zh-CN resolves that same sentence through its catalogue). AudioPlayer.tsx
// maps each typed playback code to one of these sentences before `t()`; a bare
// code such as `unsupported-format` must never reach the status line. Keep these
// sets byte-identical to PLAYBACK_ERROR_TEXTS in AudioPlayer.tsx plus the
// parameterised download sentence.
const typedOutcomes = {
  en: new Set([
    "This audio format is not supported for browser playback. Open Details to download the original.",
    "The browser blocked playback. Choose Play again to allow it.",
    "This original could not be played.",
  ]),
  "zh-CN": new Set([
    "浏览器不支持播放此音频格式。请打开详情下载原件。",
    "浏览器阻止了自动播放，请再次点击播放。",
    "无法播放此音频原件",
  ]),
};
// Any token shaped like an internal code. It must never be what the operator
// reads, so its presence in the status line is a defect, not a diagnostic.
const playbackErrorCodeShape = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// --- deterministic fixtures --------------------------------------------------
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
/** A genuinely valid PNG, so the .mp3 is a real non-audio original, not junk. */
function pngBytes(size = 8) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour RGB
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y += 1) {
    const row = y * (1 + size * 3);
    for (let x = 0; x < size; x += 1) {
      raw[row + 1 + x * 3] = (x * 32) % 256;
      raw[row + 2 + x * 3] = (y * 32) % 256;
      raw[row + 3 + x * 3] = 128;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
/** A genuinely valid mono 16-bit PCM WAV, so the control really is playable.
 * Twenty seconds keeps a deliberately held native-play acknowledgment from
 * racing natural completion; this is bounded QA audio, not a product limit. */
function wavBytes({ sampleRate = 8000, seconds = 20, frequency = 440 } = {}) {
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
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format: PCM
  header.writeUInt16LE(1, 22); // channels: mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

const supportedBytes = wavBytes({ seconds: 20, frequency: 440 });
const replacementBytes = wavBytes({ seconds: 20, frequency: 523 });
const unsupportedBytes = pngBytes();

// Hold only delivery of the actual native play() promise settlement. The
// browser's original play() runs immediately and produces its real media
// events; this gate delays no request, bytes, event or playback state.
async function installNativePlayAckGate(page) {
  await page.addInitScript(() => {
    const nativePlay = HTMLMediaElement.prototype.play;
    const gate = {
      armed: false,
      calls: [],
      nextID: 1,
      arm() { this.armed = true; },
      disarm() { this.armed = false; },
      release(id) {
        const call = this.calls.find((entry) => entry.id === id);
        if (!call || !call.deliver) throw new Error(`native play acknowledgment ${id} is not settled`);
        call.delivered = true;
        call.deliver();
        return true;
      },
    };
    HTMLMediaElement.prototype.play = function(...args) {
      const actual = nativePlay.apply(this, args);
      if (!gate.armed) return actual;
      const call = { id: gate.nextID++, actualState: "pending", delivered: false, deliver: undefined };
      gate.calls.push(call);
      return new Promise((resolve, reject) => {
        Promise.resolve(actual).then((value) => {
          call.actualState = "fulfilled";
          call.deliver = () => resolve(value);
        }, (error) => {
          call.actualState = "rejected";
          call.deliver = () => reject(error);
        });
      });
    };
    Object.defineProperty(window, "__cairnNativePlayAckGate", { value: gate, configurable: false });
  });
}

async function armNativePlayAckGate(page) {
  return page.evaluate(() => {
    const gate = window.__cairnNativePlayAckGate;
    gate.arm();
    return gate.calls.length;
  });
}

async function waitForNativePlayAck(page, startingAt, timeout = 20000) {
  await page.waitForFunction((start) => {
    const gate = window.__cairnNativePlayAckGate;
    return gate.calls.slice(start).some((call) => call.actualState === "fulfilled");
  }, startingAt, { timeout });
  const calls = await page.evaluate((start) => window.__cairnNativePlayAckGate.calls.slice(start).map(({ id, actualState, delivered }) => ({ id, actualState, delivered })), startingAt);
  const fulfilled = calls.find((call) => call.actualState === "fulfilled");
  assert.ok(fulfilled, "the actual browser play() promise fulfills before the app acknowledgment is released");
  return fulfilled;
}

async function releaseNativePlayAck(page, id) {
  return page.evaluate((callID) => window.__cairnNativePlayAckGate.release(callID), id);
}
async function readNativePlayAck(page, id) {
  return page.evaluate((callID) => {
    const call = window.__cairnNativePlayAckGate.calls.find((entry) => entry.id === callID);
    return call ? { id: call.id, actualState: call.actualState, delivered: call.delivered } : null;
  }, id);
}

// --- page observation --------------------------------------------------------
const readPlayerState = (page) => page.evaluate(() => {
  const player = document.querySelector(".global-audio-player");
  const status = player?.querySelector(".audio-player-identity small") ?? null;
  const announcement = document.querySelector(".audio-player-announcement") ?? null;
  const audio = player?.querySelector("audio") ?? null;
  const toggle = player?.querySelector(".audio-player-toggle") ?? null;
  return {
    statusText: status?.textContent?.trim() ?? null,
    statusRole: status?.getAttribute("role") ?? null,
    statusAriaLive: status?.getAttribute("aria-live") ?? null,
    announcementText: announcement?.textContent?.trim() ?? null,
    announcementRole: announcement?.getAttribute("role") ?? null,
    announcementAriaLive: announcement?.getAttribute("aria-live") ?? null,
    announcementAtomic: announcement?.getAttribute("aria-atomic") ?? null,
    identity: player?.querySelector(".audio-player-identity strong")?.textContent?.trim() ?? null,
    toggleLabel: toggle?.getAttribute("aria-label") ?? null,
    toggleDisabled: Boolean(toggle?.disabled),
    seekDisabled: Boolean(player?.querySelector(':scope > input[type="range"]')?.disabled),
    stopDisabled: Boolean(player?.querySelector(".audio-player-stop")?.disabled),
    errorDetailsAction: [...(player?.querySelectorAll(".audio-player-current-actions button") ?? [])].some((button) => !button.classList.contains("audio-player-retry")),
    queueSummary: player?.querySelector(".audio-player-queue summary")?.textContent?.trim() ?? null,
    queueItems: [...(player?.querySelectorAll(".audio-player-queue-item") ?? [])].map((item) => ({
      name: item.querySelector(".audio-queue-play")?.textContent?.trim() ?? "",
      current: item.classList.contains("current"),
      currentLabel: item.querySelector(".audio-queue-current")?.textContent?.trim() ?? null,
    })),
    audio: audio ? {
      paused: audio.paused,
      currentTime: audio.currentTime,
      readyState: audio.readyState,
      networkState: audio.networkState,
      errorCode: audio.error?.code ?? 0,
      errorMessage: audio.error?.message ?? null,
      // The app clears a failed source with removeAttribute("src") + load().
      // Chrome may keep reporting the previous currentSrc for a while, so the
      // release of the obsolete media is asserted on the removed attribute and
      // on NETWORK_EMPTY, not on currentSrc.
      srcAttribute: audio.getAttribute("src"),
      currentSrc: audio.currentSrc,
    } : null,
  };
});

/** Poll until the observed state satisfies `terminal`, then settle and re-read. */
async function waitForState(page, terminal, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = await readPlayerState(page);
  while (Date.now() < deadline) {
    if (terminal(last)) {
      await page.waitForTimeout(400);
      const settled = await readPlayerState(page);
      if (terminal(settled)) return settled;
      last = settled;
      continue;
    }
    await page.waitForTimeout(100);
    last = await readPlayerState(page);
  }
  if (!terminal(last)) {
    throw new Error(`Timed out waiting for player state; last observed=${JSON.stringify(last)}`);
  }
  return last;
}

let base = "";
let daemon;
let browser;
let failure;
let daemonLog = "";
const observed = {};

async function observeAttempt(page, locale, record) {
  const expected = lifecycle[locale];
  const quiet = nonErrorStatus(locale);
  const downloads = [];
  page.on("request", (request) => {
    try {
      const url = new URL(request.url());
      if (url.pathname === "/api/v1/download") downloads.push(request.url());
    } catch { /* non-URL request */ }
  });

  await installNativePlayAckGate(page);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator(".library-presentation-navigation__domain").first().waitFor({ state: "visible", timeout: 30000 });
  const musicNav = page.locator('.library-presentation-navigation__domain[data-domain$="music"]');
  assert.equal(await musicNav.count(), 1, "the compiled Music presentation is offered in the Library navigation");
  await musicNav.first().click();
  await page.locator(".music-library").waitFor({ state: "visible", timeout: 20000 });

  // Capture the persistent live region while the player is idle and before any
  // queue or playback action. It is a sibling of the hideable player aside.
  const announcementLocator = page.locator('.audio-player-announcement[role="status"][aria-live="polite"]');
  await announcementLocator.waitFor({ state: "attached", timeout: 10000 });
  const announcementBefore = await announcementLocator.elementHandle();
  assert.ok(announcementBefore, "the stable announcement node is mounted while the player is idle");
  record.announcementBefore = await announcementBefore.evaluate((node) => {
    const ancestors = [];
    let current = node;
    while (current instanceof HTMLElement) {
      const style = getComputedStyle(current);
      ancestors.push({
        tag: current.tagName.toLowerCase(),
        className: typeof current.className === "string" ? current.className : "",
        display: style.display,
        visibility: style.visibility,
        hidden: current.hasAttribute("hidden"),
        inert: current.hasAttribute("inert"),
        ariaHidden: current.getAttribute("aria-hidden"),
      });
      current = current.parentElement;
    }
    return {
      text: node.textContent?.trim() ?? "",
      role: node.getAttribute("role"),
      ariaLive: node.getAttribute("aria-live"),
      ariaAtomic: node.getAttribute("aria-atomic"),
      ancestors,
    };
  });
  record.announcementExposedAtIdle = record.announcementBefore.ancestors.every((ancestor) =>
    ancestor.display !== "none" && !["hidden", "collapse"].includes(ancestor.visibility) && !ancestor.hidden && !ancestor.inert && ancestor.ariaHidden !== "true");
  assert.equal(record.announcementBefore.text, "", "the idle live region is empty before queueing");
  assert.equal(record.announcementBefore.role, "status", "the idle announcement node exposes status semantics");
  assert.equal(record.announcementBefore.ariaLive, "polite", "the idle announcement node is polite");
  assert.equal(record.announcementBefore.ariaAtomic, "true", "the idle announcement is atomic");
  assert.equal(record.announcementExposedAtIdle, true, "no node in the live region's ancestor chain hides or disables it");

  const renamedRow = page.locator(`.music-track[aria-label="${unsupportedName}"]`).first();
  const supportedRow = page.locator(`.music-track[aria-label="${supportedName}"]`).first();
  const replacementRow = page.locator(`.music-track[aria-label="${replacementName}"]`).first();
  await renamedRow.waitFor({ state: "visible", timeout: 20000 });
  await supportedRow.waitFor({ state: "visible", timeout: 20000 });
  await replacementRow.waitFor({ state: "visible", timeout: 20000 });
  record.rows = await page.locator(".music-track").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));

  // The ordinary per-row control. It is enabled for the renamed original because
  // Music eligibility is suffix/identity/size based; only the browser decoder can
  // discover the bytes are not audio, which is exactly the honest-fallback case.
  record.unsupportedRowPlayEnabled = !(await renamedRow.locator(".music-track-play").isDisabled());
  assert.ok(record.unsupportedRowPlayEnabled, `the Music surface must let the operator attempt ${unsupportedName} (its play control was disabled)`);

  // Queue the renamed original FIRST and the supported WAV second, so a silent
  // "advance as if it succeeded" would land on the WAV and be caught.
  const addToQueue = async (row) => {
    const menu = row.locator(".music-track-queue-menu");
    await menu.locator(":scope > summary").click();
    await menu.locator(":scope > div > button").first().click();
  };
  await addToQueue(renamedRow);
  await addToQueue(supportedRow);
  await page.locator(".global-audio-player .audio-player-queue summary").click();
  await page.locator(".global-audio-player .audio-player-queue-panel").waitFor({ state: "visible", timeout: 10000 });
  const queued = await waitForState(page, (state) => state.queueItems.length === 2, 10000);
  record.queueBeforeAttempt = queued.queueItems;
  record.queueSummaryBeforeAttempt = queued.queueSummary;
  assert.equal(record.queueBeforeAttempt.length, 2, "both ingested originals are queued before the attempt");
  assert.equal(record.queueBeforeAttempt[0]?.name, unsupportedName, "the renamed original is the first queued occurrence");
  record.beforeAttempt = queued;
  const announcementAfterQueue = await announcementLocator.elementHandle();
  assert.ok(announcementAfterQueue, "the stable announcement node remains mounted after queueing");
  record.announcementSameAfterQueue = await announcementBefore.evaluate((before, afterQueue) => before === afterQueue, announcementAfterQueue);
  record.announcementConnectedAfterQueue = await announcementBefore.evaluate((node) => node.isConnected);
  record.announcementTextAfterQueue = await announcementBefore.evaluate((node) => node.textContent?.trim() ?? "");
  assert.equal(record.announcementConnectedAfterQueue, true, "the idle announcement node stays connected when the queue is added");
  assert.equal(record.announcementSameAfterQueue, true, "queueing retains the same idle announcement node");
  assert.equal(record.announcementTextAfterQueue, "", "routine queue setup does not announce lifecycle text");

  await page.locator(".global-audio-player .audio-player-queue-item").first().locator(".audio-queue-play").click();
  const after = await waitForState(page, (state) =>
    Boolean(state.audio && !state.audio.paused) || (!quiet.has(state.statusText ?? "") && Boolean(state.announcementText)), 20000);
  record.afterAttempt = after;
  const announcementAfter = await announcementLocator.elementHandle();
  assert.ok(announcementAfter, "the stable announcement node remains mounted after failure");
  record.announcementSameNode = await announcementBefore.evaluate((before, afterNode) => before === afterNode, announcementAfter);
  record.announcementConnected = await announcementBefore.evaluate((node) => node.isConnected);

  assert.ok(after.statusText, "the player status region must not be silent after a failed attempt");
  assert.ok(!quiet.has(after.statusText), `the status region must show an explicit error outcome, observed ${JSON.stringify(after.statusText)}`);
  assert.ok(typedOutcomes[locale].has(after.statusText), `the visible status must show the prepared localized failure sentence, observed ${JSON.stringify(after.statusText)}`);
  assert.equal(after.statusRole, null, "the visible status line stays plain text rather than being a second live region");
  assert.equal(after.statusAriaLive, null, "the visible status line has no aria-live behavior");
  assert.ok(after.announcementText, "the stable announcement node announces the failure");
  assert.equal(after.announcementText, after.statusText, "the stable announcement and visible failure use the same localized sentence");
  assert.equal(after.announcementRole, "status");
  assert.equal(after.announcementAriaLive, "polite");
  assert.equal(after.announcementAtomic, "true");
  assert.equal(record.announcementConnected, true, "the original announcement node remains connected after the failure");
  assert.equal(record.announcementSameNode, true, "the failure is announced through the same node mounted before playback");
  assert.ok(after.errorDetailsAction, "an explicit error must offer the Details / Download original fallback action");
  assert.ok(after.audio, "the player must own one audio element");
  assert.equal(after.audio.paused, true, "no audio element may claim to be playing the undecodable original");
  assert.equal(after.audio.currentTime, 0, "no playback position may be reported for the undecodable original");
  assert.equal(after.audio.srcAttribute, null, "a failed decode must release the obsolete media source (src attribute removed)");
  assert.equal(after.audio.networkState, 0, "the media element must return to NETWORK_EMPTY after the failure");
  assert.equal(after.toggleLabel, expected.playLabel, "the toggle must still offer Play, not Pause");
  assert.equal(after.identity, unsupportedName, "the player must retain the attempted identity and never silently substitute another track");
  assert.equal(after.queueItems.length, 2, "the queue must not be silently emptied or skipped");
  assert.equal(after.queueItems.filter((item) => item.current).length, 1, "exactly one queue occurrence may be current");
  assert.equal(after.queueItems[0].current, true, "the attempted renamed original stays the current occurrence");
  assert.equal(after.queueItems[1].current, false, "the app must not advance to the next occurrence as if playback had succeeded");
  assert.equal(after.queueItems[0].currentLabel, expected.currentTrack, "a failed attempt stays identified as the current track, not as playing");
  assert.equal(after.queueItems[1].currentLabel, null, "no other queue occurrence may be advertised as current or playing");

  // Independent oracle: the exact bytes the app downloaded are rejected by the
  // browser's own media pipeline, so the visible error is honest, not fabricated.
  const attempted = downloads.filter((value) => { try { return new URL(value).searchParams.get("filename") === unsupportedName; } catch { return false; } });
  assert.ok(attempted.length >= 1, `the failed attempt must download ${unsupportedName} through the ordinary verified-original route`);
  record.downloadURL = attempted.at(-1);
  record.oracle = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "same-origin" });
    const bytes = await response.arrayBuffer();
    const element = document.createElement("audio");
    element.preload = "auto";
    element.src = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    const outcome = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ event: "timeout" }), 10000);
      element.addEventListener("error", () => { clearTimeout(timer); resolve({ event: "error", code: element.error?.code ?? 0, message: element.error?.message ?? null }); }, { once: true });
      element.addEventListener("canplaythrough", () => { clearTimeout(timer); resolve({ event: "decoded" }); }, { once: true });
      element.load();
    });
    URL.revokeObjectURL(element.src);
    return { status: response.status, byteLength: bytes.byteLength, ...outcome };
  }, record.downloadURL);
  assert.equal(record.oracle.status, 200, "the ordinary download route returns the stored original");
  assert.equal(record.oracle.byteLength, unsupportedBytes.length, "the downloaded bytes are the exact stored original");
  assert.equal(record.oracle.event, "error", `the browser's own decoder must reject the renamed non-audio original, observed ${JSON.stringify(record.oracle)}`);
  assert.ok([3, 4].includes(record.oracle.code), `the browser must report a source/decode MediaError, observed code ${record.oracle.code}`);

  // Supported control: a real WAV must still play through the same player in this
  // environment, so the failure above is file-specific rather than a dead player.
  await page.locator(".global-audio-player .audio-player-queue-item").nth(1).locator(".audio-queue-play").click();
  const control = await waitForState(page, (state) => state.audio?.paused === false && state.audio.readyState >= 2 && state.toggleLabel === expected.pauseLabel, 20000);
  record.supportedControl = control;
  assert.ok(control.audio && control.audio.paused === false && control.audio.readyState >= 2, `a supported WAV must decode and play through the same player, observed ${JSON.stringify(control.audio)}`);
  assert.equal(control.toggleLabel, expected.pauseLabel, "the toggle must offer Pause while the supported original plays");
  assert.equal(control.announcementText, "", "routine WAV loading and playback do not populate the live announcement node");

  const queueSummary = page.locator(".global-audio-player .audio-player-queue > summary");
  const closeQueueIfOpen = async () => {
    const panel = page.locator(".global-audio-player .audio-player-queue-panel");
    if (await panel.isVisible()) await queueSummary.click();
    await panel.waitFor({ state: "hidden", timeout: 5000 });
  };
  await closeQueueIfOpen();

  const waitForActualStartPending = async (row, label, startAction) => {
    const start = await armNativePlayAckGate(page);
    if (startAction) await startAction();
    else await row.locator(".music-track-play").click();
    const ack = await waitForNativePlayAck(page, start);
    assert.equal(ack.delivered, false, "the native promise has settled but its acknowledgment to the app remains held");
    const pending = await waitForState(page, (state) =>
      state.identity === label && state.statusText === expected.starting && state.toggleLabel === expected.starting &&
      state.toggleDisabled && state.seekDisabled && !state.stopDisabled && state.audio?.paused === false && state.audio.readyState >= 2,
    20000);
    assert.equal(pending.announcementText, "", "pending native acknowledgment does not announce routine starting status");
    await page.evaluate(() => window.__cairnNativePlayAckGate.disarm());
    return { ack, pending };
  };

  // A fulfilled native promise is deliberately held at the boundary to the app.
  // The browser has already started the real WAV and emitted real media events;
  // the UI must remain pending until the actual acknowledgment is released.
  await page.locator(".global-audio-player .audio-player-toggle").click();
  await waitForState(page, (state) => state.audio?.paused === true && state.toggleLabel === expected.playLabel, 10000);
  const resumeSource = await page.locator(".global-audio-player audio").evaluate((audio) => audio.currentSrc);
  const originalDownloadCount = downloads.length;
  const pendingStart = await waitForActualStartPending(supportedRow, supportedName, () => page.locator(".global-audio-player .audio-player-toggle").click());
  assert.equal(pendingStart.pending.audio.currentSrc, resumeSource, "resuming uses the same verified Blob URL");
  assert.equal(downloads.length, originalDownloadCount, "resuming the same loaded original does not fetch it again");
  record.nativeStartPending = {
    actualAck: pendingStart.ack,
    sameBlobURL: pendingStart.pending.audio.currentSrc === resumeSource,
    additionalOriginalDownloads: downloads.length - originalDownloadCount,
    state: {
      identity: pendingStart.pending.identity,
      statusText: pendingStart.pending.statusText,
      toggleLabel: pendingStart.pending.toggleLabel,
      toggleDisabled: pendingStart.pending.toggleDisabled,
      seekDisabled: pendingStart.pending.seekDisabled,
      stopDisabled: pendingStart.pending.stopDisabled,
      audio: pendingStart.pending.audio,
      announcementText: pendingStart.pending.announcementText,
    },
  };
  await releaseNativePlayAck(page, pendingStart.ack.id);
  record.nativeStartReleased = await waitForState(page, (state) =>
    state.identity === supportedName && state.audio?.paused === false && state.audio.readyState >= 2 && state.toggleLabel === expected.pauseLabel,
  10000);
  record.nativeStartAckAfterRelease = await readNativePlayAck(page, pendingStart.ack.id);
  assert.equal(record.nativeStartAckAfterRelease.delivered, true);
  assert.equal(record.nativeStartReleased.statusText, expected.playing);

  // Stop fences a real, already-fulfilled but not-yet-delivered play() result.
  await closeQueueIfOpen();
  await page.locator(".global-audio-player .audio-player-toggle").click();
  await waitForState(page, (state) => state.audio?.paused === true && state.toggleLabel === expected.playLabel, 10000);
  let start = await armNativePlayAckGate(page);
  await supportedRow.locator(".music-track-play").click();
  const stopAck = await waitForNativePlayAck(page, start);
  const stopping = await waitForState(page, (state) => state.identity === supportedName && state.statusText === expected.starting && state.audio?.paused === false, 10000);
  assert.equal(stopping.toggleDisabled, true);
  assert.equal(stopping.stopDisabled, false, "Stop remains available while native acknowledgment is pending");
  await page.evaluate(() => window.__cairnNativePlayAckGate.disarm());
  await page.locator(".global-audio-player .audio-player-stop").click();
  const stoppedBeforeLateAck = await waitForState(page, (state) => state.identity === expected.idle && state.audio?.paused === true && state.audio.srcAttribute === null, 10000);
  await releaseNativePlayAck(page, stopAck.id);
  await page.waitForTimeout(150);
  record.stopLateAck = {
    actualAck: stopAck,
    ackAfterRelease: await readNativePlayAck(page, stopAck.id),
    beforeRelease: { identity: stoppedBeforeLateAck.identity, audio: stoppedBeforeLateAck.audio, queueItems: stoppedBeforeLateAck.queueItems },
    afterRelease: await readPlayerState(page),
  };
  assert.equal(record.stopLateAck.ackAfterRelease?.delivered, true);
  assert.equal(record.stopLateAck.afterRelease.identity, expected.idle, "a late fulfilled acknowledgment cannot resurrect audio after Stop");
  assert.equal(record.stopLateAck.afterRelease.audio?.srcAttribute, null);
  assert.equal(record.stopLateAck.afterRelease.audio?.paused, true);
  assert.equal(record.stopLateAck.afterRelease.queueItems.filter((item) => item.current).length, 0, "Stop retains the queue but clears its current occurrence");

  // Replacing A with B while A's fulfilled acknowledgment is held must not let
  // A's callback clear B's pending state or replace B's current identity.
  start = await armNativePlayAckGate(page);
  await supportedRow.locator(".music-track-play").click();
  const oldAck = await waitForNativePlayAck(page, start);
  const oldPending = await waitForState(page, (state) => state.identity === supportedName && state.statusText === expected.starting && state.audio?.paused === false, 10000);
  start = await page.evaluate(() => window.__cairnNativePlayAckGate.calls.length);
  await replacementRow.locator(".music-track-play").click();
  const replacementAck = await waitForNativePlayAck(page, start);
  const replacementPending = await waitForState(page, (state) => state.identity === replacementName && state.statusText === expected.starting && state.audio?.paused === false && state.audio.readyState >= 2, 20000);
  await page.evaluate(() => window.__cairnNativePlayAckGate.disarm());
  await releaseNativePlayAck(page, oldAck.id);
  await page.waitForTimeout(150);
  const afterOldAck = await readPlayerState(page);
  assert.equal(afterOldAck.identity, replacementName, "the stale acknowledgment for A cannot replace B's identity");
  assert.equal(afterOldAck.statusText, expected.starting, "A's stale acknowledgment cannot clear B's pending state");
  assert.equal(afterOldAck.toggleDisabled, true, "B's start control remains fenced after A settles");
  assert.equal(afterOldAck.audio?.paused, false);
  await releaseNativePlayAck(page, replacementAck.id);
  record.replacementLateAck = {
    oldActualAck: oldAck,
    oldAckAfterRelease: await readNativePlayAck(page, oldAck.id),
    replacementActualAck: replacementAck,
    replacementAckAfterRelease: await readNativePlayAck(page, replacementAck.id),
    beforeReplacement: { identity: oldPending.identity, statusText: oldPending.statusText },
    replacementPending: { identity: replacementPending.identity, statusText: replacementPending.statusText, readyState: replacementPending.audio?.readyState },
    afterOldAck,
    afterReplacementAck: await waitForState(page, (state) => state.identity === replacementName && state.audio?.paused === false && state.audio.readyState >= 2 && state.toggleLabel === expected.pauseLabel, 10000),
  };
  assert.equal(record.replacementLateAck.oldAckAfterRelease?.delivered, true);
  assert.equal(record.replacementLateAck.replacementAckAfterRelease?.delivered, true);
  assert.equal(record.replacementLateAck.afterReplacementAck.identity, replacementName, "B remains current after its own acknowledgment is delivered");
  assert.equal(record.replacementLateAck.afterReplacementAck.statusText, expected.playing);
  assert.equal(record.replacementLateAck.afterReplacementAck.announcementText, "", "routine replacement playback remains silent to the live region");
  await page.locator(".global-audio-player .audio-player-stop").click();
  record.repeatPath = { outcome: "NOT RUN", reason: "The bounded lifecycle flow does not exercise queue repeat mode." };
}

try {
  const portProbe = createServer();
  await new Promise((resolveProbe, rejectProbe) => {
    portProbe.once("error", rejectProbe);
    portProbe.listen(port, "127.0.0.1", resolveProbe);
  });
  await new Promise((resolveProbe, rejectProbe) => portProbe.close((error) => error ? rejectProbe(error) : resolveProbe()));

  const temp = await mkdtemp(join(tmpdir(), "cairn-audio-unsupported-"));
  try {
    const daemonBin = join(temp, "cairnd");
    const cairnBin = join(temp, "cairn");
    for (const [bin, pkg] of [[daemonBin, "./server/cmd/cairnd"], [cairnBin, "./client/cmd/cairn"]]) {
      const built = spawnSync("go", ["build", "-tags", "purego", "-o", bin, pkg], { cwd: repo, stdio: "inherit" });
      assert.equal(built.status, 0, `build ${pkg}`);
    }

    const source = join(temp, "qa-source");
    await mkdir(source);
    await writeFile(join(source, supportedName), supportedBytes);
    await writeFile(join(source, replacementName), replacementBytes);
    await writeFile(join(source, unsupportedName), unsupportedBytes);

    const config = join(temp, "config.toml");
    const init = spawnSync(cairnBin, ["config", "init", "--path", config], { cwd: repo, stdio: "ignore" });
    assert.equal(init.status, 0, "initialize temporary config");
    const env = { ...process.env, CAIRN_CATALOG: join(temp, "catalog.sqlite"), CAIRN_REPOSITORY: join(temp, "repository"), CAIRN_VECTORS: join(temp, "vectors"), CAIRN_MODELS: join(temp, "models"), CAIRN_RECOVERY_RECORDS: join(temp, "recovery") };
    const daemonLogFD = openSync(join(temp, "daemon.log"), "a");
    daemon = spawn(daemonBin, ["--config", config, "--socket", join(temp, "daemon.sock"), "--api-listen", `127.0.0.1:${port}`, "--web-root", webRoot], { cwd: repo, env, stdio: ["ignore", daemonLogFD, daemonLogFD] });
    await new Promise((resolveSpawn, rejectSpawn) => { daemon.once("spawn", resolveSpawn); daemon.once("error", rejectSpawn); });
    base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 120; i += 1) {
      assert.equal(daemon.exitCode, null, "the isolated daemon process remains alive while its API starts");
      try { if ((await fetch(`${base}/api/v1/healthz`)).ok) break; } catch { /* not ready yet */ }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      assert.ok(i < 119, "temporary daemon becomes ready");
    }

    const command = async (operation, input = {}) => {
      const response = await fetch(`${base}/api/v1/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, input }) });
      const body = await response.json();
      assert.ok(body.status === "SUCCEEDED" || (operation === "plan.apply" && body.status === "DEGRADED"), `${operation}: ${JSON.stringify(body.reasons ?? [])}`);
      return body.data;
    };
    const plan = await command("plan.ingest", { root: source });
    assert.equal(plan.executable, true, "fixture ingest plan is executable");
    const applied = await command("plan.apply", { workspace_id: plan.workspace_id, plan_id: plan.plan_id, plan_digest: plan.plan_digest });
    assert.ok(["SUCCEEDED", "DEGRADED"].includes(applied.state), "exact QA ingest publication completes even if a derived processor is unavailable");

    browser = await chromium.launch({ headless: true, executablePath: chrome });
    for (const locale of ["en", "zh-CN"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale });
      try {
        observed[locale] = {};
        await observeAttempt(page, locale, observed[locale]);
      } finally {
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    if (daemon && daemon.exitCode === null && daemon.signalCode === null) { daemon.kill("SIGTERM"); await new Promise((resolveWait) => daemon.once("exit", resolveWait)); }
    try { daemonLog = await readFile(join(temp, "daemon.log"), "utf8"); } catch { /* no log */ }
    await rm(temp, { recursive: true, force: true });
  }
} catch (error) {
  failure = error;
}

for (const locale of ["en", "zh-CN"]) {
  const record = observed[locale];
  if (!record) { console.log(`--- ${locale} --- (not reached)`); continue; }
  console.log(`--- ${locale} ---`);
  console.log(`  music rows                : ${JSON.stringify(record.rows)}`);
  console.log(`  renamed row play enabled  : ${record.unsupportedRowPlayEnabled}`);
  console.log(`  queue before attempt      : ${JSON.stringify(record.queueBeforeAttempt)} (${JSON.stringify(record.queueSummaryBeforeAttempt)})`);
  console.log(`  status text               : ${JSON.stringify(record.afterAttempt?.statusText)}`);
  console.log(`  visible status attributes : role=${JSON.stringify(record.afterAttempt?.statusRole)} aria-live=${JSON.stringify(record.afterAttempt?.statusAriaLive)}`);
  console.log(`  stable announcement       : before=${JSON.stringify(record.announcementBefore)} exposed=${record.announcementExposedAtIdle} afterQueue=${record.announcementTextAfterQueue} sameAfterQueue=${record.announcementSameAfterQueue} after=${JSON.stringify(record.afterAttempt && { text: record.afterAttempt.announcementText, role: record.afterAttempt.announcementRole, ariaLive: record.afterAttempt.announcementAriaLive, atomic: record.afterAttempt.announcementAtomic })} sameAfterFailure=${record.announcementSameNode} connected=${record.announcementConnected}`);
  console.log(`  audio element             : ${JSON.stringify(record.afterAttempt?.audio)}`);
  console.log(`  toggle label              : ${JSON.stringify(record.afterAttempt?.toggleLabel)}`);
  console.log(`  player identity           : ${JSON.stringify(record.afterAttempt?.identity)}`);
  console.log(`  Details/Download action   : ${record.afterAttempt?.errorDetailsAction}`);
  console.log(`  queue after attempt       : ${JSON.stringify(record.afterAttempt?.queueItems)} (${JSON.stringify(record.afterAttempt?.queueSummary)})`);
  console.log(`  downloaded original       : ${JSON.stringify(record.oracle)}`);
  console.log(`  supported control         : status=${JSON.stringify(record.supportedControl?.statusText)} audio=${JSON.stringify(record.supportedControl?.audio)} toggle=${JSON.stringify(record.supportedControl?.toggleLabel)}`);
  console.log(`  pending native start      : ${JSON.stringify(record.nativeStartPending)}`);
  console.log(`  released native start     : ${JSON.stringify(record.nativeStartReleased && { identity: record.nativeStartReleased.identity, statusText: record.nativeStartReleased.statusText, toggleLabel: record.nativeStartReleased.toggleLabel, audio: record.nativeStartReleased.audio })}`);
  console.log(`  Stop late acknowledgment  : ${JSON.stringify(record.stopLateAck)}`);
  console.log(`  replacement late ack      : ${JSON.stringify(record.replacementLateAck)}`);
  console.log(`  queue repeat path         : ${JSON.stringify(record.repeatPath)}`);
}

// These three started life as diagnostics, because the player used to render the
// internal code in English and keep its status line out of the accessibility
// tree. Both were fixed, so they are now invariants of the scenario this harness
// exists to prove: a regression must fail the run rather than print a note a
// reader can miss. The exact localized sentence is expected here because the
// fixture provokes exactly one outcome, `unsupported-format`.
const presentationDefects = [];
const missingLiveRegion = ["en", "zh-CN"].filter((locale) => Boolean(observed[locale]?.afterAttempt) && (observed[locale].afterAttempt.announcementRole !== "status" || observed[locale].afterAttempt.announcementAriaLive !== "polite"));
if (missingLiveRegion.length) {
  presentationDefects.push(`the stable error announcement node carried no role="status"/aria-live in ${missingLiveRegion.join(", ")}, so the failure is not announced to assistive technology`);
}
const errorKeys = new Set(["unsupported-format", "identity-unavailable", "size-limit", "length-mismatch", "hash-mismatch", "empty-response", "playback-failed", "playback-permission", "workspace-mismatch", "track-unavailable"]);
const keyLeaks = ["en", "zh-CN"].filter((locale) => {
  const text = observed[locale]?.afterAttempt?.statusText ?? "";
  return errorKeys.has(text) || playbackErrorCodeShape.test(text);
});
if (keyLeaks.length) {
  presentationDefects.push(`the status region rendered an internal code instead of a human sentence in ${keyLeaks.join(", ")}: ${JSON.stringify(keyLeaks.map((locale) => observed[locale].afterAttempt.statusText))}`);
}
const unexpectedOutcomes = ["en", "zh-CN"].filter((locale) => {
  const text = observed[locale]?.afterAttempt?.statusText;
  return Boolean(text) && !typedOutcomes[locale].has(text) && !keyLeaks.includes(locale);
});
if (unexpectedOutcomes.length) {
  presentationDefects.push(`the status region showed neither the prepared outcome nor a code in ${unexpectedOutcomes.join(", ")}: ${JSON.stringify(unexpectedOutcomes.map((locale) => observed[locale].afterAttempt.statusText))}`);
}
if (presentationDefects.length && !failure) failure = new Error(presentationDefects.join("; "));

if (failure) {
  console.error(`FAIL: ${failure.message}`);
  if (daemonLog.trim()) console.error(`--- isolated daemon log (tail) ---\n${daemonLog.trim().split("\n").slice(-20).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`PASS: a real renamed non-audio original reached the player as an explicit error in both locales; the pre-mounted live node announced it while visible status stayed plain text, no silent queue advance occurred, browser decode rejected the exact original, and real WAV native-start pending/ack, Stop fencing, and replacement fencing were observed.`);
}
