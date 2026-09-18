// The WebUI browser E2E entry point.
//
// This file owns the phase dispatch and the order of the assertion phases, and
// nothing else: the Playwright plumbing lives in `scripts/e2e/harness.mjs`, the
// shared helpers in `scripts/e2e/support.mjs`, and each surface's assertions in
// `scripts/e2e/<surface>.mjs`. A surface agent adds assertions to its own
// module; the phases below only decide when a module runs.
//
// Phases (driven by scripts/web-e2e.sh):
//   online     the full flow against a live daemon
//   offline    the same page with every API route aborted
//   recovered  the page after the daemon restarts with the same catalog

import assert from "node:assert/strict";
import process from "node:process";
import { createHarness } from "./e2e/harness.mjs";
import { assertLibraryTiles, assertDetailsViewerNotesAndGuard, assertLibrarySortAndSelection } from "./e2e/library.mjs";
import { seedFixtureAndConnect, assertSourcePlanAndSave, assertSourcePreviewOnEnter, assertSourceSuggestionRecheck, assertSourcesView } from "./e2e/sources.mjs";
import { assertExportSidecarPolicy, assertRestoreDrawer, assertRestoreFromRecentDestination, assertRestoreUnknownOutcome, assertSelectedExport, assertViewExportWithVerifyRetry, assertDurableSavedViewsAfterReload } from "./e2e/drawers.mjs";
import { assertSearchResultSurface, assertSearchQueryReexecuted, assertSearchRecents } from "./e2e/search.mjs";
import { assertResponsiveLayout, assertNarrowDrawers, assertImageBundleInstallControl, assertOnlineProviderEgressControl } from "./e2e/settings.mjs";
import { assertOfflinePhase, assertRecoveredPhase } from "./e2e/session.mjs";
import { assertSearchOperators } from "./e2e/searchops.mjs";
import { assertDuplicateReview, assertSimilarityReview } from "./e2e/duplicates.mjs";
import { assertTagsSurface } from "./e2e/tags.mjs";
import { assertSelectionReport } from "./e2e/report.mjs";
import { assertStatusSurface } from "./e2e/status.mjs";
import { assertVerificationSurface } from "./e2e/verification.mjs";
import { assertActivitySurface } from "./e2e/activity.mjs";
import { assertDescriptionAction } from "./e2e/description.mjs";

const phase = process.argv[2] ?? "online";
const url = process.env.RESTOREWEAVE_WEB_E2E_URL ?? "http://127.0.0.1:5174/";
const sourcePath = process.env.RESTOREWEAVE_WEB_E2E_SOURCE;
const restoreDestination = process.env.RESTOREWEAVE_WEB_E2E_RESTORE_DEST;
const exportDestination = process.env.RESTOREWEAVE_WEB_E2E_EXPORT_DEST;
// CI and developer machines may already provide a managed browser (for
// example, the system Google Chrome) without a Playwright-downloaded binary.
// Keep the default unchanged, but allow the harness to point at that browser
// explicitly so a missing cache does not turn a real E2E run into a false skip.
const executablePath = process.env.RESTOREWEAVE_PLAYWRIGHT_EXECUTABLE_PATH?.trim();

const ctx = await createHarness({ url, executablePath });
try {
  if (phase === "offline") {
    await ctx.page.route("**/api/v1/**", (route) => route.abort());
  }
  await ctx.page.goto(url, { waitUntil: "networkidle" });
  if (phase === "offline") {
    await assertOfflinePhase(ctx);
  } else if (phase === "recovered") {
    await assertRecoveredPhase(ctx);
  } else {
    assert(sourcePath, "RESTOREWEAVE_WEB_E2E_SOURCE is required for online phase");
    assert(restoreDestination, "RESTOREWEAVE_WEB_E2E_RESTORE_DEST is required for online phase");
    assert(exportDestination, "RESTOREWEAVE_WEB_E2E_EXPORT_DEST is required for online phase");
    await assertOnline(ctx);
  }
} finally {
  await ctx.close();
}

async function assertOnline(ctx) {
  // Sources: the fixture, the first confirmed save, and the recheck paths.
  await seedFixtureAndConnect(ctx, { sourcePath });
  await assertSourcePlanAndSave(ctx, { sourcePath });
  await assertLibraryTiles(ctx);
  await assertSourcePreviewOnEnter(ctx, { sourcePath });
  await assertSourceSuggestionRecheck(ctx, { sourcePath });

  // The library: sorting, batch selection, the inspector, and the viewer.
  await assertLibrarySortAndSelection(ctx);
  await assertDetailsViewerNotesAndGuard(ctx);

  // Restore: planning, the sticky bar, the recent-destination chip, and the
  // unknown-outcome path.
  await assertRestoreDrawer(ctx);
  await assertRestoreFromRecentDestination(ctx);
  await assertRestoreUnknownOutcome(ctx);

  // Export: the selected result, the saved-view manifest, verification retry,
  // durable history, and the local recents list that never becomes a view.
  await assertSearchResultSurface(ctx);
  await assertSelectedExport(ctx);
  await assertSearchQueryReexecuted(ctx);
  await assertViewExportWithVerifyRetry(ctx);
  await assertDurableSavedViewsAfterReload(ctx);
  await assertSearchRecents(ctx);

  // The sources workspace view and the responsive boundaries.
  await assertSourcesView(ctx);
  await assertResponsiveLayout(ctx);
  await assertNarrowDrawers(ctx);

  // The surfaces added by the Tier-1 work, in the order they were declared:
  // the trusted status surface, then the verification report, then activity.
  // The viewport is restored so each surface is asserted at the desktop
  // layout.
  await ctx.page.setViewportSize({ width: 1280, height: 900 });
  await ctx.page.waitForTimeout(150);
  await assertStatusSurface(ctx);
  await assertSearchOperators(ctx);
  await assertDuplicateReview(ctx);
  await assertSimilarityReview(ctx);
  await assertTagsSurface(ctx);
  await assertSelectionReport(ctx);
  await assertExportSidecarPolicy(ctx);
  await assertImageBundleInstallControl(ctx);
  await assertOnlineProviderEgressControl(ctx);
  await assertVerificationSurface(ctx);
  await assertActivitySurface(ctx);
  await assertDescriptionAction(ctx);
}
