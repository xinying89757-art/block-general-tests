// Configure 47748 so its filter and list render data in preview (user
// confirmed 2026-10-26: the block shows nothing until it is configured in
// the backend and data is selected). Sets: filter fields 测试单选按钮A +
// 测试下拉列表 (oracle fields with known fixtures); list data source
// 所有产品, pagination 是 (so 20 = per-page count), number 20, display
// fields Brand / Product Code / Model / Brief + the two oracle fields.
// Category and button are left as-is. Verifies by reopening each dialog.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, savePage } from "../src/editor.mjs";
import { widgetSession, probeControls, findControl } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = { blockId: config.blockId, steps: [] };

async function configure({ canvas, title, type, wrapIndex, want }) {
  const step = { title, want: want.map((w) => w.label), set: [], verified: null };
  const session = widgetSession({ page, canvas, config, type, title, wrapIndex });
  try {
    const probe = await probeControls(session);
    if (probe.reason) { step.error = probe.reason; return step; }
    for (const w of want) {
      const target = probe.controls.find((c) => c.label === w.label && c.type === w.type
        && (w.value === undefined || c.value === w.value));
      if (!target) { step.set.push(`${w.label}：未找到`); continue; }
      const current = w.type === "checkbox" || w.type === "radio" ? target.checked : target.value;
      if (current === w.to) { step.set.push(`${w.label}：已是目标值`); continue; }
      await session.set(target, w.to);
      step.set.push(`${w.label}：${String(current)} → ${String(w.to)}`);
    }
    await session.save();
    await session.open();
    const after = await session.read();
    step.verified = want.map((w) => {
      const item = after.find((c) => c.label === w.label && c.type === w.type
        && (w.value === undefined || c.value === w.value));
      const value = item ? (w.type === "checkbox" || w.type === "radio" ? item.checked : item.value) : null;
      return { label: w.label, value, ok: value === w.to };
    });
    step.allVerified = step.verified.every((v) => v.ok);
  } catch (e) { step.error = e.message; }
  finally { try { await session.cancel(); } catch {} }
  return step;
}

try {
  await openEditor(page, config);
  const canvas = await gotoTargetPage(page, config);
  out.steps.push(await configure({ canvas, title: "设置自定义字段筛选",
    type: "phoenix_blocks_filterStyle", wrapIndex: 0,
    want: [
      { label: "测试单选按钮A", type: "checkbox", value: "826554", to: true },
      { label: "测试下拉列表", type: "checkbox", value: "826574", to: true },
    ] }));
  out.steps.push(await configure({ canvas, title: "设置与选取数据",
    type: "phoenix_blocks_gallery", wrapIndex: 1,
    want: [
      { label: "所有产品", type: "radio", to: true },
      { label: "是", type: "radio", to: true },
      { label: "Brand", type: "checkbox", to: true },
      { label: "Product Code", type: "checkbox", to: true },
      { label: "Model", type: "checkbox", to: true },
      { label: "Brief", type: "checkbox", to: true },
      { label: "测试单选按钮A", type: "checkbox", to: true },
      { label: "测试下拉列表", type: "checkbox", to: true },
    ] }));
  // The number input is already 20; with pagination now 是 it means per-page.
  await savePage(page);
  out.saved = true;
  out.allVerified = out.steps.every((s) => s.allVerified);
} finally {
  fs.writeFileSync("hidden/configure-47748.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
