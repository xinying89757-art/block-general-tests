// Probe v17 (read-only inspection): open the CMS add-product form and dump
// its structure — every visible text input/textarea with labels, placeholder,
// aria-label, name, id, and parent text; plus URL/title and any required
// markers. Decides why createProduct's name-input match found 0: form not
// rendered yet, or the label text differs from 产品名称/产品名.
import fs from "node:fs";
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor } from '../../src/editor.mjs';
import { openProdPage } from '../../src/cms.mjs';

const config = loadConfig();
const out = { at: new Date().toISOString(), site: config.siteDomain };
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const cms = await openProdPage(session.context);
  // Click 添加产品 (same entry createProduct uses: action prod_new_add).
  const clicked = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const els = [...document.querySelectorAll('a, button')].filter((el) => el.getClientRects().length && norm(el.innerText) === '添加产品');
    if (els.length !== 1) return { found: els.length };
    els[0].click();
    return { found: 1, clicked: true };
  });
  out.addButton = clicked;
  await cms.waitForTimeout(5000);
  out.url = cms.url();
  out.title = await cms.title().catch(() => '');
  out.form = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const fields = [...document.querySelectorAll('input, textarea, select')].map((node) => {
      const labels = [...(node.labels || [])].map((l) => norm(l.innerText));
      let parentText = '';
      for (let p = node.parentElement; p && !['BODY', 'HTML', 'FORM'].includes(p.tagName); p = p.parentElement) {
        if (p.querySelectorAll('input, textarea, select').length > 1) break;
        const t = norm(p.innerText);
        if (t) { parentText = t; break; }
      }
      return {
        tag: node.tagName, type: node.type || '', name: node.name || '', id: node.id || '',
        visible: node.getClientRects().length > 0, value: (node.value || '').slice(0, 30),
        placeholder: node.placeholder || '', ariaLabel: node.getAttribute('aria-label') || '',
        labels, parentText: parentText.slice(0, 80),
      };
    });
    return { fieldCount: fields.length, fields: fields.filter((f) => f.visible).slice(0, 60) };
  });
  out.pageTextHead = (await cms.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim())).slice(0, 600);
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-create-form-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
