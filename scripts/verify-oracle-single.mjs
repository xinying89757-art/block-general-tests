// Diagnostic: single-field filters in a fresh preview (fields enabled):
//   A=单选4-10 alone  -> expect {测试产品A, 测试产品小何1}
//   B=下拉列表4-10 alone -> expect {测试产品A, 测试产品小何2}
// Distinguishes "小何2's B value not yet in the front index" from
// "two-field union does not union across fields". Restores settings.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, addBlockIfNeeded, savePage, openPreview } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, context, page } = await launchSession(config);
const out = {};
const DIALOG = '.backstage-dialog.backstage-dialog-widgetsettinsframe';
const FA = '测试单选按钮A', FB = '测试下拉列表', VA = '单选4-10', VB = '下拉列表4-10';

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
async function closeFilterDialog(saveIt) {
  await page.evaluate((doSave) => {
    const dlg = document.querySelector('.backstage-dialog.backstage-dialog-widgetsettinsframe');
    const label = doSave ? '保存' : '取消';
    const btn = [...dlg.querySelectorAll('.backstage-dialog-bottom *')].find((n) => (n.innerText || '').trim() === label);
    if (btn) btn.click();
  }, saveIt);
  await page.waitForTimeout(1800);
}
async function setFields(canvas, labels, want) {
  await openFilterDialog(canvas);
  await page.evaluate(({ labels, want }) => {
    const dlg = document.querySelector('.backstage-dialog.backstage-dialog-widgetsettinsframe');
    for (const label of labels) {
      const box = [...dlg.querySelectorAll('input[type=checkbox]')].find((b) => {
        const t = [...(b.labels || [])].map((l) => l.innerText).join(' ') || (b.closest('li,label,div') || {}).innerText || '';
        return t.replace(/\s+/g, ' ').trim().startsWith(label);
      });
      if (box && box.checked !== want) box.click();
    }
  }, { labels, want });
  await closeFilterDialog(true);
}
async function tags(frame) {
  return frame.evaluate(() => {
    const z = document.querySelector('.LA40838 .prodfield-bottom');
    return z ? (z.innerText || '').replace(/\s+/g, ' ').trim() : '';
  });
}
async function single(frame, title, value) {
  await frame.evaluate(({ t, v }) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const g = [...document.querySelectorAll('.LA40838 .prodfield-single')]
      .find((x) => norm(x.querySelector('.prodfield-left-fieldname')?.innerText) === t);
    const el = [...g.querySelectorAll('label')].find((n) => norm(n.innerText) === v);
    if (el) { el.scrollIntoView({ block: 'center' }); el.click(); }
  }, { t: title, v: value });
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(600);
    if ((await tags(frame)).includes(value)) break;
  }
  const tagsBefore = await tags(frame);
  await frame.evaluate(() => {
    const el = document.querySelector('.LA40838 .prodfield-search');
    if (el) el.click();
  });
  await page.waitForTimeout(3500);
  const names = await frame.evaluate(() => [...document.querySelectorAll('.LA40838 .prodlist-pro-name')]
    .map((n) => (n.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
  return { tagsBefore, names };
}
try {
  await openEditor(page, config);
  const canvasLocator = await gotoTargetPage(page, config);
  await addBlockIfNeeded(page, canvasLocator, config).catch(() => {});
  await page.waitForTimeout(2500);
  const canvas = await findCanvasFrame();
  await setFields(canvas, [FA, FB], true);
  await savePage(page, config);
  let pv = await openPreview(page, context);
  await page.waitForTimeout(3000);
  out.onlyA = await single(pv.frame, FA, VA);
  await pv.previewPage.close().catch(() => {});
  pv = await openPreview(page, context);
  await page.waitForTimeout(3000);
  out.onlyB = await single(pv.frame, FB, VB);
  await pv.previewPage.close().catch(() => {});
  await setFields(canvas, [FA, FB], false);
  await savePage(page, config);
  out.restored = true;
} finally {
  fs.writeFileSync('hidden/oracle-single.json', JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 3000));
