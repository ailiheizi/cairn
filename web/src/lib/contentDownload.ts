import { endpoints } from "./operations";

// Let the browser own the response stream and download lifecycle. The route
// returns a structured visible error before attachment headers on refusal.
export function downloadOriginal(workspaceID: string, entryID: string, filename: string): void {
  const query = new URLSearchParams({ workspace_id: workspaceID, entry_id: entryID, filename });
  const anchor = document.createElement("a");
  anchor.href = `${endpoints.download}?${query.toString()}`;
  // Without an explicit `download` attribute, a synthetic click on a same-tab
  // anchor can be treated as a plain navigation instead of a download trigger
  // on some mobile/narrow-viewport browsers, even though the response already
  // sends `Content-Disposition: attachment`. Setting it forces download
  // semantics consistently, matching the ZIP takeout anchor in
  // useOriginalTakeout.ts.
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
