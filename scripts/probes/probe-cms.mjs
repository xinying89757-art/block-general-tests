// Probe CMS entry: with the saved login state, land on the Leadong
// console and find links related to 内容管理 / 产品管理 for the target site.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = {};
try {
  await page.goto("https://www.leadong.com/phoenix/admin/user/index", { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => { out.gotoErr = e.message; });
  await page.waitForTimeout(4000);
  out.url = page.url();
  out.links = await page.evaluate(() => [...document.querySelectorAll("a")]
    .map((a) => ({ text: (a.innerText || "").replace(/\s+/g, " ").trim().slice(0, 30), href: a.href }))
    .filter((l) => /产品|内容|product|content/i.test(l.text + " " + l.href))
    .slice(0, 40));
  out.title = await page.title();
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/cms-probe.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
