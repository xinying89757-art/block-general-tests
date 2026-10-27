// Search inside the canvas iframe (iframe.backstage-pc-proview) for the
// right settings panel: .siteblocks-setting-operateTools and any element
// mentioning 配色 / 模块宽度 / 1440. Read-only.
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
  await page.waitForTimeout(2000);
  out.canvas = await canvas.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    const tools = [...doc.querySelectorAll(".siteblocks-setting-operateTools")].map((el) => ({
      visible: !!(el.offsetWidth || el.offsetHeight),
      rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
      text: (el.innerText || "").slice(0, 1000),
    }));
    const keywordEls = [];
    for (const kw of ["配色", "模块宽度", "1440"]) {
      const els = [...doc.querySelectorAll("body *")].filter((el) => el.children.length === 0
        && (el.textContent || "").includes(kw)).slice(0, 5)
        .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 100),
          text: (el.textContent || "").trim().slice(0, 120) }));
      keywordEls.push({ kw, els });
    }
    return { tools, keywordEls };
  });
} finally {
  fs.writeFileSync("hidden/probe-47748-right-panel-canvas.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5000));
