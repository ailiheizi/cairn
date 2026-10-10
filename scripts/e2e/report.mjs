// E2E assertions for the selection report (Tier-1 spec §3 item 7).
//
// Owner: lib/report.ts, components/SelectionBar.tsx, styles/report.css,
// i18n/report.ts and this module. `scripts/web-e2e.mjs` calls it once in the
// online phase, after the tags phase.
//
// The assertions are written so a fabricated report fails:
//
//   - every fact in the downloaded document is compared with the daemon's own
//     payload: the provenance paths, the SHA-256 content identities, the
//     logical sizes, the note text with its source label, and the tags all
//     come from the `content.list`/`search.query` answers, `annotation.list`,
//     and the protection axis this run captured;
//   - a fact the daemon did not report must appear as the real `UNKNOWN` fact
//     with the reason — a search hit carries no logical size, so the
//     search-sourced document must say so and must not invent a size;
//   - a subject whose reads failed must stay in the document with the daemon's
//     reason instead of being dropped, and the bar's own message must count it;
//   - the report cap must be honest: subjects beyond it are never read at all,
//     and the document says so instead of silently shrinking;
//   - the document must carry no internal subject/entry id, must be free of
//     trailing whitespace on every line, and must end with exactly one newline.

import assert from "node:assert/strict";
import fs from "node:fs";

const REPORT_BUTTON = '.selection-bar [data-action="selection-report"]';
const REPORT_NOTE = ".selection-report-note";
const REPORT_STATE = ".selection-report-state";
const MD_FILENAME = /^cairn-selection-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.md$/;
/** The admitted protection outcomes, in the claim order the report uses. */
const PROTECTION_OUTCOMES = [
  "EXACT_PROTECTED",
  "EXACT_FALLBACK",
  "EXTERNAL_REPLAYABLE",
  "LINK_ONLY_UNPROTECTED",
  "EXPLICITLY_UNPROTECTED",
  "BLOCKED",
  "UNAVAILABLE",
];
/** The report's read cap (`REPORT_SUBJECT_CAP` in components/SelectionBar.tsx). */
const CAP = 200;
const UNKNOWN_LENGTH_REASON = /the daemon did not report a logical length|服务没有报告此条目的逻辑长度/;
const UNKNOWN_SIZE_REASON = /the daemon did not report a logical size|服务没有报告此条目的逻辑大小/;
const LABEL = {
  path: /Provenance path|来源路径/,
  size: /Logical size|逻辑大小/,
  identity: /Exact identity|精确身份/,
  length: /Logical length|逻辑长度/,
  protection: /Protection outcome|保护结果/,
  representation: /Exact representation|原始表示/,
  tags: /User tags|用户标签/,
  notes: /Notes[:：]|备注[:：]/,
};
const NOTE = /\[(User note|用户备注)\][^\n]*durable browser note/;
const READ_FAILED = /(Not one read succeeded for this subject|此项目的所有读取都失败了)/;

/** Waits for a captured daemon answer, because response bodies arrive asynchronously. */
async function until(page, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await page.waitForTimeout(50);
  }
  return predicate();
}

/** One section of the document, from its heading to the next heading. */
function sectionOf(text, name) {
  const start = text.indexOf(`## ${name}`);
  if (start < 0) return "";
  const next = text.indexOf("\n## ", start);
  return next < 0 ? text.slice(start) : text.slice(start, next);
}

/** True when one line carries the label and the value together. */
function labeled(section, label, value) {
  return section.split("\n").some((line) => label.test(line) && line.includes(value));
}

function factLine(section, label) {
  const line = section.split("\n").find((candidate) => label.test(candidate));
  return line ? line.trim() : "(missing)";
}

/** True when a size-like line carries the daemon's byte count in either locale. */
function byteFact(section, label, bytes) {
  return section.split("\n").some((line) => label.test(line) && line.includes(String(bytes)) && /bytes|字节/.test(line));
}

/** The document rules that must hold for every produced report. */
function assertDocumentShape(text, label) {
  assert.ok(text.endsWith("\n"), `${label}: the document must end with a newline`);
  assert.ok(!text.endsWith("\n\n"), `${label}: the document must end with exactly one newline`);
  assert.ok(!text.includes("\r"), `${label}: the document must not contain carriage returns`);
  for (const line of text.split("\n")) {
    assert.equal(line, line.replace(/[ \t]+$/, ""), `${label}: no line may carry trailing whitespace: ${JSON.stringify(line)}`);
  }
  assert.match(text, /^# /, `${label}: the document must open with its title`);
  assert.doesNotMatch(text, /subj_|entry_|wsp_/, `${label}: the document must not carry internal ids: ${text.slice(0, 400)}`);
}

async function showLibrary(ctx) {
  const { page } = ctx;
  if (await page.evaluate(() => Boolean(document.querySelector('[aria-modal="true"]')))) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
  }
  await page.getByRole("button", { name: /^(Library|内容库)/ }).click();
  await page.locator(".result-list").or(page.locator(".empty-state")).first().waitFor({ state: "visible", timeout: 15000 });
}

/** Clicks the rail entry until the workspace listing has actually been read. */
async function reloadListing(ctx, daemon) {
  const { page } = ctx;
  const before = daemon.contentLists.length;
  for (let attempt = 0; attempt < 3 && daemon.contentLists.length === before; attempt += 1) {
    await page.getByRole("button", { name: /^(Library|内容库)/ }).click();
    await page.waitForTimeout(400);
  }
  assert.ok(await until(page, () => daemon.contentLists.length > before), "the library must read the workspace listing with content.list");
}

async function clearSelection(page) {
  const bar = page.locator(".selection-bar");
  if (await bar.count() === 0) return;
  await bar.getByRole("button", { name: /清除选择|Clear selection/ }).click();
  await bar.waitFor({ state: "hidden", timeout: 10000 });
}

/** Selects the two fixture subjects over whatever listing is rendered. */
async function selectPair(page) {
  await clearSelection(page);
  const row = (name) => page.getByRole("main").getByRole("button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first();
  await row("alpha.txt").click({ modifiers: ["Meta"] });
  await row("beta.txt").click({ modifiers: ["Meta"] });
  await page.locator(".selection-bar").waitFor({ state: "visible", timeout: 10000 });
  assert.equal(Number(await page.locator(".result-list").getAttribute("data-selection-count")), 2, "this assertion reads exactly two selected subjects");
}

/** Clicks the action and returns the downloaded document. */
async function downloadReport(page, timeout = 60000) {
  const waiter = page.waitForEvent("download", { timeout });
  await page.locator(REPORT_BUTTON).click();
  const download = await waiter;
  return { filename: download.suggestedFilename(), text: fs.readFileSync(await download.path(), "utf8") };
}

export async function assertSelectionReport(ctx) {
  const { page } = ctx;

  // Module-local captures, all filled from the daemon's own traffic.
  const daemon = { contentLists: [], searchHits: [], protectionAnswers: [], requests: [] };
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/command")) return;
    let payload;
    try { payload = request.postDataJSON(); } catch { return; }
    daemon.requests.push({ operation: String(payload?.operation ?? ""), input: payload?.input ?? {} });
  });
  page.on("response", async (response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/v1/command")) return;
    let request;
    try { request = response.request().postDataJSON(); } catch { return; }
    let body;
    try { body = await response.json(); } catch { return; }
    const operation = String(request?.operation ?? "");
    if (operation === "content.list" && Array.isArray(body?.data?.items)) daemon.contentLists.push(body.data.items);
    if (operation !== "search.query") return;
    const filters = request?.input?.filters ?? {};
    if (filters.protection_mode) {
      daemon.protectionAnswers.push({ outcome: String(filters.protection_mode), hits: body?.data?.hits ?? [] });
      return;
    }
    if (Array.isArray(body?.data?.hits)) daemon.searchHits.push(body.data.hits);
  });
  /** The outcome the daemon's protection axis claims for one subject. */
  const claimFor = (subjectRef) => {
    for (const outcome of PROTECTION_OUTCOMES) {
      const claimed = daemon.protectionAnswers.some((answer) => answer.outcome === outcome && answer.hits.some((hit) => String(hit?.subject_ref ?? "") === subjectRef));
      if (claimed) return outcome;
    }
    return "";
  };

  await showLibrary(ctx);

  // 1. The action lives on the selection bar, and the bar exists only with a
  // non-empty selection.
  await clearSelection(page);
  assert.equal(await page.locator(REPORT_BUTTON).count(), 0, "the report action must not exist without a selection");

  // 2. The real library listing: two known fixture subjects, one document.
  await reloadListing(ctx, daemon);
  const listing = daemon.contentLists[daemon.contentLists.length - 1];
  const alpha = listing.find((item) => String(item.name ?? "") === "alpha.txt");
  const beta = listing.find((item) => String(item.name ?? "") === "beta.txt");
  assert.ok(alpha && beta, `the fixture must publish alpha.txt and beta.txt: ${listing.map((item) => item.name).join(", ")}`);
  const alphaRef = String(alpha.subject_ref ?? "");
  const betaRef = String(beta.subject_ref ?? "");
  assert.ok(alphaRef && betaRef, "the fixture subjects must carry stable subject refs");
  assert.ok(String(alpha.content_id ?? "").startsWith("sha256:"), `the daemon must report an exact identity: ${alpha.content_id}`);
  assert.equal(String(alpha.content_id), String(beta.content_id), "the fixture's identical files must share the daemon's identity");

  await selectPair(page);
  const note = (await page.locator(REPORT_NOTE).first().innerText()).trim();
  assert.match(note, /from this daemon|从本服务/, `the bar must state that the report reads the daemon: ${note}`);
  assert.match(note, /bounded concurrency|受限并发/, `the bar must state its bounded read behavior: ${note}`);
  assert.match(note, /Nothing is uploaded|不会上传/, `the bar must state that nothing is uploaded: ${note}`);

  const protectionBefore = daemon.protectionAnswers.length;
  const requestsBefore = daemon.requests.length;
  const first = await downloadReport(page);
  assert.match(first.filename, MD_FILENAME, `the filename must be cairn-selection-<UTC timestamp>.md: ${first.filename}`);
  assertDocumentShape(first.text, "library report");
  const alphaSection = sectionOf(first.text, "alpha.txt");
  const betaSection = sectionOf(first.text, "beta.txt");
  assert.ok(alphaSection && betaSection, `both selected subjects must have a section: ${first.text.slice(0, 600)}`);
  // Both provenance paths and both exact identities, from the daemon payload.
  assert.ok(labeled(alphaSection, LABEL.path, String(alpha.path ?? "")), `alpha's section must carry the daemon's provenance path: ${factLine(alphaSection, LABEL.path)}`);
  assert.ok(labeled(betaSection, LABEL.path, String(beta.path ?? "")), `beta's section must carry the daemon's provenance path: ${factLine(betaSection, LABEL.path)}`);
  assert.ok(labeled(alphaSection, LABEL.identity, String(alpha.content_id)), `alpha's section must carry the daemon's exact identity: ${factLine(alphaSection, LABEL.identity)}`);
  assert.ok(labeled(betaSection, LABEL.identity, String(beta.content_id)), `beta's section must carry the daemon's exact identity: ${factLine(betaSection, LABEL.identity)}`);
  assert.ok(first.text.split(String(alpha.content_id)).length - 1 >= 2, "both selected subjects must render their exact identity");
  // The listing's own logical size and length.
  assert.ok(byteFact(alphaSection, LABEL.size, alpha.logical_size), `alpha's section must carry the daemon's logical size: ${factLine(alphaSection, LABEL.size)}`);
  assert.ok(byteFact(alphaSection, LABEL.length, alpha.logical_size), `alpha's section must carry the daemon's logical length: ${factLine(alphaSection, LABEL.length)}`);
  // The real note text with its source label, and the real user tag.
  assert.match(alphaSection, NOTE, `alpha's section must carry the durable note with its source label: ${factLine(alphaSection, LABEL.notes)}`);
  assert.ok(labeled(alphaSection, LABEL.tags, "browser-e2e"), `alpha's section must carry the daemon's user tag: ${factLine(alphaSection, LABEL.tags)}`);
  // The protection outcome is the daemon's own claim, never a browser guess.
  const alphaClaim = claimFor(alphaRef);
  const alphaProtection = factLine(alphaSection, LABEL.protection);
  if (alphaClaim) assert.ok(alphaProtection.includes(alphaClaim), `alpha's protection fact must be the daemon's own outcome ${alphaClaim}: ${alphaProtection}`);
  else assert.ok(alphaProtection.includes("UNKNOWN"), `an unclaimed protection outcome must render UNKNOWN: ${alphaProtection}`);
  // The header states the item count, the source, and exactly what was read.
  assert.match(first.text, /Selected subjects: 2|所选项目数：2/, "the header must state the item count");
  assert.match(first.text, /Selection source:.*content\.list|选择来源：.*content\.list/, "the header must state the listing this selection came from");
  const scopeLine = first.text.split("\n").find((line) => /Read scope|读取范围/.test(line)) ?? "";
  for (const operation of ["content.list", "annotation.list", "description.list", "description.get", "representation.list", "search.query"]) {
    assert.ok(scopeLine.includes(operation), `the header must name the operations it read: ${operation} missing from ${scopeLine}`);
  }
  assert.match(first.text, /Subjects read: 2 of 2|已读取的项目：2\/2/, "the header must report how many subjects were read");
  assert.match(first.text, /Subjects that could not be read: 0|无法读取的项目：0/, "the header must report failed reads honestly");
  assert.ok(
    first.text.includes(`Subjects not read (this report reads at most ${CAP} subjects): 0`) || first.text.includes(`未读取的项目（本报告最多读取 ${CAP} 个项目）：0`),
    `the header must state the report cap and that nothing was skipped: ${first.text.split("\n").filter((line) => /not read|未读取/.test(line)).join(" | ")}`,
  );
  // The bar reports the download in its own message pattern.
  const done = page.locator(REPORT_STATE);
  await done.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await done.getAttribute("data-report-state"), "DONE", "a finished report must be reported as done");
  assert.match((await done.innerText()).trim(), /Selection report downloaded: 2 of 2 subjects read, 0 could not be read, 0 not read\.|选择报告已下载：已读取 2\/2 个项目，0 个无法读取，0 个未读取。/, "the bar message must count what was read");
  // Reads only: the protection axis plus the three per-subject reads, and no
  // write of any kind.
  const issued = daemon.requests.slice(requestsBefore).map((request) => request.operation);
  const issuedSet = [...new Set(issued)];
  for (const operation of issuedSet) {
    assert.ok(["content.list", "annotation.list", "description.list", "description.get", "representation.list", "search.query"].includes(operation), `the report may only read: ${operation}`);
  }
  assert.ok(issuedSet.includes("annotation.list") && issuedSet.includes("representation.list") && issuedSet.includes("search.query"), `the report must read the per-subject facts and the protection axis: ${JSON.stringify(issuedSet)}`);
  assert.ok(daemon.protectionAnswers.length > protectionBefore, "the protection outcome must come from the daemon's protection axis");

  // 3. A selection taken from search results: the search projection reports no
  // logical size, so the document must carry a real UNKNOWN for that fact
  // while keeping the exact identity the same answer did report. A fabricated
  // size fails here.
  const search = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
  await search.fill("txt");
  await search.press("Enter");
  await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "visible", timeout: 15000 });
  assert.ok(await until(page, () => daemon.searchHits.length > 0), "the search must have answered with its own hits");
  const searchHit = (daemon.searchHits.at(-1) ?? []).find((hit) => String(hit?.subject_ref ?? "") === alphaRef);
  assert.ok(searchHit, `the search must return the fixture subject: ${JSON.stringify((daemon.searchHits.at(-1) ?? []).map((hit) => hit.name))}`);
  assert.equal(searchHit.logical_size, undefined, `search.query must not report a logical size, or this assertion is meaningless: ${JSON.stringify(searchHit)}`);
  await selectPair(page);
  const searched = await downloadReport(page);
  assertDocumentShape(searched.text, "search report");
  assert.match(searched.text, /Selection source:.*search\.query|选择来源：.*search\.query/, "a search-sourced selection must name search.query as its source");
  const searchedAlpha = sectionOf(searched.text, "alpha.txt");
  assert.ok(labeled(searchedAlpha, LABEL.path, String(searchHit.path ?? "")), `the search-sourced section must keep the daemon's provenance path: ${factLine(searchedAlpha, LABEL.path)}`);
  assert.ok(labeled(searchedAlpha, LABEL.identity, String(searchHit.content_id)), "the search-sourced section must keep the exact identity the daemon reported");
  assert.ok(!searched.text.split("\n").some((line) => (LABEL.size.test(line) || LABEL.length.test(line)) && line.includes(String(alpha.logical_size))), `a size the daemon did not report must never be invented: ${factLine(searchedAlpha, LABEL.size)}`);
  assert.ok(labeled(searchedAlpha, LABEL.size, "UNKNOWN") && UNKNOWN_SIZE_REASON.test(searchedAlpha), `a size the search projection did not report must be UNKNOWN with the reason: ${factLine(searchedAlpha, LABEL.size)}`);
  assert.ok(labeled(searchedAlpha, LABEL.length, "UNKNOWN") && UNKNOWN_LENGTH_REASON.test(searchedAlpha), `a logical length the daemon did not report must be UNKNOWN with the reason: ${factLine(searchedAlpha, LABEL.length)}`);
  assert.match(searchedAlpha, NOTE, "the search-sourced report must still read the durable note");

  // 4. A degraded run: one subject's reads fail and the protection axis is
  // unavailable. The document must say so with the daemon's own reasons — the
  // unreadable subject is never dropped, and no failed fact is rendered as
  // success.
  const outage = "simulated selection report outage";
  const fail = (message) => ({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "FAILED", reasons: [{ message }] }) });
  const degradedAxis = { status: 200, contentType: "application/json", body: JSON.stringify({ status: "DEGRADED", reasons: [{ message: `${outage}: protection axis` }], data: { components: [{ dimension: "lexical-metadata-fts", query_provider_ref: "query.lexical.fts5.v1", score_semantics: "fts5-rank", status: "DEGRADED", hits: 0 }], hits: [] } }) };
  await page.route("**/api/v1/command", async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
    const operation = String(payload?.operation ?? "");
    const input = payload?.input ?? {};
    if (operation === "search.query" && input.filters?.protection_mode) { await route.fulfill(degradedAxis); return; }
    if (["annotation.list", "description.list", "representation.list"].includes(operation) && String(input.subject_ref ?? "") === betaRef) {
      await route.fulfill(fail(`${outage}: ${operation}`));
      return;
    }
    await route.continue();
  });
  let degraded;
  try {
    degraded = await downloadReport(page);
  } finally {
    await page.unroute("**/api/v1/command");
  }
  assertDocumentShape(degraded.text, "degraded report");
  const degradedAlpha = sectionOf(degraded.text, "alpha.txt");
  const degradedBeta = sectionOf(degraded.text, "beta.txt");
  assert.ok(degradedAlpha && degradedBeta, "an unreadable subject must still render its own section");
  assert.ok(labeled(degradedAlpha, LABEL.protection, "UNKNOWN") && degradedAlpha.includes(`${outage}: protection axis`), `a degraded protection axis must be UNKNOWN with the daemon's reason: ${factLine(degradedAlpha, LABEL.protection)}`);
  assert.ok(labeled(degradedBeta, LABEL.path, String(beta.path ?? "")), `the unreadable subject must keep its provenance path: ${factLine(degradedBeta, LABEL.path)}`);
  assert.match(degradedBeta, READ_FAILED, `the unreadable subject must say its reads failed: ${degradedBeta.slice(0, 600)}`);
  assert.ok(degradedBeta.includes(`${outage}: annotation.list`) && degradedBeta.includes(`${outage}: description.list`) && degradedBeta.includes(`${outage}: representation.list`), `every failed read must carry the daemon's reason: ${degradedBeta.slice(0, 800)}`);
  assert.match(degraded.text, /Subjects read: 1 of 2|已读取的项目：1\/2/, "the header must count only the subject that was read");
  assert.match(degraded.text, /Subjects that could not be read: 1|无法读取的项目：1/, "the header must count the unreadable subject");
  const degradedState = page.locator(REPORT_STATE);
  await degradedState.waitFor({ state: "visible", timeout: 10000 });
  assert.match((await degradedState.innerText()).trim(), /1 could not be read|1 个无法读取/, `the bar must report the failed read: ${await degradedState.innerText()}`);
  // The subject that could be read still carries its real facts.
  assert.match(degradedAlpha, NOTE, "a failed subject must not cost another subject its facts");

  // 4b. A claimed LINK_ONLY_UNPROTECTED outcome is the daemon's own outcome and
  // is rendered as such — never softened into a success. The axis is mocked so
  // the outcome is deterministic; everything the document repeats is the
  // mocked daemon's own fact.
  const axisHit = (hits) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "SUCCEEDED", data: { components: [{ dimension: "lexical-metadata-fts", query_provider_ref: "query.lexical.fts5.v1", score_semantics: "fts5-rank", status: "SUCCEEDED", index_generation_ref: "idx_e2e", hits: hits.length }], hits } }) });
  await page.route("**/api/v1/command", async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
    const operation = String(payload?.operation ?? "");
    if (operation === "search.query" && payload?.input?.filters?.protection_mode) {
      const outcome = String(payload.input.filters.protection_mode);
      await route.fulfill(outcome === "LINK_ONLY_UNPROTECTED" ? axisHit([{ subject_ref: betaRef, name: "beta.txt", path: String(beta.path ?? "") }]) : axisHit([]));
      return;
    }
    await route.continue();
  });
  let linked;
  try {
    linked = await downloadReport(page);
  } finally {
    await page.unroute("**/api/v1/command");
  }
  assertDocumentShape(linked.text, "link-only report");
  const linkedBeta = sectionOf(linked.text, "beta.txt");
  assert.ok(labeled(linkedBeta, LABEL.protection, "LINK_ONLY_UNPROTECTED"), `a claimed LINK_ONLY_UNPROTECTED outcome must be rendered verbatim: ${factLine(linkedBeta, LABEL.protection)}`);
  assert.match(linkedBeta, /no notes are recorded for this subject|此项目没有记录备注/, "a LINK_ONLY claim must not suppress the subject's readable facts");

  // 5. Every read failing is still a report: nothing is rendered as success,
  // and each fact carries the reason its read failed.
  await page.route("**/api/v1/command", (route) => route.abort());
  let blackout;
  try {
    blackout = await downloadReport(page);
  } finally {
    await page.unroute("**/api/v1/command");
  }
  assertDocumentShape(blackout.text, "blackout report");
  const blackoutAlpha = sectionOf(blackout.text, "alpha.txt");
  assert.ok(labeled(blackoutAlpha, LABEL.protection, "UNKNOWN"), `a failed protection read must be UNKNOWN, never a claim: ${factLine(blackoutAlpha, LABEL.protection)}`);
  assert.ok(labeled(blackoutAlpha, LABEL.representation, "UNKNOWN"), `a failed representation read must be UNKNOWN: ${factLine(blackoutAlpha, LABEL.representation)}`);
  assert.ok(labeled(blackoutAlpha, LABEL.tags, "UNKNOWN"), `a failed tag read must be UNKNOWN: ${factLine(blackoutAlpha, LABEL.tags)}`);
  assert.match(blackout.text, /Subjects that could not be read: 2|无法读取的项目：2/, "every failed subject must be counted");
  assert.match(blackoutAlpha, READ_FAILED, "a subject with no readable fact must say so");

  // 6. The report cap: the client reads at most 200 subjects' stored facts, the
  // subjects beyond it are never read at all, and the document says exactly
  // that instead of silently shrinking. The listing is injected so the fixture
  // does not have to hold 205 subjects; every document fact is still compared
  // with the listing that was read.
  const cappedCount = CAP + 5;
  const cappedItems = Array.from({ length: cappedCount }, (_, index) => {
    const ordinal = String(index + 1).padStart(3, "0");
    return { subject_ref: `subj_report_cap_${ordinal}`, entry_id: `entry_report_cap_${ordinal}`, name: `cap-${ordinal}.txt`, path: `cap-${ordinal}.txt`, entry_type: "REGULAR_FILE", content_id: `sha256:report-cap-${ordinal}`, logical_size: index + 1 };
  });
  const readRefs = [];
  await page.route("**/api/v1/command", async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
    const operation = String(payload?.operation ?? "");
    const input = payload?.input ?? {};
    if (operation === "content.list") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "SUCCEEDED", data: { workspace_id: "wsp_e2e", root_id: "", items: cappedItems } }) });
      return;
    }
    if (["annotation.list", "description.list", "representation.list"].includes(operation)) {
      readRefs.push(String(input.subject_ref ?? ""));
      const data = operation === "annotation.list" ? { annotations: [] } : operation === "description.list" ? { documents: [] } : { subject_ref: String(input.subject_ref ?? ""), representations: [] };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "SUCCEEDED", data }) });
      return;
    }
    await route.continue();
  });
  let capped;
  try {
    await page.getByRole("button", { name: /^(Library|内容库)/ }).click();
    await page.waitForFunction((count) => document.querySelectorAll(".result-list .result-row").length === count, cappedCount, { timeout: 20000 });
    // The bar exists only with a selection, so the range starts from one tile.
    await page.locator(".result-list .result-row").first().click({ modifiers: ["Meta"] });
    await page.locator(".selection-bar").waitFor({ state: "visible", timeout: 10000 });
    await page.locator(".selection-bar").getByRole("button", { name: /选择当前可见项|Select all visible/ }).click();
    assert.equal(Number(await page.locator(".result-list").getAttribute("data-selection-count")), cappedCount, "every rendered subject must be selected for the cap assertion");
    capped = await downloadReport(page, 120000);
  } finally {
    await page.unroute("**/api/v1/command");
  }
  assertDocumentShape(capped.text, "capped report");
  assert.match(capped.text, new RegExp(`Selected subjects: ${cappedCount}|所选项目数：${cappedCount}`), "the capped report must name the whole selection");
  assert.match(capped.text, new RegExp(`Subjects read: ${CAP} of ${cappedCount}|已读取的项目：${CAP}/${cappedCount}`), "the capped report must count exactly the subjects it read");
  assert.ok(
    capped.text.includes(`Subjects not read (this report reads at most ${CAP} subjects): 5`) || capped.text.includes(`未读取的项目（本报告最多读取 ${CAP} 个项目）：5`),
    `the capped report must count the subjects it did not read: ${capped.text.split("\n").filter((line) => /not read|未读取/.test(line)).join(" | ")}`,
  );
  const capReason = new RegExp(`UNKNOWN — .*(this report reads at most ${CAP} subjects|本报告最多读取 ${CAP} 个项目)`);
  // The rendered order depends on the sort preference this run left behind, so
  // the skipped set is the set the daemon was never asked about.
  const uniqueReadRefs = new Set(readRefs);
  assert.equal(uniqueReadRefs.size, CAP, `the client must read exactly ${CAP} subjects: ${uniqueReadRefs.size}`);
  const skippedItems = cappedItems.filter((item) => !uniqueReadRefs.has(String(item.subject_ref)));
  assert.equal(skippedItems.length, cappedItems.length - CAP, `the cap must leave exactly ${cappedItems.length - CAP} subjects unread: ${skippedItems.map((item) => item.name).join(", ")}`);
  for (const item of skippedItems) {
    const skipped = sectionOf(capped.text, String(item.name));
    assert.ok(skipped, `a skipped subject must keep its section: ${item.name}`);
    assert.ok(labeled(skipped, LABEL.path, String(item.path)), `${item.name}: a skipped subject must keep its provenance path: ${factLine(skipped, LABEL.path)}`);
    assert.ok(labeled(skipped, LABEL.notes, "UNKNOWN") && capReason.test(skipped), `${item.name}: a skipped read must be visible in the document: ${skipped.slice(0, 400)}`);
  }
  const readItem = cappedItems.find((item) => uniqueReadRefs.has(String(item.subject_ref)));
  assert.ok(readItem && !capReason.test(sectionOf(capped.text, String(readItem.name))), `a subject inside the cap must not be marked as skipped: ${readItem?.name}`);

  // Leave the page on the real library again.
  await page.getByRole("button", { name: /^(Library|内容库)/ }).click();
  await page.waitForFunction(() => document.querySelectorAll(".result-list .result-row").length === 3, null, { timeout: 20000 });
  await clearSelection(page);
}
