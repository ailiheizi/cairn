// Assertions for the sources surface and the add/recheck source drawer.
//
// Owner: the sources surface (components/SourcesSurface.tsx,
// components/SourceDrawer.tsx, app/useSources.ts). The functions here run in
// the online phase from scripts/web-e2e.mjs; they keep the original assertion
// statements and order and may be extended, never weakened.

import assert from "node:assert/strict";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoHorizontalOverflow, assertStickyBarInView } from "./support.mjs";

const COMMAND_PATH = "/api/v1/command";
const isCommandRequest = (request) => request.method() === "POST" && request.url().endsWith(COMMAND_PATH);
const operationOf = (request) => {
  try { return request.postDataJSON()?.operation ?? ""; } catch { return ""; }
};

// The change summary is a daemon fact, so the assertions below compare what the
// card rendered with the `snapshot.diff` answer this page actually received.
// The listeners are module-local: they cannot disturb another surface's
// capture state.
function captureRestoreReads(ctx) {
  const captured = { snapshotLists: [], diffs: [], diffInputs: [], diffRequests: 0 };
  const onRequest = (request) => {
    if (!isCommandRequest(request) || operationOf(request) !== "snapshot.diff") return;
    captured.diffRequests += 1;
    try { captured.diffInputs.push(request.postDataJSON()?.input ?? {}); } catch { captured.diffInputs.push({}); }
  };
  const onResponse = async (response) => {
    if (!isCommandRequest(response.request())) return;
    const operation = operationOf(response.request());
    if (operation !== "snapshot.list" && operation !== "snapshot.diff") return;
    let body;
    try { body = await response.json(); } catch { return; }
    if (operation === "snapshot.list") captured.snapshotLists.push(body);
    if (operation === "snapshot.diff") captured.diffs.push(body);
  };
  ctx.page.on("request", onRequest);
  ctx.page.on("response", onResponse);
  return { captured, stop: () => { ctx.page.off("request", onRequest); ctx.page.off("response", onResponse); } };
}

const normalizeLocator = (value) => String(value ?? "").trim().replace(/\/{2,}/g, "/").replace(/\/+$/, "");

// The three counts the card renders, derived from the daemon's own items the
// same way the surface groups the daemon's kinds: added, removed, and every
// other recorded change kind.
const daemonCounts = (changes) => changes.reduce((counts, change) => {
  const kind = String(change?.kind ?? "");
  if (kind === "added") counts.added += 1;
  else if (kind === "removed") counts.removed += 1;
  else counts.changed += 1;
  return counts;
}, { added: 0, removed: 0, changed: 0 });

const openSourcesView = async (ctx) => {
  await ctx.page.locator(".workspace-nav-item").filter({ hasText: /^(来源|Sources)/ }).click();
  await ctx.page.locator(".sources-surface .source-card").first().waitFor({ state: "visible", timeout: 15000 });
};
// The shell's refresh ends by reloading the library projection, which returns
// the window to the library view. The reload is awaited (its own read is the
// library projection) before the sources view is re-opened, so the refresh can
// never close the view under the assertion that follows it.
const reloadSourcesView = async (ctx) => {
  const settled = ctx.page.waitForResponse((response) => isCommandRequest(response.request()) && operationOf(response.request()) === "content.list", { timeout: 30000 });
  await ctx.page.getByRole("button", { name: /Refresh service status|刷新服务状态/ }).click();
  await settled;
  await ctx.page.waitForFunction(() => document.querySelector(".sources-surface") === null, null, { timeout: 15000 });
  await openSourcesView(ctx);
};
const changeStateReached = (ctx, state, timeout = 20000) => ctx.page.waitForFunction(
  (target) => document.querySelector(".source-changes")?.getAttribute("data-change-state") === target,
  state,
  { timeout },
);

// "What changed since the previous restore point" on the sources view: the
// daemon's own comparison between a source's two newest restore points, the
// honest single-point/unverified/unavailable states, and the bounded detail.
export async function assertSourceChangeSummary(ctx) {
  const { page } = ctx;
  const sourcePath = ctx.sourcePath;
  const contentColumn = page.locator(".content-column");
  const card = contentColumn.locator(".sources-surface .source-card").first();
  const observation = captureRestoreReads(ctx);
  const { captured } = observation;
  // The daemon's own command adapter, used only to publish the restore points
  // this comparison needs. The surface itself never performs these writes; the
  // fixture file is added and removed again so the library these later phases
  // assert is exactly the three subjects they were written against.
  const daemonCommand = async (operation, input) => {
    const response = await page.request.post(new URL(COMMAND_PATH, ctx.url).toString(), { data: { operation, input } });
    assert.ok(response.ok(), `${operation} must answer over the local adapter: ${response.status()}`);
    const body = await response.json();
    assert.equal(body.status, "SUCCEEDED", `${operation} must succeed: ${JSON.stringify(body.reasons ?? [])}`);
    return body.data ?? {};
  };
  const publish = async () => {
    const plan = await daemonCommand("plan.ingest", { root: sourcePath });
    assert.equal(plan.executable, true, `the fixture plan must be executable: ${JSON.stringify(plan.blocked_entries ?? [])}`);
    const applied = await daemonCommand("plan.apply", { workspace_id: plan.workspace_id, plan_id: plan.plan_id, plan_digest: plan.plan_digest });
    assert.equal(applied.already_applied, false, "each fixture plan must publish its own restore point");
    assert.equal(applied.state, "SUCCEEDED", `the restore point must be published: ${JSON.stringify(applied)}`);
  };
  try {
    // 1. One restore point is published, so there is nothing to compare
    // against yet. That is not the claim "no changes", and the surface must
    // issue no comparison read at all.
    await card.waitFor({ state: "visible", timeout: 15000 });
    await changeStateReached(ctx, "SINGLE_POINT", 15000);
    const single = card.locator('.source-changes[data-change-state="SINGLE_POINT"]');
    const singleText = (await single.innerText()).trim();
    assert.match(singleText, /nothing to compare|没有可比较的对象/, `one restore point must read as "nothing to compare yet": ${singleText}`);
    assert.doesNotMatch(singleText, /\d+ added|no differences|没有差异/, `one restore point must not read as "no changes": ${singleText}`);
    assert.equal(ctx.state.sourceDiffRequests, 0, "a source with one restore point must issue no snapshot.diff call for the whole run");
    assert.equal(captured.diffRequests, 0, "no snapshot.diff call may be made in the window this surface was observed");
    // The newest restore point has no receipt in this run, and the card says
    // so instead of implying the comparison is verified.
    const singleVerification = single.locator(".source-changes-verification");
    assert.equal(await singleVerification.getAttribute("data-verification-state"), "UNRECORDED", "an unverified restore point must report its UNRECORDED receipt state");
    const singleVerificationText = (await singleVerification.innerText()).trim();
    assert.match(singleVerificationText, /not verified|尚未验证/, `an unverified restore point must say so: ${singleVerificationText}`);
    assert.doesNotMatch(singleVerificationText, /\d{1,2}:\d{2}/, `an unverified restore point must not render a verification time: ${singleVerificationText}`);

    // 2. Publish the second restore point with one added subject, then refresh
    // the shell projection. The daemon's own diff answer is the only accepted
    // source for the rendered counts.
    writeFileSync(join(sourcePath, "change-fixture"), "restoreweave source change comparison fixture\n");
    await publish();
    await reloadSourcesView(ctx);
    await changeStateReached(ctx, "READY");
    const addedAnswer = await assertComparedPoints(ctx, { daemonCommand, captured, sourcePath, card });
    assert.ok(addedAnswer.expected.added >= 1, `the added fixture subject must appear in the daemon's answer: ${JSON.stringify(addedAnswer.changes)}`);
    assert.equal(addedAnswer.expected.removed, 0, `the added fixture must not report removals: ${JSON.stringify(addedAnswer.changes)}`);

    // 3. The bounded detail is visible, not a silent truncation: a larger
    // answer must say how many of the affected subjects it shows.
    const bulk = Array.from({ length: 12 }, (_, index) => ({ kind: index % 3 === 0 ? "content_changed" : "added", path: `bulk/subject-${index + 1}.txt`, entry_type: "REGULAR_FILE" }));
    await page.route("**/api/v1/command", async (route) => {
      if (operationOf(route.request()) !== "snapshot.diff") { await route.fallback(); return; }
      const input = route.request().postDataJSON()?.input ?? {};
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "SUCCEEDED", data: { from_snapshot_ref: input.from_snapshot_ref, to_snapshot_ref: input.to_snapshot_ref, changes: bulk } }) });
    });
    await reloadSourcesView(ctx);
    await changeStateReached(ctx, "READY");
    const bulkLine = card.locator('.source-changes[data-change-state="READY"] .source-changes-line');
    assert.equal(Number(await bulkLine.getAttribute("data-added")), 8, "the summary must count every subject the daemon answered with");
    assert.equal(Number(await bulkLine.getAttribute("data-changed")), 4, "the summary must count every change kind the daemon answered with");
    await card.locator(".source-changes-detail summary").click();
    assert.equal(await card.locator(".source-change").count(), 8, "the expanded detail must list the first N affected subjects");
    const bulkBounded = (await card.locator(".source-changes-detail summary small").innerText()).trim();
    assert.match(bulkBounded, /Showing 8 of 12|共 12 个受影响主题，显示前 8 个/, `the bounded detail must say how many of the affected subjects it shows: ${bulkBounded}`);
    await card.locator(".source-changes-detail summary").click();
    await page.unroute("**/api/v1/command");

    // 4. A comparison the daemon cannot answer must render the daemon's reason
    // and must not present zero changes as a fact.
    const refusal = "snapshot manifest is not readable from the repository (browser-e2e refusal)";
    await page.route("**/api/v1/command", async (route) => {
      if (operationOf(route.request()) !== "snapshot.diff") { await route.fallback(); return; }
      await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ status: "FAILED", reasons: [{ code: "catalog_error", class: "operation", severity: "error", message: refusal, retryable: false }] }) });
    });
    await reloadSourcesView(ctx);
    await changeStateReached(ctx, "UNAVAILABLE");
    assert.equal(await card.locator(".source-changes-line").count(), 1, "the unavailable state must keep one summary line per card");
    const unavailableLine = card.locator('.source-changes[data-change-state="UNAVAILABLE"] .source-changes-line');
    const unavailableText = (await unavailableLine.innerText()).trim();
    assert.ok(unavailableText.includes(refusal), `an unavailable comparison must render the daemon's own reason: ${unavailableText}`);
    assert.equal(await unavailableLine.getAttribute("data-added"), null, "an unavailable comparison must not render a count as fact");
    assert.equal(await card.locator(".source-change").count(), 0, "an unavailable comparison must not render an empty change list as proof");
    assert.doesNotMatch(unavailableText, /\d+ added|no differences|没有差异/, `an unavailable comparison must not read as zero changes: ${unavailableText}`);
    await page.unroute("**/api/v1/command");

    // 5. The refusal is not sticky: the same card recovers the daemon's answer.
    await reloadSourcesView(ctx);
    await changeStateReached(ctx, "READY");
    const recoveredLine = card.locator('.source-changes[data-change-state="READY"] .source-changes-line');
    assert.equal(Number(await recoveredLine.getAttribute("data-added")), addedAnswer.expected.added, "a recovered comparison must report the daemon's counts again");

    // 6. Removing the fixture subject publishes the third restore point, whose
    // comparison with the second one names that removal. The library is left
    // exactly as the fixture created it.
    unlinkSync(join(sourcePath, "change-fixture"));
    await publish();
    await reloadSourcesView(ctx);
    await changeStateReached(ctx, "READY");
    const removedAnswer = await assertComparedPoints(ctx, { daemonCommand, captured, sourcePath, card });
    assert.ok(removedAnswer.expected.removed >= 1, `the removed fixture subject must appear in the daemon's answer: ${JSON.stringify(removedAnswer.changes)}`);
    const listing = await daemonCommand("content.list", { workspace_id: removedAnswer.workspaceID });
    const listed = (listing.items ?? []).filter((item) => item.entry_type !== "DIRECTORY").map((item) => String(item.name));
    assert.equal(listed.includes("change-fixture"), false, "the fixture subject must be gone from the library after its removal is published");
    assert.equal(new Set(listed).size, listed.length, "the library listing must stay one row per subject");
  } finally {
    observation.stop();
  }
}

// Read the daemon's two newest restore points of the fixture source and assert
// the rendered summary is exactly the daemon's `snapshot.diff` answer for them.
async function assertComparedPoints(ctx, { daemonCommand, captured, sourcePath, card }) {
  const listPayload = captured.snapshotLists.at(-1);
  const series = (listPayload?.data?.snapshots ?? []).filter((point) => normalizeLocator(point.display_path) === normalizeLocator(sourcePath));
  assert.ok(series.length >= 2, `the daemon must report both restore points of this source: ${JSON.stringify((listPayload?.data?.snapshots ?? []).map((point) => point.snapshot_ref))}`);
  const ordered = series.slice().sort((left, right) => String(left.created_at ?? "").localeCompare(String(right.created_at ?? "")));
  const previousPoint = ordered.at(-2);
  const newestPoint = ordered.at(-1);
  const workspaceID = String(newestPoint.workspace_id ?? "");
  const sourceRecord = (await daemonCommand("source.list", { workspace_id: workspaceID })).sources?.find((item) => normalizeLocator(item.locator) === normalizeLocator(sourcePath));
  assert.equal(String(sourceRecord?.latest_snapshot_ref ?? ""), String(newestPoint.snapshot_ref), "the compared newest point must be the source record's own latest restore point");
  const diffRequest = captured.diffInputs.at(-1);
  assert.deepEqual(diffRequest, { from_snapshot_ref: previousPoint.snapshot_ref, to_snapshot_ref: newestPoint.snapshot_ref }, "the comparison request must name the daemon's two newest restore points");
  const diffPayload = captured.diffs.at(-1);
  assert.equal(diffPayload?.status, "SUCCEEDED", `the fixture diff must succeed: ${JSON.stringify(diffPayload?.reasons ?? [])}`);
  const changes = diffPayload?.data?.changes ?? [];
  const expected = daemonCounts(changes);
  const ready = card.locator('.source-changes[data-change-state="READY"]');
  const line = ready.locator(".source-changes-line");
  assert.equal(Number(await line.getAttribute("data-added")), expected.added, "the rendered added count must equal the daemon's diff answer");
  assert.equal(Number(await line.getAttribute("data-removed")), expected.removed, "the rendered removed count must equal the daemon's diff answer");
  assert.equal(Number(await line.getAttribute("data-changed")), expected.changed, "the rendered changed count must equal the daemon's diff answer");
  assert.equal(await line.getAttribute("data-from-ref"), String(previousPoint.snapshot_ref), "the summary must name the earlier restore point the daemon compared");
  assert.equal(await line.getAttribute("data-to-ref"), String(newestPoint.snapshot_ref), "the summary must name the newest restore point the daemon compared");
  // Both restore point times are the daemon's, formatted by this page's own
  // locale and time zone.
  const renderedTimes = await ctx.page.evaluate(([fromAt, toAt]) => {
    const format = (value) => new Intl.DateTimeFormat(document.documentElement.lang || "en", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
    return [format(fromAt), format(toAt)];
  }, [String(previousPoint.created_at ?? ""), String(newestPoint.created_at ?? "")]);
  const windowText = (await ready.locator(".source-change-window").innerText()).trim();
  assert.ok(windowText.includes("→"), `the one-line summary must place the two restore point times in order: ${windowText}`);
  for (const time of renderedTimes) assert.ok(windowText.includes(time), `the one-line summary must render the daemon's restore point time ${time}: ${windowText}`);
  // The newest point is still unverified, and the card must say so without
  // implying the comparison is a verification.
  const verification = ready.locator(".source-changes-verification");
  assert.equal(await verification.getAttribute("data-verification-state"), "UNRECORDED", "the newest restore point must stay UNRECORDED until snapshot.verify records a receipt");
  const verificationText = (await verification.innerText()).trim();
  assert.match(verificationText, /not verified|尚未验证/, `an unverified comparison must say the newest point is unverified: ${verificationText}`);
  assert.match(verificationText, /no snapshot.verify receipt has been recorded for this restore point/, `the unverified line must carry the daemon's reason: ${verificationText}`);
  // The detail lists the daemon's own subjects, bounded and stated.
  await ready.locator(".source-changes-detail summary").click();
  const shown = Math.min(8, changes.length);
  const rows = ready.locator(".source-change");
  assert.equal(await rows.count(), shown, `the expanded detail must list the bounded number of affected subjects: ${changes.length} total`);
  const bounded = (await ready.locator(".source-changes-detail summary small").innerText()).trim();
  assert.ok(bounded.includes(String(shown)) && bounded.includes(String(changes.length)), `the detail must state how many of the affected subjects it shows: ${bounded}`);
  assert.deepEqual(
    (await rows.locator(".source-change-path").allInnerTexts()).map((value) => value.trim()).sort(),
    changes.slice(0, shown).map((change) => String(change.path ?? change.from_path ?? "")).sort(),
    "every expanded row must render the daemon's own provenance path",
  );
  assert.deepEqual(
    (await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-kind")))).sort(),
    changes.slice(0, shown).map((change) => String(change.kind ?? "")).sort(),
    "every expanded row must carry the daemon's change kind",
  );
  await ready.locator(".source-changes-detail summary").click();
  return { changes, expected, workspaceID };
}

// The tile preview must be an honest rendering of real content, so the fixture
// gains one genuine 1x1 PNG before the source is scanned. The daemon runs on
// this host and scans the same directory the harness received.
export async function seedFixtureAndConnect(ctx, { sourcePath }) {
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  writeFileSync(join(sourcePath, "tiny.png"), tinyPng);
  // The comparison read is counted from before the first restore point exists,
  // so a source that never had two restore points must show zero
  // `snapshot.diff` requests for the whole phase.
  ctx.state.sourceDiffRequests = 0;
  ctx.page.on("request", (request) => {
    if (isCommandRequest(request) && operationOf(request) === "snapshot.diff") ctx.state.sourceDiffRequests += 1;
  });
  await ctx.text(/已连接|Connected/).waitFor({ state: "visible", timeout: 10000 });
}

// The first source save: the drawer's sticky action bar offers exactly one next
// step in the same pinned position at every stage, and the confirmed save
// reports a measured receipt instead of a second save.
export async function assertSourcePlanAndSave(ctx, { sourcePath }) {
  await ctx.button(/添加来源|Add source/).first().click();
  const addDrawer = ctx.page.getByRole("dialog", { name: /添加来源|Add source/ });
  await addDrawer.waitFor({ state: "visible", timeout: 10000 });
  const pathInput = addDrawer.getByRole("textbox", { name: /RestoreWeave 主机上的路径|Path on RestoreWeave host/ });
  // The drawer's next step is one sticky action bar at the bottom edge. With no
  // path it offers the preview action, disabled, and it stays in view without
  // scrolling the review body.
  const actionBar = addDrawer.locator(".drawer-action-bar");
  await actionBar.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await actionBar.getAttribute("data-state"), "PREVIEW", "an empty drawer must offer the preview action");
  assert.equal(await actionBar.getByRole("button", { name: /预览存储计划|Preview storage plan/ }).count(), 1, "the sticky bar must own the single preview action");
  assert.equal(await actionBar.getByRole("button", { name: /预览存储计划|Preview storage plan/ }).isDisabled(), true, "the preview action must stay disabled until a path exists");
  await assertStickyBarInView(ctx, addDrawer, "an empty path");
  await pathInput.fill(sourcePath);
  await addDrawer.getByRole("button", { name: /预览存储计划|Preview storage plan/ }).click();
  await addDrawer.getByText(/存储计划已生成|Storage plan is ready/).waitFor({ state: "visible", timeout: 10000 });
  const planStats = await addDrawer.locator(".plan-stats").first().innerText();
  // Three source files: alpha.txt, its duplicate beta.txt, and the 1x1 PNG.
  assert.match(planStats, /3\s*(?:files?|文件(?:数)?)/i, `expected three source files: ${planStats}`);
  assert.match(planStats, /(duplicate bytes expected to reuse|重复内容)/i, `missing duplicate facet: ${planStats}`);
  // Human-readable byte values may be fractional (for example, 20.4 KB).
  // Accept those values so the assertion checks the presence of the distinct
  // logical/physical figures without coupling the test to formatting.
  const planNumbers = planStats.match(/\b[1-9][0-9]*(?:\.[0-9]+)?\s*(B|KB|MB|GB|字节)\b/g) ?? [];
  assert.ok(planNumbers.length >= 2, `expected unique and duplicate byte figures: ${planStats}`);
  // The same bar now reads as the confirm action, with the file count, in the
  // same pinned position. The review evidence above it is unchanged.
  assert.equal(await actionBar.getAttribute("data-state"), "READY", "a ready plan must offer the confirm action");
  const confirmAction = actionBar.getByRole("button", { name: /确认保存|Confirm save/ });
  assert.equal(await confirmAction.count(), 1, "the sticky bar must own the single confirm action");
  assert.equal(await confirmAction.isEnabled(), true, "a ready plan must offer a runnable confirm action");
  const confirmLabel = (await confirmAction.innerText()).trim();
  assert.match(confirmLabel, /3/, `the confirm action must carry the file count: ${confirmLabel}`);
  await assertStickyBarInView(ctx, addDrawer, "a ready plan");
  await addDrawer.getByRole("button", { name: /确认保存|Confirm save/ }).click();
  await ctx.page.getByRole("main").getByText(/内容已保存|Content saved/).waitFor({ state: "visible", timeout: 15000 });
  // A completed save keeps the bar honest: it offers the library and a close
  // control instead of a second save.
  assert.equal(await actionBar.getAttribute("data-state"), "SAVED", "a saved plan must switch the bar to the saved state");
  const savedBarText = await actionBar.innerText();
  assert.match(savedBarText, /查看已保存内容|View saved content/, `the saved bar must offer the library: ${savedBarText}`);
  assert.equal(await actionBar.getByRole("button", { name: /确认保存|Confirm save/ }).count(), 0, "a saved plan must not offer a second save");
  await assertStickyBarInView(ctx, addDrawer, "a saved plan");
  // The applied plan remains open so the operator can inspect measured
  // deduplication/physical savings. Close it explicitly before continuing
  // with the library actions that sit behind the drawer.
  await addDrawer.getByRole("button", { name: /关闭添加来源|Close add source/ }).click();
}

// The path field previews on Enter, and the drawer offers one-tap path
// suggestions built only from data the client already has. Both flows end in
// the same sticky bar, in the same position.
export async function assertSourcePreviewOnEnter(ctx, { sourcePath }) {
  await ctx.button(/添加来源|Add source/).first().click();
  const enterDrawer = ctx.page.getByRole("dialog", { name: /添加来源|Add source/ });
  await enterDrawer.waitFor({ state: "visible", timeout: 10000 });
  const enterInput = enterDrawer.getByRole("textbox", { name: /RestoreWeave 主机上的路径|Path on RestoreWeave host/ });
  await enterInput.waitFor({ state: "visible", timeout: 10000 });
  // The keyboard lands on the path field, not on the bar: a user opens the
  // drawer and types immediately.
  let pathFocused = true;
  try {
    await ctx.page.waitForFunction(() => document.activeElement === document.querySelector(".source-drawer .stack-form input"), null, { timeout: 2000 });
  } catch { pathFocused = false; }
  assert.equal(pathFocused, true, "the path field must keep focus when the drawer opens");
  await enterInput.fill(sourcePath);
  await enterInput.press("Enter");
  await enterDrawer.getByText(/存储计划已生成|Storage plan is ready/).waitFor({ state: "visible", timeout: 15000 });
  const enterBar = enterDrawer.locator(".drawer-action-bar");
  const enterBarState = await enterBar.getAttribute("data-state");
  assert.notEqual(enterBarState, "PREVIEW", "Enter in the path field must produce a plan");
  // Every file in this source is already saved, so the bar must say so plainly
  // and offer the library instead of a save that would add nothing.
  assert.equal(enterBarState, "UP_TO_DATE", `an already-saved source must not offer a misleading save: ${enterBarState}`);
  assert.equal(await enterBar.getByRole("button", { name: /确认保存|Confirm save/ }).count(), 0, "an up-to-date plan must not offer a save");
  assert.match(await enterBar.innerText(), /查看已保存内容|View saved content/, "an up-to-date plan must offer the saved content");
  await assertStickyBarInView(ctx, enterDrawer, "an already-saved source");
  await enterDrawer.getByRole("button", { name: /关闭添加来源|Close add source/ }).click();
}

// A suggestion chip fills the path and previews it. The configured source is a
// recheck, not a fresh add, and the drawer must read that way.
export async function assertSourceSuggestionRecheck(ctx, { sourcePath }) {
  const { page } = ctx;
  await ctx.button(/添加来源|Add source/).first().click();
  const chipDrawer = page.locator(".source-drawer");
  await chipDrawer.waitFor({ state: "visible", timeout: 10000 });
  const sourceChip = chipDrawer.locator('.source-suggestion[data-kind="source"]').first();
  await sourceChip.waitFor({ state: "visible", timeout: 10000 });
  // The daemon reports the source locator with normalized separators.
  const normalizePath = (value) => String(value ?? "").replace(/\/+/g, "/");
  assert.equal(normalizePath(await sourceChip.getAttribute("title")), normalizePath(sourcePath), "the configured source path must be the offered suggestion");
  await sourceChip.click();
  await chipDrawer.getByRole("heading", { name: /重新检查来源|Recheck source/ }).waitFor({ state: "visible", timeout: 10000 });
  const chipInput = chipDrawer.getByRole("textbox", { name: /RestoreWeave 主机上的路径|Path on RestoreWeave host/ });
  assert.equal(normalizePath(await chipInput.inputValue()), normalizePath(sourcePath), "a suggestion chip must fill the path field");
  await chipDrawer.getByText(/存储计划已生成|Storage plan is ready/).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await chipDrawer.getByRole("heading", { name: /重新检查来源|Recheck source/ }).count(), 1, "rechecking a configured source must stay a recheck, not a fresh add");
  const chipBar = chipDrawer.locator(".drawer-action-bar");
  assert.equal(await chipBar.getAttribute("data-state"), "UP_TO_DATE", "rechecking an unchanged source must report that nothing new will be added");
  assert.equal(await chipBar.getByRole("button", { name: /确认保存|Confirm save/ }).count(), 0, "an unchanged recheck must not offer a save");
  await assertStickyBarInView(ctx, chipDrawer, "a recheck of an unchanged source");
  await chipDrawer.getByRole("button", { name: /关闭添加来源|Close add source/ }).click();
}

// Sources are one workspace view. The rail switches the content column to the
// configured sources instead of jumping to a second disclosure bar that
// duplicated the same surface inside the library. The rail is hidden on
// phones, so the compact entry above the library heading must reach the same
// view there.
export async function assertSourcesView(ctx) {
  const { page } = ctx;
  const contentColumn = page.locator(".content-column");
  assert.equal(await page.locator(".sources-entry").isVisible(), false, "the compact sources entry must stay hidden from 641px up");
  await page.locator(".workspace-nav-item").filter({ hasText: /^(来源|Sources)/ }).click();
  await contentColumn.locator(".sources-surface .source-card").first().waitFor({ state: "visible", timeout: 10000 });
  const sourcesHeading = (await contentColumn.locator(".workspace-heading h1").innerText()).trim();
  assert.match(sourcesHeading, /^(来源|Sources)$/, `the sources view must title the content column: ${sourcesHeading}`);
  assert.equal(await contentColumn.locator(".sources-surface-actions").count(), 1, "the sources view must keep the add-source action");
  assert.equal(await contentColumn.locator(".result-row").count(), 0, "the sources view must not render library results");
  assert.equal(await contentColumn.locator(".tag-browser").count(), 0, "the sources view must not render the library tag and facet chrome");
  assert.equal(await page.locator(".source-manager").count(), 0, "the library must not render a duplicated sources disclosure bar");
  // What changed since the previous restore point: the daemon's own comparison
  // between this source's two newest restore points, its honest single-point,
  // unverified, and unavailable states, and the bounded detail list.
  await assertSourceChangeSummary(ctx);
  await contentColumn.getByRole("button", { name: /全部内容|All content/ }).click();
  await page.getByRole("main").getByRole("button", { name: /alpha\.txt/ }).first().waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.locator(".content-column .source-manager").count(), 0, "the library must not keep a second sources surface behind the rail item");

  await page.setViewportSize({ width: 640, height: 900 });
  await page.waitForTimeout(150);
  assert.equal(await page.locator(".workspace-sidebar").isVisible(), false, "the navigation rail must stay hidden on phones");
  const compactSourcesEntry = page.locator(".sources-entry");
  await compactSourcesEntry.waitFor({ state: "visible", timeout: 10000 });
  await compactSourcesEntry.click();
  await contentColumn.locator(".sources-surface .source-card").first().waitFor({ state: "visible", timeout: 10000 });
  await assertNoHorizontalOverflow(ctx);
  await contentColumn.getByRole("button", { name: /全部内容|All content/ }).click();
  await page.getByRole("main").getByRole("button", { name: /alpha\.txt/ }).first().waitFor({ state: "visible", timeout: 10000 });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
}
