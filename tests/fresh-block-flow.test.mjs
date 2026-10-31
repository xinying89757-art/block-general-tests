import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFreshReport, diffFreshDefaults, targetBlockInstances, parseFreshPageConfig,
  runFreshBlockFlow, readStableBlockInventory, countPageBlocksByNumber } from '../src/fresh-block-flow.mjs';
import { degradeInventoryRegion } from '../src/baseline.mjs';
import { executeSettingBatches, selectRetainedFailures } from '../src/batch-save.mjs';
import { createFreshLifecycle, createFreshSettingsAdapter, currentValuesFromInventory, projectPersistedFreshValues } from '../src/fresh-settings-adapter.mjs';
import { matchingDeleteActionIndexes, matchingDeleteActionMatches, matchingDeleteConfirmIndexes,
  matchingDeleteConfirmMatches, waitForUniqueDeleteAction } from '../src/fresh-editor-actions.mjs';
import { matchingPageSaveControls, waitForUniquePageSaveControl } from '../src/page-save-control.mjs';
import { bindFreshBatchSettingSession, freshSettings as productListFreshSettings } from '../src/capabilities/product-list-display.mjs';
import { freshSettings as customFilterFreshSettings } from '../src/capabilities/custom-filter-fields.mjs';
import { freshSettings as buttonFreshSettings } from '../src/capabilities/button-link.mjs';
import { freshSettings as colorFreshSettings, createFreshDefinitions as createColorFreshDefinitions } from '../src/capabilities/block-color-scheme.mjs';
import { freshSettings as widthFreshSettings, moduleWidthPersistedControls } from '../src/capabilities/module-width.mjs';
import { freshSettings as categoryFreshSettings, categoryPersistedControls } from '../src/capabilities/product-category-select.mjs';
import { freshSettings as styleFreshSettings } from '../src/capabilities/block-style-spec.mjs';
import { freshRailInventoryRegions, resolveFreshPageTarget } from '../src/fresh-block-browser-adapter.mjs';
import { inspectActiveModuleLibraryOpener, waitForUniqueVisibleControl,
  waitForUniqueVisibleModuleLibraryPanel } from '../src/module-library-browser.mjs';
import { selectBlock as selectRailBlock, identifyColorPanelInputs, planColorPanelWrites,
  colorPanelReadResult } from '../src/capabilities/rail.mjs';
import { planDeclaredFreshSettings } from '../src/fresh-plan.mjs';
import { compareFreshValueSnapshots } from '../src/fresh-block-flow.mjs';

function fakeAdapter(initialInstances = []) {
  const events = [];
  const state = { instances: structuredClone(initialInstances), persistedInstances: structuredClone(initialInstances), values: {}, snapshots: null, report: null };
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
    listAllBlockInstances: async () => { events.push(['inventory-read']); return structuredClone(state.instances); },
    deleteBlockInstance: async (instance) => {
      events.push(['delete', instance.blockId, instance.settingId]);
      state.instances = state.instances.filter((item) => item.settingId !== instance.settingId);
    },
    addDefaultBlock: async (blockId) => {
      const targetOrdinals = state.instances.filter((item) => String(item.blockId) === String(blockId))
        .map((item) => item.ordinal).filter(Number.isInteger);
      const instance = { blockId: String(blockId), settingId: 'new-instance', ordinal: Math.max(-1, ...targetOrdinals) + 1,
        position: { x: 0, y: 100 } };
      state.instances.push(instance); events.push(['add', blockId]); return instance;
    },
    savePage: async () => events.push(['savePage']), reloadPage: async () => events.push(['reloadPage']),
    waitForInventoryReady: async () => events.push(['inventory-ready']),
    discardUnsavedChanges: async () => {
      events.push(['discardUnsavedChanges']); state.instances = structuredClone(state.persistedInstances);
    },
    writeStopReport: async (report) => { state.stopReport = report; events.push(['writeStopReport']); },
    readDefaults: async () => [{ controlIdentity: 'dialog:text:heading', label: 'Heading', value: 'Default' }],
    readDefaultsSnapshot: async () => null,
    writeDefaultsSnapshot: async (_path, snapshot) => { state.defaults = snapshot; },
    readCurrentValues: async () => Object.entries(state.values).map(([key, value]) => ({ key, value })),
    readPublishedValues: async () => Object.entries(state.values).map(([key, value]) => ({ key, value })),
    captureFailureScreenshot: async ({ stage }) => `reports/screenshots/${stage}.png`,
    publishPage: async () => { events.push(['publish']); return { frontLink: '/public', publishedAt: 'now', confirmed: true,
      publishSignal: { status: 'confirmed' }, frontVerification: { status: 'present' } }; },
    writeReport: async (report) => { state.report = report; },
  };
}

const config = { page: { kind: 'custom', name: 'Catalog test' }, siteHost: 'example.test', blockId: '55',
  projectRoot: '/tmp/fresh-flow-test' };

test('stable block inventory requires consecutive identical reads after readiness waits', async () => {
  const events = [];
  let tick = 0;
  let now = 0;
  const result = await readStableBlockInventory(async () => {
    events.push(`read-${++tick}`);
    return tick === 1 ? [{ blockId: 'a' }] : [{ blockId: 'a' }, { blockId: 'b' }];
  }, { waitForReady: async () => events.push('ready'), timeoutMs: 100, intervalMs: 1,
    now: () => now, wait: async () => { now += 1; } });
  assert.deepEqual(result, [{ blockId: 'a' }, { blockId: 'b' }]);
  assert.deepEqual(events, ['ready', 'read-1', 'ready', 'read-2', 'ready', 'read-3']);
  assert.deepEqual(countPageBlocksByNumber([{ blockId: 'a' }, { blockId: 'b' }, { blockId: 'a' }]), { a: 2, b: 1 });
});

test('single color input preserves the scalar reader contract and existing rail inventory shape', () => {
  const inputs = [{ name: 'scheme', label: '配色方案', role: 'color', value: '#1C4587', position: 0 }];
  const read = colorPanelReadResult(inputs);
  assert.equal(read, '#1C4587');
  assert.deepEqual(freshRailInventoryRegions(read, null)[0].controls, [{ index: 0, tag: 'INPUT', type: 'text',
    name: 'scheme-color', label: '配色方案', value: '#1C4587', checked: false, disabled: false }]);
  assert.deepEqual(planColorPanelWrites(identifyColorPanelInputs(inputs).controls, '#FF0000').map(({ control, value }) =>
    ({ identity: control.identity, value })), [{ identity: 'label:配色方案', value: '#FF0000' }]);
});

test('three color inputs are inventoried independently and composite writes require explicit identities', () => {
  const inputs = [
    { name: 'colorVal0', label: '文字色', role: 'color', value: '#112233', position: 0 },
    { name: 'colorVal1', label: '背景色', role: 'color', value: '#445566', position: 1 },
    { name: 'colorVal2', label: '边框色', role: 'color', value: '#778899', position: 2 },
  ];
  const read = colorPanelReadResult(inputs);
  assert.equal(read.status, 'multiple-controls');
  assert.deepEqual(read.controls.map(({ identity, label, role, position, value }) =>
    ({ identity, label, role, position, value })), [
    { identity: 'label:文字色', label: '文字色', role: 'color', position: 0, value: '#112233' },
    { identity: 'label:背景色', label: '背景色', role: 'color', position: 1, value: '#445566' },
    { identity: 'label:边框色', label: '边框色', role: 'color', position: 2, value: '#778899' },
  ]);
  assert.throws(() => planColorPanelWrites(read.controls, '#FF0000'), /specify each target/);
  assert.deepEqual(planColorPanelWrites(read.controls, read.controls.map((control, index) =>
    ({ controlIdentity: control.identity, value: ['#AA0000', '#00BB00', '#0000CC'][index] })))
    .map(({ control, value }) => ({ identity: control.identity, value })), [
    { identity: 'label:文字色', value: '#AA0000' },
    { identity: 'label:背景色', value: '#00BB00' },
    { identity: 'label:边框色', value: '#0000CC' },
  ]);
  const regions = freshRailInventoryRegions(read, null)[0];
  assert.equal(regions.controls.length, 3);
  assert.deepEqual(regions.controls.map(({ name, label, value }) => ({ name, label, value })), [
    { name: 'colorVal0', label: '文字色', value: '#112233' },
    { name: 'colorVal1', label: '背景色', value: '#445566' },
    { name: 'colorVal2', label: '边框色', value: '#778899' },
  ]);
});

test('ambiguous color controls retain inventory notes and cannot be mapped or written', () => {
  const inputs = [
    { name: 'same', label: '颜色', role: 'color', value: '#111111', position: 0 },
    { name: 'same', label: '颜色', role: 'color', value: '#222222', position: 0 },
  ];
  const read = colorPanelReadResult(inputs);
  assert.equal(read.status, 'multiple-controls');
  assert.ok(read.controls.every((control) => !control.identifiable && control.inventoryNote));
  assert.equal(read.notes.length, 2);
  assert.throws(() => planColorPanelWrites(read.controls, [
    { controlIdentity: 'name:same', value: '#FF0000' },
  ]), /resolved 0 inputs/);
  assert.equal(colorPanelReadResult(inputs, { panelCount: 2 }).status, 'ambiguous-panel');
});

test('unstable page inventory fails closed at its configured bound', async () => {
  let now = 0;
  await assert.rejects(readStableBlockInventory(async () => [{ blockId: String(++now) }], {
    timeoutMs: 3, intervalMs: 1, now: () => now, wait: async () => { now += 1; },
  }), (error) => error.code === 'PAGE_INVENTORY_UNSTABLE' && Array.isArray(error.lastInventory));
});

test('shared fresh lifecycles support canvas popovers and right-rail flyouts with fail-closed methods', async () => {
  const events = [];
  const operations = Object.fromEntries(['open', 'read', 'apply', 'commit', 'cancel'].map((name) => [name,
    async () => events.push(name)]));
  const popover = createFreshLifecycle('canvas-popover', operations);
  await assert.rejects(popover.read(), /requires an open surface/);
  await popover.open(); await popover.apply('value');
  assert.equal(popover.hasUncommittedChanges, true);
  await popover.commit();
  assert.equal(popover.isOpen, false);
  const flyout = createFreshLifecycle('right-rail-flyout', operations);
  await flyout.open(); await flyout.read(); await flyout.cancel();
  assert.equal(flyout.isOpen, false);
  assert.deepEqual(events, ['open', 'apply', 'commit', 'open', 'read', 'cancel']);
  assert.throws(() => createFreshLifecycle('unknown-surface', operations), /Unknown fresh settings lifecycle/);
  assert.throws(() => createFreshLifecycle('right-rail-flyout', { open: operations.open }), /requires read/);
});

test('fresh adapter commits the active surface before opening another lifecycle in the same batch', async () => {
  const events = [];
  const makeSurface = (name) => createFreshLifecycle('settings-dialog', {
    open: async () => events.push(`${name}:open`), read: async () => name,
    apply: async () => events.push(`${name}:apply`),
    commit: async () => events.push(`${name}:commit`), cancel: async () => events.push(`${name}:cancel`),
  });
  const definitions = ['first', 'second'].map((id) => {
    const lifecycle = makeSurface(id);
    return { id, key: id, lifecycle, initialValue: 0, value: 1,
      apply: () => lifecycle.apply(), restore: () => lifecycle.apply(),
      check: async () => ({ status: 'pass', actual: 1 }) };
  });
  const adapter = await createFreshSettingsAdapter({ capabilities: [{ id: 'generic-one' }, { id: 'generic-two' }],
    context: { save: async () => events.push('page-save') },
    loadCapability: async (id) => ({ freshSettings: { status: 'adapted',
      createDefinitions: async () => ({ settings: [definitions[id === 'generic-one' ? 0 : 1]] }) } }) });
  const prepared = await adapter.prepare();
  await executeSettingBatches({ settings: prepared.settings, metadata: prepared.metadata,
    adapter: prepared.batchAdapter, finalState: 'retain-tested-values' });
  assert.ok(events.indexOf('first:commit') < events.indexOf('second:open'), events.join(','));
  assert.equal(events.filter((event) => event === 'first:commit').length, 1);
  assert.equal(events.filter((event) => event === 'second:commit').length, 1);
  assert.equal(events.filter((event) => event === 'page-save').length, 1);
});

test('all fresh surface lifecycles share one batch in dialog, popover, rail, and whole-category order', async () => {
  const events = [];
  const makeSetting = (capability, id, key, kind, initialValue, value) => {
    let state = structuredClone(initialValue);
    const lifecycle = createFreshLifecycle(kind, {
      open: async () => events.push(`${id}:open`),
      read: async () => structuredClone(state),
      apply: async (next) => { state = structuredClone(next); events.push(`${id}:apply`); },
      commit: async () => events.push(`${id}:commit`),
      ...(kind === 'canvas-popover' ? {} : { cancel: async () => events.push(`${id}:cancel`) }),
    });
    const setting = { id, key, lifecycle, initialValue, value, expected: value,
      apply: () => lifecycle.apply(value), restore: () => lifecycle.apply(initialValue),
      check: async () => {
        await lifecycle.open();
        try {
          const actual = await lifecycle.read();
          return { status: JSON.stringify(actual) === JSON.stringify(value) ? 'pass' : 'fail',
            expected: value, actual };
        } finally {
          if (kind === 'canvas-popover') await lifecycle.commit();
          else await lifecycle.cancel();
        }
      } };
    return { capability, setting };
  };
  const planned = [
    makeSetting('product-list-display', 'pld-dialog', 'display', 'settings-dialog', 'default', 'changed'),
    makeSetting('custom-filter-fields', 'cff-dialog', 'field', 'settings-dialog', false, true),
    makeSetting('button-link', 'button-popover', 'button', 'canvas-popover', 'old text', 'AUTOTEST text'),
    makeSetting('block-color-scheme', 'color-rail', 'color', 'right-rail-flyout', '#000000', '#ff0000'),
    makeSetting('module-width', 'width-rail', 'width', 'right-rail-flyout', '1440px', '1200px'),
    makeSetting('product-category-select', 'category-whole-list', 'category-list', 'settings-dialog',
      { mode: 'all', selected: [] }, { mode: 'partial', selected: ['fixture-category'] }),
  ];
  const adapter = await createFreshSettingsAdapter({ capabilities: planned.map(({ capability }) => ({ id: capability })),
    context: { save: async () => events.push('page-save') },
    loadCapability: async (id) => ({ freshSettings: { status: 'adapted', createDefinitions: async () => ({
      settings: [planned.find((item) => item.capability === id).setting],
    }) } }) });
  const prepared = await adapter.prepare();
  const execution = await executeSettingBatches({ settings: prepared.settings, metadata: prepared.metadata,
    adapter: prepared.batchAdapter, finalState: 'retain-tested-values' });
  assert.equal(execution.batches.length, 1, JSON.stringify(execution.batches));
  assert.deepEqual(execution.results.map(({ status }) => status), Array(6).fill('pass'));
  assert.deepEqual(execution.results.at(-1).expected, { mode: 'partial', selected: ['fixture-category'] });
  for (const [previous, next] of [['pld-dialog', 'cff-dialog'], ['cff-dialog', 'button-popover'],
    ['button-popover', 'color-rail'], ['color-rail', 'width-rail'], ['width-rail', 'category-whole-list']]) {
    assert.ok(events.indexOf(`${previous}:commit`) < events.indexOf(`${next}:open`), events.join(','));
  }
  assert.equal(events.filter((event) => event === 'page-save').length, 1);
  assert.throws(() => createFreshLifecycle('unknown-lifecycle', {}), /Unknown fresh settings lifecycle/);
  assert.throws(() => createFreshLifecycle('right-rail-flyout', { open: async () => {} }), /requires read/);
});

test('fresh button-link definitions use the canvas-popover lifecycle and existing persistence values', async () => {
  const events = [];
  const controls = [
    { index: 0, tag: 'INPUT', type: 'text', name: 'text', label: '按钮文本', context: '', value: 'Current', checked: false },
    { index: 1, tag: 'INPUT', type: 'text', name: 'url', label: '链接网址', context: '域名 邮箱地址', value: 'javascript:void(0);', checked: false },
    { index: 2, tag: 'INPUT', type: 'checkbox', name: 'target', label: '在新窗口打开', context: '', value: 'on', checked: false },
  ];
  const scopedSession = { root: { evaluate: async (fn) => /input,\s*textarea/.test(fn.toString())
      ? [0, 1, 2] : { found: true, selected: '域名' } },
    open: async () => events.push('open'), read: async () => structuredClone(controls),
    set: async (target, value) => { events.push(['set', target.index, value]);
      if (target.type === 'checkbox') controls[target.index].checked = value; else controls[target.index].value = value; },
    save: async () => events.push('save'), cancel: async () => events.push('cancel') };
  const adapter = await createFreshSettingsAdapter({ capabilities: [{ id: 'button-link' }],
    context: { page: {}, canvas: {}, config: {}, scopedSession, save: async () => events.push('page-save') },
    loadCapability: async () => ({ freshSettings: buttonFreshSettings }) });
  const prepared = await adapter.prepare();
  assert.equal(prepared.settings.length, 3);
  assert.ok(prepared.settings.every((item) => item.lifecycle.kind === 'canvas-popover'));
  assert.deepEqual(prepared.persistedControls.map(({ region, controlIndex, type }) => ({ region, controlIndex, type })), [
    { region: 'button-popover', controlIndex: 0, type: 'text' },
    { region: 'button-popover', controlIndex: 1, type: 'text' },
    { region: 'button-popover', controlIndex: 2, type: 'checkbox' },
  ]);
  const execution = await executeSettingBatches({ settings: prepared.settings, metadata: prepared.metadata,
    adapter: prepared.batchAdapter, finalState: 'retain-tested-values' });
  assert.equal(execution.results.length, 3, JSON.stringify(execution.results));
  assert.ok(execution.results.every((item) => item.status === 'pass'));
  assert.ok(events.filter((item) => item === 'save').length >= 1);
});

test('fresh button URL uses its URL-prefix mode oracle when tab markers are absent and fails closed on ambiguity', async () => {
  const makeAdapter = async ({ ambiguous = false } = {}) => {
    const controls = [
      { index: 0, tag: 'INPUT', type: 'text', name: 'text', label: '按钮文本', context: '', value: 'Current', checked: false },
      { index: 1, tag: 'INPUT', type: 'text', name: 'url', label: '链接网址', context: '域名 邮箱地址', value: 'https://current.example', checked: false },
      { index: 2, tag: 'INPUT', type: 'checkbox', name: 'target', label: '在新窗口打开', context: '', value: 'on', checked: false },
    ];
    let tabClicks = 0;
    const events = [];
    const scopedSession = {
      root: { evaluate: async (fn, wanted) => {
        if (/input,\s*textarea/.test(fn.toString())) return [0, 1, 2];
        if (wanted) tabClicks++;
        return { found: !ambiguous, selected: null, tabs: [
          { text: '域名', selected: false }, { text: '邮箱地址', selected: false },
        ] };
      } },
      open: async () => events.push('open'), read: async () => structuredClone(controls),
      set: async (target, value) => { if (target.type === 'checkbox') controls[target.index].checked = value;
        else controls[target.index].value = value; events.push(['set', target.index, value]); },
      save: async () => events.push('save'), cancel: async () => events.push('cancel'),
    };
    const adapter = await createFreshSettingsAdapter({ capabilities: [{ id: 'button-link' }],
      context: { page: {}, canvas: {}, config: {}, scopedSession, save: async () => events.push('page-save') },
      loadCapability: async () => ({ freshSettings: buttonFreshSettings }) });
    const prepared = await adapter.prepare();
    return { prepared, settings: prepared.settings, controls, events, get tabClicks() { return tabClicks; } };
  };
  const working = await makeAdapter();
  const urlSetting = working.settings.find(({ id }) => id === 'btn-url-persist');
  await working.prepared.batchAdapter.apply(urlSetting, { phase: 'test' });
  await working.prepared.batchAdapter.save({ reason: 'test' });
  const outcome = await working.prepared.batchAdapter.check(urlSetting, { phase: 'test' });
  assert.equal(outcome.status, 'pass', JSON.stringify(outcome));
  assert.equal(working.controls[1].value, 'https://www.baidu.com');
  assert.equal(working.tabClicks, 0, 'already-domain URL type is inferred without an unavailable active-tab marker');

  const ambiguous = await makeAdapter({ ambiguous: true });
  const ambiguousSetting = ambiguous.settings.find(({ id }) => id === 'btn-url-persist');
  await ambiguousSetting.lifecycle.open();
  await assert.rejects(ambiguousSetting.apply(), /链接类型页签无法唯一定位/);
  assert.equal(ambiguous.controls[1].value, 'https://current.example', 'ambiguous tabs are never written');
});

test('fresh color and width definitions use right-rail lifecycles and declare complete readback controls', async () => {
  const makeLifecycle = (kind, initial, applyValue) => {
    let state = structuredClone(initial), opened = false;
    return createFreshLifecycle(kind, { open: async () => { opened = true; }, read: async () => structuredClone(state),
      apply: async (value) => { state = applyValue(state, value); }, commit: async () => { opened = false; },
      cancel: async () => { opened = false; } });
  };
  const colorLifecycle = makeLifecycle('right-rail-flyout', '#336699', (_state, value) => value);
  const colorAdapter = await createFreshSettingsAdapter({ capabilities: [{ id: 'block-color-scheme' }],
    context: { page: {}, canvas: {}, config: { blockId: 'generic' }, lifecycle: colorLifecycle,
      initialValue: '#336699', save: async () => {} },
    loadCapability: async () => ({ freshSettings: colorFreshSettings }) });
  const color = await colorAdapter.prepare();
  assert.equal(color.settings[0].lifecycle.kind, 'right-rail-flyout');
  assert.deepEqual(color.persistedControls, [{ capability: 'block-color-scheme', region: 'right-rail-color', controlIndex: 0, type: 'text' }]);
  const colorRun = await executeSettingBatches({ settings: color.settings, metadata: color.metadata,
    adapter: color.batchAdapter, finalState: 'retain-tested-values' });
  assert.equal(colorRun.results[0].status, 'pass');

  const initialWidth = { radios: [
    { value: '1', label: '1200px', checked: false }, { value: '2', label: '1440px', checked: false },
    { value: '-1', label: '自定义（需不小于1200px）', checked: true },
  ], customVal: '1440', globalApply: false, checked: { value: '-1', label: '自定义（需不小于1200px）' }, effective: 1440 };
  const widthLifecycle = makeLifecycle('right-rail-flyout', initialWidth, (state, value) => {
    const radios = state.radios.map((item) => ({ ...item, checked: item.label === value.preset }));
    return { ...state, radios, checked: radios.find((item) => item.checked), effective: Number.parseInt(value.preset, 10) };
  });
  const widthAdapter = await createFreshSettingsAdapter({ capabilities: [{ id: 'module-width' }],
    context: { page: {}, canvas: {}, config: { blockId: 'generic' }, lifecycle: widthLifecycle,
      initialValue: initialWidth, save: async () => {} },
    loadCapability: async () => ({ freshSettings: widthFreshSettings }) });
  const width = await widthAdapter.prepare();
  assert.equal(width.settings[0].lifecycle.kind, 'right-rail-flyout');
  assert.equal(width.persistedControls.length, moduleWidthPersistedControls(initialWidth).length);
  assert.deepEqual(width.persistedControls.map(({ region, controlIndex, type }) => ({ region, controlIndex, type })),
    moduleWidthPersistedControls(initialWidth));
  assert.ok(!width.persistedControls.some(({ type }) => type === 'text'),
    'the preset-width test reads persisted radio selection, not the inactive custom-width input');
  assert.ok(moduleWidthPersistedControls(initialWidth, { custom: '1500' }).some(({ type }) => type === 'text'));
  const widthRun = await executeSettingBatches({ settings: width.settings, metadata: width.metadata,
    adapter: width.batchAdapter, finalState: 'retain-tested-values' });
  assert.equal(widthRun.results[0].status, 'pass');
});

test('color capability retains its single-input oracle and records multi-input inventory without guessing', async () => {
  let cancelled = 0;
  const lifecycle = { open: async () => {}, read: async () => '#336699', apply: async () => {},
    commit: async () => {}, cancel: async () => { cancelled++; } };
  const single = await createColorFreshDefinitions({ canvas: {}, config: { blockId: 'generic' }, lifecycle });
  assert.equal(single.settings.length, 1);
  assert.equal(single.settings[0].value, '#FF0000');
  assert.deepEqual(single.persistedControls, [{ region: 'right-rail-color', controlIndex: 0, type: 'text' }]);

  const multi = await createColorFreshDefinitions({ canvas: {}, config: { blockId: 'generic' }, initialValue: {
    status: 'multiple-controls', controls: [
      { identity: 'name:colorVal0', label: 'colorVal0', role: 'color', position: 0, value: '#112233', identifiable: true },
      { identity: 'name:colorVal1', label: 'colorVal1', role: 'color', position: 1, value: '#445566', identifiable: true },
      { identity: 'name:colorVal2', label: 'colorVal2', role: 'color', position: 2, value: '#778899', identifiable: true },
    ], notes: [] }, lifecycle });
  assert.equal(multi.settings.length, 0);
  assert.match(multi.notAdaptedReason, /3 independently inventoried control/);
  assert.deepEqual(multi.staticResults.map(({ id, status }) => [id, status]), [
    ['bcs-state', 'record'], ['bcs-color-persist', 'skip'], ['bcs-front-effect', 'skip'],
  ]);
  assert.equal(multi.staticResults[0].evidence.controls.length, 3);
  assert.equal(cancelled, 1, 'an ambiguous visible rail surface is closed without saving');
});

test('fresh category definition persists the whole fixture selection set as one setting', async () => {
  const events = [];
  let controls = [
    { index: 0, tag: 'INPUT', type: 'radio', name: 'selectGroupWay', label: '选择所有产品分类', value: '0', checked: true },
    { index: 1, tag: 'INPUT', type: 'radio', name: 'selectGroupWay', label: '选择部分产品分类', value: '1', checked: false },
    { index: 2, tag: 'INPUT', type: 'checkbox', name: 'leafProdGroup', label: 'Fixture A', value: 'a', checked: true, disabled: true },
    { index: 3, tag: 'INPUT', type: 'checkbox', name: 'leafProdGroup', label: 'Fixture B', value: 'b', checked: true, disabled: true },
  ];
  const scopedSession = { open: async () => events.push('open'), read: async () => structuredClone(controls),
    set: async (target, value) => { events.push(['set', target.index, value]);
      if (target.type === 'radio') { controls = controls.map((item) => item.name === target.name
        ? { ...item, checked: item.index === target.index } : item);
        controls = controls.map((item) => item.name === 'leafProdGroup' ? { ...item, disabled: target.index === 0 } : item); }
    },
    setMany: async (changes) => { events.push(['setMany', changes.length]);
      controls = controls.map((item) => changes.some((change) => change.target.index === item.index)
        ? { ...item, checked: changes.find((change) => change.target.index === item.index).value } : item); },
    save: async () => events.push('save'), cancel: async () => events.push('cancel') };
  const adapter = await createFreshSettingsAdapter({ capabilities: [{ id: 'product-category-select' }],
    context: { page: {}, canvas: {}, config: {}, capability: { wrapIndex: 0 }, profile: { fixture: { category: { name: 'Fixture A' } } },
      scopedSession, save: async () => events.push('page-save') },
    loadCapability: async () => ({ freshSettings: categoryFreshSettings }) });
  const prepared = await adapter.prepare();
  assert.equal(prepared.settings.length, 1);
  assert.equal(prepared.settings[0].id, 'pcs-category-persist');
  assert.deepEqual(prepared.settings[0].value, { mode: '选择部分产品分类', selected: ['Fixture A'] });
  assert.equal(prepared.persistedControls.length, 4);
  assert.deepEqual(prepared.persistedControls.map(({ controlIndex }) => controlIndex), [0, 1, 2, 3]);
  const execution = await executeSettingBatches({ settings: prepared.settings, metadata: prepared.metadata,
    adapter: prepared.batchAdapter, finalState: 'retain-tested-values' });
  assert.equal(execution.results[0].status, 'pass');
  assert.ok(events.some((item) => Array.isArray(item) && item[0] === 'setMany' && item[1] === 2));
});

test('style capability runs as post-publish check-only or returns front-machine deferred checks', async () => {
  const adapter = await createFreshSettingsAdapter({ capabilities: [{ id: 'block-style-spec', styleSpec: { items: [{ id: 'button-text', props: { color: '#000000' } }] } }],
    context: { session: {}, config: { blockId: 'generic', siteDomain: 'example.test' } },
    loadCapability: async () => ({ freshSettings: styleFreshSettings }) });
  const prepared = await adapter.prepare();
  assert.deepEqual(prepared.capabilityResults.map(({ status }) => status), ['check-only']);
  const checks = await prepared.runPostPublishChecks({ frontLink: null });
  assert.ok(checks.length > 0);
  assert.ok(checks.every((item) => item.status === 'deferred'));
  assert.ok(checks.every((item) => item.detail.includes('前台机器')));
});

test('fresh right-rail value inventory has stable declared control identities', () => {
  const regions = freshRailInventoryRegions('#123456', { radios: [{ value: '1', label: '1200px', checked: false }],
    customVal: '1440', globalApply: false });
  const values = currentValuesFromInventory(regions);
  assert.deepEqual(values.map(({ region, controlIndex, type }) => ({ region, controlIndex, type })), [
    { region: 'right-rail-color', controlIndex: 0, type: 'text' },
    { region: 'right-rail-width', controlIndex: 0, type: 'radio' },
    { region: 'right-rail-width', controlIndex: 1, type: 'text' },
    { region: 'right-rail-width', controlIndex: 2, type: 'checkbox' },
  ]);
});

test('rail selection activates the target element directly and waits for its rail without pointer-overlay interception', async () => {
  let clicks = 0, reads = 0;
  const wrap = { scrollIntoViewIfNeeded: async () => {},
    click: async () => { throw new Error('pointer click must not be used through the stale dialog overlay'); },
    evaluate: async (callback) => callback({ click: () => { clicks += 1; } }) };
  const canvas = { locator: () => ({ first: () => wrap }) };
  const index = await selectRailBlock(canvas, 'generic-block', { waitForRail: async () => {
    reads += 1;
    if (reads === 1) throw new Error('rail has not rendered yet');
    return 0;
  } });
  assert.equal(index, 0);
  assert.equal(clicks, 2);
  assert.equal(reads, 2);
});

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

test('page-save action lookup accepts one visible generic action across documents and rejects ambiguity', async () => {
  const unique = [{ name: 'top-page', locator: 'page', controls: [{ id: 'saveLayout', visible: true }] },
    { name: 'canvas', locator: 'canvas', controls: [{ id: 'saveLayout', visible: false }] }];
  assert.deepEqual(matchingPageSaveControls(unique), [{ scope: 'top-page', index: 0, locator: 'page', frameUrl: null }]);
  const ambiguous = [
    { name: 'one', controls: [{ id: 'saveLayout', visible: true }] },
    { name: 'two', controls: [{ id: 'saveLayout', visible: true }] },
  ];
  assert.equal(matchingPageSaveControls(ambiguous).length, 2);
  await assert.rejects(waitForUniquePageSaveControl({ readScopes: async () => ambiguous }), /2 visible #saveLayout actions/);
  assert.deepEqual(matchingPageSaveControls([{ name: 'page', controls: [{ id: 'other', visible: true }] }]), []);
});

test('page-save action polling waits for late appearance and fails closed when absent', async () => {
  let reads = 0;
  const match = await waitForUniquePageSaveControl({ timeoutMs: 100, intervalMs: 1,
    readScopes: async () => [{ name: 'page', locator: 'save', controls: ++reads < 2 ? [] : [{ id: 'saveLayout', visible: true }] }] });
  assert.equal(match.locator, 'save');
  await assert.rejects(waitForUniquePageSaveControl({ timeoutMs: 5, intervalMs: 1, readScopes: async () => [] }), /did not become visible/);
});

test('published value comparison reports changed, missing, and added controls without rewriting values', () => {
  const before = [{ region: 'settings', label: 'Mode', type: 'radio', value: 'all' },
    { region: 'settings', label: 'Count', type: 'text', value: '20' }];
  assert.deepEqual(compareFreshValueSnapshots(before, structuredClone(before)), { status: 'pass', mismatches: [] });
  const diff = compareFreshValueSnapshots(before, [
    { region: 'settings', label: 'Mode', type: 'radio', value: 'filtered' },
    { region: 'settings', label: 'Extra', type: 'checkbox', value: true },
  ]);
  assert.equal(diff.status, 'fail');
  assert.deepEqual(diff.mismatches.map(({ kind }) => kind), ['changed', 'missing', 'added']);
});

test('adds and identifies the fresh target before deleting every old target; preserves other block numbers', async () => {
  const adapter = fakeAdapter([{ blockId: '55', settingId: 'old-one', ordinal: 0 },
    { blockId: '56', settingId: 'unrelated', ordinal: 0 }, { blockId: '55', settingId: 'old-two', ordinal: 1 }]);
  const progress = [];
  const report = await runFreshBlockFlow({ config, adapter, settings: [], onProgress: async (event) => progress.push(event) });
  assert.ok(adapter.events.findIndex(([kind]) => kind === 'add') < adapter.events.findIndex(([kind]) => kind === 'delete'));
  for (const index of adapter.events.flatMap(([kind], position) => kind === 'add' || kind === 'delete' ? [position] : [])) {
    assert.deepEqual(adapter.events.slice(index + 1, index + 5).map(([event]) => event),
      ['inventory-ready', 'inventory-read', 'inventory-ready', 'inventory-read']);
  }
  assert.deepEqual(adapter.events.filter(([kind]) => kind === 'delete'), [['delete', '55', 'old-one'], ['delete', '55', 'old-two']]);
  assert.ok(adapter.state.instances.some((item) => item.settingId === 'unrelated'));
  assert.equal(adapter.state.instances.filter((item) => item.blockId === '55').length, 1);
  assert.equal(report.block.settingId, 'new-instance');
  assert.deepEqual(report.lifecycle, { deletedSettingIds: ['old-one', 'old-two'], addedSettingId: 'new-instance' });
  assert.deepEqual(adapter.events.filter(([kind]) => kind === 'delete').map((event) => event[2]), ['old-one', 'old-two']);
  assert.deepEqual(progress.filter((event) => event.stage === 'instance-deleted').map(({ deletedSettingId }) => deletedSettingId), ['old-one', 'old-two']);
  assert.ok(progress.some((event) => event.stage === 'instance-added' && event.settingId === 'new-instance'));
});

test('defaults inventory harness errors still write a partial report and block publication', async () => {
  const adapter = fakeAdapter([{ blockId: '55', settingId: 'old', ordinal: 0 },
    { blockId: '56', settingId: 'unrelated', ordinal: 0 }]);
  adapter.readDefaults = async () => { throw new Error('inventory control did not stabilize'); };
  const report = await runFreshBlockFlow({ config, adapter, settings: [] });
  assert.equal(adapter.state.report, report);
  assert.equal(report.defaults.status, 'unavailable');
  assert.equal(report.checks.find((item) => item.id === 'fresh-defaults-inventory')?.status, 'fail');
  assert.equal(report.publishedAt, null);
  assert.equal(adapter.events.some(([kind]) => kind === 'publish'), false);
  assert.equal(report.lifecycle.addedSettingId, 'new-instance');
  assert.deepEqual(countPageBlocksByNumber(adapter.state.instances), { '55': 1, '56': 1 });
});

test('one failed capability inventory is reported and skipped while clean peers can publish', async () => {
  const adapter = fakeAdapter([{ blockId: '55', settingId: 'old', ordinal: 0 }]);
  adapter.prepareSettings = async () => ({ settings: [{ id: 'peer-setting', key: 'peer', value: 'new', expectedStatus: 'pass' }],
    metadata: {}, capabilityResults: [{ capability: 'button-link', status: 'not-adapted', reason: 'popover inventory unstable' }],
    staticResults: [{ id: 'button-link-inventory', status: 'fail', classification: 'harness-error', detail: 'popover inventory unstable' }],
    batchAdapter: adapter.batchAdapter, persistedControls: [] });
  const report = await runFreshBlockFlow({ config, adapter, settings: [] });
  assert.equal(report.capabilities[0].status, 'not-adapted');
  assert.equal(report.checks.find((item) => item.id === 'button-link-inventory')?.status, 'fail');
  assert.equal(report.checks.find((item) => item.id === 'peer-setting')?.status, 'pass');
  assert.ok(report.publishedAt);
  assert.equal(adapter.events.some(([kind]) => kind === 'publish'), true);
});

test('a failed fresh add stops before deleting any existing target instance', async () => {
  const adapter = fakeAdapter([{ blockId: '55', settingId: 'old', ordinal: 0 }]);
  adapter.addDefaultBlock = async () => { adapter.events.push(['add-failed']); throw new Error('target unavailable'); };
  await assert.rejects(runFreshBlockFlow({ config, adapter, settings: [] }), /target unavailable/);
  assert.deepEqual(adapter.events.filter(([kind]) => kind === 'delete'), []);
  assert.deepEqual(adapter.state.instances.map(({ settingId }) => settingId), ['old']);
});

test('stops after an old-target delete fails and discards the unsaved replacement', async () => {
  const adapter = fakeAdapter([{ blockId: '55', settingId: 'old', ordinal: 0 }]);
  adapter.deleteBlockInstance = async (instance) => adapter.events.push(['unexpected-delete-noop', instance.settingId]);
  await assert.rejects(runFreshBlockFlow({ config, adapter, settings: [] }), /preserving the fresh instance/);
  assert.equal(adapter.events.some(([kind]) => kind === 'add'), true);
  assert.deepEqual(adapter.state.instances.map(({ settingId }) => settingId), ['old']);
  assert.ok(adapter.events.some(([kind]) => kind === 'discardUnsavedChanges'));
  assert.equal(adapter.state.stopReport.unsavedEditorStateDiscarded, true);
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
  assert.equal(adapter.events.some(([kind]) => kind === 'add'), true);
  assert.equal(adapter.events.some(([kind]) => kind === 'savePage' || kind === 'publish'), false);
});

test('post-add non-target guard reports counts and created id, then discards unsaved editor changes', async () => {
  const adapter = fakeAdapter([{ blockId: '55', settingId: 'old', ordinal: 0 }]);
  const add = adapter.addDefaultBlock;
  adapter.addDefaultBlock = async (...args) => {
    const created = await add(...args);
    adapter.state.instances.push({ blockId: '56', settingId: 'unexpected', ordinal: 0 });
    return created;
  };
  await assert.rejects(runFreshBlockFlow({ config, adapter, settings: [] }), (error) => {
    assert.match(error.message, /non-target block number changed/);
    assert.match(error.message, /expected.*actual.*created settingId=new-instance/);
    assert.equal(error.unsavedEditorStateDiscarded, true);
    return true;
  });
  assert.deepEqual(adapter.events.filter(([kind]) => kind === 'savePage' || kind === 'publish'), []);
  assert.deepEqual(adapter.events.filter(([kind]) => kind === 'discardUnsavedChanges'), [['discardUnsavedChanges']]);
  assert.deepEqual(adapter.state.instances, [{ blockId: '55', settingId: 'old', ordinal: 0 }]);
  assert.equal(adapter.state.stopReport.createdSettingId, 'new-instance');
  assert.deepEqual(adapter.state.stopReport.expectedNonTargetCounts, {});
  assert.deepEqual(adapter.state.stopReport.actualNonTargetCounts, { '56': 1 });
  assert.deepEqual(adapter.state.stopReport.expectedPageCounts, { '55': 2 });
  assert.deepEqual(adapter.state.stopReport.actualPageCounts, { '55': 2, '56': 1 });
  assert.deepEqual(adapter.state.stopReport.countDifferences, [{ blockId: '56', expected: 0, actual: 1 }]);
  assert.equal(adapter.state.stopReport.unsavedEditorStateDiscarded, true);
  assert.equal(adapter.state.stopReport.publishedAt, null);
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
  assert.equal(report.failures[0].screenshot, 'reports/screenshots/batch-settings.png');
});

test('fresh flow writes partial setting verdicts and harness errors when batch and current inventory both fail', async () => {
  const adapter = fakeAdapter();
  let saves = 0;
  adapter.batchAdapter.save = async () => {
    saves++;
    if (saves === 2) throw new Error('second batch save transport failed');
    adapter.events.push(['save', 'batch']);
  };
  adapter.readCurrentValues = async () => { throw new Error('button readback did not stabilize'); };
  const report = await runFreshBlockFlow({ config, adapter, settings: [
    { id: 'first', key: 'first', value: 'one', expected: 'one' },
    { id: 'second', key: 'second', value: 'two', expected: 'two' },
  ], metadata: { first: { interferesWith: ['second'] } } });
  assert.equal(adapter.events.some(([kind]) => kind === 'publish'), false);
  assert.equal(report.publishedAt, null);
  assert.deepEqual(report.checks.map(({ id, status }) => [id, status]), [
    ['first', 'pass'], ['fresh-batch-execution', 'fail'], ['fresh-current-values', 'fail'],
  ]);
  assert.ok(report.flowErrors.some(({ stage, message }) => stage === 'batch-settings'
    && /second batch save transport failed/.test(message)));
  assert.ok(report.flowErrors.some(({ stage, message }) => stage === 'current-values'
    && /did not stabilize/.test(message)));
  assert.deepEqual(report.block.currentValues, []);
  assert.equal(adapter.state.report, report);
});

test('does not invoke a divergent module-availability preflight before the proven add path', async () => {
  const adapter = fakeAdapter([{ blockId: '55', settingId: 'existing', ordinal: 0 }]);
  adapter.verifyModuleAvailability = async () => { throw new Error('divergent preflight must not run'); };
  const report = await runFreshBlockFlow({ config, adapter, settings: [] });
  assert.equal(report.block.settingId, 'new-instance');
  assert.ok(adapter.events.some(([kind]) => kind === 'add'));
});

test('fresh flow never reports publication when publish and front confirmation are incomplete', async () => {
  const adapter = fakeAdapter();
  adapter.publishPage = async () => ({ frontLink: '/public', publishedAt: 'attempted-at', confirmed: false,
    publishSignal: { status: 'confirmed' }, frontVerification: { status: 'absent' } });
  const report = await runFreshBlockFlow({ config, adapter, settings: [{ id: 'check', key: 'x', value: 'y' }] });
  assert.equal(report.publishedAt, null);
  assert.equal(report.publishedReadback, null);
  assert.ok(report.checks.some(({ id, status }) => id === 'fresh-publish-confirmed' && status === 'fail'));
  assert.ok(report.flowErrors.some(({ stage }) => stage === 'publish-confirmation'));
});

test('editor success remains distinct from an unreachable runner front path', async () => {
  const adapter = fakeAdapter();
  adapter.publishPage = async () => ({ frontLink: 'http://site.example/products.html', confirmed: false,
    publishSignal: { status: 'confirmed', signal: '发布成功' },
    frontVerification: { status: 'front-unreachable-from-runner', reachability: {
      targetFailures: [{ status: 500, server: 'Pingora' }],
      rootProbe: { status: 500, server: 'Pingora', empty: true },
    } } });
  const report = await runFreshBlockFlow({ config, adapter, settings: [] });
  assert.equal(report.editorPublishSucceeded, true);
  assert.equal(report.published, false);
  assert.equal(report.publishedConfirmed, false);
  assert.equal(report.publishedAt, null);
  assert.equal(report.confirmationSource, null);
  assert.equal(report.frontVerification.status, 'front-unreachable-from-runner');
  assert.equal(report.failures.at(-1).classification, 'front-unreachable-from-runner');
  assert.equal(report.frontVerification.reachability.rootProbe.server, 'Pingora');
});

test('publish timeout diagnostics are preserved in the partial report without page values', async () => {
  const adapter = fakeAdapter();
  const diagnostics = { stage: 'wait-confirm-dialog', chooserVisibleCount: 0,
    publishMenuVisibleCount: 0, confirmDialogVisibleCount: 0 };
  adapter.publishPage = async () => { throw Object.assign(new Error('dialog wait timed out'), { publishDiagnostics: diagnostics }); };
  const report = await runFreshBlockFlow({ config, adapter, settings: [] });
  assert.equal(report.publishedAt, null);
  assert.deepEqual(report.flowErrors.find(({ stage }) => stage === 'publish')?.diagnostics, diagnostics);
  assert.deepEqual(report.checks.find(({ id }) => id === 'fresh-publish')?.batchResult.diagnostics, diagnostics);
});

test('post-publish readback mismatch is a failure with screenshot evidence and separate values', async () => {
  const adapter = fakeAdapter();
  adapter.readPublishedValues = async () => [{ key: 'setting', value: 'persisted-different' }];
  const report = await runFreshBlockFlow({ config, adapter, settings: [
    { id: 'setting-check', key: 'setting', value: 'retained' },
  ] });
  assert.equal(report.publishedAt, 'now');
  assert.equal(report.publishedReadback.status, 'fail');
  assert.equal(report.block.publishedReadbackValues[0].value, 'persisted-different');
  assert.equal(report.checks.at(-1).id, 'fresh-post-publish-readback');
  assert.equal(report.failures.at(-1).screenshot, 'reports/screenshots/post-publish-readback.png');
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
  assert.equal(report.moduleLibraryPreflight, null);
  assert.equal(report.settingsMode, 'BATCH_SAVE / retain-tested-values');
});

test('module-library preflight uses the add path active-wrapper locator and records its match count', async () => {
  const calls = [];
  const opener = { count: async () => 1 };
  const wrapperLocator = { first() { calls.push(['wrapper-first']); return this; },
    locator(selector) { calls.push(['child', selector]); return { first() { calls.push(['opener-first']); return opener; } }; } };
  const frame = { locator(selector) { calls.push(['frame', selector]); return wrapperLocator; } };
  const inspected = await inspectActiveModuleLibraryOpener(frame);
  assert.equal(inspected.matchCount, 1);
  assert.deepEqual(calls, [
    ['frame', '#backstage-bodyArea .backstage-creatmodules-wrapper'],
    ['wrapper-first'], ['child', '.backstage-creatmodules-addbtn'], ['opener-first'],
  ]);
});

test('module-library mode tab and target search use unique visible controls scoped to the active panel', async () => {
  const calls = [];
  const control = { waitFor: async (options) => calls.push(['waitFor', options]),
    count: async () => 1, first() { return this; }, click: async () => calls.push(['click']) };
  const panel = { locator(selector) { calls.push(['panel-locator', selector]); return control; } };
  assert.equal(await waitForUniqueVisibleControl(panel, '.user-handle-module[value="-1"]', 'Mode develop tab'), control);
  assert.equal(await waitForUniqueVisibleControl(panel, '.addmodules_searchWrap input', 'Target search input (online)'), control);
  assert.deepEqual(calls.filter(([kind]) => kind === 'panel-locator').map(([, selector]) => selector), [
    '.user-handle-module[value="-1"]:visible', '.addmodules_searchWrap input:visible',
  ]);
  assert.ok(calls.filter(([kind]) => kind === 'waitFor').every(([, options]) => options.state === 'visible'));
});

test('module-library visible control lookup fails closed on multiple visible matches and scopes panel to page', async () => {
  const pageCalls = [];
  const visiblePanel = { first() { return this; }, waitFor: async () => {}, count: async () => 1 };
  const page = { locator(selector) { pageCalls.push(selector); return visiblePanel; } };
  assert.equal(await waitForUniqueVisibleModuleLibraryPanel(page), visiblePanel);
  assert.deepEqual(pageCalls, ['.backstage-addmodules-chooseWrapper:visible']);
  const ambiguous = { locator: () => ({ first: () => ({ waitFor: async () => {} }), count: async () => 2 }) };
  await assert.rejects(waitForUniqueVisibleControl(ambiguous, '.user-handle-module', 'Mode tab'),
    /2 visible matches/);
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

test('fresh inventory failure degrades only its declared capability and preserves other settings', async () => {
  let buttonDefinitionCalls = 0;
  const adapter = await createFreshSettingsAdapter({ capabilities: [{ id: 'button-link' }, { id: 'other-capability' }],
    loadCapability: async (id) => ({ freshSettings: id === 'button-link'
      ? { status: 'adapted', metadata: { inventoryRegions: ['button-surface'] },
        createDefinitions: async () => { buttonDefinitionCalls++; return { settings: [] }; } }
      : { status: 'adapted', createDefinitions: async () => ({ settings: [
        { id: 'other-setting', apply: async () => {}, check: async () => ({ status: 'pass' }) },
      ] }) } }),
  });
  const prepared = await adapter.prepare({ inventory: [{ type: 'button-surface', inventoryError: {
    regionType: 'button-surface', code: 'UNSTABLE', message: 'diagnostic without values', screenshot: 'reports/a.png',
    diagnostics: { snapshotCount: 42, elapsedMs: 15000, changingFields: ['url'], unreadableFields: [], loadingMaskVisible: false },
  } }] });
  assert.equal(buttonDefinitionCalls, 0);
  assert.deepEqual(prepared.settings.map(({ id }) => id), ['other-setting']);
  assert.equal(prepared.capabilityResults[0].status, 'not-adapted');
  assert.match(prepared.capabilityResults[0].reason, /snapshots=42.*changingFields=url/);
  const inventoryResult = prepared.staticResults.find(({ id }) => id === 'button-link-inventory');
  assert.equal(inventoryResult.classification, 'harness-error');
  assert.equal(inventoryResult.evidence.screenshot, 'reports/a.png');
});

test('degraded inventory region retains safe diagnostics and screenshot reference without control values', () => {
  const region = degradeInventoryRegion({ type: 'button-surface', kind: 'canvas-popover', controls: [] },
    Object.assign(new Error('unstable'), { code: 'UNSTABLE', inventoryDiagnostics: {
      snapshotCount: 4, elapsedMs: 15000, changingFields: ['url'], unreadableFields: [], loadingMaskVisible: false,
    } }), 'reports/screenshots/inventory.png');
  assert.equal(region.inventoryError.regionType, 'button-surface');
  assert.deepEqual(region.inventoryError.diagnostics.changingFields, ['url']);
  assert.equal(region.inventoryError.screenshot, 'reports/screenshots/inventory.png');
  assert.equal(JSON.stringify(region).includes('https://'), false);
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

test('product-list fresh setting writes stay bound to the capability dialog session', async () => {
  const calls = [];
  const scopedSession = { id: 'settings-dialog' };
  const setting = bindFreshBatchSettingSession({ apply: async (session) => calls.push(['apply', session.id]),
    restore: async (session) => calls.push(['restore', session.id]) }, scopedSession);
  await setting.apply({ session: { id: 'outer-browser-session' } });
  await setting.restore({ session: { id: 'outer-browser-session' } });
  assert.deepEqual(calls, [['apply', 'settings-dialog'], ['restore', 'settings-dialog']]);
});

test('custom-filter fresh definition uses its scoped dialog session and exports persisted field identity', async () => {
  const events = [];
  const state = { controls: [{ index: 0, tag: 'INPUT', type: 'checkbox', name: 'field', label: 'AUTOTEST-Field',
    value: '826554', checked: false, disabled: false }] };
  const scopedSession = {
    open: async () => events.push('dialog-open'),
    read: async () => structuredClone(state.controls),
    set: async (target, value) => { events.push(['dialog-set', target.index, value]); state.controls[0].checked = value; },
    save: async () => events.push('dialog-save'),
    cancel: async () => events.push('dialog-cancel'),
  };
  const adapter = await createFreshSettingsAdapter({ capabilities: [{ id: 'custom-filter-fields' }],
    context: { config: {}, page: {}, canvas: {}, profile: { fixture: { fields: [{ name: 'AUTOTEST-Field' }] } },
      scopedSession, initialControls: state.controls, save: async () => events.push('page-save') },
    loadCapability: async () => ({ freshSettings: customFilterFreshSettings }) });
  const prepared = await adapter.prepare();
  assert.equal(prepared.capabilityResults[0].status, 'adapted');
  assert.deepEqual(prepared.persistedControls, [{ capability: 'custom-filter-fields', settingId: 'cff-settings-persist',
    region: '设置自定义字段筛选', controlIndex: 0, type: 'checkbox' }]);
  const execution = await (await import('../src/batch-save.mjs')).executeSettingBatches({
    settings: prepared.settings, metadata: prepared.metadata, adapter: prepared.batchAdapter,
    finalState: 'retain-tested-values' });
  assert.equal(execution.results[0].status, 'pass', JSON.stringify(execution.results));
  assert.equal(state.controls[0].checked, true);
  assert.ok(events.includes('dialog-save'));
  assert.ok(events.includes('page-save'));
  await prepared.batchAdapter.restore(prepared.settings[0]);
  await prepared.batchAdapter.save({ reason: 'offline-restore-check' });
  assert.equal(state.controls[0].checked, false);
});

test('custom-field fresh definition discovers an editable control from inventory without a site label', async () => {
  const state = [{ index: 0, tag: 'INPUT', type: 'checkbox', name: 'field', label: 'Site field',
    value: '12345', checked: false, disabled: false }];
  const events = [];
  const adapter = await createFreshSettingsAdapter({ capabilities: [{ id: 'custom-filter-fields' }],
    context: { config: {}, page: {}, canvas: {}, profile: {},
      scopedSession: { open: async () => events.push('open'), read: async () => structuredClone(state),
        set: async (_target, value) => { state[0].checked = value; }, save: async () => events.push('dialog-save'),
        cancel: async () => events.push('cancel') },
      initialControls: state, save: async () => events.push('page-save') },
    loadCapability: async () => ({ freshSettings: customFilterFreshSettings }) });
  const prepared = await adapter.prepare();
  assert.deepEqual(prepared.capabilityResults, [{ capability: 'custom-filter-fields', status: 'adapted',
    settingIds: ['cff-settings-persist'] }]);
  assert.ok(events.includes('cancel'), 'capability preparation closes the dialog before another surface is prepared');
  assert.equal(prepared.settings[0].control.label, 'Site field');
  const execution = await executeSettingBatches({ settings: prepared.settings, metadata: prepared.metadata,
    adapter: prepared.batchAdapter, finalState: 'retain-tested-values' });
  assert.equal(execution.results[0].status, 'pass');
  assert.equal(state[0].checked, true);
  assert.ok(events.includes('dialog-save'));
  assert.ok(events.includes('page-save'));
});

test('full fresh flow runs PLD definitions on a scoped session, restores dependencies, retains a failure, and reads back a resolved page', async () => {
  const events = [];
  const controls = [
    ...['所有产品', '使用筛选条件', '选择指定产品', '选择部分产品分类'].map((label, index) => ({
      index, tag: 'INPUT', type: 'radio', name: 'data-source', label, value: label,
      checked: index === 0, disabled: false,
    })),
    { index: 4, tag: 'INPUT', type: 'radio', name: 'pagination', label: '是', value: 'yes', checked: true, disabled: false },
    { index: 5, tag: 'INPUT', type: 'radio', name: 'pagination', label: '否', value: 'no', checked: false, disabled: false },
  ];
  const state = { controls: structuredClone(controls) };
  const scopedSession = {
    open: async () => events.push('dialog-open'),
    read: async () => structuredClone(state.controls),
    set: async (target, value) => {
      events.push(['dialog-set', target.name, target.label, value]);
      if (target.type === 'radio' && value === true) {
        state.controls = state.controls.map((item) => item.name === target.name
          ? { ...item, checked: item.index === target.index } : item);
      } else {
        state.controls[target.index] = { ...state.controls[target.index], value };
      }
    },
    save: async () => events.push('dialog-save'),
    cancel: async () => events.push('dialog-cancel'),
  };
  const frame = { locator: () => ({ first: () => ({
    waitFor: async () => {},
    evaluate: async (read) => read({ querySelectorAll: () => [], querySelector: () => ({}) }),
  }) }) };
  const pageTarget = { kind: 'system', id: 'page-1', url: '/catalog.html' };
  const targetConfig = { ...config, page: pageTarget, resolvedTarget: null };
  const resolvedTarget = resolveFreshPageTarget(pageTarget, { name: 'Catalog' });
  targetConfig.resolvedTarget = resolvedTarget;
  const profile = { fixture: { filteredProducts: ['AUTOTEST-Product'] }, requirements: {} };
  const freshAdapter = await createFreshSettingsAdapter({ capabilities: [{ id: 'product-list-display', dialogTitle: '设置与选取数据' }],
    context: { config: targetConfig, session: { id: 'outer-browser-session' }, page: {}, canvas: frame,
      profile, report: { fixture: { applied: true } }, scopedSession, initialControls: controls,
      save: async () => events.push('page-save') },
    loadCapability: async () => ({ freshSettings: productListFreshSettings }) });
  const adapter = fakeAdapter();
  adapter.openPage = async (target) => {
    events.push(['open-page', target.kind]);
    targetConfig.resolvedTarget = resolveFreshPageTarget(target, { name: 'Catalog' });
    return { editorLink: '/editor/catalog', frontLink: '/catalog.html' };
  };
  adapter.prepareSettings = async () => {
    const prepared = await freshAdapter.prepare({ page: {}, canvas: frame, config: targetConfig, profile,
      report: { fixture: { applied: true } }, scopedSession, initialControls: controls });
    assert.deepEqual(prepared.persistedControls.map(({ region, controlIndex, type }) => ({ region, controlIndex, type })), [
      { region: '设置与选取数据', controlIndex: 0, type: 'radio' },
      { region: '设置与选取数据', controlIndex: 4, type: 'radio' },
    ]);
    return prepared;
  };
  const visibleValues = async () => state.controls.filter((item) => item.type === 'radio')
    .map((item) => ({ region: '设置与选取数据', label: item.name, type: 'radio', value: item.label,
      controlIndex: item.index, controlIdentity: `mock:${item.index}` }));
  adapter.readCurrentValues = visibleValues;
  adapter.readPublishedValues = async () => {
    assert.equal(targetConfig.resolvedTarget.page, 'Catalog');
    assert.equal(targetConfig.resolvedTarget.id, 'page-1');
    return visibleValues();
  };

  const report = await runFreshBlockFlow({ config: targetConfig, adapter });
  assert.ok(report.publishedReadback, JSON.stringify(report.flowErrors));
  assert.equal(report.publishedReadback.status, 'pass');
  assert.deepEqual(report.batches.map((batch) => batch.restoreBefore), [[], ['data-source']]);
  assert.ok(report.checks.some((item) => item.id === 'pld-data-source-persist' && item.status === 'fail'));
  assert.ok(report.retainedFailures.selectedIds.includes('pld-data-source-persist'));
  assert.ok(events.some((event) => Array.isArray(event) && event[0] === 'dialog-set'
    && event[1] === 'data-source' && event[2] === '所有产品'));
  assert.equal(state.controls.find((item) => item.name === 'data-source' && item.checked)?.label, '使用筛选条件');
  assert.ok(events.includes('dialog-save'));
  assert.ok(events.includes('page-save'));
});

test('persisted readback scope follows capability control references, not control labels', () => {
  const values = [
    { controlIdentity: 'a', controlIndex: 3, region: 'Settings', type: 'radio', label: 'Mode A', value: true },
    { controlIdentity: 'b', controlIndex: 8, region: 'Picker', type: 'checkbox', label: 'arbitrary CMS item', value: true },
  ];
  assert.deepEqual(projectPersistedFreshValues(values, [{ settingId: 'mode-check', region: 'Settings',
    controlIndex: 3, type: 'radio' }]), [values[0]]);
  assert.throws(() => projectPersistedFreshValues(values, [{ settingId: 'missing', region: 'Settings',
    controlIndex: 99, type: 'radio' }]), /resolved 0 inventory controls/);
  assert.throws(() => projectPersistedFreshValues([...values, { ...values[0], controlIdentity: 'duplicate' }],
    [{ settingId: 'ambiguous', region: 'Settings', controlIndex: 3, type: 'radio' }]), /resolved 2 inventory controls/);
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
    { controlIdentity: 'gallery:1:Settings:checkbox:Show name:name:0', controlIndex: 0, region: 'Settings', label: 'Show name', type: 'checkbox', value: true },
    { controlIdentity: 'gallery:1:Settings:text:Quantity:12:1', controlIndex: 1, region: 'Settings', label: 'Quantity', type: 'text', value: '12' },
    { controlIdentity: 'gallery:1:Settings:password:API key:[redacted]:2', controlIndex: 2, region: 'Settings', label: 'API key', type: 'password', value: '[redacted]' },
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
