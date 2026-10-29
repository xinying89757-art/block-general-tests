// Diagnostic probe (read-only): listCustomFields is flaky — it passed once,
// then failed twice at the "添加自定义字段" wait. Retry up to 4 times on a
// fresh CMS tab each time; on failure dump the full page state to find out
// whether the click failed to navigate or the button renders late.
import fs from "node:fs";
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor } from '../../src/editor.mjs';
import { openProdPage, listCustomFields } from '../../src/cms.mjs';

const config = loadConfig();
const out = { at: new Date().toISOString(), attempts: [] };
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  for (let i = 1; i <= 4; i++) {
    const attempt = { n: i };
    const cms = await openProdPage(session.context);
    try {
      const t0 = Date.now();
      try {
        const fields = await listCustomFields(cms);
        attempt.result = `OK in ${Date.now() - t0}ms, ${fields.length} fields`;
        out.attempts.push(attempt);
        break;
      } catch (error) {
        attempt.result = `FAILED after ${Date.now() - t0}ms: ${error.message.split('\n')[0]}`;
        attempt.url = cms.url();
        attempt.bodyStart = (await cms.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 400);
        attempt.editButtons = await cms.evaluate(() => {
          const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
          return [...document.querySelectorAll('[action="prod_field_edit"], [data-action="prod_field_edit"]')]
            .map((el) => ({ tag: el.tagName, text: norm(el.innerText).slice(0, 30),
              visible: Boolean(el.getClientRects().length) }));
        });
        attempt.addTextAnywhere = await cms.evaluate(() => {
          const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
          return [...document.querySelectorAll('a, button')]
            .filter((el) => /添加自定义字段/.test(norm(el.innerText)))
            .map((el) => ({ tag: el.tagName, action: el.getAttribute('action'),
              text: norm(el.innerText), visible: Boolean(el.getClientRects().length) }));
        });
        attempt.fieldTablePresent = /字段名称/.test(attempt.bodyStart);
        out.attempts.push(attempt);
      }
    } finally { await cms.close(); }
    if (out.attempts.at(-1).result.startsWith('OK')) break;
  }
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-cms-field-list-flaky.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
