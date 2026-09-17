// Assertions for the settings dialog and the responsive layout boundaries.
//
// Owner: components/SettingsDialog.tsx, app/useSettings.ts, and the two width
// boundaries the library and the settings modal share. The functions here keep
// the original assertion statements and order and may be extended, never
// weakened.

import assert from "node:assert/strict";
import { assertFocusReturned, assertNoHorizontalOverflow, assertSettingsCategories, assertStickyBarInView, settingsLayoutProbe } from "./support.mjs";

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
  assert.equal(desktopProbe.categoryCount, 5, `1512px settings must list every category: ${JSON.stringify(desktopProbe)}`);
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
  assert.equal(mobileSettings.categoryCount, 5, `640px settings must keep every category reachable: ${JSON.stringify(mobileSettings)}`);
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
  for (const [width, expectRail, expectList] of [[640, false, false], [900, true, false], [1079, true, false], [1080, true, true], [1440, true, true]]) {
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
        list: box(".content-column"),
        inspector: box(".detail-column"),
        detailPosition: detail ? getComputedStyle(detail).position : "",
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    assert.equal(paneGeometry.rail > 0, expectRail, `${width}px navigation rail visibility changed unexpectedly: ${JSON.stringify(paneGeometry)}`);
    assert.equal(paneGeometry.list > 0, expectList, `${width}px list visibility changed unexpectedly: ${JSON.stringify(paneGeometry)}`);
    assert.ok(paneGeometry.inspector > 0, `${width}px inspector is missing: ${JSON.stringify(paneGeometry)}`);
    if (expectRail) assert.ok(paneGeometry.rail >= 160 && paneGeometry.rail <= 230, `${width}px rail width changed unexpectedly: ${JSON.stringify(paneGeometry)}`);
    if (expectList) assert.ok(paneGeometry.list >= 400, `${width}px list is too narrow: ${JSON.stringify(paneGeometry)}`);
    assert.ok(paneGeometry.inspector >= 300, `${width}px inspector is too narrow: ${JSON.stringify(paneGeometry)}`);
    assert.equal(paneGeometry.detailPosition, "static", `${width}px detail pane must stay in normal flow: ${JSON.stringify(paneGeometry)}`);
    assert.equal(paneGeometry.overflow, 0, `${width}px detail layout overflow: ${JSON.stringify(paneGeometry)}`);
  }
}

export async function assertNarrowDrawers(ctx) {
  const { page } = ctx;
  // Exercise the page-level settings workspace and the remaining drawers at
  // the narrowest supported layout. This catches controls that are visually
  // present but unreachable on mobile.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);

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

  const addTrigger = page.getByRole("button", { name: /添加来源|Add source/ }).first();
  await addTrigger.click();
  const addDrawer = page.getByRole("dialog", { name: /添加来源|Add source/ });
  await addDrawer.waitFor({ state: "visible", timeout: 10000 });
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
