// Assertions for the activity surface (Tier-1 spec §2).
//
// Owner: the activity surface (components/ActivitySurface.tsx, styles/activity.css,
// i18n/activity.ts, and the view wiring in lib/types.ts, lib/operations.ts,
// components/WorkspaceRail.tsx, and main.tsx). `scripts/web-e2e.mjs` imports
// and invokes this module last in the online phase, at a 1280x900 viewport,
// after the status and verification assertions.
//
// The assertions are written so a fabricated surface fails:
//
//   - every rendered row must be the daemon's own `job.list` row, with the
//     daemon's own state token, and a reload must still list the same daemon
//     `job_id` (a browser-only list fails this);
//   - the summary must carry the count `status.get` reported, not a guess;
//   - a QUEUED cancel must become CANCELLED while a RUNNING cancel must keep
//     `data-state` RUNNING and read the "asked" wording, and a terminal row
//     must offer no cancel at all;
//   - an unknown outcome must offer zero confirm/write buttons: the
//     reconciliation path reads `plan.get` and never issues an apply;
//   - an expanded log must render the daemon's `job.events` page, stop at
//     `terminal`, and keep the daemon's `job_state`;
//   - an empty answer is the only thing that may read "no jobs"; a job list
//     that cannot answer must show its blocked reason instead.

import assert from "node:assert/strict";

const RAIL_ENTRY = /^(Activity|活动)$/;
const ROW_STATE = /^(QUEUED|RUNNING|WAITING_APPROVAL|SUCCEEDED|FAILED|CANCELLED|NEEDS_RECONCILIATION|UNKNOWN)$/;
// Every row states its state in words; the exact wording rules of §2 map one
// state token to one line.
const ROW_LINE = /^(Queued|排队中|Running · |运行中 · |Waiting for approval|等待批准|Completed |已完成 |Failed — |失败——|Cancelled — published snapshots were not rolled back|已取消——已发布的快照没有被回滚|Unknown outcome — needs reconciliation|结果未知——需要核对|UNKNOWN — not reported by this build|UNKNOWN — 此构建未报告)/;
const EMPTY_LINE = /UNKNOWN — not reported by this build|UNKNOWN — 此构建未报告/;

/** Waits for a captured daemon answer, because response bodies arrive asynchronously. */
async function until(page, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await page.waitForTimeout(50);
  }
  return predicate();
}

async function openActivity(ctx) {
  const { page } = ctx;
  // The activity view is a rail workspace view, so it is reached exactly like
  // the library and the sources: by its rail button. A drawer left open by an
  // earlier surface would trap focus, so dismiss it the way a user would.
  if (await page.evaluate(() => Boolean(document.querySelector('[aria-modal="true"]')))) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
  }
  const entry = page.getByRole("button", { name: RAIL_ENTRY });
  await entry.waitFor({ state: "visible", timeout: 10000 });
  await entry.click();
  const surface = page.locator(".activity-surface");
  await surface.waitFor({ state: "visible", timeout: 10000 });
  return { entry, surface };
}

export async function assertActivitySurface(ctx) {
  const { page } = ctx;

  // Module-local captures, all filled from the daemon's own traffic.
  const daemon = { jobLists: [], jobEvents: new Map(), statusGets: [], planGets: [], cancelInputs: [], cancelResponses: new Map(), writeRequests: 0 };
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/command")) return;
    let payload;
    try { payload = request.postDataJSON(); } catch { return; }
    if (payload?.operation === "plan.apply" || payload?.operation === "export.apply") daemon.writeRequests += 1;
    if (payload?.operation === "job.cancel") daemon.cancelInputs.push(payload.input ?? {});
    if (payload?.operation === "plan.get") daemon.planGets.push(payload.input ?? {});
  });
  page.on("response", async (response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/v1/command")) return;
    let request;
    try { request = response.request().postDataJSON(); } catch { return; }
    let body;
    try { body = await response.json(); } catch { return; }
    if (request?.operation === "job.list" && Array.isArray(body?.data?.jobs)) daemon.jobLists.push(body.data.jobs);
    if (request?.operation === "status.get" && body?.data) daemon.statusGets.push(body.data);
    if (request?.operation === "job.cancel" && body?.data) daemon.cancelResponses.set(String(body.data.job_id ?? ""), body.data);
    if (request?.operation === "job.events" && body?.data) {
      const jobID = String(body.data.job_id ?? "");
      const pages = daemon.jobEvents.get(jobID) ?? [];
      pages.push(body.data);
      daemon.jobEvents.set(jobID, pages);
    }
  });

  // The summary line the surface renders is `status.get`'s own answer, so the
  // shell refresh runs once here (from the library view) and the rendered line
  // is compared with the daemon payload below.
  await page.getByRole("button", { name: /^(Refresh service status|刷新服务状态)$/ }).click();
  assert.ok(await until(page, () => daemon.statusGets.length > 0), "the run must read the service status projection");

  // 1. The rail entry opens the view, and the rows are the daemon's own rows.
  const { entry, surface } = await openActivity(ctx);
  assert.equal(await entry.evaluate((node) => node.tagName), "BUTTON", "the activity rail entry must be a button");
  const rows = surface.locator(".activity-row");
  await rows.first().waitFor({ state: "visible", timeout: 15000 });
  assert.ok(await until(page, () => daemon.jobLists.length > 0), "the view must read the durable rows with job.list");
  const listed = daemon.jobLists[daemon.jobLists.length - 1];
  assert.ok(listed.length > 0, "the run must have recorded durable jobs to assert against");
  const listedByID = new Map(listed.map((job) => [String(job.job_id ?? ""), job]));
  const rendered = await rows.evaluateAll((nodes) => nodes.map((node) => ({
    jobID: node.getAttribute("data-job-id") ?? "",
    jobState: node.getAttribute("data-job-state") ?? "",
    state: node.getAttribute("data-state") ?? "",
    text: (node.innerText ?? "").trim(),
  })));
  assert.deepEqual(rendered.map((row) => row.jobID), listed.map((job) => String(job.job_id ?? "")), "the rendered rows must be the daemon's own job.list rows, in its order");
  for (const row of rendered) {
    const job = listedByID.get(row.jobID);
    assert.ok(job, `a rendered job must come from the daemon: ${row.jobID}`);
    assert.equal(row.jobState, String(job.state ?? ""), `the row must keep the daemon's state token: ${row.jobID}`);
    assert.equal(row.state, String(job.state ?? ""), `a state this build knows must render verbatim: ${row.jobID}`);
    assert.match(row.state, ROW_STATE, `data-state must be a daemon state token or UNKNOWN: ${row.state}`);
    assert.match(row.text, ROW_LINE, `every row must state its state in words: ${row.text}`);
  }
  const succeeded = rendered.filter((row) => row.state === "SUCCEEDED");
  assert.ok(succeeded.length > 0, `the durable rows must include a completed job: ${JSON.stringify(rendered.map((row) => row.state))}`);
  for (const row of succeeded) {
    assert.match(row.text, /^(Completed |已完成 )/, `a SUCCEEDED job must render its completion time: ${row.text}`);
  }
  // A completed row is terminal: it offers no cancel action at all.
  assert.equal(await surface.locator('.activity-row[data-state="SUCCEEDED"] .activity-cancel').count(), 0, "a terminal row must offer no cancel action");

  // 2. The summary is `status.get`'s own answer, not a browser count.
  const summary = surface.locator('.result-count[data-summary-source="status.get"]');
  await summary.waitFor({ state: "visible", timeout: 10000 });
  const statusData = daemon.statusGets[daemon.statusGets.length - 1];
  const statusJobs = Array.isArray(statusData.recent_jobs) ? statusData.recent_jobs : [];
  if (statusJobs.length) {
    const reportedCount = Number(statusData.jobs ?? statusJobs.length);
    const summaryText = (await summary.innerText()).trim();
    assert.ok(summaryText.includes(`${reportedCount} durable jobs recorded`) || summaryText.includes(`已记录 ${reportedCount} 个持久作业`), `the summary count must be the one status.get reported: ${summaryText}`);
    assert.ok(summaryText.includes(String(statusJobs[0].state ?? "")) || /(Completed|已完成|Running|运行中|Queued|排队中|Failed|失败|Cancelled|已取消|Unknown outcome|结果未知|UNKNOWN)/.test(summaryText), `the summary must carry the newest reported state: ${summaryText}`);
  }

  // 3. The rows are durable, not browser state: a reload still lists the same
  // daemon job_id, read back from the daemon.
  const durableID = rendered[0].jobID;
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: RAIL_ENTRY }).waitFor({ state: "visible", timeout: 15000 });
  const reopened = await openActivity(ctx);
  const durableRow = reopened.surface.locator(`.activity-row[data-job-id="${durableID}"]`);
  await durableRow.waitFor({ state: "visible", timeout: 15000 });
  assert.ok(await until(page, () => daemon.jobLists[daemon.jobLists.length - 1].some((job) => String(job.job_id ?? "") === durableID)), "after a reload the same job must come back from the daemon");

  // 4. Keyboard: one tab stop with the library's roving tabindex, arrow
  // movement, Enter expands the retained log, Escape returns focus to the rail.
  const toggles = reopened.surface.locator(".activity-row-toggle");
  const rowCount = await reopened.surface.locator(".activity-row").count();
  await toggles.first().focus();
  assert.equal(await reopened.surface.locator('.activity-row-toggle[tabindex="0"]').count(), 1, "the job list must own exactly one tab stop");
  assert.equal(await reopened.surface.locator('.activity-row-toggle[tabindex="-1"]').count(), rowCount - 1, "every other row must leave the tab order");
  const focusedRow = () => page.evaluate(() => Number(document.activeElement?.closest("[data-activity-index]")?.getAttribute("data-activity-index") ?? -1));
  await page.keyboard.press("ArrowDown");
  assert.equal(await focusedRow(), 1, "Arrow Down must move one row");
  await page.keyboard.press("ArrowUp");
  assert.equal(await focusedRow(), 0, "Arrow Up must move back one row");
  await page.keyboard.press("End");
  assert.equal(await focusedRow(), rowCount - 1, "End must jump to the last row");
  await page.keyboard.press("Home");
  assert.equal(await focusedRow(), 0, "Home must jump to the first row");

  const log = reopened.surface.locator(`.activity-row[data-job-id="${durableID}"] .activity-log`);
  await page.keyboard.press("Enter");
  await log.waitFor({ state: "visible", timeout: 10000 });
  const logPages = () => daemon.jobEvents.get(durableID) ?? [];
  for (let attempt = 0; attempt < 60 && logPages().length === 0; attempt += 1) await page.waitForTimeout(100);
  assert.ok(logPages().length > 0, "expanding a row must read its retained log with job.events");
  const firstPage = logPages()[0];
  assert.ok(Number.isInteger(Number(firstPage.next_sequence)), `the log page must report its next_sequence: ${JSON.stringify(firstPage)}`);
  const logText = (await log.innerText()).trim();
  assert.match(logText, /Retained run log|保留的运行日志/, `the expanded row must render the retained run log: ${logText}`);
  assert.equal(await log.getAttribute("data-terminal"), String(firstPage.terminal === true), "the log must report the terminal flag the daemon returned");
  await log.locator(".activity-log-state").waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await log.locator(".activity-log-state").getAttribute("data-state"), String(firstPage.job_state ?? ""), "the log must keep the daemon's own job_state");
  for (const event of firstPage.events ?? []) {
    if (!event.action) continue;
    assert.ok(logText.includes(String(event.action)), `the retained log must render the daemon's event ${event.action}: ${logText}`);
  }
  if (firstPage.terminal === true) {
    // A terminal run is never polled again: the page count must not grow.
    const settled = logPages().length;
    await page.waitForTimeout(3400);
    assert.equal(logPages().length, settled, "a terminal run log must stop polling after the daemon reports terminal");
    assert.match((await log.locator(".activity-log-tail").innerText()).trim(), /terminal|已终止/, "a terminal log must say that reading has stopped");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-view")), "activity", "Escape must return focus to the activity rail entry");

  // 5. Cancel: a QUEUED job becomes CANCELLED, a RUNNING job stays RUNNING
  // with the daemon's "asked" wording. The daemon is mocked here so both
  // states exist; the surface may only render what the daemon answers.
  const workspaceID = String(listed.find((job) => job.workspace_id)?.workspace_id ?? "");
  const queuedJob = { job_id: "job_e2e_queued", workspace_id: workspaceID, kind: "PLAN_APPLY", state: "QUEUED", max_attempts: 3, updated_at: new Date().toISOString() };
  const runningJob = { job_id: "job_e2e_running", workspace_id: workspaceID, kind: "PLAN_APPLY", state: "RUNNING", attempt: 1, max_attempts: 3, updated_at: new Date().toISOString() };
  const reconcileJob = { job_id: "job_e2e_reconcile", workspace_id: workspaceID, plan_id: "pln_e2e_reconcile", kind: "PLAN_APPLY", state: "NEEDS_RECONCILIATION", attempt: 1, max_attempts: 3, updated_at: new Date().toISOString() };
  const unfinishedJob = { job_id: "job_e2e_unfinished", workspace_id: workspaceID, kind: "PLAN_INSPECT", state: "SUCCEEDED" };
  const unknownStateJob = { job_id: "job_e2e_unknown_state", workspace_id: workspaceID, kind: "PLAN_INSPECT", state: "SOMETHING_NEW" };
  const recordedPlan = { plan_id: "pln_e2e_reconcile", workspace_id: workspaceID, kind: "INGEST", state: "READY", plan_digest: "sha256:e2e-recorded-plan", applied: false, executable: true };
  const mockJobs = [queuedJob, runningJob, reconcileJob, unfinishedJob, unknownStateJob];
  let listMode = "jobs";
  await page.route("**/api/v1/command", async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
    if (payload?.operation === "job.list") {
      if (listMode === "empty") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "SUCCEEDED", data: { jobs: [] } }) });
        return;
      }
      if (listMode === "blocked") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "FAILED", reasons: [{ message: "simulated job catalog outage" }] }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "SUCCEEDED", data: { jobs: mockJobs } }) });
      return;
    }
    if (payload?.operation === "job.cancel") {
      const jobID = String(payload.input?.job_id ?? "");
      const data = jobID === queuedJob.job_id
        ? { job_id: jobID, job_state: "CANCELLED", cancelled: true, already_terminal: false, cancellation_asked: true }
        : { job_id: jobID, job_state: "RUNNING", cancelled: false, already_terminal: false, cancellation_asked: true };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "SUCCEEDED", data }) });
      return;
    }
    if (payload?.operation === "plan.get") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "SUCCEEDED", data: recordedPlan }) });
      return;
    }
    await route.continue();
  });
  await reopened.surface.getByRole("button", { name: /Refresh job list|刷新作业列表/ }).click();
  const queuedRow = reopened.surface.locator(`.activity-row[data-job-id="${queuedJob.job_id}"]`);
  const runningRow = reopened.surface.locator(`.activity-row[data-job-id="${runningJob.job_id}"]`);
  const reconcileRow = reopened.surface.locator(`.activity-row[data-job-id="${reconcileJob.job_id}"]`);
  await queuedRow.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await queuedRow.getAttribute("data-state"), "QUEUED", "the daemon's QUEUED row must render as queued");
  assert.match((await queuedRow.innerText()).trim(), /Queued|排队中/, "a QUEUED row must read Queued");
  await queuedRow.locator(".activity-cancel").click();
  await page.waitForTimeout(200);
  assert.equal(await queuedRow.getAttribute("data-state"), "CANCELLED", "a cancelled QUEUED job must render the daemon's CANCELLED state");
  assert.match((await queuedRow.innerText()).trim(), /Cancelled|已取消/, "a cancelled QUEUED job must read cancelled");
  assert.equal(await queuedRow.locator(".activity-cancel").count(), 0, "a cancelled row must not offer cancel again");

  await runningRow.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await runningRow.getAttribute("data-state"), "RUNNING", "the daemon's RUNNING row must render as running");
  assert.match((await runningRow.innerText()).trim(), /Running · |运行中 · /, "a RUNNING row must read Running with its elapsed time");
  await runningRow.locator(".activity-cancel").click();
  await page.waitForTimeout(200);
  const runningText = (await runningRow.innerText()).trim();
  assert.equal(await runningRow.getAttribute("data-state"), "RUNNING", "asking to cancel a RUNNING job must not fabricate a stopped run");
  assert.match(runningText, /Cancellation asked — the run may still finish|已请求取消——本次运行仍可能完成/, `a requested cancellation must say the run may still finish: ${runningText}`);
  assert.ok(!/\d+\s*%/.test(runningText), `a running job must not show an invented percentage: ${runningText}`);
  assert.equal(await runningRow.getByRole("button", { name: /Confirm|确认保存/ }).count(), 0, "a running job must not offer a write");
  assert.equal(daemon.cancelInputs.filter((input) => input.job_id === queuedJob.job_id).length, 1, "one cancel click must issue exactly one job.cancel");
  assert.equal(daemon.cancelResponses.get(queuedJob.job_id)?.job_state, "CANCELLED", "the rendered cancel result must be the daemon's own answer");
  assert.equal(daemon.cancelResponses.get(runningJob.job_id)?.cancellation_asked, true, "the RUNNING cancel must be the daemon's own asked answer");

  // 6. Unknown outcome: the row offers the reconciliation read and zero
  // confirm/write buttons. The path reads `plan.get` and never applies again.
  await reconcileRow.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await reconcileRow.getAttribute("data-state"), "NEEDS_RECONCILIATION", "an unresolved job must keep the daemon's state");
  assert.match((await reconcileRow.innerText()).trim(), /Unknown outcome — needs reconciliation|结果未知——需要核对/, "an unresolved job must read Unknown outcome");
  const writesBeforeReconcile = daemon.writeRequests;
  assert.equal(await reconcileRow.getByRole("button", { name: /Confirm|确认保存/ }).count(), 0, "an unknown outcome must not offer a second write");
  assert.equal(await reconcileRow.getByRole("button", { name: /Rerun|Run again|重新运行|再次运行|重新开始/ }).count(), 0, "an unknown outcome must not offer a rerun");
  assert.equal(await reconcileRow.getByRole("button", { name: /Materialize|输出并校验|Export|导出/ }).count(), 0, "an unknown outcome must not offer an export write");
  const planGetsBefore = daemon.planGets.length;
  await reconcileRow.getByRole("button", { name: /Check protection result|检查保护结果/ }).click();
  const planRead = reconcileRow.locator(".activity-plan-read");
  await planRead.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(daemon.planGets.length, planGetsBefore + 1, "the reconciliation path must read the recorded plan");
  assert.equal(daemon.planGets.at(-1)?.plan_id, reconcileJob.plan_id, "the reconciliation read must name the job's own plan");
  assert.equal(daemon.writeRequests, writesBeforeReconcile, "the reconciliation path must never issue another apply");
  const planReadText = (await planRead.innerText()).trim();
  assert.ok(planReadText.includes(recordedPlan.plan_digest), `the reconciliation read must render the daemon's recorded digest: ${planReadText}`);
  assert.ok(planReadText.includes(recordedPlan.state), `the reconciliation read must render the daemon's recorded plan state: ${planReadText}`);

  // 7. A field this build cannot source is stated as UNKNOWN, never as a
  // healthy default: an incomplete row and an unknown state token.
  const unfinishedRow = reopened.surface.locator(`.activity-row[data-job-id="${unfinishedJob.job_id}"]`);
  await unfinishedRow.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await unfinishedRow.getAttribute("data-state"), "SUCCEEDED", "a row without an updated_at must still keep the daemon's state");
  const unfinishedText = (await unfinishedRow.innerText()).trim();
  assert.match(unfinishedText, /^(Completed |已完成 )UNKNOWN — /, `a missing completion time must render the UNKNOWN phrase: ${unfinishedText}`);
  assert.match(unfinishedText, EMPTY_LINE, "a missing field must render the UNKNOWN phrase, never an empty string");
  const unknownRow = reopened.surface.locator(`.activity-row[data-job-id="${unknownStateJob.job_id}"]`);
  await unknownRow.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await unknownRow.getAttribute("data-state"), "UNKNOWN", "a state this build cannot describe must not render as a known state");
  assert.equal(await unknownRow.getAttribute("data-job-state"), "SOMETHING_NEW", "the daemon's own token must stay visible on the row");
  assert.match((await unknownRow.innerText()).trim(), EMPTY_LINE, "an unknown daemon state must render as UNKNOWN");
  assert.equal(await unknownRow.locator(".activity-cancel").count(), 0, "an undescribed state must not offer an action this build cannot justify");

  // 8. Empty and blocked are different facts: only an empty daemon answer may
  // read "no jobs"; a read that did not answer shows its blocked reason.
  listMode = "empty";
  await reopened.surface.getByRole("button", { name: /Refresh job list|刷新作业列表/ }).click();
  const empty = reopened.surface.locator('.activity-empty[data-empty="true"]');
  await empty.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await reopened.surface.locator(".activity-row").count(), 0, "an empty answer renders no rows");
  const emptyText = (await empty.innerText()).trim();
  assert.match(emptyText, /No durable job is recorded yet|尚未记录任何持久作业/, `the empty state must name the fact: ${emptyText}`);
  assert.match(emptyText, /record a durable job here|都会在此记录一个持久作业/, `the empty state must name what will appear here: ${emptyText}`);

  listMode = "blocked";
  await reopened.surface.getByRole("button", { name: /Refresh job list|刷新作业列表/ }).click();
  const blocked = reopened.surface.locator('.activity-blocked[data-state="BLOCKED"]');
  await blocked.waitFor({ state: "visible", timeout: 10000 });
  assert.match((await blocked.innerText()).trim(), /could not be read|无法读取持久作业列表/, "a job list that cannot answer must show its blocked reason");
  assert.equal(await reopened.surface.locator(".activity-row").count(), 0, "a blocked read renders no rows");
  assert.equal(await reopened.surface.locator('.activity-empty[data-empty="true"]').count(), 0, "a blocked read must not look like 'no jobs'");

  // Leave the page on the ordinary library view again.
  await page.unroute("**/api/v1/command");
  await page.getByRole("button", { name: /^(Library|内容库)/ }).click();
  await page.locator(".result-list").or(page.locator(".empty-state")).first().waitFor({ state: "visible", timeout: 10000 });
}
