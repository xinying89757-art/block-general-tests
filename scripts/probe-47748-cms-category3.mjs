// Probe phase 1c: click the exact category trigger
// (a.title_show[action=dropdown_classification_prod_new]), dump the
// .imitateSelect options, pick 测试分类, click 查询, read filtered rows.
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
  out.frameUrl = frame?.url() || null;
  if (!frame) { out.error = "prod 列表 frame 未加载完成"; }
  else {
    await frame.evaluate(() => {
      document.querySelector("a.title_show[action=dropdown_classification_prod_new]")?.click();
    });
    await frame.waitForTimeout(2000);
    out.options = await frame.evaluate(() => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      // The dropdown list: li[valueid] inside the ListDrop_down container.
      const box = document.querySelector(".ListDrop_down");
      const items = box ? [...box.querySelectorAll("li")] : [...document.querySelectorAll(".imitateSelect li")];
      return items.map((li) => ({ text: norm(li.innerText), valueid: li.getAttribute("valueid"),
        visible: !!li.getClientRects().length })).slice(0, 60);
    });
    const picked = await frame.evaluate(() => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const box = document.querySelector(".ListDrop_down");
      const items = box ? [...box.querySelectorAll("li")] : [];
      const li = items.find((x) => norm(x.innerText) === "测试分类");
      if (!li) return null;
      li.click();
      return { valueid: li.getAttribute("valueid") };
    });
    out.picked = picked;
    await frame.waitForTimeout(1500);
    out.triggerAfterPick = await frame.evaluate(() => {
      const a = document.querySelector("a.title_show[action=dropdown_classification_prod_new]");
      return a ? (a.innerText || "").replace(/\s+/g, " ").trim() : null;
    });
    const queried = await frame.evaluate(() => {
      const btn = [...document.querySelectorAll("button, a, input[type=button]")]
        .find((b) => (b.innerText || b.value || "").replace(/\s+/g, " ").trim() === "查询" && b.getClientRects().length);
      if (!btn) return false;
      btn.click();
      return true;
    });
    out.queried = queried;
    await frame.waitForTimeout(5000);
    out.filtered = await frame.evaluate(() => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const body = norm(document.body.innerText);
      const rows = [...document.querySelectorAll("table tbody tr")]
        .map((r) => {
          const cells = [...r.querySelectorAll("td")].map((c) => norm(c.innerText));
          return { name: cells[1] || null, category: cells[5] || null, raw: norm(r.innerText).slice(0, 120) };
        }).filter((r) => r.name).slice(0, 30);
      return { rowCount: rows.length, rows,
        totalHint: body.match(/共\s*\d+\s*条|共\d+/g)?.slice(0, 3),
        head: body.slice(0, 200) };
    });
  }
} finally {
  fs.writeFileSync("hidden/probe-47748-cms-category3.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 8000));
