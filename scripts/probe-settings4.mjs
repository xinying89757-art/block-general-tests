// Probe 4: find the entry to the block's own component settings.
// Try: (a) the center pill toolbar icons inside the block editor wrap,
// (b) double-click on the block. Dump dialogs after each attempt.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { attempts: [] };

async function getFrame() {
  const handle = await page.locator("iframe.backstage-pc-proview").elementHandle();
  return handle.contentFrame();
}
async function dump(label) {
  const grab = (ctx, where) => ctx.evaluate((w) => {
    const nodes = [...document.querySelectorAll(
      ".layui-layer, [class*=dialog], [class*=modal], [class*=setting-panel], [class*=component-setting]"
    )].filter((n) => n.getClientRects().length);
    return nodes.slice(0, 8).map((n) => ({
      where: w, tag: n.tagName, cls: (n.className || "").toString().slice(0, 110),
      src: n.getAttribute?.("src") || "", text: (n.innerText || "").slice(0, 600),
    }));
  }, where).catch((e) => [{ where, error: e.message }]);
  const frame = await getFrame();
  out[label] = [...(await grab(page, "main")), ...(await grab(frame, "canvas"))];
}

try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  const blockSel = `.siteblocks-setting-wrap[data-appid="${config.blockId}"]`;
  const block = canvas.locator(blockSel).first();
  await block.scrollIntoViewIfNeeded();
  await block.hover();
  await page.waitForTimeout(800);
  await block.click();
  await page.waitForTimeout(1200);

  // (a) pill toolbar: visible elements inside the block wrap but outside
  // .siteblocks-container content, with icon children.
  const frame = await getFrame();
  const pill = await frame.evaluate((appid) => {
    const wrap = document.querySelector(`.siteblocks-setting-wrap[data-appid="${appid}"]`);
    if (!wrap) return null;
    const els = [...wrap.querySelectorAll("*")].filter((n) => {
      if (n.closest(".siteblocks-container")) return false;
      if (n.closest(".siteblocks-setting-operateTools")) return false;
      const r = n.getClientRects();
      if (!r.length) return false;
      return n.querySelectorAll("i, svg, img").length >= 1 && n.children.length <= 4;
    });
    return els.slice(0, 15).map((n) => ({
      tag: n.tagName, cls: (n.className || "").toString().slice(0, 110),
      icons: [...n.querySelectorAll("i")].map((x) => (x.className || "").toString().slice(0, 50)),
      text: (n.innerText || "").trim().slice(0, 30),
      rect: (() => { const r = n.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
    }));
  }, config.blockId);
  out.pillCandidates = pill;

  // Click each candidate that looks like a small toolbar (width<200, height<60)
  const candidates = (pill || []).filter((c) => c.rect[2] < 220 && c.rect[3] < 70 && c.rect[2] > 20);
  for (let i = 0; i < Math.min(candidates.length, 4); i++) {
    const c = candidates[i];
    try {
      await frame.evaluate(({ appid, cls }) => {
        const wrap = document.querySelector(`.siteblocks-setting-wrap[data-appid="${appid}"]`);
        const el = [...wrap.querySelectorAll("*")].find((n) => (n.className || "").toString() === cls);
        el?.click();
      }, { appid: config.blockId, cls: c.cls });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `screenshots/probe-settings4-pill${i}.png` });
      await dump(`pill${i}`);
      out.attempts.push(`pill ${i} (${c.cls}) clicked`);
      await page.evaluate(() => document.querySelectorAll(".layui-layer-close").forEach((x) => x.click())).catch(() => {});
      const f2 = await getFrame();
      await f2.evaluate(() => document.querySelectorAll(".layui-layer-close").forEach((x) => x.click())).catch(() => {});
      await page.waitForTimeout(600);
    } catch (e) { out.attempts.push(`pill ${i}: ${e.message.split("\n")[0]}`); }
  }

  // (b) double-click the block content
  await block.dblclick({ timeout: 5000 }).catch((e) => out.attempts.push("dblclick: " + e.message.split("\n")[0]));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "screenshots/probe-settings4-dblclick.png" });
  await dump("dblclick");
} finally {
  fs.writeFileSync("hidden/settings-probe4.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 7000));
