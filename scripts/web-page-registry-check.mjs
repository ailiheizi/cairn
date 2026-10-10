import assert from "node:assert/strict";
import { build } from "../web/node_modules/esbuild/lib/main.js";

const bundle = await build({
  entryPoints: ["web/src/lib/libraryViews.ts", "web/src/lib/hashView.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outdir: "virtual",
  write: false,
});
async function load(entry) {
  const file = bundle.outputFiles.find((candidate) => candidate.path.endsWith(`/${entry}.js`));
  assert.ok(file, `compiled ${entry} module exists`);
  return import(`data:text/javascript;base64,${Buffer.from(file.text).toString("base64")}`);
}
const pages = await load("libraryViews");
const hashes = await load("hashView");
const photo = pages.libraryPages.find((page) => page.id === "cairn:photos");
const music = pages.libraryPages.find((page) => page.id === "cairn:music");
const exhibition = pages.libraryPages.find((page) => page.id === "cairn:exhibition");
const overview = pages.libraryPages.find((page) => page.id === "cairn:overview");
assert.ok(photo && music && exhibition, "photo and music domains and the nested exhibition presentation are registered");
assert.equal(photo.presentationOf, undefined, "Photos remains the root domain entry");
assert.equal(photo.presentationLabel, "Photo wall", "the Photos renderer has its own settings/navigation label");
assert.equal(exhibition.mode, "page:cairn:exhibition");
assert.equal(exhibition.presentationOf, photo.id, "Exhibition is a presentation within Photos");
assert.equal(exhibition.presentationLabel, "Exhibition");
assert.equal(exhibition.context, "loaded-library");
assert.equal(exhibition.chrome, "immersive", "the page may declare the shell chrome it needs");
assert.doesNotThrow(() => pages.validateLibraryPages(pages.libraryPages));
assert.equal(pages.libraryPageRoot(exhibition)?.id, photo.id);
assert.equal(pages.libraryPageRoot(photo)?.id, photo.id);
assert.ok(overview && overview.navigationKind === "layout" && overview.mediaClass === "all", "Overview is an all-types layout, not an extra media domain");
const allGroups = pages.enabledLibraryPageGroups(pages.allLibraryPageIds);
assert.deepEqual(allGroups.map((group) => [group.root.id, group.presentations.map((page) => page.id)]), [
  [photo.id, [photo.id, exhibition.id]],
  [music.id, [music.id]],
  [overview.id, [overview.id]],
]);
const exhibitOnlyGroups = pages.enabledLibraryPageGroups(new Set([music.id, exhibition.id]));
assert.deepEqual(exhibitOnlyGroups.map((group) => [group.root.id, group.presentations.map((page) => page.id)]), [
  [photo.id, [exhibition.id]],
  [music.id, [music.id]],
], "an enabled child keeps its root domain navigable when the root renderer is disabled");
assert.equal(pages.enabledLibraryPageGroups(new Set()).length, 0, "domains with no enabled renderers are hidden");
assert.throws(() => pages.validateLibraryPages([...pages.libraryPages, { ...exhibition, id: "cairn:orphan", mode: "page:cairn:orphan", route: "orphan", slot: "page.cairn.orphan", presentationOf: "cairn:missing" }]), /parent is not registered/);
assert.throws(() => pages.validateLibraryPages([...pages.libraryPages, { ...exhibition, id: "cairn:self", mode: "page:cairn:self", route: "self", slot: "page.cairn.self", presentationOf: "cairn:self" }]), /cannot reference itself/);
assert.throws(() => pages.validateLibraryPages([...pages.libraryPages, { ...exhibition, id: "cairn:nested", mode: "page:cairn:nested", route: "nested", slot: "page.cairn.nested", presentationOf: exhibition.id }]), /cannot be nested/);
assert.throws(() => pages.validateLibraryPages(pages.libraryPages.map((page) => page.id === exhibition.id ? { ...page, mediaClass: "audio" } : page)), /share its root context and media class/);
assert.throws(() => pages.validateLibraryPages(pages.libraryPages.map((page) => page.id === exhibition.id ? { ...page, context: "other-context" } : page)), /share its root context and media class/);
assert.doesNotThrow(() => pages.validateLibraryRendererIDs(pages.libraryPages, pages.libraryPages.map((page) => page.id)));
assert.throws(() => pages.validateLibraryRendererIDs(pages.libraryPages, [photo.id, music.id, music.id]), /Duplicate.*renderer ID/);
assert.throws(() => pages.validateLibraryRendererIDs(pages.libraryPages, [photo.id, music.id]), /Missing.*renderer/);
assert.throws(() => pages.validateLibraryRendererIDs(pages.libraryPages, [...pages.libraryPages.map((page) => page.id), "cairn:unknown"]), /no registered library page/);
assert.throws(() => pages.validateLibraryPages(pages.libraryPages.map((page) => page.id === overview.id ? { ...page, mediaClass: "image" } : page)), /all-types roots/);
assert.throws(() => pages.validateLibraryPages(pages.libraryPages.map((page) => page.id === overview.id ? { ...page, navigationKind: "plugin" } : page)), /navigation kind/);
assert.throws(() => pages.validateLibraryPages([...pages.libraryPages, { ...exhibition }]), /Duplicate library page ID/);
assert.throws(() => pages.validateLibraryPages([...pages.libraryPages, { ...exhibition, id: "cairn:extra" }]), /Duplicate library page route/);
assert.throws(() => pages.validateLibraryPages([...pages.libraryPages, { ...exhibition, id: "cairn:extra", route: "extra", slot: photo.slot }]), /Duplicate library page slot/);
assert.throws(() => pages.validateLibraryPages([{ ...exhibition, route: "settings" }]), /reserved or invalid/);
assert.throws(() => pages.validateLibraryPages([{ ...exhibition, mode: "notes" }]), /reserved/);
assert.throws(() => pages.validateLibraryPages([{ ...exhibition, id: "cairn:settings" }]), /ID is reserved/);
assert.throws(() => pages.validateLibraryPages([{ ...exhibition, slot: "host.navigation" }]), /slot is reserved/);
assert.equal(pages.resolveLibraryPageRoute("exhibition", pages.allLibraryPageIds), exhibition.mode);
assert.equal(pages.resolveLibraryPageRoute("exhibition", new Set([photo.id, music.id])), "content");
assert.equal(pages.resolveLibraryPageRoute("missing", pages.allLibraryPageIds), "content");
for (const [route, mode] of [["photos", "photos"], ["music", "music"], ["exhibition", exhibition.mode], ["overview", overview.mode]]) {
  const restored = hashes.parseHashView(`#v=${route}`);
  assert.equal(restored.mode, "content", `${route} deep link restores the loaded-content scope`);
  assert.equal(restored.presentation, mode, `${route} deep link keeps its presentation mapping`);
}
assert.equal(hashes.parseHashView("#v=page%3Acairn%3Aexhibition").presentation, exhibition.mode, "canonical namespaced mode remains a valid presentation deep link");
assert.equal(hashes.parseHashView("#v=not-registered").mode, "", "unknown route falls back to the default content view");
let replacedHash = "";
globalThis.window = { location: { pathname: "/", search: "" }, history: { replaceState: (_state, _title, url) => { replacedHash = String(url); } } };
hashes.writeHashView({ mode: exhibition.mode, q: "", tags: [], month: "" });
assert.equal(replacedHash, "/#v=exhibition", "namespaced pages write the stable short route, not internal subject state");
console.log("PASS: compiled page IDs, routes and slots reject conflicts; legacy aliases and exhibition deep links resolve; disabled and unknown routes fall back to content.");
