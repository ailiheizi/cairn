import type { Translator } from "../i18n";
import { previewUnicodeText } from "../lib/format";
import type { SearchSegment } from "../lib/types";
import { CopyTextButton } from "./CopyTextButton";

export function MatchedSourceText({ t, segment }: { t: Translator; segment: SearchSegment }) {
  const previewSource = segment.matched_excerpt || segment.matched_text || "";
  const returnedText = segment.matched_text || segment.matched_excerpt || "";
  const preview = previewUnicodeText(previewSource, 280);
  const needsDisclosure = returnedText !== previewSource || Array.from(returnedText).length > 280;
  return <div className="matched-source-text">
    {preview.trim() ? <p>{preview}</p> : <p className="matched-source-empty">{t("This source segment was returned without a text excerpt.")}</p>}
    {needsDisclosure && <details className="matched-source-passage">
      <summary>{t("Read returned passage")}</summary>
      <p className="matched-source-passage-label">{t("Returned passage; this may not be the complete document.")}</p>
      <pre>{returnedText}</pre>
      <CopyTextButton text={returnedText} t={t} label="Copy passage" />
    </details>}
  </div>;
}
