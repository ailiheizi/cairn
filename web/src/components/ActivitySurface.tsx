import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertCircle, ChevronRight, ListTree, RefreshCw } from "lucide-react";
import { command } from "../app/command";
import { operations } from "../lib/operations";
import { formatDateTime, previewUnicodeText } from "../lib/format";
import type { Locale, Translator } from "../i18n";
import type { JobEventRecord, JobSummary, PlanRecord } from "../lib/types";

// The activity surface (Tier-1 spec §2).
//
// One rail workspace view over the durable job rows: what is queued, running,
// waiting, finished, failed, cancelled, or unresolved. The rows come from the
// daemon (`job.list`, with `status.get.recent_jobs` as the summary), the run
// log comes from `job.events`, and the only write this surface can ask for is
// the bounded `job.cancel`. Nothing is inferred: every rendered state is a
// state a daemon response actually reported, and a field the record omits is
// rendered as `UNKNOWN — not reported by this build`, never as an empty string
// and never as a green state.
//
// Ownership: this component owns its own state (the surface has no
// cross-surface fact and no shell flow reads it), the catalog partial
// `i18n/activity.ts`, and `styles/activity.css`. The shell passes the service
// projection down, exactly as it does for the status disclosure.

/** How often an expanded, non-terminal run log is polled for the next page. */
const LOG_POLL_INTERVAL_MS = 1500;
/** How many durable rows one read asks for; the daemon bounds this itself. */
const JOB_PAGE_SIZE = 50;
/** Ticks the elapsed clock of a RUNNING row. */
const RUNNING_CLOCK_INTERVAL_MS = 1000;

const TERMINAL_STATES = ["SUCCEEDED", "FAILED", "CANCELLED", "NEEDS_RECONCILIATION"];
const CANCELLABLE_STATES = ["QUEUED", "RUNNING", "WAITING_APPROVAL"];

type ListState = "IDLE" | "LOADING" | "READY" | "FAILED";
type LogState = { status: "LOADING" | "READY" | "FAILED"; events: JobEventRecord[]; nextSequence: number; terminal: boolean; jobState: string; error: string };
type PlanReadState = { status: "LOADING" | "READY" | "FAILED"; plan?: PlanRecord; error: string };

export type ActivitySurfaceProps = {
  t: Translator;
  locale: Locale;
  workspaceID: string;
  isConnected: boolean;
  /** The shell's status projection; the summary line is `status.get`'s own answer. */
  statusData: any;
  /** Escape hands focus back to the rail entry that opened this view. */
  onExitToRail: () => void;
};

function messageOf(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason ?? "");
}

export function ActivitySurface({ t, locale, workspaceID, isConnected, statusData, onExitToRail }: ActivitySurfaceProps) {
  const [rows, setRows] = useState<JobSummary[]>([]);
  const [listState, setListState] = useState<ListState>("IDLE");
  const [listError, setListError] = useState("");
  const [readAt, setReadAt] = useState(0);
  const [expandedJobID, setExpandedJobID] = useState("");
  const [logs, setLogs] = useState<Record<string, LogState>>({});
  const [planReads, setPlanReads] = useState<Record<string, PlanReadState>>({});
  const [cancellationsAsked, setCancellationsAsked] = useState<Record<string, boolean>>({});
  const [cancelBusyJobID, setCancelBusyJobID] = useState("");
  const [cancelErrors, setCancelErrors] = useState<Record<string, string>>({});
  const [rovingIndex, setRovingIndex] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const rowsRef = useRef<HTMLUListElement | null>(null);

  const rowCount = rows.length;
  const rovingRow = rowCount ? Math.min(rovingIndex, rowCount - 1) : 0;

  // The refresh control re-reads the durable rows only. It deliberately does
  // not run the shell refresh, which rebuilds the library projection and would
  // leave this workspace view.
  async function loadJobs() {
    setListState((current) => (current === "READY" ? current : "LOADING"));
    try {
      const input = workspaceID ? { workspace_id: workspaceID, limit: JOB_PAGE_SIZE } : { limit: JOB_PAGE_SIZE };
      const response = await command(operations.job.list, input);
      const jobs = Array.isArray(response.data?.jobs) ? (response.data.jobs as JobSummary[]) : [];
      setRows(jobs);
      setListState("READY");
      setListError("");
      setReadAt(Date.now());
    } catch (error) {
      // A read that did not answer is a blocked view, never an empty list that
      // could be mistaken for "no jobs".
      setRows([]);
      setListState("FAILED");
      setListError(messageOf(error));
    }
  }

  useEffect(() => {
    if (!isConnected) {
      setRows([]);
      setListState("IDLE");
      setListError("");
      setExpandedJobID("");
      return;
    }
    void loadJobs();
  }, [isConnected, workspaceID]);

  // The elapsed clock of a RUNNING row: one browser timer while such a row is
  // rendered. It only repaints the label; it never claims a percentage.
  const hasRunningRow = rows.some((row) => row.state === "RUNNING");
  useEffect(() => {
    if (!hasRunningRow) return;
    const timer = window.setInterval(() => setClock(Date.now()), RUNNING_CLOCK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasRunningRow]);

  // One expanded row at a time. The log is read page by page with
  // `after_sequence` and polling stops as soon as the daemon reports
  // `terminal`, so a finished run is never polled again.
  useEffect(() => {
    const jobID = expandedJobID;
    if (!jobID || !isConnected) return;
    const job = rows.find((row) => row.job_id === jobID);
    const rowWorkspaceID = job?.workspace_id?.trim() || workspaceID.trim();
    setLogs((current) => ({ ...current, [jobID]: { status: "LOADING", events: [], nextSequence: 0, terminal: false, jobState: "", error: "" } }));
    if (!rowWorkspaceID) {
      setLogs((current) => ({ ...current, [jobID]: { status: "FAILED", events: [], nextSequence: 0, terminal: false, jobState: "", error: t("This job row reports no workspace, so its retained log cannot be read.") } }));
      return;
    }
    let cancelled = false;
    let afterSequence = 0;
    let timer: number | undefined;
    const step = async () => {
      try {
        const response = await command(operations.job.events, { workspace_id: rowWorkspaceID, job_id: jobID, after_sequence: afterSequence, limit: 50 });
        if (cancelled) return;
        const data = response.data ?? {};
        const page = Array.isArray(data.events) ? (data.events as JobEventRecord[]) : [];
        const nextSequence = Number(data.next_sequence ?? afterSequence);
        afterSequence = Number.isFinite(nextSequence) ? nextSequence : afterSequence;
        const terminal = data.terminal === true;
        const jobState = String(data.job_state ?? "");
        setLogs((current) => {
          const previous = current[jobID];
          return { ...current, [jobID]: { status: "READY", events: [...(previous?.events ?? []), ...page], nextSequence: afterSequence, terminal, jobState, error: "" } };
        });
        // The daemon is authoritative: a state it reports here (for example a
        // RUNNING row that has since failed) replaces the listed value.
        if (jobState) setRows((current) => current.map((row) => row.job_id === jobID ? { ...row, state: jobState } : row));
        if (!terminal && !cancelled) timer = window.setTimeout(() => void step(), LOG_POLL_INTERVAL_MS);
      } catch (error) {
        if (cancelled) return;
        setLogs((current) => ({
          ...current,
          [jobID]: { status: "FAILED", events: current[jobID]?.events ?? [], nextSequence: afterSequence, terminal: false, jobState: current[jobID]?.jobState ?? "", error: messageOf(error) },
        }));
      }
    };
    void step();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [expandedJobID, isConnected, workspaceID, rowCount]);

  async function cancelJob(job: JobSummary) {
    const jobID = job.job_id?.trim() ?? "";
    const rowWorkspaceID = job.workspace_id?.trim() || workspaceID.trim();
    if (!jobID || !rowWorkspaceID) return;
    setCancelBusyJobID(jobID);
    setCancelErrors((current) => ({ ...current, [jobID]: "" }));
    try {
      const response = await command(operations.job.cancel, { workspace_id: rowWorkspaceID, job_id: jobID });
      const data = response.data ?? {};
      // The daemon decides. A cancelled QUEUED job becomes CANCELLED; a
      // RUNNING job that only accepted the request stays RUNNING and says so.
      const jobState = String(data.job_state ?? "");
      if (jobState) setRows((current) => current.map((row) => row.job_id === jobID ? { ...row, state: jobState } : row));
      const asked = data.cancellation_asked === true && data.cancelled !== true && !TERMINAL_STATES.includes(jobState);
      setCancellationsAsked((current) => ({ ...current, [jobID]: asked }));
    } catch (error) {
      setCancelErrors((current) => ({ ...current, [jobID]: messageOf(error) }));
    } finally {
      setCancelBusyJobID("");
    }
  }

  // The reconciliation read: the plan the daemon already recorded is read
  // back. This never re-runs the plan and never writes.
  async function checkProtectionResult(job: JobSummary) {
    const jobID = job.job_id?.trim() ?? "";
    const planID = job.plan_id?.trim() ?? "";
    const rowWorkspaceID = job.workspace_id?.trim() || workspaceID.trim();
    if (!planID || !rowWorkspaceID) {
      setPlanReads((current) => ({ ...current, [jobID]: { status: "FAILED", error: t("This job row reports no plan or workspace, so no recorded plan can be read.") } }));
      return;
    }
    setPlanReads((current) => ({ ...current, [jobID]: { status: "LOADING", error: "" } }));
    try {
      const response = await command(operations.plan.get, { workspace_id: rowWorkspaceID, plan_id: planID });
      setPlanReads((current) => ({ ...current, [jobID]: { status: "READY", plan: (response.data ?? {}) as PlanRecord, error: "" } }));
    } catch (error) {
      setPlanReads((current) => ({ ...current, [jobID]: { status: "FAILED", error: messageOf(error) } }));
    }
  }

  function toggleLog(job: JobSummary) {
    const jobID = job.job_id?.trim() ?? "";
    if (!jobID) return;
    setExpandedJobID((current) => (current === jobID ? "" : jobID));
  }

  // One tab stop for the whole list, with the library's roving-tabindex
  // pattern: arrow keys move focus between rows, Home/End jump, Enter (the
  // focused control's own activation) expands the run log, and Escape returns
  // focus to the rail entry.
  function handleRowsKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onExitToRail();
      return;
    }
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-activity-index]");
    if (!row) return;
    const current = Number(row.dataset.activityIndex ?? "-1");
    if (!Number.isInteger(current) || current < 0 || current >= rowCount) return;
    const last = rowCount - 1;
    const moveFocus = (next: number) => {
      setRovingIndex(next);
      rowsRef.current?.querySelector<HTMLElement>(`[data-activity-index="${next}"] .activity-row-toggle`)?.focus();
    };
    if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); moveFocus(Math.min(current + 1, last)); return; }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); moveFocus(Math.max(current - 1, 0)); return; }
    if (event.key === "Home") { event.preventDefault(); moveFocus(0); return; }
    if (event.key === "End") { event.preventDefault(); moveFocus(last); return; }
  }

  // The summary is `status.get`'s own answer, labeled with the browser read
  // time. An absent projection is stated as unknown instead of zeroed.
  const recentJobs = useMemo(() => Array.isArray(statusData?.recent_jobs) ? (statusData.recent_jobs as JobSummary[]) : [], [statusData]);
  const recentCount = typeof statusData?.jobs === "number" ? Number(statusData.jobs) : recentJobs.length;
  const summaryState = statusData ? (recentJobs[0]?.state ?? "UNKNOWN") : "UNKNOWN";
  const summaryLine = !statusData
    ? t("UNKNOWN — the service status projection has not answered in this browser yet")
    : recentJobs.length
      ? t("{{count}} durable jobs recorded · newest job: {{state}}", { count: recentCount, state: stateLine(recentJobs[0], { t, locale, now: clock, withAbsoluteTime: true }) })
      : t("no durable job is recorded in the service status projection yet");

  const blockedReason = !isConnected
    ? t("Cannot read durable jobs while the service is unreachable.")
    : listState === "FAILED"
      ? t("The durable job list could not be read: {{message}}", { message: listError })
      : "";

  return <section className="content-column activity-surface" aria-label={t("Activity")} data-view="activity" data-connection={isConnected ? "CONNECTED" : "UNAVAILABLE"} onKeyDown={handleRowsKeyDown}>
    <div className="workspace-heading">
      <div>
        <p className="eyebrow">{t("WORKSPACE")}</p>
        <h1>{t("Activity")}</h1>
      </div>
      <div className="heading-actions">
        <span className="result-count" data-summary-source="status.get">{summaryLine}</span>
        <button type="button" className="icon-button" title={t("Refresh job list")} aria-label={t("Refresh job list")} onClick={() => void loadJobs()}><RefreshCw size={15} /></button>
      </div>
    </div>
    <p className="activity-note">{t("Job rows and run logs are read from the service. This view never infers a state, and the only action it can ask for is a bounded cancellation.")}</p>
    {blockedReason
      ? <div className="activity-blocked" data-state="BLOCKED" role="alert"><AlertCircle size={16} /><div><strong>{t("Durable jobs are not readable right now")}</strong><small>{blockedReason}</small></div></div>
      : listState === "LOADING" || listState === "IDLE"
        ? <p className="activity-loading" data-state="LOADING" role="status">{t("Reading durable jobs…")}</p>
        : rows.length === 0
          ? <div className="empty-state activity-empty" data-empty="true"><span className="vault-sigil"><ListTree size={35} /></span><h2>{t("No durable job is recorded yet")}</h2><p>{t("Saving a source, restoring a snapshot, and exporting each record a durable job here, with its retained run log and its final state.")}</p></div>
          : <ul className="activity-rows" aria-label={t("Durable jobs")} aria-description={t("Use the arrow keys to move between job rows, Enter to expand the retained run log, and Escape to return to the navigation rail.")} ref={rowsRef}>
            {rows.map((row, index) => <ActivityRow
              key={row.job_id ?? index}
              index={index}
              roving={index === rovingRow}
              job={row}
              t={t}
              locale={locale}
              now={clock}
              expanded={expandedJobID === (row.job_id?.trim() ?? "")}
              log={logs[row.job_id?.trim() ?? ""]}
              planRead={planReads[row.job_id?.trim() ?? ""]}
              cancellationAsked={cancellationsAsked[row.job_id?.trim() ?? ""] === true}
              cancelBusy={cancelBusyJobID === (row.job_id?.trim() ?? "")}
              cancelError={cancelErrors[row.job_id?.trim() ?? ""] ?? ""}
              onToggle={() => toggleLog(row)}
              onCancel={() => void cancelJob(row)}
              onCheckProtectionResult={() => void checkProtectionResult(row)}
            />)}
          </ul>}
    <p className="activity-read-at" data-read-at={readAt || ""}>{readAt ? t("Job list read at {{time}} (this browser)", { time: new Date(readAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }) : t("The durable job list has not been read in this browser yet")}</p>
  </section>;
}

function ActivityRow({ index, roving, job, t, locale, now, expanded, log, planRead, cancellationAsked, cancelBusy, cancelError, onToggle, onCancel, onCheckProtectionResult }: {
  index: number;
  roving: boolean;
  job: JobSummary;
  t: Translator;
  locale: Locale;
  now: number;
  expanded: boolean;
  log: LogState | undefined;
  planRead: PlanReadState | undefined;
  cancellationAsked: boolean;
  cancelBusy: boolean;
  cancelError: string;
  onToggle: () => void;
  onCancel: () => void;
  onCheckProtectionResult: () => void;
}) {
  const state = String(job.state ?? "").trim();
  const known = KNOWN_STATES.includes(state);
  const renderedState = known ? state : "UNKNOWN";
  const jobID = job.job_id?.trim() ?? "";
  const showCancel = CANCELLABLE_STATES.includes(state) && !cancellationAsked;
  const line = stateLine(job, { t, locale, now, withAbsoluteTime: true });

  return <li className="activity-row" data-job-id={jobID} data-job-state={state} data-state={renderedState} data-kind={job.kind ?? ""} data-activity-index={index} aria-label={t("Job {{job_id}}", { job_id: jobID || t("UNKNOWN — not reported by this build") })}>
    <div className="activity-row-header">
      <button type="button" className="activity-row-toggle" tabIndex={roving ? 0 : -1} aria-expanded={expanded} aria-controls={`activity-log-${index}`} onClick={onToggle}>
        <ChevronRight className="activity-row-chevron" size={15} aria-hidden="true" />
        <span className="activity-state" data-state={renderedState}>{line}</span>
        <span className="activity-kind" title={t("Job kind reported by the service")}>{job.kind?.trim() || t("UNKNOWN — not reported by this build")}</span>
        <small className="activity-job-id" title={jobID}>{jobID || t("UNKNOWN — not reported by this build")}</small>
      </button>
      <div className="activity-row-actions">
        {state === "NEEDS_RECONCILIATION" && <button type="button" className="secondary-button compact" onClick={onCheckProtectionResult} disabled={planRead?.status === "LOADING"}>{t(planRead?.status === "LOADING" ? "Checking protection result..." : "Check protection result")}</button>}
        {showCancel && <button type="button" className="secondary-button compact activity-cancel" onClick={onCancel} disabled={cancelBusy} aria-label={t("Cancel job {{job_id}}", { job_id: jobID })}>{t(cancelBusy ? "Cancelling…" : "Cancel job")}</button>}
      </div>
    </div>
    <p className="activity-row-facts">
      <span>{t("Updated {{time}}", { time: job.updated_at ? formatDateTime(job.updated_at, locale, t) : t("UNKNOWN — not reported by this build") })}</span>
      <span>{job.max_attempts ? t("Attempt {{attempt}} of {{max}}", { attempt: job.attempt ?? t("UNKNOWN — not reported by this build"), max: job.max_attempts }) : t("Attempts: {{value}}", { value: t("UNKNOWN — not reported by this build") })}</span>
      <span>{job.checkpoint_present === true ? t("Checkpoint recorded") : t("No checkpoint recorded")}</span>
      <span>{job.plan_id ? t("Plan {{plan_id}}", { plan_id: job.plan_id }) : t("No plan is linked to this job")}</span>
    </p>
    {state === "RUNNING" && <p className="activity-running-note" data-elapsed-from={job.updated_at ?? ""}>{t("Elapsed since the daemon last updated this row at {{time}}.", { time: job.updated_at ? formatDateTime(job.updated_at, locale, t) : t("UNKNOWN — not reported by this build") })}</p>}
    {!known && <p className="activity-unknown-state" data-reported-state={state}>{t("This build does not describe the reported job state {{state}}; it is shown as UNKNOWN rather than as a healthy value.", { state: state || t("UNKNOWN — not reported by this build") })}</p>}
    {cancellationAsked && <p className="activity-cancellation" data-state="CANCELLATION_ASKED" role="status">{t("Cancellation asked — the run may still finish")}</p>}
    {cancelError && <p className="activity-cancel-error" role="alert">{t("The cancellation request did not answer: {{message}}", { message: cancelError })}</p>}
    {state === "NEEDS_RECONCILIATION" && <div className="activity-reconciliation" data-state="NEEDS_RECONCILIATION">
      <p className="activity-reconciliation-note">{t("An unknown outcome is continued by reading the plan the daemon already recorded. This row offers no rerun and no second write.")}</p>
      {planRead?.status === "READY" && planRead.plan && <div className="activity-plan-read" data-plan-state={planRead.plan.state ?? ""}>
        <span>{t("Recorded plan state: {{state}}", { state: planRead.plan.state || t("UNKNOWN — not reported by this build") })}</span>
        <span>{t("Plan digest: {{digest}}", { digest: planRead.plan.plan_digest || t("UNKNOWN — not reported by this build") })}</span>
        <span>{t("Applied: {{value}}", { value: planRead.plan.applied === true ? t("APPLIED") : planRead.plan.applied === false ? t("NOT APPLIED") : t("UNKNOWN — not reported by this build") })}</span>
      </div>}
      {planRead?.status === "FAILED" && <p className="activity-plan-error" role="alert">{t("The recorded plan could not be read: {{message}}", { message: planRead.error })}</p>}
    </div>}
    {expanded && <div className="activity-log" id={`activity-log-${index}`} data-terminal={log?.terminal === true ? "true" : "false"}>
      <p className="activity-log-heading">{t("Retained run log")}</p>
      {log?.status === "LOADING" && <p className="activity-log-loading" role="status">{t("Reading the retained run log…")}</p>}
      {log?.status === "FAILED" && <p className="activity-log-failed" role="alert">{t("The run log could not be read: {{message}}", { message: log.error })}</p>}
      {log?.status === "READY" && <>
        <p className="activity-log-state" data-state={log.jobState ? (KNOWN_STATES.includes(log.jobState) ? log.jobState : "UNKNOWN") : "UNKNOWN"}>{t("Job state in the latest daemon response: {{state}}", { state: log.jobState ? stateLineForState(log.jobState, t) : t("UNKNOWN — not reported by this build") })}</p>
        {log.events.length === 0
          ? <p className="activity-log-empty">{t("No run-log event is recorded for this job yet.")}</p>
          : <ol className="activity-log-events">{log.events.map((event, eventIndex) => <li className="activity-log-event" key={event.event_id ?? `${event.sequence ?? eventIndex}`} data-sequence={event.sequence ?? ""}>
            <span className="activity-log-sequence">#{event.sequence ?? "—"}</span>
            <span className="activity-log-time">{event.occurred_at ? formatDateTime(event.occurred_at, locale, t) : t("UNKNOWN — not reported by this build")}</span>
            <strong className="activity-log-action">{event.action?.trim() || t("UNKNOWN — not reported by this build")}</strong>
            <span className="activity-log-outcome">{event.outcome?.trim() || t("UNKNOWN — not reported by this build")}</span>
            {event.details != null && <code className="activity-log-details" title={detailsText(event.details)}>{previewUnicodeText(detailsText(event.details), 320)}</code>}
          </li>)}</ol>}
        <p className="activity-log-tail" data-next-sequence={log.nextSequence}>{log.terminal ? t("This run is terminal; no further log pages are read.") : t("Next event sequence: {{sequence}} · waiting for the daemon to report the next page", { sequence: log.nextSequence })}</p>
      </>}
    </div>}
  </li>;
}

const KNOWN_STATES = ["QUEUED", "RUNNING", "WAITING_APPROVAL", "SUCCEEDED", "FAILED", "CANCELLED", "NEEDS_RECONCILIATION"];

/** Event details are rendered as recorded; the row previews a bounded prefix. */
function detailsText(details: unknown) {
  return typeof details === "string" ? details : JSON.stringify(details);
}

function elapsedLabel(from: string | undefined, now: number, t: Translator) {
  const started = from ? new Date(from).getTime() : Number.NaN;
  if (!Number.isFinite(started)) return t("UNKNOWN — not reported by this build");
  const seconds = Math.max(0, Math.round((now - started) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours} h ${minutes % 60} min`;
  if (minutes > 0) return `${minutes} min ${seconds % 60} s`;
  return `${seconds} s`;
}

function stateLineForState(state: string, t: Translator) {
  if (state === "QUEUED") return t("Queued");
  if (state === "RUNNING") return t("Running");
  if (state === "WAITING_APPROVAL") return t("Waiting for approval");
  if (state === "SUCCEEDED") return t("Completed");
  if (state === "FAILED") return t("Failed");
  if (state === "CANCELLED") return t("Cancelled");
  if (state === "NEEDS_RECONCILIATION") return t("Unknown outcome");
  return t("UNKNOWN — not reported by this build");
}

/** One daemon job row, as one line. A missing field becomes the UNKNOWN phrase. */
function stateLine(job: JobSummary, { t, locale, now, withAbsoluteTime }: { t: Translator; locale: Locale; now: number; withAbsoluteTime: boolean }): string {
  const state = String(job.state ?? "").trim();
  const time = job.updated_at ? formatDateTime(job.updated_at, locale, t) : t("UNKNOWN — not reported by this build");
  if (state === "QUEUED") return t("Queued");
  if (state === "RUNNING") return t("Running · {{elapsed}}", { elapsed: elapsedLabel(job.updated_at, now, t) });
  if (state === "WAITING_APPROVAL") return t("Waiting for approval");
  if (state === "SUCCEEDED") return withAbsoluteTime ? t("Completed {{time}}", { time }) : t("Completed");
  if (state === "FAILED") return t("Failed — {{error}}", { error: job.error_code?.trim() || t("UNKNOWN — not reported by this build") });
  if (state === "CANCELLED") return t("Cancelled — published snapshots were not rolled back");
  if (state === "NEEDS_RECONCILIATION") return t("Unknown outcome — needs reconciliation");
  return t("UNKNOWN — not reported by this build");
}
