import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './fixtures/style-effect-snapshots.json' with { type: 'json' };
import { createFreshLifecycle, createFreshSettingsAdapter } from '../src/fresh-settings-adapter.mjs';
import { registerFreshSettingsCapability } from '../src/setting-units.mjs';
import { resolveInstanceRootIndexes } from '../src/front-instance-root.mjs';
import { applyLearnedStyleEffects, deriveSelectorCandidatesFromDom, deriveStyleEffectPaths,
  chooseSelectorCandidate, ensureStyleEffectProfileEntries, inferStyleValueKind, normalizeStyleValue,
  normalizeProfileSelectorCandidates, resolveCanvasInstanceRootIndex, resolveSettingStyleEffect, snapshotInstanceComputedStyles,
  stableRelativeSelectorPath } from '../src/style-effect-learning.mjs';

test('computed-style diff learns only changed properties and omits generated block-number classes', () => {
  const learned = deriveStyleEffectPaths(fixture.before, fixture.after, { properties: ['backgroundColor'] });
  assert.equal(learned.status, 'learned');
  assert.deepEqual(learned.effects.map(({ property, expectedValue }) => [property, expectedValue]), [
    ['backgroundColor', 'rgb(255, 0, 0)'], ['backgroundColor', 'rgb(255, 0, 0)'],
  ]);
  assert.doesNotMatch(JSON.stringify(learned), /blockCon47748/);
  assert.equal(normalizeStyleValue('backgroundColor', '#f00'), 'rgb(255,0,0)');
});

test('style-value inference uses unit type and CSS value shape, never setting names', () => {
  assert.equal(inferStyleValueKind({ id: 'arbitrary-a', value: '#aabbcc' }), 'color');
  assert.equal(inferStyleValueKind({ id: 'arbitrary-b', type: 'font-size', value: 18 }), 'font-size');
  assert.equal(inferStyleValueKind({ id: 'color-named-setting', value: '18' }), null);
  assert.equal(inferStyleValueKind({ id: 'size-setting', value: '1.25rem' }), null);
  assert.equal(inferStyleValueKind({ id: 'explicit-size-setting', type: 'font-size', value: '1.25rem' }), 'font-size');
  assert.equal(inferStyleValueKind({ id: 'unrelated-dimension', styleProperty: 'width', value: '1200px' }), null);
});

test('effect scope requires the computed property to equal the style value written by the setting', () => {
  const effect = resolveSettingStyleEffect({ alternateValue: '#ff0000', styleEffect: {
    properties: ['backgroundColor'], valueSource: 'alternateValue', checks: [],
  } });
  assert.deepEqual(effect.expectedValues, { backgroundColor: '#ff0000' });
  const mismatch = deriveStyleEffectPaths(fixture.before, fixture.after, { ...effect,
    expectedValues: { backgroundColor: '#0000ff' } });
  assert.deepEqual(mismatch, { status: 'na', reason: 'changed-style-did-not-match-written-value', effects: [] });
});

test('unchanged editor canvas styles return machine-readable na instead of guessing', () => {
  const outcome = deriveStyleEffectPaths(fixture.before, fixture.before, { properties: ['backgroundColor'] });
  assert.deepEqual(outcome, { status: 'na', reason: 'no-computed-style-property-changed', effects: [] });
});

test('unresolved effect snapshots add only same-profile feature candidates and remain na', () => {
  const profile = { capabilities: [{ id: 'style', styleSpec: { items: [
    { id: 'target-check', selectorCandidates: ['.existing'] }, { id: 'other-check' },
  ] } }] };
  const candidates = deriveSelectorCandidatesFromDom([{ pathFeatures: fixture.after[1].pathFeatures,
    features: { pagination: true, link: false, text: true } }]);
  const result = applyLearnedStyleEffects(profile, { checks: [{ property: 'backgroundColor', checkId: 'target-check' }],
    candidateSelectors: ['.profile-fallback'] }, { status: 'na', reason: 'no-computed-style-property-changed', effects: [],
    candidateSelectors: candidates.map((entry) => entry.selector) });
  assert.equal(result.status, 'na');
  assert.equal(result.reason, 'no-computed-style-property-changed');
  assert.ok(profile.capabilities[0].styleSpec.items[0].selectorCandidates.includes('.profile-fallback'));
  assert.deepEqual(profile.capabilities[0].styleSpec.items[1].selectorCandidates, undefined);
});

test('stable instance-relative paths use structure and class features without blockCon classes', () => {
  assert.equal(stableRelativeSelectorPath([
    { tag: 'nav', classes: ['location_blockCon12345_pack', 'category-nav'], nthOfType: 2 },
    { tag: 'a', classes: ['leaf'], nthOfType: 1 },
  ]), 'nav.category-nav:nth-of-type(2) > a.leaf:nth-of-type(1)');
});

test('profile selector normalization removes generated block classes but preserves stable confirmed candidates', () => {
  const profile = { capabilities: [{ id: 'block-style-spec', styleSpec: { items: [
    { id: 'confirmed', selectorCandidates: ['.stable-action', '.location_blockCon123_pack .child', '.unstable:nth-of-type(2)'] },
    { id: 'learned', autoLearned: true, learnedSelectorRequired: true, selector: '.blockCon987', selectorCandidates: ['.blockCon987 .child'],
      learnedSelectors: { color: [{ selector: '.location_blockCon987_pack a', expectedValue: '#fff' }] } },
  ] } }] };
  assert.deepEqual(normalizeProfileSelectorCandidates(profile), { removed: 5 });
  assert.deepEqual(profile.capabilities[0].styleSpec.items[0].selectorCandidates, ['.stable-action']);
  assert.equal(profile.capabilities[0].styleSpec.items[1].selector, undefined);
  assert.equal(profile.capabilities[0].styleSpec.items[1].selectorCandidates, undefined);
  assert.deepEqual(profile.capabilities[0].styleSpec.items[1].learnedSelectors, {});
  assert.equal(profile.capabilities[0].styleSpec.items[1].selectorLearningPending, true);
});

test('profile selectors are mapped automatically and candidates can be derived from DOM features', () => {
  const profile = { capabilities: [{ id: 'block-style-spec', styleSpec: { items: [{ id: 'pagination-current' }] } }] };
  const learned = deriveStyleEffectPaths(fixture.before, fixture.after, { properties: ['backgroundColor'],
    checks: [{ property: 'backgroundColor', checkId: 'pagination-current' }] });
  const result = applyLearnedStyleEffects(profile, { checks: [{ property: 'backgroundColor', checkId: 'pagination-current' }] }, learned);
  assert.equal(result.status, 'learned');
  assert.ok(profile.capabilities[0].styleSpec.items[0].learnedSelectors.backgroundColor
    .some((entry) => entry.selector.includes('nav')));
  assert.deepEqual(deriveSelectorCandidatesFromDom([{ feature: 'pagination', pathFeatures: fixture.after[1].pathFeatures }])
    .map((entry) => entry.feature), ['pagination-structure']);
  assert.deepEqual(chooseSelectorCandidate(['first', 'second'], [0, 2]), { status: 'resolved', index: 1, matchCount: 2 });
  assert.deepEqual(chooseSelectorCandidate(['first', 'second'], [0, 0]), {
    status: 'unresolved', reason: 'no-profile-selector-candidate-matched', attemptedCount: 2,
  });
});

test('one setting keeps every changed element in its learned scope and marks onboarding entries learned', () => {
  const profile = { onboarding: { pendingStyleEffects: [{ settingUnitId: 'setting-a', property: 'backgroundColor', status: 'pending' }] },
    capabilities: [{ id: 'block-style-spec', styleSpec: { items: [{ id: 'auto-check', autoLearned: true,
      props: {}, learnedSelectorRequired: true }] } }] };
  const result = applyLearnedStyleEffects(profile, { settingUnitId: 'setting-a', checks: [
    { property: 'backgroundColor', checkId: 'auto-check' },
  ] }, { effects: [
    { selector: 'a.first', property: 'backgroundColor', expectedValue: 'rgb(255, 0, 0)' },
    { selector: 'a.second', property: 'backgroundColor', expectedValue: 'rgb(255, 0, 0)' },
  ] });
  assert.equal(result.status, 'learned');
  assert.deepEqual(profile.capabilities[0].styleSpec.items[0].learnedSelectors.backgroundColor.map((entry) => entry.selector), ['a.first', 'a.second']);
  assert.equal(profile.capabilities[0].styleSpec.items[0].selectorLearningPending, false);
  assert.equal(profile.onboarding.pendingStyleEffects[0].status, 'learned');
});

test('front root resolution requires block number and settingId and fails closed on duplicates', () => {
  const records = [{ blockId: 'A', settingIds: ['one'] }, { blockId: 'A', settingIds: ['two'] }, { blockId: 'B', settingIds: ['one'] }];
  assert.deepEqual(resolveInstanceRootIndexes(records, { blockId: 'A', settingId: 'two' }).indexes, [1]);
  assert.equal(resolveInstanceRootIndexes(records, { blockId: 'A' }).status, 'unavailable');
  assert.equal(resolveInstanceRootIndexes([...records, records[1]], { blockId: 'A', settingId: 'two' }).status, 'unavailable');
});

test('editor canvas root resolution uses only the target block wrapper and settingId', () => {
  const rows = [
    { blockId: 'other', settingIds: ['same'] },
    { blockId: '47498', settingIds: ['siteblocks-setting-wrap-target'] },
  ];
  assert.deepEqual(resolveCanvasInstanceRootIndex(rows, { blockId: '47498', settingId: 'target' }), {
    status: 'resolved', index: 1, matchCount: 1, reason: null,
  });
  assert.equal(resolveCanvasInstanceRootIndex(rows, { blockId: '47498', settingId: 'missing' }).matchCount, 0);
  assert.equal(resolveCanvasInstanceRootIndex([...rows, rows[1]], { blockId: '47498', settingId: 'target' }).matchCount, 2);
});

test('canvas style snapshots request the exact block and settingId root', async () => {
  const calls = [];
  const canvas = { locator(selector) { assert.equal(selector, 'body'); return { evaluate: async (_fn, args) => {
    calls.push(args);
    if (calls.length === 1) return [{ blockId: 'instance-type', settingIds: ['siteblocks-setting-wrap-instance-1'] }];
    return { status: 'ok', elements: fixture.before };
  } }; } };
  const snapshot = await snapshotInstanceComputedStyles(canvas, { blockId: 'instance-type', settingId: 'instance-1',
    properties: ['backgroundColor'] });
  assert.equal(calls[1].wrapperIndex, 0);
  assert.equal(snapshot.elements[0].path, fixture.before[0].path);
});

test('canvas style snapshot re-resolves the same instance after a transient wrapper detach', async () => {
  let call = 0;
  const canvas = { locator() { return { evaluate: async () => {
    call += 1;
    if (call === 1 || call === 3) return [{ blockId: 'block', settingIds: ['target'] }];
    if (call === 2) return { status: 'unavailable', reason: 'target-wrapper-detached', matchCount: 0, elements: [] };
    return { status: 'ok', elements: fixture.before };
  } }; } };
  const snapshot = await snapshotInstanceComputedStyles(canvas, { blockId: 'block', settingId: 'target',
    properties: ['color'], timeoutMs: 500 });
  assert.equal(snapshot.status, 'ok');
  assert.equal(call, 4);
});

test('fresh batch adapter snapshots before and after apply, persists learned profile path, and omits paths from diagnostics', async () => {
  let snapshotIndex = 0;
  let callIndex = 0;
  const canvas = { locator() { return { evaluate: async () => {
    if (callIndex++ % 2 === 0) return [{ blockId: 'block-type', settingIds: ['setting-42'] }];
    return { status: 'ok', elements: snapshotIndex++ === 0 ? fixture.before : fixture.after };
  } }; } };
  const requirement = { id: 'scheme-setting', styleEffect: { properties: ['backgroundColor'], valueSource: 'alternateValue',
    checks: [{ property: 'backgroundColor', checkId: 'button-bg' }] } };
  const profile = { requirements: { capabilities: [requirement] }, capabilities: [{ id: 'block-style-spec',
    styleSpec: { items: [{ id: 'button-bg', learnedSelectorRequired: true }] } }] };
  let persisted = 0;
  const freshSettings = registerFreshSettingsCapability('sample-style', async () => ({ settings: [{
    id: 'scheme-color', key: 'scheme-setting', initialValue: '#111111', value: '#ff0000', alternateValue: '#ff0000',
    apply: async () => {}, check: async () => ({ status: 'pass' }), restore: async () => {},
  }], persistedControls: [] }));
  const adapter = await createFreshSettingsAdapter({ capabilities: ['sample-style'], context: {
    blockId: 'block-type', config: { blockId: 'block-type', freshSettingId: 'setting-42', actionTimeoutMs: 1000 },
    canvas, profile, save: async () => {}, persistProfile: async () => { persisted += 1; },
  }, loadCapability: async () => ({ freshSettings }) });
  const prepared = await adapter.prepare();
  const [setting] = prepared.settings;
  await prepared.batchAdapter.apply(setting, { phase: 'batch' });
  assert.equal(snapshotIndex, 2, 'both snapshots bracket apply before the batch save');
  await prepared.batchAdapter.save({ reason: 'test' });
  assert.equal(persisted, 1);
  const stored = profile.capabilities[0].styleSpec.items[0].learnedSelectors.backgroundColor[0];
  assert.equal(stored.expectedValue, 'rgb(255, 0, 0)');
  assert.doesNotMatch(JSON.stringify(prepared.styleScopeDiagnostics), /selector|path/);
  assert.equal(prepared.styleScopeDiagnostics[0].status, 'learned');
});

test('style before-snapshot runs before opening the first setting surface and before apply writes', async () => {
  const order = [];
  let snapshotIndex = 0;
  let callIndex = 0;
  const canvas = { locator() { return { evaluate: async () => {
    order.push(callIndex++ % 2 === 0 ? 'identity-scan' : 'snapshot');
    if (callIndex % 2 === 1) return [{ blockId: 'block', settingIds: ['setting'] }];
    return { status: 'ok', elements: snapshotIndex++ === 0 ? fixture.before : fixture.after };
  } }; } };
  const lifecycle = createFreshLifecycle('right-rail-flyout', { open: async () => { order.push('surface-open'); },
    read: async () => '#111111', apply: async () => {}, commit: async () => { order.push('surface-commit'); },
    cancel: async () => {} });
  const freshSettings = registerFreshSettingsCapability('surface-order', async () => ({ settings: [{
    id: 'color-unit', key: 'color-unit', lifecycle, alternateValue: '#ff0000', initialValue: '#111111',
    styleEffect: { properties: ['backgroundColor'], valueSource: 'alternateValue', expectedValues: { backgroundColor: '#ff0000' },
      checks: [{ property: 'backgroundColor', checkId: 'color-effect' }] },
    apply: async () => { order.push('write'); }, check: async () => ({ status: 'pass' }),
    restore: async () => {},
  }], persistedControls: [] }));
  const adapter = await createFreshSettingsAdapter({ capabilities: ['surface-order'], context: {
    blockId: 'block', config: { blockId: 'block', freshSettingId: 'setting', actionTimeoutMs: 1000 }, canvas,
    profile: { capabilities: [{ id: 'block-style-spec', styleSpec: { items: [{ id: 'color-effect' }] } }] },
    save: async () => {},
  }, loadCapability: async () => ({ freshSettings }) });
  const prepared = await adapter.prepare();
  await prepared.batchAdapter.apply(prepared.settings[0], { phase: 'batch' });
  assert.deepEqual(order.slice(0, 4), ['identity-scan', 'snapshot', 'surface-open', 'write']);
  assert.equal(order.filter((item) => item === 'snapshot').length, 2);
});
