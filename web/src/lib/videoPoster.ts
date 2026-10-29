import type { SearchHit } from "./types";

export const VIDEO_POSTER_SESSION_KEY = "verified-video-poster";

export type VideoPosterSnapshot = {
  identity: string;
  dataURL: string;
  width: number;
  height: number;
};

const MAX_POSTER_EDGE = 960;
const MAX_JPEG_BYTES = 256 * 1024;
const MAX_DATA_URL_CHARS = 350 * 1024;

export function videoPosterIdentity(workspaceID: string, hit: SearchHit): string {
  return JSON.stringify([
    workspaceID.trim(),
    hit.subject_ref ?? "",
    hit.entry_id ?? "",
    hit.content_id ?? "",
    hit.logical_size ?? null,
    hit.name || hit.path?.split(/[\\/]/).at(-1) || "",
  ]);
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | undefined> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ?? undefined), "image/jpeg", 0.78));
}

function blobDataURL(blob: Blob): Promise<string | undefined> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(blob);
  });
}

/** Capture only the already-decoded frame currently visible in a verified local video element. */
export async function captureVerifiedVideoPoster(video: HTMLVideoElement, identity: string): Promise<VideoPosterSnapshot | undefined> {
  if (!identity || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) return undefined;
  const scale = Math.min(1, MAX_POSTER_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.floor(video.videoWidth * scale));
  const height = Math.max(1, Math.floor(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    canvas.width = 0;
    canvas.height = 0;
    return undefined;
  }

  try {
    context.drawImage(video, 0, 0, width, height);
    const blob = await canvasBlob(canvas);
    if (!blob || blob.type !== "image/jpeg" || blob.size > MAX_JPEG_BYTES) return undefined;
    const dataURL = await blobDataURL(blob);
    if (!dataURL?.startsWith("data:image/jpeg;base64,") || dataURL.length > MAX_DATA_URL_CHARS) return undefined;
    return { identity, dataURL, width, height };
  } catch {
    return undefined;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
