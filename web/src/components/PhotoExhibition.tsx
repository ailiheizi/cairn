import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Image as ImageIcon, Maximize2 } from "lucide-react";
import type { ReactNode, KeyboardEvent, CSSProperties } from "react";
import type { Translator } from "../i18n";
import type { SearchHit } from "../lib/types";
import "./PhotoExhibition.css";

const WINDOW_RADIUS = 2;

export function PhotoExhibition({ hits, totalCount = hits.length, selectedRef, selectionRefs, focusedSubjectRef, t, renderThumbnail, onToggleSelection, onOpenHit, onOpenPhotoPreview, onFocusSubject, onReturnToWall, returnLabel }: {
  hits: SearchHit[];
  totalCount?: number;
  selectedRef: string;
  selectionRefs: string[];
  focusedSubjectRef?: string;
  t: Translator;
  renderThumbnail: (hit: SearchHit) => ReactNode;
  onToggleSelection: (index: number) => void;
  onOpenHit: (hit: SearchHit) => void;
  onOpenPhotoPreview: (hit: SearchHit, trigger: HTMLElement) => void;
  onFocusSubject: (subjectRef: string) => void;
  onReturnToWall: () => void;
  returnLabel: string;
}) {
  const initialIndex = useMemo(() => {
    const desired = focusedSubjectRef || selectedRef;
    if (!desired) return hits.length ? 0 : -1;
    return hits.findIndex((hit) => hit.subject_ref === desired);
  }, []); // Initial focus follows the App-owned subject only when this page first opens.
  const [focusIndex, setFocusIndex] = useState(initialIndex);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const desired = focusedSubjectRef || selectedRef;
    const index = desired ? hits.findIndex((hit) => hit.subject_ref === desired) : -1;
    if (index >= 0) setFocusIndex(index);
    else if (desired) setFocusIndex(-1);
    else setFocusIndex((current) => hits.length ? Math.max(0, Math.min(hits.length - 1, current)) : -1);
  }, [focusedSubjectRef, hits, selectedRef]);

  const visibleItems = useMemo(() => {
    const start = Math.max(0, Math.min(hits.length - 1, focusIndex) - WINDOW_RADIUS);
    const end = Math.min(hits.length, start + WINDOW_RADIUS * 2 + 1);
    return hits.slice(start, end).map((hit, offset) => ({ hit, index: start + offset }));
  }, [focusIndex, hits]);

  function moveFocus(delta: number) {
    setFocusIndex((current) => current < 0
      ? (delta > 0 ? 0 : Math.max(0, hits.length - 1))
      : Math.max(0, Math.min(hits.length - 1, current + delta)));
    requestAnimationFrame(() => stageRef.current?.querySelector<HTMLElement>("[data-focused='true']")?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, button[data-allow-arrows], [contenteditable='true']")) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); moveFocus(-1); }
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); moveFocus(1); }
  }

  return <section className="photo-exhibition" aria-label={t("Photo exhibition")}>
    <header className="photo-exhibition__header">
      <div><p className="photo-exhibition__eyebrow">{t("A WALK THROUGH YOUR IMAGES")}</p><h1>{t("Exhibition")}</h1><p>{t("Explore saved images as a focused gallery. Search, tags, and Notes stay shared with your library.")}</p></div>
      <button type="button" className="photo-exhibition__return" onClick={onReturnToWall}><ImageIcon aria-hidden="true" />{returnLabel}</button>
    </header>
    <p className="photo-exhibition__scope" role="status">{hits.length
      ? t("Image {{current}} of {{total}} in this loaded context. Up to five nearby thumbnails are shown at once.", { current: Math.min(focusIndex + 1, hits.length), total: totalCount })
      : t("There are no image files in this loaded context.")}</p>
    {hits.length === 0 ? <div className="photo-exhibition__empty"><ImageIcon aria-hidden="true" /><h2>{t("No photos in the loaded listing")}</h2><p>{t("Other saved content remains available in the shared library.")}</p><button type="button" onClick={onReturnToWall}>{returnLabel}</button></div> : focusIndex < 0 ? <div className="photo-exhibition__empty" role="status"><ImageIcon aria-hidden="true" /><h2>{t("Focused image is no longer in these results")}</h2><p>{t("Your subject selection is unchanged. Move to an image in this loaded context to continue.")}</p><button type="button" onClick={() => moveFocus(1)}>{t("Go to first image")}</button></div> : <>
      <div className="photo-exhibition__controls">
        <button type="button" aria-label={t("Previous image")} onClick={() => moveFocus(-1)} disabled={focusIndex === 0}><ArrowLeft aria-hidden="true" />{t("Previous")}</button>
        <span>{t("{{current}} of {{total}}", { current: focusIndex + 1, total: totalCount })}</span>
        <button type="button" aria-label={t("Next image")} onClick={() => moveFocus(1)} disabled={focusIndex === hits.length - 1}>{t("Next")}<ArrowRight aria-hidden="true" /></button>
      </div>
      <div ref={stageRef} className="photo-exhibition__stage" tabIndex={0} onKeyDown={handleKeyDown} aria-label={t("Use arrow keys to move through the exhibition")}>
        <div className="photo-exhibition__corridor" role="list">
          {visibleItems.map(({ hit, index }) => {
            const focused = index === focusIndex;
            const subjectRef = hit.subject_ref || "";
            const selected = Boolean(subjectRef && selectionRefs.includes(subjectRef));
            const offset = index - focusIndex;
            return <article className={`photo-exhibition__piece ${focused ? "is-focused" : ""}`} role="listitem" key={subjectRef || hit.entry_id || hit.name} data-corridor-visible={Math.abs(offset) <= 1 ? "true" : "false"} style={{ "--corridor-offset": offset } as CSSProperties}>
              <button type="button" className="photo-exhibition__image" data-focused={focused ? "true" : "false"} tabIndex={focused ? 0 : -1} aria-label={t("Focus {{name}}", { name: hit.name || t("Untitled subject") })} onFocus={() => { setFocusIndex(index); if (subjectRef) onFocusSubject(subjectRef); }} onClick={() => { setFocusIndex(index); if (subjectRef) onFocusSubject(subjectRef); onOpenHit(hit); }}>
                {renderThumbnail(hit)}
                {focused && <span className="photo-exhibition__inspect"><Maximize2 aria-hidden="true" />{t("Open Details")}</span>}
              </button>
              <div className="photo-exhibition__caption"><strong>{hit.name || t("Untitled subject")}</strong></div>
              <div className="photo-exhibition__actions">
                <button type="button" className="photo-exhibition__inspect-action" onClick={(event) => onOpenPhotoPreview(hit, event.currentTarget)}>{t("Inspect photo")}</button>
                <button type="button" className={`photo-exhibition__select ${selected ? "is-selected" : ""}`} aria-pressed={selected} disabled={!subjectRef} onClick={() => onToggleSelection(index)}><Check aria-hidden="true" />{t(selected ? "Selected" : "Select")}</button>
              </div>
            </article>;
          })}
        </div>
      </div>
      <p className="photo-exhibition__keyboard">{t("Use Left and Right Arrow keys to move. Open Details to add Notes or tags, or download the exact original.")}</p>
    </>}
  </section>;
}
