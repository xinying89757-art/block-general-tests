import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import fs from "node:fs";
const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = {};
try {
  ({ page } = await openEditor(page, config));
  await page.goto("https://website.leadong.com/prod", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);
  out.prodId = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((x) => (x.innerText || "").trim() === "测试1403" && /prodId=/.test(x.getAttribute("href") || ""));
    return a ? new URL(a.getAttribute("href"), location.origin).searchParams.get("prodId") : null;
  });
  if (out.prodId) {
    await page.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${out.prodId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(8000);
    out.fields = await page.evaluate(() => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const r = document.querySelector('input[type=radio][name="option_826554"]:checked');
      const s = document.querySelector("select.fieldSelect");
      return { a: r ? r.value : null, b: s ? norm(s.selectedOptions[0]?.text) : null };
    });
  }
} finally {
  fs.writeFileSync("hidden/prod-1403.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
