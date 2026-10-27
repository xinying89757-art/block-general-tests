// Click the 配色 icon in 47748's right rail, then dump the flyout panel
// that appears (full HTML to file): how many color schemes, their values,
// which is selected. Then click the container telescopic icon and dump
// whatever panel that opens (looking for the module-width control).
// Read-only: nothing is changed or saved.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = { blockId: config.blockId };
try {
  await openEditor(page, config);
  const canvas = await gotoTargetPage(page, config);
  const wrap = canvas.locator(`.siteblocks-setting-wrap[data-appid="${config.blockId}"]`).first();
  await wrap.scrollIntoViewIfNeeded();
  await wrap.click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  const rail = () => canvas.locator(".siteblocks-setting-operateTools").nth(1);
  const dumpPanels = () => canvas.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    const panels = [...doc.querySelectorAll("[class*='operateColor'], [class*='operateBackground'], [class*='operatePadding'], [class*='container-layout'], [class*='operateWidth'], [class*='operateModule']")]
      .filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0)
      .map((el) => ({ cls: String(el.className).slice(0, 120),
        rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
        text: (el.innerText || "").slice(0, 1200),
        html: el.outerHTML.slice(0, 6000) }));
    return panels;
  });
  // 1. 配色
  await rail().locator(".backstage-container-color a").first().scrollIntoViewIfNeeded();
  await rail().locator(".backstage-container-color a").first().click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  out.colorPanel = await dumpPanels();
  await page.screenshot({ path: "screenshots/probe-47748-color-panel.png", fullPage: false });
  // 2. 容器伸缩（找宽度控件）
  await rail().locator(".block_telescopic").first().scrollIntoViewIfNeeded();
  await rail().locator(".block_telescopic").first().click({ timeout: 10000 }).catch((e) => { out.telescopicError = e.message; });
  await page.waitForTimeout(1500);
  out.afterTelescopic = await dumpPanels();
  await page.screenshot({ path: "screenshots/probe-47748-telescopic.png", fullPage: false });
} finally {
  fs.writeFileSync("hidden/probe-47748-color-panel.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
