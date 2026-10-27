// Dump the visible operateTools icon rail's children (tag/class/title/
// aria-label/rect) so we know which icon opens which section (ID/背景/
// 配色/内边距/上移/下移/复制/删除). Read-only.
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
  out.rail = await canvas.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    const rails = [...doc.querySelectorAll(".siteblocks-setting-operateTools")];
    const rail = rails.find((el) => el.offsetWidth > 0 && el.offsetWidth < 100);
    if (!rail) return { error: "no visible rail", count: rails.length };
    const children = [...rail.querySelectorAll("*")].map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, cls: String(el.className).slice(0, 100),
        title: el.getAttribute("title") || "", aria: el.getAttribute("aria-label") || "",
        text: (el.innerText || "").trim().slice(0, 30),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    }).filter((c) => c.rect.w > 0 && c.rect.h > 0);
    return { railClass: String(rail.className).slice(0, 120),
      railHtml: rail.outerHTML.slice(0, 3000), children };
  });
} finally {
  fs.writeFileSync("hidden/probe-47748-right-panel-rail.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
