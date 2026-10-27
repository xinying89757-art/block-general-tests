// Probe 5 for the 40838 compare front effect. Probe 4 confirmed the
// bottom bar: fixed `.compareMenu` with product thumbnails, a red
// "Compare(2/6)" button and an "Empty" button. This round dumps the
// bar's HTML + buttons, clicks Compare, records the landing page
// (comparison table? attributes? submit?), clicks submit if present,
// and records the inquiry-form landing. Restores at the end.
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
async function contentFrame(previewPage) {
  const found = previewPage.frames().find((f) => {
    try { return new URL(f.url()).hostname.endsWith(".preview.leadong.com"); } catch { return false; }
  });
  return found || previewPage.mainFrame();
}
try {
  await openEditor(page, config);
  const canvas = await gotoTargetPage(page, config);
  let { session, probe } = await readListDialog(canvas);
  const on = probe.controls.find((c) => c.type === "radio" && c.label === "开启");
  const brand = probe.controls.find((c) => c.type === "checkbox" && c.label === "Brand");
  await session.set(on, true);
  if (brand && !brand.checked) await session.set(brand, true);
  await session.save();
  await savePage(page);
  const preview = await openPreview(page, context);
  let frame = preview.frame;
  const previewPage = preview.previewPage;
  const root = frame.locator(previewSelector(config.blockId)).first();
  await root.waitFor({ state: "attached", timeout: 10000 });
  await frame.waitForTimeout(3000);
  const boxes = root.locator("input.compared-input:visible");
  for (let i = 0; i < 2; i++) { await boxes.nth(i).check({ timeout: 10000 }); await frame.waitForTimeout(1200); }
  out.bar = await frame.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const bar = document.querySelector(".compareMenu");
    if (!bar) return null;
    const wrap = bar.closest(".siteblocks-setting-wrap");
    return { cls: bar.className, inBlockWrap: wrap?.dataset?.appid || null,
      html: bar.outerHTML.slice(0, 2000),
      buttons: [...bar.querySelectorAll("button, a, input")].map((el) => ({
        tag: el.tagName, text: norm(el.innerText || el.value).slice(0, 40),
        cls: String(el.className).slice(0, 80) })) };
  });
  const compareBtn = frame.locator(".compareMenu button, .compareMenu a", { hasText: /^Compare/ }).first();
  out.compareBtnCount = await frame.locator(".compareMenu", { hasText: "Compare" }).count();
  await compareBtn.click({ timeout: 10000 });
  await frame.waitForTimeout(4000);
  frame = await contentFrame(previewPage);
  out.afterCompare = await frame.evaluate(() => ({
    url: location.href, title: document.title,
    bodyStart: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 800),
  }));
  await previewPage.screenshot({ path: "screenshots/probe-compare-after-compare.png", fullPage: false });
  // Look for a submit control on the landing page.
  const submit = frame.locator("button:visible, a:visible, input[type='submit']:visible",
    { hasText: /submit|inquir|confirm/i });
  out.submitCount = await submit.count();
  out.submitTexts = [];
  for (let i = 0; i < Math.min(5, out.submitCount); i++) {
    out.submitTexts.push((await submit.nth(i).innerText().catch(() => "")).slice(0, 60));
  }
  if (out.submitCount > 0) {
    try {
      await submit.first().click({ timeout: 10000 });
      await frame.waitForTimeout(4000);
      frame = await contentFrame(previewPage);
    } catch (e) { out.submitError = e.message.slice(0, 300); }
  }
  out.afterSubmit = await frame.evaluate(() => ({
    url: location.href, title: document.title,
    bodyStart: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 800),
  }));
  await previewPage.screenshot({ path: "screenshots/probe-compare-after-submit.png", fullPage: false });
  out.screenshots = ["screenshots/probe-compare-after-compare.png", "screenshots/probe-compare-after-submit.png"];
  try { if (!previewPage.isClosed()) await previewPage.close(); } catch {}
  ({ session, probe } = await readListDialog(canvas));
  const off = probe.controls.find((c) => c.type === "radio" && c.label === "关闭");
  const brand2 = probe.controls.find((c) => c.type === "checkbox" && c.label === "Brand");
  await session.set(off, true);
  if (brand2?.checked) await session.set(brand2, false);
  await session.save();
  await savePage(page);
  out.restored = true;
} finally {
  fs.writeFileSync("hidden/probe-40838-compare-front5.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 7000));
