import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, FormEvent } from "react";
import { AlertCircle, Check, ChevronRight, HardDrive, RefreshCw, Server, Sparkles, Upload, X } from "lucide-react";
import type { Translator } from "../i18n";
import { uploadFiles } from "../app/command";
import type { UploadProgress } from "../app/command";
import { inspectFolderUpload } from "../lib/uploadPaths";
import { DrawerActionBar } from "./DrawerActionBar";
import { PlanCard } from "./PlanCard";
import { formatBytes } from "../lib/format";
import type { SourcesFlow } from "../app/useSources";
import type { ActionFeedback, Notice, UploadFileRow } from "../lib/types";
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
const PASTED_TEXT_MAX_BYTES = 64 * 1024;

function validTextFilename(value: string): boolean {
  return value.length > 0
    && new TextEncoder().encode(value).byteLength <= 255
    && value.trim() === value
    && !/[\\/\u0000-\u001f\u007f-\u009f<>:"|?*\u200e-\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)
    && value !== "." && value !== ".."
    && /\.txt$/iu.test(value)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\.txt$/iu.test(value);
}

type UploadMode = "path" | "upload";

function uploadRowLabel(row: UploadFileRow, t: Translator) {
  if (row.skipped_reason) return row.original_name || t("Unnamed file");
  return row.stored_name || row.original_name || t("Unnamed file");
}

function isUploadFileRow(value: unknown): value is UploadFileRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  for (const field of ["original_name", "stored_name", "stored_path", "sha256", "skipped_reason", "message"]) {
    if (row[field] !== undefined && typeof row[field] !== "string") return false;
  }
  if (row.length !== undefined && typeof row.length !== "number" && typeof row.length !== "string") return false;
  return row.name_rewritten === undefined || typeof row.name_rewritten === "boolean";
}

export function SourceDrawer({ t, sources, isUnavailable, coreStorageReady, coreStorageMessage, notice, repositoryPath, workspaceID, busy, searchRebuildAvailable, onPrepareSearch, pendingFiles, initialTextComposerOpen = false, onPendingFilesConsumed, onStaged, onClose, onDone }: {
  t: Translator;
  sources: SourcesFlow;
  isUnavailable: boolean;
  coreStorageReady: boolean;
  coreStorageMessage: string;
  notice: Notice | undefined;
  repositoryPath: string;
  workspaceID: string;
  busy: boolean;
  searchRebuildAvailable: boolean;
  onPrepareSearch: (workspaceID: string, planID: string) => Promise<ActionFeedback>;
  pendingFiles?: File[];
  initialTextComposerOpen?: boolean;
  onPendingFilesConsumed?: () => void;
  /** Called after files landed in the staging inbox so the shell can refresh the staging projection. */
  onStaged?: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const { source, recheckSourceRef, plan, planAction, planCheckBusy, pathSuggestions, sourceBarState, sourceBarReason, sourceSaveLabel, sourcePreviewDisabled, sourceSaveDisabled, sourceSuggestionDisabled, sourceLooksRemote } = sources;
  const [mode, setMode] = useState<UploadMode>(sources.pastedTextDraft.locked ? "upload" : recheckSourceRef || source.trim() ? "path" : "upload");
  const [uploading, setUploading] = useState(false);
  const [uploadRows, setUploadRows] = useState<UploadFileRow[]>(sources.pastedTextDraft.rows);
  const [uploadStagingDir, setUploadStagingDir] = useState(sources.pastedTextDraft.stagingDir);
  const [uploadError, setUploadError] = useState(sources.pastedTextDraft.error);
  const [uploadPartial, setUploadPartial] = useState(sources.pastedTextDraft.partial);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | undefined>();
  const [transportReceiving, setTransportReceiving] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [textComposerOpen, setTextComposerOpen] = useState(sources.pastedTextDraft.locked || initialTextComposerOpen);
  const [textComposerError, setTextComposerError] = useState("");
  const [focusUploadPicker, setFocusUploadPicker] = useState(false);
  const [searchPreparation, setSearchPreparation] = useState<ActionFeedback>({ state: "IDLE" });
  const uploadPickerRef = useRef<HTMLInputElement>(null);
  const folderPickerRef = useRef<HTMLInputElement>(null);
  const pastedTextByteLength = useMemo(() => new TextEncoder().encode(sources.pastedTextDraft.text).byteLength, [sources.pastedTextDraft.text]);
  // The in-flight latch is a ref so two synchronous selections or a select and
  // a drop in the same tick cannot start two uploads.
  const uploadingRef = useRef(false);
  const uploadAttemptRef = useRef(0);
  const uploadControllerRef = useRef<AbortController | undefined>(undefined);
  const transportReceivingRef = useRef(false);
  const stoppedAttemptRef = useRef(0);
  // A late response after the panel closed must not start an invisible review.
  const mountedRef = useRef(true);
  const searchPreparationRequestRef = useRef(0);
  const searchPreparationInFlightRef = useRef(false);
  const searchPreparationWorkspaceRef = useRef(workspaceID);
  const searchPreparationPlanRef = useRef(String(plan?.plan_id ?? ""));
  searchPreparationWorkspaceRef.current = workspaceID;
  searchPreparationPlanRef.current = String(plan?.plan_id ?? "");

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    searchPreparationRequestRef.current += 1;
    searchPreparationInFlightRef.current = false;
    setSearchPreparation({ state: "IDLE" });
  }, [workspaceID, plan?.plan_id]);

  useEffect(() => {
    if (!pendingFiles?.length) return;
    setMode("upload");
    void handleUpload(pendingFiles);
    onPendingFilesConsumed?.();
  }, [pendingFiles]);

  useEffect(() => { if (recheckSourceRef) setMode("path"); }, [recheckSourceRef]);

  // A drawer reopened while a pasted-text upload was in flight starts with the
  // shared draft's old empty receipt. Reconcile its matching completed result
  // into this drawer without preparing a plan as a side effect.
  useEffect(() => {
    const draft = sources.pastedTextDraft;
    if (!draft.locked || draft.receiving) return;
    setUploadRows(draft.rows);
    setUploadStagingDir(draft.stagingDir);
    setUploadError(draft.error);
    setUploadPartial(draft.partial);
  }, [sources.pastedTextDraft.attemptID, sources.pastedTextDraft.receiving, sources.pastedTextDraft.rows, sources.pastedTextDraft.stagingDir, sources.pastedTextDraft.error, sources.pastedTextDraft.partial]);

  const acceptedRows = uploadRows.filter((row) => !row.skipped_reason);
  // The upload surface keeps the right-side sheet in path/recheck mode; only
  // the ordinary file-first Add is the centered modal.
  const uploadSurface = mode === "upload" && !recheckSourceRef;
  const surfaceBusy = uploading || sources.pastedTextDraft.receiving || planAction !== "IDLE" || planCheckBusy;
  // A prepared plan belongs to this upload only when it was prepared from this
  // exact staging directory. That derives from existing state and keeps a
  // stale server-path plan out of the upload surface.
  const stagedPlanActive = Boolean(uploadStagingDir) && source.trim() === uploadStagingDir && Boolean(plan);
  // Keep a request-scoped accepted batch attached to its explicit review
  // action. A new upload would replace these local receipt rows while leaving
  // the accepted bytes staged in a different server request directory.
  const acceptedBatchNeedsReview = Boolean(uploadStagingDir) && acceptedRows.length > 0 && !stagedPlanActive;
  useEffect(() => {
    if (!focusUploadPicker || stagedPlanActive) return;
    setFocusUploadPicker(false);
    uploadPickerRef.current?.focus();
  }, [focusUploadPicker, stagedPlanActive]);
  // The plan already lists the exact save scope. Keep upload refusals and
  // renamed files prominent without repeating every ordinary filename twice.
  const visibleUploadRows = stagedPlanActive ? uploadRows.filter((row) => row.skipped_reason || row.name_rewritten) : uploadRows;
  const uploadSaved = stagedPlanActive && plan?.state === "SUCCEEDED" && plan?.awaiting_confirmation !== true;
  const confirmedPlan = sources.planAction === "SUCCEEDED"
    && !sources.planCheckBusy
    && plan?.state === "SUCCEEDED"
    && plan?.awaiting_confirmation !== true
    && Boolean(workspaceID)
    && Boolean(plan?.plan_id);
  const confirmedSavedPlan = confirmedPlan && plan?.workspace_id === workspaceID;
  const uploadAwaiting = stagedPlanActive && (Boolean(plan?.awaiting_confirmation) || plan?.state === "UNKNOWN") && plan?.state !== "SUCCEEDED";
  const matchingPastedTextPlan = Boolean(sources.pastedTextDraft.planID && plan?.plan_id === sources.pastedTextDraft.planID);
  const pastedTextPlanPending = matchingPastedTextPlan && (
    planAction !== "IDLE" || planCheckBusy || Boolean(plan?.awaiting_confirmation) || plan?.state === "UNKNOWN"
    || (plan?.executable === true && Number(plan?.files ?? 0) > 0)
  );
  const clearTextDraftDisabled = surfaceBusy || pastedTextPlanPending;
  const uploadSelectionDisabled = surfaceBusy || stagedPlanActive || acceptedBatchNeedsReview || sources.pastedTextDraft.locked || !coreStorageReady || isUnavailable;
  // The explicit review/retry runs the ordinary plan.ingest again over the
  // existing staging directory. It is offered before any plan exists and after
  // a blocked or up-to-date plan, but never for a saved or awaiting result.
  const canReviewStaged = Boolean(uploadStagingDir) && acceptedRows.length > 0 && planAction === "IDLE" && !planCheckBusy && !uploading && !uploadSaved && !uploadAwaiting && !(stagedPlanActive && plan?.executable);

  function continueAdding() {
    const planID = String(plan?.plan_id ?? "");
    if (!uploadSaved || !uploadStagingDir || !sources.continueAfterSavedUpload(planID, uploadStagingDir)) return;
    setUploadRows([]);
    setUploadStagingDir("");
    setUploadError("");
    setUploadPartial(false);
    setDragActive(false);
    setTextComposerOpen(false);
    setTextComposerError("");
    if (uploadPickerRef.current) uploadPickerRef.current.value = "";
    setMode("upload");
    setFocusUploadPicker(true);
  }

  function uploadStatusText() {
    if (planAction === "INSPECTING") return t("Preparing the review…");
    if (planAction === "PROTECTING") return t("Saving content...");
    if (uploading || sources.pastedTextDraft.receiving) return t("Uploading…");
    if (uploadSaved) return t("Saved to the library.");
    if (uploadAwaiting) return t("Protection is not confirmed yet. Check the protection result below.");
    if (stagedPlanActive && plan && Number(plan.files ?? 0) <= 0 && plan.executable) return t("Already up to date. Nothing new to add from this source.");
    if (stagedPlanActive && plan && !plan.executable) return t("Cannot save this batch yet. Review the plan below.");
    if (acceptedRows.length > 0) return t("Received. These files are not saved yet.");
    return t("Choose files to start.");
  }

  async function prepareSavedSearch() {
    if (!confirmedSavedPlan || sources.planCheckBusy || searchPreparationInFlightRef.current || !workspaceID || !plan?.plan_id) return;
    const request = ++searchPreparationRequestRef.current;
    const requestedWorkspaceID = workspaceID;
    const requestedPlanID = plan.plan_id;
    searchPreparationInFlightRef.current = true;
    setSearchPreparation({ state: "RUNNING", message: t("Preparing search…") });
    try {
      const outcome = await onPrepareSearch(requestedWorkspaceID, requestedPlanID);
      if (!mountedRef.current
        || request !== searchPreparationRequestRef.current
        || searchPreparationWorkspaceRef.current !== requestedWorkspaceID
        || searchPreparationPlanRef.current !== requestedPlanID) return;
      setSearchPreparation(outcome);
    } catch (error) {
      if (!mountedRef.current
        || request !== searchPreparationRequestRef.current
        || searchPreparationWorkspaceRef.current !== requestedWorkspaceID
        || searchPreparationPlanRef.current !== requestedPlanID) return;
      setSearchPreparation({ state: "FAILED", message: error instanceof Error ? error.message : t("Search rebuild failed.") });
    } finally {
      if (request === searchPreparationRequestRef.current) searchPreparationInFlightRef.current = false;
    }
  }

  function stopUpload() {
    const controller = uploadControllerRef.current;
    const attemptID = uploadAttemptRef.current;
    if (!transportReceivingRef.current || !controller || controller.signal.aborted) return;
    stoppedAttemptRef.current = attemptID;
    setUploadError(t("Upload stopped. Server receipt was not confirmed. Temporary files may remain; no saving review was prepared."));
    setUploadPartial(true);
    controller.abort();
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
            : uploading || sources.pastedTextDraft.receiving ? "receiving" : acceptedRows.length > 0 ? "received" : "idle";

  function uploadRowStatus(row: UploadFileRow) {
    if (row.skipped_reason) return t("Not saved — refused");
    if (uploadSaved) return t("Saved");
    if (uploadAwaiting) return t("Result needs checking");
    return t("Received — not yet saved");
  }

  async function handleUpload(fileList: FileList | File[] | null, pastedText = false, pastedTextAttemptID?: number, preserveRelativePaths = false) {
    if (!fileList || fileList.length === 0) return;
    if (uploadingRef.current || uploadSelectionDisabled) return;
    const selectedFiles = Array.from(fileList);
    if (preserveRelativePaths) {
      const folderUpload = inspectFolderUpload(selectedFiles);
      if (!folderUpload.paths) {
        setUploadError(t(folderUpload.problem ?? "The browser did not provide a valid relative path for every selected file."));
        return;
      }
    }
    // Capture the selected batch before the async upload so the response can
    // be checked against it; a short or extra answer is not a complete report.
    const selectedCount = selectedFiles.length;
    const attemptID = ++uploadAttemptRef.current;
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    stoppedAttemptRef.current = 0;
    uploadingRef.current = true;
    transportReceivingRef.current = true;
    setTransportReceiving(true);
    setUploading(true);
    setUploadProgress(undefined);
    setUploadRows([]);
    setUploadStagingDir("");
    setUploadError("");
    setUploadPartial(false);
    let returnedRows: UploadFileRow[] | undefined;
    let returnedStagingDir = "";
    let receiptReceived = false;
    try {
      let outcome: Awaited<ReturnType<typeof uploadFiles>>;
      try {
        outcome = await uploadFiles(Array.from(fileList), {
          signal: controller.signal,
          preserveRelativePaths,
          onProgress: (progress) => {
            if (mountedRef.current && attemptID === uploadAttemptRef.current && stoppedAttemptRef.current !== attemptID) setUploadProgress(progress);
          },
        });
      } catch {
        if (attemptID !== uploadAttemptRef.current) return;
        transportReceivingRef.current = false;
        if (mountedRef.current) setTransportReceiving(false);
        const unresolvedMessage = stoppedAttemptRef.current === attemptID
          ? t("Upload stopped. Server receipt was not confirmed. Temporary files may remain; no saving review was prepared.")
          : t("The connection ended before the server receipt was confirmed. Temporary files may remain; no saving review was prepared.");
        if (pastedText && pastedTextAttemptID !== undefined) sources.recordPastedTextUpload({ attemptID: pastedTextAttemptID, stagingDir: "", rows: [], error: unresolvedMessage, partial: true });
        if (mountedRef.current) {
          setUploadError(unresolvedMessage);
          setUploadPartial(true);
        }
        onStaged?.();
        return;
      }
      receiptReceived = true;
      returnedRows = [];
      returnedStagingDir = "";
      transportReceivingRef.current = false;
      if (attemptID === uploadAttemptRef.current && mountedRef.current) setTransportReceiving(false);
      const outcomeValue: unknown = outcome;
      const outcomeRecord = outcomeValue !== null && typeof outcomeValue === "object" && !Array.isArray(outcomeValue)
        ? outcomeValue as Record<string, unknown>
        : undefined;
      const rawRows = outcomeRecord?.files;
      const malformedRows = rawRows !== undefined && (!Array.isArray(rawRows) || !rawRows.every(isUploadFileRow));
      const malformedDirectory = outcomeRecord?.staging_dir !== undefined && typeof outcomeRecord.staging_dir !== "string";
      const malformedMetadata = ["reason", "message"].some((field) => outcomeRecord?.[field] !== undefined && typeof outcomeRecord[field] !== "string");
      const malformedOutcome = !outcomeRecord || malformedRows || malformedDirectory || malformedMetadata;
      const rows = Array.isArray(rawRows)
        ? rawRows.filter(isUploadFileRow)
        : [];
      returnedRows = rows;
      const directory = typeof outcomeRecord?.staging_dir === "string" ? outcomeRecord.staging_dir.trim() : "";
      returnedStagingDir = directory;
      const accepted = rows.filter((row) => !row.skipped_reason);
      if (attemptID === uploadAttemptRef.current && mountedRef.current) {
        setUploadRows(rows);
        setUploadStagingDir(directory);
      }
      const unknownEmpty = !malformedOutcome && rows.length === 0;
      const countMismatch = rows.length !== selectedCount;
      // A normal daemon echo carries an exact SHA-256 and length for every
      // accepted row. Missing or malformed identity is unresolved, never
      // silently treated as a complete batch.
      const identityComplete = accepted.every((row) =>
        /^[0-9a-f]{64}$/i.test(row.sha256 ?? "")
        && row.length !== undefined && row.length !== null && String(row.length).trim() !== ""
        && Number.isSafeInteger(Number(row.length))
        && Number(row.length) >= 0);
      const outcomeReason = typeof outcomeRecord?.reason === "string" ? outcomeRecord.reason : "";
      const outcomeMessage = typeof outcomeRecord?.message === "string" ? outcomeRecord.message : "";
      const partial = malformedOutcome || Boolean(outcomeReason) || unknownEmpty || countMismatch || accepted.length !== rows.length || !identityComplete || (accepted.length > 0 && !directory);
      let errorMessage = malformedOutcome
        ? t("The server response did not contain valid file results. No review was prepared.")
        : outcomeReason ? (outcomeMessage || outcomeReason) : "";
      if (!errorMessage && unknownEmpty) errorMessage = t("The server returned no file results for this upload, so the result is unknown. Nothing was prepared.");
      else if (!errorMessage && countMismatch) errorMessage = t("The server reported a different number of files than were selected, so the result is incomplete. Nothing was prepared.");
      else if (!errorMessage && accepted.length > 0 && !identityComplete) errorMessage = t("The server did not report a complete identity for every accepted file, so no review was prepared.");
      const partialAccepted = partial && accepted.length > 0;
      if (attemptID !== uploadAttemptRef.current) return;
      if (stoppedAttemptRef.current === attemptID) {
        const stoppedMessage = t("Stop arrived after the server responded. No saving review was prepared.");
        if (pastedText && pastedTextAttemptID !== undefined) sources.recordPastedTextUpload({ attemptID: pastedTextAttemptID, stagingDir: directory, rows, error: stoppedMessage, partial: true });
        if (mountedRef.current) {
          setUploadRows(rows);
          setUploadStagingDir(directory);
          setUploadError(stoppedMessage);
          setUploadPartial(true);
        }
        onStaged?.();
        return;
      }
      if (pastedText && pastedTextAttemptID !== undefined) sources.recordPastedTextUpload({ attemptID: pastedTextAttemptID, stagingDir: directory, rows, error: errorMessage, partial: partialAccepted });
      // Accepted bytes really did land in the daemon inbox. Late outcomes and
      // partial reports still refresh staging immediately, but a complete
      // mounted batch must finish its ordinary read-only plan first: a cold
      // refresh with no restore point or recent plan can otherwise clear that
      // newly returned plan from the shared source projection.
      if (!mountedRef.current) {
        if (accepted.length > 0) onStaged?.();
        return;
      }
      setUploadRows(rows);
      setUploadStagingDir(directory);
      setUploadError(errorMessage);
      setUploadPartial(partialAccepted);
      // Only a fully reported batch with a staging directory is prepared
      // automatically. A partial subset always needs the explicit action.
      if (!partial && accepted.length > 0 && directory) {
        sources.changeSourceInput(directory);
        try {
          await sources.runIngestPlan(directory, pastedText);
        } finally {
          onStaged?.();
        }
      } else if (accepted.length > 0) {
        onStaged?.();
      }
    } catch {
      if (attemptID === uploadAttemptRef.current && receiptReceived) {
        const followupError = t("An upload follow-up step failed. The returned file results are retained; check them before continuing.");
        if (pastedText && pastedTextAttemptID !== undefined && returnedRows) {
          sources.recordPastedTextUpload({ attemptID: pastedTextAttemptID, stagingDir: returnedStagingDir, rows: returnedRows, error: followupError, partial: true });
        }
        if (mountedRef.current) {
          if (returnedRows) setUploadRows(returnedRows);
          setUploadStagingDir(returnedStagingDir);
          setUploadError(followupError);
          setUploadPartial(true);
        }
      }
    } finally {
      if (attemptID === uploadAttemptRef.current) {
        uploadingRef.current = false;
        uploadControllerRef.current = undefined;
        transportReceivingRef.current = false;
        stoppedAttemptRef.current = 0;
        if (mountedRef.current) {
          setUploading(false);
          setTransportReceiving(false);
        }
      }
    }
  }

  // Retry the review of the existing staged directory without a second upload.
  // `changeSourceInput` drops the stale plan/source pair the same way an edited
  // path does, then the ordinary plan.ingest runs.
  function prepareStaged(directory: string) {
    if (!directory) return;
    sources.changeSourceInput(directory);
    void sources.runIngestPlan(directory, sources.pastedTextDraft.locked);
  }

  function submitPastedText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sources.pastedTextDraft.locked || uploadSelectionDisabled) return;
    const byteLength = new TextEncoder().encode(sources.pastedTextDraft.text).byteLength;
    if (!validTextFilename(sources.pastedTextDraft.filename)) {
      if (new TextEncoder().encode(sources.pastedTextDraft.filename).byteLength > 255) {
        setTextComposerError(t("Filename must be at most 255 UTF-8 bytes."));
        return;
      }
      setTextComposerError(t("Use a safe single filename ending in .txt."));
      return;
    }
    if (sources.pastedTextDraft.text.length === 0) {
      setTextComposerError(t("Enter some text before preparing this file."));
      return;
    }
    if (byteLength > PASTED_TEXT_MAX_BYTES) {
      setTextComposerError(t("This text is {{size}} bytes; the limit is 64 KiB.", { size: byteLength }));
      return;
    }
    setTextComposerError("");
    setTextComposerOpen(true);
    const attemptID = sources.beginPastedTextUpload();
    const file = new File([sources.pastedTextDraft.text], sources.pastedTextDraft.filename, { type: "text/plain;charset=utf-8" });
    void handleUpload([file], true, attemptID);
  }

  function clearTextDraft() {
    const clearingPastedTextUpload = sources.pastedTextDraft.locked;
    if (clearingPastedTextUpload) sources.changeSourceInput("");
    sources.clearPastedTextDraft();
    if (clearingPastedTextUpload) {
      setUploadRows([]);
      setUploadStagingDir("");
      setUploadError("");
      setUploadPartial(false);
    }
    setTextComposerError("");
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
    if (directory) { setUploadError(t("Folder drag-and-drop is not supported. Choose a folder to upload its files, or use a server folder.")); return; }
    if (isUnavailable) { setUploadError(t("Start the Cairn service before previewing this source.")); return; }
    if (!coreStorageReady) { setUploadError(coreStorageMessage); return; }
    if (uploadingRef.current || uploadSelectionDisabled) {
      setUploadError(t(acceptedBatchNeedsReview ? "Review accepted files before starting another upload." : "Finish the current source operation before uploading files."));
      return;
    }
    if (event.dataTransfer.files.length) { setMode("upload"); void handleUpload(event.dataTransfer.files); }
  }

  function handlePasteFiles(event: ClipboardEvent<HTMLElement>) {
    // Literal text keeps its ordinary paste behavior in the text composer or
    // path fields. A copied image/file uses exactly the existing upload ->
    // review -> confirm flow and never saves merely because it was pasted.
    if (mode !== "upload" || !event.clipboardData.files.length) return;
    const target = event.target as HTMLElement;
    if (target.closest('textarea, input:not([type="file"]), [contenteditable="true"]')) return;
    event.preventDefault();
    event.stopPropagation();
    if (isUnavailable) { setUploadError(t("Start the Cairn service before previewing this source.")); return; }
    if (!coreStorageReady) { setUploadError(coreStorageMessage); return; }
    if (uploadingRef.current || uploadSelectionDisabled) {
      setUploadError(t(acceptedBatchNeedsReview ? "Review accepted files before starting another upload." : "Finish the current source operation before uploading files."));
      return;
    }
    void handleUpload(Array.from(event.clipboardData.files));
  }

  return <div className={`drawer-backdrop${uploadSurface ? " source-drawer-backdrop" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className={`drawer source-drawer${uploadSurface ? " source-drawer--upload" : ""}`} role="dialog" aria-modal="true" onPaste={handlePasteFiles} aria-label={t(recheckSourceRef ? "Recheck source" : mode === "upload" ? "Upload files" : "Add source")}>
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
                <small>{t("You can also paste a copied image or file here.")}</small>
                <input ref={uploadPickerRef} type="file" multiple autoFocus disabled={uploadSelectionDisabled} onChange={(event) => { void handleUpload(event.target.files); event.target.value = ""; }} />
              </label>
              <div className="upload-folder-picker">
                <button type="button" className="secondary-button" disabled={uploadSelectionDisabled} onClick={() => folderPickerRef.current?.click()}>{t("Choose folder to upload")}</button>
                <small>{t("Folder files keep their relative paths. Empty folders are not uploaded; review the received paths before saving.")}</small>
                <input ref={(node) => {
                  folderPickerRef.current = node;
                  node?.setAttribute("webkitdirectory", "");
                }} type="file" multiple disabled={uploadSelectionDisabled} aria-label={t("Choose folder to upload")} onChange={(event) => { void handleUpload(event.target.files, false, undefined, true); event.target.value = ""; }} />
              </div>
            </div>
          </>}
          <section className="pasted-text-composer" aria-label={t("Create a text file")}>
            <button type="button" className="pasted-text-toggle" aria-expanded={textComposerOpen || sources.pastedTextDraft.locked} disabled={sources.pastedTextDraft.locked} onClick={() => setTextComposerOpen((open) => !open)}>
              <span>{t("Paste text into a .txt file")}</span><ChevronRight size={15} aria-hidden="true" />
            </button>
            {(textComposerOpen || sources.pastedTextDraft.locked) && <form className="pasted-text-form" onSubmit={submitPastedText}>
              <label>{t("Output filename")}
              <input value={sources.pastedTextDraft.filename} disabled={sources.pastedTextDraft.locked} maxLength={255} onChange={(event) => { sources.editPastedTextDraft(event.target.value, sources.pastedTextDraft.text); setTextComposerError(""); }} aria-invalid={!validTextFilename(sources.pastedTextDraft.filename) || undefined} />
              </label>
              <label>{t("Text to save")}
              <textarea data-drawer-initial-focus={initialTextComposerOpen && !sources.pastedTextDraft.locked ? "true" : undefined} value={sources.pastedTextDraft.text} disabled={sources.pastedTextDraft.locked} rows={6} aria-invalid={(sources.pastedTextDraft.text.length === 0 || pastedTextByteLength > PASTED_TEXT_MAX_BYTES) || undefined} onChange={(event) => { sources.editPastedTextDraft(sources.pastedTextDraft.filename, event.target.value); setTextComposerError(""); }} />
              </label>
              <small className="pasted-text-size">{t("The file will go through upload and plan review; it is not saved until you confirm.")}</small>
              <small className="pasted-text-size">{t("UTF-8 size: {{size}} bytes (64 KiB maximum).", { size: pastedTextByteLength })}</small>
              {textComposerError && <small className="pasted-text-error" role="alert">{textComposerError}</small>}
              <div className="pasted-text-actions">
                {!sources.pastedTextDraft.locked && <button type="submit" className="secondary-button" disabled={uploadSelectionDisabled}><Upload size={14} />{t("Prepare text file")}</button>}
                <button type="button" className="pasted-text-clear" disabled={clearTextDraftDisabled} onClick={clearTextDraft}>{t("Clear text draft")}</button>
              </div>
              {sources.pastedTextDraft.locked && !sources.pastedTextDraft.planID && sources.pastedTextDraft.stagingDir && acceptedRows.length > 0 && <small className="pasted-text-warning" role="status">{t("This file remains staged and unprotected. Clearing the draft will not remove it; review it from the staged-files area.")}</small>}
              {pastedTextPlanPending && <small className="pasted-text-warning" role="status">{t("Resolve this file's current protection plan before clearing its draft.")}</small>}
              {sources.pastedTextDraft.locked && sources.pastedTextDraft.stagingDir && !sources.pastedTextDraft.planID && !stagedPlanActive && acceptedRows.length > 0 && <button type="button" className="secondary-button pasted-text-review" disabled={surfaceBusy || isUnavailable || !coreStorageReady} onClick={() => prepareStaged(sources.pastedTextDraft.stagingDir)}><RefreshCw size={14} />{t("Review staged text file")}</button>}
            </form>}
          </section>
          {uploadPhase !== "idle" && uploadPhase !== "confirm" && <div className="upload-status" data-phase={uploadPhase} role="status">
            {uploadPhase === "saved" || uploadPhase === "uptodate" ? <Check size={15} />
              : uploadPhase === "blocked" || uploadPhase === "unknown" ? <AlertCircle size={15} />
                : uploadPhase === "preparing" || uploadPhase === "saving" || uploadPhase === "receiving" ? <RefreshCw size={15} className="spin" />
                  : <Upload size={15} />}
            {uploadStatusText()}
          </div>}
          {uploadError && <div className="notice error upload-error" role="alert"><AlertCircle size={15} />{uploadError}</div>}
          {transportReceiving && uploadProgress && <div className="upload-transfer-progress" role="status">
            <span>{uploadProgress.total !== undefined
              ? t("Sent {{loaded}} of {{total}} bytes (multipart framing included).", { loaded: uploadProgress.loaded, total: uploadProgress.total })
              : t("Sent {{loaded}} bytes (multipart framing included).", { loaded: uploadProgress.loaded })}</span>
            {uploadProgress.total !== undefined && uploadProgress.total > 0 && <progress max={uploadProgress.total} value={Math.min(uploadProgress.loaded, uploadProgress.total)} aria-label={t("Upload progress (includes multipart framing)")} />}
          </div>}
          {transportReceiving && <button type="button" className="upload-stop-button" onClick={stopUpload}>{t("Stop upload")}</button>}
          {uploadPartial && !uploadError && <div className="notice warning upload-partial" role="status"><AlertCircle size={15} />{uploadStagingDir ? t("Some files were not accepted. Each one is listed below with the server's answer.") : t("The server did not report a staging folder for this upload, so no review was prepared.")}</div>}
          {acceptedBatchNeedsReview && <p className="planning-note">{t("Review accepted files before starting another upload.")}</p>}
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
          {uploadSaved && <div className="upload-continuation">
            <button
              type="button"
              className="secondary-button"
              disabled={planAction !== "SUCCEEDED" || planCheckBusy || uploading || sources.pastedTextDraft.receiving}
              onClick={continueAdding}
            >{t("Continue adding")}</button>
          </div>}
          {canReviewStaged && <div className="upload-handoff">
            <button type="button" className="secondary-button" onClick={() => prepareStaged(uploadStagingDir)}><RefreshCw size={15} />{!stagedPlanActive && uploadPartial ? t("Review accepted files") : t("Preview storage plan")}</button>
          </div>}
          {!uploadSaved && !uploadAwaiting && <p className="planning-note">{t("Received files stay temporary until you confirm saving originals.")}</p>}
          {!stagedPlanActive && <button type="button" className="upload-server-entry" disabled={surfaceBusy || sources.pastedTextDraft.locked} onClick={() => setMode("path")}><Server size={15} />{t("Server folder")}</button>}
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
      {confirmedPlan && <div className="source-search-preparation">
        <strong>{t("Prepare search for saved content")}</strong>
        <p className="planning-note">{t("Update search for the current library, including this saved batch. This does not change the saved originals.")}</p>
        <button type="button" className="secondary-button" disabled={!confirmedSavedPlan || !searchRebuildAvailable || searchPreparation.state === "RUNNING" || uploading || sources.pastedTextDraft.receiving || planCheckBusy || busy} onClick={() => void prepareSavedSearch()}>
          <RefreshCw size={15} className={searchPreparation.state === "RUNNING" ? "spin" : ""} />
          {t(searchPreparation.state === "RUNNING" ? "Preparing search…" : "Prepare search")}
        </button>
        {!searchRebuildAvailable && <small role="status">{t("Search rebuild is unavailable in this build.")}</small>}
        {confirmedPlan && !confirmedSavedPlan && <small role="status">{t("The saved source is not in the current workspace.")}</small>}
        {searchPreparation.state !== "IDLE" && <div className={`notice ${searchPreparation.state === "FAILED" ? "error" : searchPreparation.state === "DEGRADED" ? "warning" : ""}`} role={searchPreparation.state === "FAILED" ? "alert" : "status"}>
          {searchPreparation.state === "RUNNING" ? <RefreshCw size={15} className="spin" /> : searchPreparation.state === "FAILED" || searchPreparation.state === "DEGRADED" ? <AlertCircle size={15} /> : <Check size={15} />}
          {searchPreparation.message || t(searchPreparation.state === "RUNNING" ? "Preparing search…" : "Search preparation completed.")}
        </div>}
      </div>}
      {mode === "path" && <DrawerActionBar state={sourceBarState} reason={sourceBarReason} groupLabel={t("Source action")} previewLabel={t("Preview storage plan")} previewBusyLabel={t("Inspecting...")} previewBusy={planAction === "INSPECTING"} previewDisabled={sourcePreviewDisabled} confirmLabel={sourceSaveLabel} confirmBusyLabel={t("Saving content...")} confirmBusy={planAction === "PROTECTING"} confirmDisabled={sourceSaveDisabled} doneLabel={sourceBarState === "UP_TO_DATE" ? t("All content") : t("View saved source")} formID={sourceFormID} t={t} onApply={() => void sources.applyPlan()} onDone={onDone} onClose={onClose} />}
      {mode !== "path" && stagedPlanActive && <DrawerActionBar state={sourceBarState} reason={sourceBarReason} groupLabel={t("Source action")} previewLabel={t("Preview storage plan")} previewBusyLabel={t("Inspecting...")} previewBusy={planAction === "INSPECTING"} previewDisabled={sourcePreviewDisabled} confirmLabel={sourceSaveLabel} confirmBusyLabel={t("Saving content...")} confirmBusy={planAction === "PROTECTING"} confirmDisabled={sourceSaveDisabled} doneLabel={sourceBarState === "UP_TO_DATE" ? t("All content") : t("View saved source")} formID={sourceFormID} t={t} onApply={() => void sources.applyPlan()} onDone={onDone} onClose={onClose} />}
    </aside>
  </div>;
}
