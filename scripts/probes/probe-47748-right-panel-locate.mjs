// Find where the block-level right settings panel lives: search the main
// page and every frame for operateTools/setting panel classes, and list
// the main page's layout containers. Read-only.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { blockId: config.blockId };
try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  const wrap = canvas.locator(`.siteblocks-setting-wrap[data-appid="${config.blockId}"]`).first();
  await wrap.scrollIntoViewIfNeeded();
  await wrap.click({ timeout: 10000 });
  await page.waitForTimeout(2000);
  const findIn = (root) => {
    const hits = [];
    root.querySelectorAll("*").forEach((el) => {
      const cls = String(el.className || "");
      if (/operateTools|setting-operate|right-panel|side-panel|settingPanel/i.test(cls)) {
        hits.push({ tag: el.tagName, cls: cls.slice(0, 120),
          visible: !!(el.offsetWidth || el.offsetHeight),
          text: (el.innerText || "").slice(0, 200) });
      }
    });
    return hits;
  };
  out.mainPage = await page.evaluate((fn) => {
    const f = new Function("return (" + fn + ")(document)");
    return f();
  }, `(${findIn.toString()})`);
  out.mainLayout = await page.evaluate(() => [...document.querySelectorAll("body > div, body > div > div")]
    .slice(0, 20).map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 100),
      w: el.offsetWidth, h: el.offsetHeight })));
  // Canvas frame: same search inside the preview/canvas frame.
  const frame = page.frames().find((f) => f.url().includes("preview.leadong.com") || f.url().includes("editSite"));
  out.frames = page.frames().map((f) => f.url().slice(0, 100));
  if (frame) {
    out.canvasHits = await frame.evaluate((fn) => {
      const f = new Function("return (" + fn + ")(document)");
      return f();
    }, `(${findIn.toString()})`);
  }
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-47748-right-panel-locate.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5000));
