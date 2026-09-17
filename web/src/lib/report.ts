import type { Locale, Translator } from "../i18n";
import { formatBytes, formatEntryType, formatNoteDate } from "./format";

// The selection report: one Markdown document the operator can keep outside
// the product.
//
// This module is the pure half of the feature. It receives exactly the facts
// the browser read from the daemon and renders the document; it performs no
// network call, reads no browser state, and invents no value. The rules it
// enforces:
//
//   - A fact the daemon did not report is written as `UNKNOWN — {reason}`,
//     never omitted, never rendered as success. An unavailable representation,
//     a LINK_ONLY_UNPROTECTED outcome, a degraded protection read, and a note
//     body that could not be read each keep their own reason.
//   - A subject whose reads failed or were skipped is still named with its
//     provenance path: dropping it would misreport the selection.
//   - Every label goes through `t()` so a Chinese operator gets a Chinese
//     document; every value is the daemon's own string, verbatim.
//   - Internal IDs the operator cannot use are never written. The SHA-256
//     content identity is the one identifier that is kept, because it is the
//     exact identity the document exists to carry.
//
// Wording lives here, once, so the document's structure and its strings can be
// inspected without running a browser.

/** One reported fact: the daemon's value, or the reason there is none. */
export type ReportFact = { state: "KNOWN"; value: string } | { state: "UNKNOWN"; reason: string };

/** One note body with its source label and durable provenance details. */
export type ReportNote = {
  /** The source label: User note / Imported note / Extracted note / AI note. */
  sourceLabel: string;
  body: string;
  /** True when only a bounded summary was read and the body is not available. */
  bodyUnavailable: boolean;
  /** Why the body could not be read, when `bodyUnavailable`. */
  bodyUnavailableReason: string;
  /** Durable details (date, revision, acceptance), taken from the record. */
  updatedAt: string;
  revision: number | null;
  accepted: boolean | null;
};

/** One representation row as the daemon reported it; no field is inferred. */
export type ReportRepresentationRow = {
  class?: string;
  fidelity?: string;
  placement?: string;
  verified?: boolean;
  authoritative?: boolean;
  codec_profile_ref?: string;
};

export type ReportRepresentation =
  | { state: "READ"; rows: ReportRepresentationRow[] }
  | { state: "UNKNOWN"; reason: string };

export type ReportSubject = {
  name: string;
  /** The provenance path; empty when the daemon did not report one. */
  provenancePath: string;
  entryType: string;
  /** The daemon's logical size; null when it was not reported. */
  logicalSize: number | null;
  /** The daemon's exact content identity; empty when it was not reported. */
  contentID: string;
  protection: ReportFact;
  representation: ReportRepresentation;
  tags: string[];
  tagsReadable: boolean;
  tagsReason: string;
  notes: ReportNote[];
  notesReadable: boolean;
  notesReason: string;
  /** Why no read succeeded for this subject; empty when at least one did. */
  unreadableReason: string;
  /** Why the supplementary reads were skipped for this subject; empty when attempted. */
  skippedReason: string;
};

export type SelectionReportInput = {
  generatedAt: Date;
  locale: Locale;
  /** True when the selection came from `search.query` results. */
  fromSearch: boolean;
  /** The active query the selection came from, when it came from a search. */
  query: string;
  subjects: ReportSubject[];
  read: {
    /** The operations this report actually issued, in order. */
    operations: string[];
    /** Subjects whose stored facts were read (at least one read answered). */
    readCount: number;
    /** Subjects whose every read failed. */
    failedCount: number;
    /** Subjects the report cap left unread. */
    skippedCount: number;
    /** The cap on subjects whose stored facts are read. */
    subjectCap: number;
  };
  t: Translator;
};

/**
 * `restoreweave-selection-<UTC timestamp>.md`. The stamp is the ISO-8601 UTC
 * time with `:` replaced, so the name is valid on every platform.
 */
export function selectionReportFilename(generatedAt: Date): string {
  const stamp = generatedAt.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  return `restoreweave-selection-${stamp}.md`;
}

/** The log name the report is written under; also the document's title. */
export const SELECTION_REPORT_TITLE = "RestoreWeave selection report";

/** The digest and the logical length are reported as two independent facts. */
function identityText(subject: ReportSubject, t: Translator): string {
  return subject.contentID ? codeSpan(subject.contentID) : unknownText(t("the daemon did not report a content identity for this entry"), t);
}

function lengthText(subject: ReportSubject, t: Translator): string {
  return subject.logicalSize === null
    ? unknownText(t("the daemon did not report a logical length for this entry"), t)
    : t("{{bytes}} bytes", { bytes: subject.logicalSize });
}

function unknownText(reason: string, t: Translator): string {
  return t("UNKNOWN — {{reason}}", { reason });
}

function factText(fact: ReportFact, t: Translator): string {
  return fact.state === "KNOWN" ? fact.value : unknownText(fact.reason, t);
}

/**
 * The honest state of the exact copy, using the same vocabulary the inspector
 * uses. It never says "verified" for a placement the daemon did not verify.
 */
function representationSummary(representation: ReportRepresentation, t: Translator): string {
  if (representation.state === "UNKNOWN") return unknownText(representation.reason, t);
  const rows = representation.rows;
  if (!rows.length) return t("No representation is reported for this subject.");
  const exact = rows.find((row) => row.class === "EXACT" && row.authoritative === true);
  if (exact && exact.placement === "present" && exact.verified === true) return t("Verified exact bytes");
  if (exact?.placement === "missing" || exact?.verified === false) return t("Exact copy is missing or failed verification");
  if (exact) return t("Exact copy is present but not verified");
  return t("No authoritative exact copy reported");
}

/** The exact row's raw placement, verification, and codec, or nothing. */
function representationRecord(representation: ReportRepresentation, t: Translator): string {
  if (representation.state !== "READ") return "";
  const exact = representation.rows.find((row) => row.class === "EXACT");
  if (!exact) return "";
  const fields: string[] = [];
  if (exact.placement) fields.push(`${t("placement:")} ${flat(exact.placement)}`);
  if (typeof exact.verified === "boolean") fields.push(`${t("verified:")} ${exact.verified ? t("yes") : t("no")}`);
  if (exact.codec_profile_ref) fields.push(`${t("codec:")} ${flat(exact.codec_profile_ref)}`);
  if (exact.fidelity) fields.push(`${t("fidelity:")} ${flat(exact.fidelity)}`);
  return fields.length ? `${t("class:")} EXACT · ${fields.join(" · ")}` : "";
}

function noteLines(note: ReportNote, locale: Locale, t: Translator): string[] {
  const body = note.bodyUnavailable ? t("Body unavailable") : note.body;
  const meta: string[] = [];
  if (note.revision !== null) meta.push(t("revision {{revision}}", { revision: note.revision }));
  if (note.updatedAt) meta.push(formatNoteDate(note.updatedAt, locale, t));
  if (note.accepted === false) meta.push(t("Not accepted"));
  if (note.bodyUnavailable && note.bodyUnavailableReason) meta.push(note.bodyUnavailableReason);
  const [first = "", ...rest] = normalizeText(body).split("\n");
  const suffix = meta.length ? ` — ${meta.join(" · ")}` : "";
  return [`  - [${note.sourceLabel}] ${first}${suffix}`, ...rest.map((line) => (line ? `    ${line}` : ""))];
}

// A single line keeps its meaning when it moves into a bullet. Newlines are
// folded to one space; the daemon's own line breaks are only preserved inside
// note bodies, where they are the operator's text.
function flat(value: string | undefined): string {
  return normalizeText(value ?? "").replace(/\s*\n\s*/g, " ").trim();
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

// A path is quoted verbatim. A path that itself contains a backtick stays
// plain text so the document never rewrites what the daemon reported.
function codeSpan(value: string): string {
  return value.includes("`") ? value : `\`${value}\``;
}

function subjectSection(subject: ReportSubject, locale: Locale, t: Translator): string[] {
  const lines: string[] = [];
  lines.push(`## ${flat(subject.name) || t("Untitled subject")}`, "");
  lines.push(`- ${t("Provenance path: {{value}}", { value: subject.provenancePath ? codeSpan(flat(subject.provenancePath)) : unknownText(t("the daemon did not report a provenance path for this entry"), t) })}`);
  lines.push(`- ${t("Entry type: {{value}}", { value: subject.entryType ? formatEntryType(subject.entryType, t) : unknownText(t("the daemon did not report an entry type for this entry"), t) })}`);
  lines.push(`- ${t("Logical size: {{value}}", { value: subject.logicalSize === null ? unknownText(t("the daemon did not report a logical size for this entry"), t) : t("{{display}} ({{bytes}} bytes)", { display: formatBytes(subject.logicalSize), bytes: subject.logicalSize }) })}`);
  lines.push(`- ${t("Exact identity (SHA-256): {{value}}", { value: identityText(subject, t) })}`);
  lines.push(`- ${t("Logical length: {{value}}", { value: lengthText(subject, t) })}`);
  lines.push(`- ${t("Protection outcome (daemon): {{value}}", { value: factText(subject.protection, t) })}`);
  lines.push(`- ${t("Exact representation: {{value}}", { value: representationSummary(subject.representation, t) })}`);
  const record = representationRecord(subject.representation, t);
  if (record) lines.push(`- ${t("Exact representation record: {{value}}", { value: record })}`);
  if (!subject.tagsReadable) {
    lines.push(`- ${t("User tags: {{value}}", { value: unknownText(subject.tagsReason || t("this subject's tags could not be read"), t) })}`);
  } else if (!subject.tags.length) {
    lines.push(`- ${t("User tags: {{value}}", { value: t("no user tags are recorded for this subject") })}`);
  } else {
    lines.push(`- ${t("User tags: {{value}}", { value: subject.tags.map(flat).filter(Boolean).join(", ") })}`);
  }
  if (!subject.notesReadable) {
    lines.push(`- ${t("Notes: {{value}}", { value: unknownText(subject.notesReason || t("this subject's notes could not be read"), t) })}`);
  } else if (!subject.notes.length) {
    lines.push(`- ${t("Notes: {{value}}", { value: t("no notes are recorded for this subject") })}`);
    if (subject.notesReason) lines.push(`  - ${t("Notes could not be read in full: {{reason}}", { reason: subject.notesReason })}`);
  } else {
    lines.push(`- ${t("Notes:")}`);
    for (const note of subject.notes) lines.push(...noteLines(note, locale, t));
    if (subject.notesReason) lines.push(`  - ${t("Notes could not be read in full: {{reason}}", { reason: subject.notesReason })}`);
  }
  if (subject.unreadableReason) lines.push(`- ${t("Not one read succeeded for this subject: {{reason}}", { reason: subject.unreadableReason })}`);
  lines.push("");
  return lines;
}

/**
 * Builds the document. The result is UTF-8 text with no trailing whitespace on
 * any line, no carriage returns, and exactly one trailing newline.
 */
export function buildSelectionReport(input: SelectionReportInput): string {
  const { generatedAt, locale, fromSearch, query, subjects, read, t } = input;
  const lines: string[] = [];
  const local = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(generatedAt);
  lines.push(`# ${t(SELECTION_REPORT_TITLE)}`, "");
  lines.push(`- ${t("Generated: {{local}} ({{utc}})", { local, utc: generatedAt.toISOString() })}`);
  lines.push(`- ${t("Selection source: {{source}}", { source: fromSearch ? t("search.query results for \"{{query}}\"", { query: flat(query) }) : t("the library listing (content.list)") })}`);
  lines.push(`- ${t("Selected subjects: {{count}}", { count: subjects.length })}`);
  lines.push(`- ${t("Read scope: {{operations}}", { operations: read.operations.join(", ") })}`);
  lines.push(`- ${t("Subjects read: {{read}} of {{total}}", { read: read.readCount, total: subjects.length })}`);
  lines.push(`- ${t("Subjects that could not be read: {{count}}", { count: read.failedCount })}`);
  lines.push(`- ${t("Subjects not read (this report reads at most {{cap}} subjects): {{count}}", { cap: read.subjectCap, count: read.skippedCount })}`);
  lines.push("");
  for (const subject of subjects) lines.push(...subjectSection(subject, locale, t));
  lines.push("---", "");
  lines.push(t("Built in this browser from the reads named above. A fact the daemon did not report is written as UNKNOWN with its reason. Nothing was uploaded and no daemon state was changed."));
  const trimmed = lines.map((line) => normalizeText(line).replace(/[ \t]+$/, ""));
  while (trimmed.length && trimmed[trimmed.length - 1] === "") trimmed.pop();
  return `${trimmed.join("\n")}\n`;
}
