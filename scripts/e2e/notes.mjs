// Assertions for the read-oriented global Notes view (decision brief
// `docs/technical/notes-surface-decision.md`, Option B and its section 5).
//
// Owner: components/NotesSurface.tsx, the notes block of styles/library.css,
// the notes keys of i18n/library.ts and this module. `scripts/web-e2e.mjs`
// calls it once in the online phase, after the description action.
//
// The assertions are written so a fabricated surface fails:
//
//   - every rendered row must correspond to a daemon record: each note row is
//     a live NOTE record of the surface's own `annotation.list` answer (its
//     annotation id, revision and body), the row names the subject's own
//     display name from the workspace listing, and every live NOTE record the
//     daemon returned must render;
//   - descriptions are the current leaves only: a successor hides its
//     predecessor, and the summary carries no body until its own row is
//     expanded — expanding issues exactly one `description.get` for that one
//     document and a second expand re-uses the loaded body;
//   - the surface issues only its read set (`annotation.list`,
//     `description.list`, `description.get`, and `content.list` for the
//     subject names the note reads do not carry; see the module comment in
//     NotesSurface.tsx), and no durable write is issued anywhere in this
//     module, which includes the row click that opens the details inspector;
//   - no control that could create a durable record exists: the only controls
//     are the refresh, a row (navigation), and a description row's body
//     toggle, and the surface has no composer, editor, tag control, or delete;
//   - empty, partial, and blocked are three different facts: the empty state
//     names the two reads it owns instead of claiming an empty catalog, a
//     truncated description answer says the list is partial, and a failed note
//     read renders the daemon's own message.
//
// The assertions are locale-agnostic: they read the surface's own data
// attributes and the daemon's traffic, and only the honesty copy is matched by
// either-language patterns.

import assert from "node:assert/strict";
import { assertNoHorizontalOverflow } from "./support.mjs";

const RAIL_ENTRY = 'button.workspace-nav-item[data-view="notes"]';
const SURFACE = ".notes-surface";

// The only operations the notes surface itself may issue. `content.list` is in
// the read set on purpose: neither `annotation.list` nor `description.list`
// carries a subject display name (client/command/data.go AnnotationData /
// DescriptionSummaryData), and `content.list` is the same listing read the
// tags surface and the shell already use to resolve names and paths.
const SURFACE_READ_OPERATIONS = ["annotation.list", "description.list", "description.get", "content.list"];
// Every operation that creates, mutates, or retires a durable record. None may
// be issued at any point in this module; the surface has no write control, and
// opening a subject's details must not write either.
const DURABLE_WRITE_PATTERN = /^(annotation\.(upsert|delete|tag_apply|tag_plan)|description\.(create|generate)|config\.update|view\.save|plan\.apply|source\.staging_clean|image\.bundle|semantic\.bundle)/;
// The action set every rendered button of the surface must belong to.
const SURFACE_ACTIONS = ["refresh", "open-subject", "toggle-description"];

const EMPTY_TITLE = /No notes here yet|此处暂无备注/;
const EMPTY_READS = /live NOTE annotation records|存续 NOTE 注释记录/;
const EMPTY_NOT_CATALOG = /not a claim that the catalog holds no notes|并不代表目录中没有备注/;
const PARTIAL_COPY = /description list is partial|描述列表不完整/;
const READ_ONLY_COPY = /read-only view|只读视图/;
const SUMMARY_COPY = /expand this row to read the stored body|展开此行即可读取已存储的正文/;
const BLOCKED_REASON = /simulated notes outage/;

/** Waits for a captured daemon answer, because response bodies arrive asynchronously. */
async function until(page, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await page.waitForTimeout(50);
  }
  return predicate();
}

/** The daemon's own live NOTE records, exactly as `annotation.list` returned them. */
function liveNoteRecords(annotations, kind = "NOTE") {
  return (annotations ?? []).filter((record) => record?.kind === kind && !record?.tombstoned);
}

/** The current description leaves of a daemon answer: a successor hides its predecessor. */
function currentDescriptionLeaves(documents) {
  const superseded = new Set((documents ?? []).map((document) => String(document?.predecessor_id ?? "")).filter(Boolean));
  return (documents ?? []).filter((document) => String(document?.description_document_id ?? "")
    && !document?.tombstoned
    && !superseded.has(String(document?.description_document_id)));
}

/** Closes the details inspector when an earlier phase left it open. */
async function closeDetailsIfOpen(page) {
  const column = page.locator(".detail-column");
  if (await column.count() === 0) return;
  await page.locator(".detail-back").click();
  await column.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
}

export async function assertNotesSurface(ctx) {
  const { page, url } = ctx;

  // Module-local captures, all filled from the page's own traffic. The seeding
  // calls below go through `page.request`, which is not a page request and
  // therefore never lands in these captures: every captured answer is the
  // surface's own read.
  const daemon = {
    requests: [],
    writes: [],
    noteLists: [],
    descriptionLists: [],
    descriptionGets: [],
    contentLists: [],
  };
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/command")) return;
    let payload;
    try { payload = request.postDataJSON(); } catch { return; }
    const operation = String(payload?.operation ?? "");
    const input = payload?.input ?? {};
    daemon.requests.push({ operation, input });
    if (DURABLE_WRITE_PATTERN.test(operation)) daemon.writes.push(operation);
  });
  page.on("response", async (response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/v1/command")) return;
    let request;
    try { request = response.request().postDataJSON(); } catch { return; }
    let body;
    try { body = await response.json(); } catch { return; }
    const operation = String(request?.operation ?? "");
    const input = request?.input ?? {};
    if (operation === "annotation.list" && !input.subject_ref && Array.isArray(body?.data?.annotations)) daemon.noteLists.push(body.data.annotations);
    if (operation === "description.list" && !input.subject_ref && Array.isArray(body?.data?.documents)) daemon.descriptionLists.push({ documents: body.data.documents, truncated: body.data.truncated === true });
    if (operation === "description.get" && body?.data?.document) daemon.descriptionGets.push({ input, document: body.data.document });
    if (operation === "content.list" && Array.isArray(body?.data?.items)) daemon.contentLists.push(body.data.items);
  });

  // The daemon's own command adapter, used only to seed deterministic facts and
  // to read the daemon's records independently of the surface.
  const daemonCommand = async (operation, input) => {
    const response = await page.request.post(new URL("/api/v1/command", url).toString(), { data: { operation, input } });
    assert.ok(response.ok(), `${operation} must answer over the local adapter: ${response.status()}`);
    const body = await response.json();
    assert.equal(body.status, "SUCCEEDED", `${operation} must succeed: ${JSON.stringify(body.reasons ?? [])}`);
    return body.data ?? {};
  };

  // 1. The workspace, the listing, and two file subjects.
  const workspaceID = await page.evaluate(() => window.localStorage.getItem("restoreweave.workspace_id") ?? "");
  assert.ok(workspaceID, "the online phase must have published a workspace the shell recorded");
  const listing = await daemonCommand("content.list", { workspace_id: workspaceID });
  const listingItems = (listing.items ?? []).filter((item) => item.entry_type !== "DIRECTORY");
  const alpha = listingItems.find((item) => String(item.name ?? "") === "alpha.txt");
  const beta = listingItems.find((item) => String(item.name ?? "") === "beta.txt");
  assert.ok(alpha && beta, `the fixture must publish alpha.txt and beta.txt: ${listingItems.map((item) => item.name).join(", ")}`);
  const alphaRef = String(alpha.subject_ref ?? "");
  const betaRef = String(beta.subject_ref ?? "");
  assert.ok(alphaRef && betaRef && alphaRef !== betaRef, "the fixture must publish two distinct subjects");

  // 2. Seed the records the surface must render: a user note on each subject,
  // and one description chain on alpha whose successor must hide its
  // predecessor.
  const stamp = Date.now();
  const alphaBody = `rw-notes-alpha-${stamp} a durable note body`;
  const betaBody = `rw-notes-beta-${stamp} another durable note body`;
  const alphaNote = (await daemonCommand("annotation.upsert", { workspace_id: workspaceID, subject_ref: alphaRef, kind: "NOTE", body: alphaBody, expected_revision: 0 })).annotation;
  const betaNote = (await daemonCommand("annotation.upsert", { workspace_id: workspaceID, subject_ref: betaRef, kind: "NOTE", body: betaBody, expected_revision: 0 })).annotation;
  assert.ok(alphaNote?.annotation_id && betaNote?.annotation_id, "the seeded notes must carry the daemon's own record ids");
  const predecessorBody = `rw-notes-description-predecessor-${stamp}`;
  const successorBody = `rw-notes-description-successor-${stamp}`;
  const predecessor = (await daemonCommand("description.create", { workspace_id: workspaceID, subject_ref: alphaRef, kind: "IMPORTED", body: predecessorBody })).document;
  assert.ok(predecessor?.description_document_id, "the seeded description must carry the daemon's own document id");
  const successor = (await daemonCommand("description.create", {
    workspace_id: workspaceID,
    subject_ref: alphaRef,
    kind: "IMPORTED",
    body: successorBody,
    predecessor_id: predecessor.description_document_id,
    accepted: true,
  })).document;
  assert.ok(successor?.description_document_id, "the seeded successor must carry the daemon's own document id");

  // 3. The rail entry opens the view; the surface's own reads fill it.
  if (await page.evaluate(() => Boolean(document.querySelector('[aria-modal="true"]')))) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
  }
  await closeDetailsIfOpen(page);
  const entry = page.locator(RAIL_ENTRY);
  await entry.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await entry.evaluate((node) => node.tagName), "BUTTON", "the notes rail entry must be a button");
  await entry.click();
  const surface = page.locator(SURFACE);
  await surface.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(() => document.querySelector(".notes-surface")?.getAttribute("data-state") === "READY", null, { timeout: 20000 });
  assert.ok(await until(page, () => daemon.noteLists.length > 0), "the surface must read the workspace-wide notes with annotation.list");
  assert.ok(await until(page, () => daemon.descriptionLists.length > 0), "the surface must read the workspace-wide descriptions with description.list");
  assert.ok(await until(page, () => daemon.contentLists.length > 0), "the surface must resolve subject names through the workspace listing");

  // 4. Every rendered row is a daemon record, and every daemon record renders.
  const noteAnswer = daemon.noteLists[daemon.noteLists.length - 1];
  const daemonNotes = liveNoteRecords(noteAnswer);
  const renderedNoteRows = await surface.locator('.note-row[data-source-kind="USER"]').evaluateAll((nodes) => nodes.map((node) => ({
    annotationID: node.getAttribute("data-annotation-id") ?? "",
    subjectRef: node.getAttribute("data-subject-ref") ?? "",
    revision: Number(node.getAttribute("data-revision") ?? "0"),
    name: node.querySelector('[data-fact="subject-name"]')?.textContent?.trim() ?? "",
    label: node.querySelector('[data-fact="source-label"]')?.textContent?.trim() ?? "",
    meta: node.querySelector('[data-fact="meta"]')?.textContent?.trim() ?? "",
    body: node.querySelector('[data-fact="body"]')?.textContent?.trim() ?? "",
  })));
  assert.ok(renderedNoteRows.length >= 2, `the seeded notes must render: ${JSON.stringify(renderedNoteRows.map((row) => row.annotationID))}`);
  const daemonNoteIDs = new Set(daemonNotes.map((record) => String(record.annotation_id)));
  for (const row of renderedNoteRows) {
    assert.ok(daemonNoteIDs.has(row.annotationID), `every note row must be a live daemon record: ${JSON.stringify(row)}`);
    const record = daemonNotes.find((candidate) => String(candidate.annotation_id) === row.annotationID);
    assert.equal(row.subjectRef, String(record.subject_ref), "the row must carry the record's own subject");
    assert.equal(row.revision, Number(record.revision), "the row must carry the record's own revision");
    assert.equal(row.body, String(record.body), "the row must render the stored body, not a copy or a summary");
    assert.ok(row.label.length > 0, "every row must carry its source label");
    assert.ok(row.meta.length > 0, "every row must carry its revision and date meta");
  }
  for (const record of daemonNotes) {
    assert.ok(renderedNoteRows.some((row) => row.annotationID === String(record.annotation_id)), `every live note the daemon returned must render: ${record.annotation_id}`);
  }
  // The seeded note appears with its subject's own display name.
  const alphaRow = surface.locator(`.note-row[data-annotation-id="${alphaNote.annotation_id}"]`);
  assert.equal(await alphaRow.count(), 1, "the seeded note must render its own row");
  assert.equal(await alphaRow.locator('[data-fact="subject-name"]').innerText(), String(alpha.name), "the note row must name the subject's own display name");
  assert.equal(await alphaRow.locator('[data-fact="body"]').innerText(), alphaBody, "the note row must show the full stored body");

  // 5. Descriptions render as current leaves with their source label, and no
  // body is fetched while the surface loads.
  const descriptionAnswer = daemon.descriptionLists[daemon.descriptionLists.length - 1];
  const leaves = currentDescriptionLeaves(descriptionAnswer.documents);
  assert.ok(leaves.some((document) => String(document.description_document_id) === String(successor.description_document_id)), "the seeded successor must be a current leaf");
  const renderedDescriptionRows = await surface.locator('.note-row[data-source-kind="DESCRIPTION"]').evaluateAll((nodes) => nodes.map((node) => ({
    id: node.getAttribute("data-description-document-id") ?? "",
    kind: node.getAttribute("data-description-kind") ?? "",
    subjectRef: node.getAttribute("data-subject-ref") ?? "",
    label: node.querySelector('[data-fact="source-label"]')?.textContent?.trim() ?? "",
    state: node.getAttribute("data-body-state") ?? "",
  })));
  assert.deepEqual(renderedDescriptionRows.map((row) => row.id).sort(), leaves.map((document) => String(document.description_document_id)).sort(), "the description rows must be exactly the daemon's current leaves");
  assert.equal(await surface.locator(`.note-row[data-description-document-id="${predecessor.description_document_id}"]`).count(), 0, "a successor must hide its predecessor");
  const successorRow = surface.locator(`.note-row[data-description-document-id="${successor.description_document_id}"]`);
  assert.equal(await successorRow.count(), 1, "the current description leaf must render");
  assert.equal(await successorRow.getAttribute("data-description-kind"), "IMPORTED", "the row must carry the daemon's own description kind");
  assert.ok((await successorRow.locator('[data-fact="source-label"]').innerText()).trim().length > 0, "the description row must carry its source label");
  assert.equal(await successorRow.getAttribute("data-body-state"), "SUMMARY", "a description summary must render without fetching its body");
  assert.ok(String(await successorRow.locator('[data-fact="body"]').innerText()).trim().length > 0, "a summary row must still say where its body is");
  assert.equal(await successorRow.locator('[data-action="toggle-description"]').count(), 1, "a description row must own its body toggle");
  assert.equal(daemon.descriptionGets.length, 0, "loading the surface must not fetch any description body");
  assert.match(await surface.innerText(), READ_ONLY_COPY, "the surface must state that it is a read-only view");

  // 6. Expanding one row reads exactly that one document's body; the body is
  // cached, so a second expansion issues no further read.
  await successorRow.locator('[data-action="toggle-description"]').click();
  assert.ok(await until(page, () => daemon.descriptionGets.length > 0, 15000), "expanding a row must read its body with description.get");
  assert.equal(daemon.descriptionGets.length, 1, `expanding one row must issue exactly one description.get: ${JSON.stringify(daemon.descriptionGets.map((entry) => entry.input))}`);
  assert.equal(String(daemon.descriptionGets[0].input.description_document_id), String(successor.description_document_id), "the body read must target the expanded row's own document");
  await page.waitForFunction((id) => document.querySelector(`.note-row[data-description-document-id="${id}"]`)?.getAttribute("data-body-state") === "READY", String(successor.description_document_id), { timeout: 15000 });
  assert.equal(String(daemon.descriptionGets[0].document.body), successorBody, "the rendered body must be the daemon's own stored body");
  assert.equal((await successorRow.locator('[data-fact="body"]').innerText()).trim(), successorBody, "the expanded row must show the stored body, not the summary line");
  await successorRow.locator('[data-action="toggle-description"]').click();
  await successorRow.locator('[data-action="toggle-description"]').click();
  await page.waitForTimeout(150);
  assert.equal(daemon.descriptionGets.length, 1, "a body already loaded must not be fetched again");
  assert.equal((await successorRow.locator('[data-fact="body"]').innerText()).trim(), successorBody, "a collapsed row keeps the body the daemon returned");

  // 7. The filter narrows the rendered rows only: no request, no rewrite.
  const requestsBeforeFilter = daemon.requests.length;
  await surface.locator(".notes-filter input").fill(betaBody);
  await page.waitForTimeout(100);
  const filteredIDs = await surface.locator('.note-row[data-source-kind="USER"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-annotation-id") ?? ""));
  assert.deepEqual(filteredIDs, [String(betaNote.annotation_id)], `the substring filter must narrow the rendered rows: ${JSON.stringify(filteredIDs)}`);
  assert.equal(daemon.requests.length, requestsBeforeFilter, "filtering must not ask the daemon for anything");
  await surface.locator(".notes-filter input").fill("");
  await page.waitForTimeout(100);
  assert.equal(await surface.locator('.note-row[data-annotation-id="' + alphaNote.annotation_id + '"]').count(), 1, "clearing the filter must restore the daemon's rows");

  // 8. A row click opens that subject's details through the existing path.
  const requestsBeforeRowClick = daemon.requests.length;
  const writesBeforeRowClick = daemon.writes.length;
  await alphaRow.locator('[data-action="open-subject"]').click();
  const detailColumn = page.locator(".detail-column");
  await detailColumn.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => {
    const title = document.querySelector(".detail-column h2")?.textContent?.trim() ?? "";
    return title.length > 0;
  }, null, { timeout: 15000 });
  assert.equal((await page.locator(".detail-column h2").innerText()).trim(), String(alpha.name), "the row click must open the subject's details");
  assert.equal(daemon.writes.length, writesBeforeRowClick, "opening a subject's details must not write anything");

  // 9. The surface's whole operation set. Only the reads above the row click
  // belong to the surface itself; the row click is the details inspector,
  // whose own reads stay out of this set. No durable write may exist anywhere.
  const surfaceOperations = daemon.requests.slice(0, requestsBeforeRowClick).map((request) => request.operation);
  assert.ok(surfaceOperations.length >= 3, `the surface must issue its reads: ${JSON.stringify(surfaceOperations)}`);
  for (const operation of surfaceOperations) {
    assert.ok(SURFACE_READ_OPERATIONS.includes(operation), `the notes surface must issue only its read set: ${operation}`);
  }
  assert.equal(daemon.writes.length, 0, `no durable write may be issued by this surface: ${JSON.stringify(daemon.writes)}`);
  for (const request of daemon.requests) {
    assert.ok(!DURABLE_WRITE_PATTERN.test(request.operation), `no durable write may be issued at any point in this module: ${request.operation}`);
  }
  for (const read of daemon.descriptionGets) {
    assert.equal(String(read.input.workspace_id), workspaceID, "a body read must carry the published workspace");
  }
  await closeDetailsIfOpen(page);
  await surface.waitFor({ state: "visible", timeout: 10000 });

  // 10. No control that could create a durable record exists: the action set is
  // the refresh, a row (navigation), and a description row's toggle, and there
  // is no composer, editor, or field besides the one filter.
  const actions = await surface.locator("button").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-action") ?? ""));
  assert.ok(actions.length >= 3, `the surface must render its controls: ${JSON.stringify(actions)}`);
  for (const action of actions) assert.ok(SURFACE_ACTIONS.includes(action), `every control must belong to the notes action set: ${action || "(none)"}`);
  assert.equal(await surface.locator("textarea, select, form").count(), 0, "the surface must render no composer, editor, or form");
  const inputs = await surface.locator("input").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("type") ?? ""));
  assert.deepEqual(inputs, ["search"], `the only field may be the filter: ${JSON.stringify(inputs)}`);
  assert.equal(await surface.locator('[data-action="add-note"], [data-action="save-note"], [data-action="delete-note"], [data-action="generate-description"], [data-action="accept-description"]').count(), 0, "no control may create, change, or delete a durable record");

  // 11. Empty, partial, and blocked are three different facts. A failed note
  // read renders the daemon's own message; an empty answer names the reads it
  // owns instead of claiming an empty catalog; a truncated description answer
  // says the list is partial.
  let mockNotes = "blocked";
  let mockDescriptions = "real";
  const routeMock = async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
    const operation = String(payload?.operation ?? "");
    const subjectScoped = Boolean(payload?.input?.subject_ref);
    if (operation === "annotation.list" && !subjectScoped && mockNotes !== "real") {
      if (mockNotes === "blocked") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "FAILED", reasons: [{ message: "simulated notes outage" }] }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "SUCCEEDED", data: { annotations: [] } }) });
      return;
    }
    if (operation === "description.list" && !subjectScoped && mockDescriptions !== "real") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "SUCCEEDED", data: { documents: [], truncated: mockDescriptions === "truncated" } }) });
      return;
    }
    await route.continue();
  };
  await page.route("**/api/v1/command", routeMock);

  await surface.locator('[data-action="refresh"]').click();
  const blocked = surface.locator('.notes-blocked[data-state="BLOCKED"]');
  await blocked.waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await surface.getAttribute("data-state"), "BLOCKED", "an unreadable note vocabulary must render as blocked, never as empty");
  assert.match((await blocked.innerText()).trim(), BLOCKED_REASON, "the blocked state must carry the daemon's own message");
  assert.equal(await surface.locator(".note-row").count(), 0, "a blocked read renders no row");

  mockNotes = "empty";
  mockDescriptions = "empty";
  await surface.locator('[data-action="refresh"]').click();
  const empty = surface.locator('.notes-empty[data-empty="true"]');
  await empty.waitFor({ state: "visible", timeout: 15000 });
  const emptyText = (await empty.innerText()).trim();
  assert.match(emptyText, EMPTY_TITLE, `the empty state must name the missing vocabulary: ${emptyText}`);
  assert.match(emptyText, EMPTY_READS, `the empty state must say which reads it owns: ${emptyText}`);
  assert.match(emptyText, EMPTY_NOT_CATALOG, `the empty state must never claim an empty catalog: ${emptyText}`);
  assert.equal(await surface.locator(".note-row").count(), 0, "an empty answer renders no row");

  mockNotes = "real";
  mockDescriptions = "truncated";
  await surface.locator('[data-action="refresh"]').click();
  const partial = surface.locator('.notes-partial[data-partial="true"]');
  await partial.waitFor({ state: "visible", timeout: 15000 });
  assert.match((await partial.innerText()).trim(), PARTIAL_COPY, "a truncated description answer must read as partial");
  assert.equal(await surface.getAttribute("data-partial"), "true", "the surface must carry the truncated fact");
  assert.ok(await surface.locator(".note-row").count() > 0, "the notes the daemon returned must still render beside a partial description list");

  // 12. The restored answer is the daemon's again.
  await page.unroute("**/api/v1/command");
  await surface.locator('[data-action="refresh"]').click();
  // Wait for the result of the fresh load, not a stale attribute: the surface
  // keeps its previous data-state until the new answer lands, so waiting on
  // READY alone can pass while the mocked "truncated" answer is still shown.
  await page.waitForFunction(() => document.querySelector(".notes-surface")?.getAttribute("data-partial") === "false", null, { timeout: 20000 });
  await page.waitForFunction((id) => Boolean(document.querySelector(`.note-row[data-annotation-id="${id}"]`)), String(alphaNote.annotation_id), { timeout: 15000 });
  assert.equal(await surface.getAttribute("data-partial"), "false", "the restored description answer must not read as partial");
  assert.equal(await surface.locator(`.note-row[data-description-document-id="${successor.description_document_id}"]`).count(), 1, "the restored answer must render the daemon's current leaf again");
  assert.match(await surface.innerText(), SUMMARY_COPY, "an unread summary must say where its body is");

  // 13. Escape returns focus to the rail entry, and the surface leaves the
  // page on the library view the later phases expect.
  await surface.locator(".notes-filter input").focus();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-view")), "notes", "Escape must return focus to the notes rail entry");
  await assertNoHorizontalOverflow(ctx);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: /^(Library|内容库)/ }).click();
  await page.locator(".result-list").or(page.locator(".empty-state")).first().waitFor({ state: "visible", timeout: 15000 });
}
