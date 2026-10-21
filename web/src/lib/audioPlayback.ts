import { endpoints } from "./operations";
import type { SearchHit } from "./types";

export const AUDIO_PLAYBACK_LIMIT = 32 * 1024 * 1024;
const AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg", mpeg: "audio/mpeg", mpga: "audio/mpeg", mp4: "audio/mp4", m4a: "audio/mp4",
  aac: "audio/aac", wav: "audio/wav", wave: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg",
  opus: "audio/ogg", flac: "audio/flac", weba: "audio/webm", webm: "audio/webm", aif: "audio/aiff", aiff: "audio/aiff",
};
export type AudioTrack = { workspaceID: string; entryID: string; name: string; contentID: string; logicalSize: number; displayTitle?: string; displayArtist?: string; displayAlbum?: string; sourceHit?: SearchHit };
/** One insertion of a playable file; repeated file identities are separate occurrences. */
export type AudioQueueEntry = AudioTrack & { occurrenceID: string };
export function audioIdentityDigest(contentID: string | undefined): string | undefined {
  const match = contentID?.match(/^sha256:([a-f0-9]{64})$/);
  return match?.[1];
}
export function audioMime(name: string): string | undefined {
  const suffix = name.toLowerCase().split(".").pop() || "";
  return AUDIO_TYPES[suffix];
}
export async function fetchVerifiedAudio(track: AudioTrack, signal: AbortSignal): Promise<Blob> {
  if (!audioMime(track.name)) throw new Error("unsupported-format");
  const expectedDigest = audioIdentityDigest(track.contentID);
  if (!track.workspaceID || !track.entryID || !expectedDigest) throw new Error("identity-unavailable");
  if (!Number.isSafeInteger(track.logicalSize) || track.logicalSize < 0 || track.logicalSize > AUDIO_PLAYBACK_LIMIT) throw new Error("size-limit");
  const query = new URLSearchParams({ workspace_id: track.workspaceID, entry_id: track.entryID, filename: track.name });
  const response = await fetch(`${endpoints.download}?${query}`, { signal, credentials: "same-origin" });
  if (!response.ok) {
    let reason = `download-failed-${response.status}`;
    try { const body = await response.json(); reason = body?.reasons?.[0]?.message || reason; } catch { /* visible status fallback */ }
    throw new Error(reason);
  }
  const lengthHeader = response.headers.get("Content-Length");
  if (lengthHeader && Number(lengthHeader) > AUDIO_PLAYBACK_LIMIT) throw new Error("size-limit");
  if (!response.body) throw new Error("empty-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > AUDIO_PLAYBACK_LIMIT) throw new Error("size-limit");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  if (size !== track.logicalSize) throw new Error("length-mismatch");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const actual = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expectedDigest) throw new Error("hash-mismatch");
  return new Blob([bytes], { type: audioMime(track.name) });
}
