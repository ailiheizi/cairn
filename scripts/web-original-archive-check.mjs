import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "../web/node_modules/typescript/lib/typescript.js";

globalThis.crypto ??= webcrypto;
const source = await readFile(new URL("../web/src/lib/originalArchive.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const moduleURL = `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const { buildStoredZip, captureArchiveSelection, materializeVerifiedArchive, readBoundedOriginalResponse, releaseDownloadLease, resolveArchiveSelectionSizes, sha256ContentID, validateFrozenArchiveItems, ORIGINAL_ARCHIVE_LIMITS } = await import(moduleURL);
const id = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const emptyHash = id(Buffer.alloc(0));
const alpha = Buffer.from("hello original\n");
const captured = captureArchiveSelection([
  { subject_ref: "nse_a", entry_id: "entry_a", entry_type: "REGULAR_FILE", name: "same.txt", content_id: id(alpha), logical_size: alpha.length },
  { subject_ref: "nse_b", entry_id: "entry_b", entry_type: "REGULAR_FILE", name: "empty.txt", content_id: emptyHash, logical_size: 0 },
]);
const unknownSizeHit = { subject_ref: "subject-x", entry_id: "entry-x", entry_type: "REGULAR_FILE", name: "chosen.txt", content_id: id(alpha) };
const matchingLoadedHit = { ...unknownSizeHit, logical_size: alpha.length };
const enriched = resolveArchiveSelectionSizes([unknownSizeHit], [matchingLoadedHit]);
assert.equal(enriched.length, 1);
assert.equal(enriched[0].logical_size, alpha.length);
assert.equal(enriched[0].name, unknownSizeHit.name);
assert.equal(enriched[0].entry_id, unknownSizeHit.entry_id);
assert.deepEqual(resolveArchiveSelectionSizes([unknownSizeHit], [{ ...matchingLoadedHit, entry_id: "other-entry" }]), [unknownSizeHit]);
assert.deepEqual(resolveArchiveSelectionSizes([unknownSizeHit], [{ ...matchingLoadedHit, content_id: emptyHash }]), [unknownSizeHit]);
assert.deepEqual(resolveArchiveSelectionSizes([unknownSizeHit], []), [unknownSizeHit]);
const frozen = validateFrozenArchiveItems([
  JSON.stringify({ subject_ref: "entry_a", output_name: "same.txt", content_id: id(alpha), logical_size: alpha.length, exact: true }),
  JSON.stringify({ subject_ref: "entry_b", output_name: "empty.txt", content_id: emptyHash, exact: true }),
], captured);
assert.equal(frozen[1].logical_size, 0, "omitted logical_size preserves valid empty files");
assert.equal(await sha256ContentID(new Uint8Array(alpha)), id(alpha));
assert.throws(() => captureArchiveSelection([{ ...captured[0], entry_type: "REGULAR_FILE", logical_size: undefined }]), /known nonnegative/);
assert.throws(() => captureArchiveSelection([{ ...captured[0], entry_type: "REGULAR_FILE", logical_size: ORIGINAL_ARCHIVE_LIMITS.perFileBytes + 1 }]), /32 MiB/);
assert.throws(() => validateFrozenArchiveItems(["{" , frozen[1]], captured), /invalid/);
assert.throws(() => validateFrozenArchiveItems([
  JSON.stringify({ ...frozen[0], subject_ref: "stale-entry" }), JSON.stringify({ ...frozen[1] }),
], captured), /changed or omitted/);
assert.throws(() => validateFrozenArchiveItems([
  JSON.stringify({ ...frozen[0], output_name: "../escape" }), JSON.stringify({ ...frozen[1] }),
], captured), /changed or omitted/);
assert.throws(() => validateFrozenArchiveItems([
  JSON.stringify({ ...frozen[0], output_name: "SAME.TXT" }), JSON.stringify({ ...frozen[1], output_name: "same.txt" }),
], captured), /colliding/);
assert.throws(() => validateFrozenArchiveItems([JSON.stringify(frozen[0])], captured), /every selected/);
assert.throws(() => buildStoredZip([
  { name: "x", bytes: new Uint8Array(ORIGINAL_ARCHIVE_LIMITS.totalBytes) },
  { name: "y", bytes: new Uint8Array(1) },
]), /limits/);

let streamCancelled = false;
const oversizedStream = new ReadableStream({
  start(controller) { controller.enqueue(new Uint8Array([1, 2])); },
  cancel() { streamCancelled = true; },
});
await assert.rejects(readBoundedOriginalResponse(new Response(oversizedStream, { headers: { "Content-Length": "1" } }), 1, new AbortController().signal), /exceeded/);
assert.equal(streamCancelled, true, "overflow cancels the underlying response reader");
let rejectedResponseCancelled = false;
const rejectedResponseStream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { rejectedResponseCancelled = true; } });
await assert.rejects(readBoundedOriginalResponse(new Response(rejectedResponseStream, { headers: { "Content-Length": "9" } }), 1, new AbortController().signal), /length/);
assert.equal(rejectedResponseCancelled, true, "a rejected response header cancels its unread body");
const released = [];
releaseDownloadLease("blob:archive", 17, (url) => released.push(["revoke", url]), (timer) => released.push(["clear", timer]));
assert.deepEqual(released, [["clear", 17], ["revoke", "blob:archive"]], "lease cleanup clears its timer and revokes the object URL");

const controller = new AbortController();
const zip = await materializeVerifiedArchive(frozen, async (item) => item.subject_ref === "entry_a" ? new Uint8Array(alpha) : new Uint8Array(), controller.signal, () => {});
const dir = await mkdtemp(join(tmpdir(), "rw-original-zip-"));
try {
  const zipPath = join(dir, "takeout.zip");
  await writeFile(zipPath, zip);
  const verify = spawnSync("python3", ["-c", `import hashlib, json, sys, zipfile\np=sys.argv[1]\nwith zipfile.ZipFile(p) as z:\n names=z.namelist()\n assert names == ['same.txt','empty.txt'], names\n values={name:z.read(name) for name in names}\n expected=json.loads(sys.argv[2])\n for name, (size,digest) in expected.items():\n  data=values[name]\n  assert len(data)==size, (name,len(data),size)\n  assert hashlib.sha256(data).hexdigest()==digest.removeprefix('sha256:'), name\n print('PASS ZIP entries, UTF-8 names, lengths and SHA-256')`, zipPath, JSON.stringify({ "same.txt": [alpha.length, id(alpha)], "empty.txt": [0, emptyHash] })], { encoding: "utf8" });
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  assert.match(verify.stdout, /PASS ZIP entries/);

  let saveRequested = false;
  await assert.rejects(materializeVerifiedArchive(frozen, async (item) => item.subject_ref === "entry_a" ? new Uint8Array(alpha) : new Uint8Array([1]), new AbortController().signal, () => {}).then((result) => { saveRequested = true; return result; }), /identity/);
  assert.equal(saveRequested, false, "a failed member never reaches the save step");
  const aborted = new AbortController();
  aborted.abort();
  saveRequested = false;
  await assert.rejects(materializeVerifiedArchive(frozen, async () => new Uint8Array(), aborted.signal, () => {}).then((result) => { saveRequested = true; return result; }), /Cancelled/);
  assert.equal(saveRequested, false, "cancellation never reaches the save step");
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("PASS bounded selection, manifest binding, stale/malformed/collision/byte-limit refusal, zero-byte identity, ZIP extraction, failure and cancellation boundaries");
