// Browser harness for the WebUI E2E run.
//
// This module owns the Playwright plumbing only: the browser, the page, the
// `request`/`response` listeners that capture what the daemon actually
// returned, and the mutable capture state the surface modules assert against.
// It performs no assertion of its own.
//
// `scripts/web-e2e.mjs` creates one harness per phase (online / offline /
// recovered) and passes it to the surface assertion modules in
// `scripts/e2e/<surface>.mjs`, in the documented order.

const playwrightModule = process.env.CAIRN_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(playwrightModule);

/**
 * @param {{ url: string, executablePath?: string, headless?: boolean }} options
 */
export async function createHarness({ url, executablePath, headless = true }) {
  const browser = await chromium.launch({ headless, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const button = (name) => page.getByRole("button", { name });
  const text = (pattern) => page.getByText(pattern);
  // The paths the harness received from the shell script. Surface modules use
  // them to write their own fixture files and destinations.
  const sourcePath = process.env.CAIRN_WEB_E2E_SOURCE;
  const restoreDestination = process.env.CAIRN_WEB_E2E_RESTORE_DEST;
  const exportDestination = process.env.CAIRN_WEB_E2E_EXPORT_DEST;

  // Capture state. Everything here is filled from the daemon's own traffic, so
  // a surface module can assert against what was returned or received instead
  // of a client-side guess.
  const state = {
    viewExportApplyRequests: 0,
    injectedViewVerifyFailure: false,
    delayNextViewPlan: false,
    nextDialogAction: "dismiss",
    // The library tiles are counted from the browser's own requests: a tile
    // that shows only a glyph and a name must issue no content read at all,
    // while an image tile may read bytes for its thumbnail.
    contentOpenEntryIDs: [],
    entryNames: new Map(),
    // The latest content.list rows exactly as the daemon returned them, so a
    // surface module can assert a browser-local projection (like the space
    // report's byte total) against the real payload instead of a guess.
    contentListItems: [],
    lastSearchHitNames: [],
    lastPlanSubjects: undefined,
    lastFrozenManifest: undefined,
  };

  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/command")) return;
    let payload;
    try { payload = request.postDataJSON(); } catch { return; }
    if (payload?.operation === "content.open") {
      state.contentOpenEntryIDs.push(String(payload.input?.entry_id ?? payload.input?.subject_ref ?? ""));
      return;
    }
    if (payload?.operation === "export.plan" && Array.isArray(payload.input?.subjects)) state.lastPlanSubjects = payload.input.subjects.slice();
  });
  page.on("response", async (response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/v1/command")) return;
    let request;
    try { request = response.request().postDataJSON(); } catch { return; }
    if (request?.operation === "search.query") {
      let body;
      try { body = await response.json(); } catch { return; }
      state.lastSearchHitNames.length = 0;
      for (const hit of body?.data?.hits ?? []) state.lastSearchHitNames.push(String(hit.name ?? ""));
      return;
    }
    if (request?.operation !== "content.list") return;
    let body;
    try { body = await response.json(); } catch { return; }
    state.contentListItems = body?.data?.items ?? [];
    for (const item of body?.data?.items ?? []) state.entryNames.set(String(item.entry_id ?? ""), String(item.name ?? ""));
  });

  const context = { browser, page, button, text, state, url, sourcePath, restoreDestination, exportDestination, close: () => browser.close() };
  return context;
}
