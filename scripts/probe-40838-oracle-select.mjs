// Probe v28: validate the fixed selectFilterValue mechanism end to end
// (group by DOM exact-title findIndex + nth, label by hasText fixed
// regex): enable the 3 fixture fields, set trigger manual + logic
// intersect, save, open preview, select 测试单选按钮A = 单选4-10, click
// search, read the product set (expect 测试产品A, 测试产品小何1,
// AUTOTEST-产品4). Restores the 3 fields to unchecked afterwards.
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
  const exact = (text) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  const groupIndex = await root.evaluate((node, { group, groupTitle, wanted }) => {
    const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();
    return [...node.querySelectorAll(group)].findIndex((item) => norm(item.querySelector(groupTitle)?.innerText) === wanted);
  }, { group: GROUP, groupTitle: GROUP_TITLE, wanted: '测试单选按钮A' });
  out.groupIndex = groupIndex;
  const group = root.locator(GROUP).nth(groupIndex);
  const labels = group.locator('label').filter({ hasText: exact('单选4-10') });
  out.labelCount = await labels.count();
  await labels.click({ timeout: 30000 });
  await page.waitForTimeout(1000);
  const selected = await root.evaluate((node, value) => {
    const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();
    return [...node.querySelectorAll('label')].some((label) => norm(label.innerText) === value && label.querySelector('input:checked'))
      || [...node.querySelectorAll('.prodfield-bottom, .pf-selected, .pf-tags')].some((tag) => norm(tag.innerText).includes(value));
  }, '单选4-10');
  out.selectedObserved = selected;
  const search = root.locator('.prodfield-search, .pf-search').filter({ visible: true });
  out.searchCount = await search.count();
  await search.click({ timeout: 30000 });
  await page.waitForTimeout(3000);
  out.products = await root.evaluate((node) => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return [...node.querySelectorAll('.prodfield-item-name, .pf-item-name, [class*="prod-name"]')].slice(0, 10).map((el) => norm(el.innerText));
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
  writeFileSync('hidden/probe-40838-oracle-select-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
