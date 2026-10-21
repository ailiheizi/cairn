import { AlertCircle, LoaderCircle, RefreshCw, Save } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { Translator } from "../i18n";
import { hasSavedRetrievalTagFields, type SavedRetrievalCandidate } from "../lib/savedRetrievalCandidate";
import { projectSavedRetrievalConditions } from "../lib/savedRetrievalConditions";
import { validateSavedRetrievalDraft } from "../lib/savedRetrievalEdit";
import type { SavedViewData } from "../lib/types";
import type { ExportFlow } from "../app/useExport";
import "./SavedRetrievalPanel.css";

type EditorFlow = Pick<ExportFlow,
  | "savedViews"
  | "savedViewsLoaded"
  | "savedViewsLoading"
  | "savedViewsError"
  | "savedRetrievalSaving"
  | "savedRetrievalMessage"
  | "savedRetrievalError"
  | "loadSavedViews"
  | "saveSavedRetrievalView"
>;

export type SavedRetrievalUpdateRequest = {
  token: number;
  view: SavedViewData;
  trigger?: HTMLElement | null;
};

export type SavedRetrievalSourceRequest = {
  token: number;
  view: SavedViewData;
  trigger?: HTMLElement | null;
};

export function SavedRetrievalEditor({ flow, candidate, workspaceID, t, busy = false, initialName = "", updateRequest, sourceRequest, onSaved }: {
  flow: EditorFlow;
  candidate: SavedRetrievalCandidate;
  workspaceID: string;
  t: Translator;
  busy?: boolean;
  initialName?: string;
  updateRequest?: SavedRetrievalUpdateRequest;
  sourceRequest?: SavedRetrievalSourceRequest;
  onSaved?: (view: SavedViewData) => void;
}) {
  const [name, setName] = useState(initialName);
  const [pendingUpdate, setPendingUpdate] = useState<{ viewID: string; revision: number; fingerprint: string; recordFingerprint: string }>();
  const [focusUpdateConfirmation, setFocusUpdateConfirmation] = useState(false);
  const [sourceView, setSourceView] = useState<SavedViewData>();
  const [sourceMode, setSourceMode] = useState<"update" | "copy">("update");
  const [draftQuery, setDraftQuery] = useState("");
  const [draftFieldLines, setDraftFieldLines] = useState("");
  const [focusSourceQuery, setFocusSourceQuery] = useState(false);
  const updateConfirmationRef = useRef<HTMLElement | null>(null);
  const sourceQueryRef = useRef<HTMLTextAreaElement | null>(null);
  const updateTriggerRef = useRef<HTMLElement | null>(null);
  const handledUpdateTokenRef = useRef<number | undefined>(undefined);
  const handledSourceTokenRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(false);
  const callbackIdentityRef = useRef("");
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const savedName = name.trim();
  const savedQuery = (sourceView ? draftQuery : candidate.query).trim();
  const savedFields = sourceView
    ? [...new Set(draftFieldLines.split("\n").map((field) => field.trim()).filter(Boolean))]
    : [...new Set(candidate.fields.map((field) => field.trim()).filter(Boolean))];
  const draftValid = !sourceView || validateSavedRetrievalDraft(savedQuery, savedFields);
  const draftUnsupported = sourceView
    ? (draftValid ? [] : [t("Edit only supported query conditions, one saved field per line.")])
    : candidate.unsupportedConditions;
  const updateFingerprint = (candidateName = savedName) => JSON.stringify([
    candidateName,
    savedQuery,
    savedFields,
    workspaceID,
    draftUnsupported,
  ]);
  const currentFingerprint = updateFingerprint();
  const hasSupportedConditions = savedFields.length > 0;
  const savedViewsReady = flow.savedViewsLoaded && !flow.savedViewsLoading && !flow.savedViewsError;
  const sameNameView = savedViewsReady ? flow.savedViews.find((view) => view.name?.trim() === savedName) : undefined;
  const existingRecordFingerprint = (view?: SavedViewData) => JSON.stringify(view ? [
    view.view_id,
    view.revision,
    view.name,
    view.query,
    view.fields,
    view.scope,
    view.sort,
    view.output_names,
    view.required_capabilities,
    view.when_missing,
  ] : []);
  const currentRecordFingerprint = existingRecordFingerprint(sameNameView);
  const pendingView = pendingUpdate
    && pendingUpdate.fingerprint === currentFingerprint
    && pendingUpdate.viewID === sameNameView?.view_id
    && pendingUpdate.revision === sameNameView?.revision
    && pendingUpdate.recordFingerprint === currentRecordFingerprint
    ? sameNameView
    : undefined;
  const canSavePayload = Boolean(savedQuery || hasSupportedConditions)
    && draftUnsupported.length === 0
    && savedViewsReady;
  const canSave = canSavePayload && Boolean(savedName);
  const blocked = draftUnsupported.length > 0;
  const callbackIdentity = JSON.stringify([workspaceID, savedName, savedQuery, savedFields, draftUnsupported, sourceView?.view_id, sourceView?.revision, sourceMode]);
  callbackIdentityRef.current = callbackIdentity;

  useEffect(() => {
    if (pendingUpdate && !pendingView) {
      setPendingUpdate(undefined);
      setFocusUpdateConfirmation(false);
    }
  }, [pendingUpdate, pendingView]);
  useEffect(() => {
    setSourceView(undefined);
    setSourceMode("update");
    setDraftQuery("");
    setDraftFieldLines("");
    setPendingUpdate(undefined);
    setFocusSourceQuery(false);
    setFocusUpdateConfirmation(false);
    setName(initialName);
    updateTriggerRef.current = null;
  }, [workspaceID]);
  useEffect(() => {
    const request = updateRequest;
    if (!request || handledUpdateTokenRef.current === request.token) return;
    handledUpdateTokenRef.current = request.token;
    const targetName = request.view.name?.trim() ?? "";
    if (!targetName || !request.view.view_id || !Number.isFinite(request.view.revision)) return;
    setSourceView(undefined);
    updateTriggerRef.current = request.trigger ?? null;
    setName(targetName);
    setPendingUpdate({
      viewID: request.view.view_id,
      revision: request.view.revision ?? 0,
      fingerprint: updateFingerprint(targetName),
      recordFingerprint: existingRecordFingerprint(request.view),
    });
    setFocusUpdateConfirmation(true);
  }, [updateRequest?.token]);
  useEffect(() => {
    const request = sourceRequest;
    if (!request || handledSourceTokenRef.current === request.token) return;
    handledSourceTokenRef.current = request.token;
    setSourceView(request.view);
    setSourceMode("update");
    setName(request.view.name?.trim() ?? "");
    setDraftQuery(request.view.query ?? "");
    setDraftFieldLines((request.view.fields ?? []).join("\n"));
    setPendingUpdate(undefined);
    setFocusUpdateConfirmation(false);
    setFocusSourceQuery(true);
    updateTriggerRef.current = request.trigger ?? null;
  }, [sourceRequest?.token]);
  useEffect(() => {
    if (!focusSourceQuery || !sourceView) return;
    sourceQueryRef.current?.focus();
    setFocusSourceQuery(false);
  }, [focusSourceQuery, sourceView]);
  useEffect(() => {
    if (!focusUpdateConfirmation || !pendingView) return;
    const confirmation = updateConfirmationRef.current;
    if (confirmation) {
      confirmation.scrollIntoView({ behavior: "smooth", block: "center" });
      confirmation.focus({ preventScroll: true });
    }
    setFocusUpdateConfirmation(false);
  }, [focusUpdateConfirmation, pendingView]);

  const getConditionRows = (sourceFields: string[] = []) => projectSavedRetrievalConditions(sourceFields, t);
  const conditionRows = getConditionRows(savedFields);
  const existingUpdateRows = getConditionRows(pendingView?.fields ?? []);
  const proposedUpdateRows = getConditionRows(savedFields);
  const scopeFor = (scope?: string) => {
    const storedScope = scope?.trim() ?? "";
    if (!storedScope) return t("Scope not recorded");
    return storedScope === workspaceID ? t("This library") : t("Other content");
  };

  const handleSaveClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (!canSave || flow.savedRetrievalSaving) return;
    if (sameNameView) {
      if (!sameNameView.view_id || !Number.isFinite(sameNameView.revision)) return;
      updateTriggerRef.current = event.currentTarget;
      setPendingUpdate({
        viewID: sameNameView.view_id,
        revision: sameNameView.revision ?? 0,
        fingerprint: currentFingerprint,
        recordFingerprint: currentRecordFingerprint,
      });
      setFocusUpdateConfirmation(true);
      return;
    }
    void save(undefined);
  };
  const save = async (replacing?: SavedViewData, copyingFrom?: SavedViewData) => {
    if (!canSave || flow.savedRetrievalSaving) return;
    const identityAtStart = callbackIdentityRef.current;
    try {
      const saved = await flow.saveSavedRetrievalView(savedName, savedQuery, savedFields, draftUnsupported, replacing, copyingFrom);
      if (!saved || !mountedRef.current || callbackIdentityRef.current !== identityAtStart) return;
      onSavedRef.current?.(saved);
      if (sourceView) {
        setSourceView(undefined);
        setPendingUpdate(undefined);
        setName(initialName);
      }
    } catch {
      // The shared save hook owns and surfaces the actionable failure state.
    }
  };
  const confirmUpdate = () => {
    if (!canSave || flow.savedRetrievalSaving || !pendingView?.view_id) return;
    void save(pendingView);
    setPendingUpdate(undefined);
  };
  const saveCopy = () => {
    if (!sourceView || sourceMode !== "copy" || !canSave || flow.savedRetrievalSaving || sameNameView) return;
    void save(undefined, sourceView);
  };
  const stopEditingSource = () => {
    setSourceView(undefined);
    setPendingUpdate(undefined);
    setFocusUpdateConfirmation(false);
    setName(initialName);
    const trigger = updateTriggerRef.current;
    window.requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus(); });
  };
  const cancelUpdate = () => {
    setPendingUpdate(undefined);
    setFocusUpdateConfirmation(false);
    const trigger = updateTriggerRef.current;
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

  return <div className="saved-retrieval-editor">
    {sourceView && <section className="saved-retrieval-source-editor" aria-label={t("Edit or copy saved retrieval")}>
      <div className="saved-retrieval-source-heading"><strong>{t("Edit or copy {{name}}", { name: sourceView.name ?? t("Unnamed saved view") })}</strong><button type="button" className="text-button" onClick={stopEditingSource} disabled={flow.savedRetrievalSaving}>{t("Stop editing")}</button></div>
      <label>{t("Saved keyword query")}<textarea ref={sourceQueryRef} value={draftQuery} onChange={(event) => { setPendingUpdate(undefined); setDraftQuery(event.target.value); }} rows={2} disabled={flow.savedRetrievalSaving || busy} /></label>
      <details className="saved-retrieval-source-advanced">
        <summary>{t("Advanced saved fields")}</summary>
        <label>{t("Saved structured conditions")}<textarea aria-describedby="saved-retrieval-fields-help" value={draftFieldLines} onChange={(event) => { setPendingUpdate(undefined); setDraftFieldLines(event.target.value); }} rows={Math.max(2, Math.min(7, (sourceView.fields?.length ?? 0) + 1))} disabled={flow.savedRetrievalSaving || busy} /></label>
        <small id="saved-retrieval-fields-help">{t("One supported key=value condition per line. Exact TAG values use the stored JSON string form.")}</small>
      </details>
      <label className="saved-retrieval-name-mode"><input type="radio" checked={sourceMode === "update"} onChange={() => { setSourceMode("update"); setName(sourceView.name ?? ""); setPendingUpdate(undefined); }} disabled={flow.savedRetrievalSaving || busy} />{t("Update the existing name")}</label>
      <label className="saved-retrieval-name-mode"><input type="radio" checked={sourceMode === "copy"} onChange={() => { setSourceMode("copy"); setName(""); setPendingUpdate(undefined); }} disabled={flow.savedRetrievalSaving || busy} />{t("Save a copy with a new name")}</label>
      <label>{t("Name this retrieval")}<input value={name} onChange={(event) => { setPendingUpdate(undefined); setName(event.target.value); }} disabled={flow.savedRetrievalSaving || busy || sourceMode === "update"} /></label>
      {sourceMode === "update" && <button type="button" className="secondary-button compact" onClick={handleSaveClick} disabled={!canSave || flow.savedRetrievalSaving || busy || !sameNameView || sameNameView.view_id !== sourceView.view_id}>{flow.savedRetrievalSaving ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}{t("Review same-name update")}</button>}
      {sourceMode === "copy" && <button type="button" className="secondary-button compact" onClick={saveCopy} disabled={!canSave || flow.savedRetrievalSaving || busy || Boolean(sameNameView)}>{flow.savedRetrievalSaving ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}{t("Save copy as a new view")}</button>}
      {sourceMode === "copy" && sameNameView && <p role="alert" className="saved-retrieval-error">{t("A saved view already uses this name. Choose a different name.")}</p>}
      {!draftValid && <p role="alert" className="saved-retrieval-error">{t("Edit only supported query conditions, one saved field per line.")}</p>}
      <small>{t("Stored scope: {{scope}}.", { scope: scopeFor(sourceView.scope) })}</small>
      <small>{t("The stored content scope and supported export policies are kept from the current saved record.")}</small>
    </section>}
    {!sourceView && <p className="saved-retrieval-copy">{t("Save a named keyword query or supported filters. Matching content can change as your library changes.")}</p>}
    <div className="saved-retrieval-save">
      <div className="saved-retrieval-preview" aria-label={t("Saved query preview")}>
        <div><strong>{t("Saved query")}</strong><code>{savedQuery || (hasSupportedConditions ? t("Filters only — no keyword text") : t("No keyword search submitted yet"))}</code><small>{sourceView ? t("This preview shows the edited draft before saving.") : t("This preview shows the submitted search, not text still being edited.")}</small></div>
        <div><strong>{t("Saved filters")}</strong>{conditionRows.length ? <><ul>{conditionRows.map((row, index) => <li key={`${savedFields[index]}-${index}`}>{row.raw ? <><code>{row.raw}</code>{row.unlabelled && <small className="saved-retrieval-unlabelled">{t("Stored condition this build cannot label")}</small>}</> : <><span>{row.label}</span><code>{row.value}</code></>}</li>)}</ul>{hasSavedRetrievalTagFields(savedFields) && <small>{t("All listed tags must match (AND).")}</small>}</> : <small>{t("No additional supported filters")}</small>}</div>
      </div>
      {!sourceView && <details className="saved-retrieval-explainer"><summary>{t("About saved searches")}</summary><p>{t("Opening a saved search reruns its keyword query or supported filters against current content. Semantic matches are not saved as a frozen result set.")}</p></details>}
      {!sourceView && <label>{t("Name this retrieval")}
        <div className="saved-retrieval-form">
          <input aria-label={t("Name this retrieval")} value={name} onChange={(event) => { setPendingUpdate(undefined); setName(event.target.value); }} placeholder={t("My saved search")} disabled={flow.savedRetrievalSaving || busy} />
          <button type="button" className="secondary-button compact" onClick={handleSaveClick} disabled={!canSave || flow.savedRetrievalSaving || busy || Boolean(sameNameView && (!sameNameView.view_id || !Number.isFinite(sameNameView.revision)))}>
            {flow.savedRetrievalSaving ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}{t(sameNameView ? "Review same-name update" : "Save view")}
          </button>
        </div>
      </label>}
      {!sourceView && !savedViewsReady && <small role={flow.savedViewsError ? "alert" : "status"}>{flow.savedViewsLoading ? t("Loading saved views before saving...") : <>{t("Refresh saved views before saving, so an existing name is not overwritten unknowingly.")} <button type="button" className="text-button" onClick={() => void flow.loadSavedViews()} disabled={flow.savedViewsLoading}><RefreshCw size={13} />{t("Refresh")}</button></>}</small>}
      {!sourceView && !savedQuery.trim() && <small>{hasSupportedConditions ? t("This saved view will use only its supported structured filters.") : t("Run a keyword search before saving a retrieval.")}</small>}
      {!sourceView && blocked && <p className="saved-retrieval-block" role="alert"><AlertCircle size={14} />{t("This view cannot save the active conditions yet: {{conditions}}", { conditions: candidate.unsupportedConditions.join(", ") })}</p>}
      {sameNameView && (!sameNameView.view_id || !Number.isFinite(sameNameView.revision)) && <p className="saved-retrieval-error" role="alert">{t("This matching saved view has no stable identity or revision. Refresh the list before saving.")}</p>}
      {pendingView && <section ref={updateConfirmationRef} tabIndex={-1} className="saved-retrieval-update-confirmation" aria-label={t("Confirm saved view update")}>
        <p>{t("A saved view with this exact name already exists. Confirming creates its next revision; cancel makes no change.")}</p>
        <div className="saved-retrieval-update-columns">
          <div><strong>{t("Existing saved view · revision {{revision}}", { revision: pendingView.revision ?? 0 })}</strong>
            <span>{t("Submitted query")}</span><code>{pendingView.query?.trim() || (pendingView.fields?.length ? t("Filters only — no keyword text") : t("No saved query text"))}</code>
            <span>{t("Saved conditions")}</span>
            {pendingView.fields?.length ? (
              <>
                {hasSavedRetrievalTagFields(pendingView.fields) && <small>{t("All listed tags must match (AND).")}</small>}
                <ul>
                  {existingUpdateRows.map((row, index) => (
                    <li key={`${pendingView.fields?.[index]}-${index}`}>
                      {row.raw ? (
                        <>
                          <code>{row.raw}</code>
                          {row.unlabelled && (
                            <small className="saved-retrieval-unlabelled">
                              {t("Stored condition this build cannot label")}
                            </small>
                          )}
                        </>
                      ) : (
                        <>
                          <span>{row.label}</span>
                          <code>{row.value}</code>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : <small>{t("No additional supported filters")}</small>}
            <span>{t("Content scope")}</span><code>{scopeFor(pendingView.scope)}</code>
          </div>
          <div><strong>{t("Proposed next revision")}</strong>
            <span>{t("Submitted query")}</span><code>{savedQuery || (savedFields.length ? t("Filters only — no keyword text") : t("No saved query text"))}</code>
            <span>{t("Saved conditions")}</span>
            {savedFields.length ? (
              <>
                {hasSavedRetrievalTagFields(savedFields) && <small>{t("All listed tags must match (AND).")}</small>}
                <ul>
                  {proposedUpdateRows.map((row, index) => (
                    <li key={`${savedFields[index]}-${index}`}>
                      {row.raw ? (
                        <>
                          <code>{row.raw}</code>
                          {row.unlabelled && (
                            <small className="saved-retrieval-unlabelled">
                              {t("Stored condition this build cannot label")}
                            </small>
                          )}
                        </>
                      ) : (
                        <>
                          <span>{row.label}</span>
                          <code>{row.value}</code>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : <small>{t("No additional supported filters")}</small>}
            <span>{t("Content scope")}</span><code>{t("This library")}</code>
          </div>
        </div>
        <small>{t("Other saved view settings will be kept.")}</small>
        <div className="saved-retrieval-update-actions">
          <button type="button" className="secondary-button compact" onClick={confirmUpdate} disabled={!canSave || flow.savedRetrievalSaving || busy}>{flow.savedRetrievalSaving ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}{t("Update this saved view")}</button>
          <button type="button" className="text-button" onClick={cancelUpdate} disabled={flow.savedRetrievalSaving || busy}>{t("Cancel")}</button>
        </div>
      </section>}
      {flow.savedRetrievalMessage && <p className={`saved-retrieval-message ${flow.savedRetrievalError ? "error" : ""}`} role={flow.savedRetrievalError ? "alert" : "status"}>{flow.savedRetrievalMessage}</p>}
    </div>
  </div>;
}
