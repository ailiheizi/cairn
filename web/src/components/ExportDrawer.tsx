import { AlertCircle, ArchiveRestore, Check, CheckCircle2, ChevronRight, Download as DownloadIcon, FileSearch, FileText, Hash, LoaderCircle, RefreshCw, Save, Search, Server, Sparkles, X } from "lucide-react";
import type { Locale, Translator } from "../i18n";
import { formatBytes, formatDateTime, shortManifestID } from "../lib/format";
import type { ExportFlow } from "../app/useExport";
import type { ExportItem, ExportManifestData, SavedViewData } from "../lib/types";

// The export drawer.
//
// The drawer freezes one manifest, writes it once, and verifies it against the
// same frozen digest. A manifest recalled from export.list history is already a
// frozen unit of output: it may be verified, but the drawer never offers to
// materialize it again.

export function ExportDrawer({ export: flow, query, locale, t, appBusy, onClose }: {
  export: ExportFlow;
  query: string;
  locale: Locale;
  t: Translator;
  appBusy: boolean;
  onClose: () => void;
}) {
  const { exportMode: mode, exportViewName: viewName, exportView: view, exportDestination: destination, exportManifest: manifest, exportManifestSource: manifestSource, exportAction: action, exportMessage: message, exportResult: result, exportSelection, exportHistory: history, exportHistoryLoading: historyLoading, exportHistoryError: historyError, savedViews, savedViewsLoading, savedViewsError, changeExportMode: onMode, saveViewForExport: onSaveView, pickSavedViewForExport: onPickSavedView, recallSavedView: onRecallSavedView, loadSavedViews: onReloadSavedViews, pickHistoryManifest: onPickHistory, loadExportHistory: onReloadHistory, changeExportDestination: onDestination, exportSidecars: sidecars, changeExportSidecars: onSidecars, previewExport: onPlan, applyExport: onApply, verifyExport: onVerify } = flow;
  const selectionCount = exportSelection.length;
  const selectionName = exportSelection.length === 1 ? exportSelection[0].name?.trim() ?? "" : "";
  const canSaveSearch = Boolean(query.trim());
  const items = (manifest?.items ?? []).map((value) => { try { return JSON.parse(value) as ExportItem; } catch { return undefined; } }).filter((item): item is ExportItem => Boolean(item));
  const exactItems = items.filter((item) => item.exact !== false);
  const busy = ["SAVING_VIEW", "PLANNING", "APPLYING", "VERIFYING"].includes(action);
  const materialized = result?.materialized === true || result?.applied !== undefined;
  const successful = materialized && action === "SUCCEEDED" && result?.verified?.verified === true;
  // A manifest recalled from export.list history is already a frozen unit of
  // output. It may be verified against its destination, but the drawer must
  // never offer to materialize it again.
  const historyManifest = manifestSource === "history";
  const verifiedHistory = historyManifest && !materialized && result?.verified?.verified === true;
  const manifestTitle = verifiedHistory ? t("FROZEN MANIFEST VERIFIED") : successful ? t("VERIFIED OUTPUT") : materialized ? t("OUTPUT WRITTEN") : historyManifest ? t("FROZEN MANIFEST") : t("READY TO MATERIALIZE");
  const selectedViewID = view?.view_id ?? "";
  const actionText = action === "VERIFYING" ? t("Verifying output...") : t("Materialize and verify");
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="drawer export-drawer" role="dialog" aria-modal="true" aria-label={t("Export content")}>
    <div className="drawer-header"><div><p className="eyebrow">{t("MATERIALIZE")}</p><h2>{t("Export content")}</h2></div><button className="icon-button" aria-label={t("Close export")} onClick={onClose}><X size={17} /></button></div>
    <p className="drawer-copy">{t("Select one or more results or save the last submitted keyword query, freeze the membership, then write and verify it in an explicit server directory.")}</p>
    <div className="export-boundary"><Server size={16} /><div><strong>{t("Server directory output")}</strong><small>{t("The daemon writes to a path on the RestoreWeave host. This browser does not download or upload files.")}</small><small>{t("Output files are placed directly in this directory. Original folders are not recreated; files that would share a name get a numeric suffix.")}</small></div></div>
    <section className="export-source-choice" aria-label={t("Export selection")}><div className="export-choice-heading"><span>{t("What should be frozen?")}</span><small>{t("The manifest will not change when a view is evaluated again.")}</small></div><div className="export-choice-buttons">
      <button type="button" className={`export-choice ${mode === "selected" ? "active" : ""}`} onClick={() => onMode("selected")} disabled={busy || selectionCount === 0}><FileSearch size={16} /><span><strong>{t("Selected result")}</strong><small>{selectionCount > 1 ? t("{{count}} selected items", { count: selectionCount }) : selectionName || t("Choose a file result")}</small></span><ChevronRight size={14} /></button>
      <button type="button" className={`export-choice ${mode === "view" ? "active" : ""}`} onClick={() => onMode("view")} disabled={busy || !canSaveSearch}><Search size={16} /><span><strong>{t("Saved keyword query")}</strong><small>{view?.name || query || t("Run a search first")}</small></span><ChevronRight size={14} /></button>
    </div>{mode === "view" && <div className="export-view-editor"><label>{t("Saved query name")}<div className="inline-form"><input aria-label={t("Saved query name")} value={viewName} onChange={(event) => flow.setViewName(event.target.value)} placeholder={t("My saved search")} disabled={busy} /><button type="button" className="secondary-button compact" onClick={onSaveView} disabled={busy || !canSaveSearch || !viewName.trim()}>{action === "SAVING_VIEW" ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}{t(view ? "Update saved query" : "Save query")}</button></div></label><small className="export-query-boundary">{t("Only the last submitted keyword query can be saved. Current text edits are not saved until you search again.")}</small>{view && <small className="export-view-saved"><CheckCircle2 size={13} />{t("Query saved as a dynamic view. Save it before freezing the export.")}</small>}</div>}</section>
    <section className="export-saved-views" aria-label={t("Saved views")}><div className="export-list-heading"><span>{t("Saved views")}</span><button type="button" className="text-button export-list-reload" onClick={onReloadSavedViews} disabled={savedViewsLoading}><RefreshCw className={savedViewsLoading ? "spin" : ""} size={13} />{t("Refresh")}</button></div><small className="export-list-copy">{t("A saved view stays dynamic. Choosing one uses it as the export source; recalling one evaluates it now.")}</small>
      {savedViewsLoading && savedViews.length === 0 && <p className="muted" role="status">{t("Loading saved views...")}</p>}
      {savedViewsError && <p className="export-list-error" role="alert"><AlertCircle size={13} />{savedViewsError}</p>}
      {!savedViewsLoading && !savedViewsError && savedViews.length === 0 && <p className="muted">{t("No saved views yet. Save the last submitted keyword query to create one.")}</p>}
      <ul className="export-view-rows">{savedViews.map((item: SavedViewData) => {
        const isSelectedView = Boolean(item.view_id && item.view_id === selectedViewID);
        const viewLabel = item.name || t("Unnamed saved view");
        return <li className={`export-view-row ${isSelectedView ? "active" : ""}`} key={item.view_id}>
          <button type="button" className="export-view-pick" aria-pressed={isSelectedView} aria-label={t("Use saved view {{name}} as the export source", { name: viewLabel })} onClick={() => onPickSavedView(item)} disabled={busy || appBusy}>
            <span className="export-view-copy"><strong>{viewLabel}</strong><small>{t("revision {{revision}}", { revision: item.revision ?? 0 })} · {item.query || t("No saved query text")}</small></span>
            {isSelectedView ? <Check size={14} /> : <ChevronRight size={14} />}
          </button>
          <button type="button" className="export-view-recall" onClick={() => onRecallSavedView(item)} disabled={busy || appBusy || !item.view_id}><Search size={13} />{t("Recall in library")}</button>
        </li>;
      })}</ul>
    </section>
    <form className="stack-form export-form" onSubmit={(event) => { event.preventDefault(); onPlan(); }}><label>{t("Server output directory")}<input aria-label={t("Server output directory")} value={destination} onChange={(event) => onDestination(event.target.value)} placeholder={t("/data/exports/my-selection")} disabled={busy} /><small className="path-helper"><Server size={13} />{t("Use an empty directory on the RestoreWeave host. Existing files, collisions, and symlink destinations are rejected.")}</small></label><label>{t("Sidecar policy")}<select aria-label={t("Sidecar policy")} value={sidecars} onChange={(event) => onSidecars(event.target.value)} disabled={busy || Boolean(manifest)}><option value="">{t("No sidecar")}</option><option value="handoff-v1:manifest-json">{t("Handoff manifest (restoreweave-export.json)")}</option></select><small className="path-helper">{t("A sidecar is generated by the daemon from the frozen manifest and verified byte-for-byte; it never replaces or rewrites a frozen file.")}</small></label>{!manifest && <button className="primary-button" disabled={busy || !destination.trim() || (mode === "selected" ? selectionCount === 0 : !view?.view_id)}>{action === "PLANNING" ? <LoaderCircle className="spin" size={15} /> : <ArchiveRestore size={15} />}{t("Preview frozen export")}</button>}</form>
    <section className="export-history" aria-label={t("Export history")}><div className="export-list-heading"><span>{t("Export history")}</span><button type="button" className="text-button export-list-reload" onClick={onReloadHistory} disabled={historyLoading}><RefreshCw className={historyLoading ? "spin" : ""} size={13} />{t("Refresh")}</button></div><small className="export-list-copy">{t("Frozen manifests are durable records. Verifying one again never writes files again.")}</small>
      {historyLoading && history.length === 0 && <p className="muted" role="status">{t("Loading export history...")}</p>}
      {historyError && <p className="export-list-error" role="alert"><AlertCircle size={13} />{historyError}</p>}
      {!historyLoading && !historyError && history.length === 0 && <p className="muted">{t("No exports have been frozen yet.")}</p>}
      <ul className="export-history-rows">{history.map((item: ExportManifestData) => {
        const isSelectedManifest = Boolean(item.manifest_id && item.manifest_id === manifest?.manifest_id);
        return <li key={item.manifest_id}>
          <button type="button" className={`export-history-row ${isSelectedManifest ? "active" : ""}`} title={item.manifest_id} aria-pressed={isSelectedManifest} aria-label={t("Use frozen manifest {{id}} as the export unit", { id: item.manifest_id ?? "" })} onClick={() => onPickHistory(item)} disabled={busy || appBusy}>
            <span className="export-history-head"><strong className="mono">{shortManifestID(item.manifest_id)}</strong><small>{formatDateTime(item.created_at ?? "", locale, t)}</small></span>
            <span className="export-history-facts"><span><b>{item.subject_count ?? 0}</b>{t("files")}</span><span>{item.representation || t("exact")}</span></span>
            <span className="export-history-target" title={item.target || undefined}>{item.target || t("Not reported")}</span>
          </button>
        </li>;
      })}</ul>
    </section>
    {message && <div className={`notice drawer-notice ${action === "FAILED" ? "error" : action === "SUCCEEDED" ? "success" : "warning"}`} role={action === "FAILED" ? "alert" : "status"}>{action === "FAILED" ? <AlertCircle size={15} /> : action === "SUCCEEDED" ? <Check size={15} /> : <Sparkles size={15} />}{message}</div>}
    {manifest && <div className={`plan-card export-plan-card ${successful ? "applied" : ""}`}><div className="plan-title"><div><p className="eyebrow">{t("FROZEN EXPORT MANIFEST")}</p><h3>{manifestTitle}</h3></div>{successful || verifiedHistory ? <CheckCircle2 size={21} /> : materialized ? <Check size={21} /> : <ArchiveRestore size={21} />}</div><div className="plan-stats"><span><b>{manifest.subject_count ?? items.length}</b>{t("files")}</span><span><b>{formatBytes(items.reduce((total, item) => total + Number(item.logical_size ?? 0), 0))}</b>{t("logical content")}</span><span><b>{manifest.representation || "exact"}</b>{t("representation")}</span></div>{exactItems.length !== items.length && <div className="plan-warning" role="alert"><div className="plan-warning-title"><AlertCircle size={15} /><strong>{t("Some selected items do not have verified exact bytes and cannot make an exact export claim.")}</strong></div></div>}<details className="plan-files export-items" open><summary><FileText size={15} /><span>{t("Frozen files")}</span><b>{items.length}</b><ChevronRight size={14} /></summary><div className="plan-file-list">{items.map((item, index) => <div className="plan-file" key={`${item.subject_ref || "item"}-${index}`}><div className="plan-file-heading"><strong title={item.output_name}>{item.output_name || t("Unnamed entry")}</strong><span className={`plan-file-mode ${item.exact === false ? "unsafe" : ""}`}>{item.exact === false ? t("Unavailable") : t("EXACT")}</span></div><div className="plan-file-meta"><span>{item.exact === false ? t("No verified exact representation") : t("Exact bytes selected")}</span><span>{formatBytes(Number(item.logical_size ?? 0))}</span></div><details className="export-item-details"><summary>{t("Show identity details")}</summary><small className="mono">{t("SHA-256 identity")}: {item.content_id || t("Not reported")} · {t("Logical size")}: {formatBytes(Number(item.logical_size ?? 0))}</small></details></div>)}</div></details><details className="export-digest"><summary><Hash size={14} /><span>{t("Manifest proof and target")}</span><ChevronRight size={14} /></summary><div className="export-digest-body"><span>{t("Manifest digest")}</span><strong className="mono">{manifest.manifest_digest || t("Not reported")}</strong><span>{t("Server directory")}</span><strong className="mono">{manifest.target || destination}</strong></div></details>{materialized && !successful && <div className="plan-warning" role="status"><div className="plan-warning-title"><AlertCircle size={15} /><strong>{t("Output was written; verify it again against the same frozen manifest. Do not materialize it again.")}</strong></div></div>}{historyManifest && !materialized && <p className="muted export-history-note">{t("This manifest was frozen earlier and is verified against its destination. Verification never writes files again.")}</p>}{historyManifest && !materialized ? <button className="secondary-button" onClick={onVerify} disabled={busy || !destination.trim()}>{action === "VERIFYING" ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={14} />}{action === "VERIFYING" ? t("Verifying output...") : t("Verify this frozen manifest")}</button> : !materialized ? <button className="primary-button" onClick={onApply} disabled={busy || exactItems.length !== items.length || !destination.trim()}>{action === "APPLYING" || action === "VERIFYING" ? <LoaderCircle className="spin" size={15} /> : <DownloadIcon size={15} />}{actionText}</button> : <button className="secondary-button" onClick={onVerify} disabled={busy}><RefreshCw size={14} />{successful ? t("Verify again") : action === "VERIFYING" ? t("Verifying output...") : t("Retry verification")}</button>}</div>}
  </aside></div>;
}
