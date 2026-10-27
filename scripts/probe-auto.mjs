// Probe B retry + state safety: read current filter radios, test 自动筛选
// front effect (select value, NO Search click), then restore trigger to
// 点击“搜索”按钮 and logic to 交集, verifying final state by re-reading.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, addBlockIfNeeded, savePage, openPreview } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = { log: [] };
const DIALOG = '.backstage-dialog.backstage-dialog-widgetsettinsframe';

async function findCanvasFrame() {
  for (const f of page.frames()) {
    try {
      if (await f.evaluate(() => document.querySelectorAll('.backstage-blocksEditor-wrap').length) > 0) return f;
    } catch { /* ignore */ }
  }
  return null;
}

async function openFilterDialog(canvas) {
  await canvas.evaluate(() => {
    const wrap = document.querySelector('.backstage-blocksEditor-wrap[data-blockseditor-type="phoenix_blocks_filterStyle"]');
    const btn = wrap && wrap.querySelector('a.backstage-widgettool-btns');
    if (btn) btn.click();
  });
  await page.waitForSelector(`${DIALOG}:visible`, { timeout: 15000 });
  await page.waitForTimeout(1200);
}

async function readRadios() {
  return page.evaluate(() => {
    const dlg = document.querySelector('.backstage-dialog.backstage-dialog-widgetsettinsframe');
    if (!dlg) return null;
    return [...dlg.querySelectorAll('input[type=radio]')].map((inp) => {
      const label = [...(inp.labels || [])].map((l) => l.innerText).join(' ')
        || (inp.closest('li,label,div') || {}).innerText || '';
      return { label: label.replace(/\s+/g, ' ').trim().slice(0, 30), checked: inp.checked };
    }).filter((r) => r.checked);
  });
}

async function setRadio(prefix) {
  return page.evaluate((pfx) => {
    const dlg = document.querySelector('.backstage-dialog.backstage-dialog-widgetsettinsframe');
    if (!dlg) return 'no-dialog';
    for (const inp of dlg.querySelectorAll('input[type=radio]')) {
      const label = [...(inp.labels || [])].map((l) => l.innerText).join(' ')
        || (inp.closest('li,label,div') || {}).innerText || '';
      if (label.trim().startsWith(pfx)) { inp.click(); return 'set'; }
    }
    return 'not-found';
  }, prefix);
}

async function dialogButton(text) {
  await page.evaluate((t) => {
    const dlg = document.querySelector('.backstage-dialog.backstage-dialog-widgetsettinsframe');
    const btn = dlg && [...dlg.querySelectorAll('.backstage-dialog-bottom *')].find((n) => (n.innerText || '').trim() === t);
    if (btn) btn.click();
  }, text);
  await page.waitForTimeout(1800);
}

async function groups(frame) {
  return frame.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('.LA40838 .prodfield-single')].map((g) => ({
      title: norm(g.querySelector('.prodfield-left-fieldname')?.innerText),
      values: [...new Set([...g.querySelectorAll('label')].map((l) => norm(l.innerText)).filter((v) => v && v.toLowerCase() !== 'all'))],
    }));
  });
}

try {
  ({ page } = await openEditor(page, config));
  const canvasLocator = await gotoTargetPage(page, config);
  await addBlockIfNeeded(page, canvasLocator, config).catch(() => {});
  await page.waitForTimeout(2500);
  const canvas = await findCanvasFrame();
  if (!canvas) throw new Error('canvas frame not found');

  await openFilterDialog(canvas);
  out.initialRadios = await readRadios();
  out.log.push('set trigger auto: ' + await setRadio('更改筛选项后自动筛选'));
  await dialogButton('保存');
  await savePage(page, config);

  const pv = await openPreview(page, context);
  await page.waitForTimeout(2500);
  out.autoBaseline = await groups(pv.frame);
  const sel = await pv.frame.evaluate(() => {
    const g = document.querySelectorAll('.LA40838 .prodfield-single')[0];
    const el = [...g.querySelectorAll('label')].find((n) => (n.innerText || '').trim() === 'Hydraulic cylinder');
    if (!el) return 'no-value';
    el.scrollIntoView({ block: 'center' });
    el.click();
    return 'clicked-no-search';
  });
  out.log.push('select: ' + sel);
  await page.waitForTimeout(4000);
  out.autoAfter = await groups(pv.frame);
  out.autoTag = await pv.frame.evaluate(() => {
    const el = document.querySelector('.LA40838 .prodfield-bottom');
    return el ? el.innerText.replace(/\s+/g, ' ').trim().slice(0, 160) : null;
  });
  await pv.previewPage.close().catch(() => {});

  // Restore defaults
  await openFilterDialog(canvas);
  out.log.push('restore trigger: ' + await setRadio('点击“搜索”按钮'));
  out.log.push('restore logic: ' + await setRadio('交集'));
  await dialogButton('保存');
  await savePage(page, config);
  await openFilterDialog(canvas);
  out.finalRadios = await readRadios();
  await dialogButton('取消');
} finally {
  fs.writeFileSync('hidden/auto-probe.json', JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5000));
