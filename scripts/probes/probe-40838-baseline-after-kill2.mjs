// Probe v24 (read-only): after the 19:06 validation run was killed by a
// runtime restart mid-run, check what state it left behind before any
// re-run. (a) Read the 40838 settings dialog without changing anything:
// which fields are checked, logic/trigger radios, background color.
// (b) Read the 4 fixture products' 3 field values from CMS.
// Baseline: all fields unchecked, logic 交集, trigger 点击搜索,
// color rgb(139,0,0); products at truth-table values.
import fs from "node:fs";
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor, resolveTargetPage, ensureTargetPage } from '../../src/editor.mjs';
import { openProdPage, readProductFieldValues, findProduct } from '../../src/cms.mjs';
import { widgetSession } from '../../src/capabilities/shared.mjs';
import { readFileSync } from 'node:fs';

const FIELDS = ['测试单选按钮A', '测试下拉列表', 'AUTOTEST-多选'];
const PRODUCTS = [
  ['测试产品A', 'ENULQuzRFljy'],
  ['测试产品小何1', 'ApUgGkomaTfn'],
  ['测试产品小何2', 'NmKqGFoHbPJy'],
  ['AUTOTEST-产品4', 'tLKqQzCgrcmI'],
];

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
  out.dialog = {
    checkedFields: items.filter((i) => i.type === 'checkbox' && i.checked).map((i) => i.label),
    radios: items.filter((i) => i.type === 'radio' && i.checked).map((i) => i.label),
    color: items.filter((i) => i.label === '背景颜色').map((i) => i.value),
  };
  await sess.cancel();

  const cms = await openProdPage(session.context);
  out.products = {};
  for (const [name, id] of PRODUCTS) {
    const found = await findProduct(cms, name);
    out.products[name] = found === id
      ? { found: true, values: await readProductFieldValues(cms, id, FIELDS) }
      : { found: false, foundId: found };
  }
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-baseline-after-kill2-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
