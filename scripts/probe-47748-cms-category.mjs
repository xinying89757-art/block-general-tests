// Probe phase 1: CMS product management — find the top "产品分类" filter,
// dump its options, select one category and read the product list (oracle
// for the category-selection front check). No changes are made here.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
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
  // Poll frames for the prod list frame until it finishes loading.
  let frame = null;
  for (let i = 0; i < 30 && !frame; i++) {
    await page.waitForTimeout(2000);
    for (const f of page.frames()) {
      try {
        const t = await f.evaluate(() => (document.body.innerText || "").slice(0, 200));
        if (/产品名称|添加产品|全部产品/.test(t) && !/数据载入中/.test(t)) { frame = f; break; }
      } catch { /* cross-origin or detached */ }
    }
  }
  out.frameUrl = frame?.url() || null;
  if (!frame) { out.error = "prod 列表 frame 30 次轮询未加载完成"; }
  else {
    out.filterDump = await frame.evaluate(() => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const selects = [...document.querySelectorAll("select")].map((s) => ({
        name: s.name, id: s.id, cls: String(s.className).slice(0, 60),
        label: norm(s.closest("label, div, td, li")?.innerText || "").slice(0, 80),
        options: [...s.options].map((o) => norm(o.text)).slice(0, 60),
      }));
      const inputs = [...document.querySelectorAll("input[type=text], input:not([type])")]
        .map((el) => ({ placeholder: el.placeholder, name: el.name }))
        .filter((x) => x.placeholder || x.name).slice(0, 20);
      const head = norm(document.body.innerText).slice(0, 800);
      return { selects, inputs, head };
    });
    // Find the category filter select: options look like category names.
    const catSel = out.filterDump.selects.find((s) =>
      s.options.some((o) => o && o !== "全部" && o !== "全部分类" && o.length < 40)
      && (s.label.includes("分类") || s.options.length > 5));
    out.categorySelect = catSel || null;
    if (catSel) {
      // Try the first real category option and read the filtered list.
      const firstCat = catSel.options.find((o) => o && !/全部/.test(o));
      out.triedCategory = firstCat;
      await frame.evaluate(({ name, id, firstCat }) => {
        const sels = [...document.querySelectorAll("select")];
        const s = sels.find((x) => (x.name || "") === name && (x.id || "") === id)
          || sels.find((x) => [...x.options].some((o) => (o.text || "").trim() === firstCat));
        if (!s) return;
        const opt = [...s.options].find((o) => (o.text || "").trim() === firstCat);
        s.value = opt.value;
        s.dispatchEvent(new Event("change", { bubbles: true }));
      }, { name: catSel.name, id: catSel.id, firstCat });
      await frame.waitForTimeout(5000);
      out.filtered = await frame.evaluate(() => {
        const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
        const body = norm(document.body.innerText);
        const rows = [...document.querySelectorAll("table tbody tr, .el-table__row")]
          .map((r) => norm(r.innerText).slice(0, 160)).slice(0, 30);
        const pager = [...document.querySelectorAll(".pagination, [class*=page], [class*=pager]")]
          .map((el) => norm(el.innerText)).filter(Boolean).slice(0, 4);
        return { totalHint: body.match(/共\s*\d+\s*条|总数\s*\d+|\d+\s*个产品/g)?.slice(0, 3),
          rowCount: rows.length, rows, pager,
          head: body.slice(0, 400) };
      });
    }
  }
} finally {
  fs.writeFileSync("hidden/probe-47748-cms-category.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 7000));
