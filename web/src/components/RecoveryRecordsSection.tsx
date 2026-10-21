import { useEffect, useRef, useState } from "react";
import type { Translator } from "../i18n";
import { command } from "../app/command";
import { operations } from "../lib/operations";

type RecordOutcome = {
  state: "IDLE" | "BUSY" | "SUCCESS" | "UNKNOWN";
  attemptedDestination?: string;
  artifactPath?: string;
  schema?: string;
  manifestDigest?: string;
  length?: number;
  files?: number;
  bytes?: number;
  snapshotRef?: string;
  keyID?: string;
  publicKeyDigest?: string;
  publicationDomain?: string;
  writerIdentity?: string;
  algorithm?: string;
  reason?: string;
  degradedReason?: string;
  degraded?: boolean;
};

function safeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function RecoveryRecordsSection({
  t,
  snapshotRef,
  selectedCopyLabel,
  enabled,
  unavailableReason,
  busy,
  onBusyChange,
}: {
  t: Translator;
  snapshotRef: string;
  selectedCopyLabel: string;
  enabled: boolean;
  unavailableReason: string;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [recordDestination, setRecordDestination] = useState("");
  const [anchorDestination, setAnchorDestination] = useState("");
  const [record, setRecord] = useState<RecordOutcome>({ state: "IDLE" });
  const [anchor, setAnchor] = useState<RecordOutcome>({ state: "IDLE" });
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const generationRef = useRef(0);
  const requestRef = useRef(0);
  const attemptedDestinationsRef = useRef({ record: new Set<string>(), anchor: new Set<string>() });
  const currentSnapshotRef = useRef(snapshotRef);
  currentSnapshotRef.current = snapshotRef;
  const currentBusy = useRef(false);

  useEffect(() => {
    generationRef.current += 1;
    setRecordDestination("");
    setAnchorDestination("");
    setRecord({ state: "IDLE" });
    setAnchor({ state: "IDLE" });
  }, [snapshotRef]);

  useEffect(() => () => {
    generationRef.current += 1;
    requestRef.current += 1;
    if (currentBusy.current) onBusyChange(false);
  }, [onBusyChange]);

  const operationBusy = record.state === "BUSY" || anchor.state === "BUSY";
  const keepDisclosureOpen = operationBusy || record.state === "UNKNOWN" || anchor.state === "UNKNOWN";
  const recordDestinationAttempted = attemptedDestinationsRef.current.record.has(recordDestination.trim());
  const anchorDestinationAttempted = attemptedDestinationsRef.current.anchor.has(anchorDestination.trim());

  useEffect(() => {
    if (!operationBusy) return;
    const keepDrawerOpen = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener("keydown", keepDrawerOpen, true);
    return () => document.removeEventListener("keydown", keepDrawerOpen, true);
  }, [operationBusy]);

  async function exportRecord(kind: "record" | "anchor") {
    if (!enabled || busy || currentBusy.current) return;
    const destination = (kind === "record" ? recordDestination : anchorDestination).trim();
    if (!destination) return;
    const attemptedDestinations = attemptedDestinationsRef.current[kind];
    if (attemptedDestinations.has(destination)) return;
    attemptedDestinations.add(destination);

    const capturedSnapshot = snapshotRef;
    const generation = generationRef.current;
    const request = ++requestRef.current;
    currentBusy.current = true;
    onBusyChange(true);
    const setOutcome = kind === "record" ? setRecord : setAnchor;
    setOutcome({ state: "BUSY", attemptedDestination: destination });
    setDisclosureOpen(true);
    try {
      const response = kind === "record"
        ? await command(operations.recovery.export, { snapshot_ref: capturedSnapshot, destination })
        : await command(operations.recovery.anchorExport, { destination });
      if (generationRef.current !== generation || currentSnapshotRef.current !== capturedSnapshot || requestRef.current !== request) return;
      const data = response.data;
      const artifactPath = data?.artifact_path;
      const length = data?.length;
      const degradedReason = (response.reasons ?? []).map((item) => item.message).filter((message): message is string => typeof message === "string" && Boolean(message.trim())).join(" ");
      if (kind === "record") {
        if (data?.snapshot_ref !== capturedSnapshot || !validText(data?.schema) || !validText(data?.manifest_digest) || !validText(artifactPath) || !safeCount(length) || length === 0) {
          throw new Error(t("The portable recovery response was incomplete or did not match the selected saved copy."));
        }
        setRecord({
          state: "SUCCESS",
          attemptedDestination: destination,
          artifactPath,
          schema: data.schema,
          manifestDigest: data.manifest_digest,
          length,
          files: safeCount(data.files) ? data.files : undefined,
          bytes: safeCount(data.bytes) ? data.bytes : undefined,
          snapshotRef: data.snapshot_ref,
          degraded: response.status === "DEGRADED",
          degradedReason: degradedReason || undefined,
        });
      } else {
        if (!validText(data?.schema) || !validText(artifactPath) || !validText(data?.publication_domain) || !validText(data?.writer_identity)
          || !validText(data?.key_id) || !validText(data?.algorithm) || !validText(data?.public_key_digest)) {
          throw new Error(t("The public trust-anchor response was incomplete."));
        }
        setAnchor({
          state: "SUCCESS",
          attemptedDestination: destination,
          artifactPath,
          schema: data.schema,
          publicationDomain: data.publication_domain,
          writerIdentity: data.writer_identity,
          keyID: data.key_id,
          algorithm: data.algorithm,
          publicKeyDigest: data.public_key_digest,
          degraded: response.status === "DEGRADED",
          degradedReason: degradedReason || undefined,
        });
      }
    } catch (error) {
      if (generationRef.current !== generation || currentSnapshotRef.current !== capturedSnapshot || requestRef.current !== request) return;
      setOutcome({
        state: "UNKNOWN",
        attemptedDestination: destination,
        reason: error instanceof Error ? error.message : t("The export outcome could not be confirmed."),
      });
      setDisclosureOpen(true);
    } finally {
      if (requestRef.current === request) {
        currentBusy.current = false;
        onBusyChange(false);
      }
    }
  }

  function renderOutcome(outcome: RecordOutcome, kind: "record" | "anchor") {
    if (outcome.state === "BUSY") return <p className="recovery-records-status" role="status">{t(kind === "record" ? "Writing the portable recovery record…" : "Writing the public trust anchor…")}</p>;
    if (outcome.state === "UNKNOWN") return <div className="recovery-records-unknown" role="alert">
      <strong>{t("The export result could not be confirmed.")}</strong>
      <p>{outcome.reason}</p>
      <p>{t("Check this destination on the Cairn host before trying another path. This interface will not resubmit to the same path.")}</p>
      <code>{outcome.attemptedDestination}</code>
    </div>;
    if (outcome.state !== "SUCCESS") return null;
    return <dl className="recovery-records-result">
      <div><dt>{t("Created server file")}</dt><dd><code>{outcome.artifactPath}</code></dd></div>
      <div><dt>{t("Artifact schema")}</dt><dd>{outcome.schema}</dd></div>
      {kind === "record" ? <>
        <div><dt>{t("Selected saved copy")}</dt><dd>{selectedCopyLabel}</dd></div>
        <div><dt>{t("Manifest digest")}</dt><dd><code>{outcome.manifestDigest}</code></dd></div>
        <div><dt>{t("Artifact length")}</dt><dd>{t("{{length}} bytes", { length: outcome.length ?? "—" })}</dd></div>
        {outcome.files !== undefined && <div><dt>{t("Files referenced")}</dt><dd>{outcome.files}</dd></div>}
        {outcome.bytes !== undefined && <div><dt>{t("Repository bytes referenced")}</dt><dd>{t("{{length}} bytes", { length: outcome.bytes })}</dd></div>}
        <p className="recovery-records-note">{t("This portable record describes recovery data. It does not contain the repository bytes or prove that the file is independently retained.")}</p>
      </> : <>
        <div><dt>{t("Public key ID")}</dt><dd><code>{outcome.keyID}</code></dd></div>
        <div><dt>{t("Public key digest")}</dt><dd><code>{outcome.publicKeyDigest}</code></dd></div>
        <div><dt>{t("Publication domain")}</dt><dd>{outcome.publicationDomain}</dd></div>
        <p className="recovery-records-note">{t("This file contains the public trust anchor only. Retain it separately to authenticate signed recovery records; it does not contain a private key or establish a valid pair by itself.")}</p>
      </>}
      {outcome.degraded && <p className="recovery-records-unknown" role="status">{t("The command returned with degraded status. Review the recorded artifact details before relying on it.")} {outcome.degradedReason}</p>}
    </dl>;
  }

  return <details className="recovery-records" open={disclosureOpen || keepDisclosureOpen} onToggle={(event) => setDisclosureOpen(event.currentTarget.open)}>
    <summary>{t("Retain recovery records")}
      {(record.state === "UNKNOWN" || anchor.state === "UNKNOWN") && <span className="recovery-records-badge">{t("Outcome needs checking")}</span>}
      {record.state === "SUCCESS" && anchor.state === "SUCCESS" && <span className="recovery-records-badge">{t("Two files created separately")}</span>}
    </summary>
    <div className="recovery-records-content">
      <p className="recovery-records-copy">{t("Export the selected saved copy's portable recovery record and the public trust anchor as two separate new server files. These exports do not copy repository bytes, verify the pair, or establish independent retention.")}</p>
      <p className="recovery-records-selected">{t("Selected saved copy: {{label}}", { label: selectedCopyLabel })}</p>
      {!enabled && <p className="recovery-records-status" role="status">{unavailableReason}</p>}
      <section className="recovery-records-action" aria-labelledby="recovery-record-action-heading">
        <h3 id="recovery-record-action-heading">{t("Portable recovery record")}</h3>
        <label>{t("New server file path for the recovery record")}
          <input value={recordDestination} onChange={(event) => setRecordDestination(event.target.value)} disabled={!enabled || busy || operationBusy} placeholder={t("/backup/selected-copy.recovery.json")} />
        </label>
        {recordDestinationAttempted && <p className="recovery-records-status" role="status">{t("This path was already attempted in this session. Choose a different path to make another explicit request.")}</p>}
        <button type="button" disabled={!enabled || busy || operationBusy || !recordDestination.trim() || recordDestinationAttempted} onClick={() => void exportRecord("record")}>
          {t("Export portable recovery record")}
        </button>
        {renderOutcome(record, "record")}
      </section>
      <section className="recovery-records-action" aria-labelledby="recovery-anchor-action-heading">
        <h3 id="recovery-anchor-action-heading">{t("Public trust anchor")}</h3>
        <label>{t("New server file path for the public trust anchor")}
          <input value={anchorDestination} onChange={(event) => setAnchorDestination(event.target.value)} disabled={!enabled || busy || operationBusy} placeholder={t("/backup/public-trust-anchor.json")} />
        </label>
        {anchorDestinationAttempted && <p className="recovery-records-status" role="status">{t("This path was already attempted in this session. Choose a different path to make another explicit request.")}</p>}
        <button type="button" disabled={!enabled || busy || operationBusy || !anchorDestination.trim() || anchorDestinationAttempted} onClick={() => void exportRecord("anchor")}>
          {t("Export public trust anchor")}
        </button>
        {renderOutcome(anchor, "anchor")}
      </section>
    </div>
  </details>;
}
