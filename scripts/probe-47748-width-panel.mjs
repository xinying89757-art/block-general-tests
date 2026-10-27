// Expand the 模块展开 (telescopic) section and dump the full .moduleWidth
// HTML: which width radio is checked, the 自定义 option + customizeVal,
// the globalApply checkbox label, and any save/apply control. Read-only.
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
  const rail = () => canvas.locator(".siteblocks-setting-operateTools").nth(1);
  await rail().locator(".block_telescopic").first().scrollIntoViewIfNeeded();
  await rail().locator(".block_telescopic").first().click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  out.width = await canvas.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    const box = doc.querySelector(".moduleWidth");
    if (!box) return { error: "no .moduleWidth" };
    const r = box.getBoundingClientRect();
    return {
      visible: !!(box.offsetWidth || box.offsetHeight),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      text: (box.innerText || "").slice(0, 800),
      radios: [...box.querySelectorAll("input[name='modulewidth']")].map((el) => ({
        value: el.value, label: (el.closest("label")?.innerText || "").trim(), checked: el.checked })),
      customVal: box.querySelector(".customizeVal")?.value ?? null,
      globalApply: (() => { const c = box.querySelector("input[name='globalApply']");
        return c ? { checked: c.checked, label: (c.closest("label")?.innerText || c.parentElement?.innerText || "").trim().slice(0, 80) } : null; })(),
      buttons: [...box.querySelectorAll("button, a, span")].filter((el) => /保存|应用|确定|取消/.test(el.innerText || ""))
        .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 80), text: (el.innerText || "").trim() })),
    };
  });
  await page.screenshot({ path: "screenshots/probe-47748-width-panel.png", fullPage: false });
  out.screenshot = "screenshots/probe-47748-width-panel.png";
} finally {
  fs.writeFileSync("hidden/probe-47748-width-panel.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
