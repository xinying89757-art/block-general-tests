// Probe phase 3: why do 4 of the 11 测试分类 products not show in the
// front list after clicking the category nav? Read the CMS rows for the
// category with full cell HTML (esp. 上架 column + product image).
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = {};
try {
  await openEditor(page, config);
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("a, li, div, span, button")]
      .filter((n) => (n.innerText || "").replace(/\s+/g, " ").trim() === "产品管理")
      .sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0];
    if (el) el.click();
  });
  let frame = null;
  for (let i = 0; i < 30 && !frame; i++) {
    await page.waitForTimeout(2000);
    for (const f of page.frames()) {
      try {
        const t = await f.evaluate(() => (document.body.innerText || "").slice(0, 200));
        if (/产品名称|添加产品|全部产品/.test(t) && !/数据载入中/.test(t)) { frame = f; break; }
      } catch {}
    }
  }
  if (!frame) { out.error = "prod 列表 frame 未加载完成"; }
  else {
    await frame.evaluate(() => {
      document.querySelector("a.title_show[action=dropdown_classification_prod_new]")?.click();
    });
    await frame.waitForTimeout(2000);
    await frame.evaluate(() => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const li = [...document.querySelectorAll(".ListDrop_down li")]
        .find((x) => norm(x.innerText) === "测试分类");
      li?.click();
    });
    await frame.waitForTimeout(1000);
    await frame.evaluate(() => {
      const btn = [...document.querySelectorAll("button, a, input[type=button]")]
        .find((b) => (b.innerText || b.value || "").replace(/\s+/g, " ").trim() === "查询" && b.getClientRects().length);
      btn?.click();
    });
    let rows = [];
    for (let i = 0; i < 10; i++) {
      await frame.waitForTimeout(2000);
      rows = await frame.evaluate(() => {
        const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
        const allRows = [...document.querySelectorAll("table tr")]
          .map((r) => [...r.querySelectorAll("th, td")].map((c) => norm(c.innerText)));
        const head = allRows.find((cells) => cells.includes("产品名称") && cells.includes("产品分类")) || [];
        const nameIdx = head.indexOf("产品名称");
        const shelfIdx = head.indexOf("上架");
        const data = [...document.querySelectorAll("table tbody tr")]
          .map((r) => {
            const cells = [...r.querySelectorAll("td")];
            const html = cells.map((c) => c.innerHTML.slice(0, 220));
            return { name: nameIdx >= 0 ? norm(cells[nameIdx]?.innerText) : null,
              shelfText: shelfIdx >= 0 ? norm(cells[shelfIdx]?.innerText) : null,
              shelfHtml: shelfIdx >= 0 ? html[shelfIdx] : null,
              imgHtml: html[1] || null,
              cells: cells.map((c) => norm(c.innerText)) };
          })
          .filter((r) => r.name);
        return data;
      });
      if (rows.length > 0) break;
    }
    out.total = await frame.evaluate(() => {
      const body = (document.body.innerText || "").replace(/\s+/g, " ");
      return body.match(/共\s*\d+\s*条/)?.[0] || null;
    });
    out.rows = rows;
  }
} finally {
  fs.writeFileSync("hidden/probe-47748-cms-category4.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 8000));
