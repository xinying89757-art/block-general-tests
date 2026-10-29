// Probe v21: replicate the oracle check's exact steps — enable the 3
// fixture fields + set trigger manual + logic intersect, save, open the
// editor preview — then dump what the preview actually renders: group
// titles, the oracle selector's match count per fixture field, and one
// group's DOM. The 10-37 run skipped all 8 oracle checks with
// "预览中无法唯一确定筛选组" even though cff-fields-front found the
// groups in the preview. Restores the 3 fields to unchecked afterwards.
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
const out = { at: new Date().toISOString(), blockId: config.blockId };
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const target = await ensureTargetPage(page, config);
  const canvas = target.frame;
  const sess = widgetSession({ page, canvas, config, type: 'phoenix_blocks_filterStyle', title: '设置自定义字段筛选' });
  await sess.open();
  const items = await sess.read();
  const fields = items.filter((i) => i.type === 'checkbox' && FIELDS.includes(i.label));
  out.dialogFields = fields.map((i) => ({ label: i.label, checked: i.checked }));
  if (fields.length !== 3) throw new Error(`dialog fields found: ${fields.length}`);
  for (const f of fields) await sess.set(f, true);
  const logic = items.find((i) => i.type === 'radio' && i.label.startsWith('交集'));
  const trigger = items.find((i) => i.type === 'radio' && i.label.startsWith('点击'));
  out.radios = { logic: logic?.label, trigger: trigger?.label };
  if (logic) await sess.set(logic, true);
  if (trigger) await sess.set(trigger, true);
  await sess.save();
  await savePage(page);
  out.saved = true;

  const { frame, previewPage } = await openPreview(page, session.context);
  out.previewUrl = previewPage.url();
  const root = frame.locator(blockSelector(config.blockId)).first();
  await root.waitFor({ state: 'attached', timeout: 30000 });
  out.preview = await root.evaluate((node, { group, groupTitle }) => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const groups = [...node.querySelectorAll(group)];
    const titles = [...node.querySelectorAll(groupTitle)].map((el) => norm(el.innerText));
    const first = groups[0];
    const firstTitleInside = first ? !!first.querySelector(groupTitle) : false;
    return {
      groupCount: groups.length, titles,
      firstTitleInside,
      firstHtml: first ? first.outerHTML.slice(0, 700) : null,
      productNames: [...node.querySelectorAll('.prodfield-item, .pf-item')].slice(0, 6).map((el) => norm(el.innerText).slice(0, 40)),
    };
  }, { group: GROUP, groupTitle: GROUP_TITLE });
  // The oracle's exact selector, per fixture field.
  out.oracleMatches = {};
  for (const title of FIELDS) {
    const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const g = root.locator(GROUP).filter({ has: root.locator(GROUP_TITLE).filter({ hasText: new RegExp(`^${esc}$`) }) });
    out.oracleMatches[title] = await g.count();
  }
  await previewPage.close().catch(() => {});

  // Restore: uncheck the 3 fixture fields, save.
  await sess.open();
  const items2 = await sess.read();
  for (const f of items2.filter((i) => i.type === 'checkbox' && FIELDS.includes(i.label))) {
    if (f.checked) await sess.set(f, false);
  }
  await sess.save();
  await savePage(page);
  out.restored = true;
  writeFileSync('hidden/probe-40838-oracle-preview-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
