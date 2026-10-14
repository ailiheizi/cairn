import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Image as ImageIcon, Maximize2 } from "lucide-react";
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
  const focusedHit = focusIndex >= 0 ? hits[focusIndex] : undefined;
  const focusedSubject = focusedHit?.subject_ref || "";
  const focusedSelected = Boolean(focusedSubject && selectionRefs.includes(focusedSubject));

  function moveFocus(delta: number) {
    setFocusIndex((current) => current < 0
      ? (delta > 0 ? 0 : Math.max(0, hits.length - 1))
      : Math.max(0, Math.min(hits.length - 1, current + delta)));
    requestAnimationFrame(() => stageRef.current?.querySelector<HTMLElement>("[data-focused='true']")?.focus());
  }

  function focusItem(index: number) {
    setFocusIndex(index);
    const subjectRef = hits[index]?.subject_ref;
    if (subjectRef) onFocusSubject(subjectRef);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, button[data-allow-arrows], [contenteditable='true']")) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); moveFocus(-1); }
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); moveFocus(1); }
  }

  return <section className="photo-exhibition" aria-label={t("Photo exhibition")}>
    <header className="photo-exhibition__header">
      <h1>{t("Exhibition")}</h1>
      <p className="photo-exhibition__scope" role="status">{t("{{current}} / {{total}} loaded photos", { current: focusIndex + 1, total: totalCount })}</p>
      <p className="photo-exhibition__selection-count" role="status">{t("{{count}} selected items", { count: selectionCount })}</p>
      <button type="button" className="photo-exhibition__return" onClick={onReturnToWall}><ImageIcon aria-hidden="true" />{returnLabel}</button>
    </header>
    {hits.length === 0 ? <div className="photo-exhibition__empty"><ImageIcon aria-hidden="true" /><h2>{t("No photos in the loaded listing")}</h2><p>{t("Other saved content remains available in the shared library.")}</p><button type="button" onClick={onReturnToWall}>{returnLabel}</button></div> : focusIndex < 0 ? <div className="photo-exhibition__empty" role="status"><ImageIcon aria-hidden="true" /><h2>{t("Focused image is no longer in these results")}</h2><p>{t("Your subject selection is unchanged. Move to an image in this loaded context to continue.")}</p><button type="button" onClick={() => moveFocus(1)}>{t("Go to first image")}</button></div> : <>
      <div ref={stageRef} className="photo-exhibition__stage" tabIndex={0} onKeyDown={handleKeyDown} aria-label={t("Use arrow keys to move through the exhibition")}>
        <div className="photo-exhibition__controls">
          <button type="button" data-allow-arrows="true" aria-label={t("Previous image")} onClick={() => moveFocus(-1)} disabled={focusIndex === 0}><ArrowLeft aria-hidden="true" /></button>
          <button type="button" data-allow-arrows="true" aria-label={t("Next image")} onClick={() => moveFocus(1)} disabled={focusIndex === hits.length - 1}><ArrowRight aria-hidden="true" /></button>
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
                  onOpenPhotoPreview(hit, event.currentTarget);
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
          <button type="button" className="photo-exhibition__inspect-action" onClick={(event) => focusedHit && onOpenPhotoPreview(focusedHit, event.currentTarget)}>{t("Inspect photo")}</button>
          <button type="button" onClick={() => focusedHit && onOpenHit(focusedHit)}>{t("Details")}</button>
          <button type="button" className={`photo-exhibition__select ${focusedSelected ? "is-selected" : ""}`} aria-label={t(focusedSelected ? "Deselect {{name}}" : "Select {{name}}", { name: focusedHit?.name || t("Untitled subject") })} aria-pressed={focusedSelected} disabled={!focusedSubject} onClick={() => onToggleSelection(focusIndex)}><Check aria-hidden="true" />{t(focusedSelected ? "Selected" : "Select")}</button>
          {selectionRefs.length > 0 && onShowSelectionActions && <button type="button" onClick={onShowSelectionActions}>{t("Show batch actions")}</button>}
        </div>
        <details className="photo-exhibition__help">
          <summary>{t("Browsing help")}</summary>
          <p>{t("Only the current photo and nearby previews are shown. Use the previous and next buttons or arrow keys to browse all loaded photos. Select the center photo to inspect it. Use Details to add Notes or tags and download the original.")}</p>
        </details>
      </footer>
    </>}
  </section>;
}
