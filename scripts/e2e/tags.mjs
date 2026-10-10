// Assertions for the tags surface (Tier-1 spec §3 item 8).
//
// Owner: components/TagsSurface.tsx, styles/tags.css, i18n/tags.ts and this
// module. `scripts/web-e2e.mjs` calls it once in the online phase, after the
// duplicate review.
//
// The assertions are written so a fabricated surface fails:
//
//   - every rendered tag row must carry a name and a subject count that equal
//     the daemon's own live TAG records (this test seeds its own records
//     through `annotation.upsert`, then compares the rendered counts with the
//     records the daemon returns), no row may have zero subjects, and two names
//     that differ only in case must stay two rows;
//   - adding and then removing one tag on one subject must be visible in the
//     daemon's own `annotation.list` answer afterwards, with the record's own
//     annotation_id and revision used for the delete;
//   - rename/merge is the daemon's `annotation.tag_plan` / `annotation.tag_apply`
//     pair: the preview must be the daemon's own plan (its subjects, its
//     ordered add-then-tombstone changes, its explicit no-op case, and its plan
//     digest), zero writes of any kind may be issued before the confirmation,
//     and the apply must carry exactly that digest while the surface issues no
//     per-subject rename writes of its own;
//   - a partial apply must be rendered from the daemon's own per-subject
//     outcomes: the counts it reported, the failed subjects with its reasons,
//     and copy that never reads as a clean rename;
//   - a plan whose facts changed must be refused: the daemon returns a typed
//     conflict, the surface reports that refusal verbatim, renders no applied
//     record, and the refusal writes nothing;
//   - the only operations the surface may issue are the read set plus
//     `annotation.upsert` / `annotation.delete` / `annotation.tag_apply`, no
//     machine suggestion control may exist, and Escape must return focus to the
//     tags rail entry.

import assert from "node:assert/strict";
import { assertNoHorizontalOverflow } from "./support.mjs";

const RAIL_ENTRY = 'button.workspace-nav-item[data-view="tags"]';
const SURFACE = ".tags-surface";

// The only operations this surface may ever ask the daemon for.
// `annotation.tag_plan` is in the read set on purpose: it is the read-only
// planning operation and the daemon proves it writes nothing
// (server/controlplane/tag_ops_test.go compares the full catalog read before
// and after).
const SURFACE_READ_OPERATIONS = ["annotation.list", "content.list", "status.get", "search.query", "annotation.tag_plan"];
const SURFACE_WRITE_OPERATIONS = ["annotation.upsert", "annotation.delete", "annotation.tag_apply"];
// The action set every rendered button must belong to.
const SURFACE_ACTIONS = ["refresh", "select-tag", "toggle-subject", "open-in-library", "remove-subject-tag", "add-tag-subject", "preview-rename", "apply-rename", "discard-preview", "prepare-reverse"];

const EMPTY_TITLE = /No live tag is recorded here yet|此处尚未记录任何存续标签/;
const EMPTY_LIVE_ONLY = /live TAG annotation records only|只读取服务的存续 TAG 注释记录/;
const EMPTY_TOMBSTONE = /tombstoned instead of being kept as an empty row|被删除的标签会置为墓碑/;
const EMPTY_CREATES = /creates the first record|就会创建第一条记录/;
const DIRTY_SUMMARY = /0 of 2 subjects changed|已变更 0 个主题，共 2 个/;
const DIRTY_NOT_CLEAN = /not a clean rename|不是一次干净的重命名/;
const REFUSED_DIGEST = /plan digest does not match|计划摘要不匹配/;
// The copy that must state the ordering rule and the honesty of a preview.
const ORDERING_COPY = /adds the new name before tombstoning the old record|先添加新名称，再为旧记录置墓碑/;
const PREVIEW_COPY = /No write has been issued yet|尚未发出任何写入/;

/** Waits for a captured daemon answer, because response bodies arrive asynchronously. */
async function until(page, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await page.waitForTimeout(50);
  }
  return predicate();
}

/** True when the daemon's lexical projection actually answered this query. */
function lexicalAnswered(data) {
  const components = Array.isArray(data?.components) ? data.components : [];
  return components.some((component) => component?.dimension === "lexical-metadata-fts" && component?.status === "SUCCEEDED" && Boolean(component?.index_generation_ref));
}

/** One live TAG record per (subject, name), exactly as the daemon returned them. */
function liveTagCounts(annotations) {
  const counts = new Map();
  for (const record of annotations ?? []) {
    if (record?.kind !== "TAG" || record?.tombstoned) continue;
    const body = String(record.body ?? "");
    if (!body) continue;
    counts.set(body, (counts.get(body) ?? 0) + 1);
  }
  return counts;
}

function liveTagRecords(annotations, body) {
  return (annotations ?? []).filter((record) => record?.kind === "TAG" && !record?.tombstoned && String(record.body ?? "") === body);
}

/** The daemon's own answer for one subject of a plan, or a hard failure. */
function plannedSubject(planAnswer, subjectRef) {
  const subjects = Array.isArray(planAnswer?.data?.subjects) ? planAnswer.data.subjects : [];
  const subject = subjects.find((candidate) => String(candidate?.subject_ref) === subjectRef);
  assert.ok(subject, `the daemon's plan must list subject ${subjectRef}: ${JSON.stringify(subjects)}`);
  return subject;
}

function plannedChange(subject, action) {
  const changes = Array.isArray(subject?.changes) ? subject.changes : [];
  return changes.find((change) => String(change?.action) === action);
}

export async function assertTagsSurface(ctx) {
  const { page, url } = ctx;

  // Module-local captures, all filled from the daemon's own traffic. The
  // seeding calls below go through `page.request`, which is not a page request
  // and therefore never lands in these captures: every captured answer is the
  // surface's own read.
  const daemon = {
    requests: [],
    writes: [],
    annotationLists: [],
    upserts: [],
    deletes: [],
    searchQueries: [],
    tagPlanAnswers: [],
    tagApplies: [],
  };
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/command")) return;
    let payload;
    try { payload = request.postDataJSON(); } catch { return; }
    const operation = String(payload?.operation ?? "");
    const input = payload?.input ?? {};
    daemon.requests.push({ operation, input });
    if (SURFACE_WRITE_OPERATIONS.includes(operation)) daemon.writes.push(operation);
    if (!SURFACE_READ_OPERATIONS.includes(operation) && !SURFACE_WRITE_OPERATIONS.includes(operation)) daemon.writes.push(operation);
    if (operation === "annotation.upsert") daemon.upserts.push(input);
    if (operation === "annotation.delete") daemon.deletes.push(input);
    if (operation === "annotation.tag_apply") daemon.tagApplies.push(input);
  });
  page.on("response", async (response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/v1/command")) return;
    let request;
    try { request = response.request().postDataJSON(); } catch { return; }
    let body;
    try { body = await response.json(); } catch { return; }
    const operation = String(request?.operation ?? "");
    if (operation === "annotation.list" && Array.isArray(body?.data?.annotations)) daemon.annotationLists.push(body.data.annotations);
    if (operation === "search.query" && body?.data) daemon.searchQueries.push({ filters: request?.input?.filters ?? {}, data: body.data });
    if (operation === "annotation.tag_plan" && body?.data) daemon.tagPlanAnswers.push({ input: request?.input ?? {}, data: body.data });
  });

  // The daemon's own command adapter, used only to seed deterministic tag
  // facts and to read the daemon's records independently of the surface.
  const daemonCommand = async (operation, input) => {
    const response = await page.request.post(new URL("/api/v1/command", url).toString(), { data: { operation, input } });
    assert.ok(response.ok(), `${operation} must answer over the local adapter: ${response.status()}`);
    const body = await response.json();
    assert.equal(body.status, "SUCCEEDED", `${operation} must succeed: ${JSON.stringify(body.reasons ?? [])}`);
    return body.data ?? {};
  };

  // 1. The workspace and the published listing come from the daemon.
  const workspaceID = await page.evaluate(() => window.localStorage.getItem("cairn.workspace_id") ?? "");
  assert.ok(workspaceID, "the online phase must have published a workspace the shell recorded");
  const listing = await daemonCommand("content.list", { workspace_id: workspaceID });
  const listingItems = (listing.items ?? []).filter((item) => item.entry_type !== "DIRECTORY");
  const alpha = listingItems.find((item) => String(item.name ?? "") === "alpha.txt");
  const beta = listingItems.find((item) => String(item.name ?? "") === "beta.txt");
  assert.ok(alpha && beta, `the fixture must publish alpha.txt and beta.txt: ${listingItems.map((item) => item.name).join(", ")}`);
  const alphaRef = String(alpha.subject_ref ?? "");
  const betaRef = String(beta.subject_ref ?? "");
  assert.ok(alphaRef && betaRef && alphaRef !== betaRef, "the fixture must publish two distinct subjects");

  // 2. Seed tag facts through the daemon's own operation so the rendered counts
  // have a truth to compare against: one tag on both subjects, one on beta
  // only, and two case variants of the same spelling.
  const stamp = Date.now();
  const pairTag = `cairn-tags-seeded-${stamp}`;
  const singleTag = `cairn-tags-single-${stamp}`;
  const upperTag = `cairn-tags-Case-${stamp}`;
  const lowerTag = `cairn-tags-case-${stamp}`;
  for (const [subjectRef, body] of [[alphaRef, pairTag], [betaRef, pairTag], [betaRef, singleTag], [alphaRef, upperTag], [betaRef, lowerTag]]) {
    await daemonCommand("annotation.upsert", { workspace_id: workspaceID, subject_ref: subjectRef, kind: "TAG", body, expected_revision: 0 });
  }
  const seeded = await daemonCommand("annotation.list", { workspace_id: workspaceID });
  const seededCounts = liveTagCounts(seeded.annotations);
  assert.equal(seededCounts.get(pairTag), 2, `the seeded tag must be recorded on two subjects: ${JSON.stringify([...seededCounts])}`);
  assert.equal(seededCounts.get(singleTag), 1, "the seeded tag must be recorded on one subject");
  assert.equal(seededCounts.get(upperTag), 1, "the mixed-case tag must be its own record");
  assert.equal(seededCounts.get(lowerTag), 1, "the lower-case tag must be its own record");

  // 3. The rail entry opens the view and the vocabulary comes from
  // annotation.list.
  if (await page.evaluate(() => Boolean(document.querySelector('[aria-modal="true"]')))) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
  }
  const entry = page.locator(RAIL_ENTRY);
  await entry.waitFor({ state: "visible", timeout: 10000 });
  await entry.click();
  const surface = page.locator(SURFACE);
  await surface.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(() => document.querySelector(".tags-surface")?.getAttribute("data-state") === "READY", null, { timeout: 20000 });
  assert.ok(await until(page, () => daemon.annotationLists.length > 0), "the surface must read the vocabulary with annotation.list");
  assert.equal(await entry.evaluate((node) => node.tagName), "BUTTON", "the tags rail entry must be a button");

  // 4. Every rendered row equals the daemon's own records: the count is the
  // number of live records carrying that name, the order is count descending
  // then name, no row has zero subjects, and case variants stay distinct.
  const renderedRows = await surface.locator(".tag-row").evaluateAll((nodes) => nodes.map((node) => ({
    body: node.getAttribute("data-tag-body") ?? "",
    count: Number(node.getAttribute("data-subject-count") ?? "0"),
  })));
  assert.ok(renderedRows.length >= 4, `the seeded tags must render: ${JSON.stringify(renderedRows.map((row) => row.body))}`);
  const daemonCounts = liveTagCounts(daemon.annotationLists[daemon.annotationLists.length - 1]);
  for (const row of renderedRows) {
    assert.ok(row.count >= 1, `a tag row must never be fabricated with zero subjects: ${row.body}`);
    assert.equal(row.count, daemonCounts.get(row.body) ?? -1, `the row's subject count must equal the daemon's own live records: ${row.body}`);
  }
  const renderedNames = renderedRows.map((row) => row.body);
  assert.equal(new Set(renderedNames).size, renderedNames.length, "no tag name may be rendered twice");
  for (const [body] of daemonCounts) assert.ok(renderedNames.includes(body), `every live tag of the daemon must render: ${body}`);
  for (let index = 1; index < renderedRows.length; index += 1) {
    const previous = renderedRows[index - 1];
    const current = renderedRows[index];
    assert.ok(previous.count >= current.count, `the tag list must be ordered by subject count descending: ${JSON.stringify([previous, current])}`);
    // Within one count the order is by name. The collation is the browser's,
    // so the name order is only asserted for names every collation agrees on.
    if (previous.count === current.count && /^[a-z0-9-]+$/.test(previous.body) && /^[a-z0-9-]+$/.test(current.body)) {
      assert.ok(previous.body.localeCompare(current.body) <= 0, `equal-count tags must be ordered by name: ${JSON.stringify([previous, current])}`);
    }
  }
  assert.equal(Number(await surface.locator(`.tag-row[data-tag-body="${pairTag}"]`).getAttribute("data-subject-count")), 2, "the two-subject tag must render its daemon count");
  assert.equal(Number(await surface.locator(`.tag-row[data-tag-body="${singleTag}"]`).getAttribute("data-subject-count")), 1, "the one-subject tag must render its daemon count");
  assert.equal(await surface.locator(`.tag-row[data-tag-body="${upperTag}"]`).count(), 1, "a mixed-case tag name is its own row");
  assert.equal(await surface.locator(`.tag-row[data-tag-body="${lowerTag}"]`).count(), 1, "a lower-case tag name stays a separate row");
  assert.notEqual(upperTag, lowerTag, "the case variants are distinct durable names");

  // 5. The substring filter narrows the view only: the vocabulary count and the
  // stored names are untouched.
  await surface.locator(".tags-filter input").fill(pairTag);
  await page.waitForTimeout(100);
  const filteredRows = await surface.locator(".tag-row").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-tag-body") ?? ""));
  assert.deepEqual(filteredRows, [pairTag], `the substring filter must narrow the rendered rows: ${JSON.stringify(filteredRows)}`);
  assert.equal(Number(await surface.locator(".tags-scope").getAttribute("data-tag-count")), renderedRows.length, "filtering must not change the vocabulary count");
  await surface.locator(".tags-filter input").fill("");
  await page.waitForTimeout(100);

  // 6. One tag's subjects carry the daemon's own name, provenance path and
  // protection state.
  await surface.locator(`.tag-row[data-tag-body="${pairTag}"] .tag-row-button`).click();
  await surface.locator(".tag-subject-rows").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction((body) => document.querySelector(".tags-detail-heading [data-fact='selected-tag']")?.textContent === body, pairTag, { timeout: 10000 });
  // The protection axis is read per selected tag; the rows must not be read
  // while that read is still pending, because a pending state is not a claim.
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll(".tags-surface .tag-subject-row")];
    return rows.length > 0 && rows.every((row) => row.getAttribute("data-protection-pending") === "false");
  }, null, { timeout: 20000 });
  const subjectRows = await surface.locator(".tag-subject-row").evaluateAll((nodes) => nodes.map((node) => ({
    ref: node.getAttribute("data-subject-ref") ?? "",
    annotationID: node.getAttribute("data-annotation-id") ?? "",
    revision: node.getAttribute("data-revision") ?? "",
    name: node.querySelector('[data-fact="name"]')?.textContent?.trim() ?? "",
    path: node.querySelector('[data-fact="path"]')?.textContent?.trim() ?? "",
    protection: node.querySelector('[data-fact="protection"]')?.textContent?.trim() ?? "",
    state: node.getAttribute("data-protection-state") ?? "",
    known: node.getAttribute("data-protection-known") ?? "",
  })));
  assert.deepEqual(subjectRows.map((row) => row.ref).sort(), [alphaRef, betaRef].sort(), "the tag's subject rows must be the daemon's own records");
  for (const [ref, item] of [[alphaRef, alpha], [betaRef, beta]]) {
    const row = subjectRows.find((candidate) => candidate.ref === ref);
    assert.ok(row, `the subject row must render: ${ref}`);
    assert.equal(row.name, String(item.name ?? ""), "the subject row must show the daemon's own name");
    assert.equal(row.path, String(item.path ?? ""), "the subject row must show the daemon's own provenance path");
    assert.ok(row.protection.length > 0, "the subject row must state its protection fact");
    assert.ok(row.annotationID.startsWith("ann_"), `the subject row must carry the daemon's own record id: ${row.annotationID}`);
    assert.ok(Number(row.revision) >= 1, `the subject row must carry the daemon's own record revision: ${row.revision}`);
  }
  // The protection fact is the daemon's protection-axis answer or UNKNOWN.
  assert.ok(await until(page, () => daemon.searchQueries.some((query) => query.filters?.protection_mode)), "the surface must read the daemon's protection axis");
  const protectionBySubject = new Map();
  for (const query of daemon.searchQueries) {
    const outcome = String(query.filters?.protection_mode ?? "");
    if (!outcome || !lexicalAnswered(query.data)) continue;
    for (const hit of query.data.hits ?? []) protectionBySubject.set(String(hit.subject_ref ?? ""), outcome);
  }
  for (const row of subjectRows) {
    const claimed = protectionBySubject.get(row.ref) ?? "";
    if (claimed) {
      assert.equal(row.state, claimed, `the subject's protection state must be the daemon's own outcome: ${row.ref}`);
      assert.equal(row.known, "true", "a claimed protection outcome must render as known");
    } else {
      assert.equal(row.state, "UNKNOWN", "an outcome the daemon did not claim must render as UNKNOWN");
      assert.equal(row.known, "false", "an unclaimed protection outcome must not render as known");
    }
  }

  // 7. Keyboard: one tab stop per list with the library's roving pattern, and
  // Escape hands focus back to the rail entry.
  const tagButtons = surface.locator(".tag-row-button");
  await tagButtons.first().focus();
  assert.equal(await surface.locator('.tag-row-button[tabindex="0"]').count(), 1, "the tag list must own exactly one tab stop");
  const focusedTag = () => page.evaluate(() => Number(document.activeElement?.closest("[data-tag-index]")?.getAttribute("data-tag-index") ?? -1));
  await page.keyboard.press("ArrowDown");
  assert.equal(await focusedTag(), 1, "Arrow Down must move to the next tag");
  await page.keyboard.press("ArrowUp");
  assert.equal(await focusedTag(), 0, "Arrow Up must move back");
  await page.keyboard.press("End");
  assert.equal(await focusedTag(), renderedRows.length - 1, "End must jump to the last tag");
  await page.keyboard.press("Home");
  assert.equal(await focusedTag(), 0, "Home must jump to the first tag");
  await surface.locator(".tag-subject-toggle").first().focus();
  assert.equal(await surface.locator('.tag-subject-toggle[tabindex="0"]').count(), 1, "the subject list must own exactly one tab stop");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => Number(document.activeElement?.closest("[data-subject-index]")?.getAttribute("data-subject-index") ?? -1)), 1, "Arrow Down must move to the next subject");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-view")), "tags", "Escape must return focus to the tags rail entry");
  assert.equal(await surface.count(), 1, "Escape must not leave the tags view");

  // 8. Add then remove one tag on one subject, both visible in the daemon's own
  // annotation.list answer afterwards. These per-subject controls stay on the
  // admitted annotation.upsert / annotation.delete operations.
  await surface.locator(`.tag-row[data-tag-body="${singleTag}"] .tag-row-button`).click();
  await page.waitForFunction((body) => document.querySelector(".tags-detail-heading [data-fact='selected-tag']")?.textContent === body, singleTag, { timeout: 10000 });
  assert.equal(await surface.locator(".tag-subject-row").count(), 1, "the one-subject tag must render one subject");
  const upsertsBeforeAdd = daemon.upserts.length;
  await surface.locator(".tags-add select").selectOption(alphaRef);
  await surface.locator('[data-action="add-tag-subject"]').click();
  assert.ok(await until(page, () => daemon.upserts.length > upsertsBeforeAdd, 15000), "the add must issue an annotation write");
  const addUpserts = daemon.upserts.slice(upsertsBeforeAdd).filter((input) => input.kind === "TAG" && input.body === singleTag);
  assert.equal(addUpserts.length, 1, `adding one tag to one subject must issue exactly one TAG upsert: ${JSON.stringify(daemon.upserts.slice(upsertsBeforeAdd))}`);
  assert.equal(String(addUpserts[0].subject_ref), alphaRef, "the add must target the selected subject");
  assert.equal(String(addUpserts[0].body), singleTag, "the add must send the stored tag body byte-for-byte");
  assert.equal(Number(addUpserts[0].expected_revision ?? -1), 0, "a new tag record is created with expected_revision 0");
  const addedList = await until(page, () => liveTagRecords(daemon.annotationLists[daemon.annotationLists.length - 1], singleTag).some((record) => String(record.subject_ref) === alphaRef));
  assert.ok(addedList, "the daemon's own annotation.list answer must show the added tag on the subject");
  const addedRecord = liveTagRecords(daemon.annotationLists[daemon.annotationLists.length - 1], singleTag).find((record) => String(record.subject_ref) === alphaRef);
  await page.waitForFunction((body) => Number(document.querySelector(`.tag-row[data-tag-body="${body}"]`)?.getAttribute("data-subject-count") ?? -1) === 2, singleTag, { timeout: 15000 });
  assert.equal(Number(await surface.locator(`.tag-row[data-tag-body="${singleTag}"]`).getAttribute("data-subject-count")), 2, "the rendered count must follow the daemon's new record");

  const deletesBeforeRemove = daemon.deletes.length;
  await surface.locator(`.tag-subject-row[data-subject-ref="${alphaRef}"] [data-action="remove-subject-tag"]`).click();
  assert.ok(await until(page, () => daemon.deletes.length > deletesBeforeRemove, 15000), "the removal must issue an annotation.delete");
  const removeDeletes = daemon.deletes.slice(deletesBeforeRemove);
  assert.equal(removeDeletes.length, 1, `removing one tag must issue exactly one annotation.delete: ${JSON.stringify(removeDeletes)}`);
  assert.equal(String(removeDeletes[0].annotation_id), String(addedRecord.annotation_id), "the delete must use the subject's own annotation_id");
  assert.equal(Number(removeDeletes[0].expected_revision), Number(addedRecord.revision), "the delete must use the subject's own expected_revision");
  const removedList = await until(page, () => !liveTagRecords(daemon.annotationLists[daemon.annotationLists.length - 1], singleTag).some((record) => String(record.subject_ref) === alphaRef));
  assert.ok(removedList, "the daemon's own annotation.list answer must no longer show the removed tag on the subject");
  await page.waitForFunction((body) => Number(document.querySelector(`.tag-row[data-tag-body="${body}"]`)?.getAttribute("data-subject-count") ?? -1) === 1, singleTag, { timeout: 15000 });
  assert.equal(Number(await surface.locator(`.tag-row[data-tag-body="${singleTag}"]`).getAttribute("data-subject-count")), 1, "the rendered count must follow the daemon's tombstoned record");

  // 9. A rename/merge is planned by the daemon. The plan must be the daemon's
  // own answer — subjects, ordered add-then-tombstone changes, the explicit
  // no-op case, and the canonical digest — and zero writes may be issued
  // before the confirmation.
  const planSource = `cairn-tags-plan-src-${stamp}`;
  const planTarget = `cairn-tags-plan-dst-${stamp}`;
  for (const [subjectRef, body] of [[alphaRef, planSource], [betaRef, planSource], [alphaRef, planTarget]]) {
    await daemonCommand("annotation.upsert", { workspace_id: workspaceID, subject_ref: subjectRef, kind: "TAG", body, expected_revision: 0 });
  }
  await surface.locator('[data-action="refresh"]').click();
  await page.waitForFunction((body) => Boolean(document.querySelector(`.tag-row[data-tag-body="${body}"]`)), planSource, { timeout: 20000 });
  await surface.locator(`.tag-row[data-tag-body="${planSource}"] .tag-row-button`).click();
  await page.waitForFunction((body) => document.querySelector(".tags-detail-heading [data-fact='selected-tag']")?.textContent === body, planSource, { timeout: 10000 });
  assert.match(await surface.innerText(), ORDERING_COPY, "the surface must state the add-before-tombstone rule before it is used");

  const plansBeforePreview = daemon.tagPlanAnswers.length;
  const writesBeforePreview = daemon.writes.length;
  await surface.locator(".tags-rename-field input").fill(planTarget);
  await surface.locator('[data-action="preview-rename"]').click();
  const preview = surface.locator(".tags-preview");
  await preview.waitFor({ state: "visible", timeout: 10000 });
  assert.ok(await until(page, () => daemon.tagPlanAnswers.length > plansBeforePreview), "the preview must ask the daemon for a plan with annotation.tag_plan");
  const planAnswer = daemon.tagPlanAnswers[daemon.tagPlanAnswers.length - 1];
  assert.equal(String(planAnswer.input.from), planSource, "the plan request must carry the stored source name");
  assert.equal(String(planAnswer.input.to), planTarget, "the plan request must carry the stored target name");
  const planDigest = String(planAnswer.data?.plan_digest ?? "");
  assert.equal(String(planAnswer.data?.wrote), "false", "the daemon's plan must report that it wrote nothing");
  assert.ok(/^sha256:[0-9a-f]{64}$/.test(planDigest), `the daemon's plan must carry its canonical digest: ${planDigest}`);
  assert.equal(await preview.getAttribute("data-preview-count"), "2", "the preview must count the daemon's affected subjects");
  assert.equal(await preview.getAttribute("data-plan-digest"), planDigest, "the preview must show the daemon's own plan digest");
  assert.equal(await preview.getAttribute("data-plan-noop-subjects"), "1", "the subject that already carries the target must be planned as an explicit no-op");
  assert.equal(await preview.getAttribute("data-writes-issued"), "0", "the preview must state that no write has been issued");
  assert.match((await preview.innerText()).trim(), PREVIEW_COPY, "the preview must say that no write has been issued");
  const previewRows = await preview.locator("[data-preview-row]").evaluateAll((nodes) => nodes.map((node) => ({
    ref: node.getAttribute("data-subject-ref") ?? "",
    annotationID: node.getAttribute("data-annotation-id") ?? "",
    revision: node.getAttribute("data-revision") ?? "",
    addNoop: node.querySelector('[data-fact="preview-change"][data-change-action="ADD_TAG"]')?.getAttribute("data-change-noop") ?? "",
    changeActions: [...node.querySelectorAll("[data-fact='preview-change']")].map((change) => change.getAttribute("data-change-action")),
  })));
  const planSubjects = Array.isArray(planAnswer.data?.subjects) ? planAnswer.data.subjects : [];
  assert.deepEqual(previewRows.map((row) => row.ref).sort(), planSubjects.map((subject) => String(subject.subject_ref)).sort(), "the preview must name exactly the daemon's planned subjects");
  for (const row of previewRows) {
    const subject = plannedSubject(planAnswer, row.ref);
    const add = plannedChange(subject, "ADD_TAG");
    const tombstone = plannedChange(subject, "TOMBSTONE_TAG");
    assert.ok(add && tombstone, `every planned subject must carry an add and a tombstone: ${JSON.stringify(subject)}`);
    assert.deepEqual(row.changeActions, ["ADD_TAG", "TOMBSTONE_TAG"], "the plan must state the add before the tombstone");
    assert.equal(row.annotationID, String(tombstone.annotation_id), `the preview must name the record the daemon plans to tombstone: ${row.ref}`);
    assert.equal(row.revision, String(tombstone.expected_revision), `the preview must carry the daemon's planned revision: ${row.ref}`);
    assert.equal(row.addNoop, add.noop ? "true" : "false", `the preview must state whether the add is a no-op: ${row.ref}`);
  }
  const alphaPlanned = plannedSubject(planAnswer, alphaRef);
  const betaPlanned = plannedSubject(planAnswer, betaRef);
  assert.equal(plannedChange(alphaPlanned, "ADD_TAG").noop, true, "the subject already carrying the target must plan a no-op add");
  assert.equal(plannedChange(betaPlanned, "ADD_TAG").noop, false, "the subject without the target must plan a real add");
  assert.equal(daemon.writes.length, writesBeforePreview, `zero writes may be issued before the confirmation: ${JSON.stringify(daemon.writes.slice(writesBeforePreview))}`);
  assert.equal(daemon.tagApplies.length, 0, "no apply may be issued before the confirmation");

  // 10. Confirm: exactly one digest-bound apply is issued, the surface issues no
  // per-subject rename writes of its own, and the daemon's per-subject outcomes
  // are rendered as reported.
  const appliesBeforeConfirm = daemon.tagApplies.length;
  const upsertsBeforeConfirm = daemon.upserts.length;
  const deletesBeforeConfirm = daemon.deletes.length;
  await surface.locator('[data-action="apply-rename"]').click();
  await surface.locator('.tags-applied[data-partial="false"]').waitFor({ state: "visible", timeout: 20000 });
  assert.ok(await until(page, () => daemon.tagApplies.length > appliesBeforeConfirm), "the confirmation must issue annotation.tag_apply");
  assert.equal(daemon.tagApplies.length, appliesBeforeConfirm + 1, `one confirmation must issue exactly one apply: ${JSON.stringify(daemon.tagApplies.slice(appliesBeforeConfirm))}`);
  const applyRequest = daemon.tagApplies[daemon.tagApplies.length - 1];
  assert.equal(String(applyRequest.plan_digest), planDigest, "the apply must carry the confirmed plan digest");
  assert.equal(String(applyRequest.from), planSource, "the apply must carry the plan's source name");
  assert.equal(String(applyRequest.to), planTarget, "the apply must carry the plan's target name");
  assert.equal(daemon.upserts.length, upsertsBeforeConfirm, "the surface must not issue per-subject upserts for a rename");
  assert.equal(daemon.deletes.length, deletesBeforeConfirm, "the surface must not issue per-subject deletes for a rename");
  const applied = surface.locator(".tags-applied");
  assert.equal(await applied.getAttribute("data-applied-changed"), "2", "both planned subjects must be reported as changed");
  assert.equal(await applied.getAttribute("data-applied-failed"), "0", "a clean apply must report no failure");
  assert.equal(await applied.getAttribute("data-applied-digest"), planDigest, "the applied record must carry the confirmed digest");
  assert.equal(await applied.getAttribute("data-partial"), "false", "a clean apply must not read as partial");
  const appliedRows = await applied.locator("[data-applied-row]").evaluateAll((nodes) => nodes.map((node) => ({
    ref: node.getAttribute("data-subject-ref") ?? "",
    outcome: node.getAttribute("data-outcome") ?? "",
    tombstoned: node.getAttribute("data-source-tombstoned") ?? "",
  })));
  assert.equal(appliedRows.length, 2, "the daemon must report one outcome per planned subject");
  for (const row of appliedRows) {
    assert.equal(row.outcome, "CHANGED", `the daemon must report each planned subject as CHANGED: ${JSON.stringify(row)}`);
    assert.equal(row.tombstoned, "true", "a CHANGED outcome must state that the source record was tombstoned");
  }
  assert.match((await surface.locator(".tags-rename-action").innerText()).trim(), /All 2 subjects changed|全部 2 个主题已完成变更/, "a clean apply must be reported as such");
  const moved = await until(page, () => {
    const list = daemon.annotationLists[daemon.annotationLists.length - 1];
    return liveTagRecords(list, planSource).length === 0 && liveTagRecords(list, planTarget).length === 2;
  });
  assert.ok(moved, "the daemon's own read must show the old name gone and the new name on both subjects");
  assert.equal(await surface.locator(`.tag-row[data-tag-body="${planSource}"]`).count(), 0, "the old name must no longer be a tag row");
  // The applied record survives the old name disappearing: it is the visible
  // record of what was written, and it still names the source tag.
  assert.equal(await applied.isVisible(), true, "the applied record must stay visible after a full rename");
  assert.equal((await surface.locator('[data-fact="selected-tag"]').innerText()).trim(), planSource, "the applied record must keep the changed name visible while its row is gone");

  // 11. Reversibility is the same planned operation with the names swapped: it
  // is prepared without a write, planned by the daemon, and confirmed again.
  // Nothing here claims a rollback.
  const writesBeforeReverse = daemon.writes.length;
  const plansBeforeReverse = daemon.tagPlanAnswers.length;
  await surface.locator('[data-action="prepare-reverse"]').click();
  await page.waitForTimeout(150);
  assert.equal(daemon.writes.length, writesBeforeReverse, "preparing the reverse change must not write");
  assert.equal(await surface.locator(".tags-rename-field input").inputValue(), planSource, "the reverse must be filled in with the previous name");
  assert.equal(await surface.locator(".tags-preview").count(), 0, "the reverse must be planned before it can be applied");
  await surface.locator('[data-action="preview-rename"]').click();
  await surface.locator(".tags-preview").waitFor({ state: "visible", timeout: 10000 });
  assert.ok(await until(page, () => daemon.tagPlanAnswers.length > plansBeforeReverse), "the reverse must be planned by the daemon too");
  const reverseAnswer = daemon.tagPlanAnswers[daemon.tagPlanAnswers.length - 1];
  assert.notEqual(String(reverseAnswer.data?.plan_digest ?? ""), planDigest, "the reverse plan must carry its own digest");
  assert.equal(await surface.locator(".tags-applied").count(), 0, "planning the reverse must replace the previous applied record");
  const reverseRows = await surface.locator(".tags-preview [data-preview-row]").evaluateAll((nodes) => nodes.map((node) => ({
    ref: node.getAttribute("data-subject-ref") ?? "",
    addNoop: node.querySelector('[data-fact="preview-change"][data-change-action="ADD_TAG"]')?.getAttribute("data-change-noop") ?? "",
  })));
  assert.equal(reverseRows.length, 2, "the reverse must plan both subjects");
  for (const row of reverseRows) assert.equal(row.addNoop, "false", "the reverse re-adds the old name as a real change");
  await surface.locator('[data-action="apply-rename"]').click();
  await surface.locator('.tags-applied[data-partial="false"]').waitFor({ state: "visible", timeout: 20000 });
  assert.equal((await surface.locator(".tags-applied").getAttribute("data-applied-target")).trim(), planSource, "the applied record must name the reverse target");
  const restored = await until(page, () => {
    const list = daemon.annotationLists[daemon.annotationLists.length - 1];
    return liveTagRecords(list, planSource).length === 2 && liveTagRecords(list, planTarget).length === 0;
  });
  assert.ok(restored, "the reverse apply must restore the previous name on both subjects");

  // 12. A partial apply is rendered from the daemon's own per-subject outcomes
  // and is never softened. The daemon refuses a stale digest before writing, so
  // a mid-apply interruption cannot be produced through the browser; this
  // assertion injects a daemon-shaped answer whose claimed per-subject state is
  // first made true in the store, and the real per-subject partial path is
  // proven in server/controlplane/tag_ops_test.go with a deterministic
  // interruption between the add and the tombstone.
  await surface.locator(`.tag-row[data-tag-body="${planSource}"] .tag-row-button`).click();
  await page.waitForFunction((body) => document.querySelector(".tags-detail-heading [data-fact='selected-tag']")?.textContent === body, planSource, { timeout: 10000 });
  const partialTarget = `cairn-tags-partial-${stamp}`;
  const plansBeforePartial = daemon.tagPlanAnswers.length;
  await surface.locator(".tags-rename-field input").fill(partialTarget);
  await surface.locator('[data-action="preview-rename"]').click();
  await surface.locator(".tags-preview").waitFor({ state: "visible", timeout: 10000 });
  assert.ok(await until(page, () => daemon.tagPlanAnswers.length > plansBeforePartial), "the partial scenario must start from a real daemon plan");
  const partialDigest = String(await surface.locator(".tags-preview").getAttribute("data-plan-digest"));
  // Make the injected answer's claims true in the store: beta carries both
  // names, alpha still carries only the source name.
  const betaTarget = (await daemonCommand("annotation.upsert", { workspace_id: workspaceID, subject_ref: betaRef, kind: "TAG", body: partialTarget, expected_revision: 0 })).annotation;
  await page.route("**/api/v1/command", async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
    if (payload?.operation !== "annotation.tag_apply") {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      status: "DEGRADED",
      reasons: [{ code: "unavailable", message: "2 of 2 subjects did not complete; each subject's own outcome and reason are listed and this is not a clean rename" }],
      data: {
        schema: "org.cairn.annotation-tag-apply.v1",
        workspace_id: workspaceID,
        from: planSource,
        to: partialTarget,
        plan_digest: String(payload?.input?.plan_digest ?? ""),
        subjects: [
          { subject_ref: alphaRef, outcome: "UNCHANGED", target_created: false, source_tombstoned: false, reason: "simulated tag service outage after the plan was confirmed" },
          { subject_ref: betaRef, outcome: "TARGET_ADDED_SOURCE_REMAINS", target_annotation_id: String(betaTarget?.annotation_id ?? ""), target_created: true, source_tombstoned: false, reason: "simulated tag service outage after the plan was confirmed" },
        ],
        changed: 0, unchanged: 1, source_remains: 1, failed: 2, partial: true, applied: false,
      },
    }) });
  });
  await surface.locator('[data-action="apply-rename"]').click();
  await surface.locator('.tags-applied[data-partial="true"]').waitFor({ state: "visible", timeout: 20000 });
  const partialApplied = surface.locator(".tags-applied");
  assert.equal(await partialApplied.getAttribute("data-applied-changed"), "0", "only the subjects the service reported as changed may count as changed");
  assert.equal(await partialApplied.getAttribute("data-applied-failed"), "2", "the failed subjects must be reported as failed");
  assert.equal(await partialApplied.getAttribute("data-applied-unchanged"), "1", "the subject nothing was written for must be reported as unchanged");
  assert.equal(await partialApplied.getAttribute("data-applied-source-remains"), "1", "the subject carrying both names must be reported as such");
  assert.equal(await partialApplied.getAttribute("data-applied-digest"), partialDigest, "the partial record must carry the confirmed digest");
  const failedRows = await surface.locator("[data-failed-row]").evaluateAll((nodes) => nodes.map((node) => ({ ref: node.getAttribute("data-subject-ref") ?? "", text: node.textContent ?? "" })));
  assert.equal(failedRows.length, 2, `exactly the failed subjects must be listed: ${JSON.stringify(failedRows)}`);
  assert.deepEqual(failedRows.map((row) => row.ref).sort(), [alphaRef, betaRef].sort(), "the failed subjects must be named");
  for (const row of failedRows) assert.match(row.text, /simulated tag service outage/, `each failed subject must carry the service's reason: ${row.text}`);
  const dirtyText = (await surface.locator(".tags-rename-action").innerText()).trim();
  assert.match(dirtyText, DIRTY_SUMMARY, `a partial apply must count what changed: ${dirtyText}`);
  assert.match(dirtyText, DIRTY_NOT_CLEAN, `a partial apply must never read as a clean rename: ${dirtyText}`);
  assert.match(dirtyText, /their own reasons|各自原因/, `the partial report must promise the reasons it lists: ${dirtyText}`);
  assert.equal(await surface.locator('[data-applied-row][data-outcome="UNCHANGED"]').count(), 1, "the applied record must state which subject was left unchanged");
  assert.equal(await surface.locator('[data-applied-row][data-outcome="TARGET_ADDED_SOURCE_REMAINS"]').count(), 1, "the applied record must state which subject carries both names");
  const remainsRow = surface.locator(`[data-applied-row][data-subject-ref="${betaRef}"]`);
  assert.equal(await remainsRow.getAttribute("data-outcome"), "TARGET_ADDED_SOURCE_REMAINS", "the subject left carrying both names must say so");
  assert.match(String(await remainsRow.getAttribute("data-reason")), /simulated tag service outage/, "the applied record must carry the service's own reason");
  assert.match((await remainsRow.locator('[data-fact="applied-reason"]').innerText()).trim(), /simulated tag service outage/, "the reason must be visible on the applied record");
  // The injected answer claims exactly the state the daemon's own records now
  // hold: beta carries both names, alpha carries only the source name.
  const bothNames = await until(page, () => {
    const list = daemon.annotationLists[daemon.annotationLists.length - 1];
    return liveTagRecords(list, planSource).some((record) => String(record.subject_ref) === betaRef)
      && liveTagRecords(list, partialTarget).some((record) => String(record.subject_ref) === betaRef)
      && liveTagRecords(list, partialTarget).every((record) => String(record.subject_ref) !== alphaRef);
  });
  assert.ok(bothNames, "the partial answer's per-subject claims must match the daemon's own records");
  await page.unroute("**/api/v1/command");
  // Restore the store: remove the target name the injected answer claimed was added.
  await daemonCommand("annotation.delete", { workspace_id: workspaceID, annotation_id: betaTarget.annotation_id, expected_revision: betaTarget.revision });

  // 13. A digest-bound apply refuses facts that changed after the plan with a
  // typed conflict, before any write: the surface reports the service's own
  // refusal, renders no applied record, and the refusal writes nothing.
  await surface.locator(`.tag-row[data-tag-body="${planSource}"] .tag-row-button`).click();
  await page.waitForFunction((body) => document.querySelector(".tags-detail-heading [data-fact='selected-tag']")?.textContent === body, planSource, { timeout: 10000 });
  const refusedTarget = `cairn-tags-refused-${stamp}`;
  await surface.locator(".tags-rename-field input").fill(refusedTarget);
  await surface.locator('[data-action="preview-rename"]').click();
  await surface.locator(".tags-preview").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction((body) => Number(document.querySelector(`.tag-row[data-tag-body="${body}"]`)?.getAttribute("data-subject-count") ?? -1) === 2, planSource, { timeout: 15000 });
  const betaSource = liveTagRecords(daemon.annotationLists[daemon.annotationLists.length - 1], planSource).find((record) => String(record.subject_ref) === betaRef);
  assert.ok(betaSource, "the fixture must still carry the source tag on both subjects");
  // Change the facts after the plan: this record disappears, so the confirmed
  // digest no longer describes the daemon's state.
  await daemonCommand("annotation.delete", { workspace_id: workspaceID, annotation_id: betaSource.annotation_id, expected_revision: betaSource.revision });
  const appliesBeforeRefusal = daemon.tagApplies.length;
  await surface.locator('[data-action="apply-rename"]').click();
  assert.ok(await until(page, () => daemon.tagApplies.length > appliesBeforeRefusal, 15000), "the confirmation must still issue the apply the daemon then refuses");
  await page.waitForFunction(() => document.querySelector(".tags-rename-action")?.getAttribute("data-action-state") === "FAILED", null, { timeout: 20000 });
  const refusalText = (await surface.locator(".tags-rename-action").innerText()).trim();
  assert.match(refusalText, REFUSED_DIGEST, `the surface must carry the daemon's refusal: ${refusalText}`);
  assert.match(refusalText, /nothing was written|没有写入/, `the refusal must state that nothing was written: ${refusalText}`);
  assert.equal(await surface.locator(".tags-applied").count(), 0, "a refused apply must not render an applied record");
  const refusedNoWrite = await until(page, () => {
    const list = daemon.annotationLists[daemon.annotationLists.length - 1];
    return liveTagRecords(list, planSource).length === 1 && liveTagRecords(list, refusedTarget).length === 0;
  });
  assert.ok(refusedNoWrite, "a refused apply must not have written anything");
  // Restore the source name on beta for the rest of the run, and discard the
  // stale plan so nothing later acts on it.
  await daemonCommand("annotation.upsert", { workspace_id: workspaceID, subject_ref: betaRef, kind: "TAG", body: planSource, expected_revision: 0 });
  await surface.locator('[data-action="discard-preview"]').click();
  await page.waitForFunction(() => document.querySelector(".tags-preview") === null, null, { timeout: 10000 });

  // 14. The surface's whole operation set, and the absence of any machine
  // suggestion or in-place rewrite control.
  for (const request of daemon.requests) {
    assert.ok(SURFACE_READ_OPERATIONS.includes(request.operation) || SURFACE_WRITE_OPERATIONS.includes(request.operation), `no other operation may be issued: ${request.operation}`);
  }
  for (const upsert of daemon.upserts) assert.equal(String(upsert.kind), "TAG", "the only annotation kind this surface writes is TAG");
  const controls = await surface.locator("button").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-action") ?? ""));
  assert.ok(controls.length >= 4, `the surface must render its controls: ${JSON.stringify(controls)}`);
  for (const action of controls) assert.ok(SURFACE_ACTIONS.includes(action), `every control must belong to the tags action set: ${action || "(none)"}`);
  assert.equal(await surface.locator('[data-action="apply-suggestion"], [data-action="suggestion"], [data-action="classify"], [data-action="merge-silently"]').count(), 0, "no machine suggestion or silent merge control may exist");
  assert.match(await surface.innerText(), /applies no machine suggestion|不会应用任何机器建议/, "the surface must state that it applies no machine suggestion");

  // 15. Empty and blocked are different facts, and a vocabulary that only
  // reports live records says so.
  let mockAnnotations = "empty";
  const routeMock = async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
    if (payload?.operation !== "annotation.list") { await route.continue(); return; }
    if (mockAnnotations === "blocked") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "FAILED", reasons: [{ message: "simulated tags outage" }] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "SUCCEEDED", data: { annotations: [] } }) });
  };
  await page.route("**/api/v1/command", routeMock);
  await surface.locator('[data-action="refresh"]').click();
  const empty = surface.locator('.tags-empty[data-empty="true"]');
  await empty.waitFor({ state: "visible", timeout: 15000 });
  const emptyText = (await empty.innerText()).trim();
  assert.match(emptyText, EMPTY_TITLE, `the empty state must name the missing vocabulary: ${emptyText}`);
  assert.match(emptyText, EMPTY_LIVE_ONLY, `the empty state must say the list reads live records: ${emptyText}`);
  assert.match(emptyText, EMPTY_TOMBSTONE, `the empty state must state what a deleted tag becomes: ${emptyText}`);
  assert.match(emptyText, EMPTY_CREATES, `the empty state must say what creates a tag: ${emptyText}`);
  assert.equal(await surface.locator(".tag-row").count(), 0, "an empty vocabulary renders no tag row");

  mockAnnotations = "blocked";
  await surface.locator('[data-action="refresh"]').click();
  const blocked = surface.locator('.tags-blocked[data-state="BLOCKED"]');
  await blocked.waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await surface.getAttribute("data-state"), "BLOCKED", "an unreadable vocabulary must render as blocked, never as empty");
  assert.match((await blocked.innerText()).trim(), /simulated tags outage/, "the blocked state must carry the daemon's reason");
  assert.equal(await surface.locator(".tag-row").count(), 0, "a blocked vocabulary renders no row");
  await page.unroute("**/api/v1/command");
  await surface.locator('[data-action="refresh"]').click();
  await page.waitForFunction(() => document.querySelector(".tags-surface")?.getAttribute("data-state") === "READY", null, { timeout: 20000 });
  assert.ok(await surface.locator(".tag-row").count() > 0, "the restored vocabulary must render again");

  // 16. The library handoff is a real navigation: "Open in library" leaves this
  // view for the library the shell owns, and the surface says in advance that
  // the library applies no inbound tag filter.
  await surface.locator(`.tag-row[data-tag-body="${singleTag}"] .tag-row-button`).click();
  await surface.locator(".tag-subject-row").first().waitFor({ state: "visible", timeout: 10000 });
  assert.match(await surface.innerText(), /no inbound tag filter|不应用入口标签筛选/, "the surface must state the library handoff's limit before it is used");
  await surface.locator('[data-action="open-in-library"]').first().click();
  await page.locator(".result-list").or(page.locator(".empty-state")).first().waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await page.locator(SURFACE).count(), 0, "the library handoff must actually leave the tags view");
  await entry.click();
  await surface.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(() => document.querySelector(".tags-surface")?.getAttribute("data-state") === "READY", null, { timeout: 20000 });

  // 17. No horizontal overflow at the narrow boundary, then leave the page on
  // the library view the later phases expect.
  await assertNoHorizontalOverflow(ctx);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: /^(Library|内容库)/ }).click();
  await page.locator(".result-list").or(page.locator(".empty-state")).first().waitFor({ state: "visible", timeout: 10000 });
}
