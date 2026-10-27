// Probe oracle 2: why did product-name collection return 0 in preview?
// Dump candidate selector counts and the block area text in the frame.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = {};
try {
  ({ page } = await openEditor(page, config));
  await gotoTargetPage(page, config);
  const { frame } = await openPreview(page, context);
  await page.waitForTimeout(4000);
  out.counts = await frame.evaluate(() => {
    const sels = [
      ".LA40838", ".one-pruduct-list", ".one-pruduct-item", ".prodlist-pro-name",
      ".sitewidget-prodlist", ".prodlistAsync_label", "[class*=prodlist]", "[class*=product]",
      ".prodfield-single", ".prodfield-search", ".prodfield-clear",
    ];
    const r = {};
    for (const s of sels) r[s] = document.querySelectorAll(s).length;
    return r;
  });
  out.blockText = await frame.evaluate(() => {
    const el = document.querySelector(".LA40838");
    return el ? el.innerText.slice(0, 1200) : null;
  });
  out.pageTextTail = await frame.evaluate(() => (document.body.innerText || "").slice(-800));
} finally {
  fs.writeFileSync("hidden/oracle-probe2.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 4500));
