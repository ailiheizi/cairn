import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { Archive, Check, Copy, Download, FileAudio, FileText, FileType2, FileVideo, Folder, Image as ImageIcon, MoreHorizontal, Tag } from "lucide-react";
import type { Locale, Translator } from "../i18n";
import { ContentPreview, previewThumbBudget, previewThumbKind } from "./ContentPreview";
import { PhotoThumbnail } from "./PhotoThumbnail";
import { useResultWindow } from "./ResultWindow";
import { exactIdentityKey, formatBytes, formatEntryType, formatFacetValue, mediaClassFromSuffix, previewUnicodeText, searchImageMetadata, searchImageMetadataSummary, searchSegmentSourceLabel, sortableSize } from "../lib/format";
import { downloadOriginal } from "../lib/contentDownload";
import type { Command, LibraryLayout, RowClickEvent, SearchHit, SortDirection, SortField, ViewMode } from "../lib/types";
import "./ResultList.css";

// The library result list: one grid of tiles or one dense list, both rendered
// from the same loaded projection. The listing never invents content: a tile
// shows a picture and a name, and only a real image may read content for its
// thumbnail.
//
// The list is windowed by the shared result window (components/ResultWindow.tsx):
// the DOM holds the rows around the viewport, not the whole publication set, and
// the spacer keeps the document long enough that every item stays reachable.
// Indices handed to the row callbacks are always indices into the full listing.
//
// The wall is fed one bounded page at a time. `listingPositions` is the exact
// total the daemon reported for the whole projection when this wall shows it:
// the scroll length is already the whole listing's from the first page, and a
// position whose page has not arrived yet is held open as a quiet pending
// placeholder. It is never rendered as an item and never counted as one. When
// the mounted window reaches the end of the loaded positions the shared window
// asks for the next page (`onLoadMore`), so a page boundary is not the end of
// the listing.

export function ResultRow({ hit, index, roving, duplicateCount, selected, multiSelected, userTags, sizeSort, t, command, workspaceId, locale, showThumb = true, showMatch = false, onRowClick, onToggleSelection, onExtendSelection }: { hit: SearchHit; index: number; roving: boolean; duplicateCount: number; selected: boolean; multiSelected: boolean; userTags: string[]; sizeSort: boolean; t: Translator; command: Command; workspaceId: string; locale: Locale; showThumb?: boolean; showMatch?: boolean; onRowClick: (index: number, event: RowClickEvent) => void; onToggleSelection: (index: number) => void; onExtendSelection?: (index: number) => void }) {
  const actionsRef = useRef<HTMLDetailsElement>(null);
  const actionsSummaryRef = useRef<HTMLElement>(null);
  const operationRef = useRef(0);
  const identityRef = useRef("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<{ identity: string; status: "copied" | "failed" } | null>(null);
  const identity = JSON.stringify([workspaceId, hit.subject_ref ?? "", hit.entry_id ?? "", hit.content_id ?? "", hit.logical_size ?? null, hit.entry_type ?? "", hit.name ?? "", hit.path ?? ""]);
  identityRef.current = identity;
  useEffect(() => {
    operationRef.current += 1;
    setCopyFeedback(null);
    setActionsOpen(false);
    if (actionsRef.current) actionsRef.current.open = false;
    return () => { operationRef.current += 1; };
  }, [identity]);
  const canDownloadOriginal = Boolean(workspaceId.trim() && hit.entry_type === "REGULAR_FILE" && hit.subject_ref?.trim() && hit.entry_id?.trim() && /^sha256:[0-9a-f]{64}$/.test(hit.content_id ?? ""));
  const copyValue = async (value: string) => {
    const capturedIdentity = identity;
    const operation = ++operationRef.current;
    setCopyFeedback(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      if (identityRef.current === capturedIdentity && operationRef.current === operation) setCopyFeedback({ identity: capturedIdentity, status: "copied" });
    } catch {
      if (identityRef.current === capturedIdentity && operationRef.current === operation) setCopyFeedback({ identity: capturedIdentity, status: "failed" });
    }
  };
  const closeActionsOnEscape = (event: ReactKeyboardEvent<HTMLDetailsElement>) => {
    event.stopPropagation();
    if (event.key !== "Escape" || !actionsRef.current?.open) return;
    event.preventDefault();
    actionsRef.current.open = false;
    setActionsOpen(false);
    requestAnimationFrame(() => actionsSummaryRef.current?.focus());
  };
  const directory = hit.entry_type === "DIRECTORY";
  const matchedSegments = showMatch ? (hit.segments ?? []).filter((segment) => Boolean(segment.matched_text?.trim())) : [];
  const visibleSegments = matchedSegments.slice(0, 1);
  const title = hit.name || t("Untitled subject");
  // The tile is a picture and a name. The existing showThumb rule is the only
  // tile gate: only a real image may read content for its thumbnail, because a
  // text or unsupported file is read by opening it, never by a tile preview.
  const thumbKind = showThumb && !directory && Boolean(workspaceId) ? previewThumbKind(title) : undefined;
  const thumbSizeKnown = hit.logical_size == null || (Number.isSafeInteger(hit.logical_size) && hit.logical_size >= 0 && hit.logical_size <= previewThumbBudget());
  const showImageThumb = thumbKind === "image" && thumbSizeKnown;
  const format = directory ? "" : formatFacetValue(hit);
  const mediaClass = mediaClassFromSuffix(format);
  const typeCue = mediaClass === "audio" ? "audio" : mediaClass === "video" ? "video" : mediaClass === "image" ? "image" : ["zip", "7z", "rar", "tar", "gz", "bz2", "xz"].includes(format) ? "archive" : mediaClass === "document" ? "document" : "file";
  const TypeIcon = typeCue === "audio" ? FileAudio : typeCue === "video" ? FileVideo : typeCue === "image" ? ImageIcon : typeCue === "archive" ? Archive : typeCue === "document" ? FileType2 : FileText;
  const exactSize = sortableSize(hit);
  // The size becomes visible whenever it is the sort key, so a size ordering
  // (and the entries that have no logical size at all) can be checked by eye.
  const sizeLabel = exactSize === null ? t("No logical size") : formatBytes(exactSize);
  const entryTypeLabel = hit.entry_type === "REGULAR_FILE" ? t("File") : hit.entry_type === "DIRECTORY" ? t("Folder") : hit.entry_type === "SYMLINK" ? t("Symbolic link") : formatEntryType(hit.entry_type, t);
  const metaText = `${sizeLabel} · ${entryTypeLabel}${format ? ` · ${format.toUpperCase()}` : ""}`;
  const visibleTags = userTags.slice(0, 2);
  return <div className={`result-row ${selected ? "selected" : ""} ${multiSelected ? "multi-selected" : ""} ${showImageThumb ? "has-thumb" : directory ? "is-folder" : "is-file"} ${actionsOpen ? "result-row-actions-open" : ""}`} role="group" aria-label={title} data-result-index={index} onClick={(event) => onRowClick(index, event)}>
    <button type="button" className="result-select" role="checkbox" aria-checked={multiSelected} tabIndex={-1} aria-label={t(multiSelected ? "Deselect {{name}}" : "Select {{name}}", { name: title })} title={t(multiSelected ? "Deselect {{name}}" : "Select {{name}}", { name: title })} onClick={(event) => { event.stopPropagation(); if (event.shiftKey && onExtendSelection) onExtendSelection(index); else onToggleSelection(index); }} onKeyDown={(event) => {
      // A focused checkbox owns its Enter/Space: it toggles this row once and
      // never bubbles into the list's roving Space/Enter or row-open handling.
      // preventDefault on keydown/keyup also suppresses the native button click,
      // so the keyboard path cannot toggle a second time.
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) onToggleSelection(index);
    }} onKeyUp={(event) => { if (event.key === " ") { event.preventDefault(); event.stopPropagation(); } }}>{multiSelected && <Check size={14} />}</button>
    <span className={`file-icon ${directory ? "is-folder" : showImageThumb ? "is-image" : `is-file is-${typeCue}`}`}>
      {directory ? <Folder size={48} /> : <TypeIcon size={44} />}
      {showImageThumb && (
        index < 48
        ? <ContentPreview variant="thumb" command={command} locale={locale === "zh-CN" ? "zh-CN" : "en"} workspaceId={workspaceId} entryId={hit.entry_id} subjectRef={hit.subject_ref} contentId={hit.content_id} name={title} logicalSize={hit.logical_size} />
        : <PhotoThumbnail command={command} locale={locale === "zh-CN" ? "zh-CN" : "en"} workspaceId={workspaceId} entryId={hit.entry_id} subjectRef={hit.subject_ref} contentId={hit.content_id} name={title} logicalSize={hit.logical_size} className="result-thumb-deferred" deferUntilVisible />
      )}
      {!directory && format && <span className="result-format" aria-label={t("Filename format {{format}}", { format: format.toUpperCase() })}>{format.toUpperCase()}</span>}
      {duplicateCount > 1 && <span className="result-duplicate" title={t("Loaded content contains {{count}} entries with the same SHA-256 and length", { count: duplicateCount })}>{duplicateCount}</span>}
    </span>
    <button type="button" className="result-open-copy" title={title} tabIndex={roving ? 0 : -1} onClick={(event) => { event.stopPropagation(); onRowClick(index, event); }}><strong>{title}</strong></button>
    {(!directory || sizeSort) && <span className="result-meta" title={metaText}><span>{metaText}</span></span>}
    {visibleSegments.map((segment, index) => {
      const segmentKey = `${segment.semantic_segment_id || segment.source_id || segment.source_type || "segment"}-${segment.ordinal ?? index}-${index}`;
      const evidence = segment.matched_excerpt || segment.matched_text;
      const imageMetadata = searchImageMetadata(segment);
      const preview = imageMetadata ? searchImageMetadataSummary(imageMetadata, t) : evidence;
      return <span className="result-match" title={segment.matched_text} aria-label={t("Matched segment provenance")} data-image-metadata={imageMetadata ? "recognized" : undefined} key={segmentKey}><b>{searchSegmentSourceLabel(segment, t)}</b>{previewUnicodeText(preview, 72)}</span>;
    })}
    {visibleTags.length > 0 && <span className="result-tags" title={userTags.join(" · ")}>{visibleTags.map((value) => <span className="result-tag" key={value}><Tag size={10} />{value}</span>)}{userTags.length > visibleTags.length && <span className="result-tag more">+{userTags.length - visibleTags.length}</span>}</span>}
    <details ref={actionsRef} className="result-row-actions" onClick={(event) => event.stopPropagation()} onKeyDown={closeActionsOnEscape} onToggle={() => setActionsOpen(actionsRef.current?.open ?? false)}>
      <summary ref={actionsSummaryRef} aria-label={`${t("More actions")}: ${title}`} title={t("More actions")} onClick={(event) => event.stopPropagation()}><MoreHorizontal size={18} /></summary>
      <div className="result-row-actions__panel">
        {hit.entry_type === "REGULAR_FILE" && <button type="button" disabled={!canDownloadOriginal} onClick={(event) => { event.stopPropagation(); if (canDownloadOriginal) downloadOriginal(workspaceId, hit.entry_id!, hit.name || "download.bin"); }}><Download size={14} />{t("Download original")}</button>}
        <button type="button" disabled={!hit.name} onClick={(event) => { event.stopPropagation(); if (hit.name) void copyValue(hit.name); }}><Copy size={14} />{t("Copy filename")}</button>
        <button type="button" disabled={!hit.path} onClick={(event) => { event.stopPropagation(); if (hit.path) void copyValue(hit.path); }}><Copy size={14} />{hit.path ? t("Copy path") : t("Source path unavailable")}</button>
        {copyFeedback?.identity === identity && <span role="status" aria-live="polite">{t(copyFeedback.status === "copied" ? "Copied to clipboard." : "Could not copy. Clipboard access is unavailable or was denied.")}</span>}
      </div>
    </details>
  </div>;
}

export function ResultList({ hits, libraryListRef, libraryLayout, sortField, sortDirection, selectionCount, rovingRow, selectedRef, selectionRefs, identityCounts, tagsBySubject, viewMode, locale, t, command, workspaceID, onRowClick, onToggleSelection, onExtendSelection, onKeyDown, listingPositions, onLoadMore }: {
  hits: SearchHit[];
  libraryListRef: RefObject<HTMLDivElement | null>;
  libraryLayout: LibraryLayout;
  sortField: SortField;
  sortDirection: SortDirection;
  selectionCount: number;
  rovingRow: number;
  selectedRef: string;
  selectionRefs: string[];
  identityCounts: Map<string, number>;
  tagsBySubject: Map<string, string[]>;
  viewMode: ViewMode;
  locale: Locale;
  t: Translator;
  command: Command;
  workspaceID: string;
  onRowClick: (index: number, event: RowClickEvent) => void;
  onToggleSelection: (index: number) => void;
  /** Optional range selection for the ordinary Library list only. */
  onExtendSelection?: (index: number) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  /** The exact total position count of the projection this wall shows, when the
   *  daemon reported one. Positions at or past `hits.length` are not loaded yet
   *  and are held open as pending placeholders. */
  listingPositions?: number;
  /** Fetches the next bounded page when the window reaches the loaded edge. */
  onLoadMore?: () => void;
}) {
  const positions = Math.max(hits.length, Number.isFinite(listingPositions) ? Math.max(0, Math.floor(listingPositions ?? 0)) : 0);
  const window = useResultWindow({ containerRef: libraryListRef, count: positions, loadedCount: hits.length, onNeedMore: onLoadMore });
  const { startIndex, endIndex, revealIndex } = window;
  const focusWasInList = useRef(false);
  // Arrow keys, Home and End move a roving index over the whole listing, not
  // only over the mounted rows. When the target row is outside the window, the
  // list is scrolled to it first and focus follows once it is mounted, so an
  // item scrolled out of the window is still keyboard-reachable and keeps its
  // selection: selection lives on the subject refs, never on the mounted row.
  useEffect(() => {
    const container = libraryListRef.current;
    if (!container || container.querySelector(`[data-result-index="${rovingRow}"]`)) return;
    focusWasInList.current = container.contains(document.activeElement);
    revealIndex(rovingRow);
  }, [libraryListRef, revealIndex, rovingRow]);
  useEffect(() => {
    const container = libraryListRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-result-index="${rovingRow}"] .result-open-copy`);
    if (!target) return;
    if (document.activeElement === target) { focusWasInList.current = false; return; }
    if (!focusWasInList.current) return;
    focusWasInList.current = false;
    target.focus({ preventScroll: true });
  }, [libraryListRef, rovingRow, startIndex, endIndex]);
  // One entry per laid-out position, so a position whose page has not arrived
  // keeps its place and its height instead of shortening the document. Pending
  // positions carry no `data-result-index`: they are neither measured as items
  // nor reachable as rows.
  const rowHeight = window.rowHeight > 0 ? { height: `${window.rowHeight}px` } : undefined;
  const positionsToRender = [];
  for (let position = startIndex; position < endIndex; position += 1) {
    const hit = hits[position];
    positionsToRender.push(hit
      ? <ResultRow key={hit.subject_ref ?? position} index={position} roving={position === rovingRow} hit={hit} duplicateCount={identityCounts.get(exactIdentityKey(hit)) ?? 1} selected={selectedRef === hit.subject_ref} multiSelected={Boolean(hit.subject_ref && selectionRefs.includes(hit.subject_ref))} userTags={hit.subject_ref ? tagsBySubject.get(hit.subject_ref) ?? [] : []} sizeSort={sortField === "size"} t={t} command={command} workspaceId={workspaceID} locale={locale} showMatch={viewMode === "search"} onRowClick={onRowClick} onToggleSelection={onToggleSelection} onExtendSelection={onExtendSelection} />
      : <div className="result-pending" key={`pending-${position}`} style={rowHeight} data-result-pending={position} role="presentation" aria-hidden="true" />);
  }
  return <div ref={libraryListRef} className={`result-list ${libraryLayout === "list" ? "list-mode" : ""} ${sortField === "size" ? "sort-by-size" : ""} ${window.containerClass}`} style={window.containerStyle} role="group" aria-label={t("Library results")} aria-description={t("Use the arrow keys to move between tiles, Space to select the focused tile, Enter to open its details, and Escape to clear the selection.")} data-sort-field={sortField} data-sort-direction={sortDirection} data-selection-count={selectionCount} data-rendered-from={startIndex} data-rendered-to={endIndex} data-listing-count={hits.length} data-listing-total={positions} onKeyDown={onKeyDown}>{positionsToRender}</div>;
}
