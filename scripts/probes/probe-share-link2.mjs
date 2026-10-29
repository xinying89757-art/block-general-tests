// Probe 2: the share panel lives on the PREVIEW page, not the editor.
// Preview page top bar has device icons + a QR icon. Open the preview,
// click the QR icon, patch clipboard.writeText/execCommand to capture what
// "复制分享链接" copies, and dump the panel DOM for the full URL.
// Read-only: no settings changed.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId, steps: [] };
const step = (name, data) => { out.steps.push({ name, ...data }); console.log(name, JSON.stringify(data)); };

try {
  ({ page } = await openEditor(page, config));
  step("open-editor", { ok: true });
  await gotoTargetPage(page, config);
  step("goto-target-page", { ok: true, page: config.resolvedTarget?.page });
  const { previewPage } = await openPreview(page, context);
  step("open-preview", { ok: true, url: previewPage.url() });
  await previewPage.waitForTimeout(3000);

  // 1. Find the QR icon on the preview page (any element, toolbar or not).
  const qr = await previewPage.evaluate(() => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    const cands = [...document.querySelectorAll("a, button, span, div, i, img, svg")].filter((el) => {
      const t = (el.getAttribute("title") || "") + (el.getAttribute("aria-label") || "") + (el.className || "") + (el.getAttribute("alt") || "");
      return /二维码|分享|qr|QR|share/i.test(t) && el.offsetParent !== null;
    }).map((el) => ({
      tag: el.tagName, cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 120),
      title: el.getAttribute("title"), aria: el.getAttribute("aria-label"), text: norm(el.textContent).slice(0, 30),
    }));
    const barText = norm(document.body.innerText).slice(0, 300);
    return { candidates: cands, bodyStart: barText };
  });
  step("qr-search", qr);

  // 2. Click the first QR candidate; fall back to clicking by visible text.
  const clicked = await previewPage.evaluate(() => {
    const cands = [...document.querySelectorAll("a, button, span, div, i, img")].filter((el) => {
      const t = (el.getAttribute("title") || "") + (el.getAttribute("aria-label") || "") + (el.className || "");
      return /二维码|qr/i.test(t) && el.offsetParent !== null;
    });
    if (cands.length) { cands[0].click(); return { ok: true, via: "qr-candidate", el: cands[0].tagName }; }
    return { ok: false, why: "no qr candidate" };
  });
  step("click-qr", clicked);
  await previewPage.waitForTimeout(2000);

  const panel = await previewPage.evaluate(() => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    const panelEl = [...document.querySelectorAll("div")].find((d) => /预览链接有效期/.test(d.textContent || "") && d.offsetParent !== null);
    if (!panelEl) return { found: false };
    const copyBtn = [...panelEl.querySelectorAll("button, a, div")].find((el) => /复制分享链接/.test(el.textContent || ""));
    const imgs = [...panelEl.querySelectorAll("img")].map((im) => ({ src: (im.getAttribute("src") || "").slice(0, 200), alt: im.getAttribute("alt") }));
    const inputs = [...panelEl.querySelectorAll("input")].map((im) => ({ value: (im.value || "").slice(0, 200), type: im.type }));
    return {
      found: true, text: norm(panelEl.textContent).slice(0, 400),
      copyBtn: copyBtn ? { tag: copyBtn.tagName, cls: String(copyBtn.className).slice(0, 120) } : null,
      imgs, inputs,
    };
  });
  step("panel", panel);
  await previewPage.screenshot({ path: "screenshots/probe-share-link2.png", fullPage: false }).catch((e) => step("screenshot", { ok: false, error: String(e.message || e) }));

  // 3. Patch clipboard capture, then click 复制分享链接.
  if (panel.found && panel.copyBtn) {
    await previewPage.evaluate(() => {
      window.__copied = null;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); };
      }
      const origExec = document.execCommand.bind(document);
      document.execCommand = (cmd, ...rest) => {
        if (String(cmd).toLowerCase() === "copy") {
          const sel = document.getSelection && document.getSelection();
          if (sel && sel.toString()) window.__copied = sel.toString();
          const active = document.activeElement;
          if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) window.__copied = active.value;
        }
        return origExec(cmd, ...rest);
      };
    });
    await previewPage.evaluate(() => {
      const panelEl = [...document.querySelectorAll("div")].find((d) => /预览链接有效期/.test(d.textContent || "") && d.offsetParent !== null);
      const btn = [...panelEl.querySelectorAll("button, a, div")].find((el) => /复制分享链接/.test(el.textContent || ""));
      btn.click();
    });
    await previewPage.waitForTimeout(1500);
    const captured = await previewPage.evaluate(() => ({ copied: window.__copied || null }));
    step("captured", captured);
    // Also try a plain clipboard read (may be blocked in Firefox).
    const clip = await previewPage.evaluate(async () => {
      try { return { ok: true, text: await navigator.clipboard.readText() }; }
      catch (e) { return { ok: false, error: String(e.message || e) }; }
    });
    step("clipboard-read", clip);
  }
} catch (e) {
  step("error", { message: String(e.message || e) });
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-share-link2.json", JSON.stringify(out, null, 2));
  await browser.close().catch(() => {});
  console.log("done -> hidden/probe-share-link2.json");
}
