// Search the full operateTools rail HTML (untruncated) for any width
// control, and click the ID button to see what panel it opens. Read-only.
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
  out.railSearch = await canvas.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    const rail = [...doc.querySelectorAll(".siteblocks-setting-operateTools")]
      .find((el) => el.offsetWidth > 0 && el.offsetWidth < 100);
    if (!rail) return { error: "no rail" };
    const html = rail.outerHTML;
    const hits = [];
    for (const kw of ["宽度", "width", "1440", "1200", "max-width", "maxWidth"]) {
      const idx = html.toLowerCase().indexOf(kw.toLowerCase());
      if (idx >= 0) hits.push({ kw, ctx: html.slice(Math.max(0, idx - 150), idx + 250).replace(/\s+/g, " ") });
    }
    const inputs = [...rail.querySelectorAll("input, select")].map((el) => ({
      tag: el.tagName, type: el.getAttribute("type") || "", name: el.getAttribute("name") || "",
      value: el.value ?? "", cls: String(el.className).slice(0, 80) }));
    return { htmlLen: html.length, hits, inputs };
  });
  // Click the ID button and see what opens.
  const rail = () => canvas.locator(".siteblocks-setting-operateTools").nth(1);
  await rail().locator(".block-operate-btn a").first().scrollIntoViewIfNeeded();
  await rail().locator(".block-operate-btn a").first().click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  out.afterIdClick = await canvas.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    const panels = [...doc.querySelectorAll("[class*='operate']")]
      .filter((el) => el.offsetWidth > 100)
      .map((el) => ({ cls: String(el.className).slice(0, 120),
        text: (el.innerText || "").slice(0, 800) }));
    return panels;
  });
  await page.screenshot({ path: "screenshots/probe-47748-id-panel.png", fullPage: false });
} finally {
  fs.writeFileSync("hidden/probe-47748-width-search.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5000));
