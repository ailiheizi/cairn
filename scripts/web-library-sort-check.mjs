// Regression for the existing listing rule: unmeasured sizes stay after known
// sizes in both directions. Use the actual TypeScript presentation helper.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "../web/node_modules/typescript/lib/typescript.js";

const source = await readFile(new URL("../web/src/lib/format.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { sortLibraryHits } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
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
console.log("PASS: known sizes sort by direction, unknown sizes stay last, ties stay deterministic, and input remains unchanged.");
