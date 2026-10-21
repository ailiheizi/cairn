import { useEffect, useMemo, useRef, useState } from "react";
import type { Translator } from "../i18n";
import { parseSearchQuery, SEARCH_PROTECTION_MODES } from "../lib/searchops";
import { removeVisualSearchFilter, rewriteVisualSearchFilter, visualFilterPredicates, VISUAL_SEARCH_TYPES } from "../lib/searchFilterBuilder";
import type { VisualSearchField } from "../lib/searchFilterBuilder";
import "./SearchFilterBuilder.css";

type TagChoice = { value: string; count: number };
type SizeMode = "minimum" | "maximum" | "between" | "exact";
type SizeUnit = "B" | "KB" | "MB" | "GB" | "TB";
const SIZE_UNITS: SizeUnit[] = ["B", "KB", "MB", "GB", "TB"];
const VISUAL_FIELDS: VisualSearchField[] = ["type", "suffix", "tag", "size", "mtime", "protection", "name", "path", "lang", "hash", "dup"];
const FIELD_LABEL: Record<VisualSearchField, string> = {
  type: "Content type", suffix: "File extension", tag: "Tag", size: "File size",
  mtime: "Recorded modification date", protection: "Recorded protection",
  name: "Filename or folder name", path: "Recorded source path", lang: "Recorded text language",
  hash: "Content hash", dup: "Duplicate status",
};
const ADVANCED_FIELDS: VisualSearchField[] = ["name", "path", "lang", "hash", "dup"];
const FIELD_LIMITATION: Partial<Record<VisualSearchField, string>> = {
  name: "Matches indexed name tokens or phrases, not arbitrary substrings.",
  path: "Matches indexed source-path tokens or phrases, not arbitrary substrings.",
  lang: "Matches one exact recorded language. Items without a recorded language do not match.",
  hash: "A complete SHA-256 value filters exactly; a prefix is checked over hits returned by another search and cannot run alone.",
  dup: "Duplicate (yes) uses the existing duplicate search when expressible; unique-only (no) needs another search condition and is checked over loaded results.",
};

function typeChoiceValue(value: string) {
  if (value === "REGULAR_FILE") return "regular_file";
  if (value === "DIRECTORY") return "directory";
  return value.toLowerCase();
}

function sizeParts(value: string) {
  const match = /^([<>])?\s*([0-9]+(?:\.[0-9]+)?)\s*(B|KB|MB|GB|TB)?$/i.exec(value.trim());
  if (!match) return null;
  return { bound: match[1], amount: match[2], unit: (match[3] ?? "B").toUpperCase() as SizeUnit };
}

function protectionLabel(mode: string, t: Translator) {
  switch (mode) {
    case "STORE_EXACT": return t("Stored original");
    case "STORE_EXACT_WITH_EXTERNAL_FALLBACK": return t("Stored original + external fallback");
    case "LINK_ONLY": return t("Link only (unprotected)");
    case "METADATA_ONLY": return t("Metadata only");
    default: return mode;
  }
}

export function SearchFilterBuilder({ t, query, tagVocabulary, onQueryChange, disabled }: {
  t: Translator;
  query: string;
  tagVocabulary: TagChoice[];
  onQueryChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [field, setField] = useState<VisualSearchField>("type");
  const [replaceIndex, setReplaceIndex] = useState("");
  const [replaceRaw, setReplaceRaw] = useState("");
  const [value, setValue] = useState("");
  const [sizeMode, setSizeMode] = useState<SizeMode>("minimum");
  const [sizeFrom, setSizeFrom] = useState("");
  const [sizeTo, setSizeTo] = useState("");
  const [sizeFromUnit, setSizeFromUnit] = useState<SizeUnit>("MB");
  const [sizeToUnit, setSizeToUnit] = useState<SizeUnit>("MB");
  const [dateBoundary, setDateBoundary] = useState<"before" | "after">("before");
  const [message, setMessage] = useState("");
  const appliedQueryRef = useRef("");
  const existing = useMemo(() => visualFilterPredicates(query, field), [query, field]);
  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const visiblePredicates = useMemo(() => parsed.predicates.map((predicate, index) => ({ predicate, index })), [parsed]);

  useEffect(() => {
    setReplaceIndex("");
    setReplaceRaw("");
    setValue("");
    setSizeMode("minimum");
    setSizeFrom("");
    setSizeTo("");
    setSizeFromUnit("MB");
    setSizeToUnit("MB");
    setDateBoundary("before");
    if (appliedQueryRef.current === query) appliedQueryRef.current = "";
    else setMessage("");
  }, [query]);

  function resetEditor() {
    setReplaceIndex("");
    setReplaceRaw("");
    setValue("");
    setSizeMode("minimum");
    setSizeFrom("");
    setSizeTo("");
    setSizeFromUnit("MB");
    setSizeToUnit("MB");
    setDateBoundary("before");
    setMessage("");
  }

  function changeField(nextField: VisualSearchField) {
    setField(nextField);
    resetEditor();
  }

  function setSizeValue(currentValue: string) {
    const range = currentValue.split("..", 2);
    if (range.length === 2) {
      const lower = sizeParts(range[0]);
      const upper = sizeParts(range[1]);
      setSizeMode("between");
      setSizeFrom(lower?.amount ?? "");
      setSizeFromUnit(lower?.unit ?? "MB");
      setSizeTo(upper?.amount ?? "");
      setSizeToUnit(upper?.unit ?? "MB");
      return;
    }
    const part = sizeParts(currentValue);
    if (!part) return;
    setSizeFrom(part.amount);
    setSizeFromUnit(part.unit);
    setSizeTo(part.amount);
    setSizeToUnit(part.unit);
    if (part.bound === ">") setSizeMode("minimum");
    else if (part.bound === "<") setSizeMode("maximum");
    else setSizeMode("exact");
  }

  function changeTarget(target: string) {
    setReplaceIndex(target);
    setMessage("");
    if (!target) {
      setReplaceRaw(""); setValue("");
      setSizeMode("minimum"); setSizeFrom(""); setSizeTo("");
      setSizeFromUnit("MB"); setSizeToUnit("MB"); setDateBoundary("before");
      return;
    }
    const index = Number(target);
    const found = existing.find((item) => item.index === index);
    setReplaceRaw(found?.predicate.raw ?? "");
    const currentValue = found?.predicate.value ?? "";
    if (field === "type") setValue(typeChoiceValue(currentValue));
    else if (field === "size") setSizeValue(currentValue);
    else if (field === "mtime") {
      const match = /^([<>])\s*(\d{4}-\d{2}-\d{2})$/.exec(currentValue.trim());
      setDateBoundary(match?.[1] === ">" ? "after" : "before");
      setValue(match?.[2] ?? "");
    } else setValue(currentValue);
  }

  function buildValue() {
    if (field === "size") {
      const from = `${sizeFrom.trim()}${sizeFromUnit}`;
      const to = `${sizeTo.trim()}${sizeToUnit}`;
      if (sizeMode === "minimum") return `>${from}`;
      if (sizeMode === "maximum") return `<${from}`;
      if (sizeMode === "between") return `${from}..${to}`;
      return from;
    }
    if (field === "mtime") return `${dateBoundary === "before" ? "<" : ">"}${value}`;
    return value;
  }

  function canApply() {
    if (disabled || !buildValue().trim()) return false;
    if (field === "size") return sizeMode === "between" ? Boolean(sizeFrom.trim() && sizeTo.trim()) : Boolean(sizeFrom.trim());
    if (field === "mtime" && (!value.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(value))) return false;
    if (field === "tag" && !tagVocabulary.some((tag) => tag.value === value) && !existing.some(({ predicate }) => predicate.value === value)) return false;
    return true;
  }

  function apply() {
    const result = rewriteVisualSearchFilter(query, {
      field,
      value: buildValue(),
      ...(replaceIndex ? { replaceIndex: Number(replaceIndex), expectedRaw: replaceRaw } : {}),
    });
    if (!result.ok) { setMessage(t(result.reason)); return; }
    appliedQueryRef.current = result.query;
    onQueryChange(result.query);
    setMessage(t("Filter added to the search text. Select Search when you are ready."));
    setReplaceIndex("");
    setReplaceRaw("");
    setValue("");
    setSizeMode("minimum");
    setSizeFrom("");
    setSizeTo("");
  }

  function remove(index: number, raw: string) {
    const result = removeVisualSearchFilter(query, { predicateIndex: index, expectedRaw: raw });
    if (!result.ok) { setMessage(t(result.reason)); return; }
    appliedQueryRef.current = result.query;
    onQueryChange(result.query);
    setMessage(t("Condition removed from the search text. Select Search when you are ready."));
  }

  function predicateName(operator: string) {
    return t(FIELD_LABEL[operator as VisualSearchField] ?? "Condition");
  }

  return <details className="search-filter-builder" onKeyDown={(event) => { if (event.key === "Enter" && event.target instanceof HTMLElement && event.target.matches("input, select")) event.preventDefault(); }}>
    <summary>{t("Filter conditions")}</summary>
    <div className="search-filter-builder-panel">
      <p>{t("Choose one condition to add or update. Applying changes the search text only; select Search to run it.")}</p>
      {(visiblePredicates.length > 0 || parsed.errors.length > 0) && <section className="search-filter-active" aria-label={t("Conditions in this search text")}>
        <h3>{t("Conditions in this search text")}</h3>
        {visiblePredicates.length > 0 && <ul>
          {visiblePredicates.map(({ predicate, index }) => {
            const label = predicate.operator === "protection" ? protectionLabel(predicate.value, t) : predicate.raw;
            return <li key={`${index}:${predicate.raw}`}>
              <span><strong>{predicateName(predicate.operator)}</strong><code>{predicate.raw}</code>{predicate.negated && <small>{t("Negative condition; remove only if intended")}</small>}</span>
              <button type="button" disabled={disabled} aria-label={t("Remove {{condition}}", { condition: label })} onClick={() => remove(index, predicate.raw)}>{t("Remove")}</button>
            </li>;
          })}
        </ul>}
        {parsed.errors.length > 0 && <ul className="search-filter-invalid-list" aria-label={t("Conditions that need attention")}>
          {parsed.errors.map((error, index) => <li key={`${error.raw}:${index}`}><span><strong>{t("Needs attention")}</strong><code>{error.raw}</code><small>{t(error.message, error.values)}</small></span></li>)}
        </ul>}
      </section>}
      <div className="search-filter-builder-fields">
        <label>
          <span>{t("Condition")}</span>
          <select aria-label={t("Condition")} value={field} disabled={disabled} onChange={(event) => changeField(event.target.value as VisualSearchField)}>
            {VISUAL_FIELDS.filter((option) => !ADVANCED_FIELDS.includes(option)).map((option) => <option key={option} value={option}>{t(FIELD_LABEL[option])}</option>)}
            <optgroup label={t("Advanced conditions")}>
              {ADVANCED_FIELDS.map((option) => <option key={option} value={option}>{t(FIELD_LABEL[option])}</option>)}
            </optgroup>
          </select>
        </label>
        {existing.length > 0 && <label>
          <span>{t("Add or update")}</span>
          <select aria-label={t("Add or update")} value={replaceIndex} disabled={disabled} onChange={(event) => changeTarget(event.target.value)}>
            <option value="">{t("Add another condition")}</option>
            {existing.map(({ predicate, index }) => {
              const typeValue = typeChoiceValue(predicate.value);
              const typeOption = predicate.operator === "type" ? VISUAL_SEARCH_TYPES.find((option) => option.value === typeValue) : undefined;
              const label = typeOption ? t(typeOption.label) : predicate.operator === "type" ? t("Current type: {{value}}", { value: predicate.value }) : predicate.raw;
              return <option key={`${index}:${predicate.raw}`} value={String(index)}>{t("Update: {{value}}", { value: label })}</option>;
            })}
          </select>
        </label>}
        <label className="search-filter-value-control">
          <span>{t(FIELD_LABEL[field])}</span>
          {FIELD_LIMITATION[field] && <small>{t(FIELD_LIMITATION[field]!)}</small>}
          {field === "type" ? <select aria-label={t("Content type")} value={value} disabled={disabled} onChange={(event) => { setValue(event.target.value); setMessage(""); }}>
            <option value="">{t("Choose a type")}</option>
            {value && !VISUAL_SEARCH_TYPES.some((option) => option.value === value) && <option value={value}>{t("Current type: {{value}}", { value })}</option>}
            {VISUAL_SEARCH_TYPES.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
          </select> : field === "tag" ? <select aria-label={t("Existing tag")} value={value} disabled={disabled || tagVocabulary.length === 0} onChange={(event) => { setValue(event.target.value); setMessage(""); }}>
            <option value="">{tagVocabulary.length ? t("Choose a tag") : t("No existing tags are available")}</option>
            {value && !tagVocabulary.some((tag) => tag.value === value) && <option value={value}>{value}</option>}
            {tagVocabulary.map((tag) => <option key={tag.value} value={tag.value}>{tag.value} · {tag.count}</option>)}
          </select> : field === "suffix" ? <input aria-label={t("File extension")} value={value} disabled={disabled} autoComplete="off" placeholder={t("For example: jpg")} onChange={(event) => { setValue(event.target.value); setMessage(""); }} />
            : field === "size" ? <>
              <select aria-label={t("Size comparison")} value={sizeMode} disabled={disabled} onChange={(event) => { setSizeMode(event.target.value as SizeMode); setMessage(""); }}>
                <option value="minimum">{t("At least")}</option><option value="maximum">{t("At most")}</option>
                <option value="between">{t("Between")}</option><option value="exact">{t("Exactly")}</option>
              </select>
              <div className={`search-filter-size-fields${sizeMode === "between" ? " is-range" : ""}`}>
                <input aria-label={t(sizeMode === "between" ? "Minimum size" : "Size amount")} inputMode="decimal" value={sizeFrom} disabled={disabled} onChange={(event) => { setSizeFrom(event.target.value); setMessage(""); }} />
                <select aria-label={t("Size unit")} value={sizeFromUnit} disabled={disabled} onChange={(event) => { setSizeFromUnit(event.target.value as SizeUnit); setMessage(""); }}>{SIZE_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select>
                {sizeMode === "between" && <><span aria-hidden="true">–</span><input aria-label={t("Maximum size")} inputMode="decimal" value={sizeTo} disabled={disabled} onChange={(event) => { setSizeTo(event.target.value); setMessage(""); }} /><select aria-label={t("Maximum size unit")} value={sizeToUnit} disabled={disabled} onChange={(event) => { setSizeToUnit(event.target.value as SizeUnit); setMessage(""); }}>{SIZE_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></>}
              </div>
              <small>{t("Size bounds include the boundary. KB, MB, GB and TB use powers of 1024.")}</small>
            </> : field === "mtime" ? <>
              <select aria-label={t("Modification date boundary")} value={dateBoundary} disabled={disabled} onChange={(event) => { setDateBoundary(event.target.value as "before" | "after"); setMessage(""); }}>
                <option value="before">{t("Before (exclusive UTC midnight)")}</option><option value="after">{t("After (exclusive UTC midnight)")}</option>
              </select>
              <input aria-label={t("Modification date")} type="date" value={value} disabled={disabled} onChange={(event) => { setValue(event.target.value); setMessage(""); }} />
              <small>{t("Uses the recorded modification time at exclusive UTC midnight; it is not a capture date.")}</small>
            </> : field === "dup" ? <select aria-label={t("Duplicate status")} value={value} disabled={disabled} onChange={(event) => { setValue(event.target.value); setMessage(""); }}>
              <option value="">{t("Choose duplicate status")}</option><option value="yes">{t("Has exact-identity duplicates")}</option><option value="no">{t("No duplicate in loaded results")}</option>
            </select> : field === "name" || field === "path" || field === "lang" || field === "hash" ? <input aria-label={t(FIELD_LABEL[field])} value={value} disabled={disabled} autoComplete="off" placeholder={t(field === "hash" ? "Enter a SHA-256 value or prefix" : field === "lang" ? "For example: zh-Hans" : field === "path" ? "For example: research/notes" : "For example: meeting notes")} onChange={(event) => { setValue(event.target.value); setMessage(""); }} /> : <>
              <select aria-label={t("Protection mode")} value={value} disabled={disabled} onChange={(event) => { setValue(event.target.value); setMessage(""); }}>
                <option value="">{t("Choose a recorded protection mode")}</option>
                {SEARCH_PROTECTION_MODES.map((mode) => <option key={mode.value} value={mode.value}>{protectionLabel(mode.value, t)}</option>)}
              </select>
              <small>{t("Stored original also includes stored originals with an external fallback.")}</small>
            </>}
        </label>
        <button type="button" className="search-filter-apply" onClick={apply} disabled={!canApply()}>{t(replaceIndex ? "Update condition" : "Apply filter")}</button>
      </div>
      {parsed.errors.length > 0 && <p className="search-filter-message" role="alert">{t("The current search could not be read. Fix its visible condition before using visual filters.")}</p>}
      {message && <p className="search-filter-message" role="status">{message}</p>}
    </div>
  </details>;
}
