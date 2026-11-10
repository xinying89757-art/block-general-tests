#!/usr/bin/env node
// One-time baseline: build fixture-state.json from a fixture spec plus existing
// report ids. --dedupe reports leftover AUTOTEST fields; --apply is required
// to change anything. Identity comes from CLI, env, the spec or the report.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  parseArgv, firstDefined,
} from '../src/filter-evidence.mjs';
import {
  loadFixtureSpec, loadJsonFile, fixtureStateFromSpec, recordsFromExistingReport,
  writeFixtureState, validateFixtureState,
} from '../src/fixture-state.mjs';
import { createFixtureDataOps, leftoverAutotestFields } from '../src/fixture-data-ops.mjs';

dotenv.config({ path: process.env.RUN_ENV_FILE || '.run.env', quiet: true });

const args = parseArgv(process.argv.slice(2), { flags: ['dedupe', 'apply', 'resume'] });
if (!args.spec) throw new Error('Required: --spec <fixture-spec.json>');
const spec = loadFixtureSpec(args.spec);
const report = args['from-existing'] ? loadJsonFile(args['from-existing']) : {};
const records = recordsFromExistingReport(report);
const inventory = args.inventory ? loadJsonFile(args.inventory) : (Array.isArray(report.fieldInventory) ? report.fieldInventory : []);
const progressPath = args.progress || 'reports/fixture-baseline-progress.json';
const resume = (args.resume && fs.existsSync(progressPath)) ? JSON.parse(fs.readFileSync(progressPath, 'utf8')) : {};

const site = {
  domain: String(firstDefined(args['site-host'], report.siteHost, process.env.SITE_HOST, resume.site?.domain) || '').replace(/^https?:\/\//, ''),
  siteId: String(firstDefined(args['site-id'], report.siteId, process.env.SITE_ID, resume.site?.siteId) || ''),
  credentialConfig: {
    kind: 'env-file',
    path: process.env.RUN_ENV_FILE || args['env-file'] || '.run.env',
  },
};
const blockId = String(firstDefined(args.block, args['block-id'], report.blockId, process.env.BLOCK_ID, Object.keys(resume.blocks || {})[0]) || '');
const page = {
  kind: firstDefined(args['page-kind'], report.page?.kind, process.env.FRESH_PAGE_KIND, 'system'),
  id: firstDefined(args['page-id'], report.page?.id, report.page?.pageId, process.env.FRESH_PAGE_ID),
  url: firstDefined(args['page-url'], report.page?.url, report.page?.pageUrl, process.env.FRESH_PAGE_URL),
  name: firstDefined(args['page-name'], report.page?.name, process.env.FRESH_PAGE_NAME, ''),
};
const settingId = firstDefined(args['setting-id'], report.block?.settingId, report.settingId, process.env.FRESH_SETTING_ID);
if (!site.domain || !site.siteId || !blockId || !page.id || !page.url) {
  throw new Error('Baseline needs --site-host, --site-id, --block, --page-id and --page-url (or the same keys in the report / env).');
}
const blocks = { [blockId]: { blockId, settingId, page } };
const out = args.out || 'fixture-state.json';
const categoryLimit = args['category-limit'] != null ? Number(args['category-limit']) : null;
const inventoryNames = inventory.map((item) => item.name).filter(Boolean);

async function resolveSiteFieldLimit() {
  if (args['field-limit'] != null) {
    return { max: Number(args['field-limit']), used: inventory.length || null, source: 'cli' };
  }
  const adapter = globalThis.__fixtureBaselineAdapter;
  if (adapter && typeof adapter.readFieldLimit === 'function') {
    const limit = await adapter.readFieldLimit();
    return { max: limit.max ?? null, used: limit.used ?? inventory.length ?? null, source: limit.source || 'site', raw: limit };
  }
  return { max: null, used: inventory.length || null, source: 'unknown' };
}

const siteFieldLimit = await resolveSiteFieldLimit();
const fieldLimit = siteFieldLimit.max;
const state = fixtureStateFromSpec(spec, {
  records, site, blocks, lastCheckedAt: null, fieldLimit,
  existingFieldCount: siteFieldLimit.used, existingFieldNames: inventoryNames,
});
if (state.fieldLimitReport) state.fieldLimitReport.source = siteFieldLimit.source;
const leftovers = leftoverAutotestFields(inventory, state);
const plan = {
  startedAt: new Date().toISOString(),
  out,
  fromExisting: args['from-existing'] || null,
  spec: args.spec,
  dedupe: leftovers,
  apply: Boolean(args.apply),
  fieldLimit,
  categoryLimit,
  omittedDisplayFields: state.omittedDisplayFields,
  productFlags: state.products.map((product) => ({ name: product.name, flags: product.flags })),
  emptyExpected: Object.entries(state.expectedBySetting.filter || {})
    .filter(([, value]) => Array.isArray(value?.expected) && value.expected.length === 0 || (Array.isArray(value) && value.length === 0)),
};

if (args.dedupe && leftovers.length && !args.apply) {
  plan.dedupeAction = 'reported-only';
  plan.message = 'Leftover AUTOTEST fields were reported only. Re-run with --apply to change anything.';
} else if (args.dedupe && leftovers.length && args.apply) {
  plan.dedupeAction = 'apply-requested';
  plan.message = 'This offline baseline only records the apply request; a live adapter is required to delete leftover fields.';
}

fs.mkdirSync(path.dirname(path.resolve(progressPath)), { recursive: true });
fs.writeFileSync(progressPath, `${JSON.stringify({ ...plan, site, blocks, resume: true }, null, 2)}\n`);
writeFixtureState(out, state);
const errors = validateFixtureState(loadJsonFile(out));
if (errors.length) throw new Error(`Wrote an invalid fixture-state: ${JSON.stringify(errors)}`);

if (args.apply && typeof globalThis.__fixtureBaselineAdapter === 'object') {
  const ops = createFixtureDataOps(globalThis.__fixtureBaselineAdapter);
  plan.prepare = await ops.prepareFixtureData(state, { apply: true, dedupe: Boolean(args.dedupe), fieldLimit, categoryLimit, resume });
}

plan.ok = true;
plan.finishedAt = new Date().toISOString();
fs.writeFileSync(progressPath, `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  out,
  products: state.products.length,
  fields: state.fields.length,
  categories: state.categories.length,
  leftovers: leftovers.length,
  dedupeAction: plan.dedupeAction || 'none',
  omittedDisplayFields: state.omittedDisplayFields,
  fieldLimit: state.fieldLimitReport,
  lastCheckedAt: state.lastCheckedAt,
}, null, 2));
