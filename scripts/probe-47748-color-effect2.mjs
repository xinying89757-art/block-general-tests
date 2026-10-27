// Resolve the remaining effect-layer questions for 47748:
// (a) pagination page-number elements and their computed color;
// (b) click a category in preview: does it turn the scheme color, and
//     does the list filter (and how to restore);
// (c) stylesheet rules that color a CHECKED filter option (the selected
//     state cannot be clicked in editor preview);
// (d) the ancestor div[data-type='container'] of the block wrap: computed
//     max-width and rendered width.
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
  const { frame } = await openPreview(page, context);
  const root = frame.locator(`.siteblocks-setting-wrap[data-appid="${config.blockId}"]`).first();
  out.preview = await root.evaluate((wrap) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const cs = (el) => getComputedStyle(el);
    // (a) pagination: leaf elements whose text is a bare page number.
    const pages = [...wrap.querySelectorAll(".pf-list-wrap *")].filter((el) => el.children.length === 0
      && /^[0-9]+$/.test(norm(el.innerText))).slice(0, 6)
      .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 80),
        text: norm(el.innerText), color: cs(el).color, parentCls: String(el.parentElement.className).slice(0, 80) }));
    // (d) ancestor container.
    let container = wrap.closest("div[data-type='container']");
    const containerInfo = container ? { maxWidth: cs(container).maxWidth,
      width: Math.round(container.getBoundingClientRect().width),
      paddingLeft: cs(container).paddingLeft, paddingRight: cs(container).paddingRight,
      boxSizing: cs(container).boxSizing } : null;
    // (c) stylesheet rules mentioning checked/selected inside the filter.
    const rules = [];
    for (const sheet of document.styleSheets) {
      let list;
      try { list = sheet.cssRules; } catch { continue; }
      if (!list) continue;
      for (const rule of list) {
        const sel = rule.selectorText || "";
        if (/checked|selected|\.pf-opt|\.pf-field/i.test(sel) && /color/i.test(rule.style?.cssText || "")) {
          rules.push({ selector: sel.slice(0, 160), css: rule.style.cssText.slice(0, 200) });
        }
      }
    }
    return { pages, containerInfo, checkedRules: rules.slice(0, 15),
      viewportWidth: document.documentElement.clientWidth };
  });
  // (b) click a category and read its color + list change, then restore.
  const cate = root.locator(".pf-cate-wrap a", { hasText: "Hydraulic cylinder" }).first();
  await cate.scrollIntoViewIfNeeded();
  await cate.click({ timeout: 10000 });
  await frame.waitForTimeout(2500);
  out.afterCategoryClick = await root.evaluate((wrap) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const cs = (el) => getComputedStyle(el);
    const clicked = [...wrap.querySelectorAll(".pf-cate-wrap a")].find((el) => norm(el.innerText) === "Hydraulic cylinder");
    const all = [...wrap.querySelectorAll(".pf-cate-wrap a")].slice(0, 5)
      .map((el) => ({ text: norm(el.innerText).slice(0, 30), color: cs(el).color,
        cls: String(el.className).slice(0, 80) }));
    const listHead = [...wrap.querySelectorAll(".pf-list-wrap .prodlist-pro-name")].slice(0, 5)
      .map((el) => norm(el.innerText));
    return { clickedColor: clicked ? cs(clicked).color : null,
      clickedCls: clicked ? String(clicked.className).slice(0, 120) : null, all, listHead };
  });
} finally {
  fs.writeFileSync("hidden/probe-47748-color-effect2.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5000));
