import assert from "node:assert/strict";
import { build } from "../web/node_modules/esbuild/lib/main.js";

const bundle = await build({ entryPoints: ["web/src/lib/resultScope.ts", "web/src/lib/hashView.ts"], bundle: true, format: "esm", platform: "node", outdir: "virtual", write: false });
async function load(entry) {
  const file = bundle.outputFiles.find((candidate) => candidate.path.endsWith(`/${entry}.js`));
  assert.ok(file, `compiled ${entry} module exists`);
  return import(`data:text/javascript;base64,${Buffer.from(file.text).toString("base64")}`);
}
const scope = await load("resultScope");
const hashes = await load("hashView");
const photo = { subject_ref: "photo", entry_id: "e1", entry_type: "REGULAR_FILE", name: "one.jpg" };
const audio = { subject_ref: "audio", entry_id: "e2", entry_type: "REGULAR_FILE", name: "two.mp3" };
const other = { subject_ref: "doc", entry_id: "e3", entry_type: "REGULAR_FILE", name: "three.txt" };
const rows = [photo, audio, other];
assert.deepEqual(scope.resultScopeSource("search", rows, [other]), rows, "search scope retains the returned relevance set");
assert.deepEqual(scope.projectResultScope(rows, "photos"), [photo], "Photos is a projection over the full search scope");
assert.deepEqual(scope.projectResultScope(rows, "music"), [audio], "Music is a projection over the same scope");
assert.deepEqual(scope.projectResultScope(rows, "content"), rows, "All types restores the same full scope");
assert.equal(scope.projectResultScope(rows, "photos")[0], photo, "projection preserves source row identity");
assert.deepEqual(scope.resultScopeSource("tag", rows, [other]), [other], "tag/library scopes derive from the loaded publication set");
assert.deepEqual(scope.resultScopeSource("path", rows, [other]), rows, "namespace browsing keeps its current returned rows");
for (const [hash, expected] of [
  ["#v=search&q=stars&presentation=exhibition", { mode: "search", presentation: "page:restoreweave:exhibition", q: "stars" }],
  ["#v=tag&tag=family&presentation=photos", { mode: "tag", presentation: "photos", tags: ["family"] }],
  ["#v=exhibition", { mode: "content", presentation: "page:restoreweave:exhibition" }],
]) {
  const parsed = hashes.parseHashView(hash);
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(parsed[key], value, `${hash} restores ${key}`);
}
let replaced = "";
globalThis.window = { location: { pathname: "/", search: "" }, history: { replaceState: (_state, _title, url) => { replaced = String(url); } } };
hashes.writeHashView({ mode: "search", presentation: "page:restoreweave:exhibition", q: "stars", tags: [], month: "" });
assert.equal(replaced, "/#v=search&q=stars&presentation=exhibition", "deep link adds presentation without changing search scope");
hashes.writeHashView({ mode: "search", presentation: "photos", q: "stars", tags: ["family", "travel"], month: "2026-10" });
const restoredSearch = hashes.parseHashView(replaced.slice(replaced.indexOf("#")));
assert.equal(restoredSearch.q, "stars");
assert.deepEqual(restoredSearch.tags, ["family", "travel"], "search hash retains additional local tag conditions on reload");
assert.equal(restoredSearch.month, "2026-10", "search hash retains the local month condition");
assert.equal(restoredSearch.presentation, "photos");
const unknown = hashes.parseHashView("#v=search&q=stars&presentation=missing");
assert.equal(unknown.mode, "search");
assert.equal(unknown.q, "stars");
assert.equal(unknown.invalidPresentation, true, "unavailable renderer can be reported without dropping query scope");
hashes.writeHashView({ mode: "search", presentation: "photos", q: "stars", tags: ["family"], month: "2024-02" });
assert.equal(replaced, "/#v=search&q=stars&tag=family&month=2024-02&presentation=photos", "search-local filters and page identity are all retained in the URL");
console.log("PASS: result scopes retain all rows while Photos/Music project locally, and presentation hashes preserve search, tags, and legacy exhibition links.");
