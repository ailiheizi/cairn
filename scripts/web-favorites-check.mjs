import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "../web/node_modules/esbuild/lib/main.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cairn-favorites-check-"));
const entry = path.join(root, "web/src/app/useFavorites.ts");
const output = path.join(tempDir, "useFavorites.mjs");
try {
  await build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    plugins: [{
      name: "stub-unused-hook-runtime",
      setup(plugin) {
        plugin.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "cairn-test" }));
        plugin.onLoad({ filter: /^react$/, namespace: "cairn-test" }, () => ({ contents: "export const useCallback = (fn) => fn; export const useRef = (current) => ({ current }); export const useState = (current) => [current, () => {}];", loader: "js" }));
        plugin.onResolve({ filter: /\/command$/ }, () => ({ path: "command", namespace: "cairn-test" }));
        plugin.onLoad({ filter: /^command$/, namespace: "cairn-test" }, () => ({ contents: "export const command = async () => { throw new Error('hook runtime is not used by pure checks'); };", loader: "js" }));
        plugin.onResolve({ filter: /\/lib\/operations$/ }, () => ({ path: "operations", namespace: "cairn-test" }));
        plugin.onLoad({ filter: /^operations$/, namespace: "cairn-test" }, () => ({ contents: "export const operations = {};", loader: "js" }));
      },
    }],
  });
  const { planFavoriteMutation } = await import(pathToFileURL(output));
  const rows = [
    { annotation_id: "fav-a", subject_ref: "subject:1", kind: "TAG", body: "Favorite", revision: 3 },
    { annotation_id: "fav-b", subject_ref: "subject:1", kind: "TAG", body: " Favorite ", revision: 8 },
    { annotation_id: "other-tag", subject_ref: "subject:1", kind: "TAG", body: "Family", revision: 2 },
    { annotation_id: "note", subject_ref: "subject:1", kind: "NOTE", body: "Favorite", revision: 5 },
    { annotation_id: "other-subject", subject_ref: "subject:2", kind: "TAG", body: "Favorite", revision: 9 },
    { annotation_id: "dead", subject_ref: "subject:1", kind: "TAG", body: "Favorite", revision: 2, tombstoned: true },
  ];

  assert.deepEqual(planFavoriteMutation([], "subject:1"), { kind: "add", subjectRef: "subject:1" });
  assert.deepEqual(planFavoriteMutation(rows, " subject:1 "), {
    kind: "remove",
    subjectRef: "subject:1",
    annotations: [
      { annotationID: "fav-a", expectedRevision: 3 },
      { annotationID: "fav-b", expectedRevision: 8 },
    ],
  }, "removing Favorite must tombstone every active exact matching tag and preserve unrelated annotations");
  assert.throws(() => planFavoriteMutation([{ ...rows[0], revision: undefined }], "subject:1"), /identity or revision/,
    "a duplicate without concurrency identity must fail closed before any delete begins");
  for (const revision of [0, -1, 1.5]) {
    assert.throws(() => planFavoriteMutation([{ ...rows[0], revision }], "subject:1"), /identity or revision/,
      `existing annotations must reject invalid expected revision ${revision}`);
  }
  assert.throws(() => planFavoriteMutation([], "  "), /stable subject/);
  console.log("PASS: favorite tag scope, duplicate removal plan, revision fence, and invalid-subject checks");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
