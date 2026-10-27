// Probe preview filter groups for 47748: which selectors hold the facet groups?
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId };
try {
  await openEditor(page, config);
  await gotoTargetPage(page, config);
  const { previewPage, frame } = await openPreview(page, context);
  out.groups = await frame.evaluate((id) => {
    const root = document.querySelector(`.siteblocks-setting-wrap[data-appid="${id}"]`);
    if (!root) return { error: "wrap not found" };
    const chain = (el) => {
      const parts = [];
      for (let n = el; n && n !== root.parentElement && parts.length < 6; n = n.parentElement) {
        parts.unshift(`${n.tagName.toLowerCase()}${n.className ? "." + String(n.className).split(" ").slice(0, 3).join(".") : ""}`);
      }
      return parts.join(" > ");
    };
    const prodfield = [...root.querySelectorAll("[class*='prodfield']")].slice(0, 20).map((el) => ({ cls: String(el.className).slice(0, 120), text: (el.innerText || "").slice(0, 80) }));
    const byText = [];
    for (const term of ["测试单选按钮A", "Voltage", "Filter", "品牌", "Series", "Category"]) {
      const els = [...root.querySelectorAll("*")].filter((el) => el.children.length === 0 && (el.textContent || "").trim() === term).slice(0, 3);
      byText.push({ term, found: els.map((el) => chain(el)) });
    }
    // Candidate group containers: elements whose class mentions filter/facet/field
    const candidates = [...root.querySelectorAll("[class*='filter' i], [class*='facet' i], [class*='field' i]")].slice(0, 20).map((el) => ({ cls: String(el.className).slice(0, 120), text: (el.innerText || "").slice(0, 100) }));
    return { prodfieldCount: root.querySelectorAll("[class*='prodfield']").length, prodfield, byText, candidates,
      wrapText: (root.innerText || "").slice(0, 1200) };
  }, config.blockId);
  await previewPage.screenshot({ path: "screenshots/probe-47748-front-groups.png", fullPage: false });
} finally {
  fs.writeFileSync("hidden/probe-47748-front-groups.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
