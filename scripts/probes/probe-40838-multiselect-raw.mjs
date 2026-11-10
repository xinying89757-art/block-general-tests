// Probe v25: ground truth for AUTOTEST-产品4's multi-select. v24 read
// it as ["多选8-10"] but the set/read path labels checkboxes via
// optionLabel, which could mislabel. Dump the RAW checkbox states for
// the AUTOTEST-多选 group (option_911698): value, checked, wrapping
// label text, and the span text — no label mapping, no interpretation.
import fs from "node:fs";
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor } from '../../src/editor.mjs';
import { openProdPage, readProductFieldValues } from '../../src/cms.mjs';

const config = loadConfig();
const out = { at: new Date().toISOString(), prodId: 'tLKqQzCgrcmI' };
const session = await launchSession(config);
try {
  await openEditor(session.page, config);
  const cms = await openProdPage(session.context, config);
  // readProductFieldValues navigates to the product edit page; the page
  // stays there, so the raw evaluate below reads the same live form.
  out.normalRead = await readProductFieldValues(cms, 'tLKqQzCgrcmI', ['测试单选按钮A', '测试下拉列表', 'AUTOTEST-多选']);
  out.raw = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('input[type="checkbox"][name="option_911698"]')].map((input) => ({
      value: input.value,
      checked: input.checked,
      id: input.id,
      labels: [...(input.labels || [])].map((l) => norm(l.innerText)),
      closestLabelText: norm(input.closest('label')?.innerText),
      spanText: norm(input.closest('label')?.querySelector('span')?.innerText),
    }));
  });
  // Also read all three fields the normal way for comparison (done above,
  // before the raw dump, on the same page).
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-multiselect-raw-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
