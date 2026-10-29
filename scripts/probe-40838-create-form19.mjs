// Probe v19: click 添加产品, poll every 500ms for the add form to render
// (records when createProduct's exact name-input matcher first returns 1),
// then dumps all visible form fields — especially the name input and any
// 上架 (listing) control — with labels, placeholder, name, id, parent text.
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor } from '../src/editor.mjs';
import { openProdPage } from '../src/cms.mjs';

const config = loadConfig();
const out = { at: new Date().toISOString(), site: config.siteDomain, steps: {} };
const session = await launchSession(config);
const matchName = `(() => {
  const inputs = [...document.querySelectorAll('input[type="text"], textarea')].filter((n) => n.getClientRects().length);
  const normalize = (t) => (t || '').replace(/[\\s*：:]/g, '');
  let count = 0;
  for (const node of inputs) {
    const labels = [...(node.labels || [])].map((l) => l.innerText);
    labels.push(node.getAttribute('aria-label'), node.placeholder);
    for (let parent = node.parentElement; parent && !['BODY', 'HTML', 'FORM'].includes(parent.tagName); parent = parent.parentElement) {
      if (parent.querySelectorAll('input[type="text"], textarea').length > 1) break;
      const text = normalize(parent.innerText);
      if (text) { labels.push(text); break; }
    }
    if (labels.some((label) => /^(产品名称|产品名)$/.test(normalize(label)))) count++;
  }
  return count;
})()`;
try {
  const { page } = await openEditor(session.page, config);
  const cms = await openProdPage(session.context);
  await cms.evaluate(() => {
    const el = [...document.querySelectorAll('[action="prod_new_add"], [data-action="prod_new_add"]')]
      .find((e) => e.getClientRects().length > 0);
    if (!el) throw new Error('add link not found');
    el.click();
  });
  const t0 = Date.now();
  const timeline = [];
  for (let i = 0; i < 40; i++) {
    const count = await cms.evaluate(matchName).catch(() => -1);
    const hasBasic = await cms.evaluate(() => document.body.innerText.includes('基本信息')).catch(() => false);
    timeline.push({ at: ((Date.now() - t0) / 1000).toFixed(1) + 's', nameMatches: count, hasBasic });
    if (count === 1 && hasBasic) break;
    await cms.waitForTimeout(500);
  }
  out.steps.timeline = timeline;
  out.steps.form = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const fields = [...document.querySelectorAll('input, textarea, select')].map((node) => {
      const labels = [...(node.labels || [])].map((l) => norm(l.innerText));
      let parentText = '';
      for (let p = node.parentElement; p && !['BODY', 'HTML', 'FORM'].includes(p.tagName); p = p.parentElement) {
        if (p.querySelectorAll('input, textarea, select').length > 1) break;
        const t = norm(p.innerText);
        if (t) { parentText = t; break; }
      }
      return { tag: node.tagName, type: node.type || '', name: node.name || '', id: node.id || '',
        visible: node.getClientRects().length > 0, value: (node.value || '').slice(0, 30),
        placeholder: node.placeholder || '', labels, parentText: parentText.slice(0, 80),
        options: node.tagName === 'SELECT' ? [...node.options].map((o) => norm(o.text)).slice(0, 8) : undefined };
    });
    return { fieldCount: fields.length, visibleFields: fields.filter((f) => f.visible) };
  });
  writeFileSync('hidden/probe-40838-create-form19-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
