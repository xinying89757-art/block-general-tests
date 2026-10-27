// Probe: how to get the editor's preview share link (read-only).
// The editor top bar has a QR-code icon; clicking it opens a panel with
// "预览链接有效期7天", a QR code, a truncated URL and a "复制分享链接" button.
// Goal: find the icon/panel/button selectors, click copy, and read the full
// URL back (clipboard first, DOM fallback). No settings are changed.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId, steps: [] };
const step = (name, data) => { out.steps.push({ name, ...data }); console.log(name, JSON.stringify(data)); };

try {
  await context.grantPermissions(["clipboard-read"]).catch((e) => step("grant-clipboard", { ok: false, error: String(e.message || e) }));
  ({ page } = await openEditor(page, config));
  step("open-editor", { ok: true, url: page.url() });

  // 1. Dump the top toolbar: find anything mentioning 分享/预览/二维码.
  const toolbar = await page.evaluate(() => {
    const bar = document.querySelector(".backstage-topToolbar");
    if (!bar) return { found: false };
    const els = [...bar.querySelectorAll("*")].filter((el) => {
      const t = (el.getAttribute("title") || "") + (el.getAttribute("aria-label") || "") + (el.className || "");
      return /分享|预览|二维码|qr|QR/i.test(t);
    }).map((el) => ({
      tag: el.tagName, cls: String(el.className).slice(0, 120),
      title: el.getAttribute("title"), aria: el.getAttribute("aria-label"),
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
    }));
    return { found: true, text: (bar.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300), candidates: els };
  });
  step("toolbar", toolbar);

  // 2. Click the QR icon candidate (first match, else the button whose
  //    innerHTML contains a QR-ish svg/class). Then wait for the panel.
  const clicked = await page.evaluate(() => {
    const bar = document.querySelector(".backstage-topToolbar");
    if (!bar) return { ok: false, why: "no toolbar" };
    const cands = [...bar.querySelectorAll("a, button, span, div, i")].filter((el) => {
      const t = (el.getAttribute("title") || "") + (el.getAttribute("aria-label") || "") + (el.className || "");
      return /二维码|qr/i.test(t) && el.offsetParent !== null;
    });
    if (!cands.length) return { ok: false, why: "no qr candidate" };
    cands[0].click();
    return { ok: true, clicked: cands[0].tagName + "." + String(cands[0].className).slice(0, 80) };
  });
  step("click-qr", clicked);
  await page.waitForTimeout(2000);

  const panel = await page.evaluate(() => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    const panelEl = [...document.querySelectorAll("div")].find((d) => /预览链接有效期/.test(d.textContent || "") && d.offsetParent !== null);
    if (!panelEl) return { found: false };
    const links = [...panelEl.querySelectorAll("a, input")].map((el) => ({
      tag: el.tagName, text: norm(el.textContent).slice(0, 80),
      href: el.getAttribute("href"), value: el.value || undefined,
    }));
    const copyBtn = [...panelEl.querySelectorAll("button, a, div")].find((el) => /复制分享链接/.test(el.textContent || ""));
    return {
      found: true,
      text: norm(panelEl.textContent).slice(0, 400),
      html: panelEl.outerHTML.slice(0, 2000),
      links,
      copyBtn: copyBtn ? { tag: copyBtn.tagName, cls: String(copyBtn.className).slice(0, 120), text: norm(copyBtn.textContent) } : null,
    };
  });
  step("panel", panel);
  await page.screenshot({ path: "screenshots/probe-share-link.png", fullPage: false }).catch((e) => step("screenshot", { ok: false, error: String(e.message || e) }));

  // 3. Click 复制分享链接, then read the clipboard.
  if (panel.found && panel.copyBtn) {
    await page.evaluate(() => {
      const panelEl = [...document.querySelectorAll("div")].find((d) => /预览链接有效期/.test(d.textContent || "") && d.offsetParent !== null);
      const btn = [...panelEl.querySelectorAll("button, a, div")].find((el) => /复制分享链接/.test(el.textContent || ""));
      btn.click();
    });
    await page.waitForTimeout(1500);
    const clip = await page.evaluate(async () => {
      try { return { ok: true, text: await navigator.clipboard.readText() }; }
      catch (e) { return { ok: false, error: String(e.message || e) }; }
    });
    step("clipboard", clip);
    // Fallback: any full URL in the panel DOM (href / input value / data attr).
    const domUrl = await page.evaluate(() => {
      const panelEl = [...document.querySelectorAll("div")].find((d) => /预览链接有效期/.test(d.textContent || "") && d.offsetParent !== null);
      if (!panelEl) return null;
      const hits = [];
      panelEl.querySelectorAll("[href], [value], [data-url], [data-clipboard-text]").forEach((el) => {
        for (const a of ["href", "value", "data-url", "data-clipboard-text"]) {
          const v = el.getAttribute(a);
          if (v && /^https?:\/\//.test(v)) hits.push(v);
        }
      });
      const m = (panelEl.textContent || "").match(/https?:\/\/[^\s"']+/g);
      return { hits, textUrls: m };
    });
    step("dom-url", domUrl);
  }
} catch (e) {
  step("error", { message: String(e.message || e) });
} finally {
  fs.writeFileSync("hidden/probe-share-link.json", JSON.stringify(out, null, 2));
  await browser.close().catch(() => {});
  console.log("done -> hidden/probe-share-link.json");
}
