import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertCircle, RefreshCw, StickyNote } from "lucide-react";
import { command } from "../app/command";
import { operations } from "../lib/operations";
import { descriptionKindLabel, formatNoteDate } from "../lib/format";
import type { Locale, Translator } from "../i18n";
import type { AnnotationRecord, SearchHit } from "../lib/types";

// The read-oriented global Notes view (`docs/technical/notes-surface-decision.md`,
// Option B, section 5).
//
// One job: list, across the workspace, the live user NOTE annotation records
// and the current description leaves the daemon returned, and open a row's
// subject in the existing details inspector. It is the same one Notes surface
// the inspector renders, seen across subjects: the merge rule (a successor
// hides its predecessor, a tombstoned record is gone) and the source labels
// are that surface's, and nothing here is copied into a second durable record.
//
// The truth rules this file enforces:
//
//   - Every row is a daemon record. `annotation.list` with no `subject_ref`
//     names the workspace's live NOTE records (the daemon returns their full
//     bodies); `description.list` with no `subject_ref` returns the current
//     description summaries, which deliberately carry no body. A description
//     body is read only when one row is expanded, with `description.get` for
//     that one document. Bounded reads are the point: opening this surface
//     never fetches a description body.
//   - A body the daemon does not return is reported on its row ("Body
//     unavailable", with the daemon's own message) instead of the row
//     disappearing, and a row whose subject is missing from the listing says
//     UNKNOWN rather than inventing a name.
//   - The subject's own name and provenance path come from `content.list`,
//     exactly as the tags surface resolves them. The two note reads carry a
//     `subject_ref` and no display name (`client/command/data.go`,
//     `AnnotationData` / `DescriptionSummaryData`), so a row cannot name its
//     subject without this one listing read.
//   - The surface states what it shows: the records the daemon returned for
//     this workspace. It never says "all notes": `description.list` is bounded
//     and says so when it truncates, and its order is not recency.
//   - No control here creates a durable record. There is no composer, no
//     editor, no tag control, and no delete; writing a note stays in the
//     subject's details, one subject at a time. Selecting a row is navigation.
//
// The shell passes the workspace the daemon reported, the locale, and the one
// navigation seam (open a subject's details); the surface owns its own read
// state and resolves nothing durable of its own.

type SurfaceState = "IDLE" | "LOADING" | "READY" | "BLOCKED";

/** One row of the one Notes surface: a live user note or a current description leaf. */
export type NoteRow = {
  key: string;
  origin: "USER" | "DESCRIPTION";
  /** The row's own label, exactly as the inspector labels the same record. */
  label: string;
  /** The description kind token as the daemon stored it; empty for a user note row. */
  kindToken: string;
  subjectRef: string;
  revision: number;
  updatedAt: string;
  /** A user note's stored body; empty for a description summary (read on expand). */
  body: string;
  /** A description summary's own title, when it carries one. */
  title: string;
  accepted: boolean | undefined;
  annotationID: string;
  documentID: string;
};

/** One description body's read, keyed by the row it belongs to. */
type BodyRead = { state: "LOADING" | "READY" | "UNAVAILABLE"; body: string; reason: string };

function messageOf(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason ?? "");
}

/**
 * The one merge rule of the Notes surface, copied small from the details
 * inspector because no shared helper exists yet: a successor hides its
 * predecessor, a tombstoned record is gone, and a live NOTE record is a row as
 * it stands. The complete revision chain stays durable in the catalog; this
 * list renders the current leaves only.
 */
export function currentNoteRows(annotations: AnnotationRecord[], documents: any[], t: Translator): NoteRow[] {
  const superseded = new Set(documents.map((document) => String(document?.predecessor_id ?? "")).filter(Boolean));
  const rows: NoteRow[] = [];
  for (const record of annotations) {
    if (record.kind !== "NOTE" || record.tombstoned) continue;
    const body = typeof record.body === "string" ? record.body : "";
    const subjectRef = record.subject_ref?.trim() ?? "";
    if (!body || !subjectRef) continue;
    rows.push({
      key: `note:${record.annotation_id ?? `${subjectRef}:${record.revision ?? 0}`}`,
      origin: "USER",
      label: t("User note"),
      kindToken: "NOTE",
      subjectRef,
      revision: typeof record.revision === "number" ? record.revision : 0,
      updatedAt: record.updated_at ?? "",
      body,
      title: "",
      accepted: undefined,
      annotationID: record.annotation_id ?? "",
      documentID: "",
    });
  }
  for (const document of documents) {
    const documentID = String(document?.description_document_id ?? "");
    const subjectRef = String(document?.subject_ref ?? "").trim();
    if (!documentID || !subjectRef || document?.tombstoned) continue;
    if (superseded.has(documentID)) continue;
    rows.push({
      key: `description:${documentID}`,
      origin: "DESCRIPTION",
      label: descriptionKindLabel(document?.kind, t),
      kindToken: String(document?.kind ?? ""),
      subjectRef,
      revision: typeof document?.revision === "number" ? document.revision : 0,
      updatedAt: String(document?.updated_at ?? ""),
      body: "",
      title: String(document?.title ?? ""),
      accepted: typeof document?.accepted === "boolean" ? document.accepted : undefined,
      annotationID: "",
      documentID,
    });
  }
  return rows;
}

export type NotesSurfaceProps = {
  t: Translator;
  locale: Locale;
  /** The published workspace the shell recorded; never invented here. */
  workspaceID: string;
  /** The existing navigation path: open one subject's details in the inspector. */
  onOpenSubject?: (hit: SearchHit) => void;
};

export function NotesSurface({ t, locale, workspaceID, onOpenSubject }: NotesSurfaceProps) {
  const [surfaceState, setSurfaceState] = useState<SurfaceState>("IDLE");
  const [blockedReason, setBlockedReason] = useState("");
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [listing, setListing] = useState<SearchHit[]>([]);
  const [listingError, setListingError] = useState("");
  const [descriptionError, setDescriptionError] = useState("");
  const [filter, setFilter] = useState("");
  const [expandedKey, setExpandedKey] = useState("");
  const [bodies, setBodies] = useState<Record<string, BodyRead>>({});
  const [readAt, setReadAt] = useState(0);
  const loadTokenRef = useRef(0);
  const bodyTokensRef = useRef<Record<string, number>>({});

  const rows = useMemo(() => currentNoteRows(annotations, documents, t), [annotations, documents, t]);
  const listingBySubject = useMemo(() => {
    const map = new Map<string, SearchHit>();
    for (const item of listing) {
      const subjectRef = item.subject_ref?.trim();
      if (subjectRef) map.set(subjectRef, item);
    }
    return map;
  }, [listing]);
  const subjectName = (subjectRef: string) => listingBySubject.get(subjectRef)?.name?.trim() || t("UNKNOWN — not reported by this build");
  const subjectPath = (subjectRef: string) => listingBySubject.get(subjectRef)?.path?.trim() || t("UNKNOWN — not reported by this build");
  // The listing order is the surface's own stable order (subject name, then
  // source, newest revision first). It never implies recency across subjects:
  // the description read is ordered by subject and revision, not by time.
  const displayRows = useMemo(() => {
    const withNames = rows.map((row) => ({ row, name: listingBySubject.get(row.subjectRef)?.name?.trim() || "" }));
    withNames.sort((left, right) =>
      left.name.localeCompare(right.name, locale)
      || (left.row.origin === right.row.origin ? 0 : left.row.origin === "USER" ? -1 : 1)
      || right.row.updatedAt.localeCompare(left.row.updatedAt)
      || right.row.revision - left.row.revision
      || left.row.key.localeCompare(right.row.key));
    return withNames.map((entry) => entry.row);
  }, [listingBySubject, locale, rows]);
  // The filter is a view over the rows already loaded: it rewrites nothing and
  // asks the daemon for nothing.
  const visibleRows = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    if (!needle) return displayRows;
    return displayRows.filter((row) => {
      const read = bodies[row.key] as BodyRead | undefined;
      const loaded = read?.state === "READY" ? read.body : "";
      return [row.body, loaded, row.title, row.label, subjectName(row.subjectRef), subjectPath(row.subjectRef)]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [bodies, displayRows, filter, listingBySubject]);
  const userNoteCount = rows.filter((row) => row.origin === "USER").length;
  const descriptionCount = rows.length - userNoteCount;

  async function loadSurface() {
    const token = ++loadTokenRef.current;
    setSurfaceState((current) => (current === "READY" ? current : "LOADING"));
    setExpandedKey("");
    setBodies({});
    bodyTokensRef.current = {};
    if (!workspaceID) {
      setAnnotations([]);
      setDocuments([]);
      setTruncated(false);
      setListing([]);
      setSurfaceState("BLOCKED");
      setBlockedReason(t("This browser has not recorded any published content yet, so there is nothing to read here."));
      return;
    }
    const [notesResult, descriptionResult, listingResult] = await Promise.allSettled([
      command(operations.annotation.list, { workspace_id: workspaceID }),
      // A bounded read: `description.list` answers at most this many current
      // summaries and reports `truncated` when there are more.
      command(operations.description.list, { workspace_id: workspaceID, limit: 200 }),
      command(operations.content.list, { workspace_id: workspaceID }),
    ]);
    if (loadTokenRef.current !== token) return;
    if (notesResult.status !== "fulfilled") {
      // The user notes are this surface's subject: a read that failed is a
      // blocked view, never an empty one.
      setAnnotations([]);
      setDocuments([]);
      setTruncated(false);
      setListing([]);
      setSurfaceState("BLOCKED");
      setBlockedReason(t("The user notes could not be read: {{message}}", { message: messageOf(notesResult.reason) }));
      return;
    }
    setAnnotations(Array.isArray(notesResult.value.data?.annotations) ? (notesResult.value.data.annotations as AnnotationRecord[]) : []);
    if (descriptionResult.status === "fulfilled") {
      setDocuments(Array.isArray(descriptionResult.value.data?.documents) ? descriptionResult.value.data.documents : []);
      setTruncated(descriptionResult.value.data?.truncated === true);
      setDescriptionError("");
    } else {
      // The user notes still render; the missing half is stated, never hidden.
      setDocuments([]);
      setTruncated(false);
      setDescriptionError(t("The current descriptions could not be read, so only the user notes are shown: {{message}}", { message: messageOf(descriptionResult.reason) }));
    }
    if (listingResult.status === "fulfilled") {
      setListing(Array.isArray(listingResult.value.data?.items) ? (listingResult.value.data.items as SearchHit[]) : []);
      setListingError("");
    } else {
      // Names and provenance paths are read from the listing; without it every
      // row still exists (it is a daemon record) but says UNKNOWN with the
      // daemon's reason.
      setListing([]);
      setListingError(t("The content listing could not be read, so every subject name is shown as UNKNOWN: {{message}}", { message: messageOf(listingResult.reason) }));
    }
    setSurfaceState("READY");
    setReadAt(Date.now());
  }

  useEffect(() => {
    void loadSurface();
    // The workspace is the shell's published id; a change re-reads, and a
    // later refresh is explicit.
  }, [workspaceID]);

  // The user notes are already complete: `annotation.list` returns their full
  // bodies. Only a description summary needs its own read, and only when its
  // row is expanded. A failed read stays visible on the row and is not retried
  // silently; the refresh control re-reads the surface.
  async function toggleDescriptionRow(row: NoteRow) {
    if (expandedKey === row.key) {
      setExpandedKey("");
      return;
    }
    setExpandedKey(row.key);
    if (bodies[row.key] || !row.documentID) return;
    // One body read per row: the token is per row, so two rows expanded in
    // turn never drop each other's answer, and a reload clears every token.
    const token = (bodyTokensRef.current[row.key] ?? 0) + 1;
    bodyTokensRef.current[row.key] = token;
    setBodies((current) => ({ ...current, [row.key]: { state: "LOADING", body: "", reason: "" } }));
    try {
      const response = await command(operations.description.get, { workspace_id: workspaceID, description_document_id: row.documentID });
      if (bodyTokensRef.current[row.key] !== token) return;
      const body = typeof response.data?.document?.body === "string" ? response.data.document.body : "";
      setBodies((current) => ({
        ...current,
        [row.key]: body
          ? { state: "READY", body, reason: "" }
          : { state: "UNAVAILABLE", body: "", reason: t("the daemon returned an empty body for this record") },
      }));
    } catch (error) {
      if (bodyTokensRef.current[row.key] !== token) return;
      setBodies((current) => ({ ...current, [row.key]: { state: "UNAVAILABLE", body: "", reason: messageOf(error) } }));
    }
  }

  function rowBodyState(row: NoteRow) {
    if (row.origin === "USER") return "STORED";
    return bodies[row.key]?.state ?? (expandedKey === row.key ? "LOADING" : "SUMMARY");
  }

  function rowBodyText(row: NoteRow) {
    if (row.origin === "USER") return row.body;
    const read = bodies[row.key] as BodyRead | undefined;
    if (read?.state === "READY") return read.body;
    if (read?.state === "UNAVAILABLE") return "";
    if (expandedKey === row.key || read?.state === "LOADING") return t("Reading the stored body…");
    if (row.title) return t("Title only: {{title}}", { title: row.title });
    return t("The list carries summaries only; expand this row to read the stored body.");
  }

  // The inspector's own meta line, applied to every row so the cross-subject
  // list reads exactly like the one Notes surface inside the inspector.
  function rowMetaText(row: NoteRow) {
    const parts = [row.label];
    if (row.accepted === false) parts.push(t("Not accepted"));
    if (row.revision) parts.push(t("revision {{revision}}", { revision: row.revision }));
    parts.push(formatNoteDate(row.updatedAt, locale, t));
    return parts.join(" · ");
  }

  function openSubject(row: NoteRow) {
    if (!onOpenSubject) return;
    onOpenSubject(listingBySubject.get(row.subjectRef) ?? { subject_ref: row.subjectRef });
  }

  // The roving Escape contract of the other workspace views: Escape from this
  // surface returns focus to the rail entry it was opened from.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    document.querySelector<HTMLButtonElement>('button[data-view="notes"]')?.focus();
  }

  const blocked = surfaceState === "BLOCKED";
  const scopeLabel = t("{{notes}} user notes and {{descriptions}} current description leaves were returned here", { notes: userNoteCount, descriptions: descriptionCount });

  return <section
    className="content-column notes-surface"
    aria-label={t("Notes")}
    data-view="notes"
    data-state={surfaceState}
    data-partial={truncated ? "true" : "false"}
    data-workspace-id={workspaceID}
    data-row-count={rows.length}
    data-note-count={userNoteCount}
    data-description-count={descriptionCount}
    onKeyDown={handleKeyDown}
  >
    <div className="workspace-heading">
      <div>
        <p className="eyebrow">{t("CONTENT")}</p>
        <h1>{t("Notes")}</h1>
      </div>
      <div className="heading-actions">
        <span className="result-count notes-scope" data-summary-source="annotation.list" data-row-count={rows.length} data-note-count={userNoteCount} data-description-count={descriptionCount}>{scopeLabel}</span>
        <button type="button" className="icon-button" data-action="refresh" title={t("Refresh notes")} aria-label={t("Refresh notes")} onClick={() => void loadSurface()}><RefreshCw size={15} /></button>
      </div>
    </div>
    <p className="notes-note">{t("This list shows the live NOTE annotation records and the current description leaves the daemon returned here, each row with its source label. It is a read-only view: nothing here creates, edits, or deletes a note, and it does not claim to list every note ever written.")}</p>
    <p className="notes-note notes-contract">{t("A row opens its subject's details, which is where a note is written; this list never copies a note into a second durable record.")}</p>
    {truncated && <p className="notes-partial" data-partial="true" role="status">{t("The description list is partial: the daemon returned {{count}} description records, and older description records are not shown here.", { count: descriptionCount })}</p>}
    {descriptionError && <p className="notes-warning" data-read="description.list" role="status">{descriptionError}</p>}
    {listingError && <p className="notes-warning" data-read="content.list" role="status">{listingError}</p>}

    {blocked
      ? <div className="notes-blocked" data-state="BLOCKED" role="alert"><AlertCircle size={16} /><div><strong>{t("Notes are not readable right now")}</strong><small data-blocked-reason={blockedReason}>{blockedReason}</small></div></div>
      : surfaceState === "LOADING" || surfaceState === "IDLE"
        ? <p className="notes-loading" data-state="LOADING" role="status">{t("Reading the notes the daemon recorded here…")}</p>
        : rows.length === 0
          ? <div className="empty-state notes-empty" data-empty="true">
            <span className="vault-sigil"><StickyNote size={35} /></span>
            <h2>{t("No notes here yet")}</h2>
            <p>{t("This list reads the daemon's live NOTE annotation records and its current description documents only. A row appears once a note or a description is recorded on a subject here; an empty list is what the daemon returned here, not a claim that the catalog holds no notes.")}</p>
          </div>
          : <div className="notes-body">
            <label className="notes-filter">
              <span>{t("Filter notes")}</span>
              <input type="search" value={filter} placeholder={t("Filter by substring")} aria-label={t("Filter notes")} onChange={(event) => setFilter(event.target.value)} />
            </label>
            <p className="notes-filter-note" data-filtered-rows={visibleRows.length} data-total-rows={rows.length}>{t("Showing {{shown}} of {{total}} rows. Filtering matches a substring of the rows already loaded; it never changes what the daemon returned.", { shown: visibleRows.length, total: rows.length })}</p>
            <ul className="notes-rows" aria-label={t("Note rows")}>
              {visibleRows.map((row) => {
                const read = bodies[row.key] as BodyRead | undefined;
                const expanded = expandedKey === row.key;
                return <li
                  className="note-row"
                  key={row.key}
                  data-row-key={row.key}
                  data-source-kind={row.origin}
                  data-source-label={row.label}
                  data-subject-ref={row.subjectRef}
                  data-subject-name={subjectName(row.subjectRef)}
                  data-annotation-id={row.annotationID}
                  data-description-document-id={row.documentID}
                  data-description-kind={row.kindToken}
                  data-revision={row.revision}
                  data-body-state={rowBodyState(row)}
                >
                  <div className="note-row-head">
                    <button
                      type="button"
                      className="note-row-open"
                      data-action="open-subject"
                      disabled={!onOpenSubject}
                      title={onOpenSubject ? t("Open the details of {{name}}", { name: subjectName(row.subjectRef) }) : t("This build cannot open a subject's details from this surface.")}
                      aria-label={t("Open the details of {{name}}", { name: subjectName(row.subjectRef) })}
                      onClick={() => openSubject(row)}
                    >
                      <span className="note-row-subject" data-fact="subject-name">{subjectName(row.subjectRef)}</span>
                      <span className="note-row-label" data-fact="source-label">{row.label}</span>
                      <span className="note-row-meta" data-fact="meta">{rowMetaText(row)}</span>
                      <span className="note-row-body" data-fact="body">{rowBodyText(row)}</span>
                      <span className="note-row-path" data-fact="path">{subjectPath(row.subjectRef)}</span>
                    </button>
                    {row.origin === "DESCRIPTION" && <button
                      type="button"
                      className="secondary-button compact note-row-expand"
                      data-action="toggle-description"
                      aria-expanded={expanded}
                      onClick={() => void toggleDescriptionRow(row)}
                    >{expanded ? t("Hide body") : t("Show body")}</button>}
                  </div>
                  {read?.state === "UNAVAILABLE" && <p className="note-row-unavailable" data-body-unavailable="true" role="alert">{t("Body unavailable: {{message}}", { message: read.reason })}</p>}
                </li>;
              })}
            </ul>
            {visibleRows.length === 0 && <p className="notes-filter-empty" data-empty-filter="true">{t("No loaded row contains this substring. Filtering changed nothing in the daemon's records.")}</p>}
          </div>}
    <p className="notes-read-at" data-read-at={readAt || ""}>{readAt
      ? t("Notes read at {{time}} (this browser)", { time: new Date(readAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })
      : t("The notes have not been read in this browser yet")}</p>
  </section>;
}
