import type { Translator } from "../i18n";
import { decodeSavedRetrievalTagField } from "./savedRetrievalCandidate";
import { formatBytes, formatEntryType } from "./format";

export type SavedRetrievalConditionRow =
  | { label: string; value: string; raw?: never; unlabelled?: never }
  | { raw: string; unlabelled: true; label?: never; value?: never };

const FIELD_LABELS: Record<string, string> = {
  entry_type: "Type",
  content_id: "Exact content identity",
  duplicate_group: "Duplicate group",
  protection_mode: "Protection mode",
  suffix: "Format",
  language: "Language",
  size_min: "Minimum size",
  size_max: "Maximum size",
  mtime_after: "Modified after",
  mtime_before: "Modified before",
};

function formatConditionValue(key: string, value: string, t: Translator): string {
  if ((key === "size_min" || key === "size_max") && Number.isFinite(Number(value))) return formatBytes(Number(value));
  if (key === "entry_type") return formatEntryType(value, t);
  if ((key === "mtime_after" || key === "mtime_before") && Number.isFinite(Number(value))) {
    const date = new Date(Number(value));
    if (!Number.isNaN(date.valueOf())) return date.toLocaleString();
  }
  if (key === "protection_mode") return value.replaceAll("_", " ");
  return value;
}

/** Project the existing SavedView field encoding into the shared user-facing condition rows. */
export function projectSavedRetrievalConditions(fields: string[] = [], t: Translator): SavedRetrievalConditionRow[] {
  return fields.map((field) => {
    const tagValue = decodeSavedRetrievalTagField(field);
    if (tagValue !== undefined) return { label: t("Tag"), value: tagValue };
    const separator = field.indexOf("=");
    if (separator < 0) return { raw: field, unlabelled: true };
    const key = field.slice(0, separator);
    const label = FIELD_LABELS[key];
    if (!label) return { raw: field, unlabelled: true };
    return { label: t(label), value: formatConditionValue(key, field.slice(separator + 1), t) };
  });
}
