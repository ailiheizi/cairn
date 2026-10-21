import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Locale, Translator } from "../i18n";
import { command } from "../app/command";
import { operations } from "../lib/operations";
import type { StorageMeasure, StorageReport as StorageReportData } from "../lib/types";
import { formatBytes, formatDateTime } from "../lib/format";

type ReportState = {
  report?: StorageReportData;
  receivedAt?: string;
  error?: string;
};

function hasExactMeasuredBytes(value: StorageMeasure | undefined): value is StorageMeasure & { status: "MEASURED"; bytes: number } {
  return value?.status === "MEASURED" && typeof value.bytes === "number" && Number.isSafeInteger(value.bytes) && value.bytes >= 0;
}

export function StorageReport({ t, locale }: { t: Translator; locale: Locale }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReportState>();
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const requestID = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; inFlight.current = false; requestID.current += 1; };
  }, []);

  async function measure() {
    if (inFlight.current) return;
    inFlight.current = true;
    const id = ++requestID.current;
    setLoading(true);
    setResult(undefined);
    try {
      const response = await command(operations.doctor.check, { storage_report: true });
      if (!mounted.current || requestID.current !== id) return;
      const report = (response.data as { storage_report?: StorageReportData } | undefined)?.storage_report;
      setResult(report
        ? { report, receivedAt: new Date().toISOString() }
        : { error: t("Storage report unavailable from this running service.") });
    } catch (error) {
      if (!mounted.current || requestID.current !== id) return;
      setResult({ error: error instanceof Error ? error.message : t("Storage measurement failed.") });
    } finally {
      if (requestID.current === id) inFlight.current = false;
      if (mounted.current && requestID.current === id) setLoading(false);
    }
  }

  const renderMeasure = (label: string, value: StorageMeasure | undefined) => {
    const statusLabel = value?.status === "MEASURED" ? t("Measured")
      : value?.status === "UNMEASURED" ? t("Not measured")
        : value?.status === "UNAVAILABLE" ? t("Unavailable")
          : value?.status ? t("Unknown measurement status") : t("Not reported");
    let text: string;
    if (hasExactMeasuredBytes(value)) {
      text = t("{{exact}} bytes ({{formatted}})", { exact: value.bytes.toLocaleString(locale), formatted: formatBytes(value.bytes) });
    } else if (value?.status === "MEASURED") {
      text = value.reason
        ? t("Exact byte count unavailable or invalid: {{reason}}", { reason: value.reason })
        : t("Exact byte count unavailable or invalid.");
    } else if (value?.reason) {
      text = t("{{status}}: {{reason}}", { status: statusLabel, reason: value.reason });
    } else if (value?.status) {
      text = statusLabel;
    } else {
      text = t("Not reported by this measurement.");
    }
    return <div className="config-field readonly" key={label}><span>{t(label)}</span><strong>{text}</strong></div>;
  };

  const report = result?.report;
  const reportStatusLabel = report?.status === "MEASURED" ? t("Measured")
    : report?.status === "PARTIAL" ? t("Partial")
      : report?.status === "UNAVAILABLE" ? t("Unavailable")
        : t("Unknown report status");
  const basisLabel = report?.basis === "AUTHENTICATED_RETAINED_SNAPSHOT_FILE_REFERENCES"
    ? t("Basis: authenticated retained snapshot file references")
    : report?.basis ? t("Unknown measurement basis") : t("Measurement basis not reported");
  const primaryMeasures: Array<[string, StorageMeasure | undefined]> = [
    ["Original reference bytes (all retained snapshots)", report?.retained_exact_reference_bytes],
    ["Unique original content bytes", report?.unique_exact_object_logical_bytes],
    ["Bytes reused by duplicate references", report?.whole_file_duplicate_reference_savings_bytes],
    ["Compression savings", report?.compression_savings_bytes],
    ["Stored original bytes", report?.stored_object_file_bytes],
    ["Content repository footprint", report?.repository_footprint_file_bytes],
  ];
  const detailMeasures: Array<[string, StorageMeasure | undefined]> = [
    ["Repository metadata and retained index files", report?.repository_metadata_file_bytes],
    ["Recovery record file bytes", report?.repository_recovery_record_file_bytes],
    ["Configured recovery records file bytes", report?.configured_recovery_records_file_bytes],
    ["Catalog files (including search tables)", report?.catalog_file_bytes],
    ["Configured index files", report?.vector_index_file_bytes],
    ["Model file bytes", report?.model_file_bytes],
    ["Temporary file bytes", report?.temporary_file_bytes],
    ["Retained source bytes", report?.retained_source_bytes],
    ["Net savings", report?.net_savings_bytes],
  ];

  return <section className="config-group storage-report">
    <div className="config-group-heading">
      <h4>{t("Storage report")}</h4>
      <p>{t("Measure the configured repository on request. This uses the running service configuration, not unsaved settings.")}</p>
    </div>
    <div className="model-action">
      <button type="button" className="secondary-button compact" onClick={() => void measure()} disabled={loading}>
        {t(loading ? "Measuring storage…" : "Measure storage")}
      </button>
    </div>
    {loading && <p role="status">{t("Measuring and verifying the configured storage…")}</p>}
    {result?.error && <div className="model-action-message error" role="alert">{result.error}</div>}
    {report && <div className="storage-report-result" aria-live="polite">
      <p className="current-policy">
        {t("Report status")}: <strong>{reportStatusLabel}</strong>
        <> · {t("Retained snapshots")}: <strong>{typeof report.snapshot_count === "number" ? report.snapshot_count.toLocaleString(locale) : report.status === "UNAVAILABLE" ? t("Unavailable") : t("Not reported")}</strong></>
        {result?.receivedAt && <> · {t("Response received")}: <strong>{formatDateTime(result.receivedAt, locale, t)}</strong></>}
      </p>
      {report.reason && <p role="status">{report.reason}</p>}
      <ConfigRows rows={primaryMeasures} renderMeasure={renderMeasure} />
      <details className="config-advanced storage-report-details">
        <summary>{t("Measurement details")}</summary>
        <p>{t("Reference totals include every retained authenticated snapshot file reference; they are not current unique-file counts. Unique logical bytes count verified repository objects. Repository metadata includes repository-local retained lexical-generation files. Configured index-directory bytes may include lexical and vector generations. Catalog files include SQLite tables, including lexical/search tables, plus WAL/SHM. Categories are separate and are not added together.")}</p>
        <p className="current-policy">{basisLabel}</p>
        {(report.repository_profile || report.compression_profile || report.config_digest) && <p className="current-policy">
          {report.repository_profile && <>{t("Running repository profile")}: <strong>{report.repository_profile}</strong></>}
          {report.compression_profile && <> · {t("Compression")}: <strong>{report.compression_profile}</strong></>}
          {report.config_digest && <> · {t("Running configuration digest")}: <strong className="mono">{report.config_digest}</strong></>}
        </p>}
        <ConfigRows rows={detailMeasures} renderMeasure={renderMeasure} />
      </details>
    </div>}
  </section>;
}

function ConfigRows({ rows, renderMeasure }: {
  rows: Array<[string, StorageMeasure | undefined]>;
  renderMeasure: (label: string, value: StorageMeasure | undefined) => ReactNode;
}) {
  return <div className="form-grid two">{rows.map(([label, value]) => renderMeasure(label, value))}</div>;
}
