import { Download, RotateCcw, Server, X } from "lucide-react";
import type { Translator } from "../i18n";
import type { useOriginalTakeout } from "../app/useOriginalTakeout";
import type { SearchHit } from "../lib/types";

type Takeout = ReturnType<typeof useOriginalTakeout>;

export function OriginalTakeoutStatus({ takeout, t, workspaceID, exportOpen, fallbackActionsReady, fallbackActionsMessage, onOpenServerExport, onDownloadOriginal }: {
  takeout: Takeout;
  t: Translator;
  workspaceID: string;
  exportOpen: boolean;
  fallbackActionsReady: boolean;
  fallbackActionsMessage?: string;
  onOpenServerExport: (subjects: SearchHit[], trigger?: EventTarget | null) => void;
  onDownloadOriginal: (entryID: string, filename: string) => void;
}) {
  if (takeout.status === "idle") return null;
  const active = ["planning", "downloading", "preparing"].includes(takeout.status);
  const fallback = takeout.status === "failed" && takeout.fallback?.workspaceID === workspaceID ? takeout.fallback : undefined;
  const detail = fallback
    ? t("ZIP refused for {{count}} selected files: {{reason}}", { count: fallback.subjects.length, reason: takeout.error ? t(takeout.error) : "" })
    : takeout.status === "planning"
    ? t("Freezing the selected originals")
    : takeout.status === "downloading"
      ? takeout.transferPhase === "verifying"
        ? t("Verifying {{current}} of {{total}}: {{name}}", { current: takeout.currentFile, total: takeout.totalFiles, name: takeout.currentName ?? "" })
        : t("Downloading {{current}} of {{total}}: {{name}}", { current: takeout.currentFile, total: takeout.totalFiles, name: takeout.currentName ?? "" })
      : takeout.status === "preparing"
        ? t("Preparing the verified ZIP")
        : takeout.status === "requested"
          ? t("Verified ZIP prepared; download requested")
          : takeout.status === "cancelled"
            ? t("ZIP takeout cancelled; no archive was prepared")
            : t("The ZIP takeout failed; no archive was prepared");
  return <section className={`original-takeout-status${fallback ? " has-fallback" : ""}`} hidden={Boolean(fallback && exportOpen)} role="status" aria-live="polite" aria-busy={active}>
    <div className="original-takeout-copy">
      <strong>{t("Original ZIP takeout")}</strong>
      <span>{detail}</span>
      {["downloading", "preparing", "requested"].includes(takeout.status) && <div className="original-takeout-progress">
        {takeout.expectedBytes > 0
          ? <><small>{t("Bytes received: {{received}} of {{total}}", { received: takeout.receivedBytes, total: takeout.expectedBytes })}</small><progress max={takeout.expectedBytes} value={Math.min(takeout.receivedBytes, takeout.expectedBytes)} aria-label={t("Original bytes received")} /></>
          : <small>{t("No original bytes to transfer")}</small>}
        <small>{t("Verified: {{files}} of {{total}} files, {{bytes}} bytes", { files: takeout.verifiedFiles, total: takeout.totalFiles, bytes: takeout.verifiedBytes })}</small>
      </div>}
      {(takeout.status === "requested" || active) && <small>{t("File name")}: {takeout.requestedFilename}</small>}
    </div>
    {active && <button type="button" className="secondary-button compact" onClick={takeout.cancel} aria-label={t("Cancel ZIP takeout")}><X size={15} />{t("Cancel")}</button>}
    {fallback && <div className="original-takeout-fallback-actions">
      <button type="button" className="secondary-button compact" disabled={!fallbackActionsReady} onClick={(event) => onOpenServerExport(fallback.subjects.map((subject) => ({ ...subject })), event.currentTarget)}><Server size={14} />{t("Continue in server-directory export")}</button>
      {fallback.subjects.length === 1 && fallback.subjects[0]?.entry_id && <button type="button" className="secondary-button compact" disabled={!fallbackActionsReady} onClick={() => { const subject = fallback.subjects[0]!; onDownloadOriginal(subject.entry_id!, subject.name || "download.bin"); takeout.reset(); }}><Download size={14} />{t("Download this original")}</button>}
      {!fallbackActionsReady && fallbackActionsMessage && <small>{t(fallbackActionsMessage)}</small>}
    </div>}
    {(takeout.manifestDigest || takeout.error) && <details className="original-takeout-details"><summary>{t("Download details")}</summary>{takeout.error && <small>{t("Reason")}: {t(takeout.error)}</small>}{takeout.manifestDigest && <small>{t("Frozen export")}: <code>{takeout.manifestDigest}</code></small>}</details>}
    {takeout.retryAvailable && <button type="button" className="secondary-button compact original-takeout-retry" onClick={() => { void takeout.retry(); }}><RotateCcw size={14} />{t("Retry the original {{count}} files", { count: takeout.totalFiles })}</button>}
    {(takeout.status === "failed" || takeout.status === "cancelled" || takeout.status === "requested") && <button type="button" className="secondary-button compact" onClick={takeout.reset}>{t("Dismiss")}</button>}
  </section>;
}
