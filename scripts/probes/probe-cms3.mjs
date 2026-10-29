// Probe CMS entry round 3: try candidate console URLs; for each report
// title + whether body text mentions 内容管理/产品管理; also dump the
// editor page's own header links (outside the canvas iframe).
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { candidates: [] };
const urls = [
  "https://website.leadong.com/phoenix/admin/user/index",
  "https://www.leadong.com/phoenix/admin/user/home",
  "https://website.leadong.com/phoenix/admin/content/index",
];
try {
  for (const u of urls) {
    try {
      await page.goto(u, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(5000);
      const info = await page.evaluate(() => ({
        title: document.title,
        hasContent: (document.body.innerText || "").includes("内容管理"),
        hasProduct: (document.body.innerText || "").includes("产品管理"),
        textSample: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 200),
      }));
      out.candidates.push({ u, finalUrl: page.url(), ...info });
    } catch (e) {
      out.candidates.push({ u, error: e.message.slice(0, 120) });
    }
  }
  // Editor header links
  ({ page } = await openEditor(page, config));
  await page.waitForTimeout(3000);
  out.editorHeader = await page.evaluate(() => [...document.querySelectorAll("a")]
    .map((a) => ({ text: (a.innerText || "").replace(/\s+/g, " ").trim().slice(0, 24), href: a.href.slice(0, 110) }))
    .filter((l) => l.text)
    .slice(0, 40));
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/cms-probe3.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5500));
