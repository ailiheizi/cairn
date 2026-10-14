// Focused client contract: daemon audio facts join only the loaded subject set,
// drive recorded-fact grouping, and never add unsupported originals to play.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "../web/node_modules/typescript/lib/typescript.js";

const root = new URL("../web/src/lib/", import.meta.url);
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const dataURL = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const operationsSource = await readFile(new URL("operations.ts", root), "utf8");
const operationsURL = dataURL(transpile(operationsSource));
const playbackSource = await readFile(new URL("audioPlayback.ts", root), "utf8");
const playbackURL = dataURL(transpile(playbackSource).replaceAll('"./operations"', JSON.stringify(operationsURL)));
const formatSource = await readFile(new URL("format.ts", root), "utf8");
const formatURL = dataURL(transpile(formatSource));
const projectionSource = await readFile(new URL("musicMetadata.ts", root), "utf8");
const linkedProjection = transpile(projectionSource)
  .replaceAll('"./audioPlayback"', JSON.stringify(playbackURL))
  .replaceAll('"./format"', JSON.stringify(formatURL));
const { projectMusicFacts, musicGroupKey, orderRecordedAlbumTracks, playableMusicTrack, musicPlaybackEligibility, sortMusicRows } = await import(dataURL(linkedProjection));

const digest = `sha256:${"a".repeat(64)}`;
const hit = (subject_ref, overrides = {}) => ({
  subject_ref, entry_id: `entry-${subject_ref}`, name: `${subject_ref}.mp3`, entry_type: "REGULAR_FILE",
  content_id: digest, logical_size: 14, ...overrides,
});
const loaded = [hit("a"), hit("b"), hit("c"), hit("d", { name: "oversized.mp3", logical_size: 32 * 1024 * 1024 + 1 }), hit("none", { name: "fallback.mp3" })];
const records = projectMusicFacts("workspace-one", loaded, [
  { subject_ref: "a", artifact_id: "fact-a", title: "First", artist: "Recorded Artist", album: "Recorded Album", track: 1 },
  { subject_ref: "outside-current-list", artifact_id: "stale", artist: "Must Not Appear" },
  { subject_ref: "b", artifact_id: "fact-b", title: "Second", artist: "Recorded Artist", album: "Recorded Album", track: 2 },
  { subject_ref: "c", artifact_id: "fact-c", title: "Third", album: "Solo Album" },
  { subject_ref: "d", artifact_id: "fact-d", title: "Oversized", artist: "Recorded Artist", album: "Recorded Album", track: 3 },
]);
assert.deepEqual([...records.keys()], ["a", "b", "c", "d"]);
assert.equal(records.has("outside-current-list"), false, "audio.list must not add a subject absent from the loaded authorized set");
assert.equal(records.has("none"), false, "a loaded filename with no returned facts remains a filename fallback row");

// The same recorded-fact keys consumed by the UI select only matching loaded
// rows, retaining the loaded order for display and play-set construction.
const artistKey = musicGroupKey("artist", records.get("a"));
const artistRows = loaded.filter((item) => musicGroupKey("artist", records.get(item.subject_ref)) === artistKey);
assert.deepEqual(artistRows.map((item) => item.subject_ref), ["a", "b", "d"]);
const albumKey = musicGroupKey("album", records.get("c"));
const albumRows = loaded.filter((item) => musicGroupKey("album", records.get(item.subject_ref)) === albumKey);
assert.deepEqual(albumRows.map((item) => item.subject_ref), ["c"]);
assert.equal(musicGroupKey("artist"), "artist:unknown");
assert.equal(musicGroupKey("album"), "album:unknown");
assert.equal(musicGroupKey("artist", records.get("c")), "artist:unknown", "missing artist remains an explicit unknown group");
const albumOrder = orderRecordedAlbumTracks([
  { index: 8, subject: "unknown", facts: undefined },
  { index: 5, subject: "track-two-late", facts: { track: 2 } },
  { index: 2, subject: "track-one", facts: { track: 1 } },
  { index: 3, subject: "track-two-early", facts: { track: 2 } },
  { index: 1, subject: "unknown-earlier", facts: undefined },
]);
assert.deepEqual(albumOrder.map((item) => item.subject), ["track-one", "track-two-early", "track-two-late", "unknown-earlier", "unknown"]);

const displayedSet = artistRows.map((item) => playableMusicTrack(item, "workspace-one")).filter(Boolean);
assert.deepEqual(displayedSet.map((item) => item.entryID), ["entry-a", "entry-b"]);
assert.equal(artistRows.length - displayedSet.length, 1, "the displayed-set skipped count includes unsupported known-size tracks");
const allSupported = loaded.map((item) => playableMusicTrack(item, "workspace-one")).filter(Boolean);
assert.deepEqual(allSupported.map((item) => item.entryID), ["entry-a", "entry-b", "entry-c", "entry-none"], "known supported originals remain playable without metadata");
assert.equal(playableMusicTrack(loaded[0], undefined), undefined);
assert.equal(playableMusicTrack(hit("bad", { content_id: "bare-digest" }), "workspace-one"), undefined);
assert.equal(playableMusicTrack(hit("unknown-size", { logical_size: undefined }), "workspace-one"), undefined);

// Sorting is a browser-local projection over the loaded rows. The default is
// identity/order preserving (including the caller's known-album track order),
// and missing values stay last in either direction while ties keep source index.
const sortRows = [
  { index: 4, hit: hit("z", { name: "z.mp3", logical_size: 20 }), facts: { title: "Beta", artist: "Zed", album: "B", track: 2, durationMS: 200 } },
  { index: 1, hit: hit("unknown", { name: undefined, logical_size: undefined }), facts: undefined },
  { index: 3, hit: hit("a2", { name: "a2.mp3", logical_size: 10 }), facts: { title: "Alpha", artist: "Ada", album: "A", track: 1, durationMS: 100 } },
  { index: 2, hit: hit("a1", { name: "a1.mp3", logical_size: 10 }), facts: { title: "Alpha", artist: "Ada", album: "A", track: 1, durationMS: 100 } },
];
assert.deepEqual(sortMusicRows(sortRows, "original", "desc").map((row) => row.index), [4, 1, 3, 2]);
assert.deepEqual(sortMusicRows(sortRows, "title", "asc").map((row) => row.index), [2, 3, 4, 1], "title ties preserve original input index and missing title sorts last");
assert.deepEqual(sortMusicRows(sortRows, "title", "desc").map((row) => row.index), [4, 2, 3, 1], "descending reverses known values but still leaves unknowns last");
assert.deepEqual(sortMusicRows(sortRows, "artist", "asc").map((row) => row.index), [2, 3, 4, 1]);
assert.deepEqual(sortMusicRows(sortRows, "album", "desc").map((row) => row.index), [4, 2, 3, 1]);
assert.deepEqual(sortMusicRows(sortRows, "track", "desc").map((row) => row.index), [4, 2, 3, 1]);
assert.deepEqual(sortMusicRows(sortRows, "duration", "asc").map((row) => row.index), [2, 3, 4, 1]);
assert.deepEqual(sortMusicRows(sortRows, "size", "desc").map((row) => row.index), [4, 2, 3, 1]);
assert.deepEqual(sortMusicRows([{ index: 1, hit: hit("bad-track"), facts: { track: 0 } }, sortRows[2]], "track", "asc").map((row) => row.index), [3, 1], "non-positive recorded track numbers are treated as unknown");

assert.deepEqual(musicPlaybackEligibility(hit("valid"), "workspace-one"), { playable: true });
assert.deepEqual(musicPlaybackEligibility(hit("unsupported", { name: "unsupported.xyz" }), "workspace-one"), { playable: false, reason: "unsupported-format" });
assert.deepEqual(musicPlaybackEligibility(hit("bad-id", { content_id: "bad" }), "workspace-one"), { playable: false, reason: "identity-unavailable" });
assert.deepEqual(musicPlaybackEligibility(hit("unknown-length", { logical_size: undefined }), "workspace-one"), { playable: false, reason: "size-unavailable" });
assert.deepEqual(musicPlaybackEligibility(hit("too-large", { logical_size: 32 * 1024 * 1024 + 1 }), "workspace-one"), { playable: false, reason: "size-limit" });
assert.deepEqual(musicPlaybackEligibility(hit("no-workspace"), undefined), { playable: false, reason: "workspace-unavailable" });
assert.deepEqual(musicPlaybackEligibility(hit("blank-workspace"), "   "), { playable: false, reason: "workspace-unavailable" });
assert.equal(playableMusicTrack(hit("blank-workspace"), "   "), undefined, "eligibility and actual play guard reject the same blank workspace");

// The component must route visible keyboard navigation through its sorted row
// projection while invoking host selection/details with each original index.
const component = await readFile(new URL("../web/src/components/MusicLibraryExperience.tsx", import.meta.url), "utf8");
assert.match(component, /trackRows\.findIndex\(\(row\) => row\.index === sourceIndex\)/);
assert.match(component, /const open = \(row: MusicRow[\s\S]*?props\.onRowClick\(row\.index, event\)/);
assert.match(component, /ArrowDown[\s\S]*?trackRows\[nextPosition\]\.index/);
assert.match(component, /if \(\["ArrowDown"[\s\S]*?return;\s*}\s*props\.onKeyDown\(event\);/, "arrow handling is local; other host keyboard actions still delegate");
assert.match(component, /PLAYBACK_REASON_MESSAGES\[eligibility\.reason\]/, "reason enums are mapped to human sentence keys before translation");
assert.doesNotMatch(component, /t\(eligibility\.reason\)/, "internal eligibility codes must not appear as translated text");
assert.match(component, /Use the arrow keys to move through visible tracks; Space selects and Enter opens the focused track\./);

console.log("PASS: recorded-fact scope; stable album order; local seven-field sorting with unknown-last ties; aligned eligibility/play guards; human eligibility reasons; original-index host selection/details; visible-order arrows with delegated remaining keys.");
