// Probe 5: the selected block's center pill toolbar lives in the MAIN
// page (overlay above the canvas iframe). Find small floating elements
// with icon children in the main DOM, click their icons, dump dialogs.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { found: [], after: {} };

async function dump(label) {
  const grab = (ctx, where) => ctx.evaluate((w) => {
    const nodes = [...document.querySelectorAll(
      ".layui-layer, [class*=dialog], [class*=modal], [class*=setting], [class*=Setting]"
    )].filter((n) => n.getClientRects().length && (n.innerText || "").length > 10);
    return nodes.slice(0, 8).map((n) => ({
      where: w, tag: n.tagName, cls: (n.className || "").toString().slice(0, 110),
      src: n.getAttribute?.("src") || "", text: (n.innerText || "").slice(0, 500),
    }));
  }, where).catch((e) => [{ where, error: e.message }]);
  const handle = await page.locator("iframe.backstage-pc-proview").elementHandle();
  const frame = await handle.contentFrame();
  out.after[label] = [...(await grab(page, "main")), ...(await grab(frame, "canvas"))];
}

try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  const blockSel = `.siteblocks-setting-wrap[data-appid="${config.blockId}"]`;
  const block = canvas.locator(blockSel).first();
  await block.scrollIntoViewIfNeeded();
  await block.hover();
  await page.waitForTimeout(800);
  await block.click();
  await page.waitForTimeout(1500);

  out.found = await page.evaluate(() => {
    const els = [...document.querySelectorAll("body *")].filter((n) => {
      const r = n.getBoundingClientRect();
      if (!r.width || r.width > 240 || r.height > 80 || r.height < 15) return false;
      if (r.top < 150 || r.top > 700) return false; // around selected block overlay zone
      const icons = n.querySelectorAll(":scope > * i, :scope > i, :scope > * svg, :scope > svg");
      return icons.length >= 1 && n.children.length <= 5 && getComputedStyle(n).position !== "static";
    });
    return els.slice(0, 12).map((n, idx) => ({
      idx, tag: n.tagName, cls: (n.className || "").toString().slice(0, 120),
      rect: (() => { const r = n.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
      icons: [...n.querySelectorAll("i")].map((x) => (x.className || "").toString().slice(0, 60)),
      text: (n.innerText || "").trim().slice(0, 30),
    }));
  });

  // Click the icons of the most plausible pill (two-icon horizontal pill).
  const pill = out.found.find((f) => f.icons.length >= 2) || out.found[0];
  if (pill) {
    const [x, y, w, h] = pill.rect;
    const iconXs = pill.icons.map((_, i) => x + (w * (i + 0.5)) / pill.icons.length);
    for (let i = 0; i < iconXs.length; i++) {
      await page.mouse.click(iconXs[i], y + h / 2);
      await page.waitForTimeout(2800);
      await page.screenshot({ path: `screenshots/probe-settings5-icon${i}.png` });
      await dump(`icon${i}`);
      await page.evaluate(() => document.querySelectorAll(".layui-layer-close").forEach((n) => n.click())).catch(() => {});
      const handle = await page.locator("iframe.backstage-pc-proview").elementHandle();
      const frame = await handle.contentFrame();
      await frame.evaluate(() => document.querySelectorAll(".layui-layer-close").forEach((n) => n.click())).catch(() => {});
      await page.waitForTimeout(700);
      // Re-select block for next icon (closing may deselect)
      await block.click().catch(() => {});
      await page.waitForTimeout(800);
    }
  }
} finally {
  fs.writeFileSync("hidden/settings-probe5.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 8000));
