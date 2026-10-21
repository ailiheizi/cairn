import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, RefObject, SetStateAction } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import { FAVORITE_TAG } from "../lib/favorites";
import { renderedColumnCount } from "../lib/format";
import type { DetailsFlow } from "./useDetails";
import type { LibraryFlow } from "./useLibrary";
import type { AnnotationRecord, Notice, SearchHit } from "../lib/types";

// The batch selection over the rendered library listing.
//
// Selection is a second, explicit concept on top of the one details subject:
// it says which subjects a batch action acts on. It is never membership,
// ownership, or authority to delete bytes.

export type SelectionFlow = {
  selectionRefs: string[];
  setSelectionRefs: (value: string[] | ((current: string[]) => string[])) => void;
  selectionAnchor: string;
  setSelectionAnchor: (value: string) => void;
  rovingIndex: number;
  setRovingIndex: (value: number) => void;
  selectionTagDraft: string;
  setSelectionTagDraft: Dispatch<SetStateAction<string>>;
  selectionTagQueue: string[];
  selectionTagQueueDraft: string;
  setSelectionTagQueueDraft: Dispatch<SetStateAction<string>>;
  selectionSubjects: SearchHit[];
  tagActionsReady: boolean;
  tagActionsUnavailableMessage: string;
  tagMutationProgress: SelectionTagMutationProgress | null;
  stopSelectionTagMutation: () => void;
  refreshSelectionTagState: () => Promise<void>;
  rovingRow: number;
  selectionTagMatchCount: (tag: string) => number;
  toggleSelectionAt: (index: number) => void;
  extendSelectionTo: (index: number) => void;
  selectAllVisible: () => void;
  changeScopeSelection: (subjects: SearchHit[], mode: "add" | "remove" | "invert") => void;
  invertVisibleSelection: () => void;
  clearSelection: () => void;
  applySelectionTag: () => Promise<void>;
  addSelectionTagToQueue: () => void;
  removeQueuedSelectionTag: (tag: string) => void;
  clearQueuedSelectionTags: () => void;
  applySelectionTagQueue: () => Promise<void>;
  removeSelectionTag: () => Promise<void>;
  addSelectionFavorite: () => Promise<void>;
  removeSelectionFavorite: () => Promise<void>;
  handleLibraryKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
};

export type SelectionTagMutationProgress = {
  id: number;
  workspaceID: string;
  subjectRefs: string[];
  kind: "single" | "queued";
  action: "add" | "remove" | "queued";
  totalSubjects: number;
  totalItemTags: number;
  startedSubjects: number;
  settledSubjects: number;
  startedItemTags: number;
  settledItemTags: number;
  startedWrites: number;
  changed: number;
  unchanged: number;
  uncertain: number;
  currentSubject: string;
  currentTag: string;
  phase: "running" | "stopping" | "complete" | "stopped" | "paused" | "unknown";
  refreshState: "none" | "required" | "refreshing" | "ready" | "unavailable";
};

type SelectionTagMutationAttempt = { id: number; workspaceID: string; stopRequested: boolean };
type SelectionTagRefreshAttempt = { id: number; workspaceID: string };

export function useSelection({ t, workspaceID, hits, renderedHits, selected, details, library, annotationStorageReady, catalogStorageMessage, refreshCapabilities, setBusy, notify, libraryListRef }: {
  t: Translator;
  workspaceID: string;
  hits: SearchHit[];
  renderedHits: SearchHit[];
  selected: SearchHit | undefined;
  details: DetailsFlow;
  library: LibraryFlow;
  annotationStorageReady: boolean;
  catalogStorageMessage: string;
  refreshCapabilities: () => Promise<void>;
  setBusy: (value: boolean) => void;
  notify: (notice: Notice | undefined) => void;
  libraryListRef: RefObject<HTMLDivElement | null>;
}): SelectionFlow {
  const [selectionRefs, setSelectionRefs] = useState<string[]>([]);
  const [selectionAnchor, setSelectionAnchor] = useState("");
  const [rovingIndex, setRovingIndex] = useState(0);
  const [selectionTagDraft, setSelectionTagDraft] = useState("");
  const [selectionTagQueue, setSelectionTagQueue] = useState<string[]>([]);
  const [selectionTagQueueDraft, setSelectionTagQueueDraft] = useState("");
  const [tagMutationProgress, setTagMutationProgress] = useState<SelectionTagMutationProgress | null>(null);
  const currentWorkspaceID = useRef(workspaceID);
  currentWorkspaceID.current = workspaceID;
  const tagMutationAttemptRef = useRef<SelectionTagMutationAttempt | null>(null);
  const tagMutationSequence = useRef(0);
  const tagRefreshAttemptRef = useRef<SelectionTagRefreshAttempt | null>(null);
  const tagRefreshSequence = useRef(0);

  function beginTagMutation(kind: "single" | "queued", action: "add" | "remove" | "queued", subjectCount: number, tagCount: number, subjectRefs: string[]) {
    const attempt: SelectionTagMutationAttempt = { id: ++tagMutationSequence.current, workspaceID, stopRequested: false };
    tagMutationAttemptRef.current = attempt;
    setTagMutationProgress({
      id: attempt.id, workspaceID, subjectRefs: [...subjectRefs], kind, action, totalSubjects: subjectCount, totalItemTags: subjectCount * tagCount,
      startedSubjects: 0, settledSubjects: 0, startedItemTags: 0, settledItemTags: 0, startedWrites: 0,
      changed: 0, unchanged: 0, uncertain: 0, currentSubject: "", currentTag: "", phase: "running", refreshState: "none",
    });
    setBusy(true);
    return attempt;
  }

  function isCurrentTagMutation(attempt: SelectionTagMutationAttempt) {
    return tagMutationAttemptRef.current === attempt && currentWorkspaceID.current === attempt.workspaceID;
  }

  function publishTagProgress(attempt: SelectionTagMutationAttempt, patch: Partial<SelectionTagMutationProgress>) {
    if (!isCurrentTagMutation(attempt)) return;
    const requestedPhase = patch.phase;
    const terminalPhase = requestedPhase === "stopped" || requestedPhase === "unknown" || requestedPhase === "paused" || requestedPhase === "complete";
    setTagMutationProgress((current) => current?.id === attempt.id
      ? { ...current, ...patch, phase: attempt.stopRequested && !terminalPhase ? "stopping" : (patch.phase ?? current.phase) }
      : current);
  }

  function stopSelectionTagMutation() {
    const attempt = tagMutationAttemptRef.current;
    if (!attempt || attempt.stopRequested) return;
    attempt.stopRequested = true;
    publishTagProgress(attempt, { phase: "stopping" });
  }

  async function refreshSelectionTagState() {
    const progress = tagMutationProgress;
    if (!progress || progress.workspaceID !== workspaceID || progress.refreshState === "refreshing" || tagMutationAttemptRef.current) return;
    const activeWorkspaceID = workspaceID;
    const attempt: SelectionTagRefreshAttempt = { id: ++tagRefreshSequence.current, workspaceID: activeWorkspaceID };
    if (tagRefreshAttemptRef.current) return;
    tagRefreshAttemptRef.current = attempt;
    const capturedRefs = [...progress.subjectRefs];
    setTagMutationProgress((current) => current?.id === progress.id ? { ...current, refreshState: "refreshing" } : current);
    setBusy(true);
    try {
      const result = await library.reloadTagVocabulary(activeWorkspaceID);
      if (tagRefreshAttemptRef.current !== attempt || currentWorkspaceID.current !== activeWorkspaceID) return;
      if (result.status === "ready" && result.workspaceID === activeWorkspaceID) {
        for (const subjectRef of capturedRefs) library.syncTagCoverage(subjectRef, result.records);
        setTagMutationProgress((current) => current?.id === progress.id ? { ...current, refreshState: "ready" } : current);
      } else {
        setTagMutationProgress((current) => current?.id === progress.id ? { ...current, refreshState: "unavailable" } : current);
      }
    } catch {
      if (tagRefreshAttemptRef.current === attempt && currentWorkspaceID.current === activeWorkspaceID) {
        setTagMutationProgress((current) => current?.id === progress.id ? { ...current, refreshState: "unavailable" } : current);
      }
    } finally {
      if (tagRefreshAttemptRef.current === attempt) {
        tagRefreshAttemptRef.current = null;
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    const activeMutation = tagMutationAttemptRef.current;
    if (activeMutation && activeMutation.workspaceID !== workspaceID) {
      tagMutationAttemptRef.current = null;
      setTagMutationProgress(null);
      setBusy(false);
    }
    const activeRefresh = tagRefreshAttemptRef.current;
    if (activeRefresh && activeRefresh.workspaceID !== workspaceID) {
      tagRefreshAttemptRef.current = null;
      setTagMutationProgress(null);
      setBusy(false);
    }
    setTagMutationProgress(null);
    setSelectionTagQueue([]);
    setSelectionTagQueueDraft("");
  }, [workspaceID]);

  const selectionSubjects = useMemo(() => {
    const byRef = new Map<string, SearchHit>();
    for (const hit of hits) {
      const subjectRef = hit.subject_ref?.trim();
      if (subjectRef && !byRef.has(subjectRef)) byRef.set(subjectRef, hit);
    }
    return selectionRefs.map((subjectRef) => byRef.get(subjectRef)).filter((hit): hit is SearchHit => Boolean(hit));
  }, [hits, selectionRefs]);
  // A selection follows subject identity across page presentations, but it
  // must not outlive the loaded result context in which it was made. Keeping
  // this set and the resolved SearchHits in sync prevents batch actions from
  // silently acting on fewer subjects than the visible selected count.
  useEffect(() => {
    const available = new Set(hits.map((hit) => hit.subject_ref?.trim() ?? "").filter(Boolean));
    setSelectionRefs((current) => {
      const next = current.filter((subjectRef) => available.has(subjectRef));
      return next.length === current.length ? current : next;
    });
    setSelectionAnchor((current) => current && !available.has(current) ? "" : current);
  }, [hits]);
  const rovingRow = renderedHits.length ? Math.min(rovingIndex, renderedHits.length - 1) : 0;

  // Selection helpers read the rendered order, so a range or a keyboard step
  // follows exactly the tiles the user sees after sorting or switching layout.
  function selectionRefAt(index: number) { return renderedHits[index]?.subject_ref?.trim() ?? ""; }
  function toggleSelectionAt(index: number) {
    const subjectRef = selectionRefAt(index);
    if (!subjectRef) return;
    setSelectionAnchor(subjectRef);
    setSelectionRefs((current) => current.includes(subjectRef) ? current.filter((value) => value !== subjectRef) : [...current, subjectRef]);
  }
  function extendSelectionTo(index: number) {
    const subjectRef = selectionRefAt(index);
    if (!subjectRef) return;
    const anchorIndex = selectionAnchor ? renderedHits.findIndex((hit) => hit.subject_ref?.trim() === selectionAnchor) : -1;
    if (anchorIndex < 0) { toggleSelectionAt(index); return; }
    const range = renderedHits.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1)
      .map((hit) => hit.subject_ref?.trim() ?? "")
      .filter((value): value is string => Boolean(value));
    setSelectionRefs((current) => {
      const next = [...current];
      for (const value of range) if (!next.includes(value)) next.push(value);
      return next;
    });
  }
  function selectAllVisible() {
    const refs = [...new Set(renderedHits.map((hit) => hit.subject_ref?.trim() ?? "").filter((value): value is string => Boolean(value)))];
    setSelectionRefs(refs);
    setSelectionAnchor(refs.at(-1) ?? "");
  }
  function changeScopeSelection(subjects: SearchHit[], mode: "add" | "remove" | "invert") {
    // Only stable subject references that are present in the currently loaded
    // result set can participate. Names and provenance paths never identify a
    // selection.
    const loadedRefs = new Set(hits.map((hit) => hit.subject_ref?.trim() ?? "").filter(Boolean));
    const scopeRefs = [...new Set(subjects
      .map((hit) => hit.subject_ref?.trim() ?? "")
      .filter((subjectRef) => Boolean(subjectRef) && loadedRefs.has(subjectRef)))];
    if (!scopeRefs.length) return;
    const scope = new Set(scopeRefs);
    setSelectionRefs((current) => {
      const next = new Set(current);
      for (const subjectRef of scopeRefs) {
        if (mode === "remove") {
          next.delete(subjectRef);
        } else if (mode === "add") {
          next.add(subjectRef);
        } else if (next.has(subjectRef)) {
          next.delete(subjectRef);
        } else {
          next.add(subjectRef);
        }
      }
      return [...next];
    });

    // Keep a useful range anchor within the changed scope when possible;
    // otherwise preserve the existing anchor if it remains selected.
    setSelectionAnchor((currentAnchor) => {
      const currentlySelected = new Set(selectionRefs);
      for (const subjectRef of scopeRefs) {
        if (mode === "remove") currentlySelected.delete(subjectRef);
        else if (mode === "add") currentlySelected.add(subjectRef);
        else if (currentlySelected.has(subjectRef)) currentlySelected.delete(subjectRef);
        else currentlySelected.add(subjectRef);
      }
      const preferred = [...scopeRefs].reverse().find((subjectRef) => currentlySelected.has(subjectRef));
      if (preferred) return preferred;
      if (currentAnchor && !scope.has(currentAnchor) && currentlySelected.has(currentAnchor)) return currentAnchor;
      return selectionRefs.filter((subjectRef) => currentlySelected.has(subjectRef)).at(-1) ?? "";
    });
  }
  function invertVisibleSelection() { changeScopeSelection(renderedHits, "invert"); }
  function clearSelection() {
    setSelectionRefs([]); setSelectionAnchor("");
    // Clearing a finished batch also dismisses its transient receipt. During
    // a write or refresh the progress/Stop controls must remain reachable.
    if (!tagMutationAttemptRef.current && !tagRefreshAttemptRef.current) setTagMutationProgress(null);
  }

  // One tab stop for the whole list, with a roving tabindex: arrow keys move
  // focus between the tiles, Space toggles the focused tile, Enter opens its
  // details, and Cmd/Ctrl+A selects every visible item.
  function handleLibraryKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    const tile = target?.closest<HTMLElement>("[data-result-index]");
    if (!tile) return;
    const current = Number(tile.dataset.resultIndex ?? "-1");
    if (!Number.isInteger(current) || current < 0 || current >= renderedHits.length) return;
    const last = renderedHits.length - 1;
    const moveFocus = (next: number) => {
      setRovingIndex(next);
      libraryListRef.current?.querySelector<HTMLElement>(`[data-result-index="${next}"] .result-open-copy`)?.focus();
    };
    if (event.key === "ArrowRight") { event.preventDefault(); moveFocus(Math.min(current + 1, last)); return; }
    if (event.key === "ArrowLeft") { event.preventDefault(); moveFocus(Math.max(current - 1, 0)); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const columns = renderedColumnCount(libraryListRef.current);
      moveFocus(event.key === "ArrowDown" ? Math.min(current + columns, last) : Math.max(current - columns, 0));
      return;
    }
    if (event.key === "Home") { event.preventDefault(); moveFocus(0); return; }
    if (event.key === "End") { event.preventDefault(); moveFocus(last); return; }
    if (event.key === " ") { event.preventDefault(); toggleSelectionAt(current); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") { event.preventDefault(); selectAllVisible(); }
  }

  const targetRefs = selectionSubjects.map((hit) => hit.subject_ref?.trim() ?? "");
  const selectionResolved = selectionRefs.length > 0 && targetRefs.length === selectionRefs.length && targetRefs.every(Boolean);
  const tagSnapshotReady = Boolean(workspaceID && library.tagVocabularyWorkspaceID === workspaceID && library.tagStatus === "ready" && library.tagSnapshotKnown);
  const tagActionsReady = Boolean(annotationStorageReady && tagSnapshotReady && selectionResolved);
  const tagActionsUnavailableMessage = !annotationStorageReady
    ? catalogStorageMessage
    : library.tagStatus === "loading" || library.tagVocabularyWorkspaceID !== workspaceID
      ? t("Loading tags and favorites…")
    : !tagSnapshotReady
      ? t("Tags and favorites could not be read. Retry before editing them.")
      : !selectionResolved
        ? t("Some selected items are unavailable in this result scope. Batch tag actions are paused.")
        : "";

  function selectionTagMatchCount(tag: string) {
    const body = tag.trim();
    if (!body || !tagSnapshotReady || !selectionResolved) return 0;
    const refs = new Set(targetRefs);
    const matches = new Set(library.workspaceTags
      .filter((record) => record.kind === "TAG" && !record.tombstoned && record.body?.trim() === body && refs.has(record.subject_ref?.trim() ?? ""))
      .map((record) => record.subject_ref?.trim() ?? "")
      .filter(Boolean));
    return matches.size;
  }

  function parseCompleteSubjectAnnotations(value: unknown, activeWorkspaceID: string, subjectRef: string): AnnotationRecord[] {
    if (!Array.isArray(value)) throw new Error(t("The complete tag and note list was not returned."));
    const allowedKinds = new Set(["TAG", "NOTE", "PROGRESS"]);
    const seenIDs = new Set<string>();
    return value.map((record: any) => {
      const annotationID = typeof record?.annotation_id === "string" ? record.annotation_id.trim() : "";
      const recordSubject = typeof record?.subject_ref === "string" ? record.subject_ref.trim() : "";
      const kind = typeof record?.kind === "string" ? record.kind : "";
      const revision = record?.revision;
      const recordWorkspace = typeof record?.workspace_id === "string" ? record.workspace_id.trim() : "";
      if (!annotationID || recordWorkspace !== activeWorkspaceID || recordSubject !== subjectRef || !allowedKinds.has(kind) || typeof record?.body !== "string"
        || typeof record?.tombstoned !== "boolean" || record.tombstoned
        || !record.body.trim() || !Number.isSafeInteger(revision) || revision < 1 || seenIDs.has(annotationID)) {
        throw new Error(t("The tag and note list was incomplete or malformed; nothing was changed for this item."));
      }
      seenIDs.add(annotationID);
      return record as AnnotationRecord;
    });
  }

  async function readCompleteSubjectAnnotations(activeWorkspaceID: string, subjectRef: string) {
    if (currentWorkspaceID.current !== activeWorkspaceID) throw new Error(t("The active content changed; the batch action was stopped."));
    const response = await command(operations.annotation.list, { workspace_id: activeWorkspaceID, subject_ref: subjectRef });
    if (currentWorkspaceID.current !== activeWorkspaceID) throw new Error(t("The active content changed; the batch action was stopped."));
    if (response.status !== "SUCCEEDED") throw new Error(t("The complete tag and note list is unavailable; nothing was changed for this item."));
    return parseCompleteSubjectAnnotations(response.data?.annotations, activeWorkspaceID, subjectRef);
  }

  function prepareSelectionTagMutation(hasInput: boolean): { operationWorkspaceID: string; targets: Array<SearchHit & { subject_ref: string }>; capturedRefs: string[] } | undefined {
    if (!hasInput) return;
    const operationWorkspaceID = workspaceID;
    const targets = selectionSubjects.map((hit) => ({ ...hit, subject_ref: hit.subject_ref?.trim() ?? "" }));
    const capturedRefs = [...selectionRefs];
    if (!operationWorkspaceID || targets.length === 0) return;
    if (!annotationStorageReady) { notify({ kind: "error", text: catalogStorageMessage }); return; }
    if (!tagSnapshotReady || !selectionResolved || capturedRefs.length !== targets.length) {
      notify({ kind: "warning", text: !tagSnapshotReady ? t("Tags and favorites could not be read. Retry before editing them.") : t("Some selected items are unavailable in this result scope. Batch tag actions are paused.") });
      return;
    }
    if (tagMutationAttemptRef.current || tagRefreshAttemptRef.current) return;
    return { operationWorkspaceID, targets, capturedRefs };
  }

  async function runSelectionTagMutation(rawBody: string, action: "add" | "remove") {
    const body = rawBody.trim();
    const prepared = prepareSelectionTagMutation(Boolean(body));
    if (!prepared) return;
    const { operationWorkspaceID, targets } = prepared;
    const attempt = beginTagMutation("single", action, targets.length, 1, targets.map((hit) => hit.subject_ref));
    notify({ kind: "warning", text: action === "add"
      ? t("Checking {{count}} selected items before adding tag {{tag}}.", { count: targets.length, tag: body })
      : t("Checking {{count}} selected items before removing tag {{tag}}.", { count: targets.length, tag: body }) });

    const changedRefs = new Set<string>();
    const unchangedRefs = new Set<string>();
    const failures: Array<{ name: string; message: string }> = [];
    const degradedRefs = new Set<string>();
    const degradedMessages: string[] = [];
    const uncertainRefs = new Set<string>();
    const progressCounts = { startedSubjects: 0, settledSubjects: 0, startedWrites: 0 };
    const publishProgress = (currentSubject = "") => publishTagProgress(attempt, {
      ...progressCounts,
      startedItemTags: progressCounts.startedSubjects,
      settledItemTags: progressCounts.settledSubjects,
      changed: changedRefs.size,
      unchanged: unchangedRefs.size,
      uncertain: uncertainRefs.size,
      currentSubject,
      currentTag: body,
    });
    const confirmedAnnotations = new Map<string, AnnotationRecord[]>();
    const visitedRefs = new Set<string>();
    const attemptedRefs = new Set<string>();
    let stopAfterUnknownMutation = false;
    let anyMutationAttempted = false;
    let omittedDegradedMessages = false;
    function recordDegradedResponse(
      subjectRef: string,
      label: string,
      response: { status?: string; reasons?: Array<{ message?: string }> },
    ) {
      if (response.status === "SUCCEEDED") return;
      degradedRefs.add(subjectRef);
      const messages = response.reasons?.map((reason) => reason.message?.trim()).filter((message): message is string => Boolean(message)) ?? [];
      if (messages.length === 0) messages.push(t("A saved change needs follow-up."));
      for (const message of messages) {
        const localizedMessage = t(message);
        const boundedMessage = localizedMessage.length > 240 ? `${localizedMessage.slice(0, 240)}…` : localizedMessage;
        const summary = t("{{name}}: {{reason}}", { name: label.slice(0, 120), reason: boundedMessage });
        if (degradedMessages.includes(summary)) continue;
        if (degradedMessages.length >= 3) {
          omittedDegradedMessages = true;
          break;
        }
        degradedMessages.push(summary);
      }
    }
    try {
      for (const hit of targets) {
        if (!isCurrentTagMutation(attempt) || attempt.stopRequested) break;
        const subjectRef = hit.subject_ref;
        const label = hit.name?.trim() || subjectRef || t("Untitled subject");
        progressCounts.startedSubjects += 1;
        publishProgress(label);
        if (subjectRef) visitedRefs.add(subjectRef);
        if (!subjectRef) {
          failures.push({ name: label, message: t("This item has no stable subject reference.") });
          continue;
        }
        let before: AnnotationRecord[];
        try {
          before = await readCompleteSubjectAnnotations(operationWorkspaceID, subjectRef);
        } catch (error) {
          if (!isCurrentTagMutation(attempt)) break;
          failures.push({ name: label, message: error instanceof Error ? error.message : t("The complete tag and note list is unavailable; nothing was changed for this item.") });
          continue;
        }
        if (!isCurrentTagMutation(attempt) || attempt.stopRequested) break;
        const matches = before.filter((record) => record.kind === "TAG" && record.body?.trim() === body);
        if ((action === "add" && matches.length > 0) || (action === "remove" && matches.length === 0)) {
          unchangedRefs.add(subjectRef);
          confirmedAnnotations.set(subjectRef, before);
          progressCounts.settledSubjects += 1;
          publishProgress();
          continue;
        }

        let mutationOutcomeUnknown = false;
        try {
          if (action === "add") {
            if (!isCurrentTagMutation(attempt) || attempt.stopRequested) break;
            anyMutationAttempted = true;
            attemptedRefs.add(subjectRef);
            progressCounts.startedWrites += 1;
            publishProgress(label);
            const response = await command(operations.annotation.upsert, {
              workspace_id: operationWorkspaceID,
              subject_ref: subjectRef,
              kind: "TAG",
              body,
              expected_revision: 0,
            });
            recordDegradedResponse(subjectRef, label, response);
          } else {
            for (const annotation of matches) {
              if (!isCurrentTagMutation(attempt) || attempt.stopRequested) break;
              const annotationID = annotation.annotation_id?.trim() ?? "";
              const expectedRevision = annotation.revision;
              if (!annotationID || !Number.isSafeInteger(expectedRevision) || (expectedRevision ?? 0) < 1) {
                throw new Error(t("Tag identity or revision is unavailable; this item's tag was not removed."));
              }
              anyMutationAttempted = true;
              attemptedRefs.add(subjectRef);
              progressCounts.startedWrites += 1;
              publishProgress(label);
              const response = await command(operations.annotation.delete, {
                workspace_id: operationWorkspaceID,
                annotation_id: annotationID,
                expected_revision: expectedRevision,
              });
              recordDegradedResponse(subjectRef, label, response);
            }
          }
        } catch (error) {
          if (!isCurrentTagMutation(attempt)) break;
          mutationOutcomeUnknown = anyMutationAttempted;
          const reason = error instanceof Error ? error.message : t("The tag write outcome could not be confirmed.");
          // A write transport/refusal answer may not prove whether bytes of the
          // annotation changed. Stop this batch's remaining writes, then read
          // this subject back before describing its result.
          let observed: AnnotationRecord[] | undefined;
          try { observed = await readCompleteSubjectAnnotations(operationWorkspaceID, subjectRef); }
          catch { /* the outcome remains unknown and is reported below */ }
          if (observed) {
            confirmedAnnotations.set(subjectRef, observed);
            const nowMatches = observed.some((record) => record.kind === "TAG" && record.body?.trim() === body);
            const desired = action === "add" ? nowMatches : !nowMatches;
            const alreadyDesired = action === "add" ? matches.length > 0 : matches.length === 0;
            if (desired && !alreadyDesired) changedRefs.add(subjectRef);
            else if (desired) unchangedRefs.add(subjectRef);
            else {
              const remainingMatches = observed.filter((record) => record.kind === "TAG" && record.body?.trim() === body).length;
              const removedCount = action === "remove" ? Math.max(0, matches.length - remainingMatches) : 0;
              failures.push({ name: label, message: removedCount > 0
                ? t("Removed {{removed}} matching tag record(s), but {{remaining}} remain. {{reason}}", { removed: removedCount, remaining: remainingMatches, reason })
                : reason });
            }
            if (mutationOutcomeUnknown) uncertainRefs.add(subjectRef);
            progressCounts.settledSubjects += 1;
            publishProgress();
          } else {
            failures.push({ name: label, message: t("The tag write outcome is unknown because the current tag and note list could not be read: {{reason}}", { reason }) });
          }
          if (mutationOutcomeUnknown) { stopAfterUnknownMutation = true; break; }
          continue;
        }
        if (!isCurrentTagMutation(attempt)) break;
        try {
          const after = await readCompleteSubjectAnnotations(operationWorkspaceID, subjectRef);
          confirmedAnnotations.set(subjectRef, after);
          const nowMatches = after.some((record) => record.kind === "TAG" && record.body?.trim() === body);
          const desired = action === "add" ? nowMatches : !nowMatches;
          if (!desired) {
            const remainingMatches = after.filter((record) => record.kind === "TAG" && record.body?.trim() === body).length;
            failures.push({ name: label, message: action === "remove" && remainingMatches > 0
              ? t("Could not remove all matching tag records; {{count}} remain.", { count: remainingMatches })
              : t("The tag list did not confirm the requested change.") });
          }
          else changedRefs.add(subjectRef);
          progressCounts.settledSubjects += 1;
          publishProgress();
        } catch (error) {
          if (!isCurrentTagMutation(attempt)) break;
          failures.push({ name: label, message: t("The tag write was sent, but its result could not be confirmed: {{reason}}", { reason: error instanceof Error ? error.message : t("The tag write outcome could not be confirmed.") }) });
          stopAfterUnknownMutation = true;
          break;
        }
        if (stopAfterUnknownMutation) break;
      }

      if (!isCurrentTagMutation(attempt)) return;
      if (stopAfterUnknownMutation) {
        for (const hit of targets) {
          const subjectRef = hit.subject_ref;
          if (subjectRef && !visitedRefs.has(subjectRef)) {
            failures.push({ name: hit.name?.trim() || subjectRef, message: t("Not attempted because an earlier tag write needed reconciliation.") });
          }
        }
      }
      const reread = await library.reloadTagVocabulary(operationWorkspaceID);
      if (!isCurrentTagMutation(attempt)) return;
      if (reread.status === "ready" && reread.workspaceID === operationWorkspaceID) {
        for (const subjectRef of visitedRefs) library.syncTagCoverage(subjectRef, reread.records);
      } else {
        failures.push({ name: t("Tag coverage"), message: t("Tags and favorites could not be reread after the batch action.") });
      }
      const detailRef = selected?.subject_ref?.trim() ?? "";
      const detailAnnotations = detailRef ? confirmedAnnotations.get(detailRef) : undefined;
      if (currentWorkspaceID.current === operationWorkspaceID && details.detailSubjectRef.current === detailRef && detailRef && detailAnnotations) {
        details.setAnnotations(detailAnnotations);
      }
      if (anyMutationAttempted) {
        await refreshCapabilities();
        if (!isCurrentTagMutation(attempt)) return;
      }
      const finalPhase = stopAfterUnknownMutation || uncertainRefs.size > 0 ? "unknown" : attempt.stopRequested ? "stopped" : failures.length || degradedRefs.size ? "paused" : "complete";
      publishTagProgress(attempt, { phase: finalPhase, refreshState: reread.status === "ready" && reread.workspaceID === operationWorkspaceID ? "ready" : "unavailable", currentSubject: "", currentTag: "" });

      const failureText = failures.map((failure) => `${failure.name}: ${failure.message}`).join("; ");
      const degradedText = [
        ...degradedMessages,
        ...(omittedDegradedMessages ? [t("Additional degraded item reasons were omitted.")] : []),
      ].join("; ");
      const completed = changedRefs.size + unchangedRefs.size;
      const actionLabel = action === "add" ? t("added") : t("removed");
      if (!attempt.stopRequested && failures.length === 0 && degradedRefs.size === 0 && uncertainRefs.size === 0) {
        if (action === "add") setSelectionTagDraft((currentDraft) => currentDraft.trim() === body ? "" : currentDraft);
        notify({ kind: "success", text: action === "add"
          ? t("Tag \"{{tag}}\" is present on all {{count}} selected items ({{changed}} added; {{unchanged}} already present).", { tag: body, count: targets.length, changed: changedRefs.size, unchanged: unchangedRefs.size })
          : t("Tag \"{{tag}}\" removed from {{changed}} selected items; {{unchanged}} had no matching tag.", { tag: body, changed: changedRefs.size, unchanged: unchangedRefs.size }) });
      } else {
        notify({ kind: "warning", text: t("Tag \"{{tag}}\": {{action}} for {{completed}} of {{total}} selected items. {{degraded}} item(s) had a degraded operation; {{uncertain}} required readback after an uncertain response. {{failures}}", {
          tag: body,
          action: actionLabel,
          completed,
          total: targets.length,
          degraded: degradedRefs.size,
          uncertain: uncertainRefs.size,
          failures: [failureText, degradedText].filter(Boolean).join("; ") || (degradedRefs.size > 0
            ? t("No per-item failures were reported, but saved changes need follow-up.")
            : attempt.stopRequested
              ? t("Stopped after the current operation; remaining items were not started.")
            : t("Some write responses were uncertain; the current tags were checked again.")),
        }) });
      }
    } catch (error) {
      publishTagProgress(attempt, { phase: uncertainRefs.size ? "unknown" : "paused", refreshState: "unavailable", currentSubject: "", currentTag: "" });
      if (currentWorkspaceID.current === operationWorkspaceID) {
        notify({ kind: "warning", text: t("Tag batch follow-up could not be completed: {{reason}}", {
          reason: error instanceof Error ? error.message : t("The tag write outcome could not be confirmed."),
        }) });
      }
    } finally {
      if (isCurrentTagMutation(attempt)) {
        tagMutationAttemptRef.current = null;
        setBusy(false);
      }
    }
  }

  function addSelectionTagToQueue() {
    if (tagMutationAttemptRef.current || tagRefreshAttemptRef.current) return;
    const body = selectionTagQueueDraft.trim();
    if (!body) return;
    if (!tagActionsReady) {
      notify({ kind: "warning", text: tagActionsUnavailableMessage || t("Tags and favorites could not be read. Retry before editing them.") });
      return;
    }
    if (selectionTagQueue.includes(body)) {
      notify({ kind: "warning", text: t("Tag {{tag}} is already in the pending list.", { tag: body }) });
      return;
    }
    if (selectionTagQueue.length >= 20) {
      notify({ kind: "warning", text: t("You can queue up to {{count}} tags at a time.", { count: 20 }) });
      return;
    }
    // A tag is one exact string. In particular, commas are never separators.
    setSelectionTagQueue((current) => current.length < 20 && !current.includes(body) ? [...current, body] : current);
    setSelectionTagQueueDraft("");
  }

  function removeQueuedSelectionTag(tag: string) {
    if (tagMutationAttemptRef.current || tagRefreshAttemptRef.current) return;
    setSelectionTagQueue((current) => current.filter((value) => value !== tag));
  }

  function clearQueuedSelectionTags() {
    if (tagMutationAttemptRef.current || tagRefreshAttemptRef.current) return;
    setSelectionTagQueue([]);
  }

  async function applySelectionTagQueue() {
    const tags = [...selectionTagQueue];
    const prepared = prepareSelectionTagMutation(tags.length > 0);
    if (!prepared) return;
    const { operationWorkspaceID, targets, capturedRefs } = prepared;
    const attempt = beginTagMutation("queued", "queued", targets.length, tags.length, targets.map((hit) => hit.subject_ref));
    const progressCounts = { startedSubjects: 0, settledSubjects: 0, startedItemTags: 0, settledItemTags: 0, startedWrites: 0 };
    notify({ kind: "warning", text: t("Checking {{tags}} queued tags across {{count}} selected items.", { tags: tags.length, count: targets.length }) });

    const changedByTag = new Map<string, Set<string>>(tags.map((tag) => [tag, new Set<string>()] as const));
    const unchangedByTag = new Map<string, Set<string>>(tags.map((tag) => [tag, new Set<string>()] as const));
    const visitedRefs = new Set<string>();
    const failures: Array<{ name: string; message: string }> = [];
    const degradedSubjects = new Set<string>();
    const uncertainSubjects = new Set<string>();
    const degradedMessages: string[] = [];
    const confirmedAnnotations = new Map<string, AnnotationRecord[]>();
    const publishProgress = (currentSubject = "", currentTag = "") => publishTagProgress(attempt, {
      ...progressCounts,
      changed: [...changedByTag.values()].reduce((sum, refs) => sum + refs.size, 0),
      unchanged: [...unchangedByTag.values()].reduce((sum, refs) => sum + refs.size, 0),
      uncertain: uncertainSubjects.size,
      currentSubject,
      currentTag,
    });
    let anyMutationAttempted = false;
    let stopFurtherWrites = false;
    let omittedDegradedMessages = false;

    function recordDegradedResponse(subjectRef: string, label: string, response: { status?: string; reasons?: Array<{ message?: string }> }) {
      if (response.status === "SUCCEEDED") return;
      degradedSubjects.add(subjectRef);
      const messages = response.reasons?.map((reason) => reason.message?.trim()).filter((message): message is string => Boolean(message)) ?? [];
      if (messages.length === 0) messages.push(t("A saved change needs follow-up."));
      for (const message of messages) {
        const localized = t(message);
        const bounded = localized.length > 240 ? `${localized.slice(0, 240)}…` : localized;
        const summary = t("{{name}}: {{reason}}", { name: label.slice(0, 120), reason: bounded });
        if (degradedMessages.includes(summary)) continue;
        if (degradedMessages.length >= 3) { omittedDegradedMessages = true; break; }
        degradedMessages.push(summary);
      }
    }

    try {
      for (const hit of targets) {
        if (!isCurrentTagMutation(attempt)) return;
        if (attempt.stopRequested) break;
        const subjectRef = hit.subject_ref;
        const subjectStartedBefore = progressCounts.startedItemTags;
        const subjectSettledBefore = progressCounts.settledItemTags;
        progressCounts.startedSubjects += 1;
        const label = hit.name?.trim() || subjectRef || t("Untitled subject");
        publishProgress(label);
        if (!subjectRef) {
          failures.push({ name: label, message: t("This item has no stable subject reference.") });
          stopFurtherWrites = true;
          break;
        }
        visitedRefs.add(subjectRef);
        let currentAnnotations: AnnotationRecord[];
        try {
          currentAnnotations = await readCompleteSubjectAnnotations(operationWorkspaceID, subjectRef);
        } catch (error) {
          if (!isCurrentTagMutation(attempt)) return;
          failures.push({ name: label, message: error instanceof Error ? error.message : t("The complete tag and note list is unavailable; nothing was changed for this item.") });
          stopFurtherWrites = true;
          break;
        }
        if (!isCurrentTagMutation(attempt)) return;
        if (attempt.stopRequested) break;

        for (const tag of tags) {
          if (!isCurrentTagMutation(attempt)) return;
          if (attempt.stopRequested) break;
          progressCounts.startedItemTags += 1;
          publishProgress(label, tag);
          const matches = currentAnnotations.filter((record) => record.kind === "TAG" && record.body?.trim() === tag);
          if (matches.length > 0) {
            unchangedByTag.get(tag)?.add(subjectRef);
            progressCounts.settledItemTags += 1;
            publishProgress(label, tag);
            continue;
          }

          let response: { status?: string; reasons?: Array<{ message?: string }> };
          try {
            anyMutationAttempted = true;
            progressCounts.startedWrites += 1;
            publishProgress(label, tag);
            response = await command(operations.annotation.upsert, {
              workspace_id: operationWorkspaceID,
              subject_ref: subjectRef,
              kind: "TAG",
              body: tag,
              expected_revision: 0,
            });
          } catch (error) {
            if (!isCurrentTagMutation(attempt)) return;
            const reason = error instanceof Error ? error.message : t("The tag write outcome could not be confirmed.");
            try {
              const observed = await readCompleteSubjectAnnotations(operationWorkspaceID, subjectRef);
              confirmedAnnotations.set(subjectRef, observed);
              currentAnnotations = observed;
              uncertainSubjects.add(subjectRef);
              if (observed.some((record) => record.kind === "TAG" && record.body?.trim() === tag)) {
                changedByTag.get(tag)?.add(subjectRef);
              } else {
                failures.push({ name: label, message: reason });
              }
              progressCounts.settledItemTags += 1;
            } catch {
              failures.push({ name: label, message: t("The tag write outcome is unknown because the current tag and note list could not be read: {{reason}}", { reason }) });
            }
            publishProgress(label, tag);
            stopFurtherWrites = true;
            break;
          }
          recordDegradedResponse(subjectRef, label, response);
          try {
            const after = await readCompleteSubjectAnnotations(operationWorkspaceID, subjectRef);
            confirmedAnnotations.set(subjectRef, after);
            currentAnnotations = after;
            if (after.some((record) => record.kind === "TAG" && record.body?.trim() === tag)) {
              changedByTag.get(tag)?.add(subjectRef);
            } else {
              failures.push({ name: label, message: t("The tag list did not confirm the requested change.") });
              stopFurtherWrites = true;
            }
            progressCounts.settledItemTags += 1;
            publishProgress(label, tag);
            if (stopFurtherWrites) break;
          } catch (error) {
            if (!isCurrentTagMutation(attempt)) return;
            failures.push({ name: label, message: t("The tag write was sent, but its result could not be confirmed: {{reason}}", { reason: error instanceof Error ? error.message : t("The tag write outcome could not be confirmed.") }) });
            stopFurtherWrites = true;
            break;
          }
          // A degraded response may represent a saved write with unfinished
          // follow-up. Readback above records its state; pause the rest of this
          // batch so it can be reconciled before another tag is written.
          if (response.status !== "SUCCEEDED") {
            stopFurtherWrites = true;
            break;
          }
        }
        if (progressCounts.startedItemTags - subjectStartedBefore === tags.length
          && progressCounts.settledItemTags - subjectSettledBefore === tags.length) progressCounts.settledSubjects += 1;
        publishProgress();
        if (stopFurtherWrites) break;
      }

      if (!isCurrentTagMutation(attempt)) return;
      if (stopFurtherWrites) {
        for (const subjectRef of capturedRefs) {
          if (!visitedRefs.has(subjectRef)) failures.push({ name: subjectRef, message: t("Not attempted because an earlier tag write needed reconciliation.") });
        }
      }
      const reread = await library.reloadTagVocabulary(operationWorkspaceID);
      if (!isCurrentTagMutation(attempt)) return;
      if (reread.status === "ready" && reread.workspaceID === operationWorkspaceID) {
        for (const subjectRef of visitedRefs) library.syncTagCoverage(subjectRef, reread.records);
      } else {
        failures.push({ name: t("Tag coverage"), message: t("Tags and favorites could not be reread after the batch action.") });
      }
      const detailRef = selected?.subject_ref?.trim() ?? "";
      const detailAnnotations = detailRef ? confirmedAnnotations.get(detailRef) : undefined;
      if (details.detailSubjectRef.current === detailRef && detailRef && detailAnnotations) details.setAnnotations(detailAnnotations);
      if (anyMutationAttempted) {
        await refreshCapabilities();
        if (!isCurrentTagMutation(attempt)) return;
      }
      const finalPhase = stopFurtherWrites || uncertainSubjects.size ? "unknown" : attempt.stopRequested ? "stopped" : failures.length || degradedSubjects.size ? "paused" : "complete";
      publishTagProgress(attempt, { phase: finalPhase, refreshState: reread.status === "ready" && reread.workspaceID === operationWorkspaceID ? "ready" : "unavailable", currentSubject: "", currentTag: "" });

      const completed = tags.reduce((sum, tag) => sum + (changedByTag.get(tag)?.size ?? 0) + (unchangedByTag.get(tag)?.size ?? 0), 0);
      const total = tags.length * targets.length;
      const failed = failures.length > 0 || degradedSubjects.size > 0 || uncertainSubjects.size > 0 || stopFurtherWrites || attempt.stopRequested;
      if (!failed) {
        setSelectionTagQueue((current) => current.length === tags.length && current.every((tag, index) => tag === tags[index]) ? [] : current);
        notify({ kind: "success", text: t("Applied {{tagCount}} queued tags: {{completed}} of {{total}} item-tag changes confirmed.", { tagCount: tags.length, completed, total }) });
      } else {
        const failureText = failures.map((failure) => `${failure.name}: ${failure.message}`).join("; ");
        const degradedText = [...degradedMessages, ...(omittedDegradedMessages ? [t("Additional degraded item reasons were omitted.")] : [])].join("; ");
        const pauseText = attempt.stopRequested
          ? t("Stopped after the current operation; remaining item-tag changes were not started.")
          : stopFurtherWrites ? t("Further writes stopped after an uncertain or incomplete operation; readback results are shown in the confirmed count.") : "";
        notify({ kind: "warning", text: t("Queued tags were applied to {{completed}} of {{total}} item-tag changes before the batch paused. {{failures}}", { completed, total, failures: [failureText, degradedText, pauseText].filter(Boolean).join("; ") }) });
      }
    } catch (error) {
      publishTagProgress(attempt, { phase: uncertainSubjects.size ? "unknown" : "paused", refreshState: "unavailable", currentSubject: "", currentTag: "" });
      if (currentWorkspaceID.current === operationWorkspaceID) {
        notify({ kind: "warning", text: t("Tag batch follow-up could not be completed: {{reason}}", { reason: error instanceof Error ? error.message : t("The tag write outcome could not be confirmed.") }) });
      }
    } finally {
      if (isCurrentTagMutation(attempt)) {
        tagMutationAttemptRef.current = null;
        setBusy(false);
      }
    }
  }

  function applySelectionTag() { return runSelectionTagMutation(selectionTagDraft, "add"); }
  function removeSelectionTag() { return runSelectionTagMutation(selectionTagDraft, "remove"); }
  function addSelectionFavorite() { return runSelectionTagMutation(FAVORITE_TAG, "add"); }
  function removeSelectionFavorite() { return runSelectionTagMutation(FAVORITE_TAG, "remove"); }

  return {
    selectionRefs,
    setSelectionRefs,
    selectionAnchor,
    setSelectionAnchor,
    rovingIndex,
    setRovingIndex,
    selectionTagDraft,
    setSelectionTagDraft,
    selectionTagQueue,
    selectionTagQueueDraft,
    setSelectionTagQueueDraft,
    selectionSubjects,
    tagMutationProgress,
    stopSelectionTagMutation,
    refreshSelectionTagState,
    tagActionsReady,
    tagActionsUnavailableMessage,
    rovingRow,
    selectionTagMatchCount,
    toggleSelectionAt,
    extendSelectionTo,
    selectAllVisible,
    changeScopeSelection,
    invertVisibleSelection,
    clearSelection,
    applySelectionTag,
    addSelectionTagToQueue,
    removeQueuedSelectionTag,
    clearQueuedSelectionTags,
    applySelectionTagQueue,
    removeSelectionTag,
    addSelectionFavorite,
    removeSelectionFavorite,
    handleLibraryKeyDown,
  };
}
