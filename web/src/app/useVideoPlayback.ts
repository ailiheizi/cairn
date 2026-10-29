import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Translator } from "../i18n";
import type { SearchHit } from "../lib/types";
import type { MusicQueueControls } from "../lib/musicQueueControls";
import { fetchVerifiedVideo, VIDEO_PLAYBACK_LIMIT, videoMime, type VideoAsset } from "../lib/videoPlayback";

type VideoPlaybackStatus = "loading" | "ready" | "error";
export type VideoPlaybackState = {
  identity: string;
  hit: SearchHit;
  status: VideoPlaybackStatus;
  url?: string;
  error?: string;
  decodeError?: boolean;
  autoplayBlocked?: boolean;
};

export function videoFileName(hit: SearchHit): string {
  return hit.name || hit.path?.split(/[\\/]/).at(-1) || "video";
}

export function videoPlaybackIdentity(workspaceID: string, hit: SearchHit): string {
  return JSON.stringify([workspaceID, hit.subject_ref ?? "", hit.entry_id ?? "", hit.content_id ?? "", hit.logical_size ?? null, videoFileName(hit)]);
}

export function videoPlaybackAsset(workspaceID: string, hit: SearchHit): VideoAsset | undefined {
  if (!workspaceID || hit.entry_type !== "REGULAR_FILE" || !hit.entry_id || !hit.subject_ref || !videoMime(videoFileName(hit)) || !/^sha256:[a-f0-9]{64}$/.test(hit.content_id ?? "")) return undefined;
  if (!Number.isSafeInteger(hit.logical_size) || (hit.logical_size ?? -1) < 0 || (hit.logical_size ?? VIDEO_PLAYBACK_LIMIT + 1) > VIDEO_PLAYBACK_LIMIT) return undefined;
  return { workspaceID, entryID: hit.entry_id, name: videoFileName(hit), contentID: hit.content_id!, logicalSize: hit.logical_size! };
}

export function videoPlaybackUnavailableReason(workspaceID: string, hit: SearchHit, t: Translator): string | undefined {
  if (!videoMime(videoFileName(hit))) return t("Browser playback is available only for MP4 and WebM files. Open Details or download the original.");
  if (!Number.isSafeInteger(hit.logical_size) || (hit.logical_size ?? -1) < 0) return t("Playback requires a known original of at most 32 MiB");
  if ((hit.logical_size ?? 0) > VIDEO_PLAYBACK_LIMIT) return t("This original is larger than the 32 MiB video playback limit. Download the original to watch it.");
  if (!workspaceID || hit.entry_type !== "REGULAR_FILE" || !hit.entry_id || !hit.subject_ref || !/^sha256:[a-f0-9]{64}$/.test(hit.content_id ?? "")) return t("Playback requires a verified original identity.");
  return undefined;
}

function playbackError(error: unknown, t: Translator): string {
  const reason = error instanceof Error ? error.message : "";
  if (reason === "size-limit") return t("This original is larger than the 32 MiB video playback limit. Download the original to watch it.");
  if (reason === "unsupported-format") return t("Browser playback is available only for MP4 and WebM files. Download the original to watch it.");
  if (reason === "length-mismatch" || reason === "hash-mismatch" || reason === "identity-unavailable") return t("The original could not be verified for playback. Download the original instead.");
  return t("The verified video preview could not be loaded. You can still download the original.");
}

export function useVideoPlayback({
  workspaceID,
  hits,
  scopeHits = hits,
  enabled,
  queueControls,
  t,
}: {
  workspaceID: string;
  /** Video candidates that may be explicitly played. */
  hits: SearchHit[];
  /** Full visible scope identity; a changed scope disposes the current preview. */
  scopeHits?: SearchHit[];
  enabled: boolean;
  queueControls?: MusicQueueControls;
  t: Translator;
}) {
  const [playback, setPlayback] = useState<VideoPlaybackState>();
  const requestID = useRef(0);
  const attemptedStartIdentity = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const candidateIdentityKey = useMemo(() => JSON.stringify(hits.map((hit) => videoPlaybackIdentity(workspaceID, hit)).sort()), [hits, workspaceID]);
  const identities = useMemo(() => new Set<string>(JSON.parse(candidateIdentityKey) as string[]), [candidateIdentityKey]);
  const identityKey = useMemo(() => JSON.stringify([...scopeHits.map((hit) => videoPlaybackIdentity(workspaceID, hit))].sort()), [scopeHits, workspaceID]);
  const previousScopeKey = useRef(identityKey);

  function stopPlayback() {
    requestID.current += 1;
    attemptedStartIdentity.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    setPlayback(undefined);
  }

  async function preparePlayback(hit: SearchHit) {
    const identity = videoPlaybackIdentity(workspaceID, hit);
    if (!enabled || !identities.has(identity)) return;
    if (playback?.identity === identity && playback.status === "ready") {
      const player = videoRef.current;
      if (player) void player.play().catch(() => undefined);
      return;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    attemptedStartIdentity.current = null;
    const request = ++requestID.current;
    const asset = videoPlaybackAsset(workspaceID, hit);
    if (!asset) {
      setPlayback({ identity, hit, status: "error", error: videoPlaybackUnavailableReason(workspaceID, hit, t) ?? t("This file is unsupported or exceeds the 32 MiB video playback limit. Download the original to watch it.") });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setPlayback({ identity, hit, status: "loading" });
    try {
      const blob = await fetchVerifiedVideo(asset, controller.signal);
      if (request !== requestID.current || controller.signal.aborted || !enabled || !identities.has(identity)) return;
      const url = URL.createObjectURL(blob);
      setPlayback({ identity, hit, status: "ready", url });
    } catch (error) {
      if (request !== requestID.current || controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setPlayback({ identity, hit, status: "error", error: playbackError(error, t) });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function handleVideoPlay() {
    if (["starting", "playing"].includes(queueControls?.currentPlayback?.status ?? "")) queueControls?.toggleCurrentPlayback?.();
  }

  function markDecodeError(identity: string) {
    setPlayback((current) => current?.identity === identity ? { ...current, decodeError: true } : current);
  }

  const startPlayback = useCallback((identity: string) => {
    const current = playbackRef.current;
    const player = videoRef.current;
    if (!enabledRef.current || !player || current?.identity !== identity || current.status !== "ready" || !current.url || player.src !== current.url || player.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || attemptedStartIdentity.current === identity) return;
    attemptedStartIdentity.current = identity;
    void player.play().catch(() => setPlayback((latest) => latest?.identity === identity ? { ...latest, autoplayBlocked: true } : latest));
  }, []);

  useEffect(() => {
    const url = playback?.url;
    if (!url) return undefined;
    return () => URL.revokeObjectURL(url);
  }, [playback?.url]);

  useLayoutEffect(() => {
    const scopeChanged = previousScopeKey.current !== identityKey;
    previousScopeKey.current = identityKey;
    if ((!enabled && (playback || abortRef.current)) || (enabled && (scopeChanged || (playback && !identities.has(playback.identity))))) stopPlayback();
  }, [enabled, identityKey, candidateIdentityKey, identities, playback?.identity]);

  useEffect(() => () => {
    requestID.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    const status = queueControls?.currentPlayback?.status;
    if (status === "starting" || status === "playing") videoRef.current?.pause();
  }, [queueControls?.currentPlayback?.status]);

  useEffect(() => {
    if (!enabled || playback?.status !== "ready" || !playback.url || !identities.has(playback.identity)) return;
    startPlayback(playback.identity);
  }, [enabled, candidateIdentityKey, identities, playback?.identity, playback?.status, playback?.url, startPlayback]);

  return { playback, videoRef, preparePlayback, stopPlayback, startPlayback, handleVideoPlay, markDecodeError };
}
