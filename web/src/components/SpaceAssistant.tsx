import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowUp, ArrowUpRight, Bookmark, FileText, FolderOpen, ListMusic, LoaderCircle, Maximize2, Paperclip, Plus, Search, Sparkles, X } from "lucide-react";
import type { Translator } from "../i18n";
import type { SearchHit } from "../lib/types";
import { type MaterialListDocument } from "../lib/materialList";
import { createMaterialList, materialListFiles, readMaterialListFile } from "../lib/materialListIO";
import { sha256ContentID } from "../lib/originalArchive";
import { parseSearchQuery, searchPlan } from "../lib/searchops";
import type { MaterialListAction } from "../lib/materialListActions";
import { MaterialListResult } from "./material/MaterialListResult";
import { FloatingSearchResults } from "./material/FloatingSearchResults";
import "./SpaceAssistant.css";

export type SpaceAssistantHandle = { focus: () => void; openList: (hit: SearchHit) => void; showResult: (document: MaterialListDocument) => void; reviewSave: (document: MaterialListDocument, captures?: File[], signal?: AbortSignal) => Promise<boolean> };
type Props = {
  ref?: Ref<SpaceAssistantHandle>; t: Translator; workspaceID: string; active: boolean; blocked: boolean; busy: boolean;
  playbackActive: boolean; catalogItems: SearchHit[]; selectedItems: SearchHit[]; notice?: string;
  onSearch: (query: string, onResults: (hits: SearchHit[], coverage?: string) => void) => Promise<boolean>;
  onOpen: (hit: SearchHit, query?: string) => void | Promise<void | boolean>; entryHint?: (hit: SearchHit) => string | undefined; onUse: (document: MaterialListDocument, action: MaterialListAction, trigger?: EventTarget | null) => void;
  onOrganize: (document: MaterialListDocument) => void; onSaveFiles: (files: File[]) => boolean;
};
export function SpaceAssistant({ ref, t, workspaceID, active, blocked, busy, playbackActive, catalogItems, selectedItems, notice, onSearch, onOpen, entryHint, onUse, onOrganize, onSaveFiles }: Props) {
  const input = useRef<HTMLTextAreaElement>(null), panel = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null), request = useRef(0), controller = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false), [expanded, setExpanded] = useState(false), [showResult, setShowResult] = useState(false);
  const [draft, setDraft] = useState(""), [files, setFiles] = useState<File[]>([]), [menu, setMenu] = useState(false);
  const [results, setResults] = useState<SearchHit[]>([]), [picked, setPicked] = useState<number[]>([]), [searched, setSearched] = useState("");
  const [result, setResult] = useState<MaterialListDocument>(), [retainedJSON, setRetainedJSON] = useState("");
  const [pendingSave, setPendingSave] = useState<{ contentID: string; size: number; json: string }>();
  const [working, setWorking] = useState(false), [error, setError] = useState("");
  const [coverage, setCoverage] = useState("");
  const disabled = blocked || busy || working || !workspaceID;
  const full = expanded || showResult;
  useEffect(() => () => { request.current++; controller.current?.abort(); }, []);
  useEffect(() => {
    if (!active || !open || full || blocked) return;
    function dismissOutside(event: PointerEvent) {
      if (!(event.target instanceof Node) || panel.current?.contains(event.target)) return;
      setOpen(false);
      setMenu(false);
      input.current?.blur();
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [active, open, full, blocked]);
  useEffect(() => {
    if (pendingSave && catalogItems.some(hit => hit.content_id === pendingSave.contentID && hit.logical_size === pendingSave.size && hit.entry_type === "REGULAR_FILE")) {
      setRetainedJSON(pendingSave.json); setPendingSave(undefined);
    }
  }, [pendingSave, catalogItems]);
  function focus() { setOpen(true); requestAnimationFrame(() => input.current?.focus()); }
  async function loadList(hit: SearchHit) {
    if (disabled) return;
    const token = ++request.current;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setWorking(true); setOpen(true); setError("");
    try {
      const document = await readMaterialListFile(hit, workspaceID, abort.signal);
      if (request.current !== token || abort.signal.aborted) return;
      setResult(document); setRetainedJSON(JSON.stringify(document)); setShowResult(true); setExpanded(false); setOpen(false);
    } catch (reason) { if (request.current === token && !abort.signal.aborted) setError(t(reason instanceof Error ? reason.message : "The list could not be read.")); }
    finally { if (request.current === token) setWorking(false); }
  }
  useImperativeHandle(ref, () => ({ focus, openList: hit => void loadList(hit), showResult: document => { setResult(document); setShowResult(true); setExpanded(false); setOpen(false); setError(""); }, reviewSave }));
  useEffect(() => {
    if (full && !blocked) panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [full, blocked]);
  useEffect(() => {
    if (!full || blocked) return;
    function key(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); if (menu) { setMenu(false); return; } returnToComposer(); return; }
      if (event.key !== "Tab") return;
      const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),summary') ?? [])].filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [full, blocked, menu]);
  useEffect(() => {
    if (!active || !open || full || blocked) return;
    function key(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (menu) { event.preventDefault(); setMenu(false); return; }
      event.preventDefault(); setOpen(false); input.current?.blur();
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [active, open, full, blocked, menu]);
  function returnToComposer() { setExpanded(false); setShowResult(false); requestAnimationFrame(() => { const field = input.current, root = panel.current; if (field?.isConnected && !field.disabled && field.getClientRects().length && root && !root.classList.contains("is-full") && !root.classList.contains("is-obscured")) field.focus({ preventScroll: true }); }); }
  async function search() {
    if (disabled || !draft.trim()) return;
    if (files.length) { setError(t("Files are waiting for review. Save them first, or remove them to search.")); return; }
    const text = draft.trim();
    const parsed = parseSearchQuery(text), plan = searchPlan(parsed);
    if (parsed.errors.length || plan.requestError) { setOpen(true); setError(t(parsed.errors[0]?.message || plan.requestError || "Search failed")); return; }
    const token = ++request.current;
    setWorking(true); setOpen(true); setError("");
    try {
      let received = false;
      const success = await onSearch(text, (hits, warning) => {
        if (request.current !== token) return;
        received = true; setCoverage(warning || ""); setResults(hits); setPicked([]); setSearched(text);
      });
      if (token !== request.current) return;
      if (!success || !received) setError(t("Search could not finish. Your previous result and draft are preserved."));
      else setDraft(value => value.trim() === text ? "" : value);
    } catch (reason) { if (token === request.current) setError(reason instanceof Error ? reason.message : t("Search failed")); }
    finally { if (token === request.current) setWorking(false); }
  }
  async function makeList(hits: SearchHit[]) {
    if (disabled || !hits.length) return;
    const token = ++request.current, abort = new AbortController();
    controller.current?.abort(); controller.current = abort; setWorking(true); setError("");
    try {
      const document = await createMaterialList(hits, catalogItems, workspaceID, abort.signal);
      if (token !== request.current || abort.signal.aborted) return;
      document.title = Array.from(searched || t("Material list")).slice(0, 160).join("");
      setResult(document); setRetainedJSON(""); setShowResult(true); setExpanded(false); setOpen(false);
    } catch (reason) { if (token === request.current && !abort.signal.aborted) { setOpen(true); setError(t(reason instanceof Error ? reason.message : "The selected material could not be read.")); } }
    finally { if (token === request.current) setWorking(false); }
  }
  async function reviewSave(document: MaterialListDocument, preparedFiles?: File[], signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    const token = ++request.current; setWorking(true); setError("");
    try {
      const captures = preparedFiles ?? await materialListFiles(document), json = JSON.stringify(document), file = captures.at(-1)!;
      const contentID = await sha256ContentID(new Uint8Array(await file.arrayBuffer()));
      if (token !== request.current || signal?.aborted) return false;
      if (!onSaveFiles(captures)) { setError(t("The operation could not be completed.")); return false; }
      setResult(document);
      setPendingSave({ contentID, size: file.size, json }); setShowResult(false); setExpanded(false); setOpen(false);
      return true;
    } catch (reason) { if (token === request.current) setError(reason instanceof Error ? reason.message : t("The operation could not be completed.")); return false; }
    finally { if (token === request.current) setWorking(false); }
  }
  function keepResult() { if (result && !disabled) void reviewSave(result); }
  function reviewInput() {
    if (disabled || (!files.length && !draft.trim())) return;
    const captures = [...files];
    if (draft.trim()) captures.push(new File([draft], `note-${Date.now()}.txt`, { type: "text/plain;charset=utf-8" }));
    setMenu(false); setOpen(false); setExpanded(false); onSaveFiles(captures);
  }
  async function openHit(hit: SearchHit, query?: string) {
    if (disabled) return;
    if (hit.name?.toLowerCase().endsWith(".cairn-list.json")) { void loadList(hit); return; }
    const token = ++request.current;
    setWorking(true); setError("");
    try {
      const opened = await onOpen(hit, query);
      if (token !== request.current) return;
      if (opened === false) { setOpen(true); setError(t("The item could not be opened. Your search and draft are preserved.")); return; }
      setExpanded(false); setShowResult(false); setOpen(false);
    } catch (reason) {
      if (token === request.current) { setOpen(true); setError(reason instanceof Error ? reason.message : t("Search failed")); }
    } finally { if (token === request.current) setWorking(false); }
  }
  const saved = Boolean(result && retainedJSON && JSON.stringify(result) === retainedJSON);
  const regularResults = results.map((hit, index) => ({ hit, index })).filter(({ hit }) => hit.entry_type === "REGULAR_FILE");
  const shown = expanded ? results : results.slice(0, 3);
  const resultCard = result && <article className="space-assistant-result"><span className="space-assistant-result-icon"><ListMusic size={25} /></span><div><small>{t(saved ? "Saved material" : "Not saved yet")}</small><button type="button" onClick={() => { setShowResult(true); setExpanded(false); setOpen(false); }}>{result.title}<ArrowUpRight size={15} /></button><p>{t("{{count}} items", { count: result.items.length })}</p></div><button type="button" className="icon-button" aria-label={t("Expand and use result")} onClick={() => { setShowResult(true); setExpanded(false); setOpen(false); }}><ArrowUpRight size={18} /></button></article>;
  const conversation = <div className="space-assistant-conversation" aria-live="polite">
    {resultCard}
    {searched ? <><div className="space-assistant-search-heading"><span><Search size={14} />{searched}</span><small>{t("{{count}} results returned", { count: results.length })}</small></div>{!results.length && <p className="space-assistant-empty">{t("No matching material. Try another phrase or browse your library.")}</p>}<FloatingSearchResults t={t} hits={shown} picked={picked} disabled={disabled} entryHint={entryHint} onPick={(index, checked) => setPicked(value => checked ? [...value, index] : value.filter(i => i !== index))} onOpen={hit => void openHit(hit, searched)} />{results.length > 3 && !expanded && <button type="button" className="text-button" onClick={() => setExpanded(true)}>{t("Expand all results")}</button>}{regularResults.length > 0 && <div className="space-assistant-result-actions"><button type="button" className="secondary-button compact" disabled={disabled || (!picked.length && regularResults.length > 200)} onClick={() => void makeList(picked.length ? picked.map(i => results[i]!).filter(Boolean) : regularResults.map(row => row.hit))}><ListMusic size={15} />{picked.length ? t("Organize {{count}} selected", { count: picked.length }) : t("Organize all {{count}} files", { count: regularResults.length })}</button><small>{t("Only returned material is included.")}</small></div>}</> : !result && <div className="space-assistant-welcome"><p>{t("Search your saved content, then open, organize or take it out.")}</p>{selectedItems.length > 0 && <button type="button" className="text-button" disabled={disabled} onClick={() => void makeList(selectedItems)}>{t("Organize {{count}} selected", { count: selectedItems.length })}<ArrowUpRight size={15} /></button>}</div>}
    {coverage && <details className="space-assistant-coverage"><summary>{t("Some search coverage is unavailable")}</summary><p>{coverage}</p></details>}
    {working && <p className="space-assistant-working" role="status"><LoaderCircle size={15} className="spin" />{t("Working with your material…")}</p>}
    {(error || notice) && <p className="space-assistant-error" role={error ? "alert" : "status"}>{error || notice}</p>}
  </div>;
  const composer = <div className="space-assistant-composer">{files.length > 0 && <><div className="space-assistant-files">{files.map((file, i) => <span key={i}><Paperclip size={13} />{file.name}<button type="button" aria-label={t("Remove attachment")} onClick={() => setFiles(value => value.filter((_, index) => i !== index))}><X size={13} /></button></span>)}</div><p className="space-assistant-attachment-note">{t("Attached files are not saved yet. Text is kept as a separate note.")}</p></>}<div className="space-assistant-compose-row"><button type="button" className="icon-button" aria-label={t("Add material")} onClick={() => { setMenu(!menu); setOpen(true); }} disabled={disabled}><Plus size={19} /></button><textarea ref={input} rows={1} aria-label={t("Find or organize material")} placeholder={t("Find something, or bring your material…")} value={draft} onFocus={() => setOpen(true)} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (files.length) reviewInput(); else void search(); } }} disabled={blocked || !workspaceID} /><button type="button" className="space-assistant-send" aria-label={t(files.length ? "Review saving attachments" : "Search saved material")} disabled={disabled || (!draft.trim() && !files.length)} onClick={() => files.length ? reviewInput() : void search()}>{working ? <LoaderCircle size={18} className="spin" /> : files.length ? <Bookmark size={18} /> : <ArrowUp size={18} />}</button></div>{menu && <div className="space-assistant-menu"><button type="button" onClick={() => fileInput.current?.click()}><Paperclip size={15} />{t("Attach files")}</button><button type="button" disabled={!draft.trim() || disabled} onClick={reviewInput}><Bookmark size={15} />{t("Review saving this text")}</button>{result && <button type="button" onClick={() => { setShowResult(true); setExpanded(false); setOpen(false); setMenu(false); }}><FolderOpen size={15} />{t("Return to organized result")}</button>}</div>}<input ref={fileInput} type="file" multiple hidden onChange={event => { const attached = Array.from(event.currentTarget.files ?? []); setFiles(value => [...value, ...attached]); setOpen(true); setMenu(false); event.currentTarget.value = ""; }} /></div>;
  if (!active) return null;
  return createPortal(<section ref={panel} className={`space-assistant ${full ? "is-full" : ""} ${open ? "is-open" : ""} ${blocked ? "is-obscured" : ""}`} style={{ "--assistant-player-offset": playbackActive ? "88px" : "0px" } as React.CSSProperties} role={full ? "dialog" : "region"} aria-modal={full && !blocked ? true : undefined} aria-label={t("Find and organize your space")} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { if (!event.dataTransfer.files.length || disabled) return; event.preventDefault(); event.stopPropagation(); const dropped = Array.from(event.dataTransfer.files); setFiles(value => [...value, ...dropped]); setOpen(true); }}>
    {full && !showResult && <header className="space-assistant-full-header"><button type="button" className="text-button" onClick={returnToComposer}><ArrowLeft size={17} />{t("Return to space")}</button><span>Cairn · {t("Your material")}</span>{result && <button type="button" className="text-button" onClick={() => { setShowResult(true); setExpanded(false); }}>{t("Open result")}</button>}</header>}
    {showResult && result ? <div className="space-assistant-expanded-content"><MaterialListResult t={t} workspaceID={workspaceID} document={result} catalogItems={catalogItems} saved={saved} busy={disabled} error={error} actionsDisabledReason={blocked ? t("Close the current panel before using a saved list.") : undefined} onChange={setResult} onUse={onUse} onOpen={hit => void openHit(hit)} onSave={keepResult} onEdit={() => onOrganize(result)} onClose={returnToComposer} /></div> : <>{(open || expanded) && <><header className="space-assistant-head"><span><Sparkles size={16} />{t("Find and organize")}</span><div>{!expanded && <button type="button" className="icon-button" aria-label={t("Expand workspace")} onClick={() => setExpanded(true)}><Maximize2 size={16} /></button>}</div></header>{conversation}</>}{composer}</>}
  </section>, document.body);
}
