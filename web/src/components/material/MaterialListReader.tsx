import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Edit3, FileText, RefreshCw } from "lucide-react";
import type { Translator } from "../../i18n";
import { downloadOriginal } from "../../lib/contentDownload";
import { resolveMaterialList, type MaterialListDocument } from "../../lib/materialList";
import { readMaterialListFile } from "../../lib/materialListIO";
import type { SearchHit } from "../../lib/types";
import "./materialList.css";

export function MaterialListReader({ t, workspaceID, hit, catalogItems, onEdit }: {
  t: Translator;
  workspaceID: string;
  hit: SearchHit;
  catalogItems: SearchHit[];
  onEdit?: (document: MaterialListDocument) => void;
}) {
  const hitKey = JSON.stringify([workspaceID, hit.entry_id, hit.subject_ref, hit.content_id, hit.logical_size]);
  const hitKeyRef = useRef(hitKey);
  hitKeyRef.current = hitKey;
  const requestRef = useRef<AbortController | null>(null);
  const [document, setDocument] = useState<MaterialListDocument>();
  const [documentKey, setDocumentKey] = useState("");
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const currentDocument = documentKey === hitKey ? document : undefined;
  const resolved = useMemo(() => currentDocument ? resolveMaterialList(currentDocument, catalogItems) : [], [currentDocument, catalogItems]);

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setDocument(undefined);
    setDocumentKey("");
    setOpened(false);
    setLoading(false);
    setError("");
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [hitKey]);

  function openList() {
    if (currentDocument) { setOpened(true); return; }
    setLoading(true);
    setError("");
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const key = hitKeyRef.current;
    void readMaterialListFile(hit, workspaceID, controller.signal).then((loaded) => {
      if (controller.signal.aborted || hitKeyRef.current !== key) return;
      setDocument(loaded);
      setDocumentKey(key);
      setOpened(true);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted || hitKeyRef.current !== key) return;
      setError(t(reason instanceof Error ? reason.message : "The list could not be read."));
    }).finally(() => {
      if (!controller.signal.aborted && hitKeyRef.current === key) setLoading(false);
      if (requestRef.current === controller) requestRef.current = null;
    });
  }

  function closeList() {
    setOpened(false);
  }

  return <section className="material-list-reader" data-material-list="reader">
    {!opened ? <div className="material-list-reader-entry">
      <button type="button" className="secondary-button compact" onClick={openList} disabled={loading || !workspaceID.trim() || !hit.entry_id?.trim()} aria-busy={loading}>
      {loading ? <RefreshCw size={14} className="spin" /> : <FileText size={14} />}{loading ? t("Opening list…") : currentDocument ? t("Open list") : t("Open saved list")}
      </button>
      {error && <div className="material-list-error" role="alert"><p>{error}</p><button type="button" className="text-button" onClick={openList} disabled={loading}>{t("Retry reading list")}</button></div>}
    </div> : currentDocument && <>
      <header className="material-list-reader-header"><div><p className="eyebrow">{t("SAVED LIST")}</p><h3>{currentDocument.title}</h3></div><button type="button" className="text-button" onClick={closeList}>{t("Close list")}</button></header>
      {currentDocument.guide && <details className="material-list-reader-guide"><summary>{t("Organizing Skill")}: {currentDocument.guide.name}</summary><pre>{currentDocument.guide.body}</pre></details>}
      <ol className="material-list-reader-items">
        {resolved.map((row, index) => <li className="material-list-reader-item" key={`${index}:${row.item.ref.content_id}`}>
          <div className="material-list-reader-copy"><span className="material-list-order">{index + 1}</span><div><strong>{row.item.label || t("Untitled material")}</strong>
            {row.item.context?.reason && <p>{row.item.context.reason}</p>}
            {row.item.context?.notes && <details><summary>{t("User-authored Notes")}</summary><p className="material-list-preserved-text">{row.item.context.notes}</p></details>}
            {row.item.context?.tags && <small>{t("Tags as context")}: {row.item.context.tags}</small>}
            {row.state === "UNAVAILABLE" && <small className="material-list-unavailable" role="status">{t("Unavailable in the loaded content scope. This does not establish that the original is missing from the library.")}</small>}
          </div></div>
          {row.hit?.entry_type === "REGULAR_FILE" && row.hit.entry_id?.trim() && row.hit.content_id === row.item.ref.content_id && row.hit.logical_size === row.item.ref.logical_size
            ? <button type="button" className="secondary-button compact" onClick={() => downloadOriginal(workspaceID, row.hit!.entry_id!, row.hit!.name || row.item.label || "download.bin")}><Download size={14} />{t("Download original")}</button>
            : null}
        </li>)}
      </ol>
      {currentDocument.items.length === 0 && <p className="material-list-muted">{t("This list is intentionally empty.")}</p>}
      {onEdit && <footer className="material-list-reader-actions"><button type="button" className="secondary-button compact" onClick={() => onEdit(currentDocument)}><Edit3 size={14} />{t("Create revised snapshot")}</button><small>{t("This creates a new ordinary file capture; the saved list is unchanged.")}</small></footer>}
    </>}
  </section>;
}
