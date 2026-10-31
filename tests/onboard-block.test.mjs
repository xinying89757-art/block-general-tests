import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertOnboardingOverwriteAllowed, buildDraftProfile, mapDiscoveredInventory } from '../src/onboard-block.mjs';
import { freshRailInventoryRegions } from '../src/fresh-block-browser-adapter.mjs';
import { validateProfile } from '../scripts/validate-profiles.mjs';

const template = JSON.parse(readFileSync(new URL('../profiles/TEMPLATE.json', import.meta.url), 'utf8'));

test('onboarding maps a unique generic signature and preserves unknown controls as unmapped', () => {
  const result = mapDiscoveredInventory([
    { kind: 'button-popover', type: 'phoenix_blocks_button', title: null, wrapIndex: 0, controls: [
      { index: 0, type: 'text', label: '按钮文本', value: 'Learn more' },
      { index: 1, type: 'text', label: 'Custom option', value: 'x' },
    ] },
  ]);
  assert.deepEqual(result.requirements.map((item) => item.id), ['btn-text']);
  assert.deepEqual(result.capabilities, [{ id: 'button-link', status: 'candidate' }]);
  assert.equal(result.unmapped.length, 1);
  assert.equal(result.unmapped[0].status, 'unmapped');
  assert.equal(result.unmapped[0].control.label, 'Custom option');
});

test('onboarding fails closed when one setting identity matches multiple regions', () => {
  const inventory = [0, 1].map((wrapIndex) => ({ kind: 'button-popover', type: 'phoenix_blocks_button',
    title: null, wrapIndex, controls: [{ index: 0, type: 'text', label: '按钮文本', value: 'Continue' }] }));
  assert.throws(() => mapDiscoveredInventory(inventory), /Ambiguous setting controls/);
});

test('onboarding reuses generic rail signatures for rail inventory regions', () => {
  const inventory = freshRailInventoryRegions('#123456', { radios: [{ value: '1200', label: '1200px', checked: true }],
    customVal: '', globalApply: false });
  const result = mapDiscoveredInventory(inventory);
  assert.deepEqual(result.requirements.map((item) => item.id).sort(), ['color-scheme', 'module-width']);
  assert.deepEqual(result.capabilities.map((item) => item.id).sort(), ['block-color-scheme', 'module-width']);
});

test('generated profile is a draft with only detected capabilities and no guessed fixture or baseline', () => {
  const mapping = mapDiscoveredInventory([{ kind: 'button-popover', type: 'phoenix_blocks_button', title: null,
    wrapIndex: 0, controls: [{ index: 0, type: 'text', label: '按钮文本', value: 'Continue' }] }]);
  const profile = buildDraftProfile(template, { blockId: 'generic-123',
    page: { kind: 'system', id: 'page-id', url: '/items.html', name: 'Items' }, mapping,
    observedAt: '2026-10-31T00:00:00.000Z' });
  assert.equal(profile.onboarding.status, 'draft-unreviewed');
  assert.equal(profile.blockId, 'generic-123');
  assert.equal(profile.target.pageId, 'page-id');
  assert.deepEqual(profile.requirements.capabilities.map((item) => item.id), ['btn-text']);
  assert.equal(Object.hasOwn(profile, 'fixture'), false);
  assert.equal(Object.hasOwn(profile, 'baseline'), false);
  assert.deepEqual(profile.onboarding.unmapped, []);
  assert.deepEqual(validateProfile(profile, template, { capabilities: new Set(['button-link']) }), []);
});

test('reviewed profiles cannot be overwritten without an explicit flag', () => {
  assert.throws(() => assertOnboardingOverwriteAllowed({ blockId: 'other' }), /explicit overwrite approval/);
  assert.equal(assertOnboardingOverwriteAllowed({ onboarding: { status: 'draft-unreviewed' } }), true);
  assert.equal(assertOnboardingOverwriteAllowed({ blockId: 'other' }, true), true);
  assert.equal(assertOnboardingOverwriteAllowed(null), true);
});
