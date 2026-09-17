import { AlertCircle, ArchiveRestore, Folder, HardDrive, Plus, RefreshCw } from "lucide-react";
import type { Locale, Translator } from "../i18n";
import { formatBytes, formatDateTime, formatReachability, formatReachabilityMessage, formatScanState, formatSourceKind, formatSourceState } from "../lib/format";
import type { SourceSummary } from "../lib/types";

// The configured sources view.
//
// Each card reports the recorded source projection: its locator, recorded
// state, last scan, and latest recovery point. Source management is a secondary
// projection: an unavailable projection is reported as such and never implies
// that saved bytes are gone.

export function SourceCard({ source, locale, t, busy, coreStorageReady, onView, onRecheck }: { source: SourceSummary; locale: Locale; t: Translator; busy: boolean; coreStorageReady: boolean; onView: () => void; onRecheck: (trigger?: EventTarget | null) => void }) {
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
    <p className="muted">{t("Recheck creates a reviewable plan. Existing saved content is not changed until you confirm.")}</p>
      <footer className="source-card-actions"><button type="button" className="secondary-button compact" onClick={(event) => onRecheck(event.currentTarget)} disabled={busy || !coreStorageReady || source.reachability !== "AVAILABLE"}><RefreshCw size={14} />{t("Recheck source")}</button><button type="button" className="secondary-button compact" onClick={onView} disabled={busy || !source.latest_namespace_root_id && !source.latest_snapshot_ref}><Folder size={14} />{t("View content")}</button></footer>
  </article>;
}

export function SourcesSurface({ t, locale, sources, sourceProjection, busy, coreStorageReady, isConnected, onViewSource, onRecheckSource, onOpenAdd }: {
  t: Translator;
  locale: Locale;
  sources: SourceSummary[];
  sourceProjection: { state: "READY" | "DEGRADED" };
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
      <div className="source-card-list">{sources.map((sourceItem, index) => <SourceCard key={sourceItem.source_ref ?? sourceItem.locator ?? index} source={sourceItem} locale={locale} t={t} busy={busy} coreStorageReady={coreStorageReady} onView={() => onViewSource(sourceItem)} onRecheck={(trigger) => onRecheckSource(sourceItem, trigger)} />)}</div>
    </> : sourceProjection.state === "DEGRADED" ? null : <div className="empty-state"><span className="vault-sigil"><HardDrive size={35} /></span><h2>{t("Start by adding a source")}</h2><p>{t("Add a server folder, review what will be stored, then confirm.")}</p><button className="primary-button" onClick={(event) => onOpenAdd(event.currentTarget)} disabled={!isConnected || !coreStorageReady}><Plus size={16} />{t("Add source")}</button></div>}
  </section>;
}
