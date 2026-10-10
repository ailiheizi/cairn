// Focused lifecycle contract check for the real bounded audio download helper.
// TypeScript is transpiled for Node; the imported helper implementation itself
// is unchanged and all network responses are supplied by this script.
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "../web/node_modules/typescript/lib/typescript.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const operationsSource = await readFile(new URL("../web/src/lib/operations.ts", import.meta.url), "utf8");
const operationsURL = `data:text/javascript;base64,${Buffer.from(transpile(operationsSource)).toString("base64")}`;
const helperSource = await readFile(new URL("../web/src/lib/audioPlayback.ts", import.meta.url), "utf8");
const linkedHelper = transpile(helperSource).replaceAll('"./operations"', JSON.stringify(operationsURL));
const helperURL = `data:text/javascript;base64,${Buffer.from(linkedHelper).toString("base64")}`;
const { AUDIO_PLAYBACK_LIMIT, fetchVerifiedAudio } = await import(helperURL);

const bytes = new TextEncoder().encode("restoreweave bounded playback");
const digest = createHash("sha256").update(bytes).digest("hex");
const track = (overrides = {}) => ({
  workspaceID: "workspace-test",
  entryID: "entry-test",
  name: "sample.mp3",
  contentID: `sha256:${digest}`,
  logicalSize: bytes.byteLength,
  ...overrides,
});
const response = (body, headers = {}) => new Response(body, { status: 200, headers });
const originalFetch = globalThis.fetch;
try {
  // Complete body: verify exact length and SHA-256 before returning audio MIME.
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: new URL(url, "http://restoreweave.local"), options };
    return response(bytes, { "Content-Length": String(bytes.byteLength) });
  };
  const blob = await fetchVerifiedAudio(track(), new AbortController().signal);
  assert.equal(blob.type, "audio/mpeg");
  assert.equal(blob.size, bytes.byteLength);
  assert.equal(request.url.pathname, "/api/v1/download");
  assert.deepEqual(Object.fromEntries(request.url.searchParams), {
    workspace_id: "workspace-test", entry_id: "entry-test", filename: "sample.mp3",
  });
  assert.equal(request.options.credentials, "same-origin");

  let fetchCount = 0;
  // A wrong digest with the canonical wire prefix reaches content and fails
  // the byte check; malformed identity encodings fail before network access.
  globalThis.fetch = async () => { fetchCount++; return response(bytes); };
  await assert.rejects(fetchVerifiedAudio(track({ contentID: `sha256:${"0".repeat(64)}` }), new AbortController().signal), /hash-mismatch/);
  assert.equal(fetchCount, 1);
  globalThis.fetch = async () => { fetchCount++; throw new Error("unexpected fetch"); };
  for (const contentID of [digest, `sha512:${digest}`, `sha256:${"z".repeat(64)}`]) {
    await assert.rejects(fetchVerifiedAudio(track({ contentID }), new AbortController().signal), /identity-unavailable/);
  }
  assert.equal(fetchCount, 1, "bare digest and noncanonical prefixes must be rejected before fetch");

  // Known oversize input is rejected before making a request.
  await assert.rejects(fetchVerifiedAudio(track({ logicalSize: AUDIO_PLAYBACK_LIMIT + 1 }), new AbortController().signal), /size-limit/);
  assert.equal(fetchCount, 1, "known oversize audio must not start a download");

  // Even a falsely small declared size cannot bypass the streamed byte ceiling.
  let streamCancelled = false;
  globalThis.fetch = async () => response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(AUDIO_PLAYBACK_LIMIT + 1)); },
    cancel() { streamCancelled = true; },
  }));
  await assert.rejects(fetchVerifiedAudio(track({ logicalSize: 1 }), new AbortController().signal), /size-limit/);
  assert.equal(streamCancelled, true, "over-limit response stream must be cancelled");

  // A complete body with the wrong expected logical length is rejected.
  globalThis.fetch = async () => response(bytes);
  await assert.rejects(fetchVerifiedAudio(track({ logicalSize: bytes.byteLength + 1 }), new AbortController().signal), /length-mismatch/);

  // AbortSignal is passed into the actual fetch and a pending request rejects on cancellation.
  let receivedSignal;
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    receivedSignal = options.signal;
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const controller = new AbortController();
  const pending = fetchVerifiedAudio(track(), controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  assert.equal(receivedSignal, controller.signal);
  await assert.rejects(pending, { name: "AbortError" });

  // Abort after headers while a body read is pending; no partial Blob may escape.
  let bodyController;
  let bodyAbortObserved = false;
  globalThis.fetch = async (_url, options) => {
    const body = new ReadableStream({
      start(controller) { bodyController = controller; },
    });
    options.signal.addEventListener("abort", () => {
      bodyAbortObserved = true;
      bodyController.error(new DOMException("Aborted", "AbortError"));
    }, { once: true });
    return response(body);
  };
  const bodyControllerSignal = new AbortController();
  const bodyPending = fetchVerifiedAudio(track(), bodyControllerSignal.signal);
  await new Promise((resolve) => setImmediate(resolve));
  bodyControllerSignal.abort();
  await assert.rejects(bodyPending, { name: "AbortError" });
  assert.equal(bodyAbortObserved, true, "abort signal must reach an in-progress body read");

  console.log("PASS: canonical identity, verified bytes/MIME, hash rejection, malformed identity and known oversize pre-fetch refusal, stream ceiling/cancel, length mismatch and AbortSignal propagation.");
} finally {
  globalThis.fetch = originalFetch;
}
