// One-off diagnostic: which controls in 47748's filter/list dialogs are
// actually visible? controlsSnapshot records every input in the dialog DOM,
// including conditional sections (field values, category tree, product
// picker) that may be hidden until their parent option is chosen.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../../src/editor.mjs";
import { clickSettings, widgetSession } from "../../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = {};
try {
  ({ page } = await openEditor(page, config));
  const { frame: canvas } = await gotoTargetPage(page, config);
  for (const [key, type, wrapIndex] of [
    ["filter", "phoenix_blocks_filterStyle", 0],
    ["list", "phoenix_blocks_gallery", 1],
  ]) {
    await clickSettings(canvas, config, type, wrapIndex);
    const dialog = page.locator(".backstage-dialog.backstage-dialog-widgetsettinsframe").filter({ visible: true }).first();
    await dialog.waitFor({ state: "visible", timeout: 10000 });
    const title = await dialog.locator(".backstage-dialog-title, .layui-layer-title").first().innerText().catch(() => "");
    const rows = await dialog.evaluate((root) => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      return [...root.querySelectorAll("input, select, textarea")].map((el, index) => {
        const label = norm([...(el.labels || [])].map((n) => n.innerText).join(" ")
          || el.closest("li, label, .el-form-item, div")?.innerText);
        return { index, tag: el.tagName, type: el.type, label: label.slice(0, 50),
          checked: Boolean(el.checked), value: el.value,
          visible: Boolean(el.getClientRects().length)
            && getComputedStyle(el).visibility !== "hidden"
            && getComputedStyle(el).display !== "none" };
      });
    });
    out[key] = { title, total: rows.length,
      visible: rows.filter((r) => r.visible).length,
      hidden: rows.filter((r) => !r.visible).length,
      rows };
    const session = widgetSession({ page, canvas, config, type, title, wrapIndex });
    await session.cancel().catch(() => {});
  }
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-baseline-visibility.json", JSON.stringify(out, null, 2));
  await browser.close();
}
for (const [key, data] of Object.entries(out)) {
  console.log(`${key}（${data.title}）：共 ${data.total} 个控件，可见 ${data.visible} 个，隐藏 ${data.hidden} 个`);
}
