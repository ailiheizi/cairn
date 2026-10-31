import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { SavedViewsFlow } from "../app/useSavedViews";
import type { Translator } from "../i18n";
import type { SavedRetrievalCandidate } from "../lib/savedRetrievalCandidate";
import type { SavedViewData } from "../lib/types";
import { SavedRetrievalEditor, type SavedRetrievalSourceRequest } from "./SavedRetrievalEditor";

export function FloatingSavedSearches({ t, flow, candidate, workspaceID, showSave, disabled, onRecall, onClose }: {
  t: Translator; flow: SavedViewsFlow; candidate: SavedRetrievalCandidate; workspaceID: string;
  showSave: boolean; disabled: boolean; onRecall: (view: SavedViewData) => Promise<boolean>; onClose: () => void;
}) {
  const mounted = useRef(true);
  const request = useRef(0);
  const [editing, setEditing] = useState(showSave);
  const [sourceRequest, setSourceRequest] = useState<SavedRetrievalSourceRequest>();
  const [feedback, setFeedback] = useState("");
  const ready = flow.savedViewsLoaded && !flow.savedViewsLoading && !flow.savedViewsError;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current++; };
  }, []);
  const rows = flow.savedViews.filter(view => view.scope === workspaceID);
  async function edit(view: SavedViewData) {
    if (!ready || flow.savedRetrievalSaving || disabled || !view.view_id) return;
    const token = ++request.current;
    const loaded = await flow.loadSavedRetrievalForEdit(view);
    if (!loaded || !mounted.current || token !== request.current) return;
    setSourceRequest({ token, view: loaded });
    setEditing(true);
  }
  return <section className="floating-saved-searches" aria-label={t("Saved searches")}>
    <header><div><strong>{t("Saved searches")}</strong><span>{t("This library")}</span></div><button type="button" className="icon-button" aria-label={t("Close saved searches")} disabled={disabled} onClick={onClose}><X size={16} /></button></header>
    {showSave && !editing && <button type="button" className="text-button" onClick={() => { setEditing(true); setSourceRequest(undefined); }} disabled={disabled}>{t("Save this search")}</button>}
    {editing && <SavedRetrievalEditor flow={flow} candidate={candidate} workspaceID={workspaceID} t={t} busy={disabled} sourceRequest={sourceRequest} onSaved={view => { if (!mounted.current) return; setEditing(false); setSourceRequest(undefined); setFeedback(view.name || t("Saved search")); }} />}
    {feedback && <p role="status">{t("Saved search: {{name}}", { name: feedback })}</p>}
    <button type="button" className="text-button" onClick={() => void flow.loadSavedViews()} disabled={flow.savedViewsLoading}>{t("Refresh")}</button>
    {flow.savedViewsLoading && <p role="status">{t("Loading saved views...")}</p>}
    {flow.savedViewsError && <p role="alert">{flow.savedViewsError}</p>}
    {ready && !rows.length && <p>{t("No saved views yet. Save a submitted keyword query or supported filter-only search to find it here later.")}</p>}
    {flow.savedViewsLoaded && !!rows.length && <ul>{rows.map(view => <li key={view.view_id || `${view.name}:${view.updated_at}`}>
      <strong>{view.name || t("Saved retrieval")}</strong><p>{view.query?.trim() || t("Filters only — no keyword text")}</p>
      <button type="button" className="secondary-button compact" disabled={disabled || !ready || !view.view_id || flow.savedRetrievalSaving} onClick={() => void onRecall(view)}>{t("Open in library")}</button>
      <details><summary>{t("More actions")}</summary><button type="button" className="text-button" disabled={disabled || !ready || !view.view_id || flow.savedRetrievalSaving} onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); void edit(view); }}>{t("Edit or copy conditions")}</button></details>
    </li>)}</ul>}
    <details><summary>{t("About saved searches")}</summary><p>{t("Opening a saved search reruns its keyword query or supported filters against current content. Semantic matches are not saved as a frozen result set.")}</p></details>
  </section>;
}
