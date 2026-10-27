// Probe round 2 for the two stubborn locators:
// - filter dialog: ancestors/attrs of the 背景颜色 input, dialog count/visibility
// - button popover in canvas: structure of inputs (visible?) and tab panels
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, addBlockIfNeeded } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, context, page } = await launchSession(config);
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
    if (!wrap) return 'no-wrap';
    const btns = [...wrap.querySelectorAll('a.backstage-widgettool-btns')];
    if (!btns[idx]) return 'no-btn';
    btns[idx].click();
    return 'clicked';
  }, { type, idx });
}

try {
  await openEditor(page, config);
  const canvasLocator = await gotoTargetPage(page, config);
  await addBlockIfNeeded(page, canvasLocator, config).catch(() => {});
  await page.waitForTimeout(2500);
  const canvas = await findCanvasFrame();

  await clickWrapButton(canvas, 'phoenix_blocks_filterStyle', 0);
  await page.waitForSelector(`${DIALOG}:visible`, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  out.color = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.backstage-dialog.backstage-dialog-widgetsettinsframe')];
    const info = { dialogCount: dialogs.length, visibleCount: dialogs.filter((d) => d.getClientRects().length).length };
    const dlg = dialogs.find((d) => d.getClientRects().length);
    if (!dlg) return info;
    const inputs = [...dlg.querySelectorAll('input')];
    const target = inputs.find((i) => /rgb|#/.test(i.value || '') || ((i.closest('li,label,div') || {}).innerText || '').includes('背景颜色'));
    if (!target) { info.notFound = inputs.map((i) => ({ t: i.type, v: (i.value || '').slice(0, 20) })); return info; }
    const chain = [];
    let el = target;
    for (let k = 0; k < 6 && el; k++) { chain.push(el.tagName + '.' + (el.className || '').slice(0, 60)); el = el.parentElement; }
    info.target = {
      type: target.type, value: target.value, readOnly: target.readOnly, disabled: target.disabled,
      cls: target.className, outer: target.outerHTML.slice(0, 220), chain,
      parentHTML: target.parentElement ? target.parentElement.outerHTML.slice(0, 400) : null,
    };
    return info;
  });
  await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('.backstage-dialog.backstage-dialog-widgetsettinsframe')].find((d) => d.getClientRects().length);
    const btn = dlg && [...dlg.querySelectorAll('.backstage-dialog-bottom *')].find((n) => (n.innerText || '').trim() === '取消');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1200);

  await clickWrapButton(canvas, 'phoenix_blocks_button', 0);
  await page.waitForTimeout(2500);
  out.popover = await canvas.evaluate(() => {
    const all = [...document.querySelectorAll('body *')];
    const label = all.find((el) => el.children.length === 0 && (el.innerText || '').trim() === '链接网址' && el.getClientRects().length);
    if (!label) return 'label-not-found';
    let root = label;
    for (let k = 0; k < 8 && root.parentElement; k++) {
      root = root.parentElement;
      const t = root.innerText || '';
      if (t.includes('按钮文本') && t.includes('保存')) break;
    }
    const inputs = [...root.querySelectorAll('input')].map((i) => ({
      type: i.type, value: (i.value || '').slice(0, 40), visible: !!i.getClientRects().length,
      checked: i.checked, cls: (i.className || '').slice(0, 40),
      ctx: ((i.closest('div,li,tr,label') || {}).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50),
    }));
    return { rootCls: root.className.slice(0, 100), inputCount: inputs.length, inputs };
  });
} finally {
  fs.writeFileSync('hidden/btncolor-probe2.json', JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
