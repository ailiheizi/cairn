import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertCircle, ExternalLink, RefreshCw, Tags as TagsIcon, Undo2 } from "lucide-react";
import { command } from "../app/command";
import { operations } from "../lib/operations";
import type { Translator } from "../i18n";
import type { AnnotationRecord, SearchHit } from "../lib/types";

// The tags surface (Tier-1 spec §3 item 8).
//
// One job: show the durable tag facts the daemon already records, and let the
// operator change exactly one per-subject tag row at a time through the
// admitted `annotation.upsert` / `annotation.delete` operations.
//
// The truth rules this file enforces:
//
//   - The vocabulary is `annotation.list`: every live `TAG` annotation record
//     of the workspace. A tag row exists because the daemon returned a record
//     carrying that name, and its subject count is the number of live records
//     carrying it. A tag with zero live records is never fabricated and never
//     rendered as an empty row; the surface says that deleted names are
//     tombstoned instead.
//   - A tag name is a durable fact. This surface never normalizes, trims,
//     lowercases, or merges case variants for display or for a write: the name
//     is rendered byte-for-byte as the daemon stored it, and a write sends that
//     exact body. Two names the daemon treats as distinct stay two rows. The
//     substring filter is a view over the list only.
//   - Rename and merge are the same operation: for each subject that carries
//     the source name, add the target name and then delete the old record.
//     Nothing is rewritten in place and nothing happens before the operator
//     confirms a preview that lists every affected subject. The target is added
//     before the source is deleted, so a failure can leave a subject with both
//     names (reported exactly like that), never with neither.
//   - A partial apply is reported as a partial apply: the count that changed,
//     the count that did not, and every failed subject with its own reason and
//     its own post-failure state. The surface never claims a clean rename.
//   - Each write re-reads `annotation.list`; the rendered list is always the
//     daemon's answer, never a client-side guess.
//   - No machine suggestion is present or applied: this surface has no
//     suggestion control, and every row it renders is a durable record.
//
// The shell passes only the translator (the seam wired the view mode without a
// flow), so the surface owns its own read state and resolves the active
// workspace from the same browser-local value the shell records, falling back
// to the daemon's `status.get` projection (exactly like the duplicate review
// surface). No durable state is created here.

/** The protection outcomes the daemon's protection axis can answer. */
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

type SurfaceState = "IDLE" | "LOADING" | "READY" | "BLOCKED";

/** One live TAG record: the subject it belongs to and the record's own revision. */
export type TagSubjectRef = { subjectRef: string; annotationID: string; revision: number; updatedAt: string };

/** One tag name and the live records that carry it. */
export type TagRow = { body: string; subjects: TagSubjectRef[] };

type ProtectionRead = { status: "LOADING" | "READY"; bySubject: Record<string, string>; reason: string };
type ActionMessage = { state: "IDLE" | "RUNNING" | "DONE" | "FAILED"; text: string };

/** One planned per-subject change. Built by the preview, never by the apply. */
type RenameStep = { subjectRef: string; name: string; path: string; annotationID: string; revision: number; target: string };
/** CHANGED: both writes succeeded. UNCHANGED: the target write failed, nothing was written.
 *  TARGET_ADDED_SOURCE_REMAINS: the target was added and the old record survived. */
type RenameOutcome = "CHANGED" | "UNCHANGED" | "TARGET_ADDED_SOURCE_REMAINS";
type RenameStepReport = RenameStep & { outcome: RenameOutcome; reason: string; addedAnnotationID: string };
type RenamePreview = { source: string; target: string; steps: RenameStep[] };
type RenameReport = { source: string; target: string; steps: RenameStepReport[]; changed: number; failed: number; appliedAt: number };

function messageOf(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason ?? "");
}

/** True when the daemon's lexical projection actually answered this query. */
function lexicalAnswered(data: any) {
  const components = Array.isArray(data?.components) ? data.components : [];
  return components.some((component: any) => component?.dimension === LEXICAL_DIMENSION && component?.status === "SUCCEEDED" && Boolean(component?.index_generation_ref));
}

/** The admitted protection outcomes, labeled by the keys the duplicate review already owns. */
function protectionLabelKey(token: string) {
  if (token === "EXACT_PROTECTED") return "Exact protected";
  if (token === "EXACT_FALLBACK") return "Exact fallback (bytes still exact)";
  if (token === "EXTERNAL_REPLAYABLE") return "External replayable";
  if (token === "LINK_ONLY_UNPROTECTED") return "Link only, unprotected";
  if (token === "EXPLICITLY_UNPROTECTED") return "Explicitly unprotected";
  if (token === "BLOCKED") return "Blocked";
  if (token === "UNAVAILABLE") return "Unavailable";
  return "";
}

/**
 * The tag vocabulary of one workspace, derived from the daemon's own
 * `annotation.list` records. Only live `TAG` records become rows: a record the
 * daemon reports as tombstoned, a note, or a record without a subject can never
 * become a tag row. Every name is kept byte-for-byte and case variants stay
 * separate rows. The order is subject count descending, then name.
 */
export function tagRowsFromAnnotations(annotations: AnnotationRecord[], locale: string): TagRow[] {
  const byName = new Map<string, TagSubjectRef[]>();
  for (const record of annotations) {
    if (record.kind !== "TAG" || record.tombstoned) continue;
    const body = typeof record.body === "string" ? record.body : "";
    const subjectRef = record.subject_ref?.trim() ?? "";
    if (!body || !subjectRef) continue;
    const subjects = byName.get(body) ?? [];
    // The daemon's live-tag index admits one live record per (subject, name);
    // a duplicate would be a projection artifact, so it is collapsed here.
    if (subjects.some((subject) => subject.subjectRef === subjectRef)) continue;
    subjects.push({
      subjectRef,
      annotationID: record.annotation_id ?? "",
      revision: typeof record.revision === "number" ? record.revision : 0,
      updatedAt: record.updated_at ?? "",
    });
    byName.set(body, subjects);
  }
  return [...byName.entries()]
    .map(([body, subjects]) => ({ body, subjects: [...subjects].sort((left, right) => left.subjectRef.localeCompare(right.subjectRef)) }))
    .sort((left, right) => right.subjects.length - left.subjects.length || left.body.localeCompare(right.body, locale));
}

export type TagsSurfaceProps = {
  t: Translator;
  /**
   * Optional shell handoff for the library view. The current shell does not
   * wire it, so the surface falls back to the shell's own rail entry and says
   * so: the library has no inbound tag filter in this build.
   */
  onOpenInLibrary?: (subjectRef: string) => void;
};

export function TagsSurface({ t, onOpenInLibrary }: TagsSurfaceProps) {
  const [surfaceState, setSurfaceState] = useState<SurfaceState>("IDLE");
  const [blockedReason, setBlockedReason] = useState("");
  const [workspaceID, setWorkspaceID] = useState("");
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [items, setItems] = useState<SearchHit[]>([]);
  const [listingError, setListingError] = useState("");
  const [filter, setFilter] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [protection, setProtection] = useState<Record<string, ProtectionRead>>({});
  const [expandedSubject, setExpandedSubject] = useState("");
  const [addTarget, setAddTarget] = useState("");
  const [editAction, setEditAction] = useState<ActionMessage>({ state: "IDLE", text: "" });
  const [handoff, setHandoff] = useState("");
  const [renameTarget, setRenameTarget] = useState("");
  const [preview, setPreview] = useState<RenamePreview>();
  const [report, setReport] = useState<RenameReport>();
  const [renameAction, setRenameAction] = useState<ActionMessage>({ state: "IDLE", text: "" });
  const [rovingTagIndex, setRovingTagIndex] = useState(0);
  const [rovingSubjectIndex, setRovingSubjectIndex] = useState(0);
  const [readAt, setReadAt] = useState(0);
  const loadTokenRef = useRef(0);
  const protectionTokenRef = useRef(0);
  const tagListRef = useRef<HTMLUListElement | null>(null);
  const subjectListRef = useRef<HTMLUListElement | null>(null);

  const tagRows = useMemo(() => tagRowsFromAnnotations(annotations, document.documentElement.lang || "en"), [annotations]);
  const listingBySubject = useMemo(() => {
    const map = new Map<string, SearchHit>();
    for (const item of items) {
      const subjectRef = item.subject_ref?.trim();
      if (subjectRef) map.set(subjectRef, item);
    }
    return map;
  }, [items]);
  // The filter is a view over the rendered rows only: it never rewrites a name
  // and it never merges two rows into one.
  const visibleTags = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    if (!needle) return tagRows;
    return tagRows.filter((row) => row.body.toLocaleLowerCase().includes(needle));
  }, [filter, tagRows]);
  const selectedRow = useMemo(() => tagRows.find((row) => row.body === selectedTag), [selectedTag, tagRows]);
  const totalSubjects = useMemo(() => new Set(tagRows.flatMap((row) => row.subjects.map((subject) => subject.subjectRef))).size, [tagRows]);
  const rovingTag = visibleTags.length ? Math.min(rovingTagIndex, visibleTags.length - 1) : 0;
  const subjectCount = selectedRow?.subjects.length ?? 0;
  const rovingSubject = subjectCount ? Math.min(rovingSubjectIndex, subjectCount - 1) : 0;
  // Every subject of the loaded listing that does not yet carry the selected
  // tag is an add candidate; the daemon returns the existing record if one
  // already exists, so a stale list can never create a duplicate.
  const addCandidates = useMemo(() => {
    const carrying = new Set((selectedRow?.subjects ?? []).map((subject) => subject.subjectRef));
    return items
      .filter((item) => Boolean(item.subject_ref?.trim()) && !carrying.has(item.subject_ref?.trim() ?? ""))
      .sort((left, right) => (left.name ?? "").localeCompare(right.name ?? ""));
  }, [items, selectedRow]);
  const addTargetName = useMemo(() => {
    const item = items.find((candidate) => candidate.subject_ref?.trim() === addTarget);
    return item?.name?.trim() || addTarget;
  }, [addTarget, items]);

  async function resolveWorkspace(): Promise<{ workspaceID: string; error: string }> {
    const stored = window.localStorage.getItem("restoreweave.workspace_id")?.trim() ?? "";
    if (stored) return { workspaceID: stored, error: "" };
    // The browser-local id is a convenience the shell records after an explicit
    // publication. When it is absent, the daemon's own status projection names
    // the published workspace; this is a read.
    try {
      const response = await command(operations.status.get, {});
      const candidates = [
        response.data?.recent_plans?.[0]?.workspace_id,
        response.data?.recent_jobs?.[0]?.workspace_id,
        response.data?.index?.[0]?.workspace_id,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) return { workspaceID: candidate.trim(), error: "" };
      }
      return { workspaceID: "", error: "" };
    } catch (error) {
      return { workspaceID: "", error: messageOf(error) };
    }
  }

  async function reloadAnnotations(workspace: string) {
    const response = await command(operations.annotation.list, { workspace_id: workspace });
    setAnnotations(Array.isArray(response.data?.annotations) ? (response.data.annotations as AnnotationRecord[]) : []);
    // A write can add or remove a subject's record, so the cached protection
    // answers are stale from here on; the selection effect reads them again.
    setProtection({});
  }

  async function loadSurface() {
    const token = ++loadTokenRef.current;
    setSurfaceState((current) => (current === "READY" ? current : "LOADING"));
    const resolved = await resolveWorkspace();
    if (loadTokenRef.current !== token) return;
    if (!resolved.workspaceID) {
      setAnnotations([]);
      setItems([]);
      setSurfaceState("BLOCKED");
      setBlockedReason(resolved.error || t("No published workspace is reported by this service in this browser yet."));
      return;
    }
    setWorkspaceID(resolved.workspaceID);
    const [annotationResult, listingResult] = await Promise.allSettled([
      command(operations.annotation.list, { workspace_id: resolved.workspaceID }),
      command(operations.content.list, { workspace_id: resolved.workspaceID }),
    ]);
    if (loadTokenRef.current !== token) return;
    if (annotationResult.status !== "fulfilled") {
      // The tag facts are this surface's whole subject: a vocabulary that did
      // not answer is a blocked view, never an empty one.
      setAnnotations([]);
      setItems([]);
      setSurfaceState("BLOCKED");
      setBlockedReason(t("The durable tag vocabulary could not be read: {{message}}", { message: messageOf(annotationResult.reason) }));
      return;
    }
    setAnnotations(Array.isArray(annotationResult.value.data?.annotations) ? (annotationResult.value.data.annotations as AnnotationRecord[]) : []);
    if (listingResult.status === "fulfilled") {
      setItems(Array.isArray(listingResult.value.data?.items) ? (listingResult.value.data.items as SearchHit[]) : []);
      setListingError("");
    } else {
      // Names and provenance paths are read from the listing; without it the
      // subject rows still exist (they are durable records) but every listing
      // fact says UNKNOWN with this reason.
      setItems([]);
      setListingError(t("The workspace listing could not be read, so names and provenance paths are shown as UNKNOWN: {{message}}", { message: messageOf(listingResult.reason) }));
    }
    setSurfaceState("READY");
    setReadAt(Date.now());
  }

  // One tag's protection facts, resolved from the daemon's own protection axis
  // exactly as the duplicate review reads it. A subject whose outcome the
  // daemon did not claim renders UNKNOWN, never a guess.
  async function loadProtection(name: string, workspace: string) {
    const token = ++protectionTokenRef.current;
    setProtection((current) => ({ ...current, [name]: { status: "LOADING", bySubject: {}, reason: "" } }));
    const settled = await Promise.allSettled(PROTECTION_OUTCOMES.map((outcome) => command(operations.search.query, {
      workspace_id: workspace,
      filters: { protection_mode: outcome },
    })));
    if (protectionTokenRef.current !== token) return;
    const bySubject: Record<string, string> = {};
    let answered = false;
    let reason = "";
    PROTECTION_OUTCOMES.forEach((outcome, index) => {
      const result = settled[index];
      if (result.status !== "fulfilled") {
        if (!reason) reason = messageOf(result.reason);
        return;
      }
      if (lexicalAnswered(result.value.data)) answered = true;
      else if (!reason) reason = String(result.value.reasons?.[0]?.message ?? "");
      for (const hit of (Array.isArray(result.value.data?.hits) ? result.value.data.hits : [])) {
        const subjectRef = String(hit?.subject_ref ?? "").trim();
        if (subjectRef && !bySubject[subjectRef]) bySubject[subjectRef] = outcome;
      }
    });
    if (!answered) reason ||= t("the daemon did not report a protection generation for this workspace");
    setProtection((current) => ({ ...current, [name]: { status: "READY", bySubject, reason: answered ? "" : reason } }));
  }

  useEffect(() => {
    void loadSurface();
    // The workspace is resolved per mount; a later refresh is explicit.
  }, []);

  // The selected tag's protection facts are read once per selection; a failed
  // or unavailable read stays visible and is never retried silently. A tag
  // whose last record was removed by a rename has no subjects left to probe.
  useEffect(() => {
    if (!selectedTag || !workspaceID || !selectedRow) return;
    if (protection[selectedTag]) return;
    void loadProtection(selectedTag, workspaceID);
  }, [protection, selectedRow, selectedTag, workspaceID]);

  function resetEditPanels() {
    setPreview(undefined);
    setReport(undefined);
    setRenameTarget("");
    setRenameAction({ state: "IDLE", text: "" });
    setEditAction({ state: "IDLE", text: "" });
    setExpandedSubject("");
    setAddTarget("");
    setHandoff("");
  }

  function selectTag(name: string) {
    setSelectedTag(name);
    setRovingSubjectIndex(0);
    resetEditPanels();
  }

  function subjectName(subjectRef: string) {
    return listingBySubject.get(subjectRef)?.name?.trim() || t("UNKNOWN — not reported by this build");
  }

  function subjectPath(subjectRef: string) {
    return listingBySubject.get(subjectRef)?.path?.trim() || t("UNKNOWN — not reported by this build");
  }

  // The protection fact of one subject. Three distinct states, never conflated:
  // the axis has not answered yet (pending), it answered and did not claim an
  // outcome (UNKNOWN with its reason), or it claimed one (KNOWN).
  type ProtectionFactState = { state: "PENDING" } | { state: "UNKNOWN"; reason: string } | { state: "KNOWN"; token: string; label: string };

  function protectionFact(subjectRef: string): ProtectionFactState {
    const read = protection[selectedTag];
    if (!read || read.status !== "READY") return { state: "PENDING" };
    if (read.reason) return { state: "UNKNOWN", reason: read.reason };
    const token = read.bySubject[subjectRef] ?? "";
    const key = protectionLabelKey(token);
    if (key) return { state: "KNOWN", token, label: t(key) };
    return { state: "UNKNOWN", reason: listingError || t("Not claimed by the daemon's protection axis") };
  }

  // Add one exact tag body to one subject. The body sent is the stored name,
  // byte-for-byte; the daemon returns the existing record when the subject
  // already carries it, and that answer is reported instead of a second write.
  async function addTagToSubject() {
    const name = selectedTag;
    const subjectRef = addTarget;
    if (!workspaceID || !name || !subjectRef) return;
    const alreadyRecorded = tagRows.some((row) => row.body === name && row.subjects.some((subject) => subject.subjectRef === subjectRef));
    setEditAction({ state: "RUNNING", text: "" });
    try {
      const response = await command(operations.annotation.upsert, { workspace_id: workspaceID, subject_ref: subjectRef, kind: "TAG", body: name, expected_revision: 0 });
      const annotationID = String(response.data?.annotation?.annotation_id ?? "");
      await reloadAnnotations(workspaceID);
      setEditAction({
        state: "DONE",
        text: alreadyRecorded
          ? t("The daemon reports that {{name}} already carries this tag; the existing record {{annotation_id}} is unchanged.", { name: subjectName(subjectRef), annotation_id: annotationID || t("UNKNOWN — not reported by this build") })
          : t("Tag added to {{name}} ({{annotation_id}}).", { name: subjectName(subjectRef), annotation_id: annotationID || t("UNKNOWN — not reported by this build") }),
      });
    } catch (error) {
      setEditAction({ state: "FAILED", text: t("The tag was not added: {{message}}", { message: messageOf(error) }) });
    }
  }

  // Remove one subject's own tag record, with that record's own id and
  // revision. The daemon tombstones it; nothing else changes.
  async function removeTagFromSubject(subject: TagSubjectRef) {
    if (!workspaceID || !subject.annotationID || subject.revision < 1) return;
    setEditAction({ state: "RUNNING", text: "" });
    try {
      const response = await command(operations.annotation.delete, { workspace_id: workspaceID, annotation_id: subject.annotationID, expected_revision: subject.revision });
      const annotationID = String(response.data?.annotation?.annotation_id ?? subject.annotationID);
      await reloadAnnotations(workspaceID);
      setEditAction({ state: "DONE", text: t("Tag removed from {{name}}; the record {{annotation_id}} is tombstoned, not rewritten.", { name: subjectName(subject.subjectRef), annotation_id: annotationID }) });
    } catch (error) {
      setEditAction({ state: "FAILED", text: t("The tag was not removed: {{message}}", { message: messageOf(error) }) });
    }
  }

  // Build the plan only. No write is issued here; the preview is exactly the
  // list of subjects and records the apply will touch.
  function buildPreview() {
    const target = renameTarget;
    if (!selectedTag || !target) return;
    if (target !== target.trim() || !target.trim()) {
      // Refusing is honest: the daemon stores the body exactly, so a padded
      // name would become a different durable tag.
      setPreview(undefined);
      setReport(undefined);
      setRenameAction({ state: "FAILED", text: t("Tag names are stored exactly as written; remove the leading or trailing whitespace before previewing.") });
      return;
    }
    if (!selectedRow) return;
    setReport(undefined);
    setRenameAction({ state: "IDLE", text: "" });
    setPreview({
      source: selectedTag,
      target,
      steps: selectedRow.subjects.map((subject) => ({
        subjectRef: subject.subjectRef,
        name: subjectName(subject.subjectRef),
        path: subjectPath(subject.subjectRef),
        annotationID: subject.annotationID,
        revision: subject.revision,
        target,
      })),
    });
  }

  // Apply the previewed plan, one subject at a time. The target is added
  // before the source is deleted so a failure leaves both names visible rather
  // than neither; every outcome is recorded and reported.
  async function applyPreview() {
    const plan = preview;
    if (!workspaceID || !plan) return;
    setRenameAction({ state: "RUNNING", text: "" });
    const reports: RenameStepReport[] = [];
    for (const step of plan.steps) {
      let addedAnnotationID = "";
      try {
        const response = await command(operations.annotation.upsert, { workspace_id: workspaceID, subject_ref: step.subjectRef, kind: "TAG", body: step.target, expected_revision: 0 });
        addedAnnotationID = String(response.data?.annotation?.annotation_id ?? "");
      } catch (error) {
        // Nothing was written for this subject: its tag rows are untouched.
        reports.push({ ...step, outcome: "UNCHANGED", reason: messageOf(error), addedAnnotationID: "" });
        continue;
      }
      try {
        await command(operations.annotation.delete, { workspace_id: workspaceID, annotation_id: step.annotationID, expected_revision: step.revision });
        reports.push({ ...step, outcome: "CHANGED", reason: "", addedAnnotationID });
      } catch (error) {
        reports.push({ ...step, outcome: "TARGET_ADDED_SOURCE_REMAINS", reason: messageOf(error), addedAnnotationID });
      }
    }
    const changed = reports.filter((step) => step.outcome === "CHANGED").length;
    const failed = reports.length - changed;
    setReport({ source: plan.source, target: plan.target, steps: reports, changed, failed, appliedAt: Date.now() });
    setPreview(undefined);
    setRenameAction({
      state: failed ? "FAILED" : "DONE",
      text: failed
        ? t("{{changed}} of {{requested}} subjects changed; {{failed}} failed and are listed below with their own reasons. A failed subject is left unchanged or carries both names, exactly as listed — this is not a clean rename.", { changed, requested: reports.length, failed })
        : t("All {{changed}} subjects changed.", { changed }),
    });
    try {
      await reloadAnnotations(workspaceID);
    } catch {
      // The apply already happened; a failed re-read is reported, never
      // presented as a rollback.
      setRenameAction({ state: "FAILED", text: t("The change was applied, but the tag vocabulary could not be read back: refresh to see the daemon's current records.") });
    }
  }

  // Reversibility without a second write: the reverse plan is the same
  // per-subject pair with the names swapped, and it must be previewed and
  // confirmed again.
  function prepareReverse() {
    if (!report || report.changed === 0) return;
    setSelectedTag(report.target);
    setRovingSubjectIndex(0);
    setExpandedSubject("");
    setAddTarget("");
    setHandoff("");
    setPreview(undefined);
    setRenameTarget(report.source);
    setRenameAction({ state: "IDLE", text: t("The reverse change is prepared below. Preview it, then confirm it to restore the previous name on the subjects that changed.") });
  }

  // Opening the library is a handoff the shell owns. The current shell does not
  // wire it into this view, so the surface uses the shell's own rail entry and
  // states the limitation instead of pretending the library opened the subject.
  function openInLibrary(subjectRef: string) {
    if (onOpenInLibrary) {
      onOpenInLibrary(subjectRef);
      setHandoff(t("The shell handed this subject to the library view."));
      return;
    }
    const entries = Array.from(document.querySelectorAll<HTMLButtonElement>(".workspace-sidebar .workspace-nav-item"));
    const libraryEntry = entries.find((entry) => entry.querySelector("span")?.textContent?.trim() === t("Library"));
    if (!libraryEntry) {
      setHandoff(t("The library view could not be opened from this surface in this build."));
      return;
    }
    libraryEntry.click();
    setHandoff(t("The library view was opened through the navigation rail. This build's library has no inbound tag filter, so this tag's subject set stays listed here."));
  }

  // One tab stop per list, with the library's roving-tabindex pattern: arrow
  // keys move focus between rows, Home/End jump, Enter activates the focused
  // control, and Escape returns focus to the rail entry.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      document.querySelector<HTMLButtonElement>('button[data-view="tags"]')?.focus();
      return;
    }
    const target = event.target as HTMLElement | null;
    const tagRow = target?.closest<HTMLElement>("[data-tag-index]");
    if (tagRow) {
      const current = Number(tagRow.dataset.tagIndex ?? "-1");
      if (!Number.isInteger(current) || current < 0 || current >= visibleTags.length) return;
      const move = (next: number) => {
        setRovingTagIndex(next);
        tagListRef.current?.querySelector<HTMLElement>(`[data-tag-index="${next}"] .tag-row-button`)?.focus();
      };
      if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); move(Math.min(current + 1, visibleTags.length - 1)); return; }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); move(Math.max(current - 1, 0)); return; }
      if (event.key === "Home") { event.preventDefault(); move(0); return; }
      if (event.key === "End") { event.preventDefault(); move(visibleTags.length - 1); return; }
      return;
    }
    const subjectRow = target?.closest<HTMLElement>("[data-subject-index]");
    if (subjectRow) {
      const current = Number(subjectRow.dataset.subjectIndex ?? "-1");
      if (!Number.isInteger(current) || current < 0 || current >= subjectCount) return;
      const move = (next: number) => {
        setRovingSubjectIndex(next);
        subjectListRef.current?.querySelector<HTMLElement>(`[data-subject-index="${next}"] .tag-subject-toggle`)?.focus();
      };
      if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); move(Math.min(current + 1, subjectCount - 1)); return; }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); move(Math.max(current - 1, 0)); return; }
      if (event.key === "Home") { event.preventDefault(); move(0); return; }
      if (event.key === "End") { event.preventDefault(); move(subjectCount - 1); }
    }
  }

  const blocked = surfaceState === "BLOCKED";
  const scopeLabel = t("{{tags}} tags over {{subjects}} subjects with a live record", { tags: tagRows.length, subjects: totalSubjects });
  // The heading of the detail pane: the selected tag, or — when a rename or
  // merge removed its last record — the name the applied record still reports.
  const detailName = selectedRow ? selectedRow.body : report?.source ?? "";

  return <section
    className="content-column tags-surface"
    aria-label={t("Tags")}
    data-view="tags"
    data-state={surfaceState}
    data-partial={report && report.failed > 0 ? "true" : "false"}
    data-workspace-id={workspaceID}
    data-tag-count={tagRows.length}
    onKeyDown={handleKeyDown}
  >
    <div className="workspace-heading">
      <div>
        <p className="eyebrow">{t("WORKSPACE")}</p>
        <h1>{t("Tags")}</h1>
      </div>
      <div className="heading-actions">
        <span className="result-count tags-scope" data-summary-source="annotation.list" data-tag-count={tagRows.length} data-subject-count={totalSubjects}>{scopeLabel}</span>
        <button type="button" className="icon-button" data-action="refresh" title={t("Refresh tag vocabulary")} aria-label={t("Refresh tag vocabulary")} onClick={() => void loadSurface()}><RefreshCw size={15} /></button>
      </div>
    </div>
    <p className="tags-note">{t("Every row here is a durable TAG annotation record the daemon returned for this workspace. The name is the stored body, shown exactly as recorded; this surface never normalizes, lowercases, or merges two names, and it applies no machine suggestion.")}</p>
    <p className="tags-note tags-contract">{t("A rename or merge is a previewed sequence of per-subject writes: the new name is added, then the old record is deleted. Nothing is rewritten in place, and the preview lists every subject before any write is issued.")}</p>

    {blocked
      ? <div className="tags-blocked" data-state="BLOCKED" role="alert"><AlertCircle size={16} /><div><strong>{t("Tags are not readable right now")}</strong><small data-blocked-reason={blockedReason}>{blockedReason}</small></div></div>
      : surfaceState === "LOADING" || surfaceState === "IDLE"
        ? <p className="tags-loading" data-state="LOADING" role="status">{t("Reading the durable tag vocabulary…")}</p>
        : tagRows.length === 0
          ? <div className="empty-state tags-empty" data-empty="true">
            <span className="vault-sigil"><TagsIcon size={35} /></span>
            <h2>{t("No live tag is recorded in this workspace yet")}</h2>
            <p>{t("This list reads the daemon's live TAG annotation records only: a name appears while at least one subject carries it, and a deleted tag is tombstoned instead of being kept as an empty row. Adding a tag to a subject in the library inspector, in the duplicate review, or in this surface's per-subject controls creates the first record.")}</p>
          </div>
          : <div className="tags-layout">
            <div className="tags-list-pane">
              <label className="tags-filter">
                <span>{t("Filter tag names")}</span>
                <input type="search" value={filter} placeholder={t("Filter by substring")} aria-label={t("Filter tag names")} onChange={(event) => { setFilter(event.target.value); setRovingTagIndex(0); }} />
              </label>
              <p className="tags-filter-note" data-filtered-tags={visibleTags.length} data-total-tags={tagRows.length}>{t("Showing {{shown}} of {{total}} tags. Filtering matches a substring of the stored name; it never rewrites or merges a name.", { shown: visibleTags.length, total: tagRows.length })}</p>
              <ul className="tag-rows" aria-label={t("Tag names with their subject counts")} aria-description={t("Use the arrow keys to move between tags, Enter to open a tag's subjects, and Escape to return to the navigation rail.")} ref={tagListRef}>
                {visibleTags.map((row, index) => <li
                  className="tag-row"
                  key={row.body}
                  data-tag-body={row.body}
                  data-subject-count={row.subjects.length}
                  data-tag-index={index}
                  data-selected={row.body === selectedTag ? "true" : "false"}
                >
                  <button
                    type="button"
                    className="tag-row-button"
                    data-action="select-tag"
                    tabIndex={index === rovingTag ? 0 : -1}
                    aria-pressed={row.body === selectedTag}
                    aria-label={t("Tag {{name}}, {{count}} subjects", { name: row.body, count: row.subjects.length })}
                    onClick={() => selectTag(row.body)}
                  >
                    <span className="tag-body" data-fact="tag-body">{row.body}</span>
                    <span className="tag-count" data-fact="subject-count">{row.subjects.length === 1 ? t("{{count}} subject", { count: row.subjects.length }) : t("{{count}} subjects", { count: row.subjects.length })}</span>
                  </button>
                </li>)}
              </ul>
              {visibleTags.length === 0 && <p className="tags-filter-empty" data-empty-filter="true">{t("No stored tag name contains this substring. Nothing was rewritten or merged by filtering.")}</p>}
            </div>
            <div className="tags-detail-pane">
              {!selectedRow && !report
                ? <p className="tags-detail-hint" data-detail-state="NONE">{t("Select a tag to see the subjects that carry it and the per-subject controls.")}</p>
                : <>
                  <div className="tags-detail-heading">
                    <h2 data-fact="selected-tag">{detailName}</h2>
                    <span className="tags-detail-count" data-fact="selected-tag-count">{selectedRow
                      ? (selectedRow.subjects.length === 1 ? t("{{count}} subject carries this tag", { count: selectedRow.subjects.length }) : t("{{count}} subjects carry this tag", { count: selectedRow.subjects.length }))
                      : t("This name has no live record left; the applied record below names every subject the change touched.")}</span>
                  </div>
                  {selectedRow && <p className="tags-detail-note">{t("This tag name is the stored body. The identity of a tag row is that exact name plus the subject's own record, so two names that differ only in case stay two separate rows.")}</p>}
                  {selectedRow && <p className="tags-detail-note">{t("The library opens through this shell's navigation rail, and this build's library applies no inbound tag filter, so this tag's subject set stays listed here.")}</p>}
                  {listingError && <p className="tags-listing-warning" role="status">{listingError}</p>}
                  {selectedRow && <ul className="tag-subject-rows" aria-label={t("Subjects carrying {{name}}", { name: selectedRow.body })} ref={subjectListRef}>
                    {selectedRow.subjects.map((subject, index) => {
                      const fact = protectionFact(subject.subjectRef);
                      const expanded = expandedSubject === subject.subjectRef;
                      const protectionText = fact.state === "PENDING"
                        ? t("Protection: reading the daemon's protection axis…")
                        : fact.state === "KNOWN"
                          ? t("Protection: {{label}} ({{token}})", { label: fact.label, token: fact.token })
                          : t("Protection: UNKNOWN — {{reason}}", { reason: fact.reason });
                      return <li
                        className="tag-subject-row"
                        key={subject.subjectRef}
                        data-subject-ref={subject.subjectRef}
                        data-subject-index={index}
                        data-protection-state={fact.state === "KNOWN" ? fact.token : "UNKNOWN"}
                        data-protection-known={fact.state === "KNOWN" ? "true" : "false"}
                        data-protection-pending={fact.state === "PENDING" ? "true" : "false"}
                        data-annotation-id={subject.annotationID}
                        data-revision={subject.revision}
                      >
                        <button
                          type="button"
                          className="tag-subject-toggle"
                          data-action="toggle-subject"
                          tabIndex={index === rovingSubject ? 0 : -1}
                          aria-expanded={expanded}
                          aria-label={t("Subject {{name}}", { name: subjectName(subject.subjectRef) })}
                          onClick={() => setExpandedSubject((current) => current === subject.subjectRef ? "" : subject.subjectRef)}
                        >
                          <span className="tag-subject-name" data-fact="name">{subjectName(subject.subjectRef)}</span>
                          <span className="tag-subject-path" data-fact="path">{subjectPath(subject.subjectRef)}</span>
                          <span className="tag-subject-protection" data-fact="protection">{protectionText}</span>
                          <span className="tag-subject-record" data-fact="record">{t("Record {{annotation_id}} · revision {{revision}}", { annotation_id: subject.annotationID || t("UNKNOWN — not reported by this build"), revision: subject.revision || t("UNKNOWN — not reported by this build") })}</span>
                        </button>
                        <div className="tag-subject-actions">
                          <button type="button" className="secondary-button compact" data-action="open-in-library" onClick={() => openInLibrary(subject.subjectRef)}><ExternalLink size={13} />{t("Open in library")}</button>
                          <button
                            type="button"
                            className="secondary-button compact"
                            data-action="remove-subject-tag"
                            disabled={!subject.annotationID || subject.revision < 1 || editAction.state === "RUNNING"}
                            title={!subject.annotationID || subject.revision < 1 ? t("This record reports no annotation id or revision, so it cannot be changed from here.") : t("Remove this tag from this subject")}
                            onClick={() => void removeTagFromSubject(subject)}
                          >{t("Remove tag from this subject")}</button>
                        </div>
                        {expanded && <dl className="tag-subject-facts">
                          <div><dt>{t("Subject reference")}</dt><dd data-fact="subject-ref">{subject.subjectRef}</dd></div>
                          <div><dt>{t("Tag record")}</dt><dd data-fact="annotation-id">{subject.annotationID || t("UNKNOWN — not reported by this build")}</dd></div>
                          <div><dt>{t("Record revision")}</dt><dd data-fact="revision">{subject.revision || t("UNKNOWN — not reported by this build")}</dd></div>
                          <div><dt>{t("Record updated at")}</dt><dd data-fact="updated-at">{subject.updatedAt || t("UNKNOWN — not reported by this build")}</dd></div>
                          <div><dt>{t("Protection state")}</dt><dd data-fact="protection-detail">{fact.state === "PENDING"
                            ? t("Protection: reading the daemon's protection axis…")
                            : fact.state === "KNOWN" ? `${fact.label} (${fact.token})` : t("UNKNOWN — {{reason}}", { reason: fact.reason })}</dd></div>
                          <div><dt>{t("Provenance path")}</dt><dd data-fact="path-detail">{subjectPath(subject.subjectRef)}</dd></div>
                        </dl>}
                      </li>;
                    })}
                  </ul>}

                  {selectedRow && <div className="tags-add" data-add-candidates={addCandidates.length}>
                    <h3>{t("Add this tag to one subject")}</h3>
                    {addCandidates.length === 0
                      ? <p className="tags-add-empty">{t("Every subject in the loaded listing already carries this tag, so there is nothing to add. The daemon would return the existing record anyway.")}</p>
                      : <>
                        <label className="tags-add-field"><span>{t("Subject")}</span>
                          <select value={addTarget} aria-label={t("Subject to add {{name}} to", { name: selectedRow.body })} onChange={(event) => setAddTarget(event.target.value)}>
                            <option value="">{t("Select a subject")}</option>
                            {addCandidates.map((candidate) => {
                              const subjectRef = candidate.subject_ref?.trim() ?? "";
                              return <option key={subjectRef} value={subjectRef}>{candidate.name?.trim() || subjectRef}</option>;
                            })}
                          </select>
                        </label>
                        <button type="button" className="primary-button compact" data-action="add-tag-subject" disabled={!addTarget || editAction.state === "RUNNING"} onClick={() => void addTagToSubject()}>{t("Add tag to {{name}}", { name: addTargetName })}</button>
                      </>}
                    {editAction.text && <p className="tags-edit-action" data-action-state={editAction.state} role="status">{editAction.text}</p>}
                  </div>}

                  {selectedRow && <section className="tags-rename" data-rename-state={renameAction.state} aria-label={t("Rename or merge {{name}}", { name: selectedRow.body })}>
                    <h3>{t("Rename or merge this tag")}</h3>
                    <p className="tags-rename-note">{t("Both are the same operation: add the new name to each subject, then delete the old record. The preview lists exactly which records change before anything is written, and what was applied stays visible afterwards.")}</p>
                    <label className="tags-rename-field"><span>{t("New name (an existing name merges into it)")}</span>
                      <input type="text" value={renameTarget} placeholder={t("New tag name")} aria-label={t("New name for {{name}}", { name: selectedRow.body })} onChange={(event) => { setRenameTarget(event.target.value); setPreview(undefined); setRenameAction({ state: "IDLE", text: "" }); }} />
                    </label>
                    <div className="tags-rename-actions">
                      <button type="button" className="secondary-button compact" data-action="preview-rename" disabled={!renameTarget || renameAction.state === "RUNNING"} onClick={() => buildPreview()}>{t("Preview the change")}</button>
                    </div>

                    {preview && <div className="tags-preview" data-preview-target={preview.target} data-preview-count={preview.steps.length} data-writes-issued="0">
                      <p className="tags-preview-heading">{t("Preview only — {{count}} subjects and their records would change. No write has been issued yet.", { count: preview.steps.length })}</p>
                      <ul className="tags-preview-rows">
                        {preview.steps.map((step) => <li className="tags-preview-row" key={step.subjectRef} data-preview-row="true" data-subject-ref={step.subjectRef} data-annotation-id={step.annotationID} data-revision={step.revision}>
                          <span data-fact="preview-name">{step.name}</span>
                          <span data-fact="preview-path">{step.path}</span>
                          <span data-fact="preview-change">{t("{{from}} → {{to}}", { from: preview.source, to: preview.target })}</span>
                        </li>)}
                      </ul>
                      {preview.steps.length !== selectedRow.subjects.length && <p className="tags-preview-warning">{t("The tag's subject count changed after this preview was built; preview again before applying.")}</p>}
                      <div className="tags-preview-actions">
                        <button type="button" className="primary-button compact" data-action="apply-rename" disabled={renameAction.state === "RUNNING"} onClick={() => void applyPreview()}>{t("Confirm and apply to {{count}} subjects", { count: preview.steps.length })}</button>
                        <button type="button" className="secondary-button compact" data-action="discard-preview" disabled={renameAction.state === "RUNNING"} onClick={() => { setPreview(undefined); setRenameAction({ state: "IDLE", text: "" }); }}>{t("Discard the preview")}</button>
                      </div>
                    </div>}
                  </section>}

                  {renameAction.text && <p className="tags-rename-action" data-action-state={renameAction.state} role="status">{renameAction.text}</p>}

                  {report && <div className="tags-applied" data-applied-changed={report.changed} data-applied-failed={report.failed} data-partial={report.failed > 0 ? "true" : "false"} data-applied-source={report.source} data-applied-target={report.target}>
                      <p className="tags-applied-heading">{t("Applied record — {{changed}} of {{requested}} subjects changed, {{failed}} failed.", { changed: report.changed, requested: report.steps.length, failed: report.failed })}</p>
                      {report.failed > 0
                        ? <div className="tags-applied-partial" data-state="PARTIAL" role="alert">
                          <AlertCircle size={15} />
                          <div>
                            <strong>{t("This was not a clean rename")}</strong>
                            <small>{t("The subjects below were left unchanged or carry both names, exactly as each row states. No rollback is attempted or claimed.")}</small>
                          </div>
                        </div>
                        : <p className="tags-applied-complete">{t("Every subject listed below now carries the new name and no longer carries the old one.")}</p>}
                      <ul className="tags-applied-rows">
                        {report.steps.map((step) => <li
                          className="tags-applied-row"
                          key={step.subjectRef}
                          data-applied-row="true"
                          data-subject-ref={step.subjectRef}
                          data-outcome={step.outcome}
                          data-reason={step.reason}
                        >
                          <span data-fact="applied-name">{step.name}</span>
                          <span data-fact="applied-path">{step.path}</span>
                          <span data-fact="applied-outcome">{step.outcome === "CHANGED"
                            ? t("Changed: {{from}} removed, {{to}} added (record {{annotation_id}})", { from: report.source, to: report.target, annotation_id: step.addedAnnotationID || t("UNKNOWN — not reported by this build") })
                            : step.outcome === "UNCHANGED"
                              ? t("Left unchanged: nothing was written; {{from}} is still recorded, and the new name was not added.", { from: report.source })
                              : t("Not clean: {{to}} was added (record {{annotation_id}}), and {{from}} is still recorded on this subject.", { from: report.source, to: report.target, annotation_id: step.addedAnnotationID || t("UNKNOWN — not reported by this build") })}</span>
                          {step.reason && <span className="tags-applied-reason" data-fact="applied-reason">{t("Reason reported by the service: {{message}}", { message: step.reason })}</span>}
                        </li>)}
                      </ul>
                      <p className="tags-applied-note">{t("Only the subjects listed here were written. Every other subject keeps its previous records; the reverse change is available below and is again previewed before it is applied.")}</p>
                      <button type="button" className="secondary-button compact" data-action="prepare-reverse" disabled={report.changed === 0} onClick={() => prepareReverse()}><Undo2 size={13} />{t("Prepare the reverse change")}</button>
                    </div>}

                    {report && report.failed > 0 && <ul className="tags-failed-subjects" aria-label={t("Subjects the change did not complete for")}>
                      {report.steps.filter((step) => step.outcome !== "CHANGED").map((step) => <li key={step.subjectRef} data-failed-row="true" data-subject-ref={step.subjectRef}>
                        {t("{{name}} ({{subject_ref}}) was not changed: {{reason}}", { name: step.name, subject_ref: step.subjectRef, reason: step.reason || t("UNKNOWN — not reported by this build") })}
                      </li>)}
                    </ul>}

                  {handoff && <p className="tags-handoff" role="status" data-handoff="LIBRARY">{handoff}</p>}
                </>}
            </div>
          </div>}
    <p className="tags-read-at" data-read-at={readAt || ""}>{readAt
      ? t("Tag vocabulary read at {{time}} (this browser)", { time: new Date(readAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })
      : t("The tag vocabulary has not been read in this browser yet")}</p>
  </section>;
}
