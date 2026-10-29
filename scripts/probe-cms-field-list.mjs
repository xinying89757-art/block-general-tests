// Diagnostic probe (read-only): listCustomFields now times out waiting for
// the "添加自定义字段" button AFTER clicking the "管理自定义字段" entry.
// Reproduce the exact click, then dump what the field-list page actually shows.
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor } from '../src/editor.mjs';
import { openProdPage, listCustomFields } from '../src/cms.mjs';

const config = loadConfig();
const out = { at: new Date().toISOString(), steps: {} };
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const cms = await openProdPage(session.context);
  try {
    try {
      await listCustomFields(cms);
      out.steps.listCustomFields = 'OK';
    } catch (error) {
      out.steps.listCustomFields = `FAILED: ${error.message.slice(0, 300)}`;
      out.steps.afterFailure = { url: cms.url(), title: await cms.title() };
      out.steps.afterFailure.bodyStart = (await cms.locator('body').innerText())
        .replace(/\s+/g, ' ').trim().slice(0, 500);
      out.steps.afterFailure.editButtons = await cms.evaluate(() => {
        const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
        return [...document.querySelectorAll('[action="prod_field_edit"], [data-action="prod_field_edit"]')]
          .map((el) => ({ tag: el.tagName, text: norm(el.innerText).slice(0, 40),
            visible: Boolean(el.getClientRects().length) }));
      });
      out.steps.afterFailure.addText = await cms.evaluate(() => {
        const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
        return [...document.querySelectorAll('a, button')]
          .filter((el) => /添加自定义字段/.test(norm(el.innerText)))
          .map((el) => ({ tag: el.tagName, action: el.getAttribute('action'),
            text: norm(el.innerText), visible: Boolean(el.getClientRects().length) }));
      });
      // Wait longer and re-check: is it just slow?
      await cms.waitForTimeout(15_000);
      out.steps.afterWait15s = { url: cms.url(),
        addVisible: await cms.locator('[action="prod_field_edit"], [data-action="prod_field_edit"]')
          .filter({ hasText: '添加自定义字段' }).filter({ visible: true }).count() };
    }
  } finally { await cms.close(); }
  writeFileSync('hidden/probe-cms-field-list-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
