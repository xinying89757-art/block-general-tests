// Probe: observable front effects of filter settings.
// Round A: 筛选逻辑=并集 → preview: select Series value, watch Category group.
// Round B: 筛选触发=自动筛选 → preview: select value WITHOUT Search, watch changes.
// Restores 交集 + 点击搜索按钮 at the end. Also records group collapse markup.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, addBlockIfNeeded, savePage, openPreview } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = { rounds: [] };
const DIALOG = '.backstage-dialog.backstage-dialog-widgetsettinsframe';

async function openFilterDialog(canvas) {
  await canvas.evaluate(() => {
    const wrap = document.querySelector('.backstage-blocksEditor-wrap[data-blockseditor-type="phoenix_blocks_filterStyle"]');
    const btn = wrap && wrap.querySelector('a.backstage-widgettool-btns');
    if (btn) btn.click();
  });
  await page.waitForSelector(`${DIALOG}:visible`, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function setRadio(prefix) {
  return page.evaluate((pfx) => {
    const dlg = document.querySelector('.backstage-dialog.backstage-dialog-widgetsettinsframe');
    if (!dlg) return 'no-dialog';
    const inputs = [...dlg.querySelectorAll('input[type=radio]')];
    for (const inp of inputs) {
      const label = [...(inp.labels || [])].map((l) => l.innerText).join(' ')
        || (inp.closest('li,label,div') || {}).innerText || '';
      if (label.trim().startsWith(pfx)) { inp.click(); return 'set:' + label.trim().slice(0, 24); }
    }
    return 'not-found';
  }, prefix);
}

async function dialogSave() {
  await page.evaluate(() => {
    const dlg = document.querySelector('.backstage-dialog.backstage-dialog-widgetsettinsframe');
    const btn = dlg && [...dlg.querySelectorAll('.backstage-dialog-bottom *')].find((n) => (n.innerText || '').trim() === '保存');
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);
}

async function groups(frame) {
  return frame.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('.LA40838 .prodfield-single')].map((g) => ({
      title: norm(g.querySelector('.prodfield-left-fieldname')?.innerText),
      cls: g.className,
      values: [...new Set([...g.querySelectorAll('label')].map((l) => norm(l.innerText)).filter((v) => v && v.toLowerCase() !== 'all'))],
    }));
  });
}

async function selectValue(frame, value) {
  return frame.evaluate((v) => {
    const g = document.querySelectorAll('.LA40838 .prodfield-single')[0];
    const el = [...g.querySelectorAll('label')].find((n) => (n.innerText || '').trim() === v);
    if (!el) return 'no-value';
    el.scrollIntoView({ block: 'center' });
    el.click();
    return 'clicked';
  }, value);
}

async function clickSearch(frame) {
  await frame.evaluate(() => {
    const el = document.querySelector('.LA40838 .prodfield-search');
    if (el) el.click();
  });
}

async function selectedArea(frame) {
  return frame.evaluate(() => {
    const el = document.querySelector('.LA40838 .prodfield-bottom');
    return el ? el.innerText.replace(/\s+/g, ' ').trim().slice(0, 200) : null;
  });
}

async function findCanvasFrame() {
  for (const f of page.frames()) {
    try {
      const n = await f.evaluate(() => document.querySelectorAll('.backstage-blocksEditor-wrap').length);
      if (n > 0) return f;
    } catch { /* not ready */ }
  }
  return null;
}

let canvas;
try {
  ({ page } = await openEditor(page, config));
  await gotoTargetPage(page, config);
  await page.waitForTimeout(3000);
  canvas = await findCanvasFrame();
  if (!canvas) throw new Error('canvas frame not found');
  await addBlockIfNeeded(page, canvas, config);

  // ---- Round A: union logic
  await openFilterDialog(canvas);
  out.rounds.push('A set radio: ' + await setRadio('并集'));
  await dialogSave();
  await savePage(page, config);
  let pv = await openPreview(page, context);
  await page.waitForTimeout(2500);
  out.unionBaseline = await groups(pv.frame);
  out.rounds.push('A select: ' + await selectValue(pv.frame, 'Hydraulic cylinder'));
  await page.waitForTimeout(800);
  await clickSearch(pv.frame);
  await page.waitForTimeout(3000);
  out.unionAfter = await groups(pv.frame);
  out.unionSelected = await selectedArea(pv.frame);
  await pv.previewPage.close().catch(() => {});

  // ---- Round B: restore logic=intersection, set trigger=auto
  await openFilterDialog(canvas);
  out.rounds.push('B restore logic: ' + await setRadio('交集'));
  out.rounds.push('B set trigger: ' + await setRadio('更改筛选项后自动筛选'));
  await dialogSave();
  await savePage(page, config);
  pv = await openPreview(page, context);
  await page.waitForTimeout(2500);
  out.autoBaseline = await groups(pv.frame);
  out.rounds.push('B select (no search): ' + await selectValue(pv.frame, 'Hydraulic cylinder'));
  await page.waitForTimeout(3500);
  out.autoAfter = await groups(pv.frame);
  out.autoSelected = await selectedArea(pv.frame);
  await pv.previewPage.close().catch(() => {});

  // ---- Restore trigger
  await openFilterDialog(canvas);
  out.rounds.push('restore trigger: ' + await setRadio('点击“搜索”按钮'));
  await dialogSave();
  await savePage(page, config);
} finally {
  fs.writeFileSync('hidden/effects-probe.json', JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5500));
