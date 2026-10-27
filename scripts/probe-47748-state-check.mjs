// Read-only state check for 47748 after an interrupted run: read the four
// dialogs' current values, cancel out of each, do not save anything.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import { widgetSession, probeControls } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = { blockId: config.blockId, dialogs: [] };
try {
  await openEditor(page, config);
  const canvas = await gotoTargetPage(page, config);
  const specs = [
    { type: "phoenix_blocks_gallery", title: "设置产品分类", wrapIndex: 0 },
    { type: "phoenix_blocks_filterStyle", title: "设置自定义字段筛选", wrapIndex: 0 },
    { type: "phoenix_blocks_gallery", title: "设置与选取数据", wrapIndex: 1 },
  ];
  for (const spec of specs) {
    const session = widgetSession({ page, canvas, config, ...spec });
    const entry = { title: spec.title };
    try {
      const probe = await probeControls(session);
      if (probe.reason) { entry.error = probe.reason; }
      else {
        entry.radios = probe.controls.filter((c) => c.type === "radio" && c.checked).map((c) => `${c.label} (${c.value})`);
        entry.checkedBoxes = probe.controls.filter((c) => c.type === "checkbox" && c.checked).map((c) => c.label.slice(0, 40));
        entry.numbers = probe.controls.filter((c) => ["text", "number"].includes(c.type) && /^\d+$/.test(c.value)).map((c) => `${c.label.slice(0, 30)}=${c.value}`);
      }
    } catch (e) { entry.error = e.message; }
    try { await session.cancel(); } catch {}
    out.dialogs.push(entry);
  }
} finally {
  fs.writeFileSync("hidden/probe-47748-state-check.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
