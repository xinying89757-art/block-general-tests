// Restore 40838 after the probe-5 crash: set compare back to OFF and
// uncheck Brand, save the dialog and the page, then verify by reopening.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, savePage } from "../src/editor.mjs";
import { widgetSession, probeControls } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = { blockId: config.blockId };
try {
  await openEditor(page, config);
  const canvas = await gotoTargetPage(page, config);
  const session = widgetSession({ page, canvas, config,
    type: "phoenix_blocks_gallery", title: "设置产品列表", wrapIndex: 0 });
  let probe = await probeControls(session);
  const before = {
    compare: probe.controls.filter((c) => c.type === "radio" && (c.label === "关闭" || c.label === "开启"))
      .map((r) => ({ label: r.label, checked: r.checked })),
    brand: probe.controls.find((c) => c.type === "checkbox" && c.label === "Brand")?.checked ?? null,
  };
  out.before = before;
  const off = probe.controls.find((c) => c.type === "radio" && c.label === "关闭");
  const brand = probe.controls.find((c) => c.type === "checkbox" && c.label === "Brand");
  await session.set(off, true);
  if (brand?.checked) await session.set(brand, false);
  await session.save();
  await savePage(page);
  const session2 = widgetSession({ page, canvas, config,
    type: "phoenix_blocks_gallery", title: "设置产品列表", wrapIndex: 0 });
  probe = await probeControls(session2);
  out.after = {
    compare: probe.controls.filter((c) => c.type === "radio" && (c.label === "关闭" || c.label === "开启"))
      .map((r) => ({ label: r.label, checked: r.checked })),
    brand: probe.controls.find((c) => c.type === "checkbox" && c.label === "Brand")?.checked ?? null,
  };
  await session2.cancel();
} finally {
  fs.writeFileSync("hidden/restore-40838-compare.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
