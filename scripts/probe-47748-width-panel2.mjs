// Resolve the width panel: how many .moduleWidth elements exist, which one
// is visible, the checked radio + custom value + globalApply label in the
// VISIBLE one, and the save/cancel selectors. Read-only.
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
    return [...doc.querySelectorAll(".moduleWidth")].map((box) => {
      const r = box.getBoundingClientRect();
      const visible = !!(box.offsetWidth || box.offsetHeight);
      return {
        visible, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        cls: String(box.className).slice(0, 100),
        radios: [...box.querySelectorAll("input[name='modulewidth']")].map((el) => ({
          value: el.value, label: (el.closest("label")?.innerText || "").trim(), checked: el.checked })),
        customVal: box.querySelector(".customizeVal")?.value ?? null,
        globalApply: (() => { const c = box.querySelector("input[name='globalApply']");
          if (!c) return null;
          const row = c.closest("p, div, label");
          return { checked: c.checked, label: (row?.innerText || "").trim().slice(0, 100) }; })(),
        saveBtn: (() => { const b = [...box.querySelectorAll("button, a, span, input[type='button']")]
          .find((el) => /保存/.test(el.innerText || el.value || ""));
          return b ? { tag: b.tagName, cls: String(b.className).slice(0, 80), text: (b.innerText || b.value || "").trim() } : null; })(),
        cancelBtn: (() => { const b = [...box.querySelectorAll("button, a, span, input[type='button']")]
          .find((el) => /取消/.test(el.innerText || el.value || ""));
          return b ? { tag: b.tagName, cls: String(b.className).slice(0, 80), text: (b.innerText || b.value || "").trim() } : null; })(),
      };
    });
  });
} finally {
  fs.writeFileSync("hidden/probe-47748-width-panel2.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
