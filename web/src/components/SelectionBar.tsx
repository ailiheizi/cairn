import { useEffect, useRef, useState } from "react";
import { Check, Download as DownloadIcon, FileText, Image as ImageIcon, LoaderCircle, Tag, X, Archive } from "lucide-react";
import type { Locale, Translator } from "../i18n";
import { command } from "../app/command";
import { operations } from "../lib/operations";
import { PROTECTION_OUTCOMES, projectProtectionAxis } from "../lib/protectionAxis";
import { downloadOriginal } from "../lib/contentDownload";
import { descriptionKindLabel, formatBytes } from "../lib/format";
import { buildSelectionReport, selectionReportFilename } from "../lib/report";
import type { ReportFact, ReportNote, ReportRepresentation, ReportSubject } from "../lib/report";
import type { SearchHit, ViewMode } from "../lib/types";
import type { SelectionTagMutationProgress } from "../app/useSelection";
import "./SelectionBar.css";

// The selection bar is the only batch surface: it reports the honest count and
// drives export, tag, and selection-report actions over exactly the selected
// subjects.
//
// The selection report is one Markdown document assembled in this browser from
// reads the daemon already answers: the loaded listing (`content.list` or
// `search.query`), then `annotation.list`, `description.list`/`description.get`,
// and `representation.list` per selected subject, plus one protection-axis read
// (`search.query` with `protection_mode`) for the whole selection. It writes no
// durable state, uploads nothing, and calls no other operation. Every fact it
// could not read stays visible as UNKNOWN with the daemon's reason; a subject
// whose reads failed or were skipped by the report cap still appears with its
// provenance path.

/** One subject's note as the report renders it. */
type AnnotationNote = { kind?: string; body?: string; revision?: number; updated_at?: string };

type AnnotationRead =
  | { state: "READ"; tags: string[]; notes: AnnotationNote[] }
  | { state: "UNKNOWN"; reason: string };

type DescriptionRead =
  | { state: "READ"; notes: ReportNote[]; reason: string }
  | { state: "UNKNOWN"; reason: string };

function summarizeSelectedSubjects(subjects: SearchHit[]) {
  const seen = new Set<string>();
  let files = 0;
  let folders = 0;
  let other = 0;
  let unknownFileSizes = 0;
  let knownFileBytes = 0;
  let byteTotalOverflow = false;
  for (const subject of subjects) {
    const subjectRef = subject.subject_ref?.trim() ?? "";
    if (!subjectRef || seen.has(subjectRef)) continue;
    seen.add(subjectRef);
    if (subject.entry_type === "DIRECTORY") {
      folders += 1;
    } else if (subject.entry_type === "REGULAR_FILE") {
      files += 1;
      const size = subject.logical_size;
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
        unknownFileSizes += 1;
      } else if (!byteTotalOverflow) {
        if (knownFileBytes > Number.MAX_SAFE_INTEGER - size) byteTotalOverflow = true;
        else knownFileBytes += size;
      }
    } else {
      other += 1;
    }
  }
  return { files, folders, other, unknownFileSizes, knownFileBytes, byteTotalOverflow };
}

/** One `description.get` answer: the document, or why the body was not read. */
type BodyRead = { document?: any; reason?: string };

/** The filename suffixes the daemon's image dimension admits, mirroring search.ImageMediaTypeForName. */
const IMAGE_QUERY_SUFFIXES = [".jpg", ".jpeg", ".png"] as const;

/**
 * The single selected subject the "search by this image" action may use: the
 * daemon admits jpeg/png images by recorded suffix only, and the action is
 * offered for exactly one selected file. Suffix evidence names the action, not
 * the bytes; the daemon re-checks identity and decodability itself.
 */
function imageSearchSubject(subjects: SearchHit[]): string {
  if (subjects.length !== 1) return "";
  const only = subjects[0];
  const name = only.name?.trim().toLowerCase() ?? "";
  if (!only.subject_ref?.trim() || !IMAGE_QUERY_SUFFIXES.some((suffix) => name.endsWith(suffix))) return "";
  return only.subject_ref.trim();
}

/** How many selected subjects one report reads stored facts for. */
export const REPORT_SUBJECT_CAP = 200;
/** Bounded concurrency for the per-subject reads. */
const REPORT_SUBJECT_CONCURRENCY = 3;
/** Bounded concurrency for the notes-body hydration of one subject. */
const DESCRIPTION_CONCURRENCY = 4;
/** The retained note history one report asks for per subject. */
const DESCRIPTION_HISTORY_LIMIT = 1000;

function messageOf(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason ?? "");
}

/** Runs `worker` over `items` with at most `limit` reads in flight. */
async function mapLimited<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// A blob download: the document never touches the daemon. The object URL is
// revoked after the browser has started reading it.
function downloadMarkdown(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function SelectionBar({ count, subjects, unresolvedCount = 0, workspaceID, locale, viewMode, query, tagDraft, tagActionsReady, tagActionsUnavailableMessage, tagMatchCount, favoriteMatchCount, busy, originalTakeoutBusy = false, t, onSelectAll, onInvertSelection, onExport, onDownloadOriginals, onTagDraft, onApplyTag, onRemoveTag, onAddFavorite, onRemoveFavorite, onClear, onImageSearch, onCreateMaterialList, materialListCreationDisabled = false, tagQueue, tagQueueDraft, onTagQueueDraft, onAddQueuedTag, onRemoveQueuedTag, onClearQueuedTags, onApplyQueuedTags, tagMutationProgress, onStopTagMutation, onRefreshTagState }: {
  count: number;
  subjects: SearchHit[];
  unresolvedCount?: number;
  workspaceID: string;
  locale: Locale;
  viewMode: ViewMode;
  query: string;
  tagDraft: string;
  tagActionsReady: boolean;
  tagActionsUnavailableMessage: string;
  tagMatchCount: (tag: string) => number;
  favoriteMatchCount: number;
  busy: boolean;
  originalTakeoutBusy?: boolean;
  t: Translator;
  onSelectAll?: () => void;
  onInvertSelection?: () => void;
  onExport: (trigger?: EventTarget | null) => void;
  onDownloadOriginals?: (subjects: SearchHit[]) => void;
  onTagDraft: (value: string) => void;
  onApplyTag: () => void;
  onRemoveTag: () => void;
  onAddFavorite: () => void;
  onRemoveFavorite: () => void;
  onClear: () => void;
  /** Opens the client composer for the exact selected regular files. */
  onCreateMaterialList?: (subjects: SearchHit[]) => void;
  materialListCreationDisabled?: boolean;
  /** Pending multi-tag edits; they affect selection only after explicit apply. */
  tagQueue?: string[];
  tagQueueDraft?: string;
  onTagQueueDraft?: (value: string) => void;
  onAddQueuedTag?: () => void;
  onRemoveQueuedTag?: (tag: string) => void;
  onClearQueuedTags?: () => void;
  onApplyQueuedTags?: () => void;
  tagMutationProgress?: SelectionTagMutationProgress | null;
  onStopTagMutation?: () => void;
  onRefreshTagState?: () => void;
  /** Offered when exactly one selected item is a daemon-admitted image: runs the image-dimension query. */
  onImageSearch?: (subjectRef: string) => void;
}) {
  const [reportState, setReportState] = useState<{ state: "IDLE" | "RUNNING" | "DONE" | "FAILED"; text: string }>({ state: "IDLE", text: "" });
  const reportToken = useRef(0);
  const [copyState, setCopyState] = useState<{ contextToken: number; operationToken: number; text: string }>({ contextToken: 0, operationToken: 0, text: "" });
  const copyContextRef = useRef({ signature: "", token: 0 });
  const copyOperationRef = useRef(0);
  const copyMountedRef = useRef(false);
  const orderedUniqueSubjects = (() => {
    const seen = new Set<string>();
    return subjects.filter((subject) => {
      const ref = subject.subject_ref?.trim() ?? "";
      if (!ref || seen.has(ref)) return false;
      seen.add(ref);
      return true;
    });
  })();
  const missingStableSubjectCount = subjects.filter((subject) => !subject.subject_ref?.trim()).length;
  // Feedback belongs to this exact ordered selection and workspace. Advancing
  // the token on every context transition also prevents an old message from
  // reappearing if the user later returns to the same selection.
  const copyContextSignature = JSON.stringify([
    workspaceID,
    count,
    subjects.map((subject) => [subject.subject_ref ?? null, subject.entry_id ?? null, subject.content_id ?? null, subject.logical_size ?? null, subject.entry_type ?? null, subject.name ?? null, subject.path ?? null]),
    unresolvedCount,
  ]);
  if (copyContextRef.current.signature !== copyContextSignature) {
    copyContextRef.current = { signature: copyContextSignature, token: copyContextRef.current.token + 1 };
  }
  useEffect(() => {
    copyMountedRef.current = true;
    return () => {
      copyMountedRef.current = false;
      copyOperationRef.current += 1;
    };
  }, []);
  const currentCopyToken = copyContextRef.current.token;
  const visibleCopyText = copyState.contextToken === currentCopyToken && copyState.operationToken === copyOperationRef.current ? copyState.text : "";
  const reportBusy = reportState.state === "RUNNING";
  const selectionMismatch = unresolvedCount > 0;
  const subjectSummary = summarizeSelectedSubjects(subjects);
  const missingFilenameCount = orderedUniqueSubjects.filter((subject) => !subject.name?.trim()).length;
  const missingSourcePathCount = orderedUniqueSubjects.filter((subject) => !subject.path?.trim()).length;
  const tagActionsDisabled = busy || selectionMismatch || !tagActionsReady || subjects.length === 0;
  const selectedOriginal = subjects.length === 1 && count === 1 && !selectionMismatch && workspaceID.trim()
    ? subjects[0]
    : undefined;
  const originalDownloadHit = selectedOriginal
    && selectedOriginal.entry_type === "REGULAR_FILE"
    && Boolean(selectedOriginal.subject_ref?.trim())
    && Boolean(selectedOriginal.entry_id?.trim())
    && /^sha256:[0-9a-f]{64}$/.test(selectedOriginal.content_id ?? "")
    ? selectedOriginal
    : undefined;
  const currentTagMatches = tagMatchCount(tagDraft);
  // The one selected admitted image, when the parent offers the action at all.
  const imageSubject = onImageSearch ? imageSearchSubject(subjects) : "";
  const tagProgressActive = tagMutationProgress?.phase === "running" || tagMutationProgress?.phase === "stopping";
  const tagProgressPhase = tagMutationProgress?.phase === "stopping" ? t("Stopping after the current read or write settles.")
    : tagMutationProgress?.phase === "complete" ? t("Tag changes completed.")
      : tagMutationProgress?.phase === "stopped" ? t("Stopped. Confirmed changes remain; pending tags were kept. Refresh tags before continuing.")
        : tagMutationProgress?.phase === "unknown" ? t("Stopped for reconciliation. Check the item status before continuing.")
          : tagMutationProgress?.phase === "paused" ? t("Paused after an incomplete or degraded result.")
            : t("Tag changes are running.");

  async function copySelectedList(kind: "filename" | "path") {
    const field = kind === "filename" ? "name" : "path";
    const missingCount = orderedUniqueSubjects.filter((subject) => !subject[field]?.trim()).length;
    if (busy || selectionMismatch || missingStableSubjectCount > 0 || orderedUniqueSubjects.length === 0 || missingCount > 0) return;
    const context = copyContextRef.current;
    const operationToken = ++copyOperationRef.current;
    setCopyState({ contextToken: context.token, operationToken, text: "" });
    const lines = orderedUniqueSubjects.map((subject) => JSON.stringify(subject[field]!));
    const successText = t(kind === "filename" ? "Copied filename list for {{count}} items." : "Copied source path list for {{count}} items.", { count: lines.length });
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(lines.join("\n"));
      if (copyMountedRef.current && copyOperationRef.current === operationToken && copyContextRef.current.token === context.token && copyContextRef.current.signature === context.signature) {
        setCopyState({ contextToken: context.token, operationToken, text: successText });
      }
    } catch {
      if (copyMountedRef.current && copyOperationRef.current === operationToken && copyContextRef.current.token === context.token && copyContextRef.current.signature === context.signature) {
        setCopyState({ contextToken: context.token, operationToken, text: t("Could not copy this list: clipboard access was unavailable or denied.") });
      }
    }
  }

  async function readAnnotations(workspace: string, subjectRef: string, issued: Set<string>): Promise<AnnotationRead> {
    issued.add("annotation.list");
    try {
      const response = await command(operations.annotation.list, { workspace_id: workspace, subject_ref: subjectRef });
      const records = Array.isArray(response.data?.annotations) ? response.data.annotations : [];
      // Only rows the daemon bound to this subject are attributed to it; a
      // foreign row is never folded into this subject's facts.
      const bound = records.filter((item: any) => typeof item?.subject_ref === "string" && item.subject_ref.trim() === subjectRef && !item.tombstoned);
      return {
        state: "READ",
        tags: bound.filter((item: any) => item.kind === "TAG").map((item: any) => String(item.body ?? "")).filter(Boolean),
        notes: bound.filter((item: any) => item.kind === "NOTE").map((item: any) => item as AnnotationNote),
      };
    } catch (error) {
      return { state: "UNKNOWN", reason: messageOf(error) };
    }
  }

  async function readDescriptions(workspace: string, subjectRef: string, issued: Set<string>): Promise<DescriptionRead> {
    issued.add("description.list");
    let summaries: any[] = [];
    const reasons: string[] = [];
    try {
      const response = await command(operations.description.list, { workspace_id: workspace, subject_ref: subjectRef, limit: DESCRIPTION_HISTORY_LIMIT });
      const documents = Array.isArray(response.data?.documents) ? response.data.documents : [];
      summaries = documents.filter((item: any) => typeof item?.subject_ref === "string" && item.subject_ref.trim() === subjectRef);
      if (response.data?.truncated === true) reasons.push(t("the daemon reported that this subject's note history is truncated; older revisions are not included here"));
    } catch (error) {
      return { state: "UNKNOWN", reason: messageOf(error) };
    }
    // A summary's body is a separate read; a body that could not be read stays
    // marked as unavailable instead of being rendered as an empty note.
    issued.add("description.get");
    const hydrated = await mapLimited<any, BodyRead>(summaries, DESCRIPTION_CONCURRENCY, async (summary) => {
      try {
        const response = await command(operations.description.get, { workspace_id: workspace, description_document_id: summary.description_document_id });
        const document = response.data?.document;
        if (document?.subject_ref?.trim() === subjectRef) return { document };
        return { reason: t("the daemon answered the note read for a different subject") };
      } catch (error) {
        return { reason: messageOf(error) };
      }
    });
    const superseded = new Set(summaries.map((item) => item.predecessor_id).filter(Boolean));
    // The single Notes view: one current revision per note source. The durable
    // revision chain stays in the catalog and is not rewritten here.
    const notes = summaries
      .map((summary, index) => ({ summary, index }))
      .filter(({ summary }) => !summary.tombstoned && !superseded.has(summary.description_document_id))
      .map(({ summary, index }) => {
        const read: BodyRead = hydrated[index] ?? {};
        const document = read.document;
        const bodyUnavailable = !document;
        const unavailableReason = read.reason ?? t("the note body was not read");
        if (bodyUnavailable && !reasons.includes(unavailableReason)) reasons.push(unavailableReason);
        const body = document?.body?.trim() ? document.body : document?.title?.trim() ? document.title : t("Note content unavailable");
        return {
          sourceLabel: descriptionKindLabel(summary.kind, t),
          body,
          bodyUnavailable,
          bodyUnavailableReason: bodyUnavailable ? unavailableReason : "",
          updatedAt: String(summary.updated_at ?? ""),
          revision: typeof summary.revision === "number" ? summary.revision : null,
          accepted: typeof summary.accepted === "boolean" ? summary.accepted : null,
        } satisfies ReportNote;
      });
    return { state: "READ", notes, reason: reasons.join("; ") };
  }

  async function readRepresentation(workspace: string, subjectRef: string, issued: Set<string>): Promise<ReportRepresentation> {
    issued.add("representation.list");
    try {
      const response = await command(operations.representation.list, { workspace_id: workspace, subject_ref: subjectRef });
      const answeredFor = response.data?.subject_ref;
      if (typeof answeredFor === "string" && answeredFor.trim() && answeredFor.trim() !== subjectRef) {
        return { state: "UNKNOWN", reason: t("the daemon answered the representation read for a different subject") };
      }
      return { state: "READ", rows: Array.isArray(response.data?.representations) ? response.data.representations : [] };
    } catch (error) {
      return { state: "UNKNOWN", reason: messageOf(error) };
    }
  }

  // One protection-axis read for the whole selection: the daemon's own
  // structured filter, asked once per admitted outcome. A subject is claimed
  // by the first outcome whose answer contains it; an unanswered axis leaves
  // every outcome UNKNOWN with the daemon's reason.
  async function readProtectionAxis(workspace: string, issued: Set<string>): Promise<{ bySubject: Map<string, string>; answered: boolean; reason: string }> {
    issued.add("search.query (protection axis)");
    const settled = await Promise.allSettled(PROTECTION_OUTCOMES.map((outcome) => command(operations.search.query, { workspace_id: workspace, filters: { protection_mode: outcome } })));
    return projectProtectionAxis(settled, PROTECTION_OUTCOMES, messageOf, t("the protection axis did not answer in this browser"));
  }

  function protectionFact(subjectRef: string, axis: { bySubject: Map<string, string>; answered: boolean; reason: string }): ReportFact {
    const claimed = subjectRef ? axis.bySubject.get(subjectRef) : undefined;
    if (claimed) return { state: "KNOWN", value: claimed };
    if (axis.answered) return { state: "UNKNOWN", reason: t("the daemon's protection axis did not claim an outcome for this subject") };
    return { state: "UNKNOWN", reason: axis.reason };
  }

  async function readSubjectFacts(subjectsToRead: SearchHit[], workspace: string, axis: { bySubject: Map<string, string>; answered: boolean; reason: string }, issued: Set<string>): Promise<ReportSubject[]> {
    const skippedReason = t("this report reads at most {{cap}} subjects", { cap: REPORT_SUBJECT_CAP });
    return mapLimited(subjectsToRead, REPORT_SUBJECT_CONCURRENCY, async (hit, index) => {
      const subjectRef = hit.subject_ref?.trim() ?? "";
      const listing = {
        name: hit.name?.trim() ?? "",
        provenancePath: hit.path?.trim() ?? "",
        entryType: hit.entry_type?.trim() ?? "",
        logicalSize: typeof hit.logical_size === "number" && Number.isSafeInteger(hit.logical_size) && hit.logical_size >= 0 ? hit.logical_size : null,
        contentID: hit.content_id?.trim() ?? "",
      };
      const protection = protectionFact(subjectRef, axis);
      // A subject beyond the cap keeps every fact the listing itself carries,
      // and says exactly why its stored facts were not read.
      if (!subjectRef || index >= REPORT_SUBJECT_CAP) {
        const reason = subjectRef ? skippedReason : t("this subject has no stable subject reference in the listing");
        return {
          ...listing,
          protection,
          representation: { state: "UNKNOWN", reason } as ReportRepresentation,
          tags: [],
          tagsReadable: false,
          tagsReason: reason,
          notes: [],
          notesReadable: false,
          notesReason: reason,
          unreadableReason: "",
          skippedReason: subjectRef ? skippedReason : "",
        };
      }
      const [annotations, descriptions, representation] = await Promise.all([
        readAnnotations(workspace, subjectRef, issued),
        readDescriptions(workspace, subjectRef, issued),
        readRepresentation(workspace, subjectRef, issued),
      ]);
      const annotationNotes: ReportNote[] = annotations.state === "READ"
        ? annotations.notes.map((note) => ({
            sourceLabel: descriptionKindLabel("USER", t),
            body: String(note.body ?? ""),
            bodyUnavailable: false,
            bodyUnavailableReason: "",
            updatedAt: String(note.updated_at ?? ""),
            revision: typeof note.revision === "number" ? note.revision : null,
            accepted: null,
          }))
        : [];
      const descriptionNotes = descriptions.state === "READ" ? descriptions.notes : [];
      const noteReasons = [
        annotations.state === "UNKNOWN" ? `annotation.list: ${annotations.reason}` : "",
        descriptions.state === "UNKNOWN" ? `description.list: ${descriptions.reason}` : descriptions.reason,
      ].filter(Boolean);
      const failureReasons = [
        annotations.state === "UNKNOWN" ? `annotation.list: ${annotations.reason}` : "",
        descriptions.state === "UNKNOWN" ? `description.list: ${descriptions.reason}` : "",
        representation.state === "UNKNOWN" ? `representation.list: ${representation.reason}` : "",
      ].filter(Boolean);
      return {
        ...listing,
        protection,
        representation,
        tags: annotations.state === "READ" ? annotations.tags : [],
        tagsReadable: annotations.state === "READ",
        tagsReason: annotations.state === "UNKNOWN" ? annotations.reason : "",
        notes: [...annotationNotes, ...descriptionNotes],
        notesReadable: annotations.state === "READ" || descriptions.state === "READ",
        notesReason: noteReasons.join("; "),
        unreadableReason: failureReasons.length === 3 ? failureReasons.join("; ") : "",
        skippedReason: "",
      };
    });
  }

  async function downloadSelectionReport() {
    if (reportBusy || subjects.length === 0) return;
    const workspace = workspaceID.trim();
    if (!workspace) {
      setReportState({ state: "FAILED", text: t("This service has not reported any published content in this browser yet.") });
      return;
    }
    const token = ++reportToken.current;
    const generatedAt = new Date();
    setReportState({ state: "RUNNING", text: t("Reading {{count}} selected subjects...", { count: subjects.length }) });
    try {
      const fromSearch = viewMode === "search" && Boolean(query.trim());
      const issued = new Set<string>([fromSearch ? "search.query (the loaded results)" : "content.list (the loaded listing)"]);
      const axis = await readProtectionAxis(workspace, issued);
      const reportSubjects = await readSubjectFacts(subjects, workspace, axis, issued);
      if (reportToken.current !== token) return;
      const readCount = reportSubjects.filter((subject) => !subject.skippedReason && !subject.unreadableReason).length;
      const failedCount = reportSubjects.filter((subject) => subject.unreadableReason).length;
      const skippedCount = reportSubjects.filter((subject) => subject.skippedReason).length;
      const markdown = buildSelectionReport({
        generatedAt,
        locale,
        fromSearch,
        query,
        subjects: reportSubjects,
        read: { operations: [...issued], readCount, failedCount, skippedCount, subjectCap: REPORT_SUBJECT_CAP },
        t,
      });
      downloadMarkdown(selectionReportFilename(generatedAt), markdown);
      setReportState({
        state: "DONE",
        text: t("Selection report downloaded: {{read}} of {{total}} subjects read, {{failed}} could not be read, {{skipped}} not read.", { read: readCount, total: reportSubjects.length, failed: failedCount, skipped: skippedCount }),
      });
    } catch (error) {
      setReportState({ state: "FAILED", text: t("Could not build the selection report: {{message}}", { message: messageOf(error) }) });
    }
  }

  return <section className="selection-bar selection-workflow" role="region" aria-label={t("Selection actions")}>
    <div className="selection-primary-row">
      <div className="selection-count">
        <span className="selection-count-primary" role="status">{t("{{count}} selected", { count })}</span>
        <span className="selection-size-summary">{subjectSummary.byteTotalOverflow
          ? t("Selected file size unavailable")
          : t("Known selected file size: {{bytes}}", { bytes: formatBytes(subjectSummary.knownFileBytes) })}</span>
        <details className="selection-details">
          <summary>{t("Selection details")}</summary>
          <p className="selection-subject-summary">{t("Files {{files}} · folders {{folders}} · other {{other}}", { files: subjectSummary.files, folders: subjectSummary.folders, other: subjectSummary.other })}</p>
        </details>
        {(subjectSummary.folders > 0 || subjectSummary.other > 0) && <small className="selection-scope-hint">{t("Folders {{folders}} · other items {{other}}", { folders: subjectSummary.folders, other: subjectSummary.other })}</small>}
        {subjectSummary.unknownFileSizes > 0 && <small className="selection-size-warning" role="status">{t("{{count}} file sizes unknown", { count: subjectSummary.unknownFileSizes })}</small>}
        {selectionMismatch && <small className="selection-mismatch-warning" role="status">{t("{{count}} selected items are not in these results; batch actions are paused.", { count: unresolvedCount })}</small>}
      </div>
      {originalDownloadHit && <button type="button" className="primary-button compact selection-originals" onClick={() => {
        const entryID = originalDownloadHit.entry_id;
        if (busy || originalTakeoutBusy || !workspaceID.trim() || !entryID?.trim()) return;
        downloadOriginal(workspaceID, entryID, originalDownloadHit.name || "download.bin");
      }} disabled={busy || originalTakeoutBusy}><DownloadIcon size={14} />{t("Download original")}</button>}
      {onDownloadOriginals && <button type="button" className={`${originalDownloadHit ? "secondary-button" : "primary-button"} compact selection-originals`} title={t("Download up to 32 files, 32 MiB each, 64 MiB total.")} onClick={() => onDownloadOriginals(subjects)} disabled={busy || selectionMismatch || originalTakeoutBusy || subjects.length === 0}><Archive size={14} />{t("Download originals (ZIP)")}</button>}
      <button type="button" className="text-button selection-clear" onClick={onClear}><X size={13} />{t("Clear selection")}</button>
    </div>
    {reportState.state !== "IDLE" && <p className="selection-report-state" role="status" data-report-state={reportState.state}>{reportState.text}</p>}
    {tagMutationProgress && <div className="selection-tag-progress" role="status" aria-live="polite" data-progress-state={tagMutationProgress.phase}>
      <div className="selection-tag-progress-copy">
        <strong>{tagProgressPhase}</strong>
        <span>{t("Subjects fully settled: {{settled}} of {{total}} ({{started}} started).", { settled: tagMutationProgress.settledSubjects, total: tagMutationProgress.totalSubjects, started: tagMutationProgress.startedSubjects })}</span>
        {tagMutationProgress.kind === "queued" && <span>{t("Item-tag checks fully settled: {{settled}} of {{total}}; writes started: {{writes}}.", { settled: tagMutationProgress.settledItemTags, total: tagMutationProgress.totalItemTags, writes: tagMutationProgress.startedWrites })}</span>}
        {tagMutationProgress.kind === "single" && <span>{t("Writes started: {{writes}}.", { writes: tagMutationProgress.startedWrites })}</span>}
        {tagMutationProgress.currentSubject && <span>{t("Current item: {{name}}", { name: tagMutationProgress.currentSubject })}{tagMutationProgress.currentTag && " · " + t("Tag {{tag}}", { tag: tagMutationProgress.currentTag })}</span>}
        {tagMutationProgress.phase === "stopped" && <span>{t("Continuing is a separate action. Queued tags were not cleared or retried.")}</span>}
        {tagMutationProgress.refreshState === "unavailable" && <span>{t("Tag refresh is unavailable; confirmed writes remain, and current tag state is not fully refreshed.")}</span>}
      </div>
      <div className="selection-tag-progress-actions">
        {tagProgressActive && <button type="button" className="secondary-button compact" onClick={onStopTagMutation} disabled={tagMutationProgress.phase === "stopping" || !onStopTagMutation}>{t("Stop after current operation")}</button>}
        {!tagProgressActive && onRefreshTagState && <button type="button" className="secondary-button compact" onClick={onRefreshTagState} disabled={tagMutationProgress.refreshState === "refreshing" || busy}>
          {tagMutationProgress.refreshState === "refreshing" ? t("Refreshing tags…") : t("Refresh tags")}
        </button>}
      </div>
    </div>}
    <div className="selection-disclosures">
      <details className="selection-disclosure selection-tag-disclosure">
        <summary>{t("Organize tags")}</summary>
        <p className="selection-tag-scope">{t("These actions change tags on the selected items only. Original files and Notes are left unchanged.")}</p>
        <form className="selection-tag" onSubmit={(event) => { event.preventDefault(); onApplyTag(); }}>
          <input list="cairn-tag-vocabulary" aria-label={t("Tag for selected items")} value={tagDraft} onChange={(event) => onTagDraft(event.target.value)} placeholder={t("Add or reuse a tag")} disabled={tagActionsDisabled} />
          <button type="submit" className="primary-button compact" disabled={tagActionsDisabled || !tagDraft.trim()}><Tag size={14} />{t("Add tag")}</button>
          <button type="button" className="secondary-button compact" onClick={onRemoveTag} disabled={tagActionsDisabled || !tagDraft.trim()}><Tag size={14} />{t("Remove tag ({{count}} matching)", { count: currentTagMatches })}</button>
        </form>
        {tagQueue && tagQueueDraft !== undefined && onTagQueueDraft && onAddQueuedTag && onRemoveQueuedTag && onClearQueuedTags && onApplyQueuedTags && <div className="selection-tag-queue">
          <p className="selection-tag-queue-label">{t("Add several tags")}</p>
          <form className="selection-tag-queue-entry" onSubmit={(event) => { event.preventDefault(); onAddQueuedTag(); }}>
            <input list="cairn-tag-vocabulary" aria-label={t("Tag to add to the pending list")} value={tagQueueDraft} onChange={(event) => onTagQueueDraft(event.target.value)} placeholder={t("Type one complete tag")} disabled={tagActionsDisabled || tagQueue.length >= 20} />
            <button type="submit" className="secondary-button compact" disabled={tagActionsDisabled || !tagQueueDraft.trim() || tagQueue.length >= 20}><Tag size={14} />{t("Add to list")}</button>
          </form>
          <p className="selection-tag-queue-help">{t("Press Enter or add one complete tag. Commas stay part of the tag. Maximum {{count}} tags.", { count: 20 })}</p>
          {tagQueue.length > 0 && <>
            <div className="selection-tag-chips" aria-label={t("Pending tags")}>{tagQueue.map((tag) => <span className="selection-tag-chip" key={tag}>
              <span>{tag}</span>
              <button type="button" className="selection-tag-chip-remove" aria-label={t("Remove pending tag {{tag}}", { tag })} title={t("Remove pending tag {{tag}}", { tag })} onClick={() => onRemoveQueuedTag(tag)} disabled={busy}><X size={13} /></button>
            </span>)}</div>
            <p className="selection-tag-queue-scope">{t("Queued tags will be applied to the {{count}} selected items only. Original files and Notes are left unchanged.", { count })}</p>
            <div className="selection-tag-queue-actions">
              <button type="button" className="primary-button compact" onClick={onApplyQueuedTags} disabled={tagActionsDisabled || tagQueue.length === 0}><Tag size={14} />{t("Apply {{count}} tags to {{items}} items", { count: tagQueue.length, items: subjects.length })}</button>
              <button type="button" className="text-button compact" onClick={onClearQueuedTags} disabled={busy}>{t("Clear pending tags")}</button>
            </div>
          </>}
        </div>}
        {!tagActionsReady && !selectionMismatch && <p className="selection-tag-unavailable" role="status">{tagActionsUnavailableMessage}</p>}
        {selectionMismatch && <p className="selection-tag-unavailable" role="status">{t("Some selected items are unavailable in this result scope. Batch tag actions are paused.")}</p>}
      </details>
      <details className="selection-disclosure selection-more">
        <summary>{t("More actions")}</summary>
        <div className="selection-more-body">
          {onSelectAll && <button type="button" className="secondary-button compact selection-all" onClick={onSelectAll}><Check size={14} />{t("Select all visible")}</button>}
          {onInvertSelection && <button type="button" className="secondary-button compact selection-invert" onClick={onInvertSelection}>{t("Invert selection in current results")}</button>}
          <div className="selection-copy-lists" role="group" aria-label={t("Copy selected names and paths")}>
            <button type="button" className="secondary-button compact" onClick={() => void copySelectedList("filename")} disabled={busy || selectionMismatch || missingStableSubjectCount > 0 || orderedUniqueSubjects.length === 0 || missingFilenameCount > 0}>{t("Copy filename list")}</button>
            <small>{t("One quoted name per line. Distinct items with the same name remain separate.")}</small>
            {missingStableSubjectCount > 0 && <small role="status">{t("Cannot copy a list: {{count}} selected items are unavailable.", { count: missingStableSubjectCount })}</small>}
            {missingFilenameCount > 0 && <small role="status">{t("Cannot copy filename list: {{count}} selected items have no filename.", { count: missingFilenameCount })}</small>}
            <button type="button" className="secondary-button compact" onClick={() => void copySelectedList("path")} disabled={busy || selectionMismatch || missingStableSubjectCount > 0 || orderedUniqueSubjects.length === 0 || missingSourcePathCount > 0}>{t("Copy source path list")}</button>
            <small>{t("One quoted source path per line. Paths are provenance, not current storage locations.")}</small>
            {missingSourcePathCount > 0 && <small role="status">{t("Cannot copy source path list: {{count}} selected items have no recorded path.", { count: missingSourcePathCount })}</small>}
            {visibleCopyText && <small className="selection-copy-feedback" role="status" aria-live="polite">{visibleCopyText}</small>}
          </div>
          {onCreateMaterialList && <button type="button" className="secondary-button compact" onClick={() => onCreateMaterialList(subjects)} disabled={busy || materialListCreationDisabled || selectionMismatch || subjects.length === 0 || subjects.length > 200 || subjects.some((subject) => subject.entry_type !== "REGULAR_FILE" || !subject.subject_ref?.trim() || !subject.entry_id?.trim() || !/^sha256:[0-9a-f]{64}$/.test(subject.content_id ?? "") || (subject.logical_size !== undefined && (!Number.isSafeInteger(subject.logical_size) || subject.logical_size < 0)))}>{t("Organize as list")}</button>}
          <div className="selection-favorite-actions" role="group" aria-label={t("Favorite selected items")}>
            <button type="button" className="secondary-button compact" onClick={onAddFavorite} disabled={tagActionsDisabled}><Tag size={14} />{t("Favorite selected")}</button>
            <button type="button" className="secondary-button compact" onClick={onRemoveFavorite} disabled={tagActionsDisabled}><Tag size={14} />{t("Unfavorite selected ({{count}} matching)", { count: favoriteMatchCount })}</button>
          </div>
          <p className="selection-favorite-scope">{t("Favorite actions apply to these selected items only. They use the ordinary Favorite tag.")}</p>
          <button type="button" className="secondary-button compact selection-export" onClick={(event) => onExport(event.currentTarget)} disabled={busy || selectionMismatch}><DownloadIcon size={14} />{t("Export selected")}</button>
          <button type="button" className="secondary-button compact selection-report" data-action="selection-report" aria-busy={reportBusy} title={t("Download this selection as Markdown")} aria-label={t("Download this selection as Markdown")} onClick={() => void downloadSelectionReport()} disabled={busy || selectionMismatch || reportBusy}>{reportBusy ? <LoaderCircle className="spin" size={14} /> : <FileText size={14} />}{t("Download Markdown")}</button>
          {imageSubject && <button type="button" className="secondary-button compact selection-image-search" data-action="selection-image-search" title={t("Search the library for images that look like this one")} aria-label={t("Search the library for images that look like this one")} onClick={() => onImageSearch?.(imageSubject)} disabled={busy || selectionMismatch}><ImageIcon size={14} />{t("Search by this image")}</button>}
          <p className="selection-report-note">{t("Reads the selected subjects' tags, notes, representations, and protection outcomes from this daemon with bounded concurrency, then downloads one Markdown file in this browser. Nothing is uploaded and nothing is stored.")}</p>
        </div>
      </details>
    </div>
  </section>;
}
