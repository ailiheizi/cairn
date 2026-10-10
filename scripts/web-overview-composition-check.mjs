// Focused contract check for the fixed Overview projection and bounded blocks.
import assert from "node:assert/strict";
import { build } from "../web/node_modules/esbuild/lib/main.js";

const bundle = await build({
  entryPoints: ["web/src/lib/overviewComposition.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const output = bundle.outputFiles[0];
assert.ok(output, "projection helper compiles");
const { OVERVIEW_SECTION_LIMIT, projectOverviewSections } = await import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);
const hits = [
  ...Array.from({ length: 8 }, (_, index) => ({ subject_ref: `photo-${index}`, entry_id: `p-${index}`, entry_type: "REGULAR_FILE", name: `photo-${index}.jpg` })),
  ...Array.from({ length: 8 }, (_, index) => ({ subject_ref: `audio-${index}`, entry_id: `a-${index}`, entry_type: "REGULAR_FILE", name: `audio-${index}.mp3` })),
  ...Array.from({ length: 8 }, (_, index) => ({ subject_ref: `other-${index}`, entry_id: `o-${index}`, entry_type: "REGULAR_FILE", name: `other-${index}.txt` })),
  { subject_ref: "directory", entry_id: "dir", entry_type: "DIRECTORY", name: "folder.jpg" },
];
const projected = projectOverviewSections(hits);
assert.equal(OVERVIEW_SECTION_LIMIT, 6);
assert.deepEqual([projected.photos.total, projected.audio.total, projected.other.total], [8, 8, 9], "counts describe the full current scope, including a directory as other content");
for (const key of ["photos", "audio", "other"]) {
  const section = projected[key];
  assert.equal(section.rows.length, 6, `${key} preview is capped at six rows`);
  assert.ok(section.rows.every(({ hit, index }) => hits[index] === hit), `${key} rows retain their original host-scope index and object identity`);
}
assert.deepEqual(projected.photos.rows.map(({ hit }) => hit.subject_ref), Array.from({ length: 6 }, (_, index) => `photo-${index}`), "photos preserve returned order");
assert.deepEqual(projected.audio.rows.map(({ index }) => index), Array.from({ length: 6 }, (_, index) => 8 + index), "subsection offsets never replace original result indices");
assert.equal(projectOverviewSections([]).photos.total, 0, "empty scopes remain honest");
assert.deepEqual(hits[0], { subject_ref: "photo-0", entry_id: "p-0", entry_type: "REGULAR_FILE", name: "photo-0.jpg" }, "projection does not mutate source rows");

console.log("PASS: fixed sections retain the host scope/order and original indices, counts cover the full scope, and each preview is capped at six.");
