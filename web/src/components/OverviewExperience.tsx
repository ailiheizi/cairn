import { ArrowRight, ArrowUpRight, Download, EyeOff, Film, File, GripVertical, LibraryBig, Pause, Pencil, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useWorkspaceBrowseValue } from "../app/ClientBrowseSession";
import type { AudioTrack } from "../lib/audioPlayback";
import { formatBytes, formatFacetValue, mediaClassFromSuffix } from "../lib/format";
import { playableMusicTrack, type MusicMetadataState } from "../lib/musicMetadata";
import { projectOverviewSections } from "../lib/overviewComposition";
import type { LibraryPageMode, SearchHit } from "../lib/types";
import type { Locale, Translator } from "../i18n";
import type { FavoriteControls } from "../lib/favorites";
import type { MusicQueueControls } from "../lib/musicQueueControls";
import { matchesCurrentPlayback } from "./music/musicHelpers";
import { PHOTO_ORIGINAL_LIMIT, photoCandidateMime } from "../lib/photoRendition";
import { VIDEO_POSTER_SESSION_KEY, videoPosterIdentity, type VideoPosterSnapshot } from "../lib/videoPoster";
import { OverviewHomeEditor } from "./OverviewHomeEditor";
import { downloadOriginal } from "../lib/contentDownload";
import {
  cloneOverviewPreferences,
  DEFAULT_OVERVIEW_HEADING,
  DEFAULT_OVERVIEW_PREFERENCES,
  MAX_OVERVIEW_PHOTO_SHARE,
  MIN_OVERVIEW_PHOTO_SHARE,
  readOverviewPreferences,
  normalizeOverviewPreferences,
  writeOverviewPreferences,
  type OverviewBlockID,
  type OverviewPreferences,
} from "../lib/overviewPreferences";
import { pickOverviewSpotlight, overviewHitIdentity, overviewScopeKey } from "../lib/overviewSpotlight";
import "./OverviewExperience.css";

export type OverviewExperienceProps = {
  hits: SearchHit[];
  t: Translator;
  workspaceID: string;
  locale?: Locale;
  selectedRef: string;
  selectionRefs: string[];
  tagsBySubject: Map<string, string[]>;
  metadata?: MusicMetadataState;
  favoriteControls?: FavoriteControls;
  photoDestination?: LibraryPageMode;
  musicDestination?: LibraryPageMode;
  videoDestination?: LibraryPageMode;
  renderThumbnail: (hit: SearchHit) => ReactNode;
  onToggleSelection: (index: number) => void;
  onSelectSubjects?: (subjects: SearchHit[], mode: "add" | "remove") => void;
  onOpenHit: (hit: SearchHit) => void;
  onNavigate: (mode: "content" | LibraryPageMode, focusHit?: SearchHit) => void;
  onPlayTrack?: (track: AudioTrack) => void;
  onQueueTrack?: (track: AudioTrack) => void;
  onPlayTracks?: (tracks: AudioTrack[]) => void;
  queueControls?: MusicQueueControls;
};

export function OverviewExperience(props: OverviewExperienceProps) {
  const { hits, t, workspaceID, metadata, photoDestination, musicDestination, videoDestination, onNavigate, onPlayTrack, queueControls } = props;
  const [savedState, setSavedState] = useState(() => readOverviewPreferences(workspaceID));
  const [draft, setDraft] = useState<OverviewPreferences>(() => cloneOverviewPreferences(savedState.preferences));
  const [editing, setEditing] = useState(false);
  const [videoPoster] = useWorkspaceBrowseValue<VideoPosterSnapshot | undefined>(VIDEO_POSTER_SESSION_KEY, undefined);
  const [savedPhotoIdentity, setSavedPhotoIdentity] = useWorkspaceBrowseValue<string | undefined>("home.photoSpotlightIdentity", undefined);
  const [savedMusicIdentity, setSavedMusicIdentity] = useWorkspaceBrowseValue<string | undefined>("home.musicSpotlightIdentity", undefined);
  const resizePointerID = useRef<number | null>(null);
  useEffect(() => {
    const next = readOverviewPreferences(workspaceID);
    setSavedState(next);
    setDraft(cloneOverviewPreferences(next.preferences));
    setEditing(false);
  }, [workspaceID]);
  const sections = projectOverviewSections(hits.filter((hit) => !(hit.entry_type === "REGULAR_FILE" && mediaClassFromSuffix(formatFacetValue(hit)) === "video")));
  const photoHits = hits.filter((hit) => {
    const name = hit.name || hit.path?.split(/[\\/]/).at(-1) || "";
    return hit.entry_type === "REGULAR_FILE"
      && mediaClassFromSuffix(formatFacetValue(hit)) === "image"
      && photoCandidateMime(name) !== undefined
      && Number.isSafeInteger(hit.logical_size)
      && (hit.logical_size ?? 0) > 0
      && (hit.logical_size ?? Number.POSITIVE_INFINITY) <= PHOTO_ORIGINAL_LIMIT;
  });
  const favoritePhotoHits = props.favoriteControls?.status === "ready"
    ? photoHits.filter((hit) => Boolean(hit.subject_ref && props.favoriteControls?.isFavorite(hit.subject_ref)))
    : [];
  const photoPool = favoritePhotoHits.length > 0 ? favoritePhotoHits : photoHits;
  const audioHits = hits.filter((hit) => hit.entry_type === "REGULAR_FILE" && mediaClassFromSuffix(formatFacetValue(hit)) === "audio");
  const videoHits = hits.filter((hit) => hit.entry_type === "REGULAR_FILE" && mediaClassFromSuffix(formatFacetValue(hit)) === "video");
  const homeVideo = videoHits[0];
  const matchingVideoPoster = homeVideo && videoPoster?.identity === videoPosterIdentity(workspaceID, homeVideo) ? videoPoster : undefined;
  const fileHits = hits.filter((hit) => hit.entry_type === "REGULAR_FILE" && !["image", "audio", "video"].includes(mediaClassFromSuffix(formatFacetValue(hit)) ?? "")).slice(0, 3);
  const photoKey = overviewScopeKey(workspaceID, photoPool);
  const randomPhotoIdentity = useMemo(() => pickOverviewSpotlight(photoPool.map((hit) => overviewHitIdentity(workspaceID, hit)), photoKey), [photoKey]);
  const photoIdentity = savedPhotoIdentity && photoPool.some((hit) => overviewHitIdentity(workspaceID, hit) === savedPhotoIdentity) ? savedPhotoIdentity : randomPhotoIdentity;
  useEffect(() => { if (photoIdentity && photoIdentity !== savedPhotoIdentity) setSavedPhotoIdentity(photoIdentity); }, [photoIdentity, savedPhotoIdentity, setSavedPhotoIdentity]);
  const photo = photoIdentity ? photoPool.find((hit) => overviewHitIdentity(workspaceID, hit) === photoIdentity) : undefined;
  const currentPlayback = queueControls?.currentPlayback;
  const currentScopedTrack = currentPlayback
    ? audioHits.find((hit) => matchesCurrentPlayback(hit, currentPlayback, workspaceID))
    : undefined;
  const playableAudio = audioHits.flatMap((hit) => {
    const facts = hit.subject_ref ? metadata?.records.get(hit.subject_ref) : undefined;
    const track = playableMusicTrack(hit, workspaceID, facts);
    return track ? [{ hit, track, facts, identity: overviewHitIdentity(workspaceID, hit) }] : [];
  });
  const playableAudioKey = overviewScopeKey(workspaceID, playableAudio.map((item) => item.hit));
  const randomAudioIdentity = useMemo(() => pickOverviewSpotlight(playableAudio.map((item) => item.identity), playableAudioKey), [playableAudioKey]);
  const playingAudioIdentity = currentScopedTrack ? overviewHitIdentity(workspaceID, currentScopedTrack) : undefined;
  const selectedAudioIdentity = playingAudioIdentity && playableAudio.some((item) => item.identity === playingAudioIdentity)
    ? playingAudioIdentity
    : savedMusicIdentity && playableAudio.some((item) => item.identity === savedMusicIdentity) ? savedMusicIdentity : randomAudioIdentity;
  useEffect(() => { if (selectedAudioIdentity && selectedAudioIdentity !== savedMusicIdentity) setSavedMusicIdentity(selectedAudioIdentity); }, [selectedAudioIdentity, savedMusicIdentity, setSavedMusicIdentity]);
  const musicSpotlight = selectedAudioIdentity ? playableAudio.find((item) => item.identity === selectedAudioIdentity) : undefined;

  const preferences = savedState.preferences;
  const activePreferences = editing ? draft : preferences;
  const visibleBlocks = activePreferences.blocks.filter((block) => block.visible && (block.id === "photos" || block.id === "music"));
  const videosVisible = activePreferences.blocks.find((block) => block.id === "videos")?.visible ?? false;
  const materialsVisible = activePreferences.blocks.find((block) => block.id === "materials")?.visible ?? true;
  const materials = materialsVisible ? fileHits : [];
  const hasHomeVideo = videosVisible && (videoHits.length > 0 || editing);
  const hasHomeFiles = materialsVisible && (fileHits.length > 0 || editing);
  const hiddenBlocks = activePreferences.blocks.filter((block) => !block.visible).map((block) => block.id);

  const startEditing = () => { setDraft(cloneOverviewPreferences(preferences)); setEditing(true); };
  const cancelEditing = () => { setDraft(cloneOverviewPreferences(preferences)); setEditing(false); };
  const saveEditing = () => {
    const next = normalizeOverviewPreferences(draft);
    const persistenceAvailable = writeOverviewPreferences(workspaceID, next);
    setSavedState({ preferences: next, persistenceAvailable });
    setDraft(cloneOverviewPreferences(next));
    setEditing(false);
  };
  const resetEditing = () => setDraft((current) => {
    const reset = cloneOverviewPreferences(DEFAULT_OVERVIEW_PREFERENCES);
    return {
      ...reset,
      heading: current.heading,
      blocks: reset.blocks.map((block) => ({ ...block, count: current.blocks.find((saved) => saved.id === block.id)?.count ?? block.count })),
    };
  });
  const updateBlock = (id: OverviewBlockID, update: (block: OverviewPreferences["blocks"][number]) => OverviewPreferences["blocks"][number]) => {
    setDraft((current) => ({ ...current, blocks: current.blocks.map((block) => block.id === id ? update(block) : block) }));
  };
  const moveBlock = (id: OverviewBlockID, direction: -1 | 1) => setDraft((current) => {
    if (id !== "photos" && id !== "music") return current;
    const blocks = [...current.blocks];
    const mediaSlots = blocks.flatMap((block, index) => block.id === "photos" || block.id === "music" ? [index] : []);
    const index = mediaSlots.findIndex((slot) => blocks[slot].id === id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= mediaSlots.length) return current;
    const sourceSlot = mediaSlots[index];
    const destinationSlot = mediaSlots[destination];
    [blocks[sourceSlot], blocks[destinationSlot]] = [blocks[destinationSlot], blocks[sourceSlot]];
    return { ...current, blocks };
  });
  const reorderBlocks = (from: OverviewBlockID, to: OverviewBlockID) => setDraft((current) => {
    if ((from !== "photos" && from !== "music") || (to !== "photos" && to !== "music") || from === to) return current;
    const blocks = [...current.blocks];
    const mediaSlots = blocks.flatMap((block, index) => block.id === "photos" || block.id === "music" ? [index] : []);
    const sourceSlot = mediaSlots.find((slot) => blocks[slot].id === from);
    const destinationSlot = mediaSlots.find((slot) => blocks[slot].id === to);
    if (sourceSlot == null || destinationSlot == null) return current;
    [blocks[sourceSlot], blocks[destinationSlot]] = [blocks[destinationSlot], blocks[sourceSlot]];
    return { ...current, blocks };
  });
  const clampPhotoShare = (value: number) => Math.max(MIN_OVERVIEW_PHOTO_SHARE, Math.min(MAX_OVERVIEW_PHOTO_SHARE, value));
  const changePhotoShare = (value: number) => setDraft((current) => ({ ...current, photoShare: clampPhotoShare(value) }));
  const updatePhotoShareFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!editing || resizePointerID.current !== event.pointerId) return;
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    const availableWidth = bounds ? bounds.width - 18 : 0;
    if (!bounds || availableWidth <= 0) return;
    const leftShare = (event.clientX - bounds.left - 9) / availableWidth;
    changePhotoShare(visibleBlocks[0]?.id === "music" ? 1 - leftShare : leftShare);
  };
  const resizeSeparatorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!editing) return;
    const displayedDirection = visibleBlocks[0]?.id === "music" ? -1 : 1;
    const steps: Record<string, number> = { ArrowLeft: -0.02 * displayedDirection, ArrowRight: 0.02 * displayedDirection, PageDown: -0.05 * displayedDirection, PageUp: 0.05 * displayedDirection };
    if (event.key === "Home") { event.preventDefault(); changePhotoShare(MIN_OVERVIEW_PHOTO_SHARE); return; }
    if (event.key === "End") { event.preventDefault(); changePhotoShare(MAX_OVERVIEW_PHOTO_SHARE); return; }
    const step = steps[event.key];
    if (step != null) { event.preventDefault(); changePhotoShare(draft.photoShare + step); }
  };
  const hideBlock = (id: OverviewBlockID) => updateBlock(id, (block) => ({ ...block, visible: false }));
  const showBlock = (id: OverviewBlockID) => updateBlock(id, (block) => ({ ...block, visible: true }));
  const endResize = (event: PointerEvent<HTMLDivElement>) => { if (resizePointerID.current === event.pointerId) resizePointerID.current = null; };
  const dragStart = (event: DragEvent<HTMLButtonElement>, id: OverviewBlockID) => {
    event.stopPropagation();
    if (!editing) { event.preventDefault(); return; }
    event.dataTransfer.setData("text/plain", id);
    event.dataTransfer.effectAllowed = "move";
  };
  const dragOver = (event: DragEvent<HTMLDivElement>) => { if (editing) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; } };
  const dropOnBlock = (event: DragEvent<HTMLDivElement>, target: OverviewBlockID) => {
    event.preventDefault();
    event.stopPropagation();
    if (!editing) return;
    const source = event.dataTransfer.getData("text/plain");
    if ((source === "photos" || source === "music") && (target === "photos" || target === "music")) reorderBlocks(source, target);
  };
  const handleKeyMove = (event: KeyboardEvent<HTMLButtonElement>, id: OverviewBlockID) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    moveBlock(id, event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1);
  };

  const sectionName = (id: OverviewBlockID) => t(id === "photos" ? "Photos" : id === "music" ? "Music" : id === "videos" ? "Videos" : "Files on Home");
  const editTools = (id: OverviewBlockID) => editing && <div className="private-space-card-edit-tools">
    {(id === "photos" || id === "music") && <button type="button" className="private-space-edit-icon private-space-drag-handle" draggable aria-label={t("Move {{section}}. Use arrow keys to reorder.", { section: sectionName(id) })} title={t("Drag to reorder; arrow keys also work")} onDragStart={(event) => dragStart(event, id)} onKeyDown={(event) => handleKeyMove(event, id)}><GripVertical aria-hidden="true" /></button>}
    <button type="button" className="private-space-edit-icon" aria-label={t("Hide {{section}}", { section: sectionName(id) })} title={t("Hide {{section}}", { section: sectionName(id) })} onClick={() => hideBlock(id)}><EyeOff aria-hidden="true" /></button>
  </div>;

  const renderPhoto = () => <article className="private-space-photo" data-content-space-origin="photos">
    {editTools("photos")}
    <div className="private-space-photo-copy">
      <span className="private-space-kicker">{t("Photos")}</span>
      <h2>{photo?.name?.replace(/\.[^.]+$/, "").split(" — ")[0] || t("Photos")}</h2>
      <p>{t("Follow the light back to a place you remember.")}</p>
      <button type="button" className="private-space-enter" disabled={editing || !photoDestination} onClick={() => photoDestination && onNavigate(photoDestination, photo)}>
        {t("Enter Photos")}<ArrowUpRight aria-hidden="true" />
      </button>
      {!photoDestination && <small className="private-space-unavailable">{t("Photos pages are disabled.")}</small>}
    </div>
      {photo && photoDestination
      ? <button type="button" className="private-space-photo-art" data-subject-ref={photo.subject_ref} disabled={editing} aria-label={t("Enter Photos at {{name}}", { name: photo.name || t("Untitled subject") })} onClick={() => photoDestination && onNavigate(photoDestination, photo)}>{props.renderThumbnail(photo)}<span className="private-space-photo-caption">{photo.name?.trim() || t("Untitled subject")}</span></button>
      : photo ? <div className="private-space-photo-empty" role="status">{t("Photos pages are disabled.")}</div>
      : <div className="private-space-photo-empty" role="status">{t("No supported photos in this scope")}</div>}
  </article>;

  const renderMusic = () => {
    const item = musicSpotlight;
    const facts = item?.facts;
    const track = item?.track;
    const isCurrentTrack = Boolean(item && currentPlayback && matchesCurrentPlayback(item.hit, currentPlayback, workspaceID));
    const isPlaying = isCurrentTrack && currentPlayback?.status === "playing";
    const isPending = isCurrentTrack && (currentPlayback?.status === "loading" || currentPlayback?.status === "starting");
    const canToggle = isCurrentTrack && (currentPlayback?.status === "playing" || currentPlayback?.status === "paused") && Boolean(queueControls?.toggleCurrentPlayback);
    const title = facts?.title || item?.hit.name?.trim() || "";
    const byline = [facts?.artist, facts?.album].filter(Boolean).join(" · ");
    const playLabel = isPlaying ? t("Pause {{name}}", { name: title }) : currentPlayback?.status === "paused" && isCurrentTrack ? t("Resume {{name}}", { name: title }) : t("Play {{name}}", { name: title });
    return <article className="private-space-music" data-content-space-origin="music">
      {editTools("music")}
      <div className="private-space-music-top"><span className="private-space-kicker">{t("Music")}</span>
        {!editing && (musicDestination ? <button type="button" className="private-space-domain-link" aria-label={t("Enter Music")} onClick={() => onNavigate(musicDestination, item?.hit)}><ArrowUpRight aria-hidden="true" /></button> : <span className="private-space-domain-link is-disabled" aria-hidden="true"><ArrowUpRight /></span>)}
      </div>
      <button type="button" className="private-space-record-wrap" aria-label={musicDestination ? t("Enter Music") : t("Music pages are disabled.")} disabled={editing || !musicDestination} onClick={() => musicDestination && onNavigate(musicDestination, item?.hit)}>
        <span className={`private-space-record${isCurrentTrack && currentPlayback?.artworkURL ? " has-art" : ""}`} aria-hidden="true">
          {isCurrentTrack && currentPlayback?.artworkURL && <img className="private-space-record-art" src={currentPlayback.artworkURL} alt="" />}
        </span>
      </button>
      {item ? <div className="private-space-track">
        <button type="button" className="private-space-track-title" data-subject-ref={item.hit.subject_ref} disabled={editing || !musicDestination} onClick={() => musicDestination && onNavigate(musicDestination, item.hit)}><strong title={title}>{title}</strong>{byline && <span title={byline}>{byline}</span>}</button>
        <button type="button" className="private-space-play" disabled={editing || !musicDestination || !track || (!onPlayTrack && !canToggle) || isPending || (isCurrentTrack && !canToggle && (currentPlayback?.status === "playing" || currentPlayback?.status === "paused"))} aria-label={playLabel} title={playLabel} onClick={() => {
          if (canToggle) queueControls?.toggleCurrentPlayback?.();
          else if (track) onPlayTrack?.(track);
        }}>{isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
      </div> : <p className="private-space-music-empty" role="status">{sections.audio.total ? t("No supported audio in this scope") : t("No audio in this scope")}</p>}
      {!musicDestination && <small className="private-space-music-unavailable">{t("Music pages are disabled.")}</small>}
    </article>;
  };

  const renderBlock = (id: OverviewBlockID): ReactNode => id === "photos" ? renderPhoto() : id === "music" ? renderMusic() : null;

  const renderVideos = () => {
    const name = homeVideo?.name?.trim() || homeVideo?.path?.split(/[\\/]/).at(-1) || t("No videos in this scope");
    return <div className="private-space-video-entry-wrap" data-content-space-origin="videos">
      {editTools("videos")}
      <button type="button" className="private-space-video-entry" data-subject-ref={homeVideo?.subject_ref} disabled={editing || !videoDestination} aria-label={videoDestination ? t("Enter video: {{name}}", { name }) : t("Videos pages are disabled.")} title={!videoDestination ? t("Videos pages are disabled.") : name} onClick={() => videoDestination && onNavigate(videoDestination, homeVideo)}>
        {matchingVideoPoster
          ? <img className="private-space-video-poster" src={matchingVideoPoster.dataURL} alt="" />
          : <span className="private-space-video-placeholder" aria-hidden="true"><Film /></span>}
        <span className="private-space-video-caption"><span title={name}>{name}</span><ArrowUpRight className="private-space-video-entry-arrow" aria-hidden="true" /></span>
      </button>
    </div>;
  };

  return <section className="overview-experience private-space-home" aria-label={t("Private space")} data-content-space-target="home" tabIndex={-1}>
    <header className="private-space-welcome">
      <p className="private-space-overline">{t("Private space")}</p>
      <h1>{t(DEFAULT_OVERVIEW_HEADING)}</h1>
      <p>{t("Photos, music, and the things you want to find again.")}</p>
      {editing ? <OverviewHomeEditor
        hiddenBlocks={hiddenBlocks}
        t={t}
        persistenceAvailable={savedState.persistenceAvailable}
        onShowSection={showBlock}
        onReset={resetEditing}
        onSave={saveEditing}
        onCancel={cancelEditing}
      /> : <button type="button" className="private-space-edit-icon private-space-pencil" aria-label={t("Edit home layout")} title={t("Edit home layout")} onClick={startEditing}><Pencil aria-hidden="true" /></button>}
      {!editing && !savedState.persistenceAvailable && <small className="private-space-persist-warning" role="status">{t("Browser storage is unavailable. This layout may not be available after reload.")}</small>}
    </header>
    {(visibleBlocks.length > 0 || hasHomeVideo || hasHomeFiles || (editing && !visibleBlocks.length)) && <div className={`private-space-scene${visibleBlocks.length === 1 ? " has-one-card" : ""}${editing ? " is-editing" : ""}`}>
      {visibleBlocks.length > 0 && <div className="private-space-card-row" style={{ "--private-photo-share": activePreferences.photoShare } as CSSProperties}>
        {visibleBlocks.flatMap((block, index) => [
          <div className={`private-space-card-slot private-space-card-slot--${block.id}`} key={block.id} onDragOver={dragOver} onDrop={(event) => dropOnBlock(event, block.id)}>{renderBlock(block.id)}</div>,
          ...(editing && index === 0 && visibleBlocks.length === 2 ? [<div
            key="photo-share-divider"
            className="private-space-divider"
            role="separator"
            aria-label={t("Resize photo and music spaces")}
            aria-orientation="vertical"
            aria-valuemin={Math.round(MIN_OVERVIEW_PHOTO_SHARE * 100)}
            aria-valuemax={Math.round(MAX_OVERVIEW_PHOTO_SHARE * 100)}
            aria-valuenow={Math.round(activePreferences.photoShare * 100)}
            aria-valuetext={t("Photos take {{percent}} percent of the row", { percent: Math.round(activePreferences.photoShare * 100) })}
            tabIndex={0}
            onKeyDown={resizeSeparatorKeyDown}
            onPointerDown={(event) => { resizePointerID.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={updatePhotoShareFromPointer}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onLostPointerCapture={endResize}
          ><GripVertical aria-hidden="true" /></div>] : []),
        ])}
      </div>}
      {(hasHomeVideo || hasHomeFiles) && <div className="private-space-secondary-row">
        {hasHomeVideo && renderVideos()}
        {hasHomeFiles && <section className="private-space-materials" aria-label={t("Files on Home")}>
          {editTools("materials")}
          <div className="private-space-materials-heading"><h2>{t("Files on Home")}</h2></div>
          {materials.map((hit) => {
            const name = hit.name?.trim() || hit.path?.split(/[\\/]/).at(-1) || t("Untitled subject");
            const format = formatFacetValue(hit).toUpperCase() || t("Format unavailable");
            const size = Number.isSafeInteger(hit.logical_size) && (hit.logical_size ?? -1) >= 0 ? formatBytes(hit.logical_size!) : t("Size unavailable");
            const canDownload = Boolean(workspaceID && hit.entry_id && /^sha256:[a-f0-9]{64}$/.test(hit.content_id ?? ""));
            return <div className="private-space-material" key={`${hit.entry_id ?? ""}:${hit.content_id ?? ""}:${hit.logical_size ?? ""}`}>
              <button type="button" className="private-space-material-main" disabled={editing} onClick={() => props.onOpenHit(hit)}><span className="private-space-material-icon"><File aria-hidden="true" /></span><span className="private-space-material-copy"><strong title={name}>{name}</strong><small>{format} · {size}</small></span></button>
              {canDownload && <button type="button" className="private-space-material-download" aria-label={t("Download original {{name}}", { name })} title={t("Download original")} disabled={editing} onClick={() => downloadOriginal(workspaceID, hit.entry_id!, name)}><Download aria-hidden="true" /></button>}
            </div>;
          })}
          {editing && materials.length === 0 && <p className="private-space-material-empty">{t("No files in this loaded scope")}</p>}
        </section>}
      </div>}
      {editing && visibleBlocks.length === 0 && !hasHomeVideo && !hasHomeFiles && <div className="private-space-empty" role="status"><h2>{t("Your space is clear for now")}</h2><p>{t("Show a section whenever you want to see it here again.")}</p></div>}
    </div>}

    <footer className="private-space-footer">
      <button type="button" className="private-space-library" data-content-space-origin="library" onClick={() => onNavigate("content")}>
        <span className="private-space-library-symbol"><LibraryBig aria-hidden="true" /></span>
        <span><strong>{t("Library")}</strong><small>{t("All saved content and original material")}</small></span>
        <ArrowRight aria-hidden="true" />
      </button>
    </footer>
  </section>;
}
