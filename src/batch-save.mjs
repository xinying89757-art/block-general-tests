const asSet = (value) => new Set(Array.isArray(value) ? value : []);

export function settingsConflict(left, right, metadata = {}) {
  if (left.key === right.key) return true;
  const leftMeta = metadata[left.key] || {};
  const rightMeta = metadata[right.key] || {};
  return asSet([...asSet(leftMeta.dependsOn), ...asSet(leftMeta.interferesWith)]).has(right.key)
    || asSet([...asSet(leftMeta.requiresBaseline)]).has(right.key)
    || asSet([...asSet(rightMeta.dependsOn), ...asSet(rightMeta.interferesWith), ...asSet(rightMeta.requiresBaseline)]).has(left.key);
}

export function planSettingBatches(settings, metadata = {}) {
  const ids = new Set();
  const keys = new Set();
  for (const setting of settings) {
    if (!setting?.id || !setting?.key) throw new Error('批量设置必须提供唯一 id 和 setting key。');
    if (ids.has(setting.id)) throw new Error(`批量设置 id 重复：${setting.id}`);
    ids.add(setting.id);
    keys.add(setting.key);
  }
  const batches = [];
  for (const setting of settings) {
    let batch = batches.find((candidate) => candidate.settings.every((member) => !settingsConflict(setting, member, metadata)));
    if (!batch) { batch = { settings: [], restoreBefore: [] }; batches.push(batch); }
    batch.settings.push(setting);
  }
  const seen = new Set();
  for (const batch of batches) {
    const restoreBefore = new Set();
    for (const setting of batch.settings) {
      for (const key of asSet(metadata[setting.key]?.requiresBaseline)) {
        if (seen.has(key)) restoreBefore.add(key);
      }
    }
    batch.restoreBefore = [...restoreBefore];
    for (const setting of batch.settings) seen.add(setting.key);
  }
  return batches;
}

export async function verifyBaselineWithRecovery({ verify, recover }) {
  try { return { check: await verify(), recovered: false }; }
  catch (error) {
    if (typeof recover !== 'function') throw error;
    const recovery = await recover(error);
    if (recovery?.baselineVerification) return { check: recovery.baselineVerification, recovered: true };
    return { check: await verify(), recovered: true };
  }
}

const outcomeStatus = (outcome) => outcome?.status || 'pass';

export function selectRetainedFailures(results, settings, metadata = {}) {
  const byId = new Map(settings.map((setting) => [setting.id, setting]));
  const failed = results.filter((result) => result.status === 'fail' && byId.has(result.id)
    && (!result.rerunAloneResult || result.rerunAloneResult.status === 'fail'));
  const selected = [];
  const suppressed = [];
  for (const result of failed) {
    const setting = byId.get(result.id);
    const conflict = selected.find((prior) => settingsConflict(setting, byId.get(prior.id), metadata));
    if (conflict) suppressed.push({
      id: result.id, setting: setting.key, value: setting.value,
      expected: result.batchResult?.expected, actual: result.batchResult?.actual,
      screenshot: result.batchResult?.screenshot, retainedInstead: conflict.id,
    });
    else selected.push(result);
  }
  return { selected, suppressed };
}

export async function executeSettingBatches({ settings, metadata = {}, adapter, finalState = 'restore' }) {
  if (!['restore', 'retain-tested-values'].includes(finalState)) throw new Error(`Unsupported batch final state: ${finalState}`);
  if (!adapter || typeof adapter.save !== 'function' || typeof adapter.check !== 'function'
    || typeof adapter.apply !== 'function' || (finalState === 'restore' && typeof adapter.restore !== 'function')) {
    throw new Error('批量保存适配器缺少 apply、save、check，或 restore 模式所需的 restore。');
  }
  const plan = planSettingBatches(settings, metadata);
  const startedAt = new Date().toISOString();
  const clockStart = performance.now();
  const snapshots = await adapter.capture?.(settings) || new Map();
  const changed = new Set();
  const results = [];
  const timing = { startedAt, batches: [], restore: null, baselineCheck: null };
  const save = async (reason, timingTarget) => {
    const start = performance.now();
    await adapter.save({ reason });
    if (timingTarget) timingTarget.saveMs = (timingTarget.saveMs || 0) + performance.now() - start;
  };
  const safeCheck = async (setting, phase, batchInfo) => {
    const start = performance.now();
    try {
      const outcome = await adapter.check(setting, { phase, snapshot: snapshots.get?.(setting.id) ?? snapshots[setting.id] });
      batchInfo.checkMs += performance.now() - start;
      return { ...outcome, status: outcomeStatus(outcome) };
    } catch (error) {
      batchInfo.checkMs += performance.now() - start;
      return { status: 'fail', detail: error.message, error: error.message };
    }
  };
  const restoreIds = async (ids, reason, timingTarget) => {
    let restoredAny = false;
    const errors = [];
    for (const id of ids) {
      const setting = settings.find((item) => item.id === id);
      if (!setting || !changed.has(id)) continue;
      try {
        await adapter.restore(setting, { snapshot: snapshots.get?.(id) ?? snapshots[id], reason });
        changed.delete(id);
        restoredAny = true;
      } catch (error) { errors.push(`${id}: ${error.message}`); }
    }
    if (restoredAny) await save(reason, timingTarget);
    if (errors.length) throw new Error(`批量恢复未完整完成：${errors.join('；')}`);
    return restoredAny;
  };

  try {
    for (const [index, batch] of plan.entries()) {
      const batchInfo = { index, settingIds: batch.settings.map((item) => item.id), restoreBefore: batch.restoreBefore,
        saveMs: 0, applyMs: 0, checkMs: 0, totalMs: 0 };
      timing.batches.push(batchInfo);
      const batchStart = performance.now();
      if (finalState === 'restore') {
        await restoreIds(batch.restoreBefore.flatMap((key) => settings.filter((item) => item.key === key).map((item) => item.id)),
          `dependency-baseline-before-batch-${index}`, batchInfo);
      } else if (batch.restoreBefore.length) {
        throw new Error(`Fresh-block batch ${index} requires baseline restoration (${batch.restoreBefore.join(', ')}); refusing a baseline-dependent check in no-restore mode.`);
      }
      const applyErrors = new Map();
      for (const setting of batch.settings) {
        const start = performance.now();
        // An adapter may mutate the UI before a later action throws. Mark the
        // setting dirty before entering it so the finally path still restores
        // that partial change.
        changed.add(setting.id);
        try {
          await adapter.apply(setting, { snapshot: snapshots.get?.(setting.id) ?? snapshots[setting.id], phase: 'batch' });
        } catch (error) { applyErrors.set(setting.id, error); }
        batchInfo.applyMs += performance.now() - start;
      }
      if (batch.settings.some((item) => changed.has(item.id))) await save(`batch-${index}`, batchInfo);
      const batchOutcomes = new Map();
      for (const setting of batch.settings) {
        batchOutcomes.set(setting.id, applyErrors.has(setting.id)
          ? { status: 'fail', detail: applyErrors.get(setting.id).message, error: applyErrors.get(setting.id).message }
          : await safeCheck(setting, 'batch', batchInfo));
      }
      const failed = batch.settings.filter((setting) => outcomeStatus(batchOutcomes.get(setting.id)) === 'fail');
      if (!failed.length) {
        for (const setting of batch.settings) results.push({ id: setting.id, status: outcomeStatus(batchOutcomes.get(setting.id)),
          batchResult: batchOutcomes.get(setting.id) });
      } else {
        if (finalState === 'restore') await restoreIds(batch.settings.map((item) => item.id), `failed-batch-${index}-reset`, batchInfo);
        for (const setting of failed) {
          const isolated = { saveMs: 0, applyMs: 0, checkMs: 0 };
          let rerun;
          try {
            const start = performance.now();
            changed.add(setting.id);
            await adapter.apply(setting, { snapshot: snapshots.get?.(setting.id) ?? snapshots[setting.id], phase: 'rerun-alone' });
            isolated.applyMs += performance.now() - start;
            await save(`rerun-alone-${setting.id}`, isolated);
            rerun = await safeCheck(setting, 'rerun-alone', isolated);
          } catch (error) { rerun = { status: 'fail', detail: error.message, error: error.message }; }
          if (finalState === 'restore') {
            try { await restoreIds([setting.id], `rerun-alone-${setting.id}-restore`, isolated); }
            catch (error) { rerun = { ...rerun, restoreError: error.message, status: 'fail' }; }
          }
          results.push({ id: setting.id, status: 'fail', batchResult: batchOutcomes.get(setting.id), rerunAloneResult: rerun });
          batchInfo.rerunAlone = { ...(batchInfo.rerunAlone || {}), [setting.id]: isolated };
        }
        const passingPeers = finalState === 'restore'
          ? batch.settings.filter((setting) => !failed.some((item) => item.id === setting.id)) : [];
        for (const setting of passingPeers) {
          const start = performance.now();
          await adapter.apply(setting, { snapshot: snapshots.get?.(setting.id) ?? snapshots[setting.id], phase: 'batch-continue' });
          batchInfo.applyMs += performance.now() - start;
          changed.add(setting.id);
        }
        if (passingPeers.length) await save(`batch-${index}-continue`, batchInfo);
        for (const setting of passingPeers) results.push({ id: setting.id, status: outcomeStatus(batchOutcomes.get(setting.id)),
          batchResult: batchOutcomes.get(setting.id) });
      }
      batchInfo.totalMs = performance.now() - batchStart;
    }
  } finally {
    const restoreStart = performance.now();
    const restoreIdsInOrder = settings.filter((item) => changed.has(item.id)).map((item) => item.id).reverse();
    if (finalState === 'restore') {
      try {
        if (restoreIdsInOrder.length) await restoreIds(restoreIdsInOrder, 'final-restore', timing.restore = { settingIds: restoreIdsInOrder });
      } catch (error) {
        timing.restore ||= { settingIds: restoreIdsInOrder };
        timing.restore.error = error.message;
        for (const setting of settings) {
          const existing = results.find((item) => item.id === setting.id);
          if (existing) { existing.status = 'fail'; existing.restoreError = error.message; }
        }
      }
      if (timing.restore) timing.restore.totalMs = performance.now() - restoreStart;
    } else {
      const retained = selectRetainedFailures(results, settings, metadata);
      timing.retainedFailures = { selectedIds: retained.selected.map((item) => item.id), suppressed: retained.suppressed };
      try {
        for (const result of retained.selected) {
          const setting = settings.find((item) => item.id === result.id);
          await adapter.apply(setting, { phase: 'retain-failure' });
          changed.add(setting.id);
        }
        if (retained.selected.length) {
          timing.retainedFailures.saveMs = 0;
          await save('retain-failing-settings', timing.retainedFailures);
        }
      } catch (error) {
        timing.retainedFailures.error = error.message;
        for (const setting of settings) {
          const existing = results.find((item) => item.id === setting.id);
          if (existing?.status === 'fail') existing.retentionError = error.message;
        }
      }
    }
    if (finalState === 'restore' && adapter.checkBaseline) {
      const checkStart = performance.now();
      try { timing.baselineCheck = await adapter.checkBaseline(); }
      catch (error) { timing.baselineCheck = { status: 'fail', error: error.message }; }
      timing.baselineCheckMs = performance.now() - checkStart;
    }
  }
  timing.finishedAt = new Date().toISOString();
  timing.durationMs = performance.now() - clockStart;
  const detailedResults = results.map((result) => {
    const setting = settings.find((item) => item.id === result.id);
    return { ...result, setting: setting?.label || setting?.key || result.id, value: setting?.value,
      expected: result.batchResult?.expected ?? result.rerunAloneResult?.expected ?? setting?.expected,
      actual: result.batchResult?.actual ?? result.rerunAloneResult?.actual };
  });
  return { batches: plan.map(({ settings: items, restoreBefore }) => ({ settingIds: items.map((item) => item.id), restoreBefore })),
    results: detailedResults, timing };
}
