import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { Archive, Check, FileAudio, FileText, FileType2, FileVideo, Folder, Image as ImageIcon, Tag } from "lucide-react";
import type { Locale, Translator } from "../i18n";
import { ContentPreview, previewThumbBudget, previewThumbKind } from "./ContentPreview";
import { useResultWindow } from "./ResultWindow";
import { exactIdentityKey, formatBytes, formatEntryType, formatFacetValue, mediaClassFromSuffix, previewUnicodeText, searchSegmentSourceLabel, sortableSize } from "../lib/format";
import type { Command, LibraryLayout, RowClickEvent, SearchHit, SortDirection, SortField, ViewMode } from "../lib/types";

// The library result list: one grid of tiles or one dense list, both rendered
// from the same loaded projection. The listing never invents content: a tile
// shows a picture and a name, and only a real image may read content for its
// thumbnail.
//
// The list is windowed by the shared result window (components/ResultWindow.tsx):
// the DOM holds the rows around the viewport, not the whole publication set, and
// the spacer keeps the document long enough that every item stays reachable.
// Indices handed to the row callbacks are always indices into the full listing.

export function ResultRow({ hit, index, roving, duplicateCount, selected, multiSelected, userTags, sizeSort, t, command, workspaceId, locale, showThumb = true, showMatch = false, onRowClick, onToggleSelection }: { hit: SearchHit; index: number; roving: boolean; duplicateCount: number; selected: boolean; multiSelected: boolean; userTags: string[]; sizeSort: boolean; t: Translator; command: Command; workspaceId: string; locale: Locale; showThumb?: boolean; showMatch?: boolean; onRowClick: (index: number, event: RowClickEvent) => void; onToggleSelection: (index: number) => void }) {
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
  return <div className={`result-row ${selected ? "selected" : ""} ${multiSelected ? "multi-selected" : ""} ${showImageThumb ? "has-thumb" : directory ? "is-folder" : "is-file"}`} role="group" aria-label={title} data-result-index={index} onClick={(event) => onRowClick(index, event)}>
    <span className="result-select" role="checkbox" aria-checked={multiSelected} tabIndex={-1} aria-label={t(multiSelected ? "Deselect {{name}}" : "Select {{name}}", { name: title })} title={t(multiSelected ? "Deselect {{name}}" : "Select {{name}}", { name: title })} onClick={(event) => { event.stopPropagation(); onToggleSelection(index); }}>{multiSelected && <Check size={13} />}</span>
    <span className={`file-icon ${directory ? "is-folder" : showImageThumb ? "is-image" : `is-file is-${typeCue}`}`}>
      {directory ? <Folder size={48} /> : <TypeIcon size={44} />}
      {showImageThumb && <ContentPreview variant="thumb" command={command} locale={locale === "zh-CN" ? "zh-CN" : "en"} workspaceId={workspaceId} entryId={hit.entry_id} subjectRef={hit.subject_ref} contentId={hit.content_id} name={title} logicalSize={hit.logical_size} />}
      {!directory && format && <span className="result-format" aria-label={t("Filename format {{format}}", { format: format.toUpperCase() })}>{format.toUpperCase()}</span>}
      {duplicateCount > 1 && <span className="result-duplicate" title={t("Loaded content contains {{count}} entries with the same SHA-256 and length", { count: duplicateCount })}>{duplicateCount}</span>}
    </span>
    <button type="button" className="result-open-copy" tabIndex={roving ? 0 : -1} onClick={(event) => { event.stopPropagation(); onRowClick(index, event); }}><strong>{title}</strong></button>
    {(!directory || sizeSort) && <span className="result-meta" title={metaText}><span>{metaText}</span></span>}
    {visibleSegments.map((segment, index) => {
      const segmentKey = `${segment.semantic_segment_id || segment.source_id || segment.source_type || "segment"}-${segment.ordinal ?? index}-${index}`;
      const evidence = segment.matched_excerpt || segment.matched_text;
      return <span className="result-match" title={segment.matched_text} aria-label={t("Matched segment provenance")} key={segmentKey}><b>{searchSegmentSourceLabel(segment, t)}</b>{previewUnicodeText(evidence, 72)}</span>;
    })}
    {visibleTags.length > 0 && <span className="result-tags" title={userTags.join(" · ")}>{visibleTags.map((value) => <span className="result-tag" key={value}><Tag size={10} />{value}</span>)}{userTags.length > visibleTags.length && <span className="result-tag more">+{userTags.length - visibleTags.length}</span>}</span>}
  </div>;
}

export function ResultList({ hits, libraryListRef, libraryLayout, sortField, sortDirection, selectionCount, rovingRow, selectedRef, selectionRefs, identityCounts, tagsBySubject, viewMode, locale, t, command, workspaceID, onRowClick, onToggleSelection, onKeyDown }: {
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
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  const window = useResultWindow({ containerRef: libraryListRef, count: hits.length });
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
  const mounted = hits.slice(startIndex, endIndex);
  return <div ref={libraryListRef} className={`result-list ${libraryLayout === "list" ? "list-mode" : ""} ${sortField === "size" ? "sort-by-size" : ""} ${window.containerClass}`} style={window.containerStyle} role="group" aria-label={t("Library results")} aria-description={t("Use the arrow keys to move between tiles, Space to select the focused tile, Enter to open its details, and Escape to clear the selection.")} data-sort-field={sortField} data-sort-direction={sortDirection} data-selection-count={selectionCount} data-rendered-from={startIndex} data-rendered-to={endIndex} data-listing-count={hits.length} onKeyDown={onKeyDown}>{mounted.map((hit, offset) => <ResultRow key={hit.subject_ref ?? startIndex + offset} index={startIndex + offset} roving={startIndex + offset === rovingRow} hit={hit} duplicateCount={identityCounts.get(exactIdentityKey(hit)) ?? 1} selected={selectedRef === hit.subject_ref} multiSelected={Boolean(hit.subject_ref && selectionRefs.includes(hit.subject_ref))} userTags={hit.subject_ref ? tagsBySubject.get(hit.subject_ref) ?? [] : []} sizeSort={sortField === "size"} t={t} command={command} workspaceId={workspaceID} locale={locale} showThumb={startIndex + offset < 48} showMatch={viewMode === "search"} onRowClick={onRowClick} onToggleSelection={onToggleSelection} />)}</div>;
}
