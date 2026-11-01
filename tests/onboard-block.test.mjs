import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertOnboardingOverwriteAllowed, buildDraftProfile, buildOnboardingEnvironmentReport,
  classifyOnboardingEnvironmentOutcome, mapDiscoveredInventory } from '../src/onboard-block.mjs';
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

test('onboarding preserves inventory failures as explicit capability candidates and diagnostics', () => {
  const mapping = mapDiscoveredInventory([{ kind: 'button-popover', type: 'phoenix_blocks_button', title: null,
    wrapIndex: 0, controls: [], skipped: 'unstable', inventoryError: { regionType: 'phoenix_blocks_button',
      code: 'BUTTON_POPOVER_INVENTORY_UNSTABLE', message: 'safe diagnostic',
      diagnostics: { snapshotCount: 10, changingFields: ['url'] }, screenshot: 'reports/screenshots/popover.png' } }]);
  assert.deepEqual(mapping.capabilities, [{ id: 'button-link', status: 'candidate' }]);
  assert.deepEqual(mapping.inventoryErrors[0].capabilityCandidates, ['button-link']);
  const profile = buildDraftProfile(template, { blockId: 'generic-123', page: { kind: 'system', id: 'page-id' }, mapping });
  assert.deepEqual(profile.onboarding.inventoryErrors[0].diagnostics.changingFields, ['url']);
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

test('onboarding records color and font-size style effects as pending without selectors or labels', () => {
  const mapping = { requirements: [{ id: 'btn-text' }], capabilities: [{ id: 'button-link', status: 'candidate' }],
    unmapped: [], matched: [{ id: 'btn-text', capability: 'button-link', evidence: [
      { type: 'color', label: 'ignored-control-label', value: '#123456' },
      { type: 'text', label: 'another-ignored-label', value: '18px' },
      { type: 'number', label: 'unrelated', value: '18' },
    ] }] };
  const profile = buildDraftProfile(template, { blockId: 'generic-456', page: { kind: 'system', id: 'page-id' }, mapping });
  assert.ok(profile.capabilities.some((entry) => entry.id === 'block-style-spec'));
  assert.deepEqual(profile.onboarding.pendingStyleEffects.map(({ kind, property, status }) => [kind, property, status]), [
    ...['color', 'backgroundColor', 'borderColor', 'outlineColor', 'textDecorationColor', 'accentColor',
      'caretColor', 'columnRuleColor', 'fill', 'stroke'].map((property) => ['color', property, 'pending']),
    ['font-size', 'fontSize', 'pending'],
  ]);
  assert.doesNotMatch(JSON.stringify(profile.onboarding.pendingStyleEffects), /selector|ignored-control-label/);
  assert.deepEqual(validateProfile(profile, template, { capabilities: new Set(['button-link', 'block-style-spec']) }), []);
});

test('reviewed profiles cannot be overwritten without an explicit flag', () => {
  assert.throws(() => assertOnboardingOverwriteAllowed({ blockId: 'other' }), /explicit overwrite approval/);
  assert.equal(assertOnboardingOverwriteAllowed({ onboarding: { status: 'draft-unreviewed' } }), true);
  assert.equal(assertOnboardingOverwriteAllowed({ blockId: 'other' }, true), true);
  assert.equal(assertOnboardingOverwriteAllowed(null), true);
});

test('missing module-library target becomes a first-class environment report with stage and links', () => {
  const error = new Error('在 review/develop/online 模块列表中未找到区块 47498');
  error.libraryLookup = [{ mode: 'review', query: '47498', searched: true, found: false,
    waitedForLazyResults: true, scrolledToEnd: true, screenshot: 'logs/47498-review.png' }];
  const outcome = classifyOnboardingEnvironmentOutcome(error);
  assert.equal(outcome.status, 'environment-unavailable');
  const report = buildOnboardingEnvironmentReport({ runId: 'r1', blockId: 'generic-1', siteHost: 'example.test',
    page: { kind: 'system', id: 'p1', url: '/items.html' },
    links: { editor: 'https://editor.test/page/p1', front: 'https://example.test/items.html' }, outcome, error,
    lastProgress: { stage: 'instances-inventoried', deletedSettingIds: [] } });
  assert.equal(report.status, 'environment-unavailable');
  assert.equal(report.stage, 'module-library-preflight');
  assert.equal(report.environmentOutcome, 'TARGET_BLOCK_NOT_IN_MODULE_LIBRARY');
  assert.deepEqual(report.links, { editor: 'https://editor.test/page/p1', front: 'https://example.test/items.html' });
  assert.equal(report.inventory.status, 'target-only-search-complete');
  assert.equal(report.libraryLookup[0].query, '47498');
  assert.equal(report.libraryLookup[0].screenshot, 'logs/47498-review.png');
  assert.equal(report.checks.length, 0);
  assert.equal(report.publishedAt, null);
  assert.equal(classifyOnboardingEnvironmentOutcome(new Error('assertion expected x got y')), null);
  const openerError = Object.assign(new Error('Module-library opener matched 0 controls'), {
    environment: true, code: 'ENV_MODULE_LIBRARY_OPENER_UNAVAILABLE', openerMatchCount: 0 });
  assert.deepEqual(classifyOnboardingEnvironmentOutcome(openerError), {
    status: 'environment-error', code: 'ENV_MODULE_LIBRARY_OPENER_UNAVAILABLE',
    message: 'Module-library opener matched 0 controls' });
  const openerReport = buildOnboardingEnvironmentReport({ runId: 'r2', blockId: 'b', siteHost: 'h', page: {},
    links: {}, outcome: classifyOnboardingEnvironmentOutcome(openerError), error: openerError, lastProgress: {} });
  assert.equal(openerReport.moduleLibraryOpenerMatchCount, 0);
});
