// Expand 47748's collapsed right panel (the 30px .siteblocks-setting-
// operateTools strip at the canvas right edge) and dump its full controls:
// especially 配色's color options and the module-width control. Read-only.
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
  await page.waitForTimeout(1500);
  const strip = canvas.locator(".siteblocks-setting-operateTools").nth(1);
  await strip.scrollIntoViewIfNeeded();
  await strip.click({ timeout: 10000 }).catch((e) => { out.clickError = e.message; });
  await page.waitForTimeout(1500);
  out.panel = await canvas.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    const panels = [...doc.querySelectorAll(".siteblocks-setting-operateTools")].map((el) => ({
      visible: !!(el.offsetWidth || el.offsetHeight),
      rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
      text: (el.innerText || "").slice(0, 1500),
    }));
    const expanded = panels.find((p) => p.visible && p.rect.w > 100);
    let controls = [];
    if (expanded) {
      const el = [...doc.querySelectorAll(".siteblocks-setting-operateTools")]
        .find((n) => n.offsetWidth > 100);
      controls = [...el.querySelectorAll("input, select, textarea, button, a")].map((c) => ({
        tag: c.tagName, type: c.getAttribute("type") || "", name: c.getAttribute("name") || "",
        value: c.value ?? "", checked: c.checked ?? null,
        cls: String(c.className).slice(0, 80), text: (c.innerText || "").trim().slice(0, 60),
        options: c.tagName === "SELECT" ? [...c.options].map((o) => ({ value: o.value, text: o.text })) : undefined,
      }));
    }
    return { panels, controls };
  });
  await page.screenshot({ path: "screenshots/probe-47748-right-panel-open.png", fullPage: false });
  out.screenshot = "screenshots/probe-47748-right-panel-open.png";
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-47748-right-panel-open.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 7000));
