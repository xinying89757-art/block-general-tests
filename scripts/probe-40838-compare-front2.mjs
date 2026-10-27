// Probe 2 for the 40838 compare front effect. Probe 1 searched for the
// Chinese text 对比 on the English site and found nothing; this round
// searches /compare/i, dumps a product card's controls, flips compare ON
// plus checks Brand (so the compare list has an attribute to show),
// verifies persistence by reopening the dialog, then adds two products
// and submits. Restores compare OFF + Brand unchecked at the end.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, savePage, openPreview } from "../src/editor.mjs";
import { widgetSession, probeControls, previewSelector } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId };
async function readListDialog(canvas) {
  const session = widgetSession({ page, canvas, config,
    type: "phoenix_blocks_gallery", title: "设置产品列表", wrapIndex: 0 });
  const probe = await probeControls(session);
  return { session, probe };
}
try {
  await openEditor(page, config);
  const canvas = await gotoTargetPage(page, config);
  let { session, probe } = await readListDialog(canvas);
  const compare = (list) => list.filter((c) => c.type === "radio" && (c.label === "关闭" || c.label === "开启"))
    .map((r) => ({ label: r.label, checked: r.checked }));
  out.compareBefore = compare(probe.controls);
  const brand = probe.controls.find((c) => c.type === "checkbox" && c.label === "Brand");
  out.brandBefore = brand ? { checked: brand.checked, disabled: brand.disabled } : null;
  const on = probe.controls.find((c) => c.type === "radio" && c.label === "开启");
  await session.set(on, true);
  if (brand && !brand.checked) await session.set(brand, true);
  await session.save();
  ({ session, probe } = await readListDialog(canvas));
  out.compareAfterSave = compare(probe.controls);
  out.brandAfterSave = probe.controls.find((c) => c.type === "checkbox" && c.label === "Brand")?.checked ?? null;
  await session.cancel();
  await savePage(page);
  const preview = await openPreview(page, context);
  const frame = preview.frame;
  const previewPage = preview.previewPage;
  const root = frame.locator(previewSelector(config.blockId)).first();
  await root.waitFor({ state: "attached", timeout: 10000 });
  await frame.waitForTimeout(3000);
  out.preview = await root.evaluate((wrap) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const cmp = [...wrap.querySelectorAll("button, a, input, label, [role='button'], span")]
      .filter((el) => /compar/i.test(el.innerText || el.value || el.title || el.getAttribute?.("aria-label") || ""))
      .slice(0, 20)
      .map((el) => ({ tag: el.tagName, text: norm(el.innerText || el.value).slice(0, 50),
        visible: el.offsetWidth > 0 && el.offsetHeight > 0, cls: String(el.className).slice(0, 80) }));
    const item = wrap.querySelector(".one-pruduct-item, .prodlist-pro-name")?.closest("div");
    return { cmp, productCount: wrap.querySelectorAll(".prodlist-pro-name").length,
      firstItemHtml: item ? item.outerHTML.slice(0, 1500) : null };
  });
  out.pageScan = await frame.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const hits = [...document.querySelectorAll("button, a, input, label")]
      .filter((el) => /compar/i.test(el.innerText || el.value || el.title || ""))
      .slice(0, 20)
      .map((el) => ({ tag: el.tagName, text: norm(el.innerText || el.value).slice(0, 60),
        visible: el.offsetWidth > 0 && el.offsetHeight > 0 }));
    return { hits, url: location.href };
  });
  // Click the first two visible compare controls inside the block.
  const addBtns = root.locator("button, a, label", { hasText: /compar/i });
  const count = await addBtns.count();
  out.addControlCount = count;
  out.clicks = [];
  for (let i = 0; i < Math.min(2, count); i++) {
    try {
      const btn = addBtns.nth(i);
      if (!(await btn.isVisible())) { out.clicks.push({ i, ok: false, error: "not visible" }); continue; }
      await btn.scrollIntoViewIfNeeded({ timeout: 5000 });
      await btn.click({ timeout: 10000 });
      out.clicks.push({ i, ok: true });
    } catch (e) { out.clicks.push({ i, ok: false, error: e.message.slice(0, 200) }); }
    await frame.waitForTimeout(1500);
  }
  out.bottomBar = await frame.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const hits = [...document.querySelectorAll("body *")].filter((el) => el.children.length <= 4
      && /compar/i.test(el.innerText || "") && (el.innerText || "").length < 800)
      .slice(0, 8)
      .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 80), text: norm(el.innerText).slice(0, 500) }));
    return { hits, url: location.href };
  });
  const submit = frame.locator("button, a, input[type='submit']", { hasText: /submit|inquir/i }).last();
  out.submitCount = await submit.count();
  if (out.submitCount > 0) {
    try {
      await submit.scrollIntoViewIfNeeded({ timeout: 5000 });
      await submit.click({ timeout: 10000 });
      await frame.waitForTimeout(4000);
    } catch (e) { out.submitError = e.message.slice(0, 300); }
  }
  out.afterSubmit = await frame.evaluate(() => ({
    url: location.href, title: document.title,
    bodyStart: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 500),
  }));
  try { if (!previewPage.isClosed()) await previewPage.close(); } catch {}
  // Restore: compare OFF + Brand unchecked.
  ({ session, probe } = await readListDialog(canvas));
  const off = probe.controls.find((c) => c.type === "radio" && c.label === "关闭");
  const brand2 = probe.controls.find((c) => c.type === "checkbox" && c.label === "Brand");
  await session.set(off, true);
  if (brand2?.checked) await session.set(brand2, false);
  await session.save();
  await savePage(page);
  out.restored = true;
} finally {
  fs.writeFileSync("hidden/probe-40838-compare-front2.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 7000));
