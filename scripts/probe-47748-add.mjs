// Add 47748 to the target page if not present, using the same flow as run.mjs.
// Then save the page so the block persists for inventory.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, addBlockIfNeeded, savePage } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { blockId: config.blockId, targetPage: config.targetPage };
try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  out.added = await addBlockIfNeeded(page, canvas, config);
  await savePage(page);
  out.saved = true;
  await page.screenshot({ path: "screenshots/probe-47748-added.png", fullPage: false });
} finally {
  fs.writeFileSync("hidden/probe-47748-add.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
