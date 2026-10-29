// Probe 4 for the 40838 compare front effect. Probe 3 checked two
// compare boxes but no bottom bar surfaced in the text scan, so this
// round looks harder: all fixed-position elements, every class name
// containing "compar", a before/after text diff, a longer wait, and
// screenshots to see what is actually on screen. Restores at the end.
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
  const scan = () => frame.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const fixed = [...document.querySelectorAll("body *")]
      .filter((el) => getComputedStyle(el).position === "fixed" && el.offsetWidth > 0)
      .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 90),
        text: norm(el.innerText).slice(0, 300) }));
    const comparCls = [...document.querySelectorAll("[class*='compar' i], [id*='compar' i]")]
      .slice(0, 20)
      .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 90),
        text: norm(el.innerText).slice(0, 200), visible: el.offsetWidth > 0 }));
    const bodyText = norm(document.body.innerText);
    return { fixed, comparCls, bodyLen: bodyText.length,
      compareCount: (bodyText.match(/compar/gi) || []).length,
      submitCount: (bodyText.match(/submit/gi) || []).length };
  });
  out.before = await scan();
  const boxes = root.locator("input.compared-input:visible");
  out.compareBoxCount = await boxes.count();
  for (let i = 0; i < Math.min(2, out.compareBoxCount); i++) {
    await boxes.nth(i).check({ timeout: 10000 });
    await frame.waitForTimeout(1500);
  }
  out.checkedCount = await root.locator("input.compared-input:visible:checked").count();
  await frame.waitForTimeout(5000);
  out.after = await scan();
  // Where is the bar? Look for any element whose text now contains both
  // checked product names.
  out.barHunt = await frame.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const names = ["测试产品小何2", "测试产品小何1"];
    return [...document.querySelectorAll("body *")]
      .filter((el) => names.every((n) => (el.innerText || "").includes(n))
        && (el.innerText || "").length < 1500)
      .slice(0, 5)
      .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 90),
        text: norm(el.innerText).slice(0, 500) }));
  });
  await previewPage.screenshot({ path: "screenshots/probe-compare-after-check.png", fullPage: false });
  await previewPage.screenshot({ path: "screenshots/probe-compare-after-check-full.png", fullPage: true });
  out.screenshots = ["screenshots/probe-compare-after-check.png", "screenshots/probe-compare-after-check-full.png"];
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
  fs.writeFileSync("hidden/probe-40838-compare-front4.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5000));
