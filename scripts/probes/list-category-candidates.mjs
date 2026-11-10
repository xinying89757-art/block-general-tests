// Read-only: dump every product-category row (no clicks that change data).
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor } from '../../src/editor.mjs';
import { openProdPage } from '../../src/cms.mjs';
import fs from 'node:fs';
const config = loadConfig();
const { browser, context, page } = await launchSession(config);
const out = {};
try {
  await openEditor(page, config);
  const prod = await openProdPage(context, config);
  const u = new URL(prod.url()); u.search = ''; u.searchParams.set('invokeAction', 'prod_group_list');
  await prod.goto(u.href, { waitUntil: 'load' }); await prod.waitForTimeout(6000);
  out.rows = await prod.evaluate(() => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('tr')].filter(r => r.querySelector('input[name="dataId"]')).map(r => ({
      id: r.querySelector('input[name="dataId"]').value,
      name: norm(r.querySelector('[action="viewProductListByGoup"]')?.textContent),
      cells: [...r.children].map(c => norm(c.innerText)).slice(0, 8),
      cls: r.className, pad: getComputedStyle(r.querySelector('[action="viewProductListByGoup"]') || r).paddingLeft,
      html: r.outerHTML.slice(0, 400) }));
  });
  out.header = await prod.evaluate(() => [...document.querySelectorAll('th')].map(t => t.innerText.trim()).slice(0, 12));
  out.pager = await prod.evaluate(() => (document.querySelector('.page, .pagination, .pager')?.innerText || '').trim().slice(0, 200));
} catch (e) { out.error = e.message; }
fs.writeFileSync('drafts/cms-category-candidates.json', JSON.stringify(out, null, 1));
await browser.close(); console.log('done', out.error || '', out.rows?.length);
