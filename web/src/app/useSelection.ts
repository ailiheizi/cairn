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
  selectionSubjects: SearchHit[];
  tagActionsReady: boolean;
  tagActionsUnavailableMessage: string;
  rovingRow: number;
  selectionTagMatchCount: (tag: string) => number;
  toggleSelectionAt: (index: number) => void;
  extendSelectionTo: (index: number) => void;
  selectAllVisible: () => void;
  clearSelection: () => void;
  applySelectionTag: () => Promise<void>;
  removeSelectionTag: () => Promise<void>;
  addSelectionFavorite: () => Promise<void>;
  removeSelectionFavorite: () => Promise<void>;
  handleLibraryKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
};

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
  const currentWorkspaceID = useRef(workspaceID);
  currentWorkspaceID.current = workspaceID;
  const tagMutationInFlight = useRef(false);

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
  function clearSelection() { setSelectionRefs([]); setSelectionAnchor(""); }

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

  async function runSelectionTagMutation(rawBody: string, action: "add" | "remove") {
    const body = rawBody.trim();
    const operationWorkspaceID = workspaceID;
    const targets = selectionSubjects.map((hit) => ({ ...hit, subject_ref: hit.subject_ref?.trim() ?? "" }));
    const capturedRefs = [...selectionRefs];
    if (!body || !operationWorkspaceID || targets.length === 0) return;
    if (!annotationStorageReady) { notify({ kind: "error", text: catalogStorageMessage }); return; }
    if (!tagSnapshotReady || !selectionResolved || capturedRefs.length !== targets.length) {
      notify({ kind: "warning", text: !tagSnapshotReady ? t("Tags and favorites could not be read. Retry before editing them.") : t("Some selected items are unavailable in this result scope. Batch tag actions are paused.") });
      return;
    }
    if (tagMutationInFlight.current) return;
    tagMutationInFlight.current = true;
    setBusy(true);
    notify({ kind: "warning", text: action === "add"
      ? t("Checking {{count}} selected items before adding tag {{tag}}.", { count: targets.length, tag: body })
      : t("Checking {{count}} selected items before removing tag {{tag}}.", { count: targets.length, tag: body }) });

    const changedRefs = new Set<string>();
    const unchangedRefs = new Set<string>();
    const failures: Array<{ name: string; message: string }> = [];
    const degradedRefs = new Set<string>();
    const uncertainRefs = new Set<string>();
    const confirmedAnnotations = new Map<string, AnnotationRecord[]>();
    const visitedRefs = new Set<string>();
    const attemptedRefs = new Set<string>();
    let stopAfterUnknownMutation = false;
    let anyMutationAttempted = false;
    try {
      for (const hit of targets) {
        if (currentWorkspaceID.current !== operationWorkspaceID) break;
        const subjectRef = hit.subject_ref;
        if (subjectRef) visitedRefs.add(subjectRef);
        const label = hit.name?.trim() || subjectRef || t("Untitled subject");
        if (!subjectRef) {
          failures.push({ name: label, message: t("This item has no stable subject reference.") });
          continue;
        }
        let before: AnnotationRecord[];
        try {
          before = await readCompleteSubjectAnnotations(operationWorkspaceID, subjectRef);
        } catch (error) {
          if (currentWorkspaceID.current !== operationWorkspaceID) break;
          failures.push({ name: label, message: error instanceof Error ? error.message : t("The complete tag and note list is unavailable; nothing was changed for this item.") });
          continue;
        }
        const matches = before.filter((record) => record.kind === "TAG" && record.body?.trim() === body);
        if ((action === "add" && matches.length > 0) || (action === "remove" && matches.length === 0)) {
          unchangedRefs.add(subjectRef);
          confirmedAnnotations.set(subjectRef, before);
          continue;
        }

        let mutationOutcomeUnknown = false;
        try {
          if (action === "add") {
            if (currentWorkspaceID.current !== operationWorkspaceID) break;
            anyMutationAttempted = true;
            attemptedRefs.add(subjectRef);
            const response = await command(operations.annotation.upsert, {
              workspace_id: operationWorkspaceID,
              subject_ref: subjectRef,
              kind: "TAG",
              body,
              expected_revision: 0,
            });
            if (response.status !== "SUCCEEDED") degradedRefs.add(subjectRef);
          } else {
            for (const annotation of matches) {
              if (currentWorkspaceID.current !== operationWorkspaceID) break;
              const annotationID = annotation.annotation_id?.trim() ?? "";
              const expectedRevision = annotation.revision;
              if (!annotationID || !Number.isSafeInteger(expectedRevision) || (expectedRevision ?? 0) < 1) {
                throw new Error(t("Tag identity or revision is unavailable; this item's tag was not removed."));
              }
              anyMutationAttempted = true;
              attemptedRefs.add(subjectRef);
              const response = await command(operations.annotation.delete, {
                workspace_id: operationWorkspaceID,
                annotation_id: annotationID,
                expected_revision: expectedRevision,
              });
              if (response.status !== "SUCCEEDED") degradedRefs.add(subjectRef);
            }
          }
        } catch (error) {
          if (currentWorkspaceID.current !== operationWorkspaceID) break;
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
          } else {
            failures.push({ name: label, message: t("The tag write outcome is unknown because the current tag and note list could not be read: {{reason}}", { reason }) });
          }
          if (mutationOutcomeUnknown) { stopAfterUnknownMutation = true; break; }
          continue;
        }
        if (currentWorkspaceID.current !== operationWorkspaceID) break;
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
        } catch (error) {
          if (currentWorkspaceID.current !== operationWorkspaceID) break;
          failures.push({ name: label, message: t("The tag write was sent, but its result could not be confirmed: {{reason}}", { reason: error instanceof Error ? error.message : t("The tag write outcome could not be confirmed.") }) });
          stopAfterUnknownMutation = true;
          break;
        }
        if (stopAfterUnknownMutation) break;
      }

      if (currentWorkspaceID.current !== operationWorkspaceID) return;
      if (stopAfterUnknownMutation) {
        for (const hit of targets) {
          const subjectRef = hit.subject_ref;
          if (subjectRef && !visitedRefs.has(subjectRef)) {
            failures.push({ name: hit.name?.trim() || subjectRef, message: t("Not attempted because an earlier tag write needed reconciliation.") });
          }
        }
      }
      const reread = await library.reloadTagVocabulary(operationWorkspaceID);
      if (currentWorkspaceID.current !== operationWorkspaceID) return;
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
        if (currentWorkspaceID.current !== operationWorkspaceID) return;
      }

      const failureText = failures.map((failure) => `${failure.name}: ${failure.message}`).join("; ");
      const completed = changedRefs.size + unchangedRefs.size;
      const actionLabel = action === "add" ? t("added") : t("removed");
      if (failures.length === 0 && degradedRefs.size === 0 && uncertainRefs.size === 0) {
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
          failures: failureText || (degradedRefs.size > 0
            ? t("No per-item failures were reported, but the daemon reported degraded search indexing.")
            : t("Some write responses were uncertain; the current tags were checked again.")),
        }) });
      }
    } catch (error) {
      if (currentWorkspaceID.current === operationWorkspaceID) {
        notify({ kind: "warning", text: t("Tag batch follow-up could not be completed: {{reason}}", {
          reason: error instanceof Error ? error.message : t("The tag write outcome could not be confirmed."),
        }) });
      }
    } finally {
      tagMutationInFlight.current = false;
      setBusy(false);
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
    selectionSubjects,
    tagActionsReady,
    tagActionsUnavailableMessage,
    rovingRow,
    selectionTagMatchCount,
    toggleSelectionAt,
    extendSelectionTo,
    selectAllVisible,
    clearSelection,
    applySelectionTag,
    removeSelectionTag,
    addSelectionFavorite,
    removeSelectionFavorite,
    handleLibraryKeyDown,
  };
}
