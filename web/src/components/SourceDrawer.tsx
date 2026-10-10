import { useEffect, useState } from "react";
import type { DragEvent } from "react";
import { AlertCircle, Check, ChevronRight, HardDrive, FolderOpen, RefreshCw, Server, Sparkles, Upload, X } from "lucide-react";
import type { Translator } from "../i18n";
import { uploadFiles } from "../app/command";
import { DrawerActionBar } from "./DrawerActionBar";
import { PlanCard } from "./PlanCard";
import { formatBytes } from "../lib/format";
import type { SourcesFlow } from "../app/useSources";
import type { Notice, UploadFileRow } from "../lib/types";

// The add/recheck source drawer.
//
// One column: a scrollable review body and the sticky action bar as the
// drawer's single primary action. The path field is a server path; the drawer
// copy keeps the recheck distinction honest.
//
// The upload mode is the bounded channel into the daemon-owned staging inbox:
// the browser streams the chosen files to `POST /api/v1/upload` and renders
// the daemon's per-file answer (name, size, short digest, or the typed
// refusal). Upload never writes into the repository, the catalog, or any
// configured source — the staged bytes become protected only through the
// ordinary plan.ingest → review → digest-bound plan.apply flow, which the
// handoff below prefills.

const sourceFormID = "restoreweave-source-form";

type UploadMode = "path" | "upload";

function uploadRowLabel(row: UploadFileRow, t: Translator) {
  if (row.skipped_reason) return row.original_name || t("Unnamed file");
  return row.stored_name || row.original_name || t("Unnamed file");
}

function uploadRowDetail(row: UploadFileRow, t: Translator) {
  if (row.skipped_reason) return `${row.skipped_reason}${row.message ? ` — ${row.message}` : ""}`;
  const size = formatBytes(Number(row.length ?? 0));
  const digest = row.sha256 ? ` · ${row.sha256.slice(0, 12)}` : "";
  if (row.name_rewritten) return `${size}${digest} · ${t("renamed from {{name}}", { name: row.original_name ?? "" })}`;
  return `${size}${digest}`;
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
  const [uploadOutcome, setUploadOutcome] = useState<{ stagingDir?: string; rows: UploadFileRow[] } | undefined>(undefined);
  const [uploadError, setUploadError] = useState("");
  const uploadDisabled = uploading || planAction !== "IDLE" || planCheckBusy || !coreStorageReady || isUnavailable;

  useEffect(() => {
    if (!pendingFiles?.length) return;
    setMode("upload");
    void handleUpload(pendingFiles);
    onPendingFilesConsumed?.();
  }, [pendingFiles]);

  useEffect(() => { if (recheckSourceRef) setMode("path"); }, [recheckSourceRef]);

  async function handleUpload(fileList: FileList | File[] | null) {
    if (!fileList || fileList.length === 0 || uploadDisabled) return;
    setUploading(true);
    setUploadError("");
    try {
      const outcome = await uploadFiles(Array.from(fileList));
      setUploadOutcome({ stagingDir: outcome.staging_dir, rows: outcome.files ?? [] });
      if (outcome.reason) {
        setUploadError(outcome.message || outcome.reason);
      } else {
        onStaged?.();
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t("Could not upload files."));
    } finally {
      setUploading(false);
    }
  }

  // The handoff into the ordinary review → apply flow: the staging directory
  // becomes the prefilled root of the existing plan.ingest drawer state and
  // the standard preview runs. Nothing auto-ingests; the operator still
  // reviews the plan card and confirms the digest-bound save.
  function handoffToIngest() {
    const directory = uploadOutcome?.stagingDir?.trim();
    if (!directory) return;
    setUploadOutcome(undefined);
    setUploadError("");
    setMode("path");
    sources.changeSourceInput(directory);
    void sources.runIngestPlan(directory);
  }

  const uploadStagedCount = uploadOutcome?.rows.filter((row) => !row.skipped_reason).length ?? 0;

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    const directory = Array.from(event.dataTransfer.items).some((item) => {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null }).webkitGetAsEntry?.();
      return entry?.isDirectory === true;
    });
    if (directory) { setUploadError(t("Folder drops are not supported. Choose individual files or use a server folder.")); return; }
    if (isUnavailable) { setUploadError(t("Start the RestoreWeave service before previewing this source.")); return; }
    if (!coreStorageReady) { setUploadError(coreStorageMessage); return; }
    if (uploading || planAction !== "IDLE" || planCheckBusy) { setUploadError(t("Finish the current source operation before uploading files.")); return; }
    if (event.dataTransfer.files.length) { setMode("upload"); void handleUpload(event.dataTransfer.files); }
  }

  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="drawer source-drawer" role="dialog" aria-modal="true" aria-label={t(recheckSourceRef ? "Recheck source" : mode === "upload" ? "Upload files" : "Add source")}><div className="source-drawer-scroll"><div className="drawer-header"><div><p className="eyebrow">{t(recheckSourceRef ? "RECHECK SOURCE" : mode === "upload" ? "UPLOAD" : "NEW SOURCE")}</p><h2>{t(recheckSourceRef ? "Recheck source" : mode === "upload" ? "Upload files" : "Add source")}</h2></div><button className="icon-button" aria-label={t("Close add source")} onClick={onClose}><X size={17} /></button></div><p className="drawer-copy">{t(recheckSourceRef ? "Inspect this source again. Review the changes, then confirm to publish a new snapshot." : mode === "upload" ? "Choose files, review the storage plan, then confirm to save them." : "Choose a server folder and preview its exact storage plan. Saving starts only after you confirm.")}</p>{isUnavailable ? <div className="drawer-inline-warning" role="alert"><AlertCircle size={15} />{t("Start the RestoreWeave service before previewing this source.")}</div> : !coreStorageReady ? <div className="drawer-inline-warning" role="alert"><AlertCircle size={15} />{coreStorageMessage}</div> : notice && <div className={`notice drawer-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.kind === "error" ? <AlertCircle size={16} /> : notice.kind === "warning" ? <Sparkles size={16} /> : <Check size={16} />}{notice.text}</div>}
    {!recheckSourceRef && <div className="source-mode-switch" role="tablist" aria-label={t("How to add content")}>
      <button type="button" role="tab" aria-selected={mode === "path"} className={`source-mode ${mode === "path" ? "active" : ""}`} onClick={() => setMode("path")} disabled={uploading}><Server size={16} /><span>{t("Server folder")}</span></button>
      <button type="button" role="tab" aria-selected={mode === "upload"} className={`source-mode ${mode === "upload" ? "active" : ""}`} onClick={() => setMode("upload")} disabled={uploading}><Upload size={16} /><span>{t("Upload files")}</span></button>
    </div>}
    {mode === "path" ? <>
      <div className="source-kind"><span className="source-kind-icon"><HardDrive size={19} /></span><div><strong>{t("Server folder")}</strong><small>{t("Local disk or mounted storage visible to RestoreWeave")}</small></div><em>{t("Supported now")}</em></div><div className="source-route" aria-label={t("Source storage route")}><div><span>{t("Read from")}</span><strong title={source.trim()}>{source.trim() || t("Enter a server path")}</strong><small>{t("Source files stay in place")}</small></div><ChevronRight size={17} /><div><span>{t("Store unique bytes in")}</span><strong title={repositoryPath}>{repositoryPath}</strong><small>{t("Exact whole-file deduplication")}</small></div></div><form className="stack-form" id={sourceFormID} onSubmit={sources.makePlan}><label>{t("Path on RestoreWeave host")}<input autoFocus value={source} onChange={(event) => { sources.changeSourceInput(event.target.value); }} disabled={planAction === "INSPECTING" || planAction === "PROTECTING" || planCheckBusy} placeholder={t("/data/to-add")} aria-invalid={sourceLooksRemote || undefined} /><small className="path-helper"><Server size={13} />{t("Use a local or mounted server path. This browser does not fetch URLs.")}</small>{sourceLooksRemote && <small className="source-inline-error"><AlertCircle size={13} />{t("Enter a server path, not a URL.")}</small>}</label>{pathSuggestions.length > 0 && <div className="source-suggestions" role="group" aria-label={t("Suggested source paths")}><span className="source-suggestions-label">{t("Recent and configured paths")}</span><div className="source-suggestions-list">{pathSuggestions.map((suggestion) => <button type="button" key={suggestion.key} className="source-suggestion" data-kind={suggestion.kind} title={suggestion.path} aria-label={t(suggestion.kind === "source" ? "Recheck {{path}}" : "Use recent path {{path}}", { path: suggestion.path })} disabled={sourceSuggestionDisabled} onClick={() => sources.pickSuggestedPath(suggestion)}><RefreshCw size={12} /><span>{suggestion.path}</span></button>)}</div></div>}</form><p className="planning-note">{t("Planning records the source and plan in the catalog, but does not write file bytes or publish a snapshot until you confirm.")}</p>{plan && <PlanCard plan={plan} busy={planAction === "PROTECTING"} checking={planCheckBusy} coreStorageReady={coreStorageReady} t={t} onCheck={() => void sources.checkPlanStatus()} />}
    </> : <>
      <div className="source-kind"><span className="source-kind-icon"><Upload size={19} /></span><div><strong>{t("Upload files")}</strong><small>{t("Files are staged first for review")}</small></div><em>{t("Supported now")}</em></div>
      <div className="upload-zone" onDragOver={(event) => { event.preventDefault(); }} onDrop={handleDrop}>
        <label className="upload-picker">
          <FolderOpen size={17} />
          <span>{uploading ? t("Uploading…") : t("Choose files to upload")}</span>
          <small>{t("Files are staged first. Review before saving.")} {t("Drop files here or choose them.")}</small>
          <input type="file" multiple autoFocus disabled={uploadDisabled} onChange={(event) => { void handleUpload(event.target.files); event.target.value = ""; }} />
        </label>
        {uploadError && <div className="notice error upload-error" role="alert"><AlertCircle size={15} />{uploadError}</div>}
        {uploadOutcome && <div className="upload-rows" data-staged={uploadStagedCount}>
          {uploadOutcome.rows.map((row, index) => <div className={`upload-row ${row.skipped_reason ? "failed" : "staged"}`} key={`${row.original_name ?? "row"}:${index}`}>
            {row.skipped_reason ? <AlertCircle size={14} /> : <Check size={14} />}
            <div><strong title={uploadRowLabel(row, t)}>{uploadRowLabel(row, t)}</strong><small>{uploadRowDetail(row, t)}</small></div>
          </div>)}
        </div>}
        {uploadOutcome && uploadStagedCount > 0 && uploadOutcome.stagingDir && <div className="upload-handoff">
          <p className="planning-note">{t("{{count}} file(s) are staged with no protection record yet. Review the storage plan to protect them.", { count: uploadStagedCount })}</p>
          <button type="button" className="primary-button" onClick={handoffToIngest} disabled={uploadDisabled}><RefreshCw size={15} />{t("Review staged files")}</button>
        </div>}
      </div>
      <p className="planning-note">{t("Files stay in temporary staging until you review and confirm the storage plan.")}</p>
    </>}
  </div>{mode === "path" && <DrawerActionBar state={sourceBarState} reason={sourceBarReason} groupLabel={t("Source action")} previewLabel={t("Preview storage plan")} previewBusyLabel={t("Inspecting...")} previewBusy={planAction === "INSPECTING"} previewDisabled={sourcePreviewDisabled} confirmLabel={sourceSaveLabel} confirmBusyLabel={t("Saving content...")} confirmBusy={planAction === "PROTECTING"} confirmDisabled={sourceSaveDisabled} doneLabel={t("View saved content")} formID={sourceFormID} t={t} onApply={() => void sources.applyPlan()} onDone={onDone} onClose={onClose} />}</aside></div>;
}
