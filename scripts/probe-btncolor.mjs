// Probe two leftovers:
// 1) the filter dialog's color input(s): dump inputs with type=color or
//    rgb-ish values inside the visible settings dialog.
// 2) the button region's link popover: click each toolbar button of the
//    phoenix_blocks_button wrap, scan main page AND canvas frame for a
//    visible layer containing 链接网址.
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
    if (!btns[idx]) return 'no-btn-' + idx;
    btns[idx].click();
    return 'clicked-' + idx;
  }, { type, idx });
}

function scanForLinkLayer(doc) {
  return doc.evaluate(() => {
    const hits = [];
    const all = [...document.querySelectorAll('body *')];
    for (const el of all) {
      if (el.children.length > 30) continue;
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (t.includes('链接网址') && el.getClientRects().length) {
        hits.push({ cls: el.className.slice(0, 90), text: t.slice(0, 200) });
        if (hits.length >= 4) break;
      }
    }
    return hits;
  });
}

try {
  await openEditor(page, config);
  const canvasLocator = await gotoTargetPage(page, config);
  await addBlockIfNeeded(page, canvasLocator, config).catch(() => {});
  await page.waitForTimeout(2500);
  const canvas = await findCanvasFrame();

  // 1) color inputs in filter dialog
  out.openFilter = await clickWrapButton(canvas, 'phoenix_blocks_filterStyle', 0);
  await page.waitForSelector(`${DIALOG}:visible`, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  out.colorInputs = await page.evaluate(() => {
    const dlg = document.querySelector('.backstage-dialog.backstage-dialog-widgetsettinsframe');
    if (!dlg) return 'no-dialog';
    return [...dlg.querySelectorAll('input')].map((i) => ({
      type: i.type, value: (i.value || '').slice(0, 30),
      ctx: ((i.closest('li,label,div') || {}).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    })).filter((x) => x.type === 'color' || /rgb|#/.test(x.value) || /颜色|color/i.test(x.ctx));
  });
  await page.evaluate(() => {
    const dlg = document.querySelector('.backstage-dialog.backstage-dialog-widgetsettinsframe');
    const btn = dlg && [...dlg.querySelectorAll('.backstage-dialog-bottom *')].find((n) => (n.innerText || '').trim() === '取消');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);

  // 2) button popover: try toolbar buttons 0 and 1
  for (const idx of [0, 1]) {
    out['btnClick' + idx] = await clickWrapButton(canvas, 'phoenix_blocks_button', idx);
    await page.waitForTimeout(2500);
    out['mainScan' + idx] = await scanForLinkLayer(page).catch((e) => 'err:' + e.message);
    out['canvasScan' + idx] = await scanForLinkLayer(canvas).catch((e) => 'err:' + e.message);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(800);
  }
} finally {
  fs.writeFileSync('hidden/btncolor-probe.json', JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5500));
