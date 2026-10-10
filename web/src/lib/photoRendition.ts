import { operations } from "./operations";

export const PHOTO_LEGACY_THUMB_LIMIT = 1 << 20;
export const PHOTO_ORIGINAL_LIMIT = 8 << 20;
export const PHOTO_MAX_PIXELS = 12_000_000;
export const PHOTO_MAX_DIMENSION = 8192;
export const PHOTO_RENDITION_MAX_EDGE = 1024;
export const PHOTO_RENDITION_MAX_BYTES = 512 << 10;
export const PHOTO_RENDITION_CACHE_LIMIT = 48;
export const PHOTO_RENDITION_CACHE_BYTES = 24 << 20;
const MAX_READ_CHUNK = 1 << 20;
const MAX_JPEG_HEADER_SCAN = 1 << 20;

export type PhotoCommandResult = { status?: string; data?: unknown; reasons?: Array<{ message?: string }> };
export type PhotoRenditionCommand = (operation: string, input: unknown) => Promise<PhotoCommandResult>;
export type PhotoBytesRequest = {
  command: PhotoRenditionCommand;
  workspaceID: string;
  entryID?: string;
  subjectRef?: string;
  contentID: string;
  logicalSize: number;
};
export type PhotoDimensions = { width: number; height: number; mime: "image/jpeg" | "image/png" };

type Waiter<T> = { signal: AbortSignal; run: () => Promise<T> | T; resolve: (value: T) => void; reject: (error: unknown) => void; onAbort: () => void };

/** Small shared gates: original byte reads overlap at most twice, decode once. */
class BoundedGate {
  private active = 0;
  private readonly waiting: Waiter<unknown>[] = [];
  constructor(private readonly limit: number) {}

  run<T>(signal: AbortSignal, task: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) { reject(abortError()); return; }
      const waiter: Waiter<T> = {
        signal,
        run: task,
        resolve,
        reject,
        onAbort: () => {
          const index = this.waiting.indexOf(waiter as Waiter<unknown>);
          if (index >= 0) {
            this.waiting.splice(index, 1);
            signal.removeEventListener("abort", waiter.onAbort);
            reject(abortError());
          }
        },
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.waiting.push(waiter as Waiter<unknown>);
      this.pump();
    });
  }

  private pump() {
    while (this.active < this.limit && this.waiting.length) {
      const waiter = this.waiting.shift()!;
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      if (waiter.signal.aborted) { waiter.reject(abortError()); continue; }
      this.active++;
      void Promise.resolve().then(() => {
        if (waiter.signal.aborted) throw abortError();
        return waiter.run();
      }).then(waiter.resolve, waiter.reject).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }
}

// A pipeline slot remains occupied while a fetched original waits for decode
// and reduction. Waiting visible tiles therefore retain no large byte buffer.
const pipelineGate = new BoundedGate(2);
const decodeGate = new BoundedGate(1);

export function photoRenditionPipeline<T>(signal: AbortSignal, task: () => Promise<T> | T): Promise<T> {
  return pipelineGate.run(signal, task);
}

export function abortError(): DOMException {
  return new DOMException("The photo preview was cancelled.", "AbortError");
}

export function photoCandidateMime(name: string): PhotoDimensions["mime"] | undefined {
  const normalized = name.toLowerCase();
  if (/\.png$/.test(normalized)) return "image/png";
  if (/\.jpe?g$/.test(normalized)) return "image/jpeg";
  return undefined;
}

export function photoPreviewLimitMessage(name: string, logicalSize?: number): string {
  if (!photoCandidateMime(name)) return "Large automatic previews support PNG and JPEG files only.";
  if (!Number.isSafeInteger(logicalSize) || (logicalSize ?? -1) < 0) return "A known exact file size is required for this preview.";
  if ((logicalSize ?? 0) > PHOTO_ORIGINAL_LIMIT) return "Large automatic previews are limited to 8 MiB; open Details to use the original.";
  return "This image preview is unavailable; open Details to use the original.";
}

export function parsePhotoDimensions(bytes: Uint8Array, mime: PhotoDimensions["mime"]): PhotoDimensions {
  const dimensions = mime === "image/png" ? parsePNGDimensions(bytes) : parseJPEGDimensions(bytes);
  if (!dimensions) throw new Error("The image header is malformed or unsupported.");
  if (!Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width > PHOTO_MAX_DIMENSION || dimensions.height > PHOTO_MAX_DIMENSION || dimensions.width * dimensions.height > PHOTO_MAX_PIXELS) {
    throw new Error("This image exceeds the 12-megapixel preview decode limit.");
  }
  return { ...dimensions, mime };
}

function parsePNGDimensions(bytes: Uint8Array): Omit<PhotoDimensions, "mime"> | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || signature.some((byte, index) => bytes[index] !== byte)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return undefined;
  if (view.getUint32(29) !== crc32(bytes.subarray(12, 29))) return undefined;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseJPEGDimensions(bytes: Uint8Array): Omit<PhotoDimensions, "mime"> | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  const bound = Math.min(bytes.length, MAX_JPEG_HEADER_SCAN);
  while (offset + 4 <= bound) {
    if (bytes[offset] !== 0xff) return undefined;
    while (offset < bound && bytes[offset] === 0xff) offset++;
    if (offset >= bound) return undefined;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bound) return undefined;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bound) return undefined;
    if (sof.has(marker)) {
      if (length < 7) return undefined;
      return { height: (bytes[offset + 3] << 8) | bytes[offset + 4], width: (bytes[offset + 5] << 8) | bytes[offset + 6] };
    }
    offset += length;
  }
  return undefined;
}

function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== "string") throw new Error("Content read did not return encoded bytes.");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function throwCommandError(result: PhotoCommandResult, fallback: string): never {
  throw new Error(result.reasons?.find((item) => item.message)?.message ?? fallback);
}

/** Exact, identity-checked read through existing scoped content sessions. */
export function readVerifiedPhotoOriginal(request: PhotoBytesRequest, signal: AbortSignal): Promise<Uint8Array> {
  return readVerifiedPhotoOriginalInSlot(request, signal);
}

async function readVerifiedPhotoOriginalInSlot(request: PhotoBytesRequest, signal: AbortSignal): Promise<Uint8Array> {
  const { command, workspaceID, entryID, subjectRef, contentID, logicalSize } = request;
  if (!workspaceID.trim() || (!entryID && !subjectRef) || !/^sha256:[a-f0-9]{64}$/.test(contentID) || !Number.isSafeInteger(logicalSize) || logicalSize <= PHOTO_LEGACY_THUMB_LIMIT || logicalSize > PHOTO_ORIGINAL_LIMIT) throw new Error("Photo preview requires a known exact original between 1 and 8 MiB.");
  if (signal.aborted) throw abortError();
  let handle = "";
  try {
    const opened = await command(operations.content.open, { workspace_id: workspaceID, ...(entryID ? { entry_id: entryID } : { subject_ref: subjectRef }) });
    if (!opened.data || !["SUCCEEDED", "DEGRADED"].includes(opened.status ?? "")) throwCommandError(opened, "The original image could not be opened.");
    const data = opened.data as { handle?: string; entry_id?: string; subject_ref?: string; content_id?: string; logical_size?: number; max_read?: number };
    handle = data.handle ?? "";
    if (!handle) throw new Error("The original image session did not return a handle.");
    if (signal.aborted) throw abortError();
    if ((entryID && data.entry_id !== entryID) || (subjectRef && data.subject_ref !== subjectRef) || data.content_id !== contentID || data.logical_size !== logicalSize || !Number.isSafeInteger(data.logical_size) || typeof data.max_read !== "number" || !Number.isSafeInteger(data.max_read) || data.max_read <= 0 || data.max_read > MAX_READ_CHUNK) throw new Error("The opened image does not match its loaded subject and exact identity.");
    const bytes = new Uint8Array(logicalSize);
    let offset = 0;
    while (offset < logicalSize) {
      if (signal.aborted) throw abortError();
      const length = Math.min(data.max_read, logicalSize - offset);
      const response = await command(operations.content.read, { handle, offset, length });
      if (signal.aborted) throw abortError();
      if (!response.data || !["SUCCEEDED", "DEGRADED"].includes(response.status ?? "")) throwCommandError(response, "The original image read failed.");
      const read = response.data as { handle?: string; offset?: number; length?: number; bytes?: unknown; eof?: boolean };
      if (read.handle !== handle || read.offset !== offset || read.length !== length || read.eof !== (offset + length === logicalSize)) throw new Error("The image reader returned an unexpected byte range.");
      const chunk = decodeBase64(read.bytes);
      if (chunk.length !== length) throw new Error("The image reader returned an incomplete byte range.");
      bytes.set(chunk, offset);
      offset += length;
    }
    if (signal.aborted) throw abortError();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    if (signal.aborted) throw abortError();
    const actual = `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (actual !== contentID || bytes.length !== logicalSize) throw new Error("The original image failed exact length or SHA-256 verification.");
    return bytes;
  } finally {
    if (handle) await command(operations.content.close, { handle }).catch(() => undefined);
  }
}

export const photoDecodeGate = <T>(signal: AbortSignal, task: () => Promise<T> | T) => decodeGate.run(signal, task);

type CacheEntry = { blob: Blob; bytes: number };
const renditionCache = new Map<string, CacheEntry>();
let renditionCacheBytes = 0;

export function cachedPhotoRendition(contentID: string): Blob | undefined {
  const key = contentID.toLowerCase();
  const entry = renditionCache.get(key);
  if (!entry) return undefined;
  renditionCache.delete(key);
  renditionCache.set(key, entry);
  return entry.blob;
}

export function cachePhotoRendition(contentID: string, blob: Blob): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(contentID) || blob.size <= 0 || blob.size > PHOTO_RENDITION_MAX_BYTES) return;
  const key = contentID.toLowerCase();
  const previous = renditionCache.get(key);
  if (previous) renditionCacheBytes -= previous.bytes;
  renditionCache.delete(key);
  renditionCache.set(key, { blob, bytes: blob.size });
  renditionCacheBytes += blob.size;
  while (renditionCache.size > PHOTO_RENDITION_CACHE_LIMIT || renditionCacheBytes > PHOTO_RENDITION_CACHE_BYTES) {
    const oldestKey = renditionCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    renditionCacheBytes -= renditionCache.get(oldestKey)?.bytes ?? 0;
    renditionCache.delete(oldestKey);
  }
}
