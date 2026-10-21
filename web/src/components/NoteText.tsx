import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Copy } from "lucide-react";
import type { Translator } from "../i18n";
import { splitTextReferences } from "../lib/textReferences";
import type { TextReferencePart } from "../lib/textReferences";
import "./NoteText.css";

type CopyState = "" | "COPIED" | "FAILED";
type CopyFeedback = { body: string; identity: string; scope: unknown; state: Exclude<CopyState, ""> };
type FoldState = { body: string; identity: string; scope: unknown; expanded: boolean };
type FindState = { body: string; identity: string; scope: unknown; open: boolean; query: string; active: number };
type NoteMatch = { start: number; end: number };
type LowercaseExpansion = { loweredStart: number; loweredEnd: number; sourceStart: number; sourceEnd: number; cumulativeDelta: number };
const FOLD_AFTER_CODE_POINTS = 1200;
const PREVIEW_CODE_POINTS = 1000;
const MAX_NOTE_MATCHES = 500;

function notePreview(body: string): { body: string; folded: boolean } {
  let offset = 0;
  let count = 0;
  let previewEnd = body.length;
  for (const point of body) {
    if (count === PREVIEW_CODE_POINTS) previewEnd = offset;
    if (count >= FOLD_AFTER_CODE_POINTS) return { body: body.slice(0, previewEnd), folded: true };
    offset += point.length;
    count += 1;
  }
  return { body, folded: false };
}

function takeCodePoints(value: string, limit: number): { value: string; count: number; truncated: boolean } {
  let offset = 0;
  let count = 0;
  for (const point of value) {
    if (count >= limit) return { value: value.slice(0, offset), count, truncated: true };
    offset += point.length;
    count += 1;
  }
  return { value, count, truncated: false };
}

function truncateReferenceParts(parts: TextReferencePart[], limit: number): TextReferencePart[] {
  const visible: TextReferencePart[] = [];
  let count = 0;
  for (const part of parts) {
    const clipped = takeCodePoints(part.value, limit - count);
    if (clipped.value) {
      // Keep a link interactive only when its complete, already-validated
      // target is visible. A clipped URL remains plain text and is never
      // reparsed as a new shorter target.
      visible.push(part.kind === "link" && !clipped.truncated
        ? { ...part }
        : { kind: "text", value: clipped.value });
    }
    count += clipped.count;
    if (clipped.truncated || count >= limit) break;
  }
  return visible;
}

/** Lowercase by source code point and record only length-changing mappings. */
function lowercaseWithOffsets(value: string): { lowered: string; expansions: LowercaseExpansion[] } {
  const lowered = value.toLowerCase();
  const expansions: LowercaseExpansion[] = [];
  let sourceOffset = 0;
  let loweredOffset = 0;
  let cumulativeDelta = 0;
  for (const point of value) {
    const nextOffset = sourceOffset + point.length;
    const foldedLength = point.toLowerCase().length;
    const nextLoweredOffset = loweredOffset + foldedLength;
    if (foldedLength !== point.length) {
      cumulativeDelta += foldedLength - point.length;
      expansions.push({ loweredStart: loweredOffset, loweredEnd: nextLoweredOffset, sourceStart: sourceOffset, sourceEnd: nextOffset, cumulativeDelta });
    }
    sourceOffset = nextOffset;
    loweredOffset = nextLoweredOffset;
  }
  return { lowered, expansions };
}

function originalOffset(loweredOffset: number, expansions: LowercaseExpansion[], edge: "start" | "end"): number {
  let low = 0;
  let high = expansions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (expansions[middle].loweredEnd <= loweredOffset) low = middle + 1;
    else high = middle;
  }
  const expansion = expansions[low];
  if (expansion && loweredOffset > expansion.loweredStart && loweredOffset < expansion.loweredEnd) {
    return edge === "start" ? expansion.sourceStart : expansion.sourceEnd;
  }
  const delta = low > 0 ? expansions[low - 1].cumulativeDelta : 0;
  return loweredOffset - delta;
}

function findNoteMatches(body: string, query: string): { matches: NoteMatch[]; limited: boolean } {
  if (!query) return { matches: [], limited: false };
  const source = lowercaseWithOffsets(body);
  const needle = query.toLowerCase();
  if (!needle) return { matches: [], limited: false };
  const matches: NoteMatch[] = [];
  let cursor = 0;
  let lastSourceEnd = -1;
  while (cursor <= source.lowered.length - needle.length) {
    const found = source.lowered.indexOf(needle, cursor);
    if (found < 0) break;
    const start = originalOffset(found, source.expansions, "start");
    const end = originalOffset(found + needle.length, source.expansions, "end");
    cursor = found + Math.max(1, needle.length);
    if (start >= lastSourceEnd) {
      if (matches.length === MAX_NOTE_MATCHES) return { matches, limited: true };
      matches.push({ start, end });
      lastSourceEnd = end;
    }
  }
  return { matches, limited: false };
}

function highlightText(value: string, sourceOffset: number, matches: NoteMatch[], activeMatch: number, currentMatchRef?: RefObject<HTMLElement | null>): ReactNode[] {
  const rendered: ReactNode[] = [];
  let offset = 0;
  for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
    const match = matches[matchIndex];
    if (match.end <= sourceOffset) continue;
    if (match.start >= sourceOffset + value.length) break;
    const start = Math.max(0, match.start - sourceOffset);
    const end = Math.min(value.length, match.end - sourceOffset);
    if (start > offset) rendered.push(value.slice(offset, start));
    if (end > Math.max(offset, start)) {
      rendered.push(<mark key={`match-${match.start}`} ref={matchIndex === activeMatch ? currentMatchRef : undefined} className={matchIndex === activeMatch ? "note-text__match note-text__match--current" : "note-text__match"} aria-current={matchIndex === activeMatch ? "true" : undefined}>{value.slice(Math.max(offset, start), end)}</mark>);
      offset = end;
    }
  }
  if (offset < value.length) rendered.push(value.slice(offset));
  return rendered;
}

/** Renders trusted plain text with only explicitly parsed safe web links. */
export function NoteText({ body, identity, scope, t, canCopy = true }: {
  body: string;
  /** Stable record/revision identity; scope changes when the owning read refreshes. */
  identity: string;
  scope: unknown;
  t: Translator;
  canCopy?: boolean;
}) {
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>();
  const [foldState, setFoldState] = useState<FoldState>({ body, identity, scope, expanded: false });
  const [findState, setFindState] = useState<FindState>({ body, identity, scope, open: false, query: "", active: 0 });
  const findInputRef = useRef<HTMLInputElement>(null);
  const findToggleRef = useRef<HTMLButtonElement>(null);
  const currentMatchRef = useRef<HTMLElement>(null);
  const operationRef = useRef(0);
  const currentRef = useRef({ body, identity, scope, canCopy });
  currentRef.current = { body, identity, scope, canCopy };

  useEffect(() => {
    operationRef.current += 1;
    setCopyFeedback(undefined);
  }, [body, canCopy, identity, scope]);
  useEffect(() => {
    setFoldState({ body, identity, scope, expanded: false });
  }, [body, identity, scope]);
  useEffect(() => {
    setFindState({ body, identity, scope, open: false, query: "", active: 0 });
  }, [body, identity, scope]);
  useEffect(() => () => { operationRef.current += 1; }, []);

  const sameFoldIdentity = foldState.body === body && foldState.identity === identity && Object.is(foldState.scope, scope);
  const sameFindIdentity = findState.body === body && findState.identity === identity && Object.is(findState.scope, scope);
  const finding = sameFindIdentity && findState.open;
  const expanded = (sameFoldIdentity && foldState.expanded) || finding;
  const preview = notePreview(body);
  const copyState: CopyState = copyFeedback && copyFeedback.body === body && copyFeedback.identity === identity
    && Object.is(copyFeedback.scope, scope) ? copyFeedback.state : "";
  const findQuery = finding ? findState.query : "";
  const { matches: noteMatches, limited: matchesLimited } = findNoteMatches(body, findQuery);
  const activeMatch = noteMatches.length ? Math.min(finding ? findState.active : 0, noteMatches.length - 1) : -1;

  useEffect(() => {
    if (finding) currentMatchRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [finding, findQuery, activeMatch, body, identity, scope]);

  function setFindQuery(query: string) {
    setFindState({ body, identity, scope, open: true, query, active: 0 });
  }

  function moveMatch(direction: -1 | 1) {
    if (!noteMatches.length) return;
    const current = finding ? findState.active : 0;
    const active = (current + direction + noteMatches.length) % noteMatches.length;
    setFindState({ body, identity, scope, open: true, query: findQuery, active });
  }

  function closeFind(restoreToggleFocus = false) {
    setFindState({ body, identity, scope, open: false, query: "", active: 0 });
    if (restoreToggleFocus) window.requestAnimationFrame(() => findToggleRef.current?.focus());
  }

  async function copyBody() {
    if (!canCopy) return;
    const token = ++operationRef.current;
    const captured = currentRef.current;
    try {
      const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
      if (!clipboard?.writeText) throw new Error("clipboard unavailable");
      await clipboard.writeText(captured.body);
      if (operationRef.current !== token || currentRef.current.body !== captured.body
        || currentRef.current.identity !== captured.identity || currentRef.current.scope !== captured.scope
        || !currentRef.current.canCopy) return;
      setCopyFeedback({ body: captured.body, identity: captured.identity, scope: captured.scope, state: "COPIED" });
    } catch {
      if (operationRef.current !== token || currentRef.current.body !== captured.body
        || currentRef.current.identity !== captured.identity || currentRef.current.scope !== captured.scope
        || !currentRef.current.canCopy) return;
      setCopyFeedback({ body: captured.body, identity: captured.identity, scope: captured.scope, state: "FAILED" });
    }
  }

  const fullParts = splitTextReferences(body);
  const parts = preview.folded && !expanded
    ? truncateReferenceParts(fullParts, PREVIEW_CODE_POINTS)
    : fullParts;
  let sourceOffset = 0;
  const bodyContent = parts.map((part, index) => {
    const partStart = sourceOffset;
    sourceOffset += part.value.length;
    const current = activeMatch >= 0 ? noteMatches[activeMatch] : undefined;
    const ownsCurrentStart = current !== undefined && current.start >= partStart && current.start < sourceOffset;
    const content = highlightText(part.value, partStart, noteMatches, activeMatch, ownsCurrentStart ? currentMatchRef : undefined);
    const child = part.kind === "link"
      ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{content}</a>
      : <span key={index}>{content}</span>;
    return child;
  });
  return <div className="note-text">
    <div className="note-text__body">{bodyContent}{preview.folded && !expanded && <span aria-hidden="true">…</span>}</div>
    <div className="note-text__actions">
      {preview.folded && <>
        {!expanded && <span className="note-text__status">{t("Showing the first 1,000 characters of this long note.")}</span>}
        <button type="button" className="secondary-button compact note-text__expand" aria-expanded={expanded} onClick={() => {
          if (finding) closeFind();
          setFoldState({ body, identity, scope, expanded: !expanded && !finding });
        }}>{t(expanded ? "Show less" : "Show full note")}</button>
      </>}
      <button ref={findToggleRef} type="button" className="secondary-button compact note-text__find-toggle" aria-expanded={finding} onClick={() => {
        if (finding) closeFind();
        else {
          setFindState({ body, identity, scope, open: true, query: "", active: 0 });
          window.requestAnimationFrame(() => findInputRef.current?.focus());
        }
      }}>{t(finding ? "Close find in note" : "Find in note")}</button>
      {canCopy && <button type="button" className="secondary-button compact note-text__copy" onClick={() => void copyBody()}><Copy size={13} />{t("Copy note body")}</button>}
      {copyState === "COPIED" && <span className="note-text__status" role="status">{t("Copied the exact note body.")}</span>}
      {copyState === "FAILED" && <span className="note-text__status note-text__status--error" role="alert">{t("Could not copy the note body. Clipboard access is unavailable or was denied.")}</span>}
    </div>
    {finding && <div className="note-text__find" role="search" aria-label={t("Find in loaded note")}>
      <label className="note-text__find-label">{t("Find in loaded note")}
      <input ref={findInputRef} type="search" value={findQuery} onChange={(event) => setFindQuery(event.currentTarget.value)} onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          moveMatch(event.shiftKey ? -1 : 1);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeFind(true);
        }
      }} aria-label={t("Find in loaded note")} />
      </label>
      <button type="button" className="secondary-button compact" onClick={() => moveMatch(-1)} disabled={!noteMatches.length} aria-label={t("Previous note match")}>{t("Previous note match")}</button>
      <button type="button" className="secondary-button compact" onClick={() => moveMatch(1)} disabled={!noteMatches.length} aria-label={t("Next note match")}>{t("Next note match")}</button>
      {findQuery && noteMatches.length > 0 && <span className="note-text__status" aria-live="polite">{t(matchesLimited ? "Match {{current}} of at least {{total}}; only first 500 shown." : "Match {{current}} of {{total}}.", { current: activeMatch + 1, total: matchesLimited ? MAX_NOTE_MATCHES + 1 : noteMatches.length })}</span>}
      {findQuery && noteMatches.length === 0 && <span className="note-text__status" role="status">{t("No matches in this loaded note.")}</span>}
    </div>}
  </div>;
}
