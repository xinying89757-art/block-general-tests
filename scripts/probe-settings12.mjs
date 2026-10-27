// Probe 12: proper DOM dump of the 产品列表 settings dialog (wrap1):
// climb from .backstage-dialog-bottom up to the dialog root, then list
// every control with its label context, incl. the scrollable field list.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = {};

try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  const blockSel = `.siteblocks-setting-wrap[data-appid="${config.blockId}"]`;
  const frameEl = await page.locator("iframe.backstage-pc-proview").elementHandle();
  const frame = await frameEl.contentFrame();
  const btnId = await frame.evaluate((appid) => {
    const block = document.querySelector(`.siteblocks-setting-wrap[data-appid="${appid}"]`);
    const wraps = [...block.querySelectorAll(".backstage-blocksEditor-wrap")];
    const gallery = wraps.find((w) => w.getAttribute("data-blockseditor-type") === "phoenix_blocks_gallery");
    return gallery?.querySelector("a.backstage-widgettool-btns")?.id;
  }, config.blockId);
  await frame.evaluate((id) => document.getElementById(id)?.click(), btnId);
  await page.waitForTimeout(3500);

  out.dialog = await page.evaluate(() => {
    const footer = [...document.querySelectorAll(".backstage-dialog-bottom")].find((n) => n.getClientRects().length);
    if (!footer) return { error: "no footer" };
    let root = footer;
    for (let i = 0; i < 8 && root.parentElement; i++) {
      root = root.parentElement;
      if ((root.innerText || "").length > 350) break;
    }
    const controls = [...root.querySelectorAll("input, select, textarea")].map((c) => {
      const li = c.closest("li, label, .el-form-item, div");
      return {
        tag: c.tagName, type: c.type || "", value: (c.value ?? "").toString().slice(0, 40),
        checked: !!c.checked,
        context: (li?.innerText || "").trim().replace(/\s+/g, " ").slice(0, 90),
      };
    });
    return {
      rootCls: (root.className || "").toString().slice(0, 100),
      text: (root.innerText || "").trim().slice(0, 2200),
      controls,
    };
  });
} finally {
  fs.writeFileSync("hidden/settings-gallery.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 9000));
