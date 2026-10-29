// Probe 3 for the 40838 compare front effect. Probe 2 found the control:
// each product card carries `input.compared-input[type=checkbox]` +
// bare text "Add to Compare" (two copies per card, grid + list markup).
// This round checks two VISIBLE compare checkboxes, reads the bottom
// compare bar (products + attributes shown), clicks its submit, and
// records the landing page. Restores compare OFF + Brand unchecked.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor, gotoTargetPage, savePage, openPreview } from "../../src/editor.mjs";
import { widgetSession, probeControls, previewSelector } from "../../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId };
async function readListDialog(canvas) {
  const session = widgetSession({ page, canvas, config,
    type: "phoenix_blocks_gallery", title: "设置产品列表", wrapIndex: 0 });
  const probe = await probeControls(session);
  return { session, probe };
}
try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  let { session, probe } = await readListDialog(canvas);
  const on = probe.controls.find((c) => c.type === "radio" && c.label === "开启");
  const brand = probe.controls.find((c) => c.type === "checkbox" && c.label === "Brand");
  await session.set(on, true);
  if (brand && !brand.checked) await session.set(brand, true);
  await session.save();
  await savePage(page);
  const preview = await openPreview(page, context);
  const frame = preview.frame;
  const previewPage = preview.previewPage;
  const root = frame.locator(previewSelector(config.blockId)).first();
  await root.waitFor({ state: "attached", timeout: 10000 });
  await frame.waitForTimeout(3000);
  const boxes = root.locator("input.compared-input:visible");
  out.compareBoxCount = await boxes.count();
  out.checked = [];
  for (let i = 0; i < Math.min(2, out.compareBoxCount); i++) {
    try {
      const box = boxes.nth(i);
      const proid = await box.getAttribute("data-proid");
      await box.check({ timeout: 10000 });
      out.checked.push({ i, proid, checked: await box.isChecked() });
    } catch (e) { out.checked.push({ i, ok: false, error: e.message.slice(0, 200) }); }
    await frame.waitForTimeout(1500);
  }
  out.bottomBar = await frame.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    // The bar appears after checking; find the smallest visible element
    // whose text mentions compare/submit and lists products.
    const hits = [...document.querySelectorAll("body *")]
      .filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0
        && /compar|submit|inquir/i.test(el.innerText || "")
        && (el.innerText || "").length < 1200
        && ![...el.children].some((ch) => /compar|submit/i.test(ch.innerText || "") && (ch.innerText || "").length > 200))
      .slice(0, 10)
      .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 90),
        text: norm(el.innerText).slice(0, 600) }));
    return { hits, url: location.href };
  });
  // The submit control inside the bottom bar: look for visible buttons
  // mentioning submit/compare/inquiry, preferring ones near the page bottom.
  const submitCandidates = frame.locator("button:visible, a:visible, input[type='submit']:visible",
    { hasText: /submit|compare|inquir/i });
  out.submitCandidateCount = await submitCandidates.count();
  out.submitCandidates = [];
  for (let i = 0; i < Math.min(5, out.submitCandidateCount); i++) {
    const el = submitCandidates.nth(i);
    out.submitCandidates.push({ i, text: (await el.innerText().catch(() => "")).slice(0, 60),
      cls: (await el.getAttribute("class").catch(() => ""))?.slice(0, 80) });
  }
  // Prefer a candidate whose text is exactly Submit / Submit Inquiry style,
  // otherwise the last one (usually the bar's action).
  let submitIdx = out.submitCandidates.findIndex((c) => /submit/i.test(c.text));
  if (submitIdx < 0) submitIdx = out.submitCandidateCount - 1;
  out.submitChosen = submitIdx;
  if (submitIdx >= 0) {
    try {
      const el = submitCandidates.nth(submitIdx);
      await el.scrollIntoViewIfNeeded({ timeout: 5000 });
      await el.click({ timeout: 10000 });
      await frame.waitForTimeout(4000);
    } catch (e) { out.submitError = e.message.slice(0, 300); }
  }
  out.afterSubmit = await frame.evaluate(() => ({
    url: location.href, title: document.title,
    bodyStart: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 600),
  }));
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
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-40838-compare-front3.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 7000));
