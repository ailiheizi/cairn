import { useMemo } from "react";
import { ArrowLeft, ArrowRight, Download, Film, Play, RotateCcw, Search } from "lucide-react";
import { useClientBrowseValue, useWorkspaceBrowseValue } from "../app/ClientBrowseSession";
import type { Translator } from "../i18n";
import type { SearchHit } from "../lib/types";
import { formatBytes, formatFacetValue, mediaClassFromSuffix } from "../lib/format";
import type { MusicQueueControls } from "../lib/musicQueueControls";
import { downloadOriginal } from "../lib/contentDownload";
import { useVideoPlayback, videoFileName, videoPlaybackAsset, videoPlaybackIdentity, videoPlaybackUnavailableReason } from "../app/useVideoPlayback";
import { videoPosterIdentity, VIDEO_POSTER_SESSION_KEY, type VideoPosterSnapshot } from "../lib/videoPoster";
import { VerifiedVideoStage } from "./VerifiedVideoStage";
import "./VideoLibraryExperience.css";

type VideoSort = "library" | "name" | "size";

function videoHits(hits: SearchHit[]) {
  return hits.filter((hit) => hit.entry_type === "REGULAR_FILE" && mediaClassFromSuffix(formatFacetValue(hit)) === "video");
}

function canDownloadOriginal(workspaceID: string, hit: SearchHit): boolean {
  return Boolean(workspaceID && hit.entry_id && hit.entry_type === "REGULAR_FILE" && /^sha256:[a-f0-9]{64}$/.test(hit.content_id ?? ""));
}

export function VideoLibraryExperience({ t, workspaceID, hits, onOpenHit, queueControls }: {
  t: Translator;
  workspaceID: string;
  hits: SearchHit[];
  onOpenHit: (hit: SearchHit) => void;
  queueControls?: MusicQueueControls;
}) {
  const videos = videoHits(hits);
  const [query, setQuery] = useClientBrowseValue("videos", "query", "");
  const [sort, setSort] = useClientBrowseValue<VideoSort>("videos", "sort", "library");
  const [poster] = useWorkspaceBrowseValue<VideoPosterSnapshot | undefined>(VIDEO_POSTER_SESSION_KEY, undefined);
  const { playback, videoRef, preparePlayback, stopPlayback, startPlayback, handleVideoPlay, markDecodeError } = useVideoPlayback({ workspaceID, hits: videos, scopeHits: hits, enabled: true, queueControls, t });

  const visibleVideos = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const matches = videos.flatMap((hit, index) => {
      if (needle && !videoFileName(hit).toLocaleLowerCase().includes(needle)) return [];
      return [{ hit, index }];
    });
    if (sort === "name") matches.sort((left, right) => videoFileName(left.hit).localeCompare(videoFileName(right.hit), undefined, { numeric: true, sensitivity: "base" }) || left.index - right.index);
    if (sort === "size") matches.sort((left, right) => {
      const leftSize = Number.isSafeInteger(left.hit.logical_size) && (left.hit.logical_size ?? -1) >= 0 ? left.hit.logical_size! : undefined;
      const rightSize = Number.isSafeInteger(right.hit.logical_size) && (right.hit.logical_size ?? -1) >= 0 ? right.hit.logical_size! : undefined;
      if (leftSize === undefined) return rightSize === undefined ? left.index - right.index : 1;
      if (rightSize === undefined) return -1;
      return leftSize - rightSize || left.index - right.index;
    });
    return matches.map(({ hit }) => hit);
  }, [query, sort, videos]);

  const visiblePlayableVideos = useMemo(() => visibleVideos.filter((hit) => Boolean(videoPlaybackAsset(workspaceID, hit))), [visibleVideos, workspaceID]);
  const idleFeaturedVideo = visibleVideos[0];
  const idleFeaturedAsset = idleFeaturedVideo ? videoPlaybackAsset(workspaceID, idleFeaturedVideo) : undefined;
  const matchingIdlePoster = idleFeaturedVideo && poster?.identity === videoPosterIdentity(workspaceID, idleFeaturedVideo) ? poster : undefined;
  const activeIsVisible = Boolean(playback && visibleVideos.some((hit) => videoPlaybackIdentity(workspaceID, hit) === playback.identity));
  const currentPlayableIndex = playback ? visiblePlayableVideos.findIndex((hit) => videoPlaybackIdentity(workspaceID, hit) === playback.identity) : -1;
  const previousVideo = currentPlayableIndex > 0 ? visiblePlayableVideos[currentPlayableIndex - 1] : undefined;
  const nextVideo = currentPlayableIndex >= 0 && currentPlayableIndex < visiblePlayableVideos.length - 1 ? visiblePlayableVideos[currentPlayableIndex + 1] : undefined;
  const clearView = () => { setQuery(""); setSort("library"); };

  return <section className="video-library" aria-label={t("Videos")}>
    <header className="video-library__heading">
      <div><p className="eyebrow">{t("YOUR LIBRARY")}</p><h1>{t("Videos")}</h1></div>
      <p>{t("{{visible}} shown · {{total}} loaded", { visible: visibleVideos.length, total: videos.length })}</p>
    </header>

    <div className="video-library__toolbar" role="search">
      <label className="video-library__search"><Search size={16} aria-hidden="true" /><span className="sr-only">{t("Search video filenames")}</span><input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={t("Find a video by filename")} /></label>
      <label className="video-library__sort"><span>{t("Sort videos")}</span><select value={sort} onChange={(event) => setSort(event.currentTarget.value as VideoSort)}>
        <option value="library">{t("Videos: library order")}</option>
        <option value="name">{t("Videos: name, A to Z")}</option>
        <option value="size">{t("Videos: size, smallest first")}</option>
      </select></label>
      {(query || sort !== "library") && <button type="button" className="video-library__reset" onClick={clearView}><RotateCcw size={14} />{t("Reset")}</button>}
    </div>

    <div className="video-library__room">
      <section className="video-library__main" aria-label={t("Video viewing room")}>
        {playback
          ? <VerifiedVideoStage t={t} workspaceID={workspaceID} playback={playback} videoRef={videoRef} onClose={stopPlayback} onPlay={handleVideoPlay} onPlayerReady={startPlayback} onDecodeError={markDecodeError} />
          : <section className="video-library__idle" aria-label={t("Video playback")}>
            {idleFeaturedVideo ? <>
              <div className="video-library__idle-art">{matchingIdlePoster ? <img src={matchingIdlePoster.dataURL} alt="" /> : <Film size={30} aria-hidden="true" />}</div>
              <div className="video-library__idle-copy"><p className="eyebrow">{t("READY WHEN YOU ARE")}</p><h2>{videoFileName(idleFeaturedVideo)}</h2><p>{Number.isSafeInteger(idleFeaturedVideo.logical_size) && (idleFeaturedVideo.logical_size ?? -1) >= 0 ? formatBytes(idleFeaturedVideo.logical_size!) : t("Size unavailable")} · {formatFacetValue(idleFeaturedVideo).toUpperCase() || t("Format unavailable")}</p></div>
              {idleFeaturedAsset
                ? <button type="button" className="video-library__featured-watch" onClick={() => void preparePlayback(idleFeaturedVideo)}><Play size={15} />{t("Watch")}</button>
                : <p className="video-library__idle-note">{t("Browser playback is unavailable for this file. Details and original download are available in its list row.")}</p>}
              <p className="video-library__idle-note">{t("Originals are read only after you choose to watch or download one.")}</p>
            </> : <>
              <div className="video-library__idle-art"><Film size={30} aria-hidden="true" /></div>
              <h2>{t("Your viewing room")}</h2>
              <p>{videos.length ? t("No video filenames match this search.") : t("Videos shows video files already present in the current Library scope.")}</p>
              {videos.length > 0 && <button type="button" className="secondary-button compact" onClick={clearView}>{t("Clear search and reset sort")}</button>}
              <p className="video-library__idle-note">{t("Originals are read only after you choose to watch or download one.")}</p>
            </>}
          </section>}
        {playback && <div className="video-library__transport" aria-label={t("Video navigation")}>
          <button type="button" className="secondary-button compact" disabled={!previousVideo} onClick={() => previousVideo && void preparePlayback(previousVideo)}><ArrowLeft size={15} />{t("Previous video")}</button>
          <span>{currentPlayableIndex >= 0 ? t("{{current}} of {{total}} supported visible videos", { current: currentPlayableIndex + 1, total: visiblePlayableVideos.length }) : t("Current video is outside this visible list")}</span>
          <button type="button" className="secondary-button compact" disabled={!nextVideo} onClick={() => nextVideo && void preparePlayback(nextVideo)}>{t("Next video")}<ArrowRight size={15} /></button>
        </div>}
        {playback && !activeIsVisible && <div className="video-library__hidden-current" role="status">
          <p>{t("The current video is hidden by this filename search. Reveal it to return to its row and navigation.")}</p>
          <button type="button" className="secondary-button compact" onClick={() => setQuery("")}>{t("Reveal current video")}</button>
        </div>}
      </section>

      <aside className="video-library__list" aria-label={t("Videos in the current loaded results")}>
        <div className="video-library__list-heading"><div><h2>{t("Your videos")}</h2><p>{t("{{count}} visible", { count: visibleVideos.length })}</p></div></div>
        {videos.length === 0
          ? <div className="video-library__list-empty" role="status"><Film size={20} aria-hidden="true" /><p>{t("No videos in the current loaded results")}</p></div>
          : visibleVideos.length === 0
            ? <div className="video-library__list-empty" role="status"><p>{t("No video filenames match this search.")}</p><button type="button" className="secondary-button compact" onClick={clearView}>{t("Clear search and reset sort")}</button></div>
            : <ul className="video-library__choices">
              {visibleVideos.map((hit) => {
                const identity = videoPlaybackIdentity(workspaceID, hit);
                const asset = videoPlaybackAsset(workspaceID, hit);
                const canDownload = canDownloadOriginal(workspaceID, hit);
                const isActive = playback?.identity === identity;
                const size = Number.isSafeInteger(hit.logical_size) && (hit.logical_size ?? -1) >= 0 ? formatBytes(hit.logical_size!) : t("Size unavailable");
                const playUnavailableReason = videoPlaybackUnavailableReason(workspaceID, hit, t);
                return <li className={`video-library__choice${isActive ? " is-active" : ""}`} key={identity}>
                  <div className="video-library__choice-info"><Film size={16} aria-hidden="true" /><div><h3>{videoFileName(hit)}</h3><p>{size} · {formatFacetValue(hit).toUpperCase() || t("Format unavailable")}</p>{playUnavailableReason && <small>{playUnavailableReason}</small>}</div></div>
                  <button type="button" className="video-library__watch" aria-label={t("Verify and play {{name}}", { name: videoFileName(hit) })} disabled={!asset || isActive && playback?.status === "loading"} onClick={() => void preparePlayback(hit)} title={asset ? t("Downloads and verifies the complete original before playback") : playUnavailableReason}>{isActive && playback?.status === "loading" ? <><Play size={14} />{t("Verifying…")}</> : <><Play size={14} />{t("Watch")}</>}</button>
                  <details className="video-library__actions">
                    <summary>{t("More video actions")}</summary>
                    <div className="video-library__action-menu">
                      <button type="button" className="secondary-button compact" onClick={() => onOpenHit(hit)}>{t("Details")}</button>
                      <button type="button" className="secondary-button compact" disabled={!canDownload} onClick={() => canDownload && hit.entry_id && downloadOriginal(workspaceID, hit.entry_id, videoFileName(hit))}><Download size={14} />{t("Download original")}</button>
                    </div>
                  </details>
                </li>;
              })}
            </ul>}
      </aside>
    </div>
  </section>;
}
