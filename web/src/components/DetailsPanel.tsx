import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, CheckCircle2, ChevronRight, Download as DownloadIcon, FileSearch, Hash, Pencil, Plus, ShieldCheck, Sparkles, Tag, Trash2, X } from "lucide-react";
import type { Locale, Translator } from "../i18n";
import { abbreviateIdentity, identityBars } from "../identity";
import { ContentPreview } from "./ContentPreview";
import { command } from "../app/command";
import { operations } from "../lib/operations";
import { downloadOriginal } from "../lib/contentDownload";
import { deriveSystemTags, descriptionKindLabel, formatBytes, formatEntryType, formatNoteDate } from "../lib/format";
import type { DetailResourceStatus, SearchHit } from "../lib/types";

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
// provider profile, so the action additionally requires a live DESCRIBE egress
// grant (resolved from the daemon's own grant list) and one explicit
// confirmation step that names exactly what will be sent before any request.
const describeGenerationOperationIDs: readonly string[] = ["description.generate"];

// The covering egress grant row the confirmation step binds the dispatch to.
type DescribeGrant = {
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
  | { state: "ready"; descriptions: { enabled?: boolean; generate?: string; provider_profile?: string; credential_ref?: string }; generationAdvertised: boolean; coveringGrant: DescribeGrant | null }
  | { state: "unreadable"; message: string };

// A subject whose admitted image bytes may be part of the disclosure. The
// daemon decides from its own profile and facts; this only decides whether the
// confirmation dialog names image bytes as a possible payload.
function subjectMayDiscloseImageBytes(hit: SearchHit): boolean {
  return hit.entry_type === "FILE" && /\.(jpe?g|png)$/i.test(hit.name || "");
}

export function Details({ workspaceId, hit, annotations, representations, descriptions, descriptionsTruncated, mediaFacts, mediaFactsState, track, work, annotationStatus, representationsStatus, descriptionsStatus, annotationMutationEnabled, noteDraft, tagDraft, tagVocabulary, editingNoteID, editingBody, busy, t, locale, onBack, onExport, onDraft, onTagDraft, onAddTag, onDeleteTag, onAdd, onEdit, onDeleteNote, onEditBody, onSaveEdit, onCancelEdit }: { workspaceId: string; hit: SearchHit; annotations: any[]; representations: any[]; descriptions: any[]; descriptionsTruncated: boolean; mediaFacts: any[]; mediaFactsState: "idle" | "loading" | "ready" | "error"; track: any | undefined; work: any | undefined; annotationStatus: DetailResourceStatus; representationsStatus: DetailResourceStatus; descriptionsStatus: DetailResourceStatus; annotationMutationEnabled: boolean; noteDraft: string; tagDraft: string; tagVocabulary: string[]; editingNoteID: string; editingBody: string; busy: boolean; t: Translator; locale: Locale; onBack: () => void; onExport?: () => void; onDraft: (value: string) => void; onTagDraft: (value: string) => void; onAddTag: () => void; onDeleteTag: (tag: any) => void; onAdd: () => void; onEdit: (note: any) => void; onDeleteNote: (note: any) => void; onEditBody: (value: string) => void; onSaveEdit: (note: any) => void; onCancelEdit: () => void }) {
  // The generation action's availability probe: the daemon's persisted
  // description settings, the operations it advertises, and its live egress
  // grant list. All three are reads. The probe runs once per workspace while
  // the inspector is open, never starts, schedules, or implies a generation,
  // and reports every unmet gate by name.
  const describeReasonID = useId();
  const [describeProbe, setDescribeProbe] = useState<DescribeProbe>({ state: "checking" });
  const [describeConfirmOpen, setDescribeConfirmOpen] = useState(false);
  const [describeBusy, setDescribeBusy] = useState(false);
  const [describeError, setDescribeError] = useState("");
  // The generated candidate (and its accepted successor after Accept) is held
  // locally so the one Notes surface renders the daemon's own result
  // immediately, with its AI label, non-accepted state, and revision.
  const [generatedDocument, setGeneratedDocument] = useState<any | null>(null);
  const describeProbeToken = useRef(0);
  useEffect(() => {
    const token = ++describeProbeToken.current;
    setDescribeProbe({ state: "checking" });
    setDescribeConfirmOpen(false);
    setDescribeError("");
    setGeneratedDocument(null);
    void (async () => {
      const [configResult, capabilityResult, grantResult] = await Promise.allSettled([
        command(operations.config.get, {}),
        command(operations.capability.list, {}),
        command(operations.egress.grantList, { workspace_id: workspaceId }),
      ]);
      if (describeProbeToken.current !== token) return;
      const failure = [configResult, capabilityResult, grantResult].find((result) => result.status === "rejected");
      if (failure) {
        const reason = (failure as PromiseRejectedResult).reason;
        setDescribeProbe({ state: "unreadable", message: reason instanceof Error ? reason.message : String(reason) });
        return;
      }
      const capabilities = capabilityResult.status === "fulfilled" ? capabilityResult.value.data?.capabilities ?? [] : [];
      const grants = grantResult.status === "fulfilled" ? grantResult.value.data?.grants ?? [] : [];
      setDescribeProbe({
        state: "ready",
        descriptions: configResult.status === "fulfilled" ? configResult.value.data?.config?.descriptions ?? {} : {},
        generationAdvertised: capabilities.some((capability: any) => capability?.kind === "operation"
          && capability?.state === "AVAILABLE"
          && describeGenerationOperationIDs.includes(String(capability?.id ?? ""))),
        coveringGrant: grants.find((grant: DescribeGrant) => grant?.live && !grant?.revoked
          && String(grant?.purpose ?? "").toUpperCase() === "DESCRIBE") ?? null,
      });
    })();
  }, [workspaceId]);
  const describeSubjectRef = hit.subject_ref?.trim() ?? "";
  // A generated result belongs to exactly one subject: switching the inspected
  // subject drops the local candidate rather than carrying it over.
  useEffect(() => {
    setGeneratedDocument(null);
    setDescribeConfirmOpen(false);
    setDescribeError("");
  }, [describeSubjectRef]);
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
    if (!describeEnabled || !describeGrant || !hit.subject_ref) return;
    setDescribeBusy(true);
    setDescribeError("");
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
      if (document) setGeneratedDocument(document);
      setDescribeConfirmOpen(false);
    } catch (error) {
      setDescribeError(error instanceof Error ? error.message : String(error));
    } finally {
      setDescribeBusy(false);
    }
  };
  // acceptGeneratedDocument creates the accepted successor the user decided
  // on: description.create with the candidate's own body, kind, and
  // predecessor. The model can never mark its own revision user-accepted.
  const acceptGeneratedDocument = async () => {
    const document = generatedDocument;
    if (!document || !hit.subject_ref) return;
    setDescribeBusy(true);
    setDescribeError("");
    try {
      const result = await command(operations.description.create, {
        workspace_id: workspaceId,
        subject_ref: hit.subject_ref,
        kind: document.kind,
        body: document.body,
        predecessor_id: document.description_document_id || document.id,
        accepted: true,
      });
      const successor = result.data?.document;
      if (successor) setGeneratedDocument(successor);
    } catch (error) {
      setDescribeError(error instanceof Error ? error.message : String(error));
    } finally {
      setDescribeBusy(false);
    }
  };
  const notes = annotations.filter((item) => item.kind === "NOTE" && !item.tombstoned);
  // A successor replaces a previous generated/imported note in the daily
  // view. The complete revision chain remains durable in the catalog. The
  // locally generated candidate (and its accepted successor) is rendered by
  // its own row below; a daemon list that already contains that revision must
  // not render it twice.
  const supersededDescriptionIDs = new Set(descriptions.map((item) => item.predecessor_id).filter(Boolean));
  // The locally held generated revision (or its accepted successor) is
  // rendered by its own row below; a daemon list that already carries that
  // same revision must not render it twice. Its predecessor is already
  // superseded by it either way.
  const generatedDocumentID = generatedDocument ? String(generatedDocument.description_document_id || generatedDocument.id || "") : "";
  const generatedPredecessorID = generatedDocument ? String(generatedDocument.predecessor_id || "") : "";
  const currentDescriptions = descriptions.filter((item) => !item.tombstoned
    && !supersededDescriptionIDs.has(item.description_document_id)
    && item.description_document_id !== generatedDocumentID
    && item.description_document_id !== generatedPredecessorID);
  const descriptionNotes = currentDescriptions.map((item) => {
    const body = typeof item.body === "string" && item.body.trim()
      ? item.body
      : typeof item.title === "string" && item.title.trim()
        ? item.title
        : t("Note content unavailable");
    return {
      ...item,
      body,
      sourceLabel: descriptionKindLabel(item.kind, t),
      descriptionOnly: true,
    };
  });
  const combinedNotes = [...notes, ...descriptionNotes];
  const tags = annotations.filter((item) => item.kind === "TAG" && !item.tombstoned);
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
  const renderNote = (note: any) => {
    const noteID = note.annotation_id || note.description_document_id || `${note.kind || "note"}-${note.revision || note.body}`;
    const editable = !note.descriptionOnly;
    if (editable && editingNoteID === note.annotation_id) {
      return <div className="note-row editing" key={noteID}><textarea autoFocus aria-label={t("Edit note")} value={editingBody} onChange={(event) => onEditBody(event.target.value)} disabled={!canMutateAnnotations} /><div className="note-actions"><button className="text-button" onClick={onCancelEdit} disabled={busy}>{t("Cancel")}</button><button className="primary-button compact" onClick={() => onSaveEdit(note)} disabled={busy || !canMutateAnnotations || !editingBody.trim()}><Check size={14} />{t("Save")}</button></div></div>;
    }
    return <div className={`note-row ${note.descriptionOnly ? "source-note" : ""}`} key={noteID}><p>{note.body}</p><div className="note-meta"><span>{noteMeta(note)}</span>{editable && <span className="note-icon-actions"><button className="note-edit" title={t("Edit note")} aria-label={t("Edit note")} onClick={() => onEdit(note)} disabled={busy || !canMutateAnnotations}><Pencil size={13} /></button><button className="note-edit danger" title={t("Delete note")} aria-label={t("Delete note")} onClick={() => onDeleteNote(note)} disabled={busy || !canMutateAnnotations}><Trash2 size={13} /></button></span>}</div></div>;
  };
  return <div className="details">
    <button className="detail-back text-button" onClick={onBack}><ArrowLeft size={15} />{t("Back to results")}</button>
    <div className="detail-title"><span className="file-icon large"><FileSearch size={23} /></span><div className="detail-title-copy"><p className="eyebrow">{t("CONTENT ITEM")}</p><h2>{hit.name || t("Untitled subject")}</h2><small>{formatEntryType(hit.entry_type, t)}</small></div><div className="detail-title-actions">{hit.entry_type === "REGULAR_FILE" && hit.entry_id && hit.content_id && <button type="button" className="secondary-button compact detail-download" onClick={() => downloadOriginal(workspaceId, hit.entry_id!, hit.name || "download.bin")}><DownloadIcon size={14} />{t("Download original")}</button>}{onExport && <button type="button" className="secondary-button compact detail-export" onClick={onExport}><DownloadIcon size={14} />{t("Export this file")}</button>}<span className={`assurance-seal ${verifiedExact ? "" : "warning"}`}><ShieldCheck size={16} />{t(assuranceLabel)}</span></div></div>
    {hit.entry_type !== "DIRECTORY" && <section className="detail-section preview-section"><div className="section-heading"><h3>{t("Preview")}</h3></div><ContentPreview key={`${workspaceId}:${hit.entry_id || hit.subject_ref || "subject"}:${hit.content_id || ""}`} command={command} locale={locale === "zh-CN" ? "zh-CN" : "en"} workspaceId={workspaceId} entryId={hit.entry_id} subjectRef={hit.subject_ref} contentId={hit.content_id} name={hit.name || t("Untitled subject")} logicalSize={hit.logical_size} exactAvailable={representationsStatus === "ready" ? previewAvailable : representationsStatus !== "error"} autoOpen /></section>}
    <MediaFacts facts={mediaFacts} state={mediaFactsState} track={track} work={work} t={t} />
    <dl className="facts"><div><dt>{t("Protection")}</dt><dd><span className={`inline-state ${verifiedExact ? "" : "warning"}`}>{verifiedExact ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{t(exactState)}</span></dd></div>{exact && <div><dt>{t("Logical size")}</dt><dd>{formatBytes(exact.decoded_length)}</dd></div>}</dl>
    <div className="detail-section notes-section"><div className="section-heading"><h3>{t("Notes")}</h3><span>{combinedNotes.length}</span></div>
      <div className="describe-action" data-describe-state={describeChecking ? "checking" : describeEnabled ? "ready" : "disabled"}>
        <button type="button" className="secondary-button compact describe-trigger" aria-describedby={describeReasonID} disabled={!describeEnabled || describeBusy} onClick={() => setDescribeConfirmOpen(true)}><Sparkles size={14} />{t("Generate a description")}</button>
        <div className="describe-status" id={describeReasonID} role="status">
          {describeChecking && <p className="muted">{describeShortReason}</p>}
          {!describeChecking && describeReasons.length > 0 && <><p className="muted">{describeShortReason}</p><details className="describe-reason-details"><summary>{t("Why is description generation unavailable?")}</summary><ul className="describe-reasons">{describeReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details></>}
          {describeEnabled && !describeConfirmOpen && !generatedDocument && <p className="muted">{t("Generation runs only from this action, for this one subject; it never starts on selection or ingest.")}</p>}
          {describeEnabled && describeConfirmOpen && describeGrant && <div className="describe-confirm">
            <p>{t("Send one description request for this subject to the model provider?")}</p>
            <ul className="describe-reasons">
              <li>{t("What is sent: this subject's extracted text")}{subjectMayDiscloseImageBytes(hit) ? t("; because this is an image file, its image bytes may be sent") : ""}{t(". Private notes and other descriptions are never sent.")}</li>
              <li>{t("Provider: {{profile}} ({{digest}}) at {{host}}", { profile: String(describeGrant.profile_id ?? ""), digest: String(describeGrant.profile_digest ?? ""), host: String(describeGrant.endpoint_host ?? "") })}</li>
              <li>{t("Model: {{model}} · purpose DESCRIBE · egress grant {{grant}}", { model: String(describeGrant.model_id ?? ""), grant: String(describeGrant.grant_id ?? "") })}</li>
            </ul>
            <div className="note-actions">
              <button type="button" className="text-button" onClick={() => setDescribeConfirmOpen(false)} disabled={describeBusy}>{t("Cancel")}</button>
              <button type="button" className="primary-button compact" onClick={runDescribeGeneration} disabled={describeBusy}>{t("Send to the model provider")}</button>
            </div>
          </div>}
          {describeError && <p className="muted" role="alert">{t("Generation failed: {{message}}", { message: describeError })}</p>}
        </div>
      </div>
      <div className="notes-list">
        {generatedDocument && (() => {
          const body = typeof generatedDocument.body === "string" && generatedDocument.body.trim() ? generatedDocument.body : t("Note content unavailable");
          const revision = generatedDocument.revision;
          return <div className="note-row source-note" data-generated-description={String(generatedDocumentID)}>
            <p>{body}</p>
            <div className="note-meta">
              <span>{[descriptionKindLabel(generatedDocument.kind, t), generatedDocument.accepted ? t("Accepted") : t("Not accepted"), revision ? t("revision {{revision}}", { revision }) : ""].filter(Boolean).join(" · ")}</span>
              {!generatedDocument.accepted && <span className="note-icon-actions"><button type="button" className="text-button" onClick={acceptGeneratedDocument} disabled={describeBusy}>{t("Accept")}</button></span>}
            </div>
          </div>;
        })()}
        {annotationStatus !== "ready" && <p className="muted" role="status">{detailStatus(annotationStatus)}</p>}
        {descriptionsStatus === "loading" && <p className="muted" role="status">{t("Loading additional notes...")}</p>}
        {descriptionsTruncated && descriptionsStatus === "ready" && <p className="muted" role="status">{t("Showing the latest notes; older note history is not loaded yet.")}</p>}
        {descriptionsStatus === "error" && <p className="muted" role="status">{t("Some imported or generated notes are unavailable.")}</p>}
        {(annotationStatus === "ready" || descriptionsStatus === "ready") && combinedNotes.length > 0 && combinedNotes.map(renderNote)}
        {annotationStatus === "ready" && descriptionsStatus === "ready" && combinedNotes.length === 0 && !generatedDocument && <p className="muted">{t("No notes yet.")}</p>}
      </div>
      <div className="note-composer"><textarea aria-label={t("New note")} value={noteDraft} onChange={(event) => onDraft(event.target.value)} placeholder={t("Add useful context about this file")} disabled={!canMutateAnnotations} /><button className="primary-button compact" onClick={onAdd} disabled={busy || !canMutateAnnotations || !noteDraft.trim()}><Plus size={14} />{t("Add note")}</button></div>
    </div>
    <div className="detail-section tags-section"><div className="section-heading"><h3>{t("Tags")}</h3><span>{tags.length}</span></div>
      {annotationStatus !== "ready" ? <p className="muted" role="status">{detailStatus(annotationStatus)}</p> : <div className="tag-cloud">{systemTags.map((value) => <span className="tag-chip system" title={t("System field")} key={value}><Hash size={12} />{value}</span>)}{tags.map((tag) => <span className="tag-chip user" key={tag.annotation_id}><Tag size={12} />{tag.body}<button title={t("Remove tag")} aria-label={t("Remove tag {{tag}}", { tag: tag.body })} onClick={() => onDeleteTag(tag)} disabled={busy || !canMutateAnnotations}><X size={12} /></button></span>)}{!tags.length && <span className="muted">{t("No user tags yet.")}</span>}</div>}
      <div className="tag-composer"><input list="restoreweave-tag-vocabulary" aria-label={t("New tag")} value={tagDraft} onChange={(event) => onTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && tagDraft.trim() && canMutateAnnotations) { event.preventDefault(); onAddTag(); } }} placeholder={t("Add or reuse a tag")} disabled={!canMutateAnnotations} /><datalist id="restoreweave-tag-vocabulary">{suggestions.map((value) => <option value={value} key={value} />)}</datalist><button className="primary-button compact" onClick={onAddTag} disabled={busy || !canMutateAnnotations || !tagDraft.trim()}><Plus size={14} />{t("Add tag")}</button></div>
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
  const imageLabels = Object.fromEntries(["image.format", "image.width", "image.height"].map((key) => [`restoreweave.domain.image:${key}`, labels[key]]));
  const videoLabels = Object.fromEntries(["video.container", "video.duration_ms", "video.width", "video.height", "video.video_codec", "video.audio_codec"].map((key) => [`restoreweave.domain.video:${key}`, labels[key]]));
  const audioLabels = Object.fromEntries(["audio.duration_ms", "audio.duration_estimated", "audio.sample_rate", "audio.channels", "audio.codec"].map((key) => [`restoreweave.domain.audio:${key}`, labels[key]]));
  const rowsAll = [...rows(imageLabels), ...rows(videoLabels), ...rows(audioLabels)];
  const estimatedDuration = facts.some((fact) => `${fact.namespace}:${fact.key}` === "restoreweave.domain.audio:audio.duration_estimated" && fact.value_json === true);
  const trackRows = track ? [[t("Title"), track.title || track.name], [t("Artist"), track.artist], [t("Album"), track.album], [t("Track number"), track.track], [t("Year"), track.year], [t("Duration"), track.duration_ms !== undefined && track.duration_ms !== null ? formatDuration(track.duration_ms, t) : ""]].filter((row) => row[1] !== undefined && row[1] !== null && row[1] !== "") as Array<[string, unknown]> : [];
  const workRows = work ? [[t("Title"), work.title || work.name], [t("Author"), work.author], [t("Year"), work.year], [t("Kind"), work.kind]].filter((row) => row[1] !== undefined && row[1] !== null && row[1] !== "") as Array<[string, unknown]> : [];
  const nothing = state === "ready" && rowsAll.length === 0 && !trackRows.length && !workRows.length;
  return <div className="detail-section media-section" data-media-state={state}>
    <div className="section-heading"><h3>{t("File information")}</h3></div>
    {state === "idle" && <p className="muted" role="status">{t("File information has not been checked yet.")}</p>}
    {state === "loading" && <p className="muted" role="status">{t("Checking file information...")}</p>}
    {state === "error" && <p className="muted" role="status">{t("Could not load file information from this service.")}</p>}
    {nothing && <p className="muted">{t("No file information has been declared for this item.")}</p>}
    {rowsAll.length > 0 && <dl className="facts media-facts">{rowsAll.map((row) => <div key={row.key}><dt>{row.label}</dt><dd>{row.value}{row.field === "restoreweave.domain.audio:audio.duration_ms" && estimatedDuration ? ` · ${t("estimated")}` : ""}</dd></div>)}</dl>}
    {trackRows.length > 0 && <section className="media-fact-group"><h4>{t("Track details")}</h4><dl className="facts media-facts">{trackRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl></section>}
    {workRows.length > 0 && <section className="media-fact-group"><h4>{t("Work details")}</h4><dl className="facts media-facts">{workRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl></section>}
  </div>;
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
