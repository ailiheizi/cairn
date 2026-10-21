import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, CheckCircle2, ChevronLeft, ChevronRight, Download as DownloadIcon, FileSearch, Hash, Pencil, Plus, ShieldCheck, Sparkles, Tag, Trash2, X } from "lucide-react";
import type { Locale, Translator } from "../i18n";
import { abbreviateIdentity, identityBars } from "../identity";
import { ContentPreview } from "./ContentPreview";
import { NoteText } from "./NoteText";
import { command } from "../app/command";
import { operations } from "../lib/operations";
import { sameDescribeProfileIdentity, validateDescribeProfile, type DescribeProfile } from "../lib/describeAuthorization";
import { downloadOriginal } from "../lib/contentDownload";
import { resolveArchiveSelectionSizes } from "../lib/originalArchive";
import { deriveSystemTags, descriptionKindLabel, formatBytes, formatEntryType, formatNoteDate, previewUnicodeText, searchImageMetadata, searchImageMetadataPropertyText, searchSegmentMetadata, searchSegmentSourceLabel } from "../lib/format";
import { searchOcrEvidence, type OcrSearchEvidence } from "../lib/ocrSearchEvidence";
import type { DetailResourceStatus, SearchHit, SearchSegment } from "../lib/types";
import { MaterialListReader } from "./material/MaterialListReader";
import type { MaterialListDocument } from "../lib/materialList";
import type { MaterialListAction } from "../lib/materialListActions";

// The details inspector: one subject's exact-byte status, preview, notes, tags,
// provenance, and technical identity.
//
// The inspector reads and writes only this one subject. Its notes view merges
// the durable user notes with imported, extracted, and model-produced notes
// into the single Notes surface; the durable records keep their own provenance.

// On-demand description generation is one explicit action for one subject, and
// it can only run when the daemon defines the operation for it and its own
// gates pass. `capability.list` advertises one row per known operation; the
// client can dispatch only a verb its typed map (`lib/operations.ts`)
// contains. `description.generate` is wired when the daemon loaded a describe
// provider profile, so the action additionally requires an installed profile
// matching the saved selection and a live DESCRIBE grant (resolved from the
// daemon's own read-only profile and grant lists), plus one explicit
// confirmation step that names exactly what will be sent before any request.
const describeGenerationOperationIDs: readonly string[] = ["description.generate"];

// The covering egress grant row the confirmation step binds the dispatch to.
type DescribeGrant = {
  workspace_id?: string;
  grant_id?: string;
  profile_id?: string;
  profile_digest?: string;
  endpoint_host?: string;
  model_id?: string;
  purpose?: string;
  live?: boolean;
  revoked?: boolean;
};

type DescribeProbe =
  | { state: "checking" }
  | { state: "ready"; descriptions: { enabled?: boolean; generate?: string; provider_profile?: string; credential_ref?: string }; generationAdvertised: boolean; describeProfile: DescribeProfile | null; describeProfilesReason: string; coveringGrant: DescribeGrant | null }
  | { state: "unreadable"; message: string };

// A subject whose admitted image bytes may be part of the disclosure. The
// daemon decides from its own profile and facts; this only decides whether the
// confirmation dialog names image bytes as a possible payload.
function subjectMayDiscloseImageBytes(hit: SearchHit): boolean {
  return hit.entry_type?.trim().toUpperCase() === "REGULAR_FILE" && /\.(jpe?g|png)$/i.test(hit.name?.trim() || "");
}

const MATCHED_SOURCE_PAGE_SIZE = 6;

function safeSearchSegment(value: unknown): SearchSegment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    source_type: typeof record.source_type === "string" ? record.source_type : undefined,
    source_id: typeof record.source_id === "string" ? record.source_id : undefined,
    semantic_segment_id: typeof record.semantic_segment_id === "string" ? record.semantic_segment_id : undefined,
    ordinal: typeof record.ordinal === "number" && Number.isFinite(record.ordinal) ? record.ordinal : undefined,
    matched_text: typeof record.matched_text === "string" ? record.matched_text : undefined,
    matched_excerpt: typeof record.matched_excerpt === "string" ? record.matched_excerpt : undefined,
    kind: typeof record.kind === "string" ? record.kind : undefined,
    producer: typeof record.producer === "string" ? record.producer : undefined,
    accepted: typeof record.accepted === "boolean" ? record.accepted : undefined,
    language: typeof record.language === "string" ? record.language : undefined,
  };
}

function hasReturnedSegmentFact(segment: SearchSegment): boolean {
  return Boolean(segment.source_type?.trim() || segment.kind?.trim() || segment.source_id?.trim()
    || segment.semantic_segment_id?.trim() || segment.matched_excerpt?.trim() || segment.matched_text?.trim()
    || segment.producer?.trim() || segment.language?.trim() || typeof segment.accepted === "boolean");
}

function isDocumentSearchHit(hit: SearchHit): boolean {
  if (hit.entry_type?.trim().toUpperCase() !== "REGULAR_FILE") return false;
  return [hit.name, hit.path].some((value) => typeof value === "string" && /\.(?:pdf|docx)$/i.test(value.trim()));
}

function isPlainDocumentExtractSegment(segment: SearchSegment): boolean {
  if (segment.source_type?.trim().toUpperCase() !== "ARTIFACT" || segment.kind?.trim().toUpperCase() !== "EXTRACT") return false;
  const excerpt = segment.matched_excerpt?.trim() || segment.matched_text?.trim() || "";
  if (!excerpt || searchImageMetadata(segment)) return false;
  // Other structured processor facts share ARTIFACT/EXTRACT provenance. Do
  // not present those JSON facts as prose from a matched document.
  const raw = segment.matched_text?.trim() || "";
  if (raw.length > 0 && raw.length <= 16 * 1024) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const schema = (parsed as Record<string, unknown>).schema;
        if (typeof schema === "string" && schema.startsWith("cairn.domain.")) return false;
      }
    } catch {
      // Ordinary extracted body text is not JSON; it remains eligible.
    }
  }
  return true;
}

export function Details({ workspaceId, hit, annotations, representations, descriptions, descriptionsTruncated, descriptionsTotal, descriptionsPagePending, descriptionsPageError, onLoadMoreDescriptions, onRefreshDescriptions, mediaFacts, mediaFactsState, track, work, annotationStatus, representationsStatus, descriptionsStatus, annotationMutationEnabled, noteDraft, tagDraft, tagVocabulary, editingNoteID, editingBody, descriptionDraft, onBeginDescriptionDraft, onUpdateDescriptionDraft, onRebaseDescriptionDraft, onClearDescriptionDraft, busy, t, locale, onBack, onExport, navigation, onDraft, onTagDraft, onAddTag, onDeleteTag, onAdd, onEdit, onDeleteNote, onEditBody, onSaveEdit, onCancelEdit, catalogItems = [], onEditMaterialList, onUseMaterialList, materialListActionsDisabled, materialListActionsDisabledReason }: { workspaceId: string; hit: SearchHit; annotations: any[]; representations: any[]; descriptions: any[]; descriptionsTruncated: boolean; descriptionsTotal: number; descriptionsPagePending: boolean; descriptionsPageError: string; onLoadMoreDescriptions: () => void; onRefreshDescriptions: () => void; mediaFacts: any[]; mediaFactsState: "idle" | "loading" | "ready" | "error"; track: any | undefined; work: any | undefined; annotationStatus: DetailResourceStatus; representationsStatus: DetailResourceStatus; descriptionsStatus: DetailResourceStatus; annotationMutationEnabled: boolean; noteDraft: string; tagDraft: string; tagVocabulary: string[]; editingNoteID: string; editingBody: string; descriptionDraft: { key: string; body: string; originalBody: string } | null; onBeginDescriptionDraft: (key: string, body: string) => void; onUpdateDescriptionDraft: (key: string, expectedBody: string, body: string) => void; onRebaseDescriptionDraft: (key: string, expectedBody: string, nextKey: string, acceptedBody: string) => void; onClearDescriptionDraft: (key: string, expectedBody?: string) => void; busy: boolean; t: Translator; locale: Locale; onBack: () => void; onExport?: () => void; navigation?: { position: number; total: number; previous: () => void; next: () => void }; onDraft: (value: string) => void; onTagDraft: (value: string) => void; onAddTag: () => void; onDeleteTag: (tag: any) => void; onAdd: () => void; onEdit: (note: any) => void; onDeleteNote: (note: any) => void; onEditBody: (value: string) => void; onSaveEdit: (note: any) => void; onCancelEdit: () => void; catalogItems?: SearchHit[]; onEditMaterialList?: (document: MaterialListDocument) => void; onUseMaterialList?: (document: MaterialListDocument, action: MaterialListAction, trigger?: EventTarget | null) => void; materialListActionsDisabled?: boolean; materialListActionsDisabledReason?: string }) {
  // The generation action's availability probe: the daemon's persisted
  // description settings, advertised operation, opt-in installed-profile
  // facts, and live egress grant list. All four are reads. The probe reruns
  // when the inspected subject or workspace changes, never starts, schedules,
  // or implies a generation, and reports every unmet gate by name.
  const describeReasonID = useId();
  const detailsRootRef = useRef<HTMLDivElement | null>(null);
  const detailBackRef = useRef<HTMLButtonElement | null>(null);
  const detailTitleRef = useRef<HTMLHeadingElement | null>(null);
  const revealedSubjectRef = useRef("");
  const materialListReadHit = useMemo(() => hit.entry_type === "REGULAR_FILE" && hit.name?.toLowerCase().endsWith(".cairn-list.json")
    ? resolveArchiveSelectionSizes([hit], catalogItems)[0] ?? hit
    : hit, [hit, catalogItems]);
  const [describeProbe, setDescribeProbe] = useState<DescribeProbe>({ state: "checking" });
  const [describeConfirmOpen, setDescribeConfirmOpen] = useState(false);
  const [describeBusy, setDescribeBusy] = useState(false);
  const [describeError, setDescribeError] = useState("");
  const [describeSavedWarning, setDescribeSavedWarning] = useState("");
  const [matchedSourcePage, setMatchedSourcePage] = useState(0);
  const [matchedDocumentSourcePage, setMatchedDocumentSourcePage] = useState(0);
  const [matchedOcrPage, setMatchedOcrPage] = useState(0);
  const [expandedDocumentSourceSubject, setExpandedDocumentSourceSubject] = useState("");
  const initializedDocumentSourceSubject = useRef("");
  // The generated candidate (and its accepted successor after Accept) is held
  // locally so the one Notes surface renders the daemon's own result
  // immediately, with its AI label, non-accepted state, and revision.
  const [generatedDocument, setGeneratedDocument] = useState<any | null>(null);
  const [editingGeneratedDescription, setEditingGeneratedDescription] = useState(false);
  const describeProbeToken = useRef(0);
  const describeOperationToken = useRef(0);
  const describeBusyToken = useRef<number | null>(null);
  const describeMounted = useRef(false);
  const describeOperationContext = useRef("");
  const currentDescribeContext = `${workspaceId}\u0000${hit.subject_ref?.trim() || hit.entry_id || hit.name || "subject"}`;
  describeOperationContext.current = currentDescribeContext;
  useEffect(() => {
    describeMounted.current = true;
    return () => { describeMounted.current = false; describeOperationToken.current += 1; describeProbeToken.current += 1; };
  }, []);
  const noteReadScope = useMemo(() => ({}), [workspaceId, hit.subject_ref, annotations, descriptions]);
  const detailSubjectIdentity = `${workspaceId}:${hit.subject_ref?.trim() || hit.entry_id || hit.name || "subject"}`;
  useLayoutEffect(() => {
    if (revealedSubjectRef.current === detailSubjectIdentity) return;
    let firstFrame = 0;
    let secondFrame = 0;
    let cancelled = false;
    const reveal = () => {
      if (cancelled || revealedSubjectRef.current === detailSubjectIdentity) return;
      const root = detailsRootRef.current;
      const back = detailBackRef.current;
      const title = detailTitleRef.current;
      if (!root || !title) return;

      let scroller: HTMLElement | null = null;
      for (let ancestor = root.parentElement; ancestor && ancestor !== document.body && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
        const overflowY = window.getComputedStyle(ancestor).overflowY;
        if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && ancestor.scrollHeight > ancestor.clientHeight + 1) {
          scroller = ancestor;
          break;
        }
      }

      const rootRect = root.getBoundingClientRect();
      const scrollport = scroller?.getBoundingClientRect();
      let visibleTop = scrollport?.top ?? 0;
      const visibleBottom = scrollport?.bottom ?? window.innerHeight;
      const topbar = document.querySelector<HTMLElement>(".topbar");
      if (topbar) {
        const style = window.getComputedStyle(topbar);
        const topbarRect = topbar.getBoundingClientRect();
        if ((style.position === "sticky" || style.position === "fixed") && topbarRect.bottom > visibleTop && topbarRect.top < visibleBottom) {
          visibleTop = Math.max(visibleTop, topbarRect.bottom);
        }
      }
      const targetTop = visibleTop + 12;
      const delta = rootRect.top - targetTop;
      if (Math.abs(delta) > 1) {
        if (scroller) scroller.scrollTop += delta;
        else {
          const pageScroller = document.scrollingElement;
          if (pageScroller) pageScroller.scrollTop += delta;
        }
      }

      const focusTarget = back && back.getClientRects().length > 0 ? back : title;
      focusTarget.focus({ preventScroll: true });
      revealedSubjectRef.current = detailSubjectIdentity;
    };
    firstFrame = requestAnimationFrame(() => {
      firstFrame = 0;
      if (cancelled) return;
      secondFrame = requestAnimationFrame(() => {
        secondFrame = 0;
        reveal();
      });
    });
    return () => {
      cancelled = true;
      if (firstFrame) cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [detailSubjectIdentity]);
  useEffect(() => {
    const token = ++describeProbeToken.current;
    setDescribeProbe({ state: "checking" });
    setDescribeConfirmOpen(false);
    setDescribeError("");
    setGeneratedDocument(null);
    void (async () => {
      const [configResult, capabilityResult, grantResult, providerResult] = await Promise.allSettled([
        command(operations.config.get, {}),
        command(operations.capability.list, {}),
        command(operations.egress.grantList, { workspace_id: workspaceId }),
        command(operations.semantic.providerList, { include_describe: true }),
      ]);
      if (describeProbeToken.current !== token) return;
      const failure = [configResult, capabilityResult, grantResult, providerResult].find((result) => result.status === "rejected");
      if (failure) {
        const reason = (failure as PromiseRejectedResult).reason;
        setDescribeProbe({ state: "unreadable", message: reason instanceof Error ? reason.message : String(reason) });
        return;
      }
      const capabilities = capabilityResult.status === "fulfilled" ? capabilityResult.value.data?.capabilities ?? [] : [];
      const grants = grantResult.status === "fulfilled" ? grantResult.value.data?.grants ?? [] : [];
      const descriptions = configResult.status === "fulfilled" ? configResult.value.data?.config?.descriptions ?? {} : {};
      const describeListing = providerResult.status === "fulfilled" ? providerResult.value.data?.describe : undefined;
      const configuredProfileID = String(descriptions?.provider_profile ?? "").trim();
      const describeProfiles = Array.isArray(describeListing?.profiles) ? describeListing.profiles : [];
      const validatedProfiles = describeProfiles.map((value: unknown) => validateDescribeProfile(value));
      const selectedProfile = validatedProfiles.find((candidate: ReturnType<typeof validateDescribeProfile>) => candidate.valid && candidate.profile.profile_id === configuredProfileID);
      const describeProfile = describeListing?.state === "AVAILABLE" && selectedProfile?.valid ? selectedProfile.profile : null;
      setDescribeProbe({
        state: "ready",
        descriptions,
        generationAdvertised: capabilities.some((capability: any) => capability?.kind === "operation"
          && capability?.state === "AVAILABLE"
          && describeGenerationOperationIDs.includes(String(capability?.id ?? ""))),
        describeProfile,
        describeProfilesReason: describeListing?.state === "UNAVAILABLE"
          ? String(describeListing.reason || "Installed description profile details are unavailable.")
          : describeListing?.state !== "AVAILABLE"
            ? "The service did not return the optional installed description profiles."
          : !configuredProfileID ? ""
              : !describeProfile ? "The selected description profile is not currently installed with valid metadata."
                : "",
      coveringGrant: describeProfile && !describeProfile.expired ? grants.find((grant: DescribeGrant) => grant?.live === true && grant?.revoked !== true
          && grant.workspace_id === workspaceId
          && String(grant?.purpose ?? "").toUpperCase() === "DESCRIBE"
          && sameDescribeProfileIdentity(grant, describeProfile)) ?? null : null,
      });
    })();
  }, [workspaceId, detailSubjectIdentity]);
  const describeSubjectRef = hit.subject_ref?.trim() ?? "";
  const candidateID = generatedDocument ? String(generatedDocument.description_document_id || generatedDocument.id || "") : "";
  const descriptionDraftKey = `${workspaceId}\u0000${describeSubjectRef}\u0000${candidateID}`;
  const activeDescriptionDraft = descriptionDraft?.key === descriptionDraftKey ? descriptionDraft : null;
  const hasUnsavedDescriptionReview = Boolean(activeDescriptionDraft && activeDescriptionDraft.body !== activeDescriptionDraft.originalBody);
  // A generated result belongs to exactly one subject: switching the inspected
  // subject drops the local candidate rather than carrying it over.
  useEffect(() => {
    describeOperationToken.current += 1;
    describeBusyToken.current = null;
    setDescribeBusy(false);
    setGeneratedDocument(null);
    setEditingGeneratedDescription(false);
    setDescribeConfirmOpen(false);
    setDescribeError("");
    setDescribeSavedWarning("");
    if (descriptionDraft && !descriptionDraft.key.startsWith(`${workspaceId}\u0000${describeSubjectRef}\u0000`)) onClearDescriptionDraft(descriptionDraft.key);
  }, [workspaceId, describeSubjectRef]);
  const describeReasons: string[] = [];
  if (describeProbe.state === "unreadable") {
    describeReasons.push(t("Could not read the daemon's description settings and capabilities: {{message}}", { message: describeProbe.message }));
  } else if (describeProbe.state === "ready") {
    // Every unmet gate is named, deepest last: the settings the operator owns,
    // the capability the daemon has to publish before a request could be
    // dispatched at all, and the live egress grant the gate itself requires.
    if (describeProbe.descriptions.enabled !== true) describeReasons.push(t("Descriptions are turned off in the settings (descriptions.enabled)."));
    if (String(describeProbe.descriptions.generate ?? "").trim() === "disabled") describeReasons.push(t("On-demand generation is turned off in the settings (descriptions.generate)."));
    if (!String(describeProbe.descriptions.provider_profile ?? "").trim()) describeReasons.push(t("No description provider profile is selected (descriptions.provider_profile)."));
    if (!String(describeProbe.descriptions.credential_ref ?? "").trim()) describeReasons.push(t("No credential reference is configured for the description provider (descriptions.credential_ref)."));
    if (!describeProbe.generationAdvertised) describeReasons.push(t("No available description generation operation is advertised (DESCRIBE_SUBJECT)."));
    if (!describeProbe.describeProfile) describeReasons.push(t(describeProbe.describeProfilesReason || "The selected description profile is not currently installed with valid metadata."));
    else if (describeProbe.describeProfile.expired) describeReasons.push(t("The selected description provider profile has expired."));
    if (describeProbe.generationAdvertised && !describeProbe.coveringGrant) describeReasons.push(t("No live egress grant covers description generation (egress.grant.list)."));
  }
  const describeChecking = describeProbe.state === "checking";
  const describeGrant = describeProbe.state === "ready" ? describeProbe.coveringGrant : null;
  const describeEnabled = describeProbe.state === "ready" && describeReasons.length === 0 && describeGrant !== null;
  const describeShortReason = (() => {
    if (describeChecking) return t("Checking description availability...");
    if (describeProbe.state === "unreadable") return t("Could not check description availability right now.");
    if (describeProbe.descriptions.enabled !== true) return t("Turn on descriptions in Settings.");
    if (String(describeProbe.descriptions.generate ?? "").trim() === "disabled") return t("On-demand descriptions are turned off in Settings.");
    if (!String(describeProbe.descriptions.provider_profile ?? "").trim()) return t("Choose a description provider in Settings.");
    if (!String(describeProbe.descriptions.credential_ref ?? "").trim()) return t("Configure credentials for the description provider in Settings.");
    if (!describeProbe.generationAdvertised) return t("Description generation unavailable on this service.");
    if (!describeGrant) return t("Authorize description requests before sending content.");
    return t("Description generation unavailable on this service.");
  })();
  // runDescribeGeneration is the ONLY dispatch site of description.generate in
  // this surface. It fires exactly once per confirmed click, carrying the
  // egress confirmation the daemon's gate resolves against its live grant.
  const runDescribeGeneration = async () => {
    if (!describeEnabled || !describeGrant || !hit.subject_ref || describeBusyToken.current !== null
      || Boolean(activeDescriptionDraft && activeDescriptionDraft.body !== activeDescriptionDraft.originalBody)) return;
    const context = currentDescribeContext;
    const token = ++describeOperationToken.current;
    describeBusyToken.current = token;
    setDescribeBusy(true);
    setDescribeError("");
    setDescribeSavedWarning("");
    try {
      const result = await command(operations.description.generate, {
        workspace_id: workspaceId,
        subject_ref: hit.subject_ref,
        kind: "AI_SUMMARY",
        egress_confirmation: {
          profile_id: describeGrant.profile_id ?? "",
          profile_digest: describeGrant.profile_digest ?? "",
          endpoint_host: describeGrant.endpoint_host ?? "",
          model: describeGrant.model_id ?? "",
          purpose: "DESCRIBE",
          grant_id: describeGrant.grant_id ?? "",
        },
      });
      const document = result.data?.document;
      if (!describeMounted.current || describeOperationContext.current !== context || describeOperationToken.current !== token) return;
      if (!document || document.workspace_id !== workspaceId || document.subject_ref !== hit.subject_ref
        || !(document.description_document_id || document.id) || typeof document.body !== "string" || !document.body.trim()
        || document.kind !== "AI_SUMMARY" || !Number.isInteger(document.revision) || document.revision < 1
        || document.accepted !== false) throw new Error(t("Generated description did not match this subject."));
      setGeneratedDocument(document);
      setDescribeConfirmOpen(false);
    } catch (error) {
      if (describeMounted.current && describeOperationContext.current === context && describeOperationToken.current === token) setDescribeError(error instanceof Error ? error.message : String(error));
    } finally {
      if (describeBusyToken.current === token) describeBusyToken.current = null;
      if (describeMounted.current && describeOperationContext.current === context && describeOperationToken.current === token) setDescribeBusy(false);
    }
  };
  // acceptGeneratedDocument creates an accepted successor from the reviewed
  // body, keeping the candidate kind and predecessor. The model can never
  // mark its own revision user-accepted.
  const acceptGeneratedDocument = async () => {
    const document = generatedDocument;
    if (!document || !hit.subject_ref || describeBusyToken.current !== null || !candidateID) return;
    const capturedKey = descriptionDraftKey;
    const acceptedBody = activeDescriptionDraft?.body ?? String(document.body ?? "");
    if (!acceptedBody.trim()) { setDescribeError(t("Enter a description before accepting it.")); return; }
    const context = currentDescribeContext;
    const token = ++describeOperationToken.current;
    describeBusyToken.current = token;
    setDescribeBusy(true);
    setDescribeError("");
    setDescribeSavedWarning("");
    try {
      const result = await command(operations.description.create, {
        workspace_id: workspaceId,
        subject_ref: hit.subject_ref,
        kind: document.kind,
        body: acceptedBody,
        predecessor_id: document.description_document_id || document.id,
        accepted: true,
      });
      const successor = result.data?.document;
      if (!describeMounted.current || describeOperationContext.current !== context || describeOperationToken.current !== token) return;
      const successorID = String(successor?.description_document_id || successor?.id || "");
      if (!successor || !successorID || successorID === candidateID || successor.workspace_id !== workspaceId || successor.subject_ref !== hit.subject_ref || successor.kind !== document.kind || successor.predecessor_id !== candidateID || successor.body !== acceptedBody || successor.accepted !== true || !Number.isInteger(successor.revision) || successor.revision !== Number(document.revision) + 1) throw new Error(t("Accepted description did not match the saved successor."));
      setGeneratedDocument(successor);
      const successorKey = `${workspaceId}\u0000${describeSubjectRef}\u0000${String(successor.description_document_id || successor.id || "")}`;
      onRebaseDescriptionDraft(capturedKey, acceptedBody, successorKey, acceptedBody);
      if (result.status === "DEGRADED") setDescribeSavedWarning(t("The description was saved, but the service reported a degraded result."));
    } catch (error) {
      if (describeMounted.current && describeOperationContext.current === context && describeOperationToken.current === token) setDescribeError(error instanceof Error ? error.message : String(error));
    } finally {
      if (describeBusyToken.current === token) describeBusyToken.current = null;
      if (describeMounted.current && describeOperationContext.current === context && describeOperationToken.current === token) setDescribeBusy(false);
    }
  };
  const notes = annotations.filter((item) => item.kind === "NOTE" && !item.tombstoned);
  // The daemon's current-only projection decides which description revisions
  // are current. The locally held generated revision is rendered below, so
  // suppress that exact document if it is also in the fetched page. After an
  // accepted successor is validated from description.create, its predecessor
  // is hidden as well; this uses the write response, not a page-local chain.
  const generatedDocumentID = generatedDocument ? String(generatedDocument.description_document_id || generatedDocument.id || "") : "";
  const acceptedGeneratedPredecessorID = generatedDocument?.accepted === true
    ? String(generatedDocument.predecessor_id || "")
    : "";
  const currentDescriptions = descriptions.filter((item) => !item.tombstoned
    && item.description_document_id !== generatedDocumentID
    && item.description_document_id !== acceptedGeneratedPredecessorID);
  const descriptionNotes = currentDescriptions.map((item) => {
    const body = typeof item.body === "string" && item.body.length > 0 && !item.body_unavailable ? item.body : "";
    return {
      ...item,
      body,
      title: typeof item.title === "string" ? item.title : "",
      sourceLabel: descriptionKindLabel(item.kind, t),
      descriptionOnly: true,
    };
  });
  const combinedNotes = [...notes, ...descriptionNotes];
  const tags = annotations.filter((item) => item.kind === "TAG" && !item.tombstoned);
  const returnedSegments = Array.isArray(hit.segments)
    ? hit.segments.map(safeSearchSegment).filter((segment): segment is SearchSegment => segment !== null).filter(hasReturnedSegmentFact)
    : [];
  const parsedOcrEvidence = returnedSegments.flatMap((segment) => {
    const evidence = searchOcrEvidence(segment);
    return evidence ? [{ segment, evidence }] : [];
  });
  const matchedOcrEvidence: Array<{ segment: SearchSegment; evidence: OcrSearchEvidence }> = [];
  for (const candidate of parsedOcrEvidence) {
    const sourceID = candidate.segment.source_id?.trim();
    const duplicateIndex = sourceID ? matchedOcrEvidence.findIndex((item) => {
      if (item.segment.source_id?.trim() !== sourceID) return false;
      return item.evidence.text === candidate.evidence.text
        || item.evidence.text.includes(candidate.evidence.text)
        || candidate.evidence.text.includes(item.evidence.text);
    }) : -1;
    if (duplicateIndex < 0) {
      matchedOcrEvidence.push(candidate);
      continue;
    }
    const previous = matchedOcrEvidence[duplicateIndex];
    if ((previous.evidence.returnedFragment && !candidate.evidence.returnedFragment)
      || (previous.evidence.returnedFragment === candidate.evidence.returnedFragment && candidate.evidence.text.length > previous.evidence.text.length)) {
      matchedOcrEvidence[duplicateIndex] = candidate;
    }
  }
  const matchedOcrSegmentSet = new Set(parsedOcrEvidence.map(({ segment }) => segment));
  const matchedSourceSegments = returnedSegments.filter((segment) => !searchImageMetadata(segment) && !matchedOcrSegmentSet.has(segment));
  const documentBodySegments = isDocumentSearchHit(hit) ? matchedSourceSegments.filter(isPlainDocumentExtractSegment) : [];
  const otherMatchedSourceSegments = documentBodySegments.length > 0
    ? matchedSourceSegments.filter((segment) => !documentBodySegments.includes(segment))
    : matchedSourceSegments;
  const matchedImageMetadata = returnedSegments.flatMap((segment) => {
    const metadata = searchImageMetadata(segment);
    return metadata ? [{ segment, metadata }] : [];
  });
  const matchedSourcePageKey = JSON.stringify([
    detailSubjectIdentity,
    hit.entry_id ?? "",
    hit.content_id ?? "",
    hit.name ?? "",
    returnedSegments.map((segment) => [segment.source_type ?? "", segment.kind ?? "", segment.source_id ?? "", segment.semantic_segment_id ?? "", segment.ordinal ?? null, previewUnicodeText(segment.matched_excerpt || segment.matched_text, 280)]),
  ]);
  useLayoutEffect(() => { setMatchedSourcePage(0); }, [matchedSourcePageKey]);
  const matchedOcrPageKey = JSON.stringify([
    detailSubjectIdentity,
    hit.entry_id ?? "",
    hit.content_id ?? "",
    matchedOcrEvidence.map(({ segment, evidence }) => [segment.source_id ?? "", segment.semantic_segment_id ?? "", segment.ordinal ?? null, evidence.text.length, evidence.text.slice(0, 80)]),
  ]);
  useLayoutEffect(() => { setMatchedOcrPage(0); }, [matchedOcrPageKey]);
  const documentSourceKey = JSON.stringify([detailSubjectIdentity, documentBodySegments.map((segment) => [segment.source_type ?? "", segment.kind ?? "", segment.source_id ?? "", segment.semantic_segment_id ?? "", segment.ordinal ?? null, previewUnicodeText(segment.matched_excerpt || segment.matched_text, 280)])]);
  useLayoutEffect(() => { setMatchedDocumentSourcePage(0); }, [documentSourceKey]);
  useLayoutEffect(() => {
    if (documentBodySegments.length === 0 || initializedDocumentSourceSubject.current === detailSubjectIdentity) return;
    initializedDocumentSourceSubject.current = detailSubjectIdentity;
    setExpandedDocumentSourceSubject(detailSubjectIdentity);
  }, [detailSubjectIdentity, documentBodySegments.length]);
  const matchedSourcePageCount = Math.ceil(otherMatchedSourceSegments.length / MATCHED_SOURCE_PAGE_SIZE);
  const matchedSourcePageIndex = Math.min(matchedSourcePage, Math.max(0, matchedSourcePageCount - 1));
  const matchedSourceFirst = otherMatchedSourceSegments.length === 0 ? 0 : matchedSourcePageIndex * MATCHED_SOURCE_PAGE_SIZE + 1;
  const matchedSourceLast = Math.min(otherMatchedSourceSegments.length, (matchedSourcePageIndex + 1) * MATCHED_SOURCE_PAGE_SIZE);
  const visibleMatchedSourceSegments = otherMatchedSourceSegments.slice(matchedSourcePageIndex * MATCHED_SOURCE_PAGE_SIZE, (matchedSourcePageIndex + 1) * MATCHED_SOURCE_PAGE_SIZE);
  const matchedDocumentPageCount = Math.ceil(documentBodySegments.length / MATCHED_SOURCE_PAGE_SIZE);
  const matchedDocumentPageIndex = Math.min(matchedDocumentSourcePage, Math.max(0, matchedDocumentPageCount - 1));
  const matchedDocumentFirst = matchedDocumentPageIndex * MATCHED_SOURCE_PAGE_SIZE + 1;
  const matchedDocumentLast = Math.min(documentBodySegments.length, (matchedDocumentPageIndex + 1) * MATCHED_SOURCE_PAGE_SIZE);
  const visibleMatchedDocumentSegments = documentBodySegments.slice(matchedDocumentPageIndex * MATCHED_SOURCE_PAGE_SIZE, (matchedDocumentPageIndex + 1) * MATCHED_SOURCE_PAGE_SIZE);
  const matchedOcrPageCount = Math.ceil(matchedOcrEvidence.length / MATCHED_SOURCE_PAGE_SIZE);
  const matchedOcrPageIndex = Math.min(matchedOcrPage, Math.max(0, matchedOcrPageCount - 1));
  const visibleMatchedOcrEvidence = matchedOcrEvidence.slice(matchedOcrPageIndex * MATCHED_SOURCE_PAGE_SIZE, (matchedOcrPageIndex + 1) * MATCHED_SOURCE_PAGE_SIZE);
  const systemTags = deriveSystemTags(hit);
  const suggestions = tagVocabulary.filter((value) => !tags.some((tag) => tag.body === value));
  const exact = representations.find((item) => item.class === "EXACT" && item.authoritative === true);
  const verifiedExact = Boolean(exact && exact.placement === "present" && exact.verified === true);
  const previewAvailable = representationsStatus === "ready" && Boolean(exact && exact.placement === "present" && exact.verified !== false);
  const exactState = representationsStatus === "loading" ? "Checking service" : representationsStatus === "error" ? "Unavailable" : verifiedExact ? "Verified exact bytes" : exact?.placement === "missing" || exact?.verified === false ? "Exact copy is missing or failed verification" : exact ? "Exact copy is present but not verified" : "No authoritative exact copy reported";
  const assuranceLabel = representationsStatus === "loading" ? "Checking service" : representationsStatus === "error" ? "Unavailable" : verifiedExact ? "VERIFIED" : exact ? "UNVERIFIED" : "CATALOGED";
  const detailStatus = (state: DetailResourceStatus) => state === "loading" ? t("Checking service") : state === "error" ? t("Unavailable") : "";
  const canMutateAnnotations = annotationMutationEnabled && annotationStatus === "ready";
  const noteMeta = (note: any) => {
    if (note.descriptionOnly) {
      const parts = [note.sourceLabel || t("Imported note")];
      if (note.accepted === false) parts.push(t("Not accepted"));
      if (note.revision) parts.push(t("revision {{revision}}", { revision: note.revision }));
      if (note.updated_at) parts.push(formatNoteDate(note.updated_at, locale, t));
      if (note.body_unavailable) parts.push(t("Body unavailable"));
      return parts.join(" · ");
    }
    return `${formatNoteDate(note.updated_at, locale, t)} · ${t("revision {{revision}}", { revision: note.revision })}`;
  };
  const renderDescriptionBody = (note: any) => {
    const storedBody = typeof note.body === "string" && note.body.length > 0 && !note.body_unavailable ? note.body : "";
    const identity = JSON.stringify([workspaceId, hit.subject_ref?.trim() ?? "", note.description_document_id || note.id || "", note.revision ?? 0]);
    if (storedBody.length > 0) return <NoteText body={storedBody} identity={identity} scope={noteReadScope} t={t} />;
    const title = typeof note.title === "string" ? note.title : "";
    return <p className="note-body-read__message">{title ? t("Title only: {{title}}", { title }) : t("Note content unavailable")}</p>;
  };
  const renderNote = (note: any) => {
    const noteID = note.annotation_id || note.description_document_id || `${note.kind || "note"}-${note.revision || note.body}`;
    const editable = !note.descriptionOnly;
    if (editable && editingNoteID === note.annotation_id) {
      return <div className="note-row editing" key={noteID}><textarea autoFocus aria-label={t("Edit note")} value={editingBody} onChange={(event) => onEditBody(event.target.value)} disabled={!canMutateAnnotations} /><div className="note-actions"><button className="text-button" onClick={onCancelEdit} disabled={busy}>{t("Cancel")}</button><button className="primary-button compact" onClick={() => onSaveEdit(note)} disabled={busy || !canMutateAnnotations || !editingBody.trim()}><Check size={14} />{t("Save")}</button></div></div>;
    }
    const body = typeof note.body === "string" ? note.body : "";
    const identity = JSON.stringify([workspaceId, hit.subject_ref?.trim() ?? "", note.annotation_id || noteID, note.revision ?? 0]);
    return <div className={`note-row ${note.descriptionOnly ? "source-note" : ""}`} key={noteID}>
      {note.descriptionOnly ? renderDescriptionBody(note) : <NoteText body={body} identity={identity} scope={noteReadScope} t={t} />}
      <div className="note-meta"><span>{noteMeta(note)}</span>{editable && <span className="note-icon-actions"><button className="note-edit" title={t("Edit note")} aria-label={t("Edit note")} onClick={() => onEdit(note)} disabled={busy || !canMutateAnnotations}><Pencil size={13} /></button><button className="note-edit danger" title={t("Delete note")} aria-label={t("Delete note")} onClick={() => onDeleteNote(note)} disabled={busy || !canMutateAnnotations}><Trash2 size={13} /></button></span>}</div>
    </div>;
  };
  const renderMatchedSourcesDisclosure = (visibleSegments: SearchSegment[], heading: string, total: number, pageIndex: number, pageCount: number, first: number, last: number, onPageChange: (update: (page: number) => number) => void, documentText = false) => <details
    className={`matched-sources${documentText ? " matched-document-text" : ""}`}
    open={documentText ? expandedDocumentSourceSubject === detailSubjectIdentity : undefined}
    onToggle={documentText ? (event) => setExpandedDocumentSourceSubject(event.currentTarget.open ? detailSubjectIdentity : "") : undefined}
  >
    <summary><span>{t(heading)}</span><small>{t("{{count}} returned segments", { count: total })}</small><ChevronRight size={14} /></summary>
    <div className="matched-sources-body">
      {documentText && <p className="muted">{t("Extracted text from the saved original; formatting and page layout are not reproduced.")}</p>}
      <ul>{visibleSegments.map((segment, index) => {
        const metadata = searchSegmentMetadata(segment, t);
        const evidence = segment.matched_excerpt || segment.matched_text || "";
        const sourceLabel = segment.source_type?.trim() || segment.kind?.trim()
          ? searchSegmentSourceLabel(segment, t)
          : t("Source unavailable");
        return <li key={`${segment.source_type || "source"}-${segment.kind || "segment"}-${segment.ordinal ?? index}-${index}`}>
          <div className="matched-source-heading"><strong>{sourceLabel}</strong>{metadata.length > 0 && <small>{metadata.join(" · ")}</small>}</div>
          {evidence.trim() ? <p>{previewUnicodeText(evidence, 280)}</p> : <p className="matched-source-empty">{t("This source segment was returned without a text excerpt.")}</p>}
        </li>;
      })}</ul>
      {pageCount > 1 && <nav className="matched-source-paging" aria-label={t("Matched-source pages")}>
        <button type="button" className="text-button" onClick={() => onPageChange((page) => Math.max(0, page - 1))} disabled={pageIndex === 0}>{t("Previous segments")}</button>
        <small>{t("Showing {{first}}–{{last}} of {{total}} segments · Page {{page}} of {{pages}}", { first, last, total, page: pageIndex + 1, pages: pageCount })}</small>
        <button type="button" className="text-button" onClick={() => onPageChange((page) => Math.min(pageCount - 1, page + 1))} disabled={pageIndex + 1 >= pageCount}>{t("Next segments")}</button>
      </nav>}
    </div>
  </details>;
  const renderOcrEvidence = (item: { segment: SearchSegment; evidence: OcrSearchEvidence }, index: number) => {
    const { segment, evidence } = item;
    const quality = evidence.quality;
    const stateLabel = evidence.state === "TEXT" ? t("Text recognized")
      : evidence.state === "PARTIAL" ? t("Partially recognized")
        : evidence.state === "EMPTY" ? t("No text recognized")
          : t("Recognition state unknown");
    const confidence = quality?.meanConfidence;
    return <article className="matched-ocr-item" key={`${segment.source_id || "ocr"}-${segment.semantic_segment_id || index}-${segment.ordinal ?? index}`}>
      <div className="matched-ocr-heading"><strong>{t("OCR text")}</strong><span>{stateLabel}</span><small>{searchSegmentSourceLabel(segment, t)}</small></div>
      {evidence.text ? <><p className="matched-ocr-body">{previewUnicodeText(evidence.text, 6000)}</p>{Array.from(evidence.text).length > 6000 && <p className="matched-ocr-unknown">{t("Showing the first 6,000 characters of this returned OCR text.")}</p>}</> : <p className="matched-ocr-empty">{t("No recognized text was returned.")}</p>}
      {evidence.returnedFragment && <p className="matched-ocr-unknown">{t("Showing a returned text fragment.")}</p>}
      <details className="matched-ocr-quality">
        <summary>{t("Recognition quality")}</summary>
        <dl>
          <div><dt>{t("Mean confidence")}</dt><dd>{typeof confidence === "number" ? new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(confidence) : t("Unknown")}</dd></div>
          <div><dt>{t("Low-confidence regions")}</dt><dd>{typeof quality?.lowConfidenceRegions === "number" ? quality.lowConfidenceRegions : t("Unknown")}</dd></div>
          <div><dt>{t("Recognized regions")}</dt><dd>{typeof quality?.regionCount === "number" ? quality.regionCount : t("Unknown")}</dd></div>
          {typeof quality?.truncated === "boolean" && <div><dt>{t("Text truncated")}</dt><dd>{t(quality.truncated ? "Yes" : "No")}</dd></div>}
        </dl>
        {!quality && <p className="matched-ocr-unknown">{t(evidence.returnedFragment ? "Quality details are unavailable in this returned text fragment." : "Quality details were not returned.")}</p>}
      </details>
    </article>;
  };
  return <div className="details" ref={detailsRootRef}>
    <button className="detail-back text-button" ref={detailBackRef} onClick={onBack}><ArrowLeft size={15} />{t("Back to results")}</button>
    {navigation && <nav className="detail-result-navigation" aria-label={t("Loaded library results")}>
      <span>{t("Loaded library results")}</span>
      <button type="button" className="text-button" aria-label={t("Previous result")} title={t("Previous result")} onClick={navigation.previous} disabled={busy || navigation.position <= 1}><ChevronLeft size={16} /></button>
      <small>{t("Result {{position}} of {{total}}", { position: navigation.position, total: navigation.total })}</small>
      <button type="button" className="text-button" aria-label={t("Next result")} title={t("Next result")} onClick={navigation.next} disabled={busy || navigation.position >= navigation.total}><ChevronRight size={16} /></button>
    </nav>}
    <div className="detail-title"><span className="file-icon large"><FileSearch size={23} /></span><div className="detail-title-copy"><p className="eyebrow">{t("CONTENT ITEM")}</p><h2 ref={detailTitleRef} tabIndex={-1}>{hit.name || t("Untitled subject")}</h2><small>{formatEntryType(hit.entry_type, t)}</small></div><div className="detail-title-actions">{hit.entry_type === "REGULAR_FILE" && hit.entry_id && hit.content_id && <button type="button" className="secondary-button compact detail-download" onClick={() => downloadOriginal(workspaceId, hit.entry_id!, hit.name || "download.bin")}><DownloadIcon size={14} />{t("Download original")}</button>}{onExport && <button type="button" className="secondary-button compact detail-export" onClick={onExport}><DownloadIcon size={14} />{t("Export this file")}</button>}<span className={`assurance-seal ${verifiedExact ? "" : "warning"}`}><ShieldCheck size={16} />{t(assuranceLabel)}</span></div></div>
    {visibleMatchedOcrEvidence.length > 0 && <section className="matched-ocr-text" aria-label={t("Recognized image text")}>
      <div className="matched-ocr-section-heading"><h3>{t("Recognized image text")}</h3><small>{t("{{count}} returned OCR segments", { count: matchedOcrEvidence.length })}</small></div>
      {visibleMatchedOcrEvidence.map(renderOcrEvidence)}
      {matchedOcrPageCount > 1 && <nav className="matched-source-paging" aria-label={t("OCR segment pages")}>
        <button type="button" className="text-button" onClick={() => setMatchedOcrPage((page) => Math.max(0, page - 1))} disabled={matchedOcrPageIndex === 0}>{t("Previous segments")}</button>
        <small>{t("OCR page {{page}} of {{pages}}", { page: matchedOcrPageIndex + 1, pages: matchedOcrPageCount })}</small>
        <button type="button" className="text-button" onClick={() => setMatchedOcrPage((page) => Math.min(matchedOcrPageCount - 1, page + 1))} disabled={matchedOcrPageIndex + 1 >= matchedOcrPageCount}>{t("Next segments")}</button>
      </nav>}
    </section>}
    {documentBodySegments.length > 0 && renderMatchedSourcesDisclosure(visibleMatchedDocumentSegments, "Matched document text", documentBodySegments.length, matchedDocumentPageIndex, matchedDocumentPageCount, matchedDocumentFirst, matchedDocumentLast, setMatchedDocumentSourcePage, true)}
    {hit.entry_type === "REGULAR_FILE" && hit.name?.toLowerCase().endsWith(".cairn-list.json") && <MaterialListReader t={t} workspaceID={workspaceId} hit={materialListReadHit} catalogItems={catalogItems} onEdit={onEditMaterialList} onUseMaterialList={onUseMaterialList} actionsDisabled={materialListActionsDisabled} actionsDisabledReason={materialListActionsDisabledReason} />}
    {hit.entry_type !== "DIRECTORY" && <section className="detail-section preview-section"><div className="section-heading"><h3>{t(hit.name?.toLowerCase().endsWith(".cairn-list.json") ? "Original JSON" : "Preview")}</h3></div><ContentPreview key={`${workspaceId}:${hit.entry_id || hit.subject_ref || "subject"}:${hit.content_id || ""}`} command={command} locale={locale === "zh-CN" ? "zh-CN" : "en"} workspaceId={workspaceId} entryId={hit.entry_id} subjectRef={hit.subject_ref} contentId={hit.content_id} name={hit.name || t("Untitled subject")} logicalSize={hit.logical_size} exactAvailable={representationsStatus === "ready" ? previewAvailable : representationsStatus !== "error"} autoOpen={!hit.name?.toLowerCase().endsWith(".cairn-list.json")} /></section>}
    {otherMatchedSourceSegments.length > 0 && renderMatchedSourcesDisclosure(visibleMatchedSourceSegments, "Matched sources", otherMatchedSourceSegments.length, matchedSourcePageIndex, matchedSourcePageCount, matchedSourceFirst, matchedSourceLast, setMatchedSourcePage)}
    {matchedImageMetadata.map(({ segment, metadata }, index) => <details className="matched-information" key={`${segment.source_id || "artifact"}-${segment.semantic_segment_id || index}`}><summary><span>{t("Matched information")}</span><small>{t("Image metadata")}</small><ChevronRight size={14} /></summary><div className="matched-information-body"><dl className="matched-image-properties">{metadata.properties.map(([key, value]) => <div key={key}><dt>{key === "schema" ? t("Schema") : key === "format" ? t("Image format") : key === "width" ? t("Width") : key === "height" ? t("Height") : key === "bytes" ? t("Bytes") : key}</dt><dd>{searchImageMetadataPropertyText(value, t)}</dd></div>)}</dl><dl className="matched-image-provenance"><div><dt>{t("Source")}</dt><dd>{searchSegmentSourceLabel(segment, t)}</dd></div>{segment.producer?.trim() && <div><dt>{t("Producer")}</dt><dd>{segment.producer}</dd></div>}{typeof segment.accepted === "boolean" && <div><dt>{t("Acceptance")}</dt><dd>{t(segment.accepted ? "Accepted" : "Not accepted")}</dd></div>}{segment.language?.trim() && <div><dt>{t("Language")}</dt><dd>{segment.language}</dd></div>}</dl><div className="matched-image-original"><h4>{t("Original matched JSON")}</h4><pre>{metadata.raw}</pre></div></div></details>)}
    <MediaFacts facts={mediaFacts} state={mediaFactsState} track={track} work={work} t={t} />
    <dl className="facts"><div><dt>{t("Protection")}</dt><dd><span className={`inline-state ${verifiedExact ? "" : "warning"}`}>{verifiedExact ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{t(exactState)}</span></dd></div>{exact && <div><dt>{t("Logical size")}</dt><dd>{formatBytes(exact.decoded_length)}</dd></div>}</dl>
    <div className="detail-section notes-section"><div className="section-heading"><h3>{t("Notes")}</h3><span>{combinedNotes.length}</span></div>
      <div className="describe-action" data-describe-state={describeChecking ? "checking" : describeEnabled ? "ready" : "disabled"}>
        <button type="button" className="secondary-button compact describe-trigger" aria-describedby={describeReasonID} disabled={!describeEnabled || describeBusy || hasUnsavedDescriptionReview} onClick={() => setDescribeConfirmOpen(true)}><Sparkles size={14} />{t("Generate a description")}</button>
        <div className="describe-status" id={describeReasonID} role="status">
          {describeChecking && <p className="muted">{describeShortReason}</p>}
          {!describeChecking && describeReasons.length > 0 && <><p className="muted">{describeShortReason}</p><details className="describe-reason-details"><summary>{t("Why is description generation unavailable?")}</summary><ul className="describe-reasons">{describeReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details></>}
          {describeEnabled && !describeConfirmOpen && !generatedDocument && <p className="muted">{t("Generation runs only from this action, for this one subject; it never starts on selection or ingest.")}</p>}
          {hasUnsavedDescriptionReview && <p className="muted" role="status">{t("Finish or cancel the current review before generating another note.")}</p>}
          {describeEnabled && describeConfirmOpen && describeGrant && <div className="describe-confirm">
            <p>{t("Send one description request for this subject to the model provider?")}</p>
            <ul className="describe-reasons">
              <li>{t("What is sent: this subject's extracted text")}{subjectMayDiscloseImageBytes(hit) ? t("; because this is an image file, its image bytes may be sent") : ""}{t(". Private notes and other descriptions are never sent.")}</li>
              <li>{t("Provider: {{profile}} ({{digest}}) at {{host}}", { profile: String(describeGrant.profile_id ?? ""), digest: String(describeGrant.profile_digest ?? ""), host: String(describeGrant.endpoint_host ?? "") })}</li>
              <li>{t("Model: {{model}} · purpose DESCRIBE · egress grant {{grant}}", { model: String(describeGrant.model_id ?? ""), grant: String(describeGrant.grant_id ?? "") })}</li>
            </ul>
            <div className="note-actions">
              <button type="button" className="text-button" onClick={() => setDescribeConfirmOpen(false)} disabled={describeBusy}>{t("Cancel")}</button>
              <button type="button" className="primary-button compact" onClick={runDescribeGeneration} disabled={describeBusy || hasUnsavedDescriptionReview}>{t("Send to the model provider")}</button>
            </div>
          </div>}
          {describeError && <p className="muted" role="alert">{t("Generation failed: {{message}}", { message: describeError })}</p>}
          {describeSavedWarning && <p className="muted" role="status">{describeSavedWarning}</p>}
        </div>
      </div>
      <div className="notes-list">
        {generatedDocument && (() => {
          const revision = generatedDocument.revision;
          return <div className="note-row source-note" data-generated-description={String(generatedDocumentID)}>
            {(editingGeneratedDescription && !generatedDocument.accepted) || (activeDescriptionDraft && activeDescriptionDraft.body !== activeDescriptionDraft.originalBody)
              ? <label className="describe-editor">{t("Edit description before accepting")}
                {generatedDocument.accepted && <small>{t("Unsaved edits")}</small>}
                <textarea value={activeDescriptionDraft?.body ?? String(generatedDocument.body ?? "")} onChange={(event) => onUpdateDescriptionDraft(descriptionDraftKey, activeDescriptionDraft?.body ?? String(generatedDocument.body ?? ""), event.target.value)} disabled={describeBusy} />
              </label>
              : renderDescriptionBody({ ...generatedDocument, descriptionOnly: true })}
            <div className="note-meta">
              <span>{[descriptionKindLabel(generatedDocument.kind, t), generatedDocument.accepted ? t("Accepted") : t("Not accepted"), revision ? t("revision {{revision}}", { revision }) : ""].filter(Boolean).join(" · ")}</span>
              {(!generatedDocument.accepted || (activeDescriptionDraft && activeDescriptionDraft.body !== activeDescriptionDraft.originalBody)) && <span className="note-icon-actions">
                {!editingGeneratedDescription && !activeDescriptionDraft && <button type="button" className="text-button" onClick={() => { onBeginDescriptionDraft(descriptionDraftKey, String(generatedDocument.body ?? "")); setEditingGeneratedDescription(true); }} disabled={describeBusy}>{t("Edit before accepting")}</button>}
                {((editingGeneratedDescription && !generatedDocument.accepted) || (activeDescriptionDraft && activeDescriptionDraft.body !== activeDescriptionDraft.originalBody)) && <button type="button" className="text-button" onClick={() => { onClearDescriptionDraft(descriptionDraftKey); setEditingGeneratedDescription(false); }} disabled={describeBusy}>{t("Cancel edit")}</button>}
                <button type="button" className="text-button" onClick={acceptGeneratedDocument} disabled={describeBusy || !(activeDescriptionDraft?.body ?? String(generatedDocument.body ?? "")).trim()}>{t(generatedDocument.accepted ? "Save reviewed changes" : "Accept")}</button>
              </span>}
            </div>
          </div>;
        })()}
        {annotationStatus !== "ready" && <p className="muted" role="status">{detailStatus(annotationStatus)}</p>}
        {descriptionsStatus === "loading" && <p className="muted" role="status">{t("Loading current descriptions…")}</p>}
        {descriptionsTruncated && descriptionsStatus === "ready" && <div className="muted" role="status">
          <p>{t("Showing {{loaded}} of {{total}} current descriptions.", { loaded: descriptions.length, total: descriptionsTotal })}</p>
          <button type="button" className="text-button" onClick={onLoadMoreDescriptions} disabled={descriptionsPagePending} aria-busy={descriptionsPagePending}>
            {descriptionsPagePending ? t("Loading more descriptions…") : t("Load more current descriptions")}
          </button>
        </div>}
        {descriptionsStatus === "error" && <div className="muted" role="status">
          <p>{descriptionsPageError ? t("Current descriptions are unavailable: {{message}}", { message: descriptionsPageError }) : t("Some imported or generated notes are unavailable.")}</p>
          <button type="button" className="text-button" onClick={onRefreshDescriptions} disabled={descriptionsPagePending} aria-busy={descriptionsPagePending}>
            {descriptionsPagePending ? t("Loading current descriptions…") : t("Refresh current descriptions")}
          </button>
        </div>}
        {(annotationStatus === "ready" || descriptionsStatus === "ready") && combinedNotes.length > 0 && combinedNotes.map(renderNote)}
        {annotationStatus === "ready" && descriptionsStatus === "ready" && combinedNotes.length === 0 && !generatedDocument && <p className="muted">{t("No notes yet.")}</p>}
      </div>
      <div className="note-composer"><textarea aria-label={t("New note")} value={noteDraft} onChange={(event) => onDraft(event.target.value)} placeholder={t("Add useful context about this file")} disabled={!canMutateAnnotations} /><button className="primary-button compact" onClick={onAdd} disabled={busy || !canMutateAnnotations || !noteDraft.trim()}><Plus size={14} />{t("Add note")}</button></div>
    </div>
    <div className="detail-section tags-section"><div className="section-heading"><h3>{t("Tags")}</h3><span>{tags.length}</span></div>
      {annotationStatus !== "ready" ? <p className="muted" role="status">{detailStatus(annotationStatus)}</p> : <div className="tag-cloud">{systemTags.map((value) => <span className="tag-chip system" title={t("System field")} key={value}><Hash size={12} />{value}</span>)}{tags.map((tag) => <span className="tag-chip user" key={tag.annotation_id}><Tag size={12} />{tag.body}<button title={t("Remove tag")} aria-label={t("Remove tag {{tag}}", { tag: tag.body })} onClick={() => onDeleteTag(tag)} disabled={busy || !canMutateAnnotations}><X size={12} /></button></span>)}{!tags.length && <span className="muted">{t("No user tags yet.")}</span>}</div>}
      <div className="tag-composer"><input list="cairn-tag-vocabulary" aria-label={t("New tag")} value={tagDraft} onChange={(event) => onTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && tagDraft.trim() && canMutateAnnotations) { event.preventDefault(); onAddTag(); } }} placeholder={t("Add or reuse a tag")} disabled={!canMutateAnnotations} /><datalist id="cairn-tag-vocabulary">{suggestions.map((value) => <option value={value} key={value} />)}</datalist><button className="primary-button compact" onClick={onAddTag} disabled={busy || !canMutateAnnotations || !tagDraft.trim()}><Plus size={14} />{t("Add tag")}</button></div>
    </div>
    <div className="detail-section source-section"><div className="section-heading"><h3>{t("Source")}</h3></div><p className="source-path-value mono">{hit.path || t("Not recorded")}</p></div>
    <details className="technical-details"><summary><Hash size={14} /><span>{t("Technical details")}</span><small>{t("Full SHA-256 identity and visual fingerprint")}</small><ChevronRight size={14} /></summary><div className="technical-details-body"><div className="identity-band"><div className="identity-label"><span>{t("CONTENT WEAVE")}</span><small>{abbreviateIdentity(hit.content_id)}</small></div><IdentityWeave value={hit.content_id || hit.subject_ref} t={t} /></div><div className="technical-identity"><span>{t("Content identity (SHA-256 + length)")}</span><strong className="mono">{hit.content_id || t("Not available in this result")}</strong></div></div></details>
    <div className="detail-footer"><span><ShieldCheck size={14} />{t("Recovery remains independent of search indexes")}</span></div>
  </div>;
}

// MediaFacts renders the durable typed facts one subject declared, read from
// the same metadata_facts rows the processor host writes. Only a fact the file
// itself declared is shown: an absent fact is an absent row, never a zero, and
// an estimated duration says so instead of posing as a measured one. Track
// and work metadata come from the daemon's audio/books projections and stay
// in their own readable groups.
function MediaFacts({ facts, state, track, work, t }: { facts: any[]; state: "idle" | "loading" | "ready" | "error"; track: any | undefined; work: any | undefined; t: Translator }) {
  const rows = (labels: Record<string, string>) => {
    const out: Array<{ key: string; field: string; label: string; value: string }> = [];
    for (const fact of facts) {
      const field = `${fact.namespace}:${fact.key}`;
      const label = labels[field];
      if (!label) continue;
      let value = fact.value_json;
      if (fact.value_type === "string") value = String(value ?? "");
      if (value === undefined || value === null) continue;
      if (value === "") value = t("Empty value");
      const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
      if (fact.key.endsWith(".duration_ms") && Number.isFinite(numeric)) value = formatDuration(numeric, t);
      else if ((fact.key.endsWith(".width") || fact.key.endsWith(".height")) && Number.isFinite(numeric)) value = `${value} ${t("pixels")}`;
      else if (fact.key.endsWith(".sample_rate") && Number.isFinite(numeric)) value = `${value} ${t("Hz")}`;
      else if (fact.value_type === "boolean" && typeof value === "boolean") value = value ? t("Yes") : t("No");
      out.push({ key: `${field}:${fact.revision}`, field, label, value: String(value) });
    }
    return out;
  };
  const labels: Record<string, string> = {
    "image.format": t("Image format"), "image.width": t("Width"), "image.height": t("Height"),
    "video.container": t("Container"), "video.duration_ms": t("Duration"), "video.width": t("Width"), "video.height": t("Height"), "video.video_codec": t("Video codec"), "video.audio_codec": t("Audio codec"),
    "audio.duration_ms": t("Duration"), "audio.duration_estimated": t("Duration estimated"), "audio.sample_rate": t("Sample rate"), "audio.channels": t("Channels"), "audio.codec": t("Audio codec"),
  };
  const imageLabels = Object.fromEntries(["image.format", "image.width", "image.height"].map((key) => [`cairn.domain.image:${key}`, labels[key]]));
  const videoLabels = Object.fromEntries(["video.container", "video.duration_ms", "video.width", "video.height", "video.video_codec", "video.audio_codec"].map((key) => [`cairn.domain.video:${key}`, labels[key]]));
  const audioLabels = Object.fromEntries(["audio.duration_ms", "audio.duration_estimated", "audio.sample_rate", "audio.channels", "audio.codec"].map((key) => [`cairn.domain.audio:${key}`, labels[key]]));
  const rowsAll = [...rows(imageLabels), ...rows(videoLabels), ...rows(audioLabels)];
  const estimatedDuration = facts.some((fact) => `${fact.namespace}:${fact.key}` === "cairn.domain.audio:audio.duration_estimated" && fact.value_json === true);
  const trackRows = track ? [[t("Title"), track.title || track.name], [t("Artist"), track.artist], [t("Album"), track.album], [t("Track number"), track.track], [t("Year"), track.year], [t("Duration"), track.duration_ms !== undefined && track.duration_ms !== null ? formatDuration(track.duration_ms, t) : ""]].filter((row) => row[1] !== undefined && row[1] !== null && row[1] !== "") as Array<[string, unknown]> : [];
  const workRows = work ? [[t("Title"), work.title || work.name], [t("Author"), work.author], [t("Year"), work.year], [t("Kind"), work.kind]].filter((row) => row[1] !== undefined && row[1] !== null && row[1] !== "") as Array<[string, unknown]> : [];
  const nothing = state === "ready" && rowsAll.length === 0 && !trackRows.length && !workRows.length;
  const summaryStatus = state === "idle"
    ? t("File information has not been checked yet.")
    : state === "loading"
      ? t("Checking file information...")
      : state === "error"
        ? t("Could not load file information from this service.")
        : nothing
          ? t("No file information has been declared for this item.")
          : "";
  return <details className="detail-section media-section" data-media-state={state}>
    <summary className="media-section__summary"><span className="media-section__title" role="heading" aria-level={3}>{t("File information")}</span>{summaryStatus && <small className="media-section__status" role="status">{summaryStatus}</small>}<ChevronRight size={14} /></summary>
    <div className="media-section__body">
      {rowsAll.length > 0 && <dl className="facts media-facts">{rowsAll.map((row) => <div key={row.key}><dt>{row.label}</dt><dd>{row.value}{row.field === "cairn.domain.audio:audio.duration_ms" && estimatedDuration ? ` · ${t("estimated")}` : ""}</dd></div>)}</dl>}
      {trackRows.length > 0 && <section className="media-fact-group"><h4>{t("Track details")}</h4><dl className="facts media-facts">{trackRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl></section>}
      {workRows.length > 0 && <section className="media-fact-group"><h4>{t("Work details")}</h4><dl className="facts media-facts">{workRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl></section>}
    </div>
  </details>;
}

function formatDuration(milliseconds: number | string, t: Translator): string {
  if (typeof milliseconds === "string" && !milliseconds.trim()) return t("Empty value");
  const value = Number(milliseconds);
  if (!Number.isSafeInteger(value) || value < 0) return `${String(milliseconds)} ${t("ms")}`;
  if (value < 1000) return `${Number((value / 1000).toFixed(3))} ${t("s")}`;
  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const fractional = value % 1000;
  const secondText = `${String(seconds).padStart(2, "0")}${fractional ? `.${String(fractional).padStart(3, "0").replace(/0+$/, "")}` : ""}`;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secondText}` : `${minutes}:${secondText}`;
}

export function IdentityWeave({ value, t, compact = false }: { value?: string; t: Translator; compact?: boolean }) {
  const bars = identityBars(value, compact ? 12 : 32);
  return <span className={`identity-weave ${compact ? "compact" : ""}`} role="img" aria-label={t("Visual identity derived from the content SHA-256")}>{bars.map((bar, index) => <i className={`tone-${bar.tone}`} data-level={bar.level} key={index} />)}</span>;
}

// The details panel is a surface: it renders one subject and its own actions,
// and it owns the inspector column placement.
export function DetailsPanel(props: Parameters<typeof Details>[0]) {
  return <aside className="detail-column"><Details {...props} /></aside>;
}
