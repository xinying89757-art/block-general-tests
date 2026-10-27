// Diagnose the scheme-color Spectrum control in the right rail: does the
// canvas jQuery Spectrum API exist and apply a set, and what does the
// Spectrum popup DOM look like (why is .sp-choose "not visible" in the
// fallback path)? Read-only: never clicks the panel's 保存, and restores
// the input value via the API before exiting.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import { openRailPanel, readSchemeColor, RAIL } from "../src/capabilities/rail.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = { blockId: config.blockId };
try {
  await openEditor(page, config);
  const canvas = await gotoTargetPage(page, config);
  await openRailPanel(canvas, config.blockId, RAIL.colorIcon, RAIL.colorPanel);
  out.initial = await readSchemeColor(canvas);
  out.api = await canvas.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    const win = doc.defaultView;
    const input = doc.querySelector(".siteblocks-setting-operateColor input.siteblocks-setting-color");
    const jq = win.jQuery || win.$;
    const info = { hasJquery: !!jq, hasSpectrum: !!(jq && jq.fn && typeof jq.fn.spectrum === "function"),
      inputValue: input?.value, inputClass: input?.className,
      replacer: !!doc.querySelector(".siteblocks-setting-operateColor .sp-replacer"),
      spContainers: [...doc.querySelectorAll(".sp-container")].length };
    if (info.hasSpectrum) {
      try {
        jq(input).spectrum("set", "#FF0000");
        jq(input).trigger("change");
        info.afterApiSet = input.value;
        info.replacerPreview = doc.querySelector(".siteblocks-setting-operateColor .sp-preview-inner")?.style?.backgroundColor || null;
      } catch (e) { info.apiError = e.message; }
    }
    return info;
  });
  out.afterApi = await readSchemeColor(canvas);
  // Popup path: open the replacer and dump the popup DOM.
  const panel = canvas.locator(`${RAIL.colorPanel}:visible`).first();
  await panel.locator(".sp-replacer").click({ timeout: 10000 });
  await canvas.locator(".sp-container:visible .sp-input").waitFor({ state: "visible", timeout: 10000 });
  out.popup = await canvas.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    const cs = (el) => getComputedStyle(el);
    const vis = (el) => { const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        display: cs(el).display, visibility: cs(el).visibility, opacity: cs(el).opacity }; };
    return [...doc.querySelectorAll(".sp-container")].map((c, i) => {
      const input = c.querySelector(".sp-input");
      const choose = c.querySelector(".sp-choose");
      const cancel = c.querySelector(".sp-cancel");
      return { i, container: vis(c),
        input: input ? { ...vis(input), value: input.value } : null,
        choose: choose ? vis(choose) : null,
        cancel: cancel ? vis(cancel) : null,
        text: (c.innerText || "").replace(/\s+/g, " ").slice(0, 120) };
    });
  });
  // Restore the value via API and close the popup without saving.
  await canvas.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    const win = doc.defaultView;
    const input = doc.querySelector(".siteblocks-setting-operateColor input.siteblocks-setting-color");
    const jq = win.jQuery || win.$;
    if (jq && jq.fn && typeof jq.fn.spectrum === "function") {
      jq(input).spectrum("set", "#1C4587");
      jq(input).trigger("change");
    }
  });
  out.restored = await readSchemeColor(canvas);
  await page.keyboard.press("Escape");
} finally {
  fs.writeFileSync("hidden/probe-47748-spectrum.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
