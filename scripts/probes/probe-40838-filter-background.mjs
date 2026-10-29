// Probe (settings changed, then restored): where does the filter background
// color (#customOnBgColor) actually land? The effect checks read
// .prodfield-form / .pf-filter-wrap and get transparent, while the settings
// layer persists fine. Sets rgb(1,2,3), dumps every non-transparent
// background inside the block in canvas + preview (fields unchecked, then
// with one field enabled), searches stylesheets for the color, then restores
// rgb(139,0,0) and saves.
import fs from "node:fs";
import { writeFileSync, readFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor, ensureTargetPage, savePage, openPreview, resolveTargetPage } from '../../src/editor.mjs';
import { widgetSession, blockSelector } from '../../src/capabilities/shared.mjs';

const config = loadConfig();
const profile = JSON.parse(readFileSync(`profiles/${config.blockId}.json`, 'utf8'));
config.resolvedTarget = resolveTargetPage(config, profile);
const out = { at: new Date().toISOString(), site: config.siteDomain, steps: {} };
const TEST = 'rgb(1, 2, 3)';
const ORIGINAL = 'rgb(139, 0, 0)';

async function setColor(session, page, color) {
  const input = session.root.locator('#customOnBgColor');
  const used = await input.evaluate((node, value) => {
    const win = node.ownerDocument.defaultView, jq = win.jQuery || win.$;
    if (typeof jq?.fn?.spectrum !== 'function') return false;
    jq(node).spectrum('set', value); jq(node).trigger('change'); return true;
  }, color);
  if (!used) throw new Error('Spectrum API 不可用');
  return input.inputValue();
}

async function dumpBackgrounds(node) {
  const norm = (c) => (c || '').replace(/\s+/g, ' ').trim();
  const hits = [];
  const walk = (el, depth) => {
    if (depth > 12) return;
    const cs = getComputedStyle(el);
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
      hits.push({ tag: el.tagName, cls: norm(el.className && el.className.baseVal !== undefined ? '' : el.className).slice(0, 80),
        bg: cs.backgroundColor, inline: (el.getAttribute('style') || '').slice(0, 120) });
    }
    for (const child of el.children) walk(child, depth + 1);
  };
  walk(node, 0);
  const form = node.querySelector('.prodfield-form');
  const wrap = node.querySelector('.pf-filter-wrap');
  const styleHits = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    for (const rule of rules) {
      const text = rule.cssText || '';
      if (/010203|1,\s*2,\s*3/.test(text)) styleHits.push(text.slice(0, 200));
    }
  }
  return {
    form: form ? { found: true, bg: getComputedStyle(form).backgroundColor, cls: norm(form.className).slice(0, 120) } : { found: false },
    wrap: wrap ? { found: true, bg: getComputedStyle(wrap).backgroundColor } : { found: false },
    nonTransparent: hits.slice(0, 20),
    styleRulesWithColor: styleHits.slice(0, 10),
  };
}

const session = await launchSession(config);

// Direct single read: readEffectRoot's waitForStable never settles on this
// dump (the canvas keeps re-rendering after a settings save), so wait for
// the block to attach, let the canvas settle, then evaluate once.
async function readBlock(frame) {
  const root = frame.locator(blockSelector(config.blockId)).first();
  await root.waitFor({ state: 'attached', timeout: 15_000 });
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  return root.evaluate(dumpBackgrounds);
}
try {
  const { page } = await openEditor(session.page, config);
  const canvas = (await ensureTargetPage(page, config)).frame;
  const ws = widgetSession({ page, canvas, config, type: 'phoenix_blocks_filterStyle', title: '设置自定义字段筛选' });
  await ws.open();
  out.steps.original = await ws.root.locator('#customOnBgColor').inputValue();
  await setColor(ws, page, TEST);
  await ws.save();
  await savePage(page);
  out.steps.setToTest = await (async () => {
    await ws.open();
    const v = await ws.root.locator('#customOnBgColor').inputValue();
    await ws.cancel();
    return v;
  })();
  // Backend (canvas), fields unchecked (baseline).
  out.steps.backendUnchecked = await readBlock(canvas);
  // Enable one field, save, re-read backend.
  await ws.open();
  const field = ws.root.locator('input[type="checkbox"]').filter({ hasText: '测试单选按钮A' });
  const box = ws.root.locator('label').filter({ hasText: /^测试单选按钮A$/ }).locator('input[type="checkbox"]').first();
  if (await box.count()) await box.check();
  await ws.save();
  await savePage(page);
  out.steps.backendOneField = await readBlock(canvas);
  // Preview (fresh throwaway preview, one field enabled), like the effect checks.
  const preview = await openPreview(page, session.context);
  out.steps.previewOneField = await readBlock(preview.frame);
  await preview.previewPage.close().catch(() => {});
  // Restore: uncheck the field, restore color, save.
  await ws.open();
  if (await box.count()) await box.uncheck();
  await setColor(ws, page, ORIGINAL);
  await ws.save();
  await savePage(page);
  out.steps.restored = await (async () => {
    await ws.open();
    const v = await ws.root.locator('#customOnBgColor').inputValue();
    await ws.cancel();
    return v;
  })();
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-filter-background-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
