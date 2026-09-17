// Assertions for the search-operator surface (Tier-1 spec §3 item 1).
//
// Owner: lib/searchops.ts, app/useSearch.ts, components/TopBar.tsx,
// components/LibrarySurface.tsx, styles/searchops.css, i18n/searchops.ts and
// this module. `scripts/web-e2e.mjs` calls it once in the online phase, after
// the status surface.
//
// The assertions are written so a fabricated surface fails:
//
//   - every operator assertion reads the `search.query` request the browser
//     actually sent (captured from the network), so a chip that renders
//     without changing the wire payload, or a payload that carries a field the
//     daemon never receives, fails here;
//   - the expected filters are the ones the surface documents (`entry_type`,
//     `size_min`, ...), and one submit must produce exactly one query;
//   - a token the daemon cannot express must produce a visible error and no
//     query at all — never a silently different search;
//   - the tag autocomplete is compared against the daemon's own
//     `annotation.list` + `content.list` payloads, so a fabricated vocabulary
//     or a fabricated count cannot pass;
//   - a predicate the daemon cannot express must be labelled as evaluated over
//     the loaded results, both on its chip and in the result set.

import assert from "node:assert/strict";

const SEARCH_FIELD = /搜索内容库|Search content library/;
const RESULTS_HEADING = /搜索结果|Results for "/i;
const ERROR_TEXT = /is not a size|不是有效大小/;
const INEXPRESSIBLE_TEXT = /cannot be expressed|无法表达/;
const LOADED_RESULTS_TEXT = /loaded results|已加载结果/;
const WIDENED_TEXT = /widens every field-scoped predicate|放宽所有限定字段/;
const NO_SEARCH_TEXT = /No search was run for this text|没有执行任何搜索/;

/** Waits for a captured daemon answer, because response bodies arrive asynchronously. */
async function until(page, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await page.waitForTimeout(50);
  }
  return predicate();
}

export async function assertSearchOperators(ctx) {
  const { page } = ctx;
  const search = page.getByRole("textbox", { name: SEARCH_FIELD });
  const heading = page.getByRole("main").getByRole("heading", { name: RESULTS_HEADING });
  const opsRow = page.locator(".search-ops");
  const chips = page.locator(".search-ops .search-ops-chip");
  const errorLine = page.locator(".search-ops-error");
  const suggest = page.locator(".global-search .search-suggest");

  // Everything below is captured from the daemon's own traffic.
  const daemon = { queries: [], contentLists: [], annotations: [] };
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/command")) return;
    let payload;
    try { payload = request.postDataJSON(); } catch { return; }
    if (payload?.operation === "search.query") daemon.queries.push(payload.input ?? {});
  });
  page.on("response", async (response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/v1/command")) return;
    let request;
    try { request = response.request().postDataJSON(); } catch { return; }
    let body;
    try { body = await response.json(); } catch { return; }
    if (request?.operation === "content.list" && Array.isArray(body?.data?.items)) daemon.contentLists.push(body.data.items);
    if (request?.operation === "annotation.list" && Array.isArray(body?.data?.annotations)) daemon.annotations.push(body.data.annotations);
  });

  // 0. The loaded projections this surface reuses: the published listing and
  // the tag vocabulary. Both are read from the daemon's own answers, so the
  // assertions below cannot be satisfied by a fabricated list.
  const libraryEntry = page.getByRole("button", { name: /^(Library|内容库)/ }).first();
  for (let attempt = 0; attempt < 3 && daemon.contentLists.length === 0; attempt += 1) {
    if (await libraryEntry.count()) await libraryEntry.click();
    await page.waitForTimeout(300);
    await until(page, () => daemon.contentLists.length > 0, 4000);
  }
  await page.getByRole("main").getByRole("button", { name: /tiny\.png/ }).first().waitFor({ state: "visible", timeout: 15000 });
  assert.ok(await until(page, () => daemon.contentLists.length > 0), "the library listing must be readable before the operators are used");
  const listing = daemon.contentLists[daemon.contentLists.length - 1];
  const fixtureContentID = String(listing.find((item) => String(item.name ?? "") === "alpha.txt")?.content_id ?? "");
  assert.match(fixtureContentID, /^sha256:[0-9a-f]{64}$/, `the fixture's published content id must be recorded: ${fixtureContentID}`);
  const fixturePrefix = fixtureContentID.slice("sha256:".length, "sha256:".length + 12);
  const vocabulary = await page.locator(".tag-filter:not(.all)").evaluateAll((nodes) => nodes.map((node) => ({
    value: node.querySelector("span")?.textContent?.trim() ?? "",
    count: Number(node.querySelector("b")?.textContent?.trim() ?? "0"),
  })));
  assert.ok(vocabulary.length > 0, "the fixture must have a loaded tag vocabulary to offer");
  assert.ok(vocabulary.some((tag) => tag.value === "browser-e2e"), `the fixture tag must be in the loaded vocabulary: ${JSON.stringify(vocabulary)}`);

  const chipTokens = () => chips.locator(".search-ops-chip-edit-trigger").allInnerTexts();
  const chipWires = () => chips.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-wire") ?? ""));
  const submit = async (text) => {
    await search.fill(text);
    daemon.queries.length = 0;
    await search.press("Enter");
    await heading.waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(200);
  };

  // 1. Operators change the request the daemon receives, field by field. The
  // assertion is on the captured payload, not on a rendered count: a chip that
  // only looks like a filter fails here.
  await submit("tag:browser-e2e type:regular_file size:>1KB");
  assert.equal(daemon.queries.length, 1, `one submit must run search.query exactly once: ${JSON.stringify(daemon.queries)}`);
  const operatorPayload = daemon.queries[0];
  assert.ok(String(operatorPayload.workspace_id ?? "").length > 0, "the request must carry the workspace it searches");
  assert.equal(operatorPayload.query, "browser-e2e", `tag: must become the daemon's lexical tag text: ${JSON.stringify(operatorPayload)}`);
  assert.deepEqual(operatorPayload.filters, { entry_type: "REGULAR_FILE", size_min: 1024 }, `type: and size: must become typed filters, and 1KB must be 1024 bytes: ${JSON.stringify(operatorPayload.filters)}`);
  assert.deepEqual(operatorPayload.construct_axes, ["tags"], `tag: must scope the lexical field to the daemon's tags axis: ${JSON.stringify(operatorPayload.construct_axes)}`);

  // 2. The visible predicate row is a projection of the field text, and each
  // chip names the daemon input it really writes.
  assert.deepEqual((await chipTokens()).map((value) => value.trim()), ["tag:browser-e2e", "type:regular_file", "size:>1KB"], "the predicate row must show every parsed predicate");
  assert.deepEqual(await chipWires(), ["tags", "entry_type", "size_min/size_max"], "every chip must name the daemon input its predicate writes");

  // 3. Removing a chip rewrites the text and changes the payload.
  await chips.nth(2).locator(".search-ops-chip-remove").click();
  assert.equal(await search.inputValue(), "tag:browser-e2e type:regular_file", "removing a chip must rewrite the search text");
  daemon.queries.length = 0;
  await search.press("Enter");
  await heading.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(200);
  assert.equal(daemon.queries.length, 1, "removing a chip must still submit exactly one query");
  assert.deepEqual(daemon.queries[0].filters, { entry_type: "REGULAR_FILE" }, `the removed predicate must leave the payload: ${JSON.stringify(daemon.queries[0].filters)}`);
  assert.deepEqual(daemon.queries[0].construct_axes, ["tags"], "the surviving tag predicate must keep its field scope");

  // 4. Editing a chip in place rewrites the text and the payload.
  await chips.nth(1).locator(".search-ops-chip-edit-trigger").click();
  const editor = page.locator(".search-ops .search-ops-chip-edit");
  await editor.waitFor({ state: "visible", timeout: 10000 });
  await editor.fill("directory");
  await editor.press("Enter");
  assert.equal(await search.inputValue(), "tag:browser-e2e type:directory", "editing a chip must rewrite the search text");
  daemon.queries.length = 0;
  await search.press("Enter");
  await heading.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(200);
  assert.equal(daemon.queries.length, 1, "editing a chip must still submit exactly one query");
  assert.deepEqual(daemon.queries[0].filters, { entry_type: "DIRECTORY" }, `the edited predicate must reach the daemon: ${JSON.stringify(daemon.queries[0].filters)}`);

  // 5. Free text still searches, and it widens the field-scoped predicates:
  // the daemon matches every token against every indexed field in one query,
  // so the row says so instead of claiming a tag-only filter.
  await search.fill("alpha tag:browser-e2e");
  assert.equal((await page.locator(".search-ops .search-ops-free b").innerText()).trim(), "alpha", "the free-text remainder must stay visible");
  assert.deepEqual(await chipWires(), ["any field"], "free text must be shown as widening the tag predicate");
  assert.match((await page.locator(".search-ops-limits").innerText()).trim(), WIDENED_TEXT, "the row must state that free text widens the field scope");
  daemon.queries.length = 0;
  await search.press("Enter");
  await heading.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(200);
  assert.equal(daemon.queries.length, 1, "a mixed query must run search.query exactly once");
  assert.equal(daemon.queries[0].query, "alpha browser-e2e", `free text must stay lexical text: ${JSON.stringify(daemon.queries[0].query)}`);
  assert.equal("construct_axes" in daemon.queries[0], false, "an unscoped query must not send a narrowed construct_axes");
  assert.deepEqual(daemon.queries[0].filters, {}, "free text alone must not invent a typed filter");

  // Plain free text keeps the surface it had: no predicate row at all.
  await submit("durable browser note");
  assert.equal(await opsRow.count(), 0, "free text alone must not render a predicate row");
  assert.equal(daemon.queries[0].query, "durable browser note", "free text must still search");
  assert.equal("construct_axes" in daemon.queries[0], false, "free text must not narrow the lexical fields");
  assert.ok(ctx.state.lastSearchHitNames.length > 0, `free text must still return the daemon's hits: ${JSON.stringify(ctx.state.lastSearchHitNames)}`);

  // 6. A token the daemon cannot express is an error, and no query runs.
  await search.fill("size:banana");
  await errorLine.waitFor({ state: "visible", timeout: 10000 });
  const sizeError = (await errorLine.innerText()).trim();
  assert.match(sizeError, /size:banana/, `the error must name the failing token: ${sizeError}`);
  assert.match(sizeError, ERROR_TEXT, `the error must explain the expected value: ${sizeError}`);
  assert.match(sizeError, NO_SEARCH_TEXT, `the error must state that nothing was searched: ${sizeError}`);
  assert.equal(await search.getAttribute("aria-invalid"), "true", "the field must be marked invalid");
  daemon.queries.length = 0;
  await search.press("Enter");
  await page.waitForTimeout(400);
  assert.equal(daemon.queries.length, 0, `an invalid token must run no query at all: ${JSON.stringify(daemon.queries)}`);

  // The daemon's entry-type filter has no media class, so a media class is
  // reported instead of being sent as a value the daemon never records.
  await search.fill("type:image");
  await errorLine.waitFor({ state: "visible", timeout: 10000 });
  const typeError = (await errorLine.innerText()).trim();
  assert.match(typeError, /type:image/, `the error must name the inexpressible operator: ${typeError}`);
  assert.match(typeError, INEXPRESSIBLE_TEXT, `a media class must be reported as inexpressible: ${typeError}`);
  assert.match(typeError, /regular_file/, `the error must name the entry types the daemon really has: ${typeError}`);
  daemon.queries.length = 0;
  await search.press("Enter");
  await page.waitForTimeout(400);
  assert.equal(daemon.queries.length, 0, "an inexpressible operator must run no query");

  await search.fill("weird:thing");
  await errorLine.waitFor({ state: "visible", timeout: 10000 });
  assert.match((await errorLine.innerText()).trim(), /weird/, "an unknown operator must be reported, not searched for");
  daemon.queries.length = 0;
  await search.press("Enter");
  await page.waitForTimeout(300);
  assert.equal(daemon.queries.length, 0, "an unknown operator must run no query");
  // A quoted token is free text, which is the escape hatch for literal colons.
  await search.fill('"weird:thing"');
  assert.equal(await opsRow.count(), 0, "a quoted token must stay free text");
  daemon.queries.length = 0;
  await search.press("Enter");
  await heading.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(200);
  assert.equal(daemon.queries.length, 1, "the quoted literal must search exactly once");
  assert.equal(daemon.queries[0].query, '"weird:thing"', "the quoted literal must reach the daemon as text");

  // 7. Autocomplete: operator names with a description, and the loaded tag
  // vocabulary with the counts the daemon's own records produce.
  await search.fill("tag:");
  await suggest.waitFor({ state: "visible", timeout: 10000 });
  const tagEntries = await suggest.locator(".search-suggest-entry").evaluateAll((nodes) => nodes.map((node) => ({
    value: node.querySelector("b")?.textContent?.trim() ?? "",
    note: node.querySelector("span")?.textContent?.trim() ?? "",
    token: node.querySelector("code")?.textContent?.trim() ?? "",
  })));
  assert.ok(tagEntries.length > 0, "tag: must offer the loaded tag vocabulary");
  for (const entry of tagEntries) {
    const known = vocabulary.find((tag) => tag.value === entry.value);
    assert.ok(known, `every offered tag must be one the loaded tag vocabulary holds: ${entry.value} not in ${JSON.stringify(vocabulary.map((tag) => tag.value))}`);
    assert.equal(entry.token, `tag:${entry.value}`, "the offered tag must complete the operator");
    assert.match(entry.note, new RegExp(`\\b${known.count}\\b`), `the offered tag must carry the vocabulary's own count for ${entry.value}: ${entry.note}`);
  }
  // Every durable tag record the daemon answered for this workspace must be
  // offered, so a vocabulary that silently drops a tag fails here too.
  const tagBodies = new Set();
  for (const record of daemon.annotations.flat()) {
    if (record?.kind !== "TAG" || record?.tombstoned) continue;
    const body = String(record.body ?? "").trim();
    if (body) tagBodies.add(body);
  }
  for (const body of tagBodies) {
    if (!vocabulary.some((tag) => tag.value === body)) continue;
    assert.ok(tagEntries.some((entry) => entry.value === body), `the autocomplete must offer every loaded tag: ${body}`);
  }
  const fixtureTag = tagEntries.find((entry) => entry.value === "browser-e2e");
  assert.ok(fixtureTag, `the fixture tag must be offered: ${JSON.stringify(tagEntries.map((entry) => entry.value))}`);
  const fixtureVocabularyTag = vocabulary.find((tag) => tag.value === "browser-e2e");
  assert.match(fixtureTag.note, new RegExp(`\\b${fixtureVocabularyTag.count}\\b`), `the fixture tag must carry its own count: ${fixtureTag.note}`);

  // Operator names with a one-line description, and no value suggestions for
  // values this browser cannot know.
  await search.fill("siz");
  await suggest.waitFor({ state: "visible", timeout: 10000 });
  const operatorEntries = await suggest.locator(".search-suggest-entry").evaluateAll((nodes) => nodes.map((node) => ({
    value: node.querySelector("b")?.textContent?.trim() ?? "",
    note: node.querySelector("span")?.textContent?.trim() ?? "",
    token: node.querySelector("code")?.textContent?.trim() ?? "",
  })));
  assert.deepEqual(operatorEntries.map((entry) => entry.value), ["size:"], `a typed operator prefix must offer the operator: ${JSON.stringify(operatorEntries)}`);
  assert.match(operatorEntries[0].note, /Logical size|逻辑大小/, `the operator row must carry its one-line description: ${operatorEntries[0].note}`);
  assert.equal(operatorEntries[0].token, "size:>10MB", "the operator row must show its value shape");
  await suggest.locator(".search-suggest-entry").first().click();
  assert.equal(await search.inputValue(), "size:", "picking an operator must complete the token in the field");
  await search.fill("size:");
  await page.waitForTimeout(200);
  assert.equal(await suggest.count(), 0, "no value autocomplete may be offered for a value this browser cannot know");
  await search.fill("hash:");
  await page.waitForTimeout(200);
  assert.equal(await suggest.count(), 0, "hash: must not offer values the browser cannot know");

  // 8. Honest limits: a predicate the daemon cannot express is labelled on the
  // chip and in the result set, and it really narrows the hits the daemon
  // returned — the captured response is the daemon's own answer, so a surface
  // that only relabels its chips fails here.
  const renderedRows = () => page.locator(".result-list .result-row").count();
  const expectNarrowed = async (daemonNames, renderedCount, message) => {
    assert.deepEqual(ctx.state.lastSearchHitNames.slice().sort(), daemonNames.slice().sort(), `the daemon's own answer changed: ${message}`);
    assert.equal(await renderedRows(), renderedCount, `the client-side predicates must narrow the rendered results: ${message}`);
  };

  // dup:no is client-side: the daemon's duplicate projection has no inverse.
  await submit("tag:browser-e2e dup:no");
  assert.equal(daemon.queries.length, 1, "the expressible part must still run exactly one query");
  assert.equal(daemon.queries[0].query, "browser-e2e", "the tag predicate must still reach the daemon");
  assert.deepEqual(daemon.queries[0].construct_axes, ["tags"], "the tag predicate must keep its field scope");
  assert.deepEqual(daemon.queries[0].filters, {}, `a client-side predicate must not invent a filter: ${JSON.stringify(daemon.queries[0].filters)}`);
  assert.deepEqual(await chipWires(), ["tags", "loaded results"], "a client-side predicate must say so on its chip");
  const notice = page.locator(".search-ops-notice");
  await notice.waitFor({ state: "visible", timeout: 10000 });
  const noticeText = (await notice.innerText()).trim();
  assert.match(noticeText, LOADED_RESULTS_TEXT, `the result set must label the client-side predicates: ${noticeText}`);
  assert.match(noticeText, /dup:no/, `the label must name the predicates it covers: ${noticeText}`);
  assert.match(noticeText, /modification time|修改时间/, `the label must name what it cannot classify: ${noticeText}`);
  await expectNarrowed(["alpha.txt"], 0, "dup:no must exclude the tagged file the daemon answered with, because it is a duplicate");

  // A content-id prefix is client-side: the daemon's content_id filter is exact.
  await submit(`tag:browser-e2e hash:${fixturePrefix}`);
  assert.deepEqual(daemon.queries[0].filters, {}, "a content-id prefix must not be sent as an exact filter");
  assert.deepEqual(await chipWires(), ["tags", "loaded results"], "the hash prefix must say it is evaluated over the loaded results");
  await expectNarrowed(["alpha.txt"], 1, "the fixture's own content id prefix must keep the tagged file");
  await submit("tag:browser-e2e hash:ffffffffffff");
  await expectNarrowed(["alpha.txt"], 0, "a content-id prefix the fixture does not have must exclude every hit");

  // A complete content id is the daemon's own exact filter.
  await submit(`hash:${fixtureContentID}`);
  assert.equal(daemon.queries[0].query, "", "a filter-only query must send no lexical text");
  assert.deepEqual(daemon.queries[0].filters, { content_id: fixtureContentID }, `a complete content id must become the daemon's exact filter: ${JSON.stringify(daemon.queries[0].filters)}`);
  assert.equal(await renderedRows(), ctx.state.lastSearchHitNames.length, "an exact content id needs no client-side narrowing");
  assert.ok(ctx.state.lastSearchHitNames.length >= 2, `both identical fixture files share the content id: ${JSON.stringify(ctx.state.lastSearchHitNames)}`);
  await submit(`hash:${fixtureContentID} dup:yes`);
  assert.deepEqual(daemon.queries[0].filters, { duplicate_group: fixtureContentID }, `dup:yes with an exact id must use the daemon's duplicate-group filter: ${JSON.stringify(daemon.queries[0].filters)}`);
  assert.ok(ctx.state.lastSearchHitNames.length >= 2, "the daemon's duplicate-group filter must return the group's members");

  // dup:yes alone uses the daemon's own duplicate projection when the query is
  // scoped, so the payload carries the daemon's duplicates axis.
  await submit("dup:yes");
  assert.deepEqual(daemon.queries[0].construct_axes, ["duplicates"], `dup:yes must use the daemon's duplicate projection: ${JSON.stringify(daemon.queries[0])}`);
  assert.ok(ctx.state.lastSearchHitNames.length >= 2, `the fixture's identical files must be returned by the daemon's duplicate projection: ${JSON.stringify(ctx.state.lastSearchHitNames)}`);

  // Negation is evaluated over the loaded results, and it is labelled.
  await submit("tag:browser-e2e -name:alpha");
  assert.deepEqual(daemon.queries[0].construct_axes, ["tags"], "the surviving scoped predicate must keep its axis");
  assert.equal(daemon.queries[0].query, "browser-e2e", "a negated predicate must not be sent as a positive token");
  assert.deepEqual(await chipWires(), ["tags", "loaded results"], "a negated predicate must say it is evaluated over the loaded results");
  await expectNarrowed(["alpha.txt"], 0, "excluding the tagged file by name must leave nothing");

  // A query made only of client-side predicates has nothing to narrow, so it
  // is an error instead of an empty request the daemon rejects.
  await search.fill("dup:no hash:9f2c");
  await errorLine.waitFor({ state: "visible", timeout: 10000 });
  const emptyError = (await errorLine.innerText()).trim();
  assert.match(emptyError, /no lexical token and no typed filter|没有任何词元或类型化过滤器/, `the error must explain what the daemon needs: ${emptyError}`);
  daemon.queries.length = 0;
  await search.press("Enter");
  await page.waitForTimeout(400);
  assert.equal(daemon.queries.length, 0, "an unexpressible-only query must run no query at all");

  // 9. The desktop layout never overflows with a full predicate row.
  await page.setViewportSize({ width: 1512, height: 950 });
  await page.waitForTimeout(200);
  await search.fill("tag:browser-e2e type:regular_file size:>1KB mtime:<2024-01-01 path:docs name:alpha -dup:yes");
  await chips.first().waitFor({ state: "visible", timeout: 10000 });
  assert.deepEqual(await chipWires(), ["tags", "entry_type", "size_min/size_max", "mtime_after/mtime_before", "path", "name", "loaded results"], "every operator must render the input it writes");
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.documentElement.clientWidth,
  }));
  assert.equal(overflow.document, 0, `the predicate row must not overflow horizontally: ${JSON.stringify(overflow)}`);
  assert.equal(overflow.body, 0, `the predicate row must not overflow the body: ${JSON.stringify(overflow)}`);
  daemon.queries.length = 0;
  await search.press("Enter");
  await heading.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(200);
  assert.equal(daemon.queries.length, 1, "the full operator query must run exactly once");
  const fullPayload = daemon.queries[0];
  assert.equal(fullPayload.query, "browser-e2e docs alpha", `the field-scoped predicates must become the lexical text, in field order: ${JSON.stringify(fullPayload)}`);
  assert.deepEqual(fullPayload.filters, { entry_type: "REGULAR_FILE", size_min: 1024, mtime_before: Date.UTC(2024, 0, 1) }, `the full operator query must send exactly the documented filters: ${JSON.stringify(fullPayload.filters)}`);
  assert.deepEqual(fullPayload.construct_axes, ["tags", "path", "name"], `the full operator query must scope every scoped predicate: ${JSON.stringify(fullPayload.construct_axes)}`);
  assert.deepEqual(await chipWires(), ["tags", "entry_type", "size_min/size_max", "mtime_after/mtime_before", "path", "name", "loaded results"], "the full operator row must survive its own submit");

  // 9b. The phone boundary wraps the same row without overflowing, and the
  // desktop viewport is restored for the phases that follow.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const narrow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.documentElement.clientWidth,
    chips: document.querySelectorAll(".search-ops .search-ops-chip").length,
  }));
  assert.equal(narrow.document, 0, `the predicate row must not overflow the phone viewport: ${JSON.stringify(narrow)}`);
  assert.equal(narrow.body, 0, `the predicate row must not overflow the phone body: ${JSON.stringify(narrow)}`);
  assert.equal(narrow.chips, 7, `the phone row must keep every predicate: ${JSON.stringify(narrow)}`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(200);

  // 10. Recent searches keep working over operator text: the stored value is
  // the field text, and picking it re-runs the same payload.
  await search.fill("");
  await search.focus();
  const recents = page.locator(".search-recents");
  await recents.waitFor({ state: "visible", timeout: 10000 });
  const recentEntries = recents.locator(".search-recent-entry");
  await recentEntries.first().waitFor({ state: "visible", timeout: 10000 });
  const recentTexts = (await recentEntries.allInnerTexts()).map((value) => value.trim());
  assert.ok(recentTexts.includes("tag:browser-e2e type:regular_file size:>1KB mtime:<2024-01-01 path:docs name:alpha -dup:yes"),
    `the operator text must be recorded verbatim as a recent search: ${JSON.stringify(recentTexts)}`);
  const recentIndex = recentTexts.indexOf("dup:yes");
  assert.ok(recentIndex >= 0, `the plain operator query must stay in the recent list: ${JSON.stringify(recentTexts)}`);
  daemon.queries.length = 0;
  await recentEntries.nth(recentIndex).click();
  await heading.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(200);
  assert.equal(daemon.queries.length, 1, "recalling a recent operator search must run exactly one query");
  assert.deepEqual(daemon.queries[0].construct_axes, ["duplicates"], "the recalled operator search must send the same inputs");

  // Leave the page on the ordinary library view again.
  await search.fill("");
  const returnToLibrary = page.locator(".heading-actions button.library-return").filter({ hasText: /全部内容|All content/ }).first();
  if (await returnToLibrary.count()) await returnToLibrary.click();
  await page.getByRole("main").getByRole("button", { name: /tiny\.png/ }).first().waitFor({ state: "visible", timeout: 15000 });
  assert.ok(await until(page, () => daemon.contentLists.length > 0), "the library listing must be readable again");
}
