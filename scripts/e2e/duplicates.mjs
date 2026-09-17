// Assertions for the duplicate-group review surface (Tier-1 spec §3 item 4).
//
// Owner: components/DuplicatesSurface.tsx, styles/duplicates.css,
// i18n/duplicates.ts and this module. `scripts/web-e2e.mjs` calls it once in
// the online phase, after the status and search-operator phases.
//
// The assertions are written so a fabricated surface fails:
//
//   - every rendered group must be an exact-identity key (content_id +
//     logical_size) that appears at least twice in the daemon's own
//     `content.list` payload, and the fixture's two identical files must be
//     one group whose members share the daemon's content_id while their
//     daemon paths differ;
//   - a member's protection state must equal the outcome the daemon's own
//     `search.query` protection filter answered for that subject, and its
//     representation/placement facts must equal the daemon's own
//     `representation.list` answer — no browser guess may pass;
//   - the scope label must carry the loaded-listing count, and the empty state
//     must say it is not catalog-wide proof;
//   - no control on the surface may delete or move bytes: every button must
//     belong to the surface's non-destructive action set, and after clicking
//     through every control the recorded daemon operations must be only the
//     read set plus `annotation.upsert` (TAG/NOTE). A delete, move, merge,
//     keep-one, or export control cannot be present and still pass;
//   - the group headers keep the library's roving-tabindex pattern and Escape
//     returns focus to the duplicates rail entry.

import assert from "node:assert/strict";

const RAIL_ENTRY = 'button.workspace-nav-item[data-view="duplicates"]';
const SURFACE = ".duplicates-surface";

// The only operations this surface may ever ask the daemon for. The write set
// is exactly one operation, and it can only add a TAG or a NOTE.
const SURFACE_READ_OPERATIONS = ["content.list", "status.get", "annotation.list", "representation.list", "search.query"];
const SURFACE_WRITE_OPERATIONS = ["annotation.upsert"];
// The action set every rendered button must belong to. A surface that grows a
// destructive control fails this list before the wording of any label matters.
const SURFACE_ACTIONS = ["refresh", "toggle-group", "open-details", "close-details", "copy-path", "read-group-facts", "tag-selected", "add-note"];

const EMPTY_HEADING = /No duplicate groups over \d+ loaded subjects|已加载 \d+ 个主题中没有重复分组/;
const NOT_PROOF = /not proof that no duplicates exist catalog-wide|不能证明全目录不存在重复/;
const TAG_DONE = /Tag added to every selected member\.|已为所有所选成员添加标签。/;
const NOTE_DONE = /Note added to this member\.|已为此成员添加备注。/;

/** Waits for a captured daemon answer, because response bodies arrive asynchronously. */
async function until(page, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await page.waitForTimeout(50);
  }
  return predicate();
}

function exactIdentityKey(item) {
  const contentID = String(item?.content_id ?? "").trim();
  return contentID && item?.logical_size != null ? JSON.stringify([contentID, item.logical_size]) : "";
}

async function openDuplicates(ctx) {
  const { page } = ctx;
  if (await page.evaluate(() => Boolean(document.querySelector('[aria-modal="true"]')))) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
  }
  const entry = page.locator(RAIL_ENTRY);
  await entry.waitFor({ state: "visible", timeout: 10000 });
  await entry.click();
  const surface = page.locator(SURFACE);
  await surface.waitFor({ state: "visible", timeout: 10000 });
  return { entry, surface };
}

export async function assertDuplicateReview(ctx) {
  const { page } = ctx;

  // Module-local captures, all filled from the daemon's own traffic.
  const daemon = {
    contentLists: [],
    searchQueries: [],
    representationLists: new Map(),
    annotationUpserts: [],
    requests: [],
    writeOperations: [],
  };
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/command")) return;
    let payload;
    try { payload = request.postDataJSON(); } catch { return; }
    const operation = String(payload?.operation ?? "");
    const input = payload?.input ?? {};
    daemon.requests.push({ operation, input });
    if (SURFACE_WRITE_OPERATIONS.includes(operation)) daemon.writeOperations.push(operation);
    if (!SURFACE_READ_OPERATIONS.includes(operation) && !SURFACE_WRITE_OPERATIONS.includes(operation)) daemon.writeOperations.push(operation);
    if (operation === "annotation.upsert") daemon.annotationUpserts.push(input);
  });
  page.on("response", async (response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/v1/command")) return;
    let request;
    try { request = response.request().postDataJSON(); } catch { return; }
    let body;
    try { body = await response.json(); } catch { return; }
    const operation = String(request?.operation ?? "");
    if (operation === "content.list" && Array.isArray(body?.data?.items)) daemon.contentLists.push(body.data.items);
    if (operation === "search.query" && body?.data) daemon.searchQueries.push({ filters: request?.input?.filters ?? {}, data: body.data });
    if (operation === "representation.list" && body?.data) daemon.representationLists.set(String(body.data.subject_ref ?? ""), body.data.representations ?? []);
  });

  // 1. The rail entry opens the view over the daemon's own listing.
  const { entry, surface } = await openDuplicates(ctx);
  assert.equal(await entry.evaluate((node) => node.tagName), "BUTTON", "the duplicates rail entry must be a button");
  await surface.locator('.duplicates-scope[data-summary-source="content.list"]').waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => document.querySelector(".duplicates-surface")?.getAttribute("data-state") === "READY", null, { timeout: 20000 });
  assert.ok(await until(page, () => daemon.contentLists.length > 0), "the view must read the workspace listing with content.list");
  const listing = daemon.contentLists[daemon.contentLists.length - 1];
  assert.ok(listing.length > 0, "the fixture must have published content to review");

  // 2. Scope honesty: the label is the loaded-listing count, not a catalog claim.
  const scope = surface.locator(".duplicates-scope");
  const scopeCount = Number(await scope.getAttribute("data-loaded-subjects"));
  assert.equal(scopeCount, listing.length, "the scope label must carry the daemon listing's own subject count");
  assert.match((await scope.innerText()).trim(), /Duplicate groups over \d+ loaded subjects|已加载 \d+ 个主题中的重复分组/, "the scope label must be present");
  const surfaceText = await surface.innerText();
  assert.match(surfaceText, /separate subject|各自独立的主题/, "the surface must state that members are separate subjects");
  assert.match(surfaceText, /cannot delete, move, or merge|无法删除、移动或合并/, "the surface must state that it cannot delete, move, or merge");
  assert.match(surfaceText, /no grouping is ever inferred from similarity|不会依据相似度来推断/, "the surface must state that grouping never uses similarity");

  // 3. The fixture's two identical files are one exact-identity group.
  const alpha = listing.find((item) => String(item.name ?? "") === "alpha.txt");
  const beta = listing.find((item) => String(item.name ?? "") === "beta.txt");
  assert.ok(alpha && beta, `the fixture must publish alpha.txt and beta.txt: ${listing.map((item) => item.name).join(", ")}`);
  assert.equal(exactIdentityKey(alpha), exactIdentityKey(beta), "the fixture's identical files must share the daemon's (content_id, logical_size) identity");
  const fixtureKey = exactIdentityKey(alpha);
  const fixtureContentID = String(alpha.content_id ?? "");
  const group = surface.locator(`.duplicate-group[data-group-key="${fixtureKey.replace(/"/g, '\\"')}"]`);
  await group.first().waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await surface.locator(`.duplicate-group[data-content-id="${fixtureContentID}"]`).count(), 1, "the two identical files must render as exactly one group");
  assert.ok(Number(await group.getAttribute("data-member-count")) >= 2, "the identical files must render as one group of two or more members");
  const groupMembers = await group.locator(".duplicate-member").evaluateAll((nodes) => nodes.map((node) => ({
    ref: node.getAttribute("data-subject-ref") ?? "",
    contentID: node.getAttribute("data-content-id") ?? "",
    path: node.getAttribute("data-path") ?? "",
    size: node.getAttribute("data-logical-size") ?? "",
    entryType: node.getAttribute("data-entry-type") ?? "",
    protection: node.getAttribute("data-protection-state") ?? "",
    representation: node.getAttribute("data-representation-state") ?? "",
  })));
  const renderedAlpha = groupMembers.find((member) => member.ref === String(alpha.subject_ref ?? ""));
  const renderedBeta = groupMembers.find((member) => member.ref === String(beta.subject_ref ?? ""));
  assert.ok(renderedAlpha && renderedBeta, `the group must render both daemon subjects: ${JSON.stringify(groupMembers.map((member) => member.ref))}`);
  for (const [rendered, item] of [[renderedAlpha, alpha], [renderedBeta, beta]]) {
    assert.equal(rendered.contentID, String(item.content_id ?? ""), "every member must carry the daemon's own content_id");
    assert.equal(rendered.contentID, fixtureContentID, "members of one group share one exact identity");
    assert.equal(rendered.path, String(item.path ?? ""), "every member must carry the daemon's own provenance path");
    assert.equal(rendered.size, String(item.logical_size ?? ""), "every member must carry the daemon's own logical size");
    assert.equal(rendered.entryType, String(item.entry_type ?? ""), "every member must carry the daemon's own entry type");
  }
  assert.notEqual(renderedAlpha.path, renderedBeta.path, "members of one group must render their distinct daemon paths");
  assert.notEqual(renderedAlpha.ref, renderedBeta.ref, "members of one group are distinct subjects");

  // Every rendered group must be a repeated exact-identity key of the daemon
  // listing: a browser that fabricated a group fails here.
  const listedKeys = new Map();
  for (const item of listing) {
    const key = exactIdentityKey(item);
    if (key) listedKeys.set(key, (listedKeys.get(key) ?? 0) + 1);
  }
  const renderedGroups = await surface.locator(".duplicate-group").evaluateAll((nodes) => nodes.map((node) => ({
    key: node.getAttribute("data-group-key") ?? "",
    contentID: node.getAttribute("data-content-id") ?? "",
    memberCount: Number(node.getAttribute("data-member-count") ?? "0"),
  })));
  assert.ok(renderedGroups.length > 0, "the fixture's identical files must produce at least one group");
  for (const rendered of renderedGroups) {
    assert.ok((listedKeys.get(rendered.key) ?? 0) > 1, `every rendered group must be a repeated exact-identity key of the daemon listing: ${rendered.key}`);
    assert.ok(rendered.memberCount > 1, `a group of one must never be rendered: ${rendered.key}`);
    assert.ok(rendered.contentID.startsWith("sha256:"), `the group identity must be the daemon's SHA-256 content id: ${rendered.contentID}`);
  }

  // 4. The daemon's duplicate-group filter is what confirms the group, and its
  // members are the daemon's own answer — not a client-side grouping.
  assert.ok(await until(page, () => daemon.searchQueries.some((query) => String(query.filters?.duplicate_group ?? "") === fixtureContentID)),
    "the surface must ask the daemon's duplicate-group filter about the group");
  const membershipQuery = daemon.searchQueries.filter((query) => String(query.filters?.duplicate_group ?? "") === fixtureContentID && !query.filters?.protection_mode).pop();
  assert.ok(membershipQuery, "the membership answer must be a duplicate_group filter query");
  const daemonMemberRefs = (membershipQuery.data.hits ?? []).map((hit) => String(hit.subject_ref ?? "")).sort();
  assert.ok(daemonMemberRefs.includes(String(alpha.subject_ref ?? "")) && daemonMemberRefs.includes(String(beta.subject_ref ?? "")),
    `the daemon's duplicate-group filter must return both fixture subjects: ${JSON.stringify(daemonMemberRefs)}`);
  assert.equal(await group.getAttribute("data-daemon-confirmation"), "CONFIRMED", "the group must carry the daemon's own membership confirmation");
  assert.deepEqual(groupMembers.map((member) => member.ref).sort(), daemonMemberRefs, "the rendered members must be the daemon's own duplicate-group answer");

  // 5. Per-member facts: logical size, path, entry type, protection outcome,
  // representation, and placement — each compared with the daemon's answer.
  const protectionBySubject = new Map();
  for (const query of daemon.searchQueries) {
    const outcome = String(query.filters?.protection_mode ?? "");
    if (!outcome || String(query.filters?.duplicate_group ?? "") !== fixtureContentID) continue;
    for (const hit of query.data.hits ?? []) protectionBySubject.set(String(hit.subject_ref ?? ""), outcome);
  }
  const factsOf = async (ref) => {
    const member = group.locator(`.duplicate-member[data-subject-ref="${ref}"]`);
    return {
      member,
      path: (await member.locator('[data-fact="path"]').innerText()).trim(),
      size: (await member.locator('[data-fact="logical-size"]').innerText()).trim(),
      entryType: (await member.locator('[data-fact="entry-type"]').innerText()).trim(),
      protection: (await member.locator('[data-fact="protection"]').innerText()).trim(),
      representation: (await member.locator('[data-fact="representation"]').innerText()).trim(),
      placement: (await member.locator('[data-fact="placement"]').innerText()).trim(),
    };
  };
  for (const [rendered, item] of [[renderedAlpha, alpha], [renderedBeta, beta]]) {
    const facts = await factsOf(rendered.ref);
    const path = String(item.path ?? "");
    const size = Number(item.logical_size ?? 0);
    assert.ok(facts.path.includes(path), `the member must show its provenance path ${path}: ${facts.path}`);
    assert.ok(facts.size.includes(`${size} B`), `the member must show its logical size ${size} B: ${facts.size}`);
    assert.ok(facts.entryType.length > 0, "the member must show its entry type");
    // The protection outcome is the daemon's own protection-axis answer.
    const daemonOutcome = protectionBySubject.get(rendered.ref) ?? "";
    if (daemonOutcome) {
      assert.equal(await facts.member.getAttribute("data-protection-state"), daemonOutcome, "the member's protection state must be the daemon's own outcome");
      assert.equal(await facts.member.getAttribute("data-protection-known"), "true", "a claimed protection outcome must render as known");
      assert.ok(facts.protection.includes(daemonOutcome), `the protection fact must name the daemon's outcome ${daemonOutcome}: ${facts.protection}`);
    } else {
      assert.equal(await facts.member.getAttribute("data-protection-state"), "UNKNOWN", "an outcome the daemon did not claim must render as UNKNOWN");
      assert.equal(await facts.member.getAttribute("data-protection-known"), "false", "an unclaimed protection outcome must not render as known");
    }
    // The representation and placement facts are the daemon's own rows.
    assert.ok(await until(page, () => daemon.representationLists.has(rendered.ref)), `the member's representation must be read with representation.list: ${rendered.ref}`);
    const rows = daemon.representationLists.get(rendered.ref) ?? [];
    const exactRow = rows.find((row) => row.class === "EXACT") ?? rows[0];
    assert.ok(exactRow, `the daemon must report a representation for ${rendered.ref}`);
    assert.equal(await facts.member.getAttribute("data-representation-state"), "READY", "an answered representation read must render as READY");
    assert.equal(await facts.member.getAttribute("data-representation-codec"), String(exactRow.codec_profile_ref ?? ""), "the member's representation codec must be the daemon's own row");
    assert.equal(await facts.member.getAttribute("data-placement"), String(exactRow.placement ?? "unknown"), "the member's placement must be the daemon's own probe result");
    assert.ok(facts.representation.includes(String(exactRow.codec_profile_ref ?? "\u0000")), `the representation fact must name the daemon's codec: ${facts.representation}`);
    assert.ok(facts.placement.includes(String(exactRow.placement ?? "\u0000")), `the placement fact must name the daemon's own placement: ${facts.placement}`);
  }

  // 6. A member's details open from the group and show the daemon's identity.
  const alphaMember = group.locator(`.duplicate-member[data-subject-ref="${renderedAlpha.ref}"]`);
  await alphaMember.locator('[data-action="open-details"]').first().click();
  const details = alphaMember.locator(".duplicate-member-details");
  await details.waitFor({ state: "visible", timeout: 10000 });
  assert.equal((await details.locator('[data-fact="detail-subject-ref"]').innerText()).trim(), renderedAlpha.ref, "the opened details must name the daemon's subject_ref");
  assert.equal((await details.locator('[data-fact="detail-content-id"]').innerText()).trim(), fixtureContentID, "the opened details must name the daemon's content_id");
  const alphaRepresentation = (daemon.representationLists.get(renderedAlpha.ref) ?? [])[0];
  if (alphaRepresentation?.representation_id) {
    assert.ok((await details.innerText()).includes(String(alphaRepresentation.representation_id)), "the opened details must render the daemon's representation row");
  }

  // 7. The only writes are tags and notes: tag the selected members, then note
  // one member. Both go through annotation.upsert, and the rendered state must
  // come back from the daemon's own annotation record.
  const tagBody = `e2e-duplicate-review-${Date.now()}`;
  await group.locator(".duplicate-member-select").first().check();
  await group.locator(".duplicate-member-select").nth(1).check();
  const selection = surface.locator(".duplicates-selection");
  await selection.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(Number(await selection.getAttribute("data-selected-count")), 2, "the selection must report its own count");
  await selection.locator('input[list="restoreweave-duplicates-tag-vocabulary"]').fill(tagBody);
  const upsertsBeforeTag = daemon.annotationUpserts.length;
  await selection.locator('[data-action="tag-selected"]').click();
  await surface.locator(`.duplicates-action[data-action-state="DONE"]`).waitFor({ state: "visible", timeout: 15000 });
  assert.match((await surface.locator(".duplicates-action").innerText()).trim(), TAG_DONE, "the tag result must be reported");
  const tagUpserts = daemon.annotationUpserts.slice(upsertsBeforeTag).filter((input) => input.kind === "TAG");
  assert.equal(tagUpserts.length, 2, `tagging two selected members must issue exactly two TAG annotations: ${JSON.stringify(tagUpserts)}`);
  assert.deepEqual(tagUpserts.map((input) => String(input.subject_ref)).sort(), [renderedAlpha.ref, renderedBeta.ref].sort(), "the tag writes must target exactly the selected members");
  for (const input of tagUpserts) assert.equal(String(input.body), tagBody, "the tag write must carry the typed body");
  const alphaTags = (await alphaMember.locator('[data-fact="tags"]').innerText()).trim();
  assert.ok(alphaTags.includes(tagBody), `the member's tags must show the daemon's new annotation: ${alphaTags}`);

  const noteBody = `duplicate review note ${Date.now()}`;
  const upsertsBeforeNote = daemon.annotationUpserts.length;
  await details.locator("input").first().fill(noteBody);
  await details.locator('[data-action="add-note"]').click();
  await details.locator(`.duplicate-note-state[data-note-state="DONE"]`).waitFor({ state: "visible", timeout: 15000 });
  assert.match((await details.locator(".duplicate-note-state").innerText()).trim(), NOTE_DONE, "the note result must be reported");
  const noteUpserts = daemon.annotationUpserts.slice(upsertsBeforeNote).filter((input) => input.kind === "NOTE");
  assert.equal(noteUpserts.length, 1, `adding one note must issue exactly one NOTE annotation: ${JSON.stringify(noteUpserts)}`);
  assert.equal(String(noteUpserts[0].subject_ref), renderedAlpha.ref, "the note write must target the member whose details are open");
  assert.equal(String(noteUpserts[0].body), noteBody, "the note write must carry the typed body");
  assert.ok((await details.locator(".duplicate-note-list").innerText()).includes(noteBody), "the member's notes must show the daemon's new annotation");

  // 8. Non-destructive by construction: every control belongs to the
  // surface's action set, and clicking through every control issues only the
  // read set plus annotation.upsert. No delete, move, merge, keep-one, or
  // export action exists to be worded any way at all.
  const controls = await surface.locator("button").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-action") ?? ""));
  assert.ok(controls.length >= 5, `the surface must render its review controls: ${JSON.stringify(controls)}`);
  for (const action of controls) assert.ok(SURFACE_ACTIONS.includes(action), `every control must belong to the non-destructive action set: ${action || "(none)"}`);
  assert.ok(controls.includes("copy-path") && controls.includes("open-details") && controls.includes("refresh"), `the review controls must be present: ${JSON.stringify(controls)}`);
  assert.equal(await surface.locator('[data-action="delete"], [data-action="move"], [data-action="merge"], [data-action="keep"]').count(), 0, "no destructive action may exist on the surface");

  const sweepStart = daemon.requests.length;
  // Click through every control of the review actions, always taking the first
  // match because toggling details changes the action of the control it clicks.
  for (const selector of ['[data-action="copy-path"]', '[data-action="open-details"]', '[data-action="close-details"]', '[data-action="toggle-group"]', '[data-action="refresh"]']) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const control = surface.locator(selector).first();
      if (await control.count() === 0) break;
      if (!(await control.isEnabled())) break;
      await control.click();
      await page.waitForTimeout(150);
    }
  }
  await page.waitForTimeout(400);
  const sweptOperations = [...new Set(daemon.requests.slice(sweepStart).map((request) => request.operation))];
  for (const operation of sweptOperations) {
    assert.ok(SURFACE_READ_OPERATIONS.includes(operation) || SURFACE_WRITE_OPERATIONS.includes(operation), `no control may issue another operation: ${operation}`);
  }
  for (const request of daemon.requests.slice(sweepStart)) {
    if (!SURFACE_WRITE_OPERATIONS.includes(request.operation)) continue;
    assert.ok(request.operation === "annotation.upsert" && ["TAG", "NOTE"].includes(String(request.input?.kind)), `the only write a control may issue is an annotation TAG or NOTE: ${JSON.stringify(request)}`);
  }
  for (const request of daemon.requests.slice(sweepStart)) {
    assert.ok(!("destination" in (request.input ?? {})) && !("target" in (request.input ?? {})) && !("output_names" in (request.input ?? {})), `no control may name an output destination: ${JSON.stringify(request)}`);
  }
  const groupMembersAfter = await group.locator(".duplicate-member").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-subject-ref") ?? ""));
  assert.deepEqual(groupMembersAfter.sort(), groupMembers.map((member) => member.ref).sort(), "reviewing must leave every member exactly where it was");

  // 9. Empty for the loaded listing only, and blocked is a different fact.
  let mockMode = "empty";
  let mockSearchUnavailable = false;
  const routeMock = async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
    if (payload?.operation === "search.query" && mockSearchUnavailable) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "DEGRADED",
          reasons: [{ message: "search index is unavailable: simulated" }],
          data: { components: [{ dimension: "lexical-metadata-fts", query_provider_ref: "query.lexical.fts5.v1", score_semantics: "fts5-rank", status: "DEGRADED", hits: 0 }], hits: [] },
        }),
      });
      return;
    }
    if (payload?.operation !== "content.list") { await route.continue(); return; }
    if (mockMode === "blocked") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "FAILED", reasons: [{ message: "simulated duplicates outage" }] }) });
      return;
    }
    const items = mockMode === "two-groups" ? [
      // The fixture's own pair keeps its daemon identity, so a deliberate
      // representation failure can be injected for one of its members, and a
      // second fabricated pair proves the keyboard pattern over two groups.
      alpha,
      beta,
      { subject_ref: "subj_e2e_dup_c", name: "three.txt", path: "three.txt", entry_type: "REGULAR_FILE", content_id: "sha256:e2e-group-two", logical_size: 7 },
      { subject_ref: "subj_e2e_dup_d", name: "four.txt", path: "sub/four.txt", entry_type: "REGULAR_FILE", content_id: "sha256:e2e-group-two", logical_size: 7 },
    ] : [
      { subject_ref: "subj_e2e_single_a", name: "only-one.txt", path: "only-one.txt", entry_type: "REGULAR_FILE", content_id: "sha256:e2e-unique", logical_size: 5 },
      { subject_ref: "subj_e2e_single_b", name: "also-unique.txt", path: "also-unique.txt", entry_type: "REGULAR_FILE", content_id: "sha256:e2e-unique-two", logical_size: 6 },
    ];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "SUCCEEDED", data: { workspace_id: "wsp_e2e", root_id: "", items } }) });
  };
  await page.route("**/api/v1/command", async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
    if (payload?.operation === "content.list" || (mockSearchUnavailable && payload?.operation === "search.query")) { await routeMock(route); return; }
    if (payload?.operation === "representation.list" && payload?.input?.subject_ref === renderedBeta.ref) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "FAILED", reasons: [{ message: "simulated representation outage" }] }) });
      return;
    }
    await route.continue();
  });

  await surface.locator('[data-action="refresh"]').click();
  const empty = surface.locator('.duplicates-empty[data-empty="true"]');
  await empty.waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await surface.locator(".duplicate-group").count(), 0, "an empty listing renders no group");
  assert.equal(Number(await surface.locator(".duplicates-scope").getAttribute("data-loaded-subjects")), 2, "the empty state must still carry the loaded-listing count");
  const emptyText = (await empty.innerText()).trim();
  assert.match(emptyText, EMPTY_HEADING, `the empty state must name the loaded-listing scope: ${emptyText}`);
  assert.match(emptyText, NOT_PROOF, `the empty state must never be presented as catalog-wide proof: ${emptyText}`);

  // 10. Degraded is visible: one member's representation read fails, so that
  // member's fact is UNKNOWN with its reason while the rest stays readable.
  mockMode = "two-groups";
  await surface.locator('[data-action="refresh"]').click();
  const mockGroups = surface.locator(".duplicate-group");
  await mockGroups.first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll(".duplicate-group").length === 2, null, { timeout: 15000 });
  const failedMember = surface.locator(`.duplicate-member[data-subject-ref="${renderedBeta.ref}"]`);
  await failedMember.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(() => document.querySelector(".duplicates-surface")?.getAttribute("data-partial") === "true", null, { timeout: 20000 });
  const partial = surface.locator('.duplicates-partial[data-state="PARTIAL"]');
  await partial.waitFor({ state: "visible", timeout: 10000 });
  assert.match((await partial.innerText()).trim(), /Some member facts could not be read|部分成员事实无法读取/, "a failed fact read must be visible as a partial listing");
  assert.equal(await failedMember.getAttribute("data-representation-state"), "FAILED", "the failed member must report its failed representation read");
  assert.match((await failedMember.locator('[data-fact="representation"]').innerText()).trim(), /simulated representation outage/, "the failed fact must carry the daemon's reason");

  // 10b. An unreadable projection is not a licence to guess: with the daemon's
  // protection axis unavailable, exact-identity grouping still renders (it uses
  // content_id + logical_size, not the index) while every protection fact says
  // UNKNOWN with the reason, and the partial banner names the gap.
  mockSearchUnavailable = true;
  await surface.locator('[data-action="refresh"]').click();
  await page.waitForFunction(() => document.querySelector(".duplicates-surface")?.getAttribute("data-partial") === "true" && document.querySelectorAll(".duplicate-group").length === 2, null, { timeout: 20000 });
  const unreadable = surface.locator(`.duplicate-member[data-subject-ref="${renderedAlpha.ref}"]`);
  await unreadable.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction((ref) => document.querySelector(`.duplicate-member[data-subject-ref="${ref}"]`)?.getAttribute("data-protection-known") === "false", renderedAlpha.ref, { timeout: 20000 });
  assert.equal(await unreadable.getAttribute("data-protection-state"), "UNKNOWN", "an unreadable protection axis must render UNKNOWN, never a guessed outcome");
  const unreadableFact = (await unreadable.locator('[data-fact="protection"]').innerText()).trim();
  assert.match(unreadableFact, /UNKNOWN|protection axis could not be read|无法读取保护轴/, `the protection fact must carry its reason: ${unreadableFact}`);
  assert.match(unreadableFact, /search index is unavailable: simulated/, `the protection fact must carry the daemon's own reason: ${unreadableFact}`);
  assert.ok(Number(await surface.locator(".duplicate-group").first().getAttribute("data-member-count")) === 2, "exact-identity grouping must not depend on the search projection");
  // The unavailable fact stays retryable: the control is live, not decorative.
  const retry = surface.locator('[data-action="read-group-facts"]').first();
  await retry.waitFor({ state: "visible", timeout: 10000 });
  const searchesBeforeRetry = daemon.requests.filter((request) => request.operation === "search.query").length;
  await retry.click();
  assert.ok(await until(page, () => daemon.requests.filter((request) => request.operation === "search.query").length > searchesBeforeRetry), "the retry control must re-run the fact reads");
  mockSearchUnavailable = false;
  await surface.locator('[data-action="refresh"]').click();
  await page.waitForFunction(() => document.querySelector(".duplicates-surface")?.getAttribute("data-partial") === "true" && document.querySelectorAll(".duplicate-group").length === 2, null, { timeout: 20000 });

  // 11. Keyboard: one tab stop for the group list, arrow movement between the
  // mocked groups, Escape back to the rail entry.
  const toggles = surface.locator(".duplicate-group-toggle");
  assert.equal(await toggles.count(), 2, "the mocked listing must render two groups");
  await toggles.first().focus();
  assert.equal(await surface.locator('.duplicate-group-toggle[tabindex="0"]').count(), 1, "the group list must own exactly one tab stop");
  assert.equal(await surface.locator('.duplicate-group-toggle[tabindex="-1"]').count(), 1, "every other group must leave the tab order");
  const focusedGroup = () => page.evaluate(() => Number(document.activeElement?.closest("[data-duplicate-group-index]")?.getAttribute("data-duplicate-group-index") ?? -1));
  await page.keyboard.press("ArrowDown");
  assert.equal(await focusedGroup(), 1, "Arrow Down must move to the next group");
  await page.keyboard.press("ArrowUp");
  assert.equal(await focusedGroup(), 0, "Arrow Up must move back to the previous group");
  await page.keyboard.press("End");
  assert.equal(await focusedGroup(), 1, "End must jump to the last group");
  await page.keyboard.press("Home");
  assert.equal(await focusedGroup(), 0, "Home must jump to the first group");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-view")), "duplicates", "Escape must return focus to the duplicates rail entry");
  assert.ok(await until(page, () => daemon.writeOperations.every((operation) => operation === "annotation.upsert")), `no non-annotation write may ever be issued from this surface: ${JSON.stringify(daemon.writeOperations)}`);

  // Leave the page on the ordinary library view again.
  await page.unroute("**/api/v1/command");
  await page.getByRole("button", { name: /^(Library|内容库)/ }).click();
  await page.locator(".result-list").or(page.locator(".empty-state")).first().waitFor({ state: "visible", timeout: 10000 });
}
