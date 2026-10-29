// Probe 7: hover the block's editable sub-region (filterStyle wrap),
// then inspect what the editor injects: wrapLayer innerHTML, any tools
// elements near the wrap, in both canvas frame and main page.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = {};

async function getFrame() {
  const handle = await page.locator("iframe.backstage-pc-proview").elementHandle();
  return handle.contentFrame();
}

try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  const blockSel = `.siteblocks-setting-wrap[data-appid="${config.blockId}"]`;
  const block = canvas.locator(blockSel).first();
  await block.scrollIntoViewIfNeeded();

  const wrap = canvas.locator(`${blockSel} .backstage-blocksEditor-wrap`).first();
  await wrap.hover();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: "screenshots/probe-settings7-hover-wrap.png" });

  const frame = await getFrame();
  out.wrapInfo = await frame.evaluate((appid) => {
    const wrapEl = document.querySelector(
      `.siteblocks-setting-wrap[data-appid="${appid}"] .backstage-blocksEditor-wrap`);
    if (!wrapEl) return null;
    const layer = wrapEl.querySelector(".backstage-blocksEditor-wrapLayer");
    const parent = wrapEl.parentElement;
    return {
      wrapCls: wrapEl.className,
      layerHTML: layer ? layer.outerHTML.slice(0, 1500) : null,
      parentCls: parent?.className || "",
      parentHTMLtail: parent ? parent.outerHTML.slice(-2000) : "",
      siblings: parent ? [...parent.children].map((c) => `${c.tagName}.${(c.className || "").toString().slice(0, 80)}`) : [],
    };
  }, config.blockId);

  // Any element in the whole frame whose class mentions tools/editor-btn
  // and is currently visible.
  out.toolLike = await frame.evaluate(() => {
    return [...document.querySelectorAll("[class*=tool], [class*=Tool], [class*=editorBtn], [class*=edit-btn], [class*=operate]")]
      .filter((n) => n.getClientRects().length)
      .slice(0, 20)
      .map((n) => ({
        tag: n.tagName, cls: (n.className || "").toString().slice(0, 120),
        rect: (() => { const r = n.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
        html: n.outerHTML.slice(0, 300),
      }));
  });

  // Main page too.
  out.toolLikeMain = await page.evaluate(() => {
    return [...document.querySelectorAll("[class*=tool], [class*=Tool], [class*=editorBtn], [class*=operate]")]
      .filter((n) => n.getClientRects().length)
      .slice(0, 20)
      .map((n) => ({
        tag: n.tagName, cls: (n.className || "").toString().slice(0, 120),
        rect: (() => { const r = n.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
        html: n.outerHTML.slice(0, 300),
      }));
  });
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/settings-probe7.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 7500));
