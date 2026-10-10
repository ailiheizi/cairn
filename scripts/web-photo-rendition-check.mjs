// Focused transport/parser/cap check for transient large-photo previews.
// This does not exercise a browser decoder or claim real UI image rendering.
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "../web/node_modules/typescript/lib/typescript.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const lib = new URL("../web/src/lib/", import.meta.url);
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const dataURL = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const operationsSource = await readFile(new URL("operations.ts", lib), "utf8");
const operationsURL = dataURL(transpile(operationsSource));
const source = await readFile(new URL("photoRendition.ts", lib), "utf8");
const linked = transpile(source).replaceAll('"./operations"', JSON.stringify(operationsURL));
const api = await import(dataURL(linked));

function pngHeader(width, height) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  view.setUint32(29, crc32(bytes.subarray(12, 29)));
  return bytes;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function jpegSOF(width, height) {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 7, 8, height >> 8, height & 255, width >> 8, width & 255]);
}
assert.deepEqual(api.parsePhotoDimensions(pngHeader(1800, 1200), "image/png"), { width: 1800, height: 1200, mime: "image/png" });
assert.deepEqual(api.parsePhotoDimensions(jpegSOF(2048, 1024), "image/jpeg"), { width: 2048, height: 1024, mime: "image/jpeg" });
assert.throws(() => api.parsePhotoDimensions(pngHeader(5000, 3000), "image/png"), /12-megapixel/);
assert.throws(() => api.parsePhotoDimensions(pngHeader(9000, 100), "image/png"), /12-megapixel/);
assert.throws(() => api.parsePhotoDimensions(new Uint8Array(32), "image/jpeg"), /malformed/);
const brokenPNG = pngHeader(100, 100); brokenPNG[29] ^= 1;
assert.throws(() => api.parsePhotoDimensions(brokenPNG, "image/png"), /malformed/);

const body = new Uint8Array((1 << 20) + 3);
for (let index = 0; index < body.length; index++) body[index] = index % 251;
const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
const request = (overrides = {}) => ({
  workspaceID: "workspace-one", entryID: "entry-one", subjectRef: "subject-one", contentID: digest,
  logicalSize: body.byteLength, command: async () => ({ status: "SUCCEEDED", data: {} }), ...overrides,
});
function exactCommand(bytes, { fault = "", readGate, contentID = digest } = {}) {
  const closed = [];
  const reads = [];
  const command = async (operation, input) => {
    if (operation === "content.open") return { status: "SUCCEEDED", data: { handle: "private-handle", entry_id: "entry-one", subject_ref: "subject-one", content_id: contentID, logical_size: bytes.length, max_read: 1 << 20 } };
    if (operation === "content.close") { closed.push(input.handle); return { status: "SUCCEEDED", data: { closed: true } }; }
    if (operation === "content.read") {
      reads.push({ ...input });
      if (readGate && input.offset === 0) return await readGate(input);
      const start = input.offset;
      const end = start + input.length;
      const chunk = bytes.slice(start, end);
      return { status: "SUCCEEDED", data: {
        handle: input.handle,
        offset: fault === "offset" ? start + 1 : start,
        length: fault === "length" ? chunk.length - 1 : chunk.length,
        eof: fault === "eof" ? !((end) === bytes.length) : end === bytes.length,
        bytes: Buffer.from(chunk).toString("base64"),
      } };
    }
    throw new Error(`Unexpected operation ${operation}`);
  };
  return { command, closed, reads };
}

const happy = exactCommand(body);
const exactBytes = await api.readVerifiedPhotoOriginal(request({ command: happy.command }), new AbortController().signal);
assert.deepEqual(exactBytes, body);
assert.deepEqual(happy.reads.map((item) => item.length), [1 << 20, 3], "each content.read stays within the host's 1 MiB chunk cap");
assert.deepEqual(happy.closed, ["private-handle"], "successful reads close their scoped session");

for (const fault of ["offset", "length", "eof"]) {
  const broken = exactCommand(body, { fault });
  await assert.rejects(api.readVerifiedPhotoOriginal(request({ command: broken.command }), new AbortController().signal), /byte range/);
  assert.deepEqual(broken.closed, ["private-handle"], `${fault} failures still close the session`);
}

const wrongDigest = `sha256:${"0".repeat(64)}`;
const hashFailure = exactCommand(body);
await assert.rejects(api.readVerifiedPhotoOriginal(request({ contentID: wrongDigest, command: hashFailure.command }), new AbortController().signal), /does not match/);
assert.deepEqual(hashFailure.closed, ["private-handle"]);
const changedBody = body.slice(); changedBody[0] ^= 1;
const actualDigest = `sha256:${createHash("sha256").update(changedBody).digest("hex")}`;
const hashCheck = exactCommand(body, { contentID: actualDigest });
await assert.rejects(api.readVerifiedPhotoOriginal(request({ contentID: actualDigest, command: hashCheck.command }), new AbortController().signal), /SHA-256 verification/);
assert.deepEqual(hashCheck.closed, ["private-handle"]);

let finishPendingRead;
const pending = exactCommand(body, { readGate: (input) => new Promise((resolve) => {
  finishPendingRead = () => {
    const chunk = body.slice(input.offset, input.offset + input.length);
    resolve({ status: "SUCCEEDED", data: { handle: input.handle, offset: input.offset, length: chunk.length, eof: false, bytes: Buffer.from(chunk).toString("base64") } });
  };
}) });
const controller = new AbortController();
const pendingRead = api.readVerifiedPhotoOriginal(request({ command: pending.command }), controller.signal);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(typeof finishPendingRead, "function");
controller.abort();
finishPendingRead();
await assert.rejects(pendingRead, { name: "AbortError" });
assert.deepEqual(pending.closed, ["private-handle"], "cancellation after a read still closes the handle");

let activeSessions = 0;
let maximumActiveSessions = 0;
let openCount = 0;
const blockedFirstReads = [];
const concurrentCommand = async (operation, input) => {
  if (operation === "content.open") {
    const handle = `concurrent-${++openCount}`;
    activeSessions++;
    maximumActiveSessions = Math.max(maximumActiveSessions, activeSessions);
    return { status: "SUCCEEDED", data: { handle, entry_id: "entry-one", subject_ref: "subject-one", content_id: digest, logical_size: body.length, max_read: 1 << 20 } };
  }
  if (operation === "content.close") { activeSessions--; return { status: "SUCCEEDED", data: { closed: true } }; }
  if (operation === "content.read") {
    if (input.offset === 0) return await new Promise((resolve) => blockedFirstReads.push(() => {
      const chunk = body.slice(0, input.length);
      resolve({ status: "SUCCEEDED", data: { handle: input.handle, offset: 0, length: chunk.length, eof: false, bytes: Buffer.from(chunk).toString("base64") } });
    }));
    const chunk = body.slice(input.offset, input.offset + input.length);
    return { status: "SUCCEEDED", data: { handle: input.handle, offset: input.offset, length: chunk.length, eof: true, bytes: Buffer.from(chunk).toString("base64") } };
  }
  throw new Error(`Unexpected operation ${operation}`);
};
const thirdController = new AbortController();
let activeOriginalBuffers = 0;
let maximumOriginalBuffers = 0;
let activeDecodes = 0;
let maximumDecodes = 0;
const blockedDecodes = [];
const pipeline = (signal) => api.photoRenditionPipeline(signal, async () => {
  const bytes = await api.readVerifiedPhotoOriginal(request({ command: concurrentCommand }), signal);
  activeOriginalBuffers++;
  maximumOriginalBuffers = Math.max(maximumOriginalBuffers, activeOriginalBuffers);
  try {
    await api.photoDecodeGate(signal, () => new Promise((resolve) => {
      activeDecodes++;
      maximumDecodes = Math.max(maximumDecodes, activeDecodes);
      blockedDecodes.push(() => { activeDecodes--; resolve(); });
    }));
    return bytes;
  } finally { activeOriginalBuffers--; }
});
const concurrentReads = [pipeline(new AbortController().signal), pipeline(new AbortController().signal), pipeline(thirdController.signal)];
for (let count = 0; blockedFirstReads.length < 2 && count < 40; count++) await new Promise((resolve) => setImmediate(resolve));
assert.equal(openCount, 2, "only two original sessions may be active while reads are pending");
thirdController.abort();
await assert.rejects(concurrentReads[2], { name: "AbortError" }, "an offscreen queued photo is cancelled before opening a session");
blockedFirstReads.splice(0).forEach((release) => release());
for (let count = 0; blockedDecodes.length < 1 && count < 40; count++) await new Promise((resolve) => setImmediate(resolve));
assert.equal(blockedDecodes.length, 1, "only one decode may be active");
for (let count = 0; count < 40 && activeOriginalBuffers < 2; count++) await new Promise((resolve) => setImmediate(resolve));
assert.equal(activeOriginalBuffers, 2, "both pipeline slots can hold at most two live originals including one waiting for decode");
blockedDecodes.shift()();
for (let count = 0; blockedDecodes.length < 1 && count < 40; count++) await new Promise((resolve) => setImmediate(resolve));
blockedDecodes.shift()();
await Promise.all(concurrentReads.slice(0, 2));
assert.equal(maximumActiveSessions, 2);
assert.equal(openCount, 2, "the aborted queued request never opens a content session");
assert.equal(maximumOriginalBuffers, 2, "no more than two original buffers can be retained during the full pipeline");
assert.equal(maximumDecodes, 1, "no more than one decode runs at a time");

await assert.rejects(api.readVerifiedPhotoOriginal(request({ logicalSize: 1 << 20 }), new AbortController().signal), /between 1 and 8 MiB/);
await assert.rejects(api.readVerifiedPhotoOriginal(request({ logicalSize: (8 << 20) + 1 }), new AbortController().signal), /between 1 and 8 MiB/);
await assert.rejects(api.readVerifiedPhotoOriginal(request({ contentID: "bare-hash" }), new AbortController().signal), /between 1 and 8 MiB/);

for (let index = 0; index <= api.PHOTO_RENDITION_CACHE_LIMIT; index++) {
  const id = `sha256:${index.toString(16).padStart(64, "0")}`;
  api.cachePhotoRendition(id, new Blob([new Uint8Array(256)]));
}
assert.equal(api.cachedPhotoRendition(`sha256:${"0".repeat(64)}`), undefined, "the 48-entry rendition LRU evicts its oldest object");
assert.equal(api.cachedPhotoRendition(`sha256:${api.PHOTO_RENDITION_CACHE_LIMIT.toString(16).padStart(64, "0")}`).size, 256);
const overCacheLimit = `sha256:${"f".repeat(64)}`;
api.cachePhotoRendition(overCacheLimit, new Blob([new Uint8Array(api.PHOTO_RENDITION_MAX_BYTES + 1)]));
assert.equal(api.cachedPhotoRendition(overCacheLimit), undefined, "rendition cache rejects any encoded output over 512 KiB");

console.log("PASS: PNG IHDR CRC/JPEG dimension preflight and pixel ceilings; scoped exact read identity, 1 MiB ranges, offsets/length/eof, SHA-256, session close on success/failure/cancel; at most two live full-original pipelines and one decode; known 1–8 MiB/canonical identity gate; 48-entry rendition-only LRU. Browser decode/orientation remains for real-browser acceptance.");
