// Pure boundary checks for occurrence-aware transient audio queue helpers.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "../web/node_modules/typescript/lib/typescript.js";

const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const operationsSource = await readFile(new URL("../web/src/lib/operations.ts", import.meta.url), "utf8");
const operationsURL = `data:text/javascript;base64,${Buffer.from(transpile(operationsSource)).toString("base64")}`;
const audioSource = await readFile(new URL("../web/src/lib/audioPlayback.ts", import.meta.url), "utf8");
const linkedAudio = transpile(audioSource).replaceAll('"./operations"', JSON.stringify(operationsURL));
const audioURL = `data:text/javascript;base64,${Buffer.from(linkedAudio).toString("base64")}`;
const queueSource = await readFile(new URL("../web/src/lib/playbackQueue.ts", import.meta.url), "utf8");
const linkedQueue = transpile(queueSource).replaceAll('"./audioPlayback"', JSON.stringify(audioURL));
const queueURL = `data:text/javascript;base64,${Buffer.from(linkedQueue).toString("base64")}`;
const {
  isPlayableQueueTrack, MAX_AUDIO_QUEUE_ENTRIES, moveQueueTrack, preparePlayableQueue,
  removeQueueOccurrence, resolveQueueAdvance, sameAudioTrack, sameQueueOccurrence, shuffleUpcomingTracks,
} = await import(queueURL);

const digest = `sha256:${"a".repeat(64)}`;
const track = (id, overrides = {}) => ({ workspaceID: "workspace-a", entryID: id, name: `${id}.mp3`, contentID: digest, logicalSize: 100, ...overrides });
const a = track("a");
const b = track("b");
const c = track("c");
const d = track("d");
const ids = (prefix = "occ") => { let index = 0; return () => `${prefix}-${++index}`; };

// A/B/A keeps all three occurrences with unique occurrence IDs while file identity remains equal for A.
const preparedABA = preparePlayableQueue([a, b, a], "workspace-a", ids("aba"));
assert.equal(preparedABA.limitExceeded, false);
assert.equal(preparedABA.omittedCount, 0);
assert.equal(preparedABA.tracks.length, 3);
assert.deepEqual(preparedABA.tracks.map((entry) => entry.entryID), ["a", "b", "a"]);
assert.equal(new Set(preparedABA.tracks.map((entry) => entry.occurrenceID)).size, 3);
assert.equal(sameAudioTrack(preparedABA.tracks[0], preparedABA.tracks[2]), true);
assert.equal(sameQueueOccurrence(preparedABA.tracks[0], preparedABA.tracks[2]), false);
assert.equal(sameQueueOccurrence(preparedABA.tracks[0], { ...preparedABA.tracks[0], contentID: `sha256:${"b".repeat(64)}` }), false);
assert.equal(sameQueueOccurrence(a, preparedABA.tracks[0]), false, "an unqueued direct play never falls back to file identity");

// Only the selected occurrence moves or removes; deleting the active occurrence is refused without substitution.
const [aFirst, bEntry, aSecond] = preparedABA.tracks;
assert.deepEqual(moveQueueTrack(preparedABA.tracks, aSecond, -1).map((entry) => entry.occurrenceID), [aFirst.occurrenceID, aSecond.occurrenceID, bEntry.occurrenceID]);
assert.deepEqual(removeQueueOccurrence(preparedABA.tracks, aSecond).queue.map((entry) => entry.occurrenceID), [aFirst.occurrenceID, bEntry.occurrenceID]);
assert.deepEqual(removeQueueOccurrence(preparedABA.tracks, aSecond, aFirst).queue.map((entry) => entry.occurrenceID), [aFirst.occurrenceID, bEntry.occurrenceID], "removing the other repetition must preserve active A");
assert.deepEqual(removeQueueOccurrence(preparedABA.tracks, aSecond, aSecond), { queue: preparedABA.tracks, removed: false, activeRemovalRequired: true });
assert.equal(removeQueueOccurrence(preparedABA.tracks, { ...aSecond, occurrenceID: "missing" }).removed, false);

// The current occurrence stays fixed during shuffle. A direct current file has no occurrence match.
const shuffled = shuffleUpcomingTracks(preparedABA.tracks.concat([c, d].map((item, i) => ({ ...item, occurrenceID: `tail-${i}` }))), bEntry, () => 0);
assert.deepEqual(shuffled.slice(0, 2), [aFirst, bEntry]);
assert.equal(new Set(shuffled.slice(2).map((entry) => entry.occurrenceID)).size, 3);
assert.deepEqual(shuffleUpcomingTracks([aFirst, bEntry], a, () => 0).map((item) => item.occurrenceID), [bEntry.occurrenceID, aFirst.occurrenceID]);

// Manual next advances to the next occurrence, including repeated files; natural repeat-one restarts only on ended.
assert.deepEqual(resolveQueueAdvance(preparedABA.tracks, aFirst, "off", "manual"), { kind: "play-track", track: bEntry });
assert.deepEqual(resolveQueueAdvance(preparedABA.tracks, bEntry, "off", "manual"), { kind: "play-track", track: aSecond });
assert.deepEqual(resolveQueueAdvance(preparedABA.tracks, aSecond, "off", "manual"), { kind: "stop" });
assert.deepEqual(resolveQueueAdvance(preparedABA.tracks, aSecond, "one", "ended"), { kind: "restart-current", track: aSecond });
assert.deepEqual(resolveQueueAdvance(preparedABA.tracks, aSecond, "one", "manual"), { kind: "stop" });
assert.deepEqual(resolveQueueAdvance([], a, "one", "ended"), { kind: "restart-current", track: a });
assert.deepEqual(resolveQueueAdvance([], a, "off", "manual"), { kind: "stop" });
assert.deepEqual(resolveQueueAdvance(preparedABA.tracks, undefined, "off", "manual"), { kind: "play-track", track: aFirst });

// Input validation and the hard cap count unsupported omissions but never count repeated files as omissions.
assert.equal(isPlayableQueueTrack(a, "workspace-a"), true);
assert.equal(isPlayableQueueTrack(track("foreign", { workspaceID: "workspace-b" }), "workspace-a"), false);
assert.equal(isPlayableQueueTrack(track("oversize", { logicalSize: 32 * 1024 * 1024 + 1 }), "workspace-a"), false);
assert.equal(isPlayableQueueTrack(track("unknown-size", { logicalSize: -1 }), "workspace-a"), false);
assert.equal(isPlayableQueueTrack(track("bad-id", { contentID: "not-a-digest" }), "workspace-a"), false);
assert.equal(isPlayableQueueTrack(track("unsupported", { name: "voice.xyz" }), "workspace-a"), false);
const mixed = preparePlayableQueue([a, track("foreign", { workspaceID: "workspace-b" }), a], "workspace-a", ids("mix"));
assert.equal(mixed.tracks.length, 2);
assert.equal(mixed.omittedCount, 1);
const exactLimit = preparePlayableQueue(Array.from({ length: MAX_AUDIO_QUEUE_ENTRIES }, () => a), "workspace-a", ids("limit"));
assert.equal(exactLimit.tracks.length, 1000);
assert.equal(new Set(exactLimit.tracks.map((entry) => entry.occurrenceID)).size, 1000);
let allocatedOnOverflow = 0;
const overLimit = preparePlayableQueue(Array.from({ length: 1001 }, () => a), "workspace-a", () => { allocatedOnOverflow += 1; return `overflow-${allocatedOnOverflow}`; });
assert.deepEqual(overLimit, { tracks: [], omittedCount: 0, limitExceeded: true });
assert.equal(allocatedOnOverflow, 0, "an over-limit replacement is rejected before allocating IDs or changing playback state");
const appendOverflow = preparePlayableQueue([a], "workspace-a", ids("append"), 0);
assert.equal(appendOverflow.limitExceeded, true, "an append that exceeds remaining capacity is rejected atomically");
assert.deepEqual(preparePlayableQueue([], "workspace-a", ids("empty")), { tracks: [], omittedCount: 0, limitExceeded: false });

console.log("PASS occurrence identity, A/B/A progression, targeted edits, shuffle, repeat, validation, and atomic 1,000-entry limits");
