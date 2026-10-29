// Probe: how many instances of the custom-field controls exist in the
// product editor, and which are visible? (Fixture set hit a wrong one.)
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = {};
try {
  ({ page } = await openEditor(page, config));
  await page.goto("https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=ENULQuzRFljy", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  out.counts = await page.evaluate(() => {
    const vis = (el) => !!el.getClientRects().length;
    const radios = [...document.querySelectorAll('input[type=radio][name="option_826554"]')];
    const selects = [...document.querySelectorAll("select")].filter((s) => [...s.options].some((o) => /下拉列表/.test(o.text)));
    const forms = [...document.querySelectorAll("form")].map((f) => ({ id: f.id, action: (f.getAttribute("action") || "").slice(0, 60), visible: vis(f) }));
    return {
      radiosTotal: radios.length, radiosVisible: radios.filter(vis).length,
      radiosCheckedVisible: radios.filter((r) => vis(r) && r.checked).map((r) => r.value),
      radiosCheckedAll: radios.filter((r) => r.checked).map((r) => r.value),
      selectsTotal: selects.length, selectsVisible: selects.filter(vis).length,
      selectValuesVisible: selects.filter(vis).map((s) => s.selectedOptions[0]?.text),
      selectValuesAll: selects.map((s) => s.selectedOptions[0]?.text),
      forms,
      saveButtons: [...document.querySelectorAll("button, input[type=submit], a")].filter((b) => ["保存", "提交"].includes((b.innerText || b.value || "").replace(/\s+/g, " ").trim()) && vis(b)).map((b) => ({ text: (b.innerText || b.value || "").trim(), cls: (b.className || "").slice(0, 40), form: b.form ? b.form.id : null })),
    };
  });
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/prod-instances.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
