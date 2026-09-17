// i18n catalog check.
//
// The browser catalogs are split per surface under `web/src/i18n/`. This script
// proves the split lost nothing, changed no translation, and kept every key in
// exactly one partial. It parses the plain object literals directly (no build
// step, no dependency) and fails closed on any mismatch.
//
// Usage:
//   node scripts/web-i18n-check.mjs                          # self-check
//   node scripts/web-i18n-check.mjs --baseline <catalog.ts>  # compare to a
//                                                            # pre-split catalog
//
// `--baseline` accepts either a merged catalog file (the old `i18n.ts`) or a
// directory of partials; the comparison is on the flattened key -> zh-CN value
// map, so it is independent of key order.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const dirArg = takeFlag("--dir") ?? path.join(root, "web/src/i18n");
const baselineArg = takeFlag("--baseline");

function takeFlag(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  assert(value, `${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// Reads the first plain object literal assigned in a TypeScript source file.
// The catalogs contain only string keys and string values, so evaluating the
// literal is exact: there is no expression, spread, or reference to resolve.
function readCatalog(file) {
  const source = fs.readFileSync(file, "utf8");
  const assignment = source.match(/=\s*\{/g);
  if (!assignment) fail(`${file}: no object literal assignment found`);
  const open = source.indexOf("{", source.indexOf(assignment[assignment.length - 1]));
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  assert(end > open, `${file}: object literal is not closed`);
  const literal = source.slice(open, end + 1);
  const catalog = new Function(`return (${literal})`)();
  for (const [key, value] of Object.entries(catalog)) {
    assert(typeof key === "string" && key.length > 0, `${file}: empty message key`);
    assert(typeof value === "string", `${file}: translation for ${JSON.stringify(key)} is not a string`);
  }
  return catalog;
}

function readCatalogs(dir) {
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".ts")).sort();
  assert(files.length > 0, `${dir}: no catalog partials found`);
  const catalogs = new Map();
  for (const name of files) catalogs.set(name, readCatalog(path.join(dir, name)));
  return catalogs;
}

function flatten(catalogs) {
  const merged = new Map();
  const owners = new Map();
  for (const [name, catalog] of catalogs) {
    for (const [key, value] of Object.entries(catalog)) {
      if (merged.has(key)) fail(`duplicate message key ${JSON.stringify(key)} in ${owners.get(key)} and ${name}`);
      merged.set(key, value);
      owners.set(key, name);
    }
  }
  return merged;
}

// The merged catalog must import every partial in the directory, so adding a
// partial file cannot silently drop it from the app.
function checkMergeImports(dir, catalogs) {
  const merged = readFileSyncExact(path.join(root, "web/src/i18n.ts")).match(/from "\.\/i18n\/([a-zA-Z0-9_-]+)"/g) ?? [];
  const imported = new Set(merged.map((entry) => `${entry.slice(entry.lastIndexOf("/") + 1, -1)}.ts`));
  for (const name of catalogs.keys()) {
    if (name === "index.ts") continue;
    if (!imported.has(name)) fail(`web/src/i18n.ts does not import web/src/i18n/${name}`);
  }
}

function readFileSyncExact(file) {
  assert(fs.existsSync(file), `${file}: not found`);
  return fs.readFileSync(file, "utf8");
}

const catalogs = readCatalogs(dirArg);
checkMergeImports(dirArg, catalogs);
const merged = flatten(catalogs);

const counts = [...catalogs.entries()].map(([name, catalog]) => `${name}:${Object.keys(catalog).length}`).join(" ");
console.log(`partials ${catalogs.size} (${counts})`);
console.log(`merged keys ${merged.size}`);

if (baselineArg) {
  const baselineFile = path.resolve(baselineArg);
  const baselineStat = fs.statSync(baselineFile);
  const baseline = baselineStat.isDirectory()
    ? flatten(readCatalogs(baselineFile))
    : new Map(Object.entries(readCatalog(baselineFile)));
  const lost = [...baseline.keys()].filter((key) => !merged.has(key));
  const added = [...merged.keys()].filter((key) => !baseline.has(key));
  const changed = [...baseline.keys()].filter((key) => merged.has(key) && merged.get(key) !== baseline.get(key));
  for (const key of lost) console.error(`  lost: ${JSON.stringify(key)}`);
  for (const key of changed) {
    console.error(`  changed: ${JSON.stringify(key)}`);
    console.error(`    before: ${JSON.stringify(baseline.get(key))}`);
    console.error(`    after:  ${JSON.stringify(merged.get(key))}`);
  }
  if (lost.length || changed.length) {
    fail(`baseline mismatch: lost ${lost.length}, changed ${changed.length}`);
  }
  // Added keys are new strings for a surface that did not exist in the
  // baseline; they are reported, never silently accepted as a translation
  // change of an existing key.
  if (added.length) {
    console.log(`baseline ${baselineFile}: ${baseline.size} keys, 0 lost, 0 changed, ${added.length} added:`);
    for (const key of added) console.log(`  added: ${JSON.stringify(key)}`);
  } else {
    console.log(`baseline ${baselineFile}: ${baseline.size} keys, 0 lost, 0 changed, 0 added`);
  }
}

console.log("PASS: i18n catalogs are complete and duplicate-free");
