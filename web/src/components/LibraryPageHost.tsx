import { Component, useEffect, useRef, useState } from "react";
import type { ComponentProps, ErrorInfo, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { ContentPreview } from "./ContentPreview";
import { ResultList } from "./ResultList";
import { PhotoLibraryExperience } from "./PhotoLibraryExperience";
import { MusicLibraryExperience } from "./MusicLibraryExperience";
import { VideoLibraryExperience } from "./VideoLibraryExperience";
import { PhotoExhibition } from "./PhotoExhibition";
import { PhotoThumbnail } from "./PhotoThumbnail";
import { OverviewExperience } from "./OverviewExperience";
import type { AudioTrack } from "../lib/audioPlayback";
import { allLibraryPageIds, enabledLibraryPageGroups, libraryPageForMode, libraryPages, validateLibraryRendererIDs, type LibraryPageId } from "../lib/libraryViews";
import type { LibraryPageMode, SearchHit, ViewMode } from "../lib/types";
import type { MusicMetadataState } from "../lib/musicMetadata";
import type { FavoriteControls } from "../lib/favorites";
import type { MusicQueueControls } from "../lib/musicQueueControls";
import { downloadOriginal } from "../lib/contentDownload";

export type LibraryResultProps = ComponentProps<typeof ResultList>;
type ExhibitionProps = {
  hits: SearchHit[];
  totalCount: number;
  selectedRef: string;
  selectionRefs: string[];
  selectionCount?: number;
  focusedSubjectRef?: string;
  t: LibraryResultProps["t"];
  renderThumbnail: (hit: SearchHit) => ReactNode;
  onToggleSelection: (index: number) => void;
  onOpenHit: (hit: SearchHit) => void;
  onFocusSubject: (subjectRef: string) => void;
  onReturnToWall: () => void;
  returnLabel: string;
  onOpenPhotoPreview: (hit: SearchHit, trigger: HTMLElement) => void;
  onShowSelectionActions?: () => void;
};
type PageRenderer = (props: LibraryPageHostProps) => ReactNode;

export type LibraryPageHostProps = {
  mode: ViewMode;
  enabledPageIds?: ReadonlySet<LibraryPageId>;
  resultProps: LibraryResultProps;
  onOpenHit: (hit: SearchHit) => void;
  focusedSubjectRef?: string;
  focusRequest?: number;
  onFocusSubject?: (subjectRef: string) => void;
  photoLoading?: boolean;
  onPlayTrack?: (track: AudioTrack) => void;
  onQueueTrack?: (track: AudioTrack) => void;
  onPlayTracks?: (tracks: AudioTrack[]) => void;
  onSelectSubjects?: (subjects: SearchHit[], mode: "add" | "remove" | "invert") => void;
  onImageSearch?: (subjectRef: string) => void;
  onVisualTextSearch?: (description: string) => void;
  imageSearchBusy?: boolean;
  onDownloadOriginals?: (subjects: SearchHit[]) => void;
  originalTakeoutBusy?: boolean;
  onCreateMaterialList?: (subjects: SearchHit[]) => void;
  materialListCreationDisabled?: boolean;
  musicMetadata?: MusicMetadataState;
  favoriteControls?: FavoriteControls;
  musicQueueControls?: MusicQueueControls;
  onReturnToWall?: () => void;
  returnLabel?: string;
  onFallback?: (mode: ViewMode) => void;
  onOpenPhotoPreview?: (hit: SearchHit, trigger: HTMLElement) => void;
  onShowSelectionActions?: () => void;
  onNavigate?: (mode: "content" | LibraryPageMode, focusHit?: SearchHit) => void;
};

function renderPhotos({ resultProps, onOpenHit, focusedSubjectRef, focusRequest, onFocusSubject, onShowSelectionActions, photoLoading, favoriteControls, onSelectSubjects, onDownloadOriginals, originalTakeoutBusy, onCreateMaterialList, materialListCreationDisabled, onImageSearch, onVisualTextSearch, imageSearchBusy }: LibraryPageHostProps) {
  return <PhotoLibraryExperience
    {...resultProps}
    onOpenHit={onOpenHit}
    focusedSubjectRef={focusedSubjectRef}
    focusRequest={focusRequest}
    onFocusSubject={onFocusSubject}
    onShowSelectionActions={onShowSelectionActions}
    loading={photoLoading}
    favoriteControls={favoriteControls}
    onSelectSubjects={onSelectSubjects}
    onImageSearch={onImageSearch}
    onVisualTextSearch={onVisualTextSearch}
    imageSearchBusy={imageSearchBusy}
    onDownloadOriginals={onDownloadOriginals}
    onCreateMaterialList={onCreateMaterialList}
    materialListCreationDisabled={materialListCreationDisabled}
    originalTakeoutBusy={originalTakeoutBusy}
  />;
}

function renderMusic({ resultProps, onOpenHit, focusedSubjectRef, focusRequest, onFocusSubject, onPlayTrack, onQueueTrack, onPlayTracks, musicMetadata, favoriteControls, musicQueueControls, onSelectSubjects, onDownloadOriginals, originalTakeoutBusy, onCreateMaterialList, materialListCreationDisabled, onNavigate }: LibraryPageHostProps) {
  return <MusicLibraryExperience
    {...resultProps}
    focusedSubjectRef={focusedSubjectRef}
    focusRequest={focusRequest}
    onFocusSubject={onFocusSubject}
    onPlayTrack={onPlayTrack ?? (() => undefined)}
    onQueueTrack={onQueueTrack ?? (() => undefined)}
    {...(onPlayTracks ? { onPlayTracks } : {})}
    {...(musicMetadata ? { metadata: musicMetadata } : {})}
    favoriteControls={favoriteControls}
    onOpenHit={onOpenHit}
    queueControls={musicQueueControls}
    onSelectSubjects={onSelectSubjects}
    onCreateMaterialList={onCreateMaterialList}
    materialListCreationDisabled={materialListCreationDisabled}
    onNavigate={onNavigate}
    onDownloadOriginals={onDownloadOriginals}
    originalTakeoutBusy={originalTakeoutBusy}
  />;
}

function renderVideos({ resultProps, onOpenHit, musicQueueControls, focusedSubjectRef, focusRequest, onFocusSubject }: LibraryPageHostProps) {
  return <VideoLibraryExperience
    t={resultProps.t}
    workspaceID={resultProps.workspaceID}
    hits={resultProps.hits}
    focusedSubjectRef={focusedSubjectRef}
    focusRequest={focusRequest}
    onFocusSubject={onFocusSubject}
    onOpenHit={onOpenHit}
    queueControls={musicQueueControls}
  />;
}

function renderLibraryThumbnail(hit: SearchHit, resultProps: LibraryResultProps): ReactNode {
    const { command, locale, workspaceID, t } = resultProps;
    const name = hit.name || hit.path?.split(/[\\/]/).at(-1) || "";
    if (hit.entry_type !== "REGULAR_FILE" || !hit.entry_id || !hit.subject_ref || !hit.content_id) {
      return <span className="photo-exhibition__unavailable">{t("Preview unavailable")}</span>;
    }
    return <PhotoThumbnail
      command={command}
      locale={locale}
      workspaceId={workspaceID}
      entryId={hit.entry_id}
      subjectRef={hit.subject_ref}
      contentId={hit.content_id}
      name={name}
      logicalSize={hit.logical_size}
    />;
}

function renderExhibition({ resultProps, onOpenHit, focusedSubjectRef, onFocusSubject, onShowSelectionActions, onReturnToWall, returnLabel, onOpenPhotoPreview }: LibraryPageHostProps) {
  const { hits, t, selectedRef, selectionRefs, selectionCount, onToggleSelection } = resultProps;
  const renderThumbnail = (hit: SearchHit): ReactNode => renderLibraryThumbnail(hit, resultProps);
  const props: ExhibitionProps = {
    hits,
    totalCount: hits.length,
    selectedRef,
    selectionRefs,
    selectionCount,
    focusedSubjectRef,
    t,
    renderThumbnail,
    onToggleSelection,
    onOpenHit,
    onOpenPhotoPreview: onOpenPhotoPreview ?? (() => undefined),
    onShowSelectionActions,
    onFocusSubject: onFocusSubject ?? (() => undefined),
    onReturnToWall: onReturnToWall ?? (() => undefined),
    returnLabel: returnLabel ?? resultProps.t("Return to photo wall"),
  };
  return <PhotoExhibition {...props} />;
}

function renderOverview({ resultProps, enabledPageIds, onOpenHit, onNavigate, musicMetadata, musicQueueControls, onPlayTrack, onQueueTrack, onPlayTracks, favoriteControls, onSelectSubjects }: LibraryPageHostProps) {
  const groups = enabledLibraryPageGroups(enabledPageIds ?? allLibraryPageIds);
  const destination = (mediaClass: "image" | "audio" | "video") => {
    const group = groups.find((candidate) => candidate.root.navigationKind !== "layout" && candidate.root.mediaClass === mediaClass);
    return group?.presentations.find((page) => page.id === group.root.id)?.mode ?? group?.presentations[0]?.mode;
  };
  return <OverviewExperience
    hits={resultProps.hits}
    t={resultProps.t}
    workspaceID={resultProps.workspaceID}
    locale={resultProps.locale}
    selectedRef={resultProps.selectedRef}
    selectionRefs={resultProps.selectionRefs}
    tagsBySubject={resultProps.tagsBySubject}
    metadata={musicMetadata}
    favoriteControls={favoriteControls}
    queueControls={musicQueueControls}
    photoDestination={destination("image")}
    musicDestination={destination("audio")}
    videoDestination={destination("video")}
    renderThumbnail={(hit) => renderLibraryThumbnail(hit, resultProps)}
    onToggleSelection={resultProps.onToggleSelection}
    onSelectSubjects={onSelectSubjects}
    onOpenHit={onOpenHit}
    onNavigate={onNavigate ?? (() => undefined)}
    onPlayTrack={onPlayTrack}
    onQueueTrack={onQueueTrack}
    onPlayTracks={onPlayTracks}
  />;
}

const rendererEntries: ReadonlyArray<readonly [LibraryPageId, PageRenderer]> = [
  ["cairn:photos", renderPhotos],
  ["cairn:music", renderMusic],
  ["cairn:videos", renderVideos],
  ["cairn:exhibition", renderExhibition],
  ["cairn:overview", renderOverview],
];
validateLibraryRendererIDs(libraryPages, rendererEntries.map(([id]) => id));
const renderers: ReadonlyMap<LibraryPageId, PageRenderer> = new Map(rendererEntries);

class PageRenderBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) {}
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function LibraryPageHost(props: LibraryPageHostProps) {
  const { mode, resultProps, onFallback } = props;
  const page = libraryPageForMode(mode);
  const enabled = props.enabledPageIds ?? allLibraryPageIds;
  const registeredButUnavailable = Boolean(page && !enabled.has(page.id));
  const pageRenderer = page && enabled.has(page.id) ? renderers.get(page.id) : undefined;
  const unknownPage = mode.startsWith("page:") && (!page || !pageRenderer || registeredButUnavailable);
  const lastFallbackMode = useRef<ViewMode | "">("");
  const [photoPreviewHit, setPhotoPreviewHit] = useState<SearchHit>();
  const photoPreviewOpener = useRef<HTMLElement | null>(null);
  const photoPreviewDialog = useRef<HTMLElement | null>(null);
  const photoPreviewTitle = useRef<HTMLHeadingElement | null>(null);
  const closePhotoPreview = (restoreFocus = true) => {
    setPhotoPreviewHit(undefined);
    if (restoreFocus) requestAnimationFrame(() => { if (photoPreviewOpener.current?.isConnected) photoPreviewOpener.current.focus(); });
  };
  function showPreviewBatchActions() {
    closePhotoPreview(false);
    requestAnimationFrame(() => props.onShowSelectionActions?.());
  }
  const photoPreviewIndex = photoPreviewHit?.subject_ref
    ? resultProps.hits.findIndex((hit) => hit.subject_ref === photoPreviewHit.subject_ref)
    : -1;
  const photoPreviewSelected = Boolean(photoPreviewHit?.subject_ref && resultProps.selectionRefs.includes(photoPreviewHit.subject_ref));
  useEffect(() => {
    if (page?.mediaClass !== "image" || (photoPreviewHit && !resultProps.hits.some((hit) => hit.subject_ref === photoPreviewHit.subject_ref))) {
      setPhotoPreviewHit(undefined);
    }
  }, [mode, page?.mediaClass, photoPreviewHit, resultProps.hits]);
  useEffect(() => {
    if (!photoPreviewHit) return undefined;
    photoPreviewTitle.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      const dialog = photoPreviewDialog.current;
      if (!dialog) return;
      const nestedViewer = document.querySelector<HTMLElement>(".cairn-image-viewer");
      if (event.key === "Escape") {
        if (nestedViewer?.contains(document.activeElement)) return;
        event.preventDefault(); event.stopPropagation(); closePhotoPreview(); return;
      }
      if (event.key !== "Tab" || nestedViewer?.contains(document.activeElement)) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((node) => node.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && (index <= 0 || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (index === -1 || index === focusable.length - 1 || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [photoPreviewHit]);
  useEffect(() => {
    if (!unknownPage) { lastFallbackMode.current = ""; return; }
    if (lastFallbackMode.current === mode) return;
    lastFallbackMode.current = mode;
    onFallback?.(mode);
  }, [mode, onFallback, unknownPage]);

  if (!page || !enabled.has(page.id) || !pageRenderer) return <ResultList {...resultProps} />;
  const fallback = <div className="photo-exhibition__recovery" role="status">
    <p>{resultProps.t("This page could not be displayed. Your shared content and selection remain available in the standard results list.")}</p>
    <button type="button" onClick={props.onReturnToWall}>{props.returnLabel ?? resultProps.t("Return to photo wall")}</button>
    <ResultList {...resultProps} />
  </div>;
  const pageProps: LibraryPageHostProps = { ...props, onOpenPhotoPreview: (hit, trigger) => { photoPreviewOpener.current = trigger; setPhotoPreviewHit(hit); } };
  const contentSpaceTarget = page.id === "cairn:overview" ? undefined : page.mediaClass === "image" ? "photos" : page.mediaClass === "audio" ? "music" : page.mediaClass === "video" ? "videos" : undefined;
  const renderedPage = <PageRenderBoundary key={page.id} fallback={fallback}>{pageRenderer(pageProps)}</PageRenderBoundary>;
  return <>
    {contentSpaceTarget ? <div data-content-space-target={contentSpaceTarget} tabIndex={-1}>{renderedPage}</div> : renderedPage}
    {photoPreviewHit && createPortal(<div className="photo-viewer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePhotoPreview(); }}>
      <section ref={photoPreviewDialog} className="photo-viewer photo-exhibition__host-dialog" role="dialog" aria-modal="true" aria-labelledby="exhibition-photo-inspector-title">
        <header className="photo-viewer__header">
          <div className="photo-viewer__identity"><h2 id="exhibition-photo-inspector-title" ref={photoPreviewTitle} tabIndex={-1}>{photoPreviewHit.name || resultProps.t("Untitled subject")}</h2><span>{resultProps.t("Exact image inspection is limited to 8 MiB.")}</span></div>
          <div className="photo-viewer__actions">
            <span className="photo-viewer__selection-count" role="status">{resultProps.t("{{count}} selected items", { count: resultProps.selectionCount ?? resultProps.selectionRefs.length })}</span>
            <button type="button" aria-pressed={photoPreviewSelected} aria-label={resultProps.t(photoPreviewSelected ? "Deselect {{name}}" : "Select {{name}}", { name: photoPreviewHit.name || resultProps.t("Untitled subject") })} disabled={photoPreviewIndex < 0 || !photoPreviewHit.subject_ref} onClick={() => photoPreviewIndex >= 0 && resultProps.onToggleSelection(photoPreviewIndex)}>{resultProps.t(photoPreviewSelected ? "Selected" : "Select")}</button>
            {props.onShowSelectionActions && resultProps.selectionRefs.length > 0 && <button type="button" onClick={showPreviewBatchActions}>{resultProps.t("Show batch actions")}</button>}
            <button type="button" onClick={() => { closePhotoPreview(false); props.onOpenHit(photoPreviewHit); }}>{resultProps.t("Details")}</button>
            {photoPreviewHit.entry_type === "REGULAR_FILE" && photoPreviewHit.entry_id && photoPreviewHit.content_id && <button type="button" onClick={() => downloadOriginal(resultProps.workspaceID ?? "", photoPreviewHit.entry_id!, photoPreviewHit.name || "download.bin")}><Download size={16} />{resultProps.t("Download original")}</button>}
            <button type="button" aria-label={resultProps.t("Close preview")} onClick={() => closePhotoPreview()}><X size={18} /></button>
          </div>
        </header>
        <div className="photo-viewer__body is-fit">
          <ContentPreview variant="inspector" autoOpen command={resultProps.command} locale={resultProps.locale} workspaceId={resultProps.workspaceID} entryId={photoPreviewHit.entry_id} subjectRef={photoPreviewHit.subject_ref} contentId={photoPreviewHit.content_id} name={photoPreviewHit.name || resultProps.t("Untitled subject")} logicalSize={photoPreviewHit.logical_size} />
        </div>
      </section>
    </div>, document.body)}
  </>;
}
