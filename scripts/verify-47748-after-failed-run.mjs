// Verify the persisted 47748 state after the failed 06-02 run: read the
// category dialog (mode + first category), filter dialog (the two
// configured fields + Series-xiala), list dialog (data source, pagination,
// number, Brand), color scheme value, and module width. Read-only: every
// dialog is cancelled, nothing is saved.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import { widgetSession, probeControls } from "../src/capabilities/shared.mjs";
import { openRailPanel, readModuleWidth, RAIL } from "../src/capabilities/rail.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { blockId: config.blockId, state: {} };
try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  async function readDialog({ title, type, wrapIndex, pick }) {
    const session = widgetSession({ page, canvas, config, type, title, wrapIndex });
    try {
      const probe = await probeControls(session);
      if (probe.reason) return { error: probe.reason };
      return pick(probe.controls);
    } finally { try { await session.cancel(); } catch {} }
  }
  out.state.category = await readDialog({ title: "设置产品分类",
    type: "phoenix_blocks_gallery", wrapIndex: 0,
    pick: (controls) => ({
      mode: controls.find((c) => c.type === "radio" && c.checked)?.label,
      firstCategory: (() => { const c = controls.find((c) => c.type === "checkbox" && c.name === "leafProdGroup");
        return c ? { label: (c.label || "").slice(0, 40), checked: c.checked, disabled: c.disabled } : null; })(),
      checkedCount: controls.filter((c) => c.type === "checkbox" && c.name === "leafProdGroup" && c.checked).length,
    }) });
  out.state.filter = await readDialog({ title: "设置自定义字段筛选",
    type: "phoenix_blocks_filterStyle", wrapIndex: 0,
    pick: (controls) => Object.fromEntries(["测试单选按钮A", "测试下拉列表", "Series-xiala"]
      .map((label) => [label, controls.find((c) => c.label === label && /^\d+$/.test(c.value || ""))?.checked ?? null])) });
  out.state.list = await readDialog({ title: "设置与选取数据",
    type: "phoenix_blocks_gallery", wrapIndex: 1,
    pick: (controls) => ({
      dataSource: controls.find((c) => c.type === "radio" && c.name === "selectProdType" && c.checked)?.label,
      pagination: controls.find((c) => c.type === "radio" && c.name === "pagination" && c.checked)?.label,
      number: controls.find((c) => c.type === "text" || c.type === "number")?.value,
      brand: controls.find((c) => c.label === "Brand")?.checked ?? null,
    }) });
  // Color + width via the right rail.
  try {
    await openRailPanel(canvas, config.blockId, RAIL.colorIcon, RAIL.colorPanel);
    const colorPanel = canvas.locator(`${RAIL.colorPanel}:visible`).first();
    out.state.color = await colorPanel.locator(RAIL.colorInput).inputValue({ timeout: 10000 });
    await page.keyboard.press("Escape");
  } catch (e) { out.state.color = `error: ${e.message}`; }
  try {
    await openRailPanel(canvas, config.blockId, RAIL.widthIcon, RAIL.widthPanel);
    const w = await readModuleWidth(canvas);
    out.state.width = { effective: w.effective, customVal: w.customVal, checked: w.checked?.label };
  } catch (e) { out.state.width = `error: ${e.message}`; }
} finally {
  fs.writeFileSync("hidden/verify-47748-after-failed-run.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
