import type { DragEvent, MouseEvent, PointerEvent, RefObject } from "react";
import { ChevronLeft, ChevronRight, Download as DownloadIcon, Image as ImageIcon, Pause, Play, Search, X } from "lucide-react";
import { ContentPreview } from "../ContentPreview";
import { PhotoThumbnail } from "../PhotoThumbnail";
import { FavoriteButton } from "../FavoriteButton";
import type { FavoriteControls } from "../../lib/favorites";
import { capturedModificationTimeMillis } from "../../lib/capturedTime";
import { downloadOriginal } from "../../lib/contentDownload";
import type { PhotoItem, PhotoSharedProps } from "./photoTypes";

type Props = {
  current: PhotoItem;
  viewerItems: PhotoItem[];
  visibleCount: number;
  selectedPhotoCount: number;
  activeViewerIndex: number;
  filmstripStart: number;
  nearbyViewerItems: PhotoItem[];
  selected: boolean;
  viewerScope: "matches" | "selected";
  viewerFullscreen: boolean;
  viewerFullscreenMessage: string;
  fullscreenSupported: boolean;
  slideshowPlaying: boolean;
  slideshowSeconds: number;
  nextItem?: PhotoItem;
  viewerDialogRef: RefObject<HTMLElement | null>;
  viewerTitleRef: RefObject<HTMLHeadingElement | null>;
  command: PhotoSharedProps["command"];
  locale: PhotoSharedProps["locale"];
  workspaceID: string;
  t: PhotoSharedProps["t"];
  favoriteControls?: FavoriteControls;
  selectionRefs: string[];
  onFocusSubject?: (subjectRef: string) => void;
  onShowSelectionActions?: () => void;
  onClose: () => void;
  onToggleFullscreen: () => void;
  onOpenDetails: (item: PhotoItem) => void;
  onToggleSelection: (item: PhotoItem) => void;
  onShowBatchActions: () => void;
  onMove: (position: number) => void;
  onBeginSwipe: (event: PointerEvent<HTMLDivElement>) => void;
  onConsumeSwipeClick: (event: MouseEvent<HTMLDivElement>) => void;
  onBlockMediaDrag: (event: DragEvent<HTMLDivElement>) => void;
  onChangeScope: (scope: "matches" | "selected") => void;
  onToggleSlideshow: () => void;
  onStopSlideshow: () => void;
  onSlideshowSecondsChange: (seconds: number) => void;
  slideshowItemSupported: (item: PhotoItem | undefined) => boolean;
  imageSearchBusy?: boolean;
  visualSearchError?: string;
  onSearchSimilar?: () => void;
};

export function PhotoViewer(props: Props) {
  const { current, viewerItems, visibleCount, selectedPhotoCount, activeViewerIndex, filmstripStart, nearbyViewerItems, selected, viewerScope, viewerFullscreen, viewerFullscreenMessage, fullscreenSupported, slideshowPlaying, slideshowSeconds, nextItem, viewerDialogRef, viewerTitleRef, command, locale, workspaceID, t, favoriteControls, selectionRefs, onFocusSubject, onShowSelectionActions } = props;
  const viewerModifiedMillis = capturedModificationTimeMillis(current.hit.modified_at);
  const viewerModifiedLabel = viewerModifiedMillis === undefined
    ? t("Recorded modification time unavailable")
    : t("Recorded modification time: {{time}}", { time: new Date(viewerModifiedMillis).toLocaleString(locale || undefined) });
  return <div className="photo-viewer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <section ref={viewerDialogRef} className="photo-viewer" role="dialog" aria-modal="true" aria-label={t("Photo viewer")}>
      <header className="photo-viewer__header">
        <div className="photo-viewer__identity"><h2 ref={viewerTitleRef} tabIndex={-1}>{current.hit.name || t("Untitled subject")}</h2><span>{t("{{position}} of {{count}}", { position: activeViewerIndex + 1, count: viewerItems.length })}</span><span className="photo-viewer__selection-count" role="status">{t("{{count}} selected items", { count: selectedPhotoCount })}</span><span className="photo-viewer__modified" role="status">{viewerModifiedLabel}</span></div>
        <div className="photo-viewer__actions">
          <button type="button" aria-pressed={viewerFullscreen} disabled={!fullscreenSupported} onClick={props.onToggleFullscreen}>{t(viewerFullscreen ? "Exit fullscreen" : "Enter fullscreen")}</button>
          {props.onSearchSimilar && <button type="button" disabled={props.imageSearchBusy} onClick={props.onSearchSimilar}><Search size={15} />{t("Find similar photos")}</button>}
          <button type="button" aria-label={t("Details")} onClick={() => props.onOpenDetails(current)}>{t("Details")}</button>
          {current.hit.entry_type === "REGULAR_FILE" && current.hit.entry_id && current.hit.content_id && <button type="button" onClick={() => downloadOriginal(workspaceID, current.hit.entry_id!, current.hit.name || "download.bin")}><DownloadIcon size={15} />{t("Download original")}</button>}
          <button type="button" className={`photo-viewer__select ${selected ? "is-selected" : ""}`} aria-pressed={selected} aria-label={t(selected ? "Deselect {{name}}" : "Select {{name}}", { name: current.hit.name || t("Untitled subject") })} title={t(selected ? "Deselect {{name}}" : "Select {{name}}", { name: current.hit.name || t("Untitled subject") })} disabled={!current.hit.subject_ref} onFocus={() => current.hit.subject_ref && onFocusSubject?.(current.hit.subject_ref)} onClick={() => props.onToggleSelection(current)}><ImageIcon size={15} />{t(selected ? "Selected" : "Select")}</button>
          <span className="photo-viewer__favorite" onKeyDown={(event) => event.stopPropagation()} onFocusCapture={() => current.hit.subject_ref && onFocusSubject?.(current.hit.subject_ref)}><FavoriteButton hit={current.hit} controls={favoriteControls} t={t} /></span>
          {onShowSelectionActions && selectionRefs.length > 0 && <button type="button" onClick={props.onShowBatchActions}>{t("Show batch actions")}</button>}
          <button type="button" aria-label={t("Close viewer")} onClick={props.onClose}><X size={18} /></button>
        </div>
      </header>
      {!fullscreenSupported && <p className="photo-viewer__fullscreen-message" role="status">{t("Fullscreen is unavailable in this browser.")}</p>}
      {viewerFullscreenMessage && <p className="photo-viewer__fullscreen-message" role="status">{viewerFullscreenMessage}</p>}
      {props.visualSearchError && <p className="photo-viewer__fullscreen-message" role="alert">{props.visualSearchError}</p>}
      <button type="button" className="photo-viewer__nav photo-viewer__nav--prev" aria-label={t("Previous photo")} disabled={activeViewerIndex <= 0} onClick={() => props.onMove(Math.max(0, activeViewerIndex - 1))}><ChevronLeft /></button>
      <div className="photo-viewer__body" onPointerDown={props.onBeginSwipe} onClickCapture={props.onConsumeSwipeClick} onDragStart={props.onBlockMediaDrag}>
        <ContentPreview key={`${current.hit.entry_id ?? current.hit.subject_ref}:${current.hit.content_id ?? ""}`} variant="inspector" autoOpen directImageControls command={command} locale={locale} workspaceId={workspaceID} entryId={current.hit.entry_id} subjectRef={current.hit.subject_ref} contentId={current.hit.content_id} name={current.hit.name || t("Untitled subject")} logicalSize={current.hit.logical_size} />
      </div>
      <footer className="photo-viewer__footer">
        <div className="photo-viewer__scope" role="group" aria-label={t("Photo review scope")}>
          <button type="button" aria-pressed={viewerScope === "matches"} disabled={viewerScope === "matches"} onClick={() => props.onChangeScope("matches")}>{t("All current matches ({{count}})", { count: visibleCount })}</button>
          <button type="button" aria-pressed={viewerScope === "selected"} disabled={viewerScope === "selected" || !selectedPhotoCount} onClick={() => props.onChangeScope("selected")}>{t("Only selected in matches ({{count}})", { count: selectedPhotoCount })}</button>
        </div>
        <div className="photo-viewer__slideshow" aria-label={t("Slideshow controls")}>
          <button type="button" aria-pressed={slideshowPlaying} disabled={!slideshowPlaying && (!props.slideshowItemSupported(current) || !props.slideshowItemSupported(nextItem))} onClick={props.onToggleSlideshow}>{slideshowPlaying ? <Pause size={16} /> : <Play size={16} />}{t(slideshowPlaying ? "Pause slideshow" : "Start slideshow")}</button>
          <label>{t("Interval")}<select value={slideshowSeconds} onChange={(event) => props.onSlideshowSecondsChange(Number(event.target.value))}>{[3, 5, 8, 12].map((seconds) => <option key={seconds} value={seconds}>{t("{{seconds}} seconds", { seconds })}</option>)}</select></label>
        </div>
        <nav className="photo-viewer__filmstrip" aria-label={t("Nearby photos")}>
          {nearbyViewerItems.map((item, offset) => {
            const position = filmstripStart + offset;
            const name = item.hit.name || item.hit.path?.split(/[\\/]/).at(-1) || t("Untitled subject");
            return <button key={item.hit.subject_ref ?? item.hit.entry_id ?? position} type="button" className={`${position === activeViewerIndex ? "is-current " : ""}${item.previewable ? "has-thumbnail" : ""}`} aria-current={position === activeViewerIndex ? "true" : undefined} aria-label={t("Open photo {{name}}, {{position}} of {{count}}", { name, position: position + 1, count: viewerItems.length })} onClick={() => { props.onStopSlideshow(); props.onMove(position); }}>
              {item.previewable && <span className="photo-viewer__filmstrip-preview" aria-hidden="true"><PhotoThumbnail command={command} locale={locale} workspaceId={workspaceID} entryId={item.hit.entry_id} subjectRef={item.hit.subject_ref} contentId={item.hit.content_id} name={name} logicalSize={item.hit.logical_size} deferUntilVisible /></span>}
              <span className="photo-viewer__filmstrip-position">{position + 1}</span><strong>{name}</strong>
            </button>;
          })}
        </nav>
      </footer>
      <button type="button" className="photo-viewer__nav photo-viewer__nav--next" aria-label={t("Next photo")} disabled={activeViewerIndex < 0 || activeViewerIndex === viewerItems.length - 1} onClick={() => props.onMove(Math.min(viewerItems.length - 1, activeViewerIndex + 1))}><ChevronRight /></button>
    </section>
  </div>;
}
