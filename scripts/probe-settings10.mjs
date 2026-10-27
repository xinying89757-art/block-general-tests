// Probe 10: after opening wrap0 settings, scan EVERY frame of the page
// for the dialog text and dump the matching frame's full form inventory.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { frames: [], inventory: null };

try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  const blockSel = `.siteblocks-setting-wrap[data-appid="${config.blockId}"]`;
  const frameEl = await page.locator("iframe.backstage-pc-proview").elementHandle();
  const frame = await frameEl.contentFrame();
  const btnId = await frame.evaluate((appid) => {
    const block = document.querySelector(`.siteblocks-setting-wrap[data-appid="${appid}"]`);
    return block.querySelector(".backstage-blocksEditor-wrap a.backstage-widgettool-btns")?.id;
  }, config.blockId);
  await frame.evaluate((id) => document.getElementById(id)?.click(), btnId);
  await page.waitForTimeout(4000);

  for (const f of page.frames()) {
    let len = -1, hit = false;
    try {
      const r = await f.evaluate(() => ({
        len: (document.body?.innerText || "").length,
        hit: (document.body?.innerText || "").includes("自定义字段筛选"),
      }));
      len = r.len; hit = r.hit;
    } catch { /* cross-origin or detached */ }
    out.frames.push({ url: f.url().slice(0, 110), name: f.name(), len, hit });
    if (hit && !out.inventory) {
      out.inventory = await f.evaluate(() => {
        const text = document.body.innerText.slice(0, 2500);
        const controls = [...document.querySelectorAll("input, select, textarea")].map((c) => {
          const li = c.closest("li, .el-form-item, label, div");
          return {
            tag: c.tagName, type: c.type || "", value: (c.value ?? "").toString().slice(0, 40),
            checked: !!c.checked,
            context: (li?.innerText || "").trim().replace(/\s+/g, " ").slice(0, 100),
          };
        });
        // Also list items with checkbox semantics (custom UI): elements
        // containing a checkbox input, in DOM order.
        const listItems = [...document.querySelectorAll("li, [class*=item], [class*=field]")]
          .filter((n) => n.querySelector('input[type="checkbox"]'))
          .map((n) => ({
            text: (n.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80),
            checked: !!n.querySelector('input[type="checkbox"]')?.checked,
          }));
        return { text, controls: controls.slice(0, 120), listItems: listItems.slice(0, 60) };
      }).catch((e) => ({ error: e.message }));
    }
  }
} finally {
  fs.writeFileSync("hidden/settings-probe10.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 9000));
