import { useRef, useState } from "react";
import { Check, Download as DownloadIcon, FileText, Image as ImageIcon, LoaderCircle, Tag, X, Archive } from "lucide-react";
import type { Locale, Translator } from "../i18n";
import { command } from "../app/command";
import { operations } from "../lib/operations";
import { descriptionKindLabel } from "../lib/format";
import { buildSelectionReport, selectionReportFilename } from "../lib/report";
import type { ReportFact, ReportNote, ReportRepresentation, ReportSubject } from "../lib/report";
import type { SearchHit, ViewMode } from "../lib/types";

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

/** One `description.get` answer: the document, or why the body was not read. */
type BodyRead = { document?: any; reason?: string };

/** The admitted protection outcomes of the catalog contract, in claim order. */
const PROTECTION_OUTCOMES = [
  "EXACT_PROTECTED",
  "EXACT_FALLBACK",
  "EXTERNAL_REPLAYABLE",
  "LINK_ONLY_UNPROTECTED",
  "EXPLICITLY_UNPROTECTED",
  "BLOCKED",
  "UNAVAILABLE",
] as const;

/** The lexical component of a fused search answer reports whether it answered. */
const LEXICAL_DIMENSION = "lexical-metadata-fts";
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

/** True when the daemon's lexical projection actually answered this query. */
function lexicalAnswered(data: any) {
  const components = Array.isArray(data?.components) ? data.components : [];
  return components.some((component: any) => component?.dimension === LEXICAL_DIMENSION && component?.status === "SUCCEEDED" && Boolean(component?.index_generation_ref));
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

export function SelectionBar({ count, subjects, unresolvedCount = 0, workspaceID, locale, viewMode, query, tagDraft, busy, originalTakeoutBusy = false, t, onSelectAll, onExport, onDownloadOriginals, onTagDraft, onApplyTag, onClear, onImageSearch }: {
  count: number;
  subjects: SearchHit[];
  unresolvedCount?: number;
  workspaceID: string;
  locale: Locale;
  viewMode: ViewMode;
  query: string;
  tagDraft: string;
  busy: boolean;
  originalTakeoutBusy?: boolean;
  t: Translator;
  onSelectAll: () => void;
  onExport: (trigger?: EventTarget | null) => void;
  onDownloadOriginals?: (subjects: SearchHit[]) => void;
  onTagDraft: (value: string) => void;
  onApplyTag: () => void;
  onClear: () => void;
  /** Offered when exactly one selected item is a daemon-admitted image: runs the image-dimension query. */
  onImageSearch?: (subjectRef: string) => void;
}) {
  const [reportState, setReportState] = useState<{ state: "IDLE" | "RUNNING" | "DONE" | "FAILED"; text: string }>({ state: "IDLE", text: "" });
  const reportToken = useRef(0);
  const reportBusy = reportState.state === "RUNNING";
  const selectionMismatch = unresolvedCount > 0;
  // The one selected admitted image, when the parent offers the action at all.
  const imageSubject = onImageSearch ? imageSearchSubject(subjects) : "";

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
    const bySubject = new Map<string, string>();
    let answered = false;
    let reason = "";
    settled.forEach((result, index) => {
      if (result.status !== "fulfilled") {
        if (!reason) reason = messageOf(result.reason);
        return;
      }
      if (lexicalAnswered(result.value.data)) answered = true;
      else if (!reason) reason = String(result.value.reasons?.[0]?.message ?? "");
      for (const hit of (Array.isArray(result.value.data?.hits) ? result.value.data.hits : [])) {
        const subjectRef = String(hit?.subject_ref ?? "").trim();
        if (subjectRef && !bySubject.has(subjectRef)) bySubject.set(subjectRef, PROTECTION_OUTCOMES[index]);
      }
    });
    return { bySubject, answered, reason: reason || t("the protection axis did not answer in this browser") };
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
      setReportState({ state: "FAILED", text: t("No published workspace is reported by this service in this browser yet.") });
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

  return <section className="selection-bar" role="region" aria-label={t("Selection actions")}>
    <span className="selection-count" role="status">{t("{{count}} selected", { count })}{selectionMismatch && <small>{t("{{count}} selected items are not in these results; batch actions are paused.", { count: unresolvedCount })}</small>}</span>
    <button type="button" className="secondary-button compact selection-all" onClick={onSelectAll}><Check size={14} />{t("Select all visible")}</button>
    <button type="button" className="secondary-button compact selection-export" onClick={(event) => onExport(event.currentTarget)} disabled={busy || selectionMismatch}><DownloadIcon size={14} />{t("Export selected")}</button>
    {onDownloadOriginals && <button type="button" className="secondary-button compact selection-originals" title={t("Download up to 32 files, 32 MiB each, 64 MiB total.")} onClick={() => onDownloadOriginals(subjects)} disabled={busy || selectionMismatch || originalTakeoutBusy || subjects.length === 0}><Archive size={14} />{t("Download originals (ZIP)")}</button>}
    <button type="button" className="secondary-button compact selection-report" data-action="selection-report" aria-busy={reportBusy} title={t("Download this selection as Markdown")} aria-label={t("Download this selection as Markdown")} onClick={() => void downloadSelectionReport()} disabled={busy || selectionMismatch || reportBusy}>{reportBusy ? <LoaderCircle className="spin" size={14} /> : <FileText size={14} />}{t("Download Markdown")}</button>
    {imageSubject && <button type="button" className="secondary-button compact selection-image-search" data-action="selection-image-search" title={t("Search the library for images that look like this one")} aria-label={t("Search the library for images that look like this one")} onClick={() => onImageSearch?.(imageSubject)} disabled={busy || selectionMismatch}><ImageIcon size={14} />{t("Search by this image")}</button>}
    <p className="selection-report-note">{t("Reads the selected subjects' tags, notes, representations, and protection outcomes from this daemon with bounded concurrency, then downloads one Markdown file in this browser. Nothing is uploaded and nothing is stored.")}</p>
    {reportState.state !== "IDLE" && <p className="selection-report-state" role="status" data-report-state={reportState.state}>{reportState.text}</p>}
    <form className="selection-tag" onSubmit={(event) => { event.preventDefault(); onApplyTag(); }}><input list="restoreweave-tag-vocabulary" aria-label={t("Tag for selected items")} value={tagDraft} onChange={(event) => onTagDraft(event.target.value)} placeholder={t("Add or reuse a tag")} disabled={busy || selectionMismatch} /><button type="submit" className="primary-button compact" disabled={busy || selectionMismatch || !tagDraft.trim()}><Tag size={14} />{t("Add tag")}</button></form>
    <button type="button" className="text-button selection-clear" onClick={onClear}><X size={13} />{t("Clear selection")}</button>
  </section>;
}
