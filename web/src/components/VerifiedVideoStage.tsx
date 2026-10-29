import { useEffect, useRef, useState } from "react";
import type Artplayer from "artplayer";
import { Film, X } from "lucide-react";
import type { RefObject } from "react";
import type { Translator } from "../i18n";
import type { VideoPlaybackState } from "../app/useVideoPlayback";
import { useWorkspaceBrowseValue } from "../app/ClientBrowseSession";
import { captureVerifiedVideoPoster, videoPosterIdentity, VIDEO_POSTER_SESSION_KEY, type VideoPosterSnapshot } from "../lib/videoPoster";
import "./VerifiedVideoStage.css";

export function VerifiedVideoStage({ t, workspaceID, playback, videoRef, onClose, onPlay, onPlayerReady, onDecodeError }: {
  t: Translator;
  workspaceID: string;
  playback: VideoPlaybackState;
  videoRef: RefObject<HTMLVideoElement | null>;
  onClose: () => void;
  onPlay: () => void;
  onPlayerReady: (identity: string) => void;
  onDecodeError: (identity: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<Artplayer | null>(null);
  const generationRef = useRef(0);
  const [poster, setPoster] = useWorkspaceBrowseValue<VideoPosterSnapshot | undefined>(VIDEO_POSTER_SESSION_KEY, undefined);
  const posterRef = useRef(poster);
  const setPosterRef = useRef(setPoster);
  const callbacksRef = useRef({ onPlay, onPlayerReady, onDecodeError, t });
  const [playerError, setPlayerError] = useState<string>();
  posterRef.current = poster;
  setPosterRef.current = setPoster;
  callbacksRef.current = { onPlay, onPlayerReady, onDecodeError, t };

  const identity = playback.identity;
  const url = playback.url;
  const lang = t("Play") === "播放" ? "zh-cn" : "en";

  useEffect(() => {
    const container = containerRef.current;
    if (!container || playback.status !== "ready" || !url || !url.startsWith("blob:")) return;
    let live = true;
    const generation = ++generationRef.current;
    let player: Artplayer | null = null;
    let frameCallbackID: number | undefined;
    let posterCaptureAttempted = false;
    const posterIdentity = videoPosterIdentity(workspaceID, playback.hit);
    const currentPoster = posterRef.current?.identity === posterIdentity ? posterRef.current : undefined;

    const isCurrent = () => {
      const currentPlayer = player;
      return Boolean(live
        && generationRef.current === generation
        && instanceRef.current === currentPlayer
        && currentPlayer
        && !currentPlayer.isDestroy
        && currentPlayer.video === videoRef.current
        && currentPlayer.video.src === url);
    };

    const capturePoster = () => {
      if (posterCaptureAttempted || currentPoster || !player || !isCurrent()) return;
      const video = player.video;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) return;
      posterCaptureAttempted = true;
      const capture = () => {
        frameCallbackID = undefined;
        if (!isCurrent() || player?.video !== video || video.src !== url) return;
        void captureVerifiedVideoPoster(video, posterIdentity).then((snapshot) => {
          if (!snapshot || !isCurrent() || player?.video !== video || video.src !== url || posterRef.current?.identity === posterIdentity) return;
          setPosterRef.current((existing: VideoPosterSnapshot | undefined) => existing?.identity === posterIdentity ? existing : snapshot);
        });
      };
      if (typeof video.requestVideoFrameCallback === "function") {
        frameCallbackID = video.requestVideoFrameCallback(capture);
      } else {
        capture();
      }
    };

    if (videoRef.current) videoRef.current = null;
    setPlayerError(undefined);
    void import("artplayer").then(({ default: ArtplayerConstructor }) => {
      if (!live || generationRef.current !== generation || !container.isConnected) return;
      try {
        // ArtPlayer's built-in right-click menu includes a link to artplayer.org.
        // This local-only player does not need that outbound navigation.
        ArtplayerConstructor.CONTEXTMENU = false;
        player = new ArtplayerConstructor({
          id: "cairn-verified-video",
          container,
          url,
          poster: currentPoster?.dataURL ?? "",
          theme: "#8fa786",
          lang,
          autoplay: false,
          autoPlayback: false,
          hotkey: true,
          playbackRate: true,
          setting: true,
          pip: true,
          fullscreen: true,
          fullscreenWeb: true,
          playsInline: true,
          subtitleOffset: false,
          screenshot: false,
          airplay: false,
          autoMini: false,
          loop: false,
          mutex: false,
          contextmenu: [],
        });
        instanceRef.current = player;
        videoRef.current = player.video;
        player.on("ready", () => {
          if (isCurrent()) callbacksRef.current.onPlayerReady(identity);
        });
        player.on("video:play", () => {
          if (isCurrent()) callbacksRef.current.onPlay();
        });
        player.on("video:playing", capturePoster);
        player.on("video:timeupdate", capturePoster);
        player.on("video:error", () => {
          if (isCurrent()) callbacksRef.current.onDecodeError(identity);
        });
      } catch {
        setPlayerError(callbacksRef.current.t("The verified video preview could not be loaded. You can still download the original."));
      }
    }).catch(() => {
      if (live && generationRef.current === generation) setPlayerError(callbacksRef.current.t("The verified video preview could not be loaded. You can still download the original."));
    });

    return () => {
      live = false;
      if (generationRef.current === generation) generationRef.current += 1;
      if (frameCallbackID !== undefined && player && typeof player.video.cancelVideoFrameCallback === "function") player.video.cancelVideoFrameCallback(frameCallbackID);
      if (instanceRef.current === player) instanceRef.current = null;
      if (player && videoRef.current === player.video) videoRef.current = null;
      player?.destroy();
    };
  }, [workspaceID, identity, url]);

  useEffect(() => {
    const player = instanceRef.current;
    if (!player) return;
    player.option.lang = lang;
    player.i18n.init();
  }, [lang]);

  return <section className="verified-video-stage" aria-label={t("Video playback")}>
    <div className="verified-video-stage__heading">
      <div><Film size={16} aria-hidden="true" /><strong>{playback.hit.name || playback.hit.path?.split(/[\\/]/).at(-1) || t("Untitled video")}</strong></div>
      <button type="button" onClick={onClose} aria-label={t("Close video playback")} title={t("Close video playback")}><X size={16} /><span>{t("Close")}</span></button>
    </div>
    {playback.status === "loading" && <div className="verified-video-stage__message" role="status">{t("Downloading and verifying the complete original before playback…")}</div>}
    {playback.status === "error" && <div className="verified-video-stage__message is-error" role="status">{playback.error}</div>}
    {playback.status === "ready" && playback.url && <>
      <div ref={containerRef} className="verified-video-stage__player" aria-label={t("Video player: {{name}}", { name: playback.hit.name || playback.hit.path?.split(/[\\/]/).at(-1) || t("Untitled video") })} />
      {playerError && <p className="verified-video-stage__message is-error" role="status">{playerError}</p>}
      {playback.autoplayBlocked && <p className="verified-video-stage__message" role="status">{t("The verified preview is ready. Press Play in the video controls to begin.")}</p>}
      {playback.decodeError && <p className="verified-video-stage__message is-error" role="status">{t("This browser could not decode this file. The verified original is still available to download.")}</p>}
      <p className="verified-video-stage__verified">{t("Complete length and SHA-256 verified before this temporary preview was created.")}</p>
    </>}
  </section>;
}
