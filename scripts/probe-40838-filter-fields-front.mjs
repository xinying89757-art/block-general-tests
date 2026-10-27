// Probe: enable the OTHER custom filter fields on 40838 (single-select,
// multi-select, dropdown types) and check the preview renders a filter
// group for each. Baseline: all 7 fields unchecked (cff-settings-fields).
// The 7 fields (inventory): 测试单选按钮A、测试下拉列表、Series-xiala、
// 测试单选2、测试下拉列表2（超长名）、test1分类、test2分类.
// Restore runs in a finally block: all 7 back to unchecked + page saved.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, savePage, openPreview } from "../src/editor.mjs";
import { widgetSession, probeControls, previewSelector } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId };
let canvas;

async function readFilterDialog() {
  const session = widgetSession({ page, canvas, config,
    type: "phoenix_blocks_filterStyle", title: "设置自定义字段筛选", wrapIndex: 0 });
  const probe = await probeControls(session);
  return { session, probe };
}

// Field checkboxes: value is a pure-digit field ID (sub-options look like
// 826554_1, 全选 has value "on").
const fieldBoxes = (probe) => (probe.controls || []).filter((c) =>
  c.type === "checkbox" && /^\d+$/.test(c.value || ""));

try {
  ({ page } = await openEditor(page, config));
  canvas = await gotoTargetPage(page, config);
  try {
    let { session, probe } = await readFilterDialog();
    const fields = fieldBoxes(probe);
    out.baseline = fields.map((f) => ({ label: f.label, value: f.value, checked: f.checked }));
    out.fieldCount = fields.length;
    // Enable every field that is not already checked.
    for (const f of fields.filter((x) => !x.checked)) await session.set(f, true);
    await session.save();
    await savePage(page);
    out.enabled = fields.map((f) => f.label);

    const preview = await openPreview(page, context);
    const frame = preview.frame;
    const previewPage = preview.previewPage;
    const root = frame.locator(previewSelector(config.blockId)).first();
    await root.waitFor({ state: "attached", timeout: 10000 });
    await frame.waitForTimeout(3000);
    // 40838 filter groups: .prodfield-single, title .prodfield-left-fieldname.
    out.groups = await root.evaluate((wrap) => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      return [...wrap.querySelectorAll(".prodfield-single")].map((g) => {
        const title = norm(g.querySelector(".prodfield-left-fieldname")?.innerText);
        const inputs = [...g.querySelectorAll("input, select")].map((el) => el.tagName.toLowerCase()
          + (el.type ? `:${el.type}` : ""));
        const counts = {};
        inputs.forEach((t) => { counts[t] = (counts[t] || 0) + 1; });
        return { title, inputs: counts,
          options: norm(g.innerText).slice(0, 160) };
      });
    });
    out.groupTitles = out.groups.map((g) => g.title);
    out.missing = out.enabled.filter((name) => !out.groupTitles.includes(name));
    try { if (!previewPage.isClosed()) await previewPage.close(); } catch {}
  } finally {
    try {
      const { session, probe } = await readFilterDialog();
      const fields = fieldBoxes(probe);
      for (const f of fields.filter((x) => x.checked)) await session.set(f, false);
      await session.save();
      await savePage(page);
      const after = await readFilterDialog();
      out.restored = fieldBoxes(after.probe).map((f) => ({ label: f.label, checked: f.checked }));
      await after.session.cancel();
    } catch (e) { out.restoreError = e.message.slice(0, 300); }
  }
} finally {
  fs.writeFileSync("hidden/probe-40838-filter-fields-front.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
