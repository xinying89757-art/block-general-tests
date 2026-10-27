// Click one filter value in 47748's preview (auto-filter is the fixed
// trigger) and dump what changes: where the selected value is shown, how
// the facet groups narrow, and how the product list changes. This decides
// the front-layer selectors for the pf-* filter DOM variant.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId };
try {
  await openEditor(page, config);
  await gotoTargetPage(page, config);
  const { frame } = await openPreview(page, context);
  out.dom = await frame.evaluate(async (id) => {
    const root = document.querySelector(`.siteblocks-setting-wrap[data-appid="${id}"]`);
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const groups = () => [...root.querySelectorAll(".pf-field-group")].map((g) => ({
      title: norm(g.querySelector(".pf-field-title")?.innerText),
      values: [...g.querySelectorAll(".pf-field-body label")].map((l) => norm(l.innerText)),
    }));
    const listItems = () => [...root.querySelectorAll(".pf-list-wrap *")].filter((el) => el.children.length === 0)
      .map((el) => norm(el.innerText)).filter(Boolean).slice(0, 25);
    const before = { groups: groups(), list: listItems() };
    const label = [...root.querySelectorAll(".pf-field-body label")].find((l) => norm(l.innerText) === "单选4-10");
    if (!label) return { error: "value label not found", before };
    label.scrollIntoView({ block: "center" });
    label.click();
    await new Promise((r) => setTimeout(r, 3000));
    const after = { groups: groups(), list: listItems() };
    // Where is the selected value shown outside its group?
    const shown = [...root.querySelectorAll("*")].filter((el) => el.children.length === 0
      && norm(el.innerText) === "单选4-10" && !el.closest(".pf-field-group"))
      .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 120),
        parentCls: String(el.parentElement?.className || "").slice(0, 120) }));
    const clearBtn = [...root.querySelectorAll("button, a, [role='button']")].filter((el) => /clear filters/i.test(el.textContent || ""))
      .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 120), text: norm(el.innerText) }));
    return { before, after, shown, clearBtn };
  }, config.blockId);
} finally {
  fs.writeFileSync("hidden/probe-47748-filter-click.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5000));
