// Final surgical probe:
// A) filter dialog: #customOnBgColor presence + jQuery spectrum availability,
//    set via API, read back, restore via API, cancel.
// B) button editor-box: which action closes it (保存 / blank click / Escape)?
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor, gotoTargetPage, addBlockIfNeeded } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = {};
const DIALOG = '.backstage-dialog.backstage-dialog-widgetsettinsframe';

async function findCanvasFrame() {
  for (const f of page.frames()) {
    try {
      if (await f.evaluate(() => document.querySelectorAll('.backstage-blocksEditor-wrap').length) > 0) return f;
    } catch { /* ignore */ }
  }
  return null;
}

async function clickWrapButton(canvas, type, idx) {
  return canvas.evaluate(({ type, idx }) => {
    const wrap = document.querySelector(`.backstage-blocksEditor-wrap[data-blockseditor-type="${type}"]`);
    const btns = wrap ? [...wrap.querySelectorAll('a.backstage-widgettool-btns')] : [];
    if (!btns[idx]) return 'no-btn';
    btns[idx].click();
    return 'clicked';
  }, { type, idx });
}

try {
  ({ page } = await openEditor(page, config));
  const canvasLocator = await gotoTargetPage(page, config);
  await addBlockIfNeeded(page, canvasLocator, config).catch(() => {});
  await page.waitForTimeout(2500);
  const canvas = await findCanvasFrame();

  // A) color via spectrum API
  await clickWrapButton(canvas, 'phoenix_blocks_filterStyle', 0);
  await page.waitForSelector(`${DIALOG}:visible`, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  out.colorTest = await page.evaluate(() => {
    const r = {};
    const input = document.querySelector('#customOnBgColor');
    r.found = !!input;
    if (!input) return r;
    r.before = input.value;
    r.hasJQuery = typeof window.jQuery !== 'undefined';
    r.hasSpectrum = r.hasJQuery && typeof window.jQuery.fn.spectrum === 'function';
    if (r.hasSpectrum) {
      try {
        window.jQuery(input).spectrum('set', 'rgb(1, 2, 3)');
        window.jQuery(input).trigger('change');
        r.afterSet = input.value;
        window.jQuery(input).spectrum('set', r.before);
        window.jQuery(input).trigger('change');
        r.afterRestore = input.value;
      } catch (e) { r.apiError = e.message; }
    }
    return r;
  });
  await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('.backstage-dialog.backstage-dialog-widgetsettinsframe')].find((d) => d.getClientRects().length);
    const btn = dlg && [...dlg.querySelectorAll('.backstage-dialog-bottom *')].find((n) => (n.innerText || '').trim() === '取消');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1200);

  // B) editor-box close methods
  await clickWrapButton(canvas, 'phoenix_blocks_button', 0);
  await page.waitForTimeout(2500);
  const boxVisible = () => canvas.evaluate(() => {
    const box = [...document.querySelectorAll('.editor-box')].find((b) => (b.innerText || '').includes('链接网址') && b.getClientRects().length);
    return !!box;
  });
  out.boxOpen = await boxVisible();
  // try 保存 inside box
  await canvas.evaluate(() => {
    const box = [...document.querySelectorAll('.editor-box')].find((b) => (b.innerText || '').includes('链接网址'));
    const save = box && [...box.parentElement.querySelectorAll('*')].find((n) => (n.innerText || '').trim() === '保存' && n.getClientRects().length);
    if (save) save.click();
  });
  await page.waitForTimeout(1500);
  out.afterSaveClick = await boxVisible();
  if (out.afterSaveClick) {
    await canvas.evaluate(() => { document.body.click(); });
    await page.mouse.click(30, 300).catch(() => {});
    await page.waitForTimeout(1200);
    out.afterBlankClick = await boxVisible();
  }
  if (out.afterSaveClick && out.afterBlankClick !== false) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(1200);
    out.afterEscape = await boxVisible();
  }
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync('hidden/final2-probe.json', JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 3000));
