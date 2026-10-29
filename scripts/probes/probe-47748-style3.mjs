// Style pilot probe 3: identify the pagination element(s) + the
// checkbox-panel/list-view seen in the pc-pagination shot, then take
// corrected screenshots with the sticky header offset (scroll the block
// top to 120px below the viewport top).
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../../src/editor.mjs";
import { previewSelector } from "../../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId };
try {
  ({ page } = await openEditor(page, config));
  await gotoTargetPage(page, config);
  const rootSel = previewSelector(config.blockId);
  const { previewPage, frame } = await openPreview(page, context);
  try {
    await previewPage.setViewportSize({ width: 1440, height: 900 });
    await frame.waitForTimeout(2500);
    out.identify = await frame.evaluate((rootSel) => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const root = document.querySelector(rootSel);
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
      const res = {};
      // All pagination-ish elements with visibility + position
      res.paginationCandidates = [...root.querySelectorAll(".pagination, .pf-pagination, [class*=pagination], [class*=Pagination]")].map((el) => ({
        tag: el.tagName, cls: (el.className.baseVal ?? el.className).toString().slice(0, 60), visible: vis(el),
        y: Math.round(el.getBoundingClientRect().top + window.scrollY), text: norm(el.innerText).slice(0, 60),
      }));
      // Learn More / Inquiry buttons: which view are they in?
      const lm = [...root.querySelectorAll("a, button")].filter((el) => /Learn More|Inquiry/.test(norm(el.innerText)));
      res.learnMoreCount = lm.length;
      res.learnMoreSample = lm.slice(0, 2).map((el) => {
        let p = el, view = "";
        while (p && p !== root) { const c = (p.className.baseVal ?? p.className).toString(); if (/list|grid|prodlist/i.test(c)) { view = c.slice(0, 80); break; } p = p.parentElement; }
        return { text: norm(el.innerText), visible: vis(el), view, y: Math.round(el.getBoundingClientRect().top + window.scrollY) };
      });
      // Checkbox panel with "Please enter the content..." + Reset: what is it?
      const search = [...root.querySelectorAll("input")].find((i) => (i.placeholder || "") === "Please enter the content...");
      if (search) {
        let p = search, wrap = null;
        while (p && p !== root) { const c = (p.className.baseVal ?? p.className).toString(); if (/filter|category|panel|drawer|dialog|modal|popup/i.test(c)) { wrap = c.slice(0, 100); break; } p = p.parentElement; }
        res.checkboxPanel = { found: true, visible: vis(search), wrapClass: wrap, y: Math.round(search.getBoundingClientRect().top + window.scrollY), display: getComputedStyle(search).display };
      } else res.checkboxPanel = { found: false };
      // Block top + button position (for offset scrolling)
      const btn = [...root.querySelectorAll("a")].find((a) => norm(a.innerText) === "New Machine");
      res.blockTopY = Math.round(root.getBoundingClientRect().top + window.scrollY);
      res.buttonY = btn ? Math.round(btn.getBoundingClientRect().top + window.scrollY) : null;
      res.scrollY = Math.round(window.scrollY);
      res.stickyHeader = (() => {
        const h = document.querySelector("header, .header, [class*=header]");
        if (!h) return null;
        const s = getComputedStyle(h);
        return { position: s.position, height: Math.round(h.getBoundingClientRect().height) };
      })();
      return res;
    }, rootSel);

    const shotAt = async (name, y) => {
      await frame.evaluate((yy) => window.scrollTo(0, yy), y);
      await frame.waitForTimeout(1200);
      await previewPage.screenshot({ path: `screenshots/style-47748-${name}.png` });
    };
    const topY = out.identify.blockTopY || 0;
    await shotAt("pc-button", Math.max(0, topY - 120));
    // pagination: first visible candidate's y
    const pag = (out.identify.paginationCandidates || []).find((c) => c.visible);
    if (pag) await shotAt("pc-pager", Math.max(0, pag.y - 200));
    out.paginationShot = pag ? pag.y : null;
  } finally {
    for (const tab of context.pages().filter((t) => t !== page)) { try { if (!tab.isClosed()) await tab.close(); } catch {} }
  }
} catch (error) {
  out.error = error.message;
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-47748-style3.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close().catch(() => {});
}
