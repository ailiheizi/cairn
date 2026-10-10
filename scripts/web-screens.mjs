// Visual capture for the WebUI.
//
// Launches its own Playwright Chromium, so it needs no DevTools consent from
// any browser the operator is already running, and it never touches their
// profile. It writes PNGs and measurements, then enforces the SP-1 1280px
// first-tile target and no-overflow check so a capture cannot be mistaken for a pass.
//
// Usage:
//   node scripts/web-screens.mjs [url] [outDir]
//
// Environment:
//   CAIRN_PLAYWRIGHT_MODULE            default "playwright"
//   CAIRN_PLAYWRIGHT_EXECUTABLE_PATH   optional browser binary
//   CAIRN_WEB_URL                      default http://127.0.0.1:4538/
//   CAIRN_SCREEN_DIR                   default /private/tmp/cairn-shots
//   CAIRN_SCREEN_THEME                 "dark" to ask for the dark theme

const url = process.argv[2] || process.env.CAIRN_WEB_URL || "http://127.0.0.1:4538/";
const outDir = process.argv[3] || process.env.CAIRN_SCREEN_DIR || "/private/tmp/cairn-shots";
const theme = (process.env.CAIRN_SCREEN_THEME || "").trim();

const playwrightModule = process.env.CAIRN_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(playwrightModule);
const executablePath = process.env.CAIRN_PLAYWRIGHT_EXECUTABLE_PATH?.trim();

const fs = await import("node:fs/promises");
await fs.mkdir(outDir, { recursive: true });

// Responsive coverage includes phone, breakpoint-boundary, and desktop widths.
// 707 is the CSS width the operator's own window reports at device scale factor
// 2, which is where the mobile layout used to be selected by mistake.
const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "707", width: 707, height: 889 },
  { name: "1024", width: 1024, height: 900 },
  { name: "1280", width: 1280, height: 900 },
  { name: "1496", width: 1496, height: 900 },
];

const CLOSE_LABEL = /关闭|Close|取消|Cancel/i;
const slug = (value) => String(value).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "surface";

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const records = [];

// Layout facts for the SP-1 exit test: where the first file tile sits, how many
// columns the wall actually renders, and whether anything overflows.
async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const rows = Array.from(document.querySelectorAll(".result-list .result-row"));
    const first = rows[0]?.getBoundingClientRect();
    let gridColumns = 0;
    if (rows.length > 0) {
      const firstTop = Math.round(rows[0].getBoundingClientRect().top);
      const lefts = new Set();
      for (const row of rows) {
        const box = row.getBoundingClientRect();
        if (Math.abs(Math.round(box.top) - firstTop) > 4) break;
        lefts.add(Math.round(box.left));
      }
      gridColumns = lefts.size;
    }
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: doc.scrollWidth,
      horizontalOverflow: doc.scrollWidth > window.innerWidth + 1,
      firstTileTop: first ? Math.round(first.top) : null,
      firstTileWidth: first ? Math.round(first.width) : null,
      gridColumns,
    };
  });
}

async function shoot(page, name) {
  const file = `${outDir}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  records.push({ name, file, ...(await measure(page)) });
}

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  if (theme) {
    await page.addInitScript((value) => {
      try { window.localStorage.setItem("cairn.theme", value); } catch { /* ignore */ }
    }, theme);
  }

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await shoot(page, `${vp.name}-main`);
    if (vp.width === 1280) {
      for (const [selector, name] of [[".space-report", "space-report-open"], [".timeline-control", "timeline-open"]]) {
        const control = page.locator(selector);
        if ((await control.count()) === 0) continue;
        await control.locator("summary").click();
        await page.waitForTimeout(120);
        await shoot(page, `${vp.name}-${name}`);
        await control.locator("summary").click();
      }
    }

    // Enumerate the workspace rail at runtime so the capture does not depend
    // on a hardcoded list of view names.
    const views = await page.$$eval("button.workspace-nav-item", (nodes) =>
      nodes.map((node) => node.getAttribute("data-view")).filter(Boolean),
    );
    for (const view of views) {
      const target = page.locator(`button.workspace-nav-item[data-view="${view}"]`);
      if ((await target.count()) === 0) continue;
      await target.first().click().catch(() => {});
      await page.waitForTimeout(1200);
      await shoot(page, `${vp.name}-view-${slug(view)}`);
    }

    // Media are presentation modes inside the existing Library, not rail
    // entries. Reset the hash to the default content view before capturing.
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // The domain switch moved from the old `.library-view-switch` markup to the
    // domain-grouped presentation navigation, and its ids are namespaced
    // (`cairn:photos`), so resolve them at runtime instead of hardcoding
    // a class or a bare id. Waiting on the stale selector used to time out and
    // silently drop every Photos/Music capture.
    await page.locator(".library-presentation-navigation__domain").first().waitFor({ state: "visible", timeout: 20000 });
    for (const view of ["photos", "music"]) {
      const target = page.locator(`.library-presentation-navigation__domain[data-domain$="${view}"]`);
      if ((await target.count()) === 0) continue;
      await target.first().click().catch(() => {});
      await page.waitForTimeout(900);
      await shoot(page, `${vp.name}-view-${slug(view)}`);
    }

    // Settings: open once, then walk whatever category navigation exists.
    const trigger = page.getByRole("button", { name: /打开设置|Open settings/ });
    if ((await trigger.count()) > 0) {
      await trigger.first().click().catch(() => {});
      await page.waitForTimeout(900);
      const dialog = page.getByRole("dialog", { name: /设置|Settings/ });
      if ((await dialog.count()) > 0) {
        await shoot(page, `${vp.name}-settings`);
        const buttons = dialog.locator("button");
        const total = Math.min(await buttons.count(), 10);
        for (let i = 0; i < total; i += 1) {
          const button = buttons.nth(i);
          const label = ((await button.getAttribute("aria-label")) || (await button.innerText().catch(() => "")) || "").trim();
          if (!label || CLOSE_LABEL.test(label)) continue;
          await button.click().catch(() => {});
          await page.waitForTimeout(700);
          await shoot(page, `${vp.name}-settings-${i}-${slug(label)}`);
        }
        const close = dialog.getByRole("button", { name: /关闭设置|Close settings/ });
        if ((await close.count()) > 0) await close.first().click().catch(() => {});
      }
    }
  } catch (error) {
    records.push({ name: `${vp.name}-error`, error: String(error?.message || error) });
  } finally {
    await page.close();
  }
}

await browser.close();
await fs.writeFile(`${outDir}/report.json`, JSON.stringify({ url, theme: theme || null, records }, null, 2));

const screenshots = records.filter((r) => r.file);
const failures = records.filter((r) => r.error);
const overflow = screenshots.filter((r) => r.horizontalOverflow);
const target = screenshots.find((r) => r.name === "1280-main");
const targetPassed = Boolean(target && target.firstTileTop !== null && target.firstTileTop <= 260);
console.log(`captured ${screenshots.length} screenshot(s) into ${outDir}`);
for (const r of records) {
  if (r.error) { console.log(`  ${r.name}: ERROR ${r.error}`); continue; }
  if (r.file) {
    console.log(
      `  ${r.name}: ${r.innerWidth}x${r.innerHeight} overflow=${r.horizontalOverflow ? "YES" : "no"}` +
      ` firstTileTop=${r.firstTileTop} tileWidth=${r.firstTileWidth} columns=${r.gridColumns}`,
    );
  }
}
console.log(overflow.length === 0 ? "no horizontal overflow at any captured width" : `HORIZONTAL OVERFLOW at ${overflow.length} capture(s)`);
console.log(targetPassed ? `SP-1 target passed: 1280px first tile at ${target.firstTileTop}px (<=260)` : `SP-1 target failed: 1280px first tile is ${target?.firstTileTop ?? "unmeasured"}px (target <=260)`);
if (failures.length > 0 || overflow.length > 0 || !targetPassed) process.exitCode = 1;
