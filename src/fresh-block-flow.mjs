import path from 'node:path';
import fs from 'node:fs/promises';
import { executeSettingBatches, planSettingBatches } from './batch-save.mjs';

export const FRESH_MARKER_ATTRIBUTE = 'data-autotest-marker';

export function freshMarker(siteHost, blockId) {
  if (!siteHost || !blockId) throw new Error('siteHost and blockId are required to create the AUTOTEST marker.');
  return `autotest-block:${encodeURIComponent(String(siteHost).toLowerCase())}:${encodeURIComponent(String(blockId))}`;
}

export function parseFreshPageConfig(env = process.env) {
  const kind = String(env.FRESH_PAGE_KIND || '').trim().toLowerCase();
  if (!kind) throw new Error('fresh-block flow requires FRESH_PAGE_KIND=custom or system; no page is selected automatically.');
  if (!['custom', 'system'].includes(kind)) throw new Error('FRESH_PAGE_KIND must be custom or system.');
  if (kind === 'custom') {
    const name = String(env.FRESH_PAGE_NAME || '').trim();
    if (!name) throw new Error('FRESH_PAGE_NAME is required when FRESH_PAGE_KIND=custom.');
    return { kind, name };
  }
  const id = String(env.FRESH_PAGE_ID || '').trim();
  const url = String(env.FRESH_PAGE_URL || '').trim();
  if (!id || !url) throw new Error('FRESH_PAGE_ID and FRESH_PAGE_URL are required when FRESH_PAGE_KIND=system.');
  return { kind, id, url };
}

export function matchMarkedInstances(instances, marker) {
  if (!marker || typeof marker !== 'string') throw new Error('A non-empty AUTOTEST marker is required.');
  const matches = (instances || []).filter((item) => item.marker === marker);
  if ((instances || []).some((item) => item.markerAmbiguous === true)) {
    throw new Error('Block marker identity is ambiguous; no block will be deleted.');
  }
  if (matches.length > 1) throw new Error(`Found ${matches.length} blocks with the AUTOTEST marker; no block will be deleted.`);
  return matches[0] || null;
}

const identity = (item) => String(item.controlIdentity ?? item.id ?? item.key);

export function diffFreshDefaults(previous, current) {
  if (!previous) return { firstCapture: true, changes: [] };
  const before = new Map((previous.values || []).map((item) => [identity(item), item]));
  const after = new Map((current || []).map((item) => [identity(item), item]));
  const changes = [];
  for (const [key, value] of before) {
    const now = after.get(key);
    if (!now) changes.push({ controlIdentity: key, label: value.label, kind: 'removed', previous: value.value, current: null });
    else if (JSON.stringify(value.value) !== JSON.stringify(now.value)) {
      changes.push({ controlIdentity: key, label: now.label || value.label, kind: 'changed', previous: value.value, current: now.value });
    }
  }
  for (const [key, value] of after) if (!before.has(key)) {
    changes.push({ controlIdentity: key, label: value.label, kind: 'added', previous: null, current: value.value });
  }
  return { firstCapture: false, changes };
}

export function freshDefaultsPath(root, siteHost, blockId) {
  if (!siteHost || !String(blockId).trim()) throw new Error('siteHost and blockId are required for fresh default snapshots.');
  const hostPart = encodeURIComponent(String(siteHost).toLowerCase());
  const blockPart = encodeURIComponent(String(blockId));
  return path.join(root, '.local', 'fresh-defaults', hostPart, `${blockPart}.json`);
}

export async function readFreshDefaultsSnapshot(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function writeFreshDefaultsSnapshot(file, snapshot) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
}

export function buildFreshReport({ runId, siteHost, blockId, page, marker, markedInstance,
  defaults, batch, currentValues, editorLink, frontLink, publishedAt, flowErrors = [] }) {
  const failures = batch.results.filter((item) => item.status === 'fail').map((item) => ({
    checkId: item.id,
    setting: item.setting || item.id,
    value: item.value,
    expected: item.batchResult?.expected,
    actual: item.batchResult?.actual,
    detail: item.batchResult?.detail || item.detail,
    screenshot: item.batchResult?.screenshot || item.rerunAloneResult?.screenshot || null,
    rerunAloneResult: item.rerunAloneResult || null,
  }));
  return {
    schemaVersion: 1, flow: 'fresh-block', runId, siteHost, blockId,
    marker: { attribute: FRESH_MARKER_ATTRIBUTE, value: marker }, page,
    block: { settingId: markedInstance.settingId || null, position: markedInstance.position || null,
      currentValues: currentValues || [] },
    defaults, batches: batch.batches, checks: batch.results, failures,
    retainedFailures: batch.timing.retainedFailures || { selectedIds: [], suppressed: [] },
    timing: batch.timing, flowErrors, links: { editor: editorLink || null, front: frontLink || null },
    publishedAt,
  };
}

/**
 * Adapter boundary is deliberate: all destructive editor operations are
 * guarded here by persisted-marker cardinality, while browser specifics stay
 * behind explicit methods that can be mocked offline.
 */
export async function runFreshBlockFlow({ config, adapter, settings, metadata = {}, runId = new Date().toISOString() }) {
  if (!config?.page || !['custom', 'system'].includes(config.page.kind)) {
    throw new Error('Fresh block flow requires an explicit page config; set FRESH_PAGE_KIND and its page fields.');
  }
  if (!config.siteHost || !config.blockId || !config.marker) throw new Error('siteHost, blockId, and marker are required.');
  for (const method of ['openPage', 'listBlockInstances', 'deleteMarkedBlock', 'addDefaultBlock',
    'setMarker', 'savePage', 'reloadPage', 'readDefaults', 'publishPage', 'readCurrentValues']) {
    if (typeof adapter?.[method] !== 'function') throw new Error(`Fresh block adapter is missing ${method}().`);
  }
  if (!adapter.batchAdapter) throw new Error('Fresh block adapter must provide batchAdapter; settings cannot be tested without batch saves.');
  const plan = planSettingBatches(settings, metadata);
  if (plan.some((batch) => batch.restoreBefore.length)) {
    throw new Error('Fresh-block flow cannot run settings whose batch plan requires baseline restoration; split or redesign the generic setting metadata first.');
  }

  const opened = await adapter.openPage(config.page);
  let instances = await adapter.listBlockInstances(config.blockId);
  const prior = matchMarkedInstances(instances, config.marker);
  if (prior) {
    await adapter.deleteMarkedBlock(prior);
    instances = await adapter.listBlockInstances(config.blockId);
    if (matchMarkedInstances(instances, config.marker)) throw new Error('Marked block remained after deletion; stopped before adding another instance.');
  }

  const created = await adapter.addDefaultBlock(config.blockId);
  if (!created || created.blockId !== String(config.blockId)) throw new Error('Adapter did not identify the newly added block instance.');
  await adapter.setMarker(created, config.marker);
  await adapter.savePage();
  await adapter.reloadPage();
  instances = await adapter.listBlockInstances(config.blockId);
  let marked;
  try {
    marked = matchMarkedInstances(instances, config.marker);
    if (!marked || !created.settingId || String(marked.settingId || '') !== String(created.settingId)) {
      throw new Error('Saved marker could not be read back on the newly added instance; settings were not run.');
    }
  } catch (error) {
    if (typeof adapter.deleteCreatedBlock === 'function') {
      await adapter.deleteCreatedBlock(created);
      await adapter.savePage();
    }
    throw error;
  }

  const defaultsValues = await adapter.readDefaults(marked);
  const defaultsPath = freshDefaultsPath(config.projectRoot || process.cwd(), config.siteHost, config.blockId);
  const priorDefaults = await (adapter.readDefaultsSnapshot?.(defaultsPath) ?? readFreshDefaultsSnapshot(defaultsPath)) || null;
  if (priorDefaults && (priorDefaults.siteHost !== config.siteHost || String(priorDefaults.blockId) !== String(config.blockId))) {
    throw new Error('Fresh defaults snapshot identity mismatch; refusing to compare defaults across site/block identities.');
  }
  const defaults = diffFreshDefaults(priorDefaults, defaultsValues);
  if (!priorDefaults) await (adapter.writeDefaultsSnapshot?.(defaultsPath, {
    version: 1, siteHost: config.siteHost, blockId: String(config.blockId), capturedAt: new Date().toISOString(), values: defaultsValues,
  }) ?? writeFreshDefaultsSnapshot(defaultsPath, {
    version: 1, siteHost: config.siteHost, blockId: String(config.blockId), capturedAt: new Date().toISOString(), values: defaultsValues,
  }));

  let batch;
  const flowErrors = [];
  try {
    batch = await executeSettingBatches({ settings, metadata, adapter: adapter.batchAdapter, finalState: 'retain-tested-values' });
  } catch (error) {
    flowErrors.push({ stage: 'batch-settings', message: error.message });
    batch = { batches: plan.map(({ settings: items, restoreBefore }) => ({ settingIds: items.map((item) => item.id), restoreBefore })),
      results: [{ id: 'fresh-batch-execution', status: 'fail', detail: error.message }],
      timing: { startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 0 } };
  }
  const values = await adapter.readCurrentValues(marked);
  try {
    const remainingMarked = matchMarkedInstances(await adapter.listBlockInstances(config.blockId), config.marker);
    if (!remainingMarked || remainingMarked.settingId !== marked.settingId) {
      flowErrors.push({ stage: 'final-marker-check', message: 'The page no longer contains exactly one marked test instance.' });
    }
  } catch (error) { flowErrors.push({ stage: 'final-marker-check', message: error.message }); }
  let published = null;
  try { published = await adapter.publishPage(); }
  catch (error) { flowErrors.push({ stage: 'publish', message: error.message }); }
  const report = buildFreshReport({ runId, siteHost: config.siteHost, blockId: config.blockId,
    page: config.page, marker: config.marker, markedInstance: marked, defaults, batch,
    currentValues: values, editorLink: opened.editorLink || adapter.editorLink?.(),
    frontLink: published?.frontLink || opened.frontLink, publishedAt: published?.publishedAt || null, flowErrors });
  await adapter.writeReport?.(report);
  return report;
}
