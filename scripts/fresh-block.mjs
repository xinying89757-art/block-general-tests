// Explicit fresh-block workflow. Capability-owned definitions feed one shared
// batch adapter; unsupported capabilities stay visible as not-adapted.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { savePage } from '../src/editor.mjs';
import { createFreshBlockBrowserAdapter } from '../src/fresh-block-browser-adapter.mjs';
import { createFreshSettingsAdapter } from '../src/fresh-settings-adapter.mjs';
import { parseFreshPageConfig, runFreshBlockFlow } from '../src/fresh-block-flow.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function cliEnv(argv, env) {
  const mapped = { '--page-kind': 'FRESH_PAGE_KIND', '--page-name': 'FRESH_PAGE_NAME',
    '--page-id': 'FRESH_PAGE_ID', '--page-url': 'FRESH_PAGE_URL' };
  const result = { ...env };
  for (let index = 0; index < argv.length; index += 1) {
    const key = mapped[argv[index]];
    if (!key || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error(`Usage: node scripts/fresh-block.mjs --page-kind custom --page-name <name> | --page-kind system --page-id <id> --page-url <url>`);
    }
    result[key] = argv[++index];
  }
  return result;
}

const env = cliEnv(process.argv.slice(2), process.env);
const pageChoice = parseFreshPageConfig(env);
const config = loadConfig();
if (!config.siteDomain) throw new Error('SITE_DOMAIN is required for host-scoped defaults.');
config.siteDomain = new URL(/^https?:\/\//i.test(config.siteDomain) ? config.siteDomain : `https://${config.siteDomain}`).host.toLowerCase();
const page = pageChoice.kind === 'custom'
  ? { kind: 'custom', name: pageChoice.name }
  : { kind: 'system', id: pageChoice.id, url: pageChoice.url };
const siteHost = config.siteDomain;
const profilePath = path.resolve(root, 'profiles', `${config.blockId}.json`);
const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
if (String(profile.blockId) !== String(config.blockId)) throw new Error('Profile block identity does not match BLOCK_ID.');
const session = await launchSession(config);
try {
  const settingsAdapter = await createFreshSettingsAdapter({
    capabilities: profile.capabilities || [],
    context: { config, session, page, profile, siteHost, blockId: config.blockId,
      save: () => savePage(session.page) },
    loadCapability: async (id) => import(pathToFileURL(path.join(root, 'src', 'capabilities', `${id}.mjs`)).href),
  });
  const adapter = createFreshBlockBrowserAdapter({ config, session,
    targetPage: page, settingsAdapter });
  const report = await runFreshBlockFlow({ config: { ...config, projectRoot: root, siteHost, blockId: config.blockId, page },
    adapter, settings: settingsAdapter.settings, metadata: settingsAdapter.metadata || {},
    capabilities: settingsAdapter.capabilityResults });
  const reportDir = path.resolve(root, config.reportDir || 'reports');
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `fresh-block-${config.blockId}-${Date.now()}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[fresh-block] report: ${reportPath}`);
  const notAdapted = report.capabilities.filter((item) => item.status === 'not-adapted').length;
  console.log(`[fresh-block] ${report.checks.filter((item) => item.status === 'pass').length} pass / ${report.failures.length} fail / ${notAdapted} not-adapted capabilities; published=${Boolean(report.publishedAt)}`);
} finally {
  await session.browser.close();
}
