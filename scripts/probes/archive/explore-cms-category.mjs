// Read-only: category list, add-category form, product category picker (no saves).
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor } from '../../src/editor.mjs';
import { openProdPage } from '../../src/cms.mjs';
import fs from 'node:fs';
const config = loadConfig();
const { browser, context, page } = await launchSession(config);
const out = {};
const click = async (p, a) => { const before = p.url(); const n = await p.locator(`[action="${a}"]`).count(); await p.locator(`[action="${a}"]`).first().evaluate(e => e.click()); out[`click_${a}`] = n; };
const snap = (p) => p.evaluate(() => {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const rows = [...document.querySelectorAll('tr')].filter(r => r.getClientRects().length).map(r => ({ text: norm(r.innerText).slice(0, 100), attrs: [...r.querySelectorAll('[data-id],[groupid],[href*="roup"],input,[action]')].slice(0, 6).map(n => ({ tag: n.tagName, action: n.getAttribute('action'), dataId: n.dataset?.id, name: n.name, value: n.value?.slice?.(0, 30), href: n.getAttribute('href')?.slice(0, 120), attrs: [...n.attributes].map(a => a.name).join(',') })) }));
  const inputs = [...document.querySelectorAll('input,select,textarea')].filter(n => n.getClientRects().length || n.type === 'hidden').map(n => ({ type: n.type, name: n.name, id: n.id, value: String(n.value).slice(0, 30), label: norm(n.closest('tr,li,div')?.innerText).slice(0, 50) }));
  const paging = [...document.querySelectorAll('[class*=page], [class*=Page]')].filter(n => n.getClientRects().length).map(n => norm(n.innerText).slice(0, 80)).slice(0, 5);
  const tree = [...document.querySelectorAll('li,[class*=tree] *')].filter(n => n.getClientRects().length && /AUTOTEST/.test(n.textContent) && n.children.length < 4).slice(0, 8).map(n => ({ tag: n.tagName, cls: String(n.className).slice(0, 60), attrs: [...n.attributes].map(a => `${a.name}=${String(a.value).slice(0, 30)}`).join(' '), text: norm(n.textContent).slice(0, 60) }));
  return { url: location.href, rows: rows.slice(0, 40), rowCount: rows.length, inputs: inputs.slice(0, 60), paging, tree };
});
try {
  await openEditor(page, config);
  const prod = await openProdPage(context);
  await click(prod, 'prod_group_list'); await prod.waitForTimeout(5000);
  out.list = await snap(prod);
  await click(prod, 'prod_group_add'); await prod.waitForTimeout(4000);
  out.add = await snap(prod);
  const u = new URL(prod.url()); u.search = ''; u.searchParams.set('invokeAction', 'prod_new_update'); u.searchParams.set('prodId', 'nLUBGJspgKzS');
  await prod.goto(u.href, { waitUntil: 'load' }); await prod.waitForTimeout(4000);
  const hidden = prod.locator('input[name="groupIds"]');
  out.groupBox = await hidden.evaluate(n => { const box = n.closest('tr,li,.form-item,div'); return { html: box.outerHTML.slice(0, 1500) }; });
  const beforeNodes = await prod.evaluate(() => document.querySelectorAll('*').length);
  await prod.evaluate(() => window.productGroupSelect()); await prod.waitForTimeout(4000);
  out.frames = prod.frames().map(f => f.url().slice(0, 150));
  out.picker = await prod.evaluate(() => { const d = [...document.querySelectorAll('[class*=dialog],[class*=Dialog],[class*=layer],[class*=modal],[class*=pop],[class*=Pop],[class*=tree],[class*=Tree]')].filter(n => n.getClientRects().length).map(n => ({ cls: String(n.className).slice(0, 80), text: n.innerText.replace(/\s+/g, ' ').slice(0, 300), inputs: [...n.querySelectorAll('input')].slice(0, 12).map(i => ({ type: i.type, name: i.name, value: i.value.slice(0, 20), label: (i.parentElement?.innerText || '').trim().slice(0, 30) })), html: n.outerHTML.slice(0, 1500) })); return d.slice(0, 3); });
} catch (e) { out.error = e.message; }
fs.writeFileSync('drafts/cms-category.json', JSON.stringify(out, null, 1));
await browser.close(); console.log('done', out.error || '');
