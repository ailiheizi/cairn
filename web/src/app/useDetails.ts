import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import type { LibraryDraftsFlow } from "./useLibraryDrafts";
import type { LibraryFlow } from "./useLibrary";
import type { AnnotationRecord, DetailCollection, DetailResourceStatus, DetailState, Notice, SearchHit } from "../lib/types";
import type { Result } from "./command";
import { activeBrowsePositionToken, captureActiveBrowsePosition, pauseBrowsePositionToken, releaseBrowsePositionToken, restoreBrowsePositionToken, type BrowsePositionRegistry, type BrowsePositionToken } from "./ClientBrowseSession";
import { CURRENT_DESCRIPTION_PAGE_SIZE, readCurrentDescriptionPage, type CurrentDescriptionPageSet, type CurrentDescriptionSummary } from "../lib/descriptionPages";

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

function committedAnnotationNotice(response: Result, success: string, degraded: string, degradedWithReason: string, t: Translator): Notice {
  if (response.status !== "DEGRADED") return { kind: "success", text: t(success) };
  const reasons = response.reasons?.map((item) => item.message?.trim()).filter((message): message is string => Boolean(message));
  const reason = reasons?.map((message) => t(message)).join("; ");
  return { kind: "warning", text: reason ? t(degradedWithReason, { reason }) : t(degraded) };
}

async function hydrateDescriptionSummaries(workspaceID: string, subjectRef: string, summaries: CurrentDescriptionSummary[]): Promise<any[]> {
  const hydrated = await Promise.allSettled(summaries.map((summary) => command(operations.description.get, {
    workspace_id: workspaceID,
    description_document_id: summary.description_document_id,
  })));
  return summaries.map((summary, index) => {
    const result = hydrated[index];
    if (result?.status === "fulfilled" && result.value.status === "SUCCEEDED") {
      const document = result.value.data?.document;
      const documentID = typeof document?.description_document_id === "string"
        ? document.description_document_id
        : typeof document?.id === "string" ? document.id : "";
      if (document?.subject_ref?.trim() === subjectRef
        && documentID === summary.description_document_id
        && document?.revision === summary.revision
        && typeof document?.body === "string") return document;
    }
    return { ...summary, body_unavailable: true };
  });
}

export type DetailsFlow = {
  annotations: any[];
  setAnnotations: (value: any[] | ((current: any[]) => any[])) => void;
  representations: any[];
  descriptions: any[];
  descriptionsTruncated: boolean;
  descriptionsTotal: number;
  descriptionsPagePending: boolean;
  descriptionsPageError: string;
  mediaFacts: any[];
  mediaFactsState: "idle" | "loading" | "ready" | "error";
  track: any | undefined;
  work: any | undefined;
  detailState: DetailState;
  detailSubjectRef: { current: string };
  navigation?: { position: number; total: number; previous: () => void; next: () => void };
  loadDetails: (hit: SearchHit, returnFocusSubject?: string) => Promise<void>;
  loadMoreDescriptions: () => Promise<void>;
  refreshDescriptions: () => Promise<void>;
  closeDetails: () => void;
  saveNote: (annotationID?: string, body?: string, expectedRevision?: number, annotationSubjectRef?: string) => Promise<void>;
  saveTag: () => Promise<void>;
  deleteTag: (tag: any) => Promise<void>;
  deleteNote: (note: any) => Promise<void>;
  resetDetailProjection: () => void;
};

type DetailsNavigationContext = {
  workspaceID: string;
  selected?: SearchHit;
  hits: SearchHit[];
  busy: boolean;
  loadDetails: (hit: SearchHit) => Promise<void>;
};

function detailsNavigationPosition(context: DetailsNavigationContext): { position: number; total: number } | undefined {
  if (!context.workspaceID) return undefined;
  const selected = context.selected;
  const subjectRef = selected?.subject_ref?.trim() ?? "";
  const entryID = selected?.entry_id?.trim() ?? "";
  const contentID = selected?.content_id?.trim() ?? "";
  if (!subjectRef || !entryID || !contentID || selected?.entry_type !== "REGULAR_FILE") return undefined;

  const files = context.hits.filter((hit) => hit.entry_type === "REGULAR_FILE"
    && Boolean(hit.subject_ref?.trim()) && Boolean(hit.entry_id?.trim()) && Boolean(hit.content_id?.trim()));
  if (new Set(files.map((hit) => hit.subject_ref!.trim())).size !== files.length) return undefined;
  const selectedSubjectRows = files.filter((hit) => hit.subject_ref?.trim() === subjectRef);
  const selectedRows = files.filter((hit) => hit.subject_ref?.trim() === subjectRef
    && hit.entry_id?.trim() === entryID && hit.content_id?.trim() === contentID);
  // Fail closed when the selected subject or its exact result tuple is
  // ambiguous. In particular, never step to a second version of one subject.
  if (selectedSubjectRows.length !== 1 || selectedRows.length !== 1 || files.length < 2) return undefined;
  const position = files.indexOf(selectedRows[0]);
  return position < 0 ? undefined : { position: position + 1, total: files.length };
}

export function useDetails({ t, workspaceID, selected, setSelected, drafts, library, browsePositionRegistry, getBrowseContextIdentity, annotationStorageReady, catalogStorageMessage, refreshCapabilities, busy, setBusy, notify }: {
  t: Translator;
  workspaceID: string;
  selected: SearchHit | undefined;
  setSelected: (hit: SearchHit | undefined) => void;
  drafts: LibraryDraftsFlow;
  library: LibraryFlow;
  browsePositionRegistry: BrowsePositionRegistry;
  getBrowseContextIdentity: () => string;
  annotationStorageReady: boolean;
  catalogStorageMessage: string;
  refreshCapabilities: () => Promise<void>;
  busy: boolean;
  setBusy: (value: boolean) => void;
  notify: (notice: Notice | undefined) => void;
}): DetailsFlow {
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [representations, setRepresentations] = useState<any[]>([]);
  const [descriptions, setDescriptions] = useState<any[]>([]);
  const [descriptionsTruncated, setDescriptionsTruncated] = useState(false);
  const [descriptionProjection, setDescriptionProjection] = useState<CurrentDescriptionPageSet | null>(null);
  const descriptionProjectionRef = useRef<CurrentDescriptionPageSet | null>(null);
  const [descriptionsPagePending, setDescriptionsPagePending] = useState(false);
  const [descriptionsPageError, setDescriptionsPageError] = useState("");
  const descriptionPageRequestRef = useRef(0);
  const [mediaFacts, setMediaFacts] = useState<any[]>([]);
  const [mediaFactsState, setMediaFactsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [track, setTrack] = useState<any | undefined>(undefined);
  const [work, setWork] = useState<any | undefined>(undefined);
  const [detailState, setDetailState] = useState<DetailState>({ subjectRef: "", annotations: "idle", representations: "idle", descriptions: "idle" });
  const detailRequestRef = useRef(0);
  const detailSubjectRef = useRef("");
  const currentDetailContextRef = useRef({ workspaceID, subjectRef: selected?.subject_ref?.trim() ?? "" });
  currentDetailContextRef.current = { workspaceID, subjectRef: selected?.subject_ref?.trim() ?? "" };
  const latestDraftsRef = useRef({
    noteDraft: drafts.noteDraft,
    tagDraft: drafts.tagDraft,
    editingNoteID: drafts.editingNoteID,
    editingBody: drafts.editingBody,
  });
  useLayoutEffect(() => {
    latestDraftsRef.current = {
      noteDraft: drafts.noteDraft,
      tagDraft: drafts.tagDraft,
      editingNoteID: drafts.editingNoteID,
      editingBody: drafts.editingBody,
    };
  }, [drafts.editingBody, drafts.editingNoteID, drafts.noteDraft, drafts.tagDraft]);
  const detailReturnBrowseRef = useRef<{ kind: "managed"; token: BrowsePositionToken; context: string } | { kind: "window"; scrollY: number; context: string } | undefined>(undefined);
  const browseContextGetterRef = useRef(getBrowseContextIdentity);
  browseContextGetterRef.current = getBrowseContextIdentity;
  function releaseDetailReturnPosition() {
    const returnPosition = detailReturnBrowseRef.current;
    detailReturnBrowseRef.current = undefined;
    if (returnPosition?.kind === "managed") releaseBrowsePositionToken(browsePositionRegistry, returnPosition.token);
  }
  useEffect(() => {
    if (!selected) releaseDetailReturnPosition();
  }, [selected]);

  function detailIsCurrent(subjectRef: string, requestToken = detailRequestRef.current) {
    const current = currentDetailContextRef.current;
    return detailRequestRef.current === requestToken
      && detailSubjectRef.current === subjectRef
      && current.workspaceID === workspaceID
      && current.subjectRef === subjectRef;
  }
  function detailAnnotationsReady(subjectRef: string) {
    return detailState.subjectRef === subjectRef && detailSubjectRef.current === subjectRef && detailState.annotations === "ready";
  }
  async function loadDetails(hit: SearchHit, returnFocusSubject = "") {
    const subjectRef = hit.subject_ref?.trim() ?? "";
    if (selected?.subject_ref?.trim() === subjectRef) return;
    if (selected?.subject_ref?.trim() !== subjectRef && !drafts.canLeaveDetailDrafts()) return;
    if (!selected) {
      captureActiveBrowsePosition(browsePositionRegistry, returnFocusSubject);
      const token = activeBrowsePositionToken(browsePositionRegistry);
      const context = browseContextGetterRef.current();
      if (token) pauseBrowsePositionToken(browsePositionRegistry, token);
      detailReturnBrowseRef.current = token
        ? { kind: "managed", token, context }
        : { kind: "window", scrollY: window.scrollY, context };
    }
    const requestToken = ++detailRequestRef.current;
    const descriptionPageRequest = ++descriptionPageRequestRef.current;
    setDescriptionsPagePending(true);
    setDescriptionsPageError("");
    setDescriptionProjection(null);
    descriptionProjectionRef.current = null;
    detailSubjectRef.current = subjectRef;
    setSelected(hit); setAnnotations([]); setRepresentations([]); setDescriptions([]); setDescriptionsTruncated(false);
    setMediaFacts([]); setMediaFactsState("loading"); setTrack(undefined); setWork(undefined);
    drafts.discardDetailDrafts();
    setDetailState({ subjectRef, annotations: "loading", representations: "loading", descriptions: "loading" });
    if (!workspaceID || !subjectRef) {
      setDetailState({ subjectRef, annotations: "error", representations: "error", descriptions: "error" });
      setMediaFactsState("error");
      if (descriptionPageRequestRef.current === descriptionPageRequest) setDescriptionsPagePending(false);
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
      command(operations.description.list, { workspace_id: workspaceID, subject_ref: subjectRef, current_only: true, page: { limit: CURRENT_DESCRIPTION_PAGE_SIZE } }),
    ]);
    // A late response from a previous subject must never populate the current
    // inspector. The subject check is intentional in addition to the token:
    // it keeps detail writes bound to the durable Subject the user selected.
    if (detailRequestRef.current !== requestToken || detailSubjectRef.current !== subjectRef
      || descriptionPageRequestRef.current !== descriptionPageRequest) return;
    const annotationResult = subjectBoundDetailCollection(requests[0], "annotations", subjectRef);
    const representationResult = subjectBoundDetailCollection(requests[1], "representations", subjectRef);
    const descriptionRead = readCurrentDescriptionPage(
      requests[2].status === "fulfilled" ? requests[2].value : undefined,
      { workspaceID, subjectRef, limit: CURRENT_DESCRIPTION_PAGE_SIZE },
    );
    const descriptionState: DetailResourceStatus = descriptionRead.ok ? "ready" : "error";
    setDescriptionsTruncated(descriptionRead.ok && descriptionRead.value.hasMore);
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
    if (!descriptionRead.ok) {
      descriptionProjectionRef.current = null;
      setDescriptionProjection(null);
      setDescriptionsPageError(requests[2].status === "rejected"
        ? requests[2].reason instanceof Error ? requests[2].reason.message : String(requests[2].reason ?? "")
        : descriptionRead.reason);
      setDescriptionsPagePending(false);
      return;
    }
    descriptionProjectionRef.current = descriptionRead.value;
    setDescriptionProjection(descriptionRead.value);
    setDescriptionsPageError("");
    if (descriptionRead.value.documents.length === 0) {
      setDescriptionsPagePending(false);
      return;
    }
    const hydrated = await hydrateDescriptionSummaries(workspaceID, subjectRef, descriptionRead.value.documents);
    if (detailRequestRef.current !== requestToken || detailSubjectRef.current !== subjectRef
      || descriptionPageRequestRef.current !== descriptionPageRequest) return;
    setDescriptions(hydrated);
    setDetailState((current) => current.subjectRef === subjectRef && detailSubjectRef.current === subjectRef
      ? { ...current, descriptions: "ready" }
      : current);
    setDescriptionsPagePending(false);
  }
  async function refreshDescriptions() {
    const subjectRef = selected?.subject_ref?.trim() ?? "";
    const requestWorkspace = workspaceID;
    if (!subjectRef || !requestWorkspace || !detailIsCurrent(subjectRef) || descriptionsPagePending) return;
    const detailToken = detailRequestRef.current;
    const pageRequest = ++descriptionPageRequestRef.current;
    setDescriptionsPagePending(true);
    setDescriptionsPageError("");
    setDescriptions([]);
    setDescriptionProjection(null);
    descriptionProjectionRef.current = null;
    setDescriptionsTruncated(false);
    setDetailState((current) => current.subjectRef === subjectRef ? { ...current, descriptions: "loading" } : current);
    try {
      const response = await command(operations.description.list, {
        workspace_id: requestWorkspace,
        subject_ref: subjectRef,
        current_only: true,
        page: { limit: CURRENT_DESCRIPTION_PAGE_SIZE },
      });
      if (descriptionPageRequestRef.current !== pageRequest || !detailIsCurrent(subjectRef, detailToken)) return;
      const read = readCurrentDescriptionPage(response, { workspaceID: requestWorkspace, subjectRef, limit: CURRENT_DESCRIPTION_PAGE_SIZE });
      if (!read.ok) throw new Error(read.reason);
      const hydrated = await hydrateDescriptionSummaries(requestWorkspace, subjectRef, read.value.documents);
      if (descriptionPageRequestRef.current !== pageRequest || !detailIsCurrent(subjectRef, detailToken)) return;
      descriptionProjectionRef.current = read.value;
      setDescriptionProjection(read.value);
      setDescriptions(hydrated);
      setDescriptionsTruncated(read.value.hasMore);
      setDescriptionsPageError("");
      setDetailState((current) => current.subjectRef === subjectRef && detailSubjectRef.current === subjectRef
        ? { ...current, descriptions: "ready" }
        : current);
    } catch (error) {
      if (descriptionPageRequestRef.current !== pageRequest || !detailIsCurrent(subjectRef, detailToken)) return;
      descriptionProjectionRef.current = null;
      setDescriptionProjection(null);
      setDescriptions([]);
      setDescriptionsTruncated(false);
      setDescriptionsPageError(error instanceof Error ? error.message : String(error));
      setDetailState((current) => current.subjectRef === subjectRef && detailSubjectRef.current === subjectRef
        ? { ...current, descriptions: "error" }
        : current);
    } finally {
      if (descriptionPageRequestRef.current === pageRequest) setDescriptionsPagePending(false);
    }
  }

  async function loadMoreDescriptions() {
    const subjectRef = selected?.subject_ref?.trim() ?? "";
    const requestWorkspace = workspaceID;
    const previous = descriptionProjectionRef.current;
    if (!subjectRef || !requestWorkspace || !previous?.hasMore || previous.subjectRef !== subjectRef
      || previous.workspaceID !== requestWorkspace || !detailIsCurrent(subjectRef) || descriptionsPagePending) return;
    const detailToken = detailRequestRef.current;
    const pageRequest = ++descriptionPageRequestRef.current;
    setDescriptionsPagePending(true);
    setDescriptionsPageError("");
    try {
      const response = await command(operations.description.list, {
        workspace_id: requestWorkspace,
        subject_ref: subjectRef,
        current_only: true,
        page: { limit: CURRENT_DESCRIPTION_PAGE_SIZE, token: previous.token },
      });
      if (descriptionPageRequestRef.current !== pageRequest || !detailIsCurrent(subjectRef, detailToken) || descriptionProjectionRef.current !== previous) return;
      const read = readCurrentDescriptionPage(response, {
        workspaceID: requestWorkspace,
        subjectRef,
        limit: CURRENT_DESCRIPTION_PAGE_SIZE,
        previous,
      });
      if (!read.ok) throw new Error(read.reason);
      const newSummaries = read.value.documents.slice(previous.documents.length);
      const hydrated = await hydrateDescriptionSummaries(requestWorkspace, subjectRef, newSummaries);
      if (descriptionPageRequestRef.current !== pageRequest || !detailIsCurrent(subjectRef, detailToken) || descriptionProjectionRef.current !== previous) return;
      descriptionProjectionRef.current = read.value;
      setDescriptionProjection(read.value);
      setDescriptions((current) => [...current, ...hydrated]);
      setDescriptionsTruncated(read.value.hasMore);
      setDescriptionsPageError("");
      setDetailState((current) => current.subjectRef === subjectRef && detailSubjectRef.current === subjectRef
        ? { ...current, descriptions: "ready" }
        : current);
    } catch (error) {
      if (descriptionPageRequestRef.current !== pageRequest || !detailIsCurrent(subjectRef, detailToken)) return;
      // A failed token may refer to a changed projection. Do not keep old page
      // rows presented as current; the user can start a fresh first page.
      descriptionProjectionRef.current = null;
      setDescriptionProjection(null);
      setDescriptions([]);
      setDescriptionsTruncated(false);
      setDescriptionsPageError(error instanceof Error ? error.message : String(error));
      setDetailState((current) => current.subjectRef === subjectRef && detailSubjectRef.current === subjectRef
        ? { ...current, descriptions: "error" }
        : current);
    } finally {
      if (descriptionPageRequestRef.current === pageRequest) setDescriptionsPagePending(false);
    }
  }
  async function saveNote(annotationID = "", body = "", expectedRevision = 0, annotationSubjectRef = "") {
    const subjectRef = selected?.subject_ref?.trim() ?? "";
    if (!annotationStorageReady || !subjectRef || !body.trim() || !workspaceID || !detailAnnotationsReady(subjectRef) || (annotationID && annotationSubjectRef.trim() !== subjectRef)) { if (!annotationStorageReady) notify({ kind: "error", text: catalogStorageMessage }); return; }
    const requestToken = detailRequestRef.current;
    setBusy(true);
    try {
      const response = await command(operations.annotation.upsert, { workspace_id: workspaceID, subject_ref: subjectRef, kind: "NOTE", body, annotation_id: annotationID || undefined, expected_revision: expectedRevision });
      if (!detailIsCurrent(subjectRef, requestToken)) return;
      setAnnotations((items) => annotationID ? items.map((item) => item.annotation_id === annotationID ? response.data.annotation : item) : [...items, response.data.annotation]);
      const latestDrafts = latestDraftsRef.current;
      if (annotationID) {
        if (latestDrafts.editingNoteID === annotationID) {
          if (latestDrafts.editingBody === body) {
            drafts.setEditingNoteID(""); drafts.setEditingBody(""); drafts.setEditingOriginalBody("");
          } else {
            const savedBody = typeof response.data?.annotation?.body === "string" ? response.data.annotation.body : body;
            drafts.setEditingOriginalBody(savedBody);
          }
        }
      } else if (latestDrafts.noteDraft === body) {
        drafts.setNoteDraft("");
      }
      await refreshCapabilities();
      const degraded = response.status === "DEGRADED";
      const reasons = response.reasons?.map((item) => item.message?.trim()).filter((message): message is string => Boolean(message));
      const reason = reasons?.map((message) => t(message)).join("; ");
      notify({ kind: degraded ? "warning" : "success", text: degraded
        ? reason
          ? t("Note saved, but follow-up work is incomplete: {{reason}}", { reason })
          : t("Note saved, but follow-up work is incomplete.")
        : t(annotationID ? "Note updated." : "Note added.") });
    }
    catch (error) { notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not save annotation") }); }
    finally { setBusy(false); }
  }
  async function saveTag() {
    const submittedTagDraft = drafts.tagDraft;
    const body = submittedTagDraft.trim();
    const subjectRef = selected?.subject_ref?.trim() ?? "";
    if (!annotationStorageReady || !subjectRef || !workspaceID || !body || !detailAnnotationsReady(subjectRef)) { if (!annotationStorageReady) notify({ kind: "error", text: catalogStorageMessage }); return; }
    const requestToken = detailRequestRef.current;
    setBusy(true); notify(undefined);
    try {
      const response = await command(operations.annotation.upsert, { workspace_id: workspaceID, subject_ref: subjectRef, kind: "TAG", body, expected_revision: 0 });
      if (!detailIsCurrent(subjectRef, requestToken)) return;
      const annotation = response.data?.annotation;
      if (!annotationBelongsToSubject(annotation, subjectRef) || annotation.kind !== "TAG") throw new Error(t("Cairn returned an invalid response."));
      setAnnotations((items) => items.some((item) => item.annotation_id === annotation?.annotation_id) ? items : [...items, annotation]);
      if (latestDraftsRef.current.tagDraft === submittedTagDraft) drafts.setTagDraft("");
      const vocabulary = await library.reloadTagVocabulary(workspaceID);
      if (!detailIsCurrent(subjectRef, requestToken)) return;
      if (vocabulary.status === "ready" && vocabulary.workspaceID === workspaceID) library.syncTagCoverage(subjectRef, vocabulary.records);
      await refreshCapabilities();
      if (!detailIsCurrent(subjectRef, requestToken)) return;
      notify(committedAnnotationNotice(response, "Tag added.", "Tag added, but follow-up work is incomplete.", "Tag added, but follow-up work is incomplete: {{reason}}", t));
    } catch (error) {
      if (!detailIsCurrent(subjectRef, requestToken)) return;
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
      const vocabulary = await library.reloadTagVocabulary(workspaceID);
      if (!detailIsCurrent(subjectRef, requestToken)) return;
      const removedValue = typeof tag.body === "string" ? tag.body.trim() : "";
      if (vocabulary.status === "ready" && vocabulary.workspaceID === workspaceID) {
        library.syncTagCoverage(subjectRef, vocabulary.records);
        if (removedValue && !vocabulary.records.some((item) => item.body?.trim() === removedValue)) {
          library.setActiveTags((current) => current.filter((value) => value !== removedValue));
        }
      }
      await refreshCapabilities();
      if (!detailIsCurrent(subjectRef, requestToken)) return;
      notify(committedAnnotationNotice(response, "Tag removed.", "Tag removed, but follow-up work is incomplete.", "Tag removed, but follow-up work is incomplete: {{reason}}", t));
    } catch (error) {
      if (!detailIsCurrent(subjectRef, requestToken)) return;
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
      if (latestDraftsRef.current.editingNoteID === note.annotation_id) {
        drafts.setEditingNoteID(""); drafts.setEditingBody(""); drafts.setEditingOriginalBody("");
      }
      await refreshCapabilities();
      notify(committedAnnotationNotice(response, "Note deleted.", "Note deleted, but follow-up work is incomplete.", "Note deleted, but follow-up work is incomplete: {{reason}}", t));
    } catch (error) {
      notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not delete note") });
    } finally { setBusy(false); }
  }
  function closeDetails() {
    if (!drafts.canLeaveDetailDrafts()) return;
    detailRequestRef.current += 1;
    descriptionPageRequestRef.current += 1;
    detailSubjectRef.current = "";
    descriptionProjectionRef.current = null;
    setDescriptionProjection(null); setDescriptionsPagePending(false); setDescriptionsPageError(""); setDescriptionsTruncated(false); setDescriptions([]);
    setDetailState({ subjectRef: "", annotations: "idle", representations: "idle", descriptions: "idle" });
    setMediaFacts([]); setMediaFactsState("idle"); setTrack(undefined); setWork(undefined);
    drafts.discardDetailDrafts();
    setSelected(undefined);
    const returnPosition = detailReturnBrowseRef.current;
    detailReturnBrowseRef.current = undefined;
    if (returnPosition?.kind === "managed") {
      requestAnimationFrame(() => {
        if (browseContextGetterRef.current() !== returnPosition.context) {
          releaseBrowsePositionToken(browsePositionRegistry, returnPosition.token);
          return;
        }
        restoreBrowsePositionToken(browsePositionRegistry, returnPosition.token);
      });
    } else if (returnPosition?.kind === "window") {
      requestAnimationFrame(() => {
        if (browseContextGetterRef.current() !== returnPosition.context) return;
        window.scrollTo({ top: returnPosition.scrollY, behavior: "instant" });
      });
    }
  }
  function resetDetailProjection() {
    releaseDetailReturnPosition();
    detailRequestRef.current += 1; detailSubjectRef.current = "";
    descriptionPageRequestRef.current += 1;
    descriptionProjectionRef.current = null;
    setDescriptionProjection(null); setDescriptionsPagePending(false); setDescriptionsPageError("");
    setAnnotations([]); setRepresentations([]); setDescriptions([]); setDescriptionsTruncated(false);
    setMediaFacts([]); setMediaFactsState("idle"); setTrack(undefined); setWork(undefined);
    setDetailState({ subjectRef: "", annotations: "idle", representations: "idle", descriptions: "idle" });
  }

  const navigationContextRef = useRef<DetailsNavigationContext>({ workspaceID, selected, hits: library.renderedHits, busy, loadDetails });
  navigationContextRef.current = { workspaceID, selected, hits: library.renderedHits, busy, loadDetails };
  const navigationPosition = detailsNavigationPosition(navigationContextRef.current);
  function moveWithinLoadedResults(offset: -1 | 1) {
    const current = navigationContextRef.current;
    if (current.busy) return;
    const position = detailsNavigationPosition(current);
    if (!position) return;
    const files = current.hits.filter((hit) => hit.entry_type === "REGULAR_FILE"
      && Boolean(hit.subject_ref?.trim()) && Boolean(hit.entry_id?.trim()) && Boolean(hit.content_id?.trim()));
    const target = files[position.position - 1 + offset];
    if (!target) return;
    const targetSubject = target.subject_ref?.trim() ?? "";
    if (!targetSubject || files.filter((hit) => hit.subject_ref?.trim() === targetSubject).length !== 1) return;
    void current.loadDetails(target);
  }
  const navigation = navigationPosition ? {
    position: navigationPosition.position,
    total: navigationPosition.total,
    previous: () => moveWithinLoadedResults(-1),
    next: () => moveWithinLoadedResults(1),
  } : undefined;

  return {
    annotations,
    setAnnotations,
    representations,
    descriptions,
    descriptionsTruncated,
    descriptionsTotal: descriptionProjection?.entries ?? descriptions.length,
    descriptionsPagePending,
    descriptionsPageError,
    mediaFacts,
    mediaFactsState,
    track,
    work,
    detailState,
    detailSubjectRef,
    navigation,
    loadDetails,
    loadMoreDescriptions,
    refreshDescriptions,
    closeDetails,
    saveNote,
    saveTag,
    deleteTag,
    deleteNote,
    resetDetailProjection,
  };
}
