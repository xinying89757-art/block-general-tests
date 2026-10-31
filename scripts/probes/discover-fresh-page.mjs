// Read-only Phase A helper. Lists one explicitly named system/custom page and
// stores its editor identity in a host-scoped data file; does not save/publish.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor, listFreshEditorPages, SITE_LIST_URL } from '../../src/editor.mjs';
import { normalizeSiteHost } from '../../src/site-baseline.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const targetName = String(process.env.FRESH_PAGE_NAME || '').trim();
const pageKind = String(process.env.FRESH_PAGE_KIND || 'system').trim().toLowerCase();
const siteSlug = String(process.env.SITE_SLUG || '').trim().toLowerCase();
if (!targetName) throw new Error('FRESH_PAGE_NAME must identify the page for this read-only discovery.');
if (!['system', 'custom'].includes(pageKind)) throw new Error('FRESH_PAGE_KIND must be system or custom.');
if (!siteSlug) throw new Error('SITE_SLUG is required to select one attached test site from the account site list.');
const config = loadConfig();
const session = await launchSession(config);
try {
  await session.page.goto(SITE_LIST_URL, { waitUntil: 'domcontentloaded' });
  const cards = session.page.locator('.mySiteBox');
  await cards.first().waitFor({ state: 'attached', timeout: 30_000 });
  const matchesByHost = [];
  const observedHosts = new Set();
  for (let index = 0; index < await cards.count(); index += 1) {
    const urls = await cards.nth(index).locator('a[href], [data-url], [data-href]').evaluateAll((nodes) =>
      nodes.flatMap((node) => ['href', 'data-url', 'data-href'].map((name) => node.getAttribute(name)).filter(Boolean)));
    const hosts = new Set();
    for (const value of urls) {
      try {
        const url = new URL(value, 'https://www.leadong.com');
        if (!/^https?:$/i.test(url.protocol) || ['www.leadong.com', 'website.leadong.com', 'jianzhan.leadong.com'].includes(url.hostname.toLowerCase())
          || /\/phoenix\//i.test(url.pathname)) continue;
        hosts.add(url.host.toLowerCase());
      } catch { /* Ignore non-URL link attributes. */ }
    }
    for (const host of hosts) {
      observedHosts.add(host);
      if (host.split('.')[0] === siteSlug) matchesByHost.push(host);
    }
  }
  const uniqueHosts = [...new Set(matchesByHost)];
  if (uniqueHosts.length !== 1) throw new Error(`SITE_SLUG matched ${uniqueHosts.length} unique site hosts; refusing to enter a site. Observed public host candidates: ${[...observedHosts].join(', ') || '(none)'}.`);
  config.siteDomain = uniqueHosts[0];
  const siteHost = normalizeSiteHost(config.siteDomain);
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
