import type { SearchSegment } from "./types";

export type OcrSearchEvidence = {
  text: string;
  state: "TEXT" | "PARTIAL" | "EMPTY" | "UNKNOWN";
  quality?: {
    meanConfidence?: number;
    lowConfidenceRegions?: number;
    regionCount?: number;
    truncated?: boolean;
    reasons?: string[];
  };
  returnedFragment: boolean;
};

const OCR_SCHEMA = "cairn.artifact.ocr-text.v1";
const MAX_PAYLOAD_BYTES = 1024 * 1024;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validQuality(value: unknown): OcrSearchEvidence["quality"] | undefined {
  const record = objectRecord(value);
  if (!record) return undefined;
  const quality: NonNullable<OcrSearchEvidence["quality"]> = {};
  const confidence = record.mean_confidence;
  if (confidence !== undefined) {
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return undefined;
    quality.meanConfidence = confidence;
  }
  const low = record.low_confidence_regions;
  if (low !== undefined) {
    if (!Number.isInteger(low) || (low as number) < 0) return undefined;
    quality.lowConfidenceRegions = low as number;
  }
  const regions = record.region_count;
  if (regions !== undefined) {
    if (!Number.isInteger(regions) || (regions as number) < 0) return undefined;
    quality.regionCount = regions as number;
  }
  if (record.truncated !== undefined) {
    if (typeof record.truncated !== "boolean") return undefined;
    quality.truncated = record.truncated;
  }
  if (record.reasons !== undefined) {
    if (!Array.isArray(record.reasons) || !record.reasons.every((reason) => typeof reason === "string")) return undefined;
    quality.reasons = record.reasons as string[];
  }
  return Object.keys(quality).length ? quality : undefined;
}

function evidenceFromRecord(record: Record<string, unknown>, returnedFragment: boolean): OcrSearchEvidence | null {
  if (record.schema !== OCR_SCHEMA || typeof record.text !== "string") return null;
  const state = record.state === "TEXT" || record.state === "PARTIAL" || record.state === "EMPTY"
    ? record.state
    : "UNKNOWN";
  return {
    text: record.text,
    state,
    quality: validQuality(record.quality),
    returnedFragment,
  };
}

function skipWhitespace(input: string, start: number): number {
  let index = start;
  while (index < input.length && /\s/.test(input[index])) index++;
  return index;
}

function readString(input: string, start: number): { value: string; end: number } | null {
  if (input[start] !== '"') return null;
  let escaped = false;
  for (let index = start + 1; index < input.length; index++) {
    const char = input[index];
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === '"') {
      try {
        const value: unknown = JSON.parse(input.slice(start, index + 1));
        return typeof value === "string" ? { value, end: index + 1 } : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function readField(input: string, start: number, expected: string): { value: string; end: number } | null {
  const key = readString(input, start);
  if (!key || key.value !== expected) return null;
  let index = skipWhitespace(input, key.end);
  if (input[index++] !== ":") return null;
  index = skipWhitespace(input, index);
  return readString(input, index);
}

type StringPrefix = { value: string; end: number; complete: boolean };

// Read a JSON string value. If and only if the input ends inside this value,
// return the longest prefix ending at a complete Unicode scalar/escape. Bad
// escapes and malformed UTF-16 before EOF remain refusals.
function readStringValuePrefix(input: string, start: number): StringPrefix | null {
  if (input[start] !== '"') return null;
  let value = "";
  let index = start + 1;
  while (index < input.length) {
    const code = input.charCodeAt(index);
    const char = input[index];
    if (char === '"') return { value, end: index + 1, complete: true };
    if (char === "\\") {
      index++;
      if (index >= input.length) return { value, end: input.length, complete: false };
      const escaped = input[index++];
      const simpleEscapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      if (Object.prototype.hasOwnProperty.call(simpleEscapes, escaped)) {
        value += simpleEscapes[escaped];
        continue;
      }
      if (escaped !== "u") return null;
      if (input.length - index < 4) {
        if (!/^[\da-fA-F]*$/.test(input.slice(index))) return null;
        return { value, end: input.length, complete: false };
      }
      const hex = input.slice(index, index + 4);
      if (!/^[\da-fA-F]{4}$/.test(hex)) return null;
      const unit = Number.parseInt(hex, 16);
      index += 4;
      if (unit >= 0xD800 && unit <= 0xDBFF) {
        if (input.length - index < 6) {
          const remainder = input.slice(index);
          if (remainder.length > 0 && remainder[0] !== "\\") return null;
          if (remainder.length > 1 && remainder[1] !== "u") return null;
          const lowPrefix = remainder.slice(2);
          if (lowPrefix.length > 0 && (!/^[\da-fA-F]{1,3}$/.test(lowPrefix)
            || lowPrefix[0].toUpperCase() !== "D"
            || (lowPrefix.length > 1 && !/[C-F]/i.test(lowPrefix[1])))) return null;
          return { value, end: input.length, complete: false };
        }
        if (input.slice(index, index + 2) !== "\\u") return null;
        const lowHex = input.slice(index + 2, index + 6);
        if (!/^[\da-fA-F]{4}$/.test(lowHex)) return null;
        const low = Number.parseInt(lowHex, 16);
        if (low < 0xDC00 || low > 0xDFFF) return null;
        value += String.fromCharCode(unit, low);
        index += 6;
        continue;
      }
      if (unit >= 0xDC00 && unit <= 0xDFFF) return null;
      value += String.fromCharCode(unit);
      continue;
    }
    if (code < 0x20) return null;
    if (code >= 0xD800 && code <= 0xDBFF) {
      if (index + 1 >= input.length) return { value, end: input.length, complete: false };
      const low = input.charCodeAt(index + 1);
      if (low < 0xDC00 || low > 0xDFFF) return null;
      value += input.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (code >= 0xDC00 && code <= 0xDFFF) return null;
    value += char;
    index++;
  }
  return { value, end: input.length, complete: false };
}

function readTextFieldPrefix(input: string, start: number): StringPrefix | null {
  const key = readString(input, start);
  if (!key || key.value !== "text") return null;
  let index = skipWhitespace(input, key.end);
  if (input[index++] !== ":") return null;
  index = skipWhitespace(input, index);
  return readStringValuePrefix(input, index);
}

// The canonical artifact serializes schema, state, then text. This parser only
// accepts that verifiable prefix; it never searches an arbitrary excerpt for
// a schema-looking substring.
function parseTextPrefix(input: string): OcrSearchEvidence | null {
  let index = skipWhitespace(input, 0);
  if (input[index++] !== "{") return null;
  index = skipWhitespace(input, index);
  const schema = readField(input, index, "schema");
  if (!schema || schema.value !== OCR_SCHEMA) return null;
  index = skipWhitespace(input, schema.end);
  if (input[index++] !== ",") return null;
  index = skipWhitespace(input, index);
  const state = readField(input, index, "state");
  if (!state) return null;
  index = skipWhitespace(input, state.end);
  if (input[index++] !== ",") return null;
  index = skipWhitespace(input, index);
  const text = readTextFieldPrefix(input, index);
  if (!text) return null;
  if (!text.complete) {
    if (text.end !== input.length) return null;
    return evidenceFromRecord({ schema: OCR_SCHEMA, state: state.value, text: text.value }, true);
  }
  index = skipWhitespace(input, text.end);
  if (index < input.length && input[index] !== "," && input[index] !== "}") return null;
  return evidenceFromRecord({ schema: OCR_SCHEMA, state: state.value, text: text.value }, true);
}

function parsePayload(raw: string | undefined, returnedFragment: boolean): OcrSearchEvidence | null {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > MAX_PAYLOAD_BYTES) return null;
  try {
    const record = objectRecord(JSON.parse(raw));
    if (record) {
      const parsed = evidenceFromRecord(record, returnedFragment);
      if (parsed) return parsed;
    }
  } catch {
    // A source excerpt may end after a complete top-level text string.
  }
  return parseTextPrefix(raw);
}

export function searchOcrEvidence(segment: SearchSegment): OcrSearchEvidence | null {
  if (segment.source_type !== "ARTIFACT" || segment.kind !== "EXTRACT") return null;
  return parsePayload(segment.matched_text, false) ?? parsePayload(segment.matched_excerpt, true);
}
