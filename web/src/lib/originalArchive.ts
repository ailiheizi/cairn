import type { SearchHit } from "./types";

export const ORIGINAL_ARCHIVE_LIMITS = {
  files: 32,
  perFileBytes: 32 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
} as const;

export type FrozenArchiveItem = {
  subject_ref: string;
  output_name: string;
  content_id: string;
  logical_size: number;
  exact: true;
};

export type CapturedArchiveItem = {
  subject_ref: string;
  entry_id: string;
  content_id: string;
  logical_size: number;
  name: string;
};

const canonicalContentID = /^sha256:[0-9a-f]{64}$/;

export function captureArchiveSelection(hits: SearchHit[]): CapturedArchiveItem[] {
  if (!Array.isArray(hits) || hits.length === 0) throw new Error("Select one or more files first.");
  if (hits.length > ORIGINAL_ARCHIVE_LIMITS.files) throw new Error("A ZIP can contain at most 32 files.");
  let total = 0;
  const seen = new Set<string>();
  return hits.map((hit) => {
    const subjectRef = hit.subject_ref?.trim() ?? "";
    const entryID = hit.entry_id?.trim() ?? "";
    const contentID = hit.content_id?.trim() ?? "";
    const name = hit.name ?? "";
    const size = hit.logical_size;
    if (!subjectRef || !entryID || hit.entry_type !== "REGULAR_FILE" || !canonicalContentID.test(contentID)) {
      throw new Error("Every selected item must be a regular file with a verified identity.");
    }
    if (!Number.isSafeInteger(size) || size! < 0) throw new Error("ZIP takeout requires a known nonnegative file size.");
    if (size! > ORIGINAL_ARCHIVE_LIMITS.perFileBytes) throw new Error("A selected file exceeds the 32 MiB ZIP limit; use its original download instead.");
    total += size!;
    if (total > ORIGINAL_ARCHIVE_LIMITS.totalBytes) throw new Error("The selection exceeds the 64 MiB ZIP limit.");
    if (seen.has(subjectRef)) throw new Error("The selection contains a repeated file.");
    seen.add(subjectRef);
    return { subject_ref: subjectRef, entry_id: entryID, content_id: contentID, logical_size: size!, name };
  });
}

function safeZipName(name: string): boolean {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(name)) return false;
  return new TextEncoder().encode(name).byteLength <= 0xffff;
}

/** Decode and bind the server's JSON-encoded ExportItem projection to this click's selection. */
export function validateFrozenArchiveItems(rawItems: unknown, captured: CapturedArchiveItem[]): FrozenArchiveItem[] {
  if (!Array.isArray(rawItems) || rawItems.length !== captured.length) throw new Error("The frozen export did not contain every selected file; refresh and select again.");
  const capturedByEntry = new Map(captured.map((item) => [item.entry_id, item]));
  const frozen: FrozenArchiveItem[] = [];
  const seenEntries = new Set<string>();
  const seenNames = new Set<string>();
  let total = 0;
  for (const raw of rawItems) {
    if (typeof raw !== "string") throw new Error("The frozen export item was invalid.");
    let item: any;
    try { item = JSON.parse(raw); } catch { throw new Error("The frozen export item was invalid."); }
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("The frozen export item was invalid.");
    const entryID = item.subject_ref;
    const source = typeof entryID === "string" ? capturedByEntry.get(entryID) : undefined;
    const size = item.logical_size === undefined ? 0 : item.logical_size;
    if (!source || seenEntries.has(entryID) || item.exact !== true || item.content_id !== source.content_id || !Number.isSafeInteger(size) || size !== source.logical_size || item.output_name !== item.output_name?.trim() || !safeZipName(item.output_name)) {
      throw new Error("The frozen export changed or omitted a selected original; refresh and select again.");
    }
    const foldedName = item.output_name.toLowerCase();
    if (seenNames.has(foldedName)) throw new Error("The frozen export contains colliding output names.");
    seenEntries.add(entryID);
    seenNames.add(foldedName);
    total += size;
    if (size > ORIGINAL_ARCHIVE_LIMITS.perFileBytes || total > ORIGINAL_ARCHIVE_LIMITS.totalBytes) throw new Error("The frozen export exceeds the browser ZIP limits.");
    frozen.push({ subject_ref: entryID, output_name: item.output_name, content_id: item.content_id, logical_size: size, exact: true });
  }
  if (seenEntries.size !== captured.length) throw new Error("The frozen export did not match the selected files; refresh and select again.");
  return frozen;
}

export type ZipEntry = { name: string; bytes: Uint8Array };

/** Join only the same authorized row identity; do not change selection membership or other hit fields. */
export function resolveArchiveSelectionSizes(hits: SearchHit[], loaded: SearchHit[]): SearchHit[] {
  const keyFor = (hit: SearchHit): string | undefined => {
    const subject = hit.subject_ref?.trim();
    const entry = hit.entry_id?.trim();
    const content = hit.content_id?.trim();
    return subject && entry && content ? `${subject}\u0000${entry}\u0000${content}` : undefined;
  };
  const sizes = new Map<string, number | null>();
  for (const row of loaded) {
    const key = keyFor(row);
    if (!key || !Number.isSafeInteger(row.logical_size) || row.logical_size! < 0) continue;
    const existing = sizes.get(key);
    sizes.set(key, existing === undefined || existing === row.logical_size ? row.logical_size! : null);
  }
  return hits.map((hit) => {
    if (hit.logical_size !== undefined) return hit;
    const key = keyFor(hit);
    const size = key ? sizes.get(key) : undefined;
    return typeof size === "number" && Number.isSafeInteger(size) && size >= 0 ? { ...hit, logical_size: size } : hit;
  });
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[n] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build a classic, uncompressed UTF-8 ZIP (no Zip64; the admitted budget stays below its limits). */
export function buildStoredZip(entries: ZipEntry[]): Uint8Array {
  if (entries.length === 0 || entries.length > ORIGINAL_ARCHIVE_LIMITS.files) throw new Error("The ZIP must contain between 1 and 32 files.");
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const names = new Set<string>();
  let offset = 0;
  let total = 0;
  for (const entry of entries) {
    if (!(entry.bytes instanceof Uint8Array) || !safeZipName(entry.name)) throw new Error("A ZIP entry was invalid.");
    const name = new TextEncoder().encode(entry.name);
    const folded = entry.name.toLowerCase();
    if (names.has(folded)) throw new Error("The ZIP contains colliding output names.");
    names.add(folded);
    total += entry.bytes.byteLength;
    if (entry.bytes.byteLength > ORIGINAL_ARCHIVE_LIMITS.perFileBytes || total > ORIGINAL_ARCHIVE_LIMITS.totalBytes) throw new Error("The ZIP exceeds the browser archive limits.");
    const crc = crc32(entry.bytes);
    const local = new Uint8Array(30 + name.length + entry.bytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true); view.setUint16(10, 0, true); view.setUint16(12, 0x21, true);
    view.setUint32(14, crc, true); view.setUint32(18, entry.bytes.length, true); view.setUint32(22, entry.bytes.length, true);
    view.setUint16(26, name.length, true); view.setUint16(28, 0, true);
    local.set(name, 30); local.set(entry.bytes, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const cview = new DataView(central.buffer);
    cview.setUint32(0, 0x02014b50, true); cview.setUint16(4, 20, true); cview.setUint16(6, 20, true);
    cview.setUint16(8, 0x0800, true); cview.setUint16(10, 0, true); cview.setUint16(12, 0, true); cview.setUint16(14, 0x21, true);
    cview.setUint32(16, crc, true); cview.setUint32(20, entry.bytes.length, true); cview.setUint32(24, entry.bytes.length, true);
    cview.setUint16(28, name.length, true); cview.setUint16(30, 0, true); cview.setUint16(32, 0, true);
    cview.setUint16(34, 0, true); cview.setUint16(36, 0, true); cview.setUint32(38, 0, true); cview.setUint32(42, offset, true);
    central.set(name, 46); centralParts.push(central);
    offset += local.length;
  }
  if (offset > 0xffffffff) throw new Error("The ZIP is too large for this browser archive format.");
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(4, 0, true); endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true); endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true); endView.setUint32(16, offset, true); endView.setUint16(20, 0, true);
  const output = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of localParts) { output.set(part, cursor); cursor += part.length; }
  for (const part of centralParts) { output.set(part, cursor); cursor += part.length; }
  output.set(end, cursor);
  return output;
}

export async function sha256ContentID(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function readBoundedOriginalResponse(response: Response, expectedSize: number, signal: AbortSignal): Promise<Uint8Array> {
  const reject = async (message: string): Promise<never> => {
    try { await response.body?.cancel(message); } catch { /* The transport may already be closed. */ }
    throw new Error(message);
  };
  if (!response.ok) return reject(`The original download failed (HTTP ${response.status}).`);
  const declared = response.headers.get("Content-Length");
  if (declared === null || !/^\d+$/.test(declared) || Number(declared) !== expectedSize) return reject("The downloaded length did not match the frozen original.");
  if (!response.body) return reject("The original download had no readable body.");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expectedSize || total > ORIGINAL_ARCHIVE_LIMITS.perFileBytes) throw new Error("The download exceeded its frozen size.");
      parts.push(value);
    }
    if (total !== expectedSize) throw new Error("The downloaded length did not match the frozen original.");
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return bytes;
  } catch (error) {
    try { await reader.cancel(error); } catch { /* The fetch abort may already have cancelled the stream. */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export function releaseDownloadLease(url: string, timer: number, revoke: (value: string) => void = (value) => URL.revokeObjectURL(value), clear: (value: number) => void = (value) => window.clearTimeout(value)): void {
  clear(timer);
  revoke(url);
}

export async function materializeVerifiedArchive(
  items: FrozenArchiveItem[],
  read: (item: FrozenArchiveItem) => Promise<Uint8Array>,
  signal: AbortSignal,
  onProgress: (index: number, name: string) => void,
): Promise<Uint8Array> {
  if (items.length === 0 || items.length > ORIGINAL_ARCHIVE_LIMITS.files) throw new Error("The frozen export exceeds the browser ZIP limits.");
  const entries: ZipEntry[] = [];
  let total = 0;
  for (let index = 0; index < items.length; index += 1) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const item = items[index]!;
    onProgress(index + 1, item.output_name);
    const bytes = await read(item);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== item.logical_size || await sha256ContentID(bytes) !== item.content_id) {
      throw new Error(`The downloaded identity for ${item.output_name} did not match the frozen original.`);
    }
    total += bytes.byteLength;
    if (bytes.byteLength > ORIGINAL_ARCHIVE_LIMITS.perFileBytes || total > ORIGINAL_ARCHIVE_LIMITS.totalBytes) throw new Error("The downloaded originals exceed the browser ZIP limits.");
    entries.push({ name: item.output_name, bytes });
  }
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  return buildStoredZip(entries);
}
