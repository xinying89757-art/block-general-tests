// Probe: open the /prod SPA in the SSO'd session, wait for the product
// list, record names, open the first product's editor, and dump the
// 产品自定义字段属性 section (field labels + control types + options).
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, context, page } = await launchSession(config);
const out = {};
try {
  await openEditor(page, config); // SSO hop so website.leadong.com accepts us
  await page.goto("https://website.leadong.com/prod", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);
  // product names: look for table rows / list items with product-ish content
  out.list = await page.evaluate(() => {
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    const totalMatch = text.match(/共\s*(\d+)\s*条|总共\s*(\d+)|(\d+)\s*个产品/);
    const rows = [...document.querySelectorAll("table tbody tr")].slice(0, 25)
      .map((r) => (r.innerText || "").replace(/\s+/g, " ").trim().slice(0, 120));
    return { totalMatch: totalMatch && totalMatch[0], rowCount: document.querySelectorAll("table tbody tr").length, rows, head: text.slice(0, 400) };
  });
  // click 编辑 on the first row
  out.editClick = await page.evaluate(() => {
    const row = document.querySelector("table tbody tr");
    if (!row) return "no-row";
    const btn = [...row.querySelectorAll("a, button, span")].find((n) => (n.innerText || "").trim() === "编辑");
    if (!btn) return "no-edit-btn";
    btn.click();
    return "clicked";
  });
  await page.waitForTimeout(6000);
  out.editUrl = page.url();
  out.customSection = await page.evaluate(() => {
    const all = [...document.querySelectorAll("body *")];
    const anchor = all.find((el) => el.children.length === 0 && (el.innerText || "").includes("产品自定义字段"));
    if (!anchor) return { found: false, head: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400) };
    let root = anchor;
    for (let k = 0; k < 6 && root.parentElement; k++) root = root.parentElement;
    const fields = [...root.querySelectorAll(".el-form-item, .form-item, li, tr")].slice(0, 40).map((item) => {
      const label = item.querySelector("label, .el-form-item__label, .label");
      const inputs = [...item.querySelectorAll("input, select, textarea")].map((i) => ({
        type: i.type || i.tagName, value: (i.value || "").slice(0, 40), checked: i.checked,
        options: i.tagName === "SELECT" ? [...i.options].map((o) => o.text) : undefined,
      }));
      return { label: label ? (label.innerText || "").replace(/\s+/g, " ").trim().slice(0, 30) : "", inputs };
    }).filter((f) => f.label || f.inputs.length);
    return { found: true, fields };
  });
} finally {
  fs.writeFileSync("hidden/prod-edit-probe.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6500));
