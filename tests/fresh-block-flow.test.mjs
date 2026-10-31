import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFreshReport, diffFreshDefaults, targetBlockInstances, parseFreshPageConfig,
  runFreshBlockFlow } from '../src/fresh-block-flow.mjs';
import { selectRetainedFailures } from '../src/batch-save.mjs';
import { createFreshSettingsAdapter, currentValuesFromInventory } from '../src/fresh-settings-adapter.mjs';
import { matchingDeleteActionIndexes, matchingDeleteActionMatches, matchingDeleteConfirmIndexes,
  matchingDeleteConfirmMatches, waitForUniqueDeleteAction } from '../src/fresh-editor-actions.mjs';
import { freshSettings as productListFreshSettings } from '../src/capabilities/product-list-display.mjs';
import { planDeclaredFreshSettings } from '../src/fresh-plan.mjs';

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
    listAllBlockInstances: async () => structuredClone(state.instances),
    deleteBlockInstance: async (instance) => {
      events.push(['delete', instance.blockId, instance.settingId]);
      state.instances = state.instances.filter((item) => item.settingId !== instance.settingId);
    },
    addDefaultBlock: async (blockId) => {
      const instance = { blockId: String(blockId), settingId: 'new-instance', position: { x: 0, y: 100 } };
      state.instances.push(instance); events.push(['add', blockId]); return instance;
    },
    savePage: async () => events.push(['savePage']), reloadPage: async () => events.push(['reloadPage']),
    readDefaults: async () => [{ controlIdentity: 'dialog:text:heading', label: 'Heading', value: 'Default' }],
    readDefaultsSnapshot: async () => null,
    writeDefaultsSnapshot: async (_path, snapshot) => { state.defaults = snapshot; },
    readCurrentValues: async () => Object.entries(state.values).map(([key, value]) => ({ key, value })),
    publishPage: async () => { events.push(['publish']); return { frontLink: '/public', publishedAt: 'now' }; },
    writeReport: async (report) => { state.report = report; },
  };
}

const config = { page: { kind: 'custom', name: 'Catalog test' }, siteHost: 'example.test', blockId: '55',
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
  await assert.rejects(runFreshBlockFlow({ config: { siteHost: 'h', blockId: 'b' },
    adapter: { openPage: async () => { opened = true; } }, settings: [] }), /explicit page config/);
  assert.equal(opened, false);
});

test('target block matching uses only the block number', () => {
  const items = [{ blockId: '55', settingId: 'a' }, { blockId: '56', settingId: 'b' }];
  assert.deepEqual(targetBlockInstances(items, '55'), [items[0]]);
  assert.deepEqual(targetBlockInstances(items, '57'), []);
  assert.throws(() => targetBlockInstances(items, ''), /block number/);
});

test('deletes every instance of the target number and preserves all other block numbers', async () => {
  const adapter = fakeAdapter([{ blockId: '55', settingId: 'old-one', ordinal: 0 },
    { blockId: '56', settingId: 'unrelated', ordinal: 0 }, { blockId: '55', settingId: 'old-two', ordinal: 1 }]);
  const progress = [];
  const report = await runFreshBlockFlow({ config, adapter, settings: [], onProgress: async (event) => progress.push(event) });
  assert.deepEqual(adapter.events.filter(([kind]) => kind === 'delete'), [['delete', '55', 'old-one'], ['delete', '55', 'old-two']]);
  assert.ok(adapter.state.instances.some((item) => item.settingId === 'unrelated'));
  assert.equal(adapter.state.instances.filter((item) => item.blockId === '55').length, 1);
  assert.equal(report.block.settingId, 'new-instance');
  assert.deepEqual(report.lifecycle, { deletedSettingIds: ['old-one', 'old-two'], addedSettingId: 'new-instance' });
  assert.deepEqual(adapter.events.filter(([kind]) => kind === 'delete').map((event) => event[2]), ['old-one', 'old-two']);
  assert.deepEqual(progress.filter((event) => event.stage === 'instance-deleted').map(({ deletedSettingId }) => deletedSettingId), ['old-one', 'old-two']);
  assert.ok(progress.some((event) => event.stage === 'instance-added' && event.settingId === 'new-instance'));
});

test('stops before adding if a target instance delete did not remove exactly one', async () => {
  const adapter = fakeAdapter([{ blockId: '55', settingId: 'old', ordinal: 0 }]);
  adapter.deleteBlockInstance = async (instance) => adapter.events.push(['unexpected-delete-noop', instance.settingId]);
  await assert.rejects(runFreshBlockFlow({ config, adapter, settings: [] }), /did not remove exactly/);
  assert.equal(adapter.events.some(([kind]) => kind === 'add'), false);
});

test('duplicate target instance identity refuses all deletion', async () => {
  const adapter = fakeAdapter([{ blockId: '55', settingId: 'duplicate', ordinal: 0 },
    { blockId: '55', settingId: 'duplicate', ordinal: 1 }]);
  await assert.rejects(runFreshBlockFlow({ config, adapter, settings: [] }), /unique settingId/);
  assert.equal(adapter.events.some(([kind]) => kind === 'delete'), false);
  assert.equal(adapter.events.some(([kind]) => kind === 'add'), false);
});

test('stops if a delete changes an unmarked different block number', async () => {
  const adapter = fakeAdapter([{ blockId: '55', settingId: 'old', ordinal: 0 }, { blockId: '56', settingId: 'keep', ordinal: 0 }]);
  const original = adapter.deleteBlockInstance;
  adapter.deleteBlockInstance = async (instance) => {
    await original(instance);
    adapter.state.instances = adapter.state.instances.filter((item) => item.settingId !== 'keep');
  };
  await assert.rejects(runFreshBlockFlow({ config, adapter, settings: [] }), /non-target block number changed/);
  assert.equal(adapter.events.some(([kind]) => kind === 'add'), false);
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

test('fresh batch execution error stops before publish and records the unpublished state', async () => {
  const adapter = fakeAdapter();
  adapter.batchAdapter.save = async () => { throw new Error('editor save control unavailable'); };
  const report = await runFreshBlockFlow({ config, adapter, settings: [
    { id: 'setting', key: 'setting', value: 'changed' },
  ] });
  assert.equal(adapter.events.some(([kind]) => kind === 'publish'), false);
  assert.equal(report.publishedAt, null);
  assert.ok(report.flowErrors.some(({ stage, message }) => stage === 'publish' && /Skipped/.test(message)));
});

test('changed defaults are reported as informational differences', () => {
  const diff = diffFreshDefaults({ values: [{ controlIdentity: 'x', label: 'Width', value: '100' }] },
    [{ controlIdentity: 'x', label: 'Width', value: '120' }, { controlIdentity: 'y', label: 'New', value: true }]);
  assert.equal(diff.firstCapture, false);
  assert.deepEqual(diff.changes.map((item) => [item.kind, item.controlIdentity]), [['changed', 'x'], ['added', 'y']]);
  assert.deepEqual(diffFreshDefaults(null, []).changes, []);
});

test('fresh report carries links, current values, failure evidence, and default warnings', () => {
  const report = buildFreshReport({ runId: 'r1', siteHost: 'h', blockId: 'b', page: config.page,
    instance: { settingId: 'sid', position: { y: 3 } }, capabilities: [{ capability: 'unsupported', status: 'not-adapted' }],
    defaults: { firstCapture: false, changes: [{ kind: 'changed' }] },
    batch: { batches: [], results: [{ id: 'check', status: 'fail', batchResult: { expected: 'yes', actual: 'no', screenshot: 'shot.png' } }],
      timing: { retainedFailures: { selectedIds: ['check'], suppressed: [] } } },
    currentValues: [{ key: 'x', value: 'v' }], editorLink: '/e', frontLink: '/f', publishedAt: 'time' });
  assert.equal(report.block.settingId, 'sid');
  assert.deepEqual(report.block.currentValues, [{ key: 'x', value: 'v' }]);
  assert.equal(report.failures[0].expected, 'yes');
  assert.equal(report.failures[0].screenshot, 'shot.png');
  assert.deepEqual(report.links, { editor: '/e', front: '/f' });
  assert.deepEqual(report.defaults.changes, [{ kind: 'changed' }]);
  assert.deepEqual(report.capabilities, [{ capability: 'unsupported', status: 'not-adapted' }]);
  assert.deepEqual(report.lifecycle, { deletedSettingIds: [], addedSettingId: 'sid' });
  assert.equal(report.settingsMode, 'BATCH_SAVE / retain-tested-values');
});

test('declared fresh batch dry run prints dependency restore steps without reading a site', () => {
  const plan = planDeclaredFreshSettings({ settingKeys: ['source', 'quantity', 'pagination', 'comparison'], metadata: {
    source: { interferesWith: ['pagination'] },
    quantity: { interferesWith: ['pagination'] },
    pagination: { interferesWith: ['source', 'quantity'], requiresBaseline: ['source', 'quantity'] },
    comparison: {},
  } });
  assert.equal(plan.basis, 'declared-setting-keys; concrete controls are discovered in the editor');
  assert.deepEqual(plan.batches, [
    { index: 0, settingKeys: ['source', 'quantity', 'comparison'], restoreBefore: [] },
    { index: 1, settingKeys: ['pagination'], restoreBefore: ['source', 'quantity'] },
  ]);
});

test('shared fresh adapter reports unsupported capabilities explicitly and never counts them as checks', async () => {
  const adapter = await createFreshSettingsAdapter({ capabilities: ['legacy'],
    loadCapability: async () => ({ freshSettings: { status: 'not-adapted', reason: 'needs extraction' } }) });
  const prepared = await adapter.prepare();
  assert.deepEqual(prepared.settings, []);
  assert.deepEqual(prepared.capabilityResults, [{ capability: 'legacy', status: 'not-adapted', reason: 'needs extraction' }]);
});

test('shared fresh adapter batches adapted definitions through generic apply/save/check callbacks', async () => {
  const events = [];
  const adapter = await createFreshSettingsAdapter({ capabilities: [{ id: 'generic-cap' }],
    context: { save: async () => events.push('save') },
    loadCapability: async () => ({ freshSettings: { status: 'adapted', createDefinitions: async () => ({
      prepareSave: async () => events.push('prepare-save'), afterSave: async () => events.push('after-save'), settings: [
      { id: 'check-a', key: 'setting-a', initialValue: 'old', value: 'new', apply: async ({ phase }) => events.push(`apply:${phase}`),
        check: async () => ({ status: 'fail', expected: 'wanted', actual: 'observed', screenshot: 'evidence.png' }) },
    ] }) } }) });
  const prepared = await adapter.prepare();
  const execution = await (await import('../src/batch-save.mjs')).executeSettingBatches({
    settings: prepared.settings, metadata: prepared.metadata, adapter: prepared.batchAdapter, finalState: 'retain-tested-values' });
  assert.deepEqual(events, ['apply:batch', 'prepare-save', 'save', 'after-save', 'apply:rerun-alone',
    'prepare-save', 'save', 'after-save', 'apply:retain-failure', 'prepare-save', 'save', 'after-save']);
  assert.equal(execution.results[0].batchResult.screenshot, 'evidence.png');
  assert.equal(execution.results[0].rerunAloneResult.status, 'fail');
  assert.deepEqual(execution.timing.retainedFailures.selectedIds, ['check-a']);
});

test('product list fresh definitions expose existing batch metadata and dialog save lifecycle', async () => {
  assert.equal(productListFreshSettings.status, 'adapted');
  assert.equal(typeof productListFreshSettings.createDefinitions, 'function');
  assert.ok(productListFreshSettings.metadata['data-source']);
});

test('fresh setting definitions are prepared only after the fresh instance reloads', async () => {
  const adapter = fakeAdapter([{ blockId: '55', settingId: 'old-one', ordinal: 0 }]);
  adapter.prepareSettings = async () => {
    assert.ok(adapter.events.some(([kind]) => kind === 'reloadPage'));
    return { settings: [], staticResults: [], capabilityResults: [],
      batchAdapter: { capture: async () => new Map(), apply: async () => {}, save: async () => {}, check: async () => ({ status: 'pass' }) } };
  };
  const report = await runFreshBlockFlow({ config, adapter });
  assert.equal(report.block.settingId, 'new-instance');
});

test('current setting inventory records values with region and control identity', () => {
  assert.deepEqual(currentValuesFromInventory([{ type: 'gallery', title: 'Settings', wrapIndex: 1, controls: [
    { type: 'checkbox', label: 'Show name', value: 'name', checked: true },
    { type: 'text', label: 'Quantity', value: '12' },
    { type: 'password', label: 'API key', value: 'never-report-this' },
  ] }]), [
    { controlIdentity: 'gallery:1:Settings:checkbox:Show name:name:0', region: 'Settings', label: 'Show name', type: 'checkbox', value: true },
    { controlIdentity: 'gallery:1:Settings:text:Quantity:12:1', region: 'Settings', label: 'Quantity', type: 'text', value: '12' },
    { controlIdentity: 'gallery:1:Settings:password:API key:[redacted]:2', region: 'Settings', label: 'API key', type: 'password', value: '[redacted]' },
  ]);
});

test('delete locator requires target-instance identity plus exact delete label and icon', () => {
  const action = { dataId: 'siteblocks-setting-wrap-sid', text: '删除', iconClasses: ['icon-trash'], visible: true };
  assert.deepEqual(matchingDeleteActionIndexes([action], 'sid'), [0]);
  assert.deepEqual(matchingDeleteActionIndexes([{ ...action, dataId: 'siteblocks-setting-wrap-other' }], 'sid'), []);
  assert.deepEqual(matchingDeleteActionIndexes([{ ...action, text: '复制', iconClasses: ['icon-copy'] }], 'sid'), []);
  assert.deepEqual(matchingDeleteActionIndexes([{ ...action, visible: false }], 'sid'), []);
  assert.deepEqual(matchingDeleteActionIndexes([action, action], 'sid'), [0, 1]);
});

test('delete confirmation locator accepts only exact visible action labels', () => {
  assert.deepEqual(matchingDeleteConfirmIndexes([{ text: '确定', visible: true }]), [0]);
  assert.deepEqual(matchingDeleteConfirmIndexes([{ text: '确定删除页面', visible: true }]), []);
  assert.deepEqual(matchingDeleteConfirmIndexes([{ text: '删除', visible: false }]), []);
  assert.deepEqual(matchingDeleteConfirmMatches([{ name: 'dialog-frame', locator: 'confirm-locator',
    actions: [{ textContent: ' 删除 ', visible: true }] }]), [{ scope: 'dialog-frame', index: 0, locator: 'confirm-locator' }]);
});

test('delete locator reads the child DOM label when innerText is empty', () => {
  assert.deepEqual(matchingDeleteActionIndexes([{ dataId: 'siteblocks-setting-wrap-sid', text: '',
    textContent: ' 删除 ', iconClasses: ['icon-trash'], visible: true }], 'sid'), [0]);
  assert.deepEqual(matchingDeleteActionIndexes([{ dataId: 'siteblocks-setting-wrap-sid', text: '',
    textContent: '复制', iconClasses: ['icon-trash'], visible: true }], 'sid'), []);
});

test('delete locator aggregates the unique identity-bound action across page and frames', () => {
  const main = { selector: 'main-selector' };
  const canvas = { selector: 'frame-selector' };
  const action = { dataId: 'siteblocks-setting-wrap-sid', textContent: '删除', iconClasses: ['icon-trash'], visible: true };
  assert.deepEqual(matchingDeleteActionMatches([
    { name: 'page', locator: main, actions: [] }, { name: 'canvas', locator: canvas, actions: [action] },
  ], 'sid'), [{ scope: 'canvas', index: 0, locator: canvas }]);
  assert.equal(matchingDeleteActionMatches([
    { name: 'page', actions: [action] }, { name: 'canvas', actions: [action] },
  ], 'sid').length, 2);
});

test('delete action wait allows toolbar rendering but fails closed on timeout or ambiguity', async () => {
  let reads = 0;
  const locator = { scope: 'rendered-frame' };
  const action = { dataId: 'siteblocks-setting-wrap-sid', textContent: '删除', iconClasses: ['icon-trash'], visible: true };
  const found = await waitForUniqueDeleteAction({ settingId: 'sid', timeoutMs: 100,
    readScopes: async () => ++reads < 2 ? [{ name: 'canvas', locator, actions: [] }]
      : [{ name: 'canvas', locator, actions: [action] }],
    wait: async () => {} });
  assert.deepEqual(found, { scope: 'canvas', index: 0, locator });
  await assert.rejects(waitForUniqueDeleteAction({ settingId: 'sid', timeoutMs: 0,
    readScopes: async () => [{ name: 'canvas', actions: [] }] }), /matched 0.*timeout/);
  await assert.rejects(waitForUniqueDeleteAction({ settingId: 'sid', timeoutMs: 0,
    readScopes: async () => [{ name: 'page', actions: [action] }, { name: 'canvas', actions: [action] }] }), /ambiguous \(2\)/);
});
