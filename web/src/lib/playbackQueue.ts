import { AUDIO_PLAYBACK_LIMIT, audioIdentityDigest, audioMime, type AudioQueueEntry, type AudioTrack } from "./audioPlayback";

export const MAX_AUDIO_QUEUE_ENTRIES = 1000;
export type QueueTrack = AudioTrack | AudioQueueEntry;
export type RepeatMode = "off" | "all" | "one";
export type QueueEndAction =
  | { kind: "restart-current"; track: QueueTrack }
  | { kind: "play-track"; track: AudioQueueEntry }
  | { kind: "stop" };

function trackKey(track: AudioTrack): string {
  return `${track.workspaceID}\u0000${track.entryID}\u0000${track.contentID}`;
}

export function sameAudioTrack(a: AudioTrack, b: AudioTrack): boolean {
  return trackKey(a) === trackKey(b);
}

function occurrenceID(track: QueueTrack): string | undefined {
  const value = (track as Partial<AudioQueueEntry>).occurrenceID;
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Queue-current matching requires both insertion identity and original identity. */
export function sameQueueOccurrence(a: QueueTrack, b: QueueTrack): boolean {
  const left = occurrenceID(a);
  const right = occurrenceID(b);
  return Boolean(left && right && left === right && sameAudioTrack(a, b));
}

export function isPlayableQueueTrack(track: AudioTrack, workspaceID: string): boolean {
  return track.workspaceID === workspaceID && Boolean(track.entryID) && Boolean(audioIdentityDigest(track.contentID)) &&
    Boolean(audioMime(track.name)) && Number.isSafeInteger(track.logicalSize) && track.logicalSize >= 0 &&
    track.logicalSize <= AUDIO_PLAYBACK_LIMIT;
}

export type PreparedQueue = { tracks: AudioQueueEntry[]; omittedCount: number; limitExceeded: boolean };
export function preparePlayableQueue(
  tracks: AudioTrack[],
  workspaceID: string,
  createOccurrenceID: () => string = () => crypto.randomUUID(),
  maxEntries = MAX_AUDIO_QUEUE_ENTRIES,
): PreparedQueue {
  const playable = tracks.filter((track) => isPlayableQueueTrack(track, workspaceID));
  const omittedCount = tracks.length - playable.length;
  if (playable.length > maxEntries) return { tracks: [], omittedCount, limitExceeded: true };
  const ids = new Set<string>();
  const entries = playable.map((track) => {
    const id = createOccurrenceID().trim();
    if (!id || ids.has(id)) throw new Error("queue occurrence IDs must be non-empty and unique");
    ids.add(id);
    return { ...track, occurrenceID: id };
  });
  return { tracks: entries, omittedCount, limitExceeded: false };
}

export function moveQueueTrack(queue: AudioQueueEntry[], target: QueueTrack, delta: -1 | 1): AudioQueueEntry[] {
  const index = queue.findIndex((candidate) => sameQueueOccurrence(candidate, target));
  const targetIndex = index + delta;
  if (index < 0 || targetIndex < 0 || targetIndex >= queue.length) return queue;
  const next = [...queue];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

/** Move one existing occurrence directly after the active occurrence, or to
 * the front when playback is idle or the active occurrence is not queued.
 */
export function moveQueueOccurrenceNext(queue: AudioQueueEntry[], target: QueueTrack, current?: QueueTrack): AudioQueueEntry[] {
  const targetIndex = queue.findIndex((candidate) => sameQueueOccurrence(candidate, target));
  if (targetIndex < 0 || (current && sameQueueOccurrence(current, target))) return queue;

  const remaining = queue.filter((_, index) => index !== targetIndex);
  const currentIndex = current ? remaining.findIndex((candidate) => sameQueueOccurrence(candidate, current)) : -1;
  const insertionIndex = currentIndex < 0 ? 0 : currentIndex + 1;
  if (insertionIndex === targetIndex) return queue;
  return [...remaining.slice(0, insertionIndex), queue[targetIndex], ...remaining.slice(insertionIndex)];
}

/** Insert one prepared occurrence directly after the current occurrence.
 * If playback is idle or the active file is not queued, put it at the front.
 */
export function insertQueueTrackNext(queue: AudioQueueEntry[], track: AudioQueueEntry, current?: QueueTrack): AudioQueueEntry[] {
  const currentIndex = current ? queue.findIndex((candidate) => sameQueueOccurrence(candidate, current)) : -1;
  const insertionIndex = currentIndex < 0 ? 0 : currentIndex + 1;
  return [...queue.slice(0, insertionIndex), track, ...queue.slice(insertionIndex)];
}

export type RemoveQueueOccurrenceResult = { queue: AudioQueueEntry[]; removed: boolean; activeRemovalRequired: boolean };
export function removeQueueOccurrence(queue: AudioQueueEntry[], target: QueueTrack, current?: QueueTrack): RemoveQueueOccurrenceResult {
  if (current && sameQueueOccurrence(current, target)) return { queue, removed: false, activeRemovalRequired: true };
  const index = queue.findIndex((candidate) => sameQueueOccurrence(candidate, target));
  if (index < 0) return { queue, removed: false, activeRemovalRequired: false };
  return { queue: queue.filter((_, candidateIndex) => candidateIndex !== index), removed: true, activeRemovalRequired: false };
}

export type BatchQueueMutationResult = { queue: AudioQueueEntry[]; changedCount: number; activeExcludedCount: number };

/** Remove selected queue occurrences in one ordered mutation, leaving the
 * active occurrence in place. File-identical repetitions remain independent.
 */
export function removeQueueOccurrences(queue: AudioQueueEntry[], targets: QueueTrack[], current?: QueueTrack): BatchQueueMutationResult {
  const requested = queue.filter((entry) => targets.some((target) => sameQueueOccurrence(entry, target)));
  const active = current ? requested.filter((entry) => sameQueueOccurrence(entry, current)) : [];
  const removable = requested.filter((entry) => !current || !sameQueueOccurrence(entry, current));
  if (!removable.length) return { queue, changedCount: 0, activeExcludedCount: active.length };
  const removableIDs = new Set(removable.map((entry) => entry.occurrenceID));
  return {
    queue: queue.filter((entry) => !removableIDs.has(entry.occurrenceID)),
    changedCount: removable.length,
    activeExcludedCount: active.length,
  };
}

/** Move selected inactive occurrences, in their existing queue order, as one
 * block directly after the active occurrence (or to the front when idle).
 */
export function moveQueueOccurrencesNext(queue: AudioQueueEntry[], targets: QueueTrack[], current?: QueueTrack): BatchQueueMutationResult {
  const requested = queue.filter((entry) => targets.some((target) => sameQueueOccurrence(entry, target)));
  const activeExcludedCount = current ? requested.filter((entry) => sameQueueOccurrence(entry, current)).length : 0;
  const selectedIDs = new Set(requested
    .filter((entry) => !current || !sameQueueOccurrence(entry, current))
    .map((entry) => entry.occurrenceID));
  if (!selectedIDs.size) return { queue, changedCount: 0, activeExcludedCount };
  const moved = queue.filter((entry) => selectedIDs.has(entry.occurrenceID));
  const remaining = queue.filter((entry) => !selectedIDs.has(entry.occurrenceID));
  const currentIndex = current ? remaining.findIndex((entry) => sameQueueOccurrence(entry, current)) : -1;
  const insertionIndex = currentIndex < 0 ? 0 : currentIndex + 1;
  const next = [...remaining.slice(0, insertionIndex), ...moved, ...remaining.slice(insertionIndex)];
  const changed = next.some((entry, index) => entry !== queue[index]);
  return { queue: changed ? next : queue, changedCount: moved.length, activeExcludedCount };
}

/** Shuffle upcoming occurrences only; file-identity matches never substitute for the current occurrence. */
export function shuffleUpcomingTracks(queue: AudioQueueEntry[], current: QueueTrack | undefined, random: () => number = Math.random): AudioQueueEntry[] {
  const activeIndex = current ? queue.findIndex((track) => sameQueueOccurrence(track, current)) : -1;
  const prefixEnd = activeIndex < 0 ? 0 : activeIndex + 1;
  const next = [...queue];
  for (let index = next.length - 1; index > prefixEnd; index -= 1) {
    const other = prefixEnd + Math.floor(random() * (index - prefixEnd + 1));
    [next[index], next[other]] = [next[other], next[index]];
  }
  return next;
}

/** Resolve both manual Next and natural completion without conflating repeat-one with manual navigation. */
export function resolveQueueAdvance(
  queue: AudioQueueEntry[],
  current: QueueTrack | undefined,
  repeatMode: RepeatMode,
  trigger: "manual" | "ended",
): QueueEndAction {
  if (trigger === "ended" && repeatMode === "one" && current) return { kind: "restart-current", track: current };
  if (queue.length === 0) return { kind: "stop" };
  const currentIndex = current ? queue.findIndex((track) => sameQueueOccurrence(track, current)) : -1;
  const nextIndex = currentIndex + 1;
  if (nextIndex < queue.length) return { kind: "play-track", track: queue[nextIndex] };
  if (repeatMode === "all") return { kind: "play-track", track: queue[0] };
  return { kind: "stop" };
}
