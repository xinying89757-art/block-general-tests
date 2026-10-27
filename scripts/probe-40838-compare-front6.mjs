// Probe 6 for the 40838 compare front effect. Probe 5 showed the bar's
// real structure: "Compare(2/6)" is a DIV (.compareButton) that expands
// .compareMenu_large with a comparison table, and submit is
// .opt-btn .save ("Inquire", posts #comparedForm to
// /phoenix/admin/prod/inquire). This round clicks Compare, dumps the
// table (which attributes show for the two products?), clicks Inquire,
// and records the landing page. The restore runs in a finally block so
// a mid-probe failure cannot leave compare ON again.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, savePage, openPreview } from "../src/editor.mjs";
import { widgetSession, probeControls, previewSelector } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId };
let canvas;
async function readListDialog() {
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
  ({ page } = await openEditor(page, config));
  canvas = await gotoTargetPage(page, config);
  try {
    let { session, probe } = await readListDialog();
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
    out.compareBoxCount = await boxes.count();
    for (let i = 0; i < 2; i++) { await boxes.nth(i).check({ timeout: 10000 }); await frame.waitForTimeout(1200); }
    out.checkedCount = await root.locator("input.compared-input:visible:checked").count();
    // Expand the comparison table.
    const compareBtn = frame.locator(".compareMenu .compareButton").first();
    await compareBtn.click({ timeout: 10000 });
    await frame.waitForTimeout(3000);
    out.table = await frame.evaluate(() => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const large = document.querySelector(".compareMenu_large");
      const table = document.querySelector(".compareMenu .table-wrap table");
      return { largeCls: large?.className || null,
        tableText: table ? norm(table.innerText).slice(0, 1500) : null,
        tableHtml: table ? table.outerHTML.slice(0, 2000) : null };
    });
    await previewPage.screenshot({ path: "screenshots/probe-compare-table.png", fullPage: false });
    // Submit via Inquire.
    const inquire = frame.locator(".compareMenu_large .opt-btn .save").first();
    out.inquireFound = (await inquire.count()) > 0;
    if (out.inquireFound) {
      await inquire.click({ timeout: 10000 });
      await frame.waitForTimeout(4000);
      frame = await contentFrame(previewPage);
    }
    out.afterInquire = await frame.evaluate(() => ({
      url: location.href, title: document.title,
      bodyStart: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 800),
    }));
    await previewPage.screenshot({ path: "screenshots/probe-compare-inquire.png", fullPage: false });
    out.screenshots = ["screenshots/probe-compare-table.png", "screenshots/probe-compare-inquire.png"];
    try { if (!previewPage.isClosed()) await previewPage.close(); } catch {}
  } finally {
    // Restore compare OFF + Brand unchecked no matter what happened above.
    try {
      const { session, probe } = await readListDialog();
      const off = probe.controls.find((c) => c.type === "radio" && c.label === "关闭");
      const brand2 = probe.controls.find((c) => c.type === "checkbox" && c.label === "Brand");
      await session.set(off, true);
      if (brand2?.checked) await session.set(brand2, false);
      await session.save();
      await savePage(page);
      out.restored = true;
    } catch (e) { out.restoreError = e.message.slice(0, 300); }
  }
} finally {
  fs.writeFileSync("hidden/probe-40838-compare-front6.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 7000));
