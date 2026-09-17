// Assertions for the trusted status surface (components/StatusPanel.tsx).
//
// Owner: the status surface (components/StatusPanel.tsx, styles/status.css,
// i18n/status.ts). These assertions run in the online and offline phases from
// scripts/web-e2e.mjs and are written so a fabricated surface fails:
//
//   - a repository failure must be named in the summary, and no readiness dot
//     may exist anywhere on the page;
//   - every fact row must start with exactly one of the four state tokens;
//   - the headline may only name a protection and recovery fact: a degraded
//     discovery fact (the semantic index) stays in the body;
//   - the body is three named groups, collapsed to the protection group by
//     default, and the not-sourced group states its count, not a health claim;
//   - an absent additive field (the writability probe) must read UNKNOWN with
//     the reason, never WRITABLE and never a bare zero;
//   - the semantic dimension must never read ready while capability.list calls
//     it UNAVAILABLE;
//   - the byte-reading doctor check must be an explicit control, and its row
//     must state the receipt once it has run.

import assert from "node:assert/strict";

const FACT_STATE = /^(PROVEN|UNKNOWN|DEGRADED|FAILED)/;
// PROVEN rows carry the browser read time in either locale; every other state
// carries a reason after an em dash and no timestamp of its own.
const ROW_LINE = /^(PROVEN · .+ · (as of .+ \(this browser\)|截至 .+（本浏览器）)|(UNKNOWN|DEGRADED|FAILED) — .+)$/;
// The body's three groups, in render order.
const GROUP_IDS = ["protection", "discovery", "not-sourced"];
// The facts the headline may draw from: the protection and recovery facts.
const SUMMARY_FACT_IDS = ["service", "repository", "writability", "catalog", "schema", "verification", "protection"];

async function openStatusPanel(ctx) {
  const { page } = ctx;
  const panel = page.locator(".status-panel");
  const summary = panel.locator("summary.status-panel-summary");
  await summary.waitFor({ state: "visible", timeout: 10000 });
  if (await panel.getAttribute("open") === null) await summary.click();
  await expandStatusGroups(panel);
  await panel.locator(".health-fact").first().waitFor({ state: "visible", timeout: 10000 });
  return panel;
}

// The three groups are native disclosures. Opening all of them is what makes
// every fact row readable; the rows themselves are unchanged.
async function expandStatusGroups(panel) {
  const groups = panel.locator("details.status-group");
  for (let index = 0; index < await groups.count(); index += 1) {
    const group = groups.nth(index);
    if (await group.getAttribute("open") === null) await group.locator("summary.status-group-summary").click();
  }
}

async function groupStates(panel) {
  return panel.locator("details.status-group").evaluateAll((nodes) => nodes.map((node) => ({
    group: node.getAttribute("data-group") ?? "",
    open: node.hasAttribute("open"),
    state: node.querySelector("summary")?.getAttribute("data-group-state") ?? "",
    summary: (node.querySelector("summary")?.innerText ?? "").trim(),
    facts: node.querySelectorAll(".health-fact").length,
  })));
}

// The collapsed not-sourced line names the count of the rows it hides.
function groupCount(summary) {
  const match = summary.match(/\d+/);
  return match ? Number(match[0]) : -1;
}

async function factRows(panel) {
  return panel.locator(".health-fact").evaluateAll((nodes) => nodes.map((node) => ({
    fact: node.getAttribute("data-fact") ?? "",
    group: node.getAttribute("data-group") ?? "",
    state: node.getAttribute("data-state") ?? "",
    text: (node.innerText ?? "").trim(),
  })));
}

function assertFourStateRows(rows, when) {
  assert.ok(rows.length >= 10, `${when}: the status surface must report its named facts, got ${rows.length}`);
  for (const row of rows) {
    assert.ok(GROUP_IDS.includes(row.group), `${when}: ${row.fact} must belong to one of the three body groups, got ${row.group}`);
    assert.match(row.text, FACT_STATE, `${when}: ${row.fact} must open with a state token: ${row.text}`);
    assert.match(row.text, ROW_LINE, `${when}: ${row.fact} must be PROVEN · value · as-of or STATE — reason: ${row.text}`);
    assert.equal(row.text.startsWith(row.state), true, `${when}: ${row.fact} must not carry a state it does not state: ${row.text}`);
  }
}

// The online phase: real facts, the group layout, the headline's scope, the
// repository-failure case, the absent additive field, and the capability gate
// on the semantic row.
export async function assertStatusSurface(ctx) {
  const { page } = ctx;
  const panel = page.locator(".status-panel");
  const summary = panel.locator("summary.status-panel-summary");
  await summary.waitFor({ state: "visible", timeout: 10000 });
  if (await panel.getAttribute("open") === null) await summary.click();

  // 0. The body groups the facts instead of listing them flat: three named
  // groups, collapsed to the protection group by default, and the not-sourced
  // group's collapsed line states its count under a four-state token so it
  // cannot read as healthy.
  const defaults = await groupStates(panel);
  assert.deepEqual(defaults.map((group) => group.group), GROUP_IDS, `the body must render the three named groups: ${JSON.stringify(defaults)}`);
  assert.equal(defaults[0].open, true, `the protection group must be the one open by default: ${JSON.stringify(defaults)}`);
  assert.equal(defaults[1].open, false, `the discovery group must start collapsed: ${JSON.stringify(defaults)}`);
  assert.equal(defaults[2].open, false, `the not-sourced group must start collapsed: ${JSON.stringify(defaults)}`);
  assert.match(defaults[0].summary, /^(PROVEN|UNKNOWN|DEGRADED|FAILED)/, `a group summary must carry its own state token: ${defaults[0].summary}`);
  assert.match(defaults[0].summary, /Protection and recovery|保护与恢复/, `the first group must be named: ${defaults[0].summary}`);
  assert.match(defaults[1].summary, /Discovery|检索与发现/, `the second group must be named: ${defaults[1].summary}`);
  assert.match(defaults[2].summary, /^(UNKNOWN|DEGRADED|FAILED)/, `the not-sourced line must not read as healthy: ${defaults[2].summary}`);
  assert.match(defaults[2].summary, /Not sourced by this build|此构建无法提供来源/, `the not-sourced group must be named: ${defaults[2].summary}`);
  assert.ok(groupCount(defaults[2].summary) >= 1, `the not-sourced line must name its count: ${defaults[2].summary}`);
  await expandStatusGroups(panel);
  await panel.locator(".health-fact").first().waitFor({ state: "visible", timeout: 10000 });
  const expandedGroups = await groupStates(panel);
  assert.deepEqual(expandedGroups.map((group) => group.open), [true, true, true], `every group must open: ${JSON.stringify(expandedGroups)}`);
  assert.equal(expandedGroups[2].facts, groupCount(defaults[2].summary), `the not-sourced count must equal the rows it hides: ${JSON.stringify(expandedGroups[2])}`);
  const expandedRows = await factRows(panel);
  assert.deepEqual(expandedRows.filter((row) => row.group === "not-sourced").map((row) => row.fact).sort(), ["counts", "recovery-records"], `the not-sourced group must hold exactly the facts this build cannot source: ${JSON.stringify(expandedRows)}`);
  assert.equal(expandedRows.filter((row) => row.group === "discovery").length, 3, `the discovery group must hold the lexical, semantic, and doctor facts: ${JSON.stringify(expandedRows)}`);

  // 1. The surface reports the daemon's own facts, and nothing but the four
  // state strings carries health.
  assert.equal(await page.locator(".status-dot").count(), 0, "the readiness dots must be replaced by the fact rows");
  assert.equal(await page.locator(".status-dot.ready").count(), 0, "no readiness dot may exist");
  const summaryText = (await summary.innerText()).trim();
  const summaryState = await summary.getAttribute("data-health");
  assert.match(summaryText, FACT_STATE, `the summary must open with its weakest state: ${summaryText}`);
  assert.equal(summaryText.startsWith(summaryState), true, `the summary state must match its text: ${summaryText}`);
  assert.ok(SUMMARY_FACT_IDS.includes(await summary.getAttribute("data-weakest")), `the headline must name only a protection/recovery fact: ${await summary.getAttribute("data-weakest")}`);
  const initialRows = await factRows(panel);
  assertFourStateRows(initialRows, "online");
  const initialRepository = initialRows.find((row) => row.fact === "repository");
  assert.ok(initialRepository, "the repository fact must always be reported");
  assert.equal(initialRepository.state, "PROVEN", `the fixture repository must verify: ${initialRepository.text}`);

  // The verification report trigger is part of this surface, and the shell
  // keeps its focus contract: opening it and pressing Escape returns focus to
  // the trigger and releases the page again.
  const trigger = panel.getByRole("button", { name: /Open verification report|打开验证报告/ });
  await trigger.click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => document.body.classList.contains("drawer-open")), false, "Escape must release the page after the drawer trigger opens");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), await trigger.getAttribute("aria-label"), "closing the surface must return focus to its trigger");

  // 2. The byte-reading doctor check runs only on request, and its row reports
  // the receipt.
  const doctorButton = panel.getByRole("button", { name: /运行体检检查|Run doctor check/ });
  await doctorButton.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await doctorButton.isEnabled(), true, "the doctor check must be runnable when the service answers");
  const beforeDoctor = (await factRows(panel)).find((row) => row.fact === "doctor");
  assert.equal(beforeDoctor.state, "UNKNOWN", `the doctor row must start unproven: ${beforeDoctor.text}`);
  assert.match(beforeDoctor.text, /not been run|尚未在本次浏览器会话中运行/, `the unrun doctor row must name why it is unknown: ${beforeDoctor.text}`);
  await doctorButton.click();
  await page.waitForFunction(() => {
    const row = document.querySelector('.health-fact[data-fact="doctor"]');
    return row?.getAttribute("data-state") === "PROVEN" || row?.getAttribute("data-state") === "FAILED";
  }, null, { timeout: 30000 });
  const afterDoctor = (await factRows(panel)).find((row) => row.fact === "doctor");
  assert.equal(afterDoctor.state, "PROVEN", `the doctor receipt must be reported: ${afterDoctor.text}`);
  assert.match(afterDoctor.text, /Doctor gates: \d+ checks passed|体检门禁：\d+ 项检查通过/, `the doctor row must report the receipt: ${afterDoctor.text}`);

  // 3. A degraded discovery fact stays in the body. Only the semantic
  // capability is falsified here, so the repository and every other
  // protection/recovery fact keep their real values; the headline must not
  // name the semantic index even while the discovery row reports it.
  //
  // The real capability list is read straight from the daemon by this test
  // process and fulfilled from that copy: re-reading it through the page
  // (`route.fetch()`) races the page's own dispatch of the same request and
  // can hand the same route object two handlers.
  const capabilityReply = await fetch(new URL("/api/v1/command", ctx.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "capability.list", input: {} }),
  });
  const capabilityBody = await capabilityReply.json();
  const capabilities = capabilityBody?.data?.capabilities ?? [];
  assert.ok(capabilities.some((capability) => capability?.id === "semantic-embedding"), `the daemon's capability list must report the semantic dimension: ${JSON.stringify(capabilities)}`);
  for (const capability of capabilities) {
    if (capability?.kind === "index-dimension" && capability?.id === "semantic-embedding") {
      capability.state = "UNAVAILABLE";
      capability.notes = "simulated unavailable semantic provider";
    }
  }
  await page.route("**/api/v1/command", async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
    if (payload?.operation === "capability.list") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(capabilityBody) });
      return;
    }
    await route.fallback();
  });
  await panel.getByRole("button", { name: /刷新事实|Refresh facts/ }).click();
  await page.waitForFunction(() => document.querySelector('.health-fact[data-fact="index-semantic"]')?.getAttribute("data-state") === "DEGRADED", null, { timeout: 15000 });
  const semanticSummary = (await summary.innerText()).trim();
  assert.doesNotMatch(semanticSummary, /semantic|语义/i, `a degraded discovery fact must never become the headline: ${semanticSummary}`);
  assert.ok(SUMMARY_FACT_IDS.includes(await summary.getAttribute("data-weakest")), `the headline must draw from the protection and recovery facts only: ${await summary.getAttribute("data-weakest")}`);
  const semanticRows = await factRows(panel);
  assertFourStateRows(semanticRows, "semantic index unavailable");
  const degradedSemantic = semanticRows.find((row) => row.fact === "index-semantic");
  assert.equal(degradedSemantic.group, "discovery", `the semantic row must stay in the discovery group: ${JSON.stringify(degradedSemantic)}`);
  assert.match(degradedSemantic.text, /^DEGRADED — /, `the semantic row must state its own degradation: ${degradedSemantic.text}`);
  assert.match(degradedSemantic.text, /UNAVAILABLE/, `the semantic row must state the capability it read: ${degradedSemantic.text}`);
  await page.unroute("**/api/v1/command");

  // 4. A service that reports a failed repository must be named in the summary,
  // and the writability field is absent in this projection: the row must say
  // UNKNOWN with its reason instead of guessing WRITABLE or zero.
  await page.route("**/api/v1/command", async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
    if (payload?.operation === "status.get") {
      const response = await route.fetch();
      const body = await response.json();
      if (body?.data?.repository) {
        body.data.repository.ok = false;
        delete body.data.repository.writable;
        delete body.data.repository.writable_reason;
        delete body.data.repository.writable_checked_at;
      }
      await route.fulfill({ response, json: body });
      return;
    }
    if (payload?.operation === "capability.list") {
      const response = await route.fetch();
      const body = await response.json();
      for (const capability of body?.data?.capabilities ?? []) {
        if (capability?.kind === "index-dimension" && capability?.id === "semantic-embedding") {
          capability.state = "UNAVAILABLE";
          capability.notes = "simulated unavailable semantic provider";
        }
      }
      await route.fulfill({ response, json: body });
      return;
    }
    await route.fallback();
  });
  await panel.getByRole("button", { name: /刷新事实|Refresh facts/ }).click();
  await page.waitForFunction(() => document.querySelector('.health-fact[data-fact="repository"]')?.getAttribute("data-state") === "FAILED", null, { timeout: 15000 });
  const degradedSummary = (await summary.innerText()).trim();
  assert.match(degradedSummary, /Repository unavailable|仓库不可用/, `a failed repository must be named in the summary: ${degradedSummary}`);
  assert.equal((await summary.getAttribute("data-health")), "FAILED", `the summary must state the failure: ${degradedSummary}`);
  assert.equal(await page.locator(".status-dot.ready").count(), 0, "an unavailable repository must not leave a readiness dot behind");
  const degradedRows = await factRows(panel);
  assertFourStateRows(degradedRows, "repository unavailable");
  const writability = degradedRows.find((row) => row.fact === "writability");
  assert.match(writability.text, /UNKNOWN — not probed|UNKNOWN — 未探测/, `an absent writability field must read UNKNOWN — not probed: ${writability.text}`);
  assert.doesNotMatch(writability.text, /WRITABLE|READ_ONLY|可写|只读/, `an absent probe must never claim a writability state: ${writability.text}`);
  const semantic = degradedRows.find((row) => row.fact === "index-semantic");
  assert.doesNotMatch(semantic.text, /ready|就绪/i, `the semantic row must not read ready while capability.list reports it UNAVAILABLE: ${semantic.text}`);
  assert.match(semantic.text, /UNAVAILABLE/, `the semantic row must state the capability it read: ${semantic.text}`);

  // 5. Restore the real projections and prove the surface recovers with them.
  await page.unroute("**/api/v1/command");
  await panel.getByRole("button", { name: /刷新事实|Refresh facts/ }).click();
  await page.waitForFunction(() => document.querySelector('.health-fact[data-fact="repository"]')?.getAttribute("data-state") === "PROVEN", null, { timeout: 15000 });
  const restoredSummary = (await summary.innerText()).trim();
  assert.doesNotMatch(restoredSummary, /Repository unavailable|仓库不可用/, `the summary must stop naming a recovered repository: ${restoredSummary}`);
  assertFourStateRows(await factRows(panel), "restored");
  if (await panel.getAttribute("open") !== null) await summary.click();
}

// The offline phase: with no service the surface may not prove, colour, or dot
// any health fact.
export async function assertStatusServiceDown(ctx) {
  const { page } = ctx;
  const panel = await openStatusPanel(ctx);
  const summary = panel.locator("summary.status-panel-summary");
  const summaryText = (await summary.innerText()).trim();
  assert.match(summaryText, /FAILED|UNKNOWN/, `the unreachable-service summary must state what it knows: ${summaryText}`);
  assert.match(summaryText, /service unreachable|服务不可达/, `the summary must name the unreachable service: ${summaryText}`);
  assert.equal(await page.locator(".status-dot").count(), 0, "no readiness dot may exist while the service is unreachable");
  assert.equal(await page.locator(".status-dot.ready").count(), 0, "no readiness dot may be ready while the service is unreachable");
  const rows = await factRows(panel);
  assertFourStateRows(rows, "service unreachable");
  for (const row of rows) {
    assert.notEqual(row.state, "PROVEN", `${row.fact} must not be proven while the service is unreachable: ${row.text}`);
  }
  const service = rows.find((row) => row.fact === "service");
  assert.equal(service.state, "FAILED", `the service row must report the failure: ${service.text}`);
  // Every fact that needs the service says why it cannot be proven instead of
  // falling back to a zero or a stale value.
  const repository = rows.find((row) => row.fact === "repository");
  assert.match(repository.text, /Cannot prove any health fact while the service is unreachable|服务不可达时无法证明任何健康事实/, `an unreachable service must be named on every fact it blocks: ${repository.text}`);
  const verification = rows.find((row) => row.fact === "verification");
  assert.match(verification.text, /Cannot prove any health fact while the service is unreachable|服务不可达时无法证明任何健康事实/, `the verification row must not keep a stale claim: ${verification.text}`);
  if (await panel.getAttribute("open") !== null) await summary.click();
}
