// Probe v23: pin down why hasText with an anchored regex never matches
// the filter-group title. In the same preview (fields enabled + saved):
// dump the title element's innerText/textContent as JSON (reveals hidden
// chars), then test hasText with: plain string, unanchored regex,
// start-anchored, end-anchored, fully-anchored. Restores fields after.
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor, resolveTargetPage, ensureTargetPage, savePage, openPreview } from '../src/editor.mjs';
import { widgetSession, blockSelector } from '../src/capabilities/shared.mjs';
import { readFileSync } from 'node:fs';

const FIELDS = ['测试单选按钮A', '测试下拉列表', 'AUTOTEST-多选'];
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
  out.titleText = await root.locator(GROUP_TITLE).evaluateAll((nodes) => nodes.map((el) => ({
    innerText: JSON.stringify(el.innerText),
    textContent: JSON.stringify(el.textContent),
    html: el.outerHTML.slice(0, 200),
  })));
  const titles = root.locator(GROUP_TITLE);
  out.hasText = {
    string: await titles.filter({ hasText: '测试单选按钮A' }).count(),
    regexUnanchored: await titles.filter({ hasText: /测试单选按钮A/ }).count(),
    regexStartAnchor: await titles.filter({ hasText: /^测试单选按钮A/ }).count(),
    regexEndAnchor: await titles.filter({ hasText: /测试单选按钮A$/ }).count(),
    regexBothAnchors: await titles.filter({ hasText: /^测试单选按钮A$/ }).count(),
    regexBothAnchorsCaseInsensitive: await titles.filter({ hasText: /^测试单选按钮A$/i }).count(),
  };
  await previewPage.close().catch(() => {});

  await sess.open();
  const items2 = await sess.read();
  for (const f of items2.filter((i) => i.type === 'checkbox' && FIELDS.includes(i.label))) {
    if (f.checked) await sess.set(f, false);
  }
  await sess.save();
  await savePage(page);
  out.restored = true;
  writeFileSync('hidden/probe-40838-hastext-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
