// Probe: 产品管理 content frame — wait for the product list, dump its
// frame URL, toolbar texts, and the first rows (name + edit affordances).
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = {};
try {
  ({ page } = await openEditor(page, config));
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("a, li, div, span, button")]
      .filter((n) => (n.innerText || "").replace(/\s+/g, " ").trim() === "产品管理")
      .sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0];
    if (el) el.click();
  });
  // poll frames for product-list-ish content
  let found = null;
  for (let i = 0; i < 15 && !found; i++) {
    await page.waitForTimeout(2000);
    for (const f of page.frames()) {
      try {
        const t = await f.evaluate(() => (document.body.innerText || "").slice(0, 300));
        if (/产品名称|添加产品|全部产品|产品列表/.test(t)) { found = { url: f.url(), sample: t.replace(/\s+/g, " ").slice(0, 260) }; break; }
      } catch { /* cross-origin or detached */ }
    }
  }
  out.found = found;
  out.allFrames = page.frames().map((f) => f.url()).slice(0, 14);
  if (found) {
    const frame = page.frames().find((f) => f.url() === found.url);
    out.listDump = await frame.evaluate(() => {
      const rows = [...document.querySelectorAll("table tbody tr, .el-table__row, [class*=table] [class*=row]")].slice(0, 6)
        .map((r) => (r.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160));
      const toolbar = [...document.querySelectorAll("button, a")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim())
        .filter((t) => t && t.length < 14).slice(0, 25);
      return { rows, toolbar, textHead: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 500) };
    }).catch((e) => ({ error: e.message }));
  }
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/cms-probe8.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5000));
