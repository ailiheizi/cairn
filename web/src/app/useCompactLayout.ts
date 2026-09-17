import { useEffect, useState } from "react";

// The one browser-width boundary the shell and the stylesheets share.
//
// Below it the workspace rail is not rendered inline: the topbar carries one
// compact button that opens the same rail as a modal panel. This is a
// projection of the viewport, never a stored preference, and it asks the
// browser the same question the stylesheet asks (`max-width: 640px`), so the
// rendered tree and the cascade cannot disagree about where the boundary is.

const COMPACT_QUERY = "(max-width: 640px)";

export function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return compact;
}
