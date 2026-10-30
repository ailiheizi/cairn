import { ArrowUpRight, FileText, Film, Folder, Image, Music2 } from "lucide-react";
import type { Translator } from "../../i18n";
import type { SearchHit } from "../../lib/types";
import { formatFacetValue, mediaClassFromSuffix, searchSegmentSourceLabel } from "../../lib/format";

const snippet = (text: string | undefined, limit: number) => Array.from(text || "").slice(0, limit).join("");

/** Bounded projection of broker evidence, with no content reads of its own. */
export function FloatingSearchResults({ t, hits, picked, disabled, entryHint, onPick, onOpen }: {
  t: Translator; hits: SearchHit[]; picked: number[]; disabled: boolean;
  entryHint?: (hit: SearchHit) => string | undefined;
  onPick: (index: number, checked: boolean) => void; onOpen: (hit: SearchHit) => void;
}) {
  return <ul className="space-assistant-hits">{hits.map((hit, index) => {
    const media = mediaClassFromSuffix(formatFacetValue(hit));
    const Icon = hit.entry_type === "DIRECTORY" ? Folder : media === "image" ? Image : media === "audio" ? Music2 : media === "video" ? Film : FileText;
    const segments = hit.segments || [];
    const preview = segments.map(segment => segment.matched_excerpt || segment.matched_text || "").find(text => text.trim() && text.trim() !== hit.name?.trim() && !/^[\s]*[\[{]/.test(text));
    const hint = entryHint?.(hit);
    return <li key={`${hit.entry_id || hit.subject_ref}:${index}`}>
      {hit.entry_type === "REGULAR_FILE" && <input type="checkbox" disabled={disabled} aria-label={t("Select {{name}}", { name: hit.name || t("Untitled material") })} checked={picked.includes(index)} onChange={event => onPick(index, event.target.checked)} />}
      <div className="space-assistant-hit-body"><button type="button" disabled={disabled} onClick={() => onOpen(hit)}><Icon size={17} /><span>{hit.name || t("Untitled material")}{preview && <small>{snippet(preview, 220)}</small>}{hint && <small className="space-assistant-hit-destination">{hint}</small>}</span><ArrowUpRight size={14} /></button>
        {segments.length > 0 && <details className="space-assistant-match"><summary>{t("Why this matched")}</summary>{segments.slice(0, 3).map((segment, position) => <div key={position}><strong>{searchSegmentSourceLabel(segment, t)}</strong><p>{snippet(segment.matched_excerpt || segment.matched_text, 900) || t("No matched excerpt was reported.")}</p></div>)}{segments.length > 3 && <small>{t("More match details are available in item details.")}</small>}</details>}
      </div>
    </li>;
  })}</ul>;
}
