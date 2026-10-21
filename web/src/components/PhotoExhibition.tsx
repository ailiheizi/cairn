import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Image as ImageIcon, Maximize2, Pause, Play, Repeat, X } from "lucide-react";
import type { ReactNode, KeyboardEvent, CSSProperties } from "react";
import type { Translator } from "../i18n";
import type { SearchHit } from "../lib/types";
import "./PhotoExhibition.css";

const WINDOW_RADIUS = 2;

export function PhotoExhibition({ hits, totalCount = hits.length, selectedRef, selectionRefs, selectionCount = selectionRefs.length, focusedSubjectRef, t, renderThumbnail, onToggleSelection, onOpenHit, onOpenPhotoPreview, onFocusSubject, onShowSelectionActions, onReturnToWall, returnLabel }: {
  hits: SearchHit[];
  totalCount?: number;
  selectionCount?: number;
  selectedRef: string;
  selectionRefs: string[];
  focusedSubjectRef?: string;
  t: Translator;
  renderThumbnail: (hit: SearchHit) => ReactNode;
  onToggleSelection: (index: number) => void;
  onOpenHit: (hit: SearchHit) => void;
  onOpenPhotoPreview: (hit: SearchHit, trigger: HTMLElement) => void;
  onFocusSubject: (subjectRef: string) => void;
  onShowSelectionActions?: () => void;
  onReturnToWall: () => void;
  returnLabel: string;
}) {
  const initialIndex = useMemo(() => {
    const desired = focusedSubjectRef || selectedRef;
    if (!desired) return hits.length ? 0 : -1;
    return hits.findIndex((hit) => hit.subject_ref === desired);
  }, []); // Initial focus follows the App-owned subject only when this page first opens.
  const [focusIndex, setFocusIndex] = useState(initialIndex);
  const [slideshowSeconds, setSlideshowSeconds] = useState(5);
  const [slideshowLoop, setSlideshowLoop] = useState(false);
  const [slideshowPlaying, setSlideshowPlaying] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [slideshowNotice, setSlideshowNotice] = useState("");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const immersiveRef = useRef<HTMLElement | null>(null);
  const startSlideshowRef = useRef<HTMLButtonElement | null>(null);
  const immersiveTriggerRef = useRef<HTMLElement | null>(null);
  const focusIndexRef = useRef(focusIndex);
  const onFocusSubjectRef = useRef(onFocusSubject);
  const previousScopeRef = useRef("");
  const scopeKey = useMemo(() => hits.map((hit) => `${hit.subject_ref ?? ""}\u0000${hit.entry_id ?? ""}\u0000${hit.content_id ?? ""}`).join("\u0001"), [hits]);
  useEffect(() => {
    if (previousScopeRef.current && previousScopeRef.current !== scopeKey) {
      setSlideshowPlaying(false);
      setSlideshowNotice("Slideshow paused because the loaded photo results changed.");
    }
    previousScopeRef.current = scopeKey;
  }, [scopeKey]);

  useEffect(() => {
    if (hits.length === 0) setSlideshowPlaying(false);
  }, [hits.length]);

  useEffect(() => {
    focusIndexRef.current = focusIndex;
  }, [focusIndex]);

  useEffect(() => {
    onFocusSubjectRef.current = onFocusSubject;
  }, [onFocusSubject]);

  useEffect(() => {
    if (!slideshowPlaying) return;
    const timer = window.setInterval(() => {
      const current = focusIndexRef.current;
      if (current >= hits.length - 1) {
        if (slideshowLoop) commitFocusIndex(0);
        else {
          setSlideshowPlaying(false);
          setSlideshowNotice("Slideshow reached the end of the loaded photos.");
        }
        return;
      }
      commitFocusIndex(current + 1);
    }, slideshowSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [hits.length, slideshowLoop, slideshowPlaying, slideshowSeconds]);

  useEffect(() => {
    if (!slideshowPlaying) return;
    const pauseWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        setSlideshowPlaying(false);
        setSlideshowNotice("Slideshow paused while this page is hidden.");
      }
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, [slideshowPlaying]);

  useEffect(() => {
    if (!immersive) return;
    const handleImmersiveKeys = (event: globalThis.KeyboardEvent) => {
      const root = immersiveRef.current;
      const target = event.target as HTMLElement | null;
      if (!root || !target) return;
      const parentDialog = root.parentElement?.closest<HTMLElement>("[role='dialog'][aria-modal='true']");
      const nestedDialog = target.closest<HTMLElement>("[role='dialog'][aria-modal='true']");
      if (parentDialog || (nestedDialog && nestedDialog !== root)) return;
      if (event.key === "Tab") {
        event.stopPropagation();
        const focusable = Array.from(root.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"))
          .filter((element) => element.getClientRects().length > 0);
        if (focusable.length === 0) {
          event.preventDefault();
          root.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (target === first || target === root)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (target === last || target === root)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (!root.contains(target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        exitImmersive(true);
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      if (target.closest("input, select, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") stepSlideshow(-1);
      else stepSlideshow(1);
    };
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => immersiveRef.current?.querySelector<HTMLElement>(".photo-exhibition__immersive-exit")?.focus());
    const handleFocusEscape = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || immersiveRef.current?.contains(target)) return;
      const parentDialog = immersiveRef.current?.parentElement?.closest("[role='dialog'][aria-modal='true']");
      const otherDialog = target.closest("[role='dialog'][aria-modal='true']");
      if (parentDialog || otherDialog) return;
      immersiveRef.current?.querySelector<HTMLElement>(".photo-exhibition__immersive-exit")?.focus();
    };
    immersiveRef.current?.addEventListener("keydown", handleImmersiveKeys, true);
    document.addEventListener("focusin", handleFocusEscape, true);
    return () => {
      immersiveRef.current?.removeEventListener("keydown", handleImmersiveKeys, true);
      document.removeEventListener("focusin", handleFocusEscape, true);
      document.body.style.overflow = oldOverflow;
    };
  }, [hits.length, immersive, slideshowLoop]);

  useEffect(() => {
    const desired = focusedSubjectRef || selectedRef;
    const index = desired ? hits.findIndex((hit) => hit.subject_ref === desired) : -1;
    if (index >= 0) commitFocusIndex(index);
    else if (desired) commitFocusIndex(-1);
    else commitFocusIndex(hits.length ? Math.max(0, Math.min(hits.length - 1, focusIndexRef.current)) : -1);
  }, [focusedSubjectRef, hits, selectedRef]);

  useEffect(() => {
    const subjectRef = hits[focusIndex]?.subject_ref;
    if (subjectRef) onFocusSubjectRef.current(subjectRef);
  }, [focusIndex, scopeKey]);

  const visibleItems = useMemo(() => {
    const start = Math.max(0, Math.min(hits.length - 1, focusIndex) - WINDOW_RADIUS);
    const end = Math.min(hits.length, start + WINDOW_RADIUS * 2 + 1);
    return hits.slice(start, end).map((hit, offset) => ({ hit, index: start + offset }));
  }, [focusIndex, hits]);
  const focusedHit = focusIndex >= 0 ? hits[focusIndex] : undefined;
  const focusedSubject = focusedHit?.subject_ref || "";
  const focusedSelected = Boolean(focusedSubject && selectionRefs.includes(focusedSubject));

  function moveFocus(delta: number) {
    const current = focusIndexRef.current;
    let next = current < 0
      ? (delta > 0 ? 0 : Math.max(0, hits.length - 1))
      : current + delta;
    if (slideshowLoop && hits.length > 0) next = (next + hits.length) % hits.length;
    else next = Math.max(0, Math.min(hits.length - 1, next));
    if (next === current && slideshowPlaying) setSlideshowPlaying(false);
    commitFocusIndex(next);
    requestAnimationFrame(() => stageRef.current?.querySelector<HTMLElement>("[data-focused='true']")?.focus());
  }

  function commitFocusIndex(index: number) {
    focusIndexRef.current = index;
    setFocusIndex(index);
  }

  function stepSlideshow(delta: number) {
    setSlideshowNotice("");
    let next = focusIndexRef.current + delta;
    if (slideshowLoop && next >= hits.length) next = 0;
    if (slideshowLoop && next < 0) next = hits.length - 1;
    if (next < 0 || next >= hits.length) {
      setSlideshowPlaying(false);
      return;
    }
    commitFocusIndex(next);
  }

  function startOrResumeSlideshow() {
    if (hits.length === 0) return;
    if (focusIndexRef.current < 0) commitFocusIndex(0);
    setSlideshowNotice("");
    setSlideshowPlaying(true);
  }

  function enterImmersive(trigger: HTMLElement) {
    immersiveTriggerRef.current = trigger;
    setImmersive(true);
  }

  function exitImmersive(restoreFocus: boolean) {
    setSlideshowPlaying(false);
    setImmersive(false);
    if (restoreFocus) requestAnimationFrame(() => immersiveTriggerRef.current?.focus());
  }

  function runHostAction(action: () => void) {
    setSlideshowPlaying(false);
    if (!immersive) { action(); return; }
    setImmersive(false);
    requestAnimationFrame(action);
  }

  function focusItem(index: number) {
    commitFocusIndex(index);
    const subjectRef = hits[index]?.subject_ref;
    if (subjectRef) onFocusSubject(subjectRef);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, button[data-allow-arrows], [contenteditable='true']")) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); moveFocus(-1); }
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); moveFocus(1); }
  }

  return <section ref={immersiveRef} className={`photo-exhibition${immersive ? " is-immersive" : ""}`} role={immersive ? "dialog" : undefined} aria-modal={immersive ? true : undefined} tabIndex={immersive ? -1 : undefined} aria-label={t(immersive ? "Full-screen presentation" : "Photo exhibition")}>
    <header className="photo-exhibition__header">
      <h1>{t("Exhibition")}</h1>
      <p className="photo-exhibition__scope" role="status">{t("{{current}} / {{total}} loaded photos", { current: focusIndex + 1, total: totalCount })}</p>
      <p className="photo-exhibition__selection-count" role="status">{t("{{count}} selected items", { count: selectionCount })}</p>
      <div className="photo-exhibition__header-actions">
        {immersive && <button type="button" className="photo-exhibition__immersive-exit" onClick={() => exitImmersive(true)}><X aria-hidden="true" />{t("Exit full-screen presentation")}</button>}
        <button type="button" className="photo-exhibition__return" onClick={() => { setSlideshowPlaying(false); setImmersive(false); onReturnToWall(); }}><ImageIcon aria-hidden="true" />{returnLabel}</button>
      </div>
    </header>
    {hits.length === 0 ? <div className="photo-exhibition__empty"><ImageIcon aria-hidden="true" /><h2>{t("No photos in the loaded listing")}</h2><p>{t("Other saved content remains available in the shared library.")}</p><button type="button" onClick={onReturnToWall}>{returnLabel}</button></div> : focusIndex < 0 ? <div className="photo-exhibition__empty" role="status"><ImageIcon aria-hidden="true" /><h2>{t("Focused image is no longer in these results")}</h2><p>{t("Your subject selection is unchanged. Move to an image in this loaded context to continue.")}</p><button type="button" onClick={() => moveFocus(1)}>{t("Go to first image")}</button></div> : <>
      <section className="photo-exhibition__slideshow" aria-label={t("Slideshow controls")}>
        <div className="photo-exhibition__slideshow-heading"><strong>{t("Continuous slideshow")}</strong><span>{t("Uses only the currently loaded photo results.")}</span></div>
        <div className="photo-exhibition__slideshow-controls">
          <label><span>{t("Change photo every")}</span><select value={slideshowSeconds} onChange={(event) => setSlideshowSeconds(Number(event.target.value))}>
            {[3, 5, 10, 20].map((seconds) => <option value={seconds} key={seconds}>{t("{{seconds}} seconds", { seconds })}</option>)}
          </select></label>
          <label className="photo-exhibition__loop"><input type="checkbox" checked={slideshowLoop} onChange={(event) => setSlideshowLoop(event.target.checked)} /><Repeat aria-hidden="true" />{t("Loop at the end")}</label>
          <button ref={startSlideshowRef} type="button" className="photo-exhibition__slideshow-toggle" onClick={() => slideshowPlaying ? setSlideshowPlaying(false) : startOrResumeSlideshow()} disabled={!hits.length}>
            {slideshowPlaying ? <><Pause aria-hidden="true" />{t("Pause slideshow")}</> : <><Play aria-hidden="true" />{t("Start slideshow")}</>}
          </button>
          <button type="button" className="photo-exhibition__fullscreen" onClick={(event) => immersive ? exitImmersive(true) : enterImmersive(event.currentTarget)} aria-pressed={immersive}>{immersive ? <><X aria-hidden="true" />{t("Exit presentation")}</> : <><Maximize2 aria-hidden="true" />{t("Full-screen presentation")}</>}</button>
        </div>
        {slideshowNotice && <p className="photo-exhibition__slideshow-notice" role="status">{t(slideshowNotice)}</p>}
      </section>
      <div ref={stageRef} className="photo-exhibition__stage" tabIndex={0} onKeyDown={handleKeyDown} aria-label={t("Use arrow keys to move through the exhibition")}>
        <div className="photo-exhibition__controls">
          <button type="button" data-allow-arrows="true" aria-label={t("Previous image")} onClick={() => immersive ? stepSlideshow(-1) : moveFocus(-1)} disabled={focusIndex === 0 && !slideshowLoop}><ArrowLeft aria-hidden="true" /></button>
          <button type="button" data-allow-arrows="true" aria-label={t("Next image")} onClick={() => immersive ? stepSlideshow(1) : moveFocus(1)} disabled={focusIndex === hits.length - 1 && !slideshowLoop}><ArrowRight aria-hidden="true" /></button>
        </div>
        <div className="photo-exhibition__corridor" role="list">
            {visibleItems.map(({ hit, index }) => {
              const focused = index === focusIndex;
              const subjectRef = hit.subject_ref || "";
              const offset = index - focusIndex;
              return <article className={`photo-exhibition__piece ${focused ? "is-focused" : ""}`} role="listitem" key={subjectRef || hit.entry_id || hit.name} data-corridor-visible={Math.abs(offset) <= 1 ? "true" : "false"} data-offset={offset} style={{ "--corridor-offset": offset } as CSSProperties}>
                <button type="button" className="photo-exhibition__image" data-focused={focused ? "true" : "false"} tabIndex={focused ? 0 : -1} aria-label={focused ? `${t("Inspect photo")} · ${hit.name || t("Untitled subject")}` : t("Focus {{name}}", { name: hit.name || t("Untitled subject") })} onFocus={() => { if (index === focusIndex && subjectRef) onFocusSubject(subjectRef); }} onClick={(event) => {
                  if (!focused) { focusItem(index); return; }
                  if (subjectRef) onFocusSubject(subjectRef);
                  const trigger = event.currentTarget;
                  runHostAction(() => onOpenPhotoPreview(hit, trigger));
                }}>
                  {renderThumbnail(hit)}
                  {focused && <span className="photo-exhibition__inspect"><Maximize2 aria-hidden="true" />{t("Inspect photo")}</span>}
                </button>
              </article>;
            })}
        </div>
      </div>
      <footer className="photo-exhibition__footer">
        <p className="photo-exhibition__current-caption" title={focusedHit?.name || t("Untitled subject")}>{focusedHit?.name || t("Untitled subject")}</p>
        <div className="photo-exhibition__actions">
          <button type="button" className="photo-exhibition__inspect-action" onClick={(event) => { const trigger = event.currentTarget; if (focusedHit) runHostAction(() => onOpenPhotoPreview(focusedHit, trigger)); }}>{t("Inspect photo")}</button>
          <button type="button" onClick={() => focusedHit && runHostAction(() => onOpenHit(focusedHit))}>{t("Details")}</button>
          <button type="button" className={`photo-exhibition__select ${focusedSelected ? "is-selected" : ""}`} aria-label={t(focusedSelected ? "Deselect {{name}}" : "Select {{name}}", { name: focusedHit?.name || t("Untitled subject") })} aria-pressed={focusedSelected} disabled={!focusedSubject} onClick={() => onToggleSelection(focusIndex)}><Check aria-hidden="true" />{t(focusedSelected ? "Selected" : "Select")}</button>
          {selectionRefs.length > 0 && onShowSelectionActions && <button type="button" onClick={() => runHostAction(onShowSelectionActions)}>{t("Show batch actions")}</button>}
        </div>
        <details className="photo-exhibition__help">
          <summary>{t("Browsing help")}</summary>
          <p>{t("Only the current photo and nearby previews are shown. Use the previous and next buttons or arrow keys to browse all loaded photos. Select the center photo to inspect it. Use Details to add Notes or tags and download the original.")}</p>
        </details>
      </footer>
    </>}
  </section>;
}
