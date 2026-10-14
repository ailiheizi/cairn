// Browser acceptance check for the admitted presentation-plane extension
// (ADR-032, Stage 2a): themes as pure data.
//
// What it proves, with real browser observation of the built client, in Chrome:
//
//   scenario "valid"      a valid package is admitted and its design tokens
//                         actually reach the rendered document (theme id,
//                         computed custom property, painted text color, painted
//                         card radius, and the swatches drawn from its data);
//   scenario "host-range" a package whose declared host range the running
//                         application does not satisfy is refused whole, the
//                         refusal is visible with its reason, and nothing of it
//                         is applied;
//   scenario "token-key"  a package declaring a token outside the host
//                         allowlist is refused whole, and the legitimate token
//                         beside it is not applied either;
//   scenario "token-value" a package whose value could escape a CSS declaration
//                         or fetch a resource is refused whole, and no request
//                         ever leaves the document origin;
//   scenario "collision"  a package reusing a built-in palette id is refused
//                         whole and never shadows the built-in;
//   scenario "shell"      a package declaring CSS/script-bearing fields is
//                         refused whole rather than partially ignored;
//   scenario "per-appearance" a package declaring one value set per appearance
//                         renders two different sets of token values when the
//                         Color mode control switches light to dark, a token
//                         declared in only one set is removed for the other
//                         appearance, and a package declaring only the original
//                         flat map still applies the same values under both;
//   scenario "per-appearance-refusals" a forbidden value inside one value set, an
//                         unknown key inside one, a half-declared theme, and a
//                         mixture of the flat and per-appearance forms are each
//                         refused whole with no partial application;
//   scenario "absent"     with no index at all nothing is installed, no refusal
//                         is reported, and the built-in palettes stay in charge;
//   scenario "shipped"    the example package shipped in the source tree
//                         (`web/public/presentation-packages/`) is served with
//                         its own bytes and is admitted and applied, so the
//                         reference theme is a real selectable theme and not
//                         only a fixture;
//   the shipped bytes in the source tree and the bytes in the built client are
//   compared and must be identical, which is the proof that a rebuild carries
//   the source packages into the served output instead of relying on a file
//   someone dropped into the build directory.
//
// Build-time refusal (`web/vite.config.ts` fails the build for a package in the
// source directory that fails admission) is deliberately NOT run from here: a
// nested `npm run build` would rewrite `web/dist` while every browser scenario
// is reading it. It is reported below as a manual step with the command and the
// expected failure, so the omission is visible rather than implied.
//
// Every scenario also re-selects all three built-in palettes and checks the
// compiled token each one applies, so a presentation-package failure can never
// be hidden behind a broken built-in theme.
//
// It owns its own temporary web root, its own loopback static file server and
// its own browser process, and removes all three on every exit path. It starts
// no daemon: presentation is a client-side plane, so the client is served the
// built `web/dist` plus one `presentation-packages/` directory the harness
// rewrites per scenario. The daemon's own `--web-root` handler serves the same
// layout (a `.json` miss is a 404, never an HTML fallback), which the
// `web-fixture-seed.mjs` acceptance run covers.
//
// Usage:
//   node scripts/web-presentation-package-check.mjs
//
// Environment:
//   CAIRN_PLAYWRIGHT_EXECUTABLE_PATH         Chrome/Chromium binary
//   CAIRN_PRESENTATION_WEB_ROOT              built client root (default
//                                            <repository>/web/dist)
//
// A failure exits nonzero with the concrete observation that failed. The client
// bundle is not tracked by git; this script never builds it, and refuses loudly
// with the command that produces it.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createReadStream, existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = resolve(process.env.CAIRN_PRESENTATION_WEB_ROOT || join(repo, "web", "dist"));
// The source of truth for shipped packages. The build copies this directory
// into the served output, so the same bytes must appear in both places.
const sourcePackageRoot = join(repo, "web", "public", "presentation-packages");
const chrome = (
  process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
).trim();
const tempPrefix = join(tmpdir(), "cairn-presentation-package-");
const INDEX_SCHEMA = "cairn.presentation-package-index.v1";
const PACKAGE_SCHEMA = "cairn.presentation-package.v1";
// The three compiled palettes and the token each one sets in light appearance.
const BUILT_IN_PALETTES = [
  { id: "slate", canvas: "#edf1f3" },
  { id: "paper", canvas: "#f3ecdf" },
  { id: "indigo", canvas: "#efedfa" },
];
const BUILT_IN_CARD_RADIUS = "16px";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

const observed = { scenarios: {}, builtInChecks: [], shippedBytes: [] };
let failure;
let browser;
let server;
let temp;
let baseURL = "";

function require(condition, message) {
  if (!condition) throw new Error(message);
}

/** One metadata-only static server: the built client, plus the harness overlay
 *  for `/presentation-packages/…`. A miss is a 404, exactly like the daemon's
 *  `--web-root` handler, so "no packages installed" is one ordinary absence. */
function startStaticServer(clientRoot, overlayRoot) {
  const instance = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    const relative = (pathname === "/" ? "/index.html" : pathname).replace(/^\/+/, "");
    const fromOverlay = relative.startsWith("presentation-packages/");
    const root = fromOverlay ? overlayRoot : clientRoot;
    const file = resolve(root, relative);
    const inside = file === root || file.startsWith(root + sep);
    let info;
    if (inside) {
      try { info = await stat(file); } catch { info = undefined; }
    }
    if (!info?.isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
      "content-length": info.size,
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolveListen, rejectListen) => {
    instance.once("error", rejectListen);
    instance.listen(0, "127.0.0.1", () => resolveListen(instance));
  });
}

/** Directories under the temporary root are the only paths this script removes. */
function requireOwned(path, label) {
  require(path.startsWith(tempPrefix) && path !== tempPrefix, `refusing to ${label} ${path}: it is not inside this script's temporary directory`);
  return path;
}

async function writeFixture(packagesDirectory, index, documents = {}) {
  await rm(requireOwned(packagesDirectory, "rewrite"), { recursive: true, force: true });
  await mkdir(packagesDirectory, { recursive: true });
  if (index) await writeFile(join(packagesDirectory, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  for (const [name, document] of Object.entries(documents)) {
    await writeFile(join(packagesDirectory, name), `${JSON.stringify(document, null, 2)}\n`);
  }
}

/** A fresh context per scenario: no stored preference, no cache, deterministic
 *  light appearance, and a record of every request that left the origin. */
async function openClient() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", colorScheme: "light" });
  const page = await context.newPage();
  const external = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) external.push(request.url());
  });
  await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
  await page.locator(".app-shell").waitFor({ state: "visible", timeout: 30000 });
  return { context, page, external };
}

async function openAppearance(page) {
  await page.getByRole("button", { name: /Open settings|打开设置/ }).first().click();
  const settings = page.getByRole("dialog", { name: /Settings|设置/ });
  await settings.waitFor({ state: "visible", timeout: 15000 });
  await settings.getByRole("button", { name: /Appearance|外观/ }).first().click();
  await page.locator(".appearance-preferences").waitFor({ state: "visible", timeout: 10000 });
  if (!await page.locator(".appearance-colors").evaluate((element) => element.open)) {
    await page.locator(".appearance-colors > summary").click();
  }
}

async function readAppearance(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const computed = getComputedStyle(root);
    const settingsPage = document.querySelector(".settings-page");
    return {
      theme: root.getAttribute("data-theme"),
      appearance: root.getAttribute("data-appearance"),
      colorScheme: computed.colorScheme,
      canvas: computed.getPropertyValue("--canvas").trim(),
      ink: computed.getPropertyValue("--ink").trim(),
      primary: computed.getPropertyValue("--primary").trim(),
      gold: computed.getPropertyValue("--gold").trim(),
      coral: computed.getPropertyValue("--coral").trim(),
      cardRadius: computed.getPropertyValue("--card-radius").trim(),
      paintedText: computed.color,
      paintedRadius: settingsPage ? getComputedStyle(settingsPage).borderTopLeftRadius : "",
      paintedSurface: document.querySelector(".app-shell") ? getComputedStyle(document.querySelector(".app-shell")).backgroundColor : "",
      paintedInk: document.querySelector(".app-shell") ? getComputedStyle(document.querySelector(".app-shell")).color : "",
      paintedThemeCardRadius: document.querySelector(".appearance-theme-option .appearance-theme-card")
        ? getComputedStyle(document.querySelector(".appearance-theme-option .appearance-theme-card")).borderTopLeftRadius
        : "",
      palette: [...document.querySelectorAll(".appearance-theme-option")].map((label) => ({
        id: label.querySelector("input")?.value ?? "",
        name: label.querySelector("strong")?.textContent?.trim() ?? "",
        swatches: [...label.querySelectorAll(".appearance-swatches i")].map((swatch) => getComputedStyle(swatch).backgroundColor),
      })),
      selected: [...document.querySelectorAll('input[name="cairn-theme-palette"]')].filter((input) => input.checked).map((input) => input.value),
      refusals: [...document.querySelectorAll(".appearance-package-refusals p")].map((line) => line.textContent.replace(/\s+/g, " ").trim()),
      installNote: document.querySelector(".appearance-colors .appearance-storage-note")?.textContent?.trim() ?? "",
    };
  });
}

/** `#rrggbb` as the `rgb(r, g, b)` a computed style paints it with. */
function rgbOf(value) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  require(match, `cannot turn ${JSON.stringify(value)} into a painted rgb() colour`);
  return `rgb(${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)})`;
}

/** A package's `tokens` is either one flat value set or one per appearance. */
function declaresAppearances(tokens) {
  return Boolean(tokens) && typeof tokens === "object"
    && (Object.prototype.hasOwnProperty.call(tokens, "light") || Object.prototype.hasOwnProperty.call(tokens, "dark"));
}

/** The value set one appearance selects; a flat declaration applies under both. */
function declaredValues(tokens, appearance) {
  const selected = tokens && typeof tokens === "object" && !Array.isArray(tokens) ? tokens[appearance] : undefined;
  return selected && typeof selected === "object" && !Array.isArray(selected) ? selected : tokens;
}

/** Switch the Color mode control and wait for the effective appearance to land. */
async function setAppearanceMode(page, mode) {
  await page.locator(`input[name="cairn-appearance-mode"][value=${JSON.stringify(mode)}]`).check();
  await page.waitForFunction(
    (value) => document.documentElement.getAttribute("data-appearance") === value,
    mode,
    { timeout: 8000 },
  );
}

async function waitForPaletteOption(page, id) {
  await page.waitForFunction(
    (value) => [...document.querySelectorAll('input[name="cairn-theme-palette"]')].some((input) => input.value === value),
    id,
    { timeout: 10000 },
  );
}

async function selectTheme(page, id) {
  await page.locator(`input[name="cairn-theme-palette"][value=${JSON.stringify(id)}]`).check();
  await page.waitForFunction(
    (value) => document.documentElement.getAttribute("data-theme") === value,
    id,
    { timeout: 8000 },
  );
}

/** The built-in palettes must work identically in every scenario. */
async function checkBuiltInPalettes(page, scenario) {
  const seen = [];
  for (const palette of BUILT_IN_PALETTES) {
    await selectTheme(page, palette.id);
    const read = await readAppearance(page);
    assert.equal(read.theme, palette.id, `${scenario}: selecting ${palette.id} sets data-theme`);
    assert.equal(read.canvas, palette.canvas, `${scenario}: ${palette.id} applies its compiled --canvas, observed ${JSON.stringify(read.canvas)}`);
    assert.equal(read.cardRadius, BUILT_IN_CARD_RADIUS, `${scenario}: ${palette.id} keeps the compiled --card-radius`);
    seen.push(`${palette.id}=${palette.canvas}`);
  }
  observed.builtInChecks.push(`${scenario}: ${seen.join(", ")}`);
  return seen;
}

function validTokens(canvas, ink) {
  return { "--canvas": canvas, "--ink": ink, "--primary": "#2f5d8a", "--card-radius": "4px" };
}

async function scenarioValidPackage(packagesDirectory, declaredVersion) {
  const id = "acceptance:aurora-substrate";
  const name = "Aurora Substrate";
  await writeFixture(packagesDirectory, {
    schema: INDEX_SCHEMA,
    packages: ["aurora.json"],
  }, {
    "aurora.json": {
      schema: PACKAGE_SCHEMA,
      id,
      name,
      hostRange: `>=${declaredVersion} <9.0.0`,
      swatches: ["#f4f8ff", "#2f5d8a", "#0f2b46"],
      tokens: validTokens("#f4f8ff", "#0f2b46"),
    },
  });
  const { context, page, external } = await openClient();
  try {
    await openAppearance(page);
    await waitForPaletteOption(page, id);
    const offered = await readAppearance(page);
    const option = offered.palette.find((entry) => entry.id === id);
    assert.ok(option, `valid: the admitted package is offered in the palette picker, observed ${JSON.stringify(offered.palette.map((entry) => entry.id))}`);
    assert.equal(option.name, name, `valid: the picker shows the package's own name, observed ${JSON.stringify(option.name)}`);
    assert.equal(option.swatches.length, 3, `valid: the picker draws the package's swatches, observed ${JSON.stringify(option.swatches)}`);
    assert.equal(option.swatches[0], "rgb(244, 248, 255)", `valid: the first swatch is the declared colour, observed ${JSON.stringify(option.swatches[0])}`);
    assert.deepEqual(offered.refusals, [], `valid: a valid package produces no refusal`);

    await selectTheme(page, id);
    const read = await readAppearance(page);
    assert.equal(read.theme, id, `valid: the installed id becomes data-theme, observed ${JSON.stringify(read.theme)}`);
    assert.equal(read.canvas, "#f4f8ff", `valid: the declared --canvas reaches the document, observed ${JSON.stringify(read.canvas)}`);
    assert.equal(read.ink, "#0f2b46", `valid: the declared --ink reaches the document, observed ${JSON.stringify(read.ink)}`);
    assert.equal(read.paintedText, "rgb(15, 43, 70)", `valid: the declared --ink is what the page actually paints text with, observed ${JSON.stringify(read.paintedText)}`);
    assert.equal(read.cardRadius, "4px", `valid: the declared --card-radius reaches the document, observed ${JSON.stringify(read.cardRadius)}`);
    assert.equal(read.paintedRadius, "4px", `valid: the declared --card-radius is what the settings surface actually renders, observed ${JSON.stringify(read.paintedRadius)}`);
    observed.scenarios.valid = { id, name, adopted: { theme: read.theme, canvas: read.canvas, paintedText: read.paintedText, paintedRadius: read.paintedRadius }, swatches: option.swatches };

    await checkBuiltInPalettes(page, "valid");
    assert.deepEqual(external, [], "valid: loading and applying a package requests nothing outside the document origin");
  } finally {
    await context.close();
  }
}

async function scenarioHostRangeRefused(packagesDirectory, declaredVersion) {
  const id = "acceptance:future-only";
  await writeFixture(packagesDirectory, {
    schema: INDEX_SCHEMA,
    packages: ["future.json"],
  }, {
    "future.json": {
      schema: PACKAGE_SCHEMA,
      id,
      name: "Future Only",
      hostRange: ">=9.0.0",
      swatches: ["#123456"],
      tokens: validTokens("#123456", "#123456"),
    },
  });
  const { context, page } = await openClient();
  try {
    await openAppearance(page);
    // The refusal is the page's answer; wait for it rather than for an option
    // that must never appear.
    await page.locator(".appearance-package-refusals p").first().waitFor({ state: "visible", timeout: 10000 });
    const read = await readAppearance(page);
    assert.equal(read.refusals.length, 1, `host-range: exactly one refusal is visible, observed ${JSON.stringify(read.refusals)}`);
    const [reason] = read.refusals;
    assert.ok(reason.includes(id), `host-range: the refusal names the package, observed ${JSON.stringify(reason)}`);
    assert.ok(reason.includes(declaredVersion), `host-range: the refusal names the running application version ${declaredVersion}, observed ${JSON.stringify(reason)}`);
    assert.ok(reason.includes(">=9.0.0"), `host-range: the refusal names the declared range, observed ${JSON.stringify(reason)}`);
    assert.ok(!read.palette.some((entry) => entry.id === id), `host-range: the refused package is not offered, observed ${JSON.stringify(read.palette.map((entry) => entry.id))}`);
    assert.ok(!read.selected.includes(id), `host-range: the refused package is not selected, observed ${JSON.stringify(read.selected)}`);
    assert.equal(read.theme, "slate", `host-range: the built-in default stays in charge, observed ${JSON.stringify(read.theme)}`);
    assert.equal(read.canvas, "#edf1f3", `host-range: no token of the refused package is applied, observed ${JSON.stringify(read.canvas)}`);
    assert.equal(read.cardRadius, BUILT_IN_CARD_RADIUS, `host-range: no layout token of the refused package is applied, observed ${JSON.stringify(read.cardRadius)}`);
    observed.scenarios.hostRange = { reason, theme: read.theme, canvas: read.canvas, palette: read.palette.map((entry) => entry.id) };

    await checkBuiltInPalettes(page, "host-range");
  } finally {
    await context.close();
  }
}

async function scenarioTokenKeyRefused(packagesDirectory, declaredVersion) {
  const id = "acceptance:bad-key";
  await writeFixture(packagesDirectory, {
    schema: INDEX_SCHEMA,
    packages: ["bad-key.json"],
  }, {
    "bad-key.json": {
      schema: PACKAGE_SCHEMA,
      id,
      name: "Bad Key",
      hostRange: `>=${declaredVersion}`,
      swatches: ["#101010"],
      tokens: { "--canvas": "#010203", "--overlay-position": "fixed" },
    },
  });
  const { context, page } = await openClient();
  try {
    await openAppearance(page);
    await page.locator(".appearance-package-refusals p").first().waitFor({ state: "visible", timeout: 10000 });
    const read = await readAppearance(page);
    assert.equal(read.refusals.length, 1, `token-key: exactly one refusal is visible, observed ${JSON.stringify(read.refusals)}`);
    const [reason] = read.refusals;
    assert.ok(reason.includes("--overlay-position"), `token-key: the refusal names the unadmitted token, observed ${JSON.stringify(reason)}`);
    assert.ok(reason.includes("not an admitted design token"), `token-key: the refusal states the allowlist rule, observed ${JSON.stringify(reason)}`);
    assert.ok(!read.palette.some((entry) => entry.id === id), `token-key: the refused package is not offered, observed ${JSON.stringify(read.palette.map((entry) => entry.id))}`);
    // The whole package is refused: the admissible --canvas beside the bad key
    // must not be applied either.
    assert.equal(read.canvas, "#edf1f3", `token-key: the package's admissible token is not applied either, observed ${JSON.stringify(read.canvas)}`);
    observed.scenarios.tokenKey = { reason, canvas: read.canvas };

    await checkBuiltInPalettes(page, "token-key");
  } finally {
    await context.close();
  }
}

async function scenarioTokenValueRefused(packagesDirectory, declaredVersion) {
  const escapeID = "acceptance:escape-value";
  const remoteID = "acceptance:remote-value";
  await writeFixture(packagesDirectory, {
    schema: INDEX_SCHEMA,
    packages: ["escape.json", "remote.json"],
  }, {
    "escape.json": {
      schema: PACKAGE_SCHEMA,
      id: escapeID,
      name: "Escape Value",
      hostRange: `>=${declaredVersion}`,
      swatches: ["#202020"],
      tokens: { "--card-radius": "4px", "--canvas": "#ffffff; position: fixed; inset: 0" },
    },
    "remote.json": {
      schema: PACKAGE_SCHEMA,
      id: remoteID,
      name: "Remote Value",
      hostRange: `>=${declaredVersion}`,
      swatches: ["#303030"],
      tokens: { "--ink": "url(https://presentation-package.invalid/tracker.png)" },
    },
  });
  const { context, page, external } = await openClient();
  try {
    await openAppearance(page);
    await page.waitForFunction(() => document.querySelectorAll(".appearance-package-refusals p").length === 2, undefined, { timeout: 10000 });
    const read = await readAppearance(page);
    assert.equal(read.refusals.length, 2, `token-value: both declarations are refused, observed ${JSON.stringify(read.refusals)}`);
    const escapeReason = read.refusals.find((line) => line.includes(escapeID));
    const remoteReason = read.refusals.find((line) => line.includes(remoteID));
    assert.ok(escapeReason && escapeReason.includes("--canvas") && escapeReason.includes("escape a CSS declaration"), `token-value: the declaration-terminating value is refused by name and reason, observed ${JSON.stringify(escapeReason)}`);
    assert.ok(remoteReason && remoteReason.includes("--ink") && remoteReason.includes("escape a CSS declaration"), `token-value: the fetching value is refused by name and reason, observed ${JSON.stringify(remoteReason)}`);
    assert.ok(!read.palette.some((entry) => entry.id === escapeID || entry.id === remoteID), `token-value: neither refused package is offered, observed ${JSON.stringify(read.palette.map((entry) => entry.id))}`);
    assert.equal(read.canvas, "#edf1f3", `token-value: the escape package's admissible --card-radius is not applied either, observed ${JSON.stringify(read.canvas)}`);
    assert.equal(read.cardRadius, BUILT_IN_CARD_RADIUS, `token-value: no partial application from a refused package, observed ${JSON.stringify(read.cardRadius)}`);
    assert.deepEqual(external, [], `token-value: a fetching value never causes a request, observed ${JSON.stringify(external)}`);
    observed.scenarios.tokenValue = { refusals: read.refusals, externalRequests: external, cardRadius: read.cardRadius };

    await checkBuiltInPalettes(page, "token-value");
  } finally {
    await context.close();
  }
}

async function scenarioCollisionRefused(packagesDirectory, declaredVersion) {
  await writeFixture(packagesDirectory, {
    schema: INDEX_SCHEMA,
    packages: ["shadow.json"],
  }, {
    "shadow.json": {
      schema: PACKAGE_SCHEMA,
      id: "slate",
      name: "Slate Shadow",
      hostRange: `>=${declaredVersion}`,
      swatches: ["#ff00ff"],
      tokens: validTokens("#ff00ff", "#ff00ff"),
    },
  });
  const { context, page } = await openClient();
  try {
    await openAppearance(page);
    await page.locator(".appearance-package-refusals p").first().waitFor({ state: "visible", timeout: 10000 });
    const read = await readAppearance(page);
    assert.equal(read.refusals.length, 1, `collision: exactly one refusal is visible, observed ${JSON.stringify(read.refusals)}`);
    const [reason] = read.refusals;
    assert.ok(reason.includes("slate"), `collision: the refusal names the colliding id, observed ${JSON.stringify(reason)}`);
    assert.ok(reason.includes("already in use"), `collision: the refusal states the collision, observed ${JSON.stringify(reason)}`);
    assert.deepEqual(read.palette.map((entry) => entry.id), BUILT_IN_PALETTES.map((palette) => palette.id), `collision: the picker still offers exactly the three built-ins, observed ${JSON.stringify(read.palette.map((entry) => entry.id))}`);
    assert.equal(read.canvas, "#edf1f3", `collision: the built-in palette is not shadowed, observed ${JSON.stringify(read.canvas)}`);
    observed.scenarios.collision = { reason, palette: read.palette.map((entry) => entry.id), canvas: read.canvas };

    await checkBuiltInPalettes(page, "collision");
  } finally {
    await context.close();
  }
}

async function scenarioCodeFieldsRefused(packagesDirectory, declaredVersion) {
  const id = "acceptance:has-css";
  await writeFixture(packagesDirectory, {
    schema: INDEX_SCHEMA,
    packages: ["css.json"],
  }, {
    "css.json": {
      schema: PACKAGE_SCHEMA,
      id,
      name: "Has CSS",
      hostRange: `>=${declaredVersion}`,
      swatches: ["#404040"],
      tokens: { "--canvas": "#0a0b0c" },
      css: "body { position: fixed; inset: 0 }",
      script: "window.cairn = {}",
    },
  });
  const { context, page } = await openClient();
  try {
    await openAppearance(page);
    await page.locator(".appearance-package-refusals p").first().waitFor({ state: "visible", timeout: 10000 });
    const read = await readAppearance(page);
    const [reason] = read.refusals;
    assert.equal(read.refusals.length, 1, `shell: a package carrying CSS/script fields is refused once, observed ${JSON.stringify(read.refusals)}`);
    assert.ok(reason.includes("unknown field"), `shell: the refusal states that the code-bearing field is not admitted, observed ${JSON.stringify(reason)}`);
    assert.ok(!read.palette.some((entry) => entry.id === id), `shell: the refused package is not offered, observed ${JSON.stringify(read.palette.map((entry) => entry.id))}`);
    assert.equal(read.canvas, "#edf1f3", `shell: nothing of the refused package is applied, observed ${JSON.stringify(read.canvas)}`);
    const globals = await page.evaluate(() => typeof window.cairn);
    assert.equal(globals, "undefined", `shell: no script content from a package ever ran, observed window.cairn=${globals}`);
    observed.scenarios.shell = { reason, canvas: read.canvas, windowCairn: globals };

    await checkBuiltInPalettes(page, "shell");
  } finally {
    await context.close();
  }
}

async function scenarioNothingInstalled(packagesDirectory) {
  await rm(requireOwned(packagesDirectory, "remove"), { recursive: true, force: true });
  const { context, page, external } = await openClient();
  try {
    await openAppearance(page);
    // Give the startup fetch the same window every other scenario had.
    await page.waitForTimeout(500);
    const read = await readAppearance(page);
    assert.deepEqual(read.palette.map((entry) => entry.id), BUILT_IN_PALETTES.map((palette) => palette.id), `absent: only the built-in palettes are offered, observed ${JSON.stringify(read.palette.map((entry) => entry.id))}`);
    assert.deepEqual(read.refusals, [], `absent: an absent index is not a refusal and produces no error spam, observed ${JSON.stringify(read.refusals)}`);
    assert.ok(read.installNote.length > 0, `absent: the surface states honestly that nothing is installed, observed ${JSON.stringify(read.installNote)}`);
    assert.equal(read.theme, "slate", `absent: the built-in default is applied, observed ${JSON.stringify(read.theme)}`);
    assert.equal(read.canvas, "#edf1f3", `absent: the compiled palette is in charge, observed ${JSON.stringify(read.canvas)}`);
    assert.deepEqual(external, [], `absent: nothing is fetched off-origin, observed ${JSON.stringify(external)}`);
    observed.scenarios.absent = { palette: read.palette.map((entry) => entry.id), note: read.installNote, refusals: read.refusals };

    await checkBuiltInPalettes(page, "absent");
  } finally {
    await context.close();
  }
}

/** Every `*.json` file this script compares between the source tree and the
 *  built client. The constants are read-only; nothing here touches the tree. */
async function checkShippedBytes() {
  const builtPackageRoot = join(webRoot, "presentation-packages");
  require(existsSync(sourcePackageRoot), `the source package directory is missing at ${sourcePackageRoot}`);
  const want = ["index.json", ...readdirSync(sourcePackageRoot).filter((name) => name.endsWith(".json") && name !== "index.json").sort()];
  require(want.length > 1, `the source package directory ships no package: ${JSON.stringify(want)}`);
  if (!existsSync(join(builtPackageRoot, "index.json"))) {
    observed.shippedBytes.push(`not checked: the built client at ${builtPackageRoot} has no presentation-packages/index.json; build it with: cd web && npm run build`);
    return;
  }
  const mismatches = [];
  for (const name of want) {
    const source = join(sourcePackageRoot, name);
    const built = join(builtPackageRoot, name);
    require(existsSync(built), `the built client does not carry the source package ${name} (${built} is missing); a rebuild must copy web/public/presentation-packages into the served output`);
    const [a, b] = [await readFile(source), await readFile(built)];
    if (!a.equals(b)) mismatches.push(name);
  }
  assert.deepEqual(mismatches, [], `the built client must carry the source bytes unchanged; these differ: ${JSON.stringify(mismatches)}`);
  observed.shippedBytes.push(...want.map((name) => `byte-identical: presentation-packages/${name}`));
}

/** The example package shipped in the source tree, served with its own bytes
 *  (only the index is rewritten). A theme that is only a fixture is not a
 *  theme; this proves the one a self-hoster selects is real and applies. */
async function scenarioShippedExample(packagesDirectory) {
  const exampleIndex = JSON.parse(await readFile(join(sourcePackageRoot, "index.json"), "utf8"));
  const exampleFile = exampleIndex.packages[0];
  require(typeof exampleFile === "string", `the source package index lists no package file: ${JSON.stringify(exampleIndex.packages)}`);
  const exampleName = exampleFile.replace(/\.json$/, "");
  const example = JSON.parse(await readFile(join(sourcePackageRoot, exampleFile), "utf8"));
  await writeFixture(packagesDirectory, {
    schema: INDEX_SCHEMA,
    packages: [exampleFile],
  }, {
    [exampleFile]: example,
  });
  const { context, page, external } = await openClient();
  try {
    await openAppearance(page);
    await waitForPaletteOption(page, example.id);
    const offered = await readAppearance(page);
    const option = offered.palette.find((entry) => entry.id === example.id);
    assert.ok(option, `shipped: the example package is offered in the palette picker, observed ${JSON.stringify(offered.palette.map((entry) => entry.id))}`);
    assert.equal(option.name, example.name, `shipped: the picker shows the example's own name, observed ${JSON.stringify(option.name)}`);
    assert.equal(option.swatches.length, example.swatches.length, `shipped: the picker draws every declared swatch, observed ${JSON.stringify(option.swatches)}`);
    assert.deepEqual(offered.refusals, [], `shipped: the example package is admitted with no refusal, observed ${JSON.stringify(offered.refusals)}`);
    assert.ok(offered.palette.some((entry) => entry.id === BUILT_IN_PALETTES[0].id), `shipped: the built-in palettes remain beside it, observed ${JSON.stringify(offered.palette.map((entry) => entry.id))}`);

    await selectTheme(page, example.id);
    const read = await readAppearance(page);
    assert.equal(read.theme, example.id, `shipped: the example id becomes data-theme, observed ${JSON.stringify(read.theme)}`);
    // The fresh context asks for a light system, so the example is read under
    // the effective light appearance: a per-appearance declaration selects its
    // light set, and a flat declaration applies the same values everywhere.
    const perAppearance = declaresAppearances(example.tokens);
    const lightTokens = declaredValues(example.tokens, "light");
    const darkTokens = declaredValues(example.tokens, "dark");
    assert.equal(read.appearance, "light", `shipped: an untouched preference resolves to light in a light system, observed ${JSON.stringify(read.appearance)}`);
    assert.equal(read.canvas, lightTokens["--canvas"], `shipped: the declared --canvas reaches the document, observed ${JSON.stringify(read.canvas)}`);
    assert.equal(read.ink, lightTokens["--ink"], `shipped: the declared --ink reaches the document, observed ${JSON.stringify(read.ink)}`);
    assert.equal(read.cardRadius, lightTokens["--card-radius"], `shipped: the declared --card-radius reaches the document, observed ${JSON.stringify(read.cardRadius)}`);
    // `.app-shell` paints `var(--surface)` and inherits `color` from `var(--ink)`,
    // so these two are the proof that the package is not merely stored: the
    // interface actually renders with the declared values.
    assert.equal(read.paintedSurface, rgbOf(lightTokens["--surface"]), `shipped: the declared --surface is what the application shell actually paints, observed ${JSON.stringify(read.paintedSurface)}`);
    assert.equal(read.paintedInk, rgbOf(lightTokens["--ink"]), `shipped: the declared --ink is what the shell paints text with, observed ${JSON.stringify(read.paintedInk)}`);
    assert.equal(read.paintedRadius, lightTokens["--card-radius"], `shipped: the declared --card-radius is what the settings surface renders, observed ${JSON.stringify(read.paintedRadius)}`);
    assert.equal(read.paintedThemeCardRadius, "10px", `shipped: a compiled component radius still renders beside it, observed ${JSON.stringify(read.paintedThemeCardRadius)}`);
    const painted = { theme: read.theme, light: { canvas: read.canvas, paintedSurface: read.paintedSurface, paintedInk: read.paintedInk, cardRadius: read.cardRadius } };

    if (perAppearance) {
      // The shipped theme is the reference a self-hoster copies, so it must be
      // visibly two palettes rather than one palette under two labels.
      await setAppearanceMode(page, "dark");
      const darkRead = await readAppearance(page);
      assert.equal(darkRead.appearance, "dark", `shipped: the mode control reaches the effective appearance, observed ${JSON.stringify(darkRead.appearance)}`);
      assert.equal(darkRead.canvas, darkTokens["--canvas"], `shipped: the same theme under dark applies its own --canvas, observed ${JSON.stringify(darkRead.canvas)}`);
      assert.notEqual(darkRead.canvas, read.canvas, `shipped: the light and dark sets are different palettes, observed both as ${JSON.stringify(darkRead.canvas)}`);
      assert.equal(darkRead.paintedInk, rgbOf(darkTokens["--ink"]), `shipped: the dark --ink is what the shell paints text with, observed ${JSON.stringify(darkRead.paintedInk)}`);
      assert.equal(darkRead.paintedSurface, rgbOf(darkTokens["--surface"]), `shipped: the dark --surface is what the application shell actually paints, observed ${JSON.stringify(darkRead.paintedSurface)}`);
      assert.equal(darkRead.cardRadius, darkTokens["--card-radius"], `shipped: the same radii in both sets, observed ${JSON.stringify(darkRead.cardRadius)}`);
      painted.dark = { canvas: darkRead.canvas, paintedSurface: darkRead.paintedSurface, paintedInk: darkRead.paintedInk, cardRadius: darkRead.cardRadius };

      await setAppearanceMode(page, "light");
      const backRead = await readAppearance(page);
      assert.equal(backRead.canvas, lightTokens["--canvas"], `shipped: switching back re-applies the light set, observed ${JSON.stringify(backRead.canvas)}`);
    }

    observed.scenarios[`shipped:${exampleName}`] = {
      id: example.id,
      name: example.name,
      file: exampleFile,
      hostRange: example.hostRange,
      perAppearance,
      declaredTokens: perAppearance
        ? { light: Object.keys(lightTokens).length, dark: Object.keys(darkTokens).length }
        : Object.keys(lightTokens).length,
      painted,
    };

    await checkBuiltInPalettes(page, "shipped");
    assert.deepEqual(external, [], "shipped: serving and applying the example requests nothing outside the document origin");
  } finally {
    await context.close();
  }
}

/** A package that declares one value set per appearance, next to one that
 *  declares only the flat map. The effective appearance — not the stored
 *  preference — must select the set, and a key present in only one set must be
 *  removed when the other set is written. */
async function scenarioPerAppearanceApplies(packagesDirectory, declaredVersion) {
  const daynightID = "acceptance:daynight-shift";
  const flatID = "acceptance:fixed-plate";
  const lightTokens = {
    "--canvas": "#fdf7ec",
    "--ink": "#241d12",
    "--primary": "#7a4f18",
    "--card-radius": "6px",
    "--gold": "#6b4a08",
  };
  const darkTokens = {
    "--canvas": "#151109",
    "--ink": "#f6ecd9",
    "--primary": "#e6c48a",
    "--card-radius": "11px",
    "--coral": "#ff9a8f",
  };
  const flatTokens = { "--canvas": "#0d1b2a", "--ink": "#e0e6ed", "--card-radius": "5px" };
  await writeFixture(packagesDirectory, {
    schema: INDEX_SCHEMA,
    packages: ["daynight.json", "fixed.json"],
  }, {
    "daynight.json": {
      schema: PACKAGE_SCHEMA,
      id: daynightID,
      name: "Daynight Shift",
      hostRange: `>=${declaredVersion} <9.0.0`,
      swatches: ["#fdf7ec", "#151109"],
      tokens: { light: lightTokens, dark: darkTokens },
    },
    "fixed.json": {
      schema: PACKAGE_SCHEMA,
      id: flatID,
      name: "Fixed Plate",
      hostRange: `>=${declaredVersion} <9.0.0`,
      swatches: ["#0d1b2a"],
      tokens: flatTokens,
    },
  });
  const { context, page, external } = await openClient();
  try {
    await openAppearance(page);
    await waitForPaletteOption(page, daynightID);
    assert.deepEqual((await readAppearance(page)).refusals, [], "per-appearance: both forms are admitted");
    await selectTheme(page, daynightID);

    const lightRead = await readAppearance(page);
    assert.equal(lightRead.appearance, "light", `per-appearance: a light system resolves the untouched preference to light, observed ${JSON.stringify(lightRead.appearance)}`);
    // color-scheme is not an admitted token, so a package never writes it; the
    // host derives it from the effective appearance through a rule that is not
    // scoped to a theme. Asserting it here keeps that true for an installed
    // theme, so native controls cannot silently regress to the wrong scheme.
    assert.equal(lightRead.colorScheme, "light", `per-appearance: an installed theme still gets a light native color-scheme under light, observed ${JSON.stringify(lightRead.colorScheme)}`);
    assert.equal(lightRead.canvas, lightTokens["--canvas"], `per-appearance: the light set's --canvas is applied under light, observed ${JSON.stringify(lightRead.canvas)}`);
    assert.equal(lightRead.ink, lightTokens["--ink"], `per-appearance: the light set's --ink is applied under light, observed ${JSON.stringify(lightRead.ink)}`);
    assert.equal(lightRead.paintedText, rgbOf(lightTokens["--ink"]), `per-appearance: the light --ink is what the page paints text with, observed ${JSON.stringify(lightRead.paintedText)}`);
    assert.equal(lightRead.cardRadius, lightTokens["--card-radius"], `per-appearance: the light set's layout token is applied, observed ${JSON.stringify(lightRead.cardRadius)}`);
    assert.equal(lightRead.gold, lightTokens["--gold"], `per-appearance: a token declared only in the light set is the light value under light, observed ${JSON.stringify(lightRead.gold)}`);
    assert.equal(lightRead.coral, "#dc8278", `per-appearance: a token the light set omits keeps the compiled value, observed ${JSON.stringify(lightRead.coral)}`);

    await setAppearanceMode(page, "dark");
    const darkRead = await readAppearance(page);
    assert.equal(darkRead.appearance, "dark", `per-appearance: the mode control reaches the effective appearance, observed ${JSON.stringify(darkRead.appearance)}`);
    assert.equal(darkRead.colorScheme, "dark", `per-appearance: an installed theme still gets a dark native color-scheme under dark, observed ${JSON.stringify(darkRead.colorScheme)}`);
    assert.equal(darkRead.canvas, darkTokens["--canvas"], `per-appearance: the dark set's --canvas is applied under dark, observed ${JSON.stringify(darkRead.canvas)}`);
    assert.notEqual(darkRead.canvas, lightRead.canvas, `per-appearance: the same theme renders two different --canvas values across appearances, observed both as ${JSON.stringify(darkRead.canvas)}`);
    assert.equal(darkRead.ink, darkTokens["--ink"], `per-appearance: the dark set's --ink is applied under dark, observed ${JSON.stringify(darkRead.ink)}`);
    assert.notEqual(darkRead.paintedText, lightRead.paintedText, `per-appearance: the same theme paints two different text colours across appearances, observed both as ${JSON.stringify(darkRead.paintedText)}`);
    assert.equal(darkRead.cardRadius, darkTokens["--card-radius"], `per-appearance: the dark set's layout token replaces the light one, observed ${JSON.stringify(darkRead.cardRadius)}`);
    assert.notEqual(darkRead.cardRadius, lightRead.cardRadius, `per-appearance: a layout token differs between the two sets, observed both as ${JSON.stringify(darkRead.cardRadius)}`);
    assert.equal(darkRead.coral, darkTokens["--coral"], `per-appearance: a token declared only in the dark set is the dark value under dark, observed ${JSON.stringify(darkRead.coral)}`);
    assert.equal(darkRead.gold, "#d0a152", `per-appearance: a token declared only in the light set is removed under dark, observed ${JSON.stringify(darkRead.gold)}`);

    await setAppearanceMode(page, "light");
    const backRead = await readAppearance(page);
    assert.equal(backRead.canvas, lightTokens["--canvas"], `per-appearance: switching back re-applies the light set, observed ${JSON.stringify(backRead.canvas)}`);
    assert.equal(backRead.gold, lightTokens["--gold"], `per-appearance: switching back re-applies the light-only token, observed ${JSON.stringify(backRead.gold)}`);
    assert.equal(backRead.coral, "#dc8278", `per-appearance: switching back removes the dark-only token again, observed ${JSON.stringify(backRead.coral)}`);

    // The original declaration keeps working exactly as it did: one flat value
    // set, applied under every appearance.
    await selectTheme(page, flatID);
    const flatLight = await readAppearance(page);
    assert.equal(flatLight.canvas, flatTokens["--canvas"], `per-appearance: a flat package applies under light, observed ${JSON.stringify(flatLight.canvas)}`);
    assert.equal(flatLight.cardRadius, flatTokens["--card-radius"], `per-appearance: a flat package applies its layout token under light, observed ${JSON.stringify(flatLight.cardRadius)}`);
    await setAppearanceMode(page, "dark");
    const flatDark = await readAppearance(page);
    assert.equal(flatDark.appearance, "dark", `per-appearance: the flat package renders under dark too, observed ${JSON.stringify(flatDark.appearance)}`);
    assert.equal(flatDark.canvas, flatTokens["--canvas"], `per-appearance: the flat map is not reinterpreted as an appearance key, observed ${JSON.stringify(flatDark.canvas)}`);
    assert.equal(flatDark.ink, flatTokens["--ink"], `per-appearance: the flat package keeps applying under dark, observed ${JSON.stringify(flatDark.ink)}`);
    assert.equal(flatDark.gold, "#d0a152", `per-appearance: the previous theme's light-only token is gone under the flat package, observed ${JSON.stringify(flatDark.gold)}`);

    // The stored preference `system` must select the set as well: the host
    // resolves the *effective* appearance at apply time, so a stored `system`
    // follows the device rather than freezing one palette.
    await page.locator('input[name="cairn-appearance-mode"][value="system"]').check();
    await selectTheme(page, daynightID);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.getAttribute("data-appearance") === "dark", undefined, { timeout: 8000 });
    const systemDark = await readAppearance(page);
    assert.equal(systemDark.canvas, darkTokens["--canvas"], `per-appearance: a stored system preference resolves dark at apply time, observed ${JSON.stringify(systemDark.canvas)}`);
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => document.documentElement.getAttribute("data-appearance") === "light", undefined, { timeout: 8000 });
    const systemLight = await readAppearance(page);
    assert.equal(systemLight.canvas, lightTokens["--canvas"], `per-appearance: the same stored system preference resolves light in a light device, observed ${JSON.stringify(systemLight.canvas)}`);
    assert.equal(systemLight.gold, lightTokens["--gold"], `per-appearance: the light-only token returns with the light set, observed ${JSON.stringify(systemLight.gold)}`);

    await setAppearanceMode(page, "light");
    await checkBuiltInPalettes(page, "per-appearance");
    assert.deepEqual(external, [], "per-appearance: switching a package's appearance fetches nothing off-origin");
    observed.scenarios["per-appearance"] = {
      id: daynightID,
      declaredSets: { light: Object.keys(lightTokens).length, dark: Object.keys(darkTokens).length },
      light: { appearance: lightRead.appearance, canvas: lightRead.canvas, paintedText: lightRead.paintedText, cardRadius: lightRead.cardRadius, gold: lightRead.gold, coral: lightRead.coral },
      dark: { appearance: darkRead.appearance, canvas: darkRead.canvas, paintedText: darkRead.paintedText, cardRadius: darkRead.cardRadius, gold: darkRead.gold, coral: darkRead.coral },
      system: { dark: systemDark.canvas, light: systemLight.canvas },
      flat: { id: flatID, light: flatLight.canvas, dark: flatDark.canvas },
    };
  } finally {
    await context.close();
  }
}

/** A per-appearance declaration is checked by the same allowlist and the same
 *  forbidden-value rule as a flat one, and its shape is checked too: an unknown
 *  key inside a value set, a missing appearance, and a mixture of the two forms
 *  are each refused whole with nothing applied. */
async function scenarioPerAppearanceRefused(packagesDirectory, declaredVersion) {
  const escapeID = "acceptance:appearance-escape";
  const unknownID = "acceptance:appearance-unknown";
  const halfID = "acceptance:appearance-half";
  const mixedID = "acceptance:appearance-mixed";
  const clean = { "--canvas": "#101820", "--ink": "#eef4f8" };
  await writeFixture(packagesDirectory, {
    schema: INDEX_SCHEMA,
    packages: ["escape.json", "unknown.json", "half.json", "mixed.json"],
  }, {
    "escape.json": {
      schema: PACKAGE_SCHEMA,
      id: escapeID,
      name: "Appearance Escape",
      hostRange: `>=${declaredVersion}`,
      swatches: ["#101820"],
      tokens: { light: clean, dark: { "--canvas": "#000000", "--ink": "#ffffff; position: fixed; inset: 0" } },
    },
    "unknown.json": {
      schema: PACKAGE_SCHEMA,
      id: unknownID,
      name: "Appearance Unknown Key",
      hostRange: `>=${declaredVersion}`,
      swatches: ["#202020"],
      tokens: { light: { ...clean, "--overlay-position": "fixed" }, dark: clean },
    },
    "half.json": {
      schema: PACKAGE_SCHEMA,
      id: halfID,
      name: "Appearance Half",
      hostRange: `>=${declaredVersion}`,
      swatches: ["#303030"],
      tokens: { light: clean },
    },
    "mixed.json": {
      schema: PACKAGE_SCHEMA,
      id: mixedID,
      name: "Appearance Mixed",
      hostRange: `>=${declaredVersion}`,
      swatches: ["#404040"],
      tokens: { "--canvas": "#111111", light: clean, dark: clean },
    },
  });
  const { context, page } = await openClient();
  try {
    await openAppearance(page);
    await page.waitForFunction(() => document.querySelectorAll(".appearance-package-refusals p").length === 4, undefined, { timeout: 10000 });
    const read = await readAppearance(page);
    assert.equal(read.refusals.length, 4, `per-appearance refusal: every broken declaration is refused, observed ${JSON.stringify(read.refusals)}`);
    const reasonFor = (id) => read.refusals.find((line) => line.includes(id));
    const escapeReason = reasonFor(escapeID);
    const unknownReason = reasonFor(unknownID);
    const halfReason = reasonFor(halfID);
    const mixedReason = reasonFor(mixedID);
    assert.ok(escapeReason && escapeReason.includes("dark:") && escapeReason.includes("--ink") && escapeReason.includes("escape a CSS declaration"), `per-appearance refusal: a forbidden value inside the dark set is refused by set and name, observed ${JSON.stringify(escapeReason)}`);
    assert.ok(unknownReason && unknownReason.includes("light:") && unknownReason.includes("--overlay-position") && unknownReason.includes("not an admitted design token"), `per-appearance refusal: an unknown key inside a value set is refused by name, observed ${JSON.stringify(unknownReason)}`);
    assert.ok(halfReason && halfReason.includes("tokens.dark"), `per-appearance refusal: a half-declared theme is refused whole, observed ${JSON.stringify(halfReason)}`);
    assert.ok(mixedReason && mixedReason.includes("mixes value sets") && mixedReason.includes("--canvas"), `per-appearance refusal: a flat token name beside the appearance keys is refused whole, observed ${JSON.stringify(mixedReason)}`);
    for (const id of [escapeID, unknownID, halfID, mixedID]) {
      assert.ok(!read.palette.some((entry) => entry.id === id), `per-appearance refusal: ${id} is not offered, observed ${JSON.stringify(read.palette.map((entry) => entry.id))}`);
    }
    // No partial application: every one of these packages declared an admissible
    // light set beside its broken part, and none of them reached the document.
    assert.equal(read.canvas, "#edf1f3", `per-appearance refusal: no token of a refused package is applied, observed ${JSON.stringify(read.canvas)}`);
    assert.equal(read.cardRadius, BUILT_IN_CARD_RADIUS, `per-appearance refusal: no layout token of a refused package is applied, observed ${JSON.stringify(read.cardRadius)}`);
    observed.scenarios["per-appearance-refusals"] = { refusals: read.refusals, canvas: read.canvas, palette: read.palette.map((entry) => entry.id) };

    await checkBuiltInPalettes(page, "per-appearance-refusal");
  } finally {
    await context.close();
  }
}

try {
  require(existsSync(join(webRoot, "index.html")), `the built client is missing at ${webRoot}.\n      Build it first:  cd web && npm ci && npm run build\n      or set CAIRN_PRESENTATION_WEB_ROOT to an absolute built client root.`);
  require(existsSync(chrome), `Chrome/Chromium was not found at ${chrome}.\n      Set CAIRN_PLAYWRIGHT_EXECUTABLE_PATH to a Chrome/Chromium binary.`);
  const playwright = await import("../web/node_modules/playwright/index.mjs").catch(() => {
    throw new Error("Playwright is not installed in web/node_modules.\n      Install the web toolchain first:  cd web && npm ci");
  });
  const declaredVersion = JSON.parse(await readFile(join(repo, "web", "package.json"), "utf8")).version;
  require(typeof declaredVersion === "string" && declaredVersion.length > 0, "web/package.json carries no version for admission to compare");

  temp = requireOwned(await mkdtemp(tempPrefix), "use");
  const overlayRoot = join(temp, "overlay");
  const packagesDirectory = join(overlayRoot, "presentation-packages");
  await mkdir(packagesDirectory, { recursive: true });
  server = await startStaticServer(webRoot, overlayRoot);
  const port = server.address().port;
  baseURL = `http://127.0.0.1:${port}`;
  browser = await playwright.chromium.launch({ headless: true, executablePath: chrome });

  await checkShippedBytes();
  await scenarioValidPackage(packagesDirectory, declaredVersion);
  await scenarioHostRangeRefused(packagesDirectory, declaredVersion);
  await scenarioTokenKeyRefused(packagesDirectory, declaredVersion);
  await scenarioTokenValueRefused(packagesDirectory, declaredVersion);
  await scenarioCollisionRefused(packagesDirectory, declaredVersion);
  await scenarioCodeFieldsRefused(packagesDirectory, declaredVersion);
  await scenarioPerAppearanceApplies(packagesDirectory, declaredVersion);
  await scenarioPerAppearanceRefused(packagesDirectory, declaredVersion);
  await scenarioShippedExample(packagesDirectory);
  await scenarioNothingInstalled(packagesDirectory);
} catch (error) {
  failure = error;
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (server) await new Promise((resolveClose) => server.close(resolveClose)).catch(() => undefined);
  if (temp) await rm(requireOwned(temp, "remove"), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
}

console.log(`built client root           : ${webRoot}`);
console.log(`temporary web root          : ${temp ?? "not created"}`);
console.log(`chrome                      : ${chrome}`);
console.log(`base                        : ${baseURL || "not started"}`);
console.log(`built-in palette checks     : ${observed.builtInChecks.length}`);
for (const check of observed.builtInChecks) console.log(`  ${check}`);
for (const check of observed.shippedBytes) console.log(`shipped bytes               : ${check}`);
for (const [name, scenario] of Object.entries(observed.scenarios)) {
  console.log(`scenario ${name}`);
  for (const [key, value] of Object.entries(scenario)) {
    console.log(`  ${key.padEnd(26)}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
}

if (failure) {
  console.error(`FAIL: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("PASS: a valid presentation package was admitted and its tokens reached the rendered document; a host-range mismatch, an unadmitted token, a declaration-escaping value, a built-in id collision and a code-bearing field were each refused whole with a visible reason and no partial application; a package declaring one value set per appearance rendered two different sets of values as the Color mode control switched light to dark, removed a token declared in only one set for the other appearance, and a package declaring only the flat map still applied the same values under both; a forbidden value inside a value set, an unknown key inside one, a half-declared theme and a mixture of the two forms were each refused whole; the shipped source-tree example theme was admitted and visibly applied as two palettes using its own bytes; the built client carries those source bytes unchanged; and the three built-in palettes kept working in every case.");
  console.log("NOTE: build-time refusal (web/vite.config.ts rejecting a package in web/public/presentation-packages) is not run by this script because a nested build would rewrite web/dist while these scenarios read it. Verify it manually: add a broken package to the source directory, run `cd web && npm run build`, observe the nonzero exit and the named file and reason, then remove the file and rebuild.");
}
