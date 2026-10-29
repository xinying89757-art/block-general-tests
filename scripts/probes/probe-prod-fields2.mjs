// Probe round 2: locate each filterable field by NAME inside the product
// editor and dump its row: control types, option labels, checked states.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = {};
const PROD_ID = "ENULQuzRFljy";
const FIELDS = ["测试单选按钮A", "测试下拉列表", "Series-xiala", "测试单选2", "test1分类", "test2分类"];
try {
  ({ page } = await openEditor(page, config));
  await page.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  out.fields = await page.evaluate((names) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const res = {};
    for (const name of names) {
      const label = [...document.querySelectorAll("body *")].find((el) => el.children.length === 0 && norm(el.innerText) === name);
      if (!label) { res[name] = "label-not-found"; continue; }
      let row = label;
      for (let k = 0; k < 7 && row.parentElement; k++) {
        row = row.parentElement;
        if (row.querySelectorAll("input, select").length) break;
      }
      res[name] = {
        rowCls: (row.className || "").slice(0, 60),
        rowText: norm(row.innerText).slice(0, 200),
        controls: [...row.querySelectorAll("input, select")].map((i) => ({
          tag: i.tagName, type: i.type || "", name: i.name || "", value: (i.value || "").slice(0, 30), checked: i.checked,
          options: i.tagName === "SELECT" ? [...i.options].map((o) => ({ t: norm(o.text), v: o.value, sel: o.selected })) : undefined,
        })),
        optionLabels: [...row.querySelectorAll("label, .layui-form-radio, .option")].map((l) => norm(l.innerText)).filter(Boolean).slice(0, 12),
      };
    }
    return res;
  }, FIELDS);
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/prod-fields-probe2.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 7000));
