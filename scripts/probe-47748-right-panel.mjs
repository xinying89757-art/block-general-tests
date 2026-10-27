// Inventory the block-level right settings panel for 47748:
// .siteblocks-setting-operateTools in the main editor page. Click the block
// in the canvas first so the panel shows this block's settings, then dump
// the panel's text and every control (tag/type/name/value/checked/options
// plus nearby label text). Read-only: no values are changed.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = { blockId: config.blockId };
try {
  await openEditor(page, config);
  const canvas = await gotoTargetPage(page, config);
  const wrap = canvas.locator(`.siteblocks-setting-wrap[data-appid="${config.blockId}"]`).first();
  await wrap.scrollIntoViewIfNeeded();
  await wrap.click({ timeout: 10000 });
  await page.waitForTimeout(2000);
  out.panel = await page.evaluate(() => {
    const panel = document.querySelector(".siteblocks-setting-operateTools");
    if (!panel) return { error: "panel not found" };
    const labelOf = (el) => {
      const labelled = el.closest("label");
      if (labelled) return (labelled.innerText || "").replace(/\s+/g, " ").trim();
      let node = el.parentElement;
      for (let i = 0; i < 3 && node; i++) {
        const text = [...node.childNodes].filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim()).filter(Boolean).join(" ");
        if (text) return text;
        node = node.parentElement;
      }
      return "";
    };
    const controls = [...panel.querySelectorAll("input, select, textarea, button, [role='radio'], [role='checkbox']")]
      .map((el) => ({
        tag: el.tagName, type: el.getAttribute("type") || el.getAttribute("role") || "",
        name: el.getAttribute("name") || "", value: el.value ?? "",
        checked: el.checked ?? null, disabled: el.disabled ?? null,
        placeholder: el.getAttribute("placeholder") || "",
        cls: String(el.className).slice(0, 80),
        label: labelOf(el),
        options: el.tagName === "SELECT" ? [...el.options].map((o) => ({ value: o.value, text: o.text })) : undefined,
      }));
    return { text: (panel.innerText || "").slice(0, 3000), controlCount: controls.length, controls };
  });
  await page.screenshot({ path: "screenshots/probe-47748-right-panel.png", fullPage: false });
  out.screenshot = "screenshots/probe-47748-right-panel.png";
} finally {
  fs.writeFileSync("hidden/probe-47748-right-panel.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
