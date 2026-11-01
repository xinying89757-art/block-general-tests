import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { finalizeFrontStyleReport } from '../src/front-style-report.mjs';

test('final front report assembly collapses repeated check ids and recounts verdicts conservatively', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/front-style-repeated-checks.json', import.meta.url), 'utf8'));
  const report = finalizeFrontStyleReport({ ...fixture, summary: { pass: 12, fail: 0 } });
  assert.equal(report.checks.length, 4);
  assert.deepEqual(report.checks.map((check) => [check.id, check.status]), [
    ['bss-button-text', 'fail'], ['bss-filter-title', 'pass'],
    ['bss-product-name', 'pass'], ['bss-pagination-other', 'pass'],
  ]);
  assert.deepEqual(report.summary, { pass: 3, fail: 1, rawFail: 1, dedupedFail: 1, na: 0, other: 0 });
});

test('summary exposes raw failures and roots while retaining transitive dependent details', () => {
  const report = finalizeFrontStyleReport({ checks: [
    { id: 'root', status: 'fail' }, { id: 'dependent', status: 'fail', dependsOn: ['root'] },
    { id: 'nested', status: 'fail', dependsOn: ['dependent'] }, { id: 'independent', status: 'fail' },
  ] });
  assert.equal(report.summary.rawFail, 4);
  assert.equal(report.summary.dedupedFail, 2);
  assert.equal(report.summary.fail, 2);
  assert.deepEqual(report.checks[2].rootFailureIds, ['root']);
  assert.deepEqual(report.failureDeduplication.failures[1].dependsOn, ['root']);
  assert.equal(report.checks.length, 4);
});

test('same spec/property/expected failure across PC and mobile is one root with both viewports', () => {
  const row = (id, viewport, wanted = 28, property = 'lineHeight') => ({ id, status: 'fail', sourceText: 'Label typography',
    expected: { [property]: wanted }, reason: { checkType: 'typography', code: 'design-typography-mismatch',
      viewport: { label: viewport }, mismatches: [{ property, expected: wanted, actual: [14] }] } });
  const report = finalizeFrontStyleReport({ checks: [row('design-pc-font', 'pc'), row('design-mobile-font', 'mobile')] });
  assert.equal(report.checks.length, 2);
  assert.equal(report.summary.rawFail, 2);
  assert.equal(report.summary.dedupedFail, 1);
  assert.deepEqual(report.failureDeduplication.rootFailures[0].viewports, ['pc', 'mobile']);
  assert.deepEqual(report.checks[0].rootFailureIds, report.checks[1].rootFailureIds);
  const sameId = finalizeFrontStyleReport({ checks: [row('design-same', 'pc'), row('design-same', 'mobile')] });
  assert.equal(sameId.checks.length, 1);
  assert.deepEqual(sameId.failureDeduplication.rootFailures[0].viewports, ['pc', 'mobile']);
  assert.equal(sameId.failureDeduplication.rawFailureObservationCount, 2);
  assert.equal(finalizeFrontStyleReport({ checks: [row('design-pc', 'pc'), row('design-mobile', 'mobile', 32)] }).summary.fail, 2);
  assert.equal(finalizeFrontStyleReport({ checks: [row('design-pc', 'pc'), row('design-mobile', 'mobile', 28, 'fontSize')] }).summary.fail, 2);
});
