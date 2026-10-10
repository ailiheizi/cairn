import { useMemo, useState, type ComponentProps } from "react";
import { Music2, Play, Search } from "lucide-react";
import { ResultList } from "./ResultList";
import type { AudioTrack } from "../lib/audioPlayback";
import { formatBytes, mediaClassFromSuffix } from "../lib/format";
import { musicGroupKey, orderRecordedAlbumTracks, playableMusicTrack, type MusicMetadataState, type MusicTrackFacts } from "../lib/musicMetadata";
import type { FavoriteControls } from "../lib/favorites";
import type { MusicQueueControls } from "../lib/musicQueueControls";
import { FavoriteButton } from "./FavoriteButton";
import "./MusicLibraryExperience.css";

type ResultListProps = ComponentProps<typeof ResultList>;
type Props = Pick<ResultListProps, "hits" | "libraryListRef" | "selectionCount" | "rovingRow" | "selectedRef" | "selectionRefs" | "identityCounts" | "tagsBySubject" | "viewMode" | "locale" | "t" | "command" | "workspaceID" | "onRowClick" | "onToggleSelection" | "onKeyDown"> & {
  onPlayTrack: (track: AudioTrack) => void;
  onQueueTrack: (track: AudioTrack) => void;
  onPlayTracks?: (tracks: AudioTrack[]) => void;
  metadata?: MusicMetadataState;
  favoriteControls?: FavoriteControls;
  queueControls?: MusicQueueControls;
};
type Mode = "tracks" | "artists" | "albums";
type MusicRow = { hit: Props["hits"][number]; index: number; facts?: MusicTrackFacts };

export function MusicLibraryExperience(props: Props) {
  const { hits, t, workspaceID, tagsBySubject, onPlayTrack, onQueueTrack } = props;
  const [mode, setMode] = useState<Mode>("tracks");
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string | undefined>();
  const records = props.metadata?.records ?? new Map<string, MusicTrackFacts>();
  const rows = useMemo(() => hits.flatMap((hit, index) => {
    if (hit.entry_type !== "REGULAR_FILE" || mediaClassFromSuffix((hit.name || "").split(".").pop() || "") !== "audio") return [];
    const facts = hit.subject_ref ? records.get(hit.subject_ref) : undefined;
    const needle = query.trim().toLocaleLowerCase();
    const haystack = [hit.name, facts?.title, facts?.artist, facts?.album, ...((hit.subject_ref && tagsBySubject.get(hit.subject_ref)) || [])].filter(Boolean).join(" ").toLocaleLowerCase();
    if (needle && !haystack.includes(needle)) return [];
    if (selectedGroup && musicGroupKey(mode === "artists" ? "artist" : "album", facts) !== selectedGroup) return [];
    return [{ hit, index, facts }];
  }), [hits, mode, query, records, selectedGroup, tagsBySubject]);
  const artistGroups = useMemo(() => buildGroups(rows, (row) => musicGroupKey("artist", row.facts), (row) => row.facts?.artist || t("Unknown artist")), [rows, t]);
  const albumGroups = useMemo(() => buildGroups(rows, (row) => musicGroupKey("album", row.facts), (row) => row.facts?.album || t("Unknown album")), [rows, t]);
  const trackRows = useMemo(() => mode === "albums" && selectedGroup && selectedGroup !== musicGroupKey("album") ? orderRecordedAlbumTracks(rows) : rows, [mode, rows, selectedGroup]);
  const displayedPlayable = trackRows.flatMap((row) => { const track = playableMusicTrack(row.hit, workspaceID); return track ? [track] : []; });
  const selectedRefs = useMemo(() => new Set(props.selectionRefs), [props.selectionRefs]);
  const selectedDisplayedRows = useMemo(() => trackRows.filter((row) => row.hit.subject_ref && selectedRefs.has(row.hit.subject_ref)), [trackRows, selectedRefs]);
  const selectedPlayable = selectedDisplayedRows.flatMap((row) => { const track = playableMusicTrack(row.hit, workspaceID); return track ? [track] : []; });
  const displayedRefs = useMemo(() => new Set(trackRows.flatMap((row) => row.hit.subject_ref ? [row.hit.subject_ref] : [])), [trackRows]);
  const selectionOutsideDisplayedCount = props.selectionRefs.filter((subjectRef) => !displayedRefs.has(subjectRef)).length;
  const showingTrackRows = mode === "tracks" || Boolean(selectedGroup);
  const open = (row: MusicRow, event: Parameters<ResultListProps["onRowClick"]>[1]) => props.onRowClick(row.index, event);
  const handleListKeyDown: Props["onKeyDown"] = (event) => { if ((event.target as HTMLElement | null)?.closest(".result-open-copy")) props.onKeyDown(event); };

  return <section className="music-library" aria-label={t("Music library")}>
    <header className="music-library-heading"><Music2 /><div><h1>{t("Music")}</h1><p>{t("Play and organize original audio files from your library.")}</p></div><b>{rows.length}</b></header>
    {props.metadata?.reload && <button type="button" className="music-refresh-facts" disabled={props.metadata.status === "loading"} onClick={props.metadata.reload}>{t("Refresh music facts")}</button>}
    <nav className="music-browse-modes" aria-label={t("Browse music")}>
      {(["tracks", "artists", "albums"] as const).map((nextMode) => <button key={nextMode} type="button" aria-pressed={mode === nextMode} onClick={() => { setMode(nextMode); setSelectedGroup(undefined); }}>{t(nextMode === "tracks" ? "Tracks" : nextMode === "artists" ? "Artists" : "Albums")}</button>)}
    </nav>
    <label className="music-browse-search"><Search aria-hidden="true" /><span className="visually-hidden">{t("Search music")}</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedGroup(undefined); }} placeholder={t("Search track names and recorded facts")} /></label>
    {props.metadata?.status === "loading" && <p className="music-facts-status" role="status">{t("Loading recorded audio facts")}</p>}
    {props.metadata?.status === "unavailable" && <p className="music-facts-status" role="status">{t("Audio facts unavailable; showing filenames and tags")}</p>}
    {props.metadata?.status === "ready" && rows.some((row) => !row.facts) && <p className="music-facts-status" role="status">{t("Some tracks have no recorded audio facts; their filenames remain available")}</p>}
    {selectedGroup && <button type="button" className="music-clear-group" onClick={() => setSelectedGroup(undefined)}>{t("Show all tracks")}</button>}
    {mode === "artists" && !selectedGroup ? <GroupList groups={artistGroups} countLabel={t("tracks")} t={t} onSelect={(key) => setSelectedGroup(key)} /> : mode === "albums" && !selectedGroup ? <GroupList groups={albumGroups} countLabel={t("tracks")} t={t} showArtist onSelect={(key) => setSelectedGroup(key)} /> : rows.length ? <div ref={props.libraryListRef} className="music-track-list result-list list-mode" data-roving-row={props.rovingRow} role="group" aria-label={t("Library results")} aria-description={t("Use the arrow keys to move between tiles, Space to select the focused tile, Enter to open its details, and Escape to clear the selection.")} data-selection-count={props.selectionCount} onKeyDown={handleListKeyDown}>
      {trackRows.map((row) => <TrackRow key={row.hit.subject_ref || row.hit.entry_id || row.hit.name} row={row} props={props} facts={row.facts} open={open} />)}
    </div> : <div className="music-empty"><Music2 /><h2>{query.trim() ? t("No tracks match this search") : t("No audio tracks in the loaded listing")}</h2><p>{t("Track names come from original filenames. Metadata and artwork are shown only when real facts are available.")}</p></div>}
    <div className="music-queue-actions" aria-label={t("Music queue actions")}>
      <div className="music-queue-action-buttons">
        {showingTrackRows && <>
          <button className="music-play-displayed" type="button" disabled={!displayedPlayable.length || !props.onPlayTracks} onClick={() => props.onPlayTracks?.(displayedPlayable)}>{t("Play displayed supported tracks ({{count}})", { count: displayedPlayable.length })}</button>
          <button type="button" disabled={!displayedPlayable.length || !props.queueControls} onClick={() => props.queueControls?.addTracks(displayedPlayable)}>{t("Add displayed supported tracks ({{count}})", { count: displayedPlayable.length })}</button>
          <button type="button" disabled={!selectedPlayable.length || !props.queueControls} onClick={() => props.queueControls?.addTracks(selectedPlayable)}>{t("Add selected displayed supported tracks ({{count}})", { count: selectedPlayable.length })}</button>
          <button type="button" disabled={!selectedPlayable.length || !props.onPlayTracks} onClick={() => props.onPlayTracks?.(selectedPlayable)}>{t("Play selected displayed supported tracks ({{count}})", { count: selectedPlayable.length })}</button>
        </>}
        <button type="button" className="music-open-queue" disabled={!props.queueControls} onClick={() => props.queueControls?.show()}>{t("Listening queue ({{count}})", { count: props.queueControls?.count ?? 0 })}</button>
      </div>
      {showingTrackRows && displayedPlayable.length < trackRows.length && <small>{t("Skipped {{count}} unsupported or unavailable displayed tracks", { count: trackRows.length - displayedPlayable.length })}</small>}
      {showingTrackRows && selectedDisplayedRows.length > selectedPlayable.length && <small>{t("Skipped {{count}} selected displayed tracks that are unsupported or unavailable", { count: selectedDisplayedRows.length - selectedPlayable.length })}</small>}
      {showingTrackRows && selectionOutsideDisplayedCount > 0 && <small>{t("{{count}} selected row(s) outside the displayed tracks are not included", { count: selectionOutsideDisplayedCount })}</small>}
    </div>
    <details className="music-playback-limits"><summary>{t("Playback and format details")}</summary><p>{t("Playback downloads and verifies the complete original first. It supports common browser audio formats up to 32 MiB; seeking starts after verification. Larger or unavailable files can still be downloaded from Details.")}</p></details>
  </section>;
}

function buildGroups(rows: MusicRow[], keyFor: (row: MusicRow) => string, labelFor: (row: MusicRow) => string) {
  const grouped = new Map<string, { key: string; label: string; rows: MusicRow[]; artist?: string; album?: string }>();
  for (const row of rows) {
    const key = keyFor(row);
    let group = grouped.get(key);
    if (!group) {
      group = { key, label: labelFor(row), rows: [], artist: row.facts?.artist, album: row.facts?.album };
      grouped.set(key, group);
    }
    group.rows.push(row);
  }
  return [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function GroupList({ groups, countLabel, t, onSelect, showArtist = false }: { groups: ReturnType<typeof buildGroups>; countLabel: string; t: Props["t"]; onSelect: (key: string) => void; showArtist?: boolean }) {
  return groups.length ? <div className="music-group-list">{groups.map((group) => <button key={group.key} type="button" className="music-group-card" onClick={() => onSelect(group.key)}><Music2 aria-hidden="true" /><span><strong>{group.label}</strong>{showArtist && <small>{group.artist || t("Unknown artist")}</small>}</span><small>{group.rows.length} {countLabel}</small></button>)}</div> : <p className="music-empty">{t("No tracks match this search")}</p>;
}

function TrackRow({ row, props, facts, open }: { row: MusicRow; props: Props; facts?: MusicTrackFacts; open: (row: MusicRow, event: Parameters<ResultListProps["onRowClick"]>[1]) => void }) {
  const { hit, index } = row;
  const { t, workspaceID, tagsBySubject, onPlayTrack, onQueueTrack } = props;
  const name = hit.name || t("Untitled subject");
  const playable = playableMusicTrack(hit, workspaceID) !== undefined;
  const tags = hit.subject_ref ? tagsBySubject.get(hit.subject_ref) ?? [] : [];
  const fmt = name.includes(".") ? name.split(".").pop()?.toUpperCase() : "";
  const factLine = [facts?.artist, facts?.album, facts?.track ? `#${facts.track}` : undefined].filter(Boolean).join(" · ");
  return <article className={`music-track result-row is-file ${props.selectedRef === hit.subject_ref ? "selected" : ""} ${hit.subject_ref && props.selectionRefs.includes(hit.subject_ref) ? "multi-selected" : ""}`} role="group" data-result-index={index} aria-label={name}>
    <span className="result-select" role="checkbox" aria-checked={Boolean(hit.subject_ref && props.selectionRefs.includes(hit.subject_ref))} tabIndex={-1} aria-label={t(props.selectionRefs.includes(hit.subject_ref || "") ? "Deselect {{name}}" : "Select {{name}}", { name })} onClick={(event) => { event.stopPropagation(); props.onToggleSelection(index); }}>{props.selectionRefs.includes(hit.subject_ref || "") ? "✓" : ""}</span>
    <button className="music-track-main result-open-copy" type="button" tabIndex={index === props.rovingRow ? 0 : -1} onClick={(event) => open(row, event)}><Music2 /><span><strong>{facts?.title || name}</strong><small>{factLine || (Number.isSafeInteger(hit.logical_size) && hit.logical_size! >= 0 ? formatBytes(hit.logical_size!) : t("No logical size"))}{fmt ? ` · ${fmt}` : ""}{tags.length ? ` · ${tags.join(" · ")}` : ""}{factLine && hit.logical_size !== undefined ? ` · ${formatBytes(hit.logical_size)}` : ""}</small></span></button>
    <FavoriteButton hit={hit} controls={props.favoriteControls} t={t} />
    <button type="button" className="music-track-queue" disabled={!playable} aria-label={t("Add {{name}} to queue", { name })} title={t("Add to queue")} onClick={() => { const track = playableMusicTrack(hit, workspaceID); if (track) onQueueTrack(track); }}>+</button>
    <button type="button" className="music-track-play" disabled={!playable} aria-label={t("Play {{name}}", { name })} title={playable ? t("Play") : t("Playback requires a known original of at most 32 MiB")} onClick={() => { const track = playableMusicTrack(hit, workspaceID); if (track) onPlayTrack(track); }}><Play /></button>
  </article>;
}
