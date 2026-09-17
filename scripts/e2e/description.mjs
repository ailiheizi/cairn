// Assertions for the details inspector's on-demand description action.
//
// Owner: the details surface (components/DetailsPanel.tsx and this module).
// `scripts/web-e2e.mjs` calls `assertDescriptionAction(ctx)` once, at the end
// of the online phase.
//
// What the daemon actually defines (probed against a real temporary daemon):
// `capability.list` advertises `description.list`, `description.get`, and
// `description.create`; there is no `description.generate`, no
// `subject.describe`, and no `DESCRIBE_SUBJECT` operation. `description.create`
// stores a caller-supplied body (`source_ref: "command:description.create"`,
// `producer_profile: "command"`, `accepted: false`) and runs no provider, and an
// empty body is rejected with `invalid_input: body is required`. The default
// profile has `descriptions.enabled: true`, `generate: "on_demand"`, and an
// empty `provider_profile`/`credential_ref`.
//
// These assertions therefore prove the honest shape instead of a fake one: the
// action exists for the inspected subject, is disabled, names every unmet gate
// (including the missing DESCRIBE_SUBJECT operation) on the button's own
// described-by element, and never sends a generation request - not on
// selection, not with a fully configured provider profile, not even when the
// settings read fails. Model-produced text that the daemon *does* return is
// asserted to render exactly, once, in the one Notes list with its source label
// and its non-accepted state, and a failed read is asserted to render the
// unavailable status with no fabricated record.

import assert from "node:assert/strict";
import { escapeRegExp } from "./support.mjs";

const describeButtonName = /生成描述|Generate a description/;
const describeUnavailableName = /暂时无法生成|Generation is unavailable/;
const notesUnavailable = /部分导入或生成的备注暂时不可用|Some imported or generated notes are unavailable/;

function waitForCondition(check, message, timeout = 10000) {
  return (async () => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await check();
      if (value) return value;
      if (Date.now() > deadline) assert.fail(message);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();
}

// A generation request is any description write or any describe/generate verb.
// The inspector's own reads (`description.list`/`description.get`) are the only
// description operations this feature may ever send today.
function generationRequests(operations) {
  return operations.filter((operation) => /generate|describe(?!ription\.(list|get))/i.test(operation)
    || (operation.startsWith("description.") && operation !== "description.list" && operation !== "description.get"));
}

export async function assertDescriptionAction(ctx) {
  const { page } = ctx;
  const observed = { operations: [], descriptionListInputs: [] };
  const onRequest = (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/command")) return;
    let payload;
    try { payload = request.postDataJSON(); } catch { return; }
    const operation = String(payload?.operation ?? "");
    observed.operations.push(operation);
    if (operation === "description.list") observed.descriptionListInputs.push(payload?.input ?? {});
  };
  page.on("request", onRequest);
  const subjectButton = (name) => page.getByRole("main").getByRole("button", { name: new RegExp(`^${escapeRegExp(name)}$`) }).first();
  const openSubject = async (name) => {
    await subjectButton(name).click();
    await page.getByRole("main").getByRole("heading", { name: new RegExp(`^${escapeRegExp(name)}$`) }).waitFor({ state: "visible", timeout: 10000 });
    await page.locator('.describe-action[data-describe-state="disabled"], .describe-action[data-describe-state="ready"]').waitFor({ state: "visible", timeout: 10000 });
  };
  const closeDetails = async () => {
    await page.getByRole("button", { name: /返回列表|Back to results/ }).click();
    await page.locator(".detail-column").waitFor({ state: "hidden", timeout: 10000 });
  };
  const describeAction = () => page.locator(".detail-column .notes-section .describe-action");
  const describeTrigger = () => describeAction().getByRole("button", { name: describeButtonName });
  const overflow = () => page.evaluate(() => ({
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  const assertNoOverflow = async (state) => {
    const measured = await overflow();
    console.log(`describe measurement (${state}): ${JSON.stringify(measured)}`);
    assert.ok(measured.scrollWidth <= measured.clientWidth, `${state}: horizontal overflow: ${JSON.stringify(measured)}`);
    assert.ok(measured.bodyScrollWidth <= measured.clientWidth, `${state}: body horizontal overflow: ${JSON.stringify(measured)}`);
    return measured;
  };
  // The measurement screenshots show the inspected control itself, not
  // whatever happens to be scrolled into view after the keyboard walk.
  const capture = async (path, selector) => {
    await page.locator(selector).first().evaluate((element) => element.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    await page.screenshot({ path });
  };

  try {
    // The desktop width the measurements and screenshots use; restored at the end.
    await page.setViewportSize({ width: 1512, height: 950 });
    await page.waitForTimeout(150);

    // 1. The default checkout: no provider profile, no credential reference,
    // and no daemon-side generation operation. The action exists for the
    // inspected subject, is disabled, and every unmet gate is named on the
    // element the button itself points at with aria-describedby.
    await openSubject("alpha.txt");
    assert.equal(await page.locator(".describe-action").count(), 1, "the inspector must own exactly one description action");
    assert.equal(await page.locator(".describe-action").first().evaluate((element) => element.closest(".notes-section") !== null), true, "the description action must live in the one Notes section");
    const trigger = describeTrigger();
    assert.equal(await trigger.count(), 1, "the Notes section must offer exactly one Generate a description control");
    assert.equal(await trigger.isDisabled(), true, "with no provider configured the action must be disabled");
    const describedBy = await trigger.getAttribute("aria-describedby");
    assert.ok(describedBy, "the disabled action must point at its reason with aria-describedby");
    const reasonBlock = page.locator(`[id="${describedBy}"]`);
    assert.equal(await reasonBlock.count(), 1, "the described-by reason block must exist exactly once");
    const reasons = await reasonBlock.innerText();
    assert.match(reasons, describeUnavailableName, `the action must say that generation is unavailable: ${reasons}`);
    assert.match(reasons, /descriptions\.provider_profile/, `the action must name the missing provider profile: ${reasons}`);
    assert.match(reasons, /DESCRIBE_SUBJECT/, `the action must name the missing capability: ${reasons}`);
    // The disabled control is not focusable, exactly like every other disabled
    // inspector control; a keyboard walk never lands on it.
    await page.getByRole("textbox", { name: /新备注|New note/ }).focus();
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => document.activeElement?.closest(".describe-action") !== null);
      assert.equal(inside, false, "a disabled description action must stay out of the tab order");
    }
    // Reading the inspector must not send a generation request, and waiting
    // changes nothing: the action is explicit, never polling and never implicit.
    const afterOpen = observed.operations.slice();
    assert.deepEqual(generationRequests(afterOpen), [], `opening the inspector must never send a generation request: ${JSON.stringify(afterOpen)}`);
    await page.waitForTimeout(400);
    assert.deepEqual(generationRequests(observed.operations), [], `the disabled action must stay quiet: ${JSON.stringify(observed.operations)}`);
    assert.equal(await trigger.isDisabled(), true, "the action must remain disabled without a daemon-side generation operation");
    // The subject the daemon itself reports for this selection; the mocked
    // payload below is bound to it so the inspector's subject check applies.
    const alphaRef = await waitForCondition(
      () => observed.descriptionListInputs.map((input) => String(input.subject_ref ?? "")).findLast((value) => value.length > 0),
      "the inspector must read the selected subject's descriptions from the daemon",
    );
    await capture("/tmp/rw-describe-disabled.png", ".detail-column .notes-section .describe-action");
    await assertNoOverflow("disabled action at 1512x950");

    // 2. Selection alone never triggers a request. Switching the inspected
    // subject issues the inspector's own bound reads only.
    observed.operations.length = 0;
    await openSubject("beta.txt");
    await page.waitForTimeout(400);
    assert.deepEqual(generationRequests(observed.operations), [], `selecting a subject must never send a generation request: ${JSON.stringify(observed.operations)}`);
    assert.equal(await describeTrigger().isDisabled(), true, "the action must be disabled for every subject while the daemon has no generation operation");

    // 3. Model-produced text the daemon returns is rendered exactly once, in
    // the existing Notes list, with its source label, its revision, and the
    // daemon's non-accepted state - never copied into a second note and never
    // auto-accepted. The payload below is shaped like a real
    // `description.create` result (`DescriptionDocumentData`): the body is what
    // the daemon returned, not something this browser wrote.
    const modelDocumentID = "dsc_0000000000000000000000000000007a";
    const modelBody = "Fixture model description: 7f3a exact payload text.";
    const modelSummary = {
      description_document_id: modelDocumentID,
      workspace_id: "wsp_00000000000000000000000000000000",
      subject_ref: alphaRef,
      kind: "AI_SUMMARY",
      language: "und",
      body_digest: "sha256:0000000000000000000000000000000000000000000000000000000000000f3a",
      source_ref: "processor:describesubject.fixture-v1",
      producer_profile: "fixture-describe-v1",
      visibility: "private",
      accepted: false,
      revision: 1,
      created_at: "2026-09-17T00:00:00Z",
      updated_at: "2026-09-17T00:00:00Z",
    };
    await page.route("**/api/v1/command", async (route) => {
      let payload;
      try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
      if (payload?.operation === "description.list") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "org.restoreweave.result.v1", operation: "description.list", status: "SUCCEEDED", data: { documents: [modelSummary], truncated: false } }) });
        return;
      }
      if (payload?.operation === "description.get") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "org.restoreweave.result.v1", operation: "description.get", status: "SUCCEEDED", data: { document: { ...modelSummary, body: modelBody, metadata: {}, segments: [] } } }) });
        return;
      }
      await route.continue();
    });
    observed.operations.length = 0;
    await openSubject("alpha.txt");
    const modelRow = page.locator(".notes-list .note-row.source-note").filter({ hasText: modelBody });
    await modelRow.waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await modelRow.count(), 1, "the daemon's model-produced note must render once in the Notes list");
    assert.equal((await modelRow.locator("p").innerText()).trim(), modelBody, "the rendered note must match the daemon's payload text exactly");
    const modelMeta = await modelRow.locator(".note-meta").innerText();
    assert.match(modelMeta, /AI/, `the rendered note must carry its model-produced source label: ${modelMeta}`);
    assert.match(modelMeta, /未接受|Not accepted/, `the daemon's non-accepted state must stay visible instead of being auto-accepted: ${modelMeta}`);
    assert.match(modelMeta, /版本 1|revision 1/, `the rendered note must keep its durable revision: ${modelMeta}`);
    assert.equal(await page.getByText(modelBody, { exact: true }).count(), 1, "model text must never be copied into a second note");
    assert.deepEqual(generationRequests(observed.operations), [], `rendering a model note must not send a generation request: ${JSON.stringify(observed.operations)}`);
    await capture("/tmp/rw-describe-done.png", ".notes-list .note-row.source-note");
    await assertNoOverflow("daemon model note at 1512x950");
    await page.unroute("**/api/v1/command");
    await openSubject("beta.txt");
    await openSubject("alpha.txt");

    // 4. A failed daemon read is reported as unavailable, and no record is
    // invented for the failed response.
    await page.route("**/api/v1/command", async (route) => {
      let payload;
      try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
      if (payload?.operation === "description.list") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "FAILED", reasons: [{ message: "simulated description outage" }] }) });
        return;
      }
      await route.continue();
    });
    observed.operations.length = 0;
    await openSubject("beta.txt");
    await openSubject("alpha.txt");
    await page.getByText(notesUnavailable).waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await page.locator(".notes-list .note-row.source-note").count(), 0, "a failed description read must not render a fabricated record");
    assert.equal(await page.getByText(/还没有备注|No notes yet/).count(), 0, "a failed read must not look like an empty answer");
    assert.equal(await describeTrigger().isDisabled(), true, "a failed description read must not enable the action");
    assert.deepEqual(generationRequests(observed.operations), [], `a failed read must not be answered with a generation request: ${JSON.stringify(observed.operations)}`);
    await page.unroute("**/api/v1/command");
    await openSubject("beta.txt");
    await openSubject("alpha.txt");

    // 5. The probe's own failure surfaces the daemon's reason, and the action
    // stays disabled instead of pretending the capability is known.
    await page.route("**/api/v1/command", async (route) => {
      let payload;
      try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
      if (payload?.operation === "config.get") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "FAILED", reasons: [{ message: "simulated settings outage" }] }) });
        return;
      }
      await route.continue();
    });
    observed.operations.length = 0;
    await closeDetails();
    await subjectButton("alpha.txt").click();
    await page.getByRole("main").getByRole("heading", { name: /^alpha\.txt$/ }).waitFor({ state: "visible", timeout: 10000 });
    await page.locator('.describe-action[data-describe-state="disabled"]').waitFor({ state: "visible", timeout: 10000 });
    const probeReason = await describeAction().locator(".describe-reasons").innerText();
    assert.match(probeReason, /simulated settings outage/, `a failed settings read must surface the daemon's own reason: ${probeReason}`);
    assert.equal(await describeTrigger().isDisabled(), true, "an unreadable settings response must leave the action disabled");
    assert.deepEqual(generationRequests(observed.operations), [], `an unreadable settings response must not be answered with a generation request: ${JSON.stringify(observed.operations)}`);
    await page.unroute("**/api/v1/command");
    await closeDetails();

    // 6. Even a fully configured description profile cannot enable the action
    // while the daemon advertises no generation operation: the reason then
    // names the missing DESCRIBE_SUBJECT capability, and still no request is
    // sent. A configured credential is a precondition, never a permit for this
    // browser to run a provider.
    await page.route("**/api/v1/command", async (route) => {
      let payload;
      try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
      if (payload?.operation === "config.get") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "org.restoreweave.result.v1", operation: "config.get", status: "SUCCEEDED", data: { config: { descriptions: { enabled: true, generate: "on_demand", provider_profile: "fixture-describe-v1", credential_ref: "keychain://restoreweave/notes", retain_full_text: true } } } }) });
        return;
      }
      await route.continue();
    });
    observed.operations.length = 0;
    await subjectButton("alpha.txt").click();
    await page.getByRole("main").getByRole("heading", { name: /^alpha\.txt$/ }).waitFor({ state: "visible", timeout: 10000 });
    await page.locator('.describe-action[data-describe-state="disabled"]').waitFor({ state: "visible", timeout: 10000 });
    const configuredReason = await describeAction().locator(".describe-reasons").innerText();
    assert.match(configuredReason, /DESCRIBE_SUBJECT/, `a configured profile must still name the missing daemon capability: ${configuredReason}`);
    assert.doesNotMatch(configuredReason, /descriptions\.provider_profile|descriptions\.credential_ref/, `a configured profile and credential must clear their own gate: ${configuredReason}`);
    assert.equal(await describeTrigger().isDisabled(), true, "a configured profile must not enable a generation the daemon cannot run");
    assert.deepEqual(generationRequests(observed.operations), [], `a configured profile must not produce a made-up generation request: ${JSON.stringify(observed.operations)}`);
    await page.unroute("**/api/v1/command");
    await closeDetails();
    await assertNoOverflow("library after the describe assertions at 1512x950");

    // Leave the page at its ordinary desktop size and view.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator(".result-list").or(page.locator(".empty-state")).first().waitFor({ state: "visible", timeout: 10000 });
  } finally {
    page.off("request", onRequest);
  }
}
