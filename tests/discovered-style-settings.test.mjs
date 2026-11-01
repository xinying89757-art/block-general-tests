import test from 'node:test';
import assert from 'node:assert/strict';
import { isColorControlSurfaceVisible } from '../src/capabilities/rail.mjs';
import { identifyColorPanelInputs, planColorPanelWrites } from '../src/capabilities/rail.mjs';
import { alternateStyleControlValue, createDiscoveredStyleSettingUnits,
  discoverStyleControlCandidates, isColorSchemeInventoryRegion, styleControlKind } from '../src/discovered-style-settings.mjs';
import { createFreshSettingsAdapter } from '../src/fresh-settings-adapter.mjs';
import { freshRailInventoryRegions } from '../src/fresh-block-browser-adapter.mjs';
import { planSettingBatches } from '../src/batch-save.mjs';

function mockLifecycle(state, events) {
  return {
    kind: 'right-rail-flyout', isOpen: false,
    async open() { this.isOpen = true; events.push('open'); },
    async read(ref) { events.push(`read:${ref.controlIndex}`); return state[ref.controlIndex]; },
    async apply(ref, value) { events.push(`apply:${ref.controlIndex}`); state[ref.controlIndex] = value; },
    async commit() { events.push('commit'); this.isOpen = false; },
    async cancel() { events.push('cancel'); this.isOpen = false; },
  };
}

test('hidden picker input is inventory-visible through its rendered picker proxy', () => {
  assert.equal(isColorControlSurfaceVisible({ inputRendered: false, pickerRendered: true }), true);
  assert.equal(isColorControlSurfaceVisible({ inputRendered: false, pickerRendered: false }), false);
  assert.equal(isColorControlSurfaceVisible({ inputRendered: true, pickerRendered: false }), true);
});

test('single color value gets a stable identity for the generic writer', async () => {
  const [region] = freshRailInventoryRegions('#123456', null);
  assert.equal(region.controls.length, 1);
  assert.equal(region.controls[0].identity, 'position:0');
  assert.equal(region.controls[0].position, 0);
  const prepared = await createDiscoveredStyleSettingUnits({ inventory: [region],
    styleControlAdapter: { createLifecycle: async () => mockLifecycle({ 0: '#123456' }, []) } });
  assert.equal(prepared.settings.length, 1);
  assert.equal(prepared.settings[0].key, prepared.settings[0].requirementId);
  assert.equal(planSettingBatches(prepared.settings).length, 1,
    'discovered color units must be accepted by the shared batch planner');
  assert.equal(prepared.settings[0].locate.requirement.editorControl.identity, 'position:0');
  const actualInventory = identifyColorPanelInputs([{ name: 'scheme', label: 'Scheme', role: 'color',
    value: '#123456', position: 0 }]).controls;
  assert.deepEqual(planColorPanelWrites(actualInventory, { controlIdentity: 'position:0', value: '#654321' })
    .map(({ control, value }) => ({ identity: control.identity, value })),
  [{ identity: 'label:Scheme', value: '#654321' }]);
});

test('color control shapes are discovered without labels and become writable learned units', async () => {
  const inventory = [{ type: 'rail:color-scheme', title: 'right-rail-color', wrapIndex: 0,
    kind: 'right-rail-flyout', controls: [
      { index: 0, type: 'color', role: 'color', name: 'colorVal0', identity: 'name:colorVal0', position: 0, value: '#2f49b8' },
      { index: 1, type: 'color', role: 'color', name: 'colorVal1', identity: 'name:colorVal1', position: 1, value: 'rgb(242, 242, 245)' },
      { index: 2, type: 'color', role: 'color', name: 'colorVal2', identity: 'name:colorVal2', position: 2, value: '#EEF2F6' },
    ] }];
  assert.equal(discoverStyleControlCandidates(inventory).length, 3);
  assert.equal(discoverStyleControlCandidates(inventory, [{ region: 'right-rail-color', controlIndex: 0, type: 'color' }]).length, 2);
  const state = { 0: '#2f49b8', 1: 'rgb(242, 242, 245)', 2: '#EEF2F6' };
  const events = [];
  const lifecycle = mockLifecycle(state, events);
  const profile = { capabilities: [], requirements: { capabilities: [] }, onboarding: { pendingStyleEffects: [
    { requirementId: 'color-scheme', regionType: 'rail:color-scheme', wrapIndex: 0, controlIndex: 1,
      controlName: 'colorVal1', kind: 'color', property: 'color', status: 'pending' },
  ] } };
  const prepared = await createDiscoveredStyleSettingUnits({ inventory, profile,
    styleControlAdapter: { createLifecycle: async () => lifecycle } });
  assert.equal(prepared.settings.length, 3);
  assert.equal(new Set(prepared.settings.map((unit) => unit.key)).size, 3);
  assert.equal(planSettingBatches(prepared.settings).length, 1,
    'each discovered color control is a keyed batch setting');
  assert.deepEqual(prepared.settings.map((unit) => unit.styleEffect.properties.includes('color')), [true, true, true]);
  assert.equal(profile.requirements.capabilities.length, 3);
  assert.equal(profile.capabilities.find((item) => item.id === 'block-style-spec').styleSpec.items.length, 0,
    'null expected-value placeholders are not emitted as independent checks');
  assert.equal(profile.onboarding.pendingStyleEffects[0].settingUnitId, prepared.settings[1].id);
  assert.ok(profile.onboarding.pendingStyleEffects[0].checkIds.includes(`auto-style-${prepared.settings[1].id}-color`));
  for (const unit of prepared.settings) {
    await lifecycle.open();
    await unit.apply();
    const check = await unit.check();
    assert.equal(check.status, 'pass');
    await lifecycle.open();
    await unit.restore();
  }
  assert.ok(prepared.settings.every((unit) => /^#[0-9a-f]{6}$/i.test(unit.alternateValue)));
});

test('each discovered 区块配色 control receives a distinct alternate written value', async () => {
  const inventory = [{ type: 'rail:color-scheme', title: 'right-rail-color', controls: [
    { index: 0, type: 'color', identity: 'position:0', position: 0, value: '#123456' },
    { index: 1, type: 'color', identity: 'position:1', position: 1, value: '#123456' },
    { index: 2, type: 'color', identity: 'position:2', position: 2, value: '#123456' },
  ] }];
  const prepared = await createDiscoveredStyleSettingUnits({ inventory,
    styleControlAdapter: { createLifecycle: async () => mockLifecycle({}, []) } });
  assert.equal(prepared.settings.length, 3);
  assert.equal(new Set(prepared.settings.map((unit) => unit.alternateValue.toLowerCase())).size, 3);
});

test('palette setting results retain requested and actual-input readback and fail on mismatch', async () => {
  const inventory = [{ type: 'rail:color-scheme', title: 'right-rail-color', controls: [
    { index: 0, type: 'color', identity: 'position:0', position: 0, value: '#123456' },
  ] }];
  let state = '#123456';
  let mismatch = false;
  const lifecycle = { kind: 'right-rail-flyout', isOpen: false,
    async open() { this.isOpen = true; }, async read() { return state; },
    async apply(_ref, value) { state = value; return { setValue: value,
      readBackValue: mismatch ? '#000000' : value, matched: !mismatch }; },
    async cancel() { this.isOpen = false; }, async commit() { this.isOpen = false; } };
  const [unit] = (await createDiscoveredStyleSettingUnits({ inventory,
    styleControlAdapter: { createLifecycle: async () => lifecycle } })).settings;
  await lifecycle.open(); await unit.apply();
  const passed = await unit.check();
  assert.equal(passed.status, 'pass');
  assert.equal(passed.evidence.paletteWrite.setValue, unit.alternateValue);
  assert.equal(passed.evidence.paletteWrite.readBackValue, unit.alternateValue);
  assert.equal(passed.evidence.paletteWrite.source, 'actual-color-input-value');
  await lifecycle.cancel();
  mismatch = true;
  await lifecycle.open(); await unit.apply();
  const failed = await unit.check();
  assert.equal(failed.status, 'fail');
  assert.equal(failed.reason.code, 'palette-write-readback-mismatch');
  assert.equal(failed.evidence.paletteWrite.matches, false);
});

test('shared fresh adapter composes discovered style controls even when no capability maps them', async () => {
  const inventory = [{ type: 'rail:color-scheme', title: 'right-rail-color', wrapIndex: 0,
    kind: 'right-rail-flyout', controls: [
      { index: 0, type: 'color', role: 'color', identity: 'position:0', position: 0, value: '#123456' },
      { index: 1, type: 'color', role: 'color', identity: 'position:1', position: 1, value: '#654321' },
    ] }];
  let lifecycleCount = 0, persisted = 0;
  const profile = { blockId: 'generic', capabilities: [], requirements: { capabilities: [] } };
  const adapter = await createFreshSettingsAdapter({ capabilities: [], context: { profile,
    persistProfile: async () => { persisted += 1; } }, loadCapability: async () => ({} ) });
  const prepared = await adapter.prepare({ inventory,
    styleControlAdapter: { createLifecycle: async () => { lifecycleCount += 1; return mockLifecycle({}, []); } } });
  assert.equal(prepared.settings.length, 2);
  assert.deepEqual(prepared.capabilityResults, [{ capability: 'discovered-style-controls', status: 'adapted',
    settingIds: ['auto-style-rail-color-scheme-0-0-color', 'auto-style-rail-color-scheme-0-1-color'] }]);
  assert.equal(lifecycleCount, 1);
  assert.equal(profile.requirements.capabilities.length, 2);
  assert.equal(persisted, 1);
});

test('font-size shaped controls are not inferred as settings; width is not treated as font size', async () => {
  const inventory = [{ type: 'phoenix_blocks_text', title: 'Typography controls', wrapIndex: 0,
    kind: 'widget-dialog', controls: [
      { index: 0, tag: 'INPUT', type: 'text', name: 'control-a', label: 'Control A', value: '18px', readOnly: false },
      { index: 1, tag: 'INPUT', type: 'text', name: 'control-b', label: 'Control B', value: '1440px', styleProperty: 'width' },
    ] }];
  assert.equal(styleControlKind(inventory[0].controls[0]), null);
  assert.equal(styleControlKind(inventory[0].controls[1]), null);
  assert.deepEqual(discoverStyleControlCandidates(inventory).map((item) => item.kind), []);
  assert.equal(alternateStyleControlValue('font-size', '18px'), '19px');
  assert.equal(alternateStyleControlValue('font-size', '1.25rem'), '2.25rem');
});

test('color controls are discovered only from the 区块配色 section or shared rail surface', () => {
  assert.equal(isColorSchemeInventoryRegion({ type: 'rail:color-scheme' }), true);
  assert.equal(isColorSchemeInventoryRegion({ type: 'widget', title: 'Block settings' }, { section: '区块配色' }), true);
  assert.equal(isColorSchemeInventoryRegion({ type: 'widget', title: 'Other settings' }, { value: '#112233' }), false);
});

test('ambiguous or read-only style controls fail closed instead of producing units', () => {
  const inventory = [{ type: 'rail:color-scheme', title: 'right-rail-color', controls: [
    { index: 0, type: 'color', value: '#123456', inventoryNote: 'ambiguous' },
    { index: 1, type: 'text', value: '18px', readOnly: true },
  ] }];
  assert.deepEqual(discoverStyleControlCandidates(inventory), []);
});
