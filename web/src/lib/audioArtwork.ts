const HEADER_SCAN_LIMIT = 4 * 1024 * 1024;
const ARTWORK_BYTE_LIMIT = 2 * 1024 * 1024;
const IMAGE_PIXEL_LIMIT = 12_000_000;
const IMAGE_EDGE_LIMIT = 8192;

type ArtworkRange = { offset: number; length: number; mime: "image/jpeg" | "image/png" };

function syncSafeInteger(bytes: Uint8Array, offset: number): number | undefined {
  const a = bytes[offset]; const b = bytes[offset + 1]; const c = bytes[offset + 2]; const d = bytes[offset + 3];
  if (a === undefined || b === undefined || c === undefined || d === undefined || (a | b | c | d) & 0x80) return undefined;
  return (a << 21) | (b << 14) | (c << 7) | d;
}

function unsigned24(bytes: Uint8Array, offset: number): number | undefined {
  const a = bytes[offset]; const b = bytes[offset + 1]; const c = bytes[offset + 2];
  return a === undefined || b === undefined || c === undefined ? undefined : (a << 16) | (b << 8) | c;
}

function unsigned32(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 4 > bytes.length) return undefined;
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function imageDimensions(bytes: Uint8Array, mime: ArtworkRange["mime"]): { width: number; height: number } | undefined {
  if (mime === "image/png") {
    if (!hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || bytes.length < 45
      || unsigned32(bytes, 8) !== 13 || !hasPrefix(bytes.subarray(12, 16), [0x49, 0x48, 0x44, 0x52])
      || unsigned32(bytes, bytes.length - 12) !== 0
      || !hasPrefix(bytes.subarray(bytes.length - 8), [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])) return undefined;
    const width = unsigned32(bytes, 16); const height = unsigned32(bytes, 20);
    return width && height ? { width, height } : undefined;
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return undefined;
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0x00 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return undefined;
    if (frameMarkers.has(marker)) {
      if (segmentLength < 7) return undefined;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return width && height ? { width, height } : undefined;
    }
    offset += segmentLength;
  }
  return undefined;
}

function dimensionsWithinLimit(dimensions: { width: number; height: number } | undefined): boolean {
  return Boolean(dimensions
    && dimensions.width <= IMAGE_EDGE_LIMIT
    && dimensions.height <= IMAGE_EDGE_LIMIT
    && dimensions.width * dimensions.height <= IMAGE_PIXEL_LIMIT);
}

function findTerminator(bytes: Uint8Array, start: number, end: number, wide: boolean): number {
  for (let index = start; index + (wide ? 1 : 0) < end; index += wide ? 2 : 1) {
    if (bytes[index] !== 0) continue;
    if (!wide || bytes[index + 1] === 0) return index;
  }
  return -1;
}

function parseId3Artwork(bytes: Uint8Array, blobSize: number): ArtworkRange | undefined {
  if (!hasPrefix(bytes, [0x49, 0x44, 0x33]) || bytes.length < 10) return undefined;
  const version = bytes[3];
  if (version !== 2 && version !== 3 && version !== 4) return undefined;
  // Unsynchronised and extended headers need transformations/offset handling;
  // unsupported variants safely fall back to playback without artwork.
  if ((bytes[5] & 0xc0) !== 0) return undefined;
  const tagSize = syncSafeInteger(bytes, 6);
  if (tagSize === undefined || tagSize > HEADER_SCAN_LIMIT - 10 || 10 + tagSize > blobSize || 10 + tagSize > bytes.length) return undefined;
  const tagEnd = 10 + tagSize;
  const frameHeaderSize = version === 2 ? 6 : 10;
  let offset = 10;
  while (offset + frameHeaderSize <= tagEnd) {
    const idLength = version === 2 ? 3 : 4;
    if (bytes[offset] === 0) break;
    let frameId = "";
    for (let index = 0; index < idLength; index += 1) frameId += String.fromCharCode(bytes[offset + index]);
    const frameSize = version === 2
      ? unsigned24(bytes, offset + 3)
      : version === 3
        ? unsigned32(bytes, offset + 4)
        : syncSafeInteger(bytes, offset + 4);
    if (frameSize === undefined || frameSize <= 0) return undefined;
    const frameStart = offset + frameHeaderSize;
    const frameEnd = frameStart + frameSize;
    if (frameEnd > tagEnd || frameEnd > bytes.length) return undefined;
    if (frameId === (version === 2 ? "PIC" : "APIC")) {
      if (version >= 3 && bytes[offset + 9] !== 0) return undefined;
      const encoding = bytes[frameStart];
      if (encoding === undefined || encoding > 3) return undefined;
      let mimeStart: number;
      if (version === 2) {
        const format = String.fromCharCode(bytes[frameStart + 1], bytes[frameStart + 2], bytes[frameStart + 3]).toUpperCase();
        mimeStart = frameStart + 4;
        const mime = format === "JPG" ? "image/jpeg" : format === "PNG" ? "image/png" : undefined;
        if (!mime) return undefined;
        const pictureType = bytes[mimeStart++];
        if (pictureType === undefined) return undefined;
        const descriptionEnd = findTerminator(bytes, mimeStart, frameEnd, encoding === 1 || encoding === 2);
        if (descriptionEnd < 0) return undefined;
        const imageOffset = descriptionEnd + (encoding === 1 || encoding === 2 ? 2 : 1);
        return { offset: imageOffset, length: frameEnd - imageOffset, mime };
      }
      mimeStart = frameStart + 1;
      const mimeEnd = findTerminator(bytes, mimeStart, frameEnd, false);
      if (mimeEnd < 0 || mimeEnd + 1 >= frameEnd) return undefined;
      if (mimeEnd - mimeStart > 64) return undefined;
      const mimeText = String.fromCharCode(...bytes.subarray(mimeStart, mimeEnd)).toLowerCase();
      const mime = mimeText === "image/jpeg" ? "image/jpeg" : mimeText === "image/png" ? "image/png" : undefined;
      if (!mime) return undefined;
      const descriptionStart = mimeEnd + 2;
      const descriptionEnd = findTerminator(bytes, descriptionStart, frameEnd, encoding === 1 || encoding === 2);
      if (descriptionEnd < 0) return undefined;
      const imageOffset = descriptionEnd + (encoding === 1 || encoding === 2 ? 2 : 1);
      return { offset: imageOffset, length: frameEnd - imageOffset, mime };
    }
    offset = frameEnd;
  }
  return undefined;
}

function parseFlacArtwork(bytes: Uint8Array, blobSize: number): ArtworkRange | undefined {
  if (!hasPrefix(bytes, [0x66, 0x4c, 0x61, 0x43])) return undefined;
  let offset = 4;
  while (offset + 4 <= bytes.length) {
    const header = bytes[offset];
    const blockType = header & 0x7f;
    const blockSize = unsigned24(bytes, offset + 1);
    if (blockSize === undefined || offset + 4 + blockSize > blobSize || offset + 4 + blockSize > bytes.length) return undefined;
    const blockStart = offset + 4;
    const blockEnd = blockStart + blockSize;
    if (blockType === 6) {
      let cursor = blockStart;
      const pictureType = unsigned32(bytes, cursor); if (pictureType === undefined) return undefined; cursor += 4;
      const mimeLength = unsigned32(bytes, cursor); if (mimeLength === undefined) return undefined; cursor += 4;
      if (mimeLength > 64) return undefined;
      if (cursor + mimeLength > blockEnd) return undefined;
      const mimeText = String.fromCharCode(...bytes.subarray(cursor, cursor + mimeLength)).toLowerCase(); cursor += mimeLength;
      const mime = mimeText === "image/jpeg" ? "image/jpeg" : mimeText === "image/png" ? "image/png" : undefined;
      if (!mime) return undefined;
      const descriptionLength = unsigned32(bytes, cursor); if (descriptionLength === undefined) return undefined; cursor += 4 + descriptionLength;
      if (cursor + 20 > blockEnd) return undefined;
      // FLAC permits zero dimensions when the PICTURE header leaves them
      // unknown. Validate the actual JPEG/PNG dimensions from its image bytes
      // in imageDimensions() instead of rejecting valid artwork here.
      cursor += 16;
      const dataLength = unsigned32(bytes, cursor); if (dataLength === undefined) return undefined; cursor += 4;
      if (dataLength > ARTWORK_BYTE_LIMIT || cursor + dataLength > blockEnd) return undefined;
      return { offset: cursor, length: dataLength, mime };
    }
    offset = blockEnd;
    if (header & 0x80) break;
  }
  return undefined;
}

/** Extracts actual MP3 ID3 APIC or FLAC PICTURE data from already-read bytes. */
export async function extractEmbeddedAudioArtwork(audio: Blob): Promise<Blob | undefined> {
  try {
    if (!audio.size) return undefined;
    const header = new Uint8Array(await audio.slice(0, Math.min(audio.size, HEADER_SCAN_LIMIT)).arrayBuffer());
    const range = parseId3Artwork(header, audio.size) ?? parseFlacArtwork(header, audio.size);
    if (!range || range.length <= 0 || range.length > ARTWORK_BYTE_LIMIT || range.offset < 0 || range.offset + range.length > header.length) return undefined;
    const artwork = audio.slice(range.offset, range.offset + range.length, range.mime);
    const bytes = new Uint8Array(await artwork.arrayBuffer());
    if (!dimensionsWithinLimit(imageDimensions(bytes, range.mime))) return undefined;
    return artwork;
  } catch {
    // Artwork is optional presentation data and must never fail audio playback.
    return undefined;
  }
}
