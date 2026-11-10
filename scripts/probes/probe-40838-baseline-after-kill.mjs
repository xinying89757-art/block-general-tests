// Probe (read-only + baseline restore if needed): the fixture validation
// re-run was killed by a runtime restart ~3 min in, before any report.
// Check what already happened: (1) was AUTOTEST-多选 created in CMS?
// (2) was AUTOTEST-产品4 created? (3) are 40838's filter-field checkboxes
// still at baseline (all unchecked)? If any checkbox is checked, restore
// all to unchecked + save (the killed run's fixture-prep enables the three
// fixture fields; its finally-restore never ran).
import fs from "node:fs";
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor, ensureTargetPage, savePage, resolveTargetPage } from '../../src/editor.mjs';
import { openProdPage, listCustomFields, findProduct } from '../../src/cms.mjs';
import { widgetSession, probeControls, isFieldCheckbox } from '../../src/capabilities/shared.mjs';

const config = loadConfig();
config.blockId = '40838';
const profile = JSON.parse(readFileSync('profiles/40838.json', 'utf8'));
config.resolvedTarget = resolveTargetPage(config, profile);
const out = { at: new Date().toISOString(), cms: {}, block: {} };
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const { frame: canvas } = await ensureTargetPage(page, config);
  // CMS state (read-only).
  const cmsPage = await openProdPage(session.context, config);
  try {
    const fields = await listCustomFields(cmsPage);
    out.cms.fields = fields.map((f) => `${f.name} (${f.type} ${f.status})`);
    out.cms.autotestField = fields.find((f) => f.name === 'AUTOTEST-多选') || null;
    out.cms.product4 = await findProduct(cmsPage, 'AUTOTEST-产品4');
    out.cms.productA = await findProduct(cmsPage, '测试产品A');
  } finally { await cmsPage.close(); }
  // Block filter-dialog checkbox states (read-only first).
  const dialog = widgetSession({ page, canvas, config, type: 'phoenix_blocks_filterStyle',
    title: '设置自定义字段筛选' });
  try {
    const probe = await probeControls(dialog);
    if (probe.reason) throw new Error(`打不开筛选设置弹窗：${probe.reason}`);
    const fields = probe.controls.filter(isFieldCheckbox);
    out.block.fields = fields.map((f) => ({ label: f.label, checked: f.checked }));
    const checked = fields.filter((f) => f.checked);
    if (checked.length) {
      out.block.restored = 'found checked fields, restoring to all-unchecked baseline';
      for (const field of checked) await dialog.set(field, false);
      await dialog.save();
      await savePage(page);
      await dialog.open();
      const back = await probeControls(dialog);
      out.block.afterRestore = back.controls.filter(isFieldCheckbox).map((f) => ({ label: f.label, checked: f.checked }));
      if (out.block.afterRestore.some((f) => f.checked)) throw new Error('恢复后仍有字段被勾选。');
    } else {
      out.block.restored = 'already at baseline (all unchecked), nothing to restore';
    }
  } finally { await dialog.cancel().catch(() => {}); }
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-baseline-after-kill.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
