// Read-only DOM probe for fixture CMS locators (field id, categories, product categories).
import { loadConfig } from '../../../src/config.mjs';
import { launchSession } from '../../../src/browser.mjs';
import { openEditor } from '../../../src/editor.mjs';
import { openProdPage, listCustomFields, findProduct } from '../../../src/cms.mjs';
import fs from 'node:fs';
const config = loadConfig();
const { browser, context, page } = await launchSession(config);
const out = {};
const dumpInputs = (p) => p.evaluate(() => [...document.querySelectorAll('input,select')].map(n => ({ tag: n.tagName, type: n.type, name: n.name, id: n.id, value: n.type === 'password' ? '' : String(n.value).slice(0, 60), checked: n.checked, visible: !!n.getClientRects().length, label: (n.closest('label')?.innerText || n.parentElement?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) })));
try {
  await openEditor(page, config);
  const prod = await openProdPage(context, config);
  out.fields = await listCustomFields(prod);
  const row = prod.locator('table tr').filter({ has: prod.locator('td').filter({ hasText: /^AUTOTEST-单选按钮A$/ }) }).filter({ visible: true });
  await row.locator('[action="prod_field_edit"], [data-action="prod_field_edit"]').first().click();
  await prod.locator('input[name="field.fieldName"]').waitFor({ state: 'visible', timeout: 20000 });
  out.fieldUrl = prod.url();
  out.fieldInputs = (await dumpInputs(prod)).filter(x => x.type === 'hidden' || /field/i.test(x.name));
  out.menu = await prod.locator('[action], [data-action]').evaluateAll(ns => ns.map(n => ({ action: n.getAttribute('action') || n.getAttribute('data-action'), text: (n.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40), visible: !!n.getClientRects().length })));
  const pid = await findProduct(prod, 'AUTOTEST-产品A');
  out.productId = pid;
  const u = new URL(prod.url()); u.search = ''; u.searchParams.set('invokeAction', 'prod_new_update'); u.searchParams.set('prodId', pid);
  await prod.goto(u.href, { waitUntil: 'load' }); await prod.waitForTimeout(4000);
  out.productInputs = (await dumpInputs(prod)).filter(x => x.type === 'checkbox' || x.type === 'hidden' || /group|categ|分类/i.test(x.name + x.label));
  out.productCategoryText = await prod.evaluate(() => [...document.querySelectorAll('*')].filter(n => n.children.length < 3 && /产品分类/.test(n.textContent || '') && n.getClientRects().length).slice(0, 10).map(n => ({ tag: n.tagName, cls: n.className, text: n.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) })));
} catch (e) { out.error = e.message; }
fs.mkdirSync('drafts', { recursive: true });
fs.writeFileSync('drafts/cms-dom.json', JSON.stringify(out, null, 1));
await browser.close();
console.log('done', out.error || '');
