import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { AlertCircle, Check, ChevronRight, HardDrive, RefreshCw, Server, Sparkles, Upload, X } from "lucide-react";
import type { Translator } from "../i18n";
import { uploadFiles } from "../app/command";
import { DrawerActionBar } from "./DrawerActionBar";
import { PlanCard } from "./PlanCard";
import { formatBytes } from "../lib/format";
import type { SourcesFlow } from "../app/useSources";
import type { Notice, UploadFileRow } from "../lib/types";
import "./SourceDrawer.css";

// The add/recheck source drawer.
//
// The ordinary Add surface is file-first: one centered modal that leads with a
// large choose/drop area, then keeps the same surface mounted through
// receiving -> preparing -> confirm -> saved. A successful, fully reported
// upload into its request-scoped staging directory automatically prepares the
// existing reviewable plan. Preparing is not saving: only the existing
// digest-bound confirmation invokes `plan.apply`. A failed, partial, or
// unknown upload stays visible with its per-file refusals and renames, and a
// known accepted subset needs an explicit review action.
//
// The server-directory import remains a secondary explicit entry that keeps
// the old right-side sheet, the path form, and the recheck distinction. The
// upload channel never writes into the repository, the catalog, or any
// configured source: staged bytes become protected only through the ordinary
// plan.ingest -> review -> digest-bound plan.apply flow.

const sourceFormID = "cairn-source-form";

type UploadMode = "path" | "upload";

function uploadRowLabel(row: UploadFileRow, t: Translator) {
  if (row.skipped_reason) return row.original_name || t("Unnamed file");
  return row.stored_name || row.original_name || t("Unnamed file");
}

export function SourceDrawer({ t, sources, isUnavailable, coreStorageReady, coreStorageMessage, notice, repositoryPath, pendingFiles, onPendingFilesConsumed, onStaged, onClose, onDone }: {
  t: Translator;
  sources: SourcesFlow;
  isUnavailable: boolean;
  coreStorageReady: boolean;
  coreStorageMessage: string;
  notice: Notice | undefined;
  repositoryPath: string;
  pendingFiles?: File[];
  onPendingFilesConsumed?: () => void;
  /** Called after files landed in the staging inbox so the shell can refresh the staging projection. */
  onStaged?: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const { source, recheckSourceRef, plan, planAction, planCheckBusy, pathSuggestions, sourceBarState, sourceBarReason, sourceSaveLabel, sourcePreviewDisabled, sourceSaveDisabled, sourceSuggestionDisabled, sourceLooksRemote } = sources;
  const [mode, setMode] = useState<UploadMode>(recheckSourceRef || source.trim() ? "path" : "upload");
  const [uploading, setUploading] = useState(false);
  const [uploadRows, setUploadRows] = useState<UploadFileRow[]>([]);
  const [uploadStagingDir, setUploadStagingDir] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadPartial, setUploadPartial] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  // The in-flight latch is a ref so two synchronous selections or a select and
  // a drop in the same tick cannot start two uploads.
  const uploadingRef = useRef(false);
  // A late response after the panel closed must not start an invisible review.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!pendingFiles?.length) return;
    setMode("upload");
    void handleUpload(pendingFiles);
    onPendingFilesConsumed?.();
  }, [pendingFiles]);

  useEffect(() => { if (recheckSourceRef) setMode("path"); }, [recheckSourceRef]);

  const acceptedRows = uploadRows.filter((row) => !row.skipped_reason);
  // The upload surface keeps the right-side sheet in path/recheck mode; only
  // the ordinary file-first Add is the centered modal.
  const uploadSurface = mode === "upload" && !recheckSourceRef;
  const surfaceBusy = uploading || planAction !== "IDLE" || planCheckBusy;
  // A prepared plan belongs to this upload only when it was prepared from this
  // exact staging directory. That derives from existing state and keeps a
  // stale server-path plan out of the upload surface.
  const stagedPlanActive = Boolean(uploadStagingDir) && source.trim() === uploadStagingDir && Boolean(plan);
  // The plan already lists the exact save scope. Keep upload refusals and
  // renamed files prominent without repeating every ordinary filename twice.
  const visibleUploadRows = stagedPlanActive ? uploadRows.filter((row) => row.skipped_reason || row.name_rewritten) : uploadRows;
  const uploadSaved = stagedPlanActive && plan?.state === "SUCCEEDED";
  const uploadAwaiting = stagedPlanActive && (Boolean(plan?.awaiting_confirmation) || plan?.state === "UNKNOWN") && plan?.state !== "SUCCEEDED";
  const uploadSelectionDisabled = surfaceBusy || stagedPlanActive || !coreStorageReady || isUnavailable;
  // The explicit review/retry runs the ordinary plan.ingest again over the
  // existing staging directory. It is offered before any plan exists and after
  // a blocked or up-to-date plan, but never for a saved or awaiting result.
  const canReviewStaged = Boolean(uploadStagingDir) && acceptedRows.length > 0 && planAction === "IDLE" && !planCheckBusy && !uploading && !uploadSaved && !uploadAwaiting && !(stagedPlanActive && plan?.executable);

  function uploadStatusText() {
    if (planAction === "INSPECTING") return t("Preparing the review…");
    if (planAction === "PROTECTING") return t("Saving content...");
    if (uploading) return t("Uploading…");
    if (uploadSaved) return t("Saved to the library.");
    if (uploadAwaiting) return t("Protection is not confirmed yet. Check the protection result below.");
    if (stagedPlanActive && plan && Number(plan.files ?? 0) <= 0 && plan.executable) return t("Already up to date. Nothing new to add from this source.");
    if (stagedPlanActive && plan && !plan.executable) return t("Cannot save this batch yet. Review the plan below.");
    if (acceptedRows.length > 0) return t("Received. These files are not saved yet.");
    return t("Choose files to start.");
  }

  const uploadPhase = uploadSaved
    ? "saved"
    : uploadAwaiting
      ? "unknown"
      : planAction === "PROTECTING"
        ? "saving"
        : planAction === "INSPECTING"
          ? "preparing"
          : stagedPlanActive
            ? Number(plan?.files ?? 0) <= 0 && plan?.executable ? "uptodate" : plan?.executable ? "confirm" : "blocked"
            : uploading ? "receiving" : acceptedRows.length > 0 ? "received" : "idle";

  function uploadRowStatus(row: UploadFileRow) {
    if (row.skipped_reason) return t("Not saved — refused");
    if (uploadSaved) return t("Saved");
    if (uploadAwaiting) return t("Result needs checking");
    return t("Received — not yet saved");
  }

  async function handleUpload(fileList: FileList | File[] | null) {
    if (!fileList || fileList.length === 0) return;
    if (uploadingRef.current || uploadSelectionDisabled) return;
    // Capture the selected batch before the async upload so the response can
    // be checked against it; a short or extra answer is not a complete report.
    const selectedCount = Array.from(fileList).length;
    uploadingRef.current = true;
    setUploading(true);
    setUploadError("");
    setUploadPartial(false);
    try {
      const outcome = await uploadFiles(Array.from(fileList));
      const rows = outcome.files ?? [];
      const accepted = rows.filter((row) => !row.skipped_reason);
      const directory = outcome.staging_dir?.trim() ?? "";
      // Accepted bytes really did land in the daemon inbox, so refresh the
      // staging projection even if this drawer is already gone. Nothing is
      // deleted or retired here.
      if (accepted.length > 0) onStaged?.();
      if (!mountedRef.current) return;
      setUploadRows(rows);
      setUploadStagingDir(directory);
      if (outcome.reason) setUploadError(outcome.message || outcome.reason);
      const unknownEmpty = rows.length === 0;
      const countMismatch = rows.length !== selectedCount;
      // A normal daemon echo carries an exact SHA-256 and length for every
      // accepted row. Missing or malformed identity is unresolved, never
      // silently treated as a complete batch.
      const identityComplete = accepted.every((row) =>
        /^[0-9a-f]{64}$/i.test(row.sha256 ?? "")
        && row.length !== undefined && row.length !== null && String(row.length).trim() !== ""
        && Number.isSafeInteger(Number(row.length))
        && Number(row.length) >= 0);
      const partial = Boolean(outcome.reason) || unknownEmpty || countMismatch || accepted.length !== rows.length || !identityComplete || (accepted.length > 0 && !directory);
      if (unknownEmpty && !outcome.reason) setUploadError(t("The server returned no file results for this upload, so the result is unknown. Nothing was prepared."));
      else if (!outcome.reason && countMismatch) setUploadError(t("The server reported a different number of files than were selected, so the result is incomplete. Nothing was prepared."));
      else if (!outcome.reason && accepted.length > 0 && !identityComplete) setUploadError(t("The server did not report a complete identity for every accepted file, so no review was prepared."));
      setUploadPartial(partial && accepted.length > 0);
      // Only a fully reported batch with a staging directory is prepared
      // automatically. A partial subset always needs the explicit action.
      if (!partial && accepted.length > 0 && directory) {
        sources.changeSourceInput(directory);
        await sources.runIngestPlan(directory);
      }
    } catch (error) {
      if (mountedRef.current) setUploadError(error instanceof Error ? error.message : t("Could not upload files."));
    } finally {
      uploadingRef.current = false;
      if (mountedRef.current) setUploading(false);
    }
  }

  // Retry the review of the existing staged directory without a second upload.
  // `changeSourceInput` drops the stale plan/source pair the same way an edited
  // path does, then the ordinary plan.ingest runs.
  function prepareStaged(directory: string) {
    if (!directory) return;
    sources.changeSourceInput(directory);
    void sources.runIngestPlan(directory);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const directory = Array.from(event.dataTransfer.items).some((item) => {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null }).webkitGetAsEntry?.();
      return entry?.isDirectory === true;
    });
    if (directory) { setUploadError(t("Folder drops are not supported. Choose individual files or use a server folder.")); return; }
    if (isUnavailable) { setUploadError(t("Start the Cairn service before previewing this source.")); return; }
    if (!coreStorageReady) { setUploadError(coreStorageMessage); return; }
    if (uploadingRef.current || planAction !== "IDLE" || planCheckBusy || stagedPlanActive) { setUploadError(t("Finish the current source operation before uploading files.")); return; }
    if (event.dataTransfer.files.length) { setMode("upload"); void handleUpload(event.dataTransfer.files); }
  }

  return <div className={`drawer-backdrop${uploadSurface ? " source-drawer-backdrop" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className={`drawer source-drawer${uploadSurface ? " source-drawer--upload" : ""}`} role="dialog" aria-modal="true" aria-label={t(recheckSourceRef ? "Recheck source" : mode === "upload" ? "Upload files" : "Add source")}>
      <div className="source-drawer-scroll">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">{t(recheckSourceRef ? "RECHECK SOURCE" : mode === "upload" ? "UPLOAD" : "NEW SOURCE")}</p>
            <h2>{t(recheckSourceRef ? "Recheck source" : mode === "upload" ? "Upload files" : "Add source")}</h2>
          </div>
          <button className="icon-button" aria-label={t("Close add source")} onClick={onClose}><X size={17} /></button>
        </div>
        <p className="drawer-copy">{t(recheckSourceRef ? "Inspect this source again. Review the changes, then confirm to publish a new snapshot." : mode === "upload" ? "Choose or drop files. Confirm once to save originals in your library." : "Choose a server folder and preview its exact storage plan. Saving starts only after you confirm.")}</p>
        {isUnavailable ? <div className="drawer-inline-warning" role="alert"><AlertCircle size={15} />{t("Start the Cairn service before previewing this source.")}</div>
          : !coreStorageReady ? <div className="drawer-inline-warning" role="alert"><AlertCircle size={15} />{coreStorageMessage}</div>
            : notice && (!uploadSurface || notice.kind !== "success") && <div className={`notice drawer-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.kind === "error" ? <AlertCircle size={16} /> : notice.kind === "warning" ? <Sparkles size={16} /> : <Check size={16} />}{notice.text}</div>}

        {mode === "upload" ? <>
          {!stagedPlanActive && <>
            <div
              className={`upload-zone upload-zone--drop${dragActive ? " dragging" : ""}${uploadRows.length > 0 ? " has-rows" : ""}`}
              onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragActive(true); } }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <label className="upload-picker">
                <Upload size={26} />
                <span>{uploading ? t("Uploading…") : t("Choose files to upload")}</span>
                <small>{t("Drop files here or choose them.")}</small>
                <input type="file" multiple autoFocus disabled={uploadSelectionDisabled} onChange={(event) => { void handleUpload(event.target.files); event.target.value = ""; }} />
              </label>
            </div>
          </>}
          {uploadPhase !== "idle" && uploadPhase !== "confirm" && <div className="upload-status" data-phase={uploadPhase} role="status">
            {uploadPhase === "saved" || uploadPhase === "uptodate" ? <Check size={15} />
              : uploadPhase === "blocked" || uploadPhase === "unknown" ? <AlertCircle size={15} />
                : uploadPhase === "preparing" || uploadPhase === "saving" || uploadPhase === "receiving" ? <RefreshCw size={15} className="spin" />
                  : <Upload size={15} />}
            {uploadStatusText()}
          </div>}
          {uploadError && <div className="notice error upload-error" role="alert"><AlertCircle size={15} />{uploadError}</div>}
          {uploadPartial && !uploadError && <div className="notice warning upload-partial" role="status"><AlertCircle size={15} />{uploadStagingDir ? t("Some files were not accepted. Each one is listed below with the server's answer.") : t("The server did not report a staging folder for this upload, so no review was prepared.")}</div>}
          {visibleUploadRows.length > 0 && <div className="upload-rows" data-staged={acceptedRows.length}>
            {visibleUploadRows.map((row, index) => <div className={`upload-row ${row.skipped_reason ? "failed" : "staged"}`} key={`${row.original_name ?? "row"}:${index}`}>
              {row.skipped_reason ? <AlertCircle size={14} /> : <Check size={14} />}
              <div className="upload-row-body">
                <strong title={uploadRowLabel(row, t)}>{uploadRowLabel(row, t)}</strong>
                <small className="upload-row-size">{formatBytes(Number(row.length ?? 0))} · {uploadRowStatus(row)}</small>
                {row.skipped_reason && <small className="upload-row-refusal"><AlertCircle size={12} />{row.skipped_reason}{row.message ? ` — ${row.message}` : ""}</small>}
                {!row.skipped_reason && row.name_rewritten && <small className="upload-row-rename">{t("renamed from {{name}}", { name: row.original_name ?? "" })}</small>}
                {!row.skipped_reason && row.sha256 && <details className="upload-row-details"><summary>{t("File identity details")}</summary><code>{row.sha256}</code></details>}
              </div>
            </div>)}
          </div>}
          {uploadStagingDir && <details className="upload-staging-details"><summary>{t("Staging path")}</summary><code>{uploadStagingDir}</code></details>}
          {stagedPlanActive && <PlanCard compact plan={plan} busy={planAction === "PROTECTING"} checking={planCheckBusy} coreStorageReady={coreStorageReady} t={t} onCheck={() => void sources.checkPlanStatus()} />}
          {canReviewStaged && <div className="upload-handoff">
            <button type="button" className="secondary-button" onClick={() => prepareStaged(uploadStagingDir)}><RefreshCw size={15} />{!stagedPlanActive && uploadPartial ? t("Review accepted files") : t("Preview storage plan")}</button>
          </div>}
          {!uploadSaved && !uploadAwaiting && <p className="planning-note">{t("Received files stay temporary until you confirm saving originals.")}</p>}
          {!stagedPlanActive && <button type="button" className="upload-server-entry" disabled={surfaceBusy} onClick={() => setMode("path")}><Server size={15} />{t("Server folder")}</button>}
        </> : <>
          <div className="source-kind"><span className="source-kind-icon"><HardDrive size={19} /></span><div><strong>{t("Server folder")}</strong><small>{t("Local disk or mounted storage visible to Cairn")}</small></div><em>{t("Supported now")}</em></div>
          <div className="source-route" aria-label={t("Source storage route")}><div><span>{t("Read from")}</span><strong title={source.trim()}>{source.trim() || t("Enter a server path")}</strong><small>{t("Source files stay in place")}</small></div><ChevronRight size={17} /><div><span>{t("Store unique bytes in")}</span><strong title={repositoryPath}>{repositoryPath}</strong><small>{t("Exact whole-file deduplication")}</small></div></div>
          <form className="stack-form" id={sourceFormID} onSubmit={sources.makePlan}>
            <label>{t("Path on Cairn host")}<input autoFocus value={source} onChange={(event) => { sources.changeSourceInput(event.target.value); }} disabled={planAction === "INSPECTING" || planAction === "PROTECTING" || planCheckBusy} placeholder={t("/data/to-add")} aria-invalid={sourceLooksRemote || undefined} /><small className="path-helper"><Server size={13} />{t("Use a local or mounted server path. This browser does not fetch URLs.")}</small>{sourceLooksRemote && <small className="source-inline-error"><AlertCircle size={13} />{t("Enter a server path, not a URL.")}</small>}</label>
            {pathSuggestions.length > 0 && <div className="source-suggestions" role="group" aria-label={t("Suggested source paths")}><span className="source-suggestions-label">{t("Recent and configured paths")}</span><div className="source-suggestions-list">{pathSuggestions.map((suggestion) => <button type="button" key={suggestion.key} className="source-suggestion" data-kind={suggestion.kind} title={suggestion.path} aria-label={t(suggestion.kind === "source" ? "Recheck {{path}}" : "Use recent path {{path}}", { path: suggestion.path })} disabled={sourceSuggestionDisabled} onClick={() => sources.pickSuggestedPath(suggestion)}><RefreshCw size={12} /><span>{suggestion.path}</span></button>)}</div></div>}
          </form>
          <p className="planning-note">{t("Planning records the source and plan in the catalog, but does not write file bytes or publish a snapshot until you confirm.")}</p>
          {plan && <PlanCard plan={plan} busy={planAction === "PROTECTING"} checking={planCheckBusy} coreStorageReady={coreStorageReady} t={t} onCheck={() => void sources.checkPlanStatus()} />}
          {!recheckSourceRef && <button type="button" className="source-upload-entry" disabled={surfaceBusy} onClick={() => setMode("upload")}><Upload size={15} />{t("Upload files")}</button>}
        </>}
      </div>
      {mode === "path" && <DrawerActionBar state={sourceBarState} reason={sourceBarReason} groupLabel={t("Source action")} previewLabel={t("Preview storage plan")} previewBusyLabel={t("Inspecting...")} previewBusy={planAction === "INSPECTING"} previewDisabled={sourcePreviewDisabled} confirmLabel={sourceSaveLabel} confirmBusyLabel={t("Saving content...")} confirmBusy={planAction === "PROTECTING"} confirmDisabled={sourceSaveDisabled} doneLabel={t("View saved content")} formID={sourceFormID} t={t} onApply={() => void sources.applyPlan()} onDone={onDone} onClose={onClose} />}
      {mode !== "path" && stagedPlanActive && <DrawerActionBar state={sourceBarState} reason={sourceBarReason} groupLabel={t("Source action")} previewLabel={t("Preview storage plan")} previewBusyLabel={t("Inspecting...")} previewBusy={planAction === "INSPECTING"} previewDisabled={sourcePreviewDisabled} confirmLabel={sourceSaveLabel} confirmBusyLabel={t("Saving content...")} confirmBusy={planAction === "PROTECTING"} confirmDisabled={sourceSaveDisabled} doneLabel={t("View saved content")} formID={sourceFormID} t={t} onApply={() => void sources.applyPlan()} onDone={onDone} onClose={onClose} />}
    </aside>
  </div>;
}
