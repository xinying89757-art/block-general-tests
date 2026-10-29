// Probe: option-adding UI inside the CMS add-custom-field form.
// Opens the form, selects each enumerated type (下拉列表 / 单选按钮 /
// 多选按钮) in turn and dumps the option inputs that appear, then cancels
// WITHOUT saving. Read-only: no field is created.
// Output: hidden/probe-cms-field-options.json
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { blockId: config.blockId, types: {} };
const norm = (t) => (t || "").replace(/\s+/g, " ").trim();

async function clickByText(re) {
  return page.evaluate((pattern) => {
    const n = (t) => (t || "").replace(/\s+/g, " ").trim();
    const rx = new RegExp(pattern);
    const el = [...document.querySelectorAll("button, a, input[type=button]")]
      .find((b) => b.getClientRects().length && rx.test(n(b.innerText || b.value)));
    if (!el) return false;
    el.click();
    return true;
  }, re.source);
}

async function dumpForm(tag) {
  await page.waitForTimeout(1500);
  const d = await page.evaluate(() => {
    const n = (t) => (t || "").replace(/\s+/g, " ").trim();
    const inputs = [...document.querySelectorAll("input, select, textarea")]
      .map((el) => ({ tag: el.tagName, type: el.type || "", name: el.name || "", id: el.id || "",
        placeholder: el.placeholder || "", visible: Boolean(el.getClientRects().length),
        label: n(el.closest("label")?.innerText || ""),
        value: (el.value || "").slice(0, 60) }))
      .filter((i) => i.visible || i.name === "field.fieldOptionJson");
    const buttons = [...document.querySelectorAll("button, a")]
      .filter((b) => b.getClientRects().length)
      .map((b) => n(b.innerText || b.value)).filter((t) => t);
    return { inputs, buttons: [...new Set(buttons)].slice(0, 30),
      text: n(document.body.innerText).slice(0, 1200) };
  });
  out.types[tag] = d;
  return d;
}

try {
  ({ page } = await openEditor(page, config));
  await page.goto("https://website.leadong.com/prod", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  if (!await clickByText(/管理自定义字段/)) throw new Error("没找到“管理自定义字段”入口");
  await page.waitForTimeout(2500);
  if (!await clickByText(/添加自定义字段/)) throw new Error("没找到“添加自定义字段”按钮");
  await page.waitForTimeout(2500);
  for (const type of ["下拉列表", "单选按钮", "多选按钮"]) {
    const ok = await page.evaluate((label) => {
      const n = (t) => (t || "").replace(/\s+/g, " ").trim();
      const radio = [...document.querySelectorAll("input[type=radio][name='field.fieldType']")]
        .find((r) => n(r.closest("label")?.innerText).includes(label));
      if (!radio) return false;
      radio.click();
      return true;
    }, type);
    console.log(type, "radio clicked:", ok);
    const d = await dumpForm(type);
    console.log(type, "-> visible inputs:", d.inputs.filter((i) => i.visible).length,
      "| optionJson:", JSON.stringify(d.inputs.find((i) => i.name === "field.fieldOptionJson")?.value));
  }
  // Cancel without saving.
  await clickByText(/^取消$/);
  await page.waitForTimeout(1500);
  out.afterCancelUrl = page.url();
} finally {
  fs.writeFileSync("hidden/probe-cms-field-options.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log("probe done");
