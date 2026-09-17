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
//   - a rename preview must list exactly the affected subjects and records
//     while zero writes have been issued, and the apply must issue exactly the
//     previewed per-subject upsert/delete pairs;
//   - a forced partial failure must report the failed subjects with the
//     daemon's reason, must never read as a clean rename, and the failed
//     subject must still carry the source tag in the daemon's own read;
//   - the only operations the surface may issue are the read set plus
//     `annotation.upsert`/`annotation.delete` for TAG rows, no machine
//     suggestion control may exist, and Escape must return focus to the tags
//     rail entry.

import assert from "node:assert/strict";
import { assertNoHorizontalOverflow } from "./support.mjs";

const RAIL_ENTRY = 'button.workspace-nav-item[data-view="tags"]';
const SURFACE = ".tags-surface";

// The only operations this surface may ever ask the daemon for.
const SURFACE_READ_OPERATIONS = ["annotation.list", "content.list", "status.get", "search.query"];
const SURFACE_WRITE_OPERATIONS = ["annotation.upsert", "annotation.delete"];
// The action set every rendered button must belong to.
const SURFACE_ACTIONS = ["refresh", "select-tag", "toggle-subject", "open-in-library", "remove-subject-tag", "add-tag-subject", "preview-rename", "apply-rename", "discard-preview", "prepare-reverse"];

const EMPTY_TITLE = /No live tag is recorded in this workspace yet|此工作区尚未记录任何存续标签/;
const EMPTY_LIVE_ONLY = /live TAG annotation records only|只读取服务的存续 TAG 注释记录/;
const EMPTY_TOMBSTONE = /tombstoned instead of being kept as an empty row|被删除的标签会置为墓碑/;
const EMPTY_CREATES = /creates the first record|就会创建第一条记录/;
const DIRTY_SUMMARY = /1 of 2 subjects changed|已变更 1 个主题，共 2 个/;
const DIRTY_NOT_CLEAN = /not a clean rename|不是一次干净的重命名/;

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

  // 2. Seed tag facts through the daemon's own operation so the rendered counts
  // have a truth to compare against: one tag on both subjects, one on beta
  // only, and two case variants of the same spelling.
  const stamp = Date.now();
  const pairTag = `rw-tags-seeded-${stamp}`;
  const singleTag = `rw-tags-single-${stamp}`;
  const upperTag = `rw-tags-Case-${stamp}`;
  const lowerTag = `rw-tags-case-${stamp}`;
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
  // annotation.list answer afterwards.
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

  // 9. Rename: the preview lists the exact subjects and records while zero
  // writes have been issued.
  await surface.locator(`.tag-row[data-tag-body="${pairTag}"] .tag-row-button`).click();
  await page.waitForFunction((body) => document.querySelector(".tags-detail-heading [data-fact='selected-tag']")?.textContent === body, pairTag, { timeout: 10000 });
  const renamedTag = `${pairTag}-renamed`;
  const writesBeforePreview = daemon.writes.length;
  await surface.locator(".tags-rename-field input").fill(renamedTag);
  await surface.locator('[data-action="preview-rename"]').click();
  const preview = surface.locator(".tags-preview");
  await preview.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await preview.getAttribute("data-preview-count"), "2", "the preview must count the affected subjects");
  assert.equal(await preview.getAttribute("data-writes-issued"), "0", "the preview must state that no write has been issued");
  const previewRows = await preview.locator("[data-preview-row]").evaluateAll((nodes) => nodes.map((node) => ({
    ref: node.getAttribute("data-subject-ref") ?? "",
    annotationID: node.getAttribute("data-annotation-id") ?? "",
    revision: node.getAttribute("data-revision") ?? "",
  })));
  const pairRecords = liveTagRecords(daemon.annotationLists[daemon.annotationLists.length - 1], pairTag);
  assert.deepEqual(previewRows.map((row) => row.ref).sort(), pairRecords.map((record) => String(record.subject_ref)).sort(), "the preview must name exactly the daemon's subjects for this tag");
  for (const row of previewRows) {
    const record = pairRecords.find((candidate) => String(candidate.subject_ref) === row.ref);
    assert.equal(row.annotationID, String(record.annotation_id), `the preview must name the record that will be deleted: ${row.ref}`);
    assert.equal(row.revision, String(record.revision), `the preview must carry the record's revision: ${row.ref}`);
  }
  assert.equal(daemon.writes.length, writesBeforePreview, `zero writes may be issued before the confirmation: ${JSON.stringify(daemon.writes.slice(writesBeforePreview))}`);

  // 10. Confirm: exactly the previewed per-subject pairs are written, and the
  // vocabulary moves to the new name.
  const upsertsBeforeApply = daemon.upserts.length;
  const deletesBeforeApply = daemon.deletes.length;
  await surface.locator('[data-action="apply-rename"]').click();
  await surface.locator('.tags-applied[data-partial="false"]').waitFor({ state: "visible", timeout: 20000 });
  const applied = surface.locator(".tags-applied");
  assert.equal(await applied.getAttribute("data-applied-changed"), "2", "both previewed subjects must be reported as changed");
  assert.equal(await applied.getAttribute("data-applied-failed"), "0", "a clean apply must report no failure");
  const applyUpserts = daemon.upserts.slice(upsertsBeforeApply).filter((input) => input.body === renamedTag);
  assert.equal(applyUpserts.length, 2, `the apply must add the target name once per previewed subject: ${JSON.stringify(applyUpserts)}`);
  assert.deepEqual(applyUpserts.map((input) => String(input.subject_ref)).sort(), previewRows.map((row) => row.ref).sort(), "the apply must target exactly the previewed subjects");
  const applyDeletes = daemon.deletes.slice(deletesBeforeApply);
  assert.equal(applyDeletes.length, 2, `the apply must delete exactly the previewed records: ${JSON.stringify(applyDeletes)}`);
  for (const deletion of applyDeletes) {
    const row = previewRows.find((candidate) => candidate.annotationID === String(deletion.annotation_id));
    assert.ok(row, `every delete must use a previewed annotation_id: ${JSON.stringify(deletion)}`);
    assert.equal(Number(deletion.expected_revision), Number(row.revision), "every delete must use the previewed revision");
  }
  assert.match((await surface.locator(".tags-rename-action").innerText()).trim(), /All 2 subjects changed|全部 2 个主题已完成变更/, "a clean apply must be reported as such");
  const moved = await until(page, () => {
    const list = daemon.annotationLists[daemon.annotationLists.length - 1];
    return liveTagRecords(list, pairTag).length === 0 && liveTagRecords(list, renamedTag).length === 2;
  });
  assert.ok(moved, "the daemon's own read must show the old name gone and the new name on both subjects");
  assert.equal(await surface.locator(`.tag-row[data-tag-body="${pairTag}"]`).count(), 0, "the old name must no longer be a tag row");
  // The applied record survives the old name disappearing: it is the visible
  // record of what was written, and it still names the source tag.
  assert.equal(await applied.isVisible(), true, "the applied record must stay visible after a full rename");
  assert.equal((await surface.locator('[data-fact="selected-tag"]').innerText()).trim(), pairTag, "the applied record must keep the changed name visible while its row is gone");

  // 11. A forced partial failure is reported as a partial failure: the failed
  // subject is named with the daemon's reason, and the surface never claims a
  // clean rename.
  await surface.locator(`.tag-row[data-tag-body="${renamedTag}"] .tag-row-button`).click();
  await page.waitForFunction((body) => document.querySelector(".tags-detail-heading [data-fact='selected-tag']")?.textContent === body, renamedTag, { timeout: 10000 });
  const partialTag = `${renamedTag}-partial`;
  await surface.locator(".tags-rename-field input").fill(partialTag);
  await surface.locator('[data-action="preview-rename"]').click();
  await surface.locator(".tags-preview").waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await surface.locator(".tags-preview").getAttribute("data-preview-count"), "2", "the second rename must preview both subjects");
  const writesBeforePartial = daemon.writes.length;
  await page.route("**/api/v1/command", async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
    if (payload?.operation === "annotation.upsert" && payload?.input?.subject_ref === betaRef && payload?.input?.body === partialTag) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "FAILED", reasons: [{ message: "simulated rename outage" }] }) });
      return;
    }
    await route.continue();
  });
  await surface.locator('[data-action="apply-rename"]').click();
  await surface.locator('.tags-applied[data-partial="true"]').waitFor({ state: "visible", timeout: 20000 });
  assert.equal(await applied.getAttribute("data-applied-changed"), "1", "only the subject whose writes succeeded may be reported as changed");
  assert.equal(await applied.getAttribute("data-applied-failed"), "1", "the failed subject must be reported as failed");
  const failedRows = await surface.locator("[data-failed-row]").evaluateAll((nodes) => nodes.map((node) => ({ ref: node.getAttribute("data-subject-ref") ?? "", text: node.textContent ?? "" })));
  assert.equal(failedRows.length, 1, `exactly the failed subject must be listed: ${JSON.stringify(failedRows)}`);
  assert.equal(failedRows[0].ref, betaRef, "the failed subject must be named");
  assert.match(failedRows[0].text, /simulated rename outage/, `the failed subject must carry the daemon's reason: ${failedRows[0].text}`);
  const dirtyText = (await surface.locator(".tags-rename-action").innerText()).trim();
  assert.match(dirtyText, DIRTY_SUMMARY, `a partial apply must count what changed: ${dirtyText}`);
  assert.match(dirtyText, DIRTY_NOT_CLEAN, `a partial apply must never read as a clean rename: ${dirtyText}`);
  assert.match(dirtyText, /their own reasons|各自原因/, `the partial report must promise the reasons it lists: ${dirtyText}`);
  assert.equal(await surface.locator('[data-applied-row][data-outcome="CHANGED"]').count(), 1, "the applied record must state which subject changed");
  assert.equal(await surface.locator('[data-applied-row][data-outcome="UNCHANGED"]').count(), 1, "the applied record must state which subject was left unchanged");
  const failedRecord = surface.locator(`[data-applied-row][data-subject-ref="${betaRef}"]`);
  assert.equal(await failedRecord.getAttribute("data-outcome"), "UNCHANGED", "a failed target write leaves the subject unchanged");
  assert.match(String(await failedRecord.getAttribute("data-reason")), /simulated rename outage/, "the applied record must carry the daemon's own reason");
  assert.match((await failedRecord.locator('[data-fact="applied-reason"]').innerText()).trim(), /simulated rename outage/, "the reason must be visible on the applied record");
  const keptSource = await until(page, () => liveTagRecords(daemon.annotationLists[daemon.annotationLists.length - 1], renamedTag).some((record) => String(record.subject_ref) === betaRef));
  assert.ok(keptSource, "the failed subject must still carry the source tag in the daemon's own read");
  assert.equal(daemon.writes.length > writesBeforePartial, true, "the apply must have issued the writes it then reported on");
  await page.unroute("**/api/v1/command");

  // 12. Reversibility is a prepared second operation, never a silent rewrite:
  // the reverse is filled in without any write and must be previewed again.
  const writesBeforeReverse = daemon.writes.length;
  await surface.locator('[data-action="prepare-reverse"]').click();
  await page.waitForTimeout(150);
  assert.equal(daemon.writes.length, writesBeforeReverse, "preparing the reverse change must not write");
  assert.equal(await surface.locator(".tags-rename-field input").inputValue(), renamedTag, "the reverse must be filled in with the previous name");
  assert.equal(await surface.locator(".tags-preview").count(), 0, "the reverse must be previewed before it can be applied");

  // 13. The surface's whole operation set, and the absence of any machine
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

  // 14. Empty and blocked are different facts, and a vocabulary that only
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

  // 15. The library handoff is a real navigation: "Open in library" leaves this
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

  // 16. No horizontal overflow at the narrow boundary, then leave the page on
  // the library view the later phases expect.
  await assertNoHorizontalOverflow(ctx);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: /^(Library|内容库)/ }).click();
  await page.locator(".result-list").or(page.locator(".empty-state")).first().waitFor({ state: "visible", timeout: 10000 });
}
