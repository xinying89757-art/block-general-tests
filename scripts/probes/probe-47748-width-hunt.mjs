// Width element hunt in 47748's preview: which element actually carries
// computed max-width 1440px (ancestors and descendants of the block wrap),
// and how wide the inner content renders. Plus: click a category and read
// its color + list change (throwaway preview, no restore needed).
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
  const root = frame.locator(`.siteblocks-setting-wrap[data-appid="${config.blockId}"]`).first();
  out.width = await root.evaluate((wrap) => {
    const cs = (el) => getComputedStyle(el);
    const hits = [];
    let el = wrap;
    while (el && el !== document.body) {
      if (cs(el).maxWidth !== "none") hits.push({ where: "ancestor", tag: el.tagName,
        cls: String(el.className).slice(0, 100), maxWidth: cs(el).maxWidth,
        width: Math.round(el.getBoundingClientRect().width) });
      el = el.parentElement;
    }
    for (const d of wrap.querySelectorAll("*")) {
      if (cs(d).maxWidth !== "none" && cs(d).maxWidth !== "100%") {
        hits.push({ where: "descendant", tag: d.tagName, cls: String(d.className).slice(0, 100),
          maxWidth: cs(d).maxWidth, width: Math.round(d.getBoundingClientRect().width) });
      }
    }
    const listWrap = wrap.querySelector(".pf-list-wrap");
    const cateWrap = wrap.querySelector(".pf-cate-wrap");
    const btnWrap = wrap.querySelector(".pf-btn-wrap");
    return { hits: hits.slice(0, 12),
      widths: { wrap: Math.round(wrap.getBoundingClientRect().width),
        list: listWrap ? Math.round(listWrap.getBoundingClientRect().width) : null,
        cate: cateWrap ? Math.round(cateWrap.getBoundingClientRect().width) : null,
        btn: btnWrap ? Math.round(btnWrap.getBoundingClientRect().width) : null },
      viewportWidth: document.documentElement.clientWidth };
  });
  const cate = root.locator(".pf-cate-wrap a", { hasText: "Hydraulic cylinder" }).first();
  await cate.click({ timeout: 10000 }).catch((e) => { out.cateClickError = e.message; });
  await frame.waitForTimeout(2500);
  out.afterCategoryClick = await root.evaluate((wrap) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const cs = (el) => getComputedStyle(el);
    const all = [...wrap.querySelectorAll(".pf-cate-wrap a")].slice(0, 6)
      .map((el) => ({ text: norm(el.innerText).slice(0, 30), color: cs(el).color,
        bg: cs(el).backgroundColor, cls: String(el.className).slice(0, 80) }));
    const listHead = [...wrap.querySelectorAll(".pf-list-wrap .prodlist-pro-name")].slice(0, 5)
      .map((el) => norm(el.innerText));
    return { all, listHead, url: location.href };
  });
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-47748-width-hunt.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5000));
