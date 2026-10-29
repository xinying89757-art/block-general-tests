// Probe v12 (read-only): read all four fixture products' three field
// values fresh, via the runner's readProductFieldValues. Decides whether
// the 09-27 run's reads were right (小何2 already set? 产品4 created and
// partially set?) or whether the reads themselves are stale/wrong.
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor } from '../src/editor.mjs';
import { openProdPage, readProductFieldValues, findProduct } from '../src/cms.mjs';

const config = loadConfig();
const out = { at: new Date().toISOString(), site: config.siteDomain, products: {} };
const FIELDS = ['测试单选按钮A', '测试下拉列表', 'AUTOTEST-多选'];
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const cms = await openProdPage(session.context);
  for (const name of ['测试产品A', '测试产品小何1', '测试产品小何2', 'AUTOTEST-产品4']) {
    const prodId = await findProduct(cms, name);
    if (!prodId) { out.products[name] = { found: false }; continue; }
    out.products[name] = { found: true, prodId, values: await readProductFieldValues(cms, prodId, FIELDS) };
  }
  writeFileSync('hidden/probe-40838-fixture-read-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
