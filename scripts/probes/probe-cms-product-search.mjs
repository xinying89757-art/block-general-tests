import fs from 'node:fs/promises';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor } from '../../src/editor.mjs';
import { openProdPage } from '../../src/cms.mjs';

const config = loadConfig();
const session = await launchSession(config);
const output = { at: new Date().toISOString(), page: null, inputs: [], controls: [], forms: [], tables: [] };
try {
  await openEditor(session.page, config);
  const page = await openProdPage(session.context);
  const url = new URL(page.url());
  url.searchParams.set('invokeAction', 'prod_list_sub');
  await page.goto(url.href, { waitUntil: 'load', timeout: 60_000 });
  await page.locator('table:visible').first().waitFor({ state: 'visible', timeout: 30_000 });
  output.page = await page.evaluate(() => ({ url: location.pathname + location.search, title: document.title,
    bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1500) }));
  output.inputs = await page.locator('input:visible, select:visible, textarea:visible').evaluateAll((nodes) => nodes.map((node) => {
    const parent = node.parentElement;
    return { tag: node.tagName, type: node.type || '', name: node.name || '', id: node.id || '',
      placeholder: node.getAttribute('placeholder'), aria: node.getAttribute('aria-label'), value: node.type === 'password' ? '' : String(node.value || '').slice(0, 80),
      cls: String(node.className || '').slice(0, 160), parentText: (parent?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      parentHtml: parent?.outerHTML?.slice(0, 600) || '' };
  }));
  output.controls = await page.locator('button:visible, a:visible, [role="button"]:visible').evaluateAll((nodes) => nodes.map((node) => ({
    tag: node.tagName, text: (node.innerText || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    action: node.getAttribute('action') || node.getAttribute('data-action'), href: node.getAttribute('href'),
    cls: String(node.className || '').slice(0, 120),
  })).filter((node) => node.text || node.action));
  output.forms = await page.locator('form:visible').evaluateAll((nodes) => nodes.map((node) => ({ action: node.action, method: node.method, text: (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300) })));
  output.tables = await page.locator('table:visible').evaluateAll((nodes) => nodes.slice(0, 4).map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500)));
} finally {
  await session.browser.close().catch(() => {});
}
await fs.mkdir('drafts', { recursive: true });
await fs.writeFile('drafts/cms-product-search.json', `${JSON.stringify(output, null, 2)}\n`);
console.log('CMS product search DOM captured to drafts/cms-product-search.json');
