// Assertions for the details inspector's on-demand description action.
//
// Owner: the details surface (components/DetailsPanel.tsx and this module).
// `scripts/web-e2e.mjs` calls `assertDescriptionAction(ctx)` once, at the end
// of the online phase.
//
// What the daemon actually defines (probed against a real temporary daemon):
// `capability.list` advertises `description.list`, `description.get`, and
// `description.create`; a daemon that started without a describe provider
// profile does not advertise an AVAILABLE `description.generate` operation;
// that alone does not prove the implementation is absent. `description.create` stores a caller-supplied body
// (`source_ref: "command:description.create"`, `producer_profile: "command"`,
// `accepted: false`) and runs no provider, and an empty body is rejected with
// `invalid_input: body is required`. The default profile has
// `descriptions.enabled: true`, `generate: "on_demand"`, and an empty
// `provider_profile`/`credential_ref`.
//
// The initial disabled-state proof uses the real temporary daemon. The enabled
// provider branch below mocks browser responses and proves UI gating,
// confirmation, and Notes rendering only; it does not prove real model
// execution. These assertions prove the honest shape end to end: the action is disabled
// with a short visible reason and every unmet gate in a keyboard-expandable
// details disclosure (no provider profile, no DESCRIBE_SUBJECT operation,
// no live egress grant), it never sends a generation request on
// open or selection, and when the daemon does advertise the operation the
// action still needs one live DESCRIBE egress grant plus one explicit
// confirmation step that names what will be sent. The enabled path then
// dispatches `description.generate` exactly once with the egress confirmation,
// renders the daemon's own non-accepted result in the one Notes list, and the
// Accept action creates the accepted successor through `description.create`
// (same body, kind, and predecessor) - the model never self-accepts.

import assert from "node:assert/strict";
import { escapeRegExp } from "./support.mjs";

const describeButtonName = /生成描述|Generate a description/;
const describeUnavailableName = /选择描述提供方|Choose a description provider/;
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
// The inspector's own reads (`description.list`/`description.get`) plus its
// probe reads (config, capability, grant list) are the only operations this
// feature may send outside one explicit confirmed generation and its Accept.
function generationRequests(operations) {
  return operations.filter((operation) => /generate|describe(?!ription\.(list|get))/i.test(operation)
    || (operation.startsWith("description.") && operation !== "description.list" && operation !== "description.get"));
}

// A configured, healthy-looking settings document for the mocked enabled paths.
const configuredDescriptions = { enabled: true, generate: "on_demand", provider_profile: "fixture-describe-v1", credential_ref: "keychain://restoreweave/notes", retain_full_text: true };

// The live DESCRIBE egress grant row the enabled paths resolve, shaped like a
// real `egress.grant.list` entry.
const fixtureGrant = {
  grant_id: "egt_0000000000000000000000000000f1ea",
  workspace_id: "wsp_00000000000000000000000000000000",
  profile_id: "fixture-describe-v1",
  profile_digest: "sha256:000000000000000000000000000000000000000000000000000000000000f1ea",
  endpoint_host: "provider.example.invalid:443",
  model_id: "fixture-describe-model",
  purpose: "DESCRIBE",
  data_classes: ["text.subject_context"],
  subject_classes: ["EXACT_PROTECTED", "EXACT_FALLBACK", "EXTERNAL_REPLAYABLE"],
  max_requests: 4, max_bytes: 1048576, max_seconds: 120,
  expires_at: "2027-09-19T00:00:00Z",
  granted_by: "operator",
  created_at: "2026-09-18T00:00:00Z",
  live: true,
  revoked: false,
};

// capability.list mock that augments the daemon's real rows with an AVAILABLE
// description.generate operation, so the probe sees an honest wired daemon.
async function fulfillCapabilitiesWithGenerate(route) {
  const response = await route.fetch();
  let payload;
  try { payload = await response.json(); } catch { await route.fulfill({ response }); return; }
  payload.data = payload.data ?? {};
  payload.data.capabilities = payload.data.capabilities ?? [];
  payload.data.capabilities.push({ kind: "operation", id: "description.generate", state: "AVAILABLE", notes: "implemented by restoreweaved" });
  await route.fulfill({ status: response.status(), contentType: "application/json", body: JSON.stringify(payload) });
}

export async function assertDescriptionAction(ctx) {
  const { page } = ctx;
  const observed = { operations: [], descriptionListInputs: [], generateInputs: [], createInputs: [] };
  const onRequest = (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/command")) return;
    let payload;
    try { payload = request.postDataJSON(); } catch { return; }
    const operation = String(payload?.operation ?? "");
    observed.operations.push(operation);
    if (operation === "description.list") observed.descriptionListInputs.push(payload?.input ?? {});
    if (operation === "description.generate") observed.generateInputs.push(payload?.input ?? {});
    if (operation === "description.create") observed.createInputs.push(payload?.input ?? {});
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
  const expandDescribeReasons = async () => {
    const disclosure = describeAction().locator("details.describe-reason-details");
    if (!(await disclosure.evaluate((element) => element.open))) await disclosure.locator("summary").click();
    return describeAction().locator(".describe-reasons").innerText();
  };
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
    // inspected subject, is disabled, and a short reason stays connected to it
    // through aria-describedby while detailed gate names stay collapsed.
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
    assert.doesNotMatch(reasons, /descriptions\.|DESCRIBE_SUBJECT/, "internal setting keys and operation ids stay out of the default Notes view");
    const disclosure = describeAction().locator("details.describe-reason-details");
    assert.equal(await disclosure.evaluate((element) => element.open), false, "detailed unmet gates must start collapsed");
    await disclosure.locator("summary").focus();
    await page.keyboard.press("Enter");
    assert.equal(await disclosure.evaluate((element) => element.open), true, "keyboard activation of the details summary must expand unmet reasons");
    await page.keyboard.press("Enter");
    assert.equal(await disclosure.evaluate((element) => element.open), false, "keyboard activation must collapse detailed reasons again");
    const detailedReasons = await expandDescribeReasons();
    assert.match(detailedReasons, /descriptions\.provider_profile/, `the disclosure must include the missing provider profile: ${detailedReasons}`);
    assert.match(detailedReasons, /DESCRIBE_SUBJECT/, `the disclosure must include the unavailable capability: ${detailedReasons}`);
    await disclosure.locator("summary").click();
    // The disabled control is not focusable; the new disclosure summary may
    // receive focus as a normal keyboard-accessible details control.
    await page.getByRole("textbox", { name: /新备注|New note/ }).focus();
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press("Tab");
      const disabledActionFocused = await page.evaluate(() => document.activeElement?.matches(".describe-trigger") ?? false);
      assert.equal(disabledActionFocused, false, "the disabled description action must stay out of the tab order");
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
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow("disabled Notes action at 390x844");
    assert.equal(await describeAction().locator("details.describe-reason-details").evaluate((element) => element.open), false, "the phone-width Notes view must keep detailed gates collapsed by default");
    await capture("/tmp/rw-describe-disabled-390.png", ".detail-column .notes-section");
    await page.setViewportSize({ width: 1512, height: 950 });
    await page.waitForTimeout(100);

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
    const probeReason = await expandDescribeReasons();
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
    const configuredReason = await expandDescribeReasons();
    assert.match(configuredReason, /DESCRIBE_SUBJECT/, `a configured profile must still name the missing daemon capability: ${configuredReason}`);
    assert.doesNotMatch(configuredReason, /descriptions\.provider_profile|descriptions\.credential_ref/, `a configured profile and credential must clear their own gate: ${configuredReason}`);
    assert.equal(await describeTrigger().isDisabled(), true, "a configured profile must not enable a generation the daemon cannot run");
    assert.deepEqual(generationRequests(observed.operations), [], `a configured profile must not produce a made-up generation request: ${JSON.stringify(observed.operations)}`);
    await page.unroute("**/api/v1/command");
    await closeDetails();

    // 7. The daemon advertises description.generate and the settings select a
    // provider profile, but no live DESCRIBE egress grant exists: the action
    // stays disabled and names the missing grant, and still nothing is sent.
    await page.route("**/api/v1/command", async (route) => {
      let payload;
      try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
      if (payload?.operation === "config.get") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "org.restoreweave.result.v1", operation: "config.get", status: "SUCCEEDED", data: { config: { descriptions: configuredDescriptions } } }) });
        return;
      }
      if (payload?.operation === "capability.list") { await fulfillCapabilitiesWithGenerate(route); return; }
      if (payload?.operation === "egress.grant.list") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "org.restoreweave.result.v1", operation: "egress.grant.list", status: "SUCCEEDED", data: { grants: [] } }) });
        return;
      }
      await route.continue();
    });
    observed.operations.length = 0;
    await subjectButton("alpha.txt").click();
    await page.getByRole("main").getByRole("heading", { name: /^alpha\.txt$/ }).waitFor({ state: "visible", timeout: 10000 });
    await page.locator('.describe-action[data-describe-state="disabled"]').waitFor({ state: "visible", timeout: 10000 });
    const noGrantReason = await expandDescribeReasons();
    assert.match(noGrantReason, /egress\.grant\.list/, `a missing live grant must be named on the action: ${noGrantReason}`);
    assert.doesNotMatch(noGrantReason, /DESCRIBE_SUBJECT/, `a wired daemon clears its own capability gate: ${noGrantReason}`);
    assert.equal(await describeTrigger().isDisabled(), true, "no live egress grant must leave the action disabled");
    assert.deepEqual(generationRequests(observed.operations), [], `a missing grant must not be answered with a generation request: ${JSON.stringify(observed.operations)}`);
    await page.unroute("**/api/v1/command");
    await closeDetails();

    // 8. The full honest enabled path: wired daemon, configured profile, one
    // live DESCRIBE grant. Clicking shows ONE confirmation step that names
    // exactly what will be sent and which grant authorizes it; only the
    // explicit confirm dispatches description.generate, the daemon's own
    // non-accepted result renders in the one Notes list, and the Accept action
    // creates the accepted successor through description.create.
    const candidateID = "dsc_0000000000000000000000000000000f01";
    const candidateBody = "Fixture generated description: the archive item is a text note.";
    const successorID = "dsc_0000000000000000000000000000000f02";
    let alphaSubjectRefForFixture = "";
    await page.route("**/api/v1/command", async (route) => {
      let payload;
      try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
      if (payload?.operation === "config.get") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "org.restoreweave.result.v1", operation: "config.get", status: "SUCCEEDED", data: { config: { descriptions: configuredDescriptions } } }) });
        return;
      }
      if (payload?.operation === "capability.list") { await fulfillCapabilitiesWithGenerate(route); return; }
      if (payload?.operation === "egress.grant.list") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "org.restoreweave.result.v1", operation: "egress.grant.list", status: "SUCCEEDED", data: { grants: [fixtureGrant] } }) });
        return;
      }
      if (payload?.operation === "description.list") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "org.restoreweave.result.v1", operation: "description.list", status: "SUCCEEDED", data: { documents: [], truncated: false } }) });
        return;
      }
      if (payload?.operation === "description.generate") {
        assert.equal(String(payload?.input?.subject_ref ?? "").length > 0, true, "the generation must name its subject");
        assert.equal(payload?.input?.kind, "AI_SUMMARY", "the inspector generates AI_SUMMARY candidates");
        const confirmation = payload?.input?.egress_confirmation ?? {};
        assert.equal(confirmation.profile_id, fixtureGrant.profile_id, "the egress confirmation must bind the covering grant's profile");
        assert.equal(confirmation.profile_digest, fixtureGrant.profile_digest, "the egress confirmation must bind the profile digest");
        assert.equal(confirmation.endpoint_host, fixtureGrant.endpoint_host, "the egress confirmation must bind the destination host");
        assert.equal(confirmation.model, fixtureGrant.model_id, "the egress confirmation must bind the model");
        assert.equal(confirmation.purpose, "DESCRIBE", "the egress confirmation must carry the DESCRIBE purpose");
        assert.equal(confirmation.grant_id, fixtureGrant.grant_id, "the egress confirmation must bind the live grant id");
        alphaSubjectRefForFixture = String(payload.input.subject_ref);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "org.restoreweave.result.v1", operation: "description.generate", status: "SUCCEEDED", data: { document: {
          description_document_id: candidateID,
          workspace_id: "wsp_00000000000000000000000000000000",
          subject_ref: alphaSubjectRefForFixture,
          kind: "AI_SUMMARY",
          language: "und",
          body: candidateBody,
          body_digest: "sha256:0000000000000000000000000000000000000000000000000000000000000f01",
          source_ref: "provider:describe:fixture-describe-v1",
          producer_profile: "fixture-describe-v1",
          producer_profile_digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001",
          visibility: "private",
          accepted: false,
          revision: 1,
          predecessor_id: "",
          created_at: "2026-09-19T00:00:00Z",
          updated_at: "2026-09-19T00:00:00Z",
          segments: [],
        } } }) });
        return;
      }
      if (payload?.operation === "description.create") {
        assert.equal(payload?.input?.predecessor_id, candidateID, "the acceptance successor must name the candidate as its predecessor");
        assert.equal(payload?.input?.accepted, true, "the acceptance successor must be the user's accepted revision");
        assert.equal(payload?.input?.kind, "AI_SUMMARY", "the acceptance successor keeps the candidate's kind");
        assert.equal(payload?.input?.body, candidateBody, "the acceptance successor retains the candidate body");
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "org.restoreweave.result.v1", operation: "description.create", status: "SUCCEEDED", data: { document: {
          description_document_id: successorID,
          workspace_id: "wsp_00000000000000000000000000000000",
          subject_ref: alphaSubjectRefForFixture,
          kind: "AI_SUMMARY",
          language: "und",
          body: candidateBody,
          body_digest: "sha256:0000000000000000000000000000000000000000000000000000000000000f01",
          source_ref: "command:description.create",
          producer_profile: "command",
          visibility: "private",
          accepted: true,
          revision: 2,
          predecessor_id: candidateID,
          created_at: "2026-09-19T00:00:00Z",
          updated_at: "2026-09-19T00:00:00Z",
          segments: [],
        } } }) });
        return;
      }
      await route.continue();
    });
    observed.operations.length = 0;
    observed.generateInputs.length = 0;
    observed.createInputs.length = 0;
    await subjectButton("alpha.txt").click();
    await page.getByRole("main").getByRole("heading", { name: /^alpha\.txt$/ }).waitFor({ state: "visible", timeout: 10000 });
    await page.locator('.describe-action[data-describe-state="ready"]').waitFor({ state: "visible", timeout: 10000 });
    const readyTrigger = describeTrigger();
    assert.equal(await readyTrigger.isEnabled(), true, "a wired daemon with a live grant must enable the action");
    assert.deepEqual(generationRequests(observed.operations), [], `the ready action must still not send anything on its own: ${JSON.stringify(observed.operations)}`);
    await readyTrigger.click();
    const confirmBlock = describeAction().locator(".describe-confirm");
    await confirmBlock.waitFor({ state: "visible", timeout: 10000 });
    const confirmText = await confirmBlock.innerText();
    assert.match(confirmText, new RegExp(escapeRegExp(fixtureGrant.profile_id)), `the confirmation must name the provider profile: ${confirmText}`);
    assert.match(confirmText, new RegExp(escapeRegExp(fixtureGrant.endpoint_host)), `the confirmation must name the destination host: ${confirmText}`);
    assert.match(confirmText, new RegExp(escapeRegExp(fixtureGrant.grant_id)), `the confirmation must name the live grant: ${confirmText}`);
    assert.match(confirmText, /提取文本|extracted text/, `the confirmation must name what is sent: ${confirmText}`);
    assert.doesNotMatch(confirmText, /keychain:\/\//, "the confirmation must never carry credential material");
    assert.deepEqual(generationRequests(observed.operations), [], `the confirmation step itself must not dispatch anything: ${JSON.stringify(observed.operations)}`);
    await confirmBlock.getByRole("button", { name: /发送给模型提供方|Send to the model provider/ }).click();
    const generatedRow = page.locator('.notes-list .note-row.source-note[data-generated-description]').filter({ hasText: candidateBody });
    await generatedRow.waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await generatedRow.count(), 1, "the generated result must render exactly once in the Notes list");
    const generatedMeta = await generatedRow.locator(".note-meta").innerText();
    assert.match(generatedMeta, /AI/, `the generated note must carry its AI source label: ${generatedMeta}`);
    assert.match(generatedMeta, /未接受|Not accepted/, `the daemon's non-accepted state must stay visible: ${generatedMeta}`);
    assert.match(generatedMeta, /版本 1|revision 1/, `the generated note must keep its durable revision: ${generatedMeta}`);
    assert.equal(observed.generateInputs.length, 1, "exactly one confirmed generation request must be dispatched");
    assert.deepEqual(generationRequests(observed.operations), ["description.generate"], `only the confirmed generation may be a write: ${JSON.stringify(observed.operations)}`);
    await capture("/tmp/rw-describe-generated.png", ".notes-list .note-row.source-note[data-generated-description]");
    await assertNoOverflow("generated note at 1512x950");
    // Accept: the user's decision creates the accepted successor; the row then
    // shows the accepted state and the successor revision, and the candidate is
    // not duplicated anywhere in the Notes list.
    await generatedRow.getByRole("button", { name: /接受|Accept/ }).click();
    const acceptedRow = page.locator('.notes-list .note-row.source-note[data-generated-description]').filter({ hasText: candidateBody });
    await acceptedRow.getByText(/已接受|Accepted/).waitFor({ state: "visible", timeout: 10000 });
    const acceptedMeta = await acceptedRow.locator(".note-meta").innerText();
    assert.match(acceptedMeta, /版本 2|revision 2/, `the accepted successor must carry its own revision: ${acceptedMeta}`);
    assert.equal(observed.createInputs.length, 1, "the Accept action must dispatch exactly one description.create");
    assert.equal(await page.getByText(candidateBody, { exact: true }).count(), 1, "the accepted note must not be duplicated in the Notes list");
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
