// Probe: CMS custom-field management (内容管理-产品-管理自定义字段).
// Read-only: opens the field-management page, dumps the existing field list
// (name + type), opens the add-field form and dumps its structure (which
// types are offered, name input, how options are added), then cancels out
// WITHOUT submitting anything. No fields or products are created.
// Output: hidden/probe-cms-custom-fields.json
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { blockId: config.blockId, steps: {} };
const norm = (t) => (t || "").replace(/\s+/g, " ").trim();

async function dumpPage(tag) {
  await page.waitForTimeout(2500);
  const d = await page.evaluate(() => {
    const n = (t) => (t || "").replace(/\s+/g, " ").trim();
    return {
      url: location.href,
      title: document.title,
      text: n(document.body.innerText).slice(0, 2500),
      buttons: [...document.querySelectorAll("button, a, input[type=button], input[type=submit]")]
        .filter((b) => b.getClientRects().length)
        .map((b) => ({ tag: b.tagName, text: n(b.innerText || b.value).slice(0, 40),
          action: b.getAttribute("action") || b.getAttribute("data-action") || "",
          href: (b.getAttribute("href") || "").slice(0, 120) }))
        .filter((b) => b.text),
    };
  });
  out.steps[tag] = d;
  return d;
}

function findButton(d, re) {
  return d.buttons.find((b) => re.test(b.text));
}

try {
  ({ page } = await openEditor(page, config));
  await page.goto("https://website.leadong.com/prod", { waitUntil: "domcontentloaded", timeout: 60000 });
  const prod = await dumpPage("prod-home");
  console.log("prod page:", prod.url);
  // Find the custom-field management entry.
  const entry = findButton(prod, /自定义字段/);
  console.log("field-mgmt entry:", JSON.stringify(entry));
  if (!entry) throw new Error("在产品管理页没找到“自定义字段”入口");
  await page.evaluate((text) => {
    const n = (t) => (t || "").replace(/\s+/g, " ").trim();
    const el = [...document.querySelectorAll("button, a, input[type=button]")]
      .find((b) => b.getClientRects().length && n(b.innerText || b.value).includes(text));
    el?.click();
  }, entry.text);
  const mgmt = await dumpPage("field-mgmt");
  console.log("field-mgmt page:", mgmt.url);
  // Existing field list: try tables and list rows carrying a type label.
  out.existingFields = await page.evaluate(() => {
    const n = (t) => (t || "").replace(/\s+/g, " ").trim();
    const rows = [];
    for (const tr of document.querySelectorAll("table tr")) {
      const cells = [...tr.querySelectorAll("td, th")].map((c) => n(c.innerText));
      if (cells.length >= 2 && cells.some((c) => c)) rows.push(cells);
    }
    const listItems = [...document.querySelectorAll("li")].map((li) => n(li.innerText)).filter((t) => t && t.length < 200);
    return { tableRows: rows.slice(0, 80), listItems: listItems.slice(0, 40) };
  });
  console.log("existing fields table rows:", out.existingFields.tableRows.length);
  // Open the add-field form (do NOT submit it).
  const addBtn = findButton(mgmt, /新增|添加.*字段|新建字段/);
  console.log("add-field button:", JSON.stringify(addBtn));
  if (addBtn) {
    await page.evaluate((text) => {
      const n = (t) => (t || "").replace(/\s+/g, " ").trim();
      const el = [...document.querySelectorAll("button, a, input[type=button]")]
        .find((b) => b.getClientRects().length && n(b.innerText || b.value).includes(text));
      el?.click();
    }, addBtn.text);
    const form = await dumpPage("add-field-form");
    console.log("add-field form:", form.url);
    out.addForm = await page.evaluate(() => {
      const n = (t) => (t || "").replace(/\s+/g, " ").trim();
      const inputs = [...document.querySelectorAll("input, select, textarea")]
        .filter((el) => el.getClientRects().length || el.type === "hidden")
        .map((el) => ({ tag: el.tagName, type: el.type || "", name: el.name || "", id: el.id || "",
          placeholder: el.placeholder || "",
          label: n(el.closest("label")?.innerText || el.closest("div, li, tr")?.querySelector("label")?.innerText || ""),
          options: el.tagName === "SELECT" ? [...el.options].map((o) => n(o.text)) : undefined,
          value: (el.value || "").slice(0, 40) }));
      const dialogText = n(document.body.innerText).slice(0, 1500);
      return { inputs, dialogText };
    });
    console.log("add-form inputs:", out.addForm.inputs.length);
    // Cancel out of the form without saving.
    await page.evaluate(() => {
      const n = (t) => (t || "").replace(/\s+/g, " ").trim();
      const btn = [...document.querySelectorAll("button, a")]
        .find((b) => b.getClientRects().length && /^(取消|关闭)$/.test(n(b.innerText || b.value)));
      btn?.click();
    });
    await page.waitForTimeout(1500);
    out.afterCancel = await page.evaluate(() => ({ url: location.href }));
  }
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-cms-custom-fields.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log("probe done");
