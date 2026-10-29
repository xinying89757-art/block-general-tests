// Probe: open 测试产品A's editor directly and dump every custom-field
// editor (label, control type, options, current value).
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = {};
const PROD_ID = "ENULQuzRFljy"; // 测试产品A
try {
  ({ page } = await openEditor(page, config));
  await page.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  out.url = page.url();
  out.dump = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    // find the custom-fields area by its heading text
    const heads = [...document.querySelectorAll("body *")].filter((el) => el.children.length === 0 && /自定义字段/.test(el.innerText || ""));
    const fieldRows = [];
    // generic: every labelled control group on the page
    const items = [...document.querySelectorAll(".el-form-item, .form-group, .prod-field-item, li, tr")];
    for (const item of items) {
      const labelEl = item.querySelector("label, .el-form-item__label, .field-name, .name");
      const label = labelEl ? norm(labelEl.innerText).slice(0, 34) : "";
      if (!label) continue;
      const ctrls = [...item.querySelectorAll("input, select, textarea")].map((i) => ({
        type: i.type || i.tagName, name: i.name || "", value: (i.value || "").slice(0, 44), checked: i.checked,
        options: i.tagName === "SELECT" ? [...i.options].map((o) => norm(o.text)) : undefined,
      }));
      const radios = [...item.querySelectorAll(".el-radio, .radio-inline, label")].map((l) => norm(l.innerText)).filter(Boolean).slice(0, 10);
      if (ctrls.length) fieldRows.push({ label, ctrls, radios });
    }
    return { headings: heads.map((h) => norm(h.innerText).slice(0, 40)).slice(0, 6), fieldRows: fieldRows.slice(0, 45) };
  });
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/prod-fields-probe.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 7000));
