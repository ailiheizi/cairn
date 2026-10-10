// Browser acceptance check for the admitted named-retrieval surface
// (RW-PERSONAL-UX-1, R1.4): the saved-retrieval provenance claim.
//
// Scenario: recall a stored view, then re-run a plain search with the SAME
// query text. The plain search carries none of the stored conditions, so the
// client must stop claiming that the saved view's conditions are what is being
// shown. The check is about provenance, not about which rows happen to come
// back: several of these checks exist precisely because the UI once claimed a
// saved view's conditions were applied while the results came from somewhere
// else.
//
// Assertions:
//   - the saved-retrieval entry point is present and lists a stored view whose
//     query text can be recovered;
//   - recalling it produces the live-evaluation caption and names at least one
//     stored condition (otherwise this check would be vacuous);
//   - a plain re-search with the same query text actually executes and returns
//     rows;
//   - the live-evaluation caption clears after that re-search;
//   - the panel no longer presents the stored condition as an applied filter.
//
// Fixture assumption: the daemon at the target URL holds at least one stored
// view with a supported condition (for example `suffix=wav`) whose query also
// returns rows. The view name, query text and condition tokens are read at
// runtime; nothing is saved or edited.
//
// Usage:
//   node scripts/web-saved-retrieval-provenance-check.mjs [url]
//
// Environment:
//   RESTOREWEAVE_BASE_URL                     default http://127.0.0.1:4648/
//   RESTOREWEAVE_PLAYWRIGHT_EXECUTABLE_PATH   optional browser binary
//
// A failure exits nonzero with the concrete observation that failed.

import assert from "node:assert/strict";
import { chromium } from "../web/node_modules/playwright/index.mjs";

const base = (process.argv[2] || process.env.RESTOREWEAVE_BASE_URL || "http://127.0.0.1:4648/").replace(/\/$/, "");
const chrome = process.env.RESTOREWEAVE_PLAYWRIGHT_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const observed = {};
let failure;
let browser;

/** Poll a page read until it satisfies `terminal`, then return the last read. */
async function poll(read, terminal, timeoutMs = 20000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  while (Date.now() < deadline) {
    if (terminal(last)) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
    last = await read();
  }
  return last;
}

const readSnapshot = (page) => page.evaluate(() => {
  const captionCount = document.querySelectorAll(".recall-caption").length;
  const caption = captionCount ? (document.querySelector(".recall-caption strong")?.textContent ?? "") : "";
  const panelFields = document.querySelector(".saved-retrieval-preview")?.innerText ?? "";
  const outcome = document.querySelector(".saved-retrieval-outcome")?.innerText ?? "";
  return {
    rows: document.querySelectorAll(".result-list:not(.list-mode) .result-row").length,
    captionCount,
    caption,
    panelFields: panelFields.replace(/\s+/g, " ").trim().slice(0, 200),
    outcome: outcome.replace(/\s+/g, " ").trim().slice(0, 200),
  };
});

try {
  browser = await chromium.launch({ headless: true, executablePath: chrome });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator(".result-list:not(.list-mode) .result-row").first().waitFor({ state: "visible", timeout: 30000 });

  const trigger = page.getByRole("button", { name: /Saved retrieval|已保存的检索/i });
  const triggerCount = await trigger.count();
  observed.triggerCount = triggerCount;
  assert.ok(triggerCount > 0, `the saved-retrieval entry point is present: observed ${triggerCount}`);
  await trigger.first().click();
  await page.locator(".saved-retrieval-rows li").first().waitFor({ state: "visible", timeout: 15000 });

  const rowsList = page.locator(".saved-retrieval-rows li");
  const storedCount = await rowsList.count();
  observed.storedViewCount = storedCount;
  assert.ok(storedCount > 0, `a stored view exists: observed ${storedCount}`);

  const meta = await rowsList.first().locator(".saved-retrieval-view small").first().innerText().catch(() => "");
  const storedQuery = meta.split("·")[0].trim();
  observed.storedQueryMeta = meta;
  observed.storedQuery = storedQuery;
  assert.ok(storedQuery.length > 0, `the stored view's query text is recoverable: observed ${JSON.stringify(meta)}`);

  await rowsList.first().getByRole("button", { name: /Open in library/i }).click();
  const recalled = await poll(() => readSnapshot(page), (snapshot) => snapshot.captionCount >= 1 || snapshot.outcome.length > 0, 20000);
  observed.recalled = recalled;
  assert.ok(recalled.captionCount === 1 && /Live evaluation of saved view/i.test(recalled.caption), `recall produces the live-evaluation caption: observed ${JSON.stringify(recalled)}`);

  // Derive the stored condition text from what the recalled panel names, so
  // this check is not tied to one fixture's filter wording. The panel presents
  // the stored conditions under a "Saved filters" label; the words after that
  // label are the fixture-specific condition (for example "Format wav").
  const filtersIndex = recalled.panelFields.search(/saved filters/i);
  const storedConditionText = filtersIndex >= 0 ? recalled.panelFields.slice(filtersIndex).replace(/^saved filters\s*/i, "").trim() : "";
  const conditionWords = storedConditionText.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  observed.storedConditionText = storedConditionText;
  observed.storedConditionWords = conditionWords;
  assert.ok(conditionWords.length > 0, `the recalled view names at least one stored condition under a Saved filters label, so the provenance check is not vacuous: observed ${JSON.stringify(recalled.panelFields)}`);

  // Now re-run a plain search with the SAME text: the request no longer carries
  // the stored conditions, so the claim must not survive.
  const input = page.locator(".global-search input").first();
  await input.click();
  await input.fill(storedQuery);
  await input.press("Enter");
  // Poll instead of sleeping a fixed interval: under a loaded daemon the search
  // can take longer than any single guess, and a fixed wait turned this check
  // flaky.
  const afterRerun = await poll(() => readSnapshot(page), (snapshot) => snapshot.captionCount === 0 && snapshot.outcome === "", 25000);
  observed.afterRerun = afterRerun;
  assert.ok(afterRerun.rows > 0, `the plain re-search was actually executed and returned rows: observed ${JSON.stringify({ recalledRows: recalled.rows, afterRows: afterRerun.rows })}`);

  const stillClaims = afterRerun.captionCount === 1 && /Live evaluation of saved view/i.test(afterRerun.caption);
  observed.stillClaims = stillClaims;
  assert.equal(stillClaims, false, `F2: the live-evaluation claim clears after a plain re-search: observed ${JSON.stringify({ stillClaims, recalledRows: recalled.rows, afterRows: afterRerun.rows, caption: afterRerun.caption })}`);

  const afterLower = afterRerun.panelFields.toLowerCase();
  const panelStillClaimsFilters = /saved filters/i.test(afterRerun.panelFields) && conditionWords.every((word) => afterLower.includes(word));
  observed.panelStillClaimsFilters = panelStillClaimsFilters;
  assert.equal(panelStillClaimsFilters, false, `F2: the panel stops presenting the stored filter as applied: observed ${JSON.stringify({ panelFields: afterRerun.panelFields, storedConditionText })}`);
} catch (error) {
  failure = error;
} finally {
  if (browser) await browser.close();
}

console.log(`base                        : ${base}`);
console.log(`saved-retrieval triggers    : ${observed.triggerCount ?? "not read"}`);
console.log(`stored views                : ${observed.storedViewCount ?? "not read"}`);
console.log(`stored view meta            : ${JSON.stringify(observed.storedQueryMeta ?? null)}`);
console.log(`stored query                : ${JSON.stringify(observed.storedQuery ?? null)}`);
console.log(`recalled snapshot           : ${JSON.stringify(observed.recalled ?? null)}`);
console.log(`derived stored condition    : ${JSON.stringify(observed.storedConditionText ?? null)} (words ${JSON.stringify(observed.storedConditionWords ?? null)})`);
console.log(`after plain re-search       : ${JSON.stringify(observed.afterRerun ?? null)}`);
console.log(`still claims live view      : ${observed.stillClaims ?? "not read"}`);
console.log(`panel still claims filters  : ${observed.panelStillClaimsFilters ?? "not read"}`);

if (failure) {
  console.error(`FAIL: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("PASS: a plain re-search with the recalled view's query text cleared the live-evaluation claim and stopped presenting the stored condition as applied.");
}
