import { AlertCircle, ArchiveRestore, Check, CheckCircle2, ChevronRight, Download as DownloadIcon, FileSearch, FileText, Hash, LoaderCircle, RefreshCw, Search, Server, Sparkles, X } from "lucide-react";
import type { Locale, Translator } from "../i18n";
import { formatBytes, formatDateTime, shortManifestID } from "../lib/format";
import type { ExportFlow } from "../app/useExport";
import type { ExportItem, ExportManifestData, SavedViewData } from "../lib/types";
import { SavedRetrievalEditor } from "./SavedRetrievalEditor";

// The export drawer.
//
// The drawer freezes one manifest, writes it, and verifies it against the same
// frozen digest. A history manifest defaults to verification; an explicit
// reproduction action can write the same frozen unit to a new empty directory.

export function ExportDrawer({ export: flow, query, locale, t, appBusy, workspaceID, onClose }: {
  export: ExportFlow;
  query: string;
  locale: Locale;
  t: Translator;
  appBusy: boolean;
  workspaceID: string;
  onClose: () => void;
}) {
  const { exportMode: mode, exportView: view, exportDestination: destination, exportManifest: manifest, exportManifestSource: manifestSource, exportAction: action, exportMessage: message, exportResult: result, exportWriteUncertain, exportVerificationOnly, exportHistoryReproductionReady, exportWriteAttempt, exportAttemptLocked, exportSelection, exportHistory: history, exportHistoryLoading: historyLoading, exportHistoryError: historyError, savedViews, savedViewsLoading, savedViewsError, changeExportMode: onMode, pickSavedViewForExport: onPickSavedView, recallSavedView: onRecallSavedView, loadSavedViews: onReloadSavedViews, pickHistoryManifest: onPickHistory, beginHistoryReproduction: onBeginHistoryReproduction, loadExportHistory: onReloadHistory, changeExportDestination: onDestination, exportSidecars: sidecars, changeExportSidecars: onSidecars, exportPresetApplied, previewExport: onPlan, applyExport: onApply, verifyExport: onVerify } = flow;
  const selectionCount = exportSelection.length;
  const selectionName = exportSelection.length === 1 ? exportSelection[0].name?.trim() ?? "" : "";
  const retrievalCandidate = flow.retrievalCandidate;
  const items = (manifest?.items ?? []).map((value) => { try { return JSON.parse(value) as ExportItem; } catch { return undefined; } }).filter((item): item is ExportItem => Boolean(item));
  const exactItems = items.filter((item) => item.exact !== false);
  const busy = flow.savedRetrievalSaving || ["SAVING_VIEW", "PLANNING", "APPLYING", "VERIFYING"].includes(action);
  const materialized = result?.materialized === true || result?.applied !== undefined;
  const currentDestination = destination.trim();
  const verifiedForCurrentDestination = result?.verified?.verified === true
    && action === "SUCCEEDED"
    && Boolean(currentDestination)
    && result?.verifiedDestination === currentDestination;
  const successful = materialized && action === "SUCCEEDED" && verifiedForCurrentDestination;
  const historyManifest = manifestSource === "history";
  const verifiedHistory = historyManifest && !materialized && verifiedForCurrentDestination;
  const sameRecordedTarget = Boolean(historyManifest && exportHistoryReproductionReady
    && manifest?.target?.trim() && currentDestination === manifest.target.trim());
  const manifestTitle = successful ? t("VERIFIED OUTPUT")
    : verifiedHistory || (exportVerificationOnly && verifiedForCurrentDestination) ? t("FROZEN MANIFEST VERIFIED")
      : exportWriteUncertain ? t("WRITE NOT CONFIRMED")
        : materialized ? t("OUTPUT WRITTEN")
          : historyManifest ? t("FROZEN MANIFEST")
            : t("READY TO MATERIALIZE");
  const selectedViewID = view?.view_id ?? "";
  const sidecarLabel = sidecars ? t("Handoff manifest (cairn-export.json)") : t("No sidecar");
  const actionText = action === "VERIFYING" ? t("Verifying output...")
    : exportHistoryReproductionReady ? t("Materialize these frozen files and verify")
      : t("Materialize and verify");
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="drawer export-drawer" role="dialog" aria-modal="true" aria-label={t("Export content")}>
    <div className="drawer-header"><div><p className="eyebrow">{t("MATERIALIZE")}</p><h2>{t("Export content")}</h2></div><button className="icon-button" aria-label={t("Close export")} onClick={onClose}><X size={17} /></button></div>
    <p className="drawer-copy">{t("Review the source and destination, then freeze, write, and verify the export.")}</p>
    <div className="export-boundary"><Server size={16} /><div><strong>{t("Server directory output")}</strong><small>{t("The daemon writes to a path on the Cairn host. This browser does not download or upload files.")}</small><small>{t("Output files are placed directly in this directory. Original folders are not recreated; files that would share a name get a numeric suffix.")}</small></div></div>
    <section className="export-source-choice" aria-label={t("Export selection")}><div className="export-choice-heading"><span>{t("What should be frozen?")}</span><small>{t("The manifest will not change when a view is evaluated again.")}</small></div><div className="export-choice-buttons">
      <button type="button" className={`export-choice ${mode === "selected" ? "active" : ""}`} onClick={() => onMode("selected")} disabled={busy || selectionCount === 0}><FileSearch size={16} /><span><strong>{t("Selected result")}</strong><small>{selectionCount > 1 ? t("{{count}} selected items", { count: selectionCount }) : selectionName || t("Choose a file result")}</small></span><ChevronRight size={14} /></button>
    </div></section>
    {savedViewsLoading && savedViews.length === 0 && <p className="muted export-source-status" role="status">{t("Loading saved views...")}</p>}
    {savedViewsError && <p className="export-list-error export-source-status" role="alert"><AlertCircle size={13} /><span><strong>{t("Saved views")}: </strong>{savedViewsError}</span></p>}
    <details className="export-other-sources" open={mode === "view" || selectionCount === 0}><summary><span>{t("Other export sources")}</span>{mode === "view" && <small>{t("Current source: {{name}}", { name: view?.name || query || (retrievalCandidate.fields.length ? t("Filters only — no keyword text") : t("Saved keyword query")) })}</small>}</summary>
      <div className="export-choice-buttons"><button type="button" className={`export-choice ${mode === "view" ? "active" : ""}`} onClick={() => onMode("view")} disabled={busy || !flow.canExportSavedView}><Search size={16} /><span><strong>{t("Saved views")}</strong><small>{view?.name || retrievalCandidate.query || t("Save a supported query or filter set")}</small></span><ChevronRight size={14} /></button></div>
      {mode === "view" && <details className="export-view-editor-disclosure" open={!view?.view_id}><summary>{t("Save this retrieval")}</summary><SavedRetrievalEditor
        flow={flow}
        candidate={retrievalCandidate}
        workspaceID={workspaceID}
        t={t}
        busy={busy || appBusy}
        initialName={view?.name || (retrievalCandidate.query.trim() ? `${t("Search")} · ${retrievalCandidate.query.trim().slice(0, 48)}` : "")}
        onSaved={(savedView) => flow.pickSavedViewForExport(savedView)}
      /></details>}
      <section className="export-saved-views" aria-label={t("Saved views")}><div className="export-list-heading"><span>{t("Saved views")}</span><button type="button" className="text-button export-list-reload" onClick={onReloadSavedViews} disabled={savedViewsLoading}><RefreshCw className={savedViewsLoading ? "spin" : ""} size={13} />{t("Refresh")}</button></div><small className="export-list-copy">{t("A saved view stays dynamic. Choosing one uses it as the export source; recalling one evaluates it now.")}</small>
      {!savedViewsLoading && !savedViewsError && savedViews.length === 0 && <p className="muted">{t("No saved views yet. Save a submitted keyword query or supported filter-only search to find it here later.")}</p>}
      <ul className="export-view-rows">{savedViews.map((item: SavedViewData) => {
        const isSelectedView = Boolean(item.view_id && item.view_id === selectedViewID);
        const viewLabel = item.name || t("Unnamed saved view");
        return <li className={`export-view-row ${isSelectedView ? "active" : ""}`} key={item.view_id}>
          <button type="button" className="export-view-pick" aria-pressed={isSelectedView} aria-label={t("Use saved view {{name}} as the export source", { name: viewLabel })} onClick={() => onPickSavedView(item)} disabled={busy || appBusy}>
            <span className="export-view-copy"><strong>{viewLabel}</strong><small>{t("revision {{revision}}", { revision: item.revision ?? 0 })} · {item.query || (item.fields?.length ? t("Filters only — no keyword text") : t("No saved query text"))}</small><small>{item.fields?.length ? `${t("Stored conditions")}: ${item.fields.join(" · ")}` : t("No additional supported filters")}</small></span>
            {isSelectedView ? <Check size={14} /> : <ChevronRight size={14} />}
          </button>
          <button type="button" className="export-view-recall" onClick={() => onRecallSavedView(item)} disabled={busy || appBusy || !item.view_id}><Search size={13} />{t("Recall in library")}</button>
        </li>;
      })}</ul>
    </section></details>
    <form className="stack-form export-form" onSubmit={(event) => { event.preventDefault(); onPlan(); }}>{exportPresetApplied && <small className="export-preset-note" data-export-preset="browser-local">{t("This browser pre-filled what it remembered from this library's last export. It is browser-local only; the daemon stores nothing from it.")}</small>}<label>{t("Server output directory")}<input aria-label={t("Server output directory")} value={destination} onChange={(event) => onDestination(event.target.value)} placeholder={t("/data/exports/my-selection")} disabled={busy || exportAttemptLocked} /><small className="path-helper"><Server size={13} />{t("Use an empty directory on the Cairn host. Existing files, collisions, and symlink destinations are rejected.")}</small></label>{exportHistoryReproductionReady && <p className="export-history-note" role="status">{t("This action reuses the same frozen files and sidecar policy. Cairn checks that the destination is empty when you confirm the write; the recorded target is not changed.")}</p>}{sameRecordedTarget && <p className="export-history-note" role="alert">{t("Choose a destination different from the manifest's recorded directory.")}</p>}{manifest && exportWriteAttempt && <details className="export-verification-target-note"><summary>{t("Materialization target details")}</summary><p>{t("Recorded target: {{target}}", { target: manifest.target?.trim() || t("Not reported") })}</p><p>{t("Attempted output directory: {{destination}}", { destination: exportWriteAttempt.destination })}</p><small>{t("The frozen manifest target is unchanged.")}</small></details>}{manifest && !exportWriteAttempt && exportVerificationOnly && manifest.target?.trim() !== currentDestination && <details className="export-verification-target-note"><summary>{t("Verification directory differs from recorded target")}</summary><p>{t("Recorded target: {{target}}", { target: manifest.target?.trim() || t("Not reported") })}</p><p>{t("Current verification directory: {{destination}}", { destination: currentDestination || t("Not set") })}</p><small>{t("Verification checks only the current directory. The frozen manifest target is unchanged.")}</small></details>}<details className="export-options"><summary>{t("Additional export options")}<small>{t("Sidecar policy: {{policy}}", { policy: sidecarLabel })}</small></summary><label>{t("Sidecar policy")}<select aria-label={t("Sidecar policy")} value={sidecars} onChange={(event) => onSidecars(event.target.value)} disabled={busy || Boolean(manifest)}><option value="">{t("No sidecar")}</option><option value="handoff-v1:manifest-json">{t("Handoff manifest (cairn-export.json)")}</option></select><small className="path-helper">{t("A sidecar is generated by the daemon from the frozen manifest and verified byte-for-byte; it never replaces or rewrites a frozen file.")}</small></label></details>{!manifest && <button className="primary-button" disabled={busy || !destination.trim() || (mode === "selected" ? selectionCount === 0 : !view?.view_id)}>{action === "PLANNING" ? <LoaderCircle className="spin" size={15} /> : <ArchiveRestore size={15} />}{t("Preview frozen export")}</button>}</form>
    {historyLoading && history.length === 0 && <p className="muted export-history-status" role="status">{t("Loading export history...")}</p>}
    {historyError && <p className="export-list-error export-history-status" role="alert"><AlertCircle size={13} /><span><strong>{t("Export history")}: </strong>{historyError}</span></p>}
    {message && <div className={`notice drawer-notice ${action === "FAILED" ? "error" : action === "SUCCEEDED" ? "success" : "warning"}`} role={action === "FAILED" ? "alert" : "status"}>{action === "FAILED" ? <AlertCircle size={15} /> : action === "SUCCEEDED" ? <Check size={15} /> : <Sparkles size={15} />}{message}</div>}
    {manifest && <div className={`plan-card export-plan-card ${successful ? "applied" : ""}`}><div className="plan-title"><div><p className="eyebrow">{t("FROZEN EXPORT MANIFEST")}</p><h3>{manifestTitle}</h3></div>{successful || verifiedHistory || (exportVerificationOnly && verifiedForCurrentDestination) ? <CheckCircle2 size={21} /> : materialized ? <Check size={21} /> : <ArchiveRestore size={21} />}</div><div className="plan-stats"><span><b>{manifest.subject_count ?? items.length}</b>{t("files")}</span><span><b>{formatBytes(items.reduce((total, item) => total + Number(item.logical_size ?? 0), 0))}</b>{t("logical content")}</span><span><b>{manifest.representation || "exact"}</b>{t("representation")}</span></div>{exactItems.length !== items.length && <div className="plan-warning" role="alert"><div className="plan-warning-title"><AlertCircle size={15} /><strong>{t("Some selected items do not have verified exact bytes and cannot make an exact export claim.")}</strong></div></div>}<details className="plan-files export-items" open><summary><FileText size={15} /><span>{t("Frozen files")}</span><b>{items.length}</b><ChevronRight size={14} /></summary><div className="plan-file-list">{items.map((item, index) => <div className="plan-file" key={`${item.subject_ref || "item"}-${index}`}><div className="plan-file-heading"><strong title={item.output_name}>{item.output_name || t("Unnamed entry")}</strong><span className={`plan-file-mode ${item.exact === false ? "unsafe" : ""}`}>{item.exact === false ? t("Unavailable") : t("EXACT")}</span></div><div className="plan-file-meta"><span>{item.exact === false ? t("No verified exact representation") : t("Exact bytes selected")}</span><span>{formatBytes(Number(item.logical_size ?? 0))}</span></div><details className="export-item-details"><summary>{t("Show identity details")}</summary><small className="mono">{t("SHA-256 identity")}: {item.content_id || t("Not reported")} · {t("Logical size")}: {formatBytes(Number(item.logical_size ?? 0))}</small></details></div>)}</div></details><details className="export-digest"><summary><Hash size={14} /><span>{t("Manifest proof and target")}</span><ChevronRight size={14} /></summary><div className="export-digest-body"><span>{t("Manifest digest")}</span><strong className="mono">{manifest.manifest_digest || t("Not reported")}</strong><span>{t("Server directory")}</span><strong className="mono">{manifest.target || destination}</strong></div></details>{materialized && !successful && <div className="plan-warning" role="status"><div className="plan-warning-title"><AlertCircle size={15} /><strong>{t("Output was written; verify it again against the same frozen manifest. Do not materialize it again.")}</strong></div></div>}{exportWriteUncertain && !materialized && <div className="plan-warning" role="alert"><div className="plan-warning-title"><AlertCircle size={15} /><strong>{t("The write outcome was not confirmed. Verify the same frozen manifest in the selected directory before taking further action.")}</strong></div>{exportWriteAttempt && <small>{t("Attempted output directory: {{destination}}", { destination: exportWriteAttempt.destination })}</small>}</div>}{historyManifest && !materialized && !exportHistoryReproductionReady && !exportWriteAttempt && <p className="muted export-history-note">{t("This manifest was frozen earlier and is verified against its destination. Verification never writes files again.")}</p>}{exportVerificationOnly ? <>{historyManifest && !exportAttemptLocked && !exportHistoryReproductionReady && <button type="button" className="secondary-button" onClick={onBeginHistoryReproduction} disabled={busy || appBusy}><DownloadIcon size={14} />{t("Materialize these frozen files to a new directory")}</button>}<button className="secondary-button" onClick={onVerify} disabled={busy || !destination.trim() || (exportAttemptLocked && exportWriteAttempt?.workspaceID !== workspaceID)}>{action === "VERIFYING" ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={14} />}{verifiedForCurrentDestination ? t("Verify again") : action === "VERIFYING" ? t("Verifying output...") : t("Verify this frozen manifest")}</button></> : materialized ? <button className="secondary-button" onClick={onVerify} disabled={busy}><RefreshCw size={14} />{successful ? t("Verify again") : action === "VERIFYING" ? <LoaderCircle className="spin" size={15} /> : t("Retry verification")}</button> : <button className="primary-button" onClick={onApply} disabled={busy || exactItems.length !== items.length || !destination.trim() || sameRecordedTarget}>{action === "APPLYING" || action === "VERIFYING" ? <LoaderCircle className="spin" size={15} /> : <DownloadIcon size={15} />}{actionText}</button>}</div>}
    <details className="export-history"><summary>{t("Export history")}</summary><div className="export-history-content"><div className="export-list-heading"><span>{t("Export history")}</span><button type="button" className="text-button export-list-reload" onClick={onReloadHistory} disabled={historyLoading}><RefreshCw className={historyLoading ? "spin" : ""} size={13} />{t("Refresh")}</button></div><small className="export-list-copy">{t("Frozen manifests are durable records. Verifying one again never writes files again.")}</small>
      {!historyLoading && !historyError && history.length === 0 && <p className="muted">{t("No exports have been frozen yet.")}</p>}
      <ul className="export-history-rows">{history.map((item: ExportManifestData) => {
        const isSelectedManifest = Boolean(item.manifest_id && item.manifest_id === manifest?.manifest_id);
        return <li key={item.manifest_id}>
          <button type="button" className={`export-history-row ${isSelectedManifest ? "active" : ""}`} title={item.manifest_id} aria-pressed={isSelectedManifest} aria-label={t("Use frozen manifest {{id}} as the export unit", { id: item.manifest_id ?? "" })} onClick={() => onPickHistory(item)} disabled={busy || appBusy || exportAttemptLocked}>
            <span className="export-history-head"><strong className="mono">{shortManifestID(item.manifest_id)}</strong><small>{formatDateTime(item.created_at ?? "", locale, t)}</small></span>
            <span className="export-history-facts"><span><b>{item.subject_count ?? 0}</b>{t("files")}</span><span>{item.representation || t("exact")}</span></span>
            <span className="export-history-target" title={item.target || undefined}>{item.target || t("Not reported")}</span>
          </button>
        </li>;
      })}</ul>
    </div></details>
  </aside></div>;
}
