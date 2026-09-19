import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { command } from "../app/command";
import type { Result } from "../app/command";
import { operations } from "../lib/operations";
import { formatBytes, lastFullBytesVerification, recordedAgeMinutes, verificationAgeLabel, verificationIsStale } from "../lib/format";
import type { Translator } from "../i18n";
import type { SnapshotSummary, SnapshotVerificationData } from "../lib/types";

// The verification report drawer.
//
// Tier-1 spec §1 places the integrity/verification report here: a right-side
// drawer opened from the trusted status panel (and its rail summary), not a
// settings category and not a view mode. It renders the read-only verification
// record over `snapshot.list` (restore points, protection mix, the newest
// verification receipt) and the on-demand `snapshot.verify` / `doctor.check`
// runs, plus `representation.list` for per-subject missing/mismatched
// placements.
//
// The truth rules this file enforces:
//
//   - A receipt that does not exist renders `Last verification: UNKNOWN —
//     {the daemon's reason}`; never a time and never a pass.
//   - A session result is labelled "in this browser session", and if the
//     daemon did not record a new receipt for the run, the drawer says so
//     instead of letting the session result stand in for a record.
//   - A thrown run (mismatch, unavailability, cancellation, interruption) is
//     classified from the daemon's own receipt, not from the browser's hope:
//     no new receipt means outcome UNKNOWN.
//   - A full-bytes run names its cost and needs an explicit confirmation.
//   - Running shows an elapsed clock and never an invented percentage.
//   - Catalog-wide placement counts do not exist in this build, so that row is
//     UNKNOWN with the missing capability named; a client-side count is only
//     ever labelled "over N loaded subjects".
//
// The drawer writes nothing durable: its only state is the current session's
// run results, keyed by `(snapshot_ref, mode)`, and it re-reads
// `snapshot.list` so the daemon's receipt decides what the record says.

type VerifyMode = "authenticated-metadata" | "sampled-content" | "full-bytes" | "restore-drill";

const VERIFY_MODES: VerifyMode[] = ["authenticated-metadata", "sampled-content", "full-bytes", "restore-drill"];

// The coverage description each mode must carry. `full-bytes` is the expensive
// read and requires a confirmation; `restore-drill` writes to a destination.
const MODE_COVERAGE: Record<VerifyMode, string> = {
  "authenticated-metadata": "authenticated-metadata: the manifest metadata is authenticated; repository bytes are not read.",
  "sampled-content": "sampled-content: a deterministic sample of repository bytes is read.",
  "full-bytes": "full-bytes: every repository byte is read; this is the expensive full check.",
  "restore-drill": "restore-drill: the members are restored to a destination and restore_verified is set; it writes the restored files.",
};

const MODE_RUN_COST: Record<VerifyMode, string> = {
  "authenticated-metadata": "metadata only; repository bytes are not read",
  "sampled-content": "reads a deterministic sample of repository bytes",
  "full-bytes": "reads repository bytes",
  "restore-drill": "restores the members to the destination",
};

type ReadState = "LOADING" | "READY" | "ERROR";
type SessionOutcome = "PASSED" | "FAILED" | "UNAVAILABLE" | "UNKNOWN";

type SessionRun = {
  mode: string;
  phase: "RUNNING" | "DONE";
  startedAt: number;
  finishedAt?: number;
  outcome?: SessionOutcome;
  attemptedFiles?: number;
  attemptedBytes?: number;
  passedFiles?: number;
  passedBytes?: number;
  ok?: boolean;
  restoreVerified?: boolean;
  message?: string;
  envelopeStatus?: string;
  /** Whether `snapshot.list` reported a receipt this run had not seen before. */
  receiptAppeared?: boolean;
};

type RepresentationRow = {
  representation_id?: string;
  class?: string;
  fidelity?: string;
  placement?: string;
  verified?: boolean;
  access_mode?: string;
  ownership_mode?: string;
  decoded_length?: number;
};

type DoctorCheck = { id?: string; scope?: string; ok?: boolean; message?: string };
type DoctorRead = { ok: boolean; checks: DoctorCheck[]; readAt: number };

export type VerificationDrawerProps = {
  t: Translator;
  /** The newest restore point the shell resolved from `snapshot.list`. */
  snapshotRef: string;
  isConnected: boolean;
  coreStorageReady: boolean;
  busy: boolean;
  workspaceID: string;
  /**
   * The subject the operator is inspecting. The shell's mount does not pass it
   * in this build, so per-subject placement reads stay UNKNOWN and say why.
   * When the shell attaches one, `representation.list` runs for that subject
   * and the placement section reports it without any other change.
   */
  subjectRef?: string;
  /** Re-reads the shell's status projection; call it after a verify run. */
  onRefresh: () => void;
  onClose: () => void;
};

function messageOf(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason ?? "");
}

function runKey(snapshotRef: string, mode: string) {
  return `${snapshotRef}\u0000${mode}`;
}

function isRecorded(receipt: SnapshotVerificationData | undefined): receipt is SnapshotVerificationData {
  return receipt?.state === "RECORDED";
}

// A receipt is identified by what the daemon recorded, not by the browser's
// clock: a new run must change the verified time, the mode, or the counts.
function receiptFingerprint(receipt: SnapshotVerificationData | undefined) {
  if (!isRecorded(receipt)) return "";
  return [
    receipt.verified_at ?? "",
    receipt.mode ?? "",
    receipt.outcome ?? "",
    receipt.attempted_files ?? 0,
    receipt.passed_files ?? 0,
    receipt.request_id ?? "",
  ].join("|");
}

function daemonDateTime(value: string | undefined, t: Translator) {
  if (!value) return t("Not reported");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function clockLabel(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function elapsedLabel(value: number) {
  const seconds = Math.max(0, Math.floor(value / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function boolLabel(t: Translator, value: boolean | undefined) {
  return value === true ? t("yes") : value === false ? t("no") : t("Not reported");
}

// A receipt may name a coverage level this drawer does not offer (a reader-
// side or future mode). The cost line then falls back to the neutral one
// instead of rendering an empty string.
function runCost(mode: string) {
  return MODE_RUN_COST[mode as VerifyMode] ?? "reads repository bytes";
}

// The one receipt line per restore point. An absent receipt keeps the daemon's
// reason in the same element as the UNKNOWN token, so no caller can read a
// state without its reason and no time is ever invented. A recorded receipt
// also states its age, computed from the daemon's own recorded `verified_at`
// and nothing else: a pass reads "verified ...", a failure or unavailability
// reads when it was "recorded", and a time the browser cannot parse adds no
// age rather than an invented one. The age is a statement about the record,
// never a health claim and never a pass.
function receiptLine(t: Translator, receipt: SnapshotVerificationData | undefined) {
  const unrecordedReason = receipt?.reason || t("this service reports no verification receipt and no reason");
  if (!isRecorded(receipt)) {
    return t("Last verification: UNKNOWN — {{reason}}", { reason: unrecordedReason });
  }
  const mode = receipt.mode || t("mode not reported");
  const recorded = daemonDateTime(receipt.verified_at, t);
  const request = receipt.request_id || t("Not reported");
  const passed = receipt.outcome === "SUCCEEDED" || receipt.ok === true;
  const age = verificationAgeLabel(t, recordedAgeMinutes(receipt.verified_at), passed ? "verified" : "recorded");
  const withAge = (line: string) => age ? `${line} · ${age}` : line;
  if (receipt.outcome === "FAILED") {
    return withAge(t("Verification failed — {{reason}} · scope {{mode}} · recorded {{time}} · attempted {{attempted}} files · passed {{passed}} files · request {{request}}", {
      reason: receipt.failure_reason || t("outcome not reported"),
      mode,
      time: recorded,
      attempted: Number(receipt.attempted_files ?? 0),
      passed: Number(receipt.passed_files ?? 0),
      request,
    }));
  }
  if (receipt.outcome === "UNAVAILABLE") {
    return withAge(t("Verification coverage unavailable — {{reason}} · scope {{mode}} · recorded {{time}} · attempted {{attempted}} files · passed {{passed}} files · request {{request}}", {
      reason: receipt.failure_reason || t("outcome not reported"),
      mode,
      time: recorded,
      attempted: Number(receipt.attempted_files ?? 0),
      passed: Number(receipt.passed_files ?? 0),
      request,
    }));
  }
  return withAge(t("Last verification: {{time}} · {{mode}} · {{outcome}} · ok {{ok}} · passed {{passed}}/{{attempted}} files · {{passedBytes}}/{{attemptedBytes}} bytes · restore verified {{restore}} · request {{request}}", {
    time: recorded,
    mode,
    outcome: receipt.outcome || t("outcome not reported"),
    ok: boolLabel(t, receipt.ok),
    passed: Number(receipt.passed_files ?? 0),
    attempted: Number(receipt.attempted_files ?? 0),
    passedBytes: formatBytes(Number(receipt.passed_bytes ?? 0)),
    attemptedBytes: formatBytes(Number(receipt.attempted_bytes ?? 0)),
    restore: boolLabel(t, receipt.restore_verified),
    request,
  }));
}

export function VerificationDrawer({ t, snapshotRef, isConnected, coreStorageReady, busy, workspaceID, subjectRef, onRefresh, onClose }: VerificationDrawerProps) {
  const [readState, setReadState] = useState<ReadState>("LOADING");
  const [readError, setReadError] = useState("");
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [recordsReadAt, setRecordsReadAt] = useState(() => Date.now());
  const [mode, setMode] = useState<VerifyMode>("authenticated-metadata");
  const [destination, setDestination] = useState("");
  const [confirmFullBytes, setConfirmFullBytes] = useState(false);
  const [sessionRuns, setSessionRuns] = useState<Record<string, SessionRun>>({});
  const [now, setNow] = useState(() => Date.now());
  const [doctor, setDoctor] = useState<DoctorRead>();
  const [doctorError, setDoctorError] = useState("");
  const [doctorBusy, setDoctorBusy] = useState(false);
  const [representations, setRepresentations] = useState<RepresentationRow[]>([]);
  const [representationState, setRepresentationState] = useState<"IDLE" | "LOADING" | "READY" | "ERROR">("IDLE");
  const [representationError, setRepresentationError] = useState("");
  const readGenerationRef = useRef(0);

  async function readSnapshotList(): Promise<{ list: SnapshotSummary[]; error: string }> {
    try {
      const response = await command(operations.snapshot.list, {});
      const list = Array.isArray(response.data?.snapshots) ? (response.data.snapshots as SnapshotSummary[]) : [];
      return { list, error: "" };
    } catch (error) {
      return { list: [], error: messageOf(error) };
    }
  }

  async function refreshRecord() {
    const generation = ++readGenerationRef.current;
    setReadState((current) => (current === "READY" ? current : "LOADING"));
    const result = await readSnapshotList();
    if (readGenerationRef.current !== generation) return;
    setRecordsReadAt(Date.now());
    if (result.error) {
      // A failed read drops the projection: no stale receipt may stay readable
      // as if it were the current record.
      setSnapshots([]);
      setReadError(result.error);
      setReadState("ERROR");
      return;
    }
    setSnapshots(result.list);
    setReadError("");
    setReadState("READY");
  }

  // The drawer is the record's reader: it reads on open and re-reads whenever
  // the shell resolves a different restore point, so the receipt under the
  // report is the daemon's current one, not the one the drawer saw first.
  useEffect(() => {
    void refreshRecord();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotRef]);

  // Per-subject placement facts come from representation.list and only for the
  // subject the operator is inspecting. No subject prop means no per-subject
  // read; the section then names what is missing instead of counting zero.
  useEffect(() => {
    if (!subjectRef || !workspaceID) {
      setRepresentations([]);
      setRepresentationState("IDLE");
      setRepresentationError("");
      return;
    }
    let cancelled = false;
    setRepresentationState("LOADING");
    void (async () => {
      try {
        const response = await command(operations.representation.list, { workspace_id: workspaceID, subject_ref: subjectRef });
        if (cancelled) return;
        const rows = Array.isArray(response.data?.representations) ? (response.data.representations as RepresentationRow[]) : [];
        setRepresentations(rows);
        setRepresentationError("");
        setRepresentationState("READY");
      } catch (error) {
        if (cancelled) return;
        setRepresentations([]);
        setRepresentationError(messageOf(error));
        setRepresentationState("ERROR");
      }
    })();
    return () => { cancelled = true; };
  }, [subjectRef, workspaceID]);

  const latest = snapshots.length ? snapshots[snapshots.length - 1] : undefined;
  const targetRef = snapshotRef || latest?.snapshot_ref || "";
  const targetSummary = snapshots.find((item) => item.snapshot_ref === targetRef);
  const activeRun = targetRef ? sessionRuns[runKey(targetRef, mode)] : undefined;
  const running = activeRun?.phase === "RUNNING";
  const anyRunning = useMemo(() => Object.values(sessionRuns).some((entry) => entry.phase === "RUNNING"), [sessionRuns]);

  useEffect(() => {
    if (!anyRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [anyRunning]);

  const destinationRequired = mode === "restore-drill";
  const disabledReason = !isConnected
    ? t("the service is unreachable")
    : !coreStorageReady
      ? t("core storage is not ready")
      : busy
        ? t("another operation is running")
        : !targetRef
          ? t("no restore point is published yet, so there is nothing to verify")
          : "";
  const canRun = !disabledReason && !running && (!destinationRequired || Boolean(destination.trim()));
  const recordsAsOf = t("record read at {{time}} (this browser)", { time: clockLabel(recordsReadAt) });
  // Freshness. The age of the last full read of repository bytes comes from the
  // newest recorded passing full-bytes receipt among the restore points this
  // drawer read, and from nowhere else. No such receipt means no age line at
  // all: the UNKNOWN receipt rows already say why, and nothing is invented to
  // fill the gap. The reminder is stated only past the threshold and stays a
  // suggestion, never an alarm and never a health claim.
  const fullBytesReceipt = lastFullBytesVerification(snapshots);
  const fullBytesAge = recordedAgeMinutes(fullBytesReceipt?.verified_at);
  const fullBytesStale = verificationIsStale(fullBytesAge);
  // The receipt only reaches this line with a readable time, so the age is
  // always present; the guard keeps an unreadable time from rendering a
  // half-finished sentence instead of no line.
  const fullBytesFreshnessLine = fullBytesReceipt && fullBytesAge !== undefined
    ? t("Last full-bytes verification: {{time}} · {{age}}", { time: daemonDateTime(fullBytesReceipt.verified_at, t), age: verificationAgeLabel(t, fullBytesAge, "verified") })
    : "";

  async function runVerify(verifyMode: VerifyMode) {
    const ref = targetRef;
    if (!ref || disabledReason || running) return;
    if (verifyMode === "restore-drill" && !destination.trim()) return;
    setConfirmFullBytes(false);
    const key = runKey(ref, verifyMode);
    const before = receiptFingerprint(targetSummary?.verification);
    const startedAt = Date.now();
    setSessionRuns((current) => ({ ...current, [key]: { mode: verifyMode, phase: "RUNNING", startedAt } }));
    const input: Record<string, string> = { snapshot_ref: ref, mode: verifyMode };
    if (verifyMode === "restore-drill") input.destination = destination.trim();
    let response: Result | undefined;
    let failure = "";
    try {
      response = await command(operations.snapshot.verify, input);
    } catch (error) {
      // The envelope is FAILED (or the transport broke). The daemon's own
      // receipt, re-read below, decides whether a result was recorded at all.
      failure = messageOf(error);
    }
    const reread = await readSnapshotList();
    if (!reread.error) {
      setSnapshots(reread.list);
      setReadError("");
      setReadState("READY");
      setRecordsReadAt(Date.now());
    }
    const receipt = reread.list.find((item) => item.snapshot_ref === ref)?.verification;
    const fingerprint = receiptFingerprint(receipt);
    const appeared = fingerprint !== "" && fingerprint !== before;
    const payload = response?.data ?? {};
    let classified: Partial<SessionRun>;
    if (response) {
      const passed = payload.ok === true;
      classified = {
        outcome: passed ? "PASSED" : "FAILED",
        ok: passed,
        attemptedFiles: Number(payload.attempted_files ?? 0),
        attemptedBytes: Number(payload.attempted_bytes ?? 0),
        passedFiles: Number(payload.passed_files ?? 0),
        passedBytes: Number(payload.passed_bytes ?? 0),
        restoreVerified: payload.restore_verified === true,
        envelopeStatus: response.status,
        message: response.status === "DEGRADED" ? response.reasons?.[0]?.message ?? "" : passed ? "" : failure,
      };
    } else if (appeared && receipt?.outcome === "FAILED") {
      classified = {
        outcome: "FAILED",
        ok: false,
        message: receipt.failure_reason || failure,
        attemptedFiles: Number(receipt.attempted_files ?? 0),
        attemptedBytes: Number(receipt.attempted_bytes ?? 0),
        passedFiles: Number(receipt.passed_files ?? 0),
        passedBytes: Number(receipt.passed_bytes ?? 0),
      };
    } else if (appeared && receipt?.outcome === "UNAVAILABLE") {
      classified = {
        outcome: "UNAVAILABLE",
        ok: false,
        message: receipt.failure_reason || failure,
        attemptedFiles: Number(receipt.attempted_files ?? 0),
        attemptedBytes: Number(receipt.attempted_bytes ?? 0),
        passedFiles: Number(receipt.passed_files ?? 0),
        passedBytes: Number(receipt.passed_bytes ?? 0),
      };
    } else {
      // No payload and no new receipt: the run was cancelled, blocked, or
      // interrupted before the daemon recorded anything. UNKNOWN, never a pass.
      classified = { outcome: "UNKNOWN", ok: false, message: failure };
    }
    setSessionRuns((current) => ({
      ...current,
      [key]: { mode: verifyMode, phase: "DONE", startedAt, finishedAt: Date.now(), receiptAppeared: appeared, ...classified },
    }));
    onRefresh();
  }

  async function runDoctor() {
    setDoctorBusy(true);
    try {
      const response = await command(operations.doctor.check, {});
      const data = response.data ?? {};
      setDoctor({ ok: data.ok === true, checks: Array.isArray(data.checks) ? (data.checks as DoctorCheck[]) : [], readAt: Date.now() });
      setDoctorError("");
    } catch (error) {
      setDoctor(undefined);
      setDoctorError(t("the doctor check did not answer in this report: {{message}}", { message: messageOf(error) }));
    } finally {
      setDoctorBusy(false);
    }
  }

  // The bounded client-side placement count: it may only ever be computed over
  // the subjects this drawer actually loaded, and it is rendered with that
  // bound spelled out. A catalog-wide count does not exist in this build.
  const placement = useMemo(() => {
    const missing = representations.filter((row) => row.placement === "missing").length;
    const unverified = representations.filter((row) => row.verified === false).length;
    const present = representations.filter((row) => row.placement === "present").length;
    return { count: subjectRef ? 1 : 0, missing, unverified, present };
  }, [representations, subjectRef]);

  const sessionOutcomeLabel: Record<SessionOutcome, string> = {
    PASSED: t("Verified just now in this browser session · {{mode}} · passed {{passed}}/{{attempted}} files · {{passedBytes}}/{{attemptedBytes}} bytes", {
      mode: activeRun?.mode ?? "",
      passed: activeRun?.passedFiles ?? 0,
      attempted: activeRun?.attemptedFiles ?? 0,
      passedBytes: formatBytes(activeRun?.passedBytes ?? 0),
      attemptedBytes: formatBytes(activeRun?.attemptedBytes ?? 0),
    }),
    FAILED: t("Verification failed — {{reason}}", { reason: activeRun?.message || t("outcome not reported") }),
    UNAVAILABLE: t("The daemon reported this coverage as unavailable: the bytes this mode requires could not be read. Unavailability is not a pass."),
    UNKNOWN: t("The run ended without a recorded result — outcome UNKNOWN."),
  };

  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="drawer verification-drawer" role="dialog" aria-modal="true" aria-label={t("Verification report")}>
      <div className="verification-drawer-scroll">
        <div className="drawer-header">
          <div><p className="eyebrow">{t("INTEGRITY")}</p><h2>{t("Verification report")}</h2></div>
          <button className="icon-button" aria-label={t("Close verification report")} onClick={onClose}><X size={17} /></button>
        </div>
        <p className="drawer-copy">{t("This report states what the daemon has recorded about its restore points and runs a verification level only when you ask. It writes nothing, it never polls in the background, and anything this service did not record stays UNKNOWN.")}</p>

        <section className="verification-section" aria-label={t("Verification levels and their cost")}>
          <div className="verification-section-heading"><span>{t("Verification levels and their cost")}</span></div>
          <ul className="verification-modes">{VERIFY_MODES.map((entry) => <li key={entry}>
            <button type="button" className={`verification-mode ${mode === entry ? "active" : ""}`} aria-pressed={mode === entry} disabled={running} onClick={() => { setMode(entry); setConfirmFullBytes(false); }}>
              <span className="verification-mode-token">{entry}</span>
              <small>{t(MODE_COVERAGE[entry])}</small>
              {entry === "full-bytes" && <em>{t("expensive")}</em>}
            </button>
          </li>)}</ul>
          {destinationRequired && <label className="verification-destination">{t("Restore destination on the RestoreWeave host")}
            <input aria-label={t("Restore destination on the RestoreWeave host")} value={destination} onChange={(event) => setDestination(event.target.value)} placeholder={"/data/verify-drill"} disabled={running} />
            <small>{t("restore-drill writes the restored members to this directory; it never writes to the repository.")}</small>
          </label>}
          <div className="verification-run-controls">
            {confirmFullBytes && mode === "full-bytes"
              ? <div className="verification-confirm" role="group" aria-label={t("Full-bytes confirmation")}>
                <p><strong>{t("Full-bytes verification reads every repository byte.")}</strong> {t("It can take a long time on a large repository, and this browser shows no progress percentage. Continue only when you want the read to happen now.")}</p>
                <div className="verification-confirm-actions">
                  <button type="button" className="secondary-button compact" onClick={() => setConfirmFullBytes(false)}>{t("Cancel")}</button>
                  <button type="button" className="primary-button" onClick={() => void runVerify("full-bytes")} disabled={!canRun}>{t("Yes, read every repository byte")}</button>
                </div>
              </div>
              : <button type="button" className="primary-button verification-run-button" onClick={() => { if (mode === "full-bytes") setConfirmFullBytes(true); else void runVerify(mode); }} disabled={!canRun}>{running ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}{t("Run {{mode}} verification", { mode })}</button>}
            {disabledReason && <small className="verification-disabled-reason">{t("Verification runs are unavailable: {{reason}}", { reason: disabledReason })}</small>}
            {destinationRequired && !destination.trim() && <small className="verification-disabled-reason">{t("restore-drill requires a destination on the RestoreWeave host")}</small>}
          </div>
          {activeRun && activeRun.phase === "RUNNING" && <div className="verification-run" role="status" data-session-state="RUNNING" data-mode={activeRun.mode}>
            <p className="verification-run-line"><LoaderCircle className="spin" size={14} />{t("Running {{mode}} verification ({{cost}}) · elapsed {{elapsed}}", { mode: activeRun.mode, cost: t(runCost(activeRun.mode)), elapsed: elapsedLabel(now - activeRun.startedAt) })}</p>
            <small className="verification-run-copy">{t("No percentage is shown because this service reports no progress.")}</small>
          </div>}
          {activeRun && activeRun.phase === "DONE" && <div
            className={`verification-run verification-run-${String(activeRun.outcome).toLowerCase()}`}
            role={activeRun.outcome === "PASSED" ? "status" : "alert"}
            data-session-state={activeRun.outcome}
            data-mode={activeRun.mode}
            data-attempted-files={activeRun.attemptedFiles ?? 0}
            data-passed-files={activeRun.passedFiles ?? 0}
            data-attempted-bytes={activeRun.attemptedBytes ?? 0}
            data-passed-bytes={activeRun.passedBytes ?? 0}
            data-receipt-appeared={activeRun.receiptAppeared === true ? "true" : "false"}
          >
            <p className="verification-run-line">{activeRun.outcome === "PASSED" ? <CheckCircle2 size={15} /> : <ShieldAlert size={15} />}{sessionOutcomeLabel[activeRun.outcome ?? "UNKNOWN"]}{activeRun.outcome === "PASSED" && activeRun.restoreVerified === true ? ` · ${t("restore verified")}` : ""}</p>
            {activeRun.outcome === "FAILED" && <small className="verification-run-copy">{t("This failure belongs to the {{mode}} scope.", { mode: activeRun.mode })}</small>}
            {activeRun.outcome === "UNKNOWN" && activeRun.message && <small className="verification-run-copy">{t("Reason: {{reason}}", { reason: activeRun.message })}</small>}
            {activeRun.outcome === "UNKNOWN" && activeRun.receiptAppeared === true && <small className="verification-run-copy">{t("The daemon recorded a receipt for this run; the restore-point receipt above is the record.")}</small>}
            {activeRun.receiptAppeared !== true && <small className="verification-run-copy">{t("This service recorded no receipt for this run, so this result is only a fact about this browser session. No time and no pass can be claimed for it, and any receipt row above keeps an earlier recorded receipt.")}</small>}
          </div>}
        </section>

        <section className="verification-section" aria-label={t("Restore points")}>
          <div className="verification-section-heading">
            <span>{t("Restore points")}</span>
            <button type="button" className="text-button verification-reload" onClick={() => void refreshRecord()} disabled={readState === "LOADING" || running}><RefreshCw className={readState === "LOADING" ? "spin" : ""} size={13} />{t("Refresh")}</button>
          </div>
          <small className="verification-section-copy">{t("Read from snapshot.list: the freeze facts and the newest verification receipt the catalog records for each restore point. A receipt that does not exist is UNKNOWN with the daemon's reason; it is never a time and never a pass.")}{readState === "READY" ? ` · ${recordsAsOf}` : ""}</small>
          {fullBytesFreshnessLine && <p className="verification-freshness" data-full-bytes-age-minutes={fullBytesAge}>{fullBytesFreshnessLine}</p>}
          {fullBytesStale && <p className="verification-freshness" data-full-bytes-stale="true">{t("The last full-bytes verification is more than 30 days old. Consider running it again when convenient.")}</p>}
          {readState === "LOADING" && <p className="muted" role="status">{t("Reading verification record…")}</p>}
          {readState === "ERROR" && <p className="verification-error" role="alert"><AlertCircle size={13} />{t("Reading the verification record failed: {{message}}", { message: readError })}</p>}
          {readState === "READY" && snapshots.length === 0 && <p className="muted">{t("No restore point is published yet, so there is no verification record to report.")}</p>}
          {readState === "READY" && snapshots.length > 0 && <ul className="verification-points">{snapshots.map((summary) => {
            const receipt = summary.verification;
            const outcomes = Object.entries(summary.protection_outcomes ?? {}).map(([key, count]) => `${key} ${count}`).join(" · ");
            return <li className="verification-point" key={summary.snapshot_ref} data-snapshot-ref={summary.snapshot_ref} data-newest={summary.snapshot_ref === latest?.snapshot_ref ? "true" : "false"}>
              <div className="verification-point-heading"><strong className="mono">{summary.snapshot_ref || t("Not reported")}</strong>{summary.snapshot_ref === targetRef && <span className="verification-target">{t("Newest restore point")}</span>}</div>
              <p className="verification-point-facts">
                <span>{t("Frozen {{time}}", { time: daemonDateTime(summary.created_at, t) })}</span>
                <span className="mono">{t("manifest {{digest}}", { digest: summary.manifest_digest || t("Not reported") })}</span>
                <span>{t("entries {{entries}} · files {{files}}", { entries: Number(summary.entries ?? 0), files: Number(summary.files ?? 0) })}</span>
                <span>{t("bytes {{bytes}}", { bytes: formatBytes(Number(summary.bytes ?? 0)) })}{summary.bytes_complete === false ? ` · ${t("the logical byte total is incomplete")}` : ""}</span>
                <span>{t("exact-protected {{protected}} · unprotected {{unprotected}}", { protected: Number(summary.protected_files ?? 0), unprotected: Number(summary.unprotected_files ?? 0) })}</span>
                {outcomes ? <span className="mono">{t("recorded outcomes: {{outcomes}}", { outcomes })}</span> : <span>{t("no protection mix is recorded")}</span>}
              </p>
              <p className="verification-receipt" data-receipt-state={isRecorded(receipt) ? "RECORDED" : "UNRECORDED"} data-outcome={isRecorded(receipt) ? String(receipt?.outcome ?? "") : "UNKNOWN"} data-age-minutes={isRecorded(receipt) ? recordedAgeMinutes(receipt.verified_at) ?? "" : ""}>{receiptLine(t, receipt)}</p>
            </li>;
          })}</ul>}
        </section>

        <section className="verification-section" aria-label={t("Doctor check (reads repository bytes)")}>
          <div className="verification-section-heading"><span>{t("Doctor check (reads repository bytes)")}</span></div>
          <small className="verification-section-copy">{t("The doctor check reads repository bytes and full-bytes-verifies the newest restore point when one is published. It runs only when you ask, and it records no verification receipt of its own.")}</small>
          <button type="button" className="secondary-button compact verification-doctor-run" aria-label={t("Run doctor check in the verification report")} disabled={doctorBusy || !isConnected || !coreStorageReady} onClick={() => void runDoctor()}>{doctorBusy ? <LoaderCircle className="spin" size={14} /> : <ShieldAlert size={14} />}{doctorBusy ? t("Running...") : t("Run doctor check")}</button>
          {doctorError && <p className="verification-error" role="alert"><AlertCircle size={13} />{doctorError}</p>}
          {!doctor && !doctorError && <p className="muted">{t("The byte-reading doctor check has not been run from this report in this browser session.")}</p>}
          {doctor && <div className="verification-doctor" data-doctor-ok={doctor.ok ? "true" : "false"}>
            <p className="verification-doctor-receipt" role="status">{t("Doctor check receipt: {{result}} · {{count}} checks · read at {{time}} (this browser session)", { result: doctor.ok ? t("all core checks passed") : t("one or more core checks failed"), count: doctor.checks.length, time: clockLabel(doctor.readAt) })}</p>
            <ul className="verification-doctor-checks">{doctor.checks.map((check, index) => <li key={`${check.id ?? "check"}-${index}`} data-check-id={check.id ?? ""} data-check-ok={check.ok === true ? "true" : "false"}>
              <span className="mono">{check.id || t("Not reported")}</span> · {check.scope || t("Not reported")} · {check.ok === true ? t("ok") : t("failed")} · <span>{check.message || t("Not reported")}</span>
            </li>)}</ul>
            <small className="verification-run-copy">{t("The daemon records no receipt for a doctor check; the restore-point receipt above stays unrecorded.")}</small>
          </div>}
        </section>

        <section className="verification-section" aria-label={t("Placement facts (representation.list)")}>
          <div className="verification-section-heading"><span>{t("Placement facts (representation.list)")}</span></div>
          <ul className="verification-placements">
            <li className="verification-placement-row" data-placement-scope="catalog">{t("Placement facts: UNKNOWN — {{reason}}", { reason: t("this build exposes no catalog-wide missing/mismatched/untracked placement count") })}</li>
            <li className="verification-placement-row" data-placement-scope="loaded">{subjectRef
              ? t("Placements over {{count}} loaded subjects: {{missing}} missing · {{unverified}} not verified · {{present}} present — a bounded client-side count, not a catalog-wide fact", { count: placement.count, missing: placement.missing, unverified: placement.unverified, present: placement.present })
              : t("Placement facts: UNKNOWN — {{reason}}", { reason: t("no subject is attached to this report, so no per-subject placement could be read; the drawer mount passes no subject from the shell in this build") })}</li>
          </ul>
          {representationState === "LOADING" && <p className="muted" role="status">{t("Reading placement facts…")}</p>}
          {representationState === "ERROR" && <p className="verification-error" role="alert"><AlertCircle size={13} />{t("representation.list did not answer in this browser session: {{message}}", { message: representationError })}</p>}
          {representationState === "READY" && <ul className="verification-representations">{representations.map((row, index) => <li key={row.representation_id ?? `representation-${index}`} data-placement={row.placement ?? ""} data-verified={row.verified === true ? "true" : row.verified === false ? "false" : "UNKNOWN"}>
            {t("Representation {{class}} · {{fidelity}} · placement {{placement}} · verified {{verified}}", {
              class: row.class || t("Not reported"),
              fidelity: row.fidelity || t("Not reported"),
              placement: row.placement || t("Not reported"),
              verified: row.verified === true ? t("yes") : row.verified === false ? t("no") : t("verified not reported"),
            })}
          </li>)}</ul>}
        </section>
      </div>
    </aside>
  </div>;
}
