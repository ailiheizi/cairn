import { AlertCircle, ChevronRight, HardDrive, RefreshCw, Server, Sparkles, Check, X } from "lucide-react";
import type { Translator } from "../i18n";
import { DrawerActionBar } from "./DrawerActionBar";
import { PlanCard } from "./PlanCard";
import type { SourcesFlow } from "../app/useSources";
import type { Notice } from "../lib/types";

// The add/recheck source drawer.
//
// One column: a scrollable review body and the sticky action bar as the
// drawer's single primary action. The path field is a server path, never an
// upload or a URL, and the drawer copy keeps the recheck distinction honest.

const sourceFormID = "restoreweave-source-form";

export function SourceDrawer({ t, sources, isUnavailable, coreStorageReady, coreStorageMessage, notice, repositoryPath, onClose, onDone }: {
  t: Translator;
  sources: SourcesFlow;
  isUnavailable: boolean;
  coreStorageReady: boolean;
  coreStorageMessage: string;
  notice: Notice | undefined;
  repositoryPath: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { source, recheckSourceRef, plan, planAction, planCheckBusy, pathSuggestions, sourceBarState, sourceBarReason, sourceSaveLabel, sourcePreviewDisabled, sourceSaveDisabled, sourceSuggestionDisabled, sourceLooksRemote } = sources;
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="drawer source-drawer" role="dialog" aria-modal="true" aria-label={t(recheckSourceRef ? "Recheck source" : "Add source")}><div className="source-drawer-scroll"><div className="drawer-header"><div><p className="eyebrow">{t(recheckSourceRef ? "RECHECK SOURCE" : "NEW SOURCE")}</p><h2>{t(recheckSourceRef ? "Recheck source" : "Add source")}</h2></div><button className="icon-button" aria-label={t("Close add source")} onClick={onClose}><X size={17} /></button></div><p className="drawer-copy">{t(recheckSourceRef ? "Inspect this source again. Review the changes, then confirm to publish a new snapshot." : "Choose a server folder and preview its exact storage plan. Saving starts only after you confirm.")}</p>{isUnavailable ? <div className="drawer-inline-warning" role="alert"><AlertCircle size={15} />{t("Start the RestoreWeave service before previewing this source.")}</div> : !coreStorageReady ? <div className="drawer-inline-warning" role="alert"><AlertCircle size={15} />{coreStorageMessage}</div> : notice && <div className={`notice drawer-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.kind === "error" ? <AlertCircle size={16} /> : notice.kind === "warning" ? <Sparkles size={16} /> : <Check size={16} />}{notice.text}</div>}<div className="source-kind"><span className="source-kind-icon"><HardDrive size={19} /></span><div><strong>{t("Server folder")}</strong><small>{t("Local disk or mounted storage visible to RestoreWeave")}</small></div><em>{t("Supported now")}</em></div><div className="source-route" aria-label={t("Source storage route")}><div><span>{t("Read from")}</span><strong title={source.trim()}>{source.trim() || t("Enter a server path")}</strong><small>{t("Source files stay in place")}</small></div><ChevronRight size={17} /><div><span>{t("Store unique bytes in")}</span><strong title={repositoryPath}>{repositoryPath}</strong><small>{t("Exact whole-file deduplication")}</small></div></div><form className="stack-form" id={sourceFormID} onSubmit={sources.makePlan}><label>{t("Path on RestoreWeave host")}<input autoFocus value={source} onChange={(event) => { sources.changeSourceInput(event.target.value); }} disabled={planAction === "INSPECTING" || planAction === "PROTECTING" || planCheckBusy} placeholder={t("/data/to-add")} aria-invalid={sourceLooksRemote || undefined} /><small className="path-helper"><Server size={13} />{t("Use a local or mounted server path. This browser does not upload files or fetch URLs.")}</small>{sourceLooksRemote && <small className="source-inline-error"><AlertCircle size={13} />{t("Enter a server path, not a URL.")}</small>}</label>{pathSuggestions.length > 0 && <div className="source-suggestions" role="group" aria-label={t("Suggested source paths")}><span className="source-suggestions-label">{t("Recent and configured paths")}</span><div className="source-suggestions-list">{pathSuggestions.map((suggestion) => <button type="button" key={suggestion.key} className="source-suggestion" data-kind={suggestion.kind} title={suggestion.path} aria-label={t(suggestion.kind === "source" ? "Recheck {{path}}" : "Use recent path {{path}}", { path: suggestion.path })} disabled={sourceSuggestionDisabled} onClick={() => sources.pickSuggestedPath(suggestion)}><RefreshCw size={12} /><span>{suggestion.path}</span></button>)}</div></div>}</form><p className="planning-note">{t("Planning records the source and plan in the catalog, but does not write file bytes or publish a snapshot until you confirm.")}</p>{plan && <PlanCard plan={plan} busy={planAction === "PROTECTING"} checking={planCheckBusy} coreStorageReady={coreStorageReady} t={t} onCheck={() => void sources.checkPlanStatus()} />}</div><DrawerActionBar state={sourceBarState} reason={sourceBarReason} groupLabel={t("Source action")} previewLabel={t("Preview storage plan")} previewBusyLabel={t("Inspecting...")} previewBusy={planAction === "INSPECTING"} previewDisabled={sourcePreviewDisabled} confirmLabel={sourceSaveLabel} confirmBusyLabel={t("Saving content...")} confirmBusy={planAction === "PROTECTING"} confirmDisabled={sourceSaveDisabled} doneLabel={t("View saved content")} formID={sourceFormID} t={t} onApply={() => void sources.applyPlan()} onDone={onDone} onClose={onClose} /></aside></div>;
}
