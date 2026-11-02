import test from 'node:test';
import assert from 'node:assert/strict';
import { executeSettingBatches, planSettingBatches, verifyBaselineWithRecovery } from '../src/batch-save.mjs';
import { runCapabilityLayer } from '../src/run.mjs';

test('batch planner groups unrelated settings and separates declared dependencies', () => {
  const settings = [
    { id: 'source-check', key: 'source' },
    { id: 'size-check', key: 'size' },
    { id: 'compare-check', key: 'compare' },
    { id: 'pagination-check', key: 'pagination' },
  ];
  const batches = planSettingBatches(settings, {
    size: { interferesWith: ['pagination'] },
    pagination: { interferesWith: ['size'], requiresBaseline: ['size'] },
  });
  assert.deepEqual(batches.map((batch) => batch.settings.map((item) => item.id)), [
    ['source-check', 'size-check', 'compare-check'], ['pagination-check'],
  ]);
  assert.deepEqual(batches.map((batch) => batch.restoreBefore), [[], ['size']]);
});

test('final baseline verification relaunches through recovery after a stale-page read error', async () => {
  const events = [];
  const outcome = await verifyBaselineWithRecovery({
    verify: async () => { events.push('verify-stale-page'); throw new Error('settings dialog did not open'); },
    recover: async () => { events.push('relaunch-and-guard'); return { baselineVerification: { residue: false } }; },
  });
  assert.deepEqual(events, ['verify-stale-page', 'relaunch-and-guard']);
  assert.deepEqual(outcome, { check: { residue: false }, recovered: true });
});

test('final baseline verification retries the check if recovery has no guard result', async () => {
  let calls = 0;
  const outcome = await verifyBaselineWithRecovery({
    verify: async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient UI read');
      return { residue: false };
    },
    recover: async () => ({}),
  });
  assert.equal(calls, 2);
  assert.deepEqual(outcome, { check: { residue: false }, recovered: true });
});

test('batch executor saves once per batch, restores the final changed set once, and checks baseline', async () => {
  const events = [];
  const settings = [{ id: 'alpha', key: 'alpha' }, { id: 'beta', key: 'beta' }];
  const run = await executeSettingBatches({ settings, adapter: {
    capture: async () => new Map([['alpha', 'a0'], ['beta', 'b0']]),
    apply: async (setting) => events.push(`apply:${setting.id}`),
    save: async ({ reason }) => events.push(`save:${reason}`),
    check: async (setting) => { events.push(`check:${setting.id}`); return { status: 'pass' }; },
    restore: async (setting) => events.push(`restore:${setting.id}`),
    checkBaseline: async () => { events.push('baseline'); return { residue: false }; },
  } });
  assert.deepEqual(run.batches, [{ settingIds: ['alpha', 'beta'], restoreBefore: [] }]);
  assert.deepEqual(run.results.map(({ id, status }) => [id, status]), [['alpha', 'pass'], ['beta', 'pass']]);
  assert.deepEqual(events, [
    'apply:alpha', 'apply:beta', 'save:batch-0', 'check:alpha', 'check:beta',
    'restore:beta', 'restore:alpha', 'save:final-restore', 'baseline',
  ]);
  assert.equal(run.timing.baselineCheck.residue, false);
});

test('failed batch check is rerun alone and both outcomes are retained', async () => {
  const events = [];
  const checks = new Map();
  const settings = [{ id: 'independent-a', key: 'a' }, { id: 'independent-b', key: 'b' }];
  const run = await executeSettingBatches({ settings, adapter: {
    capture: async () => new Map(settings.map(({ id }) => [id, `base:${id}`])),
    apply: async (setting, { phase }) => events.push(`apply:${setting.id}:${phase}`),
    save: async ({ reason }) => events.push(`save:${reason}`),
    check: async (setting, { phase }) => {
      events.push(`check:${setting.id}:${phase}`);
      const count = (checks.get(setting.id) || 0) + 1;
      checks.set(setting.id, count);
      return setting.id === 'independent-b' && phase === 'batch'
        ? { status: 'fail', detail: 'batch interaction observed' }
        : { status: 'pass', detail: `${phase} passed` };
    },
    restore: async (setting, { reason }) => events.push(`restore:${setting.id}:${reason}`),
    checkBaseline: async () => { events.push('baseline'); return { residue: false }; },
  } });
  const b = run.results.find((item) => item.id === 'independent-b');
  assert.equal(b.status, 'fail');
  assert.equal(b.batchResult.status, 'fail');
  assert.equal(b.rerunAloneResult.status, 'pass');
  assert.ok(events.includes('check:independent-b:rerun-alone'));
  assert.equal(events.filter((event) => event.startsWith('restore:independent-a:final-restore')).length, 1);
  assert.equal(events.at(-1), 'baseline');
});

test('retain mode reports passing peers when one member of their saved batch fails', async () => {
  const settings = [{ id: 'peer-pass', key: 'left', value: 'changed' },
    { id: 'peer-fail', key: 'right', value: 'changed' }];
  const run = await executeSettingBatches({ settings, finalState: 'retain-tested-values', adapter: {
    apply: async () => {}, save: async () => {},
    check: async (setting) => setting.id === 'peer-fail'
      ? { status: 'fail', expected: 'wanted', actual: 'observed' }
      : { status: 'pass', expected: 'changed', actual: 'changed' },
  } });
  assert.deepEqual(run.results.map(({ id, status }) => [id, status]), [
    ['peer-fail', 'fail'], ['peer-pass', 'pass'],
  ]);
  assert.equal(run.results.find(({ id }) => id === 'peer-pass').batchResult.actual, 'changed');
});

test('retain mode restores required dependencies between checks then reapplies the selected failing value', async () => {
  const events = [];
  const values = {};
  const settings = [
    { id: 'source-check', key: 'source', value: 'category', initialValue: 'all' },
    { id: 'quantity-check', key: 'quantity', value: 10, initialValue: 20 },
    { id: 'pagination-check', key: 'pagination', value: true, initialValue: false },
  ];
  const run = await executeSettingBatches({ settings, metadata: {
    source: { interferesWith: ['pagination'] },
    quantity: { interferesWith: ['pagination'] },
    pagination: { interferesWith: ['source', 'quantity'], requiresBaseline: ['source', 'quantity'] },
  }, finalState: 'retain-tested-values', adapter: {
    capture: async (items) => new Map(items.map((item) => [item.id, item.initialValue])),
    apply: async (setting, { phase }) => { values[setting.key] = setting.value; events.push(`apply:${setting.key}:${phase}`); },
    restore: async (setting) => { values[setting.key] = setting.initialValue; events.push(`restore:${setting.key}`); },
    save: async ({ reason }) => events.push(`save:${reason}`),
    check: async (setting, { phase }) => {
      events.push(`check:${setting.key}:${phase}`);
      return setting.key === 'source' ? { status: 'fail', expected: 'all', actual: 'category' } : { status: 'pass' };
    },
  } });
  assert.deepEqual(run.batches.map((batch) => batch.restoreBefore), [[], ['source', 'quantity']]);
  assert.ok(events.indexOf('restore:source') < events.indexOf('check:pagination:batch'));
  assert.ok(events.indexOf('apply:source:retain-failure') > events.indexOf('check:pagination:batch'));
  assert.equal(values.source, 'category');
  assert.equal(values.quantity, 20);
  assert.equal(values.pagination, true);
  assert.deepEqual(run.timing.retainedFailures.selectedIds, ['source-check']);
});

test('retain mode rejects dependency restoration before applying when restore adapter is absent', async () => {
  const events = [];
  await assert.rejects(executeSettingBatches({ settings: [{ id: 'a', key: 'a' }, { id: 'b', key: 'b' }],
    metadata: { b: { requiresBaseline: ['a'] } }, finalState: 'retain-tested-values', adapter: {
      apply: async () => events.push('apply'), save: async () => {}, check: async () => ({ status: 'pass' }),
    } }), /没有 restore 适配器/);
  assert.deepEqual(events, []);
});

test('runner selects the capability batch entry only when BATCH_SAVE is enabled', async () => {
  const calls = [];
  const module = {
    runSettingsLayer: async () => { calls.push('individual'); return []; },
    runBatchSettingsLayer: async () => { calls.push('batch'); return []; },
  };
  await runCapabilityLayer([{ id: 'sample' }], 'settings', { config: { batchSave: false }, report: {} }, { sample: module });
  await runCapabilityLayer([{ id: 'sample' }], 'settings', { config: { batchSave: true }, report: {} }, { sample: module });
  assert.deepEqual(calls, ['individual', 'batch']);
});

test('final restoration attempts every changed setting and still runs baseline verification after an error', async () => {
  const events = [];
  const settings = [{ id: 'first', key: 'first' }, { id: 'second', key: 'second' }];
  const run = await executeSettingBatches({ settings, adapter: {
    capture: async () => new Map(),
    apply: async (setting) => events.push(`apply:${setting.id}`),
    save: async ({ reason }) => events.push(`save:${reason}`),
    check: async () => ({ status: 'pass' }),
    restore: async (setting) => {
      events.push(`restore:${setting.id}`);
      if (setting.id === 'second') throw new Error('simulated restore fault');
    },
    checkBaseline: async () => { events.push('baseline'); return { residue: true }; },
  } });
  assert.ok(events.includes('restore:second'));
  assert.ok(events.includes('restore:first'));
  assert.ok(events.includes('baseline'));
  assert.match(run.timing.restore.error, /second: simulated restore fault/);
  assert.ok(run.results.every((item) => item.status === 'fail'));
});

test('a setting that throws after a partial apply is still restored before final verification', async () => {
  const events = [];
  const run = await executeSettingBatches({ settings: [{ id: 'partial', key: 'partial' }], adapter: {
    capture: async () => new Map(),
    apply: async () => { events.push('apply'); throw new Error('failed after changing the control'); },
    save: async ({ reason }) => events.push(`save:${reason}`),
    check: async () => { events.push('check'); return { status: 'pass' }; },
    restore: async () => events.push('restore'),
    checkBaseline: async () => { events.push('baseline'); return { residue: false }; },
  } });
  assert.ok(events.includes('restore'));
  assert.ok(events.includes('save:failed-batch-0-reset'));
  assert.ok(events.includes('baseline'));
  assert.equal(run.results[0].status, 'fail');
  assert.equal(run.results[0].rerunAloneResult.status, 'fail');
  assert.equal(events.includes('check'), false);
});

test('palette input readback mismatch survives as a structured failed batch result', async () => {
  const run = await executeSettingBatches({ settings: [{ id: 'palette', key: 'palette', initialValue: '#123456' }],
    adapter: { capture: async () => new Map(), apply: async () => {
      const error = new Error('readback mismatch'); error.code = 'palette-write-readback-mismatch';
      error.paletteReadback = { setValue: '#abcdef', readBackValue: '#000000', matched: false };
      throw error;
    }, save: async () => {}, check: async () => ({ status: 'pass' }), restore: async () => {} } });
  assert.equal(run.results[0].status, 'fail');
  assert.equal(run.results[0].batchResult.reason.code, 'palette-write-readback-mismatch');
  assert.deepEqual(run.results[0].batchResult.evidence.paletteWrite,
    { setValue: '#abcdef', readBackValue: '#000000', matched: false });
});
