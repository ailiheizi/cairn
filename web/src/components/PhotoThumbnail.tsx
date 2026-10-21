import { useEffect, useMemo, useRef, useState } from "react";
import { ContentPreview, type ContentPreviewCommand, type PreviewLocale } from "./ContentPreview";
import { createTranslator } from "../i18n";
import {
  PHOTO_LEGACY_THUMB_LIMIT,
  PHOTO_MAX_DIMENSION,
  PHOTO_MAX_PIXELS,
  PHOTO_ORIGINAL_LIMIT,
  PHOTO_RENDITION_MAX_BYTES,
  PHOTO_RENDITION_MAX_EDGE,
  abortError,
  cachePhotoRendition,
  cachedPhotoRendition,
  parsePhotoDimensions,
  photoCandidateMime,
  photoDecodeGate,
  photoRenditionPipeline,
  photoPreviewLimitMessage,
  readVerifiedPhotoOriginal,
} from "../lib/photoRendition";
import "./PhotoThumbnail.css";

export type PhotoThumbnailProps = {
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
  /** Wait for actual viewport intersection before mounting a legacy tile read. */
  deferUntilVisible?: boolean;
};

type LargePreviewState = { status: "deferred" | "loading" } | { status: "ready"; url: string } | { status: "unavailable"; message: string };
type VisibilityObservation = { token: object; visible: boolean };

export function PhotoThumbnail(props: PhotoThumbnailProps) {
  const { command, locale, workspaceId, entryId, subjectRef, contentId, name, logicalSize, exactAvailable = true, className = "", deferUntilVisible = false } = props;
  const containerRef = useRef<HTMLSpanElement>(null);
  const requestRef = useRef(0);
  const [visibilityObservation, setVisibilityObservation] = useState<VisibilityObservation>();
  const [largeState, setLargeState] = useState<LargePreviewState>({ status: "deferred" });
  const t = useMemo(() => createTranslator(locale ?? "en"), [locale]);
  const largeCandidate = logicalSize !== undefined && logicalSize > PHOTO_LEGACY_THUMB_LIMIT;
  const mime = photoCandidateMime(name);
  const visibilityToken = useMemo(() => ({}), [contentId, deferUntilVisible, entryId, exactAvailable, largeCandidate, logicalSize, name, subjectRef, workspaceId]);
  const visible = visibilityObservation?.token === visibilityToken && visibilityObservation.visible;

  useEffect(() => {
    if ((!largeCandidate && !deferUntilVisible) || !containerRef.current) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      // Preserve the established large-image fallback behavior, but do not
      // turn deferred legacy thumbnails into eager reads when visibility
      // cannot be observed.
      if (largeCandidate) setVisibilityObservation({ token: visibilityToken, visible: true });
      return undefined;
    }
    let active = true;
    const observer = new IntersectionObserver((entries) => {
      if (!active) return;
      setVisibilityObservation({ token: visibilityToken, visible: entries.some((entry) => entry.isIntersecting) });
    }, { rootMargin: "0px" });
    observer.observe(containerRef.current);
    return () => { active = false; observer.disconnect(); };
  }, [deferUntilVisible, largeCandidate, visibilityToken]);

  useEffect(() => {
    if (!largeCandidate) return undefined;
    const requestID = ++requestRef.current;
    if (!visible) {
      setLargeState({ status: "deferred" });
      return () => { requestRef.current++; };
    }
    const unavailable = (message: string) => setLargeState({ status: "unavailable", message });
    if (!mime || !Number.isSafeInteger(logicalSize) || logicalSize <= PHOTO_LEGACY_THUMB_LIMIT || logicalSize > PHOTO_ORIGINAL_LIMIT) {
      unavailable(t(photoPreviewLimitMessage(name, logicalSize)));
      return () => { requestRef.current++; };
    }
    if (!workspaceId || (!entryId && !subjectRef) || !contentId || !/^sha256:[a-f0-9]{64}$/.test(contentId)) {
      unavailable(t("The loaded exact identity is unavailable; use Details to open the original."));
      return () => { requestRef.current++; };
    }
    if (!exactAvailable) {
      unavailable(t("The exact original is unavailable; use Details to check its state."));
      return () => { requestRef.current++; };
    }

    const controller = new AbortController();
    let objectURL = "";
    const current = () => requestID === requestRef.current && !controller.signal.aborted;
    const run = async () => {
      setLargeState({ status: "loading" });
      try {
        await photoRenditionPipeline(controller.signal, async () => {
        const cached = cachedPhotoRendition(contentId);
        if (cached) {
          if (!current()) return;
          objectURL = URL.createObjectURL(cached);
          setLargeState({ status: "ready", url: objectURL });
          return;
        }
        const bytes = await readVerifiedPhotoOriginal({ command, workspaceID: workspaceId, entryID: entryId, subjectRef, contentID: contentId, logicalSize }, controller.signal);
        if (!current()) return;
        const parsed = parsePhotoDimensions(bytes, mime);
        if (parsed.width > PHOTO_MAX_DIMENSION || parsed.height > PHOTO_MAX_DIMENSION || parsed.width * parsed.height > PHOTO_MAX_PIXELS) throw new Error("This image exceeds the 12-megapixel preview decode limit.");
        const rendition = await photoDecodeGate(controller.signal, () => createRendition(bytes, mime, parsed.width, parsed.height, controller.signal));
        if (!current()) return;
        cachePhotoRendition(contentId, rendition);
        objectURL = URL.createObjectURL(rendition);
        setLargeState({ status: "ready", url: objectURL });
        });
      } catch (error) {
        if (!current()) return;
        unavailable(t(error instanceof Error && error.name !== "AbortError" ? error.message : "The image preview was cancelled."));
      }
    };
    void run();
    return () => {
      controller.abort();
      requestRef.current++;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [command, contentId, entryId, exactAvailable, largeCandidate, logicalSize, mime, name, subjectRef, t, visible, workspaceId]);

  if (!largeCandidate) {
    if (deferUntilVisible && !visible) {
      return <span ref={containerRef} className={`photo-thumbnail photo-thumbnail--fallback ${className}`} data-testid="photo-thumbnail" data-preview-state="deferred" role="img" aria-label={t("Thumbnail not loaded")}>{t("Thumbnail not loaded")}</span>;
    }
    return <span ref={deferUntilVisible ? containerRef : undefined} className={`photo-thumbnail ${className}`} data-testid="photo-thumbnail" data-preview-state="legacy">
      <ContentPreview command={command} locale={locale} workspaceId={workspaceId} entryId={entryId} subjectRef={subjectRef} contentId={contentId} name={name} logicalSize={logicalSize} exactAvailable={exactAvailable} variant="thumb" />
    </span>;
  }

  if (largeState.status === "ready") return <span ref={containerRef} className={`photo-thumbnail ${className}`} data-testid="photo-thumbnail" data-preview-state="ready"><img className="photo-thumbnail__image" src={largeState.url} alt="" /></span>;
  if (largeState.status === "unavailable") return <span ref={containerRef} className={`photo-thumbnail photo-thumbnail--fallback ${className}`} data-testid="photo-thumbnail" data-preview-state="unavailable" role="img" aria-label={t("Preview unavailable: {{message}}", { message: largeState.message })} title={t("Preview unavailable: {{message}}", { message: largeState.message })}>{t("Preview unavailable")}</span>;
  return <span ref={containerRef} className={`photo-thumbnail photo-thumbnail--fallback ${className}`} data-testid="photo-thumbnail" data-preview-state={largeState.status} aria-label={t(largeState.status === "loading" ? "Loading bounded image preview" : "Image preview loads when visible")}>{t(largeState.status === "loading" ? "Loading preview…" : "Preview loads when visible")}</span>;
}

async function createRendition(bytes: Uint8Array, mime: "image/jpeg" | "image/png", width: number, height: number, signal: AbortSignal): Promise<Blob> {
  if (signal.aborted) throw abortError();
  const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime }), { imageOrientation: "from-image" });
  try {
    if (signal.aborted) throw abortError();
    if (bitmap.width <= 0 || bitmap.height <= 0 || bitmap.width > PHOTO_MAX_DIMENSION || bitmap.height > PHOTO_MAX_DIMENSION || bitmap.width * bitmap.height > PHOTO_MAX_PIXELS) throw new Error("Decoded image dimensions exceed the preview limit.");
    // Header dimensions are only a pre-decode safety check. The decoded
    // dimensions can swap under native EXIF presentation orientation.
    if (!((bitmap.width === width && bitmap.height === height) || (bitmap.width === height && bitmap.height === width))) throw new Error("Decoded image dimensions do not match the verified image header.");
    const maxSourceEdge = Math.max(bitmap.width, bitmap.height);
    const edges = [...new Set([PHOTO_RENDITION_MAX_EDGE, 768, 512, 384].map((edge) => Math.min(edge, maxSourceEdge)))];
    const qualities = mime === "image/jpeg" ? [0.84, 0.72, 0.6, 0.5] : [undefined];
    for (const edge of edges) {
      if (signal.aborted) throw abortError();
      const ratio = Math.min(1, edge / maxSourceEdge);
      const outputWidth = Math.max(1, Math.round(bitmap.width * ratio));
      const outputHeight = Math.max(1, Math.round(bitmap.height * ratio));
      const canvas = makeCanvas(outputWidth, outputHeight);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The browser could not prepare the bounded image preview.");
      context.drawImage(bitmap, 0, 0, outputWidth, outputHeight);
      for (const quality of qualities) {
        const blob = await canvasBlob(canvas, mime, quality);
        if (signal.aborted) throw abortError();
        if (blob.type === mime && blob.size > 0 && blob.size <= PHOTO_RENDITION_MAX_BYTES) return blob;
      }
    }
    throw new Error("The reduced image preview still exceeds the 512 KiB memory limit.");
  } finally {
    bitmap.close();
  }
}

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasBlob(canvas: OffscreenCanvas | HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type: mime, ...(quality !== undefined ? { quality } : {}) });
  const htmlCanvas = canvas as HTMLCanvasElement;
  return new Promise((resolve, reject) => htmlCanvas.toBlob((blob: Blob | null) => blob ? resolve(blob) : reject(new Error("The browser could not encode the bounded image preview.")), mime, quality));
}
