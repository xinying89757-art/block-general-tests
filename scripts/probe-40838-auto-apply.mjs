// Probe v31: does the product list narrow on selection alone in the
// preview (no search click)? The search button is visibility:hidden in
// the editor preview, so clickSearch can never work there; the facet
// check proves selection narrows the facets. Poll productSnapshot
// (.prodlist-pro-name) for 10s after selecting 测试单选按钮A = 单选4-10
// and record the set each second. Expect {测试产品A, 测试产品小何1,
// AUTOTEST-产品4}. Restores the 3 fields afterwards.
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
const out = { at: new Date().toISOString(), blockId: config.blockId, timeline: [] };
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
  const snapshot = () => root.evaluate((node) => {
    const visible = (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const names = [...node.querySelectorAll('.prodlist-pro-name')].filter(visible).map((n) => norm(n.innerText));
    return { names, hasList: Boolean(node.querySelector('.one-pruduct-list, .pf-list-wrap, .one-pruduct-item')), count: names.length };
  });
  out.baseline = await snapshot();
  const exact = (text) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  const groupIndex = await root.evaluate((node, { group, groupTitle, wanted }) => {
    const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();
    return [...node.querySelectorAll(group)].findIndex((item) => norm(item.querySelector(groupTitle)?.innerText) === wanted);
  }, { group: GROUP, groupTitle: GROUP_TITLE, wanted: '测试单选按钮A' });
  out.groupIndex = groupIndex;
  const group = root.locator(GROUP).nth(groupIndex);
  const labels = group.locator('label').filter({ hasText: exact('单选4-10') });
  await labels.click({ timeout: 30000 });
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    const snap = await snapshot();
    out.timeline.push({ t: (i + 1) + 's', names: snap.names, count: snap.count, hasList: snap.hasList });
    if (snap.names.length === 3) break;
  }
  await previewPage.close().catch(() => {});

  await sess.open();
  const items2 = await sess.read();
  for (const f of items2.filter((i) => i.type === 'checkbox' && FIELDS.includes(i.label))) {
    if (f.checked) await sess.set(f, false);
  }
  await sess.save();
  await savePage(page);
  out.restored = true;
  writeFileSync('hidden/probe-40838-auto-apply-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
