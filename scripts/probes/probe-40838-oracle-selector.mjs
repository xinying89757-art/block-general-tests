// Probe v22: the preview renders all 5 filter groups (v21 proved it),
// yet the oracle's locator matches 0. Measure each locator variant in
// the same preview session to find which composition breaks:
//  1. title locator + hasText regex (ground truth for the title itself)
//  2. group locator + hasText substring
//  3. the oracle's exact form: group.filter({ has: root title locator })
//  4. group.filter({ has: frame title locator }) — inner locator from frame
//  5. group.filter({ has: group.locator(title) }) — inner locator from group
//  6. DOM evaluate: groups whose descendant title has exact text.
// Restores the 3 fields to unchecked afterwards.
import fs from "node:fs";
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor, resolveTargetPage, ensureTargetPage, savePage, openPreview } from '../../src/editor.mjs';
import { widgetSession, blockSelector } from '../../src/capabilities/shared.mjs';
import { readFileSync } from 'node:fs';

const FIELDS = ['测试单选按钮A', '测试下拉列表', 'AUTOTEST-多选'];
const GROUP = '.prodfield-single, .pf-field-group';
const GROUP_TITLE = '.prodfield-left-fieldname, .pf-field-title';

const config = loadConfig();
const profile = JSON.parse(readFileSync('./profiles/40838.json', 'utf8'));
config.resolvedTarget = resolveTargetPage(config, profile);
const out = { at: new Date().toISOString(), blockId: config.blockId, variants: {} };
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
  const title = '测试单选按钮A';
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`^${esc}$`);
  out.variants['1 title+hasText regex'] = await root.locator(GROUP_TITLE).filter({ hasText: rx }).count();
  out.variants['2 group+hasText substring'] = await root.locator(GROUP).filter({ hasText: title }).count();
  out.variants['3 oracle exact (root title locator)'] = await root.locator(GROUP).filter({ has: root.locator(GROUP_TITLE).filter({ hasText: rx }) }).count();
  out.variants['4 group.filter has frame title locator'] = await root.locator(GROUP).filter({ has: frame.locator(GROUP_TITLE).filter({ hasText: rx }) }).count();
  out.variants['5 group.filter hasText regex on group'] = await root.locator(GROUP).filter({ hasText: rx }).count();
  out.variants['6 DOM evaluate exact title in group'] = await root.evaluate((node, { group, groupTitle, wanted }) => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return [...node.querySelectorAll(group)].filter((g) => {
      const t = g.querySelector(groupTitle);
      return t && norm(t.innerText) === wanted;
    }).length;
  }, { group: GROUP, groupTitle: GROUP_TITLE, wanted: title });
  out.variants['7 title locator count (all)'] = await root.locator(GROUP_TITLE).count();
  out.variants['8 group locator count (all)'] = await root.locator(GROUP).count();
  await previewPage.close().catch(() => {});

  await sess.open();
  const items2 = await sess.read();
  for (const f of items2.filter((i) => i.type === 'checkbox' && FIELDS.includes(i.label))) {
    if (f.checked) await sess.set(f, false);
  }
  await sess.save();
  await savePage(page);
  out.restored = true;
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-oracle-selector-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
