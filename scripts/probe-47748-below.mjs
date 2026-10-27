// Where do the Series/Category panels + list view live? Whole-frame search.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../src/editor.mjs";
import { previewSelector } from "../src/capabilities/shared.mjs";
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
    out.wholeFrame = await frame.evaluate((rootSel) => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const res = {};
      const root = document.querySelector(rootSel);
      res.rootBox = (() => { const r = root.getBoundingClientRect(); return { top: Math.round(r.top + window.scrollY), height: Math.round(r.height) }; })();
      res.docHeight = document.documentElement.scrollHeight;
      // whole-frame search for the search inputs
      const inputs = [...document.querySelectorAll("input")].filter((i) => (i.placeholder || "") === "Please enter the content...");
      res.searchInputs = inputs.map((i) => {
        let p = i, appid = null, cls = "";
        while (p) { if (p.dataset && p.dataset.appid) { appid = p.dataset.appid; cls = (p.className.baseVal ?? p.className).toString().slice(0, 80); break; } p = p.parentElement; }
        const r = i.getBoundingClientRect();
        return { appid, wrapCls: cls, y: Math.round(r.top + window.scrollY), visible: r.width > 0 };
      });
      // Learn More buttons whole-frame
      const lms = [...document.querySelectorAll("a, button")].filter((el) => norm(el.innerText) === "Learn More");
      res.learnMore = lms.slice(0, 3).map((el) => {
        let p = el, appid = null;
        while (p) { if (p.dataset && p.dataset.appid) { appid = p.dataset.appid; break; } p = p.parentElement; }
        return { appid, y: Math.round(el.getBoundingClientRect().top + window.scrollY), visible: el.getClientRects().length > 0 };
      });
      res.learnMoreCount = lms.length;
      // how many block wraps are on the page?
      res.wraps = [...document.querySelectorAll(".siteblocks-setting-wrap[data-appid]")].map((w) => ({ appid: w.dataset.appid, y: Math.round(w.getBoundingClientRect().top + window.scrollY), h: Math.round(w.getBoundingClientRect().height) }));
      // pagination y + what comes right after it (next 3 siblings/elements below)
      const pag = document.querySelector(".pagination");
      if (pag) {
        let el = pag.parentElement, chain = [];
        while (el && chain.length < 4) { chain.push({ tag: el.tagName, cls: (el.className.baseVal ?? el.className).toString().slice(0, 60), y: Math.round(el.getBoundingClientRect().top + window.scrollY) }); el = el.parentElement; }
        res.paginationChain = chain;
      }
      return res;
    }, rootSel);
  } finally {
    for (const tab of context.pages().filter((t) => t !== page)) { try { if (!tab.isClosed()) await tab.close(); } catch {} }
  }
} catch (error) { out.error = error.message; }
finally { fs.writeFileSync("hidden/probe-47748-below.json", JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 2)); await browser.close().catch(() => {}); }
