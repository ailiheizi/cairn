import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, SyntheticEvent } from "react";
import { ArrowDown, ArrowUp, Maximize2, Music2, Pause, Play, Repeat, Repeat1, Search, Shuffle, SkipBack, SkipForward, Square, X } from "lucide-react";
import type { useAudioPlayback } from "../app/useAudioPlayback";
import type { Translator } from "../i18n";
import { sameQueueOccurrence } from "../lib/playbackQueue";
import "./AudioPlayer.css";

type Playback = ReturnType<typeof useAudioPlayback>;
const ALLOWED_PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

// Playback failures reach the player as internal codes (`unsupported-format`,
// `hash-mismatch`, `download-failed-<status>`, …) carried by the state machine.
// The player is the one place that turns a code into a human-readable sentence,
// and the sentence IS the message key handed to `t()`: English renders it
// unchanged (createTranslator has no separate English catalogue) and zh-CN
// resolves it through the catalogs keyed byte-identically to these strings. Keep
// this table and `web/src/i18n/musicExperience.ts` / `queueExperience.ts` in
// step; a code with no entry must never reach the user as a bare token.
type PlaybackErrorText = { message: string; values?: Record<string, string | number> };
const PLAYBACK_ERROR_TEXTS: Record<string, string> = {
  "unsupported-format": "This audio format is not supported for browser playback. Open Details to download the original.",
  "identity-unavailable": "The original has no verified identity information.",
  "size-limit": "The original is larger than the 32 MiB playback limit.",
  "length-mismatch": "The original length does not match the recorded length.",
  "hash-mismatch": "The original failed its SHA-256 verification.",
  "empty-response": "The download returned no original data.",
  "playback-permission": "The browser blocked playback. Choose Play again to allow it.",
  "playback-failed": "This original could not be played.",
  "workspace-mismatch": "This track is from content other than what is open here.",
  "track-unavailable": "The identity, format, or size of this track does not meet the playback conditions.",
};
const PLAYBACK_ERROR_FALLBACK = "Playback failed. Open Details to download the original.";
// A code-shaped token is an internal name, not an outcome; an unrecognised one
// gets the explicit generic sentence above instead of leaking to the operator.
// Free-form prose (a server reason or a browser message) is already readable and
// is passed through unchanged rather than flattened into a vaguer sentence.
const PLAYBACK_ERROR_CODE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const DOWNLOAD_FAILED = /^download-failed-(\d+)$/;
function playbackErrorText(error: string): PlaybackErrorText {
  const known = PLAYBACK_ERROR_TEXTS[error];
  if (known) return { message: known };
  const download = DOWNLOAD_FAILED.exec(error);
  if (download) return { message: "The original could not be downloaded (HTTP {{status}}).", values: { status: download[1] } };
  if (PLAYBACK_ERROR_CODE.test(error)) return { message: PLAYBACK_ERROR_FALLBACK };
  return { message: error };
}

function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const value = Math.floor(seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function AudioPlayer({ playback, t, onOpenDetails }: { playback: Playback; t: Translator; onOpenDetails?: (track: NonNullable<Playback["track"]>) => boolean | void }) {
  const queuePanelRef = useRef<HTMLDivElement>(null);
  const queueSummaryRef = useRef<HTMLElement>(null);
  const queueHeadingRef = useRef<HTMLElement>(null);
  const queueFilterRef = useRef<HTMLInputElement>(null);
  const queueBatchRef = useRef<HTMLDetailsElement>(null);
  const currentActionsRef = useRef<HTMLDetailsElement>(null);
  const currentActionsSummaryRef = useRef<HTMLElement>(null);
  const optionsRef = useRef<HTMLDetailsElement>(null);
  const optionsSummaryRef = useRef<HTMLElement>(null);
  const immersiveRoomRef = useRef<HTMLElement>(null);
  const immersiveDialogRef = useRef<HTMLElement>(null);
  const immersiveOpenButtonRef = useRef<HTMLButtonElement>(null);
  const queueWasOpenBeforeImmersiveRef = useRef(false);
  const wasQueueOpenRef = useRef(false);
  const queueHadPanelFocusRef = useRef(false);
  const [queueFilter, setQueueFilter] = useState("");
  const [selectedOccurrenceIDs, setSelectedOccurrenceIDs] = useState<Set<string>>(() => new Set());
  const [detailsUnavailable, setDetailsUnavailable] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const duration = Number.isFinite(playback.duration) ? playback.duration : 0;
  const playbackControlsDisabled = !playback.url || playback.loading || playback.starting;
  const errorStatus = playback.error ? playbackErrorText(playback.error) : undefined;
  const error = errorStatus && t(errorStatus.message, errorStatus.values);
  // Keep the announcement node mounted before any error/notice arrives. Adding
  // aria-live at the same time as its text is less reliable for assistive tech.
  // The visible lifecycle line below remains separate, so routine transitions
  // are never announced; loading also clears stale errors/notices here.
  const announcement = playback.loading || playback.starting ? "" : error || (playback.sleepTimerNotice ? t(playback.sleepTimerNotice) : playback.queueNotice ? t(playback.queueNotice) : "");
  const currentTitle = playback.track?.displayTitle || playback.track?.name;
  const miniStatus = playback.loading ? t("Loading and verifying original") : playback.starting ? t("Starting audio…") : error || (playback.sleepTimerNotice ? t(playback.sleepTimerNotice) : playback.queueNotice ? t(playback.queueNotice) : playback.track ? "" : t("Ready"));
  const sleepTimerRemaining = playback.sleepTimerMinutes === undefined || playback.sleepTimerRemainingMs === undefined
    ? undefined
    : playback.sleepTimerRemainingMs < 60_000
      ? t("Less than 1 minute remaining")
      : t("Sleep timer: {{count}} min remaining", { count: Math.max(1, Math.ceil(playback.sleepTimerRemainingMs / 60_000)) });
  const retryDisabled = playback.loading || playback.starting || !playback.error || [
    "playback-permission",
    "workspace-mismatch",
    "track-unavailable",
    "identity-unavailable",
    "size-limit",
    "unsupported-format",
  ].includes(playback.error);
  const showRetry = Boolean(playback.track && !playback.url && (playback.loading || playback.error));
  const currentSecondary = playback.track ? [
    playback.track.displayArtist,
    playback.track.displayAlbum,
    playback.track.displayTitle && playback.track.displayTitle !== playback.track.name ? playback.track.name : undefined,
  ].filter(Boolean).join(" · ") || undefined : undefined;
  const queueNeedle = queueFilter.trim().toLocaleLowerCase();
  const visibleQueueEntries = useMemo(() => playback.queue.flatMap((entry, index) => {
    const searchable = [entry.displayTitle, entry.name, entry.displayArtist, entry.displayAlbum].filter(Boolean).join(" ").toLocaleLowerCase();
    return !queueNeedle || searchable.includes(queueNeedle) ? [{ entry, position: index + 1 }] : [];
  }), [playback.queue, queueNeedle]);
  const activeQueueEntry = playback.track ? playback.queue.find((entry) => sameQueueOccurrence(entry, playback.track!)) : undefined;
  const activeQueueIndex = activeQueueEntry ? playback.queue.indexOf(activeQueueEntry) : -1;
  const currentQueueTrackHidden = Boolean(activeQueueEntry && !visibleQueueEntries.some(({ entry }) => sameQueueOccurrence(entry, activeQueueEntry)));
  const selectedVisibleEntries = visibleQueueEntries.filter(({ entry }) => selectedOccurrenceIDs.has(entry.occurrenceID));
  const selectedInactiveEntries = selectedVisibleEntries.filter(({ entry }) => !playback.track || !sameQueueOccurrence(playback.track, entry));
  const selectedActiveCount = selectedVisibleEntries.length - selectedInactiveEntries.length;
  const trackOccurrence = playback.track
    ? (("occurrenceID" in playback.track ? playback.track.occurrenceID : undefined) || `${playback.track.workspaceID}\u0000${playback.track.entryID}\u0000${playback.track.contentID}`)
    : "";
  const isCurrentSource = (audio: HTMLAudioElement) => Boolean(playback.url && audio.currentSrc === playback.url);
  const immersiveTitle = playback.track?.displayTitle || playback.track?.name || t("Nothing playing");
  const openImmersive = () => {
    if (!playback.track) return;
    queueWasOpenBeforeImmersiveRef.current = playback.queueOpen;
    if (playback.queue.length > 0 && !playback.queueOpen) playback.setQueueOpen(true);
    setImmersive(true);
  };
  const closeImmersive = () => {
    if (!queueWasOpenBeforeImmersiveRef.current && playback.queueOpen) playback.setQueueOpen(false);
    setImmersive(false);
  };
  const handleImmersiveKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeImmersive();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = immersiveDialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [href], [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      immersiveRoomRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };
  useEffect(() => {
    if (!immersive) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => immersiveRoomRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => immersiveOpenButtonRef.current?.focus());
    };
  }, [immersive]);
  const onQueueToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const open = event.currentTarget.open;
    if (!open) { setQueueFilter(""); setSelectedOccurrenceIDs(new Set()); }
    if (open !== playback.queueOpen) playback.setQueueOpen(open);
  };
  const openCurrentDetails = () => {
    if (!playback.track || !onOpenDetails) return;
    const opened = onOpenDetails(playback.track) !== false;
    setDetailsUnavailable(!opened);
    if (opened) {
      if (currentActionsRef.current) currentActionsRef.current.open = false;
      if (optionsRef.current?.open) {
        optionsRef.current.open = false;
        requestAnimationFrame(() => optionsSummaryRef.current?.focus());
      } else {
        requestAnimationFrame(() => currentActionsSummaryRef.current?.focus());
      }
    }
  };
  const seekBy = (offset: number) => {
    const audio = playback.audioRef.current;
    if (!audio || !isCurrentSource(audio) || playbackControlsDisabled || !Number.isFinite(offset) || !Number.isFinite(duration) || duration <= 0) return;
    const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : playback.currentTime;
    const nextTime = Math.min(duration, Math.max(0, currentTime + offset));
    audio.currentTime = nextTime;
    playback.setCurrentTime(nextTime);
  };
  const changePlaybackRate = (value: number) => {
    const audio = playback.audioRef.current;
    if (!audio || !isCurrentSource(audio) || playbackControlsDisabled || !ALLOWED_PLAYBACK_RATES.some((rate) => rate === value)) return;
    audio.playbackRate = value;
    audio.defaultPlaybackRate = value;
    setPlaybackRate(value);
  };
  const changeVolume = (value: number) => {
    const audio = playback.audioRef.current;
    if (!audio || !isCurrentSource(audio) || playbackControlsDisabled || !Number.isFinite(value)) return;
    const nextVolume = Math.min(1, Math.max(0, value));
    audio.volume = nextVolume;
    setVolume(nextVolume);
  };
  const toggleMuted = () => {
    const audio = playback.audioRef.current;
    if (!audio || !isCurrentSource(audio) || playbackControlsDisabled) return;
    const nextMuted = !audio.muted;
    audio.muted = nextMuted;
    setMuted(nextMuted);
  };
  useEffect(() => {
    if (playback.queueOpen && !wasQueueOpenRef.current) queueHeadingRef.current?.focus();
    if (!playback.queueOpen && wasQueueOpenRef.current && queueHadPanelFocusRef.current) queueSummaryRef.current?.focus();
    if (!playback.queueOpen) queueHadPanelFocusRef.current = false;
    wasQueueOpenRef.current = playback.queueOpen;
  }, [playback.queueOpen]);
  useEffect(() => {
    if (!playback.queueOpen || playback.queue.length === 0) setQueueFilter("");
  }, [playback.queue.length, playback.queueOpen]);
  useEffect(() => {
    if (!playback.queueOpen || playback.queue.length === 0) {
      setSelectedOccurrenceIDs((current) => current.size ? new Set() : current);
      if (queueBatchRef.current) queueBatchRef.current.open = false;
      return;
    }
    const visibleIDs = new Set(visibleQueueEntries.map(({ entry }) => entry.occurrenceID));
    setSelectedOccurrenceIDs((current) => {
      const next = new Set([...current].filter((id) => visibleIDs.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [playback.queue, playback.queueOpen, visibleQueueEntries]);
  useEffect(() => setDetailsUnavailable(false), [trackOccurrence]);

  return <>
    {/* Keep announcements outside the idle player, whose parent can be display:none. */}
    <span className="sr-only audio-player-announcement" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    {playback.sleepTimerNotice && <div className="audio-player-sleep-timer-toast" aria-live="off"><span>{t(playback.sleepTimerNotice)}</span><button type="button" aria-label={t("Dismiss sleep timer notice")} onClick={playback.dismissSleepTimerNotice}><X aria-hidden="true" /></button></div>}
    <aside ref={immersiveDialogRef} className={`global-audio-player ${playback.track ? "has-track" : "no-track"} ${playback.queue.length ? "has-queue" : "no-queue"} ${playback.queueNotice ? "has-queue-message" : ""} ${playback.queueOpen ? "has-open-queue" : ""} ${immersive ? "is-immersive" : ""}`} aria-label={t("Music player")} role={immersive ? "dialog" : undefined} aria-modal={immersive ? true : undefined} aria-labelledby={immersive ? "immersive-music-title" : undefined} onKeyDown={immersive ? handleImmersiveKeyDown : undefined}>
    <audio ref={playback.audioRef} preload="none" onLoadedMetadata={(event) => { if (isCurrentSource(event.currentTarget)) { event.currentTarget.defaultPlaybackRate = playbackRate; event.currentTarget.playbackRate = playbackRate; event.currentTarget.volume = volume; event.currentTarget.muted = muted; } }} onVolumeChange={(event) => { if (isCurrentSource(event.currentTarget)) { const actualVolume = event.currentTarget.volume; if (Number.isFinite(actualVolume)) setVolume(Math.min(1, Math.max(0, actualVolume))); setMuted(event.currentTarget.muted); } }} onRateChange={(event) => { if (!isCurrentSource(event.currentTarget)) return; const actualRate = event.currentTarget.playbackRate; if (ALLOWED_PLAYBACK_RATES.some((rate) => rate === actualRate)) { event.currentTarget.defaultPlaybackRate = actualRate; setPlaybackRate(actualRate); } else event.currentTarget.playbackRate = playbackRate; }} onPlay={(event) => { if (isCurrentSource(event.currentTarget)) playback.syncPlaying(true); }} onPause={(event) => { if (isCurrentSource(event.currentTarget)) playback.syncPlaying(false); }} onTimeUpdate={(event) => { if (isCurrentSource(event.currentTarget)) playback.setCurrentTime(event.currentTarget.currentTime); }} onDurationChange={(event) => { if (isCurrentSource(event.currentTarget)) playback.setDuration(event.currentTarget.duration || 0); }} onEnded={(event) => { if (isCurrentSource(event.currentTarget)) playback.handleEnded(); }} onError={(event) => { if (isCurrentSource(event.currentTarget)) playback.fail("unsupported-format"); }} />
    {immersive && <section className="audio-player-immersive-room" ref={immersiveRoomRef} tabIndex={-1} aria-label={t("Immersive player")}>
      <header className="audio-player-immersive-header"><span>{t("Listening room")}</span><button type="button" className="audio-player-immersive-close" onClick={closeImmersive}><X aria-hidden="true" />{t("Exit player")}</button></header>
      <div className="audio-player-immersive-main">
        <div className="audio-player-immersive-mark" aria-hidden="true"><Music2 /></div>
        <p className="audio-player-immersive-eyebrow">{t(playback.url && !playback.loading && !playback.error ? "Verified original audio" : playback.loading ? "Checking original audio" : playback.error ? "Original unavailable" : "Original audio")}</p>
        <h1 id="immersive-music-title">{immersiveTitle}</h1>
        {(playback.track?.displayArtist || playback.track?.displayAlbum) && <p className="audio-player-immersive-facts">{[playback.track.displayArtist, playback.track.displayAlbum].filter(Boolean).join(" · ")}</p>}
        {playback.track?.name && <details className="audio-player-immersive-source"><summary>{t("Original file details")}</summary><p className="audio-player-immersive-filename"><span>{t("Original filename")}</span><code title={playback.track.name}>{playback.track.name}</code></p></details>}
        <p className={`audio-player-immersive-status ${error ? "has-error" : ""}`} role={error ? "alert" : "status"}>{playback.loading ? t("Loading and verifying original") : playback.starting ? t("Starting audio…") : error || (playback.url ? t("Original audio") : t("Ready"))}</p>
        <div className="audio-player-immersive-seek"><span>{clock(playback.currentTime)}</span><input aria-label={t("Seek")} type="range" min="0" max={duration || 0} step="0.1" value={Math.min(playback.currentTime, duration)} disabled={playbackControlsDisabled || !duration} onChange={(event) => { const audio = playback.audioRef.current; const rawValue = Number(event.target.value); if (!audio || !isCurrentSource(audio) || !Number.isFinite(rawValue) || !Number.isFinite(duration) || duration <= 0) return; const value = Math.min(duration, Math.max(0, rawValue)); audio.currentTime = value; playback.setCurrentTime(value); }} /><span>{clock(duration)}</span></div>
        <div className="audio-player-immersive-controls">
          <button type="button" aria-label={t("Previous track")} disabled={!playback.canPlayPrevious} onClick={playback.playPrevious}><SkipBack aria-hidden="true" /></button>
          <button type="button" className="audio-player-immersive-play" aria-label={t(playback.playing ? "Pause" : "Play")} disabled={playbackControlsDisabled} onClick={() => void playback.toggle()}>{playback.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
          <button type="button" aria-label={t("Next track")} disabled={!playback.canPlayNext} onClick={playback.playNext}><SkipForward aria-hidden="true" /></button>
          <button type="button" className="audio-player-immersive-repeat" aria-label={t("Repeat mode: {{mode}}", { mode: t(playback.repeatMode) })} onClick={playback.cycleRepeatMode}>{playback.repeatMode === "one" ? <Repeat1 aria-hidden="true" /> : <Repeat aria-hidden="true" />}<span>{t("Repeat: {{mode}}", { mode: t(playback.repeatMode) })}</span></button>
        </div>
        <button type="button" className="audio-player-immersive-queue-toggle" aria-expanded={playback.queueOpen} onClick={() => playback.setQueueOpen(!playback.queueOpen)}>{t(playback.queueOpen ? "Hide listening queue" : "Show listening queue")} <span>{playback.queue.length}</span></button>
        <div className="audio-player-immersive-options">
          <label><span>{t("Volume")}</span><input aria-label={t("Volume")} type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} disabled={playbackControlsDisabled} onChange={(event) => { const audio = playback.audioRef.current; if (audio && isCurrentSource(audio)) audio.muted = false; changeVolume(Number(event.target.value)); }} /></label>
          <label><span>{t("Playback speed")}</span><select aria-label={t("Playback speed")} value={playbackRate} disabled={playbackControlsDisabled} onChange={(event) => changePlaybackRate(Number(event.target.value))}>{ALLOWED_PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
          <button type="button" disabled={!playback.track} onClick={() => { closeImmersive(); playback.stop(); }}><Square aria-hidden="true" />{t("Stop")}</button>
        </div>
      </div>
    </section>}
    <button ref={immersiveOpenButtonRef} type="button" className="audio-player-identity" title={playback.track ? `${currentTitle} · SHA-256: ${playback.track.contentID}` : t("Nothing playing")} aria-label={t("Open immersive player")} disabled={!playback.track} onClick={openImmersive}><strong>{currentTitle || t("Nothing playing")}</strong>{currentSecondary && <span className="audio-player-labels">{currentSecondary}</span>}{(miniStatus || sleepTimerRemaining) && <small className={error ? "is-error" : undefined}>{miniStatus}{sleepTimerRemaining && <span className="audio-player-sleep-timer" aria-live="off"> · {sleepTimerRemaining}</span>}</small>}<span className="audio-player-identity-action" aria-hidden="true"><Maximize2 /></span></button>
    <button type="button" className="audio-player-prev" aria-label={t("Previous track")} disabled={!playback.canPlayPrevious} onClick={playback.playPrevious}><SkipBack /></button>
    <button type="button" className="audio-player-toggle" aria-label={t(playback.starting ? "Starting audio…" : playback.playing ? "Pause" : "Play")} disabled={!playback.url || playback.loading || playback.starting} onClick={() => void playback.toggle()}>{playback.playing ? <Pause /> : <Play />}</button>
    <span className="audio-player-time audio-player-elapsed">{clock(playback.currentTime)}</span>
    <input aria-label={t("Seek")} type="range" min="0" max={duration || 0} step="0.1" value={Math.min(playback.currentTime, duration)} disabled={playbackControlsDisabled || !duration} onChange={(event) => { const audio = playback.audioRef.current; const rawValue = Number(event.target.value); if (!audio || !isCurrentSource(audio) || !Number.isFinite(rawValue) || !Number.isFinite(duration) || duration <= 0) return; const value = Math.min(duration, Math.max(0, rawValue)); audio.currentTime = value; playback.setCurrentTime(value); }} />
    <span className="audio-player-time audio-player-duration">{clock(duration)}</span>
    <details ref={optionsRef} className="audio-player-options" onKeyDown={(event) => { if (event.key === "Escape" && optionsRef.current?.open) { event.preventDefault(); event.stopPropagation(); optionsRef.current.open = false; requestAnimationFrame(() => optionsSummaryRef.current?.focus()); } }}>
      <summary ref={optionsSummaryRef}>{t("Playback options")}</summary>
      <div className="audio-player-options-panel">
        <div className="audio-player-seek-options">
          <button type="button" disabled={playbackControlsDisabled || !duration} onClick={() => seekBy(-15)}>{t("Back 15 seconds")}</button>
          <button type="button" disabled={playbackControlsDisabled || !duration} onClick={() => seekBy(15)}>{t("Forward 15 seconds")}</button>
        </div>
        <label><span>{t("Playback speed")}</span><select aria-label={t("Playback speed")} value={playbackRate} disabled={playbackControlsDisabled} onChange={(event) => changePlaybackRate(Number(event.target.value))}>
          {ALLOWED_PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
        </select></label>
        <label><span>{t("Sleep timer")}</span><select aria-label={t("Sleep timer")} value={playback.sleepTimerMinutes ?? "off"} disabled={!playback.track} onChange={(event) => {
          const value = event.currentTarget.value;
          if (value === "off") { playback.cancelSleepTimer(); return; }
          const minutes = Number(value);
          if ([10, 20, 30, 60].includes(minutes)) playback.setSleepTimer(minutes as 10 | 20 | 30 | 60);
        }}>
          <option value="off">{t("Off")}</option>
          {[10, 20, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{t("{{count}} minutes", { count: minutes })}</option>)}
        </select></label>
        <label><span>{t("Volume")}</span><input aria-label={t("Volume")} type="range" min="0" max="1" step="0.01" value={volume} disabled={playbackControlsDisabled} onChange={(event) => changeVolume(Number(event.target.value))} /></label>
        <button type="button" disabled={playbackControlsDisabled} aria-pressed={muted} onClick={toggleMuted}>{t(muted ? "Unmute" : "Mute")}</button>
        <button type="button" disabled={!playback.track} onClick={playback.stop}><Square aria-hidden="true" />{t("Stop")}</button>
    {playback.track && (onOpenDetails || showRetry) && <details ref={currentActionsRef} className="audio-player-current-actions">
      <summary ref={currentActionsSummaryRef}>{t("Current track")}</summary>
      <div>
        {showRetry && <button type="button" className="audio-player-retry" disabled={retryDisabled} onClick={() => { const track = playback.track; if (track && !retryDisabled) void playback.play(track); }}>{t("Retry original audio")}</button>}
        {onOpenDetails && <button type="button" onClick={openCurrentDetails}>{t("Details / Download original")}</button>}
        {detailsUnavailable && <small role="status">{t("Current track details are unavailable in the current library scope.")}</small>}
      </div>
    </details>}

      </div>
    </details>

    <button type="button" className="audio-player-next" aria-label={t("Next track")} disabled={!playback.canPlayNext} onClick={playback.playNext}><SkipForward /></button>
    <details className="audio-player-queue" open={playback.queueOpen} onToggle={onQueueToggle} onFocusCapture={() => { queueHadPanelFocusRef.current = true; }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) queueHadPanelFocusRef.current = false; }} onKeyDown={(event) => { if (event.key === "Escape" && playback.queueOpen) { event.preventDefault(); event.stopPropagation(); const returnFocus = queuePanelRef.current?.contains(document.activeElement) ?? false; playback.setQueueOpen(false); if (returnFocus) queueSummaryRef.current?.focus(); } }}>
      <summary ref={queueSummaryRef} aria-label={t(playback.queueOpen ? "Close listening queue" : "Open listening queue")}>{t("Queue ({{count}})", { count: playback.queue.length })}</summary>
      <div className="audio-player-queue-panel" ref={queuePanelRef} role="region" aria-label={t("Listening queue")}>
        <header><div><strong tabIndex={-1} ref={queueHeadingRef}>{t("Listening queue")}</strong><small>{t("{{count}} items · temporary queue", { count: playback.queue.length })}</small></div><button type="button" disabled={!playback.queue.length} onClick={() => { setSelectedOccurrenceIDs(new Set()); playback.clearQueue(); }}>{t("Clear queue")}</button></header>
        <p className="audio-player-queue-lifecycle">{t("This listening queue is cleared on refresh.")}</p>
        {playback.queue.length > 0 && <div className="audio-player-queue-filter">
          <label><Search aria-hidden="true" /><span className="sr-only">{t("Filter listening queue")}</span><input ref={queueFilterRef} type="search" value={queueFilter} onChange={(event) => setQueueFilter(event.target.value)} placeholder={t("Search queued tracks")} /></label>
          {queueFilter && <button type="button" onClick={() => { setQueueFilter(""); requestAnimationFrame(() => queueFilterRef.current?.focus()); }}>{t("Clear queue filter")}</button>}
          <small>{t("Showing {{visible}} of {{count}} queue items", { visible: visibleQueueEntries.length, count: playback.queue.length })}</small>
        </div>}
        {currentQueueTrackHidden && <p className="audio-player-queue-current-hidden" role="status">{t("The current track is hidden by this filter.")} <button type="button" onClick={() => { setQueueFilter(""); requestAnimationFrame(() => queueFilterRef.current?.focus()); }}>{t("Show current track")}</button></p>}
        <div className="audio-player-queue-tools">
          {playback.queue.length > 0 && !playback.track && <button type="button" className="audio-queue-start" onClick={() => void playback.play(playback.queue[0])}><Play />{t("Play queue")}</button>}
          <button type="button" disabled={playback.queue.length < 2} onClick={playback.shuffleUpcoming}><Shuffle />{t("Shuffle upcoming")}</button>
          <button type="button" aria-label={t("Repeat mode: {{mode}}", { mode: t(playback.repeatMode) })} onClick={playback.cycleRepeatMode}>{playback.repeatMode === "one" ? <Repeat1 /> : <Repeat />}{t("Repeat: {{mode}}", { mode: t(playback.repeatMode) })}</button>
        </div>
        {playback.queue.length > 0 && <details ref={queueBatchRef} className="audio-player-queue-batch">
          <summary>{t("Batch actions ({{count}} selected)", { count: selectedVisibleEntries.length })}</summary>
          <div className="audio-player-queue-batch-panel">
            <p>{t("Batch actions affect displayed occurrences only; the current occurrence stays in place.")}</p>
            {selectedActiveCount > 0 && <small role="status">{t("{{count}} selected current occurrences are excluded from batch actions.", { count: selectedActiveCount })}</small>}
            <div>
              <button
                type="button"
                disabled={!visibleQueueEntries.some(({ entry }) => !playback.track || !sameQueueOccurrence(playback.track, entry))}
                onClick={() => setSelectedOccurrenceIDs((current) => {
                  const displayedInactiveIDs = visibleQueueEntries
                    .filter(({ entry }) => !playback.track || !sameQueueOccurrence(playback.track, entry))
                    .map(({ entry }) => entry.occurrenceID);
                  return new Set([...current, ...displayedInactiveIDs]);
                })}
              >{t("Select displayed")}</button>
              <button type="button" disabled={!visibleQueueEntries.some(({ entry }) => selectedOccurrenceIDs.has(entry.occurrenceID))} onClick={() => setSelectedOccurrenceIDs((current) => new Set([...current].filter((id) => !visibleQueueEntries.some(({ entry }) => entry.occurrenceID === id))))}>{t("Clear displayed selection")}</button>
              <button type="button" disabled={!selectedInactiveEntries.length} onClick={() => playback.removeQueuedTracks(selectedInactiveEntries.map(({ entry }) => entry))}>{t("Remove selected inactive items ({{count}})", { count: selectedInactiveEntries.length })}</button>
              <button type="button" disabled={!selectedInactiveEntries.length} onClick={() => playback.moveQueuedTracksNext(selectedInactiveEntries.map(({ entry }) => entry))}>{t("Move selected inactive items next ({{count}})", { count: selectedInactiveEntries.length })}</button>
            </div>
          </div>
        </details>}
        {playback.queueNotice && <p className="audio-player-queue-notice" role="status">{t(playback.queueNotice)}</p>}
        {playback.queueSkippedCount > 0 && <p className="audio-player-queue-notice" role="status">{t("{{count}} displayed items were unavailable or unsupported and were not added.", { count: playback.queueSkippedCount })}</p>}
        {playback.queue.length && visibleQueueEntries.length ? <ol className="audio-player-queue-list">{visibleQueueEntries.map(({ entry, position }) => {
          const current = playback.track ? sameQueueOccurrence(playback.track, entry) : false;
          const queueTitle = entry.displayTitle || entry.name;
          const queueDetails = [entry.displayArtist, entry.displayAlbum, entry.displayTitle && entry.displayTitle !== entry.name ? entry.name : undefined].filter(Boolean).join(" · ");
          const accessibleName = queueDetails ? `${queueTitle} · ${queueDetails}` : queueTitle;
          const queueActionName = t("Queue item {{position}}: {{name}}", { position, name: accessibleName });
          const entryIndex = position - 1;
          const moveNextDisabled = current || (activeQueueIndex < 0 ? entryIndex === 0 : entryIndex === activeQueueIndex + 1);
          return <li className={`audio-player-queue-item ${current ? "current" : ""}`} key={entry.occurrenceID} role="group" aria-label={queueActionName}>
            <label className="audio-queue-select"><input type="checkbox" checked={selectedOccurrenceIDs.has(entry.occurrenceID)} disabled={current} title={current ? t("The current occurrence is excluded from batch actions.") : undefined} aria-label={t("Select queue occurrence {{position}}: {{name}}", { position, name: accessibleName })} onChange={(event) => setSelectedOccurrenceIDs((selected) => { const next = new Set(selected); if (event.target.checked) next.add(entry.occurrenceID); else next.delete(entry.occurrenceID); return next; })} /></label>
            <span className="audio-queue-order" aria-hidden="true">{position}</span>
            <button type="button" className="audio-queue-play" aria-label={t("Play {{name}}", { name: queueActionName })} aria-current={current ? "true" : undefined} onClick={() => void playback.play(entry)}><strong>{queueTitle}</strong>{queueDetails && <small>{queueDetails}</small>}</button>
            {current && <span className="audio-queue-current">{t(playback.playing ? "Now playing" : "Current track")}</span>}
            <button type="button" className="audio-queue-next" aria-label={t("Move queue item {{position}} to play next: {{name}}", { position, name: accessibleName })} title={t("Move to play next")} disabled={moveNextDisabled} onClick={() => playback.moveQueuedTrackNext(entry)}><SkipForward /></button>
            <button type="button" aria-label={t("Move queue item {{position}} up: {{name}}", { position, name: entry.name })} title={t("Move up")} disabled={position === 1} onClick={() => playback.moveQueuedTrack(entry, -1)}><ArrowUp /></button>
            <button type="button" aria-label={t("Move queue item {{position}} down: {{name}}", { position, name: entry.name })} title={t("Move down")} disabled={position === playback.queue.length} onClick={() => playback.moveQueuedTrack(entry, 1)}><ArrowDown /></button>
            <button type="button" aria-label={t("Remove queue item {{position}}: {{name}}", { position, name: entry.name })} title={current ? t("Stop playback before removing the current track") : t("Remove from queue")} disabled={current} onClick={() => playback.removeFromQueue(entry)}><X /></button>
          </li>;
        })}</ol> : playback.queue.length > 0 ? <p className="audio-player-queue-empty" role="status">{t("No queued tracks match this filter.")}</p> : <p className="audio-player-queue-empty">{t("Queue is empty")}. {t("Add tracks from Music to start listening.")}</p>}
      </div>
    </details>
  </aside>
  </>;
}
