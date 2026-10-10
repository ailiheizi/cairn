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
//   scenario "absent"     with no index at all nothing is installed, no refusal
//                         is reported, and the built-in palettes stay in charge.
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
//   RESTOREWEAVE_PLAYWRIGHT_EXECUTABLE_PATH  Chrome/Chromium binary
//   CAIRN_PLAYWRIGHT_EXECUTABLE_PATH         the name the neighbouring browser
//                                            harnesses read; accepted as well
//   CAIRN_PRESENTATION_WEB_ROOT              built client root (default
//                                            <repository>/web/dist)
//
// A failure exits nonzero with the concrete observation that failed. The client
// bundle is not tracked by git; this script never builds it, and refuses loudly
// with the command that produces it.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = resolve(process.env.CAIRN_PRESENTATION_WEB_ROOT || join(repo, "web", "dist"));
const chrome = (
  process.env.RESTOREWEAVE_PLAYWRIGHT_EXECUTABLE_PATH
  || process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH
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

const observed = { scenarios: {}, builtInChecks: [] };
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
      canvas: computed.getPropertyValue("--canvas").trim(),
      ink: computed.getPropertyValue("--ink").trim(),
      cardRadius: computed.getPropertyValue("--card-radius").trim(),
      paintedText: computed.color,
      paintedRadius: settingsPage ? getComputedStyle(settingsPage).borderTopLeftRadius : "",
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

try {
  require(existsSync(join(webRoot, "index.html")), `the built client is missing at ${webRoot}.\n      Build it first:  cd web && npm ci && npm run build\n      or set CAIRN_PRESENTATION_WEB_ROOT to an absolute built client root.`);
  require(existsSync(chrome), `Chrome/Chromium was not found at ${chrome}.\n      Set RESTOREWEAVE_PLAYWRIGHT_EXECUTABLE_PATH to a Chrome/Chromium binary.`);
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

  await scenarioValidPackage(packagesDirectory, declaredVersion);
  await scenarioHostRangeRefused(packagesDirectory, declaredVersion);
  await scenarioTokenKeyRefused(packagesDirectory, declaredVersion);
  await scenarioTokenValueRefused(packagesDirectory, declaredVersion);
  await scenarioCollisionRefused(packagesDirectory, declaredVersion);
  await scenarioCodeFieldsRefused(packagesDirectory, declaredVersion);
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
  console.log("PASS: a valid presentation package was admitted and its tokens reached the rendered document; a host-range mismatch, an unadmitted token, a declaration-escaping value, a built-in id collision and a code-bearing field were each refused whole with a visible reason and no partial application; and the three built-in palettes kept working in every case.");
}
