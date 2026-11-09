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
    assert.equal(row.detail, '前台未确认本次新实例：Mac 前台报告未能以充分证据确认同一个新 settingId。');
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

test('front-only output without a run id confirms the new instance using source basename and timestamp', () => {
  const boxReport = { ...box, lifecycle: { addedSettingId: 'instance-new' }, checks: [
    { id: 'fresh-publish-confirmed', status: 'fail', classification: 'front-unreachable-from-runner' },
  ] };
  const { runId: _runId, ...frontWithoutRunId } = front;
  const frontReport = { ...frontWithoutRunId, settingId: 'instance-new', blockInstances: 1,
    instanceResolution: 'block-number+settingId', url: 'https://test.invalid/page?t=126',
    expectedValueSourceReport: '/reports/settings-run.json',
    startedAt: '2026-11-02T04:02:00.000Z', finishedAt: '2026-11-02T04:03:00.000Z', checks: [] };
  delete frontReport.reportId;
  delete frontReport.id;
  const merged = mergeFreshFrontReports(boxReport, frontReport);
  const row = merged.checks[0];
  assert.equal(row.status, 'pass');
  assert.equal(row.frontConfirmation.reportId, 'settings-run.json:2026-11-02T04:03:00.000Z');
  assert.equal(row.frontConfirmation.reportIdDerivedFrom, frontReport.expectedValueSourceReport);
  assert.equal(merged.merge.addedInstanceConfirmed, true);
  assert.equal(merged.summary.fail, 0);

  const mismatched = mergeFreshFrontReports(boxReport, { ...frontReport, settingId: 'different-instance' });
  assert.equal(mismatched.checks[0].status, 'fail');
  assert.equal(mismatched.merge.addedInstanceConfirmed, false);
});

test('strong instance resolution confirms an unreachable publish row without a cache-busted URL', () => {
  const boxReport = { ...box, lifecycle: { addedSettingId: 'instance-new' }, checks: [
    { id: 'fresh-publish-confirmed', status: 'fail', classification: 'front-unreachable-from-runner' },
  ] };
  const frontReport = { ...front, settingId: 'instance-new', blockInstances: 1,
    instanceResolution: 'block-number+settingId', url: 'http://test.invalid/page',
    finishedAt: '2026-11-02T04:04:00.000Z' };
  const merged = mergeFreshFrontReports(boxReport, frontReport);
  assert.equal(merged.checks[0].status, 'pass');
  assert.equal(merged.merge.addedInstanceConfirmed, true);
  const weak = mergeFreshFrontReports(boxReport, { ...frontReport, instanceResolution: 'block-number' });
  assert.equal(weak.checks[0].status, 'fail');
  assert.equal(weak.merge.addedInstanceConfirmed, false);
});

test('confirmed instance resolves deferred unreachable rows without matching front check ids', () => {
  const boxReport = { ...box, lifecycle: { addedSettingId: 'instance-new' }, checks: [
    { id: 'fresh-publish-confirmed', status: 'deferred', classification: 'front-unreachable-from-runner' },
    { id: 'fresh-front-checks', status: 'deferred', classification: 'front-unreachable-from-runner' },
  ] };
  const frontReport = { ...front, runId: 'mac-front', settingId: 'instance-new', blockInstances: 1,
    instanceResolution: 'block-number+settingId', url: 'http://test.invalid/page',
    finishedAt: '2026-11-02T04:04:00.000Z', checks: [] };
  const merged = mergeFreshFrontReports(boxReport, frontReport);
  assert.deepEqual(merged.checks.map((row) => row.status), ['pass', 'pass']);
  assert.deepEqual(merged.merge.frontResolvedIds, ['fresh-publish-confirmed', 'fresh-front-checks']);
  assert.ok(merged.checks.every((row) => row.resolvedBy === 'front-report'));
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

function displayFieldReports(frontStatus, { expected = true, actual = true,
  effectStatus = 'skip', effectDetail = '展示字段对应位置无法唯一识别' } = {}) {
  const boxReport = { ...box, lifecycle: { addedSettingId: 'instance-new' }, checks: [
    { id: 'field-persist-check', setting: 'display-field', capability: 'product-list-display', status: 'fail',
      expected, actual, batchResult: { status: 'fail', detail: effectStatus === 'fail' ? effectDetail : '展示字段静态内容暂时读不到',
        expected, actual, evidence: { effectCheck: { status: effectStatus, detail: effectDetail } } },
      rerunAloneResult: { status: 'pass', expected, actual,
        evidence: { effectCheck: { status: effectStatus, detail: effectDetail } } } },
  ] };
  const frontReport = { ...front, settingId: 'instance-new', blockInstances: 1,
    instanceResolution: 'block-number+settingId', url: 'https://test.invalid/page?t=127',
    finishedAt: '2026-11-02T04:05:00.000Z', checks: [
      { id: 'field-front-effect', setting: 'display-field', capability: 'product-list-display', status: frontStatus,
        expected: true, actual: frontStatus === 'pass', evidence: { sourceCheckId: 'field-persist-check' } },
    ] };
  return { boxReport, frontReport };
}

test('display-field canvas limitation plus front fail becomes one front-sourced failure', () => {
  const { boxReport, frontReport } = displayFieldReports('fail');
  const merged = mergeFreshFrontReports(boxReport, frontReport);
  assert.equal(merged.checks.length, 1);
  assert.equal(merged.checks[0].status, 'fail');
  assert.equal(merged.checks[0].resolvedBy, 'front-report');
  assert.equal(merged.checks[0].selectedSource, 'front-report');
  assert.equal(merged.checks[0].sources.box.id, 'field-persist-check');
  assert.equal(merged.checks[0].sources.front.id, 'field-front-effect');
  assert.equal(merged.summary.fail, 1);
  assert.deepEqual(merged.merge.frontResolvedIds, ['field-persist-check']);
});

test('display-field canvas effect mismatch plus front fail becomes one front-sourced failure', () => {
  const { boxReport, frontReport } = displayFieldReports('fail', { effectStatus: 'fail',
    effectDetail: '10 张卡片与该状态不符' });
  const merged = mergeFreshFrontReports(boxReport, frontReport);
  assert.equal(merged.checks.length, 1);
  assert.equal(merged.checks[0].status, 'fail');
  assert.equal(merged.checks[0].resolvedBy, 'front-report');
  assert.equal(merged.checks[0].sources.box.batchResult.evidence.effectCheck.status, 'fail');
  assert.equal(merged.checks[0].sources.front.status, 'fail');
  assert.equal(merged.summary.fail, 1);
});

test('display-field canvas limitation plus front pass becomes one pass and keeps both sources', () => {
  const { boxReport, frontReport } = displayFieldReports('pass');
  const merged = mergeFreshFrontReports(boxReport, frontReport);
  assert.equal(merged.checks.length, 1);
  assert.equal(merged.checks[0].status, 'pass');
  assert.equal(merged.checks[0].resolvedBy, 'front-report');
  assert.equal(merged.summary.pass, 1);
  assert.equal(merged.summary.fail, 0);
  assert.equal(merged.checks[0].sources.box.status, 'fail');
  assert.equal(merged.checks[0].sources.front.status, 'pass');
});

test('display-field canvas effect disagreement plus front pass is one pass with a canvas note', () => {
  const { boxReport, frontReport } = displayFieldReports('pass', { effectStatus: 'fail',
    effectDetail: '10 张卡片与该状态不符' });
  const merged = mergeFreshFrontReports(boxReport, frontReport);
  assert.equal(merged.checks.length, 1);
  assert.equal(merged.checks[0].status, 'pass');
  assert.equal(merged.checks[0].resolvedBy, 'front-report');
  assert.equal(merged.checks[0].canvasDisagreement.status, 'human-review');
  assert.equal(merged.checks[0].canvasDisagreement.reason.code, 'canvas-front-effect-disagreement');
  assert.equal(merged.summary.pass, 1);
  assert.equal(merged.summary.fail, 0);
});

test('display-field persistence mismatch remains a box failure despite a passing front effect', () => {
  const { boxReport, frontReport } = displayFieldReports('pass', { expected: true, actual: false, effectStatus: 'fail' });
  const merged = mergeFreshFrontReports(boxReport, frontReport);
  const persisted = merged.checks.find((row) => row.id === 'field-persist-check');
  assert.equal(persisted.status, 'fail');
  assert.equal(persisted.selectedSource, 'box');
  assert.equal(persisted.resolvedBy, undefined);
  assert.equal(merged.summary.fail, 1);
});

test('display-field box failure remains unchanged when there is no matching front effect row', () => {
  const { boxReport, frontReport } = displayFieldReports('fail', { effectStatus: 'fail',
    effectDetail: '10 张卡片与该状态不符' });
  frontReport.checks = [];
  const merged = mergeFreshFrontReports(boxReport, frontReport);
  assert.equal(merged.checks.length, 1);
  assert.equal(merged.checks[0].status, 'fail');
  assert.equal(merged.checks[0].selectedSource, 'box');
  assert.equal(merged.checks[0].resolvedBy, undefined);
  assert.equal(merged.checks[0].sources.front, undefined);
});
