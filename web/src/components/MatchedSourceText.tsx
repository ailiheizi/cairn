import { useState } from "react";
import type { Translator } from "../i18n";
import { previewUnicodeText } from "../lib/format";
import type { SearchSegment } from "../lib/types";

export function MatchedSourceText({ t, segment }: { t: Translator; segment: SearchSegment }) {
  const [feedback, setFeedback] = useState("");
  const previewSource = segment.matched_excerpt || segment.matched_text || "";
  const returnedText = segment.matched_text || segment.matched_excerpt || "";
  const preview = previewUnicodeText(previewSource, 280);
  const needsDisclosure = returnedText !== previewSource || Array.from(returnedText).length > 280;
  async function copy() {
    if (!navigator.clipboard?.writeText) { setFeedback(t("Could not copy. Clipboard access is unavailable or was denied.")); return; }
    try {
      await navigator.clipboard.writeText(returnedText);
      setFeedback(t("Copied to clipboard."));
    } catch {
      setFeedback(t("Could not copy. Clipboard access is unavailable or was denied."));
    }
  }
  return <div className="matched-source-text">
    {preview.trim() ? <p>{preview}</p> : <p className="matched-source-empty">{t("This source segment was returned without a text excerpt.")}</p>}
    {needsDisclosure && <details className="matched-source-passage">
      <summary>{t("Read returned passage")}</summary>
      <p className="matched-source-passage-label">{t("Returned passage; this may not be the complete document.")}</p>
      <pre>{returnedText}</pre>
      <button type="button" className="text-button" onClick={() => void copy()} disabled={!returnedText}>{t("Copy passage")}</button>
      {feedback && <p role="status">{feedback}</p>}
    </details>}
  </div>;
}
