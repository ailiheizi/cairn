import { useCallback, useEffect, useRef, useState } from "react";
import { fetchVerifiedAudio, type AudioQueueEntry, type AudioTrack } from "../lib/audioPlayback";
import { insertQueueTrackNext, isPlayableQueueTrack, MAX_AUDIO_QUEUE_ENTRIES, moveQueueTrack, preparePlayableQueue, removeQueueOccurrence, resolveQueueAdvance, sameQueueOccurrence, shuffleUpcomingTracks, type QueueTrack, type RepeatMode } from "../lib/playbackQueue";

type Playback = { queue: AudioQueueEntry[]; queueOpen: boolean; queueSkippedCount: number; queueNotice?: string; repeatMode: RepeatMode; track?: QueueTrack; url?: string; loading: boolean; error?: string; playing: boolean; currentTime: number; duration: number };
const initial: Playback = { queue: [], queueOpen: false, repeatMode: "off", queueSkippedCount: 0, loading: false, playing: false, currentTime: 0, duration: 0 };
type QueueActionResult = { queuedCount: number; skippedCount: number; reason?: "no-supported-tracks" | "queue-limit" };
function isGestureDenied(error: unknown): boolean { return error instanceof DOMException && error.name === "NotAllowedError"; }

export function useAudioPlayback(workspaceID: string) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const requestRef = useRef<AbortController | undefined>(undefined);
  const urlRef = useRef<string | undefined>(undefined);
  const generationRef = useRef(0);
  const queueRef = useRef<AudioQueueEntry[]>([]);
  const [state, setState] = useState<Playback>(initial);
  const commitQueue = useCallback((queue: AudioQueueEntry[], patch: Partial<Playback> = {}) => {
    queueRef.current = queue;
    setState((current) => ({ ...current, ...patch, queue }));
  }, []);
  const clearMedia = useCallback(() => {
    requestRef.current?.abort(); requestRef.current = undefined;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.removeAttribute("src"); audioRef.current.load(); }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = undefined;
  }, []);
  const stop = useCallback(() => {
    const generation = ++generationRef.current;
    clearMedia();
    setState((current) => generationRef.current === generation
      ? ({ ...initial, queue: current.queue, queueOpen: current.queueOpen, repeatMode: current.repeatMode, queueSkippedCount: current.queueSkippedCount, queueNotice: current.queueNotice })
      : current);
  }, [clearMedia]);
  const fail = useCallback((error: string) => {
    const generation = ++generationRef.current;
    clearMedia();
    setState((current) => generationRef.current === generation
      ? ({ ...current, url: undefined, loading: false, playing: false, error })
      : current);
  }, [clearMedia]);
  const play = useCallback(async (track: QueueTrack) => {
    if (!isPlayableQueueTrack(track, workspaceID)) {
      const reason = track.workspaceID !== workspaceID ? "workspace-mismatch" : "track-unavailable";
      fail(reason);
      const generation = generationRef.current;
      setState((current) => generationRef.current === generation
        ? ({ ...current, track, url: undefined, loading: false, playing: false, error: reason })
        : current);
      return;
    }
    generationRef.current += 1; const generation = generationRef.current; clearMedia();
    const controller = new AbortController(); requestRef.current = controller;
    setState((current) => ({ ...initial, queue: current.queue, queueOpen: current.queueOpen, repeatMode: current.repeatMode, queueSkippedCount: current.queueSkippedCount, queueNotice: current.queueNotice, track, loading: true }));
    try {
      const blob = await fetchVerifiedAudio(track, controller.signal);
      if (generationRef.current !== generation || requestRef.current !== controller) return;
      requestRef.current = undefined;
      const url = URL.createObjectURL(blob); urlRef.current = url;
      setState((current) => generationRef.current === generation && urlRef.current === url
        ? ({ ...current, track, url, loading: false, playing: false, currentTime: 0, duration: 0 })
        : current);
      const audio = audioRef.current;
      if (audio) {
        audio.src = url;
        try {
          await audio.play();
          setState((current) => generationRef.current === generation && urlRef.current === url ? ({ ...current, playing: true }) : current);
        }
        catch (error) {
          if (generationRef.current !== generation || urlRef.current !== url) return;
          if (isGestureDenied(error)) setState((current) => generationRef.current === generation && urlRef.current === url ? ({ ...current, error: "playback-permission", playing: false }) : current);
          else fail(error instanceof Error ? error.message : "unsupported-format");
        }
      }
    } catch (error) {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      const reason = error instanceof Error ? error.message : "playback-failed";
      const failureGeneration = ++generationRef.current;
      clearMedia();
      setState((current) => generationRef.current === failureGeneration
        ? ({ ...current, track, url: undefined, loading: false, playing: false, error: reason })
        : current);
    }
  }, [clearMedia, fail, workspaceID]);
  const toggle = useCallback(async () => {
    const audio = audioRef.current; const url = urlRef.current; const generation = generationRef.current;
    if (!audio || !url) return;
    if (audio.paused) {
      try {
        await audio.play();
        setState((current) => generationRef.current === generation && urlRef.current === url ? ({ ...current, playing: true, error: undefined }) : current);
      }
      catch (error) { if (generationRef.current === generation && urlRef.current === url) { if (isGestureDenied(error)) setState((current) => generationRef.current === generation && urlRef.current === url ? ({ ...current, error: "playback-permission" }) : current); else fail(error instanceof Error ? error.message : "unsupported-format"); } }
    } else { audio.pause(); setState((current) => ({ ...current, playing: false })); }
  }, [fail]);

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
  const removeFromQueue = useCallback((track: AudioQueueEntry) => {
    const result = removeQueueOccurrence(queueRef.current, track, state.track);
    if (result.activeRemovalRequired) {
      setState((current) => ({ ...current, queueNotice: "Stop playback before removing the current track." }));
      return;
    }
    if (result.removed) commitQueue(result.queue);
  }, [commitQueue, state.track]);
  const clearQueue = useCallback(() => commitQueue([], { queueSkippedCount: 0, queueNotice: undefined }), [commitQueue]);
  const moveQueuedTrack = useCallback((track: AudioQueueEntry, delta: -1 | 1) => commitQueue(moveQueueTrack(queueRef.current, track, delta)), [commitQueue]);
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
      setState((current) => ({ ...current, currentTime: 0 }));
      void audio.play().then(() => {
        setState((current) => generationRef.current === generation && urlRef.current === url ? ({ ...current, playing: true, error: undefined }) : current);
      }).catch((error) => {
        if (generationRef.current !== generation || urlRef.current !== url) return;
        if (isGestureDenied(error)) setState((current) => ({ ...current, playing: false, error: "playback-permission" }));
        else fail(error instanceof Error ? error.message : "unsupported-format");
      });
    } else if (trigger === "ended") stop();
  }, [fail, play, state.queue, state.repeatMode, state.track, stop]);
  const playNext = useCallback(() => advance("manual"), [advance]);
  const handleEnded = useCallback(() => advance("ended"), [advance]);
  const playPrevious = useCallback(() => {
    const currentIndex = state.track ? state.queue.findIndex((item) => sameQueueOccurrence(item, state.track!)) : -1;
    if (currentIndex > 0) void play(state.queue[currentIndex - 1]);
    else if (currentIndex < 0 && state.queue.length) void play(state.queue[0]);
  }, [play, state.queue, state.track]);
  const setQueueOpen = useCallback((queueOpen: boolean) => setState((current) => ({ ...current, queueOpen })), []);
  const showQueue = useCallback(() => setQueueOpen(true), [setQueueOpen]);
  useEffect(() => {
    const generation = ++generationRef.current;
    clearMedia();
    queueRef.current = [];
    setState((current) => generationRef.current === generation ? initial : current);
    return () => { generationRef.current += 1; clearMedia(); };
  }, [workspaceID, clearMedia]);
  return { ...state, audioRef, play, playQueue, stop, toggle, fail, addToQueue, addTracksToQueue, addNextToQueue, removeFromQueue, clearQueue, moveQueuedTrack, shuffleUpcoming, setRepeatMode, cycleRepeatMode, playNext, handleEnded, playPrevious, canPlayPrevious, canPlayNext, canRepeatOne: Boolean(state.track && state.url), setCurrentTime: (currentTime: number) => setState((s) => ({ ...s, currentTime })), setDuration: (duration: number) => setState((s) => ({ ...s, duration })), setError: (error: string) => fail(error), syncPlaying: (playing: boolean) => setState((s) => ({ ...s, playing })), setQueueOpen, showQueue };
}
