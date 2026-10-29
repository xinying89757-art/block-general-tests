// Probe v29: v28's search-button click timed out —
// .prodfield-search/.pf-search found 0 visible matches in the preview.
// Dump the preview's filter area: every button/link/input in the block
// with text + class + visibility, plus any element in the whole frame
// whose class or text mentions "search". Restores the 3 fields after.
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor, resolveTargetPage, ensureTargetPage, savePage, openPreview } from '../src/editor.mjs';
import { widgetSession, blockSelector } from '../src/capabilities/shared.mjs';
import { readFileSync } from 'node:fs';

const FIELDS = ['测试单选按钮A', '测试下拉列表', 'AUTOTEST-多选'];

const config = loadConfig();
const profile = JSON.parse(readFileSync('./profiles/40838.json', 'utf8'));
config.resolvedTarget = resolveTargetPage(config, profile);
const out = { at: new Date().toISOString(), blockId: config.blockId };
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const target = await ensureTargetPage(page, config);
  const canvas = target.frame;
  const sess = widgetSession({ page, canvas, config, type: 'phoenix_blocks_filterStyle', title: '设置自定义字段筛选' });
  await sess.open();
  const items = await sess.read();
  for (const f of items.filter((i) => i.type === 'checkbox' && FIELDS.includes(i.label))) await sess.set(f, true);
  const logic = items.find((i) => i.type === 'radio' && i.label.startsWith('交集'));
  const trigger = items.find((i) => i.type === 'radio' && i.label.startsWith('点击'));
  if (logic) await sess.set(logic, true);
  if (trigger) await sess.set(trigger, true);
  await sess.save();
  await savePage(page);

  const { frame, previewPage } = await openPreview(page, session.context);
  const root = frame.locator(blockSelector(config.blockId)).first();
  await root.waitFor({ state: 'attached', timeout: 30000 });
  out.dump = await root.evaluate((node) => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const vis = (el) => { const r = el.getClientRects(); return r.length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'; };
    const clickables = [...node.querySelectorAll('button, a, input[type="button"], input[type="submit"]')].map((el) => ({
      tag: el.tagName, cls: (el.className || '').toString().slice(0, 80), text: norm(el.innerText || el.value || '').slice(0, 40), visible: vis(el),
    }));
    const searchish = [...node.querySelectorAll('[class*="search" i], [id*="search" i]')].map((el) => ({
      tag: el.tagName, cls: (el.className || '').toString().slice(0, 80), text: norm(el.innerText || el.value || '').slice(0, 40), visible: vis(el),
    }));
    return { clickables, searchish };
  });
  out.frameSearchish = await frame.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('button, a')].filter((el) => /search/i.test(el.className?.toString() || '') || /^search$/i.test(norm(el.innerText || ''))).slice(0, 10).map((el) => ({
      tag: el.tagName, cls: (el.className || '').toString().slice(0, 80), text: norm(el.innerText).slice(0, 40),
      inBlock: !!el.closest('[data-appid="40838"]'),
    }));
  });
  await previewPage.close().catch(() => {});

  await sess.open();
  const items2 = await sess.read();
  for (const f of items2.filter((i) => i.type === 'checkbox' && FIELDS.includes(i.label))) {
    if (f.checked) await sess.set(f, false);
  }
  await sess.save();
  await savePage(page);
  out.restored = true;
  writeFileSync('hidden/probe-40838-search-button-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
