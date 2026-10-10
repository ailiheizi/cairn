import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Eye, LoaderCircle, Maximize2, Minus, Plus, X } from "lucide-react";
import { createTranslator } from "../i18n";
import type { Locale } from "../i18n";
import { operations } from "../lib/operations";
import "./ContentPreview.css";

export type PreviewLocale = Locale;

export type PreviewCommandResult = {
  status?: string;
  data?: unknown;
  reasons?: Array<{ message?: string }>;
};

export type ContentPreviewCommand = (operation: string, input: unknown) => Promise<PreviewCommandResult>;

export type ContentPreviewProps = {
  command: ContentPreviewCommand;
  locale?: PreviewLocale;
  workspaceId: string;
  entryId?: string;
  subjectRef?: string;
  contentId?: string;
  name: string;
  logicalSize?: number;
  exactAvailable?: boolean;
  className?: string;
  autoOpen?: boolean;
  variant?: "inspector" | "thumb";
};

type OpenData = { handle?: string; entry_id?: string; subject_ref?: string; content_id?: string; logical_size?: number; max_read?: number };
type ReadData = { handle?: string; offset?: number; length?: number; bytes?: string; eof?: boolean };
type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready-text"; text: string }
  | { kind: "ready-image"; url: string; mime: string }
  | { kind: "unavailable"; reason: "unsupported-format" | "size-limit" | "original-unavailable"; message: string }
  | { kind: "error"; message: string };
type UnavailablePreviewState = Extract<PreviewState, { kind: "unavailable" }>;
type NaturalSize = { width: number; height: number };

const FALLBACK_MAX_READ = 1 << 20;
const TEXT_BUDGET = 64 << 10;
const IMAGE_BUDGET = 1 << 20;
const INSPECTOR_IMAGE_BUDGET = 8 << 20;
const TEXT_EXTENSIONS = /\.(txt|md|markdown|json|csv|tsv|log|yaml|yml|toml|xml|css|js|jsx|ts|tsx|go|rs|py|sh|sql|ini|conf)$/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i;
// A natural size of 32px or less is too small to judge at tile scale, so the
// thumbnail must also say which size it actually rendered.
const TINY_IMAGE_PX = 32;
// The viewer is a bounded inspection surface: the user can always return to a
// sane scale, and the percentage is never allowed to run away.
const ZOOM_MIN = 10;
const ZOOM_MAX = 800;
const ZOOM_STEP = 1.25;
// Repeated renders of the same content must not re-read the daemon. The key is
// the content identity the daemon reports. This is a browser-session render
// cache only; it is never durable state and it never substitutes for a daemon
// read on first render.
const THUMB_CACHE_LIMIT = 48;
const thumbCache = new Map<string, ThumbCacheEntry>();

type ThumbCacheEntry =
  | { kind: "image"; blob: Blob; mime: string }
  | { kind: "unavailable"; reason: "unsupported-format" | "size-limit" | "original-unavailable"; message: string }
  | { kind: "error"; message: string };

function readThumbCache(key: string): ThumbCacheEntry | undefined {
  return key ? thumbCache.get(key) : undefined;
}

function writeThumbCache(key: string, entry: ThumbCacheEntry) {
  if (!key) return;
  thumbCache.delete(key);
  thumbCache.set(key, entry);
  while (thumbCache.size > THUMB_CACHE_LIMIT) {
    const oldest = thumbCache.keys().next().value;
    if (oldest === undefined) break;
    thumbCache.delete(oldest);
  }
}

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

function messageFor(result: PreviewCommandResult, fallback: string): string {
  return result.reasons?.find((reason) => reason.message)?.message ?? fallback;
}

function unsupportedFormatMessage(name: string, t: ReturnType<typeof createTranslator>): string {
  const suffixHint = /\.(wav|mp3|m4a|aac|flac|ogg|oga|opus|wma|aiff?)$/i.test(name) ? t("audio")
    : /\.(mp4|m4v|mov|mkv|avi|webm|mpeg|mpg|wmv|3gp)$/i.test(name) ? t("video")
      : /\.pdf$/i.test(name) ? "PDF"
        : /\.(zip|7z|rar|tar|gz|bz2|xz|zst|tgz)$/i.test(name) ? t("archive")
          : "";
  return suffixHint
    ? t("The filename suffix suggests {{kind}} content. This preview does not open that format. Try Download original in Details to open it in your own app.", { kind: suffixHint })
    : t("This file type is not previewed here. Try Download original in Details to open it in your own app.");
}

function previewLimitMessage(name: string, variant: "inspector" | "thumb", t: ReturnType<typeof createTranslator>): string {
  if (isTextName(name)) return t("Text preview is limited to 64 KiB. Try Download original in Details to open the full file.");
  return variant === "thumb"
    ? t("Image thumbnails are limited to 1 MiB. Try Download original in Details to inspect the full image.")
    : t("Image inspection is limited to 8 MiB. Try Download original in Details to inspect the full image.");
}

function bytesFromBase64(value: unknown): Uint8Array {
  if (typeof value !== "string") throw new Error("bytes missing");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function imageMime(bytes: Uint8Array, name: string): string | undefined {
  if (!IMAGE_EXTENSIONS.test(name)) return undefined;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && new TextDecoder("ascii").decode(bytes.subarray(0, 6)).match(/^GIF8[79]a$/)) return "image/gif";
  if (bytes.length >= 12 && new TextDecoder("ascii").decode(bytes.subarray(0, 4)) === "RIFF" && new TextDecoder("ascii").decode(bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return undefined;
}

function isTextName(name: string): boolean {
  return TEXT_EXTENSIONS.test(name) && !/\.(html?|svg)$/i.test(name);
}

// The library tile asks this before it renders (and therefore before it may
// fetch) a preview. A tile is a picture and a name; only a real image may read
// content for it. Text and every other format keep the type glyph and are read
// by opening the file, so a tile never fetches text.
export function previewThumbKind(name: string): "image" | undefined {
  return IMAGE_EXTENSIONS.test(name) ? "image" : undefined;
}

export function previewThumbBudget(): number {
  return IMAGE_BUDGET;
}

export function ContentPreview({ command, locale = "en", workspaceId, entryId, subjectRef, contentId, name, logicalSize, exactAvailable = true, className = "", autoOpen = false, variant = "inspector" }: ContentPreviewProps) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [open, setOpen] = useState(Boolean(autoOpen) || variant === "thumb");
  const [state, setState] = useState<PreviewState>({ kind: "idle" });
  const [thumbNaturalSize, setThumbNaturalSize] = useState<NaturalSize>();
  const [naturalSize, setNaturalSize] = useState<NaturalSize>();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerFailed, setViewerFailed] = useState("");
  const objectUrlRef = useRef<string | undefined>(undefined);
  const requestRef = useRef(0);
  const viewerOpenerRef = useRef<HTMLElement | null>(null);

  const releaseUrl = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = undefined;
  }, []);

  const closePreview = useCallback(() => {
    requestRef.current += 1;
    releaseUrl();
    setOpen(false);
    setState({ kind: "idle" });
  }, [releaseUrl]);

  const openViewer = useCallback((trigger: HTMLElement | null) => {
    viewerOpenerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setViewerFailed("");
    setViewerOpen(true);
  }, []);

  const closeViewer = useCallback(() => setViewerOpen(false), []);

  useEffect(() => {
    if (autoOpen || variant === "thumb") setOpen(true);
  }, [autoOpen, variant]);

  // The viewer is a modal surface inside the inspector: closing it returns the
  // keyboard user to the exact control that opened it.
  useEffect(() => {
    if (!viewerOpen) return undefined;
    const opener = viewerOpenerRef.current;
    return () => { opener?.focus(); };
  }, [viewerOpen]);

  useEffect(() => {
    if (!open) return undefined;
    const imageCandidate = IMAGE_EXTENSIONS.test(name);
    const textCandidate = isTextName(name);
    // A tile renders images only. It never reads text and it never reads a
    // content type it cannot draw, so a tile cannot fetch a preview it will
    // not show.
    if (variant === "thumb" && !imageCandidate) return undefined;
    const budget = imageCandidate ? (variant === "thumb" ? IMAGE_BUDGET : INSPECTOR_IMAGE_BUDGET) : TEXT_BUDGET;
    // A tile never fetches content it already knows it cannot render. The
    // inspector keeps reporting the same state inside the panel instead.
    if (variant === "thumb" && logicalSize !== undefined && (!Number.isSafeInteger(logicalSize) || logicalSize < 0 || logicalSize > budget)) return undefined;
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    let handle = "";
    let handleClosed = false;
    const closeHandle = async () => {
      if (!handle || handleClosed) return;
      handleClosed = true;
      await command(operations.content.close, { handle }).catch(() => undefined);
    };
    const cleanup = () => { controller.abort(); requestRef.current += 1; releaseUrl(); void closeHandle(); };
    // The identity key exists only for the tile projection. The inspector
    // always reads the daemon so it never shows a cached state as current.
    const cacheKey = variant === "thumb" && contentId?.trim() ? `${contentId.trim()}:image` : "";
    const cached = readThumbCache(cacheKey);
    if (cached) {
      if (cached.kind === "image") {
        const url = URL.createObjectURL(cached.blob);
        objectUrlRef.current = url;
        setState({ kind: "ready-image", url, mime: cached.mime });
      } else setState({ ...cached });
      return cleanup;
    }
    const setUnavailable = (reason: UnavailablePreviewState["reason"], message: string) => {
      const result: UnavailablePreviewState = { kind: "unavailable", reason, message };
      writeThumbCache(cacheKey, result);
      setState(result);
    };
    const run = async () => {
      if (!exactAvailable) {
        setUnavailable("original-unavailable", t("The original content is currently unavailable; preview or download may not be possible."));
        return;
      }
      if (!imageCandidate && !textCandidate) {
        setUnavailable("unsupported-format", unsupportedFormatMessage(name, t));
        return;
      }
      if (logicalSize !== undefined && (!Number.isSafeInteger(logicalSize) || logicalSize < 0)) {
        const message = t("The preview size could not be verified.");
        writeThumbCache(cacheKey, { kind: "error", message });
        setState({ kind: "error", message });
        return;
      }
      if (logicalSize !== undefined && logicalSize > budget) {
        setUnavailable("size-limit", previewLimitMessage(name, variant, t));
        return;
      }
      setState({ kind: "loading" });
      try {
        const opened = await command(operations.content.open, { workspace_id: workspaceId, ...(entryId ? { entry_id: entryId } : { subject_ref: subjectRef }) });
        if (!opened.data || !["SUCCEEDED", "DEGRADED"].includes(opened.status ?? "")) throw new Error(messageFor(opened, t("Preview could not be loaded.")));
        const data = opened.data as OpenData;
        handle = data.handle ?? "";
        if (!handle) throw new Error(t("Preview could not be loaded."));
        if (requestId !== requestRef.current || controller.signal.aborted) return;
        if (contentId !== undefined && data.content_id !== contentId) throw new Error(t("Preview could not be loaded."));
        if (entryId !== undefined && data.entry_id !== entryId) throw new Error(t("Preview could not be loaded."));
        if (subjectRef !== undefined && data.subject_ref !== subjectRef) throw new Error(t("Preview could not be loaded."));
        if (logicalSize !== undefined && data.logical_size !== logicalSize) throw new Error(t("Preview could not be loaded."));
        if (!Number.isSafeInteger(data.logical_size) || (data.logical_size ?? -1) < 0 || typeof data.content_id !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(data.content_id)) throw new Error(t("The content could not be decoded safely."));
        const size = data.logical_size as number;
        const maxRead = data.max_read;
        if (size > budget) {
          setUnavailable("size-limit", previewLimitMessage(name, variant, t));
          return;
        }
        if (typeof maxRead !== "number" || !Number.isSafeInteger(maxRead) || maxRead <= 0 || maxRead > FALLBACK_MAX_READ) throw new Error(t("Preview could not be loaded."));
        if (requestId !== requestRef.current || controller.signal.aborted) return;
        const all = new Uint8Array(size);
        let offset = 0;
        do {
          if (requestId !== requestRef.current || controller.signal.aborted) return;
          const length = Math.min(maxRead, size - offset);
          const read = await command(operations.content.read, { handle, offset, length });
          if (requestId !== requestRef.current || controller.signal.aborted) return;
          if (!read.data || !["SUCCEEDED", "DEGRADED"].includes(read.status ?? "")) throw new Error(messageFor(read, t("Preview could not be loaded.")));
          const readData = read.data as ReadData;
          const nextOffset = offset + length;
          if (readData.handle !== handle || readData.offset !== offset || readData.length !== length || readData.eof !== (nextOffset === size)) throw new Error(t("The content could not be decoded safely."));
          const chunk = bytesFromBase64(readData.bytes);
          if (chunk.length !== length) throw new Error(t("The content could not be decoded safely."));
          all.set(chunk, offset);
          offset = nextOffset;
        } while (offset < size);
        if (requestId !== requestRef.current || controller.signal.aborted) return;
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
        if (requestId !== requestRef.current || controller.signal.aborted) return;
        const actualContentId = `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
        if (actualContentId !== data.content_id.toLowerCase() || all.length !== size) throw new Error(t("The content could not be decoded safely."));
        const mime = imageMime(all, name);
        if (imageCandidate && mime) {
          const blob = new Blob([all.buffer as ArrayBuffer], { type: mime });
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          writeThumbCache(cacheKey, { kind: "image", blob, mime });
          setState({ kind: "ready-image", url, mime });
        } else if (textCandidate && !mime) {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(all);
          if (text.includes("\u0000")) throw new Error(t("The content could not be decoded safely."));
          setState({ kind: "ready-text", text });
        } else {
          throw new Error(t("The content could not be decoded safely."));
        }
      } catch (error) {
        if (requestId === requestRef.current && !controller.signal.aborted) {
          const message = error instanceof Error ? error.message : t("Preview could not be loaded.");
          writeThumbCache(cacheKey, { kind: "error", message });
          setState({ kind: "error", message });
        }
      } finally {
        await closeHandle();
      }
    };
    void run();
    return cleanup;
  }, [command, contentId, entryId, exactAvailable, logicalSize, name, open, releaseUrl, subjectRef, t, variant, workspaceId]);

  if (variant === "thumb") {
    // A tile preview is decorative: it adds no interactive element and it
    // never renders an empty box. It draws a real image or keeps the ordinary
    // glyph and marks an unavailable preview in one compact line. The full
    // reason remains available through the badge's title and accessible name.
    if (state.kind === "ready-image") {
      return <>
        <img className="cairn-content-preview__thumb-image" src={state.url} alt="" onLoad={(event) => {
          const image = event.currentTarget;
          const tiny = image.naturalWidth > 0 && (image.naturalWidth <= TINY_IMAGE_PX || image.naturalHeight <= TINY_IMAGE_PX);
          image.classList.toggle("cairn-content-preview__thumb-image--tiny", tiny);
          setThumbNaturalSize(tiny ? { width: image.naturalWidth, height: image.naturalHeight } : undefined);
        }} onError={() => { releaseUrl(); setState({ kind: "error", message: t("The content could not be decoded safely.") }); }} />
        {thumbNaturalSize && <span className="cairn-content-preview__thumb-size" aria-hidden="true" title={`${t("Tiny image")} · ${thumbNaturalSize.width}x${thumbNaturalSize.height}`}>{thumbNaturalSize.width}x{thumbNaturalSize.height}</span>}
      </>;
    }
    if (state.kind === "unavailable" || state.kind === "error") {
      const unavailableLabel = t("Preview unavailable");
      return <span className="cairn-content-preview__thumb-note" role="img" aria-label={`${unavailableLabel}: ${state.message}`} title={`${unavailableLabel} · ${state.message}`}><AlertCircle size={11} aria-hidden="true" /><span>{t("No preview")}</span></span>;
    }
    return null;
  }

  const viewerMessage = state.kind === "ready-image"
    ? ""
    : state.kind === "unavailable" || state.kind === "error"
      ? state.message
      : t("Reading exact content...");
  // Only an image name can reach the viewer. When the bytes are unavailable the
  // control stays visible and the viewer reports the reason instead of drawing
  // an empty stage.
  const imageName = IMAGE_EXTENSIONS.test(name);

  return <div className={`cairn-content-preview ${className}`}>
    {!open && <button type="button" className="cairn-content-preview__trigger" onClick={() => { releaseUrl(); setState({ kind: "idle" }); setOpen(true); }} disabled={!workspaceId || (!entryId && !subjectRef)}>
      <Eye size={16} aria-hidden="true" /> {t("Preview")}
    </button>}
    {open && <section className="cairn-content-preview__panel" aria-live="polite" aria-label={t("Preview")}>
      <div className="cairn-content-preview__header"><strong>{name}</strong><button type="button" className="cairn-content-preview__close" onClick={closePreview} aria-label={t("Close preview")}><X size={18} aria-hidden="true" /></button></div>
      {state.kind === "loading" && <div className="cairn-content-preview__status"><LoaderCircle className="cairn-content-preview__spin" size={18} aria-hidden="true" /> {t("Reading exact content...")}</div>}
      {(state.kind === "unavailable" || state.kind === "error") && <div className={`cairn-content-preview__status ${state.kind === "error" ? "cairn-content-preview__status--error" : `cairn-content-preview__status--unavailable ${state.reason === "original-unavailable" ? "cairn-content-preview__status--unavailable-critical" : ""}`}`} data-state={state.kind} data-reason={state.kind === "unavailable" ? state.reason : undefined}><strong>{state.kind === "error" ? t("Preview failed") : state.reason === "size-limit" ? t("Preview size limit reached") : state.reason === "original-unavailable" ? t("Original content unavailable") : t("Preview not provided for this format")}</strong><span>{state.message}</span>{state.kind === "error" && <button type="button" className="cairn-content-preview__retry" onClick={() => { closePreview(); setTimeout(() => setOpen(true), 0); }}>{t("Retry")}</button>}</div>}
      {state.kind === "ready-text" && <pre className="cairn-content-preview__text">{state.text}</pre>}
      {state.kind === "ready-image" && <div className="cairn-content-preview__image-wrap">
        <button type="button" className="cairn-content-preview__image-button" aria-label={t("View full size")} onClick={(event) => openViewer(event.currentTarget)}>
          <img className="cairn-content-preview__image" src={state.url} alt={t("Content preview")} onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth > 0 && image.naturalHeight > 0) setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
          }} onError={() => { releaseUrl(); setState({ kind: "error", message: t("The content could not be decoded safely.") }); }} />
        </button>
        <button type="button" className="cairn-content-preview__viewer-button" onClick={(event) => openViewer(event.currentTarget)}>
          <Maximize2 size={15} aria-hidden="true" /> {t("View full size")}
        </button>
      </div>}
      {imageName && (state.kind === "unavailable" || state.kind === "error") && <div className="cairn-content-preview__image-wrap">
        <button type="button" className="cairn-content-preview__viewer-button" onClick={(event) => openViewer(event.currentTarget)}>
          <Maximize2 size={15} aria-hidden="true" /> {t("View full size")}
        </button>
      </div>}
    </section>}
    {viewerOpen && createPortal(<ImageViewer
      name={name}
      url={state.kind === "ready-image" ? state.url : ""}
      message={viewerMessage}
      naturalSize={naturalSize}
      t={t}
      onClose={closeViewer}
      onFail={setViewerFailed}
      failed={viewerFailed}
    />, document.body)}
  </div>;
}

type ImageViewerProps = {
  name: string;
  url: string;
  message: string;
  naturalSize?: NaturalSize;
  failed: string;
  t: ReturnType<typeof createTranslator>;
  onClose: () => void;
  onFail: (message: string) => void;
};

// The viewer is the actual reader for pictures. It never fabricates a stage:
// without readable bytes it states the reason and shows no image area at all.
function ImageViewer({ name, url, message, naturalSize, failed, t, onClose, onFail }: ImageViewerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [natural, setNatural] = useState<NaturalSize | undefined>(naturalSize);
  const [zoom, setZoom] = useState<number>();
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const measured = natural ?? naturalSize;

  const fitZoom = useCallback(() => {
    const stage = stageRef.current;
    const size = natural ?? naturalSize;
    if (!stage || !size?.width || !size.height) return 100;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return 100;
    // Fit shrinks a large picture to the window; it never invents pixels by
    // magnifying past the actual size.
    return clampZoom(Math.round(Math.min(rect.width / size.width, rect.height / size.height, 1) * 100));
  }, [natural, naturalSize]);

  // Move focus into the dialog and keep Tab inside it. Escape closes and the
  // opener regains focus through the parent's unmount cleanup.
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    const previousOverflow = document.body.classList.contains("drawer-open");
    document.body.classList.add("drawer-open");
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (!previousOverflow) document.body.classList.remove("drawer-open");
    };
  }, [onClose]);

  useEffect(() => { setZoom(fitZoom()); }, [fitZoom]);

  useEffect(() => {
    function handleResize() { setZoom(fitZoom()); setOffset({ x: 0, y: 0 }); }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [fitZoom]);

  const clampOffset = useCallback((next: { x: number; y: number }, zoomValue: number) => {
    const stage = stageRef.current;
    const size = natural ?? naturalSize;
    if (!stage || !size) return { x: 0, y: 0 };
    const rect = stage.getBoundingClientRect();
    const maxX = Math.max(0, (size.width * zoomValue / 100 - rect.width) / 2);
    const maxY = Math.max(0, (size.height * zoomValue / 100 - rect.height) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) };
  }, [natural, naturalSize]);

  const changeZoom = useCallback((next: number) => {
    const value = clampZoom(Math.round(next));
    setZoom(value);
    setOffset((current) => clampOffset(current, value));
  }, [clampOffset]);

  // One zoom step always moves the percentage: a bounded control that stops
  // responding at an arbitrary rounded value would be a dead control.
  const stepZoom = useCallback((factor: number) => {
    const base = zoom ?? 100;
    const scaled = Math.round(base * factor);
    const moved = factor > 1 ? Math.max(base + 1, scaled) : Math.min(base - 1, scaled);
    changeZoom(moved);
  }, [changeZoom, zoom]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !url || failed) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      stepZoom(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [failed, stepZoom, url]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset(clampOffset({ x: drag.originX + (event.clientX - drag.startX), y: drag.originY + (event.clientY - drag.startY) }, zoom ?? 100));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  const ready = Boolean(url) && !failed;
  const tiny = Boolean(measured && (measured.width <= TINY_IMAGE_PX || measured.height <= TINY_IMAGE_PX));
  const currentZoom = zoom ?? 100;
  const renderedWidth = measured ? Math.round(measured.width * currentZoom / 100) : undefined;
  const renderedHeight = measured ? Math.round(measured.height * currentZoom / 100) : undefined;

  return <div
    ref={dialogRef}
    className="cairn-image-viewer"
    role="dialog"
    aria-modal="true"
    aria-label={`${t("Image viewer")}: ${name}`}
    data-zoom-min={ZOOM_MIN}
    data-zoom-max={ZOOM_MAX}
    data-zoom-current={currentZoom}
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
  >
    <div className="cairn-image-viewer__chrome">
      <div className="cairn-image-viewer__identity">
        <strong className="cairn-image-viewer__name" title={name}>{name}</strong>
        <small className="cairn-image-viewer__size">{measured ? t("{{width}} × {{height}} px", { width: measured.width, height: measured.height }) : t("Natural size unavailable")}</small>
      </div>
      <div className="cairn-image-viewer__controls" role="group" aria-label={t("Image viewer")}>
        <button type="button" className="cairn-image-viewer__control" aria-label={t("Zoom out")} title={t("Zoom out")} onClick={() => stepZoom(1 / ZOOM_STEP)} disabled={!ready || currentZoom <= ZOOM_MIN}><Minus size={16} aria-hidden="true" /></button>
        <span className="cairn-image-viewer__zoom-value" role="status">{`${Math.round(currentZoom)}%`}</span>
        <button type="button" className="cairn-image-viewer__control" aria-label={t("Zoom in")} title={t("Zoom in")} onClick={() => stepZoom(ZOOM_STEP)} disabled={!ready || currentZoom >= ZOOM_MAX}><Plus size={16} aria-hidden="true" /></button>
        <button type="button" className="cairn-image-viewer__control wide" onClick={() => changeZoom(fitZoom())} disabled={!ready}>{t("Fit to window")}</button>
        <button type="button" className="cairn-image-viewer__control wide" onClick={() => changeZoom(100)} disabled={!ready}>{t("Actual size")}</button>
      </div>
      <button type="button" className="cairn-image-viewer__close" aria-label={t("Close viewer")} title={t("Close viewer")} onClick={onClose}><X size={18} aria-hidden="true" /></button>
    </div>
    {ready
      ? <div
          className={`cairn-image-viewer__stage ${offset.x || offset.y ? "is-panned" : ""}`}
          ref={stageRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <img
            className={`cairn-image-viewer__image ${tiny ? "is-pixelated" : ""}`}
            src={url}
            alt={t("Content preview")}
            draggable={false}
            style={renderedWidth && renderedHeight
              ? { width: `${renderedWidth}px`, height: `${renderedHeight}px`, transform: `translate(${offset.x}px, ${offset.y}px)` }
              : { transform: `translate(${offset.x}px, ${offset.y}px)` }}
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalWidth > 0 && image.naturalHeight > 0) setNatural({ width: image.naturalWidth, height: image.naturalHeight });
            }}
            onError={() => onFail(t("The content could not be decoded safely."))}
          />
        </div>
      : <div className="cairn-image-viewer__status" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <div><strong>{t("Preview unavailable")}</strong><span>{failed || message || t("Preview could not be loaded.")}</span></div>
        </div>}
  </div>;
}
