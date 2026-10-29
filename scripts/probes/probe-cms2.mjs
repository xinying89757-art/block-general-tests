// Probe CMS navigation properly: land on the console, wait for the SPA,
// dump frames and all visible nav texts; also inspect the editor page's
// global header for a 内容管理 entry.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = {};
try {
  await page.goto("https://www.leadong.com/phoenix/admin/user/index", { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => { out.gotoErr = e.message; });
  await page.waitForTimeout(7000);
  out.url = page.url();
  out.frames = page.frames().map((f) => f.url()).slice(0, 12);
  out.navTexts = await page.evaluate(() => [...document.querySelectorAll("a, .menu-item, li, span")]
    .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
    .filter((t) => t && t.length <= 12)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 80));
  await page.screenshot({ path: "screenshots/probe-cms2.png" }).catch(() => {});
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/cms-probe2.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 4500));
