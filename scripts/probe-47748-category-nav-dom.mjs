// Probe phase 2: CMS oracle for 测试分类 (11 products) + preview check:
// set 47748 category to partial with only 测试分类, save, preview, read
// the category nav + product names, compare against the CMS list.
// Restore runs in a finally block.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, savePage, openPreview } from "../src/editor.mjs";
import { widgetSession, probeControls, previewSelector } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId, targetCategory: "测试分类" };
let canvas;

async function cmsOracle() {
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
  if (!frame) throw new Error("prod 列表 frame 未加载完成");
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
  // Poll for data rows (name cell non-empty) up to 20s. Column positions
  // are mapped from the header row that contains 产品名称 (a leading
  // checkbox column shifts indices, so never hard-code them; the first
  // tbody row can be a status row, so scan all rows for the header).
  let rows = [];
  let header = [];
  for (let i = 0; i < 10; i++) {
    await frame.waitForTimeout(2000);
    const read = await frame.evaluate(() => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const allRows = [...document.querySelectorAll("table tr")]
        .map((r) => [...r.querySelectorAll("th, td")].map((c) => norm(c.innerText)));
      const head = allRows.find((cells) => cells.includes("产品名称") && cells.includes("产品分类")) || [];
      const data = [...document.querySelectorAll("table tbody tr")]
        .map((r) => [...r.querySelectorAll("td")].map((c) => norm(c.innerText)))
        .filter((cells) => cells.length > 3 && cells.some((c) => c));
      return { head, data };
    });
    header = read.head;
    rows = read.data;
    if (rows.length > 0 && header.includes("产品名称")) break;
  }
  const nameIdx = header.indexOf("产品名称");
  const catIdx = header.indexOf("产品分类");
  const total = await frame.evaluate(() => {
    const body = (document.body.innerText || "").replace(/\s+/g, " ");
    return body.match(/共\s*\d+\s*条/)?.[0] || null;
  });
  return { total, header,
    names: nameIdx >= 0 ? rows.map((c) => c[nameIdx]).filter(Boolean) : [],
    categories: catIdx >= 0 ? [...new Set(rows.map((c) => c[catIdx]).filter(Boolean))] : [],
    sampleRow: rows[0] || null };
}

async function readCategoryDialog() {
  const session = widgetSession({ page, canvas, config,
    type: "phoenix_blocks_gallery", title: "设置产品分类", wrapIndex: 0 });
  const probe = await probeControls(session);
  return { session, probe };
}
const categoriesOf = (probe) => (probe.controls || []).filter((c) =>
  c.type === "checkbox" && c.name === "leafProdGroup");

try {
  await openEditor(page, config);
  out.oracle = await cmsOracle();
  // Back to the editor canvas. The 产品管理 dialog overlays the page, so
  // reload the editor first (openEditor re-navigates to the editSite URL).
  await openEditor(page, config);
  canvas = await gotoTargetPage(page, config);
  try {
    let { session, probe } = await readCategoryDialog();
    const cats = categoriesOf(probe);
    out.dialog = { count: cats.length,
      labels: cats.map((c) => c.label).slice(0, 50),
      hasTarget: cats.some((c) => (c.label || "").includes("测试分类")) };
    const mode = probe.controls.filter((c) => c.type === "radio" && c.name === "selectGroupWay");
    out.baselineMode = mode.find((c) => c.checked)?.label;
    // Identify the target by exact label. NEVER by value: every
    // leafProdGroup checkbox has value "on" (round 2 matched all 44 and
    // unchecked nothing).
    const target = cats.find((c) => (c.label || "").trim() === "测试分类");
    out.targetControl = target ? { label: target.label, checked: target.checked } : null;
    if (!target) { out.error = "弹窗里找不到 测试分类"; }
    else {
      const partial = mode.find((c) => c.label === "选择部分产品分类");
      await session.set(partial, true);
      await session.save();
      await session.open();
      const after = await probeControls(session);
      for (const c of categoriesOf(after).filter((x) => x.checked && (x.label || "").trim() !== "测试分类")) {
        await session.set(c, false);
      }
      const targetNow = categoriesOf(after).find((c) => (c.label || "").trim() === "测试分类");
      if (targetNow && !targetNow.checked) await session.set(targetNow, true);
      await session.save();
      await savePage(page);
      // Verify persisted: reopen and read.
      const verify = await readCategoryDialog();
      out.persisted = { mode: verify.probe.controls.filter((c) => c.type === "radio" && c.name === "selectGroupWay").find((c) => c.checked)?.label,
        checked: categoriesOf(verify.probe).filter((c) => c.checked).map((c) => c.label) };
      await verify.session.cancel();

      const preview = await openPreview(page, context);
      const frame = preview.frame;
      const previewPage = preview.previewPage;
      const root = frame.locator(previewSelector(config.blockId)).first();
      await root.waitFor({ state: "attached", timeout: 10000 });
      await frame.waitForTimeout(4000);
      out.preview = await root.evaluate((wrap) => {
        const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
        const names = [...wrap.querySelectorAll(".prodlist-pro-name")].map((el) => norm(el.innerText));
        // Category nav: anchor texts in the wrap (nav items are links).
        const links = [...wrap.querySelectorAll("a")].map((el) => norm(el.innerText)).filter(Boolean);
        return { textHead: norm(wrap.innerText).slice(0, 900),
          productNames: names, productCount: names.length,
          linkTexts: links.slice(0, 80) };
      });
      // DOM structure of the category nav: ancestor chain of the 测试分类
      // link, hrefs of nav / product / pagination links, and the nav
      // container's HTML head.
      out.navDom = await frame.evaluate(() => {
        const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
        const link = [...document.querySelectorAll("a")].find((el) => norm(el.innerText) === "测试分类");
        if (!link) return { found: false };
        const chain = [];
        let el = link;
        for (let i = 0; i < 7 && el; i++) {
          chain.push({ tag: el.tagName, cls: String(el.className || "").slice(0, 100), id: el.id || null });
          el = el.parentElement;
        }
        const prodLink = [...document.querySelectorAll("a")].find((a) => a.querySelector(".prodlist-pro-name"))
          || [...document.querySelectorAll(".prodlist-pro-name")].map((n) => n.closest("a")).find(Boolean);
        const pageLink = [...document.querySelectorAll("a")].find((a) => norm(a.innerText) === "2");
        // Smallest ancestor of the nav link whose descendant anchors are
        // exactly the nav links (button excluded by position).
        let container = link.parentElement;
        let containerInfo = null;
        for (let i = 0; i < 6 && container; i++) {
          const as = [...container.querySelectorAll("a")].map((a) => norm(a.innerText)).filter(Boolean);
          if (as.length <= 3 && as.includes("测试分类")) {
            containerInfo = { tag: container.tagName, cls: String(container.className || "").slice(0, 100),
              anchors: as, htmlHead: container.outerHTML.slice(0, 1200) };
            break;
          }
          container = container.parentElement;
        }
        return { found: true, navHref: link.getAttribute("href"),
          prodHref: prodLink ? prodLink.getAttribute("href") : null,
          prodLinkHasName: !!prodLink,
          pageHref: pageLink ? pageLink.getAttribute("href") : null,
          chain, containerInfo };
      });
      out.preview.missing = out.oracle.names.filter((n) => !out.preview.productNames.includes(n));
      out.preview.extra = out.preview.productNames.filter((n) => !out.oracle.names.includes(n));
      try { if (!previewPage.isClosed()) await previewPage.close(); } catch {}
    }
  } finally {
    try {
      const { session, probe } = await readCategoryDialog();
      const all = probe.controls.find((c) => c.type === "radio" && c.name === "selectGroupWay" && c.label === "选择所有产品分类");
      if (all) await session.set(all, true);
      await session.save();
      await savePage(page);
      const after = await readCategoryDialog();
      out.restored = { mode: after.probe.controls.filter((c) => c.type === "radio" && c.name === "selectGroupWay").find((c) => c.checked)?.label,
        checkedCount: categoriesOf(after.probe).filter((c) => c.checked).length,
        total: categoriesOf(after.probe).length };
      await after.session.cancel();
    } catch (e) { out.restoreError = e.message.slice(0, 300); }
  }
} finally {
  fs.writeFileSync("hidden/probe-47748-category-nav-dom.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 8000));
