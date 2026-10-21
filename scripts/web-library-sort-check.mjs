// Regression for the existing listing rules: unmeasured values stay after
// known values in both directions. Use the actual TypeScript helpers.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "../web/node_modules/typescript/lib/typescript.js";

const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 };
const capturedSource = await readFile(new URL("../web/src/lib/capturedTime.ts", import.meta.url), "utf8");
const capturedCompiled = ts.transpileModule(capturedSource, { compilerOptions }).outputText;
const capturedURL = `data:text/javascript;base64,${Buffer.from(capturedCompiled).toString("base64")}`;
const formatSource = (await readFile(new URL("../web/src/lib/format.ts", import.meta.url), "utf8"))
  .replace('import { capturedModificationTimeMillis } from "./capturedTime";', `import { capturedModificationTimeMillis } from ${JSON.stringify(capturedURL)};`);
const formatCompiled = ts.transpileModule(formatSource, { compilerOptions }).outputText;
const { sortLibraryHits, itemInMonth, monthBucketKey } = await import(`data:text/javascript;base64,${Buffer.from(formatCompiled).toString("base64")}`);
const projectionSource = (await readFile(new URL("../web/src/lib/namespaceProjection.ts", import.meta.url), "utf8"))
  .replace('import { capturedModificationTimeMillis } from "./capturedTime";', `import { capturedModificationTimeMillis } from ${JSON.stringify(capturedURL)};`);
const projectionCompiled = ts.transpileModule(projectionSource, { compilerOptions }).outputText;
const { projectNamespaceCapturedTimes } = await import(`data:text/javascript;base64,${Buffer.from(projectionCompiled).toString("base64")}`);
const { capturedModificationTimeMillis } = await import(capturedURL);
const rows = [
  { name: "large", logical_size: 100 },
  { name: "missing" },
  { name: "zero", logical_size: 0 },
  { name: "invalid", logical_size: -1 },
  { name: "small-b", logical_size: 4 },
  { name: "small-a", logical_size: 4 },
  { name: "unsafe", logical_size: Number.MAX_SAFE_INTEGER + 1 },
  { name: "nonfinite", logical_size: NaN },
];
const before = rows.map((row) => ({ ...row }));
for (const [direction, knownNames] of [
  ["asc", ["zero", "small-a", "small-b", "large"]],
  ["desc", ["large", "small-b", "small-a", "zero"]],
]) {
  const result = sortLibraryHits(rows, "size", direction, "en");
  assert.deepEqual(result.slice(0, 4).map((row) => row.name), knownNames);
  assert.deepEqual(new Set(result.slice(4).map((row) => row.name)), new Set(["missing", "invalid", "unsafe", "nonfinite"]));
  assert.deepEqual(rows, before, "sorting must not mutate the source projection");
  assert.notEqual(result, rows);
}
assert.deepEqual(sortLibraryHits([], "size", "desc", "en"), []);
const modifiedRows = [
  { name: "recent-b", modified_at: "2024-06-01T12:00:00.123999999Z" },
  { name: "unknown", modified_at: undefined },
  { name: "old", modified_at: "1960-06-01T12:00:00Z" },
  { name: "invalid", modified_at: "2024-02-30T12:00:00Z" },
  { name: "recent-a", modified_at: "2024-06-01T12:00:00.123456789Z" },
];
const modifiedBefore = modifiedRows.map((row) => ({ ...row }));
assert.deepEqual(sortLibraryHits(modifiedRows, "modified", "asc", "en").map((row) => row.name), ["old", "recent-b", "recent-a", "unknown", "invalid"]);
assert.deepEqual(sortLibraryHits(modifiedRows, "modified", "desc", "en").map((row) => row.name), ["recent-b", "recent-a", "old", "unknown", "invalid"]);
assert.deepEqual(modifiedRows, modifiedBefore, "modified-time sorting must not mutate the source projection");
assert.equal(capturedModificationTimeMillis("1970-01-01T00:00:00Z"), 0);
assert.equal(capturedModificationTimeMillis("1960-06-01T12:00:00Z"), Date.UTC(1960, 5, 1, 12));
assert.equal(capturedModificationTimeMillis("2024-06-01T12:00:00.123456789Z"), Date.UTC(2024, 5, 1, 12, 0, 0, 123));
for (const value of [
  "0001-01-01T00:00:00Z", "0001-01-01T00:00:00.000000000Z", "2024-02-30T12:00:00Z",
  "2024-06-01T12:00:00+00:00", "2024-06-01T12:00:00.1234567890Z", 0,
]) assert.equal(capturedModificationTimeMillis(value), undefined, `invalid captured time ${String(value)} must remain unknown`);
const recent = { name: "recent", modified_at: "2024-06-01T12:00:00.123456789Z" };
assert.equal(itemInMonth(recent, monthBucketKey(Date.UTC(2024, 5, 1, 12, 0, 0, 123))), true);
assert.equal(itemInMonth({ name: "zero", modified_at: "0001-01-01T00:00:00Z" }, "0001-01"), false);
const capturedValue = "1960-06-01T12:00:00.123456789Z";
const namespaceHit = { entry_type: "REGULAR_FILE", entry_id: "entry-1", subject_ref: "subject-1", content_id: `sha256:${"a".repeat(64)}`, logical_size: 5 };
const loadedHit = { ...namespaceHit, modified_at: capturedValue };
const projected = projectNamespaceCapturedTimes([namespaceHit], [loadedHit]);
assert.equal(projected[0].modified_at, capturedValue, "namespace projection must preserve valid captured RFC3339Nano text exactly");
assert.equal(capturedModificationTimeMillis(projected[0].modified_at), Date.UTC(1960, 5, 1, 12, 0, 0, 123));
assert.equal(projectNamespaceCapturedTimes([namespaceHit], [{ ...loadedHit, modified_at: "0001-01-01T00:00:00Z" }])[0].modified_at, undefined);
assert.equal(projectNamespaceCapturedTimes([{ ...namespaceHit, modified_at: "2024-02-30T12:00:00Z" }], [loadedHit])[0].modified_at, undefined);
assert.equal(projectNamespaceCapturedTimes([namespaceHit], [{ ...loadedHit, modified_at: "1970-01-01T00:00:00Z" }])[0].modified_at, "1970-01-01T00:00:00Z");
assert.equal(projectNamespaceCapturedTimes([namespaceHit], [{ ...loadedHit, modified_at: "1960-06-01T12:00:00Z" }, { ...loadedHit, entry_id: "entry-1" }])[0].modified_at, undefined, "ambiguous namespace identity must not project a timestamp");
console.log("PASS: size and captured-time sorting keep unknowns last, preserve equal-time order and input, and namespace projection retains only strict captured UTC nano/epoch/pre-epoch values.");
