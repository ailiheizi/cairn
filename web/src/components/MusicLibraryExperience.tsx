import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useBrowsePositionScopeIdentity, useClientBrowseValue } from "../app/ClientBrowseSession";
import { useBrowsePosition } from "../app/useBrowsePosition";
import { MoreHorizontal, Music2, Search } from "lucide-react";
import type { AudioTrack } from "../lib/audioPlayback";
import { mediaClassFromSuffix } from "../lib/format";
import { materialListSelectionEligible } from "../lib/materialListIO";
import { musicGroupKey, musicPlaybackEligibility, orderRecordedAlbumTracks, playableMusicTrack, sortMusicRows, type MusicSortDirection, type MusicSortField, type MusicTrackFacts } from "../lib/musicMetadata";
import { GroupList, TrackRow } from "./music/MusicRows";
import { buildGroups, filenameFormatToken, groupDurationSummary, matchesCurrentPlayback, musicRowSelectionKey, NO_FILENAME_EXTENSION, playbackStatusText, shuffleTracks, uniqueMusicHits, type MusicLibraryProps as Props, type MusicRow } from "./music/musicHelpers";
import "./MusicLibraryExperience.css";

type Mode = "tracks" | "artists" | "albums";
type MusicYearFilter = "all" | "unknown" | `year:${string}`;
type CurrentTrackRecovery = { workspaceID: string; playbackIdentity: string; expectedViewIdentity: string };

export function MusicLibraryExperience(props: Props) {
  const { hits, t, workspaceID, tagsBySubject, onPlayTrack, onQueueTrack } = props;
  const [mode, setMode] = useClientBrowseValue<Mode>("music", "mode", "tracks");
  const [query, setQuery] = useClientBrowseValue("music", "query", "");
  const [selectedGroup, setSelectedGroup] = useClientBrowseValue<string | undefined>("music", "selected-group", undefined);
  const [selectedGroupFacts, setSelectedGroupFacts] = useState<{ key: string; label: string; artist?: string } | undefined>();
  const [selectedArtistAlbum, setSelectedArtistAlbum] = useClientBrowseValue<string | undefined>("music", "selected-artist-album", undefined);
  const [selectedArtistAlbumLabel, setSelectedArtistAlbumLabel] = useState<{ key: string; label: string; scope: string } | undefined>();
  const [artistTracksView, setArtistTracksView] = useClientBrowseValue<boolean>("music", "artist-tracks-view", false);
  const [sortField, setSortField] = useClientBrowseValue<MusicSortField>("music", "sort-field", "original");
  const [sortDirection, setSortDirection] = useClientBrowseValue<MusicSortDirection>("music", "sort-direction", "asc");
  const [eligibilityFilter, setEligibilityFilter] = useClientBrowseValue<"all" | "playable" | "original-only">("music", "eligibility-filter", "all");
  const [formatFilter, setFormatFilter] = useClientBrowseValue<string>("music", "format-filter", "all");
  const [selectedTagFilters, setSelectedTagFilters] = useClientBrowseValue<string[]>("music", "tag-filters", []);
  const [yearFilter, setYearFilter] = useClientBrowseValue<MusicYearFilter>("music", "year-filter", "all");
  const [onlySelectedTracks, setOnlySelectedTracks] = useClientBrowseValue<boolean>("music", "only-selected", false);
  const [focusedIndex, setFocusedIndex] = useState<number | undefined>();
  const currentTrackRecoveryRef = useRef<CurrentTrackRecovery | null>(null);
  const currentTrackRecoveryFrameRef = useRef<number | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const groupListRef = useRef<HTMLDivElement | null>(null);
  const artistTracksButtonRef = useRef<HTMLButtonElement | null>(null);
  const groupOpenButtons = useRef(new Map<string, HTMLButtonElement>());
  const records = props.metadata?.records ?? new Map<string, MusicTrackFacts>();
  const tagStatus = props.favoriteControls?.status ?? "unavailable";
  const tagsReady = tagStatus === "ready";
  const selectedRefs = useMemo(() => new Set(props.selectionRefs), [props.selectionRefs]);
  const loadedFormatCounts = useMemo(() => {
    const subjectsByFormat = new Map<string, Set<string>>();
    hits.forEach((hit, index) => {
      if (hit.entry_type !== "REGULAR_FILE" || mediaClassFromSuffix((hit.name || "").split(".").pop() || "") !== "audio") return;
      const format = filenameFormatToken(hit.name);
      let subjects = subjectsByFormat.get(format);
      if (!subjects) { subjects = new Set(); subjectsByFormat.set(format, subjects); }
      subjects.add(hit.subject_ref?.trim() || hit.entry_id || `loaded-row-${index}`);
    });
    return [...subjectsByFormat].map(([format, subjects]) => [format, subjects.size] as const).sort(([left], [right]) => left.localeCompare(right, props.locale));
  }, [hits, props.locale]);
  const loadedTagCounts = useMemo(() => {
    const tagsByLoadedSubject = new Map<string, Set<string>>();
    for (const hit of hits) {
      const subjectRef = hit.subject_ref?.trim();
      if (!subjectRef || hit.entry_type !== "REGULAR_FILE" || mediaClassFromSuffix((hit.name || "").split(".").pop() || "") !== "audio") continue;
      let subjectTags = tagsByLoadedSubject.get(subjectRef);
      if (!subjectTags) { subjectTags = new Set(); tagsByLoadedSubject.set(subjectRef, subjectTags); }
      for (const tag of tagsBySubject.get(subjectRef) ?? []) if (tag.trim()) subjectTags.add(tag);
    }
    const counts = new Map<string, number>();
    for (const subjectTags of tagsByLoadedSubject.values()) for (const tag of subjectTags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].sort(([left], [right]) => left.localeCompare(right, props.locale));
  }, [hits, props.locale, tagsBySubject]);
  const loadedYearCounts = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    const knownSubjects = new Set<string>();
    const unknownSubjects = new Set<string>();
    hits.forEach((hit, index) => {
      if (hit.entry_type !== "REGULAR_FILE" || mediaClassFromSuffix((hit.name || "").split(".").pop() || "") !== "audio") return;
      const subjectRef = hit.subject_ref?.trim();
      const subjectKey = subjectRef || hit.entry_id || `loaded-row-${index}`;
      if (knownSubjects.has(subjectKey) || unknownSubjects.has(subjectKey)) return;
      const year = subjectRef ? records.get(subjectRef)?.year?.trim() : undefined;
      if (!year) { unknownSubjects.add(subjectKey); return; }
      knownSubjects.add(subjectKey);
      let subjects = counts.get(year);
      if (!subjects) { subjects = new Set(); counts.set(year, subjects); }
      subjects.add(subjectKey);
    });
    return {
      years: [...counts].map(([year, subjects]) => [year, subjects.size] as const).sort(([left], [right]) => left.localeCompare(right, props.locale, { numeric: true })),
      unknown: unknownSubjects.size,
    };
  }, [hits, props.locale, records]);
  const yearDataReady = props.metadata?.status === "ready";
  const allRows = useMemo(() => hits.flatMap((hit, index) => {
    if (hit.entry_type !== "REGULAR_FILE" || mediaClassFromSuffix((hit.name || "").split(".").pop() || "") !== "audio") return [];
    const subjectRef = hit.subject_ref?.trim();
    const subjectTags = subjectRef ? new Set(tagsBySubject.get(subjectRef) ?? []) : new Set<string>();
    if (selectedTagFilters.some((tag) => !subjectTags.has(tag))) return [];
    if (onlySelectedTracks && (!subjectRef || !selectedRefs.has(subjectRef))) return [];
    if (formatFilter !== "all" && filenameFormatToken(hit.name) !== formatFilter) return [];
    const facts = subjectRef ? records.get(subjectRef) : undefined;
    if (yearFilter !== "all") {
      if (!yearDataReady) return [];
      const year = facts?.year?.trim();
      if (yearFilter === "unknown" ? Boolean(year) : !year || yearFilter !== `year:${year}`) return [];
    }
    const needle = query.trim().toLocaleLowerCase(props.locale);
    const haystack = [hit.name, facts?.title, facts?.artist, facts?.album, ...((hit.subject_ref && tagsBySubject.get(hit.subject_ref)) || [])].filter(Boolean).join(" ").toLocaleLowerCase(props.locale);
    if (needle && !haystack.includes(needle)) return [];
    return [{ hit, index, facts }];
  }), [formatFilter, hits, onlySelectedTracks, props.locale, query, records, selectedRefs, selectedTagFilters, tagsBySubject, yearDataReady, yearFilter]);
  const selectedArtistRows = useMemo(() => mode === "artists" && selectedGroup ? allRows.filter((row) => musicGroupKey("artist", row.facts) === selectedGroup) : [], [allRows, mode, selectedGroup]);
  const rows = useMemo(() => {
    if (!selectedGroup) return allRows;
    if (mode === "artists") {
      if (selectedArtistAlbum) return selectedArtistRows.filter((row) => musicGroupKey("album", row.facts) === selectedArtistAlbum);
      return artistTracksView ? selectedArtistRows : [];
    }
    return allRows.filter((row) => musicGroupKey("album", row.facts) === selectedGroup);
  }, [allRows, artistTracksView, mode, selectedArtistAlbum, selectedArtistRows, selectedGroup]);
  const legacyOrderedRows = useMemo(() => ((mode === "albums" && selectedGroup) || (mode === "artists" && selectedArtistAlbum) ? orderRecordedAlbumTracks(rows) : rows), [mode, rows, selectedArtistAlbum, selectedGroup]);
  const sortedRows = useMemo(() => sortMusicRows(legacyOrderedRows, sortField, sortDirection, props.locale), [legacyOrderedRows, props.locale, sortDirection, sortField]);
  const matchesAvailability = (row: MusicRow) => {
    const playable = musicPlaybackEligibility(row.hit, workspaceID).playable;
    return eligibilityFilter === "all" || (eligibilityFilter === "playable" ? playable : !playable);
  };
  const trackRows = useMemo(() => sortedRows.filter(matchesAvailability), [eligibilityFilter, sortedRows, workspaceID]);
  const artistTrackRows = useMemo(() => selectedArtistRows.filter(matchesAvailability), [eligibilityFilter, selectedArtistRows, workspaceID]);
  const pendingEntryFocus = useRef("");
  const [locatedSubject, setLocatedSubject] = useState("");
  useEffect(() => {
    const target = props.focusedSubjectRef?.trim();
    if (!target || !hits.some(hit => hit.subject_ref === target)) return;
    pendingEntryFocus.current = target;
    setLocatedSubject(target);
    setMode("tracks"); setSelectedGroup(undefined); setSelectedArtistAlbum(undefined);
    setArtistTracksView(false); setQuery(""); setEligibilityFilter("all");
    setFormatFilter("all"); setSelectedTagFilters([]); setYearFilter("all"); setOnlySelectedTracks(false);
  }, [props.focusedSubjectRef, props.focusRequest, hits]);
  useEffect(() => {
    const target = pendingEntryFocus.current;
    if (!target || mode !== "tracks" || selectedGroup || selectedArtistAlbum || artistTracksView || query || eligibilityFilter !== "all" || formatFilter !== "all" || selectedTagFilters.length || yearFilter !== "all" || onlySelectedTracks) return;
    const row = Array.from(props.libraryListRef.current?.querySelectorAll<HTMLElement>(".music-track[data-subject-ref]") ?? []).find(element => element.dataset.subjectRef === target);
    if (!row) return;
    const control = row.querySelector<HTMLButtonElement>(".music-track-main");
    if (!control) return;
    pendingEntryFocus.current = "";
    setFocusedIndex(Number(row.dataset.resultIndex));
    row.scrollIntoView({ block: "nearest", inline: "nearest" });
    control.focus({ preventScroll: true });
    props.onFocusSubject?.("");
  }, [props.focusedSubjectRef, props.focusRequest, trackRows, mode, selectedGroup, selectedArtistAlbum, artistTracksView, props.libraryListRef]);
  const rangeSelectionScope = useMemo(() => JSON.stringify([workspaceID ?? "", mode, selectedGroup ?? "", selectedArtistAlbum ?? "", artistTracksView, query, sortField, sortDirection, eligibilityFilter, selectedTagFilters, onlySelectedTracks, formatFilter, yearFilter, trackRows.map(musicRowSelectionKey)]), [artistTracksView, eligibilityFilter, formatFilter, mode, onlySelectedTracks, query, selectedArtistAlbum, selectedGroup, selectedTagFilters, sortDirection, sortField, trackRows, workspaceID, yearFilter]);
  const rangeAnchor = useRef<{ scope: string; rowKey: string } | undefined>(undefined);
  const selectionEmpty = props.selectionRefs.length === 0;
  const previousRangeScope = useRef(rangeSelectionScope);
  useEffect(() => {
    if (previousRangeScope.current !== rangeSelectionScope) {
      rangeAnchor.current = undefined;
      previousRangeScope.current = rangeSelectionScope;
    }
    if (selectionEmpty) rangeAnchor.current = undefined;
  }, [rangeSelectionScope, selectionEmpty]);
  const establishRangeAnchor = (row: MusicRow) => { rangeAnchor.current = { scope: rangeSelectionScope, rowKey: musicRowSelectionKey(row) }; };
  const selectVisibleRange = (row: MusicRow) => {
    if (!props.onSelectSubjects) return;
    const target = trackRows.findIndex((candidate) => musicRowSelectionKey(candidate) === musicRowSelectionKey(row));
    if (target < 0) return;
    const anchor = rangeAnchor.current?.scope === rangeSelectionScope ? trackRows.findIndex((candidate) => musicRowSelectionKey(candidate) === rangeAnchor.current?.rowKey) : -1;
    const start = anchor < 0 ? target : anchor;
    props.onSelectSubjects(uniqueMusicHits(trackRows.slice(Math.min(start, target), Math.max(start, target) + 1).map((candidate) => candidate.hit)), "add");
    establishRangeAnchor(anchor < 0 ? row : trackRows[anchor]);
  };
  const artistGroups = useMemo(() => buildGroups(trackRows, (row) => musicGroupKey("artist", row.facts), (row) => row.facts?.artist || t("Unknown artist")), [trackRows, t]);
  const albumGroups = useMemo(() => buildGroups(trackRows, (row) => musicGroupKey("album", row.facts), (row) => row.facts?.album || t("Unknown album")), [trackRows, t]);
  const artistAlbumGroups = useMemo(() => buildGroups(artistTrackRows, (row) => musicGroupKey("album", row.facts), (row) => row.facts?.album || t("Unknown album")), [artistTrackRows, t]);
  const allArtistGroups = useMemo(() => buildGroups(allRows, (row) => musicGroupKey("artist", row.facts), (row) => row.facts?.artist || t("Unknown artist")), [allRows, t]);
  const allAlbumGroups = useMemo(() => buildGroups(allRows, (row) => musicGroupKey("album", row.facts), (row) => row.facts?.album || t("Unknown album")), [allRows, t]);
  const activeGroups = mode === "artists" ? allArtistGroups : allAlbumGroups;
  const activeGroup = selectedGroup ? activeGroups.find((group) => group.key === selectedGroup) : undefined;
  const activeArtistAlbum = selectedArtistAlbum ? artistAlbumGroups.find((group) => group.key === selectedArtistAlbum) : undefined;
  const groupFactsPending = Boolean(selectedGroup && (props.metadata?.status === "idle" || props.metadata?.status === "loading"));
  const displayedPlayable = trackRows.flatMap((row) => { const track = playableMusicTrack(row.hit, workspaceID, row.facts); return track ? [track] : []; });
  const selectedDisplayedRows = useMemo(() => trackRows.filter((row) => row.hit.subject_ref && selectedRefs.has(row.hit.subject_ref)), [trackRows, selectedRefs]);
  const selectedPlayable = selectedDisplayedRows.flatMap((row) => { const track = playableMusicTrack(row.hit, workspaceID, row.facts); return track ? [track] : []; });
  const randomize = (tracks: AudioTrack[]) => props.onPlayTracks?.(shuffleTracks(tracks));
  const displayedRefs = useMemo(() => new Set(trackRows.flatMap((row) => row.hit.subject_ref ? [row.hit.subject_ref] : [])), [trackRows]);
  const selectionOutsideDisplayedCount = props.selectionRefs.filter((subjectRef) => !displayedRefs.has(subjectRef)).length;
  const displayedTrackHits = useMemo(() => uniqueMusicHits(trackRows.map((row) => row.hit)), [trackRows]);
  const selectedDisplayedHits = useMemo(() => uniqueMusicHits(selectedDisplayedRows.map((row) => row.hit)), [selectedDisplayedRows]);
  const materialListSubjects = selectedDisplayedHits.length ? selectedDisplayedHits : displayedTrackHits;
  const materialListSelectionValid = materialListSelectionEligible(materialListSubjects);
  const showingTrackRows = mode === "tracks" || Boolean(mode === "albums" && selectedGroup) || Boolean(mode === "artists" && selectedGroup && (selectedArtistAlbum || artistTracksView));
  const currentPlayback = props.queueControls?.currentPlayback;
  const browseScopeIdentity = useBrowsePositionScopeIdentity();
  const playbackIdentity = currentPlayback
    ? JSON.stringify([currentPlayback.workspaceID, currentPlayback.entryID, currentPlayback.contentID, currentPlayback.logicalSize])
    : "";
  const hostResultsIdentity = useMemo(() => JSON.stringify([workspaceID ?? "", hits.map((hit) => [hit.subject_ref ?? "", hit.entry_id ?? "", hit.content_id ?? "", hit.logical_size ?? null, hit.name ?? "", hit.entry_type ?? ""])]), [hits, workspaceID]);
  const currentMusicViewIdentity = useMemo(() => JSON.stringify([browseScopeIdentity, hostResultsIdentity, mode, selectedGroup ?? "", selectedArtistAlbum ?? "", artistTracksView, query, sortField, sortDirection, eligibilityFilter, selectedTagFilters, onlySelectedTracks, formatFilter, yearFilter]), [artistTracksView, browseScopeIdentity, eligibilityFilter, formatFilter, hostResultsIdentity, mode, onlySelectedTracks, query, selectedArtistAlbum, selectedGroup, selectedTagFilters, sortDirection, sortField, yearFilter]);
  const currentTrackRecoveryGuardRef = useRef({ workspaceID, playbackIdentity, viewIdentity: currentMusicViewIdentity });
  const clearedMusicViewIdentity = useMemo(() => JSON.stringify([browseScopeIdentity, hostResultsIdentity, "tracks", "", "", false, "", sortField, sortDirection, "all", [], false, "all", "all"]), [browseScopeIdentity, hostResultsIdentity, sortDirection, sortField]);
  const currentLoadedHit = currentPlayback && workspaceID
    ? hits.find((hit) => matchesCurrentPlayback(hit, currentPlayback, workspaceID) && mediaClassFromSuffix((hit.name || "").split(".").pop() || "") === "audio")
    : undefined;
  const currentRow = currentPlayback && showingTrackRows
    ? trackRows.find((row) => matchesCurrentPlayback(row.hit, currentPlayback, workspaceID))
    : undefined;

  useLayoutEffect(() => () => {
    currentTrackRecoveryRef.current = null;
    if (currentTrackRecoveryFrameRef.current !== null) cancelAnimationFrame(currentTrackRecoveryFrameRef.current);
    currentTrackRecoveryFrameRef.current = null;
  }, []);
  useLayoutEffect(() => {
    currentTrackRecoveryGuardRef.current = { workspaceID, playbackIdentity, viewIdentity: currentMusicViewIdentity };
    const intent = currentTrackRecoveryRef.current;
    if (intent && (intent.workspaceID !== workspaceID || intent.playbackIdentity !== playbackIdentity || intent.expectedViewIdentity !== currentMusicViewIdentity)) {
      currentTrackRecoveryRef.current = null;
      if (currentTrackRecoveryFrameRef.current !== null) cancelAnimationFrame(currentTrackRecoveryFrameRef.current);
      currentTrackRecoveryFrameRef.current = null;
    }
  }, [currentMusicViewIdentity, playbackIdentity, workspaceID]);
  useEffect(() => {
    const intent = currentTrackRecoveryRef.current;
    if (!intent) return undefined;
    if (intent.workspaceID !== workspaceID || intent.playbackIdentity !== playbackIdentity || currentMusicViewIdentity !== intent.expectedViewIdentity) {
      currentTrackRecoveryRef.current = null;
      return undefined;
    }
    const recoveredRow = currentPlayback
      ? trackRows.find((row) => matchesCurrentPlayback(row.hit, currentPlayback, workspaceID))
      : undefined;
    if (!recoveredRow) {
      currentTrackRecoveryRef.current = null;
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      currentTrackRecoveryFrameRef.current = null;
      const guard = currentTrackRecoveryGuardRef.current;
      if (currentTrackRecoveryRef.current !== intent || intent.workspaceID !== guard.workspaceID || intent.playbackIdentity !== guard.playbackIdentity || guard.viewIdentity !== intent.expectedViewIdentity) return;
      const row = props.libraryListRef.current?.querySelector<HTMLElement>(`.music-track[data-result-index="${recoveredRow.index}"]`);
      if (!row || row.getAttribute("data-subject-ref") !== (recoveredRow.hit.subject_ref ?? "")) {
        currentTrackRecoveryRef.current = null;
        return;
      }
      currentTrackRecoveryRef.current = null;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.querySelector<HTMLButtonElement>(".music-track-main")?.focus({ preventScroll: true });
    });
    currentTrackRecoveryFrameRef.current = frame;
    return () => {
      cancelAnimationFrame(frame);
      if (currentTrackRecoveryFrameRef.current === frame) currentTrackRecoveryFrameRef.current = null;
    };
  }, [currentMusicViewIdentity, currentPlayback, playbackIdentity, props.libraryListRef, trackRows, workspaceID]);
  const metadataReady = props.metadata?.status === "ready";
  const groupPositionSignature = useMemo(() => JSON.stringify([query, sortField, sortDirection, eligibilityFilter, selectedTagFilters, onlySelectedTracks, formatFilter, yearFilter]), [eligibilityFilter, formatFilter, onlySelectedTracks, query, selectedTagFilters, sortDirection, sortField, yearFilter]);
  const groupBrowsePosition = useBrowsePosition({
    slotKey: `music:${mode}:groups`, signature: groupPositionSignature,
    containerRef: groupListRef, ready: !selectedGroup && (mode === "artists" || mode === "albums") && metadataReady,
    restoreKey: groupPositionSignature, anchorSelector: ".music-group-card[data-browse-key]",
  });
  const artistAlbumBrowsePosition = useBrowsePosition({
    slotKey: "music:artist-albums", signature: JSON.stringify([groupPositionSignature, selectedGroup ?? ""]),
    containerRef: groupListRef, ready: mode === "artists" && Boolean(selectedGroup) && !selectedArtistAlbum && !artistTracksView && metadataReady,
    restoreKey: JSON.stringify([groupPositionSignature, selectedGroup ?? ""]), anchorSelector: ".music-group-card[data-browse-key]",
  });
  const trackPositionSignature = useMemo(() => JSON.stringify([mode, selectedGroup ?? "", selectedArtistAlbum ?? "", artistTracksView, query, sortField, sortDirection, eligibilityFilter, selectedTagFilters, onlySelectedTracks, formatFilter, yearFilter]), [artistTracksView, eligibilityFilter, formatFilter, mode, onlySelectedTracks, query, selectedArtistAlbum, selectedGroup, selectedTagFilters, sortDirection, sortField, yearFilter]);
  const trackBrowsePosition = useBrowsePosition({
    slotKey: selectedGroup ? "music:group-tracks" : "music:tracks", signature: trackPositionSignature,
    containerRef: props.libraryListRef, ready: showingTrackRows && (!selectedGroup || metadataReady),
    restoreKey: trackPositionSignature, anchorSelector: ".music-track[data-subject-ref]",
  });
  const open = (row: MusicRow, event: Parameters<Props["onRowClick"]>[1]) => {
    if (event.shiftKey) { event.preventDefault(); selectVisibleRange(row); return; }
    if (event.metaKey || event.ctrlKey) establishRangeAnchor(row);
    props.onRowClick(row.index, event);
  };
  const handleListKeyDown: Props["onKeyDown"] = (event) => {
    if (!(event.target as HTMLElement | null)?.closest(".result-open-copy")) return;
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.key === " ") {
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      if (keyEvent.repeat) return;
      const sourceIndex = Number((event.target as HTMLElement).closest(".music-track")?.getAttribute("data-result-index"));
      const row = trackRows.find((candidate) => candidate.index === sourceIndex);
      if (!row) return;
      if (keyEvent.shiftKey) selectVisibleRange(row);
      else { props.onToggleSelection(row.index); establishRangeAnchor(row); }
      return;
    }
    if ((keyEvent.metaKey || keyEvent.ctrlKey) && !keyEvent.altKey && keyEvent.key.toLowerCase() === "a" && props.onSelectSubjects) {
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      props.onSelectSubjects(displayedTrackHits, "add");
      return;
    }
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
  const enterGroup = (nextMode: "artists" | "albums", key: string, label?: string, artist?: string) => {
    groupBrowsePosition.capture();
    trackBrowsePosition.capture();
    const sourceGroups = nextMode === "artists" ? allArtistGroups : allAlbumGroups;
    const factsGroup = sourceGroups.find((group) => group.key === key);
    setMode(nextMode);
    setSelectedGroup(key);
    setSelectedArtistAlbum(undefined);
    setArtistTracksView(false);
    setSelectedGroupFacts({ key, label: factsGroup?.label || label || "", artist: factsGroup?.artist || artist });
    requestAnimationFrame(() => detailHeadingRef.current?.focus());
  };
  const enterArtistAlbum = (key: string, label: string) => {
    artistAlbumBrowsePosition.capture();
    trackBrowsePosition.capture();
    setSelectedArtistAlbum(key);
    setSelectedArtistAlbumLabel({ key, label, scope: browseScopeIdentity });
    setArtistTracksView(false);
    requestAnimationFrame(() => detailHeadingRef.current?.focus());
  };
  const showArtistTracks = () => {
    artistAlbumBrowsePosition.capture();
    setSelectedArtistAlbum(undefined);
    setArtistTracksView(true);
    requestAnimationFrame(() => detailHeadingRef.current?.focus());
  };
  const returnToArtistAlbums = () => {
    trackBrowsePosition.capture();
    const key = selectedArtistAlbum;
    setSelectedArtistAlbum(undefined);
    setArtistTracksView(false);
    requestAnimationFrame(() => {
      const openButton = key ? groupOpenButtons.current.get(key) : undefined;
      if (openButton) openButton.focus();
      else groupListRef.current?.focus();
    });
  };
  const returnToGroupList = () => {
    trackBrowsePosition.capture();
    if (mode === "artists" && selectedArtistAlbum) { returnToArtistAlbums(); return; }
    if (mode === "artists" && artistTracksView) {
      setArtistTracksView(false);
      requestAnimationFrame(() => artistTracksButtonRef.current?.focus());
      return;
    }
    const key = selectedGroup;
    setSelectedGroup(undefined);
    setSelectedArtistAlbum(undefined);
    setArtistTracksView(false);
    setSelectedGroupFacts(undefined);
    requestAnimationFrame(() => {
      const openButton = key ? groupOpenButtons.current.get(key) : undefined;
      if (openButton) openButton.focus();
      else groupListRef.current?.focus();
    });
  };
  const returnToArtistList = () => {
    groupBrowsePosition.capture();
    artistAlbumBrowsePosition.capture();
    trackBrowsePosition.capture();
    const key = selectedGroup;
    setSelectedGroup(undefined);
    setSelectedArtistAlbum(undefined);
    setArtistTracksView(false);
    setSelectedGroupFacts(undefined);
    requestAnimationFrame(() => {
      const openButton = key ? groupOpenButtons.current.get(key) : undefined;
      if (openButton) openButton.focus();
      else groupListRef.current?.focus();
    });
  };
  const locateCurrentTrack = () => {
    if (!currentRow) return;
    const row = props.libraryListRef.current?.querySelector<HTMLElement>(`.music-track[data-result-index="${currentRow.index}"]`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    row?.querySelector<HTMLButtonElement>(".music-track-main")?.focus({ preventScroll: true });
  };
  const clearMusicFiltersAndShowCurrentTrack = () => {
    if (!currentPlayback || !currentLoadedHit || !workspaceID) return;
    currentTrackRecoveryRef.current = { workspaceID, playbackIdentity, expectedViewIdentity: clearedMusicViewIdentity };
    setMode("tracks");
    setSelectedGroup(undefined);
    setSelectedArtistAlbum(undefined);
    setArtistTracksView(false);
    setSelectedGroupFacts(undefined);
    setQuery("");
    setEligibilityFilter("all");
    setFormatFilter("all");
    setSelectedTagFilters([]);
    setOnlySelectedTracks(false);
    setYearFilter("all");
  };
  const selectedArtistLabel = activeGroup?.label || (selectedGroupFacts && selectedGroupFacts.key === selectedGroup ? selectedGroupFacts.label : "") || t("Unknown artist");
  const selectedAlbumLabel = (mode === "artists" ? activeArtistAlbum?.label : activeGroup?.label) || (selectedArtistAlbum && selectedArtistAlbumLabel?.key === selectedArtistAlbum && selectedArtistAlbumLabel.scope === browseScopeIdentity ? selectedArtistAlbumLabel.label : "") || (mode !== "artists" && selectedGroupFacts && selectedGroupFacts.key === selectedGroup ? selectedGroupFacts.label : "") || t("Unknown album");
  const artistAlbumLanding = mode === "artists" && Boolean(selectedGroup) && !selectedArtistAlbum && !artistTracksView;
  const detailTrackCount = artistAlbumLanding ? artistTrackRows.length : trackRows.length;

  return <section className="music-library" aria-label={t("Music library")} aria-busy={groupFactsPending}>
    <header className="music-library-heading">
      <div className="music-library-heading__copy">
        <h1>{t("Music")}</h1>
        {!groupFactsPending && <p className="music-library-heading__count">{t("{{count}} tracks in this view", { count: artistAlbumLanding ? artistTrackRows.length : trackRows.length })}</p>}
      </div>
    </header>
    <div className="music-library__toolbar">
      <nav className="music-browse-modes" aria-label={t("Browse music")}>
        {(["tracks", "artists", "albums"] as const).map((nextMode) => <button key={nextMode} type="button" aria-pressed={mode === nextMode} onClick={() => { groupBrowsePosition.capture(); artistAlbumBrowsePosition.capture(); trackBrowsePosition.capture(); setMode(nextMode); setSelectedGroup(undefined); setSelectedArtistAlbum(undefined); setArtistTracksView(false); setSelectedGroupFacts(undefined); }}>{t(nextMode === "tracks" ? "Tracks" : nextMode === "artists" ? "Artists" : "Albums")}</button>)}
      </nav>
      <label className="music-browse-search"><Search aria-hidden="true" /><span className="sr-only">{t("Search music")}</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedGroup(undefined); setSelectedArtistAlbum(undefined); setArtistTracksView(false); setSelectedGroupFacts(undefined); }} placeholder={t("Filter music in this view")} /></label>
      <details className="music-tag-filters">
        <summary>{t("Filters and sort")}{(selectedTagFilters.length || onlySelectedTracks || formatFilter !== "all" || query.trim() || eligibilityFilter !== "all" || yearFilter !== "all" || sortField !== "original") ? ` · ${selectedTagFilters.length + Number(onlySelectedTracks) + Number(formatFilter !== "all") + Number(Boolean(query.trim())) + Number(eligibilityFilter !== "all") + Number(yearFilter !== "all") + Number(sortField !== "original")}` : ""}</summary>
        <div className="music-tag-filters__panel">
          <label className="music-local-filter"><span>{t("Availability")}</span><select value={eligibilityFilter} onChange={(event) => { setEligibilityFilter(event.target.value as typeof eligibilityFilter); setFocusedIndex(undefined); }}><option value="all">{t("All tracks")}</option><option value="playable">{t("Eligible for playback")}</option><option value="original-only">{t("Unavailable for playback")}</option></select></label>
          <label className="music-local-filter"><span>{t("Sort by")}</span><select value={sortField} onChange={(event) => setSort(event.target.value as MusicSortField)}><option value="original">{t("Library order")}</option><option value="title">{t("Title")}</option><option value="artist">{t("Artist")}</option><option value="album">{t("Album")}</option><option value="track">{t("Track number")}</option><option value="duration">{t("Duration")}</option><option value="size">{t("File size")}</option></select></label>
          {sortField !== "original" && <button className="music-sort-direction" type="button" aria-label={t(sortDirection === "asc" ? "Sort descending" : "Sort ascending")} onClick={() => setSortDirection((direction) => direction === "asc" ? "desc" : "asc")}>{t(sortDirection === "asc" ? "Ascending" : "Descending")}</button>}
          <p>{t("Tags use AND matching across distinct subjects in the loaded music view.")}</p>
          <label className="music-local-filter"><span>{t("Filename suffix")}</span><select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value)}><option value="all">{t("All formats")}</option>{loadedFormatCounts.map(([format, count]) => <option key={format} value={format}>{format === NO_FILENAME_EXTENSION ? t("No filename extension") : format.toUpperCase()} · {t("{{count}} loaded tracks", { count })}</option>)}</select></label>
          <p>{t("A filename suffix is only a format clue; it does not verify the file bytes or codec.")}</p>
          <label className="music-local-filter"><span>{t("Recorded year")}</span><select value={yearFilter} disabled={!yearDataReady} onChange={(event) => setYearFilter(event.target.value as MusicYearFilter)}>
            <option value="all">{t("All recorded years")}</option>
            {yearDataReady && (loadedYearCounts.unknown > 0 || yearFilter === "unknown") && <option value="unknown">{t("Unknown year")}{loadedYearCounts.unknown > 0 ? ` · ${t("{{count}} tracks", { count: loadedYearCounts.unknown })}` : ""}</option>}
            {loadedYearCounts.years.map(([year, count]) => <option key={year} value={`year:${year}`}>{year} · {t("{{count}} tracks", { count })}</option>)}
            {yearFilter === "unknown" && !yearDataReady && <option value="unknown">{t("Unknown year")}</option>}
            {yearFilter.startsWith("year:") && !loadedYearCounts.years.some(([year]) => yearFilter === `year:${year}`) && <option value={yearFilter}>{t("Year: {{year}}", { year: yearFilter.slice(5) })}</option>}
          </select></label>
          <label className="music-selected-filter"><input type="checkbox" checked={onlySelectedTracks} onChange={(event) => setOnlySelectedTracks(event.target.checked)} />{t("Show selected tracks only")}</label>
          {selectedTagFilters.length > 0 && <div className="music-tag-filters__active" aria-label={t("Active tag filters")}>
            {selectedTagFilters.map((tag) => <button key={tag} type="button" aria-label={t("Remove tag filter {{tag}}", { tag })} onClick={() => setSelectedTagFilters((current) => current.filter((value) => value !== tag))}>{tag}<span aria-hidden="true"> ×</span></button>)}
          </div>}
          {tagStatus === "loading" && <p role="status">{t("Loading user tags; existing tag filters are retained.")}</p>}
          {tagStatus === "unavailable" && <p role="status">{t("User tags are unavailable; existing tag filters remain active until cleared.")}</p>}
          {tagsReady ? loadedTagCounts.length ? <fieldset>
            <legend>{t("Match every selected tag")}</legend>
            {loadedTagCounts.map(([tag, count]) => <label key={tag}><input type="checkbox" checked={selectedTagFilters.includes(tag)} onChange={(event) => setSelectedTagFilters((current) => event.target.checked ? current.includes(tag) ? current : [...current, tag] : current.filter((value) => value !== tag))} /><span>{tag}</span><small>{t("{{count}} tracks", { count })}</small></label>)}
          </fieldset> : <p>{t("No tags are available in the loaded music view.")}</p> : null}
          <button type="button" disabled={!selectedTagFilters.length && !onlySelectedTracks} onClick={() => { setSelectedTagFilters([]); setOnlySelectedTracks(false); }}>{t("Clear tag and selection filters")}</button>
          {props.metadata?.reload && <button type="button" className="music-refresh-facts" disabled={props.metadata.status === "loading"} onClick={props.metadata.reload}>{t("Refresh music facts")}</button>}
        </div>
      </details>
    </div>
    {(query.trim() || eligibilityFilter !== "all" || formatFilter !== "all" || onlySelectedTracks || selectedTagFilters.length > 0 || yearFilter !== "all") && <div className="music-active-filters" aria-label={t("Active local filters")}>
      <span>{t("Active filters")}</span>
      {query.trim() && <button type="button" aria-label={t("Remove search filter") } onClick={() => setQuery("")}>{t("Search: {{value}}", { value: query.trim() })}<span aria-hidden="true"> ×</span></button>}
      {eligibilityFilter !== "all" && <button type="button" aria-label={t("Remove availability filter")} onClick={() => setEligibilityFilter("all")}>{t("Availability: {{value}}", { value: t(eligibilityFilter === "playable" ? "Eligible for playback" : "Unavailable for playback") })}<span aria-hidden="true"> ×</span></button>}
      {formatFilter !== "all" && <button type="button" aria-label={t("Remove filename suffix filter")} onClick={() => setFormatFilter("all")}>{t("Format: {{value}}", { value: formatFilter === NO_FILENAME_EXTENSION ? t("No filename extension") : formatFilter.toUpperCase() })}<span aria-hidden="true"> ×</span></button>}
      {onlySelectedTracks && <button type="button" aria-label={t("Remove selected tracks filter")} onClick={() => setOnlySelectedTracks(false)}>{t("Selected tracks only")}<span aria-hidden="true"> ×</span></button>}
      {selectedTagFilters.map((tag) => <button key={tag} type="button" aria-label={t("Remove tag filter {{tag}}", { tag })} onClick={() => setSelectedTagFilters((current) => current.filter((value) => value !== tag))}>{t("Tag: {{tag}}", { tag })}<span aria-hidden="true"> ×</span></button>)}
      {yearFilter !== "all" && <button type="button" aria-label={t("Remove recorded-year filter")} onClick={() => setYearFilter("all")}>{t(yearFilter === "unknown" ? "Unknown year" : "Year: {{year}}", { year: yearFilter.startsWith("year:") ? yearFilter.slice(5) : "" })}<span aria-hidden="true"> ×</span></button>}
      <button className="music-active-filters__clear" type="button" onClick={() => { setQuery(""); setEligibilityFilter("all"); setFormatFilter("all"); setSelectedTagFilters([]); setOnlySelectedTracks(false); setYearFilter("all"); setFocusedIndex(undefined); }}>{t("Clear filters")}</button>
    </div>}
    {(props.metadata?.status === "loading" || props.metadata?.status === "unavailable" || (props.metadata?.status === "ready" && (artistAlbumLanding ? artistTrackRows : rows).some((row) => !row.facts)) || (yearFilter !== "all" && !yearDataReady)) && <div className="music-facts-status-row">
      {props.metadata?.status === "loading" && <p className="music-facts-status" role="status">{t("Loading recorded audio facts")}</p>}
      {props.metadata?.status === "unavailable" && <p className="music-facts-status" role="status">{t("Audio facts unavailable; showing filenames and tags")}</p>}
      {yearFilter !== "all" && !yearDataReady && <p className="music-facts-status" role="status">{t("Recorded year facts are unavailable; this filter is retained and no tracks are shown until facts are ready.")}</p>}
      {props.metadata?.status === "ready" && (artistAlbumLanding ? artistTrackRows : rows).some((row) => !row.facts) && <p className="music-facts-status" role="status">{t("Some tracks have no recorded audio facts; their filenames remain available")}</p>}
    </div>}
    {selectedGroup && <header className="music-group-detail-heading">
      <nav className="music-breadcrumbs" aria-label={t("Music path")}>
        {mode === "artists" ? <>
          <button type="button" onClick={returnToArtistList}>{t("Artists")}</button><span aria-hidden="true">›</span>
          {selectedArtistAlbum || artistTracksView ? <><button type="button" onClick={returnToArtistAlbums}>{selectedArtistLabel}</button><span aria-hidden="true">›</span><span aria-current="page">{selectedArtistAlbum ? selectedAlbumLabel : t("All tracks")}</span></> : <span aria-current="page">{selectedArtistLabel}</span>}
        </> : <>
          <button type="button" onClick={returnToGroupList}>{t("Albums")}</button><span aria-hidden="true">›</span><span aria-current="page">{selectedAlbumLabel}</span>
        </>}
      </nav>
      <div><h2 ref={detailHeadingRef} tabIndex={-1}>{selectedArtistAlbum ? selectedAlbumLabel : mode === "artists" ? selectedArtistLabel : selectedAlbumLabel}</h2>{((mode === "albums" && activeGroup?.artist) || (mode === "artists" && selectedArtistAlbum && activeArtistAlbum?.artist)) && <p>{t("by {{artist}}", { artist: mode === "artists" ? activeArtistAlbum?.artist || selectedArtistLabel : activeGroup?.artist || "" })}</p>}</div>
      {!groupFactsPending && <p className="music-group-detail-count">{t("{{count}} tracks in this loaded view", { count: detailTrackCount })}</p>}
      {(mode === "albums" || selectedArtistAlbum) && (mode === "artists" ? activeArtistAlbum?.rows.some((row) => row.facts?.artist) : activeGroup?.rows.some((row) => row.facts?.artist)) && <p className="music-group-detail-note">{t("Album facts are grouped by the recorded artist where available.")}</p>}
      {trackRows.length > 0 && <p className="music-group-detail-duration">{groupDurationSummary(trackRows, t, props.locale)}</p>}
      {!trackRows.length && eligibilityFilter !== "all" && <button type="button" className="music-clear-group-filter" onClick={() => setEligibilityFilter("all")}>{t("Clear availability filter")}</button>}
    </header>}
    {currentPlayback && <aside className="music-current-playback" aria-label={t("Current track")}>
      {currentPlayback.artworkURL && <img className="music-current-playback__artwork" src={currentPlayback.artworkURL} alt="" aria-hidden="true" />}
      <div className="music-current-playback__copy">
        <span>{t("Current track")}</span>
        <strong>{currentPlayback.name}</strong>
        <small>{playbackStatusText(currentPlayback.status, t)}{!currentRow ? ` · ${t(currentLoadedHit ? "The current track is outside the displayed tracks." : "The current track is not in the loaded music results; playback controls remain available.")}` : ""}</small>
      </div>
      {currentRow && <button type="button" onClick={locateCurrentTrack}>{t("Show current track")}</button>}
      {currentLoadedHit && !currentRow && <button type="button" onClick={clearMusicFiltersAndShowCurrentTrack}>{t("Clear music filters and show current track")}</button>}
    </aside>}
    {/* One primary Play action stays visible; queue, shuffle, batch and takeout
        actions remain available in the closed menu. */}
    <div className="music-queue-actions" role="group" aria-label={t("Music queue actions")}>
      {showingTrackRows && (selectedPlayable.length > 0 || displayedPlayable.length > 0) && <div className="music-action-group">
        {selectedPlayable.length > 0
          ? <button className="music-play-displayed" type="button" disabled={!props.onPlayTracks} onClick={() => props.onPlayTracks?.(selectedPlayable)}>{t("Play selected ({{count}})", { count: selectedPlayable.length })}</button>
          : <button className="music-play-displayed" type="button" disabled={!props.onPlayTracks} onClick={() => props.onPlayTracks?.(displayedPlayable)}>{t("Play these tracks ({{count}})", { count: displayedPlayable.length })}</button>}
      </div>}
      <div className="music-queue-secondary">
        {(props.queueControls || (showingTrackRows && (displayedPlayable.length > 0 || displayedTrackHits.length > 0) && (props.onCreateMaterialList || props.onDownloadOriginals || displayedPlayable.length > 0))) && <details className="music-displayed-actions">
          <summary aria-label={t("More playback actions")} title={t("More playback actions")}><MoreHorizontal size={18} aria-hidden="true" /><span className="sr-only">{t("More playback actions")}</span></summary>
          <div className="music-displayed-actions__menu">
            {displayedPlayable.length > 0 && selectedPlayable.length > 0 && <button type="button" disabled={!props.onPlayTracks} onClick={() => props.onPlayTracks?.(displayedPlayable)}>{t("Play these tracks ({{count}})", { count: displayedPlayable.length })}</button>}
            {displayedPlayable.length > 0 && <button type="button" disabled={!props.onPlayTracks} onClick={() => randomize(selectedPlayable.length > 0 ? selectedPlayable : displayedPlayable)}>{t(selectedPlayable.length > 0 ? "Shuffle selected ({{count}})" : "Shuffle these tracks ({{count}})", { count: selectedPlayable.length > 0 ? selectedPlayable.length : displayedPlayable.length })}</button>}
            {displayedPlayable.length > 0 && <>
              <button type="button" disabled={!props.queueControls} onClick={() => props.queueControls?.addTracks(displayedPlayable)}>{t("Add to queue ({{count}})", { count: displayedPlayable.length })}</button>
              <button type="button" disabled={!props.queueControls?.addNextTracks} onClick={() => props.queueControls?.addNextTracks?.(displayedPlayable)}>{t("Play these tracks next ({{count}})", { count: displayedPlayable.length })}</button>
            </>}
            {selectedPlayable.length > 0 && <>
              <button type="button" disabled={!props.queueControls} onClick={() => props.queueControls?.addTracks(selectedPlayable)}>{t("Add selected to queue ({{count}})", { count: selectedPlayable.length })}</button>
              <button type="button" disabled={!props.queueControls?.addNextTracks} onClick={() => props.queueControls?.addNextTracks?.(selectedPlayable)}>{t("Play next selected ({{count}})", { count: selectedPlayable.length })}</button>
            </>}
            {props.onSelectSubjects && showingTrackRows && <>
              <button type="button" disabled={!displayedTrackHits.length} onClick={() => props.onSelectSubjects?.(displayedTrackHits, "add")}>{t("Select current tracks ({{count}})", { count: displayedTrackHits.length })}</button>
              <button type="button" disabled={!displayedTrackHits.length} onClick={() => props.onSelectSubjects?.(displayedTrackHits, "invert")}>{t("Invert selection in current tracks ({{count}})", { count: displayedTrackHits.length })}</button>
              <button type="button" disabled={!selectedDisplayedHits.length} onClick={() => props.onSelectSubjects?.(selectedDisplayedHits, "remove")}>{t("Clear selection in current tracks ({{count}})", { count: selectedDisplayedHits.length })}</button>
            </>}
            {props.onCreateMaterialList && showingTrackRows && <>
              <button className="music-save-list" type="button" disabled={!selectedDisplayedHits.length || !materialListSelectionValid || props.materialListCreationDisabled} onClick={() => props.onCreateMaterialList?.(selectedDisplayedHits)}>{t("Save selected tracks as list ({{count}})", { count: selectedDisplayedHits.length })}</button>
              <button className="music-save-list" type="button" disabled={!materialListSelectionEligible(displayedTrackHits) || props.materialListCreationDisabled} onClick={() => props.onCreateMaterialList?.(displayedTrackHits)}>{t("Save displayed tracks as list ({{count}})", { count: displayedTrackHits.length })}</button>
              <small className="music-list-scope-note">{t("Lists use selected or displayed tracks only, up to 200; off-view selections and repeated queue entries are excluded.")}</small>
            </>}
            {props.onDownloadOriginals && showingTrackRows && <>
              <button type="button" disabled={!selectedDisplayedHits.length || props.originalTakeoutBusy} onClick={() => props.onDownloadOriginals?.(selectedDisplayedHits)}>{t("Download selected originals ZIP ({{count}})", { count: selectedDisplayedHits.length })}</button>
              <button type="button" disabled={!displayedTrackHits.length || props.originalTakeoutBusy} onClick={() => props.onDownloadOriginals?.(displayedTrackHits)}>{t("Download current originals ZIP ({{count}})", { count: displayedTrackHits.length })}</button>
            </>}
            {props.queueControls && <button type="button" className="music-open-queue" onClick={() => props.queueControls?.show()}>{t("Queue ({{count}})", { count: props.queueControls?.count ?? 0 })}</button>}
          </div>
        </details>}
      </div>
      {showingTrackRows && (displayedPlayable.length < trackRows.length || selectedDisplayedRows.length > selectedPlayable.length || selectionOutsideDisplayedCount > 0) && <div className="music-action-notes">
        {displayedPlayable.length < trackRows.length && <small>{t("Skipped {{count}} unsupported or unavailable displayed tracks", { count: trackRows.length - displayedPlayable.length })}</small>}
        {selectedDisplayedRows.length > selectedPlayable.length && <small>{t("Skipped {{count}} selected displayed tracks that are unsupported or unavailable", { count: selectedDisplayedRows.length - selectedPlayable.length })}</small>}
        {selectionOutsideDisplayedCount > 0 && <small>{t("{{count}} selected row(s) outside the displayed tracks are not included", { count: selectionOutsideDisplayedCount })}</small>}
      </div>}
    </div>
    {mode === "artists" && !selectedGroup ? <GroupList groups={artistGroups} listRef={groupListRef} registerOpenButton={groupOpenButtons.current} countLabel={t("tracks")} t={t} workspaceID={workspaceID} queueControls={props.queueControls} onSelectSubjects={props.onSelectSubjects} onDownloadOriginals={props.onDownloadOriginals} originalTakeoutBusy={props.originalTakeoutBusy} selectionRefs={selectedRefs} onSelect={(key, label) => enterGroup("artists", key, label)} onPlay={props.onPlayTracks ? (tracks) => props.onPlayTracks?.(tracks) : undefined} /> : mode === "albums" && !selectedGroup ? <GroupList groups={albumGroups} listRef={groupListRef} registerOpenButton={groupOpenButtons.current} countLabel={t("tracks")} t={t} workspaceID={workspaceID} queueControls={props.queueControls} onSelectSubjects={props.onSelectSubjects} onDownloadOriginals={props.onDownloadOriginals} originalTakeoutBusy={props.originalTakeoutBusy} selectionRefs={selectedRefs} showArtist onSelect={(key, label, artist) => enterGroup("albums", key, label, artist)} onPlay={props.onPlayTracks ? (tracks) => props.onPlayTracks?.(tracks) : undefined} /> : artistAlbumLanding ? <div className="music-artist-detail">
      <GroupList groups={artistAlbumGroups} listRef={groupListRef} registerOpenButton={groupOpenButtons.current} countLabel={t("tracks")} t={t} workspaceID={workspaceID} queueControls={props.queueControls} onSelectSubjects={props.onSelectSubjects} onDownloadOriginals={props.onDownloadOriginals} originalTakeoutBusy={props.originalTakeoutBusy} selectionRefs={selectedRefs} onSelect={(key, label) => enterArtistAlbum(key, label)} onPlay={props.onPlayTracks ? (tracks) => props.onPlayTracks?.(tracks) : undefined} />
      {!groupFactsPending && <button ref={artistTracksButtonRef} className="music-artist-all-tracks" type="button" onClick={showArtistTracks}>{t("All tracks by {{artist}} ({{count}})", { artist: selectedArtistLabel, count: artistTrackRows.length })}</button>}
    </div> : showingTrackRows && trackRows.length ? <div ref={props.libraryListRef} className="music-track-list result-list list-mode" role="group" aria-label={t("Library results")} aria-description={t("Use the arrow keys to move through visible tracks; Space selects and Enter opens the focused track. Shift+Space selects the visible range.")} data-selection-count={props.selectionCount} onKeyDown={handleListKeyDown} onFocusCapture={(event) => { const index = Number((event.target as HTMLElement).closest(".music-track")?.getAttribute("data-result-index")); if (Number.isSafeInteger(index)) setFocusedIndex(index); }}>
      {trackRows.map((row) => <TrackRow key={row.hit.subject_ref || row.hit.entry_id || row.hit.name} row={row} props={{ ...props, focusedSubjectRef: locatedSubject }} facts={row.facts} open={open} tabIndex={row.index === rovingIndex ? 0 : -1} onEnterGroup={enterGroup} onToggleSelection={(index) => { props.onToggleSelection(index); establishRangeAnchor(row); }} onRangeSelect={() => selectVisibleRange(row)} />)}
    </div> : groupFactsPending ? null : selectedGroup ? <div className="music-empty"><Music2 /><h2>{t("No tracks match this group in the current view")}</h2><p>{eligibilityFilter !== "all" ? t("Clear the playback availability filter to see all tracks in this group.") : yearFilter !== "all" ? t("Clear the recorded-year filter to see other tracks in this group.") : t("This group has no matching tracks in the current loaded view.")}</p></div> : <div className="music-empty"><Music2 /><h2>{t(onlySelectedTracks ? "No selected tracks match these filters" : selectedTagFilters.length ? "No tracks match the selected tags" : formatFilter !== "all" ? "No tracks match this filename suffix filter" : yearFilter !== "all" ? "No tracks match the recorded-year filter" : query.trim() ? "No tracks match this search" : eligibilityFilter !== "all" ? "No tracks in this availability filter" : "No audio tracks in the loaded listing")}</h2><p>{t("Track names come from original filenames. Metadata and artwork are shown only when real facts are available.")}</p></div>}
    <details className="music-playback-limits"><summary>{t("Playback and format details")}</summary><p>{t("Playback downloads and verifies the complete original first. It supports common browser audio formats up to 32 MiB; seeking starts after verification. Larger or unavailable files can still be downloaded from Details.")}</p></details>
  </section>;
}
