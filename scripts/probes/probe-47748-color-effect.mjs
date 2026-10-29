// Ground the color-scheme + module-width effect assertions: in 47748's
// preview, list every element whose computed color is the scheme color
// rgb(28,69,135); report the button, pagination, category and filter-option
// computed colors; and the container's computed max-width + wrap width.
// Read-only.
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
  out.preview = await frame.evaluate((id) => {
    const root = document.querySelector(`.siteblocks-setting-wrap[data-appid="${id}"]`);
    if (!root) return { error: "wrap not found" };
    const SCHEME = "rgb(28, 69, 135)";
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const cs = (el) => getComputedStyle(el);
    const schemeEls = [...root.querySelectorAll("*")].filter((el) => cs(el).color === SCHEME)
      .slice(0, 30).map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 100),
        text: norm(el.innerText).slice(0, 50), bg: cs(el).backgroundColor }));
    const btn = [...root.querySelectorAll("*")].find((el) => el.children.length === 0 && norm(el.innerText) === "New Machine");
    const btnInfo = btn ? { tag: btn.tagName, cls: String(btn.className).slice(0, 100),
      color: cs(btn).color, bg: cs(btn).backgroundColor,
      parentBg: cs(btn.parentElement).backgroundColor, parentColor: cs(btn.parentElement).color } : null;
    const pagination = [...root.querySelectorAll(".pf-list-wrap a, .pf-list-wrap [class*='page']")]
      .slice(0, 6).map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 80),
        text: norm(el.innerText).slice(0, 20), color: cs(el).color }));
    const categories = [...root.querySelectorAll(".pf-cate-wrap *")].filter((el) => el.children.length === 0)
      .slice(0, 8).map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 80),
        text: norm(el.innerText).slice(0, 40), color: cs(el).color }));
    const filterOpts = [...root.querySelectorAll(".pf-field-body label")].slice(0, 6)
      .map((el) => ({ text: norm(el.innerText).slice(0, 30),
        color: cs(el).color, spanColor: cs(el.querySelector("span")).color,
        checked: el.querySelector("input")?.checked ?? null }));
    const container = root.querySelector("div[data-type='container']");
    const wrapRect = root.getBoundingClientRect();
    return {
      schemeCount: [...root.querySelectorAll("*")].filter((el) => cs(el).color === SCHEME).length,
      schemeEls, btnInfo, pagination, categories, filterOpts,
      container: container ? { maxWidth: cs(container).maxWidth,
        width: Math.round(container.getBoundingClientRect().width) } : null,
      wrapWidth: Math.round(wrapRect.width),
      viewportWidth: document.documentElement.clientWidth,
    };
  }, config.blockId);
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-47748-color-effect.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
