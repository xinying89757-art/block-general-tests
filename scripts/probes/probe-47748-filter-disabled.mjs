// Why won't 47748's preview filter radio check? Dump the input's
// disabled/readonly state, computed pointer-events, and what element is
// actually on top of it at its center point.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId };
try {
  ({ page } = await openEditor(page, config));
  await gotoTargetPage(page, config);
  const { frame } = await openPreview(page, context);
  out.dom = await frame.evaluate((id) => {
    const root = document.querySelector(`.siteblocks-setting-wrap[data-appid="${id}"]`);
    const input = root.querySelector(".pf-field-body label input[type='radio']");
    if (!input) return { error: "input not found" };
    const rect = input.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const cs = getComputedStyle(input);
    const ancestors = [];
    let el = input;
    while (el && ancestors.length < 6) {
      const s = getComputedStyle(el);
      ancestors.push({ tag: el.tagName, cls: String(el.className).slice(0, 80),
        pointerEvents: s.pointerEvents, display: s.display, visibility: s.visibility });
      el = el.parentElement;
    }
    return {
      disabled: input.disabled, readOnly: input.readOnly, checked: input.checked,
      type: input.type, name: input.name, value: input.value,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      computed: { pointerEvents: cs.pointerEvents, opacity: cs.opacity },
      topAtCenter: top ? { tag: top.tagName, cls: String(top.className).slice(0, 120), text: (top.innerText || "").slice(0, 40) } : null,
      ancestors,
    };
  }, config.blockId);
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-47748-filter-disabled.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
