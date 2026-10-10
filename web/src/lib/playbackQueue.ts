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

export type RemoveQueueOccurrenceResult = { queue: AudioQueueEntry[]; removed: boolean; activeRemovalRequired: boolean };
export function removeQueueOccurrence(queue: AudioQueueEntry[], target: QueueTrack, current?: QueueTrack): RemoveQueueOccurrenceResult {
  if (current && sameQueueOccurrence(current, target)) return { queue, removed: false, activeRemovalRequired: true };
  const index = queue.findIndex((candidate) => sameQueueOccurrence(candidate, target));
  if (index < 0) return { queue, removed: false, activeRemovalRequired: false };
  return { queue: queue.filter((_, candidateIndex) => candidateIndex !== index), removed: true, activeRemovalRequired: false };
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
