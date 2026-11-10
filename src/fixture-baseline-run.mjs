import fs from 'node:fs';
import path from 'node:path';
import {
  loadFixtureSpec, loadJsonFile, fixtureStateFromSpec, recordsFromExistingReport,
  writeFixtureState, validateFixtureState,
} from './fixture-state.mjs';
import { leftoverAutotestFields, verifyExistingIds, createFixtureDataOps } from './fixture-data-ops.mjs';

export const BASELINE_MODES = Object.freeze(['live-readonly', 'create-missing', 'dedupe-apply', 'offline']);

export function resolveBaselineMode(args = {}) {
  const exclusive = ['create-missing', 'dedupe-apply', 'live-readonly', 'offline'].filter((key) => args[key]);
  if (exclusive.length > 1) throw new Error(`Choose a single baseline mode; received ${exclusive.join(' and ')}.`);
  if (args.apply || args['dedupe-apply'] && args['create-missing']) {
    // --apply is retired so it cannot gate read, create and delete together.
  }
  if (args.apply) {
    throw new Error('--apply is no longer a mode. Use default --live-readonly, --create-missing (never deletes), or --dedupe-apply (separate approval).');
  }
  if (args['dedupe-apply']) return 'dedupe-apply';
  if (args['create-missing']) return 'create-missing';
  if (args.offline) return 'offline';
  if (args['live-readonly'] || true) return 'live-readonly';
}

function fillIdsFromObserved(state, observed) {
  for (const field of state.fields || []) {
    if (field.id) continue;
    const hit = Object.values(observed.fields || {}).find((item) => item.name === field.name);
    if (hit?.id) field.id = hit.id;
  }
  for (const product of state.products || []) {
    if (product.id) continue;
    const hit = Object.values(observed.products || {}).find((item) => item.name === product.name);
    if (hit?.id) product.id = hit.id;
  }
  for (const category of state.categories || []) {
    if (category.id) continue;
    const hit = Object.values(observed.categories || {}).find((item) => item.name === category.name || item.name === category.reuseName);
    if (hit?.id) category.id = hit.id;
  }
  return state;
}

function applyRecordedIds(state, records) {
  for (const field of state.fields || []) field.id = field.id || records.fields?.[field.name] || null;
  for (const product of state.products || []) product.id = product.id || records.products?.[product.name] || null;
  for (const category of state.categories || []) {
    category.id = category.id || records.categories?.[category.name] || records.categories?.[category.reuseName] || null;
  }
}

export async function runFixtureBaseline({
  args, spec, report = {}, records, inventory = [], adapter = null, now = () => new Date().toISOString(),
} = {}) {
  const mode = resolveBaselineMode(args);
  if ((mode === 'live-readonly' || mode === 'create-missing' || mode === 'dedupe-apply') && !adapter) {
    throw new Error(`Mode ${mode} requires a live CMS adapter (login). Pass --offline only for file-only tests.`);
  }
  if (mode === 'create-missing' && typeof adapter.deleteDuplicates === 'function') {
    // Adapter may implement delete, but create-missing must never call it.
  }
  const site = {
    domain: String(args.siteHost || args['site-host'] || report.siteHost || '').replace(/^https?:\/\//, ''),
    siteId: String(args.siteId || args['site-id'] || report.siteId || ''),
    credentialConfig: args.credentialConfig || { kind: 'env-file', path: args.envFile || '.run.env' },
  };
  const blockId = String(args.block || args['block-id'] || report.blockId || '');
  const page = {
    kind: args['page-kind'] || report.page?.kind || 'system',
    id: args['page-id'] || report.page?.id || report.page?.pageId,
    url: args['page-url'] || report.page?.url || report.page?.pageUrl,
    name: args['page-name'] || report.page?.name || '',
  };
  const settingId = args['setting-id'] || report.block?.settingId || report.settingId;
  const blocks = { [blockId]: { blockId, settingId, page } };
  const out = args.out || 'fixture-state.json';

  let fieldLimitInfo = { max: args['field-limit'] != null ? Number(args['field-limit']) : null, used: inventory.length || null, source: args['field-limit'] != null ? 'cli' : 'unknown' };
  let listed = inventory;
  if (adapter?.readFieldLimit && mode !== 'offline') {
    const limit = await adapter.readFieldLimit();
    fieldLimitInfo = {
      max: args['field-limit'] != null ? Number(args['field-limit']) : (limit.max ?? null),
      used: limit.used ?? inventory.length ?? null,
      source: args['field-limit'] != null ? 'cli' : (limit.source || 'site'),
      raw: limit.source || null,
    };
    listed = limit.fields || (adapter.listFields ? await adapter.listFields() : inventory);
  } else if (adapter?.listFields && mode !== 'offline') {
    listed = await adapter.listFields();
    fieldLimitInfo.used = listed.length;
  }

  let state = fixtureStateFromSpec(spec, {
    records, site, blocks, lastCheckedAt: null,
    fieldLimit: fieldLimitInfo.max,
    existingFieldCount: fieldLimitInfo.used,
    existingFieldNames: listed.map((item) => item.name).filter(Boolean),
  });
  if (state.fieldLimitReport) state.fieldLimitReport.source = fieldLimitInfo.source;
  applyRecordedIds(state, records || { fields: {}, products: {}, categories: {} });

  const leftovers = leftoverAutotestFields(listed, state);
  const result = {
    ok: true,
    mode,
    out,
    writes: [],
    deleted: [],
    leftovers,
    fieldLimit: state.fieldLimitReport,
    startedAt: now(),
  };

  if (adapter?.snapshotById) {
    const observed = await adapter.snapshotById(state);
    fillIdsFromObserved(state, observed);
    // Leftover AUTOTEST fields are reported separately; they are not id drift.
    const verification = verifyExistingIds(state, { ...observed, unexpectedAutotestFields: [] });
    result.verification = verification;
    if (!verification.ok && mode !== 'create-missing') {
      result.ok = false;
      result.diff = verification.diff;
      throw Object.assign(new Error(`Existing fixture ids drifted (${verification.diff.length} change(s)). Auto-repair is disabled.`), { result, diff: verification.diff, code: 'FIXTURE_DRIFT' });
    }
  }

  if (mode === 'create-missing') {
    if (typeof adapter.createMissing !== 'function') throw new Error('Adapter cannot create missing fixture data.');
    const created = await adapter.createMissing(state, { fieldLimit: fieldLimitInfo.max, categoryLimit: args['category-limit'] != null ? Number(args['category-limit']) : null });
    if (created.deleted?.length) throw new Error('createMissing deleted records; this mode must never delete.');
    result.writes = created.writes || [];
    state = created.state || state;
  }

  if (mode === 'dedupe-apply') {
    if (typeof adapter.deleteDuplicates !== 'function') throw new Error('Adapter cannot delete leftover AUTOTEST fields.');
    const deleted = await adapter.deleteDuplicates(leftovers);
    result.deleted = deleted.deleted || leftovers;
  }

  if (mode === 'live-readonly' || mode === 'offline') {
    result.writes = [];
    result.deleted = [];
    result.siteWrites = false;
  }

  // Recompute shortfall after any live discovery / creates.
  if (fieldLimitInfo.max != null && state.fieldLimitReport) {
    const display = (state.fields || []).filter((field) => field.role === 'display');
    const planned = display.filter((field) => field.id || mode !== 'create-missing').length;
    // keep report as produced by fixtureStateFromSpec; refresh lastCheckedAt on verify
  }
  state.lastCheckedAt = now();
  writeFixtureState(out, state);
  const errors = validateFixtureState(loadJsonFile(out));
  if (errors.length) throw new Error(`Wrote an invalid fixture-state: ${JSON.stringify(errors)}`);
  result.state = state;
  result.finishedAt = now();
  result.siteWrites = mode === 'create-missing' || mode === 'dedupe-apply';
  return result;
}

export function writeBaselineProgress(file, payload) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}
