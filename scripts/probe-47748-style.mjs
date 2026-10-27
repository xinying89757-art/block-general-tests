// Style pilot probe for 47748 (read-only, no settings changed):
// - PC 1440: read computed styles of the pilot elements and diff them
//   against the Figma PC frame (Page 3, node 1281:2960, parsed to
//   /tmp/figma-47748-pc-spec.json). Design file is the authority.
// - Pad 768 / Mobile 375: the design file has no pad/mobile frames for
//   this block, so only breakage checks run there (horizontal overflow,
//   element overlap, text clipping, image distortion) + screenshots for
//   human review when the probe cannot judge.
// Screenshots: screenshots/style-47748-{pc,pad,mobile}.png (block clip).
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../src/editor.mjs";
import { previewSelector } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId, figma: { fileKey: "Vce7UhBgJPBqAwiYGdOUDv", node: "1281:2960", frame: "pc端" }, pc: {}, pad: {}, mobile: {} };

// Expected values from the Figma PC frame (see /tmp/figma-47748-pc-spec.json).
// Colors normalized to lowercase hex; lineHeight in px.
const EXPECTED = {
  buttonText: { fontSize: 18, fontWeight: 700, lineHeight: 54, color: "#ffffff", textAlign: "center" },
  buttonBg: { backgroundColor: "#1c4587", borderRadius: 3 },
  navLink: { fontSize: 16, fontWeight: 400, lineHeight: 44.8, color: "#222222" },
  navLinkSelected: { color: "#1c4587" },
  filterTitle: { fontSize: 14, fontWeight: 600, lineHeight: 21, color: "#232323", letterSpacing: -0.15 },
  filterOption: { fontSize: 14, fontWeight: 400, lineHeight: 21 },
  productName: { fontSize: 16, fontWeight: 400, lineHeight: 20, textAlign: "center" },
  productNameClamp: { maxLines: 2 }, // annotation: 居中 最多2行隐藏
  detailsLink: { lineHeight: 27.2 },
  pagination: { fontSize: 14, fontWeight: 400, lineHeight: 28, textAlign: "center" },
  paginationCurrent: { color: "#ffffff", backgroundColor: "#1c4587" },
  paginationOther: { color: "#898989" },
  filterInput: { borderColor: "#cbd5e0", borderRadius: 4, height: 35 },
};

const normColor = (c) => {
  const m = (c || "").match(/rgba?\(([^)]+)\)/);
  if (!m) return (c || "").toLowerCase();
  const [r, g, b] = m[1].split(",").map((x) => parseInt(x.trim(), 10));
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
};
const px = (v) => parseFloat(String(v || "").replace("px", "")) || null;
const close = (a, b, tol = 0.6) => a != null && b != null && Math.abs(a - b) <= tol;

function diffRow(name, expected, actual) {
  const diffs = [];
  for (const [k, want] of Object.entries(expected)) {
    const got = actual[k];
    let ok;
    if (typeof want === "number") ok = close(got, want, k === "letterSpacing" ? 0.05 : 0.6);
    else ok = String(got || "").toLowerCase() === String(want).toLowerCase();
    if (!ok) diffs.push(`${k}: 设计 ${want} / 实测 ${got}`);
  }
  return { name, match: diffs.length === 0, diffs, actual };
}

async function readStyles(frame, rootSel) {
  return frame.evaluate((rootSel) => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    const cs = (el) => getComputedStyle(el);
    const pick = (el, props) => {
      const s = cs(el);
      const o = {};
      for (const p of props) o[p] = s[p];
      return o;
    };
    const num = (el, prop) => parseFloat(cs(el)[prop]) || null;
    const root = document.querySelector(rootSel);
    if (!root) return { error: "预览里没有找到区块根节点 " + rootSel };
    const out = {};
    // 1. Button (New Machine)
    const btn = [...root.querySelectorAll("a")].find((a) => norm(a.innerText) === "New Machine");
    if (btn) {
      out.buttonText = { fontSize: num(btn, "fontSize"), fontWeight: parseInt(cs(btn).fontWeight, 10), lineHeight: num(btn, "lineHeight"), color: cs(btn).color, textAlign: cs(btn).textAlign };
      out.buttonBg = { backgroundColor: cs(btn).backgroundColor, borderRadius: num(btn, "borderRadius") };
    }
    // 2. Category nav links (.pf-cate-wrap a)
    const nav = [...root.querySelectorAll(".pf-cate-wrap a")];
    out.navLinks = nav.slice(0, 6).map((a) => ({ text: norm(a.innerText).slice(0, 24), fontSize: num(a, "fontSize"), fontWeight: parseInt(cs(a).fontWeight, 10), lineHeight: num(a, "lineHeight"), color: cs(a).color }));
    out.navLinkCount = nav.length;
    // 3. Filter field titles + options
    const titles = [...root.querySelectorAll(".pf-field-title, .prodfield-left-fieldname")];
    out.filterTitles = titles.slice(0, 4).map((el) => ({ text: norm(el.innerText).slice(0, 20), fontSize: num(el, "fontSize"), fontWeight: parseInt(cs(el).fontWeight, 10), lineHeight: num(el, "lineHeight"), color: cs(el).color, letterSpacing: num(el, "letterSpacing") }));
    const opts = [...root.querySelectorAll(".pf-field-group label, .prodfield-single label")];
    out.filterOptions = opts.slice(0, 4).map((el) => ({ text: norm(el.innerText).slice(0, 20), fontSize: num(el, "fontSize"), fontWeight: parseInt(cs(el).fontWeight, 10), lineHeight: num(el, "lineHeight"), color: cs(el).color }));
    // 4. Product names (+ 2-line clamp from the annotation 居中 最多2行隐藏)
    const names = [...root.querySelectorAll(".prodlist-pro-name")].filter((el) => el.getClientRects().length);
    out.productNames = names.slice(0, 3).map((el) => {
      const s = cs(el);
      return { text: norm(el.innerText).slice(0, 30), fontSize: num(el, "fontSize"), fontWeight: parseInt(s.fontWeight, 10), lineHeight: num(el, "lineHeight"), color: s.color, textAlign: s.textAlign, webkitLineClamp: s.webkitLineClamp, display: s.display, overflow: s.overflow, maxHeight: num(el, "maxHeight") };
    });
    out.productNameCount = names.length;
    // 5. details link
    const det = [...root.querySelectorAll("a")].find((a) => norm(a.innerText).toLowerCase() === "details");
    if (det) out.detailsLink = { fontSize: num(det, "fontSize"), lineHeight: num(det, "lineHeight"), color: cs(det).color };
    // 6. Pagination
    const pages = [...root.querySelectorAll(".pagination a, .pf-pagination a, [class*=pagination] a")];
    out.pagination = pages.slice(0, 5).map((a) => ({ text: norm(a.innerText).slice(0, 6), fontSize: num(a, "fontSize"), fontWeight: parseInt(cs(a).fontWeight, 10), lineHeight: num(a, "lineHeight"), color: cs(a).color, backgroundColor: cs(a).backgroundColor, textAlign: cs(a).textAlign }));
    // 7. Filter input/select box
    const inp = root.querySelector(".pf-filter-wrap select, .prodfield-form select, .pf-filter-wrap input[type=text]");
    if (inp) out.filterInput = { borderColor: cs(inp).borderColor, borderRadius: num(inp, "borderRadius"), height: inp.getBoundingClientRect().height };
    return out;
  }, rootSel);
}

async function breakage(frame, rootSel) {
  return frame.evaluate((rootSel) => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    const root = document.querySelector(rootSel);
    if (!root) return { error: "no root" };
    const res = { viewportWidth: window.innerWidth, docScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
    const wrapBox = root.getBoundingClientRect();
    res.wrapBox = { x: Math.round(wrapBox.x), width: Math.round(wrapBox.width) };
    // Elements sticking out of the block wrap (right edge beyond wrap + 1px)
    const sticking = [];
    for (const el of root.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right > wrapBox.right + 1.5 || r.left < wrapBox.left - 1.5) {
        const t = norm(el.innerText).slice(0, 30);
        if (t || el.tagName === "IMG") sticking.push({ tag: el.tagName, cls: (el.className.baseVal ?? el.className).toString().slice(0, 50), text: t, overRight: Math.round(r.right - wrapBox.right), overLeft: Math.round(wrapBox.left - r.left) });
        if (sticking.length >= 10) break;
      }
    }
    res.stickingOut = sticking;
    // Overlapping visible leaf text elements (pairs intersecting > 30% of the smaller box)
    const leaves = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      const hasTextChild = [...node.childNodes].some((n) => n.nodeType === 3 && norm(n.textContent));
      const hasElChildWithText = [...node.children].some((c) => norm(c.innerText));
      if (!hasTextChild || hasElChildWithText) continue;
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const s = getComputedStyle(node);
      if (s.visibility === "hidden" || s.display === "none") continue;
      leaves.push({ el: node, text: norm(node.innerText).slice(0, 24), box: r });
    }
    const overlaps = [];
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i].box, b = leaves[j].box;
        const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const inter = ix * iy;
        const smaller = Math.min(a.width * a.height, b.width * b.height);
        if (smaller > 0 && inter / smaller > 0.3) {
          overlaps.push({ a: leaves[i].text, b: leaves[j].text, ratio: +(inter / smaller).toFixed(2) });
          if (overlaps.length >= 10) break;
        }
      }
      if (overlaps.length >= 10) break;
    }
    res.overlaps = overlaps;
    // Text clipped horizontally (scrollWidth > clientWidth with hidden overflow)
    const clipped = [];
    for (const el of root.querySelectorAll("*")) {
      if (el.scrollWidth > el.clientWidth + 1) {
        const s = getComputedStyle(el);
        if (s.overflowX === "hidden" || s.overflowX === "clip" || s.textOverflow === "ellipsis") {
          clipped.push({ tag: el.tagName, cls: (el.className.baseVal ?? el.className).toString().slice(0, 40), text: norm(el.innerText).slice(0, 30) });
          if (clipped.length >= 10) break;
        }
      }
    }
    res.textClipped = clipped;
    // Images stretched (display ratio vs natural ratio, ignoring object-fit: cover)
    const imgs = [];
    for (const img of root.querySelectorAll("img")) {
      if (!img.naturalWidth || !img.complete) continue;
      const r = img.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const fit = getComputedStyle(img).objectFit;
      const disp = r.width / r.height, nat = img.naturalWidth / img.naturalHeight;
      if (fit !== "cover" && Math.abs(disp - nat) / nat > 0.05) {
        imgs.push({ src: (img.currentSrc || img.src).slice(-40), disp: +disp.toFixed(2), nat: +nat.toFixed(2), fit });
        if (imgs.length >= 10) break;
      }
    }
    res.imgDistorted = imgs;
    return res;
  }, rootSel);
}

let canvas;
try {
  ({ page } = await openEditor(page, config));
  canvas = await gotoTargetPage(page, config);
  const rootSel = previewSelector(config.blockId);
  const { previewPage, frame } = await openPreview(page, context);
  try {
    // PC 1440
    await previewPage.setViewportSize({ width: 1440, height: 900 });
    await frame.waitForTimeout(2500);
    const pcStyles = await readStyles(frame, rootSel);
    const rows = [];
    if (pcStyles.buttonText) rows.push(diffRow("按钮文字 New Machine", EXPECTED.buttonText, { ...pcStyles.buttonText, color: normColor(pcStyles.buttonText.color) }));
    if (pcStyles.buttonBg) rows.push(diffRow("按钮背景", EXPECTED.buttonBg, { ...pcStyles.buttonBg, backgroundColor: normColor(pcStyles.buttonBg.backgroundColor) }));
    for (const l of (pcStyles.navLinks || []).slice(0, 2)) rows.push(diffRow(`分类导航「${l.text}」`, EXPECTED.navLink, { ...l, color: normColor(l.color) }));
    for (const t of (pcStyles.filterTitles || []).slice(0, 2)) rows.push(diffRow(`筛选组标题「${t.text}」`, EXPECTED.filterTitle, { ...t, color: normColor(t.color) }));
    for (const o of (pcStyles.filterOptions || []).slice(0, 2)) rows.push(diffRow(`筛选值「${o.text}」`, EXPECTED.filterOption, { ...o, color: normColor(o.color) }));
    for (const n of (pcStyles.productNames || []).slice(0, 2)) {
      rows.push(diffRow(`产品名「${n.text}」`, EXPECTED.productName, { ...n, color: normColor(n.color) }));
      const clamp = n.webkitLineClamp ? parseInt(n.webkitLineClamp, 10) : null;
      rows.push({ name: `产品名「${n.text}」行数限制（设计稿：居中 最多2行隐藏）`, match: clamp === 2 || (n.maxHeight != null && Math.abs(n.maxHeight - 40) <= 1), diffs: clamp === 2 ? [] : [`line-clamp: ${clamp} / max-height: ${n.maxHeight} / overflow: ${n.overflow}`], actual: { webkitLineClamp: clamp, maxHeight: n.maxHeight, overflow: n.overflow } });
    }
    if (pcStyles.detailsLink) rows.push(diffRow("details 链接", EXPECTED.detailsLink, { ...pcStyles.detailsLink, color: normColor(pcStyles.detailsLink.color) }));
    for (const p of (pcStyles.pagination || []).slice(0, 3)) {
      const isCurrent = normColor(p.backgroundColor) === "#1c4587";
      rows.push(diffRow(`分页「${p.text}」${isCurrent ? "（当前页）" : ""}`, { ...EXPECTED.pagination, ...(isCurrent ? EXPECTED.paginationCurrent : EXPECTED.paginationOther) }, { ...p, color: normColor(p.color), backgroundColor: normColor(p.backgroundColor) }));
    }
    if (pcStyles.filterInput) rows.push(diffRow("筛选下拉框", EXPECTED.filterInput, { ...pcStyles.filterInput, borderColor: normColor(pcStyles.filterInput.borderColor) }));
    out.pc = { styles: pcStyles, diffs: rows, breakage: await breakage(frame, rootSel) };
    const root = frame.locator(rootSel).first();
    await root.screenshot({ path: "screenshots/style-47748-pc.png" }).catch((e) => { out.pc.screenshotError = e.message; });

    // Pad 768: design file has no pad frame for this block -> breakage only
    await previewPage.setViewportSize({ width: 768, height: 1024 });
    await frame.waitForTimeout(2500);
    out.pad = { breakage: await breakage(frame, rootSel) };
    await root.screenshot({ path: "screenshots/style-47748-pad.png" }).catch((e) => { out.pad.screenshotError = e.message; });

    // Mobile 375: same, breakage only
    await previewPage.setViewportSize({ width: 375, height: 667 });
    await frame.waitForTimeout(2500);
    out.mobile = { breakage: await breakage(frame, rootSel) };
    await root.screenshot({ path: "screenshots/style-47748-mobile.png" }).catch((e) => { out.mobile.screenshotError = e.message; });
  } finally {
    for (const tab of context.pages().filter((t) => t !== page)) { try { if (!tab.isClosed()) await tab.close(); } catch {} }
  }
} catch (error) {
  out.error = error.message;
} finally {
  fs.writeFileSync("hidden/probe-47748-style.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ pcDiffs: (out.pc?.diffs || []).map((d) => ({ name: d.name, match: d.match, diffs: d.diffs })), pcBreakage: out.pc?.breakage, padBreakage: out.pad?.breakage, mobileBreakage: out.mobile?.breakage, error: out.error }, null, 2));
  await browser.close().catch(() => {});
}
