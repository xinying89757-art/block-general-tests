// Oracle v2 verification, round 2: selection is confirmed via the
// selected-tags zone before Search is clicked (round 1 showed only the
// first field's selection actually registered).
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, addBlockIfNeeded, savePage, openPreview } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, context, page } = await launchSession(config);
const out = {};
const DIALOG = '.backstage-dialog.backstage-dialog-widgetsettinsframe';
const FA = '测试单选按钮A', FB = '测试下拉列表', VA = '单选4-10', VB = '下拉列表4-10';
const EXPECT_INTER = ['测试产品A'];
const EXPECT_UNION = ['测试产品A', '测试产品小何1', '测试产品小何2'];

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
async function setLogic(canvas, union) {
  await openFilterDialog(canvas);
  await page.evaluate((union) => {
    const dlg = document.querySelector('.backstage-dialog.backstage-dialog-widgetsettinsframe');
    const target = [...dlg.querySelectorAll('input[type=radio]')].find((r) => {
      const t = (r.closest('label') || r.parentElement || {}).innerText || '';
      return union ? t.includes('并集') : t.includes('交集');
    });
    if (target && !target.checked) target.click();
  }, union);
  await closeFilterDialog(true);
}

async function selectedTags(frame) {
  return frame.evaluate(() => {
    const zone = document.querySelector('.LA40838 .prodfield-bottom');
    return zone ? (zone.innerText || '').replace(/\s+/g, ' ').trim() : '';
  });
}
async function clickValue(frame, title, value) {
  return frame.evaluate(({ t, v }) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const g = [...document.querySelectorAll('.LA40838 .prodfield-single')]
      .find((x) => norm(x.querySelector('.prodfield-left-fieldname')?.innerText) === t);
    if (!g) return 'group-missing';
    const el = [...g.querySelectorAll('label')].find((n) => norm(n.innerText) === v);
    if (!el) return 'value-missing';
    el.scrollIntoView({ block: 'center' });
    el.click();
    return 'clicked';
  }, { t: title, v: value });
}
async function selectConfirmed(frame, title, value) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await clickValue(frame, title, value);
    if (r !== 'clicked') return r;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(600);
      const tags = await selectedTags(frame);
      if (tags.includes(value)) return 'confirmed';
    }
  }
  return 'not-confirmed:' + (await selectedTags(frame));
}
async function scenario(frame) {
  const s1 = await selectConfirmed(frame, FA, VA);
  const s2 = await selectConfirmed(frame, FB, VB);
  const tagsBefore = await selectedTags(frame);
  await frame.evaluate(() => {
    const el = document.querySelector('.LA40838 .prodfield-search');
    if (el) el.click();
  });
  await page.waitForTimeout(3500);
  const names = await frame.evaluate(() => [...document.querySelectorAll('.LA40838 .prodlist-pro-name')]
    .map((n) => (n.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
  return { s1, s2, tagsBefore, names };
}
const setEq = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
try {
  await openEditor(page, config);
  const canvasLocator = await gotoTargetPage(page, config);
  await addBlockIfNeeded(page, canvasLocator, config).catch(() => {});
  await page.waitForTimeout(2500);
  const canvas = await findCanvasFrame();
  await setFields(canvas, [FA, FB], true);
  await setLogic(canvas, false);
  await savePage(page, config);
  let pv = await openPreview(page, context);
  await page.waitForTimeout(3000);
  out.inter = await scenario(pv.frame);
  out.inter.pass = setEq(out.inter.names, EXPECT_INTER);
  await pv.previewPage.close().catch(() => {});
  await setLogic(canvas, true);
  await savePage(page, config);
  pv = await openPreview(page, context);
  await page.waitForTimeout(3000);
  out.union = await scenario(pv.frame);
  out.union.pass = setEq(out.union.names, EXPECT_UNION);
  await pv.previewPage.close().catch(() => {});
  await setLogic(canvas, false);
  await setFields(canvas, [FA, FB], false);
  await savePage(page, config);
  out.restored = true;
} finally {
  fs.writeFileSync('hidden/oracle-verify2.json', JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
