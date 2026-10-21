import { AlertCircle, RefreshCw, Search } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";
import type { ExportFlow } from "../app/useExport";
import type { Translator } from "../i18n";
import type { SavedViewData } from "../lib/types";
import { hasSavedRetrievalTagFields, type SavedRetrievalCandidate } from "../lib/savedRetrievalCandidate";
import { projectSavedRetrievalConditions } from "../lib/savedRetrievalConditions";
import { SavedRetrievalEditor, type SavedRetrievalSourceRequest, type SavedRetrievalUpdateRequest } from "./SavedRetrievalEditor";

/** Named dynamic retrieval, available independently from selection and export. */
export function SavedRetrievalPanel({ flow, candidate, workspaceID, recalledActive = true, t, busy = false }: {
  flow: ExportFlow;
  candidate: SavedRetrievalCandidate;
  /** The workspace currently open, compared with a saved view's stored scope. */
  workspaceID: string;
  /** False when the library no longer displays the recalled view's evaluation. */
  recalledActive?: boolean;
  t: Translator;
  busy?: boolean;
}) {
  const { query, fields, unsupportedConditions } = candidate;
  const [savedViewFilter, setSavedViewFilter] = useState("");
  const [savedViewSort, setSavedViewSort] = useState<"updated" | "name">("updated");
  const [updateRequest, setUpdateRequest] = useState<SavedRetrievalUpdateRequest>();
  const [sourceRequest, setSourceRequest] = useState<SavedRetrievalSourceRequest>();
  const updateRequestToken = useRef(0);
  const sourceRequestToken = useRef(0);
  const hasSupportedConditions = fields.some((field) => Boolean(field.trim()));
  const savedViewsReady = flow.savedViewsLoaded && !flow.savedViewsLoading && !flow.savedViewsError;
  const canSavePayload = Boolean(query.trim() || hasSupportedConditions) && unsupportedConditions.length === 0 && savedViewsReady;
  const getConditionRows = (sourceFields: string[] = []) => projectSavedRetrievalConditions(sourceFields, t);
  const filterNeedle = savedViewFilter.trim().toLocaleLowerCase();
  const savedViews = flow.savedViews
    .map((view, originalIndex) => ({ view, originalIndex }))
    .filter(({ view }) => !filterNeedle || `${view.name ?? ""}\n${view.query ?? ""}\n${(view.fields ?? []).join("\n")}`.toLocaleLowerCase().includes(filterNeedle))
    .sort((left, right) => {
      const leftName = left.view.name?.trim() || t("Unnamed saved view");
      const rightName = right.view.name?.trim() || t("Unnamed saved view");
      if (savedViewSort === "name") {
        return leftName.localeCompare(rightName, undefined, { sensitivity: "base", numeric: true }) || left.originalIndex - right.originalIndex;
      }
      const updatedTime = (view: SavedViewData) => {
        for (const value of [view.updated_at, view.created_at]) {
          if (!value) continue;
          const parsed = Date.parse(value);
          if (Number.isFinite(parsed)) return parsed;
        }
        return undefined;
      };
      const leftTime = updatedTime(left.view);
      const rightTime = updatedTime(right.view);
      if (leftTime !== undefined && rightTime !== undefined && leftTime !== rightTime) return rightTime - leftTime;
      if (leftTime !== undefined && rightTime === undefined) return -1;
      if (leftTime === undefined && rightTime !== undefined) return 1;
      return leftName.localeCompare(rightName, undefined, { sensitivity: "base", numeric: true }) || left.originalIndex - right.originalIndex;
    });

  const storedViewScopeLabel = (view: SavedViewData) => {
    const storedScope = view.scope?.trim() ?? "";
    if (!storedScope) return t("Scope not recorded");
    return storedScope === workspaceID ? t("This library") : t("Other content");
  };

  const useNameForUpdate = (view: SavedViewData, event: MouseEvent<HTMLButtonElement>) => {
    const menu = event.currentTarget.closest("details");
    const summary = menu?.querySelector("summary");
    menu?.removeAttribute("open");
    if (!view.view_id || !savedViewsReady || !canSavePayload) return;
    setUpdateRequest({ token: ++updateRequestToken.current, view, trigger: summary ?? event.currentTarget });
  };

  const openSavedViewExport = (view: SavedViewData, event: MouseEvent<HTMLButtonElement>) => {
    if (busy || !flow.canExportSavedView || !view.view_id) return;
    const menu = event.currentTarget.closest("details");
    const trigger = menu?.querySelector("summary") ?? event.currentTarget;
    menu?.removeAttribute("open");
    // The host opens the existing drawer directly on this dynamic view; only
    // the user's explicit Preview action freezes a manifest.
    flow.openSavedViewExport(view, trigger);
  };

  const openSavedRetrievalEditor = async (view: SavedViewData, event: MouseEvent<HTMLButtonElement>) => {
    if (busy || flow.savedRetrievalSaving || !view.view_id) return;
    const menu = event.currentTarget.closest("details");
    const trigger = menu?.querySelector("summary") ?? event.currentTarget;
    menu?.removeAttribute("open");
    const current = await flow.loadSavedRetrievalForEdit(view);
    if (current) setSourceRequest({ token: ++sourceRequestToken.current, view: current, trigger });
  };

  return <section className="saved-retrieval" aria-label={t("Saved retrieval")}>
    <header className="saved-retrieval-header">
      <div><p className="eyebrow">{t("RETRIEVAL")}</p><h2>{t("Saved retrieval")}</h2></div>
      <button type="button" className="text-button" onClick={() => void flow.loadSavedViews()} disabled={flow.savedViewsLoading}>
        <RefreshCw className={flow.savedViewsLoading ? "spin" : ""} size={14} />{t("Refresh")}
      </button>
    </header>
    <SavedRetrievalEditor flow={flow} candidate={candidate} workspaceID={workspaceID} t={t} busy={busy} updateRequest={updateRequest} sourceRequest={sourceRequest} />
    <div className="saved-retrieval-list-heading"><strong>{t("Saved views")}</strong><span>{t("Showing {{visible}} of {{loaded}} loaded", { visible: savedViews.length, loaded: flow.savedViews.length })}</span></div>
    <div className="saved-retrieval-list-controls">
      <label className="saved-retrieval-filter"><span>{t("Find a saved search")}</span><input type="search" value={savedViewFilter} onChange={(event) => setSavedViewFilter(event.target.value)} placeholder={t("Search names, queries, and conditions")} /></label>
      <button type="button" className="text-button" onClick={() => setSavedViewFilter("")} disabled={!savedViewFilter}>{t("Clear search")}</button>
      <label className="saved-retrieval-sort"><span>{t("Sort")}</span><select value={savedViewSort} onChange={(event) => setSavedViewSort(event.target.value as "updated" | "name")}>
        <option value="updated">{t("Updated, newest first")}</option>
        <option value="name">{t("Name, A to Z")}</option>
      </select></label>
    </div>
    {flow.savedViewsLoading && flow.savedViews.length === 0 && <p className="muted" role="status">{t("Loading saved views...")}</p>}
    {flow.savedViewsError && <p className="saved-retrieval-error" role="alert"><AlertCircle size={14} />{flow.savedViewsError}</p>}
    {!flow.savedViewsLoading && !flow.savedViewsError && flow.savedViews.length === 0 && <p className="muted">{t("No saved views yet. Save a submitted keyword query or supported filter-only search to find it here later.")}</p>}
    {flow.savedViews.length > 0 && savedViews.length === 0 && <p className="muted" role="status">{t("No saved searches match this filter.")}</p>}
    <ul className="saved-retrieval-rows">{savedViews.map(({ view }: { view: SavedViewData; originalIndex: number }) => {
      // The server's view.list is not workspace-filtered, so a view stored for
      // another workspace can appear here. This build compares the stored scope
      // with the workspace open now and marks the row instead of hiding it; a
      // record with no stored scope is left unmarked rather than guessed at.
      const storedScope = view.scope?.trim() ?? "";
      const foreignScope = Boolean(storedScope && workspaceID && storedScope !== workspaceID);
      const validTimestamp = (value?: string) => value && Number.isFinite(Date.parse(value)) ? value : undefined;
      const updatedAt = validTimestamp(view.updated_at);
      const createdAt = validTimestamp(view.created_at);
      const updatedLabel = updatedAt
        ? t("Updated {{date}}", { date: new Date(updatedAt).toLocaleString() })
        : createdAt
          ? t("Update time unavailable; created {{date}}", { date: new Date(createdAt).toLocaleString() })
          : t("Update time unavailable");
      const storedConditions = getConditionRows(view.fields ?? []);
      return <li key={view.view_id ?? `${view.name}-${view.query}`}>
        <div className="saved-retrieval-view"><strong>{view.name || t("Unnamed saved view")}</strong><small>{view.query || (view.fields?.length ? t("Filters only — no keyword text") : t("No saved query text"))} · {t("revision {{revision}}", { revision: view.revision ?? 0 })}</small><small>{updatedLabel}</small>
          <details className="saved-retrieval-row-conditions">
            <summary>{t("Stored query and conditions")}</summary>
            <div className="saved-retrieval-stored-details">
              <div><strong>{t("Stored query")}</strong><code>{view.query?.trim() || (view.fields?.length ? t("Filters only — no keyword text") : t("No saved query text"))}</code></div>
              <div><strong>{t("Content scope")}</strong><span>{storedViewScopeLabel(view)}</span></div>
              <div><strong>{t("Stored conditions")}</strong>{storedConditions.length ? <>{hasSavedRetrievalTagFields(view.fields ?? []) && <small>{t("All listed tags must match (AND).")}</small>}<ul>{storedConditions.map((row, index) => <li key={`${view.fields?.[index]}-${index}`}>{row.raw ? <><code>{row.raw}</code>{row.unlabelled && <small className="saved-retrieval-unlabelled">{t("Stored condition this build cannot label")}</small>}</> : <><span>{row.label}</span><code>{row.value}</code></>}</li>)}</ul></> : <small>{t("No additional supported filters")}</small>}</div>
            </div>
          </details>
        </div>
        <div className="saved-retrieval-view-actions">
          {foreignScope && <em className="saved-retrieval-scope-flag" title={t("This saved view was stored for content other than what is open here. Its results came from that stored scope, not from the content open here.")}>{t("Other content")}</em>}
          <button type="button" className="secondary-button compact" onClick={() => void flow.recallSavedView(view)} disabled={busy || !view.view_id}><Search size={14} />{t("Open in library")}</button>
          <details className="saved-retrieval-row-more">
            <summary className="secondary-button compact">{t("More actions")}</summary>
            <div className="saved-retrieval-row-menu">
              <button type="button" className="secondary-button compact" onClick={(event) => useNameForUpdate(view, event)} disabled={foreignScope || view.scope !== workspaceID || !canSavePayload || !view.view_id || !Number.isFinite(view.revision) || flow.savedRetrievalSaving || busy}>{t("Use this name to update")}</button>
              <button type="button" className="secondary-button compact" onClick={(event) => void openSavedRetrievalEditor(view, event)} disabled={flow.savedRetrievalSaving || busy || !view.view_id}>{t("Edit or copy conditions")}</button>
              <button type="button" className="secondary-button compact" onClick={(event) => openSavedViewExport(view, event)} disabled={busy || !flow.canExportSavedView || !view.view_id}>{t("Export this saved search")}</button>
            </div>
          </details>
        </div>
      </li>;
    })}</ul>
    {flow.recalledView && <p className={`saved-retrieval-outcome ${flow.recalledView.state.toLowerCase()}`} role={flow.recalledView.state === "DEGRADED" ? "alert" : "status"}>
      {flow.recalledView.state === "EMPTY" ? t("This saved view currently matches no content.") : flow.recalledView.state === "DEGRADED" ? flow.recalledView.message || t("Saved view evaluation is degraded.") : flow.recalledView.foreignScope ? t("Opened {{name}}. Its results came from that view's stored scope, not from the content open here.", { name: flow.recalledView.name }) : t("Opened {{name}} with current lexical results.", { name: flow.recalledView.name })}
      {flow.recalledView.state === "READY" && <><span className="saved-retrieval-loaded-count">{t("{{count}} loaded matches", { count: flow.recalledView.loadedCount })}</span>{flow.recalledView.mayHaveMore && <span className="saved-retrieval-loaded-count">{t("This view may have more matches than the loaded results.")}</span>}</>}
    </p>}
    {flow.recalledView?.foreignScope && <p className="saved-retrieval-scope-note" role="status">{t("This saved view was stored for content other than what is open here. Its results came from that stored scope, not from the content open here.")}</p>}
    {flow.recalledView && !recalledActive && <p className="saved-retrieval-outcome stale" role="status">{t("The library no longer shows this saved view's evaluation. Open it again to re-evaluate it.")}</p>}
  </section>;
}
