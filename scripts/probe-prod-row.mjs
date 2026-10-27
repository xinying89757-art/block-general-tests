// Probe: how does a product row open its editor? Dump the 操作 cell of
// the row for 测试产品A (links/buttons, hrefs, data attrs), click its
// 编辑 affordance, and dump the editor's section headers.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = {};
try {
  ({ page } = await openEditor(page, config));
  await page.goto("https://website.leadong.com/prod", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);
  out.rowOps = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("table tbody tr")];
    const row = rows.find((r) => (r.innerText || "").includes("测试产品A"));
    if (!row) return "row-not-found";
    const cells = [...row.querySelectorAll("td")];
    const last = cells[cells.length - 1];
    return {
      opsHTML: last ? last.innerHTML.slice(0, 900) : null,
      links: [...row.querySelectorAll("a")].map((a) => ({ text: (a.innerText || "").trim().slice(0, 16), href: (a.getAttribute("href") || "").slice(0, 90), cls: (a.className || "").slice(0, 40) })),
    };
  });
  out.clickEdit = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("table tbody tr")];
    const row = rows.find((r) => (r.innerText || "").includes("测试产品A"));
    if (!row) return "no-row";
    const target = [...row.querySelectorAll("a, button, span, i")].find((n) => (n.innerText || "").trim() === "编辑")
      || [...row.querySelectorAll("a")].find((a) => /edit/i.test(a.getAttribute("href") || ""));
    if (!target) return "no-target";
    target.click();
    return "clicked:" + target.tagName;
  });
  await page.waitForTimeout(6000);
  out.afterUrl = page.url();
  out.sections = await page.evaluate(() => {
    const heads = [...document.querySelectorAll("h1,h2,h3,.el-tabs__item,.tab,.section-title,legend")]
      .map((n) => (n.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 30);
    const hasCustom = (document.body.innerText || "").includes("产品自定义字段属性") || (document.body.innerText || "").includes("自定义字段");
    return { heads, hasCustom, textSample: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 350) };
  });
} finally {
  fs.writeFileSync("hidden/prod-row-probe.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5500));
