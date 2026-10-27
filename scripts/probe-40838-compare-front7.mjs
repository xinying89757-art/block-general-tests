// Probe 7 for the 40838 compare front effect. Probe 6 showed the large
// panel expands visually with a product grid, but the <table> read empty
// at 3s. This round polls the large panel's text for 10s after clicking
// Compare, dumps which elements hold the product names (table cells or
// divs?), and lists the attribute rows (does Brand / 小狗狗 appear?).
// Restore runs in a finally block.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, savePage, openPreview } from "../src/editor.mjs";
import { widgetSession, probeControls, previewSelector } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId };
let canvas;
async function readListDialog() {
  const session = widgetSession({ page, canvas, config,
    type: "phoenix_blocks_gallery", title: "设置产品列表", wrapIndex: 0 });
  const probe = await probeControls(session);
  return { session, probe };
}
try {
  await openEditor(page, config);
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
    const frame = preview.frame;
    const previewPage = preview.previewPage;
    const root = frame.locator(previewSelector(config.blockId)).first();
    await root.waitFor({ state: "attached", timeout: 10000 });
    await frame.waitForTimeout(3000);
    const boxes = root.locator("input.compared-input:visible");
    for (let i = 0; i < 2; i++) { await boxes.nth(i).check({ timeout: 10000 }); await frame.waitForTimeout(1200); }
    await frame.locator(".compareMenu .compareButton").first().click({ timeout: 10000 });
    out.poll = [];
    for (let s = 0; s <= 10; s++) {
      const snap = await frame.evaluate(() => {
        const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
        const large = document.querySelector(".compareMenu_large");
        const table = document.querySelector(".compareMenu .table-wrap table");
        return { largeText: large ? norm(large.innerText).slice(0, 600) : null,
          tableText: table ? norm(table.innerText).slice(0, 600) : null,
          tableRows: table ? table.rows.length : null,
          tableCells: table ? table.querySelectorAll("td, th").length : null };
      });
      out.poll.push({ s, ...snap });
      if (snap.tableText && snap.tableText.length > 0) break;
      await frame.waitForTimeout(1000);
    }
    out.structure = await frame.evaluate(() => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const large = document.querySelector(".compareMenu_large");
      if (!large) return null;
      // Which elements inside the large panel contain the product names?
      const holders = [...large.querySelectorAll("*")]
        .filter((el) => (el.innerText || "") === "测试产品小何2" || (el.innerText || "") === "测试产品小何1")
        .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 60) }));
      // Row labels: first cell text of each row-like element.
      const rows = [...large.querySelectorAll("tr, .row, [class*='row']")].slice(0, 12)
        .map((el) => norm(el.innerText).slice(0, 120));
      return { largeHtmlHead: large.outerHTML.slice(0, 2500), holders, rows };
    });
    try { if (!previewPage.isClosed()) await previewPage.close(); } catch {}
  } finally {
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
  fs.writeFileSync("hidden/probe-40838-compare-front7.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
