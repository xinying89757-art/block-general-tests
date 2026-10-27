// Pivotal probe for oracle v2: enable 测试单选按钮A in the block's filter
// settings, preview, select 单选1-10 (the value 测试产品A holds), Search,
// and collect the rendered product names. Restores the field to disabled.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, addBlockIfNeeded, savePage, openPreview } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = { steps: [] };
const DIALOG = '.backstage-dialog.backstage-dialog-widgetsettinsframe';

async function findCanvasFrame() {
  for (const f of page.frames()) {
    try {
      if (await f.evaluate(() => document.querySelectorAll('.backstage-blocksEditor-wrap').length) > 0) return f;
    } catch { /* ignore */ }
  }
  return null;
}

async function setFilterField(canvas, label, wantChecked) {
  await canvas.evaluate(() => {
    const wrap = document.querySelector('.backstage-blocksEditor-wrap[data-blockseditor-type="phoenix_blocks_filterStyle"]');
    const btn = wrap && wrap.querySelector('a.backstage-widgettool-btns');
    if (btn) btn.click();
  });
  await page.waitForSelector(`${DIALOG}:visible`, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const res = await page.evaluate(({ label, wantChecked }) => {
    const dlg = document.querySelector('.backstage-dialog.backstage-dialog-widgetsettinsframe');
    const boxes = [...dlg.querySelectorAll('input[type=checkbox]')];
    const box = boxes.find((b) => {
      const t = [...(b.labels || [])].map((l) => l.innerText).join(' ') || (b.closest('li,label,div') || {}).innerText || '';
      return t.replace(/\s+/g, ' ').trim().startsWith(label);
    });
    if (!box) return 'field-not-found';
    if (box.checked !== wantChecked) box.click();
    return 'now:' + box.checked;
  }, { label, wantChecked });
  await page.evaluate(() => {
    const dlg = document.querySelector('.backstage-dialog.backstage-dialog-widgetsettinsframe');
    const btn = [...dlg.querySelectorAll('.backstage-dialog-bottom *')].find((n) => (n.innerText || '').trim() === '保存');
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);
  return res;
}

async function productNames(frame) {
  return frame.evaluate(() => [...document.querySelectorAll('.LA40838 .one-pruduct-item .prodlist-pro-name, .LA40838 .prodlist-pro-name')]
    .map((n) => (n.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
}

try {
  ({ page } = await openEditor(page, config));
  const canvasLocator = await gotoTargetPage(page, config);
  await addBlockIfNeeded(page, canvasLocator, config).catch(() => {});
  await page.waitForTimeout(2500);
  const canvas = await findCanvasFrame();

  out.steps.push('enable field: ' + await setFilterField(canvas, '测试单选按钮A', true));
  await savePage(page, config);

  const pv = await openPreview(page, context);
  await page.waitForTimeout(3000);
  out.baselineNames = await productNames(pv.frame);
  out.groupInfo = await pv.frame.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('.LA40838 .prodfield-single')].map((g) => ({
      title: norm(g.querySelector('.prodfield-left-fieldname')?.innerText),
      values: [...new Set([...g.querySelectorAll('label')].map((l) => norm(l.innerText)).filter(Boolean))],
    }));
  });
  const target = (out.groupInfo.find((g) => g.title === '测试单选按钮A') || {}).values || [];
  out.fieldValues = target;
  const pick = target.find((v) => v.includes('单选1-10')) || target.find((v) => v !== 'All');
  out.pick = pick;
  if (pick) {
    await pv.frame.evaluate((v) => {
      const groups = [...document.querySelectorAll('.LA40838 .prodfield-single')];
      const g = groups.find((x) => (x.querySelector('.prodfield-left-fieldname')?.innerText || '').includes('测试单选按钮A'));
      const el = [...g.querySelectorAll('label')].find((n) => (n.innerText || '').replace(/\s+/g, ' ').trim() === v);
      if (el) { el.scrollIntoView({ block: 'center' }); el.click(); }
    }, pick);
    await page.waitForTimeout(800);
    await pv.frame.evaluate(() => {
      const el = document.querySelector('.LA40838 .prodfield-search');
      if (el) el.click();
    });
    await page.waitForTimeout(3500);
    out.afterFilterNames = await productNames(pv.frame);
  }
  await pv.previewPage.close().catch(() => {});

  out.steps.push('disable field: ' + await setFilterField(canvas, '测试单选按钮A', false));
  await savePage(page, config);
} finally {
  fs.writeFileSync('hidden/oracle-e2e.json', JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
