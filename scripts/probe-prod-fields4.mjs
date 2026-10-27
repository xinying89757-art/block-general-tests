// Probe round 4: smallest elements CONTAINING each field name; dump the
// enclosing row's controls (options + checked) for the two fixture fields.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = {};
const PROD_ID = "ENULQuzRFljy";
const FIELDS = ["测试单选按钮A", "测试下拉列表", "test1分类"];
try {
  ({ page } = await openEditor(page, config));
  await page.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  out.fields = await page.evaluate((names) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const res = {};
    for (const name of names) {
      const cands = [...document.querySelectorAll("body *")]
        .filter((el) => norm(el.innerText).includes(name) && norm(el.innerText).length < name.length + 30)
        .sort((a, b) => norm(a.innerText).length - norm(b.innerText).length);
      const label = cands[0];
      if (!label) { res[name] = "not-found"; continue; }
      let row = label;
      for (let k = 0; k < 8 && row.parentElement; k++) {
        row = row.parentElement;
        if (row.querySelectorAll("input, select").length >= 1 && norm(row.innerText).length > name.length + 4) break;
      }
      res[name] = {
        labelText: norm(label.innerText).slice(0, 50), labelTag: label.tagName + "." + (label.className || "").slice(0, 30),
        rowText: norm(row.innerText).slice(0, 260),
        controls: [...row.querySelectorAll("input, select")].map((i) => ({
          tag: i.tagName, type: i.type || "", name: (i.name || "").slice(0, 44), value: (i.value || "").slice(0, 34), checked: i.checked,
          options: i.tagName === "SELECT" ? [...i.options].map((o) => ({ t: norm(o.text).slice(0, 26), v: o.value, sel: o.selected })) : undefined,
        })),
      };
    }
    return res;
  }, FIELDS);
} finally {
  fs.writeFileSync("hidden/prod-fields-probe4.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 7000));
