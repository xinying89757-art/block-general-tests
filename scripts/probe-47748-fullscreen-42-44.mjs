// Probe: two open questions from the 2026-10-28 merged run.
// 1) Fullscreen width: mw-width-front/backend fail because the computed
//    max-width of the width shell reads 1440px at fullscreen, expected
//    "none". The check reads the COMPUTED max-width property (not the
//    rendered width), so a 1440px reading is either a genuine platform cap
//    or the wrong shell element. Decisive test: for each candidate element
//    (wrap, .hasDefaultWidth, div.container, ancestors up to body), read
//    computed max-width at fullscreen AND at the 1920 preset (control).
//    If the same element tracks the setting (1920 -> 1440), the cap is
//    real; if a different element tracks it, the check measures the wrong
//    element. Also records rendered widths at a 2560px viewport.
// 2) 42/44 categories: the nav renders 42 clean names; Container Liner
//    Bag and Cosmetic Packaging Bag only appear inside concatenated dialog
//    labels. Decisive test: expand the nav parent they likely nest under
//    (Chemical Bag) in the preview and re-read; plus read the dialog
//    tree parent-child structure for both names.
// Restores width to custom 1440 in a finally block. Category part is
// read-only (preview expand + dialog read, no settings changed).
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, ensureTargetPage, savePage, openPreview, resolveTargetPage } from "../src/editor.mjs";
import { RAIL, openRailPanel, readModuleWidth, setModuleWidth, saveWidthPanel } from "../src/capabilities/rail.mjs";
import { widgetSession, previewSelector } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
const out = { blockId: config.blockId, width: {}, categories: {} };
let { browser, page, context } = await launchSession(config);
let canvas;

async function measureCandidates(frame) {
  const root = frame.locator(previewSelector(config.blockId)).first();
  await root.waitFor({ state: "attached", timeout: 30000 });
  return root.evaluate((wrap) => {
    const cs = (el) => getComputedStyle(el);
    const chain = [];
    let el = wrap.querySelector(".hasDefaultWidth") || wrap.querySelector("div.container") || wrap;
    // Walk from the shell up to body, recording computed max-width.
    let node = el;
    while (node && node !== document.body) {
      chain.push({
        tag: node.tagName,
        cls: String(node.className || "").slice(0, 80),
        maxWidth: cs(node).maxWidth,
        width: Math.round(node.getBoundingClientRect().width),
      });
      node = node.parentElement;
    }
    chain.push({ tag: "BODY", cls: "", maxWidth: cs(document.body).maxWidth, width: Math.round(document.body.getBoundingClientRect().width) });
    const shell = wrap.querySelector(".hasDefaultWidth");
    const container = wrap.querySelector("div.container");
    return {
      viewportWidth: document.documentElement.clientWidth,
      wrapWidth: Math.round(wrap.getBoundingClientRect().width),
      wrapMaxWidth: cs(wrap).maxWidth,
      shell: shell ? { maxWidth: cs(shell).maxWidth, width: Math.round(shell.getBoundingClientRect().width), cls: String(shell.className).slice(0, 80) } : null,
      container: container ? { maxWidth: cs(container).maxWidth, width: Math.round(container.getBoundingClientRect().width), cls: String(container.className).slice(0, 80) } : null,
      chain,
    };
  });
}

async function withPreview(fn) {
  const before = new Set(context.pages());
  await savePage(page);
  const preview = await openPreview(page, context);
  try {
    return await fn(preview.previewPage, preview.frame);
  } finally {
    for (const tab of context.pages().filter((t) => !before.has(t) && t !== page)) {
      try { if (!tab.isClosed()) await tab.close(); } catch {}
    }
  }
}

async function setWidthAndMeasure(label, setter) {
  await openRailPanel(canvas, config.blockId, RAIL.widthIcon, RAIL.widthPanel);
  await setter();
  await saveWidthPanel(canvas);
  const after = await withPreview(async (previewPage, frame) => {
    const atDefault = await measureCandidates(frame);
    await previewPage.setViewportSize({ width: 2560, height: 1200 });
    await previewPage.waitForTimeout(1200);
    const at2560 = await measureCandidates(frame);
    return { atDefault, at2560 };
  });
  out.width[label] = after;
  return after;
}

function readNavEntries(frame) {
  const root = frame.locator(previewSelector(config.blockId)).first();
  return root.evaluate((wrap) => {
    const nav = wrap.querySelector(".pf-cate-wrap");
    if (!nav) return null;
    return [...nav.querySelectorAll("a")]
      .filter((n) => !n.closest(".backstage-widgettool-btns"))
      .map((n) => {
        let depth = 0;
        for (let p = n.parentElement; p && p !== nav; p = p.parentElement) if (p.tagName === "LI") depth++;
        return { name: (n.textContent || "").replace(/\s+/g, " ").trim(), depth,
          visible: Boolean(n.getClientRects().length) && getComputedStyle(n).visibility !== "hidden" };
      })
      .filter((e) => e.name);
  });
}

try {
  ({ page } = await openEditor(page, config));
  const profile = JSON.parse(fs.readFileSync(`profiles/${config.blockId}.json`, "utf8"));
  config.resolvedTarget = resolveTargetPage(config, profile);
  ({ frame: canvas } = await ensureTargetPage(page, config));

  // --- Part A: width ---
  await openRailPanel(canvas, config.blockId, RAIL.widthIcon, RAIL.widthPanel);
  const initial = await readModuleWidth(canvas);
  out.width.initial = { checked: initial.checked, effective: initial.effective, customVal: initial.customVal };
  console.log("initial width:", JSON.stringify(out.width.initial));
  // Cancel the panel (read-only so far) by pressing Escape.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  await setWidthAndMeasure("fullscreen", async () => { await setModuleWidth(canvas, { preset: "全屏" }); });
  console.log("fullscreen measured: shell maxWidth @default =",
    out.width.fullscreen.atDefault.shell?.maxWidth, "| @2560 =", out.width.fullscreen.at2560.shell?.maxWidth);
  await setWidthAndMeasure("preset1920", async () => { await setModuleWidth(canvas, { preset: "1920px" }); });
  console.log("1920 measured: shell maxWidth @default =",
    out.width.preset1920.atDefault.shell?.maxWidth, "| @2560 =", out.width.preset1920.at2560.shell?.maxWidth);

  // --- Part B: categories (preview nav expand) ---
  const cat = await withPreview(async (previewPage, frame) => {
    const before = await readNavEntries(frame);
    const result = { before, beforeCount: before?.length ?? 0, twoNamesBefore: ["Container Liner Bag", "Cosmetic Packaging Bag"].map((n) => ({ name: n, present: before?.some((e) => e.name === n) ?? false })) };
    // Find the Chemical Bag link and its expand control in the preview nav.
    const root = frame.locator(previewSelector(config.blockId)).first();
    const expanded = await root.evaluate((wrap) => {
      const nav = wrap.querySelector(".pf-cate-wrap");
      if (!nav) return { error: "no .pf-cate-wrap" };
      const link = [...nav.querySelectorAll("a")].find((a) => (a.textContent || "").trim() === "Chemical Bag");
      if (!link) return { error: "no Chemical Bag link" };
      const li = link.closest("li");
      if (!li) return { error: "Chemical Bag link has no li" };
      // Look for an expander inside the li (arrow/toggle/icon) and click it.
      const expander = li.querySelector(":scope > i, :scope > span[class*='arrow'], :scope > span[class*='expand'], :scope > span[class*='toggle'], :scope > a[class*='arrow']");
      const info = { liHtml: li.outerHTML.slice(0, 600), hasExpander: Boolean(expander), expanderCls: expander ? String(expander.className).slice(0, 80) : null };
      if (expander) { expander.dispatchEvent(new MouseEvent("click", { bubbles: true })); info.clicked = "expander"; }
      else { link.dispatchEvent(new MouseEvent("click", { bubbles: true })); info.clicked = "link itself"; }
      return info;
    });
    result.expandAttempt = expanded;
    await previewPage.waitForTimeout(1500);
    const after = await readNavEntries(frame);
    result.after = after;
    result.afterCount = after?.length ?? 0;
    result.twoNamesAfter = ["Container Liner Bag", "Cosmetic Packaging Bag"].map((n) => {
      const hit = after?.find((e) => e.name === n);
      return { name: n, present: Boolean(hit), depth: hit?.depth ?? null, visible: hit?.visible ?? null };
    });
    return result;
  });
  out.categories.preview = cat;
  console.log("categories: before", cat.beforeCount, "after", cat.afterCount, JSON.stringify(cat.twoNamesAfter));

  // Dialog tree: parent of the two names.
  const session = widgetSession({ page, canvas, config, type: "phoenix_blocks_gallery", title: "设置产品分类", wrapIndex: 0 });
  await session.open();
  const tree = await (() => {
    const dialog = page.locator(".backstage-dialog.backstage-dialog-widgetsettinsframe").filter({ hasText: "设置产品分类" }).filter({ visible: true }).first();
    return dialog.evaluate((dlg) => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const out2 = {};
      for (const name of ["Container Liner Bag", "Cosmetic Packaging Bag", "Chemical Bag"]) {
        const nodes = [...dlg.querySelectorAll("li, label, div, span")].filter((n) => norm(n.textContent).startsWith(name) && norm(n.textContent).length < name.length + 30);
        const hit = nodes[0];
        if (!hit) { out2[name] = null; continue; }
        // Walk up to the nearest li ancestor that contains a checkbox/label tree.
        let li = hit.closest("li");
        let parentName = null;
        if (li) {
          const parentLi = li.parentElement?.closest("li");
          if (parentLi) {
            const label = parentLi.querySelector(":scope > label, :scope > div > label, :scope > span");
            parentName = label ? norm(label.textContent).slice(0, 80) : norm(parentLi.textContent).slice(0, 80);
          }
        }
        out2[name] = { parentName, ownText: norm(hit.textContent).slice(0, 80) };
      }
      return out2;
    });
  })();
  await session.cancel();
  out.categories.dialogTree = tree;
  console.log("dialog tree:", JSON.stringify(tree));
} finally {
  // Restore width to custom 1440 (baseline) no matter what.
  try {
    await openRailPanel(canvas, config.blockId, RAIL.widthIcon, RAIL.widthPanel);
    const now = await readModuleWidth(canvas);
    if (!(now.checked?.value === "-1" && Number(now.customVal) === 1440)) {
      await setModuleWidth(canvas, { custom: 1440 });
      await saveWidthPanel(canvas);
      await savePage(page);
      await page.waitForTimeout(1000);
      await openRailPanel(canvas, config.blockId, RAIL.widthIcon, RAIL.widthPanel);
      const back = await readModuleWidth(canvas);
      out.width.restored = { checked: back.checked, effective: back.effective, customVal: back.customVal };
      await page.keyboard.press("Escape");
    } else {
      out.width.restored = { alreadyBaseline: true, checked: now.checked, effective: now.effective };
    }
  } catch (e) {
    out.width.restoreError = String(e?.message || e);
  }
  fs.writeFileSync("hidden/probe-47748-fullscreen-42-44.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log("probe done");
