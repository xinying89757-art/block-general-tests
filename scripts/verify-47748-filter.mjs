// Independent re-read: which filter fields are checked on 47748 (products)?
// Uses the proven widgetSession/probeControls path, not the new baseline code.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import { widgetSession, probeControls } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { blockId: config.blockId, checked: [], error: null };
try {
  ({ page } = await openEditor(page, config));
  const { frame: canvas } = await gotoTargetPage(page, config);
  const session = widgetSession({ page, canvas, config,
    type: "phoenix_blocks_filterStyle", title: "设置自定义字段筛选", wrapIndex: 0 });
  const probe = await probeControls(session);
  if (probe.reason) { out.error = probe.reason; }
  else {
    out.checked = probe.controls
      .filter((c) => c.type === "checkbox" && c.checked && c.label !== "全选")
      .map((c) => ({ label: c.label, value: c.value }));
    out.totalCheckboxes = probe.controls.filter((c) => c.type === "checkbox").length;
  }
  try { await session.cancel(); } catch {}
} catch (e) { out.error = e.message; }
finally {
  fs.writeFileSync("hidden/verify-47748-filter.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
