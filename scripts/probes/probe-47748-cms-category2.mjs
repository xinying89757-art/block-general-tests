// Probe phase 1b: CMS category filter is NOT a <select> — it is a
// "请选择产品分类" trigger that opens a picker. Click it, dump the picker
// tree, pick 测试分类, click 查询, and read the filtered rows.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor } from "../../src/editor.mjs";
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
    // The category filter trigger: exact text 请选择产品分类.
    out.trigger = await frame.evaluate(() => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const els = [...document.querySelectorAll("*")].filter((el) =>
        norm(el.innerText) === "请选择产品分类" && el.children.length === 0
        || (el.tagName === "INPUT" && (el.placeholder || "") === "请选择产品分类"));
      return els.slice(0, 5).map((el) => ({ tag: el.tagName,
        cls: String(el.className).slice(0, 80), id: el.id, type: el.type || null,
        parentCls: String(el.parentElement?.className || "").slice(0, 80),
        html: el.outerHTML.slice(0, 300) }));
    });
    // Click the trigger (prefer an input or the smallest clickable).
    const clicked = await frame.evaluate(() => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const input = [...document.querySelectorAll("input")].find((el) => (el.placeholder || "") === "请选择产品分类");
      if (input) { input.click(); return "input"; }
      const el = [...document.querySelectorAll("div, span, a")].find((x) => norm(x.innerText) === "请选择产品分类" && x.getClientRects().length);
      if (el) { el.click(); return el.tagName; }
      return null;
    });
    out.clickedTrigger = clicked;
    await frame.waitForTimeout(2000);
    out.picker = await frame.evaluate(() => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      // Visible popup-ish containers: fixed/absolute divs with many texts.
      const cands = [...document.querySelectorAll("body > div, body div[class*=tree], body div[class*=drop], body div[class*=pop], body ul")]
        .filter((el) => el.getClientRects().length && (el.innerText || "").length > 5 && (el.innerText || "").length < 3000)
        .map((el) => ({ cls: String(el.className).slice(0, 80),
          text: norm(el.innerText).slice(0, 600) }))
        .slice(0, 8);
      return cands;
    });
    // Pick 测试分类 in the picker (exact node text), then 查询.
    const picked = await frame.evaluate(() => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const node = [...document.querySelectorAll("li, div, span, a")]
        .find((el) => norm(el.innerText) === "测试分类" && el.getClientRects().length
          && !el.querySelector("li"));
      if (!node) return null;
      node.click();
      return { tag: node.tagName, cls: String(node.className).slice(0, 80) };
    });
    out.picked = picked;
    await frame.waitForTimeout(1500);
    out.afterPick = await frame.evaluate(() => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const trig = [...document.querySelectorAll("input")].find((el) => (el.placeholder || "") === "请选择产品分类");
      return { triggerValue: trig ? trig.value : null,
        head: norm(document.body.innerText).slice(0, 300) };
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
        .map((r) => norm(r.innerText).slice(0, 200)).filter(Boolean).slice(0, 30);
      return { rowCount: rows.length, rows,
        totalHint: body.match(/共\s*\d+\s*条|总数[^0-9]*\d+|共[^0-9]*\d+/g)?.slice(0, 3),
        head: body.slice(0, 300) };
    });
  }
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-47748-cms-category2.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 8000));
