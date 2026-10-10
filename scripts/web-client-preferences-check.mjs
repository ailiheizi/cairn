// Contract checks for the compiled library slots and browser-only preferences.
// This does not load a plugin runtime or exercise content/recovery providers.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "../web/node_modules/typescript/lib/typescript.js";

async function sourceModule(name) {
  const source = await readFile(new URL(`../web/src/lib/${name}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const linkedOutput = outputText.replace(/from ["']\.\/interfaceCatalog["']/g, `from "${await sourceModuleURL("interfaceCatalog")}"`);
  return import(`data:text/javascript;base64,${Buffer.from(linkedOutput).toString("base64")}`);
}

async function sourceModuleURL(name) {
  const source = await readFile(new URL(`../web/src/lib/${name}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}
const shells = await sourceModule("interfaceCatalog");
assert.doesNotThrow(() => shells.validateInterfaces(shells.interfaceCatalog));
const [workspace, showcaseShell] = shells.interfaceCatalog;
assert.throws(() => shells.validateInterfaces([workspace, { ...showcaseShell, id: workspace.id }]), /Duplicate interface ID/);
assert.throws(() => shells.validateInterfaces([workspace, { ...showcaseShell, renderSlot: workspace.renderSlot }]), /renderer slot/);
assert.throws(() => shells.validateInterfaces([showcaseShell]), /fallback/);
assert.throws(() => shells.validateInterfaces([workspace, { ...showcaseShell, renderSlot: "host.navigation" }]), /reserved host/);
assert.equal(shells.normalizeInterfaceId("missing:interface"), "workspace");
assert.equal(shells.normalizeInterfaceId("showcase"), "showcase");
const views = await sourceModule("libraryViews");
const [photo, audio] = views.libraryViews;
assert.doesNotThrow(() => views.validateLibraryViews(views.libraryViews));
assert.throws(() => views.validateLibraryViews([photo, { ...audio, id: photo.id }]), /Duplicate.*ID/);
assert.throws(() => views.validateLibraryViews([photo, { ...audio, slot: photo.slot }]), /Duplicate.*slot/);
assert.throws(() => views.validateLibraryViews([photo, { ...audio, mode: photo.mode }]), /Duplicate.*mode/);
assert.throws(() => views.validateLibraryViews([{ ...photo, mode: "notes" }]), /reserved/);
for (const mode of ["content", "search", "tags", "notes", "sources", "activity"]) {
  assert.equal(views.isLibraryViewEnabled(mode, new Set()), true, `${mode} remains host-owned`);
}
assert.equal(views.isLibraryViewEnabled("photos", new Set()), false);
assert.equal(views.isLibraryViewEnabled("music", views.allLibraryViewIds), true);

const appearance = await sourceModule("appearance");
const storage = (value) => ({ getItem: () => value, setItem() {}, removeItem() {} });
const denied = {
  getItem() { throw new Error("storage denied"); },
  setItem() { throw new Error("storage denied"); },
  removeItem() { throw new Error("storage denied"); },
};
for (const value of [null, "{", "null", "[]", '{"appearance":"unexpected","themeId":"remote"}']) {
  assert.deepEqual(appearance.readAppearancePreference(storage(value)), appearance.DEFAULT_APPEARANCE);
}
assert.deepEqual(appearance.readAppearancePreference(denied), appearance.DEFAULT_APPEARANCE);
assert.doesNotThrow(() => appearance.writeAppearancePreference(appearance.DEFAULT_APPEARANCE, denied));
assert.doesNotThrow(() => appearance.resetAppearancePreference(denied));
const legacy = appearance.readAppearancePreference(storage('{"appearance":"dark","themeId":"paper"}'));
assert.deepEqual(legacy, { appearance: "dark", themeId: "paper", interfaceId: "workspace" });
const showcase = appearance.readAppearancePreference(storage('{"appearance":"light","themeId":"indigo","interfaceId":"showcase"}'));
assert.deepEqual(showcase, { appearance: "light", themeId: "indigo", interfaceId: "showcase" });
assert.deepEqual(appearance.readAppearancePreference(storage('{"appearance":"dark","themeId":"paper","interfaceId":"unknown"}')), legacy);
let persisted;
appearance.writeAppearancePreference(showcase, { getItem() {}, setItem(key, value) { persisted = [key, JSON.parse(value)]; }, removeItem() {} });
assert.deepEqual(persisted, [appearance.APPEARANCE_STORAGE_KEY, showcase]);
const attributes = new Map();
const root = { setAttribute: (name, value) => attributes.set(name, value) };
appearance.bootstrapAppearance(root, storage('{"appearance":"dark","themeId":"paper"}'), false);
assert.equal(attributes.get("data-appearance"), "dark", "explicit dark overrides a light system");
assert.equal(attributes.get("data-theme"), "paper");
assert.equal(attributes.get("data-interface"), "workspace", "legacy preferences keep the original interface");
appearance.applyAppearancePreference(root, showcase, true);
assert.equal(attributes.get("data-interface"), "showcase");
assert.equal(attributes.get("data-theme"), "indigo");
appearance.bootstrapAppearance(root, storage('{"appearance":"light","themeId":"indigo"}'), true);
assert.equal(attributes.get("data-appearance"), "light", "explicit light overrides a dark system");
appearance.applyAppearancePreference(root, appearance.DEFAULT_APPEARANCE, true);
assert.equal(attributes.get("data-appearance"), "dark");
appearance.applyAppearancePreference(root, appearance.DEFAULT_APPEARANCE, false);
assert.equal(attributes.get("data-appearance"), "light");
console.log("PASS: static slot conflicts, reserved host modes, invalid/denied preferences, legacy/interface fallback and persistence, and explicit/system appearance");
