// Probe v27: the 11-24 run STILL skipped all 8 oracle checks even with
// the ^\s*...$ fix (commit efb2e0a). v23 never actually tested the \s*
// variant — only ^...$. Test the fixed regex directly in the preview:
//  1. title locator + hasText /^\s*测试单选按钮A\s*$/
//  2. title locator + hasText string (control)
//  3. full oracle form with the fixed regex
//  4. value label locator + hasText /^\s*单选4-10\s*$/
//  5. DOM evaluate exact title in group (ground truth)
// Restores the 3 fields to unchecked afterwards.
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor, resolveTargetPage, ensureTargetPage, savePage, openPreview } from '../src/editor.mjs';
import { widgetSession, blockSelector } from '../src/capabilities/shared.mjs';
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
  const titleRx = /^\s*测试单选按钮A\s*$/;
  const valueRx = /^\s*单选4-10\s*$/;
  out.variants['1 title+fixed regex'] = await root.locator(GROUP_TITLE).filter({ hasText: titleRx }).count();
  out.variants['2 title+string'] = await root.locator(GROUP_TITLE).filter({ hasText: '测试单选按钮A' }).count();
  out.variants['3 oracle form fixed regex'] = await root.locator(GROUP).filter({ has: root.locator(GROUP_TITLE).filter({ hasText: titleRx }) }).count();
  out.variants['4 value label+fixed regex'] = await root.locator('label').filter({ hasText: valueRx }).count();
  out.variants['5 DOM exact title in group'] = await root.evaluate((node, { group, groupTitle, wanted }) => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return [...node.querySelectorAll(group)].filter((g) => {
      const t = g.querySelector(groupTitle);
      return t && norm(t.innerText) === wanted;
    }).length;
  }, { group: GROUP, groupTitle: GROUP_TITLE, wanted: '测试单选按钮A' });
  out.variants['6 group titles'] = await root.locator(GROUP_TITLE).evaluateAll((nodes) => nodes.map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim()));
  await previewPage.close().catch(() => {});

  await sess.open();
  const items2 = await sess.read();
  for (const f of items2.filter((i) => i.type === 'checkbox' && FIELDS.includes(i.label))) {
    if (f.checked) await sess.set(f, false);
  }
  await sess.save();
  await savePage(page);
  out.restored = true;
  writeFileSync('hidden/probe-40838-oracle-regex2-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
