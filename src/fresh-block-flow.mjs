import path from 'node:path';
import fs from 'node:fs/promises';
import { executeSettingBatches, planSettingBatches } from './batch-save.mjs';
import { projectPersistedFreshValues } from './fresh-settings-adapter.mjs';

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

/** Read a page inventory only after consecutive identical, ready snapshots. */
export async function readStableBlockInventory(read, { waitForReady = async () => {}, timeoutMs = 15_000,
  intervalMs = 100, now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (typeof read !== 'function') throw new Error('Stable inventory requires a read() function.');
  const deadline = now() + timeoutMs;
  let previous;
  let previousSignature;
  while (now() < deadline) {
    await waitForReady({ timeoutMs: Math.max(1, deadline - now()) });
    const current = await read();
    const signature = JSON.stringify(current);
    if (previousSignature !== undefined && signature === previousSignature) return current;
    previous = current;
    previousSignature = signature;
    if (now() >= deadline) break;
    await wait(Math.min(intervalMs, Math.max(1, deadline - now())));
  }
  const error = new Error(`Page block inventory did not stabilize within ${timeoutMs}ms; last snapshot=${JSON.stringify(previous ?? null)}`);
  error.name = 'TimeoutError';
  error.code = 'PAGE_INVENTORY_UNSTABLE';
  error.lastInventory = previous;
  throw error;
}

export function countPageBlocksByNumber(instances = []) {
  const counts = {};
  for (const instance of instances) {
    const id = String(instance.blockId);
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
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

export function compareFreshValueSnapshots(before = [], after = []) {
  const keyed = (items) => {
    const occurrences = new Map();
    return (items || []).map((item) => {
      const base = JSON.stringify([item.region || '', item.label || item.key || item.id || '', item.type || '']);
      const occurrence = occurrences.get(base) || 0;
      occurrences.set(base, occurrence + 1);
      return { key: `${base}:${occurrence}`, item };
    });
  };
  const left = new Map(keyed(before).map(({ key, item }) => [key, item]));
  const right = new Map(keyed(after).map(({ key, item }) => [key, item]));
  const mismatches = [];
  for (const [key, expected] of left) {
    const actual = right.get(key);
    if (!actual || JSON.stringify(expected.value) !== JSON.stringify(actual.value)) {
      mismatches.push({ controlIdentity: expected.controlIdentity || key, label: expected.label || '',
        expected: expected.value, actual: actual?.value ?? null, kind: actual ? 'changed' : 'missing' });
    }
  }
  for (const [key, actual] of right) if (!left.has(key)) {
    mismatches.push({ controlIdentity: actual.controlIdentity || key, label: actual.label || '',
      expected: null, actual: actual.value, kind: 'added' });
  }
  return { status: mismatches.length ? 'fail' : 'pass', mismatches };
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
  defaults, batch, currentValues, publishedReadback = null, editorLink, frontLink, publishedAt,
  editorPublishSucceeded = false, frontVerification = null,
  deletedSettingIds = [], moduleLibraryPreflight = null, flowErrors = [] }) {
  const failures = batch.results.filter((item) => item.status === 'fail').map((item) => ({
    checkId: item.id,
    setting: item.setting || item.id,
    value: item.value,
    expected: item.batchResult?.expected ?? item.expected,
    actual: item.batchResult?.actual ?? item.actual,
    ...(item.classification ? { classification: item.classification } : {}),
    detail: item.batchResult?.detail || item.detail,
    screenshot: item.batchResult?.screenshot || item.rerunAloneResult?.screenshot || null,
    rerunAloneResult: item.rerunAloneResult || null,
  }));
  return {
    schemaVersion: 1, flow: 'fresh-block', runId, siteHost, blockId,
    page,
    block: { settingId: instance.settingId || null, position: instance.position || null,
      currentValues: currentValues || [], publishedReadbackValues: publishedReadback?.currentValues || null },
    lifecycle: { deletedSettingIds: [...deletedSettingIds], addedSettingId: instance.settingId || null },
    moduleLibraryPreflight,
    defaults, capabilities, batches: batch.batches, checks: batch.results, failures,
    retainedFailures: batch.timing.retainedFailures || { selectedIds: [], suppressed: [] },
    timing: batch.timing, settingsMode: 'BATCH_SAVE / retain-tested-values', flowErrors,
    publishedReadback,
    links: { editor: editorLink || null, front: frontLink || null },
    editorPublishSucceeded: Boolean(editorPublishSucceeded),
    frontVerification,
    publishedConfirmed: Boolean(publishedAt),
    confirmationSource: publishedAt ? 'editor-and-runner-front' : null,
    publishedAt,
  };
}

/**
 * The block number is the sole deletion key. Add and uniquely identify one
 * fresh instance first; only then delete the prior instances of that number.
 * This makes an unavailable library a safe stop before any deletion. Other
 * block numbers are snapshotted and must remain.
 */
export async function runFreshBlockFlow({ config, adapter, settings = [], metadata = {}, capabilities = [],
  runId = new Date().toISOString(), onProgress = async () => {} }) {
  if (!config?.page || !['custom', 'system'].includes(config.page.kind)) {
    throw new Error('Fresh block flow requires an explicit page config; set FRESH_PAGE_KIND and its page fields.');
  }
  if (!config.siteHost || !config.blockId) throw new Error('siteHost and blockId are required.');
  for (const method of ['openPage', 'listAllBlockInstances', 'deleteBlockInstance', 'addDefaultBlock',
    'savePage', 'reloadPage', 'readDefaults', 'publishPage', 'readCurrentValues', 'readPublishedValues',
    'captureFailureScreenshot', 'discardUnsavedChanges', 'writeStopReport']) {
    if (typeof adapter?.[method] !== 'function') throw new Error(`Fresh block adapter is missing ${method}().`);
  }
  const opened = await adapter.openPage(config.page);
  await onProgress({ stage: 'page-opened' });
  const deletedSettingIds = [];
  const stableRead = () => readStableBlockInventory(() => adapter.listAllBlockInstances(), {
    waitForReady: adapter.waitForInventoryReady?.bind(adapter),
    timeoutMs: Number(config.inventoryStabilizeTimeoutMs) || 15_000,
    intervalMs: Number(config.inventoryPollMs) || 100,
  });
  let instances = await stableRead();
  await onProgress({ stage: 'instances-inventoried', targetCount: targetBlockInstances(instances, config.blockId).length });
  const otherBlockCounts = countOtherBlocks(instances, config.blockId);
  const priorTargets = targetBlockInstances(instances, config.blockId);
  assertUniqueTargetIdentities(priorTargets);
  if (priorTargets.some((item) => !Number.isInteger(item.ordinal))) {
    throw new Error('Target block instance lacks a unique position; refusing to continue.');
  }

  // Adding first reuses the proven G27 lookup/add path. A failed lookup leaves
  // every existing target instance untouched.
  let created;
  let freshIdentity;
  let targets;
  let addAttempted = false;
  try {
    addAttempted = true;
    created = await adapter.addDefaultBlock(config.blockId);
    if (!created || String(created.blockId) !== String(config.blockId) || !created.settingId) {
      throw new Error('Adapter did not identify the newly added target block instance; existing instances were not deleted.');
    }
    instances = await stableRead();
    assertOtherBlocksUnchanged(otherBlockCounts, instances, config.blockId, { createdSettingId: created.settingId,
      expectedTargetCount: priorTargets.length + 1 });
    targets = targetBlockInstances(instances, config.blockId);
    assertUniqueTargetIdentities(targets);
    const priorIds = new Set(priorTargets.map((item) => String(item.settingId)));
    const createdMatches = targets.filter((item) => String(item.settingId) === String(created.settingId));
    if (createdMatches.length !== 1 || priorIds.has(String(created.settingId))
      || targets.length !== priorTargets.length + 1) {
      throw new Error(`Fresh add did not produce exactly one uniquely identified new target; expected target count ${priorTargets.length + 1}, actual ${targets.length}; created settingId=${created.settingId}.`);
    }
    freshIdentity = String(created.settingId);
    await onProgress({ stage: 'instance-added', settingId: freshIdentity });

    while (targets.some((item) => String(item.settingId) !== freshIdentity)) {
      const target = targets.find((item) => String(item.settingId) !== freshIdentity);
      if (!target.settingId || !Number.isInteger(target.ordinal)) {
        throw new Error('Existing target instance lacks a unique settingId/position; stopped without deleting another block.');
      }
      await onProgress({ stage: 'delete-started', targetCount: targets.length,
        preservingSettingId: freshIdentity });
      await adapter.deleteBlockInstance(target);
      const afterDelete = await stableRead();
      assertOtherBlocksUnchanged(otherBlockCounts, afterDelete, config.blockId, { createdSettingId: freshIdentity,
        expectedTargetCount: targets.length - 1 });
      const remaining = targetBlockInstances(afterDelete, config.blockId);
      if (remaining.length !== targets.length - 1
        || remaining.some((item) => String(item.settingId) === String(target.settingId))
        || remaining.filter((item) => String(item.settingId) === freshIdentity).length !== 1) {
        throw new Error(`Delete did not remove exactly one old target while preserving the fresh instance; expected target count ${targets.length - 1}, actual ${remaining.length}; created settingId=${freshIdentity}, deleted settingId=${target.settingId}.`);
      }
      targets = remaining;
      deletedSettingIds.push(String(target.settingId));
      await onProgress({ stage: 'instance-deleted', targetCount: targets.length,
        deletedSettingId: String(target.settingId), addedSettingId: freshIdentity,
        deletedSettingIds: [...deletedSettingIds] });
    }
    if (targets.length !== 1 || !targets.some((item) => String(item.settingId) === freshIdentity)) {
      throw new Error(`After replacement, expected exactly one fresh target; actual ${targets.length}, created settingId=${freshIdentity}.`);
    }
  } catch (error) {
    if (addAttempted) {
      let discarded = false;
      let discardError = null;
      try { await adapter.discardUnsavedChanges(); discarded = true; }
      catch (discardFailure) { discardError = discardFailure.message; }
      const actualInstances = Array.isArray(error.lastInventory) ? error.lastInventory : instances;
      const guard = error.guardDiagnostics || blockCountDiagnostics(otherBlockCounts, actualInstances, config.blockId);
      const stopReport = { schemaVersion: 1, flow: 'fresh-block', status: 'stopped-before-save', runId,
        siteHost: config.siteHost, blockId: String(config.blockId), page: config.page,
        stage: error.stage || 'post-add-or-delete-inventory', createdSettingId: created?.settingId ? String(created.settingId) : null,
        deletedSettingIds: [...deletedSettingIds], expectedNonTargetCounts: guard.expected,
        actualNonTargetCounts: guard.actual, countDifferences: guard.differences,
        expectedPageCounts: guard.expectedPageCounts, actualPageCounts: guard.actualPageCounts,
        unsavedEditorStateDiscarded: discarded, discardError, saved: false, publishedAt: null,
        error: error.message };
      error.stopReport = stopReport;
      error.unsavedEditorStateDiscarded = discarded;
      await adapter.writeStopReport?.(stopReport);
      await onProgress({ stage: 'pre-save-guard-stopped', createdSettingId: created?.settingId ? String(created.settingId) : null,
        expectedNonTargetCounts: guard.expected, actualNonTargetCounts: guard.actual,
        unsavedEditorStateDiscarded: discarded, discardError });
    }
    throw error;
  }
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

  const flowErrors = [];
  let batchExecutionFailed = false;
  const captureFailure = async (stage) => {
    try { return await adapter.captureFailureScreenshot?.({ runId, stage }) || null; }
    catch (error) { flowErrors.push({ stage: `${stage}-screenshot`, message: error.message }); return null; }
  };
  let defaults = null;
  let defaultsError = null;
  try {
    const defaultsValues = await adapter.readDefaults(fresh);
    const defaultsPath = freshDefaultsPath(config.projectRoot || process.cwd(), config.siteHost, config.blockId);
    const priorDefaults = await (adapter.readDefaultsSnapshot?.(defaultsPath) ?? readFreshDefaultsSnapshot(defaultsPath)) || null;
    if (priorDefaults && (priorDefaults.siteHost !== config.siteHost || String(priorDefaults.blockId) !== String(config.blockId))) {
      throw new Error('Fresh defaults snapshot identity mismatch; refusing to compare defaults across site/block identities.');
    }
    const inventoryErrors = defaultsValues.inventoryErrors || [];
    defaults = inventoryErrors.length
      ? { firstCapture: !priorDefaults, changes: [], inventoryErrors }
      : diffFreshDefaults(priorDefaults, defaultsValues);
    if (!priorDefaults && !inventoryErrors.length) await (adapter.writeDefaultsSnapshot?.(defaultsPath, {
      version: 1, siteHost: config.siteHost, blockId: String(config.blockId), capturedAt: new Date().toISOString(), values: defaultsValues,
    }) ?? writeFreshDefaultsSnapshot(defaultsPath, {
      version: 1, siteHost: config.siteHost, blockId: String(config.blockId), capturedAt: new Date().toISOString(), values: defaultsValues,
    }));
    await onProgress({ stage: 'defaults-captured', firstCapture: !priorDefaults, inventoryErrorCount: inventoryErrors.length });
  } catch (error) {
    defaultsError = error;
    defaults = { status: 'unavailable', error: error.message };
    const screenshot = await captureFailure('defaults-inventory');
    flowErrors.push({ stage: 'defaults-inventory', message: error.message, screenshot });
    await onProgress({ stage: 'defaults-inventory-failed' });
  }

  let batch;
  if (defaultsError) {
    batchExecutionFailed = true;
    batch = { batches: printablePlan, results: [...staticResults, {
      id: 'fresh-defaults-inventory', status: 'fail',
      expected: 'Fresh block default settings inventory is readable before any setting checks.',
      actual: defaultsError.message, detail: defaultsError.message,
      batchResult: { expected: 'A complete default settings inventory.', actual: defaultsError.message,
        detail: defaultsError.message, screenshot: flowErrors.find((item) => item.stage === 'defaults-inventory')?.screenshot || null },
    }], timing: { startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 0 } };
  } else try {
    batch = await executeSettingBatches({ settings: settingsToRun, metadata: metadataToUse, adapter: batchAdapter, finalState: 'retain-tested-values' });
    batch.results = [...staticResults, ...batch.results];
    for (const item of batch.results.filter((result) => result.status === 'fail')) {
      if (!item.batchResult?.screenshot && !item.rerunAloneResult?.screenshot) {
        const screenshot = await captureFailure(`check-${item.id}`);
        if (screenshot) item.batchResult = { ...(item.batchResult || {}), screenshot };
      }
    }
    await onProgress({ stage: 'batches-finished', checkCount: batch.results.length });
  } catch (error) {
    batchExecutionFailed = true;
    const screenshot = await captureFailure('batch-settings');
    flowErrors.push({ stage: 'batch-settings', message: error.message, screenshot });
    const partial = error.partialBatch || {};
    batch = { batches: partial.batches || plan.map(({ settings: items, restoreBefore }) => ({
      settingIds: items.map((item) => item.id), restoreBefore,
    })), results: [...staticResults, ...(partial.results || []),
      { id: 'fresh-batch-execution', status: 'fail', detail: error.message,
        batchResult: { detail: error.message, screenshot } }],
      timing: partial.timing || { startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 0 } };
  }
  let values = [];
  try {
    values = await adapter.readCurrentValues(fresh);
    await onProgress({ stage: 'current-values-read' });
  } catch (error) {
    const screenshot = await captureFailure('current-values');
    flowErrors.push({ stage: 'current-values', message: error.message, screenshot });
    batch.results.push({ id: 'fresh-current-values', status: 'fail',
      expected: 'Current settings inventory is readable after the settings batch.', actual: error.message,
      detail: `Current-value inventory failed: ${error.message}`,
      batchResult: { expected: 'A complete current value inventory.', actual: error.message,
        detail: error.message, screenshot } });
    await onProgress({ stage: 'current-values-read-failed' });
  }
  const finalInstances = await adapter.listAllBlockInstances();
  assertOtherBlocksUnchanged(otherBlockCounts, finalInstances, config.blockId);
  const remaining = targetBlockInstances(finalInstances, config.blockId);
  if (remaining.length !== 1 || remaining[0].settingId !== fresh.settingId) {
    throw new Error('The page no longer contains exactly one test instance of the target block number; refusing to publish.');
  }
  let published = null;
  let publishAttempt = null;
  let publishedReadback = null;
  if (!batchExecutionFailed) {
    try { await onProgress({ stage: 'publish-started' }); publishAttempt = await adapter.publishPage({ settingId: fresh.settingId });
      // A click is not proof: require an editor success signal and the exact
      // instance on the cache-busted public page when the adapter reports them.
      const unconfirmed = !publishAttempt || publishAttempt.confirmed !== true;
      if (!unconfirmed) published = publishAttempt;
      await onProgress({ stage: unconfirmed ? 'publish-unconfirmed' : 'published',
        ...(publishAttempt?.publishSignal ? { signal: publishAttempt.publishSignal.status } : {}),
        ...(publishAttempt?.frontVerification ? { front: publishAttempt.frontVerification.status } : {}) });
      if (unconfirmed) {
        const detail = `发布未确认：编辑器信号=${publishAttempt?.publishSignal?.status || 'n/a'}，前台=${publishAttempt?.frontVerification?.status || 'n/a'}`;
        flowErrors.push({ stage: 'publish-confirmation', message: detail, frontVerification: publishAttempt?.frontVerification || null });
        batch.results.push({ id: 'fresh-publish-confirmed', status: 'fail', detail,
          batchResult: { expected: '编辑器出现发布成功提示，且带 ?t= 的前台页面包含本次新加的区块实例。', actual: detail, detail } });
      } }
    catch (error) {
      const screenshot = await captureFailure('publish');
      flowErrors.push({ stage: 'publish', message: error.message, screenshot,
        ...(error.publishDiagnostics ? { diagnostics: error.publishDiagnostics } : {}) });
      batch.results.push({ id: 'fresh-publish', status: 'fail', detail: error.message,
        batchResult: { expected: 'The selected page publishes successfully.', actual: error.message,
          detail: error.message, screenshot,
          ...(error.publishDiagnostics ? { diagnostics: error.publishDiagnostics } : {}) } });
    }
    if (published) {
      try {
        const readbackValues = await adapter.readPublishedValues(fresh);
        const hasDeclaredScope = Array.isArray(prepared?.persistedControls);
        const persistedControls = prepared?.persistedControls || [];
        const beforeCompared = hasDeclaredScope
          ? projectPersistedFreshValues(values, persistedControls) : values;
        const afterCompared = hasDeclaredScope
          ? projectPersistedFreshValues(readbackValues, persistedControls) : readbackValues;
        const comparison = beforeCompared.length
          ? compareFreshValueSnapshots(beforeCompared, afterCompared)
          : { status: 'skip', mismatches: [] };
        const readbackCheck = { id: 'fresh-post-publish-readback', status: comparison.status,
          expected: hasDeclaredScope
            ? 'All persisted controls declared by adapted capability definitions retain their pre-publish values after editor reload.'
            : 'All setting controls retain their pre-publish values after editor reload.',
          actual: comparison.status === 'pass' ? `${beforeCompared.length} declared control(s) match.`
            : comparison.status === 'skip' ? 'No adapted capability declared persisted controls for readback.'
              : `${comparison.mismatches.length} declared control value(s) differ.`,
          detail: comparison.status === 'pass' ? `发布后重载编辑器，${beforeCompared.length} 个能力已声明的持久设置控件与发布前一致。`
            : comparison.status === 'skip' ? '没有适配能力声明可用于持久化回读的控件；全量控件仍记录在报告中。'
              : `发布后回读发现 ${comparison.mismatches.length} 项已声明持久设置控件值变化。`,
          evidence: comparison.mismatches };
        if (comparison.status === 'fail') {
          const screenshot = await captureFailure('post-publish-readback');
          readbackCheck.batchResult = { expected: readbackCheck.expected, actual: readbackCheck.actual,
            detail: readbackCheck.detail, screenshot };
          flowErrors.push({ stage: 'post-publish-readback', message: readbackCheck.detail, screenshot });
        }
        batch.results.push(readbackCheck);
        publishedReadback = { status: comparison.status, currentValues: readbackValues,
          comparedControlCount: beforeCompared.length,
          uncomparedControlCount: Math.max(0, values.length - beforeCompared.length),
          scope: hasDeclaredScope ? 'adapted-capability-persisted-controls' : 'all-inventory-controls',
          mismatches: comparison.mismatches };
        await onProgress({ stage: 'post-publish-readback', status: comparison.status, mismatchCount: comparison.mismatches.length });
      } catch (error) {
        const screenshot = await captureFailure('post-publish-readback');
        const check = { id: 'fresh-post-publish-readback', status: 'fail',
          expected: 'A single fresh target instance can be reloaded and read after publication.',
          actual: error.message, detail: error.message,
          batchResult: { expected: 'Post-publish editor readback succeeds.', actual: error.message, detail: error.message, screenshot } };
        batch.results.push(check);
        flowErrors.push({ stage: 'post-publish-readback', message: error.message, screenshot });
      }
      if (typeof prepared?.runPostPublishChecks === 'function') {
        try {
          const postPublishChecks = await prepared.runPostPublishChecks({ published,
            frontLink: published.frontLink || opened.frontLink, config, instance: fresh });
          batch.results.push(...postPublishChecks);
          await onProgress({ stage: 'post-publish-checks-finished', checkCount: postPublishChecks.length });
        } catch (error) {
          const screenshot = await captureFailure('post-publish-checks');
          batch.results.push({ id: 'fresh-post-publish-checks', status: 'fail', detail: error.message,
            batchResult: { expected: 'Check-only capability assertions complete after publication.',
              actual: error.message, screenshot } });
          flowErrors.push({ stage: 'post-publish-checks', message: error.message, screenshot });
        }
      }
    }
  } else {
    flowErrors.push({ stage: 'publish', message: 'Skipped because batch settings execution failed; page was left unpublished.' });
  }
  const report = buildFreshReport({ runId, siteHost: config.siteHost, blockId: config.blockId,
    page: config.page, instance: fresh, capabilities: capabilitiesToReport, defaults, batch,
    currentValues: values, editorLink: opened.editorLink || adapter.editorLink?.(),
    publishedReadback, frontLink: publishAttempt?.frontLink || opened.frontLink,
    frontVerification: publishAttempt?.frontVerification || null,
    editorPublishSucceeded: publishAttempt?.publishSignal?.status === 'confirmed',
    publishedAt: published?.publishedAt || null,
    deletedSettingIds, moduleLibraryPreflight: config.moduleLibraryPreflight || null, flowErrors });
  await adapter.writeReport?.(report);
  await onProgress({ stage: 'report-written' });
  return report;
}

function countOtherBlocks(instances, blockId) {
  return Object.fromEntries(Object.entries(countPageBlocksByNumber(instances))
    .filter(([id]) => id !== String(blockId)).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })));
}

function blockCountDiagnostics(expected, instances, blockId, expectedTargetCount) {
  const expectedObject = expected instanceof Map
    ? Object.fromEntries([...expected].sort(([a], [b]) => String(a).localeCompare(String(b), undefined, { numeric: true })))
    : { ...expected };
  const actual = countOtherBlocks(instances, blockId);
  const ids = [...new Set([...Object.keys(expectedObject), ...Object.keys(actual)])]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const differences = ids.flatMap((id) => (expectedObject[id] || 0) === (actual[id] || 0) ? [] : [
    { blockId: id, expected: expectedObject[id] || 0, actual: actual[id] || 0 },
  ]);
  const actualPageCounts = countPageBlocksByNumber(instances);
  const expectedPageCounts = { ...expectedObject,
    ...(Number.isInteger(expectedTargetCount) ? { [String(blockId)]: expectedTargetCount } : {}) };
  return { expected: expectedObject, actual, differences, expectedPageCounts, actualPageCounts };
}

function assertOtherBlocksUnchanged(expected, instances, blockId, { createdSettingId, expectedTargetCount } = {}) {
  const diagnostics = blockCountDiagnostics(expected, instances, blockId, expectedTargetCount);
  if (diagnostics.differences.length) {
    const error = new Error(`A non-target block number changed on the selected page; stopping immediately. Expected non-target counts=${JSON.stringify(diagnostics.expected)}; actual=${JSON.stringify(diagnostics.actual)}; differences=${JSON.stringify(diagnostics.differences)}; created settingId=${createdSettingId || 'not-yet-known'}.`);
    error.code = 'NON_TARGET_BLOCK_COUNT_CHANGED';
    error.guardDiagnostics = diagnostics;
    error.lastInventory = instances;
    throw error;
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
