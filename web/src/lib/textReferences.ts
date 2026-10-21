export type TextReferencePart =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string; href: string };

const URL_TOKEN = /https?:\/\/[^\s<>"'`\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f]+/giu;
const SAFE_START = /[\s(\[{"'`（【「『《〈“‘]/u;
const ASCII_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?"]);

function validatedHref(value: string): string | undefined {
  if (!/^https?:\/\/[^/?#]+/iu.test(value) || /[\u0000-\u0020\u007f-\u009f\\]/u.test(value) || /%(?![0-9a-f]{2})/iu.test(value)) return undefined;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname || parsed.username || parsed.password) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

function trimTerminalPunctuation(token: string): number {
  const unmatchedClosing = new Uint8Array(token.length);
  let openRound = 0;
  let openSquare = 0;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === "(") openRound += 1;
    else if (char === ")") {
      if (openRound > 0) openRound -= 1;
      else unmatchedClosing[index] = 1;
    } else if (char === "[") openSquare += 1;
    else if (char === "]") {
      if (openSquare > 0) openSquare -= 1;
      else unmatchedClosing[index] = 1;
    }
  }
  let end = token.length;
  while (end > 0) {
    const char = token[end - 1];
    if (ASCII_PUNCTUATION.has(char) || /[\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f\uff09\u201d\u2019\u3009\u300b\u300d\u300f\u3011\u3015]/u.test(char)) {
      end -= 1;
    } else if (unmatchedClosing[end - 1]) {
      end -= 1;
    } else {
      break;
    }
  }
  return end;
}

/** Split plain text into unchanged text and explicit, safe web-reference tokens. */
export function splitTextReferences(text: string): TextReferencePart[] {
  const parts: TextReferencePart[] = [];
  let cursor = 0;
  URL_TOKEN.lastIndex = 0;
  for (const match of text.matchAll(URL_TOKEN)) {
    const start = match.index ?? 0;
    const token = match[0];
    if (start > cursor) parts.push({ kind: "text", value: text.slice(cursor, start) });
    const previous = start > 0 ? text[start - 1] : "";
    const boundary = start === 0 || SAFE_START.test(previous);
    const end = trimTerminalPunctuation(token);
    const candidate = token.slice(0, end);
    const punctuation = token.slice(end);
    const href = boundary ? validatedHref(candidate) : undefined;
    if (href) {
      parts.push({ kind: "link", value: candidate, href });
      if (punctuation) parts.push({ kind: "text", value: punctuation });
    } else {
      parts.push({ kind: "text", value: token });
    }
    cursor = start + token.length;
  }
  if (cursor < text.length) parts.push({ kind: "text", value: text.slice(cursor) });
  return parts;
}
