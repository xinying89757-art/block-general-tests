// Style pilot follow-up for 47748:
// 1. Resolve the ambiguous PC diffs with geometry (not just computed values):
//    - button: is the text centered in the 54px button (flex centering
//      makes lineHeight/textAlign irrelevant)?
//    - nav: parent-level links are Bold 16px lh 45 by design, child links
//      Regular 16px lh 44.8 — compare per level, not all against one.
//    - pagination: item height + vertical centering; current page is a
//      <span>, not an <a>.
// 2. Take reviewable viewport screenshots (scrollIntoView + page shot),
//    not element clips: top (button/nav/filter), product grid, pagination
//    at PC; top + grid at Pad and Mobile.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../src/editor.mjs";
import { previewSelector } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId };
let canvas;
try {
  ({ page } = await openEditor(page, config));
  canvas = await gotoTargetPage(page, config);
  const rootSel = previewSelector(config.blockId);
  const { previewPage, frame } = await openPreview(page, context);
  try {
    await previewPage.setViewportSize({ width: 1440, height: 900 });
    await frame.waitForTimeout(2500);
    out.geometry = await frame.evaluate((rootSel) => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const root = document.querySelector(rootSel);
      const center = (outer, inner) => {
        const o = outer.getBoundingClientRect(), i = inner.getBoundingClientRect();
        return { outerH: Math.round(o.height), outerW: Math.round(o.width), textH: Math.round(i.height), textW: Math.round(i.width), dxLeft: +(i.left - o.left).toFixed(1), dxRight: +(o.right - i.right).toFixed(1), dyTop: +(i.top - o.top).toFixed(1), dyBottom: +(o.bottom - i.bottom).toFixed(1) };
      };
      const res = {};
      const btn = [...root.querySelectorAll("a")].find((a) => norm(a.innerText) === "New Machine");
      if (btn) {
        const span = btn.querySelector("*") || btn;
        res.button = { ...center(btn, span), text: norm(btn.innerText), display: getComputedStyle(btn).display, justifyContent: getComputedStyle(btn).justifyContent, alignItems: getComputedStyle(btn).alignItems };
      }
      // Nav: parent items (li with a nested ul) vs leaf items
      const lis = [...root.querySelectorAll(".pf-cate-wrap li.prodli")];
      const parent = lis.find((li) => li.querySelector("ul") && li.querySelector(":scope > a, :scope > div a"));
      const leaf = lis.find((li) => !li.querySelector("ul"));
      const navRow = (li) => {
        if (!li) return null;
        const a = li.querySelector(":scope > a") || li.querySelector("a");
        const s = getComputedStyle(a);
        return { text: norm(a.innerText).slice(0, 24), fontWeight: parseInt(s.fontWeight, 10), lineHeight: parseFloat(s.lineHeight) || null, rowH: Math.round(li.getBoundingClientRect().height), ...center(li, a) };
      };
      res.navParent = navRow(parent);
      res.navLeaf = navRow(leaf);
      // Pagination: current page (span) + a normal link + item box
      const pag = root.querySelector(".pagination, .pf-pagination, [class*=pagination]");
      if (pag) {
        const cur = [...pag.querySelectorAll("span, a, li")].find((el) => norm(el.innerText) === "1" && el.children.length === 0);
        const link = [...pag.querySelectorAll("a")].find((a) => norm(a.innerText) === "2");
        const s = cur ? getComputedStyle(cur) : null;
        res.pagination = {
          current: cur ? { tag: cur.tagName, text: norm(cur.innerText), fontSize: parseFloat(s.fontSize), lineHeight: parseFloat(s.lineHeight) || null, color: s.color, backgroundColor: s.backgroundColor, boxH: Math.round(cur.getBoundingClientRect().height), boxW: Math.round(cur.getBoundingClientRect().width) } : null,
          link2: link ? { fontSize: parseFloat(getComputedStyle(link).fontSize), lineHeight: parseFloat(getComputedStyle(link).lineHeight) || null, color: getComputedStyle(link).color, backgroundColor: getComputedStyle(link).backgroundColor, boxH: Math.round(link.getBoundingClientRect().height), boxW: Math.round(link.getBoundingClientRect().width), ...center(link.parentElement, link) } : null,
        };
      }
      // details link anywhere in the block?
      const det = [...root.querySelectorAll("a")].find((a) => norm(a.innerText).toLowerCase() === "details");
      res.detailsLink = det ? { found: true, href: det.getAttribute("href"), visible: !!det.getClientRects().length } : { found: false };
      // filter select (Please Select dropdown) anywhere in the block?
      const sel = root.querySelector("select");
      res.filterSelect = sel ? { found: true, visible: !!sel.getClientRects().length, options: [...sel.options].slice(0, 3).map((o) => o.text) } : { found: false };
      return res;
    }, rootSel);

    const shot = async (name, scrollTarget) => {
      await frame.evaluate((sel) => {
        const el = sel ? document.querySelector(sel) : null;
        if (el) el.scrollIntoView({ block: "start" });
        else window.scrollTo(0, 0);
      }, scrollTarget);
      await frame.waitForTimeout(1200);
      await previewPage.screenshot({ path: `screenshots/style-47748-${name}.png` });
    };
    await shot("pc-top", rootSel);
    await shot("pc-grid", ".prodlist-pro-name");
    await shot("pc-pagination", ".pagination, .pf-pagination, [class*=pagination]");

    await previewPage.setViewportSize({ width: 768, height: 1024 });
    await frame.waitForTimeout(2500);
    await shot("pad-top", rootSel);
    await shot("pad-grid", ".prodlist-pro-name");

    await previewPage.setViewportSize({ width: 375, height: 667 });
    await frame.waitForTimeout(2500);
    await shot("mobile-top", rootSel);
    await shot("mobile-grid", ".prodlist-pro-name");
  } finally {
    for (const tab of context.pages().filter((t) => t !== page)) { try { if (!tab.isClosed()) await tab.close(); } catch {} }
  }
} catch (error) {
  out.error = error.message;
} finally {
  fs.writeFileSync("hidden/probe-47748-style2.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close().catch(() => {});
}
