// Dump the filter DOM inside 47748's preview wrap: one .pf-field-group's
// HTML, and any selected-tags container, so the front-layer selectors can
// be generalized from 40838's .prodfield-single structure.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId };
try {
  ({ page } = await openEditor(page, config));
  await gotoTargetPage(page, config);
  const { frame } = await openPreview(page, context);
  out.dom = await frame.evaluate((id) => {
    const root = document.querySelector(`.siteblocks-setting-wrap[data-appid="${id}"]`);
    if (!root) return { error: "wrap not found" };
    const group = root.querySelector(".pf-field-group");
    const selected = [...root.querySelectorAll("[class*='selected' i], [class*='prodfield-bottom'], [class*='tag' i]")].slice(0, 8)
      .map((el) => ({ cls: String(el.className).slice(0, 100), text: (el.innerText || "").slice(0, 80) }));
    const valueEls = group ? [...group.querySelectorAll(".pf-field-body *")].slice(0, 6)
      .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 80), text: (el.innerText || "").slice(0, 40) })) : [];
    return { groupHtml: group ? group.outerHTML.slice(0, 2500) : null, valueEls, selected,
      clearText: [...root.querySelectorAll("*")].filter((el) => el.children.length === 0 && /clear filters/i.test(el.textContent || "")).slice(0, 3).map((el) => el.textContent.trim()) };
  }, config.blockId);
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-47748-filter-dom.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
