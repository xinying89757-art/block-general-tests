// Explicit fresh-block workflow. Requires an injected, profile-specific
// settings adapter; never falls back to the baseline-based standard runner.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { createFreshBlockBrowserAdapter } from '../src/fresh-block-browser-adapter.mjs';
import { freshMarker, parseFreshPageConfig, runFreshBlockFlow } from '../src/fresh-block-flow.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function cliEnv(argv, env) {
  const mapped = { '--page-kind': 'FRESH_PAGE_KIND', '--page-name': 'FRESH_PAGE_NAME',
    '--page-id': 'FRESH_PAGE_ID', '--page-url': 'FRESH_PAGE_URL', '--settings-adapter': 'FRESH_SETTINGS_ADAPTER' };
  const result = { ...env };
  for (let index = 0; index < argv.length; index += 1) {
    const key = mapped[argv[index]];
    if (!key || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error(`Usage: node scripts/fresh-block.mjs --page-kind custom --page-name <name> --settings-adapter <module> | --page-kind system --page-id <id> --page-url <url> --settings-adapter <module>`);
    }
    result[key] = argv[++index];
  }
  return result;
}

const env = cliEnv(process.argv.slice(2), process.env);
const pageChoice = parseFreshPageConfig(env);
const adapterSpecifier = String(env.FRESH_SETTINGS_ADAPTER || '').trim();
if (!adapterSpecifier) throw new Error('FRESH_SETTINGS_ADAPTER is required; it must export createFreshSettingsAdapter().');
const config = loadConfig();
if (!config.siteDomain) throw new Error('SITE_DOMAIN is required for host-scoped defaults and marker identity.');
config.siteDomain = new URL(/^https?:\/\//i.test(config.siteDomain) ? config.siteDomain : `https://${config.siteDomain}`).host.toLowerCase();
const page = pageChoice.kind === 'custom'
  ? { kind: 'custom', name: pageChoice.name }
  : { kind: 'system', id: pageChoice.id, url: pageChoice.url };
const siteHost = config.siteDomain;
const marker = freshMarker(siteHost, config.blockId);
const moduleUrl = pathToFileURL(path.resolve(adapterSpecifier)).href;
const plugin = await import(moduleUrl);
if (typeof plugin.createFreshSettingsAdapter !== 'function') throw new Error('FRESH_SETTINGS_ADAPTER must export createFreshSettingsAdapter(context).');
const session = await launchSession(config);
try {
  const settingsAdapter = await plugin.createFreshSettingsAdapter({ config, session, page, siteHost, blockId: config.blockId });
  if (!Array.isArray(settingsAdapter?.settings) || !settingsAdapter.batchAdapter) {
    throw new Error('Fresh settings adapter must return { settings, metadata, batchAdapter, readDefaults, readCurrentValues }.');
  }
  const adapter = createFreshBlockBrowserAdapter({ config: { ...config, marker }, session,
    targetPage: page, settingsAdapter });
  const report = await runFreshBlockFlow({ config: { ...config, projectRoot: root, siteHost, blockId: config.blockId, marker, page },
    adapter, settings: settingsAdapter.settings, metadata: settingsAdapter.metadata || {} });
  const reportDir = path.resolve(root, config.reportDir || 'reports');
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `fresh-block-${config.blockId}-${Date.now()}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[fresh-block] report: ${reportPath}`);
  console.log(`[fresh-block] ${report.checks.filter((item) => item.status === 'pass').length} pass / ${report.failures.length} fail; published=${Boolean(report.publishedAt)}`);
} finally {
  await session.browser.close();
}
