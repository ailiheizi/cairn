import { useCallback, useEffect, useRef, useState } from "react";
import { fetchVerifiedAudio, type AudioQueueEntry, type AudioTrack } from "../lib/audioPlayback";
import { insertQueueTrackNext, isPlayableQueueTrack, MAX_AUDIO_QUEUE_ENTRIES, moveQueueOccurrenceNext, moveQueueOccurrencesNext, moveQueueTrack, preparePlayableQueue, removeQueueOccurrence, removeQueueOccurrences, resolveQueueAdvance, sameQueueOccurrence, shuffleUpcomingTracks, type QueueTrack, type RepeatMode } from "../lib/playbackQueue";

type Playback = { queue: AudioQueueEntry[]; queueOpen: boolean; queueSkippedCount: number; queueNotice?: string; sleepTimerNotice?: string; repeatMode: RepeatMode; track?: QueueTrack; url?: string; loading: boolean; starting: boolean; error?: string; playing: boolean; currentTime: number; duration: number };
const initial: Playback = { queue: [], queueOpen: false, repeatMode: "off", queueSkippedCount: 0, loading: false, starting: false, playing: false, currentTime: 0, duration: 0 };
type QueueActionResult = { queuedCount: number; skippedCount: number; reason?: "no-supported-tracks" | "queue-limit" };
type NativeStartAttempt = { generation: number; url: string; workspaceID: string; pending: boolean };
export type SleepTimerMinutes = 10 | 20 | 30 | 60;
function isGestureDenied(error: unknown): boolean { return error instanceof DOMException && error.name === "NotAllowedError"; }

export function useAudioPlayback(workspaceID: string) {
  const workspaceRef = useRef(workspaceID);
  workspaceRef.current = workspaceID;
  const audioRef = useRef<HTMLAudioElement>(null);
  const requestRef = useRef<AbortController | undefined>(undefined);
  const urlRef = useRef<string | undefined>(undefined);
  const nativeStartRef = useRef<NativeStartAttempt | undefined>(undefined);
  const generationRef = useRef(0);
  const queueRef = useRef<AudioQueueEntry[]>([]);
  const [state, setState] = useState<Playback>(initial);
  const [sleepTimerDeadline, setSleepTimerDeadline] = useState<number | undefined>(undefined);
  const [sleepTimerMinutes, setSleepTimerMinutesState] = useState<SleepTimerMinutes | undefined>(undefined);
  const [sleepTimerRemainingMs, setSleepTimerRemainingMs] = useState<number | undefined>(undefined);
  const sleepTimerGenerationRef = useRef(0);
  const sleepTimerDeadlineRef = useRef<number | undefined>(undefined);
  const sleepTimerTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeTrackRef = useRef<QueueTrack | undefined>(state.track);
  const commitQueue = useCallback((queue: AudioQueueEntry[], patch: Partial<Playback> = {}) => {
    queueRef.current = queue;
    setState((current) => ({ ...current, ...patch, queue }));
  }, []);
  const clearMedia = useCallback(() => {
    nativeStartRef.current = undefined;
    requestRef.current?.abort(); requestRef.current = undefined;
    const oldUrl = urlRef.current;
    urlRef.current = undefined;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.removeAttribute("src"); audioRef.current.load(); }
    if (oldUrl) URL.revokeObjectURL(oldUrl);
  }, []);
  const invalidateSleepTimer = useCallback(() => {
    sleepTimerGenerationRef.current += 1;
    if (sleepTimerTimeoutRef.current !== undefined) clearTimeout(sleepTimerTimeoutRef.current);
    sleepTimerTimeoutRef.current = undefined;
    sleepTimerDeadlineRef.current = undefined;
  }, []);
  const cancelSleepTimer = useCallback(() => {
    if (workspaceRef.current !== workspaceID) return;
    invalidateSleepTimer();
    setSleepTimerDeadline(undefined);
    setSleepTimerMinutesState(undefined);
    setSleepTimerRemainingMs(undefined);
    setState((current) => current.sleepTimerNotice ? ({ ...current, sleepTimerNotice: undefined }) : current);
  }, [invalidateSleepTimer, workspaceID]);
  const setSleepTimer = useCallback((minutes: SleepTimerMinutes | null) => {
    if (workspaceRef.current !== workspaceID) return;
    if (minutes === null) { cancelSleepTimer(); return; }
    if (minutes !== 10 && minutes !== 20 && minutes !== 30 && minutes !== 60) return;
    invalidateSleepTimer();
    const deadline = Date.now() + minutes * 60_000;
    sleepTimerDeadlineRef.current = deadline;
    setSleepTimerMinutesState(minutes);
    setSleepTimerRemainingMs(minutes * 60_000);
    setSleepTimerDeadline(deadline);
    setState((current) => current.sleepTimerNotice ? ({ ...current, sleepTimerNotice: undefined }) : current);
  }, [cancelSleepTimer, invalidateSleepTimer, workspaceID]);
  const stopWithNotice = useCallback((notice?: string) => {
    if (workspaceRef.current !== workspaceID) return;
    activeTrackRef.current = undefined;
    const generation = ++generationRef.current;
    cancelSleepTimer();
    clearMedia();
    setState((current) => generationRef.current === generation
      ? ({ ...initial, queue: current.queue, queueOpen: current.queueOpen, repeatMode: current.repeatMode, queueSkippedCount: current.queueSkippedCount, queueNotice: current.queueNotice, sleepTimerNotice: notice })
      : current);
  }, [cancelSleepTimer, clearMedia, workspaceID]);
  const stop = useCallback(() => stopWithNotice(), [stopWithNotice]);
  const dismissSleepTimerNotice = useCallback(() => {
    if (workspaceRef.current !== workspaceID) return;
    setState((current) => current.sleepTimerNotice ? ({ ...current, sleepTimerNotice: undefined }) : current);
  }, [workspaceID]);
  const fail = useCallback((error: string) => {
    const generation = ++generationRef.current;
    clearMedia();
    setState((current) => generationRef.current === generation
      ? ({ ...current, url: undefined, loading: false, starting: false, playing: false, error })
      : current);
  }, [clearMedia]);
  const startNativePlayback = useCallback(async (url: string, generation: number) => {
    const audio = audioRef.current;
    if (!audio || workspaceRef.current !== workspaceID || generationRef.current !== generation || urlRef.current !== url || audio.src !== url) return;
    const pending = nativeStartRef.current;
    if (pending?.pending && pending.generation === generation && pending.url === url && pending.workspaceID === workspaceID) return;
    const attempt: NativeStartAttempt = { generation, url, workspaceID, pending: true };
    nativeStartRef.current = attempt;
    setState((current) => nativeStartRef.current === attempt && workspaceRef.current === workspaceID && generationRef.current === generation && urlRef.current === url && current.url === url
      ? ({ ...current, starting: true, playing: false })
      : current);
    try {
      await audio.play();
      if (nativeStartRef.current !== attempt || workspaceRef.current !== workspaceID || generationRef.current !== generation || urlRef.current !== url || audioRef.current !== audio || audio.src !== url) return;
      attempt.pending = false;
      setState((current) => nativeStartRef.current === attempt && workspaceRef.current === workspaceID && generationRef.current === generation && urlRef.current === url && current.url === url
        ? ({ ...current, starting: false, playing: !audio.paused, error: undefined })
        : current);
    } catch (error) {
      if (nativeStartRef.current !== attempt || workspaceRef.current !== workspaceID || generationRef.current !== generation || urlRef.current !== url || audioRef.current !== audio || audio.src !== url) return;
      attempt.pending = false;
      if (isGestureDenied(error)) {
        setState((current) => nativeStartRef.current === attempt && workspaceRef.current === workspaceID && generationRef.current === generation && urlRef.current === url && current.url === url
          ? ({ ...current, starting: false, playing: false, error: "playback-permission" })
          : current);
      } else {
        fail(error instanceof Error ? error.message : "unsupported-format");
      }
    }
  }, [fail, workspaceID]);
  const play = useCallback(async (track: QueueTrack) => {
    if (workspaceRef.current !== workspaceID) return;
    activeTrackRef.current = track;
    setState((current) => current.sleepTimerNotice ? ({ ...current, sleepTimerNotice: undefined }) : current);
    if (!isPlayableQueueTrack(track, workspaceID)) {
      const reason = track.workspaceID !== workspaceID ? "workspace-mismatch" : "track-unavailable";
      fail(reason);
      const generation = generationRef.current;
      setState((current) => generationRef.current === generation
        ? ({ ...current, track, url: undefined, loading: false, starting: false, playing: false, error: reason })
        : current);
      return;
    }
    generationRef.current += 1; const generation = generationRef.current; clearMedia();
    const controller = new AbortController(); requestRef.current = controller;
    setState((current) => ({ ...initial, queue: current.queue, queueOpen: current.queueOpen, repeatMode: current.repeatMode, queueSkippedCount: current.queueSkippedCount, queueNotice: current.queueNotice, track, loading: true }));
    try {
      const blob = await fetchVerifiedAudio(track, controller.signal);
      if (workspaceRef.current !== workspaceID || generationRef.current !== generation || requestRef.current !== controller) return;
      requestRef.current = undefined;
      const url = URL.createObjectURL(blob); urlRef.current = url;
      setState((current) => generationRef.current === generation && urlRef.current === url
        ? ({ ...current, track, url, loading: false, playing: false, currentTime: 0, duration: 0 })
        : current);
      const audio = audioRef.current;
      if (audio) {
        audio.src = url;
        await startNativePlayback(url, generation);
      }
    } catch (error) {
      if (controller.signal.aborted || workspaceRef.current !== workspaceID || generationRef.current !== generation) return;
      const reason = error instanceof Error ? error.message : "playback-failed";
      const failureGeneration = ++generationRef.current;
      clearMedia();
      setState((current) => generationRef.current === failureGeneration
        ? ({ ...current, track, url: undefined, loading: false, starting: false, playing: false, error: reason })
        : current);
    }
  }, [clearMedia, fail, startNativePlayback, workspaceID]);
  const toggle = useCallback(async () => {
    const audio = audioRef.current; const url = urlRef.current; const generation = generationRef.current;
    if (!audio || !url) return;
    if (nativeStartRef.current?.pending && nativeStartRef.current.generation === generation && nativeStartRef.current.url === url) return;
    if (audio.paused) {
      await startNativePlayback(url, generation);
    } else {
      audio.pause();
      setState((current) => workspaceRef.current === workspaceID && generationRef.current === generation && urlRef.current === url && current.url === url
        ? ({ ...current, starting: false, playing: !audio.paused })
        : current);
    }
  }, [startNativePlayback]);

  const addTracksToQueue = useCallback((tracks: AudioTrack[]): QueueActionResult => {
    const available = MAX_AUDIO_QUEUE_ENTRIES - queueRef.current.length;
    const prepared = preparePlayableQueue(tracks, workspaceID, undefined, available);
    if (prepared.limitExceeded) {
      setState((current) => ({ ...current, queueSkippedCount: prepared.omittedCount, queueNotice: "The queue limit is 1,000 entries; existing queue and playback were left unchanged." }));
      return { queuedCount: 0, skippedCount: prepared.omittedCount, reason: "queue-limit" };
    }
    if (prepared.tracks.length === 0) {
      const notice = tracks.length ? "Some loaded tracks were omitted because they could not be played here." : "No supported tracks were available; the current queue and playback were left unchanged.";
      setState((current) => ({ ...current, queueSkippedCount: prepared.omittedCount, queueNotice: notice }));
      return { queuedCount: 0, skippedCount: prepared.omittedCount, reason: "no-supported-tracks" };
    }
    const queue = [...queueRef.current, ...prepared.tracks];
    const notice = prepared.omittedCount ? "Some loaded tracks were omitted because they could not be played here." : undefined;
    commitQueue(queue, { queueSkippedCount: prepared.omittedCount, queueNotice: notice });
    return { queuedCount: prepared.tracks.length, skippedCount: prepared.omittedCount };
  }, [commitQueue, workspaceID]);
  const addToQueue = useCallback((track: AudioTrack) => addTracksToQueue([track]), [addTracksToQueue]);
  const addNextToQueue = useCallback((track: AudioTrack): QueueActionResult => {
    const prepared = preparePlayableQueue([track], workspaceID, undefined, MAX_AUDIO_QUEUE_ENTRIES - queueRef.current.length);
    if (prepared.limitExceeded) {
      setState((current) => ({ ...current, queueSkippedCount: prepared.omittedCount, queueNotice: "The queue limit is 1,000 entries; existing queue and playback were left unchanged." }));
      return { queuedCount: 0, skippedCount: prepared.omittedCount, reason: "queue-limit" };
    }
    if (!prepared.tracks.length) {
      setState((current) => ({ ...current, queueSkippedCount: prepared.omittedCount, queueNotice: "No tracks from this set could be queued; the current queue and playback were left unchanged." }));
      return { queuedCount: 0, skippedCount: prepared.omittedCount, reason: "no-supported-tracks" };
    }
    const queue = insertQueueTrackNext(queueRef.current, prepared.tracks[0], state.track);
    commitQueue(queue, { queueSkippedCount: 0, queueNotice: undefined });
    return { queuedCount: 1, skippedCount: 0 };
  }, [commitQueue, state.track, workspaceID]);
  const addNextTracksToQueue = useCallback((tracks: AudioTrack[]): QueueActionResult => {
    if (workspaceRef.current !== workspaceID) return { queuedCount: 0, skippedCount: tracks.length };
    if (!tracks.length) return { queuedCount: 0, skippedCount: 0 };
    const prepared = preparePlayableQueue(tracks, workspaceID, undefined, MAX_AUDIO_QUEUE_ENTRIES - queueRef.current.length);
    if (prepared.limitExceeded) {
      setState((current) => ({ ...current, queueSkippedCount: prepared.omittedCount, queueNotice: "The queue limit is 1,000 entries; existing queue and playback were left unchanged." }));
      return { queuedCount: 0, skippedCount: prepared.omittedCount, reason: "queue-limit" };
    }
    if (!prepared.tracks.length) {
      setState((current) => ({ ...current, queueSkippedCount: prepared.omittedCount, queueNotice: tracks.length ? "No tracks from this set could be queued; the current queue and playback were left unchanged." : undefined }));
      return { queuedCount: 0, skippedCount: prepared.omittedCount, reason: "no-supported-tracks" };
    }
    let queue = queueRef.current;
    const activeTrack = activeTrackRef.current;
    for (const track of [...prepared.tracks].reverse()) queue = insertQueueTrackNext(queue, track, activeTrack);
    const notice = prepared.omittedCount ? "Some loaded tracks were omitted because they could not be played here." : undefined;
    commitQueue(queue, { queueSkippedCount: prepared.omittedCount, queueNotice: notice });
    return { queuedCount: prepared.tracks.length, skippedCount: prepared.omittedCount };
  }, [commitQueue, workspaceID]);
  const removeFromQueue = useCallback((track: AudioQueueEntry) => {
    const result = removeQueueOccurrence(queueRef.current, track, state.track);
    if (result.activeRemovalRequired) {
      setState((current) => ({ ...current, queueNotice: "Stop playback before removing the current track." }));
      return;
    }
    if (result.removed) commitQueue(result.queue);
  }, [commitQueue, state.track]);
  const removeQueuedTracks = useCallback((tracks: AudioQueueEntry[]) => {
    if (workspaceRef.current !== workspaceID) return { queue: queueRef.current, changedCount: 0, activeExcludedCount: 0 };
    const result = removeQueueOccurrences(queueRef.current, tracks, activeTrackRef.current);
    if (result.changedCount) commitQueue(result.queue);
    return result;
  }, [commitQueue, workspaceID]);
  const clearQueue = useCallback(() => commitQueue([], { queueSkippedCount: 0, queueNotice: undefined }), [commitQueue]);
  const moveQueuedTrack = useCallback((track: AudioQueueEntry, delta: -1 | 1) => commitQueue(moveQueueTrack(queueRef.current, track, delta)), [commitQueue]);
  const moveQueuedTrackNext = useCallback((track: AudioQueueEntry) => commitQueue(moveQueueOccurrenceNext(queueRef.current, track, state.track)), [commitQueue, state.track]);
  const moveQueuedTracksNext = useCallback((tracks: AudioQueueEntry[]) => {
    if (workspaceRef.current !== workspaceID) return { queue: queueRef.current, changedCount: 0, activeExcludedCount: 0 };
    const result = moveQueueOccurrencesNext(queueRef.current, tracks, activeTrackRef.current);
    if (result.changedCount && result.queue !== queueRef.current) commitQueue(result.queue);
    return result;
  }, [commitQueue, workspaceID]);
  const shuffleUpcoming = useCallback(() => commitQueue(shuffleUpcomingTracks(queueRef.current, state.track)), [commitQueue, state.track]);
  const setRepeatMode = useCallback((repeatMode: RepeatMode) => setState((current) => ({ ...current, repeatMode })), []);
  const cycleRepeatMode = useCallback(() => setState((current) => ({ ...current, repeatMode: current.repeatMode === "off" ? "all" : current.repeatMode === "all" ? "one" : "off" })), []);
  const playQueue = useCallback((tracks: AudioTrack[]): QueueActionResult => {
    const prepared = preparePlayableQueue(tracks, workspaceID);
    const skippedCount = prepared.omittedCount;
    if (prepared.limitExceeded) {
      setState((current) => ({ ...current, queueSkippedCount: skippedCount, queueNotice: "The queue limit is 1,000 entries; existing queue and playback were left unchanged." }));
      return { queuedCount: 0, skippedCount, reason: "queue-limit" };
    }
    if (prepared.tracks.length === 0) {
      const notice = tracks.length === 0 ? "No supported tracks were available; the current queue and playback were left unchanged." : "No tracks from this set could be queued; the current queue and playback were left unchanged.";
      setState((current) => ({ ...current, queueSkippedCount: skippedCount, queueNotice: notice }));
      return { queuedCount: 0, skippedCount, reason: "no-supported-tracks" };
    }
    const notice = skippedCount ? "Some loaded tracks were omitted because they could not be played here." : undefined;
    commitQueue(prepared.tracks, { queueSkippedCount: skippedCount, queueNotice: notice });
    void play(prepared.tracks[0]);
    return { queuedCount: prepared.tracks.length, skippedCount };
  }, [commitQueue, play, workspaceID]);

  const queueIndex = state.track ? state.queue.findIndex((item) => sameQueueOccurrence(item, state.track!)) : -1;
  const canPlayPrevious = queueIndex > 0;
  const canPlayNext = state.queue.length > 0 && (queueIndex < state.queue.length - 1 || state.repeatMode === "all");
  const advance = useCallback((trigger: "manual" | "ended") => {
    const action = resolveQueueAdvance(state.queue, state.track, state.repeatMode, trigger);
    if (action.kind === "play-track") void play(action.track);
    else if (action.kind === "restart-current") {
      const audio = audioRef.current;
      if (!audio || !urlRef.current) { void play(action.track); return; }
      const generation = generationRef.current;
      const url = urlRef.current;
      audio.currentTime = 0;
      setState((current) => workspaceRef.current === workspaceID && generationRef.current === generation && urlRef.current === url && current.url === url
        ? ({ ...current, currentTime: 0 })
        : current);
      void startNativePlayback(url, generation);
    } else if (trigger === "ended") stop();
  }, [play, startNativePlayback, state.queue, state.repeatMode, state.track, stop]);
  const playNext = useCallback(() => advance("manual"), [advance]);
  const handleEnded = useCallback(() => advance("ended"), [advance]);
  const playPrevious = useCallback(() => {
    const currentIndex = state.track ? state.queue.findIndex((item) => sameQueueOccurrence(item, state.track!)) : -1;
    if (currentIndex > 0) void play(state.queue[currentIndex - 1]);
    else if (currentIndex < 0 && state.queue.length) void play(state.queue[0]);
  }, [play, state.queue, state.track]);
  const setQueueOpen = useCallback((queueOpen: boolean) => setState((current) => ({ ...current, queueOpen })), []);
  const showQueue = useCallback(() => setQueueOpen(true), [setQueueOpen]);
  const syncPlaying = useCallback((_eventPlaying: boolean) => {
    const audio = audioRef.current;
    const url = urlRef.current;
    const generation = generationRef.current;
    if (!audio || !url || audio.currentSrc !== url) return;
    const pendingAttempt = nativeStartRef.current;
    if (pendingAttempt?.pending && pendingAttempt.generation === generation && pendingAttempt.url === url && pendingAttempt.workspaceID === workspaceRef.current) return;
    setState((current) => {
      const newerAttempt = nativeStartRef.current;
      return generationRef.current === generation && urlRef.current === url && workspaceRef.current === workspaceID && current.url === url &&
        !(newerAttempt?.pending && newerAttempt.generation === generation && newerAttempt.url === url && newerAttempt.workspaceID === workspaceID)
        ? ({ ...current, playing: !audio.paused })
        : current;
    });
  }, [workspaceID]);
  useEffect(() => {
    if (sleepTimerDeadline === undefined) return;
    const deadline = sleepTimerDeadline;
    const timerGeneration = sleepTimerGenerationRef.current;
    const refresh = () => {
      if (workspaceRef.current !== workspaceID || sleepTimerGenerationRef.current !== timerGeneration || sleepTimerDeadlineRef.current !== deadline) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) { stopWithNotice("The sleep timer ended and stopped playback."); return; }
      setSleepTimerRemainingMs(remaining);
      const displayedMinutes = Math.ceil(remaining / 60_000);
      const untilNextDisplayChange = remaining - (displayedMinutes - 1) * 60_000;
      if (sleepTimerTimeoutRef.current !== undefined) clearTimeout(sleepTimerTimeoutRef.current);
      sleepTimerTimeoutRef.current = setTimeout(refresh, Math.max(50, Math.min(remaining, untilNextDisplayChange)));
    };
    const refreshIfVisible = () => { if (document.visibilityState !== "hidden") refresh(); };
    refresh();
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refresh);
      if (sleepTimerGenerationRef.current === timerGeneration && sleepTimerTimeoutRef.current !== undefined) {
        clearTimeout(sleepTimerTimeoutRef.current);
        sleepTimerTimeoutRef.current = undefined;
      }
    };
  }, [sleepTimerDeadline, stopWithNotice, workspaceID]);
  useEffect(() => {
    const generation = ++generationRef.current;
    clearMedia();
    cancelSleepTimer();
    activeTrackRef.current = undefined;
    queueRef.current = [];
    setState((current) => generationRef.current === generation ? initial : current);
    return () => { generationRef.current += 1; clearMedia(); invalidateSleepTimer(); };
  }, [workspaceID, cancelSleepTimer, clearMedia, invalidateSleepTimer]);
  return { ...state, audioRef, sleepTimerMinutes, sleepTimerRemainingMs, setSleepTimer, cancelSleepTimer, dismissSleepTimerNotice, play, playQueue, stop, toggle, fail, addToQueue, addTracksToQueue, addNextToQueue, addNextTracksToQueue, removeFromQueue, removeQueuedTracks, clearQueue, moveQueuedTrack, moveQueuedTrackNext, moveQueuedTracksNext, shuffleUpcoming, setRepeatMode, cycleRepeatMode, playNext, handleEnded, playPrevious, canPlayPrevious, canPlayNext, canRepeatOne: Boolean(state.track && state.url), setCurrentTime: (currentTime: number) => setState((s) => ({ ...s, currentTime })), setDuration: (duration: number) => setState((s) => ({ ...s, duration })), setError: (error: string) => fail(error), syncPlaying, setQueueOpen, showQueue };
}
