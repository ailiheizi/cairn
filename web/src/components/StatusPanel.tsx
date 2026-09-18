import { useEffect, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { command } from "../app/command";
import { operations } from "../lib/operations";
import { formatBytes } from "../lib/format";
import type { Translator } from "../i18n";
import type { ExportManifestData, SnapshotSummary } from "../lib/types";

// The trusted status surface.
//
// One rail disclosure replaces the old readiness dots and the health strip. It
// never renders a dot, a check, or a colour as a health claim: every row is a
// string that starts with exactly one of
//
//   PROVEN · {value} · {as-of}      a fact this browser read from the daemon
//   UNKNOWN — {reason}              no source exists, or it did not answer
//   DEGRADED — {reason}             the fact is readable but qualified
//   FAILED — {reason}               the daemon reported the fact as failed
//
// The summary names the weakest fact among the protection and recovery facts
// only (service, repository, writability, catalog, schema, verification,
// protection mix). A degraded or unavailable discovery fact (the lexical and
// semantic index projections) and a fact that only says this build has no such
// operation never drive the headline; they are reported honestly in their own
// groups instead. The body is grouped so the headline's facts, the discovery
// facts, and the not-sourced facts are not one flat list; the protection group
// is the one open by default.
//
// Sources: `status.get` (repository path/profile/ok/capacity, the zero-byte
// writability probe, catalog path/ok, the schema ledger, per-workspace index
// projections, publication/job counts and recent jobs), `capability.list`
// (passed down from the shell), and the read-only `snapshot.list`,
// `export.list`, and `doctor.check` operations. The panel owns no durable
// state and writes nothing: it is a report, never a control over stored
// content. `doctor.check` reads repository bytes, so it runs only when the
// operator asks for it.

type FactState = "PROVEN" | "UNKNOWN" | "DEGRADED" | "FAILED";
type FactGroup = "protection" | "discovery" | "not-sourced";
type HealthFact = { id: string; state: FactState; name: string; provenName?: string; line: string; group: FactGroup };
type FactValue = [FactState, string];

type DoctorResult = { ok: boolean; checks: { id: string; ok: boolean; message: string }[]; readAt: number };
type StatusReads = {
  snapshots: SnapshotSummary[];
  exports: ExportManifestData[];
  snapshotError: string;
  exportError: string;
  doctor?: DoctorResult;
  doctorError: string;
  readAt: number;
};

export type StatusPanelProps = {
  t: Translator;
  status: string;
  statusData: any;
  capabilities: any[];
  onRefresh: () => void;
  onOpenVerification: (trigger?: EventTarget | null) => void;
  /** Wired by the activity surface; absent until that view exists. */
  onOpenActivity?: () => void;
};

const RANK: Record<FactState, number> = { FAILED: 0, DEGRADED: 1, UNKNOWN: 2, PROVEN: 3 };
const SEMANTIC_DIMENSION = "semantic-embedding";
// The image dimension composes its artifact state and its generation state into
// one capability state, and OCR is a processor capability rather than an index,
// so both are read from capability.list directly instead of the per-workspace
// index projection the lexical and semantic rows use.
const MULTIMODAL_DIMENSION = "multimodal-clip";
const OCR_CAPABILITY = "ocr.image.text.v1";
const LEXICAL_DIMENSION = "lexical-metadata-fts";

// The headline's own set. These are the protection and recovery facts whose
// state can regress; the optional capacity report, the record-presence rows
// (last freeze, last materialize), and the durable-job row stay in the
// protection group but never become the headline, because an absent optional
// measurement must not read as a protection failure.
const SUMMARY_FACT_IDS = new Set(["service", "repository", "writability", "catalog", "schema", "verification", "protection"]);

const FACT_GROUPS: { id: FactGroup; label: string; open: boolean }[] = [
  { id: "protection", label: "Protection and recovery", open: true },
  { id: "discovery", label: "Discovery", open: false },
  { id: "not-sourced", label: "Not sourced by this build", open: false },
];

function clockLabel(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function daemonDateTime(value: string | undefined, t: Translator) {
  if (!value) return t("Not reported");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function StatusPanel({ t, status, statusData, capabilities, onRefresh, onOpenVerification, onOpenActivity }: StatusPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => Object.fromEntries(FACT_GROUPS.map((group) => [group.id, group.open])));
  const [reads, setReads] = useState<StatusReads>({ snapshots: [], exports: [], snapshotError: "", exportError: "", doctorError: "", readAt: Date.now() });
  const [doctorBusy, setDoctorBusy] = useState(false);

  // Every shell refresh produces a new status projection and re-reads the
  // snapshot and export projections that go with it. When the service stops
  // answering, the previous reads are dropped so no stale value can be
  // rendered as a live fact.
  useEffect(() => {
    let cancelled = false;
    if (!statusData) {
      setReads((current) => ({ snapshots: [], exports: [], snapshotError: "", exportError: "", doctor: undefined, doctorError: "", readAt: Date.now() }));
      return () => { cancelled = true; };
    }
    void (async () => {
      const [snapshotResult, exportResult] = await Promise.allSettled([command(operations.snapshot.list, {}), command(operations.export.list, {})]);
      if (cancelled) return;
      const snapshots = snapshotResult.status === "fulfilled" ? ((snapshotResult.value.data?.snapshots ?? []) as SnapshotSummary[]) : [];
      const exports = exportResult.status === "fulfilled" && Array.isArray(exportResult.value.data) ? (exportResult.value.data as ExportManifestData[]) : [];
      setReads((current) => ({
        snapshots,
        exports,
        snapshotError: snapshotResult.status === "fulfilled" ? "" : messageOf(snapshotResult.reason),
        exportError: exportResult.status === "fulfilled" ? "" : messageOf(exportResult.reason),
        // A doctor receipt belongs to the run that produced it; a later
        // refresh keeps it because it is a recorded outcome, not a live probe.
        doctor: current.doctor,
        doctorError: current.doctorError,
        readAt: Date.now(),
      }));
    })();
    return () => { cancelled = true; };
  }, [statusData]);

  async function runDoctor() {
    setDoctorBusy(true);
    try {
      const response = await command(operations.doctor.check, {});
      const data = response.data ?? {};
      setReads((current) => ({ ...current, doctor: { ok: data.ok === true, checks: Array.isArray(data.checks) ? data.checks : [], readAt: Date.now() }, doctorError: "" }));
    } catch (error) {
      setReads((current) => ({ ...current, doctor: undefined, doctorError: t("doctor.check did not answer: {{message}}", { message: messageOf(error) }) }));
    } finally {
      setDoctorBusy(false);
    }
  }

  const facts = buildFacts({ t, status, statusData, capabilities, reads });
  const asOf = t("as of {{time}} (this browser)", { time: clockLabel(reads.readAt) });
  // Only the protection and recovery facts may become the headline. A
  // discovery regression (an index dimension) and a "this build cannot source
  // this" row are facts too, but naming one as the top-line health claim would
  // present a discovery or scope statement as a protection failure.
  const weakest = weakestFact(facts.filter((fact) => SUMMARY_FACT_IDS.has(fact.id)));
  const summaryState: FactState = weakest?.state ?? "PROVEN";
  // The name of a fact is its alarm wording, so a proven headline names the
  // proven form instead of reading "unproven" while the panel says PROVEN.
  const summaryFact = weakest ? (weakest.state === "PROVEN" ? weakest.provenName ?? weakest.name : weakest.name) : t("all protection and recovery facts proven");
  const summaryText = t("Health: {{fact}}", { fact: summaryFact });

  return <details className="status-panel" open={expanded} onToggle={(event) => setExpanded((event.currentTarget as HTMLDetailsElement).open)}>
    <summary className="status-panel-summary" data-health={summaryState} data-weakest={weakest?.id ?? "none"} data-scope="protection-and-recovery"><span className="health-state" data-state={summaryState}>{summaryState}</span>{summaryState === "PROVEN" ? " · " : " — "}<span className="status-panel-summary-text">{summaryText}</span>{summaryState === "PROVEN" && <span className="status-panel-asof"> · {asOf}</span>}<ChevronRight className="status-panel-chevron" size={14} aria-hidden="true" /><span className="sr-only">{t("System readiness")}</span></summary>
    <div className="status-panel-body">
      <p className="status-panel-note">{t("Every health fact states what this browser can prove now. UNKNOWN names the missing source; it is never a zero or a healthy default.")}</p>
      {FACT_GROUPS.map((group) => {
        const rows = facts.filter((fact) => fact.group === group.id);
        const groupWeakest = weakestFact(rows);
        const groupState: FactState = groupWeakest?.state ?? "PROVEN";
        const summaryID = `status-group-${group.id}`;
        return <details className="status-group" data-group={group.id} key={group.id} open={openGroups[group.id]} onToggle={(event) => { const next = (event.currentTarget as HTMLDetailsElement).open; setOpenGroups((current) => current[group.id] === next ? current : { ...current, [group.id]: next }); }}>
          <summary className="status-group-summary" id={summaryID} data-group-state={groupState}><span className="health-state" data-state={groupState}>{groupState}</span>{groupState === "PROVEN" ? " · " : " — "}<span className="status-group-name">{t(group.label)}</span><span className="status-group-count">{t("{{count}} facts", { count: rows.length })}</span><ChevronRight className="status-group-chevron" size={13} aria-hidden="true" /></summary>
          <ul className="health-facts" aria-labelledby={summaryID}>{rows.map((fact) => <li className="health-fact" key={fact.id} data-fact={fact.id} data-group={group.id} data-state={fact.state}><span className="health-state" data-state={fact.state}>{fact.state}</span>{fact.state === "PROVEN" ? " · " : " — "}<span className="health-fact-detail">{fact.line}</span></li>)}</ul>
        </details>;
      })}
      <div className="status-panel-actions">
        <button type="button" className="secondary-button compact" aria-label={t("Open verification report")} onClick={(event) => onOpenVerification(event.currentTarget)}>{t("Details")}</button>
        {onOpenActivity && <button type="button" className="secondary-button compact" onClick={onOpenActivity}>{t("Open activity")}</button>}
        <button type="button" className="icon-button" aria-label={t("Refresh facts")} title={t("Refresh facts")} onClick={onRefresh}><RefreshCw size={15} /></button>
        <button type="button" className="secondary-button compact" title={t("The doctor check reads repository bytes; this browser never runs it automatically.")} disabled={doctorBusy || !statusData} onClick={() => void runDoctor()}>{doctorBusy ? t("Running...") : t("Run doctor check")}</button>
      </div>
    </div>
  </details>;
}

function weakestFact(facts: HealthFact[]): HealthFact | undefined {
  return [...facts].sort((left, right) => RANK[left.state] - RANK[right.state])[0];
}

function messageOf(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason ?? "");
}

function buildFacts({ t, status, statusData, capabilities, reads }: { t: Translator; status: string; statusData: any; capabilities: any[]; reads: StatusReads }): HealthFact[] {
  const facts: HealthFact[] = [];
  // One place decides the row string and the row's group, so a state token can
  // never be rendered without its value, and a fact can never change group by
  // accident: the group is an argument of the only constructor.
  const record = (id: string, state: FactState, name: string, value: string, group: FactGroup, provenName?: string) => {
    const line = state === "PROVEN" ? `${value} · ${t("as of {{time}} (this browser)", { time: clockLabel(reads.readAt) })}` : value;
    facts.push({ id, state, name, provenName, line, group });
  };
  const serviceDown = !statusData;
  const checking = !statusData && status === "Checking service";
  const unreachable = t("Cannot prove any health fact while the service is unreachable");
  const notAnsweredYet = t("the service has not answered yet in this browser session");
  // Every fact that describes protecting or recovering content belongs to the
  // protection group; the headline draws from a named subset of it.
  const protection: FactGroup = "protection";
  const discovery: FactGroup = "discovery";
  const notSourced: FactGroup = "not-sourced";

  // 1. The service itself.
  if (serviceDown) {
    if (checking) record("service", "UNKNOWN", t("service unreachable"), notAnsweredYet, protection);
    else record("service", "FAILED", t("service unreachable"), t("the service did not answer this browser session"), protection);
  } else {
    record("service", "PROVEN", t("service unreachable"), t("Service: reachable"), protection, t("service reachable"));
  }

  const repository = statusData?.repository;
  const catalog = statusData?.catalog;

  // 2..4. Repository, writability, and capacity - all from status.get.
  if (serviceDown) {
    record("repository", "UNKNOWN", t("repository unproven"), checking ? notAnsweredYet : unreachable, protection);
    record("writability", "UNKNOWN", t("repository unproven"), checking ? notAnsweredYet : unreachable, protection);
    record("capacity", "UNKNOWN", t("repository unproven"), checking ? notAnsweredYet : unreachable, protection);
  } else if (!repository) {
    record("repository", "UNKNOWN", t("repository unproven"), t("this service reports no repository fact"), protection);
    record("writability", "UNKNOWN", t("repository unproven"), t("this service reports no repository fact"), protection);
    record("capacity", "UNKNOWN", t("repository unproven"), t("this service reports no repository fact"), protection);
  } else {
    if (repository.ok === true) {
      record("repository", "PROVEN", t("repository unproven"), t("Repository: {{path}} · profile {{profile}} · {{count}} restore points", {
        path: repository.path || t("Not reported"),
        profile: repository.repository_profile || repository.compression_profile || t("profile not reported"),
        count: typeof repository.snapshots === "number" ? repository.snapshots : 0,
      }), protection, t("repository available"));
    } else {
      record("repository", "FAILED", t("Repository unavailable"), t("the repository at {{path}} did not open", { path: repository.path || t("Not reported") }), protection);
    }
    const [writabilityState, writabilityValue] = writabilityFact(t, repository);
    record("writability", writabilityState, t("repository unproven"), writabilityValue, protection, t("writability and capacity proven"));
    const [capacityState, capacityValue] = capacityFact(t, repository);
    record("capacity", capacityState, t("repository unproven"), capacityValue, protection);
  }

  // 5..6. Catalog and its schema ledger - both from status.get.
  if (serviceDown) {
    record("catalog", "UNKNOWN", t("catalog unproven"), checking ? notAnsweredYet : unreachable, protection);
    record("schema", "UNKNOWN", t("catalog schema unproven"), checking ? notAnsweredYet : unreachable, protection);
  } else if (!catalog) {
    record("catalog", "UNKNOWN", t("catalog unproven"), t("this service reports no catalog fact"), protection);
    record("schema", "UNKNOWN", t("catalog schema unproven"), t("this service reports no catalog fact"), protection);
  } else {
    if (catalog.ok === true) record("catalog", "PROVEN", t("catalog unproven"), t("Catalog: {{path}}", { path: catalog.path || t("Not reported") }), protection, t("catalog available"));
    else record("catalog", "FAILED", t("Catalog unavailable"), t("the catalog at {{path}} did not open", { path: catalog.path || t("Not reported") }), protection);
    const [schemaState, schemaValue] = schemaFact(t, catalog);
    record("schema", schemaState, t("catalog schema unproven"), schemaValue, protection, t("catalog schema current"));
  }

  // 7. Catalog-wide counts. No operation exists in this build, so the honest
  // answer is UNKNOWN with that reason, never a client-side zero.
  record("counts", "UNKNOWN", t("subject counts unproven"), t("No catalog subject count operation exists in this build."), notSourced);

  // 8..9. Freeze and materialize, read from the durable records themselves.
  const latest = reads.snapshots.at(-1);
  if (serviceDown) {
    record("freeze", "UNKNOWN", t("last freeze unproven"), checking ? notAnsweredYet : unreachable, protection);
    record("materialize", "UNKNOWN", t("last materialize unproven"), checking ? notAnsweredYet : unreachable, protection);
  } else {
    if (reads.snapshotError) record("freeze", "UNKNOWN", t("last freeze unproven"), t("snapshot.list did not answer in this browser session: {{message}}", { message: reads.snapshotError }), protection);
    else if (!latest) record("freeze", "PROVEN", t("last freeze unproven"), t("Last freeze: no restore point is published yet"), protection);
    else record("freeze", "PROVEN", t("last freeze unproven"), t("Last freeze: {{time}} · {{count}} published restore points", { time: daemonDateTime(latest.created_at, t), count: reads.snapshots.length }), protection);

    if (reads.exportError) record("materialize", "UNKNOWN", t("last materialize unproven"), t("export.list did not answer in this browser session: {{message}}", { message: reads.exportError }), protection);
    else if (!reads.exports.length) record("materialize", "PROVEN", t("last materialize unproven"), t("Last materialize: no export manifest is frozen yet"), protection);
    else record("materialize", "PROVEN", t("last materialize unproven"), t("Last materialize: {{time}} · manifest {{digest}}", { time: daemonDateTime(reads.exports[0].created_at, t), digest: reads.exports[0].manifest_digest || t("Not reported") }), protection);
  }

  // 10. Verification receipts are recorded per restore point; an absent
  // receipt is UNKNOWN with the service's own reason, never a zeroed time.
  const [verificationState, verificationValue] = serviceDown
    ? ["UNKNOWN", checking ? notAnsweredYet : unreachable] as FactValue
    : verificationFact(t, latest, reads);
  record("verification", verificationState, t("verification unproven"), verificationValue, protection, t("verification proven"));

  // 11. The protection mix of the newest restore point.
  const [protectionState, protectionValue] = serviceDown
    ? ["UNKNOWN", checking ? notAnsweredYet : unreachable] as FactValue
    : protectionFact(t, latest, reads);
  record("protection", protectionState, t("protection mix unproven"), protectionValue, protection, t("protection proven"));

  // 12. Doctor gates. Repository bytes are read only on request.
  if (reads.doctorError) record("doctor", "UNKNOWN", t("doctor gates unproven"), reads.doctorError, discovery);
  else if (!reads.doctor) record("doctor", "UNKNOWN", t("doctor gates unproven"), t("the byte-reading doctor check has not been run in this browser session"), discovery);
  else {
    const failed = reads.doctor.checks.filter((check) => !check.ok);
    if (!failed.length) record("doctor", "PROVEN", t("doctor gates unproven"), t("Doctor gates: {{count}} checks passed · checked {{time}}", { count: reads.doctor.checks.length, time: clockLabel(reads.doctor.readAt) }), discovery);
    else record("doctor", "FAILED", t("doctor gates unproven"), t("{{id}}: {{message}}", { id: failed[0].id, message: failed[0].message }), discovery);
  }

  // 13..14. Discovery dimensions: per-workspace projections from status.get,
  // gated by the provider state capability.list reports, so a per-item or
  // single-workspace generation can never be presented as a global claim.
  const index = Array.isArray(statusData?.index) ? statusData.index : [];
  const lexical = dimensionFact(t, {
    id: LEXICAL_DIMENSION,
    label: (state) => t("Lexical index: {{state}}", { state }),
    states: index.map((entry: any) => String(entry.lexical ?? "")),
    capability: capabilityState(capabilities, LEXICAL_DIMENSION),
    serviceDown, checking, unreachable, notAnsweredYet,
  });
  record("index-lexical", lexical[0], t("lexical index unproven"), lexical[1], discovery);
  const semantic = dimensionFact(t, {
    id: SEMANTIC_DIMENSION,
    label: (state) => t("Semantic index: {{state}}", { state }),
    states: index.map((entry: any) => String(entry.semantic ?? "")),
    capability: capabilityState(capabilities, SEMANTIC_DIMENSION),
    serviceDown, checking, unreachable, notAnsweredYet,
  });
  record("index-semantic", semantic[0], t("semantic index unproven"), semantic[1], discovery);
  const image = capabilityFact(t, {
    kind: "index-dimension",
    id: MULTIMODAL_DIMENSION,
    label: (state) => t("Image index: {{state}}", { state }),
    capabilities, serviceDown, checking, unreachable, notAnsweredYet,
  });
  record("index-multimodal", image[0], t("image index unproven"), image[1], discovery);
  const ocr = capabilityFact(t, {
    kind: "processor",
    id: OCR_CAPABILITY,
    label: (state) => t("Text in images: {{state}}", { state }),
    capabilities, serviceDown, checking, unreachable, notAnsweredYet,
  });
  record("processor-ocr", ocr[0], t("text-in-image extraction unproven"), ocr[1], discovery);

  // 15. Portable recovery records: recovery.export runs one at a time and no
  // operation lists past runs, so this browser cannot claim a count.
  record("recovery-records", "UNKNOWN", t("portable record exports unproven"), t("no operation lists portable recovery record exports in this build"), notSourced);

  // 16. Durable jobs, from the same status projection the activity surface
  // reads. The newest row keeps the daemon's own state token.
  if (serviceDown) record("jobs", "UNKNOWN", t("job state unproven"), checking ? notAnsweredYet : unreachable, protection);
  else {
    const recent = Array.isArray(statusData?.recent_jobs) ? statusData.recent_jobs : [];
    const total = typeof statusData?.jobs === "number" ? statusData.jobs : recent.length;
    if (!recent.length) record("jobs", "PROVEN", t("job state unproven"), t("Jobs: no durable job is recorded yet"), protection);
    else record("jobs", "PROVEN", t("job state unproven"), t("Jobs: {{count}} durable jobs recorded · newest {{state}} at {{time}}", { count: total, state: String(recent[0].state ?? "UNKNOWN"), time: daemonDateTime(recent[0].updated_at, t) }), protection);
  }

  return facts;
}

// capabilityFact reports a component whose own capability state is the whole
// truth: an installed-but-not-yet-built artifact and a missing artifact are
// different states, and the notes carry the daemon's reason for either.
function capabilityFact(t: Translator, { kind, id, label, capabilities, serviceDown, checking, unreachable, notAnsweredYet }: { kind: string; id: string; label: (state: string) => string; capabilities: any[]; serviceDown: boolean; checking: boolean; unreachable: string; notAnsweredYet: string }): FactValue {
  if (serviceDown) return ["UNKNOWN", checking ? notAnsweredYet : unreachable];
  const entry = capabilities.find((item) => item?.kind === kind && item?.id === id);
  if (!entry) return ["UNKNOWN", `${label("NOT_REPORTED")} · ${t("capability.list reports no state for this component")}`];
  const state = String(entry.state ?? "");
  const reason = String(entry.notes ?? "").trim();
  const detail = reason ? `${label(state)} · ${reason}` : label(state);
  if (state === "READY" || state === "AVAILABLE") return ["PROVEN", detail];
  if (state === "NOT_BUILT") return ["UNKNOWN", detail];
  return ["DEGRADED", detail];
}

function capabilityState(capabilities: any[], id: string): { state: string; notes: string } {
  const entry = capabilities.find((item) => item?.kind === "index-dimension" && item?.id === id);
  return { state: entry ? String(entry.state ?? "") : "", notes: entry ? String(entry.notes ?? "").trim() : "" };
}

function dimensionFact(t: Translator, { id, label, states, capability, serviceDown, checking, unreachable, notAnsweredYet }: { id: string; label: (state: string) => string; states: string[]; capability: { state: string; notes: string }; serviceDown: boolean; checking: boolean; unreachable: string; notAnsweredYet: string }): FactValue {
  if (serviceDown) return ["UNKNOWN", checking ? notAnsweredYet : unreachable];
  if (!capability.state) return ["UNKNOWN", `${label("NOT_REPORTED")} · ${t("capability.list reports no state for this dimension")}`];
  // A process-wide NOT_BUILT is an honest absence, not a degradation: the
  // provider is installed and this workspace's own projection says whether a
  // generation exists. Only an UNAVAILABLE provider downgrades the dimension.
  if (capability.state !== "AVAILABLE" && capability.state !== "NOT_BUILT") {
    return ["DEGRADED", `${label(capability.state)} · ${t("capability.list reports {{id}} as {{state}}", { id, state: capability.state })}`];
  }
  // The daemon's own reason explains a process-wide NOT_BUILT; a workspace
  // that simply has no generation is stated as such, without quoting notes
  // that describe a generation some other workspace already serves.
  const absentDetail = capability.state === "NOT_BUILT" && capability.notes
    ? capability.notes
    : t("no index generation is published for this workspace");
  const absent = `${label("NOT_BUILT")} · ${absentDetail}`;
  if (!states.length) return ["UNKNOWN", absent];
  const unique = [...new Set(states)];
  if (unique.length === 1 && unique[0] === "READY") return ["PROVEN", label("READY")];
  if (unique.includes("UNAVAILABLE")) return ["DEGRADED", label("UNAVAILABLE")];
  if (unique.includes("NOT_BUILT")) return ["UNKNOWN", absent];
  return ["DEGRADED", label(unique.filter(Boolean).join(" / ") || "NOT_REPORTED")];
}

function writabilityFact(t: Translator, repository: any): FactValue {
  const writable = String(repository.writable ?? "");
  if (!writable) return ["UNKNOWN", t("not probed (this build reports no repository write probe)")];
  if (writable === "WRITABLE") {
    const checkedAt = daemonDateTime(repository.writable_checked_at, t);
    return ["PROVEN", `${t("Writability: writable")} · ${t("probed {{time}}", { time: checkedAt })}`];
  }
  if (writable === "READ_ONLY") return ["DEGRADED", t("the repository is read-only: {{reason}}", { reason: repository.writable_reason || t("reason not reported") })];
  return ["UNKNOWN", t("the write probe did not answer: {{reason}}", { reason: repository.writable_reason || t("reason not reported") })];
}

function capacityFact(t: Translator, repository: any): FactValue {
  const measured = repository.capacity_state === "AVAILABLE"
    && ["capacity_total", "capacity_free", "capacity_used"].every((key) => typeof repository[key] === "number" && Number.isFinite(repository[key]));
  if (!measured) return ["UNKNOWN", t("capacity was not measured: {{reason}}", { reason: repository.capacity_reason || t("this service reports no capacity measurement") })];
  const base = t("Capacity: {{total}} total · {{free}} free · {{used}} used", {
    total: formatBytes(repository.capacity_total),
    free: formatBytes(repository.capacity_free),
    used: formatBytes(repository.capacity_used),
  });
  return ["PROVEN", `${base} · ${t("measured {{time}}", { time: daemonDateTime(repository.capacity_measured_at, t) })}`];
}

function schemaFact(t: Translator, catalog: any): FactValue {
  const state = String(catalog.schema_state ?? "");
  const reason = String(catalog.schema_reason ?? "");
  if (state === "CURRENT") {
    return ["PROVEN", t("Catalog schema: version {{version}} ({{migration}})", { version: catalog.schema_version ?? "UNKNOWN", migration: catalog.schema_migration || t("Not reported") })];
  }
  if (state === "DRIFT" || state === "NEWER_THAN_BINARY") return ["FAILED", t("the migration ledger was not read: {{reason}}", { reason: reason || state })];
  if (state === "UNKNOWN") return ["UNKNOWN", t("the migration ledger was not read: {{reason}}", { reason: reason || t("reason not reported") })];
  return ["UNKNOWN", t("this service reports no catalog schema state")];
}

function verificationFact(t: Translator, latest: SnapshotSummary | undefined, reads: StatusReads): FactValue {
  if (reads.snapshotError) return ["UNKNOWN", t("snapshot.list did not answer in this browser session: {{message}}", { message: reads.snapshotError })];
  if (!latest) return ["UNKNOWN", t("no restore point is published yet")];
  const verification = latest.verification;
  if (!verification || verification.state === "UNRECORDED") {
    return ["UNKNOWN", t("no verification receipt is recorded (service reason: {{reason}})", { reason: verification?.reason || t("reason not reported") })];
  }
  const mode = verification.mode || "UNKNOWN";
  if (verification.outcome === "FAILED") return ["FAILED", t("Verification failed: {{reason}}", { reason: verification.failure_reason || mode })];
  if (verification.outcome === "UNAVAILABLE") return ["DEGRADED", t("Verification coverage is degraded: {{reason}}", { reason: verification.failure_reason || mode })];
  return ["PROVEN", t("Last verification: {{time}} · {{mode}} · files {{passed}}/{{attempted}}", {
    time: daemonDateTime(verification.verified_at, t),
    mode,
    passed: Number(verification.passed_files ?? 0),
    attempted: Number(verification.attempted_files ?? 0),
  })];
}

function protectionFact(t: Translator, latest: SnapshotSummary | undefined, reads: StatusReads): FactValue {
  if (reads.snapshotError) return ["UNKNOWN", t("snapshot.list did not answer in this browser session: {{message}}", { message: reads.snapshotError })];
  if (!latest) return ["UNKNOWN", t("no restore point is published yet")];
  const files = Number(latest.files ?? 0);
  if (!files) return ["PROVEN", t("Protection: the newest restore point has no regular files")];
  const protectedFiles = Number(latest.protected_files ?? 0);
  const unprotectedFiles = Number(latest.unprotected_files ?? 0);
  if (!latest.protection_outcomes && !protectedFiles && !unprotectedFiles) return ["UNKNOWN", t("the newest restore point reports no protection mix")];
  const base = t("Protection: {{protected}} of {{files}} files exact-protected · {{unprotected}} unprotected", { protected: protectedFiles, files, unprotected: unprotectedFiles });
  if (latest.bytes_complete === false) return ["DEGRADED", `${base} · ${t("logical byte total incomplete")}`];
  return ["PROVEN", `${base} · ${t("{{size}} logical", { size: formatBytes(Number(latest.bytes ?? 0)) })}`];
}
