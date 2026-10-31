import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, Bookmark, Check, Download, FileText, ListMusic, Music2, Pencil, Play, X } from "lucide-react";
import type { Translator } from "../../i18n";
import type { SearchHit } from "../../lib/types";
import { MATERIAL_LIST_LIMITS, type MaterialListDocument } from "../../lib/materialList";
import { projectMaterialListActions, type MaterialListAction } from "../../lib/materialListActions";
import "./MaterialListResult.css";

export type MaterialListResultProps = {
  t: Translator; workspaceID: string; document: MaterialListDocument; catalogItems: SearchHit[];
  saved?: boolean; busy?: boolean; error?: string; actionsDisabledReason?: string;
  onChange?: (document: MaterialListDocument) => void;
  onUse: (document: MaterialListDocument, action: MaterialListAction, trigger?: EventTarget | null) => void;
  onOpen?: (hit: SearchHit) => void; onEdit?: () => void; onSave?: () => void; onClose: () => void;
};

export function MaterialListResult({ t, workspaceID, document, catalogItems, saved, busy, error, actionsDisabledReason, onChange, onUse, onOpen, onEdit, onSave, onClose }: MaterialListResultProps) {
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(document.title);
  const projection = useMemo(() => projectMaterialListActions(document, catalogItems, workspaceID), [document, catalogItems, workspaceID]);
  const audio = projection.tracks.length > 0;
  const ready = projection.ready && !busy && !actionsDisabledReason;
  function move(index: number, delta: number) {
    const items = [...document.items], target = index + delta;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target]!, items[index]!];
    onChange?.({ ...document, items });
  }
  return <section className="material-result" aria-label={t("Use this result")} data-material-result>
    <header className="material-result-navigation"><span className="material-result-brand">Cairn <small>{t(saved ? "Saved material" : "Your organized result")}</small></span><button type="button" className="text-button" onClick={onClose}><X size={17} />{t("Return to space")}</button></header>
    <div className="material-result-hero"><div className="material-result-art">{audio ? <span className="material-result-record" aria-hidden="true"><span /></span> : <FileText size={58} strokeWidth={1} />}</div><div><p className="eyebrow">{t(audio ? "MUSIC LIST" : "MATERIAL LIST")}</p>{editing && onChange ? <input aria-label={t("List title")} value={titleDraft} maxLength={MATERIAL_LIST_LIMITS.titleCharacters} onChange={(event) => { const title = event.target.value; setTitleDraft(title); if (title.trim()) onChange({ ...document, title }); }} /> : <h1>{document.title}</h1>}<p>{t("{{count}} items", { count: document.items.length })} · {t(saved ? "Saved as ordinary material" : "Not saved yet")}</p></div></div>
    <div className="material-result-toolbar"><button type="button" className="primary-button" disabled={!ready || (!audio && !projection.originals.length)} onClick={(event) => onUse(document, audio ? "play" : "download", event.currentTarget)}>{audio ? <Play size={17} /> : <Download size={17} />}{t(audio ? "Play this list" : "Take out originals")}</button>{onSave && <button type="button" className="secondary-button" disabled={busy || !document.title.trim() || (editing && !titleDraft.trim()) || saved} onClick={onSave}>{saved ? <Check size={16} /> : <Bookmark size={16} />}{t(saved ? "Saved material" : "Keep in Library")}</button>}{onChange && <button type="button" className="text-button" aria-pressed={editing} disabled={busy || (editing && !titleDraft.trim())} onClick={() => { if (!editing) setTitleDraft(document.title); setEditing(!editing); }}><Pencil size={15} />{t(editing ? "Finish editing" : "Adjust this result")}</button>}</div>
    {error && <p className="material-result-status" role="alert">{error}</p>}
    {actionsDisabledReason && <p className="material-result-status" role="status">{actionsDisabledReason}</p>}
    {projection.unavailableCount > 0 && <p className="material-result-status" role="status">{t("Whole-list actions are unavailable while {{count}} item(s) are unresolved in the loaded scope.", { count: projection.unavailableCount })}</p>}
    {audio && projection.omittedAudioCount > 0 && <p className="material-result-status">{t("Audio playback skips {{count}} non-audio or unsupported item(s).", { count: projection.omittedAudioCount })}</p>}
    {projection.repeatedOriginalCount > 0 && <p className="material-result-status">{t("{{count}} repeated target(s) will be taken out once. File output order is not promised.", { count: projection.repeatedOriginalCount })}</p>}
    <ol className="material-result-items">{projection.resolved.map((row, index) => <li key={`${index}:${row.item.ref.content_id}`}><span className="material-result-order">{String(index + 1).padStart(2, "0")}</span><div className="material-result-row-copy"><button type="button" className="text-button" disabled={!row.hit || row.state !== "AVAILABLE" || busy} onClick={() => row.hit && onOpen?.(row.hit)}>{row.item.label || t("Untitled material")}<ArrowUpRight size={14} /></button>{row.item.context?.reason && <p>{row.item.context.reason}</p>}{row.state !== "AVAILABLE" && <p role="status">{t("Unavailable in the loaded content scope. This does not establish that the original is missing from the library.")}</p>}{(row.item.context?.notes || row.item.context?.tags) && <details><summary>{t("Notes and context")}</summary>{row.item.context.notes && <p>{row.item.context.notes}</p>}{row.item.context.tags && <p>{row.item.context.tags}</p>}</details>}</div>{editing && onChange && <div className="material-result-row-actions"><button type="button" className="icon-button" disabled={busy || index === 0} aria-label={t("Move item up")} onClick={() => move(index, -1)}><ArrowUp size={15} /></button><button type="button" className="icon-button" disabled={busy || index === document.items.length - 1} aria-label={t("Move item down")} onClick={() => move(index, 1)}><ArrowDown size={15} /></button><button type="button" className="icon-button" disabled={busy} aria-label={t("Remove item from result")} onClick={() => onChange({ ...document, items: document.items.filter((_, i) => i !== index) })}><X size={15} /></button></div>}</li>)}</ol>
    {!document.items.length && <p className="material-result-empty">{t("This list is intentionally empty.")}</p>}
    <footer className="material-result-footer">{onEdit && <button type="button" className="text-button" disabled={busy} onClick={onEdit}><Pencil size={15} />{t("Organize with a Skill")}</button>}<details><summary>{t("More list actions")}</summary><div><button type="button" className="text-button" disabled={!ready || !projection.tracks.length} onClick={(event) => onUse(document, "queue", event.currentTarget)}><Music2 size={15} />{t("Append audio to queue")}</button><button type="button" className="text-button" disabled={!ready || !projection.originals.length} onClick={(event) => onUse(document, "download", event.currentTarget)}><Download size={15} />{t("Take out originals")}</button><button type="button" className="text-button" disabled={!ready} onClick={(event) => onUse(document, "export", event.currentTarget)}>{t("Review server-directory export")}</button></div></details>{document.guide && <details><summary>{t("Organizing Skill")}: {document.guide.name}</summary><pre>{document.guide.body}</pre></details>}<small>{t("Removing an item changes this result only. Originals stay in your library.")}</small></footer>
  </section>;
}
