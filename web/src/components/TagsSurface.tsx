import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertCircle, ExternalLink, RefreshCw, Tags as TagsIcon, Undo2 } from "lucide-react";
import { command } from "../app/command";
import { operations } from "../lib/operations";
import { lexicalProtectionAxisAnswered, PROTECTION_OUTCOMES, projectProtectionAxis } from "../lib/protectionAxis";
import { workspaceIDFromStatus } from "../lib/workspace";
import type { Translator } from "../i18n";
import type { AnnotationRecord, SearchHit } from "../lib/types";

// The tags surface (Tier-1 spec §3 item 8).
//
// One job: show the durable tag facts the daemon already records, let the
// operator change exactly one per-subject tag row at a time through the
// admitted `annotation.upsert` / `annotation.delete` operations, and rename or
// merge one tag through the daemon's reviewed plan/apply pair.
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
//   - Rename and merge are one daemon operation pair, not a client loop:
//     `annotation.tag_plan` is read-only and returns every affected subject with
//     the exact ordered changes, the explicit no-op cases, and the canonical
//     plan digest; `annotation.tag_apply` carries that digest, re-derives the
//     plan, refuses a digest that no longer matches (nothing written), and
//     performs the per-subject pairs. This surface renders the daemon's plan
//     before any write and the daemon's per-subject outcomes after it; it never
//     issues the per-subject rename writes itself.
//   - The plan states the order the daemon follows: add the target name first,
//     then tombstone the source record. A subject that already carries the
//     target keeps an explicit no-op add. An interruption between the two steps
//     therefore leaves both names rather than neither, and the apply reports
//     that subject exactly so.
//   - A partial apply is reported as a partial apply, using the daemon's own
//     counts and reasons: the subjects that changed, the subject nothing was
//     written for, and the subjects left carrying both names. The surface never
//     claims a clean rename, and it never claims a rollback.
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

type SurfaceState = "IDLE" | "LOADING" | "READY" | "BLOCKED";

/** One live TAG record: the subject it belongs to and the record's own revision. */
export type TagSubjectRef = { subjectRef: string; annotationID: string; revision: number; updatedAt: string };

/** One tag name and the live records that carry it. */
export type TagRow = { body: string; subjects: TagSubjectRef[] };

type ProtectionRead = { status: "LOADING" | "READY"; bySubject: Record<string, string>; reason: string };
type ActionMessage = { state: "IDLE" | "RUNNING" | "DONE" | "FAILED"; text: string };

/** One change the daemon's plan would issue for one subject, verbatim. */
export type TagPlanChangeFact = { action: string; body: string; noop: boolean; annotationID: string; expectedRevision: number };
/** One subject's ordered changes. The daemon plans the add before the tombstone. */
export type TagPlanSubjectFact = { subjectRef: string; changes: TagPlanChangeFact[] };
/** The daemon's `annotation.tag_plan` answer: read the digest, then confirm it. */
export type TagPlanFact = { from: string; to: string; digest: string; subjects: TagPlanSubjectFact[]; remaining: number; noopSubjects: number };
/**
 * One subject's outcome the daemon reported after apply.
 *   CHANGED:     the subject carries the new name and no longer the old one.
 *   UNCHANGED:   nothing was written for that subject.
 *   TARGET_ADDED_SOURCE_REMAINS: the subject carries both names.
 * Any other token is rendered verbatim as the daemon's own answer.
 */
export type TagApplyOutcomeFact = { subjectRef: string; outcome: string; targetAnnotationID: string; targetCreated: boolean; sourceAnnotationID: string; sourceTombstoned: boolean; reason: string };
/** The daemon's `annotation.tag_apply` answer, including its own refusals. */
export type TagApplyReportFact = {
  from: string; to: string; digest: string;
  outcomes: TagApplyOutcomeFact[];
  changed: number; unchanged: number; sourceRemains: number; failed: number;
  partial: boolean; applied: boolean; degraded: boolean; message: string; appliedAt: number;
};

function messageOf(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason ?? "");
}

/** Reads one daemon change verbatim; an absent fact stays absent, never guessed. */
function planChangeFromPayload(raw: any): TagPlanChangeFact {
  return {
    action: String(raw?.action ?? ""),
    body: String(raw?.body ?? ""),
    noop: raw?.noop === true,
    annotationID: String(raw?.annotation_id ?? ""),
    expectedRevision: typeof raw?.expected_revision === "number" ? raw.expected_revision : 0,
  };
}

/** Reads the daemon's plan answer. A malformed answer is rejected, not patched. */
function planFromResponse(data: any): TagPlanFact {
  const subjects = Array.isArray(data?.subjects) ? data.subjects : [];
  return {
    from: String(data?.from ?? ""),
    to: String(data?.to ?? ""),
    digest: String(data?.plan_digest ?? ""),
    remaining: typeof data?.remaining_subjects === "number" ? data.remaining_subjects : subjects.length,
    noopSubjects: typeof data?.noop_subjects === "number" ? data.noop_subjects : 0,
    subjects: subjects.map((subject: any) => ({
      subjectRef: String(subject?.subject_ref ?? ""),
      changes: (Array.isArray(subject?.changes) ? subject.changes : []).map(planChangeFromPayload),
    })),
  };
}

/** Reads the daemon's apply answer, including the outcome of every subject. */
function applyReportFromResponse(request: { from: string; to: string; digest: string }, response: { status?: string; data?: any; reasons?: Array<{ message?: string }> }): TagApplyReportFact {
  const data = response.data ?? {};
  const outcomes = Array.isArray(data?.subjects) ? data.subjects : [];
  return {
    from: String(data?.from ?? request.from),
    to: String(data?.to ?? request.to),
    digest: String(data?.plan_digest ?? request.digest),
    changed: Number(data?.changed ?? 0),
    unchanged: Number(data?.unchanged ?? 0),
    sourceRemains: Number(data?.source_remains ?? 0),
    failed: Number(data?.failed ?? 0),
    partial: data?.partial === true || Number(data?.failed ?? 0) > 0,
    applied: data?.applied === true,
    degraded: response.status === "DEGRADED",
    message: String(response.reasons?.[0]?.message ?? ""),
    appliedAt: Date.now(),
    outcomes: outcomes.map((outcome: any) => ({
      subjectRef: String(outcome?.subject_ref ?? ""),
      outcome: String(outcome?.outcome ?? ""),
      targetAnnotationID: String(outcome?.target_annotation_id ?? ""),
      targetCreated: outcome?.target_created === true,
      sourceAnnotationID: String(outcome?.source_annotation_id ?? ""),
      sourceTombstoned: outcome?.source_tombstoned === true,
      reason: String(outcome?.reason ?? ""),
    })),
  };
}

/** True when the daemon's lexical projection actually answered this query. */
const lexicalAnswered = lexicalProtectionAxisAnswered;

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
  const [tagPlan, setTagPlan] = useState<TagPlanFact>();
  const [applyReport, setApplyReport] = useState<TagApplyReportFact>();
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
    const stored = window.localStorage.getItem("cairn.workspace_id")?.trim() ?? "";
    if (stored) return { workspaceID: stored, error: "" };
    // The browser-local id is a convenience the shell records after an explicit
    // publication. When it is absent, the daemon's own status projection names
    // the published workspace; this is a read.
    try {
      const response = await command(operations.status.get, {});
      return { workspaceID: workspaceIDFromStatus(response.data), error: "" };
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
      setBlockedReason(resolved.error || t("This service has not reported any published content in this browser yet."));
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
      setListingError(t("The content listing could not be read, so names and provenance paths are shown as UNKNOWN: {{message}}", { message: messageOf(listingResult.reason) }));
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
    const axis = projectProtectionAxis(settled, PROTECTION_OUTCOMES, messageOf, t("the daemon did not report a protection generation for the content here"));
    setProtection((current) => ({ ...current, [name]: { status: "READY", bySubject: Object.fromEntries(axis.bySubject), reason: axis.answered ? "" : axis.reason } }));
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
    setTagPlan(undefined);
    setApplyReport(undefined);
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

  // Ask the daemon for the plan. This is a read-only operation: the plan
  // carries every affected subject, the ordered add-then-tombstone changes,
  // the explicit no-op cases, and the digest the apply is bound to. Nothing is
  // written here, and the surface never builds a plan of its own.
  async function requestPlan() {
    const target = renameTarget;
    if (!selectedTag || !target || !workspaceID) return;
    if (target !== target.trim() || !target.trim()) {
      // Refusing is honest: the daemon stores the body exactly, so a padded
      // name would become a different durable tag.
      setTagPlan(undefined);
      setApplyReport(undefined);
      setRenameAction({ state: "FAILED", text: t("Tag names are stored exactly as written; remove the leading or trailing whitespace before previewing.") });
      return;
    }
    setRenameAction({ state: "RUNNING", text: "" });
    try {
      const response = await command(operations.annotation.tagPlan, { workspace_id: workspaceID, from: selectedTag, to: target });
      const plan = planFromResponse(response.data);
      if (!plan.digest) {
        setTagPlan(undefined);
        setRenameAction({ state: "FAILED", text: t("The service returned a plan without a digest; nothing can be confirmed from it, so nothing was written.") });
        return;
      }
      setApplyReport(undefined);
      setTagPlan(plan);
      setRenameAction({
        state: "IDLE",
        text: plan.remaining === 0
          ? t("The service planned zero remaining changes for this pair: no subject still carries the old name, so there is nothing to apply.")
          : t("The service planned {{count}} subjects. Review the plan and its digest, then confirm it to apply.", { count: plan.remaining }),
      });
    } catch (error) {
      setTagPlan(undefined);
      setApplyReport(undefined);
      setRenameAction({ state: "FAILED", text: t("The service did not return a plan: {{message}}", { message: messageOf(error) }) });
    }
  }

  // Apply the daemon's plan by its digest. The daemon re-derives the plan,
  // refuses a digest that no longer matches (a typed conflict that wrote
  // nothing), and otherwise performs the per-subject add-then-tombstone pairs,
  // returning one outcome per subject. The surface only reports those answers.
  async function applyPlan() {
    const plan = tagPlan;
    if (!workspaceID || !plan || !plan.digest) return;
    setRenameAction({ state: "RUNNING", text: "" });
    let response: { status?: string; data?: any; reasons?: Array<{ message?: string }> };
    try {
      response = await command(operations.annotation.tagApply, { workspace_id: workspaceID, from: plan.from, to: plan.to, plan_digest: plan.digest });
    } catch (error) {
      // The daemon refused the apply (for example a digest that no longer
      // matches). Nothing was written; the surface says exactly that and keeps
      // the stale plan visible rather than pretending a rename happened.
      setRenameAction({
        state: "FAILED",
        text: t("The service refused this apply and wrote nothing: {{message}} The service no longer reports the facts this plan was bound to, so plan the change again before applying.", { message: messageOf(error) }),
      });
      try {
        await reloadAnnotations(workspaceID);
      } catch {
        // A failed re-read after a refusal is reported, never hidden.
      }
      return;
    }
    const report = applyReportFromResponse({ from: plan.from, to: plan.to, digest: plan.digest }, response);
    setApplyReport(report);
    setTagPlan(undefined);
    setRenameAction({
      state: report.partial ? "FAILED" : "DONE",
      text: report.partial
        ? t("{{changed}} of {{requested}} subjects changed; {{failed}} failed and are listed below with their own reasons. A failed subject is left unchanged or carries both names, exactly as listed — this is not a clean rename.", { changed: report.changed, requested: report.outcomes.length, failed: report.failed })
        : t("All {{changed}} subjects changed.", { changed: report.changed }),
    });
    try {
      await reloadAnnotations(workspaceID);
    } catch {
      // The apply already happened; a failed re-read is reported, never
      // presented as a rollback.
      setRenameAction({ state: "FAILED", text: t("The change was applied, but the tag vocabulary could not be read back: refresh to see the daemon's current records.") });
    }
  }

  // The reverse change is the same operation pair with the names swapped. It is
  // prepared here and must be planned and confirmed again like any other
  // change: nothing claims an automatic rollback.
  function prepareReverse() {
    if (!applyReport || applyReport.changed === 0) return;
    setSelectedTag(applyReport.to);
    setRovingSubjectIndex(0);
    setExpandedSubject("");
    setAddTarget("");
    setHandoff("");
    setTagPlan(undefined);
    setRenameTarget(applyReport.from);
    setRenameAction({ state: "IDLE", text: t("The reverse change is prepared below. Ask the service to plan it, then confirm it to restore the previous name on the subjects that changed.") });
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
  // merge removed its last record — the source name the applied record names.
  const detailName = selectedRow ? selectedRow.body : applyReport?.from ?? "";

  // The daemon's per-subject outcome token rendered honestly. The three
  // admitted tokens get the surface's long-standing wording; any other token
  // is shown verbatim rather than described as one of them.
  function outcomeText(outcome: TagApplyOutcomeFact) {
    const from = applyReport?.from ?? "";
    const to = applyReport?.to ?? "";
    const record = outcome.targetAnnotationID || t("UNKNOWN — not reported by this build");
    if (outcome.outcome === "CHANGED") return t("Changed: {{from}} is tombstoned and {{to}} is recorded (record {{annotation_id}})", { from, to, annotation_id: record });
    if (outcome.outcome === "UNCHANGED") return t("Left unchanged: nothing was written for this subject; {{from}} is still recorded, and {{to}} was not added.", { from, to });
    if (outcome.outcome === "TARGET_ADDED_SOURCE_REMAINS") return t("Not clean: {{to}} is recorded (record {{annotation_id}}), and {{from}} is still recorded on this subject.", { from, to, annotation_id: record });
    return t("Outcome reported by the service: {{outcome}}", { outcome: outcome.outcome || t("UNKNOWN — not reported by this build") });
  }

  return <section
    className="content-column tags-surface"
    aria-label={t("Tags")}
    data-view="tags"
    data-state={surfaceState}
    data-partial={applyReport?.partial ? "true" : "false"}
    data-workspace-id={workspaceID}
    data-tag-count={tagRows.length}
    onKeyDown={handleKeyDown}
  >
    <div className="workspace-heading">
      <div>
        <p className="eyebrow">{t("CONTENT")}</p>
        <h1>{t("Tags")}</h1>
      </div>
      <div className="heading-actions">
        <span className="result-count tags-scope" data-summary-source="annotation.list" data-tag-count={tagRows.length} data-subject-count={totalSubjects}>{scopeLabel}</span>
        <button type="button" className="icon-button" data-action="refresh" title={t("Refresh tag vocabulary")} aria-label={t("Refresh tag vocabulary")} onClick={() => void loadSurface()}><RefreshCw size={15} /></button>
      </div>
    </div>
    <p className="tags-note">{t("Every row here is a durable TAG annotation record the daemon returned here. The name is the stored body, shown exactly as recorded; this surface never normalizes, lowercases, or merges two names, and it applies no machine suggestion.")}</p>
    <p className="tags-note tags-contract">{t("A rename or merge is one service operation pair: the service plans every affected subject and the exact changes, and only the confirmed, digest-bound apply writes. The service adds the new name before tombstoning the old record, so an interruption leaves both names rather than neither.")}</p>

    {blocked
      ? <div className="tags-blocked" data-state="BLOCKED" role="alert"><AlertCircle size={16} /><div><strong>{t("Tags are not readable right now")}</strong><small data-blocked-reason={blockedReason}>{blockedReason}</small></div></div>
      : surfaceState === "LOADING" || surfaceState === "IDLE"
        ? <p className="tags-loading" data-state="LOADING" role="status">{t("Reading the durable tag vocabulary…")}</p>
        : tagRows.length === 0
          ? <div className="empty-state tags-empty" data-empty="true">
            <span className="vault-sigil"><TagsIcon size={35} /></span>
            <h2>{t("No live tag is recorded here yet")}</h2>
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
              {!selectedRow && !applyReport
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
                    <p className="tags-rename-note">{t("A rename or merge is one service operation pair: the service plans every affected subject and the exact changes, and only the confirmed, digest-bound apply writes. The service adds the new name before tombstoning the old record, so an interruption leaves both names rather than neither.")}</p>
                    <label className="tags-rename-field"><span>{t("New name (an existing name merges into it)")}</span>
                      <input type="text" value={renameTarget} placeholder={t("New tag name")} aria-label={t("New name for {{name}}", { name: selectedRow.body })} onChange={(event) => { setRenameTarget(event.target.value); setTagPlan(undefined); setRenameAction({ state: "IDLE", text: "" }); }} />
                    </label>
                    <div className="tags-rename-actions">
                      <button type="button" className="secondary-button compact" data-action="preview-rename" disabled={!renameTarget || renameAction.state === "RUNNING"} onClick={() => void requestPlan()}>{t("Ask the service to plan the change")}</button>
                    </div>

                    {tagPlan && <div className="tags-preview" data-preview-target={tagPlan.to} data-preview-count={tagPlan.subjects.length} data-writes-issued="0" data-plan-digest={tagPlan.digest} data-plan-remaining={tagPlan.remaining} data-plan-noop-subjects={tagPlan.noopSubjects}>
                      <p className="tags-preview-heading" data-fact="plan-summary">{t("Preview only — the service planned {{count}} subjects. No write has been issued yet.", { count: tagPlan.subjects.length })}</p>
                      <p className="tags-preview-heading" data-fact="plan-digest">{t("Plan digest: {{digest}}", { digest: tagPlan.digest })}</p>
                      {tagPlan.noopSubjects > 0 && <p className="tags-preview-heading" data-fact="plan-noop">{t("{{count}} of these subjects already carry the new name, so the plan records their add as an explicit no-op.", { count: tagPlan.noopSubjects })}</p>}
                      <ul className="tags-preview-rows">
                        {tagPlan.subjects.map((subject) => {
                          // The tombstone change names the record the apply will
                          // close; it is the subject's own live source record.
                          const tombstone = subject.changes.find((change) => change.action === "TOMBSTONE_TAG");
                          return <li className="tags-preview-row" key={subject.subjectRef} data-preview-row="true" data-subject-ref={subject.subjectRef} data-annotation-id={tombstone?.annotationID ?? ""} data-revision={tombstone?.expectedRevision ?? 0} data-plan-changes={subject.changes.length}>
                            <span data-fact="preview-name">{subjectName(subject.subjectRef)}</span>
                            <span data-fact="preview-path">{subjectPath(subject.subjectRef)}</span>
                            {subject.changes.map((change, index) => <span
                              key={`${change.action}-${index}`}
                              data-fact="preview-change"
                              data-change-action={change.action}
                              data-change-noop={change.noop ? "true" : "false"}
                              data-change-annotation-id={change.annotationID}
                              data-change-revision={change.expectedRevision}
                            >{change.noop
                                ? t("{{action}} {{body}}: already recorded as {{annotation_id}}; no write", { action: change.action, body: change.body, annotation_id: change.annotationID || t("UNKNOWN — not reported by this build") })
                                : t("{{action}} {{body}}: record {{annotation_id}} at revision {{revision}}", { action: change.action, body: change.body, annotation_id: change.annotationID || t("UNKNOWN — not reported by this build"), revision: change.expectedRevision || t("UNKNOWN — not reported by this build") })}</span>)}
                          </li>;
                        })}
                      </ul>
                      {tagPlan.remaining === 0
                        ? <p className="tags-preview-warning" data-plan-empty="true">{t("The service planned zero remaining changes for this pair, so there is nothing to apply. No write has been issued.")}</p>
                        : <div className="tags-preview-actions">
                          <button type="button" className="primary-button compact" data-action="apply-rename" disabled={renameAction.state === "RUNNING"} onClick={() => void applyPlan()}>{t("Confirm and apply the service plan to {{count}} subjects", { count: tagPlan.subjects.length })}</button>
                          <button type="button" className="secondary-button compact" data-action="discard-preview" disabled={renameAction.state === "RUNNING"} onClick={() => { setTagPlan(undefined); setRenameAction({ state: "IDLE", text: "" }); }}>{t("Discard the preview")}</button>
                        </div>}
                    </div>}
                  </section>}

                  {renameAction.text && <p className="tags-rename-action" data-action-state={renameAction.state} role="status">{renameAction.text}</p>}

                  {applyReport && <div
                    className="tags-applied"
                    data-applied-changed={applyReport.changed}
                    data-applied-unchanged={applyReport.unchanged}
                    data-applied-source-remains={applyReport.sourceRemains}
                    data-applied-failed={applyReport.failed}
                    data-partial={applyReport.partial ? "true" : "false"}
                    data-applied-source={applyReport.from}
                    data-applied-target={applyReport.to}
                    data-applied-digest={applyReport.digest}
                    data-applied-degraded={applyReport.degraded ? "true" : "false"}
                  >
                      <p className="tags-applied-heading">{t("Applied record — {{changed}} of {{requested}} subjects changed, {{failed}} failed.", { changed: applyReport.changed, requested: applyReport.outcomes.length, failed: applyReport.failed })}</p>
                      <p className="tags-applied-heading" data-fact="applied-counts">{t("The service reported {{changed}} changed, {{unchanged}} with nothing written, and {{remains}} still carrying both names.", { changed: applyReport.changed, unchanged: applyReport.unchanged, remains: applyReport.sourceRemains })}</p>
                      {applyReport.message && <p className="tags-applied-reason" data-fact="applied-service-message">{t("Service message: {{message}}", { message: applyReport.message })}</p>}
                      {applyReport.partial
                        ? <div className="tags-applied-partial" data-state="PARTIAL" role="alert">
                          <AlertCircle size={15} />
                          <div>
                            <strong>{t("This was not a clean rename")}</strong>
                            <small>{t("The subjects below were left unchanged or carry both names, exactly as each row states. No rollback is attempted or claimed.")}</small>
                          </div>
                        </div>
                        : <p className="tags-applied-complete">{t("Every subject listed below now carries the new name and no longer carries the old one.")}</p>}
                      <ul className="tags-applied-rows">
                        {applyReport.outcomes.map((outcome) => <li
                          className="tags-applied-row"
                          key={outcome.subjectRef}
                          data-applied-row="true"
                          data-subject-ref={outcome.subjectRef}
                          data-outcome={outcome.outcome}
                          data-reason={outcome.reason}
                          data-target-created={outcome.targetCreated ? "true" : "false"}
                          data-source-tombstoned={outcome.sourceTombstoned ? "true" : "false"}
                        >
                          <span data-fact="applied-name">{subjectName(outcome.subjectRef)}</span>
                          <span data-fact="applied-path">{subjectPath(outcome.subjectRef)}</span>
                          <span data-fact="applied-outcome">{outcomeText(outcome)}</span>
                          {outcome.reason && <span className="tags-applied-reason" data-fact="applied-reason">{t("Reason reported by the service: {{message}}", { message: outcome.reason })}</span>}
                        </li>)}
                      </ul>
                      <p className="tags-applied-note">{t("These are the service's own per-subject outcomes for the confirmed plan. Every subject not listed here was not part of the plan; the reverse change is available below and is planned and confirmed again before it is applied.")}</p>
                      <button type="button" className="secondary-button compact" data-action="prepare-reverse" disabled={applyReport.changed === 0} onClick={() => prepareReverse()}><Undo2 size={13} />{t("Prepare the reverse change")}</button>
                    </div>}

                    {applyReport && applyReport.partial && <ul className="tags-failed-subjects" aria-label={t("Subjects the change did not complete for")}>
                      {applyReport.outcomes.filter((outcome) => outcome.outcome !== "CHANGED").map((outcome) => <li key={outcome.subjectRef} data-failed-row="true" data-subject-ref={outcome.subjectRef} data-outcome={outcome.outcome}>
                        {t("{{name}} ({{subject_ref}}) was not changed: {{reason}}", { name: subjectName(outcome.subjectRef), subject_ref: outcome.subjectRef, reason: outcome.reason || t("UNKNOWN — not reported by this build") })}
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
