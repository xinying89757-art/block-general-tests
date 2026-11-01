import test from 'node:test';
import assert from 'node:assert/strict';
import profile47748 from '../profiles/47748.json' with { type: 'json' };
import {
  adaptCapabilityDefinitions, assertAutotestTotalCount, assertFixedValueFront,
  createProfileRadioSettingUnit, createSettingUnit, discoverProfileFrontUnits,
  registerFreshSettingsCapability, runFrontSettingUnits,
} from '../src/setting-units.mjs';

const unitInput = (overrides = {}) => ({
  id: 'setting-a', capability: 'sample-capability', requirementId: 'setting-a',
  locate: { source: 'requirement-profile', id: 'setting-a' }, lifecycleSurface: 'settings-dialog',
  dependencies: [], persistedControls: [], alternateValue: 'alternate',
  apply: async () => {}, editorCheck: async () => ({ status: 'pass' }), restore: async () => {},
  frontRequires: [], ...overrides,
});

test('setting-unit contract accepts complete units and fails closed on missing contract members', () => {
  assert.equal(createSettingUnit(unitInput()).id, 'setting-a');
  assert.throws(() => createSettingUnit(unitInput({ restore: null })), /requires restore/);
  assert.throws(() => createSettingUnit(unitInput({ locate: { source: 'hardcoded-selector', id: 'setting-a' } })), /requirement profile/);
  assert.throws(() => createSettingUnit(unitInput({ lifecycleSurface: 'unknown' })), /unsupported lifecycle/);
  assert.throws(() => createSettingUnit(unitInput({ styleEffect: { properties: [], checks: [] } })), /styleEffect requires/);
});

test('six adapted capability wrappers expose the existing callback definitions as setting units', async () => {
  const capabilities = ['button-link', 'product-category-select', 'custom-filter-fields',
    'product-list-display', 'block-color-scheme', 'module-width'];
  const profile = { requirements: { capabilities: capabilities.map((id) => ({ id: `${id}-setting` })) } };
  for (const capability of capabilities) {
    const legacy = { id: `${capability}-persist`, key: `${capability}-setting`,
      initialValue: 'before', value: 'after', apply: async () => {}, check: async () => ({ status: 'pass' }),
      restore: async () => {} };
    const registered = registerFreshSettingsCapability(capability, async () => ({
      settings: [legacy], persistedControls: [{ settingId: legacy.id, region: 'dialog', controlIndex: 0, type: 'radio' }],
    }));
    const created = await registered.createDefinitions({ profile });
    assert.equal(created.settings.length, 1, capability);
    const [unit] = created.settings;
    assert.equal(unit.capability, capability);
    assert.equal(unit.requirementId, `${capability}-setting`);
    assert.equal(unit.lifecycleSurface, 'settings-dialog');
    assert.equal(unit.alternateValue, 'after');
    assert.equal(unit.editorCheck, legacy.check);
    assert.equal(unit.persistedControls.length, 1);
    assert.equal(typeof unit.apply, 'function');
    assert.equal(typeof unit.restore, 'function');
  }
});

test('real 47748 profile requirement ids anchor every migrated capability unit', () => {
  const cases = [
    ['button-link', ['btn-text-persist', 'btn-url-persist', 'btn-target-persist'], ['btn-text', 'btn-url', 'btn-target']],
    ['product-category-select', ['pcs-category-persist'], ['product-category']],
    ['custom-filter-fields', ['cff-settings-persist'], ['cff-fields']],
    ['product-list-display', ['pld-data-source-persist', 'pld-page-size-persist', 'pld-pagination-persist', 'pld-display-field-persist'],
      ['pld-data-source', 'pld-page-size', 'pld-pagination', 'pld-display-fields']],
    ['block-color-scheme', ['bcs-color-persist'], ['color-scheme']],
    ['module-width', ['mw-width-persist'], ['module-width']],
  ];
  for (const [capability, ids, requirements] of cases) {
    const settings = ids.map((id, index) => ({ id, key: `key-${index}`, initialValue: false, value: true,
      apply: async () => {}, check: async () => ({ status: 'pass' }), restore: async () => {} }));
    const mapped = adaptCapabilityDefinitions({ capability, profile: profile47748,
      created: { settings, persistedControls: [] } });
    assert.deepEqual(mapped.settings.map((unit) => unit.requirementId), requirements, capability);
  }
});

test('profile style-effect overrides stay intact and automatic checks cover other color properties', () => {
  const profile = structuredClone(profile47748);
  const requirement = profile.requirements.capabilities.find((item) => item.id === 'color-scheme');
  const output = adaptCapabilityDefinitions({ capability: 'block-color-scheme', profile,
    created: { settings: [{ id: 'bcs-color-persist', key: 'scheme-color', initialValue: '#111111', value: '#ff0000',
      apply: async () => {}, check: async () => ({ status: 'pass' }), restore: async () => {} }], persistedControls: [] } });
  assert.deepEqual(output.settings[0].styleEffect.properties, ['color', 'backgroundColor', 'accentColor', 'borderColor',
    'outlineColor', 'textDecorationColor', 'caretColor', 'columnRuleColor', 'fill', 'stroke']);
  assert.deepEqual(output.settings[0].styleEffect.checks.slice(0, 2), requirement.styleEffect.checks);
  assert.equal(output.settings[0].styleEffect.settingUnitId, 'bcs-color-persist');
  assert.equal(output.settings[0].styleEffect.checks.length, 11);
  assert.equal(output.settings[0].styleEffect.checks[0].checkId, 'button-bg');
  assert.ok(profile.capabilities.find((entry) => entry.id === 'block-style-spec').styleSpec.items
    .some((item) => item.autoLearned && item.settingUnitId === 'bcs-color-persist'));
});

test('color and font-size setting values automatically receive generic style effects and pending profile checks', () => {
  const profile = { requirements: { capabilities: [{ id: 'color-control' }, { id: 'size-control' }] }, capabilities: [] };
  const settings = [
    { id: 'color-setting', key: 'color-control', type: 'text', initialValue: '#000000', value: '#ff0000',
      apply: async () => {}, check: async () => ({ status: 'pass' }), restore: async () => {} },
    { id: 'size-setting', key: 'size-control', type: 'font-size', initialValue: '12px', value: '18px',
      apply: async () => {}, check: async () => ({ status: 'pass' }), restore: async () => {} },
  ];
  const output = adaptCapabilityDefinitions({ capability: 'style-controls', profile,
    created: { settings, persistedControls: [] } });
  assert.deepEqual(output.settings[0].styleEffect.properties, ['color', 'backgroundColor', 'borderColor', 'outlineColor',
    'textDecorationColor', 'accentColor', 'caretColor', 'columnRuleColor', 'fill', 'stroke']);
  assert.deepEqual(output.settings[1].styleEffect.properties, ['fontSize']);
  const items = profile.capabilities.find((entry) => entry.id === 'block-style-spec').styleSpec.items;
  assert.deepEqual(items.map((entry) => entry.settingUnitId), ['color-setting', 'color-setting', 'color-setting', 'color-setting',
    'color-setting', 'color-setting', 'color-setting', 'color-setting', 'color-setting', 'color-setting', 'size-setting']);
  assert.ok(items.every((entry) => entry.selectorLearningPending && entry.learnedSelectorRequired));
  assert.ok(items.every((entry) => !Object.hasOwn(entry, 'selector')));
});

test('whole-list definitions are represented as one unit and keep existing callbacks unchanged', () => {
  const apply = async () => 'apply'; const check = async () => ({ status: 'pass' }); const restore = async () => 'restore';
  const source = { id: 'list-selection', key: 'selection', initialValue: { selected: ['a', 'b'] },
    value: { selected: ['b'] }, apply, check, restore };
  const output = adaptCapabilityDefinitions({ capability: 'list-capability', profile: { requirements: { capabilities: [{ id: 'selection' }] } },
    created: { settings: [source], persistedControls: [] } });
  assert.equal(output.settings[0].lifecycleSurface, 'whole-list');
  assert.equal(output.settings[0].apply, apply);
  assert.equal(output.settings[0].editorCheck, check);
  assert.equal(output.settings[0].restore, restore);
});

test('a single whole-list unit owns all persisted controls in its transaction', () => {
  const settings = [{ id: 'list', key: 'list', initialValue: { selected: ['a', 'b'] }, value: { selected: ['b'] },
    apply: async () => {}, check: async () => ({ status: 'pass' }), restore: async () => {} }];
  const refs = ['mode', 'item-a', 'item-b'].map((label, controlIndex) => ({ region: 'category', controlIndex, type: 'checkbox', label }));
  const output = adaptCapabilityDefinitions({ capability: 'list-capability', created: { settings, persistedControls: refs } });
  assert.deepEqual(output.settings[0].persistedControls, refs);
});

test('legacy positional persisted-control declarations are preserved only for an exact one-to-one list', () => {
  const settings = ['a', 'b', 'c'].map((id) => ({ id, key: id, initialValue: false, value: true,
    apply: async () => {}, check: async () => ({ status: 'pass' }), restore: async () => {} }));
  const refs = [0, 1, 2].map((controlIndex) => ({ region: 'popover', controlIndex, type: 'checkbox' }));
  const exact = adaptCapabilityDefinitions({ capability: 'cap', created: { settings, persistedControls: refs } });
  assert.deepEqual(exact.settings.map((unit) => unit.persistedControls[0]?.controlIndex), [0, 1, 2]);
  const ambiguous = adaptCapabilityDefinitions({ capability: 'cap', created: { settings, persistedControls: refs.slice(0, 2) } });
  assert.deepEqual(ambiguous.settings.map((unit) => unit.persistedControls.length), [0, 0, 0]);
});

test('a capability setting absent from a non-empty requirement profile fails closed', () => {
  const setting = { id: 'undeclared-setting', key: 'undeclared', initialValue: false, value: true,
    apply: async () => {}, check: async () => ({ status: 'pass' }), restore: async () => {} };
  assert.throws(() => adaptCapabilityDefinitions({ capability: 'cap', profile: {
    requirements: { capabilities: [{ id: 'different-setting' }] },
  }, created: { settings: [setting], persistedControls: [] } }), /no matching requirement/);
});

test('profile radio unit applies, checks and restores only its declared alternate option', async () => {
  const requirement = { id: 'block-expand-collapse', unitId: 'expand-collapse', alternateValue: 'collapsed',
    editorControl: { type: 'radio', options: [{ value: 'expanded' }, { value: 'collapsed' }] } };
  let value = 'expanded'; let saves = 0;
  const unit = await createProfileRadioSettingUnit(requirement, {
    read: async () => value, write: async (_req, next) => { value = next; }, save: async () => { saves += 1; },
  });
  await unit.apply(); assert.equal(value, 'collapsed');
  assert.equal((await unit.editorCheck()).status, 'pass');
  await unit.restore(); assert.equal(value, 'expanded');
  assert.equal(saves, 0, 'batch runner owns the one save per batch');
  await assert.rejects(() => createProfileRadioSettingUnit(requirement, {}), /requires editorAdapter/);
});

test('absent optional units are not-applicable and declared front units stay deferred without a reader', async () => {
  const discovered = await discoverProfileFrontUnits(profile47748);
  assert.deepEqual(discovered.results.map((item) => item.status), ['not-applicable', 'not-applicable']);
  assert.equal(discovered.units.filter((unit) => unit.requirementId === 'pld-product-count').length, 1);
  assert.equal(discovered.units.filter((unit) => unit.requirementId.startsWith('cff-')).length, 3);
  const checks = await runFrontSettingUnits(discovered.units, { profile: profile47748, frontAvailable: false });
  assert.equal(checks.length, 4);
  assert.ok(checks.every((item) => item.status === 'deferred'));
});

test('fixed-value front oracle is exact and profile locators are mandatory for an accessible front run', async () => {
  assert.equal(assertFixedValueFront('fixed', 'fixed').status, 'pass');
  const mismatch = assertFixedValueFront('fixed', 'different');
  assert.equal(mismatch.status, 'fail');
  assert.equal(mismatch.expected, 'fixed');
  const profile = { requirements: { capabilities: [{ id: 'visible-value', mode: 'fixed-front', fixedValue: 'known',
    frontAssertion: { kind: 'text', selector: '[data-value]' } }] } };
  const unit = (await discoverProfileFrontUnits(profile)).units[0];
  assert.equal((await unit.frontCheck({ profile, frontAvailable: true,
    readValue: async (assertion) => assertion.selector === '[data-value]' ? 'known' : null })).status, 'pass');
  assert.equal((await unit.frontCheck({ profile, frontAvailable: true,
    readValue: async () => 'wrong' })).status, 'fail');
});

test('declared expand/enable radio units compose through the profile editor adapter', async () => {
  const profile = { requirements: { capabilities: [{ id: 'block-expand-collapse', unitId: 'expand', alternateValue: 'collapsed',
    editorControl: { type: 'radio', options: [{ value: 'expanded' }, { value: 'collapsed' }] } }] } };
  let value = 'expanded';
  const discovered = await discoverProfileFrontUnits(profile, { profileEditorAdapter: {
    read: async () => value, write: async (_requirement, next) => { value = next; },
  } });
  assert.equal(discovered.editorSettings.length, 1);
  const [unit] = discovered.editorSettings;
  assert.equal(unit.id, 'expand');
  await unit.apply(); assert.equal(value, 'collapsed');
  assert.equal((await unit.check()).status, 'pass');
  await unit.restore(); assert.equal(value, 'expanded');
});

test('total-count oracle requires all AUTOTEST fixtures and respects quantity without whole-site equality', () => {
  const pass = assertAutotestTotalCount({ fixtureNames: ['AUTOTEST-A', 'AUTOTEST-B'],
    actualNames: ['AUTOTEST-A', 'AUTOTEST-B', 'site-product'], quantity: 3 });
  assert.equal(pass.status, 'pass');
  assert.deepEqual(pass.actual.fixtureCounts, { 'AUTOTEST-A': 1, 'AUTOTEST-B': 1 });
  assert.equal(assertAutotestTotalCount({ fixtureNames: ['AUTOTEST-A', 'AUTOTEST-B'],
    actualNames: ['AUTOTEST-A', 'site-product'], quantity: 3 }).status, 'fail');
  assert.equal(assertAutotestTotalCount({ fixtureNames: [], actualNames: ['site-product'], quantity: 3 }).status, 'skip');
});
