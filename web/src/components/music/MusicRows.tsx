import { useRef, type RefObject } from "react";
import { LoaderCircle, Music2, Pause, Play, Shuffle } from "lucide-react";
import type { AudioTrack } from "../../lib/audioPlayback";
import { musicGroupKey, musicPlaybackEligibility, orderRecordedAlbumTracks, playableMusicTrack, type MusicTrackFacts } from "../../lib/musicMetadata";
import { formatBytes } from "../../lib/format";
import type { MusicQueueControls } from "../../lib/musicQueueControls";
import type { MusicLibraryProps, MusicGroup, MusicRow } from "./musicHelpers";
import { formatMusicDuration, matchesCurrentPlayback, playbackStatusText, runQueueMenuAction, shuffleTracks } from "./musicHelpers";
import { downloadOriginal } from "../../lib/contentDownload";
import { FavoriteButton } from "../FavoriteButton";
import { uniqueSubjectHits } from "../../lib/subjectHits";

type Props = MusicLibraryProps;
type ResultListProps = Pick<Props, "onRowClick">;

export function GroupList({ groups, listRef, registerOpenButton, countLabel, t, onSelect, onPlay, workspaceID, queueControls, onSelectSubjects, onDownloadOriginals, originalTakeoutBusy, selectionRefs, showArtist = false }: { groups: MusicGroup[]; listRef: RefObject<HTMLDivElement | null>; registerOpenButton: Map<string, HTMLButtonElement>; countLabel: string; t: Props["t"]; onSelect: (key: string, label: string, artist?: string) => void; onPlay?: (tracks: AudioTrack[]) => void; workspaceID?: string; queueControls?: MusicQueueControls; onSelectSubjects?: Props["onSelectSubjects"]; onDownloadOriginals?: Props["onDownloadOriginals"]; originalTakeoutBusy?: boolean; selectionRefs: ReadonlySet<string>; showArtist?: boolean }) {
  return <div ref={listRef} className="music-group-list" tabIndex={-1}>{groups.length ? groups.map((group) => {
    const orderedRows = showArtist ? orderRecordedAlbumTracks(group.rows) : group.rows;
    const playable = orderedRows.flatMap((row) => { const track = playableMusicTrack(row.hit, workspaceID, row.facts); return track ? [track] : []; });
    const uniqueGroupHits = uniqueSubjectHits(group.rows.map((row) => row.hit));
    const selectedGroupHits = uniqueGroupHits.filter((hit) => hit.subject_ref && selectionRefs.has(hit.subject_ref));
    const skippedCount = orderedRows.length - playable.length;
    return <article key={group.key} className="music-group-card" data-browse-key={group.key}>
      <button ref={(element) => { if (element) registerOpenButton.set(group.key, element); else registerOpenButton.delete(group.key); }} type="button" className="music-group-card__open" onClick={() => onSelect(group.key, group.label, group.artist)}><Music2 aria-hidden="true" /><span><strong>{group.label}</strong>{showArtist && <small>{group.artist || t("Unknown artist")}</small>}</span><small>{group.rows.length} {countLabel}</small></button>
      <div className="music-group-card__actions" aria-label={t("Actions for {{name}}", { name: group.label })}>
        <button type="button" disabled={!playable.length || !onPlay} aria-label={t("Play {{name}}", { name: group.label })} title={skippedCount ? t("{{count}} unavailable track(s) omitted", { count: skippedCount }) : undefined} onClick={() => onPlay?.(playable)}><Play aria-hidden="true" />{t("Play")}</button>
        <button type="button" disabled={!playable.length || !onPlay} aria-label={t("Shuffle {{name}}", { name: group.label })} title={skippedCount ? t("{{count}} unavailable track(s) omitted", { count: skippedCount }) : undefined} onClick={() => onPlay?.(shuffleTracks(playable))}><Shuffle aria-hidden="true" />{t("Shuffle")}</button>
        <button type="button" disabled={!playable.length || !queueControls} aria-label={t("Add {{name}} to queue", { name: group.label })} title={skippedCount ? t("{{count}} unavailable track(s) omitted", { count: skippedCount }) : undefined} onClick={() => queueControls?.addTracks(playable)}>{t("Add")}</button>
        <button type="button" disabled={!playable.length || !queueControls?.addNextTracks} aria-label={t("Play {{name}} next", { name: group.label })} title={skippedCount ? t("{{count}} unavailable track(s) omitted", { count: skippedCount }) : undefined} onClick={() => queueControls?.addNextTracks?.(playable)}>{t("Play next")}</button>
      </div>
      {(onSelectSubjects || onDownloadOriginals) && <details className="music-group-card__more"><summary>{t("More")}</summary><div>
        {onSelectSubjects && <><button type="button" disabled={!uniqueGroupHits.length} onClick={(event) => runQueueMenuAction(event.currentTarget.closest("details"), () => onSelectSubjects(uniqueGroupHits, "add"))}>{t("Select group ({{count}})", { count: uniqueGroupHits.length })}</button><button type="button" disabled={!uniqueGroupHits.length} onClick={(event) => runQueueMenuAction(event.currentTarget.closest("details"), () => onSelectSubjects(uniqueGroupHits, "invert"))}>{t("Invert group selection ({{count}})", { count: uniqueGroupHits.length })}</button><button type="button" disabled={!selectedGroupHits.length} onClick={(event) => runQueueMenuAction(event.currentTarget.closest("details"), () => onSelectSubjects(selectedGroupHits, "remove"))}>{t("Clear group selection ({{count}})", { count: selectedGroupHits.length })}</button></>}
        {onDownloadOriginals && <button type="button" disabled={!uniqueGroupHits.length || originalTakeoutBusy} onClick={(event) => runQueueMenuAction(event.currentTarget.closest("details"), () => onDownloadOriginals(uniqueGroupHits))}>{t("Download group originals ZIP ({{count}})", { count: uniqueGroupHits.length })}</button>}
      </div></details>}
      {skippedCount > 0 && <small className="music-group-card__notice">{t("{{count}} unavailable track(s) omitted from playback actions", { count: skippedCount })}</small>}
    </article>;
  }) : <p className="music-empty">{t("No tracks match this search")}</p>}</div>;
}

export function TrackRow({ row, props, facts, open, tabIndex, onEnterGroup, onToggleSelection, onRangeSelect }: { row: MusicRow; props: Props; facts?: MusicTrackFacts; open: (row: MusicRow, event: Parameters<ResultListProps["onRowClick"]>[1]) => void; tabIndex: number; onEnterGroup: (mode: "artists" | "albums", key: string, label?: string, artist?: string) => void; onToggleSelection: (index: number) => void; onRangeSelect: () => void }) {
  const { hit, index } = row;
  const queueMenuRef = useRef<HTMLDetailsElement | null>(null);
  const { t, workspaceID, tagsBySubject, onPlayTrack, onQueueTrack } = props;
  const name = hit.name || t("Untitled subject");
  const eligibility = musicPlaybackEligibility(hit, workspaceID);
  const playable = eligibility.playable;
  const currentPlayback = props.queueControls?.currentPlayback;
  const isCurrentTrack = Boolean(currentPlayback && matchesCurrentPlayback(hit, currentPlayback, workspaceID));
  const currentStatus = isCurrentTrack ? currentPlayback?.status : undefined;
  const playbackPending = currentStatus === "loading" || currentStatus === "starting";
  const playbackCanToggle = (currentStatus === "playing" || currentStatus === "paused") && Boolean(props.queueControls?.toggleCurrentPlayback);
  const tags = hit.subject_ref ? tagsBySubject.get(hit.subject_ref) ?? [] : [];
  const fmt = name.includes(".") ? name.split(".").pop()?.toUpperCase() : "";
  const factLine = [facts?.track ? `#${facts.track}` : undefined].filter(Boolean).join(" · ");
  const displayTitle = facts?.title || name;
  const recordedDuration = Number.isSafeInteger(facts?.durationMS) && (facts?.durationMS ?? 0) > 0 ? t("Recorded duration: {{duration}}", { duration: formatMusicDuration(facts!.durationMS!, props.locale) }) : t("Duration unknown");
  const rowDetails = [facts?.title && facts.title !== name ? name : undefined, factLine, recordedDuration, Number.isSafeInteger(hit.logical_size) && hit.logical_size! >= 0 ? formatBytes(hit.logical_size!) : t("No logical size"), fmt, ...tags].filter(Boolean).join(" · ");
  return <article className={`music-track result-row is-file ${props.selectedRef === hit.subject_ref ? "selected" : ""} ${hit.subject_ref && props.selectionRefs.includes(hit.subject_ref) ? "multi-selected" : ""} ${isCurrentTrack ? "is-current-track" : ""}`} role="group" data-result-index={index} data-subject-ref={hit.subject_ref ?? ""} aria-label={name} aria-current={currentStatus === "playing" ? "true" : undefined}>
    <button type="button" className="result-select" role="checkbox" aria-checked={Boolean(hit.subject_ref && props.selectionRefs.includes(hit.subject_ref))} disabled={!hit.subject_ref} aria-label={t(props.selectionRefs.includes(hit.subject_ref || "") ? "Deselect {{name}}" : "Select {{name}}", { name })} onClick={(event) => { event.stopPropagation(); if (event.shiftKey) onRangeSelect(); else onToggleSelection(index); }} onKeyDown={(event) => { if (event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); event.stopPropagation(); if (event.repeat) return; if (event.shiftKey && event.key === " ") onRangeSelect(); else onToggleSelection(index); }}>{props.selectionRefs.includes(hit.subject_ref || "") ? "✓" : ""}</button>
    <button className="music-track-main result-open-copy" type="button" title={facts?.title && facts.title !== name ? `${displayTitle} — ${name}` : displayTitle} tabIndex={tabIndex} onClick={(event) => open(row, event)}><Music2 /><span><strong>{displayTitle}</strong><small>{rowDetails}{!playable && <span className="music-playback-reason">{t(PLAYBACK_REASON_MESSAGES[eligibility.reason])}</span>}{currentStatus && <span className={`music-track-current-state is-${currentStatus}`}> · {playbackStatusText(currentStatus, t)}</span>}</small></span></button>
    {(facts?.artist || facts?.album) && <div className="music-track-fact-links">{facts.artist && <button type="button" title={t("Browse artist {{name}}", { name: facts.artist })} onClick={() => onEnterGroup("artists", musicGroupKey("artist", facts), facts.artist)}>{facts.artist}</button>}{facts.album && <button type="button" title={t("Browse album {{name}}", { name: facts.album })} onClick={() => onEnterGroup("albums", musicGroupKey("album", facts), facts.album, facts.artist)}>{facts.album}</button>}</div>}
    <FavoriteButton hit={hit} controls={props.favoriteControls} t={t} />
    <details ref={queueMenuRef} className="music-track-queue-menu"><summary aria-label={t("Queue actions for {{name}}", { name })} title={t("Queue actions")}>⋯</summary><div><button type="button" disabled={!playable} aria-label={t("Add {{name}} to queue", { name })} onClick={() => { const track = playableMusicTrack(hit, workspaceID, facts); if (track) runQueueMenuAction(queueMenuRef.current, () => onQueueTrack(track)); }}>{t("Add to queue")}</button><PlayNextButton hit={hit} workspaceID={workspaceID} facts={facts} queueControls={props.queueControls} t={t} name={name} onPlayNext={(track) => runQueueMenuAction(queueMenuRef.current, () => props.queueControls?.addNext?.(track))} />{hit.entry_type === "REGULAR_FILE" && hit.entry_id && hit.content_id && workspaceID && <button type="button" aria-label={t("Download {{name}}", { name })} onClick={() => runQueueMenuAction(queueMenuRef.current, () => downloadOriginal(workspaceID, hit.entry_id!, name))}>{t("Download original")}</button>}</div></details>
    <button type="button" className={`music-track-play${isCurrentTrack ? " is-current" : ""}`} disabled={!playable || playbackPending || ((currentStatus === "playing" || currentStatus === "paused") && !playbackCanToggle)} aria-label={currentStatus === "playing" ? t("Pause {{name}}", { name }) : currentStatus === "paused" ? t("Resume {{name}}", { name }) : playbackPending ? playbackStatusText(currentStatus, t) : t("Play {{name}}", { name })} title={currentStatus ? playbackStatusText(currentStatus, t) : playable ? t("Play original; native playback may still be unavailable") : t(PLAYBACK_REASON_MESSAGES[eligibility.reason])} onClick={() => { if (playbackCanToggle) { props.queueControls?.toggleCurrentPlayback?.(); return; } const track = playableMusicTrack(hit, workspaceID, facts); if (track) onPlayTrack(track); }}>
      {currentStatus === "playing" ? <Pause aria-hidden="true" /> : playbackPending ? <LoaderCircle className="music-track-play__loading" aria-hidden="true" /> : <Play aria-hidden="true" />}
    </button>
  </article>;
}

function PlayNextButton({ hit, workspaceID, facts, queueControls, t, name, onPlayNext }: { hit: Props["hits"][number]; workspaceID?: string; facts?: MusicTrackFacts; queueControls?: MusicQueueControls; t: Props["t"]; name: string; onPlayNext: (track: AudioTrack) => void }) {
  const track = playableMusicTrack(hit, workspaceID, facts);
  // Keep the host-owned control absent until its callback exists; it must never
  // emulate insertion by autoplaying or creating a page-local queue.
  const addNext = queueControls?.addNext;
  return addNext ? <button type="button" disabled={!track} aria-label={t("Play {{name}} next", { name })} onClick={() => { if (track) onPlayNext(track); }}>{t("Play next")}</button> : null;
}

const PLAYBACK_REASON_MESSAGES = {
  "unsupported-format": "This audio format is not supported for browser playback. Open Details to download the original.",
  "identity-unavailable": "The original has no verified identity information.",
  "size-unavailable": "The original size is unknown, so playback eligibility cannot be confirmed.",
  "size-limit": "The original is larger than the 32 MiB playback limit.",
  "workspace-unavailable": "The current workspace is unavailable for playback.",
} as const;
