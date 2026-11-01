import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './fixtures/style-effect-snapshots.json' with { type: 'json' };
import { createFreshSettingsAdapter } from '../src/fresh-settings-adapter.mjs';
import { registerFreshSettingsCapability } from '../src/setting-units.mjs';
import { resolveInstanceRootIndexes } from '../src/front-instance-root.mjs';
import { applyLearnedStyleEffects, deriveSelectorCandidatesFromDom, deriveStyleEffectPaths,
  chooseSelectorCandidate, normalizeStyleValue, resolveSettingStyleEffect, snapshotInstanceComputedStyles,
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
    { tag: 'nav', classes: ['blockCon12345', 'category-nav'], nthOfType: 2 },
    { tag: 'a', classes: ['leaf'], nthOfType: 1 },
  ]), 'nav.category-nav:nth-of-type(2) > a.leaf:nth-of-type(1)');
});

test('profile selectors are mapped automatically and candidates can be derived from DOM features', () => {
  const profile = { capabilities: [{ id: 'block-style-spec', styleSpec: { items: [{ id: 'pagination-current' }] } }] };
  const learned = deriveStyleEffectPaths(fixture.before, fixture.after, { properties: ['backgroundColor'],
    checks: [{ property: 'backgroundColor', checkId: 'pagination-current' }] });
  const result = applyLearnedStyleEffects(profile, { checks: [{ property: 'backgroundColor', checkId: 'pagination-current' }] }, learned);
  assert.equal(result.status, 'learned');
  assert.ok(profile.capabilities[0].styleSpec.items[0].learnedSelectors.backgroundColor[0].selector.includes('nav'));
  assert.deepEqual(deriveSelectorCandidatesFromDom([{ feature: 'pagination', pathFeatures: fixture.after[1].pathFeatures }])
    .map((entry) => entry.feature), ['pagination-structure']);
  assert.deepEqual(chooseSelectorCandidate(['first', 'second'], [0, 2]), { status: 'resolved', index: 1, matchCount: 2 });
  assert.deepEqual(chooseSelectorCandidate(['first', 'second'], [0, 0]), {
    status: 'unresolved', reason: 'no-profile-selector-candidate-matched', attemptedCount: 2,
  });
});

test('front root resolution requires block number and settingId and fails closed on duplicates', () => {
  const records = [{ blockId: 'A', settingIds: ['one'] }, { blockId: 'A', settingIds: ['two'] }, { blockId: 'B', settingIds: ['one'] }];
  assert.deepEqual(resolveInstanceRootIndexes(records, { blockId: 'A', settingId: 'two' }).indexes, [1]);
  assert.equal(resolveInstanceRootIndexes(records, { blockId: 'A' }).status, 'unavailable');
  assert.equal(resolveInstanceRootIndexes([...records, records[1]], { blockId: 'A', settingId: 'two' }).status, 'unavailable');
});

test('canvas style snapshots request the exact block and settingId root', async () => {
  const calls = [];
  const canvas = { locator(selector) { assert.equal(selector, 'body'); return { evaluate: async (_fn, args) => {
    calls.push(args); return { status: 'ok', elements: fixture.before };
  } }; } };
  const snapshot = await snapshotInstanceComputedStyles(canvas, { blockId: 'instance-type', settingId: 'instance-1',
    properties: ['backgroundColor'] });
  assert.equal(calls[0].blockId, 'instance-type');
  assert.equal(calls[0].settingId, 'instance-1');
  assert.equal(snapshot.elements[0].path, fixture.before[0].path);
});

test('fresh batch adapter snapshots before and after apply, persists learned profile path, and omits paths from diagnostics', async () => {
  let snapshotIndex = 0;
  const canvas = { locator() { return { evaluate: async () => ({ status: 'ok', elements: snapshotIndex++ === 0 ? fixture.before : fixture.after }) }; } };
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
  await prepared.batchAdapter.save({ reason: 'test' });
  assert.equal(persisted, 1);
  const stored = profile.capabilities[0].styleSpec.items[0].learnedSelectors.backgroundColor[0];
  assert.equal(stored.expectedValue, 'rgb(255, 0, 0)');
  assert.doesNotMatch(JSON.stringify(prepared.styleScopeDiagnostics), /selector|path/);
  assert.equal(prepared.styleScopeDiagnostics[0].status, 'learned');
});
