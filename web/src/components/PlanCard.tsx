import { AlertCircle, CheckCircle2, ChevronRight, FileText, RefreshCw, ShieldCheck } from "lucide-react";
import type { Translator } from "../i18n";
import { formatBytes } from "../lib/format";

// The add-source plan's review card.
//
// The card keeps the review evidence (files, bytes, warnings, per-file
// decisions) and the one follow-up that is not a save: checking an unknown
// apply outcome. Its primary action lives in the drawer's sticky action bar.
export function PlanCard({ plan, busy, checking, coreStorageReady, t, onCheck }: { plan: any; busy: boolean; checking: boolean; coreStorageReady: boolean; t: Translator; onCheck: () => void }) {
  const blocked = plan.blocked_entries?.length ?? 0;
  const decisions = Array.isArray(plan.protection_decisions) ? plan.protection_decisions : [];
  const warnings: string[] = Array.isArray(plan.warnings) ? (plan.warnings as unknown[]).filter((warning): warning is string => typeof warning === "string" && Boolean(warning.trim())) : [];
  const applied = plan.state === "SUCCEEDED";
  const measured = applied && plan.savings_measured === true;
  const dedupReused = Math.max(0, Number(plan.local_bytes ?? 0) - Number(plan.new_bytes ?? 0));
  return <div className={`plan-card ${applied ? "applied" : ""}`}>
    <div className="plan-title"><div><p className="eyebrow">{t(applied ? "THIS SAVE" : "REVIEW STORAGE PLAN")}</p><h3>{t(plan.state || (plan.executable ? "READY" : "BLOCKED"))}</h3></div>{applied ? <CheckCircle2 size={21} /> : <ShieldCheck size={21} />}</div>
    <div className="plan-stats">
      <span><b>{plan.files ?? 0}</b>{t("files")}</span>
      <span><b>{formatBytes(plan.bytes ?? 0)}</b>{t("logical content")}</span>
      {!applied && <><span><b>{formatBytes(plan.new_bytes ?? 0)}</b>{t("unique bytes to add")}</span><span className={dedupReused > 0 ? "saving" : ""}><b>{formatBytes(dedupReused)}</b>{t("duplicate bytes expected to reuse")}</span></>}
      {applied && measured ? <>
        <span><b>{formatBytes(plan.new_bytes ?? 0)}</b>{t("unique logical bytes stored")}</span>
        <span className={dedupReused > 0 ? "saving measured" : "measured"}><b>{formatBytes(dedupReused)}</b>{t("duplicate bytes reused")}</span>
        <span className="measured"><b>{formatBytes(plan.new_physical_bytes ?? 0)}</b>{t("new payload bytes stored")}</span>
        <span className={Number(plan.compression_saved_bytes ?? 0) > 0 ? "saving measured" : "measured"}><b>{formatBytes(plan.compression_saved_bytes ?? 0)}</b>{t("compression bytes avoided")}</span>
      </> : <span><b>{t("Not measured")}</b>{t("compression / physical")}</span>}
    </div>
    <p className="plan-disclosure">{t(applied ? measured ? "Whole-file deduplication and repository bytes are measured from verified placement receipts for this save. Repository records, indexes, and model files are not included." : "This save completed, but its physical placement outcome was not measurable. No deduplication or physical saving is inferred." : "Deduplication is an exact pre-save estimate. Compression and physical savings require a verified repository measurement and are not guessed here.")}</p>
    <div className="plan-outcomes"><span>{plan.protection_mode || "STORE_EXACT"}</span>{measured && <span>{t("Measured receipt")}</span>}{blocked > 0 && <span className="warn">{t("{{count}} blocked", { count: blocked })}</span>}</div>
    {warnings.length > 0 && <div className="plan-warning" role="status"><div className="plan-warning-title"><AlertCircle size={15} /><strong>{t("Exact bytes are saved; derived processing is unavailable.")}</strong></div><ul>{warnings.map((warning: string, index: number) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}
    {decisions.length > 0 && <details className="plan-files"><summary><FileText size={15} /><span>{t("Per-file protection decisions")}</span><b>{decisions.length}</b><ChevronRight size={14} /></summary><div className="plan-file-list">{decisions.map((decision: any, index: number) => <div className="plan-file" key={`${decision.relative_path || "entry"}-${index}`}><div className="plan-file-heading"><strong title={decision.relative_path}>{decision.relative_path || t("Unnamed entry")}</strong><span className="plan-file-mode">{decision.mode || "STORE_EXACT"}</span></div><div className="plan-file-meta"><span>{t("Outcome")}: {decision.planned_outcome || t("Not reported")}</span><span>{t("Reason")}: {decision.reason_code || t("Not reported")}</span></div>{decision.expected_content_id && <small className="mono">{t("Content identity")}: {decision.expected_content_id} · {formatBytes(Number(decision.expected_logical_bytes ?? 0))}</small>}</div>)}</div></details>}
    {blocked > 0 && <details className="plan-files blocked-files"><summary><AlertCircle size={15} /><span>{t("Blocked entries")}</span><b>{blocked}</b><ChevronRight size={14} /></summary><div className="plan-file-list">{plan.blocked_entries.map((entry: any, index: number) => <div className="plan-file" key={`${entry.relative_path || "entry"}-${index}`}><div className="plan-file-heading"><strong title={entry.relative_path}>{entry.relative_path || t("Unnamed entry")}</strong><span className="plan-file-mode">{entry.mode || t("Not reported")}</span></div><div className="plan-file-meta"><span>{t("Outcome")}: {entry.planned_outcome || t("Not reported")}</span><span>{t("State")}: {entry.state || t("Not reported")}</span></div><small>{entry.reason_code || t("Not reported")}{entry.message ? ` · ${entry.message}` : ""}</small></div>)}</div></details>}
    {/* The primary action lives in the drawer's sticky action bar so it is
        always visible. The card keeps the review evidence and the one
        follow-up that is not a save: checking an unknown apply outcome. */}
    {plan.awaiting_confirmation ? <><p className="muted">{t("Protection result is awaiting confirmation; no second save will be started.")}</p><button className="secondary-button" onClick={onCheck} disabled={checking || !coreStorageReady}><RefreshCw size={14} className={checking ? "spin" : ""} />{t(checking ? "Checking protection result..." : "Check protection result")}</button></> : null}
  </div>;
}
