// Probe button popover round 2: after clicking the button region toolbar
// button, find the SMALLEST elements containing 链接网址 in the canvas frame
// and dump nearby input structure. Also try clicking the button element
// itself inside the region.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, addBlockIfNeeded } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = {};

async function findCanvasFrame() {
  for (const f of page.frames()) {
    try {
      if (await f.evaluate(() => document.querySelectorAll('.backstage-blocksEditor-wrap').length) > 0) return f;
    } catch { /* ignore */ }
  }
  return null;
}

function smallestHits(doc) {
  return doc.evaluate(() => {
    const hits = [...document.querySelectorAll('body *')]
      .filter((el) => el.getClientRects().length && (el.innerText || '').includes('链接网址'))
      .map((el) => ({ el, len: (el.innerText || '').length }))
      .sort((a, b) => a.len - b.len)
      .slice(0, 3)
      .map(({ el, len }) => ({ cls: (el.className || '').slice(0, 80), len, text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160) }));
    // find a root that contains both labels and inputs
    let rootInfo = null;
    const label = [...document.querySelectorAll('body *')].find((el) => (el.innerText || '').includes('链接网址') && el.querySelectorAll('input').length > 0 && (el.innerText || '').includes('按钮文本'));
    if (label) {
      let best = label;
      for (const el of document.querySelectorAll('body *')) {
        if (el.contains(label) && el.querySelectorAll('input').length > 0 && (el.innerText || '').includes('按钮文本') && (el.innerText || '').length < (best.innerText || '').length) best = el;
      }
      rootInfo = {
        cls: (best.className || '').slice(0, 80),
        inputs: [...best.querySelectorAll('input')].map((i) => ({
          type: i.type, value: (i.value || '').slice(0, 40), visible: !!i.getClientRects().length, checked: i.checked,
          ctx: ((i.closest('div,li,tr,label') || {}).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 46),
        })),
      };
    }
    return { hits, rootInfo };
  });
}

try {
  ({ page } = await openEditor(page, config));
  const canvasLocator = await gotoTargetPage(page, config);
  await addBlockIfNeeded(page, canvasLocator, config).catch(() => {});
  await page.waitForTimeout(2500);
  const canvas = await findCanvasFrame();

  out.clickToolbar = await canvas.evaluate(() => {
    const wrap = document.querySelector('.backstage-blocksEditor-wrap[data-blockseditor-type="phoenix_blocks_button"]');
    const btn = wrap && wrap.querySelector('a.backstage-widgettool-btns');
    if (!btn) return 'no-btn';
    btn.click();
    return 'clicked';
  });
  await page.waitForTimeout(3000);
  out.afterToolbar = await smallestHits(canvas);
  out.mainDoc = await smallestHits(page.mainFrame()).catch((e) => 'err:' + e.message);
} finally {
  fs.writeFileSync('hidden/btn-probe2.json', JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
