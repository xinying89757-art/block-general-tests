import path from 'node:path';
import fs from 'node:fs/promises';
import { executeSettingBatches, planSettingBatches } from './batch-save.mjs';

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

export function targetBlockInstances(instances, blockId) {
  if (blockId === undefined || blockId === null || String(blockId).trim() === '') {
    throw new Error('A target block number is required.');
  }
  return (instances || []).filter((item) => String(item.blockId) === String(blockId));
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

export function buildFreshReport({ runId, siteHost, blockId, page, instance, capabilities = [],
  defaults, batch, currentValues, editorLink, frontLink, publishedAt, deletedSettingIds = [], flowErrors = [] }) {
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
    page,
    block: { settingId: instance.settingId || null, position: instance.position || null,
      currentValues: currentValues || [] },
    lifecycle: { deletedSettingIds: [...deletedSettingIds], addedSettingId: instance.settingId || null },
    defaults, capabilities, batches: batch.batches, checks: batch.results, failures,
    retainedFailures: batch.timing.retainedFailures || { selectedIds: [], suppressed: [] },
    timing: batch.timing, settingsMode: 'BATCH_SAVE / retain-tested-values', flowErrors,
    links: { editor: editorLink || null, front: frontLink || null },
    publishedAt,
  };
}

/**
 * The block number is the sole deletion key. Every target-number instance on
 * the selected page is deleted and independently verified before one fresh
 * instance is added. Other block numbers are snapshotted and must remain.
 */
export async function runFreshBlockFlow({ config, adapter, settings = [], metadata = {}, capabilities = [],
  runId = new Date().toISOString(), onProgress = async () => {} }) {
  if (!config?.page || !['custom', 'system'].includes(config.page.kind)) {
    throw new Error('Fresh block flow requires an explicit page config; set FRESH_PAGE_KIND and its page fields.');
  }
  if (!config.siteHost || !config.blockId) throw new Error('siteHost and blockId are required.');
  for (const method of ['openPage', 'listAllBlockInstances', 'deleteBlockInstance', 'addDefaultBlock',
    'savePage', 'reloadPage', 'readDefaults', 'publishPage', 'readCurrentValues']) {
    if (typeof adapter?.[method] !== 'function') throw new Error(`Fresh block adapter is missing ${method}().`);
  }
  const opened = await adapter.openPage(config.page);
  await onProgress({ stage: 'page-opened' });
  const deletedSettingIds = [];
  let instances = await adapter.listAllBlockInstances();
  await onProgress({ stage: 'instances-inventoried', targetCount: targetBlockInstances(instances, config.blockId).length });
  const otherBlockCounts = countOtherBlocks(instances, config.blockId);
  let targets = targetBlockInstances(instances, config.blockId);
  assertUniqueTargetIdentities(targets);
  while (targets.length) {
    const target = targets[0];
    if (!target.settingId || !Number.isInteger(target.ordinal)) {
      throw new Error('Target block instance lacks a unique settingId/ordinal; no further delete or add will be attempted.');
    }
    await onProgress({ stage: 'delete-started', targetCount: targets.length });
    await adapter.deleteBlockInstance(target);
    const afterDelete = await adapter.listAllBlockInstances();
    assertOtherBlocksUnchanged(otherBlockCounts, afterDelete, config.blockId);
    const remaining = targetBlockInstances(afterDelete, config.blockId);
    if (remaining.length !== targets.length - 1 || remaining.some((item) => item.settingId === target.settingId)) {
      throw new Error('Delete did not remove exactly the selected target instance; stopped before adding.');
    }
    instances = afterDelete;
    targets = remaining;
    deletedSettingIds.push(String(target.settingId));
    await onProgress({ stage: 'instance-deleted', targetCount: targets.length,
      deletedSettingId: String(target.settingId), deletedSettingIds: [...deletedSettingIds] });
  }

  const created = await adapter.addDefaultBlock(config.blockId);
  if (!created || created.blockId !== String(config.blockId)) throw new Error('Adapter did not identify the newly added block instance.');
  await onProgress({ stage: 'instance-added', settingId: String(created.settingId || '') });
  await adapter.savePage();
  await onProgress({ stage: 'fresh-instance-saved' });
  await adapter.reloadPage();
  await onProgress({ stage: 'fresh-instance-reloaded' });
  instances = await adapter.listAllBlockInstances();
  assertOtherBlocksUnchanged(otherBlockCounts, instances, config.blockId);
  const freshInstances = targetBlockInstances(instances, config.blockId);
  if (freshInstances.length !== 1 || !created.settingId || String(freshInstances[0].settingId) !== String(created.settingId)) {
    throw new Error('After save/reload the selected page does not contain exactly the newly added target block.');
  }
  const fresh = freshInstances[0];

  // Definitions must be bound to the newly added instance. Preparing these
  // before deletion would capture controls from the old block being replaced.
  const prepared = await adapter.prepareSettings?.();
  const settingsToRun = prepared?.settings || settings;
  const metadataToUse = prepared?.metadata || metadata;
  const capabilitiesToReport = prepared?.capabilityResults || capabilities;
  const staticResults = prepared?.staticResults || [];
  const batchAdapter = prepared?.batchAdapter || adapter.batchAdapter;
  if (!batchAdapter) throw new Error('Fresh block adapter must provide batchAdapter; settings cannot be tested without batch saves.');
  const plan = planSettingBatches(settingsToRun, metadataToUse);
  if (plan.some((batch) => batch.restoreBefore.length) && typeof batchAdapter.restore !== 'function') {
    throw new Error('Fresh-block batch plan requires initial-value restoration between dependent checks, but the capability adapter does not provide it.');
  }
  const printablePlan = plan.map(({ settings: items, restoreBefore }, index) => ({
    index, settingIds: items.map((item) => item.id), restoreBefore,
  }));
  await onProgress({ stage: 'batch-plan-prepared', batches: printablePlan });

  const defaultsValues = await adapter.readDefaults(fresh);
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
  await onProgress({ stage: 'defaults-captured', firstCapture: !priorDefaults });

  let batch;
  const flowErrors = [];
  let batchExecutionFailed = false;
  try {
    batch = await executeSettingBatches({ settings: settingsToRun, metadata: metadataToUse, adapter: batchAdapter, finalState: 'retain-tested-values' });
    batch.results = [...staticResults, ...batch.results];
    await onProgress({ stage: 'batches-finished', checkCount: batch.results.length });
  } catch (error) {
    batchExecutionFailed = true;
    flowErrors.push({ stage: 'batch-settings', message: error.message });
    batch = { batches: plan.map(({ settings: items, restoreBefore }) => ({ settingIds: items.map((item) => item.id), restoreBefore })),
      results: [...staticResults, { id: 'fresh-batch-execution', status: 'fail', detail: error.message }],
      timing: { startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 0 } };
  }
  const values = await adapter.readCurrentValues(fresh);
  await onProgress({ stage: 'current-values-read' });
  const finalInstances = await adapter.listAllBlockInstances();
  assertOtherBlocksUnchanged(otherBlockCounts, finalInstances, config.blockId);
  const remaining = targetBlockInstances(finalInstances, config.blockId);
  if (remaining.length !== 1 || remaining[0].settingId !== fresh.settingId) {
    throw new Error('The page no longer contains exactly one test instance of the target block number; refusing to publish.');
  }
  let published = null;
  if (!batchExecutionFailed) {
    try { await onProgress({ stage: 'publish-started' }); published = await adapter.publishPage();
      await onProgress({ stage: 'published' }); }
    catch (error) { flowErrors.push({ stage: 'publish', message: error.message }); }
  } else {
    flowErrors.push({ stage: 'publish', message: 'Skipped because batch settings execution failed; page was left unpublished.' });
  }
  const report = buildFreshReport({ runId, siteHost: config.siteHost, blockId: config.blockId,
    page: config.page, instance: fresh, capabilities: capabilitiesToReport, defaults, batch,
    currentValues: values, editorLink: opened.editorLink || adapter.editorLink?.(),
    frontLink: published?.frontLink || opened.frontLink, publishedAt: published?.publishedAt || null,
    deletedSettingIds, flowErrors });
  await adapter.writeReport?.(report);
  await onProgress({ stage: 'report-written' });
  return report;
}

function countOtherBlocks(instances, blockId) {
  const counts = new Map();
  for (const item of instances || []) {
    if (String(item.blockId) === String(blockId)) continue;
    const key = String(item.blockId);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function assertOtherBlocksUnchanged(expected, instances, blockId) {
  const actual = countOtherBlocks(instances, blockId);
  if (expected.size !== actual.size || [...expected].some(([id, count]) => actual.get(id) !== count)) {
    throw new Error('A non-target block number changed on the selected page; stopping immediately.');
  }
}

function assertUniqueTargetIdentities(instances) {
  const ids = instances.map((item) => item.settingId);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error('Target block instances do not have unique settingId values; refusing to delete any block.');
  }
  const ordinals = instances.map((item) => item.ordinal);
  if (ordinals.some((ordinal) => !Number.isInteger(ordinal)) || new Set(ordinals).size !== ordinals.length) {
    throw new Error('Target block instances do not have unique positions in the editor; refusing to delete any block.');
  }
}
