// Minimal visual QA for the content-first Library. This owns its temporary
// daemon, catalog, repository, source fixtures, and Chrome context. Fixtures
// are QA bytes only: PDF/ZIP/audio files with opaque bytes are not parser or
// playback claims.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "../web/node_modules/playwright/index.mjs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(new URL("..", import.meta.url).pathname);
const outDir = join(repo, ".tmp-content-polish-20261005");
const chrome = process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 4547;
const temp = await mkdtemp(join(tmpdir(), "cairn-content-visual-"));
let daemon;
let browser;
const settleLayout = (page) => page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
const capture = async (page, path) => { await settleLayout(page); await page.screenshot({ path, animations: "disabled" }); };
try {
  const portProbe = createServer();
  await new Promise((resolveProbe, rejectProbe) => {
    portProbe.once("error", rejectProbe);
    portProbe.listen(port, "127.0.0.1", resolveProbe);
  });
  await new Promise((resolveProbe, rejectProbe) => portProbe.close((error) => error ? rejectProbe(error) : resolveProbe()));
  await mkdir(outDir, { recursive: true });
  const daemonBin = join(temp, "cairnd");
  const cairnBin = join(temp, "cairn");
  for (const [bin, pkg] of [[daemonBin, "./server/cmd/cairnd"], [cairnBin, "./client/cmd/cairn"]]) {
    const built = spawnSync("go", ["build", "-tags", "purego", "-o", bin, pkg], { cwd: repo, stdio: "inherit" });
    assert.equal(built.status, 0, `build ${pkg}`);
  }
  const source = join(temp, "qa-source");
  await mkdir(source);
  const png = join(source, "Pattern.png");
  const imageGenerator = join(temp, "make-pattern.swift");
  await writeFile(imageGenerator, `import AppKit\nlet rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 96, pixelsHigh: 64, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!\nfor y in 0..<64 { for x in 0..<96 { let c = ((x / 12 + y / 12) % 2 == 0) ? NSColor(calibratedRed: 0.18, green: 0.42, blue: 0.58, alpha: 1) : NSColor(calibratedRed: 0.85, green: 0.68, blue: 0.38, alpha: 1); rep.setColor(c, atX: x, y: y) } }\ntry rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))\n`);
  const generated = spawnSync("swift", [imageGenerator, png], { stdio: "ignore" });
  assert.equal(generated.status, 0, "generate a deterministic valid PNG pattern with macOS AppKit");
  const jpg = join(source, "Pattern.jpg");
  const converted = spawnSync("sips", ["-s", "format", "jpeg", png, "--out", jpg], { stdio: "ignore" });
  assert.equal(converted.status, 0, "create JPEG QA image with macOS sips");
  await writeFile(join(source, "Notes.txt"), "QA text file: content should be read only after opening details.\n");
  await writeFile(join(source, "Brief.pdf"), "%PDF-1.4\n% QA opaque document bytes\n%%EOF\n");
  await writeFile(join(source, "Bundle.zip"), Buffer.from("QA ZIP suffix; intentionally opaque bytes\n"));
  await writeFile(join(source, "Track.m4a"), Buffer.from("QA audio suffix; intentionally opaque bytes\n"));
  await writeFile(join(source, "Broken.png"), Buffer.from("QA invalid image bytes\n"));
  const config = join(temp, "config.toml");
  const init = spawnSync(cairnBin, ["config", "init", "--path", config], { cwd: repo, stdio: "ignore" });
  assert.equal(init.status, 0, "initialize temporary config");
  const env = { ...process.env, CAIRN_CATALOG: join(temp, "catalog.sqlite"), CAIRN_REPOSITORY: join(temp, "repository"), CAIRN_VECTORS: join(temp, "vectors"), CAIRN_MODELS: join(temp, "models"), CAIRN_RECOVERY_RECORDS: join(temp, "recovery") };
  daemon = spawn(daemonBin, ["--config", config, "--socket", join(temp, "daemon.sock"), "--api-listen", `127.0.0.1:${port}`, "--web-root", join(repo, "web/dist")], { cwd: repo, env, stdio: "ignore" });
  await new Promise((resolveSpawn, rejectSpawn) => { daemon.once("spawn", resolveSpawn); daemon.once("error", rejectSpawn); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i += 1) {
    assert.equal(daemon.exitCode, null, "the isolated daemon process remains alive while its API starts");
    try { if ((await fetch(`${base}/api/v1/healthz`)).ok) break; } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    assert.ok(i < 119, "temporary daemon becomes ready");
  }
  const command = async (operation, input = {}) => {
    const response = await fetch(`${base}/api/v1/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, input }) });
    const body = await response.json();
    assert.ok(body.status === "SUCCEEDED" || (operation === "plan.apply" && body.status === "DEGRADED"), `${operation}: ${JSON.stringify(body.reasons ?? [])}`);
    return body.data;
  };
  const plan = await command("plan.ingest", { root: source });
  assert.equal(plan.executable, true, "fixture ingest plan is executable");
  const applied = await command("plan.apply", { workspace_id: plan.workspace_id, plan_id: plan.plan_id, plan_digest: plan.plan_digest });
  assert.ok(["SUCCEEDED", "DEGRADED"].includes(applied.state), "exact QA ingest publication completes even if a derived processor is unavailable");

  browser = await chromium.launch({ headless: true, executablePath: chrome });
  for (const colorScheme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1496, height: 900 }, colorScheme, locale: "en-US" });
    const requests = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/v1/command")) {
        try { requests.push(request.postDataJSON()?.operation); } catch {}
      }
    });
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.locator(".result-list .result-row").first().waitFor({ state: "visible", timeout: 20000 });
    assert.equal(await page.locator(".topbar").count(), 1, "the app mounts one TopBar");
    const names = await page.locator(".result-open-copy strong").allInnerTexts();
    for (const name of ["Pattern.png", "Pattern.jpg", "Notes.txt", "Brief.pdf", "Bundle.zip", "Track.m4a", "Broken.png"]) assert.ok(names.includes(name), `All contains ${name}`);
    assert.equal(await page.locator('.file-icon.is-document .result-format').filter({ hasText: "PDF" }).count(), 1, "PDF type cue visible");
    assert.equal(await page.locator('.file-icon.is-archive .result-format').filter({ hasText: "ZIP" }).count(), 1, "archive type cue visible");
    await page.locator('.result-list .file-icon [aria-label^="Preview unavailable"]').waitFor({ state: "visible", timeout: 10000 });
    requests.length = 0;
    for (const [width, height] of [[1496, 900], [1280, 900], [1199, 900], [1120, 900], [1024, 900], [707, 889], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await settleLayout(page);
      const layout = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll("body *")].map((node) => ({ cls: String(node.className?.baseVal ?? node.className ?? node.tagName).slice(0, 80), right: Math.round(node.getBoundingClientRect().right) })).filter((item) => item.right > document.documentElement.clientWidth + 2).slice(0, 8) }));
      if (layout.scroll > layout.client + 1) { await page.screenshot({ path: join(outDir, `${colorScheme}-all-${width}-overflow.png`) }); console.error(`overflow ${width}: ${JSON.stringify(layout)}`); }
      assert.ok(layout.scroll <= layout.client + 1, `All has no overflow at ${width}`);
      const topbar = await page.locator(".topbar").boundingBox();
      assert.ok(topbar && topbar.x >= 0 && topbar.x + topbar.width <= width + 1 && topbar.y >= 0 && topbar.y + topbar.height <= height, `single TopBar stays in the  ${width}px viewport`);
      const firstTileTop = await page.locator(".result-list .result-row").first().evaluate((node) => Math.round(node.getBoundingClientRect().top));
      assert.ok(firstTileTop >= 0 && firstTileTop < height, `All first file is visible at ${width}: ${firstTileTop}px`);
      await capture(page, join(outDir, `${colorScheme}-all-${width}.png`));
      if (width === 1280) assert.ok(firstTileTop <= 260, `first content row stays above the fold target at 1280: ${firstTileTop}px`);
    }
    await page.setViewportSize({ width: 1496, height: 900 });
    await page.getByRole("button", { name: "List view" }).click();
    await page.locator(".result-list.list-mode").waitFor({ state: "visible" });
    assert.match((await page.locator(".result-list.list-mode .result-meta").filter({ hasText: "PDF" }).first().innerText()).trim(), /PDF/);
    await capture(page, join(outDir, `${colorScheme}-all-list-1496.png`));
    await page.getByRole("button", { name: "Grid view" }).click();
    for (const [view, name] of [["photos", "Photos"], ["music", "Audio"]]) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.locator(`.library-view-switch [data-view="${view}"]`).click();
      const section = page.locator(`.content-column[data-view="${view}"]`);
      assert.equal(await section.locator(".media-view-context").isVisible(), true, `${name} keeps its concise scope line visible`);
      if (view === "music") assert.match(await section.locator(".media-view-context").innerText(), /does not play them/);
      assert.equal(await section.locator(".media-view-about summary").innerText(), "About this view");
      await section.locator(".media-view-about summary").focus();
      await page.keyboard.press("Enter");
      assert.ok(await section.locator(".media-view-note").isVisible(), `${name} details expand from keyboard`);
      await capture(page, join(outDir, `${colorScheme}-${view}-1280.png`));
      await page.setViewportSize({ width: 390, height: 844 });
      await settleLayout(page);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${name} has no phone overflow`);
      await section.locator(".media-view-about summary").press("Enter");
      assert.equal(await section.locator(".media-view-note").isVisible(), false, `${name} details collapse from keyboard`);
      await capture(page, join(outDir, `${colorScheme}-${view}-390.png`));
    }
    assert.ok(!requests.includes("content.list") && !requests.includes("search.query"), "switching All/Photos/Audio does not refetch or query the listing");
    await page.close();
  }
  await writeFile(join(outDir, "QA-NOTES.txt"), "Final screenshots from scripts/web-content-visual-e2e.mjs only; each captured viewport passed its no-overflow and first-file visibility checks. QA fixtures are synthetic. PDF, ZIP, and audio files contain opaque bytes and do not claim parsing or playback. Screenshots use this build and an isolated temporary daemon.\n");
  console.log(`PASS: mixed-content light/dark screenshots and responsive checks saved to ${outDir}`);
} finally {
  if (browser) await browser.close();
  if (daemon && daemon.exitCode === null && daemon.signalCode === null) { daemon.kill("SIGTERM"); await new Promise((resolveWait) => daemon.once("exit", resolveWait)); }
  await rm(temp, { recursive: true, force: true });
}
