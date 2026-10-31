import { useEffect, useRef, useState } from "react";
import type { Translator } from "../i18n";

export function CopyTextButton({ text, t, label }: { text: string; t: Translator; label: string }) {
  const [feedback, setFeedback] = useState("");
  const request = useRef(0);
  useEffect(() => {
    request.current++;
    setFeedback("");
    return () => { request.current++; };
  }, [text]);
  async function copy() {
    const token = ++request.current;
    if (!navigator.clipboard?.writeText) { if (request.current === token) setFeedback(t("Could not copy. Clipboard access is unavailable or was denied.")); return; }
    try {
      await navigator.clipboard.writeText(text);
      if (request.current === token) setFeedback(t("Copied to clipboard."));
    } catch {
      if (request.current === token) setFeedback(t("Could not copy. Clipboard access is unavailable or was denied."));
    }
  }
  return <span className="copy-text-control"><button type="button" className="text-button" disabled={!text} onClick={() => void copy()}>{t(label)}</button>{feedback && <span role="status">{feedback}</span>}</span>;
}
