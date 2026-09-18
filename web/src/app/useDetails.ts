import { useRef, useState } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import type { LibraryDraftsFlow } from "./useLibraryDrafts";
import type { LibraryFlow } from "./useLibrary";
import type { ViewMode } from "../lib/types";
import type { AnnotationRecord, DetailCollection, DetailResourceStatus, DetailState, Notice, SearchHit } from "../lib/types";
import type { Result } from "./command";

// The details inspector's subject-bound reads and note/tag writes.
//
// Every read is bound to the selected subject and every write is guarded by
// the current request token: a late response from a previous subject must
// never populate the current inspector. Notes and tags become durable only
// through `annotation.upsert`/`annotation.delete`.

function subjectBoundDetailCollection(result: PromiseSettledResult<Result>, key: "annotations" | "documents" | "representations", subjectRef: string): DetailCollection {
  if (result.status !== "fulfilled" || result.value.status !== "SUCCEEDED") return { status: "error", items: [] };
  const data = result.value.data;
  const items = data?.[key];
  if (!Array.isArray(items)) return { status: "error", items: [] };
  if (key === "representations") {
    return typeof data?.subject_ref === "string" && data.subject_ref.trim() === subjectRef
      ? { status: "ready", items }
      : { status: "error", items: [] };
  }
  return items.every((item) => typeof item?.subject_ref === "string" && item.subject_ref.trim() === subjectRef)
    ? { status: "ready", items }
    : { status: "error", items: [] };
}

function annotationBelongsToSubject(annotation: unknown, subjectRef: string): annotation is AnnotationRecord {
  return Boolean(subjectRef && typeof annotation === "object" && annotation && typeof (annotation as AnnotationRecord).subject_ref === "string" && (annotation as AnnotationRecord).subject_ref?.trim() === subjectRef);
}

export type DetailsFlow = {
  annotations: any[];
  setAnnotations: (value: any[] | ((current: any[]) => any[])) => void;
  representations: any[];
  descriptions: any[];
  descriptionsTruncated: boolean;
  mediaFacts: any[];
  mediaFactsState: "idle" | "loading" | "ready" | "error";
  track: any | undefined;
  work: any | undefined;
  detailState: DetailState;
  detailSubjectRef: { current: string };
  loadDetails: (hit: SearchHit) => Promise<void>;
  closeDetails: () => void;
  saveNote: (annotationID?: string, body?: string, expectedRevision?: number, annotationSubjectRef?: string) => Promise<void>;
  saveTag: () => Promise<void>;
  deleteTag: (tag: any) => Promise<void>;
  deleteNote: (note: any) => Promise<void>;
  resetDetailProjection: () => void;
};

export function useDetails({ t, workspaceID, selected, setSelected, drafts, library, setViewMode, annotationStorageReady, catalogStorageMessage, refreshCapabilities, setBusy, notify }: {
  t: Translator;
  workspaceID: string;
  selected: SearchHit | undefined;
  setSelected: (hit: SearchHit | undefined) => void;
  drafts: LibraryDraftsFlow;
  library: LibraryFlow;
  setViewMode: (mode: ViewMode) => void;
  annotationStorageReady: boolean;
  catalogStorageMessage: string;
  refreshCapabilities: () => Promise<void>;
  setBusy: (value: boolean) => void;
  notify: (notice: Notice | undefined) => void;
}): DetailsFlow {
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [representations, setRepresentations] = useState<any[]>([]);
  const [descriptions, setDescriptions] = useState<any[]>([]);
  const [descriptionsTruncated, setDescriptionsTruncated] = useState(false);
  const [mediaFacts, setMediaFacts] = useState<any[]>([]);
  const [mediaFactsState, setMediaFactsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [track, setTrack] = useState<any | undefined>(undefined);
  const [work, setWork] = useState<any | undefined>(undefined);
  const [detailState, setDetailState] = useState<DetailState>({ subjectRef: "", annotations: "idle", representations: "idle", descriptions: "idle" });
  const detailRequestRef = useRef(0);
  const detailSubjectRef = useRef("");
  const libraryReturnScrollY = useRef(0);

  function detailIsCurrent(subjectRef: string, requestToken = detailRequestRef.current) {
    return detailRequestRef.current === requestToken && detailSubjectRef.current === subjectRef;
  }
  function detailAnnotationsReady(subjectRef: string) {
    return detailState.subjectRef === subjectRef && detailSubjectRef.current === subjectRef && detailState.annotations === "ready";
  }
  async function loadDetails(hit: SearchHit) {
    const subjectRef = hit.subject_ref?.trim() ?? "";
    if (selected?.subject_ref?.trim() === subjectRef) return;
    if (selected?.subject_ref?.trim() !== subjectRef && !drafts.canLeaveDetailDrafts()) return;
    libraryReturnScrollY.current = window.scrollY;
    const requestToken = ++detailRequestRef.current;
    detailSubjectRef.current = subjectRef;
    setSelected(hit); setAnnotations([]); setRepresentations([]); setDescriptions([]); setDescriptionsTruncated(false);
    setMediaFacts([]); setMediaFactsState("loading"); setTrack(undefined); setWork(undefined);
    drafts.discardDetailDrafts();
    setDetailState({ subjectRef, annotations: "loading", representations: "loading", descriptions: "loading" });
    if (!workspaceID || !subjectRef) {
      setDetailState({ subjectRef, annotations: "error", representations: "error", descriptions: "error" });
      setMediaFactsState("error");
      return;
    }
    // Media facts are a background read on the same subject: an operation this
    // build does not implement (or a subject with no declared facts) renders
    // as an honest absence, never as a fabricated row.
    void (async () => {
      try {
        const factsResponse = await command(operations.subjectFacts.list, { workspace_id: workspaceID, subject_ref: subjectRef });
        if (detailRequestRef.current !== requestToken || detailSubjectRef.current !== subjectRef) return;
        const facts = Array.isArray(factsResponse.data?.facts) ? factsResponse.data.facts : [];
        setMediaFacts(facts);
        setMediaFactsState("ready");
      } catch {
        if (detailRequestRef.current !== requestToken || detailSubjectRef.current !== subjectRef) return;
        setMediaFacts([]); setMediaFactsState("error");
      }
    })();
    // Track and work metadata come from the daemon's own audio/books
    // projections. Their failure degrades to "no declared track/work", which
    // is exactly what an unextracted file means.
    void (async () => {
      try {
        const [audioResult, booksResult] = await Promise.allSettled([
          command(operations.audio.list, { workspace_id: workspaceID }),
          command(operations.books.list, { workspace_id: workspaceID }),
        ]);
        if (detailRequestRef.current !== requestToken || detailSubjectRef.current !== subjectRef) return;
        if (audioResult.status === "fulfilled" && audioResult.value.status === "SUCCEEDED") {
          const tracks = audioResult.value.data?.tracks ?? [];
          const matched = tracks.find((item: any) => item?.subject_ref?.trim() === subjectRef);
          if (matched) setTrack(matched);
        }
        if (booksResult.status === "fulfilled" && booksResult.value.status === "SUCCEEDED") {
          const works = booksResult.value.data?.works ?? [];
          const matched = works.find((item: any) => item?.subject_ref?.trim() === subjectRef);
          if (matched) setWork(matched);
        }
      } catch { /* an absent projection stays an absent row */ }
    })();
    const requests = await Promise.allSettled([
      command(operations.annotation.list, { workspace_id: workspaceID, subject_ref: subjectRef }),
      command(operations.representation.list, { workspace_id: workspaceID, subject_ref: subjectRef }),
      // Keep enough history to resolve the current note in the normal case.
      // If the server reports a longer chain, we fail closed below instead of
      // presenting an old revision as current.
      command(operations.description.list, { workspace_id: workspaceID, subject_ref: subjectRef, limit: 1000 }),
    ]);
    // A late response from a previous subject must never populate the current
    // inspector. The subject check is intentional in addition to the token:
    // it keeps detail writes bound to the durable Subject the user selected.
    if (detailRequestRef.current !== requestToken || detailSubjectRef.current !== subjectRef) return;
    const annotationResult = subjectBoundDetailCollection(requests[0], "annotations", subjectRef);
    const representationResult = subjectBoundDetailCollection(requests[1], "representations", subjectRef);
    const descriptionResult = subjectBoundDetailCollection(requests[2], "documents", subjectRef);
    const descriptionTruncated = requests[2].status === "fulfilled" && requests[2].value.data?.truncated === true;
    // Truncation is a partial-success condition: the returned Notes remain
    // useful and must stay visible, with an explicit indication that history
    // continues beyond this bounded response.
    const descriptionState: DetailResourceStatus = descriptionResult.status;
    setDescriptionsTruncated(descriptionTruncated);
    setDetailState({
      subjectRef,
      annotations: annotationResult.status,
      representations: representationResult.status,
      descriptions: descriptionState,
    });
    setAnnotations(annotationResult.items);
    setRepresentations(representationResult.items);
    // Keep summary rows out of the visible Notes list until their bodies have
    // been read. This prevents a title or a transient placeholder from
    // looking like the actual note text.
    setDescriptions([]);
    if (descriptionState !== "ready" || descriptionResult.items.length === 0) return;
    // description.list deliberately returns bounded summaries. Hydrate the
    // bodies for this one subject so the single Notes view shows the actual
    // text while keeping the list endpoint small for broader callers. User
    // notes are already visible while these extra reads are in flight.
    const hydrated = await Promise.allSettled(descriptionResult.items.map((item) => command(operations.description.get, {
      workspace_id: workspaceID,
      description_document_id: item.description_document_id,
    })));
    if (detailRequestRef.current !== requestToken || detailSubjectRef.current !== subjectRef) return;
    const descriptionItems = descriptionResult.items.map((summary, index) => {
      const result = hydrated[index];
      if (result?.status === "fulfilled" && result.value.status === "SUCCEEDED") {
        const document = result.value.data?.document;
        if (document?.subject_ref?.trim() === subjectRef) return document;
      }
      return { ...summary, body_unavailable: true };
    });
    setDescriptions(descriptionItems);
    setDetailState((current) => current.subjectRef === subjectRef && detailSubjectRef.current === subjectRef
      ? { ...current, descriptions: "ready" }
      : current);
  }
  async function saveNote(annotationID = "", body = "", expectedRevision = 0, annotationSubjectRef = "") {
    const subjectRef = selected?.subject_ref?.trim() ?? "";
    if (!annotationStorageReady || !subjectRef || !body.trim() || !workspaceID || !detailAnnotationsReady(subjectRef) || (annotationID && annotationSubjectRef.trim() !== subjectRef)) { if (!annotationStorageReady) notify({ kind: "error", text: catalogStorageMessage }); return; }
    const requestToken = detailRequestRef.current;
    setBusy(true);
    try {
      const response = await command(operations.annotation.upsert, { workspace_id: workspaceID, subject_ref: subjectRef, kind: "NOTE", body: body.trim(), annotation_id: annotationID || undefined, expected_revision: expectedRevision });
      if (!detailIsCurrent(subjectRef, requestToken)) return;
      setAnnotations((items) => annotationID ? items.map((item) => item.annotation_id === annotationID ? response.data.annotation : item) : [...items, response.data.annotation]);
      drafts.setNoteDraft(""); drafts.setEditingNoteID(""); drafts.setEditingBody(""); drafts.setEditingOriginalBody("");
      await refreshCapabilities();
      const degraded = response.status === "DEGRADED";
      notify({ kind: degraded ? "warning" : "success", text: degraded
        ? t(annotationID ? "Note updated, but search indexing is unavailable." : "Note added, but search indexing is unavailable.")
        : t(annotationID ? "Note updated." : "Note added.") });
    }
    catch (error) { notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not save annotation") }); }
    finally { setBusy(false); }
  }
  async function saveTag() {
    const body = drafts.tagDraft.trim();
    const subjectRef = selected?.subject_ref?.trim() ?? "";
    if (!annotationStorageReady || !subjectRef || !workspaceID || !body || !detailAnnotationsReady(subjectRef)) { if (!annotationStorageReady) notify({ kind: "error", text: catalogStorageMessage }); return; }
    const requestToken = detailRequestRef.current;
    setBusy(true); notify(undefined);
    try {
      const response = await command(operations.annotation.upsert, { workspace_id: workspaceID, subject_ref: subjectRef, kind: "TAG", body, expected_revision: 0 });
      if (!detailIsCurrent(subjectRef, requestToken)) return;
      const annotation = response.data?.annotation;
      setAnnotations((items) => items.some((item) => item.annotation_id === annotation?.annotation_id) ? items : [...items, annotation]);
      drafts.setTagDraft("");
      const tags = await library.loadTagVocabulary(workspaceID);
      library.syncTagCoverage(subjectRef, tags);
      await refreshCapabilities();
      notify({ kind: response.status === "DEGRADED" ? "warning" : "success", text: t(response.status === "DEGRADED" ? "Tag added, but search indexing is unavailable." : "Tag added.") });
    } catch (error) {
      notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not save tag") });
    } finally { setBusy(false); }
  }
  async function deleteTag(tag: any) {
    const subjectRef = selected?.subject_ref?.trim() ?? "";
    if (!annotationStorageReady || !workspaceID || !subjectRef || !tag?.annotation_id || !tag?.revision || !detailAnnotationsReady(subjectRef) || !annotationBelongsToSubject(tag, subjectRef)) { if (!annotationStorageReady) notify({ kind: "error", text: catalogStorageMessage }); return; }
    const requestToken = detailRequestRef.current;
    setBusy(true); notify(undefined);
    try {
      const response = await command(operations.annotation.delete, { workspace_id: workspaceID, annotation_id: tag.annotation_id, expected_revision: tag.revision });
      if (!detailIsCurrent(subjectRef, requestToken)) return;
      setAnnotations((items) => items.filter((item) => item.annotation_id !== tag.annotation_id));
      const remainingTags = await library.loadTagVocabulary(workspaceID);
      library.syncTagCoverage(subjectRef, remainingTags);
      const removedValue = typeof tag.body === "string" ? tag.body.trim() : "";
      if (removedValue && library.activeTags.includes(removedValue) && !remainingTags.some((item) => item.body?.trim() === removedValue)) {
        const next = library.activeTags.filter((value) => value !== removedValue);
        library.setActiveTags(next);
        if (next.length === 0) {
          library.setHits(library.facetFilteredItems); setSelected(undefined); setViewMode(library.hasSystemFacets ? "tag" : "content");
        }
      }
      await refreshCapabilities();
      notify({ kind: response.status === "DEGRADED" ? "warning" : "success", text: t(response.status === "DEGRADED" ? "Tag removed, but search indexing is unavailable." : "Tag removed.") });
    } catch (error) {
      notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not remove tag") });
    } finally { setBusy(false); }
  }
  async function deleteNote(note: any) {
    const subjectRef = selected?.subject_ref?.trim() ?? "";
    if (!annotationStorageReady || !workspaceID || !subjectRef || !note?.annotation_id || !note?.revision || !detailAnnotationsReady(subjectRef) || !annotationBelongsToSubject(note, subjectRef) || !window.confirm(t("Delete this note?"))) { if (!annotationStorageReady) notify({ kind: "error", text: catalogStorageMessage }); return; }
    const requestToken = detailRequestRef.current;
    setBusy(true); notify(undefined);
    try {
      const response = await command(operations.annotation.delete, { workspace_id: workspaceID, annotation_id: note.annotation_id, expected_revision: note.revision });
      if (!detailIsCurrent(subjectRef, requestToken)) return;
      setAnnotations((items) => items.filter((item) => item.annotation_id !== note.annotation_id));
      drafts.setEditingNoteID(""); drafts.setEditingBody(""); drafts.setEditingOriginalBody("");
      await refreshCapabilities();
      notify({ kind: response.status === "DEGRADED" ? "warning" : "success", text: t(response.status === "DEGRADED" ? "Note deleted, but search indexing is unavailable." : "Note deleted.") });
    } catch (error) {
      notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not delete note") });
    } finally { setBusy(false); }
  }
  function closeDetails() {
    if (!drafts.canLeaveDetailDrafts()) return;
    detailRequestRef.current += 1;
    detailSubjectRef.current = "";
    setDetailState({ subjectRef: "", annotations: "idle", representations: "idle", descriptions: "idle" });
    setMediaFacts([]); setMediaFactsState("idle"); setTrack(undefined); setWork(undefined);
    drafts.discardDetailDrafts();
    setSelected(undefined);
    requestAnimationFrame(() => window.scrollTo({ top: libraryReturnScrollY.current, left: 0, behavior: "auto" }));
  }
  function resetDetailProjection() {
    detailRequestRef.current += 1; detailSubjectRef.current = "";
    setAnnotations([]); setRepresentations([]); setDescriptions([]); setDescriptionsTruncated(false);
    setMediaFacts([]); setMediaFactsState("idle"); setTrack(undefined); setWork(undefined);
    setDetailState({ subjectRef: "", annotations: "idle", representations: "idle", descriptions: "idle" });
  }

  return {
    annotations,
    setAnnotations,
    representations,
    descriptions,
    descriptionsTruncated,
    mediaFacts,
    mediaFactsState,
    track,
    work,
    detailState,
    detailSubjectRef,
    loadDetails,
    closeDetails,
    saveNote,
    saveTag,
    deleteTag,
    deleteNote,
    resetDetailProjection,
  };
}
