import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor } from "../../src/editor.mjs";
import fs from "node:fs";
const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = {};
try {
  ({ page } = await openEditor(page, config));
  for (const [name, id] of [["测试产品A", "ENULQuzRFljy"], ["测试产品小何1", "ApUgGkomaTfn"], ["测试产品小何2", "NmKqGFoHbPJy"]]) {
    await page.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(7000);
    out[name] = await page.evaluate(() => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const r = document.querySelector('input[type=radio][name="option_826554"]:checked');
      const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => /下拉列表/.test(o.text)));
      return { a: r ? r.value : null, b: sel ? norm(sel.selectedOptions[0]?.text) : null };
    });
  }
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/prod-recheck.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
