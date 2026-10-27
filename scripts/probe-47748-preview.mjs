// Probe preview for 47748: what is the block's preview root, and does it render?
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId };
try {
  ({ page } = await openEditor(page, config));
  await gotoTargetPage(page, config);
  const { previewPage, frame } = await openPreview(page, context);
  out.previewUrl = previewPage.url();
  out.frameUrl = frame.url();
  out.roots = await frame.evaluate((id) => {
    const la = [...document.querySelectorAll(`[class~="LA${id}"]`)].map((el) => ({
      tag: el.tagName, cls: (el.className || "").toString().slice(0, 200),
      text: (el.innerText || "").slice(0, 300),
    }));
    const wraps = [...document.querySelectorAll(`.siteblocks-setting-wrap[data-appid="${id}"]`)].map((el) => ({
      cls: (el.className || "").toString().slice(0, 200), text: (el.innerText || "").slice(0, 200),
    }));
    const allLa = [...document.querySelectorAll("[class*='LA']")].slice(0, 10).map((el) => (el.className || "").toString().slice(0, 120));
    return { la, wraps, allLa, bodyText: (document.body?.innerText || "").slice(0, 800) };
  }, config.blockId);
  await previewPage.screenshot({ path: "screenshots/probe-47748-preview.png", fullPage: false });
} finally {
  fs.writeFileSync("hidden/probe-47748-preview.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5000));
