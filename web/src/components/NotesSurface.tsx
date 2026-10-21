import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertCircle, Check, FileText, RefreshCw, Sparkles, StickyNote, X } from "lucide-react";
import { command } from "../app/command";
import { useWorkspaceBrowseValue } from "../app/ClientBrowseSession";
import { operations } from "../lib/operations";
import { CURRENT_DESCRIPTION_PAGE_SIZE, readCurrentDescriptionPage, type CurrentDescriptionPageSet } from "../lib/descriptionPages";
import { descriptionKindLabel, formatNoteDate } from "../lib/format";
import { NoteText } from "./NoteText";
import "../styles/notes.css";
import type { Locale, Translator } from "../i18n";
import type { AnnotationRecord, Notice, SearchHit } from "../lib/types";

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
//     bodies); `description.list` uses the daemon's authoritative current-only
//     summary projection and explicit bounded continuation pages. A description
//     body is read only when one row is expanded, with `description.get` for
//     that one document. Opening this surface never fetches a description body.
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
//     this workspace. It never says "all notes" and appends descriptions only
//     while the same current-only projection remains valid.
//   - This surface has no Annotation.NOTE create/edit/delete controls. Its
//     text-file action hands off to the existing SourceDrawer composer, which
//     still requires upload, plan review, and explicit save; that creates a
//     file, not a second NOTE record. Editing a note stays in subject details.
//     A separate checkbox may select an associated file only when its identity
//     matches the current host scope.
//
// The shell passes the workspace the daemon reported, the locale, navigation,
// and the existing text-file intake handoff; the surface owns its read state
// and resolves nothing durable of its own.

type SurfaceState = "IDLE" | "LOADING" | "READY" | "BLOCKED";
type NotesSort = "SUBJECT" | "UPDATED_NEWEST" | "UPDATED_OLDEST";
type NotesViewMode = "FLAT" | "FILE_GROUPS";
type NoteTagOption = { body: string; subjectCount: number };
type NoteFileGroup = { key: string; subjectRef: string; name: string; rows: NoteRow[]; groupable: boolean };
const EMPTY_FILE_GROUPS = new Set<string>();

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

function isUsableAnnotationRecord(value: unknown): value is AnnotationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.kind === "string" && Boolean(record.kind.trim())
    && typeof record.body === "string"
    && typeof record.subject_ref === "string" && Boolean(record.subject_ref.trim())
    && (record.tombstoned === undefined || typeof record.tombstoned === "boolean");
}

function messageOf(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason ?? "");
}

function sourceGroupKey(row: NoteRow) {
  if (row.origin === "USER") return "user-note";
  const kind = row.kindToken.trim().toUpperCase();
  if (kind === "USER") return "user-note";
  if (kind === "AI_SUMMARY" || kind === "AI_ANALYSIS") return "ai-note";
  return kind ? `description-kind:${kind}` : "source-unavailable";
}

/**
 * Description rows have already been proven current leaves by the daemon's
 * current-only projection. Never infer currentness from a page-local subset
 * of predecessor links.
 */
export function currentNoteRows(annotations: AnnotationRecord[], documents: any[], t: Translator): NoteRow[] {
  const rows: NoteRow[] = [];
  for (const record of annotations) {
    if (!isUsableAnnotationRecord(record)) continue;
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
  /** Exact host-owned result scope captured before entering Notes. */
  hostScopeHits?: SearchHit[];
  scopeIdentity?: string;
  scopeAvailable?: boolean;
  busy?: boolean;
  scopeRestoring?: boolean;
  selectionRefs?: string[];
  onChangeScopeSelection?: (hits: SearchHit[], mode: "add" | "remove", scopeIdentity: string) => void;
  onReturnToLibrary?: (scopeIdentity: string) => void;
  onSearchLibrary?: (literalText: string) => void;
  onSaveTextAsFile?: (trigger?: EventTarget | null) => void;
  saveTextAsFileDisabledReason?: string;
  notice?: Notice;
  onClearNotice?: () => void;
};

const canonicalContentID = /^sha256:[0-9a-f]{64}$/;
function subjectIdentity(hit: SearchHit) {
  const size = typeof hit.logical_size === "number" && Number.isFinite(hit.logical_size) ? hit.logical_size : null;
  return [hit.subject_ref?.trim() ?? "", hit.entry_id?.trim() ?? "", hit.content_id?.trim() ?? "", hit.entry_type?.trim().toUpperCase() ?? "", size] as const;
}
function sameFileIdentity(left: SearchHit, right: SearchHit) {
  const a = subjectIdentity(left);
  const b = subjectIdentity(right);
  return Boolean(a[0] && a[1] && canonicalContentID.test(a[2]) && a[3] === "REGULAR_FILE") && a.every((value, index) => value === b[index]);
}

export function NotesSurface({ t, locale, workspaceID, onOpenSubject, hostScopeHits = [], scopeIdentity = "", scopeAvailable = false, busy = false, scopeRestoring = false, selectionRefs = [], onChangeScopeSelection, onReturnToLibrary, onSearchLibrary, onSaveTextAsFile, saveTextAsFileDisabledReason = "", notice, onClearNotice }: NotesSurfaceProps) {
  const [surfaceState, setSurfaceState] = useState<SurfaceState>("IDLE");
  const [blockedReason, setBlockedReason] = useState("");
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [descriptionProjection, setDescriptionProjection] = useState<CurrentDescriptionPageSet | null>(null);
  const [descriptionCurrentness, setDescriptionCurrentness] = useState<"LOADING" | "CURRENT" | "UNAVAILABLE" | "STALE">("LOADING");
  const [listing, setListing] = useState<SearchHit[]>([]);
  const [listingError, setListingError] = useState("");
  const [descriptionError, setDescriptionError] = useState("");
  const [loadedWorkspaceID, setLoadedWorkspaceID] = useState("");
  const [descriptionPending, setDescriptionPending] = useState(false);
  const [filter, setFilter] = useWorkspaceBrowseValue("notes.filter", "");
  const [sourceFilter, setSourceFilter] = useWorkspaceBrowseValue("notes.sourceFilter", "ALL");
  const [tagFilter, setTagFilter] = useWorkspaceBrowseValue("notes.tagFilter", "");
  const [sortMode, setSortMode] = useWorkspaceBrowseValue<NotesSort>("notes.sortMode", "SUBJECT");
  const [viewMode, setViewMode] = useWorkspaceBrowseValue<NotesViewMode>("notes.viewMode", "FLAT");
  const [expandedFileGroups, setExpandedFileGroups] = useWorkspaceBrowseValue<Set<string>>("notes.expandedFileGroups", EMPTY_FILE_GROUPS);
  const [expandedKey, setExpandedKey] = useState("");
  const [bodies, setBodies] = useState<Record<string, BodyRead>>({});
  const [readAt, setReadAt] = useState(0);
  const [loadGeneration, setLoadGeneration] = useState(0);
  const loadTokenRef = useRef(0);
  const descriptionRequestRef = useRef(0);
  const descriptionPendingRef = useRef(false);
  const descriptionProjectionRef = useRef<CurrentDescriptionPageSet | null>(null);
  const workspaceRef = useRef(workspaceID);
  workspaceRef.current = workspaceID;
  const bodyTokensRef = useRef<Record<string, number>>({});

  const documents = descriptionCurrentness === "CURRENT" ? descriptionProjection?.documents ?? [] : [];
  const rows = useMemo(() => currentNoteRows(annotations, documents, t), [annotations, documents, t]);
  const listingBySubject = useMemo(() => {
    const map = new Map<string, SearchHit>();
    for (const item of listing) {
      const subjectRef = item.subject_ref?.trim();
      if (subjectRef) map.set(subjectRef, item);
    }
    return map;
  }, [listing]);
  const listingCountBySubject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of listing) {
      const subjectRef = item.subject_ref?.trim();
      if (subjectRef) counts.set(subjectRef, (counts.get(subjectRef) ?? 0) + 1);
    }
    return counts;
  }, [listing]);
  const eligibleHitBySubject = useMemo(() => {
    const ownBySubject = new Map<string, SearchHit[]>();
    const hostBySubject = new Map<string, SearchHit[]>();
    for (const hit of listing) {
      const ref = hit.subject_ref?.trim() ?? "";
      if (ref) ownBySubject.set(ref, [...(ownBySubject.get(ref) ?? []), hit]);
    }
    for (const hit of hostScopeHits) {
      const ref = hit.subject_ref?.trim() ?? "";
      if (ref) hostBySubject.set(ref, [...(hostBySubject.get(ref) ?? []), hit]);
    }
    const eligible = new Map<string, SearchHit>();
    for (const [ref, ownHits] of ownBySubject) {
      const scopedHits = hostBySubject.get(ref) ?? [];
      if (ownHits.length !== 1 || scopedHits.length !== 1 || !sameFileIdentity(ownHits[0], scopedHits[0])) continue;
      eligible.set(ref, scopedHits[0]);
    }
    return eligible;
  }, [hostScopeHits, listing]);
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
  const sourceOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const row of displayRows) options.set(sourceGroupKey(row), row.label);
    if (sourceFilter !== "ALL" && !options.has(sourceFilter)) {
      options.set(sourceFilter, t("Selected source is not in the loaded rows"));
    }
    return [...options].map(([key, label]) => ({ key, label })).sort((left, right) => left.label.localeCompare(right.label, locale));
  }, [displayRows, locale, sourceFilter, t]);
  const tagsBySubject = useMemo(() => {
    const bySubject = new Map<string, Set<string>>();
    for (const record of annotations) {
      if (record.kind !== "TAG" || record.tombstoned) continue;
      const body = record.body!;
      const subjectRef = record.subject_ref!.trim();
      const tags = bySubject.get(subjectRef) ?? new Set<string>();
      tags.add(body);
      bySubject.set(subjectRef, tags);
    }
    return bySubject;
  }, [annotations]);
  const noteSubjectRefs = useMemo(() => new Set(displayRows.map((row) => row.subjectRef)), [displayRows]);
  const tagOptions = useMemo<NoteTagOption[]>(() => {
    const counts = new Map<string, number>();
    for (const subjectRef of noteSubjectRefs) {
      for (const tag of tagsBySubject.get(subjectRef) ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const options = [...counts].map(([body, subjectCount]) => ({ body, subjectCount }));
    if (tagFilter && !options.some((option) => option.body === tagFilter)) options.push({ body: tagFilter, subjectCount: 0 });
    return options.sort((left, right) => left.body.localeCompare(right.body, locale));
  }, [locale, noteSubjectRefs, tagsBySubject, tagFilter]);
  // The filter is a view over the rows already loaded: it rewrites nothing and
  // asks the daemon for nothing.
  const visibleRows = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    return displayRows.filter((row) => {
      if (sourceFilter !== "ALL" && sourceGroupKey(row) !== sourceFilter) return false;
      if (tagFilter && !tagsBySubject.get(row.subjectRef)?.has(tagFilter)) return false;
      if (!needle) return true;
      const read = bodies[row.key] as BodyRead | undefined;
      const loaded = read?.state === "READY" ? read.body : "";
      return [row.body, loaded, row.title, row.label, subjectName(row.subjectRef), subjectPath(row.subjectRef)]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [bodies, displayRows, filter, listingBySubject, sourceFilter, t, tagFilter, tagsBySubject]);
  const visibleEligibleHits = useMemo(() => {
    const refs = [...new Set(visibleRows.map((row) => row.subjectRef).filter((ref) => eligibleHitBySubject.has(ref)))];
    return refs.map((ref) => eligibleHitBySubject.get(ref)!);
  }, [eligibleHitBySubject, visibleRows]);
  const visibleEligibleRefs = useMemo(() => visibleEligibleHits.map((hit) => hit.subject_ref!.trim()), [visibleEligibleHits]);
  const selectedRefs = useMemo(() => new Set(selectionRefs), [selectionRefs]);
  const visibleSelectedCount = visibleEligibleRefs.filter((ref) => selectedRefs.has(ref)).length;
  const hiddenSelectedCount = selectionRefs.filter((ref) => !visibleEligibleRefs.includes(ref)).length;
  const eligibleSubjectCount = new Set(displayRows.map((row) => row.subjectRef).filter((ref) => eligibleHitBySubject.has(ref))).size;
  const outOfScopeSubjectCount = new Set(displayRows.map((row) => row.subjectRef).filter((ref) => !eligibleHitBySubject.has(ref))).size;
  const selectionEnabled = scopeAvailable && Boolean(scopeIdentity) && !busy && !scopeRestoring && Boolean(onChangeScopeSelection);
  function changeVisibleSelection(mode: "add" | "remove") {
    if (!selectionEnabled || !scopeIdentity) return;
    onChangeScopeSelection?.(visibleEligibleHits, mode, scopeIdentity);
  }
  const sortedRows = useMemo(() => {
    if (sortMode === "SUBJECT") return visibleRows;
    const timestamp = (value: string) => {
      if (!value.trim()) return undefined;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    return [...visibleRows].sort((left, right) => {
      const leftTime = timestamp(left.updatedAt);
      const rightTime = timestamp(right.updatedAt);
      if (leftTime === undefined && rightTime !== undefined) return 1;
      if (leftTime !== undefined && rightTime === undefined) return -1;
      if (leftTime !== undefined && rightTime !== undefined && leftTime !== rightTime) {
        return sortMode === "UPDATED_NEWEST" ? rightTime - leftTime : leftTime - rightTime;
      }
      return left.key.localeCompare(right.key);
    });
  }, [sortMode, visibleRows]);
  const fileGroups = useMemo<NoteFileGroup[]>(() => {
    const groups = new Map<string, NoteFileGroup>();
    for (const row of sortedRows) {
      const hit = listingBySubject.get(row.subjectRef);
      const groupable = listingCountBySubject.get(row.subjectRef) === 1
        && Boolean(hit?.entry_id)
        && hit?.entry_type?.trim().toUpperCase() === "REGULAR_FILE"
        && canonicalContentID.test(hit?.content_id ?? "");
      const key = groupable ? `file:${row.subjectRef}` : `unknown:${row.key}`;
      let group = groups.get(key);
      if (!group) {
        const fileName = groupable
          ? hit?.name?.trim() || hit?.path?.split(/[\\/]/).at(-1) || t("Untitled subject")
          : t("Unknown associated file");
        group = { key, subjectRef: row.subjectRef, name: fileName, rows: [], groupable };
        groups.set(key, group);
      }
      group.rows.push(row);
    }
    return [...groups.values()];
  }, [listingBySubject, listingCountBySubject, sortedRows, t]);
  const allFileGroupsExpanded = fileGroups.length > 0 && fileGroups.every((group) => expandedFileGroups.has(group.key));
  const userNoteCount = rows.filter((row) => row.origin === "USER").length;
  const descriptionCount = rows.length - userNoteCount;
  const filtersActive = Boolean(filter.trim()) || sourceFilter !== "ALL" || Boolean(tagFilter);

  async function loadSurface(mode: "workspace" | "refresh" = "refresh") {
    const requestWorkspace = workspaceID;
    if (mode !== "workspace" && descriptionPendingRef.current) return;
    const token = ++loadTokenRef.current;
    const descriptionRequest = ++descriptionRequestRef.current;
    descriptionPendingRef.current = true;
    setDescriptionPending(true);
    setDescriptionCurrentness("LOADING");
    setLoadGeneration(token);
    setSurfaceState((current) => (mode === "workspace" || current !== "READY" ? "LOADING" : current));
    setExpandedKey("");
    setBodies({});
    bodyTokensRef.current = {};
    try {
      if (!requestWorkspace) {
        setAnnotations([]);
        setDescriptionProjection(null);
        descriptionProjectionRef.current = null;
        setDescriptionCurrentness("UNAVAILABLE");
        setListing([]);
        setSurfaceState("BLOCKED");
        setBlockedReason(t("This browser has not recorded any published content yet, so there is nothing to read here."));
        return;
      }
      const [notesResult, descriptionResult, listingResult] = await Promise.allSettled([
        command(operations.annotation.list, { workspace_id: requestWorkspace }),
        command(operations.description.list, { workspace_id: requestWorkspace, current_only: true, page: { limit: CURRENT_DESCRIPTION_PAGE_SIZE } }),
        command(operations.content.list, { workspace_id: requestWorkspace }),
      ]);
      if (loadTokenRef.current !== token || workspaceRef.current !== requestWorkspace) return;
      if (notesResult.status !== "fulfilled") {
        // The user notes are this surface's subject: a read that failed is a
        // blocked view, never an empty one.
        setAnnotations([]);
        setDescriptionProjection(null);
        descriptionProjectionRef.current = null;
        setDescriptionCurrentness("UNAVAILABLE");
        setListing([]);
        setSurfaceState("BLOCKED");
        setBlockedReason(t("The user notes could not be read: {{message}}", { message: messageOf(notesResult.reason) }));
        return;
      }
      const returnedAnnotations = notesResult.value.data?.annotations;
      if (notesResult.value.status !== "SUCCEEDED" || !Array.isArray(returnedAnnotations) || !returnedAnnotations.every(isUsableAnnotationRecord)) {
        setAnnotations([]);
        setDescriptionProjection(null);
        descriptionProjectionRef.current = null;
        setDescriptionCurrentness("UNAVAILABLE");
        setListing([]);
        setSurfaceState("BLOCKED");
        setBlockedReason(notesResult.value.reasons?.[0]?.message || t("The annotation list is unavailable or invalid."));
        return;
      }
      setAnnotations(returnedAnnotations as AnnotationRecord[]);

      const descriptionRead = readCurrentDescriptionPage(
        descriptionResult.status === "fulfilled" ? descriptionResult.value : undefined,
        { workspaceID: requestWorkspace, limit: CURRENT_DESCRIPTION_PAGE_SIZE },
      );
      if (descriptionRead.ok) {
        descriptionProjectionRef.current = descriptionRead.value;
        setDescriptionProjection(descriptionRead.value);
        setDescriptionCurrentness("CURRENT");
        setDescriptionError("");
      } else {
        descriptionProjectionRef.current = null;
        setDescriptionProjection(null);
        setDescriptionCurrentness("UNAVAILABLE");
        const reason = descriptionResult.status === "rejected" ? messageOf(descriptionResult.reason) : descriptionRead.reason;
        setDescriptionError(t("Current descriptions are unavailable; user notes remain available. Refresh to try again. {{message}}", { message: reason }));
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
      setLoadedWorkspaceID(requestWorkspace);
      setReadAt(Date.now());
    } finally {
      if (descriptionRequestRef.current === descriptionRequest) {
        descriptionPendingRef.current = false;
        setDescriptionPending(false);
      }
    }
  }

  useEffect(() => {
    setAnnotations([]);
    setDescriptionProjection(null);
    descriptionProjectionRef.current = null;
    setDescriptionCurrentness("LOADING");
    setListing([]);
    setLoadedWorkspaceID("");
    setListingError("");
    setDescriptionError("");
    setExpandedKey("");
    setBodies({});
    void loadSurface("workspace");
    // The workspace is the shell's published id; a change re-reads, and a
    // later refresh is explicit.
  }, [workspaceID]);

  async function loadMoreDescriptions() {
    const previous = descriptionProjectionRef.current;
    if (!previous?.hasMore || descriptionPendingRef.current || descriptionCurrentness !== "CURRENT") return;
    const requestWorkspace = workspaceID;
    const request = ++descriptionRequestRef.current;
    descriptionPendingRef.current = true;
    setDescriptionPending(true);
    try {
      const response = await command(operations.description.list, {
        workspace_id: requestWorkspace,
        subject_ref: previous.subjectRef || undefined,
        current_only: true,
        page: { limit: CURRENT_DESCRIPTION_PAGE_SIZE, token: previous.token },
      });
      if (descriptionRequestRef.current !== request || workspaceRef.current !== requestWorkspace || descriptionProjectionRef.current !== previous) return;
      const next = readCurrentDescriptionPage(response, {
        workspaceID: requestWorkspace,
        subjectRef: previous.subjectRef || undefined,
        limit: CURRENT_DESCRIPTION_PAGE_SIZE,
        previous,
      });
      if (!next.ok) throw new Error(next.reason);
      descriptionProjectionRef.current = next.value;
      setDescriptionProjection(next.value);
      setDescriptionCurrentness("CURRENT");
      setDescriptionError("");
    } catch (error) {
      if (descriptionRequestRef.current !== request || workspaceRef.current !== requestWorkspace || descriptionProjectionRef.current !== previous) return;
      // A failed continuation may describe a changed catalog projection. Keep
      // cached page data for a possible refresh, but never render it as current.
      setDescriptionCurrentness("STALE");
      setDescriptionError(t("The description list changed or a page could not be verified. Refresh Notes before treating descriptions as current. {{message}}", { message: messageOf(error) }));
    } finally {
      if (descriptionRequestRef.current === request) {
        descriptionPendingRef.current = false;
        setDescriptionPending(false);
      }
    }
  }

  // The user notes are already complete: `annotation.list` returns their full
  // bodies. Only a description summary needs its own read, and only when its
  // row is expanded. A failed read stays visible and waits for that row's
  // explicit retry; ordinary expand/collapse never repeats the request.
  async function readDescriptionBody(row: NoteRow, retryUnavailable = false) {
    const existingRead = bodies[row.key];
    if (!row.documentID || (retryUnavailable
      ? existingRead?.state !== "UNAVAILABLE"
      : existingRead !== undefined)) return;
    // A retry is an explicit second request for the same list row. It reuses
    // the row's document/subject/revision identity and all existing stale-read
    // guards; it does not refresh or discard any other loaded body.
    const generation = loadTokenRef.current;
    const token = (bodyTokensRef.current[row.key] ?? 0) + 1;
    bodyTokensRef.current[row.key] = token;
    const requestWorkspace = workspaceID;
    setBodies((current) => ({ ...current, [row.key]: { state: "LOADING", body: "", reason: "" } }));
    try {
      const response = await command(operations.description.get, { workspace_id: requestWorkspace, description_document_id: row.documentID });
      if (loadTokenRef.current !== generation || workspaceRef.current !== requestWorkspace || bodyTokensRef.current[row.key] !== token) return;
      const document = response.data?.document;
      const returnedSubject = typeof document?.subject_ref === "string" ? document.subject_ref.trim() : "";
      const returnedID = typeof document?.description_document_id === "string"
        ? document.description_document_id
        : typeof document?.id === "string" ? document.id : "";
      const revisionMatches = document?.revision === undefined || document.revision === row.revision;
      const identityMatches = returnedSubject === row.subjectRef
        && returnedID === row.documentID
        && revisionMatches;
      const body = identityMatches && typeof document?.body === "string" ? document.body : "";
      setBodies((current) => ({
        ...current,
        [row.key]: body
          ? { state: "READY", body, reason: "" }
          : { state: "UNAVAILABLE", body: "", reason: identityMatches
            ? t("the daemon returned an empty body for this record")
            : t("The daemon returned a different description record.") },
      }));
    } catch (error) {
      if (loadTokenRef.current !== generation || workspaceRef.current !== requestWorkspace || bodyTokensRef.current[row.key] !== token) return;
      setBodies((current) => ({ ...current, [row.key]: { state: "UNAVAILABLE", body: "", reason: messageOf(error) } }));
    }
  }

  async function toggleDescriptionRow(row: NoteRow) {
    if (expandedKey === row.key) {
      setExpandedKey("");
      return;
    }
    setExpandedKey(row.key);
    if (!bodies[row.key]) void readDescriptionBody(row);
  }

  function retryDescriptionBody(row: NoteRow) {
    if (expandedKey !== row.key || bodies[row.key]?.state !== "UNAVAILABLE") return;
    void readDescriptionBody(row, true);
  }

  function rowBodyState(row: NoteRow) {
    if (row.origin === "USER") return "STORED";
    return bodies[row.key]?.state ?? (expandedKey === row.key ? "LOADING" : "SUMMARY");
  }

  function rowBodyText(row: NoteRow) {
    if (row.origin === "USER") return row.body;
    const read = bodies[row.key] as BodyRead | undefined;
    if (read?.state === "READY" && expandedKey === row.key) return read.body;
    if (read?.state === "READY" && row.title) return t("Title only: {{title}}", { title: row.title });
    if (read?.state === "READY") return t("Body read. Expand this row to view or copy it.");
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

  function toggleFileGroup(key: string) {
    setExpandedFileGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderNoteRow(row: NoteRow) {
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
        <label className="note-row-selection">
          <input type="checkbox" checked={eligibleHitBySubject.has(row.subjectRef) && selectedRefs.has(row.subjectRef)} disabled={!eligibleHitBySubject.has(row.subjectRef) || !selectionEnabled} onChange={() => toggleAssociatedFile(row)} aria-label={eligibleHitBySubject.has(row.subjectRef) ? t("Select associated file {{name}}", { name: subjectName(row.subjectRef) }) : t("This associated file is outside the current Library scope or cannot be matched safely.")} />
          {!eligibleHitBySubject.has(row.subjectRef) && <span>{t("Outside current scope or identity unresolved")}</span>}
        </label>
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
          <span className="note-row-path" data-fact="path">{subjectPath(row.subjectRef)}</span>
        </button>
      </div>
      <div className="note-row-content">
        {row.origin === "USER" && <NoteText body={row.body} identity={`${row.subjectRef}:${row.key}:${row.revision}`} scope={`${workspaceID}:${loadGeneration}`} t={t} />}
        {row.origin === "DESCRIPTION" && expanded && read?.state === "READY" && <NoteText body={read.body} identity={`${row.subjectRef}:${row.key}:${row.revision}`} scope={`${workspaceID}:${loadGeneration}`} t={t} />}
        {row.origin === "DESCRIPTION" && !(expanded && read?.state === "READY") && <p className="note-row-body" data-fact="body">{rowBodyText(row)}</p>}
        {row.origin === "DESCRIPTION" && <button
          type="button"
          className="secondary-button compact note-row-expand"
          data-action="toggle-description"
          aria-expanded={expanded}
          onClick={() => void toggleDescriptionRow(row)}
        >{expanded ? t("Hide body") : t("Show body")}</button>}
        {row.origin === "DESCRIPTION" && expanded && (read?.state === "LOADING" || read?.state === "UNAVAILABLE") && <button
          type="button"
          className="secondary-button compact note-row-expand"
          data-action="retry-description-body"
          disabled={read.state === "LOADING"}
          aria-busy={read.state === "LOADING"}
          onClick={() => retryDescriptionBody(row)}
        >{read.state === "LOADING" ? t("Reading the stored body…") : t("Retry reading body")}</button>}
      </div>
      {read?.state === "UNAVAILABLE" && <p className="note-row-unavailable" data-body-unavailable="true" role="alert">{t("Body unavailable: {{message}}", { message: read.reason })}</p>}
    </li>;
  }

  function openSubject(row: NoteRow) {
    if (!onOpenSubject) return;
    onOpenSubject(listingBySubject.get(row.subjectRef) ?? { subject_ref: row.subjectRef });
  }
  function toggleAssociatedFile(row: NoteRow) {
    const hit = eligibleHitBySubject.get(row.subjectRef);
    if (!hit || !selectionEnabled) return;
    onChangeScopeSelection?.([hit], selectedRefs.has(row.subjectRef) ? "remove" : "add", scopeIdentity);
  }

  // The roving Escape contract of the other workspace views: Escape from this
  // surface returns focus to the rail entry it was opened from.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    document.querySelector<HTMLButtonElement>('button[data-view="notes"]')?.focus();
  }

  const blocked = surfaceState === "BLOCKED";
  const scopeLabel = t("{{notes}} user notes and {{descriptions}} current descriptions are loaded here", { notes: userNoteCount, descriptions: descriptionCount });

  return <section
    className="content-column notes-surface"
    aria-label={t("Notes")}
    data-view="notes"
    data-state={surfaceState}
    data-partial={descriptionCurrentness !== "CURRENT" || Boolean(descriptionProjection?.hasMore) ? "true" : "false"}
    data-description-currentness={descriptionCurrentness}
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
        {onSaveTextAsFile && <button type="button" className="secondary-button compact" data-action="save-text-as-file" disabled={Boolean(saveTextAsFileDisabledReason)} onClick={(event) => onSaveTextAsFile(event.currentTarget)}><FileText size={14} />{t("Save text as a file")}</button>}
        <button type="button" className="icon-button" data-action="refresh" title={t("Refresh notes")} aria-label={t("Refresh notes")} disabled={descriptionPending} onClick={() => void loadSurface()}><RefreshCw size={15} /></button>
      </div>
    </div>
    {saveTextAsFileDisabledReason && <p className="notes-warning" data-action-disabled="save-text-as-file" role="status">{saveTextAsFileDisabledReason}</p>}
    {notice && <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.kind === "error" ? <AlertCircle size={16} /> : notice.kind === "warning" ? <Sparkles size={16} /> : <Check size={16} />}{notice.text}<button type="button" aria-label={t("Dismiss notice")} onClick={onClearNotice}><X size={14} /></button></div>}
    <details className="notes-about">
      <summary>{t("About this view")}</summary>
      <p className="notes-note">{t("This list shows the live NOTE annotation records and the current description leaves the daemon returned here, each row with its source label. It is a read-only view: nothing here creates, edits, or deletes a note, and it does not claim to list every note ever written.")}</p>
      <p className="notes-note notes-contract">{t("A row opens its subject's details, which is where a note is written; this list never copies a note into a second durable record.")}</p>
    </details>
    {descriptionCurrentness === "CURRENT" && descriptionProjection?.hasMore && <div className="notes-partial" data-partial="true" data-description-projection={descriptionProjection.projectionRef}>
      <p role="status">{t("Showing {{loaded}} of {{total}} current descriptions.", { loaded: descriptionProjection.documents.length, total: descriptionProjection.entries })}</p>
      <button type="button" className="secondary-button compact" data-action="load-more-descriptions" disabled={descriptionPending} aria-busy={descriptionPending} onClick={() => void loadMoreDescriptions()}>
        {descriptionPending ? t("Loading more descriptions…") : t("Load more current descriptions")}
      </button>
    </div>}
    {descriptionCurrentness === "STALE" && <div className="notes-partial" data-currentness="STALE" role="status">
      <p>{descriptionError}</p>
      <button type="button" className="secondary-button compact" data-action="refresh-description-projection" disabled={descriptionPending} onClick={() => void loadSurface("refresh")}>{t("Refresh current descriptions")}</button>
    </div>}
    {descriptionCurrentness === "UNAVAILABLE" && descriptionError && <p className="notes-warning" data-read="description.list" role="status">{descriptionError}</p>}
    {listingError && <p className="notes-warning" data-read="content.list" role="status">{listingError}</p>}
    {filter.trim() && onSearchLibrary && <div className="notes-library-search" data-action="search-library">
      <div>
        <strong>{t("Search the Library for this text")}</strong>
        <p>{t("The Notes filter checks loaded fields and note text you have opened. Library search checks indexed content in this library; Notes source and tag filters are not carried over.")}</p>
      </div>
      <button type="button" className="secondary-button compact" disabled={!workspaceID || busy || scopeRestoring} onClick={() => onSearchLibrary(filter.trim())}>{t("Search Library")}</button>
    </div>}

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
            <div className="notes-filter-tools">
              <label className="notes-filter">
                <span>{t("Filter by source")}</span>
                <select aria-label={t("Filter by source")} value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                  <option value="ALL">{t("All sources")}</option>
                  {sourceOptions.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}
                </select>
              </label>
              <label className="notes-filter">
                <span>{t("Filter by tag")}</span>
                <select aria-label={t("Filter by tag")} value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
                  <option value="">{t("All tags")}</option>
                  {tagOptions.map((option) => <option value={option.body} key={option.body}>{option.body} ({option.subjectCount})</option>)}
                </select>
                <small className="notes-tag-scope">{t("Tag counts are distinct associated items among loaded Notes rows.")}</small>
              </label>
              <label className="notes-filter">
                <span>{t("Sort notes")}</span>
                <select aria-label={t("Sort notes")} value={sortMode} onChange={(event) => setSortMode(event.target.value as NotesSort)}>
                  <option value="SUBJECT">{t("Subject order")}</option>
                  <option value="UPDATED_NEWEST">{t("Updated newest first")}</option>
                  <option value="UPDATED_OLDEST">{t("Updated oldest first")}</option>
                </select>
              </label>
              <label className="notes-filter">
                <span>{t("View notes")}</span>
                <select aria-label={t("View notes")} value={viewMode} onChange={(event) => setViewMode(event.target.value as NotesViewMode)}>
                  <option value="FLAT">{t("Flat records")}</option>
                  <option value="FILE_GROUPS">{t("Group by associated file")}</option>
                </select>
              </label>
              <label className="notes-filter">
                <span>{t("Filter notes")}</span>
                <input type="search" value={filter} placeholder={t("Filter by substring")} aria-label={t("Filter notes")} onChange={(event) => setFilter(event.target.value)} />
              </label>
            </div>
            <div className="notes-filter-summary">
              <p className="notes-filter-note" data-filtered-rows={visibleRows.length} data-total-rows={rows.length}>{t("Showing {{shown}} of {{total}} loaded rows; filters only narrow the records and bodies available in this view.", { shown: visibleRows.length, total: rows.length })}</p>
              <button type="button" className="secondary-button compact" disabled={!filtersActive} onClick={() => { setFilter(""); setSourceFilter("ALL"); setTagFilter(""); }}>{t("Clear filters")}</button>
            </div>
            <details className="notes-associated-selection">
              <summary>{t("Associated files ({{count}} selected)", { count: visibleSelectedCount })}</summary>
              <p role="status">{scopeAvailable
                ? t("{{eligible}} associated items are eligible in the current Library scope; {{out}} are outside it or cannot be matched safely.", { eligible: eligibleSubjectCount, out: outOfScopeSubjectCount })
                : t("The current Library scope cannot be resolved safely, so associated files cannot be selected.")}</p>
              <div className="notes-associated-actions">
                <button type="button" className="secondary-button compact" disabled={!selectionEnabled || !visibleEligibleHits.length} onClick={() => changeVisibleSelection("add")}>{t("Select visible associated files")}</button>
                <button type="button" className="secondary-button compact" disabled={!selectionEnabled || !visibleSelectedCount} onClick={() => changeVisibleSelection("remove")}>{t("Clear visible associated file selection")}</button>
                <button type="button" className="secondary-button compact" disabled={!selectionEnabled || !visibleSelectedCount || !onReturnToLibrary} onClick={() => onReturnToLibrary?.(scopeIdentity)}>{t("Use selected files in the Library ({{count}})", { count: visibleSelectedCount })}</button>
              </div>
              <p className="notes-selection-count" role="status">{t("{{selected}} visible associated files selected; {{hidden}} other selected files remain selected and may be included in Library batch actions.", { selected: visibleSelectedCount, hidden: hiddenSelectedCount })}</p>
            </details>
            {viewMode === "FLAT"
              ? <ul className="notes-rows" aria-label={t("Note rows")}>{sortedRows.map(renderNoteRow)}</ul>
              : <>
                <details className="notes-group-actions">
                  <summary>{t("Matched file group actions")}</summary>
                  <div>
                    <button type="button" className="secondary-button compact" disabled={allFileGroupsExpanded} onClick={() => setExpandedFileGroups(new Set(fileGroups.map((group) => group.key)))}>{t("Expand all matching file groups")}</button>
                    <button type="button" className="secondary-button compact" disabled={!expandedFileGroups.size} onClick={() => setExpandedFileGroups(new Set())}>{t("Collapse all file groups")}</button>
                  </div>
                </details>
                <div className="notes-file-groups" data-group-count={fileGroups.length}>
                  {fileGroups.map((group) => {
                    const expanded = expandedFileGroups.has(group.key);
                    const representative = group.rows[0];
                    const eligibleHit = group.groupable ? eligibleHitBySubject.get(group.subjectRef) : undefined;
                    const selected = Boolean(eligibleHit && selectedRefs.has(group.subjectRef));
                    return <section className="notes-file-group" key={group.key} data-row-count={group.rows.length}>
                      <div className="notes-file-group__head">
                        <button type="button" className="notes-file-group__toggle" aria-expanded={expanded} onClick={() => toggleFileGroup(group.key)}>
                          <strong>{group.name}</strong><span>{t("{{count}} Notes rows", { count: group.rows.length })}</span>
                        </button>
                        {group.groupable && <div className="notes-file-group__actions">
                          <button type="button" className="secondary-button compact" disabled={!onOpenSubject} title={onOpenSubject ? t("Open the details of {{name}}", { name: group.name }) : t("This build cannot open a subject's details from this surface.")} onClick={() => openSubject(representative)}>{t("Open the details of {{name}}", { name: group.name })}</button>
                          <label className="note-row-selection">
                            <input type="checkbox" checked={selected} disabled={!eligibleHit || !selectionEnabled} onChange={() => toggleAssociatedFile(representative)} aria-label={eligibleHit ? t("Select associated file {{name}}", { name: group.name }) : t("This associated file is outside the current Library scope or cannot be matched safely.")} />
                            {t(selected ? "Associated file selected" : "Select associated file")}
                          </label>
                        </div>}
                      </div>
                      {expanded && <ul className="notes-rows" aria-label={group.name}>{group.rows.map(renderNoteRow)}</ul>}
                    </section>;
                  })}
                </div>
              </>}
            {visibleRows.length === 0 && <p className="notes-filter-empty" data-empty-filter="true">{t("No loaded row contains this substring. Filtering changed nothing in the daemon's records.")}</p>}
          </div>}
    <p className="notes-read-at" data-read-at={readAt || ""}>{readAt
      ? t("Notes read at {{time}} (this browser)", { time: new Date(readAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })
      : t("The notes have not been read in this browser yet")}</p>
  </section>;
}
