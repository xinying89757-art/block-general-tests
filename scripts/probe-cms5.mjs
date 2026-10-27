import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import fs from "node:fs";
const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = {};
try {
  await page.goto("http://website.leadong.com/login", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  out.linkHref = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((x) => (x.innerText || "").includes("这里"));
    return a ? a.href : null;
  });
  if (out.linkHref) {
    await page.goto(out.linkHref, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => { out.err = e.message; });
    await page.waitForTimeout(6000);
    out.finalUrl = page.url();
    out.form = await page.evaluate(() => ({
      inputs: [...document.querySelectorAll("input")].map((i) => ({ type: i.type, name: i.name, placeholder: i.placeholder })).slice(0, 10),
      text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 250),
    })).catch((e) => ({ error: e.message }));
  }
} finally {
  fs.writeFileSync("hidden/cms-probe5.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 3000));
