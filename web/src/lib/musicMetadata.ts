import type { SearchHit } from "./types";
import { AUDIO_PLAYBACK_LIMIT, audioIdentityDigest, audioMime, type AudioTrack } from "./audioPlayback";
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

export type MusicSortField = "original" | "title" | "artist" | "album" | "track" | "duration" | "size";
export type MusicSortDirection = "asc" | "desc";
export type MusicPlaybackReason = "unsupported-format" | "identity-unavailable" | "size-unavailable" | "size-limit" | "workspace-unavailable";
export type MusicPlaybackEligibility = { playable: true } | { playable: false; reason: MusicPlaybackReason };

/** Single source for the current Music playback guard and its user-facing reason code. */
function playbackEligibilityReason(hit: SearchHit, workspaceID?: string): MusicPlaybackReason | undefined {
  const name = hit.name || "";
  if (hit.entry_type !== "REGULAR_FILE" || mediaClassFromSuffix(name.split(".").pop() || "") !== "audio" || !audioMime(name)) return "unsupported-format";
  if (!workspaceID?.trim()) return "workspace-unavailable";
  if (!hit.entry_id || audioIdentityDigest(hit.content_id) === undefined) return "identity-unavailable";
  if (!Number.isSafeInteger(hit.logical_size) || (hit.logical_size ?? -1) < 0) return "size-unavailable";
  if ((hit.logical_size ?? Infinity) > AUDIO_PLAYBACK_LIMIT) return "size-limit";
  return undefined;
}

/** Pure client projection: report only the existing bounded-playback guards. */
export function musicPlaybackEligibility(hit: SearchHit, workspaceID?: string): MusicPlaybackEligibility {
  const reason = playbackEligibilityReason(hit, workspaceID);
  return reason ? { playable: false, reason } : { playable: true };
}

/** Local ordering for the current loaded Music rows; missing facts stay last in both directions. */
export function sortMusicRows<T extends { index: number; hit: Pick<SearchHit, "name" | "logical_size">; facts?: Pick<MusicTrackFacts, "title" | "artist" | "album" | "track" | "durationMS"> }>(
  rows: readonly T[], field: MusicSortField, direction: MusicSortDirection, locale?: string,
): T[] {
  if (field === "original") return [...rows];
  const sign = direction === "asc" ? 1 : -1;
  const textValue = (row: T): string | undefined => {
    if (field === "title") return row.facts?.title?.trim() || row.hit.name?.trim() || undefined;
    if (field === "artist") return row.facts?.artist?.trim() || undefined;
    if (field === "album") return row.facts?.album?.trim() || undefined;
    return undefined;
  };
  const numberValue = (row: T): number | undefined => {
    if (field === "track") return Number.isSafeInteger(row.facts?.track) && (row.facts?.track ?? 0) > 0 ? row.facts!.track : undefined;
    if (field === "duration") return Number.isSafeInteger(row.facts?.durationMS) && (row.facts?.durationMS ?? 0) > 0 ? row.facts!.durationMS : undefined;
    return row.hit.logical_size;
  };
  return [...rows].sort((left, right) => {
    let comparison = 0;
    if (["title", "artist", "album"].includes(field)) {
      const a = textValue(left), b = textValue(right);
      if (!a && !b) comparison = 0;
      else if (!a) return 1;
      else if (!b) return -1;
      else comparison = a.localeCompare(b, locale, { sensitivity: "base", numeric: true });
    } else {
      const a = numberValue(left), b = numberValue(right);
      const knownA = Number.isSafeInteger(a) && a! >= 0;
      const knownB = Number.isSafeInteger(b) && b! >= 0;
      if (!knownA && !knownB) comparison = 0;
      else if (!knownA) return 1;
      else if (!knownB) return -1;
      else comparison = a! - b!;
    }
    return comparison === 0 ? left.index - right.index : comparison * sign;
  });
}

/** The same loaded-original guard used by individual play actions. */
export function playableMusicTrack(hit: SearchHit, workspaceID?: string, projectedFacts?: MusicTrackFacts): AudioTrack | undefined {
  const name = hit.name || "";
  if (playbackEligibilityReason(hit, workspaceID)) return undefined;
  const entryID = hit.entry_id;
  const contentID = hit.content_id;
  const logicalSize = hit.logical_size;
  if (typeof workspaceID !== "string" || !workspaceID.trim()) return undefined;
  if (typeof entryID !== "string" || !entryID || typeof contentID !== "string" || audioIdentityDigest(contentID) === undefined) return undefined;
  if (typeof logicalSize !== "number" || !Number.isSafeInteger(logicalSize) || logicalSize < 0 || logicalSize > AUDIO_PLAYBACK_LIMIT) return undefined;
  const factsMatch = projectedFacts?.subjectRef === hit.subject_ref;
  return {
    workspaceID, entryID, name, contentID, logicalSize,
    ...(factsMatch && projectedFacts?.title ? { displayTitle: projectedFacts.title } : {}),
    ...(factsMatch && projectedFacts?.artist ? { displayArtist: projectedFacts.artist } : {}),
    ...(factsMatch && projectedFacts?.album ? { displayAlbum: projectedFacts.album } : {}),
    // Retain the original loaded client projection for the global player's
    // Details action. The host revalidates every identity field before use.
    sourceHit: { ...hit },
  };
}
