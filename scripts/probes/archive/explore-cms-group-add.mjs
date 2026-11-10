// Read-only: open the add-category form via invokeAction and dump its controls (no save).
import { loadConfig } from '../../../src/config.mjs';
import { launchSession } from '../../../src/browser.mjs';
import { openEditor } from '../../../src/editor.mjs';
import { openProdPage } from '../../../src/cms.mjs';
import fs from 'node:fs';
const config = loadConfig();
const { browser, context, page } = await launchSession(config);
const out = {};
try {
  await openEditor(page, config);
  const prod = await openProdPage(context, config);
  for (const action of ['prod_group_add', 'prod_group_list']) {
    const u = new URL(prod.url()); u.search = ''; u.searchParams.set('invokeAction', action);
    await prod.goto(u.href, { waitUntil: 'load' }); await prod.waitForTimeout(5000);
    out[action] = await prod.evaluate(() => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim();
      return { url: location.href, title: norm(document.querySelector('.main, #content, body')?.innerText).slice(0, 300),
        inputs: [...document.querySelectorAll('input,select,textarea')].filter(n => n.getClientRects().length || /group/i.test(n.name)).map(n => ({ type: n.type, name: n.name, id: n.id, value: String(n.value).slice(0, 30), label: norm(n.closest('tr')?.querySelector('th')?.innerText || '').slice(0, 30) })).filter(x => !/^(searchProdName|searchShowFlag|updatetime|publisher|lf_checkboxvalue|searchSkuState|searchProdUrl)$/.test(x.name || x.id)).slice(0, 40),
        actions: [...document.querySelectorAll('[action],[onclick]')].filter(n => n.getClientRects().length).map(n => `${n.getAttribute('action') || ''}|${(n.getAttribute('onclick') || '').slice(0, 60)}|${norm(n.innerText).slice(0, 20)}`).filter(s => !/^prod_(list|new|field|label|sku|water|recycle)/.test(s)).slice(0, 40),
        rows: [...document.querySelectorAll('tr')].filter(r => r.getClientRects().length && /AUTOTEST/.test(r.innerText)).slice(0, 5).map(r => r.outerHTML.slice(0, 600)) };
    });
  }
} catch (e) { out.error = e.message; }
fs.writeFileSync('drafts/cms-group-add.json', JSON.stringify(out, null, 1));
await browser.close(); console.log('done', out.error || '');
