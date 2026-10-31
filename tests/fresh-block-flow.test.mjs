import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFreshReport, diffFreshDefaults, matchMarkedInstances, parseFreshPageConfig,
  runFreshBlockFlow } from '../src/fresh-block-flow.mjs';
import { selectRetainedFailures } from '../src/batch-save.mjs';

const marker = 'autotest:catalog-smoke';

function fakeAdapter(initialInstances = []) {
  const events = [];
  const state = { instances: structuredClone(initialInstances), values: {}, snapshots: null, report: null };
  const batchAdapter = {
    capture: async (settings) => { state.snapshots = new Map(settings.map((item) => [item.id, null])); return state.snapshots; },
    apply: async (setting, { phase }) => { events.push(['apply', setting.id, phase]); state.values[setting.key] = setting.value; },
    restore: async (setting) => { events.push(['restore', setting.id]); delete state.values[setting.key]; },
    save: async ({ reason }) => events.push(['save', reason]),
    check: async (setting) => ({ status: setting.expectedStatus || 'pass', expected: setting.expected,
      actual: setting.actual, screenshot: setting.screenshot, detail: setting.detail }),
  };
  return { events, state, batchAdapter,
    openPage: async (page) => { events.push(['openPage', page.kind]); return { editorLink: '/editor' }; },
    listBlockInstances: async () => structuredClone(state.instances),
    deleteMarkedBlock: async (instance) => {
      events.push(['delete', instance.marker]);
      state.instances = state.instances.filter((item) => item !== instance && item.marker !== instance.marker);
    },
    addDefaultBlock: async (blockId) => {
      const instance = { blockId: String(blockId), settingId: 'new-instance', position: { x: 0, y: 100 } };
      state.instances.push(instance); events.push(['add', blockId]); return instance;
    },
    setMarker: async (instance, value) => { instance.marker = value; const target = state.instances.find((item) => item.settingId === instance.settingId); target.marker = value; },
    savePage: async () => events.push(['savePage']), reloadPage: async () => events.push(['reloadPage']),
    readDefaults: async () => [{ controlIdentity: 'dialog:text:heading', label: 'Heading', value: 'Default' }],
    readDefaultsSnapshot: async () => null,
    writeDefaultsSnapshot: async (_path, snapshot) => { state.defaults = snapshot; },
    readCurrentValues: async () => Object.entries(state.values).map(([key, value]) => ({ key, value })),
    publishPage: async () => { events.push(['publish']); return { frontLink: '/public', publishedAt: 'now' }; },
    writeReport: async (report) => { state.report = report; },
  };
}

const config = { page: { kind: 'custom', name: 'Catalog test' }, siteHost: 'example.test', blockId: '55', marker,
  projectRoot: '/tmp/fresh-flow-test' };

test('fresh flow requires explicit custom or system page configuration', () => {
  assert.throws(() => parseFreshPageConfig({}), /FRESH_PAGE_KIND/);
  assert.throws(() => parseFreshPageConfig({ FRESH_PAGE_KIND: 'custom' }), /FRESH_PAGE_NAME/);
  assert.throws(() => parseFreshPageConfig({ FRESH_PAGE_KIND: 'system', FRESH_PAGE_ID: 'p1' }), /FRESH_PAGE_URL/);
  assert.deepEqual(parseFreshPageConfig({ FRESH_PAGE_KIND: 'system', FRESH_PAGE_ID: 'p1', FRESH_PAGE_URL: '/products' }),
    { kind: 'system', id: 'p1', url: '/products' });
});

test('flow refuses to start before opening an editor when page choice is absent', async () => {
  let opened = false;
  await assert.rejects(runFreshBlockFlow({ config: { siteHost: 'h', blockId: 'b', marker },
    adapter: { openPage: async () => { opened = true; } }, settings: [] }), /explicit page config/);
  assert.equal(opened, false);
});

test('marker matching accepts zero or one and refuses multiple or ambiguous matches', () => {
  assert.equal(matchMarkedInstances([{ marker: 'other' }], marker), null);
  const one = { marker };
  assert.equal(matchMarkedInstances([one, { marker: 'other' }], marker), one);
  assert.throws(() => matchMarkedInstances([{ marker }, { marker }], marker), /no block will be deleted/);
  assert.throws(() => matchMarkedInstances([{ marker: 'other', markerAmbiguous: true }], marker), /ambiguous/);
});

test('only the marked instance is deleted; an unmarked block is preserved', async () => {
  const adapter = fakeAdapter([{ blockId: '55', settingId: 'unmarked', marker: null },
    { blockId: '55', settingId: 'old-test', marker }]);
  const report = await runFreshBlockFlow({ config, adapter, settings: [] });
  assert.deepEqual(adapter.events.filter(([kind]) => kind === 'delete'), [['delete', marker]]);
  assert.ok(adapter.state.instances.some((item) => item.settingId === 'unmarked'));
  assert.equal(adapter.state.instances.filter((item) => item.marker === marker).length, 1);
  assert.equal(report.block.settingId, 'new-instance');
});

test('fresh flow stops without deletion when marker matches more than one instance', async () => {
  const adapter = fakeAdapter([{ blockId: '55', settingId: 'one', marker }, { blockId: '55', settingId: 'two', marker }]);
  await assert.rejects(runFreshBlockFlow({ config, adapter, settings: [] }), /no block will be deleted/);
  assert.equal(adapter.events.some(([kind]) => kind === 'delete'), false);
  assert.equal(adapter.events.some(([kind]) => kind === 'add'), false);
});

test('marker must survive save and reload or settings stay unrun and only the new instance is cleaned up', async () => {
  const adapter = fakeAdapter();
  const removeCreated = [];
  const originalReload = adapter.reloadPage;
  adapter.reloadPage = async () => {
    await originalReload();
    delete adapter.state.instances.find((item) => item.settingId === 'new-instance').marker;
  };
  adapter.deleteCreatedBlock = async (instance) => removeCreated.push(instance.settingId);
  await assert.rejects(runFreshBlockFlow({ config, adapter, settings: [{ id: 'x', key: 'x', value: true }] }), /marker could not be read back/);
  assert.deepEqual(removeCreated, ['new-instance']);
  assert.equal(adapter.events.some(([kind]) => kind === 'apply'), false);
});

test('interfering failed settings retain one failure and report the suppressed value/evidence', () => {
  const settings = [{ id: 'a', key: 'source', value: 'chosen' }, { id: 'b', key: 'source', value: 'other' },
    { id: 'c', key: 'color', value: 'red' }];
  const results = settings.map((item) => ({ id: item.id, status: 'fail', setting: item.key, value: item.value,
    batchResult: { expected: 'expected', actual: 'actual', screenshot: `${item.id}.png` } }));
  const selected = selectRetainedFailures(results, settings, { source: { interferesWith: ['source-variant'] },
    'source-variant': { interferesWith: ['source'] } });
  // The metadata keys identify setting keys; duplicate keys already conflict.
  assert.deepEqual(selected.selected.map((item) => item.id), ['a', 'c']);
  assert.deepEqual(selected.suppressed, [{ id: 'b', setting: 'source', value: 'other', expected: 'expected',
    actual: 'actual', screenshot: 'b.png', retainedInstead: 'a' }]);
});

test('all-pass fresh run leaves the last batch values and publishes without baseline restoration', async () => {
  const adapter = fakeAdapter();
  const report = await runFreshBlockFlow({ config, adapter,
    settings: [{ id: 'first', key: 'first', value: 'on' }, { id: 'last', key: 'last', value: 'two' }] });
  assert.deepEqual(adapter.state.values, { first: 'on', last: 'two' });
  assert.equal(adapter.events.some(([kind]) => kind === 'restore'), false);
  assert.ok(adapter.events.some(([kind]) => kind === 'publish'));
  assert.equal(report.links.front, '/public');
});

test('fresh batch mode reruns failures alone, retains failing values, and never restores defaults', async () => {
  const events = [];
  const settings = [{ id: 'bad', key: 'setting', value: 'bad-value', expectedStatus: 'fail', expected: 'good', actual: 'bad' }];
  const run = await import('../src/batch-save.mjs').then(({ executeSettingBatches }) => executeSettingBatches({
    settings, adapter: { capture: async () => new Map(), apply: async (setting, meta) => events.push(['apply', meta.phase]),
      save: async ({ reason }) => events.push(['save', reason]), restore: async () => events.push(['restore']),
      check: async (_setting, { phase }) => ({ status: 'fail', expected: 'good', actual: 'bad', phase }) },
    finalState: 'retain-tested-values',
  }));
  assert.equal(events.some(([kind]) => kind === 'restore'), false);
  assert.ok(events.some(([kind, phase]) => kind === 'apply' && phase === 'rerun-alone'));
  assert.ok(events.some(([kind, reason]) => kind === 'save' && reason === 'retain-failing-settings'));
  assert.deepEqual(run.timing.retainedFailures.selectedIds, ['bad']);
  assert.equal(run.results[0].rerunAloneResult.status, 'fail');
});

test('failed fresh setting remains on its failing value and the page is published', async () => {
  const adapter = fakeAdapter();
  const report = await runFreshBlockFlow({ config, adapter, settings: [
    { id: 'wrong', key: 'display', value: 'wrong-value', expectedStatus: 'fail', expected: 'expected', actual: 'actual' },
  ] });
  assert.equal(adapter.state.values.display, 'wrong-value');
  assert.ok(adapter.events.some(([kind]) => kind === 'publish'));
  assert.equal(report.failures[0].value, 'wrong-value');
});

test('changed defaults are reported as informational differences', () => {
  const diff = diffFreshDefaults({ values: [{ controlIdentity: 'x', label: 'Width', value: '100' }] },
    [{ controlIdentity: 'x', label: 'Width', value: '120' }, { controlIdentity: 'y', label: 'New', value: true }]);
  assert.equal(diff.firstCapture, false);
  assert.deepEqual(diff.changes.map((item) => [item.kind, item.controlIdentity]), [['changed', 'x'], ['added', 'y']]);
  assert.deepEqual(diffFreshDefaults(null, []).changes, []);
});

test('fresh report carries links, current values, failure evidence, and default warnings', () => {
  const report = buildFreshReport({ runId: 'r1', siteHost: 'h', blockId: 'b', page: config.page, marker,
    markedInstance: { settingId: 'sid', position: { y: 3 } }, defaults: { firstCapture: false, changes: [{ kind: 'changed' }] },
    batch: { batches: [], results: [{ id: 'check', status: 'fail', batchResult: { expected: 'yes', actual: 'no', screenshot: 'shot.png' } }],
      timing: { retainedFailures: { selectedIds: ['check'], suppressed: [] } } },
    currentValues: [{ key: 'x', value: 'v' }], editorLink: '/e', frontLink: '/f', publishedAt: 'time' });
  assert.equal(report.block.settingId, 'sid');
  assert.deepEqual(report.block.currentValues, [{ key: 'x', value: 'v' }]);
  assert.equal(report.failures[0].expected, 'yes');
  assert.equal(report.failures[0].screenshot, 'shot.png');
  assert.deepEqual(report.links, { editor: '/e', front: '/f' });
  assert.deepEqual(report.defaults.changes, [{ kind: 'changed' }]);
});
