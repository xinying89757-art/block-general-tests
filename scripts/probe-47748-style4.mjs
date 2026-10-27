// Verify the two open style questions for 47748 before encoding asserts:
// 1. Does a "details" link appear on a product card on hover?
// 2. After expanding a parent category, what is a VISIBLE child link's
//    lineHeight (design: 44.8; collapsed read was 40)?
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../src/editor.mjs";
import { previewSelector } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId };
try {
  await openEditor(page, config);
  await gotoTargetPage(page, config);
  const rootSel = previewSelector(config.blockId);
  const { previewPage, frame } = await openPreview(page, context);
  try {
    await previewPage.setViewportSize({ width: 1440, height: 900 });
    await frame.waitForTimeout(2500);
    const root = frame.locator(rootSel).first();
    // 1. Hover the first product card, then search for details
    const card = root.locator(".prodlist-pro-name").first();
    await card.scrollIntoViewIfNeeded();
    await card.hover({ timeout: 5000 }).catch((e) => { out.hoverError = e.message; });
    await frame.waitForTimeout(1500);
    out.details = await frame.evaluate((rootSel) => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const rootEl = document.querySelector(rootSel);
      const found = [...rootEl.querySelectorAll("a, button, span")].filter((el) => norm(el.innerText).toLowerCase() === "details");
      return found.map((el) => ({ tag: el.tagName, href: el.getAttribute("href"), visible: el.getClientRects().length > 0, cls: (el.className.baseVal ?? el.className).toString().slice(0, 60) }));
    }, rootSel);
    // Also check: does the card have any hover-revealed element at all?
    out.cardHover = await frame.evaluate((rootSel) => {
      const rootEl = document.querySelector(rootSel);
      const name = rootEl.querySelector(".prodlist-pro-name");
      const card = name ? name.closest("div[class*=prod], li, .one-pruduct-item") : null;
      return card ? { cls: (card.className.baseVal ?? card.className).toString().slice(0, 80), childLinks: [...card.querySelectorAll("a")].map((a) => (a.innerText || "").trim().slice(0, 20)) } : null;
    }, rootSel);

    // 2. Expand a parent category (click its arrow), read visible child links
    out.navExpand = await frame.evaluate((rootSel) => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const rootEl = document.querySelector(rootSel);
      const arrow = rootEl.querySelector(".pf-cate-wrap .slight-submenu-button, .pf-cate-wrap li.prodli > span");
      if (!arrow) return { error: "no expand arrow found" };
      arrow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return { clicked: true };
    }, rootSel);
    await frame.waitForTimeout(1500);
    out.navChildVisible = await frame.evaluate((rootSel) => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const rootEl = document.querySelector(rootSel);
      const links = [...rootEl.querySelectorAll(".pf-cate-wrap a")].filter((a) => a.getClientRects().length > 0);
      return links.slice(0, 6).map((a) => {
        const s = getComputedStyle(a);
        const li = a.closest("li");
        const isParent = !!(li && li.querySelector(":scope > ul, :scope ul"));
        return { text: norm(a.innerText).slice(0, 24), parent: isParent, fontSize: parseFloat(s.fontSize), fontWeight: parseInt(s.fontWeight, 10), lineHeight: parseFloat(s.lineHeight) || null, color: s.color };
      });
    }, rootSel);
  } finally {
    for (const tab of context.pages().filter((t) => t !== page)) { try { if (!tab.isClosed()) await tab.close(); } catch {} }
  }
} catch (error) { out.error = error.message; }
finally {
  fs.writeFileSync("hidden/probe-47748-style4.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close().catch(() => {});
}
