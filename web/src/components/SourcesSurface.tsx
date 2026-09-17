import { AlertCircle, ArchiveRestore, Folder, GitCompare, HardDrive, Plus, RefreshCw } from "lucide-react";
import type { Locale, Translator } from "../i18n";
import { formatBytes, formatDateTime, formatReachability, formatReachabilityMessage, formatScanState, formatSourceKind, formatSourceState } from "../lib/format";
import type { SnapshotDiffItem, SourceChangeSummary, SourceSummary } from "../lib/types";

// The configured sources view.
//
// Each card reports the recorded source projection: its locator, recorded
// state, last scan, latest recovery point, and what changed since the previous
// restore point. Source management is a secondary projection: an unavailable
// projection is reported as such and never implies that saved bytes are gone.
//
// The change summary is the daemon's own comparison (`snapshot.list` +
// `snapshot.diff`): the browser renders the daemon's counts and affected
// subjects, and an unanswered or degraded comparison stays unavailable with
// the daemon's reason — it is never rendered as zero changes.

// How many affected subjects the expanded detail lists before it says
// "showing N of M". The bound is visible, never a silent truncation.
const CHANGE_DETAIL_LIMIT = 8;

function changeKindLabel(kind: string | undefined, t: Translator) {
  switch (kind) {
    case "added": return t("Added");
    case "removed": return t("Removed");
    case "moved": return t("Moved");
    case "content_changed": return t("Content changed");
    case "metadata_changed": return t("Metadata changed");
    case "type_changed": return t("Type changed");
    default: return kind ?? t("Changed");
  }
}

function changePaths(change: SnapshotDiffItem) {
  const path = change.path?.trim() ?? "";
  const fromPath = change.from_path?.trim() ?? "";
  if (change.kind === "moved" && fromPath && path) return `${fromPath} → ${path}`;
  return path || fromPath || change.to_path?.trim() || "";
}

// The newest restore point's recorded verification receipt. An unverified
// comparison must say so; it never inherits another restore point's receipt.
function changeVerificationText(change: SourceChangeSummary, locale: Locale, t: Translator) {
  const verification = change.newestVerification;
  if (!verification?.state) return t("Newest restore point verification state: UNKNOWN — this build did not report a receipt");
  if (verification.state === "RECORDED" && (verification.ok || verification.restore_verified)) {
    return t("Newest restore point verified: {{time}} · {{mode}}", { time: formatDateTime(verification.verified_at ?? "", locale, t), mode: verification.mode ?? t("Unknown level") });
  }
  if (verification.state === "RECORDED") {
    return t("Newest restore point verification {{outcome}} — {{reason}}", { outcome: verification.outcome || "UNKNOWN", reason: verification.failure_reason || t("no reason was recorded") });
  }
  return t("Newest restore point not verified — {{reason}}", { reason: verification.reason || t("no snapshot.verify receipt is recorded for it") });
}

export function SourceChangeBlock({ change, locale, t }: { change?: SourceChangeSummary; locale: Locale; t: Translator }) {
  if (!change) return null;
  const heading = <span className="source-changes-label">{t("Change summary")}</span>;
  if (change.state === "NO_POINTS") {
    return <div className="source-changes" data-change-state="NO_POINTS"><GitCompare size={15} aria-hidden="true" /><div className="source-changes-body">{heading}<strong className="source-changes-line">{t("No restore point is published for this source yet, so there is nothing to compare.")}</strong></div></div>;
  }
  if (change.state === "SINGLE_POINT") {
    return <div className="source-changes" data-change-state="SINGLE_POINT"><GitCompare size={15} aria-hidden="true" /><div className="source-changes-body">{heading}<strong className="source-changes-line">{t("Only one restore point is published. There is nothing to compare against yet.")}</strong><small className="source-changes-verification" data-verification-state={change.newestVerification?.state ?? ""}>{changeVerificationText(change, locale, t)}</small></div></div>;
  }
  if (change.state === "READING") {
    return <div className="source-changes" data-change-state="READING"><GitCompare size={15} aria-hidden="true" /><div className="source-changes-body">{heading}<strong className="source-changes-line">{t("Reading the daemon's comparison…")}</strong></div></div>;
  }
  if (change.state === "UNAVAILABLE") {
    // No count is rendered here: the daemon did not answer, so the browser has
    // no comparison to report and says why instead of claiming zero changes.
    return <div className="source-changes" data-change-state="UNAVAILABLE"><AlertCircle size={15} aria-hidden="true" /><div className="source-changes-body">{heading}<strong className="source-changes-line">{t("Change summary unavailable — {{reason}}", { reason: change.reason || t("the daemon did not report a reason") })}</strong></div></div>;
  }
  const total = change.changes.length;
  const shown = Math.min(total, CHANGE_DETAIL_LIMIT);
  return <div className="source-changes" data-change-state="READY"><GitCompare size={15} aria-hidden="true" /><div className="source-changes-body">
    {heading}
    {/* One line, visible without expanding: the daemon's counts and the two
        restore point times the daemon recorded. */}
    <strong className="source-changes-line" data-added={change.added} data-removed={change.removed} data-changed={change.changed} data-from-ref={change.fromRef ?? ""} data-to-ref={change.toRef ?? ""}>
      <span className="source-change-counts">{t("{{added}} added · {{removed}} removed · {{changed}} changed", { added: change.added, removed: change.removed, changed: change.changed })}</span>
      <span className="source-change-window">{t("Frozen {{from}} → {{to}}", { from: formatDateTime(change.fromAt ?? "", locale, t), to: formatDateTime(change.toAt ?? "", locale, t) })}</span>
    </strong>
    <small className="source-changes-verification" data-verification-state={change.newestVerification?.state ?? ""}>{changeVerificationText(change, locale, t)}</small>
    {total === 0
      ? <small className="source-changes-empty">{t("The daemon compared these two restore points and found no differences.")}</small>
      : <details className="source-changes-detail">
        <summary><span>{t("Affected subjects")}</span><small data-shown={shown} data-total={total}>{t("Showing {{shown}} of {{total}} affected subjects", { shown, total })}</small></summary>
        <ul className="source-change-list">{change.changes.slice(0, shown).map((item, index) => <li className="source-change" key={`${item.kind ?? "change"}:${changePaths(item)}:${index}`} data-kind={item.kind ?? ""}>
          <span className="source-change-kind" data-kind={item.kind ?? ""}>{changeKindLabel(item.kind, t)}</span>
          <code className="source-change-path" title={changePaths(item)}>{changePaths(item)}</code>
        </li>)}</ul>
      </details>}
  </div></div>;
}

export function SourceCard({ source, locale, t, busy, coreStorageReady, change, onView, onRecheck }: { source: SourceSummary; locale: Locale; t: Translator; busy: boolean; coreStorageReady: boolean; change?: SourceChangeSummary; onView: () => void; onRecheck: (trigger?: EventTarget | null) => void }) {
  const scan = source.latest_scan;
  const scanTime = scan?.finished_at || scan?.started_at;
  const issueCount = (scan?.failed_entries ?? 0) + (scan?.unstable_entries ?? 0) + (scan?.detection_failures ?? 0);
  const path = source.locator?.trim() || t("Unnamed source");
  return <article className={`source-card ${source.reachability === "AVAILABLE" ? "available" : "offline"}`}>
    <header className="source-card-header"><span className="source-card-icon"><HardDrive size={17} /></span><div className="source-card-title"><strong title={path}>{path}</strong><small>{formatSourceKind(source.kind, t)}</small></div><span className={`source-health ${source.reachability === "AVAILABLE" ? "available" : "offline"}`}><span />{formatReachability(source.reachability, t)}</span></header>
    <div className="source-card-state"><span>{t("Recorded state")}</span><strong>{formatSourceState(source.state, t)}</strong>{source.reachability_message && <small>{formatReachabilityMessage(source.reachability_message, t)}</small>}</div>
    <div className="source-card-stats">
      <div><span>{t("Last scan")}</span><strong>{scanTime ? formatDateTime(scanTime, locale, t) : t("Not scanned")}</strong><small>{scan ? formatScanState(scan.state, t) : t("No scan recorded")}</small></div>
      <div><span>{t("Files")}</span><strong>{scan ? String(scan.regular_files ?? 0) : "—"}</strong><small>{scan ? t("regular files") : t("Not measured")}</small></div>
      <div><span>{t("Bytes hashed")}</span><strong>{scan ? formatBytes(scan.bytes_hashed ?? 0) : "—"}</strong><small>{scan ? t("hashed during scan") : t("Not measured")}</small></div>
      <div><span>{t("Issues")}</span><strong className={issueCount ? "has-issues" : "ok"}>{scan ? String(issueCount) : "—"}</strong><small>{scan ? (issueCount ? t("scan findings") : t("No scan findings")) : t("Not measured")}</small></div>
    </div>
    <div className={`source-recovery ${source.latest_snapshot_ref ? "ready" : "pending"}`}><ArchiveRestore size={15} /><div><span>{t("Latest recovery point")}</span><strong>{source.latest_snapshot_ref ? t("Available") : t("Not published yet")}</strong></div></div>
    <SourceChangeBlock change={change} locale={locale} t={t} />
    <p className="muted">{t("Recheck creates a reviewable plan. Existing saved content is not changed until you confirm.")}</p>
      <footer className="source-card-actions"><button type="button" className="secondary-button compact" onClick={(event) => onRecheck(event.currentTarget)} disabled={busy || !coreStorageReady || source.reachability !== "AVAILABLE"}><RefreshCw size={14} />{t("Recheck source")}</button><button type="button" className="secondary-button compact" onClick={onView} disabled={busy || !source.latest_namespace_root_id && !source.latest_snapshot_ref}><Folder size={14} />{t("View content")}</button></footer>
  </article>;
}

export function SourcesSurface({ t, locale, sources, sourceProjection, sourceChanges, busy, coreStorageReady, isConnected, onViewSource, onRecheckSource, onOpenAdd }: {
  t: Translator;
  locale: Locale;
  sources: SourceSummary[];
  sourceProjection: { state: "READY" | "DEGRADED" };
  sourceChanges: Record<string, SourceChangeSummary>;
  busy: boolean;
  coreStorageReady: boolean;
  isConnected: boolean;
  onViewSource: (sourceItem: SourceSummary) => void;
  onRecheckSource: (sourceItem: SourceSummary, trigger?: EventTarget | null) => void;
  onOpenAdd: (trigger?: EventTarget | null) => void;
}) {
  return <section className="sources-surface" aria-label={t("Sources")}>
    {sourceProjection.state === "DEGRADED" && <div className="source-projection-warning" role="status"><AlertCircle size={14} /><span>{t("Source status could not be loaded. Saved content remains available; refresh to try again.")}</span></div>}
    {sources.length > 0 ? <>
      <div className="sources-surface-actions"><button className="primary-button" onClick={(event) => onOpenAdd(event.currentTarget)} disabled={!isConnected || !coreStorageReady}><Plus size={16} />{t("Add source")}</button></div>
      <div className="source-card-list">{sources.map((sourceItem, index) => <SourceCard key={sourceItem.source_ref ?? sourceItem.locator ?? index} source={sourceItem} locale={locale} t={t} busy={busy} coreStorageReady={coreStorageReady} change={sourceItem.source_ref ? sourceChanges[sourceItem.source_ref] : undefined} onView={() => onViewSource(sourceItem)} onRecheck={(trigger) => onRecheckSource(sourceItem, trigger)} />)}</div>
    </> : sourceProjection.state === "DEGRADED" ? null : <div className="empty-state"><span className="vault-sigil"><HardDrive size={35} /></span><h2>{t("Start by adding a source")}</h2><p>{t("Add a server folder, review what will be stored, then confirm.")}</p><button className="primary-button" onClick={(event) => onOpenAdd(event.currentTarget)} disabled={!isConnected || !coreStorageReady}><Plus size={16} />{t("Add source")}</button></div>}
  </section>;
}
