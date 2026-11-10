import fs from 'node:fs/promises';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor } from '../../src/editor.mjs';
import { findCategory, findProduct, openProdPage, readProductCategories } from '../../src/cms.mjs';
import { readSiteBaseline } from '../../src/site-baseline.mjs';

const config = loadConfig();
if (!config.blockId) throw new Error('BLOCK_ID is required.');
const profile = JSON.parse(await fs.readFile(`profiles/${config.blockId}.json`, 'utf8'));
const { baseline } = await readSiteBaseline(process.cwd(), config.siteDomain, config.blockId);
const fixture = baseline?.fixtureRefs;
if (!fixture?.category?.name || !Array.isArray(fixture.products)) throw new Error('Profile has no fixture category/products.');
const session = await launchSession(config);
const output = { at: new Date().toISOString(), category: null, products: [] };
try {
  await openEditor(session.page, config);
  const page = await openProdPage(session.context, config);
  try {
    const category = await findCategory(page, fixture.category.name);
    output.category = category ? { name: fixture.category.name, id: category.id } : { name: fixture.category.name, found: false };
    for (const product of fixture.products) {
      const id = await findProduct(page, product.name);
      const categories = id ? await readProductCategories(page, id) : [];
      output.products.push({ name: product.name, found: Boolean(id), assigned: Boolean(category && categories.includes(category.id)) });
    }
  } finally { await page.close(); }
} finally { await session.browser.close().catch(() => {}); }
await fs.mkdir('drafts', { recursive: true });
await fs.writeFile('drafts/fixture-category-verification.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
if (!output.category?.id || output.products.some((product) => !product.found || !product.assigned)) process.exitCode = 1;
