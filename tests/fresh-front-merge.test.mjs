import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeFreshFrontReports, summarizeFreshFrontMerge } from '../src/fresh-front-merge.mjs';

const box = JSON.parse(readFileSync(new URL('./fixtures/fresh-box-report.json', import.meta.url), 'utf8'));
const front = JSON.parse(readFileSync(new URL('./fixtures/fresh-front-report.json', import.meta.url), 'utf8'));

test('fresh/front merge overrides only deferred and retains both source rows', () => {
  const merged = mergeFreshFrontReports(box, front);
  const rows = new Map(merged.checks.map((row) => [row.id, row]));
  assert.equal(rows.get('style-color').status, 'pass');
  assert.equal(rows.get('style-color').selectedSource, 'front');
  assert.equal(rows.get('style-color').sources.box.status, 'deferred');
  assert.equal(rows.get('style-color').sources.front.status, 'pass');
  assert.equal(rows.get('persist-width').status, 'pass');
  assert.equal(rows.get('persist-width').sources.front.status, 'fail');
  assert.equal(rows.get('persist-width').selectedSource, 'box');
  assert.equal(rows.get('front-only').selectedSource, 'front');
  assert.deepEqual(merged.merge.frontOverrides, ['style-color']);
  assert.match(summarizeFreshFrontMerge(merged), /deferred/);
});

test('fresh/front merge fails closed on block mismatch or duplicate check ids', () => {
  assert.throws(() => mergeFreshFrontReports(box, { ...front, blockId: 'other' }), /same block/);
  assert.throws(() => mergeFreshFrontReports({ ...box, checks: [...box.checks, box.checks[0]] }, front), /duplicate/);
});

test('cache-busted Mac report confirms the lifecycle instance and resolves an unreachable publish row', () => {
  const boxReport = { ...box, lifecycle: { addedSettingId: 'instance-new' }, checks: [
    { id: 'fresh-publish-confirmed', status: 'fail', classification: 'front-unreachable-from-runner',
      reason: { code: 'front-unreachable-from-runner' } },
  ] };
  const frontReport = { ...front, runId: 'mac-front-7', settingId: 'instance-new', blockInstances: 1,
    instanceResolution: 'block-number+settingId', url: 'https://test.invalid/page?t=123',
    finishedAt: '2026-11-02T04:00:00.000Z', checks: [] };
  const merged = mergeFreshFrontReports(boxReport, frontReport);
  const row = merged.checks[0];
  assert.equal(row.status, 'pass');
  assert.equal(row.resolvedBy, 'front-report');
  assert.equal(row.selectedSource, 'front-report');
  assert.deepEqual(row.frontConfirmation, { reportId: 'mac-front-7', url: frontReport.url,
    timestamp: frontReport.finishedAt, settingId: 'instance-new', instanceResolution: 'block-number+settingId' });
  assert.equal(merged.summary.fail, 0);
  assert.deepEqual(merged.merge.frontResolvedIds, ['fresh-publish-confirmed']);
});

test('Mac report without the newly-added instance preserves a clear publish failure', () => {
  const boxReport = { ...box, lifecycle: { addedSettingId: 'instance-new' }, checks: [
    { id: 'fresh-publish-confirmed', status: 'fail', classification: 'front-unreachable-from-runner' },
  ] };
  const frontReports = [
    { ...front, runId: 'mac-front-8', settingId: 'old-instance', blockInstances: 1,
      instanceResolution: 'block-number+settingId', url: 'https://test.invalid/page?t=124' },
    { ...front, runId: 'mac-front-9', settingId: 'instance-new', blockInstances: 0,
      instanceResolution: 'block-number+settingId', url: 'https://test.invalid/page?t=125' },
  ];
  for (const frontReport of frontReports) {
    const row = mergeFreshFrontReports(boxReport, frontReport).checks[0];
    assert.equal(row.status, 'fail');
    assert.equal(row.detail, '前台未找到本次新实例：Mac 前台报告未能以缓存刷新 URL 确认同一个新 settingId。');
  }
});

test('front reachability evidence does not resolve an unrelated failure', () => {
  const boxReport = { ...box, lifecycle: { addedSettingId: 'instance-new' }, checks: [
    { id: 'persist-setting', status: 'fail', classification: 'persistence-mismatch', detail: 'value mismatch' },
  ] };
  const frontReport = { ...front, settingId: 'instance-new', blockInstances: 1,
    instanceResolution: 'block-number+settingId', url: 'https://test.invalid/page?t=125' };
  const row = mergeFreshFrontReports(boxReport, frontReport).checks[0];
  assert.equal(row.status, 'fail');
  assert.equal(row.classification, 'persistence-mismatch');
  assert.equal(row.resolvedBy, undefined);
});

test('front display-field verdict replaces only the canvas checker limitation', () => {
  const boxReport = { ...box, lifecycle: { addedSettingId: 'instance-new' }, checks: [
    { id: 'pld-display-field-batch-effect', status: 'human-review',
      evidence: { reason: 'effect-unresolved-on-canvas' } },
    { id: 'pld-display-field-persist', status: 'fail', classification: 'persistence-mismatch' },
  ] };
  const frontReport = { ...front, settingId: 'instance-new', blockInstances: 1,
    instanceResolution: 'block-number+settingId', url: 'https://test.invalid/page?t=126',
    finishedAt: '2026-11-02T04:01:00.000Z', checks: [
      { id: 'pld-display-field-batch-effect', status: 'pass', evidence: { cardCount: 3, matchedCards: 3 } },
      { id: 'pld-display-field-persist', status: 'pass' },
    ] };
  const merged = mergeFreshFrontReports(boxReport, frontReport);
  const rows = new Map(merged.checks.map((row) => [row.id, row]));
  assert.equal(rows.get('pld-display-field-batch-effect').status, 'pass');
  assert.equal(rows.get('pld-display-field-batch-effect').selectedSource, 'front');
  assert.equal(rows.get('pld-display-field-persist').status, 'fail');
  assert.equal(rows.get('pld-display-field-persist').selectedSource, 'box');
});
