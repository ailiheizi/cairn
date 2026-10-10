import { AlertCircle, LoaderCircle, RefreshCw, Search, Save } from "lucide-react";
import { useState } from "react";
import type { ExportFlow } from "../app/useExport";
import type { Translator } from "../i18n";
import type { SavedViewData } from "../lib/types";
import { formatBytes, formatEntryType } from "../lib/format";
import "./SavedRetrievalPanel.css";

/** Named dynamic retrieval, available independently from selection and export. */
export function SavedRetrievalPanel({ flow, query, fields, unsupportedConditions, workspaceID, recalledActive = true, t, busy = false }: {
  flow: ExportFlow;
  /** Last submitted query, never the unsubmitted text currently in the search box. */
  query: string;
  /**
   * The conditions to preview and save. A live search passes only the
   * conditions this build understands; a recalled view passes every stored
   * condition, so one this build cannot label is rendered raw and marked
   * instead of being silently dropped from the preview.
   */
  fields: string[];
  /** Human-readable active conditions the caller could not serialize. */
  unsupportedConditions: string[];
  /** The workspace currently open, compared with a saved view's stored scope. */
  workspaceID: string;
  /** False when the library no longer displays the recalled view's evaluation. */
  recalledActive?: boolean;
  t: Translator;
  busy?: boolean;
}) {
  const [name, setName] = useState("");
  const canSave = Boolean(query.trim()) && Boolean(name.trim()) && unsupportedConditions.length === 0;
  const blocked = unsupportedConditions.length > 0;
  const fieldLabels: Record<string, string> = {
    entry_type: "Type",
    content_id: "Exact content identity",
    duplicate_group: "Duplicate group",
    protection_mode: "Protection mode",
    suffix: "Format",
    language: "Language",
    size_min: "Minimum size",
    size_max: "Maximum size",
    mtime_after: "Modified after",
    mtime_before: "Modified before",
  };
  const formatConditionValue = (key: string, value: string) => {
    if ((key === "size_min" || key === "size_max") && Number.isFinite(Number(value))) return formatBytes(Number(value));
    if (key === "entry_type") return formatEntryType(value, t);
    if ((key === "mtime_after" || key === "mtime_before") && Number.isFinite(Number(value))) {
      const date = new Date(Number(value));
      if (!Number.isNaN(date.valueOf())) return date.toLocaleString();
    }
    if (key === "protection_mode") return value.replaceAll("_", " ");
    return value;
  };
  const conditionRows: Array<{ raw?: string; label?: string; value?: string; unlabelled?: boolean }> = fields.map((field) => {
    const separator = field.indexOf("=");
    if (separator < 0) return { raw: field, unlabelled: true };
    const key = field.slice(0, separator);
    const label = fieldLabels[key];
    if (!label) return { raw: field, unlabelled: true };
    return { label: t(label), value: formatConditionValue(key, field.slice(separator + 1)) };
  });

  return <section className="saved-retrieval" aria-label={t("Saved retrieval")}>
    <header className="saved-retrieval-header">
      <div><p className="eyebrow">{t("RETRIEVAL")}</p><h2>{t("Saved retrieval")}</h2></div>
      <button type="button" className="text-button" onClick={() => void flow.loadSavedViews()} disabled={flow.savedViewsLoading}>
        <RefreshCw className={flow.savedViewsLoading ? "spin" : ""} size={14} />{t("Refresh")}
      </button>
    </header>
    <p className="saved-retrieval-copy">{t("Save a named keyword search with its supported filters. Matching content can change as your library changes.")}</p>
    <div className="saved-retrieval-save">
      <div className="saved-retrieval-preview" aria-label={t("Saved query preview")}>
        <div><strong>{t("Saved query")}</strong><code>{query.trim() || t("No keyword search submitted yet")}</code><small>{t("This preview shows the submitted search, not text still being edited.")}</small></div>
        <div><strong>{t("Saved filters")}</strong>{conditionRows.length ? <ul>{conditionRows.map((row, index) => <li key={`${fields[index]}-${index}`}>{row.raw ? <><code>{row.raw}</code>{row.unlabelled && <small className="saved-retrieval-unlabelled">{t("Stored condition this build cannot label")}</small>}</> : <><span>{row.label}</span><code>{row.value}</code></>}</li>)}</ul> : <small>{t("No additional supported filters")}</small>}</div>
      </div>
      <details className="saved-retrieval-explainer"><summary>{t("About saved searches")}</summary><p>{t("Opening a saved search reruns its keyword search against current content and supported filters. Semantic matches are not saved as a frozen result set.")}</p></details>
      <label>{t("Name this retrieval")}
        <div className="saved-retrieval-form">
          <input aria-label={t("Name this retrieval")} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("My saved search")} disabled={flow.savedRetrievalSaving || busy} />
          <button type="button" className="secondary-button compact" onClick={() => void flow.saveSavedRetrievalView(name, query, fields)} disabled={!canSave || flow.savedRetrievalSaving || busy}>
            {flow.savedRetrievalSaving ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}{t("Save view")}
          </button>
        </div>
      </label>
      {!query.trim() && <small>{t("Run a keyword search before saving a retrieval.")}</small>}
      {blocked && <p className="saved-retrieval-block" role="alert"><AlertCircle size={14} />{t("This view cannot save the active conditions yet: {{conditions}}", { conditions: unsupportedConditions.join(", ") })}</p>}
      {flow.savedRetrievalMessage && <p className={`saved-retrieval-message ${flow.savedRetrievalError ? "error" : ""}`} role={flow.savedRetrievalError ? "alert" : "status"}>{flow.savedRetrievalMessage}</p>}
    </div>
    <div className="saved-retrieval-list-heading"><strong>{t("Saved views")}</strong><span>{flow.savedViews.length}</span></div>
    {flow.savedViewsLoading && flow.savedViews.length === 0 && <p className="muted" role="status">{t("Loading saved views...")}</p>}
    {flow.savedViewsError && <p className="saved-retrieval-error" role="alert"><AlertCircle size={14} />{flow.savedViewsError}</p>}
    {!flow.savedViewsLoading && !flow.savedViewsError && flow.savedViews.length === 0 && <p className="muted">{t("No saved views yet. Save a submitted keyword query to find it here later.")}</p>}
    <ul className="saved-retrieval-rows">{flow.savedViews.map((view: SavedViewData) => {
      // The server's view.list is not workspace-filtered, so a view stored for
      // another workspace can appear here. This build compares the stored scope
      // with the workspace open now and marks the row instead of hiding it; a
      // record with no stored scope is left unmarked rather than guessed at.
      const storedScope = view.scope?.trim() ?? "";
      const foreignScope = Boolean(storedScope && workspaceID && storedScope !== workspaceID);
      return <li key={view.view_id ?? view.name}>
        <div className="saved-retrieval-view"><strong>{view.name || t("Unnamed saved view")}</strong><small>{view.query || t("No saved query text")} · {t("revision {{revision}}", { revision: view.revision ?? 0 })}</small></div>
        <div className="saved-retrieval-view-actions">
          {foreignScope && <em className="saved-retrieval-scope-flag" title={t("This saved view was stored for another workspace. Its results came from that stored scope, not from the workspace open here.")}>{t("Other workspace")}</em>}
          <button type="button" className="secondary-button compact" onClick={() => void flow.recallSavedView(view)} disabled={busy || !view.view_id}><Search size={14} />{t("Open in library")}</button>
        </div>
      </li>;
    })}</ul>
    {flow.recalledView && <p className={`saved-retrieval-outcome ${flow.recalledView.state.toLowerCase()}`} role={flow.recalledView.state === "DEGRADED" ? "alert" : "status"}>
      {flow.recalledView.state === "EMPTY" ? t("This saved view currently matches no content.") : flow.recalledView.state === "DEGRADED" ? flow.recalledView.message || t("Saved view evaluation is degraded.") : flow.recalledView.foreignScope ? t("Opened {{name}}. Its results came from that view's stored scope, not from the workspace open here.", { name: flow.recalledView.name }) : t("Opened {{name}} with current lexical results.", { name: flow.recalledView.name })}
    </p>}
    {flow.recalledView?.foreignScope && <p className="saved-retrieval-scope-note" role="status">{t("This saved view was stored for another workspace. Its results came from that stored scope, not from the workspace open here.")}</p>}
    {flow.recalledView && !recalledActive && <p className="saved-retrieval-outcome stale" role="status">{t("The library no longer shows this saved view's evaluation. Open it again to re-evaluate it.")}</p>}
  </section>;
}
