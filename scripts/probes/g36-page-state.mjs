// Read-only page inventory for a fresh editor session. Never opens the module
// library and never invokes add/delete/save/publish controls.
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor, gotoFreshTargetPage } from '../../src/editor.mjs';

const config = loadConfig();
const pageId = process.env.G36_PAGE_ID;
const pageUrl = process.env.G36_PAGE_URL;
const requested = (process.env.G36_TARGET_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!pageId || !pageUrl || requested.length !== 2) {
  throw new Error('G36_PAGE_ID, G36_PAGE_URL, and exactly two G36_TARGET_IDS are required.');
}
const session = await launchSession(config);
const report = { inspectedAt: new Date().toISOString(), siteHost: new URL(config.siteDomain.match(/^https?:/i) ? config.siteDomain : `https://${config.siteDomain}`).host,
  pageId, pageUrl, targets: {}, nonTargetCountsByBlockId: {}, totalInstances: 0, readOnly: true };
try {
  const { page } = await openEditor(session.page, config);
  session.page = page;
  const selected = await gotoFreshTargetPage(page, { kind: 'system', id: pageId, url: pageUrl, blockId: config.blockId });
  const instances = await selected.frame.locator('body').evaluate((body) => {
    const nodes = [...body.querySelectorAll('.siteblocks-setting-wrap[data-appid]')];
    return nodes.map((node) => {
      const attrs = [...node.attributes, ...[...node.querySelectorAll('*')].flatMap((child) => [...child.attributes])];
      return { blockId: String(node.getAttribute('data-appid') || ''),
        settingId: attrs.find((attr) => /setting.?id/i.test(attr.name))?.value || '' };
    });
  });
  report.totalInstances = instances.length;
  for (const id of requested) {
    const matching = instances.filter((instance) => instance.blockId === id);
    report.targets[id] = { count: matching.length, settingIds: matching.map((instance) => instance.settingId) };
  }
  for (const instance of instances) {
    if (!requested.includes(instance.blockId)) report.nonTargetCountsByBlockId[instance.blockId] =
      (report.nonTargetCountsByBlockId[instance.blockId] || 0) + 1;
  }
  report.editorUrl = page.url().replace(/[?#].*$/, '');
} finally {
  // Closing this fresh session discards any unsaved editor UI state.
  await session.browser.close();
}
const outDir = path.resolve('reports');
await fs.mkdir(outDir, { recursive: true });
const reportPath = path.join(outDir, `g36-page-state-${Date.now()}.json`);
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, reportPath }, null, 2));
