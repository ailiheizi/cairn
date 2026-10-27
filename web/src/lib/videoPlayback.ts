import { endpoints } from "./operations";

export const VIDEO_PLAYBACK_LIMIT = 32 * 1024 * 1024;
const VIDEO_TYPES: Record<string, string> = { mp4: "video/mp4", webm: "video/webm" };

export type VideoAsset = {
  workspaceID: string;
  entryID: string;
  name: string;
  contentID: string;
  logicalSize: number;
};

export function videoMime(name: string): string | undefined {
  const suffix = name.toLowerCase().split(".").pop() || "";
  return VIDEO_TYPES[suffix];
}

export function videoIdentityDigest(contentID: string | undefined): string | undefined {
  return contentID?.match(/^sha256:([a-f0-9]{64})$/)?.[1];
}

export async function fetchVerifiedVideo(video: VideoAsset, signal: AbortSignal): Promise<Blob> {
  const mime = videoMime(video.name);
  if (!mime) throw new Error("unsupported-format");
  const expectedDigest = videoIdentityDigest(video.contentID);
  if (!video.workspaceID || !video.entryID || !expectedDigest) throw new Error("identity-unavailable");
  if (!Number.isSafeInteger(video.logicalSize) || video.logicalSize < 0 || video.logicalSize > VIDEO_PLAYBACK_LIMIT) throw new Error("size-limit");

  const query = new URLSearchParams({ workspace_id: video.workspaceID, entry_id: video.entryID, filename: video.name });
  const response = await fetch(`${endpoints.download}?${query}`, { signal, credentials: "same-origin" });
  if (!response.ok) {
    let reason = `download-failed-${response.status}`;
    try { const body = await response.json(); reason = body?.reasons?.[0]?.message || reason; } catch { /* Keep a visible status fallback. */ }
    throw new Error(reason);
  }
  const lengthHeader = response.headers.get("Content-Length");
  if (lengthHeader !== null) {
    const declaredLength = Number(lengthHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength !== video.logicalSize) throw new Error("length-mismatch");
    if (declaredLength > VIDEO_PLAYBACK_LIMIT) throw new Error("size-limit");
  }
  if (!response.body) throw new Error("empty-response");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > VIDEO_PLAYBACK_LIMIT) throw new Error("size-limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (size !== video.logicalSize) throw new Error("length-mismatch");

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const actual = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expectedDigest) throw new Error("hash-mismatch");
  return new Blob([bytes], { type: mime });
}
