import { X } from "lucide-react";
import type { Translator } from "../i18n";
import type { useOriginalTakeout } from "../app/useOriginalTakeout";

type Takeout = ReturnType<typeof useOriginalTakeout>;

export function OriginalTakeoutStatus({ takeout, t }: { takeout: Takeout; t: Translator }) {
  if (takeout.status === "idle") return null;
  const active = ["planning", "downloading", "preparing"].includes(takeout.status);
  const detail = takeout.status === "planning"
    ? t("Freezing the selected originals")
    : takeout.status === "downloading"
      ? t("Downloading and verifying {{current}} of {{total}}: {{name}}", { current: takeout.currentFile, total: takeout.totalFiles, name: takeout.currentName ?? "" })
      : takeout.status === "preparing"
        ? t("Preparing the verified ZIP")
        : takeout.status === "requested"
          ? t("Verified ZIP prepared; download requested")
          : takeout.status === "cancelled"
            ? t("ZIP takeout cancelled; no archive was prepared")
            : t("The ZIP takeout failed; no archive was prepared");
  return <section className="original-takeout-status" role="status" aria-live="polite" aria-busy={active}>
    <div className="original-takeout-copy">
      <strong>{t("Original ZIP takeout")}</strong>
      <span>{detail}</span>
      {(takeout.status === "requested" || active) && <small>{t("File name")}: {takeout.requestedFilename}</small>}
    </div>
    {active && <button type="button" className="secondary-button compact" onClick={takeout.cancel} aria-label={t("Cancel ZIP takeout")}><X size={15} />{t("Cancel")}</button>}
    {(takeout.manifestDigest || takeout.error) && <details className="original-takeout-details"><summary>{t("Download details")}</summary>{takeout.error && <small>{t("Reason")}: {t(takeout.error)}</small>}{takeout.manifestDigest && <small>{t("Frozen export")}: <code>{takeout.manifestDigest}</code></small>}</details>}
    {(takeout.status === "failed" || takeout.status === "cancelled" || takeout.status === "requested") && <button type="button" className="secondary-button compact" onClick={takeout.reset}>{t("Dismiss")}</button>}
  </section>;
}
