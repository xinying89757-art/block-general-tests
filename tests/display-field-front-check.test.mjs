import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDisplayFieldCards, resolveDisplayFieldFrontExpectations,
  retryDisplayFieldSnapshot, runDisplayFieldFrontChecks } from '../src/display-field-front-check.mjs';

test('display-field front expectations use the capability write and label readback', () => {
  const expectations = resolveDisplayFieldFrontExpectations({ checks: [{ id: 'persist-check', setting: 'display-field',
    expected: true, actual: true, rerunAloneResult: { evidence: { control: 'Material' } } }] });
  assert.deepEqual(expectations, [{ id: 'pld-display-field-batch-effect', setting: 'display-field',
    fieldLabel: 'Material', expectedVisible: true, sourceCheckId: 'persist-check', resolutionReason: null }]);
});

test('display-field front checker distinguishes pass, confirmed missing, and unresolved cards', () => {
  assert.equal(assessDisplayFieldCards({ cards: [{ visible: true, labels: ['Material'] }],
    fieldLabel: 'Material', expectedVisible: true }).status, 'pass');
  const missing = assessDisplayFieldCards({ cards: [{ visible: true, labels: [] }],
    fieldLabel: 'Material', expectedVisible: true });
  assert.equal(missing.status, 'human-review');
  assert.equal(missing.reason.code, 'display-field-no-visible-labels');
  assert.match(missing.detail, /字段值缺失/);
  const partial = assessDisplayFieldCards({ cards: [{ visible: true, labels: ['Material'] },
    { visible: true, labels: [] }], fieldLabel: 'Material', expectedVisible: true });
  assert.equal(partial.status, 'human-review');
  assert.equal(partial.reason.code, 'display-field-partial-visible-labels');
  assert.equal(assessDisplayFieldCards({ cards: [], fieldLabel: 'Material', expectedVisible: true }).status, 'human-review');
  assert.equal(assessDisplayFieldCards({ cards: [{ visible: true, labels: [] }],
    fieldLabel: 'Material', expectedVisible: false }).status, 'pass');
  assert.equal(assessDisplayFieldCards({ cards: [{ visible: true, labels: ['Material'] }],
    fieldLabel: 'Material', expectedVisible: false }).status, 'fail');
});

test('canvas snapshots retry transiently empty product-card content with a finite attempt count', async () => {
  let calls = 0;
  const ready = await retryDisplayFieldSnapshot(async () => ++calls === 1 ? [] : [{ labels: ['Material'] }],
    { attempts: 3, delayMs: 0 });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.attempts, 2);
  let unresolvedCalls = 0;
  const unresolved = await retryDisplayFieldSnapshot(async () => { unresolvedCalls += 1; return []; },
    { attempts: 2, delayMs: 0 });
  assert.equal(unresolved.status, 'unresolved');
  assert.equal(unresolved.reason, 'effect-unresolved-on-canvas');
  assert.equal(unresolvedCalls, 2);
});

test('front capability check emits a merged-row verdict from the resolved instance evidence', async () => {
  const report = { checks: [{ id: 'persist-check', setting: 'display-field', expected: true, actual: true,
    rerunAloneResult: { evidence: { control: 'Material' } } }] };
  const page = { evaluate: async () => ({ rootCount: 1, cards: [
    { visible: true, labels: ['Material'] }, { visible: true, labels: ['Material'] },
  ] }) };
  const [check] = await runDisplayFieldFrontChecks({ page, rootSelector: '[data-instance]', settingsReport: report });
  assert.equal(check.id, 'pld-display-field-batch-effect');
  assert.equal(check.status, 'pass');
  assert.equal(check.evidence.cardCount, 2);
  const missingPage = { evaluate: async () => ({ rootCount: 1, cards: [{ visible: true, labels: [] }] }) };
  const [missing] = await runDisplayFieldFrontChecks({ page: missingPage, rootSelector: '[data-instance]', settingsReport: report });
  assert.equal(missing.status, 'human-review');
  assert.equal(missing.reason.code, 'display-field-no-visible-labels');
  assert.match(missing.detail, /字段值缺失/);
});
