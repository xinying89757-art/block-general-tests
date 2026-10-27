// Probe 2: click the floating mini-toolbar icons that appear when the
// block is selected (center overlay in canvas) and the right-side main
// toolbar, then dump any settings dialog (layui layer / modal) content.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = { tries: [] };

async function dumpDialogs(where) {
  const grab = async (ctx, label) => {
    try {
      return await ctx.evaluate(() => {
        const nodes = [...document.querySelectorAll(
          ".layui-layer, .el-dialog, .ant-modal, [class*=dialog], [class*=Dialog], [class*=modal], [class*=Modal], iframe[src*=setting], iframe[src*=component]"
        )].filter((n) => n.getClientRects().length);
        return nodes.slice(0, 8).map((n) => ({
          label, tag: n.tagName, cls: (n.className || "").toString().slice(0, 100),
          src: n.getAttribute?.("src") || "", text: (n.innerText || "").slice(0, 500),
        }));
      });
    } catch (e) { return [{ label, error: e.message }]; }
  };
  out[where] = [...(await grab(page, "main")), ...(await grab(canvasFrame, "canvas"))];
}

let canvasFrame;
try {
  await openEditor(page, config);
  const canvas = await gotoTargetPage(page, config);
  // Resolve the actual Frame object for evaluate dumps.
  const handle = await page.locator("iframe.backstage-pc-proview").elementHandle();
  canvasFrame = await handle.contentFrame();

  const blockSel = `.siteblocks-setting-wrap[data-appid="${config.blockId}"]`;
  const block = canvas.locator(blockSel).first();
  await block.scrollIntoViewIfNeeded();
  await block.hover();
  await page.waitForTimeout(1000);
  await block.click();
  await page.waitForTimeout(1500);

  // Enumerate visible small buttons inside the canvas that are NOT part of
  // the block content: likely the floating operate toolbar.
  const candidates = await canvasFrame.evaluate((appid) => {
    const all = [...document.querySelectorAll("a, button, i, span, div")];
    return all.filter((n) => {
      const r = n.getClientRects();
      if (!r.length) return false;
      const cls = (n.className || "").toString();
      return /operate|tool|edit|setting/i.test(cls) && !n.closest(`.siteblocks-setting-wrap[data-appid="${appid}"] .siteblocks-container`);
    }).slice(0, 30).map((n) => ({
      tag: n.tagName, cls: (n.className || "").toString().slice(0, 120),
      title: n.getAttribute("title") || "", text: (n.innerText || "").slice(0, 30),
    }));
  }, config.blockId).catch((e) => ({ error: e.message }));
  out.toolbarCandidates = candidates;

  // Click strategy: elements with class containing 'operateTools' children,
  // in DOM order; try up to 3 buttons, dumping dialogs after each.
  const tools = canvas.locator(".operateTools").first();
  if (await tools.count()) {
    const btns = tools.locator("a, button, i, span");
    const n = Math.min(await btns.count(), 6);
    for (let i = 0; i < n; i++) {
      try {
        await btns.nth(i).click({ timeout: 3000, force: true });
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `screenshots/probe-settings2-tool${i}.png` });
        await dumpDialogs(`afterTool${i}`);
        out.tries.push(`tool ${i} clicked`);
        // Close any layer dialog via its close button to reset state.
        await page.evaluate(() => document.querySelector(".layui-layer-close")?.click()).catch(() => {});
        await canvasFrame.evaluate(() => document.querySelector(".layui-layer-close")?.click()).catch(() => {});
        await page.waitForTimeout(800);
      } catch (e) { out.tries.push(`tool ${i}: ${e.message.split("\n")[0]}`); }
    }
  } else {
    out.tries.push("no .operateTools in canvas");
  }
} finally {
  fs.writeFileSync("hidden/settings-probe2.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 7000));
