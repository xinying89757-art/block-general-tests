// Final mechanism attempt: drive the product editor with REAL Playwright
// input (locator clicks + selectOption) instead of synthetic DOM clicks,
// handle any similarity-confirm dialog, save, and read back.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = { log: [] };
const PROD = "ENULQuzRFljy";
try {
  ({ page } = await openEditor(page, config));
  await page.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  const radioLabel = page.locator('label:has(input[name="option_826554"][value="4"])').first();
  await radioLabel.scrollIntoViewIfNeeded();
  await radioLabel.click();
  out.log.push("radio checked: " + await page.locator('input[name="option_826554"][value="4"]').isChecked());
  const sel = page.locator("select.fieldSelect").first();
  await sel.scrollIntoViewIfNeeded();
  await sel.selectOption({ label: "下拉列表4-10" });
  out.log.push("select value: " + await sel.inputValue());
  const saveBtn = page.locator(".topBts_menu_save").first();
  await saveBtn.click();
  await page.waitForTimeout(4000);
  // possible confirm dialog (similarity check etc.)
  out.dialogTexts = await page.evaluate(() => [...document.querySelectorAll(".layui-layer")].filter((n) => n.getClientRects().length)
    .map((n) => (n.innerText || "").replace(/\s+/g, " ").trim().slice(0, 120)));
  const confirm = page.locator('.layui-layer-btn a, .layui-layer-btn0').first();
  if (await confirm.count()) { await confirm.click().catch(() => {}); out.log.push("confirm clicked"); }
  await page.waitForTimeout(5000);
  out.toast = await page.evaluate(() => [...document.querySelectorAll(".layui-layer-content")].map((n) => (n.innerText || "").replace(/\s+/g, " ").trim().slice(0, 50)));
  await page.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  out.readBack = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const r = document.querySelector('input[type=radio][name="option_826554"]:checked');
    const s = document.querySelector("select.fieldSelect");
    return { a: r ? r.value : null, b: s ? norm(s.selectedOptions[0]?.text) : null };
  });
} finally {
  fs.writeFileSync("hidden/prod-real-probe.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 3000));
