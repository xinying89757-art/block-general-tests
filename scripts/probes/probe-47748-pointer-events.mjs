// Compare pointer-events across 47748's preview sub-wraps and against
// 40838's: is the whole 47748 block non-interactive in editor preview, or
// only the filter form? Decides whether front-layer interaction is even
// possible for this block.
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
    if (!root) return { error: "wrap not found" };
    const pe = (el) => el ? getComputedStyle(el).pointerEvents : null;
    const pick = (sel) => root.querySelector(sel);
    return {
      root: pe(root),
      btnWrap: pe(pick(".pf-btn-wrap")),
      cateWrap: pe(pick(".pf-cate-wrap")),
      filterWrap: pe(pick(".pf-filter-wrap")),
      filterForm: pe(pick(".prodfield-form")),
      listWrap: pe(pick(".pf-list-wrap")),
      listLink: (() => { const a = pick(".pf-list-wrap a"); return a ? { pe: pe(a), href: a.getAttribute("href") } : null; })(),
      pagination: (() => { const p = [...root.querySelectorAll(".pf-list-wrap *")].find((el) => el.children.length === 0 && el.innerText.trim() === "2"); return p ? { tag: p.tagName, cls: String(p.className).slice(0, 80), pe: pe(p) } : null; })(),
    };
  }, config.blockId);
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-47748-pointer-events.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
