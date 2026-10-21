// Assertions for the one search surface: the submitted query and its heading,
// the honest result surface, and the browser-local recents list that never
// becomes a durable saved view.
//
// Owner: app/useSearch.ts, components/TopBar.tsx (the search field), and the
// library heading. The functions here keep the original assertion statements
// and order and may be extended, never weakened.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { escapeRegExp } from "./support.mjs";

function waitForGate(promise, label, timeoutMs = 20000) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs); }),
  ]).finally(() => clearTimeout(timeout));
}

// The executed query is stated in the heading; the unsubmitted text in the
// field is not. A healthy semantic provider does not need to emit a
// degradation notice, but when it does it must be visibly labelled.
export async function assertSearchResultSurface(ctx) {
  const { page, text } = ctx;
  const search = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
  await search.fill("durable browser note");
  await search.press("Enter");
  await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "visible", timeout: 15000 });
  const executedHeading = await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).innerText();
  await search.fill("draft-only-input");
  assert.equal(await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).innerText(), executedHeading, "search draft must not replace the executed-query heading");
  await search.fill("durable browser note");
  await page.locator(".result-match").filter({ hasText: "durable browser note" }).first().waitFor({ state: "visible", timeout: 10000 });
  const degradedSearch = text(/部分搜索覆盖已降级|search coverage.*degraded/i);
  if (await degradedSearch.count() > 0) {
    await degradedSearch.first().waitFor({ state: "visible", timeout: 10000 });
  }
}

// The export drawer is opened from a fresh execution of the same query; the
// heading proves the daemon returned a result set before the drawer reads it.
export async function assertSearchQueryReexecuted(ctx) {
  const { page } = ctx;
  const search = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
  await search.fill("durable browser note");
  await search.press("Enter");
  await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "visible", timeout: 15000 });
}

// A query can finish before the startup content.list projection. The list is
// allowed to add an identical authorized row's known length, but must not
// replace the query's ordered hits, field text or active result view.
export async function assertSearchSizesSurviveInitialListing(ctx, { evidenceDir } = {}) {
  const { page, url } = ctx;
  let releaseListing;
  let listingStartedResolve;
  let listingFinishedResolve;
  const listingGate = new Promise((resolve) => { releaseListing = resolve; });
  const listingStarted = new Promise((resolve) => { listingStartedResolve = resolve; });
  const listingFinished = new Promise((resolve) => { listingFinishedResolve = resolve; });
  let listing = undefined;
  let held = false;
  const commandRoute = async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch {}
    if (!held && payload?.operation === "content.list") {
      held = true;
      const response = await route.fetch();
      listing = await response.json();
      listingStartedResolve();
      try { await listingGate; await route.fulfill({ response }); }
      finally { listingFinishedResolve(); }
      return;
    }
    await route.continue();
  };
  await page.route("**/api/v1/command", commandRoute);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitForGate(listingStarted, "initial content.list start");
    const disclosure = page.locator(".topbar-search");
    if (!(await disclosure.evaluate((element) => element.open))) await disclosure.locator("summary.topbar-search-summary").click();
    const search = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
    await search.waitFor({ state: "visible", timeout: 20000 });
    await search.waitFor({ state: "attached" });
    await page.waitForFunction(() => {
      const field = document.querySelector('input[aria-label="搜索内容库"], input[aria-label="Search content library"]');
      return field instanceof HTMLInputElement && !field.disabled;
    }, { timeout: 20000 });
    await search.fill("Cairn");
    const responsePromise = page.waitForResponse((response) => {
      if (!response.url().endsWith("/api/v1/command") || response.request().method() !== "POST") return false;
      try { return response.request().postDataJSON()?.operation === "search.query"; } catch { return false; }
    }, { timeout: 20000 });
    await page.locator(".search-submit").click();
    const searchResponse = await responsePromise;
    const searchEnvelope = await searchResponse.json();
    const searchHits = searchEnvelope?.data?.hits ?? [];
    assert.ok(searchHits.length > 0, "the delayed-list journey must use real daemon search hits");
    await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "visible", timeout: 20000 });
    const rowNames = () => page.locator(".result-list .result-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label") ?? ""));
    const beforeNames = await rowNames();
    const before = await page.locator(".result-list .result-row").evaluateAll((rows) => rows.map((row) => ({ name: row.getAttribute("aria-label") ?? "", meta: row.querySelector(".result-meta")?.textContent?.trim() ?? "" })));
    assert.deepEqual(beforeNames, searchHits.map((hit) => hit.name), "before content.list arrives, visible rows follow the actual daemon search order");
    const knownLengthHit = searchHits.find((hit) => hit.name === "Cairn-Notes.txt");
    assert.ok(knownLengthHit, "the retained representative corpus includes Cairn-Notes.txt");
    assert.match(before.find((row) => row.name === knownLengthHit.name)?.meta ?? "", /无逻辑大小|No logical size/, "a search result with no loaded identity projection stays honestly unknown");

    releaseListing();
    await waitForGate(listingFinished, "initial content.list fulfillment");
    const loadedItems = listing?.data?.items ?? [];
    assert.ok(loadedItems.length > 0, "the released real content.list response contains loaded rows");
    const listingByTuple = new Map(loadedItems.map((item) => [`${item.subject_ref}\u0000${item.entry_id}\u0000${item.content_id}`, item]));
    const expectedKnown = searchHits.find((hit) => hit.name === knownLengthHit.name);
    const expectedItem = listingByTuple.get(`${expectedKnown.subject_ref}\u0000${expectedKnown.entry_id}\u0000${expectedKnown.content_id}`);
    assert.equal(expectedItem?.logical_size, 253, "the current listing confirms the matching file's exact 253-byte length");
    await page.locator(".result-list .result-row").filter({ has: page.locator(".result-open-copy", { hasText: "Cairn-Notes.txt" }) }).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForFunction(() => {
      const row = [...document.querySelectorAll(".result-list .result-row")].find((element) => element.getAttribute("aria-label") === "Cairn-Notes.txt");
      return row?.querySelector(".result-meta")?.textContent?.includes("253 B") ?? false;
    }, { timeout: 10000 });
    const afterNames = await rowNames();
    const after = await page.locator(".result-list .result-row").evaluateAll((rows) => rows.map((row) => ({ name: row.getAttribute("aria-label") ?? "", meta: row.querySelector(".result-meta")?.textContent?.trim() ?? "" })));
    assert.deepEqual(afterNames, searchHits.map((hit) => hit.name), "loaded-size enrichment preserves the exact daemon result order");
    assert.equal(await search.inputValue(), "Cairn", "the delayed listing must preserve the user's submitted query text");
    assert.match((await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).innerText()), /Cairn/, "the delayed listing must preserve the executed-query heading");
    assert.match(after.find((row) => row.name === knownLengthHit.name)?.meta ?? "", /253 B/, "the matching authorized identity receives its loaded exact length");

    if (evidenceDir) {
      const fs = await import("node:fs/promises");
      await fs.mkdir(evidenceDir, { recursive: true });
      await page.screenshot({ path: `${evidenceDir}/delayed-list-search-1280.png`, animations: "disabled" });
      await fs.writeFile(`${evidenceDir}/delayed-list-search.json`, JSON.stringify({
        query: "Cairn",
        searchHitOrder: searchHits.map((hit) => hit.name),
        before,
        after,
        listingItems: loadedItems.length,
        knownIdentity: { subject_ref: expectedKnown.subject_ref, entry_id: expectedKnown.entry_id, content_id: expectedKnown.content_id, logical_size: expectedItem.logical_size },
        unmatchedSearchHitCount: searchHits.filter((hit) => !listingByTuple.has(`${hit.subject_ref}\u0000${hit.entry_id}\u0000${hit.content_id}`)).length,
      }, null, 2));
    }
    const noteRow = page.locator('.result-list .result-row[aria-label="Cairn-Notes.txt"]');
    await noteRow.locator(".result-open-copy").click();
    await page.getByRole("heading", { name: "Cairn-Notes.txt", exact: true }).waitFor({ state: "visible", timeout: 10000 });
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
    await page.locator(".detail-download").click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "Cairn-Notes.txt");
    if (evidenceDir) {
      const fs = await import("node:fs/promises");
      await fs.mkdir(evidenceDir, { recursive: true });
      const path = `${evidenceDir}/Cairn-Notes.original`;
      await download.saveAs(path);
      const bytes = await fs.readFile(path);
      assert.equal(bytes.length, 253);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      assert.equal(sha256, "276a9d97a06002ca2f577535e921ce7b7bf02a360debb9f1e1d892859d27ff73");
      await fs.writeFile(`${evidenceDir}/original-takeout.json`, JSON.stringify({ filename: download.suggestedFilename(), logicalSize: bytes.length, sha256 }, null, 2));
    }
    await page.locator(".detail-back").click();
    await page.locator(".detail-column").waitFor({ state: "detached", timeout: 10000 });

    // Reverse the completion order: hold both real responses, let the loaded
    // projection finish while search.query is still pending, then release the
    // query. Its result must use the latest workspace projection.
    await page.unroute("**/api/v1/command", commandRoute);
    let releaseSecondList;
    let releaseSecondSearch;
    let secondListStartedResolve;
    let secondSearchStartedResolve;
    let secondListFinishedResolve;
    let secondSearchFinishedResolve;
    const secondListGate = new Promise((resolve) => { releaseSecondList = resolve; });
    const secondSearchGate = new Promise((resolve) => { releaseSecondSearch = resolve; });
    const secondListStarted = new Promise((resolve) => { secondListStartedResolve = resolve; });
    const secondSearchStarted = new Promise((resolve) => { secondSearchStartedResolve = resolve; });
    const secondListFinished = new Promise((resolve) => { secondListFinishedResolve = resolve; });
    const secondSearchFinished = new Promise((resolve) => { secondSearchFinishedResolve = resolve; });
    const secondSearchBodies = [];
    let secondSearchRequestCount = 0;
    const reverseEvents = [];
    let secondListHeld = false;
    let secondSearchHeld = false;
    const reverseRoute = async (route) => {
      let payload;
      try { payload = route.request().postDataJSON(); } catch {}
      if (payload?.operation === "content.list" && !secondListHeld) {
        secondListHeld = true;
        reverseEvents.push({ at: Date.now(), event: "request-start", operation: payload.operation });
        const response = await route.fetch();
        const body = await response.json();
        secondListStartedResolve(body);
        try { await secondListGate; reverseEvents.push({ at: Date.now(), event: "release", operation: payload.operation }); await route.fulfill({ response }); }
        finally { secondListFinishedResolve(); }
        return;
      }
      if (payload?.operation === "search.query") {
        secondSearchRequestCount += 1;
        reverseEvents.push({ at: Date.now(), event: "request-start", operation: payload.operation, request: secondSearchRequestCount, query: payload.input?.query ?? "" });
        const response = await route.fetch();
        const body = await response.json();
        secondSearchBodies.push(body);
        if (!secondSearchHeld) {
          secondSearchHeld = true;
          secondSearchStartedResolve(body);
          try { await secondSearchGate; reverseEvents.push({ at: Date.now(), event: "release", operation: payload.operation, request: secondSearchRequestCount }); await route.fulfill({ response }); }
          finally { secondSearchFinishedResolve(); }
          return;
        }
        await route.fulfill({ response });
        reverseEvents.push({ at: Date.now(), event: "fulfilled", operation: payload.operation, request: secondSearchRequestCount });
        return;
      }
      await route.continue();
    };
    await page.route("**/api/v1/command", reverseRoute);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const secondListing = await waitForGate(secondListStarted, "reverse content.list start");
      assert.ok((secondListing?.data?.items ?? []).length > 0, "the reverse-order check holds a real populated listing response");
      const nextDisclosure = page.locator(".topbar-search");
      if (!(await nextDisclosure.evaluate((element) => element.open))) await nextDisclosure.locator("summary.topbar-search-summary").click();
      const nextSearch = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
      await page.waitForFunction(() => {
        const field = document.querySelector('input[aria-label="搜索内容库"], input[aria-label="Search content library"]');
        return field instanceof HTMLInputElement && !field.disabled;
      }, { timeout: 20000 });
      await nextSearch.fill("Cairn");
      await page.waitForTimeout(300);
      assert.equal(secondSearchRequestCount, 0, "the clean root URL starts without a pending hash-restored query");
      const headingBeforeList = await page.getByRole("main").locator("h1, h2").first().innerText().catch(() => "");
      await page.locator(".search-submit").click();
      const pendingSearch = await waitForGate(secondSearchStarted, "reverse search.query start");
      assert.ok((pendingSearch?.data?.hits ?? []).length > 0, "the reverse-order check holds a real fused search response");
      releaseSecondList();
      reverseEvents.push({ at: Date.now(), event: "test-release", operation: "content.list" });
      await waitForGate(secondListFinished, "reverse content.list fulfillment");
      assert.equal(await nextSearch.inputValue(), "Cairn", "list completion cannot clear a newer in-flight search field");
      assert.equal(await page.getByRole("main").locator("h1, h2").first().innerText().catch(() => ""), headingBeforeList, "list completion cannot replace the current view while search is pending");
      const queryRequestsAtListCompletion = secondSearchRequestCount;
      releaseSecondSearch();
      reverseEvents.push({ at: Date.now(), event: "test-release", operation: "search.query" });
      await waitForGate(secondSearchFinished, "reverse search.query fulfillment");
      await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i }).waitFor({ state: "visible", timeout: 20000 });
      const reverseHitOrder = pendingSearch.data.hits.map((hit) => hit.name);
      const reverseNames = await rowNames();
      assert.deepEqual(reverseNames, reverseHitOrder, "a query released after list completion retains daemon relevance order");
      await page.waitForFunction(() => {
        const row = [...document.querySelectorAll(".result-list .result-row")].find((element) => element.getAttribute("aria-label") === "Cairn-Notes.txt");
        return row?.querySelector(".result-meta")?.textContent?.includes("253 B") ?? false;
      }, { timeout: 10000 });
      if (evidenceDir) {
        const fs = await import("node:fs/promises");
        await fs.writeFile(`${evidenceDir}/search-before-list-ordering.json`, JSON.stringify({
          completionOrder: "content.list before search.query",
          query: "Cairn",
          searchHitOrder: reverseHitOrder,
          visibleHitOrder: reverseNames,
          queryTextAfterList: await nextSearch.inputValue(),
          queryRequestsAtListCompletion,
          queryRequestsAfterResponse: secondSearchRequestCount,
          events: reverseEvents,
          loadedItemCount: secondListing.data.items.length,
          cairnNotesDisplayedSize: "253 B",
        }, null, 2));
      }
    } finally {
      releaseSecondList();
      releaseSecondSearch();
      if (secondListHeld) await waitForGate(secondListFinished, "reverse-list cleanup", 3000).catch(() => {});
      if (secondSearchHeld) await waitForGate(secondSearchFinished, "reverse-search cleanup", 3000).catch(() => {});
      await page.unroute("**/api/v1/command", reverseRoute);
    }
  } finally {
    releaseListing();
    if (held) await waitForGate(listingFinished, "initial-list cleanup", 3000).catch(() => {});
    await page.unroute("**/api/v1/command", commandRoute);
  }
}

// Pending hash restores and explicit scope navigation share the same private
// search intent. A newer user action wins; renderer changes remain within the
// current search scope and must not cancel that query.
export async function assertSearchIntentNavigationRaces(ctx, { evidenceDir } = {}) {
  const { page, url } = ctx;
  const openSearch = async () => {
    const disclosure = page.locator(".topbar-search");
    if (!(await disclosure.evaluate((element) => element.open))) await disclosure.locator("summary.topbar-search-summary").click();
    const field = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
    await page.waitForFunction(() => {
      const field = document.querySelector('input[aria-label="搜索内容库"], input[aria-label="Search content library"]');
      return field instanceof HTMLInputElement && !field.disabled;
    }, { timeout: 20000 });
    return field;
  };
  const events = [];

  // A pending URL search must not overwrite a newer explicitly submitted query.
  let releaseHashList;
  let releaseHashQuery;
  let hashListStartedResolve;
  let hashQueryStartedResolve;
  let hashListFinishedResolve;
  let hashQueryFinishedResolve;
  const hashListGate = new Promise((resolve) => { releaseHashList = resolve; });
  const hashQueryGate = new Promise((resolve) => { releaseHashQuery = resolve; });
  const hashListStarted = new Promise((resolve) => { hashListStartedResolve = resolve; });
  const hashQueryStarted = new Promise((resolve) => { hashQueryStartedResolve = resolve; });
  const hashListFinished = new Promise((resolve) => { hashListFinishedResolve = resolve; });
  const hashQueryFinished = new Promise((resolve) => { hashQueryFinishedResolve = resolve; });
  let hashListHeld = false;
  let hashQueryHeld = false;
  const hashRequests = [];
  const observedCommands = [];
  const observeCommand = (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/command")) return;
    try { observedCommands.push(request.postDataJSON()?.operation ?? "unknown"); } catch { observedCommands.push("invalid-json"); }
  };
  const hashRaceRoute = async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch {}
    if (payload?.operation === "content.list" && !hashListHeld) {
      hashListHeld = true;
      events.push({ at: Date.now(), event: "request-start", scenario: "hash", operation: payload.operation });
      const response = await route.fetch();
      hashListStartedResolve(await response.json());
      try { await hashListGate; events.push({ at: Date.now(), event: "release", scenario: "hash", operation: payload.operation }); await route.fulfill({ response }); }
      finally { hashListFinishedResolve(); }
      return;
    }
    if (payload?.operation === "search.query") {
      const query = String(payload.input?.query ?? "");
      hashRequests.push(query);
      events.push({ at: Date.now(), event: "request-start", scenario: "hash", operation: payload.operation, query });
      const response = await route.fetch();
      if (!hashQueryHeld) {
        hashQueryHeld = true;
        hashQueryStartedResolve(await response.json());
        try { await hashQueryGate; events.push({ at: Date.now(), event: "release", scenario: "hash", operation: payload.operation, query }); await route.fulfill({ response }); }
        finally { hashQueryFinishedResolve(); }
        return;
      }
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  };
  await page.route("**/api/v1/command", hashRaceRoute);
  page.on("request", observeCommand);
  try {
    // Force a fresh document when this helper follows another in-page case;
    // page.goto to the same URL with only a hash change can be hash-only nav.
    await page.goto("about:blank");
    await page.goto(`${url}#v=search&q=Older%20query`, { waitUntil: "domcontentloaded" });
    console.log("QA hash race: waiting for content.list start");
    try { await waitForGate(hashListStarted, "hash content.list start"); }
    catch (error) { throw new Error(`${String(error)}; observed command sequence=${observedCommands.join(",")}`); }
    console.log("QA hash race: content.list held");
    const field = await openSearch();
    await field.fill("Cairn");
    await page.locator(".search-submit").click();
    const currentQuery = await waitForGate(hashQueryStarted, "explicit hash-race search.query start");
    console.log("QA hash race: explicit search held");
    assert.ok(currentQuery?.data?.hits?.length > 0, "the explicit search has real daemon results");
    assert.deepEqual(hashRequests, ["Cairn"], "the old hash query has not replaced the newer explicit query");
    releaseHashList();
    events.push({ at: Date.now(), event: "test-release", scenario: "hash", operation: "content.list" });
    await waitForGate(hashListFinished, "hash content.list fulfillment");
    console.log("QA hash race: content.list released");
    await page.waitForTimeout(250);
    assert.deepEqual(hashRequests, ["Cairn"], "content.list completion does not submit the older hash query");
    releaseHashQuery();
    events.push({ at: Date.now(), event: "test-release", scenario: "hash", operation: "search.query" });
    await waitForGate(hashQueryFinished, "hash search.query fulfillment");
    console.log("QA hash race: explicit search released");
    await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for/ }).waitFor({ state: "visible", timeout: 20000 });
    assert.equal(await field.inputValue(), "Cairn");
  } finally {
    releaseHashList();
    releaseHashQuery();
    if (hashListHeld) await waitForGate(hashListFinished, "hash-list cleanup", 3000).catch(() => {});
    if (hashQueryHeld) await waitForGate(hashQueryFinished, "hash-query cleanup", 3000).catch(() => {});
    await page.unroute("**/api/v1/command", hashRaceRoute);
    page.off("request", observeCommand);
  }

  // Load a real search view, then hold a newer query while explicit scope
  // departures and a same-scope presentation switch are exercised.
  const navigateWithPendingQuery = async (scenario, action, expected) => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.getByRole("main").getByRole("heading", { name: /全部内容|All content/ }).waitFor({ state: "visible", timeout: 20000 });
    let active = false;
    let release;
    let startedResolve;
    let finishedResolve;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { startedResolve = resolve; });
    const finished = new Promise((resolve) => { finishedResolve = resolve; });
    const requests = [];
    const routeHandler = async (route) => {
      let payload;
      try { payload = route.request().postDataJSON(); } catch {}
      if (payload?.operation === "search.query") {
        const response = await route.fetch();
        const body = await response.json();
        const query = String(payload.input?.query ?? "");
        requests.push(query);
        events.push({ at: Date.now(), event: "request-start", scenario, operation: payload.operation, request: requests.length, query });
        if (active && requests.length === 2) {
          startedResolve({ body, query });
          try { await gate; events.push({ at: Date.now(), event: "release", scenario, query }); await route.fulfill({ response }); }
          finally { finishedResolve(); }
          return;
        }
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    };
    await page.route("**/api/v1/command", routeHandler);
    try {
      let field = await openSearch();
      await field.fill("Cairn");
      await page.locator(".search-submit").click();
      await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for/ }).waitFor({ state: "visible", timeout: 20000 });
      active = true;
      field = await openSearch();
      await field.fill("Cairn-Notes");
      await page.locator(".search-submit").click();
      console.log(`QA ${scenario}: waiting for held query`);
      const pending = await waitForGate(started, `${scenario} held search.query start`);
      assert.ok(pending.body?.data?.hits?.length > 0, `${scenario} holds a real query response`);
      const disclosure = page.locator(".topbar-search");
      if (await disclosure.evaluate((element) => element.open)) await disclosure.locator("summary.topbar-search-summary").click();
      events.push({ at: Date.now(), event: "user-action", scenario });
      await action(page);
      await expected(page, { released: false });
      await openSearch();
      const busyIndicator = page.locator(".search-submit .spin");
      await busyIndicator.waitFor({ state: "visible", timeout: 10000 });
      events.push({ at: Date.now(), event: "pending-search-visible", scenario });
      release();
      events.push({ at: Date.now(), event: "test-release", scenario, query: pending.query });
      await waitForGate(finished, `${scenario} search.query fulfillment`);
      await busyIndicator.waitFor({ state: "detached", timeout: 10000 });
      events.push({ at: Date.now(), event: "pending-search-settled", scenario });
      await expected(page, { released: true });
      assert.deepEqual(requests, ["Cairn", "Cairn-Notes"], `${scenario} sends exactly the baseline and explicitly submitted queries`);
      return requests;
    } finally {
      release();
      if (requests.length >= 2) await waitForGate(finished, `${scenario} cleanup`, 3000).catch(() => {});
      await page.unroute("**/api/v1/command", routeHandler);
    }
  };

  const navigationResults = {};
  navigationResults.clearSearch = await navigateWithPendingQuery("clear-search", async (target) => {
    const clear = target.locator(".library-workflow-bar .library-return").filter({ hasText: /清除搜索|Clear search/ }).first();
    await clear.waitFor({ state: "visible", timeout: 10000 });
    await clear.click();
  }, async (target) => target.getByRole("main").getByRole("heading", { name: /全部内容|All content/ }).waitFor({ state: "visible", timeout: 10000 }));
  navigationResults.sources = await navigateWithPendingQuery("sources", async (target) => {
    await target.locator(".workspace-nav-item").filter({ hasText: /来源|Sources/ }).first().click();
  }, async (target) => target.getByRole("main").getByRole("heading", { name: /来源|Sources/ }).waitFor({ state: "visible", timeout: 10000 }));
  navigationResults.activity = await navigateWithPendingQuery("activity", async (target) => {
    await target.locator(".workspace-nav-item").filter({ hasText: /活动|Activity/ }).first().click();
  }, async (target) => target.getByRole("main").getByRole("heading", { name: /活动|Activity/ }).waitFor({ state: "visible", timeout: 10000 }));
  navigationResults.allContent = await navigateWithPendingQuery("all-content", async (target) => {
    await target.locator(".workspace-nav-item").filter({ hasText: /全部内容|All content/ }).first().click();
  }, async (target) => target.getByRole("main").getByRole("heading", { name: /全部内容|All content/ }).waitFor({ state: "visible", timeout: 10000 }));
  navigationResults.presentation = await navigateWithPendingQuery("presentation", async (target) => {
    await target.locator('.library-presentation-navigation--domains button[data-domain="cairn:photos"]').click();
  }, async (target, { released }) => {
    await target.locator('.content-column[data-view="search"][data-presentation="photos"]').waitFor({ state: "visible", timeout: 10000 });
    const field = await openSearch();
    assert.equal(await field.inputValue(), "Cairn-Notes", "a same-scope Photos presentation keeps the current explicit query");
    if (released) await target.locator(".library-result-scope strong").filter({ hasText: "Cairn-Notes" }).waitFor({ state: "visible", timeout: 10000 });
  });

  if (evidenceDir) {
    const fs = await import("node:fs/promises");
    await fs.mkdir(evidenceDir, { recursive: true });
    await fs.writeFile(`${evidenceDir}/search-intent-navigation.json`, JSON.stringify({
      hashRequests,
      hashRestoreSuppressed: hashRequests.length === 1 && hashRequests[0] === "Cairn",
      navigationResults,
      events,
    }, null, 2));
  }
}

// SavedView recall is another producer of the host-owned search result scope.
// This read-only browser check proves that its real evaluation cannot replace
// a newer explicit destination or query while the response is in flight.
export async function assertSavedViewRecallIntentRaces(ctx, { viewName, expectedCount = 3, evidenceDir } = {}) {
  const { page, url } = ctx;
  const events = [];
  const identities = (hits) => hits.map(({ subject_ref, entry_id, content_id }) => ({ subject_ref, entry_id, content_id }));
  const snapshots = {};
  const activeHolds = new Set();
  let nextHold;
  const routeHandler = async (route) => {
    let payload;
    try { payload = route.request().postDataJSON(); } catch { payload = undefined; }
    if (!nextHold || payload?.operation !== nextHold.operation) return route.continue();
    const hold = nextHold;
    nextHold = undefined;
    const response = await route.fetch();
    const body = await response.body();
    hold.status = response.status();
    hold.envelope = JSON.parse(body.toString("utf8"));
    hold.request = payload;
    hold.browserRequest = route.request();
    hold.startedResolve();
    try {
      await hold.gate;
      await route.fulfill({ response, body });
    } finally { activeHolds.delete(hold); hold.finishedResolve(); }
  };
  const armHold = (operation) => {
    let release;
    let startedResolve;
    let finishedResolve;
    const hold = {
      operation,
      gate: new Promise((resolve) => { release = resolve; }),
      started: new Promise((resolve) => { startedResolve = resolve; }),
      finished: new Promise((resolve) => { finishedResolve = resolve; }),
      startedResolve,
      finishedResolve,
      release: () => release(),
    };
    activeHolds.add(hold);
    nextHold = hold;
    return hold;
  };
  const requestFinished = (request, label) => page.waitForEvent("requestfinished", {
    predicate: (finished) => finished === request,
    timeout: 30000,
  }).catch((error) => { throw new Error(`${label} did not finish: ${error.message}`); });
  const twoAnimationFrames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const recallButton = (row) => row.getByRole("button", { name: /在内容库中打开|Open in library/ });
  const openRetrieval = async () => {
    const disclosure = page.locator(".topbar-search");
    if (await disclosure.count() && await disclosure.evaluate((element) => element.open)) await disclosure.locator("summary.topbar-search-summary").click();
    const panel = page.locator("#saved-retrieval-panel");
    if (!(await panel.isVisible().catch(() => false))) await page.getByRole("button", { name: /已保存的检索|Saved retrieval/ }).click();
    await panel.locator(".saved-retrieval-rows li").filter({ hasText: viewName }).waitFor({ state: "visible", timeout: 15000 });
    return panel.locator(".saved-retrieval-rows li").filter({ hasText: viewName }).first();
  };
  const openSearch = async () => {
    const disclosure = page.locator(".topbar-search");
    if (await disclosure.count() && !(await disclosure.evaluate((element) => element.open))) await disclosure.locator("summary.topbar-search-summary").click();
    const field = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
    await field.waitFor({ state: "visible", timeout: 10000 });
    return field;
  };
  await page.route("**/api/v1/command", routeHandler);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator(".result-list .result-row").first().waitFor({ state: "visible", timeout: 30000 });

    // A normal, visible query creates the recent-search affordance used below;
    // there is no browser-storage injection or direct operation dispatch.
    const search = await openSearch();
    await search.fill("Cairn");
    await search.press("Enter");
    await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for/ }).waitFor({ state: "visible", timeout: 30000 });

    const firstRow = await openRetrieval();
    const firstEvaluation = armHold("view.evaluate");
    // Observe this ordinary recall without delaying it to retain its result
    // identities and ordering as the baseline for both stale-response cases.
    firstEvaluation.release();
    await recallButton(firstRow).click();
    await waitForGate(firstEvaluation.started, "baseline real SavedView evaluation");
    await waitForGate(firstEvaluation.finished, "baseline SavedView response");
    assert.equal(firstEvaluation.status, 200, "baseline recall uses the real owner response");
    const baselineHits = firstEvaluation.envelope?.data?.hits ?? [];
    assert.equal(baselineHits.length, expectedCount, `the retained view returns the expected ${expectedCount} real hits`);
    const baselineIdentities = identities(baselineHits);
    snapshots.baselineIdentities = baselineIdentities;
    await page.locator(".recall-caption").waitFor({ state: "visible", timeout: 15000 });
    const baselineLabels = await page.locator(".result-list .result-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")));
    assert.deepEqual(baselineLabels, baselineHits.map((hit) => hit.name || hit.path), "ordinary recall renders the real evaluation order");

    const sourceHold = armHold("view.evaluate");
    await recallButton(firstRow).click();
    await waitForGate(sourceHold.started, "held real SavedView evaluation before Sources navigation");
    assert.equal(sourceHold.status, 200, "held recall fetched a real successful response before navigation");
    assert.deepEqual(identities(sourceHold.envelope?.data?.hits ?? []), baselineIdentities, "held recall retains the same ordered real subject/entry/content identities");
    await page.locator(".workspace-nav-item").filter({ hasText: /^(来源|Sources)/ }).first().click();
    await page.getByRole("main").getByRole("heading", { name: /^(来源|Sources)$/ }).waitFor({ state: "visible", timeout: 10000 });
    snapshots.sourcesBeforeRelease = await page.evaluate(() => ({
      heading: document.querySelector("main h1, main h2")?.textContent?.trim() ?? "",
      sourceSurface: Boolean(document.querySelector(".sources-surface")),
      resultRows: document.querySelectorAll(".result-list .result-row").length,
    }));
    const sourceRequestFinished = requestFinished(sourceHold.browserRequest, "SavedView response after Sources navigation");
    sourceHold.release();
    await waitForGate(sourceHold.finished, "held SavedView response after Sources navigation");
    await sourceRequestFinished;
    await page.locator(".search-submit .spin").waitFor({ state: "detached", timeout: 30000 });
    snapshots.sourcesAfterRelease = await page.evaluate(() => ({
      heading: document.querySelector("main h1, main h2")?.textContent?.trim() ?? "",
      sourceSurface: Boolean(document.querySelector(".sources-surface")),
      recallCaptionCount: document.querySelectorAll(".recall-caption").length,
      resultRows: document.querySelectorAll(".result-list .result-row").length,
    }));
    assert.match(snapshots.sourcesAfterRelease.heading, /^(Sources|来源)$/);
    assert.equal(snapshots.sourcesAfterRelease.sourceSurface, true, "Sources stays the destination after the old recall settles");
    assert.equal(snapshots.sourcesAfterRelease.recallCaptionCount, 0, "stale recall does not publish a live-view caption on Sources");

    // Start a new ordinary query while a SavedView evaluation is held. The
    // newer query response is held too, so this checks both stale-result
    // suppression and ownership of the shared busy indicator.
    const nextSearch = await openSearch();
    await nextSearch.fill("Cairn");
    await nextSearch.press("Enter");
    await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for/ }).waitFor({ state: "visible", timeout: 30000 });
    const libraryNav = page.locator(".workspace-nav-item").filter({ hasText: /^(内容库|Library)/ }).first();
    if (await libraryNav.count()) await libraryNav.click();
    const secondRow = await openRetrieval();
    const recallHold = armHold("view.evaluate");
    await recallButton(secondRow).click();
    await waitForGate(recallHold.started, "held real SavedView evaluation before newer query");
    assert.equal(recallHold.status, 200);
    assert.deepEqual(identities(recallHold.envelope?.data?.hits ?? []), baselineIdentities, "second held recall also has the same real ordered identities");
    const input = await openSearch();
    await page.locator(".search-clear").click();
    const recentsToggle = page.getByRole("button", { name: /最近搜索|Recent searches/ });
    if (await recentsToggle.count() && await recentsToggle.getAttribute("aria-expanded") !== "true") await recentsToggle.click();
    await page.locator(".search-recent-entry").filter({ hasText: /^Cairn$/ }).waitFor({ state: "visible", timeout: 10000 });
    const queryHold = armHold("search.query");
    await page.locator(".search-recent-entry").filter({ hasText: /^Cairn$/ }).click();
    await waitForGate(queryHold.started, "new real search.query while SavedView response is held");
    assert.equal(queryHold.status, 200, "newer query also fetched its real owner response before either is released");
    assert.equal(queryHold.request?.input?.query, "Cairn", "the newer request is the explicitly recalled recent query");
    assert.ok((queryHold.envelope?.data?.hits ?? []).length > 0, "the newer query has real daemon matches");
    const staleRecallRequestFinished = requestFinished(recallHold.browserRequest, "stale SavedView response under newer query");
    recallHold.release();
    await waitForGate(recallHold.finished, "stale SavedView response while newer query remains pending");
    await staleRecallRequestFinished;
    await twoAnimationFrames();
    await page.locator(".search-submit .spin").waitFor({ state: "visible", timeout: 10000 });
    snapshots.newerQueryBeforeRelease = await page.evaluate(() => ({
      input: document.querySelector('input[aria-label="Search content library"]')?.value ?? "",
      heading: document.querySelector("main h1, main h2")?.textContent?.trim() ?? "",
      busy: Boolean(document.querySelector(".search-submit .spin")),
      recallCaptionCount: document.querySelectorAll(".recall-caption").length,
    }));
    assert.equal(snapshots.newerQueryBeforeRelease.input, "Cairn", "old recall cannot replace the newer query text");
    assert.equal(snapshots.newerQueryBeforeRelease.busy, true, "old recall cannot clear the newer query's busy state");
    assert.equal(snapshots.newerQueryBeforeRelease.recallCaptionCount, 0, "old recall cannot publish its caption over the newer query");
    const newerQueryRequestFinished = requestFinished(queryHold.browserRequest, "newer query response");
    queryHold.release();
    await waitForGate(queryHold.finished, "newer real search response");
    await newerQueryRequestFinished;
    await twoAnimationFrames();
    await page.locator(".search-submit .spin").waitFor({ state: "detached", timeout: 30000 });
    snapshots.newerQueryAfterRelease = await page.evaluate(() => ({
      input: document.querySelector('input[aria-label="Search content library"]')?.value ?? "",
      heading: document.querySelector("main h1, main h2")?.textContent?.trim() ?? "",
      recallCaptionCount: document.querySelectorAll(".recall-caption").length,
      rows: Array.from(document.querySelectorAll(".result-list .result-row")).map((row) => row.getAttribute("aria-label")),
    }));
    assert.equal(snapshots.newerQueryAfterRelease.input, "Cairn");
    assert.match(snapshots.newerQueryAfterRelease.heading, /Cairn/);
    assert.equal(snapshots.newerQueryAfterRelease.recallCaptionCount, 0);
    const newerHitNames = (queryHold.envelope?.data?.hits ?? []).map((hit) => hit.name || hit.path);
    assert.deepEqual(snapshots.newerQueryAfterRelease.rows, newerHitNames, "the visible ordered rows equal the real newer query response");
    events.push({
      savedViewID: recallHold.request?.input?.view_id,
      baselineCount: baselineHits.length,
      sourceNavigation: snapshots.sourcesAfterRelease,
      newerQuery: snapshots.newerQueryAfterRelease,
      requestRecords: {
        baseline: { request_id: firstEvaluation.envelope?.request_id, status: firstEvaluation.status, orderedIdentities: baselineIdentities },
        sourceRecall: { request_id: sourceHold.envelope?.request_id, status: sourceHold.status, orderedIdentities: identities(sourceHold.envelope?.data?.hits ?? []) },
        staleRecall: { request_id: recallHold.envelope?.request_id, status: recallHold.status, orderedIdentities: identities(recallHold.envelope?.data?.hits ?? []) },
        newerQuery: { request_id: queryHold.envelope?.request_id, status: queryHold.status, query: queryHold.request?.input?.query, orderedIdentities: identities(queryHold.envelope?.data?.hits ?? []), orderedNames: newerHitNames },
      },
    });
  } finally {
    for (const hold of activeHolds) hold.release();
    await page.unroute("**/api/v1/command", routeHandler);
  }
  if (evidenceDir) {
    const fs = await import("node:fs/promises");
    await fs.mkdir(evidenceDir, { recursive: true });
    await fs.writeFile(`${evidenceDir}/saved-recall-intent.json`, JSON.stringify({ events, snapshots }, null, 2));
  }
}

// Real SavedView -> Music recall must retain bounded, identity-matched sizes
// so an explicit original-play action can verify and decode the downloaded
// bytes. This helper uses only ordinary UI actions and the live command/API.
export async function assertSavedViewMusicPlayback(ctx, {
  viewName,
  expectedNames,
  selectedName,
  evidenceDir,
} = {}) {
  const { page, url } = ctx;
  const fs = await import("node:fs/promises");
  assert.ok(viewName && selectedName && evidenceDir, "viewName, selectedName and evidenceDir are required");
  if (evidenceDir) await fs.mkdir(evidenceDir, { recursive: true });

  const commandResponse = (operation) => page.waitForResponse((response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/v1/command")) return false;
    try { return response.request().postDataJSON()?.operation === operation; } catch { return false; }
  }, { timeout: 20000 });
  const contentListPromise = commandResponse("content.list");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const contentListResponse = await contentListPromise;
  assert.equal(contentListResponse.status(), 200, "the live content.list projection must succeed");
  const contentListEnvelope = await contentListResponse.json();
  const contentItems = contentListEnvelope?.data?.items ?? [];
  const retrievalButton = page.getByRole("button", { name: /已保存的检索|Saved retrieval/ });
  await retrievalButton.click();
  const viewRow = page.locator(".saved-retrieval-rows li").filter({ hasText: viewName }).first();
  await viewRow.waitFor({ state: "visible", timeout: 15000 });
  const evaluationPromise = commandResponse("view.evaluate");
  await viewRow.getByRole("button", { name: /在内容库中打开|Open in library/ }).click();
  const evaluationResponse = await evaluationPromise;
  assert.equal(evaluationResponse.status(), 200, "the saved view evaluation must succeed");
  const evaluationEnvelope = await evaluationResponse.json();
  const evaluatedHits = evaluationEnvelope?.data?.hits ?? [];
  const evaluatedNames = evaluatedHits.map((hit) => hit.name);
  if (expectedNames) assert.deepEqual(evaluatedNames, expectedNames, "recall must preserve the actual saved-view hit order");
  assert.ok(evaluatedHits.length > 0, "the saved view must return actual hits");
  await page.waitForFunction(() => document.querySelector(".saved-retrieval-outcome.ready"), { timeout: 15000 });

  await page.getByRole("button", { name: /音乐|Music/ }).click();
  const rows = page.locator(".music-track");
  await rows.first().waitFor({ state: "visible", timeout: 15000 });
  const visibleRows = await rows.evaluateAll((elements) => elements.map((element) => ({
    name: element.getAttribute("aria-label") ?? "",
    text: element.innerText,
    disabled: Boolean(element.querySelector(".music-track-play")?.disabled),
  })));
  assert.deepEqual(visibleRows.map((row) => row.name), evaluatedNames, "Music must show the evaluated names in the same order");
  const exactItems = evaluatedHits.map((hit) => {
    const match = contentItems.find((item) => item.subject_ref === hit.subject_ref
      && item.entry_id === hit.entry_id && item.content_id === hit.content_id);
    assert.ok(match, `content.list must contain exact identity for ${hit.name}`);
    assert.ok(Number.isFinite(Number(match.logical_size)), `content.list must report a known size for ${hit.name}`);
    const row = visibleRows.find((candidate) => candidate.name === hit.name);
    assert.ok(row && !/无逻辑大小|No logical size/i.test(row.text), `${hit.name} must show its size in Music`);
    assert.equal(row.disabled, false, `${hit.name} Play must be enabled after the exact tuple size join`);
    return { hit, item: match };
  });
  const selected = exactItems.find(({ hit }) => hit.name === selectedName);
  assert.ok(selected, `selected track ${selectedName} must be in the recalled view`);

  let downloadResponse;
  const downloadPromise = page.waitForResponse((response) => response.url().includes("/api/v1/download")
    && response.request().method() === "GET", { timeout: 20000 });
  try {
    await page.locator(".music-track").filter({ has: page.locator(".music-track-main", { hasText: selectedName }) })
      .locator(".music-track-play").click();
    downloadResponse = await downloadPromise;
    assert.equal(downloadResponse.status(), 200, "ordinary Play must download the original successfully");
    const originalBytes = await downloadResponse.body();
    const audio = page.locator("audio").first();
    await page.waitForFunction(() => {
      const element = document.querySelector("audio");
      return element instanceof HTMLAudioElement && element.currentSrc.startsWith("blob:")
        && element.readyState >= 2 && Number.isFinite(element.duration) && element.duration > 0;
    }, { timeout: 15000 });
    const player = await audio.evaluate(async (element) => {
      const response = await fetch(element.currentSrc);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return {
        currentSrc: element.currentSrc,
        readyState: element.readyState,
        duration: element.duration,
        paused: element.paused,
        networkState: element.networkState,
        byteLength: bytes.byteLength,
        bytesBase64: btoa(binary),
      };
    });
    const blobBytes = Buffer.from(player.bytesBase64, "base64");
    const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
    const originalSha256 = digest(originalBytes);
    const blobSha256 = digest(blobBytes);
    const expectedSha256 = selected.hit.content_id.replace(/^sha256:/, "");
    assert.equal(originalBytes.length, Number(selected.item.logical_size), "original response bytes must equal exact content.list length");
    assert.equal(blobBytes.length, Number(selected.item.logical_size), "verified-player Blob bytes must equal exact content.list length");
    assert.equal(originalSha256, expectedSha256, "original response SHA-256 must match evaluated content_id");
    assert.equal(blobSha256, expectedSha256, "verified-player Blob SHA-256 must match evaluated content_id");
    assert.equal(player.byteLength, blobBytes.length, "native player's Blob length must match captured bytes");
    assert.ok(player.currentSrc.startsWith("blob:") && player.readyState >= 2 && player.duration > 0,
      "native audio element must have decoded playable media");

    await fs.writeFile(`${evidenceDir}/original-response.bin`, originalBytes);
    await fs.writeFile(`${evidenceDir}/verified-player-blob.bin`, blobBytes);
    await fs.writeFile(`${evidenceDir}/content-list.json`, JSON.stringify(contentListEnvelope, null, 2));
    await fs.writeFile(`${evidenceDir}/view-evaluation.json`, JSON.stringify(evaluationEnvelope, null, 2));
    await fs.writeFile(`${evidenceDir}/playback.json`, JSON.stringify({
      view: { name: viewName, evaluatedNames },
      visibleRows,
      selected: { hit: selected.hit, matchingContentListRow: selected.item },
      originalResponse: { status: downloadResponse.status(), byteLength: originalBytes.length, sha256: originalSha256 },
      playerBlob: { byteLength: blobBytes.length, sha256: blobSha256 },
      nativeAudio: { ...player, bytesBase64: undefined },
    }, null, 2));
    return { evaluatedNames, visibleRows, originalBytes: originalBytes.length, originalSha256, blobBytes: blobBytes.length, blobSha256, nativeAudio: { ...player, bytesBase64: undefined } };
  } finally {
    const stop = page.locator(".audio-player-stop");
    if (await stop.count() && await stop.isEnabled().catch(() => false)) await stop.click().catch(() => {});
  }
}

// A single real search hit can carry a compact, namespaced image metadata
// artifact. The card summary and Details are projections of that returned
// segment only; opening evidence must not issue another query or change order.
export async function assertImageMetadataSearchEvidence(ctx, { evidenceDir } = {}) {
  const { page, url } = ctx;
  const fs = await import("node:fs/promises");
  const queryRequests = [];
  const listingResponsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/v1/command")) return false;
    try { return response.request().postDataJSON()?.operation === "content.list"; } catch { return false; }
  }, { timeout: 20000 });
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/command")) return;
    try {
      const payload = request.postDataJSON();
      if (payload?.operation === "search.query") queryRequests.push(String(payload.input?.query ?? ""));
    } catch {}
  });
  await page.goto("about:blank");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const listingResponse = await listingResponsePromise;
  const loadedItems = (await listingResponse.json())?.data?.items ?? [];
  assert.ok(loadedItems.length > 0, "the ordinary startup content.list returned the existing library before the search");
  await page.getByRole("main").getByRole("heading", { name: /全部内容|All content/ }).waitFor({ state: "visible", timeout: 20000 });
  const disclosure = page.locator(".topbar-search");
  if (!(await disclosure.evaluate((element) => element.open))) await disclosure.locator("summary.topbar-search-summary").click();
  const field = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
  await field.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="搜索内容库"], input[aria-label="Search content library"]');
    return input instanceof HTMLInputElement && !input.disabled;
  }, { timeout: 10000 });
  const query = "png";
  const responsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/v1/command")) return false;
    try { return response.request().postDataJSON()?.operation === "search.query"; } catch { return false; }
  }, { timeout: 20000 });
  await field.fill(query);
  await page.locator(".search-submit").click();
  const response = await responsePromise;
  const body = await response.json();
  const hits = body?.data?.hits ?? [];
  const matched = hits.map((hit) => ({ hit, segment: (hit.segments ?? []).find((segment) => Boolean(segment.matched_text?.trim())) }))
    .find(({ segment }) => segment?.source_type?.toUpperCase() === "ARTIFACT"
      && segment.kind?.toUpperCase() === "EXTRACT"
      && typeof segment.matched_text === "string"
      && segment.matched_text.length <= 16 * 1024
      && (() => { try { return JSON.parse(segment.matched_text)?.schema === "cairn.domain.image.meta/v1"; } catch { return false; } })());
  assert.ok(matched, `the real ${query} query returned a bounded image metadata artifact as its first matched segment`);
  const loadedIdentity = loadedItems.find((item) => item.subject_ref === matched.hit.subject_ref
    && item.entry_id === matched.hit.entry_id && item.content_id === matched.hit.content_id);
  assert.ok(loadedIdentity && Number.isSafeInteger(loadedIdentity.logical_size), "the existing loaded listing confirms the exact matched identity length");
  await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for/ }).waitFor({ state: "visible", timeout: 15000 });
  const resultHeading = page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for/ });
  const executedHeadingBefore = await resultHeading.innerText();
  const submittedQueryBefore = await page.locator(".global-search input").inputValue();
  assert.equal(submittedQueryBefore, query, "the submitted search text is visible before opening Details");
  const card = page.locator(`.result-row[aria-label=${JSON.stringify(matched.hit.name)}]`);
  await card.waitFor({ state: "visible", timeout: 10000 });
  const compact = card.locator('.result-match[data-image-metadata="recognized"]');
  await compact.waitFor({ state: "visible", timeout: 10000 });
  const compactText = await compact.innerText();
  for (const [key, value] of Object.entries(JSON.parse(matched.segment.matched_text))) {
    if (key === "format" || key === "width" || key === "height") {
      assert.ok(compactText.includes(String(value)), `card summary includes image metadata ${key}`);
    }
    if (key === "bytes") {
      const units = ["KB", "MB", "GB", "TB"];
      let scaled = value;
      let unit = -1;
      while (scaled >= 1024 && unit < units.length - 1) { scaled /= 1024; unit += 1; }
      const expectedBytes = unit < 0 ? `${value} B` : `${scaled.toFixed(1)} ${units[unit]}`;
      assert.ok(/Bytes|字节数/.test(compactText) && compactText.includes(expectedBytes), `card summary labels and formats the declared byte count (${expectedBytes}; got ${compactText})`);
    }
  }
  const orderBefore = await page.locator(".result-row .result-open-copy strong").allTextContents();
  const listing = page.locator(".result-list");
  const selectionCountBefore = await listing.getAttribute("data-selection-count");
  if (await disclosure.evaluate((element) => element.open)) await disclosure.locator("summary.topbar-search-summary").click();
  const checkbox = card.locator(".result-select");
  await checkbox.focus();
  await checkbox.press("Space");
  const selectionCountSelected = await listing.getAttribute("data-selection-count");
  assert.equal(selectionCountSelected, "1", "the matched row is selected before opening Details");
  const openDetails = card.locator(".result-open-copy");
  await openDetails.focus();
  await openDetails.press("Enter");
  const matchedDetails = page.locator(".matched-information").filter({ has: page.locator("pre") }).first();
  await matchedDetails.waitFor({ state: "visible", timeout: 10000 });
  const summary = matchedDetails.locator("summary");
  await summary.focus();
  await summary.press("Enter");
  await matchedDetails.locator("pre").waitFor({ state: "visible", timeout: 10000 });
  const originalShown = await matchedDetails.locator("pre").evaluate((element) => element.textContent);
  assert.equal(originalShown, matched.segment.matched_text, "Details preserves the original matched JSON exactly as text");
  const actualProperties = Object.entries(JSON.parse(matched.segment.matched_text));
  const displayedPropertyNames = await matchedDetails.locator(".matched-image-properties dt").allTextContents();
  for (const [key] of actualProperties) {
    const expectedLabels = key === "schema" ? ["Schema", "数据格式"] : key === "format" ? ["Image format", "图像格式"] : key === "width" ? ["Width", "宽度"] : key === "height" ? ["Height", "高度"] : key === "bytes" ? ["Bytes", "字节数"] : [key];
    assert.ok(expectedLabels.some((label) => displayedPropertyNames.includes(label)), `Details retains own JSON property ${key}`);
  }
  assert.ok(await matchedDetails.getByText(matched.segment.producer, { exact: true }).count(), "Details records the segment producer");
  const provenanceLabels = await matchedDetails.locator(".matched-image-provenance dt").allTextContents();
  assert.ok(provenanceLabels.includes("来源") || provenanceLabels.includes("Source"), "Details records matched segment source");
  if (typeof matched.segment.accepted === "boolean") assert.ok(provenanceLabels.includes("采纳状态") || provenanceLabels.includes("Acceptance"), "Details retains recorded acceptance provenance");
  if (matched.segment.language?.trim()) assert.ok(provenanceLabels.includes("语言") || provenanceLabels.includes("Language"), "Details retains recorded language provenance");
  await page.waitForTimeout(300);
  assert.deepEqual(queryRequests, [query], "opening matched details issues no second search query");
  assert.equal(await page.locator(".global-search input").inputValue(), submittedQueryBefore, "opening Details preserves the submitted query text");
  assert.equal(await resultHeading.innerText(), executedHeadingBefore, "opening Details preserves the executed query heading");
  assert.deepEqual(await page.locator(".result-row .result-open-copy strong").allTextContents(), orderBefore, "Details does not reorder the search results");
  assert.equal(await listing.getAttribute("data-selection-count"), selectionCountSelected, "Details preserves the user's selection");
  assert.equal(selectionCountBefore, "0", "the scenario starts with no selected rows");
  if (evidenceDir) {
    await fs.mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: `${evidenceDir}/image-metadata-details-1280.png`, fullPage: false });
  }
  const downloadPromise = page.waitForEvent("download", { timeout: 20000 });
  await page.getByRole("button", { name: /原始文件|Download original/ }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), matched.hit.name);
  const downloadedPath = `${evidenceDir || "."}/image-metadata-original-${matched.hit.name}`;
  await download.saveAs(downloadedPath);
  const bytes = await fs.readFile(downloadedPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(bytes.length, loadedIdentity.logical_size, "matched original takeout length equals the same identity's loaded logical length");
  assert.equal(digest, String(matched.hit.content_id).replace(/^sha256:/, ""), "matched original takeout SHA-256 equals the search identity");
  if (evidenceDir) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${evidenceDir}/image-metadata-details-390.png`, fullPage: false });
    await fs.writeFile(`${evidenceDir}/image-metadata-search.json`, JSON.stringify({
      query,
      queryRequests,
      hit: matched.hit.name,
      searchOrder: hits.map((hit) => hit.name),
      source: matched.segment.source_type,
      kind: matched.segment.kind,
      producer: matched.segment.producer,
      matchedTextLengthCodeUnits: matched.segment.matched_text.length,
      matchedTextSha256: createHash("sha256").update(matched.segment.matched_text).digest("hex"),
      displayedPropertyNames,
      displayedProvenanceLabels: provenanceLabels,
      originalTakeout: { filename: download.suggestedFilename(), length: bytes.length, sha256: digest, loadedLogicalSize: loadedIdentity.logical_size },
      selectionCount: selectionCountSelected,
      limitations: ["Live search came from the retained 20-file fixture-derived corpus; this is UI/provenance evidence, not representative recall-quality qualification."],
    }, null, 2));
  }
}

// The one search field gains a focus shortcut, a clear control, and a short
// local recents list. All of it is browser convenience over the same typed
// search.query operation: the recents list is local history, and the durable
// form of a query remains the daemon's SavedView (`view.save`).
export async function assertSearchRecents(ctx) {
  const { page, button } = ctx;
  const searchField = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
  const resultsHeading = page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for "/i });
  const headingActions = page.locator(".heading-actions");
  const resultCount = async () => (await page.locator(".workspace-heading .result-count").innerText()).trim();
  const activeLabel = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  const blurActive = () => page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  const recents = page.locator(".search-recents");
  const libraryTile = (name) => page.getByRole("main").getByRole("button", { name }).first();
  const returnToLibrary = async () => {
    const control = headingActions.locator("button.library-return").filter({ hasText: /全部内容|All content/ }).first();
    if (await control.count()) {
      await control.click();
      await resultsHeading.waitFor({ state: "hidden", timeout: 10000 });
    }
    // The full library is the listing that contains the tiny image as well;
    // the search results for a text query would not.
    await libraryTile(/tiny\.png/).waitFor({ state: "visible", timeout: 10000 });
  };

  // 1. Cmd/Ctrl+K focuses the field from the library; "/" does the same outside
  // a text field. Focusing must not scroll the page.
  await returnToLibrary();
  await blurActive();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("Control+k");
  assert.match(await activeLabel(), /搜索内容库|Search content library/, "Ctrl/Cmd+K must focus the search field");
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore, "focusing the search field must not scroll the page");
  await blurActive();
  await page.keyboard.press("Meta+k");
  assert.match(await activeLabel(), /搜索内容库|Search content library/, "Cmd/Ctrl+K must focus the search field with either modifier");
  await blurActive();
  await page.keyboard.press("/");
  assert.match(await activeLabel(), /搜索内容库|Search content library/, "the / key must focus the search field from the library");

  // 2. A submitted query is stated with its count in the existing heading area,
  // recorded exactly once in the local list, and reproducible from that list.
  await searchField.fill("alpha");
  await searchField.press("Enter");
  await resultsHeading.waitFor({ state: "visible", timeout: 15000 });
  const searchedHeading = (await resultsHeading.innerText()).trim();
  assert.match(searchedHeading, /alpha/, `the executed query must be stated in the heading: ${searchedHeading}`);
  const searchedCount = await resultCount();
  assert.match(searchedCount, /[1-9][0-9]*/, `the heading must state the result count: ${searchedCount}`);
  const storedRecents = await page.evaluate(() => localStorage.getItem("cairn.recent_searches"));
  assert.ok(storedRecents && JSON.parse(storedRecents).includes("alpha"), `the submitted query must persist locally: ${storedRecents}`);

  // 3. The clear control empties the field without touching the executed query
  // or the result set.
  await page.locator(".search-clear").click();
  assert.equal(await searchField.inputValue(), "", "the clear control must empty the search field");
  assert.equal((await resultsHeading.innerText()).trim(), searchedHeading, "clearing the text must not change the executed query");
  assert.equal(await resultCount(), searchedCount, "clearing the text must not change the result set");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), await searchField.getAttribute("aria-label"), "the clear control must return focus to the field");
  await recents.waitFor({ state: "visible", timeout: 10000 });
  const recentsText = await recents.innerText();
  assert.match(recentsText, /(?:本机最近搜索|Local recent searches)/, `the recents panel must be labelled as local: ${recentsText}`);
  assert.match(recentsText, /(?:不是已保存的视图|not saved views)/, `the recents panel must not claim to be a saved view: ${recentsText}`);
  assert.equal(await recents.locator(".search-recent-entry", { hasText: /^alpha$/ }).count(), 1, "the submitted query must appear exactly once in the local list");

  // Re-running an entry reproduces the same search and count, and a repeated
  // submission de-duplicates instead of appending.
  await recents.locator(".search-recent-entry", { hasText: /^alpha$/ }).click();
  await resultsHeading.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(200);
  assert.equal((await resultsHeading.innerText()).trim(), searchedHeading, "re-running a recent query must state the same query");
  assert.equal(await resultCount(), searchedCount, "re-running a recent query must reproduce the same result count");
  await page.locator(".search-clear").click();
  await recents.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await recents.locator(".search-recent-entry", { hasText: /^alpha$/ }).count(), 1, "a repeated query must not duplicate its local entry");
  // The list is local history: it must not have created a daemon saved view.
  const savedViewCount = await page.evaluate(async () => {
    const response = await fetch("/api/v1/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "view.list", input: {} }) });
    const body = await response.json();
    return Array.isArray(body?.data) ? body.data.length : -1;
  });
  assert.equal(savedViewCount, 1, "a local recent search must never create a durable saved view");

  // 4. Escape closes the local list first and only empties the field on the
  // next press; neither press runs a search.
  await searchField.press("Escape");
  await recents.waitFor({ state: "hidden", timeout: 10000 });
  assert.equal(await searchField.inputValue(), "", "closing the recents list must leave the field text alone");
  assert.equal(await resultCount(), searchedCount, "closing the recents list must not run a search");
  await searchField.fill("draft-only-escape");
  await searchField.press("Escape");
  assert.equal(await searchField.inputValue(), "", "Escape must empty the field once the recents list is closed");
  assert.equal((await resultsHeading.innerText()).trim(), searchedHeading, "emptying the field must not change the executed search");
  assert.equal(await resultCount(), searchedCount, "emptying the field must not change the result set");

  // 5. The local list can drop one entry and be cleared entirely; the durable
  // saved view survives both.
  await blurActive();
  await searchField.click();
  await recents.waitFor({ state: "visible", timeout: 10000 });
  const removeTarget = (await recents.locator(".search-recent-entry").first().innerText()).trim();
  await recents.locator(".search-recent-remove").first().click();
  assert.equal(await recents.locator(".search-recent-entry", { hasText: new RegExp(`^${escapeRegExp(removeTarget)}$`) }).count(), 0, `removing one entry must drop only that entry: ${removeTarget}`);
  const persistedAfterRemove = JSON.parse(await page.evaluate(() => localStorage.getItem("cairn.recent_searches") ?? "[]"));
  assert.equal(persistedAfterRemove.includes(removeTarget), false, "the removed entry must leave the persisted local list");
  assert.ok(persistedAfterRemove.length > 0, `the other entries must stay in the local list: ${JSON.stringify(persistedAfterRemove)}`);
  await recents.getByRole("button", { name: /清除最近搜索|Clear recent searches/ }).click();
  await recents.waitFor({ state: "hidden", timeout: 10000 });
  assert.equal(await page.evaluate(() => localStorage.getItem("cairn.recent_searches")), null, "clearing the local list must clear the persisted list");
  assert.equal(await page.evaluate(async () => {
    const response = await fetch("/api/v1/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "view.list", input: {} }) });
    const body = await response.json();
    return Array.isArray(body?.data) ? body.data.length : -1;
  }), 1, "clearing the local list must not touch durable saved views");

  // 6. "/" stays a literal character inside a text field, and neither shortcut
  // pierces an open drawer or the image viewer.
  await returnToLibrary();
  await blurActive();
  await libraryTile(/alpha\.txt/).click();
  const noteComposer = page.getByRole("textbox", { name: /新备注|New note/ });
  await noteComposer.waitFor({ state: "visible", timeout: 10000 });
  await noteComposer.click();
  await noteComposer.press("/");
  await page.waitForTimeout(100);
  assert.equal(await noteComposer.inputValue(), "/", "the / key must stay a literal character inside a text field");
  assert.equal(await activeLabel(), await noteComposer.getAttribute("aria-label"), "the / key must not steal focus from another text field");
  await noteComposer.fill("");

  await button(/添加内容|Add content|添加来源|Add source/).first().click();
  const shortcutDrawer = page.getByRole("dialog", { name: /添加来源|Add source|上传文件|Upload files/ });
  await shortcutDrawer.waitFor({ state: "visible", timeout: 10000 });
  await shortcutDrawer.getByRole("tab", { name: /服务器目录|Server folder/ }).click();
  const drawerPath = shortcutDrawer.getByRole("textbox", { name: /Cairn 主机上的路径|Path on Cairn host/ });
  await drawerPath.waitFor({ state: "visible", timeout: 10000 });
  await drawerPath.press("/");
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[aria-modal="true"]'))), true, "the search shortcuts must not steal focus from an open drawer");
  assert.equal(await drawerPath.inputValue(), "/", "the / key must stay a literal character inside the drawer's path field");
  await shortcutDrawer.getByRole("button", { name: /关闭添加来源|Close add source/ }).click();
  await shortcutDrawer.waitFor({ state: "hidden", timeout: 10000 });

  await libraryTile(/tiny\.png/).click();
  const previewPanel = page.locator(".cairn-content-preview__panel");
  await previewPanel.locator(".cairn-content-preview__image").waitFor({ state: "visible", timeout: 10000 });
  await previewPanel.getByRole("button", { name: /查看原图|View full size/ }).first().click();
  const viewer = page.getByRole("dialog", { name: /图片查看器|Image viewer/ });
  await viewer.waitFor({ state: "visible", timeout: 10000 });
  await page.keyboard.press("Control+k");
  await page.keyboard.press("/");
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest(".cairn-image-viewer"))), true, "the search shortcuts must not steal focus from the image viewer");
  await page.keyboard.press("Escape");
  await viewer.waitFor({ state: "hidden", timeout: 10000 });
  assert.equal(await viewer.count(), 0, "Escape must still close the image viewer");

  // 7. The existing library-return control is the one way back to the full
  // library from an active search.
  await searchField.fill("alpha");
  await searchField.press("Enter");
  await resultsHeading.waitFor({ state: "visible", timeout: 15000 });
  const returnControl = headingActions.locator("button.library-return").filter({ hasText: /全部内容|All content/ }).first();
  await returnControl.waitFor({ state: "visible", timeout: 10000 });
  await returnControl.click();
  await resultsHeading.waitFor({ state: "hidden", timeout: 10000 });
  await libraryTile(/tiny\.png/).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.locator(".result-list .result-row").count(), 3, "returning to All content must restore the full library");
  assert.equal(await resultsHeading.count(), 0, "returning to All content must leave the search results view");
  await blurActive();
}

// Selection belongs to the submitted search result scope, so changing only a
// domain presentation keeps selected subjects until a replacement query drops
// those outside its new result set.
export async function assertSelectionFollowsSearchPresentations(ctx, {
  query = "a",
  photoName = "Cairn-Frame-Overpixel.png",
  musicName = "Tone-Alpha.wav",
  evidenceDir,
} = {}) {
  const { page } = ctx;
  const selectionLabel = (selected, name) => new RegExp(`^(?:${selected ? "Deselect\\s+|取消选择\\s*" : "Select\\s+|选择\\s*"})${escapeRegExp(name)}$`);
  const queries = [];
  const states = [];
  const recordsByRequest = new Map();
  const onRequest = (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/command")) return;
    try {
      const payload = request.postDataJSON();
      if (payload?.operation !== "search.query") return;
      const record = { payload, httpStatus: undefined, commandStatus: undefined, subjects: undefined };
      queries.push(record);
      recordsByRequest.set(request, record);
    } catch {}
  };
  const onResponse = (response) => {
    const record = recordsByRequest.get(response.request());
    if (!record) return;
    const task = (async () => {
      record.httpStatus = response.status();
      const body = await response.json();
      record.commandStatus = body?.status;
      record.subjects = (body?.data?.hits ?? []).map(({ subject_ref, entry_id, name, content_id, logical_size }) => ({ subject_ref, entry_id, name, content_id, logical_size }));
    })();
    task.catch(() => {});
  };
  const captureState = async (label) => page.evaluate((stateLabel) => {
    const activeList = document.querySelector(".result-list, .music-track-list");
    return {
      label: stateLabel,
      query: document.querySelector('input[aria-label="Search content library"], input[aria-label="搜索内容库"]')?.value ?? "",
      hash: location.hash,
      selectedCount: activeList?.getAttribute("data-selection-count") ?? document.querySelector(".selection-count")?.textContent?.trim() ?? "0",
      selectedLabels: [...document.querySelectorAll('[role="checkbox"][aria-checked="true"], input[type="checkbox"]:checked')].map((node) => node.getAttribute("aria-label")),
      selectedNames: [...document.querySelectorAll('[role="checkbox"][aria-checked="true"], input[type="checkbox"]:checked')].map((node) => node.getAttribute("aria-label")?.replace(/^(?:Deselect|Select|取消选择|选择)\s*/, "")),
      hiddenSelectionDisclosure: [...document.querySelectorAll(".music-action-notes, .library-selection-scope")].map((node) => node.textContent?.trim()).filter(Boolean),
      photos: document.querySelectorAll(".photo-library .photo-card").length,
      musicTracks: document.querySelectorAll(".music-track-list .music-track").length,
      resultRows: document.querySelectorAll(".result-list .result-row").length,
    };
  }, label);
  const waitForQueryResponse = async (record) => {
    const deadline = Date.now() + 10000;
    while (!Array.isArray(record.subjects) && Date.now() < deadline) await page.waitForTimeout(50);
    assert.equal(record.httpStatus, 200, "the submitted query receives a real successful HTTP response");
    assert.equal(record.commandStatus, "SUCCEEDED", "the submitted query receives a successful daemon result");
    assert.ok(Array.isArray(record.subjects), "the submitted query response contains its ordered real subject tuples");
  };
  let resolvedEvidenceDir;
  page.on("request", onRequest);
  page.on("response", onResponse);
  try {
    if (evidenceDir) {
      resolvedEvidenceDir = resolve(evidenceDir);
      await mkdir(resolvedEvidenceDir, { recursive: true });
    }
    await page.locator(".result-list .result-row").first().waitFor({ state: "visible", timeout: 30000 });
    const search = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
    if (!(await search.isVisible())) await page.locator(".topbar-search").locator("summary.topbar-search-summary").click();
    await search.fill(query);
    await search.press("Enter");
    await page.getByRole("main").getByRole("heading", { name: /搜索结果|Results for/ }).waitFor({ state: "visible", timeout: 30000 });
    assert.equal(queries.length, 1, "the initial query is submitted once through the visible search field");
    await waitForQueryResponse(queries[0]);
    assert.ok(queries[0].subjects.some((subject) => subject.name === photoName), "the initial daemon result includes the selected photo");
    assert.ok(queries[0].subjects.some((subject) => subject.name === musicName), "the initial daemon result includes the selected music track");
    await page.locator(".library-presentation-navigation__domain[data-domain*=photo i]").first().click();
    const photoSelection = page.getByRole("checkbox", { name: selectionLabel(false, photoName) });
    await photoSelection.waitFor({ state: "visible", timeout: 20000 });
    await photoSelection.click();
    await page.locator(".selection-bar .selection-count").filter({ hasText: /1 selected|已选择\s*1/ }).waitFor({ state: "visible", timeout: 10000 });
    states.push(await captureState("photos-one-selected"));
    if (resolvedEvidenceDir) await page.screenshot({ path: join(resolvedEvidenceDir, "photos-selected.png"), animations: "disabled" });

    await page.locator(".library-presentation-navigation__domain[data-domain*=music i]").first().click();
    const musicSelection = page.getByRole("checkbox", { name: selectionLabel(false, musicName) });
    await musicSelection.waitFor({ state: "visible", timeout: 20000 });
    await page.locator(".music-track-list").waitFor({ state: "visible", timeout: 10000 });
    states.push(await captureState("music-one-hidden-selection"));
    if (resolvedEvidenceDir) await page.screenshot({ path: join(resolvedEvidenceDir, "music-one-hidden-selection.png"), animations: "disabled" });
    assert.equal(states.at(-1).selectedCount, "1", "Music keeps the photo in the shared host selection");
    assert.match(states.at(-1).hiddenSelectionDisclosure.join(" "), /outside the displayed tracks|当前显示曲目之外/, "Music truthfully discloses the selected photo outside its displayed tracks");

    await musicSelection.click();
    await page.locator(".music-track-list").getByRole("checkbox", { name: selectionLabel(true, musicName) }).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForFunction(() => document.querySelector(".music-track-list")?.getAttribute("data-selection-count") === "2", { timeout: 10000 });
    states.push(await captureState("music-two-selected"));

    await page.locator(".library-presentation-navigation__domain--library").click();
    await page.locator('.result-list .result-select[aria-checked="true"]').nth(1).waitFor({ state: "visible", timeout: 10000 });
    states.push(await captureState("all-types-two-selected"));
    assert.deepEqual(new Set(states.at(-1).selectedNames), new Set([photoName, musicName]), "all types retains both subject selections from the same search scope");
    assert.equal(queries.length, 1, "Photos, Music, and all-types switches do not rerun the query");
    if (resolvedEvidenceDir) await page.screenshot({ path: join(resolvedEvidenceDir, "selection-retained-all-types.png"), animations: "disabled" });

    const replacementQuery = `${query} suffix:png`;
    const replacementSearch = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
    if (!(await replacementSearch.isVisible())) await page.locator(".topbar-search").locator("summary.topbar-search-summary").click();
    await replacementSearch.fill(replacementQuery);
    await replacementSearch.press("Enter");
    await page.getByRole("main").getByRole("heading", { name: new RegExp(escapeRegExp(replacementQuery)) }).waitFor({ state: "visible", timeout: 30000 });
    assert.equal(queries.length, 2, "the replacement query is the only additional search request");
    const replacement = queries[1];
    await waitForQueryResponse(replacement);
    assert.ok(replacement.subjects?.some((subject) => subject.name === photoName), "the daemon's suffix-filtered hits retain the selected photo");
    assert.ok(replacement.subjects?.every((subject) => !/\.wav$/i.test(subject.name ?? "")), "the daemon's real suffix-filtered hits exclude audio files");
    await page.waitForFunction(() => document.querySelector(".result-list")?.getAttribute("data-selection-count") === "1", { timeout: 15000 });
    await page.getByRole("checkbox", { name: selectionLabel(true, photoName) }).waitFor({ state: "visible", timeout: 10000 });
    states.push(await captureState("replacement-query-one-selected"));
    assert.deepEqual(states.at(-1).selectedNames, [photoName], "the replacement query prunes the selected music subject and retains its matching photo");
    if (resolvedEvidenceDir) await page.screenshot({ path: join(resolvedEvidenceDir, "selection-pruned-after-replacement.png"), animations: "disabled" });

    if (resolvedEvidenceDir) {
      const receipt = {
        queries: queries.map(({ payload, httpStatus, commandStatus, subjects }) => ({ payload, http_status: httpStatus, command_status: commandStatus, ordered_subjects: subjects })),
        states,
      };
      await writeFile(join(resolvedEvidenceDir, "selection-continuity.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    }
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
    if (resolvedEvidenceDir && queries.length) {
      await writeFile(join(resolvedEvidenceDir, "selection-continuity-last-attempt.json"), `${JSON.stringify({ queries: queries.map(({ payload, httpStatus, commandStatus, subjects }) => ({ payload, http_status: httpStatus, command_status: commandStatus, ordered_subjects: subjects })), states }, null, 2)}\n`);
    }
  }
}

// A committed destination-header query should get out of the way so the
// ordinary result-scope controls are reachable. Refused, failed, stale, or
// newly edited work must leave the disclosure under the user's control.
export async function assertCommittedSearchDismissesOverlay(ctx, { query = "Cairn" } = {}) {
  const { page } = ctx;
  const disclosure = page.locator(".topbar-search");
  const summary = disclosure.locator("summary.topbar-search-summary");
  const field = page.getByRole("textbox", { name: /搜索内容库|Search content library/ });
  const searchQueryOf = (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/command")) return "";
    try {
      const payload = request.postDataJSON();
      return payload?.operation === "search.query" ? String(payload.input?.query ?? "") : "";
    } catch { return ""; }
  };
  const responseFor = (value) => page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/command") && searchQueryOf(response.request()) === value, { timeout: 20000 });
  const submittedQueries = [];
  const recordSearchRequest = (request) => {
    const value = searchQueryOf(request);
    if (value) submittedQueries.push(value);
  };
  const openSearch = async () => {
    if (!(await disclosure.evaluate((element) => element.open))) await summary.click();
    await field.waitFor({ state: "visible", timeout: 10000 });
  };
  const failureQuery = "cairn-dismissal-failure-probe";
  const editedQuery = "cairn-dismissal-late-edit-probe";
  const reopenedQuery = "cairn-dismissal-reopen-probe";
  const progress = [];
  const routeFailures = [];
  const mark = (step) => { progress.push(step); ctx.searchDismissalProgress = progress.slice(); };
  let failStartedResolve;
  let failFinishedResolve;
  let releaseFailure;
  let failureGate = new Promise((resolve) => { releaseFailure = resolve; });
  const failStarted = new Promise((resolve) => { failStartedResolve = resolve; });
  const failFinished = new Promise((resolve) => { failFinishedResolve = resolve; });
  let delayedQuery = "";
  let delayedGate = Promise.resolve();
  let releaseDelayed = () => {};
  let delayedStartedResolve;
  let delayedFinishedResolve;
  let delayedStarted = Promise.resolve();
  let delayedFinished = Promise.resolve();
  let delayedRouteCompletion = Promise.resolve();
  const armDelay = (value) => {
    delayedQuery = value;
    delayedGate = new Promise((resolve) => { releaseDelayed = resolve; });
    delayedStarted = new Promise((resolve) => { delayedStartedResolve = resolve; });
    delayedFinished = new Promise((resolve) => { delayedFinishedResolve = resolve; });
  };
  const routeSearchOutcomes = async (route) => {
    const value = searchQueryOf(route.request());
    if (value === failureQuery) {
      failStartedResolve();
      try { await failureGate; await route.abort("failed"); }
      finally { failFinishedResolve(); }
      return;
    }
    if (value && value === delayedQuery) {
      const response = await route.fetch();
      delayedStartedResolve();
      delayedRouteCompletion = (async () => {
        try { await delayedGate; await route.fulfill({ response }); }
        catch (error) { routeFailures.push(String(error)); ctx.searchDismissalRouteFailures = routeFailures.slice(); }
        finally { delayedFinishedResolve(); }
      })();
      await delayedRouteCompletion;
      return;
    }
    await route.continue();
  };
  page.on("request", recordSearchRequest);
  await page.route("**/api/v1/command", routeSearchOutcomes);
  try {
    await openSearch();
    const successResponsePromise = responseFor(query);
    await field.fill(query);
    await field.press("Enter");
    const successResponse = await successResponsePromise;
    assert.equal(successResponse.status(), 200, "the real search request returns HTTP 200");
    const successBody = await successResponse.json();
    assert.ok(["SUCCEEDED", "DEGRADED"].includes(successBody?.status), "the daemon commits a real search result, including an honestly degraded result");
    await page.getByRole("main").getByRole("heading", { name: new RegExp(escapeRegExp(query)) }).waitFor({ state: "visible", timeout: 20000 });
    mark("real-success-query-committed");
    await page.waitForFunction(() => {
      const element = document.querySelector(".topbar-search");
      return element instanceof HTMLDetailsElement && !element.open;
    }, { timeout: 10000 });
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("topbar-search-summary")), true, "focus returns to the visible search summary after dismissal");
    const filters = page.locator(".library-filters-disclosure");
    await filters.waitFor({ state: "visible", timeout: 10000 });
    await filters.locator(":scope > summary").click();
    assert.equal(await filters.evaluate((element) => element.open), true, "Filters opens directly after a successful query without another search-overlay dismissal");
    mark("success-dismissed-filters-directly-open");

    await openSearch();
    const beforeInvalid = submittedQueries.length;
    await field.fill("size:>not-a-size");
    await field.press("Enter");
    await page.locator(".search-ops-error").waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await disclosure.evaluate((element) => element.open), true, "an invalid query keeps the search disclosure open for correction");
    assert.equal(submittedQueries.length, beforeInvalid, "invalid query is refused without a daemon request");
    mark("invalid-query-retained-overlay-without-request");

    await field.fill(failureQuery);
    await field.press("Enter");
    await waitForGate(failStarted, "failed search request");
    await page.waitForFunction(() => {
      const button = document.querySelector(".search-submit");
      return button instanceof HTMLButtonElement && button.disabled;
    }, { timeout: 10000 });
    releaseFailure();
    await waitForGate(failFinished, "failed search completion");
    await page.waitForFunction(() => {
      const button = document.querySelector(".search-submit");
      return button instanceof HTMLButtonElement && !button.disabled;
    }, { timeout: 20000 });
    assert.equal(await disclosure.evaluate((element) => element.open), true, "a failed request keeps the search disclosure open");
    mark("failed-query-retained-overlay");

    armDelay(editedQuery);
    await field.fill(editedQuery);
    await field.press("Enter");
    await waitForGate(delayedStarted, "held search before newer edit");
    await field.fill("newer draft remains");
    releaseDelayed();
    await waitForGate(delayedFinished, "held search fulfillment after newer edit");
    await page.getByRole("main").getByRole("heading", { name: new RegExp(escapeRegExp(editedQuery)) }).waitFor({ state: "visible", timeout: 20000 });
    assert.equal(await field.inputValue(), "newer draft remains", "the later field edit remains visible after the older query commits");
    assert.equal(await disclosure.evaluate((element) => element.open), true, "the older completion does not dismiss a newer search draft");
    mark("late-completion-preserved-newer-edit");

    armDelay(reopenedQuery);
    await field.fill(reopenedQuery);
    await field.press("Enter");
    await waitForGate(delayedStarted, "held search before overlay reopen");
    const outsideTarget = page.locator(".library-result-scope small");
    const [headingBox, overlayBox] = await Promise.all([
      outsideTarget.boundingBox(),
      page.locator(".topbar-search-overlay").boundingBox(),
    ]);
    assert.ok(headingBox && overlayBox, "the inert result-scope notice and search overlay are visible before outside dismissal");
    const clickPoint = { x: Math.min(8, headingBox.width / 2), y: headingBox.height / 2 };
    const pagePoint = { x: headingBox.x + clickPoint.x, y: headingBox.y + clickPoint.y };
    ctx.searchDismissalGeometry = { target: ".library-result-scope small", targetBox: headingBox, overlayBox, clickPoint: pagePoint };
    const clickPointOverlapsOverlay = pagePoint.x >= overlayBox.x && pagePoint.x <= overlayBox.x + overlayBox.width &&
      pagePoint.y >= overlayBox.y && pagePoint.y <= overlayBox.y + overlayBox.height;
    assert.equal(clickPointOverlapsOverlay, false, "the chosen inert result-scope click point is outside the search overlay");
    await outsideTarget.click({ position: clickPoint });
    await page.waitForFunction(() => {
      const element = document.querySelector(".topbar-search");
      return element instanceof HTMLDetailsElement && !element.open;
    }, { timeout: 10000 });
    await page.keyboard.press("Control+k");
    await page.waitForFunction(() => {
      const element = document.querySelector(".topbar-search");
      return element instanceof HTMLDetailsElement && element.open;
    }, { timeout: 10000 });
    assert.equal(await disclosure.evaluate((element) => element.open), true, "the user can reopen the overlay while a query is pending");
    mark("outside-close-and-shortcut-reopen-same-overlay");
    releaseDelayed();
    await waitForGate(delayedFinished, "held search fulfillment after overlay reopen");
    await page.getByRole("main").getByRole("heading", { name: new RegExp(escapeRegExp(reopenedQuery)) }).waitFor({ state: "visible", timeout: 20000 });
    assert.equal(await disclosure.evaluate((element) => element.open), true, "a completion does not dismiss an overlay the user reopened");
    mark("late-completion-preserved-reopened-overlay");
    assert.deepEqual(routeFailures, [], "controlled search routes complete without harness errors");
  } finally {
    releaseFailure();
    releaseDelayed();
    try { await waitForGate(delayedRouteCompletion, "held search route cleanup", 5000); }
    catch (error) { routeFailures.push(String(error)); ctx.searchDismissalRouteFailures = routeFailures.slice(); }
    await page.unroute("**/api/v1/command", routeSearchOutcomes);
    page.off("request", recordSearchRequest);
  }
}
