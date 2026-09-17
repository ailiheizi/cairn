import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, CheckCircle2, ChevronRight, Download as DownloadIcon, FileSearch, Hash, Pencil, Plus, ShieldCheck, Sparkles, Tag, Trash2, X } from "lucide-react";
import type { Locale, Translator } from "../i18n";
import { abbreviateIdentity, identityBars } from "../identity";
import { ContentPreview } from "./ContentPreview";
import { command } from "../app/command";
import { operations } from "../lib/operations";
import { deriveSystemTags, descriptionKindLabel, formatBytes, formatEntryType, formatNoteDate } from "../lib/format";
import type { DetailResourceStatus, SearchHit } from "../lib/types";

// The details inspector: one subject's exact-byte status, preview, notes, tags,
// provenance, and technical identity.
//
// The inspector reads and writes only this one subject. Its notes view merges
// the durable user notes with imported, extracted, and model-produced notes
// into the single Notes surface; the durable records keep their own provenance.

// On-demand description generation is one explicit action for one subject, and
// it can only run when the daemon defines an operation for it. `capability.list`
// advertises one row per known operation; the client can dispatch only a verb
// its typed map (`lib/operations.ts`) contains. That map holds description reads
// only, the daemon's single description write (`description.create`) stores a
// caller-supplied body and runs no provider, and no `DESCRIBE_SUBJECT`
// operation is advertised today. The closed set below is therefore empty: the
// action reports the missing capability with the daemon's own configuration
// state instead of sending a request the daemon does not define.
const describeGenerationOperationIDs: readonly string[] = [];

type DescribeProbe =
  | { state: "checking" }
  | { state: "ready"; descriptions: { enabled?: boolean; generate?: string; provider_profile?: string; credential_ref?: string }; generationAdvertised: boolean }
  | { state: "unreadable"; message: string };

export function Details({ workspaceId, hit, annotations, representations, descriptions, descriptionsTruncated, annotationStatus, representationsStatus, descriptionsStatus, annotationMutationEnabled, noteDraft, tagDraft, tagVocabulary, editingNoteID, editingBody, busy, t, locale, onBack, onExport, onDraft, onTagDraft, onAddTag, onDeleteTag, onAdd, onEdit, onDeleteNote, onEditBody, onSaveEdit, onCancelEdit }: { workspaceId: string; hit: SearchHit; annotations: any[]; representations: any[]; descriptions: any[]; descriptionsTruncated: boolean; annotationStatus: DetailResourceStatus; representationsStatus: DetailResourceStatus; descriptionsStatus: DetailResourceStatus; annotationMutationEnabled: boolean; noteDraft: string; tagDraft: string; tagVocabulary: string[]; editingNoteID: string; editingBody: string; busy: boolean; t: Translator; locale: Locale; onBack: () => void; onExport?: () => void; onDraft: (value: string) => void; onTagDraft: (value: string) => void; onAddTag: () => void; onDeleteTag: (tag: any) => void; onAdd: () => void; onEdit: (note: any) => void; onDeleteNote: (note: any) => void; onEditBody: (value: string) => void; onSaveEdit: (note: any) => void; onCancelEdit: () => void }) {
  // The generation action's availability probe: the daemon's persisted
  // description settings plus the operations it advertises. Both are reads. The
  // probe runs once per workspace while the inspector is open, never starts,
  // schedules, or implies a generation, and reports every unmet gate by name.
  const describeReasonID = useId();
  const [describeProbe, setDescribeProbe] = useState<DescribeProbe>({ state: "checking" });
  const describeProbeToken = useRef(0);
  useEffect(() => {
    const token = ++describeProbeToken.current;
    setDescribeProbe({ state: "checking" });
    void (async () => {
      const [configResult, capabilityResult] = await Promise.allSettled([
        command(operations.config.get, {}),
        command(operations.capability.list, {}),
      ]);
      if (describeProbeToken.current !== token) return;
      if (configResult.status === "rejected" || capabilityResult.status === "rejected") {
        const failure = configResult.status === "rejected" ? configResult.reason : (capabilityResult as PromiseRejectedResult).reason;
        setDescribeProbe({ state: "unreadable", message: failure instanceof Error ? failure.message : String(failure) });
        return;
      }
      const capabilities = capabilityResult.value.data?.capabilities ?? [];
      setDescribeProbe({
        state: "ready",
        descriptions: configResult.value.data?.config?.descriptions ?? {},
        generationAdvertised: capabilities.some((capability: any) => capability?.kind === "operation"
          && capability?.state === "AVAILABLE"
          && describeGenerationOperationIDs.includes(String(capability?.id ?? ""))),
      });
    })();
  }, [workspaceId]);
  const describeReasons: string[] = [];
  if (describeProbe.state === "unreadable") {
    describeReasons.push(t("Could not read the daemon's description settings and capabilities: {{message}}", { message: describeProbe.message }));
  } else if (describeProbe.state === "ready") {
    // Every unmet gate is named, deepest last: the settings the operator owns,
    // then the capability the daemon has to publish before a request could be
    // dispatched at all.
    if (describeProbe.descriptions.enabled !== true) describeReasons.push(t("Descriptions are turned off in the settings (descriptions.enabled)."));
    if (String(describeProbe.descriptions.generate ?? "").trim() === "disabled") describeReasons.push(t("On-demand generation is turned off in the settings (descriptions.generate)."));
    if (!String(describeProbe.descriptions.provider_profile ?? "").trim()) describeReasons.push(t("No description provider profile is selected (descriptions.provider_profile)."));
    if (!String(describeProbe.descriptions.credential_ref ?? "").trim()) describeReasons.push(t("No credential reference is configured for the description provider (descriptions.credential_ref)."));
    if (!describeProbe.generationAdvertised) describeReasons.push(t("This daemon does not implement on-demand description generation (no DESCRIBE_SUBJECT operation)."));
  }
  const describeChecking = describeProbe.state === "checking";
  const describeEnabled = describeProbe.state === "ready" && describeReasons.length === 0;
  const notes = annotations.filter((item) => item.kind === "NOTE" && !item.tombstoned);
  // A successor replaces a previous generated/imported note in the daily
  // view. The complete revision chain remains durable in the catalog.
  const supersededDescriptionIDs = new Set(descriptions.map((item) => item.predecessor_id).filter(Boolean));
  const currentDescriptions = descriptions.filter((item) => !item.tombstoned && !supersededDescriptionIDs.has(item.description_document_id));
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
    <div className="detail-title"><span className="file-icon large"><FileSearch size={23} /></span><div className="detail-title-copy"><p className="eyebrow">{t("CONTENT ITEM")}</p><h2>{hit.name || t("Untitled subject")}</h2><small>{formatEntryType(hit.entry_type, t)}</small></div><div className="detail-title-actions">{onExport && <button type="button" className="secondary-button compact detail-export" onClick={onExport}><DownloadIcon size={14} />{t("Export this file")}</button>}<span className={`assurance-seal ${verifiedExact ? "" : "warning"}`}><ShieldCheck size={16} />{t(assuranceLabel)}</span></div></div>
    {hit.entry_type !== "DIRECTORY" && <section className="detail-section preview-section"><div className="section-heading"><h3>{t("Preview")}</h3></div><ContentPreview key={`${workspaceId}:${hit.entry_id || hit.subject_ref || "subject"}:${hit.content_id || ""}`} command={command} locale={locale === "zh-CN" ? "zh-CN" : "en"} workspaceId={workspaceId} entryId={hit.entry_id} subjectRef={hit.subject_ref} contentId={hit.content_id} name={hit.name || t("Untitled subject")} logicalSize={hit.logical_size} exactAvailable={representationsStatus === "ready" ? previewAvailable : representationsStatus !== "error"} autoOpen /></section>}
    <dl className="facts"><div><dt>{t("Protection")}</dt><dd><span className={`inline-state ${verifiedExact ? "" : "warning"}`}>{verifiedExact ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{t(exactState)}</span></dd></div>{exact && <div><dt>{t("Logical size")}</dt><dd>{formatBytes(exact.decoded_length)}</dd></div>}</dl>
    <div className="detail-section notes-section"><div className="section-heading"><h3>{t("Notes")}</h3><span>{combinedNotes.length}</span></div>
      <div className="describe-action" data-describe-state={describeChecking ? "checking" : describeEnabled ? "ready" : "disabled"}>
        <button type="button" className="secondary-button compact describe-trigger" aria-describedby={describeReasonID} disabled={!describeEnabled}><Sparkles size={14} />{t("Generate a description")}</button>
        <div className="describe-status" id={describeReasonID} role="status">
          {describeChecking && <p className="muted">{t("Checking whether this daemon can generate a description...")}</p>}
          {!describeChecking && describeReasons.length > 0 && <><p className="muted">{t("Generation is unavailable:")}</p><ul className="describe-reasons">{describeReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></>}
          {describeEnabled && <p className="muted">{t("Generation runs only from this action, for this one subject; it never starts on selection or ingest.")}</p>}
        </div>
      </div>
      <div className="notes-list">
        {annotationStatus !== "ready" && <p className="muted" role="status">{detailStatus(annotationStatus)}</p>}
        {descriptionsStatus === "loading" && <p className="muted" role="status">{t("Loading additional notes...")}</p>}
        {descriptionsTruncated && descriptionsStatus === "ready" && <p className="muted" role="status">{t("Showing the latest notes; older note history is not loaded yet.")}</p>}
        {descriptionsStatus === "error" && <p className="muted" role="status">{t("Some imported or generated notes are unavailable.")}</p>}
        {(annotationStatus === "ready" || descriptionsStatus === "ready") && combinedNotes.length > 0 && combinedNotes.map(renderNote)}
        {annotationStatus === "ready" && descriptionsStatus === "ready" && combinedNotes.length === 0 && <p className="muted">{t("No notes yet.")}</p>}
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

export function IdentityWeave({ value, t, compact = false }: { value?: string; t: Translator; compact?: boolean }) {
  const bars = identityBars(value, compact ? 12 : 32);
  return <span className={`identity-weave ${compact ? "compact" : ""}`} role="img" aria-label={t("Visual identity derived from the content SHA-256")}>{bars.map((bar, index) => <i className={`tone-${bar.tone}`} data-level={bar.level} key={index} />)}</span>;
}

// The details panel is a surface: it renders one subject and its own actions,
// and it owns the inspector column placement.
export function DetailsPanel(props: Parameters<typeof Details>[0]) {
  return <aside className="detail-column"><Details {...props} /></aside>;
}
