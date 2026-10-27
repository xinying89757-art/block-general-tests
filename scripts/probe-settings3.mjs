// Probe 3: enumerate the selected block's .siteblocks-setting-operateTools
// buttons, click each in turn, and dump any dialog/layer (incl. layer
// iframes) from main page and canvas frame after each click.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = { buttons: [], after: {} };

async function dumpAll(label) {
  const grab = async (ctx, where) => {
    try {
      return await ctx.evaluate(() => {
        const nodes = [...document.querySelectorAll(
          ".layui-layer, .layui-layer iframe, [class*=layer], [class*=dialog], [class*=modal]"
        )].filter((n) => n.getClientRects().length);
        return nodes.slice(0, 10).map((n) => ({
          where, tag: n.tagName, cls: (n.className || "").toString().slice(0, 110),
          src: n.getAttribute?.("src") || "", text: (n.innerText || "").slice(0, 400),
        }));
      });
    } catch (e) { return [{ where, error: e.message }]; }
  };
  const handle = await page.locator("iframe.backstage-pc-proview").elementHandle();
  const frame = await handle.contentFrame();
  out.after[label] = [...(await grab(page, "main")), ...(await grab(frame, "canvas"))];
}

try {
  await openEditor(page, config);
  const canvas = await gotoTargetPage(page, config);
  const blockSel = `.siteblocks-setting-wrap[data-appid="${config.blockId}"]`;
  const block = canvas.locator(blockSel).first();
  await block.scrollIntoViewIfNeeded();
  await block.hover();
  await page.waitForTimeout(800);
  await block.click();
  await page.waitForTimeout(1200);

  const tools = canvas.locator(`${blockSel} .siteblocks-setting-operateTools`).first();
  out.toolsCount = await tools.count();
  if (out.toolsCount) {
    out.buttons = await tools.evaluate((el) =>
      [...el.querySelectorAll(".block-operate-btn, a, button")].map((b, i) => ({
        i, cls: (b.className || "").toString().slice(0, 100),
        icons: [...b.querySelectorAll("i, svg")].map((x) => (x.className?.baseVal || x.className || "").toString().slice(0, 60)),
        title: b.getAttribute("title") || "", text: (b.innerText || "").trim().slice(0, 20),
      })));
    const btns = tools.locator(".block-operate-btn");
    const total = await btns.count();
    for (let i = 0; i < total; i++) {
      try {
        await btns.nth(i).click({ timeout: 3000, force: true });
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `screenshots/probe-settings3-btn${i}.png` });
        await dumpAll(`btn${i}`);
        // close layers in both contexts
        await page.evaluate(() => document.querySelectorAll(".layui-layer-close, .layui-layer-close1").forEach((x) => x.click())).catch(() => {});
        const handle = await page.locator("iframe.backstage-pc-proview").elementHandle();
        const frame = await handle.contentFrame();
        await frame.evaluate(() => document.querySelectorAll(".layui-layer-close, .layui-layer-close1").forEach((x) => x.click())).catch(() => {});
        await page.waitForTimeout(700);
      } catch (e) {
        out.after[`btn${i}`] = [{ error: e.message.split("\n")[0] }];
      }
    }
  }
} finally {
  fs.writeFileSync("hidden/settings-probe3.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 8000));
