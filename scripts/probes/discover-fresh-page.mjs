// Read-only Phase A helper. Lists one explicitly named system/custom page and
// stores its editor identity in a host-scoped data file; does not save/publish.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor, listFreshEditorPages } from '../../src/editor.mjs';
import { normalizeSiteHost } from '../../src/site-baseline.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const targetName = String(process.env.FRESH_PAGE_NAME || '').trim();
const pageKind = String(process.env.FRESH_PAGE_KIND || 'system').trim().toLowerCase();
if (!targetName) throw new Error('FRESH_PAGE_NAME must identify the page for this read-only discovery.');
if (!['system', 'custom'].includes(pageKind)) throw new Error('FRESH_PAGE_KIND must be system or custom.');
const config = loadConfig();
if (!config.siteDomain) throw new Error('SITE_DOMAIN is required.');
const siteHost = normalizeSiteHost(config.siteDomain);
const session = await launchSession(config);
try {
  session.page = (await openEditor(session.page, config)).page;
  const editorUrl = session.page.url();
  const items = await listFreshEditorPages(session.page, pageKind);
  const matches = items.filter((item) => item.name === targetName || item.title === targetName
    || (item.pageurl || '').replace(/\/$/, '').split('/').at(-1) === targetName);
  if (matches.length !== 1) throw new Error(`Page discovery matched ${matches.length} menu entries for ${targetName}; no page data was written.`);
  const item = matches[0];
  if (!item.pageurl) throw new Error(`Page ${targetName} has no pageurl in the editor menu; front URL cannot be established safely.`);
  const frontUrl = /^https?:\/\//i.test(item.pageurl) ? item.pageurl : new URL(item.pageurl, `https://${siteHost}`).href;
  const pageDataPath = path.join(root, 'sites', siteHost, 'pages.json');
  const data = await fs.readFile(pageDataPath, 'utf8').then(JSON.parse).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return { version: 1, siteHost, pages: {} };
  });
  data.pages[targetName] = { kind: pageKind, id: item.id || null, url: item.pageurl,
    editorHref: item.href, frontUrl, discoveredAt: new Date().toISOString() };
  await fs.mkdir(path.dirname(pageDataPath), { recursive: true });
  await fs.writeFile(pageDataPath, `${JSON.stringify(data, null, 2)}\n`);
  console.log(JSON.stringify({ siteHost, page: targetName, kind: pageKind, id: item.id || null,
    pageUrl: item.pageurl, frontUrl, editorUrl, editorHref: item.href, dataFile: path.relative(root, pageDataPath) }, null, 2));
} finally {
  await session.browser.close();
}
