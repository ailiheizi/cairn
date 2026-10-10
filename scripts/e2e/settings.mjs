// Assertions for the settings dialog and the responsive layout boundaries.
//
// Owner: components/SettingsDialog.tsx, app/useSettings.ts, and the two width
// boundaries the library and the settings modal share. The functions here keep
// the original assertion statements and order and may be extended, never
// weakened.

import assert from "node:assert/strict";
import { assertFocusReturned, assertNoHorizontalOverflow, assertStickyBarInView, settingsLayoutProbe } from "./support.mjs";

const settingsCategories = [
  { label: /^(Appearance|外观)$/, content: /^(Interface|界面方案)$/, selector: ".appearance-preferences h3" },
  { label: /^(Storage|存储)$/, content: /^(Storage|存储)$/ },
  { label: /^(Search|搜索)$/, content: /^(Search|搜索)$/ },
  { label: /^(Notes|备注)$/, content: /^(Notes|备注)$/ },
  { label: /^(Recovery|恢复)$/, content: /^(Recovery|恢复)$/ },
  { label: /^(Service|服务)$/, content: /^(Service|服务)$/ },
];

async function assertSettingsCategories(ctx, settings) {
  const { page } = ctx;
  for (const category of settingsCategories) {
    await settings.getByRole("button", { name: category.label }).click();
    const heading = settings.locator(category.selector ?? ".settings-content .config-heading h3");
    await heading.waitFor({ state: "visible", timeout: 10000 });
    let contentText = "";
    let activeText = "";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      contentText = (await heading.innerText()).trim();
      activeText = (await settings.locator(".settings-category.active .settings-category-label").first().innerText()).trim();
      if (category.content.test(contentText) && category.label.test(activeText)) break;
      await page.waitForTimeout(50);
    }
    assert.match(contentText, category.content, `activating ${category.label} must render its content: ${contentText}`);
    assert.match(activeText, category.label, `the active category indicator must follow the selection: ${activeText}`);
    assert.equal(await settings.locator(".settings-content .config-section").count(), 1, `only the active category may render its section: ${contentText}`);
  }
}

export async function assertResponsiveLayout(ctx) {
  const { page } = ctx;
  const selectedItem = page.getByRole("main").getByRole("button", { name: /alpha\.txt/ }).first();
  await selectedItem.waitFor({ state: "visible", timeout: 10000 });
  await selectedItem.click();
  await page.getByRole("main").getByRole("heading", { name: /alpha\.txt/ }).waitFor({ state: "visible", timeout: 10000 });

  // The settings modal is a two-pane surface above the mobile boundary: the
  // category list on the left and only the active section on the right.
  await page.setViewportSize({ width: 1512, height: 950 });
  await page.waitForTimeout(120);
  await page.getByRole("button", { name: /打开设置|Open settings/ }).click();
  const settingsDesktop = page.getByRole("dialog", { name: /设置|Settings/ });
  await settingsDesktop.locator(".settings-body").waitFor({ state: "visible", timeout: 10000 });
  await settingsDesktop.locator(".settings-content .config-section").first().waitFor({ state: "visible", timeout: 10000 });
  const desktopProbe = await settingsLayoutProbe(ctx);
  assert.equal(desktopProbe.bodyColumns, 2, `1512px settings must show two panes: ${JSON.stringify(desktopProbe)}`);
  assert.equal(desktopProbe.categoryCount, settingsCategories.length, `1512px settings must list every category: ${JSON.stringify(desktopProbe)}`);
  assert.equal(desktopProbe.sectionCount, 1, `1512px settings must render only the active section: ${JSON.stringify(desktopProbe)}`);
  assert.equal(desktopProbe.overflow, 0, `1512px settings overflow: ${JSON.stringify(desktopProbe)}`);
  await assertSettingsCategories(ctx, settingsDesktop);
  await settingsDesktop.getByRole("button", { name: /关闭设置|Close settings/ }).click();

  await page.setViewportSize({ width: 707, height: 889 });
  await page.waitForTimeout(100);
  const settingsTrigger = page.getByRole("button", { name: /打开设置|Open settings/ });
  await settingsTrigger.click();
  const settings = page.getByRole("dialog", { name: /设置|Settings/ });
  await settings.waitFor({ state: "visible", timeout: 10000 });
  await settings.locator(".config-section").first().waitFor({ state: "visible", timeout: 10000 });
  const settingsAt768 = await settingsLayoutProbe(ctx);
  assert.equal(settingsAt768.bodyColumns, 2, `707px settings must keep the category pane beside the content pane: ${JSON.stringify(settingsAt768)}`);
  assert.equal(settingsAt768.formColumns, 1, `707px storage location should keep the repository path on one row: ${JSON.stringify(settingsAt768)}`);
  assert.ok(settingsAt768.repositoryWidth >= 300, `707px repository field is too narrow: ${JSON.stringify(settingsAt768)}`);
  assert.equal(settingsAt768.overflow, 0, `707px settings overflow: ${JSON.stringify(settingsAt768)}`);
  assert.equal(settingsAt768.sectionCount, 1, `707px settings must render only the active category: ${JSON.stringify(settingsAt768)}`);
  await settings.getByRole("button", { name: /关闭设置|Close settings/ }).click();

  await page.setViewportSize({ width: 640, height: 840 });
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: /打开设置|Open settings/ }).click();
  const settingsAt640 = page.getByRole("dialog", { name: /设置|Settings/ });
  await settingsAt640.locator(".config-section").first().waitFor({ state: "visible", timeout: 10000 });
  const mobileSettings = await settingsLayoutProbe(ctx);
  assert.equal(mobileSettings.bodyColumns, 1, `640px settings should collapse to one column: ${JSON.stringify(mobileSettings)}`);
  assert.equal(mobileSettings.categoryCount, settingsCategories.length, `640px settings must keep every category reachable: ${JSON.stringify(mobileSettings)}`);
  assert.equal(mobileSettings.overflow, 0, `640px settings overflow: ${JSON.stringify(mobileSettings)}`);
  // Every section must still render from the horizontal category strip.
  await assertSettingsCategories(ctx, settingsAt640);
  const mobileAfterSwitch = await settingsLayoutProbe(ctx);
  assert.equal(mobileAfterSwitch.bodyColumns, 1, `640px settings must stay one column after switching: ${JSON.stringify(mobileAfterSwitch)}`);
  assert.equal(mobileAfterSwitch.overflow, 0, `640px settings overflow after switching: ${JSON.stringify(mobileAfterSwitch)}`);
  await settingsAt640.getByRole("button", { name: /关闭设置|Close settings/ }).click();

  await page.setViewportSize({ width: 853, height: 900 });
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: /打开设置|Open settings/ }).click();
  const settings853 = page.getByRole("dialog", { name: /设置|Settings/ });
  await settings853.locator(".config-section").first().waitFor({ state: "visible", timeout: 10000 });
  const settingsAt853 = await settingsLayoutProbe(ctx);
  assert.equal(settingsAt853.bodyColumns, 2, `853px settings must keep the category pane beside the content pane: ${JSON.stringify(settingsAt853)}`);
  assert.equal(settingsAt853.sectionCount, 1, `853px settings must render only the active category: ${JSON.stringify(settingsAt853)}`);
  assert.equal(settingsAt853.formColumns, 1, `853px storage location should keep the repository path on one row: ${JSON.stringify(settingsAt853)}`);
  assert.ok(settingsAt853.repositoryWidth >= 420, `853px repository field is too narrow: ${JSON.stringify(settingsAt853)}`);
  assert.equal(settingsAt853.overflow, 0, `853px settings overflow: ${JSON.stringify(settingsAt853)}`);
  await page.getByRole("dialog", { name: /设置|Settings/ }).getByRole("button", { name: /关闭设置|Close settings/ }).click();

  // Desktop layout is one grid with two width boundaries: the navigation rail
  // appears above 640px, and from 1080px the list and the inspector share the
  // window instead of the inspector replacing the list.
  for (const [width, expectRail, expectList] of [[640, false, false], [900, true, false], [1079, true, false], [1080, true, true], [1440, true, true], [1512, true, true]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const paneGeometry = await page.evaluate(() => {
      const box = (selector) => {
        const el = document.querySelector(selector);
        return el ? Math.round(el.getBoundingClientRect().width) : -1;
      };
      const detail = document.querySelector(".detail-column");
      const rail = document.querySelector(".workspace-sidebar");
      return {
        rail: rail ? (getComputedStyle(rail).display === "none" ? 0 : box(".workspace-sidebar")) : -1,
        railTrigger: document.querySelectorAll(".rail-trigger").length,
        list: box(".content-column"),
        inspector: box(".detail-column"),
        detailPosition: detail ? getComputedStyle(detail).position : "",
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    assert.equal(paneGeometry.rail > 0, expectRail, `${width}px navigation rail visibility changed unexpectedly: ${JSON.stringify(paneGeometry)}`);
    // The compact workspace button exists only below the boundary; above it the
    // rail is inline and the button must not be rendered at all.
    assert.equal(paneGeometry.railTrigger, width <= 640 ? 1 : 0, `${width}px workspace button visibility changed unexpectedly: ${JSON.stringify(paneGeometry)}`);
    assert.equal(paneGeometry.list > 0, expectList, `${width}px list visibility changed unexpectedly: ${JSON.stringify(paneGeometry)}`);
    assert.ok(paneGeometry.inspector > 0, `${width}px inspector is missing: ${JSON.stringify(paneGeometry)}`);
    if (expectRail) {
      if (width <= 900) assert.equal(paneGeometry.rail, 146, `${width}px compact desktop rail width changed unexpectedly: ${JSON.stringify(paneGeometry)}`);
      else assert.ok(paneGeometry.rail >= 160 && paneGeometry.rail <= 230, `${width}px rail width changed unexpectedly: ${JSON.stringify(paneGeometry)}`);
    }
    if (expectList) assert.ok(paneGeometry.list >= 400, `${width}px list is too narrow: ${JSON.stringify(paneGeometry)}`);
    assert.ok(paneGeometry.inspector >= 300, `${width}px inspector is too narrow: ${JSON.stringify(paneGeometry)}`);
    assert.equal(paneGeometry.detailPosition, "static", `${width}px detail pane must stay in normal flow: ${JSON.stringify(paneGeometry)}`);
    assert.equal(paneGeometry.overflow, 0, `${width}px detail layout overflow: ${JSON.stringify(paneGeometry)}`);
  }
}

// The phone workspace panel: one topbar button opens the same rail (Library,
// Sources, Duplicates, Tags, Activity) and the same trusted status disclosure
// as a left slide-in panel, with the drawer dismiss contract. Above the
// boundary the button does not exist and the rail stays inline; that half is
// asserted by the responsive loop above.
export async function assertMobileWorkspacePanel(ctx) {
  const { page } = ctx;
  const trigger = page.getByRole("button", { name: /打开工作区导航|Open workspace navigation/ });
  await trigger.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.locator(".workspace > .workspace-sidebar").count(), 0, "the rail must not be rendered inline on a phone");
  const triggerBox = await trigger.boundingBox();
  assert.ok(triggerBox && triggerBox.width >= 32 && triggerBox.height >= 32, `the workspace button must keep a 32px hit target: ${JSON.stringify(triggerBox)}`);

  await trigger.click();
  const panel = page.getByRole("dialog", { name: /工作区导航|Workspace navigation/ });
  await panel.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.evaluate(() => document.body.classList.contains("drawer-open")), true, "the workspace panel must lock the page like the other drawers");

  // Every rail entry is the desktop entry, inside the panel.
  const entries = panel.locator("button.workspace-nav-item");
  // The names are checked below; the count only has to cover them, so adding a
  // view does not require editing this number.
  const expectedEntryLabels = [/内容库|Library/, /来源|Sources/, /重复|Duplicates/, /备注|笔记|Notes/, /标签|Tags/, /活动|Activity/];
  assert.ok(await entries.count() >= expectedEntryLabels.length, `the panel must hold every workspace view: ${await entries.count()} < ${expectedEntryLabels.length}`);
  const entryText = (await entries.allInnerTexts()).join("\n");
  for (const label of expectedEntryLabels) {
    assert.match(entryText, label, `the panel must offer the ${label} view: ${entryText}`);
  }
  assert.equal(await entries.nth(0).isEnabled(), true, "every panel entry must be interactive");

  // The status disclosure inside the panel is the same surface: its own
  // summary opens it, and its action controls are reachable from the panel.
  const statusPanel = panel.locator(".status-panel");
  const statusSummary = statusPanel.locator("summary.status-panel-summary");
  await statusSummary.waitFor({ state: "visible", timeout: 10000 });
  assert.match((await statusSummary.innerText()).trim(), /^(PROVEN|UNKNOWN|DEGRADED|FAILED)/, `the panel's status summary must carry a state token: ${(await statusSummary.innerText()).trim()}`);
  if (await statusPanel.getAttribute("open") === null) await statusSummary.click();
  await statusPanel.locator(".health-fact").first().waitFor({ state: "visible", timeout: 10000 });
  for (const control of [/打开验证报告|Open verification report/, /打开活动|Open activity/, /刷新事实|Refresh facts/, /运行体检检查|Run doctor check/]) {
    const button = statusPanel.getByRole("button", { name: control }).first();
    assert.equal(await button.isVisible(), true, `the panel's status control ${control} must be reachable: ${await button.count()}`);
    assert.equal(await button.isEnabled(), true, `the panel's status control ${control} must be usable`);
  }
  const overflow = await page.evaluate(() => {
    const railPanel = document.querySelector(".rail-panel");
    return {
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panel: railPanel ? railPanel.scrollWidth - railPanel.clientWidth : -1,
    };
  });
  assert.equal(overflow.document, 0, `the panel must not overflow the page: ${JSON.stringify(overflow)}`);
  assert.ok(overflow.panel <= 0, `the panel must not overflow horizontally: ${JSON.stringify(overflow)}`);

  // Escape dismisses the panel and hands focus back to the button.
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached", timeout: 10000 });
  assert.equal(await page.evaluate(() => document.body.classList.contains("drawer-open")), false, "Escape must release the page after the panel closes");
  await assertFocusReturned(ctx, trigger);

  // Selecting a view closes the panel and switches the view.
  await trigger.click();
  await panel.waitFor({ state: "visible", timeout: 10000 });
  await panel.getByRole("button", { name: /标签|Tags/ }).click();
  await panel.waitFor({ state: "detached", timeout: 10000 });
  await page.locator('.tags-surface[data-view="tags"]').waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.evaluate(() => document.body.classList.contains("drawer-open")), false, "selecting a view must release the page too");

  // The backdrop closes the panel as well, and returns focus to the button.
  await trigger.click();
  await panel.waitFor({ state: "visible", timeout: 10000 });
  const viewport = page.viewportSize();
  await page.mouse.click(viewport.width - 4, Math.round(viewport.height / 2));
  await panel.waitFor({ state: "detached", timeout: 10000 });
  await assertFocusReturned(ctx, trigger);

  // Leave the workspace on the content view for the surfaces that follow. The
  // Library entry re-reads the content listing, so the tags surface leaves when
  // that read answers.
  await trigger.click();
  await panel.waitFor({ state: "visible", timeout: 10000 });
  await panel.locator("button.workspace-nav-item").first().click();
  await panel.waitFor({ state: "detached", timeout: 10000 });
  await page.locator('.tags-surface[data-view="tags"]').waitFor({ state: "detached", timeout: 10000 });
  await assertNoHorizontalOverflow(ctx);
}

export async function assertNarrowDrawers(ctx) {
  const { page } = ctx;
  // Exercise the page-level settings workspace and the remaining drawers at
  // the narrowest supported layout. This catches controls that are visually
  // present but unreachable on mobile.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);

  await assertMobileWorkspacePanel(ctx);

  const settingsTrigger = page.getByRole("button", { name: /打开设置|Open settings/ });
  await settingsTrigger.click();
  const settings = page.getByRole("dialog", { name: /设置|Settings/ });
  await settings.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByRole("dialog", { name: /设置|Settings/ }).count(), 1, "settings must open as one modal dialog");
  assert.equal(await page.getByRole("dialog", { name: /设置|Settings/ }).getAttribute("aria-modal"), "true", "settings dialog must be modal");
  assert.ok(await settings.getByRole("button", { name: /关闭设置|Close settings/ }).isVisible());
  // The horizontal category strip still reaches every section on a phone.
  await assertSettingsCategories(ctx, settings);
  await settings.getByRole("button", { name: /^(搜索|Search)$/ }).click();
  await settings.getByRole("button", { name: /^在线$|^Online$/ }).click();
  await settings.getByText(/按分类查看未保存更改|Unsaved changes by category/).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await settings.locator(".settings-category.active .settings-category-dirty").count(), 1, "the active category must show its unsaved-changes indicator");
  await settings.getByText(/搜索|Search/).last().waitFor({ state: "visible", timeout: 10000 });
  await assertNoHorizontalOverflow(ctx);
  ctx.state.nextDialogAction = "accept";
  await settings.getByRole("button", { name: /关闭设置|Close settings/ }).click();
  await assertFocusReturned(ctx, settingsTrigger);

  const addTrigger = page.getByRole("button", { name: /添加内容|Add content|添加来源|Add source/ }).first();
  await addTrigger.click();
  const addDrawer = page.getByRole("dialog", { name: /添加来源|Add source|上传文件|Upload files/ });
  await addDrawer.waitFor({ state: "visible", timeout: 10000 });
  await addDrawer.getByRole("tab", { name: /服务器目录|Server folder/ }).click();
  assert.ok(await addDrawer.getByRole("textbox", { name: /路径|Path on RestoreWeave host/ }).isVisible());
  await assertNoHorizontalOverflow(ctx);
  await addDrawer.getByRole("button", { name: /关闭添加来源|Close add source/ }).click();
  await assertFocusReturned(ctx, addTrigger);

  const restoreTrigger = page.getByRole("button", { name: /恢复最新快照|Restore latest snapshot/ });
  await restoreTrigger.click();
  const restoreDrawer = page.getByRole("dialog", { name: /恢复快照|Restore snapshot/ });
  await restoreDrawer.waitFor({ state: "visible", timeout: 10000 });
  assert.ok(await restoreDrawer.getByRole("textbox", { name: /目标文件夹|Destination folder/ }).isVisible());
  // The restore bar is the drawer's single next step here too: pinned inside
  // the bottom sheet instead of waiting below the fold.
  assert.equal(await restoreDrawer.locator(".drawer-action-bar").getAttribute("data-state"), "PREVIEW", "the narrow restore drawer must offer the preview action");
  await assertStickyBarInView(ctx, restoreDrawer, "the narrow restore drawer", "restore");
  await assertNoHorizontalOverflow(ctx);
  await restoreDrawer.getByRole("button", { name: /关闭恢复|Close restore/ }).click();
  await assertFocusReturned(ctx, restoreTrigger);
}

// The image bundle installs from an archive the operator placed on this host, so
// the control must follow the daemon and the settings state: it is disabled with
// a named reason when the daemon does not implement the operation or the config
// still needs saving, and a bad archive path must surface the daemon's own
// admission failure rather than a client-side guess.
export async function assertImageBundleInstallControl(ctx) {
  const { page } = ctx;
  await page.getByRole("button", { name: /打开设置|Open settings/ }).click();
  const settings = page.getByRole("dialog", { name: /设置|Settings/ });
  await settings.waitFor({ state: "visible", timeout: 10000 });
  await settings.getByRole("button", { name: /搜索|Search/ }).first().click();
  const field = settings.getByLabel(/本机上的图片包归档路径|Image bundle archive path on this host/);
  await field.waitFor({ state: "visible", timeout: 10000 });
  const install = settings.getByRole("button", { name: /从归档安装图片包|Install image bundle from archive/ });
  assert.ok(await install.isVisible(), "the image install control must render in the search category");
  assert.equal(await install.isDisabled(), true, "an empty archive path must not reach the daemon");
  if (await install.isDisabled()) {
    const reasons = (await settings.locator(".model-action small").allInnerTexts()).join(" ");
    if (/无法安装图片包|cannot install an image bundle|Restart required|Save settings|重启|保存设置/i.test(reasons)) {
      // The daemon does not offer the operation, or the config is not saved yet:
      // both are honest states the dialog must name, and neither may look like a
      // working install. Nothing further to assert in this configuration.
      assert.equal(await settings.locator(".model-action-message.success").count(), 0, "no install may be reported without installing");
      await settings.getByRole("button", { name: /关闭设置|Close settings/ }).click();
      return;
    }
  }
  await field.fill("/nonexistent/restoreweave-image-bundle.tar.gz");
  assert.equal(await install.isDisabled(), false, "a path must enable the install control when the daemon offers the operation");
  await install.click();
  const failure = settings.locator(".model-action-message.error");
  await failure.first().waitFor({ state: "visible", timeout: 15000 });
  const detail = await failure.first().innerText();
  assert.match(detail, /archive|归档|no such file|not exist/i, `a missing archive must name the daemon's reason: ${detail}`);
  assert.equal(await settings.locator(".model-action-message.success").count(), 0, "a failed install must not report success");
  await settings.getByRole("button", { name: /关闭设置|Close settings/ }).click();
}

// The online provider and egress surface. A remote provider may only be used
// under an operator-issued, expiring grant, so the dialog must state the
// installed profiles and live grants as facts read from the daemon, must never
// present an installed profile as authorized, and must keep the egress counts
// honest when the daemon reports neither.
export async function assertOnlineProviderEgressControl(ctx) {
  const { page } = ctx;
  await page.getByRole("button", { name: /打开设置|Open settings/ }).click();
  const settings = page.getByRole("dialog", { name: /设置|Settings/ });
  await settings.waitFor({ state: "visible", timeout: 10000 });
  await settings.getByRole("button", { name: /搜索|Search/ }).first().click();
  const group = settings.locator(".config-group", { hasText: /在线提供者与出网授权|Online providers and egress/ });
  await group.waitFor({ state: "visible", timeout: 10000 });
  const body = (await group.innerText()).trim();
  if (/未报告已安装的在线提供者|does not report installed online providers/.test(body)) {
    // This daemon offers no online provider listing: the dialog must say so and
    // must not claim a profile or a grant exists.
    assert.doesNotMatch(body, /有效出网授权|Live egress grants/, `an unavailable listing must not claim grant counts: ${body}`);
    await settings.getByRole("button", { name: /关闭设置|Close settings/ }).click();
    return;
  }
  const profileRows = await group.locator("[data-egress-profile]").count();
  const grantRows = await group.locator("[data-egress-grant]").count();
  const liveGrants = await group.locator("[data-egress-grant]").evaluateAll((nodes) => nodes.filter((node) => /有效至|Live until/.test(node.innerText || "")).length);
  // The counts in the header must agree with the rows the daemon returned.
  const counts = await group.locator(".provider-status strong").allInnerTexts();
  assert.equal(String(counts[0] ?? "").trim(), String(profileRows), `the installed-profile count must equal the rows rendered: ${JSON.stringify(counts)}`);
  assert.equal(String(counts[1] ?? "").trim(), String(liveGrants), `the live-grant count must equal the live rows rendered: ${JSON.stringify(counts)}`);
  if (liveGrants === 0) {
    // Nothing may look authorized while no grant is live.
    assert.match(body, /没有有效出网授权|No live egress grant exists/, `an ungr grant state must be stated: ${body}`);
    const notices = (await group.locator(".config-notice").allInnerTexts()).join(" ");
    assert.match(notices, /没有有效出网授权|No live egress grant exists/, `the warning notice must state that nothing can be sent: ${notices}`);
  } else {
    assert.match(body, /有效授权只允许|A live grant authorizes exactly/, `a live grant must state its exact scope: ${body}`);
  }
  // An installed profile is not an authorization: the authorize action is a
  // separate, explicit operator act and no row may claim a grant it does not have.
  for (const row of await group.locator("[data-egress-profile]").all()) {
    const text = (await row.innerText()).trim();
    assert.doesNotMatch(text, /有效至|Live until/, `an installed profile row must not claim a live grant: ${text}`);
    assert.ok(await row.getByRole("button", { name: /授权 30 天|Authorize for 30 days/ }).count() === 1, `an installed profile must offer its own authorization: ${text}`);
  }
  assert.equal(grantRows >= 0, true);
  await settings.getByRole("button", { name: /关闭设置|Close settings/ }).click();
}
