// Probe: in the pagebuilder layout, open the 内容 section and click
// 产品管理; capture where it lands (new page / frame / same page) and
// the product list structure.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = { steps: [] };
try {
  ({ page } = await openEditor(page, config));
  await page.waitForTimeout(3000);
  const pagesBefore = context.pages().length;
  // Find and click 产品管理 anywhere in the layout page (main doc first).
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll("a, li, div, span, button")];
    const el = els.filter((n) => (n.innerText || "").replace(/\s+/g, " ").trim() === "产品管理")
      .sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0];
    if (!el) return "not-found";
    el.scrollIntoView({ block: "center" });
    el.click();
    return "clicked:" + el.tagName + "." + (el.className || "").slice(0, 40);
  });
  out.steps.push("click 产品管理: " + clicked);
  await page.waitForTimeout(6000);
  out.pagesAfter = context.pages().map((p) => p.url());
  const target = context.pages().at(-1);
  out.activeUrl = target.url();
  out.frames = target.frames().map((f) => f.url()).slice(0, 10);
  out.textSample = await target.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 700)).catch((e) => "err:" + e.message);
  await target.screenshot({ path: "screenshots/probe-cms7.png" }).catch(() => {});
} finally {
  fs.writeFileSync("hidden/cms-probe7.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 4500));
