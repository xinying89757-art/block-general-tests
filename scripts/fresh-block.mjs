// Explicit fresh-block workflow. Capability-owned definitions feed one shared
// batch adapter; unsupported capabilities stay visible as not-adapted.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { savePage } from '../src/editor.mjs';
import { writeCheckpoint } from '../src/run-safety.mjs';
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
config.projectRoot = root;
if (!config.siteDomain) throw new Error('SITE_DOMAIN is required for host-scoped defaults.');
config.siteDomain = new URL(/^https?:\/\//i.test(config.siteDomain) ? config.siteDomain : `https://${config.siteDomain}`).host.toLowerCase();
const page = pageChoice.kind === 'custom'
  ? { kind: 'custom', name: pageChoice.name }
  : { kind: 'system', id: pageChoice.id, url: pageChoice.url };
const siteHost = config.siteDomain;
if (page.kind === 'system') {
  const siteDataPath = path.resolve(root, 'sites', siteHost, 'pages.json');
  const siteData = JSON.parse(await fs.readFile(siteDataPath, 'utf8'));
  const matches = Object.values(siteData.pages || {}).filter((item) => String(item.id) === String(page.id)
    && String(item.url).replace(/\/$/, '') === String(page.url).replace(/\/$/, ''));
  if (siteData.siteHost !== siteHost || matches.length !== 1) {
    throw new Error('Selected system page does not uniquely match the configured site page data; refusing to open the editor.');
  }
  if (!matches[0].editorHref) throw new Error('Selected system page record has no page-specific editorHref; refusing to report a generic editor URL.');
  page.editorHref = matches[0].editorHref;
}
const profilePath = path.resolve(root, 'profiles', `${config.blockId}.json`);
const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
if (String(profile.blockId) !== String(config.blockId)) throw new Error('Profile block identity does not match BLOCK_ID.');
const session = await launchSession(config);
try {
  const runId = `fresh-${config.blockId}-${Date.now()}`;
  const checkpointPath = path.join(root, '.run-state', `${runId}.json`);
  const settingsAdapter = await createFreshSettingsAdapter({
    capabilities: profile.capabilities || [],
    context: { config, session, page, profile, siteHost, blockId: config.blockId,
      save: () => savePage(session.page),
      persistProfile: async (nextProfile) => {
        const temporary = `${profilePath}.${process.pid}.tmp`;
        await fs.writeFile(temporary, `${JSON.stringify(nextProfile, null, 2)}\n`, { mode: 0o600 });
        await fs.rename(temporary, profilePath);
      } },
    loadCapability: async (id) => import(pathToFileURL(path.join(root, 'src', 'capabilities', `${id}.mjs`)).href),
  });
  const adapter = createFreshBlockBrowserAdapter({ config, session,
    targetPage: page, settingsAdapter });
  const report = await runFreshBlockFlow({ config: { ...config, projectRoot: root, siteHost, blockId: config.blockId, page },
    adapter, runId,
    onProgress: async (event) => {
      const entry = { at: new Date().toISOString(), ...event };
      console.log(`[fresh-progress] ${JSON.stringify(entry)}`);
      await writeCheckpoint(checkpointPath, { runId, blockId: config.blockId, pageKind: page.kind,
        stage: event.stage, progressAt: entry.at, counts: { target: event.targetCount ?? null, checks: event.checkCount ?? null } });
    } });
  const reportDir = path.resolve(root, config.reportDir || 'reports');
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `fresh-block-${config.blockId}-${Date.now()}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[fresh-block] report: ${reportPath}`);
  const notAdapted = report.capabilities.filter((item) => item.status === 'not-adapted').length;
  console.log(`[fresh-block] ${report.checks.filter((item) => item.status === 'pass').length} pass / ${report.failures.length} fail / ${notAdapted} not-adapted capabilities; published=${Boolean(report.publishedConfirmed ?? report.publishedAt)}`);
} finally {
  await session.browser.close();
}
