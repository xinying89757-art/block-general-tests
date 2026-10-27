// Probe: open the settings UI of block 40838 in the editor canvas and
// dump its structure: panel texts, form controls (type/label/options/value).
// Goal: inventory of the block's real setting items.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { steps: [] };
try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  const blockSel = `.siteblocks-setting-wrap[data-appid="${config.blockId}"]`;
  const block = canvas.locator(blockSel).first();
  await block.scrollIntoViewIfNeeded();
  await block.hover();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "screenshots/probe-settings-01-hover.png", fullPage: false });

  // Dump the block's operate toolbar inside the canvas frame.
  const toolbar = await block.evaluate((el) => {
    const wrap = el.closest(".siteblocks-setting-wrap") || el;
    return {
      wrapClass: wrap.className,
      htmlHead: wrap.innerHTML.slice(0, 3000),
    };
  }).catch((e) => ({ error: e.message }));
  out.toolbar = toolbar;

  // Try clicking the block itself first (many builders open settings on click).
  await block.click({ timeout: 8000 }).catch((e) => { out.steps.push("block click failed: " + e.message.split("\n")[0]); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "screenshots/probe-settings-02-clicked.png", fullPage: false });

  // Look for a settings panel anywhere in the main page.
  const dumpPanel = async (label) => {
    const data = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll(
        ".backstage-setting, .setting-panel, .block-setting, [class*=setting], [class*=Setting], .el-drawer, .ant-drawer, [role=dialog]"
      )].filter((n) => n.offsetParent !== null || n.getClientRects().length);
      return candidates.slice(0, 12).map((n) => ({
        cls: n.className?.toString().slice(0, 120),
        text: n.innerText?.slice(0, 300),
      }));
    }).catch((e) => ({ error: e.message }));
    out[label] = data;
  };
  await dumpPanel("panelsAfterClick");

  // If a settings gear exists in the toolbar, click it.
  const gear = canvas.locator(`${blockSel} .operateTools [class*=setting], ${blockSel} [title*=设置], ${blockSel} .icon-setting`).first();
  if (await gear.count()) {
    await gear.click({ timeout: 5000 }).catch((e) => out.steps.push("gear click: " + e.message.split("\n")[0]));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: "screenshots/probe-settings-03-gear.png", fullPage: false });
    await dumpPanel("panelsAfterGear");
  } else {
    out.steps.push("no gear candidate in canvas block toolbar");
  }

  // Full inventory attempt: any visible panel with form controls in main page.
  const controls = await page.evaluate(() => {
    const roots = [...document.querySelectorAll("body *")].filter(
      (n) => n.children.length && /setting|Setting|设置/.test(n.className?.toString() || "") && n.getClientRects().length
    );
    const root = roots.sort((a, b) => b.innerText.length - a.innerText.length)[0];
    if (!root) return null;
    const items = [...root.querySelectorAll("input, select, textarea")].map((c) => ({
      tag: c.tagName, type: c.type || "", name: c.name || "", value: (c.value || "").slice(0, 60),
      checked: c.checked, label: c.closest("label")?.innerText?.slice(0, 60) || "",
    }));
    return { rootClass: root.className?.toString().slice(0, 120), text: root.innerText?.slice(0, 2000), controls: items.slice(0, 80) };
  }).catch((e) => ({ error: e.message }));
  out.controlsInventory = controls;
} finally {
  fs.writeFileSync("hidden/settings-probe.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
