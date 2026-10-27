import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Film, Play, X } from "lucide-react";
import type { Translator } from "../i18n";
import type { SearchHit } from "../lib/types";
import { formatBytes, formatFacetValue, mediaClassFromSuffix } from "../lib/format";
import type { MusicQueueControls } from "../lib/musicQueueControls";
import { downloadOriginal } from "../lib/contentDownload";
import { fetchVerifiedVideo, VIDEO_PLAYBACK_LIMIT, videoMime, type VideoAsset } from "../lib/videoPlayback";
import "./VideoLibraryExperience.css";

type PlaybackState = {
  identity: string;
  hit: SearchHit;
  status: "loading" | "ready" | "error";
  url?: string;
  error?: string;
  decodeError?: boolean;
  autoplayBlocked?: boolean;
};

function assetIdentity(workspaceID: string, hit: SearchHit) {
  return `${workspaceID}\u0000${hit.subject_ref ?? ""}\u0000${hit.entry_id ?? ""}\u0000${hit.content_id ?? ""}\u0000${videoFileName(hit)}`;
}

function videoFileName(hit: SearchHit) {
  return hit.name || hit.path?.split(/[\\/]/).at(-1) || "video";
}

function videoHits(hits: SearchHit[]) {
  return hits.filter((hit) => hit.entry_type === "REGULAR_FILE" && mediaClassFromSuffix(formatFacetValue(hit)) === "video");
}

function playbackAsset(workspaceID: string, hit: SearchHit): VideoAsset | undefined {
  if (!workspaceID || hit.entry_type !== "REGULAR_FILE" || !hit.entry_id || !hit.subject_ref || !videoMime(videoFileName(hit)) || !/^sha256:[a-f0-9]{64}$/.test(hit.content_id ?? "")) return undefined;
  if (!Number.isSafeInteger(hit.logical_size) || (hit.logical_size ?? -1) < 0 || (hit.logical_size ?? VIDEO_PLAYBACK_LIMIT + 1) > VIDEO_PLAYBACK_LIMIT) return undefined;
  return { workspaceID, entryID: hit.entry_id, name: videoFileName(hit), contentID: hit.content_id!, logicalSize: hit.logical_size! };
}

function playbackError(error: unknown, t: Translator) {
  const reason = error instanceof Error ? error.message : "";
  if (reason === "size-limit") return t("This original is larger than the 32 MiB video playback limit. Download the original to watch it.");
  if (reason === "unsupported-format") return t("Browser playback is available only for MP4 and WebM files. Download the original to watch it.");
  if (reason === "length-mismatch" || reason === "hash-mismatch" || reason === "identity-unavailable") return t("The original could not be verified for playback. Download the original instead.");
  return t("The verified video preview could not be loaded. You can still download the original.");
}

export function VideoLibraryExperience({ t, workspaceID, hits, onOpenHit, queueControls }: {
  t: Translator;
  workspaceID: string;
  hits: SearchHit[];
  onOpenHit: (hit: SearchHit) => void;
  queueControls?: MusicQueueControls;
}) {
  const videos = useMemo(() => videoHits(hits), [hits]);
  const [playback, setPlayback] = useState<PlaybackState>();
  const requestID = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  function stopPlayback() {
    requestID.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setPlayback(undefined);
  }

  async function preparePlayback(hit: SearchHit) {
    const identity = assetIdentity(workspaceID, hit);
    if (playback?.identity === identity && playback.status === "ready") {
      const player = videoRef.current;
      if (player) void player.play().catch(() => undefined);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const request = ++requestID.current;
    const asset = playbackAsset(workspaceID, hit);
    if (!asset) {
      setPlayback({ identity, hit, status: "error", error: t("This file is unsupported or exceeds the 32 MiB video playback limit. Download the original to watch it.") });
      return;
    }
    setPlayback({ identity, hit, status: "loading" });
    try {
      const blob = await fetchVerifiedVideo(asset, controller.signal);
      if (request !== requestID.current || controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      setPlayback({ identity, hit, status: "ready", url });
    } catch (error) {
      if (request !== requestID.current || controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setPlayback({ identity, hit, status: "error", error: playbackError(error, t) });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  useEffect(() => {
    const url = playback?.url;
    if (!url) return undefined;
    return () => URL.revokeObjectURL(url);
  }, [playback?.url]);

  useEffect(() => () => {
    requestID.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    if (playback && !videos.some((hit) => assetIdentity(workspaceID, hit) === playback.identity)) stopPlayback();
  }, [videos, playback?.identity, workspaceID]);

  useEffect(() => {
    const status = queueControls?.currentPlayback?.status;
    if (status === "starting" || status === "playing") videoRef.current?.pause();
  }, [queueControls?.currentPlayback?.status]);

  useEffect(() => {
    if (playback?.status !== "ready" || !playback.url) return;
    const player = videoRef.current;
    if (!player) return;
    void player.play().catch(() => setPlayback((current) => current?.identity === playback.identity ? { ...current, autoplayBlocked: true } : current));
  }, [playback?.status, playback?.url]);

  return <section className="video-library" aria-label={t("Videos")}>
    <header className="video-library__heading">
      <div><p className="eyebrow">{t("YOUR LIBRARY")}</p><h1>{t("Videos")}</h1></div>
      <p>{t("{{count}} videos in the current loaded results", { count: videos.length })}</p>
    </header>

    {playback && <section className="video-library__stage" aria-label={t("Video playback")}>
      <div className="video-library__stage-heading">
        <div><Film size={16} aria-hidden="true" /><strong>{videoFileName(playback.hit)}</strong></div>
        <button type="button" className="video-library__close" onClick={stopPlayback} aria-label={t("Close video playback")}><X size={16} />{t("Close")}</button>
      </div>
      {playback.status === "loading" && <p className="video-library__status" role="status">{t("Downloading and verifying the complete original before playback…")}</p>}
      {playback.status === "error" && <p className="video-library__status is-error" role="status">{playback.error}</p>}
      {playback.status === "ready" && playback.url && <>
        <video
          ref={videoRef}
          key={playback.identity}
          className="video-library__player"
          src={playback.url}
          controls
          playsInline
          preload="metadata"
          aria-label={t("Video player: {{name}}", { name: videoFileName(playback.hit) })}
          onPlay={() => { if (["starting", "playing"].includes(queueControls?.currentPlayback?.status ?? "")) queueControls?.toggleCurrentPlayback?.(); }}
          onError={() => setPlayback((current) => current?.identity === playback.identity ? { ...current, decodeError: true } : current)}
        />
        {playback.autoplayBlocked && <p className="video-library__status" role="status">{t("The verified preview is ready. Press Play in the video controls to begin.")}</p>}
        {playback.decodeError && <p className="video-library__status is-error" role="status">{t("This browser could not decode this file. The verified original is still available to download.")}</p>}
        <p className="video-library__verified">{t("Complete length and SHA-256 verified before this temporary preview was created.")}</p>
      </>}
    </section>}

    {videos.length === 0 ? <div className="video-library__empty" role="status"><Film size={24} aria-hidden="true" /><h2>{t("No videos in the current loaded results")}</h2><p>{t("Videos shows video files already present in the current Library scope.")}</p></div> : <ul className="video-library__choices" aria-label={t("Videos in the current loaded results")}>
      {videos.map((hit) => {
        const identity = assetIdentity(workspaceID, hit);
        const asset = playbackAsset(workspaceID, hit);
        const canDownload = Boolean(workspaceID && hit.entry_id && hit.entry_type === "REGULAR_FILE" && /^sha256:[a-f0-9]{64}$/.test(hit.content_id ?? ""));
        const isActive = playback?.identity === identity;
        const size = Number.isSafeInteger(hit.logical_size) && (hit.logical_size ?? -1) >= 0 ? formatBytes(hit.logical_size!) : t("Size unavailable");
        const playUnavailableReason = !videoMime(videoFileName(hit))
          ? t("Browser playback is available only for MP4 and WebM files. Open Details or download the original.")
          : !asset && Number.isSafeInteger(hit.logical_size) && (hit.logical_size ?? -1) > VIDEO_PLAYBACK_LIMIT
            ? t("This original is larger than the 32 MiB video playback limit. Download the original to watch it.")
            : !asset && (!Number.isSafeInteger(hit.logical_size) || (hit.logical_size ?? -1) < 0)
              ? t("Playback requires a known original of at most 32 MiB")
              : !asset ? t("Playback requires a verified original identity.") : "";
        return <li className={`video-library__choice${isActive ? " is-active" : ""}`} key={identity}>
          <div className="video-library__choice-info"><Film size={17} aria-hidden="true" /><div><h2>{videoFileName(hit)}</h2><p>{size} · {formatFacetValue(hit).toUpperCase() || t("Format unavailable")}</p>{playUnavailableReason && <small>{playUnavailableReason}</small>}</div></div>
          <div className="video-library__choice-actions">
            <button type="button" className="primary-button" aria-label={t("Verify and play {{name}}", { name: videoFileName(hit) })} disabled={!asset || isActive && playback?.status === "loading"} onClick={() => void preparePlayback(hit)} title={asset ? t("Downloads and verifies the complete original before playback") : playUnavailableReason}>{isActive && playback?.status === "loading" ? <><Play size={14} />{t("Verifying…")}</> : isActive && playback?.status === "ready" ? <><Play size={14} />{t("Play again")}</> : <><Play size={14} />{t("Verify and play")}</>}</button>
            <button type="button" className="secondary-button compact" aria-label={t("Open details for {{name}}", { name: videoFileName(hit) })} onClick={() => onOpenHit(hit)}>{t("Details")}</button>
            <button type="button" className="secondary-button compact" aria-label={t("Download original {{name}}", { name: videoFileName(hit) })} disabled={!canDownload} onClick={() => downloadOriginal(workspaceID, hit.entry_id!, videoFileName(hit))}><Download size={14} />{t("Download original")}</button>
          </div>
        </li>;
      })}
    </ul>}
  </section>;
}
