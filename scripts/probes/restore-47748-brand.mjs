// Uncheck the Brand display field left checked by the 03-02 run's failed
// restore, then verify and save the page.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor, gotoTargetPage, savePage } from "../../src/editor.mjs";
import { widgetSession, probeControls } from "../../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { blockId: config.blockId };
try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  const session = widgetSession({ page, canvas, config,
    type: "phoenix_blocks_gallery", title: "设置与选取数据", wrapIndex: 1 });
  const probe = await probeControls(session);
  if (probe.reason) throw new Error(probe.reason);
  const brand = probe.controls.find((c) => c.type === "checkbox" && c.label === "Brand");
  out.brandBefore = brand?.checked;
  if (brand?.checked) {
    await session.set(brand, false);
    await session.save();
    await session.open();
    const after = await session.read();
    out.brandAfter = after.find((c) => c.index === brand.index)?.checked;
  }
  await session.cancel();
  await savePage(page);
  out.saved = true;
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/restore-47748-brand.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
