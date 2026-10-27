// Oracle v2 verification (fixture already set via the live browser and
// read-back verified in the CMS editors):
//   测试产品A   A=单选4-10, B=下拉列表4-10
//   测试产品小何1 A=单选4-10, B=下拉列表8-10
//   测试产品小何2 A=单选6-10, B=下拉列表4-10
// Expect: ∩(A=4-10, B=4-10) = {测试产品A};  ∪ = {测试产品A, 测试产品小何1, 测试产品小何2}.
// Restores block settings afterwards (fields disabled, logic 交集).
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
async function closeFilterDialog(save) {
  await page.evaluate((doSave) => {
    const dlg = document.querySelector('.backstage-dialog.backstage-dialog-widgetsettinsframe');
    const label = doSave ? '保存' : '取消';
    const btn = [...dlg.querySelectorAll('.backstage-dialog-bottom *')].find((n) => (n.innerText || '').trim() === label);
    if (btn) btn.click();
  }, save);
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
    const radios = [...dlg.querySelectorAll('input[type=radio]')];
    const target = radios.find((r) => {
      const t = (r.closest('label') || r.parentElement || {}).innerText || '';
      return union ? t.includes('并集') : t.includes('交集');
    });
    if (target && !target.checked) target.click();
  }, union);
  await closeFilterDialog(true);
}

async function selectBothAndSearch(frame) {
  const clickInGroup = async (title, value) => frame.evaluate(({ t, v }) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const g = [...document.querySelectorAll('.LA40838 .prodfield-single')]
      .find((x) => norm(x.querySelector('.prodfield-left-fieldname')?.innerText) === t);
    if (!g) return 'group-missing';
    const el = [...g.querySelectorAll('label')].find((n) => norm(n.innerText) === v);
    if (!el) return 'value-missing:' + [...g.querySelectorAll('label')].map((n) => norm(n.innerText)).join(',');
    el.scrollIntoView({ block: 'center' });
    el.click();
    return 'clicked';
  }, { t: title, v: value });
  const r1 = await clickInGroup(FA, VA);
  await page.waitForTimeout(900);
  const r2 = await clickInGroup(FB, VB);
  await page.waitForTimeout(900);
  await frame.evaluate(() => {
    const el = document.querySelector('.LA40838 .prodfield-search');
    if (el) el.click();
  });
  await page.waitForTimeout(3500);
  const names = await frame.evaluate(() => [...document.querySelectorAll('.LA40838 .prodlist-pro-name')]
    .map((n) => (n.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
  return { r1, r2, names };
}

const setEq = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
try {
  await openEditor(page, config);
  const canvasLocator = await gotoTargetPage(page, config);
  await addBlockIfNeeded(page, canvasLocator, config).catch(() => {});
  await page.waitForTimeout(2500);
  const canvas = await findCanvasFrame();

  await setFields(canvas, [FA, FB], true);
  await savePage(page, config);

  // Intersection (default logic is 交集; ensure it)
  await setLogic(canvas, false);
  await savePage(page, config);
  let pv = await openPreview(page, context);
  await page.waitForTimeout(3000);
  out.inter = await selectBothAndSearch(pv.frame);
  out.inter.pass = setEq(out.inter.names, EXPECT_INTER);
  await pv.previewPage.close().catch(() => {});

  // Union
  await setLogic(canvas, true);
  await savePage(page, config);
  pv = await openPreview(page, context);
  await page.waitForTimeout(3000);
  out.union = await selectBothAndSearch(pv.frame);
  out.union.pass = setEq(out.union.names, EXPECT_UNION);
  await pv.previewPage.close().catch(() => {});

  // Restore
  await setLogic(canvas, false);
  await setFields(canvas, [FA, FB], false);
  await savePage(page, config);
  out.restored = true;
} finally {
  fs.writeFileSync('hidden/oracle-verify.json', JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
