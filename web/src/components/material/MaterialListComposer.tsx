import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Clipboard, Download, Plus, Save, X } from "lucide-react";
import type { Translator } from "../../i18n";
import type { SearchHit } from "../../lib/types";
import {
  applyMaterialListResult,
  MATERIAL_LIST_LIMITS,
  materialListPrompt,
  serializeMaterialList,
  type MaterialListDocument,
  type MaterialListItem,
  type MaterialRef,
} from "../../lib/materialList";
import { buildMaterialListGuide, createMaterialList, materialListFiles, readMaterialListGuideFile } from "../../lib/materialListIO";
import "./materialList.css";

export function MaterialListComposer({ t, workspaceID, subjects, catalogItems, initialDocument, busy, onClose, onSaveFiles }: {
  t: Translator;
  workspaceID: string;
  subjects: SearchHit[];
  catalogItems: SearchHit[];
  initialDocument?: MaterialListDocument;
  busy: boolean;
  onClose: () => void;
  onSaveFiles: (files: File[]) => void;
}) {
  const selectionKey = JSON.stringify(subjects.map((item) => [item.subject_ref, item.entry_id, item.content_id, item.logical_size]));
  const initialKey = initialDocument ? JSON.stringify(initialDocument) : "";
  const contextKey = `${workspaceID}\u0000${selectionKey}\u0000${initialKey}`;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;
  const subjectsRef = useRef(subjects);
  const catalogItemsRef = useRef(catalogItems);
  const workspaceIDRef = useRef(workspaceID);
  const initialDocumentRef = useRef(initialDocument);
  const translatorRef = useRef(t);
  subjectsRef.current = subjects;
  catalogItemsRef.current = catalogItems;
  workspaceIDRef.current = workspaceID;
  initialDocumentRef.current = initialDocument;
  translatorRef.current = t;
  const operationRef = useRef<AbortController | null>(null);
  const actionPendingRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<MaterialListDocument>();
  const [loading, setLoading] = useState(true);
  const [guideLoading, setGuideLoading] = useState(false);
  const [error, setError] = useState("");
  const [guideError, setGuideError] = useState("");
  const [guideName, setGuideName] = useState("");
  const [guideBody, setGuideBody] = useState("");
  const [guideSource, setGuideSource] = useState<MaterialRef>();
  const [guideHit, setGuideHit] = useState<SearchHit>();
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const guideCandidates = useMemo(() => catalogItems.filter((item) => item.entry_type === "REGULAR_FILE"
    && /\.(?:txt|md)$/iu.test(item.name ?? "")
    && typeof item.content_id === "string" && /^sha256:[0-9a-f]{64}$/.test(item.content_id)
    && Number.isSafeInteger(item.logical_size) && (item.logical_size as number) >= 0
    && Boolean(item.entry_id?.trim())), [catalogItems]);
  const guideBytes = new TextEncoder().encode(guideBody).byteLength;
  const importBytes = new TextEncoder().encode(importText).byteLength;

  useEffect(() => {
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => dialogRef.current?.focus());
    return () => priorFocus?.focus();
  }, []);

  function setGuideFrom(document?: MaterialListDocument) {
    setGuideName(document?.guide?.name ?? "");
    setGuideBody(document?.guide?.body ?? "");
    setGuideSource(document?.guide?.source);
  }

  useEffect(() => {
    const controller = new AbortController();
    operationRef.current?.abort();
    operationRef.current = controller;
    let live = true;
    actionPendingRef.current = false;
    setActionPending(false);
    setError("");
    setGuideError("");
    setImportError("");
    setFeedback("");
    setGuideLoading(false);
    setGuideHit(undefined);
    setImportText("");
    const initial = initialDocumentRef.current;
    if (initial) {
      setDraft(initial);
      setGuideName(initial.guide?.name ?? "");
      setGuideBody(initial.guide?.body ?? "");
      setGuideSource(initial.guide?.source);
      setLoading(false);
    } else {
      setDraft(undefined);
      setGuideName("");
      setGuideBody("");
      setGuideSource(undefined);
      setLoading(true);
      if (!subjectsRef.current.length) {
        setLoading(false);
        setError(translatorRef.current("Select one or more saved files to start a material list."));
      } else {
        void createMaterialList(subjectsRef.current, catalogItemsRef.current, workspaceIDRef.current, controller.signal).then((document) => {
          if (!live || contextKeyRef.current !== contextKey) return;
          setDraft(document);
        }).catch((reason: unknown) => {
          if (!live || controller.signal.aborted || contextKeyRef.current !== contextKey) return;
          setError(translatorRef.current(reason instanceof Error ? reason.message : "The selected material could not be read."));
        }).finally(() => {
          if (live && contextKeyRef.current === contextKey) setLoading(false);
        });
      }
    }
    return () => {
      live = false;
      controller.abort();
      operationRef.current?.abort();
      if (operationRef.current === controller) operationRef.current = null;
      actionPendingRef.current = false;
    };
  }, [contextKey]);

  const runWithController = (action: (controller: AbortController, key: string) => Promise<void>) => {
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    setActionPending(true);
    const controller = new AbortController();
    operationRef.current = controller;
    const key = contextKeyRef.current;
    void action(controller, key).catch((reason: unknown) => {
      if (!controller.signal.aborted && operationRef.current === controller && contextKeyRef.current === key) {
        setError(t(reason instanceof Error ? reason.message : "The operation could not be completed."));
      }
    }).finally(() => {
      if (operationRef.current === controller) operationRef.current = null;
      if (contextKeyRef.current === key) {
        actionPendingRef.current = false;
        setActionPending(false);
      }
    });
  };

  const operationIsCurrent = (controller: AbortController, key: string) => !controller.signal.aborted
    && operationRef.current === controller && contextKeyRef.current === key;

  function editItem(index: number, change: (item: MaterialListItem) => MaterialListItem) {
    setDraft((current) => current ? { ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? change(item) : item) } : current);
    setError("");
    setFeedback("");
  }

  function moveItem(index: number, delta: number) {
    setError("");
    setFeedback("");
    setDraft((current) => {
      if (!current) return current;
      const next = index + delta;
      if (next < 0 || next >= current.items.length) return current;
      const items = [...current.items];
      [items[index], items[next]] = [items[next]!, items[index]!];
      return { ...current, items };
    });
  }

  function setContext(index: number, key: string, value: string) {
    editItem(index, (item) => {
      const context = { ...(item.context ?? {}) };
      if (value) context[key] = value;
      else delete context[key];
      const next = { ...item };
      delete next.context;
      return Object.keys(context).length ? { ...next, context } : next;
    });
  }

  function chooseGuide(hit: SearchHit) {
    if (actionPendingRef.current) return;
    setGuideHit(hit);
    setGuideLoading(true);
    setGuideError("");
    setFeedback("");
    runWithController(async (controller, key) => {
      try {
        const guide = await readMaterialListGuideFile(hit, workspaceIDRef.current, controller.signal);
        if (!operationIsCurrent(controller, key)) return;
        setGuideName(guide.name);
        setGuideBody(guide.body);
        setGuideSource(guide.source);
      } catch (reason) {
        if (operationIsCurrent(controller, key)) setGuideError(t(reason instanceof Error ? reason.message : "The selected Skill could not be read."));
      } finally {
        if (operationIsCurrent(controller, key)) setGuideLoading(false);
      }
    });
  }

  function currentDocument(): Promise<MaterialListDocument> {
    return (async () => {
      if (!draft) throw new Error(t("The selected material is not ready yet."));
      const base = { ...draft };
      delete base.guide;
      const hasGuide = Boolean(guideName.trim() || guideBody.length || guideSource);
      const document: MaterialListDocument = {
        ...base,
        title: draft.title.trim(),
        ...(hasGuide ? { guide: await buildMaterialListGuide(guideName, guideBody, guideSource) } : {}),
      };
      serializeMaterialList(document);
      return document;
    })();
  }

  function copyPrompt() {
    setFeedback("");
    runWithController(async (_controller, key) => {
      try {
        const document = await currentDocument();
        if (!operationIsCurrent(_controller, key)) return;
        if (!navigator.clipboard?.writeText) throw new Error(t("Clipboard access is unavailable."));
        await navigator.clipboard.writeText(materialListPrompt(document));
        if (operationIsCurrent(_controller, key)) setFeedback(t("Prompt copied. Paste it into your chosen AI, then import its JSON result below."));
      } catch (reason) {
        if (operationIsCurrent(_controller, key)) setError(t(reason instanceof Error ? reason.message : "Could not prepare the organizing prompt."));
      }
    });
  }

  function applyImport() {
    setImportError("");
    runWithController(async (controller, key) => {
      try {
        const current = await currentDocument();
        if (!operationIsCurrent(controller, key)) return;
        const next = applyMaterialListResult(current, importText);
        if (!operationIsCurrent(controller, key)) return;
        setDraft(next);
        setGuideFrom(next);
        setImportText("");
        setError("");
        setFeedback(t("Imported result reviewed and applied to this draft."));
      } catch (reason) {
        if (operationIsCurrent(controller, key)) setImportError(t(reason instanceof Error ? reason.message : "The imported result is invalid."));
      }
    });
  }

  function downloadJSON() {
    setFeedback("");
    runWithController(async (controller, key) => {
      try {
        const doc = await currentDocument();
        const text = serializeMaterialList(doc);
        if (!operationIsCurrent(controller, key)) return;
        const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = "material-list.cairn-list.json";
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (reason) {
        if (operationIsCurrent(controller, key)) setError(t(reason instanceof Error ? reason.message : "Could not prepare the list file."));
      }
    });
  }

  function saveFiles() {
    setFeedback("");
    runWithController(async (controller, key) => {
      try {
        const document = await currentDocument();
        if (!operationIsCurrent(controller, key)) return;
        const files = await materialListFiles(document);
        if (!operationIsCurrent(controller, key)) return;
        onSaveFiles(files);
      } catch (reason) {
        if (operationIsCurrent(controller, key)) setError(t(reason instanceof Error ? reason.message : "Could not prepare the list files."));
      }
    });
  }

  return <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="material-list-title" className="material-list-panel" data-material-list="composer">
    <header className="material-list-header"><div><p className="eyebrow">{t("ORDINARY MATERIAL")}</p><h2 id="material-list-title">{t("Create a list")}</h2></div><button type="button" className="icon-button" aria-label={t("Close list editor")} onClick={onClose}><X size={17} /></button></header>
    <p className="material-list-intro">{t("Arrange exact saved files into a readable list. Notes and instructions are copied as context; originals and Notes are not changed.")}</p>
    <fieldset className="material-list-content" disabled={busy || loading || actionPending || guideLoading}>
    {loading ? <p className="material-list-status" role="status">{t("Reading selected files and Notes…")}</p> : error && !draft ? <div className="material-list-error" role="alert"><p>{error}</p><button type="button" className="secondary-button compact" onClick={() => {
      setError(""); setLoading(true);
      runWithController(async (controller, key) => {
        try { const next = await createMaterialList(subjects, catalogItems, workspaceID, controller.signal); if (!controller.signal.aborted && contextKeyRef.current === key) setDraft(next); }
        catch (reason) { if (!controller.signal.aborted && contextKeyRef.current === key) setError(t(reason instanceof Error ? reason.message : "The selected material could not be read.")); }
        finally { if (!controller.signal.aborted && contextKeyRef.current === key) setLoading(false); }
      });
    }}>{t("Retry reading selected material")}</button></div> : draft && <>
      <label className="material-list-title-field">{t("List name")}<input value={draft.title} onChange={(event) => { setDraft((current) => current ? { ...current, title: event.target.value } : current); setError(""); }} /></label>
      <div className="material-list-items-heading"><strong>{t("Ordered items")}</strong><small>{t("{{count}} of {{limit}} occurrences", { count: draft.items.length, limit: MATERIAL_LIST_LIMITS.items })}</small></div>
      <ol className="material-list-items">
        {draft.items.map((item, index) => <li className="material-list-item" key={`${index}:${item.ref.content_id}`}>
          <div className="material-list-item-top"><span className="material-list-order">{index + 1}</span><input aria-label={t("Label for item {{index}}", { index: index + 1 })} value={item.label} onChange={(event) => editItem(index, (current) => ({ ...current, label: event.target.value }))} />
            <div className="material-list-reorder"><button type="button" className="text-button" aria-label={t("Move item up")} disabled={index === 0} onClick={() => moveItem(index, -1)}><ArrowUp size={14} /></button><button type="button" className="text-button" aria-label={t("Move item down")} disabled={index === draft.items.length - 1} onClick={() => moveItem(index, 1)}><ArrowDown size={14} /></button></div>
          </div>
          <details className="material-list-context"><summary>{t("Notes and list context")}</summary>
            <label>{t("Reason for this list")}<textarea value={item.context?.reason ?? ""} onChange={(event) => setContext(index, "reason", event.target.value)} /></label>
            <label>{t("User-authored Notes")}<textarea value={item.context?.notes ?? ""} onChange={(event) => setContext(index, "notes", event.target.value)} /></label>
            <label>{t("Tags as context")}<input value={item.context?.tags ?? ""} onChange={(event) => setContext(index, "tags", event.target.value)} /></label>
          </details>
          <div className="material-list-item-actions"><button type="button" className="text-button" onClick={() => { setError(""); setFeedback(""); setDraft((current) => current && current.items.length < MATERIAL_LIST_LIMITS.items ? { ...current, items: [...current.items.slice(0, index + 1), { ...item, ref: { ...item.ref }, ...(item.context ? { context: { ...item.context } } : {}) }, ...current.items.slice(index + 1)] } : current); }} disabled={draft.items.length >= MATERIAL_LIST_LIMITS.items}><Plus size={13} />{t("Repeat item")}</button><button type="button" className="text-button danger" onClick={() => { setError(""); setFeedback(""); setDraft((current) => current ? { ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) } : current); }}><X size={13} />{t("Remove")}</button></div>
        </li>)}
      </ol>
      {draft.items.length === 0 && <p className="material-list-muted">{t("This is an intentionally empty list.")}</p>}
      <details className="material-list-guide">
        <summary>{t("Organizing Skill (optional)")}</summary>
        <p className="material-list-muted">{t("Choose a saved text file or enter instructions. The complete text is frozen in this list and also saved as an ordinary Skill file.")}</p>
        <label>{t("Choose a saved .txt or .md file")}<select defaultValue="" disabled={guideLoading || busy} onChange={(event) => { const hit = guideCandidates.find((candidate) => candidate.entry_id === event.target.value); if (hit) chooseGuide(hit); }}><option value="">{t("Choose from loaded files")}</option>{guideCandidates.map((hit) => <option key={`${hit.entry_id}:${hit.content_id}`} value={hit.entry_id}>{hit.name}</option>)}</select></label>
        {guideLoading && <p role="status">{t("Reading and checking the selected Skill…")}</p>}
        {guideError && <div className="material-list-error" role="alert"><p>{guideError}</p>{guideHit && <button type="button" className="text-button" onClick={() => chooseGuide(guideHit)} disabled={guideLoading}>{t("Retry reading selected Skill")}</button>}</div>}
        <label>{t("Skill name")}<input value={guideName} onChange={(event) => { setGuideName(event.target.value); setGuideSource(undefined); setGuideError(""); }} /></label>
        <label>{t("Skill instructions")}<textarea value={guideBody} onChange={(event) => { setGuideBody(event.target.value); setGuideSource(undefined); setGuideError(""); }} /></label>
        <small>{t("Skill text size: {{bytes}} / {{limit}} UTF-8 bytes.", { bytes: guideBytes, limit: MATERIAL_LIST_LIMITS.guideBytes })} {t("Editing clears the selected file identity.")}</small>
        {(guideBody || guideName || guideSource) && <button type="button" className="text-button" onClick={() => { setGuideBody(""); setGuideName(""); setGuideSource(undefined); setGuideHit(undefined); }}>{t("Remove instructions")}</button>}
      </details>
      <details className="material-list-import">
        <summary>{t("Import an organized JSON result")}</summary>
        <p className="material-list-muted">{t("Only references already in this draft are accepted. Imported text is treated as data; it is never executed.")}</p>
        <textarea aria-label={t("Paste material list JSON result")} value={importText} onChange={(event) => { setImportText(event.target.value); setImportError(""); }} placeholder={t("Paste the complete JSON result here")} />
        <small>{t("Imported JSON size: {{bytes}} / {{limit}} UTF-8 bytes.", { bytes: importBytes, limit: MATERIAL_LIST_LIMITS.jsonBytes })}</small>
        {importError && <p className="material-list-error" role="alert">{importError}</p>}
        <button type="button" className="secondary-button compact" onClick={applyImport} disabled={busy || loading || !importText.trim()}>{t("Validate and apply result")}</button>
      </details>
      {error && <p className="material-list-error" role="alert">{error}</p>}
      {feedback && <p className="material-list-feedback" role="status">{feedback}</p>}
      <p className="material-list-save-note">{t("Saving prepares a list file and Skill file for the existing upload and plan-review flow. It is saved only after that flow confirms the capture.")}</p>
      <footer className="material-list-actions"><button type="button" className="secondary-button compact" onClick={copyPrompt} disabled={busy || loading || guideLoading || !draft}><Clipboard size={14} />{t("Copy prompt for chosen AI")}</button><button type="button" className="secondary-button compact" onClick={downloadJSON} disabled={busy || loading || guideLoading || !draft}><Download size={14} />{t("Download JSON")}</button><button type="button" className="primary-button compact" onClick={saveFiles} disabled={busy || loading || guideLoading || !draft}><Save size={14} />{t("Review and save files")}</button></footer>
    </>}
    </fieldset>
  </section>;
}
