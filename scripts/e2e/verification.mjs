// Assertions for the verification report drawer (Tier-1 spec §1).
//
// Owner: the verification surface agent. `scripts/web-e2e.mjs` imports and
// invokes this module in the online phase, after the status assertions, with
// the library open at a 1280x900 viewport and a published restore point.
//
// These assertions are written so a fabricated surface fails:
//
//   - an unverified restore point must render "Last verification: UNKNOWN —
//     {reason}" (Chinese "上次验证：UNKNOWN — {reason}") with no time at all;
//   - after a real `snapshot.verify` run the rendered attempted/passed counts
//     must equal the `snapshot.verify` response payload captured from the
//     network, the result must be labelled as this-browser-session, and the
//     daemon's receipt must then appear in `snapshot.list`;
//   - full-bytes is expensive, so it must not reach the network before its
//     cost is confirmed;
//   - an interrupted run must read outcome UNKNOWN and must not keep a
//     success claim;
//   - the daemon reports no catalog-wide placement count, so the missing row
//     must read UNKNOWN and any client-side number must be labelled
//     "over N loaded subjects";
//   - a different restore point must not inherit another point's session
//     result: it re-reads its own (absent) receipt and says UNKNOWN.
//
// Every listener here is module-local, so the capture cannot disturb another
// surface's state.

import assert from "node:assert/strict";

const COMMAND_PATH = "/api/v1/command";
const isCommandRequest = (request) => request.method() === "POST" && request.url().endsWith(COMMAND_PATH);
const operationOf = (request) => {
  try { return request.postDataJSON()?.operation ?? ""; } catch { return ""; }
};
const isOperationResponse = (response, operation) => isCommandRequest(response.request()) && operationOf(response.request()) === operation;

export async function assertVerificationSurface(ctx) {
  const { page } = ctx;
  const captured = { snapshotLists: [], verify: [], doctor: [], verifyRequests: 0 };
  const onRequest = (request) => {
    if (isCommandRequest(request) && operationOf(request) === "snapshot.verify") captured.verifyRequests += 1;
  };
  const onResponse = async (response) => {
    if (!isCommandRequest(response.request())) return;
    const operation = operationOf(response.request());
    if (!["snapshot.list", "snapshot.verify", "doctor.check"].includes(operation)) return;
    let body;
    try { body = await response.json(); } catch { return; }
    if (operation === "snapshot.list") captured.snapshotLists.push(body);
    if (operation === "snapshot.verify") captured.verify.push(body);
    if (operation === "doctor.check") captured.doctor.push(body);
  };
  page.on("request", onRequest);
  page.on("response", onResponse);

  try {
    // 1. Open the trusted status panel and the report from its trigger. The
    // panel's summary is a native details element, so it may already be open.
    const panel = page.locator(".status-panel");
    const summary = panel.locator("summary.status-panel-summary");
    await summary.waitFor({ state: "visible", timeout: 10000 });
    if (await panel.getAttribute("open") === null) await summary.click();
    const trigger = panel.getByRole("button", { name: /Open verification report|打开验证报告/ });
    await trigger.click();
    const report = page.getByRole("dialog", { name: /Verification report|验证报告/ });
    await report.waitFor({ state: "visible", timeout: 10000 });

    // 2. The restore-point rows carry the freeze facts the daemon reported,
    // not a client-side guess: the newest row matches the snapshot.list
    // payload this drawer itself read.
    const points = report.locator(".verification-point");
    await points.first().waitFor({ state: "visible", timeout: 10000 });
    assert.ok(await points.count() >= 1, "the report must list the published restore points");
    const newestRow = report.locator('.verification-point[data-newest="true"]');
    assert.equal(await newestRow.count(), 1, "exactly one row must be marked as the newest restore point");
    const newestRef = await newestRow.getAttribute("data-snapshot-ref");
    const listPayload = captured.snapshotLists.at(-1);
    const daemonNewest = listPayload?.data?.snapshots?.at(-1);
    assert.ok(daemonNewest, "the drawer must read snapshot.list");
    assert.equal(newestRef, String(daemonNewest.snapshot_ref), "the newest row must be the daemon's newest restore point");
    const newestText = (await newestRow.innerText()).trim();
    assert.match(newestText, new RegExp(escapeRegExp(String(daemonNewest.snapshot_ref))), `the row must render the snapshot_ref: ${newestText}`);
    const digest = String(daemonNewest.manifest_digest ?? "");
    assert.ok(digest.length > 0, "the fixture restore point must report a manifest digest");
    assert.match(newestText, new RegExp(escapeRegExp(digest.slice(0, 24))), `the row must render the manifest digest: ${newestText}`);
    const factsText = (await newestRow.locator(".verification-point-facts").innerText()).trim();
    assert.match(factsText, /Frozen|冻结/, `the freeze time must be reported: ${factsText}`);
    assert.match(factsText, /manifest|清单/, `the manifest digest must be reported: ${factsText}`);
    assert.match(factsText, new RegExp(`entries ${daemonNewest.entries}|条目 ${daemonNewest.entries}`), `the entry count must be the daemon's: ${factsText}`);
    assert.match(factsText, new RegExp(`files ${daemonNewest.files}|文件 ${daemonNewest.files}`), `the file count must be the daemon's: ${factsText}`);
    assert.match(factsText, /exact-protected \d+ · unprotected \d+|精确保护 \d+ · 未保护 \d+/, `the protection mix must be reported: ${factsText}`);

    // 3. No receipt exists yet in this run, so the row must say UNKNOWN with
    // the daemon's reason -- and it must not render any time at all. This is
    // the spec's exit test: an unrun service never claims a verification time.
    const newestReceipt = newestRow.locator(".verification-receipt");
    assert.equal(await newestReceipt.getAttribute("data-receipt-state"), "UNRECORDED", "the fixture restore point must not have a verification receipt yet");
    const receiptBefore = (await newestReceipt.innerText()).trim();
    assert.equal(receiptBefore.includes("UNKNOWN"), true, `an unrun service must not claim a verification time: ${receiptBefore}`);
    assert.doesNotMatch(receiptBefore, /\d{4}|\d{1,2}:\d{2}/, `an UNRECORDED receipt must not render a time: ${receiptBefore}`);
    const lastVerification = newestRow.getByText(/Last verification|上次验证/).first();
    assert.equal((await lastVerification.innerText()).includes("UNKNOWN"), true, "an unrun service must not claim a verification time");
    // An unrecorded receipt states no age either: the freshness line is about
    // a recorded full-bytes pass, and no such record exists yet.
    assert.equal(await report.locator(".verification-freshness").count(), 0, "no freshness statement may be rendered while no receipt is recorded");
    // The same rule holds for every unrecorded receipt on the page: no
    // fabricated time may appear next to an UNKNOWN state.
    for (const line of await report.locator('.verification-receipt[data-receipt-state="UNRECORDED"]').allInnerTexts()) {
      assert.equal(line.includes("UNKNOWN"), true, `every unrecorded receipt must read UNKNOWN: ${line}`);
      assert.doesNotMatch(line, /\d{4}|\d{1,2}:\d{2}/, `an unrecorded receipt must not render a time: ${line}`);
    }

    // 4. Coverage is named per mode, including the cost of the full read.
    const modeText = (await report.locator(".verification-mode").allInnerTexts()).join("\n");
    assert.match(modeText, /authenticated-metadata[\s\S]*repository bytes are not read|authenticated-metadata[\s\S]*不读取仓库字节/, `metadata-only coverage must name that bytes are not read: ${modeText}`);
    assert.match(modeText, /sampled-content[\s\S]*deterministic|sampled-content[\s\S]*抽样/, `sampled coverage must name its sample: ${modeText}`);
    assert.match(modeText, /full-bytes[\s\S]*every repository byte|full-bytes[\s\S]*整个仓库字节/, `full coverage must name its cost: ${modeText}`);
    assert.match(modeText, /restore-drill[\s\S]*restore_verified/, `a restore drill must name restore_verified: ${modeText}`);

    // 5. Full-bytes is expensive: selecting it and asking to run must not
    // reach the daemon until the cost is explicitly confirmed.
    const fullBytesMode = report.locator(".verification-modes").getByRole("button", { name: /full-bytes/ }).first();
    await fullBytesMode.click();
    assert.equal(await fullBytesMode.getAttribute("aria-pressed"), "true", "the selected level must be the one that runs");
    const requestsBeforeConfirm = captured.verifyRequests;
    await report.getByRole("button", { name: /Run full-bytes verification|运行 full-bytes 验证/ }).first().click();
    await page.waitForTimeout(400);
    assert.equal(captured.verifyRequests, requestsBeforeConfirm, "full-bytes must not run before its cost is confirmed");
    const confirm = report.locator(".verification-confirm");
    await confirm.waitFor({ state: "visible", timeout: 5000 });
    assert.match((await confirm.innerText()).trim(), /reads every repository byte|读取整个仓库字节/, "the confirmation must name the full-bytes cost");

    // 6. Confirm and run a real verification. The captured response payload is
    // the only accepted source for the rendered counts.
    const [verifyResponse] = await Promise.all([
      page.waitForResponse((response) => isOperationResponse(response, "snapshot.verify"), { timeout: 60000 }),
      report.getByRole("button", { name: /Yes, read every repository byte|确认读取整个仓库字节/ }).click(),
    ]);
    const verifyBody = await verifyResponse.json();
    const payload = verifyBody?.data ?? {};
    assert.equal(payload.snapshot_ref, String(daemonNewest.snapshot_ref), "the run must target the restore point under the report");
    assert.equal(payload.mode, "full-bytes", `the daemon must run the requested level: ${JSON.stringify(payload)}`);
    assert.equal(payload.ok, true, `the fixture full-bytes verification must pass: ${JSON.stringify(verifyBody)}`);
    assert.equal(captured.verifyRequests, requestsBeforeConfirm + 1, "the confirmed run must issue exactly one snapshot.verify request");

    // 7. The session result equals the daemon's payload and is labelled as
    // this browser session; the receipt then appears in the record.
    const session = report.locator(".verification-run").first();
    await session.waitFor({ state: "visible", timeout: 30000 });
    await page.waitForFunction(() => {
      const state = document.querySelector(".verification-run")?.getAttribute("data-session-state");
      return state !== undefined && state !== "RUNNING";
    }, null, { timeout: 60000 });
    assert.equal(await session.getAttribute("data-session-state"), "PASSED", "a passing full-bytes run must report a pass");
    assert.equal(Number(await session.getAttribute("data-attempted-files")), Number(payload.attempted_files ?? 0), "the rendered attempted-file count must equal the daemon payload");
    assert.equal(Number(await session.getAttribute("data-passed-files")), Number(payload.passed_files ?? 0), "the rendered passed-file count must equal the daemon payload");
    assert.equal(Number(await session.getAttribute("data-attempted-bytes")), Number(payload.attempted_bytes ?? 0), "the rendered attempted-byte count must equal the daemon payload");
    assert.equal(Number(await session.getAttribute("data-passed-bytes")), Number(payload.passed_bytes ?? 0), "the rendered passed-byte count must equal the daemon payload");
    const sessionText = (await session.innerText()).trim();
    assert.match(sessionText, /this browser session|本浏览器会话/, `a session result must be labelled as this-browser-session: ${sessionText}`);
    assert.match(sessionText, /full-bytes/, `the session result must name the level that ran: ${sessionText}`);
    assert.match(sessionText, new RegExp(`${payload.passed_files}/${payload.attempted_files} files|${payload.passed_files}/${payload.attempted_files} 个文件`), `the session result must state the daemon's counts: ${sessionText}`);
    assert.doesNotMatch(sessionText, /\d+\s?%/, `no progress percentage may be invented: ${sessionText}`);
    assert.equal(await session.getAttribute("data-receipt-appeared"), "true", "a run the daemon recorded must report that its receipt appeared");

    await page.waitForFunction(() => document.querySelector('.verification-receipt[data-receipt-state="RECORDED"]') !== null, null, { timeout: 15000 });
    const recordedReceipt = report.locator('.verification-point[data-newest="true"] .verification-receipt');
    assert.equal(await recordedReceipt.getAttribute("data-receipt-state"), "RECORDED", "the refreshed record must show the new receipt");
    const recordedText = (await recordedReceipt.innerText()).trim();
    assert.match(recordedText, /full-bytes/, `the recorded receipt must name the level: ${recordedText}`);
    assert.match(recordedText, /SUCCEEDED/, `the recorded receipt must state the daemon's outcome: ${recordedText}`);
    assert.match(recordedText, new RegExp(`${payload.passed_files}/${payload.attempted_files}`), `the recorded receipt must carry the daemon's counts: ${recordedText}`);
    assert.doesNotMatch(recordedText, /UNKNOWN/, `a recorded receipt must not render as UNKNOWN: ${recordedText}`);
    // The receipt states its own age, computed from the daemon's recorded time:
    // the run just happened, so the age the drawer reports must be under an
    // hour and must come from a readable daemon time.
    const ageAttribute = await recordedReceipt.getAttribute("data-age-minutes");
    assert.match(String(ageAttribute), /^\d+$/, `a recorded receipt must carry the daemon's time as a readable age: ${ageAttribute}`);
    assert.ok(Number(ageAttribute) < 60, `a just-recorded receipt must state a fresh age: ${ageAttribute}`);
    assert.match(recordedText, /verified (just now|a minute ago|\d+ minutes ago)|(刚刚验证|1 分钟前验证|\d+ 分钟前验证)/, `a recorded pass must state how old its verification is: ${recordedText}`);
    // The section states the last full read of repository bytes and its age,
    // and a fresh pass raises no freshness suggestion.
    const freshness = report.locator('[data-full-bytes-age-minutes]');
    assert.equal(await freshness.count(), 1, "a recorded full-bytes pass must state when the full read last happened");
    assert.ok(Number(await freshness.getAttribute("data-full-bytes-age-minutes")) < 60, "a just-recorded full-bytes pass must state a fresh age");
    assert.match((await freshness.innerText()).trim(), /Last full-bytes verification|上次全量校验/, `the full-read line must name what it dates: ${await freshness.innerText()}`);
    assert.equal(await report.locator('[data-full-bytes-stale="true"]').count(), 0, "a fresh full-bytes verification must not raise the freshness suggestion");

    // 8. An interrupted run records nothing: the outcome is UNKNOWN and the
    // earlier success claim must be gone from the session block.
    await page.route("**/api/v1/command", async (route) => {
      if (operationOf(route.request()) === "snapshot.verify") { await route.abort(); return; }
      await route.fallback();
    });
    await report.getByRole("button", { name: /Run full-bytes verification|运行 full-bytes 验证/ }).first().click();
    await report.getByRole("button", { name: /Yes, read every repository byte|确认读取整个仓库字节/ }).click();
    await page.waitForFunction(() => document.querySelector(".verification-run")?.getAttribute("data-session-state") === "UNKNOWN", null, { timeout: 30000 });
    const interrupted = report.locator(".verification-run").first();
    assert.equal(await interrupted.getAttribute("data-session-state"), "UNKNOWN", "an interrupted run must not report a result");
    assert.equal(await interrupted.getAttribute("data-receipt-appeared"), "false", "an interrupted run records no receipt");
    const interruptedText = (await interrupted.innerText()).trim();
    assert.match(interruptedText, /UNKNOWN/, `an interrupted run must state UNKNOWN: ${interruptedText}`);
    assert.doesNotMatch(interruptedText, /Verified just now|刚刚在.{0,2}浏览器会话中验证/, `an interrupted run must not keep a success claim: ${interruptedText}`);
    await page.unroute("**/api/v1/command");

    // 9. The doctor check is explicit, labelled as a byte read, and renders the
    // daemon's own checks verbatim with its own receipt time.
    const doctorButton = report.getByRole("button", { name: /Run doctor check in the verification report|在验证报告中运行体检检查/ });
    const doctorSection = report.locator('section[aria-label*="reads repository bytes"], section[aria-label*="读取仓库字节"]').first();
    await doctorSection.waitFor({ state: "visible", timeout: 10000 });
    assert.match((await doctorSection.innerText()).trim(), /reads repository bytes|读取仓库字节/, "the doctor check must be labelled as a repository byte read");
    const [doctorResponse] = await Promise.all([
      page.waitForResponse((response) => isOperationResponse(response, "doctor.check"), { timeout: 60000 }),
      doctorButton.click(),
    ]);
    const doctorBody = await doctorResponse.json();
    const checks = doctorBody?.data?.checks ?? [];
    assert.ok(checks.length > 0, "doctor.check must return its checks");
    await report.locator(".verification-doctor-checks li").first().waitFor({ state: "visible", timeout: 30000 });
    const renderedChecks = await report.locator(".verification-doctor-checks li").evaluateAll((nodes) => nodes.map((node) => ({ id: node.getAttribute("data-check-id") ?? "", text: (node.innerText ?? "").trim() })));
    assert.equal(renderedChecks.length, checks.length, "every doctor check must render");
    for (const check of checks) {
      const row = renderedChecks.find((entry) => entry.id === String(check.id));
      assert.ok(row, `doctor check ${check.id} must render`);
      assert.ok(row.text.includes(String(check.message ?? "")), `doctor check ${check.id} must render the daemon's message verbatim: ${row.text}`);
    }
    const doctorReceipt = (await report.locator(".verification-doctor-receipt").innerText()).trim();
    assert.match(doctorReceipt, /this browser session|本浏览器会话/, `the doctor receipt must say when this browser read it: ${doctorReceipt}`);
    assert.match(doctorReceipt, new RegExp(`${checks.length} checks|${checks.length} 项检查`), `the doctor receipt must state how many checks ran: ${doctorReceipt}`);

    // 10. No catalog-wide placement count exists in this build: the missing
    // row reads UNKNOWN and names the missing capability, and no client-side
    // number is ever presented as catalog truth.
    const catalogRow = report.locator('.verification-placement-row[data-placement-scope="catalog"]');
    const catalogText = (await catalogRow.innerText()).trim();
    assert.match(catalogText, /^Placement facts: UNKNOWN|^放置事实：UNKNOWN/, `a missing catalog-wide count must read UNKNOWN: ${catalogText}`);
    assert.match(catalogText, /UNKNOWN — /, `UNKNOWN must name the missing capability: ${catalogText}`);
    assert.doesNotMatch(catalogText, /\d/, `the catalog scope must not render a client-side count: ${catalogText}`);
    const loadedText = (await report.locator('.verification-placement-row[data-placement-scope="loaded"]').innerText()).trim();
    assert.match(loadedText, /UNKNOWN|loaded subjects|已加载主题/, `the missing global count must read UNKNOWN or be labelled as a bounded loaded-subjects count: ${loadedText}`);
    if (!/UNKNOWN/.test(loadedText)) assert.match(loadedText, /over \d+ loaded subjects|已加载 \d+ 个主题/, `a bounded count must carry its bound: ${loadedText}`);

    // 11. A different restore point must not inherit another point's result:
    // the drawer re-reads its own receipt state and says UNKNOWN.
    await page.route("**/api/v1/command", async (route) => {
      if (operationOf(route.request()) !== "snapshot.list") { await route.fallback(); return; }
      const response = await route.fetch();
      const body = await response.json();
      const snapshots = Array.isArray(body?.data?.snapshots) ? body.data.snapshots : [];
      body.data.snapshots = [...snapshots, {
        ...(snapshots.at(-1) ?? {}),
        snapshot_ref: "snapshot:browser-e2e-second-point",
        manifest_digest: "sha256:browser-e2e-second-point",
        created_at: new Date().toISOString(),
        verification: { state: "UNRECORDED", reason: "no snapshot.verify receipt has been recorded for this restore point" },
      }];
      await route.fulfill({ response, json: body });
    });
    await report.getByRole("button", { name: /Close verification report|关闭验证报告/ }).click();
    await panel.getByRole("button", { name: /刷新事实|Refresh facts/ }).click();
    await page.waitForTimeout(300);
    await trigger.click();
    const reopened = page.getByRole("dialog", { name: /Verification report|验证报告/ });
    const reopenedNewest = reopened.locator('.verification-point[data-newest="true"]');
    await reopenedNewest.waitFor({ state: "visible", timeout: 10000 });
    // The shell resolves the newest restore point asynchronously; wait until
    // the report follows it before reading the row's receipt.
    await page.waitForFunction(() => {
      const row = document.querySelector(".verification-target")?.closest(".verification-point");
      return row?.getAttribute("data-snapshot-ref") === "snapshot:browser-e2e-second-point";
    }, null, { timeout: 15000 });
    const targetRow = reopened.locator(".verification-point:has(.verification-target)").first();
    assert.equal(await targetRow.getAttribute("data-snapshot-ref"), "snapshot:browser-e2e-second-point", "the report must follow the restore point the shell resolved");
    assert.equal(await reopenedNewest.getAttribute("data-snapshot-ref"), "snapshot:browser-e2e-second-point", "the newest row must be the daemon's newest restore point");
    assert.equal(await reopenedNewest.locator(".verification-receipt").getAttribute("data-receipt-state"), "UNRECORDED", "a different restore point must read its own receipt");
    assert.match((await reopenedNewest.locator(".verification-receipt").innerText()).trim(), /UNKNOWN/, "another point's session result must not appear as this point's record");
    assert.equal(await reopened.locator(".verification-run").count(), 0, "a different restore point must not show another point's session result");

    // 11b. A recorded UNAVAILABLE outcome (the LINK_ONLY case: the bytes this
    // mode needs cannot be read) must render as an unavailability, never as a
    // pass, and it is still not a session result.
    const unavailableRow = {
      ...(captured.snapshotLists.at(-1)?.data?.snapshots?.at(-1) ?? {}),
      snapshot_ref: "snapshot:browser-e2e-unavailable",
      manifest_digest: "sha256:browser-e2e-unavailable",
      created_at: new Date().toISOString(),
      verification: {
        state: "RECORDED",
        mode: "full-bytes",
        outcome: "UNAVAILABLE",
        attempted_files: 3,
        attempted_bytes: 136,
        passed_files: 0,
        passed_bytes: 0,
        ok: false,
        restore_verified: false,
        failure_reason: "member is LINK_ONLY_UNPROTECTED: repository bytes are unavailable for this snapshot",
        verified_at: new Date().toISOString(),
        request_id: "browser-e2e-unavailable",
      },
    };
    await page.unroute("**/api/v1/command");
    await page.route("**/api/v1/command", async (route) => {
      if (operationOf(route.request()) !== "snapshot.list") { await route.fallback(); return; }
      const response = await route.fetch();
      const body = await response.json();
      body.data.snapshots = [...(body?.data?.snapshots ?? []).filter((snapshot) => snapshot.snapshot_ref !== unavailableRow.snapshot_ref), unavailableRow];
      await route.fulfill({ response, json: body });
    });
    await reopened.getByRole("button", { name: /Refresh$|刷新/ }).first().click();
    await page.waitForFunction(() => document.querySelector('.verification-receipt[data-outcome="UNAVAILABLE"]') !== null, null, { timeout: 15000 });
    const unavailable = reopened.locator('.verification-receipt[data-outcome="UNAVAILABLE"]').first();
    assert.equal(await unavailable.getAttribute("data-receipt-state"), "RECORDED", "an unavailable run is a recorded outcome");
    const unavailableText = (await unavailable.innerText()).trim();
    assert.match(unavailableText, /Verification coverage unavailable|验证覆盖不可用/, `a recorded UNAVAILABLE outcome must read as an unavailability: ${unavailableText}`);
    assert.match(unavailableText, /LINK_ONLY/, `the unavailable reason must keep the recorded reason: ${unavailableText}`);
    assert.doesNotMatch(unavailableText, /SUCCEEDED/, `unavailability must never render as a pass: ${unavailableText}`);
    assert.equal(await reopened.locator(".verification-run").count(), 0, "a recorded unavailability is not this session's result");

    // 12. Restore the real projection and close the report cleanly, so the
    // surfaces asserted after this one see the untouched daemon state.
    await page.unroute("**/api/v1/command");
    await reopened.getByRole("button", { name: /Close verification report|关闭验证报告/ }).click();
    await panel.getByRole("button", { name: /刷新事实|Refresh facts/ }).click();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.body.classList.contains("drawer-open")), false, "closing the report must release the page");
    if (await panel.getAttribute("open") !== null) await summary.click();
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
