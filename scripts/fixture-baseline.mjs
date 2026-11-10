#!/usr/bin/env node
// Fixture baseline. Default --live-readonly logs in, reads the field cap,
// scans leftover AUTOTEST fields, and verifies existing ids; it writes
// nothing to the site. --create-missing creates only missing AUTOTEST data
// and never deletes. --dedupe-apply deletes leftover AUTOTEST fields and
// needs its own approval. --offline is file-only (for tests).
import dotenv from 'dotenv';
import { parseArgv, firstDefined } from '../src/filter-evidence.mjs';
import { loadFixtureSpec, loadJsonFile, recordsFromExistingReport } from '../src/fixture-state.mjs';
import { resolveBaselineMode, runFixtureBaseline, writeBaselineProgress } from '../src/fixture-baseline-run.mjs';

dotenv.config({ path: process.env.RUN_ENV_FILE || '.run.env', quiet: true });

const args = parseArgv(process.argv.slice(2), { flags: ['live-readonly', 'create-missing', 'dedupe-apply', 'offline', 'dedupe', 'apply', 'resume'] });
if (!args.spec) throw new Error('Required: --spec <fixture-spec.json>');
const mode = resolveBaselineMode(args);
if (mode === 'offline') process.env.FIXTURE_OFFLINE = '1';
const spec = loadFixtureSpec(args.spec);
const report = args['from-existing'] ? loadJsonFile(args['from-existing']) : {};
const records = recordsFromExistingReport(report);
const inventory = args.inventory ? loadJsonFile(args.inventory) : (Array.isArray(report.fieldInventory) ? report.fieldInventory : []);
const progressPath = args.progress || 'reports/fixture-baseline-progress.json';

args['site-host'] = firstDefined(args['site-host'], report.siteHost, process.env.SITE_HOST);
args['site-id'] = firstDefined(args['site-id'], report.siteId, process.env.SITE_ID);
args.block = firstDefined(args.block, args['block-id'], report.blockId, process.env.BLOCK_ID);
args['setting-id'] = firstDefined(args['setting-id'], report.block?.settingId, report.settingId, process.env.FRESH_SETTING_ID);
args['page-id'] = firstDefined(args['page-id'], report.page?.id, report.page?.pageId, process.env.FRESH_PAGE_ID);
args['page-url'] = firstDefined(args['page-url'], report.page?.url, report.page?.pageUrl, process.env.FRESH_PAGE_URL);
args['page-kind'] = firstDefined(args['page-kind'], report.page?.kind, process.env.FRESH_PAGE_KIND, 'system');
args['page-name'] = firstDefined(args['page-name'], report.page?.name, process.env.FRESH_PAGE_NAME, '');
args.credentialConfig = { kind: 'env-file', path: process.env.RUN_ENV_FILE || args['env-file'] || '.run.env' };
if (!args['site-host'] || !args['site-id'] || !args.block || !args['page-id'] || !args['page-url']) {
  throw new Error('Baseline needs --site-host, --site-id, --block, --page-id and --page-url (or the same keys in the report / env).');
}

const injected = globalThis.__fixtureBaselineAdapter || null;
let browser;
let adapter = injected;
try {
  if (!adapter && mode !== 'offline') {
    process.env.BLOCK_ID = args.block;
    process.env.SITE_HOST = args['site-host'];
    const { loadConfig } = await import('../src/config.mjs');
    const { launchSession } = await import('../src/browser.mjs');
    const cms = await import('../src/cms.mjs');
    const { createCmsFixtureAdapter } = await import('../src/fixture-data-ops.mjs');
    const config = loadConfig();
    if (new URL(config.siteDomain || `http://${args['site-host']}`).host !== String(args['site-host']).replace(/^https?:\/\//, '')) {
      throw new Error('Configured site host does not match the requested site host.');
    }
    const session = await launchSession(config);
    browser = session.browser;
    const cmsPage = await cms.openProdPage(session.context);
    adapter = createCmsFixtureAdapter(cmsPage, cms);
  }
  const result = await runFixtureBaseline({ args, spec, report, records, inventory, adapter });
  writeBaselineProgress(progressPath, { ...result, state: undefined, mode });
  console.log(JSON.stringify({
    ok: result.ok,
    mode: result.mode,
    out: result.out,
    leftovers: result.leftovers?.length || 0,
    leftoverNames: (result.leftovers || []).map((item) => item.name),
    writes: (result.writes || []).map((item) => `${item.action || 'write'}:${item.kind}:${item.name}`),
    deleted: (result.deleted || []).map((item) => item.name),
    fieldLimit: result.fieldLimit,
    verification: result.verification && { ok: result.verification.ok, pending: result.verification.pending?.length || 0, diff: result.verification.diff?.length || 0 },
    siteWrites: result.siteWrites,
  }, null, 2));
} finally {
  try { await browser?.close(); } catch {}
}
