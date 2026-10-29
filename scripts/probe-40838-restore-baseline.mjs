// Probe v26: restore the block to baseline after the killed 19:06 run
// left the 3 fixture fields CHECKED (v24). Uncheck them, save the dialog,
// save the page, then re-open the dialog and read back (same session).
// A fresh-session confirmation follows via a re-run of v24.
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor, resolveTargetPage, ensureTargetPage, savePage } from '../src/editor.mjs';
import { widgetSession } from '../src/capabilities/shared.mjs';
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
  const before = await sess.read();
  out.before = before.filter((i) => i.type === 'checkbox' && i.checked).map((i) => i.label);
  for (const f of before.filter((i) => i.type === 'checkbox' && FIELDS.includes(i.label) && i.checked)) {
    await sess.set(f, false);
  }
  await sess.save();
  await savePage(page);
  await sess.open();
  const after = await sess.read();
  out.afterChecked = after.filter((i) => i.type === 'checkbox' && i.checked).map((i) => i.label);
  out.afterRadios = after.filter((i) => i.type === 'radio' && i.checked).map((i) => i.label);
  await sess.cancel();
  out.restored = out.afterChecked.length === 0;
  writeFileSync('hidden/probe-40838-restore-baseline-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
