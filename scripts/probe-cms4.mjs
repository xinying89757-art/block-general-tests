// Probe: website.leadong.com has its own login entry. Dump its form so
// we can sign in with the same demo account and reach 内容管理.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = {};
try {
  await page.goto("http://website.leadong.com/login", { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => { out.err = e.message; });
  await page.waitForTimeout(6000);
  out.url = page.url();
  out.title = await page.title().catch(() => "");
  out.form = await page.evaluate(() => ({
    inputs: [...document.querySelectorAll("input")].map((i) => ({ type: i.type, name: i.name, placeholder: i.placeholder, id: i.id })),
    buttons: [...document.querySelectorAll("button, a")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 12),
    text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300),
  })).catch((e) => ({ error: e.message }));
  await page.screenshot({ path: "screenshots/probe-cms4.png" }).catch(() => {});
} finally {
  fs.writeFileSync("hidden/cms-probe4.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 3500));
