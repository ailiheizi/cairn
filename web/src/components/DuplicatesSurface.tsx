import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertCircle, ChevronRight, Copy, RefreshCw, Tag as TagIcon } from "lucide-react";
import { command } from "../app/command";
import { operations } from "../lib/operations";
import { exactIdentityKey, formatBytes, formatEntryType } from "../lib/format";
import type { Translator } from "../i18n";
import type { AnnotationRecord, SearchHit } from "../lib/types";

// The duplicate-group review surface (Tier-1 spec §3 item 4).
//
// One job: show exact-identity duplicate groups over the workspace listing the
// daemon returned, with each member's facts side by side, and offer only
// non-destructive review actions.
//
// The truth rules this file enforces:
//
//   - A group exists only where complete logical byte streams share one exact
//     identity: the same SHA-256 `content_id` AND the same `logical_size`.
//     Grouping reuses `exactIdentityKey` from `lib/format.ts` — the same
//     function the library's duplicate badge and dedup facet already use — so
//     names, similarity, or surrounding metadata can never form a group.
//   - The scope is the loaded workspace listing. The label always says
//     "over N loaded subjects" and the empty state never claims that no
//     duplicates exist catalog-wide. The daemon's `duplicate_group` filter can
//     answer one group's members, so each group carries the daemon's own
//     confirmation (or the reason it could not answer); the surface never
//     claims a catalog-wide enumeration it cannot perform.
//   - Member facts come from `content.list` (name, provenance path, logical
//     size, entry type, content identity), `representation.list` (which
//     representation the member resolves to and where it is placed), and the
//     daemon's protection axis through read-only `search.query` filters (the
//     per-subject protection outcome). A fact the daemon did not report is
//     rendered as UNKNOWN with its reason — never as zero, never as a healthy
//     default.
//   - The review is non-destructive by construction: the only write this
//     surface can issue is `annotation.upsert` for a TAG or a NOTE. There is
//     no delete, no move, no merge, no keep-one, no export, and no similarity
//     grouping anywhere in this file or its assertions.
//
// The shell passes only the translator (the seam wired the view mode without a
// flow), so the surface owns its own read state and resolves the active
// workspace from the same browser-local value the shell records, falling back
// to the daemon's `status.get` projection. No durable state is created here:
// tags and notes are the existing annotation records.

/** How many duplicate groups have their member facts read on load. */
const AUTO_GROUP_READS = 12;
/** Bounded concurrency for the per-group daemon reads. */
const GROUP_CONCURRENCY = 2;
/** Bounded concurrency for the per-member representation reads. */
const MEMBER_CONCURRENCY = 3;

// The protection outcomes this surface asks the daemon's protection axis
// about, in the order a member's answer resolves. The first outcome whose
// filtered answer contains the member is the outcome the daemon claims for it.
// These are the admitted protection outcomes of the catalog contract.
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
type DuplicateGroup = { key: string; contentID: string; logicalSize: number; members: SearchHit[] };
type GroupRead = {
  status: "LOADING" | "READY";
  /** The daemon's `duplicate_group` filter answer, compared with this listing. */
  confirmation: "CONFIRMED" | "MISMATCH" | "UNKNOWN";
  daemonMembers: number;
  /** The outcome the protection axis claims per subject, when it answered. */
  protectionBySubject: Record<string, string>;
  protectionStatus: "LOADING" | "READY" | "UNAVAILABLE";
  protectionReason: string;
  error: string;
};
type RepresentationRow = {
  representation_id?: string;
  content_id?: string;
  class?: string;
  fidelity?: string;
  codec_profile_ref?: string;
  access_mode?: string;
  ownership_mode?: string;
  decoded_length?: number;
  authoritative?: boolean;
  placement?: string;
  verified?: boolean;
  record_digest?: string;
};
type RepresentationRead = { status: "LOADING" | "READY" | "FAILED"; rows: RepresentationRow[]; error: string };
type ActionMessage = { state: "IDLE" | "RUNNING" | "DONE"; text: string };
type CopyState = "COPIED" | "FAILED";

function messageOf(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason ?? "");
}

/** True when the daemon's lexical projection actually answered this query. */
function lexicalAnswered(data: any) {
  const components = Array.isArray(data?.components) ? data.components : [];
  return components.some((component: any) => component?.dimension === LEXICAL_DIMENSION && component?.status === "SUCCEEDED" && Boolean(component?.index_generation_ref));
}

/** One exact-identity group per (content_id, logical_size) key of two or more subjects. */
export function duplicateGroups(items: SearchHit[]): DuplicateGroup[] {
  const byKey = new Map<string, DuplicateGroup>();
  for (const item of items) {
    const key = exactIdentityKey(item);
    if (!key) continue;
    const group = byKey.get(key) ?? {
      key,
      contentID: item.content_id?.trim() ?? "",
      logicalSize: typeof item.logical_size === "number" ? item.logical_size : 0,
      members: [],
    };
    group.members.push(item);
    byKey.set(key, group);
  }
  return [...byKey.values()]
    .filter((group) => group.members.length > 1)
    .sort((left, right) => left.contentID.localeCompare(right.contentID) || left.logicalSize - right.logicalSize);
}

async function runBounded<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

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

function placementLabelKey(token: string) {
  if (token === "present") return "Present in the repository";
  if (token === "missing") return "Missing from the repository";
  return "Unknown — the daemon did not probe this content";
}

// The protection fact for one member, resolved from the daemon's own answers
// only. When the protection axis did not answer, the member reads UNKNOWN with
// the axis reason instead of a guessed outcome.
function protectionFact(read: GroupRead | undefined, subjectRef: string, t: Translator): { token: string; label: string; known: boolean; reason: string } {
  const unknown = { token: "", label: t("Not claimed by the daemon's protection axis"), known: false, reason: "" };
  if (!read || read.status !== "READY") return unknown;
  if (read.protectionStatus === "UNAVAILABLE") {
    return { ...unknown, reason: t("The protection axis could not be read: {{reason}}", { reason: read.protectionReason }) };
  }
  const token = read.protectionBySubject[subjectRef] ?? "";
  const key = protectionLabelKey(token);
  if (key) return { token, label: t(key), known: true, reason: "" };
  return { ...unknown, reason: t("Not claimed by the daemon's protection axis") };
}

export function DuplicatesSurface({ t }: { t: Translator }) {
  const [surfaceState, setSurfaceState] = useState<SurfaceState>("IDLE");
  const [blockedReason, setBlockedReason] = useState("");
  const [listedSubjects, setListedSubjects] = useState(0);
  const [workspaceID, setWorkspaceID] = useState("");
  const [items, setItems] = useState<SearchHit[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [annotationStatus, setAnnotationStatus] = useState<"IDLE" | "LOADING" | "READY" | "FAILED">("IDLE");
  const [annotationError, setAnnotationError] = useState("");
  const [groupReads, setGroupReads] = useState<Record<string, GroupRead>>({});
  const [representations, setRepresentations] = useState<Record<string, RepresentationRead>>({});
  const [selection, setSelection] = useState<string[]>([]);
  const [expandedRef, setExpandedRef] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [tagAction, setTagAction] = useState<ActionMessage>({ state: "IDLE", text: "" });
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [noteActions, setNoteActions] = useState<Record<string, ActionMessage>>({});
  const [copyStates, setCopyStates] = useState<Record<string, CopyState>>({});
  const [rovingIndex, setRovingIndex] = useState(0);
  const [readAt, setReadAt] = useState(0);
  const loadTokenRef = useRef(0);
  const startedGroupsRef = useRef<Set<string>>(new Set());
  const listRef = useRef<HTMLUListElement | null>(null);

  const groups = useMemo(() => duplicateGroups(items), [items]);
  const rovingGroup = groups.length ? Math.min(rovingIndex, groups.length - 1) : 0;
  const tagsBySubject = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const record of annotations) {
      const subject = record.subject_ref?.trim();
      const value = record.body?.trim();
      if (!subject || !value || record.kind !== "TAG" || record.tombstoned) continue;
      const values = result.get(subject) ?? [];
      if (!values.includes(value)) values.push(value);
      result.set(subject, values);
    }
    return result;
  }, [annotations]);
  const notesBySubject = useMemo(() => {
    const result = new Map<string, AnnotationRecord[]>();
    for (const record of annotations) {
      const subject = record.subject_ref?.trim();
      const value = record.body?.trim();
      if (!subject || !value || record.kind !== "NOTE" || record.tombstoned) continue;
      result.set(subject, [...(result.get(subject) ?? []), record]);
    }
    return result;
  }, [annotations]);
  const tagVocabulary = useMemo(() => [...new Set(annotations
    .filter((record) => record.kind === "TAG" && !record.tombstoned)
    .map((record) => record.body?.trim())
    .filter((value): value is string => Boolean(value)))], [annotations]);
  const partialReadCount = useMemo(() => {
    let failed = 0;
    for (const read of Object.values(groupReads)) if (read.status === "READY" && read.protectionStatus === "UNAVAILABLE") failed += 1;
    for (const read of Object.values(representations)) if (read.status === "FAILED") failed += 1;
    if (annotationStatus === "FAILED") failed += 1;
    return failed;
  }, [annotationStatus, groupReads, representations]);

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

  async function loadAnnotations(workspace: string, token: number) {
    setAnnotationStatus("LOADING");
    setAnnotationError("");
    try {
      const response = await command(operations.annotation.list, { workspace_id: workspace });
      if (loadTokenRef.current !== token) return;
      setAnnotations(Array.isArray(response.data?.annotations) ? (response.data.annotations as AnnotationRecord[]) : []);
      setAnnotationStatus("READY");
    } catch (error) {
      if (loadTokenRef.current !== token) return;
      setAnnotations([]);
      setAnnotationStatus("FAILED");
      setAnnotationError(messageOf(error));
    }
  }

  // One group probe: the daemon's `duplicate_group` membership answer plus the
  // protection axis answer for each admitted outcome. Both are read-only
  // structured filters over the daemon's own projection; neither establishes
  // identity and neither can change bytes.
  async function probeGroup(workspace: string, group: DuplicateGroup): Promise<GroupRead> {
    const settled = await Promise.allSettled([
      command(operations.search.query, { workspace_id: workspace, filters: { duplicate_group: group.contentID } }),
      ...PROTECTION_OUTCOMES.map((outcome) => command(operations.search.query, {
        workspace_id: workspace,
        filters: { duplicate_group: group.contentID, protection_mode: outcome },
      })),
    ]);
    const listingRefs = [...new Set(group.members.map((member) => member.subject_ref?.trim() ?? "").filter(Boolean))].sort();
    const membership = settled[0];
    let confirmation: GroupRead["confirmation"] = "UNKNOWN";
    let daemonMembers = 0;
    let error = "";
    if (membership.status === "fulfilled") {
      const hits = Array.isArray(membership.value.data?.hits) ? membership.value.data.hits : [];
      const daemonRefs = [...new Set(hits.map((hit: any) => String(hit?.subject_ref ?? "").trim()).filter(Boolean))].sort();
      daemonMembers = daemonRefs.length;
      confirmation = lexicalAnswered(membership.value.data) && JSON.stringify(daemonRefs) === JSON.stringify(listingRefs) ? "CONFIRMED" : "MISMATCH";
    } else {
      error = messageOf(membership.reason);
    }
    const protectionBySubject: Record<string, string> = {};
    let protectionAnswered = false;
    let protectionReason = "";
    for (let index = 0; index < PROTECTION_OUTCOMES.length; index += 1) {
      const result = settled[index + 1];
      if (result.status !== "fulfilled") {
        if (!protectionReason) protectionReason = messageOf(result.reason);
        continue;
      }
      if (lexicalAnswered(result.value.data)) protectionAnswered = true;
      else if (!protectionReason) protectionReason = String(result.value.reasons?.[0]?.message ?? "");
      for (const hit of (Array.isArray(result.value.data?.hits) ? result.value.data.hits : [])) {
        const subjectRef = String(hit?.subject_ref ?? "").trim();
        if (subjectRef && !protectionBySubject[subjectRef]) protectionBySubject[subjectRef] = PROTECTION_OUTCOMES[index];
      }
    }
    if (!protectionAnswered) protectionReason ||= t("the daemon did not report a protection generation for this workspace");
    return {
      status: "READY",
      confirmation,
      daemonMembers,
      protectionBySubject,
      protectionStatus: protectionAnswered ? "READY" : "UNAVAILABLE",
      protectionReason,
      error,
    };
  }

  async function readRepresentation(workspace: string, subjectRef: string): Promise<RepresentationRead> {
    try {
      const response = await command(operations.representation.list, { workspace_id: workspace, subject_ref: subjectRef });
      const rows = Array.isArray(response.data?.representations) ? (response.data.representations as RepresentationRow[]) : [];
      return { status: "READY", rows, error: "" };
    } catch (error) {
      return { status: "FAILED", rows: [], error: messageOf(error) };
    }
  }

  // One group's facts. The auto-load path runs this once per group; the
  // "Read member facts" control re-runs it (`force`) after a failure, so a
  // degraded fact is always retryable and never a dead control.
  async function startGroupRead(workspace: string, group: DuplicateGroup, token: number, force = false) {
    if (!workspace) return;
    if (force || !startedGroupsRef.current.has(group.key)) {
      startedGroupsRef.current.add(group.key);
      setGroupReads((current) => ({
        ...current,
        [group.key]: { status: "LOADING", confirmation: "UNKNOWN", daemonMembers: 0, protectionBySubject: {}, protectionStatus: "LOADING", protectionReason: "", error: "" },
      }));
      const read = await probeGroup(workspace, group);
      if (loadTokenRef.current !== token) return;
      setGroupReads((current) => ({ ...current, [group.key]: read }));
    }
    await runBounded(group.members, MEMBER_CONCURRENCY, async (member) => {
      const subjectRef = member.subject_ref?.trim() ?? "";
      if (!subjectRef) return;
      const existing = representations[subjectRef];
      if (!force && existing && existing.status !== "FAILED") return;
      setRepresentations((current) => ({ ...current, [subjectRef]: { status: "LOADING", rows: [], error: "" } }));
      const representation = await readRepresentation(workspace, subjectRef);
      if (loadTokenRef.current !== token) return;
      setRepresentations((current) => ({ ...current, [subjectRef]: representation }));
    });
  }

  async function loadSurface() {
    const token = ++loadTokenRef.current;
    const isCurrent = () => loadTokenRef.current === token;
    setSurfaceState("LOADING");
    setBlockedReason("");
    setItems([]);
    setListedSubjects(0);
    setGroupReads({});
    setRepresentations({});
    setSelection([]);
    setCollapsedGroups([]);
    setExpandedRef("");
    setTagDraft("");
    setTagAction({ state: "IDLE", text: "" });
    setNoteDrafts({});
    setNoteActions({});
    setCopyStates({});
    setRovingIndex(0);
    startedGroupsRef.current = new Set();
    const resolved = await resolveWorkspace();
    if (!isCurrent()) return;
    if (!resolved.workspaceID) {
      setSurfaceState("BLOCKED");
      setBlockedReason(resolved.error || t("No published workspace is reported by this service in this browser yet."));
      return;
    }
    setWorkspaceID(resolved.workspaceID);
    void loadAnnotations(resolved.workspaceID, token);
    let listed: SearchHit[] = [];
    try {
      const response = await command(operations.content.list, { workspace_id: resolved.workspaceID });
      listed = Array.isArray(response.data?.items) ? (response.data.items as SearchHit[]) : [];
    } catch (error) {
      if (!isCurrent()) return;
      setSurfaceState("BLOCKED");
      setBlockedReason(messageOf(error));
      return;
    }
    if (!isCurrent()) return;
    setItems(listed);
    setListedSubjects(listed.length);
    setReadAt(Date.now());
    setSurfaceState("READY");
    await runBounded(duplicateGroups(listed).slice(0, AUTO_GROUP_READS), GROUP_CONCURRENCY, async (group) => {
      await startGroupRead(resolved.workspaceID, group, token);
    });
  }

  useEffect(() => {
    void loadSurface();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleSelection(subjectRef: string) {
    if (!subjectRef) return;
    setSelection((current) => current.includes(subjectRef) ? current.filter((value) => value !== subjectRef) : [...current, subjectRef]);
  }

  function toggleGroup(groupKey: string) {
    setCollapsedGroups((current) => current.includes(groupKey) ? current.filter((value) => value !== groupKey) : [...current, groupKey]);
  }

  async function applyTag() {
    const body = tagDraft.trim();
    const targets = selection.slice();
    if (!body || !workspaceID || !targets.length) return;
    setTagAction({ state: "RUNNING", text: "" });
    let added = 0;
    const failures: string[] = [];
    for (const subjectRef of targets) {
      try {
        const response = await command(operations.annotation.upsert, { workspace_id: workspaceID, subject_ref: subjectRef, kind: "TAG", body, expected_revision: 0 });
        const annotation = response.data?.annotation as AnnotationRecord | undefined;
        if (annotation) setAnnotations((current) => current.some((item) => item.annotation_id === annotation.annotation_id) ? current : [...current, annotation]);
        added += 1;
      } catch (error) {
        failures.push(messageOf(error));
      }
    }
    setTagAction(failures.length
      ? { state: "DONE", text: t("Tag added to {{added}} of {{total}} selected members. The other writes failed: {{reason}}", { added, total: targets.length, reason: failures[0] }) }
      : { state: "DONE", text: t("Tag added to every selected member.") });
  }

  async function addNote(member: SearchHit) {
    const subjectRef = member.subject_ref?.trim() ?? "";
    const body = (noteDrafts[subjectRef] ?? "").trim();
    if (!subjectRef || !workspaceID) return;
    if (!body) {
      setNoteActions((current) => ({ ...current, [subjectRef]: { state: "DONE", text: t("Allow note text before the note can be added.") } }));
      return;
    }
    setNoteActions((current) => ({ ...current, [subjectRef]: { state: "RUNNING", text: "" } }));
    try {
      const response = await command(operations.annotation.upsert, { workspace_id: workspaceID, subject_ref: subjectRef, kind: "NOTE", body, expected_revision: 0 });
      const annotation = response.data?.annotation as AnnotationRecord | undefined;
      if (annotation) setAnnotations((current) => [...current, annotation]);
      setNoteDrafts((current) => ({ ...current, [subjectRef]: "" }));
      setNoteActions((current) => ({ ...current, [subjectRef]: { state: "DONE", text: t("Note added to this member.") } }));
    } catch (error) {
      setNoteActions((current) => ({ ...current, [subjectRef]: { state: "DONE", text: t("The note could not be saved: {{message}}", { message: messageOf(error) }) } }));
    }
  }

  async function copyPath(member: SearchHit) {
    const subjectRef = member.subject_ref?.trim() ?? "";
    const path = member.path?.trim() ?? "";
    if (!path) {
      setCopyStates((current) => ({ ...current, [subjectRef]: "FAILED" }));
      return;
    }
    let copied = false;
    try {
      await navigator.clipboard.writeText(path);
      copied = true;
    } catch {
      try {
        const area = document.createElement("textarea");
        area.value = path;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        copied = document.execCommand("copy");
        document.body.removeChild(area);
      } catch {
        copied = false;
      }
    }
    setCopyStates((current) => ({ ...current, [subjectRef]: copied ? "COPIED" : "FAILED" }));
  }

  // Escape hands focus back to the rail entry this view was opened from, and
  // the group headers keep the library's roving-tabindex pattern: one tab stop
  // for the whole list, arrow keys between groups, Home/End at the edges.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      document.querySelector<HTMLButtonElement>('.workspace-nav-item[data-view="duplicates"]')?.focus();
      return;
    }
    const target = event.target as HTMLElement | null;
    const groupNode = target?.closest<HTMLElement>("[data-duplicate-group-index]");
    if (!groupNode) return;
    const current = Number(groupNode.dataset.duplicateGroupIndex ?? "-1");
    if (!Number.isInteger(current) || current < 0 || current >= groups.length) return;
    const last = groups.length - 1;
    const moveFocus = (next: number) => {
      setRovingIndex(next);
      listRef.current?.querySelector<HTMLElement>(`[data-duplicate-group-index="${next}"] .duplicate-group-toggle`)?.focus();
    };
    if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); moveFocus(Math.min(current + 1, last)); return; }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); moveFocus(Math.max(current - 1, 0)); return; }
    if (event.key === "Home") { event.preventDefault(); moveFocus(0); return; }
    if (event.key === "End") { event.preventDefault(); moveFocus(last); }
  }

  const scopeLabel = t("Duplicate groups over {{count}} loaded subjects", { count: listedSubjects });
  const blocked = surfaceState === "BLOCKED";
  const partial = surfaceState === "READY" && partialReadCount > 0;
  const annotationUnavailable = annotationStatus === "FAILED"
    ? t("The durable tags and notes could not be read, so member tags and notes are shown as unavailable: {{message}}", { message: annotationError })
    : "";

  return <section
    className="content-column duplicates-surface"
    aria-label={t("Duplicate groups")}
    data-view="duplicates"
    data-state={surfaceState}
    data-partial={partial ? "true" : "false"}
    data-workspace-id={workspaceID}
    data-listed-subjects={listedSubjects}
    onKeyDown={handleKeyDown}
  >
    <div className="workspace-heading">
      <div>
        <p className="eyebrow">{t("WORKSPACE")}</p>
        <h1>{t("Duplicate groups")}</h1>
      </div>
      <div className="heading-actions">
        <span className="result-count duplicates-scope" data-summary-source="content.list" data-loaded-subjects={listedSubjects}>{scopeLabel}</span>
        <button type="button" className="icon-button" data-action="refresh" title={t("Refresh duplicate groups")} aria-label={t("Refresh duplicate groups")} onClick={() => void loadSurface()}><RefreshCw size={15} /></button>
      </div>
    </div>
    <p className="duplicates-note">{t("Groups are computed in this browser from the workspace listing the daemon returned. The daemon's duplicate-group filter can answer one group's members, but this build cannot enumerate duplicate groups catalog-wide.")}</p>
    <p className="duplicates-note duplicates-contract">{t("Each member is a separate subject that happens to share the same exact bytes: the same SHA-256 content identity and the same logical length. Removing one subject does not touch the bytes the other members point at, and this view cannot delete, move, or merge anything.")}</p>
    <p className="duplicates-note duplicates-contract">{t("This review offers selection, tags, notes, and path copying only. It has no delete, no move, no merge, and no keep-one action.")}</p>
    <p className="duplicates-note">{t("Duplicate groups are read from the workspace listing this service returns; no grouping is ever inferred from similarity.")}</p>

    {blocked
      ? <div className="duplicates-blocked" data-state="BLOCKED" role="alert"><AlertCircle size={16} /><div><strong>{t("Duplicate groups are not readable right now")}</strong><small data-blocked-reason={blockedReason}>{blockedReason}</small></div></div>
      : surfaceState === "LOADING" || surfaceState === "IDLE"
        ? <p className="duplicates-loading" data-state="LOADING" role="status">{t("Reading the workspace listing…")}</p>
        : <>
          {partial && <div className="duplicates-partial" data-state="PARTIAL" role="alert"><AlertCircle size={16} /><div><strong>{t("Some member facts could not be read")}</strong><small>{t("Partial listing: {{count}} member fact reads failed; each affected fact shows UNKNOWN with its own reason.", { count: partialReadCount })}</small>{annotationUnavailable && <small>{annotationUnavailable}</small>}</div></div>}
          {!partial && annotationUnavailable && <p className="duplicates-partial duplicates-annotation-warning" role="status">{annotationUnavailable}</p>}
          {groups.length === 0
            ? <div className="empty-state duplicates-empty" data-empty="true">
              <span className="vault-sigil"><Copy size={35} /></span>
              <h2>{t("No duplicate groups over {{count}} loaded subjects", { count: listedSubjects })}</h2>
              <p>{t("This is not proof that no duplicates exist catalog-wide. The listing the daemon returned for this workspace contains {{count}} subjects and no exact-identity group of two or more was found among them.", { count: listedSubjects })}</p>
            </div>
            : <>
              {selection.length > 0 && <section className="duplicates-selection" role="region" aria-label={t("Tag for the selected members")} data-selected-count={selection.length}>
                <span className="duplicates-selection-count" role="status">{t("{{count}} selected", { count: selection.length })}</span>
                <form className="duplicates-tag" onSubmit={(event) => { event.preventDefault(); void applyTag(); }}>
                  <input list="restoreweave-duplicates-tag-vocabulary" aria-label={t("Tag for the selected members")} value={tagDraft} placeholder={t("Add tag")} onChange={(event) => setTagDraft(event.target.value)} disabled={tagAction.state === "RUNNING"} />
                  <button type="submit" className="primary-button compact" data-action="tag-selected" disabled={tagAction.state === "RUNNING" || !tagDraft.trim()}><TagIcon size={14} />{t("Add tag")}</button>
                </form>
                <datalist id="restoreweave-duplicates-tag-vocabulary">{tagVocabulary.map((value) => <option key={value} value={value} />)}</datalist>
                <span className="duplicates-selection-note">{t("Tagging applies to selected members only and changes no bytes.")}</span>
              </section>}
              {tagAction.text && <p className="duplicates-action" data-action-state={tagAction.state} role="status">{tagAction.text}</p>}
              <ul className="duplicates-groups" aria-label={t("Duplicate groups")} ref={listRef}>
                {groups.map((group, groupIndex) => <GroupCard
                  key={group.key}
                  group={group}
                  index={groupIndex}
                  roving={groupIndex === rovingGroup}
                  collapsed={collapsedGroups.includes(group.key)}
                  read={groupReads[group.key]}
                  representations={representations}
                  tagsBySubject={tagsBySubject}
                  notesBySubject={notesBySubject}
                  annotationUnavailable={annotationUnavailable}
                  selection={selection}
                  expandedRef={expandedRef}
                  noteDrafts={noteDrafts}
                  noteActions={noteActions}
                  copyStates={copyStates}
                  t={t}
                  onToggleGroup={() => toggleGroup(group.key)}
                  onSelect={toggleSelection}
                  onToggleDetails={(subjectRef) => setExpandedRef((current) => current === subjectRef ? "" : subjectRef)}
                  onCopyPath={(member) => void copyPath(member)}
                  onReadFacts={() => void startGroupRead(workspaceID, group, loadTokenRef.current, true)}
                  onNoteDraft={(subjectRef, value) => setNoteDrafts((current) => ({ ...current, [subjectRef]: value }))}
                  onAddNote={(member) => void addNote(member)}
                />)}
              </ul>
            </>}
          <p className="duplicates-read-at" data-read-at={readAt || ""}>{readAt ? t("Listing read at {{time}} (this browser)", { time: new Date(readAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }) : t("The workspace listing has not been read in this browser yet")}</p>
        </>}
  </section>;
}

function GroupCard({ group, index, roving, collapsed, read, representations, tagsBySubject, notesBySubject, annotationUnavailable, selection, expandedRef, noteDrafts, noteActions, copyStates, t, onToggleGroup, onSelect, onToggleDetails, onCopyPath, onReadFacts, onNoteDraft, onAddNote }: {
  group: DuplicateGroup;
  index: number;
  roving: boolean;
  collapsed: boolean;
  read: GroupRead | undefined;
  representations: Record<string, RepresentationRead>;
  tagsBySubject: Map<string, string[]>;
  notesBySubject: Map<string, AnnotationRecord[]>;
  annotationUnavailable: string;
  selection: string[];
  expandedRef: string;
  noteDrafts: Record<string, string>;
  noteActions: Record<string, ActionMessage>;
  copyStates: Record<string, CopyState>;
  t: Translator;
  onToggleGroup: () => void;
  onSelect: (subjectRef: string) => void;
  onToggleDetails: (subjectRef: string) => void;
  onCopyPath: (member: SearchHit) => void;
  onReadFacts: () => void;
  onNoteDraft: (subjectRef: string, value: string) => void;
  onAddNote: (member: SearchHit) => void;
}) {
  const identityLabel = t("Exact identity {{digest}} · logical length {{bytes}}", { digest: group.contentID, bytes: group.logicalSize });
  const confirmation = read?.status === "READY" ? <span className="duplicate-confirmation" data-daemon-confirmation={read.confirmation}>
    {read.confirmation === "CONFIRMED" && t("The daemon's duplicate-group filter confirms all {{count}} rendered members of this group.", { count: read.daemonMembers })}
    {read.confirmation === "MISMATCH" && t("The daemon's duplicate-group filter reports {{daemon}} subjects; this listing renders {{rendered}}.", { daemon: read.daemonMembers, rendered: group.members.length })}
    {read.confirmation === "UNKNOWN" && t("The daemon's duplicate-group filter could not confirm this group: {{message}}", { message: read.error || read.protectionReason })}
  </span> : null;
  // A fact that could not be read stays retryable instead of becoming a dead
  // placeholder: the same read runs again on request.
  const retryable = !read
    || read.status === "READY" && (read.confirmation !== "CONFIRMED" || read.protectionStatus !== "READY" || group.members.some((member) => representations[member.subject_ref?.trim() ?? ""]?.status === "FAILED"));
  return <li className="duplicate-group" data-duplicate-group-index={index} data-group-key={group.key} data-content-id={group.contentID} data-logical-size={group.logicalSize} data-member-count={group.members.length} data-daemon-confirmation={read?.confirmation ?? "UNKNOWN"}>
    <div className="duplicate-group-header">
      <button type="button" className="duplicate-group-toggle" data-action="toggle-group" tabIndex={roving ? 0 : -1} aria-expanded={!collapsed} aria-label={identityLabel} onClick={onToggleGroup}>
        <ChevronRight className="duplicate-group-chevron" size={15} aria-hidden="true" />
        <strong className="duplicate-identity" title={group.contentID}>{group.contentID || t("UNKNOWN — not reported by this build")}</strong>
        <span className="duplicate-members-count">{t("{{count}} members", { count: group.members.length })}</span>
        <small className="duplicate-logical-size" title={String(group.logicalSize)}>{formatBytes(group.logicalSize)}</small>
      </button>
      {confirmation}
      {read?.status === "LOADING" && <span className="duplicate-confirmation" data-daemon-confirmation="UNKNOWN">{t("Reading member facts…")}</span>}
      {!read && <span className="duplicate-confirmation" data-daemon-confirmation="UNKNOWN">{t("Member facts are not read for this group yet.")}</span>}
      {retryable && <button type="button" className="secondary-button compact" data-action="read-group-facts" onClick={onReadFacts}>{t("Read member facts")}</button>}
    </div>
    {!collapsed && <ul className="duplicate-members" aria-label={t("{{count}} members", { count: group.members.length })}>
      {group.members.map((member, memberIndex) => {
        const subjectRef = member.subject_ref?.trim() ?? "";
        const representation = representations[subjectRef];
        const protection = protectionFact(read, subjectRef, t);
        const exact = representation?.rows.find((row) => row.class === "EXACT")
          ?? representation?.rows.find((row) => row.authoritative)
          ?? representation?.rows[0];
        const placementToken = exact?.placement || "unknown";
        const tags = tagsBySubject.get(subjectRef) ?? [];
        const notes = notesBySubject.get(subjectRef) ?? [];
        const marked = selection.includes(subjectRef);
        const expanded = expandedRef === subjectRef;
        const unknownText = t("UNKNOWN — not reported by this build");
        return <li
          className={`duplicate-member ${marked ? "selected" : ""} ${expanded ? "expanded" : ""}`}
          key={subjectRef || `${group.key}-${memberIndex}`}
          data-subject-ref={subjectRef}
          data-content-id={member.content_id?.trim() ?? ""}
          data-logical-size={member.logical_size ?? ""}
          data-entry-type={member.entry_type ?? ""}
          data-path={member.path ?? ""}
          data-protection-state={protection.token || "UNKNOWN"}
          data-protection-known={protection.known ? "true" : "false"}
          data-representation-state={representation?.status ?? "IDLE"}
          data-representation-codec={exact?.codec_profile_ref ?? ""}
          data-placement={placementToken}
          aria-label={t("Member {{index}} of group {{group}}", { index: memberIndex + 1, group: index + 1 })}
        >
          <div className="duplicate-member-header">
            <input type="checkbox" className="duplicate-member-select" checked={marked} onChange={() => onSelect(subjectRef)} aria-label={t(marked ? "Deselect {{name}}" : "Select {{name}} for tagging", { name: member.name?.trim() || member.path?.trim() || subjectRef })} />
            <button type="button" className="duplicate-member-open" data-action={expanded ? "close-details" : "open-details"} aria-expanded={expanded} onClick={() => onToggleDetails(subjectRef)}>{member.name?.trim() || member.path?.trim() || subjectRef}</button>
            {marked && <span className="duplicate-member-mark">{t("Selected")}</span>}
          </div>
          <dl className="duplicate-member-facts">
            <div className="duplicate-fact"><dt>{t("Original path")}</dt><dd title={member.path ?? ""} data-fact="path">{member.path?.trim() || unknownText}</dd></div>
            <div className="duplicate-fact"><dt>{t("Logical size")}</dt><dd data-fact="logical-size">{typeof member.logical_size === "number" ? `${formatBytes(member.logical_size)} · ${member.logical_size} B` : unknownText}</dd></div>
            <div className="duplicate-fact"><dt>{t("Entry type")}</dt><dd data-fact="entry-type">{formatEntryType(member.entry_type, t)}</dd></div>
            <div className="duplicate-fact"><dt>{t("Protection")}</dt><dd data-fact="protection" data-protection-state={protection.token || "UNKNOWN"} data-protection-known={protection.known ? "true" : "false"}>
              {protection.token ? t("Protection: {{label}} ({{token}})", { label: protection.label, token: protection.token }) : `${protection.label}${protection.reason ? ` — ${protection.reason}` : ""}`}
            </dd></div>
            <div className="duplicate-fact"><dt>{t("Representation")}</dt><dd data-fact="representation">
              {!representation || representation.status === "LOADING"
                ? t("Reading the member's representation…")
                : representation.status === "FAILED"
                  ? t("Representation read failed: {{message}}", { message: representation.error })
                  : exact
                    ? t("Exact representation: class {{class}} · fidelity {{fidelity}} · verified {{verified}} · codec {{codec}}", { class: exact.class ?? unknownText, fidelity: exact.fidelity ?? unknownText, verified: exact.verified === true ? "true" : exact.verified === false ? "false" : unknownText, codec: exact.codec_profile_ref || unknownText })
                    : t("No representation is recorded for this member.")}
            </dd></div>
            <div className="duplicate-fact"><dt>{t("Placement")}</dt><dd data-fact="placement" data-placement={placementToken}>
              {!representation || representation.status === "LOADING"
                ? t("Reading the member's representation…")
                : representation.status === "FAILED"
                  ? t("Representation read failed: {{message}}", { message: representation.error })
                  : t("Placement: {{label}} ({{token}})", { label: t(placementLabelKey(placementToken)), token: placementToken })}
            </dd></div>
            <div className="duplicate-fact"><dt>{t("Tags")}</dt><dd data-fact="tags">{annotationUnavailable ? annotationUnavailable : tags.length ? tags.join(" · ") : "—"}</dd></div>
          </dl>
          <div className="duplicate-member-actions">
            <button type="button" className="secondary-button compact" data-action="copy-path" onClick={() => onCopyPath(member)}><Copy size={13} />{t("Copy path")}</button>
            <button type="button" className="secondary-button compact" data-action={expanded ? "close-details" : "open-details"} onClick={() => onToggleDetails(subjectRef)}>{t(expanded ? "Close details" : "Open details")}</button>
            {copyStates[subjectRef] === "COPIED" && <span className="duplicate-copy-state" role="status">{t("Path copied")}</span>}
            {copyStates[subjectRef] === "FAILED" && <span className="duplicate-copy-state" role="status">{t("The path could not be copied; the full path is shown on the member.")}</span>}
          </div>
          {expanded && <div className="duplicate-member-details" data-subject-ref={subjectRef}>
            <dl className="duplicate-member-facts duplicate-member-details-facts">
              <div className="duplicate-fact"><dt>subject_ref</dt><dd className="duplicate-monospace" data-fact="detail-subject-ref">{subjectRef || unknownText}</dd></div>
              <div className="duplicate-fact"><dt>entry_id</dt><dd className="duplicate-monospace">{member.entry_id?.trim() || unknownText}</dd></div>
              <div className="duplicate-fact"><dt>content_id</dt><dd className="duplicate-monospace" data-fact="detail-content-id">{group.contentID || unknownText}</dd></div>
            </dl>
            {representation?.status === "READY" && representation.rows.length > 0 && <div className="duplicate-representations-scroll">
              <table className="duplicate-representations">
              <caption>{t("Representation")}</caption>
              <thead><tr><th>representation_id</th><th>class / fidelity</th><th>codec_profile_ref</th><th>access_mode</th><th>ownership_mode</th><th>decoded_length</th><th>authoritative</th><th>placement</th><th>verified</th><th>record_digest</th></tr></thead>
              <tbody>{representation.rows.map((row) => <tr key={row.representation_id ?? row.record_digest ?? "row"}>
                <td className="duplicate-monospace">{row.representation_id || "—"}</td>
                <td>{`${row.class ?? "—"} / ${row.fidelity ?? "—"}`}</td>
                <td className="duplicate-monospace">{row.codec_profile_ref || "—"}</td>
                <td>{row.access_mode || "—"}</td>
                <td>{row.ownership_mode || "—"}</td>
                <td>{typeof row.decoded_length === "number" ? String(row.decoded_length) : "—"}</td>
                <td>{row.authoritative === true ? "true" : row.authoritative === false ? "false" : "—"}</td>
                <td>{row.placement || "—"}</td>
                <td>{row.verified === true ? "true" : row.verified === false ? "false" : "—"}</td>
                <td className="duplicate-monospace" title={row.record_digest ?? ""}>{row.record_digest ? `${row.record_digest.slice(0, 16)}…` : "—"}</td>
              </tr>)}</tbody>
              </table>
            </div>}
            <div className="duplicate-notes">
              <p className="duplicate-details-heading">{t("Notes")}</p>
              {notes.length === 0
                ? <p className="duplicate-notes-empty">{annotationUnavailable || t("No durable note is recorded for this member.")}</p>
                : <ul className="duplicate-note-list">{notes.map((note) => <li key={note.annotation_id ?? note.updated_at ?? "note"}>{note.body}</li>)}</ul>}
              <form className="duplicate-note" onSubmit={(event) => { event.preventDefault(); onAddNote(member); }}>
                <input aria-label={t("Note for {{name}}", { name: member.name?.trim() || subjectRef })} placeholder={t("Add note")} value={noteDrafts[subjectRef] ?? ""} onChange={(event) => onNoteDraft(subjectRef, event.target.value)} disabled={noteActions[subjectRef]?.state === "RUNNING"} />
                <button type="submit" className="primary-button compact" data-action="add-note" disabled={noteActions[subjectRef]?.state === "RUNNING"}>{t("Add note")}</button>
              </form>
              {noteActions[subjectRef]?.text && <p className="duplicate-note-state" data-note-state={noteActions[subjectRef]?.state} role="status">{noteActions[subjectRef]?.text}</p>}
            </div>
          </div>}
        </li>;
      })}
    </ul>}
  </li>;
}
