import { useMemo, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { Music2, Play, Search } from "lucide-react";
import { ResultList } from "./ResultList";
import type { AudioTrack } from "../lib/audioPlayback";
import { formatBytes, mediaClassFromSuffix } from "../lib/format";
import { musicGroupKey, musicPlaybackEligibility, orderRecordedAlbumTracks, playableMusicTrack, sortMusicRows, type MusicMetadataState, type MusicPlaybackReason, type MusicSortDirection, type MusicSortField, type MusicTrackFacts } from "../lib/musicMetadata";
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
const PLAYBACK_REASON_MESSAGES: Record<MusicPlaybackReason, string> = {
  "unsupported-format": "This audio format is not supported for browser playback. Open Details to download the original.",
  "identity-unavailable": "The original has no verified identity information.",
  "size-unavailable": "The original size is unknown, so playback eligibility cannot be confirmed.",
  "size-limit": "The original is larger than the 32 MiB playback limit.",
  "workspace-unavailable": "The current workspace is unavailable for playback.",
};

export function MusicLibraryExperience(props: Props) {
  const { hits, t, workspaceID, tagsBySubject, onPlayTrack, onQueueTrack } = props;
  const [mode, setMode] = useState<Mode>("tracks");
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string | undefined>();
  const [sortField, setSortField] = useState<MusicSortField>("original");
  const [sortDirection, setSortDirection] = useState<MusicSortDirection>("asc");
  const [eligibilityFilter, setEligibilityFilter] = useState<"all" | "playable" | "original-only">("all");
  const [focusedIndex, setFocusedIndex] = useState<number | undefined>();
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
  const legacyOrderedRows = useMemo(() => mode === "albums" && selectedGroup && selectedGroup !== musicGroupKey("album") ? orderRecordedAlbumTracks(rows) : rows, [mode, rows, selectedGroup]);
  const sortedRows = useMemo(() => sortMusicRows(legacyOrderedRows, sortField, sortDirection, props.locale), [legacyOrderedRows, props.locale, sortDirection, sortField]);
  const trackRows = useMemo(() => sortedRows.filter((row) => {
    const playable = musicPlaybackEligibility(row.hit, workspaceID).playable;
    return eligibilityFilter === "all" || (eligibilityFilter === "playable" ? playable : !playable);
  }), [eligibilityFilter, sortedRows, workspaceID]);
  const artistGroups = useMemo(() => buildGroups(trackRows, (row) => musicGroupKey("artist", row.facts), (row) => row.facts?.artist || t("Unknown artist")), [trackRows, t]);
  const albumGroups = useMemo(() => buildGroups(trackRows, (row) => musicGroupKey("album", row.facts), (row) => row.facts?.album || t("Unknown album")), [trackRows, t]);
  const displayedPlayable = trackRows.flatMap((row) => { const track = playableMusicTrack(row.hit, workspaceID); return track ? [track] : []; });
  const selectedRefs = useMemo(() => new Set(props.selectionRefs), [props.selectionRefs]);
  const selectedDisplayedRows = useMemo(() => trackRows.filter((row) => row.hit.subject_ref && selectedRefs.has(row.hit.subject_ref)), [trackRows, selectedRefs]);
  const selectedPlayable = selectedDisplayedRows.flatMap((row) => { const track = playableMusicTrack(row.hit, workspaceID); return track ? [track] : []; });
  const displayedRefs = useMemo(() => new Set(trackRows.flatMap((row) => row.hit.subject_ref ? [row.hit.subject_ref] : [])), [trackRows]);
  const selectionOutsideDisplayedCount = props.selectionRefs.filter((subjectRef) => !displayedRefs.has(subjectRef)).length;
  const showingTrackRows = mode === "tracks" || Boolean(selectedGroup);
  const open = (row: MusicRow, event: Parameters<ResultListProps["onRowClick"]>[1]) => props.onRowClick(row.index, event);
  const handleListKeyDown: Props["onKeyDown"] = (event) => {
    if (!(event.target as HTMLElement | null)?.closest(".result-open-copy")) return;
    const keyEvent = event as KeyboardEvent;
    if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(keyEvent.key)) {
      const sourceIndex = Number((event.target as HTMLElement).closest(".music-track")?.getAttribute("data-result-index"));
      const currentPosition = trackRows.findIndex((row) => row.index === sourceIndex);
      if (currentPosition < 0 || !trackRows.length) return;
      const nextPosition = keyEvent.key === "Home" ? 0 : keyEvent.key === "End" ? trackRows.length - 1 : Math.max(0, Math.min(trackRows.length - 1, currentPosition + (["ArrowDown", "ArrowRight"].includes(keyEvent.key) ? 1 : -1)));
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      const nextIndex = trackRows[nextPosition].index;
      setFocusedIndex(nextIndex);
      requestAnimationFrame(() => props.libraryListRef.current?.querySelector<HTMLElement>(`[data-result-index="${nextIndex}"] .music-track-main`)?.focus());
      return;
    }
    props.onKeyDown(event);
  };
  const rovingIndex = trackRows.some((row) => row.index === focusedIndex) ? focusedIndex : trackRows[0]?.index;
  const setSort = (field: MusicSortField) => { setSortField(field); setFocusedIndex(undefined); };

  return <section className="music-library" aria-label={t("Music library")}>
    <header className="music-library-heading">
      <div className="music-library-heading__copy">
        <h1>{t("Music")}</h1>
        <p>{t("Play and organize original audio files from your library.")} <span className="music-library-heading__count">{t("{{count}} tracks in this view", { count: trackRows.length })}</span></p>
      </div>
    </header>
    <div className="music-library__toolbar">
      <nav className="music-browse-modes" aria-label={t("Browse music")}>
        {(["tracks", "artists", "albums"] as const).map((nextMode) => <button key={nextMode} type="button" aria-pressed={mode === nextMode} onClick={() => { setMode(nextMode); setSelectedGroup(undefined); }}>{t(nextMode === "tracks" ? "Tracks" : nextMode === "artists" ? "Artists" : "Albums")}</button>)}
      </nav>
      <label className="music-browse-search"><Search aria-hidden="true" /><span className="sr-only">{t("Search music")}</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedGroup(undefined); }} placeholder={t("Filter music in this view")} /></label>
      <label className="music-local-filter"><span>{t("Availability")}</span><select value={eligibilityFilter} onChange={(event) => { setEligibilityFilter(event.target.value as typeof eligibilityFilter); setFocusedIndex(undefined); }}><option value="all">{t("All tracks")}</option><option value="playable">{t("Eligible for playback")}</option><option value="original-only">{t("Unavailable for playback")}</option></select></label>
      <label className="music-local-filter"><span>{t("Sort by")}</span><select value={sortField} onChange={(event) => setSort(event.target.value as MusicSortField)}><option value="original">{t("Library order")}</option><option value="title">{t("Title")}</option><option value="artist">{t("Artist")}</option><option value="album">{t("Album")}</option><option value="track">{t("Track number")}</option><option value="duration">{t("Duration")}</option><option value="size">{t("File size")}</option></select></label>
      {sortField !== "original" && <button className="music-sort-direction" type="button" aria-label={t(sortDirection === "asc" ? "Sort descending" : "Sort ascending")} onClick={() => setSortDirection((direction) => direction === "asc" ? "desc" : "asc")}>{t(sortDirection === "asc" ? "Ascending" : "Descending")}</button>}
    </div>
    {(props.metadata?.reload || props.metadata?.status === "loading" || props.metadata?.status === "unavailable" || (props.metadata?.status === "ready" && rows.some((row) => !row.facts))) && <div className="music-facts-status-row">
      {props.metadata?.status === "loading" && <p className="music-facts-status" role="status">{t("Loading recorded audio facts")}</p>}
      {props.metadata?.status === "unavailable" && <p className="music-facts-status" role="status">{t("Audio facts unavailable; showing filenames and tags")}</p>}
      {props.metadata?.status === "ready" && rows.some((row) => !row.facts) && <p className="music-facts-status" role="status">{t("Some tracks have no recorded audio facts; their filenames remain available")}</p>}
      {props.metadata?.reload && <button type="button" className="music-refresh-facts" disabled={props.metadata.status === "loading"} onClick={props.metadata.reload}>{t("Refresh music facts")}</button>}
    </div>}
    {selectedGroup && <button type="button" className="music-clear-group" onClick={() => setSelectedGroup(undefined)}>{t("Show all tracks")}</button>}
    {/* Keep actions ahead of the rows; selection chooses the primary Play action,
        while the complete displayed set stays available in a native disclosure. */}
    <div className="music-queue-actions" role="group" aria-label={t("Music queue actions")}>
      {showingTrackRows && <div className="music-action-group">
        {selectedPlayable.length > 0 ? <>
          <button className="music-play-displayed" type="button" disabled={!props.onPlayTracks} onClick={() => props.onPlayTracks?.(selectedPlayable)}>{t("Play selected ({{count}})", { count: selectedPlayable.length })}</button>
          <button type="button" disabled={!props.queueControls} onClick={() => props.queueControls?.addTracks(selectedPlayable)}>{t("Add selected to queue ({{count}})", { count: selectedPlayable.length })}</button>
        </> : displayedPlayable.length > 0 && <>
          <button className="music-play-displayed" type="button" disabled={!props.onPlayTracks} onClick={() => props.onPlayTracks?.(displayedPlayable)}>{t("Play these tracks ({{count}})", { count: displayedPlayable.length })}</button>
          <button type="button" disabled={!props.queueControls} onClick={() => props.queueControls?.addTracks(displayedPlayable)}>{t("Add to queue ({{count}})", { count: displayedPlayable.length })}</button>
        </>}
        {selectedPlayable.length > 0 && displayedPlayable.length > 0 && <details className="music-displayed-actions">
          <summary>{t("Displayed tracks")}</summary>
          <div className="music-displayed-actions__menu">
            <button type="button" disabled={!props.onPlayTracks} onClick={() => props.onPlayTracks?.(displayedPlayable)}>{t("Play these tracks ({{count}})", { count: displayedPlayable.length })}</button>
            <button type="button" disabled={!props.queueControls} onClick={() => props.queueControls?.addTracks(displayedPlayable)}>{t("Add to queue ({{count}})", { count: displayedPlayable.length })}</button>
          </div>
        </details>}
      </div>}
      <button type="button" className="music-open-queue" disabled={!props.queueControls} onClick={() => props.queueControls?.show()}>{t("Queue ({{count}})", { count: props.queueControls?.count ?? 0 })}</button>
      {showingTrackRows && (displayedPlayable.length < trackRows.length || selectedDisplayedRows.length > selectedPlayable.length || selectionOutsideDisplayedCount > 0) && <div className="music-action-notes">
        {displayedPlayable.length < trackRows.length && <small>{t("Skipped {{count}} unsupported or unavailable displayed tracks", { count: trackRows.length - displayedPlayable.length })}</small>}
        {selectedDisplayedRows.length > selectedPlayable.length && <small>{t("Skipped {{count}} selected displayed tracks that are unsupported or unavailable", { count: selectedDisplayedRows.length - selectedPlayable.length })}</small>}
        {selectionOutsideDisplayedCount > 0 && <small>{t("{{count}} selected row(s) outside the displayed tracks are not included", { count: selectionOutsideDisplayedCount })}</small>}
      </div>}
    </div>
    {mode === "artists" && !selectedGroup ? <GroupList groups={artistGroups} countLabel={t("tracks")} t={t} onSelect={(key) => setSelectedGroup(key)} /> : mode === "albums" && !selectedGroup ? <GroupList groups={albumGroups} countLabel={t("tracks")} t={t} showArtist onSelect={(key) => setSelectedGroup(key)} /> : trackRows.length ? <div ref={props.libraryListRef} className="music-track-list result-list list-mode" role="group" aria-label={t("Library results")} aria-description={t("Use the arrow keys to move through visible tracks; Space selects and Enter opens the focused track.")} data-selection-count={props.selectionCount} onKeyDown={handleListKeyDown} onFocusCapture={(event) => { const index = Number((event.target as HTMLElement).closest(".music-track")?.getAttribute("data-result-index")); if (Number.isSafeInteger(index)) setFocusedIndex(index); }}>
      {trackRows.map((row) => <TrackRow key={row.hit.subject_ref || row.hit.entry_id || row.hit.name} row={row} props={props} facts={row.facts} open={open} tabIndex={row.index === rovingIndex ? 0 : -1} />)}
    </div> : <div className="music-empty"><Music2 /><h2>{query.trim() ? t("No tracks match this search") : eligibilityFilter !== "all" ? t("No tracks in this availability filter") : t("No audio tracks in the loaded listing")}</h2><p>{t("Track names come from original filenames. Metadata and artwork are shown only when real facts are available.")}</p></div>}
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

function TrackRow({ row, props, facts, open, tabIndex }: { row: MusicRow; props: Props; facts?: MusicTrackFacts; open: (row: MusicRow, event: Parameters<ResultListProps["onRowClick"]>[1]) => void; tabIndex: number }) {
  const queueMenuRef = useRef<HTMLDetailsElement | null>(null);
  const { hit, index } = row;
  const { t, workspaceID, tagsBySubject, onPlayTrack, onQueueTrack } = props;
  const name = hit.name || t("Untitled subject");
  const eligibility = musicPlaybackEligibility(hit, workspaceID);
  const playable = eligibility.playable;
  const tags = hit.subject_ref ? tagsBySubject.get(hit.subject_ref) ?? [] : [];
  const fmt = name.includes(".") ? name.split(".").pop()?.toUpperCase() : "";
  const factLine = [facts?.artist, facts?.album, facts?.track ? `#${facts.track}` : undefined].filter(Boolean).join(" · ");
  const displayTitle = facts?.title || name;
  const rowDetails = [facts?.title && facts.title !== name ? name : undefined, factLine, Number.isSafeInteger(hit.logical_size) && hit.logical_size! >= 0 ? formatBytes(hit.logical_size!) : t("No logical size"), fmt, ...tags].filter(Boolean).join(" · ");
  return <article className={`music-track result-row is-file ${props.selectedRef === hit.subject_ref ? "selected" : ""} ${hit.subject_ref && props.selectionRefs.includes(hit.subject_ref) ? "multi-selected" : ""}`} role="group" data-result-index={index} aria-label={name}>
    <button type="button" className="result-select" role="checkbox" aria-checked={Boolean(hit.subject_ref && props.selectionRefs.includes(hit.subject_ref))} disabled={!hit.subject_ref} aria-label={t(props.selectionRefs.includes(hit.subject_ref || "") ? "Deselect {{name}}" : "Select {{name}}", { name })} onClick={(event) => { event.stopPropagation(); props.onToggleSelection(index); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}>{props.selectionRefs.includes(hit.subject_ref || "") ? "✓" : ""}</button>
    <button className="music-track-main result-open-copy" type="button" title={facts?.title && facts.title !== name ? `${displayTitle} — ${name}` : displayTitle} tabIndex={tabIndex} onClick={(event) => open(row, event)}><Music2 /><span><strong>{displayTitle}</strong><small>{rowDetails}{!playable && <span className="music-playback-reason">{t(PLAYBACK_REASON_MESSAGES[eligibility.reason])}</span>}</small></span></button>
    <FavoriteButton hit={hit} controls={props.favoriteControls} t={t} />
    <details ref={queueMenuRef} className="music-track-queue-menu"><summary aria-label={t("Queue actions for {{name}}", { name })} title={t("Queue actions")}>⋯</summary><div><button type="button" disabled={!playable} aria-label={t("Add {{name}} to queue", { name })} onClick={() => { const track = playableMusicTrack(hit, workspaceID); if (track) runQueueMenuAction(queueMenuRef.current, () => onQueueTrack(track)); }}>{t("Add to queue")}</button><PlayNextButton hit={hit} workspaceID={workspaceID} queueControls={props.queueControls} t={t} name={name} onPlayNext={(track) => runQueueMenuAction(queueMenuRef.current, () => props.queueControls?.addNext?.(track))} /></div></details>
    <button type="button" className="music-track-play" disabled={!playable} aria-label={t("Play {{name}}", { name })} title={playable ? t("Play original; native playback may still be unavailable") : t(PLAYBACK_REASON_MESSAGES[eligibility.reason])} onClick={() => { const track = playableMusicTrack(hit, workspaceID); if (track) onPlayTrack(track); }}><Play /></button>
  </article>;
}

function PlayNextButton({ hit, workspaceID, queueControls, t, name, onPlayNext }: { hit: Props["hits"][number]; workspaceID?: string; queueControls?: MusicQueueControls; t: Props["t"]; name: string; onPlayNext: (track: AudioTrack) => void }) {
  const track = playableMusicTrack(hit, workspaceID);
  // Queue-host wiring is owned by the App integration slice. Keep this control
  // absent until that host callback is supplied; it must never emulate insertion
  // by autoplaying or by creating a page-local queue.
  const addNext = queueControls?.addNext;
  return addNext ? <button type="button" disabled={!track} aria-label={t("Play {{name}} next", { name })} onClick={() => { if (track) onPlayNext(track); }}>{t("Play next")}</button> : null;
}

function runQueueMenuAction(menu: HTMLDetailsElement | null, action: () => void) {
  action();
  if (!menu) return;
  menu.open = false;
  requestAnimationFrame(() => menu.querySelector("summary")?.focus());
}
