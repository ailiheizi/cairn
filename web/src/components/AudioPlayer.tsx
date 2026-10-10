import { useEffect, useRef } from "react";
import type { SyntheticEvent } from "react";
import { ArrowDown, ArrowUp, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Square, X } from "lucide-react";
import type { useAudioPlayback } from "../app/useAudioPlayback";
import type { Translator } from "../i18n";
import { sameQueueOccurrence } from "../lib/playbackQueue";
import "./AudioPlayer.css";

type Playback = ReturnType<typeof useAudioPlayback>;

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

export function AudioPlayer({ playback, t, onOpenDetails }: { playback: Playback; t: Translator; onOpenDetails?: (track: NonNullable<Playback["track"]>) => void }) {
  const queuePanelRef = useRef<HTMLDivElement>(null);
  const queueSummaryRef = useRef<HTMLElement>(null);
  const queueHeadingRef = useRef<HTMLElement>(null);
  const wasQueueOpenRef = useRef(false);
  const queueHadPanelFocusRef = useRef(false);
  const duration = Number.isFinite(playback.duration) ? playback.duration : 0;
  const errorStatus = playback.error ? playbackErrorText(playback.error) : undefined;
  const error = errorStatus && t(errorStatus.message, errorStatus.values);
  // The status line is a polite live region only while it actually reports an
  // error or a queue notice. When it only shows the routine lifecycle text
  // ("Ready", "Original audio", "Loading and verifying original") it stays a
  // plain element, so the routine transitions are not announced on every action.
  const announcesStatus = Boolean(error || playback.queueNotice);
  const isCurrentSource = (audio: HTMLAudioElement) => Boolean(playback.url && audio.currentSrc === playback.url);
  const onQueueToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const open = event.currentTarget.open;
    if (open !== playback.queueOpen) playback.setQueueOpen(open);
  };
  useEffect(() => {
    if (playback.queueOpen && !wasQueueOpenRef.current) queueHeadingRef.current?.focus();
    if (!playback.queueOpen && wasQueueOpenRef.current && queueHadPanelFocusRef.current) queueSummaryRef.current?.focus();
    if (!playback.queueOpen) queueHadPanelFocusRef.current = false;
    wasQueueOpenRef.current = playback.queueOpen;
  }, [playback.queueOpen]);

  return <aside className={`global-audio-player ${playback.track ? "has-track" : "no-track"} ${playback.queue.length ? "has-queue" : "no-queue"} ${playback.queueNotice ? "has-queue-message" : ""} ${playback.queueOpen ? "has-open-queue" : ""}`} aria-label={t("Music player")}>
    <audio ref={playback.audioRef} preload="none" onPlay={(event) => { if (isCurrentSource(event.currentTarget)) playback.syncPlaying(true); }} onPause={(event) => { if (isCurrentSource(event.currentTarget)) playback.syncPlaying(false); }} onTimeUpdate={(event) => { if (isCurrentSource(event.currentTarget)) playback.setCurrentTime(event.currentTarget.currentTime); }} onDurationChange={(event) => { if (isCurrentSource(event.currentTarget)) playback.setDuration(event.currentTarget.duration || 0); }} onEnded={(event) => { if (isCurrentSource(event.currentTarget)) playback.handleEnded(); }} onError={(event) => { if (isCurrentSource(event.currentTarget)) playback.fail("unsupported-format"); }} />
    <div className="audio-player-identity"><strong title={playback.track ? `SHA-256: ${playback.track.contentID}` : undefined}>{playback.track?.name || t("Nothing playing")}</strong><small role={announcesStatus ? "status" : undefined} aria-live={announcesStatus ? "polite" : undefined}>{playback.loading ? t("Loading and verifying original") : error || (playback.queueNotice ? t(playback.queueNotice) : playback.track ? t("Original audio") : t("Ready"))}</small></div>
    <button type="button" className="audio-player-prev" aria-label={t("Previous track")} disabled={!playback.canPlayPrevious} onClick={playback.playPrevious}><SkipBack /></button>
    <button type="button" className="audio-player-toggle" aria-label={t(playback.playing ? "Pause" : "Play")} disabled={!playback.url || playback.loading} onClick={() => void playback.toggle()}>{playback.playing ? <Pause /> : <Play />}</button>
    <span className="audio-player-time audio-player-elapsed">{clock(playback.currentTime)}</span>
    <input aria-label={t("Seek")} type="range" min="0" max={duration || 0} step="0.1" value={Math.min(playback.currentTime, duration)} disabled={!duration} onChange={(event) => { const value = Number(event.target.value); if (playback.audioRef.current) playback.audioRef.current.currentTime = value; playback.setCurrentTime(value); }} />
    <span className="audio-player-time audio-player-duration">{clock(duration)}</span>
    <label><span>{t("Volume")}</span><input type="range" min="0" max="1" step="0.01" defaultValue="1" onChange={(event) => { if (playback.audioRef.current) playback.audioRef.current.volume = Number(event.target.value); }} /></label>
    {error && playback.track && onOpenDetails && <button type="button" className="audio-player-details" onClick={() => onOpenDetails(playback.track!)}>{t("Details / Download original")}</button>}
    <button type="button" className="audio-player-next" aria-label={t("Next track")} disabled={!playback.canPlayNext} onClick={playback.playNext}><SkipForward /></button>
    <button type="button" className="audio-player-stop" aria-label={t("Stop")} disabled={!playback.track} onClick={playback.stop}><Square /></button>
    <details className="audio-player-queue" open={playback.queueOpen} onToggle={onQueueToggle} onFocusCapture={() => { queueHadPanelFocusRef.current = true; }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) queueHadPanelFocusRef.current = false; }} onKeyDown={(event) => { if (event.key === "Escape" && playback.queueOpen) { event.preventDefault(); event.stopPropagation(); const returnFocus = queuePanelRef.current?.contains(document.activeElement) ?? false; playback.setQueueOpen(false); if (returnFocus) queueSummaryRef.current?.focus(); } }}>
      <summary ref={queueSummaryRef} aria-label={t(playback.queueOpen ? "Close listening queue" : "Open listening queue")}>{t("Queue ({{count}})", { count: playback.queue.length })}</summary>
      <div className="audio-player-queue-panel" ref={queuePanelRef} role="region" aria-label={t("Listening queue")}>
        <header><div><strong tabIndex={-1} ref={queueHeadingRef}>{t("Listening queue")}</strong><small>{t("{{count}} items · temporary queue", { count: playback.queue.length })}</small></div><button type="button" disabled={!playback.queue.length} onClick={playback.clearQueue}>{t("Clear queue")}</button></header>
        <p className="audio-player-queue-lifecycle">{t("This listening queue is cleared on refresh.")}</p>
        <div className="audio-player-queue-tools">
          {playback.queue.length > 0 && !playback.track && <button type="button" className="audio-queue-start" onClick={() => void playback.play(playback.queue[0])}><Play />{t("Play queue")}</button>}
          <button type="button" disabled={playback.queue.length < 2} onClick={playback.shuffleUpcoming}><Shuffle />{t("Shuffle upcoming")}</button>
          <button type="button" aria-label={t("Repeat mode: {{mode}}", { mode: t(playback.repeatMode) })} onClick={playback.cycleRepeatMode}>{playback.repeatMode === "one" ? <Repeat1 /> : <Repeat />}{t("Repeat: {{mode}}", { mode: t(playback.repeatMode) })}</button>
        </div>
        {playback.queueNotice && <p className="audio-player-queue-notice" role="status">{t(playback.queueNotice)}</p>}
        {playback.queueSkippedCount > 0 && <p className="audio-player-queue-notice" role="status">{t("{{count}} displayed items were unavailable or unsupported and were not added.", { count: playback.queueSkippedCount })}</p>}
        {playback.queue.length ? <ol className="audio-player-queue-list">{playback.queue.map((entry, index) => {
          const current = playback.track ? sameQueueOccurrence(playback.track, entry) : false;
          const position = index + 1;
          return <li className={`audio-player-queue-item ${current ? "current" : ""}`} key={entry.occurrenceID} role="group" aria-label={t("Queue item {{position}}: {{name}}", { position, name: entry.name })}>
            <span className="audio-queue-order" aria-hidden="true">{position}</span>
            <button type="button" className="audio-queue-play" aria-current={current ? "true" : undefined} onClick={() => void playback.play(entry)}>{entry.name}</button>
            {current && <span className="audio-queue-current">{t("Now playing")}</span>}
            <button type="button" aria-label={t("Move queue item {{position}} up: {{name}}", { position, name: entry.name })} title={t("Move up")} disabled={index === 0} onClick={() => playback.moveQueuedTrack(entry, -1)}><ArrowUp /></button>
            <button type="button" aria-label={t("Move queue item {{position}} down: {{name}}", { position, name: entry.name })} title={t("Move down")} disabled={index === playback.queue.length - 1} onClick={() => playback.moveQueuedTrack(entry, 1)}><ArrowDown /></button>
            <button type="button" aria-label={t("Remove queue item {{position}}: {{name}}", { position, name: entry.name })} title={current ? t("Stop playback before removing the current track") : t("Remove from queue")} disabled={current} onClick={() => playback.removeFromQueue(entry)}><X /></button>
          </li>;
        })}</ol> : <p className="audio-player-queue-empty">{t("Queue is empty")}. {t("Add tracks from Music to start listening.")}</p>}
      </div>
    </details>
  </aside>;
}
