// Decisive check + repair for the 47748 scheme color: in a fresh session,
// dump EVERY scheme-color input with its owning block (ancestor wrap
// data-appid) and visibility, then set 47748's input via a scoped API
// call on that exact element, verify the normalized value, click the
// panel 保存, save the page, and re-read from a fresh panel open.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, savePage } from "../src/editor.mjs";
import { openRailPanel, readSchemeColor, RAIL } from "../src/capabilities/rail.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { blockId: config.blockId };
try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  out.allInputs = await canvas.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    return [...doc.querySelectorAll(".siteblocks-setting-operateColor input.siteblocks-setting-color")].map((input) => {
      const wrap = input.closest(".siteblocks-setting-wrap");
      const panel = input.closest(".siteblocks-setting-operateColor");
      return { appid: wrap?.dataset?.appid || null,
        visible: panel ? getComputedStyle(panel).display !== "none" && panel.offsetWidth > 0 : false,
        value: input.value };
    });
  });
  await openRailPanel(canvas, config.blockId, RAIL.colorIcon, RAIL.colorPanel);
  out.visiblePanelValue = await readSchemeColor(canvas);
  out.visiblePanelOwner = await canvas.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    const panel = doc.querySelector(".siteblocks-setting-operateColor:not([style*='none'])");
    const vis = [...doc.querySelectorAll(".siteblocks-setting-operateColor")]
      .find((p) => p.offsetWidth > 0);
    return vis?.closest(".siteblocks-setting-wrap")?.dataset?.appid || null;
  });
  // Set 47748's scheme via the API on the exact visible input element.
  const setResult = await canvas.locator(`${RAIL.colorPanel}:visible`).first()
    .locator(RAIL.colorInput).evaluate((input, color) => {
      const win = input.ownerDocument.defaultView;
      const jq = win.jQuery || win.$;
      if (!jq || !jq.fn || typeof jq.fn.spectrum !== "function") return { available: false };
      jq(input).spectrum("set", color);
      jq(input).trigger("change");
      return { available: true, value: input.value };
    }, "#1C4587");
  out.setResult = setResult;
  out.afterSet = await readSchemeColor(canvas);
  // Save the panel, then save the page.
  const panel = canvas.locator(`${RAIL.colorPanel}:visible`).first();
  await panel.locator(RAIL.colorSave).click({ timeout: 10000 });
  await savePage(page);
  // Re-open the panel fresh and read again.
  await openRailPanel(canvas, config.blockId, RAIL.colorIcon, RAIL.colorPanel);
  out.afterSave = await readSchemeColor(canvas);
} finally {
  fs.writeFileSync("hidden/probe-47748-color-restore.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
