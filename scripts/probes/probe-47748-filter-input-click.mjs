// Click the radio input itself (not the label) in 47748's preview and
// record the radio's checked state plus the list before/after. Rules out
// a label-click quirk before testing the data-source hypothesis.
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
  const root = frame.locator(`.siteblocks-setting-wrap[data-appid="${config.blockId}"]`).first();
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const list = async () => (await root.locator(".pf-list-wrap").first().innerText()).split("\n").map(norm).filter(Boolean).slice(0, 6);
  out.before = { list: await list() };
  const input = root.locator(".pf-field-body label:has-text('单选4-10') input").first();
  out.inputCount = await root.locator(".pf-field-body label:has-text('单选4-10') input").count();
  await input.scrollIntoViewIfNeeded();
  await input.click({ force: true });
  await frame.waitForTimeout(3000);
  out.after = {
    checked: await input.isChecked(),
    list: await list(),
    selectedText: await root.evaluate((r) => {
      const hits = [...r.querySelectorAll("*")].filter((el) => el.children.length === 0
        && (el.innerText || "").trim() === "单选4-10" && !el.closest(".pf-field-group"));
      return hits.map((el) => `${el.tagName}.${String(el.className).slice(0, 80)}`);
    }),
  };
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-47748-filter-input-click.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 3000));
