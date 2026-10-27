// Probe the product-compare front effect on 40838 (the only block with a
// compare setting): flip compare ON, save, open preview, find the
// "加入对比" entry, add two products, read the bottom compare list
// (which attributes it shows), submit, and record where it lands.
// Restores compare to OFF and saves the page at the end.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, savePage, openPreview } from "../src/editor.mjs";
import { widgetSession, probeControls, previewSelector } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId };
try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  const session = widgetSession({ page, canvas, config,
    type: "phoenix_blocks_gallery", title: "设置产品列表", wrapIndex: 0 });
  const probe = await probeControls(session);
  if (probe.reason) { out.dialogError = probe.reason; throw new Error(probe.reason); }
  const radios = probe.controls.filter((c) => c.type === "radio"
    && (c.label === "关闭" || c.label === "开启"));
  out.compareBefore = radios.map((r) => ({ label: r.label, checked: r.checked }));
  const fields = probe.controls.filter((c) => c.type === "checkbox" && c.value && c.value !== "on" && c.label !== "全选");
  out.displayFields = { total: fields.length,
    checked: fields.filter((f) => f.checked).map((f) => f.label).slice(0, 40) };
  const off = radios.find((r) => r.label === "关闭");
  const on = radios.find((r) => r.label === "开启");
  out.flippedOn = false;
  if (off?.checked) {
    await session.set(on, true);
    await session.save();
    out.flippedOn = true;
  }
  await savePage(page);
  const preview = await openPreview(page, context);
  const frame = preview.frame;
  const previewPage = preview.previewPage;
  const root = frame.locator(previewSelector(config.blockId)).first();
  await root.waitFor({ state: "attached", timeout: 10000 });
  await frame.waitForTimeout(3000);
  out.compareEls = await root.evaluate((wrap) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const els = [...wrap.querySelectorAll("button, a, input, label, [role='button']")]
      .filter((el) => /对比/.test(el.innerText || el.value || el.title || ""))
      .slice(0, 20)
      .map((el) => ({ tag: el.tagName, text: norm(el.innerText || el.value).slice(0, 40),
        visible: el.offsetWidth > 0 && el.offsetHeight > 0,
        cls: String(el.className).slice(0, 80) }));
    const names = [...wrap.querySelectorAll(".prodlist-pro-name")].slice(0, 5).map((el) => norm(el.innerText));
    return { els, productCount: wrap.querySelectorAll(".prodlist-pro-name").length, names };
  });
  // Click the first two visible "加入对比" controls.
  out.clicks = [];
  const addBtns = root.locator("button, a", { hasText: "加入对比" });
  const count = await addBtns.count();
  out.addButtonCount = count;
  for (let i = 0; i < Math.min(2, count); i++) {
    const btn = addBtns.nth(i);
    try {
      await btn.scrollIntoViewIfNeeded({ timeout: 5000 });
      await btn.click({ timeout: 10000 });
      out.clicks.push({ i, ok: true });
    } catch (e) { out.clicks.push({ i, ok: false, error: e.message.slice(0, 200) }); }
    await frame.waitForTimeout(1500);
  }
  out.bottomBar = await frame.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const doc = document;
    // The bottom compare list may live outside the block wrap; scan the page.
    const cands = [...doc.querySelectorAll("body *")].filter((el) => el.children.length <= 3
      && /对比/.test(el.innerText || "") && (el.innerText || "").length < 600)
      .slice(0, 8)
      .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 80), text: norm(el.innerText).slice(0, 400) }));
    const fixed = [...doc.querySelectorAll("[style*='fixed'], [class*='fixed'], [class*='bottom']")]
      .filter((el) => (el.innerText || "").length > 0 && (el.innerText || "").length < 600)
      .slice(0, 8)
      .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 80), text: norm(el.innerText).slice(0, 400) }));
    return { cands, fixed, url: location.href };
  });
  // Submit from the bottom list, if a submit control is visible.
  const submit = frame.locator("button, a, input[type='submit']", { hasText: /提交|询盘|对比/ }).last();
  out.submitFound = (await submit.count()) > 0;
  if (out.submitFound) {
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
  // Restore compare to OFF.
  if (out.flippedOn) {
    const session2 = widgetSession({ page, canvas, config,
      type: "phoenix_blocks_gallery", title: "设置产品列表", wrapIndex: 0 });
    const probe2 = await probeControls(session2);
    const off2 = probe2.controls?.find((c) => c.type === "radio" && c.label === "关闭");
    if (off2) { await session2.set(off2, true); await session2.save(); }
    await savePage(page);
    out.restoredOff = true;
  }
} finally {
  fs.writeFileSync("hidden/probe-40838-compare-front.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
