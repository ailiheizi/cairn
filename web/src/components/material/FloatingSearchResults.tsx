import { ArrowUpRight, FileText, Film, Folder, Image, Music2 } from "lucide-react";
import type { Translator } from "../../i18n";
import type { SearchHit } from "../../lib/types";
import { formatFacetValue, mediaClassFromSuffix, searchSegmentSourceLabel } from "../../lib/format";
import { searchOcrEvidence } from "../../lib/ocrSearchEvidence";

const snippet = (text: string | undefined, limit: number) => Array.from(text || "").slice(0, limit).join("");

/** Bounded projection of broker evidence, with no content reads of its own. */
export function FloatingSearchResults({ t, hits, picked, disabled, entryHint, onPick, onOpen, onInspect }: {
  t: Translator; hits: SearchHit[]; picked: number[]; disabled: boolean;
  entryHint?: (hit: SearchHit) => string | undefined;
  onPick: (index: number, checked: boolean) => void; onOpen: (hit: SearchHit) => void; onInspect?: (hit: SearchHit) => void;
}) {
  return <ul className="space-assistant-hits">{hits.map((hit, index) => {
    const media = mediaClassFromSuffix(formatFacetValue(hit));
    const Icon = hit.entry_type === "DIRECTORY" ? Folder : media === "image" ? Image : media === "audio" ? Music2 : media === "video" ? Film : FileText;
    const segments = hit.segments || [];
    const imageHit = media === "image";
    const evidenceRows = segments.map(segment => ({ segment, ocr: searchOcrEvidence(segment) }))
      .filter(row => !(imageHit && row.segment.source_type === "ARTIFACT" && row.segment.kind === "EXTRACT" && !row.ocr));
    const chosen = new Map<string, typeof evidenceRows[number]>();
    for (const row of evidenceRows) {
      const key = row.segment.source_id?.trim();
      if (!key || !row.ocr) continue;
      const prior = chosen.get(key);
      if (!prior || (prior.ocr?.returnedFragment && !row.ocr.returnedFragment) || (prior.ocr?.returnedFragment === row.ocr.returnedFragment && row.ocr.text.length > (prior.ocr?.text.length ?? 0))) chosen.set(key, row);
    }
    const visibleRows = evidenceRows.filter(row => {
      const key = row.segment.source_id?.trim();
      return !key || !row.ocr || chosen.get(key) === row;
    });
    const preview = visibleRows.map(({ segment }) => {
      const ocr = searchOcrEvidence(segment);
      if (ocr) return ocr.text;
      const text = segment.matched_excerpt || segment.matched_text || "";
      return /^[\s]*[\[{]/.test(text) ? "" : text;
    }).find(text => text.trim() && text.trim() !== hit.name?.trim());
    const hint = entryHint?.(hit);
    return <li key={`${hit.entry_id || hit.subject_ref}:${index}`}>
      {hit.entry_type === "REGULAR_FILE" && <input type="checkbox" disabled={disabled} aria-label={t("Select {{name}}", { name: hit.name || t("Untitled material") })} checked={picked.includes(index)} onChange={event => onPick(index, event.target.checked)} />}
      <div className="space-assistant-hit-body"><button type="button" disabled={disabled} onClick={() => onOpen(hit)}><Icon size={17} /><span>{hit.name || t("Untitled material")}{preview && <small>{snippet(preview, 220)}</small>}{hint && <small className="space-assistant-hit-destination">{hint}</small>}</span><ArrowUpRight size={14} /></button>
        {segments.length > 0 && <details className="space-assistant-match"><summary>{t("Why this matched")}</summary>{visibleRows.length ? visibleRows.slice(0, 3).map(({ segment, ocr }, position) => {
          const stateLabel = ocr?.state === "TEXT" ? t("Text recognized")
            : ocr?.state === "PARTIAL" ? t("Partially recognized")
              : ocr?.state === "EMPTY" ? t("No text recognized")
                : ocr?.state === "UNKNOWN" ? t("Recognition state unknown") : undefined;
          const raw = segment.matched_excerpt || segment.matched_text || "";
          const passage = ocr ? ocr.text : /^[\s]*[\[{]/.test(raw) ? "" : raw;
          return <div key={position}><strong>{searchSegmentSourceLabel(segment, t)}</strong>{stateLabel && <small>{stateLabel}</small>}<p>{snippet(passage, 900) || t("No matched excerpt was reported.")}</p>{ocr?.returnedFragment && <small>{t("Showing a returned text fragment.")}</small>}</div>;
        }) : <p>{t("No readable excerpt is available for this source.")}</p>}{(visibleRows.length > 3 || segments.length > visibleRows.length) && <small>{t("More match details are available in item details.")}</small>}{onInspect && <button type="button" className="text-button" disabled={disabled} onClick={() => onInspect(hit)}>{t("View match details")}</button>}</details>}
      </div>
    </li>;
  })}</ul>;
}
