import type { SearchHit } from "./types";
import { audioIdentityDigest, audioMime, type AudioTrack } from "./audioPlayback";
import { mediaClassFromSuffix } from "./format";

/** The existing audio.list projection, restricted to facts recorded by the daemon. */
export type MusicTrackFacts = {
  subjectRef: string;
  name?: string;
  title?: string;
  artist?: string;
  album?: string;
  track?: number;
  year?: string;
  durationMS?: number;
  artifactID: string;
};

export type AudioListTrack = {
  subject_ref?: unknown;
  name?: unknown;
  title?: unknown;
  artist?: unknown;
  album?: unknown;
  track?: unknown;
  year?: unknown;
  duration_ms?: unknown;
  artifact_id?: unknown;
};

const recordedText = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;

/**
 * Join returned audio facts only to the currently authorized, loaded subject
 * set. The file listing remains the row authority; facts never add subjects.
 */
export function projectMusicFacts(
  workspaceID: string,
  loadedItems: readonly Pick<SearchHit, "subject_ref">[],
  tracks: readonly AudioListTrack[],
): Map<string, MusicTrackFacts> {
  const allowed = new Set(loadedItems.map((item) => item.subject_ref?.trim()).filter((ref): ref is string => Boolean(ref)));
  const result = new Map<string, MusicTrackFacts>();
  if (!workspaceID.trim()) return result;
  for (const track of tracks) {
    const subjectRef = recordedText(track.subject_ref);
    const artifactID = recordedText(track.artifact_id);
    if (!subjectRef || !artifactID || !allowed.has(subjectRef) || result.has(subjectRef)) continue;
    const trackNumber = typeof track.track === "number" && Number.isSafeInteger(track.track) && track.track > 0 ? track.track : undefined;
    const durationMS = typeof track.duration_ms === "number" && Number.isSafeInteger(track.duration_ms) && track.duration_ms > 0 ? track.duration_ms : undefined;
    result.set(subjectRef, {
      subjectRef,
      name: recordedText(track.name),
      title: recordedText(track.title),
      artist: recordedText(track.artist),
      album: recordedText(track.album),
      track: trackNumber,
      year: recordedText(track.year),
      durationMS,
      artifactID,
    });
  }
  return result;
}

export type MusicMetadataState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  records: Map<string, MusicTrackFacts>;
  reload?: () => void;
};

/** Stable presentation groups; blank fact values share an explicit unknown group. */
export function musicGroupKey(kind: "artist" | "album", facts?: MusicTrackFacts): string {
  if (kind === "artist") return facts?.artist ? `artist:${facts.artist}` : "artist:unknown";
  return facts?.album ? `album:${facts.artist ?? ""}\u0000${facts.album}` : "album:unknown";
}

/** Order one selected album by recorded track number; listing order breaks ties and unknowns. */
export function orderRecordedAlbumTracks<T extends { index: number; facts?: Pick<MusicTrackFacts, "track"> }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftTrack = Number.isSafeInteger(left.facts?.track) && (left.facts?.track ?? 0) > 0 ? left.facts!.track! : undefined;
    const rightTrack = Number.isSafeInteger(right.facts?.track) && (right.facts?.track ?? 0) > 0 ? right.facts!.track! : undefined;
    if (leftTrack !== undefined && rightTrack !== undefined && leftTrack !== rightTrack) return leftTrack - rightTrack;
    if (leftTrack !== undefined && rightTrack === undefined) return -1;
    if (leftTrack === undefined && rightTrack !== undefined) return 1;
    return left.index - right.index;
  });
}

/** The same loaded-original guard used by individual play actions. */
export function playableMusicTrack(hit: SearchHit, workspaceID?: string): AudioTrack | undefined {
  const name = hit.name || "";
  if (hit.entry_type !== "REGULAR_FILE" || mediaClassFromSuffix(name.split(".").pop() || "") !== "audio" || !audioMime(name) || !workspaceID || !hit.entry_id || audioIdentityDigest(hit.content_id) === undefined || !Number.isSafeInteger(hit.logical_size) || (hit.logical_size ?? -1) < 0 || (hit.logical_size ?? Infinity) > 32 * 1024 * 1024) return undefined;
  return { workspaceID, entryID: hit.entry_id, name, contentID: hit.content_id!, logicalSize: hit.logical_size! };
}
