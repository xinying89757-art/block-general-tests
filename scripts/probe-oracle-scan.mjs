// Scan: enable 测试单选按钮A + 测试下拉列表 in the block filter, then for
// each option value of each field, select + Search and record the exact
// product-name set (all pages via the block's pagination if present).
// Restores both fields to disabled afterwards.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, addBlockIfNeeded, savePage, openPreview } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = { fields: {} };
const DIALOG = '.backstage-dialog.backstage-dialog-widgetsettinsframe';
const FIELDS = ['测试单选按钮A', '测试下拉列表'];

async function findCanvasFrame() {
  for (const f of page.frames()) {
    try {
      if (await f.evaluate(() => document.querySelectorAll('.backstage-blocksEditor-wrap').length) > 0) return f;
    } catch { /* ignore */ }
  }
  return null;
}

async function setFilterFields(canvas, labels, wantChecked) {
  await canvas.evaluate(() => {
    const wrap = document.querySelector('.backstage-blocksEditor-wrap[data-blockseditor-type="phoenix_blocks_filterStyle"]');
    const btn = wrap && wrap.querySelector('a.backstage-widgettool-btns');
    if (btn) btn.click();
  });
  await page.waitForSelector(`${DIALOG}:visible`, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const res = await page.evaluate(({ labels, wantChecked }) => {
    const dlg = document.querySelector('.backstage-dialog.backstage-dialog-widgetsettinsframe');
    const out = {};
    for (const label of labels) {
      const box = [...dlg.querySelectorAll('input[type=checkbox]')].find((b) => {
        const t = [...(b.labels || [])].map((l) => l.innerText).join(' ') || (b.closest('li,label,div') || {}).innerText || '';
        return t.replace(/\s+/g, ' ').trim().startsWith(label);
      });
      if (!box) { out[label] = 'not-found'; continue; }
      if (box.checked !== wantChecked) box.click();
      out[label] = box.checked;
    }
    return out;
  }, { labels, wantChecked });
  await page.evaluate(() => {
    const dlg = document.querySelector('.backstage-dialog.backstage-dialog-widgetsettinsframe');
    const btn = [...dlg.querySelectorAll('.backstage-dialog-bottom *')].find((n) => (n.innerText || '').trim() === '保存');
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);
  return res;
}

async function names(frame) {
  return frame.evaluate(() => [...document.querySelectorAll('.LA40838 .prodlist-pro-name')]
    .map((n) => (n.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
}

async function groupValues(frame, title) {
  return frame.evaluate((t) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const g = [...document.querySelectorAll('.LA40838 .prodfield-single')]
      .find((x) => norm(x.querySelector('.prodfield-left-fieldname')?.innerText) === t);
    if (!g) return [];
    return [...new Set([...g.querySelectorAll('label')].map((l) => norm(l.innerText)).filter((v) => v && v !== 'All'))];
  }, title);
}

async function selectAndSearch(frame, title, value) {
  await frame.evaluate(({ t, v }) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const g = [...document.querySelectorAll('.LA40838 .prodfield-single')]
      .find((x) => norm(x.querySelector('.prodfield-left-fieldname')?.innerText) === t);
    const el = [...g.querySelectorAll('label')].find((n) => norm(n.innerText) === v);
    if (el) { el.scrollIntoView({ block: 'center' }); el.click(); }
  }, { t: title, v: value });
  await page.waitForTimeout(700);
  await frame.evaluate(() => {
    const el = document.querySelector('.LA40838 .prodfield-search');
    if (el) el.click();
  });
  await page.waitForTimeout(3000);
}

async function clearFilters(frame) {
  await frame.evaluate(() => {
    const el = [...document.querySelectorAll('.LA40838 *')].find((n) => (n.innerText || '').trim() === 'Clear Filters');
    if (el) el.click();
  });
  await page.waitForTimeout(2500);
}

try {
  ({ page } = await openEditor(page, config));
  const canvasLocator = await gotoTargetPage(page, config);
  await addBlockIfNeeded(page, canvasLocator, config).catch(() => {});
  await page.waitForTimeout(2500);
  const canvas = await findCanvasFrame();
  out.enable = await setFilterFields(canvas, FIELDS, true);
  await savePage(page, config);

  // Fresh preview per value: facet collapse after a selection makes
  // in-session re-selection unreliable (verified in scan v1).
  for (const field of FIELDS) {
    let pv = await openPreview(page, context);
    await page.waitForTimeout(3000);
    const values = await groupValues(pv.frame, field);
    await pv.previewPage.close().catch(() => {});
    out.fields[field] = { values, sets: {} };
    for (const v of values) {
      pv = await openPreview(page, context);
      await page.waitForTimeout(2800);
      await selectAndSearch(pv.frame, field, v);
      out.fields[field].sets[v] = await names(pv.frame);
      await pv.previewPage.close().catch(() => {});
    }
  }
  out.disable = await setFilterFields(canvas, FIELDS, false);
  await savePage(page, config);
} finally {
  fs.writeFileSync('hidden/oracle-scan.json', JSON.stringify(out, null, 2));
  await browser.close();
}
console.log('scan done');
for (const [f, data] of Object.entries(out.fields)) {
  console.log('FIELD', f, 'values:', (data.values || []).join(', '));
  for (const [v, set] of Object.entries(data.sets || {})) console.log(' ', v, '->', set.length, JSON.stringify(set.slice(0, 8)));
}
